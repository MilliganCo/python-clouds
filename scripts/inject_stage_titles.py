# -*- coding: utf-8 -*-
"""Вставляет **Название:** во все задания python_tasks_collection.md
из scripts/stage_titles.json. Идемпотентно.

Запуск: python scripts/inject_stage_titles.py
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MD = ROOT / "python_tasks_collection.md"
TITLES = ROOT / "scripts" / "stage_titles.json"


def _load_build_tasks():
    spec = importlib.util.spec_from_file_location("build_tasks", ROOT / "build_tasks.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    titles = json.loads(TITLES.read_text(encoding="utf-8"))
    # id по порядку парсера (источник правды)
    expected_ids = [t["id"] for topic in _load_build_tasks().parse() for t in topic["tasks"]]
    text = MD.read_text(encoding="utf-8")
    parts = re.split(r"(?=\n### Задание )", text)

    task_parts = []
    prefix = parts[0]
    for part in parts[1:]:
        if part.lstrip().startswith("### Задание "):
            task_parts.append(part)
        else:
            prefix += part  # не должно случаться

    if len(task_parts) != len(expected_ids):
        print(
            f"ERROR: заданий в md={len(task_parts)}, в парсере={len(expected_ids)}",
            file=sys.stderr,
        )
        sys.exit(1)

    updated = 0
    new_parts = []
    for part, task_id in zip(task_parts, expected_ids):
        title = titles.get(task_id)
        if not title:
            print(f"WARN: нет названия для {task_id}", file=sys.stderr)
            new_parts.append(part)
            continue
        if re.search(r"\*\*Название:\*\*", part):
            new_part = re.sub(
                r"\*\*Название:\*\*[^\n]*",
                f"**Название:** {title}",
                part,
                count=1,
            )
        else:
            new_part = re.sub(
                r"(\*\*Тип задания:\*\*[^\n]*\n)",
                rf"\1\n**Название:** {title}\n",
                part,
                count=1,
            )
            if new_part == part:
                print(f"WARN: не нашли Тип задания в {task_id}", file=sys.stderr)
        if new_part != part:
            updated += 1
        new_parts.append(new_part)

    MD.write_text(prefix + "".join(new_parts), encoding="utf-8")
    print(f"OK: названий записано/обновлено: {updated} / {len(expected_ids)}")


if __name__ == "__main__":
    main()
