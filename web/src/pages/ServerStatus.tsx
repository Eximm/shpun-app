import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";

type StatusItem = {
  id: number;
  title: string;
  host: string;
  kind: "vpn" | "infra";
  online: boolean;
  latencyMs: number | null;
  uptime: string | null;
  loadPct: number | null;
  checkedAt: string;
};

type StatusResp = {
  ok: true;
  updatedAt: string;
  vpn: StatusItem[];
  infra: StatusItem[];
};

function timeAgo(iso?: string) {
  const ts = iso ? Date.parse(iso) : 0;
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.round(sec / 60);
  return `${min} мин назад`;
}

function loadTone(v: number | null) {
  if (v == null) return "soft";
  if (v >= 85) return "bad";
  if (v >= 65) return "warn";
  return "ok";
}

function ServerCard({ item }: { item: StatusItem }) {
  const tone = item.online ? "online" : "offline";
  return (
    <div className={`serverStatus-card serverStatus-card--${tone}`}>
      <div className="serverStatus-card__top">
        <span className={`serverStatus-dot serverStatus-dot--${tone}`} />
        <div className="serverStatus-card__title">{item.title || item.host}</div>
        <span className="serverStatus-card__state">{item.online ? "онлайн" : "оффлайн"}</span>
      </div>
      <div className="serverStatus-card__host">{item.host}</div>
      <div className="serverStatus-card__checked">Проверен: {timeAgo(item.checkedAt)}</div>
      <div className="serverStatus-metrics">
        <span><b>{item.uptime || "—"}</b><small>аптайм</small></span>
        <span><b>{item.latencyMs != null ? `${item.latencyMs} мс` : "—"}</b><small>отклик</small></span>
        <span className={`serverStatus-load serverStatus-load--${loadTone(item.loadPct)}`}><b>{item.loadPct != null ? `${item.loadPct}%` : "—"}</b><small>нагрузка</small></span>
      </div>
    </div>
  );
}

function StatusGroup({ title, sub, items }: { title: string; sub: string; items: StatusItem[] }) {
  const online = useMemo(() => items.filter((x) => x.online).length, [items]);
  return (
    <section className="serverStatus-group">
      <div className="serverStatus-group__head">
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
        <span className="serverStatus-group__count">{online}/{items.length}</span>
      </div>
      {items.length ? (
        <div className="serverStatus-grid">
          {items.map((item) => <ServerCard key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="card serverStatus-empty"><div className="card__body">Серверы пока не добавлены в мониторинг.</div></div>
      )}
    </section>
  );
}

export function ServerStatus() {
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<StatusResp>("/server-status", { method: "GET" });
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить статус серверов.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="section miniPage serverStatus-page">
      <div className="pageBackRow">
        <PageBackButton />
      </div>
      <div className="card miniPage__hero serverStatus-hero">
        <div className="card__body">
          <div className="serverStatus-hero__top">
            <div className="serverStatus-hero__title">
              <h1 className="h1">Статус серверов</h1>
              <p className="p miniPage__subtitle">Коротко и по делу: жив сервер или нет, сколько работает и как быстро отвечает.</p>
            </div>
          </div>
          <div className="serverStatus-actions">
            <button className="btn btn--primary" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Проверяем…" : "Обновить"}
            </button>
          </div>
          {error && <div className="pre" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>

      <StatusGroup title="VPN-серверы" sub="Ноды, которые используются для подключений." items={data?.vpn ?? []} />
      <StatusGroup title="Кабинет и подписки" sub="Служебные узлы приложения и инфраструктуры." items={data?.infra ?? []} />
    </div>
  );
}
