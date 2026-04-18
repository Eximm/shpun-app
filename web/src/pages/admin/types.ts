// web/src/pages/admin/types.ts

export type BroadcastItem = {
  origin_id: string;
  ts: number;
  type?: string;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  copies: number;
  hidden: boolean;
};

export type ListResp   = { ok: true; items: BroadcastItem[] };
export type DeleteResp = { ok: true; originId: string; deleted: number };
export type HideResp   = { ok: true; originId: string; hidden: boolean; updated: number };
export type UpdateResp = { ok: true; originId: string; updated: number };

export type OrderBlockMode = "off" | "same_type" | "any";
export type TrialDeviceMode = "off" | "observe" | "enforce";

export type AdminSettingsResp = {
  ok: 1 | true;
  settings?: {
    orderBlockMode?: OrderBlockMode;
  };
};

export type AdminSettingsSaveResp = {
  ok: 1 | true;
  orderBlockMode?: OrderBlockMode;
};

export type TrialProtectionStatusResp = {
  ok: true;
  mode: TrialDeviceMode;
  ttlHours: number;
  ipPrefixUsageThreshold?: number;
  ipPrefixAttemptThreshold?: number;
  ipPrefixDistinctDevicesThreshold?: number;
  ipPrefixUserAgentAttemptThreshold?: number;
  ipPrefixDistinctUsersThreshold?: number;
  devicesWithTrial: number;
  activeTrialGroups?: number;
  activeBlockedDevices?: number;
  blocks24h?: number;
  attempts24h?: number;
  allows24h?: number;
  observes24h?: number;
  distinctDevices24h?: number;
  distinctIps24h?: number;
  reuseDevice24h?: number;
  reuseIp24h?: number;
  abuseIpPrefix24h?: number;
  blockDevice24h?: number;
  blockIp24h?: number;
  blockIpPrefix24h?: number;
  missingDeviceToken24h?: number;
  manualBlocks24h?: number;
};

export type TrialProtectionSettingsSaveResp = {
  ok: true;
  mode: TrialDeviceMode;
  ttlHours: number;
  ipPrefixUsageThreshold: number;
  ipPrefixAttemptThreshold: number;
  ipPrefixDistinctDevicesThreshold: number;
  ipPrefixUserAgentAttemptThreshold: number;
  ipPrefixDistinctUsersThreshold: number;
};

export type TrialProtectionEventItem = {
  id: number;
  created_at: number;
  event_type: string;
  decision: "allow" | "observe" | "block";
  reason?: string | null;
  device_token?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  user_id?: number | null;
  meta_json?: string | null;
  meta?: Record<string, any> | null;
};

export type TrialProtectionEventsResp = {
  ok: true;
  items: TrialProtectionEventItem[];
};

export type TrialDeviceItem = {
  id: number;
  device_token: string;
  first_seen_at: number | null;
  last_seen_at: number | null;
  first_ip?: string | null;
  last_ip?: string | null;
  user_agent?: string | null;
  trial_used_at?: number | null;
  trial_user_id?: number | null;
  last_user_id?: number | null;
  active_trial_count?: number;
  last_trial_used_at?: number | null;
  is_blocked?: number | null;
};

export type TrialDevicesResp = {
  ok: true;
  items: TrialDeviceItem[];
};

export type TrialPrefixItem = {
  ipPrefix: string;
  devicesCount: number;
  blockedDevices: number;
  distinctUsers: number;
  attempts24h: number;
  lastSeenAt?: number | null;
};

export type TrialPrefixesResp = {
  ok: true;
  items: TrialPrefixItem[];
};

export type ResetDeviceResp = {
  ok: true;
  deviceToken: string;
  reset: true;
};

export type ResetPrefixResp = {
  ok: true;
  ipPrefix: string;
  matchedDevices: number;
  resetDevices: number;
  deletedUsage: number;
  unblockedDevices: number;
  deletedEvents: number;
};

export type DeleteDeviceResp = {
  ok: true;
  deviceToken: string;
  deletedDevice: number;
  deletedUsage: number;
  deletedEvents: number;
};

export type BlockDeviceResp = {
  ok: true;
  deviceToken: string;
  blocked: boolean;
};

export type ClearEventsResp = {
  ok: true;
  deleted: number;
  keepLatest: number;
};

export type AdminTab = "overview" | "broadcasts" | "orderRules" | "trialProtection";