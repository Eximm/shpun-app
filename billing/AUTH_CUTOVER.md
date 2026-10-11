# SHM 3.x authentication cutover rehearsal

This is a staging checklist, not permission to deploy. Production SHM 2.x,
ShpunApp, bot webhooks, payment callbacks and customer traffic must remain on
their present routes until every gate below is recorded as passed.

## Isolation first

- The existing `shm-stage-3x-*` containers are a separate Docker network and
  separate database/data volumes, with no published ports. They are currently
  stopped, but they share the **production host**. This is logical isolation,
  not failure isolation. Do not start them without checking host headroom and
  confirming that stage jobs cannot send real messages, charge providers, or
  accept production webhooks.
- Give the test ShpunApp API its own `DATA_DIR` and `SHM_BASE` pointing only to
  the stage API. Give the browser a separate origin and cookie scope. Do not
  connect a test app to the production session store or billing database.
- Use a dedicated Telegram test bot and stage Telegram profile. Keep its token,
  OIDC client ID/secret and BotFather Allowed URLs out of Git. Never forward
  the production bot webhook to stage.

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

- Migrate the `telegram_bot` email verification/account-linking template;
  the current `login2` and `settings.email` writes are not 3.x-compatible.
- Rehearse password reset and existing ShpunApp `sid` continuity. Do not assume
  that a valid app cookie still works after its stored SHM session changes.
- Test ordering, key issue/renewal, payment initiation/callback, YooMoney
  tunnel routing, and read-only balance/service parity on the clone.
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
- No end-to-end OIDC authorization, live test-bot callback, app session
  continuity, or customer-flow rehearsal on the 3.x clone has been completed.
- The stage containers are stopped. No production service was changed by this
  preparation.
