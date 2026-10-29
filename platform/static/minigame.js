/* minigame.js — мини-игры. Все: 60 секунд, очки → капли (кэп на сервере).
 *   Blitz — «Молния»: правда/ложь.
 *   OrderGame — «Порядок»: собери программу.
 *   MatchGame — «Пары»: выражение ↔ значение.
 *   TraceGame — «След»: чему равна переменная после шагов.
 *   FillGame — «Пробел»: выберите оператор/функцию.
 * Утверждения проверены в CPython 3.14. */

/* ── общий таймер-каркас ── */
function makeGame(setup) {
  let deadline = 0, timer = null, running = false, score = 0, hooks = {}, generation=0, answers=0, mistakes=[];
  function tick() {
    if (!running) return;
    const left = Math.max(0, (deadline - performance.now()) / 1000);
    hooks.onTick && hooks.onTick(left, g.DURATION);
    if (!left) g.finish();
  }
  const g = {
    DURATION: 60,
    start(h) {
      hooks = h || {};
      score = 0;
      generation++;answers=0;mistakes=[];
      deadline = performance.now() + g.DURATION * 1000;
      running = true;
      clearInterval(timer);
      tick();
      timer = setInterval(tick, 50);
      setup.onStart(g, hooks);
    },
    addScore(n) {
      score = Math.max(0, score + n);
      hooks.onScore && hooks.onScore(score);
    },
    getScore: () => score,
    generation:()=>generation,
    noteResult(ok,prompt,chosen,expected){
      answers++;
      if(!ok&&mistakes.length<3&&!mistakes.some(item=>item.prompt===String(prompt)&&item.expected===String(expected)))mistakes.push({prompt:String(prompt),chosen:String(chosen),expected:String(expected)});
    },
    finish() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      hooks.onFinish && hooks.onFinish(score,{answers,mistakes:mistakes.map(item=>({...item}))});
    },
    stop() { running = false; generation++;clearInterval(timer); },
    isRunning() { if (running && performance.now() >= deadline) tick(); return running; },
    hooks: () => hooks,
  };
  Object.assign(g, setup.api(g));
  return g;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Молния ── */
const BLITZ_QUESTIONS = [
  ["len('облако') == 6", true], ["type(10 / 2) is int", false],
  ["7 // 2 == 3", true], ["2 ** 3 == 9", false], ["-7 % 3 == 2", true],
  ["'a' * 3 == 'aaa'", true], ["'Python'[-1] == 'n'", true],
  ["'abc'.upper() == 'ABC'", true], ["bool('') == True", false],
  ["bool('0') == True", true], ["[1, 2] + [3] == [1, 2, 3]", true],
  ["(1) == (1,)", false], ["len((1,)) == 1", true], ["{1, 1, 2} == {1, 2}", true],
  ["{'a': 1}.get('b', 0) == 0", true], ["list(range(3)) == [1, 2, 3]", false],
  ["list(range(1, 4)) == [1, 2, 3]", true], ["sorted([3, 1, 2]) == [1, 2, 3]", true],
  ["'1' + '2' == '3'", false], ["int('7') + 1 == 8", true], ["10 == 10.0", true],
  ["round(2.5) == 3", false], ["abs(-5) == 5", true], ["max([1, 5, 3]) == 5", true],
  ["'a' in 'cat'", true], ["3 in [1, 2, 3]", true], ["not True == False", true],
  ["True + True == 2", true], ["'abc'[1:] == 'bc'", true],
  ["[1, 2, 3][::-1] == [3, 2, 1]", true], ["'x,y'.split(',') == ['x', 'y']", true],
  ["' hi '.strip() == 'hi'", true], ["len(str(100)) == 3", true],
  ["sum([1, 2, 3]) == 6", true], ["min('bca') == 'a'", true], ["2 > 1 > 0", true],
  ["float('1.5') == 1.5", true], ["'Aa'.lower() == 'aa'", true],
  ["list('ab') == ['a', 'b']", true], ["(lambda x: x * 2)(4) == 8", true],
  ["len({}) == 0", true], ["'py' + 'thon' == 'python'", true], ["9 % 3 == 0", true],
  ["type([]) is list", true], ["type({}) is set", false],
  ["sorted('cba') == ['a', 'b', 'c']", true], ["'5' * 2 == '55'", true],
  ["bool([]) == False", true], ["1e3 == 1000", true],
  ["'cloud'.startswith('cl')", true], ["'cloud'.endswith('ou')", false],
  ["len(range(5)) == 5", true], ["list(range(2, 5)) == [2, 3, 4]", true],
  ["'python'.find('t') == 2", true], ["'python'.find('z') == -1", true],
  ["3 * [1] == [1, 1, 1]", true], ["[1, 2].pop() == 1", false],
  ["{'x': 2}['x'] == 2", true], ["set('aba') == {'a', 'b'}", true],
  ["'A'.isupper() == True", true], ["'42'.isdigit() == True", true],
  ["all([True, True, False]) == True", false], ["any([0, '', 3]) == True", true],
  ["list(enumerate(['a'])) == [(0, 'a')]", true], ["'a' not in 'cloud'", true],
  /* EXTRA */
  ["bool('False') is True", true],
  ["isinstance(3, int)", true],
  ["isinstance(True, int)", true],
  ["{1, 2} | {2, 3} == {1, 2, 3}", true],
  ["{1, 2} & {2, 3} == {2}", true],
  ["divmod(10, 3) == (3, 1)", true],
  ["''.join(['a', 'b']) == 'ab'", true],
  ["list(zip([1, 2], [3])) == [(1, 3)]", true],
  ["pow(2, 5) == 32", true],
  ["'py'.zfill(4) == '00py'", true],
  ["all([]) is True", true],
  ["any([]) is False", true],
  ["[1, 2, 3].count(2) == 1", true],
  ["'ab'.replace('a', 'A') == 'Ab'", true],
  ["chr(65) == 'A'", true],
  ["ord('A') == 65", true],
  ["bin(2) == '0b10'", true],
  ["hex(15) == '0xf'", true],
  ["0.1 + 0.2 == 0.3", false],
  ["None is None", true],
  ["[] == []", true],
  ["[] is []", false],
  ["{}.get('x') is None", true],
  ["sorted([3, 1], reverse=True) == [3, 1]", true],
  ["'a'.islower()", true],
  ["list(reversed([1, 2])) == [2, 1]", true],
  ["(1 < 2 < 3) is True", true],
  ["(1 < 2 > 3) is False", true],
  ["frozenset([1, 1, 2]) == frozenset([1, 2])", true],
  ["'x'.ljust(3, '.') == 'x..'", true],
  ["'42'.isdecimal()", true],
  ["(not not 5) is True", true],
  ["bool(' ') is True", true],
  ["[1] * 0 == []", true],
  ["'ab'[::-1] == 'ba'", true],
  ["sum([], start=5) == 5", true],
  ["dict(a=1)['a'] == 1", true],
  ["set() == set()", true],
  ["{1: 2}.pop(1) == 2", true],
  ["'hi'.endswith('i')", true],
  ["'cloud'.count('o') == 1", true],
  ["list(range(0)) == []", true],
  ["bool(None) is False", true],
  ["type(()) is tuple", true],
  ["len(bytes(3)) == 3", true],
  ["'A'.swapcase() == 'a'", true],
  ["[1, 2].index(2) == 1", true],
  ["max('az') == 'z'", true],
  ["min([9, -1, 3]) == -1", true],
  ["round(3.1415, 2) == 3.14", true],

];

window.Blitz = makeGame({
  onStart(g, hooks) {
    g._deck = shuffle(BLITZ_QUESTIONS);
    g._idx = 0;
    hooks.onQuestion && hooks.onQuestion(g._deck[0][0]);
  },
  api(g) {
    return {
      answer(saidTrue) {
        if (!g.isRunning()) return;
        const correct = g._deck[g._idx][1] === saidTrue;
        g.noteResult(correct,g._deck[g._idx][0],saidTrue?'Правда':'Ложь',g._deck[g._idx][1]?'Правда':'Ложь');
        g.addScore(correct ? 1 : -1);
        g.hooks().onAnswer && g.hooks().onAnswer(correct);
        g._idx++;
        if (g._idx >= g._deck.length) { g.finish(); return; }
        g.hooks().onQuestion && g.hooks().onQuestion(g._deck[g._idx][0]);
      },
    };
  },
});

/* ── Порядок: собери программу по строкам ── */
const ORDER_PUZZLES = [
  {
    goal: "Собрать функцию приветствия и вывести сообщение",
    output: "Привет, Мир",
    lines: ["def greet(name):", "    return 'Привет, ' + name", "msg = greet('Мир')", "print(msg)"],
  },
  {
    goal: "Отсортировать список и вывести первый элемент",
    output: "1",
    lines: ["numbers = [3, 1, 2]", "numbers.sort()", "first = numbers[0]", "print(first)"],
  },
  {
    goal: "Посчитать сумму чисел от 1 до 3",
    output: "6",
    lines: ["total = 0", "for i in range(1, 4):", "    total += i", "print(total)"],
  },
  {
    goal: "Сделать строку заглавной и взять первые три буквы",
    output: "PYT",
    lines: ["s = 'python'", "up = s.upper()", "short = up[:3]", "print(short)"],
  },
  {
    goal: "Заполнить словарь и вывести значение второго ключа",
    output: "2",
    lines: ["d = {}", "d['a'] = 1", "d['b'] = d['a'] + 1", "print(d['b'])"],
  },
  {
    goal: "Вызвать функцию удвоения",
    output: "42",
    lines: ["def double(x):", "    return x * 2", "result = double(21)", "print(result)"],
  },
  {
    goal: "Добавить букву, отсортировать список и вывести его",
    output: "['a', 'b', 'c']",
    lines: ["words = ['b', 'a']", "words.append('c')", "words.sort()", "print(words)"],
  },
  {
    goal: "Проверить чётность и вывести финальную строку",
    output: "чётное\\nготово",
    lines: ["n = 10", "if n % 2 == 0:", "    print('чётное')", "print('готово')"],
  },
  {
    goal: "Поймать ошибку преобразования в число",
    output: "не число",
    lines: ["try:", "    x = int('abc')", "except ValueError:", "    print('не число')"],
  },
  {
    goal: "Собрать строку приветствия и вывести её длину",
    output: "11",
    lines: ["name = 'Ада'", "line = 'Привет, ' + name", "n = len(line)", "print(n)"],
  },
  {
    goal: "Вычислить квадратный корень и напечатать целое число",
    output: "4",
    lines: ["import math", "root = math.sqrt(16)", "answer = int(root)", "print(answer)"],
  },
  {
    goal: "Отсортировать пары и вывести букву из первой пары",
    output: "a",
    lines: ["pairs = [(2, 'b'), (1, 'a')]", "pairs.sort()", "first = pairs[0][1]", "print(first)"],
  },
  {
    goal: "Отфильтровать положительные числа и посчитать их",
    output: "3",
    lines: ["nums = [-1, 2, 0, 5, 7]", "positive = [n for n in nums if n > 0]", "count = len(positive)", "print(count)"],
  },
  {
    goal: "Склеить слова через дефис",
    output: "sky-code",
    lines: ["parts = ['sky', 'code']", "line = '-'.join(parts)", "print(line)"],
  },
  {
    goal: "Найти максимальный балл и вывести его",
    output: "9",
    lines: ["scores = {'Аня': 7, 'Боря': 9}", "best = max(scores.values())", "print(best)"],
  },
  {
    goal: "Пройти по индексам и собрать подпись",
    output: "0:a 1:b",
    lines: ["letters = ['a', 'b']", "items = []", "for i, value in enumerate(letters):", "    items.append(f'{i}:{value}')", "print(' '.join(items))"],
  },
  {
    goal: "Безопасно взять значение из словаря",
    output: "0",
    lines: ["settings = {'sound': 1}", "volume = settings.get('volume', 0)", "print(volume)"],
  },
  {
    goal: "Сложить только чётные числа",
    output: "12",
    lines: ["numbers = [2, 3, 4, 6]", "total = 0", "for n in numbers:", "    if n % 2 == 0:", "        total += n", "print(total)"],
  },
  /* EXTRA */
  {
    goal: "Удвоить числа списка и сложить результат",
    output: "12",
    lines: ["nums = [1, 2, 3]", "doubled = [n * 2 for n in nums]", "print(sum(doubled))"],
  },
  {
    goal: "Разбить строку по запятой и посчитать части",
    output: "3",
    lines: ["text = 'a,b,c'", "parts = text.split(',')", "print(len(parts))"],
  },
  {
    goal: "Посчитать буквы через Counter",
    output: "2",
    lines: ["from collections import Counter", "c = Counter('aba')", "print(c['a'])"],
  },
  {
    goal: "Взять первый ключ словаря",
    output: "x",
    lines: ["data = {'x': 10}", "print(list(data.keys())[0])"],
  },
  {
    goal: "Отсортировать кортеж и взять минимум",
    output: "1",
    lines: ["vals = (3, 1, 2)", "print(sorted(vals)[0])"],
  },
  {
    goal: "Вывести метку через тернарный оператор",
    output: "ok",
    lines: ["n = 5", "print('ok' if n > 0 else 'no')"],
  },
  {
    goal: "Развернуть список на месте",
    output: "3",
    lines: ["xs = [1, 2, 3]", "xs.reverse()", "print(xs[0])"],
  },
  {
    goal: "Собрать f-строку приветствия",
    output: "Hi, Ada!",
    lines: ["name = 'Ada'", "print(f'Hi, {name}!')"],
  },
  {
    goal: "Поменять переменные местами",
    output: "2 1",
    lines: ["a, b = 1, 2", "a, b = b, a", "print(a, b)"],
  },
  {
    goal: "Склеить слова и сделать верхний регистр",
    output: "PY|CLOUD",
    lines: ["words = ['py', 'cloud']", "print('|'.join(words).upper())"],
  },
  {
    goal: "Досчитать while до трёх",
    output: "3",
    lines: ["n = 0", "while n < 3:", "    n += 1", "print(n)"],
  },
  {
    goal: "Собрать словарь из пар и вывести значение",
    output: "9",
    lines: ["pairs = [('a', 9)]", "d = dict(pairs)", "print(d['a'])"],
  },

];

window.OrderGame = makeGame({
  onStart(g, hooks) {
    g._puzzles = shuffle(ORDER_PUZZLES);
    g._pi = 0;
    g._next();
  },
  api(g) {
    return {
      _next() {
        if (g._pi >= g._puzzles.length) { g.finish(); return; }
        g._puzzle = g._puzzles[g._pi];
        g._solution = g._puzzle.lines;
        g._picked = [];
        // перемешиваем, пока порядок не отличается от правильного
        do { g._shuffled = shuffle(g._solution); }
        while (g._shuffled.join("\n") === g._solution.join("\n"));
        g.hooks().onPuzzle && g.hooks().onPuzzle(g._shuffled, g._picked, g._puzzle);
      },
      pick(line) {
        if (!g.isRunning()) return;
        g._picked.push(line);
        if (g._picked.length < g._solution.length) {
          g.hooks().onPuzzle && g.hooks().onPuzzle(g._shuffled, g._picked, g._puzzle);
          return;
        }
        const correct = g._picked.join("\n") === g._solution.join("\n");
        g.noteResult(correct,g._puzzle.goal,g._picked.join('\n'),g._solution.join('\n'));
        if (correct) g.addScore(3);
        g.hooks().onSolved && g.hooks().onSolved(correct, g._solution, g._puzzle);
        g._pi++;
        const generation=g.generation();
        setTimeout(() => generation===g.generation()&&g.isRunning()&&g._next(), correct ? 600 : 1400);
      },
      resetPick() {
        g._picked = [];
        g.hooks().onPuzzle && g.hooks().onPuzzle(g._shuffled, g._picked, g._puzzle);
      },
    };
  },
});

/* ── Пары: выражение ↔ значение ── */
const MATCH_PAIRS = [
  ["len('ab')", "2"], ["2 ** 3", "8"], ["'a' + 'b'", "'ab'"], ["bool(0)", "False"],
  ["10 // 3", "3"], ["[1, 2][0]", "1"], ["'x' * 3", "'xxx'"], ["max(2, 5)", "5"],
  ["7 % 2", "1"], ["int('4') + 1", "5"], ["sorted([2, 1])[0]", "1"], ["len([])", "0"],
  ["'A'.lower()", "'a'"], ["3 > 2", "True"], ["(1, 2)[1]", "2"], ["sum([1, 2])", "3"],
  ["abs(-9)", "9"], ["len('')", "0"], ["'-'.join(['a', 'b'])", "'a-b'"], ["min(4, 7)", "4"],
  ["'ab'.upper()", "'AB'"], ["list(range(3))[2]", "2"], ["5 in [2, 5, 8]", "True"],
  ["'cloud'[0]", "'c'"], ["round(3.6)", "4"], ["10 % 4", "2"], ["2 <= 2", "True"],
  ["len({'a': 1})", "1"], ["'hi'.replace('h', 'H')", "'Hi'"], ["sum(range(4))", "6"],
  /* EXTRA */
  ["len('xyz')", "3"], ["2 ** 4", "16"], ["bool([])", "False"], ["'ab'[1]", "'b'"],
  ["sum([4, 5])", "9"], ["min(9, 2)", "2"], ["list('hi')", "['h', 'i']"], ["{1, 2, 2}", "{1, 2}"],
  ["'py' * 2", "'pypy'"], ["10 // 4", "2"], ["ord('B')", "66"], ["chr(66)", "'B'"],
  ["any([0, 0, 1])", "True"], ["all([1, 2, 0])", "False"], ["sorted('cab')", "['a', 'b', 'c']"], ["'x'.upper()", "'X'"],
  ["pow(3, 2)", "9"], ["list(range(1, 3))", "[1, 2]"], ["'ab'.find('b')", "1"], ["divmod(9, 4)", "(2, 1)"],
  ["len({1: 2, 3: 4})", "2"], ["bool('0')", "True"], ["[1, 2, 3][-1]", "3"], ["'hi'.zfill(4)", "'00hi'"],

];

window.MatchGame = makeGame({
  onStart(g, hooks) {
    g._pool = shuffle(MATCH_PAIRS);
    g._round = 0;
    g._next();
  },
  api(g) {
    return {
      _next() {
        const start = g._round * 4;
        if (start + 4 > g._pool.length) { g._pool = shuffle(MATCH_PAIRS); g._round = 0; return g._next(); }
        g._pairs = g._pool.slice(start, start + 4);
        g._left = shuffle(g._pairs.map((p, i) => ({ id: 'left-' + i, value: p[0] })));
        g._right = shuffle(g._pairs.map((p, i) => ({ id: 'right-' + i, value: p[1] })));
        g._sel = null;
        g._done = new Set();
        g.hooks().onBoard && g.hooks().onBoard(g._left, g._right, g._done, null);
      },
      pick(side, id) {
        if (!g.isRunning() || g._done.has(id)) return;
        const cell = (side === 'left' ? g._left : side === 'right' ? g._right : []).find(c => c.id === id);
        if (!cell) return;
        const value = cell.value;
        if (!g._sel) {
          g._sel = { side, id, value };
          g.hooks().onBoard && g.hooks().onBoard(g._left, g._right, g._done, g._sel);
          return;
        }
        if (g._sel.side === side) { // перевыбор в той же колонке
          g._sel = { side, id, value };
          g.hooks().onBoard && g.hooks().onBoard(g._left, g._right, g._done, g._sel);
          return;
        }
        const expr = side === "left" ? value : g._sel.value;
        const val = side === "right" ? value : g._sel.value;
        const correct = g._pairs.some((p) => p[0] === expr && p[1] === val);
        g.noteResult(correct,expr,val,g._pairs.find(p=>p[0]===expr)?.[1]||'');
        if (correct) {
          g.addScore(1);
          g._done.add(id);
          g._done.add(g._sel.id);
        } else {
          g.addScore(-1);
        }
        g.hooks().onMatch && g.hooks().onMatch(correct);
        g._sel = null;
        if (g._done.size >= 8) { g._round++; g._next(); }
        else g.hooks().onBoard && g.hooks().onBoard(g._left, g._right, g._done, null);
      },
    };
  },
});

/* ── След: чему равна переменная после шагов ── */
const TRACE_ITEMS = [
  { code: "x = 2\nx = x * 3", ask: "Чему равен x?", options: ["2", "3", "5", "6"], answer: "6" },
  { code: "a = [1, 2]\na.append(3)\nn = len(a)", ask: "Чему равен n?", options: ["2", "3", "4", "1"], answer: "3" },
  { code: "s = 'ab'\ns = s + 'c'", ask: "Чему равен s?", options: ["'ab'", "'abc'", "'c'", "'bac'"], answer: "'abc'" },
  { code: "n = 10\nn //= 3", ask: "Чему равен n?", options: ["3", "4", "1", "10"], answer: "3" },
  { code: "x = 5\nif x > 3:\n    x = 1", ask: "Чему равен x?", options: ["5", "1", "3", "0"], answer: "1" },
  { code: "t = (1,)\nn = len(t)", ask: "Чему равен n?", options: ["0", "1", "2", "Error"], answer: "1" },
  { code: "d = {'a': 1}\nv = d.get('b', 0)", ask: "Чему равен v?", options: ["1", "0", "None", "Error"], answer: "0" },
  { code: "xs = [3, 1, 2]\nxs.sort()\nfirst = xs[0]", ask: "Чему равен first?", options: ["3", "1", "2", "0"], answer: "1" },
  { code: "n = 0\nfor i in range(3):\n    n += i", ask: "Чему равен n?", options: ["3", "6", "0", "2"], answer: "3" },
  { code: "s = 'Python'\nc = s[-1]", ask: "Чему равен c?", options: ["'P'", "'n'", "'o'", "'y'"], answer: "'n'" },
  { code: "x = True\ny = not x", ask: "Чему равен y?", options: ["True", "False", "1", "0"], answer: "False" },
  { code: "a = {1, 1, 2}\nn = len(a)", ask: "Чему равен n?", options: ["3", "2", "1", "0"], answer: "2" },
  { code: "msg = 'hi'\nmsg = msg.upper()", ask: "Чему равен msg?", options: ["'hi'", "'HI'", "'Hi'", "Error"], answer: "'HI'" },
  { code: "n = 7 % 3", ask: "Чему равен n?", options: ["2", "1", "3", "0"], answer: "1" },
  { code: "xs = [1, 2, 3]\nxs = xs[::-1]\nv = xs[0]", ask: "Чему равен v?", options: ["1", "2", "3", "0"], answer: "3" },
  { code: "x = 0\nfor ch in 'ab':\n    x += 1", ask: "Чему равен x?", options: ["0", "1", "2", "3"], answer: "2" },
  /* EXTRA */
  { code: "x = [1]\nx.append(2)\nn = len(x)", ask: "Чему равен n?", options: ["1", "2", "3", "0"], answer: "2" },
  { code: "s = 'ab'\ns = s.upper()", ask: "Чему равен s?", options: ["'ab'", "'AB'", "'Ab'", "Error"], answer: "'AB'" },
  { code: "a = 1\nb = 2\na, b = b, a", ask: "Чему равен a?", options: ["1", "2", "0", "3"], answer: "2" },
  { code: "d = {}\nd['k'] = 5\nv = d.get('k')", ask: "Чему равен v?", options: ["None", "5", "0", "Error"], answer: "5" },
  { code: "n = 0\nfor i in range(1, 4):\n    n += i", ask: "Чему равен n?", options: ["6", "3", "4", "0"], answer: "6" },
  { code: "xs = [1, 2, 3]\nxs.pop()\nv = xs[-1]", ask: "Чему равен v?", options: ["1", "2", "3", "0"], answer: "2" },
  { code: "t = 'a,b'.split(',')\nn = len(t)", ask: "Чему равен n?", options: ["1", "2", "3", "0"], answer: "2" },
  { code: "x = 8\nx %= 5", ask: "Чему равен x?", options: ["8", "5", "3", "1"], answer: "3" },
  { code: "s = {1, 2}\ns.add(2)\nn = len(s)", ask: "Чему равен n?", options: ["1", "2", "3", "0"], answer: "2" },
  { code: "msg = 'hi'\nmsg += '!'\nc = len(msg)", ask: "Чему равен c?", options: ["2", "3", "4", "1"], answer: "3" },
  { code: "x = True\nx = x and False", ask: "Чему равен x?", options: ["True", "False", "1", "0"], answer: "False" },
  { code: "a = [3, 1]\na.sort()\nprint_ready = a[0]", ask: "Чему равен print_ready?", options: ["3", "1", "0", "2"], answer: "1" },
  { code: "n = 2\nn = n ** 3", ask: "Чему равен n?", options: ["6", "8", "9", "5"], answer: "8" },
  { code: "s = 'Python'\np = s[:2]", ask: "Чему равен p?", options: ["'Py'", "'th'", "'on'", "'P'"], answer: "'Py'" },

];

window.TraceGame = makeGame({
  onStart(g, hooks) {
    g._deck = shuffle(TRACE_ITEMS);
    g._idx = 0;
    hooks.onTrace && hooks.onTrace(g._deck[0]);
  },
  api(g) {
    return {
      answer(choice) {
        if (!g.isRunning()) return;
        const item = g._deck[g._idx];
        const correct = choice === item.answer;
        g.noteResult(correct,item.code+'\n'+item.ask,choice,item.answer);
        g.addScore(correct ? 1 : -1);
        g.hooks().onAnswer && g.hooks().onAnswer(correct);
        g._idx++;
        if (g._idx >= g._deck.length) { g.finish(); return; }
        g.hooks().onTrace && g.hooks().onTrace(g._deck[g._idx]);
      },
    };
  },
});

/* ── Пробел: выберите оператор или встроенную функцию ── */
const FILL_ITEMS = [
  { prompt: "Оператор целого деления", options: ["/", "//", "%", "**"], answer: "//" },
  { prompt: "Остаток от деления", options: ["/", "//", "%", "**"], answer: "%" },
  { prompt: "Возведение в степень", options: ["*", "**", "^", "//"], answer: "**" },
  { prompt: "Длина последовательности", options: ["size", "count", "len", "length"], answer: "len" },
  { prompt: "Узнать тип значения", options: ["typeof", "type", "class", "kind"], answer: "type" },
  { prompt: "Преобразовать в целое", options: ["int", "str", "float", "bool"], answer: "int" },
  { prompt: "Проверка вхождения", options: ["has", "contains", "in", "inside"], answer: "in" },
  { prompt: "Логическое И", options: ["and", "&&", "&", "with"], answer: "and" },
  { prompt: "Логическое ИЛИ", options: ["or", "||", "|", "either"], answer: "or" },
  { prompt: "Пустой список", options: ["{}", "()", "[]", "set()"], answer: "[]" },
  { prompt: "Безопасный доступ к ключу словаря", options: [".get", ".find", ".key", ".fetch"], answer: ".get" },
  { prompt: "Убрать пробелы по краям строки", options: [".trim", ".strip", ".clean", ".cut"], answer: ".strip" },
  { prompt: "Сортировка списка на месте", options: [".order()", ".sort()", "sorted()", ".sorted()"], answer: ".sort()" },
  { prompt: "Объединить строки через разделитель", options: [".join", ".concat", ".merge", "+="], answer: ".join" },
  { prompt: "Модуль абсолютного значения", options: ["abs", "fabs", "mag", "norm"], answer: "abs" },
  { prompt: "Диапазон чисел 0..n-1", options: ["range", "xrange", "span", "seq"], answer: "range" },
  /* EXTRA */
  { prompt: "Логическое отрицание", options: ["not", "!", "~", "no"], answer: "not" },
  { prompt: "Создать пустой словарь", options: ["{}", "[]", "()", "set()"], answer: "{}" },
  { prompt: "Создать пустое множество", options: ["{}", "[]", "()", "set()"], answer: "set()" },
  { prompt: "Добавить элемент в конец списка", options: [".add", ".append", ".push", ".insert"], answer: ".append" },
  { prompt: "Удалить и вернуть последний элемент списка", options: [".pop()", ".remove()", ".del()", ".cut()"], answer: ".pop()" },
  { prompt: "Новая отсортированная копия", options: [".sort()", "sorted()", ".order()", "sort()"], answer: "sorted()" },
  { prompt: "Форматированная строка (f-string)", options: ["f'...'", "fmt'...'", "$'...'", "s'...'"], answer: "f'...'" },
  { prompt: "Целочисленное преобразование из строки", options: ["str", "int", "float", "chr"], answer: "int" },
  { prompt: "Проверка, что все элементы истинны", options: ["any", "all", "every", "each"], answer: "all" },
  { prompt: "Проверка, что есть хотя бы один истинный", options: ["any", "all", "some", "one"], answer: "any" },
  { prompt: "Оператор присваивания с сложением", options: ["+=", "=+", "++", ":="], answer: "+=" },
  { prompt: "Получить ключи словаря", options: [".keys()", ".items()", ".values()", ".get()"], answer: ".keys()" },
  { prompt: "Разбить строку по разделителю", options: [".split", ".join", ".part", ".cut"], answer: ".split" },
  { prompt: "Заменить фрагмент строки", options: [".replace", ".swap", ".change", ".sub"], answer: ".replace" },

];

window.FillGame = makeGame({
  onStart(g, hooks) {
    g._deck = shuffle(FILL_ITEMS);
    g._idx = 0;
    hooks.onFill && hooks.onFill(g._deck[0]);
  },
  api(g) {
    return {
      answer(choice) {
        if (!g.isRunning()) return;
        const item = g._deck[g._idx];
        const correct = choice === item.answer;
        g.addScore(correct ? 1 : -1);
        g.noteResult(correct,item.prompt,choice,item.answer);
        g.hooks().onAnswer && g.hooks().onAnswer(correct);
        g._idx++;
        if (g._idx >= g._deck.length) { g.finish(); return; }
        g.hooks().onFill && g.hooks().onFill(g._deck[g._idx]);
      },
    };
  },
});
