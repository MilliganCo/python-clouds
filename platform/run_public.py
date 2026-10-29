# -*- coding: utf-8 -*-
"""Публичный запуск: локальный сервер + HTTPS-туннель в интернет (Cloudflare).

Использование:
  python run_public.py

Даёт временный URL вида https://xxxx.trycloudflare.com — доступен из любой сети.
Для постоянного домена настройте именованный туннель Cloudflare (см. README).
"""
from __future__ import annotations

import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
PORT = 8017
TOOLS = BASE / "tools"
CF_LOCAL = TOOLS / "cloudflared.exe"
CF_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.I)

_procs: list[subprocess.Popen] = []


def _http_ok(url: str, timeout: float = 20) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "pycloud-run-public/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as exc:
        return exc.code == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _wait_port(host: str, port: int, timeout: float = 50) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.5):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def _find_cloudflared() -> str | None:
    import shutil

    found = shutil.which("cloudflared")
    if found:
        return found
    if CF_LOCAL.is_file():
        return str(CF_LOCAL)
    for base in (
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links",
    ):
        candidate = base / "cloudflared" / "cloudflared.exe"
        if candidate.is_file():
            return str(candidate)
    return None


def _download_cloudflared() -> str:
    TOOLS.mkdir(parents=True, exist_ok=True)
    print("Скачиваем cloudflared…")
    urllib.request.urlretrieve(CF_URL, CF_LOCAL)
    return str(CF_LOCAL)


def _ensure_cloudflared() -> str:
    cf = _find_cloudflared()
    if cf:
        return cf
    if sys.platform == "win32":
        import shutil

        if shutil.which("winget"):
            print("Пробуем установить cloudflared через winget…")
            subprocess.run(
                [
                    "winget", "install", "--id", "Cloudflare.cloudflared", "-e",
                    "--accept-package-agreements", "--accept-source-agreements",
                ],
                check=False,
            )
            cf = _find_cloudflared()
            if cf:
                return cf
        return _download_cloudflared()
    raise SystemExit(
        "Установите cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
    )


def _stop_all() -> None:
    for proc in reversed(_procs):
        if proc.poll() is None:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.send_signal(signal.SIGTERM)
    _procs.clear()


def _start_server() -> subprocess.Popen:
    from server import ensure_single_instance

    ensure_single_instance(PORT)
    env = os.environ.copy()
    env["PYCLOUD_BEHIND_TUNNEL"] = "1"
    proc = subprocess.Popen(
        [sys.executable, str(BASE / "server.py")],
        cwd=str(BASE),
        env=env,
    )
    _procs.append(proc)
    return proc


def _start_tunnel(cf_bin: str) -> tuple[subprocess.Popen, str | None]:
    proc = subprocess.Popen(
        [cf_bin, "tunnel", "--url", f"http://127.0.0.1:{PORT}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    _procs.append(proc)
    public_url = None
    deadline = time.time() + 90
    while time.time() < deadline and proc.poll() is None:
        line = proc.stdout.readline() if proc.stdout else ""
        if not line:
            time.sleep(0.1)
            continue
        stripped = line.rstrip()
        if stripped and (not stripped.startswith("INF") or "trycloudflare" in stripped.lower()):
            print(stripped)
        match = URL_RE.search(line)
        if match:
            public_url = match.group(0).rstrip("/")
            break
    return proc, public_url


def _verify(label: str, url: str, retries: int = 5) -> bool:
    for attempt in range(1, retries + 1):
        if _http_ok(url):
            print(f"  ✓ {label}: {url}")
            return True
        time.sleep(min(attempt * 1.5, 6))
    print(f"  ✗ {label}: не отвечает ({url})")
    return False


def main() -> int:
    if sys.platform == "win32":
        signal.signal(signal.SIGINT, lambda *_: (_stop_all(), sys.exit(0)))
        signal.signal(signal.SIGTERM, lambda *_: (_stop_all(), sys.exit(0)))

    print("=== Python в облаках — публичный запуск ===\n")
    cf = _ensure_cloudflared()
    print(f"cloudflared: {cf}\n")

    server = _start_server()
    if not _wait_port("127.0.0.1", PORT):
        print("Ошибка: сервер не поднялся на порту", PORT)
        _stop_all()
        return 1

    local = f"http://127.0.0.1:{PORT}"
    lan_hint = "http://<ваш_LAN_IP>:8017"
    print(f"Локально:  {local}")
    print(f"В сети LAN: {lan_hint}\n")

    print("Проверка сервера…")
    if not _verify("localhost", local + "/"):
        _stop_all()
        return 1
    if not _verify("health", local + "/api/health"):
        _stop_all()
        return 1

    print("\nПоднимаем HTTPS-туннель в интернет…")
    tunnel, public = _start_tunnel(cf)
    if not public:
        print("Ошибка: cloudflared не выдал публичный URL")
        _stop_all()
        return 1

    print("\n" + "=" * 56)
    print("  ПУБЛИЧНЫЙ АДРЕС (интернет):")
    print(f"  {public}")
    print("=" * 56)
    print("\nПроверка публичного URL…")
    time.sleep(2)
    if not _verify("интернет", public + "/"):
        print("Туннель создан, но проверка с этой машины не прошла.")
        print("Попробуйте открыть URL вручную или с телефона через мобильный интернет.")

    print("\nСервер работает. Ctrl+C — остановить.\n")
    try:
        while True:
            if server.poll() is not None:
                print("Сервер завершился.")
                break
            if tunnel.poll() is not None:
                print("Туннель завершился.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nОстанавливаем…")
    finally:
        _stop_all()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
