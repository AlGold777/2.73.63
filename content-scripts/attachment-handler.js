// Shared attachment handler with per-platform selectors and manual fallback.
(function (global) {
  if (global.AttachmentHandler) return;

  const DEFAULT_MAX_FILES = 5;
  const DEFAULT_TIMEOUT_MS = (typeof TimingConfig?.getTiming === 'function')
    ? TimingConfig.getTiming('attachmentTimeoutMs', 10000)
    : 10000;
  const DEFAULT_POLL_MS = (typeof TimingConfig?.getTiming === 'function')
    ? TimingConfig.getTiming('attachmentPollMs', 200)
    : 200;

  const MODEL_CONFIG = {
    GPT: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        'button[aria-label*="Upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]'
      ]
    },
    Grok: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        'button[aria-label*="Upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]'
      ]
    },
    Claude: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        '[data-testid="composer-upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-upload-id]',
        '[data-testid*="upload"] [data-upload-id]',
        '[data-testid*="file"]',
        '[data-testid*="attachment"]'
      ],
      confirmGoneSelectors: [
        '[data-testid*="upload"] [role="progressbar"]',
        '[data-testid*="upload"] [aria-busy="true"]',
        '[data-upload-id][aria-busy="true"]'
      ]
    },
    Gemini: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-test-id*="file"]',
        '[data-testid*="file"]',
        '.file-preview',
        '.file-chip'
      ]
    },
    Perplexity: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[class*="file-chip"]',
        '[class*="attachment"]',
        '[class*="upload"]'
      ],
      confirmGoneSelectors: [
        '[class*="upload"][aria-busy="true"]',
        '[class*="upload"] [role="progressbar"]'
      ]
    },
    Qwen: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[class*="attachment"]',
        '[class*="file"]',
        '[class*="file-card"]'
      ],
      confirmGoneSelectors: [
        '[class*="upload"][aria-busy="true"]',
        '[class*="upload"] [role="progressbar"]'
      ]
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const parseDataUrlToBytes = (dataUrl = '') => {
    try {
      const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
      const base64Part = match ? match[2] : dataUrl;
      const binary = atob(base64Part || '');
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (err) {
      console.warn('[AttachmentHandler] Failed to parse data URL', err);
      return null;
    }
  };

  const hydrateAttachments = (raw = []) => {
    return (raw || [])
      .map((item) => {
        if (!item || !item.name || !item.base64) return null;
        try {
          const bytes = parseDataUrlToBytes(item.base64);
          if (!bytes) return null;
          return new File([bytes], item.name, { type: item.type || 'application/octet-stream' });
        } catch (err) {
          console.warn('[AttachmentHandler] Failed to hydrate attachment', item?.name, err);
          return null;
        }
      })
      .filter(Boolean);
  };

  const resolveConfig = (model, overrides = {}) => {
    const base = MODEL_CONFIG[model] || {};
    return {
      attachSelectors: overrides.attachSelectors || base.attachSelectors || [],
      inputSelectors: overrides.inputSelectors || base.inputSelectors || [],
      confirmSelectors: overrides.confirmSelectors || base.confirmSelectors || [],
      confirmGoneSelectors: overrides.confirmGoneSelectors || base.confirmGoneSelectors || [],
      timeoutMs: Number.isFinite(overrides.timeoutMs) ? overrides.timeoutMs : DEFAULT_TIMEOUT_MS,
      pollMs: Number.isFinite(overrides.pollMs) ? overrides.pollMs : DEFAULT_POLL_MS,
      maxFiles: Number.isFinite(overrides.maxFiles) ? overrides.maxFiles : DEFAULT_MAX_FILES
    };
  };

  const waitForSelectorMatch = async (selectors = [], timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS) => {
    if (!selectors.length) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        if (!selector) continue;
        if (document.querySelector(selector)) return true;
      }
      await sleep(pollMs);
    }
    return false;
  };

  const countSelectorMatches = (selectors = []) => {
    if (!selectors.length) return 0;
    const matches = new Set();
    selectors.forEach((selector) => {
      if (!selector) return;
      document.querySelectorAll(selector).forEach((el) => matches.add(el));
    });
    return matches.size;
  };

  const waitForUploadConfirmation = async (config, expectedCount = 1) => {
    const confirmSelectors = config.confirmSelectors || [];
    const confirmGoneSelectors = config.confirmGoneSelectors || [];
    if (!confirmSelectors.length && !confirmGoneSelectors.length) return true;
    const totalTimeoutMs = (config.timeoutMs || DEFAULT_TIMEOUT_MS) * Math.max(1, expectedCount);
    const pollMs = config.pollMs || DEFAULT_POLL_MS;
    const deadline = Date.now() + totalTimeoutMs;
    const baseline = countSelectorMatches(confirmSelectors);
    let lastCount = baseline;
    let sawProgress = false;

    while (Date.now() < deadline) {
      const currentCount = countSelectorMatches(confirmSelectors);
      if (currentCount >= baseline + expectedCount) return true;
      if (confirmGoneSelectors.length) {
        const progressCount = countSelectorMatches(confirmGoneSelectors);
        if (progressCount > 0) sawProgress = true;
        if (sawProgress && progressCount === 0 && currentCount > baseline) return true;
      }
      lastCount = currentCount;
      await sleep(pollMs);
    }
    return lastCount > baseline && !confirmGoneSelectors.length;
  };

  const findFirst = async (selectors = [], timeoutMs = 2000, pollMs = 150) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        if (!selector) continue;
        const el = document.querySelector(selector);
        if (el) return el;
      }
      await sleep(pollMs);
    }
    return null;
  };

  const attachViaInput = async (files, config) => {
    const attachButton = await findFirst(config.attachSelectors, 1200, 120);
    if (attachButton) {
      try {
        attachButton.click();
        await sleep(300);
      } catch (_) {}
    }
    const input = await findFirst(config.inputSelectors, 3000, 120) || document.querySelector('input[type="file"]');
    if (!input) return false;
    const dt = new DataTransfer();
    files.forEach((file) => {
      try { dt.items.add(file); } catch (_) {}
    });
    try {
      input.files = dt.files;
    } catch (err) {
      console.warn('[AttachmentHandler] Failed to set input files', err);
    }
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    try { input.focus?.({ preventScroll: true }); } catch (_) { try { input.focus?.(); } catch (_) {} }
    return true;
  };

  const attachViaBridge = async (attachments, config) => {
    if (!attachments || !attachments.length) return false;
    const ensureBridge = global.ContentUtils?.ensureMainWorldBridge;
    if (typeof ensureBridge === 'function') {
      const loaded = await ensureBridge();
      if (!loaded) return false;
    }
    try {
      window.dispatchEvent(new CustomEvent('EXT_ATTACH', {
        detail: {
          attachments,
          attachSelectors: config.attachSelectors,
          inputSelectors: config.inputSelectors
        }
      }));
      await sleep(200);
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] Bridge attach failed', err);
      return false;
    }
  };

  const notifyManualAttachmentRequired = (modelName, attachments = [], reason = '') => {
    if (!attachments || !attachments.length) return;
    const label = modelName || 'LLM';
    const message = `${label}: failed to attach ${attachments.length} file(s) automatically. Please attach manually.`;
    try {
      chrome?.runtime?.sendMessage?.({ type: 'ATTACHMENT_MANUAL_REQUIRED', llmName: label, message });
    } catch (_) {}
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: label,
        event: { type: 'ATTACH', label: 'Manual attachment required', details: message, level: 'warning', meta: { reason } }
      });
    } catch (_) {}
  };

  const attach = async (model, attachments = [], overrides = {}) => {
    if (!attachments || !attachments.length) {
      return { success: true, uploadedCount: 0, failedFiles: [], reason: 'NO_ATTACHMENTS' };
    }
    const config = resolveConfig(model, overrides);
    const files = hydrateAttachments(attachments).slice(0, config.maxFiles);
    if (!files.length) {
      return { success: false, uploadedCount: 0, failedFiles: attachments, reason: 'NO_FILES' };
    }
    let attached = false;
    let attempted = false;
    const expectedCount = files.length;

    const viaBridge = await attachViaBridge(attachments, config);
    if (viaBridge) {
      attempted = true;
      attached = await waitForUploadConfirmation(config, expectedCount);
    }
    if (!attached) {
      const viaInput = await attachViaInput(files, config);
      if (viaInput) {
        attempted = true;
        attached = await waitForUploadConfirmation(config, expectedCount);
      }
    }
    if (!attached) {
      return {
        success: false,
        uploadedCount: 0,
        failedFiles: attachments,
        reason: attempted ? 'TIMEOUT' : 'MANUAL_REQUIRED'
      };
    }
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'SMART_ATTACHMENT_CONFIRMED',
        llmName: model || null,
        uploadedCount: files.length,
        reason: 'OK',
        ts: Date.now()
      });
    } catch (_) {}
    return { success: true, uploadedCount: files.length, failedFiles: [], reason: 'OK' };
  };

  global.AttachmentHandler = {
    attach,
    notifyManualAttachmentRequired,
    hydrateAttachments
  };
})(typeof window !== 'undefined' ? window : self);
