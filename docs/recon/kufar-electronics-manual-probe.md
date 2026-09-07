# Ручной raw-probe Kufar для `1.0.1`

> Назначение: закрыть только оставшиеся первичные критерии `1.0.1` после live
> browser probe 2026-09-07. Search API, page 1/page 2, cursor, `/count`, основные
> electronics fields и договорная цена уже подтверждены dated JSON fixtures.

Это **не скрипт разведки**: каждый оставшийся запрос выполняется вручную, по
одному, с паузой 2–5 секунд и просмотром результата перед следующим.

## Правила остановки

- Без авторизации Kufar, proxy, VPN-ротации, подмены fingerprint/User-Agent и
  иных способов обхода ограничений площадки.
- Если получен `429` — остановить probe и зафиксировать ответ.
- Если получен `403` / «Доступ ограничен» — остановить probe и зафиксировать
  условия. Не менять IP/канал ради продолжения.
- Если endpoint возвращает `404` или изменённую схему — сохранить ответ и
  исправить spec по факту; не подгонять запрос под secondary sources.
- Сырые ответы сохранять как есть в `tests/fixtures/kufar/` с датой снятия.

## Уже подтверждено — не повторять без причины

Live Opera probe 2026-09-07 первично подтвердил:

- search host/path:
  `https://api.kufar.by/search-api/v2/search/rendered-paginated`;
- рабочий electronics query:
  `cat=5040&rgn=7&query=ps5&size=2&sort=lst.d&lang=ru`;
- top-level `ads`, `pagination`, `total`;
- cursor:
  `pagination.pages[]` → `label == "next"` → `token` → `cursor=<token>`;
- page 1 / page 2 одного snapshot с `total=1229`;
- `/search-api/v2/search/count` → `{"count":1229}` для согласованных filters;
- обязательные electronics fields;
- current negotiable item `1082715190`: публичная карточка показывает
  `Договорная`, raw search response содержит `price_byn="0"`.

Fixtures:

- `tests/fixtures/kufar/2026-09-07-electronics-search-page-1.json`;
- `tests/fixtures/kufar/2026-09-07-electronics-search-page-2.json`;
- `tests/fixtures/kufar/2026-09-07-electronics-count.json`;
- `tests/fixtures/kufar/2026-09-07-electronics-negotiable.json`.

Не возвращаться к старым гипотезам `cat=17000`, `cre-api` или v1 для этой
электроники: они вытеснены первичным live evidence.

## Остаток 1 — detail response / platform status

Открытые клиенты используют публичный-looking endpoint:

`https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`

Проверять на уже зафиксированном current item `1082715190`:

```bash
curl --fail-with-body --get \
  'https://api.kufar.by/search-api/v2/item/1082715190/rendered' \
  --data-urlencode 'lang=ru' \
  -o tests/fixtures/kufar/2026-09-07-electronics-negotiable-item.json
```

В raw detail проверить и записать **фактический** shape:

- `ad_id` / `list_id`;
- price fields и `currency`;
- наличие или отсутствие platform status (`active`, inactive, sold, removed или
  эквивалент);
- если status есть — приходит ли он в этом же ответе, что и price;
- если status отсутствует — это тоже первичный результат; не придумывать
  отдельный endpoint без evidence.

Если endpoint сам отвечает `403`, `429`, `404` или другой ошибкой Kufar —
сохранить факт и остановиться согласно правилам выше.

## Остаток 2 — исходный HTML embedded state

Сохранить исходный HTML той же публичной карточки:

```bash
curl --fail-with-body \
  'https://www.kufar.by/item/1082715190' \
  -o tests/fixtures/kufar/2026-09-07-electronics-negotiable.html
```

Без выполнения JS проверить наличие `<script id="__NEXT_DATA__">`.
Secondary evidence 2026 года ожидает state в `props.initialState` /
`props.pageProps.initialState`, а для detail — данные под `adView.data`.

Фиксировать только реально увиденный path. Если `__NEXT_DATA__` отсутствует, но
server-rendered DOM содержит карточку/цену/локацию — сохранить HTML и в spec
прямо записать отсутствие ожидаемого embedded state. DOM parseability уже
подтверждена browser probe и не требует повторной разведки.

### Ограничение Opera Browser Connector

Opera открывает `view-source:https://www.kufar.by/item/1082715190`, но текущий
Browser Connector блокирует чтение `view-source:` accessibility tree/screenshot.
Это ограничение инструмента, а не ответ Kufar.

В конце успешной browser-сессии Connector также временно потерял авторизацию
перед первым запросом к detail endpoint. Эта ошибка возникла **до HTTP-запроса
к Kufar** и не считается `403`/`429` площадки.

## После двух оставшихся probe

1. Raw fixtures не редактировать вручную после capture.
2. Обновить `docs/superpowers/specs/kufar-api-contract.md` только по наблюдаемому
   detail/HTML contract.
3. Закрыть оставшиеся acceptance criteria `1.0.1` только если evidence реально
   отвечает на embedded-state и price/status вопросы.
4. Затем выполнить `npm run docs:ops:refresh && npm run docs:ops:check`, review,
   CI/PR и merge в `main`.
