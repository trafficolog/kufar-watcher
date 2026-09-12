---
id: "2.7.2"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
status_note: "Single-token term contract, symmetric edge-punctuation normalization and explicit multiword/empty validation implemented; verify #1076 GREEN."
roles: [BACK, QA]
depends_on: ["2.1.1", "2.1.2", "2.2.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, matcher, normalization, validation, p0]
---

# Задача 2.7.2 — Контракт термов и симметричная нормализация

## Проблема

Текст токенизировался с удалением краевой пунктуации, а term компилировался из нормализованной строки целиком. Поэтому `(ps5)` и `ps5` нормализовались несимметрично, а многословный term вроде `playstation 5` молча сравнивался с одним token и никогда не совпадал.

## Решение для текущего среза

MVP работает с отдельными словами и glob-масками, а не с phrase search. Один term теперь обязан нормализоваться ровно в один token. Нулевой или многословный результат отклоняется явной validation error. Term и token используют общий путь нормализации краевой пунктуации, при этом `*` сохраняется как glob-оператор.

## Реализация

- `matching-normalization.ts` использует общий helper для выделения token source и экспортирует term-token normalization с сохранением `*`.
- `compileMatchingTerm()` требует ровно один нормализованный token до literal/glob compilation.
- Include и exclude по-прежнему проходят через один `MatchingTermCompiler`, поэтому validation contract одинаков для обоих списков.
- Внутренняя пунктуация остаётся literal, а существующие leading/trailing/internal glob semantics сохранены.
- `matching-rules.md` явно фиксирует правило «один term = один token» и относит phrase search к внепериметру текущего среза.

## Критерии приёмки

- [x] RED фиксирует текущие failures для краевой пунктуации term и silent multiword term.
- [x] `ps5`, `(ps5)` и token с эквивалентной краевой пунктуацией сравниваются симметрично.
- [x] После нормализации term с пробельным разделением более чем на один token отклоняется явной validation error.
- [x] Glob `playstation*` сохраняет текущую семантику; `*` не съедается punctuation normalization.
- [x] Include и exclude используют одинаковый compiler contract.
- [x] Пустой term после нормализации остаётся ошибкой.
- [x] Спецификация и будущая UI-подсказка явно говорят: один term = один token в текущем срезе.

## TDD evidence

- RED: verify #1071, run `34692212183`, head `568366064618162fb936de4c7e891c86a6860883` — 7 новых ожидаемых failures по edge punctuation, multiword/empty validation и include/exclude; 490 существующих тестов прошли.
- Final code GREEN: verify #1076, run `34692759388`, head `8e6e202ba74c2595fc4b995734ab246c4fc5dfda` — dependency audit, docs consistency, 497 unit tests, CI self-check, typecheck, lint, formatting, PostgreSQL integration, build/output и оба Electron smoke прошли.

## Не делать

- Не добавлять phrase search или regex.
- Не смешивать эту задачу с морфологией эпика `2.6`.
