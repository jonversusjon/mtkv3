"""Asset checks for the built frontend as served by the Flask app.

Fails (raises AssetCheckError) when:
  * index.html references an asset that the server does not serve (non-200),
  * a script/style asset is answered with an HTML document (the SPA fallback
    masquerading as JavaScript), or the Content-Type is not JS/CSS,
  * index.html itself is not HTML, or references no assets at all.
Status 200 alone is deliberately NOT sufficient.
"""
import re
from typing import Callable, List, Tuple

# fetch(path) -> (status_code, content_type, body_bytes)
Fetch = Callable[[str], Tuple[int, str, bytes]]

JS_TYPES = ("text/javascript", "application/javascript")
CSS_TYPES = ("text/css",)
_ATTR = re.compile(r'(?:src|href)="([^"]+)"')


class AssetCheckError(AssertionError):
    pass


_COMMENT = re.compile(rb"<!--.*?-->|/\*.*?\*/", re.S)
_HTML_START = re.compile(rb"<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]", re.I)


def _looks_like_html(body: bytes) -> bool:
    """True if the payload is an HTML document, even when prefixed by a BOM,
    whitespace, or leading comments."""
    head = body[:4096]
    for bom in (b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff"):
        if head.startswith(bom):
            head = head[len(bom):]
    head = head.replace(b"\x00", b"")  # UTF-16 payloads
    prev = None
    while prev != head:  # strip leading whitespace and comments repeatedly
        prev = head
        head = head.lstrip()
        m = _COMMENT.match(head)
        if m:
            head = head[m.end():]
    return bool(_HTML_START.match(head))


def _wanted_types(url: str) -> Tuple[str, ...]:
    path = re.split(r"[?#]", url)[0].lower()
    ext = path.rsplit(".", 1)[-1]
    return {
        "css": CSS_TYPES, "js": JS_TYPES, "mjs": JS_TYPES,
        "ico": ("image/x-icon", "image/vnd.microsoft.icon"),
        "png": ("image/png",), "jpg": ("image/jpeg",), "jpeg": ("image/jpeg",),
        "svg": ("image/svg+xml",),
        "json": ("application/json", "application/manifest+json"),
        "webmanifest": ("application/manifest+json", "application/json"),
    }[ext]


def referenced_assets(index_html: str) -> List[str]:
    out = []
    for m in _ATTR.finditer(index_html):
        url = m.group(1)
        if url.startswith(("http://", "https://", "//", "data:")):
            continue
        if re.search(r"\.(js|mjs|css|ico|png|jpe?g|svg|webmanifest|json)(\?|#|$)", url):
            out.append(url)
    return out


def check_assets(fetch: Fetch, index_path: str = "/") -> List[str]:
    status, ctype, body = fetch(index_path)
    if status != 200 or "text/html" not in ctype:
        raise AssetCheckError(f"index {index_path}: status={status} type={ctype}")
    assets = referenced_assets(body.decode("utf-8", "replace"))
    if not any(a.endswith((".js", ".mjs")) or ".js?" in a for a in assets):
        raise AssetCheckError("index.html references no JavaScript bundle")
    for url in assets:
        status, ctype, data = fetch(url)
        if status != 200:
            raise AssetCheckError(f"{url}: missing asset (status {status})")
        if _looks_like_html(data):
            raise AssetCheckError(f"{url}: HTML document returned for an asset ({ctype})")
        mime = ctype.split(";")[0].strip().lower()
        wanted = _wanted_types(url)
        if mime not in wanted:
            raise AssetCheckError(f"{url}: unexpected Content-Type {ctype!r}, want {wanted}")
        if not data:
            raise AssetCheckError(f"{url}: empty body")
    return assets


def flask_fetch(client) -> Fetch:
    def fetch(path):
        r = client.get(path)
        return r.status_code, r.content_type or "", r.data
    return fetch


def http_fetch(base: str) -> Fetch:
    import requests

    def fetch(path):
        r = requests.get(base + path, timeout=10)
        return r.status_code, r.headers.get("content-type", ""), r.content
    return fetch


if __name__ == "__main__":  # python asset_check.py http://127.0.0.1:5000
    import sys
    print("OK", check_assets(http_fetch(sys.argv[1].rstrip("/"))))
