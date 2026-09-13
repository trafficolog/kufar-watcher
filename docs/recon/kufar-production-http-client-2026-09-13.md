# Live production Kufar HTTP probe — 2026-09-13

## Зачем выполнялся probe

Повторный аудит отделил browser/manual reconnaissance от реального production network path. Нужно было проверить не браузерный доступ, а фактическое поведение существующего `KufarHttpClient` со штатной идентификацией приложения и существующего HTML fallback path.

Probe был одноразовым. Его test harness и workflow step не являются постоянным integration gate и удаляются после фиксации результата.

## Среда и ограничения

Evidence получен в GitHub Actions `verify` **#1417**, run id `34774156382`, probe head `36d1a2527a72dbcbd8eb38767cf0a3d819ee3fed`.

Использовались:

- production `KufarHttpClient`;
- default `User-Agent: kufar-watcher`, без custom request headers;
- production global rate limiter с cadence `2–5s`;
- production `KufarHtmlFallbackAdapter`;
- production `extractKufarEmbeddedState()` / `kufarSearchPayloadFromEmbeddedState()` path через adapter;
- production `normalizeElectronicsSearchPage()`;
- пользовательский listing `https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5`;
- hard bound 100 HTML pages.

Не использовались proxy/VPN, browser User-Agent, browser fingerprint, cookies, IP rotation или другие способы обхода ограничений.

В CI log намеренно не писались raw HTML, объявления и opaque cursor values. Сохранялись только status, attempts, page number, normalized listing count, carrier id, наличие next cursor и типы pagination token.

## HTTP outcome

Probe дошёл до terminal page за 30 запросов.

- Все 30 запросов: HTTP `200`.
- Все 30 запросов: `attempts=1`.
- `403`: не наблюдался.
- `429`: не наблюдался.
- `5xx`, timeout и network error: не наблюдались.
- На каждой странице найден `scriptId="__NEXT_DATA__"`.
- Embedded listing state на каждой странице успешно прошёл production normalizer.

Таким образом, на GitHub-hosted runner текущий application-level User-Agent и штатный HTTP path не требуют browser spoofing для подтверждённого HTML listing.

## Фактическая пагинация

На первой странице raw pagination summary имел `self:null`, `next:string` и соседние string-token entries. На последующих non-terminal страницах присутствовали `prev:string`, `self:null`, `next:string` и соседние cursor entries.

Отдельно важен page 24: production normalizer получил только **11 listings**, но `nextCursor` оставался string. После него успешно прошли страницы 25–29. Это live evidence против эвристики «короткая страница = конец выдачи»; terminal detection должен опираться на pagination cursor contract.

### Terminal page

Terminal была page 30:

- HTTP `200`;
- `attempts=1`;
- `scriptId="__NEXT_DATA__"`;
- 33 normalized listings;
- normalized `nextCursor=null`.

Без сохранения самих cursor values terminal raw pagination summary был:

```text
label=""     token=string
label=""     token=string
label="prev" token=string
label="self" token=null
```

Элемента `label="next"` **не было**.

Это фактическая terminal форма HTML listing на 2026-09-13. Она отличается от ранее охарактеризованной дополнительной допустимой формы `label="next", token=null`, но не конфликтует с текущим runtime contract: общий normalizer уже возвращает `nextCursor=null`, когда `next` отсутствует.

## Вывод

Audit-gap закрыт evidence-only Spike:

- production client получает live HTML с application User-Agent;
- embedded state извлекается существующим parser;
- реальная cursor traversal работает через production fallback path;
- current live terminal page определяется отсутствием `next`, а не коротким размером страницы и не обязательным `next.token=null`;
- product remediation по этому пункту не требуется.

Постоянный live network test намеренно не добавляется: Kufar остаётся внешней системой, а deterministic CI продолжает работать на fixtures/integration boundaries без зависимости от доступности площадки.
