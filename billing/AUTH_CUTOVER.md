# SHM 3.x authentication cutover rehearsal

This is a staging checklist, not permission to deploy. Production SHM 2.x,
ShpunApp, bot webhooks, payment callbacks and customer traffic must remain on
their present routes until the compatibility and recovery gates are accepted
and the final switch is explicitly authorized. The bounded canary alternative
for external providers is in `CUTOVER_RUNBOOK.md`.

## Isolation first

- The existing `shm-stage-3x-*` containers are a separate Docker network and
  separate database/data volumes, with no published ports. Their running state
  changes during tests; they share the **production host**. This is logical isolation,
  not failure isolation. Do not start them without checking host headroom and
  confirming that stage jobs cannot send real messages, charge providers, or
  accept production webhooks.
- Give the test ShpunApp API its own `DATA_DIR` and `SHM_BASE` pointing only to
  the stage API. Give the browser a separate origin and cookie scope. Do not
  connect a test app to the production session store or billing database.
- Prefer a dedicated Telegram test bot and stage Telegram profile for the final
  bot conversation test. No separate test bot is currently configured. Keep
  its token, OIDC client ID/secret and BotFather Allowed URLs out of Git. Never
  forward the production bot webhook to stage. If no test bot is available,
  keep this gate open until a controlled canary can prove it without exposing
  normal customers to the migrated flow.

## Telegram identity gates

1. Keep `SHM_TELEGRAM_PASSWORD_FALLBACK` unset (`0`) on SHM 3.x stage. Native
   signed Mini App and browser login must work without generating a technical
   password or writing `login2`. The legacy fallback can be enabled only for
   an explicitly approved 2.x compatibility test and additionally requires
   `SHM_TELEGRAM_BOT_TOKEN` to verify the payload locally.
   Set `SHM_TELEGRAM_PROFILE` explicitly: SHM 3.5 requires `profile` on the
   `/telegram/webapp/auth` route.
2. For an existing test customer, verify that Telegram login, email/password
   login, and any secondary verified email all resolve to the **same SHM
   user_id** and retain the original balance and services. An unknown Telegram
   identity must not silently create a second account when the user intended
   to bind an existing one. Test the Profile "bind Telegram" button against
   SHM 3.x as well: the request must bind using the authenticated
   `session_id`, and the new `accounts` row must belong to that same user.
3. For a new customer, test Telegram Mini App registration, web login, email
   confirmation, bot registration, partner/campaign attribution, and repeated
   login. Record the account rows before and after each action.
   In SHM 3.5, `/telegram/webapp/auth` is login-only; a new Mini App user must
   first be created by the migrated bot's `/start` path, or a separate safe
   registration flow must be implemented. Do not silently re-enable the
   technical-password registration path.
4. Test invalid, expired, replayed and wrong-bot Telegram signatures; invalid
   payloads must never fall through to password login or registration.
5. Add Telegram OIDC Code Flow for browser login only after confirming the
   exact 3.x callback behavior on stage. Require PKCE, server-checked `state`,
   a registered stage redirect URL, and no SHM session ID in a browser URL.
   Keep the old Widget visible only until OIDC and account-binding canaries
   pass. Mini App `initData` is a different login surface and is not replaced
   by browser OIDC.
   The 3.5 `web/auth` route accepts native registration, but its public
   parameter schema does not list `partner_id`. Verify referral attribution
   on a clone before using native Telegram/OIDC registration for campaigns.

## Other cutover gates

- Run a real bot registration and email-verification conversation against the
  migrated template. An end-to-end **synthetic webhook** conversation passed
  against the clone with all outgoing Telegram calls intercepted; a real bot
  conversation has not passed yet.
- Rehearse password reset and existing ShpunApp `sid` continuity. Do not assume
  that a valid app cookie still works after its stored SHM session changes.
  An existing cloned Telegram customer did log into the isolated ShpunApp,
  retained the original billing user and active service, opened its connection
  through the app without disclosing the key, and reused the same
  local `sid` on repeat login. This is **not** a pre-upgrade cookie test.
  A synthetic second confirmed email also logged into the same billing user.
  Reset initiation returned 200 on the clone, but token confirmation remains
  untested.
- Test ordering and read-only balance/service parity on the clone. Check the
  YooMoney tunnel before reopening payments. External provider key
  issue/renewal and payment callbacks may instead be monitored canaries after
  switching, if that bounded risk is explicitly accepted.
- Freeze or queue writes for the final snapshot/migration interval. A clone
  made earlier is not current enough for cutover: new payments and orders must
  not be lost. Define a whole-stack restore point and a short rollback window.
- Roll back by restoring the matching pre-upgrade database, data volume,
  configuration and pinned images together; never downgrade a migrated 3.x
  database in place.

## Current evidence

- Local API tests cover strict mode, forged Telegram payload rejection and the
  3.x binding request shape.
- A read-only check of the running ShpunApp container found none of the
  configured secrets used for legacy deterministic Telegram passwords. This
  may leave old `@TelegramID` accounts with predictable passwords even through
  SHM's ordinary password endpoint. Disabling the app fallback alone does not
  invalidate existing SHM passwords. Audit the affected accounts and plan a
  credential rotation or password-login disablement separately, before
  calling the production auth path safe. Do not include password derivations,
  credentials or customer identifiers in test reports.
- On the 2026-10-11 isolated clone, 15 accounts were confirmed to have the
  old default technical password. All 15 lacked an `accounts(type=telegram)`
  row after the upstream migration, although the ShpunApp settings recorded
  the matching Telegram ID. Changing those passwords or disabling fallback
  before linking them would lock these customers out. There were 61 missing
  Telegram account rows among 1,381 `@numeric` users, with no conflicting
  rows. The narrowly scoped SQL in `shm-core/link_verified_telegram_accounts.sql`
  linked 23 accounts whose ShpunApp ID matched their legacy login and the
  remaining 38 whose legacy private `telegram.chat_id` matched it. After the
  stage-only repair, all 1,381 have a Telegram account row for the original
  user, with zero conflicts or missing rows. The latter group included an
  account with an active service.
- Independently signed Telegram Mini App payloads authenticated one account
  from each group and resolved to the original billing `user_id`, including
  the account with an active service. Forged signatures were rejected. This
  proves those stage paths, not every customer, browser Widget/OIDC,
  production 2.x, or a production credential rotation. Re-run the count and
  identity tests on a fresh snapshot before cutover. Never output IDs or tokens.
- On one cloned affected account, replacing the default technical password
  with a random PBKDF2 hash made the old password fail while signed Telegram
  login still worked. Its original stage hash was restored after this test.
  This is a rehearsal, not permission to rotate production credentials before
  a fresh backup, full-account audit, native-login canaries and rollback plan.
- A temporary local ShpunApp API with its own empty `DATA_DIR`, strict
  Telegram mode and an SSH-only connection to the clone passed synthetic
  registration/password re-login, signed Mini App login to the original
  billing user, forged-signature rejection, `/me`, `/services`, and secondary
  email add/send/invalid-code/verify/readback. It was stopped afterward.
  This does not prove preservation of existing production ShpunApp `sid`
  cookies or a browser session through the actual switch.
- No end-to-end OIDC authorization, live test-bot callback, existing app
  session continuity, provider key issue/renewal, or payment callback on the
  3.x clone has been completed.
- SHM 3 fingerprints bot-created sessions to the webhook IP and User-Agent.
  Passing `user.gen_session.id` from the bot to the app for a protected
  `shpun_app` template call returned 401; doing it synchronously during a
  webhook also timed out. The migrated bot now performs billing attribution
  and first-payment-bonus initialization in its own trusted context, then
  reports a signed internal receipt to ShpunApp for analytics. The stage
  tested a 15% partner bonus and a separate campaign, each counted once.
  The production bot must receive the same existing referral secret through
  `config.bot.referralClaimSecret` at cutover; never commit the value.
- The migrated bot template and synthetic test accounts exist only in the
  isolated clone. Its mock transport was removed and stage containers stopped
  after testing. Production bot, billing and ShpunApp were not changed.
