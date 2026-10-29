"""Trusted PID 1: absolute lifetime even if the web server/attach client disappears."""
import ctypes
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import threading


def child_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main():
    if os.getpid() != 1 or os.getuid() != 10001:
        raise RuntimeError("Supervisor requires a private container PID namespace and student UID")
    cgroup = Path('/sys/fs/cgroup')
    quota, period = (cgroup / 'cpu.max').read_text().split()
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    if not (
        (cgroup / 'memory.max').read_text().strip() == str(256 * 1024 * 1024)
        and (cgroup / 'memory.swap.max').read_text().strip() == '0'
        and (cgroup / 'pids.max').read_text().strip() == '32'
        and quota != 'max' and int(quota) == int(period)
        and int(status['CapEff'].strip(), 16) == 0
        and status['NoNewPrivs'].strip() == '1' and status['Seccomp'].strip() == '2'
        and os.statvfs('/').f_flag & os.ST_RDONLY
        and set(os.listdir('/sys/class/net')) == {'lo'}
    ):
        raise RuntimeError('Kernel did not confirm sandbox enforcement')
    # A child cannot ptrace/read PID 1 memory; namespace init also rejects SIGKILL/STOP.
    if ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "Cannot protect supervisor memory")
    request = sys.stdin.buffer.readline(128 * 1024 + 1)
    if not request.endswith(b"\n") or len(request) > 128 * 1024:
        raise ValueError("Invalid request size")
    data = json.loads(request)
    lifetime = 300 if data.get("interactive") is True else 10
    # PID 1 exit destroys this entire namespace, including detached descendants.
    child = subprocess.Popen(
        [sys.executable, "-I", "-u", "/opt/runner.py"], stdin=subprocess.PIPE,
        preexec_fn=child_limits,
    )
    child.stdin.write(request)
    child.stdin.flush()
    timer = threading.Timer(lifetime, lambda: os._exit(124))
    timer.daemon = True
    timer.start()

    def copy_input():
        try:
            while chunk := sys.stdin.buffer.read1(8192):
                child.stdin.write(chunk)
                child.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            child.stdin.close()

    threading.Thread(target=copy_input, daemon=True).start()
    code = child.wait()
    os._exit(code if code >= 0 else 128 - code)


if __name__ == "__main__":
    main()
