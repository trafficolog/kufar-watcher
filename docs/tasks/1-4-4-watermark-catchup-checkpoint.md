---
id: "1.4.4"
phase: 1
epic: "1.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-09
roles: [BACK, DB]
depends_on: ["1.4.2", "1.4.3"]
estimated_hours: 4-6
agent: backend-senior
tags: [core, idempotency, tdd, remediation]
---

# Задача 1.4.4 — Персистентный catch-up checkpoint водяного знака

> Эпик 1.4 · Фаза 1 · ✅ done · зависит от: 1.4.2, 1.4.3 · remediation по результатам phase review

## Цель

Сделать page-capped incremental traversal сходящимся между несколькими циклами: глубокий разрыв после простоя должен дочитываться по сохранённому checkpoint, а подтверждённый watermark не должен продвигаться до фактического достижения старой границы.

## Контекст

Phase review обнаружил liveness-gap в безопасном поведении `maxPages`: при исчерпании лимита обход корректно оставлял подтверждённый watermark неизменным, но следующий цикл снова начинался с первой страницы. Если старая граница находилась глубже лимита, алгоритм мог бесконечно перечитывать верх выдачи и никогда не добраться до неё.

Исправление сохраняет гарантии задач 1.4.1–1.4.3: курсор площадки остаётся opaque, `Match` остаётся идемпотентным, watermark продвигается атомарно с результатами, а cold start не меняет baseline-политику.

## Что сделано

- `WatermarkTraversalResult` переведён на discriminated union `complete/incomplete`; incomplete-результат хранит tentative watermark только в `checkpoint.pendingWatermark` и возвращает неизменный подтверждённый `nextWatermark`.
- Добавлен `WatermarkCatchupCheckpoint` с opaque `resumeCursor`, pending watermark и последним наблюдением для проверки порядка между chunk-ами.
- Incremental traversal умеет продолжать с persisted checkpoint, накапливает timestamp ties через границы chunk-ов и делает монотонный progress при разрыве глубже одного `maxPages`.
- Добавлен явный `WatermarkListingTimeError`; невалидный `Listing.listTime` отклоняется и в incremental, и в cold-start traversal до участия в сравнении дат.
- `MonitorCursor` расширен пятью checkpoint-полями; migration `20260909110000_watermark_catchup_checkpoint` добавляет их и PostgreSQL `CHECK`-ограничения для парных nullable-инвариантов.
- `commitMonitorRun` принимает весь traversal result: incomplete commit атомарно пишет `Listing + Match + checkpoint + Run(catchup)`, не меняя подтверждённую границу; complete commit продвигает watermark и очищает checkpoint.
- Persisted checkpoint восстанавливается в orchestration; ошибка resume запускает ровно одну fresh-from-top попытку с тем же подтверждённым watermark. Если fresh attempt тоже падает, commit не выполняется.
- Порядок `prefilter → description loader → selector` из 1.5.2 сохранён и применяется одинаково к complete и incomplete chunk-ам.
- Source/query reset и реактивация archived monitor удаляют checkpoint вместе со всем `MonitorCursor`; non-source edits и transaction rollback сохраняют checkpoint.

## Критерии приёмки

- [x] Разрыв глубже `maxPages` делает persisted progress между циклами вместо постоянного чтения page 1
- [x] Подтверждённый watermark не продвигается на incomplete chunk
- [x] `Listing`, `Match`, `Run` и checkpoint пишутся атомарно; stale cursor revision по-прежнему отклоняет commit
- [x] Completion продвигает accumulated pending watermark и очищает checkpoint
- [x] Opaque resume cursor не декодируется и не синтезируется
- [x] Ошибка persisted resume приводит максимум к одной fresh-from-top попытке; двойной failure ничего не коммитит
- [x] Timestamp ties и ordering continuity корректны через границы chunk-ов
- [x] Невалидный `listTime` отклоняется явной ошибкой в incremental и cold-start paths
- [x] Source/query reset удаляет checkpoint, non-source edits его сохраняют
- [x] Политика загрузки описания и selection order не изменены

## TDD и проверка

- Traversal RED: commit `812e8e585dcfed80522dc6de5a9a6056069a7784`, GitHub Actions `verify #600` — ожидаемые failures до checkpoint-aware реализации.
- Traversal GREEN: commit `9bf815633bd47426dcf67d0fcb0fe6ceb2cddcec` (`feat: add watermark catch-up traversal checkpoint`) с последующими contract-alignment тестами.
- Schema RED: commit `7eab54ae23c335fc4568147e6bba9cfe7ccb2e28`, `verify #624` — ожидаемый failure на отсутствующих checkpoint-полях.
- Persistence RED: commits `cfe94f0add21734bc807812b69d314a03157a7ae` и `1af6d89524b65048ed613b12f86dff3773b8d6c9`, `verify #632` — typecheck подтвердил новый `traversal` contract до production-реализации.
- Persistence GREEN: commit `84b7fede1ac2e9c5c7aa128447cc0dda6053cbb6` (`feat: commit watermark catch-up chunks atomically`).
- Orchestration RED: commit `2af0231f7044a1e99ce8375678b167500472b086`, `verify #635` — ровно четыре новых resume/fallback/malformed-state сценария были красными.
- Orchestration GREEN: commit `27299c07af86ae05ab9d0cc35d0e82841e4f9366`; policy/reset coverage завершена commits `e9a66571f4b8a76f8993cfb43a6df3d160fbd507` и `63586d56531b3addadde31a4c49ea4aa9a759332`.
- Production-code GREEN: exact-head `c9ccaad67a6a5aaaadb75a45380a1b1146714743`, GitHub Actions `verify #644` — GREEN по docs consistency, unit, CI failure self-check, typecheck, lint, formatting, PostgreSQL compose integration, build/output verification, development smoke и production smoke.

## Подсказки

- Design: `docs/superpowers/specs/2026-09-09-watermark-catchup-checkpoint-design.md`
- Implementation plan: `docs/superpowers/plans/2026-09-09-watermark-catchup-checkpoint.md`

## Не делать

- Не добавлять scheduler overlap prevention — это задача 2.4.2
- Не добавлять user-facing degraded-state UI в рамках этой remediation
- Не менять keyword matcher, Telegram или notification policy
- Не интерпретировать и не конструировать marketplace pagination cursor
