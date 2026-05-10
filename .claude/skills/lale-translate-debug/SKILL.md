---
name: lale-translate-debug
description: When a Lean translation fails and the user wants to know why, use this skill. Categorizes the Lean error (unknown identifier / type mismatch / tactic failed / timeout), routes to the lean-translator subagent, and returns the next prompt to try — with a one-line rationale.
---

# /lale-translate-debug

The user pastes (or names a request_id for) a failing translation. You need:

- the original LaTeX (statement + proof)
- the Lean attempt that failed
- the Lean error output

If any are missing, ask before delegating.

Then:

```
Agent({
  subagent_type: "lean-translator",
  description: "Translation retry strategy",
  prompt: "<concrete LaTeX, Lean attempt, and error output>. Categorize per your rules and produce the next-attempt prompt. One-line rationale only — no narrative."
})
```

Surface: category name, recommended next prompt as a code block, and the one-line rationale. Do not call the Anthropic API yourself — you are producing the prompt that *would* be sent.
