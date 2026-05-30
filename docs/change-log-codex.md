## Change Log — Codex

### 2026-05-30 10:56 CEST — v2.73.69

- Для чего: восстановить ожидаемое поведение `New Pages = off`, когда запросы должны идти в последние уже открытые вкладки моделей, включая вкладки из прошлых сессий. Изменение: первичное подключение существующей вкладки теперь допускает global reuse через `allowGlobalReuse`, после чего выбранная вкладка привязывается к текущему run scope; scoped resolver при этом остаётся защищённым от чужих вкладок. Файлы: `background/job-orchestrator.js`, `background/tab-manager.js`.
- Для чего: не считать cached `tabId` доказательством рабочей вкладки. Изменение: добавлен `validateReusableTab()`, который проверяет существование/готовность вкладки, соответствие модели и run-scope перед dispatch/reuse; stale cached binding очищается и не используется вслепую. Файлы: `background/tab-manager.js`, `tests/tab-manager-session-scope.test.js`.
- Для чего: убрать расхождение terminal-логики между закрытием вкладок, фокусом, human visits и health checks. Изменение: terminal decisions переведены на общий `ModelRunState`/router helper вместо локальных списков статусов; health monitor теперь учитывает `modelRunState.terminalState` даже при устаревшем legacy `status`. Файлы: `background/message-router.js`, `background/lifecycle-runtime.js`, `background/human-presence.js`, `background/health-monitor.js`, `tests/health-monitor-terminal-state.test.js`.
- Для чего: снизить риск преждевременного terminal success от DOM-сигналов. Изменение: исчезновение stop-кнопки и стабильность текста 2 секунды теперь трактуются как completion evidence, а не как самостоятельное финальное решение. Файлы: `content-scripts/unified-answer-watcher.js`, `content-scripts/unified-answer-pipeline.js`.
- Для чего: закрепить регрессию тестами. Изменение: добавлены проверки session-scope reuse для старых вкладок, revalidation cached binding и terminal-state health monitor. Файлы: `tests/tab-manager-session-scope.test.js`, `tests/health-monitor-terminal-state.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.69`. Файл: `manifest.json`.

### 2026-05-30 08:31 CEST — v2.73.68

- Для чего: исправить сценарий из `All Logs 20260530_08-28.md`, где Qwen уже материализовал ответ в панели (`textLen=11632`), но stale lifecycle продолжал слать `ANSWER_GENERATING textLength=6067` и блокировал terminal success до `ANSWER_COMPLETE_TIMEOUT`. Изменение: `maybeDeferEarlyTerminalSuccess()` больше не требует `sameObservation`, если длинный ответ (`>= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS`) ждёт guard дольше `EARLY_TERMINAL_GUARD_MAX_WAIT_MS`; для коротких, но достаточных ответов добавлен extended wait `MAX_WAIT * 3`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать такие случаи видимыми в логах. Изменение: при принудительном выходе из guard после max wait добавлен log `Terminal success guard max wait elapsed` с длиной ответа, временем ожидания и причиной. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить регрессию тестом. Изменение: добавлен тест, где Qwen имеет длинный ответ, изменившийся signature и stale lifecycle lock; guard теперь пропускает terminal success после max wait. Файл: `tests/early-terminal-guard.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.68`. Файл: `manifest.json`.

### 2026-05-30 07:45 CEST — v2.73.67

- Для чего: сделать copy-button completion signal пригодным для диагностики hover/hidden toolbar. Изменение: классификация copy-кнопки теперь различает `present`, `visible`, `interactable`, `disabled` и сохраняет эти поля в `metrics.copyButton`/detector signal. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: не принимать copy-кнопку из пользовательского сообщения или неподтверждённого scope. Изменение: добавлен `isAssistantScope()` guard с явной/эвристической проверкой assistant/model/response scope и отклонением user-scope candidate. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: различать тип copy-кнопки без преждевременной финализации code-only/code-block сценариев. Изменение: `classifyCopyButton()` теперь возвращает `copyType: message_toolbar | answer_scope | code_block | rejected`; `code_block` логируется как найденный, но не считается валидным completion evidence. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: сделать сигнал видимым в общем telemetry export как отдельное событие. Изменение: добавлен dedupe-emitter `COPY_COMPLETION_SIGNAL` с `found/valid/present/visible/interactable/copyType/answerHash/rejectedReason`, без сохранения полного текста ответа. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: закрепить новые edge-cases тестами. Изменение: copy-button smoke tests расширены сценариями hidden-toolbar, user-scope rejection и проверки `COPY_COMPLETION_SIGNAL` telemetry. Файл: `tests/copy-button-completion.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.67`. Файл: `manifest.json`.

### 2026-05-30 07:36 CEST — v2.73.66

- Для чего: добавить более надёжный признак окончания генерации, когда модель показывает toolbar ответа после завершения стрима. Изменение: `UnifiedAnswerCompletionWatcher` теперь определяет видимую copy-кнопку рядом с последним assistant answer и учитывает её как `copyButtonVisible` criterion только при отсутствии stop-кнопки и стабильном тексте/fingerprint. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: не ловить ложные copy-сигналы от старых сообщений или кнопок копирования кода. Изменение: copy-кнопка ищется только в scope последнего ответа/близких контейнеров, disabled/hidden controls игнорируются, copy внутри `pre/code` не считается evidence завершения ответа. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: сделать новый сигнал диагностируемым в `All Logs` и result metrics. Изменение: `copyButtonVisible` добавлен в `UniversalCompletionCriteria`, scoring, detector snapshots, verbose criteria log, `completionSelectors`, `selectorAttempts` и `metrics.copyButton`. Файлы: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-watcher.js`.
- Для чего: дать watcher платформенные CSS-кандидаты copy-кнопки. Изменение: добавлены общие copy selectors в основной и fallback selector bundles. Файлы: `content-scripts/answer-pipeline-selectors.js`, `content-scripts/platform-selectors.js`.
- Для чего: сделать поведение управляемым конфигом и покрыть smoke-тестами. Изменение: добавлены `copyButtonSignalEnabled`, `copyButtonRequiresStableText`, `copyButtonMinAnswerLength`, `copyButtonMaxDistancePx`, а также тесты положительного/отрицательного сценариев copy-button completion. Файлы: `content-scripts/pipeline-config.js`, `tests/copy-button-completion.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.66`. Файл: `manifest.json`.

### 2026-05-29 23:48 CEST — v2.73.65

- Для чего: исправить сценарий из `All Logs 20260529_23-44.md`, где Gemini получил terminal `PARTIAL` с ответом, но статус-индикатор оставался жёлтым как будто генерация не завершена. Изменение: в results UI статусы `PARTIAL` и `STREAM_TIMEOUT_HIDDEN` теперь отображаются зелёным terminal-success индикатором, tooltip сохраняет уточнение о partial/timeout. Файл: `results.js`.
- Для чего: убрать ложный жёлтый статус, если панель ответа уже получила непустой текст, но UI-состояние застряло в `GENERATING/RECEIVING/RECOVERABLE_ERROR`. Изменение: `updateLLMPanelOutput()` теперь при валидном непустом ответе поднимает индикатор минимум до `PARTIAL`, если текущий статус ещё не success-like. Файл: `results.js`.
- Для чего: покрыть новый visual-contract smoke-проверкой. Изменение: status indicator smoke test теперь также проверяет `PARTIAL` и `STREAM_TIMEOUT_HIDDEN`. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.65`. Файл: `manifest.json`.

### 2026-05-29 21:53 CEST — v2.73.64

- Для чего: исправить сценарий из `All Logs 20260529_21-48.md`, где Le Chat возвращал текст в панель, но оставался жёлтым и продолжал получать `getResponses`/human visits. Изменение: `content-lechat.js` теперь прокидывает `msg.meta` в `LLM_RESPONSE` при manual `getResponses`, поэтому background видит `manualRecovery/lateCollectFinal/forceTerminalSuccess` и может финализировать ответ вместо повторного streaming defer. Файл: `content-scripts/content-lechat.js`.
- Для чего: сделать ручной сбор Le Chat диагностируемым так же, как Grok/Qwen/DeepSeek. Изменение: manual `getResponses` у Le Chat теперь сразу подтверждает доставку `manual_refresh_dispatched`, а результат асинхронной extraction-операции сообщает отдельным `MANUAL_PING_RESULT` со статусом `success/unchanged/failed/aborted` и `pingId`. Файл: `content-scripts/content-lechat.js`.
- Для чего: остановить обращения к модели после terminal state, даже если terminal записан в FSM раньше legacy-проекции. Изменение: terminal guards в `dispatch-coordinator.js` теперь используют `ModelRunState.isTerminalRunState(entry)` наряду с legacy `status/finalStatus`. Файл: `background/dispatch-coordinator.js`.
- Для чего: не возвращать терминальную модель в ожидание из-за позднего `LLM_RESPONSE_READY` и не запускать лишний manual recovery при наличии cached answer. Изменение: `message-router.js` получил единый `isTerminalRouterEntry()`, который учитывает FSM terminal state. Файл: `background/message-router.js`.
- Для чего: синхронизировать summary/stalled-метрики run с FSM. Изменение: `job-orchestrator.js` использует FSM terminal state в `isTerminalEntry()` и при построении `stalledModels` в `RUN_SUMMARY`. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.64`. Файл: `manifest.json`.

### 2026-05-29 00:11 CEST — v2.73.63

- Для чего: исправить регрессию из `All Logs 20260529_00-08.md`, где планировщики могли продолжать считать модель незавершённой, если terminal state уже был зафиксирован в FSM, но legacy-поля ещё не были спроецированы. Изменение: `isFinalizedEntry()` теперь использует `ModelRunState.isTerminalRunState(entry)` как первый источник терминальности, а legacy `finalStatus/finalStatusRecorded` остаются fallback. Файл: `background/job-orchestrator.js`.
- Для чего: убрать зависание Le Chat/похожих моделей в `Finalization deferred (generation active)` при ложном `busy=true` без видимой кнопки Stop. Изменение: добавлен лимит `DEFER_STREAM_BUSY_ONLY_MAX_MS = 45000`; если уже есть пригодный текст ответа, `busyVisible=true` без `stopVisible` больше не откладывает финализацию до общего лимита 180 секунд. Файл: `background/job-orchestrator.js`.
- Для чего: сделать `All Logs` пригодным для анализа после terminal state. Изменение: прямые `POST_TERMINAL_NOISE` переходы больше не экспортируются как `MODEL_RUN_TRANSITION` по умолчанию; счётчик `postTerminalNoiseCount` продолжает обновляться внутри FSM. Файл: `background/state-manager.js`.
- Для чего: убрать ложные `STATE_DIVERGENCE_DETECTED`, возникавшие в нормальном порядке `transition -> legacy projection`. Изменение: divergence больше не проверяется сразу после каждого transition; проверка остаётся после projection или при явном `detectDivergence=true`. Файл: `background/state-manager.js`.
- Для чего: закрепить снижение telemetry-noise тестом. Изменение: добавлена проверка, что прямой `POST_TERMINAL_NOISE` обновляет FSM-счётчик, но не пишет `MODEL_RUN_TRANSITION` в экспорт без явного `forceTelemetry`. Файл: `tests/model-run-telemetry.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.63`. Файл: `manifest.json`.

### 2026-05-29 00:01 CEST — v2.73.62

- Для чего: исправить регрессию из `All Logs 20260528_23-56.md`, где `RECOVERABLE_ERROR` закрывал FSM как terminal failure и блокировал последующий валидный recovery-ответ (`ANSWER_CANDIDATE_ACCEPTED:terminal_blocks_candidate`). Изменение: `RECOVERABLE_ERROR` теперь остаётся failure-status, но исключён из terminal statuses в общем `StatusContract`. Файл: `shared/status-contract.js`.
- Для чего: не блокировать успешный answer candidate после recoverable/failure состояния. Изменение: `ModelRunState` ввёл `isFinalTerminalStatus()` и не считает `RECOVERABLE_ERROR` финальным terminal; success-кандидат может поднять состояние в `SUCCESS` без `terminal_blocks_candidate`. Файл: `shared/model-run-state.js`.
- Для чего: не ухудшать `All Logs` избыточной state telemetry. Изменение: `MODEL_RUN_TRANSITION` для `POST_TERMINAL_NOISE` теперь дедуплицируется по label/source в окне 10 секунд; счётчик `postTerminalNoiseCount` продолжает обновляться. Файл: `background/state-manager.js`.
- Для чего: закрепить регрессию тестами. Изменение: добавлены проверки, что `RECOVERABLE_ERROR` не является terminal status и не закрывает `ModelRunState`. Файлы: `tests/status-contract.test.js`, `tests/model-run-state.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.62`. Файл: `manifest.json`.

### 2026-05-28 23:24 CEST — v2.73.61

- Для чего: убрать риск расхождения классификации статусов между `status-contract.js` и `model-run-state.js`. Изменение: `ModelRunState` теперь использует `LLMStatusContract` как основной источник `SUCCESS_STATUSES`, `FAILURE_STATUSES`, `TERMINAL_STATUSES`, `normalizeStatus()` и `is*Status()`; локальный список оставлен только как fallback для автономного запуска. Файл: `shared/model-run-state.js`.
- Для чего: сократить прямые записи legacy-полей мимо FSM. Изменение: добавлен `projectModelRunStateToLegacy()` как единая projection-точка для `entry.status`, `entry.finalStatus`, `entry.finalStatusRecorded`, `entry.finalizedAt`, `answer/statusData/responseMeta` и связанных полей. Файл: `background/state-manager.js`.
- Для чего: перевести финальный commit ответа на порядок `transition -> legacy projection`. Изменение: финальная секция `handleLLMResponse()` теперь сначала коммитит `ANSWER_CANDIDATE_ACCEPTED`/`TERMINAL_FAILURE`, затем применяет legacy projection через `projectModelRunStateToLegacy()` вместо прямых `entry.status/finalStatus` записей. Файл: `background/job-orchestrator.js`.
- Для чего: централизовать stop/reset projection. Изменение: `stopAllProcesses()` больше не пишет `jobState.llms[llmName].status = 'STOPPED'` напрямую при наличии projection helper. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить новый контракт тестами. Изменение: `tests/model-run-state.test.js` проверяет совпадение классификации с `StatusContract`, а `tests/model-run-telemetry.test.js` проверяет projection telemetry через `updateModelState()`. Файлы: `tests/model-run-state.test.js`, `tests/model-run-telemetry.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.61`. Файл: `manifest.json`.

### 2026-05-28 22:43 CEST — v2.73.60

- Для чего: сделать dual write / рассинхрон legacy-полей и `modelRunState` видимым в `All Logs`. Изменение: добавлен telemetry helper `commitModelRunTransition()`, который для каждого перехода пишет `MODEL_RUN_TRANSITION` с `previousState`, `nextState`, `legacyBefore`, `legacyAfter`, source и результатом применения. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`, `background/message-router.js`, `background/dispatch-coordinator.js`, `background/telemetry-logs.js`.
- Для чего: прямо фиксировать случаи, когда legacy `status/finalStatus` расходится с `modelRunState.uiStatus/terminalStatus`. Изменение: добавлен `detectModelStateDivergence()` и событие `STATE_DIVERGENCE_DETECTED` с legacy/modelRunState snapshot, причиной и source; повтор одинакового divergence дедуплицируется на 5 секунд. Файл: `background/state-manager.js`.
- Для чего: видеть места, где legacy-поля всё ещё коммитятся как projection после перехода state machine. Изменение: добавлен `emitStateProjectionCommitted()` и событие `STATE_PROJECTION_COMMITTED`; оно вызывается из `updateModelState()` и финальной projection-секции `handleLLMResponse()`. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`.
- Для чего: гарантировать попадание новой state telemetry в общий export-файл. Изменение: `MODEL_RUN_TRANSITION`, `STATE_DIVERGENCE_DETECTED`, `STATE_PROJECTION_COMMITTED` добавлены в pinned telemetry labels. Файл: `background/telemetry-logs.js`.
- Для чего: закрепить диагностику тестами. Изменение: добавлен `tests/model-run-telemetry.test.js`, который проверяет telemetry для заблокированного post-terminal перехода и явного legacy/modelRunState divergence. Файл: `tests/model-run-telemetry.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.60`. Файл: `manifest.json`.

### 2026-05-28 22:16 CEST — v2.73.59

- Для чего: заменить цепочку патчей вокруг жёлтых/ложных статусов единым источником истины. Изменение: добавлен `shared/model-run-state.js` с явной transition matrix для dispatch/generation/lifecycle/answer/terminal/post-terminal состояний модели. Файлы: `shared/model-run-state.js`, `background/index.js`.
- Для чего: отделить диагностические события от изменения состояния модели. Изменение: `LLM_RESPONSE_READY`, `ANSWER_COMPLETE_DETECTED` и post-terminal diagnostics теперь проходят через `ModelRunState`; после terminal success не могут вернуть модель в `RECEIVING/GENERATING`, а шум учитывается как `postTerminalNoiseCount`. Файлы: `background/message-router.js`, `background/dispatch-coordinator.js`, `background/telemetry-logs.js`.
- Для чего: сделать финализацию ответа не набором исключений, а candidate pipeline. Изменение: добавлены `buildAnswerCandidate()`, `evaluateAnswerCandidate()` и `submitAnswerCandidate()` поверх существующего `buildFinalizationEvidence()`; принятые/отклонённые кандидаты пишут переходы `ANSWER_CANDIDATE_ACCEPTED/REJECTED` или `TERMINAL_FAILURE`. Файл: `background/job-orchestrator.js`.
- Для чего: синхронизировать UI-индикаторы с фактическим terminal state. Изменение: `buildGlobalStateSnapshot()` теперь отдаёт `modelRunState`, `terminalState`, `generationState`, `runMetrics`, а results UI предпочитает `modelRunState.uiStatus` перед legacy `status`. Файлы: `background/ui-broadcast.js`, `results.js`.
- Для чего: остановить лишние human/automation visits после терминального состояния. Изменение: human-presence scheduler использует `ModelRunState.isTerminalRunState()` и успех из `modelRunState.terminalState`, а не только legacy-поля. Файл: `background/human-presence.js`.
- Для чего: закрепить новый архитектурный контракт тестами. Изменение: добавлен `tests/model-run-state.test.js` с проверками terminal authority, post-terminal quarantine, accepted answer candidate, terminal failure и run metrics. Файл: `tests/model-run-state.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.59`. Файл: `manifest.json`.

### 2026-05-27 23:25 CEST — v2.73.58

- Для чего: исправить сценарий из `All Logs 20260527_23-17.md`, где ответы уже финализированы как `SUCCESS`, но журнал продолжал показывать признаки активной генерации. Изменение: post-terminal фильтр диагностики теперь отбрасывает `ANSWER_GENERATING`, `answer: layer semantic`, stale `LATE_COLLECT_DECISION_TRACE`, `DOM_FALLBACK_START`, retry/waiting/getResponses и похожие шумовые события после успешного terminal status. Файл: `background/telemetry-logs.js`.
- Для чего: не возвращать финализированную модель в состояние ожидания готовности. Изменение: `LLM_RESPONSE_READY` теперь игнорируется для моделей с terminal status/finalStatusRecorded, вместо вызова `updateModelState(..., 'RECEIVING')`. Файл: `background/message-router.js`.
- Для чего: закрепить проблему тестом. Изменение: добавлен тест, который проверяет, что `ANSWER_GENERATING` после `SUCCESS` не попадает в model logs и не отправляется в results UI, но до terminal success такой diagnostic сохраняется. Файл: `tests/post-terminal-diagnostics.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.58`. Файл: `manifest.json`.

### 2026-05-27 20:57 CEST — v2.73.56

- Для чего: исправить сценарий из `All Logs 20260527_19-39.md`, где `Get answers` успешно вытягивал текст ответа из DOM, но модель могла оставаться жёлтой и продолжать получать human/automation visits. Изменение: `acceptLateCollectResult()` теперь сохраняет входной `responseMeta`, распознаёт явный пользовательский late collect и передаёт `lateCollectFinal/forceTerminalSuccess` в финализацию. Файл: `background/job-orchestrator.js`.
- Для чего: не откладывать пользовательский recovery в `RECEIVING`, когда ответ уже явно собран из DOM. Изменение: streaming defer и early-terminal guard пропускаются для `forceTerminalSuccess`, `lateCollectFinal`, `manualRecovery` и `preTerminalMaterialize`, при этом passive recovery без таких флагов остаётся под защитой от раннего зелёного статуса. Файл: `background/job-orchestrator.js`.
- Для чего: сделать кнопку `Get answers` финальным сбором, а не только обновлением панели. Изменение: `collectResponsesStaged()` помечает свой late collect как `user_collect_late_collect` и terminal-final, чтобы успешный ответ синхронизировал UI-статус, `MODEL_FINAL` и остановку дальнейших визитов вкладки. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить регрессию тестом. Изменение: добавлен тест, где `Qwen` в `RECOVERABLE_ERROR` получает валидный ответ через user late collect и сразу финализируется в `SUCCESS`, без `earlyTerminalGuard`. Файл: `tests/early-terminal-guard.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.56`. Файл: `manifest.json`.

### 2026-05-26 16:09 CEST — v2.73.55

- Для чего: восстановить работу кнопок выбора моделей в header на странице `pipeline_panel.html`. Изменение: добавлена защита от отсутствующего `#compare-button`, чтобы инициализация `results.js` не падала на pipeline-странице и обработчики `.llm-button` корректно навешивались. Файл: `results.js`.
- Для чего: устранить runtime-ошибку при обновлении состояния Compare/Smart в режимах, где кнопка Compare отсутствует. Изменение: `checkCompareButtonState()` теперь обновляет `compareButton.disabled` только при наличии элемента. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.55`. Файл: `manifest.json`.

### 2026-05-21 20:41 CEST — v2.73.45

- Для чего: исправить сценарий из `All Logs 20260521_20-38.md`, где `Qwen` и `Le Chat` сначала находили ответ через recovery/отложенную финализацию, но затем принимали финальный `NO_SEND/ERROR`. Изменение: `buildFinalizationEvidence()` теперь учитывает `pendingFinalAnswer` как answer evidence и блокирует terminal failure при наличии любого answer evidence, включая pre-terminal recovery. Файл: `background/job-orchestrator.js`.
- Для чего: не терять текст, который был показан как `Terminal success deferred (await lifecycle)`. Изменение: early-terminal guard сохраняет `pendingFinalAnswer/pendingFinalAnswerHtml`, чтобы последующая ошибочная финализация могла быть заменена на `SUCCESS` по сохранённому ответу. Файл: `background/job-orchestrator.js`.
- Для чего: сделать такие случаи диагностируемыми в общем export-файле. Изменение: добавлено событие `TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE` и оно включено в pinned telemetry export. Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.
- Для чего: закрепить регрессию тестом. Изменение: добавлен тест, где `NO_SEND` после pre-terminal recovery блокируется при наличии `pendingFinalAnswer`. Файл: `tests/finalization-evidence.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.45`. Файл: `manifest.json`.

### 2026-05-20 09:38 CEST — v2.73.44

- Для чего: исправить ручной вызов ответа конкретной модели по двойному клику на статус-индикаторе журнала модели. Изменение: статус-индикатор теперь отправляет `REQUEST_LLM_RESPONSE` для одной модели, то есть использует тот же путь, что кнопка `Get answers`: сначала отдаётся cached answer из background state, а при отсутствии кэша запускается manual late collect. Файл: `results.js`.
- Для чего: убрать нестабильность обработки двойного клика через `click`/`event.detail`. Изменение: обработчик статус-индикаторов переведён на настоящий delegated `dblclick`; добавлен keyboard fallback `Enter`/`Space`. Файл: `results.js`.
- Для чего: сделать интерактивность статус-индикатора явной для UI и accessibility. Изменение: статус-индикаторы получают `role="button"`, `tabIndex=0`, `aria-label`, tooltip “Double-click to fetch this model answer” и `focus-visible` outline. Файлы: `results.js`, `styles.css`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.44`. Файл: `manifest.json`.


### 2026-05-20 08:47 CEST — v2.73.43

- Для чего: перенести открытие окна телеметрии с общей API-кнопки header на API-индикаторы в журналах/карточках моделей. Изменение: динамические `.api-indicator` теперь являются интерактивными элементами с `role="button"`, `tabIndex=0`, подсказкой и открывают DevTools/telemetry modal по двойному клику. Файл: `results.js`.
- Для чего: сохранить доступность нового действия с клавиатуры. Изменение: для `.api-indicator` добавлен обработчик `Enter`/`Space`, который открывает то же окно телеметрии. Файл: `results.js`.
- Для чего: убрать старое свойство у header API-кнопки. Изменение: удалён `dblclick`-handler с `#api-toggle`, а tooltip изменён с “opens DevTools on double-click” на нейтральное “API: uses connected APIs.” Файлы: `results.js`, `result_new.html`.
- Для чего: визуально показать интерактивность API-индикаторов. Изменение: `.api-indicator` получил `cursor: pointer`, `user-select: none` и `focus-visible` outline. Файл: `styles.css`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.43`. Файл: `manifest.json`.

### 2026-05-20 08:31 CEST — v2.73.42

- Для чего: перейти от точечных recovery-патчей к единому системному слою финализации модели. Изменение: добавлен `buildFinalizationEvidence()` — единый evidence object для каждого финального решения: статус, причина, source, длина/hash ответа, dispatch/tab, promptSubmitted/lifecycle признаки, наличие pre-final recovery, prompt echo, contradictions и accepted flag. Файл: `background/job-orchestrator.js`.
- Для чего: сделать финальный статус объяснимым в `All Logs`. Изменение: перед фиксацией ответа теперь пишется pinned telemetry `FINALIZATION_DECISION`; тот же `finalizationEvidence` попадает в `Response`, `MODEL_FINAL` и `LLM_PARTIAL_RESPONSE.metadata`. Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.
- Для чего: не принимать оригинальный prompt как ответ не только в Grok content-script, но и на уровне background для всех моделей. Изменение: добавлены `normalizeEvidenceText()`, `isPromptEchoAnswerCandidate()` и `ANSWER_SANITY_REJECTED`; prompt echo превращается в `EXTRACT_FAILED/answer_prompt_echo` и проходит общий pre-final recovery вместо зелёного `SUCCESS`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать pre-final recovery частью общего контракта, а не списком исключений для отдельных моделей. Изменение: `PRE_TERMINAL_MATERIALIZE_MODELS` расширен на все web-модели (`GPT`, `Gemini`, `Claude`, `Le Chat`, `Perplexity`, `Grok`, `Qwen`, `DeepSeek`), поэтому спорные `NO_SEND/EXTRACT_FAILED/ERROR` проходят единый materialize + late collect перед финальной ошибкой. Файл: `background/job-orchestrator.js`.
- Для чего: хранить машинное состояние модели отдельно от UI-статуса. Изменение: добавлен `recordModelRunState()` с `executionStatus`, `generationStatus`, `answerStatus`, `uiStatus`, `dispatchId`, `updatedAt`; состояние сохраняется в `entry.modelRunState`. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить новый контракт тестами. Изменение: добавлен `tests/finalization-evidence.test.js` с проверками prompt echo detection, противоречивого `EXTRACT_FAILED` после lifecycle-ready и допустимой финальной ошибки после pre-final recovery. Файл: `tests/finalization-evidence.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.42`. Файл: `manifest.json`.

### 2026-05-19 15:39 CEST — v2.73.41

- Для чего: исправить `Perplexity: extractfailedround4gatetimeout` из `All Logs 20260519_15-33.md`, где до таймаута уже были успешные inline snapshot recovery на 248/1124/3452 символа, но финальный materialization не запускался. Изменение: `Perplexity` добавлен в `PRE_TERMINAL_MATERIALIZE_MODELS`, поэтому перед `EXTRACT_FAILED` теперь выполняется foreground materialization + `lateCollectAnswer()`. Файл: `background/job-orchestrator.js`.
- Для чего: устранить `Le Chat: nosendround4gatetimeout`, когда Round1 пропустил отправку из-за `tab_ineligible`, а дальше система пыталась собирать ответ из неподходящей вкладки. Изменение: при `tab_ineligible/tab_missing` в Round1 оркестратор сбрасывает binding, создаёт новую вкладку Le Chat, ждёт binding/readiness и только затем отправляет prompt; события `ROUND1_TAB_RECOVERY_*` попадают в экспорт. Файл: `background/job-orchestrator.js`.
- Для чего: не проваливать предфинальное recovery, если human-presence automation visit вернул `false`. Изменение: materialization recovery получил fallback `MATERIALIZE_RECOVERY_VISIT_FALLBACK`: прямой focus вкладки + `runPreCollectScrollNudge()` перед поздним сбором ответа. Файл: `background/job-orchestrator.js`.
- Для чего: запретить Grok фиксировать оригинальный prompt как успешный ответ. Изменение: `content-grok.js` сохраняет последний отправленный prompt, проверяет pipeline/manual ping ответы через `isPromptEcho()`, отклоняет echo событием `GROK_PROMPT_ECHO_REJECTED` и ждёт альтернативный non-echo ответ вместо отправки prompt в background как `SUCCESS`. Файл: `content-scripts/content-grok.js`.
- Для чего: исправить fallback поиска non-echo ответа Grok. Изменение: в `waitForNonEchoResponse()` заменён ошибочный `observer.disconnect()` на безопасный вызов `stopObserve()`, иначе echo-recovery мог падать при cleanup. Файл: `content-scripts/content-grok.js`.
- Для чего: сохранить новые диагностические маркеры в общем `All Logs` экспорте. Изменение: `ROUND1_TAB_RECOVERY_*`, `MATERIALIZE_RECOVERY_VISIT_FALLBACK` и `GROK_PROMPT_ECHO_REJECTED` добавлены в pinned telemetry labels. Файл: `background/telemetry-logs.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.41`. Файл: `manifest.json`.

### 2026-05-19 15:18 CEST — v2.73.40

- Для чего: лучше понимать, почему pre-terminal recovery запускается перед `NO_SEND/EXTRACT_FAILED/ERROR`. Изменение: добавлено событие `MATERIALIZE_RECOVERY_CONTEXT` с исходным статусом-кандидатом, причиной, типом ошибки, `dispatchId`, признаками lifecycle, длинами уже известных answer/pending/snapshot и количеством transport-ошибок; полный текст ответа не логируется. Файл: `background/job-orchestrator.js`.
- Для чего: отличать реальную foreground/scroll-материализацию вкладки от ситуации, когда визит не выполнился или вкладка не стала активной. Изменение: добавлено событие `MATERIALIZE_RECOVERY_VISIT_RESULT` с `didVisit`, configured dwell/scroll окнами, `elapsedMs`, delta по focus/human visit, `tabActiveBefore/After`, `tabDiscardedBefore/After`. Файл: `background/job-orchestrator.js`.
- Для чего: видеть, на каком слое позднего сбора ответ был найден или потерян. Изменение: `lateCollectAnswer()` теперь пишет `LATE_COLLECT_DECISION_TRACE` для каждого исхода цепочки (`content_script`, `inline_executeScript`, `snapshot_cache`, `none`) с состоянием вкладки, статусом, длиной текста, hash, candidateCount, selector/strategy и elapsedMs без полного текста ответа. Файл: `background/job-orchestrator.js`.
- Для чего: финальная ошибка после неудачного recovery должна быть объяснима в export-файле. Изменение: перед повторной финализацией исходной ошибки пишется `FINAL_ERROR_AFTER_RECOVERY` с original status/reason, recovery status/source/reason, количеством candidates и recovered length. Файл: `background/job-orchestrator.js`.
- Для чего: гарантировать попадание новой диагностики в общий экспорт `All Logs ...md` даже при большом числе событий. Изменение: новые telemetry labels добавлены в pinned-набор persistent diagnostics, который не вырезается обычным trim unpinned-событий. Файл: `background/telemetry-logs.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.40`. Файл: `manifest.json`.

### 2026-05-19 08:17 CEST — v2.73.39

- Для чего: устранить сценарий из `All Logs 20260519_08-07.md`, когда ответ физически появляется после ручного открытия вкладки и scroll, но до этого модель получает финальный `EXTRACT_FAILED/NO_SEND/ERROR`. Изменение: перед финализацией таких ошибок для `Gemini`, `Le Chat` и `Qwen` добавлен read-only pre-terminal materialization recovery: фокус вкладки, усиленная automation-прокрутка/press-drag через существующий human-presence слой, стабилизационная пауза и затем `lateCollectAnswer()` без reload, без повторной отправки prompt и без dispatch recovery. Файл: `background/job-orchestrator.js`.
- Для чего: не считать `Qwen send not confirmed` окончательным отсутствием ответа, если тот мог быть сгенерирован и просто не был извлечён из виртуализированного DOM. Изменение: `NO_SEND` для Qwen теперь сначала переводится в `RECOVERABLE_ERROR` и получает один предфинальный materialize + late collect проход; только после промаха исходная ошибка фиксируется как финальная. Файл: `background/job-orchestrator.js`.
- Для чего: дать диагностический след, который покажет, сработал ли новый слой восстановления в следующем реальном логе. Изменение: добавлены telemetry-маркеры `MATERIALIZE_RECOVERY_DEFER_TERMINAL`, `MATERIALIZE_RECOVERY_START`, `MATERIALIZE_RECOVERY_SUCCESS`, `MATERIALIZE_RECOVERY_MISS`, `MATERIALIZE_RECOVERY_ERROR`; в miss пишутся candidates/source/status без текста ответа. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс материализации длинного ответа в ленивом/виртуализированном DOM. Изменение: `runForcedAutomationVisits()` получил опциональный `maxScrollDurationMs`, а новый recovery-путь использует более длинное окно scroll, не меняя обычные короткие визиты. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.39`. Файл: `manifest.json`.

### 2026-05-18 20:06 CEST — v2.73.38

- Для чего: убрать дублирование и расхождение правил статусов между background и results UI. Изменение: добавлен общий модуль `shared/status-contract.js` с едиными `SUCCESS/FAILURE/TERMINAL` списками, rank, normalization, downgrade guard и derived contract (`executionState`, `answerState`, `uiStatus`). Файл: `shared/status-contract.js`.
- Для чего: сделать background state источником структурированного статуса, а не только строки `status`. Изменение: `state-manager` и `job-orchestrator` теперь используют `LLMStatusContract.shouldApplyStatusUpdate()` и сохраняют `statusContract`; игнорируемые stale/downgrade события логируются как `STATUS_IGNORED`. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`.
- Для чего: синхронизировать global snapshot с новым контрактом. Изменение: `buildGlobalStateSnapshot()` теперь отдаёт `executionState`, `answerState`, `statusRank`, `liveStatus`, `finalStatus` и итоговый `status` из `deriveStatusContract()`. Файл: `background/ui-broadcast.js`.
- Для чего: убрать отдельную UI-таблицу рангов и использовать тот же guard, что и background. Изменение: `results.js` подключает `shared/status-contract.js` и применяет `LLMStatusContract` для normalization/rank/downgrade guard индикаторов. Файлы: `result_new.html`, `results.js`.
- Для чего: закрепить контракт тестами. Изменение: добавлены unit tests на downgrade `SUCCESS -> PARTIAL`, upgrade `EXTRACT_FAILED -> SUCCESS`, блокировку non-terminal после terminal и derived execution/answer/ui states. Файл: `tests/status-contract.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.38`. Файл: `manifest.json`.

### 2026-05-18 19:00 CEST — v2.73.37

- Для чего: исправить рассинхрон индикаторов статуса, когда ответ уже получен и вставлен, но индикатор остаётся в старом состоянии из-за потерянного или устаревшего `STATUS_UPDATE`. Изменение: `LLM_PARTIAL_RESPONSE` теперь синхронизирует индикатор по `metadata.status`, а не только обновляет текст панели. Файл: `results.js`.
- Для чего: защитить UI от старых поздних событий, приходящих после финального статуса. Изменение: добавлен client-side terminal-rank guard: `SUCCESS` не понижается до `PARTIAL/ERROR/NO_SEND`, terminal-статус не сбрасывается не-terminal событиями, кроме явного reset нового job. Файл: `results.js`.
- Для чего: восстанавливать индикаторы после потери сообщения или перезагрузки results tab. Изменение: `GLOBAL_STATE_BROADCAST` теперь применяется к индикаторам, а background snapshot отдаёт `finalStatus`, `finalStatusRecorded`, `liveStatus` и `statusData`. Файлы: `results.js`, `background/ui-broadcast.js`.
- Для чего: синхронизировать индикаторы из диагностических финальных событий. Изменение: `FINAL_STATUS`, `MODEL_FINAL` и `Status:*` log entries теперь используются как дополнительные authoritative источники статуса. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.37`. Файл: `manifest.json`.

### 2026-05-17 22:38 CEST — v2.73.36

- Для чего: убрать системную причину зависаний на страницах моделей после того, как часть моделей уже завершилась. Изменение: Round2 теперь пропускает модели с `finalStatus/finalStatusRecorded` так же, как Round3/Round4, и пишет `skipped (already complete)` вместо повторной проверки/фокуса. Файл: `background/job-orchestrator.js`.
- Для чего: запретить precollect side effect для завершённых моделей независимо от вызывающего места. Изменение: `runPreCollectScrollNudge()` теперь проверяет terminal state до фокуса вкладки и перед `executeScript`, поэтому завершённая модель не получает scroll/focus nudge из manual/round/deferred путей. Файл: `background/job-orchestrator.js`.
- Для чего: устранить жёлтые индикаторы после уже зафиксированного зелёного успеха. Изменение: `updateModelState()` получил terminal-rank guard и больше не понижает `SUCCESS` до `PARTIAL/ERROR/NO_SEND` поздними событиями. Файл: `background/state-manager.js`.
- Для чего: сохранить возможность ручного восстановления ответа, но не портить terminal status. Изменение: manual late recovery может заменить текст ответа, однако при уже зафиксированном `SUCCESS` входящий `PARTIAL` сохраняет статус `SUCCESS` и логирует `Manual response kept terminal status`. Файл: `background/job-orchestrator.js`.
- Для чего: кнопка “получить ответы” не должна снова ходить по вкладкам, если ответ уже есть в background state. Изменение: `REQUEST_LLM_RESPONSE` теперь сразу отдаёт cached terminal answer и не запускает `handleManualResponsePing()` без `advanceStrategy`. Файл: `background/message-router.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.36`. Файл: `manifest.json`.

### 2026-05-17 10:08 CEST — v2.73.29

- Для чего: убрать ложный жёлтый статус, когда late snapshot вернул полный ответ, но был помечен как `PARTIAL` только из-за источника `snapshot_cache`. Изменение: `handleLLMResponse()` теперь снимает forced partial для `snapshot_cache`, если есть доказательство завершения ответа: `ANSWER_COMPLETE_DETECTED`/`LLM_RESPONSE_READY` с сопоставимой длиной или `generation_inactive` на длинном snapshot. Файл: `background/job-orchestrator.js`.
- Для чего: использовать уже приходящий lifecycle diagnostic как доказательство завершения ответа. Изменение: `updateTypingStateFromDiagnostic()` теперь сохраняет `ANSWER_COMPLETE_DETECTED` в `entry.lifecycleReadyAt/lifecycleReadyMeta/answerCompleteTextLength`, чтобы поздняя финализация могла отличить полный snapshot от настоящего partial. Файл: `background/dispatch-coordinator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.29`. Файл: `manifest.json`.

### 2026-05-17 09:51 CEST — v2.73.28

- Для чего: защитить late answer snapshot cache от устаревших данных после краша extension, перезапуска браузера или пропущенного `stopAllProcesses()`. Изменение: `readAnswerSnapshotCache()` теперь применяет TTL `60 минут`; просроченные snapshot удаляются из in-memory cache и `CompressedStorage`, а не используются как fallback. Файл: `background/job-orchestrator.js`.
- Для чего: гарантировать очистку snapshot cache до создания нового `jobState`. Изменение: `startProcess()` переведён в async, ожидает `clearLateAnswerSnapshotCache("start_process")`, а `START_FULLPAGE_PROCESS` в router теперь вызывает `await startProcess(...)` перед ответом UI. Файлы: `background/job-orchestrator.js`, `background/message-router.js`.
- Для чего: зафиксировать назначение anti-storm защиты для streaming snapshots. Изменение: в `content-scripts/content-utils.js` добавлен комментарий к throttle: `900ms` debounce и минимум `1200ms` между `ANSWER_SNAPSHOT` сообщениями.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.28`. Файл: `manifest.json`.

### 2026-05-17 09:49 CEST — v2.73.27

- Для чего: закрыть риск накопления устаревших DOM snapshot после внедрения late answer collection. Изменение: добавлен `clearLateAnswerSnapshotCache()`, который очищает in-memory cache и удаляет из `chrome.storage.local` все ключи `late_answer_snapshot_v1:*`. Файл: `background/job-orchestrator.js`.
- Для чего: не допустить попадания snapshot старого запуска в новый run. Изменение: `startProcess()` теперь запускает очистку late answer snapshot cache перед новым запуском, а `stopAllProcesses()` дополнительно очищает in-flight late collection и snapshot cache. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.27`. Файл: `manifest.json`.

### 2026-05-17 09:21 CEST — v2.73.26

- Для чего: реализовать недеструктивный механизм позднего сбора ответа, когда ответ уже есть или недавно был в DOM, но не попал в журнал. Изменение: в `background/job-orchestrator.js` добавлен `lateCollectAnswer()` с цепочкой `snapshot cache -> content-script ping/getResponses -> inline executeScript extractor -> cache fallback`, single-flight защитой, bounded timeouts и явными статусами `success`, `partial_from_snapshot`, `dead_tab_no_snapshot`, `late_collect_failed`.
- Для чего: не уничтожать DOM ответа при позднем сборе. Изменение: late collector использует отдельную readable-политику: проверяет `tabs.get`, `discarded`, URL eligibility, короткий ping и read-only `chrome.scripting.executeScript`, но не вызывает `reloadTab`, не переотправляет prompt и не использует destructive dispatch recovery path. Файл: `background/job-orchestrator.js`.
- Для чего: иметь fallback, если content script жив, выгружен или service worker перезапустился. Изменение: добавлен snapshot cache ответа с ключами по `llmName/runSessionId/dispatchId/tabId` и alias-ключами без `dispatchId`; snapshot хранится в памяти и через `CompressedStorage`, а telemetry/diagnostics получают только безопасные метаданные без полного текста ответа. Файлы: `background/job-orchestrator.js`, `background/message-router.js`.
- Для чего: регулярно сохранять последний видимый assistant-текст без тяжёлого reinject. Изменение: `content-scripts/content-utils.js` получил idempotent MutationObserver с debounce/hash, model-specific lightweight selectors, `extractSafeVisibleText()`, `collectLateSnapshotCandidate()` и обработчик `LATE_COLLECT_PING`; content script отправляет `ANSWER_SNAPSHOT` в background без регистрации дополнительных model-specific listeners.
- Для чего: сделать ручное подтягивание ответа через индикатор статуса более надёжным. Изменение: `handleManualResponsePing()` после обычного `getResponses` теперь дополнительно запускает `lateCollectAnswer()` и при успешном результате фиксирует ответ через общий `handleLLMResponse`. Файл: `background/job-orchestrator.js`.
- Для чего: заменить старый примитивный staged collection на единый поздний сбор. Изменение: `collectResponsesStaged()` теперь определяет модель по tab binding/URL и использует `lateCollectAnswer()` вместо короткого `chrome.tabs.sendMessage({ action: "get_response" })` без fallback. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.26`. Файл: `manifest.json`.

### 2026-05-16 19:39 CEST — v2.73.25

- Для чего: использовать индикатор статуса в карточке ответа как быстрый способ подтянуть ответ конкретной модели, если он не попал в журнал вместе с остальными. Изменение: одиночный клик по `.status-indicator` теперь вызывает существующий manual response ping (`MANUAL_RESPONSE_PING`) для модели из `data-llm-name`, сохраняя сам индикатор как визуальный статус. Файл: `results.js`.
- Для чего: сохранить доступ к прежнему окну телеметрии без конфликта с новым действием. Изменение: открытие DevTools/телеметрии перенесено на двойной клик по индикатору статуса; tooltip индикатора теперь показывает статус и подсказку `Click to fetch this model answer`. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.25`. Файл: `manifest.json`.

### 2026-05-16 19:31 CEST — v2.73.24

- Для чего: сделать ссылки в журналах ответов моделей кликабельными. Изменение: `results.js` теперь декорирует ссылки внутри response/log containers атрибутами `target="_blank"`, `rel="noopener noreferrer"` и `contenteditable="false"`, чтобы ссылки не превращались в обычный редактируемый текст внутри панели ответа.
- Для чего: открывать ссылки из журналов ответов в новой вкладке браузера. Изменение: добавлен делегированный click-handler для `.output`, `.response-content`, `.response-body` и диагностических log-контейнеров; при клике по `a[href]` используется `chrome.tabs.create({ url })`, а при недоступности API выполняется fallback на `window.open(..., "_blank")`. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.24`. Файл: `manifest.json`.

### 2026-05-16 19:23 CEST — v2.73.23

- Для чего: не терять частично видимый ответ при deferred hard-stop у DeepSeek/Le Chat/Qwen. Изменение: background DOM snapshot recovery расширен на `Le Chat`, `Qwen` и `DeepSeek`, добавлены платформенные answer selectors, а перед финальным `script_runtime_hard_stop` оркестратор делает последний DOM snapshot recovery и фиксирует найденный ответ вместо чистого `ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: восстановить Qwen после одиночного промаха подтверждения отправки. Изменение: `Qwen` добавлен в `ROUND2_REPAIR_MODELS`, поэтому при `prompt not confirmed` Round2 может выполнить repair-dispatch вместо раннего terminal `NO_SEND`. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс реальной отправки Qwen в текущей разметке. Изменение: `content-qwen.js` получил более широкий поиск send button по `aria-label`, `data-testid`, class/icon/submit-кандидатам рядом с composer, fallback через `Meta+Enter` и `form.requestSubmit()` перед финальным `Qwen send not confirmed`. Файл: `content-scripts/content-qwen.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.23`. Файл: `manifest.json`.

### 2026-05-13 20:36 CEST — v2.73.22

- Для чего: устранить периодический ранний зелёный статус, когда модель ещё продолжает генерировать ответ. Изменение: общий pre-finalization check теперь применяется к основным web-моделям (`GPT`, `Gemini`, `Claude`, `Le Chat`, `Perplexity`, `Grok`, `Qwen`, `DeepSeek`), а не только к GPT/Claude; при видимых stop/busy/streaming признаках оркестратор оставляет модель в состоянии генерации, отправляет только partial update и повторяет сбор ответа. Файл: `background/job-orchestrator.js`.
- Для чего: сделать проверку активной генерации устойчивее для разных интерфейсов и языков UI. Изменение: background-проверка активной генерации теперь учитывает stop-кнопки на нескольких языках, `role=button`, `progressbar`, loading/generating/streaming классы и Qwen-специфичные loading-сигналы. Файл: `background/job-orchestrator.js`.
- Для чего: не принимать непроверенный DOM-фрагмент за финальный ответ после deferred-finalization. Изменение: early terminal guard теперь применяется ко всем основным web-моделям для `deferred_finalization/generation_inactive` и `dom_snapshot_recovery`; короткие ответы могут завершиться только после повторного стабильного наблюдения и max-wait, либо после lifecycle-ready. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить общий сценарий тестами. Изменение: добавлены проверки, что Qwen не фиксируется terminal-success при активной генерации, что Qwen попадает под общий early guard, и что стабильный короткий ответ после guard max-wait не зависает бесконечно. Файл: `tests/early-terminal-guard.test.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.22`. Файл: `manifest.json`.

### 2026-05-13 20:22 CEST — v2.73.21

- Для чего: исправить сценарий Qwen, где prompt фактически отправлялся и ответ генерировался, но run ошибочно фиксировался как `NO_SEND`, из-за чего журнал ответа мог не обновиться. Изменение: в `content-scripts/content-qwen.js` `sendComposer()` теперь делает emergency-retry отправки (дополнительный поиск/клик send button после gesture-scroll) и добавляет окно `late send signals` (user message growth / generation signal / появление assistant candidate) перед финальным `send_failed`.
- Для чего: добавить в Qwen жестовый anti-stuck скролл аналогично требованию по Gemini, когда обычный `scrollBy` неэффективен. Изменение: в `content-scripts/content-qwen.js` `startDriftFallback()` получил `press-and-drag` fallback (синтетическая последовательность `mousedown/mousemove/mouseup` по chat/scroll container) с откатом на `scrollBy`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.21`. Файл: `manifest.json`.

### 2026-05-12 23:58 CEST — v2.73.20

- Для чего: исправить Qwen, когда селектор ответа захватывал слишком широкий контейнер и подтягивал служебный нижний блок выбора режима рассуждения. Изменение: в `content-scripts/answer-pipeline-selectors.js` и `selectors/qwen.config.js` Qwen `response/lastMessage` selectors сужены до реального markdown/response body внутри assistant message; удалены слишком широкие fallback-пути вроде `main article`, `.prose`, `[class*="response"]`, которые могли цеплять посторонние узлы.
- Для чего: убрать попадание слова `Автоматический`/`Automatic` и похожих mode labels в текст ответа Qwen. Изменение: `content-scripts/content-qwen.js` теперь перед извлечением `text/html` клонирует assistant message и вырезает интерактивные/footer/reasoning-mode узлы (`button`, `radiogroup`, `listbox`, `mode-switch`, `reasoning` и точные labels `automatic/автоматический/自动`), после чего извлекает только очищенный markdown body.
- Для чего: зафиксировать поведение тестом. Изменение: добавлен `tests/qwen-extraction.test.js`, который проверяет, что Qwen extractor сохраняет основной ответ и не захватывает нижний reasoning footer с `Автоматический`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.20`. Файл: `manifest.json`.

### 2026-05-12 23:48 CEST — v2.73.19

- Для чего: исправить Gemini, когда ответ был виден lifecycle detector, но итоговый статус и UI теряли семантику `partial/hard_timeout`. Изменение: `content-gemini.js` теперь сохраняет pipeline metadata рядом с `text/html` и передаёт её в background через `meta.responseMeta`, поэтому `streaming_incomplete`, `hard_timeout`, `sanityWarnings`, `sanityConfidence` и `partial` больше не теряются на пути `UnifiedAnswerPipeline -> LLM_RESPONSE -> handleLLMResponse`.
- Для чего: сохранить единый контракт ответа для Gemini и не ломать fallback-пути. Изменение: `normalizeResponsePayload()` расширен поддержкой `meta/metadata`, а отправка `LLM_RESPONSE`/`FINAL_LLM_RESPONSE` мержит `responseMeta` с исходным dispatch meta вместо отправки только `message.meta`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.19`. Файл: `manifest.json`.

### 2026-05-12 23:42 CEST — v2.73.18

- Для чего: убрать ранний зелёный финал у GPT, Gemini и Perplexity, когда в журнал попадал только фрагмент ответа. Изменение: в `background/job-orchestrator.js` добавлен early-terminal guard для рискованных путей `dom_snapshot_recovery` и `deferred_finalization/generation_inactive`; теперь первый короткий или неподтверждённый ответ не фиксируется как terminal `SUCCESS`, а переводится обратно в `RECEIVING` с follow-up ping до lifecycle-ready или повторно стабильного длинного ответа.
- Для чего: связать lifecycle detector с финализацией background-оркестратора. Изменение: `background/message-router.js` теперь сохраняет `LLM_RESPONSE_READY` в `jobState` как `lifecycleReadyAt/lifecycleReadyMeta`, очищает pending early-terminal guard и тем самым разрешает безопасную terminal финализацию только после сигнала готовности ответа.
- Для чего: зафиксировать поведение автоматическими тестами. Изменение: добавлен `tests/early-terminal-guard.test.js` с проверками defer для `dom_snapshot_recovery` и разрешения финализации только после повторно стабильного длинного ответа.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.18`. Файл: `manifest.json`.

### 2026-05-12 23:20 CEST — v2.73.17

- Для чего: закрыть уточнения ТЗ по безопасному lifecycle cancellation. Изменение: `stopResponseLifecycleTracking()` теперь возвращает стабильную форму `{ ok, stopped, reason }`, поддерживает фильтры `modelName`, `dispatchId`, `runSessionId`, выставляет `cancelledAt/cancelReason`, отключает `MutationObserver`, очищает pending timers и является идемпотентным. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: предотвратить поздние readiness/final события после cleanup. Изменение: добавлен `isTrackerActive()` и cancellation guard перед `ANSWER_COMPLETE_DETECTED`, `LLM_RESPONSE_READY` и возвратом `COMPLETE`; ожидания polling теперь используют cancellable timers, чтобы остановка tracker немедленно завершала loop как `CANCELLED`. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: убрать тяжёлые selector resolver вызовы из каждого lifecycle tick. Изменение: composer/send readiness сначала проверяется дешёвым `detectCheapComposerReadiness()`, а `SelectorResolverV2.resolveComposer()` / `resolveSendButton()` вызываются только после `textStable` и с коротким timeout `800ms`. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: ограничить fallback DOM text extraction по обновлённому контракту. Изменение: `extractSafeVisibleText()` теперь принимает `maxChars = 10000`, нормализует whitespace, не выбрасывает исключения и обрезает возвращаемый текст. Файл: `content-utils/selector-resolver-v2.js`.
- Для чего: зафиксировать новые lifecycle guarantees тестами. Изменение: добавлены проверки cap для `extractSafeVisibleText`, идемпотентного stop, отсутствия `LLM_RESPONSE_READY` после cancellation и отсутствия heavy resolver вызовов до text stability. Файл: `tests/selector-resolver-v2.spec.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.17`. Файл: `manifest.json`.

### 2026-05-12 22:47 CEST — v2.73.16

- Для чего: добавить детерминированный self-healing слой селекторов без внешних зависимостей для composer, send button и latest assistant answer. Изменение: добавлены новые модули `content-utils/selector-resolver-v2.js` и `content-utils/response-lifecycle-detector.js` с exact/cache/semantic/spatial resolution, fingerprint/cache validation, shadow-DOM scan, lifecycle tracking, generating-indicator detection, self-test API и безопасной телеметрией без prompt/answer persistence. Файлы: `content-utils/selector-resolver-v2.js`, `content-utils/response-lifecycle-detector.js`.
- Для чего: загрузить новые resolver/lifecycle utilities раньше model-specific content scripts и не менять host permissions. Изменение: оба модуля подключены в общий LLM content-script bundle и продублированы перед каждым model-specific content script entry, чтобы fallback и async lifecycle были доступны до инициализации платформенных скриптов. Файл: `manifest.json`.
- Для чего: добавить background-level placeholder и readiness signal без вмешательства в текущий final answer flow. Изменение: `background/message-router.js` теперь обрабатывает `VISUAL_RESOLVE_REQUEST` как disabled placeholder, принимает `LLM_RESPONSE_READY` только как diagnostic/readiness update и нормализует `selector_resolution` metric через `layer || method`, не меняя существующий `LLM_RESPONSE / FINAL_LLM_RESPONSE` путь. Файл: `background/message-router.js`.
- Для чего: покрыть новую логику unit tests и зафиксировать jsdom runtime mocks для новых модулей. Изменение: добавлены тесты на resolver scoring, cache validation, fingerprint similarity, shadow-DOM budget limits, short-answer fallback, lifecycle stability/timeout/privacy и обновлён `tests/setupEnv.js` для `chrome.runtime.onMessage` и manifest mock. Файлы: `tests/selector-resolver-v2.spec.js`, `tests/setupEnv.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.16`. Файл: `manifest.json`.

### 2026-04-24 14:21 CEST — v2.73.15

- Для чего: исправить reuse вкладок для всех моделей, когда `New Pages` выключен. Изменение: поиск кандидата для attach теперь проходит по всем открытым вкладкам и фильтрует их вручную по URL-паттернам и пригодности, вместо зависимости от узкого `chrome.tabs.query` пути, поэтому non-GPT модели тоже должны переиспользовать уже открытые вкладки, если они есть. Файл: `background/tab-manager.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.15`. Файл: `manifest.json`.

### 2026-05-17 20:27 CEST — v2.73.35

- Для чего: устранить зависание на Claude, когда вкладка захватывала фокус до завершения ответа и `FOCUS_STUCK` только логировался, но не освобождал визит. Изменение: `FOCUS_STUCK` теперь принудительно завершает активный human visit, возвращает фокус на страницу результатов и пишет отдельный диагностический маркер `HUMAN_VISIT_FOCUS_STUCK_TERMINATED`. Файл: `background/human-presence.js`.
- Для чего: защититься от ситуации, когда глобальный hard-cap визита перезаписывается другим визитом и текущая вкладка остаётся активной слишком долго. Изменение: каждый `visitTabWithHumanity()` получил локальный `HUMAN_VISIT_HARD_CAP_MS` таймер, который очищается при нормальном завершении и завершает только свой активный визит при превышении лимита. Файл: `background/human-presence.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.35`. Файл: `manifest.json`.

### 2026-05-17 20:08 CEST — v2.73.34

- Для чего: остановить посещение страниц моделей, которые уже получили terminal-статус. Изменение: `hasPendingHumanVisits()` больше не вызывает `scrollTabToBottom()` для завершённых моделей; проверка pending-состояния стала read-only и не трогает страницы. Файл: `background/human-presence.js`.
- Для чего: не зависать на Qwen или другой модели, если она стала terminal во время активного human/automation visit. Изменение: активные visits получили polling terminal-состояния каждые `500ms` и завершаются сразу после `finalStatus/finalStatusRecorded`, очищая timers/locks и возвращая фокус. Файл: `background/human-presence.js`.
- Для чего: не запускать forced automation visit, если модель уже завершилась между планированием и фактическим визитом. Изменение: `runForcedAutomationVisits()` проверяет terminal-состояние перед каждым визитом, логирует `FORCED_VISIT_SKIPPED`, не считает skipped-визиты выполненными и прекращает цикл после terminal. Файл: `background/job-orchestrator.js`.
- Для чего: не выполнять post-visit collection шаги для модели, которая завершилась во время precollect visit. Изменение: Round3 и post-R2 auto collect повторно проверяют terminal-состояние после visit и не запускают scroll nudge / response ping для уже завершённой модели. Файл: `background/job-orchestrator.js`.
- Для чего: убрать misleading Round4 telemetry, будто завершённые модели снова фокусируются. Изменение: model-level Round4 START/END для terminal-моделей теперь пишется как `skipped (already complete)`, а не `focusing results tab`. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.34`. Файл: `manifest.json`.

### 2026-05-17 19:41 CEST — v2.73.33

- Для чего: понять, почему при реальном тесте Grok визуально “не реагирует” на двойной клик по индикатору. Изменение: обработчик индикаторов статуса переведён на delegated click-handler, поэтому работает и для статических, и для динамически созданных `.status-indicator`; одиночный клик логируется как ignored, двойной клик запускает manual recovery. Файл: `results.js`.
- Для чего: отличать проблему UI-события от проблемы background/content-script. Изменение: в diagnostics добавлены события `Manual ping: status indicator double-click` и `Manual ping: status indicator single click ignored` с source/advance details. Файл: `results.js`.
- Для чего: видеть, дошёл ли восстановленный ответ до страницы результатов и был ли вставлен в DOM-панель. Изменение: при manual ping логируется `Manual ping: response payload received` с `textLen/htmlLen`, а `updateLLMPanelOutput()` пишет `Panel output updated` или `Panel output update failed` с id панели и длинами. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.33`. Файл: `manifest.json`.

### 2026-05-17 19:19 CEST — v2.73.32

- Для чего: запускать ручное подтягивание ответа именно по двойному клику на индикаторе статуса ответа в журнале модели. Изменение: обработчик `.status-indicator` теперь вызывает `triggerManualPing()` только на `dblclick`; одиночный клик больше не запускает manual recovery. Файл: `results.js`.
- Для чего: убрать конфликт с телеметрией, так как её открытие уже доступно двойным кликом по кнопке API. Изменение: открытие DevTools/telemetry modal с индикатора статуса удалено. Файл: `results.js`.
- Для чего: синхронизировать подсказку UI с новым поведением. Изменение: tooltip индикатора статуса теперь показывает `Double-click to fetch this model answer`. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.32`. Файл: `manifest.json`.

### 2026-05-17 19:10 CEST — v2.73.31

- Для чего: не считать рабочую стратегию плохой при первом ручном восстановлении ответа. Изменение: `MANUAL_RESPONSE_PING` и `REQUEST_LLM_RESPONSE` получили явный `advanceStrategy`; предыдущий DOM-кандидат помечается rejected только при `advanceStrategy=true`. Файлы: `background/message-router.js`, `background/job-orchestrator.js`, `results.js`.
- Для чего: разделить UX “получить ответ” и “попробовать следующий селектор” без отдельной кнопки. Изменение: первый клик по индикатору отправляет `advanceStrategy=false`, последующие клики после запуска recovery отправляют `advanceStrategy=true`. Файл: `results.js`.
- Для чего: сделать ручное восстановление диагностируемым. Изменение: `manualRecovery` теперь хранит `lastAcceptedCandidate`, `exhausted`, `candidateCount`, `textHash`, `strategyId`, `strategyIndex` и selector metadata; content-script/live и inline late collect возвращают diagnostics в результат. Файл: `background/job-orchestrator.js`.
- Для чего: явно зафиксировать безопасный fallback, когда content script недоступен. Изменение: inline fallback документирован как read-only `chrome.scripting.executeScript` с чистым extractor, без reinjection, listeners/observers, reload, resend prompt или DOM mutation. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.31`. Файл: `manifest.json`.

### 2026-05-17 12:24 CEST — v2.73.30

- Для чего: дать кнопке журнала модели не только повторно запросить ответ, но и восстановить неправильный ответ после промаха селектора. Изменение: manual ping получил persistent `manualRecovery` state в `jobState.llms[llmName]`, хранит использованные стратегии/селекторы и при повторном клике помечает предыдущий кандидат rejected. Файл: `background/job-orchestrator.js`.
- Для чего: при повторном клике выбирать другой DOM-путь, а не возвращать тот же ошибочный блок. Изменение: inline late extractor получил стратегии `default_score`, `last_visible`, `bottom_most`, `longest`, `markdown_only`, `assistant_role_only`, `article_bottom`, а single-flight late collect теперь разделяется по strategy/attempt. Файл: `background/job-orchestrator.js`.
- Для чего: разрешить ручному восстановлению заменить уже финализированный ответ, если пользователь видит, что журнал подтянул неверный текст. Изменение: `handleLLMResponse` принимает success-ответы с `manualRecovery/manualOverride` поверх terminal-lock, но не позволяет manual override по ошибочным или слишком коротким payload. Файл: `background/job-orchestrator.js`.
- Для чего: пробросить режим ротации селекторов от кнопки статуса/журнала до background. Изменение: `MANUAL_RESPONSE_PING` теперь принимает `manualRecovery`, `advanceSelector` и `reason`, а UI отправляет эти параметры при клике по индикатору. Файлы: `background/message-router.js`, `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.30`. Файл: `manifest.json`.

### 2026-04-24 14:05 CEST — v2.73.14

- Для чего: исправить Qwen, когда ответ генерируется, но не попадает в журнал. Изменение: Qwen-извлечение теперь учитывает реальные классы текущей разметки (`qwen-chat-message-assistant`, `chat-response-message-right`, `response-message-content`, `custom-qwen-markdown`, `qwen-markdown`), чтобы ответ не терялся при промахе по более общим селекторам. Файлы: `content-scripts/content-qwen.js`, `selectors/qwen.config.js`, `selectors/config-bundle.js`, `content-scripts/answer-pipeline-selectors.js`.
- Для чего: при выключенном `New Pages` предпочитать уже открытые вкладки модели, а не открывать новые. Изменение: поиск существующей вкладки для attach больше не режется фильтром `audible:false`, поэтому reuse может сработать для любой уже открытой подходящей вкладки, включая последнюю по времени. Файл: `background/tab-manager.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.14`. Файл: `manifest.json`.

### 2026-04-24 13:41 CEST — v2.73.13

- Для чего: добавить автономный browser-level тест для Qwen через Playwright, чтобы проверять реальную вкладку и обновление журнала ответа без участия пользователя. Изменение: добавлен скрипт `tests/qwen-playwright-check.js`, который запускает persistent Chromium с расширением, открывает `result_new.html`, инициирует только Qwen-ран и ждёт фактического заполнения панели `output-qwen`. Файл: `tests/qwen-playwright-check.js`.
- Для чего: сделать этот прогон доступным через стандартную команду проекта. Изменение: в `package.json` добавлен `npm run test:qwen`. Файл: `package.json`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.13`. Файл: `manifest.json`.

### 2026-04-24 13:31 CEST — v2.73.12

- Для чего: исправить сценарий, где Qwen генерирует ответ и статус остаётся зелёным, но ответ не попадает в журнал из-за промаха по селекторам. Изменение: `content-qwen.js` теперь использует более широкий DOM fallback для извлечения ответа, а `answer-pipeline-selectors.js` получил расширенный Qwen selector pack и alias `response`, чтобы журнал мог подхватить ответ даже при изменении разметки. Файлы: `content-scripts/content-qwen.js`, `content-scripts/answer-pipeline-selectors.js`.
- Для чего: уменьшить зависимость Qwen от одного пути подтверждения отправки. Изменение: `sendComposer` теперь подтверждает отправку по новому user-message или явному streaming/busy-сигналу, а не по очистке composer. Файл: `content-scripts/content-qwen.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.12`. Файл: `manifest.json`.

### 2026-04-22 16:17 CEST — v2.73.11

- Для чего: не фиксировать GPT/Claude зелёными по первому неполному фрагменту ответа. Изменение: `job-orchestrator.js` теперь перед terminal `SUCCESS` для GPT и Claude проверяет вкладку через `chrome.scripting.executeScript`; если виден `Stop`/streaming/busy-сигнал, финализация откладывается, в UI отправляется только partial update, а сбор ответа повторяется через deferred ping. Файл: `background/job-orchestrator.js`.
- Для чего: устранить ложный `SUCCESS` Qwen, когда prompt фактически не был отправлен/не появился в чате. Изменение: `content-qwen.js` больше не считает отправку подтверждённой по одному только очищению composer; подтверждение требует streaming-сигнал, disabled send button или появление нового user-message с началом prompt. Файл: `content-scripts/content-qwen.js`.
- Для чего: не принимать старый ответ Qwen как новый после неудачной отправки. Изменение: fallback-наблюдение Qwen теперь учитывает baseline count контейнеров сообщений и не возвращает старый last message, если после send не появился новый контейнер. Файл: `content-scripts/content-qwen.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.11`. Файл: `manifest.json`.

### 2026-04-22 15:51 CEST — v2.73.10

- Для чего: устранять жёлтый статус Gemini/Perplexity, когда ответ уже есть на странице, но content-script канал сломан (`message port closed` / `message channel closed`). Изменение: добавлен background-level DOM snapshot recovery для Gemini и Perplexity: background выполняет `chrome.scripting.executeScript` во вкладке, ищет последний assistant-answer по DOM/shadow-DOM селекторам и передаёт найденный текст в `handleLLMResponse` как `dom_snapshot_recovery`. Файл: `background/job-orchestrator.js`.
- Для чего: запускать DOM recovery именно в сценариях из лога `All Logs 20260422_15-45.md`. Изменение: recovery вызывается при `PING_TRANSPORT_ERROR` в passive/manual ping и при `transport_error_after_submit`, не затрагивая Grok, где зависание связано с самой моделью и ответ не появился. Файлы: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.10`. Файл: `manifest.json`.

### 2026-04-20 10:23 CEST — v2.73.09

- Для чего: убрать ложный красный хвост после успешного `MODEL_FINAL`. Изменение: `telemetry-logs.js` теперь отбрасывает известные шумные post-terminal события для моделей с зафиксированным успешным финалом (`PIPELINE_ERROR`, `SELECTOR_STATS`, `FOCUS_STUCK`, visit/lease-события, transport/pipeline-noise), не скрывая реальные ошибки до финала. Файл: `background/telemetry-logs.js`.
- Для чего: остановить источник поздних `FOCUS_STUCK` и `TAB_VISIT` после успеха. Изменение: `human-presence.js` теперь не начинает human/automation visit для модели с успешным terminal-статусом, проверяет terminal-состояние перед фактическим переключением вкладки и умеет завершать активный визит по конкретной модели. Файл: `background/human-presence.js`.
- Для чего: синхронизировать финал модели с остановкой human-presence. Изменение: при `SUCCESS`, `PARTIAL` или `STREAM_TIMEOUT_HIDDEN` оркестратор вызывает `completeHumanPresenceForModel`, чтобы убрать активные visit/automation locks сразу после фиксации результата. Файл: `background/job-orchestrator.js`.
- Для чего: гарантированно очищать телеметрию прошлого прогона при reload страницы результатов. Изменение: `results.js` теперь ожидает ответ `CLEAR_DIAG_EVENTS` перед дальнейшей инициализацией, чтобы экспорт не успевал прочитать старый `__diagnostics_events__`. Файл: `results.js`.
- Для чего: не переносить диагностику между сетями даже без reload страницы. Изменение: `message-router.js` очищает persistent telemetry и runtime `entry.logs` при `CLEAR_DIAG_EVENTS` и перед запуском нового `START_FULLPAGE_PROCESS`. Файл: `background/message-router.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.09`. Файл: `manifest.json`.

### 2026-04-20 09:56 CEST — v2.73.08

- Для чего: очищать телеметрию прошлого запуска при перезагрузке страницы результатов. Изменение: `results.js` теперь определяет `navigation.type === 'reload'` и отправляет `CLEAR_DIAG_EVENTS` в background до восстановления UI, чтобы `__diagnostics_events__` не тянулся из предыдущей сети/прогона. Файл: `results.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.08`. Файл: `manifest.json`.

### 2026-04-19 15:26 CEST — v2.73.07

- Для чего: устранить ложный `NO_SEND` у Grok, когда `Ctrl+Enter` не срабатывает в новой разметке. Изменение: добавлен дополнительный путь отправки `Enter`, а также fallback через `form.requestSubmit()` после неуспешных попыток кнопкой/клавиатурой. Файл: `content-scripts/content-grok.js`.
- Для чего: уменьшить задержку фактической отправки на Claude после ввода prompt. Изменение: фиксированная пауза перед send снижена с 2000ms до 350ms. Файл: `content-scripts/content-claude.js`.
- Для чего: убрать сценарий «красный статус + manual ping skipped» для недавно завершённых `EXTRACT_FAILED/NO_SEND/ERROR`. Изменение: manual ping теперь разрешён для recoverable terminal-статусов в пределах окна 180s; добавлен диагностический маркер `Manual ping override (recoverable terminal)`. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс автоматического восстановления Grok ещё на этапе Round2. Изменение: Grok добавлен в `ROUND2_REPAIR_MODELS`, чтобы при `prompt not confirmed` выполнялся repair-dispatch. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.07`. Файл: `manifest.json`.

### 2026-04-19 10:30 CEST — v2.73.06

- Для чего: сократить длительное «красное окно» после `script_runtime_hard_stop`, когда ответ может прийти с задержкой. Изменение: добавлены модельно-зависимые defer-окна (`Gemini/Claude/Le Chat/Perplexity/Grok`) и расширен deferred-recovery не только для `GPT`; перед финальной hard-stop ошибкой добавлен дополнительный `final_ping_before_error`. Файл: `background/job-orchestrator.js`.
- Для чего: ускорить восстановление канала при `PING_TRANSPORT_ERROR` и `message port closed`. Изменение: `sendPassiveMessageWithRetries` поддерживает явный план задержек (`transportRetryDelays`), а оркестратор использует быстрый профиль ретраев для `getResponses` ping (включая hard-stop и manual ping). Файлы: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`.
- Для чего: убрать повторяющийся flood `SELECTOR_STATS` и повысить сигнал/шум в диагностике. Изменение: в watcher добавлена дедупликация одинаковых selector-метрик в окне `selectorStatsDedupWindowMs` (по умолчанию 30s). Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до `2.73.06`. Файл: `manifest.json`.
