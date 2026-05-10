import asyncio
import httpx
import uuid
from lale_backend.protocol import Claim

async def main():
    claims = [
        Claim(
            id="claim_def",
            type="definition",
            start_line=1, end_line=5,
            statement_latex="We say (G,.) and (H,*) are isomorphic as groups if there is a bijection...",
            hash_latex="1", hash_normalized="1", status="unverified"
        ).model_dump(by_alias=True),
        Claim(
            id="claim_ex",
            type="example",
            start_line=6, end_line=10,
            statement_latex="The group is isomorphic because there is an isomorphism between them.",
            hash_latex="2", hash_normalized="2", status="unverified"
        ).model_dump(by_alias=True)
    ]
    
    req = {
        "requestId": str(uuid.uuid4()),
        "targetClaimId": "claim_ex",
        "claims": claims,
        "leanVersion": "4.29.1",
        "mathlibVersion": "local"
    }

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("POST", "http://localhost:8765/verify_paper", json=req) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    print(line[6:])

asyncio.run(main())
