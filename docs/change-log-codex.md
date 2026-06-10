## Change Log — Codex

### 2026-06-10 00:00 CEST
- Для чего: исправить реальный прогон `2.74.96`, где Qwen сгенерировал ответ, но приложение не смогло его забрать и manual ping повторно видел prompt echo. Изменение: Qwen сохраняет текущий prompt для manual extraction, `getResponses` вызывает `waitForQwenReply()` с prompt-aware фильтрацией, отклоняет prompt echo как `prompt_echo_or_invalid_candidate`, а перед terminal error делает last-chance DOM extraction с тем же baseline/prompt guard. Файл: `content-scripts/content-qwen.js`.
- Для чего: не допустить регрессии, где prompt echo принимается за ответ Qwen. Изменение: экспортирован тестируемый `isQwenAnswerCandidate()` и добавлен unit-тест на rejection prompt echo и acceptance валидного ответа. Файл: `tests/qwen-extraction.test.js`.
- Для чего: исправить реальный прогон `2.74.96`, где Gemini вставил prompt, но не отправил его. Изменение: Gemini dispatch получил расширенные send selectors, scored resolver кнопки отправки, fallback-стратегии `ctrl_enter/button_click/plain_enter/meta_enter/form_submit/scored_button_click` и диагностические события по каждой стратегии; `PROMPT_SUBMITTED` по-прежнему отправляется только после подтверждения отправки. Файл: `content-scripts/content-gemini.js`.

### 2026-06-10 00:00 CEST
- Для чего: исправить уточнённый симптом Gemini из реального прогона `2.74.94`, где запрос фактически не отправился, а manual/late collect принял предыдущий ответ из `snapshot_cache` как текущий результат. Изменение: `acceptLateCollectResult()` теперь отклоняет snapshot-like evidence (`snapshot_cache`, inline DOM, DOM snapshot) при неподтверждённом текущем dispatch (`promptSubmittedAt/submitSource` отсутствуют) и пишет `LATE_COLLECT_STALE_ANSWER_REJECTED`. Файл: `background/job-orchestrator.js`.
- Для чего: не закрывать модель `PARTIAL/SUCCESS` старым DOM-снимком при `awaitingSubmitConfirmation`. Изменение: добавлен regression test, где `partial_from_snapshot` без submit confirmation не меняет terminal state. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: исправить регрессию из реального прогона `2.74.94`, где `ROUND2_REPAIR_CONFIRM_WAIT` честно видел `dispatch_pending`, но pre-visit repair всё равно завершался как `ROUND2_REPAIR_DISPATCH_FAIL` и `not_confirmed_after_repair`. Изменение: `dispatch_pending` после repair теперь классифицируется как `ROUND2_REPAIR_DISPATCH_PENDING`, переводит Round2 в `awaiting_delayed_confirmation_after_repair` и планирует precollect/adaptive probes. Файл: `background/job-orchestrator.js`.
- Для чего: сделать pre-visit и post-visit repair одинаковыми по delayed-confirmation policy. Изменение: добавлены `isRound2DelayedConfirmationState()` и `scheduleRound2DelayedConfirmationContinuation()`, общие для обеих веток Round2. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить contract тестом. Изменение: тест delayed Round2 dispatch теперь проверяет, что `dispatch_pending` распознаётся как delayed confirmation state, а не hard `not_confirmed`. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: убрать ложные `ROUND2_REPAIR_DISPATCH_FAIL`, когда реальная страница подтверждает отправку/начинает ответ с задержкой после repair-dispatch. Изменение: после `round2_repair_pre_visit` и `round2_repair` orchestrator ждёт bounded window `ROUND2_REPAIR_CONFIRM_WAIT_MS` с polling и принимает не только `promptSubmittedAt`, но и answer/lifecycle evidence как подтверждение. Файл: `background/job-orchestrator.js`.
- Для чего: не превращать delayed submit в немедленный `not_confirmed`, если dispatch ещё pending. Изменение: Round2 получил состояние `awaiting_delayed_confirmation`; для него планируются precollect/adaptive probes вместо hard warning path. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить поведение тестами. Изменение: добавлены проверки, что Round2 answer evidence является confirmation signal, а pending dispatch остаётся `dispatch_pending`, а не `not_confirmed`. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: не принимать неполный ответ как terminal только потому, что текст стабилен, пока на странице ещё видна кнопка Stop. Изменение: `AnswerEvidence Lite` больше не считает `stable_text` terminal-eligible при `stopButtonVisible=true`; такой случай получает `rejectReason=stable_text_stop_visible` и остаётся в сборе. Файл: `shared/answer-evidence.js`.
- Для чего: не закрывать модель коротким DOM snapshot, который часто является началом ответа. Изменение: snapshot evidence без явного manual/materialize/final сигнала требует повышенный `snapshotTerminalMinChars=1200`; короткий snapshot получает `rejectReason=snapshot_text_too_short_without_terminal_signal`. Файл: `shared/answer-evidence.js`.
- Для чего: double-click/manual ping после terminal должен дотягивать полный текст, а не упираться в `duplicate_final`. Изменение: `acceptLateCollectResult()` теперь до повторной finalization обновляет сохранённый terminal answer и отправляет UI `LLM_PARTIAL_RESPONSE`, если late collect нашёл более длинный валидный текст; статус остаётся terminal, но содержимое карточки улучшается. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить регрессию тестами. Изменение: добавлены проверки `stable_text_stop_visible`, короткого snapshot без terminal-сигнала и post-terminal улучшения ответа через manual late collect. Файлы: `tests/answer-evidence.test.js`, `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: перевести DOM/snapshot/panel/materialize/timeout ответы на единый минимальный evidence contract. Изменение: добавлен `shared/answer-evidence.js` с `AnswerEvidence Lite` (`sourceKind`, length/hash, terminalEligible, partialAllowed, reason) и подключён в service worker. Файлы: `shared/answer-evidence.js`, `background/index.js`.
- Для чего: не держать модель в `RECEIVING`, если есть достаточный timeout/snapshot/materialize/panel/stable answer evidence, даже когда страница ещё показывает busy/generation indicator. Изменение: `maybeDeferStreamingFinalization()` теперь проверяет `AnswerEvidence.shouldFinalizeWithEvidence()` и форсирует terminal path с диагностикой `Finalization forced (answer evidence policy)`; timeout/hardstop-with-text маппится в `PARTIAL`, snapshot/materialize/panel/stable - в success-like finalization без нового UI-статуса. Файл: `background/job-orchestrator.js`.
- Для чего: сделать terminal state absorbing не только через `modelRunState`, но и через legacy `finalStatusRecorded/finalizedAt/finalStatus`. Изменение: `updateModelState()` теперь явно блокирует поздние `RECEIVING/GENERATING/OPEN` после legacy terminal и пишет `STATUS_IGNORED` с reason `legacy_terminal_blocks_non_terminal_status`. Файл: `background/state-manager.js`.
- Для чего: закрепить новый контракт тестами. Изменение: добавлены unit-тесты `AnswerEvidence Lite`, проверка timeout-with-text -> `PARTIAL`, интеграция answer evidence в `finalizationEvidence` и legacy terminal guard для late `RECEIVING`. Файлы: `tests/answer-evidence.test.js`, `tests/finalization-evidence.test.js`, `tests/state-manager-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: исправить реальный GPT-сбой, где prompt вообще не отправлялся. Причина: в `content-chatgpt.js` были вызовы `emitDiagnostic(...)`, но сама функция отсутствовала, что давало `emitDiagnostic is not defined` и terminal `ERROR`. Изменение: добавлен безопасный `emitDiagnostic()` в GPT content script. Файл: `content-scripts/content-chatgpt.js`.
- Для чего: не тратить Round2 batch budget на длинные verify-visits, когда prompt ещё не подтверждён. Изменение: `dispatchRound2Verification()` теперь делает `round2_repair_pre_visit` до verify visits; если repair подтвердил submit, сразу планирует precollect/adaptive probe, если не подтвердил - завершает модель как `not_confirmed_after_repair` без лишних вкладочных визитов. Файл: `background/job-orchestrator.js`.
- Для чего: не считать fallback materialize visit успешным после короткого/сорванного фокуса. Изменение: `focusTabForVerification()` теперь возвращает visit summary через `startTabVisit/finalizeTabVisit`, а `runPreTerminalMaterializeRecovery()` пишет `MATERIALIZE_RECOVERY_VISIT_FALLBACK_SHORT` и не выставляет `didVisit=true` для `shortVisit`. Файл: `background/job-orchestrator.js`.
- Для чего: не держать Gemini/Le Chat/DeepSeek бесконечно в `RECEIVING`, когда текст уже извлечён, но detector всё ещё видит `busy=true`. Изменение: `maybeDeferStreamingFinalization()` получил stable-answer escape hatch: длинный ответ без видимого Stop и с elapsed/evidence финализируется с диагностикой `Finalization forced (stable answer evidence)`. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить finalization escape hatch тестом. Изменение: `early-terminal-guard.test.js` проверяет, что длинный стабильный answer при `busyVisible=true`, `stopVisible=false` финализируется, а кейс manual recovery с видимым Stop остаётся deferred. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: не считать сорванные переключения вкладок полноценными forced visits. Изменение: добавлен `shared/visit-policy.js`, который классифицирует фактическое foreground-время визита как `usefulVisit/shortVisit/retryable`; `human-presence.js` сохраняет summary, пишет `TAB_VISIT_SHORT` и возвращает фактический результат `visitTabWithAutomation()`. Файлы: `shared/visit-policy.js`, `background/human-presence.js`, `background/index.js`.
- Для чего: исправить порядок/длительность посещения вкладок из логов, где визиты на 100-600ms засчитывались как успешные. Изменение: `runForcedAutomationVisits()` больше не увеличивает performed counter для `shortVisit`, пишет `FORCED_VISIT_SHORT_RETRY` и повторяет тот же planned visit в рамках `maxShortRetries`. Файл: `background/job-orchestrator.js`.
- Для чего: не завершать чужой активный lease отложенным finalizer старого automation visit. Изменение: `endAutomationVisit()` финализирует только tracker той же модели, иначе возвращает сохранённый `lastAutomationVisitSummary`. Файл: `background/human-presence.js`.
- Для чего: закрепить регрессию тестами. Изменение: добавлены проверки `VisitPolicy` и сценария, где automation visit GPT прерывается переключением на вкладку Claude и возвращается как `shortVisit`, а не как успешный визит. Файлы: `tests/visit-policy.test.js`, `tests/human-presence-lease.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: убрать ложный смысл `ROUND1_END dispatch complete`, когда prompt ещё не подтверждён content script. Изменение: Round1 теперь пишет `prompt confirmed` только при `PROMPT_SUBMITTED`, иначе `dispatch command sent (awaiting confirmation)` с `reason=awaiting_submit_confirmation`. Файл: `background/job-orchestrator.js`.
- Для чего: не оставлять GPT и Le Chat без repair после `prompt not confirmed`. Изменение: `ROUND2_REPAIR_MODELS` расширен до `GPT`, `Gemini`, `Claude`, `Grok`, `Le Chat`, `Qwen`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать состояние неподтверждённой отправки явным для supervisor/replay/debug. Изменение: `dispatchPromptToTab(skipSubmitWait)` ставит `awaitingSubmitConfirmation*`, telemetry `PROMPT_SUBMITTED_PENDING`, а content/inferred submit очищает эти поля. Файлы: `background/dispatch-coordinator.js`, `background/message-router.js`, `background/job-orchestrator.js`.
- Для чего: следующий реальный лог должен показывать точную точку отказа отправки. Изменение: Qwen/GPT content scripts пишут diagnostics для `composer ready`, `paste attempted`, `value validated`, `send attempt`, `send confirmed/failed`. Файлы: `content-scripts/content-qwen.js`, `content-scripts/content-chatgpt.js`.
- Для чего: не терять причину отказа в manual-auth smoke. Изменение: `scripts/manual-auth-real-pages.js` после `START_RUN=1` запрашивает `GET_DIAG_EVENTS`, сохраняет diagnostics в report и печатает последние события в stdout. Файл: `scripts/manual-auth-real-pages.js`.
- Для чего: новый запуск не должен блокироваться зависшим старым run сообщением `Дождитесь завершения запроса на главной странице`. Изменение: `GET_ACTIVE_RUN_STATE` возвращает `staleActiveRun/sessionAgeMs` и не считает stale run активным после 15 минут без rounds; manual-auth перед UI-run отправляет `STOP_ALL` как preflight cleanup. Файлы: `background/message-router.js`, `results.js`, `scripts/manual-auth-real-pages.js`.

### 2026-06-09 00:00 CEST
- Для чего: разделить поведение иконки Tuning Console на обычный и двойной клик. Изменение: `#toggle-modifiers-btn` в `results.js` теперь по single-click сворачивает/разворачивает сам блок модификаторов, а по double-click раскрывает/сворачивает полный список карточек модификаторов; добавлена задержка, чтобы двойной клик не срабатывал как два одиночных. Файл: `results.js`.
- Для чего: не восстанавливать карточки ответов и HTML панели Favourite после refresh страницы и reload расширения. Изменение: bootstrap `results.js` теперь удаляет `shared.outputs` из `llmComparatorCrossViewUiState` до `restoreCrossViewUiState()`, поэтому сохранённые `.llm-panel .output`, `#comparison-output` и старый DOM `Favourite` больше не возвращаются из `chrome.storage.local` на старте. Файл: `results.js`.
- Для чего: безопасно тестировать реальные страницы моделей без передачи Google password/2FA в Codex. Изменение: добавлен `scripts/manual-auth-real-pages.js`, который запускает Playwright persistent profile, открывает реальные страницы выбранных моделей, ждёт ручной вход пользователя и пишет readiness report. Файл: `scripts/manual-auth-real-pages.js`.
- Для чего: проверить не только авторизацию, но и end-to-end prompt dispatch после ручного входа. Изменение: script поддерживает `START_RUN=1`, заполняет prompt в `result_new.html`, вызывает `START_FULLPAGE_PROCESS` и собирает output lengths. Файл: `scripts/manual-auth-real-pages.js`.
- Для чего: сделать запуск воспроизводимым. Изменение: добавлен npm script `auth:models`; профиль по умолчанию хранится в `.playwright-auth-profile`, отчёт в `artifacts/manual-auth-smoke-report.json`. Файл: `package.json`.
- Для чего: не сохранять OAuth query/email/nonce в тестовых логах. Изменение: manual-auth script пишет в stdout/report только `origin + pathname`, а auth blocker определяет по hostname/pathname и отсутствию composer. Файл: `scripts/manual-auth-real-pages.js`.

### 2026-06-08 00:00 CEST
- Для чего: превратить selector health profile из одноразового broken gate в lifecycle decision contract. Изменение: добавлен `shared/selector-profile-lifecycle.js` с решениями `use_current`, `monitor_degraded`, `rollback_to_last_known_good`, `fallback_only`. Файл: `shared/selector-profile-lifecycle.js`.
- Для чего: объяснимо выбирать поведение resolver при broken profile. Изменение: `SelectorResolverV2` теперь пишет `selectorProfileLifecycle` в diagnostics, пропускает exact/cache по lifecycle decision и отличает rollback-eligible профиль от fallback-only. Файл: `content-utils/selector-resolver-v2.js`.
- Для чего: загрузить lifecycle policy и в service worker, и на страницах моделей. Изменение: `background/index.js` импортирует shared-модуль, `manifest.json` подключает `shared/selector-profile-lifecycle.js` перед `content-utils/selector-resolver-v2.js` во всех content-script группах. Файлы: `background/index.js`, `manifest.json`.
- Для чего: закрепить lifecycle тестами. Изменение: добавлен `selector-profile-lifecycle.test.js`, resolver spec проверяет rollback decision для broken profile с last known good. Файлы: `tests/selector-profile-lifecycle.test.js`, `tests/selector-resolver-v2.spec.js`.

### 2026-06-08 00:00 CEST
- Для чего: получить offline replay baseline для diagnostics/telemetry без запуска вкладок и моделей. Изменение: добавлен `shared/log-replay-harness.js`, который нормализует события из `label/type/event`, `meta`, `telemetryTaxonomy`, `decisionLedger` и строит per-model итог. Файл: `shared/log-replay-harness.js`.
- Для чего: видеть causal failure classes в replay output. Изменение: harness считает `staleEvents`, `recoveryDenied`, `duplicateFinalIgnored`, `terminalEvents` и финальный статус модели только по принятому terminal decision. Файл: `shared/log-replay-harness.js`.
- Для чего: закрепить replay contract. Изменение: добавлен `log-replay-harness.test.js` для terminal accept, duplicate final ignored, stale quarantine и recovery denial. Файл: `tests/log-replay-harness.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: привести page blockers к единой runtime taxonomy вместо разрозненных `login_required/captcha/wrong_page` строк. Изменение: добавлен `shared/page-blocker-policy.js` с alias-normalization и action policy (`terminal_user_action_required`, `retry_after_or_error`, `wait_retry`, `selector_health_degraded`). Файл: `shared/page-blocker-policy.js`.
- Для чего: не планировать бессмысленные dispatch retries при terminal blockers. Изменение: `normalizePageReadyState()` теперь добавляет `blockerPolicy`, terminal blockers переводят gate в blocked state, а retry не ставится при `retryable=false`. Файл: `background/dispatch-coordinator.js`.
- Для чего: закрепить поведение тестами. Изменение: добавлен `page-blocker-policy.test.js`, page-ready test проверяет нормализацию `login_required` в `auth_required` и terminal user-action policy. Файлы: `tests/page-blocker-policy.test.js`, `tests/page-ready-state.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: получить объяснимую цепочку решений без разметки всех telemetry call-sites. Изменение: добавлен `shared/decision-ledger.js`, который хранит компактный per-model `decisionLedger` и `lastDecisionRecord`. Файл: `shared/decision-ledger.js`.
- Для чего: связать ledger с уже стабилизированными single-writer решениями. Изменение: `handleLLMResponse()` пишет `ignore_stale_event`, `accept_success`, `finalize_error`, `upgrade_terminal`, `ignore_duplicate_final`; RecoveryIntent denial пишет `deny_recovery_intent`. Файлы: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.
- Для чего: проверить causal trace baseline. Изменение: добавлен `decision-ledger.test.js`, orchestrator tests проверяют ledger records для stale identity и manual resend denial. Файлы: `tests/decision-ledger.test.js`, `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: не принимать stale events от другого run/dispatch/tab в terminal path. Изменение: добавлен `shared/run-identity.js` с `RunIdentity.build()` и `validateEvent()` для `runSessionId`, `dispatchId`, `tabId`, `promptHash`. Файл: `shared/run-identity.js`.
- Для чего: закрепить identity на момент отправки prompt. Изменение: `dispatchPromptToTab()` записывает `entry.runIdentity` при регистрации `dispatchId`. Файл: `background/dispatch-coordinator.js`.
- Для чего: quarantined stale response до финализации. Изменение: `handleLLMResponse()` заменил локальные session/dispatch проверки на `RunIdentity.validateEvent()`, пишет `entry.lastRunIdentityDecision` и telemetry `STALE_EVENT_QUARANTINED`. Файл: `background/job-orchestrator.js`.
- Для чего: покрыть contract тестами. Изменение: добавлен `run-identity.test.js`, orchestrator test проверяет, что response с чужим `runSessionId` не меняет terminal state. Файлы: `tests/run-identity.test.js`, `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: снизить риск зависаний после остановки MV3 Service Worker во время долгой генерации. Изменение: активный open-run поддерживает `llm_orchestrator_mv3_survival_v1` alarm, который будит SW и запускает `loadJobState()`. Файл: `background/job-orchestrator.js`.
- Для чего: восстановить runtime-поведение после rehydrate, а не только прочитать storage. Изменение: `loadJobState()` вызывает `rehydrateActiveJobRuntime()`, помечает `mv3RehydratedAt/mv3RehydrationCount`, сбрасывает stale in-flight флаги и re-arm collect/adaptive probes для моделей с подтверждённой отправкой. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить baseline тестом. Изменение: orchestrator test проверяет, что сохранённый open job после `loadJobState()` получает rehydration metadata и создаёт survival alarm. Файл: `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: отделить read-only recovery от опасных mutating/resend действий. Изменение: добавлен `shared/recovery-intent.js` с intent-классами `observe_only`, `focus_only`, `nudge_generation`, `composer_repair`, `resend_prompt` и правилом `no_resend_after_answer_evidence`. Файл: `shared/recovery-intent.js`.
- Для чего: не отправлять prompt повторно, если уже есть terminal-eligible answer evidence. Изменение: `dispatchPromptToTab()` проверяет recovery intent для `manual_resend`, `round2_repair`, `retry_supervisor` и пишет `RECOVERY_INTENT_DENIED` вместо фокуса/перезагрузки/повторной отправки. Файл: `background/dispatch-coordinator.js`.
- Для чего: не мутировать state machine до проверки безопасности recovery. Изменение: `round2_repair` и `handleManualResendRequest()` вызывают `RecoveryIntent.authorize()` до reset/dispatch; manual resend возвращает `manual_resend_denied`, если есть сохранённый ответ. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить No-Resend Guard тестами. Изменение: добавлен `recovery-intent.test.js`, а orchestrator тест проверяет отказ manual resend при `pendingFinalAnswer`. Файлы: `tests/recovery-intent.test.js`, `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: начать перевод финализации моделей из набора локальных проверок в single-writer runtime. Изменение: добавлен `shared/finalization-controller.js` с `tryFinalize()`, который единой точкой решает `accept`, `ignore`, `keep_locked_status`, terminal upgrade и duplicate terminal для candidate final status. Файл: `shared/finalization-controller.js`.
- Для чего: убрать разрозненную логику locked terminal/upgrade/duplicate из `handleLLMResponse()`. Изменение: `background/job-orchestrator.js` теперь вызывает `FinalizationController.tryFinalize()` перед записью terminal state, сохраняет `entry.finalizationControllerDecision` и только после принятого решения продолжает evidence/projection/broadcast path. Файл: `background/job-orchestrator.js`.
- Для чего: загрузить controller в MV3 service worker до orchestration runtime. Изменение: `background/index.js` импортирует `shared/finalization-controller.js` после status/model-run contracts. Файл: `background/index.js`.
- Для чего: закрепить новый contract тестами. Изменение: добавлен `finalization-controller.test.js`, а VM-тесты orchestrator загружают shared status/finalization contracts перед `job-orchestrator.js`. Файлы: `tests/finalization-controller.test.js`, `tests/finalization-evidence.test.js`, `tests/early-terminal-guard.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: не терять введённый prompt и активные кнопки моделей при переключении `result_new.html` ↔ `pipeline_panel.html`. Причина: внутренний переход между view выполняет новую загрузку страницы, а bootstrap-reset чистил `llmComparatorCrossViewUiState` и `llmComparatorSelected*` без отличия от обычного refresh. Изменение: переключатель страниц теперь пишет короткоживущий `llmComparatorCrossViewNavigationIntent`, а initial bootstrap consumes этот intent и пропускает очистку transient cross-view state только для целевого view. Файл: `results.js`.
- Для чего: сохранить reset-on-refresh, но не перетирать cross-view draft пустым DOM до восстановления. Изменение: ранние неконтролируемые вызовы `clearModifierSelectionsOnLoad()` убраны, initial `loadModifiers()` выполняет gated restore, а persistence modifier selections подавляется на время начального cross-view restore. Файл: `results.js`.
- Для чего: зафиксировать регрессию тестом. Изменение: `modifier-bootstrap-reset.test.js` проверяет два контракта: обычная загрузка очищает stored modifier selections, а cross-view navigation сохраняет prompt, active model button и modifier storage. Файл: `tests/modifier-bootstrap-reset.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: не восстанавливать введённый prompt и выбор кнопок моделей после refresh страницы и reload расширения. Изменение: bootstrap `results.js` теперь очищает `promptText`, `modelButtonIds`, `promptSubmitted` и prompt-related `formControls` из `llmComparatorCrossViewUiState` до `restoreCrossViewUiState()`, поэтому transient draft и active model selection больше не возвращаются из `chrome.storage.local` на старте. Файл: `results.js`.
- Для чего: добавить общий selection-toolbar на открытых страницах моделей и связать его с главным избранным. Изменение: `content-scripts/model-selection-toolbar.js` добавляет floating toolbar на выделение текста в model-page и передаёт fragment в `llmComparatorFavoriteEntries`; `manifest.json` подключает этот content script ко всем model-page. Файл: `content-scripts/model-selection-toolbar.js`, `manifest.json`.
- Для чего: объединить favorite items из карточек ответов и model-page selections в один model-group. Изменение: `results.js` группирует `Favourite` по `modelKey`, поэтому карточки ответа и выделенные фрагменты одной модели попадают в один `.favorite-entry`. Файл: `results.js`.
- Для чего: сохранять форматирование выделенного текста и не терять его при добавлении в избранное. Изменение: response-selection toolbar сохраняет HTML-highlight/bold/italic вместе с fragment, а `Favourite` хранит и plain text, и sanitized HTML. Файл: `results.js`, `content-scripts/model-selection-toolbar.js`.
- Для чего: поддерживать editable favourite items и удаление отдельных записей без разрушения группы. Изменение: `favorite-item-body` остаётся редактируемым, а remove-button удаляет только один item, сохраняя остальные элементы модели в том же group. Файл: `results.js`.
- Для чего: держать transient UI state сброшенным на reload. Изменение: `Favourite` не восстанавливается из storage при bootstrap, а выбранные query modifiers очищаются на старте и не возвращаются после refresh. Файл: `results.js`.
- Для чего: не восстанавливать selections модификаторов из старого storage и не держать их после очистки textarea. Изменение: `loadModifiers()` запускается без restoreSelections на initial load, bootstrap чистит `llmComparatorSelected*`, а корзина очистки prompt также сбрасывает modifiers. Файл: `results.js`.
- Для чего: сделать export всех ответов включающим Favourite в тот же HTML bundle. Изменение: общий HTML export теперь дописывает `Favourite` как отдельную секцию в общий документ LLM Responses; export Favourite отдельно сохранён. Файл: `results.js`.

### 2026-06-08 00:00 CEST
- Для чего: исправить регрессию, при которой страницы моделей открывались, но prompt не вставлялся. Причина: `noFocusResponse` был объявлен блочным `const` внутри ветки no-focus probe и затем использовался снаружи в `normalizePageReadyState()`, что давало runtime `ReferenceError` до отправки `GET_ANSWER`. Изменение: `noFocusResponse` вынесен во внешний scope dispatch flow. Файл: `background/dispatch-coordinator.js`.

### 2026-06-08 00:00 CEST
- Для чего: нормализовать telemetry после стабилизации runtime events, не переписывая все call-sites. Изменение: добавлен `normalizeTelemetryTaxonomy()` с `schemaVersion`, `eventKey`, `domain`, `stage`, `outcome`, `eventClass`; taxonomy автоматически добавляется в `meta.telemetryTaxonomy` для diagnostics и telemetry entries. Файл: `background/telemetry-logs.js`.
- Для чего: выделить duplicate final events как отдельный failure/ignored mode. Изменение: taxonomy классифицирует `MODEL_FINAL ignored (deduplicated)` и `duplicate_final` как `eventClass=finalization_duplicate_ignored`, `domain=finalization`, `outcome=ignored`. Файл: `background/telemetry-logs.js`.

### 2026-06-08 00:00 CEST
- Для чего: дать UI зрелый фасад поверх сложного FSM без изменения runtime semantics. Изменение: `LLMStatusContract` получил `deriveResultMeta()`, который сводит model/run status к фазам `pending`, `success`, `partial`, `error` с label/status/execution/answer metadata. Файл: `shared/status-contract.js`.
- Для чего: показывать ResultMeta на status indicator как UI-only слой. Изменение: `results.js` теперь добавляет `data-result-phase`, `data-result-label`, class `result-phase-*` и tooltip `Result: ...`, не меняя исходный `currentStatus` и rank-logic. Файл: `results.js`.

### 2026-06-08 00:00 CEST
- Для чего: раньше уходить в fallback при явно сломанном selector profile. Изменение: `SelectorResolverV2` читает `selector_health_profile_v1`; при `broken` для роли пропускает exact/cache path и сразу переходит к semantic/spatial fallback, записывая `selectorProfileStatus`, `exactSkipped`, `cacheSkipped` в diagnostics. Файл: `content-utils/selector-resolver-v2.js`.

### 2026-06-08 00:00 CEST
- Для чего: централизовать только runtime-significant model quirks без превращения policy в энциклопедию моделей. Изменение: добавлен `shared/model-policy.js` с полями `stableTextMs`, `terminalFailureRequiresEvidenceMiss`, `extractionPriority`, `requireAckReady`, `transportErrorsRecoverable`, `conservativeDispatch`, `promptSubmitTimeoutMs`. Файл: `shared/model-policy.js`.
- Для чего: убрать hardcoded dispatch quirks из отдельных веток. Изменение: `dispatch-coordinator` теперь берёт prompt submit timeout, conservative backoff/connection delays и ACK_READY requirement из `ModelPolicy` с fallback на старые constants. Файл: `background/dispatch-coordinator.js`.
- Для чего: подключить policy в MV3 service worker runtime. Изменение: `background/index.js` загружает `shared/model-policy.js` после status/model state contracts. Файл: `background/index.js`.

### 2026-06-08 00:00 CEST
- Для чего: отделить page-ready/composer-ready от старого бинарного `requiresFocus`, чтобы не отправлять prompt в заведомо неподходящую страницу. Изменение: добавлен `normalizePageReadyState()` с поддержкой `status`, `pageReady`, `composerReady`, `blockers`, legacy `requiresFocus`; старые content responses остаются совместимыми. Файл: `background/dispatch-coordinator.js`.
- Для чего: сделать PageReadyState behavioral gate перед фактическим `GET_ANSWER`. Изменение: dispatch теперь пишет `PAGE_READY_STATE`, а при `login_required`, `captcha_required`, `wrong_page`, `page_not_ready`, `composer_missing/composer_not_ready` останавливает отправку, пишет `PAGE_READY_BLOCKED`, diagnostic и schedule retry. Файл: `background/dispatch-coordinator.js`.

### 2026-06-08 00:00 CEST
- Для чего: завершить существующий TabLease до полноценного arbitration layer без переписывания human-presence runtime. Изменение: `startTabVisit()` теперь выдаёт lease с `leaseKey`, `leaseOwner`, `leaseExpiresAt`, `leaseTtlMs`, не позволяет competing human/automation visit перехватить активную вкладку до TTL, но разрешает явный `user_focus` preemption и terminal cleanup. Файл: `background/human-presence.js`.
- Для чего: не оставлять зависший lease бесконечно. Изменение: expired lease логируется как `LEASE_EXPIRED`, затем освобождается через обычный `LEASE_RELEASED`; denied competing requests логируются как `LEASE_DENIED` с owner/active lease metadata и diagnostic event. Файл: `background/human-presence.js`.

### 2026-06-08 00:00 CEST
- Для чего: сделать результат pre-terminal materialization переносимым контрактом, а не набором разрозненных полей. Изменение: `EvidenceSummary` теперь содержит `valid`, `source`, `reason`, `answerHash`, `dedupeKey`, `dispatchId`, `sourceRunId`, `extractedAt`, `answerLength`, `answerHtmlLength` и используется в telemetry/materialization paths. Файл: `background/job-orchestrator.js`.
- Для чего: ограничить recovery paths детерминированным budget вместо неявных повторов. Изменение: добавлен per-dispatch recovery budget для `snapshot`, `inlineDom`, `manualPing`, `controlledVisit` с telemetry `RECOVERY_BUDGET_CONSUMED`/`RECOVERY_BUDGET_EXHAUSTED`; pre-terminal materialization, DOM snapshot recovery, forced visit и manual ping теперь проходят через общий budget gate. Файл: `background/job-orchestrator.js`.
- Для чего: не терять recovery budget при storage compaction/service-worker lifecycle. Изменение: `compactJobStateForStorage()` сохраняет `recoveryBudgets` в model entry. Файл: `shared/pipeline-fsm.js`.

### 2026-06-07 00:00 CEST — Model Favorites Sync
- Для чего: добавить selection-toolbar на страницах моделей, открытых расширением, и унифицировать его с Pipeline-баром. Изменение: в `content-scripts/model-selection-toolbar.js` добавлен общий floating toolbar для assistant-response selection с действиями `hiliteColor`, `bold`, `italic` и `Favourite`; toolbar включён в `manifest.json` для всех model-page content scripts.
- Для чего: отправлять выделенный фрагмент из model-page в общую систему избранного. Изменение: кнопка `Favourite` сохраняет fragment в `chrome.storage.local` под ключом `llmComparatorFavoriteEntries`, включая `text`, `html`, `sourceName`, `timeLabel` и `kind=fragment`, а `results.js` подхватывает эти записи и рендерит их в главной панели Favourite.
- Для чего: сделать избранное на главной странице общим хранилищем для целых ответов и фрагментов. Изменение: `results.js` теперь загружает favorites из storage при старте, слушает `chrome.storage.onChanged`, синхронизирует `favoriteState` и объединяет записи в общие группы по модели/источнику.
- Для чего: гарантировать, что фрагменты из main-page card и model-page selection попадают в одну модельную entry. Изменение: введён канонический `modelKey` в payload favorites, и `results.js` группирует `Favourite` по `modelKey`, а не по `sourceOutputId`, поэтому оба канала записи складываются в один общий блок модели.
- Для чего: экспортировать Favourite без управляющих элементов и в том же HTML-формате, что и другие ответы. Изменение: экспорт Favourite теперь строится из состояния favourites, а не из текущего DOM, поэтому крестики удаления не попадают в HTML-файл; итоговая разметка использует тот же response-export шаблон с секциями и body-blocks, что и стандартный экспорт ответов.
- Для чего: держать новые favorite items внизу списка, а не вверху. Изменение: новые записи избранного теперь добавляются в конец `favoriteState.entries` и в storage append-order, поэтому внутри `favorite-entry` последняя добавленная запись оказывается последней строкой внизу списка.
- Для чего: очищать transient UI state на каждой перезагрузке страницы. Изменение: `Favourite` больше не восстанавливается из `chrome.storage.local` при bootstrap и очищается на load; выбранные query modifiers тоже сбрасываются при старте страницы и больше не подхватываются из сохранённого selection storage.
- Для чего: убрать скрытое восстановление модификаторов через defaultSelected на bootstrap. Изменение: `loadModifiers()` больше не подставляет `defaultSelected` при старте страницы, поэтому после refresh все query modifiers начинаются в пустом состоянии и не переустанавливаются обратно в storage.
- Для чего: исправить регрессию после добавления bootstrap-reset для modifiers. Изменение: `loadModifiers()` теперь принимает `restoreSelections` явно, так что стартовый сброс и обычная работа preset-ов не конфликтуют и не вызывают ошибок при загрузке.
- Для чего: гарантированно чистить весь selection storage модификаторов на старте, а не только текущий preset. Изменение: при bootstrap теперь удаляются `llmComparatorSelected`, `llmComparatorSelectedByPreset` и `llmComparatorSelectedByPresetPipeline`, так что refresh/extension reload не восстанавливает ни один сохранённый набор query modifiers.
- Для чего: убрать восстановление выбранных модификаторов именно на initial page load. Изменение: стартовый `loadModifierPresets()` теперь вызывает `loadModifiers(..., { restoreSelections: false })`, поэтому refresh не подхватывает даже пустой selection state из storage и UI стартует с полностью чистым состоянием.
- Для чего: гарантировать, что selection storage модификаторов реально очищается на bootstrap, а не только в отложенном callback. Изменение: `clearModifierSelectionsOnLoad()` вызывается сразу при инициализации и перед `loadModifiers()`, поэтому refresh и reload расширения удаляют все сохранённые query modifiers до восстановления UI.
- Для чего: перевести главную страницу на нижний layout-триггер для Tuning Console и LLM Stream. Изменение: иконки управления вынесены в нижнюю строку `prompt-footer-actions`, обе секции стартуют скрытыми, Tuning Console раскрывается по клику на иконку, а LLM Stream открывается по клику и автоматически при отправке запроса.
- Для чего: убрать TDZ-регрессию в обработчике синхронизации модификаторов. Изменение: `getApprovedSenderModels()` больше не зависит от раннего lexical `debateModelCards` и берёт контейнер напрямую через `document.getElementById()`, чтобы `llm-selection-change` не падал до полной инициализации debate UI.
- Для чего: сохранить форматирование при повторной перекраске и при добавлении в избранное. Изменение: в response-selection логике удалён конфликтующий `background-color` внутри уже подсвеченных фрагментов, а при добавлении fragment в Favourite HTML-разметка сохраняется вместе с текстом, чтобы highlight не терялся.
- Для чего: сузить editable-surface в Favourite до одной строки редактирования. Изменение: `favorite-item-body` стал единственной редактируемой частью favorite item; запись синхронизируется обратно в storage после редактирования, а remove-действие остаётся отдельной кнопкой.
- Для чего: синхронизировать текущую рабочую версию с расширением. Изменение: `manifest.json` получил подключение нового content script `content-scripts/model-selection-toolbar.js`.

### 2026-06-05 00:00 CEST
- Для чего: отделить тип terminal status от причины сбоя. Изменение: добавлены `classifyFailure()` и `deriveFailureFinalStatus()`, которые присваивают ошибкам классы `transport`, `lease_lifecycle`, `page_readiness`, `dispatch`, `generation`, `extraction`, `semantic`, сохраняя совместимость с существующими статусами `NO_SEND`, `EXTRACT_FAILED`, `STREAM_TIMEOUT`, `ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: transport/channel errors больше не выглядят как semantic/extraction failure в диагностике. Изменение: `handleLLMResponse()` теперь записывает `failureClass`, `failureRecoveryFirst` и `terminalRequiresEvidenceMiss` в logs, partial metadata, responseMeta, finalization evidence и DispatchCircuit payload. Файл: `background/job-orchestrator.js`.

### 2026-06-04 18:30 CEST
- Для чего: перевести предтерминальное восстановление из набора частных recovery-веток в детерминированный gate перед terminal failure. Изменение: добавлен `materializeLatestAnswerEvidence()`, который валидирует evidence по rule-based признакам и проверяет preserved answer, snapshot cache, live/inline late collect перед фиксацией ошибки. Файл: `background/job-orchestrator.js`.
- Для чего: не терять ответы Qwen/похожих моделей, появляющиеся сразу после первого recovery miss. Изменение: pre-terminal materialization получил короткий повторный сбор для моделей с задержанным DOM/update path и теперь пишет telemetry `MATERIALIZE_EVIDENCE_*` с `evidenceSource`, `evidenceLen`, `evidenceHash`, `rejectReason`. Файл: `background/job-orchestrator.js`.
- Для чего: позволить позднему валидному recovered success заменить recoverable terminal failure, а не отбрасывать его как `duplicate_final`. Изменение: `PipelineFSM.shouldAcceptEvent()` принимает контролируемый `allowRecoveredFinal` только для перехода с failure final на success final того же dispatch. Файлы: `shared/pipeline-fsm.js`, `background/job-orchestrator.js`.

### 2026-06-03 07:16 CEST
- Для чего: сделать Pipeline FSM реальным источником истины для pipeline-level state transitions. Изменение: добавлен `PipelineFSM.transition(...)` и `PipelineFSM.completeRun(...)`, а `PIPELINE_FSM_EVENT` в background теперь проходит через transition вместо прямого вызова model-level `markFinal`.
- Для чего: закрыть bypass для cancelled run. Изменение: `PipelineFSM.markFinal(...)` теперь отказывает в переходе, если текущий control state уже `CANCELLED`, `STOPPED` или `FAILED`; cancelled pipeline не может вернуться в `COMPLETED`.
- Для чего: переживать restart service worker даже если full `jobState` не был восстановлен. Изменение: `loadJobState()` теперь восстанавливает минимальный pipeline control snapshot из `chrome.storage.session`, если `jobState` отсутствует.
- Для чего: не хранить большие runtime payloads без политики. Изменение: `DEFAULT_LIMITS` расширен `maxPayloadBytes`, `maxSnapshotsPerModel`, `maxRoundsRetained`, `maxAgeMs`, `dropPartialAfterFinal`, `dropPayloadAfterExport`; `compactJobStateForStorage()` теперь режет payload/log/history/snapshot хвосты по явным retention rules.
- Для чего: убрать bridge token из page-readable DOM/URL. Изменение: `content-bootstrap.js` теперь инжектит main-world bridge как inline script из fetched source, `content-bridge.js` использует token placeholder, а `content-utils.js` хранит bridge token только в isolated-world state.

### 2026-06-03 07:16 CEST
- Для чего: ввести Pipeline FSM для MV3 lifecycle. Изменение: добавлен `shared/pipeline-fsm.js` со state machine для `STARTING`, `DISPATCHING`, `AWAITING_APPROVAL`, `AWAITING_FINAL`, `COMPLETED`, `CANCELLED`, `FAILED`, `STOPPED`, а background и results теперь публикуют и восстанавливают контрольное состояние через FSM.
- Для чего: переживать restart service worker между approve/dispatch/final. Изменение: critical control state (`pipelineRunId`, `pipelineState`, `dispatchId`, tab/session scope) сохраняется в `chrome.storage.session`, а `jobState` при сохранении компактуется вместо хранения неограниченных payload.
- Для чего: сделать cancel scoped по конкретному run. Изменение: `CANCEL_PIPELINE_RUN` теперь сравнивает `pipelineRunId` и игнорирует stale cancel/late final для другого запуска.
- Для чего: не принимать дубли финалов и поздние ответы после retry/cancel. Изменение: `shouldAcceptEvent()` отсекает duplicate final, stale tab/session и late final для cancelled run.
- Для чего: защитить web-UI automation bridge от fake `CustomEvent`. Изменение: `content-bootstrap.js` внедряет bridge token, `content-bridge.js` принимает только trusted events с валидным token/source, а content scripts прокидывают token в bridge-вызовы.

### 2026-06-03 06:05 CEST
- Для чего: убрать дополнительную строку для `Show more`. Изменение: кнопка переведена в overlay-режим `position: absolute` и размещается у нижнего края карточки, а не под текстом.
- Для чего: сделать toggle collapse по dblclick на имени модели. Изменение: повторный dblclick по `.debate-model-card-name` теперь переключает `is-expanded` обратно в `false`, то есть сворачивает карточку до 5 строк.

### 2026-06-03 00:24 CEST
- Для чего: добавить управляемое раскрытие длинных ответов. Изменение: добавлены `Show more`, `is-expanded`, `syncDebateCardOutputLayout()` и раскрытие по клику `Show more` или двойному клику по `.debate-model-card-name`.

### 2026-06-03 00:12 CEST
- Для чего: восстановить работу color/bold/italic в floating toolbar. Изменение: общий `document mouseup` больше не вызывает `hideDebateSelectionToolbar()` для событий внутри `#debateSelTb`, поэтому сохранённый selection range не сбрасывается перед `click`.

### 2026-06-03 00:10 CEST
- Для чего: перевести floating toolbar выделения в светлую тему. Изменение: `.debate-sel-toolbar` получил белый фон, светлые кнопки, мягкую границу и менее тяжёлую тень.
- Для чего: сделать выбор цвета понятным визуально. Изменение: цветовые кнопки теперь залиты образцом цвета целиком через `--swatch-color`, а не отображаются тонкими полосками.

### 2026-06-03 00:06 CEST
- Для чего: сделать пункты toolbar видимыми без угадывания. Изменение: цветовые кнопки стали тонкими горизонтальными полосками, а `Bold`, `Italic`, `Favorite` получили явные CSS-иконки `B`, `I`, `★`.
- Для чего: сохранить доступные подписи. Изменение: текстовые `.stb-label` оставлены в HTML, но визуально скрыты CSS вместо пустых невидимых зон.

### 2026-06-02 23:49 CEST
- Для чего: исправить отправку Pipeline в модели, которых пользователь не выбирал. Изменение: R1 Pipeline синхронизируется с верхним списком выбранных LLM перед запуском, пока R1 не был явно изменён вручную или загруженным pipeline config.
- Для чего: сохранить ручную настройку Pipeline. Изменение: добавлен dirty-флаг для `#r1-models`; ручные изменения R1 не перезаписываются верхним выбором.

### 2026-06-02 23:37 CEST
- Для чего: убрать визуальную метку pending-зоны. Изменение: удалён CSS `.debate-model-card.first-pending-zone-card::before` и текст `На утверждение`; runtime больше не добавляет `first-pending-zone-card`.
- Для чего: убрать статус-индикатор из moderator header. Изменение: из `pipeline_panel.html` удалён `#mod-status-indicator` внутри `.msg-header`.

### 2026-06-02 23:35 CEST
- Для чего: исправить регрессию approval reorder в Pipeline Debate. Изменение: `insertDebateCard(card, { zone: 'approved' })` снова учитывает `zone` и переносит approved-карточку перед первой pending-карточкой текущей session.

### 2026-06-02 23:01 CEST
- Для чего: выполнить P2.1 без полного risky split `results.js`. Изменение: добавлен `pipeline/pipeline-runtime.js` с model registry, render helpers, output helpers, stack capture и runtime snapshot helpers; `results.js` теперь делегирует Pipeline rendering/snapshot helpers этому модулю.
- Для чего: выполнить P2.2 и убрать hard-coded Pipeline model blocks из HTML. Изменение: `pipeline_panel.html` и `result_new.html` теперь содержат только mount points `#r1-models`, `#r2-models`, `#output-stack` с `data-render`, а карточки моделей/output blocks рендерятся из state в `pipeline-runtime.js`.
- Для чего: обеспечить загрузку нового runtime. Изменение: оба HTML entrypoints подключают `pipeline/pipeline-runtime.js` перед `results.js`, а `manifest.json` добавляет файл в `web_accessible_resources`.

### 2026-06-02 22:42 CEST
- Для чего: сделать Pipeline UI источником правды для R1. Изменение: запуск строит runtime snapshot из `r1-models` и больше не подменяет первый раунд выбранными top/debate models.
- Для чего: заморозить конфигурацию на старте run. Изменение: `buildPipelineRuntimeSnapshot()` читает rounds/output один раз, сохраняет model names/input/send/role и использует этот snapshot до конца запуска.
- Для чего: убрать хрупкую зависимость output selection от текста label. Изменение: `pipeline_panel.html` получил `data-output="notes|export|exportHtml"`, а `getPipelineOutputSelection()` читает machine keys с fallback на legacy labels.
- Для чего: уйти от hard-coded `r === 1` в execution flow. Изменение: runtime rounds получают `stage: models|judge`, а loop выбирает ветку по `roundState.stage`.
- Для чего: санитизировать Pipeline HTML export. Изменение: `safePipelineMarkdownToHtml()` удаляет опасные HTML/protocol tokens, экранирует model text, конвертирует markdown и пропускает результат через sanitizer.
- Для чего: убрать global approval escape hatch. Изменение: `resolveDebateApprovalGlobal` заменён на state-object `debateApprovalBridge`.

### 2026-06-02 17:47 CEST
- Для чего: стабилизировать lifecycle Pipeline run. Изменение: `pipelineWaiter` теперь хранит pending-state по `pipelineRunId`, `pipelineRoundId`, `pipelineBatchId`, optional `dispatchId` и игнорирует ответы не из текущего batch.
- Для чего: не запускать следующие раунды на первом chunk. Изменение: `LLM_PARTIAL_RESPONSE` обновляет preview, но закрывает waiter только при terminal metadata (`SUCCESS`, `COPY_SUCCESS`, `ERROR`, `STREAM_TIMEOUT`, etc.) или explicit final message.
- Для чего: убрать зависание manual approval. Изменение: `waitForDebateApproval()` получил abort/timeout cleanup и больше не оставляет висящий resolver после cancel/error.
- Для чего: добавить явную отмену Pipeline. Изменение: активный run получает `AbortController`; кнопка Pause во время run работает как `Cancel`, чистит waiter/approval и отправляет `CANCEL_PIPELINE_RUN` в background, где он проходит через существующий `stopAllProcesses()`.

### 2026-06-02 15:28 CEST
- Для чего: добавить скрытую поисковую метку для сторонних разработчиков. Изменение: в `pipeline_panel.html` добавлены невидимые для пользователя `<!-- LLM Discus -->` и `<meta name="keywords" content="LLM Discus">` в `<head>`.

### 2026-06-02 15:17 CEST
- Для чего: добавить управление текущей session через `-` рядом с `+`. Изменение: `#debate-session-delete-btn` удаляет активную session при наличии нескольких sessions; если session одна, она не удаляется, а очищается и остаётся активной.
- Для чего: держать кнопки управления sessions визуально пустыми. Изменение: `#debate-session-add-btn` и `#debate-session-delete-btn` получили прямой transparent/no-border override и выключенные hover/active фоновые эффекты.

### 2026-06-02 09:08 CEST
- Для чего: исправить неработающий CSS override для `#debate-session-add-btn`. Изменение: селектор был уточнён до прямого `#debate-session-add-btn`, потому что кнопка находится в `.debate-session-left`, а не в `.debate-session-actions`; сняты border/background/box-shadow и hover/active на самой кнопке.

### 2026-06-02 09:05 CEST
- Для чего: полностью убрать border/background у `#debate-session-add-btn`. Изменение: добавлен точечный override `border: none`, `background: transparent`, `box-shadow: none` и снят hover/active visual state для этой кнопки.

### 2026-06-02 09:02 CEST
- Для чего: убрать у `#debate-session-add-btn` лишние фон и рамку. Изменение: добавлен точечный override `background: transparent` и `box-shadow: none` для кнопки добавления session.

### 2026-06-02 09:02 CEST
- Для чего: убрать отдельные fragment-card из обычной Pipeline-ленты. Изменение: `shouldShowDebateCard()` теперь скрывает `kind=fragment` при `favoriteOnly=false`; saved fragments остаются в session timeline/store и показываются только в favorite-view/export текущего режима.
- Для чего: сделать выделение в обычной ленте реальным форматированием исходной карточки. Изменение: toolbar больше не полагается на `document.execCommand`; выделение оборачивается через сохранённый `Range` в `span` с `backgroundColor`, `strong` или `em`, затем source message синхронизируется с обновлённым HTML.
- Для чего: не терять текст выделения при клике по toolbar. Изменение: favorite fragment берёт текст из сохранённого `debateSelectionState.range`, а не только из текущего `window.getSelection()`.

### 2026-06-02 08:51 CEST
- Для чего: исправить неработающий double-click по `.debate-session-tab` в Pipeline favorite-view. Изменение: single-click теперь выполняется с короткой задержкой и отменяется при `dblclick`, поэтому первый click больше не перерисовывает tab до обработки double-click; обычный click возвращает session в полный timeline.
- Для чего: сделать toolbar выделенного текста понятным без угадывания иконок. Изменение: кнопки highlight/bold/italic/favorite получили видимые подписи и `aria-label`, добавлены стили `.debate-sel-toolbar .stb/.stb-label`.

### 2026-06-01 23:52 CEST
- Для чего: убрать рассинхрон `Favorites` между DOM-флагами и внутренним состоянием. Изменение: введён единый state-layer на `entryId` (`debateMessageStore` + `debateDomIndex`), `ensureDebateCardMessage()` теперь нормализует карточку в store и обратно в DOM.
- Для чего: стабилизировать показ карточек в favorite-only режиме. Изменение: добавлен `shouldShowDebateCard()`; `getVisibleDebateCards()` и фильтрация используют единое условие.
- Для чего: исключить конфликт `messageId`/`entryId`. Изменение: синхронизация карточки теперь всегда выставляет оба атрибута на единый id; удаление карточки очищает store по `entryId`.

### 2026-06-01 23:16 CEST
- Для чего: перевести Pipeline favorite-view с набора DOM-флагов на явный lifecycle сообщений. Изменение: session теперь имеет `messages`, карточки получают `data-message-id`, добавлены `ensureDebateCardMessage()`, `patchDebateCardMessage()`, `removeDebateCardMessage()` и `getVisibleDebateCards()`.
- Для чего: сделать избранное устойчивым при approval, session-filter, fragment и delete. Изменение: `approval`, `favorite`, fragment creation, clear/delete и filter синхронизируют DOM-карточку с message-store.
- Для чего: показать режим избранного на табе. Изменение: double-click по `.debate-session-tab` обновляет `.favorite-only`, для таба добавлен визуальный маркер `★`.

### 2026-06-01 22:55 CEST
- Для чего: убрать лишний заголовок approved-зоны в Pipeline. Изменение: удалён `content: "Утверждённые"` для `.debate-model-card.first-approved-zone-card::before`.
- Для чего: вернуть порядок заголовка карточки к `Model time`. Изменение: `normalizeDebateCardState()` переносит `.debate-model-card-time` после `.debate-model-card-name`, а не перед ним.

### 2026-06-01 22:41 CEST
- Для чего: убрать конкретное CSS-перебивание модератора. Изменение: `.debate-moderator-card .debate-model-card-name/.time` теперь явно `16px`, а output остаётся `11px`, как у ответов моделей.

### 2026-06-01 19:19 CEST
- Для чего: убрать влияние глобального `.msg-time` (`9px`) на время в утверждённых карточках ответов. Изменение: в `approveDebateCard()` время больше не получает `msg-time`; добавляется отдельный класс `debate-inline-time`.

### 2026-06-01 19:08 CEST
- Для чего: в утверждённых карточках разместить время ответа слева от названия модели. Изменение: в `approveDebateCard()` элемент `.debate-model-card-time` получает класс `msg-time` и переносится в начало `.debate-model-card-title-main`.

### 2026-06-01 18:46 CEST
- Для чего: добавить время ответа рядом с названием модели в Pipeline HTML export, включая `Moderator`. Изменение: экспорт теперь строится через `pipelineExportCardParts()`, `pipelineExportHeading()` и выводит `<span class="response-time">HH:MM</span>` рядом с именем модели.
- Для чего: привести Pipeline export к формату LLM Stream export. Изменение: добавлен `pipelineExportDocument()` со стилями `section`, `h1/h2`, `.response-body`, `pre`, таблиц и списков по аналогии с рабочим экспортом LLM Stream.
- Для чего: очищать утверждённые ответы от live-status. Изменение: `approveDebateCard()` удаляет `.status-indicator` при переносе карточки в approved-зону.

### 2026-06-01 18:18 CEST
- Для чего: зарегистрировать Pipeline export handlers на уровне документа. Изменение: `#debate-session-export-btn` и `.debate-card-export` вынесены из `DOMContentLoaded` в top-level delegated handlers внутри guard `__RESULTS_PAGE_LOADED`.
- Для чего: убрать зависимость Pipeline export от scoped-функций внутреннего init-блока. Изменение: добавлены top-level helpers `pipelineExportCollectFeedHtml()`, `pipelineExportDownloadHtml()`, `pipelineExportStamp()`, `pipelineExportEscape()`; они работают напрямую через DOM и повторяют anchor-download flow рабочей главной страницы.

### 2026-06-01 17:58 CEST
- Для чего: убрать ещё одно отличие Pipeline export от рабочего экспорта главной страницы. Изменение: `#debate-session-export-btn` теперь обрабатывается через `document.addEventListener('click')` и `event.target.closest(...)`, как `#export-html-btn` и `.panel-export-html-btn`, вместо прямого listener на элемент.

### 2026-06-01 17:53 CEST
- Для чего: окончательно привести HTML-экспорт Pipeline к рабочему паттерну главной страницы. Изменение: экспорт сессии теперь прямо в `debateSessionExportBtn` создаёт `Blob`, `ObjectURL`, `a.download`, делает `click()` и `revokeObjectURL()` без промежуточного helper.
- Для чего: починить экспорт карточек Pipeline тем же способом, что `.panel-export-html-btn`. Изменение: добавлен document-level handler для `.debate-card-export`, который собирает `.debate-model-card-output` и выполняет локальный anchor-download; контейнерный handler больше не запускает отдельную export-логику.
- Для чего: убрать лишнюю сложность предыдущих попыток. Изменение: удалён неиспользуемый `triggerHtmlDownload()`, удалён background route `DOWNLOAD_HTML_EXPORT`, из `manifest.json` убрано permission `downloads`.

### 2026-06-01 17:48 CEST
- Для чего: восстановить HTML-экспорт Pipeline тем же способом, который уже работает на главной странице. Изменение: `triggerHtmlDownload()` упрощён до локального паттерна `Blob -> URL.createObjectURL -> a.download -> click -> revokeObjectURL`; удалена зависимость Pipeline export от background route, `chrome.downloads`, `showSaveFilePicker` и async `sendMessage`.
- Для чего: сделать failures видимыми. Изменение: `debateSessionExportBtn` и `debate-card-export` теперь вызывают `flashButtonFeedback(..., 'success'|'error')` после попытки экспорта.

### 2026-06-01 17:00 CEST
- Для чего: исправить причину, по которой HTML-экспорт Pipeline всё ещё не запускался. Изменение: `DOWNLOAD_HTML_EXPORT` вынесен в early route `background/message-router.js` до `NOTES_CMD` и до `ensureInitialState()`, чтобы download не зависел от готовности общего pipeline-state.
- Для чего: сделать вызов background-экспорта совместимым с callback-style Chrome APIs. Изменение: `triggerHtmlDownload()` больше не использует Promise-форму `chrome.runtime.sendMessage`, а оборачивает callback в `Promise` и проверяет `chrome.runtime.lastError`.

### 2026-06-01 16:43 CEST
- Для чего: исправить HTML-экспорт Pipeline через правильный extension-контекст. Изменение: добавлен background route `DOWNLOAD_HTML_EXPORT` в `background/message-router.js`, который выполняет `chrome.downloads.download()` из service worker; `triggerHtmlDownload()` в `results.js` теперь сначала отправляет HTML в background и только затем использует локальные fallback-механизмы.

### 2026-06-01 16:30 CEST
- Для чего: устранить системную причину неработающего HTML-экспорта в extension UI. Изменение: `triggerHtmlDownload()` теперь сначала использует `window.showSaveFilePicker()` с записью `Blob` напрямую, а уже потом откатывается к `chrome.downloads.download` и `<a download>`.

### 2026-06-01 16:28 CEST
- Для чего: системно восстановить экспорт HTML карточек и сессии в extension-контексте. Изменение: `triggerHtmlDownload()` переведён на `async` с приоритетом `chrome.downloads.download` и fallback на `<a download>`; обработчики `debateSessionExportBtn` и `debate-card-export` теперь `await` этот путь.
- Для чего: обеспечить доступ к API загрузок в MV3. Изменение: в `manifest.json` добавлено permission `downloads`.

### 2026-06-01 16:24 CEST
- Для чего: восстановить экспорт HTML карточки и сессии в Pipeline. Изменение: добавлен единый helper `triggerHtmlDownload()` и оба обработчика (`debate-card-export`, `debateSessionExportBtn`) переведены на него.
- Для чего: убрать `Moderator` и имена моделей из копирования сессии. Изменение: `collectDebateFeedText()` теперь копирует только текст ответов и пропускает карточки `kind=moderator`.
- Для чего: сделать `None` получателем по умолчанию при старте сессии. Изменение: `mod-receiver-select` получил `selected` на `__none__`, а `syncModeratorSelectors()` по умолчанию восстанавливает `__none__`.

### 2026-06-01 09:39 CEST
- Для чего: убрать лишний индикатор статуса из карточки модератора. Изменение: из HTML, создаваемого `appendModeratorFeedEntry()`, удалён `span.status-indicator`; индикаторы моделей не затронуты.

### 2026-06-01 09:34 CEST
- Для чего: при утверждении ответа переносить карточку из зоны `На утверждение` в конец зоны `Утверждённые`, а не оставлять её под pending-ответами. Изменение: `approveDebateCard()` теперь использует `insertDebateCard(..., { zone: 'approved' })`; порядок зон изменён на `Утверждённые` выше `На утверждение`, approved-карточка вставляется перед первой pending-карточкой текущей сессии.

### 2026-06-01 01:48 CEST
- Для чего: дать модератору возможность оставить комментарий в ленте без отправки моделям. Изменение: в `mod-receiver-select` добавлен получатель `None`; при выборе `None` `mod-send-btn` добавляет карточку `Moderator` в ленту, очищает composer и не отправляет `START_FULLPAGE_PROCESS`.

### 2026-06-01 01:40 CEST
- Для чего: очищать composer после отправки запроса модератора. Изменение: добавлен `clearModeratorComposer()`, который очищает `textarea#modTa` и `#mod-message-body` сразу после добавления карточки `Moderator` в ленту и создания карточек получателей, не дожидаясь завершения ответов моделей.

### 2026-06-01 01:33 CEST
- Для чего: не оставлять pending-дубли одной модели в зоне утверждения. Изменение: при отправке и обновлении ответа переиспользуется последняя неутверждённая карточка модели, включая уже существующие response-карточки без `live=true`.

### 2026-06-01 01:24 CEST
- Для чего: гарантировать, что первый запрос модератора стоит выше карточек моделей. Изменение: первая карточка `Moderator` в сессии вставляется перед первой существующей карточкой этой сессии, даже если в ленте уже были stale/pending карточки моделей.
- Для чего: остановить разбиение одного ответа на несколько карточек. Изменение: при отправке повторно используется существующая pending/live-карточка модели, а поздние UI-update события после финала обновляют последнюю неутверждённую карточку вместо создания новой.

### 2026-06-01 01:14 CEST
- Для чего: убрать дублирование prompt при отправке из `mod-send-btn`. Изменение: удалён второй `onclick`-handler, оставлен единый `addEventListener`, добавлен короткий debounce запуска pipeline на 500ms.
- Для чего: сохранить хронологию первого сообщения. Изменение: карточка `Moderator` больше не считается approved-ответом модели и остаётся перед pending-карточками получателей.

### 2026-06-01 01:04 CEST
- Для чего: разделить ленту на две зоны. Изменение: pending-карточки вставляются перед первой approved-карточкой, approved-карточка переносится вниз approved-зоны; для первых карточек зон добавлены метки `На утверждение` и `Утверждённые`.

### 2026-06-01 00:45 CEST
- Для чего: сделать первое сообщение сессии видимым в ленте. Изменение: при каждом запуске `mod-send-btn` текст модератора добавляется отдельной карточкой `Moderator` перед пустыми карточками получателей, поэтому первый запрос всегда становится первой записью debate-ленты.

### 2026-06-01 00:34 CEST
- Для чего: не плодить карточки на partial-ответах. Изменение: карточка ответа стала live-card: новые части ответа той же модели обновляют текущую карточку, во время генерации показывается `[Model] printing`, финальный статус убирает служебное сообщение.

### 2026-06-01 00:18 CEST
- Для чего: перенести утверждение ответов из зоны модератора в ленту. Изменение: блок `debate-approval` удалён из `pipeline_panel.html`; ответы для утверждения теперь выбираются чекбоксами внутри карточек ленты, а выбранные карточки при отправке фиксируются как approved и теряют чекбокс.
- Для чего: создавать пустые карточки только после отправки запроса выбранным получателям. Изменение: автосоздание карточек при выборе моделей в header отключено; `runPipeline` берёт получателей из `mod-receiver-select`/выбранных моделей и добавляет карточки внизу ленты на момент отправки.
- Для чего: добавить управление Auto в session bar. Изменение: добавлена кнопка pause/resume слева от копирования, она видима только при включённом `Auto`; кнопка добавления сессии перенесена сразу за последним tab.

### 2026-05-31 23:52 CEST
- Для чего: устранить реальный silent-fail `mod-send-btn` на Pipeline. Изменение: `debateActionSelect`, `debateModeSelect`, `debateLengthSelect` вынесены из локального блока `pipelinePanel` в общую область debate UI, потому что `syncModeratorMiniPrompts()` вызывалась снаружи и падала с `ReferenceError` до навешивания обработчиков кнопки отправки.
- Для чего: исправить чтение текста модератора. Изменение: `buildDebateModeratorDispatchText()` теперь читает текст не только из `textarea#modTa`, но и из `#mod-message-body` как fallback-источника.
- Для чего: сделать следующий сбой диагностируемым. Изменение: добавлены короткие console-сообщения для клика по запуску, пустого moderator prompt и отсутствующих выбранных top-моделей.

### 2026-05-31 23:38 CEST
- Для чего: устранить silent-fail при нажатии `mod-send-btn`. Изменение: `runPipeline` дополнительно экспортирован в `window`, а на `#mod-send-btn` добавлен прямой `onclick`-handler (с `preventDefault/stopPropagation`) в дополнение к `addEventListener`, чтобы запуск происходил гарантированно.
- Для чего: закрепить отображение роли прямо справа от модели в `debate-model-card-header`. Изменение: `debate-model-card-title-main` выровнен в одну строку по центру, а `updateCardRole()` нормализует текст роли (`trim`), чтобы badge корректно появлялся рядом с названием.
- Для чего: сделать иконку `branch` видимой в текущем UI. Изменение: для `debate-card-branch` добавлен явный символ-фолбэк `⎇` (как визуальный аналог из прототипа), чтобы кнопка не пропадала даже при проблемах с icon-font.

### 2026-05-31 23:29 CEST
- Для чего: вернуть рабочую отправку через `mod-send-btn`. Изменение: исправлены сломанные закрывающие скобки в блоке `devtoolsTabs`/`setActiveDevtoolsTab` в `results.js`; после этого скрипт снова корректно выполняется, и Pipeline стартует.
- Для чего: привести `branch` к виду из прототипа. Изменение: для `debate-card-branch` закреплён иконный стиль `ti-git-branch` компактного формата в `debate-model-card-header`.

### 2026-05-31 13:20 CEST
- Для чего: перенести actions карточки в header. Изменение: иконки `branch`, `⧉`, `⬆`, `🗑️` перенесены в `debate-model-card-meta` между временем ответа и `favorite`; нижний footer-ряд карточки удалён.

### 2026-05-31 13:12 CEST
- Для чего: привести header карточек ленты к прототипу. Изменение: роль ответа перенесена в отдельный badge под именем модели (`debate-model-card-title-main` + `debate-model-card-role`) и обновлена структура карточек.
- Для чего: добавить нижнюю панель действий карточки ответа. Изменение: в каждую карточку ленты добавлены иконки `branch`, `⧉`, `⬆`, `🗑️`; подключены обработчики: branch → перенос текста в модераторский input, copy/export/delete для карточки.

### 2026-05-31 12:56 CEST
- Для чего: сделать `.prompt-sandwich .moderator-input` визуально единой зоной. Изменение: у `debate-approval-body` и `textarea#modTa` убраны внутренние рамки/фоны/скругления; разделение внутри блока оставлено только через подпись `Moderator`.

### 2026-05-31 12:48 CEST
- Для чего: убрать `Moderator` из выбора модели-отправителя. Изменение: placeholder в `mod-sender-select` заменён на `Sender`, а динамическое заполнение в `syncModeratorSelectors()` больше не добавляет `Moderator` в список.
- Для чего: привести иконку избранного к требуемым состояниям. Изменение: у `.debate-fav` неактивное состояние теперь только контурное без фона, активное состояние — цвет `#1f3b4c` (контур и символ), без фоновой заливки.
- Для чего: унифицировать кнопку отправки в модерации с главной кнопкой отправки. Изменение: `#mod-send-btn` переведена на круглую тёмную кнопку с треугольным маркером через `::before`, с тем же поведением `active`, как у основной `send-button`.

### 2026-05-31 12:20 CEST
- Для чего: сделать `moderator-input` визуально единой зоной и выровнять разделитель `Moderator`. Изменение: убраны внутренние разделительные бордеры/карточность, `debate-approval` интегрирован в общий блок, `mod-divider-label` выровнен по левой оси заголовка зоны утверждения.

### 2026-05-31 12:12 CEST
- Для чего: привести иконку `Favorite` к стилю action-кнопок главной страницы. Изменение: `.debate-fav` получила единый button-style (геометрия, hover/active), а `active`-состояние сохранено акцентным цветом.

### 2026-05-31 12:05 CEST
- Для чего: привести debate-кнопки к стилю главной страницы. Изменение: `mod-send-btn`, кнопки в `debate-session-actions`, иконки `msg-head-right`, а также `mod-select` получили ту же визуальную логику, что и основные элементы интерфейса.

### 2026-05-31 11:55 CEST
- Для чего: убрать отдельный `Approve`-шаг и сделать `mod-send-btn` единственной точкой отправки. Изменение: если заполнены обе зоны, в prompt отправляется блок `ModelName + response` и блок `Moderator + message`; если заполнена только одна зона, отправляется только она.

### 2026-05-31 11:50 CEST
- Для чего: сделать approval-зону постоянно видимой. Изменение: `debate-approval` больше не скрывается по умолчанию, а `setDebateApprovalCandidate()` показывает waiting-state вместо `hidden`.

### 2026-05-31 11:45 CEST
- Для чего: исправить порядок approval-блока. Изменение: `debate-approval` перенесён ниже `msg-header` и выше `mod-divider-label`, чтобы approved response отображался в нужной зоне.

### 2026-05-31 11:40 CEST
- Для чего: удалить лишнее поле `prompt-input` из Debate layout и сохранить работу запуска на одном вводе. Изменение: `prompt-input` убран из `pipeline_panel.html`, а `results.js` перепривязан к `modTa` как к источнику текста для запуска.

### 2026-05-31 11:20 CEST
- Для чего: восстановить видимость debate feed и approval flow в нужном порядке. Изменение: `debate-model-cards` теперь гарантированно перерисовывается на `llm-selection-change`, а `debate-approval` перенесён сразу под `msg-header` внутри `moderator-input`.

### 2026-05-31 11:05 CEST
- Для чего: привести Debate layout к требуемому порядку блоков. Изменение: `msg-header` возвращён внутрь `moderator-input`, лента сообщений оставлена между `debate-session-bar` и блоком модерации, а порядок секций зафиксирован в `styles.css` через `order` так, чтобы сверху шла лента, снизу модераторский блок.

### 2026-05-31 10:40 CEST
- Для чего: синхронизировать документацию с последними изменениями Pipeline Debate UI. Изменение: обновлены `pipeline_panel.html` и `results.js` под структуру ленты сверху, moderator-input снизу, сессионные табы, approval flow и карточки ответов.

### 2026-05-31 09:45 CEST — Pipeline Debate Integration
- Для чего: заменить управление в зоне `textarea` на debate-механику из макета. Изменение: добавлена новая панель `debate-controls` с контролами `Mode`, `Length`, `Action`, `Pause`, `Step`, `Start`; старые attach/export/send-кнопки в этой зоне выведены из основного сценария.
- Для чего: перенести запуск и модерацию с legacy-кнопок Pipeline на новые debate-кнопки. Изменение: в `results.js` добавлена связка `debate-start-btn -> runPipeline`, поддержка `Pause/Resume`, пошаговое подтверждение `Step/Approve` для manual-режима и auto-паузы, а также добавление `Mode/Length/Action` как модераторского суффикса к prompt.
- Для чего: оформить новый UI. Изменение: в `styles.css` добавлены стили `debate-controls`, `debate-select`, `debate-btn*`.

### 2026-05-30 12:24 CEST
- Для чего: исправить сценарий, где индикатор статуса уже становился зелёным, часть ответа сохранялась, но страница модели фактически продолжала генерацию и полный текст приходилось добирать повторным двойным кликом по статусу. Изменение: проверка активной генерации во вкладке теперь имеет приоритет над `manualRecovery`, `manualOverride`, `lateCollectFinal` и `forceTerminalSuccess`; если виден `Stop`/busy-сигнал, финализация откладывается, UI получает только partial update со статусом `GENERATING`, а background продолжает follow-up collect. Файл: `background/job-orchestrator.js`.
- Для чего: убрать преждевременный зелёный `SUCCESS` у моделей с долгим `busy=true` без видимой stop-кнопки. Изменение: `busy-only` больше не пробивает финализацию после короткого лимита; при достижении общего streaming-лимита ответ может быть зафиксирован только как `PARTIAL`/`streaming_incomplete`, а не как чистый success. Файл: `background/job-orchestrator.js`.

### 2026-05-30 10:56 CEST
- Для чего: восстановить ожидаемое поведение `New Pages = off`, когда запросы должны идти в последние уже открытые вкладки моделей, включая вкладки из прошлых сессий. Изменение: первичное подключение существующей вкладки теперь допускает global reuse через `allowGlobalReuse`, после чего выбранная вкладка привязывается к текущему run scope; scoped resolver при этом остаётся защищённым от чужих вкладок. Файлы: `background/job-orchestrator.js`, `background/tab-manager.js`.
- Для чего: снизить риск преждевременного terminal success от DOM-сигналов. Изменение: исчезновение stop-кнопки и стабильность текста 2 секунды теперь трактуются как completion evidence, а не как самостоятельное финальное решение. Файлы: `content-scripts/unified-answer-watcher.js`, `content-scripts/unified-answer-pipeline.js`.

### 2026-05-30 08:31 CEST
- Для чего: исправить сценарий из `All Logs 20260530_08-28.md`, где Qwen уже материализовал ответ в панели (`textLen=11632`), но stale lifecycle продолжал слать `ANSWER_GENERATING textLength=6067` и блокировал terminal success до `ANSWER_COMPLETE_TIMEOUT`. Изменение: `maybeDeferEarlyTerminalSuccess()` больше не требует `sameObservation`, если длинный ответ (`>= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS`) ждёт guard дольше `EARLY_TERMINAL_GUARD_MAX_WAIT_MS`; для коротких, но достаточных ответов добавлен extended wait `MAX_WAIT * 3`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать такие случаи видимыми в логах. Изменение: при принудительном выходе из guard после max wait добавлен log `Terminal success guard max wait elapsed` с длиной ответа, временем ожидания и причиной. Файл: `background/job-orchestrator.js`.

### 2026-05-30 07:45 CEST
- Для чего: сделать copy-button completion signal пригодным для диагностики hover/hidden toolbar. Изменение: классификация copy-кнопки теперь различает `present`, `visible`, `interactable`, `disabled` и сохраняет эти поля в `metrics.copyButton`/detector signal. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: не принимать copy-кнопку из пользовательского сообщения или неподтверждённого scope. Изменение: добавлен `isAssistantScope()` guard с явной/эвристической проверкой assistant/model/response scope и отклонением user-scope candidate. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: различать тип copy-кнопки без преждевременной финализации code-only/code-block сценариев. Изменение: `classifyCopyButton()` теперь возвращает `copyType: message_toolbar | answer_scope | code_block | rejected`; `code_block` логируется как найденный, но не считается валидным completion evidence. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: сделать сигнал видимым в общем telemetry export как отдельное событие. Изменение: добавлен dedupe-emitter `COPY_COMPLETION_SIGNAL` с `found/valid/present/visible/interactable/copyType/answerHash/rejectedReason`, без сохранения полного текста ответа. Файл: `content-scripts/unified-answer-watcher.js`.

### 2026-05-30 07:36 CEST
- Для чего: добавить более надёжный признак окончания генерации, когда модель показывает toolbar ответа после завершения стрима. Изменение: `UnifiedAnswerCompletionWatcher` теперь определяет видимую copy-кнопку рядом с последним assistant answer и учитывает её как `copyButtonVisible` criterion только при отсутствии stop-кнопки и стабильном тексте/fingerprint. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: не ловить ложные copy-сигналы от старых сообщений или кнопок копирования кода. Изменение: copy-кнопка ищется только в scope последнего ответа/близких контейнеров, disabled/hidden controls игнорируются, copy внутри `pre/code` не считается evidence завершения ответа. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: сделать новый сигнал диагностируемым в `All Logs` и result metrics. Изменение: `copyButtonVisible` добавлен в `UniversalCompletionCriteria`, scoring, detector snapshots, verbose criteria log, `completionSelectors`, `selectorAttempts` и `metrics.copyButton`. Файлы: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-watcher.js`.
- Для чего: дать watcher платформенные CSS-кандидаты copy-кнопки. Изменение: добавлены общие copy selectors в основной и fallback selector bundles. Файлы: `content-scripts/answer-pipeline-selectors.js`, `content-scripts/platform-selectors.js`.

### 2026-05-29 23:48 CEST
- Для чего: исправить сценарий из `All Logs 20260529_23-44.md`, где Gemini получил terminal `PARTIAL` с ответом, но статус-индикатор оставался жёлтым как будто генерация не завершена. Изменение: в results UI статусы `PARTIAL` и `STREAM_TIMEOUT_HIDDEN` теперь отображаются зелёным terminal-success индикатором, tooltip сохраняет уточнение о partial/timeout. Файл: `results.js`.
- Для чего: убрать ложный жёлтый статус, если панель ответа уже получила непустой текст, но UI-состояние застряло в `GENERATING/RECEIVING/RECOVERABLE_ERROR`. Изменение: `updateLLMPanelOutput()` теперь при валидном непустом ответе поднимает индикатор минимум до `PARTIAL`, если текущий статус ещё не success-like. Файл: `results.js`.

### 2026-05-29 21:53 CEST
- Для чего: исправить сценарий из `All Logs 20260529_21-48.md`, где Le Chat возвращал текст в панель, но оставался жёлтым и продолжал получать `getResponses`/human visits. Изменение: `content-lechat.js` теперь прокидывает `msg.meta` в `LLM_RESPONSE` при manual `getResponses`, поэтому background видит `manualRecovery/lateCollectFinal/forceTerminalSuccess` и может финализировать ответ вместо повторного streaming defer. Файл: `content-scripts/content-lechat.js`.
- Для чего: сделать ручной сбор Le Chat диагностируемым так же, как Grok/Qwen/DeepSeek. Изменение: manual `getResponses` у Le Chat теперь сразу подтверждает доставку `manual_refresh_dispatched`, а результат асинхронной extraction-операции сообщает отдельным `MANUAL_PING_RESULT` со статусом `success/unchanged/failed/aborted` и `pingId`. Файл: `content-scripts/content-lechat.js`.
- Для чего: остановить обращения к модели после terminal state, даже если terminal записан в FSM раньше legacy-проекции. Изменение: terminal guards в `dispatch-coordinator.js` теперь используют `ModelRunState.isTerminalRunState(entry)` наряду с legacy `status/finalStatus`. Файл: `background/dispatch-coordinator.js`.
- Для чего: не возвращать терминальную модель в ожидание из-за позднего `LLM_RESPONSE_READY` и не запускать лишний manual recovery при наличии cached answer. Изменение: `message-router.js` получил единый `isTerminalRouterEntry()`, который учитывает FSM terminal state. Файл: `background/message-router.js`.
- Для чего: синхронизировать summary/stalled-метрики run с FSM. Изменение: `job-orchestrator.js` использует FSM terminal state в `isTerminalEntry()` и при построении `stalledModels` в `RUN_SUMMARY`. Файл: `background/job-orchestrator.js`.

### 2026-05-29 00:11 CEST
- Для чего: исправить регрессию из `All Logs 20260529_00-08.md`, где планировщики могли продолжать считать модель незавершённой, если terminal state уже был зафиксирован в FSM, но legacy-поля ещё не были спроецированы. Изменение: `isFinalizedEntry()` теперь использует `ModelRunState.isTerminalRunState(entry)` как первый источник терминальности, а legacy `finalStatus/finalStatusRecorded` остаются fallback. Файл: `background/job-orchestrator.js`.
- Для чего: убрать зависание Le Chat/похожих моделей в `Finalization deferred (generation active)` при ложном `busy=true` без видимой кнопки Stop. Изменение: добавлен лимит `DEFER_STREAM_BUSY_ONLY_MAX_MS = 45000`; если уже есть пригодный текст ответа, `busyVisible=true` без `stopVisible` больше не откладывает финализацию до общего лимита 180 секунд. Файл: `background/job-orchestrator.js`.
- Для чего: сделать `All Logs` пригодным для анализа после terminal state. Изменение: прямые `POST_TERMINAL_NOISE` переходы больше не экспортируются как `MODEL_RUN_TRANSITION` по умолчанию; счётчик `postTerminalNoiseCount` продолжает обновляться внутри FSM. Файл: `background/state-manager.js`.
- Для чего: убрать ложные `STATE_DIVERGENCE_DETECTED`, возникавшие в нормальном порядке `transition -> legacy projection`. Изменение: divergence больше не проверяется сразу после каждого transition; проверка остаётся после projection или при явном `detectDivergence=true`. Файл: `background/state-manager.js`.

### 2026-05-29 00:01 CEST
- Для чего: исправить регрессию из `All Logs 20260528_23-56.md`, где `RECOVERABLE_ERROR` закрывал FSM как terminal failure и блокировал последующий валидный recovery-ответ (`ANSWER_CANDIDATE_ACCEPTED:terminal_blocks_candidate`). Изменение: `RECOVERABLE_ERROR` теперь остаётся failure-status, но исключён из terminal statuses в общем `StatusContract`. Файл: `shared/status-contract.js`.
- Для чего: не блокировать успешный answer candidate после recoverable/failure состояния. Изменение: `ModelRunState` ввёл `isFinalTerminalStatus()` и не считает `RECOVERABLE_ERROR` финальным terminal; success-кандидат может поднять состояние в `SUCCESS` без `terminal_blocks_candidate`. Файл: `shared/model-run-state.js`.
- Для чего: не ухудшать `All Logs` избыточной state telemetry. Изменение: `MODEL_RUN_TRANSITION` для `POST_TERMINAL_NOISE` теперь дедуплицируется по label/source в окне 10 секунд; счётчик `postTerminalNoiseCount` продолжает обновляться. Файл: `background/state-manager.js`.

### 2026-05-28 23:24 CEST
- Для чего: убрать риск расхождения классификации статусов между `status-contract.js` и `model-run-state.js`. Изменение: `ModelRunState` теперь использует `LLMStatusContract` как основной источник `SUCCESS_STATUSES`, `FAILURE_STATUSES`, `TERMINAL_STATUSES`, `normalizeStatus()` и `is*Status()`; локальный список оставлен только как fallback для автономного запуска. Файл: `shared/model-run-state.js`.
- Для чего: сократить прямые записи legacy-полей мимо FSM. Изменение: добавлен `projectModelRunStateToLegacy()` как единая projection-точка для `entry.status`, `entry.finalStatus`, `entry.finalStatusRecorded`, `entry.finalizedAt`, `answer/statusData/responseMeta` и связанных полей. Файл: `background/state-manager.js`.
- Для чего: перевести финальный commit ответа на порядок `transition -> legacy projection`. Изменение: финальная секция `handleLLMResponse()` теперь сначала коммитит `ANSWER_CANDIDATE_ACCEPTED`/`TERMINAL_FAILURE`, затем применяет legacy projection через `projectModelRunStateToLegacy()` вместо прямых `entry.status/finalStatus` записей. Файл: `background/job-orchestrator.js`.
- Для чего: централизовать stop/reset projection. Изменение: `stopAllProcesses()` больше не пишет `jobState.llms[llmName].status = 'STOPPED'` напрямую при наличии projection helper. Файл: `background/job-orchestrator.js`.

### 2026-05-28 22:43 CEST
- Для чего: сделать dual write / рассинхрон legacy-полей и `modelRunState` видимым в `All Logs`. Изменение: добавлен telemetry helper `commitModelRunTransition()`, который для каждого перехода пишет `MODEL_RUN_TRANSITION` с `previousState`, `nextState`, `legacyBefore`, `legacyAfter`, source и результатом применения. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`, `background/message-router.js`, `background/dispatch-coordinator.js`, `background/telemetry-logs.js`.
- Для чего: прямо фиксировать случаи, когда legacy `status/finalStatus` расходится с `modelRunState.uiStatus/terminalStatus`. Изменение: добавлен `detectModelStateDivergence()` и событие `STATE_DIVERGENCE_DETECTED` с legacy/modelRunState snapshot, причиной и source; повтор одинакового divergence дедуплицируется на 5 секунд. Файл: `background/state-manager.js`.
- Для чего: видеть места, где legacy-поля всё ещё коммитятся как projection после перехода state machine. Изменение: добавлен `emitStateProjectionCommitted()` и событие `STATE_PROJECTION_COMMITTED`; оно вызывается из `updateModelState()` и финальной projection-секции `handleLLMResponse()`. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`.
- Для чего: гарантировать попадание новой state telemetry в общий export-файл. Изменение: `MODEL_RUN_TRANSITION`, `STATE_DIVERGENCE_DETECTED`, `STATE_PROJECTION_COMMITTED` добавлены в pinned telemetry labels. Файл: `background/telemetry-logs.js`.

### 2026-05-28 22:16 CEST
- Для чего: заменить цепочку патчей вокруг жёлтых/ложных статусов единым источником истины. Изменение: добавлен `shared/model-run-state.js` с явной transition matrix для dispatch/generation/lifecycle/answer/terminal/post-terminal состояний модели. Файлы: `shared/model-run-state.js`, `background/index.js`.
- Для чего: отделить диагностические события от изменения состояния модели. Изменение: `LLM_RESPONSE_READY`, `ANSWER_COMPLETE_DETECTED` и post-terminal diagnostics теперь проходят через `ModelRunState`; после terminal success не могут вернуть модель в `RECEIVING/GENERATING`, а шум учитывается как `postTerminalNoiseCount`. Файлы: `background/message-router.js`, `background/dispatch-coordinator.js`, `background/telemetry-logs.js`.
- Для чего: сделать финализацию ответа не набором исключений, а candidate pipeline. Изменение: добавлены `buildAnswerCandidate()`, `evaluateAnswerCandidate()` и `submitAnswerCandidate()` поверх существующего `buildFinalizationEvidence()`; принятые/отклонённые кандидаты пишут переходы `ANSWER_CANDIDATE_ACCEPTED/REJECTED` или `TERMINAL_FAILURE`. Файл: `background/job-orchestrator.js`.
- Для чего: синхронизировать UI-индикаторы с фактическим terminal state. Изменение: `buildGlobalStateSnapshot()` теперь отдаёт `modelRunState`, `terminalState`, `generationState`, `runMetrics`, а results UI предпочитает `modelRunState.uiStatus` перед legacy `status`. Файлы: `background/ui-broadcast.js`, `results.js`.
- Для чего: остановить лишние human/automation visits после терминального состояния. Изменение: human-presence scheduler использует `ModelRunState.isTerminalRunState()` и успех из `modelRunState.terminalState`, а не только legacy-поля. Файл: `background/human-presence.js`.

### 2026-05-27 23:25 CEST
- Для чего: исправить сценарий из `All Logs 20260527_23-17.md`, где ответы уже финализированы как `SUCCESS`, но журнал продолжал показывать признаки активной генерации. Изменение: post-terminal фильтр диагностики теперь отбрасывает `ANSWER_GENERATING`, `answer: layer semantic`, stale `LATE_COLLECT_DECISION_TRACE`, `DOM_FALLBACK_START`, retry/waiting/getResponses и похожие шумовые события после успешного terminal status. Файл: `background/telemetry-logs.js`.
- Для чего: не возвращать финализированную модель в состояние ожидания готовности. Изменение: `LLM_RESPONSE_READY` теперь игнорируется для моделей с terminal status/finalStatusRecorded, вместо вызова `updateModelState(..., 'RECEIVING')`. Файл: `background/message-router.js`.

### 2026-05-27 20:57 CEST
- Для чего: исправить сценарий из `All Logs 20260527_19-39.md`, где `Get answers` успешно вытягивал текст ответа из DOM, но модель могла оставаться жёлтой и продолжать получать human/automation visits. Изменение: `acceptLateCollectResult()` теперь сохраняет входной `responseMeta`, распознаёт явный пользовательский late collect и передаёт `lateCollectFinal/forceTerminalSuccess` в финализацию. Файл: `background/job-orchestrator.js`.
- Для чего: не откладывать пользовательский recovery в `RECEIVING`, когда ответ уже явно собран из DOM. Изменение: streaming defer и early-terminal guard пропускаются для `forceTerminalSuccess`, `lateCollectFinal`, `manualRecovery` и `preTerminalMaterialize`, при этом passive recovery без таких флагов остаётся под защитой от раннего зелёного статуса. Файл: `background/job-orchestrator.js`.
- Для чего: сделать кнопку `Get answers` финальным сбором, а не только обновлением панели. Изменение: `collectResponsesStaged()` помечает свой late collect как `user_collect_late_collect` и terminal-final, чтобы успешный ответ синхронизировал UI-статус, `MODEL_FINAL` и остановку дальнейших визитов вкладки. Файл: `background/job-orchestrator.js`.

### 2026-05-26 16:09 CEST
- Для чего: восстановить работу кнопок выбора моделей в header на странице `pipeline_panel.html`. Изменение: добавлена защита от отсутствующего `#compare-button`, чтобы инициализация `results.js` не падала на pipeline-странице и обработчики `.llm-button` корректно навешивались. Файл: `results.js`.

### 2026-05-21 20:41 CEST
- Для чего: исправить сценарий из `All Logs 20260521_20-38.md`, где `Qwen` и `Le Chat` сначала находили ответ через recovery/отложенную финализацию, но затем принимали финальный `NO_SEND/ERROR`. Изменение: `buildFinalizationEvidence()` теперь учитывает `pendingFinalAnswer` как answer evidence и блокирует terminal failure при наличии любого answer evidence, включая pre-terminal recovery. Файл: `background/job-orchestrator.js`.
- Для чего: не терять текст, который был показан как `Terminal success deferred (await lifecycle)`. Изменение: early-terminal guard сохраняет `pendingFinalAnswer/pendingFinalAnswerHtml`, чтобы последующая ошибочная финализация могла быть заменена на `SUCCESS` по сохранённому ответу. Файл: `background/job-orchestrator.js`.
- Для чего: сделать такие случаи диагностируемыми в общем export-файле. Изменение: добавлено событие `TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE` и оно включено в pinned telemetry export. Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.

### 2026-05-20 09:38 CEST
- Для чего: исправить ручной вызов ответа конкретной модели по двойному клику на статус-индикаторе журнала модели. Изменение: статус-индикатор теперь отправляет `REQUEST_LLM_RESPONSE` для одной модели, то есть использует тот же путь, что кнопка `Get answers`: сначала отдаётся cached answer из background state, а при отсутствии кэша запускается manual late collect. Файл: `results.js`.
- Для чего: убрать нестабильность обработки двойного клика через `click`/`event.detail`. Изменение: обработчик статус-индикаторов переведён на настоящий delegated `dblclick`; добавлен keyboard fallback `Enter`/`Space`. Файл: `results.js`.
- Для чего: сделать интерактивность статус-индикатора явной для UI и accessibility. Изменение: статус-индикаторы получают `role="button"`, `tabIndex=0`, `aria-label`, tooltip “Double-click to fetch this model answer” и `focus-visible` outline. Файлы: `results.js`, `styles.css`.

### 2026-05-20 08:47 CEST
- Для чего: перенести открытие окна телеметрии с общей API-кнопки header на API-индикаторы в журналах/карточках моделей. Изменение: динамические `.api-indicator` теперь являются интерактивными элементами с `role="button"`, `tabIndex=0`, подсказкой и открывают DevTools/telemetry modal по двойному клику. Файл: `results.js`.
- Для чего: сохранить доступность нового действия с клавиатуры. Изменение: для `.api-indicator` добавлен обработчик `Enter`/`Space`, который открывает то же окно телеметрии. Файл: `results.js`.
- Для чего: убрать старое свойство у header API-кнопки. Изменение: удалён `dblclick`-handler с `#api-toggle`, а tooltip изменён с “opens DevTools on double-click” на нейтральное “API: uses connected APIs.” Файлы: `results.js`, `result_new.html`.
- Для чего: визуально показать интерактивность API-индикаторов. Изменение: `.api-indicator` получил `cursor: pointer`, `user-select: none` и `focus-visible` outline. Файл: `styles.css`.

### 2026-05-20 08:31 CEST
- Для чего: перейти от точечных recovery-патчей к единому системному слою финализации модели. Изменение: добавлен `buildFinalizationEvidence()` — единый evidence object для каждого финального решения: статус, причина, source, длина/hash ответа, dispatch/tab, promptSubmitted/lifecycle признаки, наличие pre-final recovery, prompt echo, contradictions и accepted flag. Файл: `background/job-orchestrator.js`.
- Для чего: сделать финальный статус объяснимым в `All Logs`. Изменение: перед фиксацией ответа теперь пишется pinned telemetry `FINALIZATION_DECISION`; тот же `finalizationEvidence` попадает в `Response`, `MODEL_FINAL` и `LLM_PARTIAL_RESPONSE.metadata`. Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.
- Для чего: не принимать оригинальный prompt как ответ не только в Grok content-script, но и на уровне background для всех моделей. Изменение: добавлены `normalizeEvidenceText()`, `isPromptEchoAnswerCandidate()` и `ANSWER_SANITY_REJECTED`; prompt echo превращается в `EXTRACT_FAILED/answer_prompt_echo` и проходит общий pre-final recovery вместо зелёного `SUCCESS`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать pre-final recovery частью общего контракта, а не списком исключений для отдельных моделей. Изменение: `PRE_TERMINAL_MATERIALIZE_MODELS` расширен на все web-модели (`GPT`, `Gemini`, `Claude`, `Le Chat`, `Perplexity`, `Grok`, `Qwen`, `DeepSeek`), поэтому спорные `NO_SEND/EXTRACT_FAILED/ERROR` проходят единый materialize + late collect перед финальной ошибкой. Файл: `background/job-orchestrator.js`.
- Для чего: хранить машинное состояние модели отдельно от UI-статуса. Изменение: добавлен `recordModelRunState()` с `executionStatus`, `generationStatus`, `answerStatus`, `uiStatus`, `dispatchId`, `updatedAt`; состояние сохраняется в `entry.modelRunState`. Файл: `background/job-orchestrator.js`.

### 2026-05-19 15:39 CEST
- Для чего: исправить `Perplexity: extractfailedround4gatetimeout` из `All Logs 20260519_15-33.md`, где до таймаута уже были успешные inline snapshot recovery на 248/1124/3452 символа, но финальный materialization не запускался. Изменение: `Perplexity` добавлен в `PRE_TERMINAL_MATERIALIZE_MODELS`, поэтому перед `EXTRACT_FAILED` теперь выполняется foreground materialization + `lateCollectAnswer()`. Файл: `background/job-orchestrator.js`.
- Для чего: устранить `Le Chat: nosendround4gatetimeout`, когда Round1 пропустил отправку из-за `tab_ineligible`, а дальше система пыталась собирать ответ из неподходящей вкладки. Изменение: при `tab_ineligible/tab_missing` в Round1 оркестратор сбрасывает binding, создаёт новую вкладку Le Chat, ждёт binding/readiness и только затем отправляет prompt; события `ROUND1_TAB_RECOVERY_*` попадают в экспорт. Файл: `background/job-orchestrator.js`.
- Для чего: запретить Grok фиксировать оригинальный prompt как успешный ответ. Изменение: `content-grok.js` сохраняет последний отправленный prompt, проверяет pipeline/manual ping ответы через `isPromptEcho()`, отклоняет echo событием `GROK_PROMPT_ECHO_REJECTED` и ждёт альтернативный non-echo ответ вместо отправки prompt в background как `SUCCESS`. Файл: `content-scripts/content-grok.js`.
- Для чего: исправить fallback поиска non-echo ответа Grok. Изменение: в `waitForNonEchoResponse()` заменён ошибочный `observer.disconnect()` на безопасный вызов `stopObserve()`, иначе echo-recovery мог падать при cleanup. Файл: `content-scripts/content-grok.js`.
- Для чего: сохранить новые диагностические маркеры в общем `All Logs` экспорте. Изменение: `ROUND1_TAB_RECOVERY_*`, `MATERIALIZE_RECOVERY_VISIT_FALLBACK` и `GROK_PROMPT_ECHO_REJECTED` добавлены в pinned telemetry labels. Файл: `background/telemetry-logs.js`.

### 2026-05-19 15:18 CEST
- Для чего: лучше понимать, почему pre-terminal recovery запускается перед `NO_SEND/EXTRACT_FAILED/ERROR`. Изменение: добавлено событие `MATERIALIZE_RECOVERY_CONTEXT` с исходным статусом-кандидатом, причиной, типом ошибки, `dispatchId`, признаками lifecycle, длинами уже известных answer/pending/snapshot и количеством transport-ошибок; полный текст ответа не логируется. Файл: `background/job-orchestrator.js`.
- Для чего: видеть, на каком слое позднего сбора ответ был найден или потерян. Изменение: `lateCollectAnswer()` теперь пишет `LATE_COLLECT_DECISION_TRACE` для каждого исхода цепочки (`content_script`, `inline_executeScript`, `snapshot_cache`, `none`) с состоянием вкладки, статусом, длиной текста, hash, candidateCount, selector/strategy и elapsedMs без полного текста ответа. Файл: `background/job-orchestrator.js`.
- Для чего: финальная ошибка после неудачного recovery должна быть объяснима в export-файле. Изменение: перед повторной финализацией исходной ошибки пишется `FINAL_ERROR_AFTER_RECOVERY` с original status/reason, recovery status/source/reason, количеством candidates и recovered length. Файл: `background/job-orchestrator.js`.
- Для чего: гарантировать попадание новой диагностики в общий экспорт `All Logs ...md` даже при большом числе событий. Изменение: новые telemetry labels добавлены в pinned-набор persistent diagnostics, который не вырезается обычным trim unpinned-событий. Файл: `background/telemetry-logs.js`.

### 2026-05-19 08:17 CEST
- Для чего: не считать `Qwen send not confirmed` окончательным отсутствием ответа, если тот мог быть сгенерирован и просто не был извлечён из виртуализированного DOM. Изменение: `NO_SEND` для Qwen теперь сначала переводится в `RECOVERABLE_ERROR` и получает один предфинальный materialize + late collect проход; только после промаха исходная ошибка фиксируется как финальная. Файл: `background/job-orchestrator.js`.
- Для чего: дать диагностический след, который покажет, сработал ли новый слой восстановления в следующем реальном логе. Изменение: добавлены telemetry-маркеры `MATERIALIZE_RECOVERY_DEFER_TERMINAL`, `MATERIALIZE_RECOVERY_START`, `MATERIALIZE_RECOVERY_SUCCESS`, `MATERIALIZE_RECOVERY_MISS`, `MATERIALIZE_RECOVERY_ERROR`; в miss пишутся candidates/source/status без текста ответа. Файл: `background/job-orchestrator.js`.

### 2026-05-18 20:06 CEST
- Для чего: убрать дублирование и расхождение правил статусов между background и results UI. Изменение: добавлен общий модуль `shared/status-contract.js` с едиными `SUCCESS/FAILURE/TERMINAL` списками, rank, normalization, downgrade guard и derived contract (`executionState`, `answerState`, `uiStatus`). Файл: `shared/status-contract.js`.
- Для чего: сделать background state источником структурированного статуса, а не только строки `status`. Изменение: `state-manager` и `job-orchestrator` теперь используют `LLMStatusContract.shouldApplyStatusUpdate()` и сохраняют `statusContract`; игнорируемые stale/downgrade события логируются как `STATUS_IGNORED`. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`.
- Для чего: синхронизировать global snapshot с новым контрактом. Изменение: `buildGlobalStateSnapshot()` теперь отдаёт `executionState`, `answerState`, `statusRank`, `liveStatus`, `finalStatus` и итоговый `status` из `deriveStatusContract()`. Файл: `background/ui-broadcast.js`.
- Для чего: убрать отдельную UI-таблицу рангов и использовать тот же guard, что и background. Изменение: `results.js` подключает `shared/status-contract.js` и применяет `LLMStatusContract` для normalization/rank/downgrade guard индикаторов. Файлы: `result_new.html`, `results.js`.

### 2026-05-18 19:00 CEST
- Для чего: исправить рассинхрон индикаторов статуса, когда ответ уже получен и вставлен, но индикатор остаётся в старом состоянии из-за потерянного или устаревшего `STATUS_UPDATE`. Изменение: `LLM_PARTIAL_RESPONSE` теперь синхронизирует индикатор по `metadata.status`, а не только обновляет текст панели. Файл: `results.js`.
- Для чего: защитить UI от старых поздних событий, приходящих после финального статуса. Изменение: добавлен client-side terminal-rank guard: `SUCCESS` не понижается до `PARTIAL/ERROR/NO_SEND`, terminal-статус не сбрасывается не-terminal событиями, кроме явного reset нового job. Файл: `results.js`.
- Для чего: восстанавливать индикаторы после потери сообщения или перезагрузки results tab. Изменение: `GLOBAL_STATE_BROADCAST` теперь применяется к индикаторам, а background snapshot отдаёт `finalStatus`, `finalStatusRecorded`, `liveStatus` и `statusData`. Файлы: `results.js`, `background/ui-broadcast.js`.
- Для чего: синхронизировать индикаторы из диагностических финальных событий. Изменение: `FINAL_STATUS`, `MODEL_FINAL` и `Status:*` log entries теперь используются как дополнительные authoritative источники статуса. Файл: `results.js`.

### 2026-05-17 22:38 CEST
- Для чего: убрать системную причину зависаний на страницах моделей после того, как часть моделей уже завершилась. Изменение: Round2 теперь пропускает модели с `finalStatus/finalStatusRecorded` так же, как Round3/Round4, и пишет `skipped (already complete)` вместо повторной проверки/фокуса. Файл: `background/job-orchestrator.js`.
- Для чего: устранить жёлтые индикаторы после уже зафиксированного зелёного успеха. Изменение: `updateModelState()` получил terminal-rank guard и больше не понижает `SUCCESS` до `PARTIAL/ERROR/NO_SEND` поздними событиями. Файл: `background/state-manager.js`.
- Для чего: сохранить возможность ручного восстановления ответа, но не портить terminal status. Изменение: manual late recovery может заменить текст ответа, однако при уже зафиксированном `SUCCESS` входящий `PARTIAL` сохраняет статус `SUCCESS` и логирует `Manual response kept terminal status`. Файл: `background/job-orchestrator.js`.
- Для чего: кнопка “получить ответы” не должна снова ходить по вкладкам, если ответ уже есть в background state. Изменение: `REQUEST_LLM_RESPONSE` теперь сразу отдаёт cached terminal answer и не запускает `handleManualResponsePing()` без `advanceStrategy`. Файл: `background/message-router.js`.

### 2026-05-17 10:08 CEST
- Для чего: убрать ложный жёлтый статус, когда late snapshot вернул полный ответ, но был помечен как `PARTIAL` только из-за источника `snapshot_cache`. Изменение: `handleLLMResponse()` теперь снимает forced partial для `snapshot_cache`, если есть доказательство завершения ответа: `ANSWER_COMPLETE_DETECTED`/`LLM_RESPONSE_READY` с сопоставимой длиной или `generation_inactive` на длинном snapshot. Файл: `background/job-orchestrator.js`.
- Для чего: использовать уже приходящий lifecycle diagnostic как доказательство завершения ответа. Изменение: `updateTypingStateFromDiagnostic()` теперь сохраняет `ANSWER_COMPLETE_DETECTED` в `entry.lifecycleReadyAt/lifecycleReadyMeta/answerCompleteTextLength`, чтобы поздняя финализация могла отличить полный snapshot от настоящего partial. Файл: `background/dispatch-coordinator.js`.

### 2026-05-17 09:51 CEST
- Для чего: защитить late answer snapshot cache от устаревших данных после краша extension, перезапуска браузера или пропущенного `stopAllProcesses()`. Изменение: `readAnswerSnapshotCache()` теперь применяет TTL `60 минут`; просроченные snapshot удаляются из in-memory cache и `CompressedStorage`, а не используются как fallback. Файл: `background/job-orchestrator.js`.
- Для чего: гарантировать очистку snapshot cache до создания нового `jobState`. Изменение: `startProcess()` переведён в async, ожидает `clearLateAnswerSnapshotCache("start_process")`, а `START_FULLPAGE_PROCESS` в router теперь вызывает `await startProcess(...)` перед ответом UI. Файлы: `background/job-orchestrator.js`, `background/message-router.js`.

### 2026-05-17 09:49 CEST
- Для чего: закрыть риск накопления устаревших DOM snapshot после внедрения late answer collection. Изменение: добавлен `clearLateAnswerSnapshotCache()`, который очищает in-memory cache и удаляет из `chrome.storage.local` все ключи `late_answer_snapshot_v1:*`. Файл: `background/job-orchestrator.js`.
- Для чего: не допустить попадания snapshot старого запуска в новый run. Изменение: `startProcess()` теперь запускает очистку late answer snapshot cache перед новым запуском, а `stopAllProcesses()` дополнительно очищает in-flight late collection и snapshot cache. Файл: `background/job-orchestrator.js`.

### 2026-05-17 09:21 CEST
- Для чего: реализовать недеструктивный механизм позднего сбора ответа, когда ответ уже есть или недавно был в DOM, но не попал в журнал. Изменение: в `background/job-orchestrator.js` добавлен `lateCollectAnswer()` с цепочкой `snapshot cache -> content-script ping/getResponses -> inline executeScript extractor -> cache fallback`, single-flight защитой, bounded timeouts и явными статусами `success`, `partial_from_snapshot`, `dead_tab_no_snapshot`, `late_collect_failed`.
- Для чего: не уничтожать DOM ответа при позднем сборе. Изменение: late collector использует отдельную readable-политику: проверяет `tabs.get`, `discarded`, URL eligibility, короткий ping и read-only `chrome.scripting.executeScript`, но не вызывает `reloadTab`, не переотправляет prompt и не использует destructive dispatch recovery path. Файл: `background/job-orchestrator.js`.
- Для чего: иметь fallback, если content script жив, выгружен или service worker перезапустился. Изменение: добавлен snapshot cache ответа с ключами по `llmName/runSessionId/dispatchId/tabId` и alias-ключами без `dispatchId`; snapshot хранится в памяти и через `CompressedStorage`, а telemetry/diagnostics получают только безопасные метаданные без полного текста ответа. Файлы: `background/job-orchestrator.js`, `background/message-router.js`.
- Для чего: регулярно сохранять последний видимый assistant-текст без тяжёлого reinject. Изменение: `content-scripts/content-utils.js` получил idempotent MutationObserver с debounce/hash, model-specific lightweight selectors, `extractSafeVisibleText()`, `collectLateSnapshotCandidate()` и обработчик `LATE_COLLECT_PING`; content script отправляет `ANSWER_SNAPSHOT` в background без регистрации дополнительных model-specific listeners.
- Для чего: сделать ручное подтягивание ответа через индикатор статуса более надёжным. Изменение: `handleManualResponsePing()` после обычного `getResponses` теперь дополнительно запускает `lateCollectAnswer()` и при успешном результате фиксирует ответ через общий `handleLLMResponse`. Файл: `background/job-orchestrator.js`.
- Для чего: заменить старый примитивный staged collection на единый поздний сбор. Изменение: `collectResponsesStaged()` теперь определяет модель по tab binding/URL и использует `lateCollectAnswer()` вместо короткого `chrome.tabs.sendMessage({ action: "get_response" })` без fallback. Файл: `background/job-orchestrator.js`.

### 2026-05-16 19:39 CEST
- Для чего: использовать индикатор статуса в карточке ответа как быстрый способ подтянуть ответ конкретной модели, если он не попал в журнал вместе с остальными. Изменение: одиночный клик по `.status-indicator` теперь вызывает существующий manual response ping (`MANUAL_RESPONSE_PING`) для модели из `data-llm-name`, сохраняя сам индикатор как визуальный статус. Файл: `results.js`.
- Для чего: сохранить доступ к прежнему окну телеметрии без конфликта с новым действием. Изменение: открытие DevTools/телеметрии перенесено на двойной клик по индикатору статуса; tooltip индикатора теперь показывает статус и подсказку `Click to fetch this model answer`. Файл: `results.js`.

### 2026-05-16 19:31 CEST
- Для чего: сделать ссылки в журналах ответов моделей кликабельными. Изменение: `results.js` теперь декорирует ссылки внутри response/log containers атрибутами `target="_blank"`, `rel="noopener noreferrer"` и `contenteditable="false"`, чтобы ссылки не превращались в обычный редактируемый текст внутри панели ответа.
- Для чего: открывать ссылки из журналов ответов в новой вкладке браузера. Изменение: добавлен делегированный click-handler для `.output`, `.response-content`, `.response-body` и диагностических log-контейнеров; при клике по `a[href]` используется `chrome.tabs.create({ url })`, а при недоступности API выполняется fallback на `window.open(..., "_blank")`. Файл: `results.js`.

### 2026-05-16 19:23 CEST
- Для чего: не терять частично видимый ответ при deferred hard-stop у DeepSeek/Le Chat/Qwen. Изменение: background DOM snapshot recovery расширен на `Le Chat`, `Qwen` и `DeepSeek`, добавлены платформенные answer selectors, а перед финальным `script_runtime_hard_stop` оркестратор делает последний DOM snapshot recovery и фиксирует найденный ответ вместо чистого `ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: восстановить Qwen после одиночного промаха подтверждения отправки. Изменение: `Qwen` добавлен в `ROUND2_REPAIR_MODELS`, поэтому при `prompt not confirmed` Round2 может выполнить repair-dispatch вместо раннего terminal `NO_SEND`. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс реальной отправки Qwen в текущей разметке. Изменение: `content-qwen.js` получил более широкий поиск send button по `aria-label`, `data-testid`, class/icon/submit-кандидатам рядом с composer, fallback через `Meta+Enter` и `form.requestSubmit()` перед финальным `Qwen send not confirmed`. Файл: `content-scripts/content-qwen.js`.

### 2026-05-13 20:36 CEST
- Для чего: сделать проверку активной генерации устойчивее для разных интерфейсов и языков UI. Изменение: background-проверка активной генерации теперь учитывает stop-кнопки на нескольких языках, `role=button`, `progressbar`, loading/generating/streaming классы и Qwen-специфичные loading-сигналы. Файл: `background/job-orchestrator.js`.
- Для чего: не принимать непроверенный DOM-фрагмент за финальный ответ после deferred-finalization. Изменение: early terminal guard теперь применяется ко всем основным web-моделям для `deferred_finalization/generation_inactive` и `dom_snapshot_recovery`; короткие ответы могут завершиться только после повторного стабильного наблюдения и max-wait, либо после lifecycle-ready. Файл: `background/job-orchestrator.js`.

### 2026-05-12 23:58 CEST
- Для чего: исправить Qwen, когда селектор ответа захватывал слишком широкий контейнер и подтягивал служебный нижний блок выбора режима рассуждения. Изменение: в `content-scripts/answer-pipeline-selectors.js` и `selectors/qwen.config.js` Qwen `response/lastMessage` selectors сужены до реального markdown/response body внутри assistant message; удалены слишком широкие fallback-пути вроде `main article`, `.prose`, `[class*="response"]`, которые могли цеплять посторонние узлы.
- Для чего: убрать попадание слова `Автоматический`/`Automatic` и похожих mode labels в текст ответа Qwen. Изменение: `content-scripts/content-qwen.js` теперь перед извлечением `text/html` клонирует assistant message и вырезает интерактивные/footer/reasoning-mode узлы (`button`, `radiogroup`, `listbox`, `mode-switch`, `reasoning` и точные labels `automatic/автоматический/自动`), после чего извлекает только очищенный markdown body.

### 2026-05-12 23:48 CEST
- Для чего: исправить Gemini, когда ответ был виден lifecycle detector, но итоговый статус и UI теряли семантику `partial/hard_timeout`. Изменение: `content-gemini.js` теперь сохраняет pipeline metadata рядом с `text/html` и передаёт её в background через `meta.responseMeta`, поэтому `streaming_incomplete`, `hard_timeout`, `sanityWarnings`, `sanityConfidence` и `partial` больше не теряются на пути `UnifiedAnswerPipeline -> LLM_RESPONSE -> handleLLMResponse`.
- Для чего: сохранить единый контракт ответа для Gemini и не ломать fallback-пути. Изменение: `normalizeResponsePayload()` расширен поддержкой `meta/metadata`, а отправка `LLM_RESPONSE`/`FINAL_LLM_RESPONSE` мержит `responseMeta` с исходным dispatch meta вместо отправки только `message.meta`.

### 2026-05-12 23:42 CEST
- Для чего: убрать ранний зелёный финал у GPT, Gemini и Perplexity, когда в журнал попадал только фрагмент ответа. Изменение: в `background/job-orchestrator.js` добавлен early-terminal guard для рискованных путей `dom_snapshot_recovery` и `deferred_finalization/generation_inactive`; теперь первый короткий или неподтверждённый ответ не фиксируется как terminal `SUCCESS`, а переводится обратно в `RECEIVING` с follow-up ping до lifecycle-ready или повторно стабильного длинного ответа.
- Для чего: связать lifecycle detector с финализацией background-оркестратора. Изменение: `background/message-router.js` теперь сохраняет `LLM_RESPONSE_READY` в `jobState` как `lifecycleReadyAt/lifecycleReadyMeta`, очищает pending early-terminal guard и тем самым разрешает безопасную terminal финализацию только после сигнала готовности ответа.

### 2026-05-12 23:20 CEST
- Для чего: закрыть уточнения ТЗ по безопасному lifecycle cancellation. Изменение: `stopResponseLifecycleTracking()` теперь возвращает стабильную форму `{ ok, stopped, reason }`, поддерживает фильтры `modelName`, `dispatchId`, `runSessionId`, выставляет `cancelledAt/cancelReason`, отключает `MutationObserver`, очищает pending timers и является идемпотентным. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: предотвратить поздние readiness/final события после cleanup. Изменение: добавлен `isTrackerActive()` и cancellation guard перед `ANSWER_COMPLETE_DETECTED`, `LLM_RESPONSE_READY` и возвратом `COMPLETE`; ожидания polling теперь используют cancellable timers, чтобы остановка tracker немедленно завершала loop как `CANCELLED`. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: убрать тяжёлые selector resolver вызовы из каждого lifecycle tick. Изменение: composer/send readiness сначала проверяется дешёвым `detectCheapComposerReadiness()`, а `SelectorResolverV2.resolveComposer()` / `resolveSendButton()` вызываются только после `textStable` и с коротким timeout `800ms`. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: ограничить fallback DOM text extraction по обновлённому контракту. Изменение: `extractSafeVisibleText()` теперь принимает `maxChars = 10000`, нормализует whitespace, не выбрасывает исключения и обрезает возвращаемый текст. Файл: `content-utils/selector-resolver-v2.js`.

### 2026-05-12 22:47 CEST
- Для чего: добавить детерминированный self-healing слой селекторов без внешних зависимостей для composer, send button и latest assistant answer. Изменение: добавлены новые модули `content-utils/selector-resolver-v2.js` и `content-utils/response-lifecycle-detector.js` с exact/cache/semantic/spatial resolution, fingerprint/cache validation, shadow-DOM scan, lifecycle tracking, generating-indicator detection, self-test API и безопасной телеметрией без prompt/answer persistence. Файлы: `content-utils/selector-resolver-v2.js`, `content-utils/response-lifecycle-detector.js`.
- Для чего: загрузить новые resolver/lifecycle utilities раньше model-specific content scripts и не менять host permissions. Изменение: оба модуля подключены в общий LLM content-script bundle и продублированы перед каждым model-specific content script entry, чтобы fallback и async lifecycle были доступны до инициализации платформенных скриптов. Файл: `manifest.json`.
- Для чего: добавить background-level placeholder и readiness signal без вмешательства в текущий final answer flow. Изменение: `background/message-router.js` теперь обрабатывает `VISUAL_RESOLVE_REQUEST` как disabled placeholder, принимает `LLM_RESPONSE_READY` только как diagnostic/readiness update и нормализует `selector_resolution` metric через `layer || method`, не меняя существующий `LLM_RESPONSE / FINAL_LLM_RESPONSE` путь. Файл: `background/message-router.js`.

### 2026-04-24 14:21 CEST
- Для чего: исправить reuse вкладок для всех моделей, когда `New Pages` выключен. Изменение: поиск кандидата для attach теперь проходит по всем открытым вкладкам и фильтрует их вручную по URL-паттернам и пригодности, вместо зависимости от узкого `chrome.tabs.query` пути, поэтому non-GPT модели тоже должны переиспользовать уже открытые вкладки, если они есть. Файл: `background/tab-manager.js`.

### 2026-05-17 20:27 CEST
- Для чего: устранить зависание на Claude, когда вкладка захватывала фокус до завершения ответа и `FOCUS_STUCK` только логировался, но не освобождал визит. Изменение: `FOCUS_STUCK` теперь принудительно завершает активный human visit, возвращает фокус на страницу результатов и пишет отдельный диагностический маркер `HUMAN_VISIT_FOCUS_STUCK_TERMINATED`. Файл: `background/human-presence.js`.
- Для чего: защититься от ситуации, когда глобальный hard-cap визита перезаписывается другим визитом и текущая вкладка остаётся активной слишком долго. Изменение: каждый `visitTabWithHumanity()` получил локальный `HUMAN_VISIT_HARD_CAP_MS` таймер, который очищается при нормальном завершении и завершает только свой активный визит при превышении лимита. Файл: `background/human-presence.js`.

### 2026-05-17 20:08 CEST
- Для чего: не зависать на Qwen или другой модели, если она стала terminal во время активного human/automation visit. Изменение: активные visits получили polling terminal-состояния каждые `500ms` и завершаются сразу после `finalStatus/finalStatusRecorded`, очищая timers/locks и возвращая фокус. Файл: `background/human-presence.js`.
- Для чего: не запускать forced automation visit, если модель уже завершилась между планированием и фактическим визитом. Изменение: `runForcedAutomationVisits()` проверяет terminal-состояние перед каждым визитом, логирует `FORCED_VISIT_SKIPPED`, не считает skipped-визиты выполненными и прекращает цикл после terminal. Файл: `background/job-orchestrator.js`.
- Для чего: убрать misleading Round4 telemetry, будто завершённые модели снова фокусируются. Изменение: model-level Round4 START/END для terminal-моделей теперь пишется как `skipped (already complete)`, а не `focusing results tab`. Файл: `background/job-orchestrator.js`.

### 2026-05-17 19:41 CEST
- Для чего: отличать проблему UI-события от проблемы background/content-script. Изменение: в diagnostics добавлены события `Manual ping: status indicator double-click` и `Manual ping: status indicator single click ignored` с source/advance details. Файл: `results.js`.
- Для чего: видеть, дошёл ли восстановленный ответ до страницы результатов и был ли вставлен в DOM-панель. Изменение: при manual ping логируется `Manual ping: response payload received` с `textLen/htmlLen`, а `updateLLMPanelOutput()` пишет `Panel output updated` или `Panel output update failed` с id панели и длинами. Файл: `results.js`.

### 2026-05-17 19:19 CEST
- Для чего: запускать ручное подтягивание ответа именно по двойному клику на индикаторе статуса ответа в журнале модели. Изменение: обработчик `.status-indicator` теперь вызывает `triggerManualPing()` только на `dblclick`; одиночный клик больше не запускает manual recovery. Файл: `results.js`.
- Для чего: убрать конфликт с телеметрией, так как её открытие уже доступно двойным кликом по кнопке API. Изменение: открытие DevTools/telemetry modal с индикатора статуса удалено. Файл: `results.js`.
- Для чего: синхронизировать подсказку UI с новым поведением. Изменение: tooltip индикатора статуса теперь показывает `Double-click to fetch this model answer`. Файл: `results.js`.

### 2026-05-17 19:10 CEST
- Для чего: не считать рабочую стратегию плохой при первом ручном восстановлении ответа. Изменение: `MANUAL_RESPONSE_PING` и `REQUEST_LLM_RESPONSE` получили явный `advanceStrategy`; предыдущий DOM-кандидат помечается rejected только при `advanceStrategy=true`. Файлы: `background/message-router.js`, `background/job-orchestrator.js`, `results.js`.
- Для чего: разделить UX “получить ответ” и “попробовать следующий селектор” без отдельной кнопки. Изменение: первый клик по индикатору отправляет `advanceStrategy=false`, последующие клики после запуска recovery отправляют `advanceStrategy=true`. Файл: `results.js`.
- Для чего: сделать ручное восстановление диагностируемым. Изменение: `manualRecovery` теперь хранит `lastAcceptedCandidate`, `exhausted`, `candidateCount`, `textHash`, `strategyId`, `strategyIndex` и selector metadata; content-script/live и inline late collect возвращают diagnostics в результат. Файл: `background/job-orchestrator.js`.

### 2026-05-17 12:24 CEST
- Для чего: дать кнопке журнала модели не только повторно запросить ответ, но и восстановить неправильный ответ после промаха селектора. Изменение: manual ping получил persistent `manualRecovery` state в `jobState.llms[llmName]`, хранит использованные стратегии/селекторы и при повторном клике помечает предыдущий кандидат rejected. Файл: `background/job-orchestrator.js`.
- Для чего: при повторном клике выбирать другой DOM-путь, а не возвращать тот же ошибочный блок. Изменение: inline late extractor получил стратегии `default_score`, `last_visible`, `bottom_most`, `longest`, `markdown_only`, `assistant_role_only`, `article_bottom`, а single-flight late collect теперь разделяется по strategy/attempt. Файл: `background/job-orchestrator.js`.
- Для чего: разрешить ручному восстановлению заменить уже финализированный ответ, если пользователь видит, что журнал подтянул неверный текст. Изменение: `handleLLMResponse` принимает success-ответы с `manualRecovery/manualOverride` поверх terminal-lock, но не позволяет manual override по ошибочным или слишком коротким payload. Файл: `background/job-orchestrator.js`.
- Для чего: пробросить режим ротации селекторов от кнопки статуса/журнала до background. Изменение: `MANUAL_RESPONSE_PING` теперь принимает `manualRecovery`, `advanceSelector` и `reason`, а UI отправляет эти параметры при клике по индикатору. Файлы: `background/message-router.js`, `results.js`.

### 2026-04-24 14:05 CEST
- Для чего: исправить Qwen, когда ответ генерируется, но не попадает в журнал. Изменение: Qwen-извлечение теперь учитывает реальные классы текущей разметки (`qwen-chat-message-assistant`, `chat-response-message-right`, `response-message-content`, `custom-qwen-markdown`, `qwen-markdown`), чтобы ответ не терялся при промахе по более общим селекторам. Файлы: `content-scripts/content-qwen.js`, `selectors/qwen.config.js`, `selectors/config-bundle.js`, `content-scripts/answer-pipeline-selectors.js`.
- Для чего: при выключенном `New Pages` предпочитать уже открытые вкладки модели, а не открывать новые. Изменение: поиск существующей вкладки для attach больше не режется фильтром `audible:false`, поэтому reuse может сработать для любой уже открытой подходящей вкладки, включая последнюю по времени. Файл: `background/tab-manager.js`.

### 2026-04-24 13:41 CEST
- Для чего: сделать этот прогон доступным через стандартную команду проекта. Изменение: в `package.json` добавлен `npm run test:qwen`. Файл: `package.json`.

### 2026-04-24 13:31 CEST
- Для чего: исправить сценарий, где Qwen генерирует ответ и статус остаётся зелёным, но ответ не попадает в журнал из-за промаха по селекторам. Изменение: `content-qwen.js` теперь использует более широкий DOM fallback для извлечения ответа, а `answer-pipeline-selectors.js` получил расширенный Qwen selector pack и alias `response`, чтобы журнал мог подхватить ответ даже при изменении разметки. Файлы: `content-scripts/content-qwen.js`, `content-scripts/answer-pipeline-selectors.js`.
- Для чего: уменьшить зависимость Qwen от одного пути подтверждения отправки. Изменение: `sendComposer` теперь подтверждает отправку по новому user-message или явному streaming/busy-сигналу, а не по очистке composer. Файл: `content-scripts/content-qwen.js`.

### 2026-04-22 16:17 CEST
- Для чего: не фиксировать GPT/Claude зелёными по первому неполному фрагменту ответа. Изменение: `job-orchestrator.js` теперь перед terminal `SUCCESS` для GPT и Claude проверяет вкладку через `chrome.scripting.executeScript`; если виден `Stop`/streaming/busy-сигнал, финализация откладывается, в UI отправляется только partial update, а сбор ответа повторяется через deferred ping. Файл: `background/job-orchestrator.js`.
- Для чего: устранить ложный `SUCCESS` Qwen, когда prompt фактически не был отправлен/не появился в чате. Изменение: `content-qwen.js` больше не считает отправку подтверждённой по одному только очищению composer; подтверждение требует streaming-сигнал, disabled send button или появление нового user-message с началом prompt. Файл: `content-scripts/content-qwen.js`.
- Для чего: не принимать старый ответ Qwen как новый после неудачной отправки. Изменение: fallback-наблюдение Qwen теперь учитывает baseline count контейнеров сообщений и не возвращает старый last message, если после send не появился новый контейнер. Файл: `content-scripts/content-qwen.js`.

### 2026-04-22 15:51 CEST
- Для чего: устранять жёлтый статус Gemini/Perplexity, когда ответ уже есть на странице, но content-script канал сломан (`message port closed` / `message channel closed`). Изменение: добавлен background-level DOM snapshot recovery для Gemini и Perplexity: background выполняет `chrome.scripting.executeScript` во вкладке, ищет последний assistant-answer по DOM/shadow-DOM селекторам и передаёт найденный текст в `handleLLMResponse` как `dom_snapshot_recovery`. Файл: `background/job-orchestrator.js`.
- Для чего: запускать DOM recovery именно в сценариях из лога `All Logs 20260422_15-45.md`. Изменение: recovery вызывается при `PING_TRANSPORT_ERROR` в passive/manual ping и при `transport_error_after_submit`, не затрагивая Grok, где зависание связано с самой моделью и ответ не появился. Файлы: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.

### 2026-04-20 10:23 CEST
- Для чего: убрать ложный красный хвост после успешного `MODEL_FINAL`. Изменение: `telemetry-logs.js` теперь отбрасывает известные шумные post-terminal события для моделей с зафиксированным успешным финалом (`PIPELINE_ERROR`, `SELECTOR_STATS`, `FOCUS_STUCK`, visit/lease-события, transport/pipeline-noise), не скрывая реальные ошибки до финала. Файл: `background/telemetry-logs.js`.
- Для чего: остановить источник поздних `FOCUS_STUCK` и `TAB_VISIT` после успеха. Изменение: `human-presence.js` теперь не начинает human/automation visit для модели с успешным terminal-статусом, проверяет terminal-состояние перед фактическим переключением вкладки и умеет завершать активный визит по конкретной модели. Файл: `background/human-presence.js`.
- Для чего: синхронизировать финал модели с остановкой human-presence. Изменение: при `SUCCESS`, `PARTIAL` или `STREAM_TIMEOUT_HIDDEN` оркестратор вызывает `completeHumanPresenceForModel`, чтобы убрать активные visit/automation locks сразу после фиксации результата. Файл: `background/job-orchestrator.js`.
- Для чего: гарантированно очищать телеметрию прошлого прогона при reload страницы результатов. Изменение: `results.js` теперь ожидает ответ `CLEAR_DIAG_EVENTS` перед дальнейшей инициализацией, чтобы экспорт не успевал прочитать старый `__diagnostics_events__`. Файл: `results.js`.
- Для чего: не переносить диагностику между сетями даже без reload страницы. Изменение: `message-router.js` очищает persistent telemetry и runtime `entry.logs` при `CLEAR_DIAG_EVENTS` и перед запуском нового `START_FULLPAGE_PROCESS`. Файл: `background/message-router.js`.

### 2026-04-20 09:56 CEST
- Для чего: очищать телеметрию прошлого запуска при перезагрузке страницы результатов. Изменение: `results.js` теперь определяет `navigation.type === 'reload'` и отправляет `CLEAR_DIAG_EVENTS` в background до восстановления UI, чтобы `__diagnostics_events__` не тянулся из предыдущей сети/прогона. Файл: `results.js`.

### 2026-04-19 15:26 CEST
- Для чего: устранить ложный `NO_SEND` у Grok, когда `Ctrl+Enter` не срабатывает в новой разметке. Изменение: добавлен дополнительный путь отправки `Enter`, а также fallback через `form.requestSubmit()` после неуспешных попыток кнопкой/клавиатурой. Файл: `content-scripts/content-grok.js`.
- Для чего: уменьшить задержку фактической отправки на Claude после ввода prompt. Изменение: фиксированная пауза перед send снижена с 2000ms до 350ms. Файл: `content-scripts/content-claude.js`.
- Для чего: убрать сценарий «красный статус + manual ping skipped» для недавно завершённых `EXTRACT_FAILED/NO_SEND/ERROR`. Изменение: manual ping теперь разрешён для recoverable terminal-статусов в пределах окна 180s; добавлен диагностический маркер `Manual ping override (recoverable terminal)`. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс автоматического восстановления Grok ещё на этапе Round2. Изменение: Grok добавлен в `ROUND2_REPAIR_MODELS`, чтобы при `prompt not confirmed` выполнялся repair-dispatch. Файл: `background/job-orchestrator.js`.

### 2026-04-19 10:30 CEST
- Для чего: сократить длительное «красное окно» после `script_runtime_hard_stop`, когда ответ может прийти с задержкой. Изменение: добавлены модельно-зависимые defer-окна (`Gemini/Claude/Le Chat/Perplexity/Grok`) и расширен deferred-recovery не только для `GPT`; перед финальной hard-stop ошибкой добавлен дополнительный `final_ping_before_error`. Файл: `background/job-orchestrator.js`.
- Для чего: ускорить восстановление канала при `PING_TRANSPORT_ERROR` и `message port closed`. Изменение: `sendPassiveMessageWithRetries` поддерживает явный план задержек (`transportRetryDelays`), а оркестратор использует быстрый профиль ретраев для `getResponses` ping (включая hard-stop и manual ping). Файлы: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`.
- Для чего: убрать повторяющийся flood `SELECTOR_STATS` и повысить сигнал/шум в диагностике. Изменение: в watcher добавлена дедупликация одинаковых selector-метрик в окне `selectorStatsDedupWindowMs` (по умолчанию 30s). Файл: `content-scripts/unified-answer-watcher.js`.
