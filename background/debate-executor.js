(function initDebateBackgroundExecutor(root) {
  'use strict';

  const STORAGE_KEY = 'llmCortexDebateBackgroundExecutor.v1';
  const MESSAGE_TYPES = new Set([
    'START_DEBATE_RUN',
    'GET_DEBATE_STATE',
    'APPROVE_DEBATE_TURN',
    'REJECT_DEBATE_TURN',
    'STEP_DEBATE',
    'PAUSE_DEBATE',
    'RESUME_DEBATE',
    'CANCEL_DEBATE'
  ]);

  const getEngine = () => root.DebateEngine;
  let store = null;
  let fsm = null;

  const ensureRuntime = () => {
    const engine = getEngine();
    if (!engine) throw new Error('DebateEngine unavailable');
    if (!store) store = engine.createStore();
    if (!fsm) fsm = engine.createFsm();
    return { engine, store, fsm };
  };

  const persist = async () => {
    const runtime = ensureRuntime();
    const storage = root.chrome?.storage?.local;
    if (!storage?.set) return { ok: false, reason: 'storage_unavailable' };
    const payload = {
      version: 1,
      fsm: runtime.fsm.toJSON(),
      transcript: runtime.engine.serializeStore(runtime.store),
      updatedAt: new Date().toISOString()
    };
    await storage.set({ [STORAGE_KEY]: payload });
    return { ok: true, payload };
  };

  const load = async () => {
    const engine = getEngine();
    if (!engine) throw new Error('DebateEngine unavailable');
    const storage = root.chrome?.storage?.local;
    if (!storage?.get) {
      store = engine.createStore();
      fsm = engine.createFsm();
      return;
    }
    const result = await storage.get(STORAGE_KEY);
    const payload = result?.[STORAGE_KEY] || null;
    store = engine.createStore(payload?.transcript || {});
    fsm = engine.createFsm(payload?.fsm || {});
  };

  const snapshot = () => {
    const runtime = ensureRuntime();
    return {
      success: true,
      state: runtime.fsm.state,
      fsm: runtime.fsm.toJSON(),
      transcript: runtime.engine.exportArtifact(runtime.store)
    };
  };

  const createModeratorTurn = (message = {}) => {
    const runtime = ensureRuntime();
    const sessionId = String(message.sessionId || message.command?.sessionId || runtime.store.activeSessionId || '1');
    runtime.store.upsertSession({
      sessionId,
      title: message.title || sessionId,
      participants: message.participants || [],
      settings: message.settings || {}
    });
    return runtime.store.appendTurn(sessionId, {
      author: 'Moderator',
      authorType: 'moderator',
      targets: message.targets || message.command?.targets || [],
      text: message.prompt || message.command?.instruction || '',
      status: 'pending',
      role: message.command?.roleOverride || ''
    });
  };

  const applyTurnPatch = (message = {}, status) => {
    const runtime = ensureRuntime();
    const sessionId = String(message.sessionId || runtime.store.activeSessionId || '1');
    const turnId = String(message.turnId || '');
    if (!turnId) return { success: false, error: 'turn_id_required' };
    if (status === 'approved') {
      runtime.store.approveTurn(sessionId, turnId, message.patch || {});
      runtime.fsm.transition('TURN_APPROVED', { sessionId, turnId });
    } else {
      runtime.store.rejectTurn(sessionId, turnId, message.patch || {});
      runtime.fsm.transition('TURN_REJECTED', { sessionId, turnId });
    }
    return snapshot();
  };

  const handleMessage = async (message = {}) => {
    await load();
    const runtime = ensureRuntime();
    switch (message.type) {
      case 'START_DEBATE_RUN': {
        const turn = createModeratorTurn(message);
        runtime.fsm.transition('MODERATOR_TURN_CREATED', { sessionId: turn.sessionId, turnId: turn.turnId });
        runtime.fsm.transition('DISPATCH_REQUESTED', { sessionId: turn.sessionId, turnId: turn.turnId });
        await persist();
        return { ...snapshot(), turn };
      }
      case 'GET_DEBATE_STATE':
        return snapshot();
      case 'APPROVE_DEBATE_TURN': {
        const result = applyTurnPatch(message, 'approved');
        await persist();
        return result;
      }
      case 'REJECT_DEBATE_TURN': {
        const result = applyTurnPatch(message, 'rejected');
        await persist();
        return result;
      }
      case 'STEP_DEBATE':
        runtime.fsm.transition('NEXT_TURN_SCHEDULED', { reason: message.reason || 'step' });
        await persist();
        return snapshot();
      case 'PAUSE_DEBATE':
        runtime.fsm.transition('PAUSE', { reason: message.reason || 'user_pause' });
        await persist();
        return snapshot();
      case 'RESUME_DEBATE':
        runtime.fsm.transition('RESUME', { reason: message.reason || 'user_resume' });
        await persist();
        return snapshot();
      case 'CANCEL_DEBATE':
        runtime.fsm.transition('CANCEL', { reason: message.reason || 'user_cancel' });
        await persist();
        return snapshot();
      default:
        return { success: false, error: 'unsupported_debate_message' };
    }
  };

  root.DebateBackgroundExecutor = {
    STORAGE_KEY,
    canHandle(message = {}) {
      return MESSAGE_TYPES.has(message.type);
    },
    handleMessage,
    _resetForTests() {
      store = null;
      fsm = null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.DebateBackgroundExecutor;
  }
})(typeof self !== 'undefined' ? self : globalThis);
