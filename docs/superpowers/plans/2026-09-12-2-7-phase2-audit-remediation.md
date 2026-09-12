# План ремедиации повторного аудита фазы 2 — 2026-09-12

## База анализа

Повторное ревью фазы 2 было перепроверено на `main` после merge PR #42: `c22b916238d4ddca869fd7865a6f7ea4cb92e113`. Цель этого документа — превратить подтверждённые находки в независимые TDD-инкременты, а не исправлять их одним большим diff.

## Подтверждённые группы

### P0 — исправить первыми

1. `2.7.1` — malformed `intervalSec` не должен валить startup scheduler для остальных мониторов.
2. `2.7.2` — term normalization должна быть симметричной; multiword term в текущем MVP должен давать явную validation error, а не silent no-match.
3. `2.7.3` — исчерпание description budget терминально для текущего schedule tick и не должно умножаться pg-boss retries.
4. `2.7.11` — lifecycle docs-ops для промежуточных parent states плюс исправление противоречивого acceptance `2.4.4` и фиксация pre-4.3 drift risk.

### P1 — до health/autopause consumers

5. `2.7.4` — finite Run outcomes и восстановление orphan `running` rows.
6. `2.7.5` — один independently writable sellerType source of truth.
7. `2.7.6` — process-independent overlap invariant; сначала characterization, затем durable lock только если gap реально воспроизводится.

### P2 — контрактные/config gaps

8. `2.7.7` — snippet только при description match.
9. `2.7.9` — page cap становится валидируемой операционной конфигурацией при default 5.

### P3 — нагрузочная гигиена

10. `2.7.8` — измерить synchronized job burst и при необходимости ввести стабильный per-monitor stagger без изменения intervalSec.

## Перенесённая integration-gate находка

- **S11 / live scheduler sync:** helper `updateMonitorConfigAndSync()` уже существует, но production edit mutation boundary ещё нет. Это не текущий runtime-дефект фазы 2. Находка сохранена как `5.2.4 — Live scheduler sync после редактирования монитора`, чтобы первый реальный editor path не мог сохранить конфигурацию в обход schedule reconciliation.

## Что сознательно не превращено в bugfix сейчас

- **Canonical URL form (`cmp=0` → `/bez-posrednikov`)**: semantic round-trip стабилен, а оригинальный `sourceUrl` хранится отдельно. Для UI правило: показывать исходный `sourceUrl`, если поле обозначено как введённая пользователем ссылка; reconstructed URL можно показывать только как canonical/technical representation.
- **`re.kufar.by/l/kvartiru`**: это synthetic edge case без подтверждения, что маршрут существует у Kufar. До parser patch нужен live recon; при подтверждённо несуществующем маршруте достаточно document note.

## Порядок исполнения

Каждая карточка выполняется в новой ветке от актуального `main`, с tests-only RED commit, подтверждением ожидаемой причины падения, минимальной production-реализацией, canonical GREEN и отдельной интеграцией. Не объединять P0-задачи в один PR даже если изменения касаются соседних файлов.

## Архитектурные ограничения

- Не менять пользовательский `intervalSec` адаптивно.
- Не увеличивать description budget как замену корректной retry disposition.
- Не добавлять phrase search, regex или morphology в term-contract remediation.
- Не реализовывать epic `4.3` autopause через документационную задачу.
- Не добавлять durable lock, пока characterization не доказал отсутствие достаточного process-independent инварианта у текущего pg-boss path.
- Не реализовывать будущий monitor-editor mutation path внутри remediation эпика 2.7.
