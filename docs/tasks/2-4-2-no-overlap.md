---
id: "2.4.2"
phase: 2
epic: "2.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
status_note: "Per-monitor overlap guard реализован в scheduled executor: занятый monitor получает Run(outcome=skipped), разные monitor id не блокируются, lock освобождается в finally. GREEN: verify #804 на a779ee224c14474fe8eaf0afb30a70326fc197b2."
roles: [BACK]
depends_on: ["2.4.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [scheduler, concurrency]
---

# Задача 2.4.2 — Запрет пересечения обходов одного монитора

> Эпик 2.4 · Фаза 2 · ✅ done · зависит от: 2.4.1 · оценка: 2-3 ч

## Цель

Не запускать второй обход монитора, пока первый ещё идёт.

## Контекст

Даже при небольшом числе мониторов медленная сеть может сделать обход длиннее интервала. Параллельные обходы одного правила ломают водяной знак и создают лишнюю нагрузку на Kufar.

## Что должно быть сделано

- Ввести per-monitor lock на время обхода
- Если очередной trigger пришёл при занятом lock — записать пропуск в `Run`, новый обход не запускать
- Освобождать lock в `finally`
- Покрыть тестом два одновременных trigger

## Критерии приёмки

- [x] Два trigger одного монитора не выполняются параллельно
- [x] Пропущенный trigger виден в журнале
- [x] После ошибки lock освобождается

## TDD и проверка

- Overlap RED: `verify #801` на `e3ec69281a39b36bf2da11f2de760f635f1dbdfc` — второй trigger того же monitor всё ещё запускал обычный cycle; 419 остальных tests GREEN.
- Первый GREEN: `verify #802` на `872fbbb8758ac7ca54a9d9c2309bce595c9734e7` — overlap пропускается, `Run(outcome=skipped)` записывается, полный pipeline GREEN.
- Release-on-error RED: `verify #803` на `04ee7241d40aae589350821ebb2239213015aa6d` — после ошибки monitor оставался locked; different-monitor concurrency при этом уже GREEN.
- Финальный GREEN: `verify #804` на `a779ee224c14474fe8eaf0afb30a70326fc197b2` — lock освобождается в `finally`; unit/static, PostgreSQL compose integration, build/output и оба Electron smoke GREEN.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не сериализовать разные мониторы: ограничение только на один monitor id
