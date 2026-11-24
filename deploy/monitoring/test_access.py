import base64
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge = load("access-bridge")
node = load("node-access")


class AccessTests(unittest.TestCase):
    def test_only_direct_managed_exporters_are_eligible(self):
        row = dict(active=1, node_exporter_enabled=1, exporter_auth_type="none",
                   host="node.example", exporter_url="http://node.example:9100/metrics")
        self.assertEqual(bridge.endpoint_host(row), "node.example")
        for change in [
            dict(exporter_url="http://other.example:9100/metrics"),
            dict(exporter_url="http://node.example:9100/proxy"),
            dict(exporter_url="http://node.example:9100/metrics?token=secret"),
            dict(exporter_url="https://node.example:9100/metrics"),
            dict(active=0), dict(exporter_auth_type="basic"),
        ]:
            with self.assertRaises(bridge.AccessError):
                bridge.endpoint_host({**row, **change})

    def test_inventory_key_must_match_approved_fingerprint(self):
        key = base64.b64encode(b"test key").decode()
        fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(b"test key").digest()).decode().rstrip("=")
        row = dict(address="192.0.2.5", host_key_line="192.0.2.5 ssh-ed25519 " + key,
                   host_fingerprint=fingerprint)
        self.assertIn("192.0.2.5 ssh-ed25519", bridge.verified_key(row))
        with self.assertRaises(bridge.AccessError):
            bridge.verified_key({**row, "host_fingerprint": "different"})

    def files(self, collector=""):
        exporter = MagicMock()
        exporter.read_text.return_value = "[Service]\nExecStart=\nExecStart=/usr/bin/prometheus-node-exporter --web.listen-address=127.0.0.1:9100\n"
        firewall = MagicMock()
        firewall.read_text.return_value = "[Service]\nExecStart=/usr/local/sbin/infra-metrics-firewall " + collector + "\n"
        helper = MagicMock()
        for p in [exporter, firewall, helper]:
            p.is_file.return_value = True
            p.is_symlink.return_value = False
            p.stat.return_value = SimpleNamespace(st_uid=0, st_mode=0o100644)
        return exporter, firewall, helper

    def test_setup_changes_only_managed_bind_and_collector_and_keeps_backups(self):
        files = self.files()
        with patch.object(node, "Path", side_effect=files), patch.object(node.shutil, "copy2") as backup, \
                patch.object(node, "run") as run, patch.object(node.time, "sleep"):
            self.assertTrue(node.prepare("192.0.2.10")["ok"])
        self.assertEqual(backup.call_count, 2)
        self.assertIn("0.0.0.0:9100", files[0].write_text.call_args.args[0])
        self.assertIn("infra-metrics-firewall 192.0.2.10", files[1].write_text.call_args.args[0])
        services = [c.args for c in run.call_args_list if c.args[:2] == ("systemctl", "restart")]
        self.assertEqual(services, [("systemctl", "restart", "infra-metrics-firewall.service"),
                                    ("systemctl", "restart", "prometheus-node-exporter.service")])

    def test_existing_other_collector_is_preserved(self):
        files = self.files("192.0.2.20")
        with patch.object(node, "Path", side_effect=files), patch.object(node, "run") as run:
            with self.assertRaisesRegex(node.AccessError, "collector_conflict"):
                node.prepare("192.0.2.10")
        files[0].write_text.assert_not_called()
        run.assert_not_called()

    def test_failed_restart_restores_original_files(self):
        files = self.files()
        with patch.object(node, "Path", side_effect=files), patch.object(node.shutil, "copy2"), \
                patch.object(node, "run", side_effect=RuntimeError("failed")), \
                patch.object(node.subprocess, "run"):
            with self.assertRaisesRegex(node.AccessError, "apply_failed"):
                node.prepare("192.0.2.10")
        for p in files[:2]:
            self.assertEqual(p.write_text.call_args.args[0], p.read_text.return_value)


if __name__ == "__main__":
    unittest.main()
