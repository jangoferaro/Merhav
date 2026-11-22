"""Font Studio web server (Python standard library only + fontTools).

Run:  python server.py        then open http://localhost:8000
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine.analyze import MAX_FONT_BYTES, AnalyzeError, analyze  # noqa: E402
from engine.fetch import analyze_url, fetch_font  # noqa: E402
from engine import edit as fedit  # noqa: E402
import hashlib  # noqa: E402
import time  # noqa: E402
import zipfile  # noqa: E402
import io  # noqa: E402
from engine.image_analyze import MAX_IMAGE_BYTES, analyze_image  # noqa: E402
from urllib.parse import parse_qs, urlsplit  # noqa: E402
from engine.build import Params, build_variable, export_zip, to_bytes, _ps_name  # noqa: E402

STATIC = Path(__file__).resolve().parent / "static"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}
MAX_BODY = 16 * 1024


class LRU:
    def __init__(self, size=48):
        self.size, self.data, self.lock = size, OrderedDict(), threading.Lock()

    def get(self, key, make):
        with self.lock:
            if key in self.data:
                self.data.move_to_end(key)
                return self.data[key]
        value = make()
        with self.lock:
            self.data[key] = value
            while len(self.data) > self.size:
                self.data.popitem(last=False)
        return value


preview_cache = LRU()


class EditStore:
    """Fonts uploaded for editing, kept in memory only, for a limited time."""
    TTL = 45 * 60

    def __init__(self, size=8):
        self.size, self.lock = size, threading.Lock()
        self.fonts = OrderedDict()   # token -> (bytes, last_used)
        self.prepared = LRU(12)      # (token, base_wght) -> Prepared
        self.previews = LRU(24)

    def put(self, data: bytes) -> str:
        token = hashlib.sha256(data).hexdigest()[:32]
        with self.lock:
            self.fonts[token] = (data, time.time())
            self.fonts.move_to_end(token)
            while len(self.fonts) > self.size:
                self.fonts.popitem(last=False)
        return token

    def get(self, token: str):
        with self.lock:
            now = time.time()
            for t in [t for t, (_d, ts) in self.fonts.items() if now - ts > self.TTL]:
                del self.fonts[t]
            item = self.fonts.get(token)
            if item is None:
                return None
            self.fonts[token] = (item[0], now)
            return item[0]

    def prep(self, token: str, base_wght: float):
        data = self.get(token)
        if data is None:
            return None
        return self.prepared.get((token, base_wght), lambda: fedit.prepare(data, base_wght))


edit_store = EditStore()


class Handler(BaseHTTPRequestHandler):
    server_version = "FontStudio/1.0"

    def log_message(self, fmt, *args):  # quieter logs
        if os.environ.get("FONT_STUDIO_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, code, body: bytes, ctype: str, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self._send(code, json.dumps({"error": msg}, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        if path == "/healthz":
            return self._send(200, b"ok", "text/plain")
        name = path.lstrip("/")
        if not re.fullmatch(r"[\w\-]+\.(html|js|css|svg)", name):
            return self._error(404, "not found")
        f = STATIC / name
        if not f.is_file():
            return self._error(404, "not found")
        self._send(200, f.read_bytes(), TYPES[f.suffix], {"Cache-Control": "no-cache"})

    def _params(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("request too large")
        raw = self.rfile.read(n) if n else b"{}"
        return Params.from_dict(json.loads(raw or b"{}"))

    def _read_upload(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            raise AnalyzeError("לא התקבל קובץ")
        if n > limit:
            raise AnalyzeError("הקובץ גדול מדי (מעל 15MB)")
        return self.rfile.read(n)

    def _analyze(self, path, query):
        try:
            if path == "/api/analyze":
                result = analyze(self._read_upload(MAX_FONT_BYTES))
            elif path == "/api/analyze-image":
                text = (query.get("text") or [""])[0][:400]
                result = analyze_image(self._read_upload(MAX_IMAGE_BYTES), text)
            else:  # /api/analyze-url
                body = json.loads(self._read_upload(MAX_BODY) or b"{}")
                result = analyze_url(str(body.get("url", ""))[:2000], str(body.get("text", ""))[:400])
        except AnalyzeError as e:
            return self._error(422, str(e))
        except Exception:
            return self._error(422, "לא הצלחתי לנתח את ההשראה הזו")
        self._send(200, json.dumps(result, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _edit(self, path):
        try:
            if path == "/api/edit/upload":
                data = self._read_upload(MAX_FONT_BYTES)
                summary = fedit.font_summary(data)
                return self._json({"token": edit_store.put(data), "summary": summary})
            if path == "/api/edit/upload-url":
                body = json.loads(self._read_upload(MAX_BODY) or b"{}")
                data, final = fetch_font(str(body.get("url", ""))[:2000])
                summary = fedit.font_summary(data)
                summary["source_url"] = final
                return self._json({"token": edit_store.put(data), "summary": summary})
            body = json.loads(self._read_upload(MAX_BODY) or b"{}")
            token = str(body.get("token", ""))
            p = fedit.EditParams.from_dict(body.get("params") or {})
            prep = edit_store.prep(token, p.base_wght)
            if prep is None:
                return self._error(410, "expired")
            if path == "/api/edit/preview":
                data = edit_store.previews.get((token, p.key()), lambda: fedit.to_bytes(
                    fedit.apply_edit(prep, p, subset_codepoints=fedit.PREVIEW_CODEPOINTS)))
                return self._send(200, data, "font/ttf", {"Cache-Control": "no-store"})
            if path == "/api/edit/export":
                return self._edit_export(token, p, bool(body.get("confirm_rights")))
        except AnalyzeError as e:
            return self._error(422, str(e))
        except Exception as e:
            return self._error(500, f"העריכה נכשלה: {e}")
        return self._error(404, "not found")

    def _edit_export(self, token, p, confirmed):
        original = edit_store.get(token)
        summary = fedit.font_summary(original)
        lic = summary["license"]
        if not p.family:
            return self._error(400, "צריך לתת לפונט שם חדש (באנגלית)")
        old = (summary["family"] or "").lower().replace(" ", "")
        new = p.family.lower().replace(" ", "")
        if old and (new == old or old in new):
            return self._error(400, "השם החדש לא יכול לכלול את שם הפונט המקורי")
        for rn in lic["reserved_names"]:
            if rn.lower().replace(" ", "") in new:
                return self._error(400, f"השם \"{rn}\" שמור לפי רישיון הפונט — בחרו שם אחר")
        if not lic["free"] and not confirmed:
            return self._error(403, "צריך לאשר שיש לכם זכות לשנות את הפונט הזה")
        prep = edit_store.prep(token, p.base_wght)
        font = fedit.apply_edit(prep, p, remove_overlaps=True)
        ps_family, ps_style = fedit.rename(font, p.family)
        base = f"{ps_family}-{ps_style}"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"{base}.ttf", fedit.to_bytes(font))
            z.writestr(f"web/{base}.woff2", fedit.to_bytes(font, "woff2"))
            z.writestr("web/font.css", f"""@font-face {{
  font-family: "{p.family}";
  src: url("./{base}.woff2") format("woff2");
  font-display: swap;
}}
""")
            z.writestr("edit-settings.json", json.dumps({"source": summary["family"], **{k: v for k, v in vars(p).items()}}, ensure_ascii=False, indent=2))
            lic_line = (f"The original font is licensed under: {lic['kind']}. This modified version must be "
                        f"distributed under the same licence. Keep the licence file of the original font with it.\n"
                        f"Licence URL: {lic['url']}\n" if lic["free"] else
                        "You confirmed that you have the right to modify the original font. Check its licence "
                        "before distributing this modified version.\n")
            z.writestr("README.txt", f"""{p.family} — modified from "{summary['family']}" with Font Studio
{'=' * 60}

{base}.ttf          install on your computer / use in apps
web/{base}.woff2    for websites, with web/font.css
edit-settings.json  the settings that were used

Original copyright: {lic['copyright']}
{lic_line}""")
        fname = f"{ps_family}.zip"
        self._send(200, buf.getvalue(), "application/zip",
                   {"Content-Disposition": f'attachment; filename="{fname}"'})

    def _json(self, obj):
        self._send(200, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_POST(self):
        u = urlsplit(self.path)
        if u.path.startswith("/api/edit/"):
            return self._edit(u.path)
        if u.path in ("/api/analyze", "/api/analyze-image", "/api/analyze-url"):
            return self._analyze(u.path, parse_qs(u.query))
        try:
            p = self._params()
        except (ValueError, TypeError) as e:
            return self._error(400, f"bad parameters: {e}")
        try:
            if self.path == "/api/font":
                data = preview_cache.get(p.key(), lambda: to_bytes(build_variable(p)))
                return self._send(200, data, "font/ttf", {"Cache-Control": "no-store"})
            if self.path == "/api/export":
                data = export_zip(p)
                fname = f"{_ps_name(p.family)}.zip"
                return self._send(200, data, "application/zip",
                                  {"Content-Disposition": f'attachment; filename="{fname}"'})
        except Exception as e:  # report build failures to the UI
            return self._error(500, f"build failed: {e}")
        self._error(404, "not found")


def _lan_ip():
    """This computer's address on the local network (no data is sent)."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


def main():
    lan = "--lan" in sys.argv
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0" if (lan or "PORT" in os.environ) else "127.0.0.1")
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Font Studio running at http://localhost:{port}")
    if lan:
        ip = _lan_ip()
        print("Home-network mode: devices on the same Wi-Fi can open it.")
        print(f"On your phone, open:  http://{ip or '<this-computer-ip>'}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
