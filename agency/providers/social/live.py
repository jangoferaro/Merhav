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
import re
import urllib.request

from .mock import MockSocial, PROFILES


def slug(handle: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(handle).lower()).strip("_")


class HTTPSocial(MockSocial):
    """One platform, many accounts.

    A fleet of personas means a fleet of accounts, each with its own token, so
    credentials are resolved per persona at publish time:

        TIKTOK_ACCESS_TOKEN__talia_ford   ← this persona's account
        TIKTOK_ACCESS_TOKEN               ← fallback, for a single-account setup

    A persona with no token of its own falls back to the mock and says which
    variable is missing, so nine live accounts are not held up by the tenth.
    """
    platform_name = "generic"
    endpoint = ""
    env_key = ""
    auth_style = "bearer"

    def __init__(self, world=None):
        super().__init__(self.platform_name, world)
        self.token = os.environ.get(self.env_key, "")
        self.name = f"{self.platform}:live" if self.token else f"{self.platform}:mock"

    def token_for(self, handle: str) -> str:
        return (os.environ.get(f"{self.env_key}__{slug(handle)}", "")
                or os.environ.get(self.env_key, ""))

    def env_var_for(self, handle: str) -> str:
        return f"{self.env_key}__{slug(handle)}"

    def _headers(self, token: str) -> dict:
        if self.auth_style == "bearer":
            return {"authorization": f"Bearer {token}", "content-type": "application/json"}
        return {"x-api-key": token, "content-type": "application/json"}

    def _body(self, persona: dict, media: dict, caption: str, meta: dict) -> dict:
        return {"caption": caption, "media_url": media.get("uri"), "handle": persona.get("handle")}

    def endpoint_for(self, persona: dict) -> str:
        return self.endpoint

    def publish(self, persona: dict, media: dict, caption: str, meta: dict) -> dict:
        token = self.token_for(persona.get("handle", ""))
        endpoint = self.endpoint_for(persona)
        if not (token and endpoint):
            out = super().publish(persona, media, caption, meta)
            out["provider"] = (f"{self.platform}:mock (set "
                               f"{self.env_var_for(persona.get('handle', ''))})")
            return out
        req = urllib.request.Request(
            endpoint, method="POST", headers=self._headers(token),
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
    """Graph API needs the account id as well as the token, both per persona."""
    platform_name = "instagram"
    env_key = "IG_ACCESS_TOKEN"

    def endpoint_for(self, persona: dict) -> str:
        handle = persona.get("handle", "")
        ig_id = (os.environ.get(f"IG_USER_ID__{slug(handle)}", "")
                 or os.environ.get("IG_USER_ID", ""))
        return f"https://graph.facebook.com/v21.0/{ig_id}/media" if ig_id else ""


class TikTok(HTTPSocial):
    platform_name = "tiktok"
    env_key = "TIKTOK_ACCESS_TOKEN"
    endpoint = "https://open.tiktokapis.com/v2/post/publish/video/init/"


class X(HTTPSocial):
    platform_name = "x"
    env_key = "X_BEARER_TOKEN"
    endpoint = "https://api.x.com/2/tweets"
    def _body(self, persona, media, caption, meta):
        return {"text": caption[:280]}


class YouTube(HTTPSocial):
    platform_name = "youtube"
    env_key = "YOUTUBE_ACCESS_TOKEN"
    endpoint = "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status"
    def _body(self, persona, media, caption, meta):
        return {"snippet": {"title": caption.split("\n")[0][:95], "description": caption,
                            "tags": meta.get("hashtags", [])},
                "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False}}


class Reddit(HTTPSocial):
    platform_name = "reddit"
    env_key = "REDDIT_ACCESS_TOKEN"
    endpoint = "https://oauth.reddit.com/api/submit"
    def _body(self, persona, media, caption, meta):
        return {"sr": meta.get("subreddit", "test"), "kind": "image",
                "title": caption.split("\n")[0][:290], "url": media.get("uri")}


class Fanvue(HTTPSocial):
    """Age-gated subscription destination — the only tier that may receive
    adult-tier assets, and only when the operator enabled that tier."""
    platform_name = "fanvue"
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
