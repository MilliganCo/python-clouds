/** Floating «+N» over the wallet pill — legacy flyDrops. */
export function flyDrops(n: number): void {
  if (!n || n <= 0) return;
  const pill =
    document.getElementById("dropsPill") ||
    document.querySelector(".drops-pill");
  if (!pill) return;
  const fly = document.createElement("span");
  fly.className = "drops-fly";
  fly.textContent = "+" + n;
  pill.appendChild(fly);
  setTimeout(() => fly.remove(), 1400);
}
