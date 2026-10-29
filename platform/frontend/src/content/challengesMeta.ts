/**
 * Topic boss challenges — full content hand-port of static/challenges.js.
 * XP ids must stay in sync (legacy-drift contract).
 */

export type ChallengeContent = {
  id: string;
  topicId: number;
  title: string;
  prompt: string;
  answer: string;
  explanation: string;
  check: { append: string; expect: string };
};

export const CHALLENGES: readonly ChallengeContent[] = [
  {
    id: "C4.1",
    topicId: 4,
    title: "Приведи имя в порядок",
    prompt:
      "Напишите функцию `normalize_name`, которая получает имя с лишними пробелами и «прыгающим» регистром и возвращает его аккуратным: без пробелов по краям, первая буква заглавная, остальные строчные. Например, `'  анНА  '` → `'Анна'`.",
    answer:
      "def normalize_name(s):\n    # strip убирает пробелы, capitalize выправляет регистр\n    return s.strip().capitalize()",
    explanation:
      "Методы строк можно вызывать цепочкой: `strip()` возвращает строку без краевых пробелов, а `capitalize()` делает первую букву заглавной и опускает остальные. Каждый метод возвращает новую строку, поэтому цепочка безопасна.",
    check: {
      append:
        'assert normalize_name("  анНА  ") == "Анна"\nassert normalize_name("BOB") == "Bob"\nassert normalize_name("иван") == "Иван"\nprint("OK")',
      expect: "OK",
    },
  },
  {
    id: "C8.1",
    topicId: 8,
    title: "Уникальные по порядку",
    prompt:
      "Напишите функцию `unique_keep_order`, которая возвращает список уникальных элементов, сохраняя порядок их ПЕРВОГО появления: `[3, 1, 3, 2, 1]` → `[3, 1, 2]`.",
    answer:
      "def unique_keep_order(lst):\n    result = []\n    for item in lst:\n        # добавляем, только если ещё не встречали такое значение\n        if item not in result:\n            result.append(item)\n    return result",
    explanation:
      "Список `result` хранит порядок и одновременно служит проверкой «уже встречалось» через `in`. Дороже, чем `set()`, зато не требует темы про множества.",
    check: {
      append:
        "assert unique_keep_order([3, 1, 3, 2, 1]) == [3, 1, 2]\nassert unique_keep_order([]) == []\nassert unique_keep_order([5, 5, 5]) == [5]\nprint(\"OK\")",
      expect: "OK",
    },
  },
  {
    id: "C10.1",
    topicId: 10,
    title: "Словарь наизнанку",
    prompt:
      "Напишите функцию `invert`, которая «переворачивает» словарь: ключи становятся значениями, значения — ключами. `{'a': 1, 'b': 2}` → `{1: 'a', 2: 'b'}`. Считайте, что значения уникальны.",
    answer:
      "def invert(d):\n    result = {}\n    for key, value in d.items():\n        # меняем местами: значение становится ключом, ключ — значением\n        result[value] = key\n    return result",
    explanation:
      "`d.items()` даёт пары (ключ, значение); цикл собирает новый словарь, где они поменялись местами.",
    check: {
      append:
        'assert invert({"a": 1, "b": 2}) == {1: "a", 2: "b"}\nassert invert({}) == {}\nprint("OK")',
      expect: "OK",
    },
  },
  {
    id: "C13.1",
    topicId: 13,
    title: "FizzBuzz — классика собеседований",
    prompt:
      "Напишите функцию `fizzbuzz(n)`, возвращающую список строк для чисел от 1 до n: кратные 3 заменяются на `'Fizz'`, кратные 5 — на `'Buzz'`, кратные и 3 и 5 — на `'FizzBuzz'`, остальные — само число строкой. Это задание десятилетиями дают на собеседованиях!",
    answer:
      'def fizzbuzz(n):\n    result = []\n    for i in range(1, n + 1):\n        # проверяем сначала самый строгий случай\n        if i % 15 == 0:\n            result.append("FizzBuzz")\n        elif i % 3 == 0:\n            result.append("Fizz")\n        elif i % 5 == 0:\n            result.append("Buzz")\n        else:\n            result.append(str(i))\n    return result',
    explanation:
      "Главная ловушка — порядок проверок: кратность 15 нужно проверять ПЕРВОЙ, иначе 15 попадёт в ветку «кратно 3» и до «FizzBuzz» дело не дойдёт. Порядок веток if/elif — часть логики.",
    check: {
      append:
        'assert fizzbuzz(5) == ["1", "2", "Fizz", "4", "Buzz"]\nassert fizzbuzz(15)[-1] == "FizzBuzz"\nassert fizzbuzz(0) == []\nprint("OK")',
      expect: "OK",
    },
  },
  {
    id: "C19.1",
    topicId: 19,
    title: "Матрица в одну строку",
    prompt:
      "Напишите функцию `even_flat`, которая одним списковым включением разворачивает матрицу (список списков) в плоский список, оставляя только чётные числа: `[[1, 2], [3, 4]]` → `[2, 4]`.",
    answer:
      "def even_flat(matrix):\n    # два for разворачивают, if фильтрует\n    return [x for row in matrix for x in row if x % 2 == 0]",
    explanation:
      "Включение читается слева направо как вложенные циклы: внешний `for row in matrix`, внутренний `for x in row`, затем фильтр `if`. Три действия — одна строка.",
    check: {
      append:
        "assert even_flat([[1, 2], [3, 4]]) == [2, 4]\nassert even_flat([[1, 3]]) == []\nassert even_flat([]) == []\nprint(\"OK\")",
      expect: "OK",
    },
  },
  {
    id: "C25.1",
    topicId: 25,
    title: "Развернуть матрёшку",
    prompt:
      "Напишите рекурсивную функцию `flatten`, которая разворачивает список с любой глубиной вложенности: `[1, [2, [3, 4]], 5]` → `[1, 2, 3, 4, 5]`. Подсказка: если элемент — список, разверните его тем же способом.",
    answer:
      "def flatten(nested):\n    result = []\n    for item in nested:\n        if isinstance(item, list):\n            # список внутри — разворачиваем рекурсивно\n            result.extend(flatten(item))\n        else:\n            result.append(item)\n    return result",
    explanation:
      "Рекурсия идеальна для структур неизвестной глубины: функция обрабатывает один уровень, а вложенные списки доверяет самой себе. Базовый случай неявный — список без вложенных списков просто копируется.",
    check: {
      append:
        "assert flatten([1, [2, [3, 4]], 5]) == [1, 2, 3, 4, 5]\nassert flatten([]) == []\nassert flatten([[[[7]]]]) == [7]\nprint(\"OK\")",
      expect: "OK",
    },
  },
  {
    id: "C28.1",
    topicId: 28,
    title: "Нарезка на куски",
    prompt:
      "Напишите генератор `chunks(lst, n)`, который выдаёт список кусками по n элементов: `chunks([1, 2, 3, 4, 5], 2)` → `[1, 2]`, `[3, 4]`, `[5]`. Так пакетами обрабатывают большие данные.",
    answer:
      "def chunks(lst, n):\n    # шаг range — размер куска, срез сам обрежет хвост\n    for i in range(0, len(lst), n):\n        yield lst[i:i + n]",
    explanation:
      "`range` с шагом n даёт начала кусков (0, n, 2n…), а срез `lst[i:i+n]` безопасен: выход за границу просто вернёт короткий хвост. `yield` делает функцию ленивой — куски создаются по запросу.",
    check: {
      append:
        'import types\ng = chunks([1, 2, 3, 4, 5], 2)\nassert isinstance(g, types.GeneratorType)\nassert list(g) == [[1, 2], [3, 4], [5]]\nassert list(chunks([], 3)) == []\nprint("OK")',
      expect: "OK",
    },
  },
  {
    id: "C32.1",
    topicId: 32,
    title: "Собери стек",
    prompt:
      "Напишите класс `Stack` (стопка «последним пришёл — первым ушёл») с методами: `push(x)` — положить, `pop()` — снять и вернуть верхний, `is_empty()` — пуста ли стопка. Внутри храните элементы в списке.",
    answer:
      "class Stack:\n    def __init__(self):\n        self._items = []\n\n    def push(self, x):\n        self._items.append(x)\n\n    def pop(self):\n        # pop списка снимает последний — это и есть вершина\n        return self._items.pop()\n\n    def is_empty(self):\n        return len(self._items) == 0",
    explanation:
      "Стек — базовая структура данных: так работает undo в редакторах и стек вызовов Python. Список с `append`/`pop` идеально подходит: обе операции за O(1). Подчёркивание в `_items` — соглашение «внутреннее поле».",
    check: {
      append:
        "s = Stack()\nassert s.is_empty()\ns.push(1)\ns.push(2)\nassert s.pop() == 2\nassert s.pop() == 1\nassert s.is_empty()\nprint(\"OK\")",
      expect: "OK",
    },
  },
];

/** Catalog XP rows — derived from CHALLENGES. */
export const CHALLENGE_XP_META: ReadonlyArray<{
  id: string;
  topicId: number;
  title: string;
}> = CHALLENGES.map((c) => ({
  id: c.id,
  topicId: c.topicId,
  title: c.title,
}));

export function findChallenge(id: string): ChallengeContent | null {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}
