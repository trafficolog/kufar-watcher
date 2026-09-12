---
id: "2.3.1"
phase: 2
epic: "2.3"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, QA]
depends_on: ["1.1.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [seller, kufar-api, url-parser, tdd]
---

# Задача 2.3.1 — Тип продавца как параметр запроса

> Эпик 2.3 · Фаза 2 · 🟡 in_progress · зависит от: 1.1.2 · оценка: 2-3 ч

## Цель

Сделать тип продавца частью `CanonicalQuery` и передавать его в текущий Kufar Search API нативным параметром, без локальной фильтрации результатов по `company_ad`.

## Контекст

Эпик 2.3 требует различать объявления частников и компаний. До этой задачи user-layer marker `bez-posrednikov` сохранялся как непрозрачная строка, а `buildKufarApiUrl()` намеренно отвергал seller-filtered запросы, потому что native API mapping не был подтверждён.

Recon 2026-09-12 подтвердил текущую семантику `cmp` на `https://api.kufar.by/search-api/v2/search/rendered-paginated`:

- страница Kufar описывает фильтр как `name: company_ad`, `url_name: cmp`, `type: bool`;
- `bez-posrednikov`, `cmp=0` и `cmp=false` означают частника;
- `cmp=1` и `cmp=true` означают компанию;
- electronics probe: baseline `1256` (20 private / 10 company в первой 30), `cmp=0` → `802` и 30/30 private, `cmp=1` → `454` и 30/30 company;
- real-estate probe: baseline `12036` (4 private / 26 company в первой 30), `cmp=0` → `816` и 30/30 private, `cmp=1` → `11222` и 30/30 company;
- подтверждающий GitHub Actions run: `probe-2-3-1-seller-type #3`, run id `34680955449`.

## Что должно быть сделано

- Ввести общий тип `SellerType = 'private' | 'company'` и использовать его в `CanonicalQuery`.
- Нормализовать private user-layer формы `bez-posrednikov`, `cmp=0`, `cmp=false` в `sellerType: 'private'`.
- Нормализовать `cmp=1`, `cmp=true` в `sellerType: 'company'`.
- Явно отклонять invalid/conflicting seller encodings вместо сохранения `cmp` в `extraParams`.
- Сохранять стабильный site round-trip: `private` строится через `bez-posrednikov`, `company` — через `cmp=1`.
- Добавлять `cmp=0|1` в `buildKufarApiUrl()` для обеих уже подтверждённых mappings: electronics и real estate.
- При чтении persisted `CanonicalQuery` принять legacy `sellerType: 'bez-posrednikov'` и нормализовать его в `private`; новые записи должны использовать только новый canonical формат.
- Обновить контракт Kufar API зафиксированным recon evidence.

## Критерии приёмки

- [ ] `CanonicalQuery.sellerType` типизирован как `SellerType | null`, где `SellerType = 'private' | 'company'`.
- [ ] Parser корректно нормализует private/company формы и не оставляет `cmp` в `extraParams`.
- [ ] Invalid/conflicting `cmp` приводит к явной parse error.
- [ ] Listing URL round-trip стабилен для private и company.
- [ ] API URL содержит `cmp=0` для private и `cmp=1` для company в electronics и real-estate mappings.
- [ ] Legacy persisted marker `bez-posrednikov` читается как `private` без DB migration.
- [ ] Новые тесты проходят RED → GREEN, canonical CI полностью зелёный.

## Не делать

- Не реализовывать персональный blacklist / `SellerBlock` post-filter — это `2.3.2`.
- Не добавлять новые категории или неподтверждённые API mappings.
- Не менять схему БД: существующий `Monitor.sellerType String?` достаточен для этого среза.
- Не фильтровать уже полученные объявления по `Listing.isCompany`: фильтр должен уходить нативно в запрос.
