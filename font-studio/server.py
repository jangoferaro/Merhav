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
        self._send(code, json.dumps({"error": msg}).encode(), "application/json")

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

    def do_POST(self):
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


def main():
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0" if "PORT" in os.environ else "127.0.0.1")
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Font Studio running at http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
