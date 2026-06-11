const DebateEngine = require('../shared/debate-engine');

describe('DebateEngine core contract', () => {
  test('creates transcript sessions and appends structured turns', () => {
    const store = DebateEngine.createStore({
      session: {
        sessionId: 's1',
        title: 'Release debate',
        participants: [{ name: 'GPT', role: 'advocate' }, { name: 'Claude', role: 'critic' }],
        settings: { runPolicy: 'auto', maxTurns: 7 }
      }
    });

    const turn = store.appendTurn('s1', {
      author: 'Moderator',
      authorType: 'moderator',
      targets: ['GPT'],
      text: 'Challenge the release assumptions.',
      status: 'pending'
    });

    expect(turn).toEqual(expect.objectContaining({
      sessionId: 's1',
      index: 1,
      author: 'Moderator',
      targets: ['GPT'],
      status: 'pending'
    }));
    expect(store.getSession('s1').settings).toEqual(expect.objectContaining({
      runPolicy: 'auto',
      maxTurns: 7
    }));
  });

  test('serializes sessions with bounded old turns and rule-based summary', () => {
    const store = DebateEngine.createStore({ session: { sessionId: 's2' } });
    for (let i = 0; i < 5; i += 1) {
      store.appendTurn('s2', { author: `M${i}`, targets: ['GPT'], text: `Turn ${i}`, status: 'approved' });
    }

    const payload = DebateEngine.serializeStore(store, { maxFullTurns: 2 });

    expect(payload.sessions[0].turns).toHaveLength(2);
    expect(payload.sessions[0].turns[0].index).toBe(4);
    expect(payload.sessions[0].summaries[payload.sessions[0].summaries.length - 1]).toEqual(expect.objectContaining({
      upToTurnIndex: 3
    }));
  });

  test('persists and restores through storage adapter', async () => {
    const storageData = {};
    const storage = {
      set: jest.fn(async (value) => Object.assign(storageData, value)),
      get: jest.fn(async (key) => ({ [key]: storageData[key] }))
    };
    const store = DebateEngine.createStore({ session: { sessionId: 'persisted' } });
    store.appendTurn('persisted', { author: 'Moderator', targets: ['Claude'], text: 'Persist me' });

    await DebateEngine.persistStore(store, { storage });
    const restored = await DebateEngine.loadStore({ storage });

    expect(restored.getSession('persisted').turns[0].text).toBe('Persist me');
  });

  test('builds recipient-specific prompt with role, participants, context and task', () => {
    const session = DebateEngine.createSession({
      sessionId: 's3',
      participants: [{ name: 'GPT', role: 'advocate' }, { name: 'Claude', role: 'critic' }]
    });
    session.turns.push(DebateEngine.createTurn(session, {
      author: 'GPT',
      authorType: 'model',
      targets: ['Claude'],
      text: 'The cost estimate is safe.',
      status: 'approved'
    }));
    const currentTurn = DebateEngine.createTurn(session, {
      author: 'Moderator',
      targets: ['Claude'],
      role: 'critic',
      replyToTurnId: session.turns[0].turnId,
      text: 'Find the weakest assumption.'
    });

    const prompt = DebateEngine.buildDebateTurnPrompt({
      session,
      recipient: 'Claude',
      currentTurn,
      moderatorInstruction: 'Keep it under 500 tokens.',
      deliveryMode: 'delta'
    });

    expect(prompt).toContain('ROLE');
    expect(prompt).toContain('Ты — Claude. Твоя роль: critic.');
    expect(prompt).toContain('GPT: advocate');
    expect(prompt).toContain('CURRENT TASK');
    expect(prompt).toContain('Keep it under 500 tokens.');
    expect(prompt).toContain('Delivery mode: delta');
  });

  test('chooses context policy from delivery continuity and long sessions', () => {
    const shortSession = DebateEngine.createSession({ settings: { summaryAfterTurns: 3 } });
    const delivery = { channelMode: 'reused_tab', continuityVerified: true, lastDeliveredTurnIndex: 1 };

    expect(DebateEngine.chooseContextMode({ session: shortSession, recipient: 'GPT', deliveryState: delivery })).toBe('delta');

    const longSession = DebateEngine.createSession({ settings: { summaryAfterTurns: 1 } });
    longSession.turns.push(DebateEngine.createTurn(longSession, { text: 'one' }));
    longSession.turns.push(DebateEngine.createTurn(longSession, { text: 'two' }));

    expect(DebateEngine.chooseContextMode({ session: longSession, recipient: 'GPT', deliveryState: { channelMode: 'new_tab' } })).toBe('summary_plus_recent');
  });

  test('tracks delivery cursor and reset on continuity loss', () => {
    const ledger = DebateEngine.createDeliveryLedger();
    ledger.update('GPT', {
      lastDeliveredTurnIndex: 4,
      lastDeliveredTurnId: 'turn-4',
      channelMode: 'reused_tab',
      continuityVerified: true,
      lastTabId: 42
    });

    expect(ledger.get('GPT')).toEqual(expect.objectContaining({
      lastDeliveredTurnIndex: 4,
      continuityVerified: true
    }));
    expect(ledger.reset('GPT', 'tab_reload')).toEqual(expect.objectContaining({
      lastDeliveredTurnIndex: 0,
      continuityVerified: false,
      resetReason: 'tab_reload'
    }));
  });

  test('FSM accepts debate lifecycle transitions and rejects invalid ones', () => {
    const fsm = DebateEngine.createFsm();
    expect(fsm.transition('MODERATOR_TURN_CREATED').to).toBe('COMPOSING');
    expect(fsm.transition('DISPATCH_REQUESTED').to).toBe('READY_TO_DISPATCH');
    expect(fsm.transition('DISPATCH_REQUESTED').to).toBe('DISPATCHING');
    expect(fsm.transition('MODEL_RESPONSE_FINAL').to).toBe('AWAITING_APPROVAL');
    expect(fsm.transition('TURN_APPROVED').to).toBe('SCHEDULING_NEXT');
    expect(fsm.transition('MODEL_RESPONSE_FINAL').ok).toBe(false);
  });

  test('scheduler supports manual, directed, all_respond and round_robin', () => {
    const participants = ['GPT', 'Claude', 'Gemini'];

    expect(DebateEngine.scheduleNext({ mode: 'directed', targets: ['Claude'], participants })).toEqual(['Claude']);
    expect(DebateEngine.scheduleNext({ mode: 'all_respond', sender: 'GPT', participants })).toEqual(['Claude', 'Gemini']);
    expect(DebateEngine.scheduleNext({ mode: 'round_robin', lastSpeaker: 'Claude', participants })).toEqual(['Gemini']);
    expect(DebateEngine.scheduleNext({ mode: 'manual', targets: ['GPT'], participants })).toEqual(['GPT']);
  });

  test('failure policy pauses on uncertain/action-required and marks partial approval', () => {
    expect(DebateEngine.resolveTurnFailurePolicy('SUCCESS', { runPolicy: 'auto' })).toEqual(expect.objectContaining({
      eligible: true,
      requiresApproval: false,
      pause: false
    }));
    expect(DebateEngine.resolveTurnFailurePolicy('PARTIAL', { runPolicy: 'manual' })).toEqual(expect.objectContaining({
      eligible: true,
      requiresApproval: true,
      pause: true
    }));
    expect(DebateEngine.resolveTurnFailurePolicy('USER_ACTION_REQUIRED')).toEqual(expect.objectContaining({
      eligible: false,
      pause: true
    }));
  });

  test('parses model moderator JSON with fallback extraction', () => {
    const parsed = DebateEngine.parseModelModeratorCommand('prefix {"continue":true,"nextSpeakers":["Claude"],"question":"Challenge GPT"} suffix');

    expect(parsed).toEqual(expect.objectContaining({
      ok: true,
      command: expect.objectContaining({
        nextSpeakers: ['Claude'],
        question: 'Challenge GPT'
      })
    }));
    expect(DebateEngine.parseModelModeratorCommand('{nope').ok).toBe(false);
  });

  test('exports and replays structured artifacts plus markdown', () => {
    const store = DebateEngine.createStore({ session: { sessionId: 'export-s1', participants: ['GPT'] } });
    store.appendTurn('export-s1', { author: 'Moderator', targets: ['GPT'], text: 'Hello', terminalStatus: 'SUCCESS' });

    const artifact = DebateEngine.exportArtifact(store);
    const replayed = DebateEngine.replayArtifact(artifact);
    const markdown = DebateEngine.exportMarkdown(replayed.getSession('export-s1'));

    expect(artifact.sessions[0].turns[0].text).toBe('Hello');
    expect(replayed.getSession('export-s1').turns).toHaveLength(1);
    expect(markdown).toContain('## Turn 1 — Moderator -> GPT');
  });
});
