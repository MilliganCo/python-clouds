/** Shell rank listens; task/daily/games emit after progress changes. */
export const PROGRESS_CHANGED = "pycloud:progress";

export function emitProgressChanged(): void {
  window.dispatchEvent(new Event(PROGRESS_CHANGED));
}

export function onProgressChanged(handler: () => void): () => void {
  window.addEventListener(PROGRESS_CHANGED, handler);
  return () => window.removeEventListener(PROGRESS_CHANGED, handler);
}
