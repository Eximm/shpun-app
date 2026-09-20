# Реферальные и рекламные ссылки

## Назначение

ShpunApp поддерживает два независимых типа ссылок:

- `partner` — привязывает нового пользователя к партнёру SHM и может
  инициализировать бонус первого платежа;
- `campaign` — не создаёт партнёрскую связь, а записывает заданный рекламный
  комментарий в карточку нового пользователя.

Оба типа работают в веб-регистрации и в Telegram-боте. Alias всегда
перепроверяется сервером по `referral_aliases`; браузер и бот не являются
источником доверенных `partner_id`, процентов или текста комментария.

## Ссылки

Веб:

```text
https://app.shpun.net/?<alias>
https://app.shpun.net/?ref=<alias>
https://app.shpun.net/?partner_id=<SHM user id>
```

Telegram:

```text
https://t.me/<bot>?start=<base64url(referral_alias=...&partner_id=...)>
```

Для alias типа `campaign` канонический `partner_id` всегда равен нулю. Для
`partner` сервер берёт ID только из своей записи alias. Если alias и числовой
ID конфликтуют, приоритет имеет alias.

## Поток регистрации

1. Клиент сохраняет alias/partner ID до завершения регистрации.
2. ShpunApp повторно разрешает alias на сервере.
3. SHM создаёт пользователя с каноническим `partner_id` либо без партнёра.
4. После успешной регистрации ShpunApp вызывает:
   - `referrals.claim` для партнёрской ссылки;
   - `campaign.claim` для рекламной кампании.
5. Billing-шаблон подтверждает результат и не перезаписывает уже заполненный
   комментарий.
6. ShpunApp записывает пару `alias_id + shm_user_id` в
   `referral_alias_registrations`. Уникальное ограничение не позволяет
   повторному входу увеличить счётчик второй раз.

Вход существующего пользователя не считается регистрацией и не меняет
атрибуцию.

## Канонический комментарий

- `partner`: `campaign_code`, а если он пуст — alias;
- `campaign`: `billing_comment`.

Правило вычисляется в ShpunApp и одинаково передаётся веб-потоком и
Telegram-потоком.

## Production-компоненты

- API ShpunApp: публичный resolver и внутренние Telegram resolve/claim routes;
- SQLite `linkdb.sqlite`: alias, переходы и дедуплицированные регистрации;
- активный SHM-шаблон `shpun_app_v22_campaign_links`;
- активный SHM-шаблон `telegram_bot`;
- общий `SHM_REFERRAL_SECRET` и `referral_secret` шаблона.

Внутренние Telegram endpoints доступны только из приватной сети контейнеров и
при ожидаемом Host. Секреты, session ID и пароли в referral-логирование не
попадают.

## Проверка перед выпуском

- API: `npm test`;
- web: `npm run check:all` и `npm run build`;
- сравнить Git SHA локально, в `origin/main` и в `/opt/shpun-app/src`;
- сравнить скомпилированные изменённые API-файлы с запущенным контейнером;
- убедиться, что активный `telegram_bot` совпадает с локальным шаблоном;
- проверить агрегаты `referral_alias_registrations` без создания тестового
  production-пользователя;
- после реальной регистрации проверить одновременно SHM `partner_id/comment`
  и локальную дедуплицированную запись.
