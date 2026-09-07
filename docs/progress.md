# Состояние работы

2026-09-08. Реализован и проверен локальный workflow backend.
Ответы пользователя и выбранные решения — в [decisions.md](decisions.md).

## Реализовано

- Исследованы Claude Code Dynamic workflows и девять подходов/движков; первичные
  источники и архитектурные выводы в `docs/research/`.
- Графовый authoring через общие CLI/MCP tools: drafts, atomic revision patches,
  каталог девяти ролей, проверка схемы, условия, циклы, lazy feedback select,
  dynamic map, parallel и вложенные графы. Автор не пишет scheduler.
- Детерминированная генерация настоящего TS + Effect. Frozen execution plan содержит
  версии, source/hash, конкретные model/thinking, prompts/tools/permissions,
  output schemas и полное содержимое skills.
- Отдельный supervisor и pi worker processes. SQLite WAL/FULL хранит run,
  activation checkpoints, outputs и events; owner fencing защищает поздние записи.
  Закрытие harness не останавливает run. Pause дожидается текущих листьев; cancel
  отдельно прерывает workers и обычных потомков. Resume восстанавливает успешные
  checkpoints, отказывается слепо повторять неопределённые внешние эффекты.
- Actual pi SDK: exactly-one strict submit_result, raw validation без coercion,
  resource isolation, fresh reviewer / continued node sessions, settlement,
  usage и очистка очередей перед abort. Глобальные extensions/hooks не подгружаются.
- Codex и узкий Grok subscription bridge. Auth остаётся в pi. Обновлённый xai-auth
  каталог содержит Grok 4.6 и другие реальные IDs; отдельный Heavy ID не обнаружен.
  Optional Grok adapter не блокирует native Codex. Модели/готовность доступны через
  catalog.models и system.doctor.
- Worktree/integrate: run-owned branches, scoped cwd, commit успешных изменений,
  явная интеграция и отказ при конфликте/dirty target. Concurrent coding workers
  требуют отдельных worktrees. Не заявляется OS sandbox или rollback всех эффектов.
- Project/global immutable JSON presets сохраняют успешный frozen plan. Новые inputs
  создают новые runs/сессии; изменённый draft не меняет preset. Credentials,
  результаты/входы запуска и сессии в шаблон не включаются.
- Terminal watch показывает графы, связи, фактические scopes/visits и journal states;
  Ctrl-C отключает viewer. Переносимый skill, однократная установка и MCP stdio
  через один service без отдельной логики планирования.
- Пример council: четыре независимых reviewer и детерминированные unanimous /
  three-of-four policies. Все 162 комбинации решений проверены; revisions
  сверяются, inconclusive не считается одобрением, dissent сохраняется.

## Фактические проверки

- Live Codex: author→run→pause→resume→request_changes→repair→approve, затем save
  project/global→edit draft→preset rerun с новым input и новой сессией. Четыре
  actual worker вызова; отчёт `docs/research/workflow-live.md`.
- Live Grok 4.6: strict nonce + answer42, requested/observed thinking low, actual
  refreshed authenticated catalog. Это не доказательство Heavy entitlement.
- Live Git workflow: actual Codex implementer исправил файл в выделенном worktree,
  command check проверил результат, fresh reviewer прочитал candidate и одобрил
  его; explicit integrate завершился чистым Git state и повторным check.
  Два model вызова; отчёт `docs/workspaces-live.md`.
- Live MCP council: четыре actual Codex reviewer, четыре fresh sessions,
  наблюдаемое перекрытие всех четырёх workers и согласованные artifact/criteria
  revisions. После закрытия первого MCP клиента run продолжил работу; новый
  клиент получил unanimous approve с сохранёнными findings. Отчёт `docs/council-live.md`.
- Официальный MCP SDK client: initialize, tools, authoring, detached launch, закрытие
  первого соединения, второй клиент, pause/resume/events. Современная и legacy
  protocol initialization проверены.
- Независимый skill forward test: пять pure runs через установленный CLI из внешнего
  cwd, branch/map/loops/select, project/global presets и новые inputs после правки
  draft. Все temporary processes/artifacts убраны; `docs/skill-forward-test.md`.
- Чистая production installation с `npm ci --omit-dev --ignore-scripts`: установленный
  CLI из внешнего cwd возвращает каталог всех девяти ролей. tsx/typescript — runtime
  dependencies, а не случайно доступные dev packages.
- Реально установлены `/Users/ramu/.local/bin/dynamicwf` и
  `/Users/ramu/.agents/skills/dynamic-workflows`; bin уже в PATH. Doctor из `/tmp`
  подтвердил локальные prerequisites, 14 cached authenticated models двух providers,
  без inference/network refresh. Harness-specific настройки не изменялись.
- Skill quick_validate и TypeScript typecheck проходят.
- Итоговый `npm test`: 190 тестов, 190 passed, 0 failed, 0 skipped. Набор включает
  actual pi SDK contracts, MCP clients, generated Effect execution, процессы,
  journal recovery, presets и реальные временные Git repositories. Live model
  probes перечислены выше и не входят в этот автоматический набор.

## Границы поставленной версии

Локальное POSIX выполнение, Node >=22.19. Граф после старта не редактируется.
Закрытие viewer/client не отменяет run. После crash неизвестный результат side effect
требует реального reconciliation; retry-authorization mutation не предоставляется.
Permission profiles и worktrees не являются OS sandbox; выданный shell имеет права
пользователя. Grok bridge пока text-only и требует локального reviewed
pi-xai-oauth@1.5.2; адаптер не зависит от соседнего remote-pi проекта.

Нет скрытых caps, обязательных human approvals или default auto-save presets.
Oracle остаётся внешним проектом. Новые модели, расширения ролей, Windows/remote
hosting и ручное редактирование running graph не входят в проверенный контракт.
