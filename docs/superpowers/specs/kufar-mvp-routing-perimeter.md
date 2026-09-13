# Spec — Kufar MVP routing perimeter

> Статус: **current release scope для `1.0.0`.** Это не Post-MVP документ.
> Периметр следует production routing и подтверждённым Kufar contracts; расширение
> требует отдельной задачи и не выводится из общности parser/adapter interfaces.

## Гарантированный периметр `1.0.0`

Release acceptance гарантирует только два route/category mappings, которые
сейчас принимает `routeKufarQuery()`:

| Пользовательский route | Production mapping | Подтверждённый пример |
|---|---|---|
| `kufar.by` / `www.kufar.by` + `igry-i-pristavki` | adapter kind `electronics` | `https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5` |
| `re.kufar.by` + `kvartiru` | adapter kind `real-estate` | `https://re.kufar.by/l/minsk/kupit/kvartiru` |

Имена adapter kinds — внутренние labels. `electronics` не означает поддержку
всей электроники, а `real-estate` — всей недвижимости. Production routing
отклоняет неподтверждённые категории, включая общий `/elektronika` route и
real-estate categories вроде `doma`.

Категория «Авто» отдельно и явно находится вне периметра проекта.

## Acceptance gates

- `5.0.4` — ранняя приёмка MVP-1: один end-to-end monitor на
  `igry-i-pristavki` и один на `re.kufar.by/.../kvartiru`.
- `5.6` — финальная приёмка `1.0.0`: среди пяти live monitors минимум один
  использует `igry-i-pristavki` и минимум один — `re.kufar.by/.../kvartiru`;
  итоговый checklist фиксирует результат по обоим mappings.

Успех одного mapping не закрывает двух-route perimeter. Успешная проверка этих
двух mappings также не является evidence поддержки любой другой категории.

## Расширение периметра

Новая Kufar category/route входит в поддерживаемый scope только после отдельной
работы, которая подтверждает и согласует как минимум:

1. live recon и source/API contract для новой категории;
2. production routing mapping вместо `unknown-category`;
3. adapter/request-normalization semantics, необходимые этой категории;
4. acceptance evidence для нового route.

Общий `CanonicalQuery`, URL parser, общая структура search response или
существующий adapter kind сами по себе не удовлетворяют этому gate.

## Связанные документы

- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Отложенные расширения: `docs/superpowers/specs/deferred-requirements.md`
- MVP-1 gate: `docs/tasks/5-0-4-mvp-acceptance.md`
- Release gate: `docs/epics/5-6-acceptance.md`
