# Сквозной live запуск через generated runtime

2026-09-08, Node 26.8.1, pi 0.85.0, `openai-codex/gpt-5.6-sol`, thinking `low`.
Probe: `spikes/workflow-live.ts`; опциональный запуск, не часть offline test suite.

```sh
node --import tsx spikes/workflow-live.ts --provider openai-codex --model gpt-5.6-sol
```

Проверенный путь:

1. Отдельные CLI-процессы создали draft и собрали блоки/связи через patch.
2. CLI `run.start` завершился; detached supervisor продолжил workflow во внешнем cwd.
3. Входной fixture содержал ошибочный ответ 41 для 6×7. Настоящий reviewer выдал
   `request_changes`; его результат проверен строгой output schema и revision binding.
4. После admission review отправлен pause; review завершился, repair ещё не стартовал.
   Состояние стало `paused`.
5. Другой CLI-процесс вызвал resume. Настоящий implementer вернул исправленный ответ 42.
6. Backedge вернул исполнение к тому же узлу review. Новая независимая pi-сессия
   выдала `approve` для `repair-v2`. Финальный output совпал с проверенной revision.

Результат: 3 agent activations, 2 review visits, разные reviewer session files,
1690 input tokens, 274 output tokens. Все workers завершились, metadata PID очищены.
Временные журналы/транскрипты удалены после проверки; секреты в вывод не попадали.

Это доказательство реального author→generated TS+Effect→pi→pause/resume→review loop
через CLI и независимый service client. Оно не заменяет проверку MCP, Git worktree,
council policy или всех возможных задач. Deadline 180s существует только внутри
probe и не является лимитом рабочего workflow.

Повторная сквозная проверка после добавления presets: тот же review-loop прошёл
с 1695 input и 272 output tokens. Успешный план сохранён в обеих областях; draft
после сохранения изменён. `preset.run` через другой CLI запустил прежний frozen plan
с новым input (`next-task-v1`, уже правильный ответ 42). Новый reviewer одобрил
этот input; нового repair не было. Новый run ID и session file отличаются,
plan hash сохранён, изменённый draft не повлиял. Дополнительный worker: 581 input,
72 output tokens. Таким образом, проверен весь путь author→run→pause→resume→
review-loop→save→edit draft→rerun preset с настоящими pi workers.
