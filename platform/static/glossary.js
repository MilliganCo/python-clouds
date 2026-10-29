/* Короткие определения в авторской теории; код и ответы не изменяем. */
(() => {
  const entries = [
    {
      id: "body", title: "Тело функции", term: "тел(?:о|а|у|ом|е) функции",
      definition: "Команды внутри функции: строки после заголовка def, с отступом вправо. Они выполняются при вызове функции, а не при её создании.",
      code: "def greet():\n    print('Привет!')\n\ngreet()", output: "Привет!",
      note: "Здесь тело — строка print('Привет!') с отступом. Последний greet() уже вне тела: он запускает функцию.",
    },
    {
      id: "argument", title: "Аргумент", term: "аргумент(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
      definition: "Значение, которое передают функции при вызове. Его пишут в скобках после имени функции.",
      code: "print(len('кот'))", output: "3",
      note: "Строка 'кот' — аргумент len. Функция len считает её символы. Полученное число 3 становится аргументом print.",
    },
    {
      id: "parameter", title: "Параметр", term: "параметр(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
      definition: "Имя в заголовке функции, через которое она получает переданное значение. Параметр — имя, а аргумент — значение при конкретном вызове.",
      code: "def greet(name):\n    print('Привет,', name)\n\ngreet('Маша')", output: "Привет, Маша",
      note: "name — параметр. 'Маша' — аргумент. Во время этого вызова имя name внутри функции обозначает строку 'Маша'.",
    },
    {
      id: "return", title: "Возвращаемое значение",
      term: "возвращаем(?:ое|ого|ому|ым|ом|ые|ых|ыми) значени(?:е|я|ю|ем|и|й|ям|ями|ях)",
      definition: "Результат, который функция отдаёт вызывающему коду. Его можно сохранить или использовать дальше. Печать на экране — отдельное действие, она не заменяет return.",
      code: "def double(number):\n    return number * 2\n\nresult = double(4)\nprint(result)", output: "8",
      note: "double(4) возвращает 8. Это число записывается в result. Если функция завершилась без return со значением, её результат — None.",
    },
    {
      id: "object", title: "Объект", term: "объект(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
      definition: "То, с чем работает программа: число, строка, список и другие значения Python. У каждого объекта есть тип. Переменная — имя для обращения к объекту, а не сам объект.",
      code: "items = ['чай']\nitems.append('сок')\nprint(items)", output: "['чай', 'сок']",
      note: "['чай'] создаёт объект-список, items — его имя. append добавляет элемент в тот же список, не создавая новый.",
    },
    {
      id: "iteration", title: "Итерация", term: "итераци(?:я|и|ю|ей|ею|ям|ями|ях|й)",
      definition: "Один проход цикла. На каждом проходе выполняются команды с отступом внутри цикла.",
      code: "for letter in 'кот':\n    print(letter)", output: "к\nо\nт",
      note: "Здесь три итерации: сначала letter обозначает 'к', затем 'о', затем 'т'. Каждый проход печатает одну букву.",
    },
    {
      id: "variable", title: "Переменная", term: "переменн(?:ая|ой|ую|ые|ых|ым|ыми)",
      definition: "Имя, по которому программа обращается к значению. В присваивании слева от = пишут имя, справа — значение или выражение. Сначала вычисляется правая часть, затем имя связывается с результатом.",
      code: "count = 2\ncount = count + 1\nprint(count)", output: "3",
      note: "Во второй строке сначала берём прежнее значение count — 2, прибавляем 1, а затем связываем имя count с числом 3.",
    },
  ];

  function enhance(root) {
    // Без Popover API теория остаётся обычным текстом, без неработающих кнопок.
    if (!HTMLElement.prototype.showPopover || root.querySelector('.glossary-term')) return;
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('.theory-lead, .theory-body, .stage-ex-note, .theory-mistakes p, .theory-apps li, .theory-summary li')
          && !node.parentElement.closest('a, button, code, pre, h1, h2, h3, h4, script, style, textarea, [popover]')) nodes.push(node);
    }
    // Одно вхождение каждого термина на статью: ссылки не заполняют весь текст.
    for (const entry of entries) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${entry.term}(?![\\p{L}\\p{N}_])`, 'iu');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const match = node.textContent.match(pattern);
        if (!match) continue;
        const term = node.splitText(match.index);
        const rest = term.splitText(match[0].length);
        nodes.splice(i + 1, 0, rest);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'glossary-term';
        button.textContent = match[0];
        button.setAttribute('aria-label', `${match[0]} — значение термина`);
        const panel = document.createElement('aside');
        panel.id = `glossary-${entry.id}`;
        panel.className = 'glossary-panel';
        panel.setAttribute('popover', 'auto');
        panel.setAttribute('aria-labelledby', `${panel.id}-title`);
        button.setAttribute('popovertarget', panel.id);
        panel.innerHTML = `<header><h3 id="${panel.id}-title"></h3><button type="button" class="btn" popovertarget="${panel.id}" popovertargetaction="hide" aria-label="Закрыть определение" autofocus>×</button></header><p></p><figure><figcaption>Пример</figcaption><pre><code></code></pre><figcaption>Вывод</figcaption><pre class="glossary-output"></pre></figure><p class="glossary-note"></p>`;
        panel.querySelector('h3').textContent = entry.title;
        panel.querySelector('p').textContent = entry.definition;
        panel.querySelector('code').textContent = entry.code;
        panel.querySelector('.glossary-output').textContent = entry.output;
        panel.querySelector('.glossary-note').textContent = entry.note;
        // Панель рядом с термином, но всегда в пределах видимой части экрана.
        panel.addEventListener('toggle', () => {
          if (!panel.matches(':popover-open')) return;
          panel.scrollTop = 0;
          const anchor = button.getBoundingClientRect();
          const box = panel.getBoundingClientRect();
          panel.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12))}px`;
          panel.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, innerHeight - box.height - 12))}px`;
        });
        term.replaceWith(button);
        root.append(panel);
        break;
      }
    }
  }
  if (HTMLElement.prototype.showPopover) {
    // При повороте телефона старая позиция больше не подходит; термин можно открыть снова.
    window.addEventListener('resize', () => document.querySelector('.glossary-panel:popover-open')?.hidePopover());
  }
  window.LearningGlossary = { enhance, entries };
})();
