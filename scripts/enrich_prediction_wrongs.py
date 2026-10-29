# -*- coding: utf-8 -*-
"""Генерирует блок **Ошибочные варианты:** для заданий «определить вывод».

Запуск из корня репозитория:
  python scripts/enrich_prediction_wrongs.py          # dry-run статистика
  python scripts/enrich_prediction_wrongs.py --write  # правка markdown
"""
from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build_tasks as bt  # noqa: E402

SRC = ROOT / "python_tasks_collection.md"


def _uniq(ans: str, candidates: list[str], limit: int = 3) -> list[str]:
    seen = {ans}
    out = []
    for c in candidates:
        c = str(c).rstrip("\n")
        if not c or c in seen:
            continue
        seen.add(c)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def _num_parts(ans: str) -> list[str] | None:
    if not re.fullmatch(r"-?[\d.]+(?: +-?[\d.]+)*", ans):
        return None
    return ans.split()


def from_numbers(ans: str, code: str) -> list[str]:
    parts = _num_parts(ans)
    if not parts:
        return []
    nums = [float(p) if "." in p else int(p) for p in parts]
    cands: list[str] = []

    def join(vals):
        out = []
        for v, sample in zip(vals, parts):
            if isinstance(sample, str) and "." in sample and isinstance(v, float):
                # сохранить вид с точкой, без лишних нулей где можно
                s = ("%g" % v) if v != int(v) or sample.endswith(".0") else str(int(v))
                if sample.endswith(".0") and "." not in s:
                    s = f"{int(v)}.0" if v == int(v) else s
                if sample.endswith(".0") and v == int(v):
                    s = f"{int(v)}.0"
                out.append(s)
            else:
                if isinstance(v, float) and v == int(v) and "." not in sample:
                    out.append(str(int(v)))
                elif isinstance(v, float):
                    out.append(("%g" % v))
                else:
                    out.append(str(v))
        return " ".join(out)

    # код-осознанные ловушки
    if "abs(" in code:
        # оставить знак у отрицательного ввода, если ответ положительный
        flipped = []
        for i, (n, p) in enumerate(zip(nums, parts)):
            if n > 0 and f"-{int(n) if n == int(n) else n}" in code.replace(" ", ""):
                flipped = list(nums)
                flipped[i] = -n
                cands.append(join(flipped))
                break
        if not flipped and len(nums) >= 2 and nums[-1] > 0:
            alt = list(nums)
            alt[-1] = -alt[-1]
            cands.append(join(alt))

    if "round(" in code:
        # без округления / «на глаз» вверх
        m = re.search(r"round\(([^,]+),\s*(\d+)\)", code)
        if m and len(nums) >= 1 and isinstance(nums[0], float):
            alt = list(nums)
            alt[0] = nums[0] + 0.01
            cands.append(join(alt))
            # игнор второго аргумента — показать больше знаков из литерала
            lit = re.search(r"round\((\d+\.\d+)", code)
            if lit:
                alt = list(nums)
                alt[0] = float(lit.group(1))
                cands.append(join(alt))

    if "//" in code and "/" in code.replace("//", ""):
        pass  # mixed — ниже общие

    if re.search(r"(?<!/)/(?!/)", code) and len(parts) == 1 and parts[0].endswith(".0"):
        cands.append(parts[0][:-2])  # 5.0 → 5
    if len(parts) == 1 and "." not in parts[0]:
        cands.append(parts[0] + ".0")

    # отрицательный // и %
    if "//" in code and any(n < 0 for n in nums):
        # «к нулю» вместо floor
        alt = list(nums)
        for i, n in enumerate(nums):
            if n < 0 and isinstance(n, int):
                alt[i] = -((-n))  # same; try trunc toward zero of a related op
        # типичная ошибка для -17//5: люди ждут -3
        if ans == "2 3 3 -4":
            cands.extend(["2 -2 3 -3", "2 3 3 -3", "-2 3 -3 -4"])

    # меняем один компонент
    for i, n in enumerate(nums):
        alt = list(nums)
        if n != 0:
            alt[i] = -n
            cands.append(join(alt))
        alt = list(nums)
        if isinstance(n, float) or (isinstance(n, int) is False):
            alt[i] = int(n) if n == int(n) else int(n)
            cands.append(join(alt))
        alt = list(nums)
        alt[i] = n + 1
        cands.append(join(alt))
        alt = list(nums)
        alt[i] = n - 1
        cands.append(join(alt))

    if len(parts) == 2:
        cands.append(f"{parts[1]} {parts[0]}")
    if len(parts) == 3:
        cands.append(f"{parts[0]} {parts[2]} {parts[1]}")

    return _uniq(ans, cands)


def from_bools(ans: str) -> list[str]:
    if not re.fullmatch(r"(True|False)(?: (True|False))*", ans):
        return []
    parts = ans.split()
    cands = []
    cands.append(" ".join("False" if p == "True" else "True" for p in parts))
    if len(parts) >= 2:
        alt = parts[:]
        alt[0] = "False" if alt[0] == "True" else "True"
        cands.append(" ".join(alt))
        alt = parts[:]
        alt[-1] = "False" if alt[-1] == "True" else "True"
        cands.append(" ".join(alt))
    if len(parts) >= 3:
        alt = parts[:]
        alt[1] = "False" if alt[1] == "True" else "True"
        cands.append(" ".join(alt))
    return _uniq(ans, cands)


def from_types(ans: str) -> list[str]:
    if "<class" not in ans:
        return []
    cands = [
        ans.replace("'int'", "'float'").replace("'float'", "'str'").replace("'str'", "'int'"),
        ans.replace("'str'", "'int'"),
        ans.replace("'float'", "'int'"),
        "int float str",
        ans.replace("<class '", "").replace("'>", ""),
    ]
    # swap first two class names if three
    names = re.findall(r"<class '(\w+)'>", ans)
    if len(names) >= 2:
        swapped = names[:]
        swapped[0], swapped[1] = swapped[1], swapped[0]
        cands.append(" ".join(f"<class '{n}'>" for n in swapped))
    return _uniq(ans, cands)


def from_collection(ans: str, code: str) -> list[str]:
    cands: list[str] = []
    s = ans
    if s.startswith("[") and s.endswith("]"):
        cands.append(s.replace("[", "(").replace("]", ")"))
        cands.append(s[1:-1])  # без скобок
        # reverse list content if comma-separated simples
        inner = s[1:-1]
        if "," in inner and "{" not in inner:
            items = [x.strip() for x in inner.split(",")]
            if 2 <= len(items) <= 8:
                cands.append("[" + ", ".join(reversed(items)) + "]")
                # drop last
                cands.append("[" + ", ".join(items[:-1]) + "]")
                # sorted string illusion
                try:
                    nums = [int(x) for x in items]
                    cands.append(str(sorted(nums)))
                    cands.append(str(sorted(nums, reverse=True)))
                except ValueError:
                    pass
        if "range(" in code and s.startswith("[") and "," in s:
            # range inclusive mistake: include end
            cands.append(s[:-1] + ", " + str(len(re.findall(r"-?\d+", s))) + "]")
    elif s.startswith("{") and s.endswith("}") and ":" in s:
        # dict — swap braces feel / list of pairs
        cands.append(s.replace("{", "[").replace("}", "]"))
        # drop one key roughly
        m = re.search(r"'(\w+)':", s)
        if m:
            # remove first key entry — fragile but ok as distractor lookalike
            cands.append(re.sub(r"'%s': [^,}]+,?\s*" % m.group(1), "", s, count=1))
            cands.append(re.sub(r",?\s*'%s': [^,}]+" % m.group(1), "", s, count=1))
    elif s.startswith("{") and s.endswith("}") and ":" not in s:
        # set
        cands.append(s.replace("{", "[").replace("}", "]"))
        cands.append(s.replace("{", "(").replace("}", ")"))
        inner = s[1:-1]
        if "," in inner:
            items = [x.strip() for x in inner.split(",")]
            cands.append("{" + ", ".join(reversed(items)) + "}")
            cands.append("{" + ", ".join(items[:-1]) + "}")
    elif s.startswith("(") and s.endswith(")"):
        cands.append(s.replace("(", "[").replace(")", "]"))
        inner = s[1:-1]
        if "," in inner:
            items = [x.strip() for x in inner.split(",")]
            cands.append("(" + ", ".join(reversed(items)) + ")")
    return _uniq(ans, cands)


def from_branches(ans: str, code: str) -> list[str]:
    """Строковые ветки if/else / тернарника — противоположный ответ."""
    lits = re.findall(r"['\"]([^'\"]+)['\"]", code)
    # убрать чисто технические
    skip = {c for c in ("", "%", "=", "sum =") if True}
    useful = [x for x in lits if x and x != ans and not x.startswith("%") and len(x) <= 40]
    return _uniq(ans, useful)


def from_stringy(ans: str, code: str) -> list[str]:
    cands: list[str] = []
    cands += from_branches(ans, code)
    # case
    if ans != ans.lower() and any(c.isalpha() for c in ans):
        cands.append(ans.lower())
    if ans != ans.upper() and ans.isascii() and any(c.isalpha() for c in ans):
        cands.append(ans.upper())
    if ans == "None":
        cands.extend(["none", "'None'", "0"])
    if ans.endswith("Error") and ans[0].isupper():
        for other in ("IndexError", "KeyError", "ValueError", "TypeError", "Exception"):
            if other != ans:
                cands.append(other)
    if "'" in ans and '"' not in ans:
        cands.append(ans.replace("'", '"'))
    if "-" in ans and ans.count("-") >= 2:
        cands.append(ans.replace("-", " "))
        cands.append(ans.replace("-", ","))
    if " " in ans and ans.count(" ") <= 4 and not _num_parts(ans) and "\n" not in ans:
        parts = ans.split(" ")
        if len(parts) == 2:
            cands.append(f"{parts[1]} {parts[0]}")
        if len(parts) >= 2:
            cands.append("".join(parts))
            cands.append(", ".join(parts))
    if "sep=" in code:
        cands.append(ans.replace("-", " "))
    return _uniq(ans, cands)


def from_multiline(ans: str) -> list[str]:
    if "\n" not in ans:
        return []
    lines = ans.split("\n")
    cands = []
    cands.append("\n".join(reversed(lines)))
    if len(lines) == 2:
        cands.append(f"{lines[0]} {lines[1]}")
        cands.append(lines[0])
        cands.append(lines[1])
        # swap if look numeric
        cands.append(f"{lines[1]}\n{lines[0]}")
    return _uniq(ans, cands)


HANDCRAFTED = {
    # id -> wrong list (overrides generator)
    "1.2": [
        "<class 'str'> <class 'float'> <class 'int'>",
        "<class 'int'> <class 'int'> <class 'str'>",
        "int float str",
    ],
    "1.3": ["3", "5", "2"],
    "1.4": ["py", "pypy", "py py py"],
    "2.1": ["3.5 1 32", "3 1 10", "3 0 32"],
    "2.2": ["5", "4.0", "2.5"],
    "2.3": ["3.14 -7", "3.14159 7", "3.15 7"],
    "2.4": ["2 -2 3 -3", "2 3 3 -3", "-2 3 -3 4"],
    "2.5": ["1024 14 0", "10 14 2", "1024 15 2"],
    "3.1": ["P n 5", "p n 6", "y n 6"],
    "3.2": ["Аня, {age}", "Аня 25", "Аня, age"],
    "3.4": ["True True True", "False True 2", "True False 2"],
    "3.6": ["2 к0л0к0л", "3 колокол", "3 клл"],
    "4.1": ["False True", "True True", "False False"],
    "4.2": ["True True True True", "False False False False", "True False True False"],
    "4.3": ["False False", "True False", "False True"],
    "4.4": ["False True", "True True", "False False"],
    "4.5": ["False True", "True True", "False False"],
    "5.1": ["чёт", "чётное", "7"],
    "5.2": ["есть", "0", "True"],
    "5.4": ["не ноль", "0", "False"],
    "6.1": ["1 2 3 4 5", "1 2 3 4", "1 2 4"],
    "6.2": ["4", "5", "8"],
    "6.4": ["1 2 2 4", "1 1 2 2\n2 2 4 4", "1 2\n2 4\n"],
    "6.5": ["19", "25", "10"],
    "7.1": ["[1, 2, 3, 4]", "[0, 1, 2, 3]", "[1, 2, 3, 0, 4]"],
    "7.2": ["[1, 2, 3] [5, 4, 3, 2, 1]", "[2, 3, 4] [1, 2, 3, 4, 5]", "[2, 3, 4, 5] [5, 4, 3, 2, 1]"],
    "7.5": ["[1, 2, 3]", "[1, 2, 2, 3]", "[2, 4, 3]"],
    "7.6": ["[1, 3]", "[1, 2]", "[]"],
    "8.1": ["1 3 (1, 2, 3)", "1 4 (1, 2, 3, 4)", "1 3 [1, 2, 3, 4]"],
    "8.2": ["1 2 (3, 4)", "1 2 3 4", "1 2 [4, 3]"],
    "8.3": ["1 2", "2 2", "1 1"],
    "8.4": ["int 1", "tuple 5", "list 1"],
    "8.5": ["3", "6", "1"],
    "9.1": ["{'a': 1, 'b': 2}", "{'a': 1, 'b': 2, 'd': 3}", "['a', 'b', 'c']"],
    "9.2": ["None\n['a', 'b']", "0\n['a', 'b', 'x']", "1\n['a', 'b']"],
    "9.4": ["1 True", "2 False", "3 True"],
    "10.1": ["{1, 2, 2, 3, 3, 3}", "[1, 2, 3]", "{1, 2, 3, 3}"],
    "10.2": ["{1, 2, 3} {2, 3, 4} {1}", "{2, 3} {1, 2, 3} {1, 4}", "{1, 2, 3, 4} {2, 3} {1}"],
    "10.3": ["False True", "True True", "False False"],
    "10.4": ["2", "4", "1"],
    "10.5": ["{1, 2, 3, 4}", "{2, 3}", "{1, 2, 4}"],
    "11.1": ["sum=5", "sum = 2 + 3", "5"],
    "11.2": ["a b c", "a,b,c", "abc"],
    "11.4": ["a\nb", "a b", "ba"],
    "11.5": ["3.14159", "3.1", "3"],
    "12.1": ["5", "10", "125"],
    "12.4": ["pass", "0", "f"],
    "19.1": ["{1: 1, 2: 2, 3: 3}", "{1: 1, 2: 4}", "[1, 4, 9]"],
    "35.4": ["None", "()", "[None]"],
    "42.2": ["0.5", "50", "0.50%"],
}


def generate_wrong(task: dict) -> list[str]:
    tid = task["id"]
    if tid in HANDCRAFTED:
        return _uniq(task["answer"].strip(), HANDCRAFTED[tid], 3)
    ans = task["answer"].strip()
    code = task.get("code") or ""
    cands: list[str] = []
    cands += from_types(ans)
    cands += from_bools(ans)
    cands += from_numbers(ans, code)
    cands += from_collection(ans, code)
    cands += from_multiline(ans)
    cands += from_stringy(ans, code)
    # слабый запас — только осмысленные, без «ответ!» / «ответ »
    if len(cands) < 3 and "\n" not in ans and len(ans) > 1:
        if ans[:1].isdigit() or ans[:1] in "-":
            try:
                cands.append(str(int(float(ans)) + 1))
                cands.append(str(int(float(ans)) - 1))
            except ValueError:
                pass
        elif ans[0].isalpha() or ord(ans[0]) > 127:
            cands.append(ans.lower() if ans != ans.lower() else ans + "?")
    return _uniq(ans, cands, 3)


def inject_markdown(text: str, wrong_by_id: dict[str, list[str]]) -> str:
    """Вставляет/заменяет блок Ошибочные варианты. Id — как в build_tasks:
    порядковый номер внутри темы, а не текст заголовка (там часто «Задание X»)."""

    topic_chunks = re.split(r"(\n## Тема \d+\.)", text)
    # topic_chunks: [preamble, sep1, body1, sep2, body2, ...]
    if len(topic_chunks) == 1:
        return text

    out = [topic_chunks[0]]
    i = 1
    while i < len(topic_chunks):
        sep = topic_chunks[i]
        body = topic_chunks[i + 1] if i + 1 < len(topic_chunks) else ""
        m_topic = re.match(r"\n## Тема (\d+)\.", sep)
        topic_id = int(m_topic.group(1)) if m_topic else 0

        task_parts = re.split(r"(\n### Задание )", body)
        # [before_first_task, '### Задание ', task1, '### Задание ', task2, ...]
        new_body = [task_parts[0]]
        task_idx = 0
        j = 1
        while j < len(task_parts):
            marker = task_parts[j]
            task_body = task_parts[j + 1] if j + 1 < len(task_parts) else ""
            task_idx += 1
            tid = f"{topic_id}.{task_idx}"
            wrong = wrong_by_id.get(tid)
            if (
                wrong
                and "**Тип задания:** определить вывод" in task_body[:350]
            ):
                block = (
                    "**Ошибочные варианты:**\n\n```text\n"
                    + "\n".join(wrong)
                    + "\n```\n\n"
                )
                if "**Ошибочные варианты:**" in task_body:
                    task_body = re.sub(
                        r"\*\*Ошибочные варианты:\*\*.*?(?=\*\*Объяснение:)",
                        lambda _m: block,
                        task_body,
                        count=1,
                        flags=re.S,
                    )
                elif "**Объяснение:**" in task_body:
                    task_body = task_body.replace(
                        "**Объяснение:**", block + "**Объяснение:**", 1
                    )
            new_body.append(marker)
            new_body.append(task_body)
            j += 2

        out.append(sep)
        out.append("".join(new_body))
        i += 2

    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    topics = bt.parse()
    wrong_by_id: dict[str, list[str]] = {}
    thin = []
    for top in topics:
        for t in top["tasks"]:
            if t["type"] != "определить вывод":
                continue
            ans = (t.get("answer") or "").strip()
            if not ans or ans.count("\n") > 1:
                continue
            wrong = generate_wrong(t)
            if len(wrong) < 2:
                thin.append((t["id"], ans, wrong))
                continue
            wrong_by_id[t["id"]] = wrong

    print(f"ready: {len(wrong_by_id)}; thin(<2): {len(thin)}")
    for tid, ans, w in thin[:30]:
        print(f"  THIN {tid}: ans={ans!r} wrong={w}")

    if not args.write:
        # show samples
        for tid in ["1.2", "1.3", "2.1", "2.2", "2.4", "7.1", "13.1", "18.1"]:
            print(tid, "->", wrong_by_id.get(tid))
        return

    text = SRC.read_text(encoding="utf-8")
    new = inject_markdown(text, wrong_by_id)
    if new == text:
        print("no changes written (inject produced identical text?)")
        # still try
    SRC.write_text(new, encoding="utf-8", newline="\n")
    print(f"updated {SRC}")


if __name__ == "__main__":
    main()
