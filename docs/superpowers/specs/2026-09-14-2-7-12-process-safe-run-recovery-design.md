# Design: 2.7.12 Process-safe Run orphan recovery

Дата: 2026-09-14

## Контекст

`2.7.4` ввела lifecycle `Run.outcome='running'` → terminal outcome и startup recovery незавершённых строк. Текущий `worker-application` перед `scheduler.start()` выполняет один глобальный `UPDATE` всех строк `Run`, для которых `outcome='running' AND finishedAt IS NULL`, переводя их в `interrupted`.

`2.7.6` позже усилила другой инвариант: один monitor не может одновременно выполняться в двух executor/process contexts. Перед созданием `Run(outcome='running')` executor получает process-independent PostgreSQL session-level advisory lock на ключе `(MONITOR_RUN_LOCK_NAMESPACE, monitorId)` и удерживает dedicated PostgreSQL session до terminal завершения Run. Если lock занят, новый traversal не стартует и получает `skipped-overlap`. При crash/disconnect PostgreSQL автоматически освобождает session-level advisory lock.

После появления `2.7.6` startup recovery `2.7.4` стал недостаточно строгим: второй живой worker process может выполнить глобальный recovery и пометить `interrupted` строку `Run`, которая всё ещё принадлежит traversal первого process и защищена его advisory lock.

## Цель

Сделать orphan recovery process-safe, сохранив существующие свойства:

- live Run другого process нельзя преждевременно перевести в terminal состояние;
- orphan Run после crash должен быть восстановлен в `interrupted` при следующем startup;
- recovery остаётся до `scheduler.start()` и fail-closed на настоящих инфраструктурных ошибках;
- один и тот же durable ownership primitive используется и для no-overlap, и для доказательства orphan;
- не вводятся heartbeat, TTL, clock-based lease, worker registry или глобальный worker mutex без отдельной необходимости.

## Решение

Использовать существующий per-monitor PostgreSQL advisory lock как единственный liveness/ownership oracle для recovery.

Recovery больше не делает глобальный blind `UPDATE`. Вместо этого он:

1. читает `DISTINCT monitorId` среди незавершённых строк `Run` с `outcome='running' AND finishedAt IS NULL`;
2. для каждого monitor ID пытается получить тот же `AcquireMonitorRunLease`, который использует scheduled executor;
3. если lease **занят**, recovery считает ownership недоказанным и не изменяет строки этого monitor;
4. если lease **получен**, recovery удерживает его и переводит все всё ещё незавершённые `running` строки этого monitor в `interrupted`;
5. release выполняется только после завершения UPDATE, в `finally`.

Ключевое правило: **наличие `running` row само по себе не является доказательством orphan. Доказательством является возможность recovery получить canonical per-monitor advisory lease и удерживать его во время terminal update.**

## Почему это безопасно

### Live owner

Scheduled executor сначала получает advisory lease, затем создаёт `Run(outcome='running')`, выполняет traversal и terminal persistence, и только после этого освобождает lease.

Если другой worker стартует во время этого traversal, recovery увидит `running` row, но `pg_try_advisory_lock` для того же monitor вернёт `false`. Recovery пропускает monitor, поэтому live Run остаётся `running`.

### Crash owner

Если owning process аварийно завершается, dedicated PostgreSQL session закрывается/теряется, и session-level advisory lock автоматически освобождается. `Run` может остаться `running`, но следующий recovery сможет получить advisory lease и безопасно перевести row в `interrupted`.

### TOCTOU между liveness-check и UPDATE

Recovery не делает отдельную «проверку lock → отпустить → UPDATE». Он удерживает advisory lease до окончания UPDATE. Поэтому после успешного acquisition новый executor того же monitor не может получить ownership и создать новый active Run до завершения recovery.

UPDATE дополнительно сохраняет predicate `outcome='running' AND finishedAt IS NULL`, поэтому строки, успевшие стать terminal до момента SQL mutation, не изменяются.

### Несколько recovery contexts

Два worker startup одновременно могут увидеть один и тот же monitor ID. Только один получит canonical advisory lease. Второй увидит занятый lease и не выполнит mutation. После release повторный recovery остаётся идемпотентным, потому что уже terminal rows больше не входят в predicate.

### Разные мониторы

Lease key включает `monitorId`, поэтому recovery одного monitor не создаёт глобальный mutex. Разные monitor IDs могут независимо принадлежать другим live executors или recovery contexts.

## Компоненты и границы

### `electron/worker/monitor-run-lease.ts`

Остаётся единственным модулем, определяющим canonical per-monitor ownership primitive.

Допустимо вынести/экспортировать только минимально необходимую общую часть для production recovery, но нельзя создавать второй namespace или отдельную lock policy для recovery.

Production recovery всегда получает `createPostgresMonitorRunLeaseAcquirer(config.databaseUrl)` из worker wiring. Он не выбирает local fallback по внутреннему состоянию Prisma client. Local in-memory lease разрешён только как явно инъектированная test dependency для unit isolation. Process-safe acceptance проверяется исключительно на реальном PostgreSQL lease.

### Новый `electron/worker/monitor-run-recovery.ts`

Новый focused module владеет recovery algorithm и SQL mutation.

Предпочтительный публичный контракт:

```ts
export interface RecoverInterruptedMonitorRunsOptions {
  prisma: PrismaClient
  acquireMonitorRunLease: AcquireMonitorRunLease
}

export function recoverInterruptedMonitorRuns(
  options: RecoverInterruptedMonitorRunsOptions,
): Promise<void>
```

Модуль отвечает только за:

- выбор monitor IDs с candidate orphan rows;
- acquisition/release lease;
- conditional terminal update;
- сохранение существующей семантики полей `interrupted`.

Он не запускает scheduler, не создаёт queues и не знает про source traversal.

### `electron/worker/worker-application.ts`

`worker-application` остаётся orchestration boundary:

1. default production dependency создаёт recovery lease acquirer напрямую из `config.databaseUrl`;
2. вызывает process-safe recovery;
3. только после успешного завершения запускает scheduler;
4. затем запускает остальные runtime services как сегодня.

Глобальный blind SQL recovery удаляется из `worker-application`.

`config.databaseUrl` уже является canonical worker DB connection source для Prisma/queue stack, поэтому recovery и scheduled executor адресуют одну PostgreSQL instance и один advisory-lock namespace. Test doubles могут инжектировать lease acquirer явно, чтобы unit tests не требовали PostgreSQL.

## Terminal mutation

При доказанном orphan текущая семантика `2.7.4` сохраняется:

- `finishedAt = recoveredAt`;
- `durationMs` вычисляется от `startedAt`, clamp в диапазон `0..2147483647`;
- `outcome = interrupted`;
- `error = 'Worker process interrupted before Run completion'`;
- `errorCategory = 'internal'`;
- `errorCode = 'worker-interrupted'`.

Не меняются `seen`, `matched`, `httpStatus` и `degradedLevel`, если существующий recovery их не меняет.

Один acquisition для monitor может закрыть несколько stale `running` rows этого monitor. Это допустимо: canonical no-overlap invariant означает, что live ownership у monitor может быть только одно; если recovery владеет lease, ни одна из этих строк не может принадлежать текущему live traversal.

## Ошибки и startup policy

### Lease занят

`acquireMonitorRunLease(monitorId) -> null` — нормальная ветка, а не startup failure. Она означает: recovery не имеет права объявить строки этого monitor orphan. Worker продолжает recovery других monitor IDs и затем может запускать scheduler.

### DB read/update error

Ошибка чтения candidate monitor IDs или UPDATE — инфраструктурная failure. `start()` отклоняется, `scheduler.start()` не вызывается. Сохраняется fail-closed policy `2.7.4`.

### Lease infrastructure error

Ошибка `connect/query/end`, отличная от нормального `null` при занятом lock, также считается startup failure. Recovery не должен молча превращать невозможность проверить ownership в «monitor жив» или «monitor orphan».

### Release error

Release выполняется в `finally`. Ошибка release не должна маскировать уже возникшую основную recovery error; если mutation прошла, но release не удался, startup должен завершиться ошибкой, потому что ownership lifecycle не был подтверждён корректно. Закрытие PostgreSQL session остаётся canonical release mechanism.

## TDD и проверка

### PostgreSQL RED characterization

Главный RED должен использовать реальные независимые PostgreSQL contexts и настоящий advisory lease:

1. создать monitor и `Run(outcome='running')`;
2. context A получить canonical lease этого monitor и удерживать его barrier'ом;
3. context B запустить startup recovery;
4. доказать, что Run остаётся `running`, а recovery B не блокируется навечно;
5. освободить/закрыть session A, имитируя owner crash/release;
6. снова запустить recovery B;
7. доказать terminal `interrupted` с существующими `worker-interrupted` полями.

Этот тест должен падать на текущем global blind UPDATE ровно потому, что context B преждевременно переводит live row в `interrupted`.

### Дополнительные PostgreSQL assertions

- пока recovery удерживает lease одного monitor во время mutation/barrier, третий acquisition того же monitor возвращает `null`;
- другой monitor ID остаётся независимо acquireable;
- terminal Run не изменяется;
- повторный recovery идемпотентен;
- несколько stale `running` rows одного monitor закрываются одним доказанным ownership window;
- два concurrent recovery contexts не выполняют конфликтующий terminal ownership одного monitor.

### Unit tests

- `worker-application.start()` вызывает recovery до `scheduler.start()`;
- scheduler не запускается при recovery infrastructure failure;
- занятый lease конкретного monitor не считается общей startup failure;
- lease всегда release'ится после successful/failed mutation path;
- local injected lease позволяет unit isolation без PostgreSQL.

### Canonical verification

Финальный exact-head verify обязан пройти:

- documentation consistency;
- unit tests;
- typecheck/lint/formatting;
- PostgreSQL compose integration с новым multi-context characterization;
- build/output verification;
- development и production Electron smoke.

## Документация

Реализация оформляется отдельной task-card `2.7.12 — Process-safe Run orphan recovery`.

После появления карточки epic `2.7` временно становится `in_progress/drifted` с `11/12 done`, после GREEN/review возвращается в `done/aligned` с `12/12 done`.

`2.7.4` остаётся исторически правдивой карточкой исходного lifecycle recovery и получает только ссылку/примечание, что multi-process ownership safety усилена в `2.7.12`; не переписывается так, будто первоначальная задача уже содержала advisory-aware recovery.

`2.7.6` остаётся источником process-independent no-overlap semantics и при необходимости получает cross-link на повторное использование lease в recovery.

Data-model/lifecycle spec обновляется только если там есть утверждение, что любой `running` row на startup автоматически orphan. Новых полей Prisma schema эта задача не требует.

## Не делать

- не добавлять `ownerId`, `workerId`, heartbeat, `expiresAt`, TTL или clock-based lease;
- не вводить глобальный singleton lock на весь worker;
- не создавать второй advisory-lock namespace для recovery;
- не менять pg-boss scheduling policy;
- не считать возраст `Run.startedAt` доказательством orphan;
- не завершать live Run только потому, что другой worker выполнил startup;
- не менять outcome vocabulary или health semantics за пределами `running → interrupted` orphan recovery.

## Альтернативы, которые отклонены

### Persisted owner/heartbeat/TTL

Даёт явное ownership в таблице, но требует schema migration, heartbeat loop, expiry policy, clock semantics и split-brain решений. При уже существующем session advisory lock это дублирует canonical ownership mechanism и нарушает YAGNI.

### Global worker singleton advisory lock

Устраняет cross-worker recovery race ценой запрета любых параллельных worker contexts. Это сильнее требуемого инварианта и ломает существующую per-monitor concurrency модель.

## Критерии готовности дизайна

Дизайн считается реализованным, когда одновременно доказано:

- live Run под advisory ownership другого process не изменяется startup recovery;
- после потери owner session тот же row восстанавливается в `interrupted`;
- recovery удерживает canonical lease на всём интервале orphan mutation;
- новые traversal того же monitor не могут вклиниться между ownership proof и UPDATE;
- разные monitors независимы;
- startup остаётся fail-closed на настоящих recovery infrastructure errors;
- схема БД и pg-boss policy не усложнены без необходимости.
