-- SHM 3.x stage rehearsal only. Re-run preflight on a fresh clone before cutover.
-- Link only Telegram IDs independently recorded by ShpunApp or the legacy
-- Telegram transport for the same @numeric login. Never link by login shape
-- alone; check conflicts and counts again on the final fresh clone.
-- The 2.19.10 transport records chat_id only from a private chat.
START TRANSACTION;

INSERT INTO accounts (login, type, user_id, settings)
SELECT SUBSTRING(u.login, 2), 'telegram', u.user_id, JSON_OBJECT()
FROM users AS u
WHERE u.login REGEXP '^@[0-9]+$'
  AND (
    JSON_UNQUOTE(JSON_EXTRACT(u.settings, '$.ShpynApp.auth.telegram_id')) = SUBSTRING(u.login, 2)
    OR JSON_UNQUOTE(JSON_EXTRACT(u.settings, '$.telegram.chat_id')) = SUBSTRING(u.login, 2)
  )
  AND NOT EXISTS (
    SELECT 1 FROM accounts AS a
    WHERE a.login = SUBSTRING(u.login, 2) AND a.type = 'telegram'
  );

SELECT ROW_COUNT() AS newly_linked_telegram_accounts;
COMMIT;
