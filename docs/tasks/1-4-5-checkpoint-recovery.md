---
id: "1.4.5"
phase: 1
epic: "1.4"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-10
roles: [BACK, QA]
depends_on: ["1.4.4"]
estimated_hours: 2-3
agent: backend-senior
tags: [watermark, catchup, recovery, remediation]
status_note: "Review remediation: recovery from a persisted catch-up checkpoint must restart from the top only for a stale checkpoint ordering mismatch; transport/rate-limit/schema/order errors must propagate without a second traversal."
---

# Задача 1.4.5 — Узкое восстановление catch-up checkpoint

> Эпик 1.4 · Фаза 1 · 🔄 in_progress · зависит от: 1.4.4 · оценка: 2-3 ч

## Цель

Сузить recovery после persisted catch-up checkpoint так, чтобы повторный обход с вершины выполнялся только при действительно протухшем checkpoint, а реальные ошибки источника не маскировались вторым обходом.

## Контекст

После `1.4.4` `runIncrementalMonitor` пытается продолжить обход с `resumeCursor`. Текущая реализация `traverseWithRecovery` ловит любое исключение и безусловно запускает новый traversal сверху. Это удваивает нагрузку при `429`/network/timeout/5xx и скрывает сигналы schema/order drift.

Checkpoint observation в `watermark-traversal` представляется синтетической предыдущей точкой с `page: 0`, `index: -1`. Только ordering mismatch относительно этой точки означает, что сохранённый checkpoint устарел и безопасно начать обход заново с вершины. Ошибки, возникшие уже внутри полученных страниц, должны уходить наверх.

## Что должно быть сделано

- Ввести узкий predicate stale checkpoint recovery для `WatermarkOrderingError`, у которого `previous.page === 0` и `previous.index === -1`.
- При таком mismatch выполнить ровно один повторный traversal без checkpoint.
- `KufarSourceRequestError` (`429`, network, timeout, `5xx` и прочие) не должен запускать restart.
- `WatermarkListingTimeError` не должен запускать restart.
- `WatermarkOrderingError`, возникший между реальными observations внутри выдачи, не должен запускать restart.
- Не считать произвольный HTTP 4xx по cursor доказательством stale checkpoint без подтверждённого Kufar error contract.

## Критерии приёмки

- [ ] Stale checkpoint ordering mismatch приводит ровно к одному restart сверху.
- [ ] `429`/network/timeout/5xx не вызывают второй traversal.
- [ ] Невалидный `listTime` не вызывает второй traversal и сохраняет исходную ошибку.
- [ ] Ordering drift внутри реальной страницы не вызывает второй traversal и сохраняет исходную ошибку.
- [ ] Полный verify pipeline GREEN.

## TDD

Сначала тесты, фиксирующие все четыре ветки поведения, затем минимальная production-правка.

## Не делать

- Не менять retry/cooldown policy HTTP-клиента или pg-boss.
- Не реализовывать автопаузу — это эпик 4.3.
- Не расширять API cursor contract догадками о неподтверждённых error codes.
