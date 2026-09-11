---
id: "1"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "Фаза 1 закрыта: все 6 эпиков (1.0–1.5) done/aligned; URL parsing, HTTP, adapters, watermark and description loading complete."
---

# Фаза 1 — Ядро парсинга Kufar

## Цель

Готовая ссылка на отфильтрованную выдачу превращается в поток нормализованных объявлений без дублей.

## Контекст

Опирается на фазу 0. Разблокирует фазу 2: правилам нужен источник объявлений. Здесь же закладывается многоуровневая деградация (JSON API → HTML), на которой позже строится детект дрейфа.

## Эпики фазы

<!-- docs:ops:begin phase-1-epics -->
**Эпиков:** 6 · **done:** 4 · **в работе/план:** 2

| ID | Эпик | Статус | Sync | Ист. |
|----|------|--------|------|------|
| `1.0` | [Разведка контракта площадки](../epics/1-0-recon.md) | ⬜ todo | 🟡 drifted | Разведка живого контракта площадки до проектирования сетевого слоя. |
| `1.1` | [URL-парсер и canonical query](../epics/1-1-url-parser.md) | ✅ done | 🟢 aligned | Единственная точка входа пользователя — ссылка. |
| `1.2` | [HTTP-клиент и лимитер](../epics/1-2-http-client.md) | ✅ done | 🟢 aligned | Вежливый и предсказуемый сетевой слой. |
| `1.3` | [Адаптеры выдачи Kufar](../epics/1-3-source-adapters.md) | ✅ done | 🟢 aligned | 5/5: общий SourceAdapter, electronics, real-estate, проверенный HTML fallback и terminal pagination token готовы. |
| `1.4` | [Водяной знак новизны и дедупликация](../epics/1-4-watermark.md) | ⬜ todo | 🟡 drifted | Ядро логики «что считать новым». |
| `1.5` | [Догрузка описания карточки](../epics/1-5-description-fetch.md) | ✅ done | 🟢 aligned | 3/3 done: persistent detail cache, two-stage description policy and per-Run 10-request detail budget; verify #935 GREEN. |
<!-- docs:ops:end phase-1-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
