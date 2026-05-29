# Tab Run Plan

Purpose: document how the extension visits tabs during a run so the focus plan is predictable.

## Round 0 — Open Tabs
- Goal: open or attach tabs for each selected model.
- Source: `background/job-orchestrator.js`.
- Timing:
  - Stagger between tab opens: 1000ms (`ROUND0_OPEN_STAGGER_MS`).
- Notes:
  - Tabs may be created or attached to existing sessions.
  - Round0 emits `ROUND0_START/END` plus per-model attach markers.

## Round 1 — Dispatch
- Goal: send the prompt.
- Source: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.
- Default behavior:
  - Focus is taken when required to submit.
  - Prompt submission is confirmed by content when possible.
- Timing:
  - Pre-send delay: 500ms (`ROUND1_BEFORE_SEND_MS`).
  - Post-send wait: 500ms (`ROUND1_POST_SEND_MS`).
  - Total dispatch pacing target: 1000ms (pre + post).
- Budgets:
  - Dispatch budget: 120000ms (`DISPATCH_BUDGET_MS`).
- Telemetry:
  - `ROUND1_START` / `ROUND1_END` (per model).

## Round 2 — Verify (mandatory)
- Goal: ensure prompt submission is confirmed.
- Source: `background/job-orchestrator.js`, `background/human-presence.js`.
- Behavior:
  - `ROUND2_START/END` is emitted for every selected model (mandatory telemetry visibility).
  - Already confirmed models skip long verification but still get immediate probe scheduling.
  - Unconfirmed models receive forced automation visits for submission verification.
  - Each visit includes light scrolling.
- Timing:
  - Forced visits: 2 by default (`ROUND2_VISIT_COUNT`).
  - Visit dwell: 5000–8000ms (`ROUND2_VISIT_MIN_MS`–`ROUND2_VISIT_MAX_MS`).
- Telemetry:
  - `ROUND2_START` / `ROUND2_END`.
  - `FORCED_VISIT` entries show visit reason and timing.
  - Skip reasons are explicit in `ROUND2_END.meta.reason` (`api_dispatch`, `already_confirmed`, `tab_not_found`, `not_confirmed`, `confirmed`).

## Round 3 — Collect
- Goal: collect responses from incomplete models.
- Source: `background/job-orchestrator.js`.
- Behavior:
  - Models already completed are marked as skipped.
  - Incomplete models get a short pre-collect visit before extraction.
- Timing:
  - Collect delay before visiting: 2000ms (`ROUND3_COLLECT_DELAY_MS`).
  - Pre-collect visits: 1 (`ROUND3_PRECOLLECT_VISIT_COUNT`).
  - Pre-collect dwell: 5000–8000ms (`ROUND3_PRECOLLECT_VISIT_MIN_MS`–`ROUND3_PRECOLLECT_VISIT_MAX_MS`).
- Budgets:
  - Collect budget: 60000ms (`COLLECT_BUDGET_MS`).
- Telemetry:
  - `ROUND3_START` / `ROUND3_END`.
  - Completed models emit `ROUND3_START/END` with "skipped".

## Round 4 — Results Focus
- Goal: return focus to the results page after collection.
- Source: `background/job-orchestrator.js`.
- Timing:
  - Focus delay: 500ms (`ROUND4_FOCUS_DELAY_MS`).
- Telemetry:
  - `ROUND4_START` / `ROUND4_END`.

## Human Presence Loop (post-rounds)
- Goal: keep tabs alive for pending models if needed.
- Source: `background/human-presence.js`.
- Behavior:
  - Runs only when there are pending (non-terminal) models.
  - Stops automatically when all models are terminal or skipped.
  - Terminal models are ignored even if their status string is stale.
- Timing:
  - Initial delay: 7000ms (`HUMAN_VISIT_INITIAL_DELAY_MS`).
  - Dwell per visit: 3000ms (`HUMAN_VISIT_DWELL_MS`).
  - Scroll duration per visit: 3600ms (`HUMAN_VISIT_SCROLL_DURATION_MS`).
  - Pause between loops: 1500ms (`HUMAN_VISIT_LOOP_PAUSE_MS`).
  - Hard-cap per active visit: 12000ms (`HUMAN_VISIT_HARD_CAP_MS`), then force-release.

## Adaptive Response Probing (per model)
- Goal: detect completion quickly after real prompt submission without waiting for manual tab visits.
- Source: `background/job-orchestrator.js`, `background/message-router.js`.
- Trigger:
  - Starts on `PROMPT_SUBMITTED` confirmation for each model.
  - Re-armed after Round2/Round3 probes if model is still not finalized.
- Timing:
  - Fast phase: every 2500ms for first 0-20s after `promptSubmittedAt` (`ADAPTIVE_PROBE_FAST_*`).
  - Medium phase: every 6000ms for 20-60s (`ADAPTIVE_PROBE_MEDIUM_*`).
  - Slow phase: every 12000ms for 60-180s (`ADAPTIVE_PROBE_SLOW_INTERVAL_MS`).
  - Stop window: after 180000ms (`ADAPTIVE_PROBE_TOTAL_WINDOW_MS`).
- Telemetry:
  - `ADAPTIVE_PROBE_TICK`, `ADAPTIVE_PROBE_SKIP`, `ADAPTIVE_PROBE_STOP`.

## Key Telemetry Signals
- `HUMAN_VISIT_START/END`, `TAB_VISIT`, `USER_FOCUS_CHANGE`, `LEASE_GRANTED/RELEASED`.
- `ROUND_STATE_REPAIR` indicates a missing model entry restored before rounds.

## Dispatch/Ready Timing (supporting)
- Ready ACK timeout: 6000ms (`READY_ACK_TIMEOUT_MS`).
- Submit confirmation timeout: 7000ms default (`PROMPT_SUBMIT_TIMEOUT_MS`, with per-model overrides).
- No-focus probe timeout: 5000ms (`NO_FOCUS_TIMEOUT_MS`).
- Focus restore delay: 1500ms (`FOCUS_RESTORE_DELAY_MS`), max 8000ms (`FOCUS_RESTORE_MAX_MS`).

## Versioning
- The active plan is tied to the current extension version in `manifest.json`.
