#!/usr/bin/env python3
"""Transform the local telegram_bot template's email flow for SHM 3.x.

Reads the exact 2.x template on stdin and writes the transformed template on
stdout. It does not connect to a database or send mail. Refuses unexpected
template shapes so it cannot silently patch a changed upstream/local version.
"""

import sys


def replace_once(source: str, old: str, new: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"expected one anchor, found {count}: {old[:80]!r}")
    return source.replace(old, new, 1)


def replace_region(source: str, begin: str, end: str, new_region: str) -> str:
    if source.count(begin) != 1 or source.count(end) != 1:
        raise ValueError(f"ambiguous region: {begin[:60]!r} .. {end[:60]!r}")
    start = source.index(begin)
    finish = source.index(end, start)
    return source[:start] + new_region + source[finish:]


def resend_case(label: str) -> str:
    return r'''[% CASE ['__LABEL__'] %]
{{
    backToOrder = (args.0 && args.0.match('^[0-9]+$')) ? args.0 : (user.settings.bot.emailBackToOrder || '');
    emailValue = user.email || user.settings.bot.emailDraft;
    IF !misc.is_email(emailValue) || isUnsupportedEmail(value=emailValue) == 1;
        ret = user.set_settings({'state' => 'awaiting_email'});
        TEXT = "📧 <b>Почта не найдена</b>\\n\\nПришлите email ещё раз.";
        notification(TEXT=TEXT, force=1, placeholder='Введите email');
        STOP;
    END;
    IF user.email && user.email == emailValue;
        ret = user.set_settings({'state' => ''});
        TEXT = "✅ <b>Почта уже подтверждена</b>";
        notification(TEXT=TEXT);
        STOP;
    END;
    sendResult = user.verify_email('email', emailValue);
    IF sendResult.msg != 'Verification code sent';
        ret = user.set_settings({'state' => 'awaiting_email'});
        TEXT = "⚠️ <b>Код не отправлен</b>\\n\\nПроверьте адрес или укажите другой.";
        notification(TEXT=TEXT, force=1, placeholder='Введите email');
        STOP;
    END;
    ret = user.set_settings({'state' => 'awaiting_email_code'});
    ret = user.set_settings({'bot' => {'emailDraft' => emailValue, 'emailBackToOrder' => backToOrder} });
}}
{{ TEXT = BLOCK }}
📨 <b>Код отправлен</b>

Код отправлен на <code>{{ emailValue }}</code>.
Пришлите его сюда одним сообщением.
{{ END }}
{{ BUTTONS = BLOCK }}
    [{ "text": "🔁 Отправить новый код", "style": "primary", "callback_data": "email:resend:force {{ backToOrder }}" }],
    [{ "text": "✏️ Сменить почту", "callback_data": "email:change" }],
    [{ "text": "👤 Открыть личный кабинет", "callback_data": "user:cabinet" }]
{{ END }}
{{ stateNotification(TEXT=TEXT, BUTTONS=BUTTONS) }}
{{ STOP }}

'''.replace('__LABEL__', label)


SAVE_CASE = r'''[% CASE ['email:save:confirm'] %]
{{
    emailDraft = user.settings.bot.emailDraft || '';
    backToOrder = user.settings.bot.emailBackToOrder || '';
    IF !misc.is_email(emailDraft) || isUnsupportedEmail(value=emailDraft) == 1;
        ret = user.set_settings({'state' => 'awaiting_email'});
        TEXT = "📧 <b>Неверная почта</b>\n\nПришлите email ещё раз.";
        notification(TEXT=TEXT, force=1, placeholder='Введите email');
        STOP;
    END;
    IF user.email;
        TEXT = "✅ <b>Почта уже подтверждена</b>\n\nЕсли нужен другой адрес, напишите в поддержку.";
        notification(TEXT=TEXT);
        STOP;
    END;
    addResult = user.set_email('email', emailDraft);
    IF addResult.msg != 'Successful' && addResult.msg != 'already in use';
        ret = user.set_settings({'state' => 'awaiting_email'});
        TEXT = "⚠️ <b>Не удалось добавить почту</b>\n\nПроверьте адрес и попробуйте снова.";
        notification(TEXT=TEXT, force=1, placeholder='Введите email');
        STOP;
    END;
    sendResult = user.verify_email('email', emailDraft);
    IF sendResult.msg != 'Verification code sent';
        ret = user.set_settings({'state' => 'awaiting_email'});
        TEXT = "⚠️ <b>Почта занята или код не отправлен</b>\n\nУкажите другой адрес.";
        notification(TEXT=TEXT, force=1, placeholder='Введите email');
        STOP;
    END;
    ret = user.set_settings({'state' => 'awaiting_email_code'});
    ret = user.set_settings({'bot' => {'emailDraft' => emailDraft, 'emailBackToOrder' => backToOrder} });
}}
{{ TEXT = BLOCK }}
📨 <b>Код отправлен</b>

<code>{{ emailDraft }}</code>

Введите код из письма сюда.
{{ END }}
{{ BUTTONS = BLOCK }}
    [{ "text": "🔁 Отправить новый код", "style": "primary", "callback_data": "email:resend:force {{ backToOrder }}" }],
    [{ "text": "✏️ Сменить почту", "callback_data": "email:change" }],
    [{ "text": "👤 Открыть личный кабинет", "callback_data": "user:cabinet" }]
{{ END }}
{{ stateNotification(TEXT=TEXT, BUTTONS=BUTTONS) }}
{{ STOP }}

'''


CODE_STATE = r'''{{ ELSIF user.settings.state == 'awaiting_email_code' }}
    {{
        codeInput = message.text _ '';
        codeInput = codeInput.replace('^\\s+', '').replace('\\s+$', '');
        codeInput = codeInput.replace('[\\s\\-]+', '');
        verifyEmail = user.settings.bot.emailDraft || user.email;
        backToOrder = user.settings.bot.emailBackToOrder || '';
        temp = message.message_id - 1;
        delete(msgID=[message.message_id, temp]);

        IF !misc.is_email(verifyEmail) || isUnsupportedEmail(value=verifyEmail) == 1;
            ret = user.set_settings({'state' => 'awaiting_email'});
            TEXT = "📧 <b>Неверная почта</b>\n\nПришлите email ещё раз.";
            notification(TEXT=TEXT, force=1, placeholder='Введите email');
            STOP;
        END;
        IF !codeInput.match('^[0-9]{6}$');
            TEXT = "🔢 <b>Неверный формат кода</b>\n\nПришлите шесть цифр из письма.";
            notification(TEXT=TEXT, force=1, placeholder='Введите код из письма');
            STOP;
        END;
        verifyResult = user.verify_email('email', verifyEmail, 'code', codeInput);
        emailConfirmOk = verifyResult.msg == 'Email verified successfully' ? 1 : 0;
        IF emailConfirmOk == 1;
            ret = user.set_settings({'state' => ''});
            ret = user.set_settings({'bot' => {'emailBackToOrder' => '', 'emailDraft' => ''} });
        END;
    }}
    {{ IF emailConfirmOk == 1 }}
        {{ TEXT = BLOCK }}
✅ <b>Почта подтверждена</b>

<code>{{ verifyEmail }}</code>

Готово.
        {{ END }}
        {{ BUTTONS = BLOCK }}
            [{ "text": "🛒 Продолжить заказ", "style": "success", "callback_data": "{{ backToOrder ? 'order ' _ backToOrder : 'price' }}" }],
            [{ "text": "👤 Открыть личный кабинет", "callback_data": "user:cabinet" }]
        {{ END }}
    {{ ELSE }}
        {{ TEXT = BLOCK }}
🔢 <b>Код не подошёл или истёк</b>

Проверьте письмо или запросите новый код.
        {{ END }}
        {{ BUTTONS = BLOCK }}
            [{ "text": "🔁 Отправить новый код", "style": "primary", "callback_data": "email:resend:force {{ backToOrder }}" }],
            [{ "text": "👤 Открыть личный кабинет", "callback_data": "user:cabinet" }]
        {{ END }}
    {{ END }}
    {{ stateNotification(TEXT=TEXT, BUTTONS=BUTTONS) }}
    {{ STOP }}

'''


def transform(source: str) -> str:
    newline = "\r\n" if "\r\n" in source else "\n"
    source = source.replace("\r\n", "\n")
    source = replace_region(
        source, "[% CASE ['email:resend'] %]", "[% CASE ['email:resend:force'] %]",
        resend_case("email:resend"),
    )
    source = replace_region(
        source, "[% CASE ['email:resend:force'] %]", "[% CASE ['email:save:confirm'] %]",
        resend_case("email:resend:force"),
    )
    source = replace_region(
        source, "[% CASE ['email:save:confirm'] %]", "[%#\n   Мои ключи",
        SAVE_CASE,
    )
    source = replace_region(
        source, "{{ ELSIF user.settings.state == 'awaiting_email_code' }}",
        "{{ ELSIF user.settings.state == 'awaiting_search' }}",
        CODE_STATE,
    )

    old_email = "user.settings.email || user.email || user.settings.bot.emailDraft"
    source = source.replace(old_email, "user.email || user.settings.bot.emailDraft")
    source = source.replace("user.settings.email || user.email", "user.email")
    source = source.replace("emailVerified = user.settings.email_verified;", "emailVerified = user.email ? 1 : 0;")
    source = source.replace("emailCode = user.settings.email_verify_code || '';", "emailCode = user.settings.state == 'awaiting_email_code' ? 1 : 0;")
    source = source.replace("ret = user.set_settings({'email_verify_code' => ''});", "")
    source = source.replace("appLogin = user.get_login2 || user.login2 || '';", "appLogin = user.email || user.login || '';")

    for obsolete in ("login2", "settings.email_verified", "email_verify_code", "user.settings.email"):
        if obsolete in source:
            raise ValueError(f"obsolete email auth reference remains: {obsolete}")
    for required in ("user.set_email('email', emailDraft)",
                     "user.verify_email('email', verifyEmail, 'code', codeInput)"):
        if required not in source:
            raise ValueError(f"required native email action missing: {required}")
    return source.replace("\n", newline)


if __name__ == "__main__":
    result = transform(sys.stdin.read())
    sys.stdout.write(result)
