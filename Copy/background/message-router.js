

const API_MODE_STORAGE_KEY = 'llmComparatorApiModeEnabled';
const AUTO_FOCUS_NEW_TABS_KEY = 'autofocus_llm_tabs_enabled';
const DIAGNOSTICS_EVENTS_KEY = '__diagnostics_events__';
const llmStartChains = Object.create(null);
const routerSessionTimerManager = (() => {
    const register = (typeof self?.registerSessionTimer === 'function') ? self.registerSessionTimer : (id) => id;
    const deregister = (typeof self?.deregisterSessionTimer === 'function') ? self.deregisterSessionTimer : () => {};
    return { register, deregister };
})();
const routerRegisterSessionTimer = routerSessionTimerManager.register;
const routerDeregisterSessionTimer = routerSessionTimerManager.deregister;

const hasCompressedDiagnosticsStorage = () => (
    typeof CompressedStorage !== 'undefined'
    && CompressedStorage
    && typeof CompressedStorage.get === 'function'
    && typeof CompressedStorage.set === 'function'
);

const readDiagnosticsEventsFromStorage = async () => {
    if (hasCompressedDiagnosticsStorage()) {
        const value = await CompressedStorage.get(DIAGNOSTICS_EVENTS_KEY);
        return Array.isArray(value) ? value : [];
    }
    const res = await chrome.storage.local.get([DIAGNOSTICS_EVENTS_KEY]);
    return Array.isArray(res?.[DIAGNOSTICS_EVENTS_KEY]) ? res[DIAGNOSTICS_EVENTS_KEY] : [];
};

const writeDiagnosticsEventsToStorage = async (entries = []) => {
    const payload = Array.isArray(entries) ? entries : [];
    if (hasCompressedDiagnosticsStorage()) {
        await CompressedStorage.set(DIAGNOSTICS_EVENTS_KEY, payload);
        return;
    }
    await chrome.storage.local.set({ [DIAGNOSTICS_EVENTS_KEY]: payload });
};

const clearDiagnosticsRuntimeLogs = () => {
    if (!jobState?.llms || typeof jobState.llms !== 'object') return false;
    let changed = false;
    Object.values(jobState.llms).forEach((entry) => {
        if (!entry || !Array.isArray(entry.logs) || !entry.logs.length) return;
        entry.logs = [];
        changed = true;
    });
    if (changed) {
        try { saveJobState(jobState); } catch (_) {}
    }
    return changed;
};

const clearDiagnosticsStorageOnStartup = () => {
    writeDiagnosticsEventsToStorage([])
        .catch((err) => console.warn('[DIAGNOSTICS] startup clear failed', err));
};

if (typeof chrome !== 'undefined' && chrome?.runtime) {
    if (typeof chrome.runtime.onStartup?.addListener === 'function') {
        chrome.runtime.onStartup.addListener(clearDiagnosticsStorageOnStartup);
    }
    if (typeof chrome.runtime.onInstalled?.addListener === 'function') {
        chrome.runtime.onInstalled.addListener(clearDiagnosticsStorageOnStartup);
    }
}

const DIAG_PINNED_LABELS = new Set([
    'MODEL_FINAL',
    'FINAL_STATUS',
    'MODEL_MISSING',
    'FOCUS_STUCK',
    'BUDGET_EXHAUSTED'
]);

const isPinnedDiagnosticEvent = (entry = {}) => {
    const label = String(entry?.label || entry?.meta?.event || '').toUpperCase();
    if (!label) return false;
    if (label.startsWith('ROUND')) return true;
    return DIAG_PINNED_LABELS.has(label);
};

const diagTrimDiagnosticsBuffer = (entries = [], maxItems = 200) => {
    let next = Array.isArray(entries) ? entries.slice() : [];
    if (next.length <= maxItems) return next;
    const pinned = next.filter(isPinnedDiagnosticEvent);
    const unpinned = next.filter((entry) => !isPinnedDiagnosticEvent(entry));
    const capacity = Math.max(0, maxItems - pinned.length);
    const trimmed = capacity ? unpinned.slice(-capacity) : [];
    next = trimmed.concat(pinned);
    next.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
    return next;
};

const diagDropOldestUnpinned = (entries = []) => {
    if (!entries.length) return entries;
    const idx = entries.findIndex((entry) => !isPinnedDiagnosticEvent(entry));
    if (idx === -1) {
        return entries.slice(1);
    }
    return entries.slice(0, idx).concat(entries.slice(idx + 1));
};

// v2.54 (2025-12-19 19:36): Early ready signal system for faster script readiness detection
const earlyReadyWaiters = new Map(); // llmName -> Set<callback>

function waitForEarlyReadySignal(llmName, timeoutMs = 2000) {
    return new Promise((resolve) => {
        if (!llmName) {
            resolve(false);
            return;
        }
        const waiters = earlyReadyWaiters.get(llmName) || new Set();
        earlyReadyWaiters.set(llmName, waiters);

        let settled = false;
        const done = (success) => {
            if (settled) return;
            settled = true;
            if (timer) {
                clearTimeout(timer);
                routerDeregisterSessionTimer(timer);
            }
            waiters.delete(handler);
            resolve(success);
        };

        const handler = () => done(true);
        waiters.add(handler);
        let timer = null;
        timer = routerRegisterSessionTimer(setTimeout(() => done(false), timeoutMs));
    });
}

function resolveEarlyReadySignal(llmName) {
    const waiters = earlyReadyWaiters.get(llmName);
    if (waiters && waiters.size) {
        waiters.forEach((cb) => {
            try { cb(); } catch (_) {}
        });
        waiters.clear();
    }
}

chrome.storage.local.get(API_MODE_STORAGE_KEY, (data) => {
    if (typeof data?.[API_MODE_STORAGE_KEY] === 'boolean') {
        cachedApiMode = data[API_MODE_STORAGE_KEY];
        self.cachedApiMode = cachedApiMode;
    }
});

chrome.storage.local.get(AUTO_FOCUS_NEW_TABS_KEY, (data) => {
    if (typeof data?.[AUTO_FOCUS_NEW_TABS_KEY] === 'boolean') {
        autoFocusNewTabsEnabled = data[AUTO_FOCUS_NEW_TABS_KEY];
        self.autoFocusNewTabsEnabled = autoFocusNewTabsEnabled;
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[API_MODE_STORAGE_KEY]) {
        cachedApiMode = !!changes[API_MODE_STORAGE_KEY].newValue;
        self.cachedApiMode = cachedApiMode;
    }
    if (changes[AUTO_FOCUS_NEW_TABS_KEY]) {
        autoFocusNewTabsEnabled = !!changes[AUTO_FOCUS_NEW_TABS_KEY].newValue;
        self.autoFocusNewTabsEnabled = autoFocusNewTabsEnabled;
    }
});


let initialStatePromise = null;
let initialStateReady = false;

function ensureInitialState() {
    if (!initialStatePromise) {
        initialStatePromise = (async () => {
            await CompressedStorage.migrate(['results', 'notes', 'logs']);
            await CompressedStorage.pruneIfNeeded();
            await Promise.all([loadJobState(), TabMapManager.load()]);
            await loadResolutionMetrics();
            await loadCircuitBreakerState();
            await (self.DispatchCircuit?.loadDispatchCircuitState ? self.DispatchCircuit.loadDispatchCircuitState() : Promise.resolve());
            initialStateReady = true;
        })().catch((err) => {
            initialStateReady = false;
            initialStatePromise = null;
            throw err;
        });
    }
    return initialStatePromise;
}

function isInitialStateReady() {
    return initialStateReady;
}

ensureInitialState().catch((err) => {
    console.error('[BACKGROUND] Failed to preload initial state:', err);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    console.log(`[BACKGROUND] Tab ${tabId} was closed.`);
    if (self.ReadySignalManager?.handleTabClosed) {
        self.ReadySignalManager.handleTabClosed(tabId);
    }
    closePingWindowForTab(tabId);
    removeActiveListenerForTab(tabId);
    delete llmActivityMap[tabId];
    if (pendingPings.size) {
        Array.from(pendingPings.entries()).forEach(([pingId, meta]) => {
            if (meta?.tabId === tabId) {
                pendingPings.delete(pingId);
            }
        });
    }
    pendingPingByTabId.delete(tabId);
    healthCheckFailuresByTabId.delete(tabId);
    lastHealthCheckReportAtByTabId.delete(tabId);
    let cleanupReason = null;
    let llmTabClosed = false;
    
    //-- 4.4. Cleanup при закрытии вкладок --//
    const closedLlmName = TabMapManager.getNameByTabId(tabId);
    if (closedLlmName) {
        console.log(`[BACKGROUND] LLM tab ${closedLlmName} closed, sending cleanup...`);
        emitTelemetry(closedLlmName, 'TAB_CLOSED', {
            details: 'llm_tab_closed',
            level: 'warning',
            meta: {
                tabId,
                windowId: removeInfo?.windowId ?? null,
                isWindowClosing: !!removeInfo?.isWindowClosing,
                reason: 'tab_removed'
            }
        });
        clearDeferredAnswerTimer(closedLlmName);
        llmTabClosed = true;
        if (jobState?.llms?.[closedLlmName]) {
            const status = jobState.llms[closedLlmName].status;
            const alreadyFinished = status === 'COPY_SUCCESS' || status === 'ERROR';
            if (!alreadyFinished) {
                handleLLMResponse(closedLlmName, 'Error: Tab closed during generation', {
                    type: 'tab_closed_prematurely'
                });
            }
            jobState.llms[closedLlmName].tabId = null;
        }
        cleanupTabResources(tabId, 'tab_removed');
        // Tab is already gone; just drop mapping/state.
        if (self.setTabBinding) void self.setTabBinding(closedLlmName, null);
        else TabMapManager.removeByName(closedLlmName);
    }
    
    // Проверяем evaluator tab
    if (evaluatorTabId === tabId) {
        console.log(`[BACKGROUND] Evaluator tab closed.`);
        evaluatorTabId = null;
        cleanupReason = cleanupReason || 'evaluator_tab_closed';
    }
    
    // Проверяем results tab
    if (resultsTabId === tabId) {
        console.log(`[BACKGROUND] Results tab closed, clearing all LLM sessions...`);
        TabMapManager.entries().forEach(([, llmTabId]) => {
            chrome.tabs.sendMessage(llmTabId, { type: 'STOP_AND_CLEANUP' }).catch(() => {});
        });
        resultsTabId = null;
        cleanupReason = cleanupReason || 'results_tab_closed';
    }

    const remainingLlms = Math.max(0, TabMapManager.entries().length - (llmTabClosed ? 1 : 0));
    if (!remainingLlms) {
        cleanupReason = cleanupReason || 'no_llm_tabs';
    }

    if (cleanupReason) {
        // Никогда не закрываем LLM-вкладки автоматически при закрытии results,
        // оставляем только очистку состояния.
        stopAllProcesses(cleanupReason, { closeTabs: false });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[BACKGROUND] Received message:", message);
    if (message?.type === 'NOTES_CMD' || message?.type === 'NOTES_EVENT') {
        return false;
    }

    const processMessage = () => {
        switch (message.type) {
            case 'START_FULLPAGE_PROCESS': {
                const forceNewTabs = message.forceNewTabs !== undefined ? message.forceNewTabs : true;
                const useApiFallback = message.useApiFallback !== undefined ? message.useApiFallback : cachedApiMode;
                (async () => {
                    try {
                        await writeDiagnosticsEventsToStorage([]);
                        clearDiagnosticsRuntimeLogs();
                    } catch (err) {
                        console.warn('[DIAGNOSTICS] new run clear failed', err);
                    }
                    await startProcess(message.prompt, message.selectedLLMs, sender.tab.id, {
                        forceNewTabs,
                        useApiFallback,
                        attachments: Array.isArray(message.attachments) ? message.attachments : []
                    });
                    sendResponse({ status: 'process_started' });
                })();
                return true;
            }
                
            case 'COLLECT_RESPONSES':
                (async () => {
                    try {
                        const responses = await collectResponsesStaged?.();
                        sendResponse({ success: true, responses });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;

            case 'SESSION_TABS_GET': {
                Promise.resolve().then(async () => {
                    const tabs = await getTrackedSessionTabs();
                    sendResponse({ status: 'ok', tabs });
                });
                return true;
            }

            case 'SESSION_TABS_OPEN': {
                const rawUrls = Array.isArray(message.urls) ? message.urls : [];
                const urls = rawUrls
                    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
                Promise.resolve().then(async () => {
                    if (!urls.length) {
                        sendResponse({ status: 'empty', tabs: [] });
                        return;
                    }
                    const created = [];
                    for (const url of urls) {
                        const tab = await new Promise((resolve) => {
                            chrome.tabs.create({ url, active: false }, (newTab) => {
                                if (chrome.runtime.lastError || !newTab) {
                                    resolve(null);
                                    return;
                                }
                                resolve(newTab);
                            });
                        });
                        if (tab?.id) {
                            trackSessionTab(tab.id);
                            created.push({ tabId: tab.id, url: tab.url || url });
                        }
                    }
                    sendResponse({ status: 'opened', tabs: created });
                });
                return true;
            }
                
            case 'START_EVALUATION_WITH_PROMPT': {
                const shouldFocusEvaluator = message.openEvaluatorTab !== false;
                startEvaluation(
                    message.evaluationPrompt,
                    message.evaluatorLLM,
                    { openEvaluatorTab: shouldFocusEvaluator }
                );
                sendResponse({ status: 'evaluation_started_with_prompt' });
                break;
            }

            case 'LLM_RESPONSE':
                handleLLMResponse(
                    message.llmName,
                    message.answer,
                    message.error || null,
                    message.meta || null,
                    message.answerHtml || message.html || ''
                );
                sendResponse({ status: 'response_handled' });
                break;

            // Some content-scripts can emit FINAL_LLM_RESPONSE (e.g. evaluator flows).
            // Treat it the same as a regular LLM response to avoid "silent" drops.
            case 'FINAL_LLM_RESPONSE':
                handleLLMResponse(
                    message.llmName,
                    message.answer,
                    message.error || null,
                    message.meta || null,
                    message.answerHtml || message.html || ''
                );
                sendResponse({ status: 'final_response_handled' });
                break;

            case 'PROMPT_SUBMITTED': {
                const llmName = message.llmName;
                if (llmName && jobState?.llms?.[llmName]) {
                    const entry = jobState.llms[llmName];
                    const now = Date.now();
                    const flags = self.getDispatchFlags ? self.getDispatchFlags(llmName, entry) : null;

                    const incomingMeta = message?.meta && typeof message.meta === 'object' ? message.meta : null;
                    const expectedRunSessionId = Number(jobState?.session?.startTime || 0) || null;
                    const normalizedMeta = incomingMeta ? Object.assign({}, incomingMeta) : {};
                    if (expectedRunSessionId && !normalizedMeta.runSessionId) {
                        normalizedMeta.runSessionId = expectedRunSessionId;
                    }
                    if (normalizedMeta.sessionId && !normalizedMeta.runSessionId) {
                        normalizedMeta.runSessionId = normalizedMeta.sessionId;
                    }
                    const incomingRunSessionId = normalizedMeta?.runSessionId ? Number(normalizedMeta.runSessionId) : null;
                    const incomingDispatchId = typeof normalizedMeta?.dispatchId === 'string' ? normalizedMeta.dispatchId : null;
                    const recentDispatchIds = Array.isArray(entry?.recentDispatchIds) ? entry.recentDispatchIds : [];
                    const hasCorrelationMeta = !!(incomingRunSessionId || incomingDispatchId || expectedRunSessionId);
                    const alreadyConfirmed = incomingDispatchId
                        ? (self.DispatchIdRegistry?.isDispatchConfirmed?.(incomingDispatchId) || entry?.confirmedDispatchId === incomingDispatchId)
                        : !!entry?.promptSubmittedAt;

                    // If the content-script echoes dispatch meta, enforce matching to avoid cross-run pollution.
                    const metaMismatch = (() => {
                        if (!incomingMeta) return false;
                        if (expectedRunSessionId && incomingRunSessionId && incomingRunSessionId !== expectedRunSessionId) return true;
                        if (incomingDispatchId && recentDispatchIds.length && !recentDispatchIds.includes(incomingDispatchId)) return true;
                        return false;
                    })();

                    if (metaMismatch) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_REJECTED', {
                            details: 'meta_mismatch',
                            level: 'warning',
                            meta: {
                                dispatchId: incomingDispatchId || null,
                                runSessionId: incomingRunSessionId || null,
                                expectedRunSessionId,
                                reason: 'meta_mismatch'
                            }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'PROMPT_SUBMITTED ignored (dispatch mismatch)',
                            details: `dispatchId=${incomingDispatchId || 'n/a'} runSessionId=${incomingRunSessionId || 'n/a'} expectedRunSessionId=${expectedRunSessionId || 'n/a'}`,
                            level: 'warning'
                        });
                        sendResponse({ status: 'prompt_submitted_ack' });
                        break;
                    }
                    if (alreadyConfirmed) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_STALE', {
                            details: 'duplicate_dispatch_id',
                            level: 'warning',
                            meta: { dispatchId: incomingDispatchId }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'PROMPT_SUBMITTED ignored (duplicate)',
                            details: `dispatchId=${incomingDispatchId || 'n/a'}`,
                            level: 'warning'
                        });
                        sendResponse({ status: 'prompt_submitted_ack' });
                        break;
                    }

                    // Guard against late/stale PROMPT_SUBMITTED from an old run:
                    // only accept if we actually dispatched something recently.
                    const lastDispatchAt = Number(entry?.lastDispatchAt || 0);
                    const attempts = Number(entry?.dispatchAttempts || 0);
                    const ageMs = lastDispatchAt ? (now - lastDispatchAt) : null;
                    const inFlight = flags ? flags.isInFlight : !!entry?.dispatchInFlight;
                    const stale = !inFlight && (attempts <= 0 || !lastDispatchAt || (typeof ageMs === 'number' && ageMs > 5 * 60 * 1000));
                    const confirmedFlag = typeof normalizedMeta?.confirmed === 'boolean' ? normalizedMeta.confirmed : null;

                    if (confirmedFlag === false) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_UNCONFIRMED', {
                            level: 'warning',
                            details: `attempts=${attempts} lastDispatchAgeMs=${ageMs ?? 'n/a'}`,
                            meta: {
                                dispatchId: incomingDispatchId || null,
                                runSessionId: incomingRunSessionId || expectedRunSessionId || null,
                                confirmed: false
                            }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'Submit signal without confirmation',
                            details: `dispatchId=${incomingDispatchId || 'n/a'} runSessionId=${incomingRunSessionId || 'n/a'}`,
                            level: 'warning'
                        });
                        sendResponse({ status: 'prompt_submitted_ack' });
                        break;
                    }

                    if (!alreadyConfirmed && (!stale || hasCorrelationMeta)) {
                        entry.promptSubmittedAt = now;
                        entry.lastRuntimeActivityAt = now;
                        entry.lastRuntimeActivitySource = 'prompt_submitted';
                        entry.csBusyUntil = 0;
                        entry.confirmedDispatchId = incomingDispatchId || entry?.lastDispatchMeta?.dispatchId || null;
                        entry.submitSource = 'content';
                        saveJobState(jobState);
                        if (self.DispatchStateManager) {
                            const machine = self.DispatchStateManager.get(llmName);
                            const states = self.DISPATCH_STATES || {};
                            if (machine.is(states.IDLE)) {
                                machine.queue({
                                    prompt: jobState?.prompt,
                                    attachments: jobState?.attachments || [],
                                    dispatchId: entry.confirmedDispatchId || `${llmName}:${now}`
                                });
                            }
                            if (machine.is(states.QUEUED)) {
                                machine.activate({ tabId: entry?.tabId ?? null, inferred: true });
                            }
                            if (machine.is(states.ACTIVATING)) {
                                machine.ready({ inferred: true });
                            }
                            if (machine.is(states.TYPING)) {
                                machine.submit({ inferred: true });
                            }
                            if (machine.is(states.SUBMITTING)) {
                                machine.sent({ confirmedAt: now, dispatchId: entry.confirmedDispatchId });
                            }
                        }
                        if (incomingDispatchId && self.DispatchIdRegistry?.markDispatchConfirmed) {
                            self.DispatchIdRegistry.markDispatchConfirmed(incomingDispatchId, {
                                llmName,
                                tabId: entry?.tabId || null
                            });
                        }
                        if (self.DispatchCircuit?.recordDispatchSuccess) {
                            self.DispatchCircuit.recordDispatchSuccess(llmName);
                        }
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_ACCEPTED', {
                            meta: {
                                dispatchId: entry.confirmedDispatchId,
                                runSessionId: incomingRunSessionId || expectedRunSessionId || null,
                                confirmed: confirmedFlag !== false
                            }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'Submit confirmation signal from content',
                            level: 'success'
                        });
                        if (typeof self.armScriptRuntimeHardStopForConfirmedPrompt === 'function') {
                            self.armScriptRuntimeHardStopForConfirmedPrompt(llmName, {
                                dispatchId: entry.confirmedDispatchId || incomingDispatchId || null,
                                tabId: entry?.tabId || null
                            });
                        }
                        resolvePromptSubmitted(llmName, { ok: true, ts: entry.promptSubmittedAt, meta: normalizedMeta, dispatchId: entry.confirmedDispatchId });
                        if (typeof self.scheduleAdaptiveCollectionProbe === 'function') {
                            self.scheduleAdaptiveCollectionProbe(
                                llmName,
                                expectedRunSessionId || jobState?.session?.startTime || null,
                                { reason: 'prompt_submitted', source: 'adaptive_submit' }
                            );
                        }
                    } else if (stale) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_STALE', {
                            details: `attempts=${attempts} lastDispatchAgeMs=${ageMs ?? 'n/a'} inFlight=${inFlight}`,
                            level: 'warning',
                            meta: { reason: 'stale', dispatchId: incomingDispatchId || null }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'PROMPT_SUBMITTED ignored (stale)',
                            details: `attempts=${attempts} lastDispatchAgeMs=${ageMs ?? 'n/a'} inFlight=${inFlight}`,
                            level: 'warning'
                        });
                    }
                }
                sendResponse({ status: 'prompt_submitted_ack' });
                break;
            }

            // v2.54 (2025-12-19 19:36): Handle early ready signals from content scripts
            case 'SCRIPT_READY_EARLY': {
                const llmName = message.llmName;
                if (llmName) {
                    console.log(`[BACKGROUND] Early ready signal received from ${llmName}`);
                    resolveEarlyReadySignal(llmName);
                    sendResponse({ status: 'early_ready_ack' });
                } else {
                    sendResponse({ status: 'early_ready_ignored' });
                }
                break;
            }
            case 'SCRIPT_READY': {
                const llmName = message.llmName;
                const tabId = sender?.tab?.id;
                if (tabId && self.ReadySignalManager?.handleReadySignal) {
                    const meta = message.meta || {};
                    const tabSessionId = message.tabSessionId || meta.tabSessionId || null;
                    const info = self.ReadySignalManager.handleReadySignal(tabId, llmName, {
                        ...meta,
                        tabSessionId
                    });
                    const dispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || null;
                    const ackPayload = {
                        type: 'ACK_READY',
                        llmName,
                        tabSessionId,
                        dispatchId,
                        ackAt: Date.now()
                    };
                    console.log(`[READY] ACK_READY -> ${llmName} tab=${tabId} session=${tabSessionId || 'n/a'}`);
                    chrome.tabs.sendMessage(tabId, ackPayload).catch(() => {});
                    try {
                        if (typeof sendMessageToResultsTab === 'function') {
                            sendMessageToResultsTab({
                                type: 'SMART_SCRIPT_READY_ACK',
                                llmName,
                                tabId,
                                tabSessionId,
                                dispatchId,
                                ackAt: ackPayload.ackAt
                            });
                        }
                    } catch (_) {}
                    self.ReadySignalManager.markAcked?.(tabId, ackPayload);
                    sendResponse({ status: 'ready_ack', info });
                } else {
                    sendResponse({ status: 'ready_ignored' });
                }
                break;
            }
            case 'ANSWER_SNAPSHOT': {
                (async () => {
                    try {
                        if (typeof self.saveAnswerSnapshotFromContent !== 'function') {
                            sendResponse({ status: 'snapshot_ignored', reason: 'collector_unavailable' });
                            return;
                        }
                        const result = await self.saveAnswerSnapshotFromContent(message, sender);
                        sendResponse(result);
                    } catch (err) {
                        console.warn('[LateAnswerCollector] ANSWER_SNAPSHOT failed', err);
                        sendResponse({ status: 'snapshot_failed', error: err?.message || String(err) });
                    }
                })();
                return true;
            }
            case 'SPA_NAVIGATION': {
                const tabId = sender?.tab?.id;
                const llmName = message.llmName || (tabId ? TabMapManager.getNameByTabId(tabId) : null);
                if (tabId && self.ReadySignalManager?.markTabNotReady) {
                    self.ReadySignalManager.markTabNotReady(tabId);
                }
                if (llmName && typeof initRequestMetadata === 'function') {
                    initRequestMetadata(llmName, tabId || null, message.newUrl || message.newURL || '');
                }
                if (llmName && jobState?.llms?.[llmName]) {
                    const entry = jobState.llms[llmName];
                    entry.lastSpaNavigationAt = Date.now();
                    const newUrl = message.newUrl || message.newURL || '';
                    if (newUrl) {
                        entry.lastKnownUrl = newUrl;
                    }
                }
                emitTelemetry(llmName || 'ROUNDS', 'SPA_NAVIGATION', {
                    details: message.reason || 'url_change',
                    meta: {
                        tabId: tabId || null,
                        llmName: llmName || null,
                        newUrl: message.newUrl || message.newURL || null
                    }
                });
                sendResponse({ status: 'spa_navigation_ack' });
                break;
            }

            // Purpose: ensure focus requests only activate the current session/tab.
            case 'NEED_FOCUS': {
                const tabId = sender?.tab?.id;
                const requestSessionId = message.sessionId;
                const currentSessionId = jobState?.session?.startTime || null;
                const reason = message.reason || 'unknown';

                if (!tabId || !requestSessionId || requestSessionId !== currentSessionId) {
                    console.log(`[NEED_FOCUS] Ignored stale focus request from tab ${tabId} (session ${requestSessionId})`);
                    if (tabId) {
                        chrome.tabs.sendMessage(tabId, {
                            type: 'SESSION_EXPIRED',
                            currentSessionId
                        }).catch(() => {});
                    }
                    sendResponse({ status: 'focus_denied_stale' });
                    break;
                }

                const llmName = message.model || (tabId ? TabMapManager.getNameByTabId(tabId) : null);
                if (!llmName) {
                    console.log('[NEED_FOCUS] Ignored: unknown LLM for focus request');
                    sendResponse({ status: 'focus_denied_unknown_llm' });
                    break;
                }

                const expectedTabId = TabMapManager.get(llmName);
                if (!expectedTabId || expectedTabId !== tabId) {
                    console.log(`[NEED_FOCUS] Ignored: tab ${tabId} is not mapped to ${llmName}`);
                    sendResponse({ status: 'focus_denied_wrong_tab' });
                    break;
                }

                const entry = jobState?.llms?.[llmName];
                if (!entry) {
                    console.log(`[NEED_FOCUS] Ignored: ${llmName} has no active entry`);
                    sendResponse({ status: 'focus_denied_no_entry' });
                    break;
                }

                const terminalStatuses = ['SUCCESS', 'ERROR', 'STOPPED', 'TIMEOUT'];
                if (terminalStatuses.includes(entry.status)) {
                    console.log(`[NEED_FOCUS] Ignored: ${llmName} is in terminal status ${entry.status}`);
                    sendResponse({ status: 'focus_denied_terminal' });
                    break;
                }

                console.log(`[NEED_FOCUS] Activating tab ${tabId} for ${llmName} (reason: ${reason})`);
                if (typeof self.activateTabForDispatch === 'function') {
                    self.activateTabForDispatch(tabId);
                } else {
                    chrome.tabs.update(tabId, { active: true }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn('[NEED_FOCUS] chrome.tabs.update failed:', chrome.runtime.lastError.message);
                        }
                    });
                }
                sendResponse({ status: 'focus_granted' });
                break;
            }

            case 'HUMANOID_EVENT': {
                const event = message.event;
                const detail = message.detail || {};
                const source = detail.source || '';

                // Extract LLM name from source (e.g., "lechat:inject" -> "Le Chat")
                const llmName = (() => {
                    if (source.includes('lechat')) return 'Le Chat';
                    if (source.includes('claude')) return 'Claude';
                    if (source.includes('grok')) return 'Grok';
                    if (source.includes('chatgpt')) return 'ChatGPT';
                    if (source.includes('gemini')) return 'Gemini';
                    if (source.includes('deepseek')) return 'DeepSeek';
                    if (source.includes('qwen')) return 'Qwen';
                    if (source.includes('perplexity')) return 'Perplexity';
                    return null;
                })();

                if (!llmName) {
                    sendResponse({ status: 'humanoid_event_ignored' });
                    break;
                }

                // Handle different event types
                if (event === 'activity:heartbeat') {
                    const phase = detail.phase || '';
                    const status = (() => {
                        switch (phase) {
                            case 'composer-search':
                                return 'INITIALIZING';
                            case 'composer-ready':
                                return 'PROMPT_READY';
                            case 'typing':
                                return 'INJECTING';
                            case 'send-dispatched':
                                return 'SENDING';
                            case 'waiting-response':
                            case 'pipeline':
                                return 'RECEIVING';
                            case 'response-processed':
                                return 'COMPLETE';
                            default:
                                return null;
                        }
                    })();

                    if (status) {
                        updateModelState(llmName, status, {
                            phase,
                            progress: detail.progress || 0,
                            message: `Phase: ${phase}`
                        });
                    }
                } else if (event === 'activity:start') {
                    updateModelState(llmName, 'INITIALIZING', {
                        message: 'Starting activity...'
                    });
                } else if (event === 'activity:stop') {
                    // Don't change status - let handleLLMResponse set the final status
                    // Just log the lifecycle event
                    appendLogEntry(llmName, {
                        type: 'LIFECYCLE',
                        label: 'Activity lifecycle completed',
                        details: detail.answerLength ? `Answer received, length: ${detail.answerLength}` : '',
                        level: 'info'
                    });
                } else if (event === 'activity:error') {
                    // Only update status indicator for FATAL errors (selector not found, injection failed)
                    // Timeouts and pipeline errors are handled by handleLLMResponse
                    if (detail.fatal) {
                        updateModelState(llmName, 'CRITICAL_ERROR', {
                            message: detail.error || 'Critical error occurred'
                        });
                    }
                }

                sendResponse({ status: 'humanoid_event_processed' });
                break;
            }

            case 'CONTENT_CLEANING_STATS':
                console.log(`[BACKGROUND] Cleaning stats from ${message.llmName}:`, message.stats);
                sendResponse({ status: 'stats_received' });
                break;

            case 'METRICS_REPORT':
                console.log(`[BACKGROUND] Metrics report from ${message.llmName}:`, message.metrics);
                sendResponse({ status: 'metrics_received' });
                break;

            case 'SELECTOR_METRIC': {
                const event = message.event;
                const payload = message.payload || {};
                if (event === 'selector_search_failed' || event === 'selector_search_error') {
                    recordSelectorFailureMetric({
                        modelName: payload.modelName,
                        elementType: payload.elementType,
                        event
                    }).then(() => {
                        sendResponse({ status: 'metric_recorded' });
                    }).catch((err) => {
                        console.warn('[BACKGROUND] Failed to record selector metric', err);
                        sendResponse({ status: 'metric_error', error: err?.message });
                    });
                    return true;
                }
                sendResponse({ status: 'metric_ignored' });
                break;
            }

            case 'METRIC_EVENT':
                if (message.event === 'selector_resolution') {
                    recordResolutionMetric({
                        modelName: message.modelName,
                        elementType: message.elementType,
                        layer: message.layer || message.method
                    })
                        .then(() => sendResponse({ status: 'metric_recorded' }))
                        .catch((err) => {
                            console.warn('[BACKGROUND] Failed to record metric event', err);
                            sendResponse({ status: 'metric_error', error: err?.message });
                        });
                    return true;
                }
                sendResponse({ status: 'metric_ignored' });
                break;

            case 'VISUAL_RESOLVE_REQUEST':
                sendResponse({
                    ok: false,
                    disabled: true,
                    reason: 'visual_resolver_not_enabled'
                });
                break;

            case 'LLM_RESPONSE_READY':
                if (message.llmName) {
                    const entry = jobState?.llms?.[message.llmName];
                    const entryStatus = String(entry?.finalStatus || entry?.status || '').toUpperCase();
                    const isTerminal = Boolean(
                        entry
                        && (entry.finalStatusRecorded || entry.finalStatus || TERMINAL_STATUSES.includes(entryStatus))
                    );
                    if (isTerminal) {
                        if (self.ModelRunState?.recordPostTerminalNoise) {
                            self.ModelRunState.recordPostTerminalNoise(entry, {
                                label: 'LLM_RESPONSE_READY',
                                ts: Date.now()
                            });
                            try { saveJobState(jobState); } catch (_) {}
                        }
                        sendResponse({ status: 'response_ready_ignored_terminal' });
                        break;
                    }
                    if (entry) {
                        entry.lifecycleReadyAt = Date.now();
                        entry.lifecycleReadyMeta = message.meta || {};
                        entry.earlyTerminalGuard = null;
                        entry.earlyTerminalGuardNextPingAt = 0;
                        if (self.ModelRunState?.applyModelRunTransition) {
                            self.ModelRunState.applyModelRunTransition(entry, 'LIFECYCLE_READY', {
                                status: 'RECEIVING',
                                dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
                                tabId: entry?.tabId || null,
                                runSessionId: jobState?.session?.startTime || null
                            });
                        }
                        try { saveJobState(jobState); } catch (_) {}
                    }
                    updateModelState?.(message.llmName, 'RECEIVING', {
                        message: 'Answer appears complete; ready for collection',
                        lifecycle: message.meta || {}
                    });
                }
                sendResponse({ status: 'response_ready_ack' });
                break;

            case 'STORE_TAB_STATE': {
                const tabId = sender?.tab?.id;
                if (!tabId || !message.state) {
                    sendResponse({ status: 'ignored' });
                    break;
                }
                const key = `state_${tabId}`;
                if (!self.__TAB_STATE_CACHE__) {
                    self.__TAB_STATE_CACHE__ = new Map();
                }
                self.__TAB_STATE_CACHE__.set(tabId, Object.assign({}, message.state, {
                    tabId
                }));
                chrome.storage.local.set({ [key]: message.state }, () => {
                    sendResponse({ status: 'stored', key });
                });
                return true;
            }

            case 'GET_ALL_STATES': {
                chrome.storage.local.get(null, (all) => {
                    const raw = Object.entries(all || {}).filter(([k]) => k.startsWith('state_'));
                    const best = new Map();
                    raw.forEach(([key, value]) => {
                        const sid = value?.sessionId || key.replace('state_', '');
                        const platform = value?.platform || 'unknown';
                        const composite = `${platform}::${sid}`;
                        const existing = best.get(composite);
                        const score = key.includes(`${platform}_`) ? 2 : 1; // prefer platform-specific key
                        const existingScore = existing ? (existing.__score || 0) : 0;
                        if (!existing || score > existingScore || (score === existingScore && (value?.updatedAt || 0) > (existing.updatedAt || 0))) {
                            if (value) {
                                value.__score = score;
                                best.set(composite, value);
                            }
                        }
                    });
                    let states = Array.from(best.values())
                        .map((v) => { const { __score, ...rest } = v || {}; return rest; })
                        .sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
                    const runFilter = message?.runId || message?.sessionId || null;
                    if (runFilter) {
                        states = states.filter((s) => s?.sessionId === runFilter);
                    }
                    sendResponse({ success: true, states });
                });
                return true;
            }

            case 'SUBMIT_PROMPT': {
                (async () => {
                    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    const baseCommand = {
                        id: commandId,
                        action: 'submit_prompt',
                        payload: { prompt: message.prompt, platforms: message.platforms },
                        createdAt: Date.now()
                    };
                    const delivery = await broadcastCommandToLlmTabs(baseCommand);
                    const targetPlatforms = Array.isArray(message.platforms) && message.platforms.length
                        ? message.platforms
                        : Object.keys(LLM_TARGETS || {});
                    const pendingEntries = {};
                    targetPlatforms.forEach((platform) => {
                        const scopedCommand = Object.assign({}, baseCommand, {
                            payload: Object.assign({}, baseCommand.payload, { platforms: [platform] }),
                            targetPlatform: platform
                        });
                        pendingEntries[`pending_command_${platform}`] = scopedCommand;
                    });
                    try {
                        const targetStore = chrome.storage?.session || chrome.storage.local;
                        await targetStore.set(Object.assign({}, pendingEntries, { pending_command: baseCommand }));
                    } catch (_) {
                        await chrome.storage.local.set(Object.assign({}, pendingEntries, { pending_command: baseCommand }));
                    }
                    sendResponse({ success: true, commandId, delivered: delivery.sent, platforms: targetPlatforms });
                })();
                return true;
            }

            case 'STOP_ALL': {
                (async () => {
                    const cmd = { action: 'STOP_ALL', timestamp: Date.now(), platforms: message.platforms };
                    await chrome.storage.local.set({ global_command: cmd });
                    stopAllProcesses('stop_all_command', { closeTabs: false });
                    sendResponse({ success: true });
                })();
                return true;
            }

            case 'COMMAND_ACK': {
                (async () => {
                    try {
                        const { commandId, ack } = message || {};
                        const platformKey = ack?.platform ? `pending_command_${ack.platform}` : null;
                        const stores = [chrome.storage?.session, chrome.storage?.local].filter(Boolean);
                        await Promise.all(stores.map(async (store) => {
                            try {
                                const data = await store.get(null);
                                const keysToRemove = [];
                                if (platformKey) keysToRemove.push(platformKey);
                                // если не осталось других pending_command_ — убираем alias
                                const pendingKeys = Object.keys(data || {}).filter((k) => k.startsWith('pending_command_'));
                                if (pendingKeys.length <= 1) {
                                    keysToRemove.push('pending_command');
                                }
                                if (keysToRemove.length) await store.remove(keysToRemove);
                            } catch (_) {}
                        }));
                        sendResponse({ success: true });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'SET_SETTINGS': {
                (async () => {
                    try {
                        const next = Object.assign({}, message.settings || {});
                        await chrome.storage.local.set({ settings: next });
                        try {
                            chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: next });
                        } catch (_) {}
                        sendResponse({ success: true, settings: next });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_SETTINGS': {
                (async () => {
                    try {
                        const res = await chrome.storage.local.get(['settings']);
                        sendResponse({ success: true, settings: res?.settings || {} });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'DIAG_EVENT': {
                (async () => {
                    try {
                        const evt = Object.assign({}, message.event || {}, {
                            ts: Date.now(),
                            platform: message.event?.platform || message.platform || null,
                            traceId: message.event?.traceId || null,
                            sessionId: message.event?.sessionId || null,
                            source: message.event?.source || sender?.url || sender?.tab?.url || null
                        });
                        let next = diagTrimDiagnosticsBuffer([...await readDiagnosticsEventsFromStorage(), evt], 200);
                        // Дополнительный guard по размеру: если >50KB, отрезаем старые
                        const stringify = () => JSON.stringify(next);
                        while (stringify().length > 50000 && next.length > 1) {
                            next = diagDropOldestUnpinned(next);
                        }
                        await writeDiagnosticsEventsToStorage(next);
                        sendResponse({ success: true });
                    } catch (err) {
                        console.warn('[DIAG_EVENT] store failed', err);
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_DIAG_EVENTS': {
                (async () => {
                    try {
                        const { platforms, limit } = message || {};
                        let arr = await readDiagnosticsEventsFromStorage();
                        if (Array.isArray(platforms) && platforms.length) {
                            const set = new Set(platforms.map((p) => String(p).toLowerCase()));
                            arr = arr.filter((e) => set.has(String(e?.platform || 'unknown').toLowerCase()));
                        }
                        const capSize = (limit && Number.isFinite(limit)) ? limit : 200;
                        const capped = diagTrimDiagnosticsBuffer(arr, capSize);
                        sendResponse({ success: true, events: capped });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'CLEAR_DIAG_EVENTS': {
                (async () => {
                    try {
                        await writeDiagnosticsEventsToStorage([]);
                        const runtimeCleared = clearDiagnosticsRuntimeLogs();
                        sendResponse({ success: true, runtimeCleared });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'SMOKE_CHECK': {
                (async () => {
                    try {
                        const platform = message?.platform;
                        const tabId = message?.tabId;
                        const targetTabId = tabId || (await new Promise((resolve) => {
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]?.id));
                        }));
                        if (!targetTabId) {
                            sendResponse({ success: false, error: 'no_tab' });
                            return;
                        }
                        const resp = await new Promise((resolve) => {
                            let settled = false;
                            let timer = null;
                            timer = routerRegisterSessionTimer(setTimeout(() => {
                                if (settled) return;
                                settled = true;
                                resolve({ success: false, error: 'timeout' });
                                routerDeregisterSessionTimer(timer);
                            }, 5000));
                            try {
                                chrome.tabs.sendMessage(targetTabId, { type: 'SMOKE_CHECK', platform }, (r) => {
                                    if (settled) return;
                                    settled = true;
                                    if (timer) {
                                        clearTimeout(timer);
                                        routerDeregisterSessionTimer(timer);
                                    }
                                    resolve(r || { success: false, error: chrome.runtime.lastError?.message || 'no_response' });
                                });
                            } catch (err) {
                                if (settled) return;
                                settled = true;
                                clearTimeout(timer);
                                resolve({ success: false, error: err?.message || 'send_error' });
                            }
                        });
                        try {
                            const event = {
                                type: 'smoke_check',
                                platform: platform || null,
                                ts: Date.now(),
                                status: resp?.success ? 'ok' : 'fail',
                                details: resp?.error || `${(resp?.report || []).length || 0} selectors checked`,
                                report: resp?.report || null
                            };
                            const res = await chrome.storage.local.get(['__diagnostics_events__']);
                            const arr = Array.isArray(res?.__diagnostics_events__) ? res.__diagnostics_events__ : [];
                            const next = [...arr, event].slice(-200);
                            await chrome.storage.local.set({ '__diagnostics_events__': next });
                        } catch (_) {}
                        sendResponse(resp || { success: false, error: 'unknown' });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_COMMAND_STATUS': {
                (async () => {
                    try {
                        const sessionAll = (chrome.storage?.session && await chrome.storage.session.get(null)) || {};
                        const localAll = await chrome.storage.local.get(null);
                        const merged = Object.assign({}, localAll || {}, sessionAll || {});
                        const pendingList = Object.entries(merged)
                            .filter(([k]) => k.startsWith('pending_command_'))
                            .map(([, v]) => v)
                            .filter(Boolean)
                            .sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
                        const pending = pendingList[0] || merged?.pending_command || null;
                        const platforms = Array.isArray(message.platforms) ? message.platforms : null;
                        const acks = Object.entries(merged || {})
                            .filter(([k]) => k.startsWith('cmd_ack_'))
                            .map(([, v]) => v)
                            .filter((v) => {
                                if (!platforms) return true;
                                return platforms.includes(v?.platform);
                            })
                            .sort((a, b) => (b?.executedAt || 0) - (a?.executedAt || 0))
                            .slice(0, 20);
                        const filteredPending = (!platforms || (pending && platforms.includes(pending?.payload?.platform))) ? pending : null;
                        sendResponse({ success: true, pending: filteredPending, acks });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'EVALUATOR_RESPONSE':
                handleEvaluatorResponse(message.answer);
                sendResponse({ status: 'evaluator_response_handled' });
                break;
                
            case 'REGISTER_RESULTS_TAB':
                resultsTabId = sender.tab.id;
                console.log("[BACKGROUND] Registered results tab:", resultsTabId);
                sendResponse({ status: 'registered' });
                break;
            
            case 'REQUEST_SELECTOR_VERSION_STATUS': {
                (async () => {
                    let snapshot = null;
                    if (message.forceRefresh) {
                        snapshot = await updateVersionStatusSnapshot();
                    }
                    if (!snapshot) {
                        snapshot = await getStoredVersionStatus();
                    }
                    sendResponse({ status: 'ok', snapshot });
                })();
                return true;
            }

            case 'REQUEST_SELECTOR_HEALTH_SUMMARY': {
                (async () => {
                    try {
                        const summary = await buildSelectorHealthSummary({
                            includeActiveVersions: !!message.includeActiveVersions
                        });
                        sendResponse({ status: 'ok', summary });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'health_summary_failed' });
                    }
                })();
                return true;
            }
            
            case 'REQUEST_SELECTOR_TELEMETRY':
                sendResponse({ status: 'ok', metrics: Object.fromEntries(selectorResolutionMetrics.entries()) });
                break;
            
            case 'REQUEST_SELECTOR_MODELS': {
                const models = Object.keys(self.SelectorConfig?.models || {});
                sendResponse({ status: 'ok', models });
                break;
            }

            case 'REQUEST_SELECTOR_DEFINITIONS': {
                const modelName = message.modelName;
                const cfg = self.SelectorConfig;
                if (!modelName || !cfg?.getModelConfig) {
                    sendResponse({ status: 'error', error: 'Unknown model' });
                    break;
                }
                const modelConfig = cfg.getModelConfig(modelName);
                if (!modelConfig) {
                    sendResponse({ status: 'error', error: 'Unknown model' });
                    break;
                }
                const versions = (modelConfig.versions || []).map((version) => {
                    const selectors = {};
                    SELECTOR_ELEMENT_TYPES.forEach((elementType) => {
                        selectors[elementType] = cfg.getSelectorsFor(modelName, version.version, elementType) || [];
                    });
                    return {
                        version: version.version,
                        uiRevision: version.uiRevision || '',
                        description: version.description || '',
                        selectors
                    };
                });
                sendResponse({ status: 'ok', modelName, versions });
                break;
            }

            case 'REQUEST_SELECTOR_ACTIVE_VERSION': {
                (async () => {
                    const modelName = message.modelName;
                    if (!modelName) {
                        sendResponse({ status: 'error', error: 'Missing model' });
                        return;
                    }
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'no_tab' });
                        return;
                    }
                    try {
                        const [result] = await chrome.scripting.executeScript({
                            target: { tabId },
                            func: (model, elementTypes) => {
                                if (!window.SelectorConfig || typeof window.SelectorConfig.detectUIVersion !== 'function') {
                                    return { ok: false, error: 'SelectorConfig unavailable' };
                                }
                                const version = window.SelectorConfig.detectUIVersion(model, document) || 'unknown';
                                const selectors = {};
                                elementTypes.forEach((elementType) => {
                                    selectors[elementType] = window.SelectorConfig.getSelectorsFor(model, version, elementType) || [];
                                });
                                return { ok: true, version, selectors };
                            },
                            args: [modelName, SELECTOR_ELEMENT_TYPES]
                        });
                        if (result?.result?.ok) {
                            sendResponse({ status: 'ok', tabId, version: result.result.version, selectors: result.result.selectors });
                        } else {
                            sendResponse({ status: 'error', error: result?.result?.error || 'active_version_failed' });
                        }
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'active_version_failed' });
                    }
                })();
                return true;
            }

            case 'VALIDATE_SELECTORS': {
                (async () => {
                    const modelName = message.modelName;
                    const selectors = Array.isArray(message.selectors) ? message.selectors : [];
                    if (!modelName || !selectors.length) {
                        sendResponse({ status: 'error', error: 'Missing selectors' });
                        return;
                    }
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'no_tab' });
                        return;
                    }
                    const result = await validateSelectorsOnTab(tabId, selectors);
                    if (result?.ok) {
                        sendResponse({ status: 'ok', results: result.results || [], tabId });
                    } else {
                        sendResponse({ status: 'error', error: result?.error || 'validation_failed' });
                    }
                })();
                return true;
            }

            case 'REQUEST_SELECTOR_OVERRIDE_AUDIT': {
                (async () => {
                    try {
                        const limit = Number.isFinite(message.limit) ? message.limit : SELECTOR_OVERRIDE_AUDIT_LIMIT;
                        const entries = await readSelectorOverrideAudit(limit);
                        sendResponse({ status: 'ok', entries });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'audit_failed' });
                    }
                })();
                return true;
            }
            
            case 'SAVE_SELECTOR_OVERRIDE': {
                (async () => {
                    try {
                        const overrides = await saveManualSelectorOverride(message.modelName, message.elementType, message.selector);
                        await appendSelectorOverrideAudit({
                            modelName: message.modelName,
                            elementType: message.elementType,
                            selector: message.selector,
                            reason: message.reason || '',
                            source: 'devtools'
                        });
                        sendResponse({ status: 'ok', overrides: overrides[message.modelName] || {} });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'Failed to save override' });
                    }
                })();
                return true;
            }

            case 'PICK_SELECTOR_START': {
                (async () => {
                    const { modelName, elementType, mode } = message;
                    if (!modelName) {
                        sendResponse({ status: 'error', error: 'Missing model' });
                        return;
                    }
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'error', error: 'Model tab not active' });
                        return;
                    }
                    const requestId = `pick-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
                    pickerRequests.set(requestId, { modelName, elementType, startedAt: Date.now() });
                    chrome.tabs.sendMessage(
                        tabId,
                        { type: 'PICKER_START', mode: mode || 'selector', requestId, elementType },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                pickerRequests.delete(requestId);
                                sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
                                return;
                            }
                            if (response && response.ok === false) {
                                pickerRequests.delete(requestId);
                                sendResponse({ status: 'error', error: response.error || 'Picker unavailable' });
                                return;
                            }
                            sendResponse({ status: 'ok', requestId });
                        }
                    );
                })();
                return true;
            }

            case 'PICKER_CANCEL': {
                (async () => {
                    const requestId = message.requestId || null;
                    const requestMeta = requestId ? pickerRequests.get(requestId) : null;
                    const modelName = message.modelName || requestMeta?.modelName || null;
                    if (requestId) pickerRequests.delete(requestId);
                    const tabId = modelName ? await resolveTabForLlmNameAsync(modelName) : null;
                    if (!tabId) {
                        sendResponse({ status: 'error', error: 'Model tab not active' });
                        return;
                    }
                    chrome.tabs.sendMessage(tabId, { type: 'PICKER_CANCEL', requestId }, () => {
                        if (chrome.runtime.lastError) {
                            sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
                            return;
                        }
                        sendResponse({ status: 'ok' });
                    });
                })();
                return true;
            }

            case 'HIGHLIGHT_SELECTOR': {
                const { modelName, selector } = message;
                (async () => {
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'error', error: 'Model tab not active' });
                        return;
                    }
                    chrome.scripting.executeScript({
                        target: { tabId },
                        func: (cssSelector) => {
                            if (!window.SelectorFinder || typeof window.SelectorFinder.previewSelector !== 'function') {
                                return { ok: false, error: 'Preview unavailable' };
                            }
                            const success = window.SelectorFinder.previewSelector(cssSelector);
                            return { ok: success };
                        },
                        args: [selector]
                    }).then(([result]) => {
                        if (result?.result?.ok) {
                            sendResponse({ status: 'ok' });
                        } else {
                            sendResponse({ status: 'error', error: result?.result?.error || 'No response' });
                        }
                    }).catch((err) => {
                        sendResponse({ status: 'error', error: err?.message || 'Highlight failed' });
                    });
                })();
                return true;
            }

            case 'PICKER_RESULT': {
                const requestId = message.requestId || null;
                const requestMeta = requestId ? pickerRequests.get(requestId) : null;
                if (requestId) pickerRequests.delete(requestId);
                sendMessageToResultsTab({
                    type: 'PICKER_RESULT',
                    requestId,
                    payload: message.payload || null,
                    modelName: requestMeta?.modelName || null,
                    elementType: requestMeta?.elementType || null
                });
                sendResponse({ status: 'ok' });
                break;
            }

            case 'PICKER_CANCELLED': {
                const requestId = message.requestId || null;
                if (requestId) pickerRequests.delete(requestId);
                sendMessageToResultsTab({
                    type: 'PICKER_CANCELLED',
                    requestId,
                    reason: message.reason || null
                });
                sendResponse({ status: 'ok' });
                break;
            }

        case 'HUMAN_VISIT_CONTROL':
            handleHumanVisitControl(message.action);
            sendResponse({ status: 'ok' });
            break;

        case 'HUMAN_VISIT_MODEL_TOGGLE':
            handleHumanVisitModelToggle(message.llmName, message.enabled);
            sendResponse({ status: 'ok' });
            break;

        case 'REQUEST_HUMAN_VISIT_STATUS':
            sendResponse({ status: 'ok', payload: {
                active: humanPresenceActive,
                paused: humanPresencePaused,
                stopped: humanPresenceManuallyStopped,
                pending: hasPendingHumanVisits(),
                llms: jobState?.llms
                    ? Object.entries(jobState.llms).map(([name, entry]) => ({
                        name,
                        status: entry?.status || 'IDLE',
                        visits: entry?.humanVisits || 0,
                        stalled: !!entry?.humanStalled,
                        skipped: !!entry?.skipHumanLoop
                    }))
                    : []
            }});
            break;

            case 'CLEAR_SELECTOR_CACHE': {
                (async () => {
                    try {
                        const removed = await clearSelectorCache();
                        sendResponse({ status: 'ok', removed });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'Failed to clear cache' });
                    }
                })();
                return true;
            }

            case 'RUN_SELECTOR_HEALTHCHECK': {
                (async () => {
                    const pairs = TabMapManager.entries();
                    if (!pairs.length) {
                        sendResponse({ status: 'error', error: 'No active LLM tabs available for check' });
                        return;
                    }
                    const results = await Promise.all(pairs.map(([llmName, tabId]) => runSelectorHealthCheckForTab(llmName, tabId)));
                    await Promise.all(results.map((entry) => {
                        if (entry?.ok && Array.isArray(entry.report)) {
                            return updateSelectorHealthChecks(entry.llmName, entry.report);
                        }
                        return Promise.resolve();
                    }));
                    results.forEach((entry) => {
                        appendLogEntry(entry.llmName, {
                            type: 'SELECTOR_HEALTH',
                            label: entry.ok ? 'Health-check success' : 'Health-check failed',
                            details: entry.ok ? '' : entry.error,
                            level: entry.ok ? 'info' : 'warning'
                        });
                    });
                    sendResponse({ status: 'ok', results });
                })();
                return true;
            }

            case 'HEALTH_CHECK_PONG':
                if (pendingPings.has(message.pingId)) {
                    const meta = pendingPings.get(message.pingId);
                    console.log(`[HEALTH-CHECK] PONG received from ${meta.llmName}`);
                    pendingPings.delete(message.pingId);
                    if (meta?.tabId && pendingPingByTabId.get(meta.tabId) === message.pingId) {
                        pendingPingByTabId.delete(meta.tabId);
                        healthCheckFailuresByTabId.delete(meta.tabId);
                        lastHealthCheckReportAtByTabId.delete(meta.tabId);
                    }
                }
                sendResponse({ status: 'pong_received' });
                break;

            case 'CLOSE_ALL_SESSIONS':
                closeAllSessions();
                sendResponse({ status: 'sessions_closed' });
                break;
                
            //-- 4.5. Ручная команда cleanup из UI --//
        case 'CLEAR_ALL_SESSIONS':
            TabMapManager.entries().forEach(([llmName, tabId]) => {
                chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }).catch(() => {});
            });
            // Purpose: clear the tab map asynchronously during session shutdown.
            TabMapManager.clear().catch((err) => {
                console.warn('[BACKGROUND] TabMapManager.clear failed:', err);
            });
            jobState = {};
            clearAllDeferredAnswerTimers();
            stopHumanPresenceLoop();
            finalizeTabVisit('session_cleared');
            humanPresencePaused = false;
            humanPresenceManuallyStopped = false;
            Object.keys(llmActivityMap).forEach((tabId) => delete llmActivityMap[tabId]);
            clearActiveListeners();
            broadcastGlobalState();
            sendResponse({ status: 'all_sessions_cleared' });
            break;

            case 'MANUAL_RESPONSE_PING': {
                (async () => {
                    try {
                        const result = await handleManualResponsePing(message.llmName, {
                            advanceStrategy: message.advanceStrategy === true || message.advanceSelector === true,
                            manualRecovery: message.manualRecovery !== false,
                            reason: message.reason || 'manual_button'
                        });
                        sendResponse(result);
                    } catch (err) {
                        console.error('[BACKGROUND] Manual ping handler failed', err);
                        sendResponse({ status: 'manual_ping_failed', error: err?.message || 'Ping error' });
                    }
                })();
                return true;
            }

            case 'REQUEST_LLM_RESPONSE': {
                const llmName = message.llmName;
                const entry = llmName ? jobState?.llms?.[llmName] : null;
                const entryStatus = String(entry?.status || entry?.finalStatus || '').toUpperCase();
                const hasCachedAnswer = Boolean(entry && entry.answer);
                const isTerminal = Boolean(entry && (entry.finalStatusRecorded || entry.finalStatus || TERMINAL_STATUSES.includes(entryStatus)));
                const shouldAdvanceStrategy = message.advanceStrategy === true;
                if (entry && entry.answer) {
                    sendMessageToResultsTab({
                        type: 'LLM_PARTIAL_RESPONSE',
                        llmName,
                        answer: entry.answer,
                        answerHtml: entry.answerHtml || '',
                        requestId: entry.requestId || null,
                        metadata: { status: entry.status || 'UNKNOWN' },
                        logs: getLogSnapshot(llmName)
                    });
                }
                if (isTerminal && hasCachedAnswer && !shouldAdvanceStrategy) {
                    sendResponse({ status: 'cached_response_sent' });
                    break;
                }
                (async () => {
                    try {
                        const result = await handleManualResponsePing(llmName, {
                            advanceStrategy: shouldAdvanceStrategy,
                            manualRecovery: message.manualRecovery !== false,
                            reason: message.reason || 'request_llm_response'
                        });
                        sendResponse(result);
                    } catch (err) {
                        console.error('[BACKGROUND] Manual ping handler failed', err);
                        sendResponse({ status: 'manual_ping_failed', error: err?.message || 'Ping error' });
                    }
                })();
                return true;
            }

            case 'LLM_DIAGNOSTIC_EVENT': {
                const event = message.event || {};
                const resolvedName = resolveEventLlmName(message, event, sender);
                if (!resolvedName) {
                    sendResponse({ status: 'diagnostic_missing_llm' });
                    break;
                }
                if (isTelemetryEntry(event)) {
                    const saved = dispatchTelemetry(resolvedName, event, { sender, source: event?.source });
                    sendResponse({ status: 'diagnostic_logged', stored: !!saved, sampled: !!saved });
                    break;
                }
                const saved = broadcastDiagnostic(resolvedName, event);
                if (saved) {
                    updateTypingStateFromDiagnostic(resolvedName, saved);
                }
                (async () => {
                    try {
                        const persisted = saved
                            ? await persistDiagnosticEvent(resolvedName, saved, { sender, source: event?.source })
                            : null;
                        sendResponse({ status: 'diagnostic_logged', stored: !!persisted });
                    } catch (err) {
                        console.warn('[LLM_DIAGNOSTIC_EVENT] store failed', err);
                        sendResponse({ status: 'diagnostic_logged', stored: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'PIPELINE_EVENT': {
                const event = message.event || {};
                const resolvedName = resolveEventLlmName(message, event, sender);
                const payload = {
                    ...event,
                    type: event.type || 'PIPELINE',
                    label: event.label || event.event || event?.meta?.event || 'PIPELINE'
                };
                const force = ['PIPELINE_COMPLETE', 'FINALIZATION_DONE', 'STREAMING_DONE'].includes(payload.label);
                const saved = dispatchTelemetry(resolvedName, payload, { sender, source: event?.source, force });
                sendResponse({ status: 'pipeline_logged', stored: !!saved, sampled: !!saved });
                break;
            }

            case 'TELEMETRY_EVENT': {
                const event = message.event || {};
                const resolvedName = resolveEventLlmName(message, event, sender);
                const label = event.phase || event.event || 'TELEMETRY_EVENT';
                const payload = {
                    type: 'TELEMETRY',
                    label,
                    details: event.reason || event.message || '',
                    level: event.level || 'info',
                    meta: { ...event, event: label }
                };
                const saved = dispatchTelemetry(resolvedName, payload, { sender, source: event?.source });
                sendResponse({ status: 'telemetry_logged', stored: !!saved, sampled: !!saved });
                break;
            }
            case 'REFRESH_SELECTOR_OVERRIDES': {
                if (!remoteSelectorsAllowed) {
                    const result = { success: false, error: 'remote_overrides_disabled' };
                    sendMessageToResultsTab({ type: 'SELECTOR_OVERRIDE_REFRESH_RESULT', result });
                    sendResponse({ status: 'rejected', reason: 'remote_overrides_disabled' });
                    break;
                }
                fetchRemoteSelectors()
                    .then((result) => {
                        sendMessageToResultsTab({ type: 'SELECTOR_OVERRIDE_REFRESH_RESULT', result });
                    })
                    .catch((err) => {
                        sendMessageToResultsTab({
                            type: 'SELECTOR_OVERRIDE_REFRESH_RESULT',
                            result: { success: false, error: err?.message || 'refresh failed' }
                        });
                    });
                sendResponse({ status: 'accepted' });
                break;
            }
            case 'CLEAR_SELECTOR_OVERRIDES_AND_CACHE': {
                clearSelectorOverridesAndCache()
                    .then((result) => {
                        sendMessageToResultsTab({
                            type: 'SELECTOR_OVERRIDE_CLEARED',
                            success: true,
                            removed: result.removed || []
                        });
                    })
                    .catch((err) => {
                        sendMessageToResultsTab({
                            type: 'SELECTOR_OVERRIDE_CLEARED',
                            success: false,
                            error: err?.message || 'cleanup failed'
                        });
                    });
                sendResponse({ status: 'accepted' });
                break;
            }
            case 'MANUAL_RESEND_REQUEST': {
                console.log('[BACKGROUND] Manual resend handler invoked for', message.llmName);
                Promise.resolve().then(() => {
                    let result;
                    try {
                        result = handleManualResendRequest(message.llmName);
                    } catch (err) {
                        console.error('[BACKGROUND] Manual resend handler crashed:', err);
                        result = {
                            status: 'manual_resend_failed',
                            error: err?.message || 'Unexpected manual resend error'
                        };
                    }
                    console.log('[BACKGROUND] Manual resend handler replying', result);
                    try {
                        sendResponse(result);
                    } catch (err) {
                        console.error('[BACKGROUND] Failed to send manual resend response:', err);
                    }
                });
                return true;
            }
            case 'MANUAL_PING_RESULT': {
                if (message.llmName && message.status === 'failed') {
                    broadcastDiagnostic(message.llmName, {
                        type: 'PING_ERROR',
                        label: 'Manual ping failed',
                        details: message.error || 'unknown',
                        level: 'error'
                    });
                }
                if (message.llmName) {
                    const status = message.status || 'unknown';
                    const isSuccess = status === 'success';
                    const label = isSuccess ? 'MANUAL_PING_SUCCESS' : 'MANUAL_PING_FAIL';
                    emitTelemetry(message.llmName, label, {
                        level: isSuccess ? 'success' : 'warning',
                        details: status,
                        meta: {
                            status,
                            pingId: message.pingId || null,
                            error: message.error || null
                        }
                    });
                }
                sendMessageToResultsTab(message);
                sendResponse({ status: 'manual_ping_notified' });
                break;
            }
            default:
                sendResponse({ status: 'unknown_message' });
                break;
        }
        return false;
    };

    const runSafely = () => {
        try {
            return processMessage();
        } catch (err) {
            console.error('[BACKGROUND] Failed to process runtime message:', err);
            try {
                sendResponse({ status: 'error', error: err?.message || 'internal_error' });
            } catch (responseErr) {
                console.error('[BACKGROUND] Failed to respond with error:', responseErr);
            }
            return false;
        }
    };

    if (!isInitialStateReady()) {
        ensureInitialState()
            .then(runSafely)
            .catch((err) => {
                console.error('[BACKGROUND] Failed to initialize state before handling message:', err);
                try {
                    sendResponse({ status: 'error', error: err?.message || 'initialization_failed' });
                } catch (responseErr) {
                    console.error('[BACKGROUND] Failed to respond with initialization error:', responseErr);
                }
            });
        return true;
    }

    return runSafely();
});

function removeActiveListenerForTab(tabId) {
    const entry = activeListeners.get(tabId);
    if (!entry) return;
    try {
        chrome.tabs.onUpdated.removeListener(entry.listener);
        console.log(`[BACKGROUND] Removed listener for tab ${tabId}`);
    } catch (e) {
        console.warn(`[BACKGROUND] Error removing listener for tab ${tabId}:`, e);
    }
    if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
    }
    activeListeners.delete(tabId);
}

function clearActiveListeners() {
    Array.from(activeListeners.keys()).forEach(removeActiveListenerForTab);
}
