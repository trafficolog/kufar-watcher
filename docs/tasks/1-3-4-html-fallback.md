---
id: "1.3.4"
phase: 1
epic: "1.3"
status: done
sync_state: aligned
last_reviewed: 2026-09-08
roles: [BACK]
depends_on: ["1.3.2"]
estimated_hours: 4-5
agent: backend-senior
tags: [fallback, degradation]
---

# Задача 1.3.4 — Фолбэк на встроенные данные HTML-страницы

> Эпик 1.3 · Фаза 1 · ✅ done · зависит от: 1.3.2 · оценка: 4-5 ч

## Цель

Второй уровень деградации: при недоступности JSON-API извлекать те же данные из состояния, встроенного в HTML-страницу.

## Контекст

Уровень нужен не для повседневной работы, а чтобы пятиминутная недоступность API не останавливала мониторинг. Граница проведена сознательно: **временный сбой лечится фолбэком, дрейф схемы — паузой**. Если смешать эти случаи, получится либо остановка мониторинга из-за сетевого сбоя, либо продолжение работы на изменившейся площадке с неверными данными.

Переход на фолбэк — событие, о котором пользователь узнаёт: молчаливая деградация недопустима.

## Что сделано

- Живой search-page contract подтверждён для электроники и недвижимости и закреплён dated fixtures от 2026-09-08: carrier `__NEXT_DATA__`, path `props.initialState.listing`, records `listing.ads`, pagination `listing.pagination[]`.
- Реализован pure extractor embedded state без DOM/card parsing и узкая проекция `listing.pagination[] -> pagination.pages[]` перед существующими vertical normalizers.
- Реализован один generic `KufarHtmlFallbackAdapter`: он использует пользовательский listing URL, `size=30` и передаёт opaque `cursor` без декодирования.
- Реализован `KufarResilientSource`: fallback разрешён только после исчерпанных `network`, `timeout`, `http-5xx`; `429`, permanent HTTP failures и primary schema drift fallback не открывают.
- Успешный fallback возвращает channel `html-fallback` и только после успешной публикации typed `source-degraded` event через обязательный sink.
- Primary/fallback schema failures классифицируются как `pause-required`; fallback transport failure и отказ degradation sink — как `fail-run`.
- Fallback payload проходит те же electronics/real-estate normalizers и их structural/sanity validation, что primary payload.
- Live real-estate fixture обнаружила EUR response variant; normalizer читает EUR minor units только из matching `calculator[currency='EUR']`, не синтезируя неподтверждённое поле.

## Граница ответственности

`1.3.4` реализует source-layer переключение, классификацию и надёжную публикацию события, но **не владеет lifecycle обхода и состоянием монитора**:

- `2.4.3` создаёт/завершает `Run`, привязывает `SourceDegradationSink` к журналу обхода и сохраняет `degradedLevel`;
- `4.3` применяет terminal action `pause-required` к `Monitor.state` и формирует пользовательский отчёт/алерт;
- будущие `HealthEvent` / `AdapterState` из среза `0.6.0` не создаются преждевременно и не подменяются третьим хранилищем.

Так сохраняется исходное продуктовое правило «никакой тихой деградации» без протаскивания scheduler/DB ответственности внутрь source adapter.

## Критерии приёмки

- [x] При временном сбое API (`network`, `timeout`, `5xx`) source traversal успешно получает страницу через HTML fallback
- [x] При изменившейся структуре primary response fallback не используется и возвращается terminal action `pause-required`; фактическую паузу/алерт применяет эпик 4.3
- [x] При `429` fallback не используется, исходная rate-limit ошибка сохраняется для общего cooldown policy
- [x] Если fetched HTML / embedded payload не проходит structural validation или vertical normalization, возвращается `pause-required`, а мусор не выдаётся как успешная страница
- [x] Успешный fallback явно помечен `channel: html-fallback`
- [x] Typed `source-degraded` event публикуется и awaited до degraded success; `2.4.3` привяжет sink к Run-журналу и persisted `degradedLevel`
- [x] Electronics и real-estate extraction/pagination tests работают на четырёх сохранённых dated HTML fixtures

## Проверка

TDD-циклы задачи сохраняют отдельные RED и GREEN commits. Финальный behavioral head `1daf0631edf42fa9435ab1b44eebf76a0f40409d` подтверждён GitHub Actions run `#386` (`34225232968`): documentation consistency, 219 unit tests, CI self-check, typecheck, lint, formatting, Postgres integration, build и оба Electron smoke — GREEN.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`
- Exact live carrier/path/pagination — в `docs/superpowers/specs/kufar-api-contract.md`
- Архитектурная граница — в `docs/superpowers/specs/2026-09-08-1-3-4-html-fallback-design.md`

## Не делать

- Не реализовывать разбор DOM как третий уровень: это Post-MVP
- Не делать fallback основным путём даже временно
- Не лечить fallback-ом schema drift: это подменяет пользователю диагноз
- Не обходить `403`, CAPTCHA, login/anti-bot или иные access controls
- Не добавлять второй rate limiter и не менять retry/cooldown policy задачи `1.2.2`
