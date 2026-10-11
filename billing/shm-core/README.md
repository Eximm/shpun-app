# Local FX adapter for SHM 3.5.0

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
