// web/src/pages/admin/gateway/StatusDot.tsx

import { useI18n } from "../../../shared/i18n";
import type { ServerStatus } from "./gatewayApi";

export function StatusDot({ status }: { status: ServerStatus }) {
  const { t } = useI18n();
  return <span className={`gw-dot is-${status}`} title={t(`admin.gateways.status.${status}`)} aria-hidden="true" />;
}
