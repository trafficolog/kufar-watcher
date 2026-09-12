---
id: "2.7.5"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["2.3.1"]
estimated_hours: 3-4
agent: backend-senior
tags: [audit, seller, canonical-query, prisma, invariant, p1]
---

# Задача 2.7.5 — Единый источник истины для sellerType

## Проблема

Runtime использует `Monitor.query.sellerType`, но schema одновременно хранит `Monitor.sellerType String?`. Отдельная колонка записывается через `MonitorConfigPatch.sellerType?: string | null` без canonical validation и может молча расходиться с JSON query.

## Реализация

- `Monitor.query.sellerType` — единственный independently writable source; отдельное поле удалено из `MonitorConfigPatch`, Prisma schema и PostgreSQL.
- Write boundary принимает только canonical `null | private | company` и отклоняет остальные значения до `monitor.update` и удаления cursor.
- Migration сохраняет существующий `query.sellerType`, включая явный `null`, при конфликте, потому что именно его использовал runtime; только если JSON-ключ canonical seller отсутствует, переносит `private`/`company` из старой колонки и нормализует `bez-posrednikov` в `private`.
- Backfill меняет эффективный `CanonicalQuery`, поэтому удаляет `MonitorCursor` только у перенесённых legacy-only rows; cursors строк с уже заданным canonical seller сохраняются.
- Неизвестный legacy-only seller останавливает migration вместо молчаливой потери фильтра.
- Development seed хранит полный synthetic `CanonicalQuery`; будущий UI читает и пишет seller только внутри canonical query.

## Критерии приёмки

- [x] Невозможно сохранить `query.sellerType='private'` и независимо `Monitor.sellerType='company'` через поддерживаемый path.
- [x] Невалидные seller values отклоняются до commit.
- [x] Legacy persisted `bez-posrednikov` продолжает читаться по контракту `2.3.1`.
- [x] Миграция существующих rows не теряет эффективный seller filter.
- [x] Cursor reset/preserve semantics зависят от эффективного CanonicalQuery, а не от второго рассинхронизированного поля.
- [x] Data-model и будущий UI contract описывают один source of truth.

## TDD и проверка

- **Typed contract RED:** commit `e91b153544bd1a064df50830ce8cbbc7c59243e0`, verify **#1136** (`34713047160`) — все предыдущие шаги GREEN, typecheck упал только на существующем top-level `MonitorConfigPatch.sellerType`.
- **Persistence RED:** commit `99c9c5f96b5bf55828312c6ade681f951a064caa`, verify **#1137** (`34713096203`) — typecheck/lint/formatting GREEN, PostgreSQL integration показал, что `sellerType='broker'` сохранялся вместо отклонения.
- **Migration RED:** commit `8e1a8ad8dd578f1889819235c75d0e943c1d5b12`, verify **#1138** (`34713209380`) — persistence gate GREEN, оба migration scenarios упали только из-за отсутствующего migration SQL.
- **Migration implementation:** commit `60fb5347b3c3006b734601957cb6207eca38e8fe`; verify **#1139** выявил несовместимость real Kufar host в synthetic seed contract, после чего commit `126eddbe368cfab05d3e3e9689b55a33e2437bb5` вернул fixture-only host без изменения seller semantics.
- **Initial GREEN:** verify **#1140** (`34713459868`) полностью GREEN, включая unit tests, typecheck, lint, formatting, PostgreSQL migration characterization, clean deploy/reset, build и оба Electron smoke.
- **Review RED — precedence:** commit `80b4dbd33c81a3cd20c3d04d05fd9eb1984d189a`, verify **#1143** (`34714052097`) — PostgreSQL characterization показал, что явный canonical `sellerType: null` ошибочно заменялся legacy `company`.
- **Review RED — cursor:** commit `be92d5ecbb0b2689b3276a83e37fc430ba66462c`, verify **#1144** (`34714172111`) — PostgreSQL characterization отдельно показал сохранение cursors обеих backfilled rows.
- **Reviewed GREEN:** commit `77c12d8d9db12bef288879b9584b7175a65e256e`, verify **#1145** (`34714295680`) полностью GREEN; re-review не выявил Critical, Important или Minor findings.

## Не делать

- Не добавлять третий seller-state.
- Не менять подтверждённую Kufar `cmp` семантику.
