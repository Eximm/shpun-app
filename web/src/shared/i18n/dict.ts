export type Lang = 'ru' | 'en'
export type Dict = Record<string, string>

export const RU: Dict = {
  // app shell
  'app.beta': 'Бета',

    // login (password register extras)
  'login.password.register_title': 'Регистрация по логину и паролю',
  'login.password.repeat': 'Повтор пароля',
  'login.password.repeat_ph': 'Введите пароль ещё раз',
  'login.password.mismatch': 'Пароли не совпадают.',

  'login.password.register_loading': 'Создаём аккаунт…',
  'login.password.register_submit': 'Зарегистрироваться',

  'login.password.switch_to_register': 'Создать аккаунт',
  'login.password.switch_to_login': 'Уже есть аккаунт',
  'login.password.switch_register': 'Регистрация',
  'login.password.switch_login': 'Уже есть аккаунт? Вход',

  'login.password.register_tip': 'После регистрации можно привязать Telegram внутри приложения.',

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

  // ===== Home =====
  'home.loading.title': 'Shpun',
  'home.loading.text': 'Загрузка…',

  'home.error.title': 'Shpun',
  'home.error.text': 'Ошибка загрузки профиля.',
  'home.error.retry': 'Повторить',

  'home.hello': 'Привет',
  'home.subtitle': 'SDN System — баланс, услуги и управление подпиской.',
  'home.refresh': '⟳ Обновить',

  'home.kv.balance': 'Баланс',
  'home.kv.bonus': 'Бонусы',
  'home.kv.discount': 'Скидка',

  'home.actions.payments': 'Оплата',
  'home.actions.services': 'Услуги',
  'home.actions.profile': 'Профиль',

  'home.install': 'Установить',
  'home.install.opening': 'Открываем…',

  'home.meta.password': 'Пароль',
  'home.meta.password.on': 'установлен',
  'home.meta.password.off': 'не установлен',
  'home.meta.created': 'Создан',
  'home.meta.last_login': 'Последний вход',

  'home.news.title': 'Новости',
  'home.news.subtitle': 'Коротко и по делу. Полная лента — в “Новости”.',
  'home.news.open': 'Открыть',
  'home.news.open_full': 'Открыть новости',

  'home.news.item1.title': '✅ Система стабильна — всё работает',
  'home.news.item1.sub':
    'Обновления без простоев. Если видишь “Can’t connect” — просто обнови страницу.',
  'home.news.item2.title': '🧭 Cabinet переехал в “Новости”',
  'home.news.item2.sub':
    'Главная — витрина. Новости — лента. Дальше подключим реальные данные в “Услугах”.',
  'home.news.item3.title': '🔐 Вход с рабочего стола через Telegram',
  'home.news.item3.sub':
    'Теперь это одна кнопка: откроем браузер и перенесём авторизацию автоматически.',

  'home.desktop.title': 'Открыть на компьютере',
  'home.desktop.desc':
    'Нажми кнопку — мы откроем внешний браузер и перенесём вход в Shpun App. Ничего копировать не нужно.',
  'home.desktop.open': 'Открыть приложение на компьютере',
  'home.desktop.opening': 'Открываем…',
  'home.desktop.install': 'Установить',
  'home.desktop.installing': 'Установка…',
  'home.desktop.show_link': 'Показать ссылку',
  'home.desktop.hide_link': 'Скрыть ссылку',
  'home.desktop.fallback.title': 'Резервный вариант (если авто-открытие не сработало)',
  'home.desktop.copy': 'Скопировать',
  'home.desktop.copy_ok': 'Ссылка скопирована 👍',
  'home.desktop.copy_prompt': 'Скопируй ссылку:',
  'home.desktop.hint.default': 'Код одноразовый и быстро истекает.',
  'home.desktop.hint.expired': 'Срок действия кода истёк. Нажми ещё раз.',
  'home.desktop.hint.left': 'Код одноразовый. Действует примерно {sec} сек.',
  'home.desktop.error.title': 'Не получилось',
  'home.desktop.error.tip':
    'Подсказка: transfer-login работает только если ты уже вошёл в Shpun App внутри Telegram.',
  'home.install.no_button.title': 'Установка',
  'home.install.no_button.text':
    'Если кнопки “Установить” нет — браузер не выдал запрос установки. Открой приложение в Chrome/Edge и попробуй снова.',

  // ===== SetPassword =====
  'setpwd.checking.title': 'Проверяем…',
  'setpwd.checking.text': 'Подготавливаем вход.',

  'setpwd.need_login.title': 'Нужен вход',
  'setpwd.need_login.cta': 'Перейти к входу',

  'setpwd.redirecting': 'Открываем приложение…',

  'setpwd.title': 'Установить пароль',
  'setpwd.desc':
    'Вы вошли через Telegram. Создайте пароль — так вы сможете входить и вне Telegram.',
  'setpwd.badge': 'Шаг 1 / 1',

  'setpwd.kv.login': 'Ваш логин',
  'setpwd.kv.why': 'Зачем',
  'setpwd.kv.why_value': 'Резервный вход',
  'setpwd.kv.next': 'Дальше',
  'setpwd.kv.next_value': 'Главная',

  'setpwd.field.p1': 'Новый пароль',
  'setpwd.field.p1_ph': 'Минимум 8 символов',
  'setpwd.field.p2': 'Повторите пароль',
  'setpwd.field.p2_ph': 'Повторите пароль',

  'setpwd.strength': 'Надёжность',
  'setpwd.tip': 'Совет: 8+ символов, цифры и спецсимволы.',

  'setpwd.save': 'Сохранить пароль',
  'setpwd.saving': 'Сохраняю…',
  'setpwd.to_home': 'На главную',

  'setpwd.err.title': 'Ошибка',

  // promo (Home stub)
  'promo.title': 'Промокоды',
  'promo.desc': 'Есть промокод? Введи его здесь — бонусы или скидка применятся к аккаунту.',
  'promo.input_ph': 'Например: SHPUN-2026',
  'promo.apply': 'Применить',
  'promo.applying': 'Применяем…',
  'promo.err.empty': 'Введите промокод.',
  'promo.done.stub': 'Промокоды скоро будут доступны прямо в приложении ✨',
  'promo.history': 'История / статус',
}

export const EN: Dict = {

    // login (password register extras)
  'login.password.register_title': 'Sign up with login & password',
  'login.password.repeat': 'Repeat password',
  'login.password.repeat_ph': 'Type your password again',
  'login.password.mismatch': 'Passwords do not match.',

  'login.password.register_loading': 'Creating account…',
  'login.password.register_submit': 'Sign up',

  'login.password.switch_to_register': 'Create account',
  'login.password.switch_to_login': 'Already have an account',
  'login.password.switch_register': 'Sign up',
  'login.password.switch_login': 'Already have an account? Sign in',

  'login.password.register_tip': 'After sign-up you can link Telegram inside the app.',

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

  // ===== Home =====
  'home.loading.title': 'Shpun',
  'home.loading.text': 'Loading…',

  'home.error.title': 'Shpun',
  'home.error.text': 'Failed to load profile.',
  'home.error.retry': 'Retry',

  'home.hello': 'Hi',
  'home.subtitle': 'SDN System — balance, services and subscription management.',
  'home.refresh': '⟳ Refresh',

  'home.kv.balance': 'Balance',
  'home.kv.bonus': 'Bonus',
  'home.kv.discount': 'Discount',

  'home.actions.payments': 'Payments',
  'home.actions.services': 'Services',
  'home.actions.profile': 'Profile',

  'home.install': 'Install',
  'home.install.opening': 'Opening…',

  'home.meta.password': 'Password',
  'home.meta.password.on': 'set',
  'home.meta.password.off': 'not set',
  'home.meta.created': 'Created',
  'home.meta.last_login': 'Last login',

  'home.news.title': 'News',
  'home.news.subtitle': 'Short & useful. Full feed is in “News”.',
  'home.news.open': 'Open',
  'home.news.open_full': 'Open news',

  'home.news.item1.title': '✅ Stable — everything works',
  'home.news.item1.sub':
    'Zero-downtime updates. If you see “Can’t connect” — just refresh the page.',
  'home.news.item2.title': '🧭 Cabinet moved to “News”',
  'home.news.item2.sub':
    'Home is a vitrine. News is the feed. Next we will wire real data into “Services”.',
  'home.news.item3.title': '🔐 Desktop sign-in via Telegram',
  'home.news.item3.sub':
    'Now it’s one button: we open the browser and transfer the session automatically.',

  'home.desktop.title': 'Open on desktop',
  'home.desktop.desc':
    'Tap the button — we’ll open your browser and transfer your sign-in. No copying needed.',
  'home.desktop.open': 'Open app on desktop',
  'home.desktop.opening': 'Opening…',
  'home.desktop.install': 'Install',
  'home.desktop.installing': 'Installing…',
  'home.desktop.show_link': 'Show link',
  'home.desktop.hide_link': 'Hide link',
  'home.desktop.fallback.title': 'Fallback (if auto-open didn’t work)',
  'home.desktop.copy': 'Copy',
  'home.desktop.copy_ok': 'Link copied 👍',
  'home.desktop.copy_prompt': 'Copy this link:',
  'home.desktop.hint.default': 'This code is one-time and expires quickly.',
  'home.desktop.hint.expired': 'Expired. Tap the button again.',
  'home.desktop.hint.left': 'One-time code. About {sec} seconds left.',
  'home.desktop.error.title': 'Something went wrong',
  'home.desktop.error.tip':
    'Tip: transfer-login works only if you already signed in inside Telegram WebApp.',
  'home.install.no_button.title': 'Install',
  'home.install.no_button.text':
    'If there is no “Install” button — the browser didn’t show install prompt. Try Chrome/Edge.',

  // ===== SetPassword =====
  'setpwd.checking.title': 'Checking…',
  'setpwd.checking.text': 'Preparing your session.',

  'setpwd.need_login.title': 'Sign-in required',
  'setpwd.need_login.cta': 'Go to login',

  'setpwd.redirecting': 'Opening the app…',

  'setpwd.title': 'Set a password',
  'setpwd.desc':
    'You signed in via Telegram. Set a password to be able to sign in outside Telegram.',
  'setpwd.badge': 'Step 1 / 1',

  'setpwd.kv.login': 'Your login',
  'setpwd.kv.why': 'Why',
  'setpwd.kv.why_value': 'Backup sign-in',
  'setpwd.kv.next': 'Next',
  'setpwd.kv.next_value': 'Home',

  'setpwd.field.p1': 'New password',
  'setpwd.field.p1_ph': 'At least 8 characters',
  'setpwd.field.p2': 'Repeat password',
  'setpwd.field.p2_ph': 'Repeat password',

  'setpwd.strength': 'Strength',
  'setpwd.tip': 'Tip: 8+ chars, numbers and symbols.',

  'setpwd.save': 'Save password',
  'setpwd.saving': 'Saving…',
  'setpwd.to_home': 'Go to home',

  'setpwd.err.title': 'Error',

  // promo (Home stub)
  'promo.title': 'Promo codes',
  'promo.desc': 'Have a promo code? Enter it here — bonuses or discount will apply to your account.',
  'promo.input_ph': 'For example: SHPUN-2026',
  'promo.apply': 'Apply',
  'promo.applying': 'Applying…',
  'promo.err.empty': 'Enter a promo code.',
  'promo.done.stub': 'Promo codes will be available in the app soon ✨',
  'promo.history': 'History / status',
}
