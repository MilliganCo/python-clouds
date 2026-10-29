/** Toast helpers — same `.toast` timing as legacy app.js. */

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mountToast(el: HTMLElement): void {
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  window.setTimeout(() => {
    el.classList.remove("show");
    window.setTimeout(() => el.remove(), 400);
  }, 3600);
}

/** Plain-text toast (safe). */
export function showToast(message: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  mountToast(t);
}

/**
 * Trusted HTML toast — only pass escaped / catalog strings (legacy toast(html)).
 */
export function showToastHtml(html: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = html;
  mountToast(t);
}

/** Achievement claim toast — icon + title + bonus. */
export function showAchievementToast(
  icon: string,
  title: string,
  bonus: number,
): void {
  showToastHtml(
    `<span class="toast-icon">${escapeHtml(icon)}</span>` +
      `<b>Достижение: ${escapeHtml(title)}</b><br>+${bonus} капель`,
  );
}

/** Collection set unlocked (shop / achievement side-effect). */
export function showSetUnlockedToast(
  setTitle: string,
  itemTitle: string,
): void {
  showToastHtml(
    `<span class="toast-icon">[*]</span>` +
      `<b>${escapeHtml(setTitle)}</b><br>Награда: ${escapeHtml(itemTitle)}`,
  );
}

export function showChestToast(amount: number): void {
  showToastHtml(
    `<span class="toast-icon">[=]</span>` +
      `<b>Сундук открыт!</b><br>+${amount} капель`,
  );
}

export { escapeHtml };
