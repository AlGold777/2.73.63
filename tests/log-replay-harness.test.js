const LogReplayHarness = require('../shared/log-replay-harness');

describe('LogReplayHarness', () => {
  test('replays terminal decisions and ignored duplicate finals per model', () => {
    const replay = LogReplayHarness.replay([
      {
        ts: 10,
        llmName: 'GPT',
        label: 'MODEL_FINAL',
        status: 'SUCCESS',
        meta: { decision: 'accept_success', reason: 'open_terminal_slot' }
      },
      {
        ts: 11,
        llmName: 'GPT',
        label: 'MODEL_FINAL ignored (deduplicated)',
        status: 'SUCCESS',
        meta: {
          decision: 'ignore_duplicate_final',
          telemetryTaxonomy: { eventClass: 'finalization_duplicate_ignored' }
        }
      }
    ]);

    expect(replay.models.GPT).toEqual(expect.objectContaining({
      finalStatus: 'SUCCESS',
      duplicateFinalIgnored: 1,
      terminalEvents: 1
    }));
    expect(replay.totals).toEqual(expect.objectContaining({
      events: 2,
      models: 1,
      duplicateFinalIgnored: 1,
      terminalEvents: 1
    }));
  });

  test('counts stale quarantine and recovery denial without changing terminal status', () => {
    const replay = LogReplayHarness.replay([
      {
        llmName: 'Qwen',
        label: 'STALE_EVENT_QUARANTINED',
        meta: { decision: 'ignore_stale_event', reason: 'runSessionId_mismatch' }
      },
      {
        llmName: 'Qwen',
        label: 'RECOVERY_INTENT_DENIED',
        meta: { decision: 'deny_recovery_intent', reason: 'no_resend_after_answer_evidence' }
      }
    ]);

    expect(replay.models.Qwen).toEqual(expect.objectContaining({
      finalStatus: null,
      staleEvents: 1,
      recoveryDenied: 1
    }));
    expect(replay.totals).toEqual(expect.objectContaining({
      staleEvents: 1,
      recoveryDenied: 1,
      terminalEvents: 0
    }));
  });
});
