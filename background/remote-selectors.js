// background/remote-selectors.js
// Remote selectors override fetch + alarms.

'use strict';

const REMOTE_SELECTORS_URL = 'https://algold777.github.io/llm-selectors-override/selectors-override.json';
const REMOTE_SELECTORS_ENABLED = false; // защищаемся по умолчанию: только opt-in
const REMOTE_SELECTORS_FLAG_KEY = 'enable_remote_selectors_override';
const TRUSTED_SELECTORS_SHA256 = 'l5uHcdPmwljhH9bp2XnxmJPLz4rSrf3dEIBh/6v7IGw='; // Hardcoded, never stored in storage.
const REMOTE_SELECTORS_REFRESH_MS = 6 * 60 * 60 * 1000;
const REMOTE_SELECTORS_ALARM = 'remote_selectors_refresh';
const REMOTE_SELECTORS_FETCH_TIMEOUT_MS = 15000;

var remoteSelectorsAllowed = REMOTE_SELECTORS_ENABLED;

chrome.storage.local.get(REMOTE_SELECTORS_FLAG_KEY, (data) => {
  if (typeof data?.[REMOTE_SELECTORS_FLAG_KEY] === 'boolean') {
    remoteSelectorsAllowed = data[REMOTE_SELECTORS_FLAG_KEY];
  }
  self.remoteSelectorsAllowed = remoteSelectorsAllowed;
  if (remoteSelectorsAllowed) {
    fetchRemoteSelectors().catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[REMOTE_SELECTORS_FLAG_KEY]) {
    remoteSelectorsAllowed = !!changes[REMOTE_SELECTORS_FLAG_KEY].newValue;
    self.remoteSelectorsAllowed = remoteSelectorsAllowed;
    if (remoteSelectorsAllowed) {
      fetchRemoteSelectors().catch(() => {});
    }
  }
});

async function fetchRemoteSelectors() {
  if (!remoteSelectorsAllowed) {
    console.info('[REMOTE-SELECTORS] Skipped: remote overrides disabled');
    return { success: false, error: 'remote_overrides_disabled' };
  }
  if (!REMOTE_SELECTORS_URL) {
    return { success: false, error: 'REMOTE_SELECTORS_URL not configured' };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REMOTE_SELECTORS_FETCH_TIMEOUT_MS);
    const response = await fetch(REMOTE_SELECTORS_URL, {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payloadText = await response.text();
    if (TRUSTED_SELECTORS_SHA256) {
      const hash = await computeSha256Base64(payloadText);
      if (!hash) {
        throw new Error('Hash verification unavailable');
      }
      if (hash !== TRUSTED_SELECTORS_SHA256) {
        console.error('[REMOTE-SELECTORS] Payload hash mismatch', {
          observed: hash,
          trusted: TRUSTED_SELECTORS_SHA256
        });
        await chrome.storage.local.remove(['selectors_remote_override', 'selectors_remote_fetched_at', 'selectors_remote_override_hash']);
        throw new Error('Override payload hash mismatch');
      }
    }
    const data = JSON.parse(payloadText);
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid selectors override payload');
    }
    await chrome.storage.local.set({
      selectors_remote_override: data,
      selectors_remote_fetched_at: Date.now(),
      selectors_remote_override_hash: hash
    });
    console.info('[REMOTE-SELECTORS] Override stored successfully');
    return { success: true };
  } catch (error) {
    console.warn('[REMOTE-SELECTORS] Fetch failed:', error?.message || error);
    return { success: false, error: error?.message || 'fetch failed' };
  }
}

async function computeSha256Base64(input) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest));
    return btoa(String.fromCharCode(...bytes));
  } catch (err) {
    console.warn('[REMOTE-SELECTORS] SHA-256 unavailable:', err?.message || err);
    return null;
  }
}

async function clearSelectorOverridesAndCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((key) => {
    return key === 'selectors_remote_override' ||
      key === 'selectors_remote_fetched_at' ||
      key === 'selectors_remote_override_hash' ||
      key.startsWith('selector_cache_');
  });
  if (keysToRemove.length) {
    await chrome.storage.local.remove(keysToRemove);
  }
  console.info('[REMOTE-SELECTORS] Overrides/cache cleared:', keysToRemove);
  return { success: true, removed: keysToRemove };
}

if (remoteSelectorsAllowed) {
  fetchRemoteSelectors();
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    if (remoteSelectorsAllowed) {
      chrome.alarms.create(REMOTE_SELECTORS_ALARM, { periodInMinutes: REMOTE_SELECTORS_REFRESH_MS / 60000 });
      fetchRemoteSelectors();
    } else {
      chrome.alarms.clear(REMOTE_SELECTORS_ALARM);
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  if (remoteSelectorsAllowed) {
    chrome.alarms.create(REMOTE_SELECTORS_ALARM, { periodInMinutes: REMOTE_SELECTORS_REFRESH_MS / 60000 });
    fetchRemoteSelectors();
  } else {
    chrome.alarms.clear(REMOTE_SELECTORS_ALARM);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMOTE_SELECTORS_ALARM) {
    if (remoteSelectorsAllowed) {
      fetchRemoteSelectors();
    }
  }
});

self.REMOTE_SELECTORS_URL = REMOTE_SELECTORS_URL;
self.REMOTE_SELECTORS_ENABLED = REMOTE_SELECTORS_ENABLED;
self.REMOTE_SELECTORS_FLAG_KEY = REMOTE_SELECTORS_FLAG_KEY;
self.TRUSTED_SELECTORS_SHA256 = TRUSTED_SELECTORS_SHA256;
self.REMOTE_SELECTORS_EXPECTED_SHA256 = TRUSTED_SELECTORS_SHA256;
self.REMOTE_SELECTORS_REFRESH_MS = REMOTE_SELECTORS_REFRESH_MS;
self.REMOTE_SELECTORS_ALARM = REMOTE_SELECTORS_ALARM;
self.REMOTE_SELECTORS_FETCH_TIMEOUT_MS = REMOTE_SELECTORS_FETCH_TIMEOUT_MS;
self.remoteSelectorsAllowed = remoteSelectorsAllowed;
self.fetchRemoteSelectors = fetchRemoteSelectors;
self.clearSelectorOverridesAndCache = clearSelectorOverridesAndCache;
