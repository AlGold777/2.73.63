// background/state-manager.js
// Central state updates for LLM status and UI broadcasts.

'use strict';

function updateModelState(llmName, status, data = {}) {
  if (!llmName || !status) return;
  const contract = self.LLMStatusContract || {};
  const runState = self.ModelRunState || {};
  const normalizeStatus = contract.normalizeStatus || ((value) => String(value || '').trim().toUpperCase());
  const normalizedStatus = normalizeStatus(status);

  if (jobState?.llms?.[llmName]) {
    const entry = jobState.llms[llmName];
    const currentStatus = entry.status;
    const terminalRunBlocksNonTerminal = Boolean(
      runState.isTerminalRunState
      && runState.isTerminalRunState(entry)
      && !(runState.isTerminalStatus ? runState.isTerminalStatus(normalizedStatus) : contract.isTerminalStatus?.(normalizedStatus))
    );
    if (terminalRunBlocksNonTerminal) {
      if (runState.recordPostTerminalNoise) {
        runState.recordPostTerminalNoise(entry, { label: normalizedStatus });
      }
      console.log(`[State Update] Skipping ${llmName}: ${normalizedStatus} blocked by modelRunState (terminal_blocks_non_terminal_status)`);
      appendLogEntry(llmName, {
        type: 'STATUS',
        label: 'STATUS_IGNORED',
        details: `${currentStatus || 'UNKNOWN'} -> ${normalizedStatus} (terminal_blocks_non_terminal_status)`,
        level: 'info',
        meta: {
          currentStatus: currentStatus || null,
          incomingStatus: normalizedStatus,
          reason: 'terminal_blocks_non_terminal_status',
          modelRunState: entry.modelRunState || null
        }
      });
      return;
    }
    const decision = contract.shouldApplyStatusUpdate
      ? contract.shouldApplyStatusUpdate(currentStatus, normalizedStatus, data)
      : { apply: true, reason: 'no_contract' };
    if (!decision.apply) {
      console.log(`[State Update] Skipping ${llmName}: ${normalizedStatus} blocked by ${decision.reason} (current: ${currentStatus})`);
      appendLogEntry(llmName, {
        type: 'STATUS',
        label: 'STATUS_IGNORED',
        details: `${currentStatus || 'UNKNOWN'} -> ${normalizedStatus} (${decision.reason})`,
        level: 'info',
        meta: {
          currentStatus: currentStatus || null,
          incomingStatus: normalizedStatus,
          reason: decision.reason,
          currentRank: decision.currentRank,
          incomingRank: decision.incomingRank
        }
      });
      return;
    }

    if (runState.applyModelRunTransition) {
      runState.applyModelRunTransition(entry, 'STATUS_UPDATE', {
        ...(data || {}),
        status: normalizedStatus,
        runSessionId: jobState?.session?.startTime || null,
        dispatchId: entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null,
        tabId: entry?.tabId || null
      });
    }
    entry.status = normalizedStatus;
    entry.statusData = data;
    entry.statusContract = contract.deriveStatusContract
      ? contract.deriveStatusContract(entry)
      : null;
  }

  const severity = (() => {
    if (['CRITICAL_ERROR', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'].includes(normalizedStatus)) return 'error';
    if (['RECOVERABLE_ERROR', 'ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(normalizedStatus)) return 'warning';
    return 'info';
  })();

  appendLogEntry(llmName, {
    type: 'STATUS',
    label: `Status: ${normalizedStatus}`,
    details: data?.message || '',
    level: severity,
    meta: {
      status: normalizedStatus,
      modelRunState: jobState?.llms?.[llmName]?.modelRunState || null
    }
  });
  console.log(`[State Update] ${llmName} -> ${normalizedStatus}`);
  const outgoingData = {
    ...(data || {}),
    modelRunState: jobState?.llms?.[llmName]?.modelRunState || null
  };
  sendMessageToResultsTab({
    type: 'STATUS_UPDATE',
    llmName,
    status: normalizedStatus,
    data: outgoingData,
    logs: getLogSnapshot(llmName)
  });
  broadcastGlobalState();
}

self.updateModelState = updateModelState;

console.log('[StateManager] Module loaded');
