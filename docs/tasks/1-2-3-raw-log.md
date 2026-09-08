---
id: "1.2.3"
phase: 1
epic: "1.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-08
roles: [BACK]
depends_on: ["1.2.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [debug, drift]
---

# Задача 1.2.3 — Журнал сырых ответов для отладки дрейфа

> Эпик 1.2 · Фаза 1 · ✅ done · зависит от: 1.2.2 · оценка: 2-3 ч

## Цель

Сохранять сырые ответы площадки с ограничением по объёму, чтобы при изменении структуры было что сравнивать.

## Что сделано

- Успешные `2xx`-ответы HTTP-клиента могут записываться в локальный filesystem journal без изменения retry/error policy.
- Endpoint определяется как `host + pathname`; query и fragment не создают отдельные buckets.
- На каждый endpoint хранится не более пяти последних snapshot-файлов; старые вытесняются.
- Snapshot хранит versioned envelope и точное тело ответа в `bodyBase64`; экспорт восстанавливает исходные bytes без парсинга или нормализации.
- Корень journal вычисляется в main process от `app.getPath('userData')/raw-responses` и передаётся utility worker через typed startup argument.
- Ошибка journal не превращает успешный HTTP-ответ в failure и не запускает retry; наружу передаётся только безопасное warning-сообщение без raw body.

## Критерии приёмки

- [x] Успешный ответ сохраняется через HTTP-client journal hook; будущий traversal передаёт ему journal из worker storage config, не создавая отдельный сетевой путь.
- [x] Объём хранения ограничен пятью последними снимками на endpoint и не растёт из-за разных query-параметров.
- [x] Снимок экспортируется byte-for-byte в файл, пригодный для `tests/fixtures/kufar/`.

## Границы реализации

- В текущем срезе traversal/scheduler ещё не владеет HTTP-клиентом. Worker валидирует journal directory при старте, а фактический владелец обхода подключит уже готовый journal dependency при появлении traversal.
- Journal хранится в filesystem, а не в Prisma/Postgres: отдельной raw-snapshot сущности в утверждённой domain model нет.
- UI/IPC для выбора destination и управление fixture-файлами не входят в эту задачу.

## Подсказки

- Дизайн: `docs/superpowers/specs/2026-09-08-1-2-3-raw-response-journal-design.md`
- План реализации: `docs/superpowers/plans/2026-09-08-1-2-3-raw-response-journal.md`
- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не реализовывать сравнение снимков — это эпик 4.1
