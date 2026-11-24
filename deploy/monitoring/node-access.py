#!/usr/bin/python3
"""Prepare the existing managed Node Exporter. Only TCP/9100 is affected."""
import ipaddress
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone


class AccessError(Exception):
    pass


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=12)


def prepare(collector):
    source = ipaddress.ip_address(collector)
    exporter = Path("/etc/systemd/system/prometheus-node-exporter.service.d/override.conf")
    firewall = Path("/etc/systemd/system/infra-metrics-firewall.service")
    helper = Path("/usr/local/sbin/infra-metrics-firewall")
    if not exporter.is_file():
        raise AccessError("exporter_missing")
    for p in [exporter, firewall, helper]:
        if p.is_symlink() or not p.is_file() or p.stat().st_uid != 0 or p.stat().st_mode & 0o022:
            raise AccessError("unsupported_config")
    old_exporter, old_firewall = exporter.read_text(), firewall.read_text()
    exporter_command = re.compile(r"^ExecStart=/usr/bin/prometheus-node-exporter --web.listen-address=\S+:9100$", re.M)
    firewall_command = re.compile(r"^ExecStart=/usr/local/sbin/infra-metrics-firewall(?:[ \t]+([^\n]*))?$", re.M)
    matches = list(firewall_command.finditer(old_firewall))
    if len(matches) != 1 or len(exporter_command.findall(old_exporter)) != 1:
        raise AccessError("unsupported_config")
    previous_source = (matches[0].group(1) or "").strip()
    if previous_source and previous_source != str(source):
        raise AccessError("collector_conflict")
    # Wildcard binding survives a future node IP change. The managed firewall
    # permits only the collector and loopback, for both address families.
    listen = "[::]:9100" if source.version == 6 else "0.0.0.0:9100"
    new_exporter = exporter_command.sub(
        "ExecStart=/usr/bin/prometheus-node-exporter --web.listen-address=" + listen, old_exporter)
    new_firewall = firewall_command.sub(
        "ExecStart=/usr/local/sbin/infra-metrics-firewall " + str(source), old_firewall)
    changed = old_exporter != new_exporter or old_firewall != new_firewall
    if not changed:
        binary = "iptables" if source.version == 4 else "ip6tables"
        try:
            run("systemctl", "is-active", "prometheus-node-exporter.service")
            run(binary, "-C", "IRB_METRICS", "-s", str(source), "-j", "ACCEPT")
            return {"ok": True, "error": None}
        except subprocess.CalledProcessError:
            pass
    if changed:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        for p in [exporter, firewall]:
            shutil.copy2(p, str(p) + ".bak-" + stamp)
    try:
        exporter.write_text(new_exporter)
        firewall.write_text(new_firewall)
        run("systemctl", "daemon-reload")
        run("systemctl", "restart", "infra-metrics-firewall.service")
        run("systemctl", "restart", "prometheus-node-exporter.service")
        run("systemctl", "is-active", "prometheus-node-exporter.service")
    except Exception:
        exporter.write_text(old_exporter)
        firewall.write_text(old_firewall)
        for command in [
            ["systemctl", "daemon-reload"],
            ["systemctl", "restart", "infra-metrics-firewall.service"],
            ["systemctl", "restart", "prometheus-node-exporter.service"],
        ]:
            subprocess.run(command, capture_output=True, timeout=12)
        raise AccessError("apply_failed")
    time.sleep(0.3)
    return {"ok": True, "error": None}


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(2048))
        with open("/run/lock/shpun-monitoring-access.lock", "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise AccessError("access_busy")
            print(json.dumps(prepare(request["collector"])))
    except AccessError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
    except Exception:
        print(json.dumps({"ok": False, "error": "apply_failed"}))
