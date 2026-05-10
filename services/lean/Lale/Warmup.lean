/-
Warmup module for the lale Lean LSP pool.

Each worker opens this file once on startup so that `import Mathlib` is paid exactly
once per worker process, instead of being paid per verification. Subsequent claim
checks reuse the imported environment.

Keep this file tiny. The point is to force the heavy import; nothing more.
-/
import Mathlib

namespace Lale

theorem warmup : True := trivial

end Lale
