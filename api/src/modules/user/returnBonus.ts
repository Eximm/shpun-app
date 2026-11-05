/** Explicit billing state only; never infer a promotion from balance or a title. */
export function publicReturnBonus(settings: unknown) {
  let root: any = settings;
  if (typeof root === "string") { try { root = JSON.parse(root); } catch { return null; } }
  const value = root?.ShpynApp?.return_bonus ?? root?.return_bonus;
  if (!value || typeof value !== "object") return null;
  const flag = (v: unknown) => v === true || v === 1 || v === "1";
  const num = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0;
  return { pending: flag(value.pending), applied: flag(value.applied), tariffActivated: flag(value.tariff_activated),
    userServiceId: num(value.tariff_user_service_id), tariffId: num(value.tariff_id), days: num(value.tariff_days),
    percent: num(value.percent || value.applied_percent) };
}
