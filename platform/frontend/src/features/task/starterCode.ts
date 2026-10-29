import type { TaskPageModel } from "../../types/content";

/** Port of app.js starterCodeFor. */
export function starterCodeFor(task: Pick<TaskPageModel, "type" | "code" | "challenge">): string {
  if (task.challenge && task.code) return task.code;
  if (task.type === "написать функцию") {
    return task.code || "# Напишите функцию здесь\n";
  }
  return task.code || "";
}

export function draftKey(id: string): string {
  return `pycloud:draft:${id}`;
}
