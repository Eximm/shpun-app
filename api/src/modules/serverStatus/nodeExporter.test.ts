import assert from "node:assert/strict";
import test from "node:test";

const { parseNodeExporter, parsePrometheusNeeded } = await import("./nodeExporter.js");

const NOW_MS = 1_700_000_000_000;

const METRICS = `
# HELP node_time_seconds current time
node_time_seconds 1700000000
node_boot_time_seconds 1699000000
node_cpu_seconds_total{cpu="0",mode="idle"} 1000
node_cpu_seconds_total{cpu="0",mode="user"} 200
node_cpu_seconds_total{cpu="0",mode="iowait"} 50
node_cpu_seconds_total{cpu="0",mode="system"} 100
node_cpu_seconds_total{cpu="1",mode="idle"} 1000
node_cpu_seconds_total{cpu="1",mode="user"} 200
node_cpu_seconds_total{cpu="1",mode="iowait"} 50
node_cpu_seconds_total{cpu="1",mode="system"} 100
node_load1 1.5
node_load5 1.2
node_load15 0.9
node_memory_MemTotal_bytes 8000000000
node_memory_MemAvailable_bytes 2000000000
node_memory_SwapTotal_bytes 1000000000
node_memory_SwapFree_bytes 800000000
node_filesystem_size_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 100000000000
node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 40000000000
node_filesystem_files{device="/dev/sda1",fstype="ext4",mountpoint="/"} 1000
node_filesystem_files_free{device="/dev/sda1",fstype="ext4",mountpoint="/"} 100
node_filesystem_size_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run"} 999999999999
node_network_receive_bytes_total{device="eth0"} 5000000
node_network_transmit_bytes_total{device="eth0"} 2000000
node_network_receive_bytes_total{device="lo"} 999999
node_network_receive_errs_total{device="eth0"} 3
node_network_transmit_errs_total{device="eth0"} 1
node_network_receive_drop_total{device="eth0"} 4
node_network_transmit_drop_total{device="eth0"} 2
node_network_speed_bytes{device="eth0"} 125000000
node_filefd_allocated 512
node_sockstat_sockets_used 88
`;

test("parses only needed metric families", () => {
  const parsed = parsePrometheusNeeded(METRICS);
  assert.ok(parsed.length > 0);
  assert.ok(parsed.every((m) => !m.name.startsWith("go_")));
});

test("parses uptime, load, memory, disk, inode, network", () => {
  const s = parseNodeExporter(METRICS, { nowMs: NOW_MS });
  assert.equal(s.online, true);
  assert.equal(s.uptimeSeconds, 1_000_000);
  assert.equal(s.load1, 1.5);
  assert.equal(s.load5, 1.2);
  assert.equal(s.load15, 0.9);
  assert.equal(s.cpuCores, 2);
  // 8GB total, 2GB available -> 75% used
  assert.equal(s.memoryUsedPct, 75);
  // 1GB swap total, 800MB free -> 20% used
  assert.equal(s.swapUsedPct, 20);
  // root fs picked (tmpfs ignored): 100GB total, 40GB free -> 60% used
  assert.equal(s.diskUsedPct, 60);
  assert.equal(s.diskFreeBytes, 40_000_000_000);
  assert.equal(s.inodeUsedPct, 90);
  // lo is excluded from network totals
  assert.equal(s.rxBytesTotal, 5_000_000);
  assert.equal(s.txBytesTotal, 2_000_000);
  assert.equal(s.rxErrorsTotal, 3);
  assert.equal(s.txDropsTotal, 2);
  assert.equal(s.maxUplinkSpeedBytes, 125_000_000);
  assert.equal(s.fileDescriptors, 512);
  assert.equal(s.sockets, 88);
});

test("computes CPU busy %, iowait, network rates and deltas from a previous sample", () => {
  const previous = {
    ts: NOW_MS - 10_000,
    cpuTotal: 2600,
    cpuIdle: 1990,
    cpuIowait: 100,
    rxBytes: 4_999_000,
    txBytes: 1_999_000,
    rxErrors: 1,
    txErrors: 1,
    rxDrops: 0,
    txDrops: 0,
  };
  // Current totals: idle 2000, iowait 100, total 2700 -> delta 100, idle delta 10.
  const s = parseNodeExporter(METRICS, { nowMs: NOW_MS, previous });
  assert.equal(s.cpuBusyPct, 90);
  assert.equal(s.iowaitPct, 0);
  // 1000 bytes over 10s -> 100 B/s
  assert.equal(s.rxBytesPerSec, 100);
  assert.equal(s.txBytesPerSec, 100);
  assert.equal(s.rxErrorsDelta, 2);
  assert.equal(s.txDropsDelta, 2);
});

test("missing metrics stay null instead of throwing", () => {
  const s = parseNodeExporter("# nothing here\n", { nowMs: Date.now() });
  assert.equal(s.online, true);
  assert.equal(s.uptimeSeconds, null);
  assert.equal(s.cpuBusyPct, null);
  assert.equal(s.memoryUsedPct, null);
  assert.equal(s.diskUsedPct, null);
  assert.equal(s.rxBytesTotal, null);
});

test("cpu busy is clamped to 0..100", () => {
  const previous = {
    ts: 1000,
    cpuTotal: 0,
    cpuIdle: 0,
    cpuIowait: 0,
    rxBytes: 0,
    txBytes: 0,
    rxErrors: 0,
    txErrors: 0,
    rxDrops: 0,
    txDrops: 0,
  };
  const weird = `node_cpu_seconds_total{cpu="0",mode="idle"} 5\nnode_cpu_seconds_total{cpu="0",mode="user"} 1\n`;
  const s = parseNodeExporter(weird, { nowMs: 2000, previous });
  assert.ok(s.cpuBusyPct !== null && s.cpuBusyPct >= 0 && s.cpuBusyPct <= 100);
});