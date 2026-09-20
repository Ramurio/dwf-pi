# Эксперименты и отложенные направления

Это не список обещанных функций и не альтернативный production runtime.
Рабочий backend запускает отдельный процесс на pi worker.

## Несколько SDK-сессий в одном Node

`spikes/session-pool-benchmark.ts` сравнивает N=1,4,8,16 сессий в одном процессе
с отдельными дочерними Node. Используются реальные createAgentSession/prompt/
abort/dispose и детерминированный fake stream, без пользовательских credentials.

```sh
node --import tsx spikes/session-pool-benchmark.ts
node --import tsx --test tests/campaign-sdk-pool.test.ts spikes/session-pool-benchmark.test.ts
node --import tsx --test tests/session-pool-tools.test.ts tests/session-pool-lifecycle.test.ts
```

Измеряются setup сессии, создание общего ModelRuntime, готовность всего пула и RSS
родителя плюс его детей. Суммарный RSS может повторно учитывать shared mappings;
это не уникальная физическая память. Setup/RSS не доказывают throughput моделей,
квоты провайдера или допустимый production-параллелизм.

Offline suites проверяют независимые cwd/history, read/write, ошибку и отмену
одной сессии, dispose и общий fake OAuth refresh под файловым lock.
Это не OS-изоляция и не реальная серверная ротация токенов.

**Блокер production-пула:** после SIGKILL общего Node detached Bash-команды
могут продолжать эффекты. `session-pool-lifecycle` воспроизводит это и завершает
только свои fixture-процессы. Нужны внешний контроль команд, связь с attempts,
проверка через настоящий RunStore/reconcile, сложные деревья потомков, refresh
между процессами/при отмене и длинные ходы с compaction/repair. Успешный benchmark
не разрешает заменять текущую модель workers.

## Идеи из исследований, не отдельные готовые продукты

- Общий recipe implement → check → review с точной revision и отрицательными сценариями.
- Единый SDK/provider conformance набор поверх существующих специализированных тестов.
- Воспроизводимый benchmark качества ревью и корпус известных дефектов.
- Более понятные причины остановки и карточки результатов в существующем UI.
- Индекс «утверждение → доказательство → patch → validation» без отдельного сервиса.

Части этих направлений уже есть в коде/skill. Перед новой задачей сверяйте разницу
с текущей реализацией; не внедряйте весь старый исследовательский отчёт целиком.
Миграция scheduler, широкий upgrade зависимостей и отдельные новые продукты
не являются необходимым продолжением уборки репозитория.
