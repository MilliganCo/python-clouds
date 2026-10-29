import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  dismissProjectPrompt,
  fetchProjectPrompts,
  type ProjectPrompt,
} from "../../services/projectCourses";
import { Emblem, accentClass, hashToPath } from "../projects/projectUi";

/**
 * Legacy home prompts — «вернуться к квесту» above bento.
 */
export function ProjectReturnPrompts() {
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProjectPrompts();
        if (!cancelled) setPrompts(data.prompts);
      } catch {
        /* optional chrome */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prompts.length) return null;

  return (
    <div id="projectReturnPrompts" className="project-return-list">
      {prompts.map((p) => (
        <div
          key={`${p.course_id}:${p.stage_id}`}
          className={`project-return ${accentClass(p)}`}
        >
          <Emblem course={p} size="sm" />
          <div className="project-return-body">
            <span className="dash-label">
              {p.quest_label || "Вернуться к квесту"}
            </span>
            <b>{p.short_title || p.course_title}</b>
            <p>{p.message}</p>
          </div>
          <div className="project-return-actions">
            <Link
              className="btn dark project-return-open"
              to={hashToPath(p.href)}
            >
              Продолжить главу
            </Link>
            <button
              type="button"
              className="link-btn project-return-dismiss"
              onClick={() => {
                void dismissProjectPrompt(p.course_id, p.stage_id).then(() => {
                  setPrompts((prev) =>
                    prev.filter(
                      (x) =>
                        !(
                          x.course_id === p.course_id &&
                          x.stage_id === p.stage_id
                        ),
                    ),
                  );
                });
              }}
            >
              скрыть
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
