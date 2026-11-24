#!/usr/bin/python3
"""Install the restricted Core bridge. Run from this Git checkout as root."""
from pathlib import Path
from datetime import datetime, timezone
import os
import shutil
import subprocess


def install():
    assert os.geteuid() == 0, "Run as root on Core"
    source = Path(__file__).resolve().parent
    destination = Path("/usr/local/lib/shpun-monitoring")
    destination.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name in ("access-bridge.py", "node-access.py"):
        shutil.copy2(source / name, destination / name)
        (destination / name).chmod(0o644)
    state = Path("/var/lib/infra-recovery-bot")
    lock = state / "operation.lock"
    if not lock.exists():
        lock.touch(mode=0o600)
        os.chown(lock, state.stat().st_uid, state.stat().st_gid)
    secrets = Path("/opt/shpunapp-secrets")
    key = secrets / "monitoring-access"
    if not key.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    key.chmod(0o600)
    public = key.with_suffix(".pub").read_text().split()
    authorized = Path("/root/.ssh/authorized_keys")
    existing = authorized.read_text()
    command = 'restrict,command="/usr/bin/python3 /usr/local/lib/shpun-monitoring/access-bridge.py" '
    line = command + " ".join(public[:2]) + " shpun-monitoring-access"
    if public[1] not in existing:
        shutil.copy2(authorized, str(authorized) + ".bak-monitoring-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        authorized.write_text(existing.rstrip() + "\n" + line + "\n")
    else:
        assert line in existing, "Existing bridge key has unexpected permissions"
    authorized.chmod(0o600)
    host_key = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
    (secrets / "monitoring-known-hosts").write_text("core.shpyn.online " + " ".join(host_key[:2]) + "\n")
    (secrets / "monitoring-known-hosts").chmod(0o644)
    env = Path("/opt/shpun-app/.env")
    updates = {
        "MONITORING_ACCESS_SSH_HOST": "core.shpyn.online",
        "MONITORING_ACCESS_SSH_KEY": str(key),
        "MONITORING_ACCESS_SSH_KNOWN_HOSTS": str(secrets / "monitoring-known-hosts"),
    }
    original = env.read_text()
    shutil.copy2(env, str(env) + ".bak-monitoring-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    lines = [line for line in original.splitlines() if line.split("=", 1)[0] not in updates]
    lines.extend(name + "=" + value for name, value in updates.items())
    env.write_text("\n".join(lines) + "\n")
    print("Restricted monitoring access bridge installed")


if __name__ == "__main__":
    install()
