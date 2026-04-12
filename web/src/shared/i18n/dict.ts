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
  "login.lang.aria": "Язык",

  "login.desc.web.short": "Ваш личный кабинет для сервисов Shpun.",
  "login.desc.web.partner": "Ваш личный кабинет для сервисов Shpun. Войдите или создайте аккаунт по приглашению.",

  "login.toast.error_title": "Ошибка",

  "login.what.title": "Что такое Shpun App",
  "login.what.1.short": "Личный кабинет для сервисов Shpun.",
  "login.what.2.short": "Баланс, оплаты и бонусы.",
  "login.what.3.short": "Услуги, настройки и уведомления.",

  "login.divider.telegram": "Вход через Telegram",
  "login.divider.password": "E-mail и пароль",
  "login.divider.providers": "Другие способы",

  "login.widget.tip.secondary": "Вы можете войти через Telegram или выбрать другой способ входа ниже.",
  "login.widget.loading": "Пробуем загрузить вход через Telegram...",
  "login.widget.failed.soft": "Вход через Telegram сейчас может работать нестабильно. Попробуйте ещё раз или используйте другой способ входа ниже.",
  "login.widget.unavailable.alt": "Вход через Telegram сейчас недоступен. Используйте другой способ входа ниже.",
  "login.widget.open.alt": "Продолжить через Telegram",
  "login.widget.retry.alt": "Попробовать через Telegram ещё раз",

  "login.tg.cta_loading": "Входим…",

  "login.providers.telegram.hint.web": "открыть вход",
  "login.providers.telegram.hint.loading": "загрузка...",
  "login.providers.google.hint": "скоро",
  "login.providers.yandex.hint": "скоро",
  "login.providers.soon": "Скоро",

  "login.password.form_title_login": "Вход по логину или e-mail и паролю",
  "login.password.form_title_register": "Создать аккаунт",
  "login.password.login": "E-mail",
  "login.password.login_or_email": "Логин или e-mail",
  "login.password.login_ph": "Введите логин или e-mail",
  "login.password.login_ph_register": "Введите ваш e-mail",
  "login.password.client": "Имя клиента (необязательно)",
  "login.password.client_ph": "Как к вам обращаться",
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
  "login.password.open_login": "Войти по логину или e-mail",
  "login.password.open_register": "Создать аккаунт",
  "login.password.open_register_partner": "Зарегистрироваться по приглашению",
  "login.password.show": "Показать пароль",
  "login.password.hide": "Скрыть пароль",

  "login.partner.notice": "Вы пришли по приглашению. Партнёрская ссылка будет учтена при регистрации.",
  "login.partner.banner": "Приглашение сохранено. Для нового пользователя сразу открыта регистрация, и партнёрка будет учтена.",
  "login.partner.field": "Партнёрский код (необязательно)",
  "login.partner.field_ph": "Введите ID партнёра",
  "login.partner.invalid": "Партнёрский код должен быть положительным числом.",

  "login.auth.finish_failed": "Не удалось завершить вход. Попробуйте ещё раз.",

  "login.err.missing_payload": "Telegram не передал данные для входа. Попробуйте ещё раз.",
  "login.err.tg_widget_failed": "Не удалось войти через Telegram. Попробуйте ещё раз.",
  "login.err.no_shm_session": "Не удалось открыть сессию. Попробуйте ещё раз.",
  "login.err.user_lookup_failed": "Не удалось загрузить данные аккаунта. Попробуйте ещё раз.",
  "login.err.unknown": "Не удалось выполнить вход. Попробуйте ещё раз.",
  "login.err.login_and_password_required": "Введите логин или e-mail и пароль.",
  "login.err.login_required": "Введите логин или e-mail.",
  "login.err.password_required": "Введите пароль.",
  "login.err.invalid_credentials": "Неверный e-mail или пароль.",
  "login.err.password_too_short": "Пароль слишком короткий. Минимум 8 символов.",
  "login.err.login_taken": "Этот email уже привязан к другому аккаунту.",
  "login.err.not_authenticated": "Нужно войти заново.",
  "login.err.init_data_required": "Откройте приложение в Telegram для быстрого входа.",
  "login.err.tg_failed": "Не удалось войти через Telegram. Попробуйте ещё раз.",
  "login.err.generic": "Не удалось выполнить вход. Попробуйте ещё раз.",

  "login.err.register_failed": "Не удалось создать аккаунт. Попробуйте ещё раз.",
  "login.err.email_required": "Введите e-mail.",
  "login.err.email_non_ascii": "Используйте e-mail только латиницей. Кириллица в адресе не поддерживается.",
  "login.err.email_invalid_format": "Это не похоже на настоящий e-mail. Введите действительный адрес.",
  "login.err.email_disposable": "Временные e-mail не подходят. Введите постоянный адрес.",
  "login.err.email_domain_unresolvable": "Не удалось подтвердить домен e-mail. Проверьте адрес.",

  // home
  "home.loading.text": "Загрузка…",

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

  "home.install.card.title": "Открыть Shpun App в браузере",
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

  // PROFILE — RU
  "profile.title": "Профиль",
  "profile.head.sub": "Аккаунт, вход и настройки.",


  "profile.error.text": "Не удалось загрузить данные.",
  "profile.error.retry": "Повторить",

  "profile.logout": "Выйти",
  "profile.admin": "Админка",

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

  "profile.email.title": "Email",
  "profile.email.loading": "Загрузка…",
  "profile.email.empty": "Не указан",
  "profile.email.add": "Добавить",
  "profile.email.change": "Изменить",
  "profile.email.save": "Сохранить",
  "profile.email.verify": "Подтвердить",

  "profile.email.badge.verified": "Подтверждён",
  "profile.email.badge.unverified": "Не подтверждён",
  "profile.email.badge.empty": "Не указан",

  "profile.email.hint.verified": "Используется для входа и восстановления доступа.",
  "profile.email.hint.unverified": "Добавлен как дополнительный логин. Рекомендуем подтвердить.",
  "profile.email.hint.empty": "Добавьте email для входа и восстановления доступа.",

  "profile.email.toast.saved": "Email сохранён",
  "profile.email.toast.verify_sent": "Письмо для подтверждения отправлено",
  "profile.email.toast.verify_failed": "Не удалось отправить письмо для подтверждения",

  "profile.email.error.empty": "Введите email.",
  "profile.email.error.invalid": "Укажите корректный email.",
  "profile.email.error.already_used": "Этот email уже занят.",
  "profile.email.error.not_saved": "Не удалось сохранить email. Проверьте адрес и попробуйте снова.",
  "profile.email.error.save_check_failed": "Не удалось проверить сохранение email. Попробуйте ещё раз.",
  "profile.email.error.save": "Не удалось сохранить email. Попробуйте ещё раз.",
  "profile.email.error.need_email": "Сначала добавьте email.",

  "profile.email.modal.add_title": "Добавить email",
  "profile.email.modal.change_title": "Изменить email",
  "profile.email.modal.text": "Укажите email, который будет использоваться для входа и восстановления доступа.",
  "profile.email.modal.placeholder": "name@example.com",

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
  "profile.pwa.ios_modal.steps": "1) Откройте меню «Поделиться»\n2) Выберите «На экран Домой»\n3) Подтвердите добавление",

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

  "profile.modal.close": "Закрыть",
  "profile.ok": "Понятно",

  // set password











  // services
  "services.wl.badge": "WL",
  "services.wl.hint":"White List режим — используйте только в сетях с белыми списками или если обычное подключение не работает.",
  "services.wl.warning":  "Трафик в этом режиме может быть ограничен.",
  "services.title": "Услуги",
  "services.sub": "Ваши услуги и их текущий статус.",
  "services.loading": "Загрузка...",
  "services.loading_short": "Загрузка…",
  "services.error.text": "Не удалось загрузить список услуг. Попробуйте ещё раз.",
  "services.retry": "Повторить",

  "services.kind.amneziawg": "AmneziaWG",
  "services.kind.marzban": "Marzban",
  "services.kind.marzban_router": "Router VPN",
  "services.kind.unknown": "Другое",

  "services.kind_descr.amneziawg": "Простой ключ для одного сервера.",
  "services.kind_descr.marzban": "Подписка для телефонов, ПК и планшетов.",
  "services.kind_descr.marzban_router": "Отдельные подписки для роутеров (Shpun Router / OpenWrt).",
  "services.kind_descr.unknown": "Прочие услуги.",

  "services.status.active": "Активна",
  "services.status.pending": "Подключается",
  "services.status.not_paid": "Не оплачена",
  "services.status.blocked": "Заблокирована",
  "services.status.removed": "Завершена",
  "services.status.error": "Ошибка",
  "services.status.init": "Инициализация",
  "services.status.default": "Статус",

  "services.hint.days_left": "Осталось около {days} дн.",
  "services.hint.expired": "Срок истёк",
  "services.hint.not_paid": "Требуется оплата",
  "services.hint.blocked": "Нужны действия",
  "services.hint.pending": "Подождите немного",
  "services.hint.init": "Инициализация услуги",
  "services.hint.error": "Проверьте статус или обратитесь в поддержку",

  "services.meta.until": "До",
  "services.meta.active": "Активные",
  "services.meta.attention": "Внимание",
  "services.meta.discount": "Скидка",

  "services.month_short": "м",
  "services.item": "Услуга",

  "services.actions.title": "Действия",
  "services.refresh": "Обновить",
  "services.refresh_status": "Обновить статус",
  "services.pay": "Оплатить / пополнить",
  "services.topup": "Пополнить / оплатить",
  "services.support": "В поддержку",
  "services.empty.title": "У вас пока нет активных услуг",
  "services.empty.text": "Выберите тариф и получите доступ к сервису всего за пару минут.",

  "services.connect.title": "Подключение",
  "services.connect.button": "Как подключиться",
  "services.connect.hide": "Скрыть инструкцию",
  "services.connect.open": "Открыть подключение",
  "services.connect.only_active": "Подключение доступно только для активной услуги.",
  "services.connect.unavailable": "Для этого типа услуги пока нет помощника подключения.",

  "services.stop.title": "Заблокировать услугу",
  "services.stop.button": "Заблокировать",

  "services.delete.title": "Удалить услугу",
  "services.delete.button": "Удалить услугу",
  "services.delete.confirm": "Удалить",

  "services.delete_confirm.not_paid": "Удалить неоплаченный заказ? Он исчезнет из списка.",
  "services.delete_confirm.blocked": "Удалить услугу? Она исчезнет из списка.",
  "services.delete_confirm.error": "Удалить услугу? Она исчезнет из списка.",
  "services.delete_confirm.default": "Удалить услугу?",

  "services.toast.updated": "Обновлено",
  "services.toast.updated_desc": "Статусы услуг обновлены.",
  "services.toast.refresh_failed": "Не удалось обновить",
  "services.toast.blocked": "Заблокировано",
  "services.toast.blocked_desc": "Услуга заблокирована.",
  "services.toast.block_failed": "Не удалось заблокировать",
  "services.toast.deleted": "Услуга удалена",
  "services.toast.deleted_desc": "Готово. Услуга удалена из списка.",
  "services.toast.delete_failed": "Не удалось удалить",
  "services.toast.service_blocked": "Услуга заблокирована. Нужны действия.",
  "services.toast.service_not_paid": "Требуется оплата.",
  "services.toast.service_active": "Услуга активирована.",
  "services.toast.service_removed": "Услуга завершена.",

  "services.modal.footer_hint": "Если вы сомневаетесь — сначала проверьте статус услуги или обратитесь в поддержку.",
  "services.modal.status": "Статус",
  "services.modal.type": "Тип",
  "services.modal.plan": "Тариф",
  "services.modal.until": "Действует до",

  "services.modal.stop.title": "Заблокировать услугу?",
  "services.modal.stop.title_named": "Заблокировать услугу «{title}»?",
  "services.modal.stop.what_happens": "Что произойдёт:",
  "services.modal.stop.text": "Мы заблокируем услугу «{title}». После этого она перестанет работать.",
  "services.modal.stop.warn1": "Разблокировка самостоятельно недоступна.",
  "services.modal.stop.warn2": "Если потребуется вернуть доступ — только через техподдержку.",

  "services.modal.delete.title": "Удалить услугу?",
  "services.modal.delete.title_named": "Удалить услугу «{title}»?",
  "services.modal.delete.confirm_title": "Подтверждение удаления",

  "services.cancel": "Отмена",
  "services.close": "Закрыть",

  // FEED
  "feed.title": "Инфоцентр",
  "feed.subtitle": "Здесь всё, что важно.",
  "feed.filter.all": "Все",
  "feed.filter.money": "Деньги",
  "feed.filter.services": "Услуги",
  "feed.filter.news": "Новости",
  "feed.empty.title": "Пока здесь тихо",
  "feed.empty.text": "Как только появятся пополнения, продления или новости — они будут в Инфоцентре.",
  "feed.item.fallback": "Сообщение",
  "feed.chip.news": "NEWS",
  "feed.chip.alert": "ALERT",
  "feed.chip.info": "INFO",
  "feed.more": "Подробнее",
  "feed.load.loading": "Загружаю…",
  "feed.load.more": "Загрузить ещё",
  "feed.load.end": "Больше нет",
  "feed.modal.close": "Закрыть",

    // PAYMENTS
  "payments.page.title": "Оплата",
  "payments.page.sub": "Укажите сумму и выберите удобный способ оплаты. После успешной оплаты баланс пополнится автоматически.",
  "payments.loading": "Загрузка…",
  "payments.error.text": "Не удалось загрузить способы оплаты. Попробуйте ещё раз.",
  "payments.error.retry": "Повторить",
  "payments.error.home": "На главную",

  "payments.toast.load_failed": "Не удалось открыть оплату",
  "payments.toast.payment_opened": "Страница оплаты открыта",
  "payments.toast.payment_opened.desc": "После оплаты нажмите «Проверить оплату».",
  "payments.toast.method_unavailable": "Этот способ оплаты сейчас недоступен",
  "payments.toast.enter_amount": "Введите сумму",
  "payments.toast.enter_amount.desc": "Сумма должна быть больше 0.",
  "payments.toast.done": "Готово",
  "payments.toast.checking_status": "Проверяем оплату",
  "payments.toast.checking_status.desc": "Обновляем данные…",

  "payments.overlay.title": "Страница оплаты открыта ✅",
  "payments.overlay.text": "Если страница оплаты открылась в новой вкладке, завершите оплату там и вернитесь сюда.\nПосле оплаты нажмите «Проверить оплату».",
  "payments.overlay.refresh": "Проверить оплату",
  "payments.overlay.close": "Закрыть",

  "payments.amount.title": "Сумма",
  "payments.amount.placeholder": "Сумма (₽)",


  "payments.methods.title": "Способы оплаты",
  "payments.methods.card_transfer": "Перевод по карте 💳",
  "payments.methods.empty": "Способы оплаты пока недоступны.",
  "payments.methods.type.stars": "Оплата через Telegram Stars",
  "payments.methods.type.external": "Внешняя оплата",
  "payments.methods.name_fallback": "Способ оплаты",
  "payments.methods.pay": "Оплатить",
  "payments.methods.note": "Даже если Telegram недоступен, оплата и отправка квитанции продолжат работать через приложение.",

  "payments.autopay.confirm_remove": "Отвязать сохранённый способ оплаты?",
  "payments.autopay.removed": "Автоплатёж отключён.",
  "payments.autopay.remove_short": "Отключить",
  "payments.autopay.remove_failed": "Не удалось отключить автоплатёж",

  "payments.card_transfer.need_amount": "Для перевода по реквизитам нужно указать сумму.",

  "payments.card_page.title": "Перевод по карте",
  "payments.card_page.amount_label": "Сумма перевода",

  "payments.requisites.loading": "Загружаем реквизиты…",
  "payments.requisites.error": "Реквизиты пока недоступны. Попробуйте немного позже.",
  "payments.requisites.empty": "Реквизиты пока не добавлены.",
  "payments.requisites.holder": "Получатель",
  "payments.requisites.card": "Номер карты",
  "payments.requisites.copy_card": "Скопировать номер карты",
  "payments.requisites.copied": "Скопировано",
  "payments.requisites.copied.desc": "Номер карты скопирован в буфер обмена.",

  "payments.receipt.amount_first.desc": "Перед отправкой квитанции нужно указать сумму.",
  "payments.receipt.file_too_large.title": "Файл слишком большой",
  "payments.receipt.file_too_large.desc": "Загрузите файл размером до 2 MB.",
  "payments.receipt.uploading_short": "⏳ Отправляем…",
  "payments.receipt.upload_btn": "🧾 Отправить квитанцию",
  "payments.receipt.sent": "Квитанция отправлена",
  "payments.receipt.sent.desc": "Мы получили её и проверим вручную.",
  "payments.receipt.sent_msg": "✅ Квитанция отправлена на проверку.",
  "payments.receipt.send_failed": "Не удалось отправить квитанцию",
  "payments.receipt.supported": "Поддерживаются JPG, PNG и PDF до 2 MB.",

  "payments.history.title": "История",
  "payments.history.operations": "История операций",
  "payments.history.receipts": "Квитанции",


  // PAYMENTS HISTORY
  "paymentsHistory.title": "🧾 История операций",
  "paymentsHistory.back": "Назад",
  "paymentsHistory.refresh": "⟳ Обновить",
  "paymentsHistory.receipts": "Отправленные квитанции",

  "paymentsHistory.error.load_failed": "Не удалось загрузить историю операций.",

  "paymentsHistory.loading": "Загрузка…",
  "paymentsHistory.empty.short": "Пока пусто",
  "paymentsHistory.page_info": "Страница: {page} · Показано: {shown}/{total}",

  "paymentsHistory.collapse.hide": "Свернуть",
  "paymentsHistory.collapse.show_more": "Показать ещё {count}",

  "paymentsHistory.topups.title": "Пополнения",
  "paymentsHistory.topups.system": "Способ оплаты",
  "paymentsHistory.topups.empty.title": "Пополнений пока не было",
  "paymentsHistory.topups.empty.sub": "Когда появятся новые пополнения, они будут здесь.",

  "paymentsHistory.withdrawals.title": "Списания",
  "paymentsHistory.withdrawals.id": "ID",
  "paymentsHistory.withdrawals.service": "Услуга",
  "paymentsHistory.withdrawals.usi": "USI",
  "paymentsHistory.withdrawals.period": "Период",
  "paymentsHistory.withdrawals.until": "До",
  "paymentsHistory.withdrawals.cost": "Стоимость",
  "paymentsHistory.withdrawals.discount": "Скидка",
  "paymentsHistory.withdrawals.bonus": "Бонусы",
  "paymentsHistory.withdrawals.empty.title": "Списаний пока не было",
  "paymentsHistory.withdrawals.empty.sub": "Когда появятся списания, они будут здесь.",

  // PAYMENTS RECEIPTS
  "paymentsReceipts.title": "🧾 Отправленные квитанции",
  "paymentsReceipts.subtitle": "Здесь сохраняются квитанции, которые вы отправили на проверку.",
  "paymentsReceipts.back": "Назад",
  "paymentsReceipts.refresh": "⟳ Обновить",
  "paymentsReceipts.history": "История операций",

  "paymentsReceipts.error.load_failed": "Не удалось загрузить квитанции.",

  "paymentsReceipts.loading": "Загрузка…",
  "paymentsReceipts.total": "Всего: {count}",

  "paymentsReceipts.empty.short": "Пока квитанций нет",
  "paymentsReceipts.empty.title": "Вы ещё не отправляли квитанции",
  "paymentsReceipts.empty.sub": "Когда вы отправите квитанцию после перевода, она появится здесь.",

  "paymentsReceipts.item.fallback": "Квитанция",
  "paymentsReceipts.item.date": "Дата",
  "paymentsReceipts.item.status": "Статус",
  "paymentsReceipts.item.error": "Комментарий",

  "paymentsReceipts.status.review": "На проверке",
  "paymentsReceipts.status.sent": "Отправлено",
  "paymentsReceipts.status.accepted": "Принято",
  "paymentsReceipts.status.error": "Есть проблема",


  // SERVICES ROUTER
  "servicesRouter.page.title": "Shpun Router",
  "servicesRouter.page.sub": "Подключает OpenWrt-роутер к Shpun SDN System и поднимает единый VPN для всей домашней сети.",
  "servicesRouter.page.back": "⇦ Назад",
  "servicesRouter.page.order": "Перейти к заказу Router VPN",
  "servicesRouter.page.download": "Скачать пакет Shpun Router",

  "servicesRouter.what.title": "Что это",
  "servicesRouter.what.body": "Shpun Router подключает ваш роутер к сети Shpun SDN System. Весь домашний трафик идёт через защищённый VPN-туннель.",
  "servicesRouter.what.note": "Никаких SSH, терминала и ручной настройки конфигов — всё делается через LuCI и бота.",
  "servicesRouter.what.bullet_1": "VPN сразу для всех устройств дома",
  "servicesRouter.what.bullet_2": "Привязка роутера через бота",
  "servicesRouter.what.bullet_3": "Виджет статуса прямо в OpenWrt",

  "servicesRouter.quick_start.title": "Быстрый старт",
  "servicesRouter.quick_start.step_1": "Установите OpenWrt 24.10+ на роутер.",
  "servicesRouter.quick_start.step_2": "Установите пакет shpun-router_1.0.0_all.ipk.",
  "servicesRouter.quick_start.step_3": "Откройте LuCI и перейдите на главную страницу.",
  "servicesRouter.quick_start.step_4": "Найдите виджет Shpun Router / SDN System.",
  "servicesRouter.quick_start.step_5": "Сканируйте QR-код в виджете и привяжите роутер в боте.",
  "servicesRouter.quick_start.note": "Обычно вся настройка занимает всего пару минут после установки пакета.",

  "servicesRouter.useful_for.title": "Кому это полезно",
  "servicesRouter.useful_for.bullet_1": "Если хотите ускорить и стабилизировать YouTube и стриминг на телевизоре или приставке.",
  "servicesRouter.useful_for.bullet_2": "Если нужно обойти гео-ограничения на устройствах, где нельзя установить VPN-приложение.",
  "servicesRouter.useful_for.bullet_3": "Если нужен VPN для игровых консолей, таких как PlayStation, Xbox и других.",

  "servicesRouter.setup.title": "Пошаговая настройка",
  "servicesRouter.setup.bullet_1": "Подготовьте роутер: OpenWrt 24.10+, интернет должен работать без VPN, доступ в LuCI должен быть открыт.",
  "servicesRouter.setup.bullet_2": "Установите пакет через LuCI: System → Software → Upload → установить ipk.",
  "servicesRouter.setup.bullet_3": "Откройте виджет: LuCI → главная страница → Shpun Router / SDN System.",
  "servicesRouter.setup.bullet_4": "Сканируйте QR-код, откройте бота, выберите услугу для роутера и завершите привязку.",

  "servicesRouter.faq.title": "FAQ и частые проблемы",
  "servicesRouter.faq.bullet_1": "VPN не подключается: проверьте, работает ли интернет без VPN, убедитесь, что услуга активна, нажмите «обновить статус» в виджете. Если не помогло — выполните «сбросить VPN и настройки» и привяжите роутер заново.",
  "servicesRouter.faq.bullet_2": "Не видно виджет: обновите страницу LuCI, попробуйте другой браузер или режим инкогнито, и убедитесь, что пакет установлен.",
  "servicesRouter.faq.bullet_3": "Скорость стала ниже: ограничением может быть процессор роутера. Сравните модель с рекомендуемыми, а скорость проверяйте отдельно по кабелю и по Wi-Fi.",

  "servicesRouter.updates.title": "Обновления и сброс",
  "servicesRouter.updates.bullet_1": "«Проверить/обновить прошивку» — ищет и устанавливает OTA-обновления Shpun Router.",
  "servicesRouter.updates.bullet_2": "«Сбросить VPN и настройки» — удаляет привязку и параметры VPN, не удаляя сам пакет.",

  // BOTTOM NAV
  "bottomNav.aria": "Навигация по приложению",
  "bottomNav.home": "Главная",
  "bottomNav.feed": "Новости",
  "bottomNav.services": "Услуги",
  "bottomNav.payments": "Оплата",
  "bottomNav.profile": "Профиль",

  // CONNECT AMNEZIAWG
  "connectAmneziaWG.error.load_failed": "Не удалось загрузить профиль",

  "connectAmneziaWG.toast.ready.title": "Профиль готов",
  "connectAmneziaWG.toast.ready.desc": "Теперь его можно импортировать в AmneziaWG.",
  "connectAmneziaWG.toast.prepare_failed.title": "Не удалось подготовить профиль",
  "connectAmneziaWG.toast.prepare_failed.profile_missing": "Профиль пока недоступен. Попробуйте чуть позже.",
  "connectAmneziaWG.toast.qr_ready.title": "QR-код готов",
  "connectAmneziaWG.toast.qr_ready.desc": "Откройте AmneziaWG и импортируйте профиль по QR-коду.",
  "connectAmneziaWG.toast.qr_failed.title": "Не удалось показать QR-код",
  "connectAmneziaWG.toast.qr_failed.desc": "Попробуйте ещё раз.",
  "connectAmneziaWG.toast.download.title": "Файл скачивается",
  "connectAmneziaWG.toast.download.desc": "Конфиг .conf появится в загрузках.",
  "connectAmneziaWG.toast.copy_ok.title": "Конфиг скопирован",
  "connectAmneziaWG.toast.copy_ok.desc": "Теперь его можно вставить в приложение или форму импорта.",
  "connectAmneziaWG.toast.copy_failed.title": "Не удалось скопировать конфиг",
  "connectAmneziaWG.toast.copy_failed.desc": "Браузер запретил копирование. Попробуйте другой способ.",

  "connectAmneziaWG.top_hint.loading": "Готовим подключение для {platform}…",
  "connectAmneziaWG.top_hint.error": "Не удалось подготовить подключение для {platform}.",
  "connectAmneziaWG.top_hint.ready": "Устройство: {platform}. Ниже — установка приложения и импорт готового профиля.",

  "connectAmneziaWG.status.ready": "✅ Профиль готов. ",
  "connectAmneziaWG.status.not_ready": "⚠️ Профиль пока недоступен. ",
  "connectAmneziaWG.status.loading": "… ",
  "connectAmneziaWG.retry": "Повторить",
  "connectAmneziaWG.wait": "Подождите…",
  "connectAmneziaWG.close": "Закрыть",

  "connectAmneziaWG.device.label": "Устройство:",
  "connectAmneziaWG.device.pick_aria": "Выбор устройства",
  "connectAmneziaWG.device.current": "✨ Текущее ({platform})",
  "connectAmneziaWG.device.current_short": "✨ Текущее",
  "connectAmneziaWG.device.modal_title": "Выберите устройство",

  "connectAmneziaWG.store.google_play": "Google Play",
  "connectAmneziaWG.store.app_store": "App Store",
  "connectAmneziaWG.store.download_page": "страницу скачивания",

  "connectAmneziaWG.step1.title": "1) Установите приложение",
  "connectAmneziaWG.step1.sub": "Установите ",
  "connectAmneziaWG.step1.sub_for": " для {platform}.",
  "connectAmneziaWG.step1.open_store": "Открыть {store}",
  "connectAmneziaWG.step1.download_apk": "Скачать APK",
  "connectAmneziaWG.step1.download_direct": "Скачать напрямую",

  "connectAmneziaWG.step2.title": "2) Добавьте профиль",
  "connectAmneziaWG.step2.sub_1": "Скачайте ",
  "connectAmneziaWG.step2.sub_2": " и импортируйте файл в ",
  "connectAmneziaWG.step2.more_hint": "(QR-код и копирование — в разделе «Другие способы».)",
  "connectAmneziaWG.step2.download_conf": "Скачать конфиг (.conf)",
  "connectAmneziaWG.step2.not_ready_title": "Профиль ещё не готов",
  "connectAmneziaWG.step2.hide_more": "Скрыть способы",
  "connectAmneziaWG.step2.show_more": "Другие способы",
  "connectAmneziaWG.step2.show_qr": "Показать QR-код",
  "connectAmneziaWG.step2.copy_conf": "Скопировать конфиг",

  "connectAmneziaWG.qr.title": "QR-код профиля",
  "connectAmneziaWG.qr.sub": "В AmneziaWG выберите импорт по QR-коду и наведите камеру.",
  "connectAmneziaWG.qr.alt": "QR-код конфигурации",

  // CONNeCT MARZBAN
  "connect.loading": "Готовим подключение…",
  "connect.ready": "Подписка готова.",
  "connect.error": "Не удалось подготовить подключение.",
  "connect.load_failed": "Не удалось загрузить ссылку подписки.",

  "connect.sub_ready": "Подписка готова",
  "connect.sub_ready_desc": "Теперь её можно добавить в приложение.",

  "connect.sub_prepare_error": "Не удалось подготовить подписку",
  "connect.sub_prepare_error_desc": "Попробуйте ещё раз чуть позже.",

  "connect.step_install": "1) Установите приложение",
  "connect.install_text": "Установите {client} для {platform}.",

  "connect.open_store": "Открыть",
  "connect.download_direct": "Скачать напрямую",

  "connect.step_import": "2) Добавьте подписку",
  "connect.import_text": "Откройте приложение и добавьте подписку.",

  "connect.add_sub": "Добавить подписку",
  "connect.wait": "Подождите…",

  "connect.more_methods": "Другие способы",
  "connect.hide_methods": "Скрыть способы",

  "connect.copy_link": "Скопировать ссылку",
  "connect.copied": "Ссылка скопирована",

  "connect.show_qr": "Показать QR",

  "connect.qr_title": "QR-код подписки",
  "connect.qr_text": "Откройте приложение на другом устройстве и импортируйте подписку через QR.",

  "connect.open_client": "Открываем приложение",

  "connect.step_install_desc": "Установите {client} для {platform} и вернитесь сюда, чтобы импортировать подписку в приложение.",
  "connect.step_import_desc": "После установки вернитесь сюда и добавьте подписку в приложение.",
  "connect.methods_desc": "Можно отсканировать QR или скопировать ссылку для ручного добавления в приложение.",
  "connect.copy_link_desc": "Скопируйте ссылку для ручного добавления в приложение.",
  "connect.show_qr_desc": "Отсканируйте QR для ручного добавления в приложение.",

  // ROUTER

  "router.config.title": "Настройки подключения",
  "router.config.protocol": "Протокол",
  "router.config.location": "Локация",
  "router.config.save": "Сохранить",
  "router.config.saving": "Сохраняем…",

  "router.protocol.ss": "Shadowsocks",
  "router.protocol.vless": "VLESS",

  "router.config.saved": "Настройки сохранены",
  "router.config.save_error": "Не удалось сохранить настройки",
  "router.hint": "Введите код с экрана роутера, чтобы привязать устройство к этой услуге.",
  "router.loading": "Загрузка состояния…",

  "router.status_updated": "Статус обновлён",
  "router.status_updated_desc": "Состояние роутера обновлено.",

  "router.status_error": "Не удалось обновить статус",
  "router.load_error": "Не удалось загрузить состояние роутера",

  "router.code_invalid": "Неверный код",
  "router.code_invalid_desc": "Код должен быть в формате XXXX-XXXX: только латинские буквы и цифры.",

  "router.binding": "Привязываем роутер",
  "router.binding_desc": "Это займёт пару секунд.",

  "router.bind_ok": "Роутер привязан",
  "router.bind_ok_desc": "Теперь он подключён к этой услуге.",

  "router.bind_error": "Не удалось привязать роутер",

  "router.unbinding": "Отвязываем роутер",
  "router.unbinding_desc": "Это займёт пару секунд.",

  "router.unbind_ok": "Роутер отвязан",
  "router.unbind_ok_desc": "Теперь можно привязать другой роутер.",

  "router.unbind_error": "Не удалось отвязать роутер",

  "router.bound": "Роутер привязан:",
  "router.not_bound": "Роутер ещё не привязан.",

  "router.bound_at": "Привязан:",
  "router.last_seen": "Последний контакт:",
  "router.status_title": "Статус привязки",
  "router.status_short": "status",

  "router.input_placeholder": "Например: N8JD-6TQ4",

  "router.bind": "Привязать роутер",
  "router.unbind": "Отвязать роутер",

  "router.one_device": "Один роутер может быть привязан к услуге одновременно.",
  "router.code_format": "Формат кода: XXXX-XXXX (латинские буквы и цифры).",

  /* === New keys added during refactor === */

  "common.close": "Закрыть",

  "login.desc.tg.detecting": "Загрузка…",
  "login.desc.tg.loading": "Выполняем вход через Telegram…",
  "login.desc.tg.only": "Вход выполняется через Telegram. Нажмите кнопку ниже если не произошло автоматически.",
  "login.tg.retry": "Войти через Telegram",
  "login.tg.only.password_disabled": "В mini app используйте вход через Telegram.",


  "services.cta.add_more": "Подключить ещё",
  "services.cta.choose_plan": "Выбрать тариф",

  "payments.forecast.hint": "Следующая оплата",
  "payments.autopay.title": "Автоплатёж",
  "payments.autopay.name_fallback": "Сохранённый способ",
  "payments.autopay.pay_now": "Пополнить сейчас",
  "payments.methods.badge.fast": "Быстро",
  "payments.methods.badge.manual": "Вручную",
  "payments.methods.type.card": "Банковский перевод",
  "payments.methods.card_open": "Показать реквизиты",
  "payments.card_page.receipt_required": "Без квитанции платёж не зачислится",
  "payments.card_page.receipt_required_text": "После перевода обязательно отправьте квитанцию — иначе мы не сможем зачислить платёж.",
  "payments.card_page.step_1": "Скопируйте номер карты и сделайте перевод на указанную сумму.",
  "payments.card_page.step_2": "Сразу после перевода нажмите «Отправить квитанцию».",
  "payments.card_page.step_3": "Дождитесь проверки — баланс пополнится в течение часа.",

  "servicesRouter.footer.text": "Есть вопросы? Напишите в Telegram-бот — поможем разобраться.",

  "profile.password.modal.title": "Сменить пароль",
  "profile.password.modal.text": "Введите новый пароль. После сохранения нужно будет войти снова.",
  "profile.password.field.p1": "Новый пароль",
  "profile.password.field.p1_ph": "Минимум 8 символов",
  "profile.password.field.p2": "Повторите пароль",
  "profile.password.field.p2_ph": "Повторите пароль",
  "profile.password.show_password": "Показать пароль",
  "profile.password.hide_password": "Скрыть пароль",
  "profile.password.show": "Показать",
  "profile.password.hide": "Скрыть",
  "profile.password.strength": "Надёжность",
  "profile.password.tip": "Используйте 8+ символов, цифры и спецсимволы.",
  "profile.password.save": "Сменить пароль",
  "profile.password.toast.changed": "Пароль изменён",
  "profile.password.error.save": "Не удалось изменить пароль.",

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
  "login.lang.aria": "Language",

  "login.desc.web.short": "Your dashboard for Shpun services.",
  "login.desc.web.partner": "Your dashboard for Shpun services. Sign in or create an account from the invitation.",

  "login.toast.error_title": "Error",

  "login.what.title": "What is Shpun App",
  "login.what.1.short": "Dashboard for Shpun services.",
  "login.what.2.short": "Balance, payments, and bonuses.",
  "login.what.3.short": "Services, settings, and notifications.",

  "login.divider.telegram": "Sign in with Telegram",
  "login.divider.password": "E-mail and password",
  "login.divider.providers": "Other options",

  "login.widget.tip.secondary": "You can continue with Telegram or choose another sign-in method below.",
  "login.widget.loading": "Trying to load Telegram sign-in...",
  "login.widget.failed.soft": "Telegram sign-in may be unstable right now. Try again or use another sign-in method below.",
  "login.widget.unavailable.alt": "Telegram sign-in is currently unavailable. Use another sign-in method below.",
  "login.widget.open.alt": "Continue with Telegram",
  "login.widget.retry.alt": "Try Telegram again",

  "login.tg.cta_loading": "Signing in…",

  "login.providers.telegram.hint.web": "open sign-in",
  "login.providers.telegram.hint.loading": "loading...",
  "login.providers.google.hint": "soon",
  "login.providers.yandex.hint": "soon",
  "login.providers.soon": "Soon",

  "login.password.form_title_login": "Sign in with login or e-mail and password",
  "login.password.form_title_register": "Create account",
  "login.password.login": "E-mail",
  "login.password.login_or_email": "Login or e-mail",
  "login.password.login_ph": "Enter login or e-mail",
  "login.password.login_ph_register": "Enter your e-mail",
  "login.password.client": "Client name (optional)",
  "login.password.client_ph": "How should we address you",
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
  "login.password.open_login": "Sign in with login or e-mail",
  "login.password.open_register": "Create account",
  "login.password.open_register_partner": "Create account from invitation",
  "login.password.show": "Show password",
  "login.password.hide": "Hide password",

  "login.partner.notice": "You came by invitation. The partner link will be applied during registration.",
  "login.partner.banner": "Invitation saved. Registration is opened for a new user and the referral will be applied.",
  "login.partner.field": "Partner code (optional)",
  "login.partner.field_ph": "Enter partner ID",
  "login.partner.invalid": "Partner code must be a positive number.",

  "login.auth.finish_failed": "Could not finish sign-in. Please try again.",

  "login.err.missing_payload": "Telegram did not send sign-in data. Please try again.",
  "login.err.tg_widget_failed": "Could not sign in with Telegram. Please try again.",
  "login.err.no_shm_session": "Could not open a session. Please try again.",
  "login.err.user_lookup_failed": "Could not load account data. Please try again.",
  "login.err.unknown": "Could not sign in. Please try again.",
  "login.err.login_and_password_required": "Enter login or e-mail and password.",
  "login.err.login_required": "Enter login or e-mail.",
  "login.err.password_required": "Enter password.",
  "login.err.invalid_credentials": "Invalid e-mail or password.",
  "login.err.password_too_short": "Password is too short. Minimum 8 characters.",
  "login.err.login_taken": "This e-mail is already taken.",
  "login.err.not_authenticated": "Please sign in again.",
  "login.err.init_data_required": "Open the app in Telegram for a quick sign-in.",
  "login.err.tg_failed": "Could not sign in with Telegram. Please try again.",
  "login.err.generic": "Could not sign in. Please try again.",

  "login.err.register_failed": "Could not create the account. Please try again.",
  "login.err.email_required": "Enter your e-mail.",
  "login.err.email_non_ascii": "Use Latin characters only in the e-mail address. Cyrillic is not supported.",
  "login.err.email_invalid_format": "This does not look like a real e-mail. Enter a valid address.",
  "login.err.email_disposable": "Temporary e-mail addresses are not allowed. Enter a permanent address.",
  "login.err.email_domain_unresolvable": "Could not verify the e-mail domain. Please check the address.",
  
  // home
  "home.loading.text": "Loading…",

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

  "home.install.card.title": "Open Shpun App in browser",
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

  // PROFILE — EN
  "profile.title": "Profile",
  "profile.head.sub": "Account, sign-in, and settings.",


  "profile.error.text": "Could not load your data.",
  "profile.error.retry": "Retry",

  "profile.logout": "Log out",
  "profile.admin": "Admin",

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

  "profile.auth.title": "Sign-in and links",

  "profile.email.title": "Email",
  "profile.email.loading": "Loading…",
  "profile.email.empty": "Not set",
  "profile.email.add": "Add",
  "profile.email.change": "Change",
  "profile.email.save": "Save",
  "profile.email.verify": "Verify",

  "profile.email.badge.verified": "Verified",
  "profile.email.badge.unverified": "Not verified",
  "profile.email.badge.empty": "Not set",

  "profile.email.hint.verified": "Used for sign-in and account recovery.",
  "profile.email.hint.unverified": "Added as an additional login. We recommend verifying it.",
  "profile.email.hint.empty": "Add an email for sign-in and account recovery.",

  "profile.email.toast.saved": "Email saved",
  "profile.email.toast.verify_sent": "Verification email sent",
  "profile.email.toast.verify_failed": "Could not send verification email",

  "profile.email.error.empty": "Enter an email.",
  "profile.email.error.invalid": "Enter a valid email.",
  "profile.email.error.already_used": "This email is already linked to another account.",
  "profile.email.error.not_saved": "Could not save the email. Check the address and try again.",
  "profile.email.error.save_check_failed": "Could not verify that the email was saved. Please try again.",
  "profile.email.error.save": "Could not save the email. Please try again.",
  "profile.email.error.need_email": "Add an email first.",

  "profile.email.modal.add_title": "Add email",
  "profile.email.modal.change_title": "Change email",
  "profile.email.modal.text": "Enter the email that will be used for sign-in and account recovery.",
  "profile.email.modal.placeholder": "name@example.com",

  "profile.telegram.unlinked": "Not connected",
  "profile.telegram.link": "Connect",
  "profile.telegram.change": "Change",
  "profile.telegram.hint": "Used for sign-in and notifications.",
  "profile.telegram.badge.linked": "Connected",
  "profile.telegram.badge.unlinked": "Not connected",
  "profile.telegram.error.empty": "Enter a Telegram username.",
  "profile.telegram.error.invalid": "Invalid Telegram username.",
  "profile.telegram.error.save": "Could not save Telegram username.",
  "profile.telegram.toast.saved": "Telegram updated",
  "profile.telegram.modal.change_title": "Change Telegram",
  "profile.telegram.modal.link_title": "Connect Telegram",
  "profile.telegram.modal.label": "Telegram username without @",
  "profile.telegram.modal.placeholder": "for example: shpunbest",

  "profile.settings.title": "Settings",

  "profile.language.title": "Interface language",
  "profile.language.hint": "Saved automatically.",
  "profile.language.ru": "Russian",
  "profile.language.en": "English",
  "profile.language.aria": "Language",

  "profile.pwa.title": "App",
  "profile.pwa.installed": "Installed",
  "profile.pwa.not_installed": "Not installed",
  "profile.pwa.button.how": "How to install",
  "profile.pwa.button.install": "Install",
  "profile.pwa.button.menu": "Via menu",
  "profile.pwa.hint.installed": "The app is already on the home screen.",
  "profile.pwa.hint.ios": "iPhone: Share → Add to Home Screen.",
  "profile.pwa.hint.available": "You can install it in one tap.",
  "profile.pwa.hint.menu": "Open the browser menu and choose install.",
  "profile.pwa.toast.installed": "App installed",
  "profile.pwa.toast.already_installed": "Already installed",
  "profile.pwa.toast.menu": "Install the app via the browser menu.",
  "profile.pwa.toast.started": "Installation started",
  "profile.pwa.toast.cancelled": "Installation cancelled",
  "profile.pwa.toast.failed": "Could not start installation",
  "profile.pwa.ios_modal.title": "Install on iPhone",
  "profile.pwa.ios_modal.text": "On iPhone, the app is installed through the Share menu.",
  "profile.pwa.ios_modal.steps": "1) Open the Share menu\n2) Select Add to Home Screen\n3) Confirm",

  "profile.push.title": "Notifications",
  "profile.push.enabled": "Enabled",
  "profile.push.disabled": "Disabled",
  "profile.push.permission.granted": "Allowed",
  "profile.push.permission.denied": "Blocked",
  "profile.push.permission.default": "Not selected",
  "profile.push.permission.unsupported": "Unavailable",
  "profile.push.hint.unsupported": "Notifications are not available in this browser.",
  "profile.push.hint.denied": "Allow notifications in your browser settings.",
  "profile.push.hint.ios_install": "To use push on iPhone, install the app first.",
  "profile.push.hint.enabled": "We will send important notifications.",
  "profile.push.hint.ask": "Tap Enable to allow notifications.",
  "profile.push.hint.disabled_by_user": "Disabled manually. You can enable it again.",
  "profile.push.hint.subscription": "Permission is already granted, now enable the subscription.",
  "profile.push.toast.enabled": "Notifications enabled",
  "profile.push.toast.disabled": "Notifications disabled",
  "profile.push.toast.denied": "Notifications are blocked in the browser.",
  "profile.push.toast.failed": "Could not enable notifications.",
  "profile.push.toast.install_ios": "To use push on iPhone, install the app first.",
  "profile.push.button.unavailable": "Unavailable",
  "profile.push.button.settings": "In settings",
  "profile.push.button.enable": "Enable",
  "profile.push.button.disable": "Disable",

  "profile.modal.close": "Close",
  "profile.ok": "Got it",

  // set password











  // services
  "services.wl.badge": "WL",
  "services.wl.hint": "White List mode — use only in networks with white lists or when the regular connection does not work.",
  "services.wl.warning": "Traffic in this mode may be limited.",
  "services.title": "Services",
  "services.sub": "Your services and their current status.",
  "services.loading": "Loading...",
  "services.loading_short": "Loading…",
  "services.error.text": "Could not load services list. Please try again.",
  "services.retry": "Retry",

  "services.kind.amneziawg": "AmneziaWG",
  "services.kind.marzban": "Marzban",
  "services.kind.marzban_router": "Router VPN",
  "services.kind.unknown": "Other",

  "services.kind_descr.amneziawg": "Simple key for one server.",
  "services.kind_descr.marzban": "Subscription for phones, PCs, and tablets.",
  "services.kind_descr.marzban_router": "Separate subscriptions for routers (Shpun Router / OpenWrt).",
  "services.kind_descr.unknown": "Other services.",

  "services.status.active": "Active",
  "services.status.pending": "Connecting",
  "services.status.not_paid": "Unpaid",
  "services.status.blocked": "Blocked",
  "services.status.removed": "Completed",
  "services.status.error": "Error",
  "services.status.init": "Initializing",
  "services.status.default": "Status",

  "services.hint.days_left": "About {days} days left.",
  "services.hint.expired": "Expired",
  "services.hint.not_paid": "Payment required",
  "services.hint.blocked": "Action required",
  "services.hint.pending": "Please wait a little",
  "services.hint.init": "Service is being initialized",
  "services.hint.error": "Check the status or contact support",

  "services.meta.until": "Until",
  "services.meta.active": "Active",
  "services.meta.attention": "Attention",
  "services.meta.discount": "Discount",

  "services.month_short": "mo",
  "services.item": "Service",

  "services.actions.title": "Actions",
  "services.refresh": "Refresh",
  "services.refresh_status": "Refresh status",
  "services.pay": "Pay / top up",
  "services.topup": "Top up / pay",
  "services.support": "Support",
  "services.empty.title": "You have no active services yet",
  "services.empty.text": "Choose a plan and get full access in just a couple of minutes.",

  "services.connect.title": "Connection",
  "services.connect.button": "How to connect",
  "services.connect.hide": "Hide instructions",
  "services.connect.open": "Open connection",
  "services.connect.only_active": "Connection is available only for active services.",
  "services.connect.unavailable": "No connection helper for this service type yet.",

  "services.stop.title": "Block service",
  "services.stop.button": "Block",

  "services.delete.title": "Delete service",
  "services.delete.button": "Delete service",
  "services.delete.confirm": "Delete",

  "services.delete_confirm.not_paid": "Delete unpaid order? It will disappear from the list.",
  "services.delete_confirm.blocked": "Delete service? It will disappear from the list.",
  "services.delete_confirm.error": "Delete service? It will disappear from the list.",
  "services.delete_confirm.default": "Delete service?",

  "services.toast.updated": "Updated",
  "services.toast.updated_desc": "Service statuses updated.",
  "services.toast.refresh_failed": "Could not refresh",
  "services.toast.blocked": "Blocked",
  "services.toast.blocked_desc": "Service has been blocked.",
  "services.toast.block_failed": "Could not block",
  "services.toast.deleted": "Service deleted",
  "services.toast.deleted_desc": "Done. Service was removed from the list.",
  "services.toast.delete_failed": "Could not delete",
  "services.toast.service_blocked": "Service is blocked. Action required.",
  "services.toast.service_not_paid": "Payment required.",
  "services.toast.service_active": "Service activated.",
  "services.toast.service_removed": "Service completed.",

  "services.modal.footer_hint": "If you are unsure, first check the service status or contact support.",
  "services.modal.status": "Status",
  "services.modal.type": "Type",
  "services.modal.plan": "Plan",
  "services.modal.until": "Active until",

  "services.modal.stop.title": "Block service?",
  "services.modal.stop.title_named": "Block service “{title}”?",
  "services.modal.stop.what_happens": "What will happen:",
  "services.modal.stop.text": "We will block service “{title}”. After that it will stop working.",
  "services.modal.stop.warn1": "You cannot unblock it yourself.",
  "services.modal.stop.warn2": "If you need access again, contact support.",

  "services.modal.delete.title": "Delete service?",
  "services.modal.delete.title_named": "Delete service “{title}”?",
  "services.modal.delete.confirm_title": "Delete confirmation",

  "services.cancel": "Cancel",
  "services.close": "Close",

  // FEED
  "feed.title": "Info Center",
  "feed.subtitle": "Everything important is here.",
  "feed.filter.all": "All",
  "feed.filter.money": "Money",
  "feed.filter.services": "Services",
  "feed.filter.news": "News",
  "feed.empty.title": "Nothing here yet",
  "feed.empty.text": "As soon as top-ups, renewals, or news appear, they will show up in the Info Center.",
  "feed.item.fallback": "Message",
  "feed.chip.news": "NEWS",
  "feed.chip.alert": "ALERT",
  "feed.chip.info": "INFO",
  "feed.more": "Read more",
  "feed.load.loading": "Loading…",
  "feed.load.more": "Load more",
  "feed.load.end": "No more items",
  "feed.modal.close": "Close",

  // PAYMENTS
  "payments.page.title": "Payments",
  "payments.page.sub": "Enter an amount and choose a convenient payment method. After successful payment, your balance will be topped up automatically.",
  "payments.loading": "Loading…",
  "payments.error.text": "Couldn't load payment methods. Please try again.",
  "payments.error.retry": "Retry",
  "payments.error.home": "Home",

  "payments.toast.load_failed": "Couldn't open payments",
  "payments.toast.payment_opened": "Payment page opened",
  "payments.toast.payment_opened.desc": "After payment, tap “Check payment”.",
  "payments.toast.method_unavailable": "This payment method is unavailable right now",
  "payments.toast.enter_amount": "Enter an amount",
  "payments.toast.enter_amount.desc": "The amount must be greater than 0.",
  "payments.toast.done": "Done",
  "payments.toast.checking_status": "Checking payment",
  "payments.toast.checking_status.desc": "Refreshing data…",

  "payments.overlay.title": "Payment page opened ✅",
  "payments.overlay.text": "If the payment page opened in a new tab, complete the payment there and then come back here.\nAfter payment, tap “Check payment”.",
  "payments.overlay.refresh": "Check payment",
  "payments.overlay.close": "Close",

  "payments.amount.title": "Amount",
  "payments.amount.placeholder": "Amount (₽)",


  "payments.methods.title": "Payment methods",
  "payments.methods.card_transfer": "Card transfer 💳",
  "payments.methods.empty": "No payment methods are available right now.",
  "payments.methods.type.stars": "Pay via Telegram Stars",
  "payments.methods.type.external": "External payment",
  "payments.methods.name_fallback": "Payment method",
  "payments.methods.pay": "Pay",
  "payments.methods.note": "Even if Telegram is unavailable, payment and receipt upload will still work through the app.",

  "payments.autopay.confirm_remove": "Unlink the saved payment method?",
  "payments.autopay.removed": "Auto payment disabled.",
  "payments.autopay.remove_short": "Disable",
  "payments.autopay.remove_failed": "Couldn't disable auto payment",

  "payments.card_transfer.need_amount": "Enter an amount before using bank transfer.",

  "payments.card_page.title": "Card transfer",
  "payments.card_page.amount_label": "Transfer amount",

  "payments.requisites.loading": "Loading bank details…",
  "payments.requisites.error": "Bank details are unavailable right now. Please try again a bit later.",
  "payments.requisites.empty": "Bank details have not been added yet.",
  "payments.requisites.holder": "Recipient",
  "payments.requisites.card": "Card number",
  "payments.requisites.copy_card": "Copy card number",
  "payments.requisites.copied": "Copied",
  "payments.requisites.copied.desc": "Card number copied to clipboard.",

  "payments.receipt.amount_first.desc": "You need to specify the amount before sending a receipt.",
  "payments.receipt.file_too_large.title": "File is too large",
  "payments.receipt.file_too_large.desc": "Upload a file up to 2 MB.",
  "payments.receipt.uploading_short": "⏳ Sending…",
  "payments.receipt.upload_btn": "🧾 Send receipt",
  "payments.receipt.sent": "Receipt sent",
  "payments.receipt.sent.desc": "We received it and will review it manually.",
  "payments.receipt.sent_msg": "✅ Receipt sent for review.",
  "payments.receipt.send_failed": "Couldn't send the receipt",
  "payments.receipt.supported": "JPG, PNG, and PDF up to 2 MB are supported.",

  "payments.history.title": "History",
  "payments.history.operations": "Transaction history",
  "payments.history.receipts": "Receipts",


    // PAYMENTS HISTORY
  "paymentsHistory.title": "🧾 Transaction history",
  "paymentsHistory.back": "Back",
  "paymentsHistory.refresh": "⟳ Refresh",
  "paymentsHistory.receipts": "Submitted receipts",

  "paymentsHistory.error.load_failed": "Couldn't load transaction history.",

  "paymentsHistory.loading": "Loading…",
  "paymentsHistory.empty.short": "Nothing here yet",
  "paymentsHistory.page_info": "Page: {page} · Showing: {shown}/{total}",

  "paymentsHistory.collapse.hide": "Collapse",
  "paymentsHistory.collapse.show_more": "Show {count} more",

  "paymentsHistory.topups.title": "Top-ups",
  "paymentsHistory.topups.system": "Payment method",
  "paymentsHistory.topups.empty.title": "No top-ups yet",
  "paymentsHistory.topups.empty.sub": "When new top-ups appear, they will be shown here.",

  "paymentsHistory.withdrawals.title": "Charges",
  "paymentsHistory.withdrawals.id": "ID",
  "paymentsHistory.withdrawals.service": "Service",
  "paymentsHistory.withdrawals.usi": "USI",
  "paymentsHistory.withdrawals.period": "Period",
  "paymentsHistory.withdrawals.until": "Until",
  "paymentsHistory.withdrawals.cost": "Cost",
  "paymentsHistory.withdrawals.discount": "Discount",
  "paymentsHistory.withdrawals.bonus": "Bonuses",
  "paymentsHistory.withdrawals.empty.title": "No charges yet",
  "paymentsHistory.withdrawals.empty.sub": "When charges appear, they will be shown here.",


  // PAYMENTS RECEIPTS
  "paymentsReceipts.title": "🧾 Submitted receipts",
  "paymentsReceipts.subtitle": "Receipts you sent for review are stored here.",
  "paymentsReceipts.back": "Back",
  "paymentsReceipts.refresh": "⟳ Refresh",
  "paymentsReceipts.history": "Transaction history",

  "paymentsReceipts.error.load_failed": "Couldn't load receipts.",

  "paymentsReceipts.loading": "Loading…",
  "paymentsReceipts.total": "Total: {count}",

  "paymentsReceipts.empty.short": "No receipts yet",
  "paymentsReceipts.empty.title": "You haven't sent any receipts yet",
  "paymentsReceipts.empty.sub": "Once you send a receipt after a transfer, it will appear here.",

  "paymentsReceipts.item.fallback": "Receipt",
  "paymentsReceipts.item.date": "Date",
  "paymentsReceipts.item.status": "Status",
  "paymentsReceipts.item.error": "Comment",

  "paymentsReceipts.status.review": "Under review",
  "paymentsReceipts.status.sent": "Sent",
  "paymentsReceipts.status.accepted": "Accepted",
  "paymentsReceipts.status.error": "There is a problem",


  // SERVICES ROUTER
  "servicesRouter.page.title": "Shpun Router",
  "servicesRouter.page.sub": "Connects your OpenWrt router to Shpun SDN System and enables one VPN for your entire home network.",
  "servicesRouter.page.back": "⇦ Back",
  "servicesRouter.page.order": "Go to Router VPN order",
  "servicesRouter.page.download": "Download Shpun Router package",

  "servicesRouter.what.title": "What is it",
  "servicesRouter.what.body": "Shpun Router connects your router to the Shpun SDN System network. All home traffic goes through a secure VPN tunnel.",
  "servicesRouter.what.note": "No SSH, terminal, or manual config editing — everything is done through LuCI and the bot.",
  "servicesRouter.what.bullet_1": "One VPN for all devices at home",
  "servicesRouter.what.bullet_2": "Router linking through the bot",
  "servicesRouter.what.bullet_3": "Status widget right in OpenWrt",

  "servicesRouter.quick_start.title": "Quick start",
  "servicesRouter.quick_start.step_1": "Install OpenWrt 24.10+ on your router.",
  "servicesRouter.quick_start.step_2": "Install the shpun-router_1.0.0_all.ipk package.",
  "servicesRouter.quick_start.step_3": "Open LuCI and go to the home page.",
  "servicesRouter.quick_start.step_4": "Find the Shpun Router / SDN System widget.",
  "servicesRouter.quick_start.step_5": "Scan the QR code in the widget and link the router in the bot.",
  "servicesRouter.quick_start.note": "The whole setup usually takes just a couple of minutes after installing the package.",

  "servicesRouter.useful_for.title": "Who it is useful for",
  "servicesRouter.useful_for.bullet_1": "If you want faster and more stable YouTube and streaming on your TV or set-top box.",
  "servicesRouter.useful_for.bullet_2": "If you need to bypass geo-restrictions on devices where a VPN app cannot be installed.",
  "servicesRouter.useful_for.bullet_3": "If you need VPN for game consoles such as PlayStation, Xbox, and others.",

  "servicesRouter.setup.title": "Step-by-step setup",
  "servicesRouter.setup.bullet_1": "Prepare the router: OpenWrt 24.10+, internet should work without VPN, and LuCI access should be available.",
  "servicesRouter.setup.bullet_2": "Install the package through LuCI: System → Software → Upload → install ipk.",
  "servicesRouter.setup.bullet_3": "Open the widget: LuCI → home page → Shpun Router / SDN System.",
  "servicesRouter.setup.bullet_4": "Scan the QR code, open the bot, choose the router service, and complete the linking.",

  "servicesRouter.faq.title": "FAQ and common issues",
  "servicesRouter.faq.bullet_1": "VPN does not connect: check whether internet works without VPN, make sure the service is active, and tap “update status” in the widget. If that does not help, use “reset VPN and settings” and link the router again.",
  "servicesRouter.faq.bullet_2": "Widget is missing: refresh the LuCI page, try another browser or incognito mode, and make sure the package is installed.",
  "servicesRouter.faq.bullet_3": "Speed is lower: the router CPU may be the bottleneck. Compare your model with recommended ones, and test speeds separately over cable and Wi-Fi.",

  "servicesRouter.updates.title": "Updates and reset",
  "servicesRouter.updates.bullet_1": "“Check/update firmware” — finds and installs OTA updates for Shpun Router.",
  "servicesRouter.updates.bullet_2": "“Reset VPN and settings” — removes the link and VPN settings without deleting the package.",

  // Bottom navigation
  "bottomNav.aria": "App navigation",
  "bottomNav.home": "Home",
  "bottomNav.feed": "News",
  "bottomNav.services": "Services",
  "bottomNav.payments": "Payments",
  "bottomNav.profile": "Profile",

  // Connect AmneziaWG
  "connectAmneziaWG.error.load_failed": "Couldn't load the profile",

  "connectAmneziaWG.toast.ready.title": "Profile is ready",
  "connectAmneziaWG.toast.ready.desc": "You can now import it into AmneziaWG.",
  "connectAmneziaWG.toast.prepare_failed.title": "Couldn't prepare the profile",
  "connectAmneziaWG.toast.prepare_failed.profile_missing": "The profile is not available yet. Please try again a bit later.",
  "connectAmneziaWG.toast.qr_ready.title": "QR code is ready",
  "connectAmneziaWG.toast.qr_ready.desc": "Open AmneziaWG and import the profile using the QR code.",
  "connectAmneziaWG.toast.qr_failed.title": "Couldn't show the QR code",
  "connectAmneziaWG.toast.qr_failed.desc": "Please try again.",
  "connectAmneziaWG.toast.download.title": "File is downloading",
  "connectAmneziaWG.toast.download.desc": "The .conf file will appear in your downloads.",
  "connectAmneziaWG.toast.copy_ok.title": "Config copied",
  "connectAmneziaWG.toast.copy_ok.desc": "Now you can paste it into the app or import form.",
  "connectAmneziaWG.toast.copy_failed.title": "Couldn't copy the config",
  "connectAmneziaWG.toast.copy_failed.desc": "Your browser blocked copying. Try another method.",

  "connectAmneziaWG.top_hint.loading": "Preparing connection for {platform}…",
  "connectAmneziaWG.top_hint.error": "Couldn't prepare the connection for {platform}.",
  "connectAmneziaWG.top_hint.ready": "Device: {platform}. Below are the steps to install the app and import the ready profile.",

  "connectAmneziaWG.status.ready": "✅ Profile is ready. ",
  "connectAmneziaWG.status.not_ready": "⚠️ Profile is not available yet. ",
  "connectAmneziaWG.status.loading": "… ",
  "connectAmneziaWG.retry": "Retry",
  "connectAmneziaWG.wait": "Please wait…",
  "connectAmneziaWG.close": "Close",

  "connectAmneziaWG.device.label": "Device:",
  "connectAmneziaWG.device.pick_aria": "Choose device",
  "connectAmneziaWG.device.current": "✨ Current ({platform})",
  "connectAmneziaWG.device.current_short": "✨ Current",
  "connectAmneziaWG.device.modal_title": "Choose your device",

  "connectAmneziaWG.store.google_play": "Google Play",
  "connectAmneziaWG.store.app_store": "App Store",
  "connectAmneziaWG.store.download_page": "download page",

  "connectAmneziaWG.step1.title": "1) Install the app",
  "connectAmneziaWG.step1.sub": "Install ",
  "connectAmneziaWG.step1.sub_for": " for {platform}.",
  "connectAmneziaWG.step1.open_store": "Open {store}",
  "connectAmneziaWG.step1.download_apk": "Download APK",
  "connectAmneziaWG.step1.download_direct": "Download directly",

  "connectAmneziaWG.step2.title": "2) Add the profile",
  "connectAmneziaWG.step2.sub_1": "Download the ",
  "connectAmneziaWG.step2.sub_2": " file and import it into ",
  "connectAmneziaWG.step2.more_hint": "(QR code and copying are in “Other methods”.)",
  "connectAmneziaWG.step2.download_conf": "Download config (.conf)",
  "connectAmneziaWG.step2.not_ready_title": "The profile is not ready yet",
  "connectAmneziaWG.step2.hide_more": "Hide methods",
  "connectAmneziaWG.step2.show_more": "Other methods",
  "connectAmneziaWG.step2.show_qr": "Show QR code",
  "connectAmneziaWG.step2.copy_conf": "Copy config",

  "connectAmneziaWG.qr.title": "Profile QR code",
  "connectAmneziaWG.qr.sub": "In AmneziaWG, choose import by QR code and point the camera at it.",
  "connectAmneziaWG.qr.alt": "Configuration QR code",

  // connect Marzban
  "connect.loading": "Preparing connection…",
  "connect.ready": "Subscription is ready.",
  "connect.error": "Failed to prepare connection.",
  "connect.load_failed": "Failed to load subscription link.",

  "connect.sub_ready": "Subscription ready",
  "connect.sub_ready_desc": "You can now add it to the app.",

  "connect.sub_prepare_error": "Failed to prepare subscription",
  "connect.sub_prepare_error_desc": "Please try again later.",

  "connect.step_install": "1) Install the app",
  "connect.install_text": "Install {client} for {platform}.",

  "connect.open_store": "Open",
  "connect.download_direct": "Direct download",

  "connect.step_import": "2) Add subscription",
  "connect.import_text": "Open the app and add the subscription.",

  "connect.add_sub": "Add subscription",
  "connect.wait": "Please wait…",

  "connect.more_methods": "More options",
  "connect.hide_methods": "Hide options",

  "connect.copy_link": "Copy link",
  "connect.copied": "Link copied",

  "connect.show_qr": "Show QR",

  "connect.qr_title": "Subscription QR code",
  "connect.qr_text": "Open the client on another device and import the subscription via QR.",

  "connect.open_client": "Opening the app",

  "connect.step_install_desc": "Install {client} for {platform} and come back here to import the subscription into the app.",
  "connect.step_import_desc": "After installation, come back here and add the subscription in the app.",
  "connect.methods_desc": "You can scan the QR code or copy the link for manual import into the app.",
  "connect.copy_link_desc": "Copy the link for manual import into the app.",
  "connect.show_qr_desc": "Scan the QR code for manual import into the app.",
  
  // Router
  
  "router.config.title": "Connection settings",
  "router.config.protocol": "Protocol",
  "router.config.location": "Location",
  "router.config.save": "Save",
  "router.config.saving": "Saving…",

  "router.protocol.ss": "Shadowsocks",
  "router.protocol.vless": "VLESS",

  "router.config.saved": "Settings saved",
  "router.config.save_error": "Failed to save settings",
  "router.hint": "Enter the code from your router screen to link it to this service.",
  "router.loading": "Loading router status…",

  "router.status_updated": "Status updated",
  "router.status_updated_desc": "Router state has been refreshed.",

  "router.status_error": "Failed to update status",
  "router.load_error": "Failed to load router state",

  "router.code_invalid": "Invalid code",
  "router.code_invalid_desc": "The code must be in format XXXX-XXXX using Latin letters and numbers.",

  "router.binding": "Linking router",
  "router.binding_desc": "This will take a few seconds.",

  "router.bind_ok": "Router linked",
  "router.bind_ok_desc": "It is now connected to this service.",

  "router.bind_error": "Failed to link router",

  "router.unbinding": "Unlinking router",
  "router.unbinding_desc": "This will take a few seconds.",

  "router.unbind_ok": "Router unlinked",
  "router.unbind_ok_desc": "You can now link another router.",

  "router.unbind_error": "Failed to unlink router",

  "router.bound": "Router linked:",
  "router.not_bound": "Router is not linked yet.",

  "router.bound_at": "Linked at:",
  "router.last_seen": "Last contact:",

  "router.input_placeholder": "Example: N8JD-6TQ4",

  "router.bind": "Link router",
  "router.unbind": "Unlink router",
  "router.status_title": "Binding status",
  "router.status_short": "status",

  "router.one_device": "Only one router can be linked to this service at a time.",
  "router.code_format": "Code format: XXXX-XXXX (letters and numbers).",

  /* === New keys added during refactor === */

  "common.close": "Close",

  "login.desc.tg.detecting": "Loading…",
  "login.desc.tg.loading": "Signing in via Telegram…",
  "login.desc.tg.only": "Sign-in is done via Telegram. Tap the button below if it did not happen automatically.",
  "login.tg.retry": "Sign in with Telegram",
  "login.tg.only.password_disabled": "In the mini app, use Telegram sign-in.",


  "services.cta.add_more": "Add more",
  "services.cta.choose_plan": "Choose plan",

  "payments.forecast.hint": "Next payment",
  "payments.autopay.title": "Auto payment",
  "payments.autopay.name_fallback": "Saved method",
  "payments.autopay.pay_now": "Top up now",
  "payments.methods.badge.fast": "Fast",
  "payments.methods.badge.manual": "Manual",
  "payments.methods.type.card": "Bank transfer",
  "payments.methods.card_open": "Show details",
  "payments.card_page.receipt_required": "Payment will not be credited without a receipt",
  "payments.card_page.receipt_required_text": "After the transfer, be sure to send the receipt — otherwise we cannot identify and credit the payment.",
  "payments.card_page.step_1": "Copy the card number and make the transfer.",
  "payments.card_page.step_2": "Right after the transfer, tap Send receipt.",
  "payments.card_page.step_3": "Wait for review — balance will be credited within an hour.",

  "servicesRouter.footer.text": "Have questions? Message the Telegram bot — we will help.",

  "profile.password.modal.title": "Change password",
  "profile.password.modal.text": "Enter a new password. After saving you will need to sign in again.",
  "profile.password.field.p1": "New password",
  "profile.password.field.p1_ph": "Minimum 8 characters",
  "profile.password.field.p2": "Repeat password",
  "profile.password.field.p2_ph": "Repeat password",
  "profile.password.show_password": "Show password",
  "profile.password.hide_password": "Hide password",
  "profile.password.show": "Show",
  "profile.password.hide": "Hide",
  "profile.password.strength": "Strength",
  "profile.password.tip": "Use 8+ characters, numbers, and special symbols.",
  "profile.password.save": "Change password",
  "profile.password.toast.changed": "Password changed",
  "profile.password.error.save": "Could not change password.",

};