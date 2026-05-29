// background/circuit-breaker.js
// Circuit breaker state and persistence for repeated model failures.

'use strict';

let circuitBreakerState = {};
const FAILURE_THRESHOLD = 3;
const COOLDOWN_PERIOD_MS = 5 * 60 * 1000;
const CIRCUIT_BREAKER_STORAGE_KEY = 'circuitBreakerState';
const resolveCircuitStorageAreas = () => {
  if (chrome?.storage?.session) {
    return { primary: 'session', fallback: 'local' };
  }
  return { primary: 'local', fallback: null };
};
const { primary: CIRCUIT_PRIMARY_AREA, fallback: CIRCUIT_FALLBACK_AREA } = resolveCircuitStorageAreas();
const getCircuitStorage = (area) => (area && chrome?.storage?.[area]) || null;

async function loadCircuitBreakerState() {
  try {
    const primaryStore = getCircuitStorage(CIRCUIT_PRIMARY_AREA);
    if (primaryStore) {
      const primaryStored = await primaryStore.get(CIRCUIT_BREAKER_STORAGE_KEY);
      if (primaryStored?.[CIRCUIT_BREAKER_STORAGE_KEY]) {
        circuitBreakerState = primaryStored[CIRCUIT_BREAKER_STORAGE_KEY];
        console.log(`[BACKGROUND] Circuit breaker state restored from ${CIRCUIT_PRIMARY_AREA}`);
        return;
      }
    }
    const fallbackStore = getCircuitStorage(CIRCUIT_FALLBACK_AREA);
    if (fallbackStore) {
      const fallbackStored = await fallbackStore.get(CIRCUIT_BREAKER_STORAGE_KEY);
      if (fallbackStored?.[CIRCUIT_BREAKER_STORAGE_KEY]) {
        circuitBreakerState = fallbackStored[CIRCUIT_BREAKER_STORAGE_KEY];
        console.log(`[BACKGROUND] Circuit breaker state migrated from ${CIRCUIT_FALLBACK_AREA} to ${CIRCUIT_PRIMARY_AREA}`);
        if (primaryStore) {
          await primaryStore.set({ [CIRCUIT_BREAKER_STORAGE_KEY]: circuitBreakerState });
        }
        await fallbackStore.remove(CIRCUIT_BREAKER_STORAGE_KEY);
      }
    }
  } catch (err) {
    console.warn('[BACKGROUND] Failed to load circuit breaker state:', err);
  }
}

async function persistCircuitBreakerState() {
  try {
    const primaryStore = getCircuitStorage(CIRCUIT_PRIMARY_AREA);
    if (primaryStore) {
      await primaryStore.set({ [CIRCUIT_BREAKER_STORAGE_KEY]: circuitBreakerState });
    }
    const fallbackStore = getCircuitStorage(CIRCUIT_FALLBACK_AREA);
    if (fallbackStore) {
      await fallbackStore.remove(CIRCUIT_BREAKER_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[BACKGROUND] Failed to persist circuit breaker state:', err);
  }
}

function initializeCircuitBreakers(llmNames) {
  if (!Array.isArray(llmNames)) return;
  llmNames.forEach((name) => {
    if (!circuitBreakerState[name]) {
      circuitBreakerState[name] = { failures: 0, state: 'CLOSED', reopensAt: null };
    }
  });
  persistCircuitBreakerState();
}

function allowCircuitHalfOpenForNewRun(llmNames) {
  if (!Array.isArray(llmNames) || !llmNames.length) return;
  let changed = false;
  llmNames.forEach((name) => {
    const breaker = circuitBreakerState?.[name];
    if (!breaker) return;
    if (breaker.state === 'OPEN') {
      breaker.state = 'HALF_OPEN';
      breaker.failures = Math.max(0, FAILURE_THRESHOLD - 1);
      breaker.reopensAt = null;
      changed = true;
    }
  });
  if (changed) {
    console.log('[CIRCUIT-BREAKER] Reset OPEN circuits to HALF_OPEN for new run.');
    persistCircuitBreakerState();
  }
}

function updateCircuitBreaker(llmName, isSuccess) {
  if (!circuitBreakerState[llmName]) return;

  const breaker = circuitBreakerState[llmName];
  if (isSuccess) {
    if (breaker.state !== 'CLOSED') {
      console.log(`[CIRCUIT-BREAKER] ${llmName} recovered. State: CLOSED.`);
    }
    breaker.failures = 0;
    breaker.state = 'CLOSED';
    breaker.reopensAt = null;
  } else {
    breaker.failures += 1;
    console.log(`[CIRCUIT-BREAKER] ${llmName} failed. Failure count: ${breaker.failures}`);
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.state = 'OPEN';
      breaker.reopensAt = Date.now() + COOLDOWN_PERIOD_MS;
      console.error(`[CIRCUIT-BREAKER] ${llmName} is now OPEN. Will reopen at ${new Date(breaker.reopensAt).toLocaleTimeString()}`);
      if (typeof updateModelState === 'function') {
        updateModelState(llmName, 'CIRCUIT_OPEN', { message: 'Model temporarily disabled due to repeated failures.' });
      }
    }
  }
  persistCircuitBreakerState();
}

self.circuitBreakerState = circuitBreakerState;
self.FAILURE_THRESHOLD = FAILURE_THRESHOLD;
self.COOLDOWN_PERIOD_MS = COOLDOWN_PERIOD_MS;
self.CIRCUIT_BREAKER_STORAGE_KEY = CIRCUIT_BREAKER_STORAGE_KEY;
self.loadCircuitBreakerState = loadCircuitBreakerState;
self.persistCircuitBreakerState = persistCircuitBreakerState;
self.initializeCircuitBreakers = initializeCircuitBreakers;
self.allowCircuitHalfOpenForNewRun = allowCircuitHalfOpenForNewRun;
self.updateCircuitBreaker = updateCircuitBreaker;

console.log('[CircuitBreaker] Module loaded');
