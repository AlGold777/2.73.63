# Diagnostics Production Plan (2026-01-26)

Source: Diagnostics Logs 20260126_22-08.html
Window: ~22:00:08-22:03:44

## Executive summary
The session shows a mix of successful flows (Gemini/DeepSeek) and repeated UI detection failures (Qwen/Grok/Claude), plus pipeline hard timeouts (GPT/Claude) and handshake failures (Perplexity). These are production-impacting because they block message submission or completion detection.

## Evidence highlights
- GPT: Submit confirmation exists, but PIPELINE_ERROR hard_timeout at 22:00:59 and Status: ERROR. ROUND2_VERIFY later says prompt not confirmed as sent.
- Gemini: Pipeline start and streaming start appear (22:02:05-22:02:06). No end-state recorded.
- Claude: 57x SELECTOR_MISS (regenerate/retry/continue). PIPELINE_ERROR hard_timeout at 22:03:44. Status: SUCCESS recorded without requestId.
- Grok: Ctrl+Enter produced no response, prompt confirmation timeout, DOM_FALLBACK_START, and many SELECTOR_MISS with visible=false.
- Qwen: SELECTOR_RESOLVE_FAIL for sendButton twice, prompt confirmation timeout, 42x SELECTOR_MISS (send/textarea/stop), SUCCESS without requestId.
- Perplexity: ACK_READY not received (6000ms), then ROUND2_VERIFY says prompt not confirmed as sent.

## Prioritized production plan

## Summary table (LLM → problem → action → acceptance)

| LLM | Problem | Action | Acceptance criteria |
| --- | --- | --- | --- |
| Qwen | sendButton not resolved, repeated SELECTOR_RESOLVE_FAIL, prompt confirmation timeout | Add/update versioned selectors for send/textarea/stop; fix UI version detection; ensure elements are visible before click | No SELECTOR_RESOLVE_FAIL; submit confirmation within 2-5s; SUCCESS with non-null requestId |
| Grok | Submit not confirmed; DOM fallback starts; selectors not visible | Ensure tab activation/focus; refresh Grok send/stop selectors; handle SPA render timing | No confirmation timeout; no DOM_FALLBACK_START in normal runs; submit confirmation received |
| Claude | Regenerate/retry/continue selectors missed; hard timeout; SUCCESS with null requestId | Update Claude selectors; investigate null requestId on success | SELECTOR_MISS eliminated; no hard_timeout; SUCCESS includes requestId |
| GPT | Hard timeout after submit confirmation; ROUND2_VERIFY | Validate streaming/completion detection; review timeout thresholds | No hard_timeout; completion aligns with submit confirmation |
| Perplexity | ACK_READY not received; ROUND2_VERIFY | Verify content script injection and readiness signal timing | No ACK_READY timeout; prompt confirmed without round2 verify |

### 1) Qwen - sendButton resolution fails (blocker)
Problem signals:
- SELECTOR_RESOLVE_FAIL (sendButton), versioned layer has no selectors, autodiscovery finds no candidates, prompt confirmation timeout.
Actions:
- Add or update versioned selectors for Qwen send/textarea/stop.
- Verify UI version detection for Qwen to avoid falling back to empty versioned layer.
- Ensure send/textarea are visible before click attempts.
Acceptance:
- No SELECTOR_RESOLVE_FAIL.
- Submit confirmation within 2-5 seconds.
- Final status has non-null requestId.

### 2) Grok - submit not confirmed + fallback
Problem signals:
- Ctrl+Enter produced no response; prompt confirmation timeout; DOM_FALLBACK_START.
- SELECTOR_MISS on stop/send/textarea with visible=false.
Actions:
- Ensure tab activation and focus before sending.
- Refresh Grok selectors for send/stop; handle SPA render timing.
- Confirm send detection logic triggers on Grok DOM state changes.
Acceptance:
- No prompt confirmation timeout.
- No DOM_FALLBACK_START in normal runs.
- Submit confirmation received reliably.

### 3) Claude - selector misses + pipeline hard timeout
Problem signals:
- 57x SELECTOR_MISS (regenerate/retry/continue).
- PIPELINE_ERROR hard_timeout.
- Status SUCCESS without requestId.
Actions:
- Update selectors for Claude regenerate/retry/continue.
- Investigate why requestId becomes null during success signaling.
Acceptance:
- SELECTOR_MISS eliminated.
- No hard_timeout in pipeline.
- SUCCESS includes valid requestId.

### 4) GPT - pipeline hard timeout after submit confirmation
Problem signals:
- Submit confirmation exists, then PIPELINE_ERROR hard_timeout and Response error.
- ROUND2_VERIFY shows prompt not confirmed as sent.
Actions:
- Validate GPT streaming detection and completion signals.
- Review timeout thresholds versus observed response timing.
Acceptance:
- No PIPELINE_ERROR hard_timeout.
- Completion/stop states align with submit confirmation.

### 5) Perplexity - ACK_READY missing
Problem signals:
- ACK_READY not received (6000ms), then ROUND2_VERIFY.
Actions:
- Verify content script injection and readiness signal dispatch.
- Confirm readiness event fires after DOM is fully ready.
Acceptance:
- No ACK_READY timeouts.
- Prompt confirmed as sent without round2 verification.

### 6) Global verification - stop/start timer hygiene
Note:
- Diagnostics logs do not include SW logs ([HEALTH-CHECK]/[DISPATCH]).
Actions:
- Run stop->start cycles with SW logs enabled.
- Confirm clearSessionTimers() logs zero leftovers.
Acceptance:
- No leftover timers after stop->start.

## Artifacts to collect next run
- SW logs with [HEALTH-CHECK]/[DISPATCH].
- Screenshot or DOM snapshot for Qwen/Grok/Claude on selector failures.
- One full end-to-end trace with requestId present from dispatch to completion.
