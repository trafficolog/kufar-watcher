# Spec — архитектура интерфейса

> Прототипы в `prototypes/` — визуальная и интерактивная спецификация, а не код
> к переносу. Разметку и скрипты оттуда переписываем, решения — сохраняем.

## Слои

```
Electron
├── main/        службы приложения, планировщик, адаптеры Kufar, Telegram,
│                Prisma, экспорт и восстановление, интеграция с ОС
├── preload/     узкий типизированный мост contextBridge
└── renderer/    Nuxt 4 в режиме SPA · Vue 3 · TypeScript · Pinia
```

**Собранный renderer отдаётся собственной схемой, не `file://`.** `nuxt generate`
кладёт статику в `.output/public/`, схема регистрируется как стандартная
(`app://kufar/`), неизвестный путь приложения откатывается на `index.html`.
Причина двойная: у `file://` особые привилегии и иная модель происхождения, а
относительные пути и перезагрузка на вложенном маршруте по ней ведут себя не
так, как в разработке. Хэш-маршрутизация не подходит: фрагмент занят якорями
вроде `#seller-blacklist`.

**Nitro не используется.** Соблазн сделать `Vue → /api/monitors → Nitro →
Electron` выглядит привычно по вебу, но добавляет третий процесс и сериализацию
там, где уже есть IPC. Правильный путь — `Vue → типизированный IPC → служба
приложения`. Nuxt поднимается с `ssr: false`: сервер рендерить нечего, нужен
обычный клиентский бандл.

## Мост между процессами

Renderer не знает ни Prisma, ни таблиц. Мост публикует API уровня продукта, а не
уровня хранилища:

```ts
window.kufar.monitors.list()      // не db.findMany('Monitor')
window.kufar.monitors.create(input)
window.kufar.monitors.archive(id)
window.kufar.monitors.restore(id)

window.kufar.feed.search({ query, monitors, period, cursor })
window.kufar.favorites.watch(listingId)
window.kufar.favorites.unwatch(listingId)

window.kufar.health.getStatus()
window.kufar.health.recheck()
window.kufar.health.resumeMonitor(id)

window.kufar.sellers.block(input)
window.kufar.sellers.unblock(id)

window.kufar.telegram.setToken(token)
window.kufar.telegram.bindChat()
window.kufar.telegram.sendTest()

window.kufar.backup.export()
window.kufar.backup.restore(path)

window.kufar.external.openListing(id)
```

`contextIsolation` включён, `nodeIntegration` выключен, сырой `ipcRenderer`
наружу не отдаётся ни при каких условиях.

## Структура renderer

```
app/
├── layouts/default.vue        рейка, системные индикаторы, shell-grid,
│                              хосты тостов и алертов, переключение темы
├── pages/                     index · monitors · feed · favorites ·
│                              health · archive · settings
├── components/app|dashboard|monitors|feed|favorites|health|archive|settings
├── stores/                    app · monitors · feed · favorites · health · settings
├── composables/               useDesktopApi · useToast · useConfirm · useTheme
└── assets/css/                tokens · reset · shell · components
```

`default.vue` забирает всё, что в прототипах намеренно продублировано в каждом
файле. Это самый крупный выигрыш переноса: семь копий одной оболочки
превращаются в одну.

## Библиотека компонентов

Примитивы, которые уже видны в прототипах и должны появиться первыми:

```
AppShell · AppSidebar · AppHeader · SectionHeader
StatusLed · StatusBadge · MetricCard · ModeBadge
AppButton · FormInput · FormSelect · AppCheckbox
EmptyState · SkeletonRow · Toast · ConfirmDialog · StatusCallout
MonitorRow · FindingRow · FavoriteRow · ArchiveRow · JournalRow · PriceChart
```

После них страницы становятся короткими: `feed.vue` — это панель фильтров,
пустое состояние, группы находок и кнопка догрузки.

## Pinia

При семи экранах общего состояния достаточно, чтобы хранилище окупилось:
состояние приложения, здоровье, счётчики мониторов и избранного, состояние
Telegram, глобальная пауза, тема.

Правило, которое легко нарушить: **Pinia — не база**. Источник истины после
перезапуска один:

```
PostgreSQL / службы Electron → IPC → Pinia → Vue
```

## Опасность, которой нет в прототипах

В прототипах данные статические, поэтому `innerHTML` безобиден. В приложении
заголовки, описания и имена продавцов приходят с площадки и остаются
недоверенными. В Vue они выводятся интерполяцией; `v-html` для данных Kufar
запрещён.

## Переходы между разделами

Интерфейс должен ощущаться одной системой, а не семью экранами. Для этого
разделы связаны адресами:

| Откуда | Куда |
|--------|------|
| Дрейф на доске | `/health?event=<id>` |
| Находка на доске | `/feed?listing=<id>` |
| «Все находки» в архиве | `/feed?monitor=<id>&period=all` |
| «4 продавца» в редакторе правила | `/settings#seller-blacklist` |
| Избранное на доске | `/favorites?listing=<id>` |

## Порядок переноса

Готовность прототипов — не причина переносить всё сразу.

**Источник истины по порядку — таблица срезов в `ROADMAP.MD`, а не этот список.**
Если они разойдутся, права таблица: этот раздел лишь пересказывает её словами.

```
срез 0.3.0 (MVP-1)
  оболочка и layout          → 5.0
  настройка Telegram         → 5.0.2
  быстрое создание правила   → 5.0.1
  минимальный список правил  → 5.0.3
срез 0.5.0
  лента, избранное, архив    → 5.3, 5.4
срез 0.6.0
  здоровье                   → 5.5
срез 1.0.0
  доска наблюдения           → 5.8.1
  полный редактор правил     → 5.2
  трей и автозапуск          → 5.1
```

Ленты в срезе MVP-1 нет намеренно: до первого уведомления её нечем наполнить, а
минимальный список правил из `5.0.3` отвечает на вопрос «работает ли всё» без
неё. Состояние первого запуска (`5.8.2`) входит в MVP-1: без него человек
открывает пустое приложение и не понимает, что делать.
