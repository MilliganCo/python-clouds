import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocation } from "react-router-dom";
import {
  LiveTerminal,
  type LiveTerminalHandle,
} from "../../components/LiveTerminal/LiveTerminal";

const SANDBOX_KEY = "pycloud:sandbox";
const DEFAULT_CODE =
  "# Свободная песочница — пробуйте любой код\nprint('Привет, Python!')\n";
const RESET_CODE = "# Свободная песочница\n";

function hideFabOnPath(pathname: string): boolean {
  // Mentor FAB owns the slot on task pages (legacy setFabMentor).
  return pathname.startsWith("/daily/") || pathname.startsWith("/task/");
}

/**
 * Legacy sandbox FAB + drawer. Lazy-loads pythonRunner only when user runs code
 * (via LiveTerminal → pythonRunner import).
 */
export function SandboxShell() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(() => {
    try {
      return localStorage.getItem(SANDBOX_KEY) || DEFAULT_CODE;
    } catch {
      return DEFAULT_CODE;
    }
  });
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const terminalRef = useRef<LiveTerminalHandle | null>(null);
  const hideFab = hideFabOnPath(location.pathname);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const openDrawer = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    // Cancel interactive run on route change (legacy hashchange)
    terminalRef.current?.cancel();
  }, [location.pathname]);

  function persist(next: string) {
    setCode(next);
    try {
      localStorage.setItem(SANDBOX_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function onEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = code.slice(0, start) + "    " + code.slice(end);
      persist(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void onRun();
    }
  }

  async function onRun() {
    const term = terminalRef.current;
    if (!term) return;
    setRunning(true);
    try {
      await term.run(code, (s) => setStatus(s || ""));
    } finally {
      setStatus("");
      setRunning(false);
    }
  }

  function onReset() {
    persist(RESET_CODE);
    terminalRef.current?.clear();
  }

  return (
    <>
      {!hideFab ? (
        <button
          type="button"
          className="sandbox-fab"
          aria-label="Открыть песочницу"
          onClick={openDrawer}
        >
          <span className="fab-icon">▷</span> Песочница
        </button>
      ) : null}

      <aside
        className={`sandbox-drawer${open ? " open" : ""}`}
        id="sandboxDrawer"
        aria-hidden={open ? "false" : "true"}
      >
        <div className="sandbox-head">
          <div>
            <strong>Песочница Python</strong>
            <span className="sandbox-sub">
              Свободный интерпретатор · Ctrl+Enter для запуска
            </span>
          </div>
          <button
            type="button"
            className="link-btn"
            aria-label="Закрыть"
            onClick={close}
          >
            закрыть
          </button>
        </div>

        <div className="terminal-glass editable">
          <div className="terminal-label-bar">
            <span className="terminal-title">main.py</span>
          </div>
          <textarea
            ref={editorRef}
            className="sandbox-editor"
            spellCheck={false}
            placeholder={"# Пишите любой Python-код\nprint('Привет!')"}
            value={code}
            onChange={(e) => persist(e.target.value)}
            onKeyDown={onEditorKeyDown}
            aria-label="Код песочницы"
          />
        </div>

        <div className="run-row sandbox-actions">
          <button
            type="button"
            className="btn accent"
            disabled={running}
            onClick={() => void onRun()}
          >
            Запустить
          </button>
          <button type="button" className="btn" onClick={onReset}>
            Сбросить
          </button>
          <span className="run-status">{status}</span>
        </div>

        <div className="terminal-glass readonly output-terminal">
          <div className="terminal-label-bar">
            <span className="terminal-title">Вывод</span>
          </div>
          <div className="terminal-body sandbox-output">
            <LiveTerminal runRef={terminalRef} />
          </div>
        </div>
      </aside>

      <div
        className={`sandbox-scrim${open ? " active" : ""}`}
        onClick={close}
        aria-hidden="true"
      />
    </>
  );
}
