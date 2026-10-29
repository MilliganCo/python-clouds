/* project-courses.js — сквозные проектные курсы поверх обычных тем.
 * Модуль намеренно живёт отдельно от app.js: существующий роутер остаётся
 * источником обычных страниц, а проектные маршруты перехватываются здесь.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const projectRouteRe = /^#\/project\/([a-z0-9_]+)(?:\/([a-z0-9_]+))?$/;
  const isProjectHash = () =>
    location.hash === "#/projects"
    || /^#\/showcase(\/|$)/.test(location.hash)
    || projectRouteRe.test(location.hash);

  let autosaveTimer = null;
  let lastLoadedStage = null;
  let successHref = null;
  let projectReviewSeq = 0;

  const authEpoch = () => window.getLearningAuthEpoch?.() || 0;
  const screenActive = (node, epoch) => node.isConnected && !$('appView').hidden && epoch === authEpoch();

  async function api(path, opts) {
    if (window.LearningSession) return window.LearningSession.json(path, opts);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Ошибка"), { status: res.status });
    return data;
  }

  const post = (path, body) =>
    api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });

  function authFallback(err) {
    if (err?.status !== 401) return false;
    if ($("appView")) $("appView").hidden = true;
    if ($("authView")) $("authView").hidden = false;
    document.body.classList.remove("list-mode", "task-mode");
    return true;
  }

  function activateProjectNav(active, route) {
    const want = route || (active ? "projects" : "");
    document.querySelectorAll(".nav-link").forEach((a) => {
      const r = a.dataset.route;
      if (r === "projects" || r === "showcase") {
        a.classList.toggle("active", active && r === want);
      }
    });
  }

  function showProjectSurface(navRoute) {
    if ($("appView")?.hidden) return false;
    $("listView").hidden = true;
    $("taskView").hidden = false;
    document.body.classList.remove("list-mode");
    document.body.classList.add("task-mode");
    activateProjectNav(true, navRoute || "projects");
    window.scrollTo(0, 0);
    return true;
  }

  function stageHref(courseId, stageId) {
    return `#/project/${courseId}/${stageId}`;
  }

  function courseHref(courseId) {
    return `#/project/${courseId}`;
  }

  const showcaseHref = () => "#/showcase";
  const showcaseNewHref = () => "#/showcase/new";
  const showcaseCardHref = (cardId) => `#/showcase/${cardId}`;

  function parseShowcaseRoute() {
    const hash = location.hash || "";
    if (hash === "#/showcase" || hash === "#/showcase/") return { view: "list" };
    if (hash === "#/showcase/new") return { view: "create" };
    const m = hash.match(/^#\/showcase\/(\d+)$/);
    if (m) return { view: "detail", cardId: Number(m[1]) };
    return null;
  }


  const COURSE_LOOK = {
    chatbot_to_telegram: { emblem: "bot", accent: "cyan", quest_label: "Квест связи", mark: "{ }" },
    text_analyzer: { emblem: "analyzer", accent: "amber", quest_label: "Квест смысла", mark: "Aa" },
    habit_tracker: { emblem: "habits", accent: "mint", quest_label: "Квест ритма", mark: "···" },
    generative_poster: { emblem: "poster", accent: "violet", quest_label: "Квест холста", mark: "#" },
    python_game: { emblem: "game", accent: "coral", quest_label: "Квест игры", mark: "<>" },
  };

  function courseLook(course) {
    const fb = COURSE_LOOK[course.id] || {};
    return {
      emblem: course.emblem || fb.emblem || "bot",
      accent: course.accent || fb.accent || "cyan",
      quest_label: course.quest_label || fb.quest_label || "Проектный квест",
      mark: fb.mark || "·",
    };
  }

  function emblemHtml(course, size = "") {
    const look = courseLook(course);
    const sizeCls = size ? ` project-emblem-${size}` : "";
    return `<div class="project-emblem project-emblem-${esc(look.emblem)}${sizeCls}" aria-hidden="true"><span>${esc(look.mark)}</span></div>`;
  }

  function questMetaHtml(course) {
    if (course.kind === 'local_practice') return '<span class="project-quest-tag">Практика на своём компьютере · самопроверка</span>';
    const look = courseLook(course);
    const order = course.track_order || 0;
    const total = course.track_total || 5;
    return `
      <div class="project-quest-meta">
        <span class="project-track-order">${order}/${total}</span>
        <span class="project-quest-tag">${esc(look.quest_label)}</span>
      </div>`;
  }

  function accentClass(course) {
    return `project-accent-${esc(courseLook(course).accent)}`;
  }

  function statusClass(status) {
    return `project-status project-status-${esc(status || "unknown")}`;
  }

  function courseActionHtml(course) {
    if (course.status === "unavailable") {
      const topics = course.unlock_topic_titles || course.next_stage?.required_topic_titles || [];
      return `<span class="project-lock">Откроется после: ${esc(topics.join(", ") || "нескольких тем")}</span>`;
    }
    if (course.status === "available") {
      return `<button class="btn dark project-start" data-course="${esc(course.id)}">Начать квест</button>`;
    }
    if (course.status === "completed") {
      return `<a class="btn" href="${courseHref(course.id)}">Открыть завершённый</a>`;
    }
    if (course.next_stage) {
      return `<a class="btn dark" href="${stageHref(course.id, course.next_stage.id)}">Продолжить</a>`;
    }
    return `<a class="btn" href="${courseHref(course.id)}">Открыть</a>`;
  }

  function courseCardHtml(course) {
    const pct = course.progress_percent || 0;
    const done = course.status === "completed";
    const started = ["started", "continue", "waiting", "completed"].includes(course.status);
    return `
      <article class="pane project-card ${accentClass(course)}${done ? " is-done" : ""}" data-course="${esc(course.id)}">
        <div class="project-card-head">
          <span class="project-quest-tag">Самопроверка</span>
          <span class="${statusClass(course.status)}">${done ? '✓ ' : ''}${esc(course.status_label)}</span>
        </div>
        <h3>${esc(course.short_title || course.title)}</h3>
        <p class="project-card-desc">${esc(course.description)}</p>
        ${started ? `<div class="project-progress-bar" aria-label="Прогресс квеста">
          <span style="width:${pct}%"></span>
        </div>
        <p class="project-progress-caption">${course.completed_stages} из ${course.total_stages} глав · ${pct}%</p>` : ''}
        <p class="project-final">${esc(course.final_result)}</p>
        <div class="project-card-actions">${courseActionHtml(course)}</div>
      </article>`;
  }

  async function startCourse(courseId, goToStage) {
    const data = await post(`/api/project-courses/${courseId}/start`, {});
    const first = data.course.stages.find((s) => s.status === "started" || s.status === "continue" || s.status === "available");
    if (goToStage && first) location.hash = stageHref(courseId, first.id);
    return data.course;
  }

  async function renderCourseList() {
    if (!showProjectSurface()) return;
    $("taskView").innerHTML = `<div class="task-page project-page"><div class="empty">Загружаю проекты...</div></div>`;
    const loading = $('taskView').firstElementChild, epoch = authEpoch();
    try {
      const data = await api("/api/project-courses");
      if (!screenActive(loading, epoch)) return;
      const courses = (data.courses || []).filter(c => c.kind !== 'local_practice');
      const practice = (data.courses || []).filter(c => c.kind === 'local_practice');
      let idx = courses.findIndex((c) => c.status === "started" || c.status === "continue");
      if (idx < 0) idx = courses.findIndex((c) => c.status === "available");
      if (idx < 0) idx = 0;

      const slideHtml = (course, i) => {
        const look = courseLook(course);
        const pct = course.progress_percent || 0;
        return `
          <article class="project-epic-slide ${accentClass(course)}" data-index="${i}" aria-hidden="${i === idx ? "false" : "true"}" ${i === idx ? "" : "inert"}>
            <div class="project-epic-glow" aria-hidden="true"></div>
            <div class="project-epic-panel pane">
              <div class="project-epic-top">
                ${emblemHtml(course, "lg")}
                <div>
                  ${questMetaHtml(course)}
                  <span class="${statusClass(course.status)}">${esc(course.status_label)}</span>
                </div>
              </div>
              <h2 class="project-epic-title">${esc(course.title)}</h2>
              <p class="project-epic-desc">${esc(course.intro || course.description)}</p>
              <div class="project-progress-bar" aria-label="Прогресс квеста"><span style="width:${pct}%"></span></div>
              ${pct
                ? `<p class="project-progress-caption">${course.completed_stages} из ${course.total_stages} глав · ${pct}%</p>`
                : (course.status === "unavailable" ? "" : `<p class="project-progress-caption">Готов к старту</p>`)}
              <p class="project-epic-reward"><b>Награда:</b> ${esc(course.final_result)}</p>
              <div class="project-card-actions">${courseActionHtml(course)}</div>
            </div>
          </article>`;
      };

      $("taskView").innerHTML = `
        <div class="task-page project-page project-epic" data-accent="${esc(courseLook(courses[idx] || {}).accent || "cyan")}">
          <div class="project-epic-bg" aria-hidden="true"></div>
          <div class="task-nav project-epic-nav">
            <div class="crumbs"><a href="#/">Главная</a> / Квесты</div>
            <a class="btn" href="#/showcase">Доска работ</a>
          </div>
          <div class="project-epic-stage">
            <button type="button" class="project-epic-arrow prev" id="projectEpicPrev" aria-label="Предыдущий квест">‹</button>
            <div class="project-epic-viewport">
              <div class="project-epic-track" id="projectEpicTrack" style="transform: translateX(-${idx * 100}%)">
                ${courses.map(slideHtml).join("")}
              </div>
            </div>
            <button type="button" class="project-epic-arrow next" id="projectEpicNext" aria-label="Следующий квест">›</button>
          </div>
          <div class="project-epic-dots" id="projectEpicDots" role="tablist" aria-label="Квесты">
            ${courses.map((c, i) => `
              <button type="button" class="project-epic-dot ${i === idx ? "active" : ""} ${accentClass(c)}"
                data-index="${i}" role="tab" aria-selected="${i === idx}" aria-label="${esc(c.short_title || c.title)}"></button>`).join("")}
          </div>
          <section class="pane project-local-catalog">
            <h2>Практика на своём компьютере</h2>
            <p>Небольшие квесты рядом с основным курсом: файлы, ошибки, документация, тесты, окружение и Git. Код проверяется в изолированной среде платформы, действия на своём компьютере — отдельной самопроверкой без XP и капель. Файлы вашего компьютера эта проверка не видит.</p>
            <div class="project-grid">${practice.map(courseCardHtml).join('')}</div>
          </section>
        </div>`;

      const root = $("taskView").querySelector(".project-epic");
      const track = $("projectEpicTrack");
      const dots = $("projectEpicDots");
      const prevBtn = $("projectEpicPrev");
      const nextBtn = $("projectEpicNext");

      const go = (next) => {
        if (!courses.length) return;
        idx = (next + courses.length) % courses.length;
        track.style.transform = `translateX(-${idx * 100}%)`;
        root.dataset.accent = courseLook(courses[idx]).accent;
        track.querySelectorAll(".project-epic-slide").forEach((el, i) => {
          el.setAttribute("aria-hidden", i === idx ? "false" : "true");
          el.inert = i !== idx;
          el.classList.toggle("is-active", i === idx);
        });
        dots.querySelectorAll(".project-epic-dot").forEach((el, i) => {
          el.classList.toggle("active", i === idx);
          el.setAttribute("aria-selected", i === idx ? "true" : "false");
        });
        prevBtn.disabled = courses.length < 2;
        nextBtn.disabled = courses.length < 2;
      };

      go(idx);
      prevBtn?.addEventListener("click", () => go(idx - 1));
      nextBtn?.addEventListener("click", () => go(idx + 1));
      dots?.addEventListener("click", (e) => {
        const dot = e.target.closest(".project-epic-dot");
        if (!dot) return;
        go(Number(dot.dataset.index));
      });

      let touchX = null;
      track.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
      track.addEventListener("touchend", (e) => {
        if (touchX == null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) < 48) return;
        go(idx + (dx < 0 ? 1 : -1));
      }, { passive: true });

      const onKey = (e) => {
        if (!screenActive(root, epoch) || location.hash !== "#/projects" || e.defaultPrevented || e.isComposing
            || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey
            || e.target?.closest("input, textarea, select, [contenteditable]")) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        go(idx + (e.key === "ArrowLeft" ? -1 : 1));
        dots.querySelectorAll(".project-epic-dot")[idx]?.focus({ preventScroll: true });
      };
      root.querySelector(".project-epic-stage").addEventListener("keydown", onKey);
      dots.addEventListener("keydown", onKey);

      $("taskView").querySelectorAll(".project-start").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await startCourse(btn.dataset.course, true);
          } catch (e) {
            btn.disabled = false;
            showProjectError(e.message);
          }
        });
      });
    } catch (e) {
      if (!screenActive(loading, epoch)) return;
      if (authFallback(e)) return;
      showProjectError(e.message);
    }
  }

  function stageRailHtml(course) {
    const total = (course.stages || []).length;
    return (course.stages || []).map((stage, idx) => {
      const href = stage.status === "unavailable" || stage.status === "waiting"
        ? courseHref(course.id)
        : stageHref(course.id, stage.id);
      const done = stage.status === "completed";
      return `
        <a class="project-stage-row ${stage.status}" href="${href}">
          <span class="project-stage-num ${done ? "done" : ""}" aria-hidden="true">${idx + 1}</span>
          <span class="project-stage-main">
            <small class="project-stage-chapter">Глава ${idx + 1} из ${total}</small>
            <b>${esc(stage.title)}</b>
            <small>${esc(stage.new_knowledge || stage.status_label)}</small>
          </span>
          <span class="${statusClass(stage.status)}">${esc(stage.status_label)}</span>
        </a>`;
    }).join("");
  }

  async function renderCourseDetail(courseId) {
    if (!showProjectSurface()) return;
    $("taskView").innerHTML = `<div class="task-page project-page"><div class="empty">Загружаю курс...</div></div>`;
    const loading = $('taskView').firstElementChild, epoch = authEpoch();
    try {
      const data = await api(`/api/project-courses/${courseId}`);
      if (!screenActive(loading, epoch)) return;
      const course = data.course;
      $("taskView").innerHTML = `
        <div class="task-page project-page">
          <div class="task-nav">
            <div class="crumbs"><a href="#/">Главная</a> / <a href="#/projects">Квесты</a> / ${esc(course.short_title)}</div>
            <a class="btn" href="#/projects">Все квесты</a>
          </div>
          <section class="pane project-detail-hero ${accentClass(course)}">
            <div class="project-detail-top">
              ${emblemHtml(course, "lg")}
              <div>
                ${questMetaHtml(course)}
                <span class="${statusClass(course.status)}">${esc(course.status_label)}</span>
                <h2>${esc(course.title)}</h2>
              </div>
            </div>
            <p>${esc(course.intro || course.description)}</p>
            <div class="project-progress-bar"><span style="width:${course.progress_percent}%"></span></div>
            <p class="project-final"><b>Награда квеста:</b> ${esc(course.final_result)}</p>
            <div class="project-card-actions">${courseActionHtml(course)}</div>
          </section>
          <section class="pane">
            <h3>Главы квеста</h3>
            <div class="project-stage-list">${stageRailHtml(course)}</div>
          </section>
        </div>`;
      $("taskView").querySelectorAll(".project-start").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await startCourse(btn.dataset.course, true);
          } catch (e) {
            btn.disabled = false;
            showProjectError(e.message);
          }
        });
      });
    } catch (e) {
      if (!screenActive(loading, epoch)) return;
      if (authFallback(e)) return;
      showProjectError(e.message);
    }
  }

  function projectTaskPayload(course, stage) {
    return {
      id: `project:${course.id}:${stage.id}`,
      type: "проектный этап",
      prompt: stage.task,
      answer: stage.completion_message || "Проверяется поведением программы.",
      project_context: {
        course_title: course.title,
        stage_title: stage.title,
        previous_stage_summary: previousStageSummary(course, stage.id),
        learned_topics: stage.required_topic_titles || [],
      },
    };
  }

  function previousStageSummary(course, stageId) {
    const idx = (course.stages || []).findIndex((s) => s.id === stageId);
    if (idx <= 0) return "";
    return course.stages[idx - 1].summary || "";
  }

  function stageNav(course, stage) {
    const idx = course.stages.findIndex((s) => s.id === stage.id);
    const prev = idx > 0 ? course.stages[idx - 1] : null;
    const next = idx >= 0 ? course.stages[idx + 1] : null;
    return `
      <div class="project-stage-nav">
        ${prev ? `<a class="btn" href="${stageHref(course.id, prev.id)}">Предыдущий этап</a>` : `<a class="btn" href="${courseHref(course.id)}">К курсу</a>`}
        ${next && next.status !== "unavailable" && next.status !== "waiting"
          ? `<a class="btn dark" href="${stageHref(course.id, next.id)}">Следующий этап</a>`
          : ""}
      </div>`;
  }

  function snapshotHtml(stage) {
    const snapshots = stage.snapshots || [];
    if (!snapshots.length) return `<p class="stat-note">Снимки появятся после первого сохранения.</p>`;
    return snapshots.slice().reverse().map((snap) => `
      <button class="project-snapshot" data-snapshot="${snap.id}">
        <span>v${snap.version} · ${esc(snapshotKind(snap.kind))}</span>
        <small>${new Date(snap.created_at).toLocaleString("ru-RU")}</small>
      </button>`).join("");
  }

  function snapshotKind(kind) {
    return {
      start: "старт",
      save: "сохранение",
      complete: "завершение",
      restore: "восстановление",
    }[kind] || kind;
  }

  async function renderStage(courseId, stageId) {
    if (!showProjectSurface()) return;
    $("taskView").innerHTML = `<div class="task-page project-page"><div class="empty">Загружаю этап...</div></div>`;
    const loading = $('taskView').firstElementChild, epoch = authEpoch();
    try {
      let data = await api(`/api/project-courses/${courseId}`);
      if (!screenActive(loading, epoch)) return;
      let course = data.course;
      if (course.status === "available") {
        course = await startCourse(courseId, false);
        if (!screenActive(loading, epoch)) return;
      }
      const stage = course.stages.find((s) => s.id === stageId);
      if (!stage) return showProjectError("Этап не найден");
      if (stage.status === "unavailable" || stage.status === "waiting") {
        return renderLockedStage(course, stage);
      }
      const stageIdx = course.stages.findIndex((s) => s.id === stageId);
      const chapterLabel = stageIdx >= 0
        ? `Глава ${stageIdx + 1} из ${course.stages.length}`
        : "Глава квеста";
      lastLoadedStage = { courseId, stageId };
      $("taskView").innerHTML = `
        <div class="task-page project-page project-stage-page ${accentClass(course)}">
          <div class="task-nav">
            <div class="crumbs"><a href="#/">Главная</a> / <a href="#/projects">Квесты</a> / <a href="${courseHref(course.id)}">${esc(course.short_title)}</a> / ${esc(stage.title)}</div>
            <a class="btn" href="${courseHref(course.id)}">К главам</a>
          </div>
          <div class="project-stage-layout">
            <main class="pane project-editor-pane">
              <div class="project-stage-head">
                ${emblemHtml(course, "sm")}
                <div class="task-title-row">
                  <div>
                    <span class="project-quest-tag">${esc(course.quest_label || "Проектный квест")}</span>
                    <small class="project-stage-chapter">${esc(chapterLabel)}</small>
                    <h2>${esc(stage.title)}</h2>
                  </div>
                  <span class="${statusClass(stage.status)}">${esc(stage.status_label)}</span>
                </div>
              </div>
              <p class="project-stage-summary">${esc(stage.summary)}</p>
              <div class="project-apply">Теперь применяем: <b>${esc(stage.new_knowledge || "новые темы")}</b></div>
              <p class="prompt">${esc(stage.task)}</p>
              ${localPracticeHtml(stage)}
              <div class="terminal-glass editable">
                <div class="terminal-label-bar">
                  <label class="terminal-title" for="projectEditor">project.py</label>
                  <span class="terminal-actions">
                    <button type="button" class="term-reset-btn" id="projectReset" title="Сбросить код к исходному" aria-label="Сбросить код к исходному"><span class="nf nf-restore" aria-hidden="true"></span></button>
                  </span>
                </div>
                <textarea class="editor project-editor" id="projectEditor" spellcheck="false"></textarea>
              </div>
              ${window.RuntimeHelp?.html() || ""}
              <div class="run-row">
                <button class="btn" id="projectSave">Сохранить снимок</button>
                <button class="btn" id="projectRunLive">Запустить</button>
                <button class="btn accent" id="projectRun">${stage.local_practice ? 'Проверить код' : 'Проверить'}</button>
                <button class="btn dark" id="projectComplete" disabled>${stage.local_practice ? 'Завершить самопроверку' : 'Завершить этап'}</button>
                <span class="run-status" id="projectStatus"></span>
              </div>
              <section id="projectTests" hidden></section>
              <div class="verdict" id="projectVerdict"></div>
              <div class="terminal-glass readonly output-terminal">
                <div class="terminal-label-bar"><span class="terminal-title">Терминал</span></div>
                <div class="terminal-body project-output" id="projectOutput"></div>
              </div>
              ${stageNav(course, stage)}
            </main>
            <aside class="project-side">
              <section class="pane">
                <h3>Подсказки</h3>
                <div class="project-hints">${(stage.hints || []).map((h) => `<p>${esc(h)}</p>`).join("")}</div>
              </section>
              <section class="pane">
                <h3>Версии кода</h3>
                <p class="stat-note">Нажмите на снимок, чтобы восстановить эту версию в редактор.</p>
                <div class="project-snapshots" id="projectSnapshots">${snapshotHtml(stage)}</div>
              </section>
              <section class="pane">
                <h3>Нужно знать</h3>
                <div class="project-topic-list">${(stage.required_topic_titles || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
              </section>
            </aside>
          </div>
        </div>`;
      wireStage(course, stage);
    } catch (e) {
      if (!screenActive(loading, epoch)) return;
      if (authFallback(e)) return;
      showProjectError(e.message);
    }
  }

  function renderLockedStage(course, stage) {
    $("taskView").innerHTML = `
      <div class="task-page project-page ${accentClass(course)}">
        <div class="task-nav">
          <div class="crumbs"><a href="#/">Главная</a> / <a href="#/projects">Квесты</a> / <a href="${courseHref(course.id)}">${esc(course.short_title)}</a></div>
        </div>
        <section class="pane project-locked">
          <div class="project-detail-top">
            ${emblemHtml(course)}
            <div>
              <span class="project-quest-tag">${esc(course.quest_label || "Проектный квест")}</span>
              <span class="${statusClass(stage.status)}">${esc(stage.status_label)}</span>
              <h2>${esc(stage.title)}</h2>
            </div>
          </div>
          <p>Эта глава квеста откроется, когда будут готовы предыдущие шаги и нужные темы.</p>
          <p class="project-final"><b>Нужно пройти:</b> ${esc((stage.required_topic_titles || []).join(", "))}</p>
          <a class="btn dark" href="${courseHref(course.id)}">К главам квеста</a>
        </section>
      </div>`;
  }

  function localPracticeHtml(stage) {
    const local = stage.local_practice;
    if (!local) return '';
    return `<details class="project-local-guide" open>
      <summary>Шаги на своём компьютере</summary>
      ${local.guide.map((g, i) => `<section><h3>${i + 1}. ${esc(g.title)}</h3>${simpleMarkdown(g.text)}
        ${g.code ? `<div class="terminal-glass"><div class="terminal-label-bar">Пример.py</div><pre>${esc(g.code)}</pre></div><div class="project-local-output"><small>Вывод</small><pre>${esc(g.output)}</pre></div>` : ''}</section>`).join('')}
      <p>${local.links.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.title)} ↗</a>`).join('<br>')}</p>
      </details>
      <fieldset class="project-local-check" id="projectLocalCheck">
        <legend>Сделал на своём компьютере</legend>
        <p class="stat-note">Это самопроверка: браузер не видит вашу IDE и файлы.</p>
        ${local.checklist.map(item => `<label><input type="checkbox" value="${esc(item.id)}"><span>${esc(item.text)}</span></label>`).join('')}
        <label for="projectReflection">${esc(local.reflection_prompt)}</label>
        <textarea id="projectReflection" rows="4" minlength="20" maxlength="2000" placeholder="Коротко своими словами: что проверили и что получилось"></textarea>
      </fieldset>`;
  }

  function wireStage(course, stage) {
    const editor = $("projectEditor");
    const output = $("projectOutput");
    const verdict = $("projectVerdict");
    const status = $("projectStatus");
    const complete = $("projectComplete");
    const run = $("projectRun");
    const runLive = $("projectRunLive");
    const save = $("projectSave");
    const terminal = window.LiveTerminal.create(output);
    let lastCheck = null;
    let busy = false;
    const epoch = authEpoch(), active = () => screenActive(editor, epoch);
    const local = stage.local_practice;
    const localCheck = $('projectLocalCheck'), reflection = $('projectReflection');
    const evidence = () => local ? {
      checked: [...localCheck.querySelectorAll('input:checked')].map(el => el.value),
      reflection: reflection.value,
    } : undefined;
    const localReady = () => !local || (evidence().checked.length === local.checklist.length && evidence().reflection.trim().length >= 20);
    const syncComplete = () => { if (active()) complete.disabled = busy || !lastCheck?.ok || !localReady(); };
    const autosave = () => queueAutosave(course.id, stage.id, editor.value, status, evidence(), active);
    if (local) {
      const saved = stage.local_evidence || {};
      $('projectReflection').value = saved.reflection || '';
      document.querySelectorAll('#projectLocalCheck input').forEach(input => { input.checked = (saved.checked || []).includes(input.value); });
      $('projectLocalCheck').addEventListener('input', () => { syncComplete(); autosave(); });
    }

    editor.value = stage.current_code || stage.starter_code || "";
    const starter = stage.starter_code || "";
    $("projectReset")?.addEventListener("click", () => {
      editor.value = starter;
      complete.disabled = true;
      lastCheck = null;
      terminal.setStatic("");
      verdict.className = "verdict";
      verdict.textContent = "";
      status.textContent = "Код восстановлен";
      autosave();
    });
    window.EditorKeys?.bind(editor);
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        run.click();
      }
    });
    editor.addEventListener("input", () => {
      complete.disabled = true;
      lastCheck = null;
      autosave();
    });

    save.addEventListener("click", async () => {
      try { await saveProjectCode(course.id, stage.id, editor.value, status, true, evidence(), active); }
      catch (e) { if (active()) status.textContent = e.message; }
    });

    runLive.addEventListener("click", async () => {
      busy = true;
      syncComplete();
      runLive.disabled = true;
      run.disabled = true;
      verdict.className = "verdict";
      verdict.textContent = "";
      try {
        await saveProjectCode(course.id, stage.id, editor.value, status, false, evidence(), active);
        if (!active()) return;
        await terminal.run(editor.value, (s) => { status.textContent = s || ""; });
      } catch (e) {
        if (active()) { verdict.className = 'verdict show fail'; verdict.textContent = e.message; }
      } finally {
        busy = false;
        syncComplete();
        status.textContent = "";
        runLive.disabled = false;
        run.disabled = false;
      }
    });

    run.addEventListener("click", async () => {
      const code = editor.value;
      window.OutputFiles?.clear(output);
      busy = true;
      run.disabled = true;
      runLive.disabled = true;
      complete.disabled = true;
      verdict.className = "verdict";
      verdict.textContent = "";
      try {
        await saveProjectCode(course.id, stage.id, code, status, false, evidence(), active);
        if (!active()) return;
        const report = SubmissionChecks.start($("projectTests"), stage.check?.append);
        const result = await checkStage(stage, code, (s) => { if (active()) status.textContent = s || ""; }, report.onTest);
        if (!active() || editor.value !== code) return;
        if (result.blocked) {
          lastCheck = null;
          $("projectTests").hidden = true;
          verdict.className = "verdict show";
          verdict.textContent = result.message;
          terminal.setStatic(window.RuntimeHelp?.errorText?.(result) || result.error, "live-term-error");
          return;
        }
        await report.finish(result);
        if (!active() || editor.value !== code) return;
        const {artifacts: runFiles, ...verdictOnly} = result;
        lastCheck = verdictOnly; // Downloads stay in the run, never in saved check/snapshots.
        if (lastCheck.ok) {
          verdict.className = "verdict show ok";
          verdict.innerHTML = local ? '<strong>Проверка кода пройдена.</strong> Это не проверка вашего компьютера. Для завершения нужны отмеченные локальные действия и объяснение.' : `<strong>Проверка пройдена.</strong> Можно завершить этап.`;
          terminal.setStatic(lastCheck.stdout, undefined, runFiles);
          syncComplete();
        } else {
          verdict.className = "verdict show fail";
          verdict.innerHTML = `<strong>Пока не то.</strong> ${esc(lastCheck.message || "Проверьте код и подсказки.")}${lastCheck.guidance ? `<p>${esc(lastCheck.guidance)}</p>` : ""}${window.LearningErrorHelp?.sourceHtml?.(lastCheck.failure, code) || ""}${window.LearningErrorHelp?.render(lastCheck.failure) || ""}`;
          terminal.setStatic(lastCheck.stdout || lastCheck.error, lastCheck.error ? "live-term-error" : null, runFiles);
        }
      } catch (e) {
        if (!active()) return;
        verdict.className = "verdict show fail";
        verdict.textContent = e.message;
        terminal.setStatic(e.message, "live-term-error");
      } finally {
        busy = false;
        syncComplete();
        status.textContent = "";
        run.disabled = false;
        runLive.disabled = false;
      }
    });

    complete.addEventListener("click", async () => {
      if (!lastCheck?.ok || !localReady() || !active()) return;
      busy = true;
      complete.disabled = true;
      try {
        const data = await post(`/api/project-courses/${course.id}/stages/${stage.id}/complete`, {
          code: editor.value,
          check: lastCheck,
          local_evidence: evidence(),
        });
        if (!active()) return;
        const badge = editor.closest('.project-editor-pane').querySelector('.project-stage-head .project-status');
        badge.textContent = data.stage.status_label;
        badge.className = statusClass(data.stage.status);
        showProjectSuccess(course, data.stage, data.course.next_stage);
      } catch (e) {
        if (!active()) return;
        verdict.className = "verdict show fail";
        verdict.textContent = e.message;
      } finally {
        busy = false;
        if (active()) syncComplete();
      }
    });

    $("projectSnapshots").addEventListener("click", async (e) => {
      const btn = e.target.closest(".project-snapshot");
      if (!btn) return;
      btn.disabled = true;
      try {
        const data = await post(`/api/project-courses/${course.id}/stages/${stage.id}/restore`, {
          snapshot_id: btn.dataset.snapshot,
        });
        if (!active()) return;
        editor.value = data.stage.current_code || "";
        $("projectSnapshots").innerHTML = snapshotHtml(data.stage);
        complete.disabled = true;
        lastCheck = null;
        verdict.className = "verdict show";
        verdict.textContent = "Версия восстановлена. Запустите проверку перед завершением.";
      } catch (err) {
        if (!active()) return;
        verdict.className = "verdict show fail";
        verdict.textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  function queueAutosave(courseId, stageId, code, statusEl, evidence, active) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (active()) saveProjectCode(courseId, stageId, code, statusEl, false, evidence, active).catch(e => { if (active()) statusEl.textContent = e.message; });
    }, 900);
  }

  async function saveProjectCode(courseId, stageId, code, statusEl, loud, evidence, active) {
    if (!active()) return;
    statusEl.textContent = "сохраняю...";
    const data = await post(`/api/project-courses/${courseId}/stages/${stageId}/save`, { code, snapshot: !!loud, local_evidence: evidence });
    if (!active()) return data;
    if (lastLoadedStage?.courseId === courseId && lastLoadedStage?.stageId === stageId && $("projectSnapshots")) {
      $("projectSnapshots").innerHTML = snapshotHtml(data.stage);
    }
    statusEl.textContent = loud ? "снимок сохранён" : "сохранено";
    setTimeout(() => { if (statusEl.textContent.startsWith("сохран")) statusEl.textContent = ""; }, 1800);
    return data;
  }

  async function checkStage(stage, code, onStatus, onTest) {
    const check = stage.check || {};
    const forbidden = (check.forbid || []).find((needle) => code.includes(needle));
    if (forbidden) return { ok: false, message: `В этом этапе пока не используйте ${forbidden}.`, stdout: "" };
    const missing = (check.expect_contains || []).filter((needle) => !code.includes(needle));
    if (missing.length) {
      return { ok: false, message: `Не хватает обязательных элементов: ${missing.join(", ")}.`, stdout: "" };
    }
    if (/\binput\s*\(/.test(code) && !check.expect) {
      return { ok: true, stdout: "Структура этапа проверена без запуска интерактивного input().", kind: "project" };
    }
    if (check.append || check.expect) {
      const result = await window.PyRunner.run(code, onStatus, check.append || undefined, onTest);
      const files = result.artifacts ? {artifacts: result.artifacts} : {};
      if (result.blocked) return { ok: false, blocked: true, error: result.error, guidance: result.guidance, message: result.error, stdout: "" };
      if (result.error) return { ok: false, error: result.error, failure: result.failure, guidance: result.guidance, stdout: result.stdout || "", message: "Код завершился ошибкой.", ...files };
      const stdout = result.user_stdout ?? result.stdout ?? '';
      if (check.append && result.check_stdout == null) return { ok: false, message: 'Обновите страницу: версия интерпретатора не поддерживает отдельную проверку.', stdout };
      const checked = check.append ? result.check_stdout : result.stdout;
      if (check.expect && !checked.trim().endsWith(String(check.expect).trim())) {
        return { ok: false, stdout, expected: check.expect, message: "Тесты запустились, но итоговый вывод не совпал.", ...files };
      }
      return { ok: true, stdout, expected: check.expect || "", kind: "project", ...files };
    }
    const result = await window.PyRunner.run(code, onStatus, undefined, onTest);
    const files = result.artifacts ? {artifacts: result.artifacts} : {};
    if (result.blocked) return { ok: false, blocked: true, error: result.error, guidance: result.guidance, message: result.error, stdout: "" };
    if (result.error) return { ok: false, error: result.error, failure: result.failure, guidance: result.guidance, stdout: result.stdout || "", message: "Код завершился ошибкой.", ...files };
    return { ok: true, stdout: result.stdout || "", kind: "project", ...files };
  }

  function closeSuccessModal() {
    const modal = $("successModal");
    if (!modal) return;
    modal.classList.remove("open");
    setTimeout(() => {
      if (!modal.classList.contains("open")) {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
      }
    }, 250);
  }

  function setupSuccessHijack() {
    const next = $("successNext");
    const stay = $("successStay");
    if (next && !next.dataset.projectHijack) {
      next.dataset.projectHijack = "1";
      next.addEventListener("click", (e) => {
        if (!successHref) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const href = successHref;
        successHref = null;
        closeSuccessModal();
        location.hash = href.replace(/^#/, "");
      }, true);
    }
    if (stay && !stay.dataset.projectHijack) {
      stay.dataset.projectHijack = "1";
      stay.addEventListener("click", () => { successHref = null; }, true);
    }
  }

  async function showProjectSuccess(course, stage, nextStage) {
    const sequence = ++projectReviewSeq;
    const editor = $("projectEditor");
    const reviewHash = location.hash;
    const isCurrent = () => sequence === projectReviewSeq && location.hash === reviewHash && editor?.isConnected && !$("appView").hidden;
    setupSuccessHijack();
    successHref = nextStage ? stageHref(course.id, nextStage.id) : courseHref(course.id);
    $('successExplanation').hidden = true;
    $('successExplanationBody').textContent = '';
    $("successXp").textContent = stage.local_practice ? 'Самопроверка' : "Этап";
    $("successTitle").textContent = stage.local_practice ? 'Мини-квест завершён' : "Этап проекта завершён";
    $("successMsg").textContent = stage.completion_message || "Код сохранён, можно двигаться дальше.";
    $("successNext").textContent = nextStage ? "Следующий этап" : "К проекту";
    const review = $("successReview");
    review.hidden = false;
    review.innerHTML = '<span class="review-wait">✎ наставник смотрит проектный код...</span>';
    const modal = $("successModal");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => modal.classList.add("open"));
    if (stage.local_practice) { review.hidden = true; return; }
    requestProjectReview(course, stage, isCurrent).then((html) => {
      if (!isCurrent()) return;
      if (!html) {
        review.hidden = true;
        return;
      }
      review.innerHTML = html;
      review.hidden = false;
    }).catch(() => { if (isCurrent()) review.hidden = true; });
  }

  async function requestProjectReview(course, stage, isCurrent) {
    const editor = $("projectEditor");
    const payload = {
      task: projectTaskPayload(course, stage),
      attempt: {
        ok: true,
        code: editor?.value || "",
        text: "",
        got: $("projectOutput")?.textContent || "",
      },
    };
    if (!await AIHelper.waitForReview() || !isCurrent()) return "";
    const data = await post("/api/ai/review", payload);
    const text = data.review;
    if (!text) return "";
    return simpleMarkdown(text);
  }

  function simpleMarkdown(src) {
    return String(src || "")
      .split(/\n{2,}/)
      .map((p) => `<p>${esc(p).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function showcaseCoverClass(cover) {
    return `showcase-cover showcase-cover-${esc(cover || "aurora")}`;
  }

  function showcaseFilesSummary(card) {
    return `${card.file_count || 1} ${card.file_count === 1 ? "файл" : "файла"}`;
  }

  function showcaseVoteHtml(card) {
    return [-3, -2, -1, 1, 2, 3].map((value) => `
      <button class="showcase-vote ${card.my_vote === value ? "active" : ""}"
        data-card="${card.id}" data-vote="${value}">
        ${value > 0 ? "+" + value : value}
      </button>`).join("");
  }

  function showcaseRunCode(files) {
    const list = Array.isArray(files) ? files : [];
    const main = list.find((f) => f.name === "main.py") || list[0] || { code: "" };
    const setup = 'import sys, importlib\n' + list
      .filter((f) => f.name !== main.name)
      .map((f) => `open(${JSON.stringify(f.name)}, "w", encoding="utf-8").write(${JSON.stringify(f.code || "")})\nsys.modules.pop(${JSON.stringify(f.name.slice(0, -3))}, None)`)
      .join("\n");
    return `${setup}\nimportlib.invalidate_caches()\n${main.code || ""}`;
  }

  function bindShowcaseVotes(root, onDone) {
    root.querySelectorAll(".showcase-vote").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await post(`/api/showcase/cards/${btn.dataset.card}/vote`, { value: Number(btn.dataset.vote) });
          onDone();
        } catch (e) {
          btn.disabled = false;
          showProjectError(e.message);
        }
      });
    });
  }

  function bindShowcaseRun(btn, files, outEl) {
    if (!btn || !outEl) return;
    const terminal = window.LiveTerminal.create(outEl);
    const label = btn.textContent;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await terminal.run(showcaseRunCode(files), (status) => { btn.textContent = status || label; });
      } finally {
        btn.textContent = label;
        btn.disabled = false;
      }
    });
  }

  function showcaseListCardHtml(card) {
    return `
      <article class="pane showcase-list-card">
        <a class="showcase-list-link" href="${esc(showcaseCardHref(card.id))}">
          <div class="${showcaseCoverClass(card.cover)}" aria-hidden="true">
            <span>${esc(card.title.slice(0, 1).toUpperCase())}</span>
          </div>
          <div class="showcase-card-body">
            <div class="showcase-card-head">
              <div>
                <h3>${esc(card.title)}</h3>
                <p>${esc(card.description)}</p>
              </div>
              <span class="cloud-score">${card.score} облачков</span>
            </div>
            <div class="showcase-meta">
              <span>${esc(card.owner_name)}</span>
              <span>${showcaseFilesSummary(card)}</span>
              ${card.is_multi_file ? "<span>multi-file</span>" : ""}
            </div>
            <span class="showcase-open-hint">Открыть карточку →</span>
          </div>
        </a>
      </article>`;
  }

  async function renderShowcase() {
    if (!showProjectSurface("showcase")) return;
    $("taskView").innerHTML = `<div class="task-page project-page"><div class="empty">Загружаю доску проектов...</div></div>`;
    const loading = $("taskView").firstElementChild, epoch = authEpoch();
    try {
      const board = await api("/api/showcase");
      if (!screenActive(loading, epoch)) return;
      const cards = board.cards || [];
      $("taskView").innerHTML = `
        <div class="task-page project-page showcase-page">
          <div class="task-nav">
            <div class="crumbs"><a href="#/">Главная</a> / Доска работ</div>
            <div class="showcase-nav-actions">
              <a class="btn" href="#/projects">К квестам</a>
              <a class="btn dark" href="${esc(showcaseNewHref())}">Создать проект</a>
            </div>
          </div>
          <section class="pane project-hero showcase-hero">
            <span class="project-kicker">Общая витрина</span>
            <h2>Программы учеников</h2>
            <p>Смотрите чужой код, запускайте в карточке и голосуйте облачками. Создание своей программы — на отдельной странице.</p>
          </section>
          <div class="showcase-layout">
            <main class="showcase-feed">
              ${cards.length
                ? cards.map(showcaseListCardHtml).join("")
                : `<div class="pane empty"><p>Пока нет карточек. Станьте первым автором.</p><a class="btn dark" href="${esc(showcaseNewHref())}">Создать проект</a></div>`}
            </main>
            <aside class="showcase-side">
              <section class="pane">
                <h3>Лидерборд</h3>
                <div class="leader-list">
                  ${(board.leaderboard || []).slice(0, 6).map((card, i) => `
                    <a class="leader-row" href="${esc(showcaseCardHref(card.id))}">
                      <span>${i + 1}</span>
                      <b>${esc(card.title)}</b>
                      <small>${card.score}</small>
                    </a>`).join("") || "<p class=\"stat-note\">Пока пусто</p>"}
                </div>
              </section>
              <section class="pane showcase-cta">
                <h3>Своя программа</h3>
                <p class="stat-note">Опубликуйте код на доске: название, описание, оформление и файлы — на отдельной странице.</p>
                <a class="btn dark wide" href="${esc(showcaseNewHref())}">Создать проект</a>
              </section>
            </aside>
          </div>
        </div>`;
    } catch (e) {
      if (!screenActive(loading, epoch)) return;
      if (authFallback(e)) return;
      showProjectError(e.message);
    }
  }

  async function renderShowcaseDetail(cardId) {
    if (!showProjectSurface("showcase")) return;
    $("taskView").innerHTML = `<div class="task-page project-page"><div class="empty">Открываю карточку...</div></div>`;
    const loading = $("taskView").firstElementChild, epoch = authEpoch();
    try {
      const data = await api(`/api/showcase/cards/${cardId}`);
      if (!screenActive(loading, epoch)) return;
      const card = data.card;
      if (!card) throw new Error("Карточка не найдена");
      const files = card.files || [];
      $("taskView").innerHTML = `
        <div class="task-page project-page showcase-page showcase-detail-page">
          <div class="task-nav">
            <div class="crumbs"><a href="#/">Главная</a> / <a href="${esc(showcaseHref())}">Доска работ</a> / ${esc(card.title)}</div>
            <a class="btn" href="${esc(showcaseHref())}">К списку</a>
          </div>
          <article class="pane showcase-detail">
            <div class="showcase-detail-hero">
              <div class="${showcaseCoverClass(card.cover)} showcase-cover-lg" aria-hidden="true">
                <span>${esc(card.title.slice(0, 1).toUpperCase())}</span>
              </div>
              <div class="showcase-detail-head">
                <span class="project-kicker">${esc(card.owner_name)}</span>
                <h2>${esc(card.title)}</h2>
                <p>${esc(card.description)}</p>
                <div class="showcase-meta">
                  <span class="cloud-score">${card.score} облачков</span>
                  <span>${showcaseFilesSummary(card)}</span>
                  ${card.is_multi_file ? "<span>multi-file</span>" : ""}
                </div>
              </div>
            </div>
            <div class="showcase-detail-body">
              <section class="showcase-files">
                <h3>Код</h3>
                ${files.map((f) => `
                  <div class="showcase-file-block">
                    <div class="showcase-file-name">${esc(f.name)}</div>
                    <pre class="showcase-file-code">${esc(f.code || "")}</pre>
                  </div>`).join("")}
              </section>
              <section class="showcase-detail-panel">
                <h3>Запуск и голоса</h3>
                <div class="showcase-votes" aria-label="Голосование от минус трёх до плюс трёх">
                  ${showcaseVoteHtml(card)}
                </div>
                ${window.RuntimeHelp?.html() || ""}
                <button class="btn dark wide showcase-run" id="showcaseRunBtn">Запустить</button>
                <div class="terminal-body showcase-output" id="showcaseOutput"></div>
              </section>
            </div>
          </article>
        </div>`;
      bindShowcaseVotes($("taskView"), () => renderShowcaseDetail(cardId));
      bindShowcaseRun($("showcaseRunBtn"), files, $("showcaseOutput"));
    } catch (e) {
      if (!screenActive(loading, epoch)) return;
      if (authFallback(e)) return;
      showProjectError(e.message);
    }
  }

  async function renderShowcaseCreate() {
    if (!showProjectSurface("showcase")) return;
    $("taskView").innerHTML = `<div class="task-page project-page"><div class="empty">Готовлю форму...</div></div>`;
    const loading = $("taskView").firstElementChild, epoch = authEpoch();
    try {
      const board = await api("/api/showcase");
      if (!screenActive(loading, epoch)) return;
      const covers = board.covers || ["aurora", "cosmos", "sunrise", "storm", "terminal"];
      $("taskView").innerHTML = `
        <div class="task-page project-page showcase-page showcase-create-page">
          <div class="task-nav">
            <div class="crumbs"><a href="#/">Главная</a> / <a href="${esc(showcaseHref())}">Доска работ</a> / Новый проект</div>
            <a class="btn" href="${esc(showcaseHref())}">К списку</a>
          </div>
          <section class="pane project-hero showcase-hero">
            <span class="project-kicker">Публикация</span>
            <h2>Создать свой проект</h2>
            <p>Название, описание, оформление и код. После публикации карточка появится на доске.</p>
          </section>
          <form class="pane showcase-create-form" id="showCreateForm">
            <div class="showcase-create-grid">
              <label>Название
                <input id="showTitle" required minlength="3" maxlength="80" aria-describedby="showTitleHint" placeholder="Например: трекер воды">
                <small class="stat-note" id="showTitleHint">От 3 до 80 символов</small>
              </label>
              <label>Оформление
                <select id="showCover">${covers.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
              </label>
            </div>
            <label>Описание
              <textarea id="showDesc" rows="4" required minlength="10" maxlength="500" aria-describedby="showDescHint" placeholder="Что делает программа и почему её стоит запустить"></textarea>
              <small class="stat-note" id="showDescHint">От 10 до 500 символов</small>
            </label>
            <label>main.py
              <textarea id="showMain" class="show-code-input" rows="12">print("Привет с доски проектов!")</textarea>
            </label>
            <div class="showcase-extra ${board.can_multi_file ? "" : "locked"}">
              <p class="stat-note">${board.can_multi_file
                ? "Небесная корона активна: можно добавить helper-файл."
                : "Несколько файлов доступны с премиум-профилем «Небесная корона»."}</p>
              <label>Дополнительный файл
                <input id="showHelperName" value="helpers.py" ${board.can_multi_file ? "" : "disabled"}>
              </label>
              <label for="showHelperCode">Код дополнительного файла</label>
              <textarea id="showHelperCode" class="show-code-input" rows="6" ${board.can_multi_file ? "" : "disabled"}>def message():
    return "из helpers.py"</textarea>
              ${board.can_multi_file ? "" : '<a class="btn" href="#/shop">Открыть магазин</a>'}
            </div>
            <div class="showcase-create-actions">
              <button type="submit" class="btn dark" id="showPublish">Опубликовать</button>
              <a class="btn" href="${esc(showcaseHref())}">Отмена</a>
            </div>
            <p class="stat-note" id="showPublishStatus" role="status" aria-live="polite"></p>
          </form>
        </div>`;

      const form = $("showCreateForm"), publish = $("showPublish"), status = $("showPublishStatus");
      const active = () => screenActive(form, epoch) && location.hash === showcaseNewHref();
      let publishing = false;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!active() || publishing) return;
        const title = form.querySelector("#showTitle"), description = form.querySelector("#showDesc");
        if (title.value.trim().length < 3 || title.value.trim().length > 80) {
          status.textContent = "Название: от 3 до 80 символов без пробелов по краям.";
          title.focus();
          return;
        }
        if (description.value.trim().length < 10 || description.value.trim().length > 500) {
          status.textContent = "Описание: от 10 до 500 символов без пробелов по краям.";
          description.focus();
          return;
        }
        const files = [{ name: "main.py", code: form.querySelector("#showMain").value }];
        const helperName = form.querySelector("#showHelperName"), helperCode = form.querySelector("#showHelperCode");
        if (!helperName.disabled && helperCode.value.trim()) {
          files.push({ name: helperName.value.trim(), code: helperCode.value });
        }
        publishing = true;
        publish.disabled = true;
        publish.textContent = "Публикуем…";
        form.setAttribute("aria-busy", "true");
        status.textContent = "Публикуем проект на Доске…";
        try {
          const res = await post("/api/showcase/cards", {
            title: title.value.trim(),
            description: description.value.trim(),
            cover: form.querySelector("#showCover").value,
            files,
          });
          if (!active()) return;
          const id = res?.card?.id;
          location.hash = id ? showcaseCardHref(id) : showcaseHref();
        } catch (e) {
          if (active()) status.textContent = `Не удалось опубликовать: ${e.message}. Введённый код сохранён в форме, можно повторить отправку.`;
        } finally {
          publishing = false;
          if (active()) {
            publish.disabled = false;
            publish.textContent = "Опубликовать";
            form.setAttribute("aria-busy", "false");
          }
        }
      });
    } catch (e) {
      if (!screenActive(loading, epoch)) return;
      if (authFallback(e)) return;
      showProjectError(e.message);
    }
  }

  function showProjectError(message) {
    if (!$("taskView")) return;
    $("taskView").innerHTML = `
      <div class="task-page project-page">
        <div class="empty">
          <h2>Не удалось открыть проектные курсы</h2>
          <p>${esc(message)}</p>
          <a class="btn dark" href="#/">На главную</a>
        </div>
      </div>`;
  }

  async function renderHomePrompts() {
    if (isProjectHash()) return;
    const dashboard = document.querySelector(".dashboard");
    if (!dashboard || $("appView").hidden || dashboard.closest("[hidden]") ||
        $("projectReturnPrompts") || dashboard.dataset.projectPromptsLoading) return;
    const epoch = authEpoch();
    dashboard.dataset.projectPromptsLoading = "true";
    try {
      const data = await api("/api/project-courses/prompts");
      if (!screenActive(dashboard, epoch) || dashboard.closest("[hidden]") ||
          $("projectReturnPrompts") || !data.prompts?.length) return;
      const box = document.createElement("div");
      box.id = "projectReturnPrompts";
      box.className = "project-return-list";
      box.innerHTML = data.prompts.map((p) => `
        <div class="project-return ${accentClass(p)}">
          ${emblemHtml(p, "sm")}
          <div class="project-return-body">
            <span class="dash-label">${esc(p.quest_label || "Вернуться к квесту")}</span>
            <b>${esc(p.short_title || p.course_title)}</b>
            <p>${esc(p.message)}</p>
          </div>
          <div class="project-return-actions">
            <a class="btn dark project-return-open" data-course="${esc(p.course_id)}" data-stage="${esc(p.stage_id)}" href="${esc(p.href)}">Продолжить главу</a>
            <button class="link-btn project-return-dismiss" data-course="${esc(p.course_id)}" data-stage="${esc(p.stage_id)}">скрыть</button>
          </div>
        </div>`).join("");
      const bento = dashboard.querySelector(".bento");
      dashboard.insertBefore(box, bento || dashboard.firstChild);
      box.addEventListener("click", async (e) => {
        const dismiss = e.target.closest(".project-return-dismiss");
        if (!dismiss) return;
        await post("/api/project-courses/prompts/dismiss", {
          course_id: dismiss.dataset.course,
          stage_id: dismiss.dataset.stage,
        });
        dismiss.closest(".project-return")?.remove();
        if (!box.querySelector(".project-return")) box.remove();
      });
    } catch (e) {
      if (e.status !== 401) console.warn("project prompts unavailable", e);
    } finally {
      delete dashboard.dataset.projectPromptsLoading;
    }
  }

  function handleRoute() {
    const projectMatch = location.hash.match(projectRouteRe);
    if (location.hash === "#/projects") {
      renderCourseList();
      return;
    }
    const showcaseRoute = parseShowcaseRoute();
    if (showcaseRoute) {
      if (showcaseRoute.view === "create") renderShowcaseCreate();
      else if (showcaseRoute.view === "detail") renderShowcaseDetail(showcaseRoute.cardId);
      else renderShowcase();
      return;
    }
    if (projectMatch && projectMatch[2]) {
      renderStage(projectMatch[1], projectMatch[2]);
      return;
    }
    if (projectMatch) {
      renderCourseDetail(projectMatch[1]);
      return;
    }
  }

  window.ProjectCourses = { renderRoute: handleRoute, renderHomePrompts };
})();
