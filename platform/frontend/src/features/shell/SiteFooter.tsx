import { useEffect, useState } from "react";
import { contentRepository } from "../../content/ContentRepository";

/**
 * Legacy listView footer — CPython/Pyodide badge + topic/task counts.
 * Shown on home and topics catalog (same surfaces as vanilla listView).
 */
export function SiteFooter() {
  const [counts, setCounts] = useState<{ topics: number; tasks: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await contentRepository.ensureLoaded();
        if (cancelled) return;
        const topics = contentRepository.getCatalogTopics();
        const tasks = topics.reduce((n, t) => n + t.tasks.length, 0);
        setCounts({ topics: topics.length, tasks });
      } catch {
        if (!cancelled) setCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="footer">
      <span>
        Исполняемые эталоны проверены в CPython 3.14 · код запускается в Pyodide
        (CPython 3.14)
      </span>
      <span>
        {counts
          ? `${counts.topics} тем · ${counts.tasks} заданий`
          : ""}
      </span>
    </footer>
  );
}
