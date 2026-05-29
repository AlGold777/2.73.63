// background/rate-limit.js
// Rate limit tracking for LLM dispatch.

'use strict';

var rateLimitState = new Map();
var rateLimitTimers = new Map();

function isRateLimited(llmName) {
  const until = rateLimitState.get(llmName);
  return typeof until === 'number' && until > Date.now();
}

function setRateLimit(llmName, ms = 60000, message = '') {
  const until = Date.now() + ms;
  rateLimitState.set(llmName, until);
  updateModelState(llmName, 'RATE_LIMIT', {
    message: message || `Rate limited until ${new Date(until).toLocaleTimeString()}`
  });
  broadcastGlobalState();
}

function scheduleAfterRateLimit(llmName, fn) {
  const until = rateLimitState.get(llmName);
  if (!until || until <= Date.now()) {
    rateLimitState.delete(llmName);
    fn();
    return;
  }
  if (rateLimitTimers.has(llmName)) return;
  const delay = Math.max(500, until - Date.now());
  const timerId = setTimeout(() => {
    rateLimitTimers.delete(llmName);
    rateLimitState.delete(llmName);
    fn();
  }, delay);
  rateLimitTimers.set(llmName, timerId);
}

self.rateLimitState = rateLimitState;
self.rateLimitTimers = rateLimitTimers;
self.isRateLimited = isRateLimited;
self.setRateLimit = setRateLimit;
self.scheduleAfterRateLimit = scheduleAfterRateLimit;
