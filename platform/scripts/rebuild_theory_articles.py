#!/usr/bin/env python3
"""Достроить BODIES 26–50 и пересобрать theory-articles-*.js."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from theory_article_bodies import BODIES  # noqa: E402

FOCUS = {
    26: ("Протокол итератора", "iter и next", "StopIteration и for", "Одноразовость"),
    27: ("yield вместо return", "Состояние между вызовами", "Generator expression", "Когда генератор лучше списка"),
    28: ("Обёртка функции", "Синтаксис @", "*args и **kwargs в wrapper", "Сохранение результата"),
    29: ("Захват переменных", "nonlocal для изменения", "Фабрики функций", "Счётчики состояния"),
    30: ("with как контракт", "__enter__ и __exit__", "Гарантия очистки", "contextlib"),
    31: ("Класс и экземпляр", "__init__ и self", "Атрибуты класса vs экземпляра", "__repr__"),
    32: ("Наследование методов", "super()", "Переопределение", "Полиморфизм"),
    33: ("Протокол операций", "__add__ и арифметика", "__eq__ и сравнения", "__len__ и контейнеры"),
    34: ("Метод как атрибут", "Геттер без скобок", "Сеттер и валидация", "Инкапсуляция"),
    35: ("Меньше шаблона", "Поля и defaults", "__init__/__repr__/__eq__", "Когда dataclass уместен"),
    36: ("Подсказки для людей и инструментов", "list[int] и | None", "Не проверка в runtime", "__annotations__"),
    37: ("Имена и объекты", "copy vs deepcopy", "Побочные эффекты alias", "Когда копировать"),
    38: ("Свои типы ошибок", "Наследование от Exception", "raise и except своего типа", "Сообщения"),
    39: ("O-нотация", "Вложенные циклы", "list vs set для in", "Выбор структуры"),
    40: ("start:stop:step", "Отрицательные индексы", "Копия срезом", "Срезы списков и строк"),
    41: ("Параллельный обход zip", "enumerate с номерами", "dict(zip(...))", "Без range(len)"),
    42: ("Мини-язык после двоеточия", "Ширина и нули", "Дроби и проценты", "format и f-строки"),
    43: ("Counter для частот", "most_common", "defaultdict", "Фабрика default_factory"),
    44: ("Имена snake_case", "Отступы и пробелы", "pip install", "requirements.txt"),
    45: ("Path вместо строк", "Оператор /", "name stem suffix", "Чтение и запись"),
    46: ("random для игр", "choice и shuffle", "secrets для токенов", "Не путать задачи"),
    47: ("Шаблоны re", "findall и search", "Группы", "sub замена"),
    48: ("Строки таблицы", "reader и DictReader", "Типы из CSV — строки", "writer"),
    49: ("sys.argv", "argparse основы", "Флаги и help", "Позиционные аргументы"),
    50: ("CONNECT и курсор", "CREATE/INSERT/SELECT", "Плейсхолдеры ?", ":memory: и файлы"),
}


def node_json(script: str):
    return json.loads(
        subprocess.check_output(["node", "-e", script], cwd=str(ROOT), text=True, encoding="utf-8")
    )


def strip_html(s: str) -> str:
    s = s.replace("<br><br>", "\n\n").replace("<br>", "\n")
    return re.sub(r"</?b>", "", s)


def clean_example(example: str) -> str:
    lines = []
    for line in example.splitlines():
        if re.search(r"#\s*[\[\{\"'0-9TrueFalseNone]", line):
            line = re.sub(r"\s+#.*$", "", line)
        lines.append(line)
    return "\n".join(lines).strip() or "print('ok')"


def build_extra(theory: dict, titles: dict) -> dict[int, dict]:
    extra: dict[int, dict] = {}
    for i in range(26, 51):
        if i in BODIES:
            continue
        t = theory[i]
        title = titles[i]
        teaser = strip_html(t["text"])
        example = clean_example(t.get("example") or "print('ok')")
        focuses = FOCUS[i]
        paras = [p.strip() for p in re.split(r"\n\s*\n", teaser) if p.strip()]
        if len(paras) == 1:
            bits = re.split(r"(?<=[.!?])\s+", paras[0])
            paras = [" ".join(bits[j : j + 2]).strip() for j in range(0, len(bits), 2) if bits[j : j + 2]]
        tails = [
            f"\n\nВ теме «{title}» держите контракт конструкции: вход → действие → результат.",
            "\n\nСверьте синтаксис с примером и проговорите роль каждой строки.",
            "\n\nНе смешивайте идею с соседней темой: при странном результате упростите пример до трёх строк.",
            "\n\nСначала ясное решение, потом — более короткая запись при необходимости.",
        ]
        sections = []
        for idx, ft in enumerate(focuses):
            base = paras[idx] if idx < len(paras) else paras[-1]
            sec = {"title": ft, "text": base + tails[min(idx, 3)], "examples": []}
            if idx <= 1:
                sec["examples"] = [
                    {
                        "code": example,
                        "explanation": f"Учебный пример по теме «{title}».",
                    }
                ]
            sections.append(sec)
        codes = re.findall(r"<code>([^<]+)</code>", t["text"])
        summary = [f"Ключевой элемент: <code>{c}</code>." for c in list(dict.fromkeys(codes))[:3]]
        while len(summary) < 4:
            summary.append(f"Закрепите «{title}» на данных, отличных от примера.")
        extra[i] = {
            "sections": sections,
            "mistakes": [
                {
                    "title": "Смешение с соседним приёмом",
                    "text": f"Используйте идеи темы «{title}», а не похожую конструкцию из прошлой темы.",
                },
                {
                    "title": "Копирование без изменения данных",
                    "text": "Замените входные значения — иначе нет проверки понимания.",
                },
                {
                    "title": "Игнор traceback",
                    "text": "Имя исключения указывает, где ломается контракт операции.",
                },
            ],
            "applications": [
                f"Задания и квизы курса по теме «{title}».",
                "Чтение стандартной библиотеки и чужого кода.",
                "Небольшие скрипты и учебные проекты.",
            ],
            "summary": summary[:5],
        }
    return extra


def expand_lead(title: str, teaser: str) -> str:
    base = re.sub(r"\s+", " ", strip_html(teaser)).strip()
    if len(base) > 420:
        base = base[:417].rsplit(" ", 1)[0] + "…"
    return (
        f"{base} Ниже — разбор темы «{title}»: модель, синтаксис, ошибки и практика. "
        "Примеры с другими данными, чем в заданиях."
    )


def article(topic_id: int, title: str, theory: dict, titles: dict, bodies: dict) -> dict:
    short = theory[topic_id]
    body = bodies.get(topic_id)
    if not body:
        raise KeyError(topic_id)
    prev_id, next_id = topic_id - 1, topic_id + 1
    prev = f"← Тема {prev_id}: {titles.get(prev_id, '')}" if prev_id >= 0 else None
    nxt = f"Тема {next_id}: {titles.get(next_id, '')} →" if next_id <= 50 else None
    if prev and len(prev) > 48:
        prev = f"← Тема {prev_id}"
    if nxt and len(nxt) > 48:
        nxt = f"Тема {next_id} →"
    return {
        "id": topic_id,
        "title": re.sub(r"`([^`]+)`", r"\1", title),
        "lead": expand_lead(title, short["text"]),
        "sections": body["sections"],
        "mistakes": body["mistakes"],
        "applications": body["applications"],
        "summary": body["summary"],
        "prev": prev,
        "next": nxt,
    }


def write_bundle(path: Path, ids: range, articles: dict[int, dict], label: str) -> None:
    parts = [f"  {i}: {json.dumps(articles[i], ensure_ascii=False, indent=2)}" for i in ids]
    path.write_text(
        f"/* {path.name} — развёрнутые теоретические статьи для тем {label} */\n"
        "window.THEORY_ARTICLES = Object.assign(window.THEORY_ARTICLES || {}, {\n"
        + ",\n".join(parts)
        + "\n});\n",
        encoding="utf-8",
    )
    print(f"wrote {path.name} ({path.stat().st_size} bytes)")


def main() -> None:
    theory = {int(k): v for k, v in node_json(
        "const fs=require('fs');const vm=require('vm');const c={window:{}};vm.createContext(c);"
        "vm.runInContext(fs.readFileSync('platform/static/theory.js','utf8'),c);"
        "process.stdout.write(JSON.stringify(c.window.THEORY));"
    ).items()}
    titles = {int(k): v for k, v in node_json(
        "const fs=require('fs');const vm=require('vm');const c={window:{}};vm.createContext(c);"
        "vm.runInContext(fs.readFileSync('platform/static/tasks.js','utf8'),c);"
        "process.stdout.write(JSON.stringify(Object.fromEntries(c.window.TASKS.map(t=>[t.id,t.title]))));"
    ).items()}

    bodies = dict(BODIES)
    bodies.update(build_extra(theory, titles))
    missing = sorted(set(range(13, 51)) - set(bodies))
    if missing:
        raise SystemExit(f"missing bodies: {missing}")

    out = Path(__file__).resolve().parent / "theory_article_bodies_26_50.py"
    extra_only = {k: bodies[k] for k in range(26, 51)}
    out.write_text(
        "# -*- coding: utf-8 -*-\n# Автодополнение BODIES 26–50\nBODIES_EXTRA = "
        + json.dumps(extra_only, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    articles = {i: article(i, titles[i], theory, titles, bodies) for i in range(13, 51)}
    static = ROOT / "platform" / "static"
    write_bundle(static / "theory-articles-13-25.js", range(13, 26), articles, "13–25")
    write_bundle(static / "theory-articles-26-39.js", range(26, 40), articles, "26–39")
    write_bundle(static / "theory-articles-40-50.js", range(40, 51), articles, "40–50")


if __name__ == "__main__":
    main()
