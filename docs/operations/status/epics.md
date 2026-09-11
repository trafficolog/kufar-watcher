<!-- AUTO-GENERATED — не править вручную. Регенерация: npm run docs:ops:refresh -->

# Rollup: эпики

_Сгенерировано 2026-09-11_

| ID | Эпик | Фаза | Статус | Sync | Ист. |
|----|------|------|--------|------|------|
| `0.1` | Скелет Electron | 0 | ✅ done | 🟢 aligned | 4/4 done: Electron shell, utilityProcess model, typed IPC contract and worker crash-streak reset are implemented and verified. |
| `0.2` | Postgres в Docker под Dockerode | 0 | ✅ done | 🟢 aligned | 5/5 done: compose Postgres, Dockerode supervisor, infrastructure status UI, recoverable production bootstrap and existing-container configuration validation are implemented. |
| `0.3` | Prisma-схема и миграции | 0 | ⬜ todo | 🟡 drifted | Доменная модель в БД. |
| `0.4` | docs-ops, линт и CI | 0 | ✅ done | 🟢 aligned | 3/3 done: docs-ops CLI, CI gates, parent lifecycle and generated-doc freshness enforcement are implemented; verify #949 GREEN. |
| `1.0` | Разведка контракта площадки | 1 | ✅ done | 🟢 aligned | 2/2 done: live electronics and real-estate contract reconnaissance is captured in fixtures and the API contract. |
| `1.1` | URL-парсер и canonical query | 1 | ✅ done | 🟢 aligned | 4/4 done: canonical URL parse/build/routing plus real-estate regionless operation disambiguation are implemented and verified. |
| `1.2` | HTTP-клиент и лимитер | 1 | ✅ done | 🟢 aligned | Вежливый и предсказуемый сетевой слой. |
| `1.3` | Адаптеры выдачи Kufar | 1 | ✅ done | 🟢 aligned | 5/5: общий SourceAdapter, electronics, real-estate, проверенный HTML fallback и terminal pagination token готовы. |
| `1.4` | Водяной знак новизны и дедупликация | 1 | ✅ done | 🟢 aligned | 5/5 done: watermark traversal, persistence boundary, cold start, catch-up checkpoint and narrow stale-checkpoint recovery are implemented. |
| `1.5` | Догрузка описания карточки | 1 | ✅ done | 🟢 aligned | 3/3 done: persistent detail cache, two-stage description policy and per-Run 10-request detail budget; verify #935 GREEN. |
| `2.1` | Нормализация текста и glob-маски | 2 | ✅ done | 🟢 aligned | Нормализация текста и glob-маски — входит в срез MVP-1. |
| `2.2` | Матчер ключевых слов | 2 | ✅ done | 🟢 aligned | Отбор объявлений по ключевым словам. |
| `2.3` | Фильтр продавца | 2 | ⬜ todo | 🟡 drifted | Исключение нежелательных продавцов. |
| `2.4` | Планировщик на pg-boss | 2 | ✅ done | 🟢 aligned | Эпик закрыт: 2.4.1–2.4.4 delivery scope done; remediation 2.4.5 закрепляет per-Run source degradation без изменения retry/watermark policy, verify #915 GREEN. |
| `2.5` | Питание и догоняющий обход | 2 | ⬜ todo | 🟡 drifted | Корректная работа на машине, которая уходит в сон. |
| `2.6` | Морфология русского языка | 2 | ⬜ todo | 🟡 drifted | Русский стеммер и правило выбора между маской и морфологией — срез 0.4.0. |
| `3.1` | Телеграм-бот и транспорт | 3 | ⬜ todo | 🟡 drifted | Канал доставки уведомлений. |
| `3.2` | Форматтер и кнопки | 3 | ⬜ todo | 🟡 drifted | Формат уведомления о находке. |
| `3.3` | Тихие часы и очередь | 3 | ⬜ todo | 🟡 drifted | Уведомления не будят ночью и не теряются. |
| `3.4` | Мониторинг цен избранного | 3 | ⬜ todo | 🟡 drifted | Отслеживание цены по помеченным объявлениям. |
| `4.1` | Снимок схемы и детект дрейфа | 4 | ⬜ todo | 🟡 drifted | Раннее обнаружение изменений на стороне площадки. |
| `4.2` | Канарейка площадки | 4 | ⬜ todo | 🟡 drifted | Отличить «ничего нового» от «всё сломалось». |
| `4.3` | Автопауза и отчёт о поломке | 4 | ⬜ todo | 🟡 drifted | Остановиться и сообщить вместо тихой поломки. |
| `5.0` | Минимальный пользовательский срез | 5 | ⬜ todo | 🟡 drifted | Минимальный UI, замыкающий срез MVP-1: создание монитора и настройка Telegram. |
| `5.1` | Оболочка приложения и трей | 5 | ⬜ todo | 🟡 drifted | Фоновое приложение, которое не нужно держать открытым. |
| `5.2` | Мониторы: список и редактор | 5 | ⬜ todo | 🟡 drifted | Управление правилами из окна приложения. |
| `5.3` | Лента находок и избранное | 5 | ⬜ todo | 🟡 drifted | Просмотр накопленных данных. |
| `5.4` | Архив, блок-лист, настройки | 5 | ⬜ todo | 🟡 drifted | Долгоживущие данные и глобальная конфигурация. |
| `5.5` | Логи и здоровье | 5 | ⬜ todo | 🟡 drifted | Диагностика без залезания в базу. |
| `5.6` | E2E-приёмка релиза | 5 | ⬜ todo | 🟡 drifted | Приёмка релиза 1.0.0 целиком; приёмка среза MVP-1 — в задаче 5.0.4. |
| `5.7` | Сборка и установка | 5 | ⬜ todo | 🟡 drifted | Сборки под Windows и Linux, автозапуск и трей на обеих платформах. |
| `5.8` | Доска наблюдения и первый запуск | 5 | ⬜ todo | 🟡 drifted | Доска наблюдения и состояние первого запуска — два состояния одного маршрута. |
