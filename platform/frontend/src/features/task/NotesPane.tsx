import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../../services/api";
import { ContractError } from "../../services/parse";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseNote(value: unknown): { text: string } {
  if (!isObject(value) || typeof value.text !== "string") {
    throw new ContractError("Invalid GET /api/notes");
  }
  return { text: value.text };
}

function parseNoteSave(value: unknown): { ok: true } {
  if (!isObject(value) || value.ok !== true) {
    throw new ContractError("Invalid POST /api/notes");
  }
  return { ok: true };
}

type Props = { taskId: string };

/**
 * Legacy notes pane — autosave to /api/notes.
 */
export function NotesPane({ taskId }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText("");
    setStatus("");
    (async () => {
      try {
        const d = await apiGet(
          `/api/notes?task_id=${encodeURIComponent(taskId)}`,
          parseNote,
        );
        if (!cancelled) setText(d.text);
      } catch {
        /* empty */
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [taskId]);

  function onChange(next: string) {
    setText(next);
    setStatus("…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await apiPost(
          "/api/notes",
          { task_id: taskId, text: next },
          parseNoteSave,
        );
        setStatus("сохранено");
      } catch {
        setStatus("не удалось сохранить");
      }
    }, 700);
  }

  return (
    <div className="pane notes-pane">
      <h3>Мои заметки</h3>
      <textarea
        className="notes-area"
        id="notesArea"
        placeholder="Заметки к заданию: сохраняются в вашем профиле"
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="notes-status" id="notesStatus">
        {status}
      </div>
    </div>
  );
}
