// background/tab-manager.js
// Tab lifecycle helpers and tab listeners.

'use strict';

const TAB_LOAD_TIMEOUT_MS = TimingConfig.getTiming('tabLoadTimeoutMs', 45000);
const TAB_READY_TIMEOUT_MS = TimingConfig.getTiming('tabReadyTimeoutMs', 15000);
const AUTO_PING_WINDOW_MS = 45000;

const getSessionTabSet = () => {
  if (typeof sessionTabIds === 'undefined') return null;
  return sessionTabIds;
};

const loadSessionTabs = () => {
  const sessionSet = getSessionTabSet();
  if (!sessionSet || !chrome?.storage?.local?.get) return;
  const key = typeof SESSION_TAB_IDS_KEY !== 'undefined' ? SESSION_TAB_IDS_KEY : 'llm_session_tab_ids_v1';
  chrome.storage.local.get(key, (result) => {
    const list = Array.isArray(result?.[key]) ? result[key] : [];
    list.forEach((tabId) => {
      if (Number.isInteger(tabId)) {
        sessionSet.add(tabId);
      }
    });
    if (typeof sessionTabsLoaded !== 'undefined') {
      sessionTabsLoaded = true;
    }
  });
};

const persistSessionTabs = () => {
  const sessionSet = getSessionTabSet();
  if (!sessionSet || !chrome?.storage?.local?.set) return;
  const key = typeof SESSION_TAB_IDS_KEY !== 'undefined' ? SESSION_TAB_IDS_KEY : 'llm_session_tab_ids_v1';
  chrome.storage.local.set({ [key]: Array.from(sessionSet) });
};

const trackSessionTab = (tabId) => {
  const sessionSet = getSessionTabSet();
  if (!sessionSet || !Number.isInteger(tabId)) return;
  if (!sessionSet.has(tabId)) {
    sessionSet.add(tabId);
    persistSessionTabs();
  }
};

const getRunBoundTabIdSet = () => {
  const list = Array.isArray(jobState?.session?.boundTabIds)
    ? jobState.session.boundTabIds.filter((id) => Number.isInteger(id))
    : [];
  return list.length ? new Set(list) : null;
};

const hasRunBoundTabScope = () => {
  return Array.isArray(jobState?.session?.boundTabIds)
    && jobState.session.boundTabIds.some((id) => Number.isInteger(id));
};

const trackRunTab = (tabId) => {
  if (!Number.isInteger(tabId) || !jobState?.session) return;
  if (!Array.isArray(jobState.session.boundTabIds)) {
    jobState.session.boundTabIds = [];
  }
  if (!jobState.session.boundTabIds.includes(tabId)) {
    jobState.session.boundTabIds.push(tabId);
    if (typeof saveJobState === 'function') {
      saveJobState(jobState);
    }
  }
};

const untrackSessionTab = (tabId) => {
  const sessionSet = getSessionTabSet();
  if (!sessionSet || !Number.isInteger(tabId)) return;
  if (sessionSet.delete(tabId)) {
    persistSessionTabs();
  }
};

// Prefer dynamic list from LLM_TARGETS (loaded via llm-targets.js) to avoid
// falling out of sync when new providers are added. Fallback list stays as
// a safe default in case globals are unavailable (e.g., during unit runs).
const FALLBACK_LLM_URL_PATTERNS = [
  '*://chat.openai.com/*',
  '*://chatgpt.com/*',
  '*://claude.ai/*',
  '*://gemini.google.com/*',
  '*://bard.google.com/*',
  '*://perplexity.ai/*',
  '*://www.perplexity.ai/*',
  '*://grok.com/*',
  '*://grok.x.ai/*',
  '*://x.ai/*',
  '*://x.com/*',
  '*://chat.qwen.ai/*',
  '*://chat.mistral.ai/*',
  '*://chat.deepseek.com/*'
];

// Use a local alias to avoid re-declaring the global const from llm-targets.js.
const SESSION_LLM_URL_PATTERNS = Array.isArray(self?.LLM_URL_PATTERNS) && self.LLM_URL_PATTERNS.length
  ? self.LLM_URL_PATTERNS
  : FALLBACK_LLM_URL_PATTERNS;

const getTrackedSessionTabs = async () => {
  const sessionSet = getSessionTabSet();
  const ids = new Set();
  if (sessionSet) {
    Array.from(sessionSet)
      .filter((tabId) => Number.isInteger(tabId))
      .forEach((tabId) => ids.add(tabId));
  }
  Object.values(llmTabMap || {})
    .filter((tabId) => Number.isInteger(tabId))
    .forEach((tabId) => ids.add(tabId));

  const collectExistingTabs = async (idList) => {
    if (!idList.length) return [];
    const tabs = await Promise.all(idList.map((tabId) => new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          untrackSessionTab(tabId);
          resolve(null);
          return;
        }
        const url = tab.url || tab.pendingUrl || '';
        resolve({
          tabId: tab.id,
          url,
          index: tab.index,
          windowId: tab.windowId
        });
      });
    })));
    return tabs
      .filter(Boolean)
      .filter((tab) => typeof tab.url === 'string' && /^https?:\/\//i.test(tab.url))
      .sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  };

  const trackedIds = Array.from(ids);
  trackedIds.forEach((tabId) => trackSessionTab(tabId));
  const trackedTabs = await collectExistingTabs(trackedIds);

  const queried = await new Promise((resolve) => {
    chrome.tabs.query({ url: SESSION_LLM_URL_PATTERNS }, (foundTabs) => {
      if (chrome.runtime.lastError || !Array.isArray(foundTabs)) {
        resolve([]);
        return;
      }
      resolve(foundTabs);
    });
  });

  const allTabs = new Map();
  trackedTabs.forEach((tab) => {
    allTabs.set(tab.tabId, tab);
  });

  queried.forEach((tab) => {
    if (!Number.isInteger(tab.id)) return;
    const url = tab.url || tab.pendingUrl || '';
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (!allTabs.has(tab.id)) {
      trackSessionTab(tab.id);
    }
    allTabs.set(tab.id, {
      tabId: tab.id,
      url,
      index: tab.index,
      windowId: tab.windowId
    });
  });

  const merged = Array.from(allTabs.values())
    .sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  return merged;
};

const registerTabListeners = () => {
  chrome.windows.onFocusChanged.addListener((windowId) => {
    const hasFocus = windowId !== chrome.windows.WINDOW_ID_NONE;
    if (typeof handleBrowserFocusChange === 'function') {
      handleBrowserFocusChange(hasFocus);
    }
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!activeInfo) return;
    if (typeof browserHasFocus !== 'undefined' && !browserHasFocus) return;
    if (typeof handleTabActivation === 'function') {
      handleTabActivation(activeInfo.tabId, activeInfo.windowId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (typeof tabVisitTracker !== 'undefined' && tabVisitTracker.tabId === tabId) {
      if (typeof finalizeTabVisit === 'function') {
        finalizeTabVisit('tab_closed');
      }
    }
    untrackSessionTab(tabId);
  });
};

function isValidTabId(tabId) {
  return Number.isInteger(tabId) && tabId > 0;
}

const saveTabMapToStorage = async (map = llmTabMap) => {
  await chrome.storage.local.set({ llmTabMap: map });
  console.log('[BACKGROUND] Tab map saved to storage:', map);
};

const loadTabMapFromStorage = async () => {
  const data = await chrome.storage.local.get('llmTabMap');
  Object.keys(llmTabMap).forEach((key) => delete llmTabMap[key]);
  if (data.llmTabMap) {
    Object.assign(llmTabMap, data.llmTabMap);
  }
  console.log('[BACKGROUND] Tab map loaded from storage:', llmTabMap);
};

const fallbackRecoveryUsed = new Set();

const TabMapManager = (() => {
  let mutex = Promise.resolve();

  const withLock = (fn) => {
    mutex = mutex.then(() => Promise.resolve(fn())).catch((err) => {
      console.warn('[TabMapManager] lock fn failed', err);
    });
    return mutex;
  };

  const setTab = (llmName, tabId) => withLock(async () => {
    if (!llmName) return;
    if (!isValidTabId(tabId)) {
      delete llmTabMap[llmName];
    } else {
      llmTabMap[llmName] = tabId;
    }
    if (jobState?.llms?.[llmName]) {
      jobState.llms[llmName].tabId = isValidTabId(tabId) ? tabId : null;
    }
    fallbackRecoveryUsed.delete(llmName);
    await saveTabMapToStorage();
  });

  const removeByName = (llmName) => withLock(async () => {
    if (!llmName || !(llmName in llmTabMap)) return;
    delete llmTabMap[llmName];
    if (jobState?.llms?.[llmName]) {
      jobState.llms[llmName].tabId = null;
    }
    await saveTabMapToStorage();
  });

  const removeByTabId = (tabId) => withLock(async () => {
    const name = getNameByTabId(tabId);
    if (name) {
      delete llmTabMap[name];
      if (jobState?.llms?.[name]) {
        jobState.llms[name].tabId = null;
      }
      await saveTabMapToStorage();
    }
  });

const clear = () => withLock(async () => {
  Object.keys(llmTabMap).forEach((key) => delete llmTabMap[key]);
  await saveTabMapToStorage();
  fallbackRecoveryUsed.clear();
});

  const load = () => withLock(async () => {
    await loadTabMapFromStorage();
  });

  const entries = () => Object.entries(llmTabMap);
  const get = (llmName) => llmTabMap[llmName] || null;
  const getNameByTabId = (tabId) => {
    for (const [name, mappedId] of Object.entries(llmTabMap)) {
      if (mappedId === tabId) return name;
    }
    return null;
  };

  return {
    withLock,
    setTab,
    removeByName,
    removeByTabId,
    clear,
    load,
    entries,
    get,
    getNameByTabId
  };
})();

async function setTabBinding(llmName, tabId) {
  if (!llmName) return;
  if (isValidTabId(tabId)) {
    await TabMapManager.setTab(llmName, tabId);
    trackRunTab(tabId);
  } else {
    await TabMapManager.removeByName(llmName);
    tabId = null;
  }
  if (jobState?.llms?.[llmName]) {
    jobState.llms[llmName].tabId = tabId;
  }
}

function getBoundTabId(llmName, entry = null) {
  const runTabIds = Array.isArray(jobState?.session?.boundTabIds)
    ? jobState.session.boundTabIds
    : null;
  const entryTabId = entry?.tabId;
  if (isValidTabId(entryTabId)) {
    if (runTabIds && !runTabIds.includes(entryTabId)) {
      runTabIds.push(entryTabId);
      if (typeof saveJobState === 'function') {
        saveJobState(jobState);
      }
    }
    const mapped = TabMapManager.get(llmName);
    if (!isValidTabId(mapped) && !fallbackRecoveryUsed.has(llmName)) {
      return markFallbackBinding(llmName, entryTabId, entry);
    }
    return entryTabId;
  }
  const mapped = TabMapManager.get(llmName);
  if (isValidTabId(mapped)) {
    if (runTabIds && !runTabIds.includes(mapped)) return null;
    return mapped;
  }
  return null;
}

function markFallbackBinding(llmName, tabId, entry = null) {
  fallbackRecoveryUsed.add(llmName);
  try {
    TabMapManager.setTab(llmName, tabId).catch(() => {});
  } catch (_) {}
  trackSessionTab(tabId);
  trackRunTab(tabId);
  if (jobState?.llms?.[llmName]) {
    jobState.llms[llmName].tabId = null;
  }
  if (entry) {
    entry.tabId = null;
  }
  console.warn(`[TabManager] fallback binding ${llmName}→${tabId}`);
  return tabId;
}

function getTabSafe(tabId) {
  return new Promise((resolve) => {
    if (!isValidTabId(tabId)) {
      resolve(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
      } else {
        resolve(tab);
      }
    });
  });
}

async function captureTabSnapshot(tabId) {
  const tab = await getTabSafe(tabId);
  return buildTabSnapshot(tab);
}

const URL_MATCH_BOUNDARY = new Set(['/', '?', '#']);

function normalizePatternToPrefix(pattern) {
  if (!pattern || typeof pattern !== 'string') return null;
  let normalized = pattern.trim();
  if (!normalized) return null;
  normalized = normalized.replace(/^\*:\/\/?/i, '');
  normalized = normalized.replace(/^\.\//, '');
  const starIndex = normalized.indexOf('*');
  if (starIndex !== -1) {
    normalized = normalized.slice(0, starIndex);
  }
  return normalized || null;
}

function matchesUrlPrefix(url, prefix) {
  if (!url || !prefix) return false;
  const hasExplicitScheme = prefix.includes('://');
  const subject = hasExplicitScheme
    ? url
    : url.replace(/^[a-z]+:\/\//i, '');
  if (!subject.startsWith(prefix)) return false;
  if (subject.length === prefix.length) return true;
  if (prefix.endsWith('/')) return true;
  const nextChar = subject.charAt(prefix.length);
  return URL_MATCH_BOUNDARY.has(nextChar);
}

function compareTabsByOpenRecency(a, b) {
  // Prefer the newest opened tab first (higher tab.id). lastAccessed is only a fallback.
  const aId = Number.isInteger(a?.id) ? a.id : 0;
  const bId = Number.isInteger(b?.id) ? b.id : 0;
  if (bId !== aId) return bId - aId;
  const aTime = typeof a?.lastAccessed === 'number' ? a.lastAccessed : 0;
  const bTime = typeof b?.lastAccessed === 'number' ? b.lastAccessed : 0;
  return bTime - aTime;
}

function matchesQueryPatternUrl(url, llmName) {
  if (!url || !llmName) return false;
  const patterns = getQueryPatternsForLLM(llmName);
  if (!patterns || !patterns.length) return false;
  return patterns.some((pattern) => {
    const prefix = normalizePatternToPrefix(pattern);
    return prefix ? matchesUrlPrefix(url, prefix) : false;
  });
}

function getAllOpenTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError || !Array.isArray(tabs)) {
        resolve([]);
        return;
      }
      resolve(tabs);
    });
  });
}

async function findReusableTabsForLlm(llmName) {
  const tabs = await getAllOpenTabs();
  if (!tabs.length) return [];
  return tabs
    .filter((tab) => tab && typeof tab.url === 'string' && /^https?:\/\//i.test(tab.url))
    .filter((tab) => isEligibleTabForLlm(llmName, tab) && matchesQueryPatternUrl(tab.url, llmName))
    .sort(compareTabsByOpenRecency);
}

function resolveTabForLlmName(llmName, done) {
  const cached = TabMapManager.get(llmName);
  if (cached) {
    done(cached);
    return;
  }
  const entry = LLM_TARGETS[llmName];
  const patterns = entry?.queryPatterns;
  const list = Array.isArray(patterns) ? patterns : (patterns ? [patterns] : []);
  if (!list.length) {
    done(null);
    return;
  }
  const finalize = (tabs) => {
    const runBoundSet = getRunBoundTabIdSet();
    const scopedTabs = runBoundSet
      ? (tabs || []).filter((tab) => runBoundSet.has(tab.id))
      : (tabs || []);
    const eligible = scopedTabs.filter((tab) => isEligibleTabForLlm(llmName, tab));
    if (hasRunBoundTabScope() && !eligible.length) {
      emitTelemetry(llmName, 'RUN_SCOPE_BLOCKED', {
        level: 'warning',
        details: 'resolveTabForLlmName',
        meta: {
          reason: 'scoped_tabs_missing_or_ineligible',
          matched: Array.isArray(tabs) ? tabs.length : 0,
          scoped: scopedTabs.length
        }
      });
    }
    if (!eligible.length) {
      done(null);
      return;
    }
    eligible.sort(compareTabsByOpenRecency);
    const selected = eligible[0] || null;
    if (selected?.id) {
      void setTabBinding(llmName, selected.id);
      done(selected.id);
      return;
    }
    done(null);
  };
  findReusableTabsForLlm(llmName)
    .then((tabs) => {
      if (tabs?.length) {
        finalize(tabs);
        return;
      }
      chrome.tabs.query({ url: list }, (allTabs) => finalize(allTabs));
    })
    .catch(() => finalize([]));
}

function resolveTabForLlmNameAsync(llmName) {
  return new Promise((resolve) => resolveTabForLlmName(llmName, resolve));
}

function getAttachAllowPrefixes(llmName) {
  const entry = LLM_TARGETS[llmName];
  if (!entry) return [];
  if (Array.isArray(entry.attachUrlAllowPrefixes) && entry.attachUrlAllowPrefixes.length) {
    return entry.attachUrlAllowPrefixes;
  }
  const patterns = entry.queryPatterns;
  if (!patterns) return [];
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.map(normalizePatternToPrefix).filter(Boolean);
}

function getAttachDenyPrefixes(llmName) {
  const entry = LLM_TARGETS[llmName];
  if (!entry || !Array.isArray(entry.attachUrlDenyPrefixes)) return [];
  return entry.attachUrlDenyPrefixes.filter(Boolean);
}

function isEligibleTabForLlm(llmName, tab) {
  if (!llmName || !tab || !tab.url) return false;
  const url = tab.url;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
    return false;
  }
  const denyPrefixes = getAttachDenyPrefixes(llmName);
  if (denyPrefixes.some((prefix) => matchesUrlPrefix(url, prefix))) {
    return false;
  }
  const allowPrefixes = getAttachAllowPrefixes(llmName);
  if (!allowPrefixes.length) return true;
  return allowPrefixes.some((prefix) => matchesUrlPrefix(url, prefix));
}

function buildTabSnapshot(tab) {
  if (!tab) return null;
  return {
    tabId: tab.id,
    url: tab.url || '',
    status: tab.status || '',
    discarded: tab.discarded === true,
    active: tab.active === true,
    lastAccessed: typeof tab.lastAccessed === 'number' ? tab.lastAccessed : null,
    windowId: tab.windowId,
    pinned: tab.pinned === true,
    audible: tab.audible === true,
    title: tab.title || ''
  };
}

function buildTabTimingMeta(snapshot) {
  if (!snapshot) return {};
  const ageMs = typeof snapshot.lastAccessed === 'number' ? Math.max(0, Date.now() - snapshot.lastAccessed) : null;
  return {
    discarded: snapshot.discarded === true,
    windowId: snapshot.windowId ?? null,
    lastAccessedAgeMs: ageMs
  };
}

function getQueryPatternsForLLM(llmName) {
  const entry = LLM_TARGETS[llmName];
  if (!entry || !entry.queryPatterns) return null;
  return Array.isArray(entry.queryPatterns) ? entry.queryPatterns : [entry.queryPatterns];
}

function detachExistingTab(llmName) {
  const tabId = TabMapManager.get(llmName);
  if (!tabId) return;
  console.log(`[BACKGROUND] Detaching existing tab ${tabId} for ${llmName}`);
  chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }).catch(() => {});
  removeActiveListenerForTab(tabId);
  closePingWindowForTab(tabId);
  void setTabBinding(llmName, null);
  broadcastGlobalState();
}

function createNewLlmTab(llmName, prompt, attachments = [], options = {}) {
  const llmConfig = jobState.llms[llmName];
  if (!llmConfig) return;
  //-- 1.2. Защита от дублирования вкладок --//
  const existingTabId = TabMapManager.get(llmName);
  if (isValidTabId(existingTabId) && !options.forceCreate) {
    console.log(`[BACKGROUND] Tab for ${llmName} already exists (${existingTabId}), skipping creation`);
    return;
  }
  const creationSessionId = options.sessionId || jobState?.session?.startTime || null;

  //- 2.1. Форсируем чистый запуск без параметров в URL, чтобы сбросить SPA-стейт -//
  const cleanUrl = llmConfig.url.split('?')[0].split('#')[0];
  const createOptions = {
    url: cleanUrl,
    active: !!autoFocusNewTabsEnabled
  };

  chrome.tabs.create(createOptions, async (tab) => {
    if (creationSessionId && jobState?.session?.startTime !== creationSessionId) {
      console.log(`[BACKGROUND] Session changed, skipping tab bind for ${llmName}`);
      return;
    }
    await setTabBinding(llmName, tab.id);
    trackSessionTab(tab.id);
    console.log(`[BACKGROUND] Created and saved tab for ${llmName}: ${tab.id}`);
    broadcastGlobalState();
    emitTelemetry(llmName, 'TAB_CREATED', {
      details: tab?.url || llmConfig.url || '',
      meta: {
        snapshot: buildTabSnapshot(tab),
        reason: 'create_new',
        autoFocus: !!autoFocusNewTabsEnabled
      },
      force: true
    });

    initRequestMetadata(llmName, tab.id, tab.url || llmConfig.url || '');
    broadcastHumanVisitStatus();
    if (!options.deferDispatch) {
      schedulePromptDispatchSupervisor();
    }

    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        const flags = self.getDispatchFlags ? self.getDispatchFlags(llmName, jobState.llms[llmName]) : null;
        const alreadySent = flags ? flags.isSent : !!jobState.llms[llmName].messageSent;
        if (!alreadySent && !options.deferDispatch) {
          console.log(`[BACKGROUND] Tab ${llmName} loaded, queueing prompt dispatch.`);
          dispatchPromptToTab(llmName, tab.id, prompt, attachments, 'tab_loaded');
        }
        removeActiveListenerForTab(tab.id);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timeoutId = setTimeout(() => {
      if (!activeListeners.has(tab.id)) {
        return;
      }
      removeActiveListenerForTab(tab.id);
    }, TAB_LOAD_TIMEOUT_MS);
    activeListeners.set(tab.id, { listener, timeoutId });
  });
}

function tryAttachExistingTab(llmName, prompt, attachments = [], options = {}) {
  return new Promise((resolve) => {
    const attachSessionId = options.sessionId || jobState?.session?.startTime || null;
    const patterns = getQueryPatternsForLLM(llmName);
    if (!patterns || !patterns.length) {
      resolve(false);
      return;
    }
    findReusableTabsForLlm(llmName).then(async (tabs) => {
      if (!tabs || !tabs.length) {
        resolve(false);
        return;
      }
      const runBoundSet = getRunBoundTabIdSet();
      let eligibleTabs = tabs.slice();
      if (runBoundSet) {
        const scopedTabs = eligibleTabs.filter((tab) => runBoundSet.has(tab.id));
        if (scopedTabs.length) {
          eligibleTabs = scopedTabs;
        } else {
          emitTelemetry(llmName, 'RUN_SCOPE_BLOCKED', {
            level: 'warning',
            details: 'tryAttachExistingTab',
            meta: {
              reason: 'scoped_tabs_missing_or_ineligible',
              matched: tabs.length,
              eligible: eligibleTabs.length
            }
          });
          eligibleTabs = [];
        }
      }
      if (!eligibleTabs.length) {
        emitTelemetry(llmName, 'ATTACH_REJECTED', {
          details: `no eligible tabs (matched=${tabs.length})`,
          level: 'warning',
          meta: { reason: 'no_eligible_tabs', matchedCount: tabs.length },
          force: true
        });
        resolve(false);
        return;
      }
      const candidate = eligibleTabs[0];
      try {
        const candidateSnapshot = await captureTabSnapshot(candidate.id);
        emitTelemetry(llmName, 'ATTACH_CANDIDATE', {
          details: candidate?.url || '',
          meta: { snapshot: candidateSnapshot || null, reason: 'attach_existing', runScope: runBoundSet ? 'bound' : 'global' },
          force: true
        });
        const readiness = await ensureTabReadyForDispatch(candidate.id, llmName, { reason: 'attach_existing' });
        if (!readiness.ok) {
          emitTelemetry(llmName, 'ATTACH_REJECTED', {
            details: readiness.reason || 'unknown',
            level: 'warning',
            meta: { snapshot: readiness.snapshot || null, reason: 'attach_existing', runScope: runBoundSet ? 'bound' : 'global' },
            force: true
          });
          resolve(false);
          return;
        }
        if (attachSessionId && jobState?.session?.startTime !== attachSessionId) {
          resolve(false);
          return;
        }
        await prepareTabForUse(candidate.id, llmName);
        await setTabBinding(llmName, candidate.id);
        initRequestMetadata(llmName, candidate.id, readiness.tab?.url || candidate?.url || (LLM_TARGETS[llmName]?.url) || '');
        emitTelemetry(llmName, 'TAB_ATTACHED', {
          details: readiness.tab?.url || candidate?.url || '',
          meta: { snapshot: readiness.snapshot || candidateSnapshot || null, reason: 'attach_existing', runScope: runBoundSet ? 'bound' : 'global' },
          force: true
        });
        if (!options.deferDispatch) {
          dispatchPromptToTab(llmName, candidate.id, prompt, attachments, 'attach_existing');
        }
        broadcastHumanVisitStatus();
        resolve(true);
      } catch (err) {
        console.warn(`[BACKGROUND] Unable to reuse existing tab for ${llmName}:`, err?.message || err);
        emitTelemetry(llmName, 'ATTACH_ERROR', {
          details: err?.message || 'attach_existing failed',
          level: 'error',
          meta: { reason: 'attach_existing_error' },
          force: true
        });
        resolve(false);
      }
    }).catch(() => resolve(false));
  });
}

function activateTabForDispatch(tabId) {
  return new Promise((resolve) => {
    if (!isValidTabId(tabId)) {
      resolve(false);
      return;
    }
    // Keep window geometry intact: only focus/activate, do not force state changes.
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) { resolve(false); return; }
      const winId = tab.windowId;
      chrome.windows.update(winId, { focused: true }, () => {
        chrome.tabs.update(tabId, { active: true }, () => resolve(true));
      });
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = TAB_READY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!isValidTabId(tabId)) {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        done(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(() => done(false), Math.max(0, timeoutMs));
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    if (!isValidTabId(tabId)) {
      resolve(false);
      return;
    }
    chrome.tabs.reload(tabId, () => resolve(!chrome.runtime.lastError));
  });
}

async function ensureTabReadyForDispatch(tabId, llmName, { reason = 'unknown' } = {}) {
  const initialTab = await getTabSafe(tabId);
  const initialSnapshot = buildTabSnapshot(initialTab);
  emitTelemetry(llmName, 'TAB_READY_CHECK', {
    meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
  });
  if (!initialTab) {
    emitTelemetry(llmName, 'TAB_READY_FAIL', {
      details: 'tab_missing',
      level: 'warning',
      meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
    });
    return { ok: false, reason: 'tab_missing', snapshot: initialSnapshot };
  }
  if (!isEligibleTabForLlm(llmName, initialTab)) {
    emitTelemetry(llmName, 'TAB_READY_FAIL', {
      details: 'tab_ineligible',
      level: 'warning',
      meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
    });
    return { ok: false, reason: 'tab_ineligible', snapshot: initialSnapshot };
  }
  if (initialTab.discarded) {
    emitTelemetry(llmName, 'TAB_DISCARDED_RELOAD', {
      level: 'warning',
      meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
    });
    const reloaded = await reloadTab(tabId);
    if (!reloaded) {
      emitTelemetry(llmName, 'TAB_READY_FAIL', {
        details: 'tab_reload_failed',
        level: 'warning',
        meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
      });
      return { ok: false, reason: 'tab_reload_failed', snapshot: initialSnapshot };
    }
    const reloadStart = Date.now();
    const loaded = await waitForTabComplete(tabId, TAB_READY_TIMEOUT_MS);
    emitTelemetry(llmName, 'TAB_READY_WAIT_END', {
      details: `ok=${loaded}`,
      meta: { waitMs: Date.now() - reloadStart, ok: loaded, phase: 'reload', reason, ...buildTabTimingMeta(initialSnapshot) }
    });
    if (!loaded) {
      emitTelemetry(llmName, 'TAB_READY_FAIL', {
        details: 'tab_reload_timeout',
        level: 'warning',
        meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
      });
      return { ok: false, reason: 'tab_reload_timeout', snapshot: initialSnapshot };
    }
  } else if (initialTab.status !== 'complete') {
    const loadStart = Date.now();
    const loaded = await waitForTabComplete(tabId, TAB_READY_TIMEOUT_MS);
    emitTelemetry(llmName, 'TAB_READY_WAIT_END', {
      details: `ok=${loaded}`,
      meta: { waitMs: Date.now() - loadStart, ok: loaded, phase: 'load', reason, ...buildTabTimingMeta(initialSnapshot) }
    });
    if (!loaded) {
      emitTelemetry(llmName, 'TAB_READY_FAIL', {
        details: 'tab_load_timeout',
        level: 'warning',
        meta: { snapshot: initialSnapshot || null, reason, ...buildTabTimingMeta(initialSnapshot) }
      });
      return { ok: false, reason: 'tab_load_timeout', snapshot: initialSnapshot };
    }
  }
  const refreshedTab = await getTabSafe(tabId);
  const refreshedSnapshot = buildTabSnapshot(refreshedTab) || initialSnapshot;
  if (!refreshedTab) {
    emitTelemetry(llmName, 'TAB_READY_FAIL', {
      details: 'tab_missing_after_wait',
      level: 'warning',
      meta: { snapshot: refreshedSnapshot || null, reason, ...buildTabTimingMeta(refreshedSnapshot) }
    });
    return { ok: false, reason: 'tab_missing_after_wait', snapshot: refreshedSnapshot };
  }
  if (!isEligibleTabForLlm(llmName, refreshedTab)) {
    emitTelemetry(llmName, 'TAB_READY_FAIL', {
      details: 'tab_ineligible_after_wait',
      level: 'warning',
      meta: { snapshot: refreshedSnapshot || null, reason, ...buildTabTimingMeta(refreshedSnapshot) }
    });
    return { ok: false, reason: 'tab_ineligible_after_wait', snapshot: refreshedSnapshot };
  }
  if (refreshedTab.discarded) {
    emitTelemetry(llmName, 'TAB_READY_FAIL', {
      details: 'tab_discarded_after_wait',
      level: 'warning',
      meta: { snapshot: refreshedSnapshot || null, reason, ...buildTabTimingMeta(refreshedSnapshot) }
    });
    return { ok: false, reason: 'tab_discarded_after_wait', snapshot: refreshedSnapshot };
  }
  return { ok: true, tab: refreshedTab, snapshot: refreshedSnapshot };
}

function extendPingWindowForTab(tabId, durationMs = AUTO_PING_WINDOW_MS) {
  if (!isValidTabId(tabId)) return;
  if (!pingStartByTabId[tabId]) {
    pingStartByTabId[tabId] = Date.now();
  }
  pingWindowByTabId[tabId] = Date.now() + durationMs;
}

function extendPingWindowForLLM(llmName, durationMs = AUTO_PING_WINDOW_MS) {
  const tabId = TabMapManager.get(llmName);
  if (!tabId) return;
  extendPingWindowForTab(tabId, durationMs);
}

function isPingWindowActive(tabId) {
  if (!isValidTabId(tabId)) return false;
  const expiresAt = pingWindowByTabId[tabId];
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    delete pingWindowByTabId[tabId];
    if (pingStartByTabId[tabId]) {
      delete pingStartByTabId[tabId];
    }
    return false;
  }
  return true;
}

function closePingWindowForTab(tabId) {
  if (!isValidTabId(tabId)) return;
  if (pingWindowByTabId[tabId]) {
    delete pingWindowByTabId[tabId];
  }
  if (pingStartByTabId[tabId]) {
    delete pingStartByTabId[tabId];
  }
}

function closePingWindowForLLM(llmName) {
  const tabId = TabMapManager.get(llmName);
  if (!tabId) return;
  closePingWindowForTab(tabId);
}

function clearPingState() {
  Object.keys(pingWindowByTabId).forEach((tabId) => delete pingWindowByTabId[tabId]);
  Object.keys(pingStartByTabId).forEach((tabId) => delete pingStartByTabId[tabId]);
}

async function findExistingResultsTab() {
  const current = await getTabSafe(resultsTabId);
  if (current) return current;
  try {
    const tabs = await chrome.tabs.query({
      url: [
        chrome.runtime.getURL('result_new.html'),
        chrome.runtime.getURL('pipeline_panel.html')
      ]
    });
    return tabs.find((t) => t?.id) || null;
  } catch (err) {
    console.warn('[BACKGROUND] Failed to query results tabs', err);
    return null;
  }
}

async function getPreferredResultsPageName() {
  try {
    const data = await chrome.storage.local.get('llmComparatorLastPipelineView');
    const view = data?.llmComparatorLastPipelineView;
    return view === 'pipeline' ? 'pipeline_panel.html' : 'result_new.html';
  } catch (err) {
    console.warn('[BACKGROUND] Failed to read pipeline view preference', err);
    return 'result_new.html';
  }
}

async function openOrFocusResultsTab() {
  const preferredPage = await getPreferredResultsPageName();
  const preferredUrl = chrome.runtime.getURL(preferredPage);
  const fallbackUrl = chrome.runtime.getURL(preferredPage === 'pipeline_panel.html' ? 'result_new.html' : 'pipeline_panel.html');
  const current = await getTabSafe(resultsTabId);
  let existing = current;
  if (!existing) {
    const preferredTabs = await chrome.tabs.query({ url: preferredUrl });
    existing = preferredTabs.find((t) => t?.id) || null;
  }
  if (!existing) {
    const fallbackTabs = await chrome.tabs.query({ url: fallbackUrl });
    existing = fallbackTabs.find((t) => t?.id) || null;
  }

  const tabToUse = existing || await new Promise((resolve) => {
    chrome.tabs.create({ url: preferredUrl, active: true }, (tab) => resolve(tab || null));
  });
  if (tabToUse?.id) {
    resultsTabId = tabToUse.id;
    resultsWindowId = tabToUse.windowId || resultsWindowId;
    try {
      chrome.windows.update(tabToUse.windowId, { focused: true }, () => chrome.runtime.lastError);
      chrome.tabs.update(tabToUse.id, { active: true }, () => chrome.runtime.lastError);
    } catch (err) {
      console.warn('[BACKGROUND] Failed to focus results tab', err);
    }
  }
  return tabToUse;
}

chrome.action.onClicked.addListener(() => {
  openOrFocusResultsTab().catch((err) => {
    console.warn('[BACKGROUND] Failed to open results tab', err);
  });
});

// ==================== v2.54 (2025-12-19 19:40): Smart Tab Pre-warming ====================
const PREWARM_MODELS = ['Claude', 'GPT', 'Perplexity'];
const PREWARM_CHECK_INTERVAL = 5 * 60 * 1000;
const PREWARM_CREATE_MISSING_TABS = false;
let prewarmCheckTimer = null;

function hasEnoughMemoryForPrewarm() {
  try {
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
      console.log('[PREWARM] Insufficient device memory, skipping pre-warm');
      return false;
    }
    return true;
  } catch (_) {
    return true;
  }
}

async function createTabQuietly(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.error('[PREWARM] Failed to create tab:', chrome.runtime.lastError);
        resolve(null);
      } else {
        console.log(`[PREWARM] Created background tab ${tab.id} for ${url}`);
        resolve(tab);
      }
    });
  });
}

async function isTabDiscarded(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(true);
      } else {
        resolve(tab.discarded === true);
      }
    });
  });
}

async function smartPrewarmTabs() {
  if (!hasEnoughMemoryForPrewarm()) {
    return;
  }

  if (promptDispatchInProgress > 0) {
    console.log('[PREWARM] Dispatch in progress, skipping pre-warm');
    return;
  }

  console.log('[PREWARM] Starting smart tab pre-warming...');

  for (const llmName of PREWARM_MODELS) {
    const existingTabId = TabMapManager.get(llmName);

    if (existingTabId) {
      const discarded = await isTabDiscarded(existingTabId);

      if (discarded) {
        console.log(`[PREWARM] Tab ${existingTabId} for ${llmName} is discarded, reloading...`);
        try {
          await chrome.tabs.reload(existingTabId);
          console.log(`[PREWARM] Reloaded tab ${existingTabId} for ${llmName}`);
        } catch (err) {
          console.error(`[PREWARM] Failed to reload tab for ${llmName}:`, err);
          await TabMapManager.removeByTabId(existingTabId);
          if (PREWARM_CREATE_MISSING_TABS) {
            await prewarmSingleModel(llmName);
          } else {
            console.log(`[PREWARM] Skip creating missing tab for ${llmName} (disabled)`);
          }
        }
      } else {
        console.log(`[PREWARM] Tab ${existingTabId} for ${llmName} is already active`);
      }
    } else {
      if (PREWARM_CREATE_MISSING_TABS) {
        await prewarmSingleModel(llmName);
      } else {
        console.log(`[PREWARM] Skip creating tab for ${llmName} (disabled)`);
      }
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('[PREWARM] Pre-warming complete');
}

async function prewarmSingleModel(llmName) {
  const llmConfig = LLM_TARGETS[llmName];
  if (!llmConfig || !llmConfig.url) {
    console.warn(`[PREWARM] No config for ${llmName}`);
    return;
  }

  console.log(`[PREWARM] Creating pre-warmed tab for ${llmName}...`);
  const tab = await createTabQuietly(llmConfig.url);

  if (tab) {
    await setTabBinding(llmName, tab.id);
    console.log(`[PREWARM] Successfully pre-warmed ${llmName} on tab ${tab.id}`);
  }
}

function schedulePrewarmCheck() {
  if (prewarmCheckTimer) {
    clearTimeout(prewarmCheckTimer);
  }

  prewarmCheckTimer = setTimeout(() => {
    smartPrewarmTabs().catch(err => {
      console.error('[PREWARM] Check failed:', err);
    }).finally(() => {
      schedulePrewarmCheck();
    });
  }, PREWARM_CHECK_INTERVAL);
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[BACKGROUND] Extension installed/updated:', details);

  if (details.reason !== 'update') {
    setTimeout(() => {
      smartPrewarmTabs().catch(err => {
        console.error('[PREWARM] Initial pre-warm failed:', err);
      });
    }, 10000);
  } else {
    console.log('[PREWARM] Skipped initial pre-warm on update');
  }

  schedulePrewarmCheck();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[BACKGROUND] Browser started, scheduling pre-warm...');

  setTimeout(() => {
    smartPrewarmTabs().catch(err => {
      console.error('[PREWARM] Startup pre-warm failed:', err);
    });
  }, 15000);

  schedulePrewarmCheck();
});

console.log('[BACKGROUND] v2.54 Smart Tab Pre-warming initialized');

loadSessionTabs();
registerTabListeners();

self.loadSessionTabs = loadSessionTabs;
self.persistSessionTabs = persistSessionTabs;
self.trackSessionTab = trackSessionTab;
self.untrackSessionTab = untrackSessionTab;
self.getTrackedSessionTabs = getTrackedSessionTabs;
self.registerTabListeners = registerTabListeners;
self.saveTabMapToStorage = saveTabMapToStorage;
self.loadTabMapFromStorage = loadTabMapFromStorage;
self.TabMapManager = TabMapManager;
self.setTabBinding = setTabBinding;
self.getBoundTabId = getBoundTabId;
self.isValidTabId = isValidTabId;
self.getTabSafe = getTabSafe;
self.captureTabSnapshot = captureTabSnapshot;
self.normalizePatternToPrefix = normalizePatternToPrefix;
self.matchesUrlPrefix = matchesUrlPrefix;
self.resolveTabForLlmName = resolveTabForLlmName;
self.resolveTabForLlmNameAsync = resolveTabForLlmNameAsync;
self.getAttachAllowPrefixes = getAttachAllowPrefixes;
self.getAttachDenyPrefixes = getAttachDenyPrefixes;
self.isEligibleTabForLlm = isEligibleTabForLlm;
self.buildTabSnapshot = buildTabSnapshot;
self.buildTabTimingMeta = buildTabTimingMeta;
self.getQueryPatternsForLLM = getQueryPatternsForLLM;
self.detachExistingTab = detachExistingTab;
self.createNewLlmTab = createNewLlmTab;
self.tryAttachExistingTab = tryAttachExistingTab;
self.activateTabForDispatch = activateTabForDispatch;
self.waitForTabComplete = waitForTabComplete;
self.reloadTab = reloadTab;
self.ensureTabReadyForDispatch = ensureTabReadyForDispatch;
self.extendPingWindowForTab = extendPingWindowForTab;
self.extendPingWindowForLLM = extendPingWindowForLLM;
self.isPingWindowActive = isPingWindowActive;
self.closePingWindowForTab = closePingWindowForTab;
self.closePingWindowForLLM = closePingWindowForLLM;
self.clearPingState = clearPingState;
self.findExistingResultsTab = findExistingResultsTab;
self.openOrFocusResultsTab = openOrFocusResultsTab;
self.smartPrewarmTabs = smartPrewarmTabs;
self.schedulePrewarmCheck = schedulePrewarmCheck;

console.log('[TabManager] Module loaded');
