export type Lang = 'ru' | 'en'
export type Dict = Record<string, string>

export const RU: Dict = {
  // app shell
  'app.beta': 'Бета',

  // login page
  'login.title': 'Вход в Shpun App',
  'login.badge.web': 'Веб-режим',
  'login.badge.tg': 'Telegram WebApp',

  'login.desc.tg':
    'Безопасный вход через Telegram. Если вы заходите впервые — предложим установить пароль для резервного доступа.',
  'login.desc.web':
    'Рекомендуем открыть Shpun внутри Telegram — это самый быстрый способ входа. Если пароль уже установлен — можно войти через него.',

  'login.what.title': 'Что внутри Shpun App',
  'login.what.1': '⚡ Баланс и активные услуги — всегда под рукой',
  'login.what.2': '🔔 Уведомления (скоро): платежи, продления, напоминания',
  'login.what.3': '🧾 История оплат и квитанции',
  'login.what.4': '🧩 Управление роутерами и VPN',

  'login.cta.open_tg': 'Открыть в Telegram',
  'login.cta.refresh': 'Обновить',

  'login.why.title': 'Почему Telegram?',
  'login.why.text':
    'Вход без регистрации: Telegram подписывает запрос, сервер проверяет подпись и создаёт защищённую сессию.',

  'login.divider.providers': 'или другой способ',
  'login.providers.telegram.hint.web': 'Доступно в Telegram',
  'login.providers.telegram.hint.tg': 'Быстрый вход в WebApp',
  'login.providers.google.hint': 'Скоро',
  'login.providers.yandex.hint': 'Скоро',

  'login.divider.password': 'если уже установлен пароль',
  'login.password.summary': 'Войти по логину и паролю',
  'login.password.login': 'Логин',
  'login.password.password': 'Пароль',
  'login.password.login_ph': 'например @123456789',
  'login.password.password_ph': '••••••••',
  'login.password.submit': 'Войти',
  'login.password.submit_loading': 'Входим…',
  'login.password.forgot': 'Забыли пароль',
  'login.password.tip':
    'Пароль — резервный способ входа. Основной вход осуществляется через Telegram.',

  'login.tg.cta': 'Продолжить через Telegram',
  'login.tg.cta_loading': 'Входим…',
  'login.tg.reload': 'Обновить',
  'login.tg.secure.title': 'Безопасный вход:',
  'login.tg.secure.text':
    'Telegram подписывает данные, сервер проверяет их и создаёт защищённую сессию.',

  'login.backup.divider': 'резервный доступ',
  'login.backup.summary': 'Войти по паролю (резерв)',

  'error.open_in_tg': 'Откройте это приложение внутри Telegram, чтобы войти.',
  'error.password_login_failed': 'Не удалось войти по паролю',
  'error.telegram_login_failed': 'Не удалось войти через Telegram',

  // profile
  'profile.title': 'Профиль',
  'profile.subtitle': 'Аккаунт и настройки SDN System.',
  'profile.refresh': '⟳ Обновить',

  'profile.user': 'Пользователь',
  'profile.login': 'Логин',
  'profile.id': 'ID',
  'profile.balance': 'Баланс',
  'profile.bonus': 'Бонусы',
  'profile.discount': 'Скидка',
  'profile.created': 'Создан',
  'profile.last_login': 'Последний вход',

  'profile.copy': 'Копировать',
  'profile.copied': '✓ Скопировано',

  'profile.open_payment': 'Открыть оплату',
  'profile.change_password': 'Сменить пароль',
  'profile.logout': 'Выйти',

  'profile.payment_stub': 'Оплата будет подключена после интеграции. Сейчас это заглушка.',
  'profile.payment_stub_hint':
    'Заглушка: позже зададим VITE_PAYMENT_URL и кнопка “Открыть оплату” поведёт в miniapp/биллинг.',

  'profile.settings.title': 'Настройки',
  'profile.settings.subtitle': 'Скоро: уведомления и язык интерфейса.',
  'profile.settings.notifications_soon': '🔔 Уведомления: скоро',

  'profile.lang.title': 'Язык интерфейса',
  'profile.lang.ru': 'Русский',
  'profile.lang.en': 'English',

  'profile.auth.title': 'Авторизация',
  'profile.auth.subtitle':
    'Сейчас вход через Telegram и/или пароль. Позже добавим привязку OAuth (Google/Yandex).',
  'profile.auth.telegram': 'Telegram',
  'profile.auth.telegram.on': 'Подключено',
  'profile.auth.email': 'Email',
  'profile.auth.soon': 'Скоро',
  'profile.auth.oauth': 'OAuth',
  'profile.auth.oauth_hint': 'Google / Yandex — как связанные методы.',

  'profile.debug.title': 'Данные (beta)',
  'profile.debug.subtitle':
    'Это данные из биллинга. Raw оставляем для диагностики (позже уберём).',
}

export const EN: Dict = {
  'app.beta': 'Beta',

  'login.title': 'Sign in to Shpun App',
  'login.badge.web': 'Web mode',
  'login.badge.tg': 'Telegram WebApp',

  'login.desc.tg':
    'Secure sign-in via Telegram. If it’s your first time — we’ll ask you to set a password for backup access.',
  'login.desc.web':
    'Recommended: open Shpun inside Telegram for 1-tap login. Password works if you already created it.',

  'login.what.title': 'What you get in Shpun App',
  'login.what.1': '⚡ Balance & active services — always at hand',
  'login.what.2': '🔔 Notifications (soon): payments, expirations, reminders',
  'login.what.3': '🧾 Payments history & receipts',
  'login.what.4': '🧩 Routers & VPN — simplified flow',

  'login.cta.open_tg': 'Open in Telegram',
  'login.cta.refresh': 'Refresh',

  'login.why.title': 'Why Telegram?',
  'login.why.text':
    'No registration forms: Telegram signs the request, server verifies it and creates a secure session.',

  'login.divider.providers': 'or continue with',
  'login.providers.telegram.hint.web': 'Available in Telegram',
  'login.providers.telegram.hint.tg': 'Fast login in WebApp',
  'login.providers.google.hint': 'Coming soon',
  'login.providers.yandex.hint': 'Coming soon',

  'login.divider.password': 'already set a password?',
  'login.password.summary': 'Sign in with password',
  'login.password.login': 'Login',
  'login.password.password': 'Password',
  'login.password.login_ph': 'e.g. @123456789',
  'login.password.password_ph': '••••••••',
  'login.password.submit': 'Sign in',
  'login.password.submit_loading': 'Signing in…',
  'login.password.forgot': 'Forgot password',
  'login.password.tip': 'Password login is a backup method. Main sign-in is via Telegram.',

  'login.tg.cta': 'Continue with Telegram',
  'login.tg.cta_loading': 'Signing in…',
  'login.tg.reload': 'Reload',
  'login.tg.secure.title': 'Secure login:',
  'login.tg.secure.text':
    'Telegram signs the request, server verifies it and creates a session.',

  'login.backup.divider': 'backup access',
  'login.backup.summary': 'Sign in with password (backup)',

  'error.open_in_tg': 'Open this app inside Telegram to sign in.',
  'error.password_login_failed': 'Password login failed',
  'error.telegram_login_failed': 'Telegram login failed',

  // profile
  'profile.title': 'Profile',
  'profile.subtitle': 'Account & SDN System settings.',
  'profile.refresh': '⟳ Refresh',

  'profile.user': 'User',
  'profile.login': 'Login',
  'profile.id': 'ID',
  'profile.balance': 'Balance',
  'profile.bonus': 'Bonus',
  'profile.discount': 'Discount',
  'profile.created': 'Created',
  'profile.last_login': 'Last login',

  'profile.copy': 'Copy',
  'profile.copied': '✓ Copied',

  'profile.open_payment': 'Open payments',
  'profile.change_password': 'Change password',
  'profile.logout': 'Logout',

  'profile.payment_stub': 'Payments will be enabled after integration. This is a stub for now.',
  'profile.payment_stub_hint':
    'Stub: later we will set VITE_PAYMENT_URL and “Open payments” will lead to billing/miniapp.',

  'profile.settings.title': 'Settings',
  'profile.settings.subtitle': 'Soon: notifications and interface language.',
  'profile.settings.notifications_soon': '🔔 Notifications: soon',

  'profile.lang.title': 'Interface language',
  'profile.lang.ru': 'Русский',
  'profile.lang.en': 'English',

  'profile.auth.title': 'Authentication',
  'profile.auth.subtitle':
    'Currently Telegram and/or password. OAuth linking (Google/Yandex) is coming later.',
  'profile.auth.telegram': 'Telegram',
  'profile.auth.telegram.on': 'Connected',
  'profile.auth.email': 'Email',
  'profile.auth.soon': 'Soon',
  'profile.auth.oauth': 'OAuth',
  'profile.auth.oauth_hint': 'Google / Yandex as linked methods.',

  'profile.debug.title': 'Data (beta)',
  'profile.debug.subtitle':
    'This comes from billing. Keeping raw for diagnostics (we will remove it later).',
}
