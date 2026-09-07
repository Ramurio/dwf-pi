# Проверка настоящей модели через pi

2026-09-08, Node 26.8.1, pi SDK 0.85.0. Скрипт:
[`spikes/pi-live.ts`](../../spikes/pi-live.ts).

```sh
npm run probe:pi -- --provider openai-codex --model gpt-5.6-sol
```

Фактически выполнено успешно. Модель выбрана из доступного авторизованного каталога,
thinking `low`. Создана отдельная временная сессия с единственным tool `submit_result`;
extensions, skills, prompt templates и context files отключены. Модель получила
арифметическую задачу с уникальным nonce. Raw arguments проверены TypeBox до
возможного приведения типов SDK, затем результат независимо проверен ещё раз.

Наблюдение: один assistant message, один принятый submission, 185 input tokens,
44 output tokens. Это значения usage конкретного вызова, не ценовой прогноз.
`agent_settled` пришёл после `agent_end`; streaming завершился. JSONL transcript
открылся через SessionManager.open с тем же session ID и сохранёнными message entries.
Временная сессия удалена после проверки, секреты и транскрипт в Git не сохранены.

Probe имеет собственный 90-секундный timeout, чтобы проверка не зависала.
Это не default лимит workflow. Скрипт требует явные provider/model и не входит
в offline тестовый набор. Проверку не нужно повторять без новой причины.

## Чего эта проверка не доказывает

Нет проверки качества многошаговой задачи, изоляции ОС, detached supervisor,
смерти процесса посреди записи, replay через reboot или соблюдения всех моделей
thinking/schema. Успех простого tool submission — конкретное доказательство
интеграционной возможности SDK, а не готовый workflow backend.

## Grok

Non-secret `ModelRuntime.listCredentials()` показывает OAuth providers `supergrok`,
`xai-auth` и `openai-codex`. По умолчанию ModelRuntime отдаёт доступные модели только
`openai-codex`: наличие credential под alias не регистрирует provider adapter.
Установлен отдельный `pi-xai-oauth`; подключение его выбранных provider-компонентов
будет проверяться отдельно. Наличие подписки Heavy само по себе не доказывает
доступ к конкретному model ID через данный transport.
