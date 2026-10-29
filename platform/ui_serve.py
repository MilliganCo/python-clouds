# -*- coding: utf-8 -*-
"""Serving React dist / legacy fallback / Pyodide proxy (cutover-prep)."""
from __future__ import annotations

import urllib.error
import urllib.request
import re
import mimetypes
from pathlib import Path
import content_generation

from flask import Response, abort, current_app, jsonify, request, send_from_directory

from execution_policy import EXECUTION_DISABLED_MESSAGE, EXECUTION_ERROR_CODE

PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full"
_CACHE_HTML = "no-cache"
_CACHE_HASHED = "public, max-age=31536000, immutable"
_CACHE_PYODIDE = "public, max-age=86400"


def _safe_under(root: Path, relative: str) -> Path | None:
    """Resolve relative path under root; None if traversal or missing."""
    if not relative or relative.startswith(("/", "\\")) or ".." in Path(relative).parts:
        return None
    target = (root / relative).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target if target.is_file() else None


def _ui_mode() -> str:
    return current_app.config.get("PYCLOUD_UI", "legacy")


def _base() -> Path:
    return Path(current_app.config["PYCLOUD_BASE"])


def _legacy_root() -> Path:
    return Path(current_app.config["PYCLOUD_LEGACY_STATIC"])


def _dist() -> Path:
    return (_base() / "frontend" / "dist").resolve()


def register_ui_routes(app, *, ui_mode: str, base: Path, legacy_static: Path, content_snapshot=None) -> None:
    """Register / , /assets, /legacy, /pyodide, and react public files."""
    app.config["PYCLOUD_UI"] = ui_mode
    app.config["PYCLOUD_BASE"] = str(base.resolve())
    app.config["PYCLOUD_LEGACY_STATIC"] = str(Path(legacy_static).resolve())

    def selected():
        if content_snapshot is None or _legacy_root().resolve()!=(content_snapshot.base/'static').resolve():return None
        return content_snapshot

    def bytes_response(name,data,cache):
        kind={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'}.get(Path(name).suffix)
        resp=Response(data,mimetype=kind or mimetypes.guess_type(name)[0] or 'application/octet-stream')
        resp.headers['Cache-Control']=cache
        return resp

    def selected_html():
        snap=selected()
        if snap is None:return None
        html=snap.text('index.html')
        if snap.generation:
            prefix='/'+content_generation.PUBLIC_DIR+'/'+snap.generation+'/'
            def resource(match):
                name=match[3]
                return match[1]+match[2]+prefix+name+match[2] if name in snap.public else match[0]
            html=re.sub(r'(?<![\w-])((?:src|href)=)([\'\"])([^\'\"]+)\2',resource,html)
            html=html.replace('</head>',f'<meta name="pycloud-content-generation" content="{snap.generation}"></head>',1)
        else:
            # Clean-checkout/first-adoption compatibility: coherent captured flat set.
            html=re.sub(r'<script\s+[^>]*src=[\'\"]catalogue-loader.js[\'\"][^>]*>\s*</script>','',html)
            # Diagnostics stay optional; normal captured scripts still boot directly.
            html=html.replace('</head>','<script src="catalogue-loader.js" data-course-loader data-load-report-only async></script></head>',1)
            html=re.sub(r'<script\s+type="application/x-pycloud-script"\s+data-course-src="([^\"]+)"\s*>\s*</script>',r'<script src="\1"></script>',html)
        response=bytes_response('index.html',html.encode('utf-8'),_CACHE_HTML)
        response.headers['X-Pycloud-Content-Generation']=snap.generation or 'legacy'
        return response

    @app.before_request
    def block_unisolated_runtime():
        path = request.path.replace("\\", "/").lower()
        name = path.rsplit("/", 1)[-1].rstrip(" .")
        if name == "runner-worker.js" or path.startswith("/pyodide/"):
            resp = jsonify(error=EXECUTION_DISABLED_MESSAGE, code=EXECUTION_ERROR_CODE)
            resp.status_code = 503
            resp.headers["Cache-Control"] = "no-store"
            return resp

    @app.before_request
    def captured_flat_assets():
        snap=selected()
        if snap is None or _ui_mode()!='legacy':return None
        name=request.path.removeprefix('/legacy/').lstrip('/') if request.path.startswith('/legacy/') else request.path.lstrip('/')
        if name in ('','index.html'):return None
        if name in snap.public:
            return bytes_response(name,snap.public[name],_CACHE_HTML)
        if name==content_generation.POINTER:
            try:data=content_generation.read_atomic_bytes(_legacy_root()/name)
            except OSError:abort(503)
            return bytes_response(name,data,'no-store')

    def _send_html(directory: Path, name: str = "index.html"):
        resp = send_from_directory(directory, name)
        resp.headers["Cache-Control"] = _CACHE_HTML
        return resp

    @app.get("/")
    @app.get('/index.html')
    def index():
        if _ui_mode() == "react":
            return _send_html(_dist())
        return selected_html() or _send_html(_legacy_root())

    @app.get('/course-content/<generation>/<path:filename>')
    def content_asset(generation,filename):
        try:
            root,manifest=content_generation.public_manifest(_base(),generation)
            if filename=='manifest.json':return bytes_response(filename,content_generation.canonical(manifest),_CACHE_HASHED)
            if filename not in manifest['sha256']:abort(404)
            data=content_generation.safe_file(root,filename).read_bytes()
            if content_generation.sha(data)!=manifest['sha256'][filename]:abort(503)
            return bytes_response(filename,data,_CACHE_HASHED)
        except (content_generation.ContentError,OSError):abort(404)

    @app.get("/assets/<path:filename>")
    def react_assets(filename: str):
        if _ui_mode() != "react":
            abort(404)
        root = _dist() / "assets"
        path = _safe_under(root, filename)
        if path is None:
            abort(404)
        resp = send_from_directory(root, filename)
        resp.headers["Cache-Control"] = _CACHE_HASHED
        return resp

    @app.get("/runner-worker.js")
    def react_runner_worker():
        """Vite copies public/runner-worker.js into dist root."""
        if _ui_mode() == "react":
            root = _dist()
            name = "runner-worker.js"
        else:
            root = _legacy_root()
            name = "runner-worker.js"
        path = _safe_under(root, name)
        if path is None:
            abort(404)
        resp = send_from_directory(root, name)
        resp.headers["Cache-Control"] = _CACHE_HTML
        return resp

    @app.get("/legacy/")
    @app.get("/legacy/<path:filename>")
    def legacy_ui(filename: str = "index.html"):
        """Emergency legacy shell under /legacy/ (relative asset URLs work)."""
        if filename.endswith("/") or filename == "":
            filename = "index.html"
        if filename=='index.html':
            response=selected_html()
            if response is not None:return response
        snap=selected()
        if snap is not None and filename in snap.public:return bytes_response(filename,snap.public[filename],_CACHE_HTML)
        root = _legacy_root()
        path = _safe_under(root, filename)
        if path is None:
            abort(404)
        resp = send_from_directory(root, filename)
        if filename == "index.html" or filename.endswith(".html"):
            resp.headers["Cache-Control"] = _CACHE_HTML
        return resp

    @app.get("/pyodide/<path:filename>")
    def pyodide_proxy(filename: str):
        """Same-origin Pyodide assets for COEP (ADR worker delivery)."""
        if not filename or ".." in Path(filename).parts or filename.startswith(("/", "\\")):
            abort(404)
        url = f"{PYODIDE_CDN}/{filename}"
        try:
            with urllib.request.urlopen(url, timeout=30) as upstream:  # noqa: S310
                data = upstream.read()
                content_type = upstream.headers.get_content_type() or "application/octet-stream"
        except urllib.error.HTTPError as exc:
            abort(exc.code if 400 <= exc.code < 600 else 502)
        except Exception:
            abort(502)
        resp = Response(data, mimetype=content_type)
        resp.headers["Cache-Control"] = _CACHE_PYODIDE
        resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        return resp
