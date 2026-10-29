#!/usr/bin/env python3
"""Emit theory-articles-13-25/26-39/40-50.js from articles_*.py modules."""
from __future__ import annotations

import json
from pathlib import Path

from articles_13_25 import ARTICLES as A13
from articles_26_39 import ARTICLES as A26
from articles_40_50 import ARTICLES as A40

ROOT = Path(__file__).resolve().parents[3]
STATIC = ROOT / "platform" / "static"


def dump_js(path: Path, articles: dict, label: str) -> None:
    parts = []
    for tid in sorted(articles):
        parts.append(f"  {tid}: {json.dumps(articles[tid], ensure_ascii=False, indent=2)}")
    body = ",\n".join(parts)
    text = (
        f"/* {path.name} — развёрнутые теоретические статьи для тем {label} */\n"
        "window.THEORY_ARTICLES = Object.assign(window.THEORY_ARTICLES || {}, {\n"
        f"{body}\n"
        "});\n"
    )
    path.write_text(text, encoding="utf-8")
    print(f"{path.name}: {len(articles)} topics, {path.stat().st_size} bytes")


def main() -> None:
    dump_js(STATIC / "theory-articles-13-25.js", A13, "13–25")
    dump_js(STATIC / "theory-articles-26-39.js", A26, "26–39")
    dump_js(STATIC / "theory-articles-40-50.js", A40, "40–50")


if __name__ == "__main__":
    main()
