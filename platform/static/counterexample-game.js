/* Untimed local practice. Authored results only: no Python, API, storage or rewards. */
window.CounterexampleGame = (() => {
  const bank = Object.freeze((window.COUNTEREXAMPLE_QUESTIONS || []).map(question => Object.freeze({
    ...question, choices: Object.freeze(question.choices.map(choice => Object.freeze({ ...choice }))),
  })));
  const breaks = choice => choice.error || choice.actual !== choice.expected;
  const shuffle = (items, random) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  function createRound(questions = bank, random = Math.random) {
    let phase = "intro", deck = [], options = [], position = 0, selected = null, answers = [];
    const state = () => Object.freeze({ phase, position, total: deck.length, selected,
      question: deck[position] || null, options: Object.freeze([...options]),
      answers: Object.freeze(answers.map(answer => Object.freeze({ ...answer }))),
      correct: answers.filter(answer => answer.correct).length });
    function start() {
      if (phase === "closed" || !questions.length) return false;
      deck = shuffle(questions, random).slice(0, 6);
      position = 0; selected = null; answers = []; phase = "question";
      options = shuffle(deck[0].choices, random);
      return true;
    }
    function answer(index) {
      if (phase !== "question" || !Number.isInteger(index) || index < 0 || index >= options.length) return false;
      selected = index; phase = "review";
      answers.push({ id: deck[position].id, title: deck[position].title, correct: breaks(options[index]) });
      return true;
    }
    function next() {
      if (phase !== "review") return false;
      position++; selected = null;
      if (position === deck.length) { phase = "summary"; options = []; }
      else { phase = "question"; options = shuffle(deck[position].choices, random); }
      return true;
    }
    return Object.freeze({ state, start, answer, next, stop() { phase = "closed"; } });
  }
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
  const resultHtml = choice => `<dl class="counter-results">
    <div><dt>${choice.error ? "Программа остановилась" : "Функция вернула"}</dt><dd><code>${escape(choice.actual)}</code></dd></div>
    <div><dt>По условию нужно</dt><dd><code>${escape(choice.expected)}</code></dd></div>
  </dl>`;
  function mount(root, { random = Math.random } = {}) {
    const model = createRound(bank, random);
    function render(focus = false) {
      const state = model.state();
      if (state.phase === "closed") return;
      if (state.phase === "intro") {
        root.innerHTML = `<div class="counter-intro">
          <p class="counter-kicker">Тренируем проверку гипотез</p>
          <h2 id="counterHeading" tabindex="-1">Контрпример</h2>
          <p>Найдите вход, на котором функция нарушает условие. Один такой вход доказывает ошибку; несколько удачных примеров ещё не доказывают правильность.</p>
          <ul class="game-rules"><li>6 карточек за раунд, в каждой — один подходящий вход из четырёх.</li>
          <li>Выберите один раз, затем сравните результат с условием и прочитайте разбор.</li>
          <li>Без таймера и капель. Можно спокойно обдумывать каждый шаг.</li></ul>
          <button type="button" class="btn dark" data-counter-action="start">Начать практику</button>
        </div>`;
      } else if (state.phase === "summary") {
        root.innerHTML = `<div class="counter-summary">
          <p class="counter-kicker">Раунд завершён</p>
          <h2 id="counterHeading" tabindex="-1">Разобраны все ${state.total} карточек</h2>
          <p>С первого выбора: <strong>${state.correct} из ${state.total}</strong>.</p>
          <ul class="counter-summary-list">${state.answers.map(answer => `<li><span>${escape(answer.title)}</span><b>${answer.correct ? "Найден" : "Разобран"}</b></li>`).join("")}</ul>
          <p>В следующем раунде попробуйте сначала искать границы, пустые значения и входы, которые отличаются от привычных примеров.</p>
          <div class="run-row"><button type="button" class="btn dark" data-counter-action="start">Ещё раунд</button><a class="btn" href="#/game">К играм</a></div>
          <p class="stat-note">Личная практика. Результат раунда не сохраняется.</p>
        </div>`;
      } else {
        const question = state.question, review = state.phase === "review";
        const selected = review ? state.options[state.selected] : null;
        const counterexample = question.choices.find(breaks);
        root.innerHTML = `<div class="counter-question">
          <div class="counter-progress"><span>Карточка ${state.position + 1} из ${state.total}</span><span>Без таймера</span></div>
          <progress max="${state.total}" value="${state.position + (review ? 1 : 0)}" aria-label="Разобрано карточек"></progress>
          <h2 id="counterHeading" tabindex="-1">${escape(question.title)}</h2>
          <p class="counter-contract">${escape(question.contract)}</p>
          <pre class="counter-code"><code>${escape(question.code)}</code></pre>
          <h3 id="counterChoiceLabel">Какой вход обнаружит ошибку?</h3>
          <div class="counter-options" role="group" aria-labelledby="counterChoiceLabel">${state.options.map((choice, index) => {
            const chosen = state.selected === index, correct = breaks(choice);
            return `<button type="button" data-counter-action="answer" data-index="${index}"
              class="counter-option${review && correct ? " counter-correct" : ""}${review && chosen && !correct ? " counter-missed" : ""}"
              ${review ? "disabled" : ""} aria-pressed="${chosen}"><code>${escape(choice.call)}</code>
              ${review && (chosen || correct) ? `<span class="counter-badge">${[chosen ? "Ваш выбор" : "", correct ? "Контрпример" : ""].filter(Boolean).join(" · ")}</span>` : ""}</button>`;
          }).join("")}</div>
          ${review ? `<section class="counter-feedback" aria-labelledby="counterFeedbackTitle">
            <h3 id="counterFeedbackTitle" tabindex="-1">${breaks(selected) ? "Контрпример найден" : "Этот вход проходит проверку"}</h3>
            <p>Ваш выбор: <code>${escape(selected.call)}</code></p>${resultHtml(selected)}
            ${!breaks(selected) ? `<div class="counter-found"><p>Ошибка проявляется на <code>${escape(counterexample.call)}</code>:</p>${resultHtml(counterexample)}</div>` : ""}
            <p>${escape(question.explanation)}</p>
            <button type="button" class="btn dark" data-counter-action="next">${state.position + 1 === state.total ? "Итоги раунда" : "Следующая карточка"}</button>
          </section>` : '<p class="stat-note">Сначала выберите вход. Значения и разбор появятся после ответа.</p>'}
        </div>`;
      }
      if (focus) root.querySelector(model.state().phase === "review" ? "#counterFeedbackTitle" : "#counterHeading")?.focus({ preventScroll: false });
    }
    function onClick(event) {
      const button = event.target.closest?.("[data-counter-action]");
      if (!button || !root.contains(button) || button.disabled) return;
      const action = button.dataset.counterAction;
      const accepted = action === "start" ? model.start() : action === "answer"
        ? model.answer(Number(button.dataset.index)) : action === "next" ? model.next() : false;
      if (accepted) render(true);
    }
    root.addEventListener("click", onClick);
    render();
    return Object.freeze({ stop() { model.stop(); root.removeEventListener("click", onClick); } });
  }
  return Object.freeze({ createRound, mount });
})();
