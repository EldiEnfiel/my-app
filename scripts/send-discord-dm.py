#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

import discord


def split_message(content: str, limit: int = 1900) -> list[str]:
    if len(content) <= limit:
        return [content]

    chunks: list[str] = []
    remaining = content
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break

        split_at = remaining.rfind("\n", 0, limit)
        if split_at <= 0:
            split_at = limit

        chunks.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip()

    return chunks


async def send_message(token: str, user_id: int, content: str) -> None:
    client = discord.Client(intents=discord.Intents.none())
    try:
        await client.login(token)
        owner = await client.fetch_user(user_id)
        dm_channel = await owner.create_dm()
        for chunk in split_message(content):
            await dm_channel.send(chunk)
    finally:
        await client.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", required=True)
    parser.add_argument("--user-id", required=True, type=int)
    parser.add_argument("--message-file", required=True)
    args = parser.parse_args()

    content = Path(args.message_file).read_text(encoding="utf-8")
    asyncio.run(send_message(args.token, args.user_id, content))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
