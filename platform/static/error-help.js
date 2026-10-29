/* Static, optional error-learning examples. No model calls or grading changes. */
(function () {
  "use strict";
  const examples = {
  "NameError": {
    "title": "С чего начать при NameError",
    "reason": "Python не нашёл имя, к которому обращается код. Проверьте опечатку, регистр букв и место присваивания.",
    "step": "Найдите первое значение этого имени до строки ошибки. Если нужен буквальный текст, он должен быть в кавычках.",
    "code": "subject = 'Заметки'\nprint(subject)",
    "output": "Заметки"
  },
  "UnboundLocalError": {
    "title": "С чего начать при UnboundLocalError",
    "reason": "В момент чтения у локального имени нет доступного значения. Частая причина — присваивание внутри функции: без global/nonlocal оно делает имя локальным.",
    "step": "Проследите все ветки до чтения имени. Подумайте, должно ли значение прийти параметром; не добавляйте global автоматически.",
    "code": "def add_tip(amount):\n    return amount + 2\n\nprint(add_tip(6))",
    "output": "8"
  },
  "TypeError": {
    "title": "С чего начать при TypeError",
    "reason": "Операции или вызову могут не подходить типы значений либо набор аргументов. Причину уточняет сообщение Python.",
    "step": "Посмотрите реальные значения и их типы перед строкой ошибки. Не преобразуйте всё подряд: нужное действие определяется условием задания.",
    "code": "print(type('7').__name__)\nprint(type(7).__name__)",
    "output": "str\nint"
  },
  "TypeError_arguments": {
    "title": "Проверьте обязательные аргументы",
    "reason": "Сообщение о missing required argument означает, что вызову не хватило обязательного аргумента.",
    "step": "Сравните заголовок функции и место вызова. Проверьте позиционные и именованные аргументы; пример ниже показывает только общий принцип.",
    "code": "def label(word, ending):\n    return word + ending\n\nprint(label('День', '!'))",
    "output": "День!"
  },
  "IndexError": {
    "title": "С чего начать при IndexError",
    "reason": "Запрошенной позиции нет в последовательности. Для неотрицательных индексов первый элемент имеет номер 0, последний — len(...) - 1.",
    "step": "Проверьте длину и сам индекс в момент обращения. Пустая последовательность не содержит ни одного элемента; отрицательные индексы тоже имеют границу.",
    "code": "colors = ['синий', 'белый']\nprint(len(colors))\nprint(colors[1])",
    "output": "2\nбелый"
  },
  "KeyError": {
    "title": "С чего начать при KeyError",
    "reason": "Словарь не нашёл запрошенный ключ. Ключ и значение — разные части записи.",
    "step": "Сверьте написание ключа с данными. Решите по условию, нужно ли отклонить отсутствие или использовать запасное значение; не заменяйте любую ошибку нулём.",
    "code": "stock = {'чай': 2}\nprint('чай' in stock)\nprint(stock['чай'])",
    "output": "True\n2"
  },
  "ValueError": {
    "title": "С чего начать при ValueError",
    "reason": "Обычно тип аргумента допустим, но его значение не подходит действию или правилу функции. Конкретное требование ищите в сообщении.",
    "step": "Проверьте содержимое данных, а не только тип. Иногда по условию нужен отказ с ValueError — тогда важно, в каком месте его ожидали и обработали.",
    "code": "text = '14'\nprint(int(text) + 1)",
    "output": "15"
  },
  "ZeroDivisionError": {
    "title": "Проверьте делитель",
    "reason": "При делении /, // или вычислении остатка % делитель оказался равен нулю.",
    "step": "Посмотрите, откуда взялось это значение. По смыслу задачи ноль нужно отдельно обработать или отклонить; подстановка 1 меняет расчёт.",
    "code": "total = 9\ncount = 0\nprint('Делитель:', count)",
    "output": "Делитель: 0"
  },
  "SyntaxError": {
    "title": "С чего начать при SyntaxError",
    "reason": "Python не смог разобрать запись программы. Указанная позиция — место обнаружения, а причина иногда находится строкой выше.",
    "step": "Проверьте пары кавычек и скобок, двоеточие после заголовка блока и незавершённую предыдущую строку.",
    "code": "print('Солнце')",
    "output": "Солнце"
  },
  "IndentationError": {
    "title": "Разберите границы блока",
    "reason": "Отступы показывают, какие команды относятся к одному блоку. После заголовка def, if или цикла нужен блок с отступом.",
    "step": "Сравните строки одного уровня. В примере команда внутри функции сдвинута вправо, а вызов у левого края находится уже снаружи её тела.",
    "code": "def greet():\n    print('Здравствуйте')\n\ngreet()",
    "output": "Здравствуйте"
  },
  "IndentationError_unexpected": {
    "title": "Проверьте лишний отступ",
    "reason": "unexpected indent означает, что строка сдвинута вправо там, где Python не ожидает нового блока.",
    "step": "Если перед строкой нет заголовка блока, лишний отступ обычно не нужен. Не убирайте отступы во всей программе: внутри блока они имеют смысл.",
    "code": "word = 'Облако'\nprint(word)",
    "output": "Облако"
  },
  "TabError": {
    "title": "Не смешивайте табуляции и пробелы",
    "reason": "Отступы выглядят похожими, но состоят из разных символов: табуляций и пробелов.",
    "step": "Включите показ пробельных символов в редакторе и приведите отступы блока к одному виду, например четырём пробелам на уровень.",
    "code": "def number():\n    return 4\n\nprint(number())",
    "output": "4"
  },
  "AttributeError": {
    "title": "Проверьте значение слева от точки",
    "reason": "У объекта нет атрибута или метода с таким именем. У разных типов разные доступные действия.",
    "step": "Уточните тип объекта и написание имени после точки. Метод строки и метод списка нельзя переставлять местами только из-за похожего смысла.",
    "code": "word = 'облако'\nprint(word.upper())",
    "output": "ОБЛАКО"
  },
  "ModuleNotFoundError": {
    "title": "Проверьте имя и доступность модуля",
    "reason": "Интерпретатор не нашёл импортируемый модуль. Это может быть опечатка или отсутствие пакета именно в текущей среде.",
    "step": "Установка на вашем ПК не меняет состав серверного Python платформы. Сверьте условие и доступные библиотеки; при локальном запуске проверьте выбранный интерпретатор.",
    "code": "import math\nprint(math.isqrt(16))",
    "output": "4"
  },
  "FileNotFoundError": {
    "title": "Проверьте файл и среду запуска",
    "reason": "Файл или папка не найдены по пути в той среде, где работает Python. Файл вашего ПК не появляется в серверной среде автоматически.",
    "step": "Выполнения на платформе одноразовые: файл из прошлого запуска не переходит в следующий. В примере файл создаётся и читается одной программой; на ПК отдельно проверьте рабочую папку и папки в пути.",
    "code": "with open('lesson-note.txt', 'x', encoding='utf-8') as file:\n    file.write('Данные на месте')\nwith open('lesson-note.txt', encoding='utf-8') as file:\n    print(file.read())",
    "output": "Данные на месте"
  },
  "FileExistsError": {
    "title": "Не перезаписывайте существующий файл вслепую",
    "reason": "Создание нового файла или папки встретило уже существующее имя. Режим x специально защищает прежнее содержимое.",
    "step": "Проверьте путь и не вызвана ли запись дважды. Для нового опыта выберите новое имя; замена x на w или удаление файла не являются универсальным исправлением.",
    "code": "with open('lesson-sample.txt', 'x', encoding='utf-8') as file:\n    file.write('Пример')\ntry:\n    with open('lesson-sample.txt', 'x', encoding='utf-8') as file:\n        file.write('Новый текст')\nexcept FileExistsError:\n    print('Выберите другое имя файла')",
    "output": "Выберите другое имя файла"
  }
};
  for (const entry of Object.values(examples)) Object.freeze(entry);
  Object.freeze(examples);
  const esc = value => String(value ?? "").replace(/[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  const caseExamples = {
  "loop_filter": {
    "title": "Разрешение и запрет — два вопроса",
    "purpose": "Этот случай проверяет условие отбора: число может подходить под разрешение и одновременно попадать под запрет.",
    "step": "Для каждого числа отдельно ответьте: делится ли оно на нужное число и попадает ли под исключение? Затем решите, какие строки можно оставить. В маленькой аналогии другие делители: нужно делиться на 4, но не на 6.",
    "code": "for value in (8, 12):\n    print(value, value % 4 == 0, value % 6 == 0)",
    "output": "8 True False\n12 True True"
  },
  "loop_empty": {
    "title": "Когда добавлять нечего",
    "purpose": "Этот случай проверяет отсутствие подходящих чисел: результат должен оставаться числом, даже если ни одного добавления не произошло.",
    "step": "Посмотрите, какое значение есть у накопителя до перебора. Что получит вызывающий код, если тело цикла не выполнится ни разу? Числовой ноль, None и False — разные результаты, даже если сравнение иногда считает их равными.",
    "code": "values = []\ntotal = 0\nprint(len(values))\nprint(total)\nprint(type(total).__name__)",
    "output": "0\n0\nint"
  },
  "loop_boundary": {
    "title": "Последнее число действительно проверено?",
    "purpose": "Этот случай проверяет верхнюю границу: подходящее число на ней должно участвовать в результате, если условие говорит «включительно».",
    "step": "Выпишите фактические элементы range и сравните последний элемент с верхней границей из условия. Правая граница range не входит в перебор. В аналогии ниже проверьте, дошёл ли перебор до числа 9.",
    "code": "print(list(range(4, 9)))\nprint(9 in range(4, 9))",
    "output": "[4, 5, 6, 7, 8]\nFalse"
  },
  "growth_initial": {
    "title": "Цель могла быть достигнута заранее",
    "purpose": "Этот случай проверяет начальное состояние: исходное значение уже может находиться у цели или выше неё.",
    "step": "Проверьте условие завершения до первого изменения. В аналогии значение уже больше цели, хотя они не равны. Сколько удвоений действительно произошло к этому моменту? Не считайте само исходное состояние изменением.",
    "code": "current = 11\ntarget = 7\nprint(current >= target)\nprint(current == target)",
    "output": "True\nFalse"
  },
  "growth_threshold": {
    "title": "Достигнуть или перескочить порог",
    "purpose": "Этот случай проверяет достижение порога: остановиться нужно при значении не меньше цели, включая точное совпадение и перескок.",
    "step": "Выпишите несколько состояний и найдите первое, где порог уже достигнут. Сравните два вопроса: «равно цели?» и «не меньше цели?». Считайте переходы между состояниями, а не количество записанных чисел.",
    "code": "target = 10\nfor current in (3, 6, 12):\n    print(current, current == target, current >= target)",
    "output": "3 False False\n6 False False\n12 False True"
  },
  "growth_integer": {
    "title": "Большое целое нельзя округлять незаметно",
    "purpose": "Этот случай проверяет большой целый порог: преобразование во float может потерять последнюю единицу и изменить условие остановки.",
    "step": "Сравните исходное целое с результатом преобразования во float и обратно. Равенство округлённых значений не доказывает равенство исходных целых. Для удвоений и сравнений в этой задаче дробные числа не нужны.",
    "code": "target = 2 ** 60 + 1\nrounded = int(float(target))\nprint(target - rounded)\nprint(rounded >= target)\nprint(float(target) == float(target - 1))",
    "output": "1\nFalse\nTrue"
  }
};
  for (const entry of Object.values(caseExamples)) Object.freeze(entry);
  Object.freeze(caseExamples);
  const caseMap = {
  "7.8": {
    "Проверка: sum_multiples(16)": "loop_filter",
    "Проверка: sum_multiples(0)": "loop_empty",
    "Проверка: sum_multiples(1)": "loop_empty",
    "Проверка: sum_multiples(2)": "loop_empty",
    "Проверка: sum_multiples(3)": "loop_boundary",
    "Проверка: sum_multiples(5)": "loop_filter",
    "Проверка: sum_multiples(6)": "loop_boundary",
    "Проверка: sum_multiples(15)": "loop_filter",
    "Проверка: sum_multiples(18)": "loop_boundary",
    "Проверка: sum_multiples(30)": "loop_filter",
    "Проверка: sum_multiples(31)": "loop_filter",
    "Проверка: sum_multiples(33)": "loop_boundary"
  },
  "7.9": {
    "Проверка: growth_steps(3, 20)": "growth_threshold",
    "Проверка: growth_steps(5, 5)": "growth_initial",
    "Проверка: growth_steps(8, 2)": "growth_initial",
    "Проверка: growth_steps(1, 17)": "growth_threshold",
    "Проверка: growth_steps(2, 4)": "growth_threshold",
    "Проверка: growth_steps(2, 5)": "growth_threshold",
    "Проверка: growth_steps(3, 24)": "growth_threshold",
    "Проверка: growth_steps(1, 0)": "growth_initial",
    "Проверка: growth_steps(1, 1152921504606846977)": "growth_integer"
  }
};
  for (const group of Object.values(caseMap)) Object.freeze(group);
  Object.freeze(caseMap);

  function render(failure, { inCheck = false } = {}) {
    if (!failure || inCheck || (failure.source && failure.source !== "solution")) return "";
    const type = failure.type;
    if (typeof type !== "string" || type.includes("_") || !Object.hasOwn(examples, type)) return "";
    const message = typeof failure.message === "string" ? failure.message.slice(0, 400) : "";
    let key = type;
    if (type === "TypeError" && /missing .*required (?:positional|keyword-only) argument/i.test(message)) key = "TypeError_arguments";
    if (type === "IndentationError" && /unexpected indent/i.test(message)) key = "IndentationError_unexpected";
    const entry = examples[key];
    return `<details class="check-details learning-error-help">
      <summary>${esc(entry.title)}</summary>
      <p>${esc(entry.reason)}</p><p>${esc(entry.step)}</p>
      <p class="stat-note">Отдельный пример — не решение задания:</p>
      <pre>${esc(entry.code)}</pre>
      <p class="stat-note">Вывод примера:</p><pre>${esc(entry.output)}</pre>
    </details>`;
  }
  function renderCase(failure, { taskId } = {}) {
    if (!failure || failure.type !== "AssertionError" || failure.source !== "check"
        || typeof taskId !== "string" || !Object.hasOwn(caseMap, taskId)
        || typeof failure.message !== "string") return "";
    const firstLine = failure.message.slice(0, 200).split(/\r\n|\r|\n/, 1)[0];
    const group = caseMap[taskId];
    if (!Object.hasOwn(group, firstLine)) return "";
    const key = group[firstLine], entry = caseExamples[key];
    return `<details class="check-details learning-error-help learning-case-help" data-case-help="${key}">
      <summary>${esc(entry.title)}</summary>
      <p>${esc(entry.purpose)}</p><p>${esc(entry.step)}</p>
      <p class="stat-note">Отдельный пример — не решение задания:</p>
      <pre>${esc(entry.code)}</pre>
      <p class="stat-note">Вывод примера:</p><pre>${esc(entry.output)}</pre>
    </details>`;
  }
  function sourceHtml(failure, code, { inCheck = false } = {}) {
    if (!failure || inCheck || failure.source !== "solution" || typeof code !== "string") return "";
    const line = failure.line;
    if (!Number.isInteger(line) || line < 1) return "";
    const lines = code.split(/\r\n|\r|\n/);
    if (line > lines.length) return "";
    const first = Math.max(0, line - 3), last = Math.min(lines.length, line + 2);
    const width = String(last).length;
    const rows = lines.slice(first, last).map((text, offset) => {
      const number = first + offset + 1, selected = number === line;
      return `<span class="error-source-line${selected ? " is-error" : ""}" data-source-line="${number}"><span class="error-source-gutter" aria-hidden="true">${selected ? "→" : " "} ${String(number).padStart(width)} │ </span>${esc(text)}</span>`;
    });
    return `<figure class="error-source"><figcaption>Строка ${line} · фрагмент отправленного кода</figcaption><pre><code>${rows.join("\n")}</code></pre></figure>`;
  }
  window.LearningErrorHelp = Object.freeze({ render, sourceHtml, examples, renderCase, caseExamples });
})();
