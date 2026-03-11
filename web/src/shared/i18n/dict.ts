export type Lang = "ru" | "en";
export type Dict = Record<string, string>;

export const RU: Dict = {
  // app
  "app.beta": "Бета",

  // common errors
  "error.open_in_tg": "Откройте приложение в Telegram для быстрого входа.",
  "error.password_login_failed": "Не удалось войти по паролю.",
  "error.password_register_failed": "Не удалось создать аккаунт.",
  "error.telegram_login_failed": "Не удалось войти через Telegram.",

  // login
  "login.title": "Вход в Shpun App",
  "login.badge.tg": "Telegram",
  "login.badge.web": "Браузер",

  "login.desc.tg": "Продолжите вход через Telegram.",
  "login.desc.web": "Войдите через Telegram или по логину и паролю.",

  "login.toast.error_title": "Ошибка",

  "login.what.title": "Shpun App",
  "login.what.1": "Баланс, услуги и управление аккаунтом — в одном месте.",
  "login.what.2": "Через Telegram вход быстрее всего.",
  "login.what.3": "Логин и пароль можно использовать как запасной вариант.",

  "login.divider.telegram": "Вход через Telegram",
  "login.divider.password": "Логин и пароль",
  "login.divider.providers": "Другие способы",

  "login.widget.tip": "Быстрый вход в аккаунт через Telegram.",
  "login.widget.unavailable": "Вход через Telegram сейчас недоступен.",

  "login.tg.cta": "Продолжить",
  "login.tg.cta_loading": "Входим…",

  "login.providers.telegram.hint.tg": "быстрый вход",
  "login.providers.telegram.hint.web": "открыть вход",
  "login.providers.google.hint": "скоро",
  "login.providers.yandex.hint": "скоро",
  "login.providers.soon": "Скоро",

  "login.password.summary": "Войти по логину и паролю",
  "login.password.form_title_login": "Вход по логину и паролю",
  "login.password.form_title_register": "Регистрация",
  "login.password.login": "Логин",
  "login.password.login_ph": "Введите логин",
  "login.password.password": "Пароль",
  "login.password.password_ph": "Введите пароль",
  "login.password.repeat": "Повторите пароль",
  "login.password.repeat_ph": "Повторите пароль",
  "login.password.mismatch": "Пароли не совпадают.",
  "login.password.submit": "Войти",
  "login.password.submit_loading": "Входим…",
  "login.password.register_submit": "Создать аккаунт",
  "login.password.register_loading": "Создаём аккаунт…",
  "login.password.switch_register": "Создать аккаунт",
  "login.password.switch_login": "Уже есть аккаунт? Войти",
  "login.password.tip": "Используйте этот способ, если входите не через Telegram.",
  "login.password.register_tip": "Этот способ подойдёт для входа из браузера.",

  "login.err.missing_payload": "Telegram не передал данные для входа. Попробуйте ещё раз.",
  "login.err.tg_widget_failed": "Не удалось войти через Telegram. Попробуйте ещё раз.",
  "login.err.no_shm_session": "Не удалось открыть сессию. Попробуйте ещё раз.",
  "login.err.user_lookup_failed": "Не удалось загрузить данные аккаунта. Попробуйте ещё раз.",
  "login.err.unknown": "Не удалось выполнить вход. Попробуйте ещё раз.",
  "login.err.login_and_password_required": "Введите логин и пароль.",
  "login.err.login_required": "Введите логин.",
  "login.err.password_required": "Введите пароль.",
  "login.err.invalid_credentials": "Неверный логин или пароль.",
  "login.err.password_too_short": "Пароль слишком короткий. Минимум 8 символов.",
  "login.err.login_taken": "Этот логин уже занят.",
  "login.err.not_authenticated": "Нужно войти заново.",
  "login.err.init_data_required": "Откройте приложение в Telegram для быстрого входа.",
  "login.err.tg_failed": "Не удалось войти через Telegram. Попробуйте ещё раз.",
  "login.err.generic": "Не удалось выполнить вход. Попробуйте ещё раз.",

  // home
  "home.loading.title": "Shpun",
  "home.loading.text": "Загрузка…",

  "home.error.title": "Shpun",
  "home.error.text": "Не удалось загрузить профиль.",
  "home.error.retry": "Повторить",

  "home.actions.profile": "Профиль",
  "home.actions.login": "Войти",

  "home.hello": "Привет",
  "home.head.sub": "Самое важное по аккаунту — на одной странице.",

  "home.toast.bonus_added.title": "Бонусы начислены",
  "home.toast.bonus_changed.title": "Бонусы обновлены",
  "home.toast.balance_added.title": "Баланс пополнен",

  "home.tiles.balance": "Баланс",
  "home.tiles.balance.sub": "Пополнение и история",

  "home.tiles.services": "Услуги",
  "home.tiles.services.sub": "Список и статусы",
  "home.tiles.services_in_days": "через {days} дн.",

  "home.tiles.attention": "Требуют внимания",
  "home.tiles.state": "Состояние",
  "home.tiles.state.ok": "Всё в порядке",
  "home.tiles.state.pay": "К оплате: {count}",
  "home.tiles.state.block": "Заблокировано: {count}",
  "home.tiles.state.block_badge": "есть блок",

  "home.tiles.monthly": "В месяц",
  "home.tiles.monthly.sub": "Плановый расход",

  "home.tiles.bonus": "Бонусы",
  "home.tiles.bonus.sub": "Начисления и списания",

  "home.tiles.forecast": "Следующая оплата",
  "home.tiles.forecast.loading": "Считаем…",

  "home.services.error": "Не удалось обновить статусы услуг.",

  "home.install.card.title": "Открыть Shpun в браузере",
  "home.install.card.sub": "В браузере доступны все функции приложения.",
  "home.install.card.open": "Открыть в браузере",

  "home.news.title": "Новости",
  "home.news.subtitle": "Короткие обновления и важные сообщения.",
  "home.news.today": "Сегодня",
  "home.news.item.fallback": "Сообщение",
  "home.news.empty.title": "Пока новостей нет",
  "home.news.empty.sub": "Когда появятся обновления, они будут здесь.",
  "home.news.open": "Открыть",

  "home.ref.title": "Реферальная программа",
  "home.ref.sub": "Приглашайте друзей и получайте бонусы за их пополнения.",
  "home.ref.link.k": "Ссылка",
  "home.ref.link.v": "Поделиться с друзьями",
  "home.ref.list.k": "Приглашённые",
  "home.ref.list.v": "Список и статусы",
  "home.ref.percent.k": "Начисления",
  "home.ref.percent.v": "Правила и проценты",
  "home.ref.copy_link": "Ссылка",
  "home.ref.list_btn": "Список",
  "home.ref.rules": "Правила",
  "home.ref.open": "Открыть",

  "home.promo.title": "Бонус-код",
  "home.promo.sub": "Введите код, чтобы получить бонус или скидку.",

  // promo
  "promo.input_ph": "Например: SHPUN-2026",
  "promo.apply": "Применить",
  "promo.applying": "Применяем…",
  "promo.err.empty": "Введите код.",
  "promo.done.stub": "Бонус-коды скоро появятся в приложении.",

  // profile
  "profile.title": "Профиль",
  "profile.refresh": "Обновить",
  "profile.head.sub": "Аккаунт, вход и настройки.",

  "profile.loading.title": "Профиль",
  "profile.loading.text": "Загрузка...",

  "profile.error.text": "Не удалось загрузить данные.",
  "profile.error.retry": "Повторить",

  "profile.logout": "Выйти",
  "profile.change_password": "Сменить пароль",

  "profile.toast.saved": "Данные сохранены",
  "profile.toast.copied": "Скопировано",

  "profile.personal.title": "Личные данные",
  "profile.personal.edit": "Изменить",
  "profile.personal.save": "Сохранить",
  "profile.personal.cancel": "Отмена",
  "profile.personal.error": "Не удалось сохранить изменения.",
  "profile.personal.name": "Имя",
  "profile.personal.name_ph": "Полное имя",
  "profile.personal.phone": "Телефон",
  "profile.personal.login": "Логин",
  "profile.personal.copy": "Скопировать",
  "profile.personal.id": "ID",
  "profile.personal.created": "Создан",
  "profile.personal.last_login": "Последний вход",

  "profile.auth.title": "Вход и привязки",

  "profile.telegram.unlinked": "Не подключен",
  "profile.telegram.link": "Подключить",
  "profile.telegram.change": "Изменить",
  "profile.telegram.hint": "Используется для входа и уведомлений.",
  "profile.telegram.badge.linked": "Подключен",
  "profile.telegram.badge.unlinked": "Не подключен",
  "profile.telegram.error.empty": "Введите Telegram логин.",
  "profile.telegram.error.invalid": "Некорректный Telegram логин.",
  "profile.telegram.error.save": "Не удалось сохранить Telegram логин.",
  "profile.telegram.toast.saved": "Telegram обновлён",
  "profile.telegram.modal.change_title": "Изменить Telegram",
  "profile.telegram.modal.link_title": "Подключить Telegram",
  "profile.telegram.modal.label": "Telegram логин без @",
  "profile.telegram.modal.placeholder": "например: shpunbest",

  "profile.settings.title": "Настройки",

  "profile.language.title": "Язык интерфейса",
  "profile.language.hint": "Сохраняется автоматически.",
  "profile.language.ru": "Русский",
  "profile.language.en": "English",
  "profile.language.aria": "Язык",

  "profile.pwa.title": "Приложение",
  "profile.pwa.installed": "Установлено",
  "profile.pwa.not_installed": "Не установлено",
  "profile.pwa.button.how": "Как установить",
  "profile.pwa.button.install": "Установить",
  "profile.pwa.button.menu": "Через меню",
  "profile.pwa.hint.installed": "Приложение уже на главном экране.",
  "profile.pwa.hint.ios": "iPhone: «Поделиться» → «На экран Домой».",
  "profile.pwa.hint.available": "Можно установить в один тап.",
  "profile.pwa.hint.menu": "Откройте меню браузера и выберите установку.",
  "profile.pwa.toast.installed": "Приложение установлено",
  "profile.pwa.toast.already_installed": "Уже установлено",
  "profile.pwa.toast.menu": "Установите приложение через меню браузера.",
  "profile.pwa.toast.started": "Установка запущена",
  "profile.pwa.toast.cancelled": "Установка отменена",
  "profile.pwa.toast.failed": "Не удалось запустить установку",
  "profile.pwa.ios_modal.title": "Установка на iPhone",
  "profile.pwa.ios_modal.text": "На iPhone приложение устанавливается через меню «Поделиться».",
  "profile.pwa.ios_modal.steps":
    "1) Откройте меню «Поделиться»\n2) Выберите «На экран Домой»\n3) Подтвердите добавление",

  "profile.push.title": "Уведомления",
  "profile.push.enabled": "Включены",
  "profile.push.disabled": "Выключены",
  "profile.push.permission.granted": "Разрешены",
  "profile.push.permission.denied": "Запрещены",
  "profile.push.permission.default": "Не выбрано",
  "profile.push.permission.unsupported": "Недоступно",
  "profile.push.hint.unsupported": "В этом браузере уведомления недоступны.",
  "profile.push.hint.denied": "Разрешите уведомления в настройках браузера.",
  "profile.push.hint.ios_install": "Для push на iPhone сначала установите приложение.",
  "profile.push.hint.enabled": "Будем отправлять важные уведомления.",
  "profile.push.hint.ask": "Нажмите «Включить», чтобы разрешить уведомления.",
  "profile.push.hint.disabled_by_user": "Выключено вручную. Можно включить снова.",
  "profile.push.hint.subscription": "Разрешение уже есть, осталось включить подписку.",
  "profile.push.toast.enabled": "Уведомления включены",
  "profile.push.toast.disabled": "Уведомления выключены",
  "profile.push.toast.denied": "Уведомления запрещены в браузере.",
  "profile.push.toast.failed": "Не удалось включить уведомления.",
  "profile.push.toast.install_ios": "Для push на iPhone сначала установите приложение.",
  "profile.push.button.unavailable": "Недоступно",
  "profile.push.button.settings": "В настройках",
  "profile.push.button.enable": "Включить",
  "profile.push.button.disable": "Выключить",

  "profile.soon": "Скоро",
  "profile.modal.close": "Закрыть",
  "profile.ok": "Понятно",

  // set password
  "setpwd.checking.title": "Проверяем доступ…",
  "setpwd.checking.text": "Подготавливаем страницу.",

  "setpwd.need_login.title": "Нужен вход",
  "setpwd.need_login.text": "Нужно войти в аккаунт.",
  "setpwd.need_login.cta": "Перейти ко входу",

  "setpwd.redirecting": "Возвращаем в приложение…",

  "setpwd.title": "Создать пароль",
  "setpwd.desc": "Пароль пригодится для входа в браузере и в приложении.",
  "setpwd.badge": "Готово за минуту",

  "setpwd.change.title": "Сменить пароль",
  "setpwd.change.desc": "Вы можете обновить пароль в любой момент.",
  "setpwd.change.save": "Сменить пароль",

  "setpwd.kv.login": "Логин",
  "setpwd.kv.why": "Для чего",
  "setpwd.kv.why_value": "Вход по паролю",
  "setpwd.kv.next": "Дальше",
  "setpwd.kv.next_value": "Главная",
  "setpwd.kv.next_value_profile": "Профиль",

  "setpwd.field.p1": "Новый пароль",
  "setpwd.field.p1_ph": "Минимум 8 символов",
  "setpwd.field.p2": "Повторите пароль",
  "setpwd.field.p2_ph": "Повторите пароль",
  "setpwd.field.show_password": "Показать пароль",
  "setpwd.field.hide_password": "Скрыть пароль",
  "setpwd.field.show": "Показать",
  "setpwd.field.hide": "Скрыть",

  "setpwd.strength": "Надёжность",
  "setpwd.tip": "Используйте 8+ символов, цифры и спецсимволы.",

  "setpwd.save": "Сохранить пароль",
  "setpwd.saving": "Сохраняем…",
  "setpwd.back": "Назад",
  "setpwd.to_home": "На главную",

  "setpwd.toast.saved.title": "Пароль сохранён",
  "setpwd.toast.changed.title": "Пароль изменён",
  "setpwd.toast.saved.desc": "Теперь войдите снова с новым паролем.",

  "setpwd.err.title": "Ошибка",
  "setpwd.err.generic": "Не удалось сохранить пароль.",
};

export const EN: Dict = {
  // app
  "app.beta": "Beta",

  // common errors
  "error.open_in_tg": "Open the app in Telegram for a quick sign-in.",
  "error.password_login_failed": "Could not sign in with password.",
  "error.password_register_failed": "Could not create the account.",
  "error.telegram_login_failed": "Could not sign in with Telegram.",

  // login
  "login.title": "Sign in to Shpun App",
  "login.badge.tg": "Telegram",
  "login.badge.web": "Browser",

  "login.desc.tg": "Continue with Telegram.",
  "login.desc.web": "Sign in with Telegram or with your login and password.",

  "login.toast.error_title": "Error",

  "login.what.title": "Shpun App",
  "login.what.1": "Balance, services, and account management in one place.",
  "login.what.2": "Telegram is the fastest way to sign in.",
  "login.what.3": "Login and password can be used as a backup option.",

  "login.divider.telegram": "Sign in with Telegram",
  "login.divider.password": "Login and password",
  "login.divider.providers": "Other options",

  "login.widget.tip": "Quick account sign-in with Telegram.",
  "login.widget.unavailable": "Telegram sign-in is currently unavailable.",

  "login.tg.cta": "Continue",
  "login.tg.cta_loading": "Signing in…",

  "login.providers.telegram.hint.tg": "quick sign-in",
  "login.providers.telegram.hint.web": "open sign-in",
  "login.providers.google.hint": "soon",
  "login.providers.yandex.hint": "soon",
  "login.providers.soon": "Soon",

  "login.password.summary": "Sign in with login and password",
  "login.password.form_title_login": "Sign in with login and password",
  "login.password.form_title_register": "Create account",
  "login.password.login": "Login",
  "login.password.login_ph": "Enter login",
  "login.password.password": "Password",
  "login.password.password_ph": "Enter password",
  "login.password.repeat": "Repeat password",
  "login.password.repeat_ph": "Repeat password",
  "login.password.mismatch": "Passwords do not match.",
  "login.password.submit": "Sign in",
  "login.password.submit_loading": "Signing in…",
  "login.password.register_submit": "Create account",
  "login.password.register_loading": "Creating account…",
  "login.password.switch_register": "Create account",
  "login.password.switch_login": "Already have an account? Sign in",
  "login.password.tip": "Use this option if you are not signing in through Telegram.",
  "login.password.register_tip": "This option works well for browser sign-in.",

  "login.err.missing_payload": "Telegram did not send sign-in data. Please try again.",
  "login.err.tg_widget_failed": "Could not sign in with Telegram. Please try again.",
  "login.err.no_shm_session": "Could not open a session. Please try again.",
  "login.err.user_lookup_failed": "Could not load account data. Please try again.",
  "login.err.unknown": "Could not sign in. Please try again.",
  "login.err.login_and_password_required": "Enter login and password.",
  "login.err.login_required": "Enter login.",
  "login.err.password_required": "Enter password.",
  "login.err.invalid_credentials": "Invalid login or password.",
  "login.err.password_too_short": "Password is too short. Minimum 8 characters.",
  "login.err.login_taken": "This login is already taken.",
  "login.err.not_authenticated": "Please sign in again.",
  "login.err.init_data_required": "Open the app in Telegram for a quick sign-in.",
  "login.err.tg_failed": "Could not sign in with Telegram. Please try again.",
  "login.err.generic": "Could not sign in. Please try again.",

  // home
  "home.loading.title": "Shpun",
  "home.loading.text": "Loading…",

  "home.error.title": "Shpun",
  "home.error.text": "Could not load profile.",
  "home.error.retry": "Retry",

  "home.actions.profile": "Profile",
  "home.actions.login": "Sign in",

  "home.hello": "Hi",
  "home.head.sub": "The most important account details on one page.",

  "home.toast.bonus_added.title": "Bonuses added",
  "home.toast.bonus_changed.title": "Bonuses updated",
  "home.toast.balance_added.title": "Balance topped up",

  "home.tiles.balance": "Balance",
  "home.tiles.balance.sub": "Top up and history",

  "home.tiles.services": "Services",
  "home.tiles.services.sub": "List and statuses",
  "home.tiles.services_in_days": "in {days} days",

  "home.tiles.attention": "Needs attention",
  "home.tiles.state": "Status",
  "home.tiles.state.ok": "Everything is fine",
  "home.tiles.state.pay": "To pay: {count}",
  "home.tiles.state.block": "Blocked: {count}",
  "home.tiles.state.block_badge": "has blocked",

  "home.tiles.monthly": "Per month",
  "home.tiles.monthly.sub": "Planned cost",

  "home.tiles.bonus": "Bonuses",
  "home.tiles.bonus.sub": "Accruals and spending",

  "home.tiles.forecast": "Next payment",
  "home.tiles.forecast.loading": "Calculating…",

  "home.services.error": "Could not refresh service statuses.",

  "home.install.card.title": "Open Shpun in browser",
  "home.install.card.sub": "The browser version gives access to all app features.",
  "home.install.card.open": "Open in browser",

  "home.news.title": "News",
  "home.news.subtitle": "Short updates and important messages.",
  "home.news.today": "Today",
  "home.news.item.fallback": "Message",
  "home.news.empty.title": "No news yet",
  "home.news.empty.sub": "Updates will appear here as soon as they are available.",
  "home.news.open": "Open",

  "home.ref.title": "Referral program",
  "home.ref.sub": "Invite friends and get bonuses from their top-ups.",
  "home.ref.link.k": "Link",
  "home.ref.link.v": "Share with friends",
  "home.ref.list.k": "Invited",
  "home.ref.list.v": "List and statuses",
  "home.ref.percent.k": "Rewards",
  "home.ref.percent.v": "Rules and rates",
  "home.ref.copy_link": "Link",
  "home.ref.list_btn": "List",
  "home.ref.rules": "Rules",
  "home.ref.open": "Open",

  "home.promo.title": "Bonus code",
  "home.promo.sub": "Enter a code to get a bonus or discount.",

  // promo
  "promo.input_ph": "For example: SHPUN-2026",
  "promo.apply": "Apply",
  "promo.applying": "Applying…",
  "promo.err.empty": "Enter a code.",
  "promo.done.stub": "Bonus codes will appear in the app soon.",

  // profile
  "profile.title": "Profile",
  "profile.refresh": "Refresh",
  "profile.head.sub": "Account, sign-in, and settings.",

  "profile.loading.title": "Profile",
  "profile.loading.text": "Loading...",

  "profile.error.text": "Could not load data.",
  "profile.error.retry": "Retry",

  "profile.logout": "Log out",
  "profile.change_password": "Change password",

  "profile.toast.saved": "Changes saved",
  "profile.toast.copied": "Copied",

  "profile.personal.title": "Personal details",
  "profile.personal.edit": "Edit",
  "profile.personal.save": "Save",
  "profile.personal.cancel": "Cancel",
  "profile.personal.error": "Could not save changes.",
  "profile.personal.name": "Name",
  "profile.personal.name_ph": "Full name",
  "profile.personal.phone": "Phone",
  "profile.personal.login": "Login",
  "profile.personal.copy": "Copy",
  "profile.personal.id": "ID",
  "profile.personal.created": "Created",
  "profile.personal.last_login": "Last sign-in",

  "profile.auth.title": "Sign-in and linked accounts",

  "profile.telegram.unlinked": "Not connected",
  "profile.telegram.link": "Connect",
  "profile.telegram.change": "Change",
  "profile.telegram.hint": "Used for sign-in and notifications.",
  "profile.telegram.badge.linked": "Connected",
  "profile.telegram.badge.unlinked": "Not connected",
  "profile.telegram.error.empty": "Enter Telegram login.",
  "profile.telegram.error.invalid": "Invalid Telegram login.",
  "profile.telegram.error.save": "Could not save Telegram login.",
  "profile.telegram.toast.saved": "Telegram updated",
  "profile.telegram.modal.change_title": "Change Telegram",
  "profile.telegram.modal.link_title": "Connect Telegram",
  "profile.telegram.modal.label": "Telegram login without @",
  "profile.telegram.modal.placeholder": "for example: shpunbest",

  "profile.settings.title": "Settings",

  "profile.language.title": "Interface language",
  "profile.language.hint": "Saved automatically.",
  "profile.language.ru": "Русский",
  "profile.language.en": "English",
  "profile.language.aria": "Language",

  "profile.pwa.title": "App",
  "profile.pwa.installed": "Installed",
  "profile.pwa.not_installed": "Not installed",
  "profile.pwa.button.how": "How to install",
  "profile.pwa.button.install": "Install",
  "profile.pwa.button.menu": "Via menu",
  "profile.pwa.hint.installed": "The app is already on your home screen.",
  "profile.pwa.hint.ios": "iPhone: Share → Add to Home Screen.",
  "profile.pwa.hint.available": "You can install it in one tap.",
  "profile.pwa.hint.menu": "Open the browser menu and choose install.",
  "profile.pwa.toast.installed": "App installed",
  "profile.pwa.toast.already_installed": "Already installed",
  "profile.pwa.toast.menu": "Install the app from the browser menu.",
  "profile.pwa.toast.started": "Installation started",
  "profile.pwa.toast.cancelled": "Installation cancelled",
  "profile.pwa.toast.failed": "Could not start installation",
  "profile.pwa.ios_modal.title": "Install on iPhone",
  "profile.pwa.ios_modal.text": "On iPhone, the app is installed through the Share menu.",
  "profile.pwa.ios_modal.steps":
    "1) Open the Share menu\n2) Choose Add to Home Screen\n3) Confirm adding the app",

  "profile.push.title": "Notifications",
  "profile.push.enabled": "Enabled",
  "profile.push.disabled": "Disabled",
  "profile.push.permission.granted": "Allowed",
  "profile.push.permission.denied": "Blocked",
  "profile.push.permission.default": "Not selected",
  "profile.push.permission.unsupported": "Unavailable",
  "profile.push.hint.unsupported": "Notifications are not available in this browser.",
  "profile.push.hint.denied": "Allow notifications in your browser settings.",
  "profile.push.hint.ios_install": "Install the app first to use push on iPhone.",
  "profile.push.hint.enabled": "We can send important notifications.",
  "profile.push.hint.ask": "Press Enable to allow notifications.",
  "profile.push.hint.disabled_by_user": "Disabled manually. You can turn it on again.",
  "profile.push.hint.subscription": "Permission is already granted, enable the subscription next.",
  "profile.push.toast.enabled": "Notifications enabled",
  "profile.push.toast.disabled": "Notifications disabled",
  "profile.push.toast.denied": "Notifications are blocked in the browser.",
  "profile.push.toast.failed": "Could not enable notifications.",
  "profile.push.toast.install_ios": "Install the app first to use push on iPhone.",
  "profile.push.button.unavailable": "Unavailable",
  "profile.push.button.settings": "In settings",
  "profile.push.button.enable": "Enable",
  "profile.push.button.disable": "Disable",

  "profile.soon": "Soon",
  "profile.modal.close": "Close",
  "profile.ok": "Got it",

  // set password
  "setpwd.checking.title": "Checking access…",
  "setpwd.checking.text": "Preparing the page.",

  "setpwd.need_login.title": "Sign-in required",
  "setpwd.need_login.text": "You need to sign in to your account.",
  "setpwd.need_login.cta": "Go to sign-in",

  "setpwd.redirecting": "Returning to the app…",

  "setpwd.title": "Create password",
  "setpwd.desc": "A password helps you sign in from the browser and the app.",
  "setpwd.badge": "Takes a minute",

  "setpwd.change.title": "Change password",
  "setpwd.change.desc": "You can update your password at any time.",
  "setpwd.change.save": "Change password",

  "setpwd.kv.login": "Login",
  "setpwd.kv.why": "Purpose",
  "setpwd.kv.why_value": "Password sign-in",
  "setpwd.kv.next": "Next",
  "setpwd.kv.next_value": "Home",
  "setpwd.kv.next_value_profile": "Profile",

  "setpwd.field.p1": "New password",
  "setpwd.field.p1_ph": "Minimum 8 characters",
  "setpwd.field.p2": "Repeat password",
  "setpwd.field.p2_ph": "Repeat password",
  "setpwd.field.show_password": "Show password",
  "setpwd.field.hide_password": "Hide password",
  "setpwd.field.show": "Show",
  "setpwd.field.hide": "Hide",

  "setpwd.strength": "Strength",
  "setpwd.tip": "Use 8+ characters, numbers, and special symbols.",

  "setpwd.save": "Save password",
  "setpwd.saving": "Saving…",
  "setpwd.back": "Back",
  "setpwd.to_home": "Go home",

  "setpwd.toast.saved.title": "Password saved",
  "setpwd.toast.changed.title": "Password changed",
  "setpwd.toast.saved.desc": "Now sign in again with your new password.",

  "setpwd.err.title": "Error",
  "setpwd.err.generic": "Could not save password.",
};