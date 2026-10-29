import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import {
  catalogStageTitle,
  contentRepository,
  type ContentRepository,
} from "../../content/ContentRepository";
import { sanitizeCourseHtml } from "../../services/legacyContent";
import type { CatalogTaskModel, TaskPageModel } from "../../types/content";
import { inlineCourseText } from "./inlineCourseText";

type RailItem = {
  id: string;
  titleHtml: string;
  topicTitle: string;
  done: boolean;
  rel: "past" | "ahead" | "current";
  link: boolean;
};

function flattenCatalog(repository: ContentRepository): Array<{
  task: CatalogTaskModel;
  topicTitle: string;
}> {
  const out: Array<{ task: CatalogTaskModel; topicTitle: string }> = [];
  for (const topic of repository.getCatalogTopics()) {
    for (const t of topic.tasks) {
      out.push({ task: t, topicTitle: topic.title });
    }
  }
  return out;
}

function buildRail(
  task: TaskPageModel,
  solved: ReadonlySet<string>,
  repository: ContentRepository,
): RailItem[] {
  if (task.challenge) {
    const topicIds = repository.getTopicTaskIds(task.topicId);
    const topicTitle = task.topicTitle;
    const items: RailItem[] = topicIds.map((id) => {
      const t = repository.getTask(id);
      const meta =
        t.status === "ok"
          ? catalogStageTitle(
              {
                id: t.task.id,
                type: t.task.type,
                title: t.task.title,
                prompt: t.task.prompt,
                code: t.task.code,
                challenge: t.task.challenge,
                level: t.task.topicLevel,
              },
              40,
            )
          : id;
      return {
        id,
        titleHtml: sanitizeCourseHtml(inlineCourseText(meta)),
        topicTitle,
        done: solved.has(id),
        rel: "past" as const,
        link: true,
      };
    });
    items.push({
      id: task.id,
      titleHtml: sanitizeCourseHtml("челлендж"),
      topicTitle,
      done: solved.has(task.id),
      rel: "current",
      link: false,
    });
    return items;
  }

  const all = flattenCatalog(repository);
  const idx = all.findIndex((x) => x.task.id === task.id);
  if (idx < 0) return [];
  const start = Math.max(0, idx - 3);
  const end = Math.min(all.length, idx + 4);
  const slice = all.slice(start, end);
  return slice.map((row) => {
    const tIdx = all.findIndex((x) => x.task.id === row.task.id);
    const rel: RailItem["rel"] =
      tIdx < idx ? "past" : tIdx > idx ? "ahead" : "current";
    return {
      id: row.task.id,
      titleHtml: sanitizeCourseHtml(
        inlineCourseText(catalogStageTitle(row.task, 40)),
      ),
      topicTitle: row.topicTitle,
      done: solved.has(row.task.id),
      rel,
      link: rel !== "current",
    };
  });
}

type Props = {
  task: TaskPageModel;
  solved: ReadonlySet<string>;
  repository?: ContentRepository;
};

/**
 * Legacy course-rail aside — ±3 tasks around current (or topic tasks for challenge).
 */
export function CourseRail({
  task,
  solved,
  repository = contentRepository,
}: Props) {
  const railRef = useRef<HTMLElement>(null);
  const items = useMemo(
    () => buildRail(task, solved, repository),
    [task, solved, repository],
  );

  useEffect(() => {
    const current = railRef.current?.querySelector(
      ".course-rail-item.current",
    ) as HTMLElement | null;
    const rail = railRef.current;
    if (!current || !rail) return;
    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(max-width: 940px)").matches) return;
    requestAnimationFrame(() => {
      rail.scrollTo({
        left:
          current.offsetLeft - rail.clientWidth / 2 + current.clientWidth / 2,
        behavior: "smooth",
      });
    });
  }, [task.id, items]);

  const nodes: ReactNode[] = [];
  let lastTopic = "";
  for (const item of items) {
    if (item.topicTitle && item.topicTitle !== lastTopic) {
      nodes.push(
        <div className="course-rail-break" key={`break-${item.id}`}>
          {item.topicTitle}
        </div>,
      );
      lastTopic = item.topicTitle;
    }
    const cls = `course-rail-item ${item.rel}${item.done ? " done" : ""}`;
    const body = (
      <>
        <span className="rail-dot" aria-hidden="true" />
        <span className="rail-body">
          <span className="rail-id">{item.id}</span>
          <span className="rail-meta">
            <TrustedCourseContent html={item.titleHtml} as="span" />
          </span>
        </span>
        {item.done ? (
          <span className="rail-check" aria-label="решено">
            ✓
          </span>
        ) : item.rel === "ahead" ? (
          <span className="rail-arrow" aria-hidden="true">
            ↓
          </span>
        ) : item.rel === "past" ? (
          <span className="rail-arrow" aria-hidden="true">
            ↑
          </span>
        ) : (
          <span className="rail-here" aria-hidden="true">
            ●
          </span>
        )}
      </>
    );
    if (item.link) {
      nodes.push(
        <Link key={item.id} className={cls} to={`/task/${item.id}`}>
          {body}
        </Link>,
      );
    } else {
      nodes.push(
        <div key={item.id} className={cls} aria-current="step">
          {body}
        </div>,
      );
    }
  }

  return (
    <aside className="task-aside">
      <div className="pane course-nav-pane">
        <h3>Навигация по курсу</h3>
        <nav className="course-rail" aria-label="Задания курса" ref={railRef}>
          {nodes}
        </nav>
      </div>
    </aside>
  );
}
