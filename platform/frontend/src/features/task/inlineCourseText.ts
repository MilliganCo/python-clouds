/**
 * Port of legacy app.js `inline()` — escape then `code` / **bold**.
 * Output is course HTML suitable for TrustedCourseContent after sanitize.
 */
export function inlineCourseText(s: string): string {
  const esc = String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
  return esc
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}
