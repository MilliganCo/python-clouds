/* runner-worker.js — Pyodide module worker (Pyodide 314+ rejects classic workers).
 * Protocol matches platform/static/runner-worker.js.
 */
throw new Error('EXECUTION_BLOCKED: безопасная изоляция Python ещё не обеспечена.');
const CDN = new URL("/pyodide/", self.location.href).href;

self.postMessage({ type: "status", text: "Загружаю Python (~10 МБ, один раз)…" });

const pyReady = import(CDN + "pyodide.mjs").then(({ loadPyodide }) =>
  loadPyodide({ indexURL: CDN }).then((py) => {
    self.postMessage({ type: "ready" });
    self.postMessage({ type: "status", text: "" });
    return py;
  }),
);

const WRAPPER = `
import sys, io, traceback
_buf = io.StringIO()
_old = sys.stdout
sys.stdout = _buf
_err = None
try:
    exec(compile(_user_code, "<решение>", "exec"), {})
except BaseException:
    _err = traceback.format_exc(limit=3)
finally:
    sys.stdout = _old
(_buf.getvalue(), _err)
`;

self.onmessage = async (e) => {
  const { id, code } = e.data;

  if (e.data.interactive) {
    let byteBuf = [];
    const outDecoder = new TextDecoder();
    const flush = () => {
      if (!byteBuf.length) return;
      self.postMessage({
        type: "output",
        id,
        chunk: outDecoder.decode(new Uint8Array(byteBuf), { stream: true }),
      });
      byteBuf = [];
    };
    let flushTimer = null;
    const queueByte = (byte) => {
      byteBuf.push(byte);
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, 0);
    };
    const inDecoder = new TextDecoder();
    const interactiveStdin = (control, data) => () => {
      flush();
      Atomics.store(control, 0, 1);
      self.postMessage({ type: "input_request", id });
      Atomics.wait(control, 0, 1, 5 * 60 * 1000);
      const len = Atomics.load(control, 1);
      const answer = inDecoder.decode(data.slice(0, len));
      Atomics.store(control, 0, 0);
      return answer + "\n";
    };
    try {
      const py = await pyReady;
      const control = new Int32Array(e.data.sab.control);
      const data = new Uint8Array(e.data.sab.data);
      py.setStdout({ raw: queueByte });
      py.setStderr({ raw: queueByte });
      py.setStdin({ stdin: interactiveStdin(control, data), isatty: true });
      let error = null;
      try {
        await py.runPythonAsync(code);
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

  let stdout = "",
    error = null;
  try {
    const py = await pyReady;
    py.globals.set("_user_code", code);
    const result = await py.runPythonAsync(WRAPPER);
    const pair = result.toJs();
    result.destroy();
    stdout = pair[0] || "";
    error = pair[1] || null;
  } catch (err) {
    error = String(err);
  }
  self.postMessage({ type: "result", id, stdout, error });
};
