const AnswerEvidence = require('../shared/answer-evidence');

describe('AnswerEvidence Lite', () => {
  test('normalizes DOM snapshot evidence into a terminal-eligible contract', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'Gemini',
      text: 'Recovered answer text. '.repeat(80),
      responseMeta: { source: 'dom_snapshot_recovery' }
    });

    expect(evidence).toEqual(expect.objectContaining({
      schemaVersion: 1,
      llmName: 'Gemini',
      sourceKind: 'snapshot',
      terminalEligible: true,
      reason: 'snapshot_with_text',
      partialAllowed: false
    }));
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'SUCCESS'
    }));
  });

  test('timeout evidence with enough text is terminal-eligible partial', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'DeepSeek',
      text: 'Timeout answer text. '.repeat(8),
      responseMeta: {
        source: 'stream_watcher',
        completionReason: 'hard_timeout'
      }
    });

    expect(evidence).toEqual(expect.objectContaining({
      sourceKind: 'timeout',
      terminalEligible: true,
      reason: 'timeout_with_text',
      partialAllowed: true
    }));
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'PARTIAL'
    }));
  });

  test('stable text requires the larger stable threshold', () => {
    const shortStable = AnswerEvidence.buildAnswerEvidence({
      text: 'Stable answer text. '.repeat(20),
      responseMeta: { source: 'deferred_finalization', completionReason: 'generation_inactive' },
      stableMinChars: 1200
    });
    const longStable = AnswerEvidence.buildAnswerEvidence({
      text: 'Stable answer text. '.repeat(120),
      responseMeta: { source: 'deferred_finalization', completionReason: 'generation_inactive' },
      stableMinChars: 1200
    });

    expect(shortStable.terminalEligible).toBe(false);
    expect(longStable.terminalEligible).toBe(true);
    expect(longStable.reason).toBe('stable_text');
  });

  test('stable text is not terminal eligible while stop button is visible', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      text: 'Stable answer text. '.repeat(120),
      responseMeta: { source: 'deferred_finalization', completionReason: 'generation_inactive' },
      stopButtonVisible: true,
      stableMinChars: 1200
    });

    expect(evidence.terminalEligible).toBe(false);
    expect(evidence.reason).toBe('stable_text_stop_visible');
  });

  test('short snapshot is not terminal eligible without explicit terminal signal', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      text: 'Short snapshot text. '.repeat(35),
      responseMeta: { source: 'dom_snapshot_recovery' },
      snapshotTerminalMinChars: 1200
    });

    expect(evidence.length).toBeLessThan(1200);
    expect(evidence.terminalEligible).toBe(false);
    expect(evidence.reason).toBe('snapshot_text_too_short_without_terminal_signal');
  });
});
