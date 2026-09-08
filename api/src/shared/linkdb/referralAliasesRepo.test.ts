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
