#!/usr/bin/python3
"""Forced SSH command on Core. Requests identify saved monitored nodes only."""
import base64
import fcntl
import hashlib
import ipaddress
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import tomllib
import urllib.parse


class AccessError(Exception):
    pass


def connect_readonly(path):
    db = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    return db


def endpoint_host(row):
    url = urllib.parse.urlsplit(row["exporter_url"])
    if (not row["active"] or not row["node_exporter_enabled"] or url.scheme != "http"
            or url.port != 9100 or url.path not in ("", "/", "/metrics")
            or url.username or url.password or url.query or url.fragment
            or row["exporter_auth_type"] != "none" or url.hostname != row["host"].strip("[]")):
        raise AccessError("unsupported_endpoint")
    return url.hostname


def verified_key(row):
    parts = row["host_key_line"].split()
    if len(parts) != 3 or parts[1] != "ssh-ed25519":
        raise AccessError("host_key_unavailable")
    try:
        fingerprint = "SHA256:" + base64.b64encode(
            hashlib.sha256(base64.b64decode(parts[2], validate=True)).digest()).decode().rstrip("=")
    except ValueError:
        raise AccessError("host_key_unavailable")
    if fingerprint != row["host_fingerprint"]:
        raise AccessError("host_key_unavailable")
    return row["address"] + " " + parts[1] + " " + parts[2] + "\n"


def find_target(registry, host):
    # DNS alone never authorizes a server. Match the saved infrastructure
    # hostname, address or explicit endpoint, then verify its pinned SSH key.
    rows = registry.execute("""
        SELECT DISTINCT s.* FROM servers s
        LEFT JOIN endpoints e ON e.server_id=s.id
        WHERE s.status='active' AND (lower(s.hostname)=lower(?)
          OR s.address=? OR lower(e.domain)=lower(?))
    """, (host, host, host)).fetchall()
    if len(rows) != 1 or rows[0]["ssh_login"] not in ("", "root"):
        raise AccessError("node_not_registered")
    target = rows[0]
    address = ipaddress.ip_address(target["address"])
    resolved = {item[4][0] for item in socket.getaddrinfo(host, 9100, type=socket.SOCK_STREAM)}
    if str(address) not in resolved:
        raise AccessError("node_not_registered")
    return target


def prepare(server_id):
    with connect_readonly("/opt/shpun-app/data/linkdb.sqlite") as db:
        row = db.execute("SELECT * FROM monitored_servers WHERE id=?", (server_id,)).fetchone()
    if row is None:
        raise AccessError("server_not_found")
    host = endpoint_host(row)
    with connect_readonly("/var/lib/infra-recovery-bot/registry.sqlite3") as registry:
        target = find_target(registry, host)
    known_key = verified_key(target)
    route = subprocess.run(
        ["ip", "-j", "route", "get", target["address"]], capture_output=True,
        text=True, check=True, timeout=5)
    source = str(ipaddress.ip_address(json.loads(route.stdout)[0]["prefsrc"]))
    settings = tomllib.loads(Path("/etc/infra-recovery-bot/settings.toml").read_text())
    key_path = Path(settings.get("recovery", {}).get(
        "ssh_private_key_file", "/etc/infra-recovery-bot/ssh/infra_bot_ed25519"))
    if not key_path.is_file() or key_path.is_symlink() or key_path.stat().st_mode & 0o077:
        raise AccessError("ssh_failed")
    remote = Path(__file__).with_name("node-access.py").read_text()
    # Pass data through stdin. No hostname, address or browser text is inserted
    # into a remote shell command.
    payload = remote.replace(
        'request = json.loads(sys.stdin.read(2048))',
        'request = ' + repr({"collector": source}))
    with tempfile.TemporaryDirectory(prefix="shpun-monitoring-") as directory:
        known = Path(directory) / "known_hosts"
        known.write_text(known_key)
        known.chmod(0o600)
        result = subprocess.run([
            "ssh", "-T", "-i", str(key_path), "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
            "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", "UserKnownHostsFile=" + str(known), "-o", "UpdateHostKeys=no",
            "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=5",
            "-o", "ServerAliveCountMax=2", "root@" + target["address"], "python3 -",
        ], input=payload, capture_output=True, text=True, timeout=35)
    if result.returncode:
        raise AccessError("ssh_failed")
    response = json.loads(result.stdout)
    if not isinstance(response, dict) or type(response.get("ok")) is not bool:
        raise AccessError("apply_failed")
    return response


def main():
    request = json.loads(sys.stdin.read(2048))
    if (not isinstance(request, dict) or request.get("action") != "prepare"
            or type(request.get("serverId")) is not int or request["serverId"] <= 0):
        raise AccessError("server_not_found")
    # Share the infrastructure operation lock with backup/restore so the node
    # cannot be reconfigured while another administrative operation runs.
    with open("/var/lib/infra-recovery-bot/operation.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AccessError("access_busy")
        response = prepare(request["serverId"])
    print(json.dumps(response))


if __name__ == "__main__":
    try:
        main()
    except AccessError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": "access_timeout"}))
    except Exception:
        print(json.dumps({"ok": False, "error": "apply_failed"}))
