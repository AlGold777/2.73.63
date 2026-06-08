const RecoveryIntent = require('../shared/recovery-intent');

describe('RecoveryIntent', () => {
  test('allows observe-only recovery after answer evidence', () => {
    const decision = RecoveryIntent.authorize({
      answer: 'valid recovered answer '.repeat(20)
    }, {
      intent: 'observe_only'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      intent: 'observe_only',
      evidenceHit: true,
      mutatesPage: false
    }));
  });

  test('denies resend after answer evidence', () => {
    const decision = RecoveryIntent.authorize({
      pendingFinalAnswer: 'valid pending answer '.repeat(20)
    }, {
      intent: 'resend_prompt'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      intent: 'resend_prompt',
      reason: 'no_resend_after_answer_evidence',
      evidenceHit: true,
      mutatesPage: true
    }));
  });

  test('allows resend when no answer evidence exists', () => {
    const decision = RecoveryIntent.authorize({}, {
      intent: 'manual_resend'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      intent: 'resend_prompt',
      evidenceHit: false,
      mutatesPage: true
    }));
  });
});
