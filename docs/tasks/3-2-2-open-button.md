---
id: "3.2.2"
phase: 3
epic: "3.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-14
roles: [BACK]
depends_on: ["3.2.1"]
estimated_hours: 1-2
agent: backend-senior
tags: [telegram, ui]
---

# Задача 3.2.2 — Кнопка «Открыть»

> Эпик 3.2 · Фаза 3 · ✅ done · зависит от: 3.2.1 · оценка: 1-2 ч

## Цель

Прикрепить к Telegram-уведомлению URL-кнопку «Открыть», которая ведёт на человеческую страницу конкретного объявления Kufar.

## Контекст

В срезе MVP-1 кнопка одна. «В избранное» приходит в `0.5.0` вместе с мониторингом цен: кнопка, за которой нет обещанного поведения, хуже её отсутствия.

Telegram URL button не создаёт `callback_query`: Telegram-клиент открывает `url` напрямую. Поэтому прежнее требование одновременно открыть ссылку и обработать то же нажатие ботом было невыполнимым контрактом. Security boundary здесь — отправка уведомления только в привязанный chat; сам публичный URL объявления после доставки не является callback-действием приложения.

`Listing.url` уже является человеческой ссылкой конкретного объявления: нормализатор принимает только Kufar HTTP(S) `ad_link` и имеет site fallback для electronics/real-estate. `buildKufarListingUrl()` из `1.1.2` собирает URL выдачи монитора, а не URL конкретного объявления, поэтому для кнопки используется именно `Listing.url`.

## Что должно быть сделано

- Добавить к notification transport typed options с `openUrl` и отправлять сообщение через Telegram HTML parse mode.
- Формировать inline keyboard с единственной URL-кнопкой `Открыть`.
- Сохранять `openUrl` в durable pg-boss outbox payload, чтобы retry/restart не терял кнопку.
- Перед отправкой принимать только `http:`/`https:` URL на `kufar.by` или его поддоменах и явно отвергать `api.kufar.by`.
- Сохранять существующую границу `TelegramBotService`: durable notification отправляется только в текущий `boundChatId`; stale/foreign chat остаётся permanent failure.

## Критерии приёмки

- [x] Telegram send использует `parse_mode: HTML` и inline keyboard `[[{ text: "Открыть", url: openUrl }]]`.
- [x] Durable outbox сохраняет и восстанавливает `openUrl` вместе с `matchId`, `chatId` и `text`.
- [x] Кнопка принимает человеческий HTTP(S) URL Kufar и отвергает API URL/чужой host/не-HTTP(S) схему до transport send.
- [x] Notification для чужого/stale chat не отправляется и завершается существующим permanent failure.
- [x] Юнит-тесты boundary/queue/delivery/grammY transport зелёные.

## Результат

- Durable notification payload хранит `openUrl`, поэтому retry/restart не теряет кнопку.
- grammY transport отправляет Telegram HTML с единственной inline URL-кнопкой `Открыть` на `Listing.url`.
- `isHumanKufarUrl()` принимает только HTTP(S) `kufar.by`/поддомены и отвергает `api.kufar.by`, чужие hosts и другие схемы до enqueue/send.
- Существующая bound-chat защита сохранена: stale/foreign target остаётся permanent failure и не отправляется.
- RED/GREEN цикл и полный verify подтвердили queue/delivery/transport boundary без добавления callback action.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`.
- Формат текста — `3.2.1`; durable outbox — `3.1.3`.

## Не делать

- Не добавлять callback action для URL-кнопки: Telegram не присылает callback для `url` button.
- Не добавлять кнопку «В избранное»: это `3.2.4`, срез `0.5.0`.
- Не менять delivery/idempotency semantics `3.2.3` и не добавлять producer новых notification jobs.
