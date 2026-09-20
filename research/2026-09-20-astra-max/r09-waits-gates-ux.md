## Финализация новой операции — 2026-09-20

Источник: `run-9dbb044c-664f-4dd8-96c0-57192dc4ed89` (failed, HTTP 503, effects unknown).
Оба сохранённых отчёта уже полны: MD 66622 байта, SHA256 `0bafdf1d874af73c61b752958433e4cc9d7fe55d2fd615ce1a0b786dd9f7e5bb`;
JSON 69880 байт, SHA256 `0db7138bed195a5d62d20407392bd30525f9777166dfe31c0d92ec049b3a8012`. Размеры и хеши проверены.
Перенесены все 7 находок и исторические результаты без повторения tests/probes/Chrome/providers.
Независимо проверены JSON без повторяющихся ключей, соответствие 7 ID/классификаций MD,
32 source paths и ranges, совпадение 14 файлов с прежним worktree и Git blob базы,
хеши двух встроенных fixtures; повторно прочитаны причины B01/B02 в коде.
Новые проверки — E10 в JSON; старые E00–E09 и слова «сейчас/новый cwd» ниже относятся
к предыдущему этапу. Его provenance сохранён как `priorContinuationProvenance`.
Фраза старого E09 о возвращённых хешах не доказывает успешный submit: операция была failed.
Текущий cwd: `/Users/ramu/.dynamicwf/runs/run-b46cf9ab-6e57-4c7a-83dc-e44802a4ab9c/worktrees/296767b722d7bc81389cc890291795fd34e157c7adfa3ccfa548b000fff995ca`.
Добавлены только это пояснение и соответствующий provenance JSON, не новые результаты поведения.
Исторические 83 pass перенесены из хешированной пары; сырые логи заново не проверялись.
По входу управляющего исторические 13 успешных исследований коллекции использовали max;
будущие pi в продолжении — openai-codex/gpt-6-astra thinking=low. Из этого узла pi не запускался;
это не переименование исторических режимов и не утверждение успешности прежнего r09.
Имя папки коллекции сохраняется. Study и publication revisions остаются раздельными.

---

# r09 — UX ожиданий, приёмки и продолжения задачи

## Metadata

- **ID:** r09.
- **Тема:** UX approvals/gates/await и продолжения задачи.
- **sourceRevision:** `e15bc407da8753fd6b683c0aa4a68634e3c458a7`.
- **Дата исследования и завершения пакета:** 2026-09-20, UTC.
- **publicationRevision (отдельно от исследуемой базы):** `3d8ba65ee84402c0e3b0587f70095b7847824a9f`.
- **Фактический cwd новой операции:** `/Users/ramu/.dynamicwf/runs/run-9dbb044c-664f-4dd8-96c0-57192dc4ed89/worktrees/296767b722d7bc81389cc890291795fd34e157c7adfa3ccfa548b000fff995ca`.
- **Исторический cwd E00–E05 (только чтение при продолжении):** `/Users/ramu/.dynamicwf/runs/run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0/worktrees/296767b722d7bc81389cc890291795fd34e157c7adfa3ccfa548b000fff995ca`.
- **Среда исторических проверок E01–E05:** macOS, Node `v26.8.1`; отдельный Chrome `153.0.8010.52` с временным профилем. В worktree нет `node_modules`; профильные TS-проверки выполнены из разрешённого integration-dev с существующими зависимостями. По записи прежнего исследования HEAD обеих копий совпал; `git diff` для исходников/тестов/package/lock не показал изменений перед проверками. В новой операции текущий dev уже на publicationRevision: старые команды из него не повторялись; базовые исходники прочитаны из нового worktree.
- **Режим:** независимое исследование, не реализация. Отчёты коллег не читались. Исходники, tests, PROJECT_INFO, установленный runtime и пользовательские запуски не изменялись. Внешние источники/веб и модели не использовались.

## Continuation provenance — что было сохранено и что завершено сейчас

Источник продолжения: `run-babf9b25-b8f5-45ad-b79c-2b2e5d31d2f0`, исследователь **r09**.
Старая операция закончилась **failed**: retained failure содержит `provider / execution`,
`effects=unknown`, `dispatch=http-observed`, HTTP 200 и `Pi assistant turn failed: terminated`.
HTTP 200 не делает прежнюю операцию успешной. Неопределённые действия не повторялись.

- Старый md найден: **38 612 байт**, SHA256
  `c081214baf157e492ad8029b36f4181ff6980e9f15b73b2c5a78f5332bbfdec7` — совпал с retainedEvidence.
  Его findings и описание опытов заполнены, но приложение заканчивалось обещанием двух скриптов без самих скриптов.
- Старый json **отсутствует**; ни полный пакет, ни прежний успешный итог не приписываются этой попытке.
- Прочитан только собственный `retained/r09-actions.json` из переданного preservedActionEvidence:
  SHA256 `84a99a90d9c655acb957cd18aa9626bbbad274921332ba4b93ba5e7366c2915c`.
  Он хранит **команды**, не их exit codes/stdout. Результаты E01–E05 проверены отдельно по сохранившимся собственным `/tmp/r09-*` файлам, перечисленным ниже.
- **Перенесено:** 7 исходных ID/классификаций, результаты E01–E05 и границы browser/mock,
  положительные контроли исправленного textarea, историческая диагностика harness.
- **Перепроверено:** код причин и контрдоказательств на e15bc40; совпадение 14 относящихся
  исходников/package/lock нового и старого worktree с Git blob базы; SHA256 сохранённых
  файлов, суммы 60+20+3 и согласованность waiting/paused snapshot с result JSON.
  Исправлены неточные указатели: continuation fence — `run-store.ts:571`, cancellation — `572`,
  вызов recovery в инспекторе — `app.js:656–657`. Смысл находок не изменён.
- **Добавлено сейчас:** этот provenance, отдельные post-study refutations, полные два
  сохранённых fixture в приложении, впервые полный report JSON, статическая проверка пакета и финальные хеши.
  Не добавлены новые поведенческие результаты: Node использовался для вывода версии и `--check` копий скриптов в новом `/tmp/r09-continuation.*`.
- В прежний worktree или старые `/tmp` не писали. В новый cwd записаны только два назначенных отчёта.
  Управления прежними/живыми run, браузерными профилями и пользовательскими процессами в этой операции не было.

## Вывод

Подтверждены **два UX-бага**, без обнаруженного обхода серверного допуска:

1. После сохранения ответа на паузе durable wait уже `resolved`, но граф/инспектор и общая проекция продолжают считать его «ждущим ответа». Карточка ответа исчезает, не оставляя квитанции в «Сейчас».
2. Семантическое обновление снимка сохраняет редактор ответа, но выбрасывает клавиатурный фокус с кнопки «Сохранить ответ» и с `summary` данных ожидания. Для submit в настоящем Chrome следующий Space не отправляет ответ, пока пользователь заново не наведёт фокус.

В исходной операции пройдено **83 профильных теста**, отдельно выполнены собственный процессный сценарий паузы/ответа и native-browser fixture. При продолжении перечитаны сохранённые итоги и исходники; эти 83 теста и два поведенческих probe заново не запускались. Зелёные тесты не опровергают дефекты: один существующий тест проверяет сохранность паузы, но не отображение сохранённого ответа; другой проверяет фокус textarea, но не кнопки/summary.

Всего ниже 7 классифицированных записей: **2 bug, 1 idea, 3 already-fixed, 1 unknown**. Последние не следует превращать в новые баги.

## Coverage: пользовательский путь и границы

| Путь | Установлено по текущему коду и проверкам |
| --- | --- |
| Ожидание → положительный/отрицательный ответ | `await` получает JSON, а не специальное универсальное «одобрение». Проверяется зафиксированная схема без преобразования типов; переход и итог определены автором графа. В тестах `allow:false` ведёт к `succeeded` + `rejected`, не к технической ошибке. `src/run-store.ts:562–579`, `src/task-outcome.ts:10–22`, `tests/await-outcome.test.ts:211–256`. |
| Несколько одинаковых вопросов | Отдельные ID/пути, независимые черновики, перестановка карточек не смешивает ответы. Это уже исправлено, R09-AF02. |
| Пауза → ответ → продолжить | Запись разрешена на паузе; `finish` не исполняется до resume. Но подписи между записью и resume неверны: R09-B01. |
| Отказ в приёмке ≠ отмена | `finish rejected/inconclusive` — конечное решение графа, не ошибка worker. В шапке независимо показаны технический статус и исход. Нельзя требовать кнопку resume для успешно завершённого rejected-графа: изменённый план той же задачи создаётся через continuation. `src/observation.ts:46–68`, `src/graph-view/app.js:389–396,453–464`. |
| Отмена | Намерение монотонно; новый ответ после отмены не допускается. Подтверждение привязано к запуску/посещению, смена запуска его закрывает. Это не откат внешних действий и не гарантия завершения неизвестных потомков. `src/run-store.ts:349–368,571–572`; панель отдельно предупреждает о непроверенных группах (`app.js:405–419`). |
| Смерть supervisor во время await | Проверка на собственном процессе: прежний wait ID сохраняется, resolve может возобновить тот же граф без повтора законченной записи. Это не разрешение повторить неопределённый agent/check. `src/run-controller.ts:305–310`, `tests/await-outcome.test.ts:82–110`. |
| Восстановление операции | Инспекция → точный checkpoint/workspaceDigest → accept или одноразовый retry → отдельно resume. При accept сохраняются ошибка/расход исходной попытки; схема и привязки ревью проверяются. Форма фиксирует decisionId и запрос, не повторяет POST автоматически. `src/reconciliation.ts:18–49`, `src/run-controller.ts:312–337`, `src/graph-view/app.js:698–756`. |
| Продолжение изменённого графа | Новый ID, сохранённая задача/история; пауза источника переносится в преемник. Старый запуск ограждён от новых ответов/возобновления. `reuse` не даёт права считать старое approve одобрением нового артефакта. `src/run-store.ts:352,571`, `src/lineage.ts:316–360`, `tests/continuation.test.ts:199–271`. |
| Доступность действия с клавиатуры | Native DOM, Tab/Space, перерисовка, фокус textarea, кнопки и disclosure: R09-B02. Screen reader и IME не проверены, R09-U01. |

### Что означает «gate» в этом проекте

Отдельный обязательный approval/gate-этап не найден в контракте: есть авторские условия, `await`, `finish`, а также проверяемый допуск восстановления. `resolvedBy`/`actor` не становятся криптографически удостоверенной личностью. Не предлагается добавлять скрытого человека, квоту, повтор или новый обязательный этап согласования.

Привязка reviewer действует, когда итоговая схема требует `artifactRevision` (включая собственную схему): нужна непустая строка на верхнем уровне входа, выход должен точно повторить её и переданную строковую `acceptanceCriteriaRevision` (`src/run-runtime.ts:359–372`). Это версия рецензируемого артефакта, не хеш нового отчёта критика. Runtime не вычисляет доказательную подлинность произвольной переданной строки. См. отдельно post-study уточнение документации `3d8ba65` ниже. Reconciliation проверяет записанный вход, reuse — происхождение и версии. Однако произвольный `finish.evidence` — объявленные данные, не автоматическая сертификация качества/внешнего эффекта. Эта граница прямо описана в `PROJECT_INFO/outcomes-and-waits.md`, и `src/task-outcome.ts:10–14` действительно проверяет форму, а не доказательную силу. Успешные offline-проверки отрицательных веток рецептов S/P/C не доказывают качество live-ревьюера.

## Findings

### R09-B01 — bug — ответ сохранён на паузе, но узел всё ещё «Ждёт ответа»

**Важность:** средняя, правдивость состояния и уверенность пользователя в сохранении решения. Потери ответа или снятия паузы не обнаружено.

**Триггер:** дождаться await → «Пауза» до `paused` → сохранить валидный ответ → оставаться на паузе, не нажимая resume. Это нормальный разрешённый путь, а не искусственное редактирование БД.

**Ожидается:** различать «ответ ещё нужен» и «ответ сохранён, выполнение остановлено оператором». Сохранённое значение/идентичность ожидания должны быть проверяемы в UI; узел ещё не обязан стать `succeeded`, и работа не должна запускаться сама.

**Наблюдалось (E04, затем E05):**

| Факт | Значение |
| --- | --- |
| Запуск | `status=paused`, `desired=paused` |
| Durable wait | `status=resolved`, `response={"allow":false}` |
| Реально активных задач | `activeKeys.length=0` |
| Проекция ожидающих ответа | `waitingKeys.length=1` |
| Узел графа / инспектор | `waiting` / «Ждёт ответа» |
| «Сейчас» | 0 wait-карточек; «Новых задач пока нет. Ожидание следующего шага.» |
| Шапка | wait-summary скрыт, «Продолжить» доступна |
| Терминальный `monitorBody` | по-прежнему выводит вопрос, wait ID и ссылку на контракт ответа |
| После resume | `succeeded`, `taskOutcome=rejected`, ожидающих 0 |

**Причина с file:line:**

1. `src/run-store.ts:573–577` сохраняет response/status/event. Это успешная транзакция.
2. В `src/run-runtime.ts:163–167` `waiting:false` записывается **после** `await this.gate(signal)`. На паузе gate не пропускает, поэтому внутренняя metadata продолжает означать незавершённый await.
3. `src/observation.ts:37–39,68` превращает эту metadata в публичное `waiting`/`waitingKeys`, не сверяясь с durable wait. `src/graph-view/model.ts:54–57,83` делает то же; `src/monitor.ts:105–107` повторяет вопрос.
4. Вторая половина UI, напротив, использует настоящую таблицу ожиданий: `app.js:466–469,1136–1137` скрывает resolved-карточку. После исчезновения карточки исчезает и подсказка о паузе (`1178`); общего состояния «ответ сохранён» здесь нет (`1187–1198`).

**Почему это не уже исправленный await draft/ownership:** ID/текст/раскрытие не перепутаны, POST не повторяется, сервер правильно сохраняет ответ. Несогласованность возникает между *durable response* и *ещё не завершённой активацией*, а не между старым и новым браузерным запросом.

**Контрдоказательства и границы:**

- `tests/await-outcome.test.ts:112–124` зелёный и правильно защищает паузу. Он не проверяет `waitingKeys`, подпись узла и квитанцию после resolve.
- `tests/graph-view-observation.test.ts:286–303` уже утверждает исчезновение формы после resolved и защищает актуальность снимка, но не проверяет оставшуюся подпись узла или квитанцию.
- Наш E04 подтвердил отсутствие finish до resume, один `wait.resolved` после точной повторной доставки и отказ конфликтующему ответу. После resume отрицательный ответ был использован правильно.
- `run.waits`/snapshot содержат сохранённый ответ. Недоступность обычной карточки не означает утрату журнала. По коду без паузы это может быть коротким промежутком; длительность не измерялась. Доказанный длительный случай — ручная пауза.

**Воспроизведение:** E04 `paused.mjs` и E05 `browser.mjs`, полные fixtures в приложении. Первый исполняет настоящий supervisor и SQLite без модели; второй рисует полученный paused snapshot текущим `app.js` в отдельном Chrome.

**Минимальное изменение, не внедрено:** в общей проекции/представлении сопоставлять ожидание с durable `WaitRecord` по ID/key, отдельно показывать «Ответ сохранён · на паузе» и read-only значение; исключать resolved из списка вопросов, требующих ответа. Не считать такую активацию ни исполняющейся работой, ни уже успешно завершённой. **Не переносить механически `waiting:false` перед gate**: эта metadata также участвует в учёте активных листьев/паузы.

**Риск:** рассинхронизировать watch/browser или ошибочно объявить завершение await; смешать одинаковые вопросы map по nodeId вместо точного key. Сохранять прежний контракт допуска и совместимость старых записей.

**Критерий приёмки:** реальный pause→resolve(true/false) оставляет запуск paused и 0 активных работ, показывает точную квитанцию/ответ, не предлагает повторно отвечать, не пишет «Ждёт ответа»; unresolved-сосед остаётся вопросом. Resume потребляет сохранённый ответ один раз. Те же факты видны в watch и snapshot. Ни отмена, ни continuation не должны переоткрывать сохранённый ответ.

### R09-B02 — bug — семантический опрос выбрасывает фокус с действия await

**Важность:** средняя для клавиатурного управления. Ошибочная отправка или потеря текста не доказаны; доказано исчезновение текущей точки взаимодействия.

**Триггер:** во вкладке «Сейчас» ввести JSON и перевести Tab на «Сохранить ответ»; до Space приходит семантически изменившийся снимок того же запуска. Эквивалентный случай — фокус на «Данные и формат ответа». Сам по себе heartbeat не достаточен.

**Ожидается:** если тот же wait всё ещё открыт и действие доступно, фокус остаётся на той же кнопке/summary, а Space выполняет выбранное действие, не требуя повторной навигации.

**Наблюдалось, Chrome 153 (E05):**

- Tab действительно выбрал `BUTTON / Сохранить ответ`.
- Обновление только heartbeat сохранило `BUTTON`.
- Обновление отображаемых данных привело к `document.activeElement.tagName === 'BODY'`.
- Trusted Space после этого не вызвал mock resolve (0 POST). Повторная фокусировка редактора → Tab → Space вызвала ровно 1 mock resolve.
- Фокус summary тоже стал BODY; само `details.open === true` сохранилось.
- Положительный контроль: textarea сохранила JSON, фокус, backward-selection `[2,7]`. Сохранение disclosure/caret действительно работает.

**Причина с file:line:** `src/graph-view/app.js:1459–1468` перерисовывает панель при значимом изменении signature. `renderNow` в `1133` удаляет карточки целиком. `renderPanel:490–506` восстанавливает фокус только для элемента с `dataset.waitId`; такой атрибут имеет textarea (`1157–1160`), но не submit (`1162–1175`) и не summary (`1144–1146`). У удалённого native DOM control фокус становится BODY. Сохранённое `details.open` не сохраняет клавиатурный фокус заголовка.

**Контрдоказательства и границы:**

- Не «каждый опрос»: heartbeat исключён из signature и контроль прошёл.
- Не повтор старого бага caret/scroll: текущий тест `tests/graph-view-observation.test.ts:120–132` и native-положительный контроль подтвердили исправление textarea. Existing fake DOM не моделирует нативную потерю activeElement при удалении focused button.
- В E05 для детерминированной перерисовки изменялся счётчик usage в fixture snapshot; никакой реальный агент/провайдер не вызывался. Причинная связь применима к любому изменению signature, например обновлению соседней ветви; частота таких событий в живой задаче не измерялась.
- Не заявляется недоступность кнопки вообще: после нового наведения фокуса действие работает. Не проверялась физическая клавиатура/assistive technology, но CDP Tab/Space для submit имели `isTrusted=true`, native DOM и default action Chrome были настоящими. Для summary фокус задавался через native `.focus()`, не отдельным Tab-проходом; проверена потеря фокуса, но не нажатие Space на summary.

**Воспроизведение:** E05, приложение `browser.mjs`. Загружаются реальные `index.html`, CSS и модули этого worktree; отключён только автоматический startup/polling, снимок обновляется вручную через производственный `refreshSnapshot`. Любой resolve остаётся в mock fetch страницы; mutations в панель Dynamicwf не отправляются.

**Минимальное изменение, не внедрено:** сохранить/восстановить не только редактор, но и фокус конкретного control (`run visit + waitId + submit/summary`) либо не заменять неизменившийся keyed DOM. Восстанавливать только при всё ещё доступном контроле, не уводить фокус обратно после смены запуска, разрешения вопроса, отмены или ограждения continuation.

**Риск:** украсть фокус у другой карточки/посещения, сфокусировать исчезнувшее действие, испортить уже сохранённые caret/scroll или позволить двойную отправку.

**Критерий приёмки:** native Chrome fixture с Tab/Space на submit и summary переживает semantic update и перестановку соседей; Space на submit даёт ровно один разрешённый resolve, Space на summary переключает только соответствующее details без POST; heartbeat остаётся no-op для DOM. Переход к другому запуску и закрытие wait не возвращают старый фокус/кнопку. Положительные проверки текста, backward selection, scroll и disclosure остаются зелёными.

### R09-I01 — idea — короткий безопасный переход от причины остановки к конкретной операции

**Факт:** в шапке технического сбоя есть подробности ошибки (`app.js:398–404`), но запуск recovery-формы находится в деталях выбранной failed/interrupted-активации (`656–657,667–695`). Для непроверенных групп уже есть переход к задаче (`415–417`). При `failed` кнопка resume намеренно скрыта; это не баг.

**Вывод/предложение:** добавить в блок причины сбоя навигационное «Показать неудачную операцию»; при нескольких операциях — список точных key/path/attempt. Это сокращает путь к существующей явной инспекции, не создаёт автоматический retry/accept и не делает модельное request_changes технической ошибкой. Для `succeeded + rejected/inconclusive` дать краткое пояснение: граф завершён, изменённый план той же задачи — отдельный continuation через существующий CLI/MCP, не resume исходника.

**Минимум:** только навигация/пояснение, без нового mutation endpoint, автоматического сканирования каталогов и дополнительных approval. **Риск:** выбрать не тот элемент map/visit или предложить восстановление результата, уже запечатанного collect/родителем. **Приёмка:** выбор открывает точную активацию и её существующие blockers; один клик не выполняет POST и не запускает файловую инспекцию; для rejected без failed leaf не предлагается retry. Пользовательское исследование эффективности такого сокращения пути не проводилось; это idea, не установленный дефект.

## Already-fixed / refutations

### R09-AF01 — already-fixed — владение асинхронными эффектами панели

Коммиты `b4aaa3d`, `10d5cc6`, `1ee48ff`, `b04ef8d`, `d72df5d` присутствуют в истории этой базы. Код `app.js:165–180,1450–1482,1513–1540,1567–1581` проверяет актуальность выбора/запроса; поздний 401 не перезагружает новое посещение; cancel связан с исходным ID/посещением. Recovery receipts сохраняются под прежним ключом, не меняя новое уведомление (`744–750`). E01 прогнал соответствующие late-response, body-decoding, navigation туда/обратно и cancel cases. Старую проблему ownership не переоткрывать. Это не утверждение о любых мыслимых сетевых перестановках.

### R09-AF02 — already-fixed — идентичность, черновик и раскрытие await

`b4aaa3d` и `fea2136` дают отдельные draft по wait ID, видимый путь/ID, сохраняемые disclosure, textarea focus/selection/scroll (`app.js:484–507,1138–1161`). E01: перестановка одинаковых вопросов, соседнее обновление, смена вкладки/запуска; E05: настоящий Chrome подтвердил текст/backward-selection/open. Полный reload по документированному контракту сбрасывает in-memory draft — это не новая потеря при обычном polling. `e15bc40` отдельно описывает неуниверсальность disclosure для других инспекторных блоков; она здесь не переоткрывается. R09-B02 касается **других controls**, не уже исправленного textarea.

### R09-AF03 — already-fixed — старый await не запускает заменённый/отменяемый run

Защита `src/run-store.ts:562–579` проверяет continuation fence и cancellation до изменения открытого ожидания; точный повтор уже сохранённого ответа идемпотентен, метка первого источника сохраняется. Контроллер не запускает заменённый источник (`src/run-controller.ts:309`), а UI не предлагает там ответ/resume (`app.js:394,1125–1129,1148–1154`). E01 прошёл source-fence, наследование паузы и сохранность одинаковой повторной доставки; E03 проверил атомарность с событием и монотонность отмены. Фиксация по истории — `3b8ad7e` и последующее отображение ограничений в `b4aaa3d`. Новый R09-B01 не означает нарушения этой защиты.

## Post-study already-fixed — отдельно от находок исходной базы

Эти две границы отмечены по входу продолжения и затем проверены **локальным git show**.
Они не являются добавочными находками r09 и не входят в счётчик семи записей базы.

- **already-fixed, `86f5e0756e67fa7a18e925d77b7d2728db2f0627`:** ранняя проверка изоляции
  параллельных писателей уже подключена к authoring; `src/graph.ts:198–200` этой ревизии
  вызывает `parallelWriterIsolationIssues`, вынесенную в `src/parallel-isolation.ts:6–36`.
  Есть передача frozen permissions при проверке существующего плана. Не предлагается внедрять это снова.
  Проверен diff кода, новые parallel-authoring tests здесь не запускались.
- **already-fixed, `3d8ba65ee84402c0e3b0587f70095b7847824a9f`:** `skills/dynamic-workflows/SKILL.md:112–114`
  и `skills/dynamic-workflows/references/authoring.md:128–156` этой ревизии уже объясняют
  верхнеуровневый reviewer input, custom schema и отличие artifactRevision от reportRevision.
  Проверен текст diff; проверки runtime/reconciliation существовали на базе и не изменены этим doc-коммитом.

`git diff e15bc40 3d8ba65 --` для перечисленных 14 исходников/package/lock дал пустой результат;
в том числе `app.js`, model, observation, monitor, runtime, store и controller совпадают побайтно.
Поэтому эти post-study изменения **не являются исправлением R09-B01/B02**. Это сравнение кода,
не новый прогон исследования на publicationRevision и не проверка загруженного installed runtime.

## Unknowns и непроверенные границы

### R09-U01 — unknown — IME и озвучивание динамических изменений assistive technology

Пересоздание textarea при значимых снимках наблюдается в коде и тесте (`app.js:1133,1157`; `tests/graph-view-observation.test.ts:128`). Не установлено, прерывает ли оно живую IME composition, и достаточно ли VoiceOver/другому screen reader объявляются новый вопрос, сохранение и смена состояния. Обычный JSON-input и проверка activeElement не доказывают корректность composition/accessible live announcements.

**Следующая проверка, не выполнена:** изолированная страница с настоящей IME composition и параллельным semantic update, затем ручной VoiceOver-проход до/после разрешения await и открытия cancellation dialog. До воспроизведения не внедрять отдельный workaround; если дефект подтвердится, предпочесть сохранение keyed DOM/явное состояние, не автоматическую отправку или принудительный перехват фокуса. **Риск поспешного исправления:** двойная озвучка, потеря вводимого составного символа, новый focus stealing. **Критерий будущего решения:** составной ввод сохраняется до commit/cancel, статус и доступное действие объявляются один раз без ложного approve.

Другие границы исследования: не тестировались Safari/Firefox, мобильный layout, потеря питания, все аварийные окна Git, работа live provider, качество содержательного ревью и права реального аккаунта. Не запускались полный `npm test`, typecheck, skill-delivery/live probes или пользовательская панель. Это не блокеры завершения назначенного исследования.

## Experiments — исторические выполнения и новые проверки пакета

Обозначения: `DEV=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev`; `REPO` — исторический worktree E00–E05 из Metadata. Для нового воспроизведения не использовать эти старые пути назначения; см. безопасную подготовку в приложении. Все исторические тесты ниже offline; E00–E05 перенесены, а не исполнены новой операцией. `TMPDIR` задавался новым каталогом `/tmp/r09-...`; полные логи не включены в отчёт.

| ID | Команда / исход | Граница доказательств |
| --- | --- | --- |
| E00 | `pwd; git rev-parse HEAD; git status --short`; чтение AGENTS, архитектуры, разработки, known-issues, профильных документов; `git log -16 --oneline`, тематический log/show. Исходная ревизия подтверждена. | Не аудит установленного main/runtime. |
| E01 | Из DEV: `TMPDIR="$TMP" node --import tsx --test --test-concurrency=1 tests/graph-view-observation.test.ts tests/await-outcome.test.ts tests/pause-resume-admission.test.ts tests/continuation.test.ts` → **60/60**, 0 fail/skip, ~154.7 s. | Реальные временные supervisor/check/Git и SQLite; браузерные observation cases — fake DOM/HTTP fixtures, не live provider. |
| E02 | Из DEV: `TMPDIR="$TMP" node --import tsx --test --test-concurrency=1 tests/observation.test.ts tests/reconciliation.test.ts tests/implementation-recipes.test.ts` → **20/20**, 0 fail/skip, ~31.1 s. | Reconciliation/история, отрицательные gate-условия рецептов и локальная проверка артефактов; не live модельное ревью. |
| E03 | Из DEV: `TMPDIR="$TMP" node --import tsx --test --test-name-pattern='wait admission is fenced\|pause drains leaves\|control cancellation is monotonic' tests/run-store.test.ts` → **3/3** выбранных, 0 fail, ~2.0 s. | Только перечисленные cases, не весь run-store suite. |
| E04 | `node --import "$DEV/node_modules/tsx/dist/loader.mjs" "$P/paused.mjs" "$DEV" "$P"`, где фактически `P=/tmp/r09-waits-ux.YJ2ack` → все assertions прошли. | Настоящий await→pause→resolve→resume, временная SQLite, без модели. Снимки сохранялись только для локального браузерного воспроизведения. |
| E05 | `node "$P/browser.mjs" "$REPO" "$P"` → финальный вариант прошёл; Chrome `153.0.8010.52`, native BODY после перерисовки submit/summary, контроли textarea/heartbeat/повторного фокуса прошли. | Настоящий HTML/DOM/CDP, snapshot и resolve transport подставные; только static GET к временному fixture-серверу. Dynamicwf HTTP server не используется. |

**Историческая диагностика самой E05, не скрытая регрессия продукта (перенесена из старого md и последовательности retained commands):** два ранних варианта проверяли default action через CDP Enter и завершились по 20-секундному сроку ожидания mock POST; на их основании дефект Enter не заявляется. Контроль заменён на native Space и прошёл. Ещё один запуск диагностического варианта дошёл до внешнего 60-секундного timeout, без установленной причины зависания. Оставшаяся собственная Chrome-группа была опознана по уникальному временному profile path и завершена; пользовательские процессы не затрагивались. Финальный fixture отключает extensions, выбирает CDP target по точному локальному URL и имеет явный 10-секундный срок ожидания ответа CDP с cleanup. Он прошёл; последующая проверка не нашла процессов с profile-prefix этого эксперимента. Это улучшение воспроизводителя, не исправление Dynamicwf и не доказательство причины того timeout.

**Предложены, но не выполнялись:** матрица новых регрессий из критериев R09-B01/B02, измерение discoverability R09-I01, AT/IME-проверки R09-U01. Runtime-бюджеты/лимиты/retries не изменялись; указанные сроки относятся только к ожиданию тестовым стендом.

### Новые проверки продолжения (без поведенческого перезапуска)

| ID | Выполненная команда / проверка | Исход и граница |
| --- | --- | --- |
| E06 | `pwd; git rev-parse HEAD; git status --short; cat AGENTS.md`; `ls -l`/`shasum -a 256` ровно старых r09 md/json и r09-actions.json; чтение собственных материалов | Cwd новый, HEAD=e15bc40; md совпал, json отсутствует. Ошибка `ls` на отсутствующем json — подтверждение неполноты, не новый продуктовый отказ. |
| E07 | `nl -ba <source>`, чтение профильных docs и тестов; `git log -16 --oneline`; `git show 86f5e07 -- src/...`; `git show 3d8ba65 -- skills/dynamic-workflows`; чтение HEAD dev | Причины B01/B02 и защитные контракты сверены; dev=3d8ba65, новых тестов из него не выполняли. |
| E08 | `shasum -a 256` сохранённых E01–E05; `grep -E '^(✔|✖|ℹ|not ok)' <own-results>`; Python `json.loads`, assertions идентичности snapshot и выходов; сравнение `Path.read_bytes()` с `git show e15bc40:<path>` для 14 файлов и `git diff e15bc40 3d8ba65 -- <same-paths>` | 60/60 + 20/20 + 3/3; browser/result и paused/result согласованы; 14/14 байтовых сравнений, diff пуст. Прочитаны результаты прежних запусков, не получены новые. |
| E09 | Python проверка структуры нового report JSON, уникальных ID и source ranges; извлечение двух JS-блоков в **новый** `mktemp -d /tmp/r09-continuation.XXXXXX`, `node --check "$P/paused.mjs"; node --check "$P/browser.mjs"`; `git diff --exit-code -- src tests package.json package-lock.json PROJECT_INFO`; финальный SHA256 обоих отчётов | Только статическая валидация/синтаксис и целостность пакета; не исполняет fixture, не доказывает новый запуск Chrome/supervisor. Финальные хеши возвращены внешнему управляющему. |

### Контрольные суммы retained evidence

Хеши ниже вычислены при продолжении. Исходные `/tmp` файлы не изменялись;
в Git публикуются только сводки и исходники fixtures, не сырые test/supervisor/Chrome логи.

| Материал | SHA256 |
| --- | --- |
| E01 `/tmp/r09-profile-tests.9ofJZe/results.txt` | `7bd68f3a7455b307e38ea87adb22675ef89c75cd52ea928479f838f0e5becad4` |
| E02 `/tmp/r09-gates-tests.XWFHJ7/results.txt` | `7dd7e3c061652fb3f3a4a386569a5ab9c01c124c9709e39d86b1925a7154d95e` |
| E03 `/tmp/r09-gates-tests.XWFHJ7/store.txt` | `138696adfc15559792fdd87b7c8ba8c384cec3f766b910489706d4792e321b96` |
| E04 `paused.mjs` | `82870575aad81940bd6be2ec053194cafc9de561cc455f0d0c75a16b71354042` |
| E04 `paused-result.json` | `c002089c12b0ebb849aec1764dac699067efe9a769bdbc8a089588176b78b9be` |
| E04 `waiting.json` | `8f0da43945e06da25950052e6575d847b754579ce0ffe0a4c7c3522bb00e4ab2` |
| E04 `paused-resolved.json` | `6011880d51066e1354b245b38434f0b166d67e15c87529b5146193a7cf59b6c8` |
| E05 `browser.mjs` (финальный сохранённый) | `46b39553e77e8e9d5c73c65a131d15e4445c9dea732a8066013364fce37c0d1a` |
| E05 `browser-result.json` | `0029a80beeafff5c2bc971e41de2e2764cd8c164c82993330ca2b4d4c77e2144` |

E04/E05 файлы в таблице находятся в собственном историческом `/tmp/r09-waits-ux.YJ2ack`.
Одни команды в retainedActionEvidence не считались доказательством прохождения: для выводов
перечитаны существующие result/snapshot и сопоставлены с assertions сохранённых скриптов.
Исторические exit/cleanup поздних неуспешных диагностических вариантов E05 отдельно
не перепроверялись; это ограничение уже отмеченной диагностики, не основание для нового бага.

## Источники и сопоставление свидетельств

Repository-ссылки относятся к указанной sourceRevision, кроме явно помеченного post-study раздела, и просмотрены локально; дата доступа 2026-09-20. Историческое чтение/выполнение отличается от повторного чтения при продолжении в таблицах выше и report JSON. Веб-источников нет.

- Нормативные границы исследования/проекта: `AGENTS.md`; `PROJECT_INFO/architecture.md`, `development.md`, `known-issues.md`.
- Контракты: `PROJECT_INFO/graph-contract.md`, `outcomes-and-waits.md`, `observation.md`, `reconciliation.md`, `service.md`; `skills/dynamic-workflows/references/continuation.md`.
- Исполнение/журнал: `src/run-runtime.ts:82–90,154–171,359–372`; `src/run-store.ts:349–368,527–579`; `src/run-controller.ts:98–105,266–337`; `src/reconciliation.ts:18–49`; `src/lineage.ts:316–360`; `src/task-outcome.ts:10–22`.
- Представление/действия: `src/observation.ts:37–74`; `src/graph-view/model.ts:10–105`; `src/monitor.ts:97–109`; `src/graph-view/app.js:389–478,484–507,667–756,1125–1198,1450–1581`; `src/graph-view/index.html`; `src/graph-view/server.ts:139–159,182–209`.
- Регрессии, прочитанные и выполненные: `tests/await-outcome.test.ts`, `continuation.test.ts`, `graph-view-observation.test.ts`, `observation.test.ts`, `reconciliation.test.ts`, `implementation-recipes.test.ts`; дополнительно выполнены `pause-resume-admission.test.ts` и три названных case из `run-store.test.ts`.
- Браузерный harness изучен в `tests/graph-node-accessibility.test.ts` и `tests/graph-transition-scope.test.ts`; эти два suite не запускались. На их подходе построен собственный E05 с конкретным await-сценарием.
- История: `git log` до `e15bc40`; просмотрены summaries `fea2136`, `b4aaa3d`; фиксы async/continuation перечислены в R09-AF01–03.

**Конфликтов с запретом снимать паузу нет:** сохранённый response не завершает activation до gate. Конфликт — между этим внутренним состоянием и публичной формулировкой «ждёт ответа», а не между безопасностью и удобством. **Конфликтов с recent disclosure fix тоже нет:** open/caret сохраняются, фокус другого DOM control — отдельное свойство. Отчёт не заменяет зелёные тесты догадкой, а добавляет проверенный контрпример вне их текущих утверждений.

## Приложение: воспроизводимые fixtures

Скрипты ниже — **побайтное содержимое сохранённых финальных локальных воспроизводителей E04/E05**,
не изменения проекта. Они добавлены в приложение при продолжении; старый md этих блоков ещё не содержал.
Оба скрипта утверждают наблюдаемое дефектное состояние, а не желаемую регрессию после исправления.
Перед включением в будущие tests негативные assertions следует инвертировать.

### Подготовка нового воспроизведения (предложена; в продолжении не исполнялась)

Исторический `DEV` теперь новее базы. Не повторяйте старые команды с прежними `/tmp` и не
переключайте существующие worktrees. Можно извлечь исходники базы в новый временный каталог
без Git checkout, использовав только уже установленные зависимости (package/lock между
базой и publicationRevision совпадают). Команды выполнять из checkout с доступным Git object базы:

```sh
BASE=e15bc407da8753fd6b683c0aa4a68634e3c458a7
DEPS=/Users/ramu/.local/state/dynamicwf-evaluation-20260920/integration-dev/node_modules
test -d "$DEPS" || exit 1
P=$(mktemp -d /tmp/r09-reproduce.XXXXXX)
mkdir "$P/source"
git archive "$BASE" src package.json package-lock.json | tar -x -C "$P/source"
ln -s "$DEPS" "$P/source/node_modules"
# Сохранить два следующих JS-блока как $P/paused.mjs и $P/browser.mjs.
DEV="$P/source"
REPO="$P/source"
node --import "$DEV/node_modules/tsx/dist/loader.mjs" "$P/paused.mjs" "$DEV" "$P"
node "$P/browser.mjs" "$REPO" "$P"
```

Здесь архивирование/линк — лишь предлагаемая подготовка для повторяемости, **не новый выполненный E04/E05**.
Установку пакетов, изменение исходников и обращения к живой базе команда не предполагает.
`paused.mjs` создаёт только собственную временную SQLite и supervisor без agent/check узлов;
внешние вызовы модели отсутствуют. `browser.mjs` рассчитан на установленный Chrome/macOS,
поднимает static fixture-server на случайном loopback-порту и свой профиль. Все операции resolve
подставные внутри страницы, не идут в Dynamicwf server. Сроки ожидания/cleanup в скриптах относятся
к harness, не к бюджетам/повторам исполняемого Dynamicwf. Никакие старые PID/БД/профили не переиспользуются.

### paused.mjs

```js
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const [dev, out] = process.argv.slice(2);
const load = file => import(pathToFileURL(join(dev, 'src', file)).href);
const { RunController } = await load('run-controller.ts');
const { graphSnapshot } = await load('graph-view/model.ts');
const { monitorBody } = await load('monitor.ts');
const dir = await mkdtemp(join(out, 'database-'));
const c = new RunController(join(dir, 'state.sqlite'));
const lit = value => ({op:'literal', value});
const workflow = {schemaVersion:1,id:'r09-await',name:'r09 await UX fixture',revision:1,entryGraph:'main',graphs:{main:{entry:'answer',nodes:[
  {id:'answer',kind:'await',reason:lit('r09: согласовать результат'),input:lit({artifactRevision:'fixture-v1'}),responseSchema:{type:'object',properties:{allow:{type:'boolean'}},required:['allow'],additionalProperties:false}},
  ...['accepted','rejected'].map(decision => ({id:decision,kind:'finish',decision,reason:lit('Fixture decision: '+decision),evidence:lit([]),value:{op:'ref',path:['nodes','answer']}}))
],edges:[{from:'answer',to:'accepted',when:{op:'ref',path:['nodes','answer','allow']}},{from:'answer',to:'rejected'}]}}};
async function until(read, test) { const deadline=Date.now()+15000; for(;;) { const value=read(); if(test(value)) return value; if(Date.now()>deadline) throw Error('Fixture observation deadline'); await sleep(30); } }
let id;
try {
  id=(await c.start(workflow,null,dir)).id;
  await until(()=>c.observe(id).run,r=>r.status==='waiting');
  const snap=()=> { const s=c.snapshot(id); return graphSnapshot(s.run,s.activations,new Map(),c.store.waits(id),s.presentation); };
  await writeFile(join(out,'waiting.json'),JSON.stringify(snap()));
  const wait=c.store.waits(id)[0];
  await c.control(id,'pause');
  await until(()=>c.observe(id).run,r=>r.status==='paused');
  await c.resolve(id,wait.id,{allow:false},'r09-fixture');
  await sleep(350); // let the await loop observe the committed answer
  const s=c.snapshot(id), paused=snap(), node=paused.graphs[0].nodes.find(n=>n.id==='answer');
  const saved=c.store.getWait(id,wait.id);
  assert.equal(s.run.status,'paused'); assert.equal(saved.status,'resolved'); assert.deepEqual(saved.response,{allow:false});
  assert.equal(s.activations.some(a=>a.kind==='finish'),false);
  assert.equal(node.status,'waiting'); assert.ok(s.presentation.waitingKeys.includes(wait.key));
  assert.equal(s.presentation.activeKeys.length,0);
  assert.ok(monitorBody(s.run,s.activations,{presentation:s.presentation}).some(line=>line.includes(wait.id)));
  await writeFile(join(out,'paused-resolved.json'),JSON.stringify(paused));
  await c.resolve(id,wait.id,{allow:false},'second-delivery');
  assert.equal(c.store.events(id).filter(e=>e.type==='wait.resolved').length,1);
  await assert.rejects(c.resolve(id,wait.id,{allow:true}),/different response/);
  await c.control(id,'resume');
  const final=await until(()=>c.observe(id).run,r=>r.status==='succeeded'||r.status==='failed');
  assert.equal(final.status,'succeeded'); assert.equal(final.taskOutcome.decision,'rejected');
  assert.equal(snap().presentation.waitingKeys.length,0);
  const result={paused:{status:s.run.status,desired:s.run.desired,waitStatus:saved.status,response:saved.response,graphNodeStatus:node.status,waitingKeys:s.presentation.waitingKeys.length,activeKeys:s.presentation.activeKeys.length,monitorStillShowsQuestion:true,finishBeforeResume:false},redeliveryEvents:1,conflictingResponseRejected:true,afterResume:{status:final.status,decision:final.taskOutcome.decision,waitingKeys:0}};
  await writeFile(join(out,'paused-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  if(id) { await c.control(id,'cancel'); await until(()=>c.observe(id),s=>!s.supervisorAlive&&!s.workersAlive&&!s.unresolvedGroups.length); }
  c.close(); await rm(dir,{recursive:true,force:true});
}
```

### browser.mjs

```js
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const [repo,out]=process.argv.slice(2), root=join(repo,'src/graph-view');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const boundary='await refreshRuns();\nlet tick = 0;';
const original=readFileSync(join(root,'app.js'),'utf8'); assert.equal(original.split(boundary).length,2);
const waiting=JSON.parse(readFileSync(join(out,'waiting.json'),'utf8'));
const paused=JSON.parse(readFileSync(join(out,'paused-resolved.json'),'utf8'));
const script=original.split(boundary)[0]+`
const waitingFixture=${JSON.stringify(waiting)}, pausedFixture=${JSON.stringify(paused)};
let nextFixture=waitingFixture, posts=0;
globalThis.fetch=async(path,options)=>{
 if(path==='resolve'){posts++;return {ok:true,status:200,json:async()=>({})};}
 if(path.startsWith('snapshot?')&&!options.method)return {ok:true,status:200,json:async()=>structuredClone(nextFixture)};
 throw Error('Unexpected fixture request '+path);
};
window.r09={
 async reset(){ waitDrafts.clear();state.id=waitingFixture.id;state.graph=waitingFixture.entryGraph;state.node=null;state.tab='now';state.signature='';nextFixture=waitingFixture;await refreshSnapshot();},
 async update(semantic){nextFixture={...nextFixture,heartbeatAt:(nextFixture.heartbeatAt||0)+1,usage:{...nextFixture.usage,totalTokens:nextFixture.usage.totalTokens+(semantic?5:0)}};await refreshSnapshot();},
 async paused(){nextFixture=pausedFixture;await refreshSnapshot();},
 posts:()=>posts,
 inspect(){state.node='answer';renderInspector();},
 tab:setTab
};
await window.r09.reset();window.r09.ready=true;
`;
const requests=[];
const server=createServer((req,res)=>{requests.push(req.method+' '+req.url);const name=req.url.slice(1)||'index.html';
 if(!['index.html','app.js','style.css','layout.js','usage-pages.js','task-scope.js'].includes(name)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
 res.end(name==='app.js'?script:readFileSync(join(root,name)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=mkdtempSync(join(out,'chrome-')),home=join(profile,'home');mkdirSync(home);
let browser, socket, diagnostic='';const pending=new Map();let seq=0;
async function until(fn){const until=Date.now()+20000;while(Date.now()<until){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('Fixture browser observation deadline');}
try{
 browser=spawn(chrome,['--headless','--disable-extensions','--remote-debugging-port=0','--no-sandbox','--enable-automation','--no-default-browser-check','--disable-component-update','--disable-default-apps','--no-service-autorun','--password-store=basic','--use-mock-keychain','--disable-gpu','--disable-background-networking','--no-proxy-server','--disable-background-timer-throttling','--disable-renderer-backgrounding','--no-first-run',`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}/`],{env:{...process.env,HOME:home},stdio:['ignore','ignore','pipe'],detached:true});
 browser.stderr.setEncoding('utf8');browser.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-8192);});
 const endpoint=await until(()=>/DevTools listening on (ws:\/\/[^\s]+)/.exec(diagnostic)?.[1]);
 const targets=await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json();
 socket=new WebSocket(targets.find(t=>t.type==='page'&&t.url.startsWith(`http://127.0.0.1:${server.address().port}/`)).webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>reject(Error('CDP observation deadline: '+method)),10000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression)=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
 const key=async(k,code,vk)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});};
 await until(()=>evaluate('Boolean(window.r09?.ready)'));
 await evaluate(`(()=>{const f=document.querySelector('[data-wait-id]');f.value='{"allow":false}';f.dispatchEvent(new Event('input'));f.focus();f.setSelectionRange(2,7,'backward');document.querySelector('[data-wait-details]').open=true;})()`);
 await evaluate('r09.update(true)');
 const editor=await evaluate(`({tag:document.activeElement.tagName,text:document.activeElement.value,direction:document.activeElement.selectionDirection,selection:[document.activeElement.selectionStart,document.activeElement.selectionEnd],open:document.querySelector('[data-wait-details]').open})`);
 assert.equal(editor.tag,'TEXTAREA');assert.equal(editor.text,'{"allow":false}');assert.equal(editor.direction,'backward');assert.deepEqual(editor.selection,[2,7]);assert.equal(editor.open,true);
 await evaluate(`window.fixtureKeys=[];document.addEventListener('keydown',event=>{if(event.key==='Tab'||event.key===' ')window.fixtureKeys.push({key:event.key,trusted:event.isTrusted});},true)`);
 await key('Tab','Tab',9);
 const before=await evaluate(`({tag:document.activeElement.tagName,text:document.activeElement.textContent})`);
 assert.equal(before.tag,'BUTTON');assert.equal(before.text,'Сохранить ответ');
 await evaluate('r09.update(false)');
 const stable=await evaluate('document.activeElement.tagName');assert.equal(stable,'BUTTON');
 await evaluate('r09.update(true)');
 const after=await evaluate('document.activeElement.tagName');assert.equal(after,'BODY');
 await key(' ','Space',32);
 assert.equal(await evaluate('r09.posts()'),0);
 await evaluate(`document.querySelector('[data-wait-id]').focus()`);await key('Tab','Tab',9);await key(' ','Space',32);
 await until(()=>evaluate('r09.posts()===1'));
 await evaluate('r09.reset()');
 await evaluate(`document.querySelector('[data-wait-details] summary').focus();document.querySelector('[data-wait-details]').open=true`);
 await evaluate('r09.update(true)');
 const summaryFocus=await evaluate(`({tag:document.activeElement.tagName,open:document.querySelector('[data-wait-details]').open})`);
 assert.equal(summaryFocus.tag,'BODY');assert.equal(summaryFocus.open,true);
 await evaluate('r09.paused();r09.inspect()');
 const pausedView=await evaluate(`({summaryHidden:document.getElementById('wait-summary').hidden,waitCards:document.querySelectorAll('.wait-card').length,inspectWaiting:document.getElementById('inspector').textContent.includes('Ждёт ответа'),resumeVisible:!document.getElementById('resume').hidden,now:document.getElementById('content-panel').textContent})`);
 assert.equal(pausedView.summaryHidden,true);assert.equal(pausedView.waitCards,0);assert.equal(pausedView.inspectWaiting,true);assert.equal(pausedView.resumeVisible,true);
 assert.ok(pausedView.now.includes('Новых задач пока нет. Ожидание следующего шага.'));
 await evaluate(`r09.tab('history')`);
 assert.equal(await evaluate(`document.getElementById('content-panel').textContent.includes('Ответ сохран')`),false);
 assert.ok(requests.every(p=>p.startsWith('GET ')),JSON.stringify(requests));
 const keys=await evaluate('window.fixtureKeys');assert.deepEqual(keys.map(k=>k.key),['Tab',' ','Tab',' ']);assert.ok(keys.every(k=>k.trusted));
 const version=await send('Browser.getVersion');
 const result={browser:version.product,editorFixConfirmed:editor,beforeSemantic:before,heartbeatOnlyFocus:stable,afterSemantic:after,postAfterLostFocus:0,postAfterRefocus:1,summaryAfterSemantic:summaryFocus,pausedView:{...pausedView,now:undefined},keys,network:'only static GETs; resolve mocked in page; no application server'};
 writeFileSync(join(out,'browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 if(socket)socket.close();if(browser?.pid){try{process.kill(-browser.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}browser.stderr.destroy();browser.unref();}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
```

