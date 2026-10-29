# -*- coding: utf-8 -*-
"""Декларативные проектные курсы и чистые helper-функции доступности."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import content_generation

CONTENT_SNAPSHOT=content_generation.process_snapshot(Path(__file__).resolve().parent)


STATUS_LABELS = {
    "unavailable": "недоступен",
    "available": "доступен",
    "started": "начат",
    "waiting": "ожидает изучения нужных тем",
    "continue": "можно продолжить",
    "completed": "завершён",
}


TOPIC_TITLES = {
    0: "Основы синтаксиса Python",
    1: "Переменные и типы данных",
    2: "Числа и арифметические операции",
    3: "Первые функции",
    4: "Строки",
    5: "Логические значения",
    6: "Условные операторы",
    7: "Циклы for и while",
    8: "Списки",
    9: "Кортежи",
    10: "Словари",
    11: "Множества",
    12: "Ввод и вывод",
    13: "Функции подробнее",
    14: "Область видимости переменных",
    15: "Аргументы функций",
    16: "Значения по умолчанию",
    17: "Работа с файлами",
    18: "Исключения",
    19: "Списковые включения",
    20: "Словарные включения",
    21: "Сортировка",
    22: "Lambda-функции",
    23: "Работа с модулями",
    24: "Даты и время",
    25: "Рекурсия и простые алгоритмы",
    26: "Работа с JSON",
    27: "Итераторы",
    28: "Генераторы",
    29: "Декораторы",
    30: "Замыкания",
    31: "Контекстные менеджеры",
    32: "Классы и объекты",
    33: "Наследование и полиморфизм",
    34: "Магические методы",
    35: "Свойства @property",
    36: "Dataclasses",
    37: "Аннотации типов",
    38: "Изменяемые объекты и копирование",
    39: "Пользовательские исключения",
    40: "Сложность алгоритмов",
    41: "Срезы",
    42: "zip и enumerate",
    43: "Форматирование строк",
    44: "collections: Counter и defaultdict",
    45: "PEP 8 и pip",
    46: "pathlib: пути к файлам",
    47: "random и secrets",
    48: "Регулярные выражения (re)",
    49: "CSV: табличные данные",
    50: "argparse: аргументы командной строки",
    51: "sqlite3: мини-база данных",
    52: "pandas: основы работы с таблицами",
    53: "pandas: надёжные аналитические пайплайны",
    56: "openpyxl: отчёты Excel без потери исходника",
    60: "matplotlib: графики с понятным смыслом",
}


PROJECT_COURSES = [
    {
        "id": "chatbot_to_telegram",
        "track_order": 1,
        "unlock_topics": [1],
        "title": "Бот-собеседник → Telegram-бот",
        "short_title": "Бот-собеседник",
        "quest_label": "Квест связи",
        "emblem": "bot",
        "accent": "cyan",
        "description": "От консольного приветствия до простого бота с командами и заготовкой под Telegram.",
        "final_result": "Консольный бот с профилем пользователя, командами, историей и отдельной функцией-обработчиком сообщений.",
        "intro": "Первый квест трека: возвращайтесь к одной программе после новых тем и постепенно превращайте её в помощника.",
        "skills": ["strings", "conditions", "dicts", "functions", "files", "json", "modules"],
        "stages": [
            {
                "id": "hello_name",
                "title": "Персональное приветствие",
                "summary": "Бот спрашивает имя и отвечает лично.",
                "requirements": {"topics": [1]},
                "desired_topics": [4, 12],
                "return_after_topic": 1,
                "new_knowledge": "переменные, input() и простая строковая склейка",
                "task": "Сохраните имя пользователя в переменную и напечатайте персональное приветствие.",
                "starter_code": "name = input('Как вас зовут? ')\nprint('Привет!')\n",
                "hints": [
                    "Сохраните результат input() в переменную name.",
                    "Соедините строку приветствия и имя через + или f-строку.",
                    "print может принять сразу несколько частей текста подряд.",
                ],
                "check": {
                    "append": "\nprint('\\n__CHECK__')\n",
                    "expect_contains": ["input", "print", "name"],
                    "forbid": ["telegram", "requests"],
                },
                "return_message": "Вы прошли первую тему. Можно начать первый квест — бота, который спросит имя и ответит лично.",
                "completion_message": "У бота появилась первая личная реплика. Дальше он научится отвечать по-разному.",
            },
            {
                "id": "conditions",
                "title": "Разные ответы по возрасту",
                "summary": "Бот использует условия и выбирает ответ.",
                "requirements": {"topics": [6]},
                "desired_topics": [2, 5],
                "return_after_topic": 6,
                "new_knowledge": "условные операторы",
                "task": "Добавьте вопрос о возрасте и разные ответы для двух возрастных групп.",
                "starter_code": "name = input('Как вас зовут? ')\nprint('Привет, ' + name)\nage = int(input('Сколько вам лет? '))\n# добавьте if/else ниже\n",
                "hints": [
                    "Возраст нужно превратить в число через int().",
                    "Используйте if age < 18: и ветку else.",
                    "В каждой ветке напечатайте отдельную фразу.",
                ],
                "check": {
                    "expect_contains": ["if", "else", "age", "int("],
                    "forbid": ["telegram"],
                },
                "return_message": "Вы изучили условия. Теперь можно вернуться к вашему боту и научить его отвечать по-разному.",
                "completion_message": "Бот уже реагирует на данные пользователя, а не просто печатает один текст.",
            },
            {
                "id": "commands",
                "title": "Команды и функции",
                "summary": "Команды бота вынесены в функции и словарь.",
                "requirements": {"topics": [10, 13]},
                "desired_topics": [15],
                "return_after_topic": 13,
                "new_knowledge": "функции и словари",
                "task": "Сделайте функцию обработки команды и словарь доступных команд.",
                "starter_code": "def greet(name):\n    return 'Привет, ' + name\n\ncommands = {\n    '/start': 'начать разговор',\n    '/help': 'показать помощь',\n}\n\nprint(greet('Аня'))\n",
                "hints": [
                    "Функция handle_command(command) может возвращать строку ответа.",
                    "Проверяйте наличие команды через command in commands.",
                    "Для неизвестной команды верните понятную подсказку.",
                ],
                "check": {
                    "append": "\nassert callable(handle_command)\nassert isinstance(commands, dict)\nassert handle_command('/help')\nassert handle_command('/unknown')\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После функций и словарей бот может получить настоящий список команд.",
                "completion_message": "У бота появилась структура: команды теперь не размазаны по всему коду.",
            },
            {
                "id": "profile_file",
                "title": "Профиль и история",
                "summary": "Бот сохраняет маленький профиль в файл.",
                "requirements": {"topics": [17, 18]},
                "desired_topics": [26],
                "return_after_topic": 17,
                "new_knowledge": "файлы и обработка ошибок",
                "task": "Сохраните профиль пользователя в файл и обработайте ситуацию, когда файла ещё нет.",
                "starter_code": "profile = {'name': 'Аня', 'visits': 1}\n# сохраните профиль в profile.txt\n",
                "hints": [
                    "Используйте with open(..., 'w', encoding='utf-8').",
                    "Для чтения добавьте try/except FileNotFoundError.",
                    "Пока можно хранить данные обычным текстом.",
                ],
                "check": {
                    "expect_contains": ["with open", "try", "except", "profile"],
                    "forbid": ["eval("],
                },
                "return_message": "Вы прошли файлы. Теперь бот может помнить профиль между запусками.",
                "completion_message": "Проект перестал быть одноразовым: состояние можно восстановить.",
            },
            {
                "id": "telegram_adapter",
                "title": "Адаптер сообщений",
                "summary": "Логика отделена от ввода-вывода, чтобы позже подключить Telegram.",
                "requirements": {"topics": [23, 26]},
                "desired_topics": [28],
                "return_after_topic": 23,
                "new_knowledge": "модули и JSON",
                "task": "Сделайте функцию handle_message(text, profile), которая возвращает ответ. Внешний API пока не нужен.",
                "starter_code": "import json\n\nprofile = {'name': 'Аня'}\n\ndef handle_message(text, profile):\n    return 'Пока не знаю такую команду'\n\nprint(handle_message('/start', profile))\n",
                "hints": [
                    "Не подключайте Telegram API на этом этапе.",
                    "Функция должна принимать текст и профиль, а возвращать строку.",
                    "JSON пригодится для сохранения профиля.",
                ],
                "check": {
                    "append": "\nassert isinstance(handle_message('/start', profile), str)\nassert isinstance(handle_message('/help', profile), str)\nassert json.dumps(profile, ensure_ascii=False)\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После модулей можно отделить логику бота от способа доставки сообщений.",
                "completion_message": "Финальная версия готова к подключению реального Telegram-слоя без переписывания ядра.",
            },
        ],
    },
    {
        "id": "text_analyzer",
        "track_order": 3,
        "unlock_topics": [10],
        "title": "Анализатор текста и информации",
        "short_title": "Анализатор текста",
        "quest_label": "Квест смысла",
        "emblem": "analyzer",
        "accent": "amber",
        "description": "Инструмент, который считает слова, частоты, фильтрует шум и экспортирует отчёт.",
        "final_result": "Небольшой анализатор текста с чтением файла, частотами, сортировкой и JSON-отчётом.",
        "intro": "Третий квест трека: после словарей можно собрать настоящий текстовый инструмент.",
        "skills": ["strings", "lists", "dicts", "files", "json", "collections"],
        "stages": [
            {
                "id": "basic_counts",
                "title": "Длина и слова",
                "summary": "Считаем символы и слова.",
                "requirements": {"topics": [4]},
                "return_after_topic": 10,
                "new_knowledge": "строки и split()",
                "task": "Создайте функцию analyze_basic(text), которая возвращает словарь с длиной текста и числом слов.",
                "starter_code": "def analyze_basic(text):\n    return {}\n",
                "hints": ["len(text) считает символы.", "text.split() разбивает по пробелам."],
                "check": {
                    "append": "\nres = analyze_basic('мама мыла раму')\nassert res['chars'] == 14\nassert res['words'] == 3\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "Словари освоены — можно открыть третий квест: анализатор текста.",
                "completion_message": "Инструмент уже умеет выдавать две полезные метрики.",
            },
            {
                "id": "normalize_search",
                "title": "Нормализация и поиск",
                "summary": "Приводим текст к нижнему регистру и ищем слово.",
                "requirements": {"topics": [6]},
                "return_after_topic": 6,
                "new_knowledge": "условия",
                "task": "Добавьте contains_word(text, word), чтобы поиск не зависел от регистра.",
                "starter_code": "def contains_word(text, word):\n    return False\n",
                "hints": ["Используйте lower() для текста и слова.", "Сравнивайте слово с отдельными словами текста, а не со всей строкой целиком."],
                "check": {
                    "append": "\nassert contains_word('Python любит текст', 'python') is True\nassert contains_word('Python любит текст', 'java') is False\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После условий анализатор может отвечать на вопрос, найдено слово или нет.",
                "completion_message": "Поиск стал устойчивее к регистру.",
            },
            {
                "id": "frequencies",
                "title": "Частоты слов",
                "summary": "Словарь хранит счётчики слов.",
                "requirements": {"topics": [8, 10]},
                "return_after_topic": 10,
                "new_knowledge": "списки и словари",
                "task": "Напишите word_freq(text), которая возвращает словарь частот.",
                "starter_code": "def word_freq(text):\n    freq = {}\n    return freq\n",
                "hints": ["Идите циклом по словам.", "Если слова нет в словаре, создайте счётчик 0."],
                "check": {
                    "append": "\nassert word_freq('кот кот пёс') == {'кот': 2, 'пёс': 1}\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "Вы прошли словари. Теперь анализатор может считать частоты.",
                "completion_message": "Появилась главная аналитическая часть проекта.",
            },
            {
                "id": "file_report",
                "title": "Отчёт из файла",
                "summary": "Читаем текст из файла и сортируем результат.",
                "requirements": {"topics": [17, 18, 21]},
                "return_after_topic": 17,
                "new_knowledge": "файлы, исключения и сортировка",
                "task": "Сделайте read_text(path) и top_words(freq, n), чтобы читать файл и показывать самые частые слова.",
                "starter_code": "def read_text(path):\n    return ''\n\ndef top_words(freq, n=3):\n    return []\n",
                "hints": ["Файл открывайте через with open(...).", "sorted(..., key=..., reverse=True) поможет с топом."],
                "check": {
                    "append": "\nassert top_words({'a': 2, 'b': 5}, 1) == [('b', 5)]\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После файлов анализатор может работать с реальными текстами, а не только со строкой в коде.",
                "completion_message": "Инструмент стал похож на утилиту для настоящего текста.",
            },
            {
                "id": "json_export",
                "title": "Экспорт результата",
                "summary": "Сохраняем отчёт в JSON.",
                "requirements": {"topics": [26, 44]},
                "return_after_topic": 26,
                "new_knowledge": "JSON и Counter",
                "task": "Соберите make_report(text) и export_report(report), возвращающий JSON-строку.",
                "starter_code": "import json\nfrom collections import Counter\n\ndef make_report(text):\n    return {}\n\ndef export_report(report):\n    return json.dumps(report, ensure_ascii=False)\n",
                "hints": ["Класс Counter из collections умеет считать частоты элементов списка.", "JSON-строка должна сохранять кириллицу."],
                "check": {
                    "append": "\nreport = make_report('кот кот пёс')\nassert report['words'] == 3\nassert 'кот' in export_report(report)\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После JSON анализатор может отдавать результат другим программам.",
                "completion_message": "Финальный анализатор готов: считает, сортирует и экспортирует.",
            },
        ],
    },
    {
        "id": "habit_tracker",
        "track_order": 4,
        "unlock_topics": [13],
        "title": "Трекер привычек и личной статистики",
        "short_title": "Трекер привычек",
        "quest_label": "Квест ритма",
        "emblem": "habits",
        "accent": "mint",
        "description": "От одного значения до недельного отчёта о привычке.",
        "final_result": "Трекер с дневными значениями, статистикой, сохранением и отчётом.",
        "intro": "Четвёртый квест: функции и списки превращаются в личный инструмент статистики.",
        "skills": ["numbers", "lists", "dicts", "functions", "files", "dates"],
        "stages": [
            {
                "id": "single_value",
                "title": "Первое значение",
                "summary": "Сохраняем один день привычки.",
                "requirements": {"topics": [1, 2]},
                "return_after_topic": 13,
                "new_knowledge": "числа",
                "task": "Создайте переменную minutes и напечатайте короткую оценку дня.",
                "starter_code": "minutes = 20\nprint('Сегодня:', minutes, 'минут')\n",
                "hints": ["Начните с одной числовой переменной.", "print может принимать несколько аргументов."],
                "check": {"expect_contains": ["minutes", "print"]},
                "return_message": "После функций открывается четвёртый квест — трекер привычек.",
                "completion_message": "Первый день привычки зафиксирован.",
            },
            {
                "id": "list_stats",
                "title": "Список и среднее",
                "summary": "Считаем сумму и среднее за несколько дней.",
                "requirements": {"topics": [8, 13]},
                "return_after_topic": 13,
                "new_knowledge": "списки и функции",
                "task": "Напишите stats(values), которая возвращает сумму и среднее.",
                "starter_code": "def stats(values):\n    return {'total': 0, 'avg': 0}\n",
                "hints": ["sum(values) считает сумму.", "Не делите на ноль для пустого списка."],
                "check": {
                    "append": "\nassert stats([10, 20, 30])['avg'] == 20\nassert stats([])['avg'] == 0\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После функций трекер может считать статистику за период.",
                "completion_message": "В проекте появилась повторно используемая функция статистики.",
            },
            {
                "id": "weekly_compare",
                "title": "Сравнение недель",
                "summary": "Словари помогают хранить дни недели.",
                "requirements": {"topics": [10, 21, 42]},
                "return_after_topic": 42,
                "new_knowledge": "словари, сортировка, enumerate",
                "task": "Сделайте best_day(days), которая возвращает день с максимальным значением.",
                "starter_code": "def best_day(days):\n    return None\n",
                "hints": ["days.items() даёт пары день-значение.", "max(..., key=...) выбирает лучшую пару."],
                "check": {
                    "append": "\nassert best_day({'пн': 10, 'вт': 25}) == 'вт'\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После словарей трекер может понимать, какой день был лучшим.",
                "completion_message": "Отчёт стал полезнее: теперь видно сильные дни.",
            },
            {
                "id": "save_json",
                "title": "Сохранение истории",
                "summary": "История привычки сохраняется в JSON.",
                "requirements": {"topics": [17, 18, 26]},
                "return_after_topic": 26,
                "new_knowledge": "файлы, исключения, JSON",
                "task": "Напишите save_data(data, path) и load_data(path) для JSON-файла.",
                "starter_code": "import json\n\ndef save_data(data, path):\n    pass\n\ndef load_data(path):\n    return {}\n",
                "hints": ["json.dump пишет объект в файл.", "FileNotFoundError можно обработать и вернуть пустой словарь."],
                "check": {"expect_contains": ["json", "with open", "FileNotFoundError"]},
                "return_message": "После JSON трекер может пережить перезапуск программы.",
                "completion_message": "Данные теперь не теряются между запусками.",
            },
            {
                "id": "final_report",
                "title": "Недельный отчёт",
                "summary": "Форматируем понятный текстовый отчёт.",
                "requirements": {"topics": [24, 43, 44]},
                "return_after_topic": 43,
                "new_knowledge": "даты, форматирование, Counter/defaultdict",
                "task": "Соберите make_week_report(data), которая возвращает красивую строку отчёта.",
                "starter_code": "def make_week_report(data):\n    return ''\n",
                "hints": ["f-строки помогают оформить числа.", "Добавьте сумму, среднее и лучший день."],
                "check": {
                    "append": "\ntext = make_week_report({'пн': 10, 'вт': 20})\nassert isinstance(text, str)\nassert '20' in text or '15' in text\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После форматирования строк трекер может выдавать аккуратный отчёт.",
                "completion_message": "Трекер привычек собран в законченный маленький продукт.",
            },
        ],
    },
    {
        "id": "generative_poster",
        "track_order": 2,
        "unlock_topics": [7],
        "title": "Генеративная графика и мини-рисовалка",
        "short_title": "Генеративный постер",
        "quest_label": "Квест холста",
        "emblem": "poster",
        "accent": "violet",
        "description": "Генерация SVG-постера из координат, циклов, функций и палитр.",
        "final_result": "Программа создаёт SVG-узор, который можно сохранить как файл.",
        "intro": "Второй квест трека: после циклов можно рисовать узоры кодом — без тяжёлых библиотек.",
        "skills": ["numbers", "loops", "functions", "random", "files", "formatting"],
        "stages": [
            {
                "id": "coordinates",
                "title": "Координаты",
                "summary": "Один SVG-круг по координатам.",
                "requirements": {"topics": [1, 2]},
                "return_after_topic": 7,
                "new_knowledge": "числа и строки",
                "task": "Соберите строку SVG с одним кругом.",
                "starter_code": "x = 50\ny = 50\n# соберите f-строку с тегом <circle cx=... cy=... r=\"20\" /> и напечатайте её\n",
                "hints": ["SVG можно собрать как обычную строку.", "Координаты — числа внутри атрибутов."],
                "check": {"expect_contains": ["<circle", "cx", "cy"]},
                "return_message": "Циклы открывают второй квест — генеративный постер. Можно поставить первую фигуру на холст.",
                "completion_message": "Постер начинается с первой фигуры.",
            },
            {
                "id": "pattern_loop",
                "title": "Повторяющийся узор",
                "summary": "Цикл создаёт несколько фигур.",
                "requirements": {"topics": [7]},
                "return_after_topic": 7,
                "new_knowledge": "циклы",
                "task": "Создайте список SVG-кругов в цикле.",
                "starter_code": "shapes = []\nfor i in range(5):\n    pass  # добавьте в shapes круг с cx, зависящим от i\nprint('\\n'.join(shapes))\n",
                "hints": ["Список shapes хранит строки фигур.", "join соединяет фигуры в один текст."],
                "check": {"expect_contains": ["for", "range", "append"]},
                "return_message": "После циклов постер может получить повторяющийся ритм.",
                "completion_message": "Одна фигура превратилась в узор.",
            },
            {
                "id": "draw_function",
                "title": "Функция фигуры",
                "summary": "Логика рисования вынесена в функцию.",
                "requirements": {"topics": [13, 15]},
                "return_after_topic": 13,
                "new_knowledge": "функции и аргументы",
                "task": "Напишите circle(x, y, r, color), которая возвращает SVG-строку.",
                "starter_code": "def circle(x, y, r, color):\n    return ''\n",
                "hints": ["Функция должна возвращать строку, а не печатать.", "Передайте цвет как параметр."],
                "check": {
                    "append": "\nassert '<circle' in circle(10, 20, 5, 'red')\nassert 'red' in circle(10, 20, 5, 'red')\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После функций рисование можно переиспользовать.",
                "completion_message": "Появился строительный блок для будущего постера.",
            },
            {
                "id": "random_palette",
                "title": "Случайная палитра",
                "summary": "Модуль random выбирает цвета.",
                "requirements": {"topics": [8, 23]},
                "return_after_topic": 23,
                "new_knowledge": "списки и модули",
                "task": "Создайте palette и функцию pick_color(), которая выбирает цвет.",
                "starter_code": "import random\npalette = ['red', 'blue', 'gold']\n\ndef pick_color():\n    return None\n",
                "hints": ["random.choice берёт случайный элемент списка.", "Палитру удобно хранить списком."],
                "check": {
                    "append": "\nassert pick_color() in palette\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После модулей постер может стать генеративным.",
                "completion_message": "У постера появилась вариативность.",
            },
            {
                "id": "save_svg",
                "title": "Сохранение SVG",
                "summary": "Готовый постер записывается в файл.",
                "requirements": {"topics": [17, 43]},
                "return_after_topic": 17,
                "new_knowledge": "файлы и форматирование",
                "task": "Соберите SVG-документ и сохраните его в poster.svg.",
                "starter_code": "def build_svg(shapes):\n    body = ''\n    # объедините shapes и оберните в тег <svg width=\"200\" height=\"200\" ...>\n    return ''\n",
                "hints": ["SVG-документ начинается с тега <svg>.", "with open(..., 'w') сохранит результат."],
                "check": {
                    "append": "\nassert build_svg(['<circle />']).startswith('<svg')\nassert '</svg>' in build_svg([])\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После файлов постер можно сохранить как настоящий артефакт.",
                "completion_message": "Генеративный постер готов к открытию в браузере.",
            },
        ],
    },
    {
        "id": "python_game",
        "track_order": 5,
        "unlock_topics": [18],
        "title": "Игра или симуляция на Python",
        "short_title": "Мини-игра",
        "quest_label": "Квест игры",
        "emblem": "game",
        "accent": "coral",
        "description": "От угадывания числа до структурированной игры с состоянием.",
        "final_result": "Консольная игра с циклом, функциями, состоянием и обработкой ошибок.",
        "intro": "Пятый, самый плотный квест: игра растёт до классов и безопасного ввода.",
        "skills": ["conditions", "loops", "functions", "dicts", "exceptions", "classes"],
        "stages": [
            {
                "id": "guess_once",
                "title": "Угадай число: один ход",
                "summary": "Игрок делает одну попытку.",
                "requirements": {"topics": [2, 6]},
                "return_after_topic": 18,
                "new_knowledge": "числа и условия",
                "task": "Сравните guess и secret, напечатайте результат.",
                "starter_code": "secret = 7\nguess = int(input('Ваш вариант: '))\n# добавьте проверку\n",
                "hints": ["Используйте if guess == secret.", "Добавьте отдельную ветку для промаха."],
                "check": {"expect_contains": ["if", "guess", "secret"]},
                "return_message": "Исключения освоены — можно начать финальный квест трека: мини-игру.",
                "completion_message": "У игры появился выигрыш и проигрыш.",
            },
            {
                "id": "game_loop",
                "title": "Игровой цикл",
                "summary": "Игрок пробует несколько раз.",
                "requirements": {"topics": [7]},
                "return_after_topic": 7,
                "new_knowledge": "циклы",
                "task": "Добавьте цикл на несколько попыток и остановку при победе.",
                "starter_code": "secret = 7\nfor attempt in range(3):\n    guess = int(input('Ваш вариант: '))\n    # проверьте ответ\n",
                "hints": ["break выходит из цикла.", "attempt можно использовать для номера попытки."],
                "check": {"expect_contains": ["for", "range", "break"]},
                "return_message": "После циклов игра может дать несколько попыток.",
                "completion_message": "Теперь игра длится больше одного хода.",
            },
            {
                "id": "functions_state",
                "title": "Функции и состояние",
                "summary": "Состояние игры хранится в словаре.",
                "requirements": {"topics": [10, 13]},
                "return_after_topic": 13,
                "new_knowledge": "функции и словари",
                "task": "Напишите check_guess(secret, guess) и обновляйте state['attempts'].",
                "starter_code": "state = {'attempts': 0}\n\ndef check_guess(secret, guess):\n    return 'miss'\n",
                "hints": ["Функция возвращает строку результата.", "Словарь state хранит счётчик попыток."],
                "check": {
                    "append": "\nassert check_guess(5, 5) in ('win', 'победа')\nassert isinstance(state, dict)\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После функций игру можно разделить на понятные части.",
                "completion_message": "Логика проверки отделилась от интерфейса.",
            },
            {
                "id": "safe_input",
                "title": "Безопасный ввод",
                "summary": "Ошибки ввода не ломают игру.",
                "requirements": {"topics": [18]},
                "return_after_topic": 18,
                "new_knowledge": "исключения",
                "task": "Напишите parse_guess(text), которая возвращает число или None.",
                "starter_code": "def parse_guess(text):\n    return None\n",
                "hints": ["int(text) может вызвать ValueError.", "except ValueError должен вернуть None."],
                "check": {
                    "append": "\nassert parse_guess('10') == 10\nassert parse_guess('abc') is None\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После исключений игра может спокойно пережить неправильный ввод.",
                "completion_message": "Игра стала устойчивее к ошибкам игрока.",
            },
            {
                "id": "game_class",
                "title": "Класс игры",
                "summary": "Игра собрана в объект.",
                "requirements": {"topics": [32, 36]},
                "return_after_topic": 32,
                "new_knowledge": "классы и dataclasses",
                "task": "Создайте класс GuessGame с secret, attempts и методом check().",
                "starter_code": "class GuessGame:\n    def __init__(self, secret):\n        self.secret = secret\n        self.attempts = 0\n\n    def check(self, guess):\n        return 'miss'\n",
                "hints": ["self.attempts увеличивается внутри метода.", "Метод check возвращает результат хода."],
                "check": {
                    "append": "\ng = GuessGame(3)\nassert g.check(3) in ('win', 'победа')\nassert g.attempts >= 1\nprint('OK')",
                    "expect": "OK",
                },
                "return_message": "После классов можно собрать игру в один объект с состоянием.",
                "completion_message": "Финальная игра имеет структуру, которую можно расширять.",
            },
        ],
    },
]


def all_courses():
    courses = deepcopy(PROJECT_COURSES) + CONTENT_SNAPSHOT.json('practice_quests.json')
    courses.sort(key=lambda c: (c.get("track_order", 99), c["id"]))
    return courses


def course_unlock_topics(course):
    topics = course.get("unlock_topics")
    if topics is None:
        first = (course.get("stages") or [{}])[0]
        topics = list(first.get("requirements", {}).get("topics", []))
    return list(topics)


def course_unlocked(course, solved_topics):
    return set(course_unlock_topics(course)) <= set(solved_topics)


def unlock_topic_titles(course):
    return [TOPIC_TITLES.get(t, f"Тема {t}") for t in course_unlock_topics(course)]


def get_course(course_id):
    for course in all_courses():
        if course["id"] == course_id:
            return deepcopy(course)
    return None


def next_track_course(course_id):
    courses = [c for c in all_courses() if c.get('kind') != 'local_practice']
    for idx, course in enumerate(courses):
        if course["id"] == course_id and idx + 1 < len(courses):
            return deepcopy(courses[idx + 1])
    return None


def get_stage(course, stage_id):
    for stage in course["stages"]:
        if stage["id"] == stage_id:
            return deepcopy(stage)
    return None


def stage_index(course, stage_id):
    for idx, stage in enumerate(course["stages"]):
        if stage["id"] == stage_id:
            return idx
    return -1


def topic_totals(tasks_meta):
    totals = {}
    for task_id in tasks_meta:
        if task_id.startswith("C") or "." not in task_id:
            continue
        topic = int(task_id.split(".", 1)[0])
        totals[topic] = totals.get(topic, 0) + 1
    return totals


def completed_topics(solved_ids, tasks_meta):
    solved = set(solved_ids)
    totals = topic_totals(tasks_meta)
    done = {}
    for task_id in solved:
        if task_id.startswith("C") or "." not in task_id:
            continue
        topic = int(task_id.split(".", 1)[0])
        done[topic] = done.get(topic, 0) + 1
    return {topic for topic, total in totals.items() if done.get(topic, 0) >= total}


def stage_requirements_met(stage, solved_topics):
    required = set(stage.get("requirements", {}).get("topics", []))
    return required <= set(solved_topics)


def required_topic_titles(stage):
    return [TOPIC_TITLES.get(t, f"Тема {t}") for t in stage.get("requirements", {}).get("topics", [])]


def with_status_label(obj):
    data = dict(obj)
    data["status_label"] = STATUS_LABELS.get(data.get("status"), data.get("status", ""))
    return data
