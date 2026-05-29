const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_PATH = path.join(__dirname, '..', 'background', 'job-orchestrator.js');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(JOB_ORCHESTRATOR_PATH, 'utf8');

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
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    jobState: {
      prompt: 'Explain selector recovery architecture in detail. '.repeat(12),
      attachments: [],
      responsesCollected: 0,
      session: { startTime: 1778621552201, totalModels: 1, completed: 0, failed: 0 },
      llms: {
        Grok: { tabId: 101, requestId: 'req-grok', lastDispatchMeta: { dispatchId: 'dispatch-grok' } },
        Perplexity: { tabId: 202, requestId: 'req-pplx', lastDispatchMeta: { dispatchId: 'dispatch-pplx' } }
      }
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve(null)) },
    TabMapManager: { get: jest.fn((name) => context.jobState.llms?.[name]?.tabId || null), entries: jest.fn(() => []), removeByName: jest.fn() },
    appendLogEntry: jest.fn(),
    updateModelState: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveJobState: jest.fn(),
    emitTelemetry: jest.fn(),
    broadcastDiagnostic: jest.fn(),
    clearDeferredAnswerTimer: jest.fn(),
    clearPostSuccessScrollAudit: jest.fn(),
    clearClaudeRetryTimers: jest.fn(),
    resolvePromptSubmitted: jest.fn(),
    executeApiFallback: jest.fn(() => Promise.resolve(false)),
    setRateLimit: jest.fn(),
    getRecentPipelineErrorReason: jest.fn(() => ''),
    scheduleClaudeHardTimeoutRetry: jest.fn(() => false),
    clearBudgetPhases: jest.fn(),
    clearAdaptiveCollectTimer: jest.fn(),
    completeHumanPresenceForModel: jest.fn(),
    downgradePipelineHardTimeoutLogs: jest.fn(),
    downgradePipelineHardTimeoutStorage: jest.fn(),
    closePingWindowForLLM: jest.fn(),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || context.jobState.llms?.[llmName]?.tabId || null,
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  return context;
}

describe('finalization evidence contract', () => {
  test('detects prompt echo candidates', () => {
    const context = createSandbox();
    const prompt = context.jobState.prompt;
    expect(context.isPromptEchoAnswerCandidate(prompt, prompt)).toBe(true);
    expect(context.isPromptEchoAnswerCandidate(`${prompt}\n\nSend`, prompt)).toBe(true);
    expect(context.isPromptEchoAnswerCandidate('This is a real answer with different content and conclusions.', prompt)).toBe(false);
  });

  test('marks extract failure after lifecycle ready as contradictory without pre-final recovery', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.lifecycleReadyAt = Date.now();
    entry.answerCompleteTextLength = 1800;
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'EXTRACT_FAILED',
      finalReason: 'extract_failed',
      error: { type: 'extract_failed', message: 'Round4 gate timeout' },
      trimmedAnswer: 'Error: extract_failed',
      responseMeta: {}
    });
    expect(evidence.accepted).toBe(false);
    expect(evidence.contradictions).toContain('failure_with_answer_evidence_without_prefinal_recovery');
    expect(evidence.contradictions).toContain('extract_failed_after_lifecycle_ready');
  });

  test('records model run state and accepts failure after pre-final recovery', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'EXTRACT_FAILED',
      finalReason: 'extract_failed',
      error: { type: 'extract_failed' },
      trimmedAnswer: 'Error: extract_failed',
      metaObj: { preTerminalMaterializeFinal: true },
      responseMeta: {}
    });
    context.recordModelRunState('Perplexity', entry, evidence);
    expect(evidence.accepted).toBe(true);
    expect(entry.modelRunState).toEqual(expect.objectContaining({
      executionStatus: 'finalized_failure',
      answerStatus: 'none',
      uiStatus: 'EXTRACT_FAILED'
    }));
  });

  test('blocks terminal failure after pre-final recovery when preserved answer exists', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    entry.pendingFinalAnswer = 'Recovered answer text. '.repeat(80);
    const evidence = context.buildFinalizationEvidence('Perplexity', entry, {
      finalStatus: 'NO_SEND',
      finalReason: 'no_send',
      error: { type: 'no_send' },
      trimmedAnswer: 'Error: no_send',
      metaObj: { preTerminalMaterializeFinal: true },
      responseMeta: {}
    });
    expect(evidence.accepted).toBe(false);
    expect(evidence.hasPendingFinalAnswer).toBe(true);
    expect(evidence.contradictions).toContain('failure_with_answer_evidence_after_prefinal_recovery');
  });
});
