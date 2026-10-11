-- SHM 3.5.0 standalone, read-only operational report.
-- Run with a SELECT-only MySQL account against a database clone first.
-- Money is in the SHM ledger currency (currently RUB). Top-ups are cash inflow,
-- not earned revenue; paid service withdrawals are shown separately.

SET @since := DATE_SUB(NOW(), INTERVAL 30 DAY);

SELECT 'users_total' AS metric, COUNT(*) AS value FROM users;
SELECT 'registrations_30d' AS metric, COUNT(*) AS value
FROM users WHERE created >= @since;
SELECT 'active_customers' AS metric, COUNT(DISTINCT user_id) AS value
FROM user_services WHERE status = 'ACTIVE';
SELECT 'active_services' AS metric, COUNT(*) AS value
FROM user_services WHERE status = 'ACTIVE';

SELECT 'external_topups_30d' AS metric,
       COUNT(*) AS events, COALESCE(SUM(money), 0) AS rub_total
FROM pays_history
WHERE date >= @since AND money > 0 AND pay_system_id IS NOT NULL
  AND pay_system_id != 'manual';

SELECT 'manual_credits_30d' AS metric,
       COUNT(*) AS events, COALESCE(SUM(money), 0) AS rub_total
FROM pays_history
WHERE date >= @since AND money > 0 AND pay_system_id = 'manual';

SELECT 'negative_payment_entries_30d' AS metric,
       COUNT(*) AS events, COALESCE(SUM(money), 0) AS rub_total
FROM pays_history WHERE date >= @since AND money < 0;

SELECT 'paid_service_withdrawals_30d' AS metric,
       COUNT(*) AS events,
       COALESCE(SUM(total), 0) AS gross_rub,
       COALESCE(SUM(bonus), 0) AS bonuses_rub,
       COALESCE(SUM(GREATEST(total - bonus, 0)), 0) AS paid_rub
FROM withdraw_history
WHERE withdraw_date >= @since AND withdraw_date IS NOT NULL;

SELECT pay_system_id, COUNT(*) AS events, ROUND(SUM(money), 2) AS rub_total
FROM pays_history
WHERE date >= @since AND money > 0 AND pay_system_id IS NOT NULL
  AND pay_system_id != 'manual'
GROUP BY pay_system_id ORDER BY rub_total DESC;

SELECT DATE(date) AS day, COUNT(*) AS topups,
       ROUND(SUM(money), 2) AS rub_total
FROM pays_history
WHERE date >= @since AND money > 0 AND pay_system_id IS NOT NULL
  AND pay_system_id != 'manual'
GROUP BY DATE(date) ORDER BY day DESC;

SELECT DATE(withdraw_date) AS day, COUNT(*) AS service_withdrawals,
       ROUND(SUM(GREATEST(total - bonus, 0)), 2) AS paid_rub
FROM withdraw_history
WHERE withdraw_date >= @since AND withdraw_date IS NOT NULL
GROUP BY DATE(withdraw_date) ORDER BY day DESC;

SELECT JSON_UNQUOTE(JSON_EXTRACT(value, '$.source')) AS fx_source,
       JSON_UNQUOTE(JSON_EXTRACT(value, '$.effective_date')) AS fx_effective_date,
       FROM_UNIXTIME(JSON_EXTRACT(value, '$.fetched_at_epoch')) AS fx_fetched_at
FROM config WHERE `key` = 'shpun_fx';
