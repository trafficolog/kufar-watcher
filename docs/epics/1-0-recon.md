---
id: "1.0"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-13
status_note: "3/3 done: live electronics and real-estate reconnaissance plus the production KufarHttpClient HTML/terminal probe are captured; verify #1417 confirmed HTTP 200, __NEXT_DATA__ and a terminal page without label=next."
roles:
  - BACK
  - QA
---

# Эпик 1.0 — Разведка контракта площадки

## Цель

Снять живые ответы Kufar по обеим целевым категориям, подтвердить или
опровергнуть гипотезы спецификации контракта и превратить результат в фикстуры,
на которых дальше работает вся фаза без обращения к сети.

Эпик выполняется **первым в фазе 1**, до `1.1.1`. Проектировать отображение
адресов на API, не видя ни одного ответа, — это писать код по догадкам и
переделывать его после первого запуска.

## Планируемые задачи

- `1.0.1` — Разведка выдачи по электронике
- `1.0.2` — Разведка выдачи по недвижимости и сверка спеки
- `1.0.3` — Live probe production Kufar HTTP path

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.0-tasks -->
**Задач:** 3 · **done:** 3

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.0.1` | [Разведка выдачи по электронике](../tasks/1-0-1-recon-electronics.md) | ✅ done | 🟢 aligned |
| `1.0.2` | [Разведка выдачи по недвижимости и сверка спеки](../tasks/1-0-2-recon-realestate.md) | ✅ done | 🟢 aligned |
| `1.0.3` | [Live probe production Kufar HTTP path](../tasks/1-0-3-live-kufar-http-probe.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.0-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] В `docs/superpowers/specs/kufar-api-contract.md` не осталось пометок «требует проверки» без ответа
- [x] Фикстуры сохранены в `tests/fixtures/kufar/` с датой снятия
- [x] Production `KufarHttpClient` отдельно подтверждён одноразовым live HTML/terminal probe без browser spoofing

## Связанные документы

- Фаза: `docs/phases/1-kufar-core.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Live production-client evidence: `docs/recon/kufar-production-http-client-2026-09-13.md`
