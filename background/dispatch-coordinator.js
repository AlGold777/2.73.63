// background/dispatch-coordinator.js
// Dispatch coordination helpers for prompt delivery and retry supervision.

'use strict';

var dispatchMutexManager = new MutexManager();
var promptDispatchFocusMutex = Promise.resolve();
var promptSubmitWaiters = new Map();
var promptDispatchSupervisorTimer = null;
//- 2.1. Лимит ожидания сигнала из контента -//
const PROMPT_SUBMIT_TIMEOUT_MS = TimingConfig.getTiming('promptSubmitTimeoutMs', 7000);
const PROMPT_SUBMIT_TIMEOUTS_MS = {
  GPT: 15000,
  Grok: 20000,
  Gemini: 20000,
  Claude: 20000,
  'Le Chat': 20000,
  Qwen: 20000,
  DeepSeek: 22000,
  Perplexity: 8000
};
const CLAUDE_TYPING_TIMEOUT_PER_CHAR_MS = 6;
const CLAUDE_TYPING_TIMEOUT_MAX_MS = 180000;
const CLAUDE_TYPING_TIMEOUT_MIN_MS = 30000;
const SEND_PROMPT_DELAY_MS = TimingConfig.getTiming('sendPromptDelayMs', 3000);
const READY_ACK_TIMEOUT_MS = TimingConfig.getTiming('readyAckTimeoutMs', 6000);
const SEND_PROMPT_DELAY_OVERRIDES = {
  'Perplexity': 1000,
  'Claude': 1500,
  'GPT': 1500,
  'Le Chat': 1000
};
const DISPATCH_SUPERVISOR_TICK_MS = 1200;
const DISPATCH_RETRY_BACKOFF_MS = [0, 800, 3000, 8000];
const CONSERVATIVE_RETRY_BACKOFF_MS = [0, 2500, 5000, 9000];
const CONNECTION_RETRY_DELAYS = [500, 1500, 3000];
const CONSERVATIVE_CONNECTION_RETRY_DELAYS = [2000, 4000, 6000];
const CONSERVATIVE_MODELS = ['Grok', 'Qwen', 'DeepSeek'];
const DISPATCH_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 2000;
const NO_FOCUS_TIMEOUT_MS = TimingConfig.getTiming('noFocusTimeoutMs', 5000);
const RESULTS_PAGE_URL = chrome.runtime.getURL('result_new.html');
const EXTENSION_BASE_URL = chrome.runtime.getURL('');

function isExtensionResultTab(tab = null) {
  if (!tab) return false;
  if (tab.id && resultsTabId && tab.id === resultsTabId) return true;
  if (typeof tab.url !== 'string') return false;
  return tab.url.startsWith(RESULTS_PAGE_URL) || tab.url.startsWith(EXTENSION_BASE_URL);
}
const FOCUS_RESTORE_DELAY_MS = TimingConfig.getTiming('focusRestoreDelayMs', 1500);
const FOCUS_RESTORE_MAX_MS = TimingConfig.getTiming('focusRestoreMaxMs', 8000);
//-- 1.1. ÐœÐ¸Ð½Ð¸Ð¼Ð°Ð»ÑŒÐ½Ð¾Ðµ ÑƒÐ´ÐµÑ€Ð¶Ð°Ð½Ð¸Ðµ Ñ„Ð¾ÐºÑƒÑÐ° Ð´Ð»Ñ retry - Ð¾Ñ‚ CLAUDE --//
const RETRY_FOCUS_HOLD_MS = TimingConfig.getTiming('retryFocusHoldMs', 3000);
const SCRIPT_RUNTIME_HARD_STOP_MS = 180000;
const SCRIPT_RUNTIME_HARD_STOP_ACTIVITY_WINDOW_MS = 15000;
const SCRIPT_RUNTIME_HARD_STOP_GRACE_MS = 12000;
const SCRIPT_RUNTIME_HARD_STOP_MAX_GRACE_EXTENSIONS = 2;
const TRANSPORT_RECOVER_BACKOFF_MS = 12000;

const dispatchSessionTimerManager = (() => {
  const register = (typeof self?.registerSessionTimer === 'function')
    ? self.registerSessionTimer
    : (timerId) => timerId;
  const deregister = (typeof self?.deregisterSessionTimer === 'function')
    ? self.deregisterSessionTimer
    : () => {};
  return { register, deregister };
})();
const dispatchRegisterSessionTimer = dispatchSessionTimerManager.register;
const dispatchDeregisterSessionTimer = dispatchSessionTimerManager.deregister;
const scriptRuntimeHardStopTimers = new Map();

function resolveBoundTabIdForDispatch(llmName, entry = null) {
  if (typeof self.getBoundTabId === 'function') {
    return self.getBoundTabId(llmName, entry);
  }
  if (typeof TabMapManager !== 'undefined' && typeof TabMapManager.get === 'function') {
    return TabMapManager.get(llmName) || null;
  }
  return null;
}

function markModelRuntimeActivity(llmName, ts = Date.now(), source = 'runtime_signal') {
  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const stamp = Number(ts) || Date.now();
  const prev = Number(entry.lastRuntimeActivityAt || 0);
  if (stamp >= prev) {
    entry.lastRuntimeActivityAt = stamp;
    entry.lastRuntimeActivitySource = source || 'runtime_signal';
  }
}

function clearScriptRuntimeHardStop(llmName, dispatchId = null) {
  if (!llmName) return;
  const active = scriptRuntimeHardStopTimers.get(llmName);
  if (!active) return;
  if (dispatchId && active.dispatchId && active.dispatchId !== dispatchId) return;
  clearTimeout(active.timerId);
  dispatchDeregisterSessionTimer(active.timerId);
  scriptRuntimeHardStopTimers.delete(llmName);
}

function clearAllScriptRuntimeHardStops() {
  scriptRuntimeHardStopTimers.forEach((active, llmName) => {
    try {
      clearTimeout(active.timerId);
      dispatchDeregisterSessionTimer(active.timerId);
    } catch (_) {}
    scriptRuntimeHardStopTimers.delete(llmName);
  });
}

function scheduleScriptRuntimeHardStop(llmName, tabId, message, attempt = 1, options = null) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!llmName || !isValidTabId(tabId)) return;
  if (attempt !== 1 && !opts.force) return;
  const messageType = String(message?.type || '').toUpperCase();
  if (messageType !== 'GET_ANSWER' && messageType !== 'GET_FINAL_ANSWER') return;

  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const promptSubmittedAt = Number(entry?.promptSubmittedAt || 0);
  if (!promptSubmittedAt && !opts.allowUnconfirmedStart) return;

  const dispatchId = message?.meta?.dispatchId || null;
  const sessionId = Number(jobState?.session?.startTime || 0) || null;
  const startedAt = promptSubmittedAt || Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const remainingMs = Math.max(0, SCRIPT_RUNTIME_HARD_STOP_MS - elapsedMs);
  const active = scriptRuntimeHardStopTimers.get(llmName);
  if (active && active.dispatchId === dispatchId && active.tabId === tabId) {
    return;
  }
  if (active) {
    clearTimeout(active.timerId);
    dispatchDeregisterSessionTimer(active.timerId);
    scriptRuntimeHardStopTimers.delete(llmName);
  }

  const scheduleGuardTimer = (delayMs, graceExtensions = 0) => {
    let guardTimerId = null;
    guardTimerId = dispatchRegisterSessionTimer(setTimeout(() => {
      dispatchDeregisterSessionTimer(guardTimerId);
      const liveGuard = scriptRuntimeHardStopTimers.get(llmName);
      if (!liveGuard || liveGuard.timerId !== guardTimerId) return;

      const activeSessionId = Number(jobState?.session?.startTime || 0) || null;
      if (sessionId && activeSessionId && sessionId !== activeSessionId) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }
      const entry = jobState?.llms?.[llmName];
      if (!entry) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }
      const isFinal = isTerminalLlmEntry(entry);
      if (isFinal) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }
      const liveDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
      if (dispatchId && liveDispatchId && dispatchId !== liveDispatchId) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }

      const now = Date.now();
      const lastActivityAt = Number(entry.lastRuntimeActivityAt || entry.lastDispatchAt || entry.promptSubmittedAt || 0);
      const activityAgeMs = lastActivityAt ? Math.max(0, now - lastActivityAt) : null;
      const canExtendByActivity = Number(graceExtensions || 0) < SCRIPT_RUNTIME_HARD_STOP_MAX_GRACE_EXTENSIONS
        && Number.isFinite(activityAgeMs)
        && activityAgeMs >= 0
        && activityAgeMs <= SCRIPT_RUNTIME_HARD_STOP_ACTIVITY_WINDOW_MS;

      if (canExtendByActivity) {
        emitTelemetry(llmName, 'SCRIPT_RUNTIME_HARD_STOP_GRACE', {
          level: 'warning',
          details: `${SCRIPT_RUNTIME_HARD_STOP_GRACE_MS}ms`,
          meta: {
            timeoutMs: SCRIPT_RUNTIME_HARD_STOP_MS,
            graceMs: SCRIPT_RUNTIME_HARD_STOP_GRACE_MS,
            graceExtensions: Number(graceExtensions || 0) + 1,
            activityAgeMs,
            lastActivityAt,
            startedAt,
            tabId,
            dispatchId: dispatchId || liveDispatchId || null,
            messageType
          }
        });
        const nextGrace = Number(graceExtensions || 0) + 1;
        const nextTimerId = scheduleGuardTimer(SCRIPT_RUNTIME_HARD_STOP_GRACE_MS, nextGrace);
        scriptRuntimeHardStopTimers.set(llmName, {
          timerId: nextTimerId,
          tabId,
          dispatchId,
          sessionId,
          startedAt,
          graceExtensions: nextGrace
        });
        return;
      }

      scriptRuntimeHardStopTimers.delete(llmName);
      emitTelemetry(llmName, 'SCRIPT_RUNTIME_HARD_STOP', {
        level: 'warning',
        details: `${SCRIPT_RUNTIME_HARD_STOP_MS}ms`,
        meta: {
          timeoutMs: SCRIPT_RUNTIME_HARD_STOP_MS,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          startedAt,
          tabId,
          dispatchId: dispatchId || liveDispatchId || null,
          messageType,
          lastActivityAt,
          activityAgeMs,
          graceExtensions: Number(graceExtensions || 0)
        }
      });

      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'HUMANOID_FORCE_STOP',
          payload: { reason: 'script_runtime_hard_stop', timeoutMs: SCRIPT_RUNTIME_HARD_STOP_MS }
        }).catch(() => {});
        chrome.tabs.sendMessage(tabId, {
          type: 'STOP_AND_CLEANUP',
          reason: 'script_runtime_hard_stop',
          payload: { timeoutMs: SCRIPT_RUNTIME_HARD_STOP_MS }
        }).catch(() => {});
      } catch (_) {}

      updateModelState(llmName, 'RECOVERABLE_ERROR', {
        message: `script_runtime_hard_stop_${SCRIPT_RUNTIME_HARD_STOP_MS}ms`
      });

      handleLLMResponse(
        llmName,
        `Error: script_runtime_hard_stop_${SCRIPT_RUNTIME_HARD_STOP_MS}ms`,
        { type: 'script_runtime_hard_stop', message: `Timed out after ${SCRIPT_RUNTIME_HARD_STOP_MS}ms` },
        {
          dispatchId: dispatchId || liveDispatchId || null,
          sessionId: activeSessionId,
          runSessionId: activeSessionId
        },
        ''
      );
    }, Math.max(1, Number(delayMs) || 0)));
    return guardTimerId;
  };

  const timerId = scheduleGuardTimer(remainingMs, 0);
  scriptRuntimeHardStopTimers.set(llmName, {
    timerId,
    tabId,
    dispatchId,
    sessionId,
    startedAt,
    graceExtensions: 0
  });
}

function armScriptRuntimeHardStopForConfirmedPrompt(llmName, options = null) {
  if (!llmName) return false;
  const opts = options && typeof options === 'object' ? options : {};
  const entry = jobState?.llms?.[llmName];
  if (!entry || !entry.promptSubmittedAt) return false;
  const dispatchId = opts.dispatchId || entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const tabId = isValidTabId(opts.tabId)
    ? opts.tabId
    : resolveBoundTabIdForDispatch(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  scheduleScriptRuntimeHardStop(
    llmName,
    tabId,
    { type: 'GET_ANSWER', meta: { dispatchId } },
    1,
    { force: true }
  );
  return true;
}

const dispatchSleepMs = (ms) => new Promise((resolve) => {
  const duration = Math.max(0, ms || 0);
  if (duration <= 0) {
    resolve();
    return;
  }
  let timer = null;
  timer = dispatchRegisterSessionTimer(setTimeout(() => {
    dispatchDeregisterSessionTimer(timer);
    resolve();
  }, duration));
});

function getActiveTabSnapshot() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs.length ? tabs[0] : null;
      resolve(tab || null);
    });
  });
}

function restoreFocusIfStillOnDispatchTab(dispatchTabId, previousTab) {
  if (!previousTab?.id || previousTab.id === dispatchTabId) return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const activeTab = tabs && tabs.length ? tabs[0] : null;
    if (!activeTab || activeTab.id !== dispatchTabId) return;
    const winId = previousTab.windowId || activeTab.windowId;
    chrome.windows.update(winId, { focused: true }, () => {
      chrome.tabs.update(previousTab.id, { active: true }, () => chrome.runtime.lastError);
    });
  });
}

function resolveDispatchFlags(llmName, entry) {
  if (self.getDispatchFlags) {
    return self.getDispatchFlags(llmName, entry);
  }
  return {
    machine: null,
    state: entry?.dispatchState || 'UNKNOWN',
    isSent: !!entry?.messageSent,
    isInFlight: !!entry?.dispatchInFlight,
    isQueued: false,
    isTerminal: false,
    isInProgress: false,
    entry
  };
}

function scheduleDispatchRetry(entry, llmName, error) {
  if (!entry) return;
  const attempt = Number(entry.dispatchAttempts || 0);
  const decision = self.DispatchRetry?.getDispatchRetryDecision
    ? self.DispatchRetry.getDispatchRetryDecision(attempt, error)
    : { shouldRetry: true, delayMs: DEFAULT_RETRY_DELAY_MS, classification: 'UNKNOWN' };
  entry.lastDispatchError = error || null;
  entry.lastDispatchErrorClass = decision.classification || 'UNKNOWN';
  if (!decision.shouldRetry) {
    entry.retryAfterAt = null;
    entry.dispatchAttempts = DISPATCH_MAX_ATTEMPTS;
    return;
  }
  entry.retryAfterAt = Date.now() + Math.max(0, decision.delayMs || DEFAULT_RETRY_DELAY_MS);
}

function sendMessageWithTimeout(tabId, llmName, message, timeoutMs = NO_FOCUS_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!isValidTabId(tabId)) {
      resolve({ error: 'invalid_tab', requiresFocus: true });
      return;
    }
    let settled = false;
    let timer = null;
    timer = dispatchRegisterSessionTimer(setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timeout: true, requiresFocus: true });
      dispatchDeregisterSessionTimer(timer);
    }, Math.max(0, timeoutMs)));
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        dispatchDeregisterSessionTimer(timer);
      }
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'send_failed';
        if (errMsg.includes('message port closed')) {
          emitTelemetry(llmName, 'PORT_CLOSED', {
            level: 'warning',
            details: errMsg,
            meta: {
              errorType: 'PORT_CLOSED',
              code: 'PORT_CLOSED',
              phase: 'dispatch_send',
              dispatchId: message?.meta?.dispatchId || null,
              tabId,
              messageType: message?.type || null,
              source: 'sendMessageWithTimeout'
            }
          });
        }
        resolve({ error: errMsg, requiresFocus: true });
        return;
      }
      resolve(response || { status: 'ok', requiresFocus: false });
    });
  });
}

function getSendPromptDelay(llmName) {
  return SEND_PROMPT_DELAY_OVERRIDES[llmName] || SEND_PROMPT_DELAY_MS;
}

function getRetryBackoffForModel(llmName) {
  if (CONSERVATIVE_MODELS.includes(llmName)) {
    return CONSERVATIVE_RETRY_BACKOFF_MS;
  }
  return DISPATCH_RETRY_BACKOFF_MS;
}

function getConnectionRetryDelaysForModel(llmName) {
  if (CONSERVATIVE_MODELS.includes(llmName)) {
    return CONSERVATIVE_CONNECTION_RETRY_DELAYS;
  }
  return CONNECTION_RETRY_DELAYS;
}

async function withPromptDispatchLock(llmName, fn) {
  const key = llmName || 'global';
  try {
    return await dispatchMutexManager.withLock(key, fn);
  } catch (err) {
    console.error('[DISPATCH] lock fn failed', err);
    throw err;
  }
}

function withPromptDispatchFocusLock(fn) {
  promptDispatchFocusMutex = promptDispatchFocusMutex.then(() => Promise.resolve(fn())).catch((err) => {
    console.warn('[DISPATCH] focus lock fn failed', err);
  });
  return promptDispatchFocusMutex;
}

function resolvePromptSubmitted(llmName, payload = {}) {
  const waiters = promptSubmitWaiters.get(llmName);
  if (waiters && waiters.size) {
    waiters.forEach((cb) => {
      try { cb(payload); } catch (_) {}
    });
    waiters.clear();
  }
}

function waitForPromptSubmitted(llmName, timeoutMs = PROMPT_SUBMIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!llmName) {
      resolve(false);
      return;
    }
    const waiters = promptSubmitWaiters.get(llmName) || new Set();
    promptSubmitWaiters.set(llmName, waiters);
    let settled = false;
    const done = (ok, payload) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        dispatchDeregisterSessionTimer(timer);
        timer = null;
      }
      waiters.delete(handler);
      resolve(ok ? (payload || true) : false);
    };
    const handler = (payload) => done(true, payload);
    waiters.add(handler);
    let timer = null;
    timer = dispatchRegisterSessionTimer(setTimeout(() => done(false), Math.max(0, timeoutMs)));
  });
}

function getPromptSubmitTimeoutMs(llmName) {
  if (!llmName) return PROMPT_SUBMIT_TIMEOUT_MS;
  const override = PROMPT_SUBMIT_TIMEOUTS_MS[llmName];
  return Number.isFinite(override) ? override : PROMPT_SUBMIT_TIMEOUT_MS;
}

function updateTypingStateFromDiagnostic(llmName, event) {
  if (!llmName) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || !event) return;
  if (self.ModelRunState?.isTerminalRunState?.(entry)) {
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, 'POST_TERMINAL_NOISE', {
        label: event?.label || event?.event || null,
        source: 'updateTypingStateFromDiagnostic_terminal',
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
        tabId: entry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    } else {
      self.ModelRunState.recordPostTerminalNoise?.(entry, event);
    }
    saveJobState(jobState);
    return;
  }
  const label = String(event.label || '').trim().toLowerCase();
  if (!label) return;
  const ts = Number(event.ts) || Date.now();
  markModelRuntimeActivity(llmName, ts, 'diagnostic');
  if (label === 'answer_complete_detected') {
    const textLength = Number(event?.meta?.textLength || event?.textLength || 0) || 0;
    entry.lifecycleReadyAt = ts;
    entry.lifecycleReadyMeta = {
      ...(event?.meta || {}),
      state: 'COMPLETE',
      source: event?.source || 'diagnostic',
      event: 'ANSWER_COMPLETE_DETECTED'
    };
    entry.answerCompleteDetectedAt = ts;
    entry.answerCompleteTextLength = textLength;
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, 'LIFECYCLE_READY', {
        status: 'RECEIVING',
        source: 'answer_complete_detected_diagnostic',
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
        tabId: entry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    } else if (self.ModelRunState?.applyModelRunTransition) {
      self.ModelRunState.applyModelRunTransition(entry, 'LIFECYCLE_READY', {
        status: 'RECEIVING',
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
        tabId: entry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    }
    saveJobState(jobState);
    return;
  }
  if (llmName !== 'Claude') return;
  if (label.startsWith('typing start')) {
    entry.typingActive = true;
    entry.typingStartedAt = ts;
    entry.typingEndedAt = null;
    if (!entry.typingGuardUntil) {
      entry.typingGuardUntil = ts + CLAUDE_TYPING_TIMEOUT_MIN_MS;
    }
    entry.typingGuardReason = entry.typingGuardReason || 'diagnostic';
    saveJobState(jobState);
  } else if (label.startsWith('typing done')) {
    entry.typingActive = false;
    entry.typingEndedAt = ts;
    entry.typingGuardUntil = 0;
    entry.typingGuardReason = null;
    saveJobState(jobState);
  }
}

function isTypingGuardActive(entry) {
  if (!entry || !entry.typingActive) return false;
  const guardUntil = Number(entry.typingGuardUntil || 0);
  const now = Date.now();
  if (guardUntil && now > guardUntil) {
    entry.typingActive = false;
    entry.typingEndedAt = now;
    entry.typingGuardUntil = 0;
    entry.typingGuardReason = null;
    return false;
  }
  return true;
}

function isTerminalLlmEntry(entry) {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState?.(entry)) return true;
  return TERMINAL_STATUSES.includes(entry.status)
    || Boolean(entry.finalStatusRecorded || entry.finalStatus);
}

function hasPendingPromptDispatches() {
  if (!jobState?.llms) return false;
  return Object.keys(jobState.llms).some((llmName) => {
    const entry = jobState.llms[llmName];
    if (!entry) return false;
    if (isTerminalLlmEntry(entry)) return false;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent || flags.isInProgress || flags.isTerminal) return false;
    const boundTabId = resolveBoundTabIdForDispatch(llmName, entry);
    if (!isValidTabId(boundTabId)) return false;
    const attempts = entry.dispatchAttempts || 0;
    const now = Date.now();
    if (entry.retryAfterAt && now < entry.retryAfterAt) return false;
    return attempts < DISPATCH_MAX_ATTEMPTS;
  });
}

function countPendingRetries() {
  if (!jobState?.llms) return 0;
  const now = Date.now();
  let count = 0;

  for (const llmName of Object.keys(jobState.llms)) {
    const entry = jobState.llms[llmName];
    if (!entry) continue;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent || flags.isInProgress) continue;
    if (isTerminalLlmEntry(entry)) continue;
    const busyUntil = Number(entry.csBusyUntil || 0);
    if (busyUntil && now < busyUntil) continue;
    const boundTabId = resolveBoundTabIdForDispatch(llmName, entry);
    if (!isValidTabId(boundTabId)) continue;
    const attempts = entry.dispatchAttempts || 0;
    if (attempts >= DISPATCH_MAX_ATTEMPTS || attempts === 0) continue;
    if (isTypingGuardActive(entry)) continue;
    if (entry.retryAfterAt && now < entry.retryAfterAt) continue;

    const backoffArray = getRetryBackoffForModel(llmName);
    const backoff = backoffArray[Math.min(attempts, backoffArray.length - 1)] || 0;
    const lastAt = entry.lastDispatchAt || 0;
    if (now - lastAt >= backoff) {
      count++;
    }
  }

  return count;
}

function schedulePromptDispatchSupervisor() {
  if (promptDispatchSupervisorTimer) return;
  if (!hasPendingPromptDispatches()) return;

  const pendingRetries = countPendingRetries();
  const hasConservativePending = Object.keys(jobState?.llms || {}).some(llmName => {
    const entry = jobState.llms[llmName];
    if (!entry) return false;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent) return false;
    return CONSERVATIVE_MODELS.includes(llmName) && (entry.dispatchAttempts || 0) > 0;
  });

  const adaptiveTick = (hasConservativePending || pendingRetries === 0)
    ? DISPATCH_SUPERVISOR_TICK_MS
    : 400;

  const timer = dispatchRegisterSessionTimer(setTimeout(() => {
    promptDispatchSupervisorTimer = null;
    dispatchDeregisterSessionTimer(timer);
    runPromptDispatchSupervisor();
  }, adaptiveTick));
  promptDispatchSupervisorTimer = timer;
}

//-- 5.1. Supervisor: Ð·Ð°Ñ‰Ð¸Ñ‚Ð° Ð¾Ñ‚ ÐºÐ¾Ð½ÐºÑƒÑ€ÐµÐ½Ñ†Ð¸Ð¸ Ñ Rounds --//
function runPromptDispatchSupervisor() {
  if (!jobState?.llms) return;
  if (promptDispatchInProgress > 0) {
    schedulePromptDispatchSupervisor();
    return;
  }
  
  // Ð—Ð°Ñ‰Ð¸Ñ‚Ð°: Ð½Ðµ Ð·Ð°Ð¿ÑƒÑÐºÐ°ÐµÐ¼ supervisor ÐµÑÐ»Ð¸ Rounds ÐµÑ‰Ñ‘ Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹
  if (jobState?.session?.roundsInProgress === true) {
    console.log('[SUPERVISOR] Waiting for rounds to complete');
    schedulePromptDispatchSupervisor();
    return;
  }
  const now = Date.now();
  for (const llmName of Object.keys(jobState.llms)) {
    const entry = jobState.llms[llmName];
    if (!entry) continue;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent || flags.isInProgress) continue;
    if (isTerminalLlmEntry(entry)) continue;
    const busyUntil = Number(entry.csBusyUntil || 0);
    if (busyUntil && now < busyUntil) continue;
    const tabId = resolveBoundTabIdForDispatch(llmName, entry);
    if (!isValidTabId(tabId)) continue;
    const attempts = entry.dispatchAttempts || 0;
    if (attempts >= DISPATCH_MAX_ATTEMPTS) continue;
    if (attempts > 0 && isTypingGuardActive(entry)) continue;
    if (entry.retryAfterAt && now < entry.retryAfterAt) continue;
    const backoffArray = getRetryBackoffForModel(llmName);
    const backoff = backoffArray[Math.min(attempts, backoffArray.length - 1)] || 0;
    const lastAt = entry.lastDispatchAt || 0;
    if (now - lastAt < backoff) continue;
    //-- 2.1. Retry supervisor Ñ ÑƒÐ´ÐµÑ€Ð¶Ð°Ð½Ð¸ÐµÐ¼ Ñ„Ð¾ÐºÑƒÑÐ° --//
    dispatchPromptToTab(llmName, tabId, jobState.prompt, jobState.attachments || [], 'retry_supervisor', {
      deferSendMs: 500,
      minFocusHoldMs: RETRY_FOCUS_HOLD_MS
    });
  }
  schedulePromptDispatchSupervisor();
}

async function dispatchPromptToTab(llmName, tabId, prompt, attachments = [], reason = 'auto', options = {}) {
  if (!llmName || !isValidTabId(tabId) || !prompt) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  //-- 1.1. Быстрая проверка связи перед захватом фокуса (без агрессивного reload в Round1) --//
  const isAlive = await new Promise(r => {
    chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK_PING' }, resp => {
      if (chrome.runtime.lastError || !resp) r(false); else r(true);
    });
    setTimeout(() => r(false), 1000);
  });
  if (!isAlive) {
    const attempts = Number(entry.dispatchAttempts || 0);
    const allowPreDispatchReload = reason === 'retry_supervisor' && attempts >= 2;
    emitTelemetry(llmName, 'PRE_DISPATCH_HEALTH_PING_FAIL', {
      level: 'warning',
      details: allowPreDispatchReload ? 'reload_attempted' : 'reload_skipped',
      meta: { tabId, reason, attempts, allowPreDispatchReload }
    });
    if (allowPreDispatchReload) {
      console.warn(`[Dispatch] Tab ${tabId} unresponsive, retry path will reload before send (${llmName})`);
      await new Promise((resolve) => chrome.tabs.reload(tabId, {}, () => setTimeout(resolve, 1200)));
    } else {
      console.warn(`[Dispatch] Tab ${tabId} health ping failed for ${llmName}, continuing without pre-dispatch reload`);
    }
  }
  const capturedSessionId = jobState?.session?.startTime || null;
  const pipelineRunId = jobState?.session?.pipelineRunId || jobState?.session?.pipelineControl?.pipelineRunId || null;
  const flags = resolveDispatchFlags(llmName, entry);
  if (isTerminalLlmEntry(entry)) return;
  if (reason === 'retry_supervisor' && isTypingGuardActive(entry)) return;
  const busyUntil = Number(entry.csBusyUntil || 0);
  if (busyUntil && Date.now() < busyUntil) return;
  if (flags.isSent) return;
  if (flags.isInProgress) return;
  const circuitState = self.DispatchCircuit?.canDispatchWithCircuit
    ? self.DispatchCircuit.canDispatchWithCircuit(llmName)
    : { ok: true, retryAfterMs: 0 };
  if (!circuitState.ok) {
    updateModelState(llmName, 'CIRCUIT_OPEN', { message: 'Dispatch circuit open', retryAfterMs: circuitState.retryAfterMs });
    broadcastDiagnostic(llmName, {
      type: 'DISPATCH',
      label: 'Circuit breaker OPEN',
      details: `${circuitState.retryAfterMs}ms`,
      level: 'warning'
    });
    return;
  }

  entry.dispatchAttempts = (entry.dispatchAttempts || 0) + 1;
  entry.dispatchQueuedAt = Date.now();
  const sessionId = jobState?.session?.startTime || Date.now();
  const dispatchId = `${llmName}:${sessionId}:${entry.dispatchAttempts || 0}`;
  const registryResult = self.DispatchIdRegistry?.registerDispatchId
    ? self.DispatchIdRegistry.registerDispatchId(dispatchId, { llmName, tabId })
    : { ok: true };
  if (!registryResult.ok) {
    broadcastDiagnostic(llmName, {
      type: 'DISPATCH',
      label: 'Dispatch skipped (duplicate)',
      details: registryResult.reason || 'duplicate',
      level: 'warning',
      meta: { dispatchId }
    });
    return;
  }
  if (flags.machine) {
    if (flags.machine.is(self.DISPATCH_STATES?.ERROR)) {
      flags.machine.reset();
    }
    flags.machine.queue({
      prompt,
      attachments,
      dispatchId,
      dispatchAttempts: entry.dispatchAttempts
    });
  }
  saveJobState(jobState);

  return withPromptDispatchLock(llmName, async () => {
    if (capturedSessionId && jobState?.session?.startTime !== capturedSessionId) {
      return;
    }
    promptDispatchInProgress += 1;
    stopHumanPresenceLoop();
    const lockAcquiredAt = Date.now();
    const machine = resolveDispatchFlags(llmName, entry).machine;
  entry.lastDispatchAt = Date.now();
  entry.lastDispatchMeta = { dispatchReason: reason, sessionId, dispatchId };
  entry.dispatchSource = 'web';
  entry.pipelineRunId = pipelineRunId || entry.pipelineRunId || null;
  entry.recentDispatchIds = Array.isArray(entry.recentDispatchIds) ? entry.recentDispatchIds : [];
  entry.recentDispatchIds = [...entry.recentDispatchIds.filter(Boolean), dispatchId].slice(-8);
  if (self.PipelineFSM?.registerDispatch) {
    const currentControl = typeof self.getActivePipelineControlState === 'function'
      ? self.getActivePipelineControlState()
      : (jobState?.session?.pipelineControl || null);
    const seedState = currentControl || (self.PipelineFSM.createState ? self.PipelineFSM.createState({ pipelineRunId, sessionId }) : null);
    if (seedState) {
      const nextControl = self.PipelineFSM.registerDispatch(seedState, {
        llmName,
        dispatchId,
        tabId,
        tabSessionId: null,
        pipelineRunId,
        sessionId,
        stage: reason,
        reason: 'dispatch_registered'
      });
      if (typeof self.persistPipelineControlState === 'function') {
        self.persistPipelineControlState(nextControl);
      }
    }
  }
  saveJobState(jobState);
    let submitTimeoutMs = getPromptSubmitTimeoutMs(llmName);
    if (llmName === 'Claude' && !options.skipTypingGuard) {
      const promptLength = String(prompt || '').length;
      const typingBudget = CLAUDE_TYPING_TIMEOUT_PER_CHAR_MS * promptLength;
      const computed = Math.round(20000 + typingBudget);
      submitTimeoutMs = Math.max(
        submitTimeoutMs,
        Math.min(CLAUDE_TYPING_TIMEOUT_MAX_MS, Math.max(CLAUDE_TYPING_TIMEOUT_MIN_MS, computed))
      );
      entry.typingActive = true;
      entry.typingStartedAt = Date.now();
      entry.typingEndedAt = null;
      entry.typingGuardUntil = Date.now() + submitTimeoutMs;
      entry.typingGuardReason = 'typing_budget';
    }
  const queueWaitMs = entry.dispatchQueuedAt ? Math.max(0, lockAcquiredAt - entry.dispatchQueuedAt) : null;
  const lastTabState = (() => {
    const cache = self.__TAB_STATE_CACHE__;
    return cache && cache.get ? cache.get(tabId) : null;
  })();
  const visibilityState = lastTabState?.visibilityState ?? null;
  const hasFocus = typeof lastTabState?.hasFocus === 'boolean' ? lastTabState.hasFocus : null;
  emitTelemetry(llmName, 'DISPATCH_LOCK_ACQUIRE', {
    details: queueWaitMs !== null ? `${queueWaitMs}ms` : '',
    meta: { queueWaitMs, dispatchId, dispatchReason: reason, attempt: entry.dispatchAttempts, visibilityState, hasFocus }
  });
  emitTelemetry(llmName, 'DISPATCH_START', {
    meta: { dispatchId, dispatchReason: reason, attempt: entry.dispatchAttempts, visibilityState, hasFocus }
  });
    try {
      if (machine) {
        machine.activate({ tabId });
      }
      const readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason });
      if (!readiness.ok) {
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'Tab not ready for dispatch',
          details: readiness.reason || 'unknown',
          level: 'warning',
          meta: { snapshot: readiness.snapshot || null, dispatchId, dispatchReason: reason }
        });
        if (machine) {
          machine.error({ error: readiness.reason || 'tab_not_ready', code: 'TAB_NOT_READY' });
        }
        return;
      }
      broadcastDiagnostic(llmName, {
        type: 'DISPATCH',
        label: 'Dispatch tab activation',
        details: reason,
        level: 'info',
        meta: { snapshot: readiness.snapshot || null, dispatchId, dispatchReason: reason }
      });
      let waiter = null;
      const shouldBypassAck = llmName === 'Perplexity';
      let readyOk = true;
      if (shouldBypassAck) {
        emitTelemetry(llmName, 'PERPLEXITY_ACK_BYPASS', {
          details: 'skip ACK_READY wait',
          meta: { dispatchId, dispatchReason: reason, tabId }
        });
      } else {
        readyOk = await waitForScriptReady(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
      }
      if (!readyOk) {
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'ACK_READY not received',
          details: `${READY_ACK_TIMEOUT_MS}ms`,
          level: 'warning',
          meta: { dispatchId, dispatchReason: reason }
        });
        const timeoutTab = await (self.getTabSafe ? self.getTabSafe(tabId) : null);
        const timeoutSnapshot = self.buildTabSnapshot ? self.buildTabSnapshot(timeoutTab) : null;
        const timeoutTiming = self.buildTabTimingMeta ? self.buildTabTimingMeta(timeoutSnapshot) : {};
        emitTelemetry(llmName, 'HANDSHAKE_TIMEOUT', {
          level: 'warning',
          details: `${READY_ACK_TIMEOUT_MS}ms`,
          meta: {
            errorType: 'HANDSHAKE_TIMEOUT',
            code: 'HANDSHAKE_TIMEOUT',
            phase: 'handshake',
            dispatchId,
            dispatchReason: reason,
            tabId,
            timeoutMs: READY_ACK_TIMEOUT_MS,
            snapshot: timeoutSnapshot || null,
            ...timeoutTiming
          }
        });
        let recoveryOk = false;
        let recoveryAction = null;
        if (self.reinjectScript) {
          recoveryAction = 'reinject_script';
          recoveryOk = await self.reinjectScript(tabId, llmName);
        } else if (self.reloadTab) {
          recoveryAction = 'reload_tab';
          recoveryOk = await self.reloadTab(tabId);
        }
        if (recoveryAction) {
          emitTelemetry(llmName, 'RECOVERY_ACTION', {
            level: recoveryOk ? 'info' : 'warning',
            details: recoveryOk ? 'ok' : 'failed',
            meta: {
              errorType: 'RECOVERY_ACTION',
              code: 'RECOVERY_ACTION',
              phase: 'handshake',
              dispatchId,
              dispatchReason: reason,
              tabId,
              action: recoveryAction,
              ok: recoveryOk
            }
          });
        }
        if (recoveryOk) {
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ACK_READY recovery attempt',
            details: 'reinject/reload completed',
            level: 'info',
            meta: { dispatchId, dispatchReason: reason }
          });
          emitTelemetry(llmName, 'ACK_READY_RECOVERY_OK', {
            details: 'reinject/reload completed',
            meta: { dispatchId, dispatchReason: reason, tabId }
          });
          readyOk = await waitForScriptReady(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
        }
        if (!readyOk) {
          scheduleDispatchRetry(entry, llmName, { type: 'ack_timeout' });
          if (self.DispatchCircuit?.recordDispatchFailure) {
            self.DispatchCircuit.recordDispatchFailure(llmName, { type: 'ack_timeout' });
          }
          if (llmName === 'Perplexity' && entry) {
            entry.retryAfterAt = Date.now();
            emitTelemetry(llmName, 'PERPLEXITY_ACK_RETRY', {
              details: 'forced immediate retry',
              meta: { dispatchId, retryAt: entry.retryAfterAt }
            });
          }
          return;
        }
      }

      const readyInfo = self.ReadySignalManager?.getReadyInfo
        ? self.ReadySignalManager.getReadyInfo(tabId)
        : null;
      const dispatchSendPayload = {
        type: 'SMART_DISPATCH_SEND',
        llmName,
        tabId,
        dispatchId,
        dispatchAt: Date.now(),
        tabSessionId: readyInfo?.tabSessionId || null
      };
      try {
        if (typeof sendMessageToResultsTab === 'function') {
          sendMessageToResultsTab(dispatchSendPayload);
        }
      } catch (_) {}

      let needsFocus = false;
      if (options.skipNoFocusProbe) {
        needsFocus = true;
      } else {
      const noFocusResponse = await sendMessageWithTimeout(tabId, llmName, {
          type: 'GET_ANSWER_NO_FOCUS',
          prompt,
          attachments,
          meta: {
            dispatchReason: reason,
            runSessionId: sessionId,
            sessionId,
            pipelineRunId,
            dispatchId,
            tabSessionId: readyInfo?.tabSessionId || null
          }
        }, NO_FOCUS_TIMEOUT_MS);
        needsFocus = !noFocusResponse || noFocusResponse.requiresFocus === true || noFocusResponse.timeout;
      }
      if (options.forceFocus) {
        needsFocus = true;
      }

      if (machine) {
        machine.ready();
        machine.submit();
      }

      waiter = waitForPromptSubmitted(llmName, submitTimeoutMs);
      const readyWaitMs = Math.max(0, Date.now() - lockAcquiredAt);
  emitTelemetry(llmName, 'DISPATCH_SEND', {
    details: `readyWaitMs=${readyWaitMs}`,
    meta: {
      dispatchId,
      dispatchReason: reason,
      attempt: entry.dispatchAttempts,
      readyWaitMs,
      requiresFocus: needsFocus,
      visibilityState,
      hasFocus
    }
  });

      let previousTab = null;
      let restoreTimer = null;
      let restoreMaxTimer = null;
      let automationVisitStarted = false;
      const automationManager = (self.startAutomationVisit && self.endAutomationVisit) ? self : null;
      if (needsFocus) {
        entry.focusSwitches = Number(entry.focusSwitches || 0) + 1;
        if (jobState?.session) {
          jobState.session.focusSwitches = Number(jobState.session.focusSwitches || 0) + 1;
        }
        previousTab = await getActiveTabSnapshot();
        if (automationManager) {
          automationVisitStarted = automationManager.startAutomationVisit(tabId, llmName);
        }
        await withPromptDispatchFocusLock(async () => {
          await activateTabForDispatch(tabId);
          if (options.deferSendMs) {
            await dispatchSleepMs(options.deferSendMs);
          }
          sendMessageSafely(tabId, llmName, {
            type: 'GET_ANSWER',
            prompt,
            attachments,
            meta: {
              dispatchReason: reason,
              runSessionId: sessionId,
              sessionId,
              pipelineRunId,
              dispatchId,
              tabSessionId: readyInfo?.tabSessionId || null
            }
          });
        });
        //-- 3.1. Ð£Ñ‡Ð¸Ñ‚Ñ‹Ð²Ð°ÐµÐ¼ minFocusHoldMs Ð´Ð»Ñ retry --//
        const effectiveFocusHoldMs = options.minFocusHoldMs || FOCUS_RESTORE_DELAY_MS;
        if (!options.skipFocusRestore && previousTab?.id && previousTab.id !== tabId) {
          restoreTimer = dispatchRegisterSessionTimer(setTimeout(() => {
            dispatchDeregisterSessionTimer(restoreTimer);
            restoreFocusIfStillOnDispatchTab(tabId, previousTab);
          }, effectiveFocusHoldMs));
          restoreMaxTimer = dispatchRegisterSessionTimer(setTimeout(() => {
            dispatchDeregisterSessionTimer(restoreMaxTimer);
            restoreFocusIfStillOnDispatchTab(tabId, previousTab);
          }, FOCUS_RESTORE_MAX_MS));
        }
      } else {
        if (options.deferSendMs) {
          await dispatchSleepMs(options.deferSendMs);
        }
        sendMessageSafely(tabId, llmName, {
          type: 'GET_ANSWER',
          prompt,
          attachments,
          meta: {
            dispatchReason: reason,
            runSessionId: sessionId,
            sessionId,
            pipelineRunId,
            dispatchId,
            tabSessionId: readyInfo?.tabSessionId || null
          }
        });
      }
      const focusMetricPayload = {
        type: 'SMART_FOCUS_METRIC',
        llmName,
        focusSwitches: Number(entry.focusSwitches || 0),
        sessionFocusSwitches: Number(jobState?.session?.focusSwitches || 0),
        requiresFocus: Boolean(needsFocus),
        dispatchId
      };
      try {
        if (typeof sendMessageToResultsTab === 'function') {
          sendMessageToResultsTab(focusMetricPayload);
        }
      } catch (_) {}
      const submittedPayload = options.skipSubmitWait ? null : (waiter ? await waiter : false);
      if (restoreTimer) {
        clearTimeout(restoreTimer);
        dispatchDeregisterSessionTimer(restoreTimer);
        restoreTimer = null;
      }
      if (restoreMaxTimer) {
        clearTimeout(restoreMaxTimer);
        dispatchDeregisterSessionTimer(restoreMaxTimer);
        restoreMaxTimer = null;
      }
      if (!options.skipFocusRestore && needsFocus && previousTab?.id) {
        restoreFocusIfStillOnDispatchTab(tabId, previousTab);
      }
      if (automationManager && automationVisitStarted) {
        automationManager.endAutomationVisit(llmName);
      }
      //-- 2.1. Если Round 1 (skipSubmitWait), выходим сразу после клика, не блокируя очередь --//
      if (options.skipSubmitWait) {
        return;
      }
      if (options.skipSubmitWait) {
        if (options.resetStateAfterSend && machine) {
          machine.reset();
        }
        return;
      }
      const submittedOk = submittedPayload === true || (submittedPayload && submittedPayload.ok === true);
      if (submittedOk) {
        entry.promptSubmittedAt = Date.now();
        broadcastDiagnostic(llmName, { type: 'DISPATCH', label: 'Prompt submitted (confirmed)', level: 'success' });
        armScriptRuntimeHardStopForConfirmedPrompt(llmName, {
          dispatchId: entry?.confirmedDispatchId || dispatchId || null,
          tabId
        });
      } else if (submittedPayload && submittedPayload.busy) {
        broadcastDiagnostic(llmName, { type: 'DISPATCH', label: 'Content script busy — no retry', level: 'warning' });
      } else {
        const timeoutSnapshot = await captureTabSnapshot(tabId);
        emitTelemetry(llmName, 'PROMPT_SUBMITTED_TIMEOUT', {
          details: `${submitTimeoutMs}ms`,
          level: 'warning',
          meta: { dispatchId, dispatchReason: reason, timeoutMs: submitTimeoutMs, snapshot: timeoutSnapshot || null }
        });
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'Prompt confirmation timeout',
          details: `${submitTimeoutMs}ms`,
          level: 'warning',
          meta: { snapshot: timeoutSnapshot || null, dispatchId, dispatchReason: reason }
        });
        scheduleDispatchRetry(entry, llmName, { type: 'submit_timeout' });
        if (self.DispatchCircuit?.recordDispatchFailure) {
          self.DispatchCircuit.recordDispatchFailure(llmName, { type: 'submit_timeout' });
        }
        if (machine) {
          machine.error({ error: 'prompt_submit_timeout', code: 'PROMPT_SUBMIT_TIMEOUT' });
        }
      }
    } catch (err) {
      console.warn('[DISPATCH] dispatchPromptToTab failed', llmName, err);
      broadcastDiagnostic(llmName, { type: 'DISPATCH', label: 'Prompt dispatch error', details: err?.message || String(err), level: 'error' });
      scheduleDispatchRetry(entry, llmName, { type: err?.message || 'dispatch_error' });
      if (self.DispatchCircuit?.recordDispatchFailure) {
        self.DispatchCircuit.recordDispatchFailure(llmName, { type: err?.message || 'dispatch_error' });
      }
      const machine = resolveDispatchFlags(llmName, entry).machine;
      if (machine) {
        machine.error({ error: err?.message || String(err), code: 'DISPATCH_ERROR' });
      }
    } finally {
      try {
        saveJobState(jobState);
      } catch (_) {}
      promptDispatchInProgress = Math.max(0, promptDispatchInProgress - 1);
      schedulePromptDispatchSupervisor();
    }
  });
}

function sendMessageSafely(tabId, llmName, message, attempt = 1) {
  console.log(`[BACKGROUND] Safely sending message to ${llmName} (tab ${tabId}), attempt ${attempt}`);
  const currentSessionId = jobState?.session?.startTime || null;
  const messageSessionId = message?.meta?.runSessionId || message?.meta?.sessionId || null;
  if (currentSessionId && messageSessionId && currentSessionId !== messageSessionId) {
    console.log(`[BACKGROUND] Session mismatch for ${llmName}, aborting send`);
    return;
  }
  const initialEntry = jobState?.llms?.[llmName] || null;
  if (isTerminalLlmEntry(initialEntry)) {
    appendLogEntry(llmName, {
      type: 'COMMAND',
      label: 'Send skipped (terminal)',
      details: initialEntry?.status || initialEntry?.finalStatus || 'terminal',
      level: 'warning',
      meta: { messageType: message?.type || 'UNKNOWN', attempt }
    });
    return;
  }
  if (attempt === 1) {
    updateModelState(llmName, 'GENERATING');
    if (typeof self.startBudgetPhase === 'function') {
      self.startBudgetPhase(llmName, 'generation', null, { tabId });
    }
    scheduleScriptRuntimeHardStop(llmName, tabId, message, attempt);
  }
  appendLogEntry(llmName, {
    type: 'COMMAND',
    label: `Sending ${message?.type || 'command'}`,
    details: `Attempt ${attempt}`,
    level: 'info',
    meta: { attempt, messageType: message?.type || 'UNKNOWN' }
  });
  const mappedTabId = TabMapManager.get(llmName);
  if (mappedTabId && mappedTabId !== tabId) {
    if (isValidTabId(mappedTabId)) {
      console.log(`[BACKGROUND] Tab mapping for ${llmName} changed (${tabId} -> ${mappedTabId}), rerouting command`);
      sendMessageSafely(mappedTabId, llmName, message, attempt);
    } else {
      console.warn(`[BACKGROUND] Tab mapping for ${llmName} is invalid (${mappedTabId}), aborting send`);
      handleLLMResponse(llmName, `Error: Tab reference for ${llmName} is invalid.`);
    }
    return;
  }
  extendPingWindowForTab(tabId, AUTO_PING_WINDOW_MS);

  if (!isValidTabId(tabId)) {
    console.error(`[BACKGROUND] Invalid tab id for ${llmName}:`, tabId);
    handleLLMResponse(llmName, `Error: Tab reference for ${llmName} is invalid.`);
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      console.error(`[BACKGROUND] Tab ${tabId} for ${llmName} not found.`, chrome.runtime.lastError?.message);
      appendLogEntry(llmName, {
        type: 'COMMAND',
        label: 'Tab unavailable',
        details: chrome.runtime.lastError?.message || 'Tab not found',
        level: 'error',
        meta: { messageType: message?.type || 'UNKNOWN' }
      });
      handleLLMResponse(llmName, `Error: Tab for ${llmName} was closed or could not be accessed.`);
      return;
    }

    console.log(`[BACKGROUND] Sending message to ${llmName}:`, message);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const liveEntry = jobState?.llms?.[llmName] || null;
      if (isTerminalLlmEntry(liveEntry)) {
        appendLogEntry(llmName, {
          type: 'COMMAND',
          label: 'Send response ignored (terminal)',
          details: liveEntry?.status || liveEntry?.finalStatus || 'terminal',
          level: 'warning',
          meta: { messageType: message?.type || 'UNKNOWN', attempt }
        });
        return;
      }
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || '';
        const errLower = errMsg.toLowerCase();
        const isSendCommand = message?.type === 'GET_ANSWER';
        const isPortClosed = errLower.includes('message port closed');
        const isNoReceiver = errLower.includes('receiving end does not exist');
        const isAsyncChannelClosed = errLower.includes('message channel closed before a response was received');
        const entry = jobState?.llms?.[llmName] || null;
        const hasConfirmedSubmit = Boolean(
          entry?.promptSubmittedAt
          || entry?.submitSource === 'content'
          || entry?.submitSource === 'inferred'
        );
        const markTransportDegradedAfterSubmit = () => {
          if (!(isSendCommand && hasConfirmedSubmit)) return false;
          if (entry) {
            markModelRuntimeActivity(llmName, Date.now(), 'transport_degraded_after_submit');
            entry.transportErrorAfterSubmitCount = Number(entry.transportErrorAfterSubmitCount || 0) + 1;
            entry.transportBackoffUntil = Date.now() + TRANSPORT_RECOVER_BACKOFF_MS;
          }
          emitTelemetry(llmName, 'SEND_DEGRADED_AFTER_SUBMIT', {
            level: 'warning',
            details: errMsg || 'channel_closed_after_submit',
            meta: {
              tabId,
              attempt,
              dispatchId: message?.meta?.dispatchId || null,
              messageType: message?.type || null
            }
          });
          appendLogEntry(llmName, {
            type: 'COMMAND',
            label: 'SEND_DEGRADED_AFTER_SUBMIT',
            details: errMsg,
            level: 'warning',
            meta: { messageType: message?.type || 'UNKNOWN', attempt }
          });
          updateModelState(llmName, 'RECOVERABLE_ERROR', {
            message: 'transport_error_after_submit'
          });
          if (typeof self.recoverAnswerViaDomSnapshot === 'function') {
            self.recoverAnswerViaDomSnapshot(llmName, tabId, 'transport_error_after_submit', {
              dispatchId: message?.meta?.dispatchId || null
            }).catch(() => {});
          }
          sendPassiveMessageWithRetries(tabId, llmName, {
            action: 'getResponses',
            meta: { source: 'post_send_error_recover' }
          }, {
            maxAttempts: 3,
            baseDelay: 1000,
            allowRecovery: llmName === 'Perplexity',
            onSuccess: () => {
              broadcastDiagnostic(llmName, {
                type: 'PING',
                label: 'post-send recovery probe sent',
                level: 'success'
              });
            },
            onError: (passiveErr) => {
              if (typeof self.recoverAnswerViaDomSnapshot === 'function') {
                self.recoverAnswerViaDomSnapshot(llmName, tabId, 'post_send_recovery_probe_failed', {
                  dispatchId: message?.meta?.dispatchId || null
                }).catch(() => {});
              }
              broadcastDiagnostic(llmName, {
                type: 'PING_ERROR',
                label: 'post-send recovery probe failed',
                details: passiveErr,
                level: 'warning'
              });
            }
          });
          return true;
        };
        const canRecover = isSendCommand && attempt < 2 && (isPortClosed || isNoReceiver || isAsyncChannelClosed);
        console.error(`[BACKGROUND] Error sending message to ${llmName} on tab ${tabId}:`, errMsg);
        if (errMsg.includes('message port closed')) {
          emitTelemetry(llmName, 'PORT_CLOSED', {
            level: 'warning',
            details: errMsg,
            meta: {
              errorType: 'PORT_CLOSED',
              code: 'PORT_CLOSED',
              phase: 'dispatch_send',
              dispatchId: message?.meta?.dispatchId || null,
              tabId,
              messageType: message?.type || null,
              attempt,
              source: 'sendMessageSafely'
            }
          });
        }
        if (canRecover) {
          const dispatchId = message?.meta?.dispatchId || null;
          emitTelemetry(llmName, 'SEND_RECOVERY_ATTEMPT', {
            level: 'warning',
            details: errMsg,
            meta: {
              dispatchId,
              tabId,
              messageType: message?.type || null,
              attempt,
              source: 'sendMessageSafely'
            }
          });
          appendLogEntry(llmName, {
            type: 'COMMAND',
            label: 'Send recovery attempt',
            details: errMsg,
            level: 'warning',
            meta: { messageType: message?.type || 'UNKNOWN', attempt }
          });
          const attemptRecovery = async () => {
            let recoveryOk = false;
            let action = null;
            if (self.reinjectScript) {
              action = 'reinject_script';
              recoveryOk = await self.reinjectScript(tabId, llmName);
            } else if (self.reloadTab) {
              action = 'reload_tab';
              recoveryOk = await self.reloadTab(tabId);
            }
            const readyFn = (typeof waitForScriptReady === 'function')
              ? waitForScriptReady
              : (self.waitForScriptReady || null);
            if (recoveryOk && readyFn) {
              recoveryOk = await readyFn(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
            }
            emitTelemetry(llmName, 'SEND_RECOVERY_RESULT', {
              level: recoveryOk ? 'info' : 'warning',
              details: recoveryOk ? 'ok' : 'failed',
              meta: {
                dispatchId,
                tabId,
                messageType: message?.type || null,
                attempt,
                action,
                ok: recoveryOk
              }
            });
            if (recoveryOk) {
              sendMessageSafely(tabId, llmName, message, attempt + 1);
              return;
            }
            emitTelemetry(llmName, 'SEND_SKIPPED', {
              level: 'warning',
              details: errMsg,
              meta: {
                dispatchId,
                tabId,
                messageType: message?.type || null,
                attempt,
                reason: 'channel_dead'
              }
            });
            appendLogEntry(llmName, {
              type: 'COMMAND',
              label: 'Send recovery failed',
              details: errMsg,
              level: 'error',
              meta: { messageType: message?.type || 'UNKNOWN', attempt }
            });
            if (markTransportDegradedAfterSubmit()) {
              return;
            }
            handleLLMResponse(llmName, `Error: Could not establish connection with the ${llmName} tab. It might be unresponsive or still loading.`);
          };
          attemptRecovery();
          return;
        }
        if (errMsg.includes('Could not establish connection') && attempt < 3) {
          const delays = getConnectionRetryDelaysForModel(llmName);
          const retryDelay = delays[attempt - 1] || 3000;
          const retrySessionId = jobState?.session?.startTime || null;
          console.warn(`[BACKGROUND] Retrying message to ${llmName} in ${retryDelay}ms (attempt ${attempt + 1})`);
          const retryTimer = dispatchRegisterSessionTimer(setTimeout(() => {
            if (retrySessionId && jobState?.session?.startTime !== retrySessionId) {
              console.log(`[BACKGROUND] Session changed, aborting retry for ${llmName}`);
              dispatchDeregisterSessionTimer(retryTimer);
              return;
            }
            const currentTabId = TabMapManager.get(llmName);
            if (currentTabId !== tabId) {
              console.log(`[BACKGROUND] Tab for ${llmName} changed (${tabId} -> ${currentTabId}), aborting retry`);
              dispatchDeregisterSessionTimer(retryTimer);
              return;
            }
            sendMessageSafely(tabId, llmName, message, attempt + 1);
            dispatchDeregisterSessionTimer(retryTimer);
          }, retryDelay));
          return;
        }
        appendLogEntry(llmName, {
          type: 'COMMAND',
          label: 'COMMAND_SEND_ERROR',
          details: errMsg,
          level: 'error',
          meta: { messageType: message?.type || 'UNKNOWN', reason: errMsg }
        });
        if (markTransportDegradedAfterSubmit()) {
          return;
        }
        handleLLMResponse(llmName, `Error: Could not establish connection with the ${llmName} tab. It might be unresponsive or still loading.`);
      } else {
        console.log(`[BACKGROUND] Message sent to ${llmName} successfully, response:`, response);
        appendLogEntry(llmName, {
          type: 'COMMAND',
          label: 'Command delivered',
          details: message?.type || 'UNKNOWN',
          level: 'success',
          meta: { messageType: message?.type || 'UNKNOWN' }
        });
      }
    });
  });
}

function sendPassiveMessageWithRetries(tabId, llmName, message, {
  attempt = 1,
  maxAttempts = 3,
  baseDelay = 2000,
  transportRetryDelays = null,
  allowRecovery = false,
  recoveryAttempted = false,
  onSuccess,
  onError
} = {}) {
  const initialEntry = jobState?.llms?.[llmName] || null;
  if (isTerminalLlmEntry(initialEntry)) {
    onSuccess?.({ status: 'ignored_terminal' });
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      const errMsg = chrome.runtime.lastError?.message || 'Tab not found';
      console.warn(`[BACKGROUND] Passive message: tab ${tabId} for ${llmName} unavailable: ${errMsg}`);
      onError?.(errMsg);
      return;
    }

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const liveEntry = jobState?.llms?.[llmName] || null;
      if (isTerminalLlmEntry(liveEntry)) {
        onSuccess?.({ status: 'ignored_terminal' });
        return;
      }
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'Unknown error';
        const errLower = errMsg.toLowerCase();
        const isPortClosed = errLower.includes('message port closed');
        const isAsyncChannelClosed = errLower.includes('message channel closed before a response was received');
        const isNoReceiver = errLower.includes('receiving end does not exist')
          || errLower.includes('could not establish connection');
        console.warn(`[BACKGROUND] Passive message error for ${llmName}:`, errMsg);
        const scheduleTransportRetry = () => {
          const retryPlan = Array.isArray(transportRetryDelays) ? transportRetryDelays : null;
          const plannedDelay = retryPlan && retryPlan.length >= attempt
            ? Number(retryPlan[attempt - 1])
            : NaN;
          const nextDelay = Number.isFinite(plannedDelay) && plannedDelay > 0
            ? plannedDelay
            : (baseDelay * attempt);
          const retrySessionId = jobState?.session?.startTime || null;
          console.log(`[BACKGROUND] Passive retry for ${llmName} in ${nextDelay}ms (attempt ${attempt + 1})`);
          const passiveRetryTimer = dispatchRegisterSessionTimer(setTimeout(() => {
            if (retrySessionId && jobState?.session?.startTime !== retrySessionId) {
              console.log(`[BACKGROUND] Session changed, aborting passive retry for ${llmName}`);
              dispatchDeregisterSessionTimer(passiveRetryTimer);
              return;
            }
            const latestEntry = jobState?.llms?.[llmName] || null;
            if (isTerminalLlmEntry(latestEntry)) {
              onSuccess?.({ status: 'ignored_terminal' });
              dispatchDeregisterSessionTimer(passiveRetryTimer);
              return;
            }
            sendPassiveMessageWithRetries(tabId, llmName, message, {
              attempt: attempt + 1,
              maxAttempts,
              baseDelay,
              transportRetryDelays,
              allowRecovery,
              recoveryAttempted,
              onSuccess,
              onError
            });
            dispatchDeregisterSessionTimer(passiveRetryTimer);
          }, nextDelay));
        };
        const canRecover = allowRecovery
          && !recoveryAttempted
          && (isPortClosed || isNoReceiver || isAsyncChannelClosed)
          && attempt < maxAttempts
          && (typeof self.reinjectScript === 'function' || typeof self.reloadTab === 'function');
        if (canRecover) {
          emitTelemetry(llmName, 'PASSIVE_SEND_RECOVERY_ATTEMPT', {
            level: 'warning',
            details: errMsg,
            meta: { tabId, attempt, messageType: message?.action || message?.type || 'PASSIVE' }
          });
          (async () => {
            let recoveryOk = false;
            let action = null;
            if (self.reinjectScript) {
              action = 'reinject_script';
              recoveryOk = await self.reinjectScript(tabId, llmName);
            } else if (self.reloadTab) {
              action = 'reload_tab';
              recoveryOk = await self.reloadTab(tabId);
            }
            const readyFn = (typeof self.waitForScriptReady === 'function') ? self.waitForScriptReady : null;
            if (recoveryOk && readyFn) {
              recoveryOk = await readyFn(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
            }
            emitTelemetry(llmName, 'PASSIVE_SEND_RECOVERY_RESULT', {
              level: recoveryOk ? 'info' : 'warning',
              details: recoveryOk ? 'ok' : 'failed',
              meta: { tabId, attempt, action, messageType: message?.action || message?.type || 'PASSIVE' }
            });
            if (recoveryOk) {
              sendPassiveMessageWithRetries(tabId, llmName, message, {
                attempt: attempt + 1,
                maxAttempts,
                baseDelay,
                transportRetryDelays,
                allowRecovery,
                recoveryAttempted: true,
                onSuccess,
                onError
              });
              return;
            }
            if ((isPortClosed || isNoReceiver || isAsyncChannelClosed) && attempt < maxAttempts) {
              scheduleTransportRetry();
              return;
            }
            onError?.(errMsg);
          })().catch(() => onError?.(errMsg));
          return;
        }
        if ((isPortClosed || isNoReceiver || isAsyncChannelClosed) && attempt < maxAttempts) {
          scheduleTransportRetry();
          return;
        }
        onError?.(errMsg);
      } else {
        onSuccess?.(response);
      }
    });
  });
}

self.dispatchMutexManager = dispatchMutexManager;
self.promptSubmitWaiters = promptSubmitWaiters;
self.getRetryBackoffForModel = getRetryBackoffForModel;
self.getConnectionRetryDelaysForModel = getConnectionRetryDelaysForModel;
self.withPromptDispatchLock = withPromptDispatchLock;
self.withPromptDispatchFocusLock = withPromptDispatchFocusLock;
self.resolvePromptSubmitted = resolvePromptSubmitted;
self.waitForPromptSubmitted = waitForPromptSubmitted;
self.getPromptSubmitTimeoutMs = getPromptSubmitTimeoutMs;
self.sendMessageWithTimeout = sendMessageWithTimeout;
self.markModelRuntimeActivity = markModelRuntimeActivity;
self.updateTypingStateFromDiagnostic = updateTypingStateFromDiagnostic;
self.isTypingGuardActive = isTypingGuardActive;
self.hasPendingPromptDispatches = hasPendingPromptDispatches;
self.schedulePromptDispatchSupervisor = schedulePromptDispatchSupervisor;
self.runPromptDispatchSupervisor = runPromptDispatchSupervisor;
self.dispatchPromptToTab = dispatchPromptToTab;
self.sendMessageSafely = sendMessageSafely;
self.sendPassiveMessageWithRetries = sendPassiveMessageWithRetries;
self.DISPATCH_MAX_ATTEMPTS = DISPATCH_MAX_ATTEMPTS;
self.clearScriptRuntimeHardStop = clearScriptRuntimeHardStop;
self.clearAllScriptRuntimeHardStops = clearAllScriptRuntimeHardStops;
self.armScriptRuntimeHardStopForConfirmedPrompt = armScriptRuntimeHardStopForConfirmedPrompt;

console.log('[DispatchCoordinator] Module loaded');
