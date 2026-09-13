---
id: "1.0.3"
phase: 1
epic: "1.0"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-13
roles: [BACK, QA]
depends_on: ["1.0.1", "1.2.2", "1.3.5"]
estimated_hours: 1-2
agent: backend-senior
tags: [kufar, recon, http, html, pagination, spike, audit]
---

# Задача 1.0.3 — Live probe production Kufar HTTP path

## Цель

Одноразово проверить из GitHub Actions фактический live contract HTML-выдачи через существующий production `KufarHttpClient`, без browser spoofing и без изменения product-кода.

## Вопрос Spike

Может ли текущий `KufarHttpClient` со штатным `User-Agent: kufar-watcher` получить живую HTML-выдачу Kufar, извлечь подтверждённый `__NEXT_DATA__` search state и пройти курсорную пагинацию до фактической terminal page?

## Probe contract

- Использовать production `KufarHttpClient` без custom headers, proxy/VPN, browser fingerprint или ротации адресов.
- Использовать подтверждённый electronics listing `minsk / игры-и-приставки / ps5` и production HTML fallback parsing/normalization path.
- Запросы проходят через штатный global limiter `2–5s`; максимум 100 HTML pages.
- В CI log писать только HTTP status, attempts, номер страницы, количество normalized listings, наличие `__NEXT_DATA__`, наличие следующего cursor и типы полей pagination (`string` / `null`), без raw body и содержимого объявлений.
- `403`, `429`, schema drift, network failure или отсутствие terminal page в bounded лимите считаются валидным evidence Spike; обходить ограничение запрещено.
- Временный probe test и временный workflow step удалить после фиксации evidence. Они не становятся постоянным CI gate.

## Критерии завершения

- [ ] Зафиксирован фактический HTTP outcome production client из GitHub runner.
- [ ] Зафиксировано, извлекается ли `__NEXT_DATA__` и совместим ли embedded listing state с production parser/normalizer.
- [ ] Зафиксирована фактическая terminal-page pagination shape либо точный blocker, который не позволил до неё дойти.
- [ ] Если contract расходится или доступ блокируется, создан bounded remediation follow-up вместо обхода.
- [ ] Throwaway probe удалён; product-код и постоянный verify pipeline не изменены.
