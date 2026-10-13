# Local SHM 3.6.0 core customizations

Production rollout on 2026-10-13 uses the pinned images in
`docker-compose.override.3.6.yml`. The previous override and a fresh checked
MySQL dump are stored on core at `/opt/shm/backups/pre-3.6.0-20261013-1/`.
Later the same day, only the admin UI was updated to 3.6.2. Its prior
override is at `/opt/shm/backups/pre-admin-3.6.2-20261013/`; the client UI
remains on its existing pinned image because ShpunApp is the customer cabinet.
For an admin-only rollback, restore that prior override and recreate `admin`
alone; the old admin image remains stored locally.
An image-only rollback uses the saved override and recreates `api`, `core` and
`spool`; restart `admin` and `client` afterward because their Nginx upstream
addresses are resolved at startup. Do not restore the pre-upgrade database
automatically after customer writes: that would discard valid transactions.

The same pinned core image also applies
`patch_telegram_webapp_registration.pl` to SHM's Telegram WebApp route. A
valid signed Mini App `initData` can then create a native Telegram account on
first launch (`register_if_not_exists=1`); an existing identity logs into its
original account. Invalid signatures fail before lookup or creation. Unlike
bot `/start`, a Mini App launch does not prove a private chat exists, so chat
membership is recorded only when `/start` later arrives. This change requires
an image rebuild and a new-user canary before production rollout.

This is a deliberately narrow replacement for `Core::Cloud::Currency`. It keeps
the SHM conversion interface but reads rates from the local SHM database, with
no request to `cloud.myshm.ru`. The source is the official Bank of Russia daily
RUB quotation. SHM's accounting currency must remain RUB. Changing the ledger
currency requires a separate accounting migration; this adapter does not do it.

`sync_cbr_rates.py` validates the XML, normalizes each rate for one currency
unit, and atomically writes the current set to `config.shpun_fx` and an audit
record to `shpun_fx_history`. The same day's unchanged rate set is deduplicated
in history, but `fetched_at_epoch` is refreshed on every successful fetch.
Manual rate changes through the SHM admin endpoint are audited as `manual` and
are replaced by the next successful official refresh. Markups or provider fees
must be kept separately from the reference rate.

The adapter rejects malformed rates, rates not fetched for 48 hours, and rates
whose official effective date is older than seven days. Cross-currency
conversion then returns no value rather than silently charging at stale rates.
The caller must show an unavailable-price error and must not accept payment
until a fresh quote is available. RUB-only billing is unaffected.

For a production cutover, the pinned custom core image must be used by *all*
core and spool containers. Apply `schema.sql` before starting them. Install the
sync script at `/opt/shm/local-fx/sync_cbr_rates.py`, and install the unit files
as `/etc/systemd/system/shpun-fx@.service` and `.timer`. Run a successful
one-shot sync and inspect `shpun_fx_history` before enabling
`shpun-fx@shm-mysql-1.timer`. Monitor the timer's failures and the age of
`fetched_at_epoch`; this repository does not yet provide alert delivery.
Do not install or enable the timer on the live billing server during staging.

Multicurrency presentation and settlement are separate. A future ShpunApp/bot
price quote should keep the RUB price as the billing source of truth, record the
display currency, source rate, markup, rounding and quote expiry, and calculate
the provider charge once. At payment confirmation, credit the exact RUB amount
agreed in that quote using an idempotent payment reference. Never infer RUB
credit from a later rate or treat a displayed EUR/USD amount as the SHM ledger
balance. Existing payment modules need separate currency-support tests before
any non-RUB charge is offered.

## Telegram bot email template

`migrate_telegram_bot_email_for_3x.py` transforms our exact SHM 2.x
`telegram_bot` template from stdin to stdout. It has no database access and
refuses missing/ambiguous anchors or leftover references to `login2` and the
old email settings. It uses positional Template Toolkit method arguments for
SHM 3.x `user.set_email` and `user.verify_email`. Do not point it at a changed
template or apply its output directly to production without a fresh backup,
diff review, parser check and full bot conversation test. The clone-only dry
run and installation are documented in `../CONTINUITY.md`.
