"""One Python job inside an OS-isolated, disposable container.

The host must enforce isolation, deadlines and raw output limits. This protocol
and the Python namespace are not a security boundary.
"""

import ast
import io
import json
import sys
import traceback


MAX_OUTPUT_BYTES = 64 * 1024
MAX_FAILURE_BYTES = 8 * 1024
MAX_REQUEST_BYTES = 512 * 1024
MAX_INPUT_BYTES = 64 * 1024
SOLUTION_FILE = "<решение>"
CHECK_FILE = "<проверка>"


class OutputLimitExceeded(RuntimeError):
    pass


def clipped(text, limit):
    return text.encode("utf-8", errors="replace")[:limit].decode("utf-8", errors="ignore")


def exception_message(exc):
    try:
        return clipped(str(exc), MAX_FAILURE_BYTES // 2)
    except BaseException:
        return "Не удалось получить сообщение исключения."


def failure_details(exc):
    message = exception_message(exc)
    frames = traceback.extract_tb(exc.__traceback__)
    frame = next((f for f in reversed(frames) if f.filename in (SOLUTION_FILE, CHECK_FILE)), None)
    syntax = isinstance(exc, SyntaxError) and exc.filename in (SOLUTION_FILE, CHECK_FILE)
    line = exc.lineno if syntax else (frame.lineno if frame else None)
    filename = exc.filename if syntax else (frame.filename if frame else None)
    error = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__, limit=3))
    return clipped(error, MAX_FAILURE_BYTES - len(message.encode("utf-8"))), {
        "type": clipped(type(exc).__name__, 256),
        "message": message,
        "line": line,
        "source": "check" if filename == CHECK_FILE else "solution",
    }


class Capture:
    def __init__(self, emit, interactive):
        self.emit = emit
        self.interactive = interactive
        self.remaining = MAX_OUTPUT_BYTES
        self.limited = False
        self.streams = []

    def flush(self, stream):
        if stream.pending:
            self.emit("output", chunk=stream.pending, phase=stream.phase)
            stream.pending = ""

    def flush_all(self):
        for stream in self.streams:
            self.flush(stream)

    def write(self, stream, text):
        if not isinstance(text, str):
            raise TypeError("write() argument must be str")
        if self.limited:
            raise OutputLimitExceeded("Превышен лимит вывода (64 КиБ).")
        data = text.encode("utf-8", errors="replace")
        chunk = data[:self.remaining].decode("utf-8", errors="ignore")
        self.remaining -= len(chunk.encode("utf-8"))
        if chunk:
            stream.parts.append(chunk)
            stream.pending += chunk
            if '\n' in stream.pending or len(stream.pending) >= 1024:
                self.flush(stream)
        if len(data) > len(chunk.encode("utf-8")):
            self.limited = True
            raise OutputLimitExceeded("Превышен лимит вывода (64 КиБ).")
        return len(text)


class Output(io.TextIOBase):
    encoding = "utf-8"
    errors = "replace"

    def __init__(self, capture, phase="solution"):
        self.capture = capture
        self.parts = []
        self.pending = ""
        self.phase = phase
        capture.streams.append(self)

    def write(self, text):
        return self.capture.write(self, text)

    def flush(self):
        self.capture.flush(self)

    def writable(self):
        return True

    def isatty(self):
        return self.capture.interactive

    def getvalue(self):
        return "".join(self.parts)


class Input(io.TextIOBase):
    encoding = "utf-8"
    errors = "strict"

    def __init__(self, source, emit, interactive):
        self.source = source
        self.emit = emit
        self.interactive = interactive
        self.buffered = ""
        self.eof = not interactive

    def receive(self):
        if self.eof:
            return ""
        sys.stdout.flush()
        self.emit("input_request")
        line = self.source.readline(MAX_INPUT_BYTES + 1)
        if not line:
            self.eof = True
            return ""
        if len(line.encode("utf-8")) > MAX_INPUT_BYTES:
            raise ValueError("Слишком длинный ответ для input().")
        answer = json.loads(line)
        if not isinstance(answer, dict) or not isinstance(answer.get("answer"), str):
            raise ValueError("Ожидался JSON-ответ с текстовым полем answer.")
        return answer["answer"] + "\n"

    def readline(self, size=-1):
        if size == 0:
            return ""
        if not self.buffered:
            self.buffered = self.receive()
        end = self.buffered.find("\n") + 1 or len(self.buffered)
        if size >= 0:
            end = min(end, size)
        line, self.buffered = self.buffered[:end], self.buffered[end:]
        return line

    def read(self, size=-1):
        if size == 0:
            return ""
        while not self.eof and (size < 0 or len(self.buffered) < size):
            self.buffered += self.receive()
        end = len(self.buffered) if size < 0 else size
        text, self.buffered = self.buffered[:end], self.buffered[end:]
        return text

    def readable(self):
        return True

    def isatty(self):
        return self.interactive


class Assertions(ast.NodeVisitor):
    def __init__(self):
        self.nodes = []

    def visit_Assert(self, node):
        self.nodes.append(node)

    def visit_FunctionDef(self, node):
        pass

    def visit_AsyncFunctionDef(self, node):
        pass

    def visit_ClassDef(self, node):
        pass


class TestReporter:
    def __init__(self, code, emit):
        self.emit = emit
        self.active = None
        self.states = {}
        visitor = Assertions()
        visitor.visit(ast.parse(code, filename=CHECK_FILE))
        assertions = sorted(visitor.nodes, key=lambda node: node.lineno)
        self.lines = {line: index for index, node in enumerate(assertions)
                      for line in range(node.lineno, node.end_lineno + 1)}
        emit("test_event", event={"type": "plan", "tests": [
            {"id": index, "line": node.lineno, "code": ast.get_source_segment(code, node)}
            for index, node in enumerate(assertions)
        ]})

    def report(self, test, state, **fields):
        self.emit("test_event", event={"type": "test", "id": test, "state": state, **fields})
        self.states[test] = state

    def trace(self, frame, event, arg):
        if frame.f_code.co_filename != CHECK_FILE or frame.f_code.co_name != "<module>":
            return None
        if event == "exception":
            if self.active is not None:
                self.report(self.active, "failed", message=exception_message(arg[1]))
                self.active = None
        elif event in ("line", "return"):
            current = self.lines.get(frame.f_lineno) if event == "line" else None
            if self.active is not None and current != self.active:
                if self.states.get(self.active) != "passed":
                    self.report(self.active, "passed")
                self.active = None
            if current is not None and self.active is None:
                self.active = current
                if current not in self.states:
                    self.report(current, "running")
        return self.trace


def execute(request, protocol_input, emit):
    capture = Capture(emit, request["interactive"])
    user_output = Output(capture)
    check_output = Output(capture, "check")
    previous = sys.stdin, sys.stdout, sys.stderr, sys.gettrace()
    sys.stdin = Input(protocol_input, emit, request["interactive"])
    sys.stdout = sys.stderr = user_output
    error = failure = None
    user_stdout = check_stdout = None
    try:
        emit("phase", phase="solution")
        reporter = TestReporter(request["check"], emit) if request["reportTests"] and request["check"] else None
        namespace = {"__name__": "__main__"}
        exec(compile(request["code"], SOLUTION_FILE, "exec"), namespace)
        if capture.limited:
            raise OutputLimitExceeded("Превышен лимит вывода (64 КиБ).")
        if request["check"]:
            capture.flush_all()
            emit("phase", phase="check")
            user_stdout = user_output.getvalue()
            sys.stdout = sys.stderr = check_output
            if reporter:
                sys.settrace(reporter.trace)
            exec(compile(request["check"], CHECK_FILE, "exec"), namespace)
            if capture.limited:
                raise OutputLimitExceeded("Превышен лимит вывода (64 КиБ).")
    except BaseException as exc:
        error, failure = failure_details(exc)
    finally:
        capture.flush_all()
        sys.settrace(previous[3])
        sys.stdin, sys.stdout, sys.stderr = previous[:3]
        if user_stdout is not None:
            check_stdout = check_output.getvalue()
    return {"stdout": user_output.getvalue() + check_output.getvalue(), "error": error,
            "failure": failure, "user_stdout": user_stdout, "check_stdout": check_stdout}


def main():
    protocol_input, protocol_output = sys.stdin, sys.stdout
    protocol_output.reconfigure(encoding="utf-8", errors="replace")
    protocol_input.reconfigure(encoding="utf-8", errors="strict")
    job_id = ""

    def emit(kind, **fields):
        protocol_output.write("\x1e" + json.dumps({"type": kind, "id": job_id, **fields}, ensure_ascii=False) + "\n")
        protocol_output.flush()

    try:
        line = protocol_input.readline(MAX_REQUEST_BYTES + 1)
        request = json.loads(line)
        if isinstance(request, dict) and isinstance(request.get("id"), str):
            job_id = request["id"]
        if len(line.encode("utf-8")) > MAX_REQUEST_BYTES or not isinstance(request, dict):
            raise ValueError("Неверный JSON-запрос исполнения.")
        for field in ("id", "code", "check"):
            if not isinstance(request.get(field), str):
                raise ValueError(f"Поле {field} должно быть строкой.")
        for field in ("interactive", "reportTests"):
            if not isinstance(request.get(field), bool):
                raise ValueError(f"Поле {field} должно быть boolean.")
        emit("status", text="")
        emit("execution_start")
        sys.path.insert(0, "/workspace")
        result = execute(request, protocol_input, emit)
    except BaseException as exc:
        error, failure = failure_details(exc)
        result = {"stdout": "", "error": error, "failure": failure,
                  "user_stdout": None, "check_stdout": None}
    emit("result", **result)
    emit("done", error=result["error"])


if __name__ == "__main__":
    main()
