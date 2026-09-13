---
id: "2.7.6"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK, DB, QA]
depends_on: ["2.4.2", "2.7.4"]
estimated_hours: 4-6
agent: backend-senior
tags: [audit, scheduler, locking, postgres, restart, p1]
---

# Задача 2.7.6 — Process-independent запрет пересечения обходов

## Проблема

Исходный overlap guard — `Set<number>` внутри одного executor instance. Он не являлся межпроцессным инвариантом: два executor contexts с независимыми Prisma clients могли одновременно запустить traversal одного monitor id.

## Реализация

- Characterization с двумя независимыми executor/database contexts подтвердил реальный gap: второй context получал обычный `cold-start`, пока первый traversal удерживался barrier'ом.
- Durable ownership реализован через PostgreSQL session-level advisory lock на отдельном `pg.Client`: стабильный namespace + `monitorId`, `pg_try_advisory_lock` без ожидания и одна выделенная DB-session на время traversal.
- Реальный Prisma client сохраняет canonical connection source в factory; executor использует его для durable lease. Test doubles без реального DB connection сохраняют локальный lease для unit isolation.
- Если ownership уже занят, executor не создаёт `running` Run и не входит в traversal: он записывает terminal `skipped` row и возвращает `skipped-overlap`.
- Release выполняется закрытием выделенной PostgreSQL session в `finally`. Session-level advisory locks автоматически освобождаются при завершении session, включая аварийный disconnect, поэтому crash/restart не создаёт stale permanent ownership.
- Lock key включает `monitorId`, поэтому разные мониторы не используют глобальный mutex и не блокируют друг друга.
- Стандартная pg-boss policy не менялась: characterization доказал gap на run boundary, и минимальный durable primitive добавлен именно туда.

## Критерии приёмки

- [x] RED воспроизводит конкурентный запуск одного monitor id из двух независимых contexts.
- [x] Только один traversal получает durable ownership.
- [x] Второй запуск не выполняет source/detail requests и получает `skipped-overlap` terminal результат.
- [x] Crash/restart не оставляет вечный lock: ownership привязан к PostgreSQL session и снимается при disconnect.
- [x] Разные monitor ids не блокируют друг друга благодаря отдельному advisory key на `monitorId`.
- [x] PostgreSQL integration проверяет cross-client concurrency.

## TDD и проверка

- **Initial RED:** commit `1f07488957e34fc06ab095d022b5eb9e9e64e0a4` доказал два concurrent traversal; первоначальный teardown дополнительно проявлял watermark race (`StaleColdStartError`).
- **Clean RED:** commit `89558b9d3d711a502e2d0ab080d2db0d89f8f3e5`, verify **#1152** (`34718038740`) — documentation/unit/typecheck/lint/formatting GREEN, PostgreSQL integration получил второй нормальный `cold-start` вместо `skipped-overlap`.
- **Implementation:** commits `02690b1bc4db604e14e7c8729e5e06b8f47d2aed`, `6e1d1000e92bd666f91bdeab7c031629a3f5969b`, `7d46465d71ab2d46f9958b0de682dedef982c92f` добавили dedicated session advisory lease, сохранили canonical Prisma connection source и перенесли executor ownership на durable boundary.
- **GREEN:** commit `7d46465d71ab2d46f9958b0de682dedef982c92f`, verify **#1158** (`34744653826`) полностью GREEN: dependency/docs checks, unit tests, typecheck, lint, formatting, PostgreSQL cross-client characterization, build/output verification и оба Electron smoke.
- **Design verification:** актуальная PostgreSQL документация подтверждает, что session-level advisory lock живёт до explicit unlock/disconnect и освобождается при завершении session даже при ungraceful disconnect; `node-postgres` dedicated `Client` даёт явный lifecycle `connect` → hold → `end`.

## Не делать

- Не вводить глобальный mutex на все мониторы.
- Не менять pg-boss scheduling policy без отдельного доказанного queue-level gap.
