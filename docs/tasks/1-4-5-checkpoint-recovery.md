---
id: "1.4.5"
phase: 1
epic: "1.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK, QA]
depends_on: ["1.4.4"]
estimated_hours: 2-3
agent: backend-senior
tags: [watermark, catchup, recovery, remediation]
status_note: "Selective catch-up recovery: restart from top only for synthetic checkpoint WatermarkOrderingError (page 0/index -1); 429/network/timeout/5xx, invalid listTime and real in-page ordering drift propagate without a second traversal. GREEN: verify #867 on d1bef93f592cdfe3d8cdcee3dce7411467b3c450."
---

# Задача 1.4.5 — Узкое восстановление catch-up checkpoint

> Эпик 1.4 · Фаза 1 · ✅ done · зависит от: 1.4.4 · оценка: 2-3 ч

## Цель

Сузить recovery после persisted catch-up checkpoint так, чтобы повторный обход с вершины выполнялся только при действительно протухшем checkpoint, а реальные ошибки источника не маскировались вторым обходом.

## Контекст

После `1.4.4` `runIncrementalMonitor` пытается продолжить обход с `resumeCursor`. Прежняя реализация `traverseWithRecovery` ловила любое исключение и безусловно запускала новый traversal сверху. Это удваивало нагрузку при `429`/network/timeout/5xx и скрывало сигналы schema/order drift.

Checkpoint observation в `watermark-traversal` представляется синтетической предыдущей точкой с `page: 0`, `index: -1`. Только ordering mismatch относительно этой точки означает, что сохранённый checkpoint устарел и безопасно начать обход заново с вершины. Ошибки, возникшие уже внутри полученных страниц, уходят наверх.

## Что сделано

- Введён узкий predicate stale checkpoint recovery только для `WatermarkOrderingError`, у которого `previous.page === 0` и `previous.index === -1`.
- При таком mismatch выполняется ровно один повторный traversal без checkpoint.
- `KufarSourceRequestError` (`429`, network, timeout, `5xx`) пробрасывается без второго traversal.
- `WatermarkListingTimeError` пробрасывается без restart.
- `WatermarkOrderingError` между реальными observations внутри выдачи пробрасывается без restart.
- Произвольный HTTP 4xx по cursor не считается stale checkpoint без подтверждённого Kufar error contract.

## Критерии приёмки

- [x] Stale checkpoint ordering mismatch приводит ровно к одному restart сверху.
- [x] `429`/network/timeout/5xx не вызывают второй traversal.
- [x] Невалидный `listTime` не вызывает второй traversal и сохраняет исходную ошибку.
- [x] Ordering drift внутри реальной страницы не вызывает второй traversal и сохраняет исходную ошибку.
- [x] Полный verify pipeline GREEN.

## TDD и проверка

- RED: `verify #862` на `b722d91f5ffca3bf220bf4a032cd5f46734712f8` — stale-checkpoint сценарий уже проходил, а шесть source/listTime/ordering сценариев падали ровно на лишнем втором `fetchPage`; суммарно 439 passed / 6 failed / 32 skipped.
- GREEN: `verify #867` на чистом `d1bef93f592cdfe3d8cdcee3dce7411467b3c450` — selective recovery predicate и согласованные legacy fixtures прошли documentation consistency, unit tests, CI self-check, typecheck, lint, formatting, PostgreSQL compose integration, build/output и оба Electron smoke.

## Не делать

- Не менять retry/cooldown policy HTTP-клиента или pg-boss.
- Не реализовывать автопаузу — это эпик 4.3.
- Не расширять API cursor contract догадками о неподтверждённых error codes.
