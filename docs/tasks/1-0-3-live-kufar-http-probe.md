---
id: "1.0.3"
phase: 1
epic: "1.0"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
status_note: "Live GitHub-hosted production-client probe #1417 completed: 30 HTML pages returned HTTP 200 on first attempt, __NEXT_DATA__ parsed throughout, and the live terminal page omitted label=next; no product remediation required."
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

## Результат — 2026-09-13

GitHub Actions `verify` **#1417** (`34774156382`) на probe head `36d1a2527a72dbcbd8eb38767cf0a3d819ee3fed` выполнил throwaway live step через production `KufarHttpClient` и существующий HTML fallback parser/normalizer.

- Клиент стартовал без custom headers со штатным `User-Agent: kufar-watcher`.
- Выполнено 30 HTML requests; все 30 вернули HTTP `200` с `attempts=1`. `403`, `429`, retry и network failure не наблюдались.
- На каждой странице production extractor нашёл `scriptId="__NEXT_DATA__"`, а embedded `props.initialState.listing` успешно нормализовался.
- Страницы 1–29 имели следующий opaque cursor. При этом страница 24 содержала только 11 normalized listings, но всё ещё имела `next:string`; следовательно, короткая страница сама по себе не является terminal signal.
- Фактическая terminal page оказалась страницей 30: HTTP `200`, 33 normalized listings, `nextCursor=null`.
- Raw pagination summary terminal page содержал соседние string-token entries, `prev:string` и `self:null`, но **вообще не содержал элемента `label="next"`**. Это отличается от ранее охарактеризованной допустимой формы `next` с `token=null`, но уже поддерживается общим normalizer: отсутствие `next` трактуется как конец выдачи.
- Product remediation не требуется: текущий runtime корректно дошёл до terminal page без изменения кода.
- Полный сетевой evidence записан отдельно в `docs/recon/kufar-production-http-client-2026-09-13.md` без raw body/cursor values.

Probe test и временный workflow step после снятия evidence удалены; постоянный CI не обращается к живому Kufar.

## Критерии завершения

- [x] Зафиксирован фактический HTTP outcome production client из GitHub runner.
- [x] Зафиксировано, извлекается ли `__NEXT_DATA__` и совместим ли embedded listing state с production parser/normalizer.
- [x] Зафиксирована фактическая terminal-page pagination shape либо точный blocker, который не позволил до неё дойти.
- [x] Contract не потребовал remediation: текущий normalizer уже поддерживает фактическую форму terminal page.
- [x] Throwaway probe удалён; product-код и постоянный verify pipeline не изменены.
