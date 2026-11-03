import asyncio
import json
import os

_slots = asyncio.Semaphore(4)


async def analyze_mood(file_path: str) -> dict | None:
    async with _slots:
        try:
            proc = await asyncio.create_subprocess_exec(
                os.environ.get("MOOD_BIN", "mood"), "analyze", "--json", file_path,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode != 0:
                return None
            result = json.loads(stdout)
        except (OSError, ValueError):
            return None
    if not isinstance(result, dict) or not result.get("mood"):
        return None
    return result
