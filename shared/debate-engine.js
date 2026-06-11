(function initDebateEngine(root) {
  'use strict';

  const VERSION = 1;
  const STORAGE_KEY = 'llmCortexDebateEngineState.v1';
  const DEFAULT_SETTINGS = Object.freeze({
    runPolicy: 'manual',
    maxTurns: 5,
    autoApprovalDelayMs: 0,
    stopOnFailure: true,
    stopOnUncertain: true,
    deliveryMode: 'reused_tab',
    contextPolicy: 'auto',
    maxFullTurns: 30,
    maxTurnTextChars: 12000,
    summaryAfterTurns: 20,
    recentTurns: 8
  });
  const TURN_STATUSES = Object.freeze([
    'draft',
    'pending',
    'streaming',
    'completed',
    'awaiting_approval',
    'approved',
    'rejected',
    'superseded'
  ]);
  const FSM_STATES = Object.freeze([
    'IDLE',
    'COMPOSING',
    'READY_TO_DISPATCH',
    'DISPATCHING',
    'COLLECTING',
    'AWAITING_APPROVAL',
    'SCHEDULING_NEXT',
    'PAUSED',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
  ]);
  const TERMINAL_STATUSES = Object.freeze([
    'SUCCESS',
    'PARTIAL',
    'ERROR',
    'NO_SEND',
    'EXTRACT_FAILED',
    'EXTERNAL_LLM_FAILURE',
    'USER_ACTION_REQUIRED',
    'UNCERTAIN'
  ]);

  const nowIso = () => new Date().toISOString();
  const compactIdPart = () => Math.random().toString(36).slice(2, 8);
  const makeId = (prefix) => `${prefix}-${Date.now()}-${compactIdPart()}`;
  const clampInt = (value, min, max, fallback) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  };
  const normalizeArray = (value) => Array.isArray(value) ? value.filter((item) => item != null).map(String) : [];
  const normalizeRunPolicy = (value) => String(value || '').toLowerCase() === 'auto' ? 'auto' : 'manual';
  const normalizeStatus = (value, fallback = 'draft') => {
    const status = String(value || fallback).toLowerCase();
    return TURN_STATUSES.includes(status) ? status : fallback;
  };
  const normalizeTerminalStatus = (value) => {
    const status = String(value || '').trim().toUpperCase();
    return TERMINAL_STATUSES.includes(status) ? status : '';
  };
  const trimText = (text, limit = DEFAULT_SETTINGS.maxTurnTextChars) => {
    const value = String(text || '');
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 16))}\n[...truncated]`;
  };
  const clone = (value) => {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  };
  const escapeMarkdown = (value) => String(value || '').replace(/\r\n/g, '\n');

  function normalizeSettings(settings = {}) {
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      runPolicy: normalizeRunPolicy(settings.runPolicy || DEFAULT_SETTINGS.runPolicy),
      maxTurns: clampInt(settings.maxTurns, 1, 50, DEFAULT_SETTINGS.maxTurns),
      autoApprovalDelayMs: clampInt(settings.autoApprovalDelayMs, 0, 60000, DEFAULT_SETTINGS.autoApprovalDelayMs),
      maxFullTurns: clampInt(settings.maxFullTurns, 1, 200, DEFAULT_SETTINGS.maxFullTurns),
      maxTurnTextChars: clampInt(settings.maxTurnTextChars, 500, 100000, DEFAULT_SETTINGS.maxTurnTextChars),
      summaryAfterTurns: clampInt(settings.summaryAfterTurns, 1, 200, DEFAULT_SETTINGS.summaryAfterTurns),
      recentTurns: clampInt(settings.recentTurns, 1, 30, DEFAULT_SETTINGS.recentTurns)
    };
  }

  function createSession(input = {}) {
    const createdAt = input.createdAt || nowIso();
    return {
      sessionId: String(input.sessionId || makeId('debate-session')),
      title: String(input.title || 'Debate'),
      createdAt,
      updatedAt: input.updatedAt || createdAt,
      status: String(input.status || 'idle'),
      participants: Array.isArray(input.participants) ? clone(input.participants) : [],
      moderator: input.moderator ? clone(input.moderator) : { type: 'human', name: 'Moderator' },
      turns: Array.isArray(input.turns) ? input.turns.map((turn, index) => normalizeTurn(turn, { sessionId: input.sessionId, index: index + 1 })) : [],
      summaries: Array.isArray(input.summaries) ? clone(input.summaries) : [],
      settings: normalizeSettings(input.settings || {})
    };
  }

  function normalizeTurn(input = {}, fallback = {}) {
    const sessionId = String(input.sessionId || fallback.sessionId || '');
    const createdAt = input.createdAt || nowIso();
    const textLimit = input.settings?.maxTurnTextChars || DEFAULT_SETTINGS.maxTurnTextChars;
    return {
      turnId: String(input.turnId || makeId('turn')),
      sessionId,
      index: clampInt(input.index, 1, Number.MAX_SAFE_INTEGER, fallback.index || 1),
      author: String(input.author || 'Moderator'),
      authorType: ['moderator', 'model', 'system'].includes(input.authorType) ? input.authorType : 'moderator',
      role: String(input.role || ''),
      targets: normalizeArray(input.targets),
      replyToTurnId: input.replyToTurnId ? String(input.replyToTurnId) : null,
      text: trimText(input.text, textLimit),
      html: input.html ? trimText(input.html, textLimit) : '',
      status: normalizeStatus(input.status, 'draft'),
      terminalStatus: normalizeTerminalStatus(input.terminalStatus),
      evidence: input.evidence ? clone(input.evidence) : null,
      createdAt,
      completedAt: input.completedAt || null,
      approvedAt: input.approvedAt || null,
      delivery: input.delivery ? clone(input.delivery) : {}
    };
  }

  function createTurn(session, input = {}) {
    const turns = Array.isArray(session?.turns) ? session.turns : [];
    return normalizeTurn({
      ...input,
      sessionId: input.sessionId || session?.sessionId,
      index: input.index || turns.length + 1,
      settings: session?.settings || DEFAULT_SETTINGS
    });
  }

  function createStore(initial = {}) {
    const sessions = new Map();
    const sourceSessions = Array.isArray(initial.sessions)
      ? initial.sessions
      : (initial.session ? [initial.session] : []);
    sourceSessions.forEach((sessionInput) => {
      const session = createSession(sessionInput);
      sessions.set(session.sessionId, session);
    });
    const firstSession = sessions.values().next().value || createSession();
    sessions.set(firstSession.sessionId, firstSession);
    let activeSessionId = String(initial.activeSessionId || firstSession.sessionId);
    if (!sessions.has(activeSessionId)) activeSessionId = firstSession.sessionId;

    const touch = (session) => {
      if (session) session.updatedAt = nowIso();
      return session;
    };

    const api = {
      version: VERSION,
      get activeSessionId() { return activeSessionId; },
      setActiveSession(sessionId) {
        const id = String(sessionId || '');
        if (!sessions.has(id)) throw new Error(`Unknown debate session: ${id}`);
        activeSessionId = id;
        return api.getSession(id);
      },
      listSessions() {
        return Array.from(sessions.values()).map(clone);
      },
      getSession(sessionId = activeSessionId) {
        const session = sessions.get(String(sessionId || activeSessionId));
        return session ? clone(session) : null;
      },
      getMutableSession(sessionId = activeSessionId) {
        return sessions.get(String(sessionId || activeSessionId)) || null;
      },
      upsertSession(input = {}) {
        const existing = input.sessionId ? sessions.get(String(input.sessionId)) : null;
        const session = createSession({ ...(existing || {}), ...input });
        sessions.set(session.sessionId, touch(session));
        activeSessionId = session.sessionId;
        return clone(session);
      },
      updateSettings(sessionId, settings = {}) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        session.settings = normalizeSettings({ ...session.settings, ...settings });
        touch(session);
        return clone(session.settings);
      },
      appendTurn(sessionId, input = {}) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        const turn = createTurn(session, input);
        session.turns.push(turn);
        touch(session);
        return clone(turn);
      },
      updateTurn(sessionId, turnId, patch = {}) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        const index = session.turns.findIndex((turn) => turn.turnId === turnId);
        if (index < 0) throw new Error(`Unknown debate turn: ${turnId}`);
        session.turns[index] = normalizeTurn({ ...session.turns[index], ...patch }, { sessionId, index: session.turns[index].index });
        touch(session);
        return clone(session.turns[index]);
      },
      approveTurn(sessionId, turnId, patch = {}) {
        return api.updateTurn(sessionId, turnId, { ...patch, status: 'approved', approvedAt: patch.approvedAt || nowIso() });
      },
      rejectTurn(sessionId, turnId, patch = {}) {
        return api.updateTurn(sessionId, turnId, { ...patch, status: 'rejected' });
      },
      deleteTurn(sessionId, turnId) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        const before = session.turns.length;
        session.turns = session.turns.filter((turn) => turn.turnId !== turnId);
        session.turns = session.turns.map((turn, index) => ({ ...turn, index: index + 1 }));
        touch(session);
        return { deleted: before !== session.turns.length, turnId };
      },
      clearTurns(sessionId) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        session.turns = [];
        touch(session);
        return clone(session);
      },
      toJSON() {
        return {
          version: VERSION,
          activeSessionId,
          sessions: Array.from(sessions.values()).map(clone)
        };
      }
    };
    return api;
  }

  function compactSession(sessionInput, policy = {}) {
    const session = createSession(sessionInput);
    const settings = normalizeSettings({ ...session.settings, ...policy });
    const turns = session.turns || [];
    const fullStart = Math.max(0, turns.length - settings.maxFullTurns);
    const fullTurns = turns.slice(fullStart).map((turn) => normalizeTurn({ ...turn, text: trimText(turn.text, settings.maxTurnTextChars), html: trimText(turn.html, settings.maxTurnTextChars) }));
    const omittedTurns = turns.slice(0, fullStart);
    const summaries = session.summaries.slice();
    if (omittedTurns.length) {
      summaries.push(createRuleBasedSummary(omittedTurns, {
        upToTurnIndex: omittedTurns[omittedTurns.length - 1]?.index || omittedTurns.length
      }));
    }
    return {
      ...session,
      turns: fullTurns,
      summaries,
      settings
    };
  }

  function serializeStore(store, policy = {}) {
    const snapshot = typeof store?.toJSON === 'function' ? store.toJSON() : store;
    return {
      version: VERSION,
      activeSessionId: snapshot.activeSessionId,
      sessions: (snapshot.sessions || []).map((session) => compactSession(session, policy))
    };
  }

  async function persistStore(store, options = {}) {
    const key = options.key || STORAGE_KEY;
    const storage = options.storage || root?.chrome?.storage?.local;
    if (!storage?.set) return { ok: false, reason: 'storage_unavailable' };
    const payload = serializeStore(store, options.policy || {});
    await storage.set({ [key]: payload });
    return { ok: true, key, payload };
  }

  async function loadStore(options = {}) {
    const key = options.key || STORAGE_KEY;
    const storage = options.storage || root?.chrome?.storage?.local;
    if (!storage?.get) return createStore();
    const result = await storage.get(key);
    return createStore(result?.[key] || {});
  }

  function createRuleBasedSummary(turns = [], options = {}) {
    const normalized = turns.map((turn, index) => normalizeTurn(turn, { index: index + 1 }));
    const excerpts = normalized.map((turn) => `${turn.index}. ${turn.author}: ${trimText(turn.text, 220).replace(/\s+/g, ' ')}`);
    return {
      summaryId: String(options.summaryId || makeId('summary')),
      upToTurnIndex: options.upToTurnIndex || normalized[normalized.length - 1]?.index || 0,
      consensus: '',
      disagreements: '',
      claims: excerpts,
      openQuestions: [],
      nextFocus: '',
      text: excerpts.join('\n'),
      createdAt: nowIso()
    };
  }

  function createDeliveryLedger(input = {}) {
    const entries = new Map();
    Object.entries(input || {}).forEach(([modelName, state]) => {
      entries.set(modelName, normalizeDeliveryState({ modelName, ...state }));
    });
    return {
      get(modelName) {
        return clone(entries.get(String(modelName)) || normalizeDeliveryState({ modelName }));
      },
      update(modelName, patch = {}) {
        const next = normalizeDeliveryState({ ...entries.get(String(modelName)), modelName, ...patch });
        entries.set(String(modelName), next);
        return clone(next);
      },
      reset(modelName, reason = 'reset') {
        return this.update(modelName, {
          lastDeliveredTurnIndex: 0,
          lastDeliveredTurnId: null,
          continuityVerified: false,
          resetReason: reason
        });
      },
      toJSON() {
        return Object.fromEntries(entries);
      }
    };
  }

  function normalizeDeliveryState(input = {}) {
    return {
      modelName: String(input.modelName || ''),
      lastDeliveredTurnIndex: clampInt(input.lastDeliveredTurnIndex, 0, Number.MAX_SAFE_INTEGER, 0),
      lastDeliveredTurnId: input.lastDeliveredTurnId || null,
      channelMode: ['reused_tab', 'new_tab', 'api', 'unknown'].includes(input.channelMode) ? input.channelMode : 'unknown',
      continuityVerified: input.continuityVerified === true,
      lastDispatchId: input.lastDispatchId || null,
      lastTabId: input.lastTabId || null,
      resetReason: input.resetReason || ''
    };
  }

  function chooseContextMode({ session, recipient, deliveryState } = {}) {
    const settings = normalizeSettings(session?.settings || {});
    if (settings.contextPolicy && settings.contextPolicy !== 'auto') return settings.contextPolicy;
    const turnsCount = Array.isArray(session?.turns) ? session.turns.length : 0;
    if (deliveryState?.channelMode === 'reused_tab' && deliveryState?.continuityVerified) return 'delta';
    if (turnsCount > settings.summaryAfterTurns) return 'summary_plus_recent';
    return 'full';
  }

  function buildContextPack({ session, recipient, currentTurn, deliveryState, mode } = {}) {
    const normalizedSession = createSession(session || {});
    const settings = normalizeSettings(normalizedSession.settings);
    const contextMode = mode || chooseContextMode({ session: normalizedSession, recipient, deliveryState });
    const turns = normalizedSession.turns || [];
    const recentCount = settings.recentTurns;
    const recentTurns = contextMode === 'delta' && deliveryState?.lastDeliveredTurnIndex
      ? turns.filter((turn) => turn.index > deliveryState.lastDeliveredTurnIndex)
      : turns.slice(Math.max(0, turns.length - recentCount));
    const addressedTurns = currentTurn?.replyToTurnId
      ? turns.filter((turn) => turn.turnId === currentTurn.replyToTurnId)
      : [];
    const omittedTurns = turns.filter((turn) => !recentTurns.some((recent) => recent.turnId === turn.turnId));
    const summary = normalizedSession.summaries?.length
      ? normalizedSession.summaries[normalizedSession.summaries.length - 1]
      : (omittedTurns.length ? createRuleBasedSummary(omittedTurns) : null);
    const textForEstimate = [...recentTurns, ...addressedTurns, currentTurn].filter(Boolean).map((turn) => turn.text || '').join(' ');
    return {
      mode: contextMode,
      summary,
      recentTurns: recentTurns.map(clone),
      addressedTurns: addressedTurns.map(clone),
      omittedTurns: omittedTurns.map((turn) => ({ turnId: turn.turnId, index: turn.index, author: turn.author })),
      tokenEstimate: Math.ceil(textForEstimate.length / 4)
    };
  }

  function buildDebateTurnPrompt({
    session,
    recipient,
    currentTurn,
    contextPack,
    moderatorInstruction = '',
    deliveryMode = ''
  } = {}) {
    const normalizedSession = createSession(session || {});
    const turn = currentTurn ? normalizeTurn(currentTurn, { sessionId: normalizedSession.sessionId }) : null;
    const pack = contextPack || buildContextPack({ session: normalizedSession, recipient, currentTurn: turn });
    const participantLines = (normalizedSession.participants || [])
      .map((participant) => `${participant.name || participant.modelName || participant}: ${participant.role || 'participant'}`)
      .join('\n') || 'No participants declared.';
    const recentLines = (pack.recentTurns || [])
      .map((item) => `Turn ${item.index} — ${item.author}${item.targets?.length ? ` -> ${item.targets.join(', ')}` : ''}: ${item.text}`)
      .join('\n\n');
    const replyLine = turn?.replyToTurnId ? `Ответь на turn ${turn.replyToTurnId}.` : 'Ответь на текущую реплику модератора.';
    return [
      'ROLE',
      `Ты — ${recipient || 'участник debate'}.${turn?.role ? ` Твоя роль: ${turn.role}.` : ''}`,
      '',
      'PARTICIPANTS',
      participantLines,
      '',
      'CONTEXT',
      pack.summary?.text || pack.summary?.claims?.join('\n') || 'No summary.',
      recentLines ? `\nRecent turns:\n${recentLines}` : '',
      '',
      'CURRENT TASK',
      replyLine,
      moderatorInstruction || turn?.text || '',
      turn?.targets?.length ? `Targets: ${turn.targets.join(', ')}` : '',
      deliveryMode ? `Delivery mode: ${deliveryMode}` : ''
    ].filter((line) => line !== '').join('\n');
  }

  function createFsm(initial = {}) {
    let state = FSM_STATES.includes(initial.state) ? initial.state : 'IDLE';
    const history = [];
    const transition = (event, payload = {}) => {
      const next = nextState(state, event);
      if (!next) {
        return { ok: false, state, event, reason: 'invalid_transition' };
      }
      const record = { from: state, to: next, event, payload: clone(payload), at: nowIso() };
      state = next;
      history.push(record);
      return { ok: true, ...record };
    };
    return {
      get state() { return state; },
      get history() { return history.map(clone); },
      transition,
      toJSON() { return { state, history: history.map(clone) }; }
    };
  }

  function nextState(state, event) {
    if (event === 'CANCEL') return 'CANCELLED';
    if (event === 'PAUSE') return 'PAUSED';
    if (event === 'RESUME') return state === 'PAUSED' ? 'SCHEDULING_NEXT' : state;
    const table = {
      IDLE: { MODERATOR_TURN_CREATED: 'COMPOSING', DISPATCH_REQUESTED: 'READY_TO_DISPATCH' },
      COMPOSING: { DISPATCH_REQUESTED: 'READY_TO_DISPATCH', COMPLETE: 'COMPLETED' },
      READY_TO_DISPATCH: { DISPATCH_REQUESTED: 'DISPATCHING' },
      DISPATCHING: { MODEL_RESPONSE_PARTIAL: 'COLLECTING', MODEL_RESPONSE_FINAL: 'AWAITING_APPROVAL' },
      COLLECTING: { MODEL_RESPONSE_FINAL: 'AWAITING_APPROVAL' },
      AWAITING_APPROVAL: { TURN_APPROVED: 'SCHEDULING_NEXT', TURN_REJECTED: 'SCHEDULING_NEXT', COMPLETE: 'COMPLETED' },
      SCHEDULING_NEXT: { NEXT_TURN_SCHEDULED: 'READY_TO_DISPATCH', COMPLETE: 'COMPLETED' },
      PAUSED: { RESUME: 'SCHEDULING_NEXT', COMPLETE: 'COMPLETED' },
      FAILED: { RESUME: 'SCHEDULING_NEXT' }
    };
    if (event === 'FAIL') return 'FAILED';
    return table[state]?.[event] || null;
  }

  function scheduleNext({ mode = 'manual', participants = [], sender = '', targets = [], lastSpeaker = '' } = {}) {
    const names = participants.map((item) => String(item.name || item.modelName || item)).filter(Boolean);
    if (mode === 'all_respond') return names.filter((name) => name !== sender);
    if (mode === 'directed') return normalizeArray(targets);
    if (mode === 'round_robin') {
      if (!names.length) return [];
      const index = Math.max(0, names.indexOf(lastSpeaker));
      return [names[(index + 1) % names.length]];
    }
    return normalizeArray(targets);
  }

  function resolveTurnFailurePolicy(terminalStatus, settings = {}) {
    const status = normalizeTerminalStatus(terminalStatus);
    const opts = normalizeSettings(settings);
    if (status === 'SUCCESS') return { eligible: true, requiresApproval: false, pause: false };
    if (status === 'PARTIAL') return { eligible: true, requiresApproval: true, pause: opts.runPolicy === 'manual' };
    if (status === 'UNCERTAIN') return { eligible: false, requiresApproval: true, pause: opts.stopOnUncertain };
    if (status === 'USER_ACTION_REQUIRED') return { eligible: false, requiresApproval: true, pause: true };
    if (['NO_SEND', 'ERROR', 'EXTRACT_FAILED', 'EXTERNAL_LLM_FAILURE'].includes(status)) {
      return { eligible: false, requiresApproval: false, pause: opts.stopOnFailure };
    }
    return { eligible: false, requiresApproval: true, pause: true };
  }

  function parseModelModeratorCommand(value) {
    if (!value) return { ok: false, reason: 'empty' };
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const nextSpeakers = normalizeArray(parsed.nextSpeakers);
      return {
        ok: true,
        command: {
          continue: parsed.continue !== false,
          nextSpeakers,
          question: String(parsed.question || ''),
          reason: String(parsed.reason || ''),
          stopCondition: parsed.stopCondition || null
        }
      };
    } catch (err) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match && match[0] !== text) return parseModelModeratorCommand(match[0]);
      return { ok: false, reason: 'invalid_json', error: err.message };
    }
  }

  function exportArtifact(storeOrSession) {
    const snapshot = typeof storeOrSession?.toJSON === 'function'
      ? storeOrSession.toJSON()
      : { version: VERSION, activeSessionId: storeOrSession.sessionId, sessions: [createSession(storeOrSession)] };
    return {
      version: VERSION,
      exportedAt: nowIso(),
      activeSessionId: snapshot.activeSessionId,
      sessions: snapshot.sessions || []
    };
  }

  function exportMarkdown(sessionInput) {
    const session = createSession(sessionInput);
    const lines = [
      '# Debate',
      '',
      `Moderator: ${session.moderator?.name || 'Moderator'}`,
      `Participants: ${(session.participants || []).map((item) => item.name || item.modelName || item).join(', ') || 'None'}`,
      ''
    ];
    session.turns.forEach((turn) => {
      lines.push(`## Turn ${turn.index} — ${turn.author}${turn.targets?.length ? ` -> ${turn.targets.join(', ')}` : ''}`);
      if (turn.role) lines.push(`Role: ${turn.role}`);
      if (turn.terminalStatus) lines.push(`Outcome: ${turn.terminalStatus}`);
      lines.push('', escapeMarkdown(turn.text), '');
    });
    return lines.join('\n');
  }

  function replayArtifact(artifact = {}) {
    return createStore({
      activeSessionId: artifact.activeSessionId,
      sessions: artifact.sessions || []
    });
  }

  const api = {
    VERSION,
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    TURN_STATUSES,
    FSM_STATES,
    TERMINAL_STATUSES,
    normalizeSettings,
    createSession,
    createTurn,
    createStore,
    compactSession,
    serializeStore,
    persistStore,
    loadStore,
    createRuleBasedSummary,
    createDeliveryLedger,
    normalizeDeliveryState,
    chooseContextMode,
    buildContextPack,
    buildDebateTurnPrompt,
    createFsm,
    nextState,
    scheduleNext,
    resolveTurnFailurePolicy,
    parseModelModeratorCommand,
    exportArtifact,
    exportMarkdown,
    replayArtifact
  };

  root.DebateEngine = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
