/* Optional topic catalogue view. Content, ordering and progress belong to app.js. */
window.TopicMap = (() => {
  let cleanup = () => {};
  const tones = {
    demo: { tint: ".82 .91 1", accent: "#bbdfff", label: "Пример" },
    question: { tint: ".9 .82 1", accent: "#ddc5ff", label: "Вопрос" },
    code: { tint: ".78 1 .89", accent: "#b5efd0", label: "Код" },
    debug: { tint: "1 .84 .73", accent: "#ffd1b8", label: "Отладка" },
    finale: { tint: "1 .9 .67", accent: "#ffe3a0", label: "Финал" },
  };
  function destroy() {
    cleanup(); cleanup = () => {}; CloudModels.detach();
    document.body.classList.remove("cloud-map-mode");
  }
  const layout = (index, columns) => {
    const row = Math.floor(index / columns);
    const column = row % 2 ? columns - 1 - index % columns : index % columns;
    const drift = [-2, 2, -1, 1, -3, 2][index % 6];
    return {
      x: (columns === 3 ? [18, 50, 82][column] : [24, 76][column]) + drift * (columns === 3 ? 1 : .4),
      y: (columns === 3 ? 410 : 340) + row * (columns === 3 ? 300 : 260) + [0, 26, -8, 18, -4, 12][index % 6], column,
    };
  };
  const pathFor = (count, columns) => {
    const points = [{ x: 50, y: columns === 3 ? 185 : 115 }, ...Array.from({ length: count }, (_, i) => layout(i, columns))];
    return points.map((point, i) => {
      if (!i) return `M${point.x * 10} ${point.y}`;
      const prev = points[i - 1];
      const dx = (point.x - prev.x) * 10;
      return `C${prev.x * 10 + dx * .45} ${prev.y + 55} ${point.x * 10 - dx * .45} ${point.y - 55} ${point.x * 10} ${point.y}`;
    }).join(" ");
  };

  function render(host, { topics, topicId, nextTopic, solved, title, goal, typeLabel = task => task.type, profileHtml = () => "", esc, pointsFor, learningHref, onTopic, onNext, arrive = false, motion = true, onMotion, searchMatches = null }) {
    destroy();
    document.body.classList.add("cloud-map-mode");
    const topic = topics.find(t => t.id === topicId) || topics[0];
    const topicIndex = topics.indexOf(topic);
    const current = topic.tasks.find(t => !solved.has(t.id));
    const done = topic.tasks.filter(t => solved.has(t.id)).length;
    const lastY = columns => Math.max(...topic.tasks.map((_, i) => layout(i, columns).y));
    const horizonY = columns => lastY(columns) + 290;
    const height = columns => nextTopic ? horizonY(columns) + 130 : lastY(columns) + 160;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const plain = html => {
      const text = document.createElement("div");
      text.innerHTML = html;
      return text.textContent.replace(/`/g, "").replace(/\s+/g, " ").trim();
    };
    const route = columns => {
      const last = layout(topic.tasks.length - 1, columns);
      const mid = (last.y + horizonY(columns)) / 2;
      return `<svg class="cloud-route cloud-route-${columns}" viewBox="0 0 1000 ${height(columns)}" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id="cloud-arrow-${columns}" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto"><polyline points="3,2 9,6 3,10"/></marker></defs>
        <path d="${pathFor(topic.tasks.length, columns)}"/>
        ${nextTopic ? `<path class="cloud-route-next" marker-mid="url(#cloud-arrow-${columns})" marker-end="url(#cloud-arrow-${columns})" d="M${last.x * 10} ${last.y + 120} Q${last.x * 10} ${mid - 10} ${(last.x * 10 + 500) / 2} ${mid + 25} T500 ${horizonY(columns) - 65}"/>` : ""}
      </svg>`;
    };
    const rewards = topic.tasks.map(pointsFor);
    const lowestReward = Math.min(...rewards), rewardRange = Math.max(...rewards) - lowestReward || 1;
    const stops = topic.tasks.map((task, i) => {
      const desktop = layout(i, 3), mobile = layout(i, 2);
      const state = solved.has(task.id) ? "done" : task === current ? "current" : "open";
      const label = state === "done" ? "Решено" : state === "current" ? "Следующий шаг" : "Можно попробовать";
      const taskTitle = plain(title(task));
      const lesson = plain(goal(task, topic, i));
      const variant = (i + topic.id) % 6;
      const reward = pointsFor(task);
      const weight = (reward - lowestReward) / rewardRange;
      const kind = task.finale ? "finale" : task.type === "демо" ? "demo" : task.type === "исправить ошибку" ? "debug" : ["написать функцию", "дописать код"].includes(task.type) ? "code" : "question";
      const tone = tones[kind];
      return `<li class="cloud-stop cloud-${state} ${searchMatches?.includes(task.id) ? "cloud-search-match" : ""} cloud-col-${desktop.column} cloud-mobile-${mobile.column} ${desktop.y > lastY(3) - 100 ? "cloud-last-row" : ""} ${mobile.y > lastY(2) - 100 ? "cloud-mobile-last-row" : ""}" data-cloud-kind="${kind}" data-cloud-tint="${tone.tint}" style="--cloud-accent:${tone.accent};--stop-x:${desktop.x}%;--stop-y:${desktop.y}px;--stop-mobile-x:${mobile.x}%;--stop-mobile-y:${mobile.y}px;--cloud-size:${.72 + weight * .60};--depth:${[.8, .15, 1, .4, .65, .25][i % 6]};--drift-time:${10 + i % 4 * 2}s;--drift-delay:-${i * 1.7}s">
        <button class="cloud-task" type="button" data-cloud-task="${task.id}" aria-expanded="false" aria-haspopup="dialog" aria-controls="cloudDetail" aria-describedby="cloud-peek-${task.id}" aria-label="${esc(task.id + '. ' + taskTitle + '. ' + label + '. ' + reward + ' XP')}" ${state === "current" ? 'aria-current="step"' : ""}>
          <span class="cloud-volume" aria-hidden="true"><span class="cloud-sprite cloud-sprite-${variant}"></span></span>
          <span class="cloud-number">${esc(task.id)} <small>+${reward} XP</small></span>
          <span class="cloud-mark" aria-hidden="true">${state === "done" ? "✓" : task.finale ? "★" : ""}</span>
          <span class="cloud-caption">${esc(taskTitle)}</span>
        </button>
        <div class="cloud-peek" id="cloud-peek-${task.id}" role="tooltip" hidden>
          <span class="cloud-peek-meta">${esc(typeLabel(task))} · +${reward} XP</span>
          <h3>${esc(taskTitle)}</h3>
          <p>${esc(lesson)}</p>
        </div>
      </li>`;
    }).join("");
    const challenge = window.CHALLENGES?.[topic.id];
    host.innerHTML = `<section class="cloud-map ${motion ? "" : "is-still"}" aria-labelledby="cloudMapTitle">
      <div class="cloud-map-toolbar">
        <div class="cloud-topic-picker"><label for="cloudTopic">Маршрут по теме</label>
          <div><button type="button" class="btn cloud-topic-prev" aria-label="Предыдущая тема" ${topicIndex === 0 ? "disabled" : ""}>←</button>
            <select id="cloudTopic">${topics.map(t => `<option value="${t.id}" ${t === topic ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select>
            <button type="button" class="btn cloud-topic-next" aria-label="Следующая тема" ${topicIndex === topics.length - 1 ? "disabled" : ""}>→</button></div>
        </div>
        <div class="cloud-map-tools">${current ? '<button type="button" class="cloud-jump-current">К текущему заданию</button>' : ''}<button type="button" class="cloud-motion-toggle" aria-pressed="${motion && !reducedMotion.matches}" ${reducedMotion.matches ? 'disabled title="Движение отключено в настройках устройства"' : ""}>Анимация</button></div>
      </div>
      <div class="cloud-map-heading"><h2 id="cloudMapTitle">${esc(topic.title)}</h2>
        <span class="cloud-progress">${done === topic.tasks.length ? "✓ Тема пройдена" : `${done} из ${topic.tasks.length} решено`}</span>
      </div>
      <div class="cloud-map-legend" aria-label="Форматы заданий">${Object.values(tones).map(tone => `<span><i style="background:${tone.accent}"></i>${tone.label}</span>`).join("")}</div>
      ${searchMatches ? `<div class="cloud-search-results"><p role="status">${searchMatches.length ? `Найдено заданий в теме: ${searchMatches.length}` : 'Совпало название темы'}</p>
        ${searchMatches.length ? `<select id="cloudSearchTarget" aria-label="Перейти к найденному заданию"><option value="">Перейти к найденному заданию…</option>${topic.tasks.filter(task => searchMatches.includes(task.id)).map(task => `<option value="${task.id}">${esc(task.id + ' — ' + plain(title(task)))}</option>`).join('')}</select>` : ''}</div>` : ''}
      <div class="cloud-scene-frame"><div class="cloud-scene" style="--map-height:${height(3)}px;--map-mobile-height:${height(2)}px">
        ${route(3)}${route(2)}
        <div class="cloud-landmark cloud-theory" data-cloud-tint=".85 .94 1" style="--stop-x:50%;--stop-y:185px;--stop-mobile-x:50%;--stop-mobile-y:115px;--cloud-size:1;--depth:.65">
          <a class="cloud-link" href="#/topic/${topic.id}/theory"><span class="cloud-volume" aria-hidden="true"><span class="cloud-sprite cloud-sprite-1"></span></span><span class="cloud-landmark-title">Читать теорию темы</span></a>
        </div>
        <ol class="cloud-stops" aria-label="Задания темы ${esc(topic.title)}">${stops}</ol>
        ${nextTopic ? `<div class="cloud-landmark cloud-horizon" data-cloud-tint=".71 .84 1" style="--stop-x:50%;--stop-y:${horizonY(3)}px;--stop-mobile-x:50%;--stop-mobile-y:${horizonY(2)}px;--cloud-size:.86;--depth:.12">
          <button class="cloud-link cloud-next-topic" type="button" data-next-topic="${nextTopic.id}" aria-label="${esc('Следующая тема: ' + nextTopic.title)}"><span class="cloud-volume" aria-hidden="true"><span class="cloud-sprite cloud-sprite-3"></span></span><span class="cloud-landmark-title"><small>Следующая тема</small>${esc(nextTopic.title)} <span aria-hidden="true">↗</span></span></button>
        </div>` : ""}
      </div></div>
      <div class="cloud-map-footer">
        ${current ? `<a class="btn dark" href="${learningHref(current)}">Продолжить обучение</a>` : ""}
        ${challenge ? `<a class="cloud-bonus" href="#/task/${challenge.id}">Дополнительный челлендж${solved.has(challenge.id) ? " ✓" : ""}</a>` : ""}
      </div>
      <dialog id="cloudDetail" class="cloud-detail" aria-labelledby="cloudDetailTitle">
        <button type="button" class="cloud-detail-close" aria-label="Закрыть описание этапа" autofocus>×</button>
        <span class="cloud-peek-meta" id="cloudDetailMeta"></span>
        <h2 id="cloudDetailTitle"></h2><p id="cloudDetailGoal"></p>
        <div id="cloudDetailLearning" hidden></div>
        <p class="cloud-detail-note">XP за первое решение. Повторение без начисления опыта.</p>
        <a class="btn dark" id="cloudDetailLink">К заданию</a>
      </dialog>
    </section>`;

    const picker = host.querySelector("#cloudTopic");
    const map = host.querySelector(".cloud-map");
    const scene = host.querySelector(".cloud-scene");
    const motionButton = host.querySelector(".cloud-motion-toggle");
    const dialog = host.querySelector(".cloud-detail");
    let flight = null, disposed = false;
    if (arrive && motion && !reducedMotion.matches) {
      flight = scene.animate([{ opacity: 0, transform: "scale(.9)", filter: "blur(3px)" }, { opacity: 1, transform: "none", filter: "none" }], { duration: 420, easing: "ease-out" });
    }
    host.querySelector(".cloud-next-topic")?.addEventListener("click", async event => {
      if (scene.inert) return;
      close();
      if (motion && !reducedMotion.matches) {
        const stop = event.currentTarget.parentElement;
        scene.style.transformOrigin = `${stop.offsetLeft}px ${stop.offsetTop}px`;
        scene.inert = true;
        map.style.overflow = "clip";
        map.setAttribute("aria-busy", "true");
        flight = scene.animate([
          { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
          { transform: "scale(1.8)", opacity: .7, filter: "blur(1px)", offset: .7 },
          { transform: "scale(3.2)", opacity: 0, filter: "blur(5px)" },
        ], { duration: 720, easing: "cubic-bezier(.45,0,.7,1)", fill: "forwards" });
        try { await flight.finished; } catch (_) { return; }
      }
      if (!disposed) onNext();
    });
    CloudModels.attach(scene, topic.id, motion && !reducedMotion.matches);
    function syncMotion() {
      const enabled = motion && !reducedMotion.matches;
      map.classList.toggle("is-still", !enabled);
      motionButton.setAttribute("aria-pressed", String(enabled));
      motionButton.disabled = reducedMotion.matches;
      CloudModels.motion(enabled);
      if (!enabled && flight?.playState === "running") flight.finish();
    }
    reducedMotion.addEventListener("change", syncMotion);
    function focusTask(id) {
      const target = [...host.querySelectorAll(".cloud-task")].find(button => button.dataset.cloudTask === id);
      if (!target || scene.inert) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: motion && !reducedMotion.matches ? "smooth" : "instant" });
    }
    host.querySelector(".cloud-jump-current")?.addEventListener("click", () => focusTask(current.id));
    host.querySelector("#cloudSearchTarget")?.addEventListener("change", event => focusTask(event.target.value));
    motionButton.addEventListener("click", () => {
      motion = !motion;
      syncMotion();
      onMotion?.(motion);
    });
    let frame = 0;
    scene.addEventListener("pointermove", event => {
      if (event.pointerType !== "mouse" || reducedMotion.matches || !motion || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!scene.isConnected) return;
        const rect = scene.getBoundingClientRect();
        CloudModels.pan((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
        scene.style.setProperty("--pan-x", `${(event.clientX - rect.left - rect.width / 2) / rect.width * 16}px`);
        scene.style.setProperty("--pan-y", `${(event.clientY - rect.top - rect.height / 2) / rect.height * 10}px`);
      });
    });
    scene.addEventListener("pointerleave", () => {
      cancelAnimationFrame(frame);
      frame = 0;
      CloudModels.pan(0, 0);
      scene.style.setProperty("--pan-x", "0px");
      scene.style.setProperty("--pan-y", "0px");
    });
    picker.addEventListener("change", () => onTopic(Number(picker.value), "#cloudTopic"));
    host.querySelector(".cloud-topic-prev").addEventListener("click", () => onTopic(topics[topicIndex - 1].id, ".cloud-topic-prev"));
    host.querySelector(".cloud-topic-next").addEventListener("click", () => onTopic(topics[topicIndex + 1].id, ".cloud-topic-next"));
    let active = null;
    let selected = null;
    let dismissed = null;
    function close() {
      if (!active) return;
      active.querySelector(".cloud-peek").hidden = true;
      active.querySelector("button").setAttribute("aria-expanded", "false");
      active.classList.remove("peek-open");
      active = null;
    }
    function open(stop) {
      if (dialog.open || dismissed === stop) return;
      if (active === stop) return;
      close();
      active = stop;
      stop.querySelector(".cloud-peek").hidden = false;
      stop.classList.add("peek-open");
    }
    host.querySelectorAll(".cloud-stop").forEach(stop => {
      stop.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") open(stop); });
      stop.addEventListener("pointerleave", () => {
        if (dismissed === stop) dismissed = null;
        if (active === stop && !stop.contains(document.activeElement)) close();
      });
      stop.addEventListener("focusin", () => open(stop));
      stop.addEventListener("focusout", event => {
        if (!stop.contains(event.relatedTarget)) {
          if (dismissed === stop) dismissed = null;
          if (active === stop) close();
        }
      });
      const button = stop.querySelector("button");
      button.addEventListener("click", () => {
        close();
        selected = stop;
        const task = topic.tasks.find(t => t.id === button.dataset.cloudTask);
        host.querySelector("#cloudDetailMeta").textContent = `${task.id} · ${typeLabel(task)} · +${pointsFor(task)} XP${solved.has(task.id) ? ' · Решено' : ''}`;
        host.querySelector("#cloudDetailTitle").textContent = plain(title(task));
        host.querySelector("#cloudDetailGoal").textContent = plain(goal(task, topic, topic.tasks.indexOf(task)));
        const profile = host.querySelector("#cloudDetailLearning");
        profile.innerHTML = profileHtml(task);
        profile.hidden = !profile.innerHTML;
        const link = host.querySelector("#cloudDetailLink");
        link.href = `#/task/${task.id}`;
        link.textContent = solved.has(task.id) ? "Повторить задание" : "К заданию";
        dialog.showModal();
        stop.classList.add("detail-open");
        button.setAttribute("aria-expanded", "true");
      });
      button.addEventListener("pointerdown", event => {
        stop.classList.add("cloud-pressed");
        button.setPointerCapture(event.pointerId);
      });
      ["pointerup", "pointercancel", "lostpointercapture", "blur"].forEach(type =>
        button.addEventListener(type, () => stop.classList.remove("cloud-pressed")));
      button.addEventListener("keydown", event => {
        if (event.key === " " || event.key === "Enter") stop.classList.add("cloud-pressed");
      });
      button.addEventListener("keyup", () => stop.classList.remove("cloud-pressed"));
    });
    dialog.querySelector("button").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    } });
    dialog.addEventListener("close", () => {
      dismissed = selected;
      selected?.classList.remove("detail-open");
      selected?.querySelector("button").setAttribute("aria-expanded", "false");
      selected = null;
      close();
    });
    host.addEventListener("keydown", event => {
      if (event.key === "Escape" && active) {
        dismissed = active;
        const button = active.querySelector("button");
        button.focus({ preventScroll: true });
        close();
        event.preventDefault();
      }
    });
    host.addEventListener("pointerdown", event => { if (!event.target.closest(".cloud-stop")) close(); });
    cleanup = () => {
      disposed = true;
      flight?.cancel();
      if (dialog.open) dialog.close();
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener("change", syncMotion);
    };
  }
  return { render, destroy };
})();
