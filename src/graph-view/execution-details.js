/** Attempt, failure and recovery views. All effects go through the injected client/controller. */
export function createExecutionDetails({ state, api, el, button, badge, clock, number, date, duration, renderInspector, notice, refreshSnapshot, attemptPages, collectionPages, retryPages, document, newDecisionId, navigate }) {
const recoveryInspections = new Map();
const reconciliationRecords = new Map();
const reconciliationGenerations = new Map();
const inspectionGenerations = new Map();
function nextInspectionRead(identity) {
  const generation = (inspectionGenerations.get(identity) ?? 0) + 1;
  inspectionGenerations.set(identity, generation);
  return () => inspectionGenerations.get(identity) === generation;
}
function nextReconciliationRead(identity) {
  const generation = (reconciliationGenerations.get(identity) ?? 0) + 1;
  reconciliationGenerations.set(identity, generation);
  return () => reconciliationGenerations.get(identity) === generation;
}
const recoveryDrafts = new Map();
function redrawFor(id, visit, key) {
  if (state.id !== id || !state.run) return;
  if (state.runSelection === visit) { renderInspector(); return; }
  // A return visit may already display this same resource while an earlier GET
  // still owns its shared cache. Update only that execution, not another node.
  if (state.key && state.key !== key) return;
  const node = state.run.graphs.find(g => g.id === state.graph)?.nodes.find(n => n.id === state.node);
  if (node?.activations.some(a => a.key === key && (!state.scope || a.scope === state.scope))) renderInspector();
}
function renderRecovery(container, activation) {
  const id = state.id, visit = state.runSelection, identity = JSON.stringify([id, activation.key]);
  const redraw = () => redrawFor(id, visit, activation.key);
  const cached = recoveryInspections.get(identity) ?? {};
  const inspectState = async () => {
    recoveryInspections.set(identity, { ...cached, loading: true, error: null }); redraw();
    const current = nextReconciliationRead(identity);
    const currentInspection = nextInspectionRead(identity);
    try {
      const suffix = `id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}`;
      const [value, records] = await Promise.all([api(`recovery?${suffix}`, undefined, currentInspection), api(`reconciliations?${suffix}`, undefined, () => currentInspection() && current())]);
      if (!currentInspection()) return;
      recoveryInspections.set(identity, { value, records: current() ? records : reconciliationRecords.get(identity)?.value ?? cached.records ?? [] });
      if (current()) reconciliationRecords.set(identity, { value: records, at: Date.now() });
    } catch (error) { if (currentInspection()) recoveryInspections.set(identity, { ...(recoveryInspections.get(identity) ?? cached), loading: false, error: error.message }); }
    redraw();
  };
  const inspect = button(cached.loading ? "Сканирование состояния…" : cached.value ? "Обновить инспекцию" : "Проверить состояние для восстановления", inspectState, "child-button");
  inspect.dataset.uiKey = `inspection-load:${identity}`;
  inspect.disabled = !!cached.loading; container.append(inspect);
  if (cached.error) container.append(el("p", "notice", cached.error));
  if (!cached.value) return;
  const value = cached.value, details = el("details");
  details.append(el("summary", "", `Инспекция · попытка ${value.attempt}`), el("p", "muted", `Данные на ${date(value.observedAt)}. Получение снимка не разрешает повтор или принятие результата.`));
  if (value.attempt !== activation.attempt) details.append(el("p", "notice", "Началась другая попытка. Обнови инспекцию."));
  const labels = { "run-not-stopped": "Запуск ещё не остановлен либо уже завершён.", cancelled: "Отменённый запуск нельзя восстановить.", "attempt-not-failed": "Эта попытка не завершилась ошибкой.", "structural-checkpoint": "Выбери конкретную операцию внутри этого узла.", "missing-operation": "Параметры операции не были записаны.", "completed-parent": "Результат уже использован завершённым родителем.", "collected-item": "Результат уже включён в сохранённую коллекцию.", "live-processes": "Процессы запуска ещё работают.", "unresolved-groups": "Нужна проверка оставшихся групп процессов." };
  for (const blocker of value.blockers) details.append(el("p", "notice", labels[blocker.code] ?? blocker.message));
  if (value.workspace) {
    details.append(el("p", "", `Проверено записей: ${number(value.workspace.entries)} · байтов: ${number(value.workspace.bytes)}`), el("pre", "", value.workspace.roots.join("\n")),
      el("p", "muted", "Проверены выбранные рабочие папки и данные Git. Содержимое целей вложенных ссылок и внешние действия требуют отдельных доказательств."));
  } else details.append(el("p", "muted", "Файлы не сканировались: сначала нужно устранить препятствия выше."));
  const raw = el("details"); raw.append(el("summary", "", "Checkpoint, файлы и контракт результата"), el("pre", "", JSON.stringify(value, null, 2)));
  details.append(raw); container.append(details);
  if (value.workspace && !value.blockers.length && value.attempt === activation.attempt) renderRecoveryForm(container, activation, cached, inspectState);
}
function renderRecoveryForm(container, activation, inspection, inspectState) {
  const id = state.id, visit = state.runSelection, identity = JSON.stringify([id, activation.key, activation.attempt]), snapshot = inspection.value;
  const redraw = () => redrawFor(id, visit, activation.key);
  let draft = recoveryDrafts.get(identity);
  if (!draft) { draft = { action: "", actor: "", reason: "", evidence: "", output: "", replace: false, request: null, receipt: null, busy: false, error: null }; recoveryDrafts.set(identity, draft); }
  const card = el("section", "recovery-form"), pending = (inspection.records ?? []).find(record => record.request.action === "retry" && !record.application && !record.supersededBy);
  card.append(el("h4", "", "Решение о восстановлении"));
  if (draft.receipt) {
    card.append(el("p", "notice", "Решение сохранено. После разрешения остальных ошибок запуск можно продолжить отдельной кнопкой «Продолжить»."),
      button("Подготовить другое решение", async () => { draft.request = null; draft.receipt = null; draft.replace = false; await inspectState(); }, "child-button"));
    container.append(card); return;
  }
  const frozen = !!draft.request || draft.busy;
  const field = (name, label, tag = "textarea") => {
    const wrapper = el("label", "", label), input = el(tag);
    input.id = `recovery-${encodeURIComponent(identity)}-${name}`; input.dataset.recoveryField = "1"; input.setAttribute("aria-label", label);
    input.value = draft[name]; input.disabled = frozen; if (tag === "textarea") input.rows = name === "output" ? 6 : 3;
    input.addEventListener("input", () => { draft[name] = input.value; }); wrapper.append(input); card.append(wrapper); return input;
  };
  const action = field("action", "Действие", "select");
  for (const [value, label] of [["", "Выбери действие"], ["accept", "Принять готовый результат"], ["retry", "Разрешить один повтор"]]) {
    const option = el("option", "", label); option.value = value; action.append(option);
  }
  action.value = draft.action; action.addEventListener("change", () => { draft.action = action.value; redraw(); });
  field("actor", "Автор решения", "input"); field("reason", "Причина решения"); field("evidence", "Что проверено: файлы, проверки и внешние действия");
  if (draft.action === "accept") field("output", "Принятый результат (JSON)");
  if (pending) {
    card.append(el("p", "notice", `Есть разрешение повтора от ${pending.request.actor}: ${pending.request.reason}`));
    const label = el("label", ""), replace = el("input"); replace.type = "checkbox"; replace.checked = draft.replace; replace.disabled = frozen;
    replace.id = `recovery-${encodeURIComponent(identity)}-replace`; replace.dataset.recoveryField = "1";
    replace.addEventListener("change", () => { draft.replace = replace.checked; }); label.append(replace, document.createTextNode(" Заменить прежнее неприменённое решение")); card.append(label);
  }
  card.append(el("p", "muted", draft.action === "retry" ? "Разрешение действует на одну следующую попытку. Перед допуском файлы проверяются заново." : "Результат должен соответствовать контракту узла. Его принятие сохраняет исходную ошибку и расход в истории."));
  card.append(el("p", "muted", "Сохранение решения не запускает работу и не снимает паузу."));
  const submit = button(draft.busy ? "Сохраняем решение…" : draft.request ? "Повторить отправку того же решения" : "Сохранить решение", async () => {
    if (draft.busy) return;
    const selection = visit;
    draft.error = null;
    try {
      if (!draft.request) {
        if (!["accept", "retry"].includes(draft.action) || !draft.actor.trim() || !draft.reason.trim() || !draft.evidence.trim()) throw new Error("Выбери действие и заполни автора, причину и проверенные основания.");
        if (pending && !draft.replace) throw new Error("Для замены прежнего разрешения отметь соответствующий пункт.");
        const output = draft.action === "accept" ? JSON.parse(draft.output) : undefined;
        draft.request = { id, key: activation.key, attempt: snapshot.attempt, checkpoint: snapshot.checkpoint, workspaceDigest: snapshot.workspace.digest,
          decisionId: newDecisionId(), action: draft.action, actor: draft.actor.trim(), reason: draft.reason.trim(), evidence: [{ description: draft.evidence.trim() }],
          ...(draft.action === "accept" ? { output } : {}), ...(pending ? { supersedes: pending.request.decisionId } : {}) };
      }
      draft.busy = true; redraw();
      draft.receipt = await api("reconcile", { method: "POST", headers: { "Content-Type": "application/json", "X-Dynamicwf-View": "1" }, body: JSON.stringify(draft.request) });
      nextReconciliationRead(JSON.stringify([id, activation.key]));
      nextInspectionRead(JSON.stringify([id, activation.key]));
      const latest = recoveryInspections.get(JSON.stringify([id, activation.key])) ?? inspection;
      const records = [...(latest.records ?? []).filter(record => record.request.decisionId !== draft.receipt.request.decisionId).map(record => record.request.decisionId === draft.receipt.request.supersedes ? { ...record, supersededBy: draft.receipt.request.decisionId } : record), draft.receipt];
      recoveryInspections.set(JSON.stringify([id, activation.key]), { ...latest, loading: false, records });
      reconciliationRecords.set(JSON.stringify([id, activation.key]), { value: records, at: Date.now(), saved: true });
      if (state.id === id && state.runSelection === selection) { notice("Решение о восстановлении сохранено. Запуск продолжится по отдельной команде."); await refreshSnapshot(); }
    } catch (error) { draft.error = error.message; }
    finally { draft.busy = false; redraw(); }
  }, "child-button");
  submit.id = `recovery-${encodeURIComponent(identity)}-submit`; submit.dataset.recoveryField = "1";
  submit.disabled = draft.busy || !!inspection.loading; card.append(submit);
  if (draft.error) { const error = el("p", "notice", draft.error); error.setAttribute("role", "alert"); card.append(error); }
  if (draft.request && !draft.busy) card.append(el("p", "muted", `ID решения: ${draft.request.decisionId}. Повторная отправка использует те же данные.`),
    button("Проверить состояние и изменить решение", async () => { draft.request = null; draft.error = null; draft.replace = false; await inspectState(); }, "child-button"));
  container.append(card);
}
function failureView(failure, runScope = false) {
  const labels = { configuration:"Настройки",resource:"Ресурсы",provider:"Ответ провайдера",output:"Формат результата",process:"Процесс",protocol:"Обмен с worker",cancelled:"Прерывание",interrupted:"Потерян процесс","expression":"Выражение графа","uncertain-effect":"Нужна сверка действий",unknown:"Причина не уточнена" };
  const phases = { setup:"подготовка",execution:"исполнение",output:"приём результата",routing:"выбор перехода",recovery:"восстановление",cleanup:"завершение процессов" };
  const effects = { "not-started":"Исполнение задачи не началось.","read-only":"Операция выполнялась только с доступом на чтение.",unknown:"Результат внешних действий не подтверждён. Перед повтором нужна сверка." };
  const panel=el("div","failure-detail");
  panel.append(el("strong","",`${labels[failure.code] ?? labels.unknown} · ${phases[failure.phase] ?? "этап неизвестен"}`),el("p","",failure.message),el("p","muted",runScope ? "Это причина остановки. Состояние действий показано в деталях отдельных узлов." : effects[failure.effects] ?? effects.unknown));
  if (failure.providerResponse) panel.append(el("p","",`HTTP-ответ: ${failure.providerResponse.status}${failure.providerResponse.retryAfterMs===undefined?"":` · Retry-After: ${number(failure.providerResponse.retryAfterMs)} мс`}`));
  if (failure.diagnostic) {
    const dispatch = { "not-dispatched": "запрос не отправлялся", "fetch-attempted": "транспорт вызван, получение не подтверждено", "http-observed": "получен HTTP-ответ", unknown: "отправка не установлена" };
    panel.append(el("p","muted", `${failure.diagnostic.subcode ? `Код: ${failure.diagnostic.subcode}. ` : ""}Отправка: ${dispatch[failure.diagnostic.dispatch] ?? dispatch.unknown}${failure.diagnostic.sentReasoning ? ` · reasoning: ${failure.diagnostic.sentReasoning}` : failure.diagnostic.dispatch === "not-dispatched" ? " · reasoning неизвестен" : ""}`));
  }
  return panel;
}
function retryView(progress, pending = false) {
  const historical = progress.status === "scheduled" && !pending;
  const labels = {scheduled:historical ? "ранее планировалась" : "запланирована",admitted:"допущена",abandoned:"снята без допуска"};
  const panel = el("div","notice"), when = progress.dueAt !== null && Number.isFinite(new Date(progress.dueAt).getTime()) ? date(progress.dueAt) : `задержка ${number(progress.delayMs)} мс`;
  panel.append(el("strong","",`Попытка ${progress.nextAttempt}: ${labels[progress.status] ?? progress.status}`),el("p","muted",`После ошибки попытки ${progress.attempt} · ${historical ? "срок исходного решения" : "не раньше"} ${when}`));
  panel.append(el("p","muted",`Назначенная задержка: ${number(progress.delayMs)} мс.`));
  if (progress.status === "scheduled") panel.append(el("p","muted",historical ? "Сохранённое решение само по себе не означает, что повтор сейчас ожидается." : "Новая попытка ещё не началась. Для допуска запуск должен работать и срок задержки должен истечь."));
  return panel;
}
function renderRetries(container,activation) {
  const id=state.id,visit=state.runSelection,identity=JSON.stringify([id,activation.key]),page=retryPages.get(identity);
  const redraw = () => redrawFor(id, visit, activation.key);
  const load=button(page.loading?"Загружаем решения…":!page.opened?"Решения о повторах":page.hasMore?"Ещё решения о повторах":"Обновить решения о повторах",async()=>{
    const pending=retryPages.load(identity,async(_key,cursor)=>{
      const response=await api(`retries?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}&after=${cursor}`);
      return {reports:response.records,nextAfter:response.nextAfter,hasMore:response.hasMore};
    });redraw();await pending;redraw();
  },"child-button");load.disabled=page.loading;container.append(load);
  if(page.error)container.append(el("p","notice",page.error));
  for(const record of page.reports){const details=el("details");details.append(el("summary","",`Решение: попытка ${record.attempt} → ${record.nextAttempt} · ${date(record.at)}`));for(const cause of record.causes??[record.failure])details.append(failureView(cause));details.append(el("p","muted",`Задержка ${number(record.delayMs)} мс. Фактический допуск и состояние — в истории попыток.`));container.append(details);}
}
function renderCollection(container, activation) {
  if (activation.collectionSummary) container.append(el("p", "notice", `Собрано результатов: ${activation.collectionSummary.total} · успешно ${activation.collectionSummary.succeeded} · ошибок ${activation.collectionSummary.failed}`));
  const id = state.id, visit = state.runSelection, identity = JSON.stringify([id, activation.key]), page = collectionPages.get(identity);
  const redraw = () => redrawFor(id, visit, activation.key);
  const load = button(page.loading ? "Загружаем результаты…" : !page.opened ? "Результаты веток" : page.hasMore ? "Ещё результаты веток" : "Обновить результаты веток", async () => {
    const pending = collectionPages.loadCollection(identity, (_identity, cursor) => api(`collections?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}&after=${cursor}`));
    redraw(); await pending; redraw();
  }, "child-button");
  load.disabled = page.loading; container.append(load);
  if (page.error) container.append(el("p", "notice", page.error));
  const summary = collectionPages.summaries.get(identity);
  if (summary) container.append(el("p", "muted", `На момент запроса: собрано ${summary.total} · успешно ${summary.succeeded} · ошибок ${summary.failed}`));
  for (const record of page.reports) {
    const details = el("details");
    details.append(el("summary", "", `${record.itemId} · ${record.result.status === "succeeded" ? "результат получен" : "ошибка ветки"} · попытка родителя ${record.attempt}`));
    if (record.result.status === "failed") details.append(failureView(record.result.failure));
    else details.append(el("pre", "", JSON.stringify(record.result.value, null, 2)));
    container.append(details);
  }
}
function outputRepairView(progress, status) {
  const labels = { running: status === "running" ? "выполняется" : "завершение не подтверждено", succeeded: "формат принят", invalid: "результат не прошёл проверку", failed: "прерван ошибкой или отменой" };
  const panel = el("div", "notice");
  panel.append(el("strong", "", `Исправление формата · раунд ${progress.round}: ${labels[progress.status] ?? progress.status}`));
  panel.append(el("p", "muted", "Та же сессия; в раунде доступен только submit_result. Принятый формат не подтверждает качество результата."));
  panel.append(el("p", "muted", progress.status === "running" ? "Итоговые границы расхода раунда не подтверждены. Уже полученные отчёты включены в сумму узла." : progress.throughReport > progress.afterReport ? `Отчёты SDK этого раунда: ${progress.afterReport + 1}–${progress.throughReport}. Расход включён в сумму узла.` : "В завершённых отчётах SDK этого раунда расход не зафиксирован."));
  return panel;
}
function renderAttempts(container, activation) {
  renderReconciliations(container, activation);
  const id=state.id, visit=state.runSelection, identity=JSON.stringify([id,activation.key]), page=attemptPages.get(identity);
  const redraw = () => redrawFor(id, visit, activation.key);
  const loadAttempts = async (automatic = false) => {
    const work=attemptPages.loadAttempts(identity,(_identity,cursor)=>api(`attempts?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}&after=${cursor}`));
    // Automatic archival reads begin during inspector rendering. Do not re-enter
    // remember() until that render has appended its row and restored focus.
    if (!automatic) redraw();
    await work; redraw();
  };
  const load=button(page.loading ? "Загружаем попытки…" : !page.opened ? `Попытки: ${activation.attempt}` : page.hasMore ? "Ещё попытки" : "Обновить попытки", () => loadAttempts(), "child-button");
  load.dataset.uiKey = `attempt-load:${identity}`;
  load.disabled=page.loading;container.append(load);
  if(page.error)container.append(el("p","notice",page.error));
  const snapshot=attemptPages.snapshots.get(identity);
  const selected = state.key === activation.key;
  const behind = snapshot && snapshot.current.attempt < activation.attempt;
  const ahead = snapshot && snapshot.current.attempt > activation.attempt;
  const staleCurrent = behind || ahead;
  if (selected && !page.loading && !page.error && (behind || state.attempt !== activation.attempt && !page.opened)) {
    // A formerly live snapshot is not evidence for its new archived identity.
    // Read forward from the archived cursor, even if the page was already open.
    void loadAttempts(true);
    load.disabled = true; load.textContent = "Загружаем попытки…";
  }
  // A freshly read attempt page may lead the general run snapshot. Show that
  // separate observation explicitly, never as this snapshot's selected archive.
  const known = [...page.reports, ...(snapshot?.current?.attempt >= activation.attempt ? [snapshot.current] : [])];
  if (selected && !known.some(record => record.attempt === state.attempt)) {
    if (page.loading) container.append(el("p", "muted", "Выбранная попытка загружается; прежний живой снимок не является её архивом."));
    else if (behind) container.append(el("p", "notice", "Снимок попыток устарел. Обнови попытки, чтобы увидеть архивный результат."));
    else if (ahead) container.append(el("p", "muted", "Данные попыток новее снимка выполнения; дождись следующего обновления."));
    else if (snapshot) container.append(el("p", "notice", page.hasMore ? "Выбранная попытка ещё не загружена. Открой следующую страницу попыток." : "Выбранная попытка не сохранена в журнале."));
  }
  if(!snapshot)return;
  if(behind)container.append(el("p", "muted", "Последняя попытка в кэше устарела; её результат не используется как архив."));
  if(ahead)container.append(el("p", "muted", "Данные попыток новее снимка выполнения; текущий результат не подменяется."));
  if(!staleCurrent && snapshot.missingArchived)container.append(el("p","notice",`Не сохранено прежних попыток: ${snapshot.missingArchived}. Старый журнал не содержит их полных записей.`));
  container.append(el("p","muted","Попытки на момент запроса. Расход ниже относится к каждой попытке отдельно."));
  for(const record of known) {
    const fromLaterPage = ahead && record === snapshot.current;
    const card=el("section","attempt-card"); card.dataset.uiKey = JSON.stringify([activation.key, record.attempt]);
    card.setAttribute("data-selected", String(!fromLaterPage && state.key === activation.key && state.attempt === record.attempt));
    if (!fromLaterPage) card.append(button(`Выбрать попытку ${record.attempt}`, () => navigate({ graph: state.graph, scope: activation.scope, node: state.node, key: activation.key, attempt: record.attempt }), "child-button"));
    if (state.key === activation.key && state.attempt !== record.attempt) { container.append(card); continue; }
    card.append(el("strong","",`Попытка ${record.attempt}${fromLaterPage ? " · страница попыток опережает общий снимок" : record === snapshot.current ? " · последняя" : ""}`),badge(record.status));
    card.append(el("p","muted",`${date(record.startedAt)} · ${record.finishedAt===null ? "не завершена на момент запроса" : duration(record.finishedAt-record.startedAt)}`));
    if(record.metadata.reconciliation?.action === "accept") card.append(el("p","notice","Результат принят при восстановлении. Нового вызова модели или команды не было; прежний расход сохранён в исходной попытке."));
    else if(record.kind==="agent")card.append(el("p","",record.accounting.usage ? `${number(record.accounting.usage.totalTokens)} ток. · ответов ${record.accounting.responses}${record.accounting.complete ? "" : " · частично"}` : "Расход этой попытки неизвестен: нет отчётов SDK."));
    if(record.metadata.outputRepair)card.append(outputRepairView(record.metadata.outputRepair,record.status));
    if(record.metadata.retry)card.append(retryView(record.metadata.retry, false));
    if(record.metadata.failureCauses)for(const cause of record.metadata.failureCauses)card.append(failureView(cause));
    else if(record.metadata.failure)card.append(failureView(record.metadata.failure));
    else if(record.error)card.append(el("pre","",record.error));
    if(Object.hasOwn(record,"output"))card.append(el("pre","",JSON.stringify(record.output,null,2)));
    if(record.metadata.operation)card.append(operationView(record.metadata.operation));
    if(Object.keys(record.metadata).length){const details=el("details");details.append(el("summary","","Данные попытки"),el("pre","",JSON.stringify(record.metadata,null,2)));card.append(details);}
    container.append(card);
  }
}
function renderReconciliations(container, activation) {
  const id = state.id, visit=state.runSelection, identity = JSON.stringify([id, activation.key]), cached = reconciliationRecords.get(identity) ?? {};
  const redraw = () => redrawFor(id, visit, activation.key);
  const load = button(cached.loading ? "Загружаем решения…" : cached.value ? "Обновить решения о восстановлении" : "Решения о восстановлении", async () => {
    reconciliationRecords.set(identity, { ...cached, loading: true, error: null }); redraw();
    const current = nextReconciliationRead(identity);
    try {
      const value = await api(`reconciliations?id=${encodeURIComponent(id)}&key=${encodeURIComponent(activation.key)}`, undefined, current);
      if (current()) {
        reconciliationRecords.set(identity, { value, at: Date.now() });
        const inspection = recoveryInspections.get(identity);
        if (inspection) recoveryInspections.set(identity, { ...inspection, records: value });
      }
    } catch (error) { if (current()) reconciliationRecords.set(identity, { ...cached, error: error.message }); }
    redraw();
  }, "child-button");
  load.disabled = !!cached.loading; container.append(load);
  if (cached.error) container.append(el("p", "notice", cached.error));
  if (!cached.value) return;
  if (cached.saved) container.append(el("p", "notice", ["interrupted", "paused"].includes(state.run.status) ? "Решение сохранено. После разрешения остальных ошибок нажми «Продолжить»." : "Решение сохранено в истории восстановления."));
  container.append(el("p", "muted", `Решения на ${date(cached.at)}. ${cached.value.length ? "" : "Сохранённых решений нет."}`));
  for (const record of cached.value) {
    const r = record.request, panel = el("details"), status = record.supersededBy ? "заменено" : record.application ? `применено к попытке ${record.application.attempt}` : "ожидает допуска";
    panel.append(el("summary", "", `${r.action === "accept" ? "Приём результата" : "Разрешение повтора"} · ${status}`),
      el("p", "", `${r.actor} · ${date(record.createdAt)} · исходная попытка ${r.attempt}`), el("p", "", r.reason),
      el("p", "muted", "Основания заявил автор решения. Они не являются автоматическим подтверждением всех внешних действий."),
      el("pre", "", JSON.stringify(record, null, 2)));
    container.append(panel);
  }
}
function operationView(operation) {
  const details=el("details");details.append(el("summary","","Операция этой попытки"),el("p","muted","Записанные параметры и этапы операции. Они не подтверждают завершение внешних действий."));
  const field=(label,value)=>{if(value!==undefined)details.append(el("strong","",label),el("pre","",typeof value==="string"?value:JSON.stringify(value,null,2)));};
  field("Рабочая папка",operation.cwd??operation.source??operation.target);
  if(operation.kind==="agent") {
    field("Каталог сессий из запроса",operation.sessionDirectory);field("Каталог ресурсов из запроса",operation.resourceDirectory);field("Продолжение сессии",operation.continuedSessionFile);
    const input=el("details");input.append(el("summary","","Задание и вход агента"),el("pre","",operation.task),el("pre","",JSON.stringify(operation.input,null,2)));details.append(input);
  } else if(operation.kind==="check") {field("Команда",operation.command);field("Аргументы",operation.args);}
  else if(operation.kind==="worktree") {field("Базовая ревизия из запроса",operation.base);field("Дочерняя область",operation.childScope);if(Object.hasOwn(operation,"childResult"))field("Результат детей перед commit",operation.childResult);}
  else if(operation.kind==="integrate") {
    field("Источники интеграции",operation.sources);
    if(operation.progress){const progress=operation.progress;field("Последний записанный этап",{ready:"До начала слияний",merging:"Перед запуском merge",between:"После одного из слияний",complete:"После всех слияний"}[progress.phase]??progress.phase);field("Целевая ветка",progress.branch);field("Исходный HEAD",progress.originalHead);field("Записанные завершённые слияния",progress.merged);field("Допущенный merge",progress.current);field("Прочитанный итоговый HEAD",progress.head);}
  }
  return details;
}

return { renderRecovery, renderRecoveryForm, failureView, retryView, renderRetries, renderCollection, outputRepairView, renderAttempts, renderReconciliations, operationView, recoveryDrafts, recoveryInspections, reconciliationRecords };
}
