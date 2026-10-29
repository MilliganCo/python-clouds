/* app.js — «Python в облаках»: SPA с hash-роутером.
   #/            — главная (дашборд)
   #/topics      — каталог тем и заданий
   #/task/1.2    — интерактивная страница задания:
                   редактор кода, запуск на сервере, отправка на проверку,
                   подсказки, заметки, ИИ-помощник, следующие задания. */
(function () {
  "use strict";

  const RAW_TOPICS = window.TASKS || [];
  const TOPICS = [...RAW_TOPICS];
  const curriculum = window.Curriculum;
  const catalogBranch = () => curriculum.fromHash(location.hash);
  const isTopicsRoute = () => location.hash === "#/topics" || location.hash === "#/topics/tools";
  const branchHref = topic => curriculum.href(curriculum.branchOf(topic));
  const branchTitle = topic => curriculum.branches[curriculum.branchOf(topic)].title;
  const ALL_TASKS = [];
  const TOPIC_OF = {};
  TOPICS.forEach((topic) => topic.tasks.forEach((t) => {
    ALL_TASKS.push(t);
    TOPIC_OF[t.id] = topic;
    if (t.check) window.CHECKS[t.id] = t.check;
  }));
  const TASK_BY_ID = Object.fromEntries(ALL_TASKS.map((t) => [t.id, t]));

  // Челленджи тем: доступны по id, но не участвуют в общей ленте курса
  Object.entries(window.CHALLENGES || {}).forEach(([topicId, ch]) => {
    const topic = TOPICS.find((t) => t.id === +topicId);
    if (!topic) return;
    TASK_BY_ID[ch.id] = ch;
    TOPIC_OF[ch.id] = topic;
  });

  const POINTS = { beginner: 10, intermediate: 20, advanced: 30, expert: 40 };
  let taskXp = {}, serverXp = null, weeklyEnabled = false;
  let weeklyFocusTimer=null,weeklyFocusTurn=0;
  const LEVEL_RU = { beginner: "начальный", intermediate: "средний", advanced: "продвинутый", expert: "экспертный" };
  const pointsFor = (task) =>
    taskXp[task.id] ?? (POINTS[TOPIC_OF[task.id].level] || 10) * (task.challenge ? 3 : 1);

  const RANKS = [
    { name: "Новичок", min: 0 },
    { name: "Ученик", min: 60 },
    { name: "Практик", min: 180 },
    { name: "Разработчик", min: 380 },
    { name: "Инженер", min: 680 },
    { name: "Архитектор", min: 1100 },
    { name: "Мастер", min: 1700 },
  ];

  const HINT_BY_TYPE = {
    "определить вывод": "Пройдите код построчно и выпишите значения переменных на каждом шаге, затем соберите итог печати.",
    "дописать код": "Посмотрите, какая переменная нужна ниже по коду и что требуется по условию. Ваш фрагмент должен подготовить именно её.",
    "исправить ошибку": "Сравните код с условием и найдите, где программа делает не то, что требуется.",
    "объяснить поведение": "Проследите выполнение кода и объясните своими словами, почему получился такой результат.",
    "написать функцию": "Посмотрите, какие данные получает функция и какое значение должна вернуть. Напишите заголовок и команды с отступом под ним.",
    "написать тесты": "Выберите независимые ожидания и разные входы. Тесты должны принимать правильную функцию и замечать нарушения её контракта.",
    "написать класс": "Посмотрите, какие данные хранит объект и какие действия выполняют его методы. Реализуйте класс по условию.",
    "класс и функция": "Отдельно проверьте класс исключения и функцию: когда она возвращает результат, а когда должна вызвать ошибку.",
    "демо": "Запустите пример и посмотрите, что происходит. Можно менять код и экспериментировать — штрафов нет.",
    "квиз": "Выберите один вариант. После ответа появится короткое пояснение.",
  };

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function taskTypeLabel(task) {
    return task.displayType || task.type;
  }

  function getTaskIntro(task) {
    if (task.finale) return {
      goal: "Самостоятельно соединить навыки темы в работающем решении.",
      explanation: "Сначала попробуйте свой план. Если застрянете, откройте подсказку или задайте вопрос наставнику. Проверка использует не только пример из условия.",
      concepts: [], application: "", example: null, html: false,
    };
    const custom = window.TASK_INTRO?.[task.id];
    if (custom) {
      return {
        goal: custom.goal || "",
        concepts: custom.concepts || [],
        explanation: custom.explanation || custom.text || "",
        text: custom.explanation || custom.text || "",
        example: custom.example?.code != null
          ? custom.example.code
          : (typeof custom.example === "string" ? custom.example : null),
        exampleExplanation: custom.example?.explanation || "",
        application: custom.application || "",
        html: true,
      };
    }
    const typeHint = HINT_BY_TYPE[taskTypeLabel(task)]
      || "Прочитайте условие и код внимательно перед тем, как отвечать.";
    const typeText = window.TYPE_STAGE?.[taskTypeLabel(task)] || "";
    return {
      goal: typeHint,
      concepts: [],
      explanation: typeText || typeHint,
      text: typeHint,
      example: null,
      exampleExplanation: "",
      application: "",
      html: false,
    };
  }

  function learningProfileHtml(task) {
    const profile = task.learning;
    const labels = { easy: "Разминка", practice: "Практика", challenge: "На подумать" };
    if (!profile || !Object.hasOwn(labels, profile.difficulty) || !Array.isArray(profile.skills) || typeof profile.reason !== "string") return "";
    return `<section class="learning-profile" aria-label="Учебный профиль этапа">
      <p><strong>${esc(labels[profile.difficulty])}</strong> <span class="stat-note">· сложность внутри темы</span></p>
      <p>${esc(profile.reason)}</p>
      <ul class="learning-skills" aria-label="Навыки этапа">${profile.skills.map(skill => `<li class="chip">${esc(skill)}</li>`).join("")}</ul>
    </section>`;
  }

  function stageTrainHtml(intro, task) {
    const concepts = (intro.concepts || []).length
      ? `<p class="stage-concepts">${intro.concepts.map((c) => `<code>${esc(c)}</code>`).join(" · ")}</p>`
      : "";
    const goal = intro.goal
      ? `<p class="stage-goal-lead"><b>Цель.</b> ${intro.html ? intro.goal : inline(intro.goal)}</p>`
      : "";
    const body = intro.explanation
      ? `<div class="stage-goal-text">${intro.html ? intro.explanation : inline(intro.explanation)}</div>`
      : "";
    const ex = intro.example
      ? `${terminalHtml(intro.example, "пример.py")}${
          intro.exampleExplanation
            ? `<p class="stage-ex-note">${intro.html ? intro.exampleExplanation : inline(intro.exampleExplanation)}</p>`
            : ""
        }`
      : "";
    const app = intro.application
      ? `<p class="stage-apply"><b>Где пригодится.</b> ${intro.html ? intro.application : inline(intro.application)}</p>`
      : "";
    const label = taskTypeLabel(task);
    const format = window.TYPE_STAGE?.[label]
      ? `<details class="stage-format"><summary>Формат задания · ${esc(label)}</summary><p>${esc(window.TYPE_STAGE[label])}</p></details>`
      : "";
    return `${goal}${concepts}${body}${ex}${app}${format}`;
  }

  function openStageTrainModal(task) {
    closeStageTrainModal();
    const intro = getTaskIntro(task);
    const overlay = document.createElement("dialog");
    overlay.id = "stageTrainModal";
    overlay.className = "stage-train-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "stageTrainTitle");
    overlay.innerHTML = `
      <div class="stage-train-card">
        <div class="stage-train-head">
          <h2 id="stageTrainTitle"><span class="nf nf-school" aria-hidden="true"></span> Что тренирует этот этап</h2>
          <button type="button" class="btn" id="stageTrainClose" aria-label="Закрыть"><span class="nf nf-close" aria-hidden="true"></span></button>
        </div>
        <div class="stage-train-body">${learningProfileHtml(task)}${stageTrainHtml(intro, task)}</div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => closeStageTrainModal();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    $("stageTrainClose")?.addEventListener("click", close);
    overlay.showModal();
    $("stageTrainClose")?.focus();
  }

  function closeStageTrainModal() {
    const modal = document.getElementById("stageTrainModal");
    modal?.close();
    modal?.remove();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeStageTrainModal();
  });

  /* ASCII-символы тем — без эмодзи, моноширинные глифы */
  const TOPIC_SYMBOL = {
    54: "np[]", 55: "test", 56: "xlsx", 57: "html", 58: "model", 59: "HTTP", 60: "plot",
    0: "()", 1: "x =", 2: "7//2", 3: "def", 4: "'ab'", 5: "T|F", 6: "if:", 7: "for", 8: "[..]",
    9: "(..)", 10: "{k:v}", 11: "{ }", 12: ">>>", 13: "ret", 14: "L>G",
    15: "*arg", 16: "def=", 17: "open", 18: "try:", 19: "[for]", 20: "{for}",
    21: "sort", 22: "λ x:", 23: "math", 24: "date", 25: "f(f)", 26: '"{}"',
    27: "next", 28: "yld", 29: "@dec", 30: "f()f", 31: "with", 32: "class",
    33: "A(B)", 34: "__x__", 35: "@prop", 36: "@data", 37: ":int", 38: "copy",
    39: "raise", 40: "O(n)", 41: "[a:b]", 42: "zip", 43: "{:f}", 44: "cnt", 45: "pep",
    46: "path", 47: "rnd", 48: "re", 49: "csv", 50: "cli", 51: "sql", 52: "pd", 53: "agg",
  };
  const LEVEL_ORDER = ["beginner", "intermediate", "advanced", "expert"];
  const LEVEL_TITLE = {
    beginner: "Начальный уровень",
    intermediate: "Средний уровень",
    advanced: "Продвинутый уровень",
    expert: "Экспертный уровень",
  };

  /* Тизер теории: первая фраза без HTML-тегов */
  function theoryTeaser(topicId) {
    const plain = normalizeTheory(topicId).plainText;
    const m = plain.match(/^.*?[.!?](?=\s|$)/);
    return m ? m[0] : plain.slice(0, 120);
  }

  /* Безопасный мини-markdown для условий и чата ИИ: сначала полное экранирование,
     потом разметка. Поддержка: ```код```, `код`, **жирный**, *курсив*,
     заголовки ###, списки -/1., абзацы. */
  function renderMd(src) {
    const codeBlocks = [];
    let s = String(src ?? "");
    s = s.replace(/```\w*\n?([\s\S]*?)```/g, (m, code) => {
      codeBlocks.push(code.replace(/\n$/, ""));
      return "\u0000" + (codeBlocks.length - 1) + "\u0000";
    });
    s = esc(s);
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
    s = s.replace(/^#{1,4} (.+)$/gm, "<b class=\"md-h\">$1</b>");
    // списки: подряд идущие строки-пункты собираем в ul/ol
    s = s.replace(/(?:^|\n)((?:[-*] .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[-*] /, "")}</li>`).join("");
      return `\n<ul class="md-list">${items}</ul>`;
    });
    s = s.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("");
      return `\n<ol class="md-list">${items}</ol>`;
    });
    s = s.split(/\n{2,}/).map((p) => {
      const t = p.trim();
      if (!t) return "";
      if (t.startsWith("<ul") || t.startsWith("<ol") || t.startsWith("\u0000")) return t;
      return `<p>${t.replace(/\n/g, "<br>")}</p>`;
    }).join("");
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) =>
      `<pre class="md-code"><code>${esc(codeBlocks[+i])}</code></pre>`);
    return s;
  }

  function generateChoices(task) {
    const ans = task.answer.trim();
    if (!ans || ans.split("\n").length > 2) return null;

    /* Авторские ловушки из коллекции — приоритетнее автогенерации */
    const authored = [...new Set(
      Array.isArray(task.wrong)
        ? task.wrong.map((w) => String(w).trim()).filter((w) => w && w !== ans)
        : []
    )];
    if (authored.length >= 2) {
      return shuffle([ans, ...authored.slice(0, 3)]);
    }

    const pool = new Set();
    const add = (value) => {
      const s = String(value ?? "").trim();
      if (s && s !== ans) pool.add(s);
    };

    if (ans.includes("<class")) {
      add(ans.replace(/'str'/g, "'int'"));
      add(ans.replace(/'float'/g, "'str'"));
      add(ans.replace(/'int'/g, "'float'"));
      add(ans.replace(/<class '/g, "").replace(/'>/g, ""));
      add("int float str");
      add(ans.replace("'str'", "'float'"));
    } else if (/^(True|False)( (True|False))*$/.test(ans)) {
      const parts = ans.split(" ");
      add(parts.map((p) => (p === "True" ? "False" : "True")).join(" "));
      add(parts.map((p, i) => (i === 0 ? (p === "True" ? "False" : "True") : p)).join(" "));
      if (parts.length > 1) {
        add(parts.map((p, i) => (i === parts.length - 1 ? (p === "True" ? "False" : "True") : p)).join(" "));
      }
    } else if (/^-?[\d.]+( +-?[\d.]+)*$/.test(ans)) {
      const parts = ans.split(/\s+/);
      const nums = parts.map(Number);

      /* Меняем ОДИН компонент типичными заблуждениями — не ±1 ко всем сразу */
      for (let i = 0; i < parts.length; i++) {
        const n = nums[i];
        if (!Number.isFinite(n)) continue;
        const one = (next) => {
          const copy = parts.slice();
          copy[i] = String(next);
          add(copy.join(" "));
        };
        if (n !== 0) one(-n); /* забыли abs / знак */
        if (parts[i].includes(".")) {
          one(Math.trunc(n)); /* отбросили дробь */
          one(Number((n + Math.sign(n || 1) * 0.01).toFixed(2))); /* «округлили не туда» */
        } else {
          one(n + ".0"); /* путают int и float */
          one(n + 1);
          one(n - 1);
        }
      }

      if (parts.length >= 2) {
        add(parts.slice().reverse().join(" ")); /* перепутали порядок print */
        add([String(nums[0] + 1), ...parts.slice(1)].join(" "));
        add([String(nums[0] - 1), ...parts.slice(1)].join(" "));
      } else {
        add(String(nums[0] + 1));
        add(String(nums[0] - 1));
        if (ans.includes(".")) add(ans.replace(/\.0$/, ""));
        else add(ans + ".0");
      }

      /* Слабый запас: все ±1 — только если ловушек мало */
      add(nums.map((n) => String(n + 1)).join(" "));
      add(nums.map((n) => String(n - 1)).join(" "));
    } else {
      add(ans.toLowerCase());
      add(ans.toUpperCase());
      if (ans.includes("'") && !ans.includes('"')) add(ans.replace(/'/g, '"'));
      if (ans.includes("[") && ans.includes("]")) {
        add(ans.replace("[", "(").replace("]", ")"));
      }
    }

    const wrong = [...pool].filter((x) => x && x !== ans);
    /* Сначала более «похожие» по длине/токенам, чтобы ±1-ко всем не вытесняли ловушки */
    wrong.sort((a, b) => {
      const score = (s) => {
        const sameTokens = s.split(/\s+/).length === ans.split(/\s+/).length ? 2 : 0;
        const nearLen = Math.abs(s.length - ans.length) <= 2 ? 1 : 0;
        const allShift = /^-?[\d.]+( +-?[\d.]+)*$/.test(ans) && s === ans.split(/\s+/).map((n) => String(Number(n) + 1)).join(" ") ? -3 : 0;
        const allShiftM = /^-?[\d.]+( +-?[\d.]+)*$/.test(ans) && s === ans.split(/\s+/).map((n) => String(Number(n) - 1)).join(" ") ? -3 : 0;
        return sameTokens + nearLen + allShift + allShiftM;
      };
      return score(b) - score(a);
    });
    if (wrong.length < 2) return null;
    return shuffle([ans, ...wrong.slice(0, 3)]);
  }

  function terminalHtml(code, label, innerHtml) {
    const body = innerHtml != null
      ? innerHtml
      : `<pre class="terminal-body"><code>${esc(code)}</code></pre>`;
    return `
    <div class="terminal-glass readonly">
      <div class="terminal-label-bar"><span class="terminal-title">${esc(label)}</span></div>
      ${body}
    </div>`;
  }

  function terminalEditorHtml(label, innerHtml, opts) {
    const actions = [];
    if (opts?.resetId) {
      actions.push(
        `<button type="button" class="term-reset-btn" id="${esc(opts.resetId)}" ` +
        `title="${esc(opts.resetTitle || "Сбросить код к исходному")}" ` +
        `aria-label="${esc(opts.resetTitle || "Сбросить код к исходному")}"><span class="nf nf-restore" aria-hidden="true"></span></button>`
      );
    }
    const actionsHtml = actions.length
      ? `<span class="terminal-actions">${actions.join("")}</span>`
      : "";
    return `
    <div class="terminal-glass editable">
      <div class="terminal-label-bar">
        ${opts?.editorId ? `<label class="terminal-title" for="${esc(opts.editorId)}">${esc(label)}</label>` : `<span class="terminal-title">${esc(label)}</span>`}
        ${actionsHtml}
      </div>
      ${innerHtml}
    </div>${opts?.resetId ? (window.RuntimeHelp?.html() || "") : ""}`;
  }

  let solved = new Set();
  let level = "all";
  let query = "";
  const openTopics = new Set();

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  /* Условия/пояснения из markdown: `код` и **жирный** после экранирования */
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

  /* ── Индикатор ожидания ИИ: анимированные точки + случайное шутливое слово ── */
  const THINKING_WORDS = [
    "думает", "соображает", "кумекает", "колдует над кодом", "варит идею",
    "вникает", "настраивается", "разгадывает", "дебажит мысли",
    "компилирует ответ", "сверяется с PEP 8", "считает питонов",
    "заваривает чай", "чешет затылок", "листает конспект",
  ];
  const randomThinkingWord = () => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
  const thinkingHtml = (who) =>
    `<span class="thinking-dots"><i></i><i></i><i></i></span><span>${esc(who)} ${randomThinkingWord()}</span>`;
  /* Для мест с уже осмысленным текстом («смотрит вашу попытку») — те же точки,
   * но без замены готовой фразы случайным словом. */
  const waitingHtml = (text) =>
    `<span class="thinking-dots"><i></i><i></i><i></i></span><span>${text}</span>`;

  /* ── Модалка успеха ─────────────────────────────────────────────────── */
  const successModal = $("successModal");
  let successNextHref = null;
  // последнее ревью наставника: дублируется в модалку успеха, когда приходит
  let lastReview = { taskId: null, html: null };
  let successModalTaskId = null;
  let successReturnFocus = null;
  let successCloseTimer = null;

  function renderSuccessReview() {
    const box = $("successReview");
    if (!box) return;
    if (successModalTaskId && lastReview.taskId === successModalTaskId && lastReview.html) {
      box.innerHTML = `<h3>Комментарий наставника</h3>${lastReview.html}`;
      box.hidden = false;
    } else {
      box.innerHTML = "";
      box.hidden = true;
    }
  }

  function showSuccessModal(points, nextTask, taskId, explanation = TASK_BY_ID[taskId]?.explanation) {
    playUiSound();
    clearTimeout(successCloseTimer);
    successModalTaskId = taskId || null;
    // submitBtn временно disabled во время проверки и уже мог потерять фокус.
    successReturnFocus = $("submitBtn") || document.activeElement;
    $("successXp").textContent = points > 0 ? "+" + points + " XP" : "Повторение";
    $("successMsg").textContent = nextTask
      ? "Задание принято. Можно перейти дальше или остаться и попробовать ещё варианты."
      : "Отлично! Это последнее задание в текущем списке.";
    $("successExplanationBody").innerHTML = renderMd(explanation);
    $("successExplanation").hidden = !explanation?.trim();
    renderSuccessReview();
    successNextHref = nextTask ? "#/task/" + nextTask.id : branchHref(TOPIC_OF[taskId]);
    const nextBtn = $("successNext");
    nextBtn.textContent = nextTask?.finale
      ? (nextTask.finale === 1 ? "К финалу темы" : "Вторая задача финала")
      : nextTask ? "Следующий этап" : "К списку тем";
    successModal.hidden = false;
    successModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("success-open");
    successModal.querySelector(".success-card").scrollTop = 0;
    $("successTitle").focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (successModalTaskId === taskId) successModal.classList.add("open");
    });
  }

  function closeSuccessModal() {
    clearTimeout(successCloseTimer);
    successModalTaskId = null;
    document.body.classList.remove("success-open");
    if (successReturnFocus?.isConnected) successReturnFocus.focus({ preventScroll: true });
    successReturnFocus = null;
    successModal.classList.remove("open");
    successCloseTimer = setTimeout(() => {
      if (!successModal.classList.contains("open")) {
        successModal.hidden = true;
        successModal.setAttribute("aria-hidden", "true");
      }
    }, 350);
  }

  $("successNext")?.addEventListener("click", () => {
    closeSuccessModal();
    if (successNextHref) location.hash = successNextHref.replace(/^#/, "");
  });
  $("successStay")?.addEventListener("click", closeSuccessModal);
  successModal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const first = $("successNext"), last = $("successStay");
    if (e.shiftKey && document.activeElement !== last) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  async function api(path, opts) {
    if (window.LearningSession) return window.LearningSession.json(path, opts);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Ошибка"), { status: res.status });
    return data;
  }
  const post = (path, body, signal) =>
    api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

  /* ── Авторизация ────────────────────────────────────────────────────── */
  let authMode = "login";
  async function ensureAccountSecurity(){
    if(!window.AccountSecurity){if(!window.CourseAssets?.load)throw new Error('Настройки входа пока недоступны.');try{await window.CourseAssets.load('account-security.js');}catch{throw new Error('Не удалось загрузить настройки входа. Проверьте соединение и попробуйте ещё раз.');}}
    if(!window.AccountSecurity)throw new Error('Не удалось загрузить настройки входа.');
  }
  function showLoginForm(username,notice=''){
    $('authForm').hidden=false;document.querySelector('.auth-tabs').hidden=false;$('authRecovery').hidden=false;$('accountRecoveryPanel').hidden=true;
    document.querySelector('.auth-tab[data-mode="login"]').click();
    if(username!==undefined)$('authUser').value=username;
    $('authPass').value='';$('authNotice').textContent=notice;$('authNotice').hidden=!notice;
    (username?$('authPass'):$('authUser')).focus();
  }
  $('authRecovery')?.addEventListener('click',async()=>{
    const epoch=authEpoch,button=$('authRecovery');button.disabled=true;$('authError').textContent='';$('authPass').value='';
    try{
      await ensureAccountSecurity();if(epoch!==authEpoch||!$('appView').hidden)return;
      $('authForm').hidden=true;document.querySelector('.auth-tabs').hidden=true;button.hidden=true;$('authNotice').hidden=true;
      window.AccountSecurity.recover($('accountRecoveryPanel'),$('authUser').value,showLoginForm);
    }catch(error){if(epoch===authEpoch)$('authError').textContent=error.message;}
    finally{button.disabled=false;}
  });
  function mountAccountSecurity(host){
    const epoch=authEpoch;let loading=false,mounted=false;
    const open=async()=>{
      if(!host.open||loading||mounted)return;loading=true;
      const placeholder=document.createElement('div');placeholder.className='security-placeholder';placeholder.innerHTML='<p role="status">Открываем настройки…</p>';host.querySelector('.security-placeholder')?.remove();host.appendChild(placeholder);
      try{
        await ensureAccountSecurity();if(!host.isConnected||!host.open||epoch!==authEpoch)return;
        placeholder.remove();mounted=true;
        window.AccountSecurity.mount(host,message=>{const name=lookUser;kickToAuth();showLoginForm(name,message);window.LearningSession?.announce();});
      }catch(error){if(host.isConnected&&host.open&&epoch===authEpoch){placeholder.innerHTML='<p role="alert">'+esc(error.message)+'</p><button class="btn">Повторить</button>';placeholder.querySelector('button').onclick=open;}}
      finally{loading=false;}
    };
    host.addEventListener('toggle',open);
  }
  let showAISettingsNext=false;
  function paintAIPreferences(){
    const pref=window.AIHelper.settings(),copy=$('autoReviewCopy'),send=$('aiForm')?.querySelector('button');
    if(copy)copy.textContent=copy.dataset.automatic==='false'?'Для этого этапа автоматический разбор не отправляется.':!pref.enabled?'ИИ отключён. Проверка и подсказки работают без него.':!pref.provider_available?'Наставник сейчас недоступен. Проверка и подсказки работают.':!pref.automatic_review?'Автоматический разбор отключён. Можно задать вопрос наставнику.':pref.history_context?'После проверки текущая и предыдущие попытки отправятся внешнему ИИ для разбора.':'После проверки текущая попытка отправится внешнему ИИ для разбора.';
    if(send)send.disabled=aiSubmitting||!pref.enabled||!pref.provider_available;
  }
  function mountAISettings(parent,host,onCleared){
    const owner=window.LearningSession.capture();let loading=false,mounted=false;
    const active=()=>parent.isConnected&&parent.open&&window.LearningSession.isCurrent(owner);
    const open=async()=>{
      if(!active()||loading||mounted)return;loading=true;host.innerHTML='<p role="status">Открываем настройки ИИ…</p>';
      try{if(!window.AISettings)await window.CourseAssets.load('ai-settings.js');if(!active())return;
        if(!window.AISettings)throw new Error('Настройки не загрузились.');mounted=true;
        window.AISettings.mount(host,{onChange:preferences=>{if(active()){window.AIHelper.configure(preferences);paintAIPreferences();}},onCleared});
      }catch{if(active()){host.innerHTML='<p role="alert">Не удалось загрузить настройки ИИ.</p><button class="btn" type="button">Повторить</button>';host.querySelector('button').onclick=open;}}
      finally{loading=false;}
    };parent.addEventListener('toggle',open);if(parent.open)void open();
  }

  document.querySelectorAll(".auth-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-pressed", "false"); });
      tab.classList.add("active");
      tab.setAttribute("aria-pressed", "true");
      authMode = tab.dataset.mode;
      $("authPass").setAttribute("autocomplete", authMode === "register" ? "new-password" : "current-password");
      $("authSubmit").textContent = authMode === "login" ? "Войти" : "Создать аккаунт";
      $("authError").textContent = "";
    })
  );

  let authSubmitting = false;
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authSubmitting) return;
    authSubmitting = true;
    $("authSubmit").disabled = true;
    $("authError").textContent = "";
    $('authNotice').hidden=true;$('authNotice').textContent='';
    try {
      const wasRegister = authMode === "register";
      const data = await post("/api/" + authMode, {
        username: $("authUser").value,
        password: $("authPass").value,
      });
      await enterApp(data.username);
      window.LearningSession?.announce();
      if (wasRegister) openQuiz();
    } catch (err) {
      $("authError").textContent = err.message;
    } finally {
      authSubmitting = false;
      $("authSubmit").disabled = false;
    }
  });

  /* ── Первый шаг: явный маршрут вместо неиспользуемой анкеты ───────── */
  const quizModal = $("quizModal");
  const onboardedUsers = new Set();
  const onboardingKey = () => lookUser ? `pycloud:u:${lookUser}:onboarded` : null;
  function hasSeenOnboarding() {
    if (onboardedUsers.has(lookUser)) return true;
    try { return !!(onboardingKey() && localStorage.getItem(onboardingKey()) === "1"); }
    catch (_) { return false; }
  }
  function rememberOnboarding() {
    if (!lookUser) return;
    onboardedUsers.add(lookUser);
    try { localStorage.setItem(onboardingKey(), "1"); } catch (_) { /* Session-only when storage is unavailable. */ }
    $("onboard")?.remove();
  }
  function openQuiz() {
    if (!lookUser || $("appView").hidden || quizModal.open) return;
    quizModal.hidden = false;
    quizModal.classList.add("open");
    quizModal.showModal();
  }
  function closeQuiz({ remember = false, restoreFocus = true } = {}) {
    const hadFocus = quizModal.contains(document.activeElement);
    if (remember) rememberOnboarding();
    if (quizModal.open) quizModal.close();
    quizModal.hidden = true;
    quizModal.classList.remove("open");
    if (restoreFocus && hadFocus && !$("appView").hidden) {
      const target = !$("listView").hidden
        ? document.querySelector(".bento-continue") || $("listView") : $("taskView");
      target?.focus({ preventScroll: true });
    }
  }
  function chooseStart(destination) {
    closeQuiz({ remember: true, restoreFocus: destination === "#/" });
    location.hash = destination;
  }
  quizModal.addEventListener("cancel", event => { event.preventDefault(); chooseStart("#/"); });
  $("quizDone").addEventListener("click", () => {
    const next = firstUnsolvedIn(ALL_TASKS) || ALL_TASKS[0];
    chooseStart(next ? learningHref(next) : "#/topics");
  });
  $("quizTopics").addEventListener("click", () => chooseStart("#/topics"));
  $("quizSkip").addEventListener("click", () => chooseStart("#/"));

  $("logoutBtn").addEventListener("click", async () => {
    try {
      await post("/api/logout", {});
    } catch (error) {
      if (error.code !== "session_changed") toast(esc(error.message));
      return;
    }
    solved = new Set();
    kickToAuth();
    window.LearningSession?.announce();
    $("sandboxFab").hidden = true;
    document.body.classList.remove("list-mode", "home-mode", "task-mode");
    closeSandbox();
  });

  let activeGame = null;
  function kickToAuth() {
    window.AccountSecurity?.leave();
    window.AISettings?.leave();window.AIHelper.configure(null);aiSubmitting=false;showAISettingsNext=false;
    $('authForm').hidden=false;document.querySelector('.auth-tabs').hidden=false;$('authRecovery').hidden=false;$('accountRecoveryPanel').hidden=true;
    $('authNotice').hidden=true;$('authNotice').textContent='';
    $("shopPurchaseDialog")?.close();
    window.EditorDrafts?.configure(false);
    weeklyEnabled = false;
    stopWeeklyFocus();
    window.LearningSession?.setUser("");
    window.EntryDiagnostic?.reset();
    window.OutputFiles?.clearAll();
    window.RuntimeHelp?.configure?.({});
    const leavingApp = !$("appView").hidden;
    closeStageTrainModal();
    closeQuiz();
    activeGame?.stop();
    activeGame = null;
    window.CloudChest?.close();
    window.TopicMap?.destroy();
    closeAI();
    $("aiQuestion").value = "";
    $("aiLog").replaceChildren();
    lookUser = "";
    clearAppliedLooks();
    authEpoch++;
    dailyAiCache = null;
    sandboxDraft?.destroy();
    sandboxDraft = null;
    sandboxEditor.value = "";
    sandboxTerminal.clear();
    closeSandbox();
    $("sandboxFab").hidden = true;
    $("taskView").replaceChildren();
    $("appView").hidden = true;
    $("authView").hidden = false;
    if (leavingApp) $("authUser").focus();
  }

  async function enterApp(username) {
    window.AccountSecurity?.leave();
    window.AISettings?.leave();window.AIHelper.configure(null);aiSubmitting=false;
    window.LearningSession?.setUser(username);
    window.EntryDiagnostic?.reset();
    window.OutputFiles?.clearAll();
    window.CloudChest?.close();
    lookUser = String(username || "");
    authEpoch++;
    const enteringEpoch = authEpoch;
    resetWallet();
    earnedAchievements = {};
    statsDates = [];
    serverStreak = 0;
    dailyAiCache = null;
    sandboxDraft?.destroy();
    sandboxDraft = null;
    $("userName").textContent = username;
    const prog = await api("/api/progress");
    window.AIHelper.configure(prog.ai_settings);paintAIPreferences();
    window.EditorDrafts?.configure(prog.runtime_features?.draft_sync === true);
    window.LearningArchive?.configure(prog.runtime_features?.learning_archive === true);
    weeklyEnabled = prog.runtime_features?.weekly_practice === true;
    sandboxDraft = bindLocalDraft(sandboxEditor, "sandbox", SANDBOX_STARTER);
    window.RuntimeHelp?.configure?.(prog.runtime_features || {});
    solved = new Set(prog.solved);
    taskXp = prog.task_xp || {};
    // A running older backend may still serve the newer static catalogue during an update.
    TOPICS.splice(0,TOPICS.length,...curriculum.availableTopics(RAW_TOPICS,taskXp));
    ALL_TASKS.splice(0,ALL_TASKS.length,...TOPICS.flatMap(topic=>topic.tasks));
    $("footCount").textContent = TOPICS.length + " тем · " + ALL_TASKS.length + " заданий";
    serverXp = Number.isFinite(prog.xp) ? prog.xp : null;
    $("authView").hidden = true;
    $("appView").hidden = false;
    $("sandboxFab").hidden = false;
    route(); // Core learning routes do not depend on optional wallet delivery.
    (async () => {
      const loaded = await loadWallet();
      if (enteringEpoch !== authEpoch || $("appView").hidden) return;
      if (loaded) { try { syncLooksFromOwnership(); } catch (_) {} }
      await loadAchievements();
      if (enteringEpoch !== authEpoch || $("appView").hidden) return;
      const s = await api("/api/stats");
      if (enteringEpoch !== authEpoch || $("appView").hidden) return;
      serverStreak = s.streak || 0;
      statsDates = (s.solved || []).map((x) => x.solved_at);
      checkAchievements();
      if (document.body.classList.contains("list-mode") || document.body.classList.contains("home-mode")) renderList();
    })().catch(() => {});
  }

  /* ── Факты дня о Python ─────────────────────────────────────────────── */
  const PY_FACTS = [
    "Python назван не в честь змеи, а в честь шоу «Monty Python's Flying Circus».",
    "Гвидо ван Россум начал писать Python в декабре 1989 года — как хобби на рождественских каникулах.",
    "«Дзен Python» спрятан в самом языке: наберите import this в любом интерпретаторе.",
    "import antigravity открывает комикс xkcd про Python. Это официальная пасхалка.",
    "Instagram, YouTube и Spotify держат значительную часть бэкенда на Python.",
    "NASA использует Python в обработке данных телескопа James Webb.",
    "Целые числа Python не переполняются: 2**10000 — честное число из 3011 цифр.",
    "Алгоритм сортировки Timsort придумали для Python, а теперь он в Java и Android.",
    "В Python всё — объект: даже функции и классы можно класть в списки.",
    "PEP 8 — стиль кода Python — один из самых читаемых стандартов в индустрии.",
    "На PyPI больше полумиллиона пакетов: от управления дронами до анализа ДНК.",
    "Синтаксис с отступами Python взял из языка ABC, где Гвидо работал до этого.",
    "Слово «pythonic» вошло в словарь программистов: значит «красиво и по-питоновски».",
    "Python дважды признавался языком года по TIOBE чаще любого другого языка.",
  ];
  const factOfDay = () =>
    PY_FACTS[hashStr(new Date().toISOString().slice(0, 10)) % PY_FACTS.length];

  /** Три факта на день: API + запасные из PY_FACTS. */
  function factsForDay(primary) {
    const day = new Date().toISOString().slice(0, 10);
    const seed = hashStr(day);
    const pool = PY_FACTS.filter((f) => f !== primary);
    const a = pool[seed % pool.length];
    const b = pool[(seed * 7 + 3) % pool.length];
    const list = [primary || factOfDay(), a, b].filter(Boolean);
    // уникальные, ровно 3
    const uniq = [];
    for (const f of list) {
      if (!uniq.includes(f)) uniq.push(f);
      if (uniq.length >= 3) break;
    }
    while (uniq.length < 3) uniq.push(PY_FACTS[(seed + uniq.length * 11) % PY_FACTS.length]);
    return uniq.slice(0, 3);
  }

  let cachedDayFacts = null;

  async function loadDayFacts() {
    const day = new Date().toISOString().slice(0, 10);
    if (cachedDayFacts && cachedDayFacts.day === day) return cachedDayFacts.facts;
    let primary = factOfDay();
    try {
      const data = await api("/api/fact");
      if (Array.isArray(data.facts) && data.facts.length >= 3) {
        cachedDayFacts = { day, facts: data.facts.slice(0, 3) };
        return cachedDayFacts.facts;
      }
      if (data.fact) primary = data.fact;
    } catch (e) { /* offline */ }
    cachedDayFacts = { day, facts: factsForDay(primary) };
    try { localStorage.setItem("pycloud:day-facts:" + day, JSON.stringify(cachedDayFacts.facts)); } catch (_) {}
    return cachedDayFacts.facts;
  }

  /* ── Прогресс / XP ──────────────────────────────────────────────────── */
  function currentXp() {
    if (serverXp !== null) return serverXp;
    // Compatibility with a server that has not yet been restarted after an update.
    let xp = 0;
    solved.forEach((id) => { if (TASK_BY_ID[id]) xp += pointsFor(TASK_BY_ID[id]); });
    return xp;
  }

  function courseSolvedCount() {
    return ALL_TASKS.reduce((count, task) => count + (solved.has(task.id) ? 1 : 0), 0);
  }

  function renderProgress() {
    const xp = currentXp();
    const courseDone = courseSolvedCount();
    let rank = RANKS[0], next = null;
    for (let i = 0; i < RANKS.length; i++)
      if (xp >= RANKS[i].min) { rank = RANKS[i]; next = RANKS[i + 1] || null; }
    const frac = next ? Math.min(1, (xp - rank.min) / (next.min - rank.min)) : 1;
    $("rankName").textContent = rank.name;
    $("xpLabel").textContent = xp + " XP";
    $("xpFill").style.width = (frac * 100).toFixed(1) + "%";
    $("stats").textContent = "решено " + courseDone + " / " + ALL_TASKS.length +
      (next ? " · до ранга «" + next.name + "»: " + (next.min - xp) + " XP" : " · максимальный ранг");
  }

  async function setSolved(taskId, isSolved) {
    let resp;
    try {
      resp = await post("/api/progress", { task_id: taskId, solved: isSolved });
    } catch (err) {
      if (err.status === 401) kickToAuth();
      throw err;
    }
    if (isSolved) solved.add(taskId); else solved.delete(taskId);
    serverXp = Number.isFinite(resp.xp) ? resp.xp : null;
    renderProgress();
    if (resp && typeof resp.drops === "number") {
      if (resp.drops_awarded > 0) flyDrops(resp.drops_awarded);
      setWallet({ drops: resp.drops });
    }
    if (resp.chest_launches_awarded > 0) toast(`Тема завершена · бонусных запусков ×5: ${resp.chest_launches_awarded}`);
    const cosmeticRewards=[...(resp.titles_unlocked || []),...(resp.frames_unlocked || [])];
    cosmeticRewards.forEach(reward=>{ITEM_TITLES[reward.item]=reward.item_title;});
    handleSetsUnlocked(cosmeticRewards);
    checkAchievements();
    return resp;
  }

  /* ── Кошелёк: капли и заморозки ─────────────────────────────────────── */
  let wallet = { drops: 0, freezes: 0, owned: [] };
  let shopCatalog = {};
  let titleRewardCatalog = {};
  let frameRewardCatalog = {};
  let walletKnownDrops = false, walletMutation = 0, walletRead = 0, walletPending = null;
  let walletFieldVersion = { drops: 0, freezes: 0 };
  const walletOwnedAdds = new Set();

  const walletDropsLabel = () => walletKnownDrops ? wallet.drops : '—';
  function paintWallet() {
    const label = walletDropsLabel(), el = $("dropsLabel");
    if (el) el.textContent = label;
    document.querySelectorAll("[data-wallet-drops]").forEach(node => { node.textContent = label; });
  }
  function resetWallet() {
    $("shopPurchaseDialog")?.close();
    wallet = { drops: 0, freezes: 0, owned: [] };
    shopCatalog = {}; titleRewardCatalog = {}; frameRewardCatalog = {}; walletKnownDrops = false; walletOwnedAdds.clear();
    walletMutation++; walletRead++; walletPending = null;
    walletFieldVersion = { drops: 0, freezes: 0 };
    paintWallet();
  }

  function setWallet(patch, fromRead = false) {
    const clean = {};
    for (const key of ['drops', 'freezes']) if (Number.isFinite(patch[key])) {
      clean[key] = patch[key];
      if (!fromRead) walletFieldVersion[key]++;
    }
    if (Array.isArray(patch.owned)) clean.owned = [...new Set(patch.owned)];
    if (!fromRead && Object.keys(clean).length) walletMutation++;
    wallet = { ...wallet, ...clean };
    if (Object.hasOwn(clean, 'drops')) walletKnownDrops = true;
    paintWallet();
  }

  function addOwnedItem(item) {
    if (typeof item !== 'string' || !item) return;
    walletOwnedAdds.add(item); walletMutation++;
    wallet.owned = [...new Set([...wallet.owned, item])];
  }
  function loadWallet() {
    const epoch = authEpoch;
    if (walletPending?.epoch === epoch && walletPending.mutation === walletMutation) return walletPending.promise;
    const sequence = ++walletRead, versions = { ...walletFieldVersion };
    const pending = { epoch, mutation: walletMutation, promise: null }; walletPending = pending;
    pending.promise = (async () => {
      try {
        const w = await api("/api/wallet");
        if (epoch !== authEpoch || sequence !== walletRead) return false;
        if (!Number.isFinite(w?.drops) || !Array.isArray(w.owned)) return false;
        shopCatalog = w.shop || {};
        titleRewardCatalog = w.title_rewards || {};
        frameRewardCatalog = w.frame_rewards || {};
        Object.entries(shopCatalog).forEach(([k, v]) => { ITEM_TITLES[k] = v.title; });
        Object.entries(w.set_items || {}).forEach(([k, v]) => { ITEM_TITLES[k] = v; });
        const patch = { owned: [...new Set([...w.owned, ...walletOwnedAdds])] };
        for (const key of ['drops', 'freezes']) if (versions[key] === walletFieldVersion[key]) patch[key] = w[key];
        setWallet(patch, true);
        for (const item of w.owned) walletOwnedAdds.delete(item);
        return true;
      } catch (_) { return false; }
      finally { if (walletPending === pending) walletPending = null; }
    })();
    return pending.promise;
  }
  function refreshWalletAfterReward() {
    walletMutation++; walletFieldVersion.drops++; walletKnownDrops = false;
    paintWallet();
    return loadWallet();
  }

  /* всплывающее «+N» у кошелька в шапке */
  function flyDrops(n) {
    const pill = $("dropsPill");
    if (!pill) return;
    const fly = document.createElement("span");
    fly.className = "drops-fly";
    fly.textContent = "+" + n;
    pill.appendChild(fly);
    setTimeout(() => fly.remove(), 1400);
  }

  /* ── Скины / эффекты: только для текущего пользователя ─────────────── */
  let lookUser = "";
  let authEpoch = 0;
  window.getLearningAuthEpoch = () => authEpoch;
  const SKY_SKINS = ["sky_dawn", "sky_sunset", "sky_night", "sky_space", "sky_aurora", "sky_storm", "sky_lagoon", "sky_moon", "sky_forest", "sky_sakura", "sky_snow", "sky_desert", "sky_rain"];
  const FX_OVERLAYS = ["fx_leaves", "fx_fireflies", "fx_snow", "fx_meteors", "fx_petals", "fx_embers", "fx_constellations"];
  const TERM_THEMES = ["term_phosphor", "term_amber", "term_ice", "term_lilac", "term_mint", "term_rose", "term_sand", "term_ocean"];
  const PROFILE_FRAMES = ["frame_orbit", "frame_constellation", "frame_aurora", "frame_sunbeam", "frame_terminal", "frame_circuit", "frame_paper", "frame_glacier", "frame_ember"];
  const PROFILE_BANNERS = ['banner_constellation','banner_geometry','banner_waves','banner_aurora','banner_valley','banner_nebula'];
  const CURSORS = ['cursor_orbit','cursor_diamond','cursor_comet'];
  const SOUND_THEMES = ['sound_drops','sound_glass','sound_keys'];
  const LOOK_KINDS = ["sky", "term", "fx", "title", "frame", "banner", "cursor", "sound", "fx_scale", "fx_density", "motion"];
  let appliedFx = '';
  let soundContext = null;
  let soundNodes = [];

  function lookStorageKey(kind) {
    return lookUser ? `pycloud:u:${lookUser}:${kind}` : null;
  }
  function getLook(kind) {
    const k = lookStorageKey(kind);
    return k ? localStorage.getItem(k) : null;
  }
  function setLook(kind, value) {
    const k = lookStorageKey(kind);
    if (!k) return;
    if (value) localStorage.setItem(k, value);
    else localStorage.removeItem(k);
  }
  function applySkin(key) {
    SKY_SKINS.forEach((k) => document.body.classList.remove("skin-" + k));
    if (key && SKY_SKINS.includes(key)) document.body.classList.add("skin-" + key);
    if (window.__leavesRecolor) window.__leavesRecolor();
    window.SkyScenes?.setSkin?.(key);
    syncSkyMotion();
  }
  function applyFx(key) {
    appliedFx = FX_OVERLAYS.includes(key) ? key : '';
    document.body.classList.toggle("fx-leaves", key === "fx_leaves");
    window.SkyScenes?.setEffect?.(key);
    syncSkyMotion();
  }
  function syncSkyMotion() {
    const paused=getLook('motion')==='paused';
    document.body.classList.toggle('sky-motion-paused',paused);
    window.SkyScenes?.setPaused?.(paused);
    if(window.__leavesSync)window.__leavesSync(appliedFx==='fx_leaves'&&!paused);
    const button=$('skyMotionToggle');
    if(button){button.setAttribute('aria-pressed',String(paused));button.textContent=paused?'Продолжить фон':'Пауза фона';}
  }
  $('skyMotionToggle')?.addEventListener('click',()=>{setLook('motion',getLook('motion')==='paused'?'':'paused');syncSkyMotion();});
  function applyTermTheme(key) {
    TERM_THEMES.forEach((k) => document.body.classList.remove("theme-" + k));
    if (key && TERM_THEMES.includes(key)) document.body.classList.add("theme-" + key);
  }
  function clearAppliedLooks() {
    applySkin("");
    applyTermTheme("");
    applyFx("");
    applyFrame("");
    applyBanner('');applyCursor('');
    if(soundContext){soundContext.close().catch(()=>{});soundContext=null;soundNodes=[];}
  }
  function applyFrame(key) {
    PROFILE_FRAMES.forEach(k => document.body.classList.remove("look-" + k));
    if (PROFILE_FRAMES.includes(key)) document.body.classList.add("look-" + key);
  }
  function applyBanner(key) {
    PROFILE_BANNERS.forEach(k=>document.body.classList.remove('look-'+k));
    if(PROFILE_BANNERS.includes(key))document.body.classList.add('look-'+key);
    document.querySelectorAll('.profile-cover-canvas').forEach(node=>node.remove());
    if(['banner_aurora','banner_valley','banner_nebula'].includes(key))document.querySelectorAll('.profile-hero').forEach(hero=>{
      const canvas=document.createElement('canvas');canvas.className='profile-cover-canvas';canvas.setAttribute('aria-hidden','true');
      hero.prepend(canvas);window.SkyScenes?.preview(canvas,key);
    });
  }
  function applyCursor(key) {
    CURSORS.forEach(k=>document.body.classList.remove('look-'+k));
    if(CURSORS.includes(key))document.body.classList.add('look-'+key);
  }
  function prepareUiSound() {
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)return null;
      if(!soundContext)soundContext=new Audio();
      if(soundContext.state==='suspended')soundContext.resume().catch(()=>{});
      return soundContext;
    }catch(_){return null;}
  }
  function playUiSound(key=getLook('sound'),preview=false) {
    if(!SOUND_THEMES.includes(key)||(!preview&&!wallet.owned.includes(key)))return;
    const context=prepareUiSound();if(!context)return;
    soundNodes.forEach(node=>{try{node.stop();}catch(_){}});soundNodes=[];
    const tones={sound_drops:[660,880],sound_glass:[880,1320],sound_keys:[440,550,660]}[key];
    tones.forEach((frequency,index)=>{
      const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*.065;
      oscillator.type=key==='sound_keys'?'triangle':'sine';oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.035,start+.008);gain.gain.exponentialRampToValueAtTime(.0001,start+.18);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.2);
      soundNodes.push(oscillator);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();soundNodes=soundNodes.filter(node=>node!==oscillator);};
    });
  }
  const unlockSound=()=>{const key=getLook('sound');if(SOUND_THEMES.includes(key)&&wallet.owned.includes(key))prepareUiSound();};
  document.addEventListener('pointerdown',unlockSound,{passive:true});
  document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')unlockSound();});
  function purgeLegacyGlobalLooks() {
    LOOK_KINDS.forEach((kind) => {
      const legacyKey = "pycloud:" + kind;
      const legacy = localStorage.getItem(legacyKey);
      if (legacy == null) return;
      if (getLook(kind) == null) {
        if (kind === "fx_scale" || kind === "fx_density") setLook(kind, legacy);
        else if ((wallet.owned || []).includes(legacy)) setLook(kind, legacy);
      }
      localStorage.removeItem(legacyKey);
    });
  }
  function syncLooksFromOwnership() {
    purgeLegacyGlobalLooks();
    const sky = getLook("sky");
    const term = getLook("term");
    const fx = getLook("fx");
    const title = getLook("title");
    const frame = getLook("frame");
    if (sky && !(wallet.owned || []).includes(sky)) setLook("sky", "");
    if (term && !(wallet.owned || []).includes(term)) setLook("term", "");
    if (fx && !(wallet.owned || []).includes(fx)) setLook("fx", "");
    if (title && !(wallet.owned || []).includes(title)) setLook("title", "");
    if (frame && !(wallet.owned || []).includes(frame)) setLook("frame", "");
    for(const kind of ['banner','cursor','sound'])if(getLook(kind)&&!wallet.owned.includes(getLook(kind)))setLook(kind,'');
    applySkin(getLook("sky") || "");
    applyTermTheme(getLook("term") || "");
    applyFx(getLook("fx") || "");
    applyFrame(getLook("frame") || "");
    applyBanner(getLook('banner')||'');applyCursor(getLook('cursor')||'');
  }
  // До логина не применяем чужие скины; старые глобальные ключи снимутся при входе
  clearAppliedLooks();

  /* ── Достижения ─────────────────────────────────────────────────────── */
  let earnedAchievements = {};
  let statsDates = [];        // solved_at всех решений (для серии и цели недели)
  let blitzBest = +(localStorage.getItem("pycloud:blitzbest") || 0);
  let orderBest = +(localStorage.getItem("pycloud:orderbest") || 0);
  let matchBest = +(localStorage.getItem("pycloud:matchbest") || 0);
  let traceBest = +(localStorage.getItem("pycloud:tracebest") || 0);
  let fillBest = +(localStorage.getItem("pycloud:fillbest") || 0);
  let serverStreak = 0;

  /* награды за комплекты достижений — общий обработчик ответа сервера */
  function handleSetsUnlocked(list) {
    (list || []).forEach((s) => {
      addOwnedItem(s.item);
      toast(`<span class="toast-icon">[*]</span><b>${esc(s.set)}</b><br>Награда: ${esc(s.item_title)}`);
    });
  }

  /* ── Титулы ─────────────────────────────────────────────────────────── */
  const ITEM_TITLES = {}; // заполняется из /api/wallet (shop + set_items)
  function activeTitle() {
    const t = getLook("title");
    return t && wallet.owned.includes(t) ? (ITEM_TITLES[t] || "").replace(/^Титул: /, "") : null;
  }
  async function loadAchievements() {
    const epoch = authEpoch;
    try {
      const data = await api("/api/achievements");
      if (epoch === authEpoch) earnedAchievements = data.earned || {};
    } catch (e) { /* гость */ }
  }

  function achievementState() {
    const byLevelDone = {};
    LEVEL_ORDER.forEach((lv) => {
      const tasks = ALL_TASKS.filter((t) => TOPIC_OF[t.id].level === lv);
      byLevelDone[lv] = tasks.length > 0 && tasks.every((t) => solved.has(t.id));
    });
    return {
      solved,
      streak: serverStreak,
      blitzBest,
      orderBest,
      matchBest,
      traceBest,
      fillBest,
      byLevelDone,
      functionSolved: ALL_TASKS.some((t) => t.type === "написать функцию" && solved.has(t.id)),
      challengeSolved: [...solved].some((id) => id.startsWith("C")),
    };
  }

  function toast(html) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = html;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 3600);
  }

  async function checkAchievements() {
    if (!window.computeAchievements) return;
    const deserved = window.computeAchievements(achievementState());
    for (const key of deserved) {
      if (earnedAchievements[key]) continue;
      try {
        const r = await post("/api/achievements/claim", { key });
        earnedAchievements[key] = new Date().toISOString();
        if (r.new) {
          const def = window.ACHIEVEMENTS.find((a) => a.key === key);
          flyDrops(r.bonus);
          toast(`<span class="toast-icon">${esc(def?.icon || "*")}</span><b>Достижение: ${esc(def?.title || key)}</b><br>+${r.bonus} капель`);
          handleSetsUnlocked(r.sets_unlocked);
          refreshWalletAfterReward();
        }
      } catch (e) { /* не фатально */ }
    }
  }

  /* ── Роутер ─────────────────────────────────────────────────────────── */
  function focusPageContent() {
    if ($("appView").hidden) return;
    const target = $("listView").hidden ? $("taskView") : $("listView");
    target.focus();
    target.scrollIntoView({ block: "start", behavior: "auto" });
  }
  $("skipContent")?.addEventListener("click", event => {
    event.preventDefault();
    closeAI();
    closeSandbox();
    focusPageContent();
  });
  let keyboardNavigation = null;
  let focusRevision = 0;
  document.addEventListener("focusin", () => { focusRevision++; });
  const focusKeyboardDestination = ({ link, revision }) => requestAnimationFrame(() => {
    if (revision === focusRevision && link.hash === location.hash && document.activeElement === link) focusPageContent();
  });
  document.addEventListener("click", event => {
    const revision = ++focusRevision;
    const link = event.target?.closest?.(".main-nav .nav-link");
    keyboardNavigation = link && event.detail === 0 && !event.defaultPrevented &&
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey ? { link, revision } : null;
    if (keyboardNavigation?.link.hash === location.hash) {
      focusKeyboardDestination(keyboardNavigation);
      keyboardNavigation = null;
    }
  });
  window.addEventListener("hashchange", () => {
    const navigation = keyboardNavigation;
    keyboardNavigation = null;
    if (navigation) focusKeyboardDestination(navigation);
  });
  function route() {
    closeQuiz({ restoreFocus: false });
    stopWeeklyFocus();
    window.EntryDiagnostic?.leave();
    window.Workshop?.leave();
    window.AccountSecurity?.leave();
    window.AISettings?.leave();
    gameResultCleanups.splice(0).forEach(cleanup=>cleanup());
    closeStageTrainModal();
    activeGame?.stop();
    activeGame = null;
    if (!isTopicsRoute()) window.TopicMap?.destroy();
    closeAI();
    renderProgress();
    if (successModal && !successModal.hidden) closeSuccessModal(); // смена страницы закрывает модалку
    const m = location.hash.match(/^#\/task\/(C?\d+\.\d+)$/);
    const theoryM = location.hash.match(/^#\/topic\/(\d+)\/theory$/);
    const gm = location.hash.match(/^#\/game\/(blitz|order|match|trace|fill|riddle|counterexample)$/);
    const dm = location.hash.match(/^#\/daily\/(intermediate|advanced|expert)$/);
    const am = location.hash.match(/^#\/atlas\/([a-z0-9-]+)$/);
    const onAtlas = location.hash === "#/atlas" || !!am;
    if (m && TASK_BY_ID[m[1]] && !TOPICS.includes(TOPIC_OF[m[1]])) {
      location.hash = branchHref(TOPIC_OF[m[1]]);
      return;
    }
    const onTask = !!(m && TASK_BY_ID[m[1]]);
    const onTheory = !!theoryM;
    const onDaily = !!dm;
    const onReview = location.hash === "#/review";
    const onDiagnostic = location.hash === "#/diagnostic";
    const onProfile = location.hash === "#/profile";
    const onUpdates = location.hash === "#/updates";
    const onShop = location.hash === "#/shop";
    const onWorkshop = /^#\/workshop(?:\/[0-9a-f]{32})?$/.test(location.hash);
    const onGameHub = location.hash === "#/game" || location.hash === "#/games";
    const onGame = !!gm;
    const onProjects = location.hash === "#/projects" || /^#\/project\//.test(location.hash);
    const onShowcase = /^#\/showcase(\/|$)/.test(location.hash);
    const onProjectSurface = onProjects || onShowcase;
    const onTopics = isTopicsRoute();
    const onHome = !location.hash || location.hash === "#" || location.hash === "#/";
    const onAppSurface = onTask || onDaily || onAtlas || onReview || onDiagnostic || onProfile || onUpdates || onShop || onGameHub || onGame || onProjectSurface || onTheory || onWorkshop;
    document.body.classList.toggle("home-mode", onHome && !$("appView").hidden);
    document.body.classList.toggle("list-mode", onTopics && !$("appView").hidden);
    document.body.classList.toggle("task-mode", onAppSurface);
    // активный пункт верхнего меню
    document.querySelectorAll(".nav-link").forEach((a) => {
      const r = a.dataset.route;
      a.classList.toggle("active",
        (r === "home" && onHome) ||
        (r === "topics" && (onTopics || onTheory || onReview || onDiagnostic)) ||
        (r === "atlas" && onAtlas) ||
        (r === "projects" && onProjects) ||
        (r === "showcase" && onShowcase) ||
        (r === "shop" && onShop) ||
        (r === "workshop" && onWorkshop) ||
        (r === "games" && (onGameHub || onGame)) ||
        (r === "profile" && (onProfile || onUpdates)));
      if (a.classList.contains("active")) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (onProjectSurface) {
      restoreShopPreview();
      setFabMentor(null);
      if ($("sandboxFab")) $("sandboxFab").hidden = false;
      // UI проектных курсов / доски — project-courses.js
      window.ProjectCourses?.renderRoute();
      return;
    }
    const showList = () => {
      $("taskView").hidden = true;
      $("taskView").innerHTML = "";
      $("listView").hidden = false;
    };
    if (onWorkshop) {
      restoreShopPreview();closeSandbox();setFabMentor(null);
      $('listView').hidden=true;$('taskView').hidden=false;$('sandboxFab').hidden=true;
      window.Workshop?.render($('taskView'));
    } else if (onTask) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderTaskRoute(TASK_BY_ID[m[1]]);
    } else if (onTheory) {
      restoreShopPreview();
      renderTheoryArticle(+theoryM[1]);
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    } else if (onDaily) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderDailyAi(dm[1]);
      setFabMentor(null);
      $("sandboxFab").hidden = true;
    } else if (onAtlas) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      setFabMentor(null);
      $("sandboxFab").hidden = true;
      if (am) renderDailyAi(null, am[1]);
      else renderAtlas();
    } else if (onReview) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderReviewQueue();
      setFabMentor(null);
      $("sandboxFab").hidden = true;
    } else if (onDiagnostic) {
      restoreShopPreview();
      closeSandbox();
      wireCatalogChrome(false);
      $("listView").hidden = true;
      $("taskView").hidden = false;
      setFabMentor(null);
      $("sandboxFab").hidden = true;
      window.EntryDiagnostic?.render($("taskView"), window.DIAGNOSTIC_TASKS, TOPICS, authEpoch);
    } else if (onUpdates) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderUpdates();
      setFabMentor(null);
      $("sandboxFab").hidden = true;
    } else if (onProfile) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderProfile();
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    } else if (onShop) {
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderShop();
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    } else if (onGameHub) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderGamesHub();
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    } else if (onGame) {
      restoreShopPreview();
      $("listView").hidden = true;
      $("taskView").hidden = false;
      renderGamePlay(gm[1]);
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    } else if (onTopics) {
      restoreShopPreview();
      showList();
      renderTopicsCatalog();
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    } else {
      restoreShopPreview();
      showList();
      renderHome();
      setFabMentor(null);
      $("sandboxFab").hidden = false;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener('workshop-wallet-changed',()=>loadWallet());

  /* ── Список тем ─────────────────────────────────────────────────────── */
  function taskMatchesSearch(task) {
    const q = query.trim().toLowerCase();
    return !!q && (task.id === q || [task.title, task.prompt, task.code].some(text => (text || "").toLowerCase().includes(q)));
  }

  function visibleTopics() {
    const q = query.trim().toLowerCase();
    return curriculum.topicsIn(TOPICS, catalogBranch()).filter((topic) => {
      if (level !== "all" && topic.level !== level) return false;
      if (!q) return true;
      if (topic.title.toLowerCase().includes(q)) return true;
      return topic.tasks.some(taskMatchesSearch);
    });
  }

  function firstUnsolvedIn(tasks) {
    return tasks.find((t) => !solved.has(t.id)) || null;
  }

  function topicPracticeKey(topic) {
    return `pycloud:u:${lookUser}:topic:${topic.id}:practice`;
  }

  function learningHref(task) {
    const topic = TOPIC_OF[task.id];
    return topic.tasks[0].id === task.id
      && !topic.tasks.some((t) => solved.has(t.id))
      && localStorage.getItem(topicPracticeKey(topic)) !== "1"
      ? `#/topic/${topic.id}/theory`
      : `#/task/${task.id}`;
  }

  /* Детерминированное «задание дня»: закрепление начатых тем */
  function hashStr(s) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
  }
  /* ── Задания дня от ИИ: кэш ответа сервера на сессию ────────────────── */
  let dailyAiCache = null;
  const dailyAiChecks = new Set();
  const DAILY_RU = { intermediate: "средний", advanced: "продвинутый", expert: "экспертный" };
  const DAILY_DIFFS = ["intermediate", "advanced", "expert"];

  async function loadDailyAi(force) {
    if (dailyAiCache?.day === new Date().toISOString().slice(0, 10)
        && Date.now() >= dailyAiCache.loadedAt && Date.now() - dailyAiCache.loadedAt < 60000 && !force) return dailyAiCache;
    const epoch = authEpoch;
    const hash = location.hash;
    let data = await api("/api/daily-ai");
    let checked = false;
    for (const [difficulty, candidate] of Object.entries(data.candidates || {})) {
      if (epoch !== authEpoch || hash !== location.hash) return data;
      if (dailyAiChecks.has(candidate.task_key)) continue;
      dailyAiChecks.add(candidate.task_key);
      try {
        try {
          await post('/api/daily-ai/validate', { day: data.day, difficulty, task_key: candidate.task_key, ok: true });
          checked = true;
        } catch (error) {
          if (![409, 429, 503].includes(error.status)) throw error;
          checked = error.status === 409;
        }
      } finally { dailyAiChecks.delete(candidate.task_key); }
    }
    if (checked && epoch === authEpoch && hash === location.hash) data = await api('/api/daily-ai');
    if (epoch === authEpoch) dailyAiCache = { ...data, loadedAt: Date.now() };
    return data;
  }

  function dailyAiTileHtml(diff, d) {
    const t = d && d.tasks && d.tasks[diff];
    if (!t) {
      return `
        <span class="daily-ai-tile pending">
          <span class="daily-ai-diff lv-${diff}">${DAILY_RU[diff]}</span>
          <span class="daily-ai-title review-wait">${d && !d.pending ? 'новое пока не готово' : 'готовим новое…'}</span>
        </span>`;
    }
    const done = (d.solved || []).includes(diff);
    const drops = (d.drops && d.drops[diff]) || 0;
    return `
      <a class="daily-ai-tile ${done ? "done" : ""}" href="#/daily/${diff}">
        <span class="daily-ai-diff lv-${diff}">${DAILY_RU[diff]}</span>
        <span class="daily-ai-title">${esc(t.title)}</span>
        <span class="daily-ai-status">${done ? "✓" : "+" + drops}</span>
      </a>`;
  }

  async function wireDailyAiCard(attempt) {
    const list = $("dailyAiList");
    if (!list) return;
    const epoch = authEpoch;
    const active = () => epoch === authEpoch && list.isConnected;
    const n = attempt || 0;
    try {
      const d = await loadDailyAi(n > 0);
      if (!active()) return;
      if (!d || !d.tasks) throw new Error("empty");
      list.innerHTML = DAILY_DIFFS.map((diff) => dailyAiTileHtml(diff, d)).join("");
      if ($("dailyAiDate")) $("dailyAiDate").textContent = `${d.day} · смена в 00:00 UTC`;
      if (d.pending && n < 8 && document.getElementById("dailyAiList")) {
        setTimeout(() => { if (active()) wireDailyAiCard(n + 1); }, 8000);
      } else {
        setTimeout(() => { if (active()) wireDailyAiCard(); }, 60000);
      }
    } catch (e) {
      if (!active()) return;
      if (n < 3 && document.getElementById("dailyAiList")) {
        list.innerHTML = DAILY_DIFFS.map((diff) => dailyAiTileHtml(diff, null)).join("");
        setTimeout(() => { if (active()) wireDailyAiCard(n + 1); }, 1200 * (n + 1));
        return;
      }
      list.innerHTML = DAILY_DIFFS.map((diff) => `
        <span class="daily-ai-tile pending">
          <span class="daily-ai-diff lv-${diff}">${DAILY_RU[diff]}</span>
          <span class="daily-ai-title review-wait">позже</span>
        </span>`).join("");
    }
  }

  function stopWeeklyFocus(){weeklyFocusTurn++;clearTimeout(weeklyFocusTimer);weeklyFocusTimer=null;}
  async function wireWeeklyFocus() {
    const link=$('weeklyFocusLink'),epoch=authEpoch;
    const onHome=()=>['','#','#/'].includes(location.hash)&&!$('appView').hidden;
    if(!weeklyEnabled||!link||!onHome())return;
    stopWeeklyFocus();const turn=weeklyFocusTurn;
    const active=()=>epoch===authEpoch&&link.isConnected&&onHome()&&turn===weeklyFocusTurn;
    try{
      const data=await api('/api/weekly');
      if(!active()||!data.ready)return;
      link.href='#/atlas/'+data.task.id;
      link.querySelector('small').textContent=data.task.title+(data.task.available_reward?' · +30 капель':' · повтор без награды');
      link.hidden=false;
      const deadline=Date.parse(data.week_end+'T00:00:00Z')+86400000;
      function schedule(){
        if(!active())return;
        const remaining=deadline-Date.now();
        weeklyFocusTimer=setTimeout(()=>{if(active()){if(Date.now()>=deadline)wireWeeklyFocus();else schedule();}},remaining<=0?60000:Math.min(60000,remaining+100));
      }
      schedule();
    }catch(_){/* Keep ordinary home navigation usable; Atlas can be opened independently. */}
  }
  window.addEventListener('focus',()=>wireWeeklyFocus());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wireWeeklyFocus();});

  function dailyTask() {
    const date = new Date().toISOString().slice(0, 10);
    const touched = new Set([...solved].map((id) => TOPIC_OF[id]?.id).filter(Boolean));
    let pool = ALL_TASKS.filter((t) => !solved.has(t.id) && touched.has(TOPIC_OF[t.id].id));
    let reason = "Закрепление начатой темы";
    if (!pool.length) {
      pool = ALL_TASKS.filter((t) => !solved.has(t.id));
      reason = "Новый материал по курсу";
    }
    if (!pool.length) return null;
    const user = $("userName").textContent || "";
    const task = pool[hashStr(user + date) % pool.length];
    return { task, reason };
  }

  function dashboardHtml() {
    const user = $("userName").textContent || "";
    const next = firstUnsolvedIn(ALL_TASKS);
    const daily = dailyTask();
    const done = courseSolvedCount();
    const title = activeTitle();
    const hello = done === 0
      ? "Добро пожаловать! Начнём с самых основ."
      : "С возвращением! Продолжим?";

    const progressPercent = ALL_TASKS.length ? Math.floor(done * 100 / ALL_TASKS.length) : 0;
    const progressVisual = `
      <span class="home-progress" aria-label="Решено ${done} из ${ALL_TASKS.length} заданий">
        <svg class="home-progress-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="home-progress-track" cx="60" cy="60" r="50"></circle>
          <circle class="home-progress-fill" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="${progressPercent} 100"></circle>
        </svg>
        <span class="home-progress-value">${done}<span> / ${ALL_TASKS.length}</span></span>
        <span class="home-progress-label">заданий решено</span>
      </span>`;

    const nextIsTheory = next && learningHref(next).endsWith("/theory");
    const nextCard = next ? `
      <a class="dash-card bento-continue home-continue" id="homeContinue" href="${learningHref(next)}">
        <span class="home-continue-copy">
        <span class="dash-label">Продолжить обучение</span>
        <span class="dash-title big">${inline(TOPIC_OF[next.id].title)}</span>
        <span class="dash-meta">${nextIsTheory ? "Сначала теория и примеры" : `задание ${next.id} · ${esc(taskTypeLabel(next))}`}</span>
        <span class="dash-cta">${nextIsTheory ? "Читать тему" : "Продолжить"} →</span>
        </span>
        ${progressVisual}
      </a>` : `
      <div class="dash-card bento-continue home-continue" id="homeCompleted">
        <span class="home-continue-copy">
        <span class="dash-label">Курс пройден</span>
        <span class="dash-title big">Все ${ALL_TASKS.length} заданий решены!</span>
        </span>
        ${progressVisual}
      </div>`;

    // задания дня от ИИ: три мини-блока, детали подтянутся асинхронно
    const dailyCard = `
      <div class="dash-card dash-daily bento-daily" id="dailyAiCard">
        <span class="dash-label">Задания дня</span>
        <span class="stat-note" id="dailyAiDate"></span>
        <div class="daily-ai-list" id="dailyAiList">
          ${DAILY_DIFFS.map((diff) => `
            <span class="daily-ai-tile pending">
              <span class="daily-ai-diff lv-${diff}">${DAILY_RU[diff]}</span>
              <span class="daily-ai-title review-wait">…</span>
            </span>`).join("")}
        </div>
        <a class="dash-cta" href="#/atlas">Атлас челленджей →</a>
      </div>`;

    // ежедневный сундук: только знак, подпись в title при наведении
    const chestCard = `
      <button type="button" class="dash-card bento-chest" id="chestCard"
              title="Ежедневный сундук" aria-label="Ежедневный сундук">
        <span class="chest-art" id="chestArt" aria-hidden="true">${CloudChest.icon()}<span class="chest-badge" id="chestBadge" hidden></span></span>
        <span class="chest-caption" id="chestCaption">Облачный сундук</span>
      </button>`;

    const gamesCard = `
      <div class="dash-card bento-games">
        <span class="dash-label">Мини-игры · капли за очки</span>
        <div class="bento-games-row">
          <a class="game-tile" href="#/game/blitz"><span class="game-tile-icon">?!</span><span>Молния</span><span class="game-tile-sub">правда/ложь${blitzBest ? " · " + blitzBest : ""}</span></a>
          <a class="game-tile" href="#/game/order"><span class="game-tile-icon">1-2</span><span>Порядок</span><span class="game-tile-sub">собери код${orderBest ? " · " + orderBest : ""}</span></a>
          <a class="game-tile" href="#/game/match"><span class="game-tile-icon">&lt;-&gt;</span><span>Пары</span><span class="game-tile-sub">код и результат${matchBest ? " · " + matchBest : ""}</span></a>
          <a class="game-tile" href="#/game/trace"><span class="game-tile-icon">x=</span><span>След</span><span class="game-tile-sub">значение после шагов${traceBest ? " · " + traceBest : ""}</span></a>
          <a class="game-tile" href="#/game/fill"><span class="game-tile-icon">_?</span><span>Пробел</span><span class="game-tile-sub">оператор или функция${fillBest ? " · " + fillBest : ""}</span></a>
          <a class="game-tile game-tile-free" href="#/game/riddle"><span class="game-tile-icon">AI?</span><span>Загадки</span><span class="game-tile-sub">ИИ · без капель</span></a>
        </div>
      </div>`;

    const topicsCard = `
      <a class="dash-card bento-topics" href="#/topics">
        <span class="dash-label">Каталог тем</span>
        <span class="dash-title">${TOPICS.length} тем · ${ALL_TASKS.length} заданий</span>
        <span class="dash-meta">уровни, теория, список задач и поиск по курсу</span>
        <span class="dash-cta">Открыть темы →</span>
      </a>`;

    const moreCard = `
      <section class="dash-card bento-more" aria-labelledby="moreTitle">
        <span class="dash-label" id="moreTitle">Ещё на платформе</span>
        <nav class="dashboard-more-links" aria-label="Дополнительные разделы">
          <a id="weeklyFocusLink" hidden><span class="dashboard-more-mark" aria-hidden="true">7</span><span><strong>Практикум недели</strong><small></small></span><span aria-hidden="true">→</span></a>
          <a href="#/diagnostic">
            <span class="dashboard-more-mark" aria-hidden="true">?</span>
            <span><strong>С чего начать?</strong><small>5 заданий без зачёта</small></span>
            <span aria-hidden="true">→</span>
          </a>
          <a href="#/projects">
            <span class="dashboard-more-mark" aria-hidden="true">{ }</span>
            <span><strong>Квесты</strong><small>5 проектов по темам</small></span>
            <span aria-hidden="true">→</span>
          </a>
          <a href="#/showcase">
            <span class="dashboard-more-mark" aria-hidden="true">&lt;/&gt;</span>
            <span><strong>Доска работ</strong><small>программы учеников</small></span>
            <span aria-hidden="true">→</span>
          </a>
          <a href="#/shop">
            <span class="dashboard-more-mark" aria-hidden="true">[*]</span>
            <span><strong>Магазин</strong><small><b data-wallet-drops>${walletDropsLabel()}</b> капель на балансе</small></span>
            <span aria-hidden="true">→</span>
          </a>
        </nav>
      </section>`;

    const lvlBars = LEVEL_ORDER.map((lv) => {
      const tasks = ALL_TASKS.filter((t) => TOPIC_OF[t.id].level === lv);
      const d = tasks.filter((t) => solved.has(t.id)).length;
      const pct = tasks.length ? Math.round((d / tasks.length) * 100) : 0;
      return `<div class="bento-lvl"><span>${LEVEL_TITLE[lv].split(" ")[0]}</span>
        <span class="stat-track"><span style="width:${pct}%${d ? "" : ";min-width:0"}"></span></span>
        <span class="stat-num">${d}/${tasks.length}</span></div>`;
    }).join("");
    // цель недели: решений за последние 7 дней
    const WEEK_GOAL = 10;
    const weekAgo = Date.now() - 7 * 86400000;
    const weekCount = statsDates.filter((d) => new Date(d).getTime() >= weekAgo).length;
    const weekPct = Math.min(100, Math.round((weekCount / WEEK_GOAL) * 100));
    const streakLine = serverStreak > 0
      ? `<div class="bento-lvl streak-line"><span>Серия</span><span class="streak-flame">${serverStreak} ${serverStreak === 1 ? "день" : serverStreak < 5 ? "дня" : "дней"}</span></div>`
      : "";
    const progressCard = `
      <a class="dash-card bento-progress" href="#/profile">
        <span class="dash-label">Ваш путь</span>
        ${lvlBars}
        <div class="bento-lvl"><span>Неделя</span>
          <span class="stat-track goal"><span style="width:${weekPct}%"></span></span>
          <span class="stat-num">${weekCount}/${WEEK_GOAL}</span></div>
        ${streakLine}
        <span class="dash-cta">Профиль и достижения →</span>
      </a>`;

    // серия под угрозой: вчера решал, сегодня ещё нет
    const today = new Date().toISOString().slice(0, 10);
    const solvedToday = statsDates.some((d) => d.slice(0, 10) === today);
    const streakGuard = (serverStreak > 0 && !solvedToday && daily) ? `
      <a class="streak-guard" href="#/task/${daily.task.id}">
        <b>Серия ${serverStreak} ${serverStreak === 1 ? "день" : serverStreak < 5 ? "дня" : "дней"} под угрозой!</b>
        Решите одно задание сегодня, чтобы её сохранить →
      </a>` : "";

    // One optional practice slot: confirmed review first, otherwise an honest catalogue link.
    const reviewCallout = `
      <a class="review-queue-callout" id="reviewQueueCallout" href="#/review" hidden>
        <span class="review-callout-mark" aria-hidden="true">↺</span>
        <span class="review-callout-copy">
          <span class="review-callout-label">Повторение</span>
          <strong id="reviewQueueSummary">Есть задания для повторения</strong>
          <span id="reviewQueueHint">Разберите задания, которые пока не прошли проверку.</span>
        </span>
        <span class="review-callout-action">Начать →</span>
      </a>
      <a class="home-practice-fallback" id="homePracticeFallback" href="#/topics">
        <span class="review-callout-copy">
          <span class="review-callout-label">Практика по желанию</span>
          <strong>Выберите знакомую тему</strong>
          <span>В каталоге можно вернуться к любому этапу и потренироваться в своём темпе.</span>
        </span>
        <span class="home-practice-action">К темам →</span>
      </a>`;

    // знакомство с Python для самых новых — компактная полоска над сеткой
    const pyIntro = done < 3 ? `
      <div class="dash-card bento-pyintro">
        <span class="dash-label">Знакомство с Python</span>
        <p class="pyintro-text">Python читается почти как английский — с него чаще всего начинают. Курс ведёт от первой переменной к классам маленькими шагами.</p>
      </div>` : "";

    const factCard = `
      <div class="dash-card bento-fact" id="factCard">
        <span class="dash-label">Факты дня</span>
        <div class="fact-rotate" id="factRotate" aria-live="polite">
          <p class="fact-text" id="factText">Загружаю…</p>
          <div class="fact-dots" id="factDots" hidden></div>
        </div>
      </div>`;

    const onboarding = (done === 0 && !hasSeenOnboarding()) ? `
      <div class="onboard" id="onboard">
        <p class="onboard-title">Как здесь всё устроено</p>
        <ul class="onboard-list">
          <li><b>Темы идут от простого к сложному</b> — откройте раздел «Темы» или жмите «Продолжить обучение».</li>
          <li>В каждом задании: <b>подсказки</b>, <b>ИИ-наставник</b> и запуск Python на сервере — прямо со страницы.</li>
          <li>Капли — внутренняя валюта: задания, сундук и мини-игры. Тратятся в <b>магазине</b>.</li>
        </ul>
        <button class="btn" id="onboardOk">Понятно, начинаем</button>
      </div>` : "";

    return `
    <div class="dashboard">
      <p class="dash-hello">Привет, <b>${esc(user)}</b>${title ? ` <span class="user-title">· ${esc(title)}</span>` : ""}. ${esc(hello)}</p>
      ${nextCard}
      <section class="home-practice" aria-label="Практика по желанию">${reviewCallout}</section>
      ${onboarding}
      ${streakGuard}
      <div class="bento">
        <div class="home-stack home-main-stack">
          ${dailyCard}
          ${gamesCard}
          ${moreCard}
        </div>
        <div class="home-stack home-side-stack">
          ${topicsCard}
          ${progressCard}
          ${chestCard}
          ${factCard}
          ${pyIntro}
        </div>
      </div>
    </div>`;
  }

  async function wireChest() {
    const card = $("chestCard");
    if (!card) return;
    const epoch = authEpoch;
    const active = () => epoch === authEpoch && card.isConnected;
    const paint = (state) => {
      if (epoch !== authEpoch || !$('chestCard')) return;
      const target = $('chestCard');
      const available = state.available_launches ?? ((state.bonus_launches || 0) + Number(state.ready));
      const text = `Облачный сундук · бесплатных запусков ×5: ${available}`;
      target.title = text;
      target.setAttribute("aria-label", text);
      target.classList.toggle('ready', state.ready);
      target.classList.toggle('opened', !state.ready);
      target.classList.remove('opening');
      target.disabled = false;
      $('chestCaption').textContent = state.ready ? 'Сегодня бесплатно ×5' : 'Открыть сундук';
      $('chestBadge').textContent = available;
      $('chestBadge').hidden = false;
    };
    card.onclick = async () => {
      if (!active() || card.disabled) return;
      card.disabled = true;
      const hash = location.hash;
      const stillHome = () => epoch === authEpoch && location.hash === hash && document.body.classList.contains('home-mode');
      try {
        const state = await api('/api/chest'); // Recheck UTC day, including another tab's claim.
        if (!stillHome()) return;
        if (!state.packs) throw new Error('Для нового сундука нужно перезапустить local-сервер.');
        paint(state);
        if (!state.ready || !walletKnownDrops) await loadWallet();
        if (!stillHome()) return;
        if (!walletKnownDrops) throw new Error('Баланс пока недоступен. Попробуйте ещё раз.');
        const accept = r => {
          if (epoch !== authEpoch) throw new Error('Сессия изменилась.');
          setWallet({ drops: r.drops });
          paint({ ...state, ready: false, bonus_launches: r.bonus_launches,
            available_launches: r.bonus_launches });
          if (r.achievement) loadAchievements();
          handleSetsUnlocked(r.sets_unlocked);
          return r;
        };
        CloudChest.open({ ...state, drops: wallet.drops }, async () => {
          if (epoch !== authEpoch) throw new Error('Сессия изменилась.');
          let r;
          try { r = await post('/api/chest/claim', {}); }
          catch (e) {
            if (e.status !== 409 || epoch !== authEpoch) throw e;
            const saved = await api('/api/chest');
            const balance = await api('/api/wallet');
            r = { result: saved.result, amount: saved.result.amount, drops: balance.drops,
              bonus_launches: saved.bonus_launches, replay: true };
          }
          return accept(r);
        }, async request => {
          if (epoch !== authEpoch) throw new Error('Сессия изменилась.');
          return accept(await post('/api/chest/launch', request));
        });
      } catch (e) { if (active()) { card.disabled = false; toast(esc(e.message)); } }
    };
    try {
      const state = await api('/api/chest');
      if (active() && !card.disabled) paint(state);
    } catch (e) { if (active() && !card.disabled) $('chestCaption').textContent = 'Повторить'; }
  }

  let selectedFact = 0;
  async function wireFact() {
    const el = $("factText");
    const dots = $("factDots");
    if (!el) return;
    const facts = await loadDayFacts();
    if (!el.isConnected || !dots?.isConnected) return;
    let idx = Math.min(selectedFact, facts.length - 1);
    dots.hidden = false;
    dots.innerHTML = facts.map((_, i) =>
      `<button type="button" class="fact-dot" data-i="${i}" aria-label="Факт ${i + 1}" aria-pressed="false"></button>`
    ).join("");
    const paint = () => {
      el.classList.remove("fact-swap");
      void el.offsetWidth;
      el.textContent = facts[idx];
      el.classList.add("fact-swap");
      dots.querySelectorAll(".fact-dot").forEach((button, i) => {
        button.classList.toggle("active", i === idx);
        button.setAttribute("aria-pressed", String(i === idx));
      });
    };
    paint();
    dots?.addEventListener("click", (e) => {
      const btn = e.target.closest(".fact-dot");
      if (!btn) return;
      idx = +btn.dataset.i;
      selectedFact = idx;
      paint();
    });
  }

  function shortPrompt(task, limit = 90) {
    const raw = String(task.prompt || "").replace(/\s+/g, " ").trim();
    if (raw.length <= limit) return raw;
    return raw.slice(0, limit - 1).trimEnd() + "…";
  }

  /** Короткое учебное имя этапа (каталог, навигация, заголовок). */
  function stageTitle(task, limit = 56) {
    const named = String(task.title || "").replace(/\s+/g, " ").trim();
    const raw = named || shortPrompt(task, limit);
    if (raw.length <= limit) return raw;
    return raw.slice(0, limit - 1).trimEnd() + "…";
  }

  function pluralTasks(count) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return "заданий";
    if (mod10 === 1) return "задание";
    if (mod10 >= 2 && mod10 <= 4) return "задания";
    return "заданий";
  }

  function pluralAttempts(count) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return "попыток";
    if (mod10 === 1) return "попытка";
    if (mod10 >= 2 && mod10 <= 4) return "попытки";
    return "попыток";
  }

  function reviewTopics(tasks) {
    const counts = new Map();
    tasks.forEach((item) => {
      const topic = TOPIC_OF[item.task_id];
      if (!topic) return;
      const current = counts.get(topic.id) || { topic, count: 0, attempts: 0 };
      current.count += 1;
      current.attempts += item.failed_attempts || 0;
      counts.set(topic.id, current);
    });
    return [...counts.values()].sort((a, b) =>
      b.count - a.count || b.attempts - a.attempts || a.topic.id - b.topic.id);
  }

  async function wireReviewQueueCallout() {
    const callout = $("reviewQueueCallout");
    if (!callout) return;
    const fallback = $("homePracticeFallback");
    const epoch = authEpoch;
    const active = () => callout.isConnected && epoch === authEpoch;
    try {
      const data = await api("/api/review-queue");
      if (!active()) return;
      if (data.total) {
        const weak = reviewTopics(data.tasks)[0];
        callout.querySelector("#reviewQueueSummary").textContent = `${data.total} ${pluralTasks(data.total)} ждёт повторения`;
        callout.querySelector("#reviewQueueHint").textContent = weak
          ? `В теме «${weak.topic.title}» больше всего заданий с ошибками. Разберите их по одному.`
          : "Эти задания пока не прошли проверку. Разберите их по одному.";
      } else {
        const practice = await api("/api/review-practice");
        if (!active() || !practice.total) return;
        callout.querySelector("#reviewQueueSummary").textContent = `Можно освежить ${practice.total} ${pluralTasks(practice.total)}`;
        callout.querySelector("#reviewQueueHint").textContent = "После исправления прошло 3 суток. Повтор — по желанию, без дедлайна.";
      }
      callout.hidden = false;
      if (fallback) fallback.hidden = true;
    } catch (e) {
      // Главная остаётся полностью рабочей, если фоновый запрос недоступен.
    }
  }

  function reviewIssueLabel(issue) {
    return {
      error: "ошибка выполнения",
      output: "вывод не совпал",
      answer: "ответ не совпал",
    }[issue] || "нужен повтор";
  }

  function reviewQueueEmptyHtml() {
    const next = firstUnsolvedIn(ALL_TASKS);
    return `
      <div class="task-page review-page" id="reviewQueueRoot">
        <a class="home-link" href="#/"><span>←</span> На главную</a>
        <section class="review-empty pane" aria-labelledby="reviewTitle">
          <span class="review-empty-mark" aria-hidden="true">✓</span>
          <div>
            <span class="project-kicker">Повторение</span>
            <h2 class="review-page-title" id="reviewTitle">Сейчас нет неразобранных ошибок</h2>
            <p>Здесь появятся задания, которые не прошли автоматическую проверку. Верный повтор сразу уберёт их из очереди.</p>
            <a class="btn dark" href="${next ? learningHref(next) : "#/topics"}">${next ? "Продолжить курс" : "К темам"}</a>
          </div>
        </section>
      </div>`;
  }

  function reviewQueueHtml(data) {
    const entries = data.tasks.map((item) => ({
      ...item,
      task: TASK_BY_ID[item.task_id],
      topic: TOPIC_OF[item.task_id],
    })).filter((item) => item.task && item.topic);
    if (!entries.length) return reviewQueueEmptyHtml();

    const weakTopics = reviewTopics(entries);
    const first = entries[0];
    const topicRows = weakTopics.map(({ topic, count, attempts }) => `
      <li>
        <a href="#/topic/${topic.id}/theory">
          <span>${inline(topic.title)}</span>
          <small>${count} ${pluralTasks(count)} · ${attempts} ${pluralAttempts(attempts)}</small>
        </a>
      </li>`).join("");
    const taskRows = entries.map((item, index) => `
      <li>
        <a class="review-task-row" href="#/task/${item.task_id}">
          <span class="review-task-number" aria-hidden="true">${index + 1}</span>
          <span class="review-task-copy">
            <span class="review-task-topic">${inline(item.topic.title)} · ${esc(item.task_id)}</span>
            <strong>${inline(stageTitle(item.task))}</strong>
            <small>${esc(reviewIssueLabel(item.issue))} · ${item.failed_attempts} ${pluralAttempts(item.failed_attempts)}</small>
          </span>
          <span class="review-task-action">Повторить →</span>
        </a>
      </li>`).join("");

    return `
      <div class="task-page review-page" id="reviewQueueRoot">
        <a class="home-link" href="#/"><span>←</span> На главную</a>
        <header class="review-hero pane">
          <div class="review-hero-copy">
            <span class="project-kicker">Персональный повтор</span>
            <h2 class="review-page-title" id="reviewTitle">Повторить ошибки</h2>
            <p>Собрали задания, где последняя автоматическая проверка была неудачной. Начните со слабых тем — верный ответ сам очистит очередь.</p>
          </div>
          <div class="review-hero-action">
            <span><b>${entries.length}</b> ${pluralTasks(entries.length)}</span>
            <a class="btn dark" href="#/task/${first.task_id}">Начать с ${esc(first.task_id)}</a>
          </div>
        </header>
        <div class="review-layout">
          <section class="review-section pane" aria-labelledby="reviewTasksTitle">
            <div class="review-section-head">
              <div>
                <span class="project-kicker">Очередь</span>
                <h3 id="reviewTasksTitle">Сначала самые трудные</h3>
              </div>
              <span class="review-rule">по числу ошибок</span>
            </div>
            <ol class="review-task-list">${taskRows}</ol>
          </section>
          <aside class="review-section review-topics pane" aria-labelledby="reviewTopicsTitle">
            <span class="project-kicker">Слабые темы</span>
            <h3 id="reviewTopicsTitle">Что освежить</h3>
            <p>Коротко перечитайте теорию перед новой попыткой.</p>
            <ul>${topicRows}</ul>
          </aside>
        </div>
      </div>`;
  }

  function wireReviewPractice(root) {
    const epoch = authEpoch;
    root.insertAdjacentHTML("beforeend", `
      <section class="review-section pane" id="reviewPractice" aria-labelledby="reviewPracticeTitle" hidden></section>`);
    const pane = root.querySelector("#reviewPractice");
    const active = () => pane.isConnected && epoch === authEpoch && location.hash === "#/review";
    let busy = false;
    async function load() {
      if (busy || !active()) return;
      busy = true;
      pane.setAttribute("aria-busy", "true");
      try {
        const data = await api("/api/review-practice");
        if (!active()) return;
        const entries = data.tasks.filter(item => TASK_BY_ID[item.task_id] && TOPIC_OF[item.task_id]);
        const restoreFocus = pane.contains(document.activeElement);
        if (!entries.length) {
          if (restoreFocus) {
            const heading = root.querySelector("#reviewTitle");
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
          }
          pane.remove();
          return;
        }
        pane.innerHTML = `
          <div class="review-section-head"><h3 id="reviewPracticeTitle">Освежить после перерыва</h3></div>
          <p class="stat-note">После исправления прошло не меньше 3 суток. Это добровольный повтор, не новая ошибка: дедлайна и повторной награды нет. Верная проверка уберёт задание из этого списка до следующей новой ошибки и её исправления.</p>
          <ul class="review-task-list">${entries.map(item => `
            <li><a class="review-task-row" href="#/task/${esc(item.task_id)}">
              <span class="review-task-number" aria-hidden="true">↺</span>
              <span class="review-task-copy">
                <span class="review-task-topic">${inline(TOPIC_OF[item.task_id].title)} · ${esc(item.task_id)}</span>
                <strong>${inline(stageTitle(TASK_BY_ID[item.task_id]))}</strong>
                <small>Исправлено <time datetime="${esc(item.fixed_at)}">${esc(new Date(item.fixed_at).toLocaleDateString("ru-RU"))}</time> · можно повторить</small>
              </span>
              <span class="review-task-action">Освежить →</span>
            </a></li>`).join("")}</ul>`;
        pane.hidden = false;
        if (restoreFocus) pane.querySelector("a").focus({ preventScroll: true });
      } catch (e) {
        if (!active()) return;
        if (e.status === 404) { pane.remove(); return; } // Старый сервер до перезапуска.
        const restoreFocus = pane.contains(document.activeElement);
        pane.innerHTML = `<h3 id="reviewPracticeTitle">Повтор после перерыва</h3><p role="alert">Не удалось загрузить задания для добровольного повтора. ${esc(e.message)}</p><button class="btn">Попробовать снова</button>`;
        pane.hidden = false;
        pane.querySelector("button").addEventListener("click", load);
        if (restoreFocus) pane.querySelector("button").focus({ preventScroll: true });
      } finally {
        busy = false;
        if (active()) pane.removeAttribute("aria-busy");
      }
    }
    load();
  }

  function wireReviewHistory(root) {
    const epoch = authEpoch;
    root.insertAdjacentHTML("beforeend", `
      <details class="review-section pane review-history" id="reviewHistory">
        <summary>Уже исправлено</summary>
        <div class="review-history-body"></div>
      </details>`);
    const pane = root.querySelector("#reviewHistory");
    const body = pane.querySelector(".review-history-body");
    const summary = pane.querySelector("summary");
    let loaded = false, busy = false;
    const active = () => pane.isConnected && epoch === authEpoch && location.hash === "#/review";
    async function load() {
      if (loaded || busy || !active()) return;
      busy = true;
      body.setAttribute("aria-busy", "true");
      body.innerHTML = '<p role="status">Загружаю историю исправлений…</p>';
      try {
        const data = await api("/api/review-history");
        if (!active()) return;
        const entries = data.tasks.filter(item => TASK_BY_ID[item.task_id] && TOPIC_OF[item.task_id]);
        summary.textContent = `Уже исправлено · ${entries.length}`;
        body.innerHTML = entries.length ? `
          <p class="stat-note" role="status">${entries.length} ${pluralTasks(entries.length)}: после ошибки проверка пройдена. Можно потренироваться ещё раз, без повторной награды.</p>
          <ul class="review-task-list">${entries.map(item => `
            <li><a class="review-task-row" href="#/task/${esc(item.task_id)}">
              <span class="review-task-number" aria-hidden="true">✓</span>
              <span class="review-task-copy">
                <span class="review-task-topic">${inline(TOPIC_OF[item.task_id].title)} · ${esc(item.task_id)}</span>
                <strong>${inline(stageTitle(TASK_BY_ID[item.task_id]))}</strong>
                <small>Было: ${esc(reviewIssueLabel(item.issue))}. Проверка пройдена <time datetime="${esc(item.fixed_at)}">${esc(new Date(item.fixed_at).toLocaleDateString("ru-RU"))}</time></small>
              </span>
              <span class="review-task-action">Потренироваться →</span>
            </a></li>`).join("")}</ul>` : `
          <p role="status">Пока нет сохранённых исправлений. Они появятся, когда после неудачной проверки получится верное решение.</p>
          <p class="stat-note">В истории — последнее исправление каждого задания. Давние ошибки вне сохранённых попыток восстановить нельзя.</p>`;
        loaded = true;
      } catch (e) {
        if (!active()) return;
        body.innerHTML = `<p role="alert">Не удалось загрузить историю. ${esc(e.message)}</p><button class="btn">Попробовать снова</button>`;
        body.querySelector("button").addEventListener("click", () => { summary.focus(); load(); });
      } finally {
        busy = false;
        if (active()) body.removeAttribute("aria-busy");
      }
    }
    pane.addEventListener("toggle", () => { if (pane.open) load(); });
  }

  async function renderReviewQueue() {
    wireCatalogChrome(false);
    const host = $("taskView");
    host.innerHTML = `
      <div class="task-page review-page" id="reviewQueueRoot" aria-busy="true">
        <a class="home-link" href="#/"><span>←</span> На главную</a>
        <section class="review-loading pane" role="status">
          <span class="spinner" aria-hidden="true"></span>
          <div><h2 class="review-page-title">Повторить ошибки</h2><p>Собираем последние попытки…</p></div>
        </section>
      </div>`;
    const loadingRoot = host.firstElementChild, epoch = authEpoch;
    const active = () => loadingRoot.isConnected && epoch === authEpoch && location.hash === "#/review";
    try {
      const data = await api("/api/review-queue");
      if (!active()) return;
      host.innerHTML = data.total ? reviewQueueHtml(data) : reviewQueueEmptyHtml();
      wireReviewPractice(host.querySelector("#reviewQueueRoot"));
      wireReviewHistory(host.querySelector("#reviewQueueRoot"));
    } catch (e) {
      if (!active()) return;
      host.innerHTML = `
        <div class="task-page review-page" id="reviewQueueRoot">
          <a class="home-link" href="#/"><span>←</span> На главную</a>
          <section class="review-empty pane" role="alert">
            <span class="review-empty-mark" aria-hidden="true">!</span>
            <div><h2 class="review-page-title">Не удалось загрузить повторение</h2><p>${esc(e.message)}. Попробуйте открыть страницу ещё раз.</p></div>
          </section>
        </div>`;
    }
  }

  function topicHtml(topic, { detailed = false } = {}) {
    const solvedCount = topic.tasks.filter((t) => solved.has(t.id)).length;
    const total = topic.tasks.length;
    const pct = total ? Math.round((solvedCount / total) * 100) : 0;
    const cont = firstUnsolvedIn(topic.tasks);
    const goToTheory = cont && learningHref(cont).endsWith("/theory");
    const rows = topic.tasks.map((t) => `
      ${t.finale === 1 ? '<p class="topic-finale-heading">Финал темы · две самостоятельные задачи</p>' : ""}
      <a class="task-row${detailed ? " task-row-detailed" : ""}${taskMatchesSearch(t) ? " task-search-match" : ""}" href="#/task/${t.id}">
        <span class="t-id">${t.id}</span>
        ${detailed ? `<span class="t-prompt">${inline(stageTitle(t))}</span>` : ""}
        <span class="t-type">${esc(taskTypeLabel(t))}</span>
        <span class="t-xp">+${pointsFor(t)} XP</span>
        <span class="t-status ${solved.has(t.id) ? "ok" : ""}">${solved.has(t.id) ? "решено ✓" : "открыть →"}</span>
      </a>`).join("");
    // челлендж-босс темы
    const ch = window.CHALLENGES?.[topic.id];
    const chRow = ch ? `
      <a class="task-row challenge-row ${solved.has(ch.id) ? "done" : ""}" href="#/task/${ch.id}">
        <span class="t-id ch-mark">[!]</span>
        <span class="t-type"><b>Челлендж:</b> ${esc(ch.title)}</span>
        <span class="t-status ${solved.has(ch.id) ? "ok" : "ch"}">${solved.has(ch.id) ? "пройден ✓" : "+" + pointsFor(ch) + " XP · 30 капель"}</span>
      </a>` : "";

    // «где это живёт»: применение и история темы
    const insight = window.TOPIC_INSIGHT?.[topic.id];
    const insightBlock = insight ? `
      <div class="topic-insight">
        <p class="topic-insight-label">Где это живёт</p>
        <p class="topic-insight-text">${insight}</p>
      </div>` : "";
    return `
    <section class="topic lv-${topic.level} ${solvedCount === total ? "done" : ""}${detailed ? " topic-detailed" : ""}" data-topic="${topic.id}">
      <div class="topic-head">
        <a class="topic-main" href="#/topic/${topic.id}/theory">
          <span class="topic-sym" aria-hidden="true">${esc(TOPIC_SYMBOL[topic.id] || "·")}</span>
          <span class="topic-title">
            <span class="topic-title-row">${inline(topic.title)}
              <span class="level-badge lv-${topic.level}">${LEVEL_RU[topic.level]}</span></span>
            <span class="topic-desc">${theoryTeaser(topic.id) ? esc(theoryTeaser(topic.id)) : inline(topic.description)}</span>
          </span>
        </a>
        <div class="topic-meta">
          <span class="topic-count">${solvedCount}/${total}</span>
          ${cont
            ? `<a class="btn topic-go" href="${learningHref(cont)}">${goToTheory ? "Читать теорию" : "Продолжить"}</a>`
            : `<span class="topic-done-mark">✓ пройдена</span>`}
          <button type="button" class="topic-toggle" aria-expanded="false" aria-controls="topic-tasks-${topic.id}">Этапы <span class="chev" aria-hidden="true">&#9656;</span></button>
        </div>
      </div>
      <div class="topic-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="tasklist" id="topic-tasks-${topic.id}">
        ${rows}
        ${chRow}
        ${insightBlock}
      </div>
    </section>`;
  }

  function wireCatalogChrome(showControls) {
    if ($("diagnosticCallout")) $("diagnosticCallout").hidden = !showControls;
    const controls = $("topicsControls");
    if (controls) controls.hidden = !showControls;
    $("curriculumBranches").hidden = !showControls;
  }

  function renderHome() {
    window.TopicMap?.destroy();
    wireCatalogChrome(false);
    const host = $("topics");
    const focused = document.activeElement;
    const chestFocused = focused?.id === 'chestCard';
    const continueHref = focused?.id === 'homeContinue' ? focused.getAttribute('href') : null;
    host.innerHTML = dashboardHtml();
    wireChest();
    if (chestFocused) $('chestCard').focus({ preventScroll: true });
    // Optional wallet/stats delivery can redraw home while the learner is tabbing.
    const nextContinue = $('homeContinue');
    if (continueHref && nextContinue?.getAttribute('href') === continueHref) nextContinue.focus({ preventScroll: true });
    wireFact();
    wireDailyAiCard();
    wireWeeklyFocus();
    wireReviewQueueCallout();
    const onboardOk = $("onboardOk");
    if (onboardOk) onboardOk.addEventListener("click", () => {
      rememberOnboarding();
      document.querySelector(".bento-continue")?.focus({ preventScroll: true });
    });
    renderProgress();
    window.ProjectCourses?.renderHomePrompts();
  }

  function renderTopicsCatalog(arrive = false) {
    window.TopicMap?.destroy();
    wireCatalogChrome(true);
    $("levelMobile").value = level;
    document.querySelectorAll("#levelTabs .tab").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.level === level);
      tab.setAttribute("aria-pressed", String(tab.dataset.level === level));
    });
    const host = $("topics");
    const branch = catalogBranch();
    const branchTopics = curriculum.topicsIn(TOPICS, branch);
    document.querySelectorAll("[data-curriculum]").forEach(link => {
      if (link.dataset.curriculum === branch) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const list = visibleTopics();
    const mapTopicKey = branch === "python" ? "map-topic" : "map-topic-tools";
    const mapView = getLook("topics-view") === "map";
    document.querySelectorAll("[data-catalog-view]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.catalogView === (mapView ? "map" : "list")));
    });
    if (!list.length) {
      host.innerHTML = `<div class="empty"><h3>Темы не найдены</h3><p>${query.trim() ? "Поиск: «" + esc(query.trim()) + "». " : ""}Попробуйте другой запрос или уберите ограничение по уровню.</p><button type="button" class="btn" id="catalogReset">Сбросить поиск и уровень</button></div>`;
      $("catalogReset").addEventListener("click", () => {
        clearTimeout(searchTimer);
        query = ""; level = "all"; $("search").value = "";
        renderTopicsCatalog(); $("search").focus();
      });
      renderProgress();
      return;
    }
    if (mapView) {
      const storedTopic = getLook(mapTopicKey);
      const topic = list.find(t => String(t.id) === storedTopic)
        || list.find(t => firstUnsolvedIn(t.tasks)) || list[0];
      const nextTopic = curriculum.nextTopic(TOPICS, topic);
      host.innerHTML = '<div id="topicMapHost"></div>';
      setLook(mapTopicKey, String(topic.id));
      TopicMap.render($("topicMapHost"), {
        topics: list, topicId: topic.id, nextTopic, arrive, solved, title: stageTitle, typeLabel: taskTypeLabel, esc, pointsFor, learningHref,
        profileHtml: learningProfileHtml,
        searchMatches: query.trim() ? topic.tasks.filter(taskMatchesSearch).map(task => task.id) : null,
        motion: getLook("map-motion") !== "off",
        onMotion: enabled => setLook("map-motion", enabled ? "on" : "off"),
        goal: (task, topic, index) => window.stageRouteLine?.(topic.id, index, task.type) || getTaskIntro(task).goal,
        onTopic: (id, focusSelector) => {
          setLook(mapTopicKey, String(id));
          renderTopicsCatalog();
          const target = $("topicMapHost").querySelector(focusSelector);
          (target?.disabled ? $("cloudTopic") : target)?.focus({ preventScroll: true });
        },
        onNext: () => {
          if (!nextTopic) return;
          clearTimeout(searchTimer);
          if (!list.includes(nextTopic)) {
            level = "all"; query = "";
            $("search").value = "";
          }
          setLook(mapTopicKey, String(nextTopic.id));
          renderTopicsCatalog(true);
          $("cloudMapTitle").scrollIntoView({ block: "start", behavior: "instant" });
          $("topicMapHost").querySelector(".cloud-theory a").focus({ preventScroll: true });
        },
      });
      renderProgress();
      return;
    }
    const branchTasks = branchTopics.flatMap(topic => topic.tasks);
    const doneAll = branchTasks.filter(t => solved.has(t.id)).length;
    const hero = `
      <header class="topics-hero pane">
        <div>
          <span class="project-kicker">Учебный каталог</span>
          <h2>${esc(curriculum.branches[branch].title)}</h2>
          <p>${esc(curriculum.branches[branch].description)} Перед новой темой проверьте нужные основы. Уровень показывает сложность внутри направления.</p>
        </div>
        <div class="topics-hero-stats">
          <span><b>${doneAll}</b> / ${branchTasks.length} заданий</span>
          <span><b>${branchTopics.filter(t => t.tasks.every(x => solved.has(x.id))).length}</b> / ${branchTopics.length} тем</span>
          <a class="btn" href="#/">На главную</a>
        </div>
      </header>`;
    const sections = `<div class="level-section">${list.map((t) => topicHtml(t, { detailed: true })).join("")}</div>`;
    host.innerHTML = hero + (branch === "tools" ? toolsPracticeHtml() : "") + sections;
    list.forEach((topic) => {
      const el = host.querySelector(`[data-topic="${topic.id}"]`);
      if (el && (openTopics.has(topic.id) || topic.tasks.some(taskMatchesSearch))) {
        el.classList.add("open");
        el.querySelector(".topic-toggle")?.setAttribute("aria-expanded", "true");
      }
    });
    renderProgress();
  }

  function renderList() {
    if (isTopicsRoute()) renderTopicsCatalog();
    else renderHome();
  }

  function toolsPracticeHtml() {
    const guides = [
      ["practice_local_file/run_file", "Запуск файла в IDE"],
      ["practice_environment/same_python", "Интерпретатор, venv и pip"],
      ["practice_cli/parser", "Аргументы и ввод в терминале"],
      ["practice_traceback/repair", "Поиск причины ошибки"],
      ["practice_debugger/step_report", "Отладчик: шаги и переменные"],
      ["practice_docs/prefix", "Чтение документации"],
      ["practice_git/first_commit", "Первый коммит в Git"],
    ];
    return `<section class="pane curriculum-practice" aria-labelledby="toolsPracticeTitle">
      <div class="curriculum-practice-head">
        <h3 id="toolsPracticeTitle">Практика на своём компьютере</h3>
        <a href="#/projects">Все мини-квесты <span aria-hidden="true">↗</span></a>
      </div>
      <p>Ранние квесты — после первых функций, терминальный — после argparse. Здесь есть инструкции для IDE, проверка кода и отдельная самопроверка локальных действий.</p>
      <div class="curriculum-practice-grid">
        <div class="curriculum-practice-group">
          <h4>Инструменты для первых проектов</h4>
          <div class="curriculum-guide-links">${guides.map(([path, title]) => `<a class="btn" href="#/project/${path}">${esc(title)}</a>`).join("")}</div>
        </div>
        <div class="curriculum-practice-group">
          <h4>Собрать всё в одну работу</h4>
          <div class="curriculum-project-links">
            <a class="curriculum-project-link" href="#/project/practice_csv_report"><small>После pandas и openpyxl</small><strong>Из CSV в отчёт — Excel и график по одним данным</strong><span aria-hidden="true">↗</span></a>
            <a class="curriculum-project-link" href="#/project/practice_sqlite_file"><small>После sqlite3</small><strong>Моя база в отдельном файле — чтение между запусками</strong><span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </div>
    </section>`;
  }

  function prerequisitesHtml(topic) {
    const required = (topic.prerequisites || []).map(id => TOPICS.find(item => item.id === id)).filter(Boolean);
    if (!required.length) return "";
    return `<p class="curriculum-prerequisites">Перед темой: ${required.map(item => `<a href="#/topic/${item.id}/theory">${esc(item.title)}${item.tasks.every(task => solved.has(task.id)) ? " ✓" : ""}</a>`).join(" · ")}. Можно вернуться к основам в любой момент.</p>`;
  }

  $("topicsControls").addEventListener("click", event => {
    const button = event.target.closest("[data-catalog-view]");
    if (!button) return;
    setLook("topics-view", button.dataset.catalogView === "map" ? "map" : "list");
    renderTopicsCatalog();
  });

  $("curriculumBranches").addEventListener("click", event => {
    const link = event.target.closest("[data-curriculum]");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (link.dataset.curriculum !== catalogBranch()) {
      clearTimeout(searchTimer);
      level = "all"; query = "";
      $("search").value = "";
    }
  });

  $("topics").addEventListener("click", (e) => {
    const toggle = e.target.closest(".topic-toggle");
    if (!toggle) return;
    const sec = toggle.closest(".topic");
    const id = +sec.dataset.topic;
    sec.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(sec.classList.contains("open")));
    if (sec.classList.contains("open")) openTopics.add(id); else openTopics.delete(id);
  });

  $("levelTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    level = tab.dataset.level;
    renderList();
  });
  $("levelMobile").addEventListener("change", event => {
    level = event.target.value;
    renderList();
  });

  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value; renderList(); }, 120);
  });

  /* ── Проверка решений ───────────────────────────────────────────────── */
  const normText = (s) =>
    String(s ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");

  /* Shared grading core: platform/web-shared → static/generated/web-shared-tasks.js */
  const sharedTasks = globalThis.PyCloudTasks;
  if (!sharedTasks) {
    throw new Error("PyCloudTasks missing — load generated/web-shared-tasks.js before app.js");
  }
  const outputsEqual = (expected, got) => sharedTasks.outputsEqual(expected, got);
  const referenceProgram = (task) => sharedTasks.referenceProgram(task);
  const looseLineEq = (exp, got) => sharedTasks.looseLineEq(exp, got);
  const splitLines = (s) => sharedTasks.splitLines(s);

  /* Первое расхождение вывода: номер строки и позиция символа */
  function firstDiff(expected, got) {
    const e = splitLines(expected), g = splitLines(got);
    const n = Math.max(e.length, g.length);
    for (let i = 0; i < n; i++) {
      const a = e[i] ?? "", b = g[i] ?? "";
      if (!looseLineEq(a, b)) {
        let j = 0;
        const la = a.trimEnd(), lb = b.trimEnd();
        while (j < Math.min(la.length, lb.length) && la[j] === lb[j]) j++;
        return { line: i + 1, col: j + 1, exp: a, got: b, extraLines: e.length !== g.length };
      }
    }
    return null;
  }

  const markAt = (s, col) =>
    esc(s.slice(0, col - 1)) +
    `<span class="diff-mark">${esc(s.slice(col - 1, col) || "␣")}</span>` +
    esc(s.slice(col));

  /* Для задач с кодом: показываем обе строки с подсветкой расхождения */
  function diffHtml(expected, got) {
    const d = firstDiff(expected, got);
    if (!d) return "";
    const where = d.extraLines
      ? `Количество строк не совпадает (ожидалось ${splitLines(expected).length}, получено ${splitLines(got).length}).`
      : `Первое расхождение — строка ${d.line}, символ ${d.col}.`;
    return `
      <p class="diff-where">${where}</p>
      <div class="diff-rows">
        <div class="diff-row"><span class="diff-tag">ожидалось</span><pre>${markAt(d.exp, d.col)}</pre></div>
        <div class="diff-row"><span class="diff-tag">получено</span><pre>${d.got ? markAt(d.got, d.col) : "<i>(пусто)</i>"}</pre></div>
      </div>`;
  }

  /* Для «определить вывод»: указываем ГДЕ ошибка, не раскрывая эталон */
  function predictionDiffHtml(expected, got) {
    const d = firstDiff(expected, got);
    if (!d) return "";
    if (d.extraLines)
      return `<p class="diff-where">Подсказка: у правильного ответа другое количество строк (у вас ${splitLines(got).length}).</p>`;
    return `
      <p class="diff-where">Подсказка: расхождение начинается в строке ${d.line}, символ ${d.col}.</p>
      <div class="diff-rows">
        <div class="diff-row"><span class="diff-tag">ваш ответ</span><pre>${d.got ? markAt(d.got, d.col) : "<i>(пусто)</i>"}</pre></div>
      </div>`;
  }

  const refCache = {};

  function codeFailureHtml(result, code, check, taskId) {
    const failure = result.failure;
    if (!failure) return `<strong>Ошибка выполнения.</strong><pre>${esc(window.RuntimeHelp?.errorText?.(result) || result.error)}</pre>`;
    const codeLines = code.split(/\r\n|\r|\n/).length;
    const inCheck = failure.source === "check" || (!failure.source && check?.append && failure.line > codeLines + 1);
    const failedAssertion = inCheck && failure.type === "AssertionError";
    const title = failedAssertion ? "Решение не прошло проверку."
      : inCheck ? "Проверка не смогла выполнить решение." : "Код остановился с ошибкой.";
    const where = failedAssertion ? "" : inCheck
      ? "Ошибка при дополнительной проверке требований задания."
      : failure.line ? `Строка ${failure.line} вашего кода.` : "";
    const message = failedAssertion
      ? failure.message || "Одно из условий проверки не выполнено. Проверьте результат на других входных данных и требования задания."
      : `${failure.type}: ${failure.message}`;
    const source = window.LearningErrorHelp?.sourceHtml?.(failure, code, { inCheck }) || "";
    return `<strong>${title}</strong>${where && !source ? `<p>${esc(where)}</p>` : ""}
      <pre class="check-message">${esc(message)}</pre>
      ${source}
      ${result.guidance ? `<p>${esc(result.guidance)}</p>` : ""}
      ${window.LearningErrorHelp?.render(failure, { inCheck }) || ""}
      ${window.LearningErrorHelp?.renderCase?.(failure, { taskId }) || ""}
      ${result.got ? `<details class="check-details"><summary>Вывод до остановки</summary><pre>${esc(result.got)}</pre></details>` : ""}
      <details class="check-details"><summary>Подробности Python</summary><pre>${esc(result.error)}</pre></details>`;
  }

  /* Возвращает { kind: "auto"|"self", ok, got, expected, error } */
  function taskCheckScript(task, code) {
    const check = window.CHECKS[task.id] || {};
    const append = (check.submissionSource ? `_pycloud_submission_source = ${JSON.stringify(code)}\n` : "") + (check.append || "");
    if (!check.source) return append;
    if (!window.SOURCE_RULES_PYTHON) throw new Error("Обновите страницу: код проверки способа решения ещё не загружен.");
    return "import builtins as _pycloud_source_builtins\n_pycloud_source_ns = {}\n" +
      `_pycloud_source_builtins.exec(${JSON.stringify(window.SOURCE_RULES_PYTHON)}, _pycloud_source_ns)\n` +
      `_pycloud_source_result = _pycloud_source_ns['inspect_source'](${JSON.stringify(code)}, _pycloud_source_ns['_json'].loads(${JSON.stringify(JSON.stringify(check.source))}))\n` +
      "if _pycloud_source_result['status'] == 'unsupported':\n" +
      "    raise RuntimeError('PYCLOUD_SOURCE_UNSUPPORTED: ' + _pycloud_source_result['message'])\n" +
      "assert _pycloud_source_result['status'] == 'ok', _pycloud_source_result['message']\n" + append;
  }

  async function grade(task, payload, onStatus, onTest) {
    if (task.type === "определить вывод" || task.type === "квиз")
      return { kind: "auto", ok: outputsEqual(task.answer, payload.text) };
    if (task.type === "объяснить поведение") return { kind: "self" };
    if (task.type === "демо")
      return { kind: "auto", ok: true };


    const chk = window.CHECKS[task.id] || {};
    let expected = chk.expect;
    if (expected == null) {
      if (!(task.id in refCache)) {
        const ref = referenceProgram(task);
        if (!ref) { refCache[task.id] = null; }
        else {
          const r = await PyRunner.run(ref, onStatus);
          if (r.blocked) return { kind: "blocked", error: r.error || "Запуск отменён.", guidance: r.guidance };
          refCache[task.id] = (r.error || !normText(r.stdout)) ? null : r.stdout;
        }
      }
      expected = refCache[task.id];
      if (expected == null) return { kind: "self" };
    }
    const checkScript = taskCheckScript(task, payload.code);
    const u = await PyRunner.run(payload.code, onStatus, checkScript, onTest);
    const files = u.artifacts ? {artifacts:u.artifacts} : {};
    if (u.blocked) return { kind: "blocked", error: u.error || "Запуск отменён.", guidance: u.guidance };
    if (chk.source && u.failure?.source === "check" && u.error?.includes("PYCLOUD_SOURCE_UNSUPPORTED:"))
      return { kind: "blocked", error: u.error.split("PYCLOUD_SOURCE_UNSUPPORTED:")[1].trim() };
    if (u.error) return { kind: "auto", ok: false, error: u.error, failure: u.failure, guidance: u.guidance, got: u.stdout, ...files };
    if (chk.append && u.check_stdout == null)
      return { kind: "auto", ok: false, error: "Проверка не запустилась. Обновите страницу и отправьте решение ещё раз.", got: u.stdout };
    // Value/behavior checks exclude the learner's demo output from their result.
    const got = chk.append && normText(expected) === "OK" ? u.check_stdout : u.stdout;
    return { kind: "auto", ok: outputsEqual(expected, got), got, expected, ...files };
  }

  /* ── Страница задания ───────────────────────────────────────────────── */
  // A draft belongs to the account that opened the editor, never the next login.
  function bindLocalDraft(editor, scope, starter) {
    const epoch = authEpoch;
    const key = lookStorageKey("draft:" + scope);
    const warning = document.createElement("p");
    warning.className = "stat-note draft-warning";
    warning.setAttribute("role", "status");
    warning.hidden = true;
    (editor.closest(".terminal-glass") || editor).after(warning);
    const active = () => key && epoch === authEpoch && editor.isConnected;
    const storage = (action) => {
      try {
        const result = action();
        warning.hidden = true;
        return result;
      } catch (_) {
        warning.textContent = "Браузер не может сохранить черновик. Скопируйте код перед выходом со страницы.";
        warning.hidden = false;
        return null;
      }
    };
    const existing = key ? storage(() => localStorage.getItem(key)) : null;
    editor.value = existing ?? starter;
    const writeLocal = value => {
      let written = false;
      if (active()) storage(() => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        written = true;
      });
      return written;
    };
    const sync = window.EditorDrafts?.bind({editor, scope, starter, key, hasLocal:existing !== null, active, writeLocal});
    const save = () => {
      if (active()) {
        const mirrored = writeLocal(editor.value);
        sync?.changed(mirrored);
      }
    };
    editor.addEventListener("input", save);
    return {
      save,
      reset() {
        if (!active()) return;
        editor.value = starter;
        const mirrored = writeLocal(null);
        sync?.reset(mirrored);
      },
      destroy() {
        sync?.destroy();
        editor.removeEventListener("input", save);
        warning.remove();
      },
    };
  }

  function legacyDrafts() {
    const drafts = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (/^pycloud:(draft:|daily:|sandbox$)/.test(key)) {
        drafts.push({ key, code: localStorage.getItem(key) });
      }
    }
    return drafts;
  }

  function downloadJson(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function starterCodeFor(task) {
    if (task.challenge && task.code) return task.code;
    if (task.type === "написать функцию") {
      return task.code || (task.displayType ? "# Напишите решение здесь\n" : "# Напишите функцию здесь\n");
    }
    return task.code || "";
  }

  function hintsHtml(task, unlocked) {
    // подсказка 1 бесплатна; 2 и 3 открываются за капли (уровни с сервера)
    const personal = task.hint || window.TASK_HINTS?.[task.id];
    const items = [
      { level: 1, title: "Подсказка 1 · направление", body: inline(personal || HINT_BY_TYPE[taskTypeLabel(task)] || "Разберите условие на части."), price: 0 },
      { level: 2, title: "Подсказка 2 · объяснение", body: inline(task.explanation), price: 5 },
      { level: 3, title: "Подсказка 3 · полный ответ", body: `<pre>${esc(task.answer)}</pre>`, price: 15 },
    ];
    return items.map((h) => {
      const open = h.price === 0 || unlocked.includes(h.level);
      if (open) return `
        <div class="hint">
          <button type="button">${h.title}</button>
          <div class="hint-body">${h.body}</div>
        </div>`;
      return `
        <div class="hint locked">
          <button type="button" class="hint-unlock" data-level="${h.level}" data-price="${h.price}">
            ${h.title} <span class="hint-price"><span class="drop-dot small"></span>${h.price}</span>
          </button>
          <div class="hint-body">${h.body}</div>
        </div>`;
    }).join("");
  }

  function courseNavHtml(task) {
    const branchTasks = curriculum.tasksIn(TOPICS, curriculum.branchOf(TOPIC_OF[task.id]));
    const idx = branchTasks.findIndex((t) => t.id === task.id);
    if (idx < 0) {
      if (!task.challenge) return '<div class="empty">Задание не найдено</div>';
      // рельса челленджа: задачи его темы + сам босс в конце
      const topic = TOPIC_OF[task.id];
      const items = topic.tasks.map((t) => `
        <a class="course-rail-item past${solved.has(t.id) ? " done" : ""}" href="#/task/${t.id}">
          <span class="rail-dot" aria-hidden="true"></span>
          <span class="rail-body"><span class="rail-id">${t.id}</span><span class="rail-meta">${inline(stageTitle(t, 40))}</span></span>
          ${solved.has(t.id) ? '<span class="rail-check">✓</span>' : '<span class="rail-arrow">↑</span>'}
        </a>`).join("");
      return `<div class="course-rail-break">${esc(topic.title)}</div>` + items + `
        <div class="course-rail-item current" aria-current="step">
          <span class="rail-dot" aria-hidden="true"></span>
          <span class="rail-body"><span class="rail-id">${task.id}</span><span class="rail-meta">челлендж</span></span>
          <span class="rail-here" aria-hidden="true">●</span>
        </div>`;
    }

    const before = 3;
    const after = 3;
    const start = Math.max(0, idx - before);
    const end = Math.min(branchTasks.length, idx + after + 1);
    const slice = branchTasks.slice(start, end);

    return slice.map((t, i) => {
      const tIdx = branchTasks.findIndex((x) => x.id === t.id);
      const isCurrent = t.id === task.id;
      const rel = tIdx < idx ? "past" : tIdx > idx ? "ahead" : "current";
      const done = solved.has(t.id);
      const topic = TOPIC_OF[t.id];
      const prevTopic = i > 0 ? TOPIC_OF[slice[i - 1].id] : null;
      const topicBreak = !prevTopic || prevTopic.title !== topic.title
        ? `<div class="course-rail-break">${esc(topic.title)}</div>`
        : "";

      const body = `
        <span class="rail-dot" aria-hidden="true"></span>
        <span class="rail-body">
          <span class="rail-id">${t.id}</span>
          <span class="rail-meta">${inline(stageTitle(t, 40))}</span>
        </span>
        ${done ? '<span class="rail-check" aria-label="решено">✓</span>' : (rel === "ahead" ? '<span class="rail-arrow" aria-hidden="true">↓</span>' : rel === "past" ? '<span class="rail-arrow" aria-hidden="true">↑</span>' : '<span class="rail-here" aria-hidden="true">●</span>')}`;

      if (isCurrent) {
        return `${topicBreak}
          <div class="course-rail-item ${rel}${done ? " done" : ""}" aria-current="step">
            ${body}
          </div>`;
      }
      return `${topicBreak}
        <a class="course-rail-item ${rel}${done ? " done" : ""}" href="#/task/${t.id}">
          ${body}
        </a>`;
    }).join("");
  }

  /* ── Страница задания дня от ИИ ─────────────────────────────────────── */
  async function renderAtlas() {
    const epoch = authEpoch;
    $("taskView").innerHTML = `<div class="task-page atlas-page">
      <div class="task-nav"><div class="crumbs"><a href="#/">Главная</a> / Атлас</div></div>
      <header class="atlas-heading"><h2>Атлас челленджей</h2><p>Свободная практика, задания дня и ваша коллекция.</p></header>
      <p id="atlasDailyState" role="status" aria-live="polite" hidden></p>
      <details class="pane atlas-create"><summary>Заказать челлендж у наставника</summary>
        <form id="atlasCreateForm">
          <label for="atlasTopic">Что хотите потренировать?</label>
          <textarea id="atlasTopic" rows="2" minlength="3" maxlength="300" required placeholder="Например: словари и строки на примере небольшого бота"></textarea>
          <label for="atlasGenerateLevel">Сложность</label>
          <select id="atlasGenerateLevel">${DAILY_DIFFS.map(d => `<option value="${d}">${DAILY_RU[d]}</option>`).join("")}</select>
          <p class="stat-note" id="atlasPriceNote">Загружаю условия…</p>
          <button class="btn" id="atlasCreateBtn" disabled>Создать челлендж</button>
          <div id="atlasGenerateStatus" role="status" aria-live="polite"></div>
        </form>
      </details>
      <details class="atlas-filter-panel" id="atlasFilters">
        <summary>Фильтры <span id="atlasFilterSummary">Все уровни, все челленджи, нерешённые</span></summary>
      <div class="atlas-filters">
        <label>Уровень<select id="atlasLevel"><option value="all">Все уровни</option>${DAILY_DIFFS.map(d => `<option value="${d}">${DAILY_RU[d]}</option>`).join("")}</select></label>
        <label>Коллекция<select id="atlasSource"><option value="all">Все челленджи</option><option value="seed">12 стартовых</option><option value="today">Сегодня</option><option value="archive">Архив без наград</option><option value="custom">Мои челленджи</option>${weeklyEnabled?'<option value="weekly">Практикумы недели</option>':''}</select></label>
        <label>Статус<select id="atlasStatus"><option value="unsolved">Нерешённые</option><option value="solved">Решённые</option><option value="all">Все</option></select></label>
      </div>
      </details>
      <div id="atlasList" class="atlas-list" aria-live="polite"></div>
      <div class="atlas-pagination"><button class="btn ghost" id="atlasPrev">← Назад</button><span id="atlasCount"></span><button class="btn ghost" id="atlasNext">Далее →</button></div>
    </div>`;
    const view = $("taskView").firstElementChild;
    const active = () => epoch === authEpoch && location.hash === "#/atlas" && view.isConnected;
    // getRandomValues also works over LAN HTTP, unlike randomUUID (HTTPS only).
    const newRequestKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
    let page = 1, requestVersion = 0, terms = null, generating = false;
    let requestKey = newRequestKey(), requestTopic = "";
    const priceNote = () => {
      if (!terms) return;
      const reward = terms.generation_rewards[$("atlasGenerateLevel").value];
      $("atlasPriceNote").textContent = terms.ai_available
        ? `${terms.generation_price} капель после проверки задания. За решение: ${reward} капель один раз. Челлендж останется в вашей коллекции.`
        : "Наставник сейчас недоступен. Готовые челленджи и архив работают.";
      $("atlasCreateBtn").textContent = `Создать за ${terms.generation_price} капель`;
      $("atlasCreateBtn").disabled = generating || !terms.ai_available;
    };
    async function load() {
      const version = ++requestVersion;
      const query = new URLSearchParams({ difficulty: $("atlasLevel").value, source: $("atlasSource").value, status: $("atlasStatus").value, page });
      if(weeklyEnabled)query.set('include_weekly','1');
      if (!terms) $("atlasList").textContent = "Загружаю челленджи…";
      try {
        if($('atlasSource').value!=='weekly')await loadDailyAi(true);
        if (!active() || version !== requestVersion) return;
        const data = await api("/api/atlas?" + query);
        if (!active() || version !== requestVersion) return;
        terms = data;
        $('atlasDailyState').hidden = data.daily_state_checked === false || data.daily_ready === 3;
        $('atlasDailyState').textContent = data.daily_state_checked === false || data.daily_ready === 3 ? '' : data.daily_pending
          ? `Новые задания дня: ${data.daily_ready} из 3 готовы. Наставник готовит остальные; повторов из стартового набора не будет.`
          : 'Новые задания дня пока не готовы. Стартовая коллекция и архив доступны; старые задачи не выдаём за новые.';
        priceNote();
        $("atlasList").innerHTML = data.items.map(t => {
          const dayRu = new Date(t.day + "T00:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
          const origin = t.origin === "weekly" ? (t.weekly_current?'Практикум недели · '+t.week_start+' — '+t.week_end:'Практикум · повторение') : t.origin === "seed" ? "Стартовая коллекция" : t.origin === "custom" ? "Личный челлендж" : (t.day === data.day ? "Сегодня" : "Архив") + " · " + dayRu;
          return `<a class="pane atlas-item${t.solved ? " atlas-item-solved" : ""}" href="#/atlas/${esc(t.id)}">
            <div class="atlas-item-meta"><span class="level-badge lv-${t.difficulty}">${DAILY_RU[t.difficulty]}</span><span>${esc(origin)}</span></div>
            ${t.solved ? '<span class="atlas-solved-badge">✓ Решено</span>' : ""}
            <h3>${esc(t.title)}</h3><p>${inline(t.prompt).replace(/`/g, "")}</p>
            <div class="atlas-item-meta"><span>${t.available_reward ? "+" + t.available_reward + " капель" : t.solved ? "Решено · без повторной награды" : "Практика без награды"}</span><span aria-hidden="true">→</span></div>
          </a>`;
        }).join("") || `<p class="empty">${$("atlasStatus").value === "unsolved" ? "Нерешённых челленджей в этой коллекции нет. Завершённые доступны в фильтре «Решённые»." : $("atlasStatus").value === "solved" ? "Решённых челленджей в этой коллекции пока нет." : "В этой коллекции пока нет челленджей."}</p>`;
        $("atlasCount").textContent = `Страница ${page} из ${Math.max(1, Math.ceil(data.total / data.page_size))} · ${data.total} заданий`;
        $("atlasPrev").disabled = page <= 1;
        $("atlasNext").disabled = page * data.page_size >= data.total;
        if (data.daily_state_checked !== false && (data.daily_pending || (data.ai_available && data.daily_ready < 3))) {
          setTimeout(() => { if (active() && version === requestVersion) load(); }, data.daily_pending ? 8000 : 60000);
        }
      } catch (e) {
        if (active() && version === requestVersion) $("atlasList").innerHTML = `<p class="empty">${esc(e.message)} <button class="btn ghost" id="atlasRetry">Повторить</button></p>`;
        $("atlasRetry")?.addEventListener("click", load);
      }
    }
    const updateFilterSummary = () => {
      $("atlasFilterSummary").textContent = ["atlasLevel", "atlasSource", "atlasStatus"]
        .map(id => $(id).selectedOptions[0].textContent).join(", ");
    };
    updateFilterSummary();
    ["atlasLevel", "atlasSource", "atlasStatus"].forEach(id => $(id).addEventListener("change", () => { updateFilterSummary(); page = 1; load(); }));
    $("atlasPrev").addEventListener("click", () => { page--; load(); });
    $("atlasNext").addEventListener("click", () => { page++; load(); });
    $("atlasGenerateLevel").addEventListener("change", priceNote);
    $("atlasCreateForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (generating || !terms?.ai_available) return;
      const topic = $("atlasTopic").value.trim(), difficulty = $("atlasGenerateLevel").value;
      const signature = JSON.stringify([topic, difficulty]);
      if (signature !== requestTopic) { requestTopic = signature; requestKey = newRequestKey(); }
      generating = true;
      priceNote();
      const status = $("atlasGenerateStatus");
      status.innerHTML = thinkingHtml("Наставник");
      try {
        const made = await post("/api/atlas/generate", { topic, difficulty, request_key: requestKey }, AbortSignal.timeout(110000));
        if (!active()) return;
        if (!made.active) {
          status.textContent = "Проверяю эталон и тесты в интерпретаторе… Капли ещё не списаны.";
          const t = made.validation;
          for (const [code, shouldPass] of [[t.solution, true], [t.starter, false], ["print('OK')", false]]) {
            const result = await PyRunner.run(code + "\n\n" + t.tests);
            if (!active()) return;
            const passed = !result.error && result.stdout.trim() === "OK";
            if (passed !== shouldPass) {
              requestKey = newRequestKey();
              throw new Error("Задание не прошло проверку качества. Капли не списаны. Можно попробовать ещё раз.");
            }
          }
        }
        const paid = await post(`/api/atlas/${made.id}/activate`, {});
        if (!active()) return;
        setWallet({ drops: paid.drops });
        location.hash = "#/atlas/" + made.id;
      } catch (error) {
        if (active()) status.textContent = error.name === 'TimeoutError' ? 'Наставник не ответил вовремя. Капли не списаны. Можно повторить запрос.' : error.message;
      } finally {
        generating = false;
        if (active()) priceNote();
      }
    });
    await load();
  }

  async function renderDailyAi(diff, atlasId = null) {
    const epoch = authEpoch;
    const hash = atlasId ? "#/atlas/" + atlasId : "#/daily/" + diff;
    const active = () => epoch === authEpoch && location.hash === hash;
    $("taskView").innerHTML = '<div class="task-page"><div class="empty">Загружаю задание дня…</div></div>';
    let d;
    try {
      if (atlasId) {
        const { task } = await api("/api/atlas/" + atlasId);
        diff = task.difficulty;
        d = { day: task.day, tasks: { [diff]: task }, drops: { [diff]: task.available_reward }, solved: task.solved ? [diff] : [] };
      } else d = await loadDailyAi();
    } catch (e) {
      if (!active()) return;
      $("taskView").innerHTML = `<div class="task-page"><div class="empty">${esc(e.message)}</div></div>`;
      return;
    }
    if (!active()) return;
    const t = d.tasks[diff];
    if (!t) {
      $("taskView").innerHTML = `<div class="task-page"><div class="empty">
        ${d.pending ? 'Наставник готовит новое задание этой сложности.' : 'Новое задание этой сложности пока не готово. Старое не выдаём за новое.'}
        <p><a class="btn" href="#/atlas">Открыть Атлас</a></p></div></div>`;
      if (d.pending) setTimeout(async () => {
        if (active()) {
          await loadDailyAi(true).catch(() => {});
          if (active()) renderDailyAi(diff);
        }
      }, 15000);
      return;
    }
    const done = d.solved.includes(diff);

    $("taskView").innerHTML = `
    <div class="task-page daily-ai-page">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="#/atlas">Атлас</a> / ${atlasId ? "Челлендж" : "Задание дня"}</div>
        <span class="level-badge lv-${diff}">${DAILY_RU[diff]}</span>
      </div>
      <div class="pane flow-task daily-ai-challenge">
        <div class="daily-ai-hero">
          <span class="daily-ai-kicker">${t.origin==='weekly'?(t.weekly_current?'Практикум недели · '+esc(t.week_start)+' — '+esc(t.week_end)+' · UTC':'Практикум · бесплатное повторение'):atlasId ? (t.origin === "daily" ? ((t.daily_current??(t.day===new Date().toISOString().slice(0,10))) ? "Задание дня · " : "Архив · ") + esc(d.day) : t.origin === "custom" ? "Личный челлендж" : "Коллекция Атласа") : "Задание дня · " + esc(d.day) + " · 00:00 UTC"}</span>
          <div class="task-title-row">
            <h2>${esc(t.title)}</h2>
            <span class="chip">${!d.drops[diff] ? "Практика без награды" : done ? "Награда уже получена" : "+" + d.drops[diff] + " капель · один раз"}</span>
            <span class="chip solved-flag" id="dailySolvedFlag" ${done ? "" : "hidden"}>решено</span>
          </div>
          <div class="prompt">${renderMd(t.prompt)}</div>
          ${t.origin==='weekly'?`<section class="weekly-context"><p>Один подготовленный практикум на неделю: соедините несколько навыков самостоятельно. Награда за новое содержание — 30 капель один раз; повторение бесплатно. Смена в понедельник, 00:00 UTC.</p><p>${t.skills.map(esc).join(' · ')}</p><p>Повторить основы: ${t.prerequisites.map(id=>`<a href="#/topic/${id}/theory">${esc(TOPICS.find(p=>p.id===id)?.title||'Тема '+id)}</a>`).join(' · ')}</p><details><summary>Вопрос для самопроверки</summary><p>${esc(t.reflection)}</p></details><div id="weeklyExplanation" ${t.explanation?'':'hidden'}>${t.explanation?'<h3>После решения</h3><p>'+esc(t.explanation)+'</p>':''}</div></section>`:''}
        </div>
        ${terminalEditorHtml("solution.py", `<textarea class="editor" id="dailyEditor" spellcheck="false"></textarea>`, { resetId: "dailyResetBtn", editorId: "dailyEditor" })}
        <div class="run-row">
          <button class="btn" id="dailyRunBtn">Запустить</button>
          <button class="btn dark" id="dailySubmitBtn">Отправить на проверку</button>
          <span class="run-status" id="dailyStatus"></span>
        </div>
        <div class="task-output-wrap">
          ${terminalEditorHtml("вывод", `<pre class="terminal-body output" id="dailyOutput"></pre>`)}
        </div>
        <section id="dailyTests" hidden></section>
        <div class="verdict" id="dailyVerdict"></div>
      </div>
    </div>`;

    const editor = $("dailyEditor");
    const dailyStarter = t.starter || "# Решение\n";
    const draft = bindLocalDraft(editor, atlasId && t.origin !== "daily" ? `atlas:${atlasId}` : `daily:${d.day}:${diff}${t.generated ? ':' + t.task_key : ''}`, dailyStarter);
    if (atlasId) setFabMentor({ id: "atlas:" + atlasId, type: "написать функцию", prompt: t.prompt, code: t.starter });
    window.EditorKeys?.bind(editor);
    $("dailyResetBtn")?.addEventListener("click", () => {
      draft.reset();
      $("dailyOutput").textContent = "";
      window.OutputFiles?.clear($("dailyOutput"));
      $("dailyVerdict").className = "verdict";
      $("dailyVerdict").innerHTML = "";
      $("dailyStatus").textContent = "Код восстановлен";
    });
    PyRunner.warmup();
    const status = (s) => { if (active()) $("dailyStatus").textContent = s || ""; };

    $("dailyRunBtn").addEventListener("click", async () => {
      const filesEpoch = window.OutputFiles?.epoch();
      const out = $("dailyOutput");
      window.OutputFiles?.clear(out);
      out.textContent = "";
      out.classList.remove("err");
      const r = await PyRunner.run(editor.value, status);
      if (!active()) return;
      if (r.error) { out.textContent = r.stdout + (window.RuntimeHelp?.errorText?.(r) || r.error); out.classList.add("err"); }
      else out.textContent = r.stdout || "(нет вывода)";
      window.OutputFiles?.show(out,r.artifacts,filesEpoch);
      status("");
    });

    $("dailySubmitBtn").addEventListener("click", async () => {
      const filesEpoch = window.OutputFiles?.epoch();
      const code = editor.value;
      const btn = $("dailySubmitBtn");
      btn.disabled = true;
      const v = $("dailyVerdict");
      v.className = "verdict";
      v.innerHTML = "";
      const out = $("dailyOutput");
      window.OutputFiles?.clear(out);
      out.textContent = "";
      const report = SubmissionChecks.start($("dailyTests"), t.tests);
      const r = await PyRunner.run(code, status, t.tests, report.onTest);
      if (!active()) return;
      if (r.blocked) {
        $("dailyTests").hidden = true;
        status("");
        v.className = "verdict show";
        v.textContent = window.RuntimeHelp?.errorText?.(r) || r.error || "Запуск отменён.";
        btn.disabled = false;
        return;
      }
      await report.finish({ ...r, ok: !r.error && r.check_stdout?.trim() === "OK" });
      if (!active()) return;
      status("");
      out.textContent = r.user_stdout ?? r.stdout ?? "";
      window.OutputFiles?.show(out,r.artifacts,filesEpoch);
      if (r.error) {
        v.className = "verdict show fail";
        v.innerHTML = codeFailureHtml({ ...r, got: r.stdout }, code, { append: t.tests });
      } else if (r.check_stdout == null) {
        v.className = "verdict show fail";
        v.textContent = "Проверка не запустилась. Обновите страницу и отправьте решение ещё раз.";
      } else if (r.check_stdout.trim() === "OK") {
        v.className = "verdict show ok";
        if (!done && !d.solved.includes(diff)) {
          try {
            const res = await post(atlasId ? `/api/atlas/${atlasId}/solve` : "/api/daily-ai/solve", { difficulty: diff, day: d.day, task_key: t.task_key, ...(t.origin==='weekly'?{week_start:t.week_start}:{}) });
            if (!active()) return;
            if(Number.isFinite(res.drops))setWallet({ drops: res.drops });
            if (res.awarded > 0) {
              flyDrops(res.awarded);
            }
            d.solved.push(diff);
            dailyAiCache = null;
            $("dailySolvedFlag").hidden = false;
            if(t.origin==='weekly'&&res.explanation){$('weeklyExplanation').hidden=false;$('weeklyExplanation').innerHTML='<h3>После решения</h3><p>'+esc(res.explanation)+'</p>';}
            v.innerHTML = `<strong>Принято!</strong> ${res.awarded ? "+" + res.awarded + " капель" : "Без повторной награды"} · <a href="#/atlas">В Атлас</a>`;
          } catch (e) {
            v.innerHTML = `<strong>Тесты пройдены.</strong> ${esc(e.message)} <a href="#/atlas">Открыть Атлас</a>`;
          }
        } else {
          v.innerHTML = `<strong>Принято!</strong> Это задание уже решено — повтор без награды.`;
        }
      } else {
        v.className = "verdict show fail";
        v.innerHTML = `<strong>Тесты не пройдены.</strong> Проверьте имя функции: нужна <code>${esc(t.func_name)}</code>.`;
      }
      requestAnimationFrame(() => v.scrollIntoView({ behavior: "smooth", block: "center" }));
      btn.disabled = false;
    });
  }

  /* ── Экран этапа: вводный урок перед заданием ───────────────────────── */
  function renderStageIntro(task) {
    const topic = TOPIC_OF[task.id];
    const introEpoch=authEpoch,introRoute=location.hash;
    const stageIdx = topic.tasks.findIndex((t) => t.id === task.id);
    const stageNum = stageIdx + 1;
    const total = topic.tasks.length;
    const intro = getTaskIntro(task);
    const points = pointsFor(task);

    const routeLine = window.stageRouteLine?.(topic.id, stageIdx, task.type);

    $("taskView").innerHTML = `
    <div class="task-page stage-intro-page">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="${branchHref(topic)}">${esc(branchTitle(topic))}</a> / <a href="#/topic/${topic.id}/theory">${inline(topic.title)}</a> / Этап ${stageNum}</div>
        <span class="level-badge lv-${topic.level}">${LEVEL_RU[topic.level]}</span>
      </div>

      <div class="stage-hero pane">
        <p class="stage-eyebrow">Этап ${stageNum} из ${total} · +${points} XP</p>
        <h2 class="stage-title">${task.title ? inline(task.title) : inline(topic.title)}</h2>
        ${routeLine ? `<p class="stage-route-line">${esc(routeLine)}</p>` : ""}
      </div>

      <div class="pane stage-goal">
        <h3><span class="nf nf-school" aria-hidden="true"></span> Что тренирует этот этап</h3>
        ${stageTrainHtml(intro, task)}
      </div>

      <div class="pane stage-more">
        <div class="stage-more-head">
          <h3>Хотите глубже?</h3>
          <button class="btn" id="lessonBtn"><span class="nf nf-lightbulb" aria-hidden="true"></span> Узнать подробнее</button>
        </div>
        <div class="stage-lesson" id="lessonBox" hidden></div>
      </div>

      <div class="stage-cta">
        <button class="btn dark big" id="toTaskBtn">Перейти к заданию →</button>
        <a class="link-btn" href="#/topic/${topic.id}/theory">Повторить теорию</a>
      </div>
    </div>`;

    $("toTaskBtn").addEventListener("click", () => {
      renderTaskPage(task, { skipIntro: true });
      window.scrollTo(0, 0);
    });

    $("lessonBtn").addEventListener("click", async () => {
      const btn = $("lessonBtn");
      const box = $("lessonBox");
      const active=()=>introEpoch===authEpoch&&introRoute===location.hash&&box.isConnected;
      btn.disabled = true;
      box.hidden = false;
      box.innerHTML = `<span class="review-wait">${waitingHtml("✎ наставник готовит разбор этапа…")}</span>`;
      try {
        if(window.CourseAssets?.loadTheory&&!window.THEORY_ARTICLES?.[topic.id])await window.CourseAssets.loadTheory(topic.id);
        if(!active())return;
        const th=normalizeTheory(topic.id);
        const r = await post("/api/ai/lesson", {
          task: { id: task.id, type: task.type, prompt: task.prompt, code: task.code || "" },
          theory: { topic: topic.title, article: th.raw },
        });
        if(!active())return;
        if (r.lesson) {
          box.innerHTML = renderMd(r.lesson);
          btn.textContent = "Разбор готов";
        } else {
          box.innerHTML = '<span class="review-wait">ИИ-наставник сейчас недоступен — теории выше достаточно для этапа.</span>';
          btn.disabled = false;
        }
      } catch (e) {
        if(!active())return;
        box.innerHTML = `<span class="review-wait">${esc(e.message)}</span>`;
        btn.disabled = false;
      }
    });
  }

  function normalizeTheory(topicId) {
    const raw = window.THEORY_ARTICLES?.[topicId] || window.THEORY_MANIFEST?.articles?.[topicId] || window.THEORY?.[topicId] || {};
    const topic = TOPICS.find((t) => t.id === topicId);
    const lead = raw.lead || raw.text || topic?.description || "";
    const plain = String(lead).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
      .replace(/ ([,.;:!?)])/g, "$1").trim();
    const example = raw.example
      || raw.sections?.[0]?.examples?.[0]?.code
      || null;
    return {
      raw,
      lead,
      example,
      teaserHtml: raw.text || inline(lead),
      plainText: plain,
      isArticle: Array.isArray(raw.sections) && raw.sections.length > 0,
    };
  }

  /* Полное тело статьи теории. */
  function theoryArticleBody(th) {
    const art = th.raw;
    if (!th.isArticle) {
      return `
        <div class="pane">
          <div class="theory-body">${th.teaserHtml}</div>
          ${th.example ? terminalHtml(th.example, "пример.py") : ""}
        </div>`;
    }
    // Контент статей (lead/mistakes/applications/summary/explanation) — готовый
    // HTML (<code>, <b>), как sec.text; inline()/esc() экранировали бы теги
    // в буквальный текст «<code>...</code>» на экране.
    return `
      <p class="theory-lead">${art.lead || ""}</p>
      ${(art.sections || []).map((sec, si) => `
        <section class="theory-section pane">
          <h3>${esc(sec.title || "")}</h3>
          <div class="theory-body">${String(sec.text || "").split(/\n\n+/).map((p) => `<p>${p}</p>`).join("")}</div>
          ${(sec.examples || []).map((ex, ei) => `
            <div class="theory-example" data-section="${si}" data-example="${ei}">
            ${ex.context ? `<p class="example-context">${esc(ex.context)}</p>` : ""}
            ${terminalHtml(ex.code || "", ex.codeLanguage === "shell" ? "команды терминала" : "пример.py")}
            ${ex.practice ? `
              <button type="button" class="btn ghost theory-predict" aria-expanded="false" aria-controls="prediction-${art.id}-${si}-${ei}">Предсказать результат</button>
              <div class="theory-prediction" id="prediction-${art.id}-${si}-${ei}" hidden>
                <label>${esc(ex.practice)}<textarea rows="3" maxlength="2000" placeholder="Мой прогноз и объяснение…"></textarea></label>
                <p class="stat-note">Необязательно. Запись останется только на этой странице, без оценки и отправки наставнику.</p>
                <div class="run-row"><button type="button" class="btn theory-try-run">Запустить и сравнить</button><button type="button" class="btn ghost theory-reveal">Прочитать разбор</button></div>
                <div class="theory-actual" role="status" aria-live="polite" hidden></div>
              </div><div class="theory-example-result">` : ""}
            ${Object.hasOwn(ex, "output") && (!ex.error || ex.output) ? terminalHtml(ex.output || "(нет вывода)", ex.outputKind === "sample" ? "пример вывода" : "вывод") : ""}
            ${ex.error ? terminalHtml(ex.error, "ошибка при запуске") : ""}
            ${ex.resultNote ? `<p class="example-result-note">${esc(ex.resultNote)}</p>` : ""}
            ${ex.explanation ? `<p class="stage-ex-note">${ex.explanation}</p>` : ""}
            ${ex.practice ? "</div>" : ""}
            </div>
          `).join("")}
        </section>`).join("")}
      ${(art.mistakes || []).length ? `
        <section class="theory-mistakes pane">
          <h3>Типичные ошибки</h3>
          ${art.mistakes.map((m) => `<p><b>${esc(m.title || "")}.</b> ${m.text || ""}</p>`).join("")}
        </section>` : ""}
      ${(art.applications || []).length ? `
        <section class="theory-apps pane">
          <h3>Где применяется</h3>
          <ul>${art.applications.map((a) => `<li>${a}</li>`).join("")}</ul>
        </section>` : ""}
      ${(art.summary || []).length ? `
        <section class="theory-summary pane">
          <h3>Кратко</h3>
          <ul>${art.summary.map((a) => `<li>${a}</li>`).join("")}</ul>
        </section>` : ""}`;
  }

  async function renderTheoryArticle(topicId) {
    const topic = TOPICS.find((t) => t.id === +topicId);
    if (!topic) {
      location.hash = "#/topics";
      return;
    }
    const epoch=authEpoch,hash=location.hash;
    let restoreTheoryFocus=false;
    if(window.CourseAssets?.loadTheory&&!window.THEORY_ARTICLES?.[topic.id]){
      $('listView').hidden=true;$('taskView').hidden=false;
      const loading=document.createElement('section');loading.className='pane theory-loading';
      loading.innerHTML='<h2>'+esc(topic.title)+'</h2><p role="status">Загружаем теорию…</p>';
      const focusInside=$('taskView').contains(document.activeElement);
      $('taskView').replaceChildren(loading);
      if(focusInside){const heading=loading.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});}
      const active=()=>epoch===authEpoch&&hash===location.hash&&loading.isConnected;
      try{await window.CourseAssets.loadTheory(topic.id);}
      catch{
        if(!active())return;
        loading.innerHTML='<h2>'+esc(topic.title)+'</h2><p role="alert">Не удалось загрузить статью. Проверьте соединение и попробуйте ещё раз.</p><button class="btn" id="theoryRetry">Повторить</button> <a class="btn" href="'+branchHref(topic)+'">К темам</a>';
        loading.querySelector('#theoryRetry').onclick=()=>{if(active())renderTheoryArticle(topic.id);};
        return;
      }
      if(!active())return;
      restoreTheoryFocus=loading.contains(document.activeElement);
    }
    const th = normalizeTheory(topic.id);
    const art = th.raw;
    const body = theoryArticleBody(th);
    const unsolvedTask = firstUnsolvedIn(topic.tasks);
    const nextTask = unsolvedTask || topic.tasks[0];

    $("listView").hidden = true;
    $("taskView").hidden = false;
    $("taskView").innerHTML = `
      <div class="task-page theory-article-page">
        <div class="task-nav">
          <div class="crumbs"><a href="#/">Главная</a> / <a href="${branchHref(topic)}">${esc(branchTitle(topic))}</a> / ${inline(topic.title)} / Теория</div>
        </div>
        <header class="pane">
          <p class="stage-eyebrow">Теория и примеры</p>
          <h2>${inline(art.title || topic.title)}</h2>
          <p class="auth-sub">${inline(topic.description)}</p>
          ${prerequisitesHtml(topic)}
        </header>
        ${body}
        <div class="pane stage-more">
          <div class="stage-more-head">
            <h3>Хотите глубже?</h3>
            <button class="btn" id="topicLessonBtn"><span class="nf nf-lightbulb" aria-hidden="true"></span> Узнать подробнее</button>
          </div>
          <div class="stage-lesson" id="topicLessonBox" hidden></div>
        </div>
        <div class="stage-cta">
          <a class="btn dark big" href="#/task/${nextTask.id}">${!unsolvedTask ? "Повторить этапы" : nextTask.id === topic.tasks[0].id ? "К первому этапу" : "Продолжить этапы"} →</a>
        </div>
      </div>`;

    if(restoreTheoryFocus)focusPageContent();
    window.LearningGlossary?.enhance($("taskView").querySelector(".theory-article-page"));

    $("taskView").querySelectorAll(".theory-predict").forEach(toggle => {
      const card = toggle.closest(".theory-example");
      const example = art.sections[card.dataset.section].examples[card.dataset.example];
      const prediction = card.querySelector(".theory-prediction");
      const result = card.querySelector(".theory-example-result");
      const actual = card.querySelector(".theory-actual");
      const run = card.querySelector(".theory-try-run");
      const epoch = authEpoch;
      let turn = 0;
      toggle.addEventListener("click", () => {
        turn++;
        prediction.hidden = !prediction.hidden;
        result.hidden = !prediction.hidden;
        actual.hidden = true;
        toggle.setAttribute("aria-expanded", String(!prediction.hidden));
        toggle.textContent = prediction.hidden ? "Предсказать результат" : "Вернуться к чтению";
        if (!prediction.hidden) prediction.querySelector("textarea").focus();
      });
      card.querySelector(".theory-reveal").addEventListener("click", () => { result.hidden = false; });
      run.addEventListener("click", async () => {
        const ticket = ++turn;
        const active = () => epoch === authEpoch && card.isConnected && ticket === turn;
        run.disabled = true;
        actual.hidden = false;
        actual.textContent = "Запускаю пример в Python…";
        try {
          const execution = await PyRunner.run(example.code);
          if (!active()) return;
          actual.innerHTML = terminalHtml(execution.stdout + (execution.error || "") || "(нет вывода)", "фактический вывод");
          actual.insertAdjacentHTML("beforeend", '<p>Сравните с прогнозом. Если результат другой, найдите строку, которую вы поняли иначе. Разбор ниже поможет проверить объяснение.</p>');
          result.hidden = false;
        } catch (_) {
          if (active()) actual.textContent = "Не удалось запустить Python. Попробуйте ещё раз или прочитайте готовый разбор.";
        } finally {
          run.disabled = false;
        }
      });
    });

    $("topicLessonBtn").addEventListener("click", async () => {
      const btn = $("topicLessonBtn");
      const box = $("topicLessonBox");
      btn.disabled = true;
      box.hidden = false;
      box.innerHTML = thinkingHtml("Наставник");
      try {
        const r = await post("/api/ai/topic-lesson", {
          topic: { id: topic.id, title: topic.title, description: topic.description, theory: th.raw },
        });
        if (r.lesson) {
          box.innerHTML = renderMd(r.lesson);
          btn.textContent = "Разбор готов";
        } else {
          box.innerHTML = '<span class="review-wait">ИИ-наставник сейчас недоступен — теории выше достаточно для темы.</span>';
          btn.disabled = false;
        }
      } catch (e) {
        box.innerHTML = `<span class="review-wait">${esc(e.message)}</span>`;
        btn.disabled = false;
      }
    });
  }

  async function renderTaskRoute(task) {
    let restoreTaskFocus=false;
    if(!task.challenge&&window.CourseAssets?.loadTask&&!window.CourseAssets.isTaskLoaded(task.id)){
      const epoch=authEpoch,hash=location.hash,host=$('taskView');
      closeSandbox();setFabMentor(null);$('sandboxFab').hidden=true;
      const loading=document.createElement('section');loading.className='pane task-bank-loading';
      loading.innerHTML='<h2>'+esc(stageTitle(task))+'</h2><p role="status">Загружаем задание…</p>';
      const focusInside=host.contains(document.activeElement);host.replaceChildren(loading);
      if(focusInside){const heading=loading.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});}
      const active=()=>epoch===authEpoch&&hash===location.hash&&loading.isConnected;
      try{await window.CourseAssets.loadTask(task.id);}
      catch{
        if(!active())return;
        const restoreErrorFocus=loading.contains(document.activeElement);
        loading.innerHTML='<h2>'+esc(stageTitle(task))+'</h2><p role="alert">Не удалось загрузить задание. Ваш прогресс и черновик сохранены.</p><button class="btn" id="taskBankRetry">Повторить</button> <a class="btn" href="'+branchHref(TOPIC_OF[task.id])+'">К темам</a>';
        loading.querySelector('#taskBankRetry').onclick=()=>{if(active())renderTaskRoute(task);};
        if(restoreErrorFocus)loading.querySelector('#taskBankRetry').focus({preventScroll:true});return;
      }
      if(!active())return;
      restoreTaskFocus=loading.contains(document.activeElement);
    }
    renderTaskPage(task);setFabMentor(task);
    if(restoreTaskFocus)focusPageContent();
  }

  function renderTaskPage(task, opts) {
    const topic = TOPIC_OF[task.id];
    if (topic && !task.challenge) localStorage.setItem(topicPracticeKey(topic), "1");
    // нерешённый этап всегда начинается с вводного урока
    if (!opts?.skipIntro && !solved.has(task.id) && !task.challenge && !task.finale) {
      renderStageIntro(task);
      return;
    }
    const isPrediction = task.type === "определить вывод";
    const isQuiz = task.type === "квиз";
    const isDemo = task.type === "демо";
    const isExplain = task.type === "объяснить поведение";
    const hasEditor = (!isPrediction && !isExplain && !isQuiz) || isDemo;
    const points = pointsFor(task);
    const quizSteps = isQuiz
      ? (Array.isArray(task.questions) && task.questions.length
          ? task.questions
          : [{
              prompt: task.prompt,
              answer: task.answer,
              wrong: task.wrong || [],
              explanation: task.explanation,
            }])
      : null;
    let quizIdx = 0;
    const choices = isPrediction ? generateChoices(task) : (isQuiz ? generateChoices(quizSteps[0]) : null);
    const showFixBtn = isDemo && task.answer && !/^#\s*демо/i.test(task.answer.trim());

    const choiceZone = (choiceList, questionPrompt) => `
        <div class="answer-zone" id="answerZone">
          <h3>Ваш ответ</h3>
          ${questionPrompt ? `<p class="answer-hint quiz-q">${inline(questionPrompt)}</p>` : `<p class="answer-hint">Выберите один вариант:</p>`}
          <div class="choice-grid" id="choiceGrid">
            ${choiceList.map((c, i) => `
              <button type="button" class="choice-btn" data-value="${esc(c)}" aria-pressed="false">
                <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
                <code class="choice-text">${esc(c)}</code>
              </button>`).join("")}
          </div>
          <input type="hidden" id="answerInput" value="">
          <div class="run-row">
            <button class="btn dark" id="submitBtn">Отправить на проверку</button>
            <span class="run-status" id="runStatus"></span>
          </div>
          <div class="verdict" id="verdict"></div>
        </div>`;

    const answerZone = isPrediction ? (choices ? choiceZone(choices, null) : `
        <div class="answer-zone" id="answerZone">
          <h3 id="answerOutputTitle">Ваш ответ</h3>
          <p class="answer-hint" id="answerOutputHint">Введите вывод программы в точности, как его напечатает Python:</p>
          <textarea class="answer-input" id="answerInput" aria-labelledby="answerOutputTitle" aria-describedby="answerOutputHint" spellcheck="false" placeholder="вывод программы"></textarea>
          <div class="run-row">
            <button class="btn dark" id="submitBtn">Отправить на проверку</button>
            <span class="run-status" id="runStatus"></span>
          </div>
          <div class="verdict" id="verdict"></div>
        </div>`) : isQuiz ? choiceZone(choices, quizSteps.length > 1
          ? `Вопрос ${quizIdx + 1} из ${quizSteps.length}. ${quizSteps[0].prompt}`
          : quizSteps[0].prompt) : isExplain ? `
        <div class="answer-zone" id="answerZone">
          <h3>Ваше объяснение</h3>
          <p class="stat-note" id="explanationHint">Ориентируйтесь на пункты условия. Можно другими словами: важен ход мысли, а не совпадение фраз с разбором.</p>
          <textarea class="answer-input prose" id="answerInput" aria-label="Ваше объяснение" aria-describedby="explanationHint" placeholder="Объясните своими словами, почему программа ведёт себя именно так"></textarea>
          <div class="run-row">
            <button class="btn dark" id="submitBtn">Сравнить с разбором</button>
            <button class="btn ghost" type="button" id="explainMentorBtn">Подготовить вопрос наставнику</button>
            <span class="run-status" id="runStatus"></span>
          </div>
          <p class="stat-note" id="explainMentorStatus" role="status">Отзыв необязателен. Вопрос отправите сами; действуют обычные лимит и стоимость наставника.</p>
          <div class="verdict" id="verdict"></div>
        </div>` : isDemo ? `
        <div class="answer-zone demo-workspace" id="answerZone">
          <h3>Попробуйте сами</h3>
          ${terminalEditorHtml("demo.py", `<textarea class="editor" id="editor" spellcheck="false"></textarea>`, { resetId: "resetBtn", editorId: "editor" })}
          <div class="run-row">
            <button class="btn dark${topic.id === 0 ? " run-hint-pulse" : ""}" id="runBtn">Запустить</button>
            ${showFixBtn ? '<button class="btn" type="button" id="fixBtn">Показать исправление</button>' : ""}
            <button class="btn" id="submitBtn">Далее</button>
            <span class="run-status" id="runStatus"></span>
          </div>
          <div class="task-output-wrap">
            ${terminalEditorHtml("вывод", `<pre class="terminal-body output" id="output"></pre>`)}
          </div>
          <div class="verdict" id="verdict"></div>
        </div>` : `
        <div class="answer-zone" id="answerZone">
          <h3>Решение</h3>
          ${window.CHECKS[task.id]?.append && normText(window.CHECKS[task.id].expect) === "OK" ? '<p class="stat-note">Здесь проверяется не только печать ответа. Созданные значения и результаты вычислений тоже важны. Свои print можно оставить.</p>' : ""}
          ${terminalEditorHtml("solution.py", `<textarea class="editor" id="editor" spellcheck="false"></textarea>`, { resetId: "resetBtn", editorId: "editor" })}
          <div class="run-row">
            <button class="btn${topic.id === 0 ? " run-hint-pulse" : ""}" id="runBtn">Запустить</button>
            <button class="btn dark" id="submitBtn">Проверить</button>
            <span class="run-status" id="runStatus"></span>
          </div>
          <div class="task-output-wrap">
            ${terminalEditorHtml("вывод", `<pre class="terminal-body output" id="output"></pre>`)}
          </div>
          <section id="taskTests" hidden></section>
          <div class="verdict" id="verdict"></div>
        </div>`;

    const codeBlock = task.code && (isPrediction || isExplain)
      ? terminalHtml(task.code, "program.py")
      : (task.code && !hasEditor ? terminalHtml(task.code, "program.py") : "");

    $("taskView").innerHTML = `
    <div class="task-page task-workspace">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="${branchHref(topic)}">${esc(branchTitle(topic))}</a> / ${inline(topic.title)} <span class="level-badge lv-${topic.level}">${LEVEL_RU[topic.level]}</span></div>
      </div>

      <div class="task-layout">
        <div class="task-main">
          <div class="pane flow-task">
            <div class="task-title-row">
              <h2>${task.challenge ? esc(task.title) : (task.title ? inline("Этап " + task.id + " · " + task.title) : "Этап " + task.id)}</h2>
              ${task.challenge ? '<span class="chip ch-chip">[!] челлендж темы</span>' : ""}
              ${task.finale ? `<span class="chip ch-chip">Финал темы · задача ${task.finale} из 2</span>` : ""}
              <span class="chip solved-flag" id="solvedFlag" ${solved.has(task.id) ? "" : "hidden"}>решено</span>
            </div>
            <div class="task-context-actions">
              <button type="button" class="chip chip-btn" id="stageTrainBtn" title="Что тренирует этот этап"><span class="nf nf-school" aria-hidden="true"></span><span class="chip-label">Что тренируем?</span></button>
              <a class="chip chip-link" href="#/topic/${topic.id}/theory" title="Теория темы"><span class="nf nf-book" aria-hidden="true"></span><span class="chip-label">Теория</span></a>
              <details class="task-meta"><summary>Об этапе</summary><div class="task-meta-content">
              ${task.challenge || task.finale ? "" : '<button class="link-btn stage-back" id="stageIntroBtn" title="Вернуться к вводному уроку этапа">↺ вводная этапа</button>'}
              <span class="chip">${esc(taskTypeLabel(task))}</span>
              <span class="chip">+${points} XP</span>
              ${/^да/i.test(task.verified || "") ? '<span class="chip chip-verified" title="Эталон задания проверен">✓ Проверено</span>' : ""}
              </div></details>
            </div>
            <div class="prompt">${renderMd(task.prompt)}</div>
            ${task.finale ? '<p class="finale-guidance">Самостоятельная практика: попробуйте решение на разных данных. Подсказки и наставник доступны, если понадобится помощь. Обе задачи финала входят в завершение темы.</p>' : ""}
            ${codeBlock}
            <p class="ai-review-notice"><span id="autoReviewCopy" data-automatic="${!isExplain&&!isDemo&&!isQuiz}"></span> <a href="#/profile" id="openAISettingsFromTask">Настроить ИИ</a></p>
            ${answerZone}
          </div>

          <details class="pane hints-pane">
            <summary>Подсказки</summary>
            <div class="hints" id="hints">${hintsHtml(task, [])}</div>
          </details>

          <details class="pane notes-pane">
            <summary id="taskNotesTitle">Мои заметки</summary>
            <textarea class="notes-area" id="notesArea" aria-labelledby="taskNotesTitle" placeholder="Заметки к заданию: сохраняются в вашем профиле"></textarea>
            <div class="notes-status" id="notesStatus"></div>
          </details>
        </div>

        <aside class="task-aside">
          <div class="pane course-nav-pane">
            <h3>Навигация по курсу</h3>
            <nav class="course-rail" aria-label="Задания курса">${courseNavHtml(task)}</nav>
          </div>
        </aside>
      </div>
    </div>`;

    paintAIPreferences();$('openAISettingsFromTask').onclick=()=>{showAISettingsNext=true;};
    const railCurrent = document.querySelector(".course-rail-item.current");
    if (railCurrent && window.matchMedia("(max-width: 940px)").matches) {
      requestAnimationFrame(() => {
        const rail = railCurrent.closest(".course-rail");
        if (!rail) return;
        rail.scrollTo({
          left: railCurrent.offsetLeft - rail.clientWidth / 2 + railCurrent.clientWidth / 2,
          behavior: "smooth",
        });
      });
    }

    /* — подсказки: бесплатное раскрытие + платная разблокировка — */
    api("/api/hints?task_id=" + task.id).then((d) => {
      $("hints").innerHTML = hintsHtml(task, d.unlocked || []);
    }).catch(() => {});
    $("hints").addEventListener("click", async (e) => {
      const unlockBtn = e.target.closest(".hint-unlock");
      if (unlockBtn) {
        const level = +unlockBtn.dataset.level;
        unlockBtn.disabled = true;
        try {
          const r = await post("/api/hints/unlock", { task_id: task.id, level });
          setWallet({ drops: r.drops });
          const d = await api("/api/hints?task_id=" + task.id);
          $("hints").innerHTML = hintsHtml(task, d.unlocked || []);
          $("hints").querySelectorAll(".hint")[level - 1]?.classList.add("open");
        } catch (err) {
          toast("<b>" + esc(err.message) + "</b>");
          unlockBtn.disabled = false;
        }
        return;
      }
      const btn = e.target.closest(".hint > button");
      if (btn) btn.parentElement.classList.toggle("open");
    });

    /* — варианты ответа — */
    const choiceGrid = $("choiceGrid");
    if (choiceGrid) {
      choiceGrid.addEventListener("click", (e) => {
        const btn = e.target.closest(".choice-btn");
        if (!btn) return;
        choiceGrid.querySelectorAll(".choice-btn").forEach((b) => { b.classList.remove("selected"); b.setAttribute("aria-pressed", "false"); });
        btn.classList.add("selected");
        btn.setAttribute("aria-pressed", "true");
        $("answerInput").value = btn.dataset.value;
      });
    }

    function renderQuizStep(idx) {
      const q = quizSteps[idx];
      const list = generateChoices(q);
      const hint = $("answerZone")?.querySelector(".answer-hint");
      if (hint) {
        hint.innerHTML = quizSteps.length > 1
          ? inline(`Вопрос ${idx + 1} из ${quizSteps.length}. ${q.prompt}`)
          : inline(q.prompt);
      }
      const grid = $("choiceGrid");
      if (grid && list) {
        grid.innerHTML = list.map((c, i) => `
              <button type="button" class="choice-btn" data-value="${esc(c)}" aria-pressed="false">
                <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
                <code class="choice-text">${esc(c)}</code>
              </button>`).join("");
      }
      if ($("answerInput")) $("answerInput").value = "";
      const v = $("verdict");
      if (v) { v.className = "verdict"; v.innerHTML = ""; }
    }

    /* — редактор: полный код, черновики, сброс, Tab — */
    if (hasEditor) PyRunner.warmup();
    const editor = $("editor");
    const getCode = () => (editor ? editor.value : "");

    if (editor) {
      const starter = starterCodeFor(task);
      const draft = bindLocalDraft(editor, `task:${task.id}`, starter);
      window.EditorKeys?.bind(editor);

      $("resetBtn")?.addEventListener("click", () => {
        draft.reset();
        const out = $("output");
        window.OutputFiles?.clear(out);
        if (out) out.textContent = "";
        const v = $("verdict");
        if (v) { v.className = "verdict"; v.innerHTML = ""; }
        const st = $("runStatus");
        if (st) st.textContent = "Код восстановлен";
      });

      $("fixBtn")?.addEventListener("click", () => {
        editor.value = task.answer;
        draft.save();
      });
    }

    $("stageTrainBtn")?.addEventListener("click", () => openStageTrainModal(task));
    const explainNote = $("explainMentorStatus");
    if (explainNote) {
      const defaultNote = explainNote.textContent;
      $("answerInput").addEventListener("input", () => { explainNote.textContent = defaultNote; });
    }
    $("explainMentorBtn")?.addEventListener("click", () => {
      const text = $("answerInput").value.trim();
      const note = $("explainMentorStatus");
      if (!text) {
        note.textContent = "Сначала напишите своё объяснение: тогда наставник сможет дать отзыв именно о нём.";
        $("answerInput").focus();
        return;
      }
      const question = "Посмотри моё объяснение этого задания: что в рассуждении понятно, а что стоит уточнить? Не выставляй оценку и не пиши готовый ответ. Моё объяснение: " + text;
      if (question.length > 2000) {
        note.textContent = "Вопрос наставнику ограничен 2000 символами. Сократите объяснение для отзыва; самопроверка доступна и с длинным ответом.";
        return;
      }
      if ($("aiQuestion").value.trim() && !window.confirm("В поле наставника уже есть вопрос. Заменить его вопросом о вашем объяснении?")) return;
      $("aiQuestion").value = question.replace(/\n/g, " ");
      note.textContent = "Вопрос подготовлен, но ещё не отправлен. Можно отредактировать его или просто закрыть наставника.";
      openAI(task);
    });
    /* — заметки: загрузка + автосохранение — */
    const notes = $("notesArea");
    api("/api/notes?task_id=" + task.id).then((d) => { notes.value = d.text; }).catch(() => {});
    let notesTimer;
    notes.addEventListener("input", () => {
      clearTimeout(notesTimer);
      $("notesStatus").textContent = "…";
      notesTimer = setTimeout(async () => {
        try {
          await post("/api/notes", { task_id: task.id, text: notes.value });
          $("notesStatus").textContent = "сохранено";
        } catch (e) {
          $("notesStatus").textContent = "не удалось сохранить";
        }
      }, 700);
    });

    /* — назад к вводному уроку этапа — */
    $("stageIntroBtn")?.addEventListener("click", () => {
      renderStageIntro(task);
      window.scrollTo(0, 0);
    });

    /* — запуск — */
    const runStatusNode = $("runStatus"), runEpoch = authEpoch;
    const status = (s) => { if (runStatusNode?.isConnected && runEpoch === authEpoch) runStatusNode.textContent = s || ""; };
    const runBtn = $("runBtn");
    if (runBtn) {
      runBtn.addEventListener("click", async () => {
        runBtn.classList.remove("run-hint-pulse");
        runBtn.disabled = true;
        const out = $("output");
        const epoch = authEpoch;
        const runHash = location.hash, filesEpoch = window.OutputFiles?.epoch();
        const active = () => out.isConnected && epoch === authEpoch && location.hash === runHash && !$("taskView").hidden && !$("appView").hidden;
        window.OutputFiles?.clear(out);
        out.textContent = "";
        out.classList.remove("err");
        try {
          const r = await PyRunner.run(getCode(), status);
          if (!active()) return;
          if (r.error) {
            out.textContent = r.stdout + (window.RuntimeHelp?.errorText?.(r) || r.error);
            out.classList.add("err");
          } else {
            out.textContent = r.stdout || "(нет вывода)";
            out.classList.remove("err");
          }
          window.OutputFiles?.show(out,r.artifacts,filesEpoch);
        } catch (e) {
          if (!active()) return;
          out.textContent = e.message;
          out.classList.add("err");
        }
        status("");
        runBtn.disabled = false;
      });
    }

    /* — отправка на проверку — */
    $("submitBtn").addEventListener("click", async () => {
      const filesEpoch = window.OutputFiles?.epoch();
      reviewSeq += 1; // новая проверка отменяет актуальность предыдущего ревью
      const btn = $("submitBtn");
      btn.disabled = true;
      const submittedView = $("taskView").firstElementChild, epoch = authEpoch;
      const active = () => submittedView.isConnected && epoch === authEpoch;
      let report = null;
      const v = $("verdict");
      v.className = "verdict";
      v.innerHTML = "";
      // прячем вывод пробного запуска — остаётся один блок результата
      const runOut = $("output");
      window.OutputFiles?.clear(runOut);
      if (runOut && !isDemo) { runOut.textContent = ""; runOut.classList.remove("err"); }
      try {
        /* Демо: без проверки — достаточно нажать «Далее» */
        if (isDemo) {
          await accept(task);
          $("solvedFlag").hidden = false;
          const nextTask = curriculum.nextTask(TOPICS, task);
          v.className = "verdict show ok";
          v.innerHTML = `<strong>Отлично!</strong> ${earnedPoints > 0 ? `+${earnedPoints} XP` : "XP уже получен"}` +
            (task.explanation ? `<div class="quiz-explain">${inline(task.explanation)}</div>` : "");
          showSuccessModal(earnedPoints, nextTask, task.id);
          btn.disabled = false;
          return;
        }

        /* Многошаговый / обычный квиз */
        if (isQuiz) {
          if (btn.dataset.quizNext === "1") {
            btn.dataset.quizNext = "";
            btn.textContent = "Отправить на проверку";
            renderQuizStep(quizIdx);
            btn.disabled = false;
            return;
          }
          const answerEl = $("answerInput");
          if (choiceGrid && !answerEl.value.trim()) {
            v.className = "verdict show fail";
            v.textContent = "Сначала выберите один из вариантов ответа.";
            btn.disabled = false;
            return;
          }
          const step = quizSteps[quizIdx];
          const ok = outputsEqual(step.answer, answerEl.value);
          const grid = $("choiceGrid");
          grid?.querySelectorAll(".choice-btn").forEach((b) => {
            if (outputsEqual(step.answer, b.dataset.value)) b.classList.add("correct");
            else if (b.classList.contains("selected")) b.classList.add(ok ? "correct" : "wrong");
          });
          if (!ok) {
            try { await saveAttempt({ ok: false, text: answerEl.value }); } catch (e) { /* не блокируем квиз */ }
            v.className = "verdict show fail";
            v.innerHTML = `<strong>Пока не то.</strong> Подумайте ещё раз.`;
            btn.disabled = false;
            return;
          }
          v.className = "verdict show ok";
          v.innerHTML = `<strong>Верно!</strong>` +
            (step.explanation ? `<div class="quiz-explain">${inline(step.explanation)}</div>` : "");
          if (quizIdx < quizSteps.length - 1) {
            quizIdx += 1;
            btn.dataset.quizNext = "1";
            btn.textContent = "Следующий вопрос";
            btn.disabled = false;
            return;
          }
          // Промежуточный правильный ответ ещё не закрывает ошибку всей задачи.
          // Убираем квиз из очереди только после последнего верного шага.
          try { await saveAttempt({ ok: true, text: answerEl.value }); } catch (e) { /* не блокируем квиз */ }
          await accept(task);
          $("solvedFlag").hidden = false;
          const nextTask = curriculum.nextTask(TOPICS, task);
          showSuccessModal(earnedPoints, nextTask, task.id, step.explanation || task.explanation);
          btn.disabled = false;
          return;
        }

        const answerEl = $("answerInput");
        if (choiceGrid && !answerEl.value.trim()) {
          v.className = "verdict show fail";
          v.textContent = "Сначала выберите один из вариантов ответа.";
          btn.disabled = false;
          return;
        }
        const payload = editor ? { code: getCode() } : { text: answerEl.value };
        report = editor ? SubmissionChecks.start($("taskTests"), taskCheckScript(task, payload.code)) : null;
        const res = await grade(task, payload, status, report?.onTest);
        if (!active()) return;
        if (runOut) window.OutputFiles?.show(runOut,res.artifacts,filesEpoch);
        if (res.kind === "blocked") {
          if ($("taskTests")) $("taskTests").hidden = true;
          v.className = "verdict show";
          v.textContent = window.RuntimeHelp?.errorText?.(res) || res.error;
          status("");
          btn.disabled = false;
          return;
        }
        const attempt = { ok: res.ok, code: payload.code, text: payload.text, error: res.error, got: res.got };
        // Попытка сохраняется сразу, независимо от задержки или отмены ИИ.
        const savedAttempt = res.kind === "auto" ? saveAttempt(attempt).catch(() => null) : null;
        if (report && res.kind === "auto") await report.finish(res);
        if (!active()) return;
        if (res.kind === "self") {
          if ($("taskTests")) $("taskTests").hidden = true;
          v.className = "verdict show";
          v.style.background = "rgba(61,127,211,0.08)";
          v.style.border = "1px solid rgba(61,127,211,0.3)";
          v.innerHTML =
            `<strong>Самопроверка.</strong> ${isExplain ? "Сравните ход мысли с разбором. Другие формулировки допустимы:" : "Сравните своё решение с эталоном:"}` +
            `<pre>${esc(task.answer)}</pre>` +
            `<div>${inline(task.explanation)}</div>` +
            `<div class="self-actions">
               <button class="btn dark" id="selfOk">${isExplain ? (solved.has(task.id) ? "Могу объяснить — закончить повторение" : `Могу объяснить — засчитать +${points} XP`) : (solved.has(task.id) ? "Совпало — закончить повторение" : `Совпало — засчитать +${points} XP`)}</button>
               <button class="btn" id="selfNo">Ещё подумаю</button>
             </div>`;
          $("selfOk").addEventListener("click", async () => {
            await accept(task);
            $("solvedFlag").hidden = false;
            v.className = "verdict show ok";
            v.innerHTML = `<strong>Засчитано!</strong> ${earnedPoints > 0 ? `+${earnedPoints} XP` : "XP уже получен"}`;
            const nextTask = curriculum.nextTask(TOPICS, task);
            showSuccessModal(earnedPoints, nextTask, task.id);
          });
          $("selfNo").addEventListener("click", () => { v.className = "verdict"; });
        } else if (res.ok) {
          await accept(task);
          $("solvedFlag").hidden = false;
          const nextTask = task.challenge
            ? null
            : curriculum.nextTask(TOPICS, task);
          v.className = "verdict show ok";
          v.innerHTML = `<strong>Принято!</strong> ${earnedPoints > 0 ? `+${earnedPoints} XP` : "XP уже получен"}` +
            (isPrediction && task.explanation
              ? `<div class="quiz-explain">${inline(task.explanation)}</div>` : "");
          showSuccessModal(earnedPoints, nextTask, task.id);
        } else {
          v.className = "verdict show fail";
          if (res.error) {
            v.innerHTML = codeFailureHtml(res, payload.code || "", window.CHECKS[task.id], task.id);
          } else if (editor && res.expected != null) {
            v.innerHTML = `<strong>Пока не то.</strong> Вывод не совпал с ожидаемым.` +
              diffHtml(res.expected, res.got || "");
          } else if (isPrediction) {
            const answerText = $("answerInput").value;
            v.innerHTML = `<strong>Пока не то.</strong>` +
              (choices ? " Подумайте ещё раз или загляните в подсказки." : predictionDiffHtml(task.answer, answerText)) +
              `<p class="diff-where">Застряли? Подсказки ниже разберут задание по шагам.</p>`;
          } else {
            v.innerHTML = `<strong>Пока не то.</strong> Ответ не совпал. Попробуйте ещё раз или загляните в подсказки.`;
          }
        }
        // Для успеха отсчёт начинается после открытия окна, а не до accept().
        if (res.kind === "auto") requestReview(attempt, savedAttempt);
      } catch (e) {
        if (!active()) return;
        if (report) await report.finish({ ok: false, error: e.message });
        if (!active()) return;
        v.className = "verdict show fail";
        v.textContent = e.message;
      }
      if (!active()) return;
      status("");
      btn.disabled = false;
      // автоскролл к результату
      requestAnimationFrame(() =>
        v.scrollIntoView({ behavior: "smooth", block: "center" }));
    });

    let earnedPoints = 0;
    async function accept(t) {
      earnedPoints = 0;
      if (!solved.has(t.id)) {
        const response = await setSolved(t.id, true);
        earnedPoints = response.xp_awarded ?? pointsFor(t);
      }
    }

    /* — ИИ-ревью попытки: бесплатно, приходит фоном после вердикта — */
    let reviewSeq = 0;
    let attemptWriteTail = Promise.resolve();
    function saveAttempt(attempt) {
      const write = attemptWriteTail.then(() =>
        post("/api/attempts", { task_id: task.id, attempt }));
      attemptWriteTail = write.catch(() => null);
      return write;
    }
    async function requestReview(attempt, savedAttempt, automatic=true) {
      const my = ++reviewSeq;
      const reviewHash = location.hash,reviewEpoch=authEpoch,reviewRoot=$('taskView').firstElementChild;
      const saved=await Promise.resolve(savedAttempt).catch(()=>null);
      if(my!==reviewSeq||reviewEpoch!==authEpoch||location.hash!==reviewHash||!reviewRoot?.isConnected)return;
      if(saved?.ai_settings){window.AIHelper.configure(saved.ai_settings);paintAIPreferences();}
      if(!window.AIHelper.canReview(automatic)){$('reviewBox')?.classList.remove('show');lastReview={taskId:null,html:null};renderSuccessReview();return;}
      // новая попытка — старое ревью этой задачи больше не актуально
      let box = $("reviewBox");
      if (!box) {
        box = document.createElement("div");
        box.id = "reviewBox";
        box.className = "review-box";
        $("verdict").after(box);
      }
      box.innerHTML = `<span class="review-wait">${waitingHtml("✎ наставник смотрит вашу попытку…")}</span>`;
      box.classList.add("show");
      lastReview = { taskId: task.id, html: box.innerHTML };
      renderSuccessReview();
      const isCurrent = () => my === reviewSeq && location.hash === reviewHash && box.isConnected && !$("appView").hidden;
      try {
        const ready = attempt.ok&&automatic ? await AIHelper.waitForReview() : true;
        if (!ready || !isCurrent()) return;
        const r = await post("/api/ai/review", {
          task: { id: task.id, type: task.type, prompt: task.prompt, answer: task.answer },
          attempt,
          automatic,
          // Если запись попытки не удалась, /api/ai/review сохранит её сам.
          attempt_id: saved?.attempt_id ?? null,
        });
        if (!isCurrent()) return;
        let text = r.review;
        // страховка: модель могла вернуть сырой JSON — вытаскиваем поле
        if (text && /^\s*\{/.test(text)) {
          try { text = JSON.parse(text).review || text; } catch (e) { /* как есть */ }
        }
        if (text) {
          const html = renderMd(text);
          box.innerHTML = html;
          // дублируем в модалку успеха, если она открыта для этой задачи
          lastReview = { taskId: task.id, html };
          renderSuccessReview();
          if (successModal.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else if(r.reason==='ai_busy') {
          showRetry('Наставник занят. Обычная проверка уже завершена; разбор можно запросить позже.');
        } else {
          box.classList.remove("show"); // ИИ недоступен — тихо прячем
          lastReview = { taskId: null, html: null };
          renderSuccessReview();
        }
      } catch (e) {
        if (isCurrent()) {
          showRetry(e.code==='ai_busy'?e.message:'Разбор не получен. Результат обычной проверки сохранён.');
        }
      }
      function showRetry(message){
        box.replaceChildren();const text=document.createElement('p'),retry=document.createElement('button');text.textContent=message;retry.type='button';retry.className='btn';retry.textContent='Запросить разбор';retry.onclick=()=>requestReview(attempt,Promise.resolve(saved),false);box.append(text,retry);lastReview={taskId:null,html:null};renderSuccessReview();
      }
    }

    /* Ctrl+Enter — отправить на проверку из любого поля задания */
    $("taskView").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $("submitBtn")?.click();
      }
    });
  }

  /* ── Профиль ────────────────────────────────────────────────────────── */
  function calcStreak(dateSet) {
    const DAY = 86400000;
    const key = (t) => new Date(t).toISOString().slice(0, 10);
    let d = Date.now();
    let streak = 0;
    if (!dateSet.has(key(d))) d -= DAY; // сегодня ещё не решал — считаем со вчера
    while (dateSet.has(key(d))) { streak++; d -= DAY; }
    return streak;
  }

  function barRow(label, done, total, href) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const inner = `
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-track"><span style="width:${pct}%${done ? "" : ";min-width:0"}"></span></span>
      <span class="stat-num">${done}/${total}</span>`;
    return href
      ? `<a class="stat-row" href="${href}">${inner}</a>`
      : `<div class="stat-row">${inner}</div>`;
  }

  async function renderProfile() {
    const user = $("userName").textContent || "";
    $("taskView").innerHTML = `<div class="task-page profile-page"><div class="empty">Загружаю профиль…</div></div>`;
    const loading = $("taskView").firstElementChild, epoch = authEpoch;
    const active = () => loading.isConnected && epoch === authEpoch && location.hash === "#/profile";
    let stats;
    try {
      stats = await api("/api/stats");
    } catch (e) {
      if (!active()) return;
      if (e.status === 401) return kickToAuth();
      $("taskView").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    if (!active()) return;

    const streak = typeof stats.streak === "number"
      ? stats.streak
      : calcStreak(new Set(stats.solved.map((s) => s.solved_at.slice(0, 10))));
    serverStreak = streak;
    await loadWallet();
    if (!active()) return;
    await loadAchievements();
    if (!active()) return;
    let surveyAnswers = null;
    try { surveyAnswers = (await api("/api/survey")).answers; } catch (e) { /* нет */ }
    if (!active()) return;
    const xp = currentXp();
    let rank = RANKS[0], nextRank = null;
    for (let i = 0; i < RANKS.length; i++)
      if (xp >= RANKS[i].min) { rank = RANKS[i]; nextRank = RANKS[i + 1] || null; }

    // по уровням
    const byLevel = LEVEL_ORDER.map((lv) => {
      const tasks = ALL_TASKS.filter((t) => TOPIC_OF[t.id].level === lv);
      return barRow(LEVEL_TITLE[lv], tasks.filter((t) => solved.has(t.id)).length, tasks.length);
    }).join("");

    // по типам заданий
    const types = [...new Set(ALL_TASKS.map(taskTypeLabel))];
    const byType = types.map((tp) => {
      const tasks = ALL_TASKS.filter((t) => taskTypeLabel(t) === tp);
      return barRow(tp, tasks.filter((t) => solved.has(t.id)).length, tasks.length);
    }).join("");

    // Незаконченные темы: это прогресс, а не оценка знаний.
    const weak = TOPICS
      .map((topic) => {
        const done = topic.tasks.filter((t) => solved.has(t.id)).length;
        return { topic, done, ratio: done / topic.tasks.length };
      })
      .filter((x) => x.done > 0 && x.ratio < 1)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 3);
    const weakHtml = weak.length
      ? weak.map((x) => {
          const next = firstUnsolvedIn(x.topic.tasks);
          return barRow(x.topic.title, x.done, x.topic.tasks.length, next ? "#/task/" + next.id : null);
        }).join("")
      : '<p class="stat-note">Здесь появятся начатые темы с оставшимися заданиями.</p>';

    // активность за 14 дней
    const perDay = {};
    stats.solved.forEach((s) => {
      const k = s.solved_at.slice(0, 10);
      perDay[k] = (perDay[k] || 0) + 1;
    });
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const k = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const n = perDay[k] || 0;
      days.push(`<span class="day-cell lvl-${Math.min(n, 4)}" title="${k}: ${n}"></span>`);
    }

    const since = stats.member_since ? new Date(stats.member_since).toLocaleDateString("ru-RU") : "";

    $("taskView").innerHTML = `
    <div class="task-page profile-page">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / Профиль</div>
      </div>

      <div class="profile-grid">
        <div class="pane profile-hero">
          <h2 class="profile-name">${esc(user)}${activeTitle() ? ` <span class="user-title">· ${esc(activeTitle())}</span>` : ""}</h2>
          <p class="profile-sub">${esc(rank.name)} · ${xp} XP${nextRank ? ` · до ранга «${esc(nextRank.name)}» ещё ${nextRank.min - xp} XP` : " · максимальный ранг"}</p>
          <div class="profile-badges">
            <span class="chip">решено ${solved.size} / ${ALL_TASKS.length}</span>
            <span class="chip ${streak > 0 ? "chip-verified" : ""}">серия: ${streak} ${streak % 10 === 1 && streak % 100 !== 11 ? "день" : (streak % 10 >= 2 && streak % 10 <= 4 && (streak % 100 < 10 || streak % 100 >= 20) ? "дня" : "дней")}</span>
            <span class="chip">заметок: ${stats.notes_count}</span>
            ${since ? `<span class="chip">на платформе с ${since}</span>` : ""}
          </div>
          <div class="activity-row" aria-label="Активность за 14 дней">${days.join("")}</div>
        </div>

        <div class="pane profile-pane-weak">
          <h3>Продолжить начатое</h3>
          <p class="stat-note">Темы, в которых остались задания. Для работы над ошибками откройте <a href="#/review">повторение</a>.</p>
          <div class="stat-list">${weakHtml}</div>
        </div>

        <details class="pane profile-statistics">
          <summary>Подробная статистика</summary>
          <div class="profile-statistics-grid">
            <section class="profile-pane-levels">
              <h3>По уровням</h3>
              <div class="stat-list">${byLevel}</div>
            </section>
            <section class="profile-pane-types">
              <h3>По типам заданий</h3>
              <div class="stat-list">${byType}</div>
            </section>
          </div>
        </details>

        <details class="pane profile-achievements">
          <summary>
            <span>
              <b>Достижения</b>
              <small>${Object.keys(earnedAchievements).length} / ${window.ACHIEVEMENTS.length}</small>
            </span>
            <span class="profile-expand">развернуть</span>
          </summary>
          <div class="ach-grid">
            ${window.ACHIEVEMENTS.map((a) => `
              <div class="ach ${earnedAchievements[a.key] ? "earned" : ""}" title="${esc(a.desc)}">
                <span class="ach-icon">${esc(a.icon)}</span>
                <span class="ach-title">${esc(a.title)}</span>
              </div>`).join("")}
          </div>
        </details>

        <details class="pane profile-title-rewards" id="profileTitleRewards">
          <summary>Титулы за обучение <span>${Object.values(titleRewardCatalog).filter(r=>r.owned).length} / ${Object.keys(titleRewardCatalog).length}</span></summary>
          <p class="stat-note">Титулы выдаются за темы, опыт и коллекции. Уже полученные титулы остаются у вас.</p>
          <div class="title-reward-list">${Object.entries(titleRewardCatalog).map(([key,reward])=>`
            <div class="title-reward-row"><div><strong>${esc(reward.title.replace(/^Титул: /,''))}</strong>
              <p>${esc(reward.requirement)}</p><small>${reward.owned ? 'В вашей коллекции' : `${reward.current} / ${reward.target}`}</small></div>
              ${reward.owned ? `<button type="button" class="btn" data-title-choice="${esc(key)}" aria-pressed="${getLook('title')===key}">${getLook('title')===key?'Снять':'Выбрать'}</button>` : ''}
            </div>`).join('')}</div>
        </details>

        <details class="pane profile-title-rewards" id="profileFrameRewards">
          <summary>Рамки за обучение <span>${Object.values(frameRewardCatalog).filter(r=>r.owned).length} / ${Object.keys(frameRewardCatalog).length}</span></summary>
          <p class="stat-note">Рамки выдаются за прогресс. Ранее купленные остаются в вашей коллекции.</p>
          <div class="title-reward-list">${Object.entries(frameRewardCatalog).map(([key,reward])=>`
            <div class="title-reward-row"><div><strong>${esc(reward.title.replace(/^Рамка: /,''))}</strong>
              <p>${esc(reward.requirement)}</p><small>${reward.owned?'В вашей коллекции':`${reward.current} / ${reward.target}`}</small></div>
              ${reward.owned?`<button type="button" class="btn" data-frame-choice="${esc(key)}" aria-pressed="${getLook('frame')===key}">${getLook('frame')===key?'Снять':'Выбрать'}</button>`:''}
            </div>`).join('')}</div>
        </details>

        ${surveyAnswers ? `
        <div class="pane">
          <h3>О вас</h3>
          <div class="stat-list">
            ${Object.entries(surveyAnswers).map(([k, v]) => `
              <div class="stat-row"><span class="stat-label">${esc({ experience: "Опыт", goal: "Цель", known: "Уже знакомо", style: "Стиль обучения" }[k] || k)}</span>
              <span class="survey-val">${esc(Array.isArray(v) ? v.join(", ") : v)}</span></div>`).join("")}
          </div>
        </div>` : ""}

        <details class="pane profile-memory" id="mentorMemory">
          <summary>Наставник и данные</summary>
          <div id="mentorControls" class="ai-settings"></div>
          <p>Заметки наставника по вашим вопросам. Они могут быть неточными; вы можете очистить память в любой момент.</p>
          <div id="mentorMemoryList"></div>
          <p id="mentorMemoryStatus" role="status" aria-live="polite"></p>
          <div class="profile-memory-actions">
            <button class="btn" id="refreshMentorMemory">Обновить</button>
            <button class="btn" id="clearMentorMemory" disabled>Очистить память</button>
          </div>
          <details class="legacy-drafts">
            <summary>Диалоги и передача данных ИИ</summary>
            <p>Память, переписка и попытки хранятся отдельно. Кнопка «Очистить память» удаляет только заметки и счётчики памяти. Остальные разделы можно выбрать в «Очистить историю» выше; прогресс, капли и бесплатный лимит не меняются.</p>
            <p>При вопросе провайдеру ИИ отправляются ваш вопрос, условие и исходный код задания, до шести последних сообщений этого диалога, память и краткая сводка прогресса. При разборе решения — условие, ваша попытка с кодом, выводом и ошибкой, предыдущие попытки; для верного решения также передаётся эталон.</p>
            <p>После очистки прежний диалог всё ещё может использоваться как контекст. Новые вопросы могут создать новые заметки. Очистка не удаляет данные из резервных копий и уже отправленные провайдеру сведения: их хранение зависит от его правил. Не вставляйте в код и сообщения пароли или личные данные.</p>
          </details>
        </details>

        <div class="pane profile-pane-data">
          <h3>Мои данные</h3>
          <p class="stat-note">Заметки хранятся в вашем профиле. Можно скачать их одним файлом.</p>
          <button class="btn" id="exportNotes">Скачать заметки</button>
          <div id="learningArchive"></div>
          <details class="legacy-drafts" id="legacyDrafts" hidden>
            <summary>Старые черновики этого браузера</summary>
            <p class="stat-note">Раньше черновики сохранялись без имени аккаунта. Они остались в браузере, но больше не подставляются в редактор: среди них может быть код другого ученика. Если вы работали здесь раньше, скачайте архив и перенесите свой код в нужное задание вручную. Исходные черновики не удаляются.</p>
            <button class="btn" id="exportLegacyDrafts">Скачать старые черновики</button>
          </details>
        </div>

        <details class="pane account-security" id="accountSecurity"><summary>Вход и безопасность</summary></details>
        <a class="pane profile-updates" href="#/review"><span>Повторение и история ошибок</span><span aria-hidden="true">→</span></a>
        <a class="pane profile-updates" href="#/updates"><span>Что нового на платформе</span><span aria-hidden="true">→</span></a>
      </div>
    </div>`;

    applyBanner(getLook('banner')||'');
    mountAccountSecurity($('accountSecurity'));
    $('profileTitleRewards').addEventListener('click',event=>{
      const button=event.target.closest('[data-title-choice]');if(!button)return;
      const key=button.dataset.titleChoice;if(!wallet.owned.includes(key))return;
      setLook('title',getLook('title')===key?'':key);
      document.querySelectorAll('[data-title-choice]').forEach(node=>{const selected=getLook('title')===node.dataset.titleChoice;node.setAttribute('aria-pressed',String(selected));node.textContent=selected?'Снять':'Выбрать';});
      const heading=document.querySelector('.profile-name .user-title');
      if(heading)heading.remove();
      if(activeTitle()){const label=document.createElement('span');label.className='user-title';label.textContent=' · '+activeTitle();document.querySelector('.profile-name').appendChild(label);}
    });
    $('profileFrameRewards').addEventListener('click',event=>{
      const button=event.target.closest('[data-frame-choice]');if(!button)return;
      const key=button.dataset.frameChoice;if(!wallet.owned.includes(key))return;
      setLook('frame',getLook('frame')===key?'':key);applyFrame(getLook('frame'));
      document.querySelectorAll('[data-frame-choice]').forEach(node=>{const selected=getLook('frame')===node.dataset.frameChoice;node.setAttribute('aria-pressed',String(selected));node.textContent=selected?'Снять':'Выбрать';});
    });
    const memoryPane = $("mentorMemory"), memoryList = $("mentorMemoryList"), memoryStatus = $("mentorMemoryStatus");
    const refreshMemory = $("refreshMentorMemory"), clearMemory = $("clearMentorMemory");
    let memoryLoaded = false, memoryBusy = false, memoryCount = 0;
    const memoryActive = () => memoryPane.isConnected && epoch === authEpoch && location.hash === "#/profile";
    async function updateMemory(clear = false) {
      if (memoryBusy || !memoryActive()) return;
      if (clear && !window.confirm("Очистить заметки и счётчики памяти наставника? Переписка и попытки останутся: они всё ещё могут использоваться как контекст. Прогресс, капли и лимит вопросов не изменятся.")) return;
      memoryBusy = true;
      refreshMemory.disabled = clearMemory.disabled = true;
      memoryStatus.textContent = clear ? "Очищаю память. Если наставник занят, повторите после его ответа." : "Загружаю память…";
      try {
        const data = await api("/api/ai/memory", clear ? { method: "DELETE" } : undefined);
        if (!memoryActive()) return;
        const entries = Object.entries(data.memory || {});
        memoryCount = entries.length;
        memoryLoaded = true;
        const label = key => key.startsWith("ai:") ? ({note:'Заметка',goal:'Цель',preferences:'Предпочтения',weak_topics:'Темы для повторения'}[key.slice(3)] || (/[а-яё]/i.test(key.slice(3)) ? key.slice(3) : 'Заметка'))
          : key === "questions_total" ? "Вопросов с последней очистки"
          : key === "last_task" ? "Последнее задание"
          : key.startsWith("asked_task:") ? "Вопросов по заданию " + key.slice(11) : 'Дополнительная запись';
        const notes=entries.filter(([key])=>key.startsWith('ai:')),usage=entries.filter(([key])=>!key.startsWith('ai:'));
        const rows=list=>`<dl>${list.map(([key,value])=>`<dt>${esc(label(key))}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
        memoryList.innerHTML=(notes.length?rows(notes):'<p>Наставник пока не сохранил заметок.</p>')+(usage.length?`<details id="mentorMemoryUsage"><summary>История вопросов</summary>${rows(usage)}</details>`:'');
        memoryStatus.textContent = clear ? "Память очищена. Переписка и попытки сохранены." : "";
      } catch (error) {
        if (!memoryActive()) return;
        if (error.status === 401) return kickToAuth();
        memoryStatus.textContent = error.code==='ai_busy'?error.message:clear ? "Не удалось подтвердить очистку. Нажмите «Обновить», чтобы проверить состояние." : "Не удалось загрузить память. Можно попробовать ещё раз.";
      } finally {
        memoryBusy = false;
        if (memoryActive()) {
          refreshMemory.disabled = false;
          clearMemory.disabled = !memoryLoaded || !memoryCount;
        }
      }
    }
    memoryPane.addEventListener("toggle", () => { if (memoryPane.open && !memoryLoaded) updateMemory(); });
    refreshMemory.addEventListener("click", () => updateMemory());
    clearMemory.addEventListener("click", () => updateMemory(true));
    mountAISettings(memoryPane,$('mentorControls'),()=>{memoryLoaded=false;if(memoryActive())void updateMemory();});
    if(showAISettingsNext){showAISettingsNext=false;memoryPane.open=true;memoryPane.scrollIntoView({block:'start'});}

    window.LearningArchive?.bind($("learningArchive"), { active: memoryActive });
    $("exportNotes").addEventListener("click", async () => {
      const data = await api("/api/notes/all");
      downloadJson(data.notes, "python-v-oblakah-notes.json");
    });
    try { $("legacyDrafts").hidden = !legacyDrafts().length; } catch (_) { /* Storage may be disabled. */ }
    $("exportLegacyDrafts").addEventListener("click", () => {
      try {
        downloadJson({ version: 1, owner: null, drafts: legacyDrafts() }, "python-v-oblakah-legacy-drafts.json");
      } catch (_) {
        toast("Не удалось прочитать черновики: проверьте доступ браузера к локальному хранилищу.");
      }
    });
  }

  /* ── Магазин (страница) ─────────────────────────────────────────────── */
  function shopDisplayName(title, kind) {
    const raw = String(title || "");
    const prefixes = {
      sky: /^Небо:\s*/i,
      term: /^Терминал:\s*/i,
      title: /^Титул:\s*/i,
      premium: /^Премиум-профиль:\s*/i,
      fx: /^Эффект:\s*/i,
      frame: /^Рамка:\s*/i,
      banner: /^Обложка:\s*/i,
      cursor: /^Курсор:\s*/i,
      sound: /^Звук:\s*/i,
      workspace: /^Мастерская:\s*/i, tool: /^Инструмент:\s*/i,
      trial: /^Испытание:\s*/i, box: /^Проект:\s*/i,
    };
    const re = prefixes[kind];
    const name = re ? raw.replace(re, "") : raw;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  const SHOP_NOTES = {
    sky: "Своя палитра и живая сцена на всех страницах. Можно вернуть обычный день.",
    term: "Цвет текста и фон редактора и терминала. Покупка навсегда.",
    title: "Ваш титул рядом с именем в профиле.",
    frame: "Оформляет имя в меню и карточку вашего профиля.",
    premium: "Премиум-возможности на доске проектов.",
    consumable: "Сохраняет серию при пропуске дня. Используется автоматически.",
    fx: "Дополнительные частицы поверх выбранного неба. Движение можно остановить.",
    banner: "Обложка верхней части профиля. Можно примерить перед покупкой.",
    cursor: "Оформление указателя на компьютере с мышью. Текстовый курсор редактора остаётся обычным.",
    sound: "Короткий сигнал при верном решении. Выключен, пока вы не примените тему.",
  };
  const SHOP_FILTERS = [
    ["all", "Все"], ["sky", "Небо и эффекты"], ["term", "Терминал"],
    ["profile", "Обложки и профиль"], ["cursor", "Курсоры"], ["sound", "Звуки"],
    ["trial", "Испытания"], ["box", "Проектные наборы"], ["tool", "Инструменты"], ["useful", "Полезное"], ["owned", "Моя коллекция"],
  ];
  let shopFilter = "all", shopFilterUser = "", shopRenderRevision = 0;
  let shopQuery = "", shopSort = "catalog", shopAffordable = false;
  const shopBuying = new Set();

  function selectShopItems(catalog, filter, query, sort, affordable) {
    const normalize = value => String(value).toLocaleLowerCase("ru").replaceAll("ё", "е").trim();
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const items = catalog.filter(([key, item]) => shopMatches(key, item, filter)
      && words.every(word => normalize(item.title + " " + (item.note || SHOP_NOTES[item.kind] || "")).includes(word))
      && (!affordable || (walletKnownDrops && (!wallet.owned.includes(key) || item.kind === "consumable") && item.price <= wallet.drops)));
    if (sort === "price-up") items.sort((a,b) => a[1].price - b[1].price);
    if (sort === "price-down") items.sort((a,b) => b[1].price - a[1].price);
    if (sort === "name") items.sort((a,b) => a[1].title.localeCompare(b[1].title, "ru"));
    return items;
  }
  function shopMatches(key, item, filter) {
    if (filter === "all") return true;
    if (filter === "owned") return wallet.owned.includes(key);
    if (filter === "profile") return ["banner", "premium"].includes(item.kind);
    if (filter === "sky") return ["sky", "fx"].includes(item.kind);
    if (filter === "useful") return ["workspace","consumable"].includes(item.kind);
    return item.kind === (filter === "useful" ? "consumable" : filter);
  }
  function shopItemHtml(key, item) {
    const owned = wallet.owned.includes(key), kind = item.kind || "";
    const active = owned && getLook(kind) === key;
    const name = shopDisplayName(item.title, kind);
    const visual = kind === "sky" ? `<canvas class="shop-scene-preview" data-scene="${key}"></canvas>`
      : kind === "term" ? '<code>&gt;&gt;&gt; print("Hello, sky!")<br>Hello, sky!</code>'
      : kind === "frame" ? '<span class="shop-avatar">Py</span>'
      : kind === "title" ? `<span class="shop-title-sample">${esc(name)}</span>`
      : kind === "banner" ? (['banner_aurora','banner_valley','banner_nebula'].includes(key)?`<canvas class="shop-scene-preview" data-scene="${key}"></canvas>`:'<span class="shop-banner-sample"></span>')
      : kind === "cursor" ? '<span class="shop-cursor-sample"></span>'
      : kind === "sound" ? '<span class="shop-sound-sample"><i></i><i></i><i></i><i></i><i></i></span>'
      : kind === "fx" ? (key==='fx_leaves'?'<code>{ } &nbsp; * &nbsp; [ ] &nbsp; +<br>&nbsp; def &nbsp; ~ &nbsp; ()</code>':`<canvas class="shop-scene-preview" data-scene="${key}"></canvas>`)
      : ['workspace','trial','box','tool'].includes(kind) ? `<span class="shop-utility-sample">${esc(kind==='tool'?key.slice(5).toUpperCase():kind==='trial'?'assert':kind==='box'?'main.py':'{ .py }')}</span>`
      : kind === "premium" ? '<span class="shop-emblem">♛</span>' : '<span class="shop-emblem">❄</span>';
    const preview = ["sky", "term", "fx", "frame", "banner", "cursor", "sound"].includes(kind)
      ? `<button type="button" class="btn shop-preview" data-kind="${kind}" data-skin="${key}" aria-label="${kind==='sound'?'Прослушать':'Примерить'}: ${esc(name)}">${kind==='sound'?'Прослушать':'Примерить'}</button>` : "";
    let action;
    if (kind === "consumable" || !owned) {
      const missing = walletKnownDrops ? Math.max(0, item.price - wallet.drops) : null;
      const pending = shopBuying.has(authEpoch + ":" + key);
      const buying = [...shopBuying].some(operation => operation.startsWith(authEpoch + ":"));
      action = preview + `<button type="button" class="btn dark shop-buy" data-item="${key}" ${buying || missing === null || missing > 0 ? "disabled" : ""} aria-label="Купить: ${esc(name)}, ${item.price} капель">${pending ? "Покупаем…" : "Купить · " + item.price}</button>`
        + (missing > 0 ? `<span class="shop-shortfall">Не хватает ${missing} капель</span>` : "");
    } else if (["sky", "term", "fx", "title", "frame", "banner", "cursor", "sound"].includes(kind)) {
      action = `<button type="button" class="btn ${active ? "" : "dark"} shop-apply" data-kind="${kind}" data-skin="${active ? "" : key}" aria-label="${active ? "Снять" : "Применить"}: ${esc(name)}">${active ? "Снять" : "Применить"}</button>`;
    } else action = ['workspace','trial','box','tool'].includes(kind)?'<a class="btn" href="#/workshop">Открыть мастерскую</a>':'<span class="shop-owned">В коллекции</span>';
    return `<article class="shop-item ${owned ? "owned" : ""} ${active ? "is-active" : ""}" data-product="${key}">
      <div class="shop-art shop-art-${kind} shop-art-${key}" aria-hidden="true">${visual}</div>
      <div class="shop-card-body"><div class="shop-card-meta"><span>${esc({sky:"Небо",term:"Терминал",title:"Титул",frame:"Рамка",banner:"Обложка",cursor:"Курсор",sound:"Звуковая тема",premium:"Профиль",fx:"Эффект",consumable:"Полезное",workspace:"Мастерская",trial:"Испытание",box:"Проектный набор",tool:"Инструмент"}[kind] || "Награда")}</span><span class="${owned ? "shop-owned" : "shop-price"}">${active ? "Применено" : owned ? "В коллекции" : item.price + " капель"}</span></div>
      <h3 class="shop-name">${esc(name)}</h3><p class="shop-note">${esc(item.note || SHOP_NOTES[kind] || "Награда за комплект достижений.")}</p>
      ${kind === "consumable" ? `<p class="shop-owned">В запасе: ${wallet.freezes}</p>` : ""}
      <div class="shop-actions">${action}</div></div></article>`;
  }

  let shopPreviewTimer = 0;
  let shopPreviewSnap = null;
  function restoreShopPreview() {
    clearTimeout(shopPreviewTimer);
    shopPreviewTimer = 0;
    const saved = shopPreviewSnap;
    shopPreviewSnap = null;
    const notice = $("shopPreviewNotice");
    if (notice) notice.hidden = true;
    if (!saved || saved.epoch !== authEpoch || saved.user !== lookUser) return;
    applySkin(saved.sky); applyTermTheme(saved.term); applyFx(saved.fx); applyFrame(saved.frame);applyBanner(saved.banner);applyCursor(saved.cursor);
  }
  function startShopPreview(kind, key) {
    if(kind==='sound'){playUiSound(key,true);return;}
    if (shopPreviewSnap && (shopPreviewSnap.epoch !== authEpoch || shopPreviewSnap.user !== lookUser)) restoreShopPreview();
    if (!shopPreviewSnap) shopPreviewSnap = {
      epoch: authEpoch, user: lookUser, sky: getLook("sky"), term: getLook("term"),
      fx: getLook("fx"), frame: getLook("frame"), banner:getLook('banner'), cursor:getLook('cursor'),
    };
    clearTimeout(shopPreviewTimer);
    if (kind === "sky") applySkin(key);
    else if (kind === "term") {
      applyTermTheme(key);
    }
    else if (kind === "fx") applyFx(key);
    else if (kind === "frame") applyFrame(key);
    else if (kind === "banner") applyBanner(key);
    else if (kind === "cursor") applyCursor(key);
    const notice = $("shopPreviewNotice");
    if (notice) {
      notice.hidden = false;
      $("shopPreviewName").textContent = shopDisplayName(shopCatalog[key]?.title || ITEM_TITLES[key], kind) + " — примерка на 8 секунд. Капли не списываются.";
      const sample=notice.querySelector('.shop-live-terminal');
      if(sample){sample.hidden=kind!=='term';if(kind==='term')sample.scrollIntoView({block:'center'});}
      const profile=notice.querySelector('#shopProfilePreview');
      if(profile)profile.hidden=!['banner','frame'].includes(kind);
    }
    shopPreviewTimer = setTimeout(restoreShopPreview, 8000);
  }

  function confirmShopPurchase(key) {
    $("shopPurchaseDialog")?.remove();
    const item = shopCatalog[key], epoch = authEpoch;
    if (!item || !walletKnownDrops || item.price > wallet.drops || [...shopBuying].some(operation => operation.startsWith(epoch + ":"))) return Promise.resolve(false);
    const dialog = document.createElement("dialog");
    dialog.id = "shopPurchaseDialog";
    dialog.className = "shop-purchase-dialog";
    dialog.setAttribute("aria-labelledby", "shopPurchaseTitle");
    dialog.setAttribute("aria-describedby", "shopPurchaseDescription");
    dialog.innerHTML = `<form method="dialog"><h2 id="shopPurchaseTitle">${esc(shopDisplayName(item.title, item.kind))}</h2>
      <p id="shopPurchaseDescription">Стоимость: <strong>${item.price} капель</strong>. После списания останется ${wallet.drops - item.price}.</p>
      <p>${item.kind === "consumable" ? "Одна заморозка сохранит серию при пропуске дня." : "Предмет останется в коллекции. Применить его можно после покупки."}</p>
      <div class="shop-actions"><button class="btn" value="cancel" autofocus>Отмена</button><button class="btn dark" value="buy">Купить за ${item.price} капель</button></div></form>`;
    document.body.appendChild(dialog);
    return new Promise(resolve => {
      const cancel = () => dialog.close();
      window.addEventListener("hashchange", cancel, {once:true});
      dialog.addEventListener("close", () => {
        window.removeEventListener("hashchange", cancel);
        const confirmed = dialog.returnValue === "buy" && epoch === authEpoch && location.hash === "#/shop";
        dialog.remove(); resolve(confirmed);
      }, {once:true});
      dialog.showModal();
    });
  }
  async function renderShop() {
    const epoch = authEpoch, route = location.hash, revision = ++shopRenderRevision;
    await loadWallet();
    const current = () => epoch === authEpoch && route === location.hash && revision === shopRenderRevision;
    if (!current()) return;
    if (shopFilterUser !== lookUser) {
      shopFilterUser = lookUser; shopFilter = "all"; shopQuery = ""; shopSort = "catalog"; shopAffordable = false;
    }
    const catalog = Object.entries(shopCatalog);
    if (!catalog.length) {
      $("taskView").innerHTML = '<div class="pane"><h2>Магазин пока не загрузился</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="btn" id="shopRetry">Повторить</button></div>';
      $("shopRetry").onclick = renderShop;
      return;
    }
    const setItems = Object.entries(ITEM_TITLES).filter(([key]) => !shopCatalog[key] && wallet.owned.includes(key));
    $("taskView").innerHTML = `<div class="task-page shop-page">
      <div class="task-nav"><div class="crumbs"><a href="#/">Главная</a> / Магазин</div></div>
      <section class="pane shop-hero"><div class="shop-hero-copy">
        <h2>Магазин</h2><p>Оформление, новые проекты и инструменты для ваших идей.</p><a href="#/workshop">Открыть мастерскую</a></div>
        <div class="shop-balance"><span>Ваши капли</span><strong><span class="drop-dot"></span><span data-wallet-drops>${walletDropsLabel()}</span></strong></div>
        <div class="shop-hero-actions"><a class="shop-earn-link" href="#/topics">Как получить капли →</a><p>Оформление остаётся навсегда. Заморозки расходуются по одной.</p></div></section>
      <div class="shop-filters" role="group" aria-label="Категории магазина">${SHOP_FILTERS.map(([id,label]) => `<button type="button" class="shop-filter" data-filter="${id}" aria-pressed="${shopFilter === id}">${label}<span>${catalog.filter(([k,i]) => shopMatches(k,i,id)).length}</span></button>`).join("")}</div>
      <div class="shop-toolbar"><label class="shop-search">Найти предмет<input id="shopSearch" type="search" placeholder="Название или назначение" value="${esc(shopQuery)}" aria-controls="shopGrid"></label>
        <details class="shop-extra-filters" id="shopMoreFilters" ${shopSort!=='catalog'||shopAffordable?'open':''}><summary>Ещё фильтры</summary><div class="shop-more-filters"><label>Порядок<select id="shopSort"><option value="catalog">Как в каталоге</option><option value="price-up">Сначала дешевле</option><option value="price-down">Сначала дороже</option><option value="name">По названию</option></select></label>
        <label class="shop-affordable"><input id="shopAffordable" type="checkbox" ${shopAffordable ? "checked" : ""}>Хватает капель</label></div></details>
        <button type="button" class="btn" id="shopReset">Сбросить</button></div>
      <div class="shop-preview-notice" id="shopPreviewNotice" role="status" hidden><div><span id="shopPreviewName"></span><pre class="shop-live-terminal" aria-label="Ваш терминал" hidden>&gt;&gt;&gt; print("Моё облако")
Моё облако</pre><div id="shopProfilePreview" class="profile-hero shop-profile-preview" hidden><strong>${esc(lookUser)}</strong><p>Предпросмотр профиля</p></div></div><button type="button" class="btn" id="shopPreviewStop">Завершить примерку</button></div>
      <p class="shop-result-count" id="shopResultCount" role="status"></p><div class="shop-grid" id="shopGrid"></div>
      ${wallet.owned.includes("fx_leaves") ? `<section class="pane shop-fx-tune"><h3>Настройка падающих символов</h3><div class="shop-fx-sliders">
        <label class="shop-fx-slider">Размер<input type="range" id="fxScale" min="100" max="130" step="5" value="${Math.round(+(getLook("fx_scale") || "1.1") * 100)}"><span id="fxScaleVal">${Math.round(+(getLook("fx_scale") || "1.1") * 100)}%</span></label>
        <label class="shop-fx-slider">Густота<input type="range" id="fxDens" min="90" max="130" step="5" value="${Math.round(+(getLook("fx_density") || "1") * 100)}"><span id="fxDensVal">${Math.round(+(getLook("fx_density") || "1") * 100)}%</span></label>
      </div></section>` : ""}
      <div class="shop-info-grid"><section class="pane shop-section-meta"><h3>Ещё за капли</h3><div class="stat-list">
        <div class="stat-row"><span class="stat-label">Подсказка «объяснение»</span><span>5 капель</span></div>
        <div class="stat-row"><span class="stat-label">Подсказка «полный ответ»</span><span>15 капель</span></div>
        <div class="stat-row"><span class="stat-label">Вопрос ИИ сверх 3 бесплатных в день</span><span>5 капель</span></div>
        </div><p class="stat-note">Ревью ваших попыток от наставника — всегда бесплатно.</p></section>
        <section class="pane shop-section-meta"><h3>Титулы за обучение</h3><p class="stat-note">Титулы открываются за пройденные темы, опыт и коллекции. Условия и выбор титула — в <a href="#/profile">профиле</a>. Прежние покупки сохраняются.</p></section></div>
      ${setItems.length ? `<section><h2 class="shop-rewards-title">Ваши награды</h2><div class="shop-grid">${setItems.map(([k,title]) => shopItemHtml(k,{title,price:0,kind:k.split('_')[0]})).join("")}</div></section>` : ""}
    </div>`;
    const bindCards = root => {
      root.querySelectorAll('.shop-scene-preview').forEach(canvas=>window.SkyScenes?.preview(canvas,canvas.dataset.scene));
      root.querySelectorAll(".shop-buy").forEach(btn => btn.addEventListener("click", async () => {
        const key = btn.dataset.item, operation = epoch + ":" + key;
        const onShopPage = () => epoch === authEpoch && route === location.hash;
        if ([...shopBuying].some(operation => operation.startsWith(epoch + ":"))) return;
        if (!await confirmShopPurchase(key) || !onShopPage()) return;
        shopBuying.add(operation);
        document.querySelectorAll(".shop-buy").forEach(button => { button.disabled = true; });
        btn.disabled = true;
        btn.textContent = "Покупаем…";
        try {
          const result = await post("/api/shop/buy", {item:btn.dataset.item});
          if (epoch !== authEpoch) return;
          setWallet({drops:result.drops,freezes:result.freezes});
          if (btn.dataset.item !== "freeze") addOwnedItem(btn.dataset.item);
          handleSetsUnlocked(result.sets_unlocked);
          toast(key === "freeze" ? "<b>Заморозка добавлена в запас.</b>" : ['workspace','trial','box','tool'].includes(shopCatalog[key]?.kind)?'<b>Покупка доступна в мастерской.</b>':"<b>Покупка в вашей коллекции!</b><br>Нажмите «Применить», чтобы использовать оформление.");
          if (result.achievement) await loadAchievements();
          if (onShopPage()) restoreShopPreview();
        } catch (error) {
          if (!onShopPage()) return;
          if (error.status === 409 || error.status === 402) await loadWallet();
          toast("<b>" + esc(error.message) + "</b>");
        } finally {
          shopBuying.delete(operation);
          if (onShopPage()) renderShop();
        }
      }));
      root.querySelectorAll(".shop-apply").forEach(btn => btn.addEventListener("click", () => {
        restoreShopPreview();
        const {kind,skin} = btn.dataset;
        if (skin && !wallet.owned.includes(skin)) return;
        setLook(kind,skin || "");
        if (kind === "sky") applySkin(skin);
        else if (kind === "term") applyTermTheme(skin);
        else if (kind === "fx") applyFx(skin);
        else if (kind === "frame") applyFrame(skin);
        else if (kind === "banner") applyBanner(skin);
        else if (kind === "cursor") applyCursor(skin);
        renderShop();
      }));
      root.querySelectorAll(".shop-preview").forEach(btn => btn.addEventListener("click", () => startShopPreview(btn.dataset.kind,btn.dataset.skin)));
    };
    const drawItems = () => {
      const items = selectShopItems(catalog, shopFilter, shopQuery, shopSort, shopAffordable);
      $("shopResultCount").textContent = `Найдено: ${items.length} из ${catalog.length}`;
      $("shopGrid").innerHTML = items.length ? items.map(([k,i]) => shopItemHtml(k,i)).join("")
        : `<div class="pane shop-empty"><h3>${shopFilter === "owned" ? "Коллекция начинается с первого предмета" : "Предметы не найдены"}</h3><p>Измените поиск или сбросьте фильтры.${shopAffordable ? ' Можно <a href="#/topics">заработать капли в заданиях</a>.' : ""}</p></div>`;
      bindCards($("shopGrid"));
      document.querySelectorAll(".shop-filter").forEach(btn => btn.setAttribute("aria-pressed",String(btn.dataset.filter === shopFilter)));
    };
    document.querySelectorAll(".shop-filter").forEach(btn => btn.addEventListener("click", () => { shopFilter = btn.dataset.filter; drawItems(); }));
    $("shopSearch").addEventListener("input", event => { shopQuery = event.target.value; drawItems(); });
    $("shopSort").value = shopSort;
    $("shopSort").addEventListener("change", event => { shopSort = event.target.value; drawItems(); });
    $("shopAffordable").addEventListener("change", event => { shopAffordable = event.target.checked; drawItems(); });
    $("shopReset").addEventListener("click", () => {
      shopFilter = "all"; shopQuery = ""; shopSort = "catalog"; shopAffordable = false;
      $("shopSearch").value = ""; $("shopSort").value = "catalog"; $("shopAffordable").checked = false; drawItems();
    });
    $("shopPreviewStop").addEventListener("click", restoreShopPreview);
    drawItems();
    applyBanner(getLook('banner')||'');
    document.querySelectorAll(".shop-rewards-title + .shop-grid").forEach(bindCards);
    const fxScaleEl = $("fxScale");
    const fxDensEl = $("fxDens");
    if (fxScaleEl) {
      const syncScale = () => {
        const v = (+fxScaleEl.value / 100).toFixed(2);
        setLook("fx_scale", v);
        $("fxScaleVal").textContent = fxScaleEl.value + "%";
        if (window.__leavesRespawn) window.__leavesRespawn();
      };
      fxScaleEl.addEventListener("input", syncScale);
    }
    if (fxDensEl) {
      const syncDens = () => {
        const v = (+fxDensEl.value / 100).toFixed(2);
        setLook("fx_density", v);
        $("fxDensVal").textContent = fxDensEl.value + "%";
        if (window.__leavesRespawn) window.__leavesRespawn();
      };
      fxDensEl.addEventListener("input", syncDens);
    }
  }

  /* ── Мини-игры ──────────────────────────────────────────────────────── */
  const gameResultCleanups=[];
  let gameResultsWired=false;
  const GAME_REVIEW={
    blitz:{topic:5,tip:'Проверяйте утверждение по частям: значение выражения, тип результата и сравнение.'},
    order:{topic:0,tip:'Проследите зависимости: значение должно появиться до использования, а отступ определяет блок команд.'},
    match:{topic:0,tip:'Сначала вычислите выражение, затем сопоставьте значение и его запись. Кавычки отличают строку от числа.'},
    trace:{topic:1,tip:'Выписывайте значение после каждой строки. Метод может изменить объект, а присваивание — связать имя с новым значением.'},
    fill:{topic:0,tip:'Сопоставьте действие и запись: оператор, вызов функции и вызов метода оформляются по-разному.'},
  };
  function gameReviewHtml(key,review){
    const examples=review?.mistakes||review||[];
    if(!examples.length)return review?.answers===0?'<p class="stat-note">Раунд завершён без ответов. Можно попробовать снова.</p>':'';
    const help=GAME_REVIEW[key],topic=TOPICS.find(t=>t.id===help.topic);
    return `<section class="game-learning-review"><h3>Что повторить</h3><p>${esc(help.tip)}</p><details><summary>Примеры из раунда (${examples.length})</summary><ol>${examples.map(item=>`<li><pre>${esc(item.prompt)}</pre><p>Ваш ответ</p><pre>${esc(item.chosen)}</pre><p>Верный вариант</p><pre>${esc(item.expected)}</pre></li>`).join('')}</ol></details><a href="#/topic/${help.topic}/theory">${esc(topic?.title||'Повторить основы')}</a></section>`;
  }
  function gameSavedText(entry,result){
    if(result.awarded>0)return `Сохранено. За этот раунд начислено ${result.awarded} капель.`;
    return entry.score===0?'Сохранено. За нулевой счёт капли не начисляются.':`Сохранено. Лимит капель этой игры за ${result.day} уже исчерпан.`;
  }
  function wireGameResults(){
    if(gameResultsWired||!window.GameResults)return;
    gameResultsWired=true;
    window.GameResults.subscribe(event=>{
      if(event.type!=='confirmed'||!window.LearningSession.isCurrent(event.owner))return;
      const meta=GAME_META[event.entry.game];try{meta.setBest(Math.max(meta.best(),event.result.best));}catch{}
      if(event.result.awarded>0){refreshWalletAfterReward();if(!event.result.replayed)flyDrops(event.result.awarded);}
      checkAchievements();
    });
  }
  async function ensureGameResults(){
    if(!window.GameResults){if(!window.CourseAssets?.load)throw new Error('Загрузка недоступна');await window.CourseAssets.load('game-results.js');}
    if(!window.GameResults)throw new Error('Сохранение результатов недоступно');wireGameResults();
  }
  function paintGameSave(text,button,entry){
    const state=window.GameResults.state(entry.id);let message;
    if(state.status==='saved')message=gameSavedText(entry,state.result);
    else if(state.status==='saving')message='Сохраняем результат…';
    else message='Сохранение пока не подтверждено. '+(state.durable?'Счёт сохранён на этом устройстве; можно повторить отправку.':'Копия на устройстве недоступна. Не закрывайте страницу до подтверждения.')+(state.error?' '+state.error:'');
    if(text.textContent!==message)text.textContent=message;
    button.hidden=state.status==='saved';button.setAttribute('aria-disabled',String(state.status==='saving'));
    button.textContent=state.status==='saving'?'Сохраняем…':'Повторить сохранение';
  }
  async function mountGamePending(host,game=null,excluded=()=>null){
    const epoch=authEpoch,hash=location.hash;const active=()=>host.isConnected&&epoch===authEpoch&&hash===location.hash&&!$('appView').hidden;
    host.hidden=true;
    try{await ensureGameResults();}catch{
      if(!active())return;host.hidden=false;host.innerHTML='<p role="alert">Сохранённые на устройстве результаты пока недоступны.</p><button class="btn">Повторить</button>';
      host.querySelector('button').onclick=()=>mountGamePending(host,game,excluded);return;
    }
    if(!active())return;
    host.innerHTML='<p class="game-pending-feedback" role="status" aria-live="polite"></p><details><summary></summary><p class="stat-note">Повтор не начислит награду второй раз. Лимит дня определяется при первом сохранении на сервере.</p><ul class="game-pending-list"></ul></details>';
    const feedback=host.querySelector('.game-pending-feedback'),details=host.querySelector('details'),list=host.querySelector('ul'),rows=new Map();
    const render=event=>{
      if(!active())return;
      if(event?.type==='confirmed'&&window.LearningSession.isCurrent(event.owner)&&(!game||event.entry.game===game)&&event.entry.id!==excluded())feedback.textContent=gameSavedText(event.entry,event.result);
      const pending=window.GameResults.list(game).filter(value=>value.entry.id!==excluded()&&window.GameResults.state(value.entry.id).status!=='saved');
      const records=pending.slice(0,50),ids=new Set(records.map(value=>value.entry.id));
      let restore=false;
      for(const [id,row]of rows)if(!ids.has(id)){restore ||= row.contains(document.activeElement);row.remove();rows.delete(id);}
      for(const {entry} of records){
        let row=rows.get(entry.id);
        if(!row){row=document.createElement('li');row.innerHTML=`<strong>${esc(GAME_META[entry.game].title)} — счёт ${entry.score}</strong><small>${esc(entry.created.slice(0,19).replace('T',' '))} UTC</small><p class="game-save-state" role="status" aria-live="polite"></p><button class="btn" data-game-retry="${entry.id}">Повторить сохранение</button>${gameReviewHtml(entry.game,entry.review)}`;
          row.querySelector('button').onclick=()=>{if(active()&&window.GameResults.state(entry.id).status!=='saving')void window.GameResults.send(entry.id);};rows.set(entry.id,row);list.appendChild(row);}
        paintGameSave(row.querySelector('.game-save-state'),row.querySelector('button'),entry);
      }
      details.hidden=!records.length;details.querySelector('summary').textContent=`Ожидают подтверждения: ${pending.length}${pending.length>50?' (показаны первые 50)':''}`;
      host.hidden=!records.length&&!feedback.textContent;
      if(restore){host.tabIndex=-1;host.focus({preventScroll:true});}
    };
    gameResultCleanups.push(window.GameResults.subscribe(render));render();
  }

  const GAME_META = {
    counterexample: { title: "Контрпример", icon: "x≠", sub: "Найдите вход, на котором функция нарушает условие", practice: true },
    blitz: { title: "Молния", icon: "?!", sub: "Правда или ложь об утверждениях Python", engine: () => window.Blitz,
             rules: ["Верный ответ +1 очко, ошибка −1.", "Очки превращаются в капли (до 30 в день в этой игре)."],
             best: () => blitzBest, setBest: (v) => { blitzBest = v; localStorage.setItem("pycloud:blitzbest", v); } },
    order: { title: "Порядок", icon: "1-2", sub: "Соберите программу из перемешанных строк", engine: () => window.OrderGame,
             rules: ["Кликайте строки в правильном порядке.", "Собранная программа +3 очка.", "Очки — капли (до 30 в день в этой игре)."],
             best: () => orderBest, setBest: (v) => { orderBest = v; localStorage.setItem("pycloud:orderbest", v); } },
    match: { title: "Пары", icon: "<->", sub: "Соедините выражение с его результатом", engine: () => window.MatchGame,
             rules: ["Кликните выражение, затем его значение.", "Пара +1 очко, промах −1.", "Очки — капли (до 30 в день в этой игре)."],
             best: () => matchBest, setBest: (v) => { matchBest = v; localStorage.setItem("pycloud:matchbest", v); } },
    trace: { title: "След", icon: "x=", sub: "Проследите переменную по коротким шагам кода", engine: () => window.TraceGame,
             rules: ["Выберите итоговое значение.", "Верный ответ +1, ошибка −1.", "Очки — капли (до 30 в день в этой игре)."],
             best: () => traceBest, setBest: (v) => { traceBest = v; localStorage.setItem("pycloud:tracebest", v); } },
    fill: { title: "Пробел", icon: "_?", sub: "Выберите нужный оператор или встроенную функцию", engine: () => window.FillGame,
             rules: ["Один правильный вариант из четырёх.", "Верный ответ +1, ошибка −1.", "Очки — капли (до 30 в день в этой игре)."],
             best: () => fillBest, setBest: (v) => { fillBest = v; localStorage.setItem("pycloud:fillbest", v); } },
    riddle: { title: "Загадки", icon: "AI?", sub: "Переписка с ИИ: загадки про Python",
             rules: ["ИИ загадывает до 5 загадок про Python в день.", "Отвечайте буквой A–D или короткой фразой.", "Награда не начисляется — только тренировка.", "Есть офлайн-запас загадок, если ИИ недоступен."],
             best: () => 0, setBest: () => {}, free: true },
  };

  function renderGamesHub() {
    $("taskView").innerHTML = `
    <div class="task-page game-page games-hub-page">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / Мини-игры</div>
      </div>
      <div class="games-hub">
        ${Object.entries(GAME_META).map(([key, g]) => `
          <a class="pane game-hub-card${g.free ? " game-hub-free" : ""}" href="#/game/${key}">
            <span class="game-tile-icon big">${esc(g.icon)}</span>
            <h2>${esc(g.title)}</h2>
            <p>${esc(g.sub)}</p>
            <span class="dash-meta">${g.practice ? "6 карточек · без таймера и капель" : g.free ? "без капель · до 5 загадок в день" : (g.best() ? "рекорд: " + g.best() + " очков" : "ещё не играли")}</span>
            <span class="dash-cta">${g.practice ? "Начать практику →" : g.free ? "Открыть чат →" : "Играть →"}</span>
          </a>`).join("")}
      </div>
      <p class="games-note">За очки — до 30 капель в день в каждой игре. В пяти играх вместе — до 150 капель. У каждой свой дневной лимит.</p>
      <section class="pane game-pending" id="gamePendingHub" hidden></section>
    </div>`;
    void mountGamePending($('gamePendingHub'));
  }

  function renderRiddlePlay() {
    const meta = GAME_META.riddle;
    $("taskView").innerHTML = `
    <div class="task-page game-page">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="#/game">Мини-игры</a> / ${esc(meta.title)}</div>
      </div>
      <div class="pane game-pane riddle-pane">
        <div class="riddle-head">
          <h2 class="game-title">[${esc(meta.icon)}] ${esc(meta.title)}</h2>
          <p class="game-sub">${esc(meta.sub)}</p>
          <p class="riddle-left" id="riddleLeft">Загрузка…</p>
        </div>
        <div class="riddle-log" id="riddleLog" aria-live="polite"></div>
        <form class="riddle-form" id="riddleForm">
          <label class="riddle-answer" for="riddleInput">Ответ на загадку
            <input id="riddleInput" type="text" maxlength="200" autocomplete="off"
                   placeholder="A–D или короткая фраза" disabled>
          </label>
          <button class="btn dark" id="riddleSend" type="submit" disabled>Отправить</button>
        </form>
        <div class="run-row riddle-actions">
          <button class="btn" type="button" id="riddleStart">Начать раунд</button>
          <a class="btn" href="#/game">К играм</a>
        </div>
      </div>
    </div>`;

    const log = $("riddleLog");
    const input = $("riddleInput");
    const send = $("riddleSend");
    const startBtn = $("riddleStart");
    const leftEl = $("riddleLeft");
    let finished = false;

    const addBubble = (role, text) => {
      const div = document.createElement("div");
      div.className = "riddle-msg " + role;
      if (role === "ai") div.innerHTML = renderMd(text);
      else div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    };

    const setLeft = (left, asked, limit) => {
      leftEl.textContent = finished || left <= 0
        ? `Раунд на сегодня закрыт (${limit || 5}/${limit || 5}). Завтра снова.`
        : `Загадано: ${asked || 0} · осталось слотов: ${left}`;
    };

    const enableChat = (on) => {
      input.disabled = !on;
      send.disabled = !on;
      startBtn.disabled = on || finished;
      if (on) input.focus();
    };

    const loadStatus = async () => {
      try {
        const st = await api("/api/riddle/status");
        log.innerHTML = "";
        (st.history || []).forEach((m) => addBubble(m.role === "user" ? "user" : "ai", m.text));
        finished = !!st.finished;
        setLeft(st.left, st.asked, st.limit);
        if ((st.history || []).length && !finished) enableChat(true);
        else if (finished) enableChat(false);
        else {
          enableChat(false);
          startBtn.disabled = false;
        }
      } catch (e) {
        leftEl.textContent = "Не удалось загрузить статус";
      }
    };

    const turn = async (message) => {
      enableChat(false);
      if (message) addBubble("user", message);
      const pending = document.createElement("div");
      pending.className = "riddle-msg ai thinking";
      pending.innerHTML = thinkingHtml("Наставник");
      log.appendChild(pending);
      log.scrollTop = log.scrollHeight;
      try {
        const r = await post("/api/riddle/turn", { message: message || "" });
        pending.remove();
        if (r.reply) addBubble("ai", r.reply);
        finished = !!r.finished;
        setLeft(r.left, (r.limit || 5) - (r.left || 0), r.limit || 5);
        enableChat(!finished);
        if (finished) startBtn.disabled = true;
      } catch (err) {
        pending.classList.remove("thinking");
        pending.textContent = "Ошибка: " + err.message;
        if (String(err.message || "").includes("Формат раунда обновлён")) {
          finished = false;
          enableChat(false);
          startBtn.disabled = false;
        } else {
          enableChat(!finished);
        }
      }
    };

    startBtn.addEventListener("click", () => turn(""));
    $("riddleForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg || finished) return;
      input.value = "";
      turn(msg);
    });
    loadStatus();
  }

  function renderGamePlay(key) {
    if (key === "counterexample") {
      $("taskView").innerHTML = `<div class="task-page game-page"><div class="task-nav"><div class="crumbs"><a href="#/">Главная</a> / <a href="#/game">Мини-игры</a> / Контрпример</div></div><div class="pane game-pane counter-pane" id="counterexampleHost"></div></div>`;
      const root=$('counterexampleHost'),epoch=authEpoch;
      root.innerHTML='<p role="status">Загружаем практику…</p>';
      const active=()=>root.isConnected&&epoch===authEpoch&&location.hash==='#/game/counterexample'&&!$('appView').hidden;
      (async()=>{
        try{
          if(!window.CounterexampleGame?.mount){
            if(!window.CourseAssets?.load)throw new Error('Optional loader unavailable');
            await window.CourseAssets.load('counterexample-game.js');
          }
          if(!active())return;
          if(!window.CounterexampleGame?.mount)throw new Error('Practice unavailable');
          activeGame=window.CounterexampleGame.mount(root);
        }catch(_){
          if(!active())return;
          root.innerHTML='<p role="alert">Не удалось загрузить практику.</p>';
          const retry=document.createElement('button');retry.type='button';retry.id='counterexampleRetry';retry.className='btn';retry.textContent='Попробовать снова';
          retry.addEventListener('click',()=>{if(active())renderGamePlay('counterexample');});root.appendChild(retry);
        }
      })();
      return;
    }
    if (key === "riddle") return renderRiddlePlay();
    if(!window.GameResults){
      const epoch=authEpoch,hash=location.hash,loading=document.createElement('section');loading.className='pane game-loading';loading.innerHTML='<p role="status">Открываем игру…</p>';$('taskView').replaceChildren(loading);
      const active=()=>epoch===authEpoch&&hash===location.hash&&loading.isConnected;
      ensureGameResults().then(()=>{if(active())renderGamePlay(key);}).catch(()=>{if(!active())return;loading.innerHTML='<p role="alert">Не удалось открыть игру.</p><button class="btn" id="gameLoadRetry">Повторить</button>';loading.querySelector('button').onclick=()=>{if(active())renderGamePlay(key);};});return;
    }
    wireGameResults();
    const meta = GAME_META[key];
    const engine = meta.engine();
    activeGame = engine;
    let round = 0,roundEntry=null;const gameEpoch=authEpoch;
    $("taskView").innerHTML = `
    <div class="task-page game-page">
      <div class="task-nav">
        <div class="crumbs"><a href="#/">Главная</a> / <a href="#/game">Мини-игры</a> / ${esc(meta.title)}</div>
      </div>
      <div class="pane game-pane">
        <div id="gameIntro">
          <h2 class="game-title">[${esc(meta.icon)}] ${esc(meta.title)}</h2>
          <p class="game-sub">${esc(meta.sub)} · 60 секунд</p>
          <ul class="game-rules">
            ${meta.rules.map((r) => `<li>${esc(r)}</li>`).join("")}
            <li>Лучший результат на этом устройстве: <b>${meta.best()}</b> очков.</li>
          </ul>
          <button class="btn dark" id="gameStart">Начать раунд</button>
        </div>

        <div id="gameField" hidden>
          <div class="game-hud">
            <span class="game-score">Очки: <b id="gameScore">0</b></span>
            <div class="game-timer"><span id="gameTimerFill"></span></div>
          </div>
          <div id="gameArea"></div>
          <p class="game-flash" id="gameFlash"></p>
        </div>

        <div id="gameOver" hidden>
          <h2 class="game-title">Раунд окончен</h2>
          <p class="game-result" id="gameResult"></p>
          <p id="gameSaveState" class="game-save-state" role="status" aria-live="polite"></p>
          <button class="btn" id="gameSaveRetry" hidden>Повторить сохранение</button>
          <div id="gameLearningReview"></div>
          <div class="run-row">
            <button class="btn dark" id="gameAgain">Ещё раунд</button>
            <a class="btn" href="#/game">К играм</a>
          </div>
        </div>
      </div>
      <section class="pane game-pending" id="gamePendingRound" hidden></section>
    </div>`;

    const gameRoot=$('taskView').firstElementChild;
    const current=()=>gameEpoch===authEpoch&&activeGame===engine&&gameRoot.isConnected&&!$('appView').hidden;
    const paintRound=()=>{if(current()&&roundEntry)paintGameSave($('gameSaveState'),$('gameSaveRetry'),roundEntry);};
    gameResultCleanups.push(window.GameResults.subscribe(paintRound));
    $('gameSaveRetry').onclick=()=>{if(current()&&roundEntry&&window.GameResults.state(roundEntry.id).status!=='saving')void window.GameResults.send(roundEntry.id);};
    void mountGamePending($('gamePendingRound'),key,()=>roundEntry?.id);

    const show = (id) =>
      ["gameIntro", "gameField", "gameOver"].forEach((x) => { $(x).hidden = x !== id; });

    const pulseGame = (kind) => {
      const field = $("gameField");
      if (!field) return;
      field.classList.remove("game-pop-good", "game-pop-bad");
      void field.offsetWidth;
      field.classList.add(kind === "good" ? "game-pop-good" : "game-pop-bad");
    };

    const flash = (ok, textOk = "верно", textBad = "мимо") => {
      const f = $("gameFlash");
      f.textContent = ok ? textOk : textBad;
      f.className = "game-flash " + (ok ? "good" : "bad");
      pulseGame(ok ? "good" : "bad");
    };

    const commonHooks = {
      onScore: (s) => {
        const el = $("gameScore");
        el.textContent = s;
        el.classList.remove("score-bump");
        void el.offsetWidth;
        el.classList.add("score-bump");
      },
      onTick: (left, total) => {
        const fill = $("gameTimerFill");
        if (fill) fill.style.transform = `scaleX(${left / total})`;
        fill?.parentElement?.classList.toggle("urgent", left <= 10);
      },
      onFinish: (score,review) => {
        if(!current())return;
        show("gameOver");
        $('gameResult').textContent=`Ваш счёт: ${score}.`;
        $('gameLearningReview').innerHTML=gameReviewHtml(key,review);
        try {
          roundEntry=window.GameResults.enqueue(key,score,review?.mistakes||[]).entry;paintRound();void window.GameResults.send(roundEntry.id);
        } catch (e) {
          $('gameSaveState').textContent='Не удалось подготовить сохранение. Счёт остаётся на странице. '+e.message;
        }
      },
    };

    function startRound() {
      round++;
      roundEntry=null;window.GameResults.changed();
      show("gameField");
      $("gameScore").textContent = "0";
      $("gameFlash").textContent = "";
      const area = $("gameArea");

      if (key === "blitz") {
        area.innerHTML = `
          <pre class="game-question" id="gameQuestion"></pre>
          <div class="game-actions">
            <button class="btn game-true" id="btnTrue">Правда</button>
            <button class="btn game-false" id="btnFalse">Ложь</button>
          </div>`;
        $("btnTrue").onclick = () => engine.answer(true);
        $("btnFalse").onclick = () => engine.answer(false);
        engine.start({
          ...commonHooks,
          onQuestion: (q) => {
            const el = $("gameQuestion");
            el.textContent = q;
            el.classList.remove("question-enter");
            void el.offsetWidth;
            el.classList.add("question-enter");
          },
          onAnswer: (ok) => flash(ok),
        });
      } else if (key === "order") {
        engine.start({
          ...commonHooks,
          onPuzzle: (shuffledLines, picked, puzzle) => {
            const expectedOutput = String(puzzle.output || "").replace(/\\n/g, "\n");
            area.innerHTML = `
              <div class="order-goal">
                <span class="order-goal-label">что собрать</span>
                <b>${esc(puzzle.goal || "Соберите программу сверху вниз")}</b>
                <span class="order-output-label">ожидаемый вывод</span>
                <code>${esc(expectedOutput)}</code>
              </div>
              <div class="order-built">${picked.map((l, i) => `<pre style="--i:${i}">${esc(l)}</pre>`).join("") || '<span class="order-hint">Нажимайте строки в порядке выполнения программы</span>'}</div>
              <div class="order-pool">
                ${shuffledLines.map((l) => picked.includes(l)
                  ? `<button class="order-line used" disabled><code>${esc(l)}</code></button>`
                  : `<button class="order-line" data-line="${esc(l)}"><code>${esc(l)}</code></button>`).join("")}
              </div>
              <button class="link-btn" id="orderReset">сбросить сборку</button>`;
            area.querySelectorAll(".order-line:not(.used)").forEach((b) =>
              b.addEventListener("click", () => engine.pick(b.dataset.line)));
            const rst = $("orderReset");
            if (rst) rst.addEventListener("click", () => engine.resetPick());
          },
          onSolved: (ok, solution, puzzle) => {
            flash(ok, "собрано! +3", "порядок неверный");
            if (!ok) {
              const expectedOutput = String(puzzle.output || "").replace(/\\n/g, "\n");
              area.innerHTML = `
                <div class="order-goal">
                  <span class="order-goal-label">ожидаемый вывод</span>
                  <code>${esc(expectedOutput)}</code>
                </div>
                <div class="order-built solution">${solution.map((l) => `<pre>${esc(l)}</pre>`).join("")}</div>
                <p class="order-hint">Сравните порядок: обычно первая строка создаёт данные, середина их меняет, последняя печатает результат.</p>`;
            }
          },
        });
      } else if (key === "match") {
        engine.start({
          ...commonHooks,
          onBoard: (left, right, done, sel) => {
            area.innerHTML = `
              <div class="match-board">
                <div class="match-col">${left.map((v) => `
                  <button class="match-cell ${done.has(v.id) ? "done" : ""} ${sel?.id === v.id ? "sel" : ""}" data-side="left" data-id="${v.id}" ${done.has(v.id) ? "disabled" : ""}><code>${esc(v.value)}</code></button>`).join("")}
                </div>
                <div class="match-col">${right.map((v) => `
                  <button class="match-cell ${done.has(v.id) ? "done" : ""} ${sel?.id === v.id ? "sel" : ""}" data-side="right" data-id="${v.id}" ${done.has(v.id) ? "disabled" : ""}><code>${esc(v.value)}</code></button>`).join("")}
                </div>
              </div>`;
            area.querySelectorAll(".match-cell:not(.done)").forEach((b) =>
              b.addEventListener("click", () => engine.pick(b.dataset.side, b.dataset.id)));
          },
          onMatch: (ok) => flash(ok, "пара! +1", "не пара, −1"),
        });
      } else if (key === "trace" || key === "fill") {
        const renderChoices = (item) => {
          if (key === "trace") {
            area.innerHTML = `
              <pre class="game-question trace-code">${esc(item.code)}</pre>
              <p class="game-ask">${esc(item.ask)}</p>
              <div class="game-choices">
                ${item.options.map((o) => `<button class="btn game-choice" data-v="${esc(o)}"><code>${esc(o)}</code></button>`).join("")}
              </div>`;
          } else {
            area.innerHTML = `
              <p class="game-ask">${esc(item.prompt)}</p>
              <div class="game-choices">
                ${item.options.map((o) => `<button class="btn game-choice" data-v="${esc(o)}"><code>${esc(o)}</code></button>`).join("")}
              </div>`;
          }
          area.querySelectorAll(".game-choice").forEach((b) =>
            b.addEventListener("click", () => engine.answer(b.dataset.v)));
        };
        engine.start({
          ...commonHooks,
          onTrace: renderChoices,
          onFill: renderChoices,
          onAnswer: (ok) => flash(ok),
        });
      }
    }

    $("gameStart").addEventListener("click", startRound);
    $("gameAgain").addEventListener("click", startRound);
  }

  /* ── ИИ-панель ──────────────────────────────────────────────────────── */
  const drawer = $("aiDrawer");
  const scrim = $("aiScrim");
  let activeTask = null;
  let aiOpenSeq = 0;
  let aiReturnFocus = null;
  let aiSubmitting = false;

  async function openAI(task) {
    const version = ++aiOpenSeq, epoch = authEpoch, hash = location.hash;
    const view = $("taskView").firstElementChild;
    const active = () => version === aiOpenSeq && epoch === authEpoch && location.hash === hash && view?.isConnected;
    aiReturnFocus = document.activeElement;
    activeTask = task;
    $("aiTaskId").textContent = "Помощник · задание " + task.id;
    $("aiContext").innerHTML =
      `<span class="ctx-id">${task.id}</span> · ${esc(taskTypeLabel(task))}<br>${inline(task.prompt)}`;
    const log = $("aiLog");
    log.textContent = "Загружаю историю…";
    let past=[],historyFailed=false;
    try{past=await AIHelper.history(task.id);if(!Array.isArray(past))throw new Error('Incomplete history');}catch{historyFailed=true;}
    if (!active()) return;
    log.replaceChildren();
    if(historyFailed){
      const text=document.createElement('p'),retry=document.createElement('button');text.textContent='Не удалось загрузить историю. Это не означает, что она пуста.';text.setAttribute('role','alert');retry.className='btn';retry.type='button';retry.textContent='Обновить историю';retry.onclick=()=>openAI(task);log.append(text,retry);
    } else if (past.length) {
      past.forEach((m) => addMsg(m.role, m.text));
    } else {
      const facts = await loadDayFacts();
      if (!active()) return;
      const day = new Date().toISOString().slice(0, 10);
      const greetedKey = "pycloud:ai-fact:" + day;
      let greeted = false;
      try { greeted = localStorage.getItem(greetedKey) === "1"; } catch (_) {}
      if (!greeted) {
        addMsg("ai",
          "Привет! Начнём день с короткого факта про Python:\n\n" +
          "**Факт дня.** " + facts[0] +
          "\n\nСпросите что угодно по заданию " + task.id + " — подскажу направление или разберу по шагам."
        );
        try { localStorage.setItem(greetedKey, "1"); } catch (_) {}
      } else {
        addMsg("ai", "Спросите что угодно по заданию " + task.id + ": подскажу направление или разберу по шагам.");
      }
    }
    drawer.classList.add("open");
    drawer.inert = false;
    drawer.setAttribute("aria-hidden", "false");
    scrim.hidden = false;
    $("aiQuestion").focus();
    paintAIPreferences();
  }
  function closeAI() {
    aiOpenSeq++;
    activeTask = null;
    drawer.classList.remove("open");
    drawer.inert = true;
    drawer.setAttribute("aria-hidden", "true");
    scrim.hidden = true;
    if (aiReturnFocus?.isConnected) aiReturnFocus.focus();
    aiReturnFocus = null;
  }
  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    // ответы ИИ — markdown (экранируется внутри renderMd), реплики ученика — просто текст
    if (role === "ai") div.innerHTML = renderMd(text);
    else div.textContent = text;
    $("aiLog").appendChild(div);
    $("aiLog").scrollTop = $("aiLog").scrollHeight;
    return div;
  }

  /* Контекст ученика для ИИ: краткая сводка прогресса (RAG-передача) */
  function aiContextPayload() {
    const byTopic = {};
    solved.forEach((id) => {
      const t = TOPIC_OF[id];
      if (t) byTopic[t.title] = (byTopic[t.title] || 0) + 1;
    });
    return {
      solved_count: solved.size,
      total: ALL_TASKS.length,
      topics_progress: Object.entries(byTopic).map(([title, n]) => `${title}: ${n}`).slice(0, 20),
    };
  }

  $("aiClose").addEventListener("click", closeAI);
  scrim.addEventListener("click", closeAI);

  $("aiForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("aiQuestion").value.trim();
    if (!q || !activeTask || aiSubmitting) return;
    aiSubmitting=true;paintAIPreferences();
    const epoch = authEpoch, task = activeTask;
    $("aiQuestion").value = "";
    addMsg("user", q);
    const pending = addMsg("ai", "");
    pending.classList.add("thinking");
    pending.innerHTML = thinkingHtml("Наставник");
    try {
      const r = await AIHelper.ask(task, q, aiContextPayload());
      if (epoch !== authEpoch) return;
      if (typeof r.drops === "number") setWallet({ drops: r.drops });
      if (!pending.isConnected || activeTask !== task) return;
      pending.classList.remove("thinking");
      pending.innerHTML = renderMd(r.reply);
      const badge = $("aiEngine");
      if (badge) {
        const tariff = r.cost > 0 ? ` · −${r.cost} капель` : (typeof r.free_left === "number" ? ` · бесплатных сегодня: ${r.free_left}` : "");
        badge.textContent = (r.engine === "opencode" ? "ИИ онлайн" : "офлайн-подсказки") + tariff;
      }
    } catch (err) {
      if (epoch !== authEpoch || !pending.isConnected || activeTask !== task) return;
      pending.classList.remove("thinking");
      const refused=['ai_busy','ai_disabled','ai_unavailable'].includes(err.code)||[400,402,429].includes(err.status);
      pending.textContent = refused?err.message+' Можно повторить отправку.':'Подтверждение ответа не получено. Проверьте историю перед повторной отправкой: запрос мог выполниться.';
      if(refused&&!$('aiQuestion').value)$('aiQuestion').value=q;
      if(!refused){const retry=document.createElement('button');retry.className='btn';retry.type='button';retry.textContent='Проверить историю';retry.onclick=()=>openAI(task);pending.appendChild(retry);}
    } finally {
      if(epoch===authEpoch){aiSubmitting=false;paintAIPreferences();}
    }
    $("aiLog").scrollTop = $("aiLog").scrollHeight;
  });

  /* ── Песочница ──────────────────────────────────────────────────────── */
  const SANDBOX_STARTER = "# Свободная песочница — пробуйте любой код\nprint('Привет, Python!')\n";
  let sandboxDraft = null;
  const sandboxDrawer = $("sandboxDrawer");
  const sandboxScrim = $("sandboxScrim");
  const sandboxEditor = $("sandboxEditor");
  const sandboxOutput = $("sandboxOutput");
  let sandboxReturnFocus = null;

  function openSandbox() {
    if (!lookUser) return;
    if (!sandboxDrawer.classList.contains("open")) sandboxReturnFocus = document.activeElement;
    sandboxDrawer.classList.add("open");
    sandboxDrawer.inert = false;
    sandboxDrawer.setAttribute("aria-hidden", "false");
    sandboxScrim.classList.add("active");
    sandboxEditor.focus();
  }
  function closeSandbox() {
    const focusedInside = sandboxDrawer.contains(document.activeElement);
    sandboxDrawer.classList.remove("open");
    sandboxDrawer.inert = true;
    sandboxDrawer.setAttribute("aria-hidden", "true");
    sandboxScrim.classList.remove("active");
    const target = sandboxReturnFocus;
    sandboxReturnFocus = null;
    if (focusedInside && lookUser && target?.isConnected && !target.closest("[hidden],[inert]")) target.focus();
  }

  /* ── FAB: песочница везде, на задании — наставник ───────────────────── */
  let fabMode = "sandbox";
  let activeTaskRef = null;

  function setFabMentor(task) {
    activeTaskRef = task || null;
    const fab = $("sandboxFab");
    if (!fab) return;
    if (task) {
      fabMode = "mentor";
      fab.classList.add("is-mentor");
      fab.innerHTML = `<span class="fab-icon">✎</span> Наставник`;
      fab.setAttribute("aria-label", "Открыть наставника");
      fab.hidden = false;
      closeSandbox();
    } else {
      fabMode = "sandbox";
      fab.classList.remove("is-mentor");
      fab.innerHTML = `<span class="fab-icon">▷</span> Песочница`;
      fab.setAttribute("aria-label", "Открыть песочницу");
    }
  }

  $("sandboxFab").addEventListener("click", () => {
    if (fabMode === "mentor" && activeTaskRef) openAI(activeTaskRef);
    else openSandbox();
  });
  $("sandboxClose").addEventListener("click", closeSandbox);
  sandboxScrim.addEventListener("click", closeSandbox);

  window.EditorKeys?.bind(sandboxEditor);
  sandboxEditor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $("sandboxRun").click();
    }
  });

  const sandboxTerminal = window.LiveTerminal.create(sandboxOutput);

  $("sandboxReset").addEventListener("click", () => {
    sandboxDraft?.reset();
    sandboxTerminal.clear();
  });

  $("sandboxRun").addEventListener("click", async () => {
    const btn = $("sandboxRun");
    const statusEl = $("sandboxStatus");
    btn.disabled = true;
    try {
      await sandboxTerminal.run(sandboxEditor.value, (s) => { statusEl.textContent = s || ""; });
    } finally {
      statusEl.textContent = "";
      btn.disabled = false;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (successModal && !successModal.hidden) closeSuccessModal();
    else if (sandboxDrawer.classList.contains("open")) closeSandbox();
    else if (drawer.classList.contains("open")) closeAI();
  });

  async function renderUpdates() {
    const host=$('taskView'),epoch=authEpoch;
    host.innerHTML=`<div class="task-page updates-page">
      <div class="task-nav"><div class="crumbs"><a href="#/">Главная</a> / <a href="#/profile">Профиль</a> / Что нового</div></div>
      <header class="updates-heading"><h1>Что нового на платформе</h1></header>
      <p class="empty" role="status">Загружаем историю обновлений…</p></div>`;
    const loading=host.firstElementChild;
    const active=()=>loading.isConnected&&epoch===authEpoch&&location.hash==='#/updates'&&!$('appView').hidden;
    try{
      if(!Array.isArray(window.CHANGELOG)){
        if(!window.CourseAssets?.load)throw new Error('Optional loader unavailable');
        await window.CourseAssets.load('changelog.js');
      }
      if(!active())return;
      if(!Array.isArray(window.CHANGELOG))throw new Error('Updates unavailable');
    }catch(_){
      if(!active())return;
      const status=loading.querySelector('[role=status]');
      status.setAttribute('role','alert');status.textContent='Не удалось загрузить историю обновлений.';
      const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.id='updatesRetry';
      retry.textContent='Попробовать снова';retry.addEventListener('click',renderUpdates);loading.appendChild(retry);
      return;
    }
    // Свежие записи видны сразу, архив (150+ записей) свёрнут — иначе страница в десятки экранов.
    const log = window.CHANGELOG || [], RECENT = 8;
    const relHtml = (list) => list.map(rel => `<section class="pane rel">
        <header class="rel-head"><h2>${esc(rel.title)}</h2><time class="rel-date" datetime="${esc(rel.date)}">${esc(rel.date)}</time></header>
        <ul class="rel-list">${rel.items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>
      </section>`).join("");
    $("taskView").innerHTML = `<div class="task-page updates-page">
      <div class="task-nav"><div class="crumbs"><a href="#/">Главная</a> / <a href="#/profile">Профиль</a> / Что нового</div></div>
      <header class="updates-heading"><h1>Что нового на платформе</h1></header>
      ${relHtml(log.slice(0, RECENT)) || '<p class="empty">Обновлений пока нет.</p>'}
      ${log.length > RECENT ? `<details class="rel-archive">
        <summary class="btn">Более ранние обновления (${log.length - RECENT})</summary>
        ${relHtml(log.slice(RECENT))}
      </details>` : ""}
    </div>`;
  }

  /* ── Небо темнеет при скролле (rAF-pump; без window.scroll — контракт тестов) ─ */
  (function initSkyScrollDarken() {
    const sky = document.querySelector(".sky-bg");
    if (!sky) return;
    let lastEase = -1;
    function updateSkyScroll() {
      const root = document.scrollingElement || document.documentElement;
      const rawMax = root.scrollHeight - root.clientHeight;
      // На коротких страницах (квесты и т.п.) пара пикселей overflow давала «ночь» от лёгкого скролла
      const minScroll = Math.max(160, Math.round(root.clientHeight * 0.28));
      let p = 0;
      let ease = 0;
      if (rawMax >= minScroll) {
        // Distance from the top, not page length: expanding content cannot brighten the sky.
        const darkDistance = Math.max(600, root.clientHeight * 1.6);
        p = Math.min(1, Math.max(0, root.scrollTop / darkDistance));
        // Полная чернота после примерно 1.2 высоты экрана.
        ease = Math.min(1, Math.pow(Math.min(1, p / 0.75), 1.05));
      }
      if (Math.abs(ease - lastEase) < 0.0015) return;
      lastEase = ease;
      sky.style.setProperty("--scroll-p", p.toFixed(4));
      sky.style.setProperty("--scroll-ease", ease.toFixed(4));
    }
    function skyScrollPump() {
      updateSkyScroll();
      requestAnimationFrame(skyScrollPump);
    }
    window.addEventListener("resize", () => { lastEase = -1; updateSkyScroll(); });
    window.addEventListener("hashchange", () => { lastEase = -1; updateSkyScroll(); });
    requestAnimationFrame(skyScrollPump);
  })();

  /* ── Падающие символы (веб-версия Overlay_leaves glyphs) ────────────── */
  (function initLeavesFx() {
    const canvas = $("skyFxLeaves");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    // те же глифы, что в Overlay_leaves (ParticleSystem.cpp)
    const GLYPHS = "*+x/\\<>~^.,'`%";
    const PALETTES = {
      "": [[168, 190, 255], [120, 150, 230], [210, 222, 255], [140, 170, 240]],
      sky_dawn: [[255, 176, 140], [240, 148, 118], [255, 210, 178], [220, 130, 110]],
      sky_sunset: [[255, 140, 90], [220, 100, 100], [190, 90, 140], [255, 170, 120]],
      sky_night: [[110, 130, 200], [80, 100, 170], [150, 165, 220], [90, 110, 180]],
      sky_space: [[170, 150, 255], [110, 130, 220], [210, 190, 255], [140, 120, 220]],
      sky_aurora: [[110, 240, 185], [130, 190, 255], [200, 145, 255], [150, 220, 210]],
      sky_storm: [[150, 170, 200], [95, 115, 150], [190, 200, 220], [120, 140, 170]],
    };
    const CURSOR_R = 150;
    const REACTION = 1.35;
    const REPULSION = 520;
    const VORTEX = 200;
    const WAKE = 280;
    let particles = [];
    let running = false;
    let rafId = 0;
    let lastTs = 0;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const mouse = {
      x: -9999, y: -9999, px: -9999, py: -9999,
      vx: 0, vy: 0, svx: 0, svy: 0, ax: 0, ay: 0,
      activity: 0, wake: [],
    };

    function smoothstep(a, b, x) {
      const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
      return t * t * (3 - 2 * t);
    }
    function activePalette() {
      const sky = getLook("sky") || "";
      return PALETTES[sky] || PALETTES[""];
    }
    function symbolCount() {
      const w = window.innerWidth || 1000;
      const dens = Math.min(1.35, Math.max(0.9, +(getLook("fx_density") || "1")));
      let base = 24;
      if (w >= 1100) base = 44;
      else if (w >= 640) base = 35;
      return Math.round(base * dens);
    }
    function symbolScale() {
      return Math.min(1.35, Math.max(0.9, +(getLook("fx_scale") || "1.1")));
    }
    function spawn(fromTop) {
      const pal = activePalette();
      const c = pal[(Math.random() * pal.length) | 0];
      const sc = symbolScale();
      return {
        x: Math.random() * W,
        y: fromTop ? -20 - Math.random() * 80 : Math.random() * H * 0.9,
        vx: (Math.random() - 0.5) * 28,
        vy: 14 + Math.random() * 36,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 2.2,
        size: (12 + Math.random() * 13) * sc,
        alpha: 0.28 + Math.random() * 0.32,
        phase: Math.random() * Math.PI * 2,
        mass: 0.75 + Math.random() * 0.5,
        drag: 0.8 + Math.random() * 0.5,
        glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        color: c,
      };
    }
    function recolor() {
      const pal = activePalette();
      particles.forEach((p) => { p.color = pal[(Math.random() * pal.length) | 0]; });
    }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth || 1;
      H = window.innerHeight || 1;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = symbolCount();
      if (particles.length !== n) {
        particles = Array.from({ length: n }, () => spawn(false));
      }
    }
    function updateMouse(dt) {
      const dx = mouse.x - mouse.px;
      const dy = mouse.y - mouse.py;
      const dist = Math.hypot(dx, dy);
      let ivx = dx / Math.max(dt, 1e-3);
      let ivy = dy / Math.max(dt, 1e-3);
      const spd = Math.hypot(ivx, ivy);
      if (spd > 4000) {
        ivx = (ivx / spd) * 4000;
        ivy = (ivy / spd) * 4000;
      }
      mouse.ax = (ivx - mouse.vx) / Math.max(dt, 1e-3);
      mouse.ay = (ivy - mouse.vy) / Math.max(dt, 1e-3);
      mouse.vx = ivx;
      mouse.vy = ivy;
      const k = 1 - Math.exp(-8 * dt);
      mouse.svx += (mouse.vx - mouse.svx) * k;
      mouse.svy += (mouse.vy - mouse.svy) * k;
      if (dist > 0.5) {
        const targetAct = Math.min(1, Math.hypot(mouse.svx, mouse.svy) / 900);
        mouse.activity += (targetAct - mouse.activity) * (1 - Math.exp(-10 * dt));
        mouse.wake.unshift({ x: mouse.x, y: mouse.y, vx: mouse.svx, vy: mouse.svy, t: 0 });
        if (mouse.wake.length > 20) mouse.wake.length = 20;
      } else {
        mouse.activity *= Math.exp(-3.5 * dt);
        mouse.svx *= Math.exp(-4 * dt);
        mouse.svy *= Math.exp(-4 * dt);
      }
      for (const w of mouse.wake) w.t += dt;
      while (mouse.wake.length && mouse.wake[mouse.wake.length - 1].t > 0.35) mouse.wake.pop();
      mouse.px = mouse.x;
      mouse.py = mouse.y;
    }
    function sampleForce(px, py) {
      let fx = 0;
      let fy = 0;
      const dx = px - mouse.x;
      const dy = py - mouse.y;
      const dist = Math.hypot(dx, dy);
      if (dist < CURSOR_R * 2.5 && dist > 0.001) {
        const t = Math.min(1, dist / CURSOR_R);
        const falloff = 1 - smoothstep(0, 1, t);
        const inv = 1 / dist;
        const dirx = dx * inv;
        const diry = dy * inv;
        const tx = -diry;
        const ty = dirx;
        const speed = Math.hypot(mouse.svx, mouse.svy);
        const gust = Math.min(2.5, speed / 700);
        const nsp = speed > 1 ? 1 / speed : 0;
        fx += mouse.svx * nsp * (WAKE * 0.35 * gust * falloff * REACTION);
        fy += mouse.svy * nsp * (WAKE * 0.35 * gust * falloff * REACTION);
        const near = 1 - smoothstep(0, 0.55, t);
        fx += dirx * (REPULSION * near * REACTION);
        fy += diry * (REPULSION * near * REACTION);
        const vortexMask = smoothstep(0.15, 0.55, t) * (1 - smoothstep(0.55, 1, t));
        fx += tx * (VORTEX * vortexMask * (0.35 + gust) * REACTION);
        fy += ty * (VORTEX * vortexMask * (0.35 + gust) * REACTION);
        const accelMag = Math.min(1.5, Math.hypot(mouse.ax, mouse.ay) / 4000);
        fx += diry * (accelMag * 140 * falloff * REACTION);
        fy += -dirx * (accelMag * 140 * falloff * REACTION);
      }
      for (const w of mouse.wake) {
        const ddx = px - w.x;
        const ddy = py - w.y;
        const dLen = Math.hypot(ddx, ddy);
        const wakeR = CURSOR_R * 0.85;
        if (dLen >= wakeR || dLen < 0.001) continue;
        const age = Math.min(1, w.t / 0.35);
        const fall = (1 - smoothstep(0, 1, dLen / wakeR)) * (1 - age);
        const wsp = Math.hypot(w.vx, w.vy);
        if (wsp < 1) continue;
        fx += (w.vx / wsp) * (WAKE * fall * REACTION * 0.45);
        fy += (w.vy / wsp) * (WAKE * fall * REACTION * 0.45);
      }
      const act = 0.25 + 0.75 * mouse.activity;
      return { fx: fx * act, fy: fy * act };
    }
    function drawGlyph(p) {
      const [r, g, b] = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.font = `600 ${p.size}px ui-monospace, "Cascadia Code", Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.glyph, 0, 0);
      ctx.restore();
    }
    function symbolTick(ts) {
      if (!running) return;
      const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
      lastTs = ts;
      updateMouse(dt);
      ctx.clearRect(0, 0, W, H);
      const time = ts * 0.001;
      for (const p of particles) {
        const force = sampleForce(p.x, p.y);
        let ax = force.fx * p.mass;
        let ay = 55 * p.mass + force.fy * p.mass;
        ax += Math.sin(time * 1.7 + p.phase) * 10;
        ay += Math.cos(time * 1.1 + p.phase * 0.7) * 3;
        p.vx += ax * dt;
        p.vy += ay * dt;
        const drag = Math.exp(-1.35 * p.drag * dt);
        p.vx *= drag;
        p.vy *= drag;
        const spd = Math.hypot(p.vx, p.vy);
        if (spd > 520) {
          p.vx = (p.vx / spd) * 520;
          p.vy = (p.vy / spd) * 520;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.spin += Math.sin(time + p.phase) * 0.4 * dt;
        p.spin = Math.max(-3.5, Math.min(3.5, p.spin));
        p.rot += p.spin * dt;
        if (p.y > H + 40 || p.x < -80 || p.x > W + 80) {
          Object.assign(p, spawn(true));
        }
        drawGlyph(p);
      }
      rafId = requestAnimationFrame(symbolTick);
    }
    function start() {
      if (running || reduced.matches) return;
      running = true;
      resize();
      lastTs = 0;
      rafId = requestAnimationFrame(symbolTick);
    }
    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      ctx.clearRect(0, 0, W, H);
    }
    function sync(on) {
      if (on && !reduced.matches) start();
      else stop();
    }
    window.__leavesSync = sync;
    window.__leavesRecolor = recolor;
    window.__leavesRespawn = () => { if (running) { particles = []; resize(); } };
    window.addEventListener("resize", () => { if (running) resize(); });
    // слушаем на document — курсор над UI тоже двигает символы
    document.addEventListener("pointermove", (e) => {
      if (!running) return;
      if (mouse.x < -9000) {
        mouse.x = mouse.px = e.clientX;
        mouse.y = mouse.py = e.clientY;
        return;
      }
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });
    document.addEventListener("pointerleave", () => {
      mouse.activity *= 0.3;
    }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        lastTs = 0;
      } else if (running) {
        rafId = requestAnimationFrame(symbolTick);
      }
    });
    reduced.addEventListener("change", () => {
      sync(document.body.classList.contains("fx-leaves"));
    });
    sync(document.body.classList.contains("fx-leaves"));
  })();

  /* ── Старт ──────────────────────────────────────────────────────────── */
  window.LearningSession?.onInvalid((message,details) => {
    solved = new Set();
    serverXp = null;
    kickToAuth();
    if(details?.deleted){$('listView').replaceChildren();showLoginForm('',message);$('authError').textContent='';}
    else $("authError").textContent = message;
  });
  $("footCount").textContent = TOPICS.length + " тем · " + ALL_TASKS.length + " заданий";
  // счётчик на экране входа всегда актуален
  const authSub = document.querySelector(".auth-sub");
  if (authSub) authSub.textContent =
    `Практика Python: ${ALL_TASKS.length} заданий от простого к сложному, встроенный запуск кода и личный ИИ-помощник.`;
  (async () => {
    try {
      const me = await api("/api/me");
      await enterApp(me.username);
    } catch (e) {
      $("authView").hidden = false;
    }
  })();
})();
