// background/telemetry-logs.js
// Diagnostics logs + telemetry sampling helpers.

'use strict';

const PLATFORM_DEGRADED_WINDOW = 10;
const PLATFORM_DEGRADED_THRESHOLD = 0.5;
const PLATFORM_DEGRADED_COOLDOWN_MS = 15 * 60 * 1000;
const PLATFORM_DEGRADED_HOURLY_THRESHOLD = 0.7;
const PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS = 60 * 60 * 1000;
const PLATFORM_HISTORY_MAX = 50;
const MAX_LOG_ENTRIES = 60;
const DIAG_KEY = '__diagnostics_events__';
// v2.54.24 (2025-12-22 23:14 UTC): Telemetry sampling (Purpose: cap diagnostics volume to 5% of sessions).
const TELEMETRY_SAMPLE_RATE = 0.05;
const TELEMETRY_SCHEMA_VERSION = 2;
const telemetrySampleCache = new TTLMap({ ttlMs: 10 * 60 * 1000, maxSize: 50 });
const pipelineCompleteCache = new TTLMap({ ttlMs: 10 * 60 * 1000, maxSize: 200 });
const POST_TERMINAL_NOISE_LABELS = new Set([
  'ANSWER_GENERATING',
  'ANSWER: LAYER SEMANTIC',
  'PIPELINE_ERROR',
  'SELECTOR_STATS',
  'SELECTOR_RESOLVE',
  'SELECTOR_RESOLVE_FAIL',
  'FOCUS_STUCK',
  'BUDGET_EXHAUSTED',
  'DETECT_DONE',
  'DOM_FALLBACK_START',
  'DOM_FALLBACK_TIMEOUT',
  'LATE_COLLECT_DECISION_TRACE',
  'PING_TRANSPORT_ERROR',
  'RETRY ANSWER EXTRACTION',
  'WAITING FOR ANSWER TO APPEAR',
  'ANSWER UNCHANGED AFTER PING',
  'GETRESPONSES COMMAND SENT',
  'TAB_VISIT',
  'VISIT_QUOTA_BACKOFF',
  'HUMAN_VISIT_START',
  'HUMAN_VISIT_END',
  'HUMAN_VISIT_HARD_CAP',
  'LEASE_GRANTED',
  'LEASE_RELEASED',
  'USER_FOCUS_CHANGE',
  'AUTOMATION_VISIT_SKIPPED',
  'AUTOMATION_VISIT_HARD_CAP'
]);

async function readDiagnosticsEvents() {
  if (self.CompressedStorage?.get) {
    const stored = await self.CompressedStorage.get(DIAG_KEY);
    return Array.isArray(stored) ? stored : [];
  }
  const res = await chrome.storage.local.get([DIAG_KEY]);
  return Array.isArray(res?.[DIAG_KEY]) ? res[DIAG_KEY] : [];
}

async function writeDiagnosticsEvents(entries = []) {
  const payload = Array.isArray(entries) ? entries : [];
  if (self.CompressedStorage?.set) {
    await self.CompressedStorage.set(DIAG_KEY, payload);
    return;
  }
  await chrome.storage.local.set({ [DIAG_KEY]: payload });
}

function ensureLogBuffer(llmName) {
  if (!jobState?.llms?.[llmName]) return null;
  if (!Array.isArray(jobState.llms[llmName].logs)) {
    jobState.llms[llmName].logs = [];
  }
  return jobState.llms[llmName].logs;
}

function getAppVersion() {
  try {
    return chrome?.runtime?.getManifest?.().version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function appendLogEntry(llmName, entry = {}) {
  const buffer = ensureLogBuffer(llmName);
  if (!buffer) return null;
  const resolvedDispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId
    || jobState?.llms?.[llmName]?.requestId
    || null;
  const sharedMeta = {
    extVersion: getAppVersion(),
    runSessionId: jobState?.session?.startTime || null,
    dispatchId: resolvedDispatchId,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    llmName,
    tabId: jobState?.llms?.[llmName]?.tabId || null
  };
  const logEntry = {
    ts: entry.ts || Date.now(),
    type: entry.type || 'INFO',
    label: entry.label || '',
    details: entry.details || '',
    level: entry.level || 'info',
    meta: { ...sharedMeta, ...(entry.meta || {}) }
  };
  buffer.push(logEntry);
  if (buffer.length > MAX_LOG_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_LOG_ENTRIES);
  }
  saveJobState(jobState);
  return logEntry;
}

function isSuccessTerminalDiagnosticState(llmName) {
  const resolvedName = resolveLlmName(llmName);
  const entry = jobState?.llms?.[resolvedName || llmName];
  if (!entry) return false;
  const successStatuses = Array.isArray(SUCCESS_STATUSES)
    ? SUCCESS_STATUSES
    : ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'];
  const status = String(entry.finalStatus || entry.status || '').toUpperCase();
  if (!successStatuses.includes(status)) return false;
  return Boolean(entry.finalStatusRecorded || entry.finalStatus || entry.finalizedAt);
}

function shouldIgnorePostTerminalDiagnostic(llmName, entry = {}) {
  const resolvedNameForRunState = resolveLlmName(llmName);
  const runStateEntry = jobState?.llms?.[resolvedNameForRunState || llmName];
  if (runStateEntry && self.ModelRunState?.isPostTerminalNoiseEvent?.(runStateEntry, entry)) {
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(resolvedNameForRunState || llmName, runStateEntry, 'POST_TERMINAL_NOISE', {
        label: entry?.label || entry?.event || entry?.meta?.event || null,
        source: 'telemetry_post_terminal_filter',
        dispatchId: runStateEntry?.lastDispatchMeta?.dispatchId || runStateEntry?.confirmedDispatchId || null,
        tabId: runStateEntry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    } else {
      self.ModelRunState.recordPostTerminalNoise?.(runStateEntry, entry);
    }
    try { saveJobState(jobState); } catch (_) {}
    return true;
  }
  if (!isSuccessTerminalDiagnosticState(llmName)) return false;
  const resolvedName = resolveLlmName(llmName);
  const stateEntry = jobState?.llms?.[resolvedName || llmName];
  const finalizedAt = Number(stateEntry?.finalizedAt || 0);
  const eventTs = Number(entry?.ts || Date.now());
  if (finalizedAt && eventTs && eventTs + 1000 < finalizedAt) return false;
  const label = String(entry?.label || entry?.event || entry?.meta?.event || '').toUpperCase();
  if (POST_TERMINAL_NOISE_LABELS.has(label)) return true;
  const type = String(entry?.type || '').toUpperCase();
  const level = String(entry?.level || '').toLowerCase();
  return level === 'error' && (type === 'TELEMETRY' || type === 'PIPELINE');
}

function getLogSnapshot(llmName) {
  const buffer = ensureLogBuffer(llmName);
  return buffer ? [...buffer] : [];
}

function downgradePipelineHardTimeoutLogs(llmName) {
  const buffer = ensureLogBuffer(llmName);
  if (!buffer) return false;
  let changed = false;
  buffer.forEach((entry) => {
    if (!entry || entry.label !== 'PIPELINE_ERROR') return;
    const reason = String(entry?.meta?.message || entry?.details || '').toLowerCase();
    const downgradeReasons = ['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete', 'script_runtime_hard_stop'];
    const matched = downgradeReasons.find((value) => reason.includes(value));
    if (!matched) return;
    entry.level = 'warning';
    entry.meta = {
      ...(entry.meta || {}),
      degraded: true,
      degradedReason: entry?.meta?.degradedReason || matched
    };
    changed = true;
  });
  if (changed) saveJobState(jobState);
  return changed;
}

function downgradePipelineHardTimeoutStorage(llmName) {
  const runSessionId = jobState?.session?.startTime || null;
  readDiagnosticsEvents().then((arr) => {
    let changed = false;
    const next = arr.map((evt) => {
      if (!evt || evt.label !== 'PIPELINE_ERROR') return evt;
      const eventRunSessionId = evt?.meta?.runSessionId || evt?.meta?.sessionId || null;
      if (runSessionId && eventRunSessionId && eventRunSessionId !== runSessionId) return evt;
      const name = evt?.meta?.llmName || evt?.platform || evt?.llmName;
      if (llmName && name && name !== llmName) return evt;
      const reason = String(evt?.meta?.message || evt?.details || '').toLowerCase();
      const downgradeReasons = ['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete', 'script_runtime_hard_stop'];
      const matched = downgradeReasons.find((value) => reason.includes(value));
      if (!matched) return evt;
      changed = true;
      return {
        ...evt,
        level: 'warning',
        meta: {
          ...(evt.meta || {}),
          degraded: true,
          degradedReason: evt?.meta?.degradedReason || matched
        }
      };
    });
    if (changed) {
      writeDiagnosticsEvents(next).catch(() => {});
    }
  }).catch(() => {});
}

function broadcastDiagnostic(llmName, entry = {}) {
  if (shouldIgnorePostTerminalDiagnostic(llmName, entry)) return null;
  const saved = appendLogEntry(llmName, entry);
  if (saved) {
    sendMessageToResultsTab({
      type: 'LLM_DIAGNOSTIC_EVENT',
      llmName,
      event: saved,
      logs: getLogSnapshot(llmName)
    });
  }
  return saved;
}

// v2.54.24 (2025-12-22 23:14 UTC): Telemetry dispatch + sampling (Purpose: unify storage + sample by session).
const LLM_NAME_ALIASES = {
  chatgpt: 'GPT',
  gpt: 'GPT',
  gemini: 'Gemini',
  claude: 'Claude',
  grok: 'Grok',
  lechat: 'Le Chat',
  mistral: 'Le Chat',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  perplexity: 'Perplexity'
};

function resolveLlmName(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.toLowerCase();
  if (LLM_NAME_ALIASES[normalized]) return LLM_NAME_ALIASES[normalized];
  const match = Object.keys(LLM_TARGETS || {}).find((name) => name.toLowerCase() === normalized);
  return match || raw;
}

function hashTelemetryKey(value = '') {
  let hash = 0;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function resolveTelemetrySampling(sessionId) {
  const runSessionId = sessionId;
  if (!runSessionId) return Math.random() < TELEMETRY_SAMPLE_RATE;
  if (jobState?.session?.startTime && jobState.session.startTime === runSessionId && typeof jobState.session.telemetrySampled === 'boolean') {
    return jobState.session.telemetrySampled;
  }
  const key = String(runSessionId);
  if (telemetrySampleCache.has(key)) return telemetrySampleCache.get(key);
  const bucket = hashTelemetryKey(key) % 100;
  const sampled = bucket < (TELEMETRY_SAMPLE_RATE * 100);
  telemetrySampleCache.set(key, sampled);
  return sampled;
}

function ensureTelemetryMeta(meta = {}, llmName) {
  const normalized = { ...(meta || {}) };
  const resolvedName = resolveLlmName(llmName || normalized.llmName || normalized.platform);
  if (resolvedName && !normalized.llmName) normalized.llmName = resolvedName;
  if (!normalized.extVersion) normalized.extVersion = getAppVersion();
  const runSessionId = normalized.runSessionId || normalized.sessionId || jobState?.session?.startTime || null;
  if (runSessionId && !normalized.runSessionId) normalized.runSessionId = runSessionId;
  const dispatchId = normalized.dispatchId
    || normalized.requestId
    || jobState?.llms?.[resolvedName || llmName]?.lastDispatchMeta?.dispatchId
    || null;
  if (dispatchId && !normalized.dispatchId) normalized.dispatchId = dispatchId;
  const tabId = normalized.tabId || jobState?.llms?.[resolvedName || llmName]?.tabId || null;
  if (tabId && !normalized.tabId) normalized.tabId = tabId;
  if (!normalized.schemaVersion) normalized.schemaVersion = TELEMETRY_SCHEMA_VERSION;
  return normalized;
}

function isTelemetryEntry(entry = {}) {
  const type = String(entry.type || '').toUpperCase();
  return type === 'TELEMETRY' || type === 'PIPELINE';
}

const PINNED_LABELS = new Set([
  'MODEL_FINAL',
  'FINAL_STATUS',
  'MODEL_MISSING',
  'FOCUS_STUCK',
  'BUDGET_EXHAUSTED',
  'MATERIALIZE_RECOVERY_CONTEXT',
  'MATERIALIZE_RECOVERY_VISIT_RESULT',
  'LATE_COLLECT_DECISION_TRACE',
  'FINAL_ERROR_AFTER_RECOVERY',
  'MATERIALIZE_RECOVERY_VISIT_FALLBACK',
  'ROUND1_TAB_RECOVERY_START',
  'ROUND1_TAB_RECOVERY_OK',
  'ROUND1_TAB_RECOVERY_MISS',
  'ROUND1_TAB_RECOVERY_ERROR',
  'GROK_PROMPT_ECHO_REJECTED',
  'ANSWER_SANITY_REJECTED',
  'TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE',
  'FINALIZATION_DECISION',
  'MODEL_RUN_TRANSITION',
  'STATE_DIVERGENCE_DETECTED',
  'STATE_PROJECTION_COMMITTED'
]);

const isPinnedTelemetryEvent = (entry = {}) => {
  const label = String(entry?.label || entry?.meta?.event || '').toUpperCase();
  if (!label) return false;
  if (label.startsWith('ROUND')) return true;
  return PINNED_LABELS.has(label);
};

const trimDiagnosticsBuffer = (entries = [], maxItems = 200) => {
  let next = Array.isArray(entries) ? entries.slice() : [];
  if (next.length <= maxItems) return next;
  const pinned = next.filter(isPinnedTelemetryEvent);
  const unpinned = next.filter((entry) => !isPinnedTelemetryEvent(entry));
  const capacity = Math.max(0, maxItems - pinned.length);
  const trimmed = capacity ? unpinned.slice(-capacity) : [];
  next = trimmed.concat(pinned);
  next.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
  return next;
};

const dropOldestUnpinned = (entries = []) => {
  if (!entries.length) return entries;
  const idx = entries.findIndex((entry) => !isPinnedTelemetryEvent(entry));
  if (idx === -1) {
    return entries.slice(1);
  }
  return entries.slice(0, idx).concat(entries.slice(idx + 1));
};

function normalizeTelemetryEntry(entry = {}, llmName) {
  const meta = ensureTelemetryMeta({ ...(entry.meta || {}) }, llmName);
  return {
    ts: entry.ts || Date.now(),
    type: entry.type || 'TELEMETRY',
    label: entry.label || meta.event || entry.event || '',
    details: entry.details || '',
    level: entry.level || 'info',
    meta
  };
}

async function persistDiagnosticEvent(llmName, entry = {}, { sender, source } = {}) {
  const normalizedName = resolveLlmName(llmName || entry?.platform || entry?.meta?.platform || entry?.llmName);
  if (shouldIgnorePostTerminalDiagnostic(normalizedName, entry)) return null;
  const evt = Object.assign({}, entry || {}, {
    ts: entry?.ts || Date.now(),
    platform: normalizedName || entry?.platform || 'unknown',
    source: entry?.source || source || sender?.url || sender?.tab?.url || null
  });
  const arr = await readDiagnosticsEvents();
  let next = trimDiagnosticsBuffer([...arr, evt], 200);
  const stringify = () => JSON.stringify(next);
  while (stringify().length > 50000 && next.length > 1) {
    next = dropOldestUnpinned(next);
  }
  await writeDiagnosticsEvents(next);
  return evt;
}

function dispatchTelemetry(llmName, entry = {}, { sender, source, force = false } = {}) {
  if (!entry) return null;
  const normalized = normalizeTelemetryEntry(entry, llmName);
  if (shouldIgnorePostTerminalDiagnostic(llmName, normalized)) return null;
  if (normalized.label === 'PIPELINE_COMPLETE') {
    const dedupeKey = [
      normalized.meta?.runSessionId || 'no_run',
      normalized.meta?.dispatchId || 'no_dispatch',
      normalized.meta?.llmName || llmName || 'unknown'
    ].join('|');
    if (pipelineCompleteCache.has(dedupeKey)) {
      return null;
    }
    pipelineCompleteCache.set(dedupeKey, true);
  }
  const runSessionId = normalized.meta?.runSessionId || jobState?.session?.startTime || null;
  const sampled = force || normalized.level === 'error' || resolveTelemetrySampling(runSessionId);
  if (!sampled) return null;
  if (runSessionId && !normalized.meta.runSessionId) normalized.meta.runSessionId = runSessionId;
  const saved = broadcastDiagnostic(llmName, normalized);
  persistDiagnosticEvent(llmName, saved || normalized, { sender, source }).catch((err) => {
    console.warn('[dispatchTelemetry] store failed', err);
  });
  return saved || normalized;
}

function resolveEventLlmName(message, event, sender) {
  const direct = resolveLlmName(message?.llmName || event?.llmName || event?.meta?.llmName || event?.platform || event?.meta?.platform);
  if (direct) return direct;
  const tabId = sender?.tab?.id;
  const mapped = tabId && TabMapManager?.getNameByTabId ? TabMapManager.getNameByTabId(tabId) : null;
  return resolveLlmName(mapped);
}

function emitTelemetry(llmName, event, { label, details, level = 'info', meta = {}, force = false } = {}) {
  if (!llmName || !event) return null;
  return dispatchTelemetry(llmName, {
    type: 'TELEMETRY',
    label: label || event,
    details: details || '',
    level,
    meta: { event, ...meta }
  }, { force });
}

function recordPlatformRun(llmName, isSuccess) {
  const resolved = resolveLlmName(llmName);
  if (!resolved) return;
  const history = platformRunHistory.get(resolved) || [];
  const now = Date.now();
  history.push({ ts: now, success: !!isSuccess });
  while (history.length > PLATFORM_HISTORY_MAX) {
    history.shift();
  }
  platformRunHistory.set(resolved, history);
  const recentWindow = history.slice(-PLATFORM_DEGRADED_WINDOW);
  if (recentWindow.length >= PLATFORM_DEGRADED_WINDOW) {
    const successCount = recentWindow.filter((entry) => entry.success).length;
    const successRate = successCount / recentWindow.length;
    if (successRate < PLATFORM_DEGRADED_THRESHOLD) {
      const lastAlert = platformDegradedAt.get(resolved) || 0;
      if (now - lastAlert >= PLATFORM_DEGRADED_COOLDOWN_MS) {
        platformDegradedAt.set(resolved, now);
        emitTelemetry(resolved, 'PLATFORM_DEGRADED', {
          level: 'warning',
          details: `successRate=${Math.round(successRate * 100)}%`,
          meta: {
            successRate,
            windowSize: recentWindow.length,
            threshold: PLATFORM_DEGRADED_THRESHOLD
          }
        });
      }
    }
  }
  const hourlyCutoff = now - 60 * 60 * 1000;
  const hourly = history.filter((entry) => entry.ts >= hourlyCutoff);
  if (hourly.length >= 4) {
    const hourlySuccess = hourly.filter((entry) => entry.success).length;
    const hourlyRate = hourlySuccess / hourly.length;
    if (hourlyRate < PLATFORM_DEGRADED_HOURLY_THRESHOLD) {
      const lastHourlyAlert = platformDegradedHourlyAt.get(resolved) || 0;
      if (now - lastHourlyAlert >= PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS) {
        platformDegradedHourlyAt.set(resolved, now);
        emitTelemetry(resolved, 'PLATFORM_DEGRADED_HOURLY', {
          level: 'warning',
          details: `successRate=${Math.round(hourlyRate * 100)}%`,
          meta: {
            successRate: hourlyRate,
            windowSize: hourly.length,
            threshold: PLATFORM_DEGRADED_HOURLY_THRESHOLD
          }
        });
      }
    }
  }
}

self.PLATFORM_DEGRADED_WINDOW = PLATFORM_DEGRADED_WINDOW;
self.PLATFORM_DEGRADED_THRESHOLD = PLATFORM_DEGRADED_THRESHOLD;
self.PLATFORM_DEGRADED_COOLDOWN_MS = PLATFORM_DEGRADED_COOLDOWN_MS;
self.PLATFORM_DEGRADED_HOURLY_THRESHOLD = PLATFORM_DEGRADED_HOURLY_THRESHOLD;
self.PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS = PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS;
self.PLATFORM_HISTORY_MAX = PLATFORM_HISTORY_MAX;
self.MAX_LOG_ENTRIES = MAX_LOG_ENTRIES;
self.TELEMETRY_SAMPLE_RATE = TELEMETRY_SAMPLE_RATE;
self.telemetrySampleCache = telemetrySampleCache;
self.appendLogEntry = appendLogEntry;
self.getLogSnapshot = getLogSnapshot;
self.downgradePipelineHardTimeoutLogs = downgradePipelineHardTimeoutLogs;
self.downgradePipelineHardTimeoutStorage = downgradePipelineHardTimeoutStorage;
self.broadcastDiagnostic = broadcastDiagnostic;
self.LLM_NAME_ALIASES = LLM_NAME_ALIASES;
self.resolveLlmName = resolveLlmName;
self.hashTelemetryKey = hashTelemetryKey;
self.resolveTelemetrySampling = resolveTelemetrySampling;
self.isTelemetryEntry = isTelemetryEntry;
self.normalizeTelemetryEntry = normalizeTelemetryEntry;
self.shouldIgnorePostTerminalDiagnostic = shouldIgnorePostTerminalDiagnostic;
self.persistDiagnosticEvent = persistDiagnosticEvent;
self.dispatchTelemetry = dispatchTelemetry;
self.resolveEventLlmName = resolveEventLlmName;
self.emitTelemetry = emitTelemetry;
self.recordPlatformRun = recordPlatformRun;
