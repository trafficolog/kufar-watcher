---
id: "1.1.2"
phase: 1
epic: "1.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-07
roles: [BACK]
depends_on: ["1.1.1"]
estimated_hours: 3
agent: backend-senior
tags: [parser, tdd]
---

# Задача 1.1.2 — Обратная сборка CanonicalQuery в URL

> Эпик 1.1 · Фаза 1 · ✅ done · зависит от: 1.1.1 · оценка: 3 ч

## Цель

TDD. Собрать из `CanonicalQuery` два адреса: запрос к API и человекочитаемый адрес сайта.

## Контекст

Адрес API нужен для обхода, адрес сайта — чтобы показать пользователю в редакторе правила и дать ссылку «открыть в браузере». Свойство «разобрать и собрать обратно» даёт бесплатную проверку корректности разбора.

## Что должно быть сделано

- Сначала тесты: для каждого адреса из набора `1.1.1` сборка обратно даёт эквивалентный адрес
- Реализовать сборку адреса API с параметрами из спецификации контракта
- Реализовать сборку адреса сайта
- Обеспечить стабильный порядок параметров, чтобы адреса были сравнимы

## Критерии приёмки

- [x] Круговой прогон разбор → сборка сохраняет смысл адреса для всего набора тестов
- [x] Собранный адрес API содержит сортировку по дате размещения
- [x] Порядок параметров детерминирован

## Результат — 2026-09-07

- `shared/kufar-url.ts` экспортирует `buildKufarListingUrl()` и `buildKufarApiUrl()` вместе с typed `KufarUrlBuildError`.
- Site builder канонически собирает goods/real-estate пути, кодирует path segments, ставит `sort` первым и сортирует остальные query keys, сохраняя порядок повторных значений.
- API builder использует подтверждённый endpoint `https://api.kufar.by/search-api/v2/search/rendered-paginated`, принудительно добавляет `sort=lst.d` и `lang=ru`, сохраняет opaque extra params и реализует только live-подтверждённые mappings: electronics `igry-i-pristavki/minsk → cat=5040&rgn=7`, real-estate `minsk/kupit/kvartiru → cat=1010&gtsy=country-belarus~province-minsk~locality-minsk&typ=sell`.
- Неподтверждённые API semantics (включая Auto, неизвестные категории, rental и дополнительные real-estate path/seller filters) отклоняются с `unsupported-api-mapping`, без догадок о контракте площадки.
- `tests/unit/url-build.test.ts` покрывает round-trip набора `1.1.1`, детерминированный порядок, оба подтверждённых API request shape и отказ для неподтверждённых mappings.
- RED: tests-only commit `e8a4ee3d3a7fc5e8d2351d458c0687db53963b21`, GitHub Actions run #222 — docs consistency зелёный, Unit tests ожидаемо RED до появления builder exports.
- GREEN: code SHA `8fa11725cf509566894f9bcb4a9ff9f8556f75ae`, GitHub Actions run #223 — success для docs consistency, unit tests, CI failure-mode self-check, typecheck, lint, Prettier, PostgreSQL compose integration, build/output verification, development smoke и production smoke.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не выполнять запрос по собранному адресу — это эпик 1.3
