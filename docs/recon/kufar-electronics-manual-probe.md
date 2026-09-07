# Ручной raw-probe Kufar для `1.0.1`

> Назначение: закрыть оставшиеся критерии `1.0.1` из окружения с обычным прямым
> HTTPS-доступом к Kufar. Это **не скрипт разведки**: каждый запрос выполняется
> вручную, по одному, с паузой 2–5 секунд и просмотром результата перед следующим.

## Правила остановки

- Без авторизации, proxy, VPN-ротации, подмены fingerprint/User-Agent и иных
  способов обхода ограничений площадки.
- Если получен `429` — остановить probe и зафиксировать ответ.
- Если получен `403` / «Доступ ограничен» — остановить probe и зафиксировать
  условия. Не менять IP/канал ради продолжения.
- Если endpoint возвращает `404` или изменённую схему — сохранить ответ и
  исправить spec по факту; не подгонять запрос под старые secondary sources.
- Сырые ответы сохранять как есть в `tests/fixtures/kufar/` с датой снятия.

## Почему probe нужен из другой сети

В текущем execution-окружении прямой DNS lookup внешних хостов не работает.
Дополнительная одиночная попытка с `curl --resolve` и публично наблюдавшимся IP
`api.kufar.by` также завершилась до HTTP на TCP connect. Поэтому здесь нельзя
честно классифицировать ответ Kufar как `200`, `403`, `429` и нельзя получить
raw fixture.

Публичный urlscan за последний месяц при этом показывает `api.kufar.by`, CNAME
`pro-iq-api.kufar.by`, IPv4 `46.16.35.91` и свежие обращения к API с
`www.kufar.by/l`. Это secondary evidence доступности host, а не raw response.

Отдельно сторонний consumer, изменённый 2026-09-06, пишет, что Kufar отвечает
его datacenter-окружению `403 «Доступ ограничен»` и поэтому тот проект использует
proxy. Для Kufar Monitor это **не допустимая стратегия**: приложение работает
на пользовательской машине, а разведка должна проверить прямой канал и честно
зафиксировать отказ, если он есть.

## Рабочие гипотезы — проверить, а не принять за истину

Свежие secondary sources 2026 года сходятся на:

- search: `https://api.kufar.by/search-api/v2/search/rendered-paginated`;
- count: `https://api.kufar.by/search-api/v2/search/count`;
- response: `ads`, `pagination`, `total`;
- next page: элемент `pagination.pages[]` с `label == "next"`, его `token`
  передаётся как `cursor=<token>`;
- поля объявления: `ad_id`, `list_time`, `subject`, `price_byn`, `price_usd`,
  `currency`, `account_id`/`account`, `company_ad`, `ad_parameters`,
  `account_parameters`, `body`/`body_short`;
- договорная цена: вероятно `price_byn == null || 0`;
- исторический detail target: `https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`.

Ни один пункт выше не считается подтверждённым для электроники до сохранения
raw response этой задачи.

## Probe 1 — первая страница электроники

Использовать небольшой размер страницы. `cat=17000` — secondary-гипотеза
родительской товарной категории «Электроника»; если сервер её отвергает,
сохранить ответ и не перебирать category id вслепую.

```bash
curl --fail-with-body --get \
  'https://api.kufar.by/search-api/v2/search/rendered-paginated' \
  --data-urlencode 'cat=17000' \
  --data-urlencode 'query=ps5' \
  --data-urlencode 'size=10' \
  --data-urlencode 'cur=BYR' \
  --data-urlencode 'lang=ru' \
  --data-urlencode 'sort=lst.d' \
  -o tests/fixtures/kufar/2026-09-07-electronics-page1.json
```

После запроса вручную проверить:

1. HTTP status и `Content-Type`;
2. top-level `ads`, `pagination`, `total`;
3. обязательные поля хотя бы у двух `ads`;
4. порядок `list_time`;
5. `pagination.pages[]` и элемент `label == "next"`.

## Probe 2 — вторая страница по cursor

Из page1 **вручную** скопировать `token` элемента `pagination.pages[]`, где
`label == "next"`. Не вычислять и не перебирать токены.

```bash
curl --fail-with-body --get \
  'https://api.kufar.by/search-api/v2/search/rendered-paginated' \
  --data-urlencode 'cat=17000' \
  --data-urlencode 'query=ps5' \
  --data-urlencode 'size=10' \
  --data-urlencode 'cur=BYR' \
  --data-urlencode 'lang=ru' \
  --data-urlencode 'sort=lst.d' \
  --data-urlencode 'cursor=<TOKEN_FROM_PAGE1>' \
  -o tests/fixtures/kufar/2026-09-07-electronics-page2.json
```

Зафиксировать, что page2 действительно продолжает page1, и сравнить форму
`pagination` обеих страниц.

## Probe 3 — `/count`

Использовать тот же набор фильтров, что в page1, кроме `size` и `cursor`.

```bash
curl --fail-with-body --get \
  'https://api.kufar.by/search-api/v2/search/count' \
  --data-urlencode 'cat=17000' \
  --data-urlencode 'query=ps5' \
  --data-urlencode 'cur=BYR' \
  --data-urlencode 'lang=ru' \
  -o tests/fixtures/kufar/2026-09-07-electronics-count.json
```

Сравнить `count` с `total` page1 и с видимым счётчиком пользовательской выдачи.
В spec записать, считает ли endpoint весь результат площадки **до** локальных
фильтров приложения.

## Probe 4 — договорная цена и detail response

На пользовательской странице 2026-09-07 подтверждено актуальное объявление с
договорной ценой: `https://www.kufar.by/item/1083745157` (Olympus IS-3000).
Сначала сохранить HTML карточки, затем — ровно один запрос к secondary detail
endpoint.

```bash
curl --fail-with-body \
  'https://www.kufar.by/item/1083745157' \
  -o tests/fixtures/kufar/2026-09-07-electronics-negotiable.html
```

```bash
curl --fail-with-body --get \
  'https://api.kufar.by/search-api/v2/item/1083745157/rendered' \
  --data-urlencode 'lang=ru' \
  -o tests/fixtures/kufar/2026-09-07-electronics-negotiable-item.json
```

В raw detail проверить:

- `price_byn`, `price_usd`, `currency`;
- `remuneration_type` или иной явный признак договорной цены;
- `ad_id`/`list_id`, `account_id`, `company_ad`;
- наличие отдельного platform status (`active` / inactive / sold / removed или
  эквивалент);
- если status отсутствует — это тоже результат, его нужно прямо записать.

## Probe 5 — HTML embedded state

В сохранённом HTML найти `<script id="__NEXT_DATA__">` без выполнения JS.
Secondary evidence от 2026-09-06 ожидает состояние в одном из путей:

- `props.pageProps.initialState`;
- `props.initialState`.

Для выдачи ожидается `initialState.listing.ads` и pagination; для detail более
раннее browser evidence указывает на `initialState.adView.data.initial`.

Если `__NEXT_DATA__` отсутствует, но DOM содержит карточки/цену/локацию — в spec
оставить подтверждённый DOM fallback и снять гипотезу про embedded state именно
для товарного HTML.

## После probe

1. Не редактировать raw fixtures вручную.
2. Обновить `docs/superpowers/specs/kufar-api-contract.md` только по наблюдаемым
   полям и ответам.
3. Отметить acceptance criteria `1.0.1` только после наличия page1 + page2 +
   negotiated fixture + `/count` + вывода price/status.
4. Затем `npm run docs:ops:refresh && npm run docs:ops:check` и обычный PR в
   `main`.
