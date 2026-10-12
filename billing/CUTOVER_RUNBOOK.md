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
3. Test real browser auth (legacy Widget/OIDC decision), an existing app `sid`,
   password reset, native Telegram login/account binding, bot email and alias
   registrations. Existing technical Telegram passwords require their own
   audited rotation after native login is proven; do not silently re-enable
   ShpunApp's password fallback.
4. Complete provider-specific key issue/renewal and every saved payment
   module's initiation/callback in a controlled sandbox. The current clone
   has no default route and has proven only catalog read plus a `NOT PAID`
   synthetic order. It has **not** proven provider provisioning or YooMoney.
   Check the YooMoney billing tunnel and, independently, that SPB client Xray
   traffic retains the hoster's egress. Verify Telegram Stars/XTR separately.
5. Verify billing UI/admin browser flows, analytics/promo limitations and local
   FX quotes. Pin all core/API/UI/dependency image digests and archive exact
   images. Do not let a mutable `latest` tag change during the window.

## Final cutover outline (stop before this without explicit approval)

1. Announce a short maintenance window. Freeze/queue registrations, orders,
   renewals and payment callbacks; drain in-flight writes. Take the final
   consistent DB/data/config/image snapshot and off-host encrypted copy.
2. Recreate the tested 3.x stack from **that** snapshot, run guarded migrations
   and count/parity checks. Deploy reviewed ShpunApp Git revision and the bot
   config together; keep external traffic on 2.x until all internal checks pass.
3. Switch routes/webhook/callbacks only after internal health **and** real
   canaries for login, registration, order, key, renewal and payment pass.
   Compare balances/services/payment totals and monitor errors continuously.
4. Keep the whole 2.x stack and snapshot ready during a defined rollback
   window. Rollback restores matching 2.x DB, data volume, config and pinned
   images together; never run 2.x against a migrated 3.x database. Reconcile
   or queue writes made after the snapshot before reopening traffic.

## Evidence so far

On the isolated 3.5.0 clone, native Telegram identity, synthetic bot email
verification, partner/campaign attribution, a 15% first-pay bonus state,
deduplicated app analytics, read-only catalog/paysystems and a `NOT PAID`
order passed. The encrypted off-host backup was decrypted and the app DB,
data and config restored in a separate no-network test. These do not replace
the remaining gates above.
