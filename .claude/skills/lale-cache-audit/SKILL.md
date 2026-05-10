---
name: lale-cache-audit
description: Audit cache key construction in services/backend/lale_backend/cache.py and the call sites that use it. Use whenever cache hit rate seems low, before any release, or after editing cache.py. Catches the classic mistake of keying verification on LaTeX instead of Lean.
---

# /lale-cache-audit

Spawn the `cache-keys` subagent:

```
Agent({
  subagent_type: "cache-keys",
  description: "Cache key audit",
  prompt: "Audit services/backend/lale_backend/cache.py and the call sites in translator.py and orchestrator.py per your agent rules. Report per the format in your definition (`OK` or `ISSUES (N)`)."
})
```

Surface the report. If there are issues, ask the user before fixing — fixes change keys and invalidate the cache.
