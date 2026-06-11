const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEBATE_ENGINE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'debate-engine.js'), 'utf8');
const DEBATE_EXECUTOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'debate-executor.js'), 'utf8');
const MESSAGE_ROUTER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');

function createDebateSandbox({ includeRouter = false } = {}) {
  const storageData = {};
  let onMessageListener = null;
  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    setTimeout,
    clearTimeout,
    TERMINAL_STATUSES: ['SUCCESS', 'PARTIAL', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'],
    jobState: { session: null, llms: {} },
    CompressedStorage: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      migrate: () => Promise.resolve(),
      pruneIfNeeded: () => Promise.resolve()
    },
    loadJobState: () => Promise.resolve(),
    saveJobState: () => {},
    loadResolutionMetrics: () => Promise.resolve(),
    loadCircuitBreakerState: () => Promise.resolve(),
    clearDiagnosticsRuntimeLogs: () => false,
    startProcess: jest.fn(),
    TabMapManager: {
      load: () => Promise.resolve(),
      get: () => null,
      entries: () => [],
      removeByName: () => {}
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        onStartup: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        getManifest: () => ({ version: 'test' })
      },
      storage: {
        local: {
          get: jest.fn(async (key) => ({ [key]: storageData[key] })),
          set: jest.fn(async (value) => Object.assign(storageData, value || {}))
        },
        session: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve()
        },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onActivated: { addListener: () => {} },
        sendMessage: () => Promise.resolve(),
        query: () => Promise.resolve([])
      },
      windows: { onFocusChanged: { addListener: () => {} } },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      action: { onClicked: { addListener: () => {} } }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(DEBATE_ENGINE_SOURCE, context, { filename: 'shared/debate-engine.js' });
  vm.runInContext(DEBATE_EXECUTOR_SOURCE, context, { filename: 'background/debate-executor.js' });
  if (includeRouter) {
    vm.runInContext(MESSAGE_ROUTER_SOURCE, context, { filename: 'background/message-router.js' });
  }
  return {
    context,
    storageData,
    sendMessage: (message) => new Promise((resolve) => {
      const handled = onMessageListener(message, { tab: { id: 999 } }, resolve);
      if (handled !== true) resolve(undefined);
    })
  };
}

describe('DebateBackgroundExecutor', () => {
  test('starts a debate run and persists transcript/FSM state', async () => {
    const { context, storageData } = createDebateSandbox();

    const response = await context.DebateBackgroundExecutor.handleMessage({
      type: 'START_DEBATE_RUN',
      sessionId: 'debate-1',
      title: 'Debate 1',
      prompt: 'Start the discussion',
      targets: ['GPT', 'Claude'],
      participants: ['GPT', 'Claude'],
      settings: { runPolicy: 'manual', maxTurns: 4 }
    });

    expect(response.success).toBe(true);
    expect(response.state).toBe('READY_TO_DISPATCH');
    expect(response.turn).toEqual(expect.objectContaining({
      author: 'Moderator',
      targets: ['GPT', 'Claude'],
      text: 'Start the discussion'
    }));
    expect(storageData[context.DebateBackgroundExecutor.STORAGE_KEY]).toEqual(expect.objectContaining({
      transcript: expect.objectContaining({
        activeSessionId: 'debate-1'
      })
    }));
  });

  test('router delegates debate messages before legacy switch cases', async () => {
    const { sendMessage } = createDebateSandbox({ includeRouter: true });

    const started = await sendMessage({
      type: 'START_DEBATE_RUN',
      sessionId: 'router-debate',
      prompt: 'Route this',
      targets: ['Gemini']
    });
    const paused = await sendMessage({ type: 'PAUSE_DEBATE', reason: 'test_pause' });
    const state = await sendMessage({ type: 'GET_DEBATE_STATE' });

    expect(started.success).toBe(true);
    expect(started.turn.targets).toEqual(['Gemini']);
    expect(paused.state).toBe('PAUSED');
    expect(state.transcript.activeSessionId).toBe('router-debate');
    expect(state.transcript.sessions.some((session) => session.sessionId === 'router-debate')).toBe(true);
  });
});
