// shared/model-policy.js
// Minimal runtime policy for model-specific orchestration decisions.

(function initModelPolicy(root) {
  'use strict';

  const DEFAULT_POLICY = Object.freeze({
    stableTextMs: 1200,
    terminalFailureRequiresEvidenceMiss: true,
    extractionPriority: Object.freeze(['preserved', 'snapshot', 'inlineDom', 'contentScript']),
    requireAckReady: true,
    transportErrorsRecoverable: true,
    conservativeDispatch: false,
    promptSubmitTimeoutMs: 15000
  });

  const MODEL_POLICIES = Object.freeze({
    GPT: Object.freeze({
      promptSubmitTimeoutMs: 15000
    }),
    Gemini: Object.freeze({
      stableTextMs: 1800,
      promptSubmitTimeoutMs: 20000
    }),
    Claude: Object.freeze({
      stableTextMs: 1800,
      promptSubmitTimeoutMs: 20000
    }),
    Grok: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000
    }),
    'Le Chat': Object.freeze({
      stableTextMs: 1600,
      promptSubmitTimeoutMs: 20000
    }),
    Qwen: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000
    }),
    DeepSeek: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 22000
    }),
    Perplexity: Object.freeze({
      stableTextMs: 1600,
      requireAckReady: false,
      promptSubmitTimeoutMs: 8000
    })
  });

  function normalizeModelName(llmName = '') {
    const value = String(llmName || '').trim();
    if (!value) return '';
    const lower = value.toLowerCase();
    if (lower === 'lechat' || lower === 'le chat') return 'Le Chat';
    if (lower === 'chatgpt' || lower === 'openai') return 'GPT';
    if (lower === 'pplx') return 'Perplexity';
    return value;
  }

  function getModelPolicy(llmName = '') {
    const key = normalizeModelName(llmName);
    return Object.freeze({
      ...DEFAULT_POLICY,
      ...(MODEL_POLICIES[key] || {})
    });
  }

  function getModelPolicyValue(llmName, field, fallback = undefined) {
    const policy = getModelPolicy(llmName);
    return Object.prototype.hasOwnProperty.call(policy, field) ? policy[field] : fallback;
  }

  function modelRequiresAckReady(llmName) {
    return getModelPolicy(llmName).requireAckReady !== false;
  }

  function modelUsesConservativeDispatch(llmName) {
    return getModelPolicy(llmName).conservativeDispatch === true;
  }

  function getPromptSubmitTimeoutMs(llmName, fallback = 7000) {
    const value = Number(getModelPolicy(llmName).promptSubmitTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  const api = Object.freeze({
    DEFAULT_POLICY,
    MODEL_POLICIES,
    normalizeModelName,
    getModelPolicy,
    getModelPolicyValue,
    modelRequiresAckReady,
    modelUsesConservativeDispatch,
    getPromptSubmitTimeoutMs
  });

  root.ModelPolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
