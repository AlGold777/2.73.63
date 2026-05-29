const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TAB_MANAGER_PATH = path.join(__dirname, '..', 'background', 'tab-manager.js');
const TAB_MANAGER_SOURCE = fs.readFileSync(TAB_MANAGER_PATH, 'utf8');

function createTabManagerSandbox({ queryTabs = [] } = {}) {
  const telemetry = [];
  const storageState = {};
  const listeners = {
    tabUpdated: [],
    tabRemoved: [],
    tabActivated: [],
    windowFocus: [],
    actionClicked: [],
    installed: [],
    startup: []
  };

  const chrome = {
    storage: {
      local: {
        get(key, cb) {
          if (typeof cb === 'function') {
            cb({ [key]: storageState[key] });
          }
        },
        set(obj) {
          Object.assign(storageState, obj || {});
          return Promise.resolve();
        }
      }
    },
    tabs: {
      query(queryInfo, cb) {
        cb(queryTabs.map((tab) => ({ ...tab })));
      },
      get(tabId, cb) {
        const tab = queryTabs.find((entry) => entry.id === tabId) || null;
        cb(tab ? { ...tab } : null);
      },
      create(_options, cb) {
        cb({ id: 999, url: 'https://chatgpt.com/', windowId: 1, index: 0, status: 'complete' });
      },
      update(_tabId, _options, cb) {
        if (typeof cb === 'function') cb();
      },
      reload(_tabId, cb) {
        if (typeof cb === 'function') cb();
      },
      sendMessage() {
        return Promise.resolve();
      },
      onUpdated: {
        addListener(fn) {
          listeners.tabUpdated.push(fn);
        },
        removeListener(fn) {
          listeners.tabUpdated = listeners.tabUpdated.filter((entry) => entry !== fn);
        }
      },
      onRemoved: {
        addListener(fn) {
          listeners.tabRemoved.push(fn);
        }
      },
      onActivated: {
        addListener(fn) {
          listeners.tabActivated.push(fn);
        }
      }
    },
    windows: {
      update(_windowId, _options, cb) {
        if (typeof cb === 'function') cb();
      },
      WINDOW_ID_NONE: -1,
      onFocusChanged: {
        addListener(fn) {
          listeners.windowFocus.push(fn);
        }
      }
    },
    action: {
      onClicked: {
        addListener(fn) {
          listeners.actionClicked.push(fn);
        }
      }
    },
    runtime: {
      lastError: null,
      getURL(file) {
        return `chrome-extension://test/${file}`;
      },
      onInstalled: {
        addListener(fn) {
          listeners.installed.push(fn);
        }
      },
      onStartup: {
        addListener(fn) {
          listeners.startup.push(fn);
        }
      }
    }
  };

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
    navigator: { deviceMemory: 8 },
    setTimeout,
    clearTimeout,
    chrome,
    self: {},
    TimingConfig: {
      getTiming(_key, fallback) {
        return fallback;
      }
    },
    sessionTabIds: new Set(),
    SESSION_TAB_IDS_KEY: 'llm_session_tab_ids_v1',
    sessionTabsLoaded: false,
    llmTabMap: {},
    jobState: {
      session: {
        boundTabIds: [1001]
      },
      llms: {
        GPT: { tabId: null }
      }
    },
    LLM_TARGETS: {
      GPT: {
        queryPatterns: ['*://chatgpt.com/*'],
        attachUrlAllowPrefixes: ['https://chatgpt.com/']
      }
    },
    emitTelemetry(llmName, label, payload = {}) {
      telemetry.push({ llmName, label, payload });
    },
    prepareTabForUse: jest.fn(() => Promise.resolve()),
    initRequestMetadata: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    broadcastGlobalState: jest.fn(),
    removeActiveListenerForTab: jest.fn(),
    dispatchPromptToTab: jest.fn(),
    saveJobState: jest.fn(),
    activeListeners: new Map(),
    pingWindowByTabId: {},
    pingStartByTabId: {},
    resultsTabId: null,
    resultsWindowId: null,
    autoFocusNewTabsEnabled: false,
    promptDispatchInProgress: 0
  };
  context.self = context;

  vm.createContext(context);
  vm.runInContext(TAB_MANAGER_SOURCE, context, { filename: 'background/tab-manager.js' });

  return { context, telemetry };
}

describe('tab-manager session scoping', () => {
  test('resolveTabForLlmName does not fall back to global tabs when run scope is active', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/foreign',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });

    const resolved = await new Promise((resolve) => {
      context.resolveTabForLlmName('GPT', resolve);
    });

    expect(resolved).toBeNull();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'RUN_SCOPE_BLOCKED'
        })
      ])
    );
  });

  test('tryAttachExistingTab rejects foreign eligible tabs when run scope is active', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/foreign',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });

    const attached = await context.tryAttachExistingTab('GPT', 'hello');

    expect(attached).toBe(false);
    expect(context.prepareTabForUse).not.toHaveBeenCalled();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'RUN_SCOPE_BLOCKED'
        }),
        expect.objectContaining({
          llmName: 'GPT',
          label: 'ATTACH_REJECTED'
        })
      ])
    );
  });
});
