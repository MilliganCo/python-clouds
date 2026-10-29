#!/usr/bin/env python3
"""Сгенерировать theory-articles-*.js для тем 13–50 из THEORY + метаданных.

Качество: полноценная структура статьи (lead/sections/mistakes/...).
Запуск: python platform/scripts/generate_theory_articles.py
Не перезаписывает 0–12. Перезаписывает 13–25, 26–39, 40–50.
"""
from __future__ import annotations

import json
import re
import subprocess
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "platform" / "static"

# Расширенные материалы по темам: sections (title, bullets), mistakes, apps, summary, examples
EXTRA: dict[int, dict] = {}


def node_json(script: str):
    return json.loads(
        subprocess.check_output(
            ["node", "-e", script],
            cwd=str(ROOT),
            text=True,
            encoding="utf-8",
        )
    )


def load_theory() -> dict:
    return node_json(
        "const fs=require('fs');const vm=require('vm');"
        "const c={window:{}};vm.createContext(c);"
        "vm.runInContext(fs.readFileSync('platform/static/theory.js','utf8'),c);"
        "process.stdout.write(JSON.stringify(c.window.THEORY));"
    )


def load_titles() -> dict[int, str]:
    data = node_json(
        "const fs=require('fs');const vm=require('vm');"
        "const c={window:{}};vm.createContext(c);"
        "vm.runInContext(fs.readFileSync('platform/static/tasks.js','utf8'),c);"
        "process.stdout.write(JSON.stringify(Object.fromEntries("
        "c.window.TASKS.map(t=>[t.id,t.title]))));"
    )
    return {int(k): v for k, v in data.items()}


def strip_html(s: str) -> str:
    s = s.replace("<br><br>", "\n\n").replace("<br>", "\n")
    s = re.sub(r"</?b>", "", s)
    # keep code tags as-is for article text
    return s


def expand_lead(title: str, teaser: str) -> str:
    base = strip_html(teaser)
    # убрать интересный факт в lead? оставить кратко
    base = re.sub(r"\n+", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    if len(base) > 420:
        base = base[:417].rsplit(" ", 1)[0] + "…"
    return (
        f"{base} "
        f"Ниже — развёрнутый разбор темы «{title}»: модель в голове, синтаксис, "
        "типичные ошибки и где это встречается на практике. Примеры намеренно "
        "с другими данными, чем в заданиях курса."
    )


def section_pack(topic_id: int, title: str, teaser: str, example: str | None) -> list[dict]:
    """4–5 секций с развёрнутым текстом."""
    clean = strip_html(teaser)
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", clean) if p.strip()]
    if len(paragraphs) == 1:
        # split by sentences roughly
        bits = re.split(r"(?<=[.!?])\s+", paragraphs[0])
        paragraphs = [" ".join(bits[i : i + 2]).strip() for i in range(0, len(bits), 2) if bits[i : i + 2]]

    s1_text = paragraphs[0] if paragraphs else clean
    s1_text += (
        "\n\nДержите в голове простой образ: конструкция языка — это инструмент с "
        "понятным контрактом «вход → действие → результат». Пока контракт ясен, "
        "код читается как рассказ, а не как загадка."
    )

    s2_text = (
        paragraphs[1]
        if len(paragraphs) > 1
        else (
            f"В теме «{title}» важно отличать синтаксис от смысла. Синтаксис — "
            "как пишется конструкция; смысл — что она делает с данными и в каком порядке."
        )
    )
    s2_text += (
        "\n\nЧитайте примеры сверху вниз: сначала появляются имена и значения, "
        "потом операции, потом вывод. Так же работает интерпретатор."
    )

    s3_text = (
        paragraphs[2]
        if len(paragraphs) > 2
        else (
            "Типичный цикл обучения: маленький пример → изменение одного параметра → "
            "проверка вывода. Меняйте по одной детали за раз, иначе сложно понять причину."
        )
    )
    s3_text += (
        "\n\nЕсли результат неожиданный, проверьте типы объектов функцией "
        "<code>type()</code> и промежуточные значения через <code>print</code>."
    )

    s4_text = (
        "Связь с соседними темами курса помогает не учить приёмы изолированно: "
        "почти каждая конструкция опирается на переменные, вызовы функций и коллекции. "
        "Когда встречаете новую запись, спросите: «какой объект слева? какое действие? "
        "что возвращается?»\n\n"
        "На платформе автопроверка сравнивает вывод или возвращаемое значение с эталоном. "
        "Поэтому важно понимать, печатаете ли вы результат или возвращаете его из функции."
    )

    s5_text = (
        "Чек-лист перед отправкой решения: (1) имена не перекрывают встроенные, "
        "(2) отступы кратны четырём пробелам, (3) нет «магических» значений без смысла, "
        "(4) пример из теории прогнан мысленно на других данных. "
        f"Тема «{title}» закрепляется именно переносом идеи на новый ввод, а не копированием."
    )

    ex = example or "print('ok')"
    # убрать комментарии с готовыми ответами вида # 42
    ex_lines = []
    for line in ex.splitlines():
        if re.search(r"#\s*.+\S", line) and not re.search(r"#\s*(это|комментарий|новый|базовый|шаг|ловушка|локальная|файл)", line, re.I):
            # keep educational comments, strip answer-like short comments
            if re.search(r"#\s*[\[\{\"'0-9TrueFalseNone]", line):
                line = re.sub(r"\s+#.*$", "", line)
        ex_lines.append(line)
    ex = "\n".join(ex_lines).strip() or "print('ok')"

    return [
        {
            "title": "Модель в голове",
            "text": s1_text,
            "examples": [
                {
                    "code": ex,
                    "explanation": "Учебный пример по теме: проговорите, что произойдёт на каждой строке.",
                }
            ],
        },
        {
            "title": "Синтаксис и смысл",
            "text": s2_text,
            "examples": [
                {
                    "code": ex if "\n" in ex else f"value = 'demo'\nprint(value)",
                    "explanation": "Сравните с формулировкой задания: идея та же, данные другие.",
                }
            ],
        },
        {
            "title": "Как тренироваться",
            "text": s3_text,
            "examples": [],
        },
        {
            "title": "Связь с остальным курсом",
            "text": s4_text,
            "examples": [],
        },
        {
            "title": "Чек-лист перед практикой",
            "text": s5_text,
            "examples": [],
        },
    ]


def mistakes_for(title: str) -> list[dict]:
    return [
        {
            "title": "Путают похожие конструкции",
            "text": (
                f"В теме «{title}» легко смешать соседние приёмы языка. "
                "Сверьте документацию или короткий пример: одна лишняя скобка или "
                "другой метод часто меняют смысл целиком."
            ),
        },
        {
            "title": "Копируют пример без понимания",
            "text": (
                "Если пример работает только на одних данных, замените числа и строки "
                "и проверьте снова. Рабочий код без понимания быстро ломается на следующем этапе."
            ),
        },
        {
            "title": "Игнорируют сообщение об ошибке",
            "text": (
                "Traceback указывает тип ошибки и строку. Прочитайте имя исключения "
                "(<code>TypeError</code>, <code>NameError</code>, <code>ValueError</code>) — "
                "оно почти всегда подсказывает направление поиска."
            ),
        },
    ]


def applications_for(title: str) -> list[str]:
    return [
        f"Учебные задачи и квизы курса по теме «{title}».",
        "Чтение чужого кода и документация стандартной библиотеки.",
        "Небольшие скрипты и автоматизация повседневных действий.",
    ]


def summary_for(teaser: str) -> list[str]:
    clean = strip_html(teaser)
    # extract code tokens
    codes = re.findall(r"<code>([^<]+)</code>", teaser)
    points = []
    if codes:
        unique = []
        for c in codes:
            if c not in unique:
                unique.append(c)
        for c in unique[:3]:
            points.append(f"Ключевой элемент темы: <code>{c}</code>.")
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", clean) if len(s.strip()) > 20]
    for s in sentences[:2]:
        if len(s) > 140:
            s = s[:137].rsplit(" ", 1)[0] + "…"
        points.append(s)
    while len(points) < 4:
        points.append("Проверьте идею на других данных, прежде чем сдавать решение.")
    return points[:5]


def article(topic_id: int, title: str, theory: dict, titles: dict[int, str]) -> dict:
    short = theory.get(str(topic_id)) or theory.get(topic_id) or {}
    # theory keys may be int in JSON from node - actually string keys from Object
    if not short:
        for k, v in theory.items():
            if int(k) == topic_id:
                short = v
                break
    text = short.get("text") or f"Тема «{title}»."
    example = short.get("example")
    prev_id = topic_id - 1
    next_id = topic_id + 1
    prev = f"← Тема {prev_id}: {titles.get(prev_id, '')}".strip() if prev_id >= 0 else None
    nxt = f"Тема {next_id}: {titles.get(next_id, '')} →".strip() if next_id <= 50 else None
    # shorten titles in nav
    if prev and len(prev) > 48:
        prev = f"← Тема {prev_id}"
    if nxt and len(nxt) > 48:
        nxt = f"Тема {next_id} →"
    return {
        "id": topic_id,
        "title": re.sub(r"`([^`]+)`", r"\1", title),
        "lead": expand_lead(title, text),
        "sections": section_pack(topic_id, title, text, example),
        "mistakes": mistakes_for(title),
        "applications": applications_for(title),
        "summary": summary_for(text),
        "prev": prev,
        "next": nxt,
    }


def to_js_object(obj) -> str:
    """Compact-ish JS object literal via JSON (valid subset)."""
    return json.dumps(obj, ensure_ascii=False, indent=2)


def write_bundle(path: Path, ids: range, articles: dict[int, dict], label: str) -> None:
    parts = [f"  {i}: {to_js_object(articles[i])}" for i in ids]
    body = ",\n".join(parts)
    content = (
        f"/* {path.name} — развёрнутые теоретические статьи для тем {label} */\n"
        "window.THEORY_ARTICLES = Object.assign(window.THEORY_ARTICLES || {}, {\n"
        f"{body}\n"
        "});\n"
    )
    path.write_text(content, encoding="utf-8")
    print(f"wrote {path} ({len(list(ids))} articles, {path.stat().st_size} bytes)")


def main() -> None:
    theory = load_theory()
    # normalize keys to int
    theory_norm = {int(k): v for k, v in theory.items()}
    titles = load_titles()
    articles = {
        i: article(i, titles[i], theory_norm, titles)
        for i in range(13, 51)
    }
    write_bundle(STATIC / "theory-articles-13-25.js", range(13, 26), articles, "13–25")
    write_bundle(STATIC / "theory-articles-26-39.js", range(26, 40), articles, "26–39")
    write_bundle(STATIC / "theory-articles-40-50.js", range(40, 51), articles, "40–50")


if __name__ == "__main__":
    main()
