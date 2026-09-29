/**
 * Node Exporter collectors that provide every metric consumed by
 * `parseNodeExporter`. Filtering at the source avoids unrelated slow collectors
 * (notably systemd) turning a healthy server into an exporter timeout.
 */
export const NODE_EXPORTER_COLLECTORS = [
  "cpu",
  "loadavg",
  "meminfo",
  "filesystem",
  "netdev",
  "netclass",
  "filefd",
  "sockstat",
  "time",
  "stat",
] as const;

export function nodeExporterScrapeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.delete("collect[]");
  for (const collector of NODE_EXPORTER_COLLECTORS) {
    url.searchParams.append("collect[]", collector);
  }
  return url.toString();
}
