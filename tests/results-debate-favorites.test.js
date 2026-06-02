const fs = require('fs');
const path = require('path');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

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
      <button id="debate-session-add-btn" type="button">+</button>
      <button id="debate-session-delete-btn" type="button">−</button>
      <button id="debate-session-copy-btn" type="button">copy</button>
      <button id="debate-session-export-btn" type="button">export</button>
      <button id="debate-session-clear-btn" type="button">clear</button>
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

  test('selection toolbar formats the source card text in the normal timeline', async () => {
    const source = addDebateCard({
      id: 'source-format',
      model: 'GPT',
      text: 'Format this fragment in place.'
    });
    let output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 7, 11);
    document.querySelector('#debateSelTb [data-color="#fde68a"]').click();

    let highlight = output.querySelector('span');
    expect(highlight).not.toBeNull();
    expect(highlight.textContent).toBe('this');
    expect(highlight.getAttribute('style')).toContain('background-color');
    expect(source.style.display).toBe('');
    expect(document.querySelector('.fragment-card')).toBeNull();

    output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 0, 6);
    document.querySelector('#debateSelTb [data-cmd="bold"]').click();

    const bold = output.querySelector('strong');
    expect(bold).not.toBeNull();
    expect(bold.textContent).toBe('Format');
  });

  test('selection toolbar actions have visible labels in the panel markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html).toContain('aria-label="Yellow highlight"');
    expect(html).toContain('<span class="stb-label">Yellow</span>');
    expect(html).toContain('<span class="stb-label">Bold</span>');
    expect(html).toContain('aria-label="Add selected fragment to favorites"');
    expect(html).toContain('<span class="stb-label">Favorite</span>');
  });
});
