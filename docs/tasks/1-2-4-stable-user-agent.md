---
id: "1.2.4"
phase: 1
epic: "1.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
roles: [BACK, QA]
depends_on: ["1.2.2"]
estimated_hours: 1-2
agent: backend-senior
tags: [network, headers, politeness, remediation]
status_note: "KufarHttpClient now sends a stable application-level User-Agent by default while preserving caller headers and explicit case-insensitive overrides. RED #993; implementation GREEN #994."
---

# Задача 1.2.4 — Stable Kufar User-Agent

> Эпик 1.2 · Фаза 1 · ✅ done · зависит от: 1.2.2 · оценка: 1-2 ч

## Цель

Дать всем исходящим запросам через `KufarHttpClient` стабильную и прозрачную идентичность приложения вместо неявного transport-level User-Agent.

## Контекст

До remediation `KufarHttpClient.get()` передавал caller headers в transport без application-level default. При вызове без headers transport получал `headers: undefined`, поэтому приложение само не задавало идентификатор клиента.

Проект запрещает ротацию идентификационных заголовков, browser fingerprint spoofing и обход ограничений площадки. Поэтому выбран один стабильный `User-Agent: kufar-watcher` без имитации браузера и без версии, которая могла бы расходиться с package metadata.

## Критерии приёмки

- [x] GET без caller `User-Agent` передаёт в transport `user-agent: kufar-watcher`.
- [x] Дополнительные caller headers сохраняются вместе с default User-Agent.
- [x] Явный caller `User-Agent` в любом регистре сохраняется как единственное значение; default не дублируется.
- [x] Один и тот же сформированный request используется всеми retry attempts, поэтому идентичность не меняется между попытками.
- [x] Limiter, retry, timeout, `429`, fallback и error-classification semantics не изменены.
- [x] Полный canonical verify pipeline GREEN.

## TDD и проверка

- RED: `verify #993` на `34c91fb195fe3a3e55463c0744a582dfb8cf1e0d` — 466 passed / 2 failed / 35 skipped; оба failure показали отсутствие default `user-agent`, explicit override characterization осталась GREEN.
- GREEN: `verify #994` на `dd3022189c69a1edf12404eb4e179a48a3c15b7e` — полный canonical workflow прошёл успешно.
- Context7 / Undici: custom `User-Agent` поддерживается обычным request header; application-level идентификатор предпочтительнее transport default для automated client.

## Не делать

- Не имитировать Chrome, Firefox или мобильные браузеры.
- Не ротировать User-Agent между запросами, retry attempts или мониторами.
- Не менять глобальный limiter, retry policy или fallback ради обхода ответов площадки.
