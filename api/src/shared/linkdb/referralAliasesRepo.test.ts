import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("campaign links work without a partner and count each billing user once", async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "shpun-referral-campaign-"));
  const repo = await import("./referralAliasesRepo.js");

  const campaign = repo.saveReferralAlias({
    alias: "telegram_news",
    linkType: "campaign",
    partnerId: 0,
    billingComment: "Реклама Telegram — Новости",
    enabled: true,
  });

  assert.equal(campaign.link_type, "campaign");
  assert.equal(campaign.partner_id, 0);
  assert.equal(campaign.billing_comment, "Реклама Telegram — Новости");

  repo.recordReferralAliasVisit(campaign.alias);
  assert.equal(repo.recordReferralAliasRegistrationForUser(campaign.alias, 501), true);
  assert.equal(repo.recordReferralAliasRegistrationForUser(campaign.alias, 501), false);
  assert.equal(repo.findReferralAlias(campaign.alias)?.visits_count, 1);
  assert.equal(repo.findReferralAlias(campaign.alias)?.registrations_count, 1);
});

test("partner links retain their existing validation and defaults", async () => {
  const repo = await import("./referralAliasesRepo.js");
  const partner = repo.saveReferralAlias({
    alias: "blogger_one",
    linkType: "partner",
    partnerId: 123,
    campaignCode: "Blogger One",
  });

  assert.equal(partner.link_type, "partner");
  assert.equal(partner.partner_id, 123);
  assert.equal(partner.partner_reward_percent, 30);
});

test("referralComment is the single canonical comment rule", async () => {
  const repo = await import("./referralAliasesRepo.js");

  const named = repo.saveReferralAlias({
    alias: "check",
    linkType: "partner",
    partnerId: 2,
    campaignCode: "exCheck",
  });
  assert.equal(repo.referralComment(named), "exCheck");

  const plain = repo.saveReferralAlias({
    alias: "plain",
    linkType: "partner",
    partnerId: 3,
  });
  assert.equal(repo.referralComment(plain), "plain");

  const campaign = repo.saveReferralAlias({
    alias: "reklamman",
    linkType: "campaign",
    partnerId: 0,
    billingComment: "Telegram Ads",
  });
  assert.equal(repo.referralComment(campaign), "Telegram Ads");
});

test("ad_cost_minor migration is additive and defaults to 0", async () => {
  const { linkDb } = await import("./db.js");
  const repo = await import("./referralAliasesRepo.js");

  const columns = linkDb.prepare(`PRAGMA table_info(referral_aliases)`).all() as Array<{
    name: string;
    dflt_value: string | null;
    notnull: number;
  }>;
  const column = columns.find((c) => c.name === "ad_cost_minor");
  assert.ok(column, "ad_cost_minor column must exist");
  assert.equal(Number(column!.notnull), 1);
  assert.match(String(column!.dflt_value), /0/);

  // A link saved without an explicit ad cost reads back as 0 (not null/NaN).
  const legacy = repo.saveReferralAlias({
    alias: "legacy_cost",
    linkType: "campaign",
    partnerId: 0,
    billingComment: "Legacy",
  });
  assert.equal(legacy.ad_cost_minor, 0);
});
