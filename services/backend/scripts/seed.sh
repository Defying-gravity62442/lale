#!/usr/bin/env bash
# End-to-end smoke: hit /verify_paper with a 3-claim fixture and stream the SSE events.
# Run with the backend on port 8765.
set -euo pipefail

URL="${LALE_BACKEND_URL:-http://localhost:8765}"

REQ_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

# Quoted heredoc — backslashes pass through literally so the JSON below is taken verbatim.
read -r -d '' BODY <<'JSON' || true
{
  "requestId": "__REQ__",
  "targetClaimId": "thm:main",
  "leanVersion": "4.13.0",
  "mathlibVersion": "local",
  "claims": [
    {
      "id": "def:topo",
      "type": "definition",
      "label": "def:topo",
      "startLine": 1,
      "endLine": 3,
      "statementLatex": "A topological space is a pair (X, t) where t is closed under arbitrary unions and finite intersections.",
      "hashLatex": "h1",
      "hashNormalized": "n1",
      "status": "unverified"
    },
    {
      "id": "lem:union",
      "type": "lemma",
      "label": "lem:union",
      "startLine": 5,
      "endLine": 8,
      "statementLatex": "If a family of open sets is given, their union is open. See \\ref{def:topo}.",
      "proofLatex": "Direct from the definition. See \\ref{def:topo}.",
      "hashLatex": "h2",
      "hashNormalized": "n2",
      "status": "unverified"
    },
    {
      "id": "thm:main",
      "type": "theorem",
      "label": "thm:main",
      "startLine": 10,
      "endLine": 14,
      "statementLatex": "Every open cover of a compact set has a finite subcover. See \\ref{lem:union} and \\ref{def:topo}.",
      "proofLatex": "Apply \\ref{lem:union} and \\ref{def:topo}.",
      "hashLatex": "h3",
      "hashNormalized": "n3",
      "status": "unverified"
    }
  ]
}
JSON

BODY="${BODY/__REQ__/$REQ_ID}"

echo "POST ${URL}/verify_paper  request_id=${REQ_ID}"
echo "---"
curl -N -s "${URL}/verify_paper" \
  -H 'content-type: application/json' \
  -d "${BODY}"
echo
echo "---"
echo "GET ${URL}/status/${REQ_ID}"
curl -s "${URL}/status/${REQ_ID}" | python3 -m json.tool
