import asyncio
import json
import os
from pathlib import Path
from lale_backend.config import get_settings
from lale_backend.cache import Cache
from lale_backend.dependency_extractor import DependencyExtractor
from lale_backend.protocol import Claim
import logging

logging.basicConfig(level=logging.INFO)

async def main():
    settings = get_settings()
    cache = Cache(settings.cache_db_path, settings.cache_max_bytes)
    extractor = DependencyExtractor(settings, cache)

    c1 = Claim(
        id="claim_def",
        type="definition",
        start_line=1, end_line=5,
        statement_latex="We say (G,.) and (H,*) are isomorphic as groups if there is a bijection...",
        hash_latex="1", hash_normalized="1", status="unverified"
    )
    c2 = Claim(
        id="claim_ex",
        type="example",
        start_line=6, end_line=10,
        statement_latex="The group is isomorphic because there is an isomorphism between them.",
        hash_latex="2", hash_normalized="2", status="unverified"
    )
    
    deps = await extractor.extract_dependencies(1, [c1, c2])
    print(f"Dependencies of claim 2: {deps}")

asyncio.run(main())
