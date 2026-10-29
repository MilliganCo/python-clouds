/** Shell wallet listens; mentor / shop / chest emit after balance changes. */
export const DROPS_CHANGED = "pycloud:drops";

export function emitDrops(drops: number): void {
  window.dispatchEvent(
    new CustomEvent(DROPS_CHANGED, { detail: { drops } }),
  );
}

export function onDropsChanged(
  handler: (drops: number) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ drops?: unknown }>).detail;
    if (typeof detail?.drops === "number") handler(detail.drops);
  };
  window.addEventListener(DROPS_CHANGED, listener);
  return () => window.removeEventListener(DROPS_CHANGED, listener);
}
