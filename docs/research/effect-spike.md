# Spike: реальный `@effect/workflow` memory engine

Проверено 2026-09-08. Это небольшой исполняемый эксперимент с API, не реализация
продукта и не доказательство восстановления после падения процесса.

## Версии и источник API

Локально установлены `effect@3.22.1`, `@effect/workflow@0.19.1`, `tsx@4.20.6`.
Среда запуска: Node `v26.8.1`.

Перед написанием тестов прочитаны опубликованные вместе с пакетом declarations и
исходники `Workflow`, `WorkflowEngine`, `Activity`, `DurableDeferred` в
`node_modules/@effect/workflow/{dist/dts,src}`. В частности, реализация
`WorkflowEngine.layerMemory` хранит executions, activities и deferred results в
обычных `Map`. Ключ activity в этой версии:

```text
${executionId}/${activity.name}/${attempt}
```

Исходники доступны также в [официальном репозитории Effect](https://github.com/Effect-TS/effect/tree/main/packages/workflow/src),
но выводы этого spike относятся именно к локально установленной версии, а не к
будущему содержимому `main`.

## Что фактически запущено

```sh
node --version
npm ls effect @effect/workflow tsx --depth=0
node --import tsx --test spikes/effect-workflow.test.ts
```

Последняя команда: **5 passed, 0 failed, 0 skipped**, exit code 0. Код находится в
[spikes/effect-workflow.test.ts](../../spikes/effect-workflow.test.ts). Здесь нет
мока workflow engine, pi или LLM; activities намеренно содержат счётчики и
детерминированные заглушки полезной работы, чтобы проверить контракт движка.
Каждый engine и ожидания имеют ограниченный timeout.

Node 26 выдал `DEP0205` о `module.register()` из загрузчика TypeScript. Запуск
тестов успешен; это предупреждение не связано с контрактом workflow.

При доработке polling helper промежуточный запуск дал 4/5: `Effect.repeat` с
`schedule` возвращает output schedule, а не последнее значение poll. Helper
исправлен на `Effect.delay` перед повторением с `until`; итоговый запуск выше
проходит. Это особенно полезно учитывать в generated-коде ожидания статуса.

## Наблюдения

| Эксперимент | Проверенное поведение |
| --- | --- |
| Activity → `DurableDeferred.await` → completion deferred | Workflow сначала `Suspended`; после сигнала его тело исполняется второй раз, но завершённая activity исполнялась один раз и возвращает прежний результат. |
| Повторное `execute` с тем же idempotency key после завершения | Результат возвращается без ещё одного исполнения тела или activity в том же engine. |
| Три шага цикла с именем `review` | Результаты `[0, 0, 0]`, число фактических исполнений 1: имя автоматически не получает индекс итерации. |
| Три шага с `review/visit/0`, `review/visit/1`, `review/visit/2` | Результаты `[0, 1, 2]`, фактических исполнений 3. |
| Новый engine, прежний workflow/idempotency key | Activity исполняется снова. Память предыдущего engine не восстановлена. |
| `workflow.interrupt` во время активной activity | Вызов возвращается, activity продолжает ждать. После явного release завершается её работа и scope finalizer; итог workflow — failure с interruption cause, затем workflow failure finalizer. |

Тест interruption синхронизируется через `Deferred`: сначала подтверждён вход в
activity, затем запрос остановки, проверка отсутствия cleanup, затем явный release.
Поэтому вывод не зависит от предположения, что короткого sleep «должно хватить».

## Следствия для компилятора графа в TypeScript + Effect

1. Генерировать стабильную identity **каждого посещения** узла. Минимально нужны
   node ID, путь ветки/вложенного workflow и вектор индексов циклов; простого
   `node.id` недостаточно. Выбор формата должен исключать коллизии разделителей.
   При replay идентификаторы должны совпадать; случайный UUID на каждом проходе
   тела workflow разрушит переиспользование activity.
2. Фиксировать revision графа и generated artifact для запущенного execution.
   Изменение графа требует явного протокола revision/migration; нельзя молча
   подменять управляющий код уже начатого запуска.
3. Помещать внешние эффекты (pi request, shell process, запись артефакта) за
   activity boundary. Вне activities тело workflow переисполняется. Даже
   activity boundary сама по себе не доказывает exactly-once для внешнего
   сервиса при сбое между side effect и фиксацией результата.
4. Для approve/reject signal подходит именованный deferred с сериализуемой
   схемой. Этот тест проверяет доставку в пределах одного engine, а не
   персистентный inbox или авторизацию отправителя сигнала.
5. Для фактической остановки pi нужен контракт worker abort/process termination
   и управление scope. Одного `Workflow.interrupt` в проверенном memory engine
   недостаточно, чтобы прервать уже работающий worker. Activity finalizer — место
   для освобождения локального ресурса; workflow finalizer отражает терминальный
   результат. Наличие finalizer не означает его исполнение при `SIGKILL`.
6. `layerMemory` годится для smoke tests и эксперимента с compiler/runtime
   semantics. Disk durability, crash recovery, журнал событий и восстановление
   in-flight запросов должны проверяться отдельно на выбранном persistent
   backend. Этот spike не обосновывает обещаний о такой надёжности.

Не проверены: persistent engine, сетевые/LLM операции, replay после process kill,
concurrent activities с одинаковым именем, retry policies, child-workflow
cancellation, компенсации, совместимость с минимальной версией Node. Это границы
эксперимента, а не утверждения о невозможности соответствующих функций.
