# SHM continuity decision, 2026-10-11

## Current decision

Target the currently published stable SHM 3.5.0 without waiting for the
maintainer's promised analytics/promo release. Production remains on 2.19.10
until the user-facing compatibility and rollback gates below pass. The
`billing/analytics` report is a cold contingency, not a deployed replacement
of the SHM feature. Analytics and Cloud-gated promo redemption in 3.5.0 must
be treated as unavailable until independently verified, not silently bypassed.

## SHM Cloud dependencies found in the 3.5.0 core source

| Surface | Dependency | Current disposition |
| --- | --- | --- |
| Currency conversion | `Core::Cloud::Currency` calls `/service/currencies/list` and writes to Cloud on admin save. | Independent local adapter is built and tested on the isolated 3.5.0 clone; it is not deployed. Rebase it on the actual target release. |
| Analytics | `Core::Analytics::api_report` checks `Cloud::Subscription`. | Not an upgrade gate if the user accepts the missing dashboard temporarily. Do not remove the entitlement check from the paid endpoint. A separate aggregate report is available as a fallback. |
| Promo redemption | `Core::Promo::apply` checks `Cloud::Subscription`. | Not an upgrade gate if the user accepts Cloud-gated promo redemption temporarily; do not advertise new promo campaigns until redemption is tested. |
| Payment-module updates | `Core::Cloud::Jobs` can download files from Cloud at startup or after configuration change. | Four currently used ARM64 binaries are saved in the verified backup and were copied byte-for-byte to the clone. No update is pending in production. Future provider/API changes remain a vendor risk. |
| Cloud account/admin proxy | Cloud login, account, paysystem catalog, and generic proxy endpoints remain in core. | They are not the local customer's normal login, but Cloud-related admin screens may fail while Cloud is down. Admin UI source availability needs separate audit. |
| Template S3 helper | `Core::S3` defaults to Yandex Object Storage if a template uses it. | None of the 57 local templates matched direct S3 or SHM Cloud calls in a text scan. The scan cannot prove absence of indirect/template-generated calls. |
| Telegram Stars | Telegram transport tries `Cloud::Currency` for XTR, then a configured `xtr_exchange_rate` fallback. | CBR does not quote XTR, and the live `telegram` config has no such fallback. Check whether this transport path is used; if it is, the source leaves the raw Stars amount as money when both conversion and fallback fail. Validate the actual payment path and add an explicit XTR policy before any currency cutover. |

The billing database and locally stored templates remain ours. The local
source scan does not cover opaque payment binaries or every behavior of the
separately distributed administrator image.

## Verified preparation, not a production upgrade

- A local mirror and verified Git bundle exist for `danuk/shm` and the public
  `danuk/shm-client-2` repository. The documented `danuk/shm-admin` source URL
  currently returns 404; do not assume we can rebuild the admin image.
- The live 2.19.10 snapshot includes DB, configuration, local templates, four
  payment modules, and exact running Docker images. Checksums passed. A copy
  encrypted to the workstation's SSH public key was transferred to an ignored
  local folder and its SHA-256 matched the server copy. A full decrypt/restore
  of that encrypted off-host copy has **not** yet been rehearsed.
- The isolated SHM 3.5.0 clone completed migrations and passed customer login,
  additional email binding, code verification, and an independent FX test.
  This says nothing yet about bot referrals, production payment callbacks,
  renewals, or operational continuity under a real Cloud outage.
- The `shpun_app` template on the clone returned `bad_session` because it tried
  to resolve a session through an obsolete template variable. A narrowly scoped
  migration script in `billing/shm-core` now uses the authenticated request's
  user, removes the obsolete `login2` write, and bases the email onboarding
  marker on the verified account. The exact current production template was
  transformed only on the clone; a synthetic user passed owner and invalid-
  session checks. This patch is not deployed to production.
- The current `telegram_bot` template still reads legacy `settings.email`,
  `settings.email_verified`, `email_verify_code`, and `login2`, and its code
  confirmation writes these old fields instead of the SHM 3.x `accounts`
  record. Its registration command uses SHM's native registration, but the
  email confirmation/login experience is not yet compatible. This is a
  blocking cutover gate; migrate and test the bot template first.
- The ShpunApp API now has a stage-safe strict Telegram mode: the deterministic
  password fallback is disabled unless explicitly enabled, and the optional
  legacy path independently verifies Telegram signatures before using it.
  The signed Widget binding request also now supplies the authenticated
  `session_id` expected by SHM 3.x rather than an ignored `uid` field.
  This is local branch preparation only; it has not been deployed or exercised
  against the 3.x clone. The full auth rehearsal is in `AUTH_CUTOVER.md`.
- Production images still use mutable `latest` tags. At eventual cutover, pin
  exact digests for core, API, client, admin and dependencies, and archive
  matching image tarballs before the first database migration.
- The registry does not currently publish `3.5.0` tags for `danuk/shm-admin`
  or `danuk/shm-client-2`; their `latest` images must be pinned by digest and
  exercised against the 3.5.0 clone before cutover. Isolated copies of the
  currently running UI images returned HTTP 200 when proxying `/shm/v1/test`
  to the 3.5.0 API. This only proves the proxy, not browser login/order/admin
  behavior. Do not equate an HTTP health check with a working billing UI.

## Release acceptance gates

1. Pin the published stable 3.5.0 source and image digests for all components.
   Record the temporary analytics/promo limitations clearly; no bypass of paid
   checks. If a newer stable release appears before cutover, re-run all gates.
2. Recreate a clean clone from a fresh production snapshot. Apply all new
   migrations, compare user/account/service/payment counts, and test the
   `shpun_app` billing template, migrated bot email flow, bot registration and
   referrals, key issue and renewal, duplicate email, secondary logins and
   password reset.
3. Test each saved payment module's initiation and callback without real
   charges where possible. Test YooMoney through the intended tunnel while
   confirming client Xray traffic stays on the hoster's egress. Validate
   Telegram Stars/XTR accounting independently.
4. Rebase and retest the local currency adapter. Keep RUB as the SHM ledger;
   show foreign currencies only via expiring quotes with a stored rate and
   payment-provider currency. Fail closed on stale/unknown rates.
5. Rehearse a complete restore from the encrypted off-host backup. Define a
   maintenance window and rollback point. A migrated 3.x DB cannot be
   assumed to downgrade to 2.x in place: rollback restores the *whole*
   pre-upgrade DB, data volume, configuration and pinned images together.
6. Canary with monitored real user flows, then switch traffic. Keep a
   documented rollback window and compare balances, services, payment totals
   and errors before removing the old environment.

## If upstream maintenance stops

Keep serving from pinned, locally archived images while maintaining a private
fork of the Apache-2.0 core and public client source. Maintain our own build
and smoke-test pipeline for the exact production revision; never follow
`latest`. Separate the smallest patches (FX, auth compatibility, providers)
from upstream code so security fixes can still be cherry-picked. Keep the
database, templates, provider settings, payment binaries and image archives in
regular encrypted offsite backups with periodic restore tests. Set an owner
and response procedure for broken payment APIs, browser/OAuth changes and
security vulnerabilities. The admin source and proprietary ARM64 payment
binaries are the main remaining independence gaps; replacement modules or a
new admin interface would be separate projects, not emergency hotfixes.

No public evidence establishes that the maintainer will stop supporting SHM.
Recent repository activity and the stated release plan point the other way,
but neither is a support guarantee. Trigger a fork/replace decision based on
concrete failures: unavailable source/images, unpatched security issues,
broken paid functions or providers, or repeated failed release gates.
