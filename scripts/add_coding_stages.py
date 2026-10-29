# -*- coding: utf-8 -*-
"""Добавляет 1–3 coding-этапа в конец каждой темы коллекции.

Запуск из корня:
  python scripts/add_coding_stages.py          # dry-run + verify
  python scripts/add_coding_stages.py --write  # правка markdown + checks.js
"""
from __future__ import annotations

import argparse
import contextlib
import io
import re
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "python_tasks_collection.md"
CHECKS = ROOT / "platform" / "static" / "checks.js"
sys.path.insert(0, str(ROOT))
import build_tasks as bt  # noqa: E402


def T(type_, prompt, answer, explanation, code=None, check=None):
    return {
        "type": type_,
        "prompt": textwrap.dedent(prompt).strip(),
        "code": textwrap.dedent(code).strip("\n") if code else None,
        "answer": textwrap.dedent(answer).strip("\n"),
        "explanation": textwrap.dedent(explanation).strip(),
        "check": check,
    }


# Сколько добавить: 0 code → 3, 1 → 2, 2+ → 1 (всегда хотя бы один новый).
def planned_count(existing_coding: int) -> int:
    if existing_coding <= 0:
        return 3
    if existing_coding == 1:
        return 2
    return 1


# ── Контент: новые этапы по темам ─────────────────────────────────────────
# Важно: только APPEND в конец темы — id существующих CHECKS не съезжают.

NEW = {
    1: [
        T(
            "дописать код",
            "Создайте переменные `city` (строка `'Тверь'`) и `year` (число `2026`), затем программа напечатает их.",
            "city = 'Тверь'\nyear = 2026",
            "Присваивание создаёт имя. Строка — в кавычках, год — без.",
            code="""\
# TODO: допишите код здесь

print(city, year)
""",
        ),
        T(
            "исправить ошибку",
            "Исправьте код так, чтобы он напечатал `15`. Сейчас типы не стыкуются.",
            "a = 7\nb = 8\nprint(a + b)",
            "Складывать нужно числа, а не строку с числом: уберите кавычки у `8` или преобразуйте типы.",
            code="""\
a = 7
b = '8'
print(a + b)
""",
        ),
    ],
    2: [
        T(
            "дописать код",
            "Посчитайте площадь круга: `pi = 3.14`, `r = 5`. Формула `pi * r ** 2`. Результат в `area`.",
            "area = pi * r ** 2",
            "`**` — степень, умножение обычное. Напечатается `78.5`.",
            code="""\
pi = 3.14
r = 5
# TODO: допишите код здесь
print(area)
""",
        ),
        T(
            "дописать код",
            "Даны `total = 17` и `n = 5`. Сохраните целую часть деления в `q`, остаток в `r`.",
            "q = total // n\nr = total % n",
            "`//` — сколько раз `n` помещается в `total`, `%` — что осталось.",
            code="""\
total = 17
n = 5
# TODO: допишите код здесь
print(q, r)
""",
        ),
    ],
    3: [
        T(
            "дописать код",
            "Из строки `word = 'облако'` соберите в `out` первую букву, длину и срез без первой буквы через пробел в f-строке: как `о 6 блако`.",
            "out = f\"{word[0]} {len(word)} {word[1:]}\"",
            "Индекс `0`, `len`, срез `word[1:]` — три части одного вывода.",
            code="""\
word = 'облако'
# TODO: допишите код здесь
print(out)
""",
        ),
    ],
    4: [
        T(
            "дописать код",
            "Запишите в `ok` проверку: число `n` положительное и чётное.",
            "ok = n > 0 and n % 2 == 0",
            "`and` требует истинности обеих частей; чётность — через остаток от деления на 2.",
            code="""\
n = 8
# TODO: допишите код здесь
print(ok)
""",
        ),
        T(
            "дописать код",
            "С помощью `bool` запишите в `flags` кортеж из трёх значений: для `0`, для пустой строки и для `'0'`.",
            "flags = (bool(0), bool(''), bool('0'))",
            "Ноль и пустая строка ложны, а непустая строка `'0'` истинна.",
            code="""\
# TODO: допишите код здесь
print(flags)
""",
        ),
        T(
            "исправить ошибку",
            "Нужно напечатать `True`, если `x` в диапазоне от 1 до 10 включительно. Исправьте условие.",
            "x = 7\nprint(1 <= x <= 10)",
            "Цепочка сравнений `1 <= x <= 10` читается естественно; `or` здесь давал бы неверный смысл.",
            code="""\
x = 7
print(1 <= x or x <= 10)
""",
        ),
    ],
    5: [
        T(
            "дописать код",
            "Если `score >= 50`, запишите в `mark` строку `'зачёт'`, иначе `'незачёт'`.",
            "mark = 'зачёт' if score >= 50 else 'незачёт'",
            "Тернарный оператор: значение_если_да if условие else значение_если_нет.",
            code="""\
score = 72
# TODO: допишите код здесь
print(mark)
""",
        ),
        T(
            "дописать код",
            "По `temp` выберите сообщение: ниже 0 — `'мороз'`, иначе `'тепло'`. Используйте обычный `if/else`.",
            "if temp < 0:\n    msg = 'мороз'\nelse:\n    msg = 'тепло'",
            "Ветка `else` ловит все остальные случаи, включая ноль.",
            code="""\
temp = -3
# TODO: допишите код здесь
print(msg)
""",
        ),
    ],
    6: [
        T(
            "дописать код",
            "Сложите все числа от 1 до `n` включительно в переменную `s` (цикл `for` + `range`).",
            "s = 0\nfor i in range(1, n + 1):\n    s += i",
            "`range(1, n + 1)` включает `n`. Накопление через `+=`.",
            code="""\
n = 5
# TODO: допишите код здесь
print(s)
""",
        ),
    ],
    7: [
        T(
            "дописать код",
            "Добавьте в конец списка `nums` число `4`, а в начало — `0`.",
            "nums.append(4)\nnums.insert(0, 0)",
            "`append` — в конец, `insert(0, …)` — в начало.",
            code="""\
nums = [1, 2, 3]
# TODO: допишите код здесь
print(nums)
""",
        ),
        T(
            "написать функцию",
            "Напишите функцию `second(items)`, которая возвращает второй элемент списка (индекс 1).",
            "def second(items):\n    return items[1]",
            "Индексация с нуля: второй элемент — это индекс `1`.",
            check={
                "append": 'assert second([10, 20, 30]) == 20\nassert second(["a", "b"]) == "b"\nprint("OK")',
                "expect": "OK",
            },
        ),
    ],
    8: [
        T(
            "дописать код",
            "Распакуйте кортеж `point = (3, 4)` в `x` и `y`.",
            "x, y = point",
            "Число имён слева должно совпадать с длиной кортежа.",
            code="""\
point = (3, 4)
# TODO: допишите код здесь
print(x, y)
""",
        ),
        T(
            "дописать код",
            "Соберите кортеж `t` из одного элемента — числа `7` (не забудьте запятую).",
            "t = (7,)",
            "Без запятой `(7)` — это просто число в скобках, не кортеж.",
            code="""\
# TODO: допишите код здесь
print(type(t).__name__, t)
""",
        ),
        T(
            "исправить ошибку",
            "Кортеж нельзя изменять по индексу. Исправьте программу так, чтобы она напечатала `(1, 9, 3)` — соберите новый кортеж.",
            "t = (1, 2, 3)\nt = (t[0], 9, t[2])\nprint(t)",
            "Неизменяемость: вместо присваивания в индекс собираем новый кортеж.",
            code="""\
t = (1, 2, 3)
t[1] = 9
print(t)
""",
        ),
    ],
    9: [
        T(
            "дописать код",
            "В словарь `d` добавьте ключ `'c'` со значением `3`.",
            "d['c'] = 3",
            "Присваивание по новому ключу создаёт пару.",
            code="""\
d = {'a': 1, 'b': 2}
# TODO: допишите код здесь
print(d)
""",
        ),
    ],
    10: [
        T(
            "дописать код",
            "Постройте множество `s` из списка с дубликатами `[1, 2, 2, 3, 3, 3]`.",
            "s = set([1, 2, 2, 3, 3, 3])",
            "Множество хранит уникальные элементы; порядок в выводе может отличаться — сравним через `sorted`.",
            code="""\
# TODO: допишите код здесь
print(sorted(s))
""",
        ),
        T(
            "дописать код",
            "Для множеств `a` и `b` запишите пересечение в `both`.",
            "both = a & b",
            "Оператор `&` — элементы, которые есть в обоих множествах.",
            code="""\
a = {1, 2, 3}
b = {2, 3, 4}
# TODO: допишите код здесь
print(sorted(both))
""",
        ),
        T(
            "написать функцию",
            "Напишите функцию `unique_count(items)`, возвращающую число уникальных элементов последовательности.",
            "def unique_count(items):\n    return len(set(items))",
            "`set` убирает повторы, `len` считает оставшееся.",
            check={
                "append": "assert unique_count([1, 1, 2, 3, 3]) == 3\nassert unique_count('aab') == 2\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    11: [
        T(
            "дописать код",
            "Напечатайте слова `one`, `two`, `three` через дефис в одной строке (параметр `sep`).",
            "print('one', 'two', 'three', sep='-')",
            "`sep` задаёт разделитель между аргументами `print`.",
            code="""\
# TODO: допишите код здесь
""",
        ),
        T(
            "дописать код",
            "Сформируйте строку `line` вида `id=42` через f-строку из переменной `n = 42`.",
            "line = f'id={n}'",
            "В фигурных скобках — выражение, которое подставится в текст.",
            code="""\
n = 42
# TODO: допишите код здесь
print(line)
""",
        ),
    ],
    12: [
        T(
            "написать функцию",
            "Напишите функцию `clamp(x, lo, hi)`, которая возвращает `x`, ограниченный отрезком `[lo, hi]`.",
            "def clamp(x, lo, hi):\n    return max(lo, min(hi, x))",
            "Сначала не выше `hi`, затем не ниже `lo` — или наоборот через `max`/`min`.",
            check={
                "append": "assert clamp(5, 0, 10) == 5\nassert clamp(-1, 0, 10) == 0\nassert clamp(99, 0, 10) == 10\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    13: [
        T(
            "дописать код",
            "Внутри функции увеличьте глобальный счётчик `count` на 1 (нужен `global`).",
            "global count\ncount += 1",
            "Без `global` присваивание создало бы локальную переменную.",
            code="""\
count = 0

def bump():
    # TODO: допишите код здесь

bump()
bump()
print(count)
""",
        ),
        T(
            "исправить ошибку",
            "Функция должна вернуть `x * 2`, используя параметр, а не глобальную переменную. Исправьте тело.",
            "def double(x):\n    return x * 2\n\nprint(double(5))",
            "Параметр `x` уже есть — используйте его в `return`.",
            code="""\
x = 100

def double(x):
    return x * 2

print(double(5))
""",
        ),
    ],
    14: [
        T(
            "написать функцию",
            "Напишите `greet(name, hello='Привет')`, возвращающую `'{hello}, {name}!'`.",
            "def greet(name, hello='Привет'):\n    return f'{hello}, {name}!'",
            "Параметр со значением по умолчанию идёт после обязательных.",
            check={
                "append": "assert greet('Аня') == 'Привет, Аня!'\nassert greet('Боб', hello='Hi') == 'Hi, Боб!'\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Вызовите `add` так, чтобы передать `a` и `b` именованно и получить `7` в `result`.",
            "result = add(a=3, b=4)",
            "Именованные аргументы можно указать в любом порядке.",
            code="""\
def add(a, b):
    return a + b

# TODO: допишите код здесь
print(result)
""",
        ),
    ],
    15: [
        T(
            "написать функцию",
            "Напишите `append_item(item, bucket=None)`: если `bucket` is None, создайте новый список. Добавьте `item` и верните список.",
            "def append_item(item, bucket=None):\n    if bucket is None:\n        bucket = []\n    bucket.append(item)\n    return bucket",
            "Нельзя писать `bucket=[]` в заголовке — общий список на все вызовы. Создавайте внутри при `None`.",
            check={
                "append": "assert append_item(1) == [1]\nassert append_item(2) == [2]\na = []\nassert append_item(3, a) is a and a == [3]\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Вызовите `tag` один раз без второго аргумента и один раз с `'!'; результаты склейте в `out` через пробел.",
            "out = tag('ok') + ' ' + tag('ok', '!')",
            "Значение по умолчанию подставляется только когда аргумент не передан.",
            code="""\
def tag(text, end='.'):
    return text + end

# TODO: допишите код здесь
print(out)
""",
        ),
    ],
    16: [
        T(
            "дописать код",
            "Запишите в файл `memo.txt` строку `утро` в кодировке UTF-8, затем программа прочитает файл.",
            "with open('memo.txt', 'w', encoding='utf-8') as f:\n    f.write('утро')",
            "`with` закроет файл; режим `'w'` создаёт/перезаписывает.",
            code="""\
# TODO: допишите код здесь

with open('memo.txt', encoding='utf-8') as f:
    print(f.read())
""",
        ),
        T(
            "дописать код",
            "Допишите чтение всех строк файла `lines.txt` в список `rows` без символов перевода строки на концах.",
            "with open('lines.txt', encoding='utf-8') as f:\n    rows = [line.rstrip('\\n') for line in f]",
            "`rstrip('\\n')` убирает перевод строки; можно и `read().splitlines()`.",
            code="""\
from pathlib import Path
Path('lines.txt').write_text('a\\nb\\n', encoding='utf-8')
# TODO: допишите код здесь
print(rows)
""",
        ),
    ],
    17: [
        T(
            "дописать код",
            "Оберните деление в `try/except ZeroDivisionError` так, чтобы при ошибке в `msg` было `'нет'`, иначе результат деления строкой.",
            "try:\n    msg = str(a / b)\nexcept ZeroDivisionError:\n    msg = 'нет'",
            "Исключение ловится только нужного типа — остальное пробросится дальше.",
            code="""\
a, b = 1, 0
# TODO: допишите код здесь
print(msg)
""",
        ),
        T(
            "исправить ошибку",
            "Нужно поймать `ValueError` от `int('x')` и напечатать `плохо`. Исправьте тип в `except`.",
            "try:\n    int('x')\nexcept ValueError:\n    print('плохо')",
            "`int('x')` бросает `ValueError`, а не `TypeError`.",
            code="""\
try:
    int('x')
except TypeError:
    print('плохо')
""",
        ),
    ],
    18: [
        T(
            "дописать код",
            "Через включение соберите в `cubes` кубы чисел от 0 до 3 включительно.",
            "cubes = [i ** 3 for i in range(4)]",
            "`range(4)` даёт 0…3; выражение слева — то, что попадёт в список.",
            code="""\
# TODO: допишите код здесь
print(cubes)
""",
        ),
    ],
    19: [
        T(
            "дописать код",
            "Постройте словарь `d`, где ключи — числа 1…3, значения — их квадраты (dict comprehension).",
            "d = {i: i * i for i in range(1, 4)}",
            "Синтаксис `{ключ: значение for …}`.",
            code="""\
# TODO: допишите код здесь
print(d)
""",
        ),
        T(
            "написать функцию",
            "Напишите `invert(d)`: словарь наоборот (значения стали ключами). Гарантируется, что значения уникальны.",
            "def invert(d):\n    return {v: k for k, v in d.items()}",
            "Идём по `items` и меняем местами `k` и `v`.",
            check={
                "append": "assert invert({'a': 1, 'b': 2}) == {1: 'a', 2: 'b'}\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    20: [
        T(
            "дописать код",
            "Отсортируйте `words` по длине по возрастанию в новый список `ordered`.",
            "ordered = sorted(words, key=len)",
            "`key=len` сравнивает длины, а не алфавит.",
            code="""\
words = ['bbb', 'a', 'dd']
# TODO: допишите код здесь
print(ordered)
""",
        ),
        T(
            "дописать код",
            "Отсортируйте числа `nums` по модулю, сохранив исходные знаки, в список `by_abs`.",
            "by_abs = sorted(nums, key=abs)",
            "`key` влияет только на сравнение, в результате остаются исходные значения.",
            code="""\
nums = [3, -1, -2, 4]
# TODO: допишите код здесь
print(by_abs)
""",
        ),
    ],
    21: [
        T(
            "дописать код",
            "С помощью `map` и `lambda` получите список строк из чисел `nums` в переменную `as_text`.",
            "as_text = list(map(lambda x: str(x), nums))",
            "`map` ленивый — оберните в `list`, чтобы увидеть результат.",
            code="""\
nums = [1, 2, 3]
# TODO: допишите код здесь
print(as_text)
""",
        ),
        T(
            "написать функцию",
            "Напишите `apply(fn, value)` — просто верните `fn(value)`.",
            "def apply(fn, value):\n    return fn(value)",
            "Функция — объект первого класса: её можно передать аргументом.",
            check={
                "append": "assert apply(lambda x: x + 1, 4) == 5\nassert apply(str.upper, 'ok') == 'OK'\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    22: [
        T(
            "дописать код",
            "Импортируйте `math` и запишите в `x` значение `math.sqrt(16)`.",
            "import math\nx = math.sqrt(16)",
            "После `import math` имена берутся через точку.",
            code="""\
# TODO: допишите код здесь
print(x)
""",
        ),
        T(
            "дописать код",
            "Импортируйте только `pi` из `math` и запишите в `half` значение `pi / 2`.",
            "from math import pi\nhalf = pi / 2",
            "`from … import` кладёт имя прямо в текущее пространство.",
            code="""\
# TODO: допишите код здесь
print(round(half, 2))
""",
        ),
    ],
    23: [
        T(
            "дописать код",
            "Создайте `d = date(2026, 7, 20)` и запишите в `iso` результат `d.isoformat()`.",
            "d = date(2026, 7, 20)\niso = d.isoformat()",
            "`isoformat` даёт строку `ГГГГ-ММ-ДД`.",
            code="""\
from datetime import date
# TODO: допишите код здесь
print(iso)
""",
        ),
        T(
            "дописать код",
            "Сложите `timedelta(days=2)` с `start` и положите результат в `finish`.",
            "finish = start + timedelta(days=2)",
            "Даты и дельты складываются: получается новая дата.",
            code="""\
from datetime import date, timedelta
start = date(2026, 1, 1)
# TODO: допишите код здесь
print(finish.isoformat())
""",
        ),
    ],
    24: [
        T(
            "написать функцию",
            "Напишите рекурсивный `fact(n)` для n ≥ 0 (`fact(0) == 1`).",
            "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)",
            "База — 0 или 1, шаг — `n * fact(n-1)`.",
            check={
                "append": "assert fact(0) == 1\nassert fact(1) == 1\nassert fact(5) == 120\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Итеративно посчитайте сумму списка `nums` в `s` циклом (без `sum`).",
            "s = 0\nfor x in nums:\n    s += x",
            "Накопление в цикле — база для понимания рекурсивной суммы.",
            code="""\
nums = [2, 3, 5]
# TODO: допишите код здесь
print(s)
""",
        ),
    ],
    25: [
        T(
            "дописать код",
            "Сериализуйте словарь `data` в JSON-строку `text` без пробелов после `:` и `,` (`separators`).",
            "text = json.dumps(data, separators=(',', ':'))",
            "`separators=(',', ':')` убирает лишние пробелы в компактной записи.",
            code="""\
import json
data = {'a': 1, 'b': 2}
# TODO: допишите код здесь
print(text)
""",
        ),
        T(
            "дописать код",
            "Разберите JSON-строку `raw` в объект `obj`.",
            "obj = json.loads(raw)",
            "`loads` — из строки, `load` — из файла.",
            code="""\
import json
raw = '[1, 2, 3]'
# TODO: допишите код здесь
print(obj)
""",
        ),
    ],
    26: [
        T(
            "дописать код",
            "Получите итератор из списка и вручную достаньте два первых значения в `a` и `b` через `next`.",
            "it = iter([10, 20, 30])\na = next(it)\nb = next(it)",
            "`iter` даёт итератор; каждый `next` продвигает его вперёд.",
            code="""\
# TODO: допишите код здесь
print(a, b)
""",
        ),
        T(
            "написать функцию",
            "Напишите `first(iterable, default=None)`: первый элемент или `default`, если пусто.",
            "def first(iterable, default=None):\n    for item in iterable:\n        return item\n    return default",
            "Один проход: вернули сразу или дошли до конца.",
            check={
                "append": "assert first([3, 4]) == 3\nassert first([], 0) == 0\nassert first(range(5, 6)) == 5\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Соберите список пар `(i, x)` через `enumerate` начиная с 1 для `xs = ['a', 'b']`.",
            "pairs = list(enumerate(xs, start=1))",
            "`start` задаёт начальный номер.",
            code="""\
xs = ['a', 'b']
# TODO: допишите код здесь
print(pairs)
""",
        ),
    ],
    27: [
        T(
            "написать функцию",
            "Напишите генератор `countdown(n)`, который yields `n`, `n-1`, …, `1`.",
            "def countdown(n):\n    while n > 0:\n        yield n\n        n -= 1",
            "`yield` приостанавливает функцию и отдаёт значение.",
            check={
                "append": "assert list(countdown(3)) == [3, 2, 1]\nassert list(countdown(0)) == []\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Через generator expression посчитайте сумму квадратов `nums` в `s`.",
            "s = sum(x * x for x in nums)",
            "Круглые скобки у genexp можно опустить внутри вызова функции.",
            code="""\
nums = [1, 2, 3]
# TODO: допишите код здесь
print(s)
""",
        ),
    ],
    28: [
        T(
            "дописать код",
            "Напишите декоратор-проходной `passthrough`: он возвращает ту же функцию без изменений. Примените к `hi`.",
            "def passthrough(fn):\n    return fn\n\n@passthrough\ndef hi():\n    return 'hi'",
            "Минимальный декоратор принимает функцию и возвращает вызываемый объект.",
            code="""\
# TODO: допишите код здесь

print(hi())
""",
        ),
        T(
            "написать функцию",
            "Напишите декоратор `twice`, который вызывает обёрнутую функцию дважды и возвращает второй результат.",
            "def twice(fn):\n    def wrapper(*args, **kwargs):\n        fn(*args, **kwargs)\n        return fn(*args, **kwargs)\n    return wrapper",
            "Внутренняя `wrapper` принимает любые аргументы и прокидывает их.",
            check={
                "append": "calls = []\n@twice\ndef mark(x):\n    calls.append(x)\n    return x\nassert mark(5) == 5 and calls == [5, 5]\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    29: [
        T(
            "написать функцию",
            "Напишите `make_adder(n)`, возвращающую функцию, которая прибавляет `n` к аргументу.",
            "def make_adder(n):\n    def add(x):\n        return x + n\n    return add",
            "Внутренняя функция замыкает `n` из внешней области.",
            check={
                "append": "add2 = make_adder(2)\nassert add2(10) == 12\nassert make_adder(5)(1) == 6\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    30: [
        T(
            "дописать код",
            "Откройте `ctx.txt` через `with open(...)` и прочитайте содержимое в `text`.",
            "with open('ctx.txt', encoding='utf-8') as f:\n    text = f.read()",
            "Контекстный менеджер гарантирует закрытие файла.",
            code="""\
from pathlib import Path
Path('ctx.txt').write_text('ok', encoding='utf-8')
# TODO: допишите код здесь
print(text)
""",
        ),
        T(
            "написать функцию",
            "Напишите класс `NullCtx` с `__enter__`, возвращающим `'inside'`, и `__exit__`, возвращающим `False`.",
            "class NullCtx:\n    def __enter__(self):\n        return 'inside'\n    def __exit__(self, *args):\n        return False",
            "Протокол `with`: `__enter__` / `__exit__`.",
            check={
                "append": "with NullCtx() as v:\n    assert v == 'inside'\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Импортируйте `suppress` из `contextlib` и подавите `ValueError` вокруг `int('x')`, затем напечатайте `'done'`.",
            "from contextlib import suppress\nwith suppress(ValueError):\n    int('x')\nprint('done')",
            "`suppress` — готовый контекст, который глотает указанные исключения.",
            code="""\
# TODO: допишите код здесь
""",
        ),
    ],
    31: [
        T(
            "написать функцию",
            "Напишите класс `Counter` с `value=0` и методом `inc(self)`, увеличивающим `value` на 1 и возвращающим его.",
            "class Counter:\n    def __init__(self):\n        self.value = 0\n    def inc(self):\n        self.value += 1\n        return self.value",
            "Состояние хранится в `self`; метод меняет его.",
            check={
                "append": "c = Counter()\nassert c.inc() == 1 and c.inc() == 2 and c.value == 2\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Создайте экземпляр `p = Point(2, 3)` для уже объявленного класса и напечатайте сумму координат.",
            "p = Point(2, 3)\nprint(p.x + p.y)",
            "Аргументы `__init__` после `self` передаются при создании.",
            code="""\
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

# TODO: допишите код здесь
""",
        ),
    ],
    32: [
        T(
            "дописать код",
            "Класс `Dog(Animal)` должен переопределить `speak`, вернув `'гав'`. Допишите метод.",
            "def speak(self):\n    return 'гав'",
            "Переопределение метода — основа полиморфизма.",
            code="""\
class Animal:
    def speak(self):
        return '...'

class Dog(Animal):
    # TODO: допишите код здесь

print(Dog().speak())
""",
        ),
        T(
            "написать функцию",
            "Напишите `describe(obj)`, возвращающую результат `obj.speak()` — без проверки типа.",
            "def describe(obj):\n    return obj.speak()",
            "Утиная типизация: важен метод, а не имя класса.",
            check={
                "append": "class A:\n    def speak(self):\n        return 'a'\nclass B:\n    def speak(self):\n        return 'b'\nassert describe(A()) == 'a' and describe(B()) == 'b'\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "исправить ошибку",
            "`Child` должен вызвать `speak` родителя через `super` и дописать `'!'`. Исправьте вызов.",
            "class Parent:\n    def speak(self):\n        return 'hi'\n\nclass Child(Parent):\n    def speak(self):\n        return super().speak() + '!'\n\nprint(Child().speak())",
            "`super().speak()` — метод родителя, не `Parent.speak()` без self аккуратно через super.",
            code="""\
class Parent:
    def speak(self):
        return 'hi'

class Child(Parent):
    def speak(self):
        return Parent.speak() + '!'

print(Child().speak())
""",
        ),
    ],
    33: [
        T(
            "дописать код",
            "Добавьте в класс `Vec` метод `__add__`, возвращающий новый `Vec` с суммой `x`.",
            "def __add__(self, other):\n    return Vec(self.x + other.x)",
            "`a + b` вызывает `a.__add__(b)`.",
            code="""\
class Vec:
    def __init__(self, x):
        self.x = x
    def __repr__(self):
        return f'Vec({self.x})'
    # TODO: допишите код здесь

print(Vec(1) + Vec(2))
""",
        ),
        T(
            "написать функцию",
            "Напишите класс `Box` с `__len__`, возвращающим длину внутреннего списка `items`.",
            "class Box:\n    def __init__(self, items):\n        self.items = list(items)\n    def __len__(self):\n        return len(self.items)",
            "`len(obj)` → `obj.__len__()`.",
            check={
                "append": "assert len(Box([1, 2, 3])) == 3\nassert len(Box([])) == 0\nprint('OK')",
                "expect": "OK",
            },
        ),
        T(
            "дописать код",
            "Реализуйте `__eq__` у `Pair`, сравнивающий `a` и `b`.",
            "def __eq__(self, other):\n    return isinstance(other, Pair) and (self.a, self.b) == (other.a, other.b)",
            "Без `__eq__` объекты сравнивались бы по идентичности.",
            code="""\
class Pair:
    def __init__(self, a, b):
        self.a = a
        self.b = b
    # TODO: допишите код здесь

print(Pair(1, 2) == Pair(1, 2), Pair(1, 2) == Pair(2, 1))
""",
        ),
    ],
    34: [
        T(
            "дописать код",
            "Сделайте `celsius` property у `Temp`: геттер возвращает `_c`, сеттер пишет в `_c`.",
            "@property\ndef celsius(self):\n    return self._c\n@celsius.setter\ndef celsius(self, value):\n    self._c = value",
            "Пара декораторов: `@property` и `@name.setter`.",
            code="""\
class Temp:
    def __init__(self, c):
        self._c = c
    # TODO: допишите код здесь

t = Temp(10)
t.celsius = 20
print(t.celsius)
""",
        ),
        T(
            "написать функцию",
            "Напишите класс `Circle` с `radius` в `__init__` и read-only property `area` = `3.14 * r * r`.",
            "class Circle:\n    def __init__(self, radius):\n        self.radius = radius\n    @property\n    def area(self):\n        return 3.14 * self.radius * self.radius",
            "Property без setter — только чтение.",
            check={
                "append": "c = Circle(2)\nassert abs(c.area - 12.56) < 1e-9\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    35: [
        T(
            "дописать код",
            "Объявите `@dataclass` `User` с полями `name: str` и `active: bool = True`.",
            "@dataclass\nclass User:\n    name: str\n    active: bool = True",
            "Значения по умолчанию идут после полей без умолчаний.",
            code="""\
from dataclasses import dataclass
# TODO: допишите код здесь

print(User('Ann'))
""",
        ),
        T(
            "написать функцию",
            "Напишите dataclass `Point` с `x: int`, `y: int` и методом `as_tuple(self)`.",
            "from dataclasses import dataclass\n\n@dataclass\nclass Point:\n    x: int\n    y: int\n    def as_tuple(self):\n        return (self.x, self.y)",
            "Методы в dataclass пишутся как обычно.",
            check={
                "append": "assert Point(1, 2).as_tuple() == (1, 2)\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    36: [
        T(
            "дописать код",
            "Добавьте аннотации: `name` — `str`, возврат — `str`. Тело уже есть — поправьте только заголовок функции.",
            "def hello(name: str) -> str:",
            "Аннотации помогают читателю и инструментам; на выполнение runtime Python их обычно не проверяет.",
            code="""\
# TODO: допишите код здесь
    return 'hi ' + name

print(hello('Ada'))
""",
        ),
        T(
            "написать функцию",
            "Напишите `strlen(s: str) -> int`, возвращающую длину строки.",
            "def strlen(s: str) -> int:\n    return len(s)",
            "Сигнатура с типами + простая реализация.",
            check={
                "append": "assert strlen('ab') == 2\nassert strlen('') == 0\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    37: [
        T(
            "дописать код",
            "Сделайте поверхностную копию списка `a` в `b` через `list(...)` или срез, затем измените `b[0]`.",
            "b = list(a)\nb[0] = 99",
            "Новый внешний список; для вложенных структур нужен `deepcopy`.",
            code="""\
a = [1, 2, 3]
# TODO: допишите код здесь
print(a, b)
""",
        ),
        T(
            "дописать код",
            "Скопируйте вложенный список через `copy.deepcopy` в `b`, затем измените `b[0][0]`.",
            "b = copy.deepcopy(a)\nb[0][0] = 9",
            "Deep copy разрывает связь и по вложенным объектам.",
            code="""\
import copy
a = [[1, 2], [3, 4]]
# TODO: допишите код здесь
print(a, b)
""",
        ),
        T(
            "исправить ошибку",
            "Нужно независимое изменение копии. Исправьте так, чтобы `a` остался `[1, 2]`.",
            "a = [1, 2]\nb = list(a)\nb.append(3)\nprint(a, b)",
            "`b = a` копирует ссылку; `list(a)` — новый список.",
            code="""\
a = [1, 2]
b = a
b.append(3)
print(a, b)
""",
        ),
    ],
    38: [
        T(
            "дописать код",
            "Объявите исключение `EmptyError(Exception)` и выбросьте его, если `items` пуст.",
            "class EmptyError(Exception):\n    pass\n\nif not items:\n    raise EmptyError('empty')",
            "Свои исключения обычно наследуют от `Exception`.",
            code="""\
items = []
# TODO: допишите код здесь
try:
    raise EmptyError('empty')
except EmptyError as e:
    print(type(e).__name__)
""",
        ),
        # The above is messy - let me fix topic 38 task 1 to be cleaner
    ],
    39: [
        T(
            "дописать код",
            "Реализуйте линейный поиск: индекс первого `target` в `nums` или `-1`.",
            "idx = -1\nfor i, v in enumerate(nums):\n    if v == target:\n        idx = i\n        break",
            "O(n): один проход без сортировки.",
            code="""\
nums = [4, 1, 7, 1]\ntarget = 1
# TODO: допишите код здесь
print(idx)
""",
        ),
        T(
            "написать функцию",
            "Напишите `has_duplicate(nums)` за O(n) с помощью множества.",
            "def has_duplicate(nums):\n    seen = set()\n    for x in nums:\n        if x in seen:\n            return True\n        seen.add(x)\n    return False",
            "Проверка `in` у set в среднем O(1).",
            check={
                "append": "assert has_duplicate([1, 2, 1]) is True\nassert has_duplicate([1, 2, 3]) is False\nprint('OK')",
                "expect": "OK",
            },
        ),
    ],
    40: [
        T(
            "дописать код",
            "Возьмите срез `xs[1:4]` в `mid`.",
            "mid = xs[1:4]",
            "Конец не включается: индексы 1, 2, 3.",
            code="""\
xs = [0, 1, 2, 3, 4, 5]
# TODO: допишите код здесь
print(mid)
""",
        ),
    ],
    41: [
        T(
            "дописать код",
            "Склейте `names` и `scores` через `zip` в список кортежей `pairs`.",
            "pairs = list(zip(names, scores))",
            "`zip` останавливается на короткой последовательности.",
            code="""\
names = ['Ann', 'Bob']\nscores = [10, 8]
# TODO: допишите код здесь
print(pairs)
""",
        ),
        T(
            "дописать код",
            "Через `enumerate` постройте список строк вида `0:a`, `1:b` для `letters`.",
            "labeled = [f'{i}:{ch}' for i, ch in enumerate(letters)]",
            "`enumerate` даёт пары индекс–элемент.",
            code="""\
letters = ['a', 'b']
# TODO: допишите код здесь
print(labeled)
""",
        ),
    ],
    42: [
        T(
            "дописать код",
            "Отформатируйте `n = 7` как трёхзначное с нулями слева в `s` (`{:03d}`).",
            "s = f'{n:03d}'",
            "Спецификатор ширины с ведущими нулями.",
            code="""\
n = 7
# TODO: допишите код здесь
print(s)
""",
        ),
    ],
    43: [
        T(
            "дописать код",
            "Посчитайте частоты символов строки `s` через `Counter` в `c`.",
            "c = Counter(s)",
            "`Counter` принимает любую итерируемую последовательность.",
            code="""\
from collections import Counter
s = 'aab'
# TODO: допишите код здесь
print(dict(c))
""",
        ),
        T(
            "дописать код",
            "С `defaultdict(list)` добавьте `'x'` в ключ `'a'`, затем напечатайте `d['a']`.",
            "d = defaultdict(list)\nd['a'].append('x')",
            "Фабрика `list` создаёт пустой список для нового ключа.",
            code="""\
from collections import defaultdict
# TODO: допишите код здесь
print(d['a'])
""",
        ),
    ],
    44: [
        T(
            "исправить ошибку",
            "Приведите имена к стилю PEP 8 (snake_case для функции) так, чтобы вызов работал.",
            "def calc_sum(a, b):\n    return a + b\n\nprint(calc_sum(2, 3))",
            "Функции и переменные — `snake_case`, не `CamelCase`.",
            code="""\
def CalcSum(a, b):
    return a + b

print(CalcSum(2, 3))
""",
        ),
    ],
    45: [
        T(
            "дописать код",
            "Соберите путь `p` к файлу `data.txt` в текущей папке через `Path` и возьмите `p.name`.",
            "p = Path('data.txt')\nname = p.name",
            "`Path` удобнее строк для частей пути.",
            code="""\
from pathlib import Path
# TODO: допишите код здесь
print(name)
""",
        ),
    ],
    46: [
        T(
            "дописать код",
            "С фиксированным `random.seed(0)` запишите в `n` результат `random.randint(1, 3)`.",
            "random.seed(0)\nn = random.randint(1, 3)",
            "Seed делает последовательность воспроизводимой.",
            code="""\
import random
# TODO: допишите код здесь
print(n)
""",
        ),
    ],
    47: [
        T(
            "дописать код",
            "Найдите все числа в строке `text` через `re.findall` в список `nums`.",
            "nums = re.findall(r'\\d+', text)",
            "`\\d+` — одна или больше цифр.",
            code="""\
import re
text = 'a12 b3'
# TODO: допишите код здесь
print(nums)
""",
        ),
    ],
    48: [
        T(
            "дописать код",
            "Прочитайте CSV `t.csv` с заголовком через `DictReader` и соберите список имён в `names`.",
            "with open('t.csv', encoding='utf-8', newline='') as f:\n    names = [row['name'] for row in csv.DictReader(f)]",
            "`DictReader` даёт словари по заголовку.",
            code="""\
import csv
from pathlib import Path
Path('t.csv').write_text('name,age\\nAda,11\\nBob,12\\n', encoding='utf-8')
# TODO: допишите код здесь
print(names)
""",
        ),
    ],
    49: [
        T(
            "дописать код",
            "Добавьте аргумент `--count` типа `int` с default `1` и разберите `['--count', '3']`.",
            "parser.add_argument('--count', type=int, default=1)\nargs = parser.parse_args(['--count', '3'])",
            "`parse_args` можно кормить списком строк вместо sys.argv.",
            code="""\
import argparse
parser = argparse.ArgumentParser()
# TODO: допишите код здесь
print(args.count)
""",
        ),
    ],
    50: [
        T(
            "дописать код",
            "Создайте таблицу `hi(name TEXT)`, вставьте `'Ada'`, выберите все имена в `rows`.",
            "conn.execute('CREATE TABLE hi(name TEXT)')\nconn.execute(\"INSERT INTO hi VALUES ('Ada')\")\nrows = conn.execute('SELECT name FROM hi').fetchall()",
            "После DDL/DML для файла нужен `commit`; в памяти `:memory:` достаточно execute.",
            code="""\
import sqlite3
conn = sqlite3.connect(':memory:')
# TODO: допишите код здесь
print(rows)
""",
        ),
    ],
}

# Fix topic 38 properly (replace messy first draft)
NEW[38] = [
    T(
        "написать функцию",
        "Напишите исключение `EmptyError(Exception)` и функцию `head(items)`, которая бросает `EmptyError`, если список пуст, иначе возвращает первый элемент.",
        "class EmptyError(Exception):\n    pass\n\ndef head(items):\n    if not items:\n        raise EmptyError('empty')\n    return items[0]",
        "Свой класс исключения + явный `raise` в функции.",
        check={
            "append": "assert head([9, 8]) == 9\ntry:\n    head([])\nexcept EmptyError:\n    print('OK')",
            "expect": "OK",
        },
    ),
    T(
        "дописать код",
        "Поймайте `EmptyError` и запишите в `msg` строку `'пусто'`.",
        "try:\n    raise EmptyError()\nexcept EmptyError:\n    msg = 'пусто'",
        "`except` ловит свой тип исключения.",
        code="""\
class EmptyError(Exception):
    pass
# TODO: допишите код здесь
print(msg)
""",
    ),
]


def coding_count(topic) -> int:
    hints = ("дописать", "написать", "исправить")
    return sum(1 for t in topic["tasks"] if any(h in t["type"] for h in hints))


def render_task(task: dict) -> str:
    parts = [
        "### Задание X",
        "",
        f"**Тип задания:** {task['type']}",
        "",
        "**Условие:**",
        "",
        task["prompt"],
        "",
    ]
    if task.get("code"):
        parts += ["```python", task["code"], "```", ""]
    parts += ["**Ответ:**", ""]
    lang = "python"
    parts += [f"```{lang}", task["answer"], "```", ""]
    parts += ["**Объяснение:**", "", task["explanation"], "", "**Проверено в CPython:** да", "", "---", ""]
    return "\n".join(parts)


def verify_task(task: dict) -> str | None:
    """Возвращает None если ок, иначе текст ошибки."""
    if task["type"] == "написать функцию" or (
        task.get("check") and task["type"] in ("написать функцию", "исправить ошибку")
    ):
        check = task.get("check")
        if not check:
            return "function/fix without check"
        code = task["answer"] + "\n\n" + check["append"]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                exec(code, {})
        except Exception as e:
            return f"exec: {e}"
        out = buf.getvalue().rstrip("\n")
        if out != check["expect"]:
            return f"expect {check['expect']!r} got {out!r}"
        return None

    if task["type"] in ("дописать код", "исправить ошибку"):
        if task["type"] == "дописать код" and task.get("code") and "# TODO: допишите код здесь" in task["code"]:
            import re as _re

            m = _re.search(r"^([ \t]*)# TODO: допишите код здесь[ \t]*$", task["code"], _re.M)
            if not m:
                return "TODO marker missing"
            indent = m.group(1)
            frag = "\n".join((indent + ln if ln else ln) for ln in task["answer"].split("\n"))
            prog = task["code"][: m.start()] + frag + task["code"][m.end() :]
        else:
            prog = task["answer"]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                exec(prog, {})
        except Exception as e:
            return f"exec: {e}\n---\n{prog}"
        if not buf.getvalue().strip() and task["type"] == "дописать код":
            # allow print-only answers that still produce output from code after TODO
            pass
        return None

    return f"unknown type {task['type']}"


def inject(text: str, blocks_by_topic: dict[int, str]) -> str:
    topic_chunks = re.split(r"(\n## Тема \d+\.)", text)
    out = [topic_chunks[0]]
    i = 1
    while i < len(topic_chunks):
        sep = topic_chunks[i]
        body = topic_chunks[i + 1] if i + 1 < len(topic_chunks) else ""
        m = re.match(r"\n## Тема (\d+)\.", sep)
        tid = int(m.group(1)) if m else 0
        extra = blocks_by_topic.get(tid, "")
        if extra:
            # вставляем перед концом body (следующий sep уже отделён)
            if not body.endswith("\n"):
                body += "\n"
            body = body + "\n" + extra
        out.append(sep)
        out.append(body)
        i += 2
    return "".join(out)


def update_checks(path: Path, new_checks: dict[str, dict]) -> None:
    if not new_checks:
        return
    text = path.read_text(encoding="utf-8")
    # вставляем перед закрывающей `};` у window.CHECKS
    entries = []
    for tid, chk in sorted(new_checks.items(), key=lambda x: tuple(map(int, x[0].split(".")))):
        ap = chk.get("append")
        ex = chk["expect"]
        if ap is not None:
            entries.append(
                f'  "{tid}": {{\n    append: {ap!r},\n    expect: {ex!r},\n  }},'
            )
        else:
            entries.append(f'  "{tid}": {{ expect: {ex!r} }},')
    block = "\n  /* ── новые coding-этапы (practice) ── */\n" + "\n".join(entries) + "\n"
    if "/* ── новые coding-этапы (practice) ── */" in text:
        text = re.sub(
            r"\n  /\* ── новые coding-этапы \(practice\) ── \*/\n.*?(?=\n\};)",
            block,
            text,
            count=1,
            flags=re.S,
        )
    else:
        text = text.replace("\n};", "\n" + block + "};", 1)
    path.write_text(text, encoding="utf-8", newline="\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    topics = {t["id"]: t for t in bt.parse()}
    blocks: dict[int, str] = {}
    checks: dict[str, dict] = {}
    total_add = 0
    errors = []

    for tid, task_list in sorted(NEW.items()):
        topic = topics[tid]
        need = planned_count(coding_count(topic))
        chosen = task_list[:need]
        # если в NEW меньше чем need — берём все
        if len(task_list) < need:
            chosen = task_list
        rendered = []
        base_idx = len(topic["tasks"])
        for i, task in enumerate(chosen, start=1):
            err = verify_task(task)
            if err:
                errors.append(f"{tid} +{i}: {err}")
                continue
            new_id = f"{tid}.{base_idx + i}"
            if task.get("check"):
                checks[new_id] = task["check"]
            rendered.append(render_task(task))
            total_add += 1
        if rendered:
            blocks[tid] = "\n".join(rendered)

    print(f"topics with additions: {len(blocks)}; new tasks: {total_add}")
    if errors:
        print("ERRORS:")
        for e in errors:
            print(" ", e)
        sys.exit(1)

    missing = [i for i in range(1, 51) if i not in NEW]
    if missing:
        print("WARNING: no NEW content for topics:", missing)

    if not args.write:
        for tid in sorted(blocks)[:3]:
            print("--- topic", tid, "---")
            print(blocks[tid][:400], "...")
        return

    text = SRC.read_text(encoding="utf-8")
    # защита от повторного запуска: маркер
    marker = "<!-- coding-practice-batch-2026-07-20 -->"
    if marker in text:
        print("Already injected; abort")
        sys.exit(2)
    new_text = inject(text, blocks)
    # маркер в конец файла
    new_text = new_text.rstrip() + "\n\n" + marker + "\n"
    SRC.write_text(new_text, encoding="utf-8", newline="\n")
    update_checks(CHECKS, checks)
    print(f"updated {SRC}")
    print(f"checks added: {len(checks)}")


if __name__ == "__main__":
    main()
