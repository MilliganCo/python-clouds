/* runner-worker.js — Pyodide в отдельном потоке.
 * Главный поток больше не блокируется; бесконечный цикл убивается terminate()
 * из runner.js по таймауту. Протокол сообщений:
 *   → { id, code, check? }                 — запуск; проверка в том же namespace с отдельным выводом
 *   ← { type: "status", text }             — прогресс загрузки
 *   ← { type: "ready" }                    — интерпретатор готов
 *   ← { type: "result", id, stdout, error, failure, user_stdout, check_stdout }
 *     failure: { type, message, line, source: "solution"|"check" } | null
 *
 *   → { id, code, interactive: true, sab: { control, data } } — интерактивный запуск
 *   ← { type: "output", id, chunk }        — часть вывода, как только напечатана
 *   ← { type: "input_request", id }        — программа вызвала input(), ждём ответ
 *   ← { type: "done", id, error }          — интерактивный запуск завершён
 *
 * Интерактивный ввод: sab.control — Int32Array(2) в SharedArrayBuffer,
 * [0] = состояние (0 свободно, 1 воркер ждёт, 2 ответ готов), [1] = длина
 * ответа в байтах. sab.data — Uint8Array(MAX_INPUT_BYTES) с самим ответом
 * (UTF-8). Воркер блокируется через Atomics.wait — ГЛАВНЫЙ поток не блокируется,
 * он пишет ответ в data и будит воркер через Atomics.notify.
 */
// Fail closed even when this asset is opened outside the application facade.
throw new Error('EXECUTION_BLOCKED: безопасная изоляция Python ещё не обеспечена.');
const CDN = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/"; // CPython 3.14 — совпадает с Android

self.postMessage({ type: "status", text: "Загружаю Python (~10 МБ, один раз)…" });
importScripts(CDN + "pyodide.js");

const pyReady = loadPyodide({ indexURL: CDN }).then((py) => {
  self.postMessage({ type: "ready" });
  self.postMessage({ type: "status", text: "" });
  return py;
}).catch(err => { self.postMessage({ type: 'load_error' }); throw err; });
pyReady.catch(() => {});
let inputReply = null;

const WRAPPER = `
import sys, io, traceback, json, ast
_buf = io.StringIO()
_old = sys.stdout
sys.stdout = _buf
_err = None
_failure = None
_user_stdout = None
_check_stdout = None
_report = globals().get("_report_test")
_active_test = None
_test_states = {}
_old_trace = sys.gettrace()
def _emit_test(event):
    if _report:
        _report(json.dumps(event, ensure_ascii=False))
def _trace_tests(frame, event, arg):
    global _active_test
    if frame.f_code.co_filename != "<проверка>" or frame.f_code.co_name != "<module>":
        return None
    if event == "exception":
        if _active_test is not None:
            _emit_test({"type": "test", "id": _active_test, "state": "failed", "message": str(arg[1])})
            _test_states[_active_test] = "failed"
            _active_test = None
    elif event in ("line", "return"):
        current = _test_lines.get(frame.f_lineno) if event == "line" else None
        if _active_test is not None and current != _active_test:
            if _test_states.get(_active_test) != "passed":
                _emit_test({"type": "test", "id": _active_test, "state": "passed"})
                _test_states[_active_test] = "passed"
            _active_test = None
        if current is not None and _active_test is None:
            _active_test = current
            if current not in _test_states:
                _emit_test({"type": "test", "id": current, "state": "running"})
                _test_states[current] = "running"
    return _trace_tests
try:
    if _report and globals().get("_tests_code"):
        _tree = ast.parse(_tests_code, filename="<проверка>")
        class _Assertions(ast.NodeVisitor):
            def __init__(self): self.nodes = []
            def visit_Assert(self, node): self.nodes.append(node)
            def visit_FunctionDef(self, node): pass
            def visit_AsyncFunctionDef(self, node): pass
            def visit_ClassDef(self, node): pass
        _visitor = _Assertions()
        _visitor.visit(_tree)
        _assertions = sorted(_visitor.nodes, key=lambda node: node.lineno)
        _test_lines = {line: index for index, node in enumerate(_assertions)
                       for line in range(node.lineno, node.end_lineno + 1)}
        _emit_test({"type": "plan", "tests": [{"id": index, "line": node.lineno,
                    "code": ast.get_source_segment(_tests_code, node)}
                   for index, node in enumerate(_assertions)]})
    _namespace = {"__name__": "__main__"}
    exec(compile(_user_code, "<решение>", "exec"), _namespace)
    if globals().get("_tests_code"):
        _user_stdout = _buf.getvalue()
        _buf = io.StringIO()
        sys.stdout = _buf
        if _report:
            sys.settrace(_trace_tests)
        exec(compile(_tests_code, "<проверка>", "exec"), _namespace)
except BaseException as _exc:
    _err = traceback.format_exc(limit=3)
    _frame = next((f for f in reversed(traceback.extract_tb(_exc.__traceback__))
                   if f.filename in ("<решение>", "<проверка>")), None)
    _syntax = isinstance(_exc, SyntaxError) and _exc.filename in ("<решение>", "<проверка>")
    _line = _exc.lineno if _syntax else (_frame.lineno if _frame else None)
    _file = _exc.filename if _syntax else (_frame.filename if _frame else None)
    _failure = json.dumps({"type": type(_exc).__name__, "message": str(_exc), "line": _line,
                           "source": "check" if _file == "<проверка>" else "solution"}, ensure_ascii=False)
finally:
    if _report:
        sys.settrace(_old_trace)
    sys.stdout = _old
    if _user_stdout is not None:
        _check_stdout = _buf.getvalue()
(_buf.getvalue() if _user_stdout is None else _user_stdout + _check_stdout, _err, _failure, _user_stdout, _check_stdout)
`;

async function prepareImports(py, code, check, id) {
  await py.loadPackagesFromImports(code + "\n" + (check || ""), {
    messageCallback: text => self.postMessage({ type: "status", text }),
  });
  self.postMessage({ type: "status", text: "" });
  self.postMessage({ type: "execution_start", id });
}

self.onmessage = async (e) => {
  if (e.data.type === 'input_answer') {
    if (inputReply?.id === e.data.id) { inputReply.resolve(e.data.answer); inputReply = null; }
    return;
  }
  const { id, code } = e.data;

  if (e.data.interactive) {
    let byteBuf = [];
    const outDecoder = new TextDecoder();
    const flush = () => {
      if (!byteBuf.length) return;
      self.postMessage({ type: "output", id, chunk: outDecoder.decode(new Uint8Array(byteBuf), { stream: true }) });
      byteBuf = [];
    };
    let flushTimer = null;
    const queueByte = (byte) => {
      byteBuf.push(byte);
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 0);
    };
    // input() печатает подсказку через тот же stdout ДО чтения строки — чтобы она
    // успела дойти до главного потока раньше input_request, flush() здесь ОБЯЗАН
    // быть синхронным (setTimeout(0) никогда не выполнится, пока Atomics.wait
    // блокирует этот же поток целиком).
    const inDecoder = new TextDecoder();
    const interactiveStdin = (control, data) => () => {
      flush();
      Atomics.store(control, 0, 1); // воркер ждёт ответ
      self.postMessage({ type: "input_request", id });
      Atomics.wait(control, 0, 1, 5 * 60 * 1000); // самовосстановление, если ответа нет 5 мин
      const len = Atomics.load(control, 1);
      const answer = inDecoder.decode(data.slice(0, len));
      Atomics.store(control, 0, 0);
      return answer + "\n";
    };
    try {
      const py = await pyReady;
      await prepareImports(py, code, null, id);
      py.setStdout({ raw: queueByte });
      py.setStderr({ raw: queueByte });
      if (e.data.sab) {
        py.setStdin({ stdin: interactiveStdin(new Int32Array(e.data.sab.control), new Uint8Array(e.data.sab.data)), isatty: true });
      } else {
        // ponytail: LAN bridge supports input(); arbitrary sys.stdin needs HTTPS or a future stream bridge.
        py.globals.set('_terminal_read', () => {
          flush();
          return new Promise(resolve => { inputReply = { id, resolve }; self.postMessage({ type: 'input_request', id }); });
        });
      }
      let error = null;
      try {
        py.globals.set('_terminal_code', code);
        py.globals.set('_terminal_shared', !!e.data.sab);
        await py.runPythonAsync(`
import builtins as _builtins
_old_input = _builtins.input
def _lan_input(prompt=''):
    from pyodide.ffi import run_sync, can_run_sync
    if not can_run_sync():
        raise RuntimeError('Для input() по локальной сети нужен современный Chrome/Edge (137+) или HTTPS. Обычный код работает без этого.')
    print(prompt, end='', flush=True)
    return run_sync(_terminal_read())
try:
    if not _terminal_shared:
        _builtins.input = _lan_input
    exec(compile(_terminal_code, '<программа>', 'exec'), {'__name__': '__main__'})
finally:
    _builtins.input = _old_input
`);
      } catch (err) {
        error = String(err && err.message ? err.message : err);
      }
      flush();
      py.setStdout({});
      py.setStderr({});
      py.setStdin({});
      self.postMessage({ type: "done", id, error });
    } catch (err) {
      self.postMessage({ type: "done", id, error: String(err) });
    }
    return;
  }

  // Решение и необязательная проверка выполняются в одном namespace.
  let stdout = "", error = null, failure = null, user_stdout = null, check_stdout = null;
  try {
    const py = await pyReady;
    await prepareImports(py, code, e.data.check, id);
    py.globals.set("_user_code", code);
    py.globals.set("_tests_code", typeof e.data.check === "string" ? e.data.check : "");
    if (e.data.reportTests) py.globals.set("_report_test", event => self.postMessage({ type: "test_event", id, event: JSON.parse(event) }));
    else py.globals.set("_report_test", false);
    const result = await py.runPythonAsync(WRAPPER);
    const pair = result.toJs();
    result.destroy();
    stdout = pair[0] || "";
    error = pair[1] || null;
    failure = pair[2] ? JSON.parse(pair[2]) : null;
    user_stdout = pair[3] ?? null;
    check_stdout = pair[4] ?? null;
  } catch (err) {
    error = String(err);
  }
  self.postMessage({ type: "result", id, stdout, error, failure, user_stdout, check_stdout });
};
