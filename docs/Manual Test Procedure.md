# Manual Test Procedure

Purpose: verify Telemetry Timeline and Telemetry Rounds without real model traffic.

## Option A — Playwright (automated)

1) Install deps:
```
npm install
```

2) Create `tmp-run-telemetry-check.js` in repo root:
```js
const { chromium } = require('playwright');

(async () => {
  const extPath = '/Users/restart/Downloads/LLM_Codex';
  const userDataDir = '/tmp/pw-llm-codex-profile';
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const getExtensionId = async () => {
    const workers = context.serviceWorkers();
    if (workers.length) {
      const url = workers[0].url();
      const match = url.match(/chrome-extension:\/\/(.*?)\//);
      return match ? match[1] : null;
    }
    const worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const url = worker.url();
    const match = url.match(/chrome-extension:\/\/(.*?)\//);
    return match ? match[1] : null;
  };

  const extensionId = await getExtensionId();
  if (!extensionId) {
    console.error('Extension ID not found');
    await context.close();
    process.exit(1);
  }

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/result_new.html`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#telemetry-tab', { timeout: 15000, state: 'attached' });
  await page.evaluate(() => {
    const tab = document.getElementById('telemetry-tab');
    tab && tab.click();
  });

  await page.waitForFunction(() => {
    const panel = document.getElementById('telemetry-tabpanel');
    return panel && !panel.hasAttribute('hidden');
  }, null, { timeout: 15000 });

  const runSessionId = Date.now();
  const dispatchId = `Grok:${runSessionId}:1`;
  const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

  await page.evaluate(async ({ baseMeta }) => {
    const send = (event) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
    });

    const now = Date.now();
    const events = [
      {
        ts: now,
        type: 'TELEMETRY',
        label: 'ROUND1_START',
        details: 'dispatching prompt',
        level: 'error',
        meta: { ...baseMeta, round: 1 }
      },
      {
        ts: now + 200,
        type: 'PIPELINE',
        label: 'PIPELINE_STEP',
        details: '',
        level: 'error',
        meta: { ...baseMeta, step: 'streaming_start' }
      },
      {
        ts: now + 400,
        type: 'TELEMETRY',
        label: 'ROUND1_END',
        details: 'dispatch complete',
        level: 'error',
        meta: { ...baseMeta, round: 1, durationMs: 400 }
      }
    ];

    for (const evt of events) {
      await send(evt);
    }

    if (typeof window.__telemetryRefreshHook === 'function') {
      window.__telemetryRefreshHook();
    }
  }, { baseMeta });

  await page.waitForTimeout(1500);

  const timelineText = await page.locator('#telemetry-timeline').innerText();
  const roundsText = await page.locator('#telemetry-rounds').innerText();

  console.log('--- Telemetry Timeline ---');
  console.log(timelineText.trim());
  console.log('--- Telemetry Rounds ---');
  console.log(roundsText.trim());

  await context.close();
})();
```

3) Run:
```
node tmp-run-telemetry-check.js
```

Expected:
- Timeline shows `ROUND1_START`, `PIPELINE_STEP`, `ROUND1_END`.
- Rounds shows `Grok` row with R1 done + duration.

Optional CI command:
```
HEADLESS=1 npm run test:telemetry
```
Environment overrides:
- `EXT_PATH` - extension path.
- `PW_USER_DATA` - Playwright user data dir.
Note:
- The automated test includes Round2 markers (`ROUND2_START/END`) to confirm R2 shows up in Telemetry Rounds.
Optional focus-stuck check:
- Send a `FOCUS_STUCK` telemetry event and confirm the corresponding round cell turns yellow with a tooltip.
Export check:
- Use the All Logs button in Telemetry or Logs and confirm the Markdown export includes Telemetry Rounds.

## Option B — manual (DevTools console)

1) Open results page:
```
chrome-extension://<ID>/result_new.html
```

2) Switch to **Telemetry** tab.

3) In DevTools Console:
```js
const runSessionId = Date.now();
const dispatchId = `Grok:${runSessionId}:1`;
const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

const send = (event) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
});

const now = Date.now();
Promise.resolve()
  .then(() => send({
    ts: now,
    type: 'TELEMETRY',
    label: 'ROUND1_START',
    details: 'dispatching prompt',
    level: 'error',
    meta: { ...baseMeta, round: 1 }
  }))
  .then(() => send({
    ts: now + 200,
    type: 'PIPELINE',
    label: 'PIPELINE_STEP',
    details: '',
    level: 'error',
    meta: { ...baseMeta, step: 'streaming_start' }
  }))
  .then(() => send({
    ts: now + 400,
    type: 'TELEMETRY',
    label: 'ROUND1_END',
    details: 'dispatch complete',
    level: 'error',
    meta: { ...baseMeta, round: 1, durationMs: 400 }
  }))
  .then(() => {
    if (window.__telemetryRefreshHook) window.__telemetryRefreshHook();
  });
```

Expected:
- Timeline shows the three events.
- Rounds shows `Grok` row with R1 done.

## Common issues
- Sampling can drop events: use `level: 'error'` for test payloads.
- Telemetry tab must be active to see timeline updates.
- If nothing updates, call `window.__telemetryRefreshHook()`.
