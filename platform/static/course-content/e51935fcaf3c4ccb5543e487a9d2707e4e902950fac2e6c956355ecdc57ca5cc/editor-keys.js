/* Native code-editor keys and touch controls; no execution or storage. */
window.EditorKeys = (function () {
  if (window.EditorKeys) return window.EditorKeys;
  const viewport = window.visualViewport;
  const mobileMedia = window.matchMedia?.("(max-width: 900px) and (pointer: coarse)");
  const bindings = new WeakMap();
  let floating = null, owner = null, opened = false, extra = false, hold = null, suppressRelease = false;
  let frame = 0, revealFrame = 0, adjustedDrawer = null, revealRequested = false;
  const variants = {
    "⇥": ["⇤", "⇥2", "·"], "⇤": ["⇥", "Home", "⇥2"], "↵": ["↵0", "↑↵", "↵↵"],
    "()": ["[]", "{}", "print"], "[]": ["()", "{}", "len"], "{}": ["()", "[]"],
    ":": ["=", "==", ":="], "=": ["==", "!=", "<=", ">="],
    "←": ["Home", "↑↑", "←w"], "→": ["End", "↓↓", "w→"],
    "''": ['""', "'''", "r''"], '""': ["''", '"""', 'f""'],
    "⌨": ["print", "#", "()"], "⋯": [",", ".", "#", "\\"],
    "Home": ["↑↑", "←w", "End"], "End": ["↓↓", "w→", "Home"],
  };
  const names = { "⇤": "Убрать отступ", "⇥": "Вставить отступ: четыре пробела", "⇥2": "Два отступа: восемь пробелов", "·": "Вставить пробел",
    "↵0": "Новая строка без отступа", "↑↵": "Пустая строка выше", "↵↵": "Пропустить строку",
    "()": "Круглые скобки", "[]": "Квадратные скобки", "{}": "Фигурные скобки", "print": "Обёрнуть в print", "len": "Обёрнуть в len",
    "Home": "К началу строки", "End": "К концу строки", "↑↑": "К началу кода", "↓↓": "К концу кода", "←w": "На слово влево", "w→": "На слово вправо",
    "=": "Знак равенства", "==": "Проверка равенства", "!=": "Не равно", "<=": "Меньше или равно", ">=": "Больше или равно", ":=": "Присваивание в выражении",
    "''": "Одинарные кавычки", '""': "Двойные кавычки", "'''": "Тройные одинарные кавычки", '"""': "Тройные двойные кавычки", "r''": "Сырая строка", 'f""': "Форматированная строка",
    ",": "Запятая", ".": "Точка", "#": "Начало комментария", "\\": "Обратная косая черта" };
  function cancelHold() { if (hold?.timer != null) clearTimeout(hold.timer); hold?.button.classList.remove("is-pressed"); hold = null; }
  function consumedRelease() { return suppressRelease; }
  function preventHeldRelease(event) { if (suppressRelease) event.preventDefault(); }
  const validEditor = editor => editor?.isConnected && bindings.has(editor) &&
    !editor.closest?.('[hidden],[inert],[aria-hidden="true"]') && bindings.get(editor).available();
  const resolveEditor = () => {
    const active = document.activeElement;
    if (validEditor(active)) return active;
    if (!validEditor(owner)) return null;
    if (floating?.root.contains(active)) return owner;
    // Keep an intentionally opened toolbar while reading or using task buttons.
    // Other text fields/dialogs suspend it so their input cannot reach the code.
    return opened && !active?.matches?.('input,textarea,[contenteditable="true"]') &&
      !active?.closest?.('dialog,[role="dialog"],[aria-modal="true"]') ? owner : null;
  };
  function closeKeys() {
    cancelHold(); suppressRelease = false;
    opened = false; extra = false;
    if (floating) {
      floating.keys.hidden = true;
      floating.trigger.setAttribute("aria-expanded", "false");
      floating.trigger.setAttribute("aria-label", "Клавиши редактора");
      floating.trigger.textContent = "⌨";
    }
    document.body?.classList.remove("editor-key-menu-open");
  }
  function hideKeys() {
    cancelHold(); suppressRelease = true; owner = null;
    document.body?.classList.remove("editor-key-menu-open");
    if (floating) {
      floating.root.hidden = true;
      floating.root.style.removeProperty("--editor-key-shift-y"); floating.shiftY = 0;
    }
  }
  function ensureKeys() {
    if (floating || !document.body) return floating;
    const root = document.createElement("div");
    root.className = "sandbox-fab editor-key-fab"; root.id = "editorKeyFab"; root.hidden = true;
    const trigger = document.createElement("button");
    trigger.type = "button"; trigger.id = "editorKeysToggle"; trigger.className = "editor-key-trigger"; trigger.textContent = "⌨";
    trigger.setAttribute("aria-label", "Клавиши редактора");
    trigger.setAttribute("aria-controls", "editorFloatingKeys"); trigger.setAttribute("aria-expanded", "false");
    const keys = document.createElement("div");
    keys.id = "editorFloatingKeys"; keys.className = "editor-floating-keys"; keys.hidden = true;
    keys.setAttribute("role", "group"); keys.setAttribute("aria-label", "Дополнительные клавиши кода");
    let alternatives = null;
    function attachTap(button, action) {
      const activate=()=>{
        if(action()!==true || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
        button.classList.remove('is-tapped');void button.offsetWidth;button.classList.add('is-tapped');
      };
      button.addEventListener('animationend',event=>{if(event.target===button)button.classList.remove('is-tapped');});
      button.addEventListener("click",event=>{
        if(event.isTrusted&&event.detail===0)suppressRelease=false;
        activate();
      });
      button.addEventListener("pointerup", event => {
        if (!["touch", "pen"].includes(event.pointerType) || hold?.button !== button || hold.timer == null || hold.pointerId !== event.pointerId) return;
        event.preventDefault(); cancelHold(); activate();
        // A touch action may hide its key. Block the compatibility click and
        // underlying page controls, as for held alternatives, until a new input.
        suppressRelease = true;
      });
    }
    const alternateGroup = document.createElement("div");
    alternateGroup.id = "editorKeyAlternatives"; alternateGroup.className = "editor-key-alternatives"; alternateGroup.hidden = true;
    function attachHold(button, label, allowClosed = false) {
      button.title += ". Удерживайте для вариантов";
      button.setAttribute("aria-description", "Удерживайте для дополнительных вариантов");
      const showAlternatives = () => {
        if (!mobileMedia?.matches || !validEditor(owner) || !bindings.get(owner).writable() || resolveEditor() !== owner || (!opened && !allowClosed)) return;
        alternatives = (variants[label] || [",", ".", "#", "\\"]).filter(value => value !== label);
        alternateGroup.dataset.key = label;
        alternateGroup.setAttribute("aria-label", "Варианты: " + (names[label] || label));
        alternateGroup.replaceChildren();
        alternatives.forEach((value, index) => {
          const alternative = document.createElement("button");
          alternative.type = "button"; alternative.className = "editor-touch-key editor-key-alternative"; alternative.textContent = value;
          alternative.setAttribute("aria-label", names[value]); alternative.title = names[value];
          const positions = [[0,-64],[0,-136],[68,-118],[118,-68]];
          alternative.style.setProperty("--key-x", positions[index][0] + "px");
          alternative.style.setProperty("--key-y", positions[index][1] + "px");
          attachTap(alternative, () => {
            if (consumedRelease() || !opened || alternateGroup.hidden || !alternateGroup.contains(alternative) || floating?.root.hidden || resolveEditor() !== owner || !validEditor(owner)) return false;
            return bindings.get(owner).execute(value);
          });
          attachHold(alternative, value); alternateGroup.appendChild(alternative);
        });
        opened = true; showPage(); keys.hidden = false; trigger.textContent = "×";
        trigger.setAttribute("aria-expanded", "true"); trigger.setAttribute("aria-label", "Закрыть клавиши");
        document.body.classList.add("editor-key-menu-open");
      };
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        cancelHold(); suppressRelease = false;
        if (!validEditor(owner)) return;
        const heldOwner = owner;
        button.classList.add("is-pressed");
        const gesture = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: null }; hold = gesture;
        gesture.timer = setTimeout(() => {
          if (hold !== gesture) return;
          if (owner !== heldOwner || !validEditor(heldOwner) || resolveEditor() !== heldOwner || button.hidden) { cancelHold(); return; }
          gesture.timer = null; suppressRelease = true; showAlternatives();
        }, 450);
      });
      // Also stays on an alternate button that is replaced during a new hold.
      button.addEventListener("touchend", preventHeldRelease, { passive: false });
      button.addEventListener("contextmenu", event => { event.preventDefault(); cancelHold(); if (!button.hidden) showAlternatives(); });
    }
    const entries = [
      ["⇥", "Вставить отступ: четыре пробела", 0, -64, false],
      ["↵", "Новая строка с отступом", 0, -136, false],
      ["()", "Круглые скобки", 68, -118, false],
      [":", "Двоеточие", 118, -68, false],
      ["←", "Переместить курсор влево", 64, 0, false],
      ["→", "Переместить курсор вправо", 136, 0, false],
      ["⇤", "Убрать отступ", 0, -64, true],
      ["[]", "Квадратные скобки", 0, -136, true],
      ["{}", "Фигурные скобки", 68, -118, true],
      ["''", "Одинарные кавычки", 118, -68, true],
      ['""', "Двойные кавычки", 64, 0, true],
      ["=", "Знак равенства", 136, 0, true],
    ];
    const buttons = entries.map(([label, description, x, y, second]) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "editor-touch-key"; button.textContent = label;
      button.setAttribute("aria-label", description); button.title = description;
      button.style.setProperty("--key-x", x + "px"); button.style.setProperty("--key-y", y + "px");
      attachTap(button, () => {
        if (consumedRelease()) return false;
        const target = resolveEditor();
        if (!opened || button.hidden || !root.contains(button) || floating?.root.hidden || target !== owner || !validEditor(target)) return false;
        return bindings.get(target).execute(label);
      });
      attachHold(button, label);
      keys.appendChild(button); return { button, second };
    });
    const more = document.createElement("button");
    more.type = "button"; more.id = "editorKeysMore"; more.className = "editor-key-more";
    more.style.setProperty("--key-x", "64px"); more.style.setProperty("--key-y", "-64px");
    const showPage = () => {
      for (const item of buttons) item.button.hidden = !!alternatives || item.second !== extra;
      alternateGroup.hidden = !alternatives;
      more.textContent = alternatives || extra ? "↶" : "⋯";
      const label = alternatives ? "Назад к клавишам" : extra ? "Основные клавиши" : "Ещё клавиши";
      more.setAttribute("aria-label", label); more.title = label + ". Удерживайте для вариантов";
    };
    attachTap(more, () => { if (consumedRelease()) return false; if (opened && !root.hidden && resolveEditor() === owner) { if (alternatives) alternatives = null; else extra = !extra; showPage(); return true; } return false; });
    attachHold(more, "⋯");
    attachTap(trigger, () => {
      if (consumedRelease()) return false;
      if (!mobileMedia?.matches || resolveEditor() !== owner || !validEditor(owner)) return false;
      if (opened) { closeKeys(); return true; }
      alternatives = null; opened = true; showPage(); keys.hidden = false;
      trigger.textContent = "×"; trigger.setAttribute("aria-label", "Закрыть клавиши");
      trigger.setAttribute("aria-expanded", "true"); document.body.classList.add("editor-key-menu-open");
      return true;
    });
    trigger.title = "Клавиши редактора"; attachHold(trigger, "⌨", true);
    root.addEventListener("pointerdown", event => {
      // Keep the native caret and soft keyboard while a floating control is tapped.
      if (event.isPrimary !== false && event.button === 0) event.preventDefault();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(type, cancelHold);
    // The held key becomes hidden when its alternatives appear. Cancel the
    // touch release's compatibility mouse/click sequence before it can retarget
    // a page control underneath that former key (for example Submit).
    root.addEventListener("touchend", preventHeldRelease, { passive: false });
    root.addEventListener("pointermove", event => { if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 12) { cancelHold(); suppressRelease = true; } });
    root.addEventListener("keydown", () => { suppressRelease = false; });
    keys.appendChild(alternateGroup); keys.appendChild(more); root.appendChild(keys); root.appendChild(trigger); document.body.appendChild(root);
    floating = { root, trigger, keys, shiftY: 0,
      commands:()=>buttons.map(item=>item.button).concat(Array.from(alternateGroup.children)),
      resetPage(){alternatives=null;extra=false;showPage();} }; showPage(); return floating;
  }
  function syncKeys(editor) {
    if (!mobileMedia?.matches || !validEditor(editor) || Math.abs((viewport?.scale || 1) - 1) > .05) { hideKeys(); return; }
    const ui = ensureKeys(); if (!ui) return;
    if (owner !== editor) { cancelHold(); if(owner)suppressRelease=true; ui.resetPage(); } owner = editor;
    ui.root.hidden = false;
    ui.keys.hidden = !opened;
    document.body.classList.toggle('editor-key-menu-open',opened);
    const composing = !bindings.get(editor).writable();
    ui.trigger.disabled = false;
    ui.commands().forEach(button=>{button.disabled=composing;});
    ui.root.classList.toggle("editor-key-composing", composing);
    ui.trigger.title = opened ? "Закрыть клавиши" : "Клавиши редактора. Удерживайте для вариантов";
    const height = Math.min(viewport?.height || window.innerHeight, window.innerHeight);
    ui.root.classList.toggle("editor-key-compact", height < 240);
    // Same CSS bottom is insufficient when the browser only lifts the mentor's
    // composited layer. Align actual boxes, then clamp to the visible keyboard
    // viewport. Subtract our previous shift so repeated events cannot accumulate.
    const rect = ui.root.getBoundingClientRect();
    const mentor = document.getElementById?.("sandboxFab");
    const anchor = !mentor?.hidden && mentor?.getBoundingClientRect();
    const top = viewport?.offsetTop || 0;
    const visibleBottom = top + height - 12;
    const anchorBottom = anchor?.height > 0 ? anchor.bottom : visibleBottom;
    const bottom = Math.max(top + rect.height, Math.min(anchorBottom, visibleBottom));
    const shift = Math.round((bottom - (rect.bottom - ui.shiftY)) * 100) / 100;
    if (Number.isFinite(shift) && shift !== ui.shiftY) {
      ui.shiftY = shift;
      ui.root.style.setProperty("--editor-key-shift-y", shift + "px");
    }
  }
  const resetDrawer = () => {
    adjustedDrawer?.style.removeProperty("--input-viewport-height");
    adjustedDrawer?.style.removeProperty("--input-keyboard-inset");
    adjustedDrawer = null;
  };
  const resetViewport = () => {
    if (revealFrame) window.cancelAnimationFrame(revealFrame);
    revealFrame = 0;
    resetDrawer();
    document.documentElement?.style?.removeProperty("--input-viewport-height");
    document.documentElement?.style?.removeProperty("--input-keyboard-inset");
    document.body?.classList.remove("editor-input-focus");
  };
  const syncViewport = () => {
    frame = 0;
    const shouldReveal = revealRequested; revealRequested = false;
    const codeEditor = resolveEditor();
    syncKeys(codeEditor);
    const active = codeEditor || document.activeElement;
    const eligible = active?.isConnected && active.matches?.("textarea.editor,textarea.sandbox-editor,textarea.project-editor,input.live-term-input");
    if (!eligible || Math.abs((viewport?.scale || 1) - 1) > .05) { resetViewport(); return; }
    const drawer = active.closest?.(".sandbox-drawer.open");
    if (adjustedDrawer !== drawer) resetDrawer();
    const mobile = window.matchMedia?.("(max-width: 720px), (pointer: coarse)")?.matches;
    if (mobile && viewport) {
      document.documentElement?.style?.setProperty("--input-viewport-height", Math.max(1, viewport.height) + "px");
      document.documentElement?.style?.setProperty("--input-keyboard-inset", Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) + "px");
    }
    else document.documentElement?.style?.removeProperty("--input-viewport-height");
    document.body?.classList.toggle("editor-input-focus", !!(mobileMedia?.matches && !drawer));
    if (drawer && mobile && viewport) {
      adjustedDrawer = drawer;
      drawer.style.setProperty("--input-viewport-height", Math.max(1, viewport.height) + "px");
      drawer.style.setProperty("--input-keyboard-inset", Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) + "px");
    }
    if (!shouldReveal || (codeEditor && document.activeElement!==codeEditor && !floating?.root.contains(document.activeElement))) return;
    if (revealFrame) window.cancelAnimationFrame(revealFrame);
    // Scroll after the viewport CSS has laid out the nested output scroller.
    // Reading scrollHeight in the same frame can still use its previous height.
    revealFrame = window.requestAnimationFrame(() => {
      revealFrame = 0;
      if ((document.activeElement !== active && resolveEditor() !== active) || !active.isConnected) return;
      const stdin = active.tagName === "INPUT";
      const terminal = stdin && active.closest?.(".terminal-body");
      if (terminal) terminal.scrollTop = terminal.scrollHeight;
      const target = (stdin && active.closest?.(".live-term-input-row")) || active;
      const rect = target.getBoundingClientRect?.();
      const top = viewport?.offsetTop || 0, bottom = top + (viewport?.height || window.innerHeight);
      if (rect && (rect.bottom > bottom - 12 || rect.top < top + 12)) target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      // The layout viewport can remain taller than the visible keyboard viewport.
      // Native nearest scrolling alone then considers this field already visible.
      if (!drawer) {
        const visible = target.getBoundingClientRect?.();
        if (visible) {
          const delta = visible.top < top + 12 ? visible.top - top - 12 : visible.bottom > bottom - 12
            ? (stdin ? Math.min(visible.bottom - bottom + 12, visible.top - top - 12) : visible.top - top - 12) : 0;
          if (Math.abs(delta) > 1) window.scrollBy?.(0, delta);
        }
      }
    });
  };
  const scheduleViewport = event => {
    if (event?.type !== "scroll") revealRequested = true;
    if (!frame && typeof window.requestAnimationFrame === "function") frame = window.requestAnimationFrame(syncViewport);
  };
  if (typeof document.addEventListener === "function") {
    viewport?.addEventListener("resize", scheduleViewport);
    viewport?.addEventListener("scroll", scheduleViewport);
    document.addEventListener("focusin", scheduleViewport);
    document.addEventListener("focusout", scheduleViewport);
    document.addEventListener("pointerdown", event => { if (floating && !floating.root.contains(event.target)) { cancelHold(); suppressRelease=true; } }, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && opened && resolveEditor() === owner) {
        event.preventDefault(); event.stopPropagation(); owner?.focus({ preventScroll: true });
      }
    }, true);
    window.addEventListener("resize", scheduleViewport);
    mobileMedia?.addEventListener?.("change", () => { hideKeys(); scheduleViewport(); });
    window.addEventListener("hashchange", () => { hideKeys(); scheduleViewport(); });
    window.addEventListener('pageshow',scheduleViewport);
    window.addEventListener("pagehide", () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0; revealRequested = false; hideKeys(); resetViewport();
    });
  }
  return Object.freeze({
  bind(editor) {
    if (!editor) return;
    if (editor.dataset.keyboardBound) return bindings.get(editor);
    editor.dataset.keyboardBound = "true";
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocorrect", "off");
    editor.setAttribute("autocomplete", "off");
    const hint = document.createElement("p");
    hint.id = editor.id + "KeyboardHint";
    hint.className = "editor-keyboard-hint";
    hint.role = "status";
    let tabMovesFocus = false, composing = false;
    const update = () => { hint.textContent = tabMovesFocus
      ? "Tab — переход · Ctrl+M — снова отступ"
      : "Tab — отступ · Ctrl+M — переход клавишей Tab"; };
    update();
    editor.insertAdjacentElement("afterend", hint);
    editor.setAttribute("aria-describedby", [editor.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
    const shortcuts = editor.getAttribute("aria-keyshortcuts") || "";
    editor.setAttribute("aria-keyshortcuts", [...new Set((shortcuts + " Control+M").trim().split(/\s+/))].join(" "));
    const available = () => editor.isConnected !== false && !editor.disabled && !editor.readOnly;
    const writable = () => available() && !composing;
    const notify = () => editor.dispatchEvent(new Event("input", { bubbles: true }));
    const replace = (text, start = editor.selectionStart, end = editor.selectionEnd, selected) => {
      const direction = editor.selectionDirection;
      const before = editor.value;
      let inputSeen = false, inserted = false;
      const observed = () => { inputSeen = true; };
      editor.addEventListener("input", observed);
      try {
        // Plain-text native insertion preserves the browser's undo history.
        // Keep a native textarea fallback where this editing command is absent.
        if (document.activeElement === editor && typeof document.execCommand === "function") {
          editor.setSelectionRange(start, end);
          try { inserted = document.execCommand("insertText", false, text) || editor.value !== before; } catch (_) {}
        }
        if (!inserted) editor.setRangeText(text, start, end, "end");
      } finally { editor.removeEventListener("input", observed); }
      if (selected) editor.setSelectionRange(selected[0], selected[1], direction);
      if (!inputSeen) notify();
      return true;
    };
    const lineRange = () => {
      const start = editor.selectionStart, end = editor.selectionEnd;
      const first = start ? editor.value.lastIndexOf("\n", start - 1) + 1 : 0;
      const last = end > start && editor.value[end - 1] === "\n" ? end - 1 : end;
      const next = editor.value.indexOf("\n", last);
      return { start, end, first, last: next < 0 ? editor.value.length : next };
    };
    const indent = (width = 4) => {
      const { start, end, first, last } = lineRange();
      if (!editor.value.slice(start, end).includes("\n")) return replace(" ".repeat(width));
      const lines = editor.value.slice(first, last).split("\n");
      replace(lines.map(line => " ".repeat(width) + line).join("\n"), first, last,
        [start + width, end + width * lines.length]);
    };
    const outdent = () => {
      const { start, end, first, last } = lineRange();
      const lines = editor.value.slice(first, last).split("\n");
      const removed = lines.map(line => (line.match(/^(?: {1,4}|\t)/) || [""])[0].length);
      const total = removed.reduce((sum, count) => sum + count, 0);
      if (!total) return;
      const selectionStart = Math.max(first, start - removed[0]);
      replace(lines.map((line, index) => line.slice(removed[index])).join("\n"), first, last,
        [selectionStart, Math.max(selectionStart, end - total)]);
    };
    const newline = () => {
      const start = editor.selectionStart;
      const prefix = editor.value.slice(start ? editor.value.lastIndexOf("\n", start - 1) + 1 : 0, start);
      replace("\n" + (prefix.match(/^[ \t]*/) || [""])[0] + (prefix.trimEnd().endsWith(":") ? "    " : ""));
    };
    const pair = (open, close) => {
      const start = editor.selectionStart, end = editor.selectionEnd;
      replace(open + editor.value.slice(start, end) + close, start, end, [start + open.length, end + open.length]);
    };
    const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
    const move = direction => {
      const { value, selectionStart: start, selectionEnd: end } = editor;
      let position = direction < 0 ? start : end;
      if (start === end && segmenter) {
        position = direction < 0 ? 0 : value.length;
        for (const part of segmenter.segment(value)) {
          if (direction < 0 && part.index < start) position = part.index;
          if (direction > 0 && part.index > end) { position = part.index; break; }
        }
      } else if (start === end) {
        const text = direction < 0 ? [...value.slice(0, start)].at(-1) : [...value.slice(end)][0];
        position += direction * (text?.length || 0);
      }
      editor.setSelectionRange(position, position);
    };
    const wordSegmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
    const moveWord = direction => {
      const value = editor.value, start = editor.selectionStart, end = editor.selectionEnd;
      if (start !== end) { editor.setSelectionRange(direction < 0 ? start : end, direction < 0 ? start : end); return; }
      const words = wordSegmenter ? [...wordSegmenter.segment(value)].filter(part => part.isWordLike)
        : [...value.matchAll(/\S+/g)].map(match => ({ index: match.index, segment: match[0] }));
      const next = direction > 0 ? words.find(part => part.index + part.segment.length > end) : null;
      const position = direction < 0 ? (words.filter(part => part.index < start).at(-1)?.index ?? 0)
        : next ? next.index + next.segment.length : value.length;
      editor.setSelectionRange(position, position);
    };
    const moveTo = position => editor.setSelectionRange(position, position);
    const lineAbove = () => {
      const { first, last } = lineRange(), space = (editor.value.slice(first, last).match(/^[ \t]*/) || [""])[0];
      replace(space + "\n", first, first, [first + space.length, first + space.length]);
    };
    const commands = { "⇥": indent, "⇤": outdent, "↵": newline, "←": () => move(-1), "→": () => move(1),
      "()": () => pair("(", ")"), "[]": () => pair("[", "]"), "{}": () => pair("{", "}"),
      "''": () => pair("'", "'"), '""': () => pair('"', '"'), ":": () => replace(":"), "=": () => replace("=") };
    Object.assign(commands, { "⇥2": () => indent(8), "·": () => replace(" "), "↵0": () => replace("\n"), "↑↵": lineAbove,
      "↵↵": () => { const prefix = editor.value.slice(lineRange().first, editor.selectionStart); replace("\n\n" + (prefix.match(/^[ \t]*/) || [""])[0]); },
      "Home": () => moveTo(lineRange().first), "End": () => moveTo(lineRange().last), "↑↑": () => moveTo(0), "↓↓": () => moveTo(editor.value.length),
      "←w": () => moveWord(-1), "w→": () => moveWord(1), "print": () => pair("print(", ")"), "len": () => pair("len(", ")"),
      "'''": () => pair("'''", "'''"), '"""': () => pair('"""', '"""'), "r''": () => pair("r'", "'"), 'f""': () => pair('f"', '"'),
      "#": () => replace("# ") });
    for (const symbol of ["==", "!=", "<=", ">=", ":=", ",", ".", "\\"]) commands[symbol] = () => replace(symbol);
    const binding = Object.freeze({ available, writable, execute(label) {
      if (!writable() || !Object.hasOwn(commands, label)) return false;
      editor.focus({ preventScroll: true }); commands[label](); scheduleViewport(); return true;
    } });
    bindings.set(editor, binding);
    if (typeof MutationObserver !== "undefined") {
      // Observes this textarea only; detached editors have no global owner/listener.
      new MutationObserver(scheduleViewport).observe(editor, { attributes: true, attributeFilter: ["disabled", "readonly"] });
    }
    editor.addEventListener("compositionstart", () => { composing = true; if (owner === editor)cancelHold(); scheduleViewport(); });
    editor.addEventListener("compositionend", () => { composing = false; scheduleViewport(); });
    editor.addEventListener("keydown", event => {
      if (event.isComposing || event.keyCode === 229 || !writable()) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
          (event.code === "KeyM" || event.key.toLowerCase() === "m") && !event.repeat) {
        event.preventDefault();
        tabMovesFocus = !tabMovesFocus;
        update();
      } else if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !tabMovesFocus) {
        event.preventDefault();
        // Keep the established hardware-Tab contract, including selection replacement.
        replace("    ");
      }
    });
    return binding;
  },
  });
})();
