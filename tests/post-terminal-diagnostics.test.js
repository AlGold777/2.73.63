const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TELEMETRY_LOGS_PATH = path.join(__dirname, '..', 'background', 'telemetry-logs.js');
const TELEMETRY_LOGS_SOURCE = fs.readFileSync(TELEMETRY_LOGS_PATH, 'utf8');

class TTLMap {
  constructor() {
    this.map = new Map();
  }
  has(key) { return this.map.has(key); }
  get(key) { return this.map.get(key); }
  set(key, value) { this.map.set(key, value); }
}

function createSandbox() {
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
    TTLMap,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    LLM_TARGETS: { DeepSeek: {}, Gemini: {}, Claude: {} },
    jobState: {
      session: { startTime: 1779916480462 },
      llms: {
        DeepSeek: {
          tabId: 11,
          status: 'SUCCESS',
          finalStatus: 'SUCCESS',
          finalStatusRecorded: true,
          finalizedAt: 100000,
          lastDispatchMeta: { dispatchId: 'DeepSeek:1779916480462:1' },
          logs: []
        },
        Gemini: {
          tabId: 12,
          status: 'GENERATING',
          lastDispatchMeta: { dispatchId: 'Gemini:1779916480462:1' },
          logs: []
        }
      }
    },
    chrome: {
      runtime: { getManifest: () => ({ version: 'test' }) },
      storage: { local: { get: jest.fn(() => Promise.resolve({})), set: jest.fn(() => Promise.resolve()) } }
    },
    CompressedStorage: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve())
    },
    TabMapManager: { getNameByTabId: jest.fn(() => null) },
    saveJobState: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(TELEMETRY_LOGS_SOURCE, context, { filename: 'background/telemetry-logs.js' });
  return context;
}

describe('post-terminal diagnostics filtering', () => {
  test('drops generation-looking diagnostics after terminal success', () => {
    const context = createSandbox();

    const saved = context.broadcastDiagnostic('DeepSeek', {
      ts: 101500,
      type: 'TELEMETRY',
      label: 'ANSWER_GENERATING',
      details: 'state=GENERATING textLength=2172',
      level: 'info'
    });

    expect(saved).toBeNull();
    expect(context.jobState.llms.DeepSeek.logs).toHaveLength(0);
    expect(context.sendMessageToResultsTab).not.toHaveBeenCalled();
  });

  test('keeps generation diagnostics before terminal success', () => {
    const context = createSandbox();

    const saved = context.broadcastDiagnostic('Gemini', {
      ts: 101500,
      type: 'TELEMETRY',
      label: 'ANSWER_GENERATING',
      details: 'state=GENERATING textLength=100',
      level: 'info'
    });

    expect(saved).toEqual(expect.objectContaining({ label: 'ANSWER_GENERATING' }));
    expect(context.jobState.llms.Gemini.logs).toHaveLength(1);
    expect(context.sendMessageToResultsTab).toHaveBeenCalledTimes(1);
  });
});
