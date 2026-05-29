## Change Log — Codex Agent (start 2025-11-30)

### 2026-03-02 20:18 — v2.72.91

- Для чего: убрать задержку и многократные попытки отправки в LeChat, когда submit подтверждался слишком поздно. Изменение: в `sendComposer` удалена лишняя стартовая пауза 2s, сокращены окна confirm-check и ускорен polling подтверждения отправки. Файл: `content-scripts/content-lechat.js`.
- Для чего: повысить вероятность успешной отправки с первой попытки на LeChat. Изменение: порядок стратегий отправки изменён на `button click -> Enter -> Ctrl+Enter` (вместо позднего button-click после Ctrl+Enter), добавлено более раннее подтверждение по индикаторам генерации/Stop/aria-busy и очистке composer. Файл: `content-scripts/content-lechat.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.91. Файл: `manifest.json`.


### 2026-03-02 16:23 — v2.72.90

- Для чего: уменьшить ложный финал `script_runtime_hard_stop` у GPT после отложенного окна, когда обычный deferred ping не добирает ответ. Изменение: в deferred hard-stop добавлен активный recovery-проход для `GPT` (`HARD_STOP_DEFERRED_RECOVERY_*`): короткий automation visit + двойной `getResponses` ping до окончательной ошибки. Файл: `background/job-orchestrator.js`.
- Для чего: снизить дубли финальных телеметрий и шум в логах при повторных callback одного и того же завершения. Изменение: добавлена дедупликация `MODEL_FINAL` по ключу `status/reason/dispatchId` в окне `MODEL_FINAL_DEDUP_WINDOW_MS`; повтор блокируется только для telemetry emit, без пропуска обновления состояния ответа. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.90. Файл: `manifest.json`.

### 2026-03-02 09:24 — v2.72.89

- Для чего: исправить кейс GPT, когда после завершённой генерации обычный scroll не активирует нужный path обновления, а срабатывает только жест с удержанием нажатия. Изменение: `continuous press` (`pointerdown -> pointermove* -> pointerup` с сохранением pressed-state) расширен на модель `GPT` в `simulateHumanActivityInPage` (ранее только `Gemini/Perplexity`). Файл: `background/human-presence.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.89. Файл: `manifest.json`.

### 2026-03-02 08:32 — v2.72.88

- Для чего: снизить массовые `ROUND2` skip по `batch_timeout`, когда ранние модели потребляют слишком большой verify-бюджет. Изменение: в `dispatchRound2Verification` добавлен per-model budget на основе оставшегося времени батча и числа pending-моделей; визиты теперь масштабируются по бюджету через `ROUND2_MODEL_BUDGET` (`visitCount/min/max`), а при дефиците времени модель получает `ROUND2_MODEL_BUDGET_SKIP`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать Round2 более предсказуемым под нагрузкой. Изменение: добавлены лимиты `ROUND2_MODEL_VISIT_BUDGET_MS`, `ROUND2_MODEL_MIN_REMAINING_MS`, `ROUND2_MODEL_MIN_DWELL_MS`, которые ограничивают длительность verify-визитов и предотвращают перерасход общего batch-окна. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.88. Файл: `manifest.json`.

### 2026-03-02 08:25 — v2.72.87

- Для чего: убрать немонотонные terminal-переходы и защитить финальный статус от деградации. Изменение: добавлен rank-based terminal guard (`SUCCESS > PARTIAL > ERROR > NO_SEND`) с блокировкой downgrade (`Response ignored (terminal rank downgrade)`) и контролируемым upgrade (`Terminal status upgraded`). Файл: `background/job-orchestrator.js`.
- Для чего: уменьшить ложные финализации по `script_runtime_hard_stop`, когда есть признаки живой runtime/канала. Изменение: введён отложенный hard-stop (`HARD_STOP_DEFERRED`) с коротким окном (`HARD_STOP_DEFER_WINDOW_MS`), probe через `triggerResponseCollectionPing` и одноразовым retry-флагом `hardStopDeferredRetry`. Файл: `background/job-orchestrator.js`.
- Для чего: убрать залипание фокуса на отдельных моделях и сверхдлинные цепочки `TAB_VISIT`. Изменение: добавлена quota-модель foreground-визитов (`VISIT_QUOTA_WINDOW_MS`, `VISIT_QUOTA_MAX_MS`, `VISIT_QUOTA_COOLDOWN_MS`) с backoff-событием `VISIT_QUOTA_BACKOFF`; human/automation цикл пропускает модель до конца cooldown. Файл: `background/human-presence.js`.
- Для чего: не запускать automation-визиты во время quota-backoff. Изменение: `visitTabWithAutomation` теперь ранне завершается с `AUTOMATION_VISIT_SKIPPED` и причиной `quota_backoff_active`. Файл: `background/human-presence.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.87. Файл: `manifest.json`.

### 2026-03-01 22:29 — v2.72.86

- Для чего: устранить поздний `ROUND2_CUTOFF`, который срабатывал после длительной последовательной верификации и приводил к массовым skip уже “задним числом”. Изменение: в Round2 добавлен общий deadline (`round2DeadlineAt`) с повторной проверкой бюджета не только в начале цикла, но и перед/после затратных verify-визитов; cutoff теперь выполняется сразу для оставшихся моделей. Файл: `background/job-orchestrator.js`.
- Для чего: убрать аномалии тайминга cutoff и сделать диагностику устойчивой к рассинхрону wall-clock. Изменение: расчёт elapsed для `ROUND2_CUTOFF` переведён на монотонный источник (`performance.now`) с fallback на `Date.now`, в meta добавлены `wallElapsedMs/remainingMs` для RCA. Файл: `background/job-orchestrator.js`.
- Для чего: исключить перекрывающиеся automation-визиты одной и той же вкладки, которые растягивали `TAB_VISIT` и давали поздний release. Изменение: добавлен lock-guard `AUTOMATION_VISIT_SKIPPED (overlap_guard)` по ключу `llm:tab`. Файл: `background/human-presence.js`.
- Для чего: не допускать затягивания automation-визита при зависшем `executeScript`/долгом Promise. Изменение: в `visitTabWithAutomation` добавлены независимые таймеры `dwell` и `AUTOMATION_VISIT_HARD_CAP`, финализация больше не ждёт завершения simulation Promise. Файл: `background/human-presence.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.86. Файл: `manifest.json`.

### 2026-02-28 09:33 — v2.72.85

- Для чего: уменьшить риск извлечения хвоста/UI-фрагмента вместо полного ответа у Claude/Grok. Изменение: ужесточены `lastMessage` и `streamStart` селекторы (приоритет ассистентских response-контейнеров, снижение роли generic селекторов) в `content-scripts/answer-pipeline-selectors.js`.
- Для чего: стабилизировать выбор кандидата ответа Grok при конкурирующих DOM-узлах. Изменение: в `grabLatestAssistantText` добавлен quality scoring (assistant/response markers + длина текста) вместо выбора только по позиции в DOM; fallback-селекторы Grok ограничены более целевыми контейнерами. Файл: `content-scripts/content-grok.js`.
- Для чего: убрать ранний захват широких селекторов в Claude DOM fallback. Изменение: `CLAUDE_ASSISTANT_RESPONSE_SELECTORS` переведены на `:last-of-type` ассистентские контейнеры; удалены общие `.prose`/`main article` из primary-path. Файл: `content-scripts/content-claude.js`.
- Для чего: снизить влияние устаревших manual/remote override на извлечение ответа. Изменение: для `elementType=response` в `getSelectorsFor` приоритет отдан versioned selector list, manual overrides применяются после него. Файл: `selectors-config.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.85. Файл: `manifest.json`.

### 2026-02-28 08:40 — v2.72.84

- Для чего: зафиксировать описание фикса полного ответа Claude/Grok. Изменение: добавлен документ с проблемой/причинами/решением и чек-листом валидации. Файл: `docs/claude-grok-full-response-fix-2026-02-16.md`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.84. Файл: `manifest.json`.

### 2026-02-16 13:42 — v2.72.79

- Для чего: убрать поздний запуск pointer-drag recovery у Gemini/Perplexity (когда жест срабатывал почти у границы hard-stop). Изменение: добавлен ранний триггер `EARLY_GESTURE_RECOVERY` по условиям `elapsed>=45s` после submit + накопление `PING_TRANSPORT_ERROR` (>=3) + cooldown, с запуском короткого automation-visit до hard-stop. Файл: `background/job-orchestrator.js`.
- Для чего: сделать ранний recovery не одноразовым и управляемым по нагрузке. Изменение: добавлены параметры окна/порога/кулдауна (`EARLY_GESTURE_RECOVERY_*`) и телеметрия `EARLY_GESTURE_RECOVERY_START/END/ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: не запускать ранний recovery "вслепую". Изменение: введён подсчёт `pingTransportErrorCount` и timestamp последней transport-ошибки, счётчик сбрасывается на успешном `getResponses`. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.79. Файл: `manifest.json`.

### 2026-02-16 13:21 — v2.72.78

- Для чего: добавить рабочий recovery-сценарий для случаев, когда обычный scroll не снимает зависший "красный" статус у Gemini/Perplexity. Изменение: в `simulateHumanActivityInPage` добавлен отдельный жест `continuous press` с последовательностью `pointerdown -> pointermove* -> pointerup`. Файл: `background/human-presence.js`.
- Для чего: воспроизвести именно жест с непрерывным удержанием нажатия, а не обычный скролл. Изменение: во всей фазе движения между `pointerdown` и `pointerup` сохраняется pressed-state (`buttons=1`, `pressure>0`) и выполняются 2 цикла траектории "вверх ~1.5 экрана -> вниз ~1.5 экрана". Файл: `background/human-presence.js`.
- Для чего: не раздувать human-visit для остальных платформ. Изменение: новый pointer-drag recovery включается только для `Gemini` и `Perplexity`. Файл: `background/human-presence.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.78. Файл: `manifest.json`.

### 2026-02-16 12:26 — v2.72.77

- Для чего: убрать ложные `script_runtime_hard_stop`, когда ответ приходит на границе таймаута. Изменение: hard-stop стал двухступенчатым — при свежей runtime-активности даётся ограниченное grace-окно (`SCRIPT_RUNTIME_HARD_STOP_GRACE_MS`, максимум 2 продления), затем выполняется принудительная финализация. Файл: `background/dispatch-coordinator.js`.
- Для чего: дать hard-stop реальный сигнал “модель жива”, а не опираться только на стартовый timestamp. Изменение: добавлен `markModelRuntimeActivity`; активность фиксируется из diagnostics, `PROMPT_SUBMITTED` и входящих `LLM_RESPONSE`. Файлы: `background/dispatch-coordinator.js`, `background/message-router.js`, `background/job-orchestrator.js`.
- Для чего: убрать дубли `MODEL_FINAL/SUCCESS` после уже терминального статуса. Изменение: в `handleLLMResponse` добавлен guard `Response ignored (duplicate terminal)` для одинакового terminal-статуса при совпадающем/пустом dispatch-контексте. Файл: `background/job-orchestrator.js`.
- Для чего: снизить шум “красных” transport ошибок в пассивных ping-цепочках. Изменение: пассивные ошибки помечаются как `PING_TRANSPORT_ERROR` (warning), а не `COMMAND_SEND_ERROR`; post-send recovery для Perplexity разрешает одноразовый recovery-путь. Файлы: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.
- Для чего: уменьшить зацикливание human-visit при деградации канала после submit. Изменение: введён краткий transport backoff (`transportBackoffUntil`), который временно исключает модель из очереди активных визитов. Файлы: `background/dispatch-coordinator.js`, `background/human-presence.js`.
- Для чего: синхронизировать downgrade timeout-like ошибок с новой причиной. Изменение: в downgrade-список добавлен `script_runtime_hard_stop`. Файл: `background/telemetry-logs.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.77. Файл: `manifest.json`.

### 2026-02-16 01:56 — v2.72.76

- Для чего: остановить архитектурный развал раундов из-за удаления `jobState.llms` при SPA-переходах. Изменение: `SPA_NAVIGATION` больше не вызывает `cleanupTabResources`; вместо этого помечается readiness как stale, сохраняется `lastSpaNavigationAt/lastKnownUrl`, добавлена телеметрия `SPA_NAVIGATION`. Файл: `background/message-router.js`.
- Для чего: сохранить целостность состояния моделей в активной сессии при cleanup событий вкладок. Изменение: `cleanupTabResources` теперь не удаляет запись модели для моделей текущего run (`session.selectedModels`); вместо этого сбрасывает только tab/dispatch runtime поля. Файл: `background/cleanup-manager.js`.
- Для чего: прекратить преждевременный переход на главную страницу расширения до фактического завершения моделей. Изменение: добавлен `Round4 gate` — ожидание non-terminal моделей, принудительная финализация `NO_SEND` для неподтверждённых dispatch после grace-периода, bounded timeout с детерминированным завершением оставшихся моделей перед `ROUND4` focus. Файл: `background/job-orchestrator.js`.
- Для чего: убрать разнородные и неполные recovery-записи моделей, ломающие последующие раунды. Изменение: введён единый фабричный конструктор `buildInitialLlmEntry`, использован в `startProcess`, `ensureRoundEntries` и post-round recovery. Файл: `background/job-orchestrator.js`.
- Для чего: уменьшить ложные возвраты фокуса на results в процессе активных раундов. Изменение: human-presence больше не фокусирует results при `roundsInProgress=true`, а pending вычисляется по `session.selectedModels` (включая пропавшие entry как pending). Файл: `background/human-presence.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.76. Файл: `manifest.json`.

### 2026-02-15 23:31 — v2.72.75

- Для чего: убрать ложные таймауты `script_runtime_hard_stop_180000ms`, которые считались до фактического подтверждения отправки. Изменение: hard-stop guard теперь армится от подтверждённого `PROMPT_SUBMITTED` (и при accepted submit в message-router), а не от первого спекулятивного `GET_ANSWER`. Файлы: `background/dispatch-coordinator.js`, `background/message-router.js`.
- Для чего: убрать дубли событий `SCRIPT_RUNTIME_HARD_STOP` в Telemetry Timeline/All Logs. Изменение: удалён второй канал записи hard-stop (`appendLogEntry`/доп. pipeline запись), событие фиксируется единообразно через telemetry emit. Файл: `background/dispatch-coordinator.js`.
- Для чего: защитить финальный статус от деградации гонками после уже полученного ответа. Изменение: добавлен terminal guard в `handleLLMResponse` — если модель уже зафиксирована в success-terminal, входящий failure игнорируется с диагностикой `Response ignored (terminal success locked)`. Файл: `background/job-orchestrator.js`.
- Для чего: снизить шум после завершённых моделей. Изменение: `manual_ping` теперь делает ранний skip для terminal статусов и не отправляет лишний `getResponses` в контент. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.75. Файл: `manifest.json`.

### 2026-02-15 21:51 — v2.72.74

- Для чего: ввести жёсткий предел работы скриптов, чтобы убрать бесконечные циклы активности и зависания фокуса на проблемной вкладке. Изменение: добавлен per-model hard-stop guard `SCRIPT_RUNTIME_HARD_STOP_MS = 180000` (3 минуты). При срабатывании отправляются `HUMANOID_FORCE_STOP` и `STOP_AND_CLEANUP`, пишется телеметрия `SCRIPT_RUNTIME_HARD_STOP`, модель финализируется как `script_runtime_hard_stop`. Файл: `background/dispatch-coordinator.js`.
- Для чего: гарантированно очищать guard-таймеры и не накапливать ложные срабатывания. Изменение: таймер стартует только на первом `GET_ANSWER` попытки, очищается при `MODEL_FINAL` и полностью сбрасывается при `stopAllProcesses`. Файлы: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.74. Файл: `manifest.json`.

### 2026-02-15 10:20 — v2.72.73

- Для чего: сократить “зависание в жёлтом” у Claude/Grok, когда ответ уже виден в DOM, но не доходит до финализации. Изменение: ping `getResponses` теперь несёт session/dispatch scope (`runSessionId/sessionId/dispatchId`) и флаг `forceEmitOnUnchanged`, чтобы сбор оставался в рамках активного запуска и мог публиковать стабильный ответ даже при равенстве с кэшем. Файл: `background/job-orchestrator.js`.
- Для чего: убрать провал ping-сбора у Claude. Изменение: в `content-claude` добавлен обработчик `action: getResponses` (smart-scroll + non-destructive DOM extraction + проверка стабилизации/признака завершения), который отправляет `LLM_RESPONSE` и `MANUAL_PING_RESULT` вместо “тихого” закрытия канала. Файл: `content-scripts/content-claude.js`.
- Для чего: убрать ложный `unchanged` без финализации у Grok/Qwen. Изменение: при `forceEmitOnUnchanged` и непустом ответе скрипты переотправляют `LLM_RESPONSE` (`Answer re-emitted after ping`), что закрывает жёлтый статус без ручного вмешательства. Файлы: `content-scripts/content-grok.js`, `content-scripts/content-qwen.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.73. Файл: `manifest.json`.

### 2026-02-15 09:16 — v2.72.72

- Для чего: уменьшить зависание в жёлтом статусе, когда ответ уже есть, но система не фиксирует завершение без ручного скролла. Изменение: добавлен обязательный pre-collect нудж `up-half -> down-bottom` перед сбором ответа (`runPreCollectScrollNudge`) с телеметрией `PRECOLLECT_NUDGE*`. Файл: `background/job-orchestrator.js`.
- Для чего: применить рабочий паттерн скролла в критичных точках раундов. Изменение: нудж выполняется перед `round2_probe`, `round3_collect` и в `manual_ping` (для non-terminal моделей), затем отправляется `getResponses`. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.72. Файл: `manifest.json`.

### 2026-02-15 09:06 — v2.72.71

- Для чего: устранить зависание прогонов на `Round2`, когда верификация идёт слишком долго и `Round3/Round4` не стартуют. Изменение: добавлен жёсткий batch-budget `ROUND2_BATCH_MAX_MS=45000`; при превышении оставшиеся модели автоматически получают `ROUND2_SKIP (batch_timeout)` и прогон переходит дальше без ручного вмешательства. Файл: `background/job-orchestrator.js`.
- Для чего: сделать причину принудительного перехода прозрачной в телеметрии. Изменение: добавлено событие `ROUND2_CUTOFF` с деталями elapsed/budget/pending models. Файл: `background/job-orchestrator.js`.
- Для чего: снизить ложные `MODEL_MISSING` после ручных визитов и attach-событий. Изменение: post-round проверка теперь валидирует активную сессию и сначала выполняет `ensureRoundEntries(..., post_round_integrity_check)`, затем считает реально отсутствующие модели. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.71. Файл: `manifest.json`.

### 2026-02-15 00:14 — v2.72.70

- Для чего: устранить ложный `Run session: n/a (cycle fallback)` при наличии валидного dispatch id. Изменение: в run-scope фильтре убрана ошибка приведения `null -> 0`; теперь run id корректно вычисляется из телеметрии, если параметр run явно не задан. Файл: `results.js`.
- Для чего: синхронизировать DevTools со scoping-логикой экспорта. Изменение: тот же guard исправлен в `filterEventsToCurrentRun`, чтобы timeline/rounds/export работали по реальному active run. Файл: `results-devtools.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.70. Файл: `manifest.json`.

### 2026-02-14 23:55 — v2.72.69

- Для чего: убрать предзапусковой шум в `All Logs`, когда запрос ещё не отправлялся. Изменение: при отсутствии активного run (`runSessionId` и `ROUND0_START`) экспорт теперь возвращает пустые Telemetry/Diagnostics секции вместо `unscoped` событий (`SCRIPT_LOADED`). Файл: `results.js`.
- Для чего: сохранить полезный fallback для старых событий без session id, но не смешивать с чужими сессиями. Изменение: fallback-скоуп строится только от последнего `ROUND0_START`, а diagnostics режутся тем же временным окном. Файл: `results.js`.
- Для чего: исключить утечки полного кэша в DevTools-экспорт/копирование. Изменение: Telemetry bridge, `Export JSON` и `Copy` используют только scoped events и больше не откатываются к full cache при пустом scoped списке. Файл: `results-devtools.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.69. Файл: `manifest.json`.

### 2026-02-14 23:30 — v2.72.68

- Для чего: убрать смешивание «старых» и «текущих» событий в `All Logs`. Изменение: markdown-экспорт теперь фильтрует телеметрию по актуальному `runSessionId` и последнему циклу `ROUND0_START`, затем тем же скоупом режет diagnostics-блок. Файл: `results.js`.
- Для чего: исправить ложные `running` в матрице раундов после фактического завершения модели. Изменение: `ROUND*_COMPLETE` нормализуется как завершение раунда, а при наличии `R4 END` незакрытые `R0..R3` закрываются как `inferred`. Файлы: `results.js`, `results-devtools.js`.
- Для чего: показывать Telemetry в DevTools только по текущему запуску. Изменение: добавлен current-run scope для таймлайна/матрицы/экспорта JSON через `filterEventsToCurrentRun`. Файл: `results-devtools.js`.
- Для чего: снизить ложные красные ошибки после ручного ping по уже завершённой модели. Изменение: `manual_ping` при terminal status логируется как warning `Manual ping skipped (terminal)` вместо `COMMAND_SEND_ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.68. Файл: `manifest.json`.

### 2026-02-14 19:07 — v2.72.67

- Для чего: остановить цикл перезагрузок вкладки Claude при автоматических опросах `getResponses`. Изменение: в `sendPassiveMessageWithRetries` recovery через `reinject/reload` теперь выключен по умолчанию и включается только явным флагом `allowRecovery`. Файл: `background/dispatch-coordinator.js`.
- Для чего: сохранить ручной сценарий восстановления по кнопке. Изменение: для `manual_ping` recovery явно включён (`allowRecovery: true`), чтобы ручной пинг по-прежнему мог чинить «битый» канал связи. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.67. Файл: `manifest.json`.

### 2026-02-14 18:52 — v2.72.66

- Для чего: убрать баг повторной вставки prompt в Claude при ретраях, когда отправка не подтверждена. Изменение: dedupe подготовленного prompt теперь привязан к fingerprint самого prompt (а не к session-scoped fingerprint), поэтому повторный dispatch не запускает лишнюю вставку текста. Файл: `content-scripts/content-claude.js`.
- Для чего: не перетирать composer повторным paste/typing, если prompt уже подготовлен. Изменение: при обнаружении ожидаемого prompt-head в composer Claude пропускает блок ввода и сразу идёт в отправку/подтверждение. Файл: `content-scripts/content-claude.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.66. Файл: `manifest.json`.

### 2026-02-13 14:14 — v2.72.65

- Для чего: не запускать Round1 до фактической готовности вкладки модели. Изменение: после `startModelForLLM(...deferDispatch)` Round0 дожидается валидной bind-привязки таба (`waitForRound0Binding`) с таймаутом и диагностикой `ROUND0_BIND_WAIT_TIMEOUT`. Файл: `background/job-orchestrator.js`.
- Для чего: убрать “невидимый” пропуск модели в первом раунде. Изменение: перед Round1 добавлен `ensureRoundEntries(..., 'pre_round1')`, а при локальном пропуске entry выполняется repair `round1_missing_entry`. Файл: `background/job-orchestrator.js`.
- Для чего: автоматически лечить кейс `ROUND2 not_confirmed` для проблемных моделей без ручного вмешательства. Изменение: для `Claude/Gemini` в Round2 добавлен `repair dispatch` (`ROUND2_REPAIR_DISPATCH_*`) с reset dispatch-machine и повторной отправкой через `dispatchPromptToTab(..., 'round2_repair')`. Файл: `background/job-orchestrator.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.65. Файл: `manifest.json`.

### 2026-02-13 14:03 — v2.72.64

- Для чего: убрать нежелательное изменение размера окна при переключении вкладок моделей. Изменение: `activateTabForDispatch` больше не форсирует `state: 'normal'`, оставляя только `focused: true` и `active: true`. Файл: `background/tab-manager.js`.
- Для чего: не терять модель в Round1 без явной причины и без попытки восстановления. Изменение: Round1 теперь всегда эмитит `START/END`, делает retry резолва вкладки при `tab_not_ready` и пишет `ROUND1_SKIP` с причиной. Файл: `background/job-orchestrator.js`.
- Для чего: снизить churn message-channel на раннем диспатче. Изменение: pre-dispatch `HEALTH_CHECK_PING` больше не вызывает агрессивный reload в Round1/ранних попытках; reload ограничен веткой `retry_supervisor` после нескольких попыток. Файл: `background/dispatch-coordinator.js`.
- Для чего: исключить ложное подтверждение отправки в Gemini. Изменение: `PROMPT_SUBMITTED` отправляется только при подтверждённой отправке, иначе бросается `send_failed`. Файл: `content-scripts/content-gemini.js`.
- Для чего: убрать цикл «очистка/повторная вставка» в GPT при повторных GET_ANSWER. Изменение: добавлен dedupe-path повторного диспатча с переиспользованием уже подготовленного текста в composer. Файл: `content-scripts/content-chatgpt.js`.
- Для чего: зафиксировать выпуск. Изменение: версия расширения обновлена до 2.72.64. Файл: `manifest.json`.

### Release Notes — 2.48–2.53 (после 2.47)

- Dispatch без дублей: `PROMPT_SUBMITTED` больше не триггерит повторную отправку `GET_ANSWER`, а `messageSent` ставится сразу после успешной доставки команды (меньше “спама” по вкладкам и ошибок вида “Another request is already being processed”).
- Очередь dispatch: ожидание подтверждения отправки вынесено за пределы mutex, чтобы зависшая/медленная вкладка не блокировала остальные модели.
- UX без focus‑steal: флаг `allow_focus_steal_enabled` (по умолчанию выключен) + отдельное automation‑окно для LLM‑вкладок при отключённом focus‑steal.
- Извлечение ответов: обновлены платформенные селекторы + UnifiedAnswerPipeline, добавлены DOM‑fallback’и (берём последний ответ), hardMax streaming timeout снижен до 180s.
- Claude: извлечение ответа стало стабильнее (ожидание элементов через SelectorFinder, защита от “ответов‑лейблов” вроде `Sonnet 4.5`).
- Results UI/IPC: в results уходит `normalizedAnswer`, добавлен ACK на входящие сообщения (фон не теряет `resultsTabId`), убраны CSP/JS ошибки в `result_new.html`/`results.js`.
- Совместимость доменов: расширены `host_permissions`/`matches` для Gemini (`bard.google.com`), Perplexity (`www.perplexity.ai`) и Grok (`grok.x.ai`, `x.ai`).
- Диагностика: явные ошибки при проблемах `chrome.tabs.create` и более аккуратная обработка ошибок запуска в results.

### 2025-12-18 00:30

- Results CSP: удалён inline singleton‑guard из `result_new.html` (CSP блокировал inline scripts и засорял консоль).
- Results ↔ background IPC: results‑страница теперь отправляет ACK на входящие сообщения, чтобы фон не получал `The message port closed before a response was received.` и не сбрасывал `resultsTabId`. Файлы: `results.js`, `background.js`.
- Results UI: убран вызов несуществующей `updateProSectionVisibility()` (падал на double‑click по модели). Файл: `results.js`.

### 2025-12-18 00:14

- Dispatch: ожидание `PROMPT_SUBMITTED` вынесено за пределы mutex (очередь держится только на “активация вкладки → доставка `GET_ANSWER`”), чтобы зависшая/залоченная вкладка не стопорила отправку в другие модели. Файл: `background.js`. Док: `docs/tabs-and-selectors.md`.
- Popup back-compat: добавлен обработчик `{action:'sendPrompt'}` (старый UI) с маппингом LLM ids и запуском процесса через results tab. Файл: `background.js`.

### 2025-12-18 00:00

- Results UI: кнопка запуска (`#start-button`) теперь обрабатывает `chrome.runtime.lastError`, корректно возвращает `Get it` из disabled при ранних выходах и показывает уведомление при неудачном старте. Файл: `results.js`.
- Playwright perf harness: переход на `locator()` + селекторы с `:visible` и per‑URL overrides (в т.ч. исключение reCAPTCHA textarea) — меньше зависаний на скрытых элементах и ошибок re-render. Файл: `tests/perf-multi-tab.js`. Док: `docs/perf-tests.md`.

### 2025-12-17 22:03

- Dispatch stability/perf: возврат сериализации dispatch (одна отправка за раз) и ожидания `PROMPT_SUBMITTED` без гонки, чтобы не запускать тяжёлые контент‑пайплайны параллельно и не терять подтверждения. Файл: `background.js`.
- Automation window: при `allow_focus_steal_enabled=false` LLM вкладки открываются в отдельном окне (не фокусируется), и фон может активировать вкладки внутри него без переключения пользователя; human presence разрешён в фоне для этого окна. Файл: `background.js`. Док: `docs/tabs-and-selectors.md`.

### 2025-12-17 14:51

- Anti focus-steal: добавлен флаг `allow_focus_steal_enabled` (по умолчанию false) — фон больше не активирует вкладки/окна во время dispatch/human presence и не фокусирует results автоматически, что убирает “возврат” пользователя на вкладки LLM/Results при переключениях. Файл: `background.js`. Док: `docs/tabs-and-selectors.md`.

### 2025-12-16 12:40

- Answer pipeline selectors обновлены: добавлены точные контейнеры/lastMessage/generating/completion индикаторы для Perplexity, Qwen, Grok; ChatGPT selectors дополнены актуальными `conversation-turn`; generic-заглушки заменены на платформенные профили. Файл: `content-scripts/answer-pipeline-selectors.js`.
- Pipeline fallbacks: если UnifiedAnswerPipeline не вернул ответ, контент‑скрипты GPT/Gemini/Perplexity вытаскивают последний ассистентский ответ из DOM и отправляют его, чтобы журнал не пустовал. Файлы: `content-scripts/content-chatgpt.js`, `content-scripts/content-gemini.js`, `content-scripts/content-perplexity.js`.
- Streaming таймаут: hardMax для adaptive timeout уменьшен до 180 000 мс, чтобы не ждать 5 минут при зависшем watcher. Файл: `content-scripts/pipeline-config.js`.
- DOM fallback helpers: определены `grabLatestAssistantMarkup` в GPT/Gemini/Perplexity (с платформенными селекторами и fallback списком), чтобы фолбэк не падал на отсутствующей функции и всегда мог извлечь текст из DOM. Время: 2025-12-16 13:20. Файлы: `content-scripts/content-chatgpt.js`, `content-scripts/content-gemini.js`, `content-scripts/content-perplexity.js`.
- Perplexity селекторы уточнены: добавлены `answer-card`, `chat-message` с `.prose`, layout-wrapper, stop/send data-testid; фолбэк ищет ответ в этих узлах. Время: 2025-12-16 13:50. Файлы: `content-scripts/answer-pipeline-selectors.js`, `content-scripts/content-perplexity.js`.

### 2025-12-12 10:15

- Prompt broadcast: `LLM_URL_PATTERNS` теперь строится из `LLM_TARGETS.queryPatterns` (с fallback), добавлен `chatgpt.com`, чтобы промпты доставлялись во все актуальные вкладки. Файл: `background.js`.
- Startup latency: убрана фиксированная пауза `delay/SEND_PROMPT_DELAY_MS` перед отправкой `GET_ANSWER`; вместо неё фон ждёт готовности контент‑скрипта через `HEALTH_CHECK_PING` и шлёт промпт сразу. Исправлен mismatch `HEALTH_PING` → `HEALTH_CHECK_PING`, из‑за которого раньше происходили лишние реинъекции/перезагрузки. Файл: `background.js`.
- Speed mode: `ContentUtils.sleep` теперь масштабирует задержки в режиме `settings.speedMode`, а платформенные скрипты (Claude/DeepSeek/Qwen/Grok/LeChat) используют этот sleep, что ускоряет стабилизацию UI без потери совместимости. Файлы: `content-scripts/content-utils.js`, `content-scripts/content-*.js`.
- Perf harness: `tests/perf-multi-tab.js` расширен CLI‑флагами (`--headless`, `--keepOpen`, `--urls`, `--prompt`) и включает `chatgpt.com` в дефолтный набор. Файл: `tests/perf-multi-tab.js`.

### 2025-12-12 11:05

- Focus thrash fix: `UnifiedAnswerPipeline.activateTab` теперь отключаемый (`preparation.allowTabActivation=false`), чтобы пайплайн не “воровал” фокус в фоне. Файлы: `content-scripts/pipeline-config.js`, `content-scripts/unified-answer-pipeline.js`.
- Prompt dispatch coordinator: фон отправляет промпты в LLM вкладки через сериализованный диспетчер, с ожиданием `PROMPT_SUBMITTED` ≤7с и возвратом фокуса на results, чтобы цикл не “залипал” на одной вкладке. Файл: `background.js`.
- Prompt submitted signal: контент‑скрипты шлют `PROMPT_SUBMITTED` сразу после клика Send/Enter, чтобы фон мог корректно зафиксировать отправку и продолжить очередь. Файлы: `content-scripts/content-*.js`.
- Dispatch timeouts: для Grok/Qwen/DeepSeek увеличен таймаут подтверждения `PROMPT_SUBMITTED` до 15с (для медленного UI), без изменения общего лимита для остальных. Файл: `background.js`.

### 2025-12-12 12:05

- Dispatch reliability: `dispatchInFlight` сбрасывается в `finally`, чтобы очередь не зависала при исключениях; добавлен supervisor‑цикл повторной отправки промпта (backoff + лимит попыток). Файл: `background.js`.
- Dispatch timeouts: overrides `PROMPT_SUBMITTED` для Grok/Qwen/DeepSeek снижены до 9с (дефолт остаётся 7с). Файл: `background.js`.
- DeepSeek injection: убраны Grok‑селекторы, добавлен `SelectorFinder` для composer/send и фильтрация `g-recaptcha-response`. Файл: `content-scripts/content-deepseek.js`.
- Qwen injection: ввод промпта “instant” (без долгого human‑typing), sendButton резолвится через `SelectorFinder`. Файл: `content-scripts/content-qwen.js`.
- Grok send: мягкое подтверждение отправки (больше не падаем на медленный старт ответа), `PROMPT_SUBMITTED` включает `meta.confirmed`. Файл: `content-scripts/content-grok.js`.
- Claude/Perplexity: main‑world bridge теперь грузится через `script.src` (`content-scripts/content-bridge.js`), чтобы не ловить CSP “unsafe-inline”; Perplexity больше не делает двойную вставку (main-world + humanoid typing). Файлы: `content-scripts/content-claude.js`, `content-scripts/content-perplexity.js`.
- Claude: `ContentCleaner.clean` теперь устойчив к non-string ответам (object/structured payload) — исправлен `out.replace is not a function`. Файл: `content-scripts/content-claude.js`.
- Claude: убран агрессивный Enter‑fallback после клика Send (он мог отправлять дважды); теперь Enter используется только если отправка не подтверждена. Файл: `content-scripts/content-claude.js`.
- GPT: отправка теперь подтверждается (stop button / новый user message / очистка composer), при необходимости используется Enter‑fallback; убраны опасные “любой enabled button рядом” селекторы. Файл: `content-scripts/content-chatgpt.js`.
- GPT: ускорена вставка (native setValue + события) и добавлено ожидание “send enabled” (poll ≤2.5s); увеличен timeout ожидания `PROMPT_SUBMITTED` до 12s, чтобы вкладка не теряла фокус до реального клика Send. Файлы: `content-scripts/content-chatgpt.js`, `background.js`.
- Claude: ввод в ProseMirror теперь через `execCommand('insertText')` (без `textContent += ...`), чтобы не получать удвоение текста. Файл: `content-scripts/content-claude.js`.

### 2025-12-11 14:30

- UnifiedAnswerPipeline: исправлен синтаксис `TabProtector` (без optional chaining после `new`), чтобы скрипты не падали парсингом на всех платформах. Файл: `content-scripts/unified-answer-pipeline.js`.
- Fetch monitor CSP-safe: вынес хук `fetch` в отдельный `fetch-monitor-bridge.js` и подключаю через src (без inline), чтобы не блокировало CSP. Файлы: `content-scripts/fetch-monitor.js`, `content-scripts/fetch-monitor-bridge.js`, `manifest.json`.
- Lazy toolkit: добавлены `scroll-toolkit.js` и `humanoid.js` в `web_accessible_resources`, чтобы ленивая подгрузка не ломалась ERR_FAILED. Файл: `manifest.json`.

### 2025-12-11 13:20

- Results tab singleton: action click now reuses/фокусирует уже открытую `result_new.html` (поиск по URL + актуализация `resultsTabId`), чтобы не плодить копии DevTools. Файл: `background.js`.
- Tab lifecycle: onRemoved больше не зовёт стоп всего пайплайна при закрытии одной LLM-вкладки; чистятся pending health-check PING-и, stopAll триггерится только для results/evaluator или когда LLM вкладок не осталось. Файл: `background.js`.
- Health-check cleanup: убран мёртвый таймер healthCheck, heartbeat останавливается при отсутствии LLM вкладок, pending pings чистятся при suspend SW. Файл: `background.js`.
- Надёжность отправки: `sendMessageSafely` переподключается к актуальному tabId из `TabMapManager` перед повторной отправкой, чтобы не шлать команды в устаревшие вкладки. Файл: `background.js`.
- Streaming watchdog: очистка guard-interval при любых исходах race в `runStreamingPhase`, без утечек setInterval. Файл: `content-scripts/unified-answer-pipeline.js`.
- Kill-switch scroll: вместо monkey-patch прототипов — AbortController-блокировка wheel/scroll/touch/key с откатом overflow, чтобы не ломать SPA после HARD_STOP. Файл: `content-scripts/pipeline-modules.js`.
- Main-world bridge: `content-bridge.js` добавлен в `web_accessible_resources`, чтобы инъекция из bootstrap не блокировалась. Файл: `manifest.json`.
- SmartScroll bootstrap: исправлены синтаксис/координаторы `withSmartScroll` в платформенных скриптах (Claude/DeepSeek/Qwen/Grok/LeChat), чтобы не падали Optional chaining/parse ошибки и SmartScroll работал через ContentUtils. Файлы: `content-scripts/content-*.js`.
- Pragmatist runner: fallback селекторы ответа теперь платформенные (ChatGPT/Claude/Gemini/Perplexity/Grok/DeepSeek/Qwen/LeChat) вместо чатгпт-списка по умолчанию. Файл: `content-scripts/pragmatist-runner.js`.
- Answer pipeline selectors: добавлен `answer-pipeline-selectors.js` (detectPlatform + PLATFORM_SELECTORS) и подключён перед watcher/pipeline, чтобы UnifiedAnswerPipeline работал без Warning. Файлы: `content-scripts/answer-pipeline-selectors.js`, `manifest.json`.
- Emergency fallbacks composer уточнены (фильтруем по placeholder/aria-label/message) вместо голых `textarea`/`contenteditable`, чтобы не цепляться к полям поиска/фидбека. Файл: `selectors/config-bundle.js`.
- Selector cache: versioned ключи с очисткой стейла в `findAndCacheElement`, чтобы не держать устаревшие селекторы после смены UI. Файл: `content-scripts/content-utils.js`.

### 2025-12-11 13:00

- Tab lifecycle: при закрытии любых вкладок, включая results, больше не инициируется автоматическое закрытие LLM-вкладок (onRemoved теперь всегда cleanup без closeTabs), чтобы не терять сессии сразу после открытия. Файл: `background.js`.
- Selector configs (#28): собран единый бандл `selectors/config-bundle.js` из всех платформенных конфигов и подключён одним файлом в manifest (персональные `selectors/*.config.js` больше не инжектятся в content scripts). Добавлен вспомогательный `config-bundle.json` как источник данных. Файлы: `selectors/config-bundle.js`, `manifest.json`, `selectors/config-bundle.json`.
- Results modularization (#26): вынесены общие хелперы копирования/HTML в `results-shared.js`, DevTools/Diagnostics перенесены в отдельный `results-devtools.js`; `result_new.html` теперь грузит оба модуля перед основной логикой. Файлы: `results.js`, `results-shared.js`, `results-devtools.js`, `result_new.html`.
- Тесты: `npm test -- --runInBand` — OK.

### 2025-12-11 00:12

- Manifest: подключены pipeline файлы (`pipeline-config.js`, `pipeline-modules.js`, `unified-answer-watcher.js`, `unified-answer-pipeline.js`) во все блоки content scripts, чтобы UnifiedAnswerPipeline реально загружался (убрали мёртвый код/пустые ссылки). Файл: `manifest.json`.
- TODO (из списка избыточностей): вынести общие утилиты `sleep`/`findAndCacheElement`/`isElementInteractable`/`withSmartScroll` в единый модуль и подключить; оптимизировать остальные пункты (#20–#23).

### 2025-12-11 00:25

- Общие утилиты: добавлен модуль `content-scripts/content-utils.js` (sleep, findAndCacheElement, isElementInteractable, withSmartScroll) и подключён во все content scripts через manifest. Платформенные скрипты переподключены к общим утилитам (wrapper поверх существующих реализаций). Файлы: `content-scripts/content-utils.js`, `manifest.json`, `content-scripts/content-*.js`.
- Тесты: `npm test -- --runInBand` — OK.

### 2025-12-11 00:47

- Fetch monitor: общий `content-scripts/fetch-monitor.js` теперь подключён во все content scripts через manifest, чтобы не держать отдельные копии хендлеров rate-limit. Файл: `manifest.json`.

### 2025-12-11 08:23

- Manifest deduplication: общий блок content scripts для всех платформ (bootstrap, utils, fetch-monitor, pipeline, selector stack, scroll-toolkit, humanoid); платформенные блоки теперь содержат только свой конфиг и контент-скрипт. Файл: `manifest.json`.

### 2025-12-11 08:31

- Health-check не закрывает вкладки: таймаут PONG больше не вызывает stopAll с `closeTabs: true`, чтобы вкладки не закрывались при поздней загрузке контент-скриптов. Файл: `background.js`.

### 2025-12-11 08:47

- Lazy scroll/humanoid: `scroll-toolkit.js` и `humanoid.js` убраны из manifest; добавлен ленивый загрузчик в `content-scripts/content-utils.js` (ensureScrollToolkit/ensureHumanoid + loadScriptOnce). `withSmartScroll` теперь загружает toolkit перед запуском. Файлы: `manifest.json`, `content-scripts/content-utils.js`.
- Тесты: `npm test -- --runInBand` — OK.

### 2025-12-11 08:50

- Shared MutationObserver: в `content-utils` добавлен реестр observeMutations; `UnifiedAnswerCompletionWatcher` теперь использует общий observer, уменьшая число MutationObserver на вкладке. Файлы: `content-scripts/content-utils.js`, `content-scripts/unified-answer-watcher.js`.

### 2025-12-11 09:05

- MutationObserver consolidation (частично): ожидание ответов в DeepSeek/Qwen/Grok/LeChat/Claude, Perplexity stabilization и stream-watcher используют общий observeMutations из `content-utils`. Уменьшено число отдельных MutationObserver на вкладках. Файлы: `content-scripts/content-utils.js`, `content-scripts/content-*.js`, `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`, `content-scripts/pragmatist-core.js`.

### 2025-12-11 09:20

- MutationObserver consolidation (полностью): убраны локальные `new MutationObserver` из контент-скриптов, остаётся единый реестр в `content-utils` (единственное место создания). Файлы обновлены: `content-scripts/content-*.js`, `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`, `content-scripts/pragmatist-core.js`.
- Config dedupe: все платформенные selector-config файлы теперь подключаются один раз в общем блоке manifest (без дублирования по платформам). Файл: `manifest.json`.
- Тесты: `npm test -- --runInBand` — OK.

### 2025-12-10 23:55

- Completion единым детектором: убран внутренний completion-таймер StateManager, удалены legacy `waitForResponse` в контент-скриптах (ChatGPT/Gemini/Perplexity), поток завершается только через UnifiedAnswerCompletionWatcher → `LLM_RESPONSE` push. Таймауты теперь трактуются как ошибка (нет “успеха” с обрезанным текстом). Файлы: `content-scripts/pragmatist-core.js`, `content-scripts/content-*.js`.
- Ужесточён watcher: приоритет Regenerate/Stop над fuzzy-критериями; завершение блокируется при видимом Stop; явный успех при Regenerate/completion indicator. Порог `minMetCriteria` повышен до 4, контейнер ответа ищется адресно (без наблюдения всего body), detectRegenerate добавлен. Файл: `content-scripts/unified-answer-watcher.js`.
- Таймауты для reasoning: увеличены idle-пороги (mutationIdle 15s, contentStable 8s), checkInterval 1s, адаптивные таймауты/softExtension/hardMax подняты до 240s для длинных размышлений. Файл: `content-scripts/pipeline-config.js`.

### 2025-12-10 23:50

- Phase 5 (#1 уточнение): onRemoved теперь помечает незавершённую генерацию как ошибку, если вкладка закрылась до ответа, и сбрасывает tabId/messageSent для модели. Помогает не терять статус при раннем закрытии. Файл: `background.js`.

### 2025-12-10 23:33

- Phase 5 (#14): консолидация структур вкладок — убраны прямые обращения к `llmTabMap`, все операции проходят через `TabMapManager` (health-check, heartbeat, human loop, stopAll/closeAll, selector health-check, manual ping/resend). Снимок global state теперь строится из менеджера, единый источник истины для записи в storage. Файл: `background.js`.

### 2025-12-10 22:52

- Phase 5 (#12): StateManager перешёл на единое `chrome.storage.session` (фолбэк на `chrome.storage.local` только для тестов/старых окружений), убран отдельный таймер localStorage; сохранение/restore состояния теперь не размазывается по двум стораджам. Файл: `content-scripts/pragmatist-core.js`.
- Phase 5 (#13): Инлайновый scroll-toolkit в `scrollTabToBottom` удалён; background использует общий ScrollToolkit, а при его отсутствии — простой `scrollTo` по документу. Основная логика скролла остаётся в `scroll-toolkit.js`. Файл: `background.js`.

### 2025-12-10 15:25

- Phase 3 (#2): добавлен `TabMapManager` с примитивом mutex для сериализации операций над картой вкладок (установка/удаление/очистка + сохранение в storage без гонок). Мутации карты теперь через менеджер, а загрузка/сохранение не разрывают ссылку на объект. Файл: `background.js`.
- Phase 3 (#16): единый stop теперь использует `TabMapManager` (очистка карт/таймеров без reassignment), cleanup onRemoved/stopAll/clear sessions проходит через менеджер и рассылает STOP_AND_CLEANUP. Файл: `background.js`.
- Phase 3 (#17): реализован `GLOBAL_STATE_BROADCAST` (снапшот llms/tabs/results, ts) для всех LLM вкладок и results; триггерится при обновлении статуса/создании или удалении вкладок, а также при полном stop. Файл: `background.js`.

### 2025-12-10 16:05

- Phase 4 (#3): единый keepalive — health-check теперь встроен в heartbeat интервал (один таймер вместо нескольких), без отдельных циклов. Файл: `background.js`.
- Phase 4 (#4): rate-limit очередь — введено состояние rateLimit с отложенным перезапуском моделей; ошибки rate_limit фиксируют дедлайн, после которого запуск перепробуется автоматически. Файл: `background.js`.
- Phase 4 (#7): web circuit breaker — существующий брейкер теперь защищает и tab-поток: открытые цепи блокируют запуск, восстанавливаются с HALF_OPEN после кулдауна. Файл: `background.js`.
- Phase 4 (#10): promise chain для tabs — старт каждой модели сериализован per-LLM (llmStartChains), чтобы исключить гонки при создании/переподключении вкладок. Файл: `background.js`.

### 2025-12-10 16:30

- Phase 5 (#15, cleanup intervals): rate-limit таймеры и цепочки запусков очищаются в stopAllProcesses; health-check и heartbeat объединены в один интервал (меньше параллельных таймеров). Файл: `background.js`.

### 2025-12-10 14:45

- Phase 2 (#1/#6/#8): добавлен централизованный `stopAllProcesses(reason, { closeTabs })`, очищающий все таймеры/пинги/активные слушатели, сбрасывающий `jobState`/`llmTabMap` и мягко закрывающий LLM/evaluator вкладки по запросу. Вызовы: закрытие results tab, отсутствие LLM вкладок, UNRESPONSIVE health-check, кнопка Stop All.
- Полный cleanup onRemoved: `chrome.tabs.onRemoved` теперь всегда триггерит stopAllProcesses (с закрытием вкладок при закрытии results), снимает ping state и чистит карты активности; гарантированно обрабатывается опустевший список LLM вкладок.
- UNRESPONSIVE → Stop: health-check тайм-аут переводит модель в UNRESPONSIVE и сразу вызывает stopAllProcesses с закрытием вкладок для безопасного восстановления.
- Human loop graceful shutdown: команда STOP_ALL использует stopAllProcesses для остановки human-loop/heartbeat/health-check без принудительного закрытия UI.
- Флаг автофокуса: добавлен storage-флаг `autofocus_llm_tabs_enabled` (по умолчанию false). При true новые LLM вкладки создаются с фокусом; текущий дефолт оставляет их в фоне.

### 2025-12-09

- Keepalive cleanup: убран `pingWindowByTabId` и отдельные окна AUTO/MANUAL, анти-sleep пинги всегда активны для живых вкладок (меньше дублей keepalive). Файл: `background.js`.
- Команды: `SUBMIT_PROMPT` пишет pending в `chrome.storage.session` с ключом `pending_command_<id>` (плюс alias `pending_command`); `COMMAND_ACK` удаляет оба ключа; `GET_COMMAND_STATUS` читает session+local и возвращает самый свежий pending/ack. Файлы: `background.js`, `content-scripts/pragmatist-core.js`.
- States: `GET_ALL_STATES` принимает `runId/sessionId` и фильтрует выдачу, чтобы UI не подмешивал старые прогоны. Файл: `background.js`.
- Kill-switch защита: реагируем только на payload `{ source: 'background' }`, игнорируем произвольные записи в `chrome.storage.local`. Файлы: `content-scripts/content-bootstrap.js`, `content-scripts/pragmatist-runner.js`.
- Anti-hijack вкладок: массовые `chrome.tabs.query` по LLM-паттернам теперь с `audible:false`, чтобы не подхватывать медиавкладки (лента X и др.). Файл: `background.js`.
- Main-world bridge: единый инъектор встраивается на всех платформах из `content-bootstrap.js` и слушает `EXT_ATTACH/EXT_SET_TEXT` (и alias `EXT_MAIN_*`), выполняя drop/click+input/paste в main world с native setter для текста. Файл: `content-scripts/content-bootstrap.js`.
- Вложения: введён суммарный лимит ~25MB (5×5MB) при сборке payload, ранний отказ при превышении. Файл: `results.js`.
- Main-world ожидание без setTimeout: мост ждёт появления инпута/цели через MutationObserver+requestAnimationFrame, без задержек в content-script. Файл: `content-scripts/content-bootstrap.js`.
- Стратегии по платформам: в `selectors-override.json` зафиксированы стратегия вложений (drop/click/unsupported) и приоритеты селекторов для Perplexity, Gemini, Le Chat, Claude, ChatGPT, Grok, Qwen, DeepSeek (учёт shadow DOM/drop-зон). Файл: `selectors-override.json`.
- Большие вложения: задокументировано, что для файлов >25MB требуется переход на Blob URL/потоковую передачу (код не менялся, лимит enforced в UI). Файл: `docs/change-log-codex.md`.
- Pending/ACK per platform: pending команды сохраняются per-platform (`pending_command_<platform>`), ACK удаляет только свой ключ; совместимый alias `pending_command` сохранён. Файл: `background.js`.
- Heartbeat/Health-check: пинги и health-check пропускают вкладки с HARD_STOP. Файл: `background.js`.
- Вложения capability: предупреждение в UI для LLM без поддержки вложений (например, Claude), без блокировки отправки. Файл: `results.js`.

### 2025-12-06

- Attachments via native file input: UI читает файлы как data URL и прокидывает в background; ChatGPT контент-скрипт восстанавливает File через DataTransfer и триггерит input/change на реальном `<input type="file">` перед вводом текста. Файлы ограничены (≤5 шт, ≤5MB), в storage сохраняются только метаданные. Файлы: `results.js`, `content-scripts/content-chatgpt.js`.
- Attachments drop-first: контент-скрипт ChatGPT теперь сначала эмулирует drag&drop файлов на composer (DragEvent + DataTransfer), затем fallback к кнопке/инпуту со скрытым attach. Файл: `content-scripts/content-chatgpt.js`.
- Attachments drop/input для других платформ: добавлен drop-first + attach-button/input fallback в Claude, Gemini, Perplexity, Grok, Qwen, DeepSeek, Le Chat (до 5 файлов); payload data URL reused. Файлы: `content-scripts/content-claude.js`, `content-scripts/content-gemini.js`, `content-scripts/content-perplexity.js`, `content-scripts/content-grok.js`, `content-scripts/content-qwen.js`, `content-scripts/content-deepseek.js`, `content-scripts/content-lechat.js`.
- Typing reliability: Claude/Gemini/Perplexity/Le Chat используют native value setter для textarea/input (обход React) в fallback-typing; drop/paste targets расширены до main/form/body/html, добавлен paste-fallback для вложений. Файлы: `content-scripts/content-claude.js`, `content-scripts/content-gemini.js`, `content-scripts/content-perplexity.js`, `content-scripts/content-lechat.js`.
- Attachment delivery (clipboard-first): в tech-stack overview описан брокер вложений (file-picker/drag&drop/паста Ctrl/Cmd+V), блок `attachments` в SelectorConfig и AttachmentInjector с подтверждением upload/fallback в text-only. Файл: `docs/tech-stack-overview.md`.
- Perf harness: включён persistent контекст по умолчанию (`/tmp/pw-home`) и headed-режим для прогрева логинов; per-URL селекторы для Qwen/Mistral уточнены; таймаут ожидания send сокращён до 5s, send имеет фолбэк Enter при отсутствии/блокировке кнопки; goto ждёт `domcontentloaded` (быстрее старты). Файл: `tests/perf-multi-tab.js`.
- Perf harness (добавление): селектор Mistral composer исключает скрытые textarea/contenteditable (aria-hidden/tabindex -1), чтобы не цепляться за скрытый placeholder. Файл: `tests/perf-multi-tab.js`.
- Perf harness (платформы): список URL расширен до всех основных платформ (chat.openai, claude, gemini, grok, perplexity, deepseek, qwen). Файл: `tests/perf-multi-tab.js`.

### 2025-12-05

- Speed mode (DevTools toggle): сохраняется в `settings.speedMode`, транслируется в контент через `__PRAGMATIST_SPEED_MODE`, гасит ContinuousHumanActivity и initialScrollKick/micro-jitter для спокойного UI.
- Smoke check button (DevTools → Diagnostics): вызывает SelectorFinder.healthCheck в активной вкладке, пишет итог в diag-events; платформа фильтруется селектором в Commands/Diag.
- Scroll guard: ScrollToolkit ограничивает пассивные скроллы (≤2/5с), блокирует скролл при `__LLMScrollHardStop`, логирует скачки с origin/stack; micro_jitter отключается в speed mode.
- Быстрый старт runner: кеширует последний контейнер (selector+XPath) per platform в localStorage, пробует первым; watcher не запускается до нахождения контейнера (таймаут ~2.5s).
- Storage шум: StateManager пишет в chrome.storage.local только финальное/idle состояние; в генерации — только LS (меньше QPS/1KB лимит). Рефреш тестов — всё зелёное.

### 2025-12-04

- Embedded Pragmatist budgets/contracts: вынесены в `shared/budgets.js` и подключаются через bootstrap; добавлен сторож очистки storage (ACK TTL 5 мин, pending_command 60с, state 24ч) + alarm `pragmatist_storage_cleanup`. Файлы: `shared/budgets.js`, `content-scripts/content-bootstrap.js`, `background.js`.
- Kill-switch & hard-stop propagation: background human-visit теперь уважает `__LLMScrollHardStop`; UnifiedAnswerWatcher завершается при HARD_STOP. Файлы: `background.js`, `content-scripts/unified-answer-watcher.js`.
- Pragmatist runner: универсальный адаптер/StateManager/CommandExecutor для всех платформ (host-based) без правки платформенных скриптов; сохраняет метаданные в LS+storage и слушает STOP_ALL. Файл: `content-scripts/pragmatist-runner.js`; манифест обновлён для всех платформ.
- Dev copy-pack: синхронизированы свежие версии (budgets, runner, core, pipeline, scroll-toolkit, humanoid, background, watcher) в `Copy selector files/` для ревью.
- DevTools вкладки: автоподгрузка состояний/диагностики при открытии вкладок States/Diagnostics; улучшенные сообщения об ошибках загрузки. Файл: `results.js`.
- Kill-switch/STOP_ALL защита в runner: принудительная остановка watcher/command-executor при `kill_switch`/`STOP_ALL`/HARD_STOP; повторная очистка storage запускается и на старте расширения. Файлы: `content-scripts/pragmatist-runner.js`, `content-scripts/pragmatist-core.js`, `background.js`.
- Runtime STOP_ALL: runner теперь слушает `chrome.runtime.onMessage` (STOP_ALL/STOP_AND_CLEANUP/FORCE_HARD_STOP_RESTORE) и мгновенно гасит активности, выставляя `__LLMScrollHardStop`. Файл: `content-scripts/pragmatist-runner.js`.
- Диагностика batched: background принимает `DIAG_EVENT` и хранит последние 200 событий в `__diagnostics_events__`; вывод времени в Diagnostics табе. Файлы: `background.js`, `results.js`.
- Diag hooks из core/runner: StreamWatcher/CommandExecutor и runner отправляют `DIAG_EVENT` при пропусках из-за HARD_STOP/STOP_ALL (тип `stream_watcher_stop`, `cmd_skip`, `runner_stop`). Файлы: `content-scripts/pragmatist-core.js`, `content-scripts/pragmatist-runner.js`.
- State size guard: StateManager обрезает preview до 512 символов и не пишет в chrome.storage, если запись превышает ~1KB бюджета. Файл: `content-scripts/pragmatist-core.js`.
- Selector-aware runner: подтягивает селекторы/индикаторы генерации из `SelectorConfig` (detectUIVersion + getSelectorsFor) для платформ chatgpt/claude/gemini/perplexity/grok/deepseek/qwen/lechat. Файл: `content-scripts/pragmatist-runner.js`.
- DevTools UX: States/Diagnostics вкладки обновляются при переключении табов; авто-старт загрузки остаётся. Файл: `results.js`.
- Diagnostics удобство: добавлена кнопка Copy для выгрузки diag событий (список в storage) в буфер обмена. Файлы: `result_new.html`, `results.js`.
- Diagnostics export: добавлена кнопка Download, diag-лента оформлена как scrollbox. Файлы: `result_new.html`, `results.js`.
- DevTools табы: убрана отдельная вкладка States, её refresh вынесен в Dev Tools (label “State:s” + Refresh сверху); вкладка API Keys переименована в API. Файлы: `result_new.html`, `results.js`.
- Исправление: кнопка States/Refresh и список состояний перенесены в Dev Diag (вместо Dev Tools). Файлы: `result_new.html`, `results.js`.
- Pragmatist Core: StreamWatcher теперь безопасно подключается (fallback к body, первичный прогон `_process`) и учитывает `Node`/MutationObserver из jsdom; StateManager completion таймер завершает при HARD_STOP. Файлы: `content-scripts/pragmatist-core.js`.
- Тесты: интеграционные сценарии runner/stream-watcher стабилизированы (подстановка location/Node, явный `_check` команд, ожидание мутаций); все Jest тесты зелёные. Файлы: `tests/integration-end-to-end.test.js`, `tests/integration-stream-watcher.test.js`, `tests/setupEnv.js`.
- UI: State:s + Refresh теперь инлайн в Dev Diag. Файл: `result_new.html`.
- Commands UI: Send/Stop All в одну линию с равной шириной, Collect Responses — отдельной полосой на всю ширину. Файл: `result_new.html`.
- Diagnostics UX: добавлен live-фильтр по тексту событий (вместе с Refresh/Copy/Download/Clear). Файлы: `result_new.html`, `results.js`.
- Command status: добавлен блок статуса (pending + recent ACKs) и refresh; backend отдаёт GET_COMMAND_STATUS (pending + последние 20 ack). Файлы: `result_new.html`, `results.js`, `background.js`.
- Scroll предохранители: лимит микроскроллов в пассивных режимах (≤2 за 5с по умолчанию), запрет скролла при `__LLMScrollHardStop`, предупреждения по превышению delta/частоты с выводом stack (через log/hook). Файл: `scroll-toolkit.js`.
- Storage noise reduction: StateManager во время генерации пишет только в localStorage, а в chrome.storage сохраняет финальное/idle состояние (меньше QPS). Файл: `content-scripts/pragmatist-core.js`.
- Pragmatist integration (platforms): runner экспортирует __PragmatistAdapter (adapter/state/command/sessionId) в window для платформенных скриптов; StateManager пишет state_<platform>_<sessionId> помимо state_<sessionId>. Файлы: `content-scripts/pragmatist-runner.js`, `content-scripts/pragmatist-core.js`.
- Storage cleanup: DIAG_EVENT отправляется при удалении ключей (count/ttl/maxKeys). Файл: `background.js`.
- Pipeline: UnifiedAnswerPipeline теперь использует sessionId из __PragmatistAdapter (если есть), отправляет STORE_TAB_STATE с platform/sessionId. Файл: `content-scripts/unified-answer-pipeline.js`.
- CommandExecutor: ACK теперь содержит platform; фильтрация команд по списку платформ усилена. Файл: `content-scripts/pragmatist-core.js`.
- DevTools Commands: добавлен выбор платформы (All/<platform>) для отправки/stop; backend STOP_ALL теперь несёт platforms. Файлы: `result_new.html`, `results.js`, `background.js`.
- Broadcast STOP_ALL фильтруется по платформе и в runtime-listener/хранилище listener, чтобы не гасить чужие вкладки. Файлы: `content-scripts/pragmatist-runner.js`, `content-scripts/pragmatist-core.js`.
- States/Commands в DevTools: фильтрация по платформе (select), GET_COMMAND_STATUS и GET_ALL_STATES учитывают платформу на бэкенде. Файлы: `results.js`, `result_new.html`, `background.js`.
- ChatGPT script начал использовать Pragmatist adapter (sessionId/platform) для дальнейшей привязки пайплайна. Файл: `content-scripts/content-chatgpt.js`.
- Платформенные скрипты (Claude, Gemini, Perplexity, Grok, DeepSeek, Qwen, LeChat) подключены к __PragmatistAdapter (sessionId/platform) для дальнейшего wiring пайплайна. Файлы: `content-scripts/content-*.js`.
- ChatGPT pipeline теперь получает sessionId/platform из __PragmatistAdapter (overrides в UnifiedAnswerPipeline). Файл: `content-scripts/content-chatgpt.js`.
- Все платформенные пайплайны (Claude/Gemini/Perplexity/Grok/DeepSeek/Qwen/LeChat) получают overrides sessionId/platform из __PragmatistAdapter при создании UnifiedAnswerPipeline. Файлы: `content-scripts/content-*.js`.
- Tests: расширены unit-тесты StateManager/CommandExecutor (дебаунс/TTL/платформ-фильтр); добавлен placeholder для burst/budget simulation. Файлы: `tests/state-manager.test.js`, `tests/command-executor.test.js`, `tests/storage-budgets.test.js`.
- Integration test: добавлен тест связки StreamWatcher + StateManager с реальными мутациями в DOM (jsdom). Файл: `tests/integration-stream-watcher.test.js`.
- Integration test: добавлен тест CommandExecutor+StateManager (pending command, platform filter, ACK). Файл: `tests/integration-command-flow.test.js`.
- Unit test: CommandExecutor теперь проверяет запись ACK с platform (submit success). Файл: `tests/command-executor.test.js`.
- Storage budgets: тесты с описанием кейсов (maxKeys eviction/valueSize/QPS) оформлены как TODO-placeholder. Файл: `tests/storage-budgets.test.js`.
- End-to-end scaffold placeholder (jsdom) для будущего полного потока. Файл: `tests/integration-end-to-end.test.js`.
- Runner sessionId теперь стабилизируется per-платформа (persist в localStorage `__prag_session_<platform>`). Файл: `content-scripts/pragmatist-runner.js`.
- Storage cleanup: учитывает лимит maxKeys (50) и удаляет старейшие state_* сверх бюджета. Файл: `background.js`.
- Тесты инвариантов: добавлены базовые Jest-тесты для StateManager и CommandExecutor (skip при HARD_STOP). Файлы: `tests/state-manager.test.js`, `tests/command-executor.test.js` (запуск требует установки jest, текущий запуск упал из-за отсутствия команды).

### 2025-12-03

- HumanSessionController: ввели абсолютный потолок hard-stop (10 мин) при продлении активности, пассивный heartbeat теперь учитывает `__LLMScrollHardStop` и скрытость вкладки; исключён бесконечный дрейф при росте DOM. Файл: `content-scripts/pipeline-modules.js`.
- Watcher wiring: `humanSession` прокинут в `UnifiedAnswerCompletionWatcher`, чтобы мутации/рост ответа продлевали сессию и не включался пассивный heartbeat посреди стрима. Файл: `content-scripts/unified-answer-pipeline.js`.
- Remote selector overrides: добавлен opt-in флаг `enable_remote_selectors_override` (по умолчанию off) и опциональная проверка SHA-256 (`REMOTE_SELECTORS_EXPECTED_SHA256`); ручной refresh отклоняется при выключенном флаге. Файл: `background.js`.
- Anti-sleep hard-stop: контентные ANTI_SLEEP_PING теперь игнорируются при `__LLMScrollHardStop`; ScrollCoordinator запрещает скролл при `humanSessionController` HARD_STOP; background анти-сон пинги не отправляются в вкладки с hard-stop (получаемом из контента). Файлы: `content-scripts/content-*.js`, `scroll-toolkit.js`, `background.js`, `content-scripts/pipeline-modules.js`.
- Hard-stop de-stickiness: сброс флага `__LLMScrollHardStop` и уведомления `SCROLL_HARD_STOP` отправляются при любом состоянии, отличном от HARD_STOP, чтобы background сразу убирал вкладку из `hardStopTabs` и не блокировал анти-сон там, где сессия завершена. Файлы: `content-scripts/pipeline-modules.js`, `background.js`.
- GPT mitigation: точечный override для ChatGPT — отключён maintenanceScroll и continuousActivity, оставлен initialScrollKick для надёжного старта. Файл: `content-scripts/pipeline-config.js`; документация: `docs/help-request-scroll-jitter.md`.
- MV3 State Persistence & Gatekeeper: hard-stop состояния переносятся в `chrome.storage.session` (вместо in-memory Set), анти-сон опирается на persisted state; добавлен `FORCE_HARD_STOP_RESTORE` на обновление вкладки. В контенте — ScrollGatekeeper (AbortController + capture wheel/scroll) подключён через `__ScrollGatekeeper`, вызывается при HARD_STOP из `HumanSessionController`. Файлы: `background.js`, `scroll-toolkit.js`, `content-scripts/pipeline-modules.js`.
- Pipeline local state (embedded): `unified-answer-pipeline` теперь пишет компактное состояние сессии в `localStorage llm_ext_<traceId>` (start/error/complete, длительность, длина ответа). Не использует chrome.storage, безопасно к квотам. Файл: `content-scripts/unified-answer-pipeline.js`.
- Tab state per вкладка: контент отправляет статус фаз в `chrome.storage.local state_<tabId>` (start/error/complete) для редкого сбора в SW; фоновый обработчик `STORE_TAB_STATE/AGGREGATE_TAB_STATES` добавлен. Файл: `background.js`, `content-scripts/unified-answer-pipeline.js`.
- TabProtector: добавлен беззвучный AudioContext keepalive только на время стрима, чтобы вкладка не выгружалась в фоне. Файлы: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`.
- Kill-switch broadcast: kill_switch в storage переключает HARD_STOP в контенте и блокирует скролл/активность (слушатель в `content-bootstrap.js` + forceHardStop). Файлы: `content-scripts/content-bootstrap.js`, `content-scripts/pipeline-modules.js`.
- DevTools вкладки: добавлены States (state_*), Commands (submit/stop/collect), Diagnostics (monkey-patch, diag events) без удаления существующих вкладок. Файлы: `result_new.html`, `results.js`.

### 2025-12-02

- UI: уменьшены вертикальные отступы между строками категорий в Tuning Console и блоком LLM Stream (убраны лишние margin/padding, снижены row-gap/grid-auto-rows), вернув плотный стык как в макете; треугольник кнопки Send центрирован и приведён к равностороннему виду. Файл: `styles.css`.
- DevTools / Commands: убраны инлайновые стили в карточке Submit Prompt, карточки выровнены по верхнему краю и приведены к единому отступу в теле; добавлена вспомогательная настройка для грид/кнопок (`result_new.html`, `styles.css`).
- DevTools / Commands: выровнены отступы внутри Submit Prompt, select и textarea теперь на полной ширине карточки с единым шагом между элементами (`styles.css`).
- Prompt clear: кнопка очистки теперь удаляет и текст, и выбранные модификаторы, и прикреплённые файлы (очищаются массивы вложений и панель обновляется) (`results.js`).

- LeChat: composer/send resolution теперь через SelectorFinder (учитывает удалённые overrides) + расширенные fallback-селекторы (aria-label message, data-testid composer/send, svg-icon send) в конфиге и контент-скрипте; исправляет недоставку промптов в версии 2.46.
- LeChat: усилен ввод в contenteditable (ProseMirror) — insertText + InputEvent beforeinput/input/change, чтобы текст принимался новым редактором Mistral.

### 2025-11-30

1) Удаление Humanoid overlay (всплывающего бара)
   - Файлы: `humanoid.js`, `manifest.json`.
   - Что сделано: полностью удалена инициализация/рендер панели `humanoid-control-bar`; исключён `humanoid.css` из подключений контент-скриптов.
   - Зачем: убрать визуальный шум и исключить лишние DOM-вставки/слушатели.

2) Единый плавный скролл
   - Файлы: `manifest.json`, `humanoid.js`.
   - Что сделано: `scroll-toolkit.js` подключён во все контент-скрипты; `Humanoid.humanScroll` использует ScrollToolkit приоритетно, с smooth fallback.
   - Эффект: прокрутка и settle становятся плавными и без дёрганий на всех платформах.

3) MouseSimulator / ReadingSimulator (имитация колёсика и чтения)
   - Файл: `humanoid.js`.
   - Что сделано: добавлены MouseSimulator (jitter + WheelEvent, разбивка на шаги) и ReadingSimulator (случайные скроллы/паузы/движения мыши). Экспортированы как `LLMExtension.mouseSimulator` / `LLMExtension.readingSimulator`. `Humanoid.humanScroll` сначала вызывает MouseSimulator, затем ScrollToolkit/native.
   - Эффект: более “живой” скролл (колёсико) и возможность триггерить генерацию/anti-sleep через человекоподобное поведение.

4) Усиление детекта окончания ответа
   - Файлы: `content-scripts/platform-selectors.js`, `content-scripts/pipeline-config.js`, `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-watcher.js`.
   - Что сделано:
     - Добавлены per-платформенные `generatingIndicators` и `completionIndicators` (явные сигналы “генерируется/готово”).
     - Критерий `completionSignal` в UniversalCompletionCriteria; учёт включённости критериев и динамический расчёт доли выполненных критериев (без жёсткого деления на 5).
     - Watcher теперь отмечает generating/completion индикаторы и использует их в критериях.
     - Конфиг completionCriteria получил флаг `completionSignalEnabled`.
   - Эффект: более раннее и надёжное завершение при наличии явных DOM-индикаторов, меньше зависаний на таймаутах.

5) Initial Scroll Kick перед стримингом
   - Файл: `content-scripts/unified-answer-pipeline.js`; настройки в `pipeline-config.js` (`streaming.initialScrollKick`).
   - Что сделано: перед фазой streaming выполняется доскролл вниз (ScrollToolkit → Humanoid.humanScroll → native), с телеметрией `scroll_kick`.
   - Эффект: предотвращает ситуации, когда платформа не начинает поток без прокрутки до низа.

7) Continuous Activity с MouseSimulator
   - Файл: `content-scripts/pipeline-modules.js` (ContinuousHumanActivity).
   - Что сделано: микроскроллы теперь в приоритете используют `LLMExtension.mouseSimulator.scrollWithMouse` (jitter + wheel), затем Humanoid.humanScroll, затем smooth scroll.
   - Эффект: во время ожидания поддерживается «живое» колесико, помогая платформам продолжать стриминг/не засыпать.

6) Документация
   - Файл: `docs/change-log-codex.md` (этот файл) — создан и будет пополняться при дальнейших изменениях.

8) Cursor Ghost (визуализация действий курсора, опционально)
   - Файл: `humanoid.js`.
   - Что сделано: добавлен `CursorGhost` (оранжевый круг, translate+transition) и экспортирован как `LLMExtension.cursorGhost`. MouseSimulator теперь двигает ghost при каждом mousemove (scroll/moveTo). Визуализация включается флагом `localStorage.__debug_cursor = 'true'`, по умолчанию скрыта.
   - Эффект: можно видеть траекторию “живых” скроллов/движений, не влияя на клики (pointer-events: none).

9) 3-минутный лимит human-like активности
   - Файлы: `content-scripts/pipeline-modules.js`, `docs/humanoid-session-policy.md`.
   - Что сделано: в ContinuousHumanActivity добавлен таймер `sessionTimeoutMs` (по умолчанию 3 мин). При старте активности запускается таймер, по истечении — `stop('session-timeout')` гасит микро-скроллы/heartbeats; новый запрос запускает новую сессию. Политика описана отдельно.
   - Эффект: human-like активность не гоняет вкладку бесконечно; после 3 минут остаётся функционал (копирование/отправка), а человекоподобные циклы перезапускаются только с новым запросом.

10) HumanSessionController (активность с лимитом и пассивным пульсом)
    - Файлы: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`.
    - Что сделано: добавлен HumanSessionController с рандомным лимитом (~180s ±20%), авто-переключением в EXPIRED при hidden, пассивным “scroll jitter” heartbeat после таймаута. Пайплайн запускает контроллер в начале streaming и останавливает при завершении/ошибке.
    - Эффект: шумная human-активность ограничена по времени; для длинных ответов остаётся лёгкий keepalive, чтобы не рвать стрим, без мешающей активности.

11) Hard-stop и продление при активности
    - Файлы: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`.
    - Что сделано: в HumanSessionController введён hard-stop дедлайн (8–10 мин с рандомом) с продлением при активности (+2 мин по reportActivity). Watcher репортит мутации/контентные изменения в сессию. В пайплайне hard-stop флаг прерывает ожидание (Promise.race) и маркирует streamingTimedOut.
    - Эффект: для reasoning-моделей остаётся безопасное окно, но бесконечные зависания не удерживают активность; при реальном стриме дедлайн отодвигается.

12) Bootstrap/namespace для контента
    - Файлы: `content-scripts/content-bootstrap.js`, `manifest.json`.
    - Что сделано: добавлен ранний bootstrap, создающий `window.LLMExtension`/`SelectorConfig` и stamp build info; подключён первым в списках content scripts во всех платформах.
    - Эффект: единое пространство имён готово для дальнейших модулей/override, без изменения текущего поведения.

13) SelectorFinderLite (фасад селекторов с override)
    - Файлы: `content-scripts/selectors-finder-lite.js`, `manifest.json`.
    - Что сделано: добавлен лёгкий фасад `SelectorFinderLite.getSelectors(platform)` с поддержкой `SelectorConfig.overrides`; подключён в контент до остальных модулей. Пока не меняет поведение — только даёт точку для override.
    - Эффект: можно безопасно накатывать селекторные override без ломки текущей логики; подготовка к многослойной системе селекторов.

14) SelectorMetrics (наблюдение за селекторами)
    - Файлы: `content-scripts/selectors-metrics.js`, `manifest.json`.
    - Что сделано: добавлен лёгкий сборщик метрик `SelectorMetrics.record/getAll` (успех/ошибка по типам/платформе), подключён ранним скриптом. Пока только лог/телеметрия, без изменения поведения.
    - Эффект: можно наблюдать деградации селекторов, подготовка к health-check/circuit breaker.

15) SelectorCircuit (мягкий circuit breaker для селекторов)
   - Файлы: `content-scripts/selectors-circuit.js`, `manifest.json`, `content-scripts/unified-answer-watcher.js`.
   - Что сделано: добавлен session-scoped circuit breaker (флаг в SelectorConfig, threshold по умолчанию 3). Watcher фильтрует селекторы через circuit, репортит успехи/фейлы только при реальных результатах/ошибках (не меняет поведение при валидных селекторах).
   - Эффект: снижает спам ошибками при плохих селекторах, готовит почву для устойчивости к поломкам DOM; включается/настраивается через SelectorConfig.

16) Storage budgets helper + cleanup
   - Файлы: `shared/storage-budgets.js`, `background.js`.
   - Что сделано: вынесена чистая функция `computeStorageCleanup` (TTL ack/command/state + maxKeys + диагностические события) и подключена в background через `importScripts`. Cleanup теперь опирается на helper и репортит DIAG_EVENT только при фактических удалениях.
   - Эффект: единая точка логики для тестов и рабочего кода, проще контролировать лимиты и причины удаления.

17) Тесты на бюджеты/интеграцию
   - Файлы: `tests/storage-budgets.test.js`, `tests/integration-end-to-end.test.js`.
   - Что сделано: добавлены реальные проверки computeStorageCleanup (TTL/eviction/maxKeys/diag trim) и StateManager guard/debounce. End-to-end тест прогоняет pragmatist-core + runner на jsdom (sessionId, state запись, командный поток с фильтрацией платформ, STOP_ALL broadcast).
   - Эффект: покрыты основные инварианты хранения и платформенной фильтрации команд; убраны пустышки тестов.

18) DevTools диагностика / батчи событий
   - Файлы: `background.js`, `results.js`, `result_new.html`.
   - Что сделано: DIAG_EVENT теперь записывает platform/traceId/sessionId/source, добавлены команды GET_DIAG_EVENTS/CLEAR_DIAG_EVENTS с фильтром по платформе и лимитом. В DevTools вкладке Diagnostics реализованы refresh/copy/download через background, фильтр по тексту, очистка, отображение platform/traceId/sessionId.
   - Эффект: видно, что и где генерирует события, можно быстро фильтровать по платформе/трейсу и выгружать логи без прямого доступа к storage.

19) Усиление стабильности после ревью
   - Файлы: `background.js`, `content-scripts/pragmatist-core.js`, `results.js`.
   - Что сделано: добавлен size guard для DIAG_EVENT (50KB + 200 записей), GET_DIAG_EVENTS ограничивает выдачу до 200 событий. CommandExecutor удаляет pending_command после успешного ACK текущей команды. StateManager завершает completion-таймер при hard_stop. Diagnostics UI рендерит максимум 200 событий.
   - Эффект: снижен риск переполнения diag-хранилища и дублирования команд, убраны лишние таймеры при hard-stop, UI не зависает на больших логах.

20) Scroll diagnostics & тестирование дерганий
   - Файлы: `scroll-toolkit.js`, `tests/scroll-metrics.test.js`.
   - Что сделано: добавлен hook `__setScrollEventHook` (события `micro_jitter` с delta/ts) и вспомогательный `_testMicroJitter` для диагностики дерганий; новый unit-тест фиксирует два события и два вызова scrollBy.
   - Эффект: появились лёгкие метрики для контроля микроскроллов/джиттера и база для будущих тестов по стабильности прокрутки.

21) Тесты открытия/навигации вкладок (NavigationDetector)
   - Файлы: `tests/tab-open-metrics.test.js`.
   - Что сделано: проверяется, что NavigationDetector вызывает onNavigate при изменении пути/параметров поиска (poll ~1000 мс), с управляемыми таймерами.
   - Эффект: зафиксирован корректный отклик на смену адреса; база для дальнейших метрик скорости открытия вкладок.

## Техническое задание: HumanSessionController (активность “как человек” с лимитом)

- Цель: Управлять human-like активностью (микроскроллы, MouseSimulator/ReadingSimulator, anti-sleep дрейф, визиты) в рамках одной сессии запроса: активный режим ~3 мин с рандомизацией, затем отключение “шумной” активности и переход в пассивный heartbeat, не мешая техническому функционалу (watcher, maintenance scroll, копирование/отправка).
- Область: Контент-скрипты (Humanoid/MouseSimulator/ReadingSimulator/ContinuousHumanActivity) + пайплайн запросов. Технические части (watcher, scroll settlement, maintenance scroll, финализация/копирование) не ограничиваются.

Функциональные требования:
1) Контроллер сессии
   - Состояния: IDLE, ACTIVE, EXPIRED/BACKGROUND_ACTIVE.
   - Методы: startSession(), expireSession() (авто по таймеру или visibilitychange), stopSession().
   - Старт: начало запроса/streaming; новый запрос в этой вкладке перезапускает сессию (stop → start).
   - Таймер: базовый лимит 180s с рандомизацией ±20% (настраиваемый диапазон). Возможность устанавливать seed/traceId для логов.
   - Лог/telemetry: логировать старт/истечение/стоп с traceId/вкладкой (если канал доступен).

2) Управление поведенческими модулями
   - ACTIVE: включить MouseSimulator/anti-sleep drift/ReadingSimulator прелоад (если используется) и ContinuousHumanActivity (микроскроллы).
   - EXPIRED/BACKGROUND: выключить шумные действия (микроскроллы, MouseSimulator автодвижения, ReadingSimulator автопросмотры, anti-sleep drift).
   - stopSession: полная остановка поведенческих модулей.

3) Пассивный heartbeat после таймаута
   - Лёгкий keepalive (scroll jitter): scrollBy(1), через ~50 мс scrollBy(-1); период 30–60 c (рандом), без визуализации.
   - Отключается при stopSession() или при старте новой сессии.

4) Обработка visibility
   - При document.hidden → сразу переключиться в EXPIRED/BACKGROUND_ACTIVE (шумные действия off, оставить только пассивный пульс), таймер сессии не сбрасывать.

5) Очередность остановки
   - При stopSession()/expire сначала очищать таймеры/интервалы, затем сбрасывать флаги/состояние, чтобы избегать гонок.

Нефункциональные:
- Лёгкость: минимальные таймеры/интервалы, без тяжёлых наблюдателей.
- UX-safe: pointer-events:none для визуализаций (CursorGhost), по умолчанию визуализация отключена.
- Конфликты: убедиться, что нет параллельных анти-sleep/визуализаций из background; если есть — отключить или синхронизировать.
- Конфигурируемость: параметры (baseTimeout, jitter%, passiveHeartbeatPeriod) в конфиге модуля/пайплайна.

## 2025-xx-xx — Фаза 1 (план: #5, #9, #11, #18)
- **#11 Удалить pingWindow код**: убран `ANTI_SLEEP_ALARM` в background (не создаётся и не обрабатывается), чтобы фоновый пинг не трогал вкладки после тайм‑аутов.
- **#18 Remote selectors alarm**: для `REMOTE_SELECTORS_ALARM` добавлена проверка `remoteSelectorsAllowed` перед вызовом `fetchRemoteSelectors` (guard на случай отключения).
- **#9 Pragmatist проверка auto**: `unified-answer-pipeline` валидирует наличие селекторов платформы; при отсутствии (нет записи в `PLATFORM_SELECTORS`) логируется `selectors_missing`, сохраняется `selectors_not_supported`, пайплайн завершается через `handleError` без фаз.
- **#5 Singleton result_new.html**: файл уже содержит `window.__RESULT_SINGLETON__` guard, подтверждено актуальное состояние (дубли не инициализируются).
- Копии файлов не менялись; изменения применены в основной кодовой базе.

## Таймлайн текущего процесса

| Step | Time (T+)  | Событие/действие                                                     | Описание                                                                                             |
|------|------------|---------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1    | 0 ms       | User clicks Send / старт пайплайна                                  | Запуск UnifiedAnswerPipeline с актуальными конфигами/селектором платформы                           |
| 2    | 0–50 ms    | Activate tab (если не активна)                                      | Ожидание visibilitychange (до 5s); если уже активна — мгновенно                                      |
| 3    | 50–500 ms  | Wait for stream start                                                | Поиск streamStart селекторов (или дефолтных); timeout ~45s                                           |
| 4    | 100–600 ms | Detect container                                                     | ScrollToolkit findScrollable → fallback answerContainer/document                                    |
| 5    | 150–700 ms | Initial scroll kick (down)                                          | ScrollToolkit → Humanoid.humanScroll → native smooth; телеметрия `scroll_kick`                      |
| 6    | 200 ms →   | Start HumanSession (ACTIVE)                                         | Таймер ~180s ±20% + hard-stop 8–10 мин; ContinuousHumanActivity микроскроллы включаются отдельно    |
| 7    | 200 ms →   | Streaming phase: parallel tasks                                     | 7a: Scroll settlement (retry/no-growth); 7b: Answer watcher (criteria + generating/completion)       |
| 8    | 200 ms →   | ContinuousHumanActivity (если включено)                             | Микро-скроллы (MouseSimulator → Humanoid → smooth) до истечения сессии/stop                         |
| 9    | …          | Criteria check / timeouts                                            | При достаточных критериях — успех; при soft/hard/hard-stop — ошибка/stop                            |
| 10   | …          | Transition to passive heartbeat (если сессия истекла)               | Scroll jitter (±1px) раз в 30–60s, watcher продолжает работать                                      |
| 11   | …          | Finalization phase                                                   | MaintenanceScroll (если включён), финальные стабильность-чек по hash, extract answer                |
| 12   | …          | SanityCheck                                                          | Предупреждения: hard timeout, активные индикаторы, рост контента, короткий ответ                    |
| 13   | …          | Return/telemetry                                                     | `success/answer/metadata`, telemetry (phases, completionReason), lifecycle stop                      |
| 14   | …          | Stop HumanSession                                                    | При завершении/ошибке — stopSession, выключение микроскроллов/heartbeat                             |
| 15   | …          | Готов к новому запросу в этой вкладке                                | Новый запрос → новый старт сессии (step 1–14)                                                        |

Примечания:
- Если `document.hidden` во время ACTIVE — немедленно EXPIRED, остаётся пассивный heartbeat.
- Hard-stop (8–10 мин с рандомом) срабатывает, если нет активности; при мутациях/росте текста дедлайн отодвигается (+2 мин).

## 2025-xx-xx — Kill-switch скролла и анти‑sleep в фоне
- **Content (HumanSessionController)**: жёсткий kill-switch скролла при HARD_STOP — monkey patch `scrollTo/scrollBy/scrollIntoView`, `overflow:hidden` для body; снимается при новом запуске/stopSession.
- **Background Anti-Sleep**: пинги ANTI_SLEEP_PING игнорируют вкладки в HARD_STOP/COMPLETED и автоматически закрывают ping-window; STOP_AND_CLEANUP закрывает ping-window. Дополнительно: если вкладка не активна 3+ минут, анти‑sleep выключается (закрывает ping-window, вычищает activity map), чтобы не было внешних скроллов после тайм-аута.
- **Anti-Sleep 3m hard cutoff**: логируется начало ping-window, и если с момента старта прошло >3 минут (даже при активности), окно принудительно закрывается и анти‑sleep прекращается; при истечении ping-window удаляются и метки старта.
- **Копия для экспорта**: те же фиксы перенесены в `Copy selector files/background.js`.

## 2025-xx-xx — Перф-харнесс Playwright
- Добавлен скрипт `tests/perf-multi-tab.js` для измерения времени открытия 8 вкладок, поиска поля ввода, ввода и отправки запроса (настройка URL/селекторов в файле).
- Документация по запуску: `docs/perf-tests.md` (настройка и вывод TSV).

## 2025-xx-xx — Копии файлов для работы с вкладками
- Обновлены все рабочие версии файлов в `Copied files` (background, content-скрипты, pipeline/pragmatist, selectors, overrides, scroll-toolkit/results) для актуального тестирования логики вкладок и селекторов без затрагивания основной ветки.
