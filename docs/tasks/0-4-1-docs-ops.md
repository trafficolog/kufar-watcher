---
id: "0.4.1"
phase: 0
epic: "0.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-06
roles: [PRODUCT]
depends_on: ["0.1.1"]
estimated_hours: 1-2
agent: product-pm
tags: [docs, tooling]
---

# Задача 0.4.1 — Внедрение docs-ops CLI и npm-скриптов

> Эпик 0.4 · Фаза 0 · ✅ done · зависит от: 0.1.1 · оценка: 1-2 ч

## Цель

Подключить CLI сводок документации и убедиться, что дерево проходит проверку.

## Контекст

Дерево планирования из шести фаз и двадцати семи эпиков вручную в согласованном состоянии не удержать. Сводки должны генерироваться, а не поддерживаться.

## Что должно быть сделано

- Разместить CLI в `src/docs-ops/cli.ts`
- Добавить npm-скрипты `docs:ops:refresh`, `docs:ops:check`, `docs:ops:new-session`, `docs:ops:new-iteration`
- Прогнать `refresh` и `check`, убедиться в заполнении автоблоков и сводок

## Критерии приёмки

- [x] `npm run docs:ops:check` завершается без ошибок
- [x] `npm run docs:ops:refresh` заполняет автоблоки в файлах фаз и эпиков
- [x] В `docs/operations/status/` появляются сводные файлы

## Подсказки

- Механика описана в справочнике docs-ops скилла spec-driven-planning

## Не делать

- Не редактировать содержимое автоблоков и файлы сводок вручную
