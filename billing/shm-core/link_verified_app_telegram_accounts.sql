-- SHM 3.x stage rehearsal only. Re-run preflight on a fresh clone before cutover.
-- Link only Telegram IDs already recorded by ShpunApp for the same legacy
-- @numeric login. Do not infer ownership for the remaining unlinked accounts.
START TRANSACTION;

INSERT INTO accounts (login, type, user_id, settings)
SELECT SUBSTRING(u.login, 2), 'telegram', u.user_id, JSON_OBJECT()
FROM users AS u
WHERE u.login REGEXP '^@[0-9]+$'
  AND JSON_UNQUOTE(JSON_EXTRACT(u.settings, '$.ShpynApp.auth.telegram_id')) = SUBSTRING(u.login, 2)
  AND NOT EXISTS (
    SELECT 1 FROM accounts AS a
    WHERE a.login = SUBSTRING(u.login, 2) AND a.type = 'telegram'
  );

SELECT ROW_COUNT() AS newly_linked_telegram_accounts;
COMMIT;
