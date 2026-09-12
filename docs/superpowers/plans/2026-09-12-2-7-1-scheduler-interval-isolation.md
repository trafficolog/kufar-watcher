# План реализации 2.7.1 — Валидация интервала и изоляция scheduler startup

> **Дата:** 2026-09-12  
> **Ветка:** `feat/2.7.1-scheduler-interval-isolation`  
> **База:** `main@7472749e25f0504ab52c75988ed1725a86886b94`

## Цель

Закрыть подтверждённый аудитом P0-дефект: повреждённый `intervalSec` одного монитора не должен обрывать startup scheduler для остальных, а новые неподдерживаемые интервалы должны отсеиваться на application и database boundaries без silent fallback.

## Контракт

Поддерживаются только `60`, `120`, `300`, `600`, `900`, `3600` секунд с существующим cron mapping. Значение вне набора — `UnsupportedMonitorIntervalError`. Никакой адаптивной подмены интервала нет.

Для PostgreSQL используется `CHECK (... IN (...)) NOT VALID`: это не переписывает и не блокирует существующие legacy rows при миграции, но ограничивает новые insert/update операции. Очистка/нормализация legacy данных в этот инкремент не входит.

## Шаг 1 — Application RED

**Файл:** `tests/unit/monitor-interval-remediation.test.ts`

Зафиксировать три наблюдаемых дефекта:

1. invalid active monitor перед valid sibling обрывает `start()`;
2. invalid `syncMonitor()` не имеет typed error/no-side-effect контракта;
3. monitor config write принимает unsupported interval.

Подтвердить RED canonical CI до production-кода.

## Шаг 2 — Единый interval contract и scheduler isolation

**Файлы:**

- `shared/monitor-interval.ts`
- `electron/worker/monitor-scheduler.ts`
- `electron/worker/monitor-config-persistence.ts`
- `electron/worker/worker-application.ts`

Реализовать:

- единый список интервалов и cron mapping;
- `UnsupportedMonitorIntervalError`;
- validation до queue/write side effects;
- per-monitor `try/catch` только в startup reconciliation;
- observable journal callback в worker composition;
- explicit `syncMonitor()` сохраняет ошибку вызывающему коду.

Не проглатывать системные ошибки `queue.start()` и не менять interval автоматически.

## Шаг 3 — PostgreSQL RED → GREEN

**Файлы:**

- `tests/integration/monitor-config-persistence.test.ts`
- `prisma/migrations/20260912112500_monitor_interval_constraint/migration.sql`
- `scripts/verify-postgres-compose.sh`

Сначала потребовать отсутствующий constraint через canonical PostgreSQL suite. После подтверждённого RED добавить custom migration:

```sql
ALTER TABLE "Monitor"
ADD CONSTRAINT "Monitor_intervalSec_supported_check"
CHECK ("intervalSec" IN (60, 120, 300, 600, 900, 3600))
NOT VALID;
```

Integration должен доказать:

- constraint deployed и остаётся `NOT VALID`;
- legacy row с `180` можно сохранить через migration path без auto-fix;
- новый `180` запрещён;
- новый supported `300` разрешён;
- `db:reset` повторно разворачивает все миграции.

## Шаг 4 — Проверка и документационное закрытие

Запустить полный canonical verify: dependency audit, docs consistency, unit, failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, build outputs и оба Electron smoke.

После GREEN отметить `2.7.1` как `done/aligned`, обновить docs rollups штатным `docs:ops:refresh`, удалить временный helper workflow и выполнить ещё один exact-tree canonical verify перед PR.

## TDD evidence

- Application RED: `verify #1058`, run `34690294883`, SHA `2fd8b316ccb3f47a00b7969ed7e83a55ebdf98cb`.
- DB RED: `verify #1064`, run `34690701487`, SHA `96155653eb6255f5ed33752920a061b3a599e6fa`.
- First full code GREEN: `verify #1066`, run `34690830954`, SHA `2908d963e123b38ec90a58bcac64021671a19b59`.
