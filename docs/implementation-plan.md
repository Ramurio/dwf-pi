# Реализация рекомендаций аудита

Начата 2026-09-10 по поручению «выполняй все это». Полный объём определяется
[аудитом](project-review-2026-09-10.md); эта таблица отслеживает выполнение, а не
заменяет его сокращённым MVP. Статус «готово» требует кода и соответствующей проверки.
Дополнен поручением «работай над этим и тем что мы определили прошлым goal»:
[применимые идеи diagram-design](diagram-design-review.md) входят в общий объём.

| Направление | Требуемый результат | Состояние / доказательство |
| --- | --- | --- |
| Результаты | Явные outcome, причина, доказательства; rejected не становится tested preset | Не начато |
| Ожидания | Узел ожидания, сохраняемая причина/схема ответа, разрешение через service/UI, recovery | Не начато |
| Наблюдение | Одна проекция outcome/liveness для CLI/MCP/watch/browser | Не начато |
| Usage | Учёт каждого ответа, cache/reasoning, попытки, dedup, отмена/ошибки, раскрытие сумм | Backend/API/UI реализованы; 65 targeted tests и браузерный fixture, см. usage.md. Общая приёмка с будущим recovery остаётся обязательной |
| Восстановление | Типы ошибок, безопасные policies retry/collect, исправление формата, reconciliation | Не начато |
| Артефакты | Snapshot/digest, версии критериев, применимость checks/reviews, diff | Не начато |
| Интеграция | Отдельный integration workspace, проверки объединения, контроль target head | Не начато |
| Authoring | Рецепты в обычный граф, агрегация коллекций, schemas и dataflow diagnostics | Не начато |
| Симуляция | Публичный запуск сценариев с заданными outputs, отрицательные пути до inference | Не начато |
| Старт | Адресуемый prepared plan, запуск именно его, idempotency повторной доставки | Не начато |
| Browser | Обзор результата, трасса/причины, timeline/checkpoint, council, artifacts/diff, usage | Не начато |
| Presets | Формы запуска, явное сохранение, версии/diff, копирование в draft | Не начато |
| Browser navigation | Deep links, reload state, terminal handoff, project search, opt-in notifications | Не начато |
| Graph readability | Раздельные порты/рёбра, обход узлов, подписи, стабильный обзор с раскрытием scopes | Маршруты/порты/подписи реализованы, 10 browser API/layout tests и in-app QA; обзор с раскрытием групп ещё не начат |
| Run comparison | Согласованные trace/timeline, сравнение проходов и первое расхождение с версией критериев | Не начато |
| Journal | Компактные reads, content-addressed plans/resources, paging/events, streaming logs | Не начато |
| Retention | Размеры и явная проверяемая очистка принадлежащих run данных | Не начато |
| Worker capabilities | Явные web/MCP tools, схемы/права/версии, фактический каталог | Не начато |
| Context | Frozen project instructions, project/global roles/prompts, политика длинных сессий | Не начато |
| Installation | Собранный versioned runtime, compatibility/migrations, doctor/upgrade/rollback | Не начато |
| Provider integration | Проверяемый Grok adapter fingerprint/compatibility без выдуманных model IDs | Не начато |
| Maintainability | Общие типизированные contracts/projections, browser typecheck, meaningful CI | Не начато |
| Acceptance | Негативные сценарии, свежий skill forward test, проверка качества council на известных дефектах | Не начато |

Сохраняются: local first, pi backend, машинная генерация TS + Effect, самостоятельный
supervisor, неизменная активная топология, отсутствие произвольных лимитов и
обязательных согласований по умолчанию. Удалённая платформа, marketplace и изменение
активной топологии отложены в самом аудите и в этот объём не входят.

## Проверки, обязательные перед завершением всей работы

Approve; request_changes→repair; inconclusive→ожидание; failed tests; изменение
артефакта после review; ошибка одной ветки council; отмена после расхода; смерть
supervisor в worktree; повтор start; patch после prepare; конфликт и failed tests
при интеграции. Для каждого проверяются runtime, API, сохранённые данные и UI.

Наблюдавшиеся ранее два таймаута полного параллельного тестового набора также
требуют локализации. Последовательные 206/206 на исходном дереве не доказывают,
что причина исправлена.
