import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
import { pythonRunner } from "../../services/pythonRunner";
import type { RunnerError } from "../../types/runner";

type Chunk = { text: string; cls?: string };

function formatError(error: RunnerError): string {
  switch (error.kind) {
    case "python":
      return error.traceback || "Ошибка Python";
    case "timeout":
      return "Превышено время выполнения (10 секунд). Похоже на бесконечный цикл — проверьте условие выхода.";
    case "cancelled":
      return "";
    case "unsupported":
      return error.reason;
    case "worker-init":
    case "worker-crash":
      return (
        error.message ||
        "Не удалось запустить Python-раннер (нужен интернет для первой загрузки)"
      );
    case "busy":
      return "Раннер занят";
    default:
      return "Ошибка запуска";
  }
}

type Props = {
  runRef?: MutableRefObject<LiveTerminalHandle | null>;
};

export type LiveTerminalHandle = {
  run: (
    code: string,
    onStatus?: (status: string) => void,
  ) => Promise<{ error?: string }>;
  clear: () => void;
  cancel: () => void;
  setStatic: (text: string, cls?: string) => void;
};

/**
 * Port of static/terminal.js LiveTerminal for sandbox / interactive runs.
 */
export function LiveTerminal({ runRef }: Props) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputResolveRef = useRef<((value: string) => void) | null>(null);
  const runningRef = useRef(false);
  const outRef = useRef<HTMLDivElement>(null);

  const append = useCallback((text: string, cls?: string) => {
    setChunks((prev) => [...prev, { text, cls }]);
  }, []);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chunks, inputVisible]);

  useEffect(() => {
    const handle: LiveTerminalHandle = {
      async run(code, onStatus) {
        if (runningRef.current) pythonRunner.cancelInteractive();
        runningRef.current = true;
        setChunks([]);
        setInputVisible(false);
        inputResolveRef.current = null;

        const result = await pythonRunner.runInteractive(code, {
          onOutput: (chunk) => append(chunk),
          onInputRequest: () =>
            new Promise<string>((resolve) => {
              inputResolveRef.current = resolve;
              setInputValue("");
              setInputVisible(true);
            }),
          onStatus,
        });

        runningRef.current = false;
        setInputVisible(false);

        if (!result.ok) {
          if (result.error.kind === "cancelled") {
            return {};
          }
          const msg = formatError(result.error);
          if (msg) append("\n" + msg, "live-term-error");
          return { error: msg };
        }
        append("\n[программа завершена]", "live-term-done");
        return {};
      },
      clear() {
        if (runningRef.current) {
          pythonRunner.cancelInteractive();
          runningRef.current = false;
        }
        setChunks([]);
        setInputVisible(false);
        inputResolveRef.current = null;
      },
      cancel() {
        if (!runningRef.current) return;
        runningRef.current = false;
        pythonRunner.cancelInteractive();
        setInputVisible(false);
        inputResolveRef.current = null;
      },
      setStatic(text, cls) {
        if (runningRef.current) {
          pythonRunner.cancelInteractive();
          runningRef.current = false;
        }
        setInputVisible(false);
        inputResolveRef.current = null;
        setChunks(text ? [{ text, cls }] : []);
      },
    };
    if (runRef) runRef.current = handle;
    return () => {
      if (runRef) runRef.current = null;
      handle.cancel();
    };
  }, [append, runRef]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const resolve = inputResolveRef.current;
    if (!resolve) return;
    const val = inputValue;
    append(val + "\n", "live-term-echo");
    setInputVisible(false);
    inputResolveRef.current = null;
    resolve(val);
  }

  return (
    <>
      <div
        className="live-term-output"
        role="log"
        aria-live="polite"
        ref={outRef}
      >
        {chunks.map((c, i) => (
          <span key={i} className={c.cls}>
            {c.text}
          </span>
        ))}
      </div>
      <form
        className="live-term-input-row"
        hidden={!inputVisible}
        onSubmit={onSubmit}
      >
        <span className="live-term-prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          type="text"
          className="live-term-input"
          autoComplete="off"
          spellCheck={false}
          aria-label="Ответ программе"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          autoFocus={inputVisible}
        />
      </form>
    </>
  );
}
