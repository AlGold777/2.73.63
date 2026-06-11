const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_LENGTH_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-length-policy.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');

function createSandbox({ llms } = {}) {
  const telemetryEvents = [];
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
      prompt: 'test prompt',
      attachments: [],
      responsesCollected: 0,
      session: { startTime: 1781159284885, totalModels: 1, selectedModels: Object.keys(llms || {}), completed: 0, failed: 0 },
      llms: llms || {}
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve(null)) },
    TabMapManager: { get: jest.fn(() => 404), entries: jest.fn(() => []), removeByName: jest.fn() },
    appendLogEntry: jest.fn(),
    updateModelState: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveJobState: jest.fn(),
    emitTelemetry: jest.fn((llmName, event, payload = {}) => telemetryEvents.push({ llmName, event, payload })),
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
    resolveModelFinalStatus: jest.fn(() => 'SUCCESS'),
    resolveModelDoneReason: jest.fn(() => 'ok'),
    completeHumanPresenceForModel: jest.fn(),
    downgradePipelineHardTimeoutLogs: jest.fn(),
    downgradePipelineHardTimeoutStorage: jest.fn(),
    closePingWindowForLLM: jest.fn(),
    extendPingWindowForLLM: jest.fn(),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || context.jobState.llms?.[llmName]?.tabId || null,
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(ANSWER_LENGTH_POLICY_SOURCE, context, { filename: 'shared/answer-length-policy.js' });
  vm.runInContext(ANSWER_EVIDENCE_SOURCE, context, { filename: 'shared/answer-evidence.js' });
  vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  return { context, telemetryEvents };
}

describe('classifyMaterializeRecoveryFinality', () => {
  const grokEntry = () => ({
    tabId: 404,
    dispatchAttempts: 1,
    promptSubmittedAt: Date.now() - 200000,
    lastDispatchMeta: { dispatchId: 'Grok:1781159284885:1' }
  });

  test('hard stop without completion evidence is PARTIAL (Grok run 1781159284885)', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const finality = context.classifyMaterializeRecoveryFinality(
      'script_runtime_hard_stop',
      context.jobState.llms.Grok,
      'ok'
    );
    expect(finality.partial).toBe(true);
    expect(finality.completionReason).toBe('hard_stop_recovered_partial');
  });

  test('hard stop WITH completion evidence keeps success finality', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const entry = context.jobState.llms.Grok;
    entry.answerCompleteDetectedAt = Date.now() - 30000;
    const finality = context.classifyMaterializeRecoveryFinality('script_runtime_hard_stop', entry, 'ok');
    expect(finality.partial).toBe(false);
    expect(finality.completionReason).toBe('materialize_recovery');
  });

  test('benign recovery context (no_send) keeps success finality (Qwen preserved answer case)', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const finality = context.classifyMaterializeRecoveryFinality('no_send', context.jobState.llms.Grok, 'ok');
    expect(finality.partial).toBe(false);
  });

  test('partial_from_snapshot stays partial regardless of context', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const entry = context.jobState.llms.Grok;
    entry.answerCompleteDetectedAt = Date.now();
    const finality = context.classifyMaterializeRecoveryFinality('no_send', entry, 'partial_from_snapshot');
    expect(finality.partial).toBe(true);
    expect(finality.completionReason).toBe('soft_timeout');
  });
});

describe('hard-stop recovered answer finalizes as PARTIAL end-to-end', () => {
  test('acceptLateCollectResult with hard-stop partial meta produces PARTIAL terminal', async () => {
    const { context } = createSandbox({
      llms: {
        Grok: {
          tabId: 404,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 200000,
          lastDispatchMeta: { dispatchId: 'Grok:1781159284885:1' }
        }
      }
    });
    const entry = context.jobState.llms.Grok;
    const recoveredText = 'к'.repeat(550);
    const finality = context.classifyMaterializeRecoveryFinality('script_runtime_hard_stop', entry, 'ok');

    const accepted = context.acceptLateCollectResult('Grok', {
      ok: true,
      text: recoveredText,
      html: '',
      source: 'preserved_pending',
      status: 'ok'
    }, {
      dispatchId: 'Grok:1781159284885:1',
      sessionId: 1781159284885,
      runSessionId: 1781159284885,
      preTerminalMaterialize: true,
      materializeLatestEvidence: true,
      responseMeta: {
        source: 'preserved_pending',
        completionReason: finality.completionReason,
        sanityConfidence: finality.partial ? 0.72 : 0.86,
        partial: finality.partial,
        recovered: true
      }
    });
    expect(accepted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(entry.finalStatus).toBe('PARTIAL');
    expect(entry.finalizationEvidence?.lengthPolicy?.policyRef).toBe('answer-length-policy@1');
  });
});
