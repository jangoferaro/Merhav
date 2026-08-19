"""Live publishing adapters.

Each subclass documents the API and the credentials it needs. When credentials
are absent the adapter transparently delegates to the mock, so switching a
single platform to live never breaks the rest of the pipeline.

Publishing endpoints (as configured here):
  instagram : POST /{ig_user_id}/media  + /media_publish        (Graph API, IG_ACCESS_TOKEN)
  tiktok    : POST /v2/post/publish/video/init/                 (TIKTOK_ACCESS_TOKEN)
  x         : POST /2/tweets                                    (X_BEARER_TOKEN)
  youtube   : POST /upload/youtube/v3/videos                    (YOUTUBE_ACCESS_TOKEN)
  reddit    : POST /api/submit                                  (REDDIT_ACCESS_TOKEN)
  fanvue    : POST /v1/posts                                    (FANVUE_API_KEY)
"""
from __future__ import annotations

import json
import os
import urllib.request

from .mock import MockSocial, PROFILES


class HTTPSocial(MockSocial):
    endpoint = ""
    env_key = ""
    auth_style = "bearer"

    def __init__(self, platform: str, world=None):
        super().__init__(platform, world)
        self.token = os.environ.get(self.env_key, "")
        self.name = f"{platform}:live" if self.token else f"{platform}:mock"

    def _headers(self) -> dict:
        if self.auth_style == "bearer":
            return {"authorization": f"Bearer {self.token}", "content-type": "application/json"}
        return {"x-api-key": self.token, "content-type": "application/json"}

    def _body(self, persona: dict, media: dict, caption: str, meta: dict) -> dict:
        return {"caption": caption, "media_url": media.get("uri"), "handle": persona.get("handle")}

    def publish(self, persona: dict, media: dict, caption: str, meta: dict) -> dict:
        if not (self.token and self.endpoint):
            out = super().publish(persona, media, caption, meta)
            out["provider"] = f"{self.platform}:mock (missing {self.env_key})"
            return out
        req = urllib.request.Request(
            self.endpoint, method="POST", headers=self._headers(),
            data=json.dumps(self._body(persona, media, caption, meta)).encode())
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode() or "{}")
        except Exception as exc:
            return {"ok": False, "error": f"{exc.__class__.__name__}", "external_id": "",
                    "provider": f"{self.platform}:live"}
        eid = str(data.get("id") or data.get("post_id") or data.get("data", {}).get("id", ""))
        return {"ok": bool(eid), "external_id": eid, "url": data.get("permalink", ""),
                "provider": f"{self.platform}:live"}


class Instagram(HTTPSocial):
    env_key = "IG_ACCESS_TOKEN"
    def __init__(self, world=None):
        super().__init__("instagram", world)
        ig_id = os.environ.get("IG_USER_ID", "")
        self.endpoint = f"https://graph.facebook.com/v21.0/{ig_id}/media" if ig_id else ""


class TikTok(HTTPSocial):
    env_key = "TIKTOK_ACCESS_TOKEN"
    endpoint = "https://open.tiktokapis.com/v2/post/publish/video/init/"


class X(HTTPSocial):
    env_key = "X_BEARER_TOKEN"
    endpoint = "https://api.x.com/2/tweets"
    def _body(self, persona, media, caption, meta):
        return {"text": caption[:280]}


class YouTube(HTTPSocial):
    env_key = "YOUTUBE_ACCESS_TOKEN"
    endpoint = "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status"
    def _body(self, persona, media, caption, meta):
        return {"snippet": {"title": caption.split("\n")[0][:95], "description": caption,
                            "tags": meta.get("hashtags", [])},
                "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False}}


class Reddit(HTTPSocial):
    env_key = "REDDIT_ACCESS_TOKEN"
    endpoint = "https://oauth.reddit.com/api/submit"
    def _body(self, persona, media, caption, meta):
        return {"sr": meta.get("subreddit", "test"), "kind": "image",
                "title": caption.split("\n")[0][:290], "url": media.get("uri")}


class Fanvue(HTTPSocial):
    """Age-gated subscription destination — the only tier that may receive
    adult-tier assets, and only when the operator enabled that tier."""
    env_key = "FANVUE_API_KEY"
    endpoint = "https://api.fanvue.com/v1/posts"
    auth_style = "apikey"
    def _body(self, persona, media, caption, meta):
        return {"text": caption, "media": [media.get("uri")],
                "visibility": meta.get("visibility", "subscribers"),
                "price": meta.get("ppv_price", 0)}


LIVE = {"instagram": Instagram, "tiktok": TikTok, "x": X, "youtube": YouTube,
        "reddit": Reddit, "fanvue": Fanvue}


def build(platform: str, world=None, mode: str = "mock"):
    if mode == "live" and platform in LIVE:
        return LIVE[platform](world)
    return MockSocial(platform, world)


ALL_PLATFORMS = list(PROFILES)
