// background/evaluation-manager.js
// Evaluation flow and session shutdown helpers.

'use strict';

function startEvaluation(evalPrompt, evaluatorName = 'Claude', options = {}) {
  const { openEvaluatorTab = true } = options;
  console.log(
    `[BACKGROUND] Starting evaluation in a ${openEvaluatorTab ? 'foreground' : 'background'} tab using ${evaluatorName}.`
  );

  if (!evalPrompt) {
    evalPrompt = `Compare ${Object.keys(jobState.llms).length} responses to the question: "${jobState.prompt}".\n\n`;
    Object.keys(jobState.llms).forEach((llmName, index) => {
      evalPrompt += `Response ${index + 1} (${llmName}):\n${jobState.llms[llmName].answer}\n\n`;
    });
    evalPrompt += `Select the best response, briefly explain why, and present the result as a bulleted list.`;
    evaluatorName = 'GPT';
  }

  const evaluatorUrls = {
    'GPT': 'https://chat.openai.com/',
    'Gemini': 'https://gemini.google.com/',
    'Claude': 'https://claude.ai/chat/new',
    'Grok': 'https://grok.com/',
    'Le Chat': 'https://chat.mistral.ai/chat/',
    'Qwen': 'https://chat.qwen.ai/',
    'DeepSeek': 'https://chat.deepseek.com/',
    'Perplexity': 'https://www.perplexity.ai/'
  };

  const url = evaluatorUrls[evaluatorName];
  if (!url) {
    const errorMsg = `Error: Unknown evaluator '${evaluatorName}'. Cannot open tab.`;
    console.error(`[BACKGROUND] ${errorMsg}`);
    sendMessageToResultsTab({
      type: 'PROCESS_COMPLETE',
      finalAnswer: errorMsg
    });
    return;
  }

  console.log(`[BACKGROUND] Creating new tab for ${evaluatorName} at ${url}`);
  chrome.tabs.create({ url: url, active: openEvaluatorTab }, (tab) => {
    evaluatorTabId = tab.id;
    trackSessionTab(tab.id);
    console.log(`[BACKGROUND] Created evaluation tab ${tab.id} for ${evaluatorName}.`);

    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        console.log(`[BACKGROUND] Evaluation tab ${tabId} loaded.`);

        const delay = evaluatorName === 'Claude' ? 10000 : 5000;
        setTimeout(() => {
          console.log(`[BACKGROUND] Sending evaluation prompt to tab ${tab.id}.`);
          chrome.tabs.sendMessage(tab.id, {
            type: 'GET_ANSWER',
            prompt: evalPrompt,
            isEvaluator: true,
            isFireAndForget: false
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error(`[BACKGROUND] Error delivering evaluation prompt:`, chrome.runtime.lastError.message);
              sendMessageToResultsTab({
                type: 'PROCESS_COMPLETE',
                finalAnswer: `Error: Failed to deliver evaluation prompt (${chrome.runtime.lastError.message})`
              });
            } else {
              console.log('[BACKGROUND] Evaluation prompt delivered successfully.');
              sendMessageToResultsTab({ type: 'STARTING_EVALUATION' });
            }
          });
        }, delay);

        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function handleEvaluatorResponse(finalAnswer) {
  console.log(`[BACKGROUND] Received evaluator response:`, finalAnswer.substring(0, 100) + '...');

  sendMessageToResultsTab({
    type: 'PROCESS_COMPLETE',
    finalAnswer: finalAnswer
  });
}

function closeAllSessions() {
  console.log('[BACKGROUND] Closing all active LLM tabs with cleanup...');
  stopHumanPresenceLoop();
  finalizeTabVisit('session_closed');
  humanPresencePaused = false;
  humanPresenceManuallyStopped = false;

  TabMapManager.entries().forEach(([llmName, tabId]) => {
    chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }, () => {
      if (chrome.runtime.lastError) {
        console.warn(`[BACKGROUND] Cleanup message failed for ${llmName}:`, chrome.runtime.lastError.message);
      }
    });
  });

  if (evaluatorTabId) {
    chrome.tabs.sendMessage(evaluatorTabId, { type: 'STOP_AND_CLEANUP' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[BACKGROUND] Cleanup message failed for evaluator');
      }
    });
  }

  setTimeout(() => {
    const tabIdsToClose = TabMapManager.entries().map(([, id]) => id);

    if (evaluatorTabId) {
      tabIdsToClose.push(evaluatorTabId);
    }

    if (tabIdsToClose.length > 0) {
      chrome.tabs.remove(tabIdsToClose, () => {
        if (chrome.runtime.lastError) {
          console.error('[BACKGROUND] Error closing tabs:', chrome.runtime.lastError.message);
        } else {
          console.log('[BACKGROUND] All LLM tabs have been closed.');
        }
      });
    }

    // Purpose: reset tab tracking without throwing inside the timeout callback.
    TabMapManager.clear().catch((err) => {
      console.warn('[BACKGROUND] TabMapManager.clear failed:', err);
    });
    evaluatorTabId = null;
    Object.keys(pingWindowByTabId).forEach(tabId => delete pingWindowByTabId[tabId]);
    Object.keys(llmActivityMap).forEach((tabId) => delete llmActivityMap[tabId]);
    clearActiveListeners();
    broadcastHumanVisitStatus();
  }, 500);
}

self.startEvaluation = startEvaluation;
self.handleEvaluatorResponse = handleEvaluatorResponse;
self.closeAllSessions = closeAllSessions;

console.log('[EvaluationManager] Module loaded');
