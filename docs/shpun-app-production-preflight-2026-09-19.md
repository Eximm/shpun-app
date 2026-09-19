# ShpunApp: production preflight перед переходной выкладкой

Дата проверки: 2026-09-19. Проверка выполнялась без изменения контейнеров, базы, конфигурации и Git checkout на `core.shpyn.online`.

## Зафиксированное состояние

| Объект | Production |
|---|---|
| ShpunApp commit | `111c12eebdb4225fb68d06dcdb4879e36557dfb8` |
| Целевой commit в `origin/main` | `70a051dd00bbcd728d366463318ed76e86cf6da1` |
| Рабочее дерево | чистое |
| API image ID | `sha256:8b97bb476f68394b62bf384d88b8cc2213dee4b4cee3e8fb615d2c756f932ac0` |
| Web image ID | `sha256:7659c7d2bee2d8b5337857cfa89b07138e1aeff9d39ea02867b1eb2f32736d2b` |
| API / Web restarts | `0 / 0` |
| OAuth | `SHM_OAUTH_PROVIDERS` и `OAUTH_CALLBACK_BASE_URL` отсутствуют |
| SQLite | WAL, `PRAGMA quick_check = ok` |
| Свободное место | около 190 GiB |

Локальные health endpoints API вернули успешный ответ, web вернул HTTP 200. За последний проверенный час в логах API и web не найдено error-like строк. SHM-контейнеры в эту выкладку не входят.

## Найденные риски и меры

1. Production отстаёт от `origin/main` на два коммита. Обновление выполняется только fast-forward до заранее проверенного commit, не до произвольного будущего состояния `main`.
2. SQLite работает в WAL-режиме. Обычное копирование только `linkdb.sqlite` не является согласованным backup; перед выкладкой используется online `.backup`, затем `quick_check` копии.
3. Последняя обнаруженная резервная копия SQLite датирована 2026-09-12 и недостаточна как точка отката этой выкладки.
4. В Dockerfile использовались плавающие `node:22-alpine` и `nginx:alpine`. Они закреплены официальными multi-platform digest, проверенными 2026-09-19:
   - Node: `sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85`;
   - nginx: `sha256:62ff2089abf5a9ed33bd232895bef5e22f7bb4b200675cec49a5ebc48e3d4ac8`.
5. OAuth остаётся выключенным. Yandex и Google включаются только после стенда SHM 3.x, настройки provider credentials и проверки callback по одному провайдеру.

## Gate перед выкладкой

Выкладка ShpunApp на действующий SHM 2.x разрешается только после выполнения всех пунктов:

- [ ] создан новый online backup SQLite и его `quick_check` вернул `ok`;
- [ ] защищённо сохранён текущий `/opt/shpun-app/.env` без вывода секретов;
- [ ] текущие API и web images помечены rollback-тегами;
- [ ] подтверждён точный целевой Git commit;
- [ ] OAuth-переменные по-прежнему отсутствуют или пусты;
- [ ] подготовлен тестовый пользователь для smoke-проверки SHM 2.x;
- [ ] изменения active billing-template выполняются отдельно и только после экспорта текущей версии.

Подробная последовательность: `docs/shpun-app-shm2-deploy-runbook.md`.
