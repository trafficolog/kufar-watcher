---
id: "2.3.2"
phase: 2
epic: "2.3"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["0.3.4", "2.3.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [seller, blacklist, prisma, postfilter, tdd]
---

# Задача 2.3.2 — Персональный чёрный список аккаунтов

> Эпик 2.3 · Фаза 2 · ⬜ todo · зависит от: 0.3.4, 2.3.1 · оценка: 2-3 ч

## Цель

Применять персональный `SellerBlock` как локальный post-filter после получения
выдачи Kufar, не смешивая blacklist с нативным seller-type request filter.

## Контекст

Схема `SellerBlock` уже добавлена задачей `0.3.4`; search records содержат
`Listing.accountId`. В runtime incremental pipeline уже есть
`CandidatePrefilter`, выполняющийся до загрузки полного описания и до matcher-а —
это подходящая граница для blacklist без лишних detail requests.

## Что должно быть сделано

- Реализовать Prisma-backed prefilter по `SellerBlock.accountId`.
- На каждый run читать актуальный набор блокировок один раз и применять его ко
  всем новым listings этого run.
- Отбрасывать listing только когда его непустой `accountId` присутствует в
  `SellerBlock`; `null`/неизвестный account id сам по себе не блокируется.
- Подключить prefilter к scheduled/incremental runtime до description loading,
  keyword matching и notification selection.
- Изменения `SellerBlock` должны вступать в силу со следующего run без restart.
- Покрыть поведение unit и PostgreSQL integration tests.

## Критерии приёмки

- [ ] Заблокированный `accountId` не проходит в matcher/notification pipeline.
- [ ] Незаблокированный и `null` account id продолжают обычную обработку.
- [ ] Blacklist применяется после source response и не меняет Kufar request URL.
- [ ] Для заблокированных listings не расходуется detail-request budget.
- [ ] Добавление/удаление `SellerBlock` учитывается на следующем run.
- [ ] Unit и PostgreSQL integration tests проходят RED → GREEN.

## Не делать

- Не менять native `cmp` seller-type filtering из `2.3.1`.
- Не добавлять UI управления blacklist — это задача `5.4.5`.
- Не пытаться передавать account blacklist на Kufar как неподтверждённый query
  parameter.
- Не расширять схему `SellerBlock` без отдельного требования.
