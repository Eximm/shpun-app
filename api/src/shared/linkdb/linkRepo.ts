// api/src/shared/linkdb/linkRepo.ts

import { linkDb } from "./db.js";

export type Provider = "telegram" | "google" | "yandex" | "email";

export function getLink(
  provider: Provider,
  profile: string,
  externalId: string
) {
  return linkDb
    .prepare(
      `SELECT provider, profile, external_id, shm_user_id, meta_json
       FROM account_links
       WHERE provider=? AND profile=? AND external_id=?`
    )
    .get(provider, profile, externalId) as
    | { shm_user_id: number; meta_json: string | null }
    | undefined;
}

export function touchLink(
  provider: Provider,
  profile: string,
  externalId: string,
  metaJson: string
) {
  linkDb
    .prepare(
      `UPDATE account_links
       SET updated_at=datetime('now'), last_seen_at=datetime('now'), meta_json=?
       WHERE provider=? AND profile=? AND external_id=?`
    )
    .run(metaJson, provider, profile, externalId);
}

export function insertLink(
  provider: Provider,
  profile: string,
  externalId: string,
  shmUserId: number,
  metaJson: string
) {
  linkDb
    .prepare(
      `INSERT INTO account_links(provider, profile, external_id, shm_user_id, last_seen_at, meta_json)
       VALUES(?,?,?,?,datetime('now'),?)`
    )
    .run(provider, profile, externalId, shmUserId, metaJson);
}
