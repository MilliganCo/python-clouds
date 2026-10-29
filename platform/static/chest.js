/* Server-owned reward, native dialog and Web Animations. No client-side lottery. */
window.CloudChest = (() => {
  'use strict';
  let dialog = null, animations = [], finish = null, pending = null, physicsFrame = null;
  const cloudPath = 'M-106,30C-125,6-111,-21-86,-23C-86,-55-40,-69-17,-42C5,-67,47,-55,52,-27C88,-36,116,-8,108,18C126,48,88,61,60,57L-69,57C-94,57-112,48-106,30Z';
  const cloud = id => `<defs>
    <radialGradient id="${id}cloud" cx="35%" cy="12%" r="85%"><stop stop-color="#fff"/><stop offset=".48" stop-color="#dcf4ff"/><stop offset="1" stop-color="#6e91b5"/></radialGradient>
    <filter id="${id}shadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="12" stdDeviation="9" flood-color="#071c32" flood-opacity=".5"/></filter>
    </defs><g filter="url(#${id}shadow)"><path d="${cloudPath}" fill="url(#${id}cloud)"/>
    <path d="M-84,-18C-76,-47-40,-52-21,-30M-8,-34C9,-51,35,-39,40,-24M-86,16C-63,-1,-31,0,-12,19" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="7" stroke-linecap="round"/>
    <rect x="-15" y="22" width="30" height="25" rx="9" fill="#c5a361"/><circle cx="0" cy="32" r="4" fill="#455c72"/><path d="M0,33v7" stroke="#455c72" stroke-width="3"/>
    </g>`;
  const icon = () => `<svg viewBox="-140 -80 280 165" focusable="false" aria-hidden="true">${cloud('chestIcon')}</svg>`;

  function close() {
    if (!dialog) return;
    const node = dialog;
    dialog = null;
    cancelAnimationFrame(physicsFrame);
    animations.forEach(a => a.cancel());
    animations = [];
    finish = null;
    document.body.classList.remove('cloud-chest-open');
    node.close();
    node.remove();
  }

  function open(status, claim, launch) {
    close();
    const owner = window.getLearningAuthEpoch(), node = document.createElement('dialog');
    if (pending && pending.owner !== owner) pending = null;
    dialog = node;
    node.className = 'cloud-chest-dialog';
    node.setAttribute('aria-labelledby', 'cloudChestTitle');
    node.setAttribute('aria-describedby', 'cloudChestStatus');
    const current = () => dialog === node && node.open && owner === window.getLearningAuthEpoch();
    let selected = 5, busy = false, bonus = status.bonus_launches || 0;
    node.innerHTML = `<header class="cloud-chest-header"><div><p>Бесплатно ×5 каждый день · обновление в 03:00 МСК</p><h2 id="cloudChestTitle">Облачный сундук</h2></div><button type="button" class="cloud-chest-close" data-close aria-label="Закрыть сундук">×</button></header>
      <div class="chest-balance">Баланс: <span data-wallet-drops>${status.drops}</span> капель</div>
      <div class="galton-scene"></div>
      <footer class="cloud-chest-footer"><div class="cloud-chest-total" id="cloudChestTotal">…</div><p id="cloudChestStatus" role="status">Открываем облако…</p>
        <div class="chest-launch-controls" hidden>
          <button type="button" class="btn dark" id="cloudChestBonus"></button>
          <div class="chest-packs" role="group" aria-label="Число шаров в платном запуске">${Object.keys(status.packs).map(count => `<button type="button" data-count="${count}" aria-pressed="${Number(count) === 5}">×${count}</button>`).join('')}</div>
          <button type="button" class="btn" id="cloudChestLaunch"></button>
        </div>
        <div class="chest-actions"><button type="button" class="btn" id="cloudChestSkip" hidden>Показать итог</button><button type="button" class="btn" id="cloudChestRetry" hidden>Проверить запуск</button></div>
      </footer>`;
    document.body.append(node);
    node.querySelectorAll('[data-close]').forEach(button => button.onclick = close);
    node.addEventListener('click', event => { if (event.target === node) { const r = node.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    node.addEventListener('close', () => {
      if (dialog === node) { dialog = null; cancelAnimationFrame(physicsFrame); animations.forEach(a => a.cancel()); animations = []; finish = null; document.body.classList.remove('cloud-chest-open'); }
      node.remove();
      if (!dialog && owner === window.getLearningAuthEpoch() && document.body.classList.contains('home-mode')) document.getElementById('chestCard')?.focus();
    }, { once: true });
    node.showModal();
    document.body.classList.add('cloud-chest-open');
    node.querySelector('.cloud-chest-close').focus();
    const label = node.querySelector('#cloudChestStatus'), total = node.querySelector('#cloudChestTotal');
    const skip = node.querySelector('#cloudChestSkip'), retry = node.querySelector('#cloudChestRetry');
    const controls = node.querySelector('.chest-launch-controls'), paidButton = node.querySelector('#cloudChestLaunch');
    const bonusButton = node.querySelector('#cloudChestBonus');
    function refresh() {
      const unresolved = pending?.owner === owner;
      controls.hidden = status.ready;
      node.querySelectorAll('[data-count]').forEach(button => {
        button.disabled = busy || unresolved;
        button.setAttribute('aria-pressed', String(Number(button.dataset.count) === selected));
      });
      paidButton.textContent = `Запустить ×${selected} · ${status.packs[selected]} капель`;
      paidButton.disabled = busy || unresolved || Number(node.querySelector('[data-wallet-drops]').textContent) < status.packs[selected];
      bonusButton.textContent = `Бесплатно ×5 · в запасе ${bonus}`;
      bonusButton.hidden = bonus === 0;
      bonusButton.disabled = busy || unresolved;
    }
    function draw(board) {
      const width = board.rewards.length * 100, center = width / 2, step = 320 / board.rows;
      let pins = '';
      for (let row = 0; row < board.rows; row++) for (let j = 0; j <= row; j++)
        pins += `<circle cx="${center - row * 50 + j * 100}" cy="${145 + row * step}" r="6" fill="url(#chestPin)"/>`;
      node.querySelector('.galton-scene').innerHTML = `
        <svg viewBox="0 0 ${width} 490" aria-hidden="true" focusable="false">
          <defs><radialGradient id="chestPin" cx="30%" cy="20%"><stop stop-color="#edfaff"/><stop offset="1" stop-color="#446a88"/></radialGradient>
          <linearGradient id="chestWater" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eaffff"/><stop offset=".45" stop-color="#8bdfff"/><stop offset="1" stop-color="#3989d8"/></linearGradient></defs>
          <ellipse cx="${center}" cy="263" rx="${center * .8}" ry="186" class="galton-haze"/>
          <g class="galton-pins">${pins}</g><g class="galton-drops"></g>
          <g transform="translate(${center} 67)"><g class="galton-cloud">${cloud('chestBoard')}</g></g>
        </svg>
        <div class="galton-bins" style="--bins:${board.rewards.length}" role="list" aria-label="Награда за шар в контейнере">
          ${board.rewards.map((reward, i) => `<div class="galton-bin ${i === 0 || i === board.rewards.length - 1 ? 'rare' : ''}" role="listitem" aria-label="${reward} капель за попадание"><b>+${reward}</b><span class="galton-count">0</span><i aria-hidden="true"></i></div>`).join('')}
        </div>`;
      return { center, step };
    }
    function present(receipt, animate) {
      const result = receipt.result;
      if (!result || !Number.isInteger(result.amount) || !Array.isArray(result.paths)) throw new Error('Не удалось прочитать результат.');
      const { center, step } = draw(result.rewards ? result : status.board);
      const bins = [...node.querySelectorAll('.galton-bin')], counts = bins.map(() => 0), landed = new Set();
      let finished = false;
      busy = true;
      refresh();
      const showTotal = () => {
        busy = false;
        total.textContent = `+${result.amount} капель`;
        const net = result.amount - (receipt.cost || 0);
        label.textContent = receipt.kind === 'paid'
          ? `${animate ? 'Зачислено' : 'Сохранённый запуск'}: ${result.amount} · списано: ${receipt.cost}. Итог баланса: ${net >= 0 ? '+' : '−'}${Math.abs(net)} капель.`
          : (animate ? 'Награда зачислена.' : 'Сохранённый результат.') + (receipt.kind === 'bonus' ? ' Бонусный запуск ×5.' : ' Ежедневный сундук открыт; следующий — завтра.');
        skip.hidden = true;
        refresh();
      };
      function land(i) {
        if (!current() || landed.has(i)) return;
        landed.add(i);
        const slot = result.paths[i].reduce((a, b) => a + b, 0), bin = bins[slot];
        counts[slot]++;
        bin.querySelector('.galton-count').textContent = counts[slot];
        bin.classList.add('caught');
        bin.style.setProperty('--fill', Math.min(counts[slot] * 18, 90) + '%');
        total.textContent = '+' + counts.reduce((sum, count, k) => sum + count * result.rewards[k], 0) + ' капель';
        if (landed.size === result.paths.length) showTotal();
      }
      finish = () => { finished = true; cancelAnimationFrame(physicsFrame); animations.forEach(a => a.cancel()); animations = []; result.paths.forEach((_, i) => land(i)); node.querySelector('.galton-drops').replaceChildren(); if (!result.paths.length) showTotal(); };
      skip.onclick = finish;
      if (!result.paths.length || !animate || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) { finish(); return; }
      skip.hidden = false;
      total.textContent = '+0 капель';
      label.textContent = 'Шары падают… Результат уже сохранён; окно можно закрыть.';
      // At most 20 animated droplets, including ×100 (five successive waves).
      (async () => {
        const group = node.querySelector('.galton-drops');
        for (let wave = 0; wave < result.paths.length && current() && !finished; wave += 20) {
          const particles = [];
          let release = 0, previous = null;
          const batch = result.paths.slice(wave, wave + 20).map((path, offset) => {
            const i = wave + offset, drop = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            drop.classList.add('galton-drop');
            drop.style.opacity = '0';
            drop.innerHTML = '<g><path d="M0,-13C-4,-6-9,-2-9,4A9,9,0,1,0,9,4C9,-2,4,-6,0,-13Z" fill="url(#chestWater)"/><ellipse cx="-3" cy="2" rx="2" ry="4" fill="#fff" opacity=".8"/></g>';
            group.append(drop);
            let x = center;
            const points = [{ x: x + (Math.random() - .5) * 28, y: 108 + Math.random() * 9 }];
            path.forEach((right, row) => {
              const y = 145 + row * step, direction = right ? 1 : -1;
              points.push({ x, y: y - 13 }, { x: x + direction * 15, y: y - 22 });
              x += direction * 50;
              points.push({ x, y: y + 20 });
            });
            points.push({ x, y: 480 });
            const duration = result.paths.length > 20 ? 1400 : 2600, delay = release;
            release += 24 + Math.random() * 32;
            const animation = drop.animate(points.map((p, k) => ({ transform: `translate(${p.x}px,${p.y}px)`, opacity: 1, offset: k / (points.length - 1) })), { duration, delay, fill: 'forwards' });
            particles.push({ body: drop.firstElementChild, animation, duration, delay, points, dx: 0, dy: 0, vx: 0, vy: 0 });
            animations.push(animation);
            return animation.finished.then(() => { drop.remove(); land(i); }).catch(() => {});
          });
          // Small damped collision offsets never change the server-selected landing bin.
          function move(time) {
            if (!current() || finished) return;
            const dt = previous === null ? 1 : Math.min((time - previous) / 16.67, 2);
            previous = time;
            const active = particles.filter(p => p.body.isConnected && p.animation.playState === 'running' && p.animation.currentTime >= p.delay);
            for (const p of active) {
              p.progress = Math.min(1, (p.animation.currentTime - p.delay) / p.duration);
              const f = p.progress * (p.points.length - 1), k = Math.min(Math.floor(f), p.points.length - 2), part = f - k;
              p.x = p.points[k].x + (p.points[k + 1].x - p.points[k].x) * part + p.dx;
              p.y = p.points[k].y + (p.points[k + 1].y - p.points[k].y) * part + p.dy;
            }
            for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
              const a = active[i], b = active[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
              if (distance >= 23 || a.y > 442 || b.y > 442) continue;
              const nx = distance ? dx / distance : 1, ny = distance ? dy / distance : 0, push = (23 - distance) * .18;
              a.vx -= nx * push; a.vy -= ny * push;
              b.vx += nx * push; b.vy += ny * push;
              group.dataset.collisions = String(Number(group.dataset.collisions || 0) + 1);
            }
            for (const p of active) {
              p.vx = (p.vx - p.dx * .09 * dt) * Math.pow(.8, dt);
              p.vy = (p.vy - p.dy * .09 * dt) * Math.pow(.8, dt);
              p.dx = Math.max(-14, Math.min(14, p.dx + p.vx * dt));
              p.dy = Math.max(-7, Math.min(7, p.dy + p.vy * dt));
              const settle = Math.min(1, (1 - p.progress) * 10);
              p.body.setAttribute('transform', `translate(${p.dx * settle} ${p.dy * settle})`);
            }
            physicsFrame = requestAnimationFrame(move);
          }
          physicsFrame = requestAnimationFrame(move);
          await Promise.all(batch);
          cancelAnimationFrame(physicsFrame);
          animations = [];
        }
      })();
    }
    async function run(request = null) {
      if (busy || !current()) return;
      busy = true;
      retry.hidden = true;
      label.textContent = request ? 'Сохраняем запуск…' : 'Открываем облако…';
      refresh();
      try {
        const response = request ? await launch(request) : await claim();
        if (request && pending?.request_key === request.request_key) pending = null;
        if (!current()) return;
        status.ready = false;
        bonus = response.bonus_launches ?? bonus;
        present(request ? response : { ...response, kind: 'daily' }, !response.replay);
      } catch (error) {
        if (!current()) return;
        if ([400, 402, 409].includes(error.status)) pending = null;
        busy = false;
        total.textContent = 'Запуск не показан';
        label.textContent = error.message + (pending ? ' Проверка повторит тот же запрос, без второго списания.' : '');
        retry.hidden = !status.ready && !pending;
        refresh();
      }
    }
    node.querySelectorAll('[data-count]').forEach(button => button.onclick = () => { selected = Number(button.dataset.count); refresh(); });
    function start(kind) {
      if (busy || pending?.owner === owner) return;
      const count = kind === 'bonus' ? 5 : selected;
      const key = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      pending = { owner, kind, count, day: status.day, request_key: key };
      run(pending);
    }
    paidButton.onclick = () => start('paid');
    bonusButton.onclick = () => start('bonus');
    retry.onclick = () => run(pending?.owner === owner ? pending : null);
    if (status.ready) { draw(status.board); run(); }
    else {
      if (pending?.request_key === status.last_launch?.request_key) pending = null;
      present(status.last_launch || { result: status.result, kind: 'daily' }, false);
      if (pending?.owner === owner) { label.textContent = 'Не получен ответ предыдущего запуска. Проверьте его перед новым.'; retry.hidden = false; }
    }
  }
  window.addEventListener('hashchange', close);
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish?.(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches) finish?.(); });
  return { open, close, icon };
})();
