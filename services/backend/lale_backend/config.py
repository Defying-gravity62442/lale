"""Process-wide configuration loaded from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None
    lean_project_dir: Path | None
    lean_version: str
    mathlib_version: str
    translator_model: str
    diagnose_model: str
    lean_pool_size: int
    lean_timeout_seconds: float
    cache_db_path: Path
    cache_max_bytes: int
    semantic_review_enabled: bool = True
    strict_no_sorry: bool = True
    strict_no_axioms: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    pool_size_raw = os.getenv("LEAN_POOL_SIZE", "").strip()
    pool_size = int(pool_size_raw) if pool_size_raw else (os.cpu_count() or 2)

    project_dir_raw = os.getenv("LEAN_PROJECT_DIR", "").strip()
    project_dir = Path(project_dir_raw).expanduser().resolve() if project_dir_raw else None

    if project_dir is None:
        # Default to the bundled services/lean (sibling of services/backend).
        default = Path(__file__).resolve().parents[2] / "lean"
        project_dir = default if default.exists() else None

    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY") or None,
        lean_project_dir=project_dir,
        lean_version=os.getenv("LEAN_VERSION", "4.29.1"),
        mathlib_version=os.getenv("MATHLIB_VERSION", "local"),
        translator_model=os.getenv("TRANSLATOR_MODEL", "claude-sonnet-4-6"),
        diagnose_model=os.getenv("DIAGNOSE_MODEL", "claude-sonnet-4-6"),
        lean_pool_size=pool_size,
        lean_timeout_seconds=float(os.getenv("LEAN_TIMEOUT_SECONDS", "30")),
        cache_db_path=Path(os.getenv("CACHE_DB_PATH", "./cache.db")).expanduser(),
        cache_max_bytes=int(os.getenv("CACHE_MAX_BYTES", str(500 * 1024 * 1024))),
        semantic_review_enabled=os.getenv("SEMANTIC_REVIEW_ENABLED", "1") != "0",
        strict_no_sorry=os.getenv("STRICT_NO_SORRY", "1") != "0",
        strict_no_axioms=os.getenv("STRICT_NO_AXIOMS", "1") != "0",
    )
