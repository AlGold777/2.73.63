const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_PATH = path.join(__dirname, '..', 'background', 'job-orchestrator.js');
const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(JOB_ORCHESTRATOR_PATH, 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');

function createSandbox() {
  const logs = [];
  const stateUpdates = [];
  const partialMessages = [];

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
      session: {
        startTime: 1778621552201,
        totalModels: 1,
        completed: 0,
        failed: 0
      },
      llms: {
        GPT: {
          tabId: 101,
          requestId: 'req-gpt',
          lastDispatchMeta: { dispatchId: 'dispatch-gpt' }
        },
        Perplexity: {
          tabId: 202,
          requestId: 'req-pplx',
          lastDispatchMeta: { dispatchId: 'dispatch-pplx' }
        },
        Qwen: {
          tabId: 303,
          requestId: 'req-qwen',
          lastDispatchMeta: { dispatchId: 'dispatch-qwen' }
        }
      }
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: {
      set: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve(null))
    },
    TabMapManager: {
      get: jest.fn((name) => context.jobState.llms?.[name]?.tabId || null),
      entries: jest.fn(() => []),
      removeByName: jest.fn()
    },
    appendLogEntry: jest.fn((llmName, entry) => logs.push({ llmName, entry })),
    updateModelState: jest.fn((llmName, status, meta) => stateUpdates.push({ llmName, status, meta })),
    sendMessageToResultsTab: jest.fn((payload) => partialMessages.push(payload)),
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
    resolveModelFinalStatus: jest.fn(() => 'SUCCESS'),
    resolveModelDoneReason: jest.fn(() => 'ok'),
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
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });

  return { context, logs, stateUpdates, partialMessages };
}

describe('early terminal success guard', () => {
  test('defers risky terminal success before lifecycle ready', () => {
    const { context, logs, stateUpdates, partialMessages } = createSandbox();
    const entry = context.jobState.llms.Perplexity;
    const answer = 'x'.repeat(339);

    const deferred = context.maybeDeferEarlyTerminalSuccess('Perplexity', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>partial</p>',
      responseSource: 'dom_snapshot_recovery',
      completionReason: 'dom_snapshot_recovery',
      metaObj: { dispatchId: 'dispatch-pplx' }
    });

    expect(deferred).toBe(true);
    expect(entry.earlyTerminalGuard).toEqual(
      expect.objectContaining({
        dispatchId: 'dispatch-pplx',
        answerLength: 339,
        responseSource: 'dom_snapshot_recovery'
      })
    );
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Perplexity', status: 'RECEIVING' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Perplexity'
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Perplexity',
          entry: expect.objectContaining({ label: 'Terminal success deferred (await lifecycle)' })
        })
      ])
    );
  });

  test('allows risky terminal success after repeated stable long answer', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.GPT;
    const answer = 'y'.repeat(1900);
    const signature = context.buildEarlyTerminalGuardSignature(answer);
    entry.earlyTerminalGuard = {
      dispatchId: 'dispatch-gpt',
      startedAt: Date.now() - 5000,
      lastSeenAt: Date.now() - 3000,
      signature,
      answerLength: answer.length,
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive'
    };

    const deferred = context.maybeDeferEarlyTerminalSuccess('GPT', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>full</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-gpt' }
    });

    expect(deferred).toBe(false);
    expect(entry.earlyTerminalGuard).toBeFalsy();
  });

  test('allows changed long answer after guard max wait to avoid stale lifecycle lock', () => {
    const { context, logs } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    const previousAnswer = 'previous qwen answer '.repeat(600);
    const nextAnswer = `${previousAnswer}final paragraph changed`;
    entry.earlyTerminalGuard = {
      dispatchId: 'dispatch-qwen',
      startedAt: Date.now() - 25000,
      lastSeenAt: Date.now() - 500,
      signature: context.buildEarlyTerminalGuardSignature(previousAnswer),
      answerLength: previousAnswer.length,
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive'
    };

    const deferred = context.maybeDeferEarlyTerminalSuccess('Qwen', entry, {
      trimmedAnswer: nextAnswer,
      normalizedAnswer: nextAnswer,
      normalizedHtml: '<p>long changed qwen answer</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(deferred).toBe(false);
    expect(entry.earlyTerminalGuard).toBeFalsy();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Qwen',
          entry: expect.objectContaining({ label: 'Terminal success guard max wait elapsed' })
        })
      ])
    );
  });

  test('defers Qwen terminal success after generation-inactive probe until lifecycle or stable guard', () => {
    const { context, stateUpdates } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    const answer = 'q'.repeat(420);

    const deferred = context.maybeDeferEarlyTerminalSuccess('Qwen', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>partial qwen</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(deferred).toBe(true);
    expect(entry.earlyTerminalGuard).toEqual(
      expect.objectContaining({
        dispatchId: 'dispatch-qwen',
        answerLength: 420,
        responseSource: 'deferred_finalization'
      })
    );
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Qwen', status: 'RECEIVING' })
      ])
    );
  });

  test('allows repeated stable short answer after guard max wait', () => {
    const { context } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    const answer = 'short but complete answer from qwen'.repeat(4);
    const signature = context.buildEarlyTerminalGuardSignature(answer);
    entry.earlyTerminalGuard = {
      dispatchId: 'dispatch-qwen',
      startedAt: Date.now() - 25000,
      lastSeenAt: Date.now() - 3000,
      signature,
      answerLength: answer.length,
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive'
    };

    const deferred = context.maybeDeferEarlyTerminalSuccess('Qwen', entry, {
      trimmedAnswer: answer,
      normalizedAnswer: answer,
      normalizedHtml: '<p>short</p>',
      responseSource: 'deferred_finalization',
      completionReason: 'generation_inactive',
      metaObj: { dispatchId: 'dispatch-qwen' }
    });

    expect(deferred).toBe(false);
    expect(entry.earlyTerminalGuard).toBeNull();
  });

  test('does not defer explicit user late collect terminal success', async () => {
    const { context, stateUpdates, partialMessages } = createSandbox();
    const entry = context.jobState.llms.Qwen;
    entry.status = 'RECOVERABLE_ERROR';
    const answer = 'recovered qwen answer '.repeat(190);

    const accepted = context.acceptLateCollectResult('Qwen', {
      ok: true,
      status: 'success',
      text: answer,
      html: '<p>recovered qwen answer</p>',
      source: 'inline_executeScript',
      candidateCount: 2
    }, {
      source: 'collect_responses_staged_late_collect',
      dispatchId: 'dispatch-qwen',
      responseMeta: {
        source: 'collect_responses_staged_late_collect',
        completionReason: 'user_collect_late_collect',
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toBe(true);
    expect(entry.earlyTerminalGuard).toBeFalsy();
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('SUCCESS');
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Qwen', status: 'SUCCESS' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Qwen',
          metadata: expect.objectContaining({ status: 'SUCCESS' })
        })
      ])
    );
  });

  test('recovers Qwen false NO_SEND when answer appears after prompt confirmation miss', async () => {
    const { context, stateUpdates, partialMessages, logs } = createSandbox();
    const entry = context.jobState.llms.Qwen;

    context.handleLLMResponse(
      'Qwen',
      'Error: prompt_not_confirmed_before_round4',
      { type: 'no_send', message: 'Prompt submission not confirmed before round4' },
      {
        dispatchId: 'dispatch-qwen',
        preTerminalMaterializeFinal: true,
        responseMeta: {
          failureClass: 'dispatch',
          source: 'round4_gate'
        }
      }
    );
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('NO_SEND');
    expect(entry.promptSubmittedAt).toBeFalsy();

    const answer = 'late recovered qwen answer '.repeat(120);
    const accepted = context.acceptLateCollectResult('Qwen', {
      ok: true,
      status: 'success',
      text: answer,
      html: '<p>late recovered qwen answer</p>',
      source: 'inline_executeScript',
      candidateCount: 3
    }, {
      source: 'materialize_latest_retry:no_send',
      dispatchId: 'dispatch-qwen',
      preTerminalMaterialize: true,
      responseMeta: {
        source: 'materialize_latest_retry:no_send',
        completionReason: 'late_collect',
        recovered: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toBe(true);
    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('SUCCESS');
    expect(entry.promptSubmittedAt).toBeTruthy();
    expect(entry.submitSource).toBe('inferred_answer_evidence');
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'Qwen', status: 'SUCCESS' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Qwen',
          metadata: expect.objectContaining({ status: 'SUCCESS' })
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Qwen',
          entry: expect.objectContaining({ label: 'Submit confirmation inferred from answer evidence' })
        })
      ])
    );
  });

  test('keeps Qwen non-terminal while page still reports active generation', async () => {
    const { context, partialMessages, logs } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: true, busyVisible: false } }
    ]));
    const answer = 'qwen partial answer'.repeat(40);

    context.handleLLMResponse('Qwen', answer, null, {
      dispatchId: 'dispatch-qwen',
      responseMeta: {
        source: 'dom',
        completionReason: 'ok'
      }
    });
    await Promise.resolve();

    expect(context.jobState.llms.Qwen.finalStatusRecorded).toBeFalsy();
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'Qwen',
          metadata: expect.objectContaining({ status: 'GENERATING' })
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'Qwen',
          entry: expect.objectContaining({ label: 'Finalization deferred (generation active)' })
        })
      ])
    );
  });

  test('does not let manual recovery force success while page is still generating', async () => {
    const { context, partialMessages, logs, stateUpdates } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: true, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    const answer = 'manual partial gpt answer '.repeat(80);

    context.handleLLMResponse('GPT', answer, null, {
      dispatchId: 'dispatch-gpt',
      manualRecovery: true,
      responseMeta: {
        source: 'manual_ping',
        completionReason: 'manual_ping_late_collect',
        manualRecovery: true,
        manualOverride: true,
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(stateUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ llmName: 'GPT', status: 'RECEIVING' })
      ])
    );
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'GPT',
          metadata: expect.objectContaining({ status: 'GENERATING' })
        })
      ])
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          entry: expect.objectContaining({ label: 'Finalization deferred (generation active)' })
        })
      ])
    );
  });

  test('records active generation at streaming max as partial, not success', async () => {
    const { context, partialMessages } = createSandbox();
    context.chrome.scripting.executeScript = jest.fn(() => Promise.resolve([
      { result: { active: true, stopVisible: false, busyVisible: true } }
    ]));
    const entry = context.jobState.llms.GPT;
    entry.finalizationDeferStartedAt = Date.now() - 181000;
    const answer = 'long answer still streaming '.repeat(90);

    context.handleLLMResponse('GPT', answer, null, {
      dispatchId: 'dispatch-gpt',
      responseMeta: {
        source: 'manual_ping',
        completionReason: 'manual_ping_late_collect',
        lateCollectFinal: true,
        forceTerminalSuccess: true
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(entry.finalStatusRecorded).toBe(true);
    expect(entry.finalStatus).toBe('PARTIAL');
    expect(partialMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName: 'GPT',
          metadata: expect.objectContaining({
            status: 'PARTIAL',
            completionReason: 'streaming_incomplete'
          })
        })
      ])
    );
  });
});
