---
name: lale-protocol-check
description: Audit the wire protocol for drift between Zod (packages/shared/src/protocol.ts) and Pydantic (services/backend/lale_backend/protocol.py). Use whenever a wire-shape change has happened on either side, before running end-to-end. Delegates to the protocol-sync subagent and surfaces the drift report.
---

# /lale-protocol-check

This is a one-line skill: spawn the `protocol-sync` subagent and relay its punch list.

Run:

```
Agent({
  subagent_type: "protocol-sync",
  description: "Protocol drift audit",
  prompt: "Audit packages/shared/src/protocol.ts (Zod) against services/backend/lale_backend/protocol.py (Pydantic). Report drift per the conventions in your agent definition. End with IN SYNC or DRIFT (N)."
})
```

Print the agent's response verbatim under a header. Do not improvise fixes — surface the drift first; the user decides which side to change.
