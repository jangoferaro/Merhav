"""Analyse an inspiration given as a link.

Accepted links:
  * a direct font file (.ttf / .otf / .woff / .woff2)
  * a Google Fonts page (fonts.google.com/specimen/...) or CSS link
  * any CSS file or web page that uses a web font (its @font-face rules)
  * an image of letters

Downloads are size-limited and never go to private/internal addresses.
Nothing is stored.
"""

from __future__ import annotations

import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from .analyze import MAX_FONT_BYTES, AnalyzeError, analyze
from .image_analyze import analyze_image

TIMEOUT = 15
MAX_PAGE_BYTES = 3 * 1024 * 1024
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
FONT_MAGIC = (b"\x00\x01\x00\x00", b"OTTO", b"wOFF", b"wOF2", b"true")
IMAGE_MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF", b"BM")


def _check_url(url: str) -> str:
    try:
        u = urllib.parse.urlsplit(url.strip())
    except ValueError as e:
        raise AnalyzeError("הקישור לא תקין") from e
    if u.scheme not in ("http", "https") or not u.hostname:
        raise AnalyzeError("צריך קישור שמתחיל ב-http או https")
    if u.port not in (None, 80, 443):
        raise AnalyzeError("הקישור מפנה לפורט לא נתמך")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))
    except socket.gaierror as e:
        raise AnalyzeError("לא הצלחתי למצוא את האתר בקישור") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified):
            raise AnalyzeError("הקישור מפנה לכתובת פנימית — לא ניתן להוריד ממנה")
    return urllib.parse.urlunsplit(u)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SafeRedirect)


def download(url: str, limit: int, ua: str = UA):
    url = _check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
    try:
        with _opener.open(req, timeout=TIMEOUT) as r:
            ctype = (r.headers.get("Content-Type") or "").lower()
            data = r.read(limit + 1)
            final = r.geturl()
    except urllib.error.HTTPError as e:
        raise AnalyzeError(f"האתר החזיר שגיאה ({e.code})") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise AnalyzeError("לא הצלחתי להוריד מהקישור") from e
    if len(data) > limit:
        raise AnalyzeError("הקובץ בקישור גדול מדי")
    return ctype, data, final


# ---------------------------------------------------------------------------
# CSS / HTML parsing
# ---------------------------------------------------------------------------

FACE_RE = re.compile(r"@font-face\s*{([^}]*)}", re.I | re.S)
URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)(?:\s*format\(\s*['\"]?([\w-]+))?", re.I)


def _prop(block, name):
    m = re.search(rf"{name}\s*:\s*([^;]+)", block, re.I)
    return m.group(1).strip().strip("'\"") if m else ""


def _covers_hebrew(urange: str) -> bool | None:
    if not urange:
        return None
    for part in urange.split(","):
        part = part.strip().upper().replace("U+", "")
        try:
            if "-" in part:
                a, b = part.split("-", 1)
                lo, hi = int(a, 16), int(b, 16)
            elif "?" in part:
                lo, hi = int(part.replace("?", "0"), 16), int(part.replace("?", "F"), 16)
            else:
                lo = hi = int(part, 16)
        except ValueError:
            continue
        if lo <= 0x05D0 <= hi:
            return True
    return False


def font_faces(css: str, base: str):
    faces = []
    for block in FACE_RE.findall(css):
        srcs = [(urllib.parse.urljoin(base, u), (f or "").lower()) for u, f in URL_RE.findall(block)]
        srcs = [s for s in srcs if not s[0].startswith("data:")]
        if not srcs:
            continue
        order = {"woff2": 0, "woff": 1, "truetype": 2, "opentype": 2}
        srcs.sort(key=lambda s: order.get(s[1], 3 if not s[0].lower().endswith((".woff2", ".woff", ".ttf", ".otf")) else 1))
        weight = _prop(block, "font-weight").split()[0] if _prop(block, "font-weight") else "400"
        try:
            w = int(weight)
        except ValueError:
            w = 700 if weight == "bold" else 400
        faces.append({
            "family": _prop(block, "font-family"),
            "weight": w,
            "italic": "italic" in _prop(block, "font-style").lower(),
            "hebrew": _covers_hebrew(_prop(block, "unicode-range")),
            "url": srcs[0][0],
        })

    def score(f):
        return ({True: 0, None: 1, False: 2}[f["hebrew"]], f["italic"], abs(f["weight"] - 400))
    faces.sort(key=score)
    return [f for f in faces if f["hebrew"] is not False] or faces


def _stylesheets(html: str, base: str):
    links = []
    for tag in re.findall(r"<link\b[^>]*>", html, re.I):
        if re.search(r"rel\s*=\s*['\"]?[^'\">]*stylesheet", tag, re.I):
            m = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
            if m:
                links.append(urllib.parse.urljoin(base, m.group(1)))
    inline = "\n".join(re.findall(r"<style\b[^>]*>(.*?)</style>", html, re.I | re.S))
    return links[:10], inline


def _google_css_url(url: str) -> str | None:
    u = urllib.parse.urlsplit(url)
    if u.hostname and u.hostname.endswith("fonts.google.com"):
        m = re.search(r"/specimen/([^/?#]+)", u.path)
        if m:
            fam = urllib.parse.unquote(m.group(1)).replace("+", " ")
            return "https://fonts.googleapis.com/css2?family=" + urllib.parse.quote(fam)
    return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _is_font(data, ctype):
    return data[:4] in FONT_MAGIC or "font" in ctype


def _is_image(data, ctype):
    return ctype.startswith("image/") or data[:4] in IMAGE_MAGIC


def _try_faces(faces, note):
    errors = []
    for f in faces[:5]:
        try:
            _c, data, _u = download(f["url"], MAX_FONT_BYTES)
            result = analyze(data)
            result["source"]["family"] = result["source"]["family"] or f["family"]
            result["source"]["url"] = f["url"]
            if note:
                result["note"] = note
            return result
        except AnalyzeError as e:
            errors.append(str(e))
    if errors:
        raise AnalyzeError(errors[0])
    raise AnalyzeError("לא מצאתי פונט עם אותיות עבריות בקישור")


def analyze_url(url: str, text: str = "") -> dict:
    url = (url or "").strip()
    if not url:
        raise AnalyzeError("לא הוזן קישור")
    if "://" not in url:
        url = "https://" + url
    url = _google_css_url(url) or url

    ctype, data, final = download(url, max(MAX_FONT_BYTES, MAX_PAGE_BYTES))
    if _is_font(data, ctype):
        result = analyze(data)
        result["source"]["url"] = final
        return result
    if _is_image(data, ctype):
        result = analyze_image(data, text)
        result["source"]["url"] = final
        return result

    body = data[:MAX_PAGE_BYTES].decode("utf-8", "replace")
    if "text/css" in ctype or "@font-face" in body[:20000]:
        return _try_faces(font_faces(body, final), "")

    # an ordinary web page: collect fonts from its stylesheets
    links, inline = _stylesheets(body, final)
    faces = font_faces(inline, final)
    for css_url in links:
        try:
            _c, css, css_final = download(css_url, MAX_PAGE_BYTES)
        except AnalyzeError:
            continue
        css_text = css.decode("utf-8", "replace")
        faces.extend(font_faces(css_text, css_final))
        for imp in re.findall(r"@import\s+(?:url\()?['\"]?([^'\")\s;]+)", css_text)[:3]:
            try:
                _c, sub, sub_final = download(urllib.parse.urljoin(css_final, imp), MAX_PAGE_BYTES)
                faces.extend(font_faces(sub.decode("utf-8", "replace"), sub_final))
            except AnalyzeError:
                continue
    if not faces:
        raise AnalyzeError("לא מצאתי פונטים בעמוד הזה. נסו קישור ישיר לקובץ הפונט או לעמוד ב-Google Fonts")
    faces.sort(key=lambda f: ({True: 0, None: 1, False: 2}[f["hebrew"]], f["italic"], abs(f["weight"] - 400)))
    families = sorted({f["family"] for f in faces if f["family"]})
    note = ("בעמוד נמצאו כמה פונטים: " + ", ".join(families[:6]) + ". נותח הראשון שתומך בעברית."
            if len(families) > 1 else "")
    return _try_faces(faces, note)


def fetch_font(url: str):
    """Download a whole font file from a link, for editing. Returns (bytes, url)."""
    from fontTools.ttLib import TTFont
    import io as _io

    url = (url or "").strip()
    if not url:
        raise AnalyzeError("לא הוזן קישור")
    if "://" not in url:
        url = "https://" + url
    google = _google_css_url(url)
    if google or "fonts.googleapis.com" in url:
        # a plain client gets one complete TTF instead of per-script woff2 slices
        ctype, data, final = download(google or url, MAX_PAGE_BYTES, ua="FontStudio/1.0")
    else:
        ctype, data, final = download(url, max(MAX_FONT_BYTES, MAX_PAGE_BYTES))
    if _is_font(data, ctype):
        return data, final
    if _is_image(data, ctype):
        raise AnalyzeError("הקישור מוביל לתמונה. כדי לערוך צריך קובץ פונט; תמונה אפשר להעלות בלשונית השראה")
    body = data[:MAX_PAGE_BYTES].decode("utf-8", "replace")
    if "text/css" in ctype or "@font-face" in body[:20000]:
        faces = font_faces(body, final)
    else:
        links, inline = _stylesheets(body, final)
        faces = font_faces(inline, final)
        for css_url in links:
            try:
                _c, css, css_final = download(css_url, MAX_PAGE_BYTES)
                faces.extend(font_faces(css.decode("utf-8", "replace"), css_final))
            except AnalyzeError:
                continue
    for f in faces[:6]:
        try:
            _c, fdata, furl = download(f["url"], MAX_FONT_BYTES)
            cmap = TTFont(_io.BytesIO(fdata), lazy=True).getBestCmap() or {}
            if any(0x05D0 <= cp <= 0x05EA for cp in cmap):
                return fdata, furl
        except Exception:
            continue
    raise AnalyzeError("לא מצאתי בקישור קובץ פונט עם אותיות עבריות")
