# Spec — Kufar MVP routing perimeter

> Статус: **current release scope для `1.0.0`.** Это не Post-MVP документ.
> Периметр следует полной production-цепочке `parse → route → build API request`
> и подтверждённым Kufar contracts; одного успешного routing недостаточно.

## Гарантированный периметр `1.0.0`

Release acceptance гарантирует только два request-buildable URL shape, которые
проходят не только `routeKufarQuery()`, но и текущий `buildKufarApiUrl()`:

| Сценарий | Обязательная CanonicalQuery semantics | Подтверждённый acceptance URL |
|---|---|---|
| Игры и приставки в Минске | host `kufar.by` / `www.kufar.by`; category `igry-i-pristavki`; region `minsk`; operation `null`; `pathFilters=[]`; текстовый `q~...` может отсутствовать или задавать query | `https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5` |
| Покупка квартир в Минске | host `re.kufar.by`; category `kvartiru`; region `minsk`; operation `kupit`; `pathFilters=[]`; search query отсутствует | `https://re.kufar.by/l/minsk/kupit/kvartiru` |

Имена adapter kinds (`electronics`, `real-estate`) — внутренние labels и не
означают поддержку всей электроники или всей недвижимости. Точно так же успешная
классификация URL в adapter kind ещё не означает, что для CanonicalQuery
существует подтверждённый API mapping.

В заявленный `1.0.0` perimeter, в частности, не входят:

- `kufar.by/l/igry-i-pristavki` без региона Минск;
- `igry-i-pristavki` для другого региона;
- electronics URL с дополнительными path filters;
- `re.kufar.by/.../snyat/kvartiru`;
- real-estate категории вроде `doma`;
- общий `/elektronika` route;
- категория «Авто», которая отдельно и явно исключена из зоны интересов проекта.

Некоторые дополнительные query-level параметры могут технически проходить
текущий builder, но сами по себе не расширяют release acceptance perimeter.
Authoritative acceptance baseline — два shape выше.

## Acceptance gates

- `5.0.4` — ранняя приёмка MVP-1: один end-to-end monitor на подтверждённом
  Minsk `igry-i-pristavki` shape и один на Minsk `kupit/kvartiru` shape.
- `5.6` — финальная приёмка `1.0.0`: среди пяти live monitors минимум один
  использует каждый из этих двух request-buildable shape; итоговый checklist
  фиксирует результат по обоим.

Успех одного shape не закрывает двух-path perimeter. Успешная проверка этих двух
shape также не является evidence поддержки любой другой category/region/operation
комбинации.

## Расширение периметра

Новая Kufar category/route/region/operation combination входит в поддерживаемый
scope только после отдельной работы, которая подтверждает и согласует как минимум:

1. live recon и source/API contract для новой semantics;
2. production routing mapping, если требуется новый route/category;
3. request-builder mapping в `buildKufarApiUrl()` вместо
   `unsupported-api-mapping`;
4. adapter/request-normalization semantics, необходимые новой комбинации;
5. acceptance evidence для нового request-buildable URL shape.

Общий `CanonicalQuery`, URL parser, успешный `routeKufarQuery()`, общая структура
search response или существующий adapter kind сами по себе не удовлетворяют
этому gate.

## Связанные документы

- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Отложенные расширения: `docs/superpowers/specs/deferred-requirements.md`
- MVP-1 gate: `docs/tasks/5-0-4-mvp-acceptance.md`
- Release gate: `docs/epics/5-6-acceptance.md`
