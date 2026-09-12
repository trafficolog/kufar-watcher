---
id: "2.7.4"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["2.4.3"]
estimated_hours: 3-5
agent: backend-senior
tags: [audit, run, lifecycle, prisma, recovery, p1]
---

# Задача 2.7.4 — Целостность жизненного цикла Run

## Проблема

`Run.outcome` — свободная строка, а процесс создаёт `outcome='running'` до обхода. При аварийном завершении процесса строка может навсегда остаться running с `finishedAt=null`, что исказит health-метрики следующих фаз.

## Что сделать

- Зафиксировать конечный допустимый набор outcome на уровне типов и БД.
- Определить отдельное terminal состояние для orphaned/incomplete run после process death (`interrupted`/`aborted` — название выбрать в design).
- На старте worker выполнять узкое восстановление stale `running` строк прошлой process incarnation до запуска расписаний.
- Заполнять terminal metadata (`finishedAt`, duration/error category) без имитации успеха.

## Критерии приёмки

- [ ] БД не принимает произвольный `Run.outcome`.
- [ ] Нормальный running run не помечается orphan преждевременно.
- [ ] Stale running row после имитированного crash переводится в документированное terminal состояние.
- [ ] Recovery идемпотентен и безопасен при повторном старте.
- [ ] PostgreSQL integration покрывает orphan row и повторный recovery.
- [ ] Data-model spec перечисляет фактические outcome и их смысл для health consumers.

## Не делать

- Не удалять orphan rows.
- Не считать interrupted run успешным или skipped.
