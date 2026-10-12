# SHM 2.19.10 -> 3.x: preparation and stop line

This is a rehearsal/runbook, **not an authorization to switch production**.
Production SHM, ShpunApp, bot webhook, payment callbacks and DNS remain on the
current version until the user explicitly approves the final cutover.

## Fixed inputs

- Baseline: production SHM 2.19.10; target tested on the isolated 3.5.0 clone.
  `3.5.1-beta` through `3.5.4-beta` appeared after 3.5.0. Recheck stable
  release and image digests immediately before scheduling the switch.
- ShpunApp changes live only on `codex/shm-3-upgrade` until a reviewed Git
  deployment. Do not edit or restart the running app as part of preparation.
- Bot migration order on the **new** DB: existing email transform, then
  `shm-core/migrate_telegram_bot_referrals_for_3x.py`. Apply with a source
  hash/CAS guard; syntax-check and read back the result. The bot claim secret
  in `config.bot.referralClaimSecret` must equal the existing
  `shpun_app` template `referral_secret` and ShpunApp `SHM_REFERRAL_SECRET`.
  Transfer it privately; never include it in Git, console output or URL.
- Apply the evidence-based Telegram account-link SQL only after a fresh
  conflict/missing-row audit. The clone's 61 repairs are not a substitute for
  checking the final snapshot.

## Remaining gates before scheduling

The compatibility-first route does **not** require proving every external
payment provider and Remnawave operation in a disconnected sandbox. It does
require preserving writes and proving our own integration. A "hot" copy made
while 2.x keeps accepting payments/orders will diverge from 3.x; there is no
dual-write or catch-up mechanism. Use a brief write freeze at the actual
switch, even if reads stay available.

1. Fresh production snapshot; encrypted off-host copy; restore in an isolated
   environment. The 2026-10-11 backup passed a full app DB/data/config restore
   test on 2026-10-12. Do **not** import its `mysql` system section into an
   initialized MySQL 9.7 server: that broke a disposable server. Preserve the
   dump's global `SET` preamble and import only the `shm` section, or restore a
   matching cold MySQL volume as a whole. Confirm grants and app connectivity.
2. Recreate the 3.x clone from the fresh snapshot. Compare users, accounts,
   services, balances and payment totals before and after migrations. Reapply
   the local FX adapter and both guarded bot-template transforms. Keep the
   clone's Telegram transport pointed to a private mock until tests end.
3. Compatibility must-pass: web password login/registration, Telegram login
   for an existing user, native account binding, a secondary confirmed email
   logging into the same user, bot email/referral registration, ShpunApp
   catalog and order readback, and canonical custom-template actions. The
   synthetic stage covered all except a real browser Widget/OIDC round trip,
   real bot transport and a pre-upgrade ShpunApp `sid`. The repaired SHM 3
   password-reset contract passed a full token/new-password/replay cycle.
   A browser/bot transport canary may run immediately after the switch with
   registrations held; decide explicitly whether a forced re-login is
   acceptable.
   Do not silently re-enable the technical-password fallback.
4. Preserve and compare the four payment-module binaries and configuration;
   verify their API/module loading and the YooMoney tunnel route before
   opening writes. A controlled real initiation/callback and provider key
   issue/renewal can be immediate monitored canaries **after** switch if the
   user accepts that bounded risk. Keep new orders/payments paused until the
   first canaries pass. Check SPB client Xray egress separately. Define an XTR
   policy before using Telegram Stars with multi-currency.
5. Verify admin/client UI reachability and local FX quotes. Pin all
   core/API/UI/dependency image digests and archive exact images. Do not let a
   mutable `latest` tag change during the window. Analytics/promo limitation
   remains an explicit product decision, not an app-compatibility failure.

## Final cutover outline (stop before this without explicit approval)

1. Announce a short maintenance window. Freeze/queue registrations, orders,
   renewals and payment callbacks; drain in-flight writes. Take the final
   consistent DB/data/config/image snapshot and off-host encrypted copy.
2. Recreate the tested 3.x stack from **that** snapshot, run guarded migrations
   and count/parity checks. Deploy reviewed ShpunApp Git revision and the bot
   config together; keep external traffic on 2.x until all internal checks pass.
3. After internal health, switch the read/auth routes and run limited real
   browser/bot canaries while registrations, orders and payments remain held.
   Open those writes only after login, registration, key, renewal and payment
   canaries pass. Compare balances/services/payment totals and monitor errors.
4. Keep the whole 2.x stack and snapshot ready during a defined rollback
   window. Rollback restores matching 2.x DB, data volume, config and pinned
   images together; never run 2.x against a migrated 3.x database. Reconcile
   or queue writes made after the snapshot before reopening traffic.

## Evidence so far

On the isolated 3.5.0 clone, native Telegram identity, synthetic bot email
verification, partner/campaign attribution, a 15% first-pay bonus state,
deduplicated app analytics, read-only catalog/paysystems and a `NOT PAID`
order passed. A cloned existing Telegram customer with an active service
logged into the isolated ShpunApp, retained the same billing identity and
service visibility, opened an existing active key through the app without
printing its subscription URL, and reused the same local `sid` on repeat
login; a forged signature failed. A synthetic second verified email logged
into its original ShpunApp/SHM user. SHM 3 requires `login` with the reset
token; the app and UI now pass both, reject HTTP-200 logical errors and hide
tokens from request logs. A full synthetic reset changed the same user's
password, rejected the old password and used-token replay. The encrypted
off-host backup was
decrypted and the app DB, data and config restored in a separate no-network
test. These do not replace the remaining gates above.
