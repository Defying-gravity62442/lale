"""Lean 4 process pool — long-lived `lake env lean --server` workers with Mathlib pre-imported.

How it works
------------
- On `start()` we spawn `lean_pool_size` worker subprocesses, each a `lake env lean --server`
  rooted at `LEAN_PROJECT_DIR` (the lale Lean project at services/lean).
- Each worker opens `Lale/Warmup.lean` (which is `import Mathlib`) exactly once. That pays the
  ~30s Mathlib import cost per worker, after which subsequent `textDocument/didOpen` calls
  with arbitrary Lean source resolve `import Mathlib` immediately from cached oleans.
- A `check(source)` request grabs a worker from a queue (one check per worker at a time),
  sends a `textDocument/didOpen` with a synthetic URI inside the project dir (no disk write —
  LSP processes from memory), waits for `$/lean/fileProgress` to report `processing: []`, then
  collects the latest `textDocument/publishDiagnostics` for that URI and closes it.
- On per-check timeout we kill and replace the worker; on unexpected process death we replace
  too. The pool stays at the configured size as long as Lean is reachable.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import pathlib
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

from .config import Settings, get_settings

log = logging.getLogger(__name__)

_IMPORT_RE = re.compile(r"^\s*import\s+(.+?)\s*$")


def _split_imports_and_body(source: str) -> tuple[list[str], str]:
    imports: list[str] = []
    body_lines: list[str] = []
    for line in source.splitlines():
        match = _IMPORT_RE.match(line)
        if match:
            imports.append(match.group(1).strip())
        else:
            body_lines.append(line)
    return imports, "\n".join(body_lines).strip()


def compose_lean_source(lean_source: str, dependency_sources: list[str] | None = None) -> str:
    """Build one Lean file from dependency snippets plus the target snippet.

    The translator returns standalone snippets that usually include `import Mathlib`.
    Lean imports must stay at the top of the file, so verification needs to hoist imports
    before concatenating dependency declarations and the target declaration.
    """
    imports = ["Mathlib"]
    bodies: list[str] = []
    for source in [*(dependency_sources or []), lean_source]:
        snippet_imports, body = _split_imports_and_body(source)
        imports.extend(snippet_imports)
        if body:
            bodies.append(body)

    seen: set[str] = set()
    unique_imports: list[str] = []
    for imp in imports:
        if imp and imp not in seen:
            seen.add(imp)
            unique_imports.append(imp)

    imports_block = "\n".join(f"import {imp}" for imp in unique_imports)
    body_block = "\n\n".join(bodies)
    return f"{imports_block}\n\n{body_block}\n"


# ---------- Public result type ----------


class LeanError(BaseModel):
    line: int | None = Field(default=None, ge=0)
    column: int | None = Field(default=None, ge=0)
    message: str
    severity: Literal["error", "warning"]


@dataclass
class LeanCheckResult:
    status: str  # "verified" | "failed" | "sorry" | "timeout"
    lean_output: str
    errors: list[LeanError]
    elapsed_ms: int
    goal_context: list[str] = field(default_factory=list)


# ---------- LSP framing ----------


async def _read_message(reader: asyncio.StreamReader) -> dict | None:
    """Read one LSP message off a stream. Returns None on EOF."""
    headers: dict[str, str] = {}
    while True:
        line = await reader.readline()
        if not line:
            return None
        decoded = line.decode("utf-8", errors="replace").rstrip("\r\n")
        if decoded == "":
            break
        if ":" in decoded:
            k, v = decoded.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    n_str = headers.get("content-length")
    if not n_str:
        return None
    n = int(n_str)
    body = await reader.readexactly(n)
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        log.warning("lean lsp: malformed JSON body of length %d", n)
        return None


def _frame(msg: dict) -> bytes:
    body = json.dumps(msg).encode("utf-8")
    return f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body


def _hover_text(resp: dict | None) -> str | None:
    if not resp or "result" not in resp or resp["result"] is None:
        return None
    contents = resp["result"].get("contents")
    if isinstance(contents, str):
        text = contents
    elif isinstance(contents, dict):
        text = str(contents.get("value") or contents.get("contents") or "")
    elif isinstance(contents, list):
        chunks = []
        for item in contents:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict):
                chunks.append(str(item.get("value") or item.get("contents") or ""))
        text = "\n".join(chunks)
    else:
        return None
    text = text.strip()
    if not text:
        return None
    return text[:2000]


# ---------- Per-file state ----------


class _FileState:
    __slots__ = ("done_event", "diagnostics", "any_progress_seen")

    def __init__(self) -> None:
        self.done_event = asyncio.Event()
        self.diagnostics: list[dict] = []
        self.any_progress_seen = False  # guard so initial empty-progress doesn't false-trigger


# ---------- Worker ----------


class LspWorker:
    """One Lean LSP subprocess plus async I/O bookkeeping."""

    def __init__(
        self,
        idx: int,
        project_dir: pathlib.Path,
        warmup_uri: str,
        warmup_text: str,
        warmup_timeout: float,
    ) -> None:
        self.idx = idx
        self.project_dir = project_dir
        self.warmup_uri = warmup_uri
        self.warmup_text = warmup_text
        self.warmup_timeout = warmup_timeout
        self.proc: asyncio.subprocess.Process | None = None
        self.next_id = 1
        self.pending: dict[int, asyncio.Future[dict]] = {}
        self.files: dict[str, _FileState] = {}
        self._reader_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self._stderr_buf: list[str] = []

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self) -> None:
        log.info("lean worker %d: spawning lake env lean --server in %s", self.idx, self.project_dir)
        try:
            self.proc = await asyncio.create_subprocess_exec(
                "lake",
                "env",
                "lean",
                "--server",
                cwd=str(self.project_dir),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as e:
            raise RuntimeError(
                "Could not spawn `lake env lean --server`. Ensure `lake` is on PATH."
            ) from e

        assert self.proc.stdout is not None and self.proc.stdin is not None and self.proc.stderr is not None
        self._reader_task = asyncio.create_task(self._read_loop(self.proc.stdout))
        self._stderr_task = asyncio.create_task(self._stderr_loop(self.proc.stderr))

        # LSP handshake.
        init = await self._request(
            "initialize",
            {
                "processId": os.getpid(),
                "rootUri": self.project_dir.as_uri(),
                "capabilities": {},
                "clientInfo": {"name": "lale", "version": "0.0.1"},
            },
            timeout=30.0,
        )
        if init is None or "result" not in init:
            err = self._stderr_summary()
            await self.stop()
            raise RuntimeError(
                f"Lean LSP initialize failed (worker {self.idx}). "
                f"Common cause: services/lean not built yet — run `lake update && lake exe cache get && lake build`. "
                f"stderr: {err}"
            )
        await self._notify("initialized", {})

        # Warmup so Mathlib imports happen exactly once.
        log.info("lean worker %d: warmup (import Mathlib)...", self.idx)
        warm_start = time.perf_counter()
        diagnostics = await self._open_and_wait(
            self.warmup_uri, self.warmup_text, timeout=self.warmup_timeout
        )
        if diagnostics is None:
            err = self._stderr_summary()
            await self.stop()
            raise RuntimeError(
                f"Lean LSP warmup timed out after {self.warmup_timeout}s on worker {self.idx}. "
                f"Mathlib cache may not be built. stderr: {err}"
            )
        warm_elapsed = time.perf_counter() - warm_start
        # Warmup file is trivial; any errors here mean the project is broken, not the user's fault.
        errors = [d for d in diagnostics if d.get("severity") == 1]
        if errors:
            err = self._stderr_summary()
            await self.stop()
            raise RuntimeError(
                f"Lean warmup produced errors on worker {self.idx}: {errors}. stderr: {err}"
            )
        log.info("lean worker %d: ready in %.1fs", self.idx, warm_elapsed)

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                await self._notify("exit", None)
            except Exception:
                pass
            try:
                self.proc.kill()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass
        if self._reader_task:
            self._reader_task.cancel()
        if self._stderr_task:
            self._stderr_task.cancel()

    async def check(self, source: str, timeout: float) -> tuple[list[dict], list[str]] | None:
        """Run one verification on this worker. Returns LSP diagnostics, or None on timeout."""
        # Unique URI inside the project dir so import resolution sees the right environment.
        # No file is written; LSP processes from memory.
        path = self.project_dir / f"__lale_check_{uuid.uuid4().hex}.lean"
        uri = path.as_uri()
        return await self._open_and_wait(uri, source, timeout=timeout, include_goal_context=True)

    # ---------- internals ----------

    async def _read_loop(self, reader: asyncio.StreamReader) -> None:
        try:
            while True:
                msg = await _read_message(reader)
                if msg is None:
                    break
                self._dispatch(msg)
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.warning("lean worker %d: read loop error: %s", self.idx, e)
        finally:
            # Wake anything waiting.
            for fut in self.pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("LSP worker stream closed"))
            self.pending.clear()
            for state in self.files.values():
                state.done_event.set()

    async def _stderr_loop(self, reader: asyncio.StreamReader) -> None:
        try:
            while True:
                line = await reader.readline()
                if not line:
                    return
                text = line.decode("utf-8", errors="replace").rstrip()
                if text:
                    self._stderr_buf.append(text)
                    if len(self._stderr_buf) > 200:
                        self._stderr_buf.pop(0)
                    if "error" in text.lower() or "exception" in text.lower():
                        log.warning("lean worker %d stderr: %s", self.idx, text)
        except asyncio.CancelledError:
            return

    def _stderr_summary(self) -> str:
        return "\n".join(self._stderr_buf[-20:]) if self._stderr_buf else "(empty)"

    def _dispatch(self, msg: dict) -> None:
        if "id" in msg and "method" not in msg:
            fut = self.pending.pop(msg["id"], None)
            if fut and not fut.done():
                fut.set_result(msg)
            return

        method = msg.get("method")
        params = msg.get("params") or {}
        if method == "$/lean/fileProgress":
            uri = (params.get("textDocument") or {}).get("uri")
            processing = params.get("processing") or []
            state = self.files.get(uri) if uri else None
            if state is not None:
                state.any_progress_seen = True
                if not processing:
                    state.done_event.set()
        elif method == "textDocument/publishDiagnostics":
            uri = params.get("uri")
            state = self.files.get(uri) if uri else None
            if state is not None:
                state.diagnostics = list(params.get("diagnostics") or [])
        # Other server-sent notifications/requests are ignored.

    async def _request(self, method: str, params: dict, *, timeout: float) -> dict | None:
        if not self.proc or not self.proc.stdin:
            return None
        rid = self.next_id
        self.next_id += 1
        fut: asyncio.Future[dict] = asyncio.get_event_loop().create_future()
        self.pending[rid] = fut
        self.proc.stdin.write(_frame({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}))
        await self.proc.stdin.drain()
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self.pending.pop(rid, None)
            return None

    async def _notify(self, method: str, params: dict | None) -> None:
        if not self.proc or not self.proc.stdin:
            return
        msg: dict = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        try:
            self.proc.stdin.write(_frame(msg))
            await self.proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass

    async def _open_and_wait(
        self,
        uri: str,
        text: str,
        *,
        timeout: float,
        include_goal_context: bool = False,
    ) -> tuple[list[dict], list[str]] | list[dict] | None:
        state = _FileState()
        self.files[uri] = state
        await self._notify(
            "textDocument/didOpen",
            {
                "textDocument": {
                    "uri": uri,
                    "languageId": "lean4",
                    "version": 1,
                    "text": text,
                }
            },
        )
        try:
            await asyncio.wait_for(state.done_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            self.files.pop(uri, None)
            await self._notify("textDocument/didClose", {"textDocument": {"uri": uri}})
            return None
        diagnostics = state.diagnostics
        goal_context: list[str] = []
        if include_goal_context:
            goal_context = await self._goal_context(uri, diagnostics)
        self.files.pop(uri, None)
        await self._notify("textDocument/didClose", {"textDocument": {"uri": uri}})
        if include_goal_context:
            return diagnostics, goal_context
        return diagnostics

    async def _goal_context(self, uri: str, diagnostics: list[dict]) -> list[str]:
        out: list[str] = []
        for d in diagnostics[:3]:
            rng = d.get("range") or {}
            start = rng.get("start") or {}
            line = start.get("line")
            character = start.get("character")
            if not isinstance(line, int) or not isinstance(character, int):
                continue
            resp = await self._request(
                "textDocument/hover",
                {
                    "textDocument": {"uri": uri},
                    "position": {"line": line, "character": character},
                },
                timeout=2.0,
            )
            text = _hover_text(resp)
            if text and text not in out:
                out.append(text)
        return out[:3]


# ---------- Pool ----------


class LeanPool:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._workers: list[LspWorker] = []
        self._available: asyncio.Queue[LspWorker] = asyncio.Queue()
        self._started = False
        self._start_lock = asyncio.Lock()

    async def start(self) -> None:
        if self._started:
            return
        async with self._start_lock:
            if self._started:
                return
            if not self.settings.lean_project_dir or not self.settings.lean_project_dir.exists():
                raise RuntimeError(
                    "LEAN_PROJECT_DIR must point at a Lean 4 project; "
                    f"got {self.settings.lean_project_dir!r}. Try services/lean."
                )
            warmup_path = self.settings.lean_project_dir / "Lale" / "Warmup.lean"
            if warmup_path.exists():
                warmup_text = warmup_path.read_text()
                warmup_uri = warmup_path.as_uri()
            else:
                warmup_text = "import Mathlib\n"
                warmup_uri = (self.settings.lean_project_dir / "__lale_warmup.lean").as_uri()

            warmup_timeout = max(self.settings.lean_timeout_seconds * 4, 180.0)
            log.info(
                "Lean pool: spawning %d worker(s), project=%s, warmup_timeout=%.0fs",
                self.settings.lean_pool_size,
                self.settings.lean_project_dir,
                warmup_timeout,
            )
            for i in range(self.settings.lean_pool_size):
                w = LspWorker(
                    idx=i,
                    project_dir=self.settings.lean_project_dir,
                    warmup_uri=warmup_uri,
                    warmup_text=warmup_text,
                    warmup_timeout=warmup_timeout,
                )
                await w.start()
                self._workers.append(w)
                await self._available.put(w)
            self._started = True

    async def stop(self) -> None:
        for w in self._workers:
            await w.stop()
        self._workers = []
        self._started = False

    async def check(self, lean_source: str) -> LeanCheckResult:
        await self.start()

        worker = await self._available.get()
        try:
            if not worker.alive:
                worker = await self._replace_worker(worker)
            start = time.perf_counter()
            checked = await worker.check(lean_source, self.settings.lean_timeout_seconds)
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            if checked is None:
                # Timeout. Recycle this worker — its state may be wedged on the open URI.
                log.info("lean worker %d: timeout, recycling", worker.idx)
                worker = await self._replace_worker(worker)
                return LeanCheckResult(
                    status="timeout",
                    lean_output=f"Lean check exceeded {self.settings.lean_timeout_seconds:.1f}s",
                    errors=[
                        LeanError(message="Lean check timed out", severity="error"),
                    ],
                    elapsed_ms=elapsed_ms,
                )
            diagnostics, goal_context = checked
            return _diagnostics_to_result(diagnostics, lean_source, elapsed_ms, goal_context)
        finally:
            await self._available.put(worker)

    async def _replace_worker(self, dead: LspWorker) -> LspWorker:
        try:
            await dead.stop()
        except Exception:
            pass
        if dead in self._workers:
            self._workers.remove(dead)
        warmup_path = self.settings.lean_project_dir / "Lale" / "Warmup.lean"
        warmup_text = warmup_path.read_text() if warmup_path.exists() else "import Mathlib\n"
        warmup_uri = (
            warmup_path.as_uri()
            if warmup_path.exists()
            else (self.settings.lean_project_dir / "__lale_warmup.lean").as_uri()
        )
        new = LspWorker(
            idx=dead.idx,
            project_dir=self.settings.lean_project_dir,
            warmup_uri=warmup_uri,
            warmup_text=warmup_text,
            warmup_timeout=max(self.settings.lean_timeout_seconds * 4, 180.0),
        )
        await new.start()
        self._workers.append(new)
        return new


# ---------- Diagnostics → result ----------


_SORRY_HINTS = ("uses 'sorry'", "declaration uses 'sorry'", "contains sorry")


def _diagnostics_to_result(
    diagnostics: list[dict],
    lean_source: str,
    elapsed_ms: int,
    goal_context: list[str] | None = None,
) -> LeanCheckResult:
    errors: list[LeanError] = []
    has_sorry = False
    output_lines: list[str] = []
    for d in diagnostics:
        sev_num = d.get("severity", 1)
        sev: str = "error" if sev_num == 1 else "warning"
        msg = str(d.get("message") or "")
        rng = d.get("range") or {}
        start = rng.get("start") or {}
        line = start.get("line")
        column = start.get("character")
        errors.append(
            LeanError(
                line=int(line) if isinstance(line, int) else None,
                column=int(column) if isinstance(column, int) else None,
                message=msg,
                severity=sev,
            )
        )
        prefix = f"{sev}"
        if isinstance(line, int):
            prefix = f"{sev} (line {line + 1})"
        output_lines.append(f"{prefix}: {msg}")
        if sev == "warning" and any(h in msg for h in _SORRY_HINTS):
            has_sorry = True

    has_error = any(e.severity == "error" for e in errors)
    if has_error:
        status = "failed"
    elif has_sorry or "sorry" in lean_source:
        # Source-level fallback so explicit `sorry` still classifies even if Lean's warning text changes.
        status = "sorry"
    else:
        status = "verified"

    output = "\n".join(output_lines) if output_lines else "ok"
    if goal_context:
        output = output + "\n\nGoal context:\n" + "\n\n".join(goal_context)
    return LeanCheckResult(
        status=status,
        lean_output=output,
        errors=errors,
        elapsed_ms=elapsed_ms,
        goal_context=goal_context or [],
    )

# ---------- Module-level singleton ----------

_pool: LeanPool | None = None


def get_pool() -> LeanPool:
    global _pool
    if _pool is None:
        _pool = LeanPool(get_settings())
    return _pool
