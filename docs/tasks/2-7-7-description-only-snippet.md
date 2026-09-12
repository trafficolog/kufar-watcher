---
id: "2.7.7"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, QA]
depends_on: ["2.2.2", "2.2.3"]
estimated_hours: 1-2
agent: backend-senior
tags: [audit, matcher, snippet, contract, p2]
---

# Задача 2.7.7 — Snippet только для совпадения в описании

## Проблема

`listing-match-selector` при отсутствии description-hit строит snippet из title. Спецификация требует fragment только когда совпадение найдено в описании, иначе title сам уже объясняет match.

## Критерии приёмки

- [ ] RED: title-only match сейчас возвращает ненулевой snippet.
- [ ] Title-only match после GREEN возвращает `snippet: null`.
- [ ] Description-only match строит snippet из description.
- [ ] При одновременном title+description match snippet строится из description.
- [ ] `matchedTerms` и `matchedIn` не меняют семантику.
- [ ] Pipeline integration подтверждает persisted `Match.snippet` contract.

## Не делать

- Не менять алгоритм длины/границ snippet без отдельной причины.
