// Shared utilities for content scripts (sleep, selectors cache, visibility checks, smart scroll)
(function initContentUtils() {
  if (window.ContentUtils) return;

  const sleep = (ms) => {
    const baseMs = Number(ms) || 0;
    const speedMode = !!window.__PRAGMATIST_SPEED_MODE;
    const factor = speedMode ? 0.35 : 1;
    const minMs = speedMode ? 25 : 0;
    const finalMs = Math.max(minMs, baseMs * factor);
    return new Promise((resolve) => setTimeout(resolve, finalMs));
  };

  const isExtensionContextValid = () => {
    try {
      return !!chrome?.runtime?.id;
    } catch (_) {
      return false;
    }
  };

  const cleanupKeyByLlm = {
    'GPT': 'chatgpt',
    'Gemini': 'gemini',
    'Claude': 'claude',
    'Grok': 'grok',
    'Le Chat': 'lechat',
    'Qwen': 'qwen',
    'DeepSeek': 'deepseek',
    'Perplexity': 'perplexity'
  };

  const resolveCleanupHandler = (llmName) => {
    if (!llmName) return null;
    const key = cleanupKeyByLlm[llmName] || String(llmName).toLowerCase().replace(/\s+/g, '');
    const handler = key ? window[`__cleanup_${key}`] : null;
    return typeof handler === 'function' ? handler : null;
  };

  const runCleanupForLlm = (llmName, reason) => {
    const handler = resolveCleanupHandler(llmName);
    if (!handler) return false;
    try {
      handler(reason || 'cleanup');
      return true;
    } catch (err) {
      console.warn('[ContentUtils] Cleanup handler failed', llmName, err);
      return false;
    }
  };

  const runAllKnownCleanups = (reason) => {
    const targets = Object.keys(cleanupKeyByLlm);
    targets.forEach((name) => runCleanupForLlm(name, reason));
  };

  const handleContextInvalidation = () => {
    if (window.__LLMCodexContextInvalidated) return;
    window.__LLMCodexContextInvalidated = true;
    try {
      if (window.humanSessionController?.forceHardStop) {
        window.humanSessionController.forceHardStop('extension-invalidated');
      }
    } catch (_) {}
    runAllKnownCleanups('extension-invalidated');
    console.warn('[ContentUtils] Extension context invalidated');
  };

  const safeRuntimeSendMessage = (message, callback) => {
    if (!isExtensionContextValid()) {
      handleContextInvalidation();
      return false;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const errMsg = chrome.runtime?.lastError?.message || '';
        if (errMsg.includes('Extension context invalidated')) {
          handleContextInvalidation();
          return;
        }
        if (typeof callback === 'function') {
          callback(response);
        }
      });
      return true;
    } catch (err) {
      if ((err?.message || '').includes('Extension context invalidated')) {
        handleContextInvalidation();
        return false;
      }
      throw err;
    }
  };

  // Purpose: keep track of dispatch metadata for correlating telemetry.
  let storedSessionId = null;
  let storedRunSessionId = null;
  let storedDispatchId = null;
  let storedTabSessionId = null;
  let sessionExpired = false;
  const resetSessionExpiredState = () => {
    sessionExpired = false;
    try { delete window.__SESSION_EXPIRED__; } catch (_) {}
  };
  const storeSessionId = (sessionId) => {
    if (!sessionId) return;
    resetSessionExpiredState();
    storedSessionId = sessionId;
    storedRunSessionId = storedRunSessionId || sessionId;
    window.__CURRENT_SESSION_ID__ = sessionId;
  };
  const getSessionId = () => storedSessionId || window.__CURRENT_SESSION_ID__ || null;

  const storeDispatchMeta = (meta = {}) => {
    const runSessionId = meta.runSessionId || meta.sessionId || null;
    if (runSessionId) {
      storedRunSessionId = runSessionId;
      storedSessionId = storedSessionId || runSessionId;
      window.__CURRENT_SESSION_ID__ = storedSessionId;
    }
    if (meta.dispatchId) {
      storedDispatchId = meta.dispatchId;
    }
    if (meta.tabSessionId) {
      storedTabSessionId = meta.tabSessionId;
    }
  };

  const ensureDispatchMeta = (meta, llmName) => {
    const base = meta && typeof meta === 'object' ? Object.assign({}, meta) : {};
    storeDispatchMeta(base);
    const runSessionId = base.runSessionId || storedRunSessionId || getSessionId();
    if (runSessionId) {
      base.runSessionId = runSessionId;
      if (!base.sessionId) {
        base.sessionId = runSessionId;
      }
    }
    if (storedDispatchId && !base.dispatchId) {
      base.dispatchId = storedDispatchId;
    }
    if (storedTabSessionId && !base.tabSessionId) {
      base.tabSessionId = storedTabSessionId;
    }
    if (llmName && !base.llmName) {
      base.llmName = llmName;
    }
    return Object.keys(base).length ? base : null;
  };

  const FOCUS_REQUEST_THROTTLE_MS = 3000;
  let lastFocusRequestAt = 0;
  let activeRequestCount = 0;
  // Track on-going GET_ANSWER work so focus requests only fire while an active request is in flight.
  const startActiveRequest = () => { activeRequestCount += 1; };
  const stopActiveRequest = () => {
    if (activeRequestCount > 0) {
      activeRequestCount -= 1;
    }
  };
  const hasActiveRequest = () => activeRequestCount > 0;
  // Gate NEED_FOCUS to active GET_ANSWER cycles and throttle repeated notifications.
  const requestFocusFromBackground = (reason = 'visibility') => {
    if (!storedSessionId) return false;
    if (sessionExpired) return false;
    if (!hasActiveRequest()) return false;
    const now = Date.now();
    if (now - lastFocusRequestAt < FOCUS_REQUEST_THROTTLE_MS) return false;
    lastFocusRequestAt = now;
    return safeRuntimeSendMessage({
      type: 'NEED_FOCUS',
      sessionId: storedSessionId,
      reason
    });
  };

  const readInputValue = (el) => {
    try {
      if (!el) return '';
      if ('value' in el) return String(el.value || '');
      return String(el.textContent || '');
    } catch (_) {
      return '';
    }
  };

  const normalizeForPaste = (value = '') => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const pasteMatchesPrompt = (current, prompt) => {
    const head = normalizeForPaste(prompt).slice(0, 120);
    if (!head) return false;
    return normalizeForPaste(current).includes(head);
  };

  const pasteTextFirst = async (element, text = '') => {
    if (!element) return false;
    const payload = String(text || '');
    if (!payload) return false;
    try { element.focus?.({ preventScroll: true }); } catch (_) { try { element.focus?.(); } catch (_) {} }
    //-- 3.1. Усиленный "донорский" метод: фокус, зачистка и мгновенная вставка --//
    try {
      if (element.tagName === 'TEXTAREA' || element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
        element.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, payload);
      }
    } catch (e) { console.warn('[ContentUtils] Fast-track failed', e); }
    let dispatched = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', payload);
      dt.setData('text/html', payload);
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (_) {}
      }
      element.dispatchEvent(ev);
      dispatched = true;
    } catch (_) {}
    try {
      const doc = element.ownerDocument || document;
      if (doc?.execCommand) {
        const ok = doc.execCommand('insertText', false, payload);
        dispatched = dispatched || ok;
      }
    } catch (_) {}
    await sleep(80);
    const current = readInputValue(element);
    if (pasteMatchesPrompt(current, payload)) return true;
    return false;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestFocusFromBackground('visibility');
    }
  });

  try {
    const lastSpaCleanupAt = new Map();
    window.addEventListener('LLM_CODEX_SPA_NAVIGATION', (event) => {
      const detail = event?.detail || {};
      const llmName = detail.llmName;
      if (!llmName) return;
      const now = Date.now();
      const last = lastSpaCleanupAt.get(llmName) || 0;
      if (now - last < 2000) return;
      lastSpaCleanupAt.set(llmName, now);
      runCleanupForLlm(llmName, `spa_navigation:${detail.reason || 'unknown'}`);
    }, { passive: true });
  } catch (_) {}

  const markSessionExpired = (meta = {}) => {
    if (sessionExpired) return false;
    sessionExpired = true;
    activeRequestCount = 0;
    const payload = {
      reason: meta.reason || 'session_expired',
      previousSessionId: storedSessionId || null,
      newSessionId: meta.newSessionId || null,
      triggeredBy: meta.triggeredBy || 'background',
      ts: Date.now()
    };
    window.__SESSION_EXPIRED__ = payload;
    try {
      if (window.humanSessionController?.forceHardStop) {
        window.humanSessionController.forceHardStop(payload.reason);
      }
    } catch (_) {}
    try {
      window.__LLMScrollHardStop = true;
    } catch (_) {}
    console.warn('[ContentUtils] Session expired locally', payload);
    return true;
  };

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'SESSION_EXPIRED') {
        const incomingSessionId = message.currentSessionId;
        if (!incomingSessionId || incomingSessionId === storedSessionId) return false;
        markSessionExpired({
          reason: message.reason || 'session_mismatch',
          newSessionId: incomingSessionId,
          triggeredBy: 'background_session_switch'
        });
      }
    });
  } catch (_) {}

  const isElementInteractable = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    const style = window.getComputedStyle?.(el);
    return !!rect && !!style && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  const getCoordinator = () =>
    window.chatgptScrollCoordinator ||
    window.leChatScrollCoordinator ||
    window.perplexityScrollCoordinator ||
    window.geminiScrollCoordinator ||
    window.qwenScrollCoordinator ||
    window.deepseekScrollCoordinator ||
    window.grokScrollCoordinator ||
    window.scrollCoordinator;

  async function withSmartScroll(asyncOperation, options = {}) {
    await ensureScrollToolkit();
    const coordinator = options.coordinator || getCoordinator();
    if (coordinator?.run) {
      return coordinator.run(asyncOperation, options);
    }
    return asyncOperation();
  }

  const loadedScripts = new Map();
  function loadScriptOnce(path) {
    if (loadedScripts.has(path)) return loadedScripts.get(path);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = () => resolve(true);
      script.onerror = (err) => reject(err);
      (document.head || document.documentElement || document.body).appendChild(script);
    }).catch((err) => {
      console.warn('[ContentUtils] Failed to load script', path, err);
      return false;
    });
    loadedScripts.set(path, promise);
    return promise;
  }

  async function ensureMainWorldBridge() {
    if (window.__extMainBridgeInjected) return true;
    const loaded = await loadScriptOnce('content-scripts/content-bridge.js');
    if (loaded) window.__extMainBridgeInjected = true;
    return loaded;
  }

  async function ensureScrollToolkit() {
    if (window.__UniversalScrollToolkit) return true;
    await loadScriptOnce('scroll-toolkit.js');
    return !!window.__UniversalScrollToolkit;
  }

  async function ensureHumanoid() {
    if (window.LLMExtension?.Humanoid) return true;
    await ensureScrollToolkit();
    await loadScriptOnce('humanoid.js');
    return !!(window.LLMExtension?.Humanoid);
  }

  // Shared MutationObserver registry to reduce duplicate observers per target
  const mutationRegistry = new Map(); // target -> { observer, callbacks, options }
  function observeMutations(target, options, handler) {
    if (!target || typeof handler !== 'function') return () => {};
    const key = target;
    let entry = mutationRegistry.get(key);
    if (!entry) {
      entry = { callbacks: new Set(), observer: null, options };
      entry.observer = new MutationObserver((muts) => {
        entry.callbacks.forEach((cb) => {
          try { cb(muts); } catch (err) { console.warn('[ContentUtils] observeMutations handler failed', err); }
        });
      });
      try {
        entry.observer.observe(target, options || { childList: true, subtree: true, characterData: true });
      } catch (err) {
        console.warn('[ContentUtils] observeMutations failed to observe', err);
        return () => {};
      }
      mutationRegistry.set(key, entry);
    }
    entry.callbacks.add(handler);
    return () => {
      const current = mutationRegistry.get(key);
      if (!current) return;
      current.callbacks.delete(handler);
      if (!current.callbacks.size) {
        current.observer.disconnect();
        mutationRegistry.delete(key);
      }
    };
  }

  async function findAndCacheElement(selectorKey, selectorArray, timeout = 30000, scope = document, extras = {}) {
    // Support calling with options object as third arg
    if (typeof timeout === 'object') {
      extras = timeout;
      timeout = extras.timeout || 30000;
      scope = extras.scope || document;
    }
    const model = extras.model || window.MODEL || 'generic';
    const metricsCollector = extras.metricsCollector;
    const cacheVersion = '2025-12-11';
    const storageKey = `selector_cache_${model}_${selectorKey}_${cacheVersion}`;
    const startedAt = performance.now();
    const cachedSelector = (() => {
      try {
        const allKeys = Object.keys(window.localStorage || {}).filter((k) => k.startsWith(`selector_cache_${model}_${selectorKey}_`));
        const stale = allKeys.filter((k) => k !== storageKey);
        stale.forEach((k) => {
          try { window.localStorage.removeItem(k); } catch (_) {}
        });
        return window.localStorage?.getItem(storageKey);
      } catch (_) {
        return null;
      }
    })();
    if (cachedSelector) {
      const node = safeQuery(cachedSelector, scope);
      if (node) {
        metricsCollector?.finishOperation?.(`find_${selectorKey}`, { status: 'cache_hit', selector: cachedSelector });
        return node;
      }
    }

    const end = performance.now() + timeout;
    while (performance.now() < end) {
      for (const selector of selectorArray || []) {
        const node = safeQuery(selector, scope);
        if (node && isElementInteractable(node)) {
          try { window.localStorage?.setItem(storageKey, selector); } catch (_) {}
          metricsCollector?.finishOperation?.(`find_${selectorKey}`, { status: 'success', selector, durationMs: performance.now() - startedAt });
          return node;
        }
      }
      await sleep(100);
    }
    metricsCollector?.finishOperation?.(`find_${selectorKey}`, { status: 'timeout', durationMs: performance.now() - startedAt });
    return null;
  }

  function safeQuery(selector, scope = document) {
    try {
      return scope.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  const INLINE_STYLE_PROPERTIES = [
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'text-transform',
    'line-height',
    'letter-spacing',
    'text-align',
    'white-space',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-radius',
    'list-style-type',
    'list-style-position'
  ];

  const buildInlineStyle = (element) => {
    if (!element || element.nodeType !== 1) return '';
    const computed = window.getComputedStyle?.(element);
    if (!computed) return '';
    return INLINE_STYLE_PROPERTIES.map((prop) => {
      const value = computed.getPropertyValue(prop);
      return value ? `${prop}:${value.trim()};` : '';
    }).join('');
  };

  const applyInlineStyles = (source, target) => {
    const style = buildInlineStyle(source);
    if (style) {
      target.setAttribute('style', style);
    }
  };

  const cloneElementWithInlineStyles = (element) => {
    if (!element || element.nodeType !== 1) return null;
    const clone = element.cloneNode(true);
    const sourceWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, null);
    const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null);
    let sourceNode = element;
    let cloneNode = clone;
    while (sourceNode && cloneNode) {
      applyInlineStyles(sourceNode, cloneNode);
      sourceNode = sourceWalker.nextNode();
      cloneNode = cloneWalker.nextNode();
    }
    return clone;
  };

  const stripHiddenElements = (root) => {
    if (!root || root.nodeType !== 1) return;
    root.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').forEach((node) => node.remove());
  };

  const RESPONSE_CLEANUP_SELECTORS = [
    'script',
    'style',
    'noscript',
    'svg',
    'canvas',
    'button',
    '[role="button"]',
    'header',
    'footer',
    'nav',
    'aside',
    'form'
  ].join(', ');

  const buildInlineHtml = (element, options = {}) => {
    if (!element || element.nodeType !== 1) return '';
    const includeRoot = options.includeRoot !== false;
    const clone = cloneElementWithInlineStyles(element) || element.cloneNode(true);
    try { stripHiddenElements(clone); } catch (_) {}
    try {
      clone.querySelectorAll(RESPONSE_CLEANUP_SELECTORS).forEach((node) => node.remove());
    } catch (_) {}
    return includeRoot ? (clone.outerHTML || '') : (clone.innerHTML || '');
  };

  const detectLlmNameFromLocation = () => {
    const host = String(window.location?.hostname || '').toLowerCase();
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'GPT';
    if (host.includes('gemini.google.com') || host.includes('bard.google.com')) return 'Gemini';
    if (host.includes('claude.ai')) return 'Claude';
    if (host.includes('grok.com') || host.includes('grok.x.ai') || host === 'x.com') return 'Grok';
    if (host.includes('chat.qwen.ai')) return 'Qwen';
    if (host.includes('chat.mistral.ai')) return 'Le Chat';
    if (host.includes('chat.deepseek.com')) return 'DeepSeek';
    if (host.includes('perplexity.ai')) return 'Perplexity';
    return window.MODEL || null;
  };

  const extractSafeVisibleText = (el, maxChars = 10000) => {
    if (!el) return '';
    let text = '';
    try {
      text = el.innerText || el.textContent || '';
    } catch (_) {
      text = '';
    }
    return String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Math.max(0, Number(maxChars) || 10000));
  };

  const lateSnapshotSelectorsByModel = {
    GPT: [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      'article .markdown',
      'article'
    ],
    Gemini: [
      'model-response',
      '.model-response-text',
      'message-content',
      '[data-test-id="model-response-text"]',
      '[data-message-author-role="assistant"]',
      '.markdown',
      'article'
    ],
    Claude: [
      '[data-testid*="assistant" i]',
      '[data-is-streaming="false"] .font-claude-message',
      '.font-claude-message',
      '[data-testid="message"]',
      '.markdown',
      'article'
    ],
    Grok: [
      '[data-testid="conversation-turn"] .markdown',
      '[data-testid="chat-message"] .markdown',
      '[data-testid="message-bubble"]',
      '.markdown',
      'article'
    ],
    'Le Chat': [
      'div[data-testid="lechat-response"] .prose',
      '[data-testid="answer"] .prose',
      '[data-testid="message-content"]',
      '.prose',
      '.answer',
      '.result'
    ],
    Qwen: [
      'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
      'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
      '[data-testid="chat-response"] .qwen-markdown',
      'div.custom-qwen-markdown',
      'div.qwen-markdown.qwen-markdown-loose'
    ],
    DeepSeek: [
      '.message-item[data-role="assistant"] .markdown-body',
      '.message-item[data-role="assistant"] .message-content',
      '[data-role="assistant"] .markdown-body',
      'div.ds-message div.ds-markdown',
      '.assistant-message .markdown-body',
      '.markdown-body',
      '.message-content'
    ],
    Perplexity: [
      '[data-testid="answer-card"] .prose',
      '[data-testid="answer-card"]',
      '[data-testid="answer"] .prose',
      '[data-testid="chat-message"] .prose',
      '[data-testid="conversation-turn"] .prose',
      '.answer',
      '.prose',
      'article'
    ]
  };

  const isLateSnapshotRejectedNode = (node) => {
    const tag = String(node?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'button', 'nav', 'header', 'footer', 'form', 'aside'].includes(tag)) return true;
    try {
      return !!node?.closest?.('textarea,input,button,nav,header,footer,form,aside,[contenteditable="true"],[role="combobox"]');
    } catch (_) {
      return false;
    }
  };

  const collectLateSnapshotCandidate = (llmName = detectLlmNameFromLocation(), minChars = 80) => {
    const selectors = lateSnapshotSelectorsByModel[llmName] || [];
    const seen = new Set();
    const nodes = [];
    const visitRoot = (root) => {
      if (!root?.querySelectorAll) return;
      selectors.forEach((selector) => {
        try {
          root.querySelectorAll(selector).forEach((node) => {
            if (node && !seen.has(node)) {
              seen.add(node);
              nodes.push(node);
            }
          });
        } catch (_) {}
      });
      try {
        root.querySelectorAll('*').forEach((node) => {
          if (node?.shadowRoot) visitRoot(node.shadowRoot);
        });
      } catch (_) {}
    };
    visitRoot(document);
    const candidates = nodes
      .filter((node) => node && !isLateSnapshotRejectedNode(node))
      .map((node, index) => {
        const text = extractSafeVisibleText(node, 50000);
        let visible = true;
        try {
          const style = window.getComputedStyle(node);
          visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        } catch (_) {}
        return { node, text, visible, score: text.length + (visible ? 500 : 0) + index };
      })
      .filter((item) => item.text.length >= minChars)
      .sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    return best
      ? { ok: true, llmName, text: best.text, html: buildInlineHtml(best.node), visible: best.visible, candidates: candidates.length }
      : { ok: false, llmName, text: '', html: '', candidates: candidates.length };
  };

  const simpleSnapshotHash = (value = '') => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };

  const initLateAnswerSnapshotObserver = () => {
    if (window.__LLMLateAnswerSnapshotObserverStarted) return false;
    window.__LLMLateAnswerSnapshotObserverStarted = true;
    let lastHash = '';
    let lastSentAt = 0;
    let timer = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const llmName = detectLlmNameFromLocation();
        if (!llmName) return;
        const snapshot = collectLateSnapshotCandidate(llmName, 80);
        if (!snapshot.ok || !snapshot.text) return;
        const hash = simpleSnapshotHash(snapshot.text);
        const now = Date.now();
        // Throttle streaming snapshots: 900ms debounce above plus min 1200ms between messages.
        if (hash === lastHash || now - lastSentAt < 1200) return;
        lastHash = hash;
        lastSentAt = now;
        const meta = ensureDispatchMeta({}, llmName) || {};
        safeRuntimeSendMessage({
          type: 'ANSWER_SNAPSHOT',
          llmName,
          text: snapshot.text,
          html: snapshot.html || '',
          hash,
          length: snapshot.text.length,
          url: location.href,
          meta
        });
      }, 900);
    };
    try {
      const observer = observeMutations(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      }, schedule);
      window.__LLMLateAnswerSnapshotObserver = observer;
      schedule();
      return true;
    } catch (_) {
      return false;
    }
  };

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === 'LATE_COLLECT_PING' || message?.type === 'LATE_COLLECT_PING') {
        sendResponse?.({
          ok: true,
          status: 'late_collect_pong',
          llmName: detectLlmNameFromLocation(),
          href: location.href,
          readyState: document.readyState,
          snapshotObserver: !!window.__LLMLateAnswerSnapshotObserverStarted
        });
        return false;
      }
      return false;
    });
  } catch (_) {}

  initLateAnswerSnapshotObserver();

  window.ContentUtils = {
    sleep,
    isElementInteractable,
    isExtensionContextValid,
    safeRuntimeSendMessage,
    storeSessionId,
    storeDispatchMeta,
    getSessionId,
    ensureDispatchMeta,
    pasteTextFirst,
    requestFocusFromBackground,
    startActiveRequest,
    stopActiveRequest,
    withSmartScroll,
    findAndCacheElement,
    ensureMainWorldBridge,
    ensureScrollToolkit: ensureScrollToolkit,
    ensureHumanoid,
    observeMutations,
    cloneElementWithInlineStyles,
    buildInlineHtml,
    extractSafeVisibleText,
    collectLateSnapshotCandidate,
    initLateAnswerSnapshotObserver
  };
})();
