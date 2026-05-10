"""Two-layer SQLite cache.

Layer 1 (translation): sha256(normalized_latex) + translator_version + model -> lean_code
  Pre-filter on byte-exact raw_latex hash for free hits.

Layer 2 (verification): sha256(lean_code) + sha256(sorted(dep_lean_hashes)) + lean/mathlib version
  KEY ON LEAN, NOT LATEX. Wording changes that produce identical Lean reuse this cache.

LRU eviction at 500MB by default. See cache-keys agent for the audit rules.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

# Bump these to invalidate caches when prompts or schema change.
TRANSLATOR_VERSION = "v1"


@dataclass(frozen=True)
class TranslationHit:
    lean_code: str
    imports: list[str]
    attempts_json: str


@dataclass(frozen=True)
class VerificationHit:
    status: str
    lean_output: str
    errors_json: str
    elapsed_ms: int


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def dep_hash(dep_lean_codes: list[str]) -> str:
    """Order-independent hash of a set of dependency Lean snippets."""
    inner = sorted(_sha256(code) for code in dep_lean_codes)
    return _sha256("\n".join(inner))


class Cache:
    def __init__(self, db_path: Path, max_bytes: int) -> None:
        self.db_path = db_path
        self.max_bytes = max_bytes
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._init_schema()

    def _init_schema(self) -> None:
        with self._tx() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS translation (
                    raw_hash TEXT NOT NULL,
                    norm_hash TEXT NOT NULL,
                    translator_version TEXT NOT NULL,
                    model TEXT NOT NULL,
                    lean_code TEXT NOT NULL,
                    imports_json TEXT NOT NULL,
                    attempts_json TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    last_used_at REAL NOT NULL,
                    PRIMARY KEY (norm_hash, translator_version, model)
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_translation_raw
                ON translation(raw_hash, translator_version, model)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS verification (
                    lean_hash TEXT NOT NULL,
                    deps_hash TEXT NOT NULL,
                    lean_version TEXT NOT NULL,
                    mathlib_version TEXT NOT NULL,
                    status TEXT NOT NULL,
                    lean_output TEXT NOT NULL,
                    errors_json TEXT NOT NULL,
                    elapsed_ms INTEGER NOT NULL,
                    bytes INTEGER NOT NULL,
                    last_used_at REAL NOT NULL,
                    PRIMARY KEY (lean_hash, deps_hash, lean_version, mathlib_version)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS dependency (
                    target_hash TEXT NOT NULL,
                    prev_hash TEXT NOT NULL,
                    model TEXT NOT NULL,
                    deps_json TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    last_used_at REAL NOT NULL,
                    PRIMARY KEY (target_hash, prev_hash, model)
                )
            """)

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Cursor]:
        cur = self._conn.cursor()
        try:
            cur.execute("BEGIN")
            yield cur
            cur.execute("COMMIT")
        except Exception:
            cur.execute("ROLLBACK")
            raise
        finally:
            cur.close()

    # ---------- Translation cache ----------

    def get_translation(
        self, raw_latex: str, normalized_latex: str, model: str
    ) -> TranslationHit | None:
        raw = _sha256(raw_latex)
        norm = _sha256(normalized_latex)
        now = time.time()
        # Byte-exact pre-filter, then normalized.
        for col, val in (("raw_hash", raw), ("norm_hash", norm)):
            row = self._conn.execute(
                f"SELECT lean_code, imports_json, attempts_json FROM translation "
                f"WHERE {col} = ? AND translator_version = ? AND model = ? LIMIT 1",
                (val, TRANSLATOR_VERSION, model),
            ).fetchone()
            if row:
                self._conn.execute(
                    f"UPDATE translation SET last_used_at = ? WHERE {col} = ? "
                    f"AND translator_version = ? AND model = ?",
                    (now, val, TRANSLATOR_VERSION, model),
                )
                lean_code, imports_json, attempts_json = row
                return TranslationHit(
                    lean_code=lean_code,
                    imports=json.loads(imports_json),
                    attempts_json=attempts_json,
                )
        return None

    def put_translation(
        self,
        raw_latex: str,
        normalized_latex: str,
        model: str,
        lean_code: str,
        imports: list[str],
        attempts_json: str,
    ) -> None:
        raw = _sha256(raw_latex)
        norm = _sha256(normalized_latex)
        imports_json = json.dumps(imports)
        size = len(lean_code) + len(imports_json) + len(attempts_json)
        with self._tx() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO translation
                (raw_hash, norm_hash, translator_version, model, lean_code, imports_json,
                 attempts_json, bytes, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    raw,
                    norm,
                    TRANSLATOR_VERSION,
                    model,
                    lean_code,
                    imports_json,
                    attempts_json,
                    size,
                    time.time(),
                ),
            )
        self._evict_if_needed()

    # ---------- Verification cache ----------

    def get_verification(
        self,
        lean_code: str,
        dep_lean_codes: list[str],
        lean_version: str,
        mathlib_version: str,
    ) -> VerificationHit | None:
        lean_hash = _sha256(lean_code)
        deps = dep_hash(dep_lean_codes)
        row = self._conn.execute(
            """SELECT status, lean_output, errors_json, elapsed_ms FROM verification
            WHERE lean_hash = ? AND deps_hash = ?
              AND lean_version = ? AND mathlib_version = ? LIMIT 1""",
            (lean_hash, deps, lean_version, mathlib_version),
        ).fetchone()
        if not row:
            return None
        self._conn.execute(
            """UPDATE verification SET last_used_at = ?
            WHERE lean_hash = ? AND deps_hash = ?
              AND lean_version = ? AND mathlib_version = ?""",
            (time.time(), lean_hash, deps, lean_version, mathlib_version),
        )
        status, lean_output, errors_json, elapsed_ms = row
        return VerificationHit(
            status=status,
            lean_output=lean_output,
            errors_json=errors_json,
            elapsed_ms=elapsed_ms,
        )

    def put_verification(
        self,
        lean_code: str,
        dep_lean_codes: list[str],
        lean_version: str,
        mathlib_version: str,
        status: str,
        lean_output: str,
        errors_json: str,
        elapsed_ms: int,
    ) -> None:
        lean_hash = _sha256(lean_code)
        deps = dep_hash(dep_lean_codes)
        size = len(lean_code) + len(lean_output) + len(errors_json)
        with self._tx() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO verification
                (lean_hash, deps_hash, lean_version, mathlib_version,
                 status, lean_output, errors_json, elapsed_ms, bytes, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    lean_hash,
                    deps,
                    lean_version,
                    mathlib_version,
                    status,
                    lean_output,
                    errors_json,
                    elapsed_ms,
                    size,
                    time.time(),
                ),
            )
        self._evict_if_needed()

    # ---------- Dependency cache ----------

    def get_dependency(
        self, target_hash: str, prev_hash: str, model: str
    ) -> list[str] | None:
        row = self._conn.execute(
            """SELECT deps_json FROM dependency
            WHERE target_hash = ? AND prev_hash = ? AND model = ? LIMIT 1""",
            (target_hash, prev_hash, model),
        ).fetchone()
        if not row:
            return None
        self._conn.execute(
            """UPDATE dependency SET last_used_at = ?
            WHERE target_hash = ? AND prev_hash = ? AND model = ?""",
            (time.time(), target_hash, prev_hash, model),
        )
        return json.loads(row[0])

    def put_dependency(
        self,
        target_hash: str,
        prev_hash: str,
        model: str,
        deps: list[str],
    ) -> None:
        deps_json = json.dumps(deps)
        size = len(deps_json)
        with self._tx() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO dependency
                (target_hash, prev_hash, model, deps_json, bytes, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (target_hash, prev_hash, model, deps_json, size, time.time()),
            )
        self._evict_if_needed()

    # ---------- Eviction ----------

    def _total_bytes(self) -> int:
        a = self._conn.execute("SELECT COALESCE(SUM(bytes), 0) FROM translation").fetchone()[0]
        b = self._conn.execute("SELECT COALESCE(SUM(bytes), 0) FROM verification").fetchone()[0]
        c = self._conn.execute("SELECT COALESCE(SUM(bytes), 0) FROM dependency").fetchone()[0]
        return int(a) + int(b) + int(c)

    def _evict_if_needed(self) -> None:
        total = self._total_bytes()
        if total <= self.max_bytes:
            return
        # Trim by LRU across all tables.
        with self._tx() as cur:
            while total > self.max_bytes:
                t = cur.execute(
                    "SELECT norm_hash, last_used_at, bytes FROM translation "
                    "ORDER BY last_used_at LIMIT 1"
                ).fetchone()
                v = cur.execute(
                    "SELECT lean_hash, last_used_at, bytes FROM verification "
                    "ORDER BY last_used_at LIMIT 1"
                ).fetchone()
                d = cur.execute(
                    "SELECT target_hash, prev_hash, last_used_at, bytes FROM dependency "
                    "ORDER BY last_used_at LIMIT 1"
                ).fetchone()
                
                candidates = []
                if t: candidates.append(('translation', t[1], t[2], t[0]))
                if v: candidates.append(('verification', v[1], v[2], v[0]))
                if d: candidates.append(('dependency', d[2], d[3], (d[0], d[1])))
                
                if not candidates:
                    break
                
                oldest = min(candidates, key=lambda x: x[1])
                
                if oldest[0] == 'translation':
                    cur.execute("DELETE FROM translation WHERE norm_hash = ?", (oldest[3],))
                elif oldest[0] == 'verification':
                    cur.execute("DELETE FROM verification WHERE lean_hash = ?", (oldest[3],))
                else:
                    cur.execute("DELETE FROM dependency WHERE target_hash = ? AND prev_hash = ?", oldest[3])
                
                total -= int(oldest[2])
