"""Server-owned, one-shot Docker jobs. No native execution fallback."""
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from execution_artifacts import normalize_artifacts


BASE = Path(__file__).resolve().parent
IMAGE = "pycloud-python-sandbox:20261020-web"
RUNTIME_CONTEXT = BASE / "sandbox_web"
ENDPOINT = "unix:///var/run/docker.sock"
INSTANCE = hashlib.sha256(str(BASE.resolve()).encode()).hexdigest()[:16]
MAX_REQUEST = 128 * 1024
MAX_OUTPUT = 1024 * 1024
MAX_INPUT = 8192
TIMEOUT_ERROR = "Превышено время выполнения (10 секунд). Проверьте условие выхода."


class SandboxError(RuntimeError):
    pass


class SandboxBusy(SandboxError):
    pass


def source_digest():
    digest = hashlib.sha256()
    for name in ("Dockerfile", "runner.py", "supervisor.py", "pycloud.py"):
        digest.update(name.encode() + b"\0" + (RUNTIME_CONTEXT / name).read_bytes())
    return digest.hexdigest()


def cli_env():
    return {key: value for key, value in os.environ.items() if key in {
        "PATH", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC",
        "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "TEMP", "TMP",
    }}


def bounded_text(value, limit=64 * 1024):
    if not isinstance(value, str):
        raise SandboxError("Некорректный текст раннера.")
    return value.encode("utf-8", errors="replace")[:limit].decode("utf-8", errors="ignore")


def normalized_event(data, job_id):
    """Only display data crosses the guest boundary; strip all control fields."""
    kind = data.get("type")
    out = {"type": kind, "id": job_id}
    if kind == "status":
        out["text"] = bounded_text(data.get("text", ""), 1024)
    elif kind in {"execution_start", "input_request", "done"}:
        pass
    elif kind == "phase":
        if data.get("phase") not in {"solution", "check"}:
            raise SandboxError("Некорректный этап раннера.")
        out["phase"] = data["phase"]
    elif kind == "output":
        out.update(chunk=bounded_text(data.get("chunk", "")), phase=data.get("phase", "solution"))
        if out["phase"] not in {"solution", "check"}:
            raise SandboxError("Некорректный этап вывода.")
    elif kind == "result":
        for key in ("stdout", "user_stdout", "check_stdout", "error"):
            value = data.get(key)
            out[key] = None if value is None else bounded_text(value, 8192 if key == "error" else 64 * 1024)
        out["stdout"] = out["stdout"] or ""
        failure = data.get("failure")
        out["failure"] = None
        if failure is not None:
            if not isinstance(failure, dict) or failure.get("source") not in {"solution", "check"}:
                raise SandboxError("Некорректная ошибка раннера.")
            line = failure.get("line")
            if line is not None and (type(line) is not int or not 1 <= line <= 1_000_000):
                raise SandboxError("Некорректная строка ошибки.")
            out["failure"] = dict(type=bounded_text(failure.get("type", ""), 256),
                                  message=bounded_text(failure.get("message", ""), 4096),
                                  line=line, source=failure["source"])
        if "artifacts" in data:
            out["artifacts"] = normalize_artifacts(data["artifacts"])
    elif kind == "test_event":
        event = data.get("event")
        if not isinstance(event, dict):
            raise SandboxError("Некорректное событие проверки.")
        if event.get("type") == "plan":
            tests = event.get("tests")
            if not isinstance(tests, list) or len(tests) > 128:
                raise SandboxError("Слишком много проверок.")
            clean = []
            for test in tests:
                if (not isinstance(test, dict) or type(test.get("id")) is not int or not 0 <= test["id"] < 4096
                        or type(test.get("line")) is not int or not 1 <= test["line"] <= 1_000_000):
                    raise SandboxError("Некорректный план проверки.")
                clean.append(dict(id=test["id"], line=test["line"], code=bounded_text(test.get("code", ""), 8192)))
            out["event"] = {"type": "plan", "tests": clean}
        elif event.get("type") == "test":
            if (type(event.get("id")) is not int or not 0 <= event["id"] < 4096
                    or event.get("state") not in {"running", "passed", "failed"}):
                raise SandboxError("Некорректное состояние проверки.")
            out["event"] = dict(type="test", id=event["id"], state=event["state"],
                                message=bounded_text(event.get("message", ""), 4096))
        else:
            raise SandboxError("Некорректное событие проверки.")
    else:
        return None
    return out


class Docker:
    def __init__(self):
        self.config = tempfile.TemporaryDirectory(prefix="pycloud-docker-cli-")
        (Path(self.config.name) / "config.json").write_text("{}", encoding="ascii")

    def command(self, args):
        if os.name == "nt":
            wsl = shutil.which("wsl")
            if not wsl:
                raise SandboxError("WSL Ubuntu недоступна. Запуск Python остановлен безопасно.")
            args = list(args)
            if args and args[0] == "build":
                target = Path(args[-1]).resolve()
                args[-1] = "/mnt/" + target.drive[0].lower() + target.as_posix()[2:]
            prefix = [wsl, "-d", "Ubuntu", "-u", "root", "--exec"]
            if args and args[0] == "build":
                prefix.extend(["env", "DOCKER_BUILDKIT=0"])
            return [*prefix,
                    "/var/lib/pycloud-sandbox-runtime/docker/docker", "--host",
                    "unix:///var/lib/pycloud-sandbox-runtime/run/docker.sock", "--config",
                    "/var/lib/pycloud-sandbox-runtime/client", *args]
        executable = shutil.which("docker")
        if not executable:
            raise SandboxError("Docker недоступен. Запуск Python остановлен безопасно.")
        return [executable, "--host", ENDPOINT, "--config", self.config.name, *args]

    def call(self, args, timeout=5):
        try:
            result = subprocess.run(self.command(args), capture_output=True, timeout=timeout, env=cli_env())
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise SandboxError("Изолированный раннер недоступен. Запустите Docker и повторите запуск.") from exc
        if result.returncode:
            raise SandboxError("Изолированный раннер недоступен или его образ не собран.")
        if len(result.stdout) > MAX_OUTPUT:
            raise SandboxError("Некорректный ответ Docker.")
        return result.stdout


def container_options(name, uid, image):
    return [
        "create", "--name", name, "--interactive", "--pull=never", "--restart=no",
        "--label", "org.pythonclouds.sandbox=1", "--label", "org.pythonclouds.instance=" + INSTANCE,
        "--label", "org.pythonclouds.uid=" + str(uid), "--user", "10001:10001",
        "--network=none", "--ipc=none", "--cgroupns=private", "--read-only",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--log-driver=none",
        "--cpus=1", "--memory=256m", "--memory-swap=256m", "--pids-limit=32",
        "--ulimit", "nofile=64:64", "--ulimit", "core=0:0",
        "--tmpfs", "/workspace:rw,nosuid,nodev,noexec,size=16m,mode=700,uid=10001,gid=10001",
        "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777",
        image,
    ]


def verify_container(info):
    host, config = info["HostConfig"], info["Config"]
    if not (
        config["User"] == "10001:10001" and host["NetworkMode"] == "none"
        and host["IpcMode"] == "none" and host["ReadonlyRootfs"]
        and host["Memory"] == host["MemorySwap"] == 256 * 1024 * 1024
        and host["NanoCpus"] == 1_000_000_000 and host["PidsLimit"] == 32
        and host["CapDrop"] == ["ALL"] and "no-new-privileges" in host["SecurityOpt"]
        and not host["Privileged"] and not host["Binds"] and not host.get("Devices")
        and not host["PidMode"] and host["CgroupnsMode"] == "private"
        and not host["UTSMode"] and not host.get("Init")
        and config["WorkingDir"] == "/workspace" and host["RestartPolicy"]["Name"] == "no"
        and host["LogConfig"]["Type"] == "none"
        and set(host["Tmpfs"]) == {"/workspace", "/tmp"}
        and all(mount.get("Type") == "tmpfs" and mount.get("Destination") in {"/workspace", "/tmp"}
                for mount in info.get("Mounts", []))
    ):
        raise SandboxError("Docker не подтвердил обязательные ограничения песочницы.")
    for item in config.get("Env", []):
        if item.split("=", 1)[0].lower() in {"http_proxy", "https_proxy", "all_proxy", "ftp_proxy", "no_proxy"}:
            raise SandboxError("Небезопасное окружение контейнера.")


class Job:
    def __init__(self, pool, uid, request):
        self.pool, self.uid = pool, uid
        self.id = secrets.token_hex(16)
        self.name = "pycloud-exec-" + INSTANCE + "-" + self.id
        self.request = dict(request, id=self.id)
        self.deadline = time.monotonic() + (310 if request["interactive"] else 20)
        self.events = queue.Queue(maxsize=64)
        self.stop = threading.Event()
        self.input_lock = threading.Lock()
        self.input_pending = False
        self.answers = queue.Queue(maxsize=1)
        self.close_lock = threading.Lock()
        self.process = None
        self.reason = None
        self.closed = False

    def start(self, image):
        self.pool.docker.call(container_options(self.name, self.uid, image))
        info = json.loads(self.pool.docker.call(["inspect", self.name]))[0]
        verify_container(info)
        self.process = subprocess.Popen(
            self.pool.docker.command(["start", "--attach", "--interactive", self.name]),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env=cli_env(), bufsize=0,
        )
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._watch, daemon=True).start()
        self.process.stdin.write((json.dumps(self.request, ensure_ascii=False) + "\n").encode())
        self.process.stdin.flush()
        threading.Thread(target=self._write_input, daemon=True).start()

    def _put(self, data):
        try:
            self.events.put(data, timeout=0.5)
        except queue.Full:
            self.reason = "Слишком большой поток вывода. Запуск остановлен."
            self.close()

    def _read(self):
        total, buffered, final, frames = 0, b"", None, 0
        output = {"solution": [], "check": []}
        phase = "solution"
        text_bytes = 0
        execution_started = False

        def observe(text, current_phase):
            nonlocal text_bytes
            text = bounded_text(text)
            text_bytes += len(text.encode())
            if text_bytes > 64 * 1024:
                raise SandboxError("Превышен лимит вывода (64 КиБ).")
            output[current_phase].append(text)
            if self.request["interactive"] and text:
                self._put({"type": "output", "id": self.id, "chunk": text})

        try:
            while chunk := self.process.stdout.read(4096):
                total += len(chunk)
                if total > MAX_OUTPUT:
                    self.reason = "Превышен лимит потока вывода."
                    self.close()
                    break
                buffered += chunk
                if len(buffered) > MAX_OUTPUT:
                    raise SandboxError("Некорректный поток вывода.")
                while buffered:
                    if not buffered.startswith(b"\x1e"):
                        marker = buffered.find(b"\x1e")
                        if marker < 0:
                            break
                        # WSL/Docker diagnostics can precede the protocol (UTF-16 on Windows).
                        # Student/native output starts only after execution_start.
                        if execution_started:
                            observe(buffered[:marker].decode("utf-8", errors="replace"), phase)
                        buffered = buffered[marker:]
                    if b"\n" not in buffered:
                        break
                    line, buffered = buffered[1:].split(b"\n", 1)
                    try:
                        data = json.loads(line)
                    except ValueError:
                        if frames:
                            raise
                        # UTF-16 diagnostics may contain 0x1e (e.g. Cyrillic capital О).
                        # Before the first frame, recover the last framed JSON on this line.
                        try:
                            data = json.loads(line.rsplit(b"\x1e", 1)[-1])
                        except ValueError:
                            continue
                    if not isinstance(data, dict) or data.get("id") != self.id:
                        raise SandboxError("Некорректное сообщение раннера.")
                    data = normalized_event(data, self.id)
                    if data is None:
                        continue
                    frames += 1
                    if frames > 2048:
                        raise SandboxError("Слишком много событий вывода.")
                    kind = data["type"]
                    # Child messages never control lifecycle, quotas, ownership, or cleanup.
                    if kind == "result":
                        final = data
                    elif kind == "phase":
                        phase = data["phase"]
                    elif kind == "output":
                        observe(data["chunk"], data["phase"])
                    elif kind == "test_event" and self.request["reportTests"]:
                        self._put(data)
                    elif kind == "input_request" and self.request["interactive"]:
                        with self.input_lock:
                            requested = not self.input_pending
                            self.input_pending = True
                        if requested:
                            self._put(data)
                    elif kind in {"status", "execution_start"}:
                        if kind == "execution_start":
                            execution_started = True
                        self._put(data)
            if buffered and execution_started:
                observe(buffered.decode("utf-8", errors="replace"), phase)
            self.process.wait(timeout=2)
            info = json.loads(self.pool.docker.call(["inspect", self.name]))[0]
            code = info["State"]["ExitCode"]
            if info["State"].get("OOMKilled"):
                self.reason = "Превышен лимит памяти Python (256 МиБ)."
            elif code == 124 or code in {137, 152}:
                self.reason = TIMEOUT_ERROR if not self.request["interactive"] else "Достигнут лимит времени или ресурсов Python."
            elif code:
                self.reason = "Python остановлен из-за ошибки или ограничения ресурсов."
            elif final is None:
                final = dict(stdout="", error=None, failure=None, user_stdout=None, check_stdout=None)
        except SandboxError as exc:
            self.reason = self.reason or str(exc)
        except (OSError, ValueError, KeyError, TypeError, RecursionError, subprocess.TimeoutExpired):
            self.reason = self.reason or "Изолированный раннер завершился с ошибкой."
        finally:
            self.close()
            user, checked = "".join(output["solution"]), "".join(output["check"])
            if self.reason:
                final = {"stdout": user + checked, "error": self.reason, "failure": None, "user_stdout": None, "check_stdout": None}
            elif final:
                final["stdout"] = user + checked
                if final.get("user_stdout") is not None:
                    final["user_stdout"], final["check_stdout"] = user, checked
            self._put({**(final or {}), "type": "result", "id": self.id})
            self._put({"type": "end", "id": self.id})

    def _watch(self):
        remaining = max(0, self.deadline - time.monotonic())
        if not self.stop.wait(remaining):
            self.reason = TIMEOUT_ERROR
            self.close()

    def answer(self, answer):
        data = (json.dumps({"answer": answer}, ensure_ascii=False) + "\n").encode()
        if len(answer.encode()) > MAX_INPUT or not self.request["interactive"]:
            raise ValueError("Слишком длинный или недопустимый ввод.")
        with self.input_lock:
            if self.closed or self.process is None or self.process.poll() is not None:
                raise SandboxError("Запуск уже завершён.")
            if not self.input_pending:
                raise SandboxError("Python сейчас не ожидает ввод.")
            try:
                self.answers.put_nowait(data)
            except queue.Full as exc:
                raise SandboxError("Предыдущий ввод ещё передаётся.") from exc
            self.input_pending = False

    def _write_input(self):
        # Guest stdin must never block an HTTP worker; one bounded writer per job.
        while not self.stop.is_set():
            try:
                data = self.answers.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self.process.stdin.write(data)
                self.process.stdin.flush()
            except (OSError, ValueError):
                if not self.stop.is_set():
                    self.reason = "Не удалось передать ввод в Python."
                    self.close()
                return

    def close(self):
        with self.close_lock:
            if self.closed:
                return
            self.stop.set()
            try:
                self.pool.docker.call(["rm", "--force", self.name])
            except SandboxError:
                try:
                    left = self.pool.docker.call(["ps", "--all", "--quiet", "--filter", "name=^/" + self.name + "$"])
                    if left.strip():
                        raise SandboxError("Container remains")
                except SandboxError:
                    self.reason = self.reason or "Не удалось подтвердить очистку песочницы. Новые запуски временно запрещены."
                    return  # Keep the admission slot until removal is confirmed.
            if self.process and self.process.poll() is None:
                self.process.terminate()
            self.closed = True
            self.pool.release(self)

    def stream(self):
        try:
            yield {"type": "job", "id": self.id}
            while True:
                data = self.events.get(timeout=max(1, self.deadline - time.monotonic() + 10))
                if data["type"] == "end":
                    return
                yield data
        finally:
            self.close()


class SandboxPool:
    def __init__(self):
        self.docker = None
        self.lock = threading.Lock()
        self.jobs = {}
        self.ready = False
        self.verified_image_id = None

    def image(self):
        if self.docker is None:
            self.docker = Docker()
        info = json.loads(self.docker.call(["image", "inspect", IMAGE]))[0]
        labels = info["Config"].get("Labels") or {}
        if info.get("Os") != "linux" or labels.get("org.pythonclouds.digest") != source_digest():
            raise SandboxError("Образ безопасного Python нужно пересобрать.")
        security = json.loads(self.docker.call(["info", "--format", "{{json .SecurityOptions}}"] ))
        if not any("seccomp" in item and "profile=builtin" in item for item in security):
            raise SandboxError("Docker не подтверждает seccomp. Запуск запрещён.")
        limits = self.docker.call(["info", "--format", "{{.MemoryLimit}} {{.SwapLimit}} {{.PidsLimit}}"])
        if limits.strip().split() != [b"true"] * 3:
            raise SandboxError("Docker не подтверждает ограничения CPU/RAM/процессов.")
        self.ready = True
        self.verified_image_id = info["Id"]
        return info["Id"]

    def create(self, uid, request):
        with self.lock:
            if len(self.jobs) >= 2 or any(job.uid == uid for job in self.jobs.values()):
                raise SandboxBusy("Другой запуск ещё выполняется. Дождитесь результата или остановите его.")
            image = self.image()
            self._reap_stopped()
            existing = self.docker.call(["ps", "--all", "--quiet", "--filter", "label=org.pythonclouds.instance=" + INSTANCE]).splitlines()
            if len(existing) >= 2:
                raise SandboxBusy("Песочницы ещё завершаются. Повторите запуск через 10 секунд.")
            job = Job(self, uid, request)
            self.jobs[job.id] = job
        try:
            job.start(image)
            return job
        except (ValueError, KeyError, TypeError) as exc:
            job.close()
            raise SandboxError("Docker не подтвердил параметры изолированного запуска.") from exc
        except BaseException:
            job.close()
            raise

    def _reap_stopped(self):
        rows = self.docker.call([
            "ps", "--all", "--format", "{{.ID}} {{.Names}} {{.State}}",
            "--filter", "label=org.pythonclouds.instance=" + INSTANCE,
            "--filter", "label=org.pythonclouds.sandbox=1",
        ]).decode("utf-8").splitlines()
        if len(rows) > 8:
            raise SandboxBusy("Нужна проверка оставшихся песочниц администратором.")
        active_names = {job.name for job in self.jobs.values()}
        for row in rows:
            fields = row.split()
            if len(fields) != 3:
                raise SandboxError("Некорректный список песочниц Docker.")
            cid, name, state = fields
            if (state in {"created", "exited"} and name not in active_names
                    and re.fullmatch(r"[0-9a-f]{12,64}", cid)
                    and re.fullmatch("pycloud-exec-" + INSTANCE + r"-[0-9a-f]{32}", name)):
                self.docker.call(["rm", cid])

    def owned(self, uid, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return job if job and job.uid == uid else None

    def release(self, job):
        with self.lock:
            self.jobs.pop(job.id, None)


pool = SandboxPool()
