"""Build only the isolated runtime context; never send application data to Docker."""
from pathlib import Path
import argparse
import sys

PLATFORM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLATFORM))
import sandbox_runner as sandbox


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline',action='store_true',help='Use prepared Linux wheels in the selected runtime wheelhouse; no network during build')
    args = parser.parse_args()
    if args.offline and not any((sandbox.RUNTIME_CONTEXT / 'wheelhouse').glob('*.whl')):
        parser.error('Offline build needs prepared wheels in '+str(sandbox.RUNTIME_CONTEXT/'wheelhouse'))
    docker = sandbox.Docker()
    if args.offline:
        base_image=next(line.split()[1] for line in (sandbox.RUNTIME_CONTEXT/'Dockerfile').read_text(encoding='utf-8').splitlines() if line.startswith('FROM '))
        try:
            docker.call(['image','inspect',base_image])
        except sandbox.SandboxError:
            parser.error('Offline build needs the base image loaded in Docker beforehand: '+base_image)
    options = ["build", "--network=none" if args.offline else "--network=host"]
    if args.offline:
        options += ['--build-arg','PYCLOUD_PIP_NO_INDEX=1']
    output = docker.call(options + [
        "--build-arg", "SANDBOX_DIGEST=" + sandbox.source_digest(),
        "--tag", sandbox.IMAGE, str(sandbox.RUNTIME_CONTEXT),
    ], timeout=600)
    print(output.decode("utf-8", errors="replace")[-6000:])
    pool = sandbox.SandboxPool()
    print("Verified isolated runtime:", pool.image())
