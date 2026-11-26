"""Exercise the guided CLI via a real Linux PTY and a second stop process."""

import errno
import json
import os
import pty
import select
import shutil
import subprocess
import sys
import time
from pathlib import Path


def check(project: Path, complete: bool) -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    cli = [node, "dist/packages/cli/src/index.js"]
    master, slave = pty.openpty()
    child = subprocess.Popen(
        [
            *cli, "record", "--project", str(project), "--guided",
            "--url", "http://127.0.0.1:3000", "--profile", "checkout-demo",
            "--approve", "--json",
        ],
        stdin=slave, stdout=slave, stderr=slave,
    )
    os.close(slave)
    started = time.monotonic()
    pending = b""
    transcript = []
    session = None

    try:
        while time.monotonic() - started < 30:
            readable, _, _ = select.select([master], [], [], 0.5)
            if not readable:
                continue
            try:
                chunk = os.read(master, 4096)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not chunk:
                break
            pending += chunk
            while b"\n" in pending:
                raw, pending = pending.split(b"\n", 1)
                line = raw.decode().strip()
                if not line:
                    continue
                transcript.append(line)
                if line.startswith("Guided recording session "):
                    session = line.rsplit(maxsplit=1)[-1]
                if line.startswith("Recording "):
                    if not complete or line.startswith("Recording failure "):
                        assert session is not None
                        subprocess.run(
                            [*cli, "stop", "--project", str(project), "--session", session, "--json"],
                            check=True, capture_output=True, timeout=5,
                        )
                    else:
                        os.write(master, b"\n")
        assert child.wait(timeout=5) == (0 if complete else 130), transcript
        result = json.loads(next(line for line in reversed(transcript) if line.startswith("{")))
        assert result["status"] == ("CAPTURED" if complete else "CANCELLED"), result
        assert result["cleanup"] == "ok", result
        assert session is not None
        assert (project / ".repro" / (session + ".draft.json")).exists() == complete
        assert not (project / ".repro" / (session + ".active")).exists()
        print(f"Guided stop returned {result['status']} with confirmed cleanup.")
    finally:
        os.close(master)
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=10)


project = Path(sys.argv[1]).resolve()
check(project, complete=True)
check(project, complete=False)
