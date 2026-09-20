# Важные ошибки и ограничения

## Исправленные ошибки: обязательные инварианты

| Ошибка | Что сохранять | Регрессия в `tests/` |
| --- | --- | --- |
| Панель другой установки считала supervisor умершим | Проверять сохранённый script/owner/run/store; до PID checkpoint искать тот же процесс | `run-controller`, `run-store` |
| SDK coercion менял JSON до проверки | Валидировать исходные args, не преобразованный результат | `pi-worker`, `execution-plan` |
| Гонка pause → resume выглядела как execution failure | Типизированный отказ допуска без новой activation | `pause-resume-admission` |
| Потеря завершённого OAuth refresh при отмене | Сохранить обновление под lock, не считать caller успешным | `oauth-refresh-abort` |
| Повреждённый preset ломал общий список | Изолировать плохую revision и показать диагностику | `preset-corruption` |
| Legacy usage терялся или считался дважды | Сохранять baseline и известные subtotals без выдуманной полноты | `legacy-usage`, `usage-pages`, `task-usage` |
| Manual reconcile оставлял активный automatic retry | Superseded retry не может допустить новую попытку | `retry-reconciliation` |
| Публичная workflow.patch schema не включала id | CLI/MCP принимают одну опубликованную форму запроса | `public-patch-schema` |
| Bash signal/null exit считался успехом | Signal отдельно от code; неизвестный выход — ошибка | `bash-signal`, `bash-signal-worker` |
| Selected transition оставался от другой ветки | Selection и inspector привязаны к run/activation scope | `graph-transition-scope` |
| Рёбра графа перекрывались | Отдельные маршруты и корректная геометрия | `graph-layout-overlap` |
| Ошибки worker IPC теряли итог/зависали | Ровно один result/error; учитывать exit без close | `process-client` |
| Ответ старому await после continuation | Старый run fenced; нельзя открыть новую работу старым ответом | `continuation` |

Имена suites проверяйте в актуальном `tests/`; важен исполняемый сценарий, а не
историческое число passed. Подробности поведения — в профильных документах.

## Не путать с багом или готовой возможностью

- `succeeded` — техническое завершение, а `accepted` — решение задачи. Council
  с ошибкой провайдера или `inconclusive` не даёт approve.
- SDK read не гарантирует чтение одной очень длинной строки. Подготовьте текстовые
  части и manifest по [read-boundaries](read-boundaries.md); «всё прочитано» без них недоказуемо.
- Нельзя копировать один `.sqlite` активного WAL-журнала и считать это актуальным
  backup. Используйте [online backup](sqlite-backup.md).
- Heartbeat и PID по отдельности не доказывают liveness. Уже работающая старая
  панель не получает новое исправление без перезапуска.
- После crash agent/check эффекты могут быть неопределёнными; обычный resume
  не разрешает повтор. Частичные Git registrations и утраченные файлы требуют
  отдельной инспекции/ремонта; [reconciliation](reconciliation.md) описывает границы.
- Runtime не редактирует топологию активного графа, не является OS sandbox и
  не предоставляет гарантированный rollback внешних эффектов.
- `usage` может быть неполным при оборванном ответе; SDK cost не равен платежу
  по подписке. Неизвестное значение нельзя заменять нулём.
- Provider catalogs меняются. Выбранный thinking и реально наблюдаемый effort
  различаются; не обещайте поддержку по названию модели или подписки.
- Старый `xai-auth` не исполняется как alias native `xai`; исторические планы
  читаются, а миграция задачи требует явного continuation.
- Production pool SDK-сессий не внедрён. Detached Bash может пережить SIGKILL
  общего процесса; условия безопасного внедрения — в [experiments](experiments.md).

## Проверки, которые нельзя преувеличивать

Offline SDK-тесты не подтверждают живые квоты/права аккаунта. UI geometry tests
не заменяют все ручные zoom/theme сценарии. Исторический review или лог относится
к конкретной версии, а не автоматически к текущему дереву.
