# Структура папки `docs/` — Kufar Monitor

> Canonical docs (phases/epics/tasks) + operations + superpowers + security.
> Разработка ведётся по методологии Spec-Driven Development. Документация —
> источник истины для агентов и людей.

## Два слоя документации

| Слой | Папки | Назначение |
|------|-------|------------|
| **Canonical product docs** | `phases/`, `epics/`, `tasks/` | Что строим: фазы, эпики, карточки задач. Источник истины для scope и критериев приёмки. |
| **Documentation operations** | `operations/` | Как строим: журналы сессий/итераций, авто-сводки статусов. |
| **Design & planning** | `superpowers/` | Архитектурные specs и implementation plans. |
| **Справочники** | корень `docs/` | ROADMAP, тестирование, release process, конституция агентов. |
| **Security** | `security/` | Threat model, отчёты pen-test. |

**`sync_state: drifted`** = карточка опережает реализацию (планируемое состояние). Это не ошибка.

## Дерево каталогов

```text
docs/
├── README.md            # Этот файл
├── ROADMAP.MD           # Тактический план: порядок, вехи, стек
├── RELEASING.md         # Версии, release gate, tags и GitHub Releases
├── AGENTS.md            # Конституция проекта для AI-агентов
├── TESTING.md           # Стратегия тестирования
├── releases/            # проверенные release notes по версиям
├── phases/              # фазы N
├── epics/               # эпики N.M
├── tasks/               # карточки N.M.K
├── superpowers/
│   ├── specs/           # design specs
│   └── plans/           # implementation plans
├── operations/
│   ├── templates/       # session.md, iteration.md
│   └── status/          # АВТОГЕНЕРАЦИЯ (npm run docs:ops:refresh)
└── security/
```

## Иерархия и ID-схема

```text
Phase (N) → Epic (N.M) → Task (N.M.K)
```

Пример: `1.4.2` = Фаза 1, Эпик 1.4, задача 2.

Эпик `1.0` — разведка контракта площадки, выполняется первым в фазе 1.
Эпик `5.0` — минимальный UI, замыкающий срез MVP-1, выполняется задолго до
остальных эпиков фазы 5. Номер эпика не равен порядку работ.

### Карта фаз

| № | Фаза | Эпики |
|---|------|-------|
| 0 | Фундамент | 0.1 – 0.4 |
| 1 | Ядро парсинга Kufar | 1.0 – 1.5 |
| 2 | Правила, матчинг, планировщик | 2.1 – 2.6 |
| 3 | Telegram и избранное | 3.1 – 3.4 |
| 4 | Здоровье и адаптивность | 4.1 – 4.3 |
| 5 | Панель управления и приёмка | 5.0 – 5.8 |

**Фазы не задают порядок работ.** Это тематическая группировка. Порядок работ
задают срезы поставки в `ROADMAP.MD`: они нарезаны поперёк фаз так, чтобы
цепочка «ссылка → площадка → отбор → Telegram» замкнулась в срезе `0.3.0`, а не
после трёх полностью закрытых фаз. Срез `0.3.0` — это и есть согласованный
MVP-1.

Карточки задач в полной детализации созданы для критического пути — фазы 0 и 1.
Остальные эпики существуют со списком запланированных задач; карточки пишутся
перед стартом своего среза поставки.

## Конвенции имён файлов

| Тип | Паттерн | Пример |
|-----|---------|--------|
| Phase | `{N}-{slug}.md` | `1-kufar-core.md` |
| Epic | `{N-M}-{slug}.md` | `1-4-watermark.md` |
| Task | `{N-M-K}-{slug}.md` | `1-4-2-cursor-persistence.md` |

## Frontmatter

### Phase / Epic / Task — общие
```yaml
id: "1.4"
phase: 1            # epic/task
epic: "1.4"         # task
status: todo        # todo | in_progress | done | blocked | cancelled
sync_state: drifted # aligned | drifted
last_reviewed: YYYY-MM-DD
status_note: "…"
```

### Task — дополнительно
```yaml
roles: [BACK]       # BACK FRONT DB QA DEVOPS PRODUCT
depends_on: ["1.3.2"]
estimated_hours: 3-4
agent: backend-senior
tags: [parser, tdd]
```

Автоблоки `<!-- docs:ops:begin … -->` генерируются `npm run docs:ops:refresh`, вручную не править.

## Роли

| Роль | Зона | Субагент |
|------|------|----------|
| `BACK` | `electron/main/`, воркер, бизнес-логика | `backend-senior` |
| `FRONT` | `app/` — renderer на Nuxt 4 | `frontend-senior` |
| `DB` | Prisma-схема, миграции, индексы | `backend-senior` |
| `QA` | `tests/`, e2e, приёмка | `qa-security` |
| `DEVOPS` | Docker, CI, сборка Electron | `devops-sre` |
| `PRODUCT` | `docs/`, спеки | `product-pm` |

Роль `AI` не заведена: ИИ-агент переписки вынесен за периметр MVP-1.

## Команды docs:ops

```bash
npm run docs:ops:new-session    # файл сессии из шаблона
npm run docs:ops:new-iteration  # файл итерации из шаблона
npm run docs:ops:refresh        # пересобрать status/*.md + автоблоки
npm run docs:ops:check          # проверить консистентность
```

После правок в `docs/` — `refresh` + `check`.

## Порядок чтения для агента

1. `docs/AGENTS.md` — конституция (нерушимые принципы)
2. `docs/ROADMAP.MD` — следующая задача и порядок
3. `docs/RELEASING.md` — release cadence и gate при закрытии среза поставки
4. `docs/tasks/{id}.md` — карточка задачи
5. `docs/epics/{epic}.md` → `docs/phases/{phase}.md` — контекст
6. `docs/superpowers/specs/` — контракт Kufar API и правила матчинга
7. `docs/operations/status/current-state.md` — снимок состояния
