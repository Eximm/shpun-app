# Именные реферальные кампании

## Что делает приложение

- Администратор создаёт соответствие `alias -> partner_id`, например `druni4 -> 123`.
- Ссылка `https://app.shpun.net/?druni4` (также поддерживается `?ref=druni4`) до регистрации разрешается через API в цифровой `partner_id`.
- Дальше работает существующая регистрация: приложение сохраняет ID до окончания OAuth/Telegram/password flow, SHM получает обычный `partner_id`.
- Коммерческие параметры кампании (`campaign_code`, бонус первого платежа и ставка партнёра) хранятся рядом с алиасом для администрирования. Они не выдаются публичным resolver API.
- В карточке кампании считаются переходы по ссылке и успешные вызовы закрепления после регистрации.

## Почему бонус первого платежа не является обычным промокодом

Промокод SHM выполняет привязанный шаблон в момент `promo.apply`. Требование кампании другое: бонус должен рассчитываться от суммы будущего первого успешного платежа. Поэтому промокод можно использовать как механизм постановки одноразового флага, но начисление должно происходить в обработчике успешного платежа.

Рекомендуемый флаг в `user.settings`:

```text
first_pay_campaign = 20firstpay
first_pay_bonus_percent = 20
first_pay_bonus_done = 0
```

Флаг следует ставить серверным шаблоном одновременно с закреплением `partner_id`, а не принимать произвольный `campaign_code` от браузера.

## Контракт для биллинга

Расширить действие `referrals.claim` шаблона `shpun_app`:

1. Закрепить `partner_id` существующим способом.
2. Принять от API доверенные параметры `first_pay`, `first_pay_campaign` и `partner_income_percent`.
3. Если `first_pay > 0` и у пользователя ещё нет успешных платежей, записать процент и флаг кампании в `user.settings`.
4. Повторный вызов для того же пользователя не должен менять уже закреплённого партнёра.

### Изменение `shpun_app`

В текущем `shpun_app_v9_6_public_register` действие `referrals.claim` читает
только `partner_id`. При этом регистрация уже может установить партнёра, поэтому
ранний ответ `already_set` нельзя оставлять в прежнем виде. Логика должна быть
такой:

1. Если установлен другой партнёр — ничего не менять.
2. Если партнёр ещё не установлен — закрепить его.
3. Если уже установлен тот же партнёр — не менять связь, но разрешить
   однократную инициализацию настроек кампании.
4. Бонусные параметры принимать только при совпадении служебного секрета.

В настройках шаблона задайте `referral_secret`; такое же значение задайте API
в `SHM_REFERRAL_SECRET`.

Вместо существующего блока от `current_partner_id` до итогового `RETURN`
используйте следующую схему:

```tt2
{{ current_partner_id = u.partner_id || 0 }}
{{ current_partner_id = current_partner_id + 0 }}

{{ IF current_partner_id > 0 AND current_partner_id != partner_id }}
  {{ toJson({
    ok = 1,
    ver = ver,
    action = action,
    claimed = 0,
    reason = "already_set_other",
    partner_id = current_partner_id
  }) }}
  {{ RETURN }}
{{ END }}

{{ claimed = 0 }}
{{ partner_ret = "" }}
{{ IF current_partner_id <= 0 }}
  {{ partner_ret = u.set_partner_id(partner_id) }}
  {{ claimed = 1 }}
{{ END }}

{{ first_pay = request.params.first_pay || 0 }}
{{ first_pay = first_pay + 0 }}
{{ first_pay_campaign = request.params.first_pay_campaign || "" }}
{{ referral_alias = request.params.referral_alias || "" }}
{{ supplied_secret = request.params.referral_secret || "" }}
{{ expected_secret = tpl.settings.referral_secret || "" }}

{{ IF first_pay < 0 }} {{ first_pay = 0 }} {{ END }}
{{ IF first_pay > 100 }} {{ first_pay = 100 }} {{ END }}

{{ IF NOT s.ShpynApp.referral }} {{ s.ShpynApp.referral = {} }} {{ END }}

{{ settings_ret = "" }}
{{ campaign_initialized = 0 }}
{{ IF expected_secret != ""
      AND supplied_secret == expected_secret
      AND s.ShpynApp.referral.initialized != 1 }}
  {{ s.ShpynApp.referral.initialized = 1 }}
  {{ s.ShpynApp.referral.partner_id = partner_id }}
  {{ s.ShpynApp.referral.alias = referral_alias }}
  {{ s.ShpynApp.referral.first_pay_percent = first_pay }}
  {{ s.ShpynApp.referral.first_pay_campaign = first_pay_campaign }}
  {{ s.ShpynApp.referral.first_pay_pending = first_pay > 0 ? 1 : 0 }}
  {{ s.ShpynApp.referral.first_pay_applied = 0 }}
  {{ s.ShpynApp.referral.first_pay_pay_id = 0 }}
  {{ s.ShpynApp.rev = s.ShpynApp.rev + 1 }}
  {{ settings_ret = u.set_settings(s) }}
  {{ campaign_initialized = 1 }}
{{ END }}

{{ toJson({
  ok = 1,
  ver = ver,
  action = action,
  claimed = claimed,
  partner_id = partner_id,
  campaign_initialized = campaign_initialized,
  set_partner_ret = partner_ret,
  set_settings_ret = settings_ret
}) }}
{{ RETURN }}
```

Флаг `initialized` не позволяет повторному входу или повторному запросу
перезаписать кампанию.

Рекомендуемая итоговая структура настроек:

```json
{
  "ShpynApp": {
    "referral": {
      "partner_id": 123,
      "alias": "example",
      "first_pay_percent": 20,
      "first_pay_campaign": "20firstpay",
      "first_pay_pending": 1,
      "first_pay_applied": 0,
      "first_pay_pay_id": 0
    }
  }
}
```

Для события успешного пополнения создать отдельный шаблон:

```tt2
[% settings = user.settings %]
[% IF settings.first_pay_campaign == '20firstpay'
      && !settings.first_pay_bonus_done %]
  [% bonus = pay.money * settings.first_pay_bonus_percent / 100 %]
  [% user.add_bonus(bonus, 'Бонус 20% за первое пополнение, платёж #' _ pay.id) %]
  [% user.set_settings(
       first_pay_bonus_done = 1,
       first_pay_campaign = '',
       first_pay_bonus_percent = 0,
       first_pay_bonus_pay_id = pay.id
     ) %]
[% END %]
```

Это схема, а не готовый для вставки шаблон: перед публикацией нужно проверить фактический синтаксис текущей версии SHM и контекст вашего события `PAY`.

## Обязательные проверки

- Учитывать только успешные внешние пополнения; не начислять процент с бонусов, возвратов и ручных корректировок.
- Проверять `pay.id` и сохранять его: повторная доставка одного события не должна дать второй бонус.
- Решить, считается ли платёж на 0/минимальную сумму «первым», и при необходимости задать минимальную сумму.
- Ставку 50% задавать конкретному партнёру, а не менять глобальный `billing.partner.income_percent`: глобальная настройка изменит выплаты всем партнёрам.
- Создать блогеру обычный пользовательский аккаунт SHM. Его текущая реферальная страница уже показывает список и начисления; отдельный новый тип аккаунта для первой версии не нужен.

## Приёмочный сценарий

1. В админке создать `druni4`, указать ID тестового партнёра, `20firstpay`, 20% и 50%.
2. Открыть ссылку в чистом браузере и зарегистрировать нового пользователя.
3. Убедиться в SHM, что закреплён правильный `partner_id` и установлен одноразовый флаг.
4. Провести первый успешный платёж 100: пользователю начислено 20 бонусов, партнёру — 50 по его индивидуальной ставке.
5. Повторно доставить тот же PAY: новых начислений нет.
6. Провести второй платёж: бонус пользователю не начисляется, партнёрское начисление продолжается.
