---
id: "2.3.2"
phase: 2
epic: "2.3"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["0.3.4", "2.3.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [seller, blacklist, prisma, postfilter, tdd]
---

# Задача 2.3.2 — Персональный чёрный список аккаунтов

> Эпик 2.3 · Фаза 2 · ✅ done · зависит от: 0.3.4, 2.3.1 · оценка: 2-3 ч

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

- [x] Заблокированный `accountId` не проходит в matcher/notification pipeline.
- [x] Незаблокированный и `null` account id продолжают обычную обработку.
- [x] Blacklist применяется после source response и не меняет Kufar request URL.
- [x] Для заблокированных listings не расходуется detail-request budget.
- [x] Добавление/удаление `SellerBlock` учитывается на следующем run.
- [x] Unit и PostgreSQL integration tests проходят RED → GREEN.

## Результат

- RED: `verify #1043`, run id `34685947825`, exact SHA
  `ec8e8c09d9d5347652ec50a5a89fcff93148f335` — новые cycle-contract tests
  ожидаемо показали отсутствие чтения `SellerBlock` в production wiring.
- Реализован `SellerBlock` snapshot-prefilter: один `findMany` на incremental
  cycle, immutable `Set` для всего run и разрешение `null`/пустого `accountId`.
- Blacklist композируется перед optional caller prefilter, поэтому внешний
  prefilter не может пропустить заблокированный аккаунт. Existing incremental
  policy применяет этот prefilter до description loader и matcher, поэтому
  заблокированные listings не расходуют detail-request budget.
- PostgreSQL integration проверяет смену `SellerBlock` между двумя snapshot
  reads на одном подключённом Prisma client: добавление/удаление вступает в силу
  на следующем cycle без restart/reconnect.
- GREEN: `verify #1049`, run id `34686357453`, exact SHA
  `654c122d0d90795987be243baf0b39ae91d0fcba` — dependency audit, docs, unit
  tests, typecheck, lint, formatting, PostgreSQL integration, build и
  development/production Electron smoke прошли успешно.

## Не делать

- Не менять native `cmp` seller-type filtering из `2.3.1`.
- Не добавлять UI управления blacklist — это задача `5.4.5`.
- Не пытаться передавать account blacklist на Kufar как неподтверждённый query
  parameter.
- Не расширять схему `SellerBlock` без отдельного требования.
