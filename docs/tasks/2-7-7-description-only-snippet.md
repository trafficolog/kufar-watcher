---
id: "2.7.7"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK, QA]
depends_on: ["2.2.2", "2.2.3"]
estimated_hours: 1-2
agent: backend-senior
tags: [audit, matcher, snippet, contract, p2]
---

# Задача 2.7.7 — Snippet только для совпадения в описании

## Проблема

`listing-match-selector` при отсутствии description-hit строил snippet из title. Короткие title маскировали дефект, потому что `matching-snippet` уже возвращал `null`, когда весь title помещался в лимит 160 символов; длинный title проявлял ошибочный fallback. Спецификация требует fragment только когда совпадение найдено в описании, иначе title сам уже объясняет match.

## Реализация

- Удалён fallback `title` из `selectSnippetField`: snippet field теперь выбирается только при include-hit в `description`.
- Алгоритм `matching-snippet`, лимит 160, include/exclude semantics, `matchedTerms` и `matchedIn` не менялись.
- Pipeline regression использует длинный title, чтобы title-only contract не мог снова стать случайно GREEN из-за short-title special case.
- PostgreSQL integration закрепляет persisted `Match.snippet = null` для title-only match.
- Отдельный characterization подтверждает description-only snippet; существующий combined title+description test подтверждает приоритет description.

## Критерии приёмки

- [x] RED: title-only match возвращал ненулевой snippet на длинном title.
- [x] Title-only match после GREEN возвращает `snippet: null`.
- [x] Description-only match строит snippet из description.
- [x] При одновременном title+description match snippet строится из description.
- [x] `matchedTerms` и `matchedIn` не меняют семантику.
- [x] Pipeline integration подтверждает persisted `Match.snippet` contract.

## TDD и проверка

- **RED:** commit `acbaf848f7bd3e8797e3795b62fc98ebfb0df94a`, verify **#1178** (`34745519783`) — 511 тестов GREEN, единственный product failure в новом long-title case: ожидался `snippet: null`, фактически был title fragment вокруг `Candidate`.
- **Implementation:** commit `1452c2e1f8d782dd50bf5a9314b3c0690e42b799` удалил только title fallback из selector.
- **GREEN:** commit `1452c2e1f8d782dd50bf5a9314b3c0690e42b799`, verify **#1180** (`34745573060`) полностью GREEN, включая PostgreSQL matcher-pipeline persistence, build/output verification и оба Electron smoke.
- **Description-only characterization:** commit `d1257db9aaad46359876a967db5c9dabc68f0a9c`, verify **#1182** (`34745730888`) полностью GREEN: явный description-only case сохраняет `matchedTerms=['needle']`, `matchedIn=['description']` и snippet из description; combined title+description case остаётся GREEN.

## Не делать

- Не менять алгоритм длины/границ snippet без отдельной причины.
