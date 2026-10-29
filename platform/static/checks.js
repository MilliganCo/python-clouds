/* checks.js — переопределения автопроверки для отдельных заданий.
 * Формат: CHECKS[id] = {
 *   append: "код-проверка, дописывается после решения пользователя",
 *   expect: "ожидаемый stdout (точное сравнение после нормализации)",
 * }
 * Для заданий без записи здесь работает общий механизм:
 *   - «определить вывод» — сравнение введённого текста с эталоном;
 *   - «дописать код» / «исправить ошибку» — stdout решения сравнивается
 *     со stdout эталонной программы;
 *   - остальное — самопроверка по эталону.
 * Ожидаемые значения ниже проверены в CPython (см. коллекцию).
 */
window.CHECKS = {
"16.8": {"append": "assert out == 'ok. ok!'\nassert tag('hi') == 'hi.'\nassert tag('hi', '?') == 'hi?'\nprint(\"OK\")", "expect": "ok. ok!\nOK"},
"48.2": {"append": "assert only_letters('abc') is True\nassert only_letters('') is False\nassert only_letters('я') is False\nassert only_letters('a b') is False\nprint(\"OK\")", "expect": "True\nFalse\nOK"},
"48.4": {"append": "assert first_number('x=007; 9') == '007'\nassert first_number('-3.5') == '3'\nassert first_number('') is None\nprint(\"OK\")", "expect": "42\nNone\nOK"},
"49.2": {"append": "assert row_to_dict(['a', 'b'], ['1', '2']) == {'a': '1', 'b': '2'}\nassert row_to_dict([], []) == {}\nprint(\"OK\")", "expect": "{'name': 'Ada', 'score': '10'}\nOK"},
"49.4": {"append": "assert scores([{'score': '-3'}, {'score': '0'}]) == [-3, 0]\nassert scores([]) == []\nprint(\"OK\")", "expect": "[10, 7]\nOK"},
  /* ── «написать функцию»: юнит-проверки ── */
  "25.3": {
    append: "assert total([1, 2, 3, 4]) == 10\nassert total([]) == 0\nassert total([7]) == 7\nprint(\"OK\")",
    expect: "OK",
  },

  /* ── «исправить ошибку», где эталон сам ничего не печатает ── */
  "16.3": {
    append: "assert collect(1) == [1]\nassert collect(2) == [2]\nprint(\"OK\")",
    expect: "OK",
  },

  /* ── «дописать код», где слияние с эталоном не работает механически ── */

  /* ── новые coding-этапы (practice) ── */
  "16.7": {
    append: "assert append_item(1) == [1]\nassert append_item(2) == [2]\na = []\nassert append_item(3, a) is a and a == [3]\nprint('OK')",
    expect: 'OK',
  },
  "25.6": {
    append: "assert fact(0) == 1\nassert fact(1) == 1\nassert fact(5) == 120\nprint('OK')",
    expect: 'OK',
  },
  "52.3": {
    "append": "import pandas as pd\n_frame = pd.DataFrame({'name': ['Ада', 'Боб', 'Вера'], 'score': [10, 7, 10]}, index=[20, 10, 40])\n_before = _frame.copy()\n_actual = names_above(_frame, 10)\nassert _actual == ['Ада', 'Вера'], f'При пороге 10 ожидалось [\"Ада\", \"Вера\"], получено {_actual!r}'\n_actual = names_above(_frame, 11)\nassert _actual == [], f'Выше 11 нет строк, получено {_actual!r}'\n_actual = names_above(_frame, 7)\nassert _actual == ['Ада', 'Боб', 'Вера'], f'Граница 7 включается, получено {_actual!r}'\n_empty = pd.DataFrame(columns=['name', 'score'])\n_actual = names_above(_empty, 0)\nassert _actual == [], f'Для пустой таблицы ожидалось [], получено {_actual!r}'\npd.testing.assert_frame_equal(_frame, _before)\nprint('OK')",
    "expect": "OK"
  },
  "52.9": {
    "append": "from copy import deepcopy\n_values = [' ЧАЙ ', None, '', '   ', 'Кофе']\n_before = deepcopy(_values)\n_actual = clean_labels(_values)\nassert _actual == ['чай', 'без имени', 'без имени', 'без имени', 'кофе'], f'Неверная очистка: {_actual!r}'\n_actual = clean_labels(['0', 'None', ' A.B '])\nassert _actual == ['0', 'none', 'a.b'], f'Непустой текст не теряется: {_actual!r}'\n_actual = clean_labels([])\nassert _actual == [], f'Для [] ожидалось [], получено {_actual!r}'\nassert _values == _before, 'Исходный список не должен меняться'\nprint('OK')",
    "expect": "OK"
  },

};
