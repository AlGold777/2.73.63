const fs = require('fs');
const path = require('path');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const blobToText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

function installChromeStorageMock() {
  const store = new Map();
  chrome.runtime.getURL = jest.fn((value) => value);
  chrome.storage.local.get = jest.fn((key, callback) => {
    let result = {};
    if (key === null) {
      store.forEach((value, storeKey) => { result[storeKey] = value; });
    } else if (typeof key === 'string') {
      result = { [key]: store.get(key) };
    } else if (Array.isArray(key)) {
      key.forEach((item) => { result[item] = store.get(item); });
    } else {
      Object.keys(key || {}).forEach((item) => {
        result[item] = store.has(item) ? store.get(item) : key[item];
      });
    }
    if (typeof callback === 'function') {
      callback(result);
      return undefined;
    }
    return Promise.resolve(result);
  });
  chrome.storage.local.set = jest.fn((obj, callback) => {
    Object.entries(obj || {}).forEach(([key, value]) => store.set(key, value));
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });
}

function installDomMocks() {
  window.ResultsShared = {
    escapeHtml: (value = '') => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    stripHtmlToPlainText: (html = '') => String(html).replace(/<[^>]*>/g, ''),
    buildResponseCopyHtmlBlock: () => '',
    wrapResponsesHtmlBundle: (sections = '') => sections,
    fallbackCopyViaTextarea: jest.fn(),
    flashButtonFeedback: jest.fn(),
    writeRichContentToClipboard: jest.fn()
  };
  window.fetch = jest.fn(async (url = '') => {
    const pathValue = String(url);
    let payload = { templates: [] };
    if (pathValue.includes('system_templates/index.json')) {
      payload = [];
    } else if (pathValue.includes('Modifiers/modifier-presets.json')) {
      payload = [{ id: 'base', label: 'Base', file: 'modifiers.json' }];
    } else if (pathValue.includes('Modifiers/modifiers.json')) {
      payload = [];
    }
    return {
      ok: true,
      json: async () => payload
    };
  });
  document.execCommand = jest.fn();
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 120,
      height: 20,
      top: 20,
      left: 20,
      right: 140,
      bottom: 40,
      x: 20,
      y: 20,
      toJSON() { return this; }
    })
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 640,
      height: 320,
      top: 0,
      left: 0,
      right: 640,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON() { return this; }
    })
  });
}

function renderDebateDom() {
  document.body.innerHTML = `
    <div class="prompt-sandwich">
      <div class="debate-sel-toolbar" id="debateSelTb">
        <button class="stb col" data-color="#fde68a" aria-label="Yellow highlight">Yellow</button>
        <button class="stb col" data-color="#bbf7d0" aria-label="Green highlight">Green</button>
        <button class="stb col" data-color="#bfdbfe" aria-label="Blue highlight">Blue</button>
        <button class="stb" data-cmd="bold" aria-label="Bold">Bold</button>
        <button class="stb" data-cmd="italic" aria-label="Italic">Italic</button>
        <button class="stb" data-fav="1" aria-label="Add selected fragment to favorites">Favorite</button>
      </div>
      <div id="debate-session-tabs">
        <button type="button" class="debate-session-tab active" data-session-id="1">1</button>
      </div>
      <div class="llm-buttons">
        <button class="llm-button" id="llm-gpt">GPT</button>
        <button class="llm-button" id="llm-gemini">Gemini</button>
        <button class="llm-button" id="llm-claude">Claude</button>
        <button class="llm-button" id="llm-grok">Grok</button>
        <button class="llm-button" id="llm-lechat">Le Chat</button>
        <button class="llm-button" id="llm-qwen">Qwen</button>
        <button class="llm-button" id="llm-deepseek">DeepSeek</button>
        <button class="llm-button" id="llm-perplexity">Perplexity</button>
      </div>
      <button id="debate-session-add-btn" type="button">+</button>
      <button id="debate-session-delete-btn" type="button">−</button>
      <button id="debate-session-copy-btn" type="button">copy</button>
      <button id="debate-session-export-btn" type="button">export</button>
      <button id="debate-session-clear-btn" type="button">clear</button>
      <button id="debate-auto-pause-btn" class="hidden" type="button">Ⅱ</button>
      <select id="debate-run-policy-select">
        <option value="manual" selected>Manual</option>
        <option value="auto">Auto</option>
      </select>
      <input id="auto-checkbox" type="checkbox" hidden aria-hidden="true">
      <input id="debate-max-turns-input" type="number" value="5">
      <div id="pipeline-panel">
        <div class="model-stack" id="r1-models">
          <div class="model-block">
            <span class="model-name">GPT</span>
            <input type="checkbox" class="model-input-checkbox" checked>
            <input type="checkbox" class="model-send-checkbox" checked>
          </div>
          <div class="model-block">
            <span class="model-name">Claude</span>
            <input type="checkbox" class="model-input-checkbox">
            <input type="checkbox" class="model-send-checkbox" checked>
          </div>
        </div>
        <div class="output-stack" id="output-stack">
          <div class="output-block" data-output="notes">
            <input type="checkbox" class="output-checkbox" checked>
            <span class="output-name">Renamed A</span>
          </div>
          <div class="output-block" data-output="export">
            <input type="checkbox" class="output-checkbox">
            <span class="output-name">Renamed B</span>
          </div>
          <div class="output-block" data-output="exportHtml">
            <input type="checkbox" class="output-checkbox" checked>
            <span class="output-name">Renamed C</span>
          </div>
        </div>
      </div>
      <textarea id="prompt-input"></textarea>
      <div id="debate-model-cards"></div>
      <div id="create-template-modal" class="modal">
        <button class="close" type="button">x</button>
        <div class="model-selector"></div>
      </div>
      <select id="template-select"></select>
      <button id="cancel-template" type="button"></button>
      <button id="save-template" type="button"></button>
      <button id="add-variable" type="button"></button>
      <input id="template-name">
      <textarea id="template-prompt"></textarea>
      <div id="template-preview"></div>
      <div id="variables-list"></div>
      <div id="saved-templates-list"></div>
      <div id="system-templates-list"></div>
      <div id="saved-templates-box"></div>
      <button id="saved-templates-toggle" type="button"></button>
      <div id="saved-templates-content"></div>
      <div id="system-templates-box"></div>
      <button id="system-templates-toggle" type="button"></button>
      <div id="system-templates-content"></div>
      <div id="variable-inputs"></div>
      <button id="export-templates-btn" type="button"></button>
      <button id="import-templates-btn" type="button"></button>
      <input id="import-file-input" type="file">
      <div id="confirm-modal" class="modal"></div>
      <div id="confirm-message"></div>
      <button id="delete-confirm" type="button"></button>
      <button id="cancel-confirm" type="button"></button>
      <div id="notification-modal" class="modal"></div>
      <div id="notification-message"></div>
      <button id="notification-ok-btn" type="button"></button>
      <input id="file-input" type="file">
      <div id="file-name-display"></div>
    </div>
  `;
}

function addDebateCard({ id, text, starred = false, model = 'GPT' }) {
  const sessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId || '1';
  const card = document.createElement('div');
  card.className = 'debate-model-card';
  card.dataset.sessionId = sessionId;
  card.dataset.entryId = id;
  card.dataset.messageId = id;
  card.dataset.llmName = model;
  card.dataset.entryKind = 'response';
  card.dataset.kind = 'answer';
  card.dataset.starred = starred ? 'true' : 'false';
  card.innerHTML = `
    <div class="debate-model-card-header">
      <span class="debate-model-card-title-main">
        <span class="debate-model-card-name">${model}</span>
        <span class="debate-model-card-role"></span>
      </span>
      <span class="debate-model-card-meta">
        <span class="debate-model-card-time">12:00</span>
        <button type="button" class="ib debate-fav">★</button>
      </span>
    </div>
    <div class="debate-model-card-output">${text}</div>
  `;
  document.getElementById('debate-model-cards').appendChild(card);
  return card;
}

function addPendingApprovalCard({ id, text, model }) {
  const card = addDebateCard({ id, text, model });
  card.dataset.approved = 'false';
  card.dataset.approvalSelectable = 'true';
  const titleMain = card.querySelector('.debate-model-card-title-main');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'debate-approval-check';
  checkbox.setAttribute('aria-label', 'Approve this answer');
  titleMain.appendChild(checkbox);
  return card;
}

async function selectTextInOutput(output, start, end) {
  const textNode = output.firstChild;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  output.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await delay(20);
}

async function loadResultsScript() {
  installChromeStorageMock();
  installDomMocks();
  window.__RESULTS_TEST_DEBUG__ = true;
  const pipelineRuntime = fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');
  window.eval(pipelineRuntime);
  const debateEngine = fs.readFileSync(path.join(__dirname, '..', 'shared', 'debate-engine.js'), 'utf8');
  window.eval(debateEngine);
  const script = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  window.eval(script);
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  await delay(20);
}

describe('Pipeline debate favorites view', () => {
  beforeAll(async () => {
    renderDebateDom();
    await loadResultsScript();
  });

  beforeEach(async () => {
    document.getElementById('debate-session-clear-btn').click();
    const deleteBtn = document.getElementById('debate-session-delete-btn');
    while (document.querySelectorAll('.debate-session-tab').length > 1) {
      deleteBtn.click();
      await delay(20);
    }
    const tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await delay(220);
  });

  test('double-clicking the active session tab enables favorite-only without creating a session', async () => {
    const plain = addDebateCard({ id: 'msg-1', text: 'ordinary answer' });
    const starred = addDebateCard({ id: 'msg-2', text: 'saved answer', starred: true });
    const tab = document.querySelector('.debate-session-tab.active');

    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active').classList.contains('favorite-only')).toBe(true);
    expect(plain.style.display).toBe('none');
    expect(starred.style.display).toBe('');
  });

  test('single click on a favorite-only session returns the full timeline', async () => {
    const plain = addDebateCard({ id: 'msg-1', text: 'ordinary answer' });
    const starred = addDebateCard({ id: 'msg-2', text: 'saved answer', starred: true });
    let tab = document.querySelector('.debate-session-tab.active');

    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);
    expect(plain.style.display).toBe('none');

    tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await delay(220);

    expect(document.querySelector('.debate-session-tab.active').classList.contains('favorite-only')).toBe(false);
    expect(plain.style.display).toBe('');
    expect(starred.style.display).toBe('');
  });

  test('favoriting selected text creates a starred fragment-card linked to the source message', async () => {
    const source = addDebateCard({
      id: 'source-1',
      model: 'Claude',
      text: 'This answer contains an important fragment for later analysis.'
    });
    const output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 24, 42);
    document.querySelector('#debateSelTb [data-fav]').click();

    const fragment = document.querySelector('.fragment-card[data-kind="fragment"]');
    expect(fragment).not.toBeNull();
    expect(fragment.dataset.starred).toBe('true');
    expect(fragment.dataset.sessionId).toBe('1');
    expect(fragment.dataset.sourceMessageId).toBe('source-1');
    expect(fragment.dataset.sourceCardId).toBe(source.id);
    expect(fragment.textContent).toContain('important fragment');
    expect(fragment.style.display).toBe('none');

    const tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);
    expect(fragment.style.display).toBe('');
    expect(source.style.display).toBe('none');
  });

  test('delete session removes the current session when multiple sessions exist', async () => {
    const addBtn = document.getElementById('debate-session-add-btn');
    addBtn.click();
    await delay(220);
    const activeBeforeDelete = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId;
    addDebateCard({ id: 'delete-me', text: 'session to remove' });
    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(2);

    document.getElementById('debate-session-delete-btn').click();
    await delay(30);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active')).not.toBeNull();
    expect(document.querySelector('.debate-session-tab.active')?.dataset?.sessionId).not.toBe(activeBeforeDelete);
    expect(document.querySelector('[data-session-id="' + activeBeforeDelete + '"]')).toBeNull();
  });

  test('delete session clears the only remaining session instead of removing it', async () => {
    const activeSessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId;
    addDebateCard({ id: 'only-session-card', text: 'this will be cleared' });
    expect(document.querySelectorAll('.debate-model-card')).toHaveLength(1);

    document.getElementById('debate-session-delete-btn').click();
    await delay(30);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active')?.dataset?.sessionId).toBe(activeSessionId);
    expect(document.querySelectorAll('.debate-model-card')).toHaveLength(0);
  });

  test('approving a lower pending card moves it above remaining pending cards', async () => {
    const qwen = addPendingApprovalCard({
      id: 'qwen-pending',
      model: 'Qwen',
      text: 'Qwen pending answer'
    });
    const leChat = addPendingApprovalCard({
      id: 'lechat-pending',
      model: 'Le Chat',
      text: 'Le Chat approved first'
    });

    expect(Array.from(document.querySelectorAll('.debate-model-card')).map((card) => card.dataset.llmName))
      .toEqual(['Qwen', 'Le Chat']);

    window.approveDebateCheckbox(leChat.querySelector('.debate-approval-check'));
    await delay(20);

    const order = Array.from(document.querySelectorAll('.debate-model-card')).map((card) => card.dataset.llmName);
    expect(order).toEqual(['Le Chat', 'Qwen']);
    expect(leChat.dataset.approved).toBe('true');
    expect(leChat.querySelector('.debate-approval-check')).toBeNull();
    expect(qwen.dataset.approved).not.toBe('true');
  });

  test('selection toolbar formats the source card text in the normal timeline', async () => {
    const source = addDebateCard({
      id: 'source-format',
      model: 'GPT',
      text: 'Format this fragment in place.'
    });
    let output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 7, 11);
    const toolbar = document.getElementById('debateSelTb');
    toolbar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('#debateSelTb [data-color="#fde68a"]').click();

    let highlight = output.querySelector('span');
    expect(highlight).not.toBeNull();
    expect(highlight.textContent).toBe('this');
    expect(highlight.getAttribute('style')).toContain('background-color');
    expect(source.style.display).toBe('');
    expect(document.querySelector('.fragment-card')).toBeNull();

    output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 0, 6);
    toolbar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('#debateSelTb [data-cmd="bold"]').click();

    const bold = output.querySelector('strong');
    expect(bold).not.toBeNull();
    expect(bold.textContent).toBe('Format');
  });

  test('export all responses includes Favourite content in the same HTML bundle', async () => {
    const responsePanel = document.createElement('div');
    responsePanel.className = 'llm-panel';
    responsePanel.id = 'panel-gpt';
    responsePanel.innerHTML = `
      <div class="llm-header">
        <span class="llm-title">GPT</span>
        <div class="header-right">
          <button type="button" class="panel-action-btn panel-fav-btn" data-target="gpt-output" aria-label="Add to favorites">★</button>
        </div>
      </div>
      <div class="output" id="gpt-output">Base model response.</div>
    `;
    document.body.appendChild(responsePanel);
    const originalBuildResponseCopyHtmlBlock = window.ResultsShared.buildResponseCopyHtmlBlock;
    window.ResultsShared.buildResponseCopyHtmlBlock = (name, metadataLine, bodyHtml) => `
      <section>
        <h2>${name}</h2>
        ${metadataLine ? `<p class="response-meta">${metadataLine}</p>` : ''}
        <div class="response-body">${bodyHtml}</div>
      </section>
    `;
    const originalFavoriteEntries = [...window.__resultsExportDebug.favoriteState.entries];
    const originalFavoriteCardMap = new Map(window.__resultsExportDebug.favoriteState.cardKeyToId);
    const originalFavoriteNextId = window.__resultsExportDebug.favoriteState.nextId;
    window.__resultsExportDebug.favoriteState.entries = [{
      id: 'fav-test-1',
      kind: 'card',
      sourceName: 'GPT',
      modelKey: 'gpt',
      sourceOutputId: 'gpt-output',
      text: 'Base model response.',
      html: '',
      timeLabel: '12:00'
    }];
    window.__resultsExportDebug.favoriteState.cardKeyToId = new Map([['card:gpt-output', 'fav-test-1']]);
    window.__resultsExportDebug.favoriteState.nextId = 2;
    const html = window.__resultsExportDebug.buildAllResponsesExportHtml();
    expect(html).toContain('<h2>LLM Responses</h2>');
    expect(html).toContain('<h2>Favourite</h2>');
    expect(html).toContain('Base model response.');
    window.__resultsExportDebug.favoriteState.entries = originalFavoriteEntries;
    window.__resultsExportDebug.favoriteState.cardKeyToId = originalFavoriteCardMap;
    window.__resultsExportDebug.favoriteState.nextId = originalFavoriteNextId;
    window.ResultsShared.buildResponseCopyHtmlBlock = originalBuildResponseCopyHtmlBlock;
    responsePanel.remove();
  });

  test('selection toolbar actions have visible labels in the panel markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html).toContain('aria-label="Yellow highlight"');
    expect(html).toContain('<span class="stb-label">Yellow</span>');
    expect(html).toContain('<span class="stb-label">Bold</span>');
    expect(html).toContain('aria-label="Add selected fragment to favorites"');
    expect(html).toContain('<span class="stb-label">Favorite</span>');
  });

  test('selection toolbar is absolutely positioned near the selected fragment and has visible icons', async () => {
    const card = addDebateCard({ id: 'msg-toolbar', text: 'Toolbar anchor text', model: 'GPT' });
    const output = card.querySelector('.debate-model-card-output');

    await selectTextInOutput(output, 0, 7);

    const toolbar = document.getElementById('debateSelTb');
    expect(toolbar.classList.contains('vis')).toBe(true);
    expect(toolbar.style.top).toBeTruthy();
    expect(toolbar.style.left).toBeTruthy();

    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    expect(css).toContain('.debate-sel-toolbar {\n    position: absolute;');
    expect(css).toContain('background: #ffffff;');
    expect(css).toContain('.debate-sel-toolbar .stb.col::before');
    expect(css).toContain('.debate-sel-toolbar .stb.col[data-color="#FFEB3B"] { --swatch-color: #FFEB3B; }');
    expect(css).toContain('.debate-sel-toolbar .stb[data-cmd="bold"]::before { content: "B"; }');
    expect(css).toContain('.debate-sel-toolbar .stb[data-fav]::before');
  });

  test('model cards use 14px text, keep empty one-line cards, and cap long responses at five lines', async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    expect(css).toContain('.debate-model-card,\n.debate-model-card :where(*) {\n    font-size: 14px !important;');
    expect(css).toContain('min-height: var(--debate-card-line-height);');
    expect(css).toContain('max-height: var(--debate-card-line-height);');
    expect(css).not.toContain('min-height: calc(var(--debate-card-line-height) * 6);');
    expect(css).toContain('max-height: calc(var(--debate-card-line-height) * 5);');
    expect(css).toContain('.debate-model-card.has-overflow {');
    expect(css).toContain('position: absolute;');

    const shortText = ['Short 1', 'Short 2', 'Short 3'].join('\n');
    const shortCard = addDebateCard({ id: 'msg-short-response', text: shortText, model: 'Gemini' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(shortCard);
    const shortShowMore = shortCard.querySelector('.debate-card-show-more');
    expect(shortShowMore).not.toBeNull();
    expect(shortShowMore.hidden).toBe(true);
    expect(shortCard.classList.contains('has-overflow')).toBe(false);
    expect(shortCard.classList.contains('is-expanded')).toBe(false);

    const longText = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n');
    const card = addDebateCard({ id: 'msg-show-more', text: longText, model: 'GPT' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(card);

    const showMore = card.querySelector('.debate-card-show-more');
    expect(showMore).not.toBeNull();
    expect(showMore.hidden).toBe(false);
    expect(card.classList.contains('is-expanded')).toBe(false);

    showMore.click();
    expect(card.classList.contains('is-expanded')).toBe(true);
    expect(showMore.hidden).toBe(true);

    const second = addDebateCard({ id: 'msg-dbl-expand', text: longText, model: 'Claude' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(second);
    const secondName = second.querySelector('.debate-model-card-name');
    secondName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(second.classList.contains('is-expanded')).toBe(true);
    secondName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(second.classList.contains('is-expanded')).toBe(false);
    expect(second.querySelector('.debate-card-show-more').hidden).toBe(false);
  });

  test('pipeline waiter ignores partial and wrong-batch responses until terminal response arrives', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const context = {
      pipelineRunId: 'run-1',
      pipelineRoundId: 'r1',
      pipelineBatchId: 'run-1:r1:g0'
    };
    let settled = false;
    const waitPromise = debug.pipelineWaiter
      .waitForModels(['GPT'], { timeoutMs: 200, context })
      .then((result) => {
        settled = true;
        return result;
      });

    expect(debug.pipelineWaiter.handlePartial({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'first chunk',
      metadata: { ...context, status: 'GENERATING' }
    })).toBe(true);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'old final',
      metadata: { ...context, pipelineBatchId: 'old-run:r1:g0', status: 'SUCCESS' }
    })).toBe(false);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'correct final',
      metadata: { ...context, status: 'SUCCESS' }
    })).toBe(true);

    await expect(waitPromise).resolves.toMatchObject({
      responses: { GPT: 'correct final' },
      missing: [],
      timedOut: false
    });
    expect(settled).toBe(true);
  });

  test('debate approval waiter rejects and cleans up on abort', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const controller = new AbortController();
    const approvalPromise = debug.waitForDebateApproval({ signal: controller.signal });
    expect(debug.getApprovalWaiting()).toBe(true);

    controller.abort();

    await expect(approvalPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(debug.getApprovalWaiting()).toBe(false);
  });

  test('debate feed mirrors cards into structured DebateEngine transcript artifact', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const card = addPendingApprovalCard({
      id: 'engine-msg-1',
      model: 'GPT',
      text: 'Structured transcript response'
    });

    card.querySelector('.debate-approval-check').click();
    await delay(20);

    const artifact = debug.collectDebateArtifact();
    const activeSession = artifact.sessions.find((session) => session.sessionId === '1');

    expect(debug.getDebateRunPolicy()).toBe('manual');
    expect(activeSession.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        turnId: 'turn-engine-msg-1',
        author: 'GPT',
        authorType: 'model',
        targets: ['Moderator'],
        text: 'Structured transcript response',
        status: 'approved'
      })
    ]));
    expect(debug.collectDebateMarkdown()).toContain('## Turn');
    expect(debug.collectDebateMarkdown()).toContain('Structured transcript response');
  });

  test('debate transcript artifact can restore and render the active session', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const restored = debug.hydrateDebateTranscriptFromArtifact({
      activeSessionId: 'restore-1',
      sessions: [{
        sessionId: 'restore-1',
        title: 'Restored',
        participants: ['GPT'],
        settings: { runPolicy: 'manual', maxTurns: 5 },
        turns: [
          {
            turnId: 'turn-restore-moderator',
            sessionId: 'restore-1',
            index: 1,
            author: 'Moderator',
            authorType: 'moderator',
            targets: ['GPT'],
            text: 'Restore this debate prompt',
            status: 'approved',
            createdAt: '2026-06-11T19:00:00.000Z',
            completedAt: '2026-06-11T19:00:00.000Z',
            approvedAt: '2026-06-11T19:00:00.000Z'
          },
          {
            turnId: 'turn-restore-gpt',
            sessionId: 'restore-1',
            index: 2,
            author: 'GPT',
            authorType: 'model',
            role: 'Critic',
            targets: ['Moderator'],
            text: 'Restored transcript answer',
            status: 'approved',
            terminalStatus: 'SUCCESS',
            createdAt: '2026-06-11T19:01:00.000Z',
            completedAt: '2026-06-11T19:02:00.000Z',
            approvedAt: '2026-06-11T19:02:00.000Z'
          }
        ]
      }]
    });

    expect(restored).toBe(true);
    expect(document.querySelector('.debate-session-tab.active')?.dataset.sessionId).toBe('restore-1');
    expect(document.querySelectorAll('#debate-model-cards .debate-model-card[data-session-id="restore-1"]')).toHaveLength(2);
    expect(document.getElementById('debate-model-cards').textContent).toContain('Restore this debate prompt');
    expect(document.getElementById('debate-model-cards').textContent).toContain('Restored transcript answer');

    const artifact = debug.collectDebateArtifact();
    const session = artifact.sessions.find((item) => item.sessionId === 'restore-1');
    expect(session.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-restore-gpt', terminalStatus: 'SUCCESS', status: 'approved' })
    ]));
  });

  test('pipeline output selection uses data-output keys instead of visible labels', () => {
    const debug = window.__pipelineLifecycleDebug;
    const selection = debug.getPipelineOutputSelection();

    expect(selection).toEqual({
      notes: true,
      export: false,
      exportHtml: true
    });
  });

  test('pipeline runtime snapshot uses R1 Pipeline UI as source of truth', () => {
    const debug = window.__pipelineLifecycleDebug;
    const blocks = Array.from(document.querySelectorAll('#r1-models .model-block'));
    blocks.forEach((block) => {
      const name = block.querySelector('.model-name')?.textContent?.trim();
      block.querySelector('.model-input-checkbox').checked = name === 'GPT';
      block.querySelector('.model-send-checkbox').checked = name === 'GPT' || name === 'Claude';
    });
    const snapshot = debug.buildPipelineRuntimeSnapshot();

    expect(snapshot.rounds[0].stage).toBe('models');
    expect(snapshot.rounds[0].inputModels).toEqual(['GPT']);
    expect(snapshot.rounds[0].sendModels).toEqual(expect.arrayContaining(['GPT', 'Claude']));
    expect(snapshot.rounds[0].sendModels).toHaveLength(2);
    const gptConfig = snapshot.config.modelStacks['r1-models'].items.find((item) => item.name === 'GPT');
    expect(gptConfig).toMatchObject({
      name: 'GPT',
      input: true,
      send: true
    });
  });

  test('pipeline R1 mirrors selected top models before run when R1 is still default', () => {
    const blocks = Array.from(document.querySelectorAll('#r1-models .model-block'));
    blocks.forEach((block) => {
      const name = block.querySelector('.model-name')?.textContent?.trim();
      const isDefault = ['Claude', 'GPT', 'Gemini'].includes(name);
      block.querySelector('.model-input-checkbox').checked = isDefault;
      block.querySelector('.model-send-checkbox').checked = isDefault;
    });

    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.toggle('active', button.id === 'llm-lechat' || button.id === 'llm-perplexity');
    });
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['Le Chat', 'Perplexity'] }
    }));

    const snapshot = window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot();

    expect(snapshot.rounds[0].inputModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[0].sendModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[0].sendModels).not.toEqual(expect.arrayContaining(['Claude', 'GPT', 'Gemini']));
  });

  test('pipeline HTML export sanitizes model text before embedding it', () => {
    const debug = window.__pipelineLifecycleDebug;
    const html = debug.safePipelineMarkdownToHtml('**Safe** <img src=x onerror=alert(1)> [x](javascript:alert(2))');

    expect(html).toContain('<strong>Safe</strong>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
  });

  test('pipeline HTML entrypoints expose mount points instead of hard-coded model blocks', () => {
    ['pipeline_panel.html', 'result_new.html'].forEach((fileName) => {
      const html = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
      expect(html).toContain('pipeline/pipeline-runtime.js');
      expect(html).toContain('data-render="pipeline-model-stack-r1"');
      expect(html).toContain('data-render="pipeline-model-stack-r2"');
      expect(html).toContain('data-render="pipeline-output-stack"');
      expect(html).not.toContain('class="model-block');
      expect(html).not.toContain('class="output-block');
    });
  });

  test('pipeline moderator header has no status indicator and pending zone label CSS is removed', () => {
    const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

    expect(panelHtml).not.toContain('id="mod-status-indicator"');
    expect(css).not.toContain('.debate-model-card.first-pending-zone-card::before');
    expect(css).not.toContain('На утверждение');
  });
});
