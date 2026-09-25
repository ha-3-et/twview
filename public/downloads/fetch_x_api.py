#!/usr/bin/env python3
"""
X API v2から投稿を取得して、このアプリで読み込めるJSONとして保存するサンプルです。

準備:
  PowerShell:
    $env:X_BEARER_TOKEN = "YOUR_BEARER_TOKEN"

例:
  python fetch_x_api.py --query "from:YamakawaTeruki" --limit 500 --out yamakawa.json
  python fetch_x_api.py --username YamakawaTeruki --limit 500 --out yamakawa.json
  python fetch_x_api.py --user-id 1234567890 --limit 500 --out user_tweets.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


API_BASE = "https://api.x.com/2"

TWEET_FIELDS = ",".join([
    "attachments",
    "author_id",
    "conversation_id",
    "created_at",
    "entities",
    "in_reply_to_user_id",
    "lang",
    "possibly_sensitive",
    "public_metrics",
    "referenced_tweets",
    "source",
])

EXPANSIONS = ",".join([
    "author_id",
    "attachments.media_keys",
    "referenced_tweets.id",
    "referenced_tweets.id.author_id",
    "referenced_tweets.id.attachments.media_keys",
])

MEDIA_FIELDS = ",".join([
    "alt_text",
    "duration_ms",
    "height",
    "media_key",
    "preview_image_url",
    "public_metrics",
    "type",
    "url",
    "variants",
    "width",
])

USER_FIELDS = ",".join([
    "created_at",
    "description",
    "entities",
    "id",
    "location",
    "name",
    "profile_banner_url",
    "profile_image_url",
    "protected",
    "public_metrics",
    "url",
    "username",
    "verified",
    "verified_type",
])


def request_json(url: str, bearer_token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    if params:
        url = f"{url}?{urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})}"

    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {bearer_token}",
            "User-Agent": "tweet-importer-json-fetcher/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"X API error {exc.code}: {body}") from exc


def merge_by_key(existing: list[dict[str, Any]], incoming: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for item in existing + incoming:
        item_key = item.get(key)
        if item_key is not None:
            merged[str(item_key)] = item
    return list(merged.values())


def merge_page(combined: dict[str, Any], page: dict[str, Any]) -> None:
    page_data = page.get("data") or []
    if isinstance(page_data, dict):
        page_data = [page_data]
    combined.setdefault("data", []).extend(page_data)

    combined_includes = combined.setdefault("includes", {})
    page_includes = page.get("includes") or {}
    for name, key in {"users": "id", "tweets": "id", "media": "media_key", "polls": "id", "places": "id"}.items():
        current = combined_includes.get(name) or []
        incoming = page_includes.get(name) or []
        if incoming:
            combined_includes[name] = merge_by_key(current, incoming, key)

    errors = page.get("errors") or []
    if errors:
        combined.setdefault("errors", []).extend(errors)


def common_params(max_results: int, pagination_token: str | None = None) -> dict[str, Any]:
    return {
        "max_results": max_results,
        "pagination_token": pagination_token,
        "tweet.fields": TWEET_FIELDS,
        "expansions": EXPANSIONS,
        "media.fields": MEDIA_FIELDS,
        "user.fields": USER_FIELDS,
    }


def lookup_user_id(username: str, bearer_token: str) -> str:
    user = request_json(
        f"{API_BASE}/users/by/username/{urllib.parse.quote(username)}",
        bearer_token,
        {"user.fields": USER_FIELDS},
    )
    try:
        return str(user["data"]["id"])
    except KeyError as exc:
        raise RuntimeError(f"ユーザーIDを取得できませんでした: {json.dumps(user, ensure_ascii=False)}") from exc


def fetch_pages(endpoint: str, bearer_token: str, params: dict[str, Any], limit: int, sleep_seconds: float) -> dict[str, Any]:
    combined: dict[str, Any] = {"data": [], "includes": {}, "meta": {}}
    next_token: str | None = None

    while len(combined["data"]) < limit:
        page_params = dict(params)
        if next_token:
            page_params["pagination_token"] = next_token

        page = request_json(endpoint, bearer_token, page_params)
        merge_page(combined, page)

        meta = page.get("meta") or {}
        next_token = meta.get("next_token")
        combined["meta"] = {"result_count": len(combined["data"]), "next_token": next_token}

        if not next_token:
            break
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)

    combined["data"] = combined["data"][:limit]
    combined["meta"]["result_count"] = len(combined["data"])
    return combined


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch X API v2 posts and save app-compatible JSON.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--query", help="Recent search query. Example: 'from:YamakawaTeruki'")
    mode.add_argument("--username", help="Fetch tweets by username. Example: YamakawaTeruki")
    mode.add_argument("--user-id", help="Fetch tweets by numeric user id.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum posts to save. Default: 100")
    parser.add_argument("--page-size", type=int, default=100, help="API max_results per request. Default: 100")
    parser.add_argument("--out", default="x-api-export.json", help="Output JSON path. Default: x-api-export.json")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds to wait between paginated requests. Default: 1.0")
    args = parser.parse_args()

    bearer_token = os.environ.get("X_BEARER_TOKEN") or os.environ.get("BEARER_TOKEN")
    if not bearer_token:
        print("環境変数 X_BEARER_TOKEN にBearer Tokenを設定してください。", file=sys.stderr)
        return 2

    page_size = max(5, min(args.page_size, 100))
    if args.query:
        endpoint = f"{API_BASE}/tweets/search/recent"
        params = common_params(page_size)
        params["query"] = args.query
    else:
        user_id = args.user_id or lookup_user_id(args.username, bearer_token)
        endpoint = f"{API_BASE}/users/{urllib.parse.quote(str(user_id))}/tweets"
        params = common_params(page_size)

    result = fetch_pages(endpoint, bearer_token, params, max(1, args.limit), max(0, args.sleep))

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"{len(result.get('data') or [])}件を書き出しました: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
