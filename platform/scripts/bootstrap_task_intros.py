# -*- coding: utf-8 -*-
"""Дополняет task-intros.js безопасными вводными для заданий без записи."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from build_tasks import parse  # noqa: E402

INTRO_PATH = ROOT / "platform" / "static" / "task-intros.js"

TYPE_GOAL = {
    "определить вывод": "Научиться читать код построчно и предсказывать печать без запуска.",
    "дописать код": "Научиться дописывать недостающий фрагмент так, чтобы программа решала условие.",
    "исправить ошибку": "Научиться находить типичную ошибку и чинить её минимальным изменением.",
    "написать функцию": "Научиться оформить решение в виде функции с понятным контрактом.",
    "объяснить поведение": "Научиться объяснить, почему программа ведёт себя именно так.",
    "демо": "Научиться наблюдать поведение кода на живом запуске.",
    "квиз": "Закрепить понятия темы короткими вопросами с выбором ответа.",
}


def main() -> None:
    src = INTRO_PATH.read_text(encoding="utf-8")
    existing = set(re.findall(r'"(\d+\.\d+)"\s*:', src))
    entries: list[str] = []
    for topic in parse():
        for task in topic["tasks"]:
            tid = task["id"]
            if tid in existing:
                continue
            title = (task.get("title") or tid).replace("\\", "\\\\").replace('"', '\\"')
            topic_title = topic["title"].replace("\\", "\\\\").replace('"', '\\"')
            goal = TYPE_GOAL.get(task["type"], "Разобрать идею этапа и применить её в задании.")
            concepts = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", title)[:4] or [task["type"]]
            expl = (
                f"Этап <b>{title}</b> темы «{topic_title}». "
                "Сосредоточьтесь на идее, а не на запоминании готового ответа."
            )
            app = "Такой навык пригодится в следующих темах курса и в повседневной отладке."
            block = {
                "goal": goal,
                "concepts": concepts,
                "explanation": expl,
                "example": {
                    "code": 'print("пример")',
                    "explanation": "Учебный пример с другими данными, не копия задания.",
                },
                "application": app,
            }
            # Emit as JS object literal via json for strings/arrays, then tweak keys
            js = json.dumps(block, ensure_ascii=False, indent=2)
            js = js.replace('"goal":', "goal:")
            js = js.replace('"concepts":', "concepts:")
            js = js.replace('"explanation":', "explanation:")
            js = js.replace('"example":', "example:")
            js = js.replace('"code":', "code:")
            js = js.replace('"application":', "application:")
            entries.append(f'  "{tid}": {js}')

    print(f"missing={len(entries)} existing={len(existing)}")
    if not entries:
        return
    body = src.rstrip()
    if body.endswith("};"):
        body = body[:-2].rstrip()
    if not body.endswith(","):
        body += ","
    INTRO_PATH.write_text(body + "\n" + ",\n".join(entries) + "\n};\n", encoding="utf-8")
    print(f"updated {INTRO_PATH}")


if __name__ == "__main__":
    main()
