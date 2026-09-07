---
id: "1.1.3"
phase: 1
epic: "1.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-07
roles: [BACK]
depends_on: ["1.1.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [routing]
---

# Задача 1.1.3 — Определение категории и хоста по URL

> Эпик 1.1 · Фаза 1 · ✅ done · зависит от: 1.1.1 · оценка: 2-3 ч

## Цель

По разобранному адресу определить, к какой категории относится правило и какой адаптер его обслуживает.

## Контекст

Живая разведка `1.0.1` и `1.0.2` подтвердила единый search API host `api.kufar.by` для электроники и недвижимости. Маршрутизация поэтому выбирает vertical semantics / будущий адаптер по public host и категории `CanonicalQuery`, а не предполагает разные API-hosts. Выбор делается один раз при сохранении правила, а не на каждом обходе.

## Что должно быть сделано

- Реализовать сопоставление категории с адаптером
- Адрес из категории «Авто» отклонять с сообщением, что категория вне периметра
- Неизвестную категорию отклонять с явной ошибкой

## Критерии приёмки

- [x] Адрес по электронике направляется в соответствующий адаптер
- [x] Адрес по недвижимости направляется в свой адаптер
- [x] Адрес по авто отклоняется с понятным сообщением
- [x] Юнит-тесты на все три случая зелёные

## Результат — 2026-09-07

- `shared/kufar-routing.ts` экспортирует `KufarAdapterKind = 'electronics' | 'real-estate'`, чистую `routeKufarQuery()` и typed `KufarRoutingError`.
- Подтверждённая goods-маршрутизация ограничена `kufar.by` / `www.kufar.by` + `igry-i-pristavki` → `electronics`; `re.kufar.by` + `kvartiru` → `real-estate`.
- `auto.kufar.by` отклоняется отдельно с кодом `out-of-scope-category` и понятным сообщением про Auto; неподтверждённые категории и vertical hosts отклоняются с `unknown-category`.
- Таксономия Kufar, конкретные адаптеры и их реестр не реализуются: это остаётся в эпике `1.3`.
- `tests/unit/kufar-routing.test.ts` покрывает два electronics host-варианта, real-estate, Auto и три unknown/unsupported маршрута.
- RED: tests-only commit `fa4c742aa78f4e23cf890ebf01bc1a8e7407d906`, GitHub Actions run #227 — setup/install/docs consistency зелёные, Unit tests ожидаемо RED до появления routing module.
- GREEN: code SHA `46bc0f614155eac99bb8083bcd21536ab7820dd4`, GitHub Actions run #228 — success для docs consistency, unit tests, CI failure-mode self-check, typecheck, lint, Formatting, PostgreSQL compose integration, build/output verification, development smoke и production smoke.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`
- Live-контракт API — `docs/superpowers/specs/kufar-api-contract.md`

## Не делать

- Не реализовывать сами адаптеры — это эпик 1.3
- Не вводить полную таксономию Kufar для неподтверждённых категорий
