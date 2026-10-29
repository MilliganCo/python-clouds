# -*- coding: utf-8 -*-
"""Инвентаризация тем: квизы, челленджи, слабые «определить вывод».

Запуск из корня репозитория:
    python platform/scripts/audit_topics.py
    python platform/scripts/audit_topics.py --write platform/docs/topic_audit.md
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from build_tasks import parse, _load_support_content  # noqa: E402

def challenge_topics() -> set[int]:
    """Активные челленджи, а не устаревший ручной список."""
    source = (ROOT / "platform" / "static" / "challenges.js").read_text(encoding="utf-8")
    return {int(topic_id) for topic_id in re.findall(r'id: "C\d+\.1", topicId: (\d+)', source)}


def _weak_prediction(task: dict) -> list[str]:
    """Эвристики «слабого» определить-вывод."""
    flags: list[str] = []
    if task.get("type") != "определить вывод":
        return flags

    code = (task.get("code") or "").strip()
    prompt = (task.get("prompt") or "").strip()
    wrong = task.get("wrong") or []
    answer = (task.get("answer") or "").strip()
    explanation = (task.get("explanation") or "").strip()

    if len(code.splitlines()) <= 2 and "import" not in code:
        flags.append("короткий код (<=2 строки)")

    if wrong:
        norm = [w.strip() for w in wrong]
        if len(norm) != len(set(norm)):
            flags.append("дубли в ошибочных вариантах")

    blob = f"{prompt}\n{explanation}".lower()
    if re.search(r"\b(random|secrets)\b", code) and not re.search(
        r"seed|крипто|воспроизвод|предсказ", blob
    ):
        flags.append("random/secrets без объяснения seed/криптостойкости")

    if not explanation or len(explanation) < 40:
        flags.append("короткое объяснение")

    if answer and wrong and all(answer == w for w in wrong[:1]):
        flags.append("ответ совпадает с distractor")

    # педагогика: один print без контекста
    if code.count("print(") == 1 and len(code) < 60 and "?" not in prompt:
        flags.append("тривиальный одиночный print")

    return flags


def _intro_leaks(task: dict, intro: dict | None) -> list[str]:
    """Утечки ответа / кода задания во вводной этапа."""
    if not intro:
        return []
    flags: list[str] = []
    answer = (task.get("answer") or "").strip()
    code = (task.get("code") or "").strip()
    blob_parts = [
        str(intro.get("text") or ""),
        str(intro.get("explanation") or ""),
        str(intro.get("goal") or ""),
        str(intro.get("application") or ""),
    ]
    ex = intro.get("example")
    if isinstance(ex, dict):
        blob_parts.append(str(ex.get("code") or ""))
        blob_parts.append(str(ex.get("explanation") or ""))
    elif isinstance(ex, str):
        blob_parts.append(ex)
    blob = "\n".join(blob_parts)

    if answer and len(answer) >= 3 and re.search(rf"(?m)^{re.escape(answer)}$", blob):
        flags.append("точный ответ встречается во вводной")
    elif answer and len(answer) >= 8 and answer in blob and answer not in (intro.get("goal") or ""):
        # длинный ответ как подстрока (короткие вроде None/True дают ложные срабатывания в названиях)
        flags.append("точный ответ встречается во вводной")
    if code and len(code) >= 12 and code in blob:
        flags.append("полный код задания повторяется во вводной")
    # комментарии с готовым выводом
    if re.search(r"#\s*<class '|#\s*True\b|#\s*False\b|#\s*\[|#\s*\d", blob):
        flags.append("комментарий примера похож на готовый вывод")
    return flags


def audit_topics() -> dict:
    topics = parse()
    support = _load_support_content()
    intros = support.get('intros') or {}
    active_challenges = challenge_topics()
    rows = []
    weak = []
    leaks = []
    coverage_issues = []

    for topic in topics:
        tid = topic["id"]
        tasks = topic["tasks"]
        types: dict[str, int] = {}
        quizzes = []
        multi_quizzes = []
        for t in tasks:
            types[t["type"]] = types.get(t["type"], 0) + 1
            if t["type"] == "квиз":
                quizzes.append(t["id"])
                if t.get("questions"):
                    multi_quizzes.append(t["id"])

        last = tasks[-1] if tasks else None
        has_challenge = tid in active_challenges
        finales = [task for task in tasks if task.get('finale')]
        if [task.get('finale') for task in tasks[-2:]] != [1, 2] or len(finales) != 2:
            coverage_issues.append({'topic_id': tid, 'reason': 'Нужны ровно два обязательных финала 1/2 в конце темы'})
        for task in finales:
            check = task.get('check') or {}
            if not (check.get('append') and check.get('expect') and task.get('hint')):
                coverage_issues.append({'topic_id': tid, 'reason': f"{task['id']}: нет проверки или подсказки финала"})
        article = (support.get('theory') or {}).get(str(tid)) or {}
        examples = [example for section in article.get('sections', []) for example in section.get('examples', [])]
        if not examples:
            coverage_issues.append({'topic_id': tid, 'reason': 'Нет статьи с примерами'})
        if any('output' not in example and not (example.get('codeLanguage') == 'shell' and example.get('resultNote')) for example in examples):
            coverage_issues.append({'topic_id': tid, 'reason': 'Пример без результата или пояснения shell-команды'})
        row = {
            "id": tid,
            "title": topic["title"],
            "level": topic["levelRu"],
            "tasks": len(tasks),
            "last_id": last["id"] if last else None,
            "last_type": last["type"] if last else None,
            "types": types,
            "quizzes": quizzes,
            "multi_quizzes": multi_quizzes,
            "has_challenge": has_challenge,
            "quiz_before_challenge": bool(multi_quizzes) if has_challenge else None,
            "required_finales": [task['id'] for task in finales],
            "quiz_questions": sum(len(task.get('questions') or []) or (task['type'] == 'квиз') for task in tasks),
            "theory_examples": len(examples),
        }
        rows.append(row)

        for t in tasks:
            flags = _weak_prediction(t)
            if flags:
                # короткий код — только info, не «ошибка» сам по себе
                weak.append({"id": t["id"], "title": t.get("title", ""), "flags": flags})
            leak_flags = _intro_leaks(t, intros.get(t["id"]))
            if leak_flags:
                leaks.append({"id": t["id"], "title": t.get("title", ""), "flags": leak_flags})

    return {"topics": rows, "weak_predictions": weak, "intro_leaks": leaks, "coverage_issues": coverage_issues}


def render_markdown(data: dict) -> str:
    lines = [
        "# Аудит тем курса",
        "",
        "Сгенерировано `platform/scripts/audit_topics.py`.",
        "",
        "## Стандарт конца темы",
        "",
        "Обычные этапы (включая квиз, если он есть) → два обязательных финала из Markdown.",
        "Боссы C*.1 — необязательная дополнительная практика, не условие завершения темы.",
        "Инвентаризация не доказывает понятность объяснений, однозначность вариантов или качество обучения.",
        "",
        f"Всего: {len(data['topics'])} тем, {sum(row['tasks'] for row in data['topics'])} этапов, "
        f"{sum(len(row['required_finales']) for row in data['topics'])} финалов, "
        f"{sum(row['quiz_questions'] for row in data['topics'])} вопросов квизов, "
        f"{sum(row['theory_examples'] for row in data['topics'])} примера теории.",
        "",
        "## Сводка по темам",
        "",
        "| Тема | Этапов | Финалы | Квизы | Вопросов | Примеров | Доп. босс |",
        "|------|--------|--------|-------|----------|----------|-----------|",
    ]
    for r in data["topics"]:
        q = ", ".join(r["quizzes"]) if r["quizzes"] else "—"
        ch = "да" if r["has_challenge"] else "—"
        finales = ', '.join(r['required_finales']) or '—'
        lines.append(
            f"| {r['id']}. {r['title']} | {r['tasks']} | {finales} | {q} | {r['quiz_questions']} | {r['theory_examples']} | {ch} |"
        )

    lines.extend(['', '## Пробелы структурного покрытия', ''])
    issues = data['coverage_issues']
    lines.extend([f"- **Тема {issue['topic_id']}**: {issue['reason']}" for issue in issues] or ['_Не найдено; это не редакторская приёмка._'])

    lines.extend([
        "",
        "## Подозрительные «определить вывод»",
        "",
        "_Флаг «короткий код» — информационный, не автоматический дефект._",
        "",
    ])
    if not data["weak_predictions"]:
        lines.append("_Не найдено._")
    else:
        for w in data["weak_predictions"]:
            flags = "; ".join(w["flags"])
            lines.append(f"- **{w['id']}** {w['title']}: {flags}")

    lines.extend([
        "",
        "## Утечки ответов во вводных",
        "",
    ])
    leaks = data.get("intro_leaks") or []
    if not leaks:
        lines.append("_Не найдено._")
    else:
        for w in leaks:
            flags = "; ".join(w["flags"])
            lines.append(f"- **{w['id']}** {w['title']}: {flags}")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Аудит тем курса")
    parser.add_argument("--write", metavar="PATH", help="Сохранить markdown-отчёт")
    parser.add_argument("--json", action="store_true", help="Вывести JSON в stdout")
    args = parser.parse_args()

    data = audit_topics()

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        md = render_markdown(data)
        print(md)
        if args.write:
            out = Path(args.write)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding="utf-8")
            print(f"\nЗаписано: {out}", file=sys.stderr)

    if data['coverage_issues']:
        print(f"\nПробелы структурного покрытия: {len(data['coverage_issues'])}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
