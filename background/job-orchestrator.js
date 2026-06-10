// background/job-orchestrator.js
// Job lifecycle orchestration.

if (!self.__JOB_ORCHESTRATOR_INITIALIZED__) {
  self.__JOB_ORCHESTRATOR_INITIALIZED__ = true;
  (function initJobOrchestrator() {
    'use strict';

const ROUND0_OPEN_STAGGER_MS = 1000;
const ROUND0_BIND_WAIT_TIMEOUT_MS = 15000;
const ROUND0_BIND_POLL_MS = 250;
//- 1.1. Сокращаем подготовку -//
const ROUND1_BEFORE_SEND_MS = 500;
//- 1.2. Round 1 sends the command quickly, but confirmation is handled explicitly in Round 2. -//
const ROUND1_POST_SEND_MS = 500;
const ROUND2_VISIT_COUNT = 2;
const ROUND2_VISIT_MIN_MS = 5000;
const ROUND2_VISIT_MAX_MS = 8000;
const ROUND2_BATCH_MAX_MS = 45000;
const ROUND2_MODEL_VISIT_BUDGET_MS = 7000;
const ROUND2_MODEL_MIN_REMAINING_MS = 1800;
const ROUND2_MODEL_MIN_DWELL_MS = 1400;
const ROUND2_REPAIR_CONFIRM_WAIT_MS = 3500;
const ROUND2_REPAIR_CONFIRM_POLL_MS = 250;
const PRECOLLECT_NUDGE_STABILIZE_MS = 250;
//-- 4.1. ÐšÐ¾Ð½ÑÑ‚Ð°Ð½Ñ‚Ð° Ð´Ð»Ñ Round 3 --//
const ROUND3_COLLECT_DELAY_MS = 2000;
const ROUND3_START_DELAY_MS = 2000;
const ROUND3_PRECOLLECT_VISIT_COUNT = 1;
const ROUND3_PRECOLLECT_VISIT_MIN_MS = 5000;
const ROUND3_PRECOLLECT_VISIT_MAX_MS = 8000;
const ROUND4_FOCUS_DELAY_MS = 500;
const ROUND4_PENDING_WAIT_MAX_MS = 190000;
const ROUND4_PENDING_POLL_MS = 1500;
const NO_SEND_STALL_GRACE_MS = 45000;
const ROUND2_REPAIR_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Grok', 'Le Chat', 'Qwen']);
const POST_R2_AUTO_COLLECT_DELAY_MS = 8000;
const POST_R2_AUTO_COLLECT_VISIT_COUNT = 1;
const POST_R2_AUTO_COLLECT_VISIT_MIN_MS = 5000;
const POST_R2_AUTO_COLLECT_VISIT_MAX_MS = 8000;
const CLAUDE_RETRY_VISIT_MIN_MS = 5000;
const CLAUDE_RETRY_VISIT_MAX_MS = 8000;
const CLAUDE_RETRY_DELAY_MS = 4000;
const CLAUDE_RETRY_FINALIZE_MS = 20000;
const MANUAL_PING_WINDOW_MS = 20000;
const ADAPTIVE_PROBE_FAST_WINDOW_MS = 20000;
const ADAPTIVE_PROBE_MEDIUM_WINDOW_MS = 60000;
const ADAPTIVE_PROBE_FAST_INTERVAL_MS = 2500;
const ADAPTIVE_PROBE_MEDIUM_INTERVAL_MS = 6000;
const ADAPTIVE_PROBE_SLOW_INTERVAL_MS = 12000;
const ADAPTIVE_PROBE_TOTAL_WINDOW_MS = 180000;
const EARLY_GESTURE_RECOVERY_MODELS = new Set(['Gemini', 'Perplexity']);
const EARLY_GESTURE_RECOVERY_MIN_ELAPSED_MS = 45000;
const EARLY_GESTURE_RECOVERY_MIN_ERRORS = 3;
const EARLY_GESTURE_RECOVERY_COOLDOWN_MS = 30000;
const EARLY_GESTURE_RECOVERY_VISIT_MIN_MS = 2200;
const EARLY_GESTURE_RECOVERY_VISIT_MAX_MS = 3200;
const HARD_STOP_DEFER_WINDOW_DEFAULT_MS = 12000;
const HARD_STOP_DEFER_WINDOW_BY_MODEL_MS = Object.freeze({
  Gemini: 24000,
  Claude: 18000,
  'Le Chat': 18000,
  Perplexity: 18000,
  Grok: 18000
});
const HARD_STOP_ACTIVITY_GRACE_MS = 15000;
const HARD_STOP_DEFER_RECOVERY_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok']);
const HARD_STOP_DEFER_RECOVERY_VISIT_MIN_MS = 2000;
const HARD_STOP_DEFER_RECOVERY_VISIT_MAX_MS = 3200;
const PRE_TERMINAL_MATERIALIZE_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok', 'Qwen', 'DeepSeek']);
const PRE_TERMINAL_MATERIALIZE_STATUSES = new Set(['NO_SEND', 'EXTRACT_FAILED', 'ERROR']);
const PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS = 5200;
const PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS = 7600;
const PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS = 5600;
const PRE_TERMINAL_MATERIALIZE_SETTLE_MS = 1100;
const PRE_TERMINAL_MATERIALIZE_COOLDOWN_MS = 45000;
const MATERIALIZE_LATEST_RETRY_WAIT_MS = 1800;
const MATERIALIZE_LATEST_RETRY_MODELS = new Set(['Qwen', 'Gemini', 'Le Chat', 'Perplexity', 'DeepSeek']);
const FAST_PING_RETRY_DELAYS_MS = Object.freeze([700, 1500, 2600]);
const HARD_STOP_PING_RETRY_DELAYS_MS = Object.freeze([350, 900, 1700, 2800]);
const MODEL_FINAL_DEDUP_WINDOW_MS = 20000;
const RECOVERABLE_TERMINAL_MANUAL_PING_WINDOW_MS = 180000;
const RECOVERABLE_TERMINAL_PING_STATUSES = new Set(['EXTRACT_FAILED', 'NO_SEND', 'ERROR']);
const DOM_SNAPSHOT_RECOVERY_MODELS = new Set(['Gemini', 'Perplexity', 'Le Chat', 'Qwen', 'DeepSeek']);
const DOM_SNAPSHOT_RECOVERY_MIN_CHARS = 80;
const DOM_SNAPSHOT_RECOVERY_COOLDOWN_MS = 5000;
const LATE_COLLECT_CACHE_KEY_PREFIX = 'late_answer_snapshot_v1';
const LATE_COLLECT_CACHE_MAX_CHARS = 50000;
const LATE_COLLECT_TOTAL_BUDGET_MS = 12000;
const LATE_COLLECT_PING_TIMEOUT_MS = 900;
const LATE_COLLECT_SLOW_PING_TIMEOUT_MS = 1500;
const LATE_COLLECT_EXECUTE_TIMEOUT_MS = 3500;
const LATE_COLLECT_POST_LIVE_WAIT_MS = 700;
const LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS = 2500;
const LATE_COLLECT_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const LATE_COLLECT_SLOW_MODELS = new Set(['Gemini', 'Claude', 'Qwen', 'DeepSeek', 'Le Chat', 'Perplexity']);
const RECOVERY_BUDGET_DEFAULT = Object.freeze({
  snapshotAttempts: 2,
  inlineDomAttempts: 2,
  manualPingAttempts: 1,
  controlledVisitAttempts: 1,
  maxTotalMs: 90000
});
const lateAnswerSnapshotMemory = new Map();
const lateAnswerCollectInFlight = new Map();
const MANUAL_RECOVERY_STRATEGIES = Object.freeze([
  { id: 'default_score', label: 'Default selector score' },
  { id: 'last_visible', label: 'Last visible answer candidate' },
  { id: 'bottom_most', label: 'Bottom-most answer candidate' },
  { id: 'longest', label: 'Longest answer candidate' },
  { id: 'markdown_only', label: 'Markdown/prose answer candidate' },
  { id: 'assistant_role_only', label: 'Assistant-role answer candidate' },
  { id: 'article_bottom', label: 'Bottom article answer candidate' }
]);
const DEFER_STREAM_FINAL_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok', 'Qwen', 'DeepSeek']);
const DEFER_STREAM_FINAL_RECHECK_MS = 8000;
const DEFER_STREAM_FINAL_MAX_MS = 180000;
const DEFER_STREAM_STABLE_FORCE_MS = 30000;
const DEFER_STREAM_STABLE_FORCE_MIN_CHARS = 1200;
const EARLY_TERMINAL_GUARD_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok', 'Qwen', 'DeepSeek']);
const EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS = 1800;
const EARLY_TERMINAL_GUARD_MAX_WAIT_MS = 20000;
const EARLY_TERMINAL_GUARD_STABLE_MS = 2500;
const EARLY_TERMINAL_GUARD_REPING_MS = 2200;
//- 1.2. Увеличиваем общий лимит раунда, чтобы он никогда не обрывался на середине списка -//
const DISPATCH_BUDGET_MS = 120000;
const GENERATION_BUDGET_MS = 180000;
const COLLECT_BUDGET_MS = 60000;

const resolveBudgetMsForPhase = (phase) => {
  switch (String(phase || '').toLowerCase()) {
    case 'dispatch':
      return DISPATCH_BUDGET_MS;
    case 'generation':
      return GENERATION_BUDGET_MS;
    case 'collect':
      return COLLECT_BUDGET_MS;
    default:
      return 0;
  }
};

const ensureBudgetStore = (entry) => {
  if (!entry) return null;
  if (!entry.budgetTimers || typeof entry.budgetTimers !== 'object') {
    entry.budgetTimers = {};
  }
  return entry.budgetTimers;
};

const isTerminalEntry = (entry) => {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState && self.ModelRunState.isTerminalRunState(entry)) return true;
  const terminalStatuses = Array.isArray(TERMINAL_STATUSES) ? TERMINAL_STATUSES : ['COPY_SUCCESS'];
  if (terminalStatuses.includes(entry.status)) return true;
  if (entry.finalStatusRecorded || entry.finalStatus) return true;
  return false;
};

const isFinalizedEntry = (entry) => {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState && self.ModelRunState.isTerminalRunState(entry)) return true;
  return Boolean(entry.finalStatusRecorded || entry.finalStatus);
};

function extractLatestAssistantSnapshotInPage(modelName, minChars = 80, options = {}) {
  const normalizedModel = String(modelName || '').toLowerCase();
  const manualOptions = options && typeof options === 'object' ? options : {};
  const strategyIds = [
    'default_score',
    'last_visible',
    'bottom_most',
    'longest',
    'markdown_only',
    'assistant_role_only',
    'article_bottom'
  ];
  const skipStrategyIds = new Set(Array.isArray(manualOptions.skipStrategyIds) ? manualOptions.skipStrategyIds.map(String) : []);
  const skipSelectors = new Set(Array.isArray(manualOptions.skipSelectors) ? manualOptions.skipSelectors.map(String) : []);
  const requestedStrategyId = typeof manualOptions.strategyId === 'string' ? manualOptions.strategyId : '';
  const requestedStrategyIndex = Number.isFinite(Number(manualOptions.strategyIndex)) ? Number(manualOptions.strategyIndex) : 0;
  const resolveStrategyId = () => {
    if (requestedStrategyId && strategyIds.includes(requestedStrategyId) && !skipStrategyIds.has(requestedStrategyId)) {
      return requestedStrategyId;
    }
    for (let offset = 0; offset < strategyIds.length; offset += 1) {
      const id = strategyIds[(requestedStrategyIndex + offset) % strategyIds.length];
      if (!skipStrategyIds.has(id)) return id;
    }
    return 'default_score';
  };
  const strategyId = resolveStrategyId();
  const strategyIndex = Math.max(0, strategyIds.indexOf(strategyId));
  const selectorMap = {
    gemini: [
      'model-response',
      '.model-response-text',
      'message-content',
      '[data-test-id="model-response-text"]',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      'div[class*="model-response"]',
      '.markdown',
      'article'
    ],
    perplexity: [
      '[data-testid="answer-card"]',
      '[data-testid="answer-card"] .prose',
      '[data-testid="answer"]',
      '[data-testid="answer"] .prose',
      '[data-testid="chat-message"] .prose',
      '[data-testid="conversation-turn"] .prose',
      '[class*="answer-container" i] .prose',
      '.answer',
      '.prose',
      'article'
    ],
    'le chat': [
      'div[data-testid="lechat-response"] .prose',
      '[data-testid="answer"] .prose',
      '[data-testid="message-content"]',
      'div[class*="message-content" i]',
      '[role="article"] .prose',
      'article .prose',
      '.prose',
      '.answer',
      '.result'
    ],
    qwen: [
      'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
      'div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose',
      'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
      'div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose',
      '[data-testid="chat-response"] .qwen-markdown',
      '[data-testid="chat-response"] .custom-qwen-markdown',
      'div.custom-qwen-markdown',
      'div.qwen-markdown.qwen-markdown-loose'
    ],
    deepseek: [
      '.message-item[data-role="assistant"] .markdown-body',
      '.message-item[data-role="assistant"] .message-content',
      '[data-role="assistant"] .markdown-body',
      '[data-role="assistant"] .message-content',
      'div.ds-message div.ds-markdown',
      '.assistant-message .markdown-body',
      '.assistant-message',
      '.markdown-body',
      '.message-content'
    ]
  };
  const genericSelectors = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-testid*="assistant" i]',
    '.assistant-message',
    '[class*="assistant" i] .markdown',
    '[class*="assistant" i] .prose',
    '.markdown',
    '.markdown-body',
    '.prose',
    'article',
    '[role="article"]'
  ];
  const selectors = selectorMap[normalizedModel] || genericSelectors;
  const seen = new Set();
  const nodes = [];
  const nodeSelectors = new Map();
  const walkRoot = (root) => {
    if (!root?.querySelectorAll) return;
    selectors.forEach((selector) => {
      try {
        root.querySelectorAll(selector).forEach((node) => {
          if (node && !seen.has(node)) {
            seen.add(node);
            nodes.push(node);
            nodeSelectors.set(node, selector);
          }
        });
      } catch (_) {}
    });
    try {
      root.querySelectorAll('*').forEach((node) => {
        if (node?.shadowRoot) walkRoot(node.shadowRoot);
      });
    } catch (_) {}
  };
  walkRoot(document);
  const isRejectedNode = (node) => {
    const tag = String(node?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'button', 'nav', 'header', 'footer', 'form'].includes(tag)) return true;
    if (node?.closest?.('textarea,input,button,nav,header,footer,form,[contenteditable="true"]')) return true;
    return false;
  };
  const getText = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const hashText = (value = '') => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };
  const baseCandidates = nodes
    .filter((node) => node && !isRejectedNode(node))
    .map((node, index) => {
      const text = getText(node);
      let visible = true;
      let rectTop = 0;
      let rectBottom = 0;
      try {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        rectTop = Number(rect?.top || 0);
        rectBottom = Number(rect?.bottom || 0);
      } catch (_) {}
      const selector = nodeSelectors.get(node) || '';
      const descriptor = `${selector}#${index}`;
      const className = String(node.className || '');
      const html = String(node.innerHTML || '').trim();
      const isMarkdown = /markdown|prose|qwen-markdown|markdown-body/i.test(`${selector} ${className}`);
      const assistantNode = node.closest?.('[data-message-author-role="assistant"],[data-role="assistant"],.assistant-message,.qwen-chat-message-assistant,[class*="assistant" i]');
      const isAssistantRole = !!assistantNode;
      const isArticle = selector.includes('article') || !!node.closest?.('article,[role="article"]');
      return {
        index,
        text,
        html,
        selector,
        descriptor,
        visible,
        rectTop,
        rectBottom,
        isMarkdown,
        isAssistantRole,
        isArticle,
        score: text.length + (visible ? 500 : 0) + index
      };
    })
    .filter((candidate) => candidate.text.length >= minChars)
    .filter((candidate) => !skipSelectors.has(candidate.selector) && !skipSelectors.has(candidate.descriptor));
  const filterByStrategy = (items) => {
    if (strategyId === 'markdown_only') return items.filter((candidate) => candidate.isMarkdown);
    if (strategyId === 'assistant_role_only') return items.filter((candidate) => candidate.isAssistantRole);
    if (strategyId === 'article_bottom') return items.filter((candidate) => candidate.isArticle);
    return items;
  };
  const scoreByStrategy = (candidate) => {
    if (strategyId === 'last_visible') return (candidate.visible ? 1000000 : 0) + candidate.index;
    if (strategyId === 'bottom_most' || strategyId === 'article_bottom') return (candidate.visible ? 1000000 : 0) + candidate.rectBottom;
    if (strategyId === 'longest') return candidate.text.length;
    return candidate.score;
  };
  let candidates = filterByStrategy(baseCandidates);
  if (!candidates.length && strategyId !== 'default_score') {
    candidates = baseCandidates;
  }
  candidates = candidates
    .map((candidate) => ({ ...candidate, strategyScore: scoreByStrategy(candidate) }))
    .sort((a, b) => b.strategyScore - a.strategyScore);
  const best = candidates[0] || null;
  return best
    ? {
      ok: true,
      text: best.text,
      html: best.html,
      length: best.text.length,
      visible: best.visible,
      candidates: candidates.length,
      candidateCount: baseCandidates.length,
      strategyId,
      strategyIndex,
      selectorUsed: best.selector,
      selectorDescriptor: best.descriptor,
      textHash: hashText(best.text)
    }
    : {
      ok: false,
      length: 0,
      candidates: 0,
      candidateCount: baseCandidates.length,
      strategyId,
      strategyIndex
    };
}

const normalizeSnapshotKeyPart = (value) => String(value || 'none')
  .replace(/[^a-z0-9_-]+/gi, '_')
  .slice(0, 96);

const buildAnswerSnapshotKey = ({ llmName, runSessionId, dispatchId, tabId } = {}) => [
  LATE_COLLECT_CACHE_KEY_PREFIX,
  normalizeSnapshotKeyPart(llmName),
  normalizeSnapshotKeyPart(runSessionId || 'session'),
  normalizeSnapshotKeyPart(dispatchId || 'dispatch'),
  normalizeSnapshotKeyPart(tabId || 'tab')
].join(':');

const normalizeLateAnswerText = (value, maxChars = LATE_COLLECT_CACHE_MAX_CHARS) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, Math.max(0, Number(maxChars) || LATE_COLLECT_CACHE_MAX_CHARS));

const simpleLateAnswerHash = (value = '') => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const getCurrentRunSessionId = () => Number(jobState?.session?.startTime || 0) || null;

const resolveLateCollectDispatchId = (llmName, meta = {}) => {
  const entry = llmName ? jobState?.llms?.[llmName] : null;
  return meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
};

async function saveAnswerSnapshotFromContent(message = {}, sender = {}) {
  const tabId = sender?.tab?.id || message?.tabId || null;
  const llmName = message?.llmName || (tabId ? TabMapManager.getNameByTabId(tabId) : null);
  if (!llmName || !isValidTabId(tabId)) {
    return { status: 'snapshot_ignored', reason: 'missing_llm_or_tab' };
  }
  const text = normalizeLateAnswerText(message?.text || message?.answer || '');
  if (text.length < DOM_SNAPSHOT_RECOVERY_MIN_CHARS) {
    return { status: 'snapshot_ignored', reason: 'too_short' };
  }
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const runSessionId = meta.runSessionId || meta.sessionId || getCurrentRunSessionId() || null;
  const dispatchId = meta.dispatchId || resolveLateCollectDispatchId(llmName, meta);
  const key = buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId, tabId });
  const payload = {
    llmName,
    tabId,
    text,
    html: typeof message?.html === 'string' ? message.html.slice(0, LATE_COLLECT_CACHE_MAX_CHARS) : '',
    hash: message?.hash || simpleLateAnswerHash(text),
    length: text.length,
    url: typeof message?.url === 'string' ? message.url.slice(0, 1024) : '',
    meta: {
      runSessionId,
      sessionId: runSessionId,
      dispatchId,
      tabSessionId: meta.tabSessionId || null
    },
    updatedAt: Date.now()
  };
  const aliasKeys = Array.from(new Set([
    key,
    buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId: null, tabId }),
    buildAnswerSnapshotKey({ llmName, runSessionId: null, dispatchId: null, tabId })
  ]));
  aliasKeys.forEach((aliasKey) => lateAnswerSnapshotMemory.set(aliasKey, payload));
  if (self.CompressedStorage?.set) {
    try {
      await Promise.all(aliasKeys.map((aliasKey) => self.CompressedStorage.set(aliasKey, payload)));
    } catch (err) {
      console.warn('[LateAnswerCollector] snapshot storage failed', err);
    }
  }
  return { status: 'snapshot_saved', key, length: payload.length, hash: payload.hash };
}

async function readAnswerSnapshotCache({ llmName, runSessionId, dispatchId, tabId } = {}) {
  const keys = [
    buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId, tabId }),
    buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId: null, tabId }),
    buildAnswerSnapshotKey({ llmName, runSessionId: null, dispatchId: null, tabId })
  ];
  const isFreshSnapshot = (entry) => {
    const updatedAt = Number(entry?.updatedAt || 0);
    return updatedAt > 0 && (Date.now() - updatedAt) <= LATE_COLLECT_SNAPSHOT_TTL_MS;
  };
  for (const key of keys) {
    const memoryValue = lateAnswerSnapshotMemory.get(key);
    if (!memoryValue?.text) continue;
    if (isFreshSnapshot(memoryValue)) return memoryValue;
    lateAnswerSnapshotMemory.delete(key);
  }
  if (self.CompressedStorage?.get) {
    for (const key of keys) {
      try {
        const stored = await self.CompressedStorage.get(key);
        if (!stored?.text) continue;
        if (isFreshSnapshot(stored)) {
          lateAnswerSnapshotMemory.set(key, stored);
          return stored;
        }
        lateAnswerSnapshotMemory.delete(key);
        if (self.CompressedStorage?.remove) {
          await self.CompressedStorage.remove(key);
        }
      } catch (_) {}
    }
  }
  return null;
}

async function clearLateAnswerSnapshotCache(reason = 'new_run') {
  lateAnswerSnapshotMemory.clear();
  if (!chrome?.storage?.local?.get || !chrome?.storage?.local?.remove) {
    return { ok: true, removed: 0, reason: 'storage_unavailable' };
  }
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((key) => key.startsWith(`${LATE_COLLECT_CACHE_KEY_PREFIX}:`));
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
    return { ok: true, removed: keys.length, reason };
  } catch (err) {
    console.warn('[LateAnswerCollector] snapshot cache cleanup failed', err);
    return { ok: false, removed: 0, reason, error: err?.message || String(err) };
  }
}

const withLateCollectTimeout = (promise, timeoutMs, fallback) => new Promise((resolve) => {
  let settled = false;
  const timer = registerSessionTimer(setTimeout(() => {
    if (settled) return;
    settled = true;
    deregisterSessionTimer(timer);
    resolve(typeof fallback === 'function' ? fallback() : fallback);
  }, Math.max(1, Number(timeoutMs) || 1)));
  Promise.resolve(promise)
    .then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deregisterSessionTimer(timer);
      resolve(value);
    })
    .catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deregisterSessionTimer(timer);
      resolve(typeof fallback === 'function' ? fallback(err) : fallback);
    });
});

const sendTabMessageForLateCollect = (tabId, payload, timeoutMs) => withLateCollectTimeout(new Promise((resolve) => {
  try {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      const errMsg = chrome.runtime.lastError?.message || '';
      if (errMsg) {
        resolve({ ok: false, error: errMsg });
        return;
      }
      resolve({ ok: true, response });
    });
  } catch (err) {
    resolve({ ok: false, error: err?.message || String(err) });
  }
}), timeoutMs, (err) => ({ ok: false, error: err?.message || 'timeout' }));

async function classifyLateCollectState(tabId, llmName) {
  const tab = await getTabSafe(tabId);
  if (!tab) return { state: 'DEAD', reason: 'tab_missing' };
  if (tab.discarded === true) return { state: 'DEAD', reason: 'tab_discarded', tab: buildTabSnapshot(tab) };
  if (!isEligibleTabForLlm(llmName, tab)) return { state: 'DEAD', reason: 'tab_ineligible', tab: buildTabSnapshot(tab) };
  const pingTimeout = LATE_COLLECT_SLOW_MODELS.has(llmName) ? LATE_COLLECT_SLOW_PING_TIMEOUT_MS : LATE_COLLECT_PING_TIMEOUT_MS;
  const ping = await sendTabMessageForLateCollect(tabId, {
    action: 'LATE_COLLECT_PING',
    type: 'LATE_COLLECT_PING',
    llmName
  }, pingTimeout);
  if (ping?.ok) {
    return { state: 'ALIVE', reason: 'content_script_ping_ok', tab: buildTabSnapshot(tab), ping: ping.response || null };
  }
  const probe = await withLateCollectTimeout(chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      ok: true,
      href: location.href,
      readyState: document.readyState,
      hasBody: !!document.body
    })
  }), LATE_COLLECT_EXECUTE_TIMEOUT_MS, (err) => ({ ok: false, error: err?.message || 'execute_timeout' }));
  const probeOk = Array.isArray(probe) && probe.some((item) => item?.result?.ok);
  if (probeOk) {
    return { state: 'REINJECTABLE', reason: 'execute_script_probe_ok', tab: buildTabSnapshot(tab), pingError: ping?.error || null };
  }
  return {
    state: 'DEAD',
    reason: 'execute_script_unavailable',
    tab: buildTabSnapshot(tab),
    error: probe?.error || ping?.error || null
  };
}

async function runInlineLateExtract({ tabId, llmName, minChars = DOM_SNAPSHOT_RECOVERY_MIN_CHARS, manualRecovery = null } = {}) {
  // Read-only fallback: execute a pure extractor only, without content-script reinjection,
  // listeners, observers, reloads, prompt resend, or DOM mutation.
  const result = await withLateCollectTimeout(chrome.scripting.executeScript({
    target: { tabId },
    func: extractLatestAssistantSnapshotInPage,
    args: [llmName, minChars, manualRecovery || {}]
  }), LATE_COLLECT_EXECUTE_TIMEOUT_MS, (err) => ({ ok: false, error: err?.message || 'execute_timeout' }));
  const snapshot = Array.isArray(result) ? result.find((item) => item?.result)?.result : null;
  if (snapshot?.ok && snapshot.text) {
    return snapshot;
  }
  return { ok: false, length: snapshot?.length || 0, candidates: snapshot?.candidates || 0, error: result?.error || null };
}

async function lateCollectAnswer({ llmName, tabId, reason = 'late_collect', meta = {}, minChars = DOM_SNAPSHOT_RECOVERY_MIN_CHARS, manualRecovery = null } = {}) {
  if (!llmName || !isValidTabId(tabId)) return { ok: false, status: 'late_collect_failed', reason: 'missing_llm_or_tab' };
  const entry = jobState?.llms?.[llmName] || null;
  const runSessionId = meta?.runSessionId || meta?.sessionId || getCurrentRunSessionId();
  const dispatchId = resolveLateCollectDispatchId(llmName, meta);
  const manualFlightPart = manualRecovery?.manualRecovery
    ? `${manualRecovery.strategyId || 'manual'}:${manualRecovery.selectorAttempt ?? '0'}`
    : 'auto';
  const flightKey = `${llmName}:${tabId}:${dispatchId || 'no_dispatch'}:${manualFlightPart}`;
  const existing = lateAnswerCollectInFlight.get(flightKey);
  if (existing && Date.now() - Number(existing.startedAt || 0) < LATE_COLLECT_TOTAL_BUDGET_MS) {
    return existing.promise;
  }

  const promise = (async () => {
    const startedAt = Date.now();
    const emitDecisionTrace = (result = {}, extra = {}) => {
      const textLength = Number(result?.textLength || String(result?.text || '').length || 0);
      emitTelemetry(llmName, 'LATE_COLLECT_DECISION_TRACE', {
        level: result?.ok ? 'success' : 'warning',
        details: `${reason}:${result?.status || 'unknown'}:${result?.source || 'none'}`,
        meta: {
          reason,
          tabId,
          dispatchId,
          runSessionId,
          ok: !!result?.ok,
          status: result?.status || null,
          state: extra.state || null,
          stateReason: extra.stateReason || result?.reason || null,
          source: result?.source || 'none',
          textLength,
          candidateCount: Number(result?.candidateCount || result?.candidates || 0),
          selectorUsed: result?.selectorUsed || null,
          strategyId: result?.strategyId || null,
          strategyIndex: Number.isFinite(Number(result?.strategyIndex)) ? Number(result.strategyIndex) : null,
          textHash: result?.textHash || (result?.text ? simpleLateAnswerHash(result.text) : null),
          cachedLength: Number(extra.cachedLength || 0),
          elapsedMs: Math.max(0, Date.now() - startedAt),
          manualRecovery: !!(manualRecovery || meta?.manualRecovery),
          preTerminalMaterialize: !!meta?.preTerminalMaterialize
        },
        force: true
      });
      return result;
    };
    const cached = await readAnswerSnapshotCache({ llmName, runSessionId, dispatchId, tabId });
    const state = await classifyLateCollectState(tabId, llmName);
    if (state.state === 'DEAD') {
      broadcastDiagnostic(llmName, {
        type: 'RECOVERY',
        label: cached?.text ? 'Late collect used cached snapshot' : 'Late collect dead tab',
        details: state.reason,
        level: cached?.text ? 'warning' : 'error',
        meta: { source: 'late_collect', reason, state: state.state, length: cached?.length || 0 }
      });
      return emitDecisionTrace(cached?.text
        ? { ok: true, status: 'partial_from_snapshot', text: cached.text, html: cached.html || '', source: 'snapshot_cache', reason: state.reason }
        : { ok: false, status: 'dead_tab_no_snapshot', text: '', source: 'none', reason: state.reason }, {
          state: state.state,
          stateReason: state.reason,
          cachedLength: cached?.length || 0
        });
    }

    if (state.state === 'ALIVE') {
      await sendTabMessageForLateCollect(tabId, {
        action: 'getResponses',
        meta: {
          ...(meta || {}),
          source: `late_collect_live:${reason}`,
          runSessionId,
          sessionId: runSessionId,
          dispatchId,
          forceEmitOnUnchanged: true,
          manualRecovery: manualRecovery || meta?.manualRecovery || null
        }
      }, LATE_COLLECT_SLOW_PING_TIMEOUT_MS);
      await withLateCollectTimeout(new Promise((resolve) => {
        const timer = registerSessionTimer(setTimeout(() => {
          deregisterSessionTimer(timer);
          resolve(true);
        }, LATE_COLLECT_POST_LIVE_WAIT_MS));
      }), LATE_COLLECT_POST_LIVE_WAIT_MS + 100, true);
      const liveEntry = jobState?.llms?.[llmName] || entry;
      if (liveEntry?.answer && String(liveEntry.answer).trim().length >= minChars) {
        const liveMeta = liveEntry.responseMeta && typeof liveEntry.responseMeta === 'object' ? liveEntry.responseMeta : {};
        return emitDecisionTrace({
          ok: true,
          status: 'success',
          text: liveEntry.answer,
          html: liveEntry.answerHtml || '',
          source: 'content_script',
          reason: state.reason,
          strategyId: liveMeta.strategyId || manualRecovery?.strategyId || meta?.manualRecovery?.strategyId || null,
          strategyIndex: Number.isFinite(Number(liveMeta.strategyIndex))
            ? Number(liveMeta.strategyIndex)
            : (manualRecovery?.strategyIndex ?? meta?.manualRecovery?.strategyIndex ?? null),
          selectorUsed: liveMeta.selectorUsed || null,
          selectorDescriptor: liveMeta.selectorDescriptor || liveMeta.selectorUsed || null,
          candidateCount: Number(liveMeta.candidateCount || liveMeta.candidates || 0),
          textHash: liveMeta.textHash || simpleLateAnswerHash(liveEntry.answer)
        }, { state: state.state, stateReason: state.reason, cachedLength: cached?.length || 0 });
      }
    }

    const inline = await runInlineLateExtract({ tabId, llmName, minChars, manualRecovery: manualRecovery || meta?.manualRecovery || null });
    if (inline?.ok && inline.text) {
      await saveAnswerSnapshotFromContent({
        llmName,
        tabId,
        text: inline.text,
        html: inline.html || '',
        hash: simpleLateAnswerHash(inline.text),
        url: state?.tab?.url || '',
        meta: {
          runSessionId,
          sessionId: runSessionId,
          dispatchId,
          manualRecovery: manualRecovery || meta?.manualRecovery || null,
          strategyId: inline.strategyId || null,
          selectorUsed: inline.selectorUsed || null
        }
      }, { tab: { id: tabId } });
      return emitDecisionTrace({
        ok: true,
        status: 'success',
        text: inline.text,
        html: inline.html || '',
        source: 'inline_executeScript',
        reason: state.reason,
        candidates: inline.candidates || 0,
        candidateCount: inline.candidateCount || inline.candidates || 0,
        visible: !!inline.visible,
        strategyId: inline.strategyId || null,
        strategyIndex: Number.isFinite(Number(inline.strategyIndex)) ? Number(inline.strategyIndex) : null,
        selectorUsed: inline.selectorUsed || null,
        selectorDescriptor: inline.selectorDescriptor || inline.selectorUsed || null,
        textHash: inline.textHash || simpleLateAnswerHash(inline.text)
      }, { state: state.state, stateReason: state.reason, cachedLength: cached?.length || 0 });
    }

    if (cached?.text) {
      return emitDecisionTrace({
        ok: true,
        status: 'partial_from_snapshot',
        text: cached.text,
        html: cached.html || '',
        source: 'snapshot_cache',
        reason: inline?.error || 'inline_extract_missed'
      }, { state: state.state, stateReason: state.reason, cachedLength: cached?.length || 0 });
    }

    return emitDecisionTrace({
      ok: false,
      status: 'late_collect_failed',
      text: '',
      source: 'none',
      reason: inline?.error || 'no_answer_extracted',
      candidates: inline?.candidates || 0,
      candidateCount: inline?.candidateCount || inline?.candidates || 0
    }, { state: state.state, stateReason: state.reason, cachedLength: cached?.length || 0 });
  })().finally(() => {
    const current = lateAnswerCollectInFlight.get(flightKey);
    if (current?.promise === promise) {
      const age = Date.now() - Number(current.startedAt || 0);
      if (age >= LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS) {
        lateAnswerCollectInFlight.delete(flightKey);
      } else {
        const timer = registerSessionTimer(setTimeout(() => {
          deregisterSessionTimer(timer);
          if (lateAnswerCollectInFlight.get(flightKey)?.promise === promise) {
            lateAnswerCollectInFlight.delete(flightKey);
          }
        }, LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS - age));
      }
    }
  });
  lateAnswerCollectInFlight.set(flightKey, { promise, startedAt: Date.now() });
  return promise;
}

function acceptLateCollectResult(llmName, result, meta = {}) {
  if (!llmName || !result?.ok || !result.text) return false;
  const entry = jobState?.llms?.[llmName] || null;
  const incomingText = String(result.text || '').trim();
  const incomingHtml = String(result.html || '');
  const currentText = String(entry?.answer || entry?.pendingFinalAnswer || '').trim();
  const terminalEntry = Boolean(entry && isFinalizedEntry(entry));
  const incomingResponseMeta = meta?.responseMeta && typeof meta.responseMeta === 'object' ? meta.responseMeta : {};
  const resultStatus = String(result.status || '').toLowerCase();
  const isSnapshotPartial = resultStatus === 'partial_from_snapshot';
  const sourceHint = String(incomingResponseMeta.source || meta?.source || result.source || '').toLowerCase();
  const snapshotLikeSource = isSnapshotPartial
    || sourceHint.includes('snapshot')
    || sourceHint.includes('inline_executescript')
    || sourceHint.includes('inline_execute_script')
    || sourceHint.includes('dom_snapshot');
  const currentDispatchConfirmed = Boolean(entry?.promptSubmittedAt || entry?.submitSource === 'content' || entry?.submitSource === 'inferred_answer_evidence');
  if (entry && !terminalEntry && snapshotLikeSource && !currentDispatchConfirmed) {
    emitTelemetry(llmName, 'LATE_COLLECT_STALE_ANSWER_REJECTED', {
      level: 'warning',
      details: `source=${sourceHint || result.source || 'unknown'} len=${incomingText.length}`,
      meta: {
        dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: sourceHint || result.source || null,
        status: result.status || null,
        answerLength: incomingText.length,
        promptSubmittedAt: entry?.promptSubmittedAt || null,
        submitSource: entry?.submitSource || null,
        reason: 'unconfirmed_dispatch_snapshot_like_answer'
      },
      force: true
    });
    appendLogEntry(llmName, {
      type: 'RECOVERY',
      label: 'Late collect stale answer rejected',
      details: 'unconfirmed_dispatch_snapshot_like_answer',
      level: 'warning',
      meta: {
        source: sourceHint || result.source || null,
        status: result.status || null,
        answerLength: incomingText.length,
        dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null
      }
    });
    return false;
  }
  const improvesTerminalAnswer = Boolean(
    terminalEntry
    && incomingText.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && incomingText.length > currentText.length + 24
    && !isPromptEchoAnswerCandidate(incomingText, jobState?.prompt || '')
  );
  const manualRecovery = Boolean(meta?.manualRecovery || incomingResponseMeta.manualRecovery || incomingResponseMeta.manualOverride);
  const preTerminalMaterialize = Boolean(
    meta?.preTerminalMaterialize
    || meta?.preTerminalMaterializeFinal
    || incomingResponseMeta.preTerminalMaterialize
    || incomingResponseMeta.preTerminalMaterializeFinal
  );
  const userCollectLate = sourceHint === 'collect_responses_staged_late_collect'
    || sourceHint === 'manual_ping_late_collect';
  const forceTerminalSuccess = Boolean(
    !isSnapshotPartial
    && (
      incomingResponseMeta.forceTerminalSuccess
      || incomingResponseMeta.lateCollectFinal
      || manualRecovery
      || preTerminalMaterialize
      || userCollectLate
    )
  );
  if (entry && improvesTerminalAnswer) {
    entry.answer = incomingText;
    entry.answerHtml = incomingHtml || entry.answerHtml || '';
    entry.pendingFinalAnswer = incomingText;
    entry.pendingFinalAnswerHtml = incomingHtml || entry.pendingFinalAnswerHtml || '';
    entry.responseMeta = {
      ...(entry.responseMeta || {}),
      ...(incomingResponseMeta || {}),
      source: incomingResponseMeta.source || meta?.source || result.source || 'late_collect',
      answerSource: incomingResponseMeta.answerSource || result.source || null,
      completionReason: incomingResponseMeta.completionReason || 'manual_improved_terminal_answer',
      improvedAfterTerminal: true,
      previousAnswerLength: currentText.length,
      improvedAnswerLength: incomingText.length
    };
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal answer improved after late collect',
      details: `${currentText.length} -> ${incomingText.length}`,
      level: 'success',
      meta: {
        source: incomingResponseMeta.source || meta?.source || result.source || 'late_collect',
        previousAnswerLength: currentText.length,
        improvedAnswerLength: incomingText.length,
        status: entry.finalStatus || entry.status || null
      }
    });
    sendMessageToResultsTab({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName,
      answer: incomingText,
      answerHtml: entry.answerHtml || '',
      requestId: entry.requestId || null,
      metadata: {
        status: entry.finalStatus || entry.status || 'SUCCESS',
        reason: 'improved_after_terminal',
        completionReason: 'manual_improved_terminal_answer',
        improvedAfterTerminal: true,
        previousAnswerLength: currentText.length,
        improvedAnswerLength: incomingText.length
      },
      logs: getLogSnapshot(llmName)
    });
  }
  handleLLMResponse(
    llmName,
    incomingText,
    null,
    {
      ...(meta || {}),
      sessionId: meta?.sessionId || getCurrentRunSessionId(),
      runSessionId: meta?.runSessionId || meta?.sessionId || getCurrentRunSessionId(),
      dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
      responseMeta: {
        ...(incomingResponseMeta || {}),
        source: incomingResponseMeta.source || meta?.source || result.source || 'late_collect',
        answerSource: incomingResponseMeta.answerSource || result.source || null,
        extractionSource: incomingResponseMeta.extractionSource || result.source || null,
        completionReason: incomingResponseMeta.completionReason
          || (isSnapshotPartial ? 'soft_timeout' : (userCollectLate ? 'user_collect_late_collect' : 'late_collect')),
        sanityConfidence: typeof incomingResponseMeta.sanityConfidence === 'number'
          ? incomingResponseMeta.sanityConfidence
          : (isSnapshotPartial ? 0.72 : 0.84),
        partial: Boolean(incomingResponseMeta.partial || isSnapshotPartial),
        lateCollectFinal: Boolean(incomingResponseMeta.lateCollectFinal || forceTerminalSuccess),
        forceTerminalSuccess,
        manualRecovery,
        manualOverride: Boolean(incomingResponseMeta.manualOverride || manualRecovery),
        preTerminalMaterialize,
        strategyId: result.strategyId || incomingResponseMeta.strategyId || meta?.manualRecovery?.strategyId || null,
        strategyIndex: Number.isFinite(Number(result.strategyIndex))
          ? Number(result.strategyIndex)
          : (incomingResponseMeta.strategyIndex ?? meta?.manualRecovery?.strategyIndex ?? null),
        selectorUsed: result.selectorUsed || incomingResponseMeta.selectorUsed || null,
        selectorDescriptor: result.selectorDescriptor || result.selectorUsed || incomingResponseMeta.selectorDescriptor || null,
        candidateCount: Number(result.candidateCount || result.candidates || 0),
        textHash: result.textHash || simpleLateAnswerHash(result.text)
      }
    },
    incomingHtml
  );
  return true;
}

function buildEvidenceDedupeKey({ llmName, dispatchId, sourceRunId, hash, source } = {}) {
  return [
    llmName || 'unknown',
    dispatchId || 'no_dispatch',
    sourceRunId || 'no_run',
    source || 'unknown',
    hash || 'no_hash'
  ].join('::');
}

function buildRecoveryBudgetKey({ dispatchId, reason, scope } = {}) {
  return [
    dispatchId || 'no_dispatch',
    scope || 'recovery',
    String(reason || 'unknown').replace(/\s+/g, '_').slice(0, 120)
  ].join('::');
}

function ensureRecoveryBudget(entry, key, limits = RECOVERY_BUDGET_DEFAULT) {
  if (!entry || !key) return null;
  if (!entry.recoveryBudgets || typeof entry.recoveryBudgets !== 'object') {
    entry.recoveryBudgets = {};
  }
  if (!entry.recoveryBudgets[key]) {
    entry.recoveryBudgets[key] = {
      key,
      startedAt: Date.now(),
      snapshotAttempts: 0,
      inlineDomAttempts: 0,
      manualPingAttempts: 0,
      controlledVisitAttempts: 0,
      maxTotalMs: Number(limits.maxTotalMs || RECOVERY_BUDGET_DEFAULT.maxTotalMs)
    };
  }
  return entry.recoveryBudgets[key];
}

function consumeRecoveryBudget(llmName, entry, key, kind, meta = {}) {
  const limits = meta.limits || RECOVERY_BUDGET_DEFAULT;
  const budget = ensureRecoveryBudget(entry, key, limits);
  if (!budget) return { ok: false, reason: 'budget_unavailable' };
  const now = Date.now();
  const elapsedMs = Math.max(0, now - Number(budget.startedAt || now));
  const maxTotalMs = Number(budget.maxTotalMs || limits.maxTotalMs || RECOVERY_BUDGET_DEFAULT.maxTotalMs);
  if (elapsedMs > maxTotalMs) {
    emitTelemetry(llmName, 'RECOVERY_BUDGET_EXHAUSTED', {
      level: 'warning',
      details: `maxTotalMs:${kind}`,
      meta: { key, kind, elapsedMs, maxTotalMs, ...(meta.telemetry || {}) },
      force: true
    });
    return { ok: false, reason: 'recovery_budget_max_total_ms', budget };
  }
  const field = `${kind}Attempts`;
  const limit = Number(limits[field] ?? RECOVERY_BUDGET_DEFAULT[field] ?? 0);
  const current = Number(budget[field] || 0);
  if (limit >= 0 && current >= limit) {
    emitTelemetry(llmName, 'RECOVERY_BUDGET_EXHAUSTED', {
      level: 'warning',
      details: `${field}:${current}/${limit}`,
      meta: { key, kind, field, current, limit, elapsedMs, ...(meta.telemetry || {}) },
      force: true
    });
    return { ok: false, reason: `recovery_budget_${field}`, budget };
  }
  budget[field] = current + 1;
  budget.lastAttemptAt = now;
  budget.lastKind = kind;
  emitTelemetry(llmName, 'RECOVERY_BUDGET_CONSUMED', {
    level: 'info',
    details: `${field}:${budget[field]}/${limit}`,
    meta: { key, kind, field, count: budget[field], limit, elapsedMs, ...(meta.telemetry || {}) }
  });
  return { ok: true, budget };
}

function validateMaterializedAnswerEvidence(llmName, text = '', meta = {}) {
  const value = String(text || '').trim();
  const source = meta?.source || 'unknown';
  if (!value) {
    return { valid: false, rejectReason: 'empty', source, length: 0, hash: null, answerHash: null };
  }
  const hash = hashEvidenceText(value);
  if (value.length < DOM_SNAPSHOT_RECOVERY_MIN_CHARS) {
    return { valid: false, rejectReason: 'too_short', source, length: value.length, hash, answerHash: hash };
  }
  if (/^error\s*:/i.test(value)) {
    return { valid: false, rejectReason: 'status_error_text', source, length: value.length, hash, answerHash: hash };
  }
  if (isPromptEchoAnswerCandidate(value, jobState?.prompt || '')) {
    return { valid: false, rejectReason: 'prompt_echo', source, length: value.length, hash, answerHash: hash };
  }
  return {
    valid: true,
    rejectReason: null,
    source,
    length: value.length,
    hash,
    answerHash: hash
  };
}

function buildMaterializedEvidenceSummary(llmName, candidate = {}, validation = {}) {
  const text = String(candidate.text || '').trim();
  const source = candidate.source || validation.source || 'unknown';
  const hash = validation.hash || validation.answerHash || (text ? hashEvidenceText(text) : null);
  const sourceRunId = candidate.sourceRunId || candidate.runSessionId || candidate.sessionId || getActiveSessionId() || null;
  const dispatchId = candidate.dispatchId || null;
  const dedupeKey = candidate.dedupeKey || buildEvidenceDedupeKey({
    llmName,
    dispatchId,
    sourceRunId,
    hash,
    source
  });
  return {
    llmName,
    source,
    text,
    html: String(candidate.html || ''),
    length: text.length,
    hash,
    answerHash: hash,
    dedupeKey,
    dispatchId,
    sourceRunId,
    extractedAt: Date.now(),
    valid: !!validation.valid,
    rejectReason: validation.rejectReason || null,
    status: candidate.status || null,
    candidates: Number(candidate.candidates || candidate.candidateCount || 0),
    selectorUsed: candidate.selectorUsed || null
  };
}

async function materializeLatestAnswerEvidence(llmName, entry, context = {}) {
  const tabId = context.tabId || resolveBoundTabIdForOrchestrator(llmName, entry);
  const sessionId = context.sessionId || context.runSessionId || getActiveSessionId();
  const dispatchId = context.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const reason = context.reason || 'terminal_failure';
  const recoveryBudgetKey = context.recoveryBudgetKey || buildRecoveryBudgetKey({
    dispatchId,
    reason,
    scope: 'materialize_latest'
  });
  const emitEvidence = (label, summary, level = null) => {
    emitTelemetry(llmName, label, {
      level: level || (summary?.valid ? 'success' : 'warning'),
      details: `${summary?.source || 'none'} len=${Number(summary?.length || 0)}${summary?.rejectReason ? ` reject=${summary.rejectReason}` : ''}`,
      meta: {
        reason,
        tabId: isValidTabId(tabId) ? tabId : null,
        dispatchId,
        evidenceSource: summary?.source || null,
        evidenceLen: Number(summary?.length || 0),
        evidenceHash: summary?.hash || null,
        answerHash: summary?.answerHash || summary?.hash || null,
        dedupeKey: summary?.dedupeKey || null,
        sourceRunId: summary?.sourceRunId || null,
        rejectReason: summary?.rejectReason || null,
        status: summary?.status || null,
        candidates: Number(summary?.candidates || 0),
        selectorUsed: summary?.selectorUsed || null
      },
      force: true
    });
  };
  const consider = (candidate = {}) => {
    const validation = validateMaterializedAnswerEvidence(llmName, candidate.text || '', {
      source: candidate.source || 'unknown'
    });
    const summary = buildMaterializedEvidenceSummary(llmName, {
      dispatchId,
      sourceRunId: sessionId,
      ...(candidate || {})
    }, validation);
    emitEvidence(validation.valid ? 'MATERIALIZE_EVIDENCE_ACCEPTED' : 'MATERIALIZE_EVIDENCE_REJECTED', summary);
    return summary;
  };

  const preservedCandidates = [
    { source: 'preserved_pending', text: entry?.pendingFinalAnswer, html: entry?.pendingFinalAnswerHtml, dispatchId, sourceRunId: sessionId },
    { source: 'preserved_answer', text: entry?.answer, html: entry?.answerHtml, dispatchId, sourceRunId: sessionId }
  ].filter((candidate) => String(candidate.text || '').trim());
  for (const candidate of preservedCandidates) {
    const summary = consider(candidate);
    if (summary.valid) return { ok: true, summary, result: { ok: true, text: summary.text, html: summary.html, source: summary.source, status: 'preserved' } };
  }

  if (isValidTabId(tabId)) {
    const cached = await readAnswerSnapshotCache({ llmName, runSessionId: sessionId, dispatchId, tabId });
    if (cached?.text) {
      const summary = consider({
        source: 'snapshot_cache',
        text: cached.text,
        html: cached.html || '',
        status: 'partial_from_snapshot',
        dispatchId,
        sourceRunId: sessionId
      });
      if (summary.valid) return { ok: true, summary, result: { ok: true, text: summary.text, html: summary.html, source: summary.source, status: 'partial_from_snapshot' } };
    }

    const collectOnce = async (collectReason) => lateCollectAnswer({
      llmName,
      tabId,
      reason: collectReason,
      meta: {
        ...(context.meta || {}),
        preTerminalMaterialize: true,
        materializeLatestEvidence: true,
        source: collectReason,
        runSessionId: sessionId,
        sessionId,
        dispatchId,
        forceEmitOnUnchanged: true
      },
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    });
    const firstBudget = consumeRecoveryBudget(llmName, entry, recoveryBudgetKey, 'inlineDom', {
      telemetry: { reason, tabId, dispatchId, collectReason: `materialize_latest:${reason}` }
    });
    if (!firstBudget.ok) {
      const budgetSummary = buildMaterializedEvidenceSummary(llmName, {
        source: 'none',
        text: '',
        status: 'recovery_budget_exhausted',
        dispatchId,
        sourceRunId: sessionId
      }, { valid: false, rejectReason: firstBudget.reason, source: 'none' });
      emitEvidence('MATERIALIZE_EVIDENCE_MISS', budgetSummary, 'warning');
      return { ok: false, summary: budgetSummary, reason: firstBudget.reason };
    }
    let result = await collectOnce(`materialize_latest:${reason}`);
    if ((!result?.ok || !result.text) && MATERIALIZE_LATEST_RETRY_MODELS.has(llmName)) {
      const retryBudget = consumeRecoveryBudget(llmName, entry, recoveryBudgetKey, 'inlineDom', {
        telemetry: { reason, tabId, dispatchId, collectReason: `materialize_latest_retry:${reason}` }
      });
      if (!retryBudget.ok) {
        const budgetSummary = buildMaterializedEvidenceSummary(llmName, {
          source: 'none',
          text: '',
          status: 'recovery_budget_exhausted',
          dispatchId,
          sourceRunId: sessionId
        }, { valid: false, rejectReason: retryBudget.reason, source: 'none' });
        emitEvidence('MATERIALIZE_EVIDENCE_MISS', budgetSummary, 'warning');
        return { ok: false, summary: budgetSummary, result, reason: retryBudget.reason };
      }
      emitTelemetry(llmName, 'MATERIALIZE_EVIDENCE_RETRY_WAIT', {
        level: 'warning',
        details: `${MATERIALIZE_LATEST_RETRY_WAIT_MS}ms`,
        meta: { reason, tabId, dispatchId, firstStatus: result?.status || null, firstReason: result?.reason || null },
        force: true
      });
      await orchestratorSleepMs(MATERIALIZE_LATEST_RETRY_WAIT_MS);
      result = await collectOnce(`materialize_latest_retry:${reason}`);
    }
    if (result?.ok && result.text) {
      const summary = consider({
        source: result.source || 'late_collect',
        text: result.text,
        html: result.html || '',
        status: result.status || null,
        candidates: result.candidates || result.candidateCount || 0,
        selectorUsed: result.selectorUsed || null,
        dispatchId,
        sourceRunId: sessionId
      });
      if (summary.valid) return { ok: true, summary, result };
      return { ok: false, summary, result, reason: summary.rejectReason || 'invalid_evidence' };
    }
    const missSummary = buildMaterializedEvidenceSummary(llmName, {
      source: result?.source || 'none',
      text: '',
      status: result?.status || null,
      candidates: result?.candidates || result?.candidateCount || 0,
      dispatchId,
      sourceRunId: sessionId
    }, { valid: false, rejectReason: result?.reason || result?.status || 'no_answer_extracted', source: result?.source || 'none' });
    emitEvidence('MATERIALIZE_EVIDENCE_MISS', missSummary, 'warning');
    return { ok: false, summary: missSummary, result, reason: missSummary.rejectReason };
  }

  const missingTabSummary = buildMaterializedEvidenceSummary(llmName, {
    source: 'none',
    text: '',
    dispatchId,
    sourceRunId: sessionId
  }, { valid: false, rejectReason: 'tab_not_collectable', source: 'none' });
  emitEvidence('MATERIALIZE_EVIDENCE_MISS', missingTabSummary, 'warning');
  return { ok: false, summary: missingTabSummary, reason: 'tab_not_collectable' };
}

function hasFullSnapshotCompletionEvidence(entry, textLength, completionReason, responseSource) {
  const length = Number(textLength || 0);
  if (!entry || length < 500) return false;
  const source = String(responseSource || '').toLowerCase();
  if (source !== 'snapshot_cache') return false;
  const readyAt = Number(entry.lifecycleReadyAt || entry.answerCompleteDetectedAt || 0);
  const completeLength = Number(entry.answerCompleteTextLength || entry.lifecycleReadyMeta?.textLength || 0) || 0;
  if (readyAt > 0 && (!completeLength || length >= Math.floor(completeLength * 0.95))) {
    return true;
  }
  return String(completionReason || '').toLowerCase() === 'generation_inactive' && length >= 1000;
}

async function recoverAnswerViaDomSnapshot(llmName, tabId, reason = 'dom_snapshot_recovery', meta = {}) {
  if (!DOM_SNAPSHOT_RECOVERY_MODELS.has(llmName)) return false;
  if (!isValidTabId(tabId)) return false;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const dispatchId = meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const recoveryBudgetKey = meta?.recoveryBudgetKey || buildRecoveryBudgetKey({
    dispatchId,
    reason,
    scope: 'dom_snapshot'
  });
  const budget = consumeRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', {
    telemetry: { reason, tabId, dispatchId }
  });
  if (!budget.ok) {
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery skipped (budget)',
      details: budget.reason,
      level: 'warning',
      meta: { reason, tabId, dispatchId }
    });
    return false;
  }
  const now = Date.now();
  if (entry.domSnapshotRecoveryInFlight) return false;
  if (Number(entry.domSnapshotRecoveryAt || 0) && (now - Number(entry.domSnapshotRecoveryAt || 0)) < DOM_SNAPSHOT_RECOVERY_COOLDOWN_MS) {
    return false;
  }
  entry.domSnapshotRecoveryInFlight = true;
  entry.domSnapshotRecoveryAt = now;
  try {
    const snapshot = await lateCollectAnswer({
      llmName,
      tabId,
      reason,
      meta,
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    });
    if (!snapshot?.ok || !snapshot.text) {
      broadcastDiagnostic(llmName, {
        type: 'RECOVERY',
        label: 'DOM snapshot recovery missed',
        details: `reason=${reason} status=${snapshot?.status || 'missed'} candidates=${snapshot?.candidates || 0}`,
        level: snapshot?.status === 'dead_tab_no_snapshot' ? 'error' : 'warning'
      });
      return false;
    }
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery accepted',
      details: `len=${String(snapshot.text || '').length} reason=${reason} source=${snapshot.source || 'late_collect'}`,
      level: 'success',
      meta: {
        reason,
        tabId,
        candidates: snapshot.candidates || 0,
        visible: !!snapshot.visible,
        source: snapshot.source || null,
        status: snapshot.status || null
      }
    });
    handleLLMResponse(
      llmName,
      snapshot.text,
      null,
      {
        ...(meta || {}),
        sessionId: Number(jobState?.session?.startTime || 0) || null,
        runSessionId: Number(jobState?.session?.startTime || 0) || null,
        dispatchId: entry?.lastDispatchMeta?.dispatchId || meta?.dispatchId || null,
        responseMeta: {
          source: snapshot.source || 'dom_snapshot_recovery',
          completionReason: snapshot.status === 'partial_from_snapshot' ? 'soft_timeout' : 'dom_snapshot_recovery',
          sanityConfidence: snapshot.status === 'partial_from_snapshot' ? 0.72 : 0.84,
          partial: snapshot.status === 'partial_from_snapshot'
        }
      },
      snapshot.html || ''
    );
    return true;
  } catch (err) {
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery failed',
      details: err?.message || String(err),
      level: 'warning',
      meta: { reason, tabId }
    });
    return false;
  } finally {
    const liveEntry = jobState?.llms?.[llmName];
    if (liveEntry) liveEntry.domSnapshotRecoveryInFlight = false;
  }
}


function shouldMaterializeBeforeTerminal(llmName, finalStatus, finalReason, error, metaObj = {}) {
  if (!PRE_TERMINAL_MATERIALIZE_MODELS.has(llmName)) return false;
  if (metaObj?.preTerminalMaterializeFinal || metaObj?.manualRecovery || metaObj?.responseMeta?.manualRecovery) return false;
  const status = String(finalStatus || '').toUpperCase();
  if (Array.isArray(FAILURE_STATUSES) && FAILURE_STATUSES.includes(status)) return true;
  if (!PRE_TERMINAL_MATERIALIZE_STATUSES.has(status)) return false;
  const errorType = String(error?.type || '').toLowerCase();
  const reason = String(finalReason || error?.message || '').toLowerCase();
  if (status === 'NO_SEND') return errorType === 'send_failed' || errorType === 'no_send' || reason.includes('send');
  if (status === 'EXTRACT_FAILED') return errorType === 'extract_failed' || reason.includes('extract') || reason.includes('round4');
  if (status === 'ERROR') return errorType === 'script_runtime_hard_stop' || reason.includes('hard_stop');
  return false;
}

async function runPreTerminalMaterializeRecovery(llmName, tabId, sessionId, reason, meta = {}) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!entry || isFinalizedEntry(entry) || !isValidTabId(tabId)) {
    return { ok: false, reason: 'not_collectable' };
  }
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_START', {
    level: 'warning',
    details: reason,
    meta: {
      tabId,
      reason,
      dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null
    },
    force: true
  });
  try {
    const beforeVisit = jobState?.llms?.[llmName] || entry;
    const visitStartedAt = Date.now();
    const tabBefore = await getTabSafe(tabId);
    const focusSwitchesBefore = Number(beforeVisit?.focusSwitches || 0);
    const humanVisitBefore = Number(beforeVisit?.humanVisitTotalMs || 0);
    const dispatchId = meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
    const recoveryBudgetKey = meta?.recoveryBudgetKey || buildRecoveryBudgetKey({
      dispatchId,
      reason,
      scope: 'pre_terminal_materialize'
    });
    const visitBudget = consumeRecoveryBudget(llmName, beforeVisit, recoveryBudgetKey, 'controlledVisit', {
      telemetry: { reason, tabId, dispatchId }
    });
    let didVisit = false;
    if (visitBudget.ok) {
      didVisit = await runForcedAutomationVisits(llmName, tabId, sessionId, {
        visits: 1,
        minMs: PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS,
        maxMs: PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS,
        maxScrollDurationMs: PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS,
        reason: `materialize_recovery:${reason}`
      });
    }
    if (!didVisit && (!sessionId || isSessionActive(sessionId))) {
      emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_VISIT_FALLBACK', {
        level: 'warning',
        details: visitBudget.ok ? `direct_focus_after_visit_miss:${reason}` : `visit_budget_exhausted:${visitBudget.reason}`,
        meta: { tabId, reason, dispatchId, budgetReason: visitBudget.ok ? null : visitBudget.reason },
        force: true
      });
      if (visitBudget.ok) {
        const fallbackVisit = await focusTabForVerification(llmName, tabId, 2600, sessionId);
        await runPreCollectScrollNudge(llmName, tabId, sessionId, `materialize_recovery_fallback:${reason}`);
        didVisit = fallbackVisit === true || (fallbackVisit && typeof fallbackVisit === 'object' && fallbackVisit.usefulVisit !== false);
        if (!didVisit) {
          emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_VISIT_FALLBACK_SHORT', {
            level: 'warning',
            details: `duration=${fallbackVisit?.durationMs || 0}ms reason=${reason}`,
            meta: {
              tabId,
              reason,
              dispatchId,
              visit: fallbackVisit && typeof fallbackVisit === 'object' ? fallbackVisit : null
            },
            force: true
          });
        }
      }
    }
    const tabAfter = await getTabSafe(tabId);
    const afterVisitState = jobState?.llms?.[llmName] || null;
    emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_VISIT_RESULT', {
      level: didVisit ? 'success' : 'warning',
      details: `didVisit=${!!didVisit} reason=${reason}`,
      meta: {
        tabId,
        reason,
        didVisit: !!didVisit,
        configuredMinMs: PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS,
        configuredMaxMs: PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS,
        configuredMaxScrollDurationMs: PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS,
        elapsedMs: Math.max(0, Date.now() - visitStartedAt),
        focusSwitchDelta: Math.max(0, Number(afterVisitState?.focusSwitches || 0) - focusSwitchesBefore),
        humanVisitDeltaMs: Math.max(0, Number(afterVisitState?.humanVisitTotalMs || 0) - humanVisitBefore),
        tabActiveBefore: !!tabBefore?.active,
        tabActiveAfter: !!tabAfter?.active,
        tabDiscardedBefore: tabBefore?.discarded === true,
        tabDiscardedAfter: tabAfter?.discarded === true,
        tabStillAlive: !!tabAfter,
        dispatchId,
        budgetReason: visitBudget.ok ? null : visitBudget.reason
      },
      force: true
    });
    await orchestratorSleepMs(PRE_TERMINAL_MATERIALIZE_SETTLE_MS);
    const afterVisit = jobState?.llms?.[llmName] || null;
    if (!afterVisit || isFinalizedEntry(afterVisit)) {
      return { ok: false, reason: 'finalized_during_materialize' };
    }
    const evidence = await materializeLatestAnswerEvidence(llmName, afterVisit, {
      tabId,
      sessionId,
      runSessionId: sessionId,
      dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
      reason: `materialize_recovery:${reason}`,
      recoveryBudgetKey,
      meta: {
        ...(meta || {}),
        recoveryBudgetKey
      }
    });
    const result = evidence?.result || null;
    if (evidence?.ok && result?.text) {
      const accepted = acceptLateCollectResult(llmName, result, {
        ...(meta || {}),
        preTerminalMaterialize: true,
        materializeLatestEvidence: true,
        responseMeta: {
          source: result.source || 'materialize_recovery',
          completionReason: result.status === 'partial_from_snapshot' ? 'soft_timeout' : 'materialize_recovery',
          sanityConfidence: result.status === 'partial_from_snapshot' ? 0.72 : 0.86,
          partial: result.status === 'partial_from_snapshot',
          recovered: true,
          recoverySource: result.source || evidence.summary?.source || 'materialize_recovery',
          evidenceSource: evidence.summary?.source || result.source || null,
          evidenceHash: evidence.summary?.hash || hashEvidenceText(result.text),
          evidenceLength: evidence.summary?.length || String(result.text || '').length
        }
      });
      emitTelemetry(llmName, accepted ? 'MATERIALIZE_RECOVERY_SUCCESS' : 'MATERIALIZE_RECOVERY_REJECTED', {
        level: accepted ? 'success' : 'warning',
        details: `len=${String(result.text || '').length} source=${result.source || 'unknown'}`,
        meta: {
          tabId,
          reason,
          status: result.status || null,
          source: result.source || null,
          candidates: result.candidates || result.candidateCount || 0,
          dispatchId: meta?.dispatchId || null
        },
        force: true
      });
      return { ok: accepted, reason: accepted ? 'accepted' : 'not_accepted', result };
    }
    emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_MISS', {
      level: 'warning',
      details: evidence?.reason || result?.reason || result?.status || 'no_answer',
      meta: {
        tabId,
        reason,
        status: result?.status || null,
        candidates: result?.candidates || result?.candidateCount || 0,
        source: result?.source || null,
        evidenceSource: evidence?.summary?.source || null,
        evidenceLen: Number(evidence?.summary?.length || 0),
        evidenceHash: evidence?.summary?.hash || null,
        rejectReason: evidence?.summary?.rejectReason || null,
        dispatchId: meta?.dispatchId || null
      },
      force: true
    });
    return { ok: false, reason: evidence?.reason || result?.reason || result?.status || 'missed', result, evidence: evidence?.summary || null };
  } catch (err) {
    emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_ERROR', {
      level: 'warning',
      details: err?.message || String(err),
      meta: { tabId, reason, dispatchId: meta?.dispatchId || null },
      force: true
    });
    return { ok: false, reason: err?.message || String(err) };
  }
}

function maybeDeferTerminalFailureForMaterialization(llmName, entry, finalStatus, finalReason, error, metaObj, normalizedAnswer, normalizedHtml) {
  if (!entry || entry.finalStatusRecorded) return false;
  if (!shouldMaterializeBeforeTerminal(llmName, finalStatus, finalReason, error, metaObj)) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  const now = Date.now();
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const reason = String(finalReason || error?.type || finalStatus || 'terminal').toLowerCase();
  const key = `${dispatchId || 'no_dispatch'}:${finalStatus}:${reason}`;
  const existing = entry.preTerminalMaterializeRecovery || null;
  if (existing?.inFlight && existing.key === key) return true;
  if (existing?.key === key && Number(existing.attemptedAt || 0) && (now - Number(existing.attemptedAt || 0)) < PRE_TERMINAL_MATERIALIZE_COOLDOWN_MS) {
    return false;
  }
  entry.preTerminalMaterializeRecovery = {
    key,
    inFlight: true,
    attemptedAt: now,
    status: finalStatus,
    reason,
    dispatchId
  };
  updateModelState(llmName, 'RECOVERABLE_ERROR', {
    message: `pre_terminal_materialize_${reason}`,
    originalStatus: finalStatus
  });
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_CONTEXT', {
    level: 'warning',
    details: `${finalStatus}:${reason}`,
    meta: {
      tabId,
      dispatchId,
      finalStatusCandidate: finalStatus,
      finalReasonCandidate: reason,
      errorType: error?.type || null,
      errorMessage: error?.message || null,
      promptSubmittedAt: entry?.promptSubmittedAt || null,
      lifecycleReadyAt: entry?.lifecycleReadyAt || null,
      answerCompleteDetectedAt: entry?.answerCompleteDetectedAt || null,
      answerLengthBefore: String(entry?.answer || '').length,
      pendingFinalAnswerLength: String(entry?.pendingFinalAnswer || '').length,
      snapshotLengthBefore: Number(entry?.lastAnswerSnapshotLength || entry?.answerSnapshotLength || 0),
      pingTransportErrorCount: Number(entry?.pingTransportErrorCount || 0),
      statusBefore: entry?.status || null,
      finalStatusBefore: entry?.finalStatus || null
    },
    force: true
  });
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_DEFER_TERMINAL', {
    level: 'warning',
    details: `${finalStatus}:${reason}`,
    meta: { tabId, dispatchId, finalStatus, finalReason: reason },
    force: true
  });
  const sessionId = metaObj?.runSessionId || metaObj?.sessionId || getActiveSessionId();
  const finalAnswer = normalizedAnswer || `Error: ${error?.message || finalReason || finalStatus}`;
  const finalHtml = normalizedHtml || '';
  const finalError = error ? { ...error } : { type: String(finalReason || finalStatus || 'terminal').toLowerCase() };
  registerSessionTimer(setTimeout(async () => {
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || liveEntry.finalStatusRecorded) return;
    if (String(liveEntry.preTerminalMaterializeRecovery?.key || '') !== key) return;
    const result = await runPreTerminalMaterializeRecovery(llmName, tabId, sessionId, reason, {
      ...(metaObj || {}),
      dispatchId,
      runSessionId: sessionId || undefined,
      sessionId: sessionId || undefined
    });
    const afterRecovery = jobState?.llms?.[llmName];
    if (afterRecovery?.preTerminalMaterializeRecovery?.key === key) {
      afterRecovery.preTerminalMaterializeRecovery.inFlight = false;
      afterRecovery.preTerminalMaterializeRecovery.result = result?.reason || null;
    }
    if (result?.ok) return;
    const afterMiss = jobState?.llms?.[llmName];
    if (!afterMiss || afterMiss.finalStatusRecorded) return;
    emitTelemetry(llmName, 'FINAL_ERROR_AFTER_RECOVERY', {
      level: 'error',
      details: `${finalStatus}:${reason}:${result?.reason || 'missed'}`,
      meta: {
        tabId,
        dispatchId,
        originalStatus: finalStatus,
        originalReason: reason,
        errorType: finalError?.type || null,
        recoveryReason: result?.reason || null,
        recoveryStatus: result?.result?.status || result?.status || null,
        recoverySource: result?.result?.source || result?.source || null,
        candidates: Number(result?.result?.candidates || result?.result?.candidateCount || 0),
        textLengthRecovered: String(result?.result?.text || '').length,
        recoveryOk: !!result?.ok,
        preTerminalMaterializeFinal: true
      },
      force: true
    });
    handleLLMResponse(
      llmName,
      finalAnswer,
      finalError,
      {
        ...(metaObj || {}),
        dispatchId,
        runSessionId: sessionId || undefined,
        sessionId: sessionId || undefined,
        preTerminalMaterializeFinal: true,
        preTerminalMaterializeResult: result?.reason || 'missed'
      },
      finalHtml
    );
  }, 0));
  saveJobState(jobState);
  broadcastGlobalState();
  return true;
}

function detectActiveGenerationInPage(modelName) {
  const commonStopSelectors = [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Останов" i]',
    'button[aria-label*="Detener" i]',
    'button[aria-label*="Arrêter" i]',
    'button[aria-label*="停止" i]',
    'button[data-testid="stop-button"]',
    'button[data-testid*="stop" i]',
    'button[aria-label*="Stop generation" i]',
    'button[class*="stop" i]',
    '[role="button"][aria-label*="Stop" i]',
    '[role="button"][aria-label*="停止" i]'
  ];
  const commonBusySelectors = [
    '[aria-busy="true"]',
    '[data-is-streaming="true"]',
    '[data-streaming="true"]',
    '[data-generating="true"]',
    '[data-loading="true"]',
    '[class*="streaming" i]',
    '[class*="typing" i]',
    '[class*="loading" i]',
    '[class*="generating" i]',
    '[class*="response-loading" i]',
    '[class*="qwen"][class*="loading" i]',
    '[role="progressbar"]'
  ];
  const stopTextPattern = /\b(stop|stop generating|cancel|cancel generation)\b|останов|detener|arrêter|停止|中止/i;
  const isVisible = (node) => {
    if (!node) return false;
    try {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
      return node.getClientRects().length > 0;
    } catch (_) {
      return false;
    }
  };
  const isEnabledButton = (node) => {
    if (!node) return false;
    if (node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.getAttribute?.('data-disabled') === 'true') return false;
    return isVisible(node);
  };
  const hasStopTextButton = () => {
    try {
      const controls = Array.from(document.querySelectorAll('button,[role="button"]')).slice(0, 160);
      return controls.some((node) => {
        if (!isEnabledButton(node)) return false;
        const text = String(node.getAttribute?.('aria-label') || node.getAttribute?.('title') || node.textContent || '').trim();
        return stopTextPattern.test(text);
      });
    } catch (_) {
      return false;
    }
  };
  const stopVisible = commonStopSelectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isEnabledButton);
    } catch (_) {
      return false;
    }
  }) || hasStopTextButton();
  const busyVisible = commonBusySelectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    } catch (_) {
      return false;
    }
  });
  return {
    active: stopVisible || busyVisible,
    stopVisible,
    busyVisible,
    modelName: String(modelName || '')
  };
}

function maybeDeferStreamingFinalization(llmName, answer, metaObj, answerHtml, normalizedAnswer) {
  if (!DEFER_STREAM_FINAL_MODELS.has(llmName)) return false;
  const responseMeta = metaObj?.responseMeta && typeof metaObj.responseMeta === 'object' ? metaObj.responseMeta : {};
  if (
    metaObj?.finalizationDeferredCheck
    || metaObj?.source === 'dom_snapshot_recovery'
    || responseMeta.preTerminalMaterialize
  ) return false;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId) || !chrome?.scripting?.executeScript) return false;
  const startedAt = Number(entry.finalizationDeferStartedAt || Date.now());
  entry.finalizationDeferStartedAt = startedAt;
  entry.pendingFinalAnswer = String(normalizedAnswer || answer || '');
  entry.pendingFinalAnswerHtml = String(answerHtml || '');
  const precheckAnswerEvidence = self.AnswerEvidence?.buildAnswerEvidence?.({
    llmName,
    text: entry.pendingFinalAnswer,
    html: entry.pendingFinalAnswerHtml,
    source: responseMeta?.source || metaObj?.source || null,
    responseMeta,
    dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
    tabId,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS,
    stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
  }) || null;
  const precheckFinalization = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(precheckAnswerEvidence, {
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || { ok: false };
  if (
    precheckFinalization.ok
    && ['timeout_with_text', 'hardstop_with_text', 'snapshot_with_text', 'materialize_with_text', 'panel_with_text'].includes(precheckFinalization.reason)
  ) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Finalization defer bypassed (answer evidence policy)',
      details: `reason=${precheckFinalization.reason} len=${precheckAnswerEvidence.length}`,
      level: 'warning',
      meta: {
        tabId,
        answerEvidence: precheckAnswerEvidence,
        finalizationPolicy: precheckFinalization
      }
    });
    return false;
  }
  chrome.scripting.executeScript({
    target: { tabId },
    func: detectActiveGenerationInPage,
    args: [llmName]
  }).then((results) => {
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const state = Array.isArray(results) ? results.find((item) => item?.result)?.result : null;
    const elapsedMs = Math.max(0, Date.now() - Number(liveEntry.finalizationDeferStartedAt || Date.now()));
    const pendingAnswerLength = String(liveEntry.pendingFinalAnswer || normalizedAnswer || answer || '').trim().length;
    const pendingAnswerEvidence = self.AnswerEvidence?.buildAnswerEvidence?.({
      llmName,
      text: liveEntry.pendingFinalAnswer || normalizedAnswer || answer || '',
      html: liveEntry.pendingFinalAnswerHtml || answerHtml || '',
      source: responseMeta?.source || metaObj?.source || 'deferred_finalization',
      responseMeta,
      dispatchId: metaObj?.dispatchId || liveEntry?.lastDispatchMeta?.dispatchId || null,
      tabId,
      generationActive: !!state?.active,
      stopButtonVisible: !!state?.stopVisible,
      busyIndicatorVisible: !!state?.busyVisible,
      stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS,
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    }) || null;
    const evidenceFinalization = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(pendingAnswerEvidence, {
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    }) || { ok: false };
    const streamingMaxReached = Boolean(state?.active && elapsedMs >= DEFER_STREAM_FINAL_MAX_MS);
    const hasCompletionEvidence = Boolean(
      liveEntry.lifecycleReadyAt
      || liveEntry.answerCompleteDetectedAt
      || liveEntry.lifecycleReadyMeta?.state === 'COMPLETE'
      || String(responseMeta?.completionReason || '').includes('timeout')
      || String(responseMeta?.source || '').includes('snapshot')
    );
    const stableAnswerForceFinal = Boolean(
      state?.active
      && !state?.stopVisible
      && pendingAnswerLength >= DEFER_STREAM_STABLE_FORCE_MIN_CHARS
      && (elapsedMs >= DEFER_STREAM_STABLE_FORCE_MS || hasCompletionEvidence)
    );
    const evidenceCanOverrideStop = ['timeout_with_text', 'hardstop_with_text', 'materialize_with_text'].includes(String(evidenceFinalization.reason || ''));
    const evidenceForceFinal = Boolean(
      evidenceFinalization.ok
      && state?.active
      && (!state?.stopVisible || evidenceCanOverrideStop)
    );
    if (state?.active && !streamingMaxReached && !stableAnswerForceFinal && !evidenceForceFinal) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization deferred (generation active)',
        details: `elapsed=${elapsedMs}ms stop=${!!state.stopVisible} busy=${!!state.busyVisible}`,
        level: 'warning',
        meta: {
          tabId,
          elapsedMs,
          stopVisible: !!state.stopVisible,
          busyVisible: !!state.busyVisible,
          pendingAnswerLength
        }
      });
      updateModelState(llmName, 'RECEIVING', {
        message: 'generation_active',
        completionReason: 'generation_active',
        responseSource: responseMeta?.source || null
      });
      sendMessageToResultsTab({
        type: 'LLM_PARTIAL_RESPONSE',
        llmName,
        answer: String(normalizedAnswer || answer || ''),
        answerHtml: String(answerHtml || ''),
        metadata: { status: 'GENERATING', reason: 'generation_active' },
        logs: getLogSnapshot(llmName)
      });
      registerSessionTimer(setTimeout(() => {
        const recheckEntry = jobState?.llms?.[llmName];
        if (!recheckEntry || isFinalizedEntry(recheckEntry)) return;
        triggerResponseCollectionPing(llmName, tabId, 'finalization_deferred_generation_active', {
          allowRecovery: true,
          maxAttempts: 3,
          baseDelay: 700
        });
      }, DEFER_STREAM_FINAL_RECHECK_MS));
      return;
    }
    if (stableAnswerForceFinal) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization forced (stable answer evidence)',
        details: `len=${pendingAnswerLength} elapsed=${elapsedMs}ms stop=${!!state.stopVisible} busy=${!!state.busyVisible}`,
        level: 'warning',
        meta: {
          tabId,
          elapsedMs,
          pendingAnswerLength,
          stopVisible: !!state.stopVisible,
          busyVisible: !!state.busyVisible,
          hasCompletionEvidence,
          thresholdMs: DEFER_STREAM_STABLE_FORCE_MS,
          thresholdChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
        }
      });
    } else if (evidenceForceFinal) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization forced (answer evidence policy)',
        details: `reason=${evidenceFinalization.reason} len=${pendingAnswerLength} stop=${!!state.stopVisible} busy=${!!state.busyVisible}`,
        level: 'warning',
        meta: {
          tabId,
          elapsedMs,
          pendingAnswerLength,
          answerEvidence: pendingAnswerEvidence,
          finalizationPolicy: evidenceFinalization
        }
      });
    }
    handleLLMResponse(
      llmName,
      liveEntry.pendingFinalAnswer || answer,
      null,
      {
        ...(metaObj || {}),
        finalizationDeferredCheck: true,
        responseMeta: {
          ...(metaObj?.responseMeta || {}),
          source: metaObj?.responseMeta?.source || 'deferred_finalization',
          completionReason: streamingMaxReached ? 'streaming_incomplete' : (evidenceFinalization.ok ? evidenceFinalization.reason : 'generation_inactive'),
          partial: streamingMaxReached || pendingAnswerEvidence?.partialAllowed || undefined,
          answerEvidence: pendingAnswerEvidence || undefined,
          forceTerminalSuccess: streamingMaxReached ? false : metaObj?.responseMeta?.forceTerminalSuccess,
          lateCollectFinal: streamingMaxReached ? false : metaObj?.responseMeta?.lateCollectFinal
        }
      },
      liveEntry.pendingFinalAnswerHtml || answerHtml || ''
    );
  }).catch(() => {
    handleLLMResponse(
      llmName,
      answer,
      null,
      { ...(metaObj || {}), finalizationDeferredCheck: true },
      answerHtml || ''
    );
  });
  return true;
}

function buildEarlyTerminalGuardSignature(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= 512) return value;
  return `${value.slice(0, 256)}::${value.slice(-256)}`;
}

function isEarlyTerminalGuardRisk({ llmName, responseSource, completionReason }) {
  if (!EARLY_TERMINAL_GUARD_MODELS.has(llmName)) return false;
  const source = String(responseSource || '').toLowerCase();
  const reason = String(completionReason || '').toLowerCase();
  if (source === 'dom_snapshot_recovery') return true;
  if (source === 'deferred_finalization' || reason === 'generation_inactive') {
    return true;
  }
  return false;
}

function maybeDeferEarlyTerminalSuccess(llmName, entry, options = {}) {
  if (!entry) return false;
  const {
    trimmedAnswer = '',
    normalizedAnswer = '',
    normalizedHtml = '',
    responseSource = '',
    completionReason = '',
    metaObj = null,
    sendConfirmed = null
  } = options;
  const responseMeta = metaObj?.responseMeta && typeof metaObj.responseMeta === 'object' ? metaObj.responseMeta : {};
  if (
    responseMeta.forceTerminalSuccess
    || responseMeta.lateCollectFinal
    || responseMeta.manualRecovery
    || responseMeta.manualOverride
    || responseMeta.preTerminalMaterialize
    || metaObj?.preTerminalMaterialize
    || metaObj?.preTerminalMaterializeFinal
  ) {
    entry.earlyTerminalGuard = null;
    return false;
  }
  if (!isEarlyTerminalGuardRisk({ llmName, responseSource, completionReason })) return false;
  if (entry.lifecycleReadyAt || entry.lifecycleReadyMeta?.state === 'COMPLETE') {
    entry.earlyTerminalGuard = null;
    return false;
  }

  const now = Date.now();
  const answerLength = String(trimmedAnswer || '').length;
  const signature = buildEarlyTerminalGuardSignature(trimmedAnswer);
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const existing = entry.earlyTerminalGuard && String(entry.earlyTerminalGuard.dispatchId || '') === String(dispatchId || '')
    ? entry.earlyTerminalGuard
    : null;
  const startedAt = Number(existing?.startedAt || now);
  const sameObservation = !!existing
    && existing.signature === signature
    && Number(existing.answerLength || 0) === answerLength
    && (now - Number(existing.lastSeenAt || startedAt)) >= EARLY_TERMINAL_GUARD_STABLE_MS;
  const waitedMs = Math.max(0, now - startedAt);
  const forceLongAnswerAfterMaxWait = Boolean(
    existing
    && answerLength >= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS
    && waitedMs >= EARLY_TERMINAL_GUARD_MAX_WAIT_MS
  );
  const forceAnyAnswerAfterExtendedWait = Boolean(
    existing
    && answerLength >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && waitedMs >= (EARLY_TERMINAL_GUARD_MAX_WAIT_MS * 3)
  );
  const allowTerminalSuccess = (
    sameObservation
    && (answerLength >= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS || waitedMs >= EARLY_TERMINAL_GUARD_MAX_WAIT_MS)
  ) || forceLongAnswerAfterMaxWait || forceAnyAnswerAfterExtendedWait;

  if (allowTerminalSuccess) {
    if (!sameObservation) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Terminal success guard max wait elapsed',
        details: `len=${answerLength} waited=${waitedMs}ms`,
        level: 'warning',
        meta: {
          dispatchId,
          answerLength,
          waitedMs,
          forceLongAnswerAfterMaxWait,
          forceAnyAnswerAfterExtendedWait,
          responseSource,
          completionReason
        }
      });
    }
    entry.earlyTerminalGuard = null;
    return false;
  }

  entry.pendingFinalAnswer = String(normalizedAnswer || trimmedAnswer || '');
  entry.pendingFinalAnswerHtml = String(normalizedHtml || '');
  entry.earlyTerminalGuard = {
    dispatchId,
    startedAt,
    lastSeenAt: now,
    signature,
    answerLength,
    responseSource: String(responseSource || ''),
    completionReason: String(completionReason || '')
  };

  appendLogEntry(llmName, {
    type: 'RESPONSE',
    label: 'Terminal success deferred (await lifecycle)',
    details: `source=${responseSource || 'unknown'} reason=${completionReason || 'unknown'} len=${answerLength} waited=${waitedMs}ms`,
    level: 'warning',
    meta: {
      dispatchId,
      answerLength,
      waitedMs,
      lifecycleReadyAt: entry.lifecycleReadyAt || null,
      responseSource,
      completionReason
    }
  });

  updateModelState(llmName, 'RECEIVING', {
    message: 'Awaiting full answer confirmation',
    completionReason,
    responseSource
  });

  sendMessageToResultsTab({
    type: 'LLM_PARTIAL_RESPONSE',
    llmName,
    answer: normalizedAnswer,
    answerHtml: normalizedHtml,
    requestId: entry?.requestId || null,
    metadata: {
      status: 'RECEIVING',
      reason: 'await_lifecycle_ready',
      completionReason,
      responseSource,
      sendConfirmed
    },
    logs: getLogSnapshot(llmName)
  });

  const nextAllowedPingAt = Number(entry.earlyTerminalGuardNextPingAt || 0);
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (isValidTabId(tabId) && now >= nextAllowedPingAt) {
    entry.earlyTerminalGuardNextPingAt = now + EARLY_TERMINAL_GUARD_REPING_MS;
    registerSessionTimer(setTimeout(() => {
      const liveEntry = jobState?.llms?.[llmName];
      if (!liveEntry || isFinalizedEntry(liveEntry)) return;
      if (liveEntry.lifecycleReadyAt || liveEntry.lifecycleReadyMeta?.state === 'COMPLETE') return;
      const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
      if (!isValidTabId(liveTabId)) return;
      triggerResponseCollectionPing(llmName, liveTabId, 'early_terminal_guard_followup', {
        allowRecovery: true,
        maxAttempts: 3,
        baseDelay: 700
      });
    }, EARLY_TERMINAL_GUARD_REPING_MS));
  }

  saveJobState(jobState);
  broadcastGlobalState();
  return true;
}

const resolveHardStopDeferWindowMs = (llmName) => {
  const byModelMs = Number(HARD_STOP_DEFER_WINDOW_BY_MODEL_MS?.[llmName] || 0);
  if (Number.isFinite(byModelMs) && byModelMs > 0) return byModelMs;
  return HARD_STOP_DEFER_WINDOW_DEFAULT_MS;
};

const resolveBoundTabIdForOrchestrator = (llmName, entry = null) => {
  if (typeof self.getBoundTabId === 'function') {
    return self.getBoundTabId(llmName, entry);
  }
  if (typeof TabMapManager !== 'undefined' && typeof TabMapManager.get === 'function') {
    return TabMapManager.get(llmName) || null;
  }
  return null;
};

const buildInitialLlmEntry = (llmName, overrides = {}) => {
  const entry = {
    ...(LLM_TARGETS[llmName] || {}),
    llmName,
    tabId: null,
    answer: null,
    messageSent: false,
    dispatchInFlight: false,
    dispatchState: 'IDLE',
    csBusyUntil: 0,
    dispatchAttempts: 0,
    focusSwitches: 0,
    lastDispatchAt: 0,
    lastDispatchMeta: null,
    recentDispatchIds: [],
    confirmedDispatchId: null,
    promptSubmittedAt: null,
    submitSource: null,
    dispatchSource: null,
    adaptiveCollectActive: false,
    adaptiveCollectScheduledAt: null,
    status: 'IDLE',
    logs: [],
    humanVisits: 0,
    humanStalled: false,
    skipHumanLoop: false,
    humanVisitDurations: [],
    humanVisitTotalMs: 0,
    typingActive: false,
    typingStartedAt: null,
    typingEndedAt: null,
    typingGuardUntil: 0,
    typingGuardReason: null,
    lastRuntimeActivityAt: 0,
    lastRuntimeActivitySource: null,
    pingTransportErrorCount: 0,
    lastPingTransportErrorAt: 0,
    lastEarlyGestureAt: 0,
    hardStopDeferredAt: 0,
    hardStopDeferredDispatchId: null,
    lastFinalEmitKey: null,
    lastFinalEmittedAt: 0,
    ...overrides
  };
  entry.modelRunState = self.ModelRunState?.deriveModelRunState
    ? self.ModelRunState.deriveModelRunState(entry)
    : null;
  return entry;
};

const ensureRoundEntries = (selectedLLMs, reason = 'round_integrity') => {
  if (!jobState?.llms || !Array.isArray(selectedLLMs)) return;
  selectedLLMs.forEach((llmName) => {
    if (!llmName) return;
    if (jobState.llms[llmName]) return;
    const tabId = TabMapManager.get(llmName) || null;
    jobState.llms[llmName] = buildInitialLlmEntry(llmName, {
      tabId,
      status: 'RECOVERY_PENDING'
    });
    emitTelemetry(llmName, 'ROUND_STATE_REPAIR', {
      level: 'warning',
      details: 'missing model entry restored before round',
      meta: { reason, tabId }
    });
  });
};

const ensureManualRecoveryModelEntry = (llmName, tabId = null, reason = 'manual_recovery') => {
  if (!llmName) return null;
  if (!jobState || typeof jobState !== 'object') {
    jobState = {};
  }
  if (!jobState.llms || typeof jobState.llms !== 'object') {
    jobState.llms = {};
  }
  if (!Number.isFinite(Number(jobState.responsesCollected))) {
    jobState.responsesCollected = 0;
  }
  if (typeof jobState.evaluationStarted === 'undefined') {
    jobState.evaluationStarted = false;
  }
  if (!jobState.session || typeof jobState.session !== 'object') {
    const startedAt = Date.now();
    jobState.session = {
      startTime: startedAt,
      totalModels: Math.max(1, Object.keys(jobState.llms).length || 1),
      selectedModels: Object.keys(jobState.llms).length ? Object.keys(jobState.llms) : [llmName],
      completed: 0,
      failed: 0,
      focusSwitches: 0,
      boundTabIds: [],
      recoveryOnly: true
    };
  }
  if (!jobState.llms[llmName]) {
    jobState.llms[llmName] = buildInitialLlmEntry(llmName, {
      tabId: isValidTabId(tabId) ? tabId : null,
      status: 'RECOVERY_PENDING',
      recoveryOnly: true
    });
    appendLogEntry(llmName, {
      type: 'PING',
      label: 'Manual recovery entry created',
      details: reason,
      level: 'warning',
      meta: { tabId }
    });
  } else if (isValidTabId(tabId)) {
    jobState.llms[llmName].tabId = tabId;
  }
  if (!Array.isArray(jobState.session.selectedModels)) {
    jobState.session.selectedModels = [];
  }
  if (!jobState.session.selectedModels.includes(llmName)) {
    jobState.session.selectedModels.push(llmName);
    jobState.session.totalModels = Math.max(Number(jobState.session.totalModels || 0), jobState.session.selectedModels.length);
  }
  return jobState.llms[llmName];
};

const getManualRecoveryState = (entry) => {
  if (!entry) return null;
  if (!entry.manualRecovery || typeof entry.manualRecovery !== 'object') {
    entry.manualRecovery = {
      attempt: 0,
      strategyIndex: 0,
          failedStrategyIds: [],
          failedSelectors: [],
          candidates: [],
          lastAcceptedCandidate: null,
          exhausted: false,
          startedAt: Date.now(),
          updatedAt: Date.now()
    };
  }
  if (!Array.isArray(entry.manualRecovery.failedStrategyIds)) entry.manualRecovery.failedStrategyIds = [];
  if (!Array.isArray(entry.manualRecovery.failedSelectors)) entry.manualRecovery.failedSelectors = [];
  if (!Array.isArray(entry.manualRecovery.candidates)) entry.manualRecovery.candidates = [];
  return entry.manualRecovery;
};

const markLastManualCandidateRejected = (recovery) => {
  if (!recovery) return;
  const last = Array.isArray(recovery.candidates) ? recovery.candidates[recovery.candidates.length - 1] : null;
  if (last?.strategyId && !recovery.failedStrategyIds.includes(last.strategyId)) {
    recovery.failedStrategyIds.push(last.strategyId);
  }
  const selector = last?.selectorDescriptor || last?.selectorUsed || null;
  if (selector && !recovery.failedSelectors.includes(selector)) {
    recovery.failedSelectors.push(selector);
  }
  recovery.attempt = Number(recovery.attempt || 0) + 1;
  recovery.strategyIndex = Math.min(
    MANUAL_RECOVERY_STRATEGIES.length,
    Number(recovery.strategyIndex || 0) + 1
  );
  recovery.updatedAt = Date.now();
};

const resolveManualRecoveryStrategy = (recovery) => {
  const failed = new Set(Array.isArray(recovery?.failedStrategyIds) ? recovery.failedStrategyIds : []);
  const start = Math.max(0, Number(recovery?.strategyIndex || 0));
  for (let offset = 0; offset < MANUAL_RECOVERY_STRATEGIES.length; offset += 1) {
    const index = (start + offset) % MANUAL_RECOVERY_STRATEGIES.length;
    const strategy = MANUAL_RECOVERY_STRATEGIES[index];
    if (strategy?.id && !failed.has(strategy.id)) {
      return { ...strategy, index };
    }
  }
  return null;
};

const saveManualRecoveryCandidate = (entry, result = {}, strategy = null) => {
  const recovery = getManualRecoveryState(entry);
  if (!recovery || !result?.ok || !result.text) return null;
  const candidate = {
    strategyId: result.strategyId || strategy?.id || null,
    strategyIndex: Number.isFinite(Number(result.strategyIndex)) ? Number(result.strategyIndex) : (strategy?.index ?? null),
    selectorUsed: result.selectorUsed || null,
    selectorDescriptor: result.selectorDescriptor || result.selectorUsed || null,
    source: result.source || 'late_collect',
    textHash: result.textHash || simpleLateAnswerHash(result.text),
    length: String(result.text || '').trim().length,
    candidateCount: Number(result.candidateCount || result.candidates || 0),
    acceptedAt: Date.now()
  };
  recovery.candidates.push(candidate);
  recovery.lastCandidate = candidate;
  recovery.lastAcceptedCandidate = candidate;
  recovery.lastStrategyId = candidate.strategyId;
  recovery.lastSelectorUsed = candidate.selectorDescriptor || candidate.selectorUsed || null;
  recovery.exhausted = false;
  recovery.updatedAt = Date.now();
  if (Number.isFinite(Number(candidate.strategyIndex))) {
    recovery.strategyIndex = Math.min(MANUAL_RECOVERY_STRATEGIES.length, Number(candidate.strategyIndex) + 1);
  }
  return candidate;
};

const waitForRound0Binding = async (llmName, sessionId, timeoutMs = ROUND0_BIND_WAIT_TIMEOUT_MS) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    const entry = jobState?.llms?.[llmName] || null;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (isValidTabId(boundTabId)) {
      const tab = await getTabSafe(boundTabId);
      if (tab && (typeof isEligibleTabForLlm !== 'function' || isEligibleTabForLlm(llmName, tab))) {
        return true;
      }
    }
    await orchestratorSleepMs(ROUND0_BIND_POLL_MS);
  }
  emitTelemetry(llmName, 'ROUND0_BIND_WAIT_TIMEOUT', {
    level: 'warning',
    details: `${timeoutMs}ms`,
    meta: { timeoutMs }
  });
  broadcastDiagnostic(llmName, {
    type: 'DISPATCH',
    label: 'ROUND0 bind timeout',
    details: `${timeoutMs}ms`,
    level: 'warning'
  });
  return false;
};

const postR2AutoCollectTimers = new Map();
const claudeRetryTimers = new Map();
const claudeRetryFinalizeTimers = new Map();
const adaptiveCollectTimers = new Map();

const clearClaudeRetryTimers = (llmName) => {
  const timer = claudeRetryTimers.get(llmName);
  if (timer) {
    clearTimeout(timer);
    deregisterSessionTimer(timer);
    claudeRetryTimers.delete(llmName);
  }
  const finalizeTimer = claudeRetryFinalizeTimers.get(llmName);
  if (finalizeTimer) {
    clearTimeout(finalizeTimer);
    deregisterSessionTimer(finalizeTimer);
    claudeRetryFinalizeTimers.delete(llmName);
  }
};

const getRecentPipelineErrorReason = (entry) => {
  const logs = Array.isArray(entry?.logs) ? entry.logs : [];
  for (let idx = logs.length - 1; idx >= 0; idx -= 1) {
    const log = logs[idx];
    if (!log || log.label !== 'PIPELINE_ERROR') continue;
    const reason = String(log?.meta?.message || log?.details || '').toLowerCase();
    if (reason) return reason;
  }
  return '';
};

const maybeRunEarlyGestureRecovery = (llmName, tabId, source = 'adaptive_ping_transport_error') => {
  if (!llmName || !isValidTabId(tabId)) return;
  if (!EARLY_GESTURE_RECOVERY_MODELS.has(llmName)) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry) || entry.automationVisitActive) return;
  const now = Date.now();
  const submittedAt = Number(entry.promptSubmittedAt || entry.lastDispatchAt || 0);
  if (!submittedAt) return;
  const elapsedMs = Math.max(0, now - submittedAt);
  const errors = Number(entry.pingTransportErrorCount || 0);
  const lastGestureAt = Number(entry.lastEarlyGestureAt || 0);
  if (elapsedMs < EARLY_GESTURE_RECOVERY_MIN_ELAPSED_MS) return;
  if (errors < EARLY_GESTURE_RECOVERY_MIN_ERRORS) return;
  if (lastGestureAt && now - lastGestureAt < EARLY_GESTURE_RECOVERY_COOLDOWN_MS) return;

  entry.lastEarlyGestureAt = now;
  const runSessionId = Number(jobState?.session?.startTime || 0) || null;
  emitTelemetry(llmName, 'EARLY_GESTURE_RECOVERY_START', {
    level: 'warning',
    details: source,
    meta: {
      tabId,
      source,
      elapsedMs,
      errors,
      cooldownMs: EARLY_GESTURE_RECOVERY_COOLDOWN_MS
    }
  });
  Promise.resolve().then(async () => {
    if (runSessionId && !isSessionActive(runSessionId)) return;
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(liveTabId)) return;
    await runForcedAutomationVisits(llmName, liveTabId, runSessionId, {
      visits: 1,
      minMs: EARLY_GESTURE_RECOVERY_VISIT_MIN_MS,
      maxMs: EARLY_GESTURE_RECOVERY_VISIT_MAX_MS,
      reason: 'early_gesture_recovery'
    });
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) return;
    const afterVisitTabId = resolveBoundTabIdForOrchestrator(llmName, afterVisitEntry);
    if (!isValidTabId(afterVisitTabId)) return;
    triggerResponseCollectionPing(llmName, afterVisitTabId, 'early_gesture_recovery');
    emitTelemetry(llmName, 'EARLY_GESTURE_RECOVERY_END', {
      details: 'visit_and_ping_done',
      meta: {
        tabId: afterVisitTabId,
        source
      }
    });
  }).catch((err) => {
    emitTelemetry(llmName, 'EARLY_GESTURE_RECOVERY_ERROR', {
      level: 'warning',
      details: err?.message || String(err),
      meta: { tabId, source }
    });
  });
};

const triggerResponseCollectionPing = (llmName, tabId, source = 'auto_collect', options = {}) => {
  if (!llmName || !isValidTabId(tabId)) return;
  const liveEntry = jobState?.llms?.[llmName];
  if (!liveEntry || isFinalizedEntry(liveEntry)) return;
  const opts = options && typeof options === 'object' ? options : {};
  const sourceTag = String(source || '').toLowerCase();
  const isHardStopPing = sourceTag.includes('hard_stop');
  const transportRetryDelays = Array.isArray(opts.transportRetryDelays) && opts.transportRetryDelays.length
    ? opts.transportRetryDelays
    : (isHardStopPing ? HARD_STOP_PING_RETRY_DELAYS_MS : FAST_PING_RETRY_DELAYS_MS);
  const maxAttempts = Math.max(
    1,
    Number(
      opts.maxAttempts
      || (Array.isArray(transportRetryDelays) ? transportRetryDelays.length : 0)
      || (isHardStopPing ? 4 : 3)
    )
  );
  const baseDelay = Math.max(1, Number(opts.baseDelay || 700));
  const allowRecovery = typeof opts.allowRecovery === 'boolean' ? opts.allowRecovery : isHardStopPing;
  extendPingWindowForLLM(llmName, MANUAL_PING_WINDOW_MS);
  const responseMeta = {
    source,
    runSessionId: Number(jobState?.session?.startTime || 0) || null,
    sessionId: Number(jobState?.session?.startTime || 0) || null,
    dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
    forceEmitOnUnchanged: false
  };
  sendPassiveMessageWithRetries(tabId, llmName, { action: 'getResponses', meta: responseMeta }, {
    maxAttempts,
    baseDelay,
    transportRetryDelays,
    allowRecovery,
    onSuccess: (response) => {
      const successEntry = jobState?.llms?.[llmName];
      if (successEntry) {
        successEntry.pingTransportErrorCount = 0;
      }
      if (response?.status === 'ignored_terminal') {
        return;
      }
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'getResponses command sent',
        details: response?.status ? `CS status: ${response.status}` : '',
        level: 'success'
      });
    },
    onError: (errMsg) => {
      const failedEntry = jobState?.llms?.[llmName];
      if (failedEntry) {
        failedEntry.pingTransportErrorCount = Number(failedEntry.pingTransportErrorCount || 0) + 1;
        failedEntry.lastPingTransportErrorAt = Date.now();
      }
      if (typeof self.recoverAnswerViaDomSnapshot === 'function') {
        self.recoverAnswerViaDomSnapshot(llmName, tabId, `passive_ping_error:${source}`, {
          dispatchId: failedEntry?.lastDispatchMeta?.dispatchId || null
        }).catch(() => {});
      }
      broadcastDiagnostic(llmName, {
        type: 'PING_ERROR',
        label: 'PING_TRANSPORT_ERROR',
        details: errMsg,
        level: 'warning'
      });
      maybeRunEarlyGestureRecovery(llmName, tabId, source);
    }
  });
};

const clearAdaptiveCollectTimer = (llmName) => {
  const timer = adaptiveCollectTimers.get(llmName);
  if (timer) {
    clearTimeout(timer);
    deregisterSessionTimer(timer);
    adaptiveCollectTimers.delete(llmName);
  }
  const entry = jobState?.llms?.[llmName];
  if (entry) {
    entry.adaptiveCollectActive = false;
    entry.adaptiveCollectScheduledAt = null;
  }
};

const resolveAdaptiveProbeIntervalMs = (elapsedMs) => {
  if (elapsedMs < ADAPTIVE_PROBE_FAST_WINDOW_MS) return ADAPTIVE_PROBE_FAST_INTERVAL_MS;
  if (elapsedMs < ADAPTIVE_PROBE_MEDIUM_WINDOW_MS) return ADAPTIVE_PROBE_MEDIUM_INTERVAL_MS;
  if (elapsedMs < ADAPTIVE_PROBE_TOTAL_WINDOW_MS) return ADAPTIVE_PROBE_SLOW_INTERVAL_MS;
  return 0;
};

const scheduleAdaptiveCollectionProbe = (llmName, sessionId, options = {}) => {
  if (!llmName) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry) || entry.dispatchSource === 'api') {
    clearAdaptiveCollectTimer(llmName);
    return;
  }
  const now = Date.now();
  const baseTs = Number(entry.promptSubmittedAt || entry.lastDispatchAt || now);
  const elapsedMs = Math.max(0, now - baseTs);
  const intervalMs = resolveAdaptiveProbeIntervalMs(elapsedMs);
  if (intervalMs <= 0) {
    emitTelemetry(llmName, 'ADAPTIVE_PROBE_STOP', {
      details: 'window_exhausted',
      meta: { elapsedMs, baseTs }
    });
    clearAdaptiveCollectTimer(llmName);
    return;
  }

  clearAdaptiveCollectTimer(llmName);
  entry.adaptiveCollectActive = true;
  entry.adaptiveCollectScheduledAt = now + intervalMs;
  const runSessionId = sessionId || getActiveSessionId();
  const timerId = registerSessionTimer(setTimeout(() => {
    deregisterSessionTimer(timerId);
    adaptiveCollectTimers.delete(llmName);

    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) {
      clearAdaptiveCollectTimer(llmName);
      return;
    }
    if (runSessionId && !isSessionActive(runSessionId)) {
      clearAdaptiveCollectTimer(llmName);
      return;
    }
    const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    const probeElapsedMs = Math.max(0, Date.now() - Number(liveEntry.promptSubmittedAt || baseTs));
    if (isValidTabId(liveTabId)) {
      emitTelemetry(llmName, 'ADAPTIVE_PROBE_TICK', {
        details: options.reason || 'adaptive_collect',
        meta: { elapsedMs: probeElapsedMs, tabId: liveTabId, intervalMs }
      });
      triggerResponseCollectionPing(llmName, liveTabId, options.source || 'adaptive_collect');
    } else {
      emitTelemetry(llmName, 'ADAPTIVE_PROBE_SKIP', {
        level: 'warning',
        details: 'missing_tab',
        meta: { elapsedMs: probeElapsedMs, intervalMs }
      });
    }
    scheduleAdaptiveCollectionProbe(llmName, runSessionId, options);
  }, intervalMs));

  adaptiveCollectTimers.set(llmName, timerId);
};

const schedulePostR2AutoCollect = (llmName, tabId, sessionId) => {
  if (!llmName || !isValidTabId(tabId)) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return;
  if (entry.postR2AutoCollectScheduledAt) return;
  entry.postR2AutoCollectScheduledAt = Date.now();
  const timerId = registerSessionTimer(setTimeout(async () => {
    deregisterSessionTimer(timerId);
    postR2AutoCollectTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(boundTabId)) return;
    await runForcedAutomationVisits(llmName, boundTabId, sessionId, {
      visits: POST_R2_AUTO_COLLECT_VISIT_COUNT,
      minMs: POST_R2_AUTO_COLLECT_VISIT_MIN_MS,
      maxMs: POST_R2_AUTO_COLLECT_VISIT_MAX_MS,
      reason: 'post_r2_precollect'
    });
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) return;
    triggerResponseCollectionPing(llmName, boundTabId, 'post_r2_auto');
  }, POST_R2_AUTO_COLLECT_DELAY_MS));
  postR2AutoCollectTimers.set(llmName, timerId);
};

const scheduleClaudeHardTimeoutRetry = (llmName, entry, metaObj, sessionId) => {
  if (!entry || entry.hardTimeoutRetryDone) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  entry.hardTimeoutRetryDone = true;
  entry.hardTimeoutRetryInFlight = true;
  entry.hardTimeoutRetryScheduledAt = Date.now();
  broadcastDiagnostic(llmName, {
    type: 'RESPONSE',
    label: 'Retry extraction scheduled',
    details: 'hard_timeout',
    level: 'warning'
  });
  emitTelemetry(llmName, 'RETRY_EXTRACTION_SCHEDULED', {
    level: 'warning',
    details: 'hard_timeout',
    meta: { tabId }
  });
  const timerId = registerSessionTimer(setTimeout(async () => {
    deregisterSessionTimer(timerId);
    claudeRetryTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(boundTabId)) return;
    await runForcedAutomationVisits(llmName, boundTabId, sessionId, {
      visits: 1,
      minMs: CLAUDE_RETRY_VISIT_MIN_MS,
      maxMs: CLAUDE_RETRY_VISIT_MAX_MS,
      reason: 'claude_retry'
    });
    triggerResponseCollectionPing(llmName, boundTabId, 'claude_retry');
  }, CLAUDE_RETRY_DELAY_MS));
  claudeRetryTimers.set(llmName, timerId);
  const finalizeTimer = registerSessionTimer(setTimeout(() => {
    deregisterSessionTimer(finalizeTimer);
    claudeRetryFinalizeTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    liveEntry.hardTimeoutRetryInFlight = false;
    handleLLMResponse(
      llmName,
      'Error: hard_timeout',
      { type: 'hard_timeout_retry_exhausted', message: 'Claude retry expired' },
      metaObj || null,
      ''
    );
  }, CLAUDE_RETRY_FINALIZE_MS));
  claudeRetryFinalizeTimers.set(llmName, finalizeTimer);
  return true;
};

const startBudgetPhase = (llmName, phase, budgetMs, meta = {}) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || !phase) return;
  const store = ensureBudgetStore(entry);
  if (!store) return;
  const normalizedPhase = String(phase).toLowerCase();
  const resolvedBudgetMs = Number(budgetMs || resolveBudgetMsForPhase(normalizedPhase)) || 0;
  if (resolvedBudgetMs <= 0) return;
  const existing = store[normalizedPhase];
  if (existing?.timerId) {
    clearTimeout(existing.timerId);
  }
  const startedAt = Date.now();
  const timerId = setTimeout(() => {
    const liveEntry = jobState?.llms?.[llmName];
    const dispatchId = liveEntry?.lastDispatchMeta?.dispatchId || null;
    const tabId = liveEntry?.tabId || null;
    emitTelemetry(llmName, 'BUDGET_EXHAUSTED', {
      level: 'warning',
      meta: {
        phase: normalizedPhase,
        budgetMs: resolvedBudgetMs,
        startedAt,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        dispatchId,
        tabId,
        ...meta
      },
      force: true
    });
  }, resolvedBudgetMs);
  store[normalizedPhase] = { timerId, startedAt, budgetMs: resolvedBudgetMs };
};

const endBudgetPhase = (llmName, phase) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || !phase) return;
  const store = ensureBudgetStore(entry);
  if (!store) return;
  const normalizedPhase = String(phase).toLowerCase();
  const existing = store[normalizedPhase];
  if (existing?.timerId) {
    clearTimeout(existing.timerId);
  }
  delete store[normalizedPhase];
};

const clearBudgetPhases = (llmName) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const store = ensureBudgetStore(entry);
  if (!store) return;
  Object.keys(store).forEach((phase) => endBudgetPhase(llmName, phase));
};

function emitModelRoundTelemetry(llmName, round, phase, details = '', { level = 'info', meta = {} } = {}) {
  if (!llmName || typeof phase !== 'string' || round == null) return;
  const dispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || null;
  if (jobState?.session) {
    jobState.session.roundDurations = jobState.session.roundDurations || {};
    jobState.session.roundStarts = jobState.session.roundStarts || {};
    const startsForRound = jobState.session.roundStarts[round] || {};
    if (phase === 'START') {
      startsForRound[llmName] = Date.now();
      jobState.session.roundStarts[round] = startsForRound;
    } else if (phase === 'END') {
      const startedAt = startsForRound[llmName];
      if (startedAt) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const durations = jobState.session.roundDurations[round] || [];
        durations.push(durationMs);
        jobState.session.roundDurations[round] = durations.slice(-50);
      }
    }
  }
  emitTelemetry(llmName, `ROUND${round}_${phase}`, {
    details,
    level,
    meta: { round, dispatchId, ...meta },
    force: true
  });
}

const resolveRoundModelNames = (selectedLLMs = []) => {
  if (Array.isArray(selectedLLMs) && selectedLLMs.length) {
    return [...new Set(selectedLLMs.filter(Boolean))];
  }
  const sessionModels = Array.isArray(jobState?.session?.selectedModels)
    ? jobState.session.selectedModels
    : [];
  if (sessionModels.length) return [...new Set(sessionModels.filter(Boolean))];
  return Object.keys(jobState?.llms || {});
};

const getPendingRoundModels = (modelNames = []) => modelNames.filter((llmName) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry) return true;
  return !isFinalizedEntry(entry);
});

const finalizeNoSendModelIfStalled = (llmName, sessionId, reason = 'round4_gate') => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const dispatchAttempts = Number(entry.dispatchAttempts || 0);
  if (dispatchAttempts <= 0) return false;
  const hasPromptConfirmation = !!entry.promptSubmittedAt;
  if (hasPromptConfirmation) return false;
  const sessionStart = Number(jobState?.session?.startTime || 0) || Date.now();
  const stallStartedAt = Number(entry.lastDispatchAt || sessionStart || Date.now());
  const elapsedMs = Math.max(0, Date.now() - stallStartedAt);
  if (elapsedMs < NO_SEND_STALL_GRACE_MS) return false;

  emitTelemetry(llmName, 'ROUND4_FORCE_FINAL', {
    level: 'warning',
    details: 'no_send_stall',
    meta: {
      reason,
      elapsedMs,
      graceMs: NO_SEND_STALL_GRACE_MS,
      dispatchAttempts,
      dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
      tabId: entry?.tabId || null
    }
  });
  handleLLMResponse(
    llmName,
    'Error: prompt_not_confirmed_before_round4',
    { type: 'no_send', message: `Prompt submission not confirmed for ${elapsedMs}ms` },
    {
      dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
      sessionId: sessionId || getActiveSessionId(),
      runSessionId: sessionId || getActiveSessionId()
    },
    ''
  );
  return true;
};

async function waitForRound4Gate(modelNames, sessionId) {
  const trackedModels = resolveRoundModelNames(modelNames);
  if (!trackedModels.length) {
    return { ready: true, timedOut: false, pendingBefore: [], pendingAfter: [] };
  }

  const startedAt = Date.now();
  while (true) {
    if (sessionId && !isSessionActive(sessionId)) {
      return { ready: false, timedOut: false, pendingBefore: [], pendingAfter: [] };
    }
    ensureRoundEntries(trackedModels, 'round4_gate');
    const pendingBefore = getPendingRoundModels(trackedModels);
    if (!pendingBefore.length) {
      return { ready: true, timedOut: false, pendingBefore, pendingAfter: [] };
    }

    pendingBefore.forEach((llmName) => {
      finalizeNoSendModelIfStalled(llmName, sessionId, 'round4_gate');
    });

    const pendingAfter = getPendingRoundModels(trackedModels);
    if (!pendingAfter.length) {
      return { ready: true, timedOut: false, pendingBefore, pendingAfter: [] };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= ROUND4_PENDING_WAIT_MAX_MS) {
      pendingAfter.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        if (!entry || isFinalizedEntry(entry)) return;
        const hasPromptConfirmation = !!entry.promptSubmittedAt;
        const errorType = hasPromptConfirmation ? 'extract_failed' : 'no_send';
        const errorMessage = hasPromptConfirmation
          ? `Round4 gate timeout after ${elapsedMs}ms`
          : `Prompt submission not confirmed before gate timeout (${elapsedMs}ms)`;
        emitTelemetry(llmName, 'ROUND4_FORCE_FINAL', {
          level: 'warning',
          details: 'gate_timeout',
          meta: {
            elapsedMs,
            waitMaxMs: ROUND4_PENDING_WAIT_MAX_MS,
            reason: 'round4_gate_timeout',
            errorType,
            dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
            tabId: entry?.tabId || null
          }
        });
        handleLLMResponse(
          llmName,
          `Error: ${errorType}_round4_gate_timeout`,
          { type: errorType, message: errorMessage },
          {
            dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
            sessionId: sessionId || getActiveSessionId(),
            runSessionId: sessionId || getActiveSessionId()
          },
          ''
        );
      });
      return {
        ready: false,
        timedOut: true,
        pendingBefore,
        pendingAfter: getPendingRoundModels(trackedModels)
      };
    }

    await orchestratorSleepMs(ROUND4_PENDING_POLL_MS);
  }
}

// Purpose: keep orchestrator delays cancelable and tied to the current session context.
let orchestratorAbortController = new AbortController();

function getOrchestratorAbortSignal() {
  return orchestratorAbortController.signal;
}

function resetOrchestratorAbortController() {
  orchestratorAbortController = new AbortController();
}

function abortOrchestratorOperations(reason = 'session_reset') {
  if (!orchestratorAbortController.signal.aborted) {
    orchestratorAbortController.abort(reason);
  }
}

function orchestratorSleepMs(ms, signal = getOrchestratorAbortSignal()) {
  const duration = Math.max(0, ms || 0);
  return new Promise((resolve) => {
    if (duration <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      resolve();
      return;
    }
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      deregisterSessionTimer(timer);
      resolve();
    };
    let timer = null;
    timer = registerSessionTimer(setTimeout(finish, duration));
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function hasRound2SubmitOrAnswerEvidence(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.promptSubmittedAt) return true;
  if (entry.answerCompleteDetectedAt || entry.lifecycleReadyAt) return true;
  const answerText = String(entry.answer || '').trim();
  const pendingFinalAnswer = String(entry.pendingFinalAnswer || '').trim();
  const pendingAnswer = String(entry.pendingAnswer || '').trim();
  return answerText.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    || pendingFinalAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    || pendingAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    || Number(entry.answerCompleteTextLength || entry.lifecycleReadyMeta?.textLength || 0) >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS;
}

function getRound2SubmitConfirmationState(llmName, dispatchId = null) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!entry) return { ok: false, reason: 'entry_missing', entry: null };
  if (isFinalizedEntry(entry)) return { ok: true, reason: 'terminal', entry };
  const liveDispatchId = entry.lastDispatchMeta?.dispatchId || entry.awaitingSubmitConfirmationDispatchId || entry.confirmedDispatchId || null;
  const sameDispatch = !dispatchId || !liveDispatchId || liveDispatchId === dispatchId || entry.confirmedDispatchId === dispatchId;
  if (sameDispatch && entry.promptSubmittedAt) {
    return { ok: true, reason: entry.submitSource === 'content' ? 'prompt_submitted' : 'prompt_submitted_non_content', entry };
  }
  if (sameDispatch && hasRound2SubmitOrAnswerEvidence(entry)) {
    return { ok: true, reason: 'answer_evidence', entry };
  }
  if (sameDispatch && (entry.messageSent || entry.awaitingSubmitConfirmation || entry.dispatchInFlight)) {
    return { ok: false, reason: 'dispatch_pending', entry };
  }
  return { ok: false, reason: sameDispatch ? 'not_confirmed' : 'stale_dispatch', entry };
}

async function waitForRound2SubmitConfirmation(llmName, dispatchId = null, timeoutMs = ROUND2_REPAIR_CONFIRM_WAIT_MS) {
  const startedAt = Date.now();
  const maxWaitMs = Math.max(0, Number(timeoutMs) || 0);
  let state = getRound2SubmitConfirmationState(llmName, dispatchId);
  if (state.ok || maxWaitMs <= 0) {
    return { ...state, waitedMs: Date.now() - startedAt };
  }
  while ((Date.now() - startedAt) < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await orchestratorSleepMs(Math.min(ROUND2_REPAIR_CONFIRM_POLL_MS, Math.max(0, remainingMs)));
    state = getRound2SubmitConfirmationState(llmName, dispatchId);
    if (state.ok) {
      return { ...state, waitedMs: Date.now() - startedAt };
    }
  }
  return { ...state, waitedMs: Date.now() - startedAt };
}

function isRound2DelayedConfirmationState(state) {
  return state?.reason === 'dispatch_pending';
}

async function scheduleRound2DelayedConfirmationContinuation(llmName, tabId, sessionId, reason, state = {}) {
  broadcastDiagnostic(llmName, {
    type: 'DISPATCH',
    label: 'ROUND2_VERIFY',
    details: 'prompt confirmation delayed; collection/probes scheduled',
    level: 'info',
    meta: { tabId, reason: state.reason || 'dispatch_pending', source: reason }
  });
  emitTelemetry(llmName, 'ROUND2_VERIFY_DELAYED_CONFIRMATION', {
    level: 'info',
    details: 'dispatch still pending',
    meta: { tabId, reason: state.reason || 'dispatch_pending', source: reason }
  });
  const liveEntry = jobState?.llms?.[llmName];
  if (liveEntry && !isFinalizedEntry(liveEntry)) {
    await runPreCollectScrollNudge(llmName, tabId, sessionId, `${reason}_precollect`);
    triggerResponseCollectionPing(llmName, tabId, `${reason}_probe`);
    schedulePostR2AutoCollect(llmName, tabId, sessionId);
    scheduleAdaptiveCollectionProbe(llmName, sessionId, {
      reason,
      source: 'adaptive_round2'
    });
  }
}
const getActiveSessionId = () => jobState?.session?.startTime || null;
const isSessionActive = (sessionId) => !!sessionId && jobState?.session?.startTime === sessionId;
const MV3_SURVIVAL_ALARM = 'llm_orchestrator_mv3_survival_v1';
const MV3_SURVIVAL_ALARM_PERIOD_MIN = 0.5;
let mv3RehydrationInFlight = false;

const sessionTimers = new Set();
const sessionTimerMetadata = new Map();

const captureTimerStack = () => {
  const rawStack = (new Error()).stack || '';
  const cleanLines = rawStack
    .split('\n')
    .slice(2, 6)
    .map((line) => line.replace(/^\s+at\s+/i, '').trim())
    .filter(Boolean);
  return cleanLines.join(' | ');
};

function registerSessionTimer(timerId) {
  if (!timerId) return null;
  sessionTimers.add(timerId);
  sessionTimerMetadata.set(timerId, {
    registeredAt: Date.now(),
    stack: captureTimerStack()
  });
  return timerId;
}

function deregisterSessionTimer(timerId) {
  if (!timerId) return;
  sessionTimers.delete(timerId);
  sessionTimerMetadata.delete(timerId);
}

function clearSessionTimers() {
  if (!sessionTimers.size) return;
  const entries = Array.from(sessionTimerMetadata.entries()).slice(0, 8).map(([timerId, info]) => ({
    timerId,
    ageMs: Date.now() - info.registeredAt,
    stack: info.stack
  }));
  console.warn(`[BACKGROUND] clearSessionTimers clearing ${sessionTimers.size} session timers`, {
    samples: entries,
    reportedAt: Date.now()
  });
  sessionTimers.forEach((timerId) => {
    clearTimeout(timerId);
  });
  sessionTimers.clear();
  sessionTimerMetadata.clear();
}

function hasOpenModelRuns(state = jobState) {
  return Object.values(state?.llms || {}).some((entry) => entry && !isFinalizedEntry(entry));
}

function updateMv3SurvivalAlarm(state = jobState) {
  try {
    if (!chrome?.alarms?.create) return;
    if (state?.session?.startTime && hasOpenModelRuns(state)) {
      chrome.alarms.create(MV3_SURVIVAL_ALARM, { periodInMinutes: MV3_SURVIVAL_ALARM_PERIOD_MIN });
      return;
    }
    chrome.alarms.clear?.(MV3_SURVIVAL_ALARM);
  } catch (err) {
    console.warn('[BACKGROUND] MV3 survival alarm update failed', err);
  }
}

function rehydrateActiveJobRuntime(source = 'load_job_state') {
  if (mv3RehydrationInFlight) return false;
  if (!jobState?.session?.startTime || !jobState?.llms || !hasOpenModelRuns(jobState)) {
    updateMv3SurvivalAlarm(jobState);
    return false;
  }
  mv3RehydrationInFlight = true;
  try {
    jobState.session.mv3RehydratedAt = Date.now();
    jobState.session.mv3RehydrationCount = Number(jobState.session.mv3RehydrationCount || 0) + 1;
    emitTelemetry('SYSTEM', 'MV3_REHYDRATION', {
      level: 'info',
      details: source,
      meta: {
        sessionId: jobState.session.startTime || null,
        count: jobState.session.mv3RehydrationCount,
        openModels: Object.entries(jobState.llms || {})
          .filter(([, entry]) => entry && !isFinalizedEntry(entry))
          .map(([name]) => name)
      },
      force: true
    });
    Object.entries(jobState.llms || {}).forEach(([llmName, entry]) => {
      if (!entry || isFinalizedEntry(entry)) return;
      entry.rehydratedAt = Date.now();
      entry.dispatchInFlight = false;
      entry.domSnapshotRecoveryInFlight = false;
      entry.preTerminalMaterializeRecovery = entry.preTerminalMaterializeRecovery && typeof entry.preTerminalMaterializeRecovery === 'object'
        ? { ...entry.preTerminalMaterializeRecovery, inFlight: false, rehydrated: true }
        : entry.preTerminalMaterializeRecovery;
      const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      if (entry.promptSubmittedAt && isValidTabId(tabId)) {
        registerSessionTimer(setTimeout(() => {
          const liveEntry = jobState?.llms?.[llmName];
          if (!liveEntry || isFinalizedEntry(liveEntry)) return;
          triggerResponseCollectionPing(llmName, tabId, 'mv3_rehydration_collect', {
            maxAttempts: 2,
            baseDelay: 800,
            allowRecovery: true
          });
          scheduleAdaptiveCollectionProbe(llmName, jobState?.session?.startTime || null, {
            source: 'mv3_rehydration_adaptive',
            baseDelayMs: 1400,
            maxDelayMs: 5000,
            maxAttempts: 3
          });
        }, 250));
      }
    });
    if (typeof schedulePromptDispatchSupervisor === 'function') {
      schedulePromptDispatchSupervisor();
    }
    updateMv3SurvivalAlarm(jobState);
    saveJobState(jobState);
    broadcastGlobalState();
    return true;
  } catch (err) {
    console.warn('[BACKGROUND] MV3 rehydration failed', err);
    return false;
  } finally {
    mv3RehydrationInFlight = false;
  }
}

if (typeof chrome !== 'undefined' && chrome?.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== MV3_SURVIVAL_ALARM) return;
    loadJobState()
      .catch((err) => console.warn('[BACKGROUND] MV3 survival alarm failed', err));
  });
}

//-- 11.1. Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ðµ Ð¸ Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ° jobState Ð¸Ð· storage --//
async function saveJobState(state) {
  try {
    const persisted = self.PipelineFSM?.compactJobStateForStorage
      ? self.PipelineFSM.compactJobStateForStorage(state)
      : state;
    await CompressedStorage.set('jobState', persisted);
    updateMv3SurvivalAlarm(state);
    if (self.PipelineFSM?.persistControlState) {
      const control = self.PipelineFSM.normalizeControlState?.(state?.session?.pipelineControl || {
        pipelineRunId: state?.session?.pipelineRunId || null,
        sessionId: state?.session?.startTime || null,
        state: state?.session?.pipelineState || 'IDLE',
        stage: state?.session?.pipelineStage || null,
        round: state?.session?.pipelineRoundId || null
      });
      void self.PipelineFSM.persistControlState(control);
    }
    console.log('[BACKGROUND] Job state saved to storage (compressed)');
  } catch (e) {
    console.error('[BACKGROUND] Failed to save job state:', e);
  }
}

async function loadJobState() {
  try {
    const saved = await CompressedStorage.get('jobState');
    if (saved) {
      jobState = saved;
      self.jobState = jobState;
      const control = self.PipelineFSM?.loadControlState ? await self.PipelineFSM.loadControlState() : null;
      if (self.PipelineFSM?.hydrateJobState) {
        self.PipelineFSM.hydrateJobState(jobState, control);
      }
      console.log('[BACKGROUND] Job state loaded from storage');
      if (typeof hasPendingHumanVisits === 'function' && hasPendingHumanVisits()) {
        scheduleHumanPresenceLoop();
      }
      rehydrateActiveJobRuntime('load_job_state');
      broadcastHumanVisitStatus();
      return;
    }
    const control = self.PipelineFSM?.loadControlState ? await self.PipelineFSM.loadControlState() : null;
    if (control && control.state && control.state !== 'IDLE') {
      jobState = {
        session: {
          startTime: control.sessionId || null,
          pipelineRunId: control.pipelineRunId || null,
          pipelineState: control.state || 'IDLE',
          pipelineStage: control.stage || null,
          pipelineRoundId: control.round || null,
          pipelineControl: control
        },
        llms: {}
      };
      self.jobState = jobState;
      console.log('[BACKGROUND] Job state restored from session control state');
    }
  } catch (e) {
    console.error('[BACKGROUND] Failed to load job state:', e);
  }
}

function getActivePipelineControlState() {
  return jobState?.session?.pipelineControl || (self.PipelineFSM?.normalizeControlState ? self.PipelineFSM.normalizeControlState({
    pipelineRunId: jobState?.session?.pipelineRunId || null,
    sessionId: jobState?.session?.startTime || null,
    state: jobState?.session?.pipelineState || 'IDLE',
    stage: jobState?.session?.pipelineStage || null,
    round: jobState?.session?.pipelineRoundId || null
  }) : {
    pipelineRunId: jobState?.session?.pipelineRunId || null,
    sessionId: jobState?.session?.startTime || null,
    state: jobState?.session?.pipelineState || 'IDLE'
  });
}

function persistPipelineControlState(nextControl = null) {
  if (!self.PipelineFSM?.persistControlState) return;
  const control = nextControl || getActivePipelineControlState();
  if (jobState?.session) {
    jobState.session.pipelineControl = control;
    jobState.session.pipelineRunId = control.pipelineRunId || null;
    jobState.session.pipelineState = control.state || jobState.session.pipelineState || 'IDLE';
    jobState.session.pipelineStage = control.stage || null;
    jobState.session.pipelineRoundId = control.round || null;
  }
  void self.PipelineFSM.persistControlState(control);
}

function stopAllProcesses(reason = 'unspecified', { closeTabs = false } = {}) {
  console.log(`[BACKGROUND] stopAllProcesses: reason=${reason}, closeTabs=${closeTabs}`);
  // Purpose: cancel orchestrator waits tied to the previous session immediately.
  abortOrchestratorOperations(reason);
  resetOrchestratorAbortController();
  clearSessionTimers();
  if (typeof self.clearAllScriptRuntimeHardStops === 'function') {
    self.clearAllScriptRuntimeHardStops();
  }
  adaptiveCollectTimers.clear();
  stopHumanPresenceLoop();
  stopHeartbeatMonitor();
  pendingPings.clear();
  pendingPingByTabId.clear();
  lateAnswerCollectInFlight.clear();
  void clearLateAnswerSnapshotCache('stop_all_processes');
  healthCheckFailuresByTabId.clear();
  lastHealthCheckReportAtByTabId.clear();

  const sessionId = jobState?.session?.startTime || null;
  const tabsToClose = [];
  TabMapManager.entries().forEach(([llmName, tabId]) => {
    if (!isValidTabId(tabId)) return;
    try {
      chrome.tabs.sendMessage(tabId, {
        type: 'STOP_AND_CLEANUP',
        reason,
        meta: { sessionId }
      }).catch(() => {});
    } catch (_) {}
    closePingWindowForTab(tabId);
    delete llmActivityMap[tabId];
    if (closeTabs) tabsToClose.push(tabId);
    if (jobState?.llms?.[llmName]) {
      if (typeof self.projectModelRunStateToLegacy === 'function') {
        self.projectModelRunStateToLegacy(llmName, jobState.llms[llmName], { status: 'STOPPED' }, 'stopAllProcesses');
      } else {
        Object.assign(jobState.llms[llmName], { status: 'STOPPED' });
      }
    }
  });

  if (isValidTabId(evaluatorTabId)) {
    try {
      chrome.tabs.sendMessage(evaluatorTabId, {
        type: 'STOP_AND_CLEANUP',
        reason,
        meta: { sessionId }
      }).catch(() => {});
    } catch (_) {}
    if (closeTabs) tabsToClose.push(evaluatorTabId);
  }

  if (closeTabs && tabsToClose.length) {
    chrome.tabs.remove(tabsToClose, () => chrome.runtime.lastError);
  }

  clearActiveListeners();
  clearPingState();

  jobMetadata.clear();
  Object.keys(llmRequestMap).forEach((key) => delete llmRequestMap[key]);
  // Purpose: clear the tab registry without blocking stop cleanup.
  void TabMapManager.clear().catch((err) => {
    console.warn('[BACKGROUND] TabMapManager.clear failed:', err);
  });

  const timers = Array.from(postSuccessScrollTimers.values());
  postSuccessScrollTimers.clear();
  timers.forEach((id) => clearTimeout(id));

  Object.keys(deferredAnswerTimers).forEach((key) => {
    clearTimeout(deferredAnswerTimers[key]);
    delete deferredAnswerTimers[key];
  });

  if (jobState?.llms) {
    Object.keys(jobState.llms).forEach((name) => clearBudgetPhases(name));
  }

  rateLimitState.clear();
  rateLimitTimers.forEach((id) => clearTimeout(id));
  rateLimitTimers.clear();

  if (jobState && Object.keys(jobState).length) {
    try {
      chrome.storage.local.remove(['jobState']);
    } catch (_) {}
  }
  if (self.PipelineFSM?.stopRun) {
    const control = getActivePipelineControlState();
    const nextControl = String(reason || '').toLowerCase().includes('cancel')
      ? self.PipelineFSM.cancelRun(control, { reason, pipelineRunId: control.pipelineRunId || null, stage: 'cancelled' })
      : self.PipelineFSM.stopRun(control, { reason, pipelineRunId: control.pipelineRunId || null, stage: 'stopped' });
    persistPipelineControlState(nextControl);
  }
  jobState = {};
  broadcastGlobalState();
}

async function startProcess(prompt, selectedLLMs, resultsTab, options = {}) {
  const forceNewTabs = options.forceNewTabs !== undefined ? options.forceNewTabs : true;
  const useApiFallback = options.useApiFallback !== undefined ? options.useApiFallback : true;
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const pipelineContext = options.pipelineContext && typeof options.pipelineContext === 'object'
    ? { ...options.pipelineContext }
    : null;
  const sourceView = options.sourceView || pipelineContext?.sourceView || null;
  console.log(`[BACKGROUND] Starting process. Force new tabs: ${forceNewTabs}. Use API: ${useApiFallback}. LLMs:`, selectedLLMs);
  resultsTabId = resultsTab;
  jobMetadata.clear();
  Object.keys(llmRequestMap).forEach((key) => delete llmRequestMap[key]);
  const snapshotCleanup = await clearLateAnswerSnapshotCache('start_process');
  if (snapshotCleanup?.removed) {
    console.log(`[LateAnswerCollector] Cleared ${snapshotCleanup.removed} stale snapshot keys before new run`);
  }
  stopHumanPresenceLoop();
  // Purpose: reset orchestrator cancel signal before the new run.
  resetOrchestratorAbortController();
  adaptiveCollectTimers.clear();

  const sessionStartTime = Date.now();
  const telemetrySampled = resolveTelemetrySampling(sessionStartTime);
  jobState = {
    prompt: prompt,
    llms: {},
    responsesCollected: 0,
    evaluationStarted: false,
    useApiFallback,
    session: {
      startTime: sessionStartTime,
      totalModels: selectedLLMs.length,
      selectedModels: Array.isArray(selectedLLMs) ? selectedLLMs.slice() : [],
      completed: 0,
      failed: 0,
      focusSwitches: 0,
      boundTabIds: [],
      telemetrySampled,
      telemetrySampleRate: TELEMETRY_SAMPLE_RATE,
      sourceView,
      pipelineRunId: pipelineContext?.pipelineRunId || null,
      pipelineState: 'STARTING',
      pipelineStage: 'dispatch',
      pipelineRoundId: null,
      pipelineBatchId: null,
      pipelineContext
    },
    attachments
  };
  humanPresencePaused = false;
  humanPresenceManuallyStopped = false;
  if (self.PipelineFSM?.startRun) {
    jobState.session.pipelineControl = self.PipelineFSM.startRun({
      pipelineRunId: pipelineContext?.pipelineRunId || null,
      sessionId: sessionStartTime,
      stage: 'dispatch',
      state: self.PipelineFSM.STATES?.STARTING || 'STARTING',
      payload: {
        pipelineContext,
        selectedModels: Array.isArray(selectedLLMs) ? selectedLLMs.slice() : [],
        totalModels: selectedLLMs.length
      }
    });
  }
  saveJobState(jobState);

  initializeCircuitBreakers(selectedLLMs);
  allowCircuitHalfOpenForNewRun(selectedLLMs);
  startHeartbeatMonitor();
  broadcastGlobalState();

  selectedLLMs.forEach(llmName => {
    const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
    if (machine) {
      machine.reset();
    }
    jobState.llms[llmName] = buildInitialLlmEntry(llmName);
    updateModelState(llmName, 'IDLE', { apiStatus: 'idle' });
    if (self.syncDispatchEntryFromMachine) {
      self.syncDispatchEntryFromMachine(llmName, jobState.llms[llmName], machine);
    }
    emitTelemetry(llmName, 'RUN_START', {
      details: `models=${selectedLLMs.length}`,
      meta: {
        sessionId: jobState.session.startTime,
        totalModels: selectedLLMs.length,
        selectedModels: selectedLLMs,
        forceNewTabs,
        useApiFallback,
        source: 'start_process'
      }
    });
  });
  broadcastHumanVisitStatus();

  void runDispatchRounds(selectedLLMs, prompt, forceNewTabs, attachments);
}

function startModelForLLM(llmName, prompt, forceNewTabs, attachments = [], options = {}) {
  const sessionId = options.sessionId || getActiveSessionId();
  const chain = llmStartChains[llmName] || Promise.resolve();
  llmStartChains[llmName] = chain.then(async () => {
    if (sessionId && !isSessionActive(sessionId)) {
      return;
    }
    if (isRateLimited(llmName)) {
      console.log(`[RATE-LIMIT] ${llmName} is rate limited, scheduling retry`);
      scheduleAfterRateLimit(llmName, () => startModelForLLM(llmName, prompt, forceNewTabs, attachments, { ...options, sessionId }));
      return;
    }
    const breaker = circuitBreakerState[llmName];
    if (breaker && breaker.state === 'OPEN') {
      if (Date.now() > breaker.reopensAt) {
        console.log(`[CIRCUIT-BREAKER] ${llmName} cooldown ended. Moving to HALF_OPEN.`);
        breaker.state = 'HALF_OPEN';
        breaker.failures = FAILURE_THRESHOLD - 1;
      } else {
        const remainingTime = Math.round((breaker.reopensAt - Date.now()) / 1000);
        console.log(`[CIRCUIT-BREAKER] Skipping ${llmName} as its circuit is OPEN. Retrying in ${remainingTime}s.`);
        const errorMsg = `Model is temporarily disabled due to repeated failures. Retrying in ${remainingTime}s.`;
        handleLLMResponse(llmName, `Error: ${errorMsg}`, { type: 'circuit_open' });
        updateModelState(llmName, 'CIRCUIT_OPEN', { message: errorMsg });
        return;
      }
    }

    let apiUsed = false;
    if (jobState.useApiFallback !== false) {
      apiUsed = await tryApiDirect(llmName, prompt);
      if (apiUsed) {
        return;
      }
    }

    runModelThroughTabs(llmName, prompt, forceNewTabs, attachments, { ...options, sessionId });
  }).catch((err) => {
    console.error(`[BACKGROUND] Failed to start ${llmName}:`, err);
  });
  return llmStartChains[llmName];
}

async function tryApiDirect(llmName, prompt) {
  const config = apiFallbackConfig[llmName];
  if (!config) return false;
  if (!jobState?.llms?.[llmName]) return false;
  if (jobState?.useApiFallback === false) return false;
  try {
    let apiKey = await ApiKeyStorage.getSessionKey(config.storageKey);
    if (!apiKey) {
      apiKey = await ApiKeyStorage.getLegacyKey(config.storageKey);
      if (apiKey) {
        ApiKeyStorage.warnPlaintext(config.storageKey);
      }
    }
    if (!apiKey) {
      logApiEvent(llmName, 'API key missing, using web', 'warning', config, '', getApiEndpointMeta(config));
      return false;
    }
    initRequestMetadata(llmName, null, 'API');
    const entry = jobState.llms[llmName];
    entry.dispatchAttempts = (entry.dispatchAttempts || 0) + 1;
    entry.dispatchSource = 'api';
    entry.submitSource = 'api';
    const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
    if (machine) {
      if (!machine.canQueue()) {
        machine.reset();
      }
      machine.queue({
        prompt,
        attachments: jobState.attachments || [],
        dispatchId: `api:${llmName}:${Date.now()}`,
        dispatchAttempts: entry.dispatchAttempts
      });
      machine.activate({ tabId: null, source: 'api' });
      machine.ready({ source: 'api' });
      machine.submit({ source: 'api' });
      machine.sent({ source: 'api', confirmedAt: Date.now() });
    }
    logApiEvent(llmName, 'API request initiated', 'info', config, '', getApiEndpointMeta(config));
    const success = await executeApiFallback(llmName, prompt, {
      silentOnFailure: true,
      apiKeyOverride: apiKey
    });
    return success;
  } catch (err) {
    console.warn(`[API] Could not read API key for ${llmName}:`, err?.message || err);
    return false;
  }
}

function runModelThroughTabs(llmName, prompt, forceNewTabs, attachments = [], options = {}) {
  if (options.sessionId && !isSessionActive(options.sessionId)) {
    return;
  }
  if (forceNewTabs) {
    detachExistingTab(llmName);
    createNewLlmTab(llmName, prompt, attachments, { ...options, forceCreate: true });
    return;
  }

  const reuseMappedTabOrCreate = () => {
    const tabId = TabMapManager.get(llmName);
    if (!tabId) {
      console.log(`[BACKGROUND] Existing tab not found. Creating new tab for ${llmName}.`);
      createNewLlmTab(llmName, prompt, attachments, options);
      return;
    }

    chrome.tabs.get(tabId, async (tab) => {
      if (chrome.runtime.lastError) {
        console.log(`[BACKGROUND] Tab for ${llmName} was closed. Creating a new one.`);
        emitTelemetry(llmName, 'TAB_REUSE_MISSING', {
          details: chrome.runtime.lastError?.message || 'tab not found',
          level: 'warning',
          meta: { reason: 'reuse_tab', tabId }
        });
        await setTabBinding(llmName, null);
        broadcastGlobalState();
        createNewLlmTab(llmName, prompt, attachments, options);
      } else {
        console.log(`[BACKGROUND] Reusing tab ${tabId} for ${llmName}.`);

        try {
          emitTelemetry(llmName, 'TAB_REUSE_CANDIDATE', {
            details: tab?.url || '',
            meta: { snapshot: buildTabSnapshot(tab), reason: 'reuse_tab' }
          });
          const readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason: 'reuse_tab' });
          if (!readiness.ok) {
            emitTelemetry(llmName, 'TAB_REUSE_REJECTED', {
              details: readiness.reason || 'unknown',
              level: 'warning',
              meta: { snapshot: readiness.snapshot || null, reason: 'reuse_tab' }
            });
            broadcastDiagnostic(llmName, {
              type: 'DISPATCH',
              label: 'Saved tab not ready for reuse',
              details: readiness.reason || 'unknown',
              level: 'warning',
              meta: { snapshot: readiness.snapshot || null, dispatchReason: 'reuse_tab' }
            });
            await setTabBinding(llmName, null);
            broadcastGlobalState();
            createNewLlmTab(llmName, prompt, attachments, options);
            return;
          }
          await prepareTabForUse(tabId, llmName);

          initRequestMetadata(llmName, tabId, readiness.tab?.url || tab?.url || (LLM_TARGETS[llmName]?.url) || '');
          await setTabBinding(llmName, tabId);
          if (!options.deferDispatch) {
            dispatchPromptToTab(llmName, tabId, prompt, attachments, 'reuse_tab');
          }
        } catch (err) {
          console.error(`[BACKGROUND] Failed to prepare tab for ${llmName}:`, err);
          await setTabBinding(llmName, null);
          broadcastGlobalState();
          createNewLlmTab(llmName, prompt, attachments, options);
        }
      }
    });
  };

  // Prefer the most recently used eligible tab whenever "New pages" is disabled.
  // This prevents stale TabMap bindings from hijacking dispatch (notably for GPT).
  tryAttachExistingTab(llmName, prompt, attachments, { ...options, allowGlobalReuse: true }).then((attached) => {
    if (attached) return;
    reuseMappedTabOrCreate();
  }).catch((err) => {
    console.warn(`[BACKGROUND] Failed to attach existing tab for ${llmName}:`, err?.message || err);
    reuseMappedTabOrCreate();
  });
}

//-- 3.1. Round 0: ÐÐ• Ð¿Ñ€ÐµÑ€Ñ‹Ð²Ð°ÐµÐ¼ Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ Ð²ÐºÐ»Ð°Ð´Ð¾Ðº Ð¿Ñ€Ð¸ Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¸Ð¸ sessionId --//
async function openTabsSequentially(selectedLLMs, prompt, forceNewTabs, attachments = [], sessionId) {
  const capturedSessionId = sessionId; // Ð—Ð°Ñ…Ð²Ð°Ñ‚Ñ‹Ð²Ð°ÐµÐ¼ Ð½Ð°Ñ‡Ð°Ð»ÑŒÐ½Ñ‹Ð¹ sessionId
  
  for (let i = 0; i < selectedLLMs.length; i += 1) {
    // âœ… ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ ÐÐÐ§ÐÐ›Ð¬ÐÐ«Ð™ sessionId, Ð¸Ð³Ð½Ð¾Ñ€Ð¸Ñ€ÑƒÐµÐ¼ Ð¿Ñ€Ð¾Ð¼ÐµÐ¶ÑƒÑ‚Ð¾Ñ‡Ð½Ñ‹Ðµ Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¸Ñ
    if (capturedSessionId && jobState?.session?.startTime !== capturedSessionId) {
      console.warn(`[ROUND0] Session changed during tab opening, aborting (${i}/${selectedLLMs.length})`);
      return false;
    }
    const llmName = selectedLLMs[i];
    await startModelForLLM(llmName, prompt, forceNewTabs, attachments, { deferDispatch: true, sessionId });
    await waitForRound0Binding(llmName, sessionId, ROUND0_BIND_WAIT_TIMEOUT_MS);

    //-- 4.1. Ð›Ð¾Ð³Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ ÑƒÑÐ¿ÐµÑˆÐ½Ð¾Ð³Ð¾ Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚Ð¸Ñ Ð²ÐºÐ»Ð°Ð´ÐºÐ¸ --//
console.log(`[ROUND0] Opened tab ${i + 1}/${selectedLLMs.length}: ${llmName}`);
    emitTelemetry(llmName, 'ROUND0_TAB_OPENED', {
      details: `${i + 1}/${selectedLLMs.length}`,
      meta: { index: i, total: selectedLLMs.length, tabId: jobState?.llms?.[llmName]?.tabId || null }
    });

    if (i < selectedLLMs.length - 1) {
      await orchestratorSleepMs(ROUND0_OPEN_STAGGER_MS);
    }
  }
  if (selectedLLMs.length) {
    emitTelemetry('orchestrator', 'ROUND0_COMPLETE', {
      details: `${selectedLLMs.length} tabs opened`,
      level: 'info',
      meta: { count: selectedLLMs.length },
      force: true
    });
  }
  return true;
}


async function recoverRound1TabReadiness(llmName, prompt, attachments = [], sessionId, previousTabId = null, reason = 'round1_recover') {
  if (sessionId && !isSessionActive(sessionId)) return null;
  emitTelemetry(llmName, 'ROUND1_TAB_RECOVERY_START', {
    level: 'warning',
    details: reason,
    meta: { previousTabId, reason },
    force: true
  });
  try {
    await setTabBinding(llmName, null);
    broadcastGlobalState();
    createNewLlmTab(llmName, prompt, attachments, { sessionId, forceCreate: true, deferDispatch: true });
    await waitForRound0Binding(llmName, sessionId, ROUND0_BIND_WAIT_TIMEOUT_MS);
    const tabId = await resolveTabForLlmNameAsync(llmName);
    if (!isValidTabId(tabId)) {
      emitTelemetry(llmName, 'ROUND1_TAB_RECOVERY_MISS', {
        level: 'warning',
        details: 'tab_not_found_after_create',
        meta: { previousTabId, reason },
        force: true
      });
      return null;
    }
    const readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason });
    emitTelemetry(llmName, readiness.ok ? 'ROUND1_TAB_RECOVERY_OK' : 'ROUND1_TAB_RECOVERY_MISS', {
      level: readiness.ok ? 'success' : 'warning',
      details: readiness.ok ? 'ready' : (readiness.reason || 'not_ready'),
      meta: { previousTabId, tabId, reason, snapshot: readiness.snapshot || null },
      force: true
    });
    return readiness.ok ? { tabId, readiness } : null;
  } catch (err) {
    emitTelemetry(llmName, 'ROUND1_TAB_RECOVERY_ERROR', {
      level: 'error',
      details: err?.message || String(err),
      meta: { previousTabId, reason },
      force: true
    });
    return null;
  }
}

async function dispatchRound1Sequentially(selectedLLMs, prompt, attachments = [], sessionId) {
  for (const llmName of selectedLLMs) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    let entry = jobState?.llms?.[llmName];
    if (!entry) {
      ensureRoundEntries([llmName], 'round1_missing_entry');
      entry = jobState?.llms?.[llmName];
    }
    if (!entry) continue;
    const roundStart = Date.now();
    const endMeta = { tabId: null, reason: 'unknown' };
    let endLevel = 'info';
    let endDetails = 'dispatch complete';
    let tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    emitModelRoundTelemetry(llmName, 1, 'START', 'dispatching prompt', {
      meta: { tabId: isValidTabId(tabId) ? tabId : null }
    });
    if (!tabId) {
      tabId = await resolveTabForLlmNameAsync(llmName);
    }
    if (!isValidTabId(tabId)) {
      endLevel = 'warning';
      endDetails = 'tab not found';
      endMeta.reason = 'tab_not_found';
      emitModelRoundTelemetry(llmName, 1, 'END', endDetails, {
        level: endLevel,
        meta: { ...endMeta, durationMs: Date.now() - roundStart }
      });
      continue;
    }
    endMeta.tabId = tabId;
    const dispatchTab = await getTabSafe(tabId);
    initRequestMetadata(llmName, tabId, dispatchTab?.url || dispatchTab?.pendingUrl || '');
    //- 1.1. Round 1: режим "Спринт". Не ждем подтверждения, чтобы Gemini и Claude получили промпт мгновенно -//
    await dispatchPromptToTab(llmName, tabId, prompt, attachments, 'round1', {
      forceFocus: true,
      skipNoFocusProbe: true,
      skipFocusRestore: true,
      skipSubmitWait: true,
      deferSendMs: ROUND1_BEFORE_SEND_MS,
      skipTypingGuard: true,
      resetStateAfterSend: false
    });
    const elapsed = Date.now() - roundStart;
    const targetMs = ROUND1_BEFORE_SEND_MS + ROUND1_POST_SEND_MS;
    await orchestratorSleepMs(Math.max(0, targetMs - elapsed));
    const postDispatchEntry = jobState?.llms?.[llmName] || entry;
    const confirmedByContent = !!postDispatchEntry?.promptSubmittedAt && postDispatchEntry?.submitSource === 'content';
    endMeta.reason = confirmedByContent ? 'prompt_confirmed' : 'awaiting_submit_confirmation';
    endDetails = confirmedByContent ? 'prompt confirmed' : 'dispatch command sent (awaiting confirmation)';
    endLevel = confirmedByContent ? 'success' : 'info';
    emitModelRoundTelemetry(llmName, 1, 'END', endDetails, {
      level: endLevel,
      meta: {
        tabId,
        durationMs: Date.now() - roundStart,
        reason: endMeta.reason,
        promptSubmittedAt: postDispatchEntry?.promptSubmittedAt || null,
        submitSource: postDispatchEntry?.submitSource || null,
        dispatchId: postDispatchEntry?.lastDispatchMeta?.dispatchId || null
      }
    });
    endBudgetPhase(llmName, 'dispatch');
  }
  return true;
}

async function focusTabForVerification(llmName, tabId, durationMs, sessionId) {
  if (!isValidTabId(tabId)) return false;
  if (sessionId && !isSessionActive(sessionId)) return false;
  const previousTab = await getActiveTabSnapshot();
  let visitStarted = false;
  await withPromptDispatchFocusLock(async () => {
    await activateTabForDispatch(tabId);
  });
  if (typeof startTabVisit === 'function') {
    visitStarted = startTabVisit(tabId, llmName, 'verification_focus') === true;
  }
  await orchestratorSleepMs(durationMs);
  let visitSummary = null;
  if (
    visitStarted
    && typeof finalizeTabVisit === 'function'
    && typeof tabVisitTracker !== 'undefined'
    && tabVisitTracker?.tabId === tabId
    && tabVisitTracker?.llmName === llmName
  ) {
    visitSummary = finalizeTabVisit('verification_focus_end');
  }
  if (sessionId && !isSessionActive(sessionId)) return visitSummary || false;
  if (previousTab?.id && previousTab.id !== tabId) {
    restoreFocusIfStillOnDispatchTab(tabId, previousTab);
  }
  return visitSummary || true;
}

async function runPreCollectScrollNudge(llmName, tabId, sessionId, reason = 'precollect_nudge') {
  if (!llmName || !isValidTabId(tabId)) return false;
  if (sessionId && !isSessionActive(sessionId)) return false;
  const initialEntry = jobState?.llms?.[llmName];
  if (!initialEntry || isFinalizedEntry(initialEntry)) {
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE_SKIP', {
      details: 'terminal',
      meta: { tabId, reason }
    });
    return false;
  }
  const getSnapshotFn = (typeof getActiveTabSnapshot === 'function') ? getActiveTabSnapshot : null;
  const previousTab = getSnapshotFn ? await getSnapshotFn() : null;
  try {
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return false;
    if (typeof withPromptDispatchFocusLock === 'function') {
      await withPromptDispatchFocusLock(async () => {
        await activateTabForDispatch(tabId);
      });
    } else if (typeof activateTabForDispatch === 'function') {
      await activateTabForDispatch(tabId);
    }
  } catch (focusErr) {
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE_SKIP', {
      level: 'warning',
      details: focusErr?.message || 'focus_failed',
      meta: { tabId, reason, stage: 'focus' }
    });
    return false;
  }
  try {
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return false;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (meta = {}) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const resolveScrollableTargets = () => {
          const set = new Set();
          const add = (node) => {
            if (!node || set.has(node)) return;
            const height = Number(node.scrollHeight || 0);
            const view = Number(node.clientHeight || 0);
            if (height - view <= 40) return;
            set.add(node);
          };
          const root = document.scrollingElement || document.documentElement || document.body;
          add(root);
          const selectors = [
            'main',
            'section',
            'article',
            '[data-scrollable]',
            '[data-scroll="true"]',
            '[class*="scroll"]',
            '.chat-container',
            '.conversation',
            '.chat-history'
          ];
          selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => add(el));
          });
          return Array.from(set).slice(0, 5);
        };
        const getTop = (node) => {
          if (!node) return 0;
          if (node === document.body || node === document.documentElement || node === document.scrollingElement) {
            return Number(window.scrollY || node.scrollTop || 0);
          }
          return Number(node.scrollTop || 0);
        };
        const setTop = (node, top) => {
          if (!node) return;
          const bounded = Math.max(0, top);
          if (node === document.body || node === document.documentElement || node === document.scrollingElement) {
            window.scrollTo({ top: bounded, behavior: 'smooth' });
            return;
          }
          node.scrollTo({ top: bounded, behavior: 'smooth' });
        };
        const nudgeNode = async (node) => {
          const viewport = Math.max(220, Number(node.clientHeight || window.innerHeight || 0));
          const maxScroll = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
          if (maxScroll <= 0) return;
          const current = Math.max(0, Math.min(maxScroll, getTop(node)));
          const upDelta = Math.min(current, viewport * 0.5);
          if (upDelta > 60) {
            setTop(node, current - upDelta);
            await sleep(240);
          }
          setTop(node, maxScroll);
          await sleep(320);
        };
        return Promise.resolve().then(async () => {
          const targets = resolveScrollableTargets();
          for (const node of targets) {
            await nudgeNode(node);
          }
          window.dispatchEvent(new Event('scroll'));
          return { ok: true, targets: targets.length, reason: meta.reason || 'precollect_nudge' };
        });
      },
      args: [{ reason, llmName }]
    });
    await orchestratorSleepMs(PRECOLLECT_NUDGE_STABILIZE_MS);
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE', {
      details: reason,
      meta: { tabId, reason }
    });
    return true;
  } catch (err) {
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE_ERROR', {
      level: 'warning',
      details: err?.message || String(err),
      meta: { tabId, reason }
    });
    return false;
  } finally {
    if (previousTab?.id && previousTab.id !== tabId && typeof restoreFocusIfStillOnDispatchTab === 'function') {
      restoreFocusIfStillOnDispatchTab(tabId, previousTab);
    }
  }
}

async function runForcedAutomationVisits(llmName, tabId, sessionId, options = {}) {
  if (!isValidTabId(tabId)) return false;
  const visitFn = (typeof self.visitTabWithAutomation === 'function') ? self.visitTabWithAutomation : null;
  const visitPolicy = self.VisitPolicy || null;
  const visits = Math.max(1, Number(options.visits || 1) || 1);
  const minMs = Math.max(1000, Number(options.minMs || 0) || 1000);
  const maxMs = Math.max(minMs, Number(options.maxMs || minMs) || minMs);
  const reason = options.reason || 'automation_visit';
  const maxShortRetries = Math.max(0, Number(options.maxShortRetries ?? visitPolicy?.DEFAULT_MAX_SHORT_RETRIES ?? 1) || 0);
  let performed = 0;
  let shortRetries = 0;
  for (let index = 0; index < visits; index += 1) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) {
      emitTelemetry(llmName, 'FORCED_VISIT_SKIPPED', {
        details: 'terminal_before_visit',
        meta: { tabId, reason, visitIndex: index + 1, total: visits }
      });
      break;
    }
    const dwellMs = Math.floor(minMs + Math.random() * (maxMs - minMs));
    const maxScrollDurationMs = Math.max(1200, Number(options.maxScrollDurationMs || 3600) || 3600);
    const scrollDurationMs = Math.min(maxScrollDurationMs, Math.max(1200, Math.floor(dwellMs * 0.6)));
    emitTelemetry(llmName, 'FORCED_VISIT', {
      details: `reason=${reason} dwell=${dwellMs}ms`,
      meta: { tabId, reason, dwellMs, scrollDurationMs, visitIndex: index + 1, total: visits }
    });
    let visitResult = false;
    if (visitFn) {
      visitResult = await visitFn(llmName, tabId, { dwellMs, scrollDurationMs, reason, sessionId });
    } else {
      await focusTabForVerification(llmName, tabId, dwellMs, sessionId);
      visitResult = true;
    }
    const visitSummary = visitResult && typeof visitResult === 'object' ? visitResult : null;
    const usefulVisit = visitResult === true || (visitSummary && visitSummary.usefulVisit !== false);
    const retryShortVisit = visitPolicy?.shouldRetryVisit
      ? visitPolicy.shouldRetryVisit(visitSummary, { attempt: shortRetries, maxShortRetries })
      : Boolean(visitSummary?.shortVisit && shortRetries < maxShortRetries);
    if (retryShortVisit) {
      shortRetries += 1;
      emitTelemetry(llmName, 'FORCED_VISIT_SHORT_RETRY', {
        level: 'warning',
        details: `duration=${visitSummary?.durationMs || 0}ms retry=${shortRetries}/${maxShortRetries}`,
        meta: {
          tabId,
          reason,
          visitIndex: index + 1,
          total: visits,
          shortRetries,
          maxShortRetries,
          durationMs: visitSummary?.durationMs || 0,
          minUsefulMs: visitSummary?.minUsefulMs || null,
          source: visitSummary?.source || 'unknown',
          finishReason: visitSummary?.reason || 'unknown'
        },
        force: true
      });
      index -= 1;
      await orchestratorSleepMs(Math.min(1000, Math.max(250, Math.floor(minMs * 0.2))));
      continue;
    }
    if (usefulVisit) performed += 1;
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) break;
  }
  return performed > 0;
}

async function dispatchRound2Verification(selectedLLMs, sessionId) {
  const round2BatchStartedAt = Date.now();
  const round2BatchStartedPerf = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : null;
  const round2DeadlineAt = round2BatchStartedAt + ROUND2_BATCH_MAX_MS;
  const getRound2Timing = () => {
    const nowWall = Date.now();
    const wallElapsedMs = Math.max(0, nowWall - round2BatchStartedAt);
    let elapsedMs = wallElapsedMs;
    if (Number.isFinite(round2BatchStartedPerf) && round2BatchStartedPerf !== null && typeof performance !== 'undefined' && typeof performance.now === 'function') {
      const perfElapsedMs = Math.max(0, Math.round(performance.now() - round2BatchStartedPerf));
      elapsedMs = Number.isFinite(perfElapsedMs) ? perfElapsedMs : wallElapsedMs;
    }
    return {
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      wallElapsedMs: Math.max(0, Math.round(wallElapsedMs)),
      remainingMs: Math.max(0, round2DeadlineAt - nowWall)
    };
  };
  const emitRound2CutoffFrom = async (startIndex, timingMeta = null) => {
    const timing = timingMeta || getRound2Timing();
    const pendingModels = selectedLLMs.slice(startIndex);
    emitTelemetry('ROUNDS', 'ROUND2_CUTOFF', {
      level: 'warning',
      details: `batch timeout ${timing.elapsedMs}ms`,
      meta: {
        batchBudgetMs: ROUND2_BATCH_MAX_MS,
        pendingModels,
        elapsedMs: timing.elapsedMs,
        wallElapsedMs: timing.wallElapsedMs,
        remainingMs: timing.remainingMs,
        sessionId
      }
    });
    for (const pendingName of pendingModels) {
      const pendingEntry = jobState?.llms?.[pendingName];
      if (!pendingEntry) continue;
      const pendingTabId = self.getBoundTabId
        ? self.getBoundTabId(pendingName, pendingEntry)
        : (pendingEntry.tabId || TabMapManager.get(pendingName) || null);
      if (isFinalizedEntry(pendingEntry)) {
        emitModelRoundTelemetry(pendingName, 2, 'START', 'skipped (already complete)', {
          level: 'info',
          meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'terminal' }
        });
        emitModelRoundTelemetry(pendingName, 2, 'END', 'skipped (already complete)', {
          level: 'info',
          meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'terminal' }
        });
        continue;
      }
      broadcastDiagnostic(pendingName, {
        type: 'DISPATCH',
        label: 'ROUND2_SKIP',
        details: 'batch_timeout',
        level: 'warning'
      });
      emitModelRoundTelemetry(pendingName, 2, 'START', 'verification skipped (batch timeout)', {
        level: 'warning',
        meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'batch_timeout' }
      });
      emitModelRoundTelemetry(pendingName, 2, 'END', 'verification skipped (batch timeout)', {
        level: 'warning',
        meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'batch_timeout' }
      });
      if (pendingEntry.promptSubmittedAt && !isFinalizedEntry(pendingEntry) && isValidTabId(pendingTabId)) {
        await runPreCollectScrollNudge(pendingName, pendingTabId, sessionId, 'round2_batch_timeout');
        triggerResponseCollectionPing(pendingName, pendingTabId, 'round2_batch_timeout');
        schedulePostR2AutoCollect(pendingName, pendingTabId, sessionId);
        scheduleAdaptiveCollectionProbe(pendingName, sessionId, {
          reason: 'round2_batch_timeout',
          source: 'adaptive_round2'
        });
      }
    }
  };
  for (let index = 0; index < selectedLLMs.length; index += 1) {
    const llmName = selectedLLMs[index];
    const batchTiming = getRound2Timing();
    if (batchTiming.elapsedMs > ROUND2_BATCH_MAX_MS || batchTiming.remainingMs <= 0) {
      await emitRound2CutoffFrom(index, batchTiming);
      break;
    }
    if (sessionId && !isSessionActive(sessionId)) return false;
    const entry = jobState?.llms?.[llmName];
    if (!entry) continue;
    let tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (isFinalizedEntry(entry)) {
      emitModelRoundTelemetry(llmName, 2, 'START', 'skipped (already complete)', {
        level: 'info',
        meta: { tabId: isValidTabId(tabId) ? tabId : null, reason: 'terminal' }
      });
      emitModelRoundTelemetry(llmName, 2, 'END', 'skipped (already complete)', {
        level: 'info',
        meta: { tabId: isValidTabId(tabId) ? tabId : null, reason: 'terminal' }
      });
      continue;
    }
    emitModelRoundTelemetry(llmName, 2, 'START', 'verifying prompt', {
      meta: { tabId: isValidTabId(tabId) ? tabId : null }
    });
    let endDetails = 'round2 skipped';
    let endLevel = 'warning';
    const endMeta = {
      tabId: isValidTabId(tabId) ? tabId : null,
      reason: 'unknown'
    };
    try {
      if (entry?.dispatchSource === 'api') {
        endDetails = 'api dispatch (verification skipped)';
        endLevel = 'info';
        endMeta.reason = 'api_dispatch';
        continue;
      }
      if (!isValidTabId(tabId)) {
        tabId = await resolveTabForLlmNameAsync(llmName);
      }
      if (!isValidTabId(tabId)) {
        endMeta.reason = 'tab_not_found';
        continue;
      }
      endMeta.tabId = tabId;

      const initialConfirmed = !!entry?.promptSubmittedAt && entry?.submitSource === 'content';
      if (initialConfirmed) {
        endDetails = 'already confirmed';
        endLevel = 'info';
        endMeta.reason = 'already_confirmed';
        const liveEntry = jobState?.llms?.[llmName];
        if (liveEntry && !isFinalizedEntry(liveEntry)) {
          await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round2_precollect');
          triggerResponseCollectionPing(llmName, tabId, 'round2_probe');
          schedulePostR2AutoCollect(llmName, tabId, sessionId);
          scheduleAdaptiveCollectionProbe(llmName, sessionId, {
            reason: 'round2_already_confirmed',
            source: 'adaptive_round2'
          });
        }
        continue;
      }

      let readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason: 'round2' });
      if (!readiness.ok) {
        const retryTabId = await resolveTabForLlmNameAsync(llmName);
        if (isValidTabId(retryTabId) && retryTabId !== tabId) {
          readiness = await ensureTabReadyForDispatch(retryTabId, llmName, { reason: 'round2_retry' });
          if (readiness.ok) {
            emitTelemetry(llmName, 'ROUND2_RETRY_OK', {
              details: 'resolved tabId on retry',
              meta: { previousTabId: tabId, tabId: retryTabId }
            });
            tabId = retryTabId;
            endMeta.tabId = tabId;
          }
        }
      }
      if (!readiness.ok) {
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'ROUND2_SKIP',
          details: readiness.reason || 'tab_not_ready',
          level: 'warning'
        });
        endDetails = 'round2 skipped';
        endLevel = 'warning';
        endMeta.reason = readiness.reason || 'tab_not_ready';
        continue;
      }
      let confirmedByContent = !!entry?.promptSubmittedAt && entry?.submitSource === 'content';
      let repairAttemptedBeforeVisit = false;
      if (!confirmedByContent && ROUND2_REPAIR_MODELS.has(llmName) && jobState?.prompt) {
        repairAttemptedBeforeVisit = true;
        const repairIntentDecision = self.RecoveryIntent?.authorize
          ? self.RecoveryIntent.authorize(entry, {
            intent: 'resend_prompt',
            reason: 'round2_repair_pre_visit',
            minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
          })
          : { ok: true };
        if (!repairIntentDecision.ok) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_SKIPPED', {
            level: 'warning',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            meta: { tabId, reason: 'repair_dispatch_pre_visit', intentDecision: repairIntentDecision },
            force: true
          });
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2 repair skipped',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            level: 'warning',
            meta: { tabId, intentDecision: repairIntentDecision }
          });
        } else {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_START', {
            level: 'warning',
            details: 'prompt not confirmed before verify visit',
            meta: { tabId, reason: 'repair_dispatch_pre_visit' }
          });
          try {
            const previousDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
            const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
            if (machine && machine.isInProgress && machine.isInProgress()) {
              machine.reset();
            }
            if (entry) {
              entry.dispatchInFlight = false;
              entry.messageSent = false;
              entry.dispatchState = 'IDLE';
              entry.csBusyUntil = 0;
            }
            await dispatchPromptToTab(llmName, tabId, jobState.prompt, jobState.attachments || [], 'round2_repair_pre_visit', {
              forceFocus: true,
              skipNoFocusProbe: true,
              deferSendMs: 250,
              skipSubmitWait: false,
              skipTypingGuard: true,
              resetStateAfterSend: false,
              recoveryIntent: 'resend_prompt'
            });
            const repairDispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || previousDispatchId || null;
            const waitBudgetMs = Math.min(
              ROUND2_REPAIR_CONFIRM_WAIT_MS,
              Math.max(0, getRound2Timing().remainingMs - ROUND2_MODEL_MIN_REMAINING_MS)
            );
            const repairWait = await waitForRound2SubmitConfirmation(llmName, repairDispatchId, waitBudgetMs);
            emitTelemetry(llmName, 'ROUND2_REPAIR_CONFIRM_WAIT', {
              level: repairWait.ok ? 'info' : 'warning',
              details: `${repairWait.waitedMs}ms:${repairWait.reason}`,
              meta: {
                tabId,
                dispatchId: repairDispatchId,
                reason: 'repair_dispatch_pre_visit',
                confirmationReason: repairWait.reason,
                waitedMs: repairWait.waitedMs,
                ok: repairWait.ok
              },
              force: true
            });
          } catch (repairErr) {
            emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_ERROR', {
              level: 'warning',
              details: repairErr?.message || String(repairErr),
              meta: { tabId, reason: 'repair_dispatch_pre_visit_error' }
            });
          }
        }
        const repairedEntry = jobState?.llms?.[llmName] || entry;
        const repairConfirmation = getRound2SubmitConfirmationState(llmName, repairedEntry?.lastDispatchMeta?.dispatchId || null);
        const delayedConfirmation = isRound2DelayedConfirmationState(repairConfirmation);
        confirmedByContent = repairConfirmation.ok || (!!repairedEntry?.promptSubmittedAt && repairedEntry?.submitSource === 'content');
        emitTelemetry(llmName, confirmedByContent ? 'ROUND2_REPAIR_DISPATCH_OK' : (delayedConfirmation ? 'ROUND2_REPAIR_DISPATCH_PENDING' : 'ROUND2_REPAIR_DISPATCH_FAIL'), {
          level: confirmedByContent || delayedConfirmation ? 'info' : 'warning',
          details: confirmedByContent
            ? 'submit/evidence confirmed after pre-visit repair'
            : (delayedConfirmation ? 'submit confirmation still pending after pre-visit repair' : 'submit still not confirmed after pre-visit repair'),
          meta: {
            tabId,
            reason: confirmedByContent
              ? 'repair_confirmed_pre_visit'
              : (delayedConfirmation ? 'repair_pending_pre_visit' : 'repair_not_confirmed_pre_visit'),
            confirmationReason: repairConfirmation.reason
          },
          force: true
        });
        if (!confirmedByContent && delayedConfirmation) {
          await scheduleRound2DelayedConfirmationContinuation(
            llmName,
            tabId,
            sessionId,
            'round2_repair_delayed_confirmation',
            repairConfirmation
          );
          endDetails = 'awaiting delayed confirmation';
          endLevel = 'info';
          endMeta.reason = 'awaiting_delayed_confirmation_after_repair';
          endMeta.confirmationReason = repairConfirmation.reason;
          continue;
        }
        if (!confirmedByContent) {
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2_VERIFY',
            details: 'prompt not confirmed after repair dispatch',
            level: 'warning',
            meta: { tabId, repairAttemptedBeforeVisit }
          });
          endDetails = 'prompt not confirmed';
          endLevel = 'warning';
          endMeta.reason = 'not_confirmed_after_repair';
          continue;
        }
        endDetails = 'prompt confirmed';
        endLevel = 'info';
        endMeta.reason = repairConfirmation.reason === 'answer_evidence'
          ? 'repair_answer_evidence_pre_visit'
          : 'repair_confirmed_pre_visit';
        const liveEntry = jobState?.llms?.[llmName];
        if (liveEntry && !isFinalizedEntry(liveEntry)) {
          await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round2_repair_precollect');
          triggerResponseCollectionPing(llmName, tabId, 'round2_repair_probe');
          schedulePostR2AutoCollect(llmName, tabId, sessionId);
          scheduleAdaptiveCollectionProbe(llmName, sessionId, {
            reason: 'round2_repair_confirmed',
            source: 'adaptive_round2'
          });
        }
        continue;
      }
      const preVisitTiming = getRound2Timing();
      if (preVisitTiming.elapsedMs > ROUND2_BATCH_MAX_MS || preVisitTiming.remainingMs <= 0) {
        endDetails = 'verification skipped (batch timeout)';
        endLevel = 'warning';
        endMeta.reason = 'batch_timeout';
        await emitRound2CutoffFrom(index + 1, preVisitTiming);
        break;
      }
      const pendingModelsCount = Math.max(1, selectedLLMs.length - index);
      const safeRemainingMs = Math.max(0, preVisitTiming.remainingMs - 1000);
      const sharedSliceMs = Math.floor(safeRemainingMs / pendingModelsCount);
      const rawPerModelVisitBudgetMs = Math.max(0, sharedSliceMs);
      if (rawPerModelVisitBudgetMs < ROUND2_MODEL_MIN_REMAINING_MS) {
        endDetails = 'verification skipped (model budget)';
        endLevel = 'warning';
        endMeta.reason = 'model_budget_timeout';
        emitTelemetry(llmName, 'ROUND2_MODEL_BUDGET_SKIP', {
          level: 'warning',
          details: `${rawPerModelVisitBudgetMs}ms`,
          meta: {
            tabId,
            perModelVisitBudgetMs: rawPerModelVisitBudgetMs,
            pendingModelsCount,
            remainingMs: preVisitTiming.remainingMs
          }
        });
        continue;
      }
      const perModelVisitBudgetMs = Math.min(ROUND2_MODEL_VISIT_BUDGET_MS, rawPerModelVisitBudgetMs);
      const visitCount = perModelVisitBudgetMs >= (ROUND2_MODEL_MIN_DWELL_MS * 2 + 1000)
        ? Math.min(ROUND2_VISIT_COUNT, 2)
        : 1;
      const perVisitBudgetMs = Math.max(ROUND2_MODEL_MIN_DWELL_MS, Math.floor(perModelVisitBudgetMs / visitCount));
      const visitMaxMs = Math.max(ROUND2_MODEL_MIN_DWELL_MS, Math.min(ROUND2_VISIT_MAX_MS, perVisitBudgetMs));
      const visitMinMs = Math.max(
        ROUND2_MODEL_MIN_DWELL_MS,
        Math.min(ROUND2_VISIT_MIN_MS, Math.floor(visitMaxMs * 0.75))
      );
      emitTelemetry(llmName, 'ROUND2_MODEL_BUDGET', {
        details: `${perModelVisitBudgetMs}ms`,
        meta: {
          tabId,
          pendingModelsCount,
          remainingMs: preVisitTiming.remainingMs,
          visitCount,
          visitMinMs,
          visitMaxMs
        }
      });

      await runForcedAutomationVisits(llmName, tabId, sessionId, {
        visits: visitCount,
        minMs: visitMinMs,
        maxMs: visitMaxMs,
        reason: 'round2_verify'
      });
      const postVisitTiming = getRound2Timing();
      if (postVisitTiming.elapsedMs > ROUND2_BATCH_MAX_MS || postVisitTiming.remainingMs <= 0) {
        endDetails = 'verification skipped (batch timeout)';
        endLevel = 'warning';
        endMeta.reason = 'batch_timeout';
        await emitRound2CutoffFrom(index + 1, postVisitTiming);
        break;
      }
      if (!confirmedByContent && !repairAttemptedBeforeVisit && ROUND2_REPAIR_MODELS.has(llmName) && jobState?.prompt) {
        const repairIntentDecision = self.RecoveryIntent?.authorize
          ? self.RecoveryIntent.authorize(entry, {
            intent: 'resend_prompt',
            reason: 'round2_repair',
            minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
          })
          : { ok: true };
        if (!repairIntentDecision.ok) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_SKIPPED', {
            level: 'warning',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            meta: { tabId, reason: 'repair_dispatch', intentDecision: repairIntentDecision },
            force: true
          });
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2 repair skipped',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            level: 'warning',
            meta: { tabId, intentDecision: repairIntentDecision }
          });
        } else {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_START', {
            level: 'warning',
            details: 'prompt not confirmed after verify visits',
            meta: { tabId, reason: 'repair_dispatch' }
          });
          try {
            const previousDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
            const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
            if (machine && machine.isInProgress && machine.isInProgress()) {
              machine.reset();
            }
            if (entry) {
              entry.dispatchInFlight = false;
              entry.messageSent = false;
              entry.dispatchState = 'IDLE';
              entry.csBusyUntil = 0;
            }
            await dispatchPromptToTab(llmName, tabId, jobState.prompt, jobState.attachments || [], 'round2_repair', {
              forceFocus: true,
              skipNoFocusProbe: true,
              deferSendMs: 500,
              skipSubmitWait: false,
              skipTypingGuard: true,
              resetStateAfterSend: false,
              recoveryIntent: 'resend_prompt'
            });
            const repairDispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || previousDispatchId || null;
            const waitBudgetMs = Math.min(
              ROUND2_REPAIR_CONFIRM_WAIT_MS,
              Math.max(0, getRound2Timing().remainingMs - ROUND2_MODEL_MIN_REMAINING_MS)
            );
            const repairWait = await waitForRound2SubmitConfirmation(llmName, repairDispatchId, waitBudgetMs);
            emitTelemetry(llmName, 'ROUND2_REPAIR_CONFIRM_WAIT', {
              level: repairWait.ok ? 'info' : 'warning',
              details: `${repairWait.waitedMs}ms:${repairWait.reason}`,
              meta: {
                tabId,
                dispatchId: repairDispatchId,
                reason: 'repair_dispatch',
                confirmationReason: repairWait.reason,
                waitedMs: repairWait.waitedMs,
                ok: repairWait.ok
              },
              force: true
            });
          } catch (repairErr) {
            emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_ERROR', {
            level: 'warning',
            details: repairErr?.message || String(repairErr),
            meta: { tabId, reason: 'repair_dispatch_error' }
            });
          }
        }
        const repairedEntry = jobState?.llms?.[llmName] || entry;
        const repairConfirmation = getRound2SubmitConfirmationState(llmName, repairedEntry?.lastDispatchMeta?.dispatchId || null);
        const delayedConfirmation = isRound2DelayedConfirmationState(repairConfirmation);
        confirmedByContent = repairConfirmation.ok || (!!repairedEntry?.promptSubmittedAt && repairedEntry?.submitSource === 'content');
        if (confirmedByContent) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_OK', {
            details: 'submit/evidence confirmed after repair dispatch',
            meta: { tabId, reason: 'repair_confirmed', confirmationReason: repairConfirmation.reason }
          });
        } else if (delayedConfirmation) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_PENDING', {
            level: 'info',
            details: 'submit confirmation still pending',
            meta: { tabId, reason: 'repair_pending', confirmationReason: repairConfirmation.reason }
          });
        } else {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_FAIL', {
            level: 'warning',
            details: 'submit still not confirmed',
            meta: { tabId, reason: 'repair_not_confirmed', confirmationReason: repairConfirmation.reason }
          });
        }
      }
      if (!confirmedByContent) {
        const delayedState = getRound2SubmitConfirmationState(llmName, entry?.lastDispatchMeta?.dispatchId || null);
        if (isRound2DelayedConfirmationState(delayedState)) {
          await scheduleRound2DelayedConfirmationContinuation(
            llmName,
            tabId,
            sessionId,
            'round2_delayed_confirmation',
            delayedState
          );
          endDetails = 'awaiting delayed confirmation';
          endLevel = 'info';
          endMeta.reason = 'awaiting_delayed_confirmation';
        } else {
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2_VERIFY',
            details: 'prompt not confirmed as sent yet',
            level: 'warning'
          });
          emitTelemetry(llmName, 'ROUND2_VERIFY', {
            details: 'prompt not confirmed',
            meta: { tabId, reason: 'not_confirmed', confirmationReason: delayedState.reason }
          });
          endDetails = 'prompt not confirmed';
          endLevel = 'warning';
          endMeta.reason = 'not_confirmed';
        }
      } else {
        endDetails = 'prompt confirmed';
        endLevel = 'info';
        endMeta.reason = 'confirmed';
      }

      const liveEntry = jobState?.llms?.[llmName];
      if (liveEntry && !isFinalizedEntry(liveEntry) && (liveEntry.promptSubmittedAt || endMeta.reason === 'awaiting_delayed_confirmation' || hasRound2SubmitOrAnswerEvidence(liveEntry))) {
        await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round2_precollect');
        triggerResponseCollectionPing(llmName, tabId, 'round2_probe');
        schedulePostR2AutoCollect(llmName, tabId, sessionId);
        scheduleAdaptiveCollectionProbe(llmName, sessionId, {
          reason: 'round2_confirmed',
          source: 'adaptive_round2'
        });
      }
    } finally {
      emitModelRoundTelemetry(llmName, 2, 'END', endDetails, {
        level: endLevel,
        meta: endMeta
      });
    }
  }
  return true;
}

//-- 2.1. Round 3: ÑÐ±Ð¾Ñ€ Ð¾Ñ‚Ð²ÐµÑ‚Ð¾Ð² Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ñ Ð½ÐµÐ·Ð°Ð²ÐµÑ€ÑˆÑ‘Ð½Ð½Ñ‹Ñ… Ð²ÐºÐ»Ð°Ð´Ð¾Ðº --//
async function dispatchRound3CollectAnswers(selectedLLMs, sessionId) {
  const terminalModels = selectedLLMs.filter((llmName) => {
    const entry = jobState?.llms?.[llmName];
    return entry && isFinalizedEntry(entry);
  });
  terminalModels.forEach((llmName) => {
    const entry = jobState?.llms?.[llmName];
    if (!entry) return;
    const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    emitModelRoundTelemetry(llmName, 3, 'START', 'skipped (already complete)', {
      level: 'info',
      meta: { tabId, reason: 'terminal' }
    });
    emitModelRoundTelemetry(llmName, 3, 'END', 'skipped (already complete)', {
      level: 'info',
      meta: { tabId, reason: 'terminal' }
    });
  });

  const incompleteModels = selectedLLMs.filter((llmName) => {
    const entry = jobState?.llms?.[llmName];
    if (!entry) return false;
    return !isFinalizedEntry(entry);
  });
  
  console.log(`[ROUND3] Collecting from ${incompleteModels.length}/${selectedLLMs.length} incomplete models`);
  emitTelemetry('ROUND3', 'COLLECTION_START', {
    details: `${incompleteModels.length} incomplete`,
    meta: { incomplete: incompleteModels, total: selectedLLMs.length }
  });
  
  for (const llmName of incompleteModels) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    
    const entry = jobState.llms[llmName];
    const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (!isValidTabId(tabId)) continue;
    
    emitModelRoundTelemetry(llmName, 3, 'START', 'collecting answer', {
      meta: { tabId }
    });
    startBudgetPhase(llmName, 'collect', null, { tabId });
    await runForcedAutomationVisits(llmName, tabId, sessionId, {
      visits: ROUND3_PRECOLLECT_VISIT_COUNT,
      minMs: ROUND3_PRECOLLECT_VISIT_MIN_MS,
      maxMs: ROUND3_PRECOLLECT_VISIT_MAX_MS,
      reason: 'round3_precollect'
    });
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) {
      emitModelRoundTelemetry(llmName, 3, 'END', 'terminal after visit', {
        meta: { tabId, reason: 'terminal_after_visit' }
      });
      endBudgetPhase(llmName, 'collect');
      continue;
    }
    await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round3_precollect');
    triggerResponseCollectionPing(llmName, tabId, 'round3_collect');
    scheduleAdaptiveCollectionProbe(llmName, sessionId, {
      reason: 'round3_collect',
      source: 'adaptive_round3'
    });
    emitModelRoundTelemetry(llmName, 3, 'END', 'collection visit', {
      meta: { tabId }
    });
    endBudgetPhase(llmName, 'collect');
  }
  
  return true;
}

//-- 3.1. Ð˜ÑÐ¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð½Ð¾Ðµ Ñ€Ð°ÑÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ: Round 0-1-2-3-4 Ñ Ð¿Ñ€Ð°Ð²Ð¸Ð»ÑŒÐ½Ñ‹Ð¼ Ð¿Ð¾Ñ€ÑÐ´ÐºÐ¾Ð¼ --//
//-- 6.1. Ð¤Ð»Ð°Ð³ Ð°ÐºÑ‚Ð¸Ð²Ð½Ð¾ÑÑ‚Ð¸ Rounds Ð´Ð»Ñ Ð·Ð°Ñ‰Ð¸Ñ‚Ñ‹ Ð¾Ñ‚ supervisor --//
async function runDispatchRounds(selectedLLMs, prompt, forceNewTabs, attachments = []) {
  try {
    const sessionId = getActiveSessionId();
    
    // Ð£ÑÑ‚Ð°Ð½Ð°Ð²Ð»Ð¸Ð²Ð°ÐµÐ¼ Ñ„Ð»Ð°Ð³ Ð°ÐºÑ‚Ð¸Ð²Ð½Ð¾ÑÑ‚Ð¸ Rounds
    if (jobState?.session) {
      jobState.session.roundsInProgress = true;
    }
    const roundMetaBase = {
      sessionId,
      totalModels: selectedLLMs.length
    };
    const emitRoundEvent = (round, phase, details = '', meta = {}) => {
      emitTelemetry('ROUNDS', `ROUND${round}_${phase}`, {
        details,
        meta: { round, ...roundMetaBase, ...meta },
        force: true
      });
    };
    
      emitRoundEvent(0, 'START', 'opening tabs sequentially');
      // Round 0: ÐŸÐ¾ÑÐ»ÐµÐ´Ð¾Ð²Ð°Ñ‚ÐµÐ»ÑŒÐ½Ð¾Ðµ Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ Ð²ÐºÐ»Ð°Ð´Ð¾Ðº (Ð¿Ð°ÑƒÐ·Ð° 2Ñ Ð¼ÐµÐ¶Ð´Ñƒ Ð²ÐºÐ»Ð°Ð´ÐºÐ°Ð¼Ð¸)
      await openTabsSequentially(selectedLLMs, prompt, forceNewTabs, attachments, sessionId);
      if (sessionId && !isSessionActive(sessionId)) return;
      emitRoundEvent(0, 'END', 'tabs opened');
      
      ensureRoundEntries(selectedLLMs, 'pre_round1');
      emitRoundEvent(1, 'START', 'dispatching prompts sequentially');
      // Round 1: ÐžÑ‚Ð¿Ñ€Ð°Ð²ÐºÐ° Ð¿Ñ€Ð¾Ð¼Ð¿Ñ‚Ð¾Ð² (3Ñ Ð²ÑÑ‚Ð°Ð²ÐºÐ° + 10Ñ Ð¾Ð¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð½Ð° ÐºÐ°Ð¶Ð´Ð¾Ð¹ Ð²ÐºÐ»Ð°Ð´ÐºÐµ)
      await dispatchRound1Sequentially(selectedLLMs, prompt, attachments, sessionId);
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(1, 'END', 'dispatch round complete');

    ensureRoundEntries(selectedLLMs, 'pre_round2');
    
    emitRoundEvent(2, 'START', 'verifying prompts');
    // Round 2: Ð’ÐµÑ€Ð¸Ñ„Ð¸ÐºÐ°Ñ†Ð¸Ñ Ð¾Ñ‚Ð¿Ñ€Ð°Ð²ÐºÐ¸ (10Ñ Ð½Ð° ÐºÐ°Ð¶Ð´Ð¾Ð¹ Ð²ÐºÐ»Ð°Ð´ÐºÐµ)
    await dispatchRound2Verification(selectedLLMs, sessionId);
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(2, 'END', 'verification complete');
    
    emitRoundEvent(3, 'START', 'collect delay');
    // Round 3: Ð¡Ð±Ð¾Ñ€ Ð¾Ñ‚Ð²ÐµÑ‚Ð¾Ð² (Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð½ÐµÐ·Ð°Ð²ÐµÑ€ÑˆÑ‘Ð½Ð½Ñ‹Ðµ Ð²ÐºÐ»Ð°Ð´ÐºÐ¸)
    await orchestratorSleepMs(ROUND3_COLLECT_DELAY_MS);
    emitRoundEvent(3, 'COLLECT_DELAY_END', 'collect delay elapsed');
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(3, 'COLLECT_START', 'collecting incomplete answers', {
      pending: selectedLLMs.length
    });
    await dispatchRound3CollectAnswers(selectedLLMs, sessionId);
    emitRoundEvent(3, 'END', 'collection complete');
    if (sessionId && !isSessionActive(sessionId)) return;

    const trackedModels = resolveRoundModelNames(selectedLLMs);
    const pendingBeforeGate = getPendingRoundModels(trackedModels);
    emitRoundEvent(4, 'GATE_START', 'waiting pending models', {
      pendingModels: pendingBeforeGate
    });
    const gateResult = await waitForRound4Gate(trackedModels, sessionId);
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(4, 'GATE_END', gateResult.timedOut ? 'gate timeout forced finalization' : 'all models finalized', {
      pendingBefore: gateResult.pendingBefore || [],
      pendingAfter: gateResult.pendingAfter || [],
      timedOut: !!gateResult.timedOut
    });

    const pendingAfterGate = getPendingRoundModels(trackedModels);
    if (pendingAfterGate.length) {
      emitRoundEvent(4, 'SKIP', 'results focus skipped (pending models remain)', {
        pendingModels: pendingAfterGate
      });
    } else {
      emitRoundEvent(4, 'START', 'focusing results tab');
      selectedLLMs.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        emitModelRoundTelemetry(
          llmName,
          4,
          'START',
          isFinalizedEntry(entry) ? 'skipped (already complete)' : 'focusing results tab',
          { meta: { reason: isFinalizedEntry(entry) ? 'terminal' : 'results_focus' } }
        );
      });
      await orchestratorSleepMs(ROUND4_FOCUS_DELAY_MS);
      await openOrFocusResultsTab().catch(() => {});
      selectedLLMs.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        emitModelRoundTelemetry(
          llmName,
          4,
          'END',
          isFinalizedEntry(entry) ? 'skipped (already complete)' : 'results tab focused',
          { meta: { reason: isFinalizedEntry(entry) ? 'terminal' : 'results_focus' } }
        );
      });
      emitRoundEvent(4, 'END', 'results tab focused');
    }
    
    // Ð—Ð°Ð¿ÑƒÑÐºÐ°ÐµÐ¼ supervisor Ð¸ human presence ÐŸÐžÐ¡Ð›Ð• Ð²ÑÐµÑ… rounds
    schedulePromptDispatchSupervisor();
    if (hasPendingHumanVisits()) {
      scheduleHumanPresenceLoop(true);
    }
    
    //-- 5.1. Ð”Ð¸Ð°Ð³Ð½Ð¾ÑÑ‚Ð¸ÐºÐ°: Ð¿Ñ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ð¿Ñ€Ð¾Ð¿ÑƒÑ‰ÐµÐ½Ð½Ñ‹Ðµ Ð¼Ð¾Ð´ÐµÐ»Ð¸ --//
    let missingModelsTimer = null;
    missingModelsTimer = registerSessionTimer(setTimeout(() => {
      deregisterSessionTimer(missingModelsTimer);
      if (sessionId && !isSessionActive(sessionId)) return;
      if (!jobState?.llms || !Array.isArray(selectedLLMs) || !selectedLLMs.length) return;
      ensureRoundEntries(selectedLLMs, 'post_round_integrity_check');
      const allModels = selectedLLMs;
      const activeModels = Object.keys(jobState?.llms || {});
      const missingModels = allModels.filter(name => !activeModels.includes(name));
      
      if (missingModels.length > 0) {
        console.error(`[ROUNDS] Missing models detected: ${missingModels.join(', ')}`);
        const integritySnapshot = (() => {
          const bindings = {};
          Object.keys(jobState?.llms || {}).forEach((name) => {
            const entry = jobState.llms[name] || {};
            bindings[name] = {
              tabId: entry.tabId || null,
              status: entry.status || null,
              dispatchId: entry?.lastDispatchMeta?.dispatchId || null
            };
          });
          return {
            runSessionId: jobState?.session?.startTime || null,
            roundsInProgress: !!jobState?.session?.roundsInProgress,
            promptLength: String(jobState?.prompt || '').length,
            bindings,
            sessionTimers: sessionTimers?.size || 0
          };
        })();
        missingModels.forEach(llmName => {
          emitTelemetry(llmName, 'MODEL_MISSING', {
            level: 'error',
            details: 'Model not found in jobState after rounds',
            meta: { allModels, activeModels, missingModels, snapshot: integritySnapshot }
          });
          
          // ÐŸÑ‹Ñ‚Ð°ÐµÐ¼ÑÑ Ð²Ð¾ÑÑÑ‚Ð°Ð½Ð¾Ð²Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð¿ÑƒÑ‰ÐµÐ½Ð½ÑƒÑŽ Ð¼Ð¾Ð´ÐµÐ»ÑŒ
          if (!jobState.llms[llmName]) {
            jobState.llms[llmName] = buildInitialLlmEntry(llmName, {
              status: 'RECOVERY_PENDING'
            });
            
            // Ð—Ð°Ð¿ÑƒÑÐºÐ°ÐµÐ¼ Ð²Ð¾ÑÑÑ‚Ð°Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ðµ
            //-- 1.1. Recovery НЕ создаёт новые вкладки --//
            startModelForLLM(llmName, prompt, false, attachments, { 
              sessionId: getActiveSessionId() 
            }).catch(err => {
              console.error(`[RECOVERY] Failed to recover ${llmName}:`, err);
            });
          }
        });
      }
    }, 5000)); // ÐŸÑ€Ð¾Ð²ÐµÑ€ÐºÐ° Ñ‡ÐµÑ€ÐµÐ· 5 ÑÐµÐºÑƒÐ½Ð´ Ð¿Ð¾ÑÐ»Ðµ Ð·Ð°Ð²ÐµÑ€ÑˆÐµÐ½Ð¸Ñ rounds


  } catch (err) {
    console.error('[BACKGROUND] Round sequencing failed:', err);
    schedulePromptDispatchSupervisor();
  } finally {
    //-- 6.2. Ð¡Ð½Ð¸Ð¼Ð°ÐµÐ¼ Ñ„Ð»Ð°Ð³ Ð°ÐºÑ‚Ð¸Ð²Ð½Ð¾ÑÑ‚Ð¸ Rounds --//
    if (jobState?.session) {
      jobState.session.roundsInProgress = false;
    }
  }
}

function collectResponses() {
  console.log('[BACKGROUND] Collecting responses');
  Object.keys(jobState.llms).forEach(llmName => {
    const entry = jobState.llms[llmName];
    const flags = self.getDispatchFlags ? self.getDispatchFlags(llmName, entry) : null;
    const alreadySent = flags ? flags.isSent : !!entry.messageSent;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (boundTabId && !alreadySent) {
      dispatchPromptToTab(llmName, boundTabId, jobState.prompt, jobState.attachments || [], 'collect_responses');
    }
  });
  broadcastHumanVisitStatus();
  if (hasPendingHumanVisits()) {
    scheduleHumanPresenceLoop(true);
  }
}

async function collectResponsesStaged() {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://chat.openai.com/*', 'https://chatgpt.com/*', 'https://claude.ai/*',
      'https://gemini.google.com/*', 'https://grok.com/*', 'https://chat.deepseek.com/*',
      'https://www.perplexity.ai/*', 'https://chat.qwen.ai/*', 'https://chat.mistral.ai/*'
    ], audible: false });
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeId = active?.[0]?.id;
    const foreground = tabs.filter(t => t.id === activeId);
    const background = tabs.filter(t => t.id !== activeId);

    const inferLlmNameForCollectTab = (tab) => {
      if (!tab?.id) return null;
      const mapped = TabMapManager.getNameByTabId(tab.id);
      if (mapped) return mapped;
      return Object.keys(LLM_TARGETS || {}).find((name) => isEligibleTabForLlm(name, tab)) || null;
    };
    const results = [];
    const collectOne = async (tab) => {
      const tabId = tab?.id || null;
      const llmName = inferLlmNameForCollectTab(tab);
      if (!tabId || !llmName) {
        return { tabId, platform: 'unknown', text: '', error: 'llm_not_resolved' };
      }
      const meta = {
        source: 'collect_responses_staged_late_collect',
        runSessionId: getCurrentRunSessionId(),
        sessionId: getCurrentRunSessionId(),
        dispatchId: resolveLateCollectDispatchId(llmName),
        responseMeta: {
          source: 'collect_responses_staged_late_collect',
          completionReason: 'user_collect_late_collect',
          lateCollectFinal: true,
          forceTerminalSuccess: true
        }
      };
      const result = await lateCollectAnswer({
        llmName,
        tabId,
        reason: 'collect_responses_staged',
        meta
      });
      if (result?.ok && result.text) {
        acceptLateCollectResult(llmName, result, meta);
        return {
          tabId,
          platform: llmName,
          sessionId: meta.sessionId,
          text: result.text,
          source: result.source || 'late_collect',
          status: result.status || 'success'
        };
      }
      return {
        tabId,
        platform: llmName,
        sessionId: meta.sessionId,
        text: '',
        error: result?.reason || result?.status || 'late_collect_failed'
      };
    };

    for (const t of foreground) {
      if (t.id) results.push(await collectOne(t));
    }
    const bgPromises = background.filter(t => t.id).map(t => collectOne(t));
    const bgResults = await Promise.all(bgPromises);
    results.push(...bgResults);
    return results;
  } catch (err) {
    console.warn('[BACKGROUND] collectResponsesStaged failed', err);
    return [];
  }
}

function resolveModelFinalStatus(finalStatus, finalReason, error) {
  const normalized = String(finalStatus || '').toUpperCase();
  const errorType = error?.type || finalReason;
  if (errorType === 'user_cancel') return 'CANCELLED';
  if (normalized === 'SUCCESS') return 'SUCCESS';
  if (['PARTIAL', 'STREAM_TIMEOUT', 'STREAM_TIMEOUT_HIDDEN'].includes(normalized)) return 'PARTIAL';
  return 'ERROR';
}

function resolveModelDoneReason({ completionReason, finalStatus, finalReason, error }) {
  const errorType = error?.type || finalReason || null;
  if (errorType === 'user_cancel') return 'user_cancel';
  const normalizedFinal = String(finalStatus || '').toLowerCase();
  if (['stream_timeout', 'stream_timeout_hidden'].includes(normalizedFinal)) return 'timeout';
  const reason = completionReason ? String(completionReason).toLowerCase() : '';
  if (['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete'].includes(reason)) {
    return 'timeout';
  }
  if (['content_mutation_stable', 'score_threshold', 'criteria_met'].includes(reason)) {
    return 'stabilization';
  }
  if (['regenerate_visible', 'completion_signal', 'stop_disappeared'].includes(reason)) {
    return 'ui';
  }
  if (reason === 'hard_stop') return 'user_cancel';
  if (errorType) return 'error';
  return 'unknown';
}

function classifyFailure(error = null, context = {}) {
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const explicitClass = String(responseMeta.failureClass || context.failureClass || '').trim().toLowerCase();
  const allowedClasses = new Set(['transport', 'lease_lifecycle', 'page_readiness', 'dispatch', 'generation', 'extraction', 'semantic', 'unknown']);
  const rawType = String(error?.type || context.errorType || context.finalReason || '').trim();
  const type = rawType.toLowerCase();
  const message = String(error?.message || context.message || '').toLowerCase();
  const reason = String(context.finalReason || responseMeta.completionReason || responseMeta.answerReason || '').toLowerCase();
  const source = String(responseMeta.source || responseMeta.answerSource || context.responseSource || '').toLowerCase();
  const haystack = [type, message, reason, source].filter(Boolean).join(' ');
  const result = (failureClass, recoveryFirst = true, terminalRequiresEvidenceMiss = true) => ({
    class: failureClass,
    type: rawType || null,
    reason: context.finalReason || error?.message || rawType || null,
    source: responseMeta.source || responseMeta.answerSource || context.responseSource || null,
    recoveryFirst: !!recoveryFirst,
    terminalRequiresEvidenceMiss: !!terminalRequiresEvidenceMiss
  });

  if (explicitClass && allowedClasses.has(explicitClass)) {
    return result(explicitClass, explicitClass !== 'semantic', true);
  }
  if (!error && context.isSuccess) return result('unknown', false, false);
  if (!error && !rawType && !haystack) return result('unknown', false, false);

  if (
    /transport|message_channel|message channel|message port|port closed|receiving end|connection|could not establish|ping_transport|runtime\.lasterror/.test(haystack)
  ) {
    return result('transport', true, true);
  }
  if (
    /script_runtime_hard_stop|background-force-stop|force_stop|tab_closed|tab closed|lifecycle|concurrent_request|request already running/.test(haystack)
  ) {
    return result('lease_lifecycle', true, true);
  }
  if (
    /wrong_page|page_ready|page readiness|login|required_login|captcha|tab_not_ready|ack_timeout|handshake_timeout|script_not_ready/.test(haystack)
  ) {
    return result('page_readiness', true, true);
  }
  if (
    /send_failed|no_send|submit_timeout|prompt_submit|prompt_submitted_timeout|dispatch_error|dispatch_send|tab reference|tab not found|circuit_open/.test(haystack)
  ) {
    return result('dispatch', true, true);
  }
  if (
    /hard_timeout|soft_timeout|stream_start_timeout|streaming_incomplete|generation|busy|stop_visible|content_growing/.test(haystack)
  ) {
    return result('generation', true, true);
  }
  if (
    /extract_failed|empty_answer|answer_element_missing|no_answer_extracted|selector|late_collect_failed|answer_missing/.test(haystack)
  ) {
    return result('extraction', true, true);
  }
  if (
    /answer_prompt_echo|prompt_echo|status text|non-answer|rate_limit|rate limit|policy|blocked|semantic/.test(haystack)
  ) {
    return result('semantic', false, true);
  }
  return result('unknown', true, true);
}

function deriveFailureFinalStatus(error = null, sendConfirmed = null, failure = null) {
  const type = String(error?.type || failure?.type || '').toLowerCase();
  const failureClass = String(failure?.class || '').toLowerCase();
  if (sendConfirmed === false) return 'NO_SEND';
  if (type === 'send_failed' || type === 'no_send') return 'NO_SEND';
  if (failureClass === 'dispatch' && /send|submit|dispatch|no_send/.test(type)) return type === 'no_send' || /send|submit/.test(type) ? 'NO_SEND' : 'ERROR';
  if (['extract_failed', 'empty_answer', 'answer_element_missing', 'answer_prompt_echo'].includes(type)) return 'EXTRACT_FAILED';
  if (['extraction', 'semantic'].includes(failureClass) && !/^rate_limit|captcha/.test(type)) return 'EXTRACT_FAILED';
  if (type === 'stream_start_timeout') return 'STREAM_TIMEOUT';
  if (failureClass === 'generation' && /stream_start_timeout/.test(type)) return 'STREAM_TIMEOUT';
  return 'ERROR';
}


function normalizeEvidenceText(value = '') {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hashEvidenceText(value = '') {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isPromptEchoAnswerCandidate(answerText = '', promptText = '') {
  const answer = normalizeEvidenceText(answerText);
  const prompt = normalizeEvidenceText(promptText);
  if (!answer || !prompt || prompt.length < 80) return false;
  if (answer === prompt) return true;
  if (answer.includes(prompt) && answer.length <= prompt.length + 180) return true;
  const promptHead = prompt.slice(0, Math.min(prompt.length, 240));
  if (promptHead.length >= 80 && answer.startsWith(promptHead)) return true;
  const limit = Math.min(prompt.length, answer.length);
  let overlap = 0;
  for (let i = 0; i < limit; i += 1) {
    if (answer[i] !== prompt[i]) break;
    overlap += 1;
  }
  return overlap >= Math.min(limit, Math.floor(prompt.length * 0.9));
}

function buildAnswerCandidate(llmName, entry, context = {}) {
  const text = String(context.trimmedAnswer || context.answer || '').trim();
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const metaObj = context.metaObj && typeof context.metaObj === 'object' ? context.metaObj : {};
  const dispatchId = context.dispatchId || metaObj.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  return {
    llmName,
    text,
    html: String(context.normalizedHtml || context.answerHtml || ''),
    length: text.length,
    hash: text ? hashEvidenceText(text) : null,
    status: String(context.finalStatus || '').toUpperCase(),
    reason: context.finalReason || null,
    source: responseMeta?.source || responseMeta?.answerSource || context.responseSource || null,
    dispatchId,
    tabId: entry?.tabId || null,
    runSessionId: jobState?.session?.startTime || null,
    manualRecovery: Boolean(metaObj.manualRecovery || responseMeta.manualRecovery || responseMeta.manualOverride),
    preFinalRecovery: Boolean(metaObj.preTerminalMaterializeFinal || metaObj.preTerminalMaterialize || responseMeta.preTerminalMaterialize),
    promptEcho: isPromptEchoAnswerCandidate(text, jobState?.prompt || ''),
    answerEvidence: context.answerEvidence || responseMeta.answerEvidence || null,
    createdAt: Date.now()
  };
}

function evaluateAnswerCandidate(llmName, entry, candidate = {}, context = {}) {
  const evidence = buildFinalizationEvidence(llmName, entry, {
    ...context,
    trimmedAnswer: candidate.text || context.trimmedAnswer || '',
    finalStatus: candidate.status || context.finalStatus,
    finalReason: candidate.reason || context.finalReason,
    responseSource: candidate.source || context.responseSource
  });
  return {
    candidate,
    evidence,
    accepted: !!evidence.accepted,
    rejectionReasons: evidence.accepted ? [] : (evidence.contradictions || ['candidate_rejected'])
  };
}

function submitAnswerCandidate(llmName, entry, candidate = {}, context = {}) {
  const evaluation = evaluateAnswerCandidate(llmName, entry, candidate, context);
  if (entry) {
    entry.lastAnswerCandidate = {
      llmName,
      status: candidate.status || null,
      reason: candidate.reason || null,
      source: candidate.source || null,
      dispatchId: candidate.dispatchId || null,
      tabId: candidate.tabId || null,
      length: candidate.length || 0,
      hash: candidate.hash || null,
      promptEcho: !!candidate.promptEcho,
      answerEvidence: candidate.answerEvidence || context.answerEvidence || null,
      accepted: !!evaluation.accepted,
      rejectionReasons: evaluation.rejectionReasons,
      createdAt: candidate.createdAt || Date.now()
    };
  }
  const candidateStatus = String(candidate.status || context.finalStatus || '').toUpperCase();
  const transition = evaluation.accepted
    ? (FAILURE_STATUSES.includes(candidateStatus) ? 'TERMINAL_FAILURE' : 'ANSWER_CANDIDATE_ACCEPTED')
    : 'ANSWER_CANDIDATE_REJECTED';
  if (entry && (self.commitModelRunTransition || self.ModelRunState?.applyModelRunTransition)) {
    const payload = {
      status: candidate.status || context.finalStatus,
      reason: candidate.reason || context.finalReason,
      answerLength: candidate.length || 0,
      answerHash: candidate.hash || null,
      dispatchId: candidate.dispatchId || null,
      tabId: candidate.tabId || null,
      runSessionId: candidate.runSessionId || jobState?.session?.startTime || null,
      manualRecovery: !!candidate.manualRecovery,
      allowTerminalUpgrade: !!context.allowTerminalUpgrade,
      source: candidate.source || context.responseSource || 'submitAnswerCandidate'
    };
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, transition, payload);
    } else {
      self.ModelRunState.applyModelRunTransition(entry, transition, payload);
    }
  }
  return evaluation;
}

function buildFinalizationEvidence(llmName, entry, context = {}) {
  const answerText = String(context.trimmedAnswer || '').trim();
  const error = context.error || null;
  const finalStatus = String(context.finalStatus || '').toUpperCase();
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const failureClassification = context.failureClassification && typeof context.failureClassification === 'object'
    ? context.failureClassification
    : classifyFailure(context.error || null, {
      responseMeta,
      responseSource: context.responseSource || null,
      finalReason: context.finalReason || null,
      isSuccess: SUCCESS_STATUSES.includes(String(context.finalStatus || '').toUpperCase())
    });
  const dispatchId = context.dispatchId || context.metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const promptSubmittedAt = Number(entry?.promptSubmittedAt || 0) || null;
  const lastDispatchAt = Number(entry?.lastDispatchAt || 0) || null;
  const lifecycleReadyAt = Number(entry?.lifecycleReadyAt || entry?.answerCompleteDetectedAt || 0) || null;
  const source = responseMeta?.source || responseMeta?.answerSource || context.responseSource || null;
  const answerEvidence = context.answerEvidence || responseMeta?.answerEvidence || (self.AnswerEvidence?.buildAnswerEvidence?.({
    llmName,
    text: answerText,
    html: context.normalizedHtml || '',
    source,
    responseMeta,
    dispatchId,
    tabId: entry?.tabId || null,
    promptConfirmed: context.sendConfirmed,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS,
    stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
  }) || null);
  const evidencePolicy = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(answerEvidence, {
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || { ok: false };
  const answerLength = answerText.length;
  const promptEcho = isPromptEchoAnswerCandidate(answerText, jobState?.prompt || '');
  const hasAcceptedAnswer = answerLength >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS && !promptEcho && !error;
  const hasPriorAnswer = String(entry?.answer || '').trim().length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS;
  const hasPendingFinalAnswer = String(entry?.pendingFinalAnswer || '').trim().length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS;
  const hasAnswerEvidence = hasAcceptedAnswer
    || hasPriorAnswer
    || hasPendingFinalAnswer
    || lifecycleReadyAt
    || Number(entry?.answerCompleteTextLength || 0) >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS;
  const preFinalRecovery = Boolean(context.metaObj?.preTerminalMaterializeFinal || context.metaObj?.preTerminalMaterialize || responseMeta?.preTerminalMaterialize);
  const manualRecovery = Boolean(context.metaObj?.manualRecovery || responseMeta?.manualRecovery || responseMeta?.manualOverride);
  const terminalFailure = FAILURE_STATUSES.includes(finalStatus);
  const success = SUCCESS_STATUSES.includes(finalStatus);
  const contradictions = [];
  if (promptEcho) contradictions.push('prompt_echo_candidate');
  if (terminalFailure && hasAnswerEvidence && !manualRecovery) {
    contradictions.push(preFinalRecovery
      ? 'failure_with_answer_evidence_after_prefinal_recovery'
      : 'failure_with_answer_evidence_without_prefinal_recovery');
  }
  if (finalStatus === 'NO_SEND' && promptSubmittedAt) contradictions.push('no_send_after_prompt_submitted');
  if (finalStatus === 'EXTRACT_FAILED' && lifecycleReadyAt) contradictions.push('extract_failed_after_lifecycle_ready');
  return {
    llmName,
    finalStatus,
    finalReason: context.finalReason || null,
    modelFinalStatus: context.modelFinalStatus || null,
    doneReason: context.doneReason || null,
    dispatchId,
    tabId: entry?.tabId || null,
    source,
    answerLength,
    answerHash: answerLength ? hashEvidenceText(answerText) : null,
    promptEcho,
    hasAcceptedAnswer,
    hasPriorAnswer,
    hasPendingFinalAnswer,
    hasAnswerEvidence: !!hasAnswerEvidence,
    answerEvidence,
    evidencePolicy,
    terminalEligible: !!answerEvidence?.terminalEligible,
    terminalEligibleReason: answerEvidence?.reason || null,
    promptSubmittedAt,
    lastDispatchAt,
    lifecycleReadyAt,
    answerCompleteTextLength: Number(entry?.answerCompleteTextLength || entry?.lifecycleReadyMeta?.textLength || 0) || null,
    sendConfirmed: context.sendConfirmed ?? null,
    completionReason: context.completionReason || null,
    errorType: error?.type || null,
    errorMessage: error?.message || null,
    failureClass: failureClassification?.class || null,
    failureRecoveryFirst: failureClassification?.recoveryFirst ?? null,
    terminalRequiresEvidenceMiss: failureClassification?.terminalRequiresEvidenceMiss ?? null,
    preFinalRecovery,
    manualRecovery,
    terminalFailure,
    success,
    contradictions,
    accepted: contradictions.length === 0 || manualRecovery
  };
}

function shouldInferSubmitFromAnswerEvidence(llmName, entry, context = {}) {
  if (llmName !== 'Qwen') return false;
  if (!entry || entry.promptSubmittedAt) return false;
  const answerText = String(context.trimmedAnswer || '').trim();
  if (answerText.length < DOM_SNAPSHOT_RECOVERY_MIN_CHARS) return false;
  if (/^error\s*:/i.test(answerText)) return false;
  if (isPromptEchoAnswerCandidate(answerText, jobState?.prompt || '')) return false;
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const metaObj = context.metaObj && typeof context.metaObj === 'object' ? context.metaObj : {};
  const source = String(responseMeta.source || responseMeta.answerSource || context.responseSource || metaObj.source || '').toLowerCase();
  const status = String(entry.status || entry.finalStatus || '').toUpperCase();
  return Boolean(
    responseMeta.recovered
    || responseMeta.lateCollectFinal
    || responseMeta.forceTerminalSuccess
    || responseMeta.preTerminalMaterialize
    || metaObj.preTerminalMaterialize
    || metaObj.materializeLatestEvidence
    || source.includes('late_collect')
    || source.includes('materialize')
    || source.includes('snapshot')
    || source.includes('inline_executescript')
    || status === 'NO_SEND'
    || status === 'RECOVERABLE_ERROR'
  );
}

function inferPromptSubmittedFromAnswerEvidence(llmName, entry, context = {}) {
  if (!shouldInferSubmitFromAnswerEvidence(llmName, entry, context)) return false;
  const now = Date.now();
  const metaObj = context.metaObj && typeof context.metaObj === 'object' ? context.metaObj : {};
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const dispatchId = metaObj.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const answerText = String(context.trimmedAnswer || '').trim();
  entry.promptSubmittedAt = now;
  entry.lastRuntimeActivityAt = now;
  entry.lastRuntimeActivitySource = 'answer_evidence_submit_inferred';
  entry.awaitingSubmitConfirmation = false;
  entry.awaitingSubmitConfirmationAt = null;
  entry.awaitingSubmitConfirmationDispatchId = null;
  entry.confirmedDispatchId = dispatchId || entry.confirmedDispatchId || null;
  entry.submitSource = 'inferred_answer_evidence';
  entry.submitConfirmedBy = responseMeta.source || responseMeta.answerSource || metaObj.source || 'answer_evidence';
  entry.submitInferredFromAnswerHash = hashEvidenceText(answerText);
  appendLogEntry(llmName, {
    type: 'DISPATCH',
    label: 'Submit confirmation inferred from answer evidence',
    details: `source=${entry.submitConfirmedBy}`,
    level: 'success',
    meta: {
      dispatchId,
      answerLength: answerText.length,
      answerHash: entry.submitInferredFromAnswerHash,
      source: entry.submitConfirmedBy
    }
  });
  emitTelemetry(llmName, 'PROMPT_SUBMITTED_INFERRED', {
    level: 'success',
    details: 'answer_evidence',
    meta: {
      dispatchId,
      submitSource: entry.submitSource,
      source: entry.submitConfirmedBy,
      answerLength: answerText.length,
      answerHash: entry.submitInferredFromAnswerHash
    },
    force: true
  });
  resolvePromptSubmitted(llmName, {
    ok: true,
    ts: entry.promptSubmittedAt,
    inferred: true,
    meta: metaObj,
    dispatchId
  });
  return true;
}

function recordModelRunState(llmName, entry, evidence = {}) {
  if (!entry) return;
  const status = String(evidence.finalStatus || entry.status || '').toUpperCase();
  const legacyState = {
    executionStatus: evidence.success ? 'finalized_success' : (evidence.terminalFailure ? 'finalized_failure' : 'running'),
    generationStatus: evidence.lifecycleReadyAt ? 'complete' : (evidence.completionReason || 'unknown'),
    answerStatus: evidence.promptEcho ? 'rejected_prompt_echo' : (evidence.hasAcceptedAnswer ? 'accepted' : (evidence.hasAnswerEvidence ? 'candidate' : 'none')),
    uiStatus: status || null,
    dispatchId: evidence.dispatchId || null,
    updatedAt: Date.now()
  };
  if (self.commitModelRunTransition || self.ModelRunState?.applyModelRunTransition) {
    const transition = evidence.accepted
      ? (evidence.terminalFailure ? 'TERMINAL_FAILURE' : 'ANSWER_CANDIDATE_ACCEPTED')
      : 'ANSWER_CANDIDATE_REJECTED';
    const payload = {
      status,
      reason: evidence.finalReason || null,
      answerLength: evidence.answerLength || 0,
      answerHash: evidence.answerHash || null,
      dispatchId: evidence.dispatchId || null,
      tabId: evidence.tabId || null,
      runSessionId: jobState?.session?.startTime || null,
      manualRecovery: !!evidence.manualRecovery,
      source: 'recordModelRunState'
    };
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, transition, payload);
    } else {
      self.ModelRunState.applyModelRunTransition(entry, transition, payload);
    }
    entry.modelRunState = {
      ...(entry.modelRunState || {}),
      ...legacyState,
      executionState: entry.modelRunState?.executionState || legacyState.executionStatus,
      generationState: entry.modelRunState?.generationState || legacyState.generationStatus,
      answerState: entry.modelRunState?.answerState || legacyState.answerStatus,
      terminalStatus: entry.modelRunState?.terminalStatus || (evidence.success || evidence.terminalFailure ? status : null),
      terminalState: entry.modelRunState?.terminalState || (evidence.success ? 'success' : (evidence.terminalFailure ? 'failure' : 'open'))
    };
    return;
  }
  entry.modelRunState = legacyState;
}

function emitFinalizationDecision(llmName, evidence = {}) {
  emitTelemetry(llmName, 'FINALIZATION_DECISION', {
    level: evidence.accepted ? (evidence.terminalFailure ? 'warning' : 'success') : 'warning',
    details: `${evidence.finalStatus || 'UNKNOWN'}:${evidence.accepted ? 'accepted' : 'blocked'}`,
    meta: {
      finalStatus: evidence.finalStatus || null,
      finalReason: evidence.finalReason || null,
      modelFinalStatus: evidence.modelFinalStatus || null,
      doneReason: evidence.doneReason || null,
      dispatchId: evidence.dispatchId || null,
      tabId: evidence.tabId || null,
      source: evidence.source || null,
      answerLength: evidence.answerLength || 0,
      answerHash: evidence.answerHash || null,
      promptEcho: !!evidence.promptEcho,
      hasAcceptedAnswer: !!evidence.hasAcceptedAnswer,
      hasPriorAnswer: !!evidence.hasPriorAnswer,
      hasPendingFinalAnswer: !!evidence.hasPendingFinalAnswer,
      hasAnswerEvidence: !!evidence.hasAnswerEvidence,
      promptSubmittedAt: evidence.promptSubmittedAt || null,
      lifecycleReadyAt: evidence.lifecycleReadyAt || null,
      answerCompleteTextLength: evidence.answerCompleteTextLength || null,
      sendConfirmed: evidence.sendConfirmed,
      completionReason: evidence.completionReason || null,
      errorType: evidence.errorType || null,
      preFinalRecovery: !!evidence.preFinalRecovery,
      manualRecovery: !!evidence.manualRecovery,
      contradictions: evidence.contradictions || [],
      accepted: !!evidence.accepted
    },
    force: true
  });
}

function getTerminalRank(status) {
  if (self.LLMStatusContract && typeof self.LLMStatusContract.getStatusRank === 'function') {
    return self.LLMStatusContract.getStatusRank(status);
  }
  return 0;
}

function handleLLMResponse(llmName, answer, error = null, meta = null, answerHtml = '') {
  if (!jobState?.llms || typeof llmName !== 'string') {
    console.error('[BACKGROUND] Invalid state for response:', llmName);
    return;
  }
  const resolvedName = (() => {
    if (jobState.llms[llmName]) return llmName;
    const trimmed = llmName.trim();
    if (jobState.llms[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    const match = Object.keys(jobState.llms).find((key) => key && key.toLowerCase() === lower);
    return match || llmName;
  })();
  if (resolvedName !== llmName) {
    console.warn(`[BACKGROUND] Normalized llmName "${llmName}" -> "${resolvedName}"`);
  }
  llmName = resolvedName;

  const entry = jobState.llms?.[llmName];
  const metaObj = meta && typeof meta === 'object' ? meta : null;
  const earlyResponseMeta = (() => {
    if (!metaObj || typeof metaObj !== 'object') return {};
    const merged = {};
    [metaObj.response, metaObj.responseMeta, metaObj.answerMeta, metaObj.pipelineMeta].forEach((candidate) => {
      if (candidate && typeof candidate === 'object') Object.assign(merged, candidate);
    });
    return merged;
  })();
  const earlyAnswerText = (() => {
    if (answer && typeof answer === 'object') return String(answer.text || answer.answer || '');
    return typeof answer === 'string' ? answer : String(answer ?? '');
  })().trim();
  const earlyIsSuccess = !error && !!earlyAnswerText && !/^error\s*:/i.test(earlyAnswerText);
  const earlyFailureClassification = earlyIsSuccess
    ? null
    : classifyFailure(error, {
      responseMeta: earlyResponseMeta,
      responseSource: earlyResponseMeta?.source || metaObj?.source || null
    });
  const earlyFinalStatus = earlyIsSuccess
    ? (earlyResponseMeta?.partial ? 'PARTIAL' : 'SUCCESS')
    : deriveFailureFinalStatus(error, null, earlyFailureClassification);
  const earlySource = String(earlyResponseMeta?.source || metaObj?.source || '').toLowerCase();
  const allowRecoveredFinalOverride = Boolean(
    earlyIsSuccess
    && (
      metaObj?.manualRecovery
      || metaObj?.preTerminalMaterialize
      || metaObj?.preTerminalMaterializeFinal
      || metaObj?.materializeLatestEvidence
      || earlyResponseMeta?.manualRecovery
      || earlyResponseMeta?.manualOverride
      || earlyResponseMeta?.preTerminalMaterialize
      || earlyResponseMeta?.recovered
      || earlyResponseMeta?.forceTerminalSuccess
      || earlyResponseMeta?.lateCollectFinal
      || earlySource.includes('late_collect')
      || earlySource.includes('materialize')
      || earlySource.includes('snapshot')
    )
  );
  const pipelineControl = getActivePipelineControlState();
  const incomingPipelineRunId = metaObj?.pipelineRunId || metaObj?.runSessionId || jobState?.session?.pipelineRunId || pipelineControl?.pipelineRunId || null;
  const incomingTabSessionId = metaObj?.tabSessionId || metaObj?.responseMeta?.tabSessionId || metaObj?.pipelineTabSessionId || null;
  if (entry && metaObj) {
    const expectedSessionId = Number(jobState?.session?.startTime || 0) || null;
    const incomingSessionId = metaObj?.sessionId ? Number(metaObj.sessionId) : null;
    const incomingDispatchId = typeof metaObj?.dispatchId === 'string' ? metaObj.dispatchId : null;
    const identityDecision = self.RunIdentity?.validateEvent
      ? self.RunIdentity.validateEvent(entry, {
        sessionId: incomingSessionId,
        runSessionId: metaObj?.runSessionId || incomingSessionId,
        dispatchId: incomingDispatchId,
        tabId: metaObj?.tabId || metaObj?.responseMeta?.tabId || null
      }, {
        runSessionId: expectedSessionId,
        tabId: entry?.tabId || null
      })
      : { ok: true, reason: 'legacy_no_run_identity' };
    entry.lastRunIdentityDecision = {
      ...identityDecision,
      decidedAt: Date.now()
    };
    if (!identityDecision.ok) {
      self.DecisionLedger?.append?.(entry, {
        decision: 'ignore_stale_event',
        reason: identityDecision.reason || 'stale_event',
        source: 'handleLLMResponse',
        inputs: { identityDecision },
        resultingState: entry.finalStatus || entry.status || 'open'
      });
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response ignored (stale identity)',
        details: identityDecision.reason || 'stale_event',
        level: 'warning',
        meta: { identityDecision }
      });
      emitTelemetry(llmName, 'STALE_EVENT_QUARANTINED', {
        level: 'warning',
        details: identityDecision.reason || 'stale_event',
        meta: { identityDecision },
        force: true
      });
      return;
    }
  }
  if (self.PipelineFSM?.shouldAcceptEvent) {
    const acceptance = self.PipelineFSM.shouldAcceptEvent(pipelineControl, {
      pipelineRunId: incomingPipelineRunId,
      llmName,
      dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
      tabSessionId: incomingTabSessionId,
      kind: 'final',
      finalStatus: earlyFinalStatus,
      allowRecoveredFinal: allowRecoveredFinalOverride
    });
    if (!acceptance.ok) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response ignored (pipeline control)',
        details: acceptance.reason || 'pipeline_control_reject',
        level: 'warning',
        meta: {
          pipelineRunId: incomingPipelineRunId || null,
          dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
          reason: acceptance.reason || null
        }
      });
      return;
    }
  }
  if (entry && typeof self.markModelRuntimeActivity === 'function') {
    self.markModelRuntimeActivity(llmName, Date.now(), 'llm_response');
  }

  const responseMeta = (() => {
    if (!metaObj || typeof metaObj !== 'object') return {};
    const merged = {};
    const candidates = [
      metaObj.response,
      metaObj.responseMeta,
      metaObj.answerMeta,
      metaObj.pipelineMeta
    ];
    candidates.forEach((candidate) => {
      if (candidate && typeof candidate === 'object') {
        Object.assign(merged, candidate);
      }
    });
    return merged;
  })();
  const answerMeta = responseMeta?.answer && typeof responseMeta.answer === 'object' ? responseMeta.answer : null;
  const sanityWarnings = Array.isArray(responseMeta?.sanityWarnings) ? responseMeta.sanityWarnings : [];
  const sanityConfidence = typeof responseMeta?.sanityConfidence === 'number' ? responseMeta.sanityConfidence : null;
  const completionReasonRaw = responseMeta?.completionReason || responseMeta?.answerReason || answerMeta?.reason || null;
  const completionReason = completionReasonRaw ? String(completionReasonRaw).toLowerCase() : null;
  const hardStopReason = responseMeta?.hardStopReason || answerMeta?.hardStopReason || null;
  const sendConfirmed = typeof responseMeta?.sendConfirmed === 'boolean'
    ? responseMeta.sendConfirmed
    : (typeof responseMeta?.confirmed === 'boolean' ? responseMeta.confirmed : null);
  const sendMethod = responseMeta?.sendMethod || responseMeta?.method || null;
  const responseSource = responseMeta?.source || responseMeta?.answerSource || null;
  const failureClassification = classifyFailure(error, {
    responseMeta,
    responseSource,
    sendConfirmed,
    finalReason: error?.type || error?.message || null,
    isSuccess: false
  });
  const manualTerminalOverrideRequested = Boolean(
    metaObj?.manualRecovery
    || responseMeta?.manualRecovery
    || responseMeta?.manualOverride
  );

  if (error?.type === 'concurrent_request') {
    const now = Date.now();
    const busyForMs = 60000;
    if (entry) {
      entry.csBusyUntil = now + busyForMs;
      saveJobState(jobState);
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Request already running (content)',
      details: error?.message || String(answer || ''),
      level: 'warning'
    });
    broadcastDiagnostic(llmName, {
      type: 'DISPATCH',
      label: 'Request already running (content)',
      details: `${busyForMs}ms`,
      level: 'warning'
    });
    resolvePromptSubmitted(llmName, { ok: false, busy: true, ts: now, meta: metaObj });
    return;
  }

  if (error && (error.type === 'rate_limit' || error.type === 'captcha_detected')) {
    console.log(`[API-FALLBACK] Triggered for ${llmName} due to error: ${error.type}`);
    if (error.type === 'rate_limit') {
      setRateLimit(llmName, 60000, error?.message);
    }
    executeApiFallback(llmName, jobState.prompt)
      .then((started) => {
        if (!started) {
          handleLLMResponse(
            llmName,
            answer || `Error: ${error?.message || 'API fallback unavailable'}`,
            { type: 'fallback_unavailable' },
            meta
          );
        }
      })
      .catch((fallbackError) => {
        console.error('[API-FALLBACK] Failed to execute fallback:', fallbackError);
        handleLLMResponse(llmName, `Error: ${fallbackError?.message || 'API fallback failed'}`, { type: 'fallback_failed' }, meta);
      });
    return;
  }
  closePingWindowForLLM(llmName);
  clearPostSuccessScrollAudit(llmName);
  let normalizedAnswer = '';
  let normalizedHtml = '';
  if (answer && typeof answer === 'object') {
    normalizedAnswer = String(answer.text || answer.answer || '');
    normalizedHtml = String(answer.html || answer.answerHtml || answerHtml || '');
  } else {
    normalizedAnswer = typeof answer === 'string' ? answer : (answer ?? '');
    normalizedHtml = typeof answerHtml === 'string' ? answerHtml : '';
  }
  let trimmedAnswer = String(normalizedAnswer || '').trim();
  if (!error && !trimmedAnswer) {
    error = { type: 'empty_answer', message: 'Empty answer received from content script' };
    normalizedAnswer = 'Error: Empty answer received';
    trimmedAnswer = String(normalizedAnswer || '').trim();
  }
  if (!error && trimmedAnswer && isPromptEchoAnswerCandidate(trimmedAnswer, jobState?.prompt || '')) {
    emitTelemetry(llmName, 'ANSWER_SANITY_REJECTED', {
      level: 'warning',
      details: 'prompt_echo_candidate',
      meta: {
        reason: 'prompt_echo_candidate',
        answerLength: trimmedAnswer.length,
        answerHash: hashEvidenceText(trimmedAnswer),
        promptLength: String(jobState?.prompt || '').length,
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: responseSource || null
      },
      force: true
    });
    error = { type: 'answer_prompt_echo', message: 'Extracted answer matches original prompt' };
    normalizedAnswer = 'Error: Extracted answer matches original prompt';
    normalizedHtml = '';
    trimmedAnswer = String(normalizedAnswer || '').trim();
  }
  //- 1.1. Fix Claude: Если текст ответа получен (>50 символов), считаем это частичным успехом, а не фатальной ошибкой -//
  const hasAnswerContent = trimmedAnswer.length > 50;
  const isClaude = llmName.toLowerCase().includes('claude');
  const hardTimeoutLike = Boolean(
    (error?.type === 'hard_timeout'
      || completionReason === 'hard_timeout'
      || getRecentPipelineErrorReason(entry).includes('hard_timeout'))
    && error?.type !== 'hard_timeout_retry_exhausted'
  );
  if (isClaude && entry && hardTimeoutLike && !hasAnswerContent) {
    if (!entry.hardTimeoutRetryDone) {
      const sessionId = jobState?.session?.startTime || null;
      if (scheduleClaudeHardTimeoutRetry(llmName, entry, metaObj, sessionId)) {
        appendLogEntry(llmName, {
          type: 'PIPELINE',
          label: 'PIPELINE_ERROR (degraded)',
          details: 'hard_timeout',
          level: 'warning',
          meta: { degraded: true, degradedReason: 'hard_timeout', retry: 'scheduled' }
        });
        emitTelemetry(llmName, 'PIPELINE_ERROR', {
          level: 'warning',
          details: 'hard_timeout',
          meta: { degraded: true, degradedReason: 'hard_timeout', retry: 'scheduled' }
        });
        updateModelState(llmName, 'RECOVERABLE_ERROR', {
          message: 'hard_timeout_retry_scheduled',
          degradedReason: 'hard_timeout'
        });
        return;
      }
    } else if (entry.hardTimeoutRetryInFlight) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response deferred (retry in flight)',
        details: 'hard_timeout',
        level: 'warning'
      });
      return;
    }
  }
  const isSuccess = !error && !!String(normalizedAnswer || '').trim() && !normalizedAnswer.startsWith('Error:');
  const answerEvidence = self.AnswerEvidence?.buildAnswerEvidence?.({
    llmName,
    text: trimmedAnswer,
    html: normalizedHtml,
    source: responseSource || metaObj?.source || null,
    responseMeta,
    dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
    tabId: entry?.tabId || null,
    promptConfirmed: sendConfirmed,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS,
    stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
  }) || null;
  const answerEvidencePolicy = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(answerEvidence, {
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || { ok: false };
  const allowManualTerminalOverride = Boolean(manualTerminalOverrideRequested && isSuccess && trimmedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS);
  if (isSuccess && entry) {
    inferPromptSubmittedFromAnswerEvidence(llmName, entry, {
      trimmedAnswer,
      responseMeta,
      responseSource,
      metaObj
    });
  }
  if (isSuccess && maybeDeferStreamingFinalization(llmName, normalizedAnswer, metaObj, normalizedHtml, normalizedAnswer)) {
    return;
  }
  if (isSuccess && entry && (entry.hardTimeoutRetryInFlight || entry.hardTimeoutRetryDone)) {
    clearClaudeRetryTimers(llmName);
    entry.hardTimeoutRetryInFlight = false;
  }
  if (!isSuccess) {
    normalizedHtml = '';
  }
  const partialSignals = new Set(['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete']);
  const MIN_PARTIAL_ANSWER_LENGTH = 120;
  const hasPartialWarnings = sanityWarnings.some((warning) =>
    ['streaming_active', 'content_growing', 'hard_timeout'].includes(String(warning || '').toLowerCase())
  );
  const completionSuggestsPartial = completionReason && partialSignals.has(completionReason);
  const shortAnswer = trimmedAnswer.length > 0 && trimmedAnswer.length < MIN_PARTIAL_ANSWER_LENGTH;
  const fullSnapshotCompletionEvidence = hasFullSnapshotCompletionEvidence(
    entry,
    trimmedAnswer.length,
    completionReason,
    responseSource
  );
  const isPartial = Boolean(
    (responseMeta?.partial && !fullSnapshotCompletionEvidence)
    || responseMeta?.degraded
    || (completionSuggestsPartial && (shortAnswer || trimmedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS))
    || (answerEvidencePolicy.ok && answerEvidence?.partialAllowed)
    || hasPartialWarnings
    || (typeof sanityConfidence === 'number' && sanityConfidence < 0.7)
  );
  const streamTimeoutHidden = completionReason === 'hard_timeout' && hardStopReason === 'hidden';
  let finalStatus = 'ERROR';
  let finalReason = null;
  if (isSuccess) {
    finalStatus = isPartial ? (streamTimeoutHidden ? 'STREAM_TIMEOUT_HIDDEN' : 'PARTIAL') : 'SUCCESS';
    const normalizedReason = (!isPartial && completionSuggestsPartial) ? 'ok' : completionReason;
    finalReason = normalizedReason || (isPartial ? 'partial' : 'ok');
  } else {
    finalStatus = deriveFailureFinalStatus(error, sendConfirmed, failureClassification);
    finalReason = error?.type || error?.message || 'error';
  }

  if (
    isSuccess
    && finalStatus === 'SUCCESS'
    && !manualTerminalOverrideRequested
    && maybeDeferEarlyTerminalSuccess(llmName, entry, {
      trimmedAnswer,
      normalizedAnswer,
      normalizedHtml,
      responseSource,
      completionReason,
      metaObj,
      sendConfirmed
    })
  ) {
    return;
  }

  const isHardStopError = String(error?.type || finalReason || '').toLowerCase() === 'script_runtime_hard_stop';
  const incomingDispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const hardStopDeferWindowMs = resolveHardStopDeferWindowMs(llmName);
  if (
    entry
    && isHardStopError
    && !metaObj?.hardStopDeferredRetry
    && !entry.finalStatusRecorded
  ) {
    const now = Date.now();
    const lastRuntimeActivityAt = Number(entry.lastRuntimeActivityAt || 0);
    const hasRecentRuntime = lastRuntimeActivityAt > 0 && (now - lastRuntimeActivityAt) <= HARD_STOP_ACTIVITY_GRACE_MS;
    const hasTransportSignal = Number(entry.pingTransportErrorCount || 0) >= 2;
    const alreadyDeferred = Number(entry.hardStopDeferredAt || 0) > 0
      && String(entry.hardStopDeferredDispatchId || '') === String(incomingDispatchId || '');
    if (!alreadyDeferred && (hasRecentRuntime || hasTransportSignal)) {
      entry.hardStopDeferredAt = now;
      entry.hardStopDeferredDispatchId = incomingDispatchId || null;
      updateModelState(llmName, 'RECOVERABLE_ERROR', {
        message: 'script_runtime_hard_stop_deferred',
        deferredMs: hardStopDeferWindowMs
      });
      emitTelemetry(llmName, 'HARD_STOP_DEFERRED', {
        level: 'warning',
        details: `${hardStopDeferWindowMs}ms`,
        meta: {
          dispatchId: incomingDispatchId,
          hasRecentRuntime,
          hasTransportSignal,
          lastRuntimeActivityAt,
          pingTransportErrorCount: Number(entry.pingTransportErrorCount || 0)
        },
        force: true
      });
      const deferredTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      if (isValidTabId(deferredTabId)) {
        triggerResponseCollectionPing(llmName, deferredTabId, 'hard_stop_deferred');
      }
      const deferredSessionId = getActiveSessionId();
      registerSessionTimer(setTimeout(async () => {
        const liveEntry = jobState?.llms?.[llmName];
        if (!liveEntry || liveEntry.finalStatusRecorded) return;
        if (String(liveEntry.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
        const canRunRecovery = HARD_STOP_DEFER_RECOVERY_MODELS.has(llmName) && isValidTabId(liveTabId);
        if (canRunRecovery) {
          emitTelemetry(llmName, 'HARD_STOP_DEFERRED_RECOVERY_START', {
            level: 'warning',
            details: 'deferred_hard_stop_recovery',
            meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
          });
          try {
            await runForcedAutomationVisits(llmName, liveTabId, deferredSessionId, {
              visits: 1,
              minMs: HARD_STOP_DEFER_RECOVERY_VISIT_MIN_MS,
              maxMs: HARD_STOP_DEFER_RECOVERY_VISIT_MAX_MS,
              reason: 'hard_stop_deferred_recovery'
            });
            triggerResponseCollectionPing(llmName, liveTabId, 'hard_stop_deferred_recovery');
            await orchestratorSleepMs(1200);
            const afterRecovery = jobState?.llms?.[llmName];
            if (!afterRecovery || afterRecovery.finalStatusRecorded) return;
            triggerResponseCollectionPing(llmName, liveTabId, 'hard_stop_deferred_recovery_followup');
            await orchestratorSleepMs(900);
            const afterFollowup = jobState?.llms?.[llmName];
            if (!afterFollowup || afterFollowup.finalStatusRecorded) return;
            emitTelemetry(llmName, 'HARD_STOP_DEFERRED_RECOVERY_END', {
              level: 'warning',
              details: 'recovery_exhausted_without_terminal',
              meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
            });
          } catch (recoveryErr) {
            emitTelemetry(llmName, 'HARD_STOP_DEFERRED_RECOVERY_ERROR', {
              level: 'warning',
              details: recoveryErr?.message || String(recoveryErr),
              meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
            });
          }
        }
        const retryEntry = jobState?.llms?.[llmName];
        if (!retryEntry || retryEntry.finalStatusRecorded) return;
        if (String(retryEntry.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        if (isValidTabId(liveTabId)) {
          emitTelemetry(llmName, 'HARD_STOP_DEFERRED_FINAL_PING', {
            level: 'warning',
            details: 'final_ping_before_error',
            meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
          });
          triggerResponseCollectionPing(llmName, liveTabId, 'hard_stop_deferred_final_ping', {
            allowRecovery: true,
            maxAttempts: 4,
            baseDelay: 700,
            transportRetryDelays: HARD_STOP_PING_RETRY_DELAYS_MS
          });
          await orchestratorSleepMs(1400);
        }
        const afterFinalPing = jobState?.llms?.[llmName];
        if (!afterFinalPing || afterFinalPing.finalStatusRecorded) return;
        if (String(afterFinalPing.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        if (isValidTabId(liveTabId) && typeof self.recoverAnswerViaDomSnapshot === 'function') {
          const recovered = await self.recoverAnswerViaDomSnapshot(llmName, liveTabId, 'hard_stop_deferred_final_snapshot', {
            dispatchId: incomingDispatchId || null,
            hardStopDeferredRetry: true
          });
          if (recovered) return;
        }
        const afterSnapshotRecovery = jobState?.llms?.[llmName];
        if (!afterSnapshotRecovery || afterSnapshotRecovery.finalStatusRecorded) return;
        if (String(afterSnapshotRecovery.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        handleLLMResponse(
          llmName,
          `Error: script_runtime_hard_stop_deferred_${hardStopDeferWindowMs}ms`,
          { type: 'script_runtime_hard_stop', message: `Timed out after deferred window ${hardStopDeferWindowMs}ms` },
          {
            ...(metaObj || {}),
            dispatchId: incomingDispatchId || null,
            sessionId: deferredSessionId || undefined,
            runSessionId: deferredSessionId || undefined,
            hardStopDeferredRetry: true
          },
          ''
        );
      }, hardStopDeferWindowMs));
      return;
    }
  }

  if (maybeDeferTerminalFailureForMaterialization(
    llmName,
    entry,
    finalStatus,
    finalReason,
    error,
    metaObj,
    normalizedAnswer,
    normalizedHtml
  )) {
    return;
  }

  const lockedFinalStatus = String(entry?.finalStatus || '').toUpperCase();
  const incomingStatus = String(finalStatus || '').toUpperCase();
  const lockedRank = getTerminalRank(lockedFinalStatus);
  const incomingRank = getTerminalRank(incomingStatus);
  let allowTerminalUpgrade = false;
  const finalizationController = self.FinalizationController;
  const finalizationControl = finalizationController?.tryFinalize
    ? finalizationController.tryFinalize(entry || {}, {
      finalStatus,
      dispatchId: incomingDispatchId,
      trimmedAnswer,
      allowManualTerminalOverride,
      allowRecoveredFinalOverride
    })
    : { ok: true, action: 'accept', reason: 'legacy_no_finalization_controller', allowTerminalUpgrade: false };
  if (entry) {
    entry.finalizationControllerDecision = {
      action: finalizationControl.action || null,
      reason: finalizationControl.reason || null,
      incomingStatus,
      lockedFinalStatus,
      incomingRank,
      lockedRank,
      dispatchId: incomingDispatchId || null,
      decidedAt: Date.now()
    };
    self.DecisionLedger?.append?.(entry, {
      decision: finalizationControl.ok
        ? (finalizationControl.allowTerminalUpgrade ? 'upgrade_terminal' : (isSuccess ? 'accept_success' : 'finalize_error'))
        : (finalizationControl.reason === 'duplicate_terminal' ? 'ignore_duplicate_final' : 'reject_final_candidate'),
      reason: finalizationControl.reason || null,
      source: 'FinalizationController',
      inputs: {
        finalizationControl,
        finalStatus,
        incomingDispatchId
      },
      resultingState: finalizationControl.finalStatusOverride || finalStatus
    });
  }
  if (finalizationControl.action === 'keep_locked_status') {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Manual response kept terminal status',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'info',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        lockedRank,
        incomingRank,
        dispatchId: incomingDispatchId
      }
    });
    finalStatus = finalizationControl.finalStatusOverride || lockedFinalStatus;
    finalReason = `manual_recovery_kept_${lockedFinalStatus.toLowerCase()}`;
  }
  if (!finalizationControl.ok && finalizationControl.reason === 'terminal_success_locked') {
    const staleDispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
    if (typeof self.clearScriptRuntimeHardStop === 'function') {
      self.clearScriptRuntimeHardStop(llmName, staleDispatchId || null);
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (terminal success locked)',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: staleDispatchId
      }
    });
    return;
  }
  if (!finalizationControl.ok && finalizationControl.reason === 'terminal_rank_downgrade') {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (terminal rank downgrade)',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        lockedRank,
        incomingRank,
        dispatchId: incomingDispatchId
      }
    });
    return;
  }
  if (finalizationControl.reason === 'terminal_failure_upgraded_by_recovered_answer') {
    allowTerminalUpgrade = true;
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal failure upgraded by recovered answer evidence',
      details: `${lockedFinalStatus} -> ${incomingStatus}`,
      level: 'success',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: incomingDispatchId,
        recoverySource: responseSource || null
      }
    });
  } else if (finalizationControl.reason === 'terminal_rank_upgrade') {
    allowTerminalUpgrade = true;
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal status upgraded',
      details: `${lockedFinalStatus} -> ${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        lockedRank,
        incomingRank,
        dispatchId: incomingDispatchId
      }
    });
  }
  if (!finalizationControl.ok && finalizationControl.reason === 'duplicate_terminal') {
    const lockedDispatchId = finalizationControl.lockedDispatchId || entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null;
    if (typeof self.clearScriptRuntimeHardStop === 'function') {
      self.clearScriptRuntimeHardStop(llmName, incomingDispatchId || lockedDispatchId || null);
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (duplicate terminal)',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: incomingDispatchId || lockedDispatchId || null,
        finalizationController: finalizationControl
      }
    });
    return;
  }
  if (!finalizationControl.ok) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (finalization controller)',
      details: finalizationControl.reason || 'finalization_rejected',
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: incomingDispatchId || null,
        finalizationController: finalizationControl
      }
    });
    return;
  }

  const modelFinalStatus = resolveModelFinalStatus(finalStatus, finalReason, error);
  const doneReason = resolveModelDoneReason({ completionReason, finalStatus, finalReason, error });
  const answerCandidate = buildAnswerCandidate(llmName, entry, {
    trimmedAnswer,
    normalizedHtml,
    finalStatus,
    finalReason,
    metaObj,
    responseMeta,
    responseSource
    , answerEvidence
  });
  const answerEvaluation = submitAnswerCandidate(llmName, entry, answerCandidate, {
    finalStatus,
    finalReason,
    modelFinalStatus,
    doneReason,
    error,
    metaObj,
    responseMeta,
    responseSource,
    trimmedAnswer,
    answerEvidence,
    sendConfirmed,
    completionReason,
    failureClassification: isSuccess ? null : failureClassification,
    allowTerminalUpgrade
  });
  const finalizationEvidence = answerEvaluation.evidence;
  recordModelRunState(llmName, entry, finalizationEvidence);
  if (entry) {
    entry.finalizationEvidence = finalizationEvidence;
  }
  emitFinalizationDecision(llmName, finalizationEvidence);

  if (finalizationEvidence.terminalFailure && !finalizationEvidence.accepted) {
    const preservedAnswer = String(entry?.answer || entry?.pendingFinalAnswer || '').trim();
    const preservedHtml = String(entry?.answerHtml || entry?.pendingFinalAnswerHtml || '');
    emitTelemetry(llmName, 'TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE', {
      level: preservedAnswer ? 'success' : 'warning',
      details: `${finalStatus}:${finalizationEvidence.contradictions.join(',') || 'answer_evidence'}`,
      meta: {
        finalStatus,
        finalReason,
        dispatchId: incomingDispatchId,
        hasPriorAnswer: !!finalizationEvidence.hasPriorAnswer,
        hasPendingFinalAnswer: !!finalizationEvidence.hasPendingFinalAnswer,
        hasAnswerEvidence: !!finalizationEvidence.hasAnswerEvidence,
        preservedAnswerLength: preservedAnswer.length,
        contradictions: finalizationEvidence.contradictions
      },
      force: true
    });
    if (preservedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS) {
      handleLLMResponse(
        llmName,
        preservedAnswer,
        null,
        {
          ...(metaObj || {}),
          responseMeta: {
            ...(responseMeta || {}),
            source: 'terminal_failure_blocked_by_answer_evidence',
            completionReason: 'preserved_answer_evidence',
            recoveredFromStatus: finalStatus
          }
        },
        preservedHtml
      );
      return;
    }
    updateModelState(llmName, 'RECOVERABLE_ERROR', {
      message: `terminal_failure_blocked_${String(finalStatus || '').toLowerCase()}`,
      originalStatus: finalStatus
    });
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal failure blocked by answer evidence',
      details: finalizationEvidence.contradictions.join(',') || finalStatus,
      level: 'warning',
      meta: { finalizationEvidence }
    });
    saveJobState(jobState);
    broadcastGlobalState();
    return;
  }

  console.log(`[BACKGROUND] Handling response from ${llmName}. Success: ${isSuccess}`);
  appendLogEntry(llmName, {
    type: 'RESPONSE',
    label: isSuccess
      ? (isPartial ? 'Answer received (partial)' : 'Answer received')
      : 'Response error',
    details: isSuccess ? '' : (error?.message || normalizedAnswer),
    level: isSuccess ? (isPartial ? 'warning' : 'success') : 'error',
    meta: {
      reason: finalReason,
      status: finalStatus,
      sendConfirmed,
      sendMethod,
      responseSource,
      completionReason,
      hardStopReason,
      sanityWarnings,
      sanityConfidence,
      failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
      failureRecoveryFirst: isSuccess ? null : !!failureClassification?.recoveryFirst,
      terminalRequiresEvidenceMiss: isSuccess ? null : !!failureClassification?.terminalRequiresEvidenceMiss,
      finalizationEvidence
    }
  });
  updateModelState(llmName, finalStatus, {
    message: finalReason || '',
    completionReason,
    hardStopReason,
    failureClass: isSuccess ? null : failureClassification?.class || 'unknown'
  });
  clearBudgetPhases(llmName);
  clearAdaptiveCollectTimer(llmName);
  const answerLen = trimmedAnswer.length;
  const durationMs = entry?.lastDispatchAt ? Math.max(0, Date.now() - entry.lastDispatchAt) : null;
  const provider = entry?.provider || entry?.apiProvider || entry?.modelProvider || llmName;
  const focusSwitchesUsed = Number(entry?.focusSwitches || 0);
  const foregroundMsUsed = Number(entry?.humanVisitTotalMs || 0);
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const tabId = entry?.tabId || null;
  if (typeof self.clearScriptRuntimeHardStop === 'function') {
    self.clearScriptRuntimeHardStop(llmName, dispatchId || null);
  }
  if (self.PipelineFSM?.markFinal) {
    const control = jobState?.session?.pipelineControl || getActivePipelineControlState();
    const finalControl = self.PipelineFSM.markFinal(control, {
      llmName,
      dispatchId,
      tabSessionId: incomingTabSessionId || null,
      pipelineRunId: incomingPipelineRunId || null,
      finalStatus,
      reason: finalReason,
      sessionId: jobState?.session?.startTime || null
    });
    if (finalControl?.ok && finalControl.state) {
      persistPipelineControlState(finalControl.state);
    }
  }
  const finalEmitKey = `${modelFinalStatus}::${doneReason || ''}::${dispatchId || ''}`;
  const finalEmitAt = Number(entry?.lastFinalEmittedAt || 0);
  let skipModelFinalEmit = false;
  if (
    entry
    && entry.lastFinalEmitKey === finalEmitKey
    && finalEmitAt > 0
    && (Date.now() - finalEmitAt) < MODEL_FINAL_DEDUP_WINDOW_MS
  ) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'MODEL_FINAL ignored (deduplicated)',
      details: `window=${MODEL_FINAL_DEDUP_WINDOW_MS}ms key=${finalEmitKey}`,
      level: 'warning',
      meta: {
        dispatchId,
        modelFinalStatus,
        doneReason
      }
    });
    skipModelFinalEmit = true;
  } else if (entry) {
    entry.lastFinalEmitKey = finalEmitKey;
    entry.lastFinalEmittedAt = Date.now();
  }
  if (!skipModelFinalEmit) {
    emitTelemetry(llmName, 'MODEL_FINAL', {
      level: modelFinalStatus === 'ERROR' ? 'error' : (modelFinalStatus === 'PARTIAL' ? 'warning' : 'success'),
      meta: {
        status: modelFinalStatus,
        doneReason,
        durationMs,
        answerLen,
        provider,
        focusSwitchesUsed,
        foregroundMsUsed,
        completionReason,
        finalStatus,
        finalReason,
        dispatchId,
        tabId,
        finalizationEvidence
      },
      force: true
    });
  }
  sendMessageToResultsTab({
    type: 'LLM_PARTIAL_RESPONSE',
    llmName,
    answer: normalizedAnswer,
    answerHtml: normalizedHtml,
    requestId: entry?.requestId || jobState?.llms?.[llmName]?.requestId || null,
    metadata: {
      status: finalStatus,
      reason: finalReason,
      completionReason,
      hardStopReason,
      failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
      failureRecoveryFirst: isSuccess ? null : !!failureClassification?.recoveryFirst,
      terminalRequiresEvidenceMiss: isSuccess ? null : !!failureClassification?.terminalRequiresEvidenceMiss,
      finalizationEvidence
    },
    logs: getLogSnapshot(llmName)
  });

  const alreadyFinalized = entry?.finalStatusRecorded && entry?.finalizedAt && entry?.finalStatus;
  if (entry) {
    const projectedResponseMeta = isSuccess ? responseMeta : {
      ...(responseMeta || {}),
      failureClass: failureClassification?.class || 'unknown',
      failureType: failureClassification?.type || error?.type || null,
      failureRecoveryFirst: !!failureClassification?.recoveryFirst,
      terminalRequiresEvidenceMiss: !!failureClassification?.terminalRequiresEvidenceMiss
    };
    const finalProjection = {
      earlyTerminalGuard: null,
      earlyTerminalGuardNextPingAt: 0,
      responseMeta: projectedResponseMeta
    };
    if (!alreadyFinalized || allowTerminalUpgrade || allowManualTerminalOverride) {
      finalProjection.answer = normalizedAnswer;
      finalProjection.answerHtml = normalizedHtml;
      finalProjection.status = finalStatus;
      finalProjection.statusReason = finalReason;
    } else {
      const lockedStatus = String(entry.finalStatus || entry.status || 'ERROR').toUpperCase();
      finalProjection.status = lockedStatus;
      finalProjection.statusReason = entry.statusReason || 'terminal_locked';
    }
    if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN') {
      finalProjection.hardStopDeferredAt = 0;
      finalProjection.hardStopDeferredDispatchId = null;
    } else if (metaObj?.hardStopDeferredRetry || !isHardStopError) {
      finalProjection.hardStopDeferredAt = 0;
      finalProjection.hardStopDeferredDispatchId = null;
    }
    if (!alreadyFinalized || allowTerminalUpgrade || allowManualTerminalOverride) {
      finalProjection.finalStatusRecorded = true;
      finalProjection.finalizedAt = Date.now();
      finalProjection.finalStatus = finalStatus;
    }
    if (self.commitModelRunTransition || self.ModelRunState?.applyModelRunTransition) {
      const finalTransition = FAILURE_STATUSES.includes(finalStatus)
        ? 'TERMINAL_FAILURE'
        : 'ANSWER_CANDIDATE_ACCEPTED';
      const finalPayload = {
        status: finalStatus,
        reason: finalReason,
        answerLength: trimmedAnswer.length,
        answerHash: trimmedAnswer.length ? hashEvidenceText(trimmedAnswer) : null,
        dispatchId,
        tabId,
        runSessionId: jobState?.session?.startTime || null,
        manualRecovery: allowManualTerminalOverride,
        allowTerminalUpgrade,
        failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
        failureType: isSuccess ? null : failureClassification?.type || error?.type || null,
        source: 'handleLLMResponse_final_projection'
      };
      if (self.commitModelRunTransition) {
        self.commitModelRunTransition(llmName, entry, finalTransition, finalPayload);
      } else {
        self.ModelRunState.applyModelRunTransition(entry, finalTransition, finalPayload);
      }
    } else if (self.ModelRunState?.deriveModelRunState) {
      entry.modelRunState = self.ModelRunState.deriveModelRunState(entry);
    }
    if (typeof self.projectModelRunStateToLegacy === 'function') {
      self.projectModelRunStateToLegacy(llmName, entry, finalProjection, 'handleLLMResponse_final_projection');
    } else {
      Object.assign(entry, finalProjection);
      entry.statusContract = self.LLMStatusContract?.deriveStatusContract
        ? self.LLMStatusContract.deriveStatusContract(entry)
        : null;
    }
  }

  const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
  if (machine) {
    const states = self.DISPATCH_STATES || {};
    if (machine.is(states.IDLE)) {
      machine.queue({
        prompt: jobState?.prompt,
        attachments: jobState?.attachments || [],
        dispatchId: metaObj?.dispatchId || `${llmName}:${Date.now()}`
      });
    }
    if (machine.is(states.QUEUED)) {
      const boundTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      machine.activate({ tabId: boundTabId, inferred: true });
    }
    if (machine.is(states.ACTIVATING)) {
      machine.ready({ inferred: true });
    }
    if (machine.is(states.TYPING)) {
      machine.submit({ inferred: true });
    }
    if (machine.is(states.SUBMITTING)) {
      machine.sent({ inferred: true });
      if (entry && !entry.submitSource) {
        entry.submitSource = 'inferred';
      }
    }
    if (machine.is(states.WAITING) || machine.is(states.STREAMING)) {
      if (isSuccess) {
        machine.complete({ response: normalizedAnswer, responseHtml: normalizedHtml });
      } else {
        machine.error({ error: error?.message || normalizedAnswer, code: finalReason || finalStatus });
      }
    }
  }

  if (self.DispatchCircuit) {
    if (isSuccess) {
      self.DispatchCircuit.recordDispatchSuccess(llmName);
    } else {
      self.DispatchCircuit.recordDispatchFailure(llmName, {
        type: error?.type || finalReason || finalStatus || 'error',
        failureClass: failureClassification?.class || 'unknown',
        message: error?.message || ''
      });
    }
  }

  if (!alreadyFinalized) {
    if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN') {
      jobState.responsesCollected += 1;
      jobState.session.completed += 1;
    } else {
      jobState.session.failed += 1;
    }
  } else if (allowTerminalUpgrade) {
    const wasSuccessLike = ['SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(lockedFinalStatus);
    const nowSuccessLike = ['SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(finalStatus);
    if (!wasSuccessLike && nowSuccessLike) {
      jobState.responsesCollected += 1;
      jobState.session.completed += 1;
      jobState.session.failed = Math.max(0, Number(jobState.session.failed || 0) - 1);
    } else if (wasSuccessLike && !nowSuccessLike) {
      jobState.responsesCollected = Math.max(0, Number(jobState.responsesCollected || 0) - 1);
      jobState.session.completed = Math.max(0, Number(jobState.session.completed || 0) - 1);
      jobState.session.failed += 1;
    }
  }

  jobState.session.completed = Math.min(jobState.session.totalModels, jobState.session.completed);
  jobState.session.failed = Math.min(jobState.session.totalModels, jobState.session.failed);

  if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN') {
    if (typeof self.completeHumanPresenceForModel === 'function') {
      self.completeHumanPresenceForModel(llmName, 'terminal_success');
    }
    if (typeof self.downgradePipelineHardTimeoutLogs === 'function') {
      self.downgradePipelineHardTimeoutLogs(llmName);
    }
    if (typeof self.downgradePipelineHardTimeoutStorage === 'function') {
      self.downgradePipelineHardTimeoutStorage(llmName);
    }
  }

  emitTelemetry(llmName, 'RESPONSE', {
    details: finalStatus,
    meta: {
      status: finalStatus,
      reason: finalReason,
      completionReason,
      sendConfirmed,
      sendMethod,
      responseSource,
      partial: isPartial,
      sanityWarnings,
      sanityConfidence
    }
  });

  broadcastDiagnostic(llmName, {
    type: 'FINAL_STATUS',
    label: finalStatus,
    details: finalReason,
    level: finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN' ? 'success' : 'warning'
  });

  saveJobState(jobState);
  broadcastGlobalState();
  broadcastHumanVisitStatus();

  if (jobState.responsesCollected >= jobState.session.totalModels) {
    if (jobState.session.runSummaryEmitted) return;
    jobState.session.completedAt = Date.now();
    const totalModels = jobState.session.totalModels || 0;
    const completed = jobState.session.completed || 0;
    const failed = jobState.session.failed || 0;
    const stalled = Object.entries(jobState.llms || {})
      .filter(([_, entry]) => entry && !isFinalizedEntry(entry))
      .map(([name]) => name);
    const durationMs = jobState.session.completedAt - (jobState.session.startTime || jobState.session.completedAt);
    const successRate = totalModels ? Math.round((completed / totalModels) * 100) : 0;
    const errorDistribution = {};
    Object.entries(jobState.llms || {}).forEach(([name, entry]) => {
      const status = entry?.status || 'UNKNOWN';
      errorDistribution[status] = (errorDistribution[status] || 0) + 1;
    });
    const runMetrics = self.ModelRunState?.buildRunMetrics ? self.ModelRunState.buildRunMetrics(jobState) : null;
    if (runMetrics) {
      jobState.session.runMetrics = runMetrics;
    }
    const roundDurations = jobState.session.roundDurations || {};
    const avgRoundTimes = {};
    Object.keys(roundDurations).forEach((round) => {
      const vals = roundDurations[round] || [];
      if (!vals.length) return;
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      avgRoundTimes[`round${round}`] = avg;
    });
    emitTelemetry('ROUNDS', 'RUN_SUMMARY', {
      meta: {
        runSessionId: jobState.session.startTime || null,
        totalModels,
        completed,
        failed,
        stalledModels: stalled,
        successRate,
        durationMs,
        runMetrics,
        avgRoundTimes,
        errorDistribution
      },
      force: true
    });
    jobState.session.runSummaryEmitted = true;
    saveJobState(jobState);
    broadcastGlobalState();
  }
}

const generateRequestId = () => `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function initRequestMetadata(llmName, tabId, initialUrl = '') {
  if (!llmName) return null;
  const existingId = jobState?.llms?.[llmName]?.requestId || llmRequestMap[llmName];
  if (existingId) {
    return persistRequestMetadata(llmName, {
      tabId: tabId || null,
      url: initialUrl || '',
      requestId: existingId
    });
  }
  const requestId = generateRequestId();
  llmRequestMap[llmName] = requestId;
  if (jobState?.llms?.[llmName]) {
    jobState.llms[llmName].requestId = requestId;
  }
  const snapshot = {
    requestId,
    llmName,
    tabId: tabId || null,
    createdAt: Date.now(),
    url: initialUrl || '',
    completedAt: null
  };
  jobMetadata.set(requestId, snapshot);
  sendMessageToResultsTab({
    type: 'LLM_JOB_CREATED',
    requestId,
    llmName,
    metadata: {
      url: snapshot.url,
      createdAt: snapshot.createdAt,
      completedAt: snapshot.completedAt
    }
  });
  return snapshot;
}

function persistRequestMetadata(llmName, updates = {}) {
  if (!llmName) return null;
  let requestId = jobState?.llms?.[llmName]?.requestId || llmRequestMap[llmName];
  if (!requestId) {
    const fallback = initRequestMetadata(llmName, TabMapManager.get(llmName), updates.url || '');
    requestId = fallback?.requestId;
  }
  if (!requestId) return null;
  const existing = jobMetadata.get(requestId) || { requestId, llmName };
  const merged = { ...existing };
  merged.llmName = llmName;
  Object.entries(updates || {}).forEach(([key, value]) => {
    if (typeof value === 'undefined' || value === null) {
      return;
    }
    merged[key] = value;
  });
  jobMetadata.set(requestId, merged);
  return merged;
}

async function handleManualResponsePing(llmName, options = {}) {
  if (!llmName) {
    return { status: 'manual_ping_failed', error: 'LLM name missing' };
  }
  let tabId = TabMapManager.get(llmName);
  if (!tabId) {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual ping fallback',
      details: 'Tab not registered, searching open tabs',
      level: 'warning'
    });
    const patterns = typeof getQueryPatternsForLLM === 'function'
      ? getQueryPatternsForLLM(llmName)
      : null;
    const queryList = Array.isArray(patterns) && patterns.length ? patterns : null;
    if (!queryList) {
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'Manual ping unavailable',
        details: 'No query patterns configured',
        level: 'error'
      });
      return { status: 'manual_ping_failed', error: 'No open tabs found. Please open the LLM website first.' };
    }
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ url: queryList }, (foundTabs) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(foundTabs) ? foundTabs : []);
      });
    });
    const eligibleTabs = tabs
      .filter((tab) => isEligibleTabForLlm(llmName, tab))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (!eligibleTabs.length) {
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'Manual ping unavailable',
        details: 'No eligible tabs found',
        level: 'error'
      });
      return { status: 'manual_ping_failed', error: 'No open tabs found. Please open the LLM website first.' };
    }
    tabId = eligibleTabs[0].id;
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual ping fallback tab selected',
      details: `Using tab ${tabId}`,
      level: 'info'
    });
    if (typeof setTabBinding === 'function') {
      await setTabBinding(llmName, tabId);
    }
  }
  broadcastDiagnostic(llmName, {
    type: 'PING',
    label: 'Manual ping initiated',
    details: 'UI button',
    level: 'info'
  });
  const manualRecoveryRequested = options?.manualRecovery !== false;
  let liveEntry = ensureManualRecoveryModelEntry(llmName, tabId, options?.reason || 'manual_ping');
  const recovery = manualRecoveryRequested ? getManualRecoveryState(liveEntry) : null;
  const advanceStrategy = options?.advanceStrategy === true || options?.advanceSelector === true;
  if (manualRecoveryRequested && advanceStrategy) {
    markLastManualCandidateRejected(recovery);
  }
  const strategy = manualRecoveryRequested ? resolveManualRecoveryStrategy(recovery) : null;
  if (manualRecoveryRequested && !strategy) {
    if (recovery) {
      recovery.exhausted = true;
      recovery.updatedAt = Date.now();
    }
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual recovery exhausted',
      details: 'No more selector strategies',
      level: 'warning'
    });
    saveJobState(jobState);
    return { status: 'manual_ping_failed', error: 'No more selector strategies for manual recovery.' };
  }
  const finalizedAt = Number(liveEntry?.finalizedAt || 0);
  const finalizedStatus = String(liveEntry?.status || liveEntry?.finalStatus || '').toUpperCase();
  const allowRecoverableTerminalPing = Boolean(
    isFinalizedEntry(liveEntry)
    && finalizedAt > 0
    && (Date.now() - finalizedAt) <= RECOVERABLE_TERMINAL_MANUAL_PING_WINDOW_MS
    && RECOVERABLE_TERMINAL_PING_STATUSES.has(finalizedStatus)
    && isValidTabId(tabId)
  );
  const allowManualSelectorRecovery = Boolean(manualRecoveryRequested && isValidTabId(tabId));
  if (isFinalizedEntry(liveEntry) && !allowRecoverableTerminalPing && !allowManualSelectorRecovery) {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual ping skipped (terminal)',
      details: `status=${liveEntry?.status || liveEntry?.finalStatus || 'terminal'}`,
      level: 'warning'
    });
    return { status: 'manual_ping_sent' };
  }
  if (!isFinalizedEntry(liveEntry)) {
    await runPreCollectScrollNudge(llmName, tabId, getActiveSessionId(), 'manual_ping_precollect');
  } else if (allowRecoverableTerminalPing || allowManualSelectorRecovery) {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: allowManualSelectorRecovery ? 'Manual selector recovery started' : 'Manual ping override (recoverable terminal)',
      details: allowManualSelectorRecovery
        ? `strategy=${strategy?.id || 'default'} attempt=${Number(recovery?.attempt || 0)}`
        : `status=${finalizedStatus} age=${Math.max(0, Date.now() - finalizedAt)}ms`,
      level: 'warning'
    });
  }
  extendPingWindowForLLM(llmName, MANUAL_PING_WINDOW_MS);
  const manualRecoveryMeta = manualRecoveryRequested ? {
    enabled: true,
    manualRecovery: true,
    manualOverride: true,
    selectorAttempt: Number(recovery?.attempt || 0),
    advanceStrategy,
    strategyId: strategy?.id || null,
    strategyIndex: strategy?.index ?? 0,
    skipStrategyIds: Array.isArray(recovery?.failedStrategyIds) ? recovery.failedStrategyIds.slice() : [],
    skipSelectors: Array.isArray(recovery?.failedSelectors) ? recovery.failedSelectors.slice() : []
  } : null;
  const responseMeta = {
    source: 'manual_ping',
    runSessionId: Number(jobState?.session?.startTime || 0) || null,
    sessionId: Number(jobState?.session?.startTime || 0) || null,
    dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
    forceEmitOnUnchanged: true,
    manualRecovery: manualRecoveryMeta,
    responseMeta: manualRecoveryMeta ? {
      manualRecovery: true,
      manualOverride: true,
      source: 'manual_ping',
      completionReason: 'manual_ping_late_collect',
      lateCollectFinal: true,
      forceTerminalSuccess: true,
      advanceStrategy,
      strategyId: manualRecoveryMeta.strategyId,
      strategyIndex: manualRecoveryMeta.strategyIndex
    } : undefined
  };
  sendPassiveMessageWithRetries(tabId, llmName, { action: 'getResponses', meta: responseMeta }, {
    maxAttempts: 4,
    baseDelay: 700,
    transportRetryDelays: HARD_STOP_PING_RETRY_DELAYS_MS,
    allowRecovery: true,
    onSuccess: (response) => {
      const successEntry = jobState?.llms?.[llmName];
      if (successEntry) {
        successEntry.pingTransportErrorCount = 0;
      }
      if (response?.status === 'ignored_terminal') {
        chrome.runtime.sendMessage({
          type: 'MANUAL_PING_RESULT',
          llmName,
          status: 'ignored_terminal'
        });
        return;
      }
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'getResponses command sent',
        details: response?.status ? `CS status: ${response.status}` : '',
        level: 'success'
      });
    },
    onError: (errMsg) => {
      const liveEntry = jobState?.llms?.[llmName];
      if (liveEntry) {
        liveEntry.pingTransportErrorCount = Number(liveEntry.pingTransportErrorCount || 0) + 1;
        liveEntry.lastPingTransportErrorAt = Date.now();
      }
      const isTerminal = !!(liveEntry && isFinalizedEntry(liveEntry));
      const lateManualRecoveryPending = Boolean(allowManualSelectorRecovery);
      if (!isTerminal && typeof self.recoverAnswerViaDomSnapshot === 'function') {
        self.recoverAnswerViaDomSnapshot(llmName, tabId, 'manual_ping_transport_error', {
          dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null
        }).catch(() => {});
      }
      broadcastDiagnostic(llmName, {
        type: isTerminal && !lateManualRecoveryPending ? 'PING' : 'PING_ERROR',
        label: isTerminal && !lateManualRecoveryPending ? 'Manual ping skipped (terminal)' : 'PING_TRANSPORT_ERROR',
        details: isTerminal && !lateManualRecoveryPending
          ? `${errMsg} | status=${liveEntry?.status || 'terminal'}`
          : errMsg,
        level: 'warning'
      });
      if (!isTerminal) {
        maybeRunEarlyGestureRecovery(llmName, tabId, 'manual_ping');
      }
      if (!lateManualRecoveryPending) {
        chrome.runtime.sendMessage({
          type: 'MANUAL_PING_RESULT',
          llmName,
          status: isTerminal ? 'ignored_terminal' : 'failed',
          error: errMsg
        });
      }
    }
  });
  if (!isFinalizedEntry(liveEntry) || allowRecoverableTerminalPing || allowManualSelectorRecovery) {
    const manualBudgetKey = buildRecoveryBudgetKey({
      dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
      reason: 'manual_ping_late_collect',
      scope: allowManualSelectorRecovery ? 'manual_selector_recovery' : 'manual_ping'
    });
    const manualBudget = consumeRecoveryBudget(llmName, liveEntry, manualBudgetKey, 'manualPing', {
      telemetry: {
        tabId,
        dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
        manualSelectorRecovery: allowManualSelectorRecovery
      }
    });
    if (!manualBudget.ok) {
      chrome.runtime.sendMessage({
        type: 'MANUAL_PING_RESULT',
        llmName,
        status: 'failed',
        error: manualBudget.reason
      });
    } else {
      lateCollectAnswer({
        llmName,
        tabId,
        reason: 'manual_ping_late_collect',
        meta: {
          ...responseMeta,
          recoveryBudgetKey: manualBudgetKey
        },
        manualRecovery: manualRecoveryMeta
      })
      .then((result) => {
        if (acceptLateCollectResult(llmName, result, responseMeta)) {
          const updatedEntry = jobState?.llms?.[llmName] || liveEntry;
          const candidate = saveManualRecoveryCandidate(updatedEntry, result, strategy);
          saveJobState(jobState);
          chrome.runtime.sendMessage({
            type: 'MANUAL_PING_RESULT',
            llmName,
            status: 'success',
            source: result.source || 'late_collect',
            strategyId: candidate?.strategyId || result.strategyId || strategy?.id || null,
            selectorUsed: candidate?.selectorDescriptor || result.selectorDescriptor || result.selectorUsed || null,
            attempt: Number(recovery?.attempt || 0)
          });
        } else if (result?.status) {
          chrome.runtime.sendMessage({
            type: 'MANUAL_PING_RESULT',
            llmName,
            status: 'failed',
            error: result.reason || result.status
          });
        }
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          type: 'MANUAL_PING_RESULT',
          llmName,
          status: 'failed',
          error: err?.message || String(err)
        });
      });
    }
  }
  saveJobState(jobState);
  return {
    status: 'manual_ping_sent',
    strategyId: strategy?.id || null,
    strategyIndex: strategy?.index ?? null,
    attempt: Number(recovery?.attempt || 0),
    advanceStrategy
  };
}

function handleManualResendRequest(llmName) {
  if (!llmName) {
    return { status: 'manual_resend_failed', error: 'LLM name missing' };
  }
  const llmEntry = jobState?.llms?.[llmName];
  if (!llmEntry) {
    return { status: 'manual_resend_failed', error: 'LLM not active' };
  }
  const tabId = resolveBoundTabIdForOrchestrator(llmName, llmEntry);
  if (!tabId) {
    return { status: 'manual_resend_failed', error: 'Tab not found' };
  }
  const prompt = jobState?.prompt;
  if (!prompt) {
    return { status: 'manual_resend_failed', error: 'Prompt unavailable' };
  }
  const intentDecision = self.RecoveryIntent?.authorize
    ? self.RecoveryIntent.authorize(llmEntry, {
      intent: 'resend_prompt',
      reason: 'manual_resend',
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    })
    : { ok: true };
  llmEntry.lastRecoveryIntentDecision = {
    ...intentDecision,
    reasonLabel: 'manual_resend',
    decidedAt: Date.now()
  };
  if (!intentDecision.ok) {
    self.DecisionLedger?.append?.(llmEntry, {
      decision: 'deny_recovery_intent',
      reason: intentDecision.reason || 'recovery_intent_denied',
      source: 'manual_resend',
      inputs: { intentDecision },
      resultingState: llmEntry.finalStatus || llmEntry.status || 'open'
    });
    emitTelemetry(llmName, 'MANUAL_RESEND_DENIED', {
      level: 'warning',
      details: intentDecision.reason || 'recovery_intent_denied',
      meta: { tabId, intentDecision },
      force: true
    });
    broadcastDiagnostic(llmName, {
      type: 'RESEND',
      label: 'Manual resend denied',
      details: intentDecision.reason || 'recovery_intent_denied',
      level: 'warning',
      meta: { intentDecision }
    });
    return { status: 'manual_resend_denied', reason: intentDecision.reason || 'recovery_intent_denied', intent: intentDecision.intent || 'resend_prompt' };
  }
  llmEntry.manualResendActive = true;
  llmEntry.manualResendStartedAt = Date.now();
  llmEntry.manualResendAttempts = (llmEntry.manualResendAttempts || 0) + 1;
  broadcastDiagnostic(llmName, {
    type: 'RESEND',
    label: 'Manual resend initiated',
    level: 'info'
  });
  const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
  if (machine) {
    machine.reset();
  }
  dispatchPromptToTab(llmName, tabId, prompt, jobState.attachments || [], 'manual_resend', {
    recoveryIntent: 'resend_prompt'
  });
  return { status: 'manual_resend_dispatched' };
}

function sendCleanupCommand(llmName) {
  const tabId = TabMapManager.get(llmName);
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(`[BACKGROUND] Cleanup command failed for ${llmName}:`, chrome.runtime.lastError.message);
    } else {
      console.log(`[BACKGROUND] Cleanup command sent to ${llmName}, response:`, response);
    }
  });
}

  self.saveJobState = saveJobState;
  self.loadJobState = loadJobState;
  self.stopAllProcesses = stopAllProcesses;
  self.startProcess = startProcess;
  self.collectResponses = collectResponses;
  self.collectResponsesStaged = collectResponsesStaged;
  self.handleLLMResponse = handleLLMResponse;
  self.startBudgetPhase = startBudgetPhase;
  self.endBudgetPhase = endBudgetPhase;
  self.clearBudgetPhases = clearBudgetPhases;
  self.initRequestMetadata = initRequestMetadata;
  self.persistRequestMetadata = persistRequestMetadata;
  self.handleManualResponsePing = handleManualResponsePing;
  self.handleManualResendRequest = handleManualResendRequest;
  self.lateCollectAnswer = lateCollectAnswer;
  self.acceptLateCollectResult = acceptLateCollectResult;
  self.saveAnswerSnapshotFromContent = saveAnswerSnapshotFromContent;
  self.readAnswerSnapshotCache = readAnswerSnapshotCache;
  self.clearLateAnswerSnapshotCache = clearLateAnswerSnapshotCache;
  self.classifyLateCollectState = classifyLateCollectState;
  self.recoverAnswerViaDomSnapshot = recoverAnswerViaDomSnapshot;
  self.sendCleanupCommand = sendCleanupCommand;
  self.scheduleAdaptiveCollectionProbe = scheduleAdaptiveCollectionProbe;
  self.clearAdaptiveCollectTimer = clearAdaptiveCollectTimer;
  self.buildEarlyTerminalGuardSignature = buildEarlyTerminalGuardSignature;
  self.maybeDeferEarlyTerminalSuccess = maybeDeferEarlyTerminalSuccess;
  self.normalizeEvidenceText = normalizeEvidenceText;
  self.buildEvidenceDedupeKey = buildEvidenceDedupeKey;
  self.buildRecoveryBudgetKey = buildRecoveryBudgetKey;
  self.ensureRecoveryBudget = ensureRecoveryBudget;
  self.consumeRecoveryBudget = consumeRecoveryBudget;
  self.validateMaterializedAnswerEvidence = validateMaterializedAnswerEvidence;
  self.buildMaterializedEvidenceSummary = buildMaterializedEvidenceSummary;
  self.materializeLatestAnswerEvidence = materializeLatestAnswerEvidence;
  self.classifyFailure = classifyFailure;
  self.deriveFailureFinalStatus = deriveFailureFinalStatus;
  self.isPromptEchoAnswerCandidate = isPromptEchoAnswerCandidate;
  self.buildAnswerCandidate = buildAnswerCandidate;
  self.evaluateAnswerCandidate = evaluateAnswerCandidate;
  self.submitAnswerCandidate = submitAnswerCandidate;
  self.buildFinalizationEvidence = buildFinalizationEvidence;
  self.hasRound2SubmitOrAnswerEvidence = hasRound2SubmitOrAnswerEvidence;
  self.getRound2SubmitConfirmationState = getRound2SubmitConfirmationState;
  self.waitForRound2SubmitConfirmation = waitForRound2SubmitConfirmation;
  self.isRound2DelayedConfirmationState = isRound2DelayedConfirmationState;
  self.shouldInferSubmitFromAnswerEvidence = shouldInferSubmitFromAnswerEvidence;
  self.inferPromptSubmittedFromAnswerEvidence = inferPromptSubmittedFromAnswerEvidence;
  self.recordModelRunState = recordModelRunState;
  self.emitFinalizationDecision = emitFinalizationDecision;
  self.getActivePipelineControlState = getActivePipelineControlState;
  self.persistPipelineControlState = persistPipelineControlState;
  self.rehydrateActiveJobRuntime = rehydrateActiveJobRuntime;
  self.updateMv3SurvivalAlarm = updateMv3SurvivalAlarm;
  self.registerSessionTimer = registerSessionTimer;
  self.deregisterSessionTimer = deregisterSessionTimer;
  self.clearSessionTimers = clearSessionTimers;

    console.log('[JobOrchestrator] Module loaded');
  })();
}
