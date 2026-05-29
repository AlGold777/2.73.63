# Fix: Session-Scoped Focus (2026-02-02 22:24, v2.72.21)

## Problem
После первого раунда фокус переключался на вкладки из других сессий. Это происходило при верификациях/визитах/attach, когда резолвер вкладок брал tabId из общего маппинга или искал среди всех открытых вкладок провайдера.

## Root Cause
- `TabMapManager` хранит соответствия `LLM → tabId` между сессиями.
- `resolveTabForLlmName` и `tryAttachExistingTab` не имели сессионного ограничения и могли выбрать вкладку из старой сессии.
- `getBoundTabId` принимал маппинг без проверки принадлежности к текущему запуску.

## Fix
- В `jobState.session` добавлен список `boundTabIds` — вкладки, созданные/привязанные именно в текущем запуске.
- При привязке вкладки она записывается в `boundTabIds`.
- Резолверы (`getBoundTabId`, `resolveTabForLlmName`, `tryAttachExistingTab`) теперь используют только вкладки из `boundTabIds` (если список существует), исключая вкладки чужих сессий.

## Code Diff

```diff
diff --git a/background/job-orchestrator.js b/background/job-orchestrator.js
@@
-      focusSwitches: 0,
-      telemetrySampled,
+      focusSwitches: 0,
+      boundTabIds: [],
+      telemetrySampled,
```

```diff
diff --git a/background/tab-manager.js b/background/tab-manager.js
@@
 const trackSessionTab = (tabId) => {
   const sessionSet = getSessionTabSet();
   if (!sessionSet || !Number.isInteger(tabId)) return;
   if (!sessionSet.has(tabId)) {
     sessionSet.add(tabId);
     persistSessionTabs();
   }
 };
+
+const getRunBoundTabIdSet = () => {
+  const list = Array.isArray(jobState?.session?.boundTabIds)
+    ? jobState.session.boundTabIds.filter((id) => Number.isInteger(id))
+    : [];
+  return list.length ? new Set(list) : null;
+};
+
+const trackRunTab = (tabId) => {
+  if (!Number.isInteger(tabId) || !jobState?.session) return;
+  if (!Array.isArray(jobState.session.boundTabIds)) {
+    jobState.session.boundTabIds = [];
+  }
+  if (!jobState.session.boundTabIds.includes(tabId)) {
+    jobState.session.boundTabIds.push(tabId);
+    if (typeof saveJobState === 'function') {
+      saveJobState(jobState);
+    }
+  }
+};
@@
 async function setTabBinding(llmName, tabId) {
   if (!llmName) return;
   if (isValidTabId(tabId)) {
     await TabMapManager.setTab(llmName, tabId);
+    trackRunTab(tabId);
   } else {
     await TabMapManager.removeByName(llmName);
     tabId = null;
   }
@@
 function getBoundTabId(llmName, entry = null) {
-  const mapped = TabMapManager.get(llmName);
-  if (isValidTabId(mapped)) return mapped;
-  const fallback = entry?.tabId;
-  if (!isValidTabId(fallback) || fallbackRecoveryUsed.has(llmName)) return null;
-  return markFallbackBinding(llmName, fallback, entry);
+  const runTabIds = Array.isArray(jobState?.session?.boundTabIds)
+    ? jobState.session.boundTabIds
+    : null;
+  const entryTabId = entry?.tabId;
+  if (isValidTabId(entryTabId)) {
+    if (runTabIds && !runTabIds.includes(entryTabId)) {
+      runTabIds.push(entryTabId);
+      if (typeof saveJobState === 'function') {
+        saveJobState(jobState);
+      }
+    }
+    const mapped = TabMapManager.get(llmName);
+    if (!isValidTabId(mapped) && !fallbackRecoveryUsed.has(llmName)) {
+      return markFallbackBinding(llmName, entryTabId, entry);
+    }
+    return entryTabId;
+  }
+  const mapped = TabMapManager.get(llmName);
+  if (isValidTabId(mapped)) {
+    if (runTabIds && !runTabIds.includes(mapped)) return null;
+    return mapped;
+  }
+  return null;
 }
@@
 function markFallbackBinding(llmName, tabId, entry = null) {
   fallbackRecoveryUsed.add(llmName);
   try {
     TabMapManager.setTab(llmName, tabId).catch(() => {});
   } catch (_) {}
   trackSessionTab(tabId);
+  trackRunTab(tabId);
   if (jobState?.llms?.[llmName]) {
     jobState.llms[llmName].tabId = null;
   }
@@
   const finalize = (tabs) => {
-    const eligible = (tabs || []).filter((tab) => isEligibleTabForLlm(llmName, tab));
+    const runBoundSet = getRunBoundTabIdSet();
+    const scopedTabs = runBoundSet
+      ? (tabs || []).filter((tab) => runBoundSet.has(tab.id))
+      : (tabs || []);
+    if (runBoundSet && !scopedTabs.length) {
+      done(null);
+      return;
+    }
+    const eligible = scopedTabs.filter((tab) => isEligibleTabForLlm(llmName, tab));
     const selected = eligible.find((tab) => tab.active) || eligible[0] || null;
     if (selected?.id) {
       void setTabBinding(llmName, selected.id);
@@
-      const eligibleTabs = tabs.filter((tab) => isEligibleTabForLlm(llmName, tab));
+      const runBoundSet = getRunBoundTabIdSet();
+      let eligibleTabs = tabs.filter((tab) => isEligibleTabForLlm(llmName, tab));
+      if (runBoundSet) {
+        eligibleTabs = eligibleTabs.filter((tab) => runBoundSet.has(tab.id));
+      }
       if (!eligibleTabs.length) {
         emitTelemetry(llmName, 'ATTACH_REJECTED', {
           details: `no eligible tabs (matched=${tabs.length})`,
```
