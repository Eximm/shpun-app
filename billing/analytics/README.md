# Local billing analytics, first read-only report

`report.sql` calculates operational totals directly from the local SHM 3.5.0
database; it does not call SHM Cloud or alter the upstream paid analytics
endpoint. It uses only aggregate data and can run under a MySQL account with
`SELECT` access to `users`, `user_services`, `pays_history`, `withdraw_history`,
and `config`. The `SET @since` statement only sets a session variable.

The report intentionally separates external top-ups, manual credits, negative
payment entries, and paid service withdrawals. They are not interchangeable:
top-ups are money added to balances, while service withdrawals describe use of
those balances. Neither number alone is a formal profit-and-loss statement.

This is a tested data foundation, not yet an administrator dashboard or a
replacement for every SHM analytics graph. Before production exposure: create
a dedicated read-only account, verify the chosen KPIs with the owner, add
access controls and cache to the ShpunApp admin API, and reconcile monthly
totals against the billing UI and payment-provider statements.
