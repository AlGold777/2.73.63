// shared/recovery-intent.js
// Recovery action safety contract. Keeps observe-only recovery separate from prompt resend.

(function initRecoveryIntent(root) {
  'use strict';

  const INTENTS = Object.freeze({
    OBSERVE_ONLY: 'observe_only',
    FOCUS_ONLY: 'focus_only',
    NUDGE_GENERATION: 'nudge_generation',
    COMPOSER_REPAIR: 'composer_repair',
    RESEND_PROMPT: 'resend_prompt'
  });

  const MUTATING_INTENTS = new Set([
    INTENTS.COMPOSER_REPAIR,
    INTENTS.RESEND_PROMPT
  ]);

  function normalizeIntent(intent) {
    const value = String(intent || '').trim().toLowerCase();
    if (Object.values(INTENTS).includes(value)) return value;
    if (value.includes('resend') || value.includes('repair_dispatch')) return INTENTS.RESEND_PROMPT;
    if (value.includes('composer_repair')) return INTENTS.COMPOSER_REPAIR;
    if (value.includes('focus') || value.includes('visit')) return INTENTS.FOCUS_ONLY;
    if (value.includes('nudge') || value.includes('scroll')) return INTENTS.NUDGE_GENERATION;
    return INTENTS.OBSERVE_ONLY;
  }

  function hasTerminalEligibleEvidence(entry = {}, options = {}) {
    const minChars = Number(options.minChars || 120);
    const answerLength = String(entry.answer || '').trim().length;
    const pendingLength = String(entry.pendingFinalAnswer || '').trim().length;
    const snapshotLength = Number(entry.answerCompleteTextLength || entry.lifecycleReadyMeta?.textLength || entry.lastAnswerSnapshotLength || 0);
    return Boolean(
      answerLength >= minChars
      || pendingLength >= minChars
      || snapshotLength >= minChars
      || entry.lifecycleReadyAt
      || entry.answerCompleteDetectedAt
      || entry.finalizationEvidence?.hasAnswerEvidence
    );
  }

  function authorize(entry = {}, request = {}) {
    const intent = normalizeIntent(request.intent || request.reason || request.action);
    const evidenceHit = hasTerminalEligibleEvidence(entry, request);
    const mutatesPage = MUTATING_INTENTS.has(intent);
    const explicitOverride = request.explicitUserOverride === true && request.allowAfterEvidence === true;
    if (mutatesPage && evidenceHit && !explicitOverride) {
      return {
        ok: false,
        intent,
        reason: 'no_resend_after_answer_evidence',
        mutatesPage,
        evidenceHit
      };
    }
    return {
      ok: true,
      intent,
      reason: evidenceHit ? 'allowed_with_answer_evidence' : 'allowed_no_answer_evidence',
      mutatesPage,
      evidenceHit
    };
  }

  const api = Object.freeze({
    INTENTS,
    normalizeIntent,
    hasTerminalEligibleEvidence,
    authorize
  });

  root.RecoveryIntent = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
