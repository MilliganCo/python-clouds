import type { ReferenceTask } from "./types";

/** Эталонная программа для сравнения stdout (port of app.js). */
export function referenceProgram(task: ReferenceTask): string | null {
  const m = task.code && task.code.match(/^([ \t]*)# TODO: допишите код здесь[ \t]*$/m);
  if (task.type === "дописать код" && m) {
    const indent = m[1];
    const frag = task.answer
      .split("\n")
      .map((l) => (l ? indent + l : l))
      .join("\n");
    return task.code!.replace(m[0], frag);
  }
  if (task.type === "исправить ошибку" || task.type === "дописать код") {
    return task.answer;
  }
  return null;
}
