// Prevent double-init when the page is opened or injected twice
if (window.__RESULTS_PAGE_LOADED) {
    console.warn('[RESULTS] Initialization skipped: already loaded');
} else {
    window.__RESULTS_PAGE_LOADED = true;

document.addEventListener('DOMContentLoaded', async () => {
    const shared = window.ResultsShared || {};
    const {
        escapeHtml = (s = '') => String(s),
        stripHtmlToPlainText = (html = '') => String(html),
        buildResponseCopyHtmlBlock = () => '',
        wrapResponsesHtmlBundle = (sections = '') => sections,
        fallbackCopyViaTextarea = () => {},
        flashButtonFeedback = () => {},
        writeRichContentToClipboard = async () => {}
    } = shared;
    const resetGeometryState = () => {
        const root = document.documentElement;
        if (root) {
            root.style.removeProperty('--sidebar-left-width');
            root.style.removeProperty('--sidebar-right-width');
            root.style.removeProperty('--devtools-panels-height');
        }
        document.body?.classList.remove(
            'left-sidebar-open',
            'right-sidebar-open',
            'right-sidebar-closing',
            'right-sidebar-reset',
            'is-resizing'
        );
    };
    const recoverUiIfHidden = (reason = 'unknown') => {
        const shell = document.querySelector('.app-shell');
        if (!shell) return;
        const shellStyle = window.getComputedStyle(shell);
        const bodyStyle = window.getComputedStyle(document.body);
        const shellRect = shell.getBoundingClientRect();
        const textLen = String(shell.innerText || '').replace(/\s+/g, '').length;
        const shellHidden = shellStyle.display === 'none'
            || shellStyle.visibility === 'hidden'
            || Number(shellStyle.opacity || 1) === 0
            || shellRect.width < 20
            || shellRect.height < 20;
        const bodyHidden = bodyStyle.display === 'none'
            || bodyStyle.visibility === 'hidden'
            || Number(bodyStyle.opacity || 1) === 0;
        if (!(shellHidden || bodyHidden || textLen === 0)) return;

        console.warn('[RESULTS] UI recovery triggered', {
            reason,
            shellHidden,
            bodyHidden,
            textLen,
            shellRect: { width: shellRect.width, height: shellRect.height }
        });
        resetGeometryState();
        document.body.classList.remove('pro-features-hidden', 'hidden');
        document.body.style.removeProperty('display');
        document.body.style.removeProperty('visibility');
        document.body.style.removeProperty('opacity');
        shell.style.removeProperty('display');
        shell.style.removeProperty('visibility');
        shell.style.removeProperty('opacity');
    };
    const isPageReloadNavigation = () => {
        try {
            const navEntry = performance?.getEntriesByType?.('navigation')?.[0];
            if (navEntry?.type === 'reload') return true;
        } catch (_) {}
        try {
            return performance?.navigation?.type === 1;
        } catch (_) {
            return false;
        }
    };
    const clearTelemetryOnReload = () => new Promise((resolve) => {
        if (!isPageReloadNavigation()) {
            resolve(false);
            return;
        }
        const runtime = (typeof chrome !== 'undefined' && chrome?.runtime) ? chrome.runtime : null;
        if (!runtime?.sendMessage) {
            resolve(false);
            return;
        }
        try {
            runtime.sendMessage({ type: 'CLEAR_DIAG_EVENTS', reason: 'page_reload' }, () => {
                if (runtime.lastError) {
                    console.warn('[results] telemetry reload clear error', runtime.lastError);
                    resolve(false);
                } else {
                    console.info('[RESULTS] telemetry cleared on reload');
                    resolve(true);
                }
            });
        } catch (err) {
            console.warn('[results] telemetry reload clear failed', err);
            resolve(false);
        }
    });
    const favoritePanelId = 'favorite-panel';
    const favoriteOutputId = 'favorite-output';
    const favoriteSectionId = 'favorites-section';
    const favoriteStorageKey = 'llmComparatorFavoriteEntries';
    const responseSelectionToolbarId = 'responseSelTb';
    const favoriteState = {
        entries: [],
        nextId: 1,
        cardKeyToId: new Map()
    };
    const responseSelectionState = {
        range: null,
        target: null
    };
    let favoriteSectionEl = null;
    let favoritePanelEl = null;
    let favoriteOutputEl = null;
    let responseSelectionToolbarEl = null;
    let responseSelectionToolbarBound = false;
    const llmResultsContainer = document.querySelector('.llm-results');
    const sanitizeInlineHtml = (html) => {
        if (!html) return '';
        if (typeof sanitizeHTML === 'function') {
            return sanitizeHTML(String(html || ''));
        }
        return String(html || '');
    };
    const favoriteEntrySnapshot = (entry = {}) => ({
        id: String(entry.id || '').trim(),
        kind: String(entry.kind || 'fragment').trim() === 'card' ? 'card' : 'fragment',
        sourceName: String(entry.sourceName || 'Model').trim() || 'Model',
        modelKey: String(entry.modelKey || '').trim(),
        sourceOutputId: String(entry.sourceOutputId || '').trim(),
        text: String(entry.text || '').trim(),
        html: sanitizeInlineHtml(String(entry.html || '').trim()),
        timeLabel: String(entry.timeLabel || '').trim()
    });
    const favoriteEntriesSignature = (entries = []) => JSON.stringify(
        Array.isArray(entries) ? entries.map((entry) => favoriteEntrySnapshot(entry)) : []
    );
    const favoriteStorageEntries = () => favoriteState.entries.map((entry) => favoriteEntrySnapshot(entry));
    const favoriteNextIdFromEntries = (entries = []) => {
        let nextId = 1;
        entries.forEach((entry) => {
            const match = String(entry?.id || '').match(/^fav-(\d+)$/);
            if (!match) return;
            nextId = Math.max(nextId, Number(match[1]) + 1);
        });
        return nextId;
    };
    const syncFavoriteStateFromEntries = (entries = [], { render = true } = {}) => {
        const normalized = Array.isArray(entries) ? entries.map((entry) => favoriteEntrySnapshot(entry)).filter((entry) => entry.id || entry.text || entry.html) : [];
        favoriteState.entries = normalized;
        favoriteState.cardKeyToId.clear();
        favoriteState.entries.forEach((entry) => {
            if (entry.kind === 'card' && entry.sourceOutputId) {
                favoriteState.cardKeyToId.set(favoriteEntryKeyForCard(entry.sourceOutputId), entry.id);
            }
        });
        favoriteState.nextId = favoriteNextIdFromEntries(favoriteState.entries);
        if (render) {
            ensureFavoritePanelUI();
            renderFavoritePanel();
        }
        return favoriteState.entries;
    };
    const persistFavoriteEntries = () => {
        try {
            chrome?.storage?.local?.set?.({ [favoriteStorageKey]: favoriteStorageEntries() });
        } catch (err) {
            console.warn('[RESULTS] Failed to persist favorites', err);
        }
    };
    const loadFavoriteEntriesFromStorage = () => {
        try {
            chrome?.storage?.local?.get?.([favoriteStorageKey], (data) => {
                const stored = Array.isArray(data?.[favoriteStorageKey]) ? data[favoriteStorageKey] : [];
                const nextEntries = stored.map((entry) => favoriteEntrySnapshot(entry));
                if (favoriteEntriesSignature(nextEntries) === favoriteEntriesSignature(favoriteState.entries)) return;
                if (nextEntries.length) ensureFavoritePanelUI();
                syncFavoriteStateFromEntries(nextEntries, { render: true });
            });
        } catch (err) {
            console.warn('[RESULTS] Failed to load favorites', err);
        }
    };
    const clearFavoriteEntriesOnLoad = () => {
        try {
            favoriteState.entries = [];
            favoriteState.cardKeyToId.clear();
            favoriteState.nextId = 1;
            renderFavoritePanel();
            chrome?.storage?.local?.remove?.([favoriteStorageKey]);
        } catch (err) {
            console.warn('[RESULTS] Failed to clear favorites on load', err);
        }
    };
    window.clearFavoriteEntriesOnLoad = clearFavoriteEntriesOnLoad;
    window.clearModifierSelectionsOnLoad = window.clearModifierSelectionsOnLoad || (() => {
        try {
            chrome?.storage?.local?.remove?.([
                'llmComparatorSelected',
                'llmComparatorSelectedByPreset',
                'llmComparatorSelectedByPresetPipeline'
            ]);
        } catch (err) {
            console.warn('[RESULTS] Failed to clear modifiers on load', err);
        }
    });
    const responseLinkContainerSelector = [
        '.llm-panel .output',
        '.response-content',
        '#favorite-output',
        '.response-body',
        '.diag-detail',
        '.diag-meta',
        '.telemetry-log-list'
    ].join(',');
    const normalizeExternalLinkUrl = (href) => {
        const raw = String(href || '').trim();
        if (!raw || raw.startsWith('#')) return '';
        try {
            const url = new URL(raw, window.location.href);
            if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
            return url.href;
        } catch (_) {
            return '';
        }
    };
    const decorateLinksForNewTab = (root) => {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('a[href]').forEach((anchor) => {
            const url = normalizeExternalLinkUrl(anchor.getAttribute('href') || anchor.href);
            if (!url) return;
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.setAttribute('contenteditable', 'false');
            anchor.classList.add('response-external-link');
        });
    };
    const openResponseLinkInNewTab = (url) => {
        if (!url) return;
        try {
            if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
                chrome.tabs.create({ url });
                return;
            }
        } catch (_) {}
        try {
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (_) {}
    };
    const geometryBootKey = 'codexGeometryBoot';
    const hasGeometryBoot = Boolean(document.documentElement?.dataset?.[geometryBootKey]);
    if (document.documentElement) {
        document.documentElement.dataset[geometryBootKey] = String(Date.now());
    }
    ensureFavoritePanelUI();
    ensureMainCardFavoriteButtons();
    ensureResponseSelectionToolbar();
    bindMainPageFavoritesInteractions();
    await clearTelemetryOnReload();
    try {
        const currentPage = (window.location.pathname.split('/').pop() || '').toLowerCase();
        const currentView = currentPage === 'pipeline_panel.html' ? 'pipeline' : 'main';
        if (chrome?.storage?.local) {
            chrome.storage.local.set({ llmComparatorLastPipelineView: currentView });
        }
    } catch (err) {
        console.warn('[RESULTS] Failed to persist current pipeline view on load', err);
    }
    if (hasGeometryBoot) {
        resetGeometryState();
    }
    setTimeout(() => recoverUiIfHidden('boot+1.5s'), 1500);
    setTimeout(() => recoverUiIfHidden('boot+10s'), 10000);
    const visibilityWatchdogId = setInterval(() => recoverUiIfHidden('watchdog+30s'), 30000);
    window.addEventListener('beforeunload', () => clearInterval(visibilityWatchdogId), { once: true });
    document.addEventListener('visibilitychange', () => {
        console.info('[RESULTS] visibilitychange', {
            state: document.visibilityState,
            ts: Date.now()
        });
    });
    window.addEventListener('pageshow', (event) => {
        console.info('[RESULTS] pageshow', {
            persisted: !!event?.persisted,
            ts: Date.now()
        });
        recoverUiIfHidden('pageshow');
    });
    //-- 2.1. Логика для переключения и сохранения состояния Pro-режима --//
    const proLink = document.getElementById('pro-header');
    const proToggleWrapper = document.querySelector('.pro-toggle-wrapper');
    const justiceToggleBtn = document.getElementById('justice-toggle-btn');
    const proHeaderActionBlock = document.querySelector('.pro-toggle-bar .llm-action-block');
    const judgeControlsVisibleStorageKey = 'llmComparatorJudgeControlsVisible';
    const mainPromptContainer = document.querySelector('.prompt-container.prompt-sandwich.debate-composer')
        || document.querySelector('.prompt-container.prompt-sandwich');

    const applyJudgeControlsVisibility = (visible) => {
        const isVisible = Boolean(visible);
        if (proHeaderActionBlock) {
            proHeaderActionBlock.classList.toggle('is-hidden', !isVisible);
        }
        if (justiceToggleBtn) {
            justiceToggleBtn.classList.toggle('is-active', isVisible);
            justiceToggleBtn.setAttribute('aria-pressed', String(isVisible));
        }
    };

    const syncProStreamVisibility = () => {
        const hasSelectedLLMs = Boolean(document.querySelector('.llm-button.active'));
        const hasPromptBeenSubmitted = document.body.classList.contains('prompt-submitted');
        const shouldShowPreview = hasSelectedLLMs && !hasPromptBeenSubmitted;
        const shouldShowStream = hasSelectedLLMs;

        document.body.classList.toggle('pro-features-hidden', !shouldShowStream);
        document.body.classList.toggle('llm-stream-preview-open', shouldShowPreview);
        document.body.classList.toggle('pro-active', hasPromptBeenSubmitted && hasSelectedLLMs);

        if (proToggleWrapper) {
            proToggleWrapper.hidden = !shouldShowStream;
        }
        if (mainPromptContainer) {
            mainPromptContainer.classList.toggle('has-debate-feed', hasPromptBeenSubmitted);
        }
        if (proLink) {
            proLink.setAttribute('aria-pressed', String(hasPromptBeenSubmitted && hasSelectedLLMs));
        }
    };

    syncProStreamVisibility();

    try {
        const judgeControlsData = await new Promise(resolve => {
            chrome.storage.local.get(judgeControlsVisibleStorageKey, data => resolve(data || {}));
        });
        const isJudgeControlsVisible = typeof judgeControlsData[judgeControlsVisibleStorageKey] === 'boolean'
            ? judgeControlsData[judgeControlsVisibleStorageKey]
            : true;
        applyJudgeControlsVisibility(isJudgeControlsVisible);
    } catch (err) {
        console.warn('[RESULTS] Failed to restore judge controls visibility state', err);
        applyJudgeControlsVisibility(true);
    }

    if (justiceToggleBtn) {
        justiceToggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            const nextVisible = !justiceToggleBtn.classList.contains('is-active');
            applyJudgeControlsVisibility(nextVisible);
            chrome.storage.local.set({ [judgeControlsVisibleStorageKey]: nextVisible });
        });
    }

//-- Конец блока 2.1 --//
    const deriveOutputLabel = (element) => {
        const panelTitle = element.closest('.llm-panel')?.querySelector('.llm-title');
        if (panelTitle && panelTitle.textContent) {
            return panelTitle.textContent.trim();
        }
        const columnTitle = element.closest('.response-column')?.querySelector('h3');
        if (columnTitle && columnTitle.textContent) {
            return columnTitle.textContent.trim();
        }
        return '';
    };

    const DEFAULT_PANEL_OUTPUT_MAX_HEIGHT = '315px';
    const EXPANDED_PANEL_OUTPUT_MAX_HEIGHT = '400px';

    // Применение стилей к панелям вывода после инициализации
    const outputElements = document.querySelectorAll('.llm-panel .output:not(#favorite-output), .response-content');
    outputElements.forEach(el => {
        el.style.maxHeight = DEFAULT_PANEL_OUTPUT_MAX_HEIGHT;
        el.style.overflowY = 'auto';
        el.style.overflowX = 'hidden';
        el.style.wordWrap = 'break-word';
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'true');
        el.setAttribute('data-placeholder', 'Click to add or edit response');
        el.dataset.defaultMaxHeight = DEFAULT_PANEL_OUTPUT_MAX_HEIGHT;
        const label = deriveOutputLabel(el);
        const ariaLabel = label ? `${label} response (editable)` : 'Model response (editable)';
        el.setAttribute('aria-label', ariaLabel);
        el.addEventListener('input', () => {
            checkCompareButtonState();
        });
    });

    outputElements.forEach(decorateLinksForNewTab);

    document.addEventListener('click', (event) => {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor) return;
        if (!anchor.closest(responseLinkContainerSelector)) return;
        const url = normalizeExternalLinkUrl(anchor.getAttribute('href') || anchor.href);
        if (!url) return;
        event.preventDefault();
        event.stopPropagation();
        openResponseLinkInNewTab(url);
    }, true);
    
    // --- PROMPT LOADING ---
    const DEFAULT_JUDGE_SYSTEM_PROMPTS = [
        {
            id: 'interaction_meta_synthesis',
            label: 'Meta-Синтез',
            text: 'Твоя задача — создать собственное, оригинальное решение на основе твоего профессионального суждения.\nПроанализируй все представленные версии как исходный материал, но не компилируй их. Вместо этого:\n - Сформируй своё видение правильного решения проблемы\n - Критически оцени каждое замечание на фактическую точность и релевантность\n - Извлеки ценные инсайты из разных версий, которые усиливают твоё решение\n - Отбрось слабые идеи, даже если они присутствуют во всех версиях\n - Синтезируй новый ответ, который отражает твоё понимание того, как это должно быть сделано правильно\nЭто не консенсус между версиями и не их пересказ. Это твоё собственное экспертное решение, информированное анализом предложенных вариантов.',
            order: 101
        },
        {
            id: 'interaction_critical_audit',
            label: 'Критический аудит',
            text: 'Проведи критический аудит всех ответов с позиции эксперта, выявляя то, что другие пропустили.\n1. Слепые зоны (что никто не увидел):\n - Какие важные аспекты задачи полностью проигнорированы всеми?\n - Какие очевидные (для эксперта) следствия не проговорены?\n2. Систематические ошибки (что делают неправильно):\n - Фактические неточности или устаревшая информация\n - Логические противоречия внутри ответов\n - Неверные причинно-следственные связи\n - Поверхностное понимание вместо глубокого анализа\n3. Методологические провалы (как подошли неправильно):\n - Какие критерии оценки должны были применить, но не применили?\n - Где использован неподходящий фреймворк?\n - Какие ограничения/риски решения не учтены?\n4. Формат: Каждый пункт начинай с конкретного примера, затем обобщай паттерн.\nБез вступлений, прямо к сути.',
            order: 102
        },
        {
            id: 'interaction_select_ideas',
            label: 'Select ideas',
            text: 'Извлеки все уникальные идеи из материала — даже те, которые кажутся тебе слабыми или спорными.\n1. Атомизируй содержание: раздроби каждый ответ на минимальные смысловые единицы (одна идея = один пункт)\n2. Дедупликация с сохранением нюансов:\n - Объедини идеи, если они идентичны по сути (просто разная формулировка или примеры)\n - Сохрани отдельно, если есть хоть малейшее смысловое отличие в подходе, акценте или контексте\n3. Выдай нумерованный список, ранжированный по твоей экспертной оценке значимости. Начни сразу с пункта 1 — без вступлений, пояснений или метакомментариев.',
            order: 103
        },
        {
            id: 'interaction_pattern_clustering',
            label: 'Clustering',
            text: 'Проанализируй идеи через призму их функциональной логики и создай смысловую карту.\n1. Выяви паттерны: Какие идеи атакуют одну проблему с разных сторон? Какие отражают принципиально разные философии решения?\n2. Сформируй кластеры по общему знаменателю (не по формальным признакам, а по сути подхода)\n3. Назови каждый кластер концептуально — так, чтобы название раскрывало суть парадигмы, а не просто описывало содержимое\n4. Структурируй вывод\n - Название кластера (жирным)\n - Краткая суть подхода (1 предложение)\n - Список идей, входящих в него\n\nНачинай без преамбулы.',
            order: 104
        }
    ];
    let prompts = {};

    async function loadPrompts() {
        try {
            const response = await fetch(chrome.runtime.getURL('prompts.json'));
            if (!response.ok) {
                throw new Error(`Failed to fetch prompts: ${response.statusText}`);
            }
            prompts = await response.json();
            console.log('[RESULTS] Prompts loaded successfully:', prompts);
        } catch (error) {
            console.error('[RESULTS] Could not load prompts.json:', error);
            // Используем дефолтный шаблон вместо текста ошибки
            prompts = {
                shortModeSuffix: "\n\nProvide a very short and concise answer.",
                evaluationTemplate: "Compare the following responses to the question: \"{originalPrompt}\".\n\nResponses for analysis:\n\n{responsesList}\n\nSelect the best response, briefly explain why, and present the result as a detailed, structured bulleted list. The evaluation must be comprehensive, considering relevance, detail, usefulness, and accuracy.",
                judgeSystemPrompts: DEFAULT_JUDGE_SYSTEM_PROMPTS
            };
            console.log('[RESULTS] Using default evaluation template');
        }
    }
    
    await loadPrompts();

    let judgeSystemPrompts = Array.isArray(prompts.judgeSystemPrompts) && prompts.judgeSystemPrompts.length
        ? prompts.judgeSystemPrompts.slice()
        : DEFAULT_JUDGE_SYSTEM_PROMPTS.slice();

    let lastEvaluationPromptNormalized = '';
    let lastEvaluationPrefixNormalized = '';
    let lastEvaluationSuffixNormalized = '';
    let lastResponsesListNormalized = '';
    let pendingJudgeAnswer = '';
    let pendingJudgeHTML = '';
    const llmResponseMetadata = Object.create(null);

    function mergeLLMMetadata(llmName, patch = {}, options = {}) {
        if (!llmName) return;
        const shouldReset = options.reset === true;
        const base = shouldReset ? {} : { ...(llmResponseMetadata[llmName] || {}) };
        Object.entries(patch || {}).forEach(([key, value]) => {
            if (typeof value === 'undefined') {
                return;
            }
            base[key] = value;
        });
        llmResponseMetadata[llmName] = base;
    }

    function formatResponseTimestamp(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
    }

    function buildMetadataLine(llmName) {
        const meta = llmResponseMetadata[llmName];
        if (!meta) return '';
        const timestamp = formatResponseTimestamp(meta.completedAt || meta.createdAt);
        const url = (meta.url || '').trim();
        if (!timestamp && !url) return '';
        return [timestamp, url].filter(Boolean).join('  ');
    }

    function resolveResponseSource(llmName) {
        const meta = llmResponseMetadata[llmName] || {};
        const url = String(meta.url || '').trim();
        const timestamp = meta.completedAt || meta.createdAt || null;
        return {
            url: url || location.href,
            timestamp: typeof timestamp === 'number' ? timestamp : Date.now()
        };
    }

    const promptPasteBlockSelector = [
        'p',
        'div',
        'section',
        'article',
        'header',
        'footer',
        'main',
        'nav',
        'aside',
        'blockquote',
        'pre',
        'ul',
        'ol',
        'li',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'td',
        'th',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'figure',
        'figcaption'
    ].join(',');

    const getListDepth = (node) => {
        let depth = 0;
        let current = node?.parentElement || null;
        while (current) {
            if (current.tagName === 'UL' || current.tagName === 'OL') {
                depth += 1;
            }
            current = current.parentElement;
        }
        return Math.max(0, depth - 1);
    };

    const getListPrefix = (node) => {
        const parent = node?.parentElement || null;
        if (!parent) return '- ';
        if (parent.tagName === 'OL') {
            const items = Array.from(parent.children || []).filter((child) => child.tagName === 'LI');
            const index = items.indexOf(node);
            if (index >= 0) {
                return `${index + 1}. `;
            }
        }
        return '- ';
    };

    const parseHtmlDocument = (html, { sanitize = false } = {}) => {
        const raw = String(html || '');
        const source = sanitize && typeof sanitizeHTML === 'function' ? sanitizeHTML(raw) : raw;
        return new DOMParser().parseFromString(source, 'text/html');
    };

    const createHtmlFragment = (contextNode, html) => {
        const source = String(html || '');
        if (!source) return document.createDocumentFragment();
        const range = document.createRange();
        const context = contextNode || document.body || document.documentElement;
        if (context) {
            range.selectNode(context);
        }
        return range.createContextualFragment(source);
    };

    const replaceChildrenFromHtml = (container, html) => {
        if (!container) return;
        container.replaceChildren(createHtmlFragment(container, html));
    };

    const replaceChildrenFromSanitizedHtml = (container, html) => {
        if (!container) return;
        const safe = typeof sanitizeHTML === 'function' ? sanitizeHTML(String(html || '')) : String(html || '');
        container.replaceChildren(createHtmlFragment(container, safe));
    };

    const incrementalRenderQueue = [];
    let incrementalRenderHandler = null;
    const dispatchIncrementalRenderMeasurement = (measurement = {}) => {
        if (typeof incrementalRenderHandler === 'function') {
            incrementalRenderHandler(measurement);
        } else {
            incrementalRenderQueue.push(measurement);
        }
    };

    const renderIncrementalList = (container, items = [], { getId, getHash, renderItem }) => {
        if (!container || typeof getId !== 'function' || typeof renderItem !== 'function') return;
        const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const existing = new Map();
        Array.from(container.children).forEach((child) => {
            const id = child?.dataset?.itemId;
            if (id) existing.set(id, child);
        });
        let mutatedCount = 0;
        let processedItems = 0;
        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            const id = getId(item);
            if (!id) return;
            processedItems += 1;
            const hash = typeof getHash === 'function' ? getHash(item) : '';
            let node = existing.get(id);
            if (node && node.dataset.hash === hash) {
                existing.delete(id);
            } else {
                node = renderItem(item);
                if (!node) return;
                mutatedCount += 1;
            }
            node.dataset.itemId = id;
            if (hash) node.dataset.hash = hash;
            fragment.appendChild(node);
        });
        container.replaceChildren(fragment);
        const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (processedItems > 0) {
            dispatchIncrementalRenderMeasurement({
                itemCount: processedItems,
                mutatedCount,
                durationMs: Math.max(0, endTime - startTime)
            });
        }
    };

    const clearNode = (container) => {
        if (!container) return;
        container.replaceChildren();
    };

    const setSvgContent = (svg, markup = '') => {
        if (!svg) return;
        clearNode(svg);
        const source = String(markup || '').trim();
        if (!source) return;
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`, 'image/svg+xml');
        const payload = doc.documentElement;
        if (!payload) return;
        const fragment = document.createDocumentFragment();
        Array.from(payload.childNodes).forEach((node) => {
            fragment.appendChild(svg.ownerDocument.importNode(node, true));
        });
        svg.appendChild(fragment);
    };

    const plainTextFromHtml = (html) => {
        if (!html) return '';
        const doc = parseHtmlDocument(html, { sanitize: true });
        const container = doc.body || doc.documentElement;
        if (!container) return '';
        container.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
        container.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
        container.querySelectorAll('li').forEach((node) => {
            const indent = '  '.repeat(getListDepth(node));
            node.insertAdjacentText('afterbegin', `${indent}${getListPrefix(node)}`);
        });
        container.querySelectorAll(promptPasteBlockSelector).forEach((node) => {
            node.insertAdjacentText('beforebegin', '\n');
            node.insertAdjacentText('afterend', '\n');
        });
        let text = container.textContent || '';
        text = text.replace(/\u00a0/g, ' ');
        text = text.replace(/\r\n/g, '\n');
        text = text.replace(/[ \t]+\n/g, '\n');
        text = text.replace(/\n[ \t]+/g, '\n');
        text = text.replace(/\n{3,}/g, '\n\n');
        return text.trim();
    };

    const buildHtmlFromText = (text) => escapeHtml(String(text || '')).replace(/\n/g, '<br>');

    const looksLikeHtml = (value) =>
        /<(?:p|div|span|pre|code|br|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|h[1-6])\b/i.test(String(value || ''));

    const insertTextAtCursor = (input, text) => {
        if (!input) return;
        const value = input.value || '';
        const start = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
        const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : value.length;
        const nextValue = value.slice(0, start) + text + value.slice(end);
        input.value = nextValue;
        const nextPos = start + text.length;
        input.setSelectionRange(nextPos, nextPos);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };


const layoutModifierMasonry = () => {
    document.querySelectorAll('.modifier-cards-wrapper').forEach(wrapper => {
        const styles = window.getComputedStyle(wrapper);
        const rowHeight = parseFloat(styles.getPropertyValue('grid-auto-rows')) || 1;
        const rowGap = parseFloat(styles.getPropertyValue('row-gap')) || 0;
        wrapper.querySelectorAll('.modifier-group-card').forEach(card => {
            card.style.gridRowEnd = 'span 1';
            const cardHeight = card.offsetHeight + rowGap;
            const span = Math.max(1, Math.ceil(cardHeight / (rowHeight + rowGap)));
            card.style.gridRowEnd = `span ${span}`;
        });
    });
};

const updateModifierGroupHighlights = () => {
    document.querySelectorAll('.modifier-group-card').forEach(card => {
        const title = card.querySelector('.modifier-group-title');
        if (!title) return;
        const hasSelection = Array.from(card.querySelectorAll('input[type="checkbox"]')).some(cb => cb.checked);
        title.classList.toggle('has-selection', hasSelection);
    });
};

//-- 3.1. Полностью переработанная функция рендеринга с разделением на основные/второстепенные категории --//
//-- 2.1. Новая функция рендеринга с логикой "3 видимых" и "аккордеон" --//
//-- 2.1. Финальная версия функции рендеринга с усечением и title --//
function renderModifiersRow(modifiers) {
    const primaryPrefixContainer = document.getElementById('prefix-cards-container');
    const secondaryPrefixContainer = document.getElementById('secondary-prefix-cards-container');
    const primarySuffixContainer = document.getElementById('suffix-cards-container');
    const secondarySuffixContainer = document.getElementById('secondary-suffix-cards-container');

    if (!primaryPrefixContainer || !secondaryPrefixContainer || !primarySuffixContainer || !secondarySuffixContainer) return;
    
    [primaryPrefixContainer, secondaryPrefixContainer, primarySuffixContainer, secondarySuffixContainer].forEach(clearNode);

    const groups = modifiers.reduce((acc, mod) => { 
        const groupKey = mod.exclusiveGroup || `single-${mod.id}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(mod);
        return acc;
    }, {});

    const renderGroupsToContainer = (container, groupsToRender) => {
        groupsToRender.forEach(group => {
            const isAccordion = group.some(mod => mod.isSecondary);
            const card = document.createElement('div');
            card.className = 'modifier-group-card';
            
            const title = document.createElement('h4');
            title.className = 'modifier-group-title';
            const groupHasSelection = group.some(mod => selectedModifierIds.includes(mod.id));
            
            const fullGroupLabel = group[0].groupLabel || '';
            if (fullGroupLabel.length > 15) {
                title.textContent = fullGroupLabel.substring(0, 15) + '…';
            } else {
                title.textContent = fullGroupLabel;
            }
            title.title = fullGroupLabel;
            title.dataset.tooltip = fullGroupLabel;
            registerTooltipTarget(title);
            
            title.classList.toggle('has-selection', groupHasSelection);

            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'modifier-options';

            group.forEach((mod, index) => {
            const label = document.createElement('label');
            label.className = 'modifier-checkbox-label';
            const tooltipText = getEffectiveModifierText(mod) || mod.id;
            label.dataset.placeholder = (mod.placeholder || '').trim();

            if (!isAccordion && index >= 3) {
                label.classList.add('is-hidden');
            }

                const input = document.createElement('input');
                input.type = 'checkbox';
                input.dataset.modId = mod.id;
                input.checked = selectedModifierIds.includes(mod.id);

                input.addEventListener('change', () => {
                    const currentModId = mod.id;
                    const isChecked = input.checked;

                    // Ограничиваем взаимоисключение только в рамках подкатегории;
                    // если subgroup === null/undefined, разрешаем множественный выбор внутри категории.
                    const subgroup = mod.subgroup;
                    const enforceExclusivity = mod.exclusiveGroup && subgroup !== null && subgroup !== undefined && subgroup !== '';
                    if (enforceExclusivity) {
                        group.forEach(gMod => {
                            const sameSubgroup = gMod.subgroup === subgroup;
                            if (gMod.id !== currentModId && sameSubgroup) {
                                selectedModifierIds = selectedModifierIds.filter(id => id !== gMod.id);
                                resetModifierOverride(gMod.id);
                            }
                        });
                    }

                    selectedModifierIds = selectedModifierIds.filter(id => id !== currentModId);
                    if (isChecked) {
                        selectedModifierIds.push(currentModId);
                    } else {
                        resetModifierOverride(currentModId);
                    }
                    
                    document.querySelectorAll('#modifiers-container input[type="checkbox"]').forEach(cb => {
                        cb.checked = selectedModifierIds.includes(cb.dataset.modId);
                    });

                    persistModifierSelections();
                    renderActiveModifiers();
                    updateModifierGroupHighlights();
                    requestAnimationFrame(layoutModifierMasonry);
            });
            label.addEventListener('mouseenter', () => {
                adjustModifierTooltipPosition(label);
                hoveredModifierId = mod.id;
                updatePromptPlaceholder();
            });
            label.addEventListener('mouseleave', () => {
                if (hoveredModifierId === mod.id) {
                    hoveredModifierId = null;
                    updatePromptPlaceholder();
                }
                label.style.removeProperty('--tooltip-shift');
            });

            const span = document.createElement('span');
            const fullModLabel = mod.label || mod.id;
            if (fullModLabel.length > 15) {
                span.textContent = fullModLabel.substring(0, 14) + '…';
            } else {
                span.textContent = fullModLabel;
            }
            span.title = fullModLabel;

            const tooltip = document.createElement('div');
            tooltip.className = 'modifier-tooltip';
            const tooltipTitle = document.createElement('div');
            tooltipTitle.className = 'modifier-tooltip-title';
            tooltipTitle.textContent = fullModLabel;
            tooltip.appendChild(tooltipTitle);

            if (tooltipText) {
                const tooltipBody = document.createElement('div');
                tooltipBody.className = 'modifier-tooltip-body';
                tooltipBody.textContent = tooltipText;
                tooltip.appendChild(tooltipBody);
            }

                label.appendChild(input);
                label.appendChild(span);
                label.appendChild(tooltip);
                optionsContainer.appendChild(label);
            });
            
            if (title.textContent) card.appendChild(title);
            card.appendChild(optionsContainer);
            
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'show-more-btn';
            title.appendChild(collapseBtn);

            if (isAccordion) {
                card.classList.add('is-collapsible', 'is-collapsed');
                title.addEventListener('click', () => {
                    card.classList.toggle('is-collapsed');
                    requestAnimationFrame(layoutModifierMasonry);
                });
            } else {
                if (group.length > 3) {
                    card.classList.add('is-expandable');
                    title.addEventListener('click', () => {
                        card.classList.toggle('is-expanded');
                        requestAnimationFrame(layoutModifierMasonry);
                    });
                } else {
                    collapseBtn.style.display = 'none';
                }
            }
            container.appendChild(card);
        });
    };

    const allGroups = Object.values(groups);
    const primaryGroups = allGroups.filter(g => !g.some(m => m.isSecondary));
    const secondaryGroups = allGroups.filter(g => g.some(m => m.isSecondary));

    const isPrefix = (g) => g.some(m => ['prefix', 'wrap'].includes(m.type));
    const isSuffix = (g) => g.some(m => m.type === 'suffix');

    renderGroupsToContainer(primaryPrefixContainer, primaryGroups.filter(isPrefix));
    renderGroupsToContainer(secondaryPrefixContainer, secondaryGroups.filter(isPrefix));
    renderGroupsToContainer(primarySuffixContainer, primaryGroups.filter(isSuffix));
    renderGroupsToContainer(secondarySuffixContainer, secondaryGroups.filter(isSuffix));
    requestAnimationFrame(layoutModifierMasonry);
    updateModifierGroupHighlights();
}
    const getDefaultModifierText = (mod = {}) => {
        if (!mod) return '';
        return (mod.text || '')
            .replace(/\{USER_PROMPT\}/gi, '')
            .replace(/Prompt:/gi, '')
            .replace(/\\n/g, '\n')
            .trim();
    };

    const getEffectiveModifierText = (mod = {}) => {
        if (!mod) return '';
        const override = modifierCustomText[mod.id];
        if (typeof override === 'string') {
            const trimmed = override.trim();
            if (trimmed) return trimmed;
        }
        return getDefaultModifierText(mod);
    };

    const resetModifierOverride = (modId) => {
        if (modId && Object.prototype.hasOwnProperty.call(modifierCustomText, modId)) {
            delete modifierCustomText[modId];
        }
    };

//-- 3.4. Новая функция для рендеринга "чипов" и обработчик их удаления --//
function renderActiveModifiers() {
    const prefixContainer = document.getElementById('prefix-container');
    const suffixContainer = document.getElementById('suffix-container');

    if (!prefixContainer || !suffixContainer) return;

    // Очищаем контейнеры перед рендерингом
    clearNode(prefixContainer);
    clearNode(suffixContainer);

    // Проходимся по упорядоченному массиву ID
    selectedModifierIds.forEach(modId => {
        const mod = modifiersById[modId];
        if (!mod) return;

        // Создаем "чип"
        const chip = document.createElement('div');
        chip.className = 'modifier-chip';
        if (mod.type === 'suffix') {
            chip.classList.add('modifier-chip-suffix');
        } else {
            chip.classList.add('modifier-chip-prefix');
        }

        const chipContent = document.createElement('div');
        chipContent.className = 'chip-content';

        const chipTitle = document.createElement('span');
        chipTitle.className = 'chip-modifier-title';
        chipTitle.textContent = `${mod.label || mod.id}:`;

        const chipText = document.createElement('span');
        chipText.className = 'chip-modifier-text';
        chipText.contentEditable = 'true';
        chipText.spellcheck = false;
        chipText.dataset.modId = mod.id;

        //-- 1.1. Финальная, надежная очистка текста перед отображением --//
        chipText.textContent = getEffectiveModifierText(mod) || mod.id;

        chipText.addEventListener('input', () => {
            modifierCustomText[mod.id] = chipText.textContent || '';
        });
        chipText.addEventListener('blur', () => {
            const current = (chipText.textContent || '').trim();
            if (!current) {
                resetModifierOverride(mod.id);
                chipText.textContent = getEffectiveModifierText(mod) || mod.id;
            } else {
                modifierCustomText[mod.id] = current;
            }
        });
        chipText.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                chipText.blur();
            }
        });

        const tooltip = document.createElement('div');
        tooltip.className = 'modifier-tooltip modifier-chip-tooltip';
        const tooltipTitle = document.createElement('div');
        tooltipTitle.className = 'modifier-tooltip-title';
        tooltipTitle.textContent = mod.label || mod.id;
        tooltip.appendChild(tooltipTitle);
        const tooltipBody = document.createElement('div');
        tooltipBody.className = 'modifier-tooltip-body';
        tooltipBody.textContent = getEffectiveModifierText(mod) || mod.id;
        tooltip.appendChild(tooltipBody);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'chip-remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove this modifier';
        removeBtn.dataset.modId = modId; // Важно для удаления

        chipContent.appendChild(chipTitle);
        chipContent.appendChild(chipText);
        chip.appendChild(chipContent);
        chip.appendChild(tooltip);
        chip.appendChild(removeBtn);

        chip.addEventListener('mouseenter', () => {
            adjustModifierTooltipPosition(chip);
        });
        chip.addEventListener('mouseleave', () => {
            chip.style.removeProperty('--tooltip-shift');
        });
        chip.addEventListener('dblclick', (event) => {
            if (event.target.closest('.chip-remove-btn')) return;
            chip.classList.toggle('is-expanded');
        });

        // Добавляем "чип" в нужный контейнер
        if (mod.type === 'prefix' || mod.type === 'wrap') {
            prefixContainer.appendChild(chip);
        } else if (mod.type === 'suffix') {
            suffixContainer.appendChild(chip);
        }
    });
    updateModifierHeaders();
    updatePromptPlaceholder();
}

function updateModifierHeaders() {
    if (!prefixToggleLabel && !suffixToggleLabel) return;
    let hasPrefix = false;
    let hasSuffix = false;
    let hasAny = false;

    if (selectedModifierIds && selectedModifierIds.length > 0) {
        hasAny = true;
        selectedModifierIds.forEach(modId => {
            const mod = modifiersById[modId];
            if (!mod) return;
            if (mod.type === 'suffix') {
                hasSuffix = true;
            } else if (mod.type === 'prefix' || mod.type === 'wrap') {
                hasPrefix = true;
            }
        });
    }

    if (prefixToggleLabel) {
        prefixToggleLabel.classList.toggle('active', hasAny);
    }
    if (suffixToggleLabel) {
        suffixToggleLabel.classList.toggle('active', hasSuffix);
    }
}

// Handler for diagnostics "Copy all logs" button
document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#copy-diagnostics-logs');
    if (!btn) return;

    const selectedModels = getSelectedLLMs();
    const sources = selectedModels.filter((name) => (llmLogs[name] || []).length);
    if (!sources.length) {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    const combined = sources.map(name => {
        const entries = llmLogs[name] || [];
        const body = entries.map(e => {
            const time = formatDiagTimestamp(e.ts);
            const label = e.label || '';
            const details = e.details ? ` – ${e.details}` : '';
            return `[${time}] ${label}${details}`;
        }).join('\n');
        return `<Logs ${name}>\n${body}\n</>`;
    }).join('\n\n');

    try {
        if (navigator.clipboard && combined) {
            await navigator.clipboard.writeText(combined);
            flashButtonFeedback(btn, 'success');
        }
    } catch (err) {
        console.error('[Diagnostics Copy All] error', err);
        flashButtonFeedback(btn, 'error');
    }
});

let hoveredModifierId = null;

function determineModifierPlaceholder() {
    if (hoveredModifierId) {
        const hovered = modifiersById[hoveredModifierId];
        if (hovered && typeof hovered.placeholder === 'string') {
            const trimmed = hovered.placeholder.trim();
            if (trimmed) return trimmed;
        }
    }
    if (!Array.isArray(selectedModifierIds) || !selectedModifierIds.length) {
        return '';
    }
    for (let i = selectedModifierIds.length - 1; i >= 0; i--) {
        const modId = selectedModifierIds[i];
        const mod = modifiersById[modId];
        if (!mod || typeof mod.placeholder !== 'string') continue;
        const trimmed = mod.placeholder.trim();
        if (trimmed) return trimmed;
    }
    return '';
}

function updatePromptPlaceholder(forceDefault = false) {
    if (!promptInput) return;
    let nextPlaceholder;
    if (forceDefault) {
        nextPlaceholder = defaultPromptPlaceholder;
    } else {
        const candidate = determineModifierPlaceholder();
        nextPlaceholder = candidate || defaultPromptPlaceholder;
    }
    if (promptInput.getAttribute('placeholder') !== nextPlaceholder) {
        promptInput.setAttribute('placeholder', nextPlaceholder);
    }
}

function adjustModifierTooltipPosition(labelEl) {
    if (!labelEl) return;
    const tooltipEl = labelEl.querySelector('.modifier-tooltip');
    if (!tooltipEl) return;
    const rect = labelEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    let tooltipWidth = tooltipRect.width;
    if (!tooltipWidth) {
        const computed = window.getComputedStyle(tooltipEl);
        tooltipWidth = parseFloat(computed.width) || parseFloat(computed.maxWidth) || 320;
    }
    tooltipWidth = Math.min(tooltipWidth || 320, window.innerWidth * 0.7);
    const margin = 12;
    const halfWidth = tooltipWidth / 2;
    const center = rect.left + rect.width / 2;
    let shift = 0;
    if (center - halfWidth < margin) {
        shift = margin - (center - halfWidth);
    } else if (center + halfWidth > window.innerWidth - margin) {
        shift = (window.innerWidth - margin) - (center + halfWidth);
    }
    labelEl.style.setProperty('--tooltip-shift', `${shift}px`);

    const tooltipHeight = tooltipRect.height || tooltipEl.offsetHeight || 0;
    const spaceAbove = rect.top;
    const topMargin = 12;
    const needsFlip = tooltipHeight && (spaceAbove - tooltipHeight - topMargin < 0);
    if (needsFlip) {
        tooltipEl.dataset.position = 'below';
    } else {
        delete tooltipEl.dataset.position;
    }
}

//-- 2.1. Исправляем селектор и подтверждаем отправку события 'change' --//
// Делегированный обработчик для кнопок удаления "чипов"
document.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.chip-remove-btn');
    if (!removeBtn) return;

    const modId = removeBtn.dataset.modId;
    if (!modId) return;

    // Находим соответствующий чекбокс в правильном контейнере (#modifiers-container)
        const checkbox = document.querySelector(`#modifiers-container input[data-mod-id="${modId}"]`);
    if (checkbox) {
        checkbox.checked = false;
        // Искусственно вызываем событие 'change', которое теперь будет поймано нужным обработчиком
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    resetModifierOverride(modId);
});

    async function loadSystemTemplates() {
        try {
            const indexResponse = await fetch(chrome.runtime.getURL('system_templates/index.json'));
            if (!indexResponse.ok) throw new Error('System template index not found.');

            const templateFiles = await indexResponse.json();

            const fetchPromises = templateFiles.map(file =>
                fetch(chrome.runtime.getURL(`system_templates/${file}`)).then(res => res.json())
            );

            const loadedTemplates = await Promise.all(fetchPromises);

            systemTemplates = { templates: {}, variables: {} };

            loadedTemplates.forEach(data => {
                Object.assign(systemTemplates.templates, data.templates);
                Object.assign(systemTemplates.variables, data.variables);
            });

            updateSystemTemplatesList();
            console.log('[RESULTS] System templates loaded successfully:', systemTemplates);

        } catch (error) {
            console.error('[RESULTS] Could not load system templates:', error);
        }
    }

        // --- MODIFIERS LOADING ---
        let modifiersDefaults = [];
        let userModifiers = [];
        //-- 3.1. Меняем Set на Array для сохранения порядка выбора --//
        let selectedModifierIds = []; // сохраняем выбранные
        let modifiersById = {};
        const modifierCustomText = {};
        let modifierPresetSelect = null;
        let modifierPresets = [];
        let modifierSelectionsMap = {};
        let currentModifierPresetId = 'base';
        let modifierPresetSelectBound = false;
        const isPipelinePage = document.body.classList.contains('pipeline-page');
        const MODIFIER_PRESET_STORAGE_KEY = isPipelinePage
            ? 'llmComparatorModifierPresetPipeline'
            : 'llmComparatorModifierPreset';
        const MODIFIER_SELECTIONS_STORAGE_KEY = isPipelinePage
            ? 'llmComparatorSelectedByPresetPipeline'
            : 'llmComparatorSelectedByPreset';
        const MODIFIER_SELECTED_FALLBACK_KEY = isPipelinePage ? null : 'llmComparatorSelected';

        const clearModifierOverrides = () => {
            Object.keys(modifierCustomText).forEach((key) => delete modifierCustomText[key]);
        };

        const clearAllSelectedModifiers = () => {
            if (!selectedModifierIds.length) return;
            selectedModifierIds = [];
            clearModifierOverrides();
            document.querySelectorAll('input[data-mod-id]').forEach(cb => {
                cb.checked = false;
            });
            renderActiveModifiers();
            persistModifierSelections();
            updateModifierGroupHighlights();
            updatePromptPlaceholder();
        };

        const getModifierPresetMeta = (presetId) => {
            if (Array.isArray(modifierPresets) && modifierPresets.length) {
                return modifierPresets.find((preset) => preset.id === presetId) || modifierPresets[0];
            }
            return { id: 'base', label: 'Базовый набор', file: 'modifiers.json' };
        };

        const updateModifierSectionLabels = () => {
            const prefixLabelTextEl = document.querySelector('.modifiers-toggle-label-console');
            const suffixLabelTextEl = document.querySelector('.modifiers-toggle-label-pro');
            if (prefixLabelTextEl) {
                prefixLabelTextEl.textContent = 'Tuning Console';
            }
            if (suffixLabelTextEl) {
                suffixLabelTextEl.textContent = 'LLM Stream';
            }
        };

        const persistModifierSelections = () => {
            if (!currentModifierPresetId) return;
            if (!modifierSelectionsMap || typeof modifierSelectionsMap !== 'object') {
                modifierSelectionsMap = {};
            }
            modifierSelectionsMap[currentModifierPresetId] = [...selectedModifierIds];
            chrome.storage.local.set({
                [MODIFIER_SELECTIONS_STORAGE_KEY]: modifierSelectionsMap,
                ...(MODIFIER_SELECTED_FALLBACK_KEY ? { [MODIFIER_SELECTED_FALLBACK_KEY]: selectedModifierIds } : {})
            });
            if (typeof persistCrossViewUiState === 'function') {
                persistCrossViewUiState();
            }
        };

        async function loadModifiers(presetId = currentModifierPresetId, { restoreSelections = true } = {}) {
            try {
                const presetMeta = getModifierPresetMeta(presetId);
                currentModifierPresetId = presetMeta.id;
                updateModifierSectionLabels();
                const presetSelectEl = modifierPresetSelect || document.getElementById('modifier-preset-select');
                if (presetSelectEl) {
                    modifierPresetSelect = presetSelectEl;
                    modifierPresetSelect.value = currentModifierPresetId;
                }

                const presetFile = presetMeta.file || 'modifiers.json';
                const presetPath = presetFile.startsWith('Modifiers/') ? presetFile : `Modifiers/${presetFile}`;
                const resp = await fetch(chrome.runtime.getURL(presetPath));
                if (!resp.ok) throw new Error(`${presetPath} not found`);
                modifiersDefaults = await resp.json();

                // Подгружаем пользовательские (если уже есть)
                const stored = await new Promise(resolve =>
                    chrome.storage.local.get([
                        'llmComparatorModifiers',
                        MODIFIER_SELECTED_FALLBACK_KEY,
                        MODIFIER_SELECTIONS_STORAGE_KEY
                    ].filter(Boolean), resolve)
                );

                userModifiers = Array.isArray(stored.llmComparatorModifiers) ? stored.llmComparatorModifiers : [];
                modifierSelectionsMap = stored[MODIFIER_SELECTIONS_STORAGE_KEY] && typeof stored[MODIFIER_SELECTIONS_STORAGE_KEY] === 'object'
                    ? stored[MODIFIER_SELECTIONS_STORAGE_KEY]
                    : {};

                // Мердж по id: приоритет у userModifiers (могут перезаписать text/label/type)
                const map = new Map();
                [...modifiersDefaults, ...userModifiers].forEach(m => map.set(m.id, m));
                const merged = [...map.values()].sort((a,b) => (a.order||999)-(b.order||999));

                //-- 3.2. Обновляем логику загрузки для работы с Array --//
                const presetSelections = modifierSelectionsMap[currentModifierPresetId];
                if (restoreSelections && Array.isArray(presetSelections) && presetSelections.length) {
                    selectedModifierIds = presetSelections;
                } else if (restoreSelections && !isPipelinePage && currentModifierPresetId === 'base' && Array.isArray(stored.llmComparatorSelected) && stored.llmComparatorSelected.length) {
                    selectedModifierIds = stored.llmComparatorSelected;
                } else {
                    selectedModifierIds = [];
                }
                if (restoreSelections && !suppressCrossViewPersistenceOnLoad) {
                    persistModifierSelections();
                }

                // Индекс
                modifiersById = {};
                merged.forEach(m => { modifiersById[m.id] = m; });

                clearModifierOverrides();
                renderModifiersRow(merged);
                renderActiveModifiers(); // <-- 3.6. Добавить эту строку
                console.log(`[RESULTS] Modifiers loaded for preset ${currentModifierPresetId}`, merged);
            } catch (e) {
                console.error('[RESULTS] Could not load modifiers:', e);
                renderModifiersRow([]); // пусто, чтобы UI не ломался
            }
        }

        async function loadModifierPresets() {
            modifierPresetSelect = modifierPresetSelect || document.getElementById('modifier-preset-select');
            try {
                const presetIndexPath = 'Modifiers/modifier-presets.json';
                const resp = await fetch(chrome.runtime.getURL(presetIndexPath));
                if (resp.ok) {
                    const data = await resp.json();
                    if (Array.isArray(data) && data.length) {
                        modifierPresets = data;
                    }
                } else {
                    console.warn('[RESULTS] Could not load modifier-presets.json, using fallback.');
                }
            } catch (error) {
                console.warn('[RESULTS] Failed to fetch modifier presets:', error);
            }
            if (!Array.isArray(modifierPresets) || !modifierPresets.length) {
                modifierPresets = [{ id: 'base', label: 'Базовый набор', file: 'modifiers.json' }];
            }
            const storedPreset = await new Promise(resolve =>
                chrome.storage.local.get(MODIFIER_PRESET_STORAGE_KEY, resolve)
            );
            const storedPresetId = storedPreset?.[MODIFIER_PRESET_STORAGE_KEY];
            if (storedPresetId && modifierPresets.some(preset => preset.id === storedPresetId)) {
                currentModifierPresetId = storedPresetId;
            } else {
                currentModifierPresetId = modifierPresets[0].id;
            }
            if (modifierPresetSelect) {
                clearNode(modifierPresetSelect);
                modifierPresets.forEach((preset) => {
                    const option = document.createElement('option');
                    option.value = preset.id;
                    option.textContent = preset.label || preset.id;
                    modifierPresetSelect.appendChild(option);
                });
                modifierPresetSelect.value = currentModifierPresetId;
                if (!modifierPresetSelectBound) {
                    modifierPresetSelect.addEventListener('change', (event) => {
                        const nextPresetId = event.target.value;
                        if (!nextPresetId || nextPresetId === currentModifierPresetId) return;
                        chrome.storage.local.set({ [MODIFIER_PRESET_STORAGE_KEY]: nextPresetId });
                        loadModifiers(nextPresetId);
                    });
                    modifierPresetSelectBound = true;
                }
            }
            if (!preserveCrossViewStateOnLoad) {
                window.clearModifierSelectionsOnLoad?.();
            }
            await loadModifiers(currentModifierPresetId, { restoreSelections: preserveCrossViewStateOnLoad });
        }




    // --- MAIN PAGE ELEMENTS ---
    const startButton = document.getElementById('start-button');
    const promptInput = document.getElementById('modTa') || document.getElementById('prompt-input');
    const promptNoteView = document.getElementById('prompt-note-view');
    const promptContainer = document.querySelector('.prompt-container.prompt-sandwich.debate-composer')
        || document.querySelector('.prompt-container.prompt-sandwich')
        || document.querySelector('.prompt-container');
    const isModeratorTextarea = promptInput?.id === 'modTa';
    let useInputRichMode = false;
    let editorState = null;
    let applyRichInputContent = null;
    let syncPromptViewMode = null;
    let syncRichViewFromPrompt = null;
    let syncPromptFromRichView = null;
    let setPromptEditorMode = null;
    const defaultPromptPlaceholder = promptInput
        ? (promptInput.dataset.defaultPlaceholder || promptInput.getAttribute('placeholder') || '')
        : '';
    if (promptInput) {
        requestAnimationFrame(() => {
            promptInput.focus();
            try {
                promptInput.setSelectionRange(0, 0);
            } catch (err) {
                // ignore for non-supporting inputs
            }
        });
    }
    // Rich input is activated automatically when Use in input is pressed.
    const llmButtons = document.querySelectorAll('.llm-button');
    const llmNames = Array.from(llmButtons).map(btn => btn.textContent.trim()).filter(Boolean);
    const llmPanels = document.querySelectorAll('.llm-panel');
    const comparisonPanel = document.getElementById('comparison-panel');
    const comparisonOutput = document.getElementById('comparison-output');
    const comparisonSpinner = document.getElementById('comparison-spinner');
    const getItButton = document.getElementById('get-it-button');
    const compareButton = document.getElementById('compare-button');
    const smartCompareButton = document.getElementById('smart-compare-button');
    const judgeSystemPromptSelect = document.getElementById('judge-system-prompt-select');
    const evaluatorSelect = document.getElementById('evaluator-select');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewStackBtn = document.getElementById('view-stack-btn');
    const crossViewUiStateKey = 'llmComparatorCrossViewUiState';
    const crossViewNavigationIntentKey = 'llmComparatorCrossViewNavigationIntent';
    const crossViewNavigationIntentTtlMs = 15000;
    let preserveCrossViewStateOnLoad = false;
    let suppressCrossViewPersistenceOnLoad = false;
    const getCurrentViewKey = () => document.body.classList.contains('pipeline-page') ? 'pipeline' : 'main';
    const safeStorageLocalGet = (keys) => new Promise((resolve) => {
        try {
            if (!chrome?.storage?.local) {
                resolve({});
                return;
            }
            const result = chrome.storage.local.get(keys, (data) => resolve(data || {}));
            if (result && typeof result.then === 'function') {
                result.then((data) => resolve(data || {})).catch(() => resolve({}));
            }
        } catch (_) {
            resolve({});
        }
    });
    const safeStorageLocalSet = (payload) => new Promise((resolve) => {
        try {
            if (!chrome?.storage?.local) {
                resolve(false);
                return;
            }
            chrome.storage.local.set(payload, () => resolve(!chrome.runtime?.lastError));
        } catch (_) {
            resolve(false);
        }
    });
    const safeStorageLocalRemove = (keys) => new Promise((resolve) => {
        try {
            if (!chrome?.storage?.local) {
                resolve(false);
                return;
            }
            const result = chrome.storage.local.remove(keys, () => resolve(!chrome.runtime?.lastError));
            if (result && typeof result.then === 'function') {
                result.then(() => resolve(true)).catch(() => resolve(false));
            }
        } catch (_) {
            resolve(false);
        }
    });
    const consumeCrossViewNavigationIntentOnLoad = async () => {
        const stored = await safeStorageLocalGet(crossViewNavigationIntentKey);
        const intent = stored[crossViewNavigationIntentKey];
        await safeStorageLocalRemove(crossViewNavigationIntentKey);
        if (!intent || typeof intent !== 'object') return false;
        const targetView = String(intent.targetView || '');
        if (targetView !== getCurrentViewKey()) return false;
        const savedAt = Number(intent.savedAt || 0);
        return savedAt > 0 && Date.now() - savedAt <= crossViewNavigationIntentTtlMs;
    };
    const getPromptDraftText = () => {
        if (promptInput) return String(promptInput.value || '');
        return String(document.getElementById('prompt-input')?.value || document.getElementById('modTa')?.value || '');
    };
    const clearCrossViewPromptState = async () => {
        const stored = await safeStorageLocalGet(crossViewUiStateKey);
        const existing = stored[crossViewUiStateKey];
        if (!existing || typeof existing !== 'object') return;
        const nextState = normalizeCrossViewUiState(existing);
        if (nextState.shared && typeof nextState.shared === 'object') {
            delete nextState.shared.outputs;
        }
        ['main', 'pipeline'].forEach((viewKey) => {
            const viewState = nextState.views?.[viewKey];
            if (!viewState || typeof viewState !== 'object') return;
            delete viewState.promptText;
            delete viewState.modelButtonIds;
            delete viewState.modifiers;
            if (viewState.bodyFlags && typeof viewState.bodyFlags === 'object') {
                delete viewState.bodyFlags.promptSubmitted;
                if (!Object.keys(viewState.bodyFlags).length) {
                    delete viewState.bodyFlags;
                }
            }
            if (viewState.formControls && typeof viewState.formControls === 'object') {
                delete viewState.formControls['prompt-input'];
                delete viewState.formControls.modTa;
            }
        });
        await safeStorageLocalSet({ [crossViewUiStateKey]: nextState });
    };
    const normalizeCrossViewUiState = (rawState = null) => {
        const normalized = {
            version: 2,
            savedAt: rawState?.savedAt || 0,
            views: {
                main: {},
                pipeline: {}
            },
            shared: {}
        };
        if (!rawState || typeof rawState !== 'object') return normalized;
        if (rawState.views && typeof rawState.views === 'object') {
            normalized.savedAt = rawState.savedAt || normalized.savedAt;
            normalized.views.main = rawState.views.main && typeof rawState.views.main === 'object' ? rawState.views.main : {};
            normalized.views.pipeline = rawState.views.pipeline && typeof rawState.views.pipeline === 'object' ? rawState.views.pipeline : {};
            normalized.shared = rawState.shared && typeof rawState.shared === 'object' ? rawState.shared : {};
            return normalized;
        }
        const legacyView = rawState.sourcePage === 'pipeline_panel.html'
            ? 'pipeline'
            : (rawState.sourcePage ? 'main' : getCurrentViewKey());
        const {
            outputs,
            sourcePage,
            version,
            ...legacyViewState
        } = rawState;
        normalized.views[legacyView] = legacyViewState;
        if (outputs && typeof outputs === 'object') {
            normalized.shared.outputs = outputs;
        }
        return normalized;
    };
    const collectCurrentViewUiState = () => {
        const formControls = {};
        document.querySelectorAll('.app-main input[id], .app-main textarea[id], .app-main select[id]').forEach((el) => {
            if (!el.id || el.type === 'file' || el.type === 'password') return;
            formControls[el.id] = el.type === 'checkbox' || el.type === 'radio'
                ? { type: el.type, checked: !!el.checked, value: el.value || '' }
                : { type: el.type || el.tagName.toLowerCase(), value: el.value || '' };
        });
        return {
            savedAt: Date.now(),
            bodyFlags: {
                promptSubmitted: document.body.classList.contains('prompt-submitted')
            },
            promptText: getPromptDraftText(),
            modelButtonIds: Array.from(llmButtons)
                .filter((button) => button.classList.contains('active'))
                .map((button) => button.id)
                .filter(Boolean),
            modifiers: {
                presetId: currentModifierPresetId,
                selectedIds: Array.isArray(selectedModifierIds) ? [...selectedModifierIds] : [],
                customText: { ...modifierCustomText }
            },
            formControls
        };
    };
    const collectSharedUiState = () => {
        const outputs = {};
        document.querySelectorAll('.llm-panel .output[id], #comparison-output').forEach((el) => {
            outputs[el.id] = el.innerHTML || '';
        });
        return { outputs };
    };
    const persistCrossViewUiState = async () => {
        const stored = await safeStorageLocalGet(crossViewUiStateKey);
        const nextState = normalizeCrossViewUiState(stored[crossViewUiStateKey]);
        const viewKey = getCurrentViewKey();
        nextState.savedAt = Date.now();
        nextState.views[viewKey] = collectCurrentViewUiState();
        const shared = collectSharedUiState();
        nextState.shared = nextState.shared && typeof nextState.shared === 'object' ? nextState.shared : {};
        if (Object.keys(shared.outputs || {}).length) {
            nextState.shared.outputs = shared.outputs;
        }
        const hasModifierControls = Boolean(document.querySelector('input[data-mod-id]'));
        if (!hasModifierControls && stored[crossViewUiStateKey]?.views?.[viewKey]?.modifiers) {
            nextState.views[viewKey].modifiers = stored[crossViewUiStateKey].views[viewKey].modifiers;
        }
        await safeStorageLocalSet({ [crossViewUiStateKey]: nextState });
    };
    const applyCrossViewUiState = (rawState = {}) => {
        if (!rawState || typeof rawState !== 'object') return;
        const normalized = normalizeCrossViewUiState(rawState);
        const state = normalized.views[getCurrentViewKey()] || {};
        const activeIds = Array.isArray(state.modelButtonIds) ? state.modelButtonIds : [];
        if (Object.prototype.hasOwnProperty.call(state, 'modelButtonIds') && Array.isArray(state.modelButtonIds)) {
            llmButtons.forEach((button) => {
                const isActive = activeIds.includes(button.id);
                button.classList.toggle('active', isActive);
                const llmId = button.id.replace('llm-', '');
                const panel = document.getElementById(`panel-${llmId}`);
                if (panel) panel.style.display = isActive ? 'block' : 'none';
            });
        }
        Object.entries(state.formControls || {}).forEach(([id, snapshot]) => {
            const el = document.getElementById(id);
            if (!el || !snapshot) return;
            if ((el.type === 'checkbox' || el.type === 'radio') && typeof snapshot.checked === 'boolean') {
                el.checked = snapshot.checked;
                return;
            }
            if ('value' in snapshot && el.type !== 'file' && el.type !== 'password') {
                el.value = String(snapshot.value || '');
            }
        });
        if (promptInput && Object.prototype.hasOwnProperty.call(state, 'promptText')) {
            promptInput.value = String(state.promptText || '');
        }
        Object.entries(normalized.shared?.outputs || {}).forEach(([id, html]) => {
            const el = document.getElementById(id);
            if (!el) return;
            replaceChildrenFromSanitizedHtml(el, sanitizeInlineHtml(String(html || '')));
        });
        if (state.modifiers && typeof state.modifiers === 'object') {
            if (state.modifiers.presetId) {
                currentModifierPresetId = String(state.modifiers.presetId);
            }
            selectedModifierIds = Array.isArray(state.modifiers.selectedIds)
                ? state.modifiers.selectedIds.filter(Boolean)
                : [];
            clearModifierOverrides();
            Object.assign(modifierCustomText, state.modifiers.customText || {});
            document.querySelectorAll('input[data-mod-id]').forEach((checkbox) => {
                checkbox.checked = selectedModifierIds.includes(checkbox.dataset.modId);
            });
            renderActiveModifiers();
            updateModifierGroupHighlights();
            updatePromptPlaceholder();
        }
        if (state.bodyFlags?.promptSubmitted && !document.body.classList.contains('pipeline-page')) {
            const classes = String(document.body.className || '').split(/\s+/).filter(Boolean);
            if (!classes.includes('prompt-submitted')) {
                document.body.className = classes.concat('prompt-submitted').join(' ');
            }
        }
        checkCompareButtonState();
        renderDiagnosticsModal();
        notifySelectionChanged();
        syncModeratorSelectors();
        syncModeratorMiniPrompts();
    };
    const restoreCrossViewUiState = async () => {
        const data = await safeStorageLocalGet(crossViewUiStateKey);
        applyCrossViewUiState(data[crossViewUiStateKey]);
    };
    document.addEventListener('input', (event) => {
        if (!event.target?.closest?.('.app-main')) return;
        if (!event.target.matches?.('input[id], textarea[id], select[id]')) return;
        persistCrossViewUiState();
    });
    document.addEventListener('change', (event) => {
        if (!event.target?.closest?.('.app-main')) return;
        if (!event.target.matches?.('input[id], textarea[id], select[id]')) return;
        persistCrossViewUiState();
    });
    window.addEventListener('beforeunload', () => {
        persistCrossViewUiState();
    });
    const autoCheckbox = document.getElementById('auto-checkbox');
    const debateAutoPauseBtn = document.getElementById('debate-auto-pause-btn');
    const debateMaxTurnsInput = document.getElementById('debate-max-turns-input');
    const debateRunPolicySelect = document.getElementById('debate-run-policy-select');
    let autoMode = autoCheckbox ? autoCheckbox.checked : false;
    const prefixToggleLabel = document.querySelector('.modifiers-toggle-label[data-mod-type="prefix"]');
    const suffixToggleLabel = document.querySelector('.modifiers-toggle-label[data-mod-type="suffix"]');
    const proSection = document.getElementById('pro-section');
    const newPagesCheckbox = document.getElementById('new-pages-checkbox');
    const apiModeCheckbox = document.getElementById('api-mode-checkbox');
    let debatePaused = false;
    let lastPipelineTriggerAt = 0;
    let triggerPipelineRun = (event) => {
        if (event) {
            event.preventDefault();
            event.stopImmediatePropagation?.();
            event.stopPropagation();
        }
        const now = Date.now();
        if (now - lastPipelineTriggerAt < 500) return;
        lastPipelineTriggerAt = now;
        if (typeof window.runPipeline === 'function') {
            console.log('[RESULTS] Pipeline trigger clicked', {
                source: event?.currentTarget?.id || event?.target?.id || 'unknown'
            });
            window.runPipeline();
            return;
        }
        showNotification('Pipeline run is unavailable', 'error');
    };
    const autoToggleBtn = document.getElementById('auto-toggle');
    const apiToggleBtn = document.getElementById('api-toggle');
    const leftSidebarToggleBtn = document.getElementById('left-sidebar-toggle');
    const leftSidebarCloseBtn = document.getElementById('left-sidebar-close');
    const leftSidebarResizer = document.getElementById('left-sidebar-resizer');
    const rightSidebarToggleBtn = document.getElementById('right-sidebar-toggle');
    const telemetryToggleBtn = document.getElementById('telemetry-toggle-btn');
    const rightSidebar = document.getElementById('pipeline-sidebar');
    const promptSaveBtn = document.getElementById('prompt-save-btn');
    const saveSessionBtn = document.getElementById('save-session-btn');
    const responseSaveButtons = Array.from(document.querySelectorAll('.panel-save-note-btn'));
    const notesTextarea = document.getElementById('notes-textarea');
    const notesSidebar = document.getElementById('notes-sidebar');
    const notesTree = document.getElementById('notes-tree');
    const notesAddRootBtn = document.getElementById('notes-add-root');
    const notesTabs = document.getElementById('notes-tabs');
    const notesTabAdd = document.getElementById('notes-tab-add');
    const notesSessionsTab = document.getElementById('notes-sessions-tab');
    const notesSearch = document.getElementById('notes-search');
    const notesSearchClear = document.getElementById('notes-search-clear');
    const notesSelectAll = document.getElementById('notes-select-all');
    const notesExportBtn = document.getElementById('notes-export-btn');
    const notesBackupExportBtn = document.getElementById('notes-backup-export-btn');
    const notesBackupImportBtn = document.getElementById('notes-backup-import-btn');
    const notesMergeBtn = document.getElementById('notes-merge-btn');
    const notesDeleteBtn = document.getElementById('notes-delete-btn');
    const notesEmpty = document.getElementById('notes-empty');
    const notesSidebarTitle = document.querySelector('.sidebar-title');
    const notesActiveTitle = document.getElementById('notes-active-title');
    const notesStatus = document.getElementById('notes-status');
    const notesPanel = document.querySelector('.notes-panel');
    const notesHintBackupExportBtn = document.getElementById('notes-hint-backup-export');
    const notesHintBackupImportBtn = document.getElementById('notes-hint-backup-import');
    const sessionsToolbar = document.getElementById('sessions-toolbar');
    const sessionsSaveBtn = document.getElementById('sessions-save-btn');
    const sessionsDeleteBtn = document.getElementById('sessions-delete-btn');
    const sessionsPanel = document.getElementById('sessions-panel');
    const sessionsList = document.getElementById('sessions-list');
    const sessionsEmpty = document.getElementById('sessions-empty');
    const promptAttachInput = document.getElementById('prompt-attach-input');
    const promptAttachBtn = document.getElementById('prompt-attach-btn');
    const promptAttachmentBar = document.getElementById('prompt-attachment-bar');
    const attachedFiles = [];
    const attachmentKeys = new Set();
    const MAX_ATTACHMENTS = 5;
    const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB на файл
    const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // ~25MB на все вложения
    const ATTACH_CAPABILITY = {
        Claude: false
    };

    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const extractFilesFromTransfer = (transfer) => {
        if (!transfer) return [];
        const files = Array.from(transfer.files || []);
        if (transfer.items) {
            for (const item of Array.from(transfer.items)) {
                const kind = item?.kind || '';
                if (kind !== 'file') {
                    continue;
                }
                const file = item.getAsFile?.();
                if (file) {
                    files.push(file);
                    continue;
                }
                const blob = item.getAsFile?.();
                if (blob) {
                    const fallbackName = `clipboard.${(blob.type || 'bin').split('/').pop() || 'bin'}`;
                    files.push(new File([blob], fallbackName, { type: blob.type || 'application/octet-stream' }));
                }
            }
        }
        return files;
    };

    const tryAddTransferAttachments = (transfer) => {
        const files = extractFilesFromTransfer(transfer);
        if (!files.length) return false;
        addPromptAttachments(files);
        return true;
    };

    const buildAttachmentPayload = async () => {
        const slice = attachedFiles.slice(0, MAX_ATTACHMENTS);
        const payload = [];
        let total = 0;
        for (const file of slice) {
            if (!file || !file.name) continue;
            if (file.size > MAX_ATTACHMENT_BYTES) {
                showNotification(`File ${file.name} is too large (>${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`);
                continue;
            }
            if (total + file.size > MAX_TOTAL_BYTES) {
                showNotification(`Total attachment size exceeds ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB`);
                break;
            }
            try {
                const dataUrl = await readFileAsDataUrl(file);
                payload.push({
                    name: file.name,
                    size: file.size,
                    type: file.type || 'application/octet-stream',
                    base64: dataUrl
                });
                total += file.size;
            } catch (err) {
                console.warn('[results] failed to read attachment', file?.name, err);
            }
        }
        return payload;
    };

    const sendToBackground = (payload) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
    const getActiveRunState = async () => {
        try {
            const response = await sendToBackground({ type: 'GET_ACTIVE_RUN_STATE' });
            return response?.status === 'ok' ? response : null;
        } catch (err) {
            console.warn('[RESULTS] Failed to read active run state', err);
            return null;
        }
    };
    const ensureNoOtherViewRun = async () => {
        const runState = await getActiveRunState();
        if (!runState?.active) return true;
        const currentView = getCurrentViewKey();
        if (runState.sourceView && runState.sourceView === currentView) return true;
        if (runState.staleActiveRun) {
            showNotification('Предыдущий зависший запрос больше не блокирует запуск.', 'warn');
            return true;
        }
        const sourceLabel = runState.sourceView === 'pipeline' ? 'Pipeline' : 'главной странице';
        showNotification(`Дождитесь завершения запроса на ${sourceLabel}.`, 'warn');
        return false;
    };

    const renderPromptAttachments = () => {
        if (!promptAttachmentBar) return;
        if (!attachedFiles.length) {
            promptAttachmentBar.classList.add('is-empty');
            clearNode(promptAttachmentBar);
            return;
        }
        promptAttachmentBar.classList.remove('is-empty');
        const attachmentMarkup = attachedFiles.map((file) => {
            const name = file.name || '';
            const displayName = name.length > 12 ? `${name.slice(0, 12)}...` : name;
            const key = `${file.name}-${file.size}-${file.type}`;
            return `<span class="attachment-pill" data-attachment-key="${escapeHtml(key)}" title="${escapeHtml(file.name)}"><span class="attachment-icon">📎</span><span class="attachment-label">${escapeHtml(displayName)}</span><button class="attachment-remove" aria-label="Remove attachment" title="Remove attachment">×</button></span>`;
        }).join('');
        replaceChildrenFromHtml(promptAttachmentBar, attachmentMarkup);
    };

    const addPromptAttachments = (files = []) => {
        let added = false;
        files.slice(0, MAX_ATTACHMENTS).forEach((file) => {
            if (!file || !file.name) return;
            const key = `${file.name}-${file.size}-${file.type}`;
            if (attachmentKeys.has(key)) return;
            attachmentKeys.add(key);
            attachedFiles.push(file);
            added = true;
        });
        if (added) renderPromptAttachments();
    };

    renderPromptAttachments();

    promptAttachBtn?.addEventListener('click', () => {
        try {
            promptAttachInput?.click();
        } catch (err) {
            console.warn('[results] prompt attach click failed', err);
        }
    });

    promptAttachInput?.addEventListener('change', (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        addPromptAttachments(files);
        try {
            promptAttachInput.value = '';
        } catch (_) {}
    });

    promptAttachmentBar?.addEventListener('click', (e) => {
        const btn = e.target.closest('.attachment-remove');
        if (!btn) return;
        const pill = btn.closest('.attachment-pill');
        if (!pill) return;
        const key = pill.getAttribute('data-attachment-key');
        if (!key) return;
        const idx = attachedFiles.findIndex((f) => `${f.name}-${f.size}-${f.type}` === key);
        if (idx >= 0) {
            attachedFiles.splice(idx, 1);
            attachmentKeys.delete(key);
            renderPromptAttachments();
        }
    });

    const floatingTooltip = document.createElement('div');
    floatingTooltip.className = 'floating-tooltip';
    document.body.appendChild(floatingTooltip);
    let activeTooltipTarget = null;

    const positionFloatingTooltip = (target) => {
        if (!target || !target.dataset || !target.dataset.tooltip) return;
        const message = target.dataset.tooltip.trim();
        if (!message) return;
        floatingTooltip.textContent = message;
        activeTooltipTarget = target;
        floatingTooltip.classList.add('is-visible');
        requestAnimationFrame(() => {
            const rect = target.getBoundingClientRect();
            const tooltipRect = floatingTooltip.getBoundingClientRect();
            const spacing = 12;
            let top = rect.top - tooltipRect.height - spacing;
            if (top < 8) {
                top = rect.bottom + spacing;
            }
            let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            const viewportWidth = window.innerWidth;
            const maxLeft = viewportWidth - tooltipRect.width - 8;
            left = Math.min(Math.max(left, 8), Math.max(maxLeft, 8));
            floatingTooltip.style.top = `${top + window.scrollY}px`;
            floatingTooltip.style.left = `${left + window.scrollX}px`;
        });
    };

    const hideFloatingTooltip = (target) => {
        if (target && target !== activeTooltipTarget) return;
        activeTooltipTarget = null;
        floatingTooltip.classList.remove('is-visible');
    };
    const tooltipTargets = new Set([
        ...document.querySelectorAll('.select-tooltip[data-tooltip]'),
        ...document.querySelectorAll('.mode-pill[data-tooltip]'),
        ...document.querySelectorAll('.top-new-pages-toggle[data-tooltip]'),
        ...document.querySelectorAll('.sidebar-toggle-btn[data-tooltip]')
    ]);

    const registerTooltipTarget = (el) => {
        if (!el || !el.dataset || !el.dataset.tooltip || !el.dataset.tooltip.trim()) return;
        if (tooltipTargets.has(el)) return;
        tooltipTargets.add(el);
        el.addEventListener('mouseenter', () => positionFloatingTooltip(el));
        el.addEventListener('focus', () => positionFloatingTooltip(el));
        el.addEventListener('mouseleave', () => hideFloatingTooltip(el));
        el.addEventListener('blur', () => hideFloatingTooltip(el));
    };

    tooltipTargets.forEach(target => registerTooltipTarget(target));
    const devToolsPanel = document.getElementById('dev-tools-panel');
    const refreshOverridesBtn = document.getElementById('refresh-selector-overrides-btn');
    const clearOverridesBtn = document.getElementById('clear-selector-overrides-btn');
    const clearSelectorCacheBtn = document.getElementById('clear-selector-cache-btn');
    const runSelectorHealthcheckBtn = document.getElementById('run-selector-healthcheck-btn');
    const devToolsStatus = document.getElementById('dev-tools-status');
    const selectorHealthStatus = document.getElementById('selector-health-status');
    const selectorHealthSummary = document.getElementById('selector-health-summary');
    const selectorHealthTable = document.getElementById('selector-health-table');
    const selectorHealthRefreshBtn = document.getElementById('refresh-selector-health-btn');
    const selectorHealthCopyBtn = document.getElementById('copy-selector-health-btn');
    const selectorHealthExportBtn = document.getElementById('export-selector-health-btn');
    const telemetryRefreshBtn = document.getElementById('refresh-telemetry-btn');
    const telemetryTable = document.getElementById('selector-telemetry-table');
    const liveSelectorModelSelect = document.getElementById('live-selector-model');
    const liveSelectorElementSelect = document.getElementById('live-selector-element');
    const liveSelectorList = document.getElementById('live-selector-list');
    const selectorDetectedVersion = document.getElementById('selector-detected-version');
    const selectorDetectedRefreshBtn = document.getElementById('selector-detected-refresh-btn');
    const selectorActiveTabStatus = document.getElementById('selector-active-tab-status');
    const selectorActiveSelectors = document.getElementById('selectors0-active-selectors');
    const selectorOverrideInput = document.getElementById('selector-override-input');
    const selectorOverrideReasonInput = document.getElementById('selector-override-reason');
    const selectorValidateBtn = document.getElementById('selector-validate-btn');
    const selectorValidateActiveBtn = document.getElementById('selector-validate-active-btn');
    const selectorValidationStatus = document.getElementById('selector-validation-status');
    const selectorPickBtn = document.getElementById('selector-pick-btn');
    const selectorHighlightBtn = document.getElementById('selector-highlight-btn');
    const selectorSaveOverrideBtn = document.getElementById('selector-save-override-btn');
    const selectorAuditList = document.getElementById('selector-audit-list');
    const selectorAuditRefreshBtn = document.getElementById('selector-audit-refresh-btn');
    const selectorsSavedOverridesList = document.getElementById('selectors0-saved-overrides');
    const selectorsCandidatesList = document.getElementById('selectors0-candidates');
    const selectorsWorkbenchModelSelect = document.getElementById('selectors0-model');
    const selectorsWorkbenchList = document.querySelector('.selectors0-workbench-list');
    const selectorsWorkbenchStatus = document.getElementById('selectors-workbench-status');
    const selectorsWorkbenchFileInput = document.querySelector('.selectors0-file-input');
    const selectorsWorkbenchHeaderButtons = document.querySelectorAll('.selectors0-workbench [data-selectors-action]');
// const shortCheckbox = document.getElementById('short-checkbox'); // (deprecated — заменено системой Modifiers)
    const comparisonSection = document.getElementById('comparison-section');
    //-- 3.1. Добавляем элементы для сворачиваемого блока модификаторов --//
    const modifiersSection = document.querySelector('.modifiers-section');
    const toggleModifiersBtn = document.getElementById('toggle-modifiers-btn');
    const modifiersHeader = document.getElementById('modifiers-header');
    const modifiersContainer = document.getElementById('modifiers-container');
    const expandCollapseIcon = document.querySelector('.toggle-icon-console');
    const statusPingButtons = document.querySelectorAll('.status-ping-btn');
    const diagnosticsLogWrapper = document.getElementById('diagnostics-log-wrapper');
    const diagnosticsCollapseToggle = document.getElementById('toggle-diagnostics-expand');
    const clearDiagnosticsBtn = document.getElementById('clear-diagnostics-logs');
    const manualPingButtons = {};
    const manualRecoveryAdvanceNext = {};
    const manualPingReveal = new Set();
    const statusIndicatorClickTimers = {};
    const statusStateByModel = {};
    const llmLogs = {};
    window.__getDiagnosticLogs = () => llmLogs;
    const diagnosticsState = {};
    const MAX_DIAGNOSTIC_ENTRIES = 60;
    let diagnosticsExpanded = true;
    const DIAG_ENTRY_LIMIT = 3;
    const DIAG_BASE_HEIGHT = 230;
    const DIAG_COLLAPSED_HEIGHT = 120;
    const DIAG_ENTRY_FALLBACK_HEIGHT = 32;
    const diagEntryHeightCache = new WeakMap();
    const apiIndicatorRegistry = new Map();
    const apiIndicatorState = {};
    let latestTelemetrySnapshot = null;
    const SELECTOR_ELEMENT_TYPES = ['composer', 'sendButton', 'response'];
    const SELECTOR_WORKBENCH_FIELDS = [
        { key: 'composer', label: 'composer' },
        { key: 'sendButton', label: 'sendButton' },
        { key: 'response', label: 'response' },
        { key: 'stopButton', label: 'stopButton' },
        { key: 'regenerate', label: 'regenerate' },
        { key: 'lastMessage', label: 'lastMessage' }
    ];
    let activeSelectorSnapshot = null;
    let activeSelectorSnapshotModel = '';
    let activeSelectorValidationMap = new Map();
    let lastSelectorValidation = null;
    let selectorHealthSnapshot = null;
    let activePickerRequestId = null;
    let activePickerEntry = null;
    let activePickerMode = null;
    let pickerTimeoutId = null;
    const selectorsWorkbenchState = {
        entries: new Map(),
        modelName: '',
        statusTimer: null
    };

    const smartCriteriaList = document.getElementById('diag-smart-criteria-list');
    const acceptanceChecksList = document.getElementById('diag-acceptance-checks-list');
    const diagSmartCriteriaNote = document.getElementById('diag-smart-criteria-note');
    const diagAcceptanceNote = document.getElementById('diag-acceptance-note');
    const SMART_CRITERIA_DEFINITIONS = [
        {
            id: 'incremental_render',
            label: 'Incremental render (<16ms for 100 items)',
            description: 'Batch updates reuse DOM nodes with minimal work.'
        },
        {
            id: 'single_item_update',
            label: 'Single item → one DOM mutation',
            description: 'Atomic updates only touch the changed row.'
        },
        {
            id: 'focus_minimization',
            label: 'Focus switches minimized',
            description: 'Dispatches avoid tab switching unless strictly required.'
        },
        {
            id: 'cleanup',
            label: 'Cleanup removes tab/session state',
            description: 'Closed tabs relinquish their job/session data.'
        }
    ];
    const ACCEPTANCE_CHECKS_DEFINITIONS = [
        {
            id: 'script_ready_handshake',
            label: 'SCRIPT_READY handshake acked before dispatch',
            description: 'ACK_READY prevents any dispatch before the script is ready.'
        },
        {
            id: 'session_cleanup',
            label: 'Tab cleanup clears session storage keys',
            description: 'No lingering session keys remain after closing a tab.'
        },
        {
            id: 'attachment_confirmed',
            label: 'Attachments confirmed before send',
            description: 'Uploads are acknowledged before dispatch proceeds.'
        }
    ];
    const STATUS_PRIORITY = { pending: 0, info: 1, pass: 2, warn: 3, error: 4 };
    const STATUS_LABEL = { pending: 'Pending', info: 'Info', pass: 'Pass', warn: 'Warning', error: 'Error' };
    const sanitizeStatus = (value) => {
        const normalized = (String(value || '').toLowerCase().trim() || 'info');
        return Object.prototype.hasOwnProperty.call(STATUS_PRIORITY, normalized) ? normalized : 'info';
    };
    const smartCriteriaState = SMART_CRITERIA_DEFINITIONS.reduce((acc, entry) => {
        acc[entry.id] = { ...entry, status: 'pending', details: entry.description };
        return acc;
    }, {});
    const acceptanceState = ACCEPTANCE_CHECKS_DEFINITIONS.reduce((acc, entry) => {
        acc[entry.id] = { ...entry, status: 'pending', details: entry.description };
        return acc;
    }, {});
    const handshakeTracker = {
        ackByKey: new Map(),
        dispatchByKey: new Map()
    };
    const makeHandshakeKey = (message = {}) => {
        if (message.dispatchId) return message.dispatchId;
        if (message.tabSessionId) return message.tabSessionId;
        const llmName = message.llmName || 'unknown';
        const tabId = message.tabId || 'n/a';
        return `${llmName}:${tabId}`;
    };
    const getOrderedEntries = (definitions, stateMap) =>
        definitions.map(def => stateMap[def.id]).filter(Boolean);
    const renderStatusList = (listEl, definitions, stateMap) => {
        if (!listEl) return;
        const entries = getOrderedEntries(definitions, stateMap);
        if (!entries.length) {
            listEl.replaceChildren();
            return;
        }
        const nodes = entries.map((entry) => {
            const li = document.createElement('li');
            li.className = `diag-smart-entry diag-smart-entry-${entry.status}`;
            const label = document.createElement('span');
            label.className = 'diag-smart-label';
            label.textContent = entry.label;
            const detail = document.createElement('span');
            detail.className = 'diag-smart-detail';
            detail.textContent = entry.details || entry.description || '';
            li.append(label, detail);
            return li;
        });
        listEl.replaceChildren(...nodes);
    };
    const deriveSectionStatus = (stateMap) => {
        let best = 'pending';
        Object.values(stateMap).forEach((entry) => {
            const next = sanitizeStatus(entry.status);
            if (STATUS_PRIORITY[next] > STATUS_PRIORITY[best]) {
                best = next;
            }
        });
        return best;
    };
    const updateSectionNote = (noteEl, stateMap) => {
        if (!noteEl) return;
        const status = deriveSectionStatus(stateMap);
        noteEl.textContent = STATUS_LABEL[status] || status;
    };
    const refreshSmartPanel = () => {
        renderStatusList(smartCriteriaList, SMART_CRITERIA_DEFINITIONS, smartCriteriaState);
        renderStatusList(acceptanceChecksList, ACCEPTANCE_CHECKS_DEFINITIONS, acceptanceState);
        updateSectionNote(diagSmartCriteriaNote, smartCriteriaState);
        updateSectionNote(diagAcceptanceNote, acceptanceState);
    };
    const updateStatusEntry = (stateMap, id, { status, details } = {}) => {
        if (!stateMap[id]) return;
        const newStatus = sanitizeStatus(status || 'info');
        const current = stateMap[id];
        const currentRank = STATUS_PRIORITY[current.status] ?? 0;
        const incomingRank = STATUS_PRIORITY[newStatus] ?? 0;
        if (incomingRank >= currentRank || currentRank === 0) {
            current.status = newStatus;
        }
        if (details) {
            current.details = details;
        }
        current.lastUpdated = Date.now();
        stateMap[id] = current;
        refreshSmartPanel();
    };
    const incrementalRenderTracker = {
        largeBatchSeen: false,
        singleItemSeen: false
    };
    const processIncrementalRenderMeasurement = ({ itemCount = 0, mutatedCount = 0, durationMs = 0 } = {}) => {
        if (!itemCount) return;
        const detail = `items=${itemCount} mutated=${mutatedCount} time=${durationMs.toFixed(1)}ms`;
        if (itemCount >= 100) {
            incrementalRenderTracker.largeBatchSeen = true;
            const status = durationMs <= 16 ? 'pass' : 'warn';
            updateStatusEntry(smartCriteriaState, 'incremental_render', { status, details: detail });
        } else if (!incrementalRenderTracker.largeBatchSeen) {
            updateStatusEntry(smartCriteriaState, 'incremental_render', { details: detail });
        }
        if (itemCount === 1) {
            incrementalRenderTracker.singleItemSeen = true;
            const status = mutatedCount <= 1 ? 'pass' : 'warn';
            updateStatusEntry(smartCriteriaState, 'single_item_update', { status, details: detail });
        } else if (!incrementalRenderTracker.singleItemSeen) {
            updateStatusEntry(smartCriteriaState, 'single_item_update', { details: 'Waiting for single-item diffs' });
        }
    };
    const flushIncrementalRenderQueue = () => {
        while (incrementalRenderQueue.length) {
            const payload = incrementalRenderQueue.shift();
            if (payload) {
                processIncrementalRenderMeasurement(payload);
            }
        }
    };
    incrementalRenderHandler = processIncrementalRenderMeasurement;
    flushIncrementalRenderQueue();
    refreshSmartPanel();
    const focusMetrics = {};
    const handleSmartFocusMetric = (message = {}) => {
        const llmName = message.llmName;
        if (!llmName) return;
        const total = Number(message.focusSwitches || 0);
        const previous = Number(focusMetrics[llmName] || 0);
        const delta = Math.max(0, total - previous);
        focusMetrics[llmName] = total;
        const allowed = message.requiresFocus ? 2 : 0;
        const status = delta <= allowed ? 'pass' : 'warn';
        const details = `delta=${delta} requiresFocus=${message.requiresFocus ? 'yes' : 'no'} dispatch=${message.dispatchId || 'n/a'}`;
        updateStatusEntry(smartCriteriaState, 'focus_minimization', { status, details });
    };
    const handleSmartCleanupEvent = (message = {}) => {
        if (!message.llmName) return;
        const success = !message.jobStateEntryRemaining && !message.tabMapHasEntry && !message.sessionTabTracked;
        const status = success ? 'pass' : 'warn';
        const details = `tab=${message.tabId || 'n/a'} jobState=${message.jobStateEntryRemaining ? 'present' : 'cleared'} tabMap=${message.tabMapHasEntry ? 'present' : 'cleared'} session=${message.sessionTabTracked ? 'present' : 'cleared'}`;
        updateStatusEntry(smartCriteriaState, 'cleanup', { status, details });
        updateStatusEntry(acceptanceState, 'session_cleanup', { status, details: `reason=${message.reason || 'n/a'} ${details}` });
    };
    const handleSmartScriptReadyAck = (message = {}) => {
        if (!message.llmName) return;
        const key = makeHandshakeKey(message);
        const ackAt = Number(message.ackAt) || Date.now();
        handshakeTracker.ackByKey.set(key, {
            ackAt,
            llmName: message.llmName,
            tabId: message.tabId || null,
            dispatchId: message.dispatchId || null,
            tabSessionId: message.tabSessionId || null
        });
        const dispatch = handshakeTracker.dispatchByKey.get(key);
        if (dispatch && Number.isFinite(dispatch.dispatchAt)) {
            const deltaMs = dispatch.dispatchAt - ackAt;
            const status = deltaMs >= 0 ? 'pass' : 'warn';
            const details = `ackAt=${ackAt} dispatchAt=${dispatch.dispatchAt} deltaMs=${deltaMs} dispatch=${dispatch.dispatchId || 'n/a'}`;
            updateStatusEntry(acceptanceState, 'script_ready_handshake', { status, details });
            return;
        }
        const details = `ackAt=${ackAt} tab=${message.tabId || 'n/a'} dispatch=${message.dispatchId || 'n/a'}`;
        updateStatusEntry(acceptanceState, 'script_ready_handshake', { status: 'info', details });
    };
    const handleSmartDispatchSend = (message = {}) => {
        if (!message.llmName) return;
        const key = makeHandshakeKey(message);
        const dispatchAt = Number(message.dispatchAt) || Date.now();
        handshakeTracker.dispatchByKey.set(key, {
            dispatchAt,
            llmName: message.llmName,
            tabId: message.tabId || null,
            dispatchId: message.dispatchId || null,
            tabSessionId: message.tabSessionId || null
        });
        const ack = handshakeTracker.ackByKey.get(key);
        if (!ack || !Number.isFinite(ack.ackAt)) {
            const details = `ack=missing dispatchAt=${dispatchAt} tab=${message.tabId || 'n/a'} dispatch=${message.dispatchId || 'n/a'}`;
            updateStatusEntry(acceptanceState, 'script_ready_handshake', { status: 'warn', details });
            return;
        }
        const deltaMs = dispatchAt - ack.ackAt;
        const status = deltaMs >= 0 ? 'pass' : 'warn';
        const details = `ackAt=${ack.ackAt} dispatchAt=${dispatchAt} deltaMs=${deltaMs} dispatch=${message.dispatchId || 'n/a'}`;
        updateStatusEntry(acceptanceState, 'script_ready_handshake', { status, details });
    };
    const handleSmartAttachmentConfirmed = (message = {}) => {
        const uploaded = Number(message.uploadedCount || 0);
        const status = uploaded > 0 ? 'pass' : 'warn';
        const details = `uploaded=${uploaded} llm=${message.llmName || 'n/a'}`;
        updateStatusEntry(acceptanceState, 'attachment_confirmed', { status, details });
    };

    const bindToggleButton = (button, checkbox) => {
        if (!button || !checkbox) return null;
        const applyState = () => {
            const isActive = !!checkbox.checked;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        };
        button.addEventListener('click', () => {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        applyState();
        return applyState;
    };

    const syncAutoToggleState = bindToggleButton(autoToggleBtn, autoCheckbox);
    const syncApiToggleState = bindToggleButton(apiToggleBtn, apiModeCheckbox);

    const parsePx = (value, fallback) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const rootStyles = getComputedStyle(document.documentElement);
    const leftSidebarMin = parsePx(rootStyles.getPropertyValue('--sidebar-left-min'), 240);
    const leftSidebarMax = parsePx(rootStyles.getPropertyValue('--sidebar-left-max'), 360);
    const clampLeftSidebarWidth = (value) => Math.min(leftSidebarMax, Math.max(leftSidebarMin, value));
    const defaultLeftSidebarWidth = clampLeftSidebarWidth(
        parsePx(rootStyles.getPropertyValue('--sidebar-left-width'), 280)
    );
    let leftSidebarWidth = defaultLeftSidebarWidth;

    const setLeftSidebarOpen = (isOpen) => {
        document.body.classList.toggle('left-sidebar-open', isOpen);
        if (leftSidebarToggleBtn) {
            leftSidebarToggleBtn.classList.toggle('is-active', isOpen);
            leftSidebarToggleBtn.setAttribute('aria-pressed', String(isOpen));
        }
        if (isOpen) {
            document.documentElement.style.setProperty('--sidebar-left-width', `${leftSidebarWidth}px`);
        } else {
            leftSidebarWidth = defaultLeftSidebarWidth;
            document.documentElement.style.setProperty('--sidebar-left-width', `${defaultLeftSidebarWidth}px`);
        }
        if (leftSidebarResizer) {
            const widthValue = isOpen ? leftSidebarWidth : defaultLeftSidebarWidth;
            leftSidebarResizer.setAttribute('aria-valuenow', String(Math.round(widthValue)));
        }
    };

    if (leftSidebarToggleBtn) {
        const initialLeftState = document.body.classList.contains('left-sidebar-open');
        setLeftSidebarOpen(initialLeftState);
        leftSidebarToggleBtn.addEventListener('click', () => {
            const nextState = !document.body.classList.contains('left-sidebar-open');
            setLeftSidebarOpen(nextState);
        });
        if (leftSidebarCloseBtn) {
            leftSidebarCloseBtn.addEventListener('click', () => setLeftSidebarOpen(false));
        }
    }

    if (leftSidebarResizer) {
        const appShell = document.querySelector('.app-shell');
        let isResizing = false;
        let shellOffset = 0;

        const handleResizeMove = (event) => {
            if (!isResizing || !appShell) return;
            const nextWidth = clampLeftSidebarWidth(event.clientX - shellOffset);
            leftSidebarWidth = nextWidth;
            document.documentElement.style.setProperty('--sidebar-left-width', `${nextWidth}px`);
            leftSidebarResizer.setAttribute('aria-valuenow', String(Math.round(nextWidth)));
        };

        const stopResize = () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.classList.remove('is-resizing');
        };

        leftSidebarResizer.addEventListener('pointerdown', (event) => {
            if (!document.body.classList.contains('left-sidebar-open')) return;
            if (!appShell) return;
            const shellRect = appShell.getBoundingClientRect();
            const shellPadding = parsePx(getComputedStyle(appShell).paddingLeft, 0);
            shellOffset = shellRect.left + shellPadding;
            event.preventDefault();
            isResizing = true;
            document.body.classList.add('is-resizing');
            leftSidebarResizer.setPointerCapture?.(event.pointerId);
        });

        window.addEventListener('pointermove', handleResizeMove);
        window.addEventListener('pointerup', stopResize);
        window.addEventListener('pointercancel', stopResize);
    }

    let rightSidebarClosing = false;
    let rightSidebarCloseHandler = null;
    const setRightSidebarOpen = (isOpen) => {
        document.body.classList.toggle('right-sidebar-open', isOpen);
        if (isOpen) {
            document.body.classList.remove('right-sidebar-closing');
            document.body.classList.remove('right-sidebar-reset');
            rightSidebarClosing = false;
            if (rightSidebar && rightSidebarCloseHandler) {
                rightSidebar.removeEventListener('transitionend', rightSidebarCloseHandler);
                rightSidebarCloseHandler = null;
            }
        }
        if (rightSidebarToggleBtn) {
            rightSidebarToggleBtn.classList.toggle('is-active', isOpen);
            rightSidebarToggleBtn.setAttribute('aria-pressed', String(isOpen));
        }
        if (rightSidebar) {
            rightSidebar.setAttribute('aria-hidden', String(!isOpen));
        }
    };

    const startRightSidebarClose = () => {
        if (!rightSidebar || !document.body.classList.contains('right-sidebar-open')) return;
        if (rightSidebarClosing) return;
        rightSidebarClosing = true;
        document.body.classList.add('right-sidebar-closing');
        if (rightSidebarCloseHandler) {
            rightSidebar.removeEventListener('transitionend', rightSidebarCloseHandler);
            rightSidebarCloseHandler = null;
        }
        const handleCloseEnd = (event) => {
            if (event.target !== rightSidebar || event.propertyName !== 'transform') return;
            rightSidebar.removeEventListener('transitionend', handleCloseEnd);
            rightSidebarClosing = false;
            document.body.classList.add('right-sidebar-reset');
            setRightSidebarOpen(false);
            document.body.classList.remove('right-sidebar-closing');
            requestAnimationFrame(() => {
                document.body.classList.remove('right-sidebar-reset');
            });
            rightSidebarCloseHandler = null;
        };
        rightSidebarCloseHandler = handleCloseEnd;
        rightSidebar.addEventListener('transitionend', handleCloseEnd);
    };

    if (rightSidebarToggleBtn) {
        rightSidebarToggleBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            const currentPage = (window.location.pathname.split('/').pop() || '').toLowerCase();
            const targetPage = currentPage === 'pipeline_panel.html' ? 'result_new.html' : 'pipeline_panel.html';
            try {
                if (chrome?.storage?.local) {
                    const targetView = targetPage === 'pipeline_panel.html' ? 'pipeline' : 'main';
                    await persistCrossViewUiState();
                    await safeStorageLocalSet({
                        llmComparatorLastPipelineView: targetView,
                        [crossViewNavigationIntentKey]: {
                            sourceView: getCurrentViewKey(),
                            targetView,
                            savedAt: Date.now()
                        }
                    });
                }
            } catch (err) {
                console.warn('[RESULTS] Failed to persist pipeline view state', err);
            }
            window.location.href = targetPage;
        });
    }

    if (rightSidebarToggleBtn && rightSidebar) {
        const initialRightState = document.body.classList.contains('right-sidebar-open');
        setRightSidebarOpen(initialRightState);
    }

    let pipelineRunActive = false;
    const debateApprovalBridge = {
        resolve: null
    };
    let activePipelineAbortController = null;
    let activePipelineRunContext = null;
    const makePipelineRunId = () => {
        try {
            if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        } catch (_) {}
        return `pipeline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };
        const makePipelineBatchId = ({ runId, roundIndex, groupIndex = 0 } = {}) =>
            `${runId || makePipelineRunId()}:r${roundIndex || 1}:g${groupIndex || 0}`;
        const notifyPipelineControlState = async (state, extra = {}) => {
            if (!activePipelineRunContext?.pipelineRunId) return;
            try {
                await sendToBackground({
                    type: 'PIPELINE_FSM_EVENT',
                    event: {
                        pipelineRunId: activePipelineRunContext.pipelineRunId,
                        sessionId: activePipelineRunContext.sessionId || null,
                        state,
                        ...extra
                    }
                });
            } catch (err) {
                console.warn('[RESULTS] Failed to persist pipeline control state', err);
            }
        };
        const PIPELINE_TERMINAL_STATUSES = new Set([
        'DONE',
        'FINAL',
        'SUCCESS',
        'COPY_SUCCESS',
        'PARTIAL',
        'STREAM_TIMEOUT',
        'STREAM_TIMEOUT_HIDDEN',
        'ERROR',
        'NO_SEND',
        'EXTRACT_FAILED',
        'TIMEOUT',
        'FAILED',
        'CANCELLED',
        'STOPPED'
    ]);
    const normalizePipelineMessageEnvelope = (messageOrName, answer = '') => {
        const message = typeof messageOrName === 'object' && messageOrName
            ? messageOrName
            : { llmName: messageOrName, answer };
        const metadata = message.metadata || message.meta || {};
        return {
            ...message,
            answer: message.answer ?? answer,
            metadata,
            pipelineRunId: message.pipelineRunId || metadata.pipelineRunId || null,
            pipelineRoundId: message.pipelineRoundId || metadata.pipelineRoundId || metadata.roundId || null,
            pipelineBatchId: message.pipelineBatchId || metadata.pipelineBatchId || metadata.batchId || null,
            dispatchId: message.dispatchId || metadata.dispatchId || null,
            status: message.status || metadata.status || metadata.finalStatus || metadata.modelFinalStatus || null
        };
    };
    const isTerminalPipelineMessage = (message) => {
        const envelope = normalizePipelineMessageEnvelope(message);
        const status = String(envelope.status || '').trim().toUpperCase();
        return (
            envelope.type === 'LLM_FINAL_RESPONSE'
            || envelope.type === 'FINAL_LLM_RESPONSE'
            || envelope.metadata?.isFinal === true
            || envelope.metadata?.terminal === true
            || PIPELINE_TERMINAL_STATUSES.has(status)
        );
    };
    const pipelineWaiter = {
        runToken: 0,
        waiting: false,
        pendingModels: new Map(),
        responses: {},
        partialResponses: {},
        timeoutId: null,
        waitForModels(models, { timeoutMs = 240000, context = {}, signal = null } = {}) {
            const normalized = Array.isArray(models) ? models.filter(Boolean) : [];
            if (!normalized.length) {
                return Promise.resolve({ responses: {}, missing: [], timedOut: false });
            }
            this.runToken += 1;
            const token = this.runToken;
            this.waiting = true;
            this.pendingModels = new Map(normalized.map((name) => [name, {
                llmName: name,
                pipelineRunId: context.pipelineRunId || null,
                pipelineRoundId: context.pipelineRoundId || null,
                pipelineBatchId: context.pipelineBatchId || null,
                dispatchId: context.dispatchId || null
            }]));
            this.responses = {};
            this.partialResponses = {};
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            return new Promise((resolve, reject) => {
                const finalize = (timedOut = false) => {
                    if (token !== this.runToken) return;
                    const missing = normalized.filter((name) => !Object.prototype.hasOwnProperty.call(this.responses, name));
                    this.waiting = false;
                    this.pendingModels.clear();
                    if (this.timeoutId) {
                        clearTimeout(this.timeoutId);
                        this.timeoutId = null;
                    }
                    resolve({ responses: { ...this.responses }, missing, timedOut });
                };
                const abort = () => {
                    if (token !== this.runToken) return;
                    this.reset();
                    reject(new DOMException('Pipeline run cancelled', 'AbortError'));
                };
                if (signal?.aborted) {
                    abort();
                    return;
                }
                signal?.addEventListener?.('abort', abort, { once: true });
                this.timeoutId = setTimeout(() => finalize(true), timeoutMs);
                this._finalize = finalize;
                this._abort = abort;
            });
        },
        isExpectedResponse(message) {
            const envelope = normalizePipelineMessageEnvelope(message);
            const pending = this.pendingModels.get(envelope.llmName);
            if (!this.waiting || !pending) return false;
            if (pending.pipelineRunId && envelope.pipelineRunId && pending.pipelineRunId !== envelope.pipelineRunId) return false;
            if (pending.pipelineRoundId && envelope.pipelineRoundId && pending.pipelineRoundId !== envelope.pipelineRoundId) return false;
            if (pending.pipelineBatchId && envelope.pipelineBatchId && pending.pipelineBatchId !== envelope.pipelineBatchId) return false;
            if (pending.dispatchId && envelope.dispatchId && pending.dispatchId !== envelope.dispatchId) return false;
            return true;
        },
        handlePartial(messageOrName, answer) {
            const envelope = normalizePipelineMessageEnvelope(messageOrName, answer);
            if (!this.isExpectedResponse(envelope)) return false;
            this.partialResponses[envelope.llmName] = envelope.answer;
            return true;
        },
        handleFinal(messageOrName, answer) {
            const envelope = normalizePipelineMessageEnvelope(messageOrName, answer);
            if (!this.isExpectedResponse(envelope)) return false;
            if (!isTerminalPipelineMessage(envelope)) {
                return this.handlePartial(envelope);
            }
            this.responses[envelope.llmName] = envelope.answer;
            const allDone = Array.from(this.pendingModels.keys()).every((name) =>
                Object.prototype.hasOwnProperty.call(this.responses, name)
            );
            if (allDone && typeof this._finalize === 'function') {
                this._finalize(false);
            }
            return true;
        },
        handleResponse(llmName, answer) {
            return this.handleFinal({
                llmName,
                answer,
                metadata: { terminal: true }
            });
        },
        reset() {
            this.waiting = false;
            this.pendingModels.clear();
            this.responses = {};
            this.partialResponses = {};
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            this._finalize = null;
            this._abort = null;
        }
    };

    const pipelinePanel = document.getElementById('pipeline-panel');
    if (pipelinePanel) {
        const pipelineTitle = document.getElementById('pipeline-panel-toggle-title')
            || pipelinePanel.previousElementSibling;
        const PIPELINE_COLLAPSED_STORAGE_KEY = 'llmComparatorPipelineCollapsed';
        const setPipelineCollapsed = (collapsed) => {
            pipelinePanel.classList.toggle('is-collapsed', collapsed);
            if (pipelineTitle) {
                pipelineTitle.setAttribute('aria-expanded', String(!collapsed));
            }
            try {
                if (chrome?.storage?.local) {
                    chrome.storage.local.set({ [PIPELINE_COLLAPSED_STORAGE_KEY]: Boolean(collapsed) });
                }
            } catch (err) {
                console.warn('[RESULTS] Failed to persist pipeline collapsed state', err);
            }
        };

        if (pipelineTitle) {
            pipelineTitle.setAttribute('aria-expanded', 'true');
            pipelineTitle.addEventListener('click', () => {
                setPipelineCollapsed(!pipelinePanel.classList.contains('is-collapsed'));
            });
            pipelineTitle.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                setPipelineCollapsed(!pipelinePanel.classList.contains('is-collapsed'));
            });
        }
        try {
            if (chrome?.storage?.local) {
                chrome.storage.local.get(PIPELINE_COLLAPSED_STORAGE_KEY, (data) => {
                    const stored = data?.[PIPELINE_COLLAPSED_STORAGE_KEY];
                    if (typeof stored === 'boolean') {
                        setPipelineCollapsed(stored);
                    }
                });
            }
        } catch (err) {
            console.warn('[RESULTS] Failed to restore pipeline collapsed state', err);
        }

        const pipelineAddRoundBtn = document.getElementById('pipeline-add-round-btn');
        const pipelineRemoveRoundBtn = document.getElementById('removeRoundBtn');
        const pipelineAddBtn = document.getElementById('pipeline-add-btn');
        const pipelineResetBtn = document.getElementById('pipeline-reset-btn');
        const pipelineSaveBtn = document.getElementById('pipeline-save-btn');
        const pipelineDeleteBtn = document.getElementById('pipeline-delete-btn');
        const pipelineExportBtn = document.getElementById('pipeline-export-btn');
        const pipelineImportBtn = document.getElementById('pipeline-import-btn');
        const pipelineRunBtn = document.getElementById('pipeline-run-btn');
        const debateRunToggleBtn = document.getElementById('debate-run-toggle-btn');
        const debateStepBtn = document.getElementById('debate-step-btn');
        const pipelineCloseBtn = document.getElementById('pipeline-close-btn');
        const pipelineItems = document.getElementById('pipelineItems');
        const pipelineName = document.getElementById('currentPipelineName');
        const insertionPoint = document.getElementById('insertionPoint');
        const entryWrapper = document.getElementById('entryWrapper');
        const pipelineList = pipelinePanel.querySelector('.pipeline-list');
        const pipelineListHeader = pipelineList ? pipelineList.querySelector('.pipeline-list-header') : null;
        const PIPELINE_STORAGE_KEY = 'llmComparatorPipelines';
        const pipelineStore = {
            version: 2,
            pipelines: {},
            order: [],
            lastSaved: '',
            active: ''
        };
        let pipelineR1ManualDirty = false;
        let pipelineApplyingConfig = false;

        const togglePipelineListCollapsed = () => {
            if (!pipelineList) return;
            pipelineList.classList.toggle('is-collapsed');
        };

        if (pipelineListHeader) {
            pipelineListHeader.addEventListener('dblclick', (event) => {
                event.preventDefault();
                togglePipelineListCollapsed();
            });
        }

        if (pipelineItems) {
            pipelineItems.addEventListener('dblclick', (event) => {
                const nameSpan = event.target.closest('.pipeline-item-name');
                if (!nameSpan || !pipelineItems.contains(nameSpan)) return;
                event.preventDefault();
                event.stopPropagation();
                startPipelineRename(nameSpan.closest('.pipeline-item'));
            });
        }

        const normalizePipelineStore = (value) => {
            const base = { version: 2, pipelines: {}, order: [], lastSaved: '', active: '' };
            if (!value || typeof value !== 'object') return base;
            const pipelines = value.pipelines && typeof value.pipelines === 'object' ? value.pipelines : {};
            const order = Array.isArray(value.order)
                ? value.order.filter((name) => typeof name === 'string' && name.trim())
                : Object.keys(pipelines);
            return {
                ...base,
                pipelines,
                order,
                lastSaved: typeof value.lastSaved === 'string' ? value.lastSaved : '',
                active: typeof value.active === 'string' ? value.active : ''
            };
        };

        const readPipelineStore = async () => {
            let storedValue = null;
            if (window.CompressedStorage?.get) {
                storedValue = await window.CompressedStorage.get(PIPELINE_STORAGE_KEY);
            } else if (chrome?.storage?.local?.get) {
                const res = await new Promise((resolve) => chrome.storage.local.get(PIPELINE_STORAGE_KEY, resolve));
                storedValue = res ? res[PIPELINE_STORAGE_KEY] : null;
            } else {
                try {
                    storedValue = JSON.parse(localStorage.getItem(PIPELINE_STORAGE_KEY) || 'null');
                } catch (_) {
                    storedValue = null;
                }
            }
            const normalized = normalizePipelineStore(storedValue);
            pipelineStore.pipelines = normalized.pipelines;
            pipelineStore.order = normalized.order;
            pipelineStore.lastSaved = normalized.lastSaved;
            pipelineStore.active = normalized.active;
        };

        const persistPipelineStore = async () => {
            const payload = {
                version: pipelineStore.version,
                pipelines: pipelineStore.pipelines,
                order: pipelineStore.order,
                lastSaved: pipelineStore.lastSaved,
                active: pipelineStore.active
            };
            if (window.CompressedStorage?.set) {
                await window.CompressedStorage.set(PIPELINE_STORAGE_KEY, payload);
            } else if (chrome?.storage?.local?.set) {
                chrome.storage.local.set({ [PIPELINE_STORAGE_KEY]: payload });
            } else {
                try {
                    localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(payload));
                } catch (_) {}
            }
        };

        const buildPipelineExportPayload = () => ({
            version: pipelineStore.version,
            pipelines: pipelineStore.pipelines,
            order: pipelineStore.order,
            lastSaved: pipelineStore.lastSaved,
            active: pipelineStore.active
        });

        const PipelineRuntime = window.PipelineRuntime;
        if (!PipelineRuntime) {
            console.warn('[RESULTS] PipelineRuntime module missing; Pipeline UI renderer unavailable.');
        }
        const PIPELINE_MODELS = PipelineRuntime?.MODELS || [];
        const PIPELINE_ROLE_BASE = ['Synthesis', 'Critic', 'Meta', 'Advocate'];
        const DEFAULT_MODEL_INDICES = PipelineRuntime?.DEFAULT_MODEL_INDICES || [];
        const DEFAULT_JUDGE_INDICES = PipelineRuntime?.DEFAULT_JUDGE_INDICES || [];
        const DEFAULT_LATE_JUDGE_INDICES = PipelineRuntime?.DEFAULT_LATE_JUDGE_INDICES || [0];

        const getOrderedJudgePrompts = () => {
            const list = Array.isArray(judgeSystemPrompts) ? judgeSystemPrompts : [];
            return list
                .filter((prompt) => prompt && prompt.id && prompt.text)
                .sort((a, b) => {
                    const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
                    const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
                    if (orderA !== orderB) return orderA - orderB;
                    const labelA = String(a.label || a.id || '');
                    const labelB = String(b.label || b.id || '');
                    return labelA.localeCompare(labelB);
                });
        };

        const getJudgePromptById = (promptId) => {
            if (!promptId) return null;
            const ordered = getOrderedJudgePrompts();
            return ordered.find((prompt) => prompt.id === promptId) || null;
        };

        const getCriticalJudgePromptId = () => {
            const ordered = getOrderedJudgePrompts();
            if (!ordered.length) return null;
            const match = ordered.find((prompt) => {
                const label = String(prompt.label || '').toLowerCase();
                const id = String(prompt.id || '').toLowerCase();
                return label.includes('crit') || id.includes('critical');
            });
            return (match || ordered[0]).id;
        };

        const resolveJudgePromptId = (value, index = 0) => {
            if (!value) return null;
            const ordered = getOrderedJudgePrompts();
            const byId = ordered.find((prompt) => prompt.id === value);
            if (byId) return byId.id;
            const lowered = String(value).toLowerCase();
            const byLabel = ordered.find((prompt) => String(prompt.label || '').toLowerCase() === lowered);
            if (byLabel) return byLabel.id;
            const roleIndex = PIPELINE_ROLE_BASE.findIndex((role) => role.toLowerCase() === lowered);
            if (roleIndex !== -1 && ordered[roleIndex]) return ordered[roleIndex].id;
            if (ordered[index % Math.max(1, ordered.length)]) return ordered[index % ordered.length].id;
            return null;
        };

        const buildJudgePromptOptionsHtml = (index) => {
            return PipelineRuntime?.buildJudgePromptOptionsHtml?.({
                index,
                orderedPrompts: getOrderedJudgePrompts(),
                escapeHtml
            }) || '';
        };

        const buildModelBlocksHtml = (activeIndices = DEFAULT_MODEL_INDICES, withRole = false) => {
            return PipelineRuntime?.buildModelBlocksHtml?.({
                activeIndices,
                withRole,
                orderedPrompts: getOrderedJudgePrompts(),
                escapeHtml
            }) || '';
        };

        const hydratePipelineStacks = () => {
            PipelineRuntime?.hydratePipelineStacks?.({
                document,
                escapeHtml,
                orderedPrompts: getOrderedJudgePrompts()
            });
        };

        const pipelineStyles = window.getComputedStyle(document.documentElement);
        const pipelineBlockHeight = parseFloat(pipelineStyles.getPropertyValue('--pipeline-block-height'));
        const pipelineBlockGap = parseFloat(pipelineStyles.getPropertyValue('--pipeline-block-gap'));
        const resolvedBlockHeight = Number.isFinite(pipelineBlockHeight) ? pipelineBlockHeight : 64;
        const resolvedBlockGap = Number.isFinite(pipelineBlockGap) ? pipelineBlockGap : 6;
        const BLOCK_H = resolvedBlockHeight + resolvedBlockGap;
        const BLOCK_CENTER = resolvedBlockHeight / 2;
        const BASE_STACK_HEIGHT = 240;
        let roundCounter = 2;

        hydratePipelineStacks();

        const getBlockCenterY = (index) => index * BLOCK_H + BLOCK_CENTER;
        const getBlockCenterYRelativeTo = (stack, index, container) => {
            if (!stack || !container) return getBlockCenterY(index);
            const item = stack.children[index];
            if (!item) return getBlockCenterY(index);
            const itemRect = item.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (!itemRect.height || !containerRect.height) return getBlockCenterY(index);
            return (itemRect.top + itemRect.height / 2) - containerRect.top;
        };

        const getModelInputIndices = (stackId) => {
            const stack = document.getElementById(stackId);
            if (!stack) return [];
            const indices = [];
            Array.from(stack.children).forEach((item, i) => {
                const cb = item.querySelector('.model-input-checkbox');
                if (cb && cb.checked && !cb.disabled) indices.push(i);
            });
            return indices;
        };

        const getModelSendIndices = (stackId) => {
            const stack = document.getElementById(stackId);
            if (!stack) return [];
            const indices = [];
            Array.from(stack.children).forEach((item, i) => {
                const cb = item.querySelector('.model-send-checkbox');
                if (cb && cb.checked && !cb.disabled) indices.push(i);
            });
            return indices;
        };

        const getOutputCheckedIndices = (stackId) => {
            const stack = document.getElementById(stackId);
            if (!stack) return [];
            const indices = [];
            Array.from(stack.children).forEach((item, i) => {
                const cb = item.querySelector('.output-checkbox');
                if (cb && cb.checked) indices.push(i);
            });
            return indices;
        };

        const areAllChecked = (container, selector) => {
            if (!container) return false;
            const boxes = Array.from(container.querySelectorAll(selector));
            if (!boxes.length) return false;
            return boxes.every((cb) => cb.checked);
        };

        const setCheckboxesState = (container, selector, shouldCheck) => {
            if (!container) return false;
            const boxes = Array.from(container.querySelectorAll(selector));
            if (!boxes.length) return false;
            let changed = false;
            boxes.forEach((cb) => {
                if (cb.checked !== shouldCheck) {
                    cb.checked = shouldCheck;
                    changed = true;
                }
            });
            return changed;
        };

        const updatePipelineLayout = () => {
            const stacks = pipelinePanel.querySelectorAll('.model-stack, .output-stack');
            let maxHeight = 0;
            stacks.forEach((stack) => {
                const items = Array.from(stack.children).filter((node) => node.nodeType === 1);
                if (!items.length) return;
                const lastItem = items[items.length - 1];
                const lastStyle = window.getComputedStyle(lastItem);
                const marginBottom = parseFloat(lastStyle.marginBottom) || 0;
                const stackRect = stack.getBoundingClientRect();
                const lastRect = lastItem.getBoundingClientRect();
                const stackHeight = (lastRect.bottom - stackRect.top) + marginBottom;
                if (stackHeight > maxHeight) maxHeight = stackHeight;
            });
            const height = Math.max(BASE_STACK_HEIGHT, maxHeight || BASE_STACK_HEIGHT);
            pipelinePanel.querySelectorAll('.connector-svg').forEach((svg) => {
                svg.style.height = `${height}px`;
                svg.setAttribute('height', `${height}`);
            });
            if (entryWrapper) {
                entryWrapper.style.height = `${height}px`;
            }
        };

        const captureModelStackState = (stackId) => {
            return PipelineRuntime?.captureModelStackState?.(document, stackId) || null;
        };

        const captureOutputStackState = (stackId) => {
            return PipelineRuntime?.captureOutputStackState?.(document, stackId) || null;
        };

        const capturePipelineConfig = () => {
            const modelStacks = {
                'r1-models': captureModelStackState('r1-models')
            };
            for (let r = 2; r <= roundCounter; r++) {
                modelStacks[`r${r}-models`] = captureModelStackState(`r${r}-models`);
            }

            return {
                version: 2,
                roundCounter,
                modelStacks,
                outputStack: captureOutputStackState('output-stack')
            };
        };

        const clonePipelineConfig = (config) => {
            return PipelineRuntime?.cloneConfig?.(config) || null;
        };

        const applyModelStackState = (stackId, state, sendOverrides = null) => {
            if (!state || !Array.isArray(state.items)) return;
            const stack = document.getElementById(stackId);
            if (!stack) return;
            const blocks = Array.from(stack.querySelectorAll('.model-block'));
            blocks.forEach((block, index) => {
                const item = state.items[index];
                if (!item) return;
                const inputCb = block.querySelector('.model-input-checkbox');
                const sendCb = block.querySelector('.model-send-checkbox');
                const inputValue = typeof item.input === 'boolean'
                    ? item.input
                    : (typeof item.checked === 'boolean' ? item.checked : undefined);
                if (inputCb && typeof inputValue === 'boolean') {
                    inputCb.checked = inputValue;
                }
                const sendFallback = Array.isArray(sendOverrides?.[stackId]) ? sendOverrides[stackId][index] : undefined;
                const sendValue = typeof item.send === 'boolean' ? item.send : sendFallback;
                if (sendCb && typeof sendValue === 'boolean') {
                    sendCb.checked = sendValue;
                }
                const role = block.querySelector('.role-selector');
                if (role && item.role) {
                    const resolvedPromptId = resolveJudgePromptId(item.role, index);
                    const hasOption = Array.from(role.options).some((opt) => opt.value === resolvedPromptId);
                    if (hasOption) role.value = resolvedPromptId;
                }
            });
        };

        const applyOutputStackState = (stackId, state) => {
            if (!state || (!Array.isArray(state.checks) && !state.outputs)) return;
            const stack = document.getElementById(stackId);
            if (!stack) return;
            const blocks = Array.from(stack.querySelectorAll('.output-block'));
            blocks.forEach((block, index) => {
                const cb = block.querySelector('.output-checkbox');
                if (!cb) return;
                const key = block.dataset.output || '';
                if (key && typeof state.outputs?.[key] === 'boolean') {
                    cb.checked = state.outputs[key];
                } else if (Array.isArray(state.checks) && typeof state.checks[index] === 'boolean') {
                    cb.checked = state.checks[index];
                }
            });
        };

        const buildSendOverridesFromLegacy = (config) => {
            const collectorStacks = config?.collectorStacks;
            if (!collectorStacks || typeof collectorStacks !== 'object') return null;

            const normalizeChecks = (state) => {
                if (!state) return null;
                if (Array.isArray(state)) return state.map(Boolean);
                if (Array.isArray(state.checks)) return state.checks.map(Boolean);
                if (Array.isArray(state.items)) {
                    return state.items.map((item) => {
                        if (typeof item?.checked === 'boolean') return item.checked;
                        return false;
                    });
                }
                return null;
            };

            const getChecks = (stackId) => normalizeChecks(collectorStacks[stackId]);
            const rounds = Math.max(1, Number(config.roundCounter) || 1);
            const overrides = {};

            if (rounds === 1) {
                const resultsChecks = getChecks('results-stack');
                if (resultsChecks) overrides['r1-models'] = resultsChecks;
            } else {
                const r1Checks = getChecks('resp1-stack');
                if (r1Checks) overrides['r1-models'] = r1Checks;
                for (let r = 2; r < rounds; r++) {
                    const respChecks = getChecks(`resp${r}-stack`);
                    if (respChecks) overrides[`r${r}-models`] = respChecks;
                }
                const resultsChecks = getChecks('results-stack');
                if (resultsChecks) overrides[`r${rounds}-models`] = resultsChecks;
            }

            return Object.keys(overrides).length ? overrides : null;
        };

        const drawInputSplitConnector = (svgId, targetStackId, colorClass) => {
            const svg = document.getElementById(svgId);
            const entryPoint = document.getElementById('entryPoint');
            if (!svg) return;

            const targetStack = document.getElementById(targetStackId);
            const targetIndices = getModelInputIndices(targetStackId);
            if (targetIndices.length === 0) {
                clearNode(svg);
                if (entryPoint) entryPoint.style.marginTop = '26px';
                return;
            }

            const W = 50;
            const splitX = W - 15;
            let html = '';

            const targetYs = targetIndices.map((i) => getBlockCenterYRelativeTo(targetStack, i, svg));
            const targetMinY = Math.min(...targetYs);
            const targetMaxY = Math.max(...targetYs);
            const targetMidY = (targetMinY + targetMaxY) / 2;

            if (entryPoint) {
                if (entryWrapper) {
                    const entryTargetYs = targetIndices.map((i) => getBlockCenterYRelativeTo(targetStack, i, entryWrapper));
                    const entryMidY = (Math.min(...entryTargetYs) + Math.max(...entryTargetYs)) / 2;
                    entryPoint.style.marginTop = `${entryMidY - 9}px`;
                } else {
                    entryPoint.style.marginTop = `${targetMidY - 9}px`;
                }
            }

            html += `<line x1="0" y1="${targetMidY}" x2="${splitX}" y2="${targetMidY}" class="connector-line ${colorClass} flow-anim"/>`;

            if (targetYs.length > 1) {
                html += `<line x1="${splitX}" y1="${targetMinY}" x2="${splitX}" y2="${targetMaxY}" class="merge-line ${colorClass}"/>`;
            }

            targetYs.forEach((y) => {
                html += `<line x1="${splitX}" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line ${colorClass} flow-anim"/>`;
                html += `<polygon points="${W - 6},${y - 4} ${W},${y} ${W - 6},${y + 4}" class="arrow-head ${colorClass}"/>`;
            });

            setSvgContent(svg, html);
        };

        const drawHorizontalConnectors = (svgId, stackId, colorClass) => {
            const svg = document.getElementById(svgId);
            if (!svg) return;

            const indices = getModelSendIndices(stackId);
            if (indices.length === 0) {
                clearNode(svg);
                return;
            }

            const stack = document.getElementById(stackId);
            const W = 50;
            let html = '';
            indices.forEach((i) => {
                const y = getBlockCenterYRelativeTo(stack, i, svg);
                html += `<line x1="0" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line ${colorClass} flow-anim"/>`;
                html += `<polygon points="${W - 6},${y - 4} ${W},${y} ${W - 6},${y + 4}" class="arrow-head ${colorClass}"/>`;
            });
            setSvgContent(svg, html);
        };

        const drawMergeSplitConnector = (svgId, sourceStackId, targetStackId, colorClass, options = {}) => {
            const svg = document.getElementById(svgId);
            if (!svg) return;

            const { sourceMode = 'send', targetMode = 'input' } = options;
            const modeLookup = (stackId, mode) => {
                if (mode === 'input') return getModelInputIndices(stackId);
                if (mode === 'send') return getModelSendIndices(stackId);
                if (mode === 'output') return getOutputCheckedIndices(stackId);
                return [];
            };

            const sourceIndices = modeLookup(sourceStackId, sourceMode);
            const targetIndices = modeLookup(targetStackId, targetMode);

            const sourceStack = document.getElementById(sourceStackId);
            const targetStack = document.getElementById(targetStackId);
            if (!sourceStack || !targetStack || sourceIndices.length === 0 || targetIndices.length === 0) {
                clearNode(svg);
                return;
            }

            const W = 50;
            const mergeX = 15;
            const splitX = W - 15;
            let html = '';

            const sourceYs = sourceIndices.map((i) => getBlockCenterYRelativeTo(sourceStack, i, svg));
            const targetYs = targetIndices.map((i) => getBlockCenterYRelativeTo(targetStack, i, svg));

            const sourceMinY = Math.min(...sourceYs);
            const sourceMaxY = Math.max(...sourceYs);
            const targetMinY = Math.min(...targetYs);
            const targetMaxY = Math.max(...targetYs);
            const sourceMidY = (sourceMinY + sourceMaxY) / 2;
            const targetMidY = (targetMinY + targetMaxY) / 2;

            sourceYs.forEach((y) => {
                html += `<line x1="0" y1="${y}" x2="${mergeX}" y2="${y}" class="connector-line ${colorClass} flow-anim"/>`;
            });

            if (sourceYs.length > 1) {
                html += `<line x1="${mergeX}" y1="${sourceMinY}" x2="${mergeX}" y2="${sourceMaxY}" class="merge-line ${colorClass}"/>`;
            }

            html += `<line x1="${mergeX}" y1="${sourceMidY}" x2="${splitX}" y2="${targetMidY}" class="connector-line ${colorClass} flow-anim"/>`;

            if (targetYs.length > 1) {
                html += `<line x1="${splitX}" y1="${targetMinY}" x2="${splitX}" y2="${targetMaxY}" class="merge-line ${colorClass}"/>`;
            }

            targetYs.forEach((y) => {
                html += `<line x1="${splitX}" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line ${colorClass} flow-anim"/>`;
                html += `<polygon points="${W - 6},${y - 4} ${W},${y} ${W - 6},${y + 4}" class="arrow-head ${colorClass}"/>`;
            });

            setSvgContent(svg, html);
        };

        const updatePipelineAll = () => {
            updatePipelineLayout();
            pipelinePanel.querySelectorAll('.model-block').forEach((block) => {
                const inputCb = block.querySelector('.model-input-checkbox');
                const sendCb = block.querySelector('.model-send-checkbox');
                const sel = block.querySelector('.role-selector');
                const indicator = block.querySelector('.status-indicator');
                if (!inputCb) return;
                if (inputCb.checked) {
                    block.classList.remove('inactive');
                    block.classList.add('active');
                    if (sel) sel.disabled = false;
                    if (sendCb) {
                        sendCb.disabled = false;
                    }
                } else {
                    block.classList.remove('active');
                    block.classList.add('inactive');
                    if (sel) sel.disabled = true;
                    if (sendCb) {
                        sendCb.checked = false;
                        sendCb.disabled = true;
                    }
                    if (indicator) {
                        indicator.className = 'status-indicator';
                        indicator.title = '';
                    }
                }
            });

            pipelinePanel.querySelectorAll('.output-block').forEach((block) => {
                const cb = block.querySelector('.output-checkbox');
                if (!cb) return;
                block.classList.toggle('inactive', !cb.checked);
            });

            drawInputSplitConnector('svg-in-models', 'r1-models', 'active');

            if (roundCounter === 1) {
                drawMergeSplitConnector('svg-stage-output', 'r1-models', 'output-stack', 'brain-flow', {
                    sourceMode: 'send',
                    targetMode: 'output'
                });
            } else {
                drawMergeSplitConnector('svg-r1-r2', 'r1-models', 'r2-models', 'brain-flow', {
                    sourceMode: 'send',
                    targetMode: 'input'
                });
                for (let r = 2; r < roundCounter; r++) {
                    drawMergeSplitConnector(`svg-r${r}-r${r + 1}`, `r${r}-models`, `r${r + 1}-models`, 'brain-flow', {
                        sourceMode: 'send',
                        targetMode: 'input'
                    });
                }
                drawMergeSplitConnector('svg-stage-output', `r${roundCounter}-models`, 'output-stack', 'brain-flow', {
                    sourceMode: 'send',
                    targetMode: 'output'
                });
            }
        };

        const formatPipelineTimestamp = () => {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
        };

        const setPipelineRunUi = (isRunning) => {
            if (!pipelineRunBtn) return;
            pipelineRunBtn.disabled = isRunning;
            pipelineRunBtn.textContent = isRunning ? 'Running…' : '▶ Run';
        };

        let debateApprovalResolver = null;
        let debateApprovalRejecter = null;
        let debateApprovalCleanup = null;
        const getDebateMaxTurns = () => {
            const value = Number(debateMaxTurnsInput?.value || debateRunState.maxTurns || 5);
            return Number.isFinite(value) ? Math.max(1, Math.min(50, Math.round(value))) : 5;
        };
        const getDebateRunPolicy = () => {
            const value = String(debateRunPolicySelect?.value || (autoCheckbox?.checked ? 'auto' : 'manual')).trim();
            return value === 'auto' ? 'auto' : 'manual';
        };
        const isDebateAutoPolicy = () => getDebateRunPolicy() === 'auto';
        const syncDebateAutoCompatibilityState = () => {
            const isAuto = isDebateAutoPolicy();
            if (autoCheckbox && autoCheckbox.checked !== isAuto) {
                autoCheckbox.checked = isAuto;
            }
            if (debateRunPolicySelect && debateRunPolicySelect.value !== (isAuto ? 'auto' : 'manual')) {
                debateRunPolicySelect.value = isAuto ? 'auto' : 'manual';
            }
            autoMode = isAuto;
            return isAuto;
        };
        const setDebatePausedState = (paused, reason = '') => {
            debatePaused = !!paused;
            debateRunState.status = debatePaused ? 'paused' : (pipelineRunActive ? 'running' : 'idle');
            debateRunState.pauseReason = debatePaused ? reason : '';
            sendToBackground({
                type: debatePaused ? 'PAUSE_DEBATE' : 'RESUME_DEBATE',
                reason,
                sessionId: debateTabsState?.activeSessionId || '1'
            }).catch((err) => {
                console.warn('[RESULTS] Debate background pause/resume sync failed', err);
            });
            if (!debatePaused && debateApprovalResolver) {
                resolveDebateApproval();
            } else if (!debatePaused && typeof debateApprovalBridge.resolve === 'function') {
                debateApprovalBridge.resolve();
            } else {
                updateDebateButtonsUi();
            }
        };
        const updateDebateButtonsUi = () => {
            const waiting = typeof debateApprovalResolver === 'function';
            if (debateRunToggleBtn) {
                if (debatePaused) {
                    debateRunToggleBtn.textContent = '▶';
                    debateRunToggleBtn.title = 'Resume debate';
                    debateRunToggleBtn.setAttribute('aria-label', 'Resume debate');
                } else if (pipelineRunActive || waiting) {
                    debateRunToggleBtn.textContent = 'Ⅱ';
                    debateRunToggleBtn.title = 'Pause after current turn';
                    debateRunToggleBtn.setAttribute('aria-label', 'Pause after current turn');
                } else {
                    debateRunToggleBtn.textContent = '▶';
                    debateRunToggleBtn.title = 'Run debate';
                    debateRunToggleBtn.setAttribute('aria-label', 'Run debate');
                }
                debateRunToggleBtn.disabled = false;
                debateRunToggleBtn.classList.toggle('is-active', debatePaused);
            }
            if (debateStepBtn) {
                debateStepBtn.disabled = !waiting;
                debateStepBtn.textContent = waiting ? 'Approve' : 'Step';
            }
            if (debateMaxTurnsInput) {
                debateMaxTurnsInput.value = String(getDebateMaxTurns());
            }
            syncDebateAutoCompatibilityState();
            syncDebateAutoPauseButton();
        };
        const resolveDebateApproval = () => {
            const resolver = debateApprovalResolver;
            const cleanup = debateApprovalCleanup;
            debateApprovalResolver = null;
            debateApprovalRejecter = null;
            debateApprovalCleanup = null;
            cleanup?.();
            if (typeof resolver === 'function') {
                resolver(true);
            }
            updateDebateButtonsUi();
        };
        debateApprovalBridge.resolve = resolveDebateApproval;
        const rejectDebateApproval = (error) => {
            const rejecter = debateApprovalRejecter;
            const cleanup = debateApprovalCleanup;
            debateApprovalResolver = null;
            debateApprovalRejecter = null;
            debateApprovalCleanup = null;
            cleanup?.();
            if (typeof rejecter === 'function') {
                rejecter(error);
            }
            updateDebateButtonsUi();
        };
        const cleanupDebateApprovalWaiter = () => {
            debateApprovalResolver = null;
            debateApprovalRejecter = null;
            debateApprovalCleanup?.();
            debateApprovalCleanup = null;
            updateDebateButtonsUi();
        };
        const buildDebateActionPromptSuffix = () => {
        const selectedAction = debateActionSelect?.value || '';
        const actionMap = {
                harden: 'Attack the previous thesis harder. Find a logical flaw or false assumption.',
                compare: 'Build a comparative table: cost, complexity, risks, scalability.',
                example: 'Support the thesis with one concrete real-world example with numbers.',
                assumptions: 'List all implicit assumptions behind the previous argument.',
                counter: 'Provide a counterexample that disproves the previous thesis.',
                mvp: 'What is the smallest MVP step that can validate the hypothesis now?',
                grounding: 'Stop theorizing. Provide a concrete implementation plan with tools.',
            final: 'Final synthesis: agreed points, disputed points, and next step.'
        };
        const actionInstruction = actionMap[selectedAction] || '';
        const modeValue = (debateModeSelect?.value || 'debate').trim();
        const lenValue = (debateLengthSelect?.value || '500').trim();
        const roleValue = (debateRoleSelect?.value || '').trim();
        const senderValue = (debateSenderSelect?.value || '').trim();
        const receiverValue = (debateReceiverSelect?.value || '').trim();
        const extra = [];
        if (modeValue) extra.push(`Mode: ${modeValue}`);
        if (lenValue && lenValue !== 'inf') extra.push(`Max tokens: ${lenValue}`);
        if (senderValue) extra.push(`Sender: ${senderValue}`);
        if (receiverValue) extra.push(`Receiver: ${receiverValue || 'All models'}`);
        if (roleValue) extra.push(`Receiver role: ${roleValue}`);
        if (actionInstruction) extra.push(`Moderator action: ${actionInstruction}`);
        return extra.length ? `\n\n${extra.join('\n')}` : '';
    };
        const waitForDebateApproval = async ({ signal, timeoutMs = 0 } = {}) => {
            const isAuto = isDebateAutoPolicy();
            if (isAuto && !debatePaused) {
                debateRunState.turnCount = Number(debateRunState.turnCount || 0) + 1;
                debateRunState.maxTurns = getDebateMaxTurns();
                if (debateRunState.turnCount <= debateRunState.maxTurns) {
                    updateDebateButtonsUi();
                    return true;
                }
                setDebatePausedState(true, 'max_turns_reached');
                showNotification(`Debate paused after ${debateRunState.maxTurns} auto turns.`, 'warn');
            }
            if (debateApprovalResolver) return true;
            await new Promise((resolve, reject) => {
                let timeoutId = null;
                const abort = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    rejectDebateApproval(new DOMException('Pipeline approval cancelled', 'AbortError'));
                };
                if (signal?.aborted) {
                    reject(new DOMException('Pipeline approval cancelled', 'AbortError'));
                    return;
                }
                debateApprovalResolver = resolve;
                debateApprovalRejecter = reject;
                debateApprovalCleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    signal?.removeEventListener?.('abort', abort);
                };
                signal?.addEventListener?.('abort', abort, { once: true });
                if (timeoutMs > 0) {
                    timeoutId = setTimeout(() => {
                        rejectDebateApproval(new Error('Pipeline approval timeout'));
                    }, timeoutMs);
                }
                updateDebateButtonsUi();
            });
            return true;
        };
        updateDebateButtonsUi();

        const getRoundModelsState = (roundIndex) => {
            return PipelineRuntime?.getRoundModelsState?.(document, roundIndex) || null;
        };

        const getRoundStage = (roundIndex) => PipelineRuntime?.getRoundStage?.(roundIndex) || (roundIndex === 1 ? 'models' : 'judge');

        const buildPipelineRuntimeSnapshot = (config) => {
            return PipelineRuntime?.buildPipelineRuntimeSnapshot?.({
                config: config || capturePipelineConfig(),
                roundCounter,
                getRoundState: getRoundModelsState,
                getOutputSelection: getPipelineOutputSelection
            }) || { config: capturePipelineConfig(), rounds: [], outputSelection: getPipelineOutputSelection() };
        };

        const setPipelineEditingEnabled = (enabled) => {
            if (!pipelinePanel) return;
            const disabled = !enabled;
            pipelinePanel
                .querySelectorAll('.model-input-checkbox, .model-send-checkbox, .role-selector, .output-checkbox, #pipeline-add-round-btn, #removeRoundBtn, #pipeline-add-btn, #pipeline-delete-btn, #pipeline-import-btn')
                .forEach((el) => {
                    el.disabled = disabled;
                });
        };

        const getPipelineOutputSelection = (outputState = null) => {
            return PipelineRuntime?.getPipelineOutputSelection?.(document, outputState) || { notes: false, export: false, exportHtml: false };
        };

        const modelNameSetsEqual = (left = [], right = []) => {
            const leftSet = new Set(left.filter(Boolean));
            const rightSet = new Set(right.filter(Boolean));
            if (leftSet.size !== rightSet.size) return false;
            return Array.from(leftSet).every((name) => rightSet.has(name));
        };

        const getDefaultR1ModelNames = () => {
            const models = Array.isArray(PipelineRuntime?.MODELS) ? PipelineRuntime.MODELS : [];
            const indices = Array.isArray(PipelineRuntime?.DEFAULT_MODEL_INDICES)
                ? PipelineRuntime.DEFAULT_MODEL_INDICES
                : [];
            return indices.map((index) => models[index]?.name).filter(Boolean);
        };

        const isR1DefaultSelection = () => {
            const state = getRoundModelsState(1);
            const defaults = getDefaultR1ModelNames();
            if (!state || !defaults.length) return false;
            return modelNameSetsEqual(state.inputModels, defaults)
                && modelNameSetsEqual(state.sendModels, defaults);
        };

        const setR1ModelsFromSelectedLLMs = ({ force = false } = {}) => {
            const selected = getSelectedLLMs();
            if (!selected.length) return false;
            if (!force && pipelineR1ManualDirty && !isR1DefaultSelection()) return false;
            const selectedSet = new Set(selected);
            const stack = document.getElementById('r1-models');
            if (!stack) return false;
            let changed = false;
            stack.querySelectorAll('.model-block').forEach((block) => {
                const name = block.querySelector('.model-name')?.textContent?.trim();
                if (!name) return;
                const checked = selectedSet.has(name);
                const inputCb = block.querySelector('.model-input-checkbox');
                const sendCb = block.querySelector('.model-send-checkbox');
                if (inputCb && inputCb.checked !== checked) {
                    inputCb.checked = checked;
                    changed = true;
                }
                if (sendCb && sendCb.checked !== checked) {
                    sendCb.checked = checked;
                    changed = true;
                }
            });
            if (changed) updatePipelineAll();
            return changed;
        };

        const buildResponsesList = (responsesMap, orderedNames = []) => {
            let list = '';
            let count = 0;
            orderedNames.forEach((name) => {
                const output = responsesMap?.[name];
                if (!output || (typeof output === 'string' && output.trim().startsWith('Error:'))) return;
                list += `-------------------------\n\n**${name}:**\n${output}\n\n`;
                count += 1;
            });
            if (count > 0) {
                list += '-------------------------';
            }
            return { list, count };
        };

        const runModelBatch = async ({
            prompt,
            models,
            attachments = [],
            forceNewTabs = true,
            useApiFallback = true,
            timeoutMs = 240000,
            context = {},
            signal = null
        }) => {
            if (!models.length) return { responses: {}, missing: [], timedOut: false };
            if (!(await ensureNoOtherViewRun())) {
                throw new Error('Another page has an active request.');
            }
            const sourceView = getCurrentViewKey();
            const pipelineContext = {
                ...(context && typeof context === 'object' ? context : {}),
                sourceView
            };
            const payloadBase = {
                type: 'START_FULLPAGE_PROCESS',
                prompt,
                selectedLLMs: models,
                forceNewTabs,
                useApiFallback,
                sourceView,
                pipelineContext
            };

            if (attachments.length) {
                const unsupported = models.filter((name) => ATTACH_CAPABILITY[name] === false);
                if (unsupported.length) {
                    showNotification(`These LLMs may not support attachments: ${unsupported.join(', ')}`, 'warn');
                }
            }

            let response = null;
            try {
                response = await sendToBackground({
                    ...payloadBase,
                    attachments: Array.isArray(attachments) ? attachments : []
                });
            } catch (err) {
                if (attachments.length) {
                    console.warn('[RESULTS] Pipeline run failed with attachments, retrying without them', err);
                    response = await sendToBackground(payloadBase);
                } else {
                    throw err;
                }
            }

            if (!response || response.status !== 'process_started') {
                showNotification(`Pipeline: unexpected background response (${response?.status || 'no_response'})`, 'warn');
            }

            return pipelineWaiter.waitForModels(models, { timeoutMs, context, signal });
        };

        const formatPipelineFinalText = (result) => {
            const lines = [];
            if (result.pipelineName) lines.push(`Pipeline: ${result.pipelineName}`);
            if (result.prompt) lines.push(`Prompt: ${result.prompt}`);
            lines.push('');
            Object.entries(result.finalOutputs || {}).forEach(([name, output]) => {
                if (!output || (typeof output === 'string' && output.trim().startsWith('Error:'))) return;
                lines.push(`--- ${name} ---`);
                lines.push(String(output).trim());
                lines.push('');
            });
            return lines.join('\n').trim();
        };

        const buildPipelineFinalPayload = (result) => ({
            pipelineName: result.pipelineName,
            prompt: result.prompt,
            resolvedPrompt: result.resolvedPrompt,
            finalOutputs: result.finalOutputs,
            pipelineConfig: result.pipelineConfig
        });

        const safePipelineMarkdownToHtml = (text) => {
            const stripped = String(text || '')
                .replace(/<script\b[\s\S]*?<\/script>/gi, '')
                .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                .replace(/javascript\s*:/gi, '')
                .replace(/data\s*:\s*text\/html/gi, '');
            const escaped = escapeHtml(stripped);
            const html = convertMarkdownToHTML(escaped);
            return sanitizeInlineHtml(html);
        };

        const buildPipelineFinalHtml = (result) => {
            const sections = [];
            Object.entries(result.finalOutputs || {}).forEach(([name, output]) => {
                if (!output || (typeof output === 'string' && output.trim().startsWith('Error:'))) return;
                const text = String(output).trim();
                if (!text) return;
                const htmlContent = safePipelineMarkdownToHtml(text);
                const metadataLine = buildMetadataLine(name);
                const metadataHtml = metadataLine ? `<p class="response-meta">${escapeHtml(metadataLine)}</p>` : '';
                sections.push(`
                    <section class="pipeline-response">
                        <h2>${escapeHtml(name)}</h2>
                        ${metadataHtml}
                        <div class="response-body">${htmlContent}</div>
                    </section>
                `);
            });

            if (!sections.length) return '';

            const promptText = (result.resolvedPrompt || result.prompt || '').trim();
            const promptSection = promptText
                ? `<section class="pipeline-prompt"><h2>Prompt</h2><pre>${escapeHtml(promptText)}</pre></section>`
                : '';
            const title = escapeHtml(result.pipelineName || 'Pipeline Run');

            return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; background: #ffffff; color: #111; padding: 24px; line-height: 1.5; }
        h1 { margin: 0 0 16px; font-size: 22px; }
        h2 { margin: 18px 0 10px; font-size: 18px; }
        pre { background: #f6f8fa; padding: 12px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; }
        .pipeline-response { margin-bottom: 20px; }
        .response-meta { margin: 0 0 10px; color: #555; font-size: 13px; }
        .response-body { background: #f8fafc; padding: 12px; border-radius: 8px; }
        .response-body pre { background: #eef2f7; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    ${promptSection}
    <h2>Final Outputs</h2>
    ${sections.join('\n')}
</body>
</html>`;
        };

        const handlePipelineOutputs = async (result, outputSelection = null) => {
            const selection = outputSelection || getPipelineOutputSelection(result?.pipelineConfig?.outputStack);
            const hasAny = selection.notes || selection.export || selection.exportHtml;
            if (!hasAny) return;

            const summaryText = formatPipelineFinalText(result);
            if (selection.notes) {
                if (window.PipelineNotes?.savePipelineRun) {
                    await window.PipelineNotes.savePipelineRun({
                        title: result.pipelineName || 'Pipeline Run',
                        text: summaryText,
                        json: buildPipelineFinalPayload(result)
                    });
                } else if (saveSessionBtn) {
                    saveSessionBtn.click();
                } else {
                    showNotification('Notes unavailable', 'warn');
                }
            }

            if (selection.export) {
                const exportPayload = buildPipelineFinalPayload(result);
                const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `pipeline_run_${formatPipelineTimestamp()}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            }

            if (selection.exportHtml) {
                const htmlContent = buildPipelineFinalHtml(result);
                if (!htmlContent) return;
                const blob = new Blob([htmlContent], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `pipeline_run_${formatPipelineTimestamp()}.html`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            }
        };

        const runPipeline = async () => {
            if (pipelineRunActive) {
                showNotification('Pipeline already running', 'warn');
                return;
            }
            const rawPrompt = buildDebateModeratorDispatchText();
            if (!rawPrompt) {
                console.warn('[RESULTS] Pipeline run blocked: empty moderator prompt', {
                    promptInputValue: promptInput?.value || '',
                    moderatorBodyText: debateModMessageBody?.innerText || debateModMessageBody?.textContent || ''
                });
                alert('Please enter a moderator message or wait for a model response.');
                return;
            }

            pipelineRunActive = true;
            debatePaused = false;
            debateRunState.status = 'running';
            debateRunState.turnCount = 0;
            debateRunState.maxTurns = getDebateMaxTurns();
            debateRunState.pauseReason = '';
            activePipelineAbortController = new AbortController();
            activePipelineRunContext = {
                pipelineRunId: makePipelineRunId(),
                sessionId: debateTabsState?.activeSessionId || document.querySelector('.debate-session-tab.active')?.dataset?.sessionId || '1',
                startedAt: Date.now()
            };
            await notifyPipelineControlState('STARTING', {
                stage: 'dispatch',
                payload: {
                    pipelineName: (pipelineName?.textContent || '').trim() || 'Pipeline Run'
                }
            });
            debateRunState.activeRole = String(debateRoleSelect?.value || '').trim();
            const moderatorEntryText = getModeratorDispatchText();
            syncModeratorSelectors();
            setPipelineRunUi(true);
            updateDebateButtonsUi();

            try {
                const signal = activePipelineAbortController.signal;
                setR1ModelsFromSelectedLLMs();
                const runSnapshot = buildPipelineRuntimeSnapshot(capturePipelineConfig());
                const runConfig = runSnapshot.config;
                const runtimeRounds = runSnapshot.rounds;
                setPipelineEditingEnabled(false);
                const pipelineNameText = (pipelineName?.textContent || '').trim();
                const basePrompt = applySelectedModifiersToPrompt(rawPrompt) + buildDebateActionPromptSuffix();
                const attachmentsPayload = await buildAttachmentPayload();
                const useApiFallback = apiModeCheckbox ? apiModeCheckbox.checked : true;
                const firstRoundState = runtimeRounds[0];
                const selectedSystemPromptSnapshot = clonePipelineConfig(getSelectedJudgeSystemPrompt());
                const orderedPromptsSnapshot = clonePipelineConfig(getOrderedJudgePrompts()) || [];
                const moderatorOnly = String(debateReceiverSelect?.value || '').trim() === '__none__';
                if (moderatorOnly) {
                    await sendToBackground({
                        type: 'START_DEBATE_RUN',
                        sessionId: activePipelineRunContext.sessionId,
                        title: `Debate ${activePipelineRunContext.sessionId}`,
                        prompt: moderatorEntryText,
                        targets: [],
                        participants: getSelectedLLMs(),
                        settings: {
                            runPolicy: getDebateRunPolicy(),
                            maxTurns: debateRunState.maxTurns
                        },
                        command: {
                            action: debateActionSelect?.value || '',
                            targets: [],
                            instruction: moderatorEntryText,
                            maxTokens: debateLengthSelect?.value || '',
                            roleOverride: debateRoleSelect?.value || '',
                            mode: getDebateRunPolicy()
                        }
                    }).catch((err) => console.warn('[RESULTS] Debate background start sync failed', err));
                    appendModeratorFeedEntry(moderatorEntryText);
                    clearModeratorComposer();
                    return;
                }
                if (!firstRoundState?.inputModels?.length) {
                    console.warn('[RESULTS] Pipeline run blocked: no selected R1 input models');
                    showNotification('Select at least one R1 Input model.', 'warn');
                    return;
                }
                debateFeedState.lastCommittedHashByModel = {};
                await sendToBackground({
                    type: 'START_DEBATE_RUN',
                    sessionId: activePipelineRunContext.sessionId,
                    title: `Debate ${activePipelineRunContext.sessionId}`,
                    prompt: moderatorEntryText,
                    targets: firstRoundState.inputModels.slice(),
                    participants: getSelectedLLMs(),
                    settings: {
                        runPolicy: getDebateRunPolicy(),
                        maxTurns: debateRunState.maxTurns
                    },
                    command: {
                        action: debateActionSelect?.value || '',
                        targets: firstRoundState.inputModels.slice(),
                        instruction: moderatorEntryText,
                        maxTokens: debateLengthSelect?.value || '',
                        roleOverride: debateRoleSelect?.value || '',
                        mode: getDebateRunPolicy()
                    }
                }).catch((err) => console.warn('[RESULTS] Debate background start sync failed', err));
                appendModeratorFeedEntry(moderatorEntryText);
                renderDebateModelCards(debateRunState.activeRole, firstRoundState.inputModels, { approvalSelectable: true });
                clearModeratorComposer();

                const rounds = [];
                let finalOutputs = {};
                let responsesList = '';

                for (let r = 1; r <= runtimeRounds.length; r++) {
                    if (signal.aborted) {
                        throw new DOMException('Pipeline run cancelled', 'AbortError');
                    }
                    const roundState = runtimeRounds[r - 1];
                    if (!roundState) {
                        showNotification(`Pipeline: round R${r} is unavailable`, 'warn');
                        return;
                    }

                    const isModelRound = roundState.stage === 'models';
                    const isJudgeRound = roundState.stage === 'judge';

                    if (!roundState.inputModels.length) {
                        showNotification(`Pipeline: no Input models in R${r}`, 'warn');
                        return;
                    }
                    const forceNewTabs = isModelRound ? (newPagesCheckbox ? newPagesCheckbox.checked : true) : false;
                    let outputs = {};
                    let missing = [];
                    let timedOut = false;
                    let promptByModel = null;
                    let roundPrompt = null;
                    const makeBatchContext = (groupIndex = 0) => ({
                        ...activePipelineRunContext,
                        pipelineRoundId: `r${r}`,
                        pipelineBatchId: makePipelineBatchId({
                            runId: activePipelineRunContext.pipelineRunId,
                            roundIndex: r,
                            groupIndex
                        })
                    });

                    if (isModelRound) {
                        await notifyPipelineControlState('DISPATCHING', {
                            round: `r${r}`,
                            stage: 'models',
                            payload: { models: roundState.inputModels.slice(), sendModels: roundState.sendModels.slice() }
                        });
                        roundPrompt = basePrompt;
                        const roundResult = await runModelBatch({
                            prompt: basePrompt,
                            models: roundState.inputModels,
                            attachments: attachmentsPayload,
                            forceNewTabs,
                            useApiFallback,
                            context: makeBatchContext(0),
                            signal
                        });
                        outputs = roundResult.responses || {};
                        missing = roundResult.missing || [];
                        timedOut = !!roundResult.timedOut;
                    } else if (isJudgeRound) {
                        // Manual moderation applies to inter-round routing, not the initial user send.
                        await notifyPipelineControlState('AWAITING_APPROVAL', {
                            round: `r${r}`,
                            stage: 'judge',
                            payload: { waitingForApproval: true }
                        });
                        await waitForDebateApproval({ signal });
                        await notifyPipelineControlState('DISPATCHING', {
                            round: `r${r}`,
                            stage: 'judge',
                            payload: { waitingForApproval: false }
                        });
                        if (!responsesList) {
                            showNotification(`Pipeline: no Send outputs in R${r - 1}`, 'warn');
                            return;
                        }
                        const fallbackPrompt = selectedSystemPromptSnapshot || orderedPromptsSnapshot[0] || null;
                        const promptGroups = new Map();

                        roundState.models
                            .filter((model) => model.input)
                            .forEach((model) => {
                                const resolvedId = resolveJudgePromptId(model.promptId);
                                const promptId = resolvedId || fallbackPrompt?.id || '';
                                if (!promptId) return;
                                if (!promptGroups.has(promptId)) {
                                    promptGroups.set(promptId, []);
                                }
                                promptGroups.get(promptId).push(model.name);
                            });

                        if (!promptGroups.size) {
                            showNotification(`Pipeline: no judge prompt selected in R${r}`, 'warn');
                            return;
                        }

                        promptByModel = {};
                        let groupIndex = 0;
                        for (const [promptId, models] of promptGroups.entries()) {
                            await waitForDebateApproval({ signal });
                            const promptDef = getJudgePromptById(promptId) || fallbackPrompt;
                            const evaluationPrompt = buildJudgeEvaluationPrompt(
                                promptDef ? promptDef.text : '',
                                rawPrompt,
                                responsesList
                            );
                            const batchResult = await runModelBatch({
                                prompt: evaluationPrompt,
                                models,
                                attachments: [],
                                forceNewTabs,
                                useApiFallback,
                                context: makeBatchContext(groupIndex),
                                signal
                            });
                            outputs = { ...outputs, ...(batchResult.responses || {}) };
                            missing = missing.concat(batchResult.missing || []);
                            if (batchResult.timedOut) timedOut = true;
                            models.forEach((name) => {
                                promptByModel[name] = promptDef?.id || promptId;
                            });
                            groupIndex += 1;
                        }
                    } else {
                        showNotification(`Pipeline: unsupported stage in R${r}`, 'warn');
                        return;
                    }

                    rounds.push({
                        round: r,
                        stage: isModelRound ? 'Models' : 'Judge',
                        prompt: roundPrompt,
                        promptByModel,
                        models: roundState.models,
                        inputModels: roundState.inputModels,
                        sendModels: roundState.sendModels,
                        outputs,
                        missing,
                        timedOut
                    });

                    const { list } = buildResponsesList(outputs, roundState.sendModels);
                    if (r < runtimeRounds.length) {
                        if (!list) {
                            showNotification(`Pipeline: no Send outputs in R${r}`, 'warn');
                            return;
                        }
                        responsesList = list;
                    } else {
                        roundState.sendModels.forEach((name) => {
                            const output = outputs[name];
                            if (!output || (typeof output === 'string' && output.trim().startsWith('Error:'))) return;
                            finalOutputs[name] = output;
                        });
                    }
                }

                const result = {
                    pipelineName: pipelineNameText,
                    prompt: rawPrompt,
                    resolvedPrompt: basePrompt,
                    rounds,
                    finalOutputs,
                    pipelineConfig: runConfig
                };

                await handlePipelineOutputs(result, runSnapshot.outputSelection);
                await notifyPipelineControlState('COMPLETED', {
                    stage: 'complete',
                    payload: { finalOutputs: Object.keys(finalOutputs).length }
                });

                if (newPagesCheckbox && newPagesCheckbox.checked) {
                    newPagesCheckbox.checked = false;
                    storeNewPagesState(false);
                }
            } catch (err) {
                if (err?.name === 'AbortError') {
                    await notifyPipelineControlState('CANCELLED', {
                        stage: 'cancelled',
                        reason: 'abort_error'
                    });
                    showNotification('Pipeline: cancelled', 'warn');
                    return;
                }
                await notifyPipelineControlState('FAILED', {
                    stage: 'failed',
                    reason: err?.message || String(err)
                });
                console.error('[RESULTS] Pipeline run failed', err);
                showNotification(`Pipeline: error (${err?.message || String(err)})`, 'error');
            } finally {
                if (debateFeedState.pendingApproval) {
                    setDebateApprovalCandidate(null);
                }
                cleanupDebateApprovalWaiter();
                debateRunState.activeRole = '';
                debateRunState.status = 'idle';
                debateRunState.pauseReason = '';
                debatePaused = false;
                pipelineRunActive = false;
                activePipelineAbortController = null;
                activePipelineRunContext = null;
                pipelineWaiter.reset();
                setPipelineEditingEnabled(true);
                setPipelineRunUi(false);
                updateDebateButtonsUi();
            }
        };
        const cancelPipelineRun = async () => {
            if (!pipelineRunActive) return false;
            await notifyPipelineControlState('CANCELLED', {
                stage: 'cancelled',
                reason: 'user_cancel'
            });
            activePipelineAbortController?.abort();
            pipelineWaiter.reset();
            rejectDebateApproval(new DOMException('Pipeline run cancelled', 'AbortError'));
            try {
                await sendToBackground({
                    type: 'CANCEL_PIPELINE_RUN',
                    pipelineRunId: activePipelineRunContext?.pipelineRunId || null
                });
            } catch (err) {
                try {
                    await sendToBackground({ type: 'STOP_ALL' });
                } catch (fallbackErr) {
                    console.warn('[RESULTS] Pipeline cancel background cleanup failed', fallbackErr || err);
                }
            }
            sendToBackground({
                type: 'CANCEL_DEBATE',
                reason: 'pipeline_cancel',
                sessionId: activePipelineRunContext?.sessionId || debateTabsState?.activeSessionId || '1'
            }).catch((err) => {
                console.warn('[RESULTS] Debate background cancel sync failed', err);
            });
            return true;
        };
        window.runPipeline = runPipeline;
        window.cancelPipelineRun = cancelPipelineRun;
        if (
            (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'test')
            || (typeof window !== 'undefined' && window.__RESULTS_TEST_DEBUG__ === true)
        ) {
            window.__pipelineLifecycleDebug = {
                pipelineWaiter,
                isTerminalPipelineMessage,
                makePipelineBatchId,
                waitForDebateApproval,
                resolveDebateApproval,
                rejectDebateApproval,
                cleanupDebateApprovalWaiter,
                cancelPipelineRun,
                getPipelineOutputSelection,
                buildPipelineRuntimeSnapshot,
                setR1ModelsFromSelectedLLMs,
                isR1DefaultSelection,
                syncDebateCardOutputLayout,
                setDebateCardExpanded,
                safePipelineMarkdownToHtml,
                getDebateRunPolicy,
                collectDebateArtifact,
                collectDebateMarkdown,
                hydrateDebateTranscriptFromArtifact,
                renderDebateTranscriptSession,
                loadDebateTranscriptFromStorage,
                getDebateTranscriptStore: () => debateTranscriptStore,
                getApprovalWaiting: () => typeof debateApprovalResolver === 'function'
            };
        }
        triggerPipelineRun = (event) => {
            if (event) {
                event.preventDefault();
                event.stopImmediatePropagation?.();
                event.stopPropagation();
            }
            const now = Date.now();
            if (now - lastPipelineTriggerAt < 500) return;
            lastPipelineTriggerAt = now;
            const runFn = (typeof runPipeline === 'function')
                ? runPipeline
                : (typeof window.runPipeline === 'function' ? window.runPipeline : null);
            if (!runFn) {
                showNotification('Pipeline run is unavailable', 'error');
                return;
            }
            console.log('[RESULTS] Pipeline trigger clicked', {
                source: event?.currentTarget?.id || event?.target?.id || 'unknown'
            });
            runFn();
        };

        const resetPipeline = () => {
            if (confirm('Reset to default?')) {
                location.reload();
            }
        };

        const addRound = () => {
            if (!insertionPoint) return;

            if (roundCounter === 1) {
                roundCounter = 2;
                const judgeBlocksHtml = buildModelBlocksHtml(DEFAULT_JUDGE_INDICES, true);
                const newRoundHTML = `
                    <div class="connector-group" data-round="2">
                        <svg class="connector-svg" id="svg-r1-r2"></svg>
                    </div>
                    <div class="stage-column" id="round2" data-round="2">
                        <div class="stage-label"><span class="round-badge">R2</span> Judge</div>
                        <div class="model-stack" id="r2-models">
                            ${judgeBlocksHtml}
                        </div>
                    </div>
                `;

                insertionPoint.insertAdjacentHTML('beforebegin', newRoundHTML);
            } else {
                const currentLastJudge = roundCounter;
                roundCounter++;

                const judgeBlocksHtml = buildModelBlocksHtml(DEFAULT_LATE_JUDGE_INDICES, true);
                const newRoundHTML = `
                    <div class="connector-group" data-round="${roundCounter}">
                        <svg class="connector-svg" id="svg-r${currentLastJudge}-r${roundCounter}"></svg>
                    </div>
                    <div class="stage-column" id="round${roundCounter}" data-round="${roundCounter}">
                        <div class="stage-label"><span class="round-badge">R${roundCounter}</span> Judge</div>
                        <div class="model-stack" id="r${roundCounter}-models">
                            ${judgeBlocksHtml}
                        </div>
                    </div>
                `;

                insertionPoint.insertAdjacentHTML('beforebegin', newRoundHTML);
            }

            if (pipelineRemoveRoundBtn) {
                pipelineRemoveRoundBtn.style.display = 'flex';
            }
            updatePipelineAll();
        };

        const removeLastRound = () => {
            if (roundCounter <= 1) return;

            pipelinePanel.querySelectorAll(`[data-round="${roundCounter}"]`).forEach((el) => el.remove());
            roundCounter--;
            if (roundCounter <= 1 && pipelineRemoveRoundBtn) {
                pipelineRemoveRoundBtn.style.display = 'none';
            }

            updatePipelineAll();
        };

        const applyPipelineConfig = (config = {}) => {
            if (!config || typeof config !== 'object') return;
            pipelineApplyingConfig = true;
            const targetRounds = Math.max(1, Number(config.roundCounter) || 1);
            while (roundCounter > targetRounds) {
                removeLastRound();
            }
            while (roundCounter < targetRounds) {
                addRound();
            }

            const modelStacks = config.modelStacks && typeof config.modelStacks === 'object' ? config.modelStacks : {};
            const sendOverrides = config.version >= 2 ? null : buildSendOverridesFromLegacy(config);
            Object.entries(modelStacks).forEach(([stackId, state]) => {
                applyModelStackState(stackId, state, sendOverrides);
            });

            if (config.outputStack) {
                applyOutputStackState('output-stack', config.outputStack);
            }

            pipelineApplyingConfig = false;
            pipelineR1ManualDirty = !!modelStacks['r1-models'];
            updatePipelineAll();
        };

        const applyPipelineByName = (name) => {
            if (!name) return;
            const config = pipelineStore.pipelines[name];
            if (config) {
                applyPipelineConfig(config);
            }
        };

        const findPipelineItemByName = (name) => {
            if (!pipelineItems || !name) return null;
            return Array.from(pipelineItems.querySelectorAll('.pipeline-item'))
                .find((item) => item.dataset.name === name) || null;
        };

        const truncatePipelineName = (name, limit = 15) => {
            const fullName = String(name || '').trim();
            if (!fullName) return { fullName: '', displayName: '' };
            if (fullName.length <= limit) return { fullName, displayName: fullName };
            return { fullName, displayName: `${fullName.slice(0, limit)}...` };
        };

        const buildPipelineItem = (name, options = {}) => {
            const { active = false, isLast = false } = options;
            const { fullName, displayName } = truncatePipelineName(name, 15);
            const item = document.createElement('div');
            item.className = `pipeline-item${active ? ' active' : ''}`;
            item.dataset.name = fullName;
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'pipeline';
            radio.className = 'pipeline-radio';
            if (active) {
                radio.checked = true;
            }
            const label = document.createElement('span');
            label.className = 'pipeline-item-name';
            label.title = fullName;
            label.textContent = displayName;
            item.appendChild(radio);
            item.appendChild(label);
            if (isLast) {
                const badge = document.createElement('span');
                badge.className = 'last-badge';
                badge.textContent = 'last';
                item.appendChild(badge);
            }
            return item;
        };

        const renamePipeline = (oldName, newName) => {
            const trimmedOld = String(oldName || '').trim();
            const trimmedNew = String(newName || '').trim();
            if (!trimmedOld || !trimmedNew) return false;
            if (trimmedOld === trimmedNew) return true;

            const exists = pipelineStore.order.includes(trimmedNew);
            if (exists) {
                const confirmed = confirm(`Pipeline "${trimmedNew}" already exists. Replace it?`);
                if (!confirmed) return false;
            }

            const hasOldConfig = Object.prototype.hasOwnProperty.call(pipelineStore.pipelines, trimmedOld);
            const hasNewConfig = Object.prototype.hasOwnProperty.call(pipelineStore.pipelines, trimmedNew);

            if (hasOldConfig) {
                pipelineStore.pipelines[trimmedNew] = pipelineStore.pipelines[trimmedOld];
            } else if (!hasNewConfig && exists) {
                pipelineStore.pipelines[trimmedNew] = pipelineStore.pipelines[trimmedOld];
            }

            if (trimmedOld !== trimmedNew) {
                delete pipelineStore.pipelines[trimmedOld];
            }

            const idx = pipelineStore.order.indexOf(trimmedOld);
            if (idx !== -1) {
                pipelineStore.order[idx] = trimmedNew;
            }
            pipelineStore.order = pipelineStore.order.filter((name, index, list) => list.indexOf(name) === index);

            if (pipelineStore.lastSaved === trimmedOld) pipelineStore.lastSaved = trimmedNew;
            if (pipelineStore.active === trimmedOld) pipelineStore.active = trimmedNew;

            renderPipelineList(pipelineStore.order, pipelineStore.active, pipelineStore.lastSaved);
            persistPipelineStore();
            return true;
        };

        const startPipelineRename = (item) => {
            if (!item || item.classList.contains('is-editing')) return;
            const nameSpan = item.querySelector('.pipeline-item-name');
            if (!nameSpan) return;
            const originalName = item.dataset.name || nameSpan.getAttribute('title') || nameSpan.textContent.trim();
            if (!originalName) return;

            item.classList.add('is-editing');
            nameSpan.style.display = 'none';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pipeline-item-edit';
            input.value = originalName;
            input.setAttribute('aria-label', 'Rename pipeline');

            const lastBadge = item.querySelector('.last-badge');
            if (lastBadge) {
                item.insertBefore(input, lastBadge);
            } else {
                item.appendChild(input);
            }

            input.focus();
            input.select();

            let finished = false;
            const cleanup = () => {
                if (finished) return;
                finished = true;
                input.remove();
                nameSpan.style.display = '';
                item.classList.remove('is-editing');
            };

            const commit = () => {
                if (finished) return;
                const nextName = input.value.trim();
                cleanup();
                if (!nextName || nextName === originalName) return;
                const renamed = renamePipeline(originalName, nextName);
                if (!renamed) {
                    renderPipelineList(pipelineStore.order, pipelineStore.active, pipelineStore.lastSaved);
                }
            };

            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup();
                }
            });
            input.addEventListener('blur', commit);
        };

        const computePipelineHash = (names = [], activeName = '', lastSavedName = '') => {
            const cleanNames = names.filter((name) => typeof name === 'string').map((name) => name.trim());
            return `${cleanNames.join('|')}|${activeName || ''}|${lastSavedName || ''}`;
        };

        const renderPipelineList = (names = [], activeName = '', lastSavedName = '') => {
            if (!pipelineItems) return;
            const uniqueNames = Array.from(new Set(names.filter((name) => typeof name === 'string' && name.trim())));
            const nextHash = computePipelineHash(uniqueNames, activeName, lastSavedName);
            if (pipelineItems.dataset.pipelineHash === nextHash) {
                if (pipelineName) {
                    pipelineName.textContent = activeName || '';
                }
                return;
            }

            // Сборка списка вне DOM для минимальных перерисовок.
            const fragment = document.createDocumentFragment();
            const chunkSize = 12;
            for (let i = 0; i < uniqueNames.length; i += chunkSize) {
                const row = document.createElement('div');
                row.className = 'pipeline-items-row';
                uniqueNames.slice(i, i + chunkSize).forEach((name) => {
                    const item = buildPipelineItem(name, {
                        active: name === activeName,
                        isLast: name === lastSavedName
                    });
                    row.appendChild(item);
                });
                fragment.appendChild(row);
            }
            pipelineItems.replaceChildren(fragment);
            pipelineItems.dataset.pipelineHash = nextHash;
            if (pipelineName) {
                pipelineName.textContent = activeName || '';
            }
        };

        const getPipelineNamesFromDom = () => {
            if (!pipelineItems) return [];
            return Array.from(pipelineItems.querySelectorAll('.pipeline-item'))
                .map((item) => item.dataset.name)
                .filter((name) => typeof name === 'string' && name.trim());
        };

        const addPipelineToList = (name, options = {}) => {
            if (!pipelineItems) return;
            const trimmed = String(name || '').trim();
            if (!trimmed) return;
            const { makeActive = true, markLast = true } = options;
            if (!pipelineStore.order.includes(trimmed)) {
                pipelineStore.order.push(trimmed);
            }
            if (makeActive) {
                pipelineStore.active = trimmed;
            }
            if (markLast) {
                pipelineStore.lastSaved = trimmed;
            }
            renderPipelineList(pipelineStore.order, pipelineStore.active, pipelineStore.lastSaved);
        };

        const selectPipeline = (item, options = {}) => {
            if (!pipelineItems || !item) return;
            pipelineItems.querySelectorAll('.pipeline-item').forEach((el) => el.classList.remove('active'));
            pipelineItems.querySelectorAll('.pipeline-radio').forEach((radio) => {
                radio.checked = false;
            });

            item.classList.add('active');
            const radio = item.querySelector('.pipeline-radio');
            if (radio) radio.checked = true;
            const name = item.dataset.name || '';
            if (pipelineName) {
                pipelineName.textContent = name;
            }
            if (options.applyConfig !== false) {
                applyPipelineByName(name);
            }
            if (options.persist !== false) {
                pipelineStore.active = name;
                persistPipelineStore();
            }
        };

        const resetToMinimalTemplate = () => {
            pipelinePanel.querySelectorAll('[data-round]').forEach((el) => el.remove());

            roundCounter = 1;
            if (pipelineRemoveRoundBtn) {
                pipelineRemoveRoundBtn.style.display = 'none';
            }

            updatePipelineAll();
        };

        const savePipeline = () => {
            const currentName = pipelineName ? pipelineName.textContent : '';
            const name = prompt('Pipeline name:', currentName || '');
            if (name && name.trim()) {
                const trimmed = name.trim();
                const config = capturePipelineConfig();
                pipelineStore.pipelines[trimmed] = config;
                if (!pipelineStore.order.includes(trimmed)) {
                    pipelineStore.order.push(trimmed);
                }
                pipelineStore.lastSaved = trimmed;
                pipelineStore.active = trimmed;
                persistPipelineStore();
                addPipelineToList(trimmed, { makeActive: true, markLast: true });
            }
        };

        const addNewPipeline = () => {
            const name = prompt('New pipeline name:');
            if (name && name.trim()) {
                resetToMinimalTemplate();
                const trimmed = name.trim();
                const config = capturePipelineConfig();
                pipelineStore.pipelines[trimmed] = config;
                if (!pipelineStore.order.includes(trimmed)) {
                    pipelineStore.order.push(trimmed);
                }
                pipelineStore.lastSaved = trimmed;
                pipelineStore.active = trimmed;
                persistPipelineStore();
                addPipelineToList(trimmed, { makeActive: true, markLast: true });
            }
        };

        const deleteActivePipeline = () => {
            const activeName = (pipelineName?.textContent || pipelineStore.active || '').trim();
            if (!activeName) return;
            const confirmed = confirm(`Delete pipeline "${activeName}"?`);
            if (!confirmed) return;

            delete pipelineStore.pipelines[activeName];
            pipelineStore.order = pipelineStore.order.filter((name) => name !== activeName);
            if (pipelineStore.lastSaved === activeName) {
                pipelineStore.lastSaved = '';
            }
            const nextActive = pipelineStore.order[0] || '';
            pipelineStore.active = nextActive;
            persistPipelineStore();

            renderPipelineList(pipelineStore.order, nextActive, pipelineStore.lastSaved);

            if (nextActive) {
                const nextItem = findPipelineItemByName(nextActive);
                if (nextItem) {
                    selectPipeline(nextItem, { applyConfig: !!pipelineStore.pipelines[nextActive], persist: false });
                }
            } else if (pipelineName) {
                pipelineName.textContent = '';
            }
        };

        let pipelineImportInput = null;

        const exportPipelines = () => {
            const payload = buildPipelineExportPayload();
            const json = JSON.stringify(payload, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const link = document.createElement('a');
            link.href = url;
            link.download = `pipelines-${stamp}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        };

        const handlePipelineImportFile = (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(String(reader.result || ''));
                    const normalized = normalizePipelineStore(parsed);
                    const hasExisting = pipelineStore.order.length || Object.keys(pipelineStore.pipelines).length;
                    if (hasExisting) {
                        const confirmed = confirm('Replace existing pipelines with imported data?');
                        if (!confirmed) return;
                    }
                    pipelineStore.version = normalized.version || pipelineStore.version;
                    pipelineStore.pipelines = normalized.pipelines;
                    pipelineStore.order = normalized.order;
                    pipelineStore.lastSaved = normalized.lastSaved;
                    pipelineStore.active = normalized.active;
                    persistPipelineStore();

                    const activeName = pipelineStore.active || pipelineStore.order[0] || '';
                    renderPipelineList(pipelineStore.order, activeName, pipelineStore.lastSaved);
                    if (activeName) {
                        const activeItem = findPipelineItemByName(activeName);
                        if (activeItem) {
                            selectPipeline(activeItem, {
                                applyConfig: !!pipelineStore.pipelines[activeName],
                                persist: false
                            });
                        }
                    } else if (pipelineName) {
                        pipelineName.textContent = '';
                    }
                } catch (_) {
                    alert('Invalid pipelines JSON.');
                }
            };
            reader.readAsText(file);
        };

        const importPipelines = () => {
            if (!pipelineImportInput) {
                pipelineImportInput = document.createElement('input');
                pipelineImportInput.type = 'file';
                pipelineImportInput.accept = 'application/json';
                pipelineImportInput.style.display = 'none';
                pipelineImportInput.addEventListener('change', handlePipelineImportFile);
                document.body.appendChild(pipelineImportInput);
            }
            pipelineImportInput.value = '';
            pipelineImportInput.click();
        };

        const initPipelineList = async () => {
            await readPipelineStore();
            const domNames = getPipelineNamesFromDom();
            if (!pipelineStore.order.length) {
                pipelineStore.order = domNames.slice();
            } else {
                domNames.forEach((name) => {
                    if (!pipelineStore.order.includes(name)) {
                        pipelineStore.order.push(name);
                    }
                });
            }
            const domActive = pipelineItems?.querySelector('.pipeline-item.active')?.dataset.name || '';
            const activeName = pipelineStore.active || domActive || pipelineStore.order[0] || '';
            renderPipelineList(pipelineStore.order, activeName, pipelineStore.lastSaved);
            const activeItem = activeName ? findPipelineItemByName(activeName) : null;
            if (activeItem) {
                selectPipeline(activeItem, {
                    applyConfig: !!pipelineStore.pipelines[activeName],
                    persist: false
                });
                pipelineStore.active = activeName;
            }
            persistPipelineStore();
        };

        pipelinePanel.addEventListener('dblclick', (event) => {
            const label = event.target.closest('.stage-label');
            if (!label || !pipelinePanel.contains(label)) return;
            const labelText = (label.textContent || '').toLowerCase();
            const isModels = labelText.includes('models');
            const isJudge = labelText.includes('judge');
            const isOutput = labelText.includes('output');
            if (!isModels && !isJudge && !isOutput) return;

            let modelStack = null;
            let outputStack = null;
            let topJudgeSelected = false;
            let topJudgePromptId = null;
            let defaultJudgePromptId = null;

            if (isModels || isJudge) {
                const stageColumn = label.closest('.stage-column');
                modelStack = stageColumn ? stageColumn.querySelector('.model-stack') : null;
                if (isJudge && modelStack) {
                    const blocks = Array.from(modelStack.querySelectorAll('.model-block'));
                    const topBlock = blocks[0];
                    topJudgeSelected = !!topBlock?.querySelector('.model-input-checkbox')?.checked;
                    topJudgePromptId = topBlock?.querySelector('.role-selector')?.value || null;
                    defaultJudgePromptId = getCriticalJudgePromptId();
                }
            } else if (isOutput) {
                const stageColumn = label.closest('.stage-column');
                outputStack = stageColumn ? stageColumn.querySelector('.output-stack') : null;
            }

            let shouldCheck = true;
            if (outputStack) {
                shouldCheck = !areAllChecked(outputStack, '.output-checkbox');
            } else if (modelStack) {
                const allInputs = areAllChecked(modelStack, '.model-input-checkbox');
                const allSends = areAllChecked(modelStack, '.model-send-checkbox');
                shouldCheck = !(allInputs && allSends);
            } else {
                return;
            }

            let changed = false;
            if (modelStack) {
                changed = setCheckboxesState(modelStack, '.model-input-checkbox', shouldCheck) || changed;
                changed = setCheckboxesState(modelStack, '.model-send-checkbox', shouldCheck) || changed;
            }
            if (outputStack) {
                changed = setCheckboxesState(outputStack, '.output-checkbox', shouldCheck) || changed;
            }

            if (changed) {
                updatePipelineAll();
                if (isJudge && modelStack && shouldCheck) {
                    const targetPromptId = topJudgeSelected
                        ? (topJudgePromptId || defaultJudgePromptId)
                        : defaultJudgePromptId;
                    if (targetPromptId) {
                        modelStack.querySelectorAll('.role-selector').forEach((selector) => {
                            const hasOption = Array.from(selector.options).some((opt) => opt.value === targetPromptId);
                            if (hasOption) selector.value = targetPromptId;
                        });
                    }
                }
            }
        });

        pipelinePanel.addEventListener('change', (event) => {
            const target = event.target;
            if (!target) return;
            if (
                !pipelineApplyingConfig
                && target.closest?.('#r1-models')
                && target.matches('.model-input-checkbox, .model-send-checkbox')
            ) {
                pipelineR1ManualDirty = true;
            }
            if (target.matches('.model-input-checkbox')) {
                const block = target.closest('.model-block');
                const sendCb = block?.querySelector('.model-send-checkbox');
                if (target.checked && sendCb) {
                    sendCb.checked = true;
                }
            }
            if (target.matches('input[type="checkbox"]') || target.matches('.role-selector')) {
                updatePipelineAll();
            }
        });

        document.addEventListener('llm-selection-change', () => {
            setR1ModelsFromSelectedLLMs();
        });

        pipelineResetBtn?.addEventListener('click', resetPipeline);
        pipelineSaveBtn?.addEventListener('click', savePipeline);
        pipelineDeleteBtn?.addEventListener('click', deleteActivePipeline);
        pipelineExportBtn?.addEventListener('click', exportPipelines);
        pipelineImportBtn?.addEventListener('click', importPipelines);
        pipelineRunBtn?.addEventListener('click', triggerPipelineRun);
        debateRunToggleBtn?.addEventListener('click', (event) => {
            if (debatePaused) {
                event.preventDefault();
                setDebatePausedState(false, 'resume_button');
                return;
            }
            if (pipelineRunActive || debateApprovalResolver) {
                event.preventDefault();
                setDebatePausedState(true, 'pause_button');
                return;
            }
            triggerPipelineRun(event);
        });
        debateMaxTurnsInput?.addEventListener('change', () => {
            debateRunState.maxTurns = getDebateMaxTurns();
        updateDebateButtonsUi();
        loadDebateTranscriptFromStorage().then((restored) => {
            if (restored) {
                syncModeratorSelectors();
                applyDebateSessionFilter();
            }
        });
        });
        debateRunPolicySelect?.addEventListener('change', () => {
            const isAuto = debateRunPolicySelect.value === 'auto';
            if (autoCheckbox && autoCheckbox.checked !== isAuto) {
                autoCheckbox.checked = isAuto;
                autoCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                autoMode = isAuto;
                if (isAuto) {
                    approvePendingDebateCandidate();
                    if (typeof debateApprovalBridge.resolve === 'function') {
                        debateApprovalBridge.resolve();
                    }
                }
                syncDebateAutoPauseButton();
                if (syncAutoToggleState) syncAutoToggleState();
            }
            updateDebateButtonsUi();
            console.log('[RESULTS] Debate run policy:', debateRunPolicySelect.value);
        });
        debateStepBtn?.addEventListener('click', () => {
            if (!debateApprovalResolver) {
                showNotification('No pending moderator approval step.', 'warn');
                return;
            }
            approvePendingDebateCandidate();
            resolveDebateApproval();
        });
        pipelineAddBtn?.addEventListener('click', addNewPipeline);
        pipelineAddRoundBtn?.addEventListener('click', addRound);
        pipelineRemoveRoundBtn?.addEventListener('click', removeLastRound);
        pipelineCloseBtn?.addEventListener('click', startRightSidebarClose);

        pipelineItems?.addEventListener('click', (event) => {
            const item = event.target.closest('.pipeline-item');
            if (!item || !pipelineItems.contains(item)) return;
            selectPipeline(item);
        });

        await initPipelineList();
        updatePipelineAll();
    }

    if (notesTree) {
        const notesClient = globalThis.NotesClient;
        if (!notesClient) {
            console.warn('[results] NotesClient is unavailable');
        } else {
            const scratchConfig = { origin: 'comparator', key: 'scratch', title: 'Comparator Draft' };
            const NOTES_ACTIVE_TAB_KEY = 'notes_active_tab';
            const SESSIONS_STORAGE_KEY = 'llm_saved_sessions_v1';
            const noteCache = new Map();
            const tabCache = new Map();
            const lastActiveByTab = new Map();
            const childrenCache = new Map();
            const loadedChildren = new Set();
            const loadingChildren = new Map();
            const expandedByTab = new Map();
            const sessionsState = {
                sessions: [],
                selectedId: null,
                dragId: null,
                dragOverId: null,
                dragPosition: null,
                isActive: false,
                defaultTitle: notesSidebarTitle?.textContent || 'Notes'
            };
            const sessionPreview = {
                isActive: false,
                text: '',
                capturedAt: 0
            };
            const state = {
                tabId: null,
                defaultTabId: null,
                activeNoteId: null,
                selectedNoteIds: new Set(),
                anchorNoteId: null,
                lastSavedText: '',
                lastSavedHtml: '',
                pendingSave: false,
                refreshInFlight: false,
                saveTimer: null,
                listRefreshing: false,
                tabs: [],
                notes: [],
                searchQuery: '',
                totalNoteIds: [],
                totalNoteIdsKnown: false
            };
            editorState = {
                mode: 'PROMPT',
                noteId: null,
                originalText: '',
                suppressInput: false,
                suppressTitleSync: false,
                isTitleEditing: false
            };
            const defaultStatusText = notesStatus?.textContent || 'Stored locally on this device.';
            let statusTimer = null;
            let searchToken = 0;
            let listRefreshPending = false;
            let childrenPrefetchTimer = null;
            let childrenPrefetchToken = 0;
            let notesClickTimer = null;
            let notesClickTargetId = null;
            let notesClickTime = 0;
            const NOTE_DBLCLICK_DELAY = 320;

            const setStatus = (message, ttl = 1600) => {
                if (!notesStatus) return;
                if (statusTimer) clearTimeout(statusTimer);
                notesStatus.textContent = message || defaultStatusText;
                if (message) {
                    statusTimer = setTimeout(() => {
                        notesStatus.textContent = defaultStatusText;
                    }, ttl);
                }
            };

            const formatStatusError = (prefix, error) => {
                const message = String(error?.message || '').trim();
                if (!message) return prefix;
                const compact = message.length > 140 ? `${message.slice(0, 140).trim()}...` : message;
                return `${prefix}: ${compact}`;
            };

            const syncPromptValue = (value, { dispatch = false } = {}) => {
                if (!promptInput) return;
                promptInput.value = String(value || '');
                if (dispatch) {
                    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            };

            const getNoteViewHtml = () => {
                if (!promptNoteView) return '';
                return sanitizeInlineHtml(promptNoteView.innerHTML || '').trim();
            };

            const getNoteViewText = (html) => {
                if (html) return plainTextFromHtml(html);
                if (!promptNoteView) return '';
                return String(promptNoteView.innerText || promptNoteView.textContent || '').trim();
            };

            const updateNoteHtmlTitle = (html, title) => {
                if (!html) return '';
                const doc = parseHtmlDocument(html, { sanitize: true });
                const container = doc.body || doc.documentElement;
                if (!container) return '';
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode: (node) =>
                            String(node?.nodeValue || '').trim()
                                ? NodeFilter.FILTER_ACCEPT
                                : NodeFilter.FILTER_SKIP
                    }
                );
                const firstText = walker.nextNode();
                if (firstText) {
                    firstText.nodeValue = title;
                } else {
                    container.insertAdjacentText('afterbegin', title);
                }
                return sanitizeInlineHtml(container.innerHTML || '').trim();
            };

            const setNoteViewContent = ({ text = '', html = '', textOverride = null } = {}) => {
                if (!promptNoteView) return;
                const sanitizedHtml = sanitizeInlineHtml(html).trim();
                editorState.suppressInput = true;
                if (sanitizedHtml) {
                    replaceChildrenFromHtml(promptNoteView, sanitizedHtml);
                } else {
                    promptNoteView.textContent = String(text || '');
                }
                editorState.suppressInput = false;
                const htmlSnapshot = getNoteViewHtml();
                const resolvedText = typeof textOverride === 'string'
                    ? textOverride
                    : getNoteViewText(htmlSnapshot);
                syncPromptValue(resolvedText);
                state.lastSavedText = resolvedText;
                state.lastSavedHtml = htmlSnapshot;
            };

            const shouldShowRichPrompt = () => editorState.mode !== 'PROMPT' || useInputRichMode;

            const isPromptRichEditable = () =>
                editorState.mode === 'EDITING' || (editorState.mode === 'PROMPT' && useInputRichMode);

            const getEditorContent = () => {
                if (shouldShowRichPrompt() && promptNoteView) {
                    const html = getNoteViewHtml();
                    const text = getNoteViewText(html);
                    return { text, html };
                }
                return { text: promptInput ? String(promptInput.value || '') : '', html: '' };
            };

            const getEditorValue = () => getEditorContent().text;

            const setEditorValue = (value) => {
                if (!promptInput) return;
                const nextValue = typeof value === 'string' ? value : '';
                editorState.suppressInput = true;
                setPromptContent(nextValue);
                editorState.suppressInput = false;
                state.lastSavedText = nextValue;
            };

            const promptDraft = {
                text: '',
                wasEmpty: true,
                capturedAt: 0
            };

            const capturePromptDraft = () => {
                if (!promptInput) return;
                if (editorState.mode !== 'PROMPT') return;
                const currentText = getEditorValue();
                promptDraft.text = currentText;
                promptDraft.wasEmpty = currentText.trim() === '';
                promptDraft.capturedAt = Date.now();
            };

            const restorePromptDraft = () => {
                if (!promptInput) return false;
                if (promptDraft.wasEmpty) return false;
                setEditorValue(promptDraft.text);
                if (typeof syncRichViewFromPrompt === 'function' && useInputRichMode) {
                    syncRichViewFromPrompt();
                }
                return true;
            };

            const updatePromptViewMode = () => {
                if (promptContainer) {
                    promptContainer.classList.toggle('is-note-editing', editorState.mode === 'EDITING');
                    promptContainer.classList.toggle('is-note-viewing', shouldShowRichPrompt());
                }
                if (promptNoteView) {
                    const isEditable = isPromptRichEditable();
                    promptNoteView.setAttribute('contenteditable', isEditable ? 'true' : 'false');
                    promptNoteView.setAttribute('aria-readonly', isEditable ? 'false' : 'true');
                }
            };

            const setEditorMode = (mode, { noteId = null, originalText = '' } = {}) => {
                editorState.mode = mode;
                editorState.noteId = noteId;
                editorState.originalText = originalText;
                editorState.suppressTitleSync = false;
                editorState.isTitleEditing = false;
                updatePromptViewMode();
                if (promptNoteView && mode === 'EDITING') {
                    requestAnimationFrame(() => {
                        promptNoteView.focus();
                    });
                }
                syncSelectionStyles();
            };

            syncPromptViewMode = updatePromptViewMode;
            setPromptEditorMode = setEditorMode;
            syncRichViewFromPrompt = () => {
                if (!promptInput || !promptNoteView) return;
                const promptText = String(promptInput.value || '');
                const existingHtml = getNoteViewHtml();
                if (existingHtml) {
                    const existingText = getNoteViewText(existingHtml);
                    if (existingText === promptText) return;
                }
                setNoteViewContent({ text: promptText, html: '' });
            };
            syncPromptFromRichView = () => {
                if (!promptInput || !promptNoteView) return;
                const html = getNoteViewHtml();
                const text = getNoteViewText(html);
                syncPromptValue(text, { dispatch: true });
            };
            applyRichInputContent = ({ text = '', html = '', textOverride = null } = {}) => {
                if (!promptNoteView) return false;
                setNoteViewContent({ text, html, textOverride });
                return true;
            };
            updatePromptViewMode();
            if (useInputRichMode) {
                syncRichViewFromPrompt();
            }

            const buildNoteTitleFromText = (text, fallback = 'New') => {
                const value = String(text || '').trim();
                if (!value) return fallback;
                const firstLine = value.split(/\n/)[0].trim();
                return firstLine || fallback;
            };

            const normalizeNoteTitle = (value) => String(value || '').replace(/\s+/g, ' ').trim();

            const buildTextWithTitle = (text, title) => {
                const safeTitle = normalizeNoteTitle(title);
                const baseText = String(text || '');
                if (!safeTitle) return baseText;
                if (!baseText) return safeTitle;
                const lines = baseText.split(/\r?\n/);
                if (!lines.length) return safeTitle;
                if (lines[0] === safeTitle) return baseText;
                lines[0] = safeTitle;
                return lines.join('\n');
            };

            const getEditableTitleTarget = (target) => {
                const baseEl = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
                const titleEl = baseEl?.closest?.('.notes-tree-title') || null;
                if (!titleEl || !titleEl.isContentEditable) return null;
                return titleEl;
            };

            const updateEditingTitle = (text) => {
                if (!notesTree || editorState.mode !== 'EDITING' || !editorState.noteId) return;
                const fallback = noteCache.get(editorState.noteId)?.title || 'New';
                const nextTitle = buildNoteTitleFromText(text, fallback);
                const titleEl = notesTree.querySelector(`.notes-tree-item[data-note-id="${editorState.noteId}"] .notes-tree-title`);
                if (titleEl && titleEl.isContentEditable && document.activeElement === titleEl) return;
                if (titleEl) titleEl.textContent = nextTitle;
            };

            const restoreEditingTitle = () => {
                if (!notesTree || !editorState.noteId) return;
                const savedTitle = noteCache.get(editorState.noteId)?.title || 'New';
                const titleEl = notesTree.querySelector(`.notes-tree-item[data-note-id="${editorState.noteId}"] .notes-tree-title`);
                if (titleEl) titleEl.textContent = savedTitle;
            };

            const clearNoteSelection = () => {
                state.activeNoteId = null;
                state.anchorNoteId = null;
                state.selectedNoteIds.clear();
                syncSelectionStyles();
                setActiveTitle(null);
            };

            const exitNotesMode = async () => {
                if (editorState.mode === 'PROMPT') return;
                if (editorState.mode === 'EDITING') {
                    if (!shouldAutosaveContent(getEditorContent())) {
                        restoreEditingTitle();
                    }
                    await flushSave();
                }
                setEditorMode('PROMPT');
                const restored = restorePromptDraft();
                if (!restored) {
                    state.lastSavedText = getEditorValue();
                }
                clearNoteSelection();
            };

            const getExpandedSet = () => {
                if (!state.tabId) return new Set();
                if (!expandedByTab.has(state.tabId)) {
                    expandedByTab.set(state.tabId, new Set());
                }
                return expandedByTab.get(state.tabId);
            };

            const isExpanded = (noteId) => getExpandedSet().has(noteId);

            const setExpanded = (noteId, expanded) => {
                if (!state.tabId) return;
                const set = getExpandedSet();
                if (expanded) {
                    set.add(noteId);
                } else {
                    set.delete(noteId);
                }
            };

            const clearChildrenCache = () => {
                childrenCache.clear();
                loadedChildren.clear();
                loadingChildren.clear();
                state.totalNoteIds = [];
                state.totalNoteIdsKnown = false;
            };

            const buildAllNotesMap = async () => {
                await ensureSearchTreeLoaded();
                const map = new Map();
                const visit = (list = []) => {
                    list.forEach((note) => {
                        if (!note || map.has(note.id)) return;
                        map.set(note.id, note);
                        const children = childrenCache.get(note.id) || [];
                        if (children.length) visit(children);
                    });
                };
                visit(state.notes || []);
                state.totalNoteIds = Array.from(map.keys());
                state.totalNoteIdsKnown = true;
                return map;
            };

            const getAllNoteIds = async () => {
                const map = await buildAllNotesMap();
                return Array.from(map.keys());
            };

            const syncSelectAllIndicator = async () => {
                if (!notesSelectAll) return;
                let total = state.totalNoteIdsKnown ? state.totalNoteIds.length : 0;
                const selectedCount = state.selectedNoteIds.size;
                if (!state.totalNoteIdsKnown) {
                    notesSelectAll.checked = false;
                    notesSelectAll.indeterminate = selectedCount > 0;
                    return;
                }
                notesSelectAll.checked = total > 0 && selectedCount === total;
                notesSelectAll.indeterminate = selectedCount > 0 && selectedCount < total;
            };

            const fetchChildren = async (noteId) => {
                if (!noteId || !state.tabId) return [];
                if (loadedChildren.has(noteId)) {
                    return childrenCache.get(noteId) || [];
                }
                if (loadingChildren.has(noteId)) {
                    return loadingChildren.get(noteId);
                }
                const promise = notesClient
                    .listChildren({ tabId: state.tabId, parentId: noteId })
                    .then((result) => {
                        const notes = result?.notes || [];
                        childrenCache.set(noteId, notes);
                        loadedChildren.add(noteId);
                        loadingChildren.delete(noteId);
                        return notes;
                    })
                    .catch((error) => {
                        console.warn('[results] failed to load children', error);
                        loadingChildren.delete(noteId);
                        return [];
                    });
                loadingChildren.set(noteId, promise);
                return promise;
            };

            const scheduleChildrenPrefetch = () => {
                if (childrenPrefetchTimer) return;
                childrenPrefetchTimer = setTimeout(async () => {
                    childrenPrefetchTimer = null;
                    if (!notesTree || !state.tabId) return;
                    const ids = Array.from(notesTree.querySelectorAll('.notes-tree-item'))
                        .map((item) => item.dataset.noteId)
                        .filter(Boolean);
                    const pending = ids.filter((id) => !loadedChildren.has(id) && !loadingChildren.has(id));
                    if (!pending.length) return;
                    const token = ++childrenPrefetchToken;
                    await Promise.all(pending.map((id) => fetchChildren(id)));
                    if (token !== childrenPrefetchToken) return;
                    renderNotesList(state.notes);
                }, 0);
            };

            const isDescendantNote = (noteId, ancestorId) => {
                if (!noteId || !ancestorId || noteId === ancestorId) return false;
                let current = noteCache.get(noteId);
                let guard = 0;
                while (current && current.parentId && guard < 50) {
                    if (current.parentId === ancestorId) return true;
                    current = noteCache.get(current.parentId);
                    guard += 1;
                }
                return false;
            };

            const getTabLabel = (tab, index) => {
                const name = String(tab?.name || '').trim();
                if (name) return name;
                return index === 0 ? 'Home' : `Tab ${index + 1}`;
            };

            const persistActiveNotesTab = () => {
                if (!state.tabId || !chrome?.storage?.local?.set) return;
                const index = state.tabs.findIndex((tab) => tab.tabId === state.tabId);
                const tab = tabCache.get(state.tabId) || state.tabs[index];
                const name = tab ? getTabLabel(tab, index >= 0 ? index : 0) : 'Home';
                try {
                    chrome.storage.local.set({
                        [NOTES_ACTIVE_TAB_KEY]: {
                            tabId: state.tabId,
                            name,
                            updatedAt: Date.now()
                        }
                    });
                } catch (error) {
                    console.warn('[results] failed to persist active tab', error);
                }
            };

            const renderTabs = (tabs = []) => {
                if (!notesTabs) return;
                tabCache.clear();
                tabs.forEach((tab) => tabCache.set(tab.tabId, tab));
                const fallbackTabId = state.tabId || state.defaultTabId;
                if (!tabs.length && fallbackTabId) {
                    replaceChildrenFromHtml(
                        notesTabs,
                        `<button type="button" class="notes-tab is-active" data-tab-id="${escapeHtml(fallbackTabId)}" role="tab" aria-selected="true"><span class="notes-tab-label">Home</span></button>`
                    );
                } else {
                    const canClose = tabs.length > 1;
                    const tabsHtml = tabs
                        .map((tab, index) => {
                            const label = escapeHtml(getTabLabel(tab, index));
                            const isActive = tab.tabId === state.tabId;
                            const closeIcon = canClose
                                ? '<span class="notes-tab-close" data-action="close" aria-label="Close tab" title="Close tab">×</span>'
                                : '';
                            return `<button type="button" class="notes-tab${isActive ? ' is-active' : ''}" data-tab-id="${escapeHtml(tab.tabId)}" role="tab" aria-selected="${isActive ? 'true' : 'false'}"><span class="notes-tab-label">${label}</span>${closeIcon}</button>`;
                        })
                        .join('');
                    replaceChildrenFromHtml(notesTabs, tabsHtml);
                }
                notesTabs.querySelectorAll('.notes-tab').forEach((btn) => {
                    const tabId = btn.dataset.tabId;
                    if (!tabId) return;
                    btn.addEventListener('click', () => selectTab(tabId));
                    btn.addEventListener('dblclick', (event) => {
                        event.preventDefault();
                        startRenameTab(btn);
                    });
                });
                notesTabs.querySelectorAll('.notes-tab-close').forEach((btn) => {
                    const handleClose = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const tabId = btn.closest('.notes-tab')?.dataset?.tabId;
                        if (!tabId) return;
                        closeTab(tabId);
                    };
                    btn.addEventListener('pointerdown', handleClose);
                    btn.addEventListener('dblclick', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    });
                });
            };

            const refreshTabs = async () => {
                try {
                    const result = await notesClient.listTabs();
                    const nextTabs = result?.tabs || [];
                    if (nextTabs.length || !state.tabs.length) {
                        state.tabs = nextTabs;
                    }
                    renderTabs(state.tabs);
                    return state.tabs;
                } catch (error) {
                    console.warn('[results] failed to refresh tabs', error);
                    renderTabs(state.tabs);
                    return state.tabs;
                }
            };

            const pruneEmptyTabs = async () => {
                if (!notesClient?.deleteTab) return false;
                if (state.tabs.length <= 1) return false;
                const keepTabId = state.defaultTabId || state.tabs[0]?.tabId;
                const emptyTabIds = [];

                for (const tab of state.tabs) {
                    if (!tab?.tabId || tab.tabId === keepTabId) continue;
                    try {
                        const result = await notesClient.listChildren({
                            tabId: tab.tabId,
                            parentId: null
                        });
                        const notes = result?.notes || [];
                        if (!notes.length) {
                            emptyTabIds.push(tab.tabId);
                        }
                    } catch (error) {
                        console.warn('[results] failed to inspect tab', error);
                    }
                }

                if (!emptyTabIds.length) return false;
                for (const tabId of emptyTabIds) {
                    try {
                        await notesClient.deleteTab({ tabId });
                    } catch (error) {
                        console.warn('[results] failed to delete empty tab', error);
                    }
                }
                await refreshTabs();
                return true;
            };

            const startRenameTab = (button) => {
                const tabId = button?.dataset?.tabId;
                if (!tabId || button.querySelector('.notes-tab-input')) return;
                const tab = tabCache.get(tabId);
                const labelEl = button.querySelector('.notes-tab-label');
                const closeEl = button.querySelector('.notes-tab-close');
                const currentLabel = String(tab?.name || labelEl?.textContent || button.textContent || '').trim();
                const input = document.createElement('input');
                input.className = 'notes-tab-input';
                input.value = currentLabel || 'Tab';
                input.setAttribute('aria-label', 'Rename tab');
                button.classList.add('is-close-visible');
                if (labelEl) {
                    labelEl.replaceWith(input);
                } else {
                    clearNode(button);
                    button.appendChild(input);
                    if (closeEl) button.appendChild(closeEl);
                }
                input.focus();
                input.select();

                const finish = async (commit) => {
                    if (!button.contains(input)) return;
                    const nextName = String(input.value || '').trim();
                    const shouldCommit = commit && nextName && nextName !== currentLabel;
                    const label = document.createElement('span');
                    label.className = 'notes-tab-label';
                    label.textContent = shouldCommit ? nextName : (currentLabel || 'Tab');
                    input.replaceWith(label);
                    if (closeEl && !button.contains(closeEl)) {
                        button.appendChild(closeEl);
                    }
                    button.classList.remove('is-close-visible');
                    if (!shouldCommit) {
                        renderTabs(state.tabs);
                        return;
                    }
                    try {
                        await notesClient.renameTab({ tabId, name: nextName });
                        await refreshTabs();
                        if (tabId === state.tabId) {
                            persistActiveNotesTab();
                        }
                        setStatus('Tab renamed');
                    } catch (error) {
                        console.warn('[results] failed to rename tab', error);
                        setStatus('Rename failed');
                        renderTabs(state.tabs);
                    }
                };

                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        finish(true);
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        finish(false);
                    }
                });
                input.addEventListener('blur', () => finish(true));
            };

            const createTab = async () => {
                if (!state.tabId) {
                    const ready = await ensureNotesReady();
                    if (!ready) {
                        setStatus('Notes offline');
                        return;
                    }
                }
                try {
                    const existing = new Set(state.tabs.map((tab) => tab.name));
                    let idx = 1;
                    let name = `Tab ${idx}`;
                    while (existing.has(name)) {
                        idx += 1;
                        name = `Tab ${idx}`;
                    }
                    const created = await notesClient.createTab({ name });
                    await refreshTabs();
                    if (created?.tab?.tabId) {
                        await selectTab(created.tab.tabId);
                        setStatus('Tab created');
                    }
                } catch (error) {
                    console.warn('[results] failed to create tab', error);
                    setStatus('Create failed');
                }
            };

            const closeTab = async (tabId) => {
                if (!tabId) return;
                if (!notesClient?.deleteTab) {
                    setStatus('Close unavailable');
                    return;
                }
                if (state.tabs.length <= 1) {
                    setStatus('Cannot delete last tab');
                    return;
                }
                const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
                const tab = tabCache.get(tabId) || state.tabs[index];
                const wasActive = tabId === state.tabId;
                try {
                    if (wasActive) {
                        await flushSave();
                        state.tabId = null;
                        state.activeNoteId = null;
                    }
                    await notesClient.deleteTab({ tabId });
                    lastActiveByTab.delete(tabId);
                    expandedByTab.delete(tabId);
                    if (tabId === state.defaultTabId) {
                        state.defaultTabId = null;
                    }
                    await refreshTabs();
                    if (!state.defaultTabId && state.tabs.length) {
                        state.defaultTabId = state.tabs[0].tabId;
                    }
                    if (wasActive) {
                        const nextTabId = state.tabs[0]?.tabId || state.defaultTabId || null;
                        if (nextTabId) {
                            await selectTab(nextTabId);
                        } else {
                            renderTabs(state.tabs);
                            renderNotesList([]);
                            setTextareaValue('');
                            setEditorEnabled(false);
                        }
                    }
                    setStatus('Tab closed');
                } catch (error) {
                    console.warn('[results] failed to delete tab', error);
                    setStatus('Close failed');
                }
            };

            const selectTab = async (tabId) => {
                if (!tabId) return;
                if (sessionPreview.isActive) {
                    restoreSessionPreview();
                }
                if (tabId === state.tabId && !sessionsState.isActive) return;
                setSessionsActive(false);
                if (tabId === state.tabId) {
                    renderTabs(state.tabs);
                    return;
                }
                if (state.tabId) {
                    lastActiveByTab.set(state.tabId, state.activeNoteId);
                }
                await flushSave();
                state.tabId = tabId;
                state.activeNoteId = lastActiveByTab.get(tabId) || null;
                renderTabs(state.tabs);
                persistActiveNotesTab();
                await refreshNotesList();
            };

            const APP_VERSION = '2.71.24';
            const BACKUP_FILE_PREFIX = 'codex-notes-sessions';
            const buildBackupFilename = () => {
                const timestamp = formatTimestamp(new Date()).replace(/[: ]/g, '_');
                return `${BACKUP_FILE_PREFIX}-${timestamp}.json`;
            };
            const downloadJson = (payload, filename) => {
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = filename;
                anchor.style.display = 'none';
                document.body.appendChild(anchor);
                anchor.click();
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    anchor.remove();
                }, 400);
            };
            const readFileAsText = (file) => new Promise((resolve, reject) => {
                if (!file) {
                    reject(new Error('No file provided'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
                reader.readAsText(file);
            });
            const pickBackupFile = () => new Promise((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/json';
                input.style.position = 'fixed';
                input.style.opacity = '0';
                input.style.pointerEvents = 'none';
                let settled = false;
                const finalize = (file) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(file);
                };
                const cleanup = () => {
                    window.removeEventListener('focus', handleWindowFocus);
                    if (input.parentNode) {
                        input.parentNode.removeChild(input);
                    }
                };
                const handleWindowFocus = () => {
                    if (!settled) {
                        finalize(null);
                    }
                };
                input.addEventListener('change', () => finalize(input.files?.[0] || null));
                window.addEventListener('focus', handleWindowFocus);
                document.body.appendChild(input);
                input.click();
            });
            const gatherBackupPayload = async () => {
                if (!notesClient?.exportBackup) {
                    throw new Error('Notes offline');
                }
                const notesData = await notesClient.exportBackup();
                const sanitizedSessions = sessionsState.sessions.map((session) => ({
                    id: session.id,
                    name: session.name,
                    urls: Array.isArray(session.urls) ? [...session.urls] : [],
                    createdAt: session.createdAt,
                    updatedAt: session.updatedAt
                }));
                return {
                    metadata: {
                        appVersion: APP_VERSION,
                        exportedAt: new Date().toISOString(),
                        tabs: Array.isArray(notesData?.tabs) ? notesData.tabs.length : 0,
                        sessions: sanitizedSessions.length
                    },
                    notes: notesData,
                    sessions: sanitizedSessions
                };
            };
            const exportBackup = async () => {
                if (!notesClient?.exportBackup) {
                    setStatus('Notes offline');
                    return;
                }
                setStatus('Preparing backup...');
                try {
                    const payload = await gatherBackupPayload();
                    const filename = buildBackupFilename();
                    downloadJson(payload, filename);
                    setStatus('Export ready', 2600);
                } catch (error) {
                    console.warn('[results] backup export failed', error);
                    setStatus(formatStatusError('Export failed', error), 3600);
                }
            };
            const importBackup = async () => {
                if (!notesClient?.importBackup) {
                    setStatus('Notes offline');
                    return;
                }
                const confirmed = window.confirm(
                    'Import will replace stored notes and saved sessions. Continue?'
                );
                if (!confirmed) {
                    return;
                }
                const file = await pickBackupFile();
                if (!file) {
                    setStatus('Import cancelled');
                    return;
                }
                setStatus('Importing backup...');
                try {
                    const text = await readFileAsText(file);
                    const parsed = JSON.parse(text);
                    if (!parsed || typeof parsed !== 'object' || !parsed.notes) {
                        throw new Error('Invalid backup file');
                    }
                    await notesClient.importBackup({ payload: parsed.notes });
                    const incomingSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
                    const normalizedSessions = incomingSessions
                        .map(normalizeSession)
                        .filter(Boolean);
                    sessionsState.sessions = normalizedSessions;
                    sessionsState.selectedId = normalizedSessions[0]?.id || null;
                    await persistSessions();
                    renderSessionsList();
                    await refreshTabs();
                    if (state.tabs.length) {
                        await selectTab(state.tabs[0].tabId);
                    } else {
                        renderTabs([]);
                        renderNotesList([]);
                        setTextareaValue('');
                        setEditorEnabled(false);
                    }
                    setStatus('Backup imported', 3600);
                } catch (error) {
                    console.warn('[results] backup import failed', error);
                    setStatus(formatStatusError('Import failed', error), 3600);
                }
            };

            const ensureSearchTreeLoaded = async () => {
                const queue = [...(state.notes || [])];
                const visited = new Set();
                while (queue.length) {
                    const note = queue.shift();
                    if (!note || visited.has(note.id)) continue;
                    visited.add(note.id);
                    const children = await fetchChildren(note.id);
                    if (children && children.length) {
                        queue.push(...children);
                    }
                }
            };

            const hydrateExpandedTree = async () => {
                const expandedSet = getExpandedSet();
                if (!expandedSet.size) return;
                const queue = Array.from(expandedSet);
                const visited = new Set();
                while (queue.length) {
                    const noteId = queue.shift();
                    if (!noteId || visited.has(noteId)) continue;
                    visited.add(noteId);
                    const children = await fetchChildren(noteId);
                    children.forEach((child) => {
                        if (expandedSet.has(child.id)) {
                            queue.push(child.id);
                        }
                    });
                }
            };

            const setSearchQuery = async (value) => {
                state.searchQuery = String(value || '').trim().toLowerCase();
                if (!state.searchQuery) {
                    renderNotesList(state.notes);
                    return;
                }
                const token = ++searchToken;
                await ensureSearchTreeLoaded();
                if (token !== searchToken) return;
                renderNotesList(state.notes);
            };

            const setEditorEnabled = (enabled) => {
                if (notesTextarea) {
                    notesTextarea.disabled = !enabled;
                    notesTextarea.placeholder = enabled ? 'Write notes...' : 'Create a note to start.';
                }
                if (notesPanel) {
                    notesPanel.classList.toggle('is-editor-hidden', !enabled);
                }
            };

            const syncSelectionStyles = () => {
                if (!notesTree) return;
                notesTree.querySelectorAll('.notes-tree-item').forEach((item) => {
                    const noteId = item.dataset.noteId;
                    const selected = noteId && state.selectedNoteIds.has(noteId);
                    const isActive = noteId === state.activeNoteId;
                    const isEditing = editorState.mode === 'EDITING' && noteId === editorState.noteId;
                    const titleEl = item.querySelector('.notes-tree-title');
                    item.classList.toggle('is-selected', !!selected);
                    item.classList.toggle('is-active', !!isActive);
                    item.classList.toggle('is-editing', !!isEditing);
                    item.setAttribute('aria-selected', selected ? 'true' : 'false');
                    item.setAttribute('tabindex', isActive ? '0' : '-1');
                    if (titleEl) {
                        if (isEditing) {
                            titleEl.setAttribute('contenteditable', 'true');
                            titleEl.setAttribute('role', 'textbox');
                            titleEl.setAttribute('aria-label', 'Edit note title');
                            titleEl.spellcheck = false;
                        } else {
                            titleEl.removeAttribute('contenteditable');
                            titleEl.removeAttribute('role');
                            titleEl.removeAttribute('aria-label');
                            titleEl.spellcheck = false;
                        }
                    }
                });
                syncSelectAllIndicator();
            };

            const setSingleSelection = (noteId) => {
                state.selectedNoteIds.clear();
                if (noteId) {
                    state.selectedNoteIds.add(noteId);
                    state.anchorNoteId = noteId;
                } else {
                    state.anchorNoteId = null;
                }
                syncSelectionStyles();
            };

            const toggleSelection = (noteId) => {
                if (!noteId) return;
                if (state.selectedNoteIds.has(noteId)) {
                    state.selectedNoteIds.delete(noteId);
                } else {
                    state.selectedNoteIds.add(noteId);
                }
                if (!state.selectedNoteIds.size) {
                    state.selectedNoteIds.add(noteId);
                }
                state.anchorNoteId = noteId;
                syncSelectionStyles();
            };

            const selectRange = (anchorId, targetId, { additive = false } = {}) => {
                if (!anchorId || !targetId) {
                    setSingleSelection(targetId);
                    return;
                }
                const items = getVisibleTreeItems();
                const ids = items.map((item) => item.dataset.noteId).filter(Boolean);
                const start = ids.indexOf(anchorId);
                const end = ids.indexOf(targetId);
                if (start === -1 || end === -1) {
                    setSingleSelection(targetId);
                    return;
                }
                const from = Math.min(start, end);
                const to = Math.max(start, end);
                if (!additive) state.selectedNoteIds.clear();
                for (let i = from; i <= to; i += 1) {
                    state.selectedNoteIds.add(ids[i]);
                }
                state.anchorNoteId = anchorId;
                syncSelectionStyles();
            };

            const setActiveTitle = (note) => {
                if (!notesActiveTitle) return;
                notesActiveTitle.textContent = note?.title || 'Untitled';
            };

            const setTextareaValue = (text) => {
                const nextText = typeof text === 'string' ? text : '';
                if (notesTextarea) {
                    notesTextarea.value = nextText;
                }
                state.lastSavedText = nextText;
            };

            const shouldAutosaveContent = (content) => {
                const nextText = String(content?.text || '').trim();
                const nextHtml = String(content?.html || '').trim();
                if (!nextText && !nextHtml) return false;
                return nextText !== state.lastSavedText || nextHtml !== state.lastSavedHtml;
            };

            const flushSave = async () => {
                if (!promptInput) return;
                if (editorState.mode !== 'EDITING' || !editorState.noteId) return;
                const nextContent = getEditorContent();
                if (!shouldAutosaveContent(nextContent)) return;
                if (state.saveTimer) clearTimeout(state.saveTimer);
                state.pendingSave = true;
                try {
                    const payload = {
                        noteId: editorState.noteId,
                        text: nextContent.text,
                        html: nextContent.html
                    };
                    if (!nextContent.html) {
                        payload.clearHtml = true;
                    }
                    await notesClient.updateNoteText(payload);
                    state.lastSavedText = nextContent.text;
                    state.lastSavedHtml = nextContent.html;
                    editorState.originalText = nextContent.text;
                    setStatus('Saved');
                } catch (error) {
                    console.warn('[results] failed to save note', error);
                    setStatus('Save failed');
                } finally {
                    state.pendingSave = false;
                }
            };

            const scheduleSave = () => {
                if (!promptInput) return;
                if (editorState.mode !== 'EDITING' || !editorState.noteId) return;
                const nextContent = getEditorContent();
                if (state.saveTimer) clearTimeout(state.saveTimer);
                state.saveTimer = setTimeout(async () => {
                    if (editorState.mode !== 'EDITING' || !editorState.noteId) return;
                    if (!shouldAutosaveContent(nextContent)) return;
                    state.pendingSave = true;
                    try {
                        const payload = {
                            noteId: editorState.noteId,
                            text: nextContent.text,
                            html: nextContent.html
                        };
                        if (!nextContent.html) {
                            payload.clearHtml = true;
                        }
                        await notesClient.updateNoteText(payload);
                        state.lastSavedText = nextContent.text;
                        state.lastSavedHtml = nextContent.html;
                        editorState.originalText = nextContent.text;
                        setStatus('Saved');
                    } catch (error) {
                        console.warn('[results] failed to save note', error);
                        setStatus('Save failed');
                    } finally {
                        state.pendingSave = false;
                    }
                }, 300);
            };

            const refreshActiveNote = async () => {
                if (!promptInput) return;
                if (editorState.mode === 'PROMPT') return;
                if (!editorState.noteId || state.refreshInFlight || state.pendingSave) return;
                const current = getEditorContent();
                if (current.text !== state.lastSavedText || current.html !== state.lastSavedHtml) return;
                state.refreshInFlight = true;
                try {
                    const result = await notesClient.getNote({ noteId: editorState.noteId });
                    const nextText = result?.text || '';
                    const nextHtml = sanitizeInlineHtml(result?.html || '').trim();
                    if (current.text === state.lastSavedText && current.html === state.lastSavedHtml) {
                        setNoteViewContent({ text: nextText, html: nextHtml });
                        editorState.originalText = nextText;
                    }
                } catch (error) {
                    console.warn('[results] failed to refresh note', error);
                } finally {
                    state.refreshInFlight = false;
                }
            };

            const renderNotesList = (notes = []) => {
                if (!notesTree) return;
                noteCache.clear();
                const query = state.searchQuery;
                const hasQuery = query.length > 0;

                const matchesQuery = (note) => {
                    if (!hasQuery) return true;
                    const title = String(note.title || '').toLowerCase();
                    const preview = String(note.preview || '').toLowerCase();
                    return title.includes(query) || preview.includes(query);
                };

                const formatDateLabel = (value) => {
                    const date = value instanceof Date ? value : new Date(value);
                    if (Number.isNaN(date.getTime())) return 'Unknown date';
                    const today = new Date();
                    const yesterday = new Date(today);
                    yesterday.setDate(today.getDate() - 1);
                    const isSameDay = (left, right) =>
                        left.getFullYear() === right.getFullYear()
                        && left.getMonth() === right.getMonth()
                        && left.getDate() === right.getDate();
                    if (isSameDay(date, today)) return 'Today';
                    if (isSameDay(date, yesterday)) return 'Yesterday';
                    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                    const month = months[date.getMonth()] || 'unknown';
                    return `${month}.${date.getDate()}`;
                };

            const sortByOrderKey = (list) =>
                list.slice().sort((a, b) => String(a.orderKey || '').localeCompare(String(b.orderKey || '')));
            const sortByCreatedAtDesc = (list) =>
                list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

                const buildTreeHtml = (list, depth) => {
                    let html = '';
                    let anyMatch = false;
                    let visibleCount = 0;
                    const sorted = depth === 0 ? sortByCreatedAtDesc(list) : sortByOrderKey(list);
                    let lastDateLabel = null;
                    sorted.forEach((note) => {
                        noteCache.set(note.id, note);
                        const children = childrenCache.get(note.id) || [];
                        const childrenLoaded = loadedChildren.has(note.id);
                        const showChildren = hasQuery || isExpanded(note.id);
                        const childResult = showChildren ? buildTreeHtml(children, depth + 1) : { html: '', anyMatch: false, visibleCount: 0 };
                        const matches = hasQuery ? (matchesQuery(note) || childResult.anyMatch) : true;
                        if (!matches) return;
                        if (depth === 0) {
                            const dateLabel = formatDateLabel(note.createdAt);
                            if (dateLabel && dateLabel !== lastDateLabel) {
                                html += `<div class="notes-date-separator" role="presentation">${escapeHtml(dateLabel)}</div>`;
                                lastDateLabel = dateLabel;
                            }
                        }
                        anyMatch = true;
                        visibleCount += 1;
                        const isActive = note.id === state.activeNoteId;
                        const isSelected = state.selectedNoteIds.has(note.id);
                        const isEditing = editorState.mode === 'EDITING' && editorState.noteId === note.id;
                        const hasChildren = childrenLoaded ? children.length > 0 : false;
                        const expanded = hasQuery ? (childResult.anyMatch && children.length) : isExpanded(note.id);
                        const title = escapeHtml(note.title || 'Untitled');
                        const preview = note.preview ? `<span class="notes-tree-preview">${escapeHtml(note.preview)}</span>` : '';
                        const padding = depth * 10;
                        const classNames = [
                            'notes-tree-item',
                            isActive ? 'is-active' : '',
                            isSelected ? 'is-selected' : '',
                            isEditing ? 'is-editing' : ''
                        ].filter(Boolean).join(' ');
                        const noteKind = escapeHtml(note.kind || '');
                        html += `<div class="${classNames}" data-note-id="${escapeHtml(note.id)}" data-note-kind="${noteKind}" data-parent-id="${escapeHtml(note.parentId || '')}" data-has-children="${hasChildren ? 'true' : 'false'}" role="treeitem" tabindex="${isActive ? '0' : '-1'}" aria-selected="${isSelected ? 'true' : 'false'}" aria-level="${depth + 1}" aria-expanded="${expanded ? 'true' : 'false'}" draggable="true">
                            <div class="notes-tree-row" style="padding-left:${padding}px">
                                <button type="button" class="notes-tree-toggle" data-action="toggle" data-note-id="${escapeHtml(note.id)}" aria-label="Toggle children"></button>
                                <div class="notes-tree-main">
                                    <span class="notes-tree-title">${title}</span>
                                    ${preview}
                                </div>
                                <button type="button" class="notes-tree-add" data-action="add-child" data-note-id="${escapeHtml(note.id)}" aria-label="Add child">+</button>
                            </div>
                            ${expanded && childResult.html ? childResult.html : ''}
                        </div>`;
                        if (expanded && childResult.visibleCount) {
                            visibleCount += childResult.visibleCount;
                        }
                    });
                    return { html, anyMatch, visibleCount };
                };

                const treeResult = buildTreeHtml(notes, 0);
                if (!treeResult.visibleCount) {
                    clearNode(notesTree);
                    if (notesEmpty) {
                        notesEmpty.textContent = hasQuery ? 'No matches.' : 'No notes yet.';
                        notesEmpty.style.display = 'block';
                    }
                    if (!notes.length) {
                        setEditorEnabled(false);
                        setActiveTitle(null);
                    } else {
                        setEditorEnabled(!!state.activeNoteId);
                    }
                    return;
                }
                if (notesEmpty) notesEmpty.style.display = 'none';
                replaceChildrenFromHtml(notesTree, treeResult.html);
                syncSelectionStyles();
                setEditorEnabled(!!state.activeNoteId);
                if (state.activeNoteId && noteCache.has(state.activeNoteId)) {
                    setActiveTitle(noteCache.get(state.activeNoteId));
                }
                syncSelectAllIndicator();
                scheduleChildrenPrefetch();
            };

            const refreshNotesList = async () => {
                if (!state.tabId) return;
                if (state.listRefreshing) {
                    listRefreshPending = true;
                    return;
                }
                state.listRefreshing = true;
                try {
                    const result = await notesClient.listChildren({
                        tabId: state.tabId,
                        parentId: null
                    });
                    const rawNotes = result?.notes || [];
                    const notes = rawNotes.filter((note) => {
                        if (!note) return false;
                        const isScratch = note.kind === 'scratch'
                            && note.source?.origin === scratchConfig.origin
                            && note.source?.key === scratchConfig.key;
                        if (!isScratch) return true;
                        const preview = String(note.preview || '').trim();
                        return preview.length > 0;
                    });
                    state.notes = notes;
                    clearChildrenCache();
                    await hydrateExpandedTree();
                    if (state.searchQuery) {
                        await ensureSearchTreeLoaded();
                    }
                    if (!notes.length) {
                        state.activeNoteId = null;
                        state.selectedNoteIds.clear();
                        state.anchorNoteId = null;
                        renderNotesList(notes);
                        setTextareaValue('');
                        return;
                    }
                    const noteIds = new Set(notes.map((note) => note.id));
                    if (state.activeNoteId) {
                        const activeNote = noteCache.get(state.activeNoteId);
                        if (activeNote?.kind === 'scratch') {
                            state.activeNoteId = null;
                        }
                    }
                    if (state.activeNoteId && !noteIds.has(state.activeNoteId)) {
                        state.activeNoteId = null;
                    }
                    if (state.activeNoteId && !state.selectedNoteIds.has(state.activeNoteId)) {
                        state.selectedNoteIds.add(state.activeNoteId);
                        state.anchorNoteId = state.activeNoteId;
                    }
                    renderNotesList(notes);
                    if (!state.activeNoteId && notes.length && editorState.mode !== 'PROMPT') {
                        await selectNote(notes[0].id, { skipSave: true });
                    }
                } catch (error) {
                    console.warn('[results] failed to refresh notes list', error);
                } finally {
                    state.listRefreshing = false;
                    if (listRefreshPending) {
                        listRefreshPending = false;
                        refreshNotesList();
                    }
                }
            };

            const focusNoteItem = (noteId) => {
                if (!notesTree || !noteId) return;
                const items = notesTree.querySelectorAll('.notes-tree-item');
                for (const item of items) {
                    if (item.dataset.noteId === noteId) {
                        item.focus();
                        break;
                    }
                }
            };

            const selectNote = async (noteId, { skipSave = false, force = false, focus = false, preserveSelection = false } = {}) => {
                if (!noteId) return;
                if (sessionPreview.isActive) {
                    restoreSessionPreview();
                }
                capturePromptDraft();
                if (state.activeNoteId === noteId && !force) return;
                if (!skipSave) {
                    await flushSave();
                }
                state.activeNoteId = noteId;
                if (state.tabId) {
                    lastActiveByTab.set(state.tabId, noteId);
                }
                if (!preserveSelection) {
                    setSingleSelection(noteId);
                }
                setEditorEnabled(true);
                if (notesTree) {
                    notesTree.querySelectorAll('.notes-tree-item').forEach((item) => {
                        item.classList.toggle('is-active', item.dataset.noteId === noteId);
                        item.setAttribute('aria-selected', state.selectedNoteIds.has(item.dataset.noteId) ? 'true' : 'false');
                        item.setAttribute('tabindex', item.dataset.noteId === noteId ? '0' : '-1');
                    });
                }
                if (focus) {
                    focusNoteItem(noteId);
                }
                if (noteCache.has(noteId)) {
                    setActiveTitle(noteCache.get(noteId));
                } else {
                    setActiveTitle(null);
                }
                let noteText = '';
                let noteHtml = '';
                try {
                    const result = await notesClient.getNote({ noteId });
                    noteText = result?.text || '';
                    noteHtml = sanitizeInlineHtml(result?.html || '').trim();
                    setTextareaValue(noteText);
                } catch (error) {
                    console.warn('[results] failed to load note', error);
                }
                return { text: noteText, html: noteHtml };
            };

            const createRootNote = async () => {
                const ready = await ensureNotesReady();
                if (!ready) {
                    setStatus('Notes offline');
                    return;
                }
                try {
                    await flushSave();
                    const created = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId: null,
                        title: 'New',
                        text: ''
                    });
                    await syncAfterNoteCreate(created);
                    const notePayload = await selectNote(created?.noteId, { preserveSelection: false, focus: true });
                    if (created?.noteId) {
                        await applyNoteToPrompt(created.noteId, { mode: 'EDITING', noteText: notePayload });
                    }
                    setStatus('Note created');
                } catch (error) {
                    console.warn('[results] failed to create note', error);
                    setStatus(formatStatusError('Create failed', error), 3200);
                }
            };

            const createChildNote = async (parentId) => {
                if (!parentId) return;
                const ready = await ensureNotesReady();
                if (!ready) {
                    setStatus('Notes offline');
                    return;
                }
                try {
                    await flushSave();
                    const parentTabId = await resolveParentTabId(parentId);
                    if (parentTabId && parentTabId !== state.tabId) {
                        state.tabId = parentTabId;
                    }
                    const created = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId,
                        title: 'New',
                        text: ''
                    }, { allowDefault: false });
                    setExpanded(parentId, true);
                    await syncAfterNoteCreate(created);
                    const notePayload = await selectNote(created?.noteId, { preserveSelection: false, focus: true });
                    if (created?.noteId) {
                        await applyNoteToPrompt(created.noteId, { mode: 'EDITING', noteText: notePayload });
                    }
                    setStatus('Note created');
                } catch (error) {
                    console.warn('[results] failed to create child note', error);
                    setStatus(formatStatusError('Create failed', error), 3200);
                }
            };

            const toggleExpand = async (noteId) => {
                if (!noteId) return;
                if (state.searchQuery) {
                    setExpanded(noteId, !isExpanded(noteId));
                    renderNotesList(state.notes);
                    return;
                }
                const nextExpanded = !isExpanded(noteId);
                if (nextExpanded) {
                    const children = await fetchChildren(noteId);
                    const hasChildren = Array.isArray(children) && children.length > 0;
                    setExpanded(noteId, hasChildren);
                } else {
                    setExpanded(noteId, false);
                }
                renderNotesList(state.notes);
            };

            const getVisibleTreeItems = () => {
                if (!notesTree) return [];
                return Array.from(notesTree.querySelectorAll('.notes-tree-item'));
            };

            const getParentItem = (item) => {
                if (!item) return null;
                return item.parentElement ? item.parentElement.closest('.notes-tree-item') : null;
            };

            const getFirstChildItem = (item) => {
                if (!item) return null;
                for (const child of Array.from(item.children)) {
                    if (child.classList && child.classList.contains('notes-tree-item')) {
                        return child;
                    }
                }
                return null;
            };

            const itemHasChildren = (item) => item?.dataset?.hasChildren === 'true';
            const dragState = {
                noteId: null,
                targetId: null,
                position: null
            };
            const textDragState = {
                targetId: null,
                position: null
            };

            const DRAG_MIME = 'application/x-codex-note';

            const clearDropIndicators = () => {
                if (!notesTree) return;
                notesTree.classList.remove('is-drop-root');
                notesTree.querySelectorAll('.notes-tree-item').forEach((item) => {
                    item.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
                });
            };

            const resolveDropTarget = (event) => {
                if (!notesTree) return { item: null, targetId: null, position: 'root' };
                const item = event.target.closest('.notes-tree-item');
                if (!item || !notesTree.contains(item)) {
                    return { item: null, targetId: null, position: 'root' };
                }
                const rect = item.getBoundingClientRect();
                const offsetY = event.clientY - rect.top;
                const ratio = rect.height ? offsetY / rect.height : 0.5;
                let position = 'inside';
                if (ratio < 0.25) position = 'before';
                if (ratio > 0.75) position = 'after';
                return { item, targetId: item.dataset.noteId, position };
            };

            const setDropIndicator = (item, position) => {
                clearDropIndicators();
                if (!notesTree) return;
                if (!item) {
                    notesTree.classList.add('is-drop-root');
                    return;
                }
                if (position === 'inside') {
                    item.classList.add('is-drop-inside');
                } else if (position === 'before') {
                    item.classList.add('is-drop-before');
                } else if (position === 'after') {
                    item.classList.add('is-drop-after');
                }
            };

            const buildDragPayload = ({ text, type, llmName }) => {
                const payload = {
                    text: String(text || '').trim(),
                    type: type || 'clip'
                };
                if (llmName) payload.llmName = llmName;
                return payload;
            };

            const getDragPayload = (event) => {
                const raw = event?.dataTransfer?.getData?.(DRAG_MIME);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed?.text) return parsed;
                    } catch (_) {}
                }
                const plain = event?.dataTransfer?.getData?.('text/plain');
                if (plain) {
                    return buildDragPayload({ text: plain, type: 'clip' });
                }
                return null;
            };

            const setDragPayload = (event, payload) => {
                if (!event?.dataTransfer || !payload?.text) return false;
                try {
                    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
                } catch (_) {}
                try {
                    event.dataTransfer.setData('text/plain', payload.text);
                } catch (_) {}
                event.dataTransfer.effectAllowed = 'copy';
                return true;
            };

            const getSelectionTextWithin = (element) => {
                if (!element) return '';
                const selection = window.getSelection?.();
                if (!selection || selection.isCollapsed) return '';
                const anchorNode = selection.anchorNode;
                const focusNode = selection.focusNode;
                if (!anchorNode || !focusNode) return '';
                if (!element.contains(anchorNode) || !element.contains(focusNode)) return '';
                return String(selection.toString() || '').trim();
            };

            const getPromptDragText = () => {
                if (!promptInput) return '';
                const start = promptInput.selectionStart;
                const end = promptInput.selectionEnd;
                if (typeof start === 'number' && typeof end === 'number' && start !== end) {
                    return String(promptInput.value || '').slice(start, end).trim();
                }
                return getPromptTextForSave();
            };

            const getOutputDragText = (outputEl) => {
                if (!outputEl) return '';
                const selected = getSelectionTextWithin(outputEl);
                if (selected) return selected;
                return getOutputTextForSave(outputEl.id);
            };

            const resolveLlmNameForOutput = (outputEl) => {
                if (!outputEl) return '';
                const panel = outputEl.closest('.llm-panel');
                const title = panel?.querySelector('.llm-title');
                const name = title?.textContent?.trim();
                return name || '';
            };

            const applyNoteToPrompt = async (noteId, { mode = 'VIEWING', noteText = null } = {}) => {
                if (!promptInput || !noteId) return;
                try {
                    let nextText = '';
                    let nextHtml = '';
                    if (noteText && typeof noteText === 'object') {
                        nextText = String(noteText.text || '');
                        nextHtml = String(noteText.html || '');
                    } else if (typeof noteText === 'string') {
                        nextText = noteText;
                    }
                    if (!nextText && !nextHtml) {
                        const result = await notesClient.getNote({ noteId });
                        nextText = result?.text || '';
                        nextHtml = result?.html || '';
                    }
                    const resolvedHtml = sanitizeInlineHtml(nextHtml).trim();
                    const resolvedText = resolvedHtml ? plainTextFromHtml(resolvedHtml) : String(nextText || '');
                    setNoteViewContent({ text: resolvedText, html: resolvedHtml });
                    setEditorMode(mode, { noteId, originalText: resolvedText });
                    if (!resolvedText.trim() && !resolvedHtml.trim()) {
                        setStatus('Note is empty');
                        return;
                    }
                    setStatus(mode === 'EDITING' ? 'Editing' : 'Prompt updated');
                } catch (error) {
                    console.warn('[results] failed to apply note to prompt', error);
                    setStatus('Prompt update failed');
                }
            };

            const createNoteFromDrag = async ({ text, type, llmName }, { targetId, position }) => {
                const content = String(text || '').trim();
                if (!content) return;
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }

                const snippet = truncateText(content, 48);
                let title = snippet;
                let kind = 'clip';
                if (type === 'prompt') {
                    title = snippet;
                    kind = 'prompt';
                } else if (type === 'response') {
                    const prefix = llmName || 'Response';
                    title = `${prefix} response - ${snippet}`;
                    kind = 'response';
                }

                let targetParentId = null;
                let beforeId = null;
                let afterId = null;
                if (targetId && position !== 'root') {
                    if (position === 'inside') {
                        targetParentId = targetId;
                    } else {
                        const targetItem = notesTree?.querySelector(`.notes-tree-item[data-note-id="${targetId}"]`);
                        targetParentId = targetItem?.dataset?.parentId || null;
                        if (position === 'before') beforeId = targetId;
                        if (position === 'after') afterId = targetId;
                    }
                }

                try {
                    if (targetParentId) {
                        const parentTabId = await resolveParentTabId(targetParentId);
                        if (parentTabId && parentTabId !== state.tabId) {
                            state.tabId = parentTabId;
                        }
                    }
                    const source = {
                        origin: 'comparator',
                        type,
                        model: llmName,
                        pageUrl: location.href,
                        ts: Date.now()
                    };
                    if (type === 'response') {
                        const { url: responseUrl, timestamp: responseTimestamp } = resolveResponseSource(llmName);
                        source.pageUrl = responseUrl;
                        source.ts = responseTimestamp;
                    }
                    const created = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId: targetParentId,
                        kind,
                        title,
                        text: content,
                        source
                    });
                    if (created?.noteId && (beforeId || afterId)) {
                        await notesClient.moveNote({
                            noteId: created.noteId,
                            targetParentId,
                            beforeId,
                            afterId
                        });
                    }
                    if (targetParentId) {
                        setExpanded(targetParentId, true);
                    }
                    if (created?.noteId) {
                        state.activeNoteId = created.noteId;
                        lastActiveByTab.set(state.tabId, created.noteId);
                        setSingleSelection(created.noteId);
                    }
                    await syncAfterNoteCreate(created);
                    setStatus('Saved to notes');
                } catch (error) {
                    console.warn('[results] failed to save drag note', error);
                    setStatus(formatStatusError('Save failed', error), 3200);
                }
            };

            const formatTimestamp = (value = new Date()) => {
                const date = value instanceof Date ? value : new Date(value);
                const pad = (num) => String(num).padStart(2, '0');
                return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
            };

            const createSessionId = () => `session_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

            const normalizeSession = (session) => {
                if (!session || typeof session !== 'object') return null;
                const urls = Array.isArray(session.urls)
                    ? session.urls.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
                    : [];
                if (!urls.length) return null;
                const name = String(session.name || '').trim();
                return {
                    id: typeof session.id === 'string' && session.id ? session.id : createSessionId(),
                    name: name || `Session ${formatTimestamp()}`,
                    urls,
                    createdAt: Number(session.createdAt || Date.now()),
                    updatedAt: Number(session.updatedAt || Date.now())
                };
            };

            const readStorage = (area, key) => new Promise((resolve) => {
                if (!area) {
                    resolve({});
                    return;
                }
                try {
                    area.get(key, (result) => resolve(result || {}));
                } catch (error) {
                    console.warn('[results] storage read failed', error);
                    resolve({});
                }
            });

            const writeStorage = (area, payload) => new Promise((resolve, reject) => {
                if (!area) {
                    resolve(false);
                    return;
                }
                try {
                    area.set(payload, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve(true);
                    });
                } catch (error) {
                    reject(error);
                }
            });

            const loadSessions = async () => {
                const syncArea = chrome?.storage?.sync || null;
                const localArea = chrome?.storage?.local || null;
                let raw = [];
                let hasValue = false;
                if (syncArea) {
                    const result = await readStorage(syncArea, SESSIONS_STORAGE_KEY);
                    if (Object.prototype.hasOwnProperty.call(result, SESSIONS_STORAGE_KEY)) {
                        raw = Array.isArray(result[SESSIONS_STORAGE_KEY]) ? result[SESSIONS_STORAGE_KEY] : [];
                        hasValue = true;
                    }
                }
                if (!hasValue && localArea) {
                    const result = await readStorage(localArea, SESSIONS_STORAGE_KEY);
                    if (Object.prototype.hasOwnProperty.call(result, SESSIONS_STORAGE_KEY)) {
                        raw = Array.isArray(result[SESSIONS_STORAGE_KEY]) ? result[SESSIONS_STORAGE_KEY] : [];
                    }
                }
                sessionsState.sessions = raw
                    .map((entry) => normalizeSession(entry))
                    .filter(Boolean);
            };

            const persistSessions = async () => {
                const payload = { [SESSIONS_STORAGE_KEY]: sessionsState.sessions };
                const syncArea = chrome?.storage?.sync || null;
                const localArea = chrome?.storage?.local || null;
                if (syncArea) {
                    try {
                        await writeStorage(syncArea, payload);
                    } catch (error) {
                        console.warn('[results] sync storage failed', error);
                    }
                }
                if (localArea) {
                    try {
                        await writeStorage(localArea, payload);
                    } catch (error) {
                        console.warn('[results] local storage failed', error);
                    }
                }
            };

            const formatSessionPreview = (urls = []) =>
                urls.map((url) => String(url || '').trim()).filter(Boolean).join('\n');

            const extractSessionUrlsFromText = (text = '') => {
                const tokens = String(text || '').split(/[\s,]+/g).map((entry) => entry.trim()).filter(Boolean);
                const urls = tokens.filter((entry) => /^https?:\/\//i.test(entry));
                return Array.from(new Set(urls));
            };

            const areSessionUrlsEqual = (left = [], right = []) => {
                const a = Array.isArray(left) ? left.map((url) => String(url || '').trim()).filter(Boolean) : [];
                const b = Array.isArray(right) ? right.map((url) => String(url || '').trim()).filter(Boolean) : [];
                if (a.length !== b.length) return false;
                for (let i = 0; i < a.length; i += 1) {
                    if (a[i] !== b[i]) return false;
                }
                return true;
            };

            const showSessionPreview = async (session) => {
                if (!session || !promptInput) return;
                if (editorState.mode !== 'PROMPT') {
                    await exitNotesMode();
                }
                if (!sessionPreview.isActive) {
                    sessionPreview.text = getEditorValue();
                    sessionPreview.capturedAt = Date.now();
                    sessionPreview.isActive = true;
                }
                const previewText = formatSessionPreview(session.urls);
                if (useInputRichMode && typeof applyRichInputContent === 'function') {
                    applyRichInputContent({ text: previewText, html: '' });
                } else {
                    setEditorValue(previewText);
                }
            };

            const restoreSessionPreview = () => {
                if (!sessionPreview.isActive) return;
                const restoredText = sessionPreview.text;
                sessionPreview.isActive = false;
                sessionPreview.text = '';
                sessionPreview.capturedAt = 0;
                if (useInputRichMode && typeof applyRichInputContent === 'function') {
                    applyRichInputContent({ text: restoredText, html: '' });
                } else {
                    setEditorValue(restoredText);
                }
            };

            const updateSessionsToolbarState = () => {
                const hasSelection = sessionsState.sessions.some((session) => session.id === sessionsState.selectedId);
                if (sessionsDeleteBtn) sessionsDeleteBtn.disabled = !hasSelection;
            };

            const buildSessionItem = (session, isSelected, count) => {
                const item = document.createElement('div');
                item.className = `sessions-item${isSelected ? ' is-selected' : ''}`;
                item.dataset.sessionId = String(session.id || '');
                item.draggable = true;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                const nameSpan = document.createElement('span');
                nameSpan.className = 'sessions-item-name';
                nameSpan.textContent = session.name || 'Session';
                const runButton = document.createElement('button');
                runButton.type = 'button';
                runButton.className = 'sessions-item-run';
                runButton.textContent = '►';
                runButton.setAttribute('aria-label', 'Open session tabs');
                runButton.dataset.sessionId = session.id;
                item.appendChild(nameSpan);
                item.appendChild(runButton);
                return item;
            };

            const renderSessionsList = () => {
                if (!sessionsList) return;
                const sessions = sessionsState.sessions.map((session) => {
                    const count = Array.isArray(session.urls) ? session.urls.length : 0;
                    const isSelected = session.id === sessionsState.selectedId;
                    return { session, count, isSelected };
                });
                renderIncrementalList(sessionsList, sessions, {
                    getId: ({ session }) => String(session?.id || ''),
                    getHash: ({ session, count, isSelected }) =>
                        `${session?.name || ''}|${count}|${isSelected ? '1' : '0'}`,
                    renderItem: ({ session, count, isSelected }) =>
                        buildSessionItem(session, isSelected, count)
                });
                if (sessionsEmpty) {
                    sessionsEmpty.style.display = sessionsState.sessions.length ? 'none' : 'block';
                }
                updateSessionsToolbarState();
            };

            const setSessionsActive = (isActive) => {
                sessionsState.isActive = !!isActive;
                if (notesSidebar) {
                    notesSidebar.classList.toggle('is-sessions-active', sessionsState.isActive);
                }
                if (notesSessionsTab) {
                    notesSessionsTab.classList.toggle('is-active', sessionsState.isActive);
                    notesSessionsTab.setAttribute('aria-selected', sessionsState.isActive ? 'true' : 'false');
                }
                if (notesSidebarTitle) {
                    notesSidebarTitle.textContent = sessionsState.isActive ? 'Sessions' : sessionsState.defaultTitle;
                }
                if (sessionsState.isActive) {
                    renderSessionsList();
                }
            };

            const selectSession = (sessionId) => {
                sessionsState.selectedId = sessionId || null;
                renderSessionsList();
            };

            const getSelectedSession = () =>
                sessionsState.sessions.find((session) => session.id === sessionsState.selectedId) || null;

            const startRenameSession = (item) => {
                if (!item) return;
                const sessionId = item.dataset.sessionId;
                const session = sessionsState.sessions.find((entry) => entry.id === sessionId);
                if (!session) return;
                const labelEl = item.querySelector('.sessions-item-name');
                if (!labelEl || labelEl.querySelector('input')) return;
                const input = document.createElement('input');
                input.className = 'sessions-item-input';
                input.value = session.name || 'Session';
                input.setAttribute('aria-label', 'Rename session');
                labelEl.replaceWith(input);
                input.focus();
                input.select();

                const finish = async (commit) => {
                    if (!item.contains(input)) return;
                    const nextName = String(input.value || '').trim();
                    const shouldCommit = commit && nextName && nextName !== session.name;
                    const label = document.createElement('span');
                    label.className = 'sessions-item-name';
                    label.textContent = shouldCommit ? nextName : (session.name || 'Session');
                    input.replaceWith(label);
                    if (shouldCommit) {
                        session.name = nextName;
                        session.updatedAt = Date.now();
                        await persistSessions();
                        setStatus('Session renamed');
                    }
                    renderSessionsList();
                };

                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        finish(true);
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        finish(false);
                    }
                });
                input.addEventListener('blur', () => finish(true));
            };

            const clearSessionDropIndicators = () => {
                sessionsList?.querySelectorAll('.sessions-item').forEach((item) => {
                    item.classList.remove('is-drop-before', 'is-drop-after');
                });
            };

            const reorderSessions = async (dragId, targetId, position) => {
                if (!dragId || !targetId || dragId === targetId) return;
                const sessions = sessionsState.sessions.slice();
                const fromIndex = sessions.findIndex((entry) => entry.id === dragId);
                const targetIndex = sessions.findIndex((entry) => entry.id === targetId);
                if (fromIndex < 0 || targetIndex < 0) return;
                const [moved] = sessions.splice(fromIndex, 1);
                let insertIndex = targetIndex;
                if (position === 'after') {
                    insertIndex = targetIndex + (fromIndex < targetIndex ? 0 : 1);
                } else {
                    insertIndex = targetIndex + (fromIndex < targetIndex ? -1 : 0);
                }
                insertIndex = Math.max(0, Math.min(sessions.length, insertIndex));
                sessions.splice(insertIndex, 0, moved);
                sessionsState.sessions = sessions;
                await persistSessions();
                renderSessionsList();
            };

            const fetchTrackedSessionUrls = async () => {
                try {
                    const response = await sendToBackground({ type: 'SESSION_TABS_GET' });
                    const tabs = Array.isArray(response?.tabs) ? response.tabs : [];
                    const urls = tabs
                        .map((tab) => tab?.url)
                        .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
                    return Array.from(new Set(urls));
                } catch (error) {
                    console.warn('[results] failed to fetch session tabs', error);
                    return [];
                }
            };

            const saveCurrentSession = async () => {
                const manualUrls = extractSessionUrlsFromText(getEditorValue());
                const trackedUrls = await fetchTrackedSessionUrls();
                const urls = manualUrls.length ? manualUrls : trackedUrls;
                if (!urls.length) {
                    setStatus('No session URLs to save');
                    return;
                }
                const now = Date.now();
                const session = {
                    id: createSessionId(),
                    name: `Session ${formatTimestamp(now)}`,
                    urls,
                    createdAt: now,
                    updatedAt: now
                };
                sessionsState.sessions.unshift(session);
                sessionsState.selectedId = session.id;
                await persistSessions();
                renderSessionsList();
                setStatus('Session saved');
            };

            const runSessionById = async (sessionId) => {
                if (!sessionId) {
                    setStatus('Select a session');
                    return;
                }
                const session = sessionsState.sessions.find((entry) => entry.id === sessionId);
                if (!session) {
                    setStatus('Session missing');
                    return;
                }
                if (sessionsState.isActive) {
                    const editedUrls = extractSessionUrlsFromText(getEditorValue());
                    if (editedUrls.length && !areSessionUrlsEqual(editedUrls, session.urls)) {
                        session.urls = editedUrls;
                        session.updatedAt = Date.now();
                        await persistSessions();
                        renderSessionsList();
                    }
                }
                try {
                    await sendToBackground({ type: 'SESSION_TABS_OPEN', urls: session.urls });
                    session.updatedAt = Date.now();
                    await persistSessions();
                    setStatus('Session opened');
                } catch (error) {
                    console.warn('[results] failed to open session', error);
                    setStatus('Open failed');
                }
            };

            const runSelectedSession = async () => {
                const session = getSelectedSession();
                if (!session) {
                    setStatus('Select a session');
                    return;
                }
                await runSessionById(session.id);
            };

            const deleteSelectedSession = async () => {
                const session = getSelectedSession();
                if (!session) {
                    setStatus('Select a session');
                    return;
                }
                sessionsState.sessions = sessionsState.sessions.filter((entry) => entry.id !== session.id);
                sessionsState.selectedId = sessionsState.sessions[0]?.id || null;
                await persistSessions();
                renderSessionsList();
                setStatus('Session deleted');
            };

            const truncateText = (text, maxLength = 60) => {
                const value = String(text || '').trim();
                if (value.length <= maxLength) return value;
                return `${value.slice(0, maxLength).trim()}...`;
            };

            const extractWords = (text = '', limit = 100) => {
                const words = String(text || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ')
                    .filter(Boolean);
                if (!words.length) return '';
                if (words.length <= limit) return words.join(' ');
                return `${words.slice(0, limit).join(' ')}...`;
            };

            const getPromptTextForSave = () => {
                const baseText = (promptInput?.value || '').trim();
                if (!baseText) return '';
                if (typeof applySelectedModifiersToPrompt === 'function') {
                    return applySelectedModifiersToPrompt(baseText, { includeResponses: true, wrapPromptTag: false }).trim();
                }
                return baseText;
            };

            const getOutputContentForSave = (outputId) => {
                if (!outputId) return { text: '', html: '' };
                const outputEl = document.getElementById(outputId);
                if (!outputEl) return { text: '', html: '' };
                const rawHtml = outputEl.innerHTML || '';
                const html = sanitizeInlineHtml(rawHtml).trim();
                const text = html
                    ? plainTextFromHtml(html)
                    : String(outputEl.innerText || outputEl.textContent || '').trim();
                return { text: String(text || '').trim(), html };
            };

            const getOutputTextForSave = (outputId) => getOutputContentForSave(outputId).text;

            const ensureActiveTab = async ({ allowCreate = true } = {}) => {
                await refreshTabs();
                const tabIds = new Set(state.tabs.map((tab) => tab.tabId));
                if (state.tabId && tabIds.has(state.tabId)) {
                    return true;
                }
                if (state.defaultTabId && tabIds.has(state.defaultTabId)) {
                    state.tabId = state.defaultTabId;
                    persistActiveNotesTab();
                    return true;
                }
                if (state.tabs.length) {
                    state.tabId = state.tabs[0].tabId;
                    persistActiveNotesTab();
                    return true;
                }
                if (allowCreate && notesClient?.createTab) {
                    try {
                        await notesClient.createTab({ name: 'Home' });
                        await refreshTabs();
                    } catch (error) {
                        console.warn('[results] failed to create fallback tab', error);
                    }
                    if (state.tabs.length) {
                        state.tabId = state.tabs[0].tabId;
                        persistActiveNotesTab();
                        return true;
                    }
                }
                return false;
            };

            const resolveParentTabId = async (noteId) => {
                if (!noteId) return null;
                const cached = noteCache.get(noteId);
                if (cached?.tabId) return cached.tabId;
                try {
                    const result = await notesClient.getNote({ noteId });
                    return result?.note?.tabId || null;
                } catch (error) {
                    console.warn('[results] failed to resolve parent tab', error);
                    return null;
                }
            };

            const createNoteWithFallback = async (payload, { allowDefault = true } = {}) => {
                const basePayload = { ...payload };
                const resolvedTabId = basePayload.tabId || state.tabId;
                if (resolvedTabId) {
                    basePayload.tabId = resolvedTabId;
                } else if (!allowDefault) {
                    throw new Error('No active tab');
                }
                try {
                    return await notesClient.createNote(basePayload);
                } catch (error) {
                    const message = String(error?.message || '');
                    if (!/tab not found/i.test(message)) {
                        throw error;
                    }
                    if (!allowDefault) {
                        throw error;
                    }
                    await ensureActiveTab({ allowCreate: true });
                    const retryPayload = { ...payload };
                    if (state.tabId) {
                        retryPayload.tabId = state.tabId;
                    } else {
                        delete retryPayload.tabId;
                    }
                    return await notesClient.createNote(retryPayload);
                }
            };

            const syncAfterNoteCreate = async (created) => {
                if (created?.tabId && state.tabId !== created.tabId) {
                    state.tabId = created.tabId;
                }
                await refreshTabs();
                persistActiveNotesTab();
                await refreshNotesList();
            };

            const ensureNotesReady = async () => {
                if (!state.tabId) {
                    await initNotes();
                    if (!state.tabId && state.defaultTabId) {
                        state.tabId = state.defaultTabId;
                    }
                }
                return ensureActiveTab();
            };

            const buildNoteHtmlWithMeta = ({ headerLines = [], bodyHtml = '', bodyText = '', metaLines = [] } = {}) => {
                const sections = [];
                if (Array.isArray(headerLines) && headerLines.length) {
                    sections.push(buildHtmlFromText(headerLines.join('\n')));
                }
                const body = bodyHtml || (bodyText ? buildHtmlFromText(bodyText) : '');
                if (body) sections.push(body);
                if (Array.isArray(metaLines) && metaLines.length) {
                    sections.push(buildHtmlFromText(metaLines.join('\n')));
                }
                return sections.filter(Boolean).join('<br><br>');
            };

            const savePromptNote = async () => {
                const promptText = getPromptTextForSave();
                if (!promptText) {
                    setStatus('Prompt is empty');
                    return;
                }
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }
                try {
                    const title = truncateText(promptText, 48);
                    const created = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId: null,
                        kind: 'prompt',
                        title,
                        text: promptText,
                        source: {
                            origin: 'comparator',
                            type: 'prompt',
                            pageUrl: location.href,
                            ts: Date.now()
                        }
                    });
                    if (created?.noteId) {
                        state.activeNoteId = created.noteId;
                        lastActiveByTab.set(state.tabId, created.noteId);
                        setSingleSelection(created.noteId);
                    }
                    await syncAfterNoteCreate(created);
                    setStatus('Prompt saved');
                } catch (error) {
                    console.warn('[results] failed to save prompt', error);
                    setStatus(formatStatusError('Save failed', error), 3200);
                }
            };

            const saveResponseNote = async ({ outputId, llmName }) => {
                const { text: responseText, html: responseHtml } = getOutputContentForSave(outputId);
                if (!responseText && !responseHtml) {
                    setStatus('Response is empty');
                    return;
                }
                const promptText = getPromptTextForSave();
                const promptSnippet = extractWords(promptText, 100);
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }
                const { url: responseUrl, timestamp: responseTimestamp } = resolveResponseSource(llmName);
                const timestamp = formatTimestamp(responseTimestamp);
                const titleSuffix = promptSnippet ? truncateText(promptSnippet, 36) : 'Response';
                const title = `${llmName} response - ${titleSuffix}`;
                const headerLines = [
                    `${llmName} response to prompt:`,
                    promptSnippet || '(prompt unavailable)'
                ];
                const metaLines = [
                    `Source: ${responseUrl}`,
                    `Saved: ${timestamp}`
                ];
                const contentLines = [
                    `${llmName} response to prompt:`,
                    promptSnippet || '(prompt unavailable)',
                    '',
                    responseText,
                    '',
                    '---',
                    `Source: ${responseUrl}`,
                    `Saved: ${timestamp}`
                ];
                const noteHtml = buildNoteHtmlWithMeta({
                    headerLines,
                    bodyHtml: responseHtml,
                    bodyText: responseText,
                    metaLines
                });
                try {
                    const created = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId: null,
                        kind: 'response',
                        title,
                        text: contentLines.join('\n'),
                        html: noteHtml,
                        source: {
                            origin: 'comparator',
                            type: 'response',
                            model: llmName,
                            pageUrl: responseUrl,
                            ts: responseTimestamp
                        }
                    });
                    if (created?.noteId) {
                        state.activeNoteId = created.noteId;
                        lastActiveByTab.set(state.tabId, created.noteId);
                        setSingleSelection(created.noteId);
                    }
                    await syncAfterNoteCreate(created);
                    setStatus('Response saved');
                } catch (error) {
                    console.warn('[results] failed to save response', error);
                    setStatus(formatStatusError('Save failed', error), 3200);
                }
            };

            const saveSessionNotes = async () => {
                const promptText = getPromptTextForSave();
                const promptSnippet = extractWords(promptText, 40);
                const responses = responseSaveButtons
                    .map((btn) => ({
                        llmName: btn.dataset.llmName,
                        outputId: btn.dataset.target
                    }))
                    .map((entry) => ({
                        ...entry,
                        ...getOutputContentForSave(entry.outputId)
                    }))
                    .filter((entry) => entry.text || entry.html);

                if (!promptText && !responses.length) {
                    setStatus('Nothing to save');
                    return;
                }
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }

                const timestamp = formatTimestamp();
                const titleBase = promptSnippet || `Session ${timestamp}`;
                const sessionTitle = `Session - ${truncateText(titleBase, 48)}`;
                const sessionText = [
                    promptSnippet ? `Prompt: ${promptSnippet}` : 'Prompt: (empty)',
                    `Models: ${responses.length}`,
                    `Saved: ${timestamp}`
                ].join('\n');

                try {
                    const session = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId: null,
                        kind: 'session',
                        title: sessionTitle,
                        text: sessionText,
                        source: {
                            origin: 'comparator',
                            type: 'session',
                            pageUrl: location.href,
                            ts: Date.now()
                        }
                    });
                    const sessionId = session?.noteId;
                    const sessionTabId = session?.tabId || state.tabId;
                    if (sessionId && promptText) {
                        await notesClient.createNote({
                            tabId: sessionTabId,
                            parentId: sessionId,
                            kind: 'prompt',
                            title: 'Prompt',
                            text: promptText,
                            source: {
                                origin: 'comparator',
                                type: 'prompt',
                                pageUrl: location.href,
                                ts: Date.now()
                            }
                        });
                    }
                    for (const response of responses) {
                        const { url: responseUrl, timestamp: responseTimestamp } = resolveResponseSource(response.llmName);
                        const savedAt = formatTimestamp(responseTimestamp);
                        const responseTitle = `${response.llmName} response`;
                        const metaLines = [
                            `Source: ${responseUrl}`,
                            `Saved: ${savedAt}`
                        ];
                        const responseBody = [
                            response.text,
                            '',
                            '---',
                            `Source: ${responseUrl}`,
                            `Saved: ${savedAt}`
                        ].join('\n');
                        const responseHtml = buildNoteHtmlWithMeta({
                            bodyHtml: response.html,
                            bodyText: response.text,
                            metaLines
                        });
                        await notesClient.createNote({
                            tabId: sessionTabId,
                            parentId: sessionId || null,
                            kind: 'response',
                            title: responseTitle,
                            text: responseBody,
                            html: responseHtml,
                            source: {
                                origin: 'comparator',
                                type: 'response',
                                model: response.llmName,
                                pageUrl: responseUrl,
                                ts: responseTimestamp
                            }
                        });
                    }
                    if (session?.noteId) {
                        state.activeNoteId = session.noteId;
                        lastActiveByTab.set(state.tabId, session.noteId);
                        setExpanded(session.noteId, true);
                        setSingleSelection(session.noteId);
                    }
                    await syncAfterNoteCreate(session);
                    setStatus('Session saved');
                } catch (error) {
                    console.warn('[results] failed to save session', error);
                    setStatus(formatStatusError('Save failed', error), 3200);
                }
            };

            const getTopMostSelection = async () => {
                const selected = state.selectedNoteIds.size
                    ? Array.from(state.selectedNoteIds)
                    : (state.activeNoteId ? [state.activeNoteId] : []);
                if (!selected.length) return [];
                const map = await buildAllNotesMap();
                const selectedSet = new Set(selected);
                const isDescendantSelected = (noteId) => {
                    let current = map.get(noteId);
                    while (current && current.parentId) {
                        if (selectedSet.has(current.parentId)) return true;
                        current = map.get(current.parentId);
                    }
                    return false;
                };
                return selected.filter((noteId) => !isDescendantSelected(noteId));
            };

            const buildChildrenLookup = (map) => {
                const lookup = new Map();
                map.forEach((note) => {
                    const parentId = note.parentId || null;
                    if (!lookup.has(parentId)) lookup.set(parentId, []);
                    lookup.get(parentId).push(note);
                });
                lookup.forEach((list) => {
                    list.sort((a, b) => String(a.orderKey || '').localeCompare(String(b.orderKey || '')));
                });
                return lookup;
            };

            const buildSourceMetaLines = (note) => {
                const source = note?.source || {};
                const lines = [];
                const pageUrl = typeof source.pageUrl === 'string' ? source.pageUrl.trim() : '';
                const ts = typeof source.ts === 'number' ? source.ts : null;
                if (pageUrl) lines.push(`Source: ${pageUrl}`);
                if (ts) lines.push(`Saved: ${formatTimestamp(ts)}`);
                return lines;
            };

            const normalizeNoteTextForMerge = (text, html) => {
                const rawText = typeof text === 'string' ? text : '';
                if (rawText.trim()) return rawText;
                if (!html) return '';
                return String(stripHtmlToPlainText(html) || '').trim();
            };

            const getSelectedNoteIds = () => {
                if (state.selectedNoteIds.size) return Array.from(state.selectedNoteIds);
                if (state.activeNoteId) return [state.activeNoteId];
                return [];
            };

            const getSelectedNoteIdsByVisualOrder = () => {
                const selected = getSelectedNoteIds();
                if (!selected.length) return [];
                const order = new Map();
                getVisibleTreeItems().forEach((item, index) => {
                    if (item?.dataset?.noteId) {
                        order.set(item.dataset.noteId, index);
                    }
                });
                const fallbackOrder = new Map(selected.map((noteId, index) => [noteId, index]));
                return selected
                    .slice()
                    .sort((a, b) => {
                        const aIndex = order.has(a) ? order.get(a) : 100000 + fallbackOrder.get(a);
                        const bIndex = order.has(b) ? order.get(b) : 100000 + fallbackOrder.get(b);
                        return aIndex - bIndex;
                    });
            };

            const sanitizeNoteHtml = (value) => {
                const html = sanitizeInlineHtml(String(value || '')).trim();
                return html || '';
            };

            const exportSelectedNotes = async () => {
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }
                const topMost = await getTopMostSelection();
                if (!topMost.length) {
                    setStatus('Select notes');
                    return;
                }
                const map = await buildAllNotesMap();
                const lookup = buildChildrenLookup(map);
                const idsToFetch = new Set();
                const collectIds = (noteId) => {
                    if (!noteId || idsToFetch.has(noteId)) return;
                    idsToFetch.add(noteId);
                    const children = lookup.get(noteId) || [];
                    children.forEach((child) => collectIds(child.id));
                };
                topMost.forEach(collectIds);
                const textMap = new Map();
                const htmlMap = new Map();
                for (const noteId of idsToFetch) {
                    try {
                        const result = await notesClient.getNote({ noteId });
                        textMap.set(noteId, result?.text || '');
                        htmlMap.set(noteId, sanitizeNoteHtml(result?.html || ''));
                    } catch (error) {
                        console.warn('[results] failed to fetch note for export', error);
                        textMap.set(noteId, '');
                        htmlMap.set(noteId, '');
                    }
                }
                const renderNode = (noteId) => {
                    const note = map.get(noteId);
                    if (!note) return '';
                    const children = lookup.get(noteId) || [];
                    const html = htmlMap.get(noteId) || '';
                    const text = textMap.get(noteId) || '';
                    const bodyHtml = html
                        ? `<div class="note-body">${html}</div>`
                        : (text ? `<pre>${escapeHtml(text)}</pre>` : '');
                    const childrenHtml = children.map((child) => renderNode(child.id)).join('');
                    return `<li><div class="note-title">${escapeHtml(note.title || 'Untitled')}</div>${bodyHtml}${childrenHtml ? `<ul>${childrenHtml}</ul>` : ''}</li>`;
                };
                const exportHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Notes Export</title>
  <style>
    body { font-family: sans-serif; line-height: 1.5; padding: 24px; color: #111827; }
    ul { list-style: none; padding-left: 18px; }
    .note-title { font-weight: 600; margin-bottom: 4px; }
    pre { background: #f8fafc; padding: 10px 12px; border-radius: 8px; white-space: pre-wrap; }
    .note-body { margin-bottom: 10px; word-break: break-word; }
    .note-body img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <h1>Notes Export</h1>
  <ul>
    ${topMost.map((noteId) => renderNode(noteId)).join('')}
  </ul>
</body>
</html>`;
                const blob = new Blob([exportHtml], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `notes_export_${formatTimestamp().replace(/[: ]/g, '-')}.html`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setStatus('Export ready');
            };

            const mergeSelectedNotes = async () => {
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }
                const orderedIds = getSelectedNoteIdsByVisualOrder();
                if (orderedIds.length < 2) {
                    setStatus('Select at least 2');
                    return;
                }
                await flushSave();
                const selectedSet = new Set(orderedIds);
                const mainNoteId = orderedIds[0];
                const mergeIds = orderedIds.slice(1);
                const noteDataMap = new Map();

                try {
                    for (const noteId of orderedIds) {
                        const result = await notesClient.getNote({ noteId });
                        if (result?.note) {
                            noteDataMap.set(noteId, result);
                        }
                    }
                } catch (error) {
                    console.warn('[results] failed to load notes for merge', error);
                    setStatus('Merge failed');
                    return;
                }

                const mainData = noteDataMap.get(mainNoteId);
                if (!mainData?.note) {
                    setStatus('Main note missing');
                    return;
                }

                const baseHtml = sanitizeNoteHtml(mainData.html || '');
                const baseText = normalizeNoteTextForMerge(mainData.text, baseHtml);
                const baseHtmlBlock = baseHtml || (baseText ? buildHtmlFromText(baseText) : '');
                const combinedTextParts = [];
                const combinedHtmlParts = [];
                if (baseText) combinedTextParts.push(baseText);
                if (baseHtmlBlock) combinedHtmlParts.push(baseHtmlBlock);

                const buildMergedTextBlock = (data) => {
                    const html = sanitizeNoteHtml(data?.html || '');
                    const text = normalizeNoteTextForMerge(data?.text, html);
                    if (!text && !html) return '';
                    const metaLines = buildSourceMetaLines(data?.note);
                    const parts = [];
                    if (metaLines.length) parts.push(metaLines.join('\n'));
                    if (text) parts.push(text);
                    return parts.join('\n');
                };

                const buildMergedHtmlBlock = (data) => {
                    const html = sanitizeNoteHtml(data?.html || '');
                    const text = normalizeNoteTextForMerge(data?.text, html);
                    if (!text && !html) return '';
                    const metaLines = buildSourceMetaLines(data?.note);
                    const metaHtml = metaLines.length
                        ? `<div class="note-merge-meta">${metaLines.map((line) => escapeHtml(line)).join('<br>')}</div>`
                        : '';
                    const bodyHtml = html || (text ? buildHtmlFromText(text) : '');
                    if (!metaHtml) return bodyHtml;
                    return bodyHtml ? `${metaHtml}<br>${bodyHtml}` : metaHtml;
                };

                for (const noteId of mergeIds) {
                    const data = noteDataMap.get(noteId);
                    if (!data?.note) continue;
                    const textBlock = buildMergedTextBlock(data);
                    const htmlBlock = buildMergedHtmlBlock(data);
                    if (textBlock) combinedTextParts.push(textBlock);
                    if (htmlBlock) combinedHtmlParts.push(htmlBlock);
                }

                const combinedText = combinedTextParts.filter(Boolean).join('\n\n');
                const combinedHtml = combinedHtmlParts.filter(Boolean).join('<br><br>');

                try {
                    let movedChildren = false;
                    for (const noteId of mergeIds) {
                        const data = noteDataMap.get(noteId);
                        const tabId = data?.note?.tabId || state.tabId;
                        if (!tabId) continue;
                        const result = await notesClient.listChildren({ tabId, parentId: noteId });
                        const children = result?.notes || [];
                        for (const child of children) {
                            if (!child?.id || selectedSet.has(child.id)) continue;
                            await notesClient.moveNote({
                                noteId: child.id,
                                targetParentId: mainNoteId
                            });
                            movedChildren = true;
                        }
                    }

                    await notesClient.updateNoteText({
                        noteId: mainNoteId,
                        text: combinedText,
                        html: combinedHtml
                    });

                    for (const noteId of mergeIds) {
                        await notesClient.deleteNote({ noteId });
                    }

                    state.activeNoteId = mainNoteId;
                    state.selectedNoteIds.clear();
                    state.selectedNoteIds.add(mainNoteId);
                    state.anchorNoteId = mainNoteId;
                    if (movedChildren) {
                        setExpanded(mainNoteId, true);
                    }
                    await refreshNotesList();
                    await selectNote(mainNoteId, { skipSave: true, force: true, focus: true, preserveSelection: true });
                    setStatus(`Merged ${orderedIds.length} notes`);
                } catch (error) {
                    console.warn('[results] failed to merge notes', error);
                    setStatus('Merge failed');
                }
            };

            const flushPendingNoteClick = async () => {
                if (!notesClickTimer || !notesClickTargetId) return;
                const targetId = notesClickTargetId;
                clearTimeout(notesClickTimer);
                notesClickTimer = null;
                notesClickTargetId = null;
                await handleNoteSingleClick(targetId);
            };

            const getDomSelectedNoteIds = () => {
                if (!notesTree) return [];
                return Array.from(notesTree.querySelectorAll('.notes-tree-item[aria-selected="true"]'))
                    .map((item) => item.dataset.noteId)
                    .filter(Boolean);
            };

            const collectDeletionCandidates = async (pendingTargetId) => {
                const primary = await getTopMostSelection();
                if (primary.length) return primary;
                const fallback = new Set();
                state.selectedNoteIds.forEach((noteId) => {
                    if (noteId) fallback.add(noteId);
                });
                if (state.activeNoteId) fallback.add(state.activeNoteId);
                if (state.anchorNoteId) fallback.add(state.anchorNoteId);
                if (pendingTargetId) fallback.add(pendingTargetId);
                if (notesClickTargetId) fallback.add(notesClickTargetId);
                getDomSelectedNoteIds().forEach((noteId) => fallback.add(noteId));
                return Array.from(fallback).filter(Boolean);
            };

            const deleteSelectedNotes = async () => {
                const pendingTargetId = notesClickTargetId;
                await flushPendingNoteClick();
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return;
                }
                const candidates = await collectDeletionCandidates(pendingTargetId);
                if (!candidates.length) {
                    setStatus('Select notes');
                    return;
                }
                try {
                    for (const noteId of candidates) {
                        await notesClient.deleteNote({ noteId });
                    }
                    state.selectedNoteIds.clear();
                    state.anchorNoteId = null;
                    await refreshNotesList();
                    setStatus('Deleted');
                } catch (error) {
                    console.warn('[results] failed to delete notes', error);
                    setStatus('Delete failed');
                }
            };

            const toggleSelectAll = async () => {
                const allIds = await getAllNoteIds();
                if (!allIds.length) return;
                const selectedCount = state.selectedNoteIds.size;
                if (selectedCount === allIds.length) {
                    state.selectedNoteIds.clear();
                    state.anchorNoteId = null;
                } else {
                    state.selectedNoteIds.clear();
                    allIds.forEach((id) => state.selectedNoteIds.add(id));
                    state.anchorNoteId = allIds[0];
                    if (!state.activeNoteId && allIds[0]) {
                        await selectNote(allIds[0], { preserveSelection: true });
                    }
                }
                syncSelectionStyles();
            };

            const initNotes = async () => {
                try {
                    const initResult = await notesClient.init();
                    const defaultTabId = initResult?.defaultTabId || null;
                    state.defaultTabId = defaultTabId;
                    let scratch = null;
                    try {
                        scratch = await notesClient.getOrCreateScratch(scratchConfig);
                    } catch (error) {
                        console.warn('[results] failed to load scratch note', error);
                    }
                    await refreshTabs();
                    await pruneEmptyTabs();
                    if (!state.tabs.length && defaultTabId) {
                        state.tabs = [{ tabId: defaultTabId, name: 'Home' }];
                    }
                    if (!state.tabs.length && scratch?.tabId) {
                        state.tabs = [{ tabId: scratch.tabId, name: 'Home' }];
                    }
                    if (!state.tabs.length && notesClient?.createTab) {
                        try {
                            await notesClient.createTab({ name: 'Home' });
                            await refreshTabs();
                        } catch (error) {
                            console.warn('[results] failed to create default tab', error);
                        }
                    }
                    state.tabId = scratch?.tabId || defaultTabId || state.tabs[0]?.tabId || null;
                    renderTabs(state.tabs);
                    persistActiveNotesTab();
                    const scratchHasContent = String(scratch?.text || '').trim().length > 0;
                    if (scratch?.noteId && scratch?.tabId === state.tabId && scratchHasContent) {
                        state.activeNoteId = scratch.noteId;
                    }
                    await refreshNotesList();
                    if (scratch?.noteId && scratch?.tabId === state.tabId && scratchHasContent) {
                        await selectNote(scratch.noteId, { skipSave: true, force: true });
                    }
                } catch (error) {
                    console.warn('[results] failed to init notes', error);
                    if (notesEmpty) {
                        notesEmpty.textContent = 'Notes offline.';
                    }
                }
            };

            if (promptInput) {
                promptInput.addEventListener('input', () => {
                    if (editorState.suppressInput) return;
                    if (editorState.mode !== 'EDITING') return;
                    if (!editorState.suppressTitleSync && !editorState.isTitleEditing) {
                        updateEditingTitle(getEditorValue());
                    }
                    scheduleSave();
                });
            }
            if (promptNoteView) {
                promptNoteView.addEventListener('input', () => {
                    if (editorState.suppressInput) return;
                    const isNoteEditing = editorState.mode === 'EDITING';
                    const isRichPrompt = editorState.mode === 'PROMPT' && useInputRichMode;
                    if (!isNoteEditing && !isRichPrompt) return;
                    const { text } = getEditorContent();
                    syncPromptValue(text, { dispatch: isRichPrompt });
                    if (isNoteEditing && !editorState.suppressTitleSync && !editorState.isTitleEditing) {
                        updateEditingTitle(text);
                    }
                    if (isNoteEditing) {
                        scheduleSave();
                    }
                });
            }

            const handleNoteSingleClick = async (noteId, { isShift = false, isMeta = false } = {}) => {
                if (!noteId) return;
                if (isShift) {
                    const anchor = state.anchorNoteId || noteId;
                    selectRange(anchor, noteId, { additive: isMeta });
                    await selectNote(noteId, { focus: true, preserveSelection: true });
                    return;
                }
                if (isMeta) {
                    toggleSelection(noteId);
                    await selectNote(noteId, { focus: true, preserveSelection: true });
                    return;
                }
                if (editorState.mode === 'EDITING' && editorState.noteId) {
                    if (!shouldAutosaveContent(getEditorContent())) {
                        restoreEditingTitle();
                    }
                    await flushSave();
                }
                setSingleSelection(noteId);
                const notePayload = await selectNote(noteId, { focus: true, preserveSelection: true });
                await applyNoteToPrompt(noteId, { mode: 'VIEWING', noteText: notePayload });
            };

            const handleNoteDoubleClick = async (noteId) => {
                if (!noteId) return;
                if (editorState.mode === 'EDITING' && editorState.noteId && editorState.noteId !== noteId) {
                    if (!shouldAutosaveContent(getEditorContent())) {
                        restoreEditingTitle();
                    }
                    await flushSave();
                }
                const notePayload = await selectNote(noteId, { focus: true, preserveSelection: false, force: true });
                await applyNoteToPrompt(noteId, { mode: 'EDITING', noteText: notePayload });
            };

            notesTree?.addEventListener('click', async (event) => {
                const actionButton = event.target.closest('[data-action]');
                if (actionButton) {
                    const action = actionButton.getAttribute('data-action');
                    const noteId = actionButton.getAttribute('data-note-id');
                    if (notesClickTimer) {
                        clearTimeout(notesClickTimer);
                        notesClickTimer = null;
                        notesClickTargetId = null;
                    }
                    if (action === 'add-child') {
                        event.stopPropagation();
                        createChildNote(noteId);
                        return;
                    }
                    if (action === 'toggle') {
                        event.stopPropagation();
                        toggleExpand(noteId);
                        return;
                    }
                }
                if (getEditableTitleTarget(event.target)) return;
                const item = event.target.closest('.notes-tree-item');
                if (!item) return;
                const noteId = item.dataset.noteId;
                const now = performance.now();
                const withinDelay = notesClickTime > 0 && (now - notesClickTime) < NOTE_DBLCLICK_DELAY;
                const isDouble = withinDelay && (notesClickTargetId === noteId);
                const isChildDouble = withinDelay && notesClickTargetId && isDescendantNote(noteId, notesClickTargetId);
                if (isDouble) {
                    clearTimeout(notesClickTimer);
                    notesClickTimer = null;
                    notesClickTargetId = null;
                    await handleNoteDoubleClick(noteId);
                    return;
                }
                if (isChildDouble) {
                    const targetId = notesClickTargetId;
                    clearTimeout(notesClickTimer);
                    notesClickTimer = null;
                    notesClickTargetId = null;
                    await handleNoteDoubleClick(targetId);
                    return;
                }
                notesClickTargetId = noteId;
                notesClickTime = now;
                const modifiers = {
                    isShift: event.shiftKey,
                    isMeta: event.metaKey || event.ctrlKey
                };
                if (notesClickTimer) clearTimeout(notesClickTimer);
                notesClickTimer = setTimeout(() => {
                    notesClickTimer = null;
                    handleNoteSingleClick(noteId, modifiers);
                }, NOTE_DBLCLICK_DELAY);
            });

            notesTree?.addEventListener('focusin', (event) => {
                const titleEl = getEditableTitleTarget(event.target);
                if (!titleEl) return;
                editorState.isTitleEditing = true;
            });

            notesTree?.addEventListener('focusout', (event) => {
                const titleEl = getEditableTitleTarget(event.target);
                if (!titleEl) return;
                editorState.isTitleEditing = false;
                const normalized = normalizeNoteTitle(titleEl.textContent);
                if (!normalized) {
                    restoreEditingTitle();
                    return;
                }
                if (titleEl.textContent !== normalized) {
                    titleEl.textContent = normalized;
                }
                if (!promptInput) return;
                if (editorState.mode !== 'EDITING' || !editorState.noteId) return;
                const item = titleEl.closest('.notes-tree-item');
                const noteId = item?.dataset?.noteId;
                if (!noteId || noteId !== editorState.noteId) return;
                const currentText = getEditorValue();
                const nextText = buildTextWithTitle(currentText, normalized);
                if (nextText === currentText) return;
                editorState.suppressTitleSync = true;
                if (promptNoteView && editorState.mode !== 'PROMPT') {
                    const currentHtml = getNoteViewHtml();
                    const updatedHtml = updateNoteHtmlTitle(currentHtml, normalized);
                    editorState.suppressInput = true;
                    if (updatedHtml) {
                        replaceChildrenFromHtml(promptNoteView, updatedHtml);
                    } else {
                        promptNoteView.textContent = nextText;
                    }
                    editorState.suppressInput = false;
                }
                syncPromptValue(nextText);
                editorState.suppressTitleSync = false;
                scheduleSave();
            });

            notesTree?.addEventListener('input', (event) => {
                const titleEl = getEditableTitleTarget(event.target);
                if (!titleEl) return;
                if (!promptInput) return;
                if (editorState.mode !== 'EDITING' || !editorState.noteId) return;
                const item = titleEl.closest('.notes-tree-item');
                const noteId = item?.dataset?.noteId;
                if (!noteId || noteId !== editorState.noteId) return;
                const normalized = normalizeNoteTitle(titleEl.textContent);
                if (!normalized) return;
                const currentText = getEditorValue();
                const nextText = buildTextWithTitle(currentText, normalized);
                if (nextText === currentText) return;
                editorState.suppressTitleSync = true;
                if (promptNoteView && editorState.mode !== 'PROMPT') {
                    const currentHtml = getNoteViewHtml();
                    const updatedHtml = updateNoteHtmlTitle(currentHtml, normalized);
                    editorState.suppressInput = true;
                    if (updatedHtml) {
                        replaceChildrenFromHtml(promptNoteView, updatedHtml);
                    } else {
                        promptNoteView.textContent = nextText;
                    }
                    editorState.suppressInput = false;
                }
                syncPromptValue(nextText);
                editorState.suppressTitleSync = false;
                scheduleSave();
            });

            notesTree?.addEventListener('keydown', (event) => {
                const titleEl = getEditableTitleTarget(event.target);
                if (!titleEl) return;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    titleEl.blur();
                }
            });

            document.addEventListener('click', async (event) => {
                const target = event.target;
                const inPrompt = target?.closest('.prompt-container') || target?.closest('.prompt-group');
                const inNotesPanel = notesPanel && notesPanel.contains(target);
                if (editorState.mode !== 'PROMPT') {
                    if (inPrompt || inNotesPanel) return;
                    await exitNotesMode();
                    return;
                }
                if (sessionPreview.isActive && !inPrompt && !inNotesPanel) {
                    restoreSessionPreview();
                }
            });

            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                if (editorState.mode !== 'EDITING') return;
                if (state.saveTimer) clearTimeout(state.saveTimer);
                restoreEditingTitle();
                setEditorValue(editorState.originalText);
                setEditorMode('PROMPT');
            });

            document.addEventListener('click', (event) => {
                const btn = event.target.closest('#clear-prompt-btn');
                if (!btn) return;
                if (editorState.mode !== 'EDITING') return;
                if (state.saveTimer) clearTimeout(state.saveTimer);
                restoreEditingTitle();
                setEditorMode('PROMPT');
            });

            notesTree?.addEventListener('dragstart', (event) => {
                const target = event.target;
                if (getEditableTitleTarget(target)) return;
                if (target?.closest('button') || target?.closest('input')) return;
                const item = target?.closest('.notes-tree-item');
                if (!item || !notesTree.contains(item)) return;
                const noteId = item.dataset.noteId;
                if (!noteId) return;
                dragState.noteId = noteId;
                dragState.targetId = null;
                dragState.position = null;
                event.dataTransfer.effectAllowed = 'move';
                try {
                    event.dataTransfer.setData('text/plain', noteId);
                } catch (_) {}
            });

            notesTree?.addEventListener('dragover', (event) => {
                const isNoteDrag = !!dragState.noteId;
                const types = Array.from(event.dataTransfer?.types || []);
                const isTextDrag = types.includes(DRAG_MIME) || types.includes('text/plain');
                if (!isNoteDrag && !isTextDrag) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = isNoteDrag ? 'move' : 'copy';
                const { item, targetId, position } = resolveDropTarget(event);
                if (isNoteDrag) {
                    const draggedItem = notesTree.querySelector(`.notes-tree-item[data-note-id="${dragState.noteId}"]`);
                    if (!item || !notesTree.contains(item) || item === draggedItem) {
                        dragState.targetId = null;
                        dragState.position = 'root';
                        setDropIndicator(null);
                        return;
                    }
                    if (draggedItem && draggedItem.contains(item)) {
                        dragState.targetId = null;
                        dragState.position = null;
                        clearDropIndicators();
                        return;
                    }
                    dragState.targetId = targetId;
                    dragState.position = position;
                    setDropIndicator(item, position);
                } else {
                    textDragState.targetId = targetId;
                    textDragState.position = position;
                    setDropIndicator(item, position);
                }
            });

            notesTree?.addEventListener('dragend', () => {
                dragState.noteId = null;
                dragState.targetId = null;
                dragState.position = null;
                textDragState.targetId = null;
                textDragState.position = null;
                clearDropIndicators();
            });

            notesTree?.addEventListener('drop', async (event) => {
                event.preventDefault();
                if (dragState.noteId) {
                    const noteId = dragState.noteId;
                    const targetId = dragState.targetId;
                    const position = dragState.position;
                    clearDropIndicators();
                    dragState.noteId = null;
                    dragState.targetId = null;
                    dragState.position = null;

                    let targetParentId = null;
                    let beforeId = null;
                    let afterId = null;

                    if (!targetId && position !== 'root') return;
                    if (!targetId || position === 'root') {
                        targetParentId = null;
                    } else if (position === 'inside') {
                        targetParentId = targetId;
                    } else {
                        const targetItem = notesTree.querySelector(`.notes-tree-item[data-note-id="${targetId}"]`);
                        const parentId = targetItem?.dataset?.parentId || null;
                        targetParentId = parentId || null;
                        if (position === 'before') beforeId = targetId;
                        if (position === 'after') afterId = targetId;
                    }

                    if (noteId === targetId) return;
                    if (!notesClient?.moveNote) return;
                    try {
                        await notesClient.moveNote({
                            noteId,
                            targetParentId,
                            beforeId,
                            afterId
                        });
                        state.activeNoteId = noteId;
                        lastActiveByTab.set(state.tabId, noteId);
                        if (targetParentId) {
                            setExpanded(targetParentId, true);
                        }
                        await refreshNotesList();
                        setStatus('Note moved');
                    } catch (error) {
                        console.warn('[results] failed to move note', error);
                        setStatus('Move failed');
                    }
                    return;
                }

                const payload = getDragPayload(event);
                if (!payload?.text) return;
                const target = textDragState.targetId ? textDragState : resolveDropTarget(event);
                textDragState.targetId = null;
                textDragState.position = null;
                clearDropIndicators();
                await createNoteFromDrag(payload, target);
            });

            notesTree?.addEventListener('dragleave', (event) => {
                if (!notesTree.contains(event.relatedTarget)) {
                    clearDropIndicators();
                }
            });

            promptInput?.addEventListener('dragstart', (event) => {
                const text = getPromptDragText();
                if (!text) return;
                const payload = buildDragPayload({ text, type: 'prompt' });
                setDragPayload(event, payload);
            });

            llmResultsContainer?.addEventListener('dragstart', (event) => {
                const target = event.target;
                if (!target?.closest) return;
                const outputEl = target.closest('.llm-panel .output');
                if (!outputEl || !llmResultsContainer.contains(outputEl)) return;
                const text = getOutputDragText(outputEl);
                if (!text) return;
                const llmName = resolveLlmNameForOutput(outputEl);
                const payload = buildDragPayload({ text, type: 'response', llmName });
                setDragPayload(event, payload);
            });

            notesTree?.addEventListener('keydown', async (event) => {
                const key = event.key;
                if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return;
                const items = getVisibleTreeItems();
                if (!items.length) return;
                const activeElement = document.activeElement?.closest('.notes-tree-item');
                const current = (activeElement && notesTree.contains(activeElement))
                    ? activeElement
                    : items.find((item) => item.dataset.noteId === state.activeNoteId) || items[0];
                if (!current) return;
                const currentId = current.dataset.noteId;
                if (!currentId) return;
                event.preventDefault();

                if (key === 'ArrowUp') {
                    const idx = items.indexOf(current);
                    const target = items[idx - 1];
                    if (target) {
                        await selectNote(target.dataset.noteId, { focus: true });
                    }
                    return;
                }
                if (key === 'ArrowDown') {
                    const idx = items.indexOf(current);
                    const target = items[idx + 1];
                    if (target) {
                        await selectNote(target.dataset.noteId, { focus: true });
                    }
                    return;
                }
                if (key === 'ArrowLeft') {
                    const expanded = current.getAttribute('aria-expanded') === 'true';
                    if (itemHasChildren(current) && expanded) {
                        await toggleExpand(currentId);
                        focusNoteItem(currentId);
                        return;
                    }
                    const parent = getParentItem(current);
                    if (parent?.dataset?.noteId) {
                        await selectNote(parent.dataset.noteId, { focus: true });
                    }
                    return;
                }
                if (key === 'ArrowRight') {
                    const expanded = current.getAttribute('aria-expanded') === 'true';
                    if (itemHasChildren(current) && !expanded) {
                        await toggleExpand(currentId);
                        focusNoteItem(currentId);
                        return;
                    }
                    if (itemHasChildren(current) && expanded) {
                        const firstChild = getFirstChildItem(current);
                        if (firstChild?.dataset?.noteId) {
                            await selectNote(firstChild.dataset.noteId, { focus: true });
                        }
                    }
                    return;
                }
                if (key === 'Enter') {
                    if (itemHasChildren(current)) {
                        await toggleExpand(currentId);
                        focusNoteItem(currentId);
                    }
                }
            });

            notesSearch?.addEventListener('input', (event) => {
                const value = event.target.value;
                setSearchQuery(value);
                if (notesSearchClear) {
                    notesSearchClear.classList.toggle('is-visible', String(value || '').trim().length > 0);
                }
            });

            notesSearchClear?.addEventListener('click', () => {
                if (!notesSearch) return;
                notesSearch.value = '';
                setSearchQuery('');
                notesSearchClear.classList.remove('is-visible');
                notesSearch.focus();
            });

            notesAddRootBtn?.addEventListener('click', () => {
                createRootNote();
            });

            notesSelectAll?.addEventListener('change', () => {
                toggleSelectAll();
            });

            notesExportBtn?.addEventListener('click', () => {
                exportSelectedNotes();
            });

            const attachBackupAction = (element, handler) => {
                if (!element) return;
                element.addEventListener('click', handler);
            };
            attachBackupAction(notesBackupExportBtn, exportBackup);
            attachBackupAction(notesHintBackupExportBtn, exportBackup);
            attachBackupAction(notesBackupImportBtn, importBackup);
            attachBackupAction(notesHintBackupImportBtn, importBackup);

            notesMergeBtn?.addEventListener('click', () => {
                mergeSelectedNotes();
            });

            notesDeleteBtn?.addEventListener('click', () => {
                deleteSelectedNotes();
            });

            notesTabAdd?.addEventListener('click', () => {
                createTab();
            });

            notesSessionsTab?.addEventListener('click', () => {
                setSessionsActive(true);
            });

            sessionsSaveBtn?.addEventListener('click', () => {
                saveCurrentSession();
            });

            sessionsDeleteBtn?.addEventListener('click', () => {
                deleteSelectedSession();
            });

            const SESSION_DBLCLICK_DELAY = 320;
            let sessionsClickTimer = null;
            let sessionsClickTime = 0;
            let sessionsClickTargetId = null;

            sessionsList?.addEventListener('click', async (event) => {
                const runButton = event.target.closest('.sessions-item-run');
                if (runButton && sessionsList.contains(runButton)) {
                    event.stopPropagation();
                    await runSessionById(runButton.dataset.sessionId);
                    return;
                }
                const item = event.target.closest('.sessions-item');
                if (!item || !sessionsList.contains(item)) return;
                if (event.target.closest('input')) return;
                const sessionId = item.dataset.sessionId;
                const now = performance.now();
                const withinDelay = sessionsClickTime > 0 && (now - sessionsClickTime) < SESSION_DBLCLICK_DELAY;
                const isDouble = withinDelay && sessionsClickTargetId === sessionId;
                if (isDouble) {
                    if (sessionsClickTimer) {
                        clearTimeout(sessionsClickTimer);
                        sessionsClickTimer = null;
                    }
                    sessionsClickTargetId = null;
                    sessionsClickTime = 0;
                    if (event.target.closest('.sessions-item-name') || event.target.closest('.sessions-item')) {
                        startRenameSession(item);
                    }
                    return;
                }
                sessionsClickTargetId = sessionId;
                sessionsClickTime = now;
                if (sessionsClickTimer) clearTimeout(sessionsClickTimer);
                sessionsClickTimer = setTimeout(async () => {
                    selectSession(sessionId);
                    const session = sessionsState.sessions.find((entry) => entry.id === sessionId);
                    if (session) {
                        await showSessionPreview(session);
                    }
                    sessionsClickTimer = null;
                }, SESSION_DBLCLICK_DELAY);
            });

            sessionsList?.addEventListener('dragstart', (event) => {
                const item = event.target.closest('.sessions-item');
                if (!item || !sessionsList.contains(item)) return;
                if (event.target.closest('input')) return;
                sessionsState.dragId = item.dataset.sessionId;
                item.classList.add('is-dragging');
                event.dataTransfer.effectAllowed = 'move';
                try {
                    event.dataTransfer.setData('text/plain', sessionsState.dragId);
                } catch (_) {}
            });

            sessionsList?.addEventListener('dragover', (event) => {
                if (!sessionsState.dragId) return;
                const item = event.target.closest('.sessions-item');
                if (!item || !sessionsList.contains(item)) return;
                if (item.dataset.sessionId === sessionsState.dragId) return;
                event.preventDefault();
                clearSessionDropIndicators();
                const rect = item.getBoundingClientRect();
                const offsetY = event.clientY - rect.top;
                const position = offsetY > rect.height / 2 ? 'after' : 'before';
                item.classList.add(position === 'after' ? 'is-drop-after' : 'is-drop-before');
                sessionsState.dragOverId = item.dataset.sessionId;
                sessionsState.dragPosition = position;
            });

            sessionsList?.addEventListener('drop', async (event) => {
                if (!sessionsState.dragId) return;
                event.preventDefault();
                const dragId = sessionsState.dragId;
                const targetId = sessionsState.dragOverId;
                const position = sessionsState.dragPosition || 'before';
                sessionsState.dragId = null;
                sessionsState.dragOverId = null;
                sessionsState.dragPosition = null;
                clearSessionDropIndicators();
                sessionsList.querySelectorAll('.sessions-item').forEach((item) => {
                    item.classList.remove('is-dragging');
                });
                await reorderSessions(dragId, targetId, position);
            });

            sessionsList?.addEventListener('dragend', () => {
                sessionsState.dragId = null;
                sessionsState.dragOverId = null;
                sessionsState.dragPosition = null;
                clearSessionDropIndicators();
                sessionsList.querySelectorAll('.sessions-item').forEach((item) => {
                    item.classList.remove('is-dragging');
                });
            });

            sessionsList?.addEventListener('dragleave', (event) => {
                if (!sessionsList.contains(event.relatedTarget)) {
                    clearSessionDropIndicators();
                }
            });

            promptSaveBtn?.addEventListener('click', () => {
                savePromptNote();
            });

            saveSessionBtn?.addEventListener('click', () => {
                saveSessionNotes();
            });

            responseSaveButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    saveResponseNote({
                        outputId: btn.dataset.target,
                        llmName: btn.dataset.llmName || 'Response'
                    });
                });
            });

            const savePipelineRun = async ({ title, text, json } = {}) => {
                if (!text) {
                    setStatus('Pipeline output empty');
                    return false;
                }
                if (!await ensureNotesReady()) {
                    setStatus('Notes offline');
                    return false;
                }
                const timestamp = formatTimestamp();
                const noteTitle = title ? `${title} - ${timestamp}` : `Pipeline Run - ${timestamp}`;
                const body = [
                    text,
                    '',
                    '---',
                    `Source: ${location.href}`,
                    `Saved: ${timestamp}`
                ].join('\n');
                try {
                    const created = await createNoteWithFallback({
                        tabId: state.tabId,
                        parentId: null,
                        kind: 'pipeline',
                        title: noteTitle,
                        text: body,
                        source: {
                            origin: 'comparator',
                            type: 'pipeline',
                            pageUrl: location.href,
                            ts: Date.now(),
                            payload: json || null
                        }
                    });
                    if (created?.noteId) {
                        state.activeNoteId = created.noteId;
                        lastActiveByTab.set(state.tabId, created.noteId);
                        setSingleSelection(created.noteId);
                    }
                    await syncAfterNoteCreate(created);
                    setStatus('Pipeline saved');
                    return true;
                } catch (error) {
                    console.warn('[results] failed to save pipeline', error);
                    setStatus(formatStatusError('Save failed', error), 3200);
                    return false;
                }
            };

            window.PipelineNotes = {
                ...(window.PipelineNotes || {}),
                savePipelineRun
            };

            notesClient.onEvent((event) => {
                if (event?.event !== notesClient.EVENTS?.REVISION_BUMP) return;
                if (!state.tabId || event.tabId !== state.tabId) return;
                refreshNotesList();
                refreshActiveNote();
            });

            window.addEventListener('beforeunload', () => {
                if (!chrome?.storage?.local?.set) return;
                try {
                    chrome.storage.local.set({ [NOTES_ACTIVE_TAB_KEY]: null });
                } catch (error) {
                    console.warn('[results] failed to clear active tab', error);
                }
            });

            await loadSessions();
            renderSessionsList();
            setSessionsActive(false);

            setEditorEnabled(false);
            initNotes();
        }
    }

    tooltipTargets.forEach(target => {
        target.addEventListener('mouseenter', () => positionFloatingTooltip(target));
        target.addEventListener('focus', () => positionFloatingTooltip(target));
        target.addEventListener('mouseleave', () => hideFloatingTooltip(target));
        target.addEventListener('blur', () => hideFloatingTooltip(target));
    });

    window.addEventListener('scroll', () => {
        if (activeTooltipTarget) positionFloatingTooltip(activeTooltipTarget);
        if (responseSelectionToolbarEl?.classList.contains('vis') && responseSelectionState.target) {
            showResponseSelectionToolbar(responseSelectionState.target);
        }
    }, { passive: true });

    window.addEventListener('resize', () => {
        if (activeTooltipTarget) positionFloatingTooltip(activeTooltipTarget);
        if (responseSelectionToolbarEl?.classList.contains('vis') && responseSelectionState.target) {
            showResponseSelectionToolbar(responseSelectionState.target);
        }
        requestAnimationFrame(layoutModifierMasonry);
    });

    const setResultsViewMode = (mode = 'grid') => {
        if (!llmResultsContainer) return;
        const useStack = mode === 'stack';
        llmResultsContainer.classList.remove('view-grid', 'view-stack');
        llmResultsContainer.classList.add(useStack ? 'view-stack' : 'view-grid');
        if (viewGridBtn) viewGridBtn.classList.toggle('is-active', !useStack);
        if (viewStackBtn) viewStackBtn.classList.toggle('is-active', useStack);
    };

    setResultsViewMode('grid');

    const attachPanelExpansionHandlers = () => {
        if (!llmPanels || !llmPanels.length) return;
        llmPanels.forEach(panel => {
            const titleEl = panel.querySelector('.llm-title');
            const outputEl = panel.querySelector('.output');
            if (!titleEl || !outputEl) return;
            const collapsedHeight = outputEl.dataset.defaultMaxHeight || DEFAULT_PANEL_OUTPUT_MAX_HEIGHT;
            titleEl.addEventListener('dblclick', () => {
                const isExpanded = panel.classList.toggle('llm-panel-expanded');
                if (isExpanded) {
                    outputEl.dataset.collapsedMaxHeight = outputEl.style.maxHeight || collapsedHeight;
                    outputEl.style.maxHeight = EXPANDED_PANEL_OUTPUT_MAX_HEIGHT;
                    outputEl.style.minHeight = '240px';
                    panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
                } else {
                    const fallbackHeight = outputEl.dataset.collapsedMaxHeight || collapsedHeight;
                    outputEl.style.maxHeight = fallbackHeight;
                    outputEl.style.minHeight = '';
                }
            });
        });
    };
    attachPanelExpansionHandlers();
    ensureFavoritePanelUI();
    ensureMainCardFavoriteButtons();
    ensureResponseSelectionToolbar();

    if (viewGridBtn) {
        viewGridBtn.addEventListener('click', () => setResultsViewMode('grid'));
    }
    if (viewStackBtn) {
        viewStackBtn.addEventListener('click', () => setResultsViewMode('stack'));
    }

    const getPanelByLLMName = (llmName) => {
        if (!llmName) return null;
        const targetName = llmName.trim().toLowerCase();
        return Array.from(llmPanels || []).find((panel) => {
            const title = panel.querySelector('.llm-title');
            return title && title.textContent.trim().toLowerCase() === targetName;
        }) || null;
    };

    const ensureApiIndicator = (llmName) => {
        if (!llmName) return null;
        if (apiIndicatorRegistry.has(llmName)) {
            return apiIndicatorRegistry.get(llmName);
        }
        const panel = getPanelByLLMName(llmName);
        if (!panel) return null;
        const referenceBtn = panel.querySelector('.status-ping-btn');
        const referenceNode = referenceBtn || panel.querySelector('.status-indicator');
        if (!referenceNode) return null;
        const indicator = document.createElement('span');
        indicator.className = 'api-indicator is-idle';
        indicator.dataset.llmName = llmName;
        indicator.textContent = 'API';
        indicator.setAttribute('role', 'button');
        indicator.tabIndex = 0;
        indicator.setAttribute('aria-label', `${llmName} API status. Double-click to open telemetry.`);
        referenceNode.insertAdjacentElement('afterend', indicator);
        apiIndicatorRegistry.set(llmName, indicator);
        return indicator;
    };

    const setApiIndicatorState = (llmName, state = 'idle', meta = {}) => {
        if (!llmName) return;
        const indicator = ensureApiIndicator(llmName);
        if (!indicator) return;
        const normalized = state === 'active' || state === 'pending' ? state : 'idle';
        indicator.classList.remove('is-idle', 'is-active', 'is-pending');
        indicator.classList.add(`is-${normalized}`);
        indicator.dataset.state = normalized;
        const detailParts = [];
        if (meta.endpoint) {
            detailParts.push(`Endpoint: ${meta.endpoint}`);
        }
        if (meta.connectionTimeout || meta.responseTimeout) {
            const connectMs = meta.connectionTimeout ? `${meta.connectionTimeout}ms` : '?';
            const responseMs = meta.responseTimeout ? `${meta.responseTimeout}ms` : '?';
            detailParts.push(`Timeouts ${connectMs}/${responseMs}`);
        }
        const statusText = meta.message || (detailParts.length ? detailParts.join(' • ') : 'API status');
        indicator.title = `${statusText} • Double-click to open telemetry`;
        indicator.setAttribute('aria-label', `${llmName} API status: ${statusText}. Double-click to open telemetry.`);
        apiIndicatorState[llmName] = normalized;
    };

    const initializeApiIndicators = () => {
        Array.from(llmPanels || []).forEach((panel) => {
            const title = panel.querySelector('.llm-title');
            const llmName = title?.textContent?.trim();
            if (!llmName) return;
            ensureApiIndicator(llmName);
            setApiIndicatorState(llmName, apiIndicatorState[llmName] || 'idle');
        });
    };

    const setSelectorHealthStatus = (text) => {
        if (!selectorHealthStatus) return;
        selectorHealthStatus.textContent = text || '';
    };

    const formatSelectorHealthTime = (ts) => ts ? new Date(ts).toLocaleString() : '—';

    const formatSelectorHealthPct = (value, total) => {
        if (!total) return '—';
        const pct = Math.round((Number(value || 0) / total) * 100);
        return `${pct}%`;
    };

    const truncateSelectorHealthText = (value, limit = 46) => {
        const text = String(value || '').trim();
        if (!text) return '';
        if (text.length <= limit) return text;
        return `${text.slice(0, Math.max(0, limit - 1))}…`;
    };

    const renderSelectorHealth = (summary) => {
        if (!selectorHealthSummary || !selectorHealthTable) return;
        const rows = Array.isArray(summary?.rows) ? summary.rows : [];
        const totalSamples = Number(summary?.totalSamples || 0);
        const updatedAt = summary?.updatedAt || null;
        selectorHealthSnapshot = summary && typeof summary === 'object' ? summary : null;

        if (!rows.length || totalSamples === 0) {
            replaceChildrenFromHtml(selectorHealthSummary, '<span class="help-text">No selector health data</span>');
            replaceChildrenFromHtml(selectorHealthTable, '<p class="help-text">No data</p>');
            setSelectorHealthStatus('no data');
            return;
        }

        const updatedLabel = `Updated: ${formatSelectorHealthTime(updatedAt)}`;
        const sampleLabel = `Samples: ${totalSamples}`;
        selectorHealthSummary.textContent = `${updatedLabel} · ${sampleLabel}`;
        setSelectorHealthStatus(sampleLabel);

        const table = document.createElement('table');
        table.className = 'selector-health-table-grid';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Model', 'Element', 'Metrics', 'Last override', 'Last check', 'Active UI'].forEach((text) => {
            const th = document.createElement('th');
            th.textContent = text;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        const tbody = document.createElement('tbody');
        table.append(thead, tbody);

        renderIncrementalList(tbody, rows, {
            getId: (row) => `${row?.modelName || 'unknown'}:${row?.elementType || 'unknown'}`,
            getHash: (row) => JSON.stringify([
                row?.counts,
                row?.lastOverride,
                row?.lastHealthCheck,
                row?.activeUiVersion,
                row?.activeTabId
            ]),
            renderItem: (row) => {
                const tr = document.createElement('tr');
                const total = Number(row?.counts?.total || 0);
                const note = total > 0 && total < 50
                    ? document.createRange().createContextualFragment('<span class="selector-health-note">Not enough data</span>')
                    : null;
                const chips = [
                    { key: 'L1', className: 'is-l1', value: row?.counts?.L1 || 0 },
                    { key: 'L2', className: 'is-l2', value: row?.counts?.L2 || 0 },
                    { key: 'L3', className: 'is-l3', value: row?.counts?.L3 || 0 },
                    { key: 'L4', className: 'is-l4', value: row?.counts?.L4 || 0 },
                    { key: 'fail', className: 'is-fail', value: row?.counts?.fail || 0 },
                    { key: 'error', className: 'is-error', value: row?.counts?.error || 0 }
                ];

                const tds = [
                    escapeHtml(row?.modelName || 'unknown'),
                    escapeHtml(row?.elementType || 'unknown')
                ].map((text) => {
                    const td = document.createElement('td');
                    td.textContent = text;
                    return td;
                });

                const metricsTd = document.createElement('td');
                const metricsWrapper = document.createElement('div');
                metricsWrapper.className = 'selector-health-metrics';
                const samplesSpan = document.createElement('span');
                samplesSpan.textContent = `Samples: ${total}`;
                const chipRow = document.createElement('div');
                chipRow.className = 'selector-health-chip-row';
                chips.forEach((chip) => {
                    const span = document.createElement('span');
                    span.className = `selector-health-chip ${chip.className}`;
                    span.textContent = `${chip.key} ${formatSelectorHealthPct(chip.value, total)}`;
                    chipRow.appendChild(span);
                });
                metricsWrapper.append(samplesSpan, chipRow);
                if (note) metricsWrapper.appendChild(note);
                metricsTd.appendChild(metricsWrapper);

                const lastOverrideTd = document.createElement('td');
                lastOverrideTd.className = 'selector-health-muted';
                lastOverrideTd.textContent = row.lastOverride
                    ? `${formatSelectorHealthTime(row.lastOverride.ts)}${row.lastOverride.reason ? ` · ${truncateSelectorHealthText(row.lastOverride.reason)}` : ''}`
                    : '—';

                const lastCheckTd = document.createElement('td');
                lastCheckTd.className = 'selector-health-muted';
                lastCheckTd.textContent = row.lastHealthCheck
                    ? `${row.lastHealthCheck.success ? 'OK' : 'FAIL'}${row.lastHealthCheck.layer ? ` · ${row.lastHealthCheck.layer}` : ''}${row.lastHealthCheck.error ? ` · ${truncateSelectorHealthText(row.lastHealthCheck.error)}` : ''}`
                    : '—';

                const activeTd = document.createElement('td');
                activeTd.className = 'selector-health-muted';
                activeTd.textContent = row.activeUiVersion
                    ? `${row.activeUiVersion}${row.activeTabId ? ` · #${row.activeTabId}` : ''}`
                    : '—';

                [tds[0], tds[1], metricsTd, lastOverrideTd, lastCheckTd, activeTd].forEach((td) => tr.appendChild(td));
                return tr;
            }
        });

        selectorHealthTable.replaceChildren(table);
    };

    const requestSelectorHealthSummary = (includeActiveVersions = false) => {
        if (!selectorHealthSummary || !selectorHealthTable) return;
        replaceChildrenFromHtml(selectorHealthSummary, '<span class="help-text">Updating…</span>');
        replaceChildrenFromHtml(selectorHealthTable, '<p class="help-text">Loading…</p>');
        setSelectorHealthStatus('updating…');
        chrome.runtime.sendMessage(
            { type: 'REQUEST_SELECTOR_HEALTH_SUMMARY', includeActiveVersions },
            (response) => {
                if (chrome.runtime.lastError) {
                    selectorHealthSnapshot = null;
                    replaceChildrenFromHtml(
                        selectorHealthSummary,
                        `<span class="help-text">Error: ${escapeHtml(chrome.runtime.lastError.message)}</span>`
                    );
                    replaceChildrenFromHtml(selectorHealthTable, '<p class="help-text">Failed to load data</p>');
                    setSelectorHealthStatus('error');
                    return;
                }
                if (response?.status === 'ok') {
                    selectorHealthSnapshot = response.summary && typeof response.summary === 'object' ? response.summary : null;
                    renderSelectorHealth(response.summary || {});
                } else {
                    selectorHealthSnapshot = null;
                    replaceChildrenFromHtml(selectorHealthSummary, '<span class="help-text">Failed to fetch data</span>');
                    replaceChildrenFromHtml(selectorHealthTable, '<p class="help-text">No data</p>');
                    setSelectorHealthStatus('no data');
                }
            }
        );
    };

    const sanitizeSelectorHealthField = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const buildSelectorHealthText = (summary) => {
        if (!summary || !Array.isArray(summary.rows) || !summary.rows.length) return '';
        const lines = [];
        const updatedAt = formatSelectorHealthTime(summary.updatedAt);
        lines.push('Selector Health');
        lines.push(`Updated: ${updatedAt}`);
        lines.push(`Samples: ${Number(summary.totalSamples || 0)}`);
        lines.push('');
        lines.push(['Model', 'Element', 'Samples', 'L1', 'L2', 'L3', 'L4', 'fail', 'error', 'Last override', 'Last check', 'Active UI'].join('\t'));
        summary.rows.forEach((row) => {
            const total = Number(row?.counts?.total || 0);
            const pct = (value) => formatSelectorHealthPct(value, total);
            const lastOverrideRaw = row?.lastOverride
                ? `${formatSelectorHealthTime(row.lastOverride.ts)} ${row.lastOverride.reason || row.lastOverride.selector || ''}`.trim()
                : '—';
            const lastCheckRaw = row?.lastHealthCheck
                ? `${row.lastHealthCheck.success ? 'OK' : 'FAIL'} ${row.lastHealthCheck.layer || ''} ${row.lastHealthCheck.error || ''}`.trim()
                : '—';
            const activeUiRaw = row?.activeUiVersion
                ? `${row.activeUiVersion}${row.activeTabId ? ` #${row.activeTabId}` : ''}`
                : '—';
            lines.push([
                sanitizeSelectorHealthField(row.modelName),
                sanitizeSelectorHealthField(row.elementType),
                total,
                pct(row?.counts?.L1 || 0),
                pct(row?.counts?.L2 || 0),
                pct(row?.counts?.L3 || 0),
                pct(row?.counts?.L4 || 0),
                pct(row?.counts?.fail || 0),
                pct(row?.counts?.error || 0),
                sanitizeSelectorHealthField(lastOverrideRaw),
                sanitizeSelectorHealthField(lastCheckRaw),
                sanitizeSelectorHealthField(activeUiRaw)
            ].join('\t'));
        });
        return lines.join('\n');
    };

    const buildSelectorHealthExport = (summary) => ({
        generatedAt: Date.now(),
        updatedAt: summary?.updatedAt || null,
        totalSamples: Number(summary?.totalSamples || 0),
        rows: Array.isArray(summary?.rows) ? summary.rows : []
    });

    const copySelectorHealth = async () => {
        if (!selectorHealthCopyBtn) return;
        const text = buildSelectorHealthText(selectorHealthSnapshot);
        if (!text) {
            updateDevToolsStatus('No data to copy', 'warning');
            flashButtonFeedback(selectorHealthCopyBtn, 'warn');
            return;
        }
        try {
            await writeRichContentToClipboard({ text });
            updateDevToolsStatus('Selector Health copied', 'success');
            flashButtonFeedback(selectorHealthCopyBtn, 'success');
        } catch (err) {
            console.warn('[results] selector health copy failed', err);
            updateDevToolsStatus('Clipboard copy failed', 'error');
            flashButtonFeedback(selectorHealthCopyBtn, 'error');
        }
    };

    const exportSelectorHealth = () => {
        if (!selectorHealthExportBtn) return;
        const payload = buildSelectorHealthExport(selectorHealthSnapshot);
        if (!payload.rows.length) {
            updateDevToolsStatus('No data to export', 'warning');
            flashButtonFeedback(selectorHealthExportBtn, 'warn');
            return;
        }
        try {
            const json = JSON.stringify(payload, null, 2);
            if (!json) return;
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `selector-health-${Date.now()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            updateDevToolsStatus('Selector Health exported', 'success');
            flashButtonFeedback(selectorHealthExportBtn, 'success');
        } catch (err) {
            console.warn('[results] selector health export failed', err);
            updateDevToolsStatus('Export failed', 'error');
            flashButtonFeedback(selectorHealthExportBtn, 'error');
        }
    };

    if (selectorHealthRefreshBtn) {
        selectorHealthRefreshBtn.addEventListener('click', () => requestSelectorHealthSummary(true));
    }
    if (selectorHealthCopyBtn) {
        selectorHealthCopyBtn.addEventListener('click', () => copySelectorHealth());
    }
    if (selectorHealthExportBtn) {
        selectorHealthExportBtn.addEventListener('click', () => exportSelectorHealth());
    }
    if (selectorHealthSummary && selectorHealthTable) {
        requestSelectorHealthSummary(true);
    }

    const renderTelemetryTable = (metrics = {}) => {
        if (!telemetryTable) return;
        const tbody = telemetryTable.querySelector('tbody');
        if (!tbody) return;
        const rows = Object.entries(metrics).map(([key, count]) => {
            const [modelName = 'unknown', elementType = '-', layer = '-'] = key.split('_');
            return { modelName, elementType, layer, count };
        }).sort((a, b) => b.count - a.count).slice(0, 20);
        if (!rows.length) {
            replaceChildrenFromHtml(tbody, '<tr><td colspan="4">No data</td></tr>');
            return;
        }
        const rowsHtml = rows.map(({ modelName, elementType, layer, count }) => `
            <tr>
                <td>${escapeHtml(modelName)}</td>
                <td>${escapeHtml(elementType)}</td>
                <td>${escapeHtml(layer)}</td>
                <td>${escapeHtml(String(count))}</td>
            </tr>
        `).join('');
        replaceChildrenFromHtml(tbody, rowsHtml);
    };

    const requestSelectorTelemetry = () => {
        if (!telemetryTable) return;
        const tbody = telemetryTable.querySelector('tbody');
        if (tbody) {
            replaceChildrenFromHtml(tbody, '<tr><td colspan="4">Loading…</td></tr>');
        }
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_TELEMETRY' }, (response) => {
            if (chrome.runtime.lastError) {
                if (tbody) {
                    replaceChildrenFromHtml(
                        tbody,
                        `<tr><td colspan="4">Error: ${escapeHtml(chrome.runtime.lastError.message)}</td></tr>`
                    );
                }
                return;
            }
            if (response?.status === 'ok') {
                renderTelemetryTable(response.metrics || {});
            } else if (tbody) {
                replaceChildrenFromHtml(tbody, '<tr><td colspan="4">No data</td></tr>');
            }
        });
    };

    if (telemetryRefreshBtn) {
        telemetryRefreshBtn.addEventListener('click', () => requestSelectorTelemetry());
    }
    if (telemetryTable) {
        requestSelectorTelemetry();
    }

    const renderSelectorDefinitions = (modelName, payload) => {
        if (!liveSelectorList) return;
        if (!payload?.versions?.length) {
            replaceChildrenFromHtml(
                liveSelectorList,
                `<p class="help-text">No registered versions for model ${escapeHtml(modelName)}</p>`
            );
            return;
        }
        clearNode(liveSelectorList);
        payload.versions.forEach((version) => {
            const block = document.createElement('div');
            block.className = 'live-version-block';
            const title = document.createElement('h3');
            const versionSpan = document.createElement('span');
            versionSpan.textContent = String(version.version || 'unknown');
            const revisionSpan = document.createElement('span');
            revisionSpan.textContent = String(version.uiRevision || '');
            title.appendChild(versionSpan);
            title.appendChild(revisionSpan);
            block.appendChild(title);

            SELECTOR_ELEMENT_TYPES.forEach((elementType) => {
                const selectors = version.selectors?.[elementType] || [];
                const row = document.createElement('div');
                row.className = 'live-selector-row';
                const label = document.createElement('strong');
                label.textContent = elementType;
                row.appendChild(label);
                if (selectors.length) {
                    const chips = document.createElement('div');
                    chips.className = 'selector-chip';
                    selectors.forEach((selector) => {
                        const code = document.createElement('code');
                        code.textContent = selector;
                        chips.appendChild(code);
                    });
                    row.appendChild(chips);
                } else {
                    const empty = document.createElement('span');
                    empty.className = 'help-text';
                    empty.textContent = 'No selectors';
                    row.appendChild(empty);
                }
                block.appendChild(row);
            });

            liveSelectorList.appendChild(block);
        });
    };

    const requestSelectorDefinitions = (modelName) => {
        if (!modelName || !liveSelectorList) return;
        replaceChildrenFromHtml(liveSelectorList, '<p class="help-text">Loading selectors…</p>');
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_DEFINITIONS', modelName }, (response) => {
            if (chrome.runtime.lastError) {
                replaceChildrenFromHtml(
                    liveSelectorList,
                    `<p class="help-text">Error: ${escapeHtml(chrome.runtime.lastError.message)}</p>`
                );
                return;
            }
            if (response?.status === 'ok') {
                renderSelectorDefinitions(modelName, response);
            } else {
                replaceChildrenFromHtml(
                    liveSelectorList,
                    `<p class="help-text">Failed to fetch selectors (${escapeHtml(response?.error || 'unknown')})</p>`
                );
            }
        });
    };

    const setSelectorValidationStatus = (text, tone = '') => {
        if (!selectorValidationStatus) return;
        selectorValidationStatus.textContent = text || '';
        selectorValidationStatus.classList.remove('is-success', 'is-warning', 'is-error');
        if (tone) selectorValidationStatus.classList.add(`is-${tone}`);
    };

    const renderActiveSelectors = () => {
        if (!selectorActiveSelectors) return;
        const modelName = getSelectedModelName();
        if (!modelName) {
            replaceChildrenFromHtml(selectorActiveSelectors, '<div class="selectors0-empty">Select a model in Workbench.</div>');
            return;
        }
        if (!activeSelectorSnapshot || activeSelectorSnapshotModel !== modelName) {
            replaceChildrenFromHtml(selectorActiveSelectors, '<div class="selectors0-empty">No data for the selected model.</div>');
            return;
        }
        const selectorsByType = activeSelectorSnapshot?.selectors || {};
        const order = SELECTOR_WORKBENCH_FIELDS.map((field) => field.key);
        const groups = buildSelectorGroups(selectorsByType, order);
        renderSelectorGroups(selectorActiveSelectors, groups, 'No active selectors for the selected model.');
    };

    const refreshActiveSelectorSnapshot = () => {
        const modelName = getSelectedModelName();
        activeSelectorSnapshot = null;
        activeSelectorSnapshotModel = '';
        activeSelectorValidationMap = new Map();
        renderActiveSelectors();
        if (selectorDetectedVersion) selectorDetectedVersion.textContent = '—';
        if (selectorActiveTabStatus) selectorActiveTabStatus.textContent = modelName ? 'Checking…' : 'No model';
        if (!modelName) return;
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_ACTIVE_VERSION', modelName }, (response) => {
            if (chrome.runtime.lastError) {
                if (selectorActiveTabStatus) selectorActiveTabStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
                return;
            }
            if (response?.status === 'ok') {
                activeSelectorSnapshot = response;
                activeSelectorSnapshotModel = modelName;
                if (selectorDetectedVersion) selectorDetectedVersion.textContent = response.version || 'unknown';
                if (selectorActiveTabStatus) {
                    selectorActiveTabStatus.textContent = response.tabId ? `Active (#${response.tabId})` : 'Active';
                }
                renderActiveSelectors();
                refreshSelectorCandidates();
            } else {
                if (selectorDetectedVersion) selectorDetectedVersion.textContent = 'unknown';
                if (selectorActiveTabStatus) {
                    selectorActiveTabStatus.textContent = response?.status === 'no_tab'
                        ? 'No active tab'
                        : (response?.error || 'No data');
                }
            }
        });
    };

    const refreshSelectorAudit = (modelName = getSelectedModelName()) => {
        if (!selectorAuditList) return;
        if (!modelName) {
            replaceChildrenFromHtml(selectorAuditList, '<p class="help-text">Select a model in Workbench</p>');
            return;
        }
        replaceChildrenFromHtml(selectorAuditList, '<p class="help-text">Loading history…</p>');
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_OVERRIDE_AUDIT', limit: 60 }, (response) => {
            if (chrome.runtime.lastError) {
                replaceChildrenFromHtml(
                    selectorAuditList,
                    `<p class="help-text">Error: ${escapeHtml(chrome.runtime.lastError.message)}</p>`
                );
                return;
            }
            if (response?.status !== 'ok') {
                replaceChildrenFromHtml(
                    selectorAuditList,
                    `<p class="help-text">Error: ${escapeHtml(response?.error || 'Failed to load history')}</p>`
                );
                return;
            }
            const entries = Array.isArray(response?.entries) ? response.entries : [];
            const normalizedModel = normalizeModelName(modelName);
        const filteredEntries = entries.filter((entry) => normalizeModelName(entry?.modelName) === normalizedModel);
        if (!filteredEntries.length) {
            replaceChildrenFromHtml(selectorAuditList, '<p class="help-text">Change history is empty</p>');
            return;
        }
        renderIncrementalList(selectorAuditList, filteredEntries, {
            getId: (entry) => `${entry.modelName || 'unknown'}:${entry.elementType || 'unknown'}:${entry.selector || ''}:${entry.ts || ''}`,
            getHash: (entry) => JSON.stringify([entry.selector, entry.reason, entry.extVersion]),
            renderItem: (entry) => {
                const time = entry.ts ? new Date(entry.ts).toLocaleString() : '';
                const selector = entry.selector || '';
                const reason = entry.reason || '';
                const model = entry.modelName || 'unknown';
                const elementType = entry.elementType || 'unknown';
                const version = entry.extVersion || '';
                const row = document.createElement('div');
                row.className = 'selector-audit-row';
                const spanModel = document.createElement('span');
                spanModel.innerHTML = `<strong>${escapeHtml(model)}</strong> · ${escapeHtml(elementType)}`;
                const spanSelector = document.createElement('span');
                spanSelector.textContent = selector;
                const meta = document.createElement('span');
                meta.className = 'selector-audit-meta';
                meta.textContent = `${time}${version ? ` · v${version}` : ''}`;
                row.append(spanModel, spanSelector, meta);
                if (reason) {
                    const reasonEl = document.createElement('span');
                    reasonEl.className = 'selector-audit-meta';
                    reasonEl.textContent = `Reason: ${reason}`;
                    row.appendChild(reasonEl);
                }
                return row;
            }
        });
    });
};

    const refreshSavedOverridesList = () => {
        if (!selectorsSavedOverridesList) return;
        const modelName = getSelectedModelName();
        if (!modelName) {
            replaceChildrenFromHtml(selectorsSavedOverridesList, '<div class="selectors0-empty">Select a model in Workbench.</div>');
            return;
        }
        replaceChildrenFromHtml(selectorsSavedOverridesList, '<div class="selectors0-empty">Loading overrides…</div>');
        chrome.storage.local.get('selectors_remote_override', (res) => {
            if (chrome.runtime?.lastError) {
                replaceChildrenFromHtml(
                    selectorsSavedOverridesList,
                    `<div class="selectors0-empty">Error: ${escapeHtml(chrome.runtime.lastError.message)}</div>`
                );
                return;
            }
            const payload = res?.selectors_remote_override || {};
            const manualOverrides = payload.manualOverrides || {};
            const modelOverrides = manualOverrides?.[modelName] || {};
            const order = SELECTOR_WORKBENCH_FIELDS.map((field) => field.key);
            const groups = buildSelectorGroups(modelOverrides, order);
            renderSelectorGroups(selectorsSavedOverridesList, groups, 'No saved overrides for the selected model.');
        });
    };

    const pickCandidatesVersion = (versions, activeVersion) => {
        if (!Array.isArray(versions) || !versions.length) return null;
        if (activeVersion) {
            const match = versions.find((version) => version.version === activeVersion);
            if (match) return match;
        }
        return versions[versions.length - 1];
    };

    const refreshSelectorCandidates = () => {
        if (!selectorsCandidatesList) return;
        const modelName = getSelectedModelName();
        if (!modelName) {
            replaceChildrenFromHtml(selectorsCandidatesList, '<div class="selectors0-empty">Select a model in Workbench.</div>');
            return;
        }
        replaceChildrenFromHtml(selectorsCandidatesList, '<div class="selectors0-empty">Loading candidates…</div>');
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_DEFINITIONS', modelName }, (response) => {
            if (chrome.runtime.lastError) {
                replaceChildrenFromHtml(
                    selectorsCandidatesList,
                    `<div class="selectors0-empty">Error: ${escapeHtml(chrome.runtime.lastError.message)}</div>`
                );
                return;
            }
            if (response?.status !== 'ok') {
                replaceChildrenFromHtml(
                    selectorsCandidatesList,
                    `<div class="selectors0-empty">${escapeHtml(response?.error || 'Failed to load candidates')}</div>`
                );
                return;
            }
            const version = pickCandidatesVersion(response.versions || [], activeSelectorSnapshot?.version || '');
            if (!version) {
                replaceChildrenFromHtml(selectorsCandidatesList, '<div class="selectors0-empty">No candidates for the selected model.</div>');
                return;
            }
            const order = SELECTOR_WORKBENCH_FIELDS.map((field) => field.key);
            const groups = buildSelectorGroups(version.selectors || {}, order);
            const headerHtml = `<div class="selectors0-muted">Version: ${escapeHtml(version.version || 'unknown')}</div>`;
            renderSelectorGroups(selectorsCandidatesList, groups, 'No candidates for the selected model.', headerHtml);
        });
    };

    const refreshSelectorsSidePanels = (modelName = getSelectedModelName()) => {
        if (!modelName) {
            renderActiveSelectors();
            refreshSavedOverridesList();
            refreshSelectorAudit();
            refreshSelectorCandidates();
            return;
        }
        refreshActiveSelectorSnapshot();
        refreshSavedOverridesList();
        refreshSelectorAudit(modelName);
        refreshSelectorCandidates();
    };

    const validateSelectorsOnModel = (modelName, selectors, onDone) => {
        if (!modelName) return;
        const list = Array.isArray(selectors) ? selectors.filter(Boolean) : [];
        if (!list.length) return;
        chrome.runtime.sendMessage({ type: 'VALIDATE_SELECTORS', modelName, selectors: list }, (response) => {
            if (chrome.runtime.lastError) {
                onDone && onDone({ status: 'error', error: chrome.runtime.lastError.message });
                return;
            }
            onDone && onDone(response);
        });
    };

    const showSelectorsWorkbenchStatus = (message) => {
        if (!selectorsWorkbenchStatus) return;
        selectorsWorkbenchStatus.textContent = message || '';
        if (selectorsWorkbenchState.statusTimer) clearTimeout(selectorsWorkbenchState.statusTimer);
        if (message) {
            selectorsWorkbenchState.statusTimer = setTimeout(() => {
                if (selectorsWorkbenchStatus) selectorsWorkbenchStatus.textContent = '';
            }, 2500);
        }
    };

    const flattenSelectors = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) {
            return value.flatMap((entry) => flattenSelectors(entry));
        }
        if (typeof value === 'string') return [value];
        return [];
    };

    const normalizeModelName = (value) => String(value || '').trim().toLowerCase();

    const getSelectedModelName = () =>
        selectorsWorkbenchModelSelect?.value || liveSelectorModelSelect?.value || '';

    const buildSelectorGroups = (selectorsByType, orderedKeys = []) => {
        const groups = [];
        const seen = new Set();
        orderedKeys.forEach((key) => {
            const selectors = flattenSelectors(selectorsByType?.[key]);
            if (!selectors.length) return;
            groups.push({ label: key, selectors });
            seen.add(key);
        });
        Object.keys(selectorsByType || {}).forEach((key) => {
            if (seen.has(key)) return;
            const selectors = flattenSelectors(selectorsByType?.[key]);
            if (!selectors.length) return;
            groups.push({ label: key, selectors });
        });
        return groups;
    };

    const renderSelectorGroups = (container, groups, emptyText, headerHtml = '') => {
        if (!container) return;
        if (!groups.length) {
            replaceChildrenFromHtml(
                container,
                `${headerHtml}<div class="selectors0-empty">${escapeHtml(emptyText || '')}</div>`
            );
            return;
        }
        container.replaceChildren();
        if (headerHtml) {
            container.appendChild(createHtmlFragment(container, headerHtml));
        }
        const host = document.createElement('div');
        container.appendChild(host);
        renderIncrementalList(host, groups, {
            getId: (item) => item?.label || '',
            getHash: (item) => `${item?.label || ''}:${(item?.selectors || []).join('|')}`,
            renderItem: (item) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'selectors0-side-row';
                wrapper.dataset.itemId = item.label || '';
                const labelSpan = document.createElement('span');
                labelSpan.className = 'selectors0-side-label';
                labelSpan.textContent = item.label || '';
                const chips = document.createElement('div');
                chips.className = 'selectors0-side-chips';
                (item.selectors || []).forEach((selector) => {
                    const code = document.createElement('code');
                    code.textContent = selector;
                    chips.appendChild(code);
                });
                wrapper.append(labelSpan, chips);
                return wrapper;
            }
        });
    };

    const updateWorkbenchSelectorStatus = (entry, status) => {
        if (!entry?.statusEl) return;
        entry.status = status;
        entry.statusEl.classList.remove('selectors-status--ok', 'selectors-status--bad', 'selectors-status--idle');
        if (status === 'ok') {
            entry.statusEl.textContent = '🟢';
            entry.statusEl.classList.add('selectors-status--ok');
            return;
        }
        if (status === 'bad') {
            entry.statusEl.textContent = '🔴';
            entry.statusEl.classList.add('selectors-status--bad');
            return;
        }
        entry.statusEl.textContent = '⚪';
        entry.statusEl.classList.add('selectors-status--idle');
    };

    const syncWorkbenchSaveState = (entry) => {
        if (!entry?.saveBtn) return;
        entry.saveBtn.disabled = !entry.dirty;
    };

    const updateWorkbenchSelectorInput = (entry, rawValue) => {
        const value = String(rawValue || '').trim();
        entry.value = value;
        if (entry.inputEl) {
            entry.inputEl.value = value;
            entry.inputEl.title = value;
        }
        entry.dirty = value !== entry.savedValue;
        updateWorkbenchSelectorStatus(entry, 'idle');
        syncWorkbenchSaveState(entry);
    };

    const testWorkbenchSelectorEntry = (entry) => {
        if (!entry) return;
        const selector = String(entry.value || '').trim();
        if (!selector) {
            updateWorkbenchSelectorStatus(entry, 'idle');
            showSelectorsWorkbenchStatus('Selector is empty');
            return;
        }
        const modelName = selectorsWorkbenchModelSelect?.value || '';
        if (!modelName) {
            showSelectorsWorkbenchStatus('Select model to test');
            return;
        }
        validateSelectorsOnModel(modelName, [selector], (response) => {
            if (response?.status === 'no_tab') {
                updateWorkbenchSelectorStatus(entry, 'idle');
                showSelectorsWorkbenchStatus('No active tab for validation');
                return;
            }
            if (response?.status !== 'ok') {
                updateWorkbenchSelectorStatus(entry, 'bad');
                showSelectorsWorkbenchStatus(response?.error || 'Validation failed');
                return;
            }
            const result = response.results?.[0];
            if (result?.error) {
                updateWorkbenchSelectorStatus(entry, 'bad');
                showSelectorsWorkbenchStatus(result.error || 'Invalid selector');
                return;
            }
            const matches = Number(result?.matches || 0);
            updateWorkbenchSelectorStatus(entry, matches > 0 ? 'ok' : 'bad');
            showSelectorsWorkbenchStatus(matches > 0 ? 'Selector OK' : 'No matches');
            if (matches > 0) {
                chrome.runtime.sendMessage({
                    type: 'HIGHLIGHT_SELECTOR_TEMP',
                    modelName,
                    selector,
                    durationMs: 5000,
                    color: '#2ecc71'
                }, () => {});
            }
        });
    };

    const buildWorkbenchRow = (field) => {
        const row = document.createElement('div');
        row.className = 'selectors-row selectors0-workbench-row';
        row.dataset.key = field.key;
        const header = document.createElement('div');
        header.className = 'selectors-row-header';
        const title = document.createElement('div');
        title.className = 'selectors-row-title';
        const status = document.createElement('span');
        status.className = 'selectors-status selectors-status--idle';
        status.textContent = '⚪';
        const label = document.createElement('span');
        label.className = 'selectors-label';
        label.textContent = field.label || field.key || '';
        title.appendChild(status);
        title.appendChild(label);
        const actions = document.createElement('div');
        actions.className = 'selectors-actions';
        const makeButton = (className, action, text, ariaLabel) => {
            const btn = document.createElement('button');
            btn.className = className;
            btn.type = 'button';
            btn.dataset.action = action;
            if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
            if (text === '🗑️') {
                btn.innerHTML = '<i class="ti ti-trash" aria-hidden="true"></i>';
            } else {
                btn.textContent = text;
            }
            return btn;
        };
        actions.appendChild(makeButton('selectors-btn selectors-btn-pick', 'pick', '🎯', 'Pick'));
        actions.appendChild(makeButton('selectors-btn selectors-btn-record', 'record', '⬤', 'Record'));
        actions.appendChild(makeButton('selectors-btn selectors-btn-test', 'test', 'Test'));
        actions.appendChild(makeButton('selectors-btn selectors-btn-save', 'save', 'Save'));
        actions.appendChild(makeButton('selectors-btn selectors-btn-clear', 'clear', '🗑️', 'Clear selector'));
        header.appendChild(title);
        header.appendChild(actions);
        row.appendChild(header);
        const input = document.createElement('input');
        input.className = 'selectors-input selectors0-input';
        input.type = 'text';
        input.placeholder = 'CSS selector';
        row.appendChild(input);
        return row;
    };

    const sendRuntimeMessage = (payload) =>
        new Promise((resolve) => {
            if (!chrome?.runtime?.sendMessage) {
                resolve({ status: 'error', error: 'runtime unavailable' });
                return;
            }
            chrome.runtime.sendMessage(payload, (response) => {
                if (chrome.runtime?.lastError) {
                    resolve({ status: 'error', error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(response || { status: 'error', error: 'no response' });
            });
        });

    const resolveWorkbenchDefaults = (selectorsByType) => {
        const defaults = {};
        SELECTOR_WORKBENCH_FIELDS.forEach((field) => {
            const list = flattenSelectors(selectorsByType?.[field.key]);
            defaults[field.key] = list.find((entry) => typeof entry === 'string' && entry.trim()) || '';
        });
        return defaults;
    };

    const buildWorkbenchEntries = (defaults) => {
        if (!selectorsWorkbenchList) return;
        clearNode(selectorsWorkbenchList);
        selectorsWorkbenchState.entries.clear();
        SELECTOR_WORKBENCH_FIELDS.forEach((field) => {
            const row = buildWorkbenchRow(field);
            selectorsWorkbenchList.appendChild(row);
            const entry = {
                key: field.key,
                value: '',
                savedValue: '',
                dirty: false,
                status: 'idle',
                row,
                statusEl: row.querySelector('.selectors-status'),
                inputEl: row.querySelector('.selectors-input'),
                pickBtn: row.querySelector('[data-action="pick"]'),
                recordBtn: row.querySelector('[data-action="record"]'),
                testBtn: row.querySelector('[data-action="test"]'),
                saveBtn: row.querySelector('[data-action="save"]'),
                clearBtn: row.querySelector('[data-action="clear"]')
            };
            const initialValue = defaults?.[field.key] || '';
            entry.savedValue = String(initialValue || '').trim();
            updateWorkbenchSelectorInput(entry, entry.savedValue);
            entry.dirty = false;
            syncWorkbenchSaveState(entry);
            updateWorkbenchSelectorStatus(entry, entry.savedValue ? 'idle' : 'idle');
            entry.inputEl?.addEventListener('input', (event) => {
                updateWorkbenchSelectorInput(entry, event.target?.value || '');
            });
            entry.pickBtn?.addEventListener('click', () => startWorkbenchPicker(entry, { mode: 'workbench-pick' }));
            entry.recordBtn?.addEventListener('click', () => {
                if (activePickerRequestId && activePickerMode !== 'workbench-record') {
                    showSelectorsWorkbenchStatus('Picker already active');
                    return;
                }
                startWorkbenchRecord(entry);
            });
            entry.testBtn?.addEventListener('click', () => testWorkbenchSelectorEntry(entry));
            entry.saveBtn?.addEventListener('click', () => saveWorkbenchSelectorEntry(entry));
            entry.clearBtn?.addEventListener('click', () => {
                updateWorkbenchSelectorInput(entry, '');
                updateWorkbenchSelectorStatus(entry, 'idle');
                showSelectorsWorkbenchStatus('Cleared');
            });
            selectorsWorkbenchState.entries.set(entry.key, entry);
        });
    };

    const requestWorkbenchDefaults = async (modelName) => {
        if (!modelName) return {};
        const activeResponse = await sendRuntimeMessage({ type: 'REQUEST_SELECTOR_ACTIVE_VERSION', modelName });
        if (activeResponse?.status === 'ok') {
            return resolveWorkbenchDefaults(activeResponse.selectors || {});
        }
        const defsResponse = await sendRuntimeMessage({ type: 'REQUEST_SELECTOR_DEFINITIONS', modelName });
        if (defsResponse?.status === 'ok' && defsResponse.versions?.length) {
            const firstVersion = defsResponse.versions[0];
            return resolveWorkbenchDefaults(firstVersion.selectors || {});
        }
        return resolveWorkbenchDefaults({});
    };

    const refreshWorkbenchSelectors = async (modelName) => {
        if (!selectorsWorkbenchList) return;
        selectorsWorkbenchState.modelName = modelName;
        replaceChildrenFromHtml(selectorsWorkbenchList, '<p class="help-text">Loading selectors…</p>');
        const defaults = await requestWorkbenchDefaults(modelName);
        buildWorkbenchEntries(defaults);
        refreshSelectorsSidePanels(modelName);
    };

    const saveWorkbenchSelectorEntry = async (entry) => {
        if (!entry) return;
        const selector = String(entry.value || '').trim();
        if (!selector) {
            showSelectorsWorkbenchStatus('Selector is empty');
            return;
        }
        const modelName = selectorsWorkbenchModelSelect?.value || '';
        if (!modelName) {
            showSelectorsWorkbenchStatus('Select model to save');
            return;
        }
        showSelectorsWorkbenchStatus('Saving selector…');
        const response = await sendRuntimeMessage({
            type: 'SAVE_SELECTOR_OVERRIDE',
            modelName,
            elementType: entry.key,
            selector,
            reason: 'selectors workbench'
        });
        if (response?.status !== 'ok') {
            showSelectorsWorkbenchStatus(response?.error || 'Save failed');
            return;
        }
        entry.savedValue = selector;
        entry.dirty = false;
        syncWorkbenchSaveState(entry);
        showSelectorsWorkbenchStatus('Saved');
        refreshSelectorAudit(modelName);
        refreshSavedOverridesList();
    };

    const saveAllWorkbenchSelectors = async () => {
        const entries = Array.from(selectorsWorkbenchState.entries.values()).filter((entry) => entry.dirty);
        if (!entries.length) {
            showSelectorsWorkbenchStatus('No changes to save');
            return;
        }
        for (const entry of entries) {
            // eslint-disable-next-line no-await-in-loop
            await saveWorkbenchSelectorEntry(entry);
        }
    };

    const formatSelectorsFilename = (modelName = 'selectors') => {
        const date = new Date();
        const pad = (num) => String(num).padStart(2, '0');
        return `${modelName}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
    };

    const buildSelectorsExportPayload = () => {
        const selectors = {};
        selectorsWorkbenchState.entries.forEach((entry, key) => {
            selectors[key] = entry?.value ? entry.value : null;
        });
        return {
            modelName: selectorsWorkbenchModelSelect?.value || '',
            version: chrome.runtime?.getManifest?.().version || '',
            exported: new Date().toISOString(),
            selectors
        };
    };

    const exportSelectorsJson = () => {
        const payload = buildSelectorsExportPayload();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = formatSelectorsFilename(payload.modelName || 'selectors');
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showSelectorsWorkbenchStatus('Exported');
    };

    const applySelectorsImport = (payload) => {
        if (!payload || typeof payload !== 'object') {
            showSelectorsWorkbenchStatus('Invalid file');
            return;
        }
        const payloadModel = String(payload.modelName || '');
        const currentModel = String(selectorsWorkbenchModelSelect?.value || '');
        if (payloadModel && currentModel && payloadModel !== currentModel) {
            const proceed = confirm(`File is for ${payloadModel}, you are on ${currentModel}. Apply anyway?`);
            if (!proceed) return;
        }
        const imported = payload.selectors || {};
        selectorsWorkbenchState.entries.forEach((entry, key) => {
            if (Object.prototype.hasOwnProperty.call(imported, key)) {
                updateWorkbenchSelectorInput(entry, imported[key] || '');
                testWorkbenchSelectorEntry(entry);
            }
        });
        showSelectorsWorkbenchStatus('Imported');
    };

    const handleSelectorsImportFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || ''));
                applySelectorsImport(parsed);
            } catch (_) {
                showSelectorsWorkbenchStatus('Invalid JSON');
            }
        };
        reader.readAsText(file);
    };

    const cancelActivePicker = (modelName, requestId) => {
        if (!requestId) return;
        chrome.runtime.sendMessage({ type: 'PICKER_CANCEL', modelName, requestId }, () => {});
    };

    const startWorkbenchPicker = (entry, { mode, timeoutMs, startLabel, timeoutLabel } = {}) => {
        if (!entry) return;
        const modelName = selectorsWorkbenchModelSelect?.value || '';
        if (!modelName) {
            showSelectorsWorkbenchStatus('Select model to pick');
            return;
        }
        if (activePickerRequestId) {
            showSelectorsWorkbenchStatus('Picker already active');
            return;
        }
        activePickerMode = mode || 'workbench-pick';
        entry.pickBtn.disabled = true;
        if (entry.recordBtn) entry.recordBtn.disabled = true;
        showSelectorsWorkbenchStatus(startLabel || 'Pick an element on model tab');
        chrome.runtime.sendMessage(
            { type: 'PICK_SELECTOR_START', modelName, elementType: entry.key, mode: mode === 'workbench-record' ? 'record' : 'selector' },
            (response) => {
            if (chrome.runtime.lastError) {
                entry.pickBtn.disabled = false;
                if (entry.recordBtn) entry.recordBtn.disabled = false;
                if (mode === 'workbench-record' && entry.recordBtn) {
                    entry.recordBtn.classList.remove('is-active');
                }
                showSelectorsWorkbenchStatus(`Pick failed: ${chrome.runtime.lastError.message}`);
                activePickerMode = null;
                return;
            }
            if (!response || response.status !== 'ok' || !response.requestId) {
                entry.pickBtn.disabled = false;
                if (entry.recordBtn) entry.recordBtn.disabled = false;
                if (mode === 'workbench-record' && entry.recordBtn) {
                    entry.recordBtn.classList.remove('is-active');
                }
                showSelectorsWorkbenchStatus(response?.error || 'Pick failed');
                activePickerMode = null;
                return;
            }
            activePickerRequestId = response.requestId;
            activePickerEntry = entry;
            if (pickerTimeoutId) clearTimeout(pickerTimeoutId);
            pickerTimeoutId = setTimeout(() => {
                if (activePickerRequestId !== response.requestId) return;
                activePickerRequestId = null;
                activePickerEntry = null;
                activePickerMode = null;
                entry.pickBtn.disabled = false;
                if (entry.recordBtn) entry.recordBtn.disabled = false;
                if (mode === 'workbench-record' && entry.recordBtn) {
                    entry.recordBtn.classList.remove('is-active');
                }
                cancelActivePicker(modelName, response.requestId);
                showSelectorsWorkbenchStatus(timeoutLabel || 'Pick timeout');
            }, timeoutMs || 60000);
        });
    };

    const startWorkbenchRecord = (entry) => {
        if (!entry) return;
        if (entry.recordBtn?.classList.contains('is-active')) {
            entry.recordBtn.classList.remove('is-active');
            if (activePickerRequestId) {
                const modelName = selectorsWorkbenchModelSelect?.value || '';
                const requestId = activePickerRequestId;
                activePickerRequestId = null;
                activePickerEntry = null;
                activePickerMode = null;
                if (pickerTimeoutId) {
                    clearTimeout(pickerTimeoutId);
                    pickerTimeoutId = null;
                }
                entry.pickBtn.disabled = false;
                entry.recordBtn.disabled = false;
                cancelActivePicker(modelName, requestId);
            }
            showSelectorsWorkbenchStatus('Record cancelled');
            return;
        }
        entry.recordBtn?.classList.add('is-active');
        startWorkbenchPicker(entry, {
            mode: 'workbench-record',
            timeoutMs: 15000,
            startLabel: 'Recording… click target',
            timeoutLabel: 'Record timeout'
        });
    };

    const populateSelectorModels = () => {
        if (!liveSelectorModelSelect) return;
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_MODELS' }, (response) => {
            if (chrome.runtime.lastError) {
                replaceChildrenFromHtml(
                    liveSelectorList,
                    `<p class="help-text">Failed to load models: ${escapeHtml(chrome.runtime.lastError.message)}</p>`
                );
                return;
            }
            const models = response?.models || [];
            clearNode(liveSelectorModelSelect);
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select a model';
            liveSelectorModelSelect.appendChild(placeholder);
            models.forEach((modelName) => {
                const option = document.createElement('option');
                option.value = modelName;
                option.textContent = modelName;
                liveSelectorModelSelect.appendChild(option);
            });
            if (models.length) {
                liveSelectorModelSelect.value = models[0];
                requestSelectorDefinitions(models[0]);
                refreshActiveSelectorSnapshot();
                refreshSelectorAudit(models[0]);
            }
        });
    };

    const populateWorkbenchModels = () => {
        if (!selectorsWorkbenchModelSelect) return;
        chrome.runtime.sendMessage({ type: 'REQUEST_SELECTOR_MODELS' }, (response) => {
            if (chrome.runtime.lastError) {
                showSelectorsWorkbenchStatus(`Model load failed: ${chrome.runtime.lastError.message}`);
                return;
            }
            const models = response?.models || [];
            clearNode(selectorsWorkbenchModelSelect);
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Choose model';
            selectorsWorkbenchModelSelect.appendChild(placeholder);
            models.forEach((modelName) => {
                const option = document.createElement('option');
                option.value = modelName;
                option.textContent = modelName;
                selectorsWorkbenchModelSelect.appendChild(option);
            });
            if (models.length) {
                selectorsWorkbenchModelSelect.value = models[0];
                refreshWorkbenchSelectors(models[0]);
                refreshSelectorAudit(models[0]);
            } else {
                refreshWorkbenchSelectors('');
            }
        });
    };

    if (liveSelectorModelSelect) {
        liveSelectorModelSelect.addEventListener('change', (event) => {
            requestSelectorDefinitions(event.target.value);
            refreshActiveSelectorSnapshot();
            refreshSelectorAudit(event.target.value);
            refreshSavedOverridesList();
            refreshSelectorCandidates();
        });
        populateSelectorModels();
    }
    if (liveSelectorElementSelect) {
        liveSelectorElementSelect.addEventListener('change', () => {
            activeSelectorValidationMap = new Map();
            renderActiveSelectors();
        });
    }
    if (selectorsWorkbenchModelSelect) {
        selectorsWorkbenchModelSelect.addEventListener('change', (event) => {
            refreshWorkbenchSelectors(event.target.value);
            refreshSelectorsSidePanels(event.target.value);
        });
        populateWorkbenchModels();
    }
    if (selectorsWorkbenchHeaderButtons && selectorsWorkbenchHeaderButtons.length) {
        selectorsWorkbenchHeaderButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.selectorsAction;
                if (action === 'export') exportSelectorsJson();
                if (action === 'import') selectorsWorkbenchFileInput?.click();
                if (action === 'save-all') saveAllWorkbenchSelectors();
            });
        });
    }
    if (selectorsWorkbenchFileInput) {
        selectorsWorkbenchFileInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (file) handleSelectorsImportFile(file);
            selectorsWorkbenchFileInput.value = '';
        });
    }

    if (modifiersSection && toggleModifiersBtn && modifiersContainer) {
        let modifiersOpen = modifiersSection.classList.contains('is-open');
        let modifiersToggleClickTimer = null;
        const modifiersToggleClickDelayMs = 220;

        const applyModifiersState = () => {
            modifiersSection.classList.toggle('is-open', modifiersOpen);
            modifiersSection.hidden = !modifiersOpen;
            toggleModifiersBtn.setAttribute('aria-pressed', String(modifiersOpen));
            toggleModifiersBtn.setAttribute('aria-expanded', String(modifiersOpen));
            const controlLabel = modifiersOpen ? 'Hide modifiers' : 'Show modifiers';
            toggleModifiersBtn.setAttribute('aria-label', controlLabel);
            toggleModifiersBtn.setAttribute('title', controlLabel);
            modifiersContainer.setAttribute('aria-hidden', String(!modifiersOpen));
            if (!modifiersOpen) {
                document.querySelectorAll('.modifier-group-card').forEach(card => {
                    // Сброс разворота: показываем минимальный набор (3 штуки) для экспандеров
                    card.classList.remove('is-expanded');
                    if (card.classList.contains('is-collapsible')) {
                        card.classList.add('is-collapsed');
                    }
                });
                requestAnimationFrame(layoutModifierMasonry);
                updateModifierGroupHighlights();
            }
        };

        const setModifiersOpen = (nextState) => {
            modifiersOpen = Boolean(nextState);
            applyModifiersState();
        };

        applyModifiersState();

        if (modifiersHeader) {
            modifiersHeader.addEventListener('click', (event) => {
                if (event.target.closest('a') || event.target.closest('button')) {
                    return;
                }
                const toggleClickTarget = event.target.closest('.toggle-icon-console, .modifiers-toggle-label-console, .modifiers-toggle-label[data-mod-type="prefix"]');
                if (!toggleClickTarget) {
                    return;
                }
                setModifiersOpen(!modifiersOpen);
            });
        }

        const setAllModifierGroupsState = (expandAll = false) => {
            const cards = document.querySelectorAll('.modifier-group-card');
            cards.forEach(card => {
                if (expandAll) {
                    card.classList.add('is-expanded');
                    card.classList.remove('is-collapsed');
                } else {
                    card.classList.remove('is-expanded');
                    if (card.classList.contains('is-collapsible')) {
                        card.classList.add('is-collapsed');
                    }
                }
            });
            requestAnimationFrame(layoutModifierMasonry);
            updateModifierGroupHighlights();
        };

        toggleModifiersBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (modifiersToggleClickTimer) {
                window.clearTimeout(modifiersToggleClickTimer);
            }
            modifiersToggleClickTimer = window.setTimeout(() => {
                modifiersToggleClickTimer = null;
                setModifiersOpen(!modifiersOpen);
            }, modifiersToggleClickDelayMs);
        });

        toggleModifiersBtn.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (modifiersToggleClickTimer) {
                window.clearTimeout(modifiersToggleClickTimer);
                modifiersToggleClickTimer = null;
            }
            if (!modifiersOpen) {
                setModifiersOpen(true);
            }
            const cards = document.querySelectorAll('.modifier-group-card');
            const hasCollapsed = Array.from(cards).some(card => !card.classList.contains('is-expanded'));
            setAllModifierGroupsState(hasCollapsed);
            updateModifierGroupHighlights();
        });
    }
    
    const makeLocalDiagEntry = (label, details = '', level = 'info', type = 'PING') => ({
        ts: Date.now(),
        type,
        label,
        details,
        level
    });

    const measureDiagEntryHeight = (body) => {
        if (!body) return DIAG_ENTRY_FALLBACK_HEIGHT;
        if (diagEntryHeightCache.has(body)) {
            return diagEntryHeightCache.get(body);
        }
        const sample = body.querySelector('.diag-entry');
        const height = sample ? sample.getBoundingClientRect().height : DIAG_ENTRY_FALLBACK_HEIGHT;
        const resolved = Math.max(height || DIAG_ENTRY_FALLBACK_HEIGHT, DIAG_ENTRY_FALLBACK_HEIGHT);
        diagEntryHeightCache.set(body, resolved);
        return resolved;
    };

    const adjustDiagBodyHeight = (body, entryCount = 0) => {
        if (!body) return;
        const entryHeight = measureDiagEntryHeight(body);
        const visibleCount = Math.max(1, Math.min(entryCount || 1, DIAG_ENTRY_LIMIT));
        const dynamicHeight = entryHeight * visibleCount;
        const targetHeight = diagnosticsExpanded
            ? Math.max(DIAG_BASE_HEIGHT, dynamicHeight)
            : DIAG_COLLAPSED_HEIGHT;
        body.style.maxHeight = `${targetHeight}px`;
        if (diagnosticsExpanded) {
            body.scrollTop = body.scrollHeight;
        } else {
            body.scrollTop = 0;
        }
    };

    const refreshAllDiagBodies = () => {
        if (!diagnosticsLogWrapper) return;
        diagnosticsLogWrapper.querySelectorAll('.diag-modal-body').forEach((body) => {
            const entries = body.querySelectorAll('.diag-entry').length;
            adjustDiagBodyHeight(body, entries);
        });
    };

    const setPingButtonState = (llmName, state, message = '') => {
        const btn = manualPingButtons[llmName];
        if (!btn) return;
        btn.dataset.pending = state === 'pending' ? 'true' : 'false';
        btn.classList.toggle('is-pending', state === 'pending');
        btn.classList.remove('ping-success', 'ping-error', 'ping-unchanged');
        if (state === 'success') btn.classList.add('ping-success');
        if (state === 'error') btn.classList.add('ping-error');
        if (state === 'unchanged') btn.classList.add('ping-unchanged');
        if (message) btn.title = message;
        if (state !== 'pending') {
            setTimeout(() => {
                const currentBtn = manualPingButtons[llmName];
                if (currentBtn) {
                    currentBtn.classList.remove('ping-success', 'ping-error', 'ping-unchanged');
                    currentBtn.title = currentBtn.dataset.statusTitle || 'Get answer';
                }
            }, 2000);
        }
    };

    const triggerManualPing = (llmName, button, options = {}) => {
        if (!llmName || !button) return;
        if (button.dataset.pending === 'true') return;
        const advanceStrategy = options.advanceStrategy === true
            || (options.advanceStrategy !== false && manualRecoveryAdvanceNext[llmName] === true);

        button.dataset.pending = 'true';
        button.classList.add('is-pending');
        button.setAttribute('aria-busy', 'true');
        manualPingButtons[llmName] = button;
        manualPingReveal.add(llmName);
        setPingButtonState(llmName, 'pending');

        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            button.dataset.pending = 'false';
            button.classList.remove('is-pending');
            button.removeAttribute('aria-busy');
        };
        const failSafeTimer = setTimeout(() => {
            release();
            console.warn(`[RESULTS] Manual ping timeout for ${llmName}`);
            ingestLogs(llmName, [makeLocalDiagEntry('Manual ping: UI response timeout', '', 'warning')]);
        }, 8000);

        ingestLogs(llmName, [makeLocalDiagEntry(
            String(options.source || '').startsWith('status_indicator_')
                ? 'Manual ping: status indicator request'
                : 'Manual ping: button click',
            `advance=${advanceStrategy ? 'true' : 'false'} source=${options.source || 'button'}`,
            'info'
        )]);

        const useRequestResponsePath = String(options.source || '').startsWith('status_indicator_');
        chrome.runtime.sendMessage({
            type: useRequestResponsePath ? 'REQUEST_LLM_RESPONSE' : 'MANUAL_RESPONSE_PING',
            llmName,
            manualRecovery: true,
            advanceStrategy,
            reason: options.source || 'manual_button'
        }, (response) => {
            clearTimeout(failSafeTimer);
            release();
            manualPingButtons[llmName] = button;

            if (chrome.runtime.lastError) {
                console.error(`[RESULTS] Manual ping failed for ${llmName}:`, chrome.runtime.lastError.message);
                ingestLogs(llmName, [makeLocalDiagEntry('Manual ping: UI error', chrome.runtime.lastError.message, 'error')]);
                if (typeof showNotification === 'function') {
                    showNotification(`Failed to send ping for ${llmName}: ${chrome.runtime.lastError.message}`);
                }
                setPingButtonState(llmName, 'error', chrome.runtime.lastError.message);
                return;
            }

            const status = response?.status;
            const errorMessage = response?.error || 'Unknown error';

            if (status === 'cached_response_sent') {
                ingestLogs(llmName, [makeLocalDiagEntry(
                    'Manual ping: cached response requested',
                    `source=${options.source || 'button'}`,
                    'success'
                )]);
                setPingButtonState(llmName, 'success', 'Answer loaded from cache');
                manualRecoveryAdvanceNext[llmName] = true;
            } else if (status === 'manual_ping_sent') {
                console.log(`[RESULTS] Manual ping dispatched for ${llmName}`);
                const strategyDetails = response?.strategyId
                    ? `strategy=${response.strategyId} attempt=${response.attempt ?? 0} advance=${advanceStrategy ? 'true' : 'false'}`
                    : '';
                ingestLogs(llmName, [makeLocalDiagEntry('Manual ping sent (waiting for response)', strategyDetails, 'success')]);
                manualRecoveryAdvanceNext[llmName] = true;
            } else if (status === 'manual_ping_failed') {
                ingestLogs(llmName, [makeLocalDiagEntry('Manual ping not sent', errorMessage, 'error')]);
                if (typeof showNotification === 'function') {
                    showNotification(`Ping not sent for ${llmName}: ${errorMessage}`);
                }
                setPingButtonState(llmName, 'error', errorMessage);
            } else {
                ingestLogs(llmName, [makeLocalDiagEntry('Manual ping: unknown status', status || 'no data', 'warning')]);
                setPingButtonState(llmName, 'error', 'Unknown ping status');
            }
        });
    };

    statusPingButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const llmName = button.dataset.llmName;
            if (!llmName) return;
            triggerManualPing(llmName, button);
        });
    });
    function escapeAttrValue(value = '') {
        if (window.CSS && typeof CSS.escape === 'function') {
            return CSS.escape(value);
        }
        return String(value).replace(/"/g, '\\"');
    }

    function ensureDiagnosticsState(llmName) {
        if (!diagnosticsState[llmName]) {
            diagnosticsState[llmName] = { collapsed: false, userToggled: false };
        }
        return diagnosticsState[llmName];
    }

    function getDiagnosticsContainer(llmName) {
        const selector = `.llm-diagnostics[data-llm-name="${escapeAttrValue(llmName)}"]`;
        return document.querySelector(selector);
    }

    function setDiagnosticsCollapsed(llmName, collapsed) {
        const state = ensureDiagnosticsState(llmName);
        state.collapsed = collapsed;
        const container = getDiagnosticsContainer(llmName);
        if (!container) return;
        const toggle = container.querySelector('.diag-toggle');
        container.dataset.collapsed = collapsed ? 'true' : 'false';
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(!collapsed));
        }
    }

    function formatDiagTimestamp(ts) {
        if (!ts) return '--:--:--';
        try {
            return new Intl.DateTimeFormat(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }).format(new Date(ts));
        } catch (_) {
            const date = new Date(ts);
            return date.toLocaleTimeString();
        }
    }

    const stringifyDiagMeta = (meta = null) => {
        if (!meta || typeof meta !== 'object') return '';
        try {
            const json = JSON.stringify(meta, null, 2);
            if (!json || json === '{}' || json === 'null') return '';
            return json;
        } catch (err) {
            return '';
        }
    };

    const buildDiagMetaElement = (metaJson) => {
        if (!metaJson) return null;
        const details = document.createElement('details');
        details.className = 'diag-meta';
        const summary = document.createElement('summary');
        summary.textContent = 'meta';
        const pre = document.createElement('pre');
        pre.textContent = metaJson;
        details.appendChild(summary);
        details.appendChild(pre);
        return details;
    };

    const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
    const LATIN1_REGEX = /[\u00C0-\u00FF]/;
    let diagTextDecoder = null;
    const decodeMojibake = (value = '') => {
        const raw = String(value || '');
        if (!raw) return raw;
        if (CYRILLIC_REGEX.test(raw)) return raw;
        if (!LATIN1_REGEX.test(raw)) return raw;
        if (typeof TextDecoder === 'undefined') return raw;
        if (!diagTextDecoder) {
            try {
                diagTextDecoder = new TextDecoder('utf-8');
            } catch (err) {
                diagTextDecoder = null;
            }
        }
        if (!diagTextDecoder) return raw;
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
            const code = raw.charCodeAt(i);
            if (code > 0xFF) return raw;
            bytes[i] = code;
        }
        try {
            const decoded = diagTextDecoder.decode(bytes);
            return CYRILLIC_REGEX.test(decoded) ? decoded : raw;
        } catch (err) {
            return raw;
        }
    };

    const buildDiagEntriesMarkup = (logs = []) => {
        return logs.map(entry => {
            const levelClass = `diag-${entry.level || 'info'}`;
            const sanitizedLabel = escapeHtml(decodeMojibake(entry.label));
            const details = entry.details
                ? `<span class="diag-details">${escapeHtml(decodeMojibake(entry.details))}</span>`
                : '';
            const metaBlock = stringifyDiagMeta(entry.meta);
            return `
                <div class="diag-entry ${levelClass}">
                    <span class="diag-time">${formatDiagTimestamp(entry.ts)}</span>
                    <span class="diag-label">${sanitizedLabel}</span>
                    ${details}
                    ${metaBlock ? `<details class="diag-meta"><summary>meta</summary><pre>${escapeHtml(metaBlock)}</pre></details>` : ''}
                </div>
            `;
        }).join('');
    };

    const computeDiagEntryId = (entry) => {
        const ts = entry?.ts || 0;
        const label = entry?.label || '';
        const details = entry?.details || '';
        const type = entry?.type || '';
        return `${ts}|${label}|${details}|${type}`;
    };

    const computeDiagEntryHash = (entry, metaJson) => {
        const level = entry?.level || 'info';
        const label = entry?.label || '';
        const details = entry?.details || '';
        return `${level}|${label}|${details}|${metaJson || ''}`;
    };

    const buildDiagEntryElement = (entry, metaJson) => {
        const element = document.createElement('div');
        const levelClass = `diag-${entry?.level || 'info'}`;
        element.className = `diag-entry ${levelClass}`;
        const time = document.createElement('span');
        time.className = 'diag-time';
        time.textContent = formatDiagTimestamp(entry?.ts);
        const label = document.createElement('span');
        label.className = 'diag-label';
        label.textContent = decodeMojibake(entry?.label);
        element.appendChild(time);
        element.appendChild(label);
        if (entry?.details) {
            const details = document.createElement('span');
            details.className = 'diag-details';
            details.textContent = decodeMojibake(entry.details);
            element.appendChild(details);
        }
        const metaEl = buildDiagMetaElement(metaJson);
        if (metaEl) element.appendChild(metaEl);
        return element;
    };

    const DIAGNOSTICS_EXPORT_STYLE = `
        body { font-family: Arial, sans-serif; background: #ffffff; color: #111827; padding: 24px; line-height: 1.5; }
        h1 { font-size: 24px; margin: 0 0 16px; }
        h2 { font-size: 18px; margin: 24px 0 12px; }
        .diag-section { margin-bottom: 24px; }
        .diag-entry { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 8px; background: #fff; }
        .diag-entry.diag-success { border-color: #4ade80; background: #f0fdf4; }
        .diag-entry.diag-warning { border-color: #facc15; background: #fefce8; }
        .diag-entry.diag-error { border-color: #f87171; background: #fef2f2; }
        .diag-entry.diag-info { border-color: #cbd5f5; background: #eef2ff; }
        .diag-entry.diag-api { border-color: #7dd3fc; background: #e0f2fe; }
        .diag-entry.diag-api-error { border-color: #fb7185; background: #fff1f2; color: #991b1b; }
        .diag-time { font-family: "DM Mono", monospace; font-size: 11px; color: #64748b; }
        .diag-label { font-weight: 600; color: #0f172a; }
        .diag-details { color: #475569; }
        .diag-placeholder { margin: 0; font-size: 13px; color: #6b7280; }
        .diag-meta { flex-basis: 100%; }
        .diag-meta summary { cursor: pointer; font-size: 12px; color: #475569; }
        .diag-meta pre { margin: 6px 0 0; background: #f8fafc; padding: 8px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; }
        .diag-export-meta { font-size: 12px; color: #475569; margin: 0 0 16px; }
        .diag-export-meta strong { font-weight: 600; }
        .diag-telemetry-section { margin-bottom: 24px; }
        .telemetry-table-wrapper { overflow-x: auto; }
        .telemetry-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
        .telemetry-table th,
        .telemetry-table td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
        .telemetry-table th { background: #f8fafc; font-weight: 600; }
        .telemetry-table tbody tr:nth-child(odd) { background: #f9fafb; }
    `;

    const buildDiagnosticsSectionHtml = (name, logs) => {
        const safeName = escapeHtml(name || 'Unknown');
        const content = logs.length
            ? buildDiagEntriesMarkup(logs)
            : '<p class="diag-placeholder">Log is empty</p>';
        return `
            <section class="diag-section">
                <h2>${safeName}</h2>
                ${content}
            </section>
        `;
    };

    const buildDiagnosticsExportMetaHtml = () => {
        const version = chrome?.runtime?.getManifest?.()?.version || 'unknown';
        const exportedAt = new Date().toLocaleString();
        return `
            <div class="diag-export-meta">
                <div><strong>Version:</strong> ${escapeHtml(version)}</div>
                <div><strong>Exported:</strong> ${escapeHtml(exportedAt)}</div>
            </div>
        `;
    };

    const buildDiagnosticsExportHtml = (title, sectionsHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)}</title>
    <style>
        ${DIAGNOSTICS_EXPORT_STYLE}
    </style>
</head>
<body>
    <h1>${escapeHtml(title)}</h1>
    ${buildDiagnosticsExportMetaHtml()}
    ${sectionsHtml}
</body>
</html>`;

    const TELEMETRY_BRIDGE_GLOBAL_KEY = 'DevtoolsTelemetryBridge';
    const formatTelemetryTimestamp = (value) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString();
    };
    const formatDuration = (ms) => {
        if (!Number.isFinite(ms) || ms < 0) return '';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        const seconds = ms / 1000;
        const digits = seconds >= 10 ? 0 : 1;
        const rounded = seconds.toFixed(digits);
        return `${rounded.replace(/\\.0$/, '')}s`;
    };
    const normalizeTelemetryDetailValue = (value) => {
        if (value == null) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        try {
            return JSON.stringify(value);
        } catch (err) {
            return String(value);
        }
    };
    const buildTelemetryDetails = (event) => {
        const meta = event?.meta || {};
        const detailParts = [
            event?.details,
            meta?.message,
            meta?.reason,
            meta?.status,
            meta?.degradedReason,
            meta?.errorCode
        ];
        return detailParts
            .map(normalizeTelemetryDetailValue)
            .filter(Boolean)
            .join(' | ');
    };
    const escapeMarkdownInline = (value = '') => {
        return String(value || '')
            .replace(/[\n\r]+/g, ' ')
            .replace(/([\\`*_{}\[\]()#+\-.!|])/g, '\\$1')
            .trim();
    };
    const resolveTelemetryPlatformName = (event) => {
        return event?.platform || event?.llmName || event?.meta?.llmName || event?.meta?.platform || 'unknown';
    };
    const parseRunSessionIdFromDispatchId = (dispatchId) => {
        const raw = String(dispatchId || '').trim();
        if (!raw) return null;
        const parts = raw.split(':');
        if (parts.length < 3) return null;
        const middle = Number(parts[1]);
        if (Number.isFinite(middle) && middle > 0) return middle;
        return null;
    };
    const resolveTelemetryRunSessionId = (event) => {
        const direct = Number(
            event?.meta?.runSessionId
            || event?.meta?.sessionId
            || event?.runSessionId
            || event?.sessionId
        );
        if (Number.isFinite(direct) && direct > 0) return direct;
        const dispatchId = event?.meta?.dispatchId || event?.dispatchId || event?.meta?.requestId;
        return parseRunSessionIdFromDispatchId(dispatchId);
    };
    const resolveCurrentRunSessionId = (events = []) => {
        const sorted = [...(Array.isArray(events) ? events : [])]
            .filter(Boolean)
            .sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
        for (const event of sorted) {
            const runSessionId = resolveTelemetryRunSessionId(event);
            if (Number.isFinite(runSessionId) && runSessionId > 0) return runSessionId;
        }
        return null;
    };
    const resolveLatestRound0StartTs = (events = []) => {
        return (Array.isArray(events) ? events : [])
            .filter((event) => (
                resolveTelemetryPlatformName(event) === 'ROUNDS'
                && resolveRoundLabel(event) === 'ROUND0_START'
                && Number.isFinite(Number(event?.ts))
            ))
            .map((event) => Number(event.ts))
            .reduce((acc, ts) => (ts > acc ? ts : acc), 0);
    };
    const filterTelemetryByRunSession = (events = [], runSessionId = null) => {
        const source = Array.isArray(events) ? events.slice() : [];
        const requestedRunSessionId = Number(runSessionId);
        const hasRequestedRunSessionId = runSessionId !== null
            && typeof runSessionId !== 'undefined'
            && Number.isFinite(requestedRunSessionId)
            && requestedRunSessionId > 0;
        const activeRunSessionId = hasRequestedRunSessionId
            ? requestedRunSessionId
            : resolveCurrentRunSessionId(source);
        if (!Number.isFinite(activeRunSessionId) || activeRunSessionId <= 0) {
            const cycleStartTs = resolveLatestRound0StartTs(source);
            if (!(cycleStartTs > 0)) {
                return {
                    events: [],
                    runSessionId: null,
                    minTs: null,
                    maxTs: null,
                    strict: true,
                    scopeMode: 'none'
                };
            }
            const cycleScoped = source.filter((event) => Number(event?.ts || 0) >= cycleStartTs);
            const timestamps = cycleScoped.map((event) => Number(event?.ts || 0)).filter((value) => Number.isFinite(value) && value > 0);
            return {
                events: cycleScoped,
                runSessionId: null,
                minTs: timestamps.length ? Math.min(...timestamps) : null,
                maxTs: timestamps.length ? Math.max(...timestamps) : null,
                strict: false,
                scopeMode: 'cycle'
            };
        }
        const scoped = source.filter((event) => resolveTelemetryRunSessionId(event) === activeRunSessionId);
        if (!scoped.length) {
            return {
                events: [],
                runSessionId: activeRunSessionId,
                minTs: null,
                maxTs: null,
                strict: true,
                scopeMode: 'run'
            };
        }
        const cycleStartTs = resolveLatestRound0StartTs(scoped);
        const cycleScoped = cycleStartTs > 0
            ? scoped.filter((event) => Number(event?.ts || 0) >= cycleStartTs)
            : scoped;
        const timestamps = cycleScoped.map((event) => Number(event?.ts || 0)).filter((value) => Number.isFinite(value) && value > 0);
        const minTs = timestamps.length ? Math.min(...timestamps) : null;
        const maxTs = timestamps.length ? Math.max(...timestamps) : null;
        return {
            events: cycleScoped,
            runSessionId: activeRunSessionId,
            minTs,
            maxTs,
            strict: true,
            scopeMode: 'run'
        };
    };
    const resolveDiagnosticRunSessionId = (entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const direct = Number(entry?.meta?.runSessionId || entry?.meta?.sessionId || entry?.runSessionId || entry?.sessionId);
        if (Number.isFinite(direct) && direct > 0) return direct;
        const dispatchId = entry?.meta?.dispatchId || entry?.dispatchId;
        if (dispatchId) {
            const parsed = parseRunSessionIdFromDispatchId(dispatchId);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return null;
    };
    const filterDiagnosticsByRunSession = (sources = [], logs = {}, runSessionId = null, minTs = null, maxTs = null) => {
        const scopedLogs = {};
        const scopedSources = [];
        const lowerTs = Number.isFinite(minTs) ? (minTs - 30000) : null;
        const upperTs = Number.isFinite(maxTs) ? (maxTs + 60000) : null;
        if (!Number.isFinite(runSessionId) || runSessionId <= 0) {
            if (!(lowerTs != null && upperTs != null)) {
                return { sources: [], logs: {} };
            }
            (sources || []).forEach((name) => {
                const entries = Array.isArray(logs?.[name]) ? logs[name] : [];
                const filtered = entries.filter((entry) => {
                    const ts = Number(entry?.ts || 0);
                    return Number.isFinite(ts) && ts > 0 && ts >= lowerTs && ts <= upperTs;
                });
                if (!filtered.length) return;
                scopedLogs[name] = filtered;
                scopedSources.push(name);
            });
            return { sources: scopedSources, logs: scopedLogs };
        }
        (sources || []).forEach((name) => {
            const entries = Array.isArray(logs?.[name]) ? logs[name] : [];
            const filtered = entries.filter((entry) => {
                const entryRun = resolveDiagnosticRunSessionId(entry);
                if (Number.isFinite(entryRun) && entryRun > 0) {
                    return entryRun === runSessionId;
                }
                const ts = Number(entry?.ts || 0);
                if (lowerTs != null && upperTs != null && Number.isFinite(ts) && ts > 0) {
                    return ts >= lowerTs && ts <= upperTs;
                }
                return false;
            });
            if (!filtered.length) return;
            scopedLogs[name] = filtered;
            scopedSources.push(name);
        });
        return { sources: scopedSources, logs: scopedLogs };
    };
    const normalizeRoundLabel = (label = '') => {
        return String(label || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    };
    const resolveRoundLabel = (event) => {
        const raw = event?.label || event?.meta?.event || event?.event || '';
        return String(raw || '').trim().toUpperCase();
    };
    const resolveRoundDescriptor = (event) => {
        const rawLabel = resolveRoundLabel(event);
        const normalizedLabel = normalizeRoundLabel(rawLabel);
        if (normalizedLabel === 'ROUND0_TAB_OPENED') {
            return { roundIndex: 0, phase: 'END' };
        }
        const metaRound = Number(event?.meta?.round);
        let roundIndex = Number.isFinite(metaRound) ? metaRound : null;
        let phase = null;
        const match = normalizedLabel.match(/^ROUND(\\d+)_([A-Z0-9]+)$/);
        if (match) {
            if (!Number.isFinite(roundIndex)) {
                roundIndex = Number(match[1]);
            }
            const rawPhase = match[2] || null;
            if (rawPhase === 'COMPLETE') {
                phase = 'END';
            } else if (rawPhase === 'VERIFY') {
                phase = 'START';
            } else {
                phase = rawPhase;
            }
        } else if (Number.isFinite(roundIndex)) {
            if (normalizedLabel.includes('START')) phase = 'START';
            else if (normalizedLabel.includes('END')) phase = 'END';
            else if (normalizedLabel.includes('COMPLETE')) phase = 'END';
        }
        if (!Number.isFinite(roundIndex) || roundIndex < 0) return null;
        if (!phase) return null;
        return { roundIndex, phase };
    };
    const buildTelemetryRoundsMarkdown = (events = []) => {
        const title = 'Telemetry Rounds';
        const header = `## ${title}`;
        if (!events.length) {
            return `${header}\n\n_No telemetry rounds were captured._\n\n`;
        }
        const matrix = new Map();
        (Array.isArray(events) ? events : []).forEach((event) => {
            const platform = resolveTelemetryPlatformName(event);
            if (!platform || platform === 'ROUNDS') return;
            const label = resolveRoundLabel(event);
            const entry = matrix.get(platform) || { rounds: new Map(), focusStucks: [] };
            if (label === 'FOCUS_STUCK') {
                entry.focusStucks.push(event);
                matrix.set(platform, entry);
                return;
            }
            const resolved = resolveRoundDescriptor(event);
            if (!resolved) return;
            const { roundIndex, phase } = resolved;
            const roundInfo = entry.rounds.get(roundIndex) || { start: null, end: null };
            if (phase === 'START' && !roundInfo.start) roundInfo.start = event;
            if (phase === 'END' && !roundInfo.end) roundInfo.end = event;
            entry.rounds.set(roundIndex, roundInfo);
            matrix.set(platform, entry);
        });
        const assignFocusStuck = (entry) => {
            (entry.focusStucks || []).forEach((evt) => {
                const ts = evt?.ts;
                if (!Number.isFinite(ts)) return;
                let candidate = null;
                entry.rounds.forEach((info, roundIndex) => {
                    const startTs = info.start?.ts;
                    const endTs = info.end?.ts;
                    if (!Number.isFinite(startTs)) return;
                    const inWindow = (Number.isFinite(endTs) && ts >= startTs && ts <= endTs)
                        || (!Number.isFinite(endTs) && ts >= startTs);
                    if (inWindow) {
                        if (!candidate || startTs > (candidate.startTs || 0)) {
                            candidate = { roundIndex, startTs };
                        }
                    }
                });
                if (!candidate) {
                    entry.rounds.forEach((info, roundIndex) => {
                        const startTs = info.start?.ts;
                        if (!Number.isFinite(startTs)) return;
                        if (!candidate || startTs > candidate.startTs) {
                            candidate = { roundIndex, startTs };
                        }
                    });
                }
                if (!candidate) return;
                const roundInfo = entry.rounds.get(candidate.roundIndex) || { start: null, end: null };
                roundInfo.focusStuck = evt;
                entry.rounds.set(candidate.roundIndex, roundInfo);
            });
        };
        matrix.forEach(assignFocusStuck);
        matrix.forEach((entry) => {
            const round4 = entry.rounds.get(4);
            const round4EndTs = round4?.end?.ts;
            if (!Number.isFinite(round4EndTs)) return;
            [0, 1, 2, 3].forEach((roundIndex) => {
                const roundInfo = entry.rounds.get(roundIndex);
                if (!roundInfo?.start || roundInfo.end) return;
                const startTs = roundInfo.start?.ts;
                if (Number.isFinite(startTs) && startTs <= round4EndTs) {
                    roundInfo.end = round4.end;
                    roundInfo.inferredEnd = true;
                    entry.rounds.set(roundIndex, roundInfo);
                }
            });
        });
        const roundColumns = [0, 1, 2, 3, 4].map((n) => `R${n}`);
        const rows = Array.from(matrix.entries()).map(([platform, entry]) => {
            const cells = roundColumns.map((_, idx) => {
                const roundInfo = entry.rounds.get(idx);
                if (!roundInfo || (!roundInfo.start && !roundInfo.end)) return '○ —';
                const ts = roundInfo.end?.ts || roundInfo.start?.ts;
                const timeLabel = ts ? formatTelemetryTimestamp(ts) : '—';
                const isComplete = Boolean(roundInfo.end);
                const parts = [isComplete ? `${timeLabel} done` : `${timeLabel} running`];
                if (roundInfo.inferredEnd) {
                    parts.push('inferred');
                }
                if (isComplete && roundInfo.end?.meta?.durationMs) {
                    const durationText = formatDuration(roundInfo.end.meta.durationMs);
                    if (durationText) parts.push(durationText);
                }
                if (roundInfo.focusStuck?.ts) {
                    const stuckTime = formatTelemetryTimestamp(roundInfo.focusStuck.ts);
                    if (stuckTime) parts.push(`stuck ${stuckTime}`);
                }
                return parts.join(' • ');
            });
            return `${escapeMarkdownInline(platform)} | ${cells.map(escapeMarkdownInline).join(' | ')}`;
        });
        const headerRow = ['Model', ...roundColumns].join(' | ');
        const divider = ['---', ...roundColumns.map(() => '---')].join(' | ');
        return `${header}\n\n${headerRow}\n${divider}\n${rows.join('\n')}\n\n`;
    };
    const buildTelemetrySectionMarkdown = (events = []) => {
        const title = 'Telemetry events';
        const header = events.length ? `## ${title} (${events.length})` : `## ${title}`;
        if (!events.length) {
            return `${header}\n\n_No telemetry events were captured._\n\n`;
        }
        const sortedEvents = [...events].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
        const rows = sortedEvents.map((event) => {
            const time = formatTelemetryTimestamp(event?.ts) || '-';
            const platform = escapeMarkdownInline(resolveTelemetryPlatformName(event));
            const dispatchId = escapeMarkdownInline(event?.meta?.dispatchId || event?.meta?.requestId || '-');
            const label = escapeMarkdownInline(event?.label || event?.meta?.event || event?.type || 'event');
            const level = escapeMarkdownInline(String(event?.level || 'info'));
            const details = escapeMarkdownInline(buildTelemetryDetails(event)) || '-';
            return `${time} | ${platform} | ${dispatchId} | ${label} | ${level} | ${details}`;
        }).join('\n');
        const hasRound2 = sortedEvents.some((event) => (event?.label || '').toUpperCase() === 'ROUND2_VERIFY');
        const hasTabVisit = sortedEvents.some((event) => (event?.label || '').toUpperCase() === 'TAB_VISIT');
        const notes = [];
        if (hasRound2) notes.push('Round2 verification events are included.');
        if (hasTabVisit) notes.push('TAB_VISIT durations are included.');
        const noteSection = notes.length ? `\n> Note: ${notes.join(' ')}\n` : '\n';
        return `${header}\n\nTime | Platform | DispatchId | Event | Level | Details\n--- | --- | --- | --- | --- | ---\n${rows}\n\n${noteSection}`;
    };
    const buildDiagnosticsSectionMarkdown = (sources = [], logs = {}) => {
        const header = '## Diagnostics Logs';
        if (!sources.length) {
            return `${header}\n\n_No diagnostics logs available for export._\n`;
        }
        const sections = sources.map((name) => {
            const entries = logs[name] || [];
            const sectionHeader = `### ${escapeMarkdownInline(name || 'Unknown')}`;
            if (!entries.length) {
                return `${sectionHeader}\n\n_No logs captured for this model._`;
            }
            const lines = entries.map((entry) => {
                const time = formatDiagTimestamp(entry.ts);
                const label = escapeMarkdownInline(entry.label || 'event');
                const detail = escapeMarkdownInline(entry.details || '');
                const detailText = detail ? ` — ${detail}` : '';
                return `- [${time}] ${label}${detailText}`;
            }).join('\n');
            return `${sectionHeader}\n\n${lines}`;
        }).join('\n\n');
        return `${header}\n\n${sections}\n`;
    };
    const buildRunOutcomeSummaryMarkdown = (summary) => {
        if (!summary?.success || !Array.isArray(summary.models) || !summary.models.length) {
            return '';
        }
        const header = '## Run Summary (background state)';
        const stateLine = summary.complete
            ? '> Run state: complete (all models terminal)'
            : '> Run state: export during active run — some models have no terminal outcome yet';
        const rows = summary.models.map((model) => {
            const finalStatus = model.terminal ? (model.finalStatus || 'terminal') : 'no_terminal_outcome';
            const finalizedAt = model.finalizedAt ? new Date(model.finalizedAt).toLocaleTimeString() : '-';
            const lengthInfo = model.suspectShortSuccess
                ? `${model.answerLength} (suspect short)`
                : String(model.answerLength || 0);
            return `${model.llmName} | ${finalStatus} | ${finalizedAt} | ${lengthInfo} | ${model.answerSource || '-'} | ${model.lengthPolicyRef || '-'}`;
        }).join('\n');
        return `${header}\n\n${stateLine}\n\nModel | Final | Finalized at | Answer chars | Source | Length policy\n--- | --- | --- | --- | --- | ---\n${rows}\n\n`;
    };
    const requestRunOutcomeSummary = () => new Promise((resolve) => {
        const runtime = (typeof chrome !== 'undefined' && chrome?.runtime) ? chrome.runtime : null;
        if (!runtime?.sendMessage) {
            resolve(null);
            return;
        }
        try {
            runtime.sendMessage({ type: 'GET_RUN_OUTCOME_SUMMARY' }, (resp) => {
                if (runtime.lastError) {
                    resolve(null);
                    return;
                }
                resolve(resp || null);
            });
        } catch (_) {
            resolve(null);
        }
    });
    const buildAllLogsMarkdown = (telemetryEvents = [], sources = [], logs = {}, runOutcomeSummary = null) => {
        const title = 'All Logs';
        const version = chrome?.runtime?.getManifest?.()?.version || 'unknown';
        const exportedAt = new Date().toLocaleString();
        const runScope = filterTelemetryByRunSession(telemetryEvents);
        const scopedTelemetryEvents = runScope.events;
        const scopedDiagnostics = filterDiagnosticsByRunSession(
            sources,
            logs,
            runScope.runSessionId,
            runScope.minTs,
            runScope.maxTs
        );
        const telemetrySection = buildTelemetrySectionMarkdown(scopedTelemetryEvents);
        const telemetryRoundsSection = buildTelemetryRoundsMarkdown(scopedTelemetryEvents);
        const runSummarySection = buildRunOutcomeSummaryMarkdown(runOutcomeSummary);
        const diagnosticsSection = buildDiagnosticsSectionMarkdown(scopedDiagnostics.sources, scopedDiagnostics.logs);
        const runLine = runScope.runSessionId
            ? `Run session: ${runScope.runSessionId} (${runScope.strict ? 'current' : 'fallback'})`
            : (runScope.scopeMode === 'cycle'
                ? 'Run session: n/a (cycle fallback)'
                : 'Run session: n/a (no active run)');
        return `# ${title}\nVersion: ${version}\nExported: ${exportedAt}\n${runLine}\n\n${telemetrySection}${telemetryRoundsSection}${runSummarySection}${diagnosticsSection}`;
    };

    const cloneLogEntry = (entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const cloned = { ...entry };
        if (entry.meta && typeof entry.meta === 'object') {
            cloned.meta = { ...entry.meta };
        }
        return cloned;
    };

    const cloneLogsByModel = (logs = {}) => {
        const snapshot = {};
        Object.keys(logs || {}).forEach((name) => {
            const entries = logs[name] || [];
            snapshot[name] = entries.map(cloneLogEntry);
        });
        return snapshot;
    };

    const buildAllLogsComparisonMarkdown = (beforeSnapshot, afterSnapshot, meta = {}) => {
        const title = 'All Logs (Before/After)';
        const version = chrome?.runtime?.getManifest?.()?.version || 'unknown';
        const exportedAt = new Date().toLocaleString();
        const beforeAt = beforeSnapshot?.capturedAt || '-';
        const afterAt = afterSnapshot?.capturedAt || '-';
        const trigger = meta?.trigger || 'unknown';
        const beforeSection = buildAllLogsMarkdown(
            beforeSnapshot?.telemetryEvents || [],
            beforeSnapshot?.sources || [],
            beforeSnapshot?.logs || {}
        );
        const afterSection = buildAllLogsMarkdown(
            afterSnapshot?.telemetryEvents || [],
            afterSnapshot?.sources || [],
            afterSnapshot?.logs || {}
        );
        return `# ${title}\nVersion: ${version}\nExported: ${exportedAt}\nBefore captured: ${beforeAt}\nAfter captured: ${afterAt}\nTrigger: ${trigger}\n\n## Before\n\n${beforeSection}\n\n## After\n\n${afterSection}`;
    };
    const getTelemetryBridge = () => {
        if (typeof window === 'undefined') return null;
        return window[TELEMETRY_BRIDGE_GLOBAL_KEY] || null;
    };
    const requestTelemetryEventsViaRuntime = () => new Promise((resolve) => {
        const runtime = (typeof chrome !== 'undefined' && chrome?.runtime) ? chrome.runtime : null;
        if (!runtime?.sendMessage) {
            resolve([]);
            return;
        }
        try {
            runtime.sendMessage({ type: 'GET_DIAG_EVENTS', limit: 400 }, (resp) => {
                if (runtime.lastError) {
                    resolve([]);
                    return;
                }
                if (resp?.success && Array.isArray(resp.events)) {
                    resolve(resp.events.slice());
                    return;
                }
                resolve([]);
            });
        } catch (err) {
            console.warn('[Diagnostics] telemetry export fetch failed', err);
            resolve([]);
        }
    });
    const mergeTelemetryExports = (primary = [], secondary = []) => {
        const merged = [];
        const seen = new Set();
        const pushUnique = (entry) => {
            if (!entry) return;
            const ts = entry?.ts || '';
            const label = entry?.label || entry?.meta?.event || '';
            const platform = entry?.platform || entry?.llmName || entry?.meta?.llmName || '';
            const details = entry?.details || '';
            const key = `${ts}|${label}|${platform}|${details}`;
            if (!key || seen.has(key)) return;
            seen.add(key);
            merged.push(entry);
        };
        primary.forEach(pushUnique);
        secondary.forEach(pushUnique);
        return merged;
    };
    const getTelemetryEventsForExport = async () => {
        const bridge = getTelemetryBridge();
        let bridgeEvents = [];
        if (bridge && typeof bridge.getLatestEvents === 'function') {
            const latest = bridge.getLatestEvents();
            if (Array.isArray(latest) && latest.length) {
                bridgeEvents = latest.slice();
            }
        }
        const runtimeEvents = await requestTelemetryEventsViaRuntime();
        if (bridgeEvents.length && runtimeEvents.length) {
            return mergeTelemetryExports(bridgeEvents, runtimeEvents);
        }
        if (bridgeEvents.length) return bridgeEvents;
        if (runtimeEvents.length) return runtimeEvents;
        return [];
    };

    const snapshotAllLogs = async () => {
        const sources = Object.keys(llmLogs || {}).filter((name) => (llmLogs[name] || []).length);
        let telemetryEvents = [];
        try {
            telemetryEvents = await getTelemetryEventsForExport();
        } catch (err) {
            console.warn('[Diagnostics] telemetry export snapshot failed', err);
        }
        return {
            sources,
            telemetryEvents: telemetryEvents.slice(),
            logs: cloneLogsByModel(llmLogs),
            capturedAt: new Date().toLocaleString()
        };
    };

    const detectManualIntervention = (events = [], logs = {}, sinceTs) => {
        const normalizedSince = Number(sinceTs || 0);
        const telemetryHit = (events || []).find((event) => {
            if (!event?.ts || event.ts < normalizedSince) return false;
            const labelRaw = event?.label || event?.meta?.event || '';
            const label = String(labelRaw).toUpperCase();
            if (label === 'USER_FOCUS_CHANGE') return true;
            if (label === 'HUMAN_VISIT_START') {
                const source = String(event?.meta?.source || '').toLowerCase();
                return source === 'user_focus';
            }
            return false;
        });
        if (telemetryHit) {
            return { trigger: 'user_focus', event: telemetryHit };
        }
        const manualPingMatch = Object.values(logs || {}).some((entries) => (
            (entries || []).some((entry) => {
                if (!entry?.ts || entry.ts < normalizedSince) return false;
                const label = String(entry?.label || '').toLowerCase();
                const details = String(entry?.details || '').toLowerCase();
                return label.includes('manual ping') || details.includes('manual ping');
            })
        ));
        if (manualPingMatch) {
            return { trigger: 'manual_ping' };
        }
        return null;
    };

    const sanitizeFileSegment = (value, fallback) => {
        const cleaned = String(value || '').replace(/[\\/:*?"<>|]/g, '').trim();
        return cleaned || fallback;
    };

    const formatDiagnosticsExportStamp = () => {
        const now = new Date();
        const pad = (num) => String(num).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    };

    const downloadDiagnosticsHtml = (fileBase, htmlContent, button) => {
        const safeBase = sanitizeFileSegment(fileBase, 'Diagnostics');
        const fileName = `${safeBase} ${formatDiagnosticsExportStamp()}.html`;
        try {
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            if (button) flashButtonFeedback(button, 'success');
        } catch (err) {
            console.error('[Diagnostics Export] failed', err);
            if (button) flashButtonFeedback(button, 'error');
        }
    };
    const downloadDiagnosticsMarkdown = (fileBase, markdownContent, button) => {
        const safeBase = sanitizeFileSegment(fileBase, 'Diagnostics');
        const fileName = `${safeBase} ${formatDiagnosticsExportStamp()}.md`;
        try {
            const blob = new Blob([markdownContent], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            if (button) flashButtonFeedback(button, 'success');
        } catch (err) {
            console.error('[Diagnostics Export] failed', err);
            if (button) flashButtonFeedback(button, 'error');
        }
    };

    function applyDiagnosticsExpandState() {
        if (!diagnosticsLogWrapper) return;
        if (diagnosticsCollapseToggle) {
            diagnosticsCollapseToggle.classList.toggle('is-expanded', diagnosticsExpanded);
            diagnosticsCollapseToggle.setAttribute('aria-pressed', String(diagnosticsExpanded));
            diagnosticsCollapseToggle.setAttribute(
                'aria-label',
                diagnosticsExpanded ? 'Collapse diagnostics logs' : 'Restore compact diagnostics height'
            );
        }
        refreshAllDiagBodies();
    }

    const DEVTOOLS_PANELS_FIXED_HEIGHT = 520;
    const syncDevtoolsPanelHeight = () => {
        const modal = document.getElementById('api-keys-modal');
        if (!modal) return;
        const panelsHost = modal.querySelector('.devtools-tabpanels');
        if (!panelsHost) return;
        panelsHost.style.setProperty('--devtools-panels-height', `${DEVTOOLS_PANELS_FIXED_HEIGHT}px`);
    };

    function renderDiagnosticsModal() {
        if (!diagnosticsLogWrapper) return;
        const selectedModels = getSelectedLLMs();
        if (!selectedModels.length) {
            replaceChildrenFromHtml(diagnosticsLogWrapper, '<p class="diag-empty">No models selected.</p>');
            applyDiagnosticsExpandState();
            syncDevtoolsPanelHeight();
            return;
        }
        const sourceNames = selectedModels;
        const sections = sourceNames
            .map(llmName => {
                if (!llmName) return '';
                const logs = llmLogs[llmName] || [];
                const openAttr = ' open';
                const bodyContent = logs.length
                    ? buildDiagEntriesMarkup(logs)
                    : '<p class="diag-placeholder">Log is empty</p>';
                return `
                    <details class="diag-modal-block"${openAttr} data-llm-name="${escapeHtml(llmName)}">
                        <summary>
                            <span class="diag-modal-title">${escapeHtml(llmName)}</span>
                            <span class="diag-modal-count">${logs.length}</span>
                            <div class="diag-modal-actions">
                                <button type="button" class="diag-action-btn diag-export-action" data-action="export-html" aria-label="Export log for ${escapeHtml(llmName)} as HTML">&lt;/&gt;</button>
                                <button type="button" class="diag-action-btn diag-copy-action" data-action="copy-log" aria-label="Copy log for ${escapeHtml(llmName)}"><i class="ti ti-copy" aria-hidden="true"></i></button>
                                <button type="button" class="diag-action-btn diag-clear-action" data-action="clear-log" aria-label="Clear log for ${escapeHtml(llmName)}"><i class="ti ti-trash" aria-hidden="true"></i></button>
                            </div>
                        </summary>
                        <div class="diag-modal-body">
                            ${bodyContent}
                        </div>
                    </details>
                `;
            })
            .filter(Boolean)
            .join('');
        replaceChildrenFromHtml(
            diagnosticsLogWrapper,
            sections || '<p class="diag-empty">No logs for selected models.</p>'
        );
        applyDiagnosticsExpandState();
        syncDevtoolsPanelHeight();
    }

    function renderDiagnostics(llmName) {
        const container = getDiagnosticsContainer(llmName);
        if (!container) {
            renderDiagnosticsModal();
            return;
        }
        const logArea = container.querySelector('.diag-log');
        const countEl = container.querySelector('.diag-count');
        const allLogs = llmLogs[llmName] || [];
        // Prefer explicit diagnostic entries to avoid duplication.
        const diagOnly = allLogs.filter((entry) => (
            entry?.scope === 'diagnostic'
            || entry?.type === 'diagnostic'
            || entry?.channel === 'diagnostic'
            || entry?.diagnostic === true
        ));
        const logs = diagOnly.length ? diagOnly : allLogs;
        if (countEl) {
            countEl.textContent = logs.length;
        }
        if (!logArea) return;
        if (!logs.length) {
            replaceChildrenFromHtml(logArea, '<p class="diag-empty">Log is empty</p>');
            renderDiagnosticsModal();
            return;
        }
        const entries = logs.map((entry) => ({
            entry,
            metaJson: stringifyDiagMeta(entry?.meta)
        }));
        renderIncrementalList(logArea, entries, {
            getId: ({ entry }) => computeDiagEntryId(entry),
            getHash: ({ entry, metaJson }) => computeDiagEntryHash(entry, metaJson),
            renderItem: ({ entry, metaJson }) => buildDiagEntryElement(entry, metaJson)
        });
    renderDiagnosticsModal();
    }

    document.addEventListener('click', (event) => {
        const btn = event.target.closest('#export-diagnostics-html');
        if (!btn) return;
        const selectedModels = getSelectedLLMs();
        const sources = selectedModels.filter((name) => (llmLogs[name] || []).length);
        if (!sources.length) {
            flashButtonFeedback(btn, 'warn');
            return;
        }
        const sectionsHtml = sources
            .map((name) => buildDiagnosticsSectionHtml(name, llmLogs[name] || []))
            .join('');
        const htmlContent = buildDiagnosticsExportHtml('Diagnostics Logs', sectionsHtml);
        downloadDiagnosticsHtml('Diagnostics Logs', htmlContent, btn);
    });

    document.addEventListener('click', async (event) => {
        const btn = event.target.closest('#export-all-logs-md, #export-all-logs-md-telemetry');
        if (!btn) return;
        const sources = Object.keys(llmLogs || {}).filter((name) => (llmLogs[name] || []).length);
        let telemetryEvents = [];
        try {
            telemetryEvents = await getTelemetryEventsForExport();
        } catch (err) {
            console.warn('[Diagnostics] telemetry export failed', err);
        }
        const hasLogs = sources.length > 0;
        const hasTelemetry = telemetryEvents.length > 0;
        if (!hasLogs && !hasTelemetry) {
            flashButtonFeedback(btn, 'warn');
            return;
        }
        const runOutcomeSummary = await requestRunOutcomeSummary();
        const markdownContent = buildAllLogsMarkdown(telemetryEvents, sources, llmLogs, runOutcomeSummary);
        downloadDiagnosticsMarkdown('All Logs', markdownContent, btn);
    });

    if (diagnosticsLogWrapper) {
        diagnosticsLogWrapper.addEventListener('click', (event) => {
            const button = event.target.closest('.diag-action-btn');
            if (!button) return;
            const block = button.closest('.diag-modal-block');
            const modelName = block?.dataset?.llmName;
            if (!modelName) return;
            const action = button.dataset.action;
            if (action === 'export-html') {
                const entries = llmLogs[modelName] || [];
                if (!entries.length) {
                    flashButtonFeedback(button, 'warn');
                    return;
                }
                const sectionsHtml = buildDiagnosticsSectionHtml(modelName, entries);
                const htmlContent = buildDiagnosticsExportHtml(`Diagnostics ${modelName}`, sectionsHtml);
                downloadDiagnosticsHtml(`Diagnostics ${modelName}`, htmlContent, button);
                return;
            }
            if (action === 'copy-log') {
                const entries = llmLogs[modelName] || [];
                const logBody = entries.map((entry) => {
                    const time = formatDiagTimestamp(entry.ts);
                    const label = entry.label || '';
                    const details = entry.details ? ` – ${entry.details}` : '';
                    return `[${time}] ${label}${details}`;
                }).join('\n');
                const text = logBody
                    ? `<Dev logs ${modelName}>\n${logBody}\n</Dev logs>`
                    : '';
                if (navigator.clipboard && text) {
                    navigator.clipboard.writeText(text).catch(() => {
                        console.warn('[Diagnostics] Clipboard write failed');
                    });
                }
            }
            if (action === 'clear-log') {
                llmLogs[modelName] = [];
                renderDiagnostics(modelName);
            }
        });
    }


    function ingestLogs(llmName, logs = []) {
        if (!llmName || !Array.isArray(logs) || !logs.length) return;
        const state = ensureDiagnosticsState(llmName);
        const existing = llmLogs[llmName] || [];
        const map = new Map();
        [...existing, ...logs].forEach(entry => {
            if (!entry) return;
            const ts = entry.ts || Date.now();
            const key = `${ts}-${entry.label || ''}-${entry.details || ''}-${entry.type || ''}`;
            map.set(key, { ...entry, ts });
        });
        const merged = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
        if (merged.length > MAX_DIAGNOSTIC_ENTRIES) {
            merged.splice(0, merged.length - MAX_DIAGNOSTIC_ENTRIES);
        }
        llmLogs[llmName] = merged;
        if (state && state.collapsed && !state.userToggled) {
            setDiagnosticsCollapsed(llmName, false);
        }
        renderDiagnostics(llmName);
    }

    function autoCollapseDiagnostics(llmName, answerText) {
        if (!llmName) return;
        const state = ensureDiagnosticsState(llmName);
        if (state.userToggled || state.collapsed) return;
        if (answerText && typeof answerText === 'string' && answerText.trim().startsWith('Error:')) {
            return;
        }
        setDiagnosticsCollapsed(llmName, true);
        state.collapsed = true;
    }

    function initializeDiagnosticsUI() {
        llmPanels.forEach(panel => {
            const llmTitleEl = panel.querySelector('.llm-title');
            if (!llmTitleEl) return;
            const llmName = llmTitleEl.textContent.trim();
            if (!llmName) return;
            ensureDiagnosticsState(llmName);
            if (panel.querySelector('.llm-diagnostics')) return;
            const diagContainer = document.createElement('div');
            diagContainer.className = 'llm-diagnostics';
            diagContainer.dataset.llmName = llmName;
            const toggleButton = document.createElement('button');
            toggleButton.type = 'button';
            toggleButton.className = 'diag-toggle';
            toggleButton.setAttribute('aria-expanded', 'true');
            toggleButton.textContent = 'Diagnostics ';
            const count = document.createElement('span');
            count.className = 'diag-count';
            count.textContent = '0';
            toggleButton.appendChild(count);
            const log = document.createElement('div');
            log.className = 'diag-log';
            diagContainer.appendChild(toggleButton);
            diagContainer.appendChild(log);
            const outputElement = panel.querySelector('.output');
            panel.insertBefore(diagContainer, outputElement);
            const toggleBtn = toggleButton;
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    const state = ensureDiagnosticsState(llmName);
                    const nextCollapsed = !(state && state.collapsed === true);
                    state.userToggled = true;
                    setDiagnosticsCollapsed(llmName, nextCollapsed);
                });
            }
            setDiagnosticsCollapsed(llmName, false);
            renderDiagnostics(llmName);
        });
    }

    initializeDiagnosticsUI();
    initializeApiIndicators();

    // (reverted) Telemetry Dev UI removed to restore original layout and behavior.

    if (diagnosticsCollapseToggle) {
        diagnosticsCollapseToggle.addEventListener('click', () => {
            diagnosticsExpanded = !diagnosticsExpanded;
            applyDiagnosticsExpandState();
        });
    }
    applyDiagnosticsExpandState();
    const clearDiagnosticsView = () => {
        Object.keys(llmLogs).forEach((llmName) => {
            llmLogs[llmName] = [];
        });
        renderDiagnosticsModal();
        if (typeof showNotification === 'function') {
            showNotification('Diagnostics logs cleared.');
        }
    };

    const clearDiagnosticsStorage = () => {
        const runtime = (typeof chrome !== 'undefined' && chrome?.runtime) ? chrome.runtime : null;
        if (!runtime?.sendMessage) return;
        try {
            runtime.sendMessage({ type: 'CLEAR_DIAG_EVENTS' }, () => {
                if (runtime.lastError) {
                    console.warn('[results] telemetry diagnostics clear error', runtime.lastError);
                }
            });
        } catch (err) {
            console.warn('[results] telemetry diagnostics clear failed', err);
        }
    };

    if (clearDiagnosticsBtn) {
        clearDiagnosticsBtn.addEventListener('click', () => {
            clearDiagnosticsView();
            clearDiagnosticsStorage();
        });
    }
    
    const newPagesStorageKey = 'llmComparatorNewPages';
    const storeNewPagesState = (checked) => {
        chrome.storage.local.set({ [newPagesStorageKey]: checked });
    };
    if (newPagesCheckbox) {
        chrome.storage.local.get(newPagesStorageKey, (data) => {
            const stored = data?.[newPagesStorageKey];
            if (typeof stored === 'boolean') {
                newPagesCheckbox.checked = stored;
            }
        });
        newPagesCheckbox.addEventListener('change', () => {
            storeNewPagesState(newPagesCheckbox.checked);
        });
    }

    const apiModeStorageKey = 'llmComparatorApiModeEnabled';
    if (apiModeCheckbox) {
        chrome.storage.local.get(apiModeStorageKey, (data) => {
            const stored = data?.[apiModeStorageKey];
            if (typeof stored === 'boolean') {
                apiModeCheckbox.checked = stored;
            }
            if (syncApiToggleState) syncApiToggleState();
        });
        apiModeCheckbox.addEventListener('change', () => {
            chrome.storage.local.set({ [apiModeStorageKey]: apiModeCheckbox.checked });
            if (syncApiToggleState) syncApiToggleState();
        });
    }

    const updateDevToolsStatus = (message, tone = 'info') => {
        if (!devToolsStatus) return;
        devToolsStatus.textContent = message || '';
        devToolsStatus.dataset.tone = tone;
    };

    if (refreshOverridesBtn) {
        refreshOverridesBtn.addEventListener('click', () => {
            refreshOverridesBtn.disabled = true;
            updateDevToolsStatus('Refreshing remote selectors…', 'pending');
            chrome.runtime.sendMessage({ type: 'REFRESH_SELECTOR_OVERRIDES' }, () => {
                refreshOverridesBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    updateDevToolsStatus(`Refresh failed: ${chrome.runtime.lastError.message}`, 'error');
                }
                // success/failure will be reported via SELECTOR_OVERRIDE_REFRESH_RESULT
            });
        });
    }

    if (clearOverridesBtn) {
        clearOverridesBtn.addEventListener('click', () => {
            clearOverridesBtn.disabled = true;
            updateDevToolsStatus('Clearing overrides and cache…', 'pending');
            chrome.runtime.sendMessage({ type: 'CLEAR_SELECTOR_OVERRIDES_AND_CACHE' }, () => {
                clearOverridesBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    updateDevToolsStatus(`Clear failed: ${chrome.runtime.lastError.message}`, 'error');
                }
                // final status handled via SELECTOR_OVERRIDE_CLEARED
            });
        });
    }
    
    if (clearSelectorCacheBtn) {
        clearSelectorCacheBtn.addEventListener('click', () => {
            clearSelectorCacheBtn.disabled = true;
            updateDevToolsStatus('Clearing selector cache…', 'pending');
            chrome.runtime.sendMessage({ type: 'CLEAR_SELECTOR_CACHE' }, (response) => {
                clearSelectorCacheBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    updateDevToolsStatus(`Cache clear failed: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                if (response?.status === 'ok') {
                    updateDevToolsStatus(`Cache cleared (${response.removed || 0} entries)`, 'success');
                } else {
                    updateDevToolsStatus('Cache clear error', 'error');
                }
            });
        });
    }

    if (runSelectorHealthcheckBtn) {
        runSelectorHealthcheckBtn.addEventListener('click', () => {
            runSelectorHealthcheckBtn.disabled = true;
            updateDevToolsStatus('Running selector health-check…', 'pending');
            chrome.runtime.sendMessage({ type: 'RUN_SELECTOR_HEALTHCHECK' }, (response) => {
                runSelectorHealthcheckBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    updateDevToolsStatus(`Health-check failed: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                if (response?.status === 'ok') {
                    const failures = (response.results || []).filter((entry) => !entry.ok).length;
                    if (failures) {
                        updateDevToolsStatus(`Health-check finished: ${failures} models need attention`, 'warning');
                    } else {
                        updateDevToolsStatus('Health-check finished: all models OK', 'success');
                    }
                    requestSelectorHealthSummary(false);
                } else {
                    updateDevToolsStatus(response?.error || 'Health-check error', 'error');
                }
            });
        });
    }

    const getSelectedElementType = () => liveSelectorElementSelect?.value || 'composer';

    const formatSelectorSample = (sample) => {
        if (!sample) return '';
        const tag = sample.tag ? `<${sample.tag.toLowerCase()}>` : '';
        const text = sample.text ? ` — ${sample.text}` : '';
        return `${tag}${text}`.trim();
    };

    const summarizeValidation = (entry) => {
        if (!entry) return { text: 'No data', tone: 'warning' };
        if (entry.error) return { text: `Error: ${entry.error}`, tone: 'error' };
        const matches = Number(entry.matches || 0);
        const sample = formatSelectorSample(entry.sample);
        const tail = sample ? ` · ${sample}` : '';
        const text = matches > 0 ? `Found: ${matches}${tail}` : `Not found: 0`;
        return { text, tone: matches > 0 ? 'success' : 'warning' };
    };

    if (selectorDetectedRefreshBtn) {
        selectorDetectedRefreshBtn.addEventListener('click', () => {
            refreshActiveSelectorSnapshot();
        });
    }

    if (selectorValidateBtn) {
        selectorValidateBtn.addEventListener('click', () => {
            const modelName = getSelectedModelName();
            const selectorValue = selectorOverrideInput?.value?.trim();
            if (!modelName) {
                updateDevToolsStatus('Select a model to validate', 'warning');
                return;
            }
            if (!selectorValue) {
                updateDevToolsStatus('Enter a CSS selector to validate', 'warning');
                return;
            }
            setSelectorValidationStatus('Validating selector…');
            validateSelectorsOnModel(modelName, [selectorValue], (response) => {
                if (response?.status === 'no_tab') {
                    setSelectorValidationStatus('No active tab to validate', 'warning');
                    return;
                }
                if (response?.status !== 'ok') {
                    setSelectorValidationStatus(response?.error || 'Selector validation error', 'error');
                    return;
                }
                const entry = response.results?.[0] || null;
                lastSelectorValidation = entry ? { ...entry, selector: selectorValue, modelName } : null;
                const summary = summarizeValidation(entry);
                setSelectorValidationStatus(summary.text, summary.tone);
            });
        });
    }

    if (selectorValidateActiveBtn) {
        selectorValidateActiveBtn.addEventListener('click', () => {
            const modelName = getSelectedModelName();
            const elementType = getSelectedElementType();
            const selectors = activeSelectorSnapshot?.selectors?.[elementType] || [];
            if (!modelName) {
                updateDevToolsStatus('Select a model to validate', 'warning');
                return;
            }
            if (!selectors.length) {
                updateDevToolsStatus('No active selectors to validate', 'warning');
                return;
            }
            updateDevToolsStatus('Validating active selectors…', 'pending');
            validateSelectorsOnModel(modelName, selectors, (response) => {
                if (response?.status === 'no_tab') {
                    updateDevToolsStatus('No active tab to validate', 'warning');
                    return;
                }
                if (response?.status !== 'ok') {
                    updateDevToolsStatus(response?.error || 'Selectors validation error', 'error');
                    return;
                }
                activeSelectorValidationMap = new Map();
                (response.results || []).forEach((entry) => {
                    if (entry?.selector) activeSelectorValidationMap.set(entry.selector, entry);
                });
                renderActiveSelectors();
                updateDevToolsStatus('Selectors validation completed', 'success');
            });
        });
    }

    if (selectorPickBtn) {
        selectorPickBtn.addEventListener('click', () => {
            const modelName = getSelectedModelName();
            const elementType = getSelectedElementType();
            if (!modelName) {
                updateDevToolsStatus('Select a model to pick a selector', 'warning');
                return;
            }
            if (activePickerRequestId) {
                updateDevToolsStatus('Selection already active — finish it or press ESC', 'warning');
                return;
            }
            selectorPickBtn.disabled = true;
            updateDevToolsStatus('Selection active: click an element in the model tab', 'pending');
            chrome.runtime.sendMessage({ type: 'PICK_SELECTOR_START', modelName, elementType, mode: 'selector' }, (response) => {
                if (chrome.runtime.lastError) {
                    selectorPickBtn.disabled = false;
                    updateDevToolsStatus(`Failed to start selection: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                if (!response || response.status !== 'ok' || !response.requestId) {
                    selectorPickBtn.disabled = false;
                    updateDevToolsStatus(response?.error || 'Failed to start selection', 'error');
                    return;
                }
                activePickerRequestId = response.requestId;
                activePickerMode = 'override';
                if (pickerTimeoutId) clearTimeout(pickerTimeoutId);
                pickerTimeoutId = setTimeout(() => {
                    if (activePickerRequestId !== response.requestId) return;
                    activePickerRequestId = null;
                    activePickerMode = null;
                    selectorPickBtn.disabled = false;
                    updateDevToolsStatus('Selection timed out', 'warning');
                }, 60000);
            });
        });
    }

    if (selectorHighlightBtn) {
        selectorHighlightBtn.addEventListener('click', () => {
            const modelName = getSelectedModelName();
            const selectorValue = selectorOverrideInput?.value?.trim();
            if (!modelName) {
                updateDevToolsStatus('Select a model to highlight a selector', 'warning');
                return;
            }
            if (!selectorValue) {
                updateDevToolsStatus('Enter a CSS selector to highlight', 'warning');
                return;
            }
            updateDevToolsStatus('Highlighting selector…', 'pending');
            chrome.runtime.sendMessage({ type: 'HIGHLIGHT_SELECTOR', modelName, selector: selectorValue }, (response) => {
                if (chrome.runtime.lastError) {
                    updateDevToolsStatus(`Highlighting failed: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                if (response?.status === 'ok') {
                    updateDevToolsStatus('Selector highlighted in active tab', 'success');
                } else {
                    updateDevToolsStatus(response?.error || 'Failed to highlight selector', 'error');
                }
            });
        });
    }

    if (selectorSaveOverrideBtn) {
        selectorSaveOverrideBtn.addEventListener('click', () => {
            const modelName = getSelectedModelName();
            const elementType = getSelectedElementType();
            const selectorValue = selectorOverrideInput?.value?.trim();
            const reasonValue = selectorOverrideReasonInput?.value?.trim();
            if (!modelName || !selectorValue) {
                updateDevToolsStatus('Select a model and enter a selector to save', 'warning');
                return;
            }
            if (!reasonValue) {
                updateDevToolsStatus('Provide a reason or ticket for the override', 'warning');
                return;
            }
            const finalizeSave = () => {
                selectorSaveOverrideBtn.disabled = true;
                updateDevToolsStatus('Saving override…', 'pending');
                chrome.runtime.sendMessage(
                    { type: 'SAVE_SELECTOR_OVERRIDE', modelName, elementType, selector: selectorValue, reason: reasonValue },
                    (response) => {
                        selectorSaveOverrideBtn.disabled = false;
                        if (chrome.runtime.lastError) {
                            updateDevToolsStatus(`Save failed: ${chrome.runtime.lastError.message}`, 'error');
                            return;
                        }
                        if (response?.status === 'ok') {
                            updateDevToolsStatus('Override saved. Refresh the model tab to apply.', 'success');
                            requestSelectorDefinitions(modelName);
                            refreshSelectorAudit(modelName);
                            refreshActiveSelectorSnapshot();
                            refreshSavedOverridesList();
                            if (selectorOverrideReasonInput) selectorOverrideReasonInput.value = '';
                        } else {
                            updateDevToolsStatus(response?.error || 'Override save error', 'error');
                        }
                    }
                );
            };
            validateSelectorsOnModel(modelName, [selectorValue], (response) => {
                if (response?.status === 'no_tab') {
                    updateDevToolsStatus('No active tab; override saved without validation', 'warning');
                    setSelectorValidationStatus('No active tab to validate', 'warning');
                    finalizeSave();
                    return;
                }
                if (response?.status !== 'ok') {
                    updateDevToolsStatus(response?.error || 'Validation failed', 'error');
                    return;
                }
                const entry = response.results?.[0] || null;
                lastSelectorValidation = entry ? { ...entry, selector: selectorValue, modelName } : null;
                const summary = summarizeValidation(entry);
                setSelectorValidationStatus(summary.text, summary.tone);
                if (entry?.error) {
                    updateDevToolsStatus(summary.text, 'error');
                    return;
                }
                if (entry && Number(entry.matches || 0) === 0) {
                    const proceed = confirm('Selector not found in the active tab. Save override anyway?');
                    if (!proceed) return;
                }
                finalizeSave();
            });
        });
    }

    if (selectorAuditRefreshBtn) {
        selectorAuditRefreshBtn.addEventListener('click', () => refreshSelectorAudit());
    }

    document.addEventListener('llm-selection-change', () => {
        syncModeratorSelectors();
        applyDebateSessionFilter();
        syncProStreamVisibility();
    });
    
    // --- "SELECT ALL" CHECKBOX LOGIC ---
    const notifySelectionChanged = () => {
        try {
            document.dispatchEvent(new CustomEvent('llm-selection-change', { detail: { selected: getSelectedLLMs() } }));
        } catch (_) {}
    };

// Подстраховка: если модификаторы уже загружены до этого места — отрендерим повторно при изменении DOM
    const modifiersRowObserver = new MutationObserver(() => {
        if (typeof document === 'undefined') return;
        const row = document.getElementById('modifiers-row');
        if (row && row.childElementCount === 0 && Object.keys(modifiersById || {}).length) {
            const merged = Object.values(modifiersById).sort((a,b) => (a.order||999)-(b.order||999));
            renderModifiersRow(merged);
        }
    });
    modifiersRowObserver.observe(document.body, { childList: true, subtree: true });
	    const setAllLLMsState = (shouldBeActive) => {
	        llmButtons.forEach(button => {
	            button.classList.toggle('active', shouldBeActive);
	            const llmId = button.id.replace('llm-', '');
	            const panel = document.getElementById(`panel-${llmId}`);
	            if (panel) {
	                panel.style.display = shouldBeActive ? 'block' : 'none';
	            }
	        });
	        checkCompareButtonState();
            renderDiagnosticsModal();
            notifySelectionChanged();
	    };

    const toggleAllLLMs = () => {
        const allActive = Array.from(llmButtons).every(btn => btn.classList.contains('active'));
        setAllLLMsState(!allActive);
    };

    // --- TEMPLATE FUNCTIONALITY ELEMENTS ---
    const templateSelect = document.getElementById('template-select');
    const createTemplateModal = document.getElementById('create-template-modal');
        const closeModal = createTemplateModal.querySelector('.close');
    const cancelTemplateButton = document.getElementById('cancel-template');
    const saveTemplateButton = document.getElementById('save-template');
    const addVariableButton = document.getElementById('add-variable');
    const templateNameInput = document.getElementById('template-name');
    const templatePrompt = document.getElementById('template-prompt');
    const templatePreview = document.getElementById('template-preview');
    const variablesList = document.getElementById('variables-list');
    const savedTemplatesList = document.getElementById('saved-templates-list');
    const systemTemplatesList = document.getElementById('system-templates-list');
    const savedTemplatesBox = document.getElementById('saved-templates-box');
    const savedTemplatesToggle = document.getElementById('saved-templates-toggle');
    const savedTemplatesContent = document.getElementById('saved-templates-content');
    const systemTemplatesBox = document.getElementById('system-templates-box');
    const systemTemplatesToggle = document.getElementById('system-templates-toggle');
    const systemTemplatesContent = document.getElementById('system-templates-content');
    const variableInputsContainer = document.getElementById('variable-inputs');
    const exportBtn = document.getElementById('export-templates-btn');
    const importBtn = document.getElementById('import-templates-btn');
    const importFileInput = document.getElementById('import-file-input');
    const confirmModal = document.getElementById('confirm-modal');
    const confirmMessage = document.getElementById('confirm-message');
    const deleteConfirmBtn = document.getElementById('delete-confirm');
    const cancelConfirmBtn = document.getElementById('cancel-confirm');
    const modelSelector = createTemplateModal.querySelector('.model-selector');
    const notificationModal = document.getElementById('notification-modal');
    const notificationMessage = document.getElementById('notification-message');
    const notificationOkBtn = document.getElementById('notification-ok-btn');
    const fileInput = document.getElementById('file-input');
    const fileNameDisplay = document.getElementById('file-name-display');
    const modalElements = Array.from(document.querySelectorAll('.modal'));
    const collapseStateStorageKey = 'templateCollapseStates';
    let collapseBoxStates = {};
    modalElements.forEach((modal) => {
        if (!modal.getAttribute('aria-hidden')) {
            modal.setAttribute('aria-hidden', 'true');
        }
        if (!modal.style.display) {
            modal.style.display = 'none';
        }
    });
    const loadCollapseStates = () => {
        try {
            const stored = localStorage.getItem(collapseStateStorageKey);
            collapseBoxStates = stored ? JSON.parse(stored) : {};
        } catch {
            collapseBoxStates = {};
        }
    };

    const saveCollapseStates = () => {
        try {
            localStorage.setItem(collapseStateStorageKey, JSON.stringify(collapseBoxStates));
        } catch (err) {
            console.warn('Failed to save collapse state', err);
        }
    };

    loadCollapseStates();

    const modalManager = (() => {
        const isModalVisible = () => Array.from(document.querySelectorAll('.modal')).some(modal => modal.style.display !== 'none');
        const show = (modal) => {
            if (!modal) return;
            modal.style.display = 'flex';
            modal.classList.add('is-visible');
            modal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');
        };
        const hide = (modal) => {
            if (!modal) return;
            modal.style.display = 'none';
            modal.classList.remove('is-visible');
            modal.setAttribute('aria-hidden', 'true');
            if (!isModalVisible()) {
                document.body.classList.remove('modal-open');
            }
        };
        const forceUnlock = () => {
            if (!isModalVisible()) {
                document.body.classList.remove('modal-open');
            }
        };
        return { show, hide, forceUnlock };
    })();
    modalElements.forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modalManager.hide(modal);
            }
        });
    });

    function initializeCollapseBox(box, toggle, content, storageKey, collapsedByDefault = false) {
        if (!box || !toggle || !content) return;
        const storedState = storageKey ? collapseBoxStates[storageKey] : undefined;
        const initialCollapsed = typeof storedState === 'boolean' ? storedState : collapsedByDefault;

        const applyState = (collapsed) => {
            if (collapsed) {
                box.classList.add('collapsed');
                content.style.maxHeight = '0px';
                toggle.setAttribute('aria-expanded', 'false');
            } else {
                box.classList.remove('collapsed');
                content.style.maxHeight = `${content.scrollHeight}px`;
                toggle.setAttribute('aria-expanded', 'true');
            }
        };

        applyState(initialCollapsed);

        toggle.addEventListener('click', () => {
            const collapsed = box.classList.toggle('collapsed');
            toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            if (collapsed) {
                content.style.maxHeight = '0px';
            } else {
                content.style.maxHeight = `${content.scrollHeight}px`;
            }
            if (storageKey) {
                collapseBoxStates[storageKey] = collapsed;
                saveCollapseStates();
            }
        });
    }

    function refreshCollapseContentHeight(box, content) {
        if (!box || !content || box.classList.contains('collapsed')) return;
        content.style.maxHeight = `${content.scrollHeight}px`;
    }

    initializeCollapseBox(savedTemplatesBox, savedTemplatesToggle, savedTemplatesContent, 'savedTemplates', false);
    initializeCollapseBox(systemTemplatesBox, systemTemplatesToggle, systemTemplatesContent, 'systemTemplates', false);

    window.addEventListener('focus', () => modalManager.forceUnlock());
    window.addEventListener('blur', () => setTimeout(() => modalManager.forceUnlock(), 200));
    
    
    // --- STATE VARIABLES ---
    let savedTemplates = {};
    let templateVariables = {};
    let pendingResponses = {};
    let promptManuallyEdited = false;
    let systemTemplates = { templates: {}, variables: {} };
    let attachedFileContent = ''; // Здесь будет храниться текст из файла
    // --- STATUS INDICATOR LOGIC ---
    // New 9-state model mapping. Keep backward compatibility with older keys.
    const statusClassMap = {
        // Primary lifecycle states
        'IDLE': '',                 // not active
        'INITIALIZING': 'initializing',
        'INJECTING': 'generating',
        'PROMPT_READY': 'prompt-ready',
        'READY': 'success',
        'PROMPT_TO_LLM': 'generating',
        'SENDING': 'sending',
        'RECEIVING': 'receiving',

        // Terminal / outcome states
        'SUCCESS': 'success',
        'COMPLETE': 'success',
        'PARTIAL': 'partial',
        'STREAM_TIMEOUT_HIDDEN': 'partial',
        'RECOVERABLE_ERROR': 'error',
        'CRITICAL_ERROR': 'error',
        'NO_SEND': 'error',
        'EXTRACT_FAILED': 'error',
        'STREAM_TIMEOUT': 'error',
        'EXTERNAL_LLM_FAILURE': 'error',
        'USER_ACTION_REQUIRED': 'action-required',
        'UNCERTAIN': 'uncertain',

        // Backwards-compatible aliases (existing code might still emit these)
        'GENERATING': 'generating',
        'COPY_SUCCESS': 'success',
        'ERROR': 'error',
        'CIRCUIT_OPEN': 'error',
        'UNRESPONSIVE': 'error',
        'API_MODE': 'api-mode',
        'API_PENDING': 'api-mode',
        'API_FAILED': 'error'
    };
    function normalizeStatusValue(status) {
        if (window.LLMStatusContract && typeof window.LLMStatusContract.normalizeStatus === 'function') {
            return window.LLMStatusContract.normalizeStatus(status);
        }
        return String(status || '').trim().toUpperCase();
    }

    function getStatusRank(status) {
        if (window.LLMStatusContract && typeof window.LLMStatusContract.getStatusRank === 'function') {
            return window.LLMStatusContract.getStatusRank(status);
        }
        return 0;
    }

    function clearModelStatusMemory(llmName) {
        const normalizedName = (llmName || '').trim();
        if (!normalizedName) return;
        delete statusStateByModel[normalizedName];
        document.querySelectorAll(`.status-indicator[data-llm-name="${normalizedName}"]`).forEach((indicator) => {
            delete indicator.dataset.currentStatus;
            delete indicator.dataset.statusRank;
            delete indicator.dataset.resultPhase;
            delete indicator.dataset.resultLabel;
        });
    }

    function resolveIndicatorTooltip(status, data = {}) {
        // Human-friendly tooltips for the 9-state model; keep fallbacks for legacy keys
        switch (status) {
            case 'IDLE':
                return 'Ready';
            case 'INITIALIZING':
                return 'Search selector';
            case 'READY':
            case 'PROMPT_READY':
                return 'Wait send';
            case 'PROMPT_TO_LLM':
                return 'Prompt --> LLM';
            case 'SENDING':
                return 'Sending';
            case 'RECEIVING':
                return 'Receiving answer';
            case 'SUCCESS':
            case 'COMPLETE':
                return 'Complete';
            case 'PARTIAL':
                return 'Complete (partial answer)';
            case 'STREAM_TIMEOUT_HIDDEN':
                return 'Complete (timeout, answer captured)';
            case 'RECOVERABLE_ERROR':
                return 'Error';
            case 'CRITICAL_ERROR':
                return 'Error';
            case 'NO_SEND':
                return 'Send failed';
            case 'EXTRACT_FAILED':
                return 'Extract failed';
            case 'STREAM_TIMEOUT':
                return 'Stream timeout';
            case 'EXTERNAL_LLM_FAILURE':
                return 'External LLM failure';
            case 'USER_ACTION_REQUIRED':
                return 'User action required';
            case 'UNCERTAIN':
                return 'Uncertain state';
            // legacy/alias fallbacks
            case 'GENERATING':
                return 'Prompt --> LLM';
            case 'INJECTING':
                return 'Injecting';
            case 'COPY_SUCCESS':
                return 'Complete';
            case 'ERROR': {
                return 'Error';
            }
            case 'CIRCUIT_OPEN':
                return 'Error';
            case 'UNRESPONSIVE':
                return 'Error';
            case 'API_MODE':
                return 'Ready';
            case 'API_PENDING':
                return 'Search selector';
            case 'API_FAILED':
                return 'Error';
            default:
                return 'Ready';
        }
    }

    function updateModelStatusUI(llmName, status, data = {}) {
        const normalizedName = (llmName || '').trim();
        const normalizedStatus = normalizeStatusValue(status);
        if (!normalizedName || !normalizedStatus) return;
        const indicators = document.querySelectorAll(`.status-indicator[data-llm-name="${normalizedName}"]`);
        if (!indicators.length) return;
        const incomingRank = getStatusRank(normalizedStatus);
        const previous = statusStateByModel[normalizedName] || {};
        const previousRank = Number(previous.rank || 0);
        const force = data?.force === true || data?.reset === true;
        if (window.LLMStatusContract && typeof window.LLMStatusContract.shouldApplyStatusUpdate === 'function') {
            const decision = window.LLMStatusContract.shouldApplyStatusUpdate(previous.status, normalizedStatus, data || {});
            if (!decision.apply) return;
        } else if (!force && previousRank > 0) {
            if (incomingRank <= 0) return;
            if (incomingRank < previousRank) return;
        }
        statusStateByModel[normalizedName] = {
            status: normalizedStatus,
            rank: incomingRank,
            modelRunState: data?.modelRunState || null,
            resultMeta: window.LLMStatusContract?.deriveResultMeta
                ? window.LLMStatusContract.deriveResultMeta({
                    ...(data || {}),
                    status: normalizedStatus,
                    finalStatus: data?.finalStatus || null,
                    finalStatusRecorded: data?.finalStatusRecorded,
                    modelRunState: data?.modelRunState || null,
                    answer: data?.answer || data?.text || ''
                })
                : null,
            updatedAt: Date.now()
        };

        indicators.forEach((indicator) => {
            const pipelineBlock = indicator.closest('.model-block');
            if (pipelineBlock) {
                const inputCb = pipelineBlock.querySelector('.model-input-checkbox');
                if (!inputCb || !inputCb.checked) {
                    indicator.className = 'status-indicator';
                    indicator.title = '';
                    return;
                }
            }
            indicator.className = 'status-indicator';
            const mappedClass = statusClassMap[normalizedStatus];
            if (mappedClass) {
                indicator.classList.add(mappedClass);
            }
            indicator.setAttribute('role', 'button');
            indicator.tabIndex = 0;
            indicator.dataset.currentStatus = normalizedStatus;
            indicator.dataset.statusRank = String(incomingRank);
            const resultMeta = statusStateByModel[normalizedName]?.resultMeta || null;
            if (resultMeta?.phase) {
                indicator.dataset.resultPhase = resultMeta.phase;
                indicator.classList.add(`result-phase-${resultMeta.phase}`);
            } else {
                delete indicator.dataset.resultPhase;
            }
            const statusTitle = resolveIndicatorTooltip(normalizedStatus, data);
            const resultLabel = resultMeta?.label ? `Result: ${resultMeta.label}` : null;
            const titleParts = [statusTitle, resultLabel].filter(Boolean);
            const fullTitle = `${titleParts.join(' • ')} • Double-click to fetch this model answer`;
            indicator.dataset.statusTitle = statusTitle;
            if (resultMeta?.phase) indicator.dataset.resultLabel = resultMeta.label || resultMeta.phase;
            indicator.title = fullTitle;
            indicator.setAttribute('aria-label', `${normalizedName} status: ${titleParts.join(', ')}. Double-click to fetch this model answer.`);
        });

        if (Object.prototype.hasOwnProperty.call(data, 'apiStatus')) {
            setApiIndicatorState(normalizedName, data.apiStatus, data);
        }
    }

    function syncStatusFromResponseMessage(message = {}) {
        const status = message?.metadata?.status || message?.status || null;
        if (!message?.llmName || !status) return;
        updateModelStatusUI(message.llmName, status, {
            ...(message.metadata || {}),
            source: 'LLM_PARTIAL_RESPONSE'
        });
    }

    function syncStatusFromDiagnosticEntries(llmName, entries = []) {
        if (!llmName || !Array.isArray(entries) || !entries.length) return;
        entries.forEach((entry) => {
            const type = normalizeStatusValue(entry?.type);
            const label = normalizeStatusValue(entry?.label);
            const metaStatus = entry?.meta?.finalStatus || entry?.meta?.status || null;
            if (type === 'FINAL_STATUS' && entry?.label) {
                updateModelStatusUI(llmName, entry.label, { ...(entry.meta || {}), source: 'FINAL_STATUS' });
                return;
            }
            if (label === 'MODEL_FINAL' && metaStatus) {
                updateModelStatusUI(llmName, metaStatus, { ...(entry.meta || {}), source: 'MODEL_FINAL' });
                return;
            }
            if (label.startsWith('STATUS_') && entry?.meta?.status) {
                updateModelStatusUI(llmName, entry.meta.status, { ...(entry.meta || {}), source: 'STATUS_LOG' });
            }
        });
    }

    function syncStatusFromGlobalState(state = {}) {
        const llms = state?.llms && typeof state.llms === 'object' ? state.llms : {};
        Object.entries(llms).forEach(([llmName, entry]) => {
            const modelRunState = entry?.modelRunState && typeof entry.modelRunState === 'object'
                ? entry.modelRunState
                : null;
            const status = modelRunState?.uiStatus || modelRunState?.terminalStatus || entry?.finalStatus || entry?.status || null;
            if (!status) return;
            updateModelStatusUI(llmName, status, {
                ...(entry?.statusData || {}),
                modelRunState,
                finalStatus: entry?.finalStatus || null,
                finalStatusRecorded: !!entry?.finalStatusRecorded,
                terminalState: entry?.terminalState || modelRunState?.terminalState || null,
                executionState: entry?.executionState || modelRunState?.executionState || null,
                answerState: entry?.answerState || modelRunState?.answerState || null,
                hasAnswer: !!entry?.hasAnswer,
                source: 'GLOBAL_STATE_BROADCAST'
            });
        });
    }
    // --- END STATUS INDICATOR LOGIC ---

    // --- TEST / SMOKE HARNESS ---
    // Non-intrusive helper to validate STATUS_UPDATE rendering.
    // Usage:
    //  - From console: runStatusIndicatorSmokeTest();
    //  - Or set window.__LLM_RESULTS_DEBUG__ = true before loading to auto-run once.
    function runStatusIndicatorSmokeTest() {
        try {
            const testName = `__llm_test_${Date.now()}`;
            // create a temp indicator in the DOM (mirrors markup in result_new.html)
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.bottom = '6px';
            container.style.right = '6px';
            container.style.zIndex = '99999';
            container.id = testName;
            const indicator = document.createElement('span');
            indicator.className = 'status-indicator';
            indicator.dataset.llmName = testName;
            const label = document.createElement('span');
            label.style.marginLeft = '8px';
            label.style.fontSize = '12px';
            label.textContent = 'Smoke test';
            container.appendChild(indicator);
            container.appendChild(label);
            document.body.appendChild(container);

            const statusesToTest = [
                'IDLE', 'INITIALIZING', 'SENDING', 'RECEIVING', 'SUCCESS',
                'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'RECOVERABLE_ERROR', 'CRITICAL_ERROR', 'GENERATING', 'ERROR', 'no-answer'
            ];

            const results = [];
            statusesToTest.forEach((s) => {
                updateModelStatusUI(testName, s, { message: `msg for ${s}` });
                const el = document.querySelector(`.status-indicator[data-llm-name="${testName}"]`);
                const cls = el ? el.className : '(missing)';
                const title = el ? el.title : '(missing)';
                const pass = el && title && title.length > 0;
                results.push({ status: s, class: cls, title, pass });
            });

            console.group('[RESULTS] STATUS_INDICATOR SMOKE TEST');
            results.forEach(r => console.log(r));
            console.groupEnd();

            // cleanup after short delay to allow manual inspection
            setTimeout(() => {
                try { document.getElementById(testName)?.remove(); } catch (_) {}
            }, 3000);

            return results;
        } catch (err) {
            console.error('[RESULTS] Smoke test failed:', err);
            return null;
        }
    }

    // Auto-run once if explicitly opted-in (debug only)
    try {
        if (window.__LLM_RESULTS_DEBUG__ === true) {
            console.log('[RESULTS] Auto-running status indicator smoke test (debug flag set)');
            setTimeout(runStatusIndicatorSmokeTest, 600);
        }
    } catch (_) {}
    // --- END TEST / SMOKE HARNESS ---

    promptInput.addEventListener('input', () => {
        if (templateSelect.value !== 'manual') {
            promptManuallyEdited = true;
        }
        persistCrossViewUiState();
    });

    // --- MAIN PAGE LOGIC ---
    chrome.runtime.sendMessage({ type: 'REGISTER_RESULTS_TAB' });

    if (autoCheckbox) {
        autoCheckbox.addEventListener('change', () => {
            autoMode = autoCheckbox.checked;
            if (debateRunPolicySelect) {
                debateRunPolicySelect.value = autoMode ? 'auto' : 'manual';
            }
            if (autoMode) {
                approvePendingDebateCandidate();
                    if (typeof debateApprovalBridge.resolve === 'function') {
                        debateApprovalBridge.resolve();
                }
            }
            syncDebateAutoPauseButton();
            if (syncAutoToggleState) syncAutoToggleState();
            console.log('[RESULTS] Auto mode:', autoMode);
        });
    }

    if (getItButton) {
        getItButton.disabled = true;
    }

    if (startButton) {
        startButton.disabled = false;
    }

        //-- 1.1. Скрываем секцию Comparative Analysis при инициализации --//
    if (comparisonSection) {
        comparisonSection.classList.add('hidden');
        comparisonSection.setAttribute('aria-hidden', 'true');
    }
    if (comparisonOutput) {
        clearNode(comparisonOutput);
    }


    function storeResponseForManualMode(llmName, answer, html = '') {
        if (answer && typeof answer === 'object') {
            pendingResponses[llmName] = answer;
            return;
        }
        pendingResponses[llmName] = {
            text: String(answer ?? ''),
            html: String(html || '')
        };
        console.log(`[RESULTS] Stored response from ${llmName} (manual mode)`);
    }

    // NEW: Функция для конвертации текста с markdown в HTML
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeLineEndings(text) {
        return (text || '').replace(/\r\n/g, '\n');
    }

    function removeExactBlock(source, block) {
        if (!source || !block) return source;
        const normalizedBlock = normalizeLineEndings(block).trim();
        if (!normalizedBlock) return source;
        if (source.startsWith(normalizedBlock)) {
            return source.slice(normalizedBlock.length).trim();
        }
        return source.replace(normalizedBlock, '').trim();
    }

    function sanitizeFinalAnswer(answer) {
        if (!answer) return '';

        let working = normalizeLineEndings(answer).trim();
        if (!working) return '';

        if (lastEvaluationPromptNormalized) {
            const promptBody = normalizeLineEndings(lastEvaluationPromptNormalized).trim();
            if (promptBody) {
                if (working.startsWith(promptBody)) {
                    working = working.slice(promptBody.length).trim();
                } else {
                    const promptIndex = working.indexOf(promptBody);
                    if (promptIndex !== -1) {
                        working = (working.slice(0, promptIndex) + working.slice(promptIndex + promptBody.length)).trim();
                    }
                }
            }
        }

        if (lastResponsesListNormalized) {
            const responsesBody = normalizeLineEndings(lastResponsesListNormalized).trim();
            if (responsesBody) {
                working = working.split(responsesBody).join(' ').trim();
            }
        }

        if (lastEvaluationPrefixNormalized) {
            working = removeExactBlock(working, lastEvaluationPrefixNormalized);
        }
        if (lastEvaluationSuffixNormalized) {
            working = removeExactBlock(working, lastEvaluationSuffixNormalized);
        }

        const instructionSnippets = [
            'Compare the following responses to the question',
            'Responses for analysis:',
            'Select the best response, briefly explain why, and present the result as a detailed, structured bulleted list. The evaluation must be comprehensive, considering relevance, detail, usefulness, and accuracy.',
            'can make mistakes. Please double-check responses.'
        ];

        instructionSnippets.forEach((snippet) => {
            const normalizedSnippet = normalizeLineEndings(snippet).trim();
            if (!normalizedSnippet) return;
            const regex = new RegExp(escapeRegExp(normalizedSnippet), 'gi');
            working = working.replace(regex, ' ').trim();
        });

        const separator = '-------------------------';
        const lastSeparatorIndex = working.lastIndexOf(separator);
        if (lastSeparatorIndex !== -1) {
            const afterSeparator = working.slice(lastSeparatorIndex + separator.length).trim();
            if (afterSeparator) {
                working = afterSeparator;
            } else {
                working = working.slice(0, lastSeparatorIndex).trim();
            }
        }

        working = working.replace(/[ \t]{2,}/g, ' ');
        working = working.replace(/\n{3,}/g, '\n\n').trim();

        return working;
    }

    function convertMarkdownToHTML(text) {
        if (!text) return '';
        
        // Сохраняем HTML теги, если они есть
        let html = text;
        
        // Конвертация markdown форматирования
        // Жирный текст **текст** или __текст__
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        
        // Курсив *текст* или _текст_
        html = html.replace(/\*(.+?)\*(?!\*)/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_(?!_)/g, '<em>$1</em>');
        
        // Заголовки
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // Списки (маркированные)
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        
        // Списки (нумерованные)
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        
        // Обернуть последовательные <li> в <ul>
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
            return '<ul>' + match + '</ul>';
        });
        
        // Код инлайн `код`
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        
        // Блоки кода ```код```
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // Переносы строк
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        
        // Обернуть в параграфы, если еще не обернуто
        if (!html.startsWith('<')) {
            html = '<p>' + html + '</p>';
        }
        
        return html;
    }

    // Listen for messages from the background script
    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            switch (message.type) {
                case 'LLM_JOB_CREATED':
                    clearModelStatusMemory(message.llmName);
                    updateModelStatusUI(message.llmName, 'INITIALIZING', { reset: true, force: true });
                    mergeLLMMetadata(message.llmName, {
                        requestId: message.requestId || null,
                        url: message.metadata?.url || '',
                        createdAt: message.metadata?.createdAt || message.metadata?.timestamp || Date.now(),
                        completedAt: message.metadata?.completedAt || null
                    }, { reset: true });
                    break;
                case 'LLM_PARTIAL_RESPONSE': {
                    syncStatusFromResponseMessage(message);
                    const previewPayload = (() => {
                        if (message.answer && typeof message.answer === 'object') {
                            return {
                                text: String(message.answer.text || message.answer.answer || ''),
                                html: String(message.answer.html || message.answer.answerHtml || message.answerHtml || message.html || '')
                            };
                        }
                        return {
                            text: String(message.answer || ''),
                            html: String(message.answerHtml || message.html || '')
                        };
                    })();
                    updateDebateModelCardOutput(message.llmName, previewPayload.text, previewPayload.html, message.metadata || {});
                    const revealManualPing = manualPingReveal.has(message.llmName);
                    if (revealManualPing) {
                        const answerText = (() => {
                            if (message.answer && typeof message.answer === 'object') {
                                return String(message.answer.text || message.answer.answer || '');
                            }
                            return String(message.answer || '');
                        })();
                        const htmlText = String(message.answerHtml || message.html || '');
                        ingestLogs(message.llmName, [makeLocalDiagEntry(
                            'Manual ping: response payload received',
                            `textLen=${answerText.trim().length} htmlLen=${htmlText.length}`,
                            answerText.trim().length ? 'success' : 'warning'
                        )]);
                    }
                    if (autoMode || revealManualPing) {
                        updateLLMPanelOutput(message.llmName, message.answer, message.answerHtml || message.html || '', message.metadata || {});
                        if (revealManualPing) {
                            manualPingReveal.delete(message.llmName);
                        }
                    } else {
                        storeResponseForManualMode(message.llmName, message.answer, message.answerHtml || message.html || '');
                    }
                    if (isTerminalPipelineMessage(message)) {
                        pipelineWaiter.handleFinal(message);
                    } else {
                        pipelineWaiter.handlePartial(message);
                    }
                    if (message.metadata || message.requestId) {
                        mergeLLMMetadata(message.llmName, {
                            requestId: message.requestId,
                            url: message.metadata?.url,
                            createdAt: message.metadata?.createdAt || message.metadata?.timestamp,
                            completedAt: message.metadata?.completedAt
                        });
                    }
                    if (Array.isArray(message.logs)) {
                        ingestLogs(message.llmName, message.logs);
                        syncStatusFromDiagnosticEntries(message.llmName, message.logs);
                    }
                    break;
                }
                case 'LLM_FINAL_RESPONSE':
                case 'FINAL_LLM_RESPONSE': {
                    pipelineWaiter.handleFinal(message);
                    break;
                }
                // --- V2.0 START: Status Update Handler ---
                case 'STATUS_UPDATE':
                    updateModelStatusUI(message.llmName, message.status, message.data || {});
                    if (Array.isArray(message.logs)) {
                        ingestLogs(message.llmName, message.logs);
                        syncStatusFromDiagnosticEntries(message.llmName, message.logs);
                    }
                    break;
                // --- V2.0 END: Status Update Handler ---
                case 'PROCESS_COMPLETE':
                    if (comparisonSpinner) comparisonSpinner.style.display = 'none';
                    const cleanedAnswer = sanitizeFinalAnswer(message.finalAnswer || '');
                    pendingJudgeAnswer = cleanedAnswer;
                    pendingJudgeHTML = cleanedAnswer
                        ? convertMarkdownToHTML(cleanedAnswer)
                        : '<p class="comparison-placeholder">No evaluation response received.</p>';
                    if (comparisonOutput) {
                        replaceChildrenFromSanitizedHtml(comparisonOutput, pendingJudgeHTML);
                        decorateLinksForNewTab(comparisonOutput);
                    }
                    lastEvaluationPromptNormalized = '';
                    lastEvaluationPrefixNormalized = '';
                    lastEvaluationSuffixNormalized = '';
                    lastResponsesListNormalized = '';
                    break;
                case 'STARTING_EVALUATION':
                    if (comparisonSpinner) comparisonSpinner.style.display = 'block';
                    if (comparisonOutput) {
                        replaceChildrenFromHtml(
                            comparisonOutput,
                            '<p class="comparison-placeholder">Collecting responses for evaluation...</p>'
                        );
                    }
                    break;
                case 'UPDATE_LLM_PANEL_OUTPUT':
                    updateLLMPanelOutput(message.llmName, message.answer, message.answerHtml || message.html || '', message.metadata || {});
                    break;
                case 'LLM_DIAGNOSTIC_EVENT':
                    if (Array.isArray(message.logs) && message.logs.length) {
                        ingestLogs(message.llmName, message.logs);
                        syncStatusFromDiagnosticEntries(message.llmName, message.logs);
                    } else if (message.event) {
                        ingestLogs(message.llmName, [message.event]);
                        syncStatusFromDiagnosticEntries(message.llmName, [message.event]);
                    }
                    if (typeof CustomEvent !== 'undefined') {
                        const detailEvents = Array.isArray(message.logs)
                            ? message.logs
                            : (message.event ? [message.event] : []);
                        if (detailEvents.length) {
                            document.dispatchEvent(new CustomEvent('telemetry-event', { detail: { events: detailEvents } }));
                        }
                    }
                    break;
                case 'GLOBAL_STATE_BROADCAST':
                    syncStatusFromGlobalState(message.state || {});
                    break;
                case 'SMART_FOCUS_METRIC':
                    handleSmartFocusMetric(message);
                    break;
                case 'SMART_CLEANUP_EVENT':
                    handleSmartCleanupEvent(message);
                    break;
                case 'SMART_SCRIPT_READY_ACK':
                    handleSmartScriptReadyAck(message);
                    break;
                case 'SMART_DISPATCH_SEND':
                    handleSmartDispatchSend(message);
                    break;
                case 'SMART_ATTACHMENT_CONFIRMED':
                    handleSmartAttachmentConfirmed(message);
                    break;
                case 'ATTACHMENT_MANUAL_REQUIRED': {
                    const llmName = message.llmName || 'LLM';
                    const note = message.message || `${llmName}: failed to attach files automatically. Please attach manually.`;
                    showNotification(note);
                    break;
                }
                case 'MANUAL_PING_RESULT': {
                    const llmName = message.llmName;
                    if (message.status === 'success') {
                        setPingButtonState(llmName, 'success', 'Answer updated');
                    } else if (message.status === 'failed') {
                        setPingButtonState(llmName, 'error', message.error || 'Ping error');
                        if (llmName) manualPingReveal.delete(llmName);
                    } else if (message.status === 'unchanged') {
                        setPingButtonState(llmName, 'unchanged', 'Answer unchanged');
                        if (llmName) manualPingReveal.delete(llmName);
                    } else if (message.status === 'aborted') {
                        setPingButtonState(llmName, 'error', 'Ping aborted');
                        if (llmName) manualPingReveal.delete(llmName);
                    } else if (message.status === 'ignored_terminal') {
                        setPingButtonState(llmName, 'unchanged', 'Already finalized');
                        if (llmName) manualPingReveal.delete(llmName);
                    }
                    break;
                }
                case 'SELECTOR_OVERRIDE_CLEARED':
                    if (message.success === false) {
                        updateDevToolsStatus(`Clear failed: ${message.error || 'unknown error'}`, 'error');
                    } else {
                        updateDevToolsStatus('Overrides & caches cleared', 'success');
                    }
                    refreshSavedOverridesList();
                    refreshSelectorAudit();
                    break;
                case 'SELECTOR_OVERRIDE_REFRESH_RESULT':
                    if (message.result?.success) {
                        updateDevToolsStatus('Remote selectors refreshed', 'success');
                    } else {
                        updateDevToolsStatus(`Refresh failed: ${message.result?.error || 'unknown error'}`, 'error');
                    }
                    refreshSavedOverridesList();
                    refreshSelectorAudit();
                    break;
                case 'PICKER_RESULT': {
                    if (!message.requestId || message.requestId !== activePickerRequestId) break;
                    activePickerRequestId = null;
                    const pickedEntry = activePickerEntry;
                    const pickedMode = activePickerMode;
                    activePickerEntry = null;
                    activePickerMode = null;
                    if (pickedEntry?.pickBtn) pickedEntry.pickBtn.disabled = false;
                    if (pickedEntry?.recordBtn) pickedEntry.recordBtn.disabled = false;
                    if (selectorPickBtn) selectorPickBtn.disabled = false;
                    if (pickerTimeoutId) {
                        clearTimeout(pickerTimeoutId);
                        pickerTimeoutId = null;
                    }
                    const payload = message.payload || {};
                    if (payload.ok === false) {
                        if (pickedEntry) {
                            if (pickedEntry.recordBtn) pickedEntry.recordBtn.classList.remove('is-active');
                            showSelectorsWorkbenchStatus(payload.error || 'Pick failed');
                        } else {
                            updateDevToolsStatus(payload.error || 'Selection failed', 'error');
                        }
                        break;
                    }
                    if (pickedEntry && payload.selector) {
                        if (pickedEntry.recordBtn) pickedEntry.recordBtn.classList.remove('is-active');
                        updateWorkbenchSelectorInput(pickedEntry, payload.selector);
                        testWorkbenchSelectorEntry(pickedEntry);
                        showSelectorsWorkbenchStatus(pickedMode === 'workbench-record' ? 'Recorded' : 'Picked');
                    } else if (selectorOverrideInput && payload.selector) {
                        selectorOverrideInput.value = payload.selector;
                        updateDevToolsStatus('Selector saved to field', 'success');
                    } else {
                        if (pickedEntry) {
                            if (pickedEntry.recordBtn) pickedEntry.recordBtn.classList.remove('is-active');
                            showSelectorsWorkbenchStatus('Selector not found');
                        } else {
                            updateDevToolsStatus('Selector not found', 'error');
                        }
                    }
                    break;
                }
                case 'PICKER_CANCELLED':
                    if (message.requestId && message.requestId !== activePickerRequestId) break;
                    const cancelledMode = activePickerMode;
                    activePickerRequestId = null;
                    if (activePickerEntry?.pickBtn) activePickerEntry.pickBtn.disabled = false;
                    if (activePickerEntry?.recordBtn) {
                        activePickerEntry.recordBtn.disabled = false;
                        activePickerEntry.recordBtn.classList.remove('is-active');
                    }
                    activePickerEntry = null;
                    activePickerMode = null;
                    if (selectorPickBtn) selectorPickBtn.disabled = false;
                    if (pickerTimeoutId) {
                        clearTimeout(pickerTimeoutId);
                        pickerTimeoutId = null;
                    }
                    if (cancelledMode === 'override') {
                        updateDevToolsStatus('Selection cancelled', 'warning');
                    } else if (selectorsWorkbenchStatus) {
                        showSelectorsWorkbenchStatus(cancelledMode === 'workbench-record' ? 'Record cancelled' : 'Pick cancelled');
                    } else {
                        updateDevToolsStatus('Selection cancelled', 'warning');
                    }
                    break;
            }
            try { sendResponse?.({ ok: true }); } catch (_) {}
        } catch (err) {
            console.error('[RESULTS] onMessage handler failed:', err);
            try { sendResponse?.({ ok: false, error: err?.message || String(err) }); } catch (_) {}
        }
    });
        
    function updateLLMPanelOutput(llmName, answer, answerHtml = '', meta = {}) {
        const panelId = llmName.toLowerCase().replace(/\s+/g, '');
        const panel = document.getElementById(`panel-${panelId}`);
        const payload = (() => {
            if (answer && typeof answer === 'object') {
                return {
                    text: String(answer.text || answer.answer || ''),
                    html: String(answer.html || answer.answerHtml || '')
                };
            }
            return {
                text: String(answer ?? ''),
                html: String(answerHtml || '')
            };
        })();
        const normalizedText = payload.text || '';
        const rawHtml = payload.html || '';
        const sanitizedHtml = sanitizeInlineHtml(rawHtml);
        const resolvedHtml = sanitizedHtml || (looksLikeHtml(normalizedText) ? sanitizeInlineHtml(normalizedText) : '');
        updateDebateModelCardOutput(llmName, normalizedText, resolvedHtml, meta);
        if (panel) {
            const outputElement = panel.querySelector('.output');
            if (outputElement) {
                const finalHtml = resolvedHtml || convertMarkdownToHTML(normalizedText);
                const nextHash = String(finalHtml || '').length ? String(finalHtml).length + ':' + String(finalHtml).slice(0, 64) : '';
                const prevHash = outputElement.dataset.hash || '';
                if (nextHash !== prevHash) {
                    replaceChildrenFromSanitizedHtml(outputElement, finalHtml);
                    decorateLinksForNewTab(outputElement);
                    outputElement.dataset.hash = nextHash;
                }
                outputElement.style.maxHeight = '315px';
                outputElement.style.overflowY = 'auto';
                outputElement.style.overflowX = 'hidden';
                outputElement.style.wordWrap = 'break-word';
                ingestLogs(llmName, [makeLocalDiagEntry(
                    'Panel output updated',
                    `textLen=${normalizedText.trim().length} htmlLen=${String(finalHtml || '').length} panel=${panel.id || '(no-id)'}`,
                    normalizedText.trim().length || String(finalHtml || '').length ? 'success' : 'warning',
                    'UI'
                )]);
                const hasVisibleAnswer = Boolean(normalizedText.trim().length || String(finalHtml || '').trim().length);
                if (hasVisibleAnswer && !normalizedText.trim().startsWith('Error:')) {
                    const currentStatus = statusStateByModel[llmName]?.status || '';
                    const isCurrentSuccess = window.LLMStatusContract?.isSuccessStatus
                        ? window.LLMStatusContract.isSuccessStatus(currentStatus)
                        : ['SUCCESS', 'COMPLETE', 'COPY_SUCCESS', 'DONE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(normalizeStatusValue(currentStatus));
                    if (!isCurrentSuccess) {
                        updateModelStatusUI(llmName, 'PARTIAL', {
                            source: 'PANEL_OUTPUT_HAS_ANSWER',
                            hasAnswer: true
                        });
                    }
                }
            }
        } else {
            ingestLogs(llmName, [makeLocalDiagEntry(
                'Panel output update failed',
                `panel not found: panel-${panelId}`,
                'error',
                'UI'
            )]);
        }
        if (normalizedText && !normalizedText.trim().startsWith('Error:')) {
            autoCollapseDiagnostics(llmName, normalizedText);
        }
        checkCompareButtonState();
    }

    //-- 2. Добавляем обработчик для кнопки "Copy All" --//
function collectLLMResponses() {
    const panels = document.querySelectorAll('.llm-panel');
    const entries = [];
    const htmlSections = [];
    panels.forEach(panel => {
        if (panel.id === favoritePanelId || panel.classList.contains('favorite-panel')) {
            return;
        }
        const titleEl = panel.querySelector('.llm-title') || panel.querySelector('h3');
        const outputEl = panel.querySelector('.output');
        const name = titleEl ? titleEl.textContent.trim() : panel.id.replace('panel-', '').toUpperCase();
        const htmlContent = outputEl ? sanitizeInlineHtml(outputEl.innerHTML || '').trim() : '';
        const text = htmlContent
            ? plainTextFromHtml(htmlContent)
            : (outputEl ? (outputEl.innerText || outputEl.textContent || '').trim() : '');
        const isErrorResponse = typeof text === 'string' && text.startsWith('Error:');
        if (isErrorResponse) {
            return;
        }
        const hasContent = htmlContent || text;
        if (hasContent) {
            const metadataLine = buildMetadataLine(name);
            const headerParts = [`=== ${name} ===`];
            if (metadataLine) {
                headerParts.push(metadataLine);
            }
            const htmlBlock = buildResponseCopyHtmlBlock(name, metadataLine, htmlContent, text);
            if (htmlBlock) {
                htmlSections.push(htmlBlock);
            }
            entries.push({
                name,
                text,
                html: htmlContent,
                metadataLine,
                formatted: `${headerParts.join('\n')}\n${text}`
            });
        }
    });
    const combinedText = entries.map(entry => entry.formatted).join('\n\n').trim();
    const combinedHTML = wrapResponsesHtmlBundle(htmlSections.join('\n'));
    return { entries, combinedText, combinedHTML };
}

function buildFavoriteExportHtml() {
    const sections = buildFavoriteExportSectionsHtml();
    if (!sections) return '';
    return wrapResponsesHtmlBundle(sections);
}

function buildFavoriteExportSectionsHtml() {
    const groups = buildFavoriteGroups();
    if (!groups.length) return '';

    const sections = groups.map((group) => {
        const groupName = String(group.sourceName || 'Model').trim() || 'Model';
        const groupItems = group.items.map((entry) => {
            const itemHtml = entry.html ? sanitizeInlineHtml(entry.html) : '';
            const fallbackText = String(entry.text || '').trim();
            const bodyHtml = itemHtml || (fallbackText ? `<p>${escapeHtml(fallbackText).replace(/\n/g, '<br>')}</p>` : '');
            if (!bodyHtml) return '';
            const timeMeta = entry.timeLabel ? `<p class="response-meta">${escapeHtml(entry.timeLabel)}</p>` : '';
            return `
                <section class="favorite-export-item">
                    ${timeMeta}
                    <div class="response-body">${bodyHtml}</div>
                </section>
            `;
        }).filter(Boolean).join('\n');

        if (!groupItems) return '';
        const groupBody = `<div class="favorite-export-items">${groupItems}</div>`;
        const groupHtml = buildResponseCopyHtmlBlock(groupName, null, groupBody, '');
        if (groupHtml) return groupHtml;
        return `
            <section>
                <h2>${escapeHtml(groupName)}</h2>
                ${groupBody}
            </section>
        `;
    }).filter(Boolean).join('\n');

    return sections;
}

function ensureFavoritePanelUI() {
    if (favoritePanelEl && favoriteOutputEl && favoriteSectionEl) return favoritePanelEl;
    if (!llmResultsContainer) return null;
    const parent = llmResultsContainer.parentElement || llmResultsContainer;
    if (!parent) return null;

    let section = document.getElementById(favoriteSectionId);
    if (!section) {
        section = document.createElement('div');
        section.id = favoriteSectionId;
        section.className = 'favorites-section hidden';
        section.innerHTML = `
            <div class="llm-panel favorite-panel" id="${favoritePanelId}">
                <div class="llm-header favorite-panel-header">
                    <span class="llm-title favorite-panel-title">Favourite</span>
                    <div class="header-right favorite-panel-actions">
                        <button class="copy-btn favorite-copy-btn" data-target="${favoriteOutputId}" title="Copy favorites" aria-label="Copy favorites"><i class="ti ti-copy" aria-hidden="true"></i></button>
                        <button class="panel-action-btn panel-export-html-btn favorite-export-btn" data-target="${favoriteOutputId}" data-name="Favourite" data-label="⬆" title="Export favorites as HTML" aria-label="Export favorites as HTML"><i class="ti ti-download" aria-hidden="true"></i></button>
                        <button class="panel-action-btn panel-clear-response-btn favorite-clear-btn" data-target="${favoriteOutputId}" title="Clear favorites" aria-label="Clear favorites"><i class="ti ti-trash" aria-hidden="true"></i></button>
                    </div>
                </div>
                <div class="output favorite-output" id="${favoriteOutputId}" aria-label="Favourite feed"></div>
            </div>
        `;
        parent.insertBefore(section, llmResultsContainer);
    }

    favoriteSectionEl = section;
    favoritePanelEl = section.querySelector(`#${favoritePanelId}`);
    favoriteOutputEl = section.querySelector(`#${favoriteOutputId}`);
    const titleEl = section.querySelector('.favorite-panel-title');
    titleEl?.addEventListener('dblclick', () => {
        if (!favoritePanelEl) return;
        favoritePanelEl.classList.toggle('llm-panel-expanded');
        scrollFavoritePanelToBottom({ smooth: true });
    });
    const hasFavoriteEntries = Boolean(favoriteState.entries.length);
    section.classList.toggle('hidden', !hasFavoriteEntries);
    section.hidden = !hasFavoriteEntries;
    section.style.display = hasFavoriteEntries ? 'block' : 'none';
    if (hasFavoriteEntries) {
        scrollFavoritePanelToBottom({ smooth: false });
    }
    return favoritePanelEl;
}

function scrollFavoritePanelToBottom({ smooth = false } = {}) {
    if (!favoriteOutputEl) return;
    const scroller = favoriteOutputEl;
    const run = () => {
        try {
            if (typeof scroller.scrollTo === 'function') {
                scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
            } else {
                scroller.scrollTop = scroller.scrollHeight;
            }
        } catch (_) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
}

function favoriteEntryKeyForCard(outputId) {
    return `card:${String(outputId || '').trim()}`;
}

function favoriteModelKeyForName(sourceName = 'Model') {
    return String(sourceName || 'Model').trim().toLowerCase().replace(/\s+/g, ' ') || 'model';
}

function favoriteGroupKeyForEntry(entry) {
    if (!entry) return '';
    const modelKey = String(entry.modelKey || '').trim() || favoriteModelKeyForName(entry.sourceName || 'Model');
    if (modelKey) return `model:${modelKey}`;
    return '';
}

function buildFavoriteGroups() {
    const groups = [];
    const groupByKey = new Map();
    favoriteState.entries.forEach((entry) => {
        const groupKey = favoriteGroupKeyForEntry(entry);
        if (!groupKey) return;
        let group = groupByKey.get(groupKey);
        if (!group) {
            group = {
                key: groupKey,
                modelKey: String(entry.modelKey || '').trim() || favoriteModelKeyForName(entry.sourceName || 'Model'),
                sourceName: entry.sourceName || 'Model',
                items: []
            };
            groupByKey.set(groupKey, group);
            groups.push(group);
        }
        group.items.push(entry);
    });
    return groups;
}

function syncFavoriteButtonState(outputId, isActive) {
    if (!outputId) return;
    const safeId = String(outputId).replace(/"/g, '\\"');
    const btn = document.querySelector(`.panel-fav-btn[data-target="${safeId}"]`);
    if (!btn) return;
    btn.classList.toggle('active', !!isActive);
    btn.setAttribute('aria-pressed', String(!!isActive));
    btn.title = isActive ? 'Remove from favorites' : 'Add to favorites';
}

function syncAllFavoriteButtonStates() {
    document.querySelectorAll('.panel-fav-btn').forEach((btn) => {
        const outputId = String(btn.dataset.target || '').trim();
        if (!outputId) return;
        const key = favoriteEntryKeyForCard(outputId);
        const entryId = favoriteState.cardKeyToId.get(key);
        const isActive = Boolean(entryId);
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
        btn.title = isActive ? 'Remove from favorites' : 'Add to favorites';
    });
}

function removeFavoriteEntryById(entryId) {
    const index = favoriteState.entries.findIndex((entry) => entry.id === entryId);
    if (index === -1) return false;
    const [entry] = favoriteState.entries.splice(index, 1);
    if (entry?.kind === 'card' && entry.sourceOutputId) {
        favoriteState.cardKeyToId.delete(favoriteEntryKeyForCard(entry.sourceOutputId));
        syncFavoriteButtonState(entry.sourceOutputId, false);
    }
    renderFavoritePanel();
    return true;
}

function clearFavorites() {
    favoriteState.entries = [];
    favoriteState.cardKeyToId.clear();
    renderFavoritePanel();
    syncAllFavoriteButtonStates();
    persistFavoriteEntries();
}

function renderFavoritePanel() {
    if (!favoriteOutputEl || !favoriteSectionEl || !favoritePanelEl) return;
    if (!favoriteState.entries.length) {
        clearNode(favoriteOutputEl);
        favoriteSectionEl.classList.add('hidden');
        favoriteSectionEl.hidden = true;
        favoriteSectionEl.style.display = 'none';
        favoritePanelEl.classList.remove('llm-panel-expanded');
        return;
    }
    const html = buildFavoriteGroups().map((group) => {
        const sourceName = escapeHtml(group.sourceName || 'Model');
        const itemsHtml = group.items.map((entry) => {
            const contentHtml = entry.html ? sanitizeInlineHtml(entry.html) : escapeHtml(entry.text || '');
            return `
                <div class="favorite-item" data-favorite-id="${escapeHtml(entry.id)}" data-favorite-kind="${escapeHtml(entry.kind)}">
                    <div class="favorite-item-body" data-favorite-id="${escapeHtml(entry.id)}" contenteditable="true" spellcheck="true">${contentHtml}</div>
                    <button type="button" class="favorite-item-remove" data-remove-favorite-id="${escapeHtml(entry.id)}" aria-label="Remove favorite" title="Remove favorite">×</button>
                </div>
            `;
        }).join('');
        return `
            <article class="favorite-entry" data-favorite-group="${escapeHtml(group.key)}">
                <div class="favorite-entry-head">
                    <span class="favorite-entry-source">${sourceName}</span>
                </div>
                <div class="favorite-entry-body">
                    <div class="favorite-item-list">
                        ${itemsHtml}
                    </div>
                </div>
            </article>
        `;
    }).join('');
    favoriteOutputEl.innerHTML = html;
    decorateLinksForNewTab(favoriteOutputEl);
    favoriteSectionEl.classList.remove('hidden');
    favoriteSectionEl.hidden = false;
    favoriteSectionEl.style.display = 'block';
    favoriteOutputEl.querySelectorAll('.favorite-item-body[contenteditable="true"]').forEach((bodyEl) => {
        bodyEl.setAttribute('contenteditable', 'true');
        bodyEl.setAttribute('spellcheck', 'true');
    });
    syncAllFavoriteButtonStates();
}

function syncFavoriteEntryFromBody(bodyEl) {
    if (!bodyEl) return;
    const entryId = String(bodyEl.dataset?.favoriteId || '').trim();
    if (!entryId) return;
    const entry = favoriteState.entries.find((item) => item.id === entryId);
    if (!entry) return;
    const html = sanitizeInlineHtml(String(bodyEl.innerHTML || '').trim());
    entry.html = html;
    entry.text = plainTextFromHtml(html);
}

function addFavoriteEntry({ sourceName = 'Model', modelKey = '', sourceOutputId = '', text = '', html = '', kind = 'card', timeLabel = '' } = {}) {
    const normalizedText = String(text || '').trim();
    const normalizedHtml = sanitizeInlineHtml(String(html || '').trim());
    if (!normalizedText && !normalizedHtml) return null;
    ensureFavoritePanelUI();
    const isCard = kind === 'card';
    const resolvedSourceName = String(sourceName || 'Model').trim() || 'Model';
    const resolvedModelKey = String(modelKey || '').trim() || favoriteModelKeyForName(resolvedSourceName);
    const entry = {
        id: `fav-${favoriteState.nextId++}`,
        kind: isCard ? 'card' : 'fragment',
        sourceName: resolvedSourceName,
        modelKey: resolvedModelKey,
        sourceOutputId: String(sourceOutputId || '').trim(),
        text: normalizedText,
        html: normalizedHtml,
        timeLabel: timeLabel || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    favoriteState.entries.push(entry);
    if (isCard && entry.sourceOutputId) {
        favoriteState.cardKeyToId.set(favoriteEntryKeyForCard(entry.sourceOutputId), entry.id);
    }
    renderFavoritePanel();
    if (favoriteSectionEl) {
        favoriteSectionEl.classList.remove('hidden');
        favoriteSectionEl.hidden = false;
        favoriteSectionEl.style.display = 'block';
    }
    scrollFavoritePanelToBottom({ smooth: false });
    return entry;
}

function toggleFavoriteForOutput(outputEl) {
    if (!outputEl) return false;
    const outputId = String(outputEl.id || '').trim();
    if (!outputId) return false;
    ensureFavoritePanelUI();
    const panel = outputEl.closest('.llm-panel');
    const sourceTitle = panel?.querySelector('.llm-title');
    const sourceName = sourceTitle ? sourceTitle.textContent.trim() : (panel?.id || 'Model').replace(/^panel-/, '');
    const modelKey = favoriteModelKeyForName(sourceName);
    const key = favoriteEntryKeyForCard(outputId);
    const existingId = favoriteState.cardKeyToId.get(key);
    if (existingId) {
        removeFavoriteEntryById(existingId);
        syncFavoriteButtonState(outputId, false);
        return false;
    }
    const text = String(outputEl.innerText || outputEl.textContent || '').trim();
    const html = String(outputEl.innerHTML || '').trim();
    const entry = addFavoriteEntry({
        sourceName,
        modelKey,
        sourceOutputId: outputId,
        text,
        html,
        kind: 'card'
    });
    if (entry) {
        syncFavoriteButtonState(outputId, true);
    }
    return !!entry;
}

function addFavoriteFragmentFromSelection({ sourceCard, text, html }) {
    const normalizedText = String(text || '').trim();
    const normalizedHtml = sanitizeInlineHtml(String(html || '').trim());
    if (!normalizedText && !normalizedHtml) return false;
    const sourceOutputEl = sourceCard?.querySelector?.('.output') || null;
    const sourceName = sourceCard?.querySelector?.('.llm-title')?.textContent?.trim()
        || sourceCard?.dataset?.llmName
        || 'Fragment';
    const modelKey = favoriteModelKeyForName(sourceName);
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    addFavoriteEntry({
        sourceName,
        modelKey,
        sourceOutputId: sourceOutputEl?.id || '',
        text: normalizedText,
        html: normalizedHtml,
        kind: 'fragment',
        timeLabel
    });
    return true;
}

try {
    chrome?.storage?.onChanged?.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes?.[favoriteStorageKey];
        if (!change) return;
        const nextEntries = Array.isArray(change.newValue) ? change.newValue.map((entry) => favoriteEntrySnapshot(entry)) : [];
        if (favoriteEntriesSignature(nextEntries) === favoriteEntriesSignature(favoriteState.entries)) return;
        syncFavoriteStateFromEntries(nextEntries, { render: true });
    });
} catch (_) {}

function ensureMainCardFavoriteButtons() {
    document.querySelectorAll('.llm-results .llm-panel').forEach((panel) => {
        if (!panel || panel.id === favoritePanelId || panel.id === 'comparison-panel') return;
        const outputEl = panel.querySelector('.output');
        const headerRight = panel.querySelector('.header-right');
        if (!outputEl || !headerRight) return;
        if (headerRight.querySelector('.panel-fav-btn')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'panel-action-btn panel-fav-btn';
        btn.dataset.target = outputEl.id || '';
        const title = panel.querySelector('.llm-title')?.textContent?.trim() || 'Favorite';
        btn.dataset.sourceName = title;
        btn.title = 'Add to favorites';
        btn.setAttribute('aria-label', 'Add to favorites');
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<i class="ti ti-star" aria-hidden="true"></i>';
        headerRight.appendChild(btn);
    });
    syncAllFavoriteButtonStates();
}

function ensureResponseSelectionToolbar() {
    if (responseSelectionToolbarEl) return responseSelectionToolbarEl;
    const toolbar = document.createElement('div');
    toolbar.id = responseSelectionToolbarId;
    toolbar.className = 'debate-sel-toolbar response-sel-toolbar';
    toolbar.innerHTML = `
        <button class="stb col" style="background:#FFEB3B;border-color:#fbc02d" data-color="#FFEB3B" title="Yellow highlight" aria-label="Yellow highlight"><span class="stb-label">Yellow</span></button>
        <button class="stb col" style="background:#05e56d;border-color:#00c853" data-color="#05e56d" title="Green highlight" aria-label="Green highlight"><span class="stb-label">Green</span></button>
        <button class="stb col" style="background:#f44336;border-color:#d32f2f" data-color="#f44336" title="Red highlight" aria-label="Red highlight"><span class="stb-label">Red</span></button>
        <div style="width:1px;background:rgba(255,255,255,.2);margin:2px 3px;height:14px;flex-shrink:0"></div>
        <button class="stb" data-cmd="bold" title="Bold" aria-label="Bold"><span class="stb-label">Bold</span></button>
        <button class="stb" data-cmd="italic" title="Italic" aria-label="Italic"><span class="stb-label">Italic</span></button>
        <div style="width:1px;background:rgba(255,255,255,.2);margin:2px 3px;height:14px;flex-shrink:0"></div>
        <button class="stb" data-fav="1" title="Add selected fragment to favorites" aria-label="Add selected fragment to favorites"><span class="stb-label">Favourite</span></button>
    `;
    document.body.appendChild(toolbar);
    responseSelectionToolbarEl = toolbar;
    return toolbar;
}

function hideResponseSelectionToolbar() {
    responseSelectionState.range = null;
    responseSelectionState.target = null;
    responseSelectionToolbarEl?.classList.remove('vis');
}

function getResponseSelectionText() {
    const rangeText = String(responseSelectionState.range?.toString?.() || '').trim();
    if (rangeText) return rangeText;
    return String(window.getSelection?.()?.toString?.() || '').trim();
}

function getResponseSelectionHtml() {
    const range = responseSelectionState.range;
    if (!range || range.collapsed) return '';
    try {
        const fragment = range.cloneContents();
        const container = document.createElement('div');
        container.appendChild(fragment);
        return String(container.innerHTML || '').trim();
    } catch (err) {
        console.warn('[RESULTS] response selection html snapshot failed', err);
        return '';
    }
}

function syncResponseSelectionSourceOutput() {
    const sourceOutput = responseSelectionState.target?.closest?.('.output') || null;
    if (!sourceOutput) return;
    sourceOutput.dispatchEvent(new Event('input', { bubbles: true }));
}

function stripBackgroundColorStyles(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    if (el.style && typeof el.style.backgroundColor === 'string') {
        el.style.backgroundColor = '';
        if (typeof el.style.removeProperty === 'function') {
            el.style.removeProperty('background-color');
        }
        if (el.getAttribute?.('style') === '') {
            el.removeAttribute('style');
        }
    }
    Array.from(el.children || []).forEach(stripBackgroundColorStyles);
}

function wrapResponseSelectionRange(tagName, stylePatch = {}) {
    const range = responseSelectionState.range;
    if (!range || range.collapsed) return false;
    const target = responseSelectionState.target;
    if (target && !target.contains(range.commonAncestorContainer)) return false;
    const wrapper = document.createElement(tagName);
    Object.entries(stylePatch).forEach(([key, value]) => {
        wrapper.style[key] = value;
    });
    try {
        const fragment = range.extractContents();
        if (stylePatch && Object.prototype.hasOwnProperty.call(stylePatch, 'backgroundColor')) {
            Array.from(fragment.childNodes || []).forEach(stripBackgroundColorStyles);
        }
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);
        range.selectNodeContents(wrapper);
        syncResponseSelectionSourceOutput();
        return true;
    } catch (err) {
        console.warn('[RESULTS] response selection format failed', err);
        return false;
    }
}

function applyResponseSelectionStyle(command, value = null) {
    let applied = false;
    if (command === 'hiliteColor') {
        applied = wrapResponseSelectionRange('span', { backgroundColor: value || '#FFEB3B' });
    } else if (command === 'bold') {
        applied = wrapResponseSelectionRange('strong');
    } else if (command === 'italic') {
        applied = wrapResponseSelectionRange('em');
    }
    if (!applied && command && document.queryCommandSupported?.(command)) {
        const sel = window.getSelection?.();
        try {
            sel?.removeAllRanges?.();
            if (responseSelectionState.range) sel?.addRange?.(responseSelectionState.range);
            document.execCommand(command, false, value);
            syncResponseSelectionSourceOutput();
        } catch (_) {}
    }
    window.getSelection?.()?.removeAllRanges?.();
    hideResponseSelectionToolbar();
}

function showResponseSelectionToolbar(target) {
    const toolbar = ensureResponseSelectionToolbar();
    if (!toolbar || !target) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (!rect) return;
    responseSelectionState.range = range;
    responseSelectionState.target = target;
    toolbar.classList.add('vis');
    const toolbarWidth = toolbar.offsetWidth || 190;
    const toolbarHeight = toolbar.offsetHeight || 36;
    const gap = 7;
    const top = Math.max(8, rect.top - toolbarHeight - gap);
    let left = rect.left + rect.width / 2 - toolbarWidth / 2 + 14;
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
}

function bindMainPageFavoritesInteractions() {
    if (responseSelectionToolbarBound) return;
    responseSelectionToolbarBound = true;

    document.addEventListener('mouseup', (event) => {
        if (event.target?.closest?.(`#${responseSelectionToolbarId}`)) return;
        const target = event.target?.closest?.('.output');
        if (!target || target.id === favoriteOutputId) {
            hideResponseSelectionToolbar();
            return;
        }
        requestAnimationFrame(() => showResponseSelectionToolbar(target));
    });
    document.addEventListener('mousedown', (event) => {
        if (event.target?.closest?.(`#${responseSelectionToolbarId}`)) return;
        if (!event.target?.closest?.('.output')) {
            hideResponseSelectionToolbar();
        }
    });
    document.addEventListener('click', (event) => {
        const toolbar = event.target?.closest?.(`#${responseSelectionToolbarId}`);
        if (!toolbar) return;
        const btn = event.target.closest('button');
        if (!btn) return;
        event.preventDefault();
        const color = btn.dataset.color || '';
        const cmd = btn.dataset.cmd || '';
        if (color) {
            applyResponseSelectionStyle('hiliteColor', color);
            return;
        }
        if (cmd) {
            applyResponseSelectionStyle(cmd);
            return;
        }
        if (btn.dataset.fav) {
            const text = getResponseSelectionText();
            const html = getResponseSelectionHtml();
            const sourceCard = responseSelectionState.target?.closest?.('.llm-panel') || null;
            if (addFavoriteFragmentFromSelection({ sourceCard, text, html })) {
                hideResponseSelectionToolbar();
                window.getSelection?.()?.removeAllRanges?.();
            }
        }
    });
    document.addEventListener('click', (event) => {
        const btn = event.target.closest('.panel-fav-btn');
        if (!btn) return;
        const outputId = String(btn.dataset.target || '').trim();
        const outputEl = outputId ? document.getElementById(outputId) : null;
        if (!outputEl) return;
        const key = favoriteEntryKeyForCard(outputId);
        const hadEntry = favoriteState.cardKeyToId.has(key);
        const active = toggleFavoriteForOutput(outputEl);
        const hasContent = String(outputEl.innerText || outputEl.textContent || '').trim().length > 0
            || String(outputEl.innerHTML || '').trim().length > 0;
        flashButtonFeedback(btn, active || hadEntry || hasContent ? 'success' : 'warn');
    });
    document.addEventListener('click', (event) => {
        const removeBtn = event.target.closest('.favorite-item-remove');
        if (!removeBtn) return;
        const entryId = String(removeBtn.dataset.removeFavoriteId || '').trim();
        if (!entryId) return;
        removeFavoriteEntryById(entryId);
    });
    document.addEventListener('input', (event) => {
        const bodyEl = event.target?.closest?.('.favorite-item-body[contenteditable="true"]');
        if (!bodyEl || !favoriteOutputEl?.contains(bodyEl)) return;
        syncFavoriteEntryFromBody(bodyEl);
    });
}

setTimeout(bindMainPageFavoritesInteractions, 0);
setTimeout(() => window.clearFavoriteEntriesOnLoad?.(), 0);
function setPromptContent(text) {
    if (!promptInput) return;
    const nextValue = (text || '').trim();
    promptInput.value = '';
    promptInput.value = nextValue;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (useInputRichMode && editorState?.mode === 'PROMPT' && typeof applyRichInputContent === 'function') {
        applyRichInputContent({ text: nextValue, html: '' });
        if (typeof syncPromptViewMode === 'function') {
            syncPromptViewMode();
        }
    }
    promptInput.focus();
    try {
        promptInput.setSelectionRange(0, 0);
    } catch (err) {
        // ignore for unsupported inputs
    }
}

const handlePromptDragOver = (event) => {
    if (!promptInput) return;
    if (event?.dataTransfer) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }
    promptContainer?.classList.add('is-attachment-drag');
};

const handlePromptDragLeave = () => {
    promptContainer?.classList.remove('is-attachment-drag');
};

const handlePromptDrop = (event) => {
    if (!promptInput) return;
    event.preventDefault();
    event.stopPropagation();
    promptContainer?.classList.remove('is-attachment-drag');
    tryAddTransferAttachments(event.dataTransfer);
};

const handlePromptPaste = (event) => {
    if (!promptInput) return;
    const clipboard = event.clipboardData;
    if (tryAddTransferAttachments(clipboard)) {
        event.preventDefault();
        return;
    }
    if (!clipboard) return;
    if (event.currentTarget === promptNoteView && isPromptRichEditable()) {
        return;
    }
    const html = clipboard.getData('text/html');
    if (!html) return;
    const plain = plainTextFromHtml(html);
    if (!plain) return;
    event.preventDefault();
    insertTextAtCursor(promptInput, plain);
};

const promptDragTargets = [promptContainer, promptInput, promptNoteView];
promptDragTargets.forEach((target) => {
    if (!target) return;
    target.addEventListener('dragover', handlePromptDragOver, true);
    target.addEventListener('dragenter', handlePromptDragOver, true);
    target.addEventListener('dragleave', handlePromptDragLeave, true);
    target.addEventListener('drop', handlePromptDrop, true);
});
promptNoteView?.addEventListener('paste', handlePromptPaste, true);
promptInput?.addEventListener('paste', handlePromptPaste, true);

const isPointInsidePrompt = (event) => {
    if (!promptContainer || !event) return false;
    const rect = promptContainer.getBoundingClientRect();
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

const transferHasFiles = (transfer) => {
    if (!transfer) return false;
    if (transfer.files && transfer.files.length) return true;
    const items = Array.from(transfer.items || []);
    return items.some((item) => item?.kind === 'file');
};

document.addEventListener('dragover', (event) => {
    if (!transferHasFiles(event.dataTransfer)) return;
    if (!isPointInsidePrompt(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    promptContainer?.classList.add('is-attachment-drag');
}, true);

document.addEventListener('drop', (event) => {
    if (!transferHasFiles(event.dataTransfer)) return;
    if (!isPointInsidePrompt(event)) return;
    event.preventDefault();
    event.stopPropagation();
    promptContainer?.classList.remove('is-attachment-drag');
    tryAddTransferAttachments(event.dataTransfer);
}, true);

document.addEventListener('dragend', () => {
    promptContainer?.classList.remove('is-attachment-drag');
}, true);

document.addEventListener('dragover', (event) => {
    const target = event.target;
    if (!promptContainer || !target) return;
    if (!promptContainer.contains(target)) return;
    if (!event?.dataTransfer) return;
    const hasFiles = (event.dataTransfer.files && event.dataTransfer.files.length) ||
        Array.from(event.dataTransfer.items || []).some((item) => item?.kind === 'file');
    if (!hasFiles) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}, true);

document.addEventListener('drop', (event) => {
    const target = event.target;
    if (!promptContainer || !target) return;
    if (!promptContainer.contains(target)) return;
    if (!event?.dataTransfer) return;
    const hasFiles = (event.dataTransfer.files && event.dataTransfer.files.length) ||
        Array.from(event.dataTransfer.items || []).some((item) => item?.kind === 'file');
    if (!hasFiles) return;
    event.preventDefault();
    event.stopPropagation();
}, true);

//-- 2. Добавляем обработчик для кнопки "Copy All" --//
document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#copy-all-btn');
    if (!btn) return;

    const { combinedText, combinedHTML } = collectLLMResponses();
    if (!combinedText && !combinedHTML) {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    try {
        await writeRichContentToClipboard({
            text: combinedText,
            html: combinedHTML
        });
        flashButtonFeedback(btn, 'success');
    } catch (err) {
        console.error('[COPY ALL ERROR]', err);
        flashButtonFeedback(btn, 'error');
    }
});

//-- 2.2. Обработчик кнопки "Очистить все ответы" 
document.addEventListener('click', (event) => {
  const btn = event.target.closest('#clear-all-btn');
  if (!btn) return;

  // Собираем все элементы вывода внутри LLM панелей
  const outputs = document.querySelectorAll('.llm-panel .output');
  let clearedAny = false;

  outputs.forEach(outputEl => {
    if (outputEl?.id === favoriteOutputId) {
      return;
    }
    // Полная очистка содержимого
    clearNode(outputEl);
    outputEl.textContent = '';
    // Триггерим input чтобы другие слушатели обновились
    outputEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (outputEl?.id) {
      const key = favoriteEntryKeyForCard(outputEl.id);
      const entryId = favoriteState.cardKeyToId.get(key);
      if (entryId) {
        removeFavoriteEntryById(entryId);
      }
    }
    clearedAny = true;
  });

  // Обновляем состояние UI (если есть такая функция)
  try { if (typeof checkCompareButtonState === 'function') checkCompareButtonState(); } catch (e) { /* noop */ }

  flashButtonFeedback(btn, clearedAny ? 'success' : 'error');
  if (!clearedAny) console.warn('[RESULTS] clear-all: no outputs found to clear');
});



//-- Дополнительные действия с собранными ответами --//
document.addEventListener('click', (event) => {
    const btn = event.target.closest('#use-as-input-btn');
    if (!btn) return;

    const { combinedText, combinedHTML } = collectLLMResponses();
    if (!combinedText && !combinedHTML) {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    const responsesBlock = buildLLMResponsesBlock();
    const textPayload = responsesBlock || combinedText;
    if (typeof applyRichInputContent === 'function') {
        useInputRichMode = true;
        applyRichInputContent({ text: textPayload, html: combinedHTML || '', textOverride: textPayload });
        if (typeof syncPromptViewMode === 'function') {
            syncPromptViewMode();
        }
    } else if (textPayload) {
        setPromptContent(textPayload);
    } else {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    flashButtonFeedback(btn, 'success');
});

//- 1.2. Новый, более надёжный обработчик очистки ответа модели -//
document.addEventListener('click', (event) => {
    const btn = event.target.closest('.panel-clear-response-btn');
    if (!btn) return;

    // 1) Попытка по data-target
    let targetId = (btn.dataset && btn.dataset.target) ? btn.dataset.target.trim() : '';
    let outputEl = targetId ? document.getElementById(targetId) : null;

    // 2) Фоллбек: ищем output внутри той же панели (.llm-panel)
    if (!outputEl) {
        const panel = btn.closest('.llm-panel') || btn.closest('.panel') || null;
        if (panel) {
            outputEl = panel.querySelector('.output') || null;
            // если output найден, обновим targetId для логов / дебага
            if (outputEl && outputEl.id) targetId = outputEl.id;
        }
    }

    // 3) Финальный фоллбек: пробуем угадать id по названию модели в заголовке
    if (!outputEl) {
        try {
            const header = btn.closest('.llm-header') || btn.closest('.header-right')?.parentElement || null;
            const title = header ? (header.querySelector('.llm-title') || header.querySelector('h3')) : null;
            if (title) {
                const guessed = `output-${(title.textContent || '').trim().toLowerCase().replace(/\s+/g, '')}`;
                outputEl = document.getElementById(guessed) || null;
                if (outputEl) targetId = guessed;
            }
        } catch (e) {
            // ignore
        }
    }

    // 4) Если всё ещё не нашли — фейл с визуальным фидбеком
    if (!outputEl) {
        console.warn('[RESULTS] clear button: could not locate output element for', btn, 'data-target=', btn.dataset.target);
        flashButtonFeedback(btn, 'error');
        return;
    }

    if (outputEl.id === favoriteOutputId) {
        clearFavorites();
        flashButtonFeedback(btn, 'success');
        return;
    }

    // 5) Очищаем
    clearNode(outputEl);
    outputEl.textContent = '';
    // триггерим input чтобы другие слушатели обновились
    outputEl.dispatchEvent(new Event('input', { bubbles: true }));

    // 6) Обновляем состояние UI (если есть соответствующие функции)
    try { if (typeof checkCompareButtonState === 'function') checkCompareButtonState(); } catch (e) { /* noop */ }

    // 7) Визуальный фидбек на кнопке
    flashButtonFeedback(btn, 'success');
});

//-- конец блока --//

document.addEventListener('click', (event) => {
    const btn = event.target.closest('#clear-prompt-btn');
    if (!btn) return;

    useInputRichMode = false;
    if (typeof syncPromptViewMode === 'function') {
        syncPromptViewMode();
    }
    setPromptContent('');
    if (promptNoteView && promptContainer?.classList.contains('is-note-viewing')) {
        clearNode(promptNoteView);
    }
    if (setPromptEditorMode && editorState?.mode && editorState.mode !== 'PROMPT') {
        setPromptEditorMode('PROMPT');
    }
    if (typeof clearAllSelectedModifiers === 'function') {
        clearAllSelectedModifiers();
    }
    // Очищаем прикреплённые файлы вместе с текстом и модификаторами
    try {
        attachedFiles.splice(0, attachedFiles.length);
        attachmentKeys.clear();
        renderPromptAttachments && renderPromptAttachments();
    } catch (_) {}
});

// -- Кнопка копирования содержимого поля prompt --
document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#prompt-copy-btn');
    if (!btn) return;

    const promptEl = document.getElementById('prompt-input');
    if (!promptEl) return;

    const text = applySelectedModifiersToPrompt(promptEl.value || '').trim();

    if (!text) {
        // краткий фидбек, если поле пустое
        flashButtonFeedback(btn, 'warn');
        return;
    }

    // Используем Clipboard API с fallback
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            // Fallback: временный textarea
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        // Успех — короткий флеш
        flashButtonFeedback(btn, 'success');
    } catch (err) {
        console.error('Copy failed', err);
        flashButtonFeedback(btn, 'error');
    }
});

//-- 3.1. Обновляем обработчик для экспорта полного промпта в JSON --//
document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#prompt-export-json-btn');
    if (!btn) return;

    const promptEl = document.getElementById('prompt-input');
    if (!promptEl) return;

    const baseText = (promptEl.value || '').trim();

    // Собираем полный текст промпта с префиксами и суффиксами
    const fullPromptText = applySelectedModifiersToPrompt(baseText, { includeResponses: true });

    if (!fullPromptText) {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    // Формируем объект для экспорта в JSON
    const dataToExport = {
        prompt: fullPromptText,
        timestamp: new Date().toISOString()
    };
    const dataStr = JSON.stringify(dataToExport, null, 2); // null, 2 для красивого форматирования

    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    
    // Меняем расширение файла на .json
    a.download = `Prompt ${dateStr}.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    flashButtonFeedback(btn, 'success');
});

function buildAllResponsesExportHtml() {
    const promptEl = document.getElementById('prompt-input');
    const basePromptText = (promptEl?.value || '').trim();
    let promptBlock = '';
    if (basePromptText) {
        const fullPrompt = applySelectedModifiersToPrompt(basePromptText, { includeResponses: true }) || '';
        promptBlock = fullPrompt.replace(/<LLM Responses>[\s\S]*?<\/>/gi, '').trim();
    }

    const { entries } = collectLLMResponses();
    if (!entries.length) {
        return '';
    }

    const htmlSections = entries.map(({ name, text, html, metadataLine }) => `
        <section>
            <h2>${escapeHtml(name)}</h2>
            ${metadataLine ? `<p class="response-meta">${escapeHtml(metadataLine)}</p>` : ''}
            <div class="response-body">${(html && html.trim()) ? html : `<pre>${escapeHtml(text)}</pre>`}</div>
        </section>
    `).join('\n');
    const favoriteSections = buildFavoriteExportSectionsHtml();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>LLM Responses Export</title>
    <style>
        body { font-family: Arial, sans-serif; background: #ffffff; color: #111; padding: 24px; line-height: 1.5; }
        section { margin-bottom: 24px; }
        h2 { margin: 0 0 12px; font-size: 20px; }
        pre { background: #f6f8fa; padding: 12px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; }
        .response-body table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .response-body th, .response-body td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
        .response-body ul, .response-body ol { padding-left: 24px; }
        .response-meta { margin: 0 0 12px; color: #555; font-size: 14px; }
    </style>
</head>
<body>
${promptBlock ? `
    <section>
        <h2>Prompt</h2>
        <pre>${escapeHtml(promptBlock)}</pre>
    </section>
    <hr>
` : ''}
    <h2>LLM Responses</h2>
${htmlSections}
${favoriteSections ? `
    <hr>
    <h2>Favourite</h2>
${favoriteSections}` : ''}
</body>
</html>`;
}

if (
    (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'test')
    || (typeof window !== 'undefined' && window.__RESULTS_TEST_DEBUG__ === true)
) {
    window.__resultsExportDebug = {
        buildAllResponsesExportHtml,
        buildFavoriteExportHtml,
        buildFavoriteExportSectionsHtml,
        favoriteState
    };
}

//-- 1.1. Исправляем экспорт всех ответов в HTML и формат имени файла --//
document.addEventListener('click', (event) => {
    const btn = event.target.closest('#export-html-btn');
    if (!btn) return;

    const htmlContent = buildAllResponsesExportHtml();
    if (!htmlContent) {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Формируем имя файла "LLM Responses <date>.html"
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    a.download = `LLM Responses ${dateStr}.html`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    flashButtonFeedback(btn, 'success');
});

document.addEventListener('click', (event) => {
    const btn = event.target.closest('.panel-use-input-btn');
    if (!btn) return;

    const targetId = btn.dataset.target;
    const outputEl = targetId ? document.getElementById(targetId) : null;
    const rawHtml = outputEl ? outputEl.innerHTML || '' : '';
    const sanitizedHtml = rawHtml ? sanitizeInlineHtml(rawHtml) : '';
    const text = sanitizedHtml
        ? plainTextFromHtml(sanitizedHtml)
        : (outputEl ? (outputEl.innerText || outputEl.textContent || '').trim() : '');

    if (!text && !sanitizedHtml) {
        flashButtonFeedback(btn, 'warn');
        return;
    }
    if (typeof applyRichInputContent === 'function') {
        useInputRichMode = true;
        applyRichInputContent({ text, html: sanitizedHtml });
        if (typeof syncPromptViewMode === 'function') {
            syncPromptViewMode();
        }
    } else if (text) {
        setPromptContent(text);
    } else {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    flashButtonFeedback(btn, 'success');
});

//-- 1.1. Модифицируем экспорт для добавления имени модели-судьи --//
document.addEventListener('click', (event) => {
    const btn = event.target.closest('.panel-export-html-btn');
    if (!btn) return;

    const targetId = btn.dataset.target;
    const outputEl = targetId ? document.getElementById(targetId) : null;
    if (targetId === favoriteOutputId) {
        const favoriteHtml = buildFavoriteExportHtml();
        if (!favoriteHtml) {
            flashButtonFeedback(btn, 'warn');
            return;
        }

        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Favourite</title>
    <style>
        body { font-family: Arial, sans-serif; background: #ffffff; color: #111; padding: 24px; line-height: 1.5; }
        h1 { margin: 0 0 16px; font-size: 22px; }
        h2 { margin: 18px 0 10px; font-size: 18px; }
        pre { background: #f6f8fa; padding: 12px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; }
        .copied-response { margin-bottom: 20px; }
        .copied-meta { margin: 0 0 10px; color: #555; font-size: 13px; }
        .copied-body { background: #f8fafc; padding: 12px; border-radius: 8px; }
        .copied-body pre { background: #eef2f7; }
        .favorite-export-items { display: flex; flex-direction: column; gap: 12px; }
        .favorite-export-item + .favorite-export-item { margin-top: 0; }
        .favorite-export-item .response-meta { margin: 0 0 10px; color: #555; font-size: 13px; }
        .favorite-export-item .response-body { background: #f8fafc; padding: 12px; border-radius: 8px; }
        .favorite-export-item .response-body pre { background: #eef2f7; }
    </style>
</head>
<body>
    <h1>Favourite</h1>
    ${favoriteHtml}
</body>
</html>`;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
        anchor.download = `Favourite ${dateStr}.html`;

        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);

        flashButtonFeedback(btn, 'success');
        return;
    }

    const rawHtml = outputEl ? outputEl.innerHTML || '' : '';
    const sanitizedHtml = rawHtml ? sanitizeInlineHtml(rawHtml).trim() : '';
    const text = sanitizedHtml
        ? plainTextFromHtml(sanitizedHtml)
        : (outputEl ? (outputEl.innerText || outputEl.textContent || '').trim() : '');

    if (!text && !sanitizedHtml) {
        flashButtonFeedback(btn, 'warn');
        return;
    }

    const modelName = btn.dataset.name || 'Model';
    const metadataLine = buildMetadataLine(modelName);
    const metadataHtml = metadataLine ? `<p class="response-meta">${escapeHtml(metadataLine)}</p>` : '';
    let htmlBodyContent; // Создаем переменную для тела HTML

    // Проверяем, является ли это панелью Comparative Analysis
    if (modelName === 'Comparative Analysis') {
        const judgeName = evaluatorSelect ? evaluatorSelect.value : 'Unknown';
        htmlBodyContent = `
            <h1>${escapeHtml(modelName)}</h1>
            <h3 style="color: #555; font-weight: normal;">Generated by: ${escapeHtml(judgeName)}</h3>
            ${metadataHtml}
            <div class="response-body">${sanitizedHtml || `<pre>${escapeHtml(text)}</pre>`}</div>
        `;
    } else {
        // Стандартная логика для всех остальных панелей
        htmlBodyContent = `
            <h1>${escapeHtml(modelName)} Response</h1>
            ${metadataHtml}
            <div class="response-body">${sanitizedHtml || `<pre>${escapeHtml(text)}</pre>`}</div>
        `;
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(modelName)} Response</title>
    <style>
        body { font-family: Arial, sans-serif; background: #ffffff; color: #111; padding: 24px; line-height: 1.5; }
        h1 { font-size: 24px; margin-bottom: 8px; }
        h3 { font-size: 16px; margin-top: 0; margin-bottom: 20px; }
        pre { background: #f6f8fa; padding: 12px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; }
        .response-body table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .response-body th, .response-body td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
        .response-body ul, .response-body ol { padding-left: 24px; }
        .response-meta { margin: 0 0 12px; color: #555; font-size: 14px; }
    </style>
</head>
<body>
    ${htmlBodyContent}
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;

    const modelForFile = String(modelName || 'Model').replace(/[\/\\:?<>|*"']/g, '').trim() || 'Model';
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const fileBase = `Response ${modelForFile} - ${dateStr}`;
    anchor.download = `${fileBase.replace(/[\/\\:?<>|*"']/g, '').trim()}.html`;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    flashButtonFeedback(btn, 'success');
});


        //-- 3. Добавляем обработчик кнопок копирования --//
        document.addEventListener('click', async (event) => {
            const btn = event.target.closest('.copy-btn');
            if (!btn) return;

            const targetId = btn.dataset.target;
            const outputEl = document.getElementById(targetId);
            if (!outputEl) return;

            const text = (outputEl.innerText || '').trim();
            const html = (outputEl.innerHTML || '').trim();
            if (!text && !html) {
                flashButtonFeedback(btn, 'warn');
                return;
            }

            try {
                await writeRichContentToClipboard({ text, html });
                flashButtonFeedback(btn, 'success');
            } catch (err) {
                console.error('[COPY ERROR]', err);
                flashButtonFeedback(btn, 'error');
            }
        });

function checkCompareButtonState() {
    const activeLLMs = getSelectedLLMs();
    let responsesCount = 0;
    activeLLMs.forEach(llm => {
        const outputId = llm.toLowerCase().replace(/\s+/g, '');
        const outputElement = document.getElementById(`output-${outputId}`);
        const output = outputElement ? outputElement.textContent : '';
        if(output && !output.startsWith("Error:")) {
            responsesCount++;
        }
    });
    if (compareButton) {
        compareButton.disabled = responsesCount < 2;
    }
    if (smartCompareButton) { // Добавляем проверку на случай, если элемента нет
        smartCompareButton.disabled = responsesCount < 2;
    }
}

    function getSelectedLLMs() {
        const selected = [];
        const nameMap = {
            'gpt': 'GPT', 'gemini': 'Gemini', 'claude': 'Claude',
            'grok': 'Grok', 'lechat': 'Le Chat', 'qwen': 'Qwen',
            'deepseek': 'DeepSeek', 'perplexity': 'Perplexity'
        };
        llmButtons.forEach(button => {
            if (button.classList.contains('active')) {
                const idName = button.id.replace('llm-', '');
                if (nameMap[idName]) {
                    selected.push(nameMap[idName]);
                }
            }
        });
        return selected;
    }
    if (window.ResultsShared && !window.ResultsShared.getSelectedLLMs) {
        window.ResultsShared.getSelectedLLMs = getSelectedLLMs;
    }

    const debateModelCards = document.getElementById('debate-model-cards');
    const debateSessionTabs = document.getElementById('debate-session-tabs');
    const debateSessionAddBtn = document.getElementById('debate-session-add-btn');
    const debateSessionDeleteBtn = document.getElementById('debate-session-delete-btn');
    const debateSessionCopyBtn = document.getElementById('debate-session-copy-btn');
    const debateSessionExportBtn = document.getElementById('debate-session-export-btn');
    const debateSessionClearBtn = document.getElementById('debate-session-clear-btn');
    const debateApprovalPanel = document.getElementById('debate-approval');
    const debateApprovalBody = document.getElementById('debate-approval-body');
    const debateApprovalMeta = document.getElementById('debate-approval-meta');
    const debateRoleSelect = document.getElementById('mod-role-select');
    const debateSenderSelect = document.getElementById('mod-sender-select');
    const debateReceiverSelect = document.getElementById('mod-receiver-select');
    const debateDirectionIcon = document.getElementById('direction-icon');
    const debateModTime = document.getElementById('mod-time');
    const debateModMessageBody = document.getElementById('mod-message-body');
    const debateMiniPrompts = document.getElementById('mod-mini-prompts');
    const debateModSendBtn = document.getElementById('mod-send-btn');
    const debateModCopyBtn = document.getElementById('mod-copy-btn');
    const debateModExportBtn = document.getElementById('mod-export-btn');
    const debateModClearBtn = document.getElementById('mod-clear-btn');
    const debateActionSelect = document.getElementById('debate-action-select');
    const debateModeSelect = document.getElementById('debate-mode-select');
    const debateLengthSelect = document.getElementById('debate-length-select');
    const debateSelToolbar = document.getElementById('debateSelTb');
    const debateTabsState = {
        activeSessionId: '1',
        sessions: new Map([['1', { id: '1', title: '1', favoriteOnly: false, cards: [], messages: [] }]])
    };
    const debateRunState = {
        activeRole: '',
        status: 'idle',
        turnCount: 0,
        maxTurns: 5,
        pauseReason: ''
    };
    const debateSelectionState = { range: null, target: null };
    const debateDirectionState = { mode: 'forward' };
    const DEBATE_SESSION_CLICK_DELAY_MS = 180;
    let debateSessionClickTimer = null;
    const debateFeedState = {
        nextId: 1,
        placeholders: new Set(),
        pendingApproval: null,
        lastCommittedHashByModel: {},
        selectedCardEl: null
    };
    const debateMessageStore = new Map();
    const debateDomIndex = new Map();
    const DebateEngineRuntime = window.DebateEngine || null;
    const debateTranscriptStore = DebateEngineRuntime?.createStore?.({
        session: {
            sessionId: '1',
            title: '1',
            status: 'idle',
            settings: {
                runPolicy: debateRunPolicySelect?.value || 'manual',
                maxTurns: debateRunState.maxTurns
            }
        }
    }) || null;
    let debateTranscriptPersistTimer = null;
    function makeDebateEntryId(prefix = 'entry') {
        return `${prefix}-${Date.now()}-${debateFeedState.nextId++}`;
    }
    function getDebateTranscriptSession(sessionId = debateTabsState.activeSessionId) {
        const id = String(sessionId || '1');
        if (!debateTranscriptStore || !DebateEngineRuntime) return null;
        let session = debateTranscriptStore.getSession(id);
        if (!session) {
            session = debateTranscriptStore.upsertSession({
                sessionId: id,
                title: id,
                status: 'idle',
                settings: {
                    runPolicy: debateRunPolicySelect?.value || 'manual',
                    maxTurns: debateRunState.maxTurns
                }
            });
        }
        return session;
    }
    function syncDebateTranscriptSettings(sessionId = debateTabsState.activeSessionId) {
        if (!debateTranscriptStore || !DebateEngineRuntime) return null;
        getDebateTranscriptSession(sessionId);
        const maxTurnsValue = Number(debateMaxTurnsInput?.value || debateRunState.maxTurns || 5);
        return debateTranscriptStore.updateSettings(String(sessionId || '1'), {
            runPolicy: debateRunPolicySelect?.value || 'manual',
            maxTurns: Number.isFinite(maxTurnsValue) ? Math.max(1, Math.min(50, Math.round(maxTurnsValue))) : 5
        });
    }
    function scheduleDebateTranscriptPersist() {
        if (!DebateEngineRuntime?.persistStore || !debateTranscriptStore) return;
        if (debateTranscriptPersistTimer) clearTimeout(debateTranscriptPersistTimer);
        debateTranscriptPersistTimer = setTimeout(() => {
            debateTranscriptPersistTimer = null;
            DebateEngineRuntime.persistStore(debateTranscriptStore).catch((err) => {
                console.warn('[RESULTS] Debate transcript persist failed', err);
            });
        }, 250);
    }
    function mapDebateMessageStatusToTurnStatus(message = {}) {
        if (message.kind === 'moderator') return 'approved';
        if (message.status === 'printing') return 'streaming';
        if (message.status === 'approved') return 'approved';
        if (message.status === 'rejected') return 'rejected';
        if (message.status === 'pending') return 'awaiting_approval';
        return 'pending';
    }
    function upsertDebateTranscriptTurn(message = {}) {
        if (!debateTranscriptStore || !DebateEngineRuntime || !message?.id) return null;
        const sessionId = String(message.sessionId || debateTabsState.activeSessionId || '1');
        getDebateTranscriptSession(sessionId);
        syncDebateTranscriptSettings(sessionId);
        const session = debateTranscriptStore.getSession(sessionId);
        const turnId = message.turnId || `turn-${message.id}`;
        const existing = session?.turns?.find((turn) => turn.turnId === turnId);
        const turnPatch = {
            turnId,
            author: message.kind === 'moderator' ? 'Moderator' : (message.model || 'Model'),
            authorType: message.kind === 'moderator' ? 'moderator' : 'model',
            role: message.role || '',
            targets: Array.isArray(message.targets) && message.targets.length
                ? message.targets.slice()
                : (message.kind === 'moderator'
                    ? (debateReceiverSelect?.value && debateReceiverSelect.value !== '__none__' ? [debateReceiverSelect.value] : getDebateTargetModels())
                    : ['Moderator']),
            text: message.text || '',
            html: message.html || '',
            status: mapDebateMessageStatusToTurnStatus(message),
            terminalStatus: message.terminalStatus || '',
            evidence: message.evidence || null,
            createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
            completedAt: message.status === 'printing' ? null : (message.completedAt || new Date(message.updatedAt || Date.now()).toISOString()),
            approvedAt: message.status === 'approved' ? (message.approvedAt || new Date(message.updatedAt || Date.now()).toISOString()) : null,
            delivery: message.delivery || {}
        };
        const turn = existing
            ? debateTranscriptStore.updateTurn(sessionId, turnId, turnPatch)
            : debateTranscriptStore.appendTurn(sessionId, turnPatch);
        message.turnId = turn.turnId;
        scheduleDebateTranscriptPersist();
        return turn;
    }
    function normalizeDebateBoolean(value) {
        return value === true || value === 'true';
    }
    function normalizeDebateKind(value, fallback = 'answer') {
        const kind = String(value || fallback || '').trim();
        return kind || fallback;
    }
    function syncDebateAutoPauseButton() {
        if (!debateAutoPauseBtn) return;
        const isAuto = typeof isDebateAutoPolicy === 'function'
            ? isDebateAutoPolicy()
            : !!autoCheckbox?.checked;
        debateAutoPauseBtn.classList.toggle('hidden', !isAuto);
        debateAutoPauseBtn.textContent = debatePaused ? '▶' : 'Ⅱ';
        debateAutoPauseBtn.title = debatePaused ? 'Resume auto debate' : 'Pause auto debate';
        debateAutoPauseBtn.setAttribute('aria-label', debateAutoPauseBtn.title);
    }
    function autoGrowDebateTextarea(el) {
        if (!el) return;
        const max = 120;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    }
    window.growTA = function growTA(el) {
        autoGrowDebateTextarea(el);
    };
    function autoGrowDebateApprovalBody() {
        if (!debateApprovalBody) return;
        const max = 120;
        debateApprovalBody.style.height = 'auto';
        debateApprovalBody.style.height = `${Math.min(Math.max(debateApprovalBody.scrollHeight, 40), max)}px`;
    }
    function toModelKey(name = '') {
        return String(name).toLowerCase().replace(/\s+/g, '');
    }
    function getActiveDebateSession() {
        return debateTabsState.sessions.get(debateTabsState.activeSessionId) || null;
    }
    function ensureDebateSession(sessionId) {
        const id = String(sessionId || '1');
        if (!debateTabsState.sessions.has(id)) {
            debateTabsState.sessions.set(id, { id, title: id, favoriteOnly: false, cards: [], messages: [] });
        }
        const session = debateTabsState.sessions.get(id);
        if (!Array.isArray(session.messages)) session.messages = [];
        if (!Array.isArray(session.cards)) session.cards = [];
        if (typeof session.favoriteOnly !== 'boolean') {
            session.favoriteOnly = false;
        }
        return session;
    }
    function getDebateSessionFavoriteOnly(sessionId = debateTabsState.activeSessionId) {
        return !!ensureDebateSession(sessionId).favoriteOnly;
    }
    function setDebateSessionFavoriteOnly(sessionId, favoriteOnly) {
        const session = ensureDebateSession(sessionId);
        session.favoriteOnly = !!favoriteOnly;
        return session.favoriteOnly;
    }
    function getDebateSessionIdsSorted() {
        return Array.from(debateTabsState.sessions.keys()).sort((a, b) => Number(a) - Number(b));
    }
    function resolveNextActiveSessionId(removedSessionId) {
        const ids = getDebateSessionIdsSorted();
        if (!ids.length) return String(removedSessionId || '1');
        const index = ids.indexOf(String(removedSessionId));
        if (index > 0) return ids[index - 1];
        return ids[0];
    }
    function syncPromptSandwichLayoutState(sessionId = debateTabsState.activeSessionId) {
        if (!promptContainer) return;
        const session = ensureDebateSession(sessionId);
        const hasDebateFeed = Array.isArray(session.messages) && session.messages.length > 0;
        promptContainer.classList.toggle('has-debate-feed', hasDebateFeed);
    }
    function readDebateCardMessageSnapshot(card) {
        const outputEl = card?.querySelector?.('.debate-model-card-output');
        const timeEl = card?.querySelector?.('.debate-model-card-time');
        const roleEl = card?.querySelector?.('.debate-model-card-role');
        const isModerator = card?.dataset?.kind === 'moderator' || card?.classList?.contains('debate-moderator-card');
        const isFragment = card?.dataset?.kind === 'fragment';
        const isPlaceholder = card?.dataset?.entryKind === 'placeholder' || card?.dataset?.kind === 'placeholder';
        const isPrinting = card?.dataset?.live === 'true';
        const isApproved = card?.dataset?.approved === 'true' || isModerator;
        return {
            sessionId: String(card?.dataset?.sessionId || debateTabsState.activeSessionId || '1'),
            kind: isFragment ? 'fragment' : isModerator ? 'moderator' : 'model',
            status: isPrinting ? 'printing' : isApproved ? 'approved' : isPlaceholder ? 'pending' : 'pending',
            starred: card?.dataset?.starred === 'true',
            sourceMessageId: card?.dataset?.sourceMessageId || '',
            sourceCardId: card?.dataset?.sourceCardId || '',
            model: String(card?.dataset?.llmName || card?.querySelector?.('.debate-model-card-name')?.textContent || (isModerator ? 'Moderator' : 'Model')).trim(),
            role: String(roleEl?.textContent || '').trim(),
            text: String(outputEl?.innerText || outputEl?.textContent || '').trim(),
            html: String(outputEl?.innerHTML || '').trim(),
            timeLabel: String(timeEl?.textContent || '').trim()
        };
    }
    function syncDebateCardFromMessage(card, message) {
        if (!(card instanceof HTMLElement) || !message) return;
        card.dataset.entryId = message.id;
        card.dataset.messageId = message.id;
        card.dataset.sessionId = message.sessionId;
        card.dataset.kind = message.kind === 'model' ? (card.dataset.kind === 'placeholder' ? 'placeholder' : 'answer') : message.kind;
        card.dataset.status = message.status || '';
        card.dataset.starred = message.starred ? 'true' : 'false';
        card.dataset.llmName = message.model || card.dataset.llmName || 'Model';
        if (message.sourceMessageId) card.dataset.sourceMessageId = message.sourceMessageId;
        if (message.sourceCardId) card.dataset.sourceCardId = message.sourceCardId;
        if (message.status === 'approved' || message.kind === 'moderator') card.dataset.approved = 'true';
        if (message.status === 'printing') card.dataset.live = 'true';
        const favBtn = card.querySelector('.debate-fav');
        favBtn?.classList.toggle('active', !!message.starred);
        if (favBtn) {
            favBtn.setAttribute('aria-pressed', String(!!message.starred));
            favBtn.title = message.starred ? 'Remove from favorites' : 'Add to favorites';
        }
        const roleEl = card.querySelector('.debate-model-card-role');
        if (roleEl && typeof message.role === 'string') roleEl.textContent = message.role;
    }
    function ensureDebateCardMessage(card, patch = {}) {
        if (!(card instanceof HTMLElement)) return null;
        const snapshot = { ...readDebateCardMessageSnapshot(card), ...patch };
        const session = ensureDebateSession(snapshot.sessionId);
        const existingId = patch.id || card.dataset.entryId || card.dataset.messageId || '';
        const messageId = existingId || makeDebateEntryId(card.dataset.kind || snapshot.kind || 'entry');
        const prev = debateMessageStore.get(messageId) || null;
        const message = {
            id: messageId,
            turnId: String(snapshot.turnId ?? prev?.turnId ?? card.dataset.turnId ?? ''),
            sessionId: String(snapshot.sessionId || prev?.sessionId || debateTabsState.activeSessionId || '1'),
            kind: normalizeDebateKind(snapshot.kind ?? prev?.kind, 'answer'),
            status: String(snapshot.status ?? prev?.status ?? 'pending'),
            starred: typeof snapshot.starred === 'boolean' ? snapshot.starred : normalizeDebateBoolean(prev?.starred) || normalizeDebateBoolean(card.dataset.starred),
            sourceMessageId: String(snapshot.sourceMessageId ?? prev?.sourceMessageId ?? ''),
            sourceCardId: String(snapshot.sourceCardId ?? prev?.sourceCardId ?? ''),
            model: String(snapshot.model ?? prev?.model ?? ''),
            role: String(snapshot.role ?? prev?.role ?? ''),
            targets: Array.isArray(snapshot.targets) ? snapshot.targets.slice() : (Array.isArray(prev?.targets) ? prev.targets.slice() : []),
            text: String(snapshot.text ?? prev?.text ?? ''),
            html: String(snapshot.html ?? prev?.html ?? ''),
            terminalStatus: String(snapshot.terminalStatus ?? prev?.terminalStatus ?? ''),
            evidence: snapshot.evidence ?? prev?.evidence ?? null,
            delivery: snapshot.delivery ?? prev?.delivery ?? {},
            timeLabel: String(snapshot.timeLabel ?? prev?.timeLabel ?? ''),
            createdAt: prev?.createdAt || Date.now(),
            order: typeof prev?.order === 'number' ? prev.order : debateFeedState.nextId++,
            updatedAt: Date.now()
        };
        if (!message.turnId) message.turnId = `turn-${message.id}`;
        debateMessageStore.set(messageId, message);
        debateDomIndex.set(messageId, card);
        const existingIndex = session.messages.findIndex((m) => m.id === messageId);
        if (existingIndex >= 0) {
            session.messages[existingIndex] = message;
        } else {
            session.messages.push(message);
        }
        card.dataset.turnId = message.turnId;
        syncDebateCardFromMessage(card, message);
        upsertDebateTranscriptTurn(message);
        return message;
    }
    function patchDebateCardMessage(card, patch = {}) {
        if (!(card instanceof HTMLElement)) return null;
        const message = ensureDebateCardMessage(card);
        if (!message) return null;
        Object.assign(message, patch, { updatedAt: new Date().toISOString() });
        syncDebateCardFromMessage(card, message);
        upsertDebateTranscriptTurn(message);
        return message;
    }
    function removeDebateCardMessage(card) {
        if (!(card instanceof HTMLElement)) return;
        const sessionId = card.dataset.sessionId || debateTabsState.activeSessionId;
        const messageId = card.dataset.entryId || card.dataset.messageId;
        if (!messageId) return;
        debateMessageStore.delete(messageId);
        debateDomIndex.delete(messageId);
        const session = ensureDebateSession(sessionId);
        session.messages = session.messages.filter((message) => message.id !== messageId);
        if (debateTranscriptStore?.deleteTurn) {
            try {
                getDebateTranscriptSession(sessionId);
                debateTranscriptStore.deleteTurn(String(sessionId || '1'), card.dataset.turnId || `turn-${messageId}`);
                scheduleDebateTranscriptPersist();
            } catch (err) {
                console.warn('[RESULTS] Debate transcript delete failed', err);
            }
        }
    }
    function shouldShowDebateCard(card, options = {}) {
        if (!(card instanceof HTMLElement)) return false;
        const state = ensureDebateCardMessage(card);
        if (!state) return false;
        const sessionId = String(options.sessionId ?? debateTabsState.activeSessionId ?? '1');
        const favoriteOnly = typeof options.favoriteOnly === 'boolean'
            ? options.favoriteOnly
            : getDebateSessionFavoriteOnly(sessionId);
        if (state.sessionId !== sessionId) return false;
        if (state.kind === 'fragment') return favoriteOnly && !!state.starred;
        if (!favoriteOnly) return true;
        return !!state.starred;
    }
    function getVisibleDebateCards(sessionId = debateTabsState.activeSessionId) {
        if (!debateModelCards) return [];
        const favoriteOnly = getDebateSessionFavoriteOnly(sessionId);
        const timelineOrder = new Map(
            ensureDebateSession(sessionId).messages.map((message, index) => [message.id, index])
        );
        return Array.from(debateModelCards.children).filter((card) => {
            return shouldShowDebateCard(card, { sessionId, favoriteOnly });
        }).sort((a, b) => {
            const aId = a.dataset.entryId || a.dataset.messageId || '';
            const bId = b.dataset.entryId || b.dataset.messageId || '';
            return (timelineOrder.get(aId) ?? Number.MAX_SAFE_INTEGER)
                - (timelineOrder.get(bId) ?? Number.MAX_SAFE_INTEGER);
        });
    }
    function renderDebateSessionTabs() {
        if (!debateSessionTabs) return;
        const tabs = Array.from(debateTabsState.sessions.values())
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map((session) => `
                <button type="button" class="debate-session-tab${session.id === debateTabsState.activeSessionId ? ' active' : ''}${session.favoriteOnly ? ' favorite-only' : ''}" data-session-id="${escapeHtml(session.id)}" title="Session ${escapeHtml(session.id)}">${escapeHtml(session.title || session.id)}</button>
            `).join('');
        debateSessionTabs.innerHTML = tabs;
    }
    function applyDebateSessionFilter() {
        if (!debateModelCards) return;
        const activeSessionId = debateTabsState.activeSessionId;
        const favoriteOnly = getDebateSessionFavoriteOnly(activeSessionId);
        let firstPending = null;
        let firstApproved = null;
        Array.from(debateModelCards.children).forEach((card) => {
            if (!(card instanceof HTMLElement)) return;
            normalizeDebateCardState(card);
            const message = ensureDebateCardMessage(card);
            card.classList.remove('first-pending-zone-card', 'first-approved-zone-card');
            const show = shouldShowDebateCard(card, { sessionId: activeSessionId, favoriteOnly });
            card.style.display = show ? '' : 'none';
            if (show && card.dataset.kind !== 'moderator') {
                if (card.dataset.approved === 'true') {
                    firstApproved = firstApproved || card;
                } else {
                    firstPending = firstPending || card;
                }
            }
        });
        firstApproved?.classList.add('first-approved-zone-card');
        syncPromptSandwichLayoutState(activeSessionId);
        debateModelCards.scrollTop = debateModelCards.scrollHeight;
    }
    function getDebateTargetModels() {
        const selected = getSelectedLLMs();
        const receiver = String(debateReceiverSelect?.value || '').trim();
        if (receiver === '__none__') return [];
        if (receiver) return selected.includes(receiver) ? [receiver] : [];
        return selected;
    }
    function buildApprovalCheckboxHtml(isSelectable = true) {
        return isSelectable
            ? '<input type="checkbox" class="debate-approval-check" title="Approve this answer" aria-label="Approve this answer">'
            : '';
    }
    function isFinalResponseMeta(meta = {}) {
        const status = String(meta.status || meta.finalStatus || '').toUpperCase();
        const reason = String(meta.reason || meta.completionReason || '').toLowerCase();
        if (status === 'GENERATING' || reason === 'generation_active') return false;
        return Boolean(status && status !== 'RECEIVING' && status !== 'IN_PROGRESS');
    }
    function setDebatePrintingState(card, llmName, isPrinting) {
        if (!card) return;
        let printingEl = card.querySelector('.debate-model-card-printing');
        if (!isPrinting) {
            printingEl?.remove();
            card.dataset.live = 'false';
            return;
        }
        card.dataset.live = 'true';
        if (!printingEl) {
            printingEl = document.createElement('div');
            printingEl.className = 'debate-model-card-printing';
            card.appendChild(printingEl);
        }
        printingEl.textContent = `[${llmName}] printing`;
    }
    const DEBATE_CARD_COLLAPSED_LINES = 5;
    function getDebateCardOutputTextLength(outputEl) {
        return String(outputEl?.innerText || outputEl?.textContent || '').trim().length;
    }
    function estimateDebateCardLineCount(outputEl) {
        const text = String(outputEl?.innerText || outputEl?.textContent || '');
        if (!text.trim()) return 0;
        return text.split(/\r?\n/).reduce((count, line) => {
            return count + Math.max(1, Math.ceil(line.length / 96));
        }, 0);
    }
    function ensureDebateShowMoreButton(card) {
        if (!(card instanceof HTMLElement)) return null;
        let btn = card.querySelector('.debate-card-show-more');
        if (btn) return btn;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'debate-card-show-more';
        btn.textContent = 'Show more';
        btn.hidden = true;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setDebateCardExpanded(card, true);
        });
        const outputEl = card.querySelector('.debate-model-card-output');
        if (outputEl) outputEl.insertAdjacentElement('afterend', btn);
        return btn;
    }
    function setDebateCardExpanded(card, expanded) {
        if (!(card instanceof HTMLElement)) return;
        card.dataset.expanded = expanded ? 'true' : 'false';
        card.classList.toggle('is-expanded', !!expanded);
        const btn = card.querySelector('.debate-card-show-more');
        if (btn) btn.hidden = !!expanded ? true : !card.classList.contains('has-overflow');
    }
    function syncDebateCardOutputLayout(card) {
        if (!(card instanceof HTMLElement)) return;
        const outputEl = card.querySelector('.debate-model-card-output');
        if (!outputEl) return;
        const isEmpty = outputEl.classList.contains('debate-model-card-empty') || getDebateCardOutputTextLength(outputEl) === 0;
        if (isEmpty) {
            card.classList.remove('has-response', 'has-overflow', 'is-expanded');
            card.dataset.expanded = 'false';
            const btn = card.querySelector('.debate-card-show-more');
            if (btn) btn.hidden = true;
            return;
        }
        card.classList.add('has-response');
        if (card.dataset.expanded !== 'true') {
            setDebateCardExpanded(card, false);
        }
        const btn = ensureDebateShowMoreButton(card);
        const updateOverflowState = () => {
            const expanded = card.dataset.expanded === 'true';
            const domOverflow = outputEl.scrollHeight > outputEl.clientHeight + 1;
            const estimatedOverflow = estimateDebateCardLineCount(outputEl) > DEBATE_CARD_COLLAPSED_LINES;
            const hasOverflow = domOverflow || estimatedOverflow;
            card.classList.toggle('has-overflow', hasOverflow);
            if (btn) btn.hidden = expanded || !hasOverflow;
        };
        updateOverflowState();
        requestAnimationFrame(updateOverflowState);
    }
    function normalizeDebateCardState(card) {
        if (!(card instanceof HTMLElement) || !card.classList.contains('debate-model-card')) return;
        const isModerator = card.dataset.kind === 'moderator' || card.classList.contains('debate-moderator-card');
        const isApproved = card.dataset.approved === 'true' || isModerator;
        const timeEl = card.querySelector('.debate-model-card-time');
        const titleMainEl = card.querySelector('.debate-model-card-title-main');
        const nameEl = card.querySelector('.debate-model-card-name');

        if (isModerator) {
            card.dataset.approved = 'true';
            card.dataset.approvalSelectable = 'false';
            card.dataset.live = 'false';
            card.classList.add('is-approved', 'debate-moderator-card');
            card.querySelector('.debate-approval-check')?.remove();
            card.querySelectorAll('.status-indicator').forEach((indicator) => indicator.remove());
            setDebatePrintingState(card, card.dataset.llmName || 'Moderator', false);
        }

        if (isApproved) {
            card.classList.add('is-approved');
            card.querySelector('.debate-approval-check')?.remove();
            card.querySelectorAll('.status-indicator').forEach((indicator) => indicator.remove());
            if (timeEl && titleMainEl) {
                timeEl.classList.remove('msg-time');
                timeEl.classList.add('debate-inline-time');
                const referenceEl = nameEl?.nextSibling || titleMainEl.firstChild;
                if (timeEl.parentElement !== titleMainEl || timeEl.previousElementSibling !== nameEl) {
                    titleMainEl.insertBefore(timeEl, referenceEl);
                }
            }
        } else if (timeEl) {
            timeEl.classList.remove('debate-inline-time', 'msg-time');
            const metaEl = card.querySelector('.debate-model-card-meta');
            if (metaEl && timeEl.parentElement !== metaEl) {
                metaEl.insertBefore(timeEl, metaEl.firstChild);
            }
            card.classList.remove('is-approved');
        }
        syncDebateCardOutputLayout(card);
    }
    function getFirstPendingCard(sessionId = debateTabsState.activeSessionId) {
        if (!debateModelCards) return null;
        return Array.from(debateModelCards.querySelectorAll('.debate-model-card'))
            .find((card) => (
                card.dataset.sessionId === sessionId
                && card.dataset.kind !== 'moderator'
                && card.dataset.approved !== 'true'
            )) || null;
    }
    function insertDebateCard(card, options = {}) {
        if (!debateModelCards || !card) return;
        normalizeDebateCardState(card);
        const sessionId = String(card.dataset.sessionId || debateTabsState.activeSessionId || '1');
        const zone = options.zone || (card.dataset.approved === 'true' ? 'approved' : 'pending');
        if (zone === 'approved') {
            const firstPending = getFirstPendingCard(sessionId);
            if (firstPending && firstPending !== card) {
                debateModelCards.insertBefore(card, firstPending);
                return;
            }
        }
        if (card.parentElement !== debateModelCards) {
            debateModelCards.appendChild(card);
        }
    }
    function insertModeratorCard(card) {
        if (!debateModelCards || !card) return;
        normalizeDebateCardState(card);
        insertDebateCard(card);
    }
    function formatDebateTurnTime(turn = {}) {
        const date = turn.completedAt || turn.approvedAt || turn.createdAt || Date.now();
        const parsed = new Date(date);
        const safeDate = Number.isFinite(parsed.getTime()) ? parsed : new Date();
        return `${String(safeDate.getHours()).padStart(2, '0')}:${String(safeDate.getMinutes()).padStart(2, '0')}`;
    }
    function debateTurnKind(turn = {}) {
        if (turn.authorType === 'moderator' || turn.author === 'Moderator') return 'moderator';
        if (turn.authorType === 'system') return 'system';
        return 'model';
    }
    function debateTurnStatus(turn = {}) {
        if (turn.status === 'streaming') return 'printing';
        if (turn.status === 'approved' || turn.authorType === 'moderator') return 'approved';
        if (turn.status === 'rejected') return 'rejected';
        if (turn.status === 'completed' || turn.status === 'awaiting_approval') return 'pending';
        return turn.status || 'pending';
    }
    function createDebateCardFromTurn(turn = {}) {
        if (!debateModelCards || !turn.turnId) return null;
        const kind = debateTurnKind(turn);
        const status = debateTurnStatus(turn);
        const modelName = kind === 'moderator' ? 'Moderator' : (turn.author || 'Model');
        const timeLabel = formatDebateTurnTime(turn);
        const card = document.createElement('div');
        card.className = `debate-model-card${kind === 'moderator' ? ' debate-moderator-card' : ''}`;
        card.dataset.sessionId = String(turn.sessionId || debateTabsState.activeSessionId || '1');
        card.dataset.entryId = String(turn.turnId);
        card.dataset.messageId = String(turn.turnId);
        card.dataset.turnId = String(turn.turnId);
        card.dataset.llmName = modelName;
        card.dataset.entryKind = 'response';
        card.dataset.kind = kind === 'moderator' ? 'moderator' : 'answer';
        card.dataset.starred = 'false';
        card.dataset.approved = (status === 'approved' || kind === 'moderator') ? 'true' : 'false';
        card.dataset.approvalSelectable = status === 'pending' ? 'true' : 'false';
        card.dataset.live = status === 'printing' ? 'true' : 'false';
        const approvalHtml = status === 'pending' && kind !== 'moderator' ? buildApprovalCheckboxHtml(true) : '';
        card.innerHTML = `
            <div class="debate-model-card-header">
                <span class="debate-model-card-title">
                    ${kind === 'moderator' ? '' : '<span class="status-indicator success"></span>'}
                    <span class="debate-model-card-title-main">
                        <span class="debate-model-card-name">${escapeHtml(modelName)}</span>
                        ${kind === 'moderator' ? '' : `<span class="debate-model-card-role">${escapeHtml(turn.role || '')}</span>`}
                        ${approvalHtml}
                    </span>
                </span>
                <span class="debate-model-card-meta">
                    <span class="debate-model-card-time">${escapeHtml(timeLabel)}</span>
                    ${kind === 'moderator' ? '' : '<button type="button" class="ib debate-card-branch" title="Branch" aria-label="Branch"><i class="ti ti-git-branch" aria-hidden="true"></i></button>'}
                    <button type="button" class="ib debate-card-copy" title="Copy" aria-label="Copy"><i class="ti ti-copy" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-export" title="Export HTML" aria-label="Export HTML"><i class="ti ti-download" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-delete" title="Delete" aria-label="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-fav" title="Favorite" aria-label="Favorite"><i class="ti ti-star" aria-hidden="true"></i></button>
                </span>
            </div>
            <div class="debate-model-card-output"></div>
        `;
        const body = card.querySelector('.debate-model-card-output');
        const html = sanitizeInlineHtml(String(turn.html || '').trim());
        if (html) {
            replaceChildrenFromSanitizedHtml(body, html);
        } else {
            body.textContent = String(turn.text || '');
        }
        bindApprovalCheckbox(card);
        ensureDebateCardMessage(card, {
            id: String(turn.turnId),
            turnId: String(turn.turnId),
            kind,
            status,
            model: modelName,
            role: turn.role || '',
            targets: Array.isArray(turn.targets) ? turn.targets.slice() : [],
            text: String(turn.text || ''),
            html: html || escapeHtml(turn.text || ''),
            terminalStatus: turn.terminalStatus || '',
            evidence: turn.evidence || null,
            timeLabel,
            createdAt: turn.createdAt || Date.now(),
            completedAt: turn.completedAt || null,
            approvedAt: turn.approvedAt || null,
            delivery: turn.delivery || {}
        });
        normalizeDebateCardState(card);
        return card;
    }
    function renderDebateTranscriptSession(sessionId = debateTabsState.activeSessionId) {
        if (!debateModelCards || !debateTranscriptStore) return false;
        const session = debateTranscriptStore.getSession(String(sessionId || '1'));
        if (!session) return false;
        const id = String(session.sessionId || sessionId || '1');
        const uiSession = ensureDebateSession(id);
        uiSession.title = session.title || id;
        uiSession.messages = [];
        Array.from(debateModelCards.children).forEach((card) => {
            if (card instanceof HTMLElement && String(card.dataset.sessionId || '') === id) {
                removeDebateCardMessage(card);
                card.remove();
            }
        });
        (session.turns || []).forEach((turn) => {
            const card = createDebateCardFromTurn(turn);
            if (card) insertDebateCard(card, { zone: card.dataset.approved === 'true' ? 'approved' : 'pending' });
        });
        renderDebateSessionTabs();
        applyDebateSessionFilter();
        return true;
    }
    function hydrateDebateTranscriptFromArtifact(artifact = {}, options = {}) {
        if (!DebateEngineRuntime || !debateTranscriptStore || !artifact) return false;
        const sessions = Array.isArray(artifact.sessions) ? artifact.sessions : [];
        if (!sessions.length) return false;
        sessions.forEach((session) => {
            const sessionId = String(session.sessionId || session.id || '1');
            debateTranscriptStore.upsertSession({
                ...session,
                sessionId,
                turns: []
            });
            debateTranscriptStore.clearTurns(sessionId);
            (session.turns || []).forEach((turn) => {
                debateTranscriptStore.appendTurn(sessionId, { ...turn, sessionId });
            });
            ensureDebateSession(sessionId).title = session.title || sessionId;
        });
        const activeId = String(artifact.activeSessionId || sessions[0]?.sessionId || debateTabsState.activeSessionId || '1');
        if (debateTranscriptStore.getSession(activeId)) {
            debateTranscriptStore.setActiveSession(activeId);
            debateTabsState.activeSessionId = activeId;
        }
        if (options.render !== false) {
            renderDebateTranscriptSession(debateTabsState.activeSessionId);
        }
        return true;
    }
    function loadDebateTranscriptFromStorage() {
        if (!DebateEngineRuntime?.loadStore || !debateTranscriptStore) return Promise.resolve(false);
        return DebateEngineRuntime.loadStore()
            .then((restored) => {
                const artifact = DebateEngineRuntime.exportArtifact(restored);
                return hydrateDebateTranscriptFromArtifact(artifact, { render: true });
            })
            .catch((err) => {
                console.warn('[RESULTS] Debate transcript restore failed', err);
                return false;
            });
    }
    function approveDebateCard(card) {
        if (!card || card.dataset.approved === 'true') return null;
        const outputEl = card.querySelector('.debate-model-card-output');
        const text = String(outputEl?.innerText || outputEl?.textContent || '').trim();
        if (!text || card.dataset.kind === 'placeholder') return null;
        const llmName = card.dataset.llmName || 'Model';
        card.dataset.approved = 'true';
        card.dataset.approvalSelectable = 'false';
        card.dataset.live = 'false';
        patchDebateCardMessage(card, {
            status: 'approved',
            kind: card.dataset.kind === 'fragment' ? 'fragment' : 'model'
        });
        normalizeDebateCardState(card);
        setDebatePrintingState(card, llmName, false);
        insertDebateCard(card, { zone: 'approved' });
        syncModeratorSelectors();
        applyDebateSessionFilter();
        return { card, llmName, text };
    }
    window.approveDebateCheckbox = function approveDebateCheckbox(checkbox) {
        const card = checkbox?.closest?.('.debate-model-card');
        return approveDebateCard(card);
    };
    function bindApprovalCheckbox(card) {
        const checkbox = card?.querySelector?.('.debate-approval-check');
        if (!checkbox || checkbox.dataset.bound === 'true') return;
        checkbox.dataset.bound = 'true';
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) approveDebateCard(card);
        });
        checkbox.addEventListener('click', () => {
            setTimeout(() => {
                if (checkbox.isConnected && checkbox.checked) approveDebateCard(card);
            }, 0);
        });
    }
    function renderDebateModelCards(
        roleValue = debateRunState.activeRole || (debateRoleSelect?.value || ''),
        models = getDebateTargetModels(),
        options = {}
    ) {
        if (!debateModelCards) return;
        const selected = Array.isArray(models) ? models.filter(Boolean) : [];
        if (!selected.length) return;
        const approvalSelectable = options.approvalSelectable !== false;
        const session = ensureDebateSession(debateTabsState.activeSessionId);
        selected.forEach((name) => {
            const existingPending = Array.from(debateModelCards.querySelectorAll('.debate-model-card'))
                .find((card) => (
                    card.dataset.sessionId === session.id
                    && card.dataset.llmName === name
                    && card.dataset.approved !== 'true'
                    && (
                        card.dataset.entryKind === 'placeholder'
                        || card.dataset.live === 'true'
                        || card.dataset.entryKind === 'response'
                    )
                ));
            if (existingPending) {
                updateCardRole(existingPending, roleValue);
                bindApprovalCheckbox(existingPending);
                patchDebateCardMessage(existingPending, {
                    role: roleValue,
                    status: existingPending.dataset.live === 'true' ? 'printing' : 'pending'
                });
                insertDebateCard(existingPending, { zone: 'pending' });
                return;
            }
            const key = `${session.id}:${toModelKey(name)}:${Date.now()}:${debateFeedState.nextId++}`;
            const card = document.createElement('div');
            card.className = 'debate-model-card';
            card.dataset.sessionId = session.id;
            card.dataset.llmName = name;
            card.dataset.entryKind = 'placeholder';
            card.dataset.kind = 'placeholder';
            card.dataset.approvalSelectable = approvalSelectable ? 'true' : 'false';
            card.dataset.live = 'true';
            card.id = `debate-placeholder-${key}`;
            card.innerHTML = `
                <div class="debate-model-card-header">
                    <span class="debate-model-card-title">
                        <span class="status-indicator" data-llm-name="${escapeHtml(name)}"></span>
                        <span class="debate-model-card-title-main">
                            <span class="debate-model-card-name">${escapeHtml(name)}</span>
                            <span class="debate-model-card-role" data-role-for="${escapeHtml(name)}"></span>
                            ${buildApprovalCheckboxHtml(approvalSelectable)}
                        </span>
                    </span>
                    <span class="debate-model-card-meta">
                        <span class="debate-model-card-time"></span>
                        <button type="button" class="ib debate-card-branch" title="Branch" aria-label="Branch"><i class="ti ti-git-branch"></i></button>
                        <button type="button" class="ib debate-card-copy" title="Copy" aria-label="Copy"><i class="ti ti-copy" aria-hidden="true"></i></button>
                        <button type="button" class="ib debate-card-export" title="Export HTML" aria-label="Export HTML"><i class="ti ti-download" aria-hidden="true"></i></button>
                        <button type="button" class="ib debate-card-delete" title="Delete" aria-label="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button>
                        <button type="button" class="ib debate-fav" title="Favorite" aria-label="Favorite"><i class="ti ti-star" aria-hidden="true"></i></button>
                    </span>
                </div>
                <div class="debate-model-card-output debate-model-card-empty"></div>
            `;
            updateCardRole(card, roleValue);
            bindApprovalCheckbox(card);
            ensureDebateCardMessage(card, {
                kind: 'model',
                status: 'printing',
                role: roleValue,
                starred: false
            });
            insertDebateCard(card, { zone: 'pending' });
            debateFeedState.placeholders.add(`${session.id}:${key}`);
        });
        applyDebateSessionFilter();
    }
    function appendModeratorFeedEntry(text) {
        if (!debateModelCards) return;
        const normalizedText = String(text || '').trim();
        if (!normalizedText) return;
        const session = ensureDebateSession(debateTabsState.activeSessionId);
        const card = document.createElement('div');
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        card.className = 'debate-model-card debate-moderator-card';
        card.dataset.sessionId = session.id;
        card.dataset.llmName = 'Moderator';
        card.dataset.entryKind = 'response';
        card.dataset.kind = 'moderator';
        card.dataset.starred = 'false';
        card.dataset.entryId = String(debateFeedState.nextId++);
        card.dataset.approved = 'moderator';
        card.innerHTML = `
            <div class="debate-model-card-header">
                <span class="debate-model-card-title">
                    <span class="debate-model-card-title-main">
                        <span class="debate-model-card-name">Moderator</span>
                    </span>
                </span>
                <span class="debate-model-card-meta">
                    <span class="debate-model-card-time">${hh}:${mm}</span>
                    <button type="button" class="ib debate-card-copy" title="Copy" aria-label="Copy"><i class="ti ti-copy" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-export" title="Export HTML" aria-label="Export HTML"><i class="ti ti-download" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-delete" title="Delete" aria-label="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-fav" title="Favorite" aria-label="Favorite"><i class="ti ti-star" aria-hidden="true"></i></button>
                </span>
            </div>
            <div class="debate-model-card-output"></div>
        `;
        const body = card.querySelector('.debate-model-card-output');
        body.textContent = normalizedText;
        ensureDebateCardMessage(card, {
            kind: 'moderator',
            status: 'approved',
            model: 'Moderator',
            text: normalizedText,
            html: escapeHtml(normalizedText),
            timeLabel: `${hh}:${mm}`,
            starred: false
        });
        normalizeDebateCardState(card);
        insertModeratorCard(card);
        applyDebateSessionFilter();
    }
    function updateCardRole(card, roleValue) {
        if (!card) return;
        const roleEl = card.querySelector('.debate-model-card-role');
        if (roleEl) {
            roleEl.textContent = roleValue ? String(roleValue).trim() : '';
        }
    }
    function appendDebateFeedEntry(llmName, text, html = '', meta = {}) {
        if (!debateModelCards || !llmName) return;
        const normalizedText = String(text || '').trim();
        const normalizedHtml = sanitizeInlineHtml(String(html || '').trim());
        if (!normalizedText && !normalizedHtml) return;
        const session = ensureDebateSession(debateTabsState.activeSessionId);
        const modelKey = `${session.id}:${toModelKey(llmName)}`;
        const isFinal = isFinalResponseMeta(meta);
        const contentHash = `${isFinal ? 'final' : 'printing'}|${normalizedText.length}:${normalizedText.slice(0, 64)}|${normalizedHtml.length}:${normalizedHtml.slice(0, 64)}`;
        if (debateFeedState.lastCommittedHashByModel[modelKey] === contentHash) return;
        debateFeedState.lastCommittedHashByModel[modelKey] = contentHash;
        const liveCard = Array.from(debateModelCards.querySelectorAll('.debate-model-card'))
            .find((card) => (
                card.dataset.sessionId === session.id
                && card.dataset.llmName === llmName
                && card.dataset.approved !== 'true'
                && (card.dataset.entryKind === 'placeholder' || card.dataset.live === 'true')
            ))
            || Array.from(debateModelCards.querySelectorAll('.debate-model-card'))
                .reverse()
                .find((card) => (
                    card.dataset.sessionId === session.id
                    && card.dataset.llmName === llmName
                    && card.dataset.approved !== 'true'
                    && card.dataset.entryKind === 'response'
                    && card.dataset.kind !== 'moderator'
                ));
        if (liveCard) {
            liveCard.dataset.entryKind = 'response';
            liveCard.dataset.kind = meta.kind || 'answer';
            liveCard.dataset.starred = liveCard.dataset.starred || 'false';
            bindApprovalCheckbox(liveCard);
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const timeEl = liveCard.querySelector('.debate-model-card-time');
            if (timeEl) timeEl.textContent = `${hh}:${mm}`;
            updateCardRole(liveCard, meta.role || debateRunState.activeRole || (debateRoleSelect?.value || ''));
            const body = liveCard.querySelector('.debate-model-card-output');
            if (body) {
                body.classList.remove('debate-model-card-empty');
                if (normalizedHtml) {
                    replaceChildrenFromSanitizedHtml(body, normalizedHtml);
                } else {
                    body.textContent = normalizedText;
                }
            }
            syncDebateCardOutputLayout(liveCard);
            setDebatePrintingState(liveCard, llmName, !isFinal);
            patchDebateCardMessage(liveCard, {
                kind: 'model',
                status: isFinal ? 'pending' : 'printing',
                model: llmName,
                role: meta.role || debateRunState.activeRole || (debateRoleSelect?.value || ''),
                text: normalizedText || String(body?.innerText || body?.textContent || '').trim(),
                html: normalizedHtml || String(body?.innerHTML || '').trim(),
                timeLabel: `${hh}:${mm}`
            });
            applyDebateSessionFilter();
            return;
        }
        const card = document.createElement('div');
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        card.className = 'debate-model-card';
        card.dataset.sessionId = session.id;
        card.dataset.llmName = llmName;
        card.dataset.entryKind = 'response';
        card.dataset.kind = meta.kind || 'answer';
        card.dataset.starred = 'false';
        card.dataset.entryId = String(debateFeedState.nextId++);
        card.innerHTML = `
            <div class="debate-model-card-header">
                <span class="debate-model-card-title">
                    <span class="status-indicator success" data-llm-name="${escapeHtml(llmName)}"></span>
                    <span class="debate-model-card-title-main">
                        <span class="debate-model-card-name">${escapeHtml(llmName)}</span>
                        <span class="debate-model-card-role"></span>
                        ${buildApprovalCheckboxHtml(true)}
                    </span>
                </span>
                <span class="debate-model-card-meta">
                    <span class="debate-model-card-time">${hh}:${mm}</span>
                    <button type="button" class="ib debate-card-branch" title="Branch" aria-label="Branch"><i class="ti ti-git-branch"></i></button>
                    <button type="button" class="ib debate-card-copy" title="Copy" aria-label="Copy"><i class="ti ti-copy" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-export" title="Export HTML" aria-label="Export HTML"><i class="ti ti-download" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-delete" title="Delete" aria-label="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-fav" title="Favorite" aria-label="Favorite"><i class="ti ti-star" aria-hidden="true"></i></button>
                </span>
            </div>
            <div class="debate-model-card-output"></div>
        `;
        updateCardRole(card, meta.role || debateRunState.activeRole || (debateRoleSelect?.value || ''));
        const body = card.querySelector('.debate-model-card-output');
        if (normalizedHtml) {
            replaceChildrenFromSanitizedHtml(body, normalizedHtml);
        } else {
            body.textContent = normalizedText;
        }
        syncDebateCardOutputLayout(card);
        setDebatePrintingState(card, llmName, !isFinal);
        bindApprovalCheckbox(card);
        ensureDebateCardMessage(card, {
            kind: 'model',
            status: isFinal ? 'pending' : 'printing',
            model: llmName,
            role: meta.role || debateRunState.activeRole || (debateRoleSelect?.value || ''),
            text: normalizedText || String(body?.innerText || body?.textContent || '').trim(),
            html: normalizedHtml || String(body?.innerHTML || '').trim(),
            timeLabel: `${hh}:${mm}`,
            starred: false
        });
        insertDebateCard(card, { zone: card.dataset.approved === 'true' ? 'approved' : 'pending' });
        applyDebateSessionFilter();
    }
    function setDebateApprovalCandidate(candidate) {
        debateFeedState.pendingApproval = candidate || null;
        if (!debateApprovalPanel || !debateApprovalBody) return;
        if (!candidate) {
            debateApprovalPanel.classList.remove('hidden');
            debateApprovalBody.classList.add('debate-model-card-empty');
            debateApprovalBody.textContent = '';
            if (debateApprovalMeta) debateApprovalMeta.textContent = 'Waiting';
            autoGrowDebateApprovalBody();
            return;
        }
        debateApprovalPanel.classList.remove('hidden');
        if (debateApprovalMeta) debateApprovalMeta.textContent = `${candidate.llmName} pending`;
        debateApprovalBody.classList.remove('debate-model-card-empty');
        if (candidate.html) {
            replaceChildrenFromSanitizedHtml(debateApprovalBody, candidate.html);
        } else {
            debateApprovalBody.textContent = candidate.text || '';
        }
        autoGrowDebateApprovalBody();
    }
    function collectCheckedDebateApprovals({ commit = false } = {}) {
        if (!debateModelCards) return [];
        const activeSessionId = debateTabsState.activeSessionId;
        return Array.from(debateModelCards.querySelectorAll('.debate-approval-check:checked'))
            .map((checkbox) => {
                const card = checkbox.closest('.debate-model-card');
                if (!card || card.dataset.sessionId !== activeSessionId) return null;
                const outputEl = card.querySelector('.debate-model-card-output');
                const text = String(outputEl?.innerText || outputEl?.textContent || '').trim();
                if (!text || card.dataset.kind === 'placeholder') return null;
                const item = {
                    card,
                    llmName: card.dataset.llmName || 'Model',
                    text
                };
                if (commit) {
                    approveDebateCard(card);
                }
                return item;
            })
            .filter(Boolean);
    }
    function collectApprovedDebateAnswers() {
        if (!debateModelCards) return [];
        const activeSessionId = debateTabsState.activeSessionId;
        return Array.from(debateModelCards.querySelectorAll('.debate-model-card[data-approved="true"]'))
            .filter((card) => (
                card.dataset.sessionId === activeSessionId
                && card.dataset.kind !== 'moderator'
                && card.dataset.kind !== 'fragment'
            ))
            .map((card) => {
                const outputEl = card.querySelector('.debate-model-card-output');
                const text = String(outputEl?.innerText || outputEl?.textContent || '').trim();
                if (!text) return null;
                return {
                    card,
                    llmName: card.dataset.llmName || 'Model',
                    text
                };
            })
            .filter(Boolean);
    }
    function getModeratorDispatchText() {
        const moderatorInputText = String(promptInput?.value || '').trim();
        const moderatorBodyText = String(
            debateModMessageBody?.innerText
            || debateModMessageBody?.textContent
            || ''
        ).trim();
        return moderatorInputText || moderatorBodyText;
    }
    function clearModeratorComposer() {
        if (promptInput && isModeratorTextarea) {
            promptInput.value = '';
            promptInput.dispatchEvent(new Event('input', { bubbles: true }));
            autoGrowDebateTextarea(promptInput);
        }
        if (debateModMessageBody) {
            debateModMessageBody.innerHTML = '';
        }
    }
    function buildDebateModeratorDispatchText() {
        const approval = debateFeedState.pendingApproval;
        const legacyApprovalText = approval
            ? String(approval.text || '').trim() || String(debateApprovalBody?.innerText || '').trim()
            : '';
        const checkedApprovals = collectCheckedDebateApprovals();
        const approvedAnswers = checkedApprovals.length ? checkedApprovals : collectApprovedDebateAnswers();
        const moderatorText = getModeratorDispatchText();
        const parts = [];
        approvedAnswers.forEach((item) => {
            parts.push(`${item.llmName}\n${item.text}`);
        });
        if (!approvedAnswers.length && legacyApprovalText) {
            const approvalLabel = approval?.llmName || 'Model';
            parts.push(`${approvalLabel}\n${legacyApprovalText}`);
        }
        if (moderatorText) {
            parts.push(`Moderator\n${moderatorText}`);
        }
        return parts.join('\n\n').trim();
    }
    function updateDebateModelCardOutput(llmName, text, html = '', meta = {}) {
        const normalizedText = String(text || '').trim();
        const normalizedHtml = sanitizeInlineHtml(String(html || '').trim());
        appendDebateFeedEntry(llmName, normalizedText, normalizedHtml, {
            ...meta,
            role: meta?.role || debateRunState.activeRole || (debateRoleSelect?.value || '')
        });
    }
    function approvePendingDebateCandidate() {
        const candidate = debateFeedState.pendingApproval;
        if (!candidate) return false;
        appendDebateFeedEntry(candidate.llmName, candidate.text, candidate.html, candidate);
        setDebateApprovalCandidate(null);
        return true;
    }
    function setActiveDebateSession(sessionId, options = {}) {
        const session = ensureDebateSession(sessionId);
        const prevActiveSessionId = debateTabsState.activeSessionId;
        const prevFavoriteOnly = getDebateSessionFavoriteOnly(session.id);
        if (typeof options.favoriteOnly === 'boolean') {
            setDebateSessionFavoriteOnly(session.id, options.favoriteOnly);
        }
        debateTabsState.activeSessionId = session.id;
        const nextFavoriteOnly = getDebateSessionFavoriteOnly(session.id);
        if (prevActiveSessionId === session.id && prevFavoriteOnly === nextFavoriteOnly) {
            return;
        }
        renderDebateSessionTabs();
        applyDebateSessionFilter();
    }
    function addDebateSession() {
        const ids = getDebateSessionIdsSorted().map(Number).filter(Number.isFinite);
        const next = String((ids.length ? Math.max(...ids) : 0) + 1);
        ensureDebateSession(next);
        setActiveDebateSession(next);
    }
    function removeDebateSession(sessionId = debateTabsState.activeSessionId) {
        const id = String(sessionId || debateTabsState.activeSessionId || '1');
        const sessionCount = debateTabsState.sessions.size;
        if (!debateTabsState.sessions.has(id)) return false;
        if (sessionCount <= 1) {
            clearDebateFeed(id);
            setDebateSessionFavoriteOnly(id, false);
            renderDebateSessionTabs();
            applyDebateSessionFilter();
            return true;
        }
        clearDebateFeed(id);
        debateTabsState.sessions.delete(id);
        const nextActiveSessionId = resolveNextActiveSessionId(id);
        debateTabsState.activeSessionId = ensureDebateSession(nextActiveSessionId).id;
        renderDebateSessionTabs();
        applyDebateSessionFilter();
        return true;
    }
    function getApprovedSenderModels() {
        const cardsRoot = document.getElementById('debate-model-cards');
        if (!cardsRoot) return [];
        const activeSessionId = debateTabsState.activeSessionId;
        return Array.from(cardsRoot.querySelectorAll('.debate-model-card[data-approved="true"]'))
            .filter((card) => card.dataset.sessionId === activeSessionId)
            .map((card) => card.dataset.llmName || '')
            .filter(Boolean)
            .filter((name, index, list) => list.indexOf(name) === index);
    }
    function syncModeratorSelectors() {
        const selected = getSelectedLLMs();
        const approvedSenders = getApprovedSenderModels();
        const senderOptions = ['<option value="Moderator">Moderator</option>']
            .concat(selected.map((name) => {
                const disabled = approvedSenders.includes(name) ? '' : ' disabled';
                return `<option value="${escapeHtml(name)}"${disabled}>${escapeHtml(name)}</option>`;
            }))
            .join('');
        const receiverOptions = [
            '<option value="">All models</option>',
            '<option value="__none__">None</option>'
        ]
            .concat(selected.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`))
            .join('');
        if (debateSenderSelect) {
            const prevValue = debateSenderSelect.value;
            debateSenderSelect.innerHTML = senderOptions;
            const hasPrevValue = Array.from(debateSenderSelect.options).some((opt) => opt.value === prevValue && !opt.disabled);
            debateSenderSelect.value = hasPrevValue ? prevValue : 'Moderator';
        }
        if (debateReceiverSelect) {
            const prevValue = debateReceiverSelect.value;
            debateReceiverSelect.innerHTML = receiverOptions;
            const hasPrevValue = Array.from(debateReceiverSelect.options).some((opt) => opt.value === prevValue);
            debateReceiverSelect.value = hasPrevValue ? prevValue : '__none__';
        }
    }
    function syncDirectionIcon() {
        if (!debateDirectionIcon) return;
        if (debateDirectionState.mode === 'all') {
            debateDirectionIcon.textContent = '||';
            return;
        }
        debateDirectionIcon.textContent = debateDirectionState.mode === 'reverse' ? '←' : '→';
    }
    function syncModeratorMiniPrompts() {
        if (!debateMiniPrompts) return;
        const role = debateRoleSelect?.value || '';
        const action = debateActionSelect?.value || '';
        const pieces = [];
        if (role) pieces.push(`<span class="mod-mini-prompt">Role: ${escapeHtml(role)}</span>`);
        if (action) pieces.push(`<span class="mod-mini-prompt">Action: ${escapeHtml(action)}</span>`);
        debateMiniPrompts.innerHTML = pieces.join('');
        if (debateModMessageBody) {
            debateModMessageBody.innerHTML = pieces.join(' ');
        }
    }
    function syncModeratorTime() {
        if (!debateModTime) return;
        const now = new Date();
        debateModTime.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    function hideDebateSelectionToolbar() {
        if (debateSelToolbar) debateSelToolbar.classList.remove('vis');
        debateSelectionState.range = null;
        debateSelectionState.target = null;
    }
    function showDebateSelectionToolbar(target) {
        if (!debateSelToolbar || !target) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        const range = sel.getRangeAt(0).cloneRange();
        const rect = range.getBoundingClientRect();
        const wrapRect = document.querySelector('.prompt-sandwich')?.getBoundingClientRect();
        if (!rect || !wrapRect) return;
        debateSelectionState.range = range;
        debateSelectionState.target = target;
        debateSelToolbar.classList.add('vis');
        const toolbarWidth = debateSelToolbar.offsetWidth || 190;
        const toolbarHeight = debateSelToolbar.offsetHeight || 36;
        const gap = 8;
        const top = Math.max(4, rect.top - wrapRect.top - toolbarHeight - gap);
        let left = rect.left - wrapRect.left + rect.width / 2 - toolbarWidth / 2;
        left = Math.max(4, Math.min(left, wrapRect.width - toolbarWidth - 4));
        debateSelToolbar.style.top = `${top}px`;
        debateSelToolbar.style.left = `${left}px`;
    }
    function getDebateSelectionText() {
        const rangeText = String(debateSelectionState.range?.toString?.() || '').trim();
        if (rangeText) return rangeText;
        return String(window.getSelection?.()?.toString?.() || '').trim();
    }
    function getDebateSelectionHtml() {
        const range = debateSelectionState.range;
        if (!range || range.collapsed) return '';
        try {
            const fragment = range.cloneContents();
            const container = document.createElement('div');
            container.appendChild(fragment);
            return String(container.innerHTML || '').trim();
        } catch (err) {
            console.warn('[RESULTS] debate selection html snapshot failed', err);
            return '';
        }
    }
    function syncDebateSelectionSourceMessage() {
        const sourceCard = debateSelectionState.target?.closest?.('.debate-model-card') || null;
        if (!sourceCard) return;
        const outputEl = sourceCard.querySelector('.debate-model-card-output');
        patchDebateCardMessage(sourceCard, {
            text: String(outputEl?.innerText || outputEl?.textContent || '').trim(),
            html: String(outputEl?.innerHTML || '').trim()
        });
        syncDebateCardOutputLayout(sourceCard);
    }
    function stripBackgroundColorStyles(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        if (el.style && typeof el.style.backgroundColor === 'string') {
            el.style.backgroundColor = '';
            if (typeof el.style.removeProperty === 'function') {
                el.style.removeProperty('background-color');
            }
            if (el.getAttribute?.('style') === '') {
                el.removeAttribute('style');
            }
        }
        Array.from(el.children || []).forEach(stripBackgroundColorStyles);
    }
    function wrapDebateSelectionRange(tagName, stylePatch = {}) {
        const range = debateSelectionState.range;
        if (!range || range.collapsed) return false;
        const target = debateSelectionState.target;
        if (target && !target.contains(range.commonAncestorContainer)) return false;
        const wrapper = document.createElement(tagName);
        Object.entries(stylePatch).forEach(([key, value]) => {
            wrapper.style[key] = value;
        });
        try {
            const fragment = range.extractContents();
            if (stylePatch && Object.prototype.hasOwnProperty.call(stylePatch, 'backgroundColor')) {
                Array.from(fragment.childNodes || []).forEach(stripBackgroundColorStyles);
            }
            wrapper.appendChild(fragment);
            range.insertNode(wrapper);
            range.selectNodeContents(wrapper);
            syncDebateSelectionSourceMessage();
            return true;
        } catch (err) {
            console.warn('[RESULTS] debate selection format failed', err);
            return false;
        }
    }
    function applyDebateSelectionStyle(command, value = null) {
        let applied = false;
        if (command === 'hiliteColor') {
            applied = wrapDebateSelectionRange('span', { backgroundColor: value || '#FFEB3B' });
        } else if (command === 'bold') {
            applied = wrapDebateSelectionRange('strong');
        } else if (command === 'italic') {
            applied = wrapDebateSelectionRange('em');
        }
        if (!applied && command && document.queryCommandSupported?.(command)) {
            const sel = window.getSelection?.();
            try {
                sel?.removeAllRanges?.();
                if (debateSelectionState.range) sel?.addRange?.(debateSelectionState.range);
                document.execCommand(command, false, value);
                syncDebateSelectionSourceMessage();
            } catch (_) {}
        }
        window.getSelection?.()?.removeAllRanges?.();
        hideDebateSelectionToolbar();
    }
    function promoteDebateSelectionToFavorite() {
        const text = getDebateSelectionText();
        const html = getDebateSelectionHtml();
        if (!text || !debateModelCards) return;
        const session = ensureDebateSession(debateTabsState.activeSessionId);
        const sourceCard = debateSelectionState.target?.closest?.('.debate-model-card') || null;
        const sourceMessage = sourceCard ? ensureDebateCardMessage(sourceCard) : null;
        const sourceModel = sourceMessage?.model || sourceCard?.dataset?.llmName || 'Fragment';
        if (sourceCard && !sourceCard.id) {
            sourceCard.id = `debate-source-${sourceMessage?.id || makeDebateEntryId('source')}`;
        }
        const card = document.createElement('div');
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        card.className = 'debate-model-card fragment-card debate-fragment-card';
        card.dataset.sessionId = session.id;
        card.dataset.entryKind = 'response';
        card.dataset.kind = 'fragment';
        card.dataset.starred = 'true';
        if (sourceMessage?.id) card.dataset.sourceMessageId = sourceMessage.id;
        if (sourceCard?.id) card.dataset.sourceCardId = sourceCard.id;
        card.dataset.llmName = sourceModel;
        card.innerHTML = `
            <div class="debate-model-card-header">
                <span class="debate-model-card-title">
                    <span class="status-indicator success"></span>
                    <span class="debate-model-card-title-main">
                        <span class="debate-model-card-name">Fragment</span>
                        <span class="debate-model-card-role">${escapeHtml(sourceModel)}</span>
                    </span>
                </span>
                <span class="debate-model-card-meta">
                    <span class="debate-model-card-time">${hh}:${mm}</span>
                    <button type="button" class="ib debate-card-branch" title="Branch" aria-label="Branch"><i class="ti ti-git-branch"></i></button>
                    <button type="button" class="ib debate-card-copy" title="Copy" aria-label="Copy"><i class="ti ti-copy" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-export" title="Export HTML" aria-label="Export HTML"><i class="ti ti-download" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-card-delete" title="Delete" aria-label="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button>
                    <button type="button" class="ib debate-fav active" title="Favorite" aria-label="Favorite"><i class="ti ti-star" aria-hidden="true"></i></button>
                </span>
            </div>
            <div class="debate-model-card-output">${html || escapeHtml(text)}</div>
        `;
        ensureDebateCardMessage(card, {
            kind: 'fragment',
            status: 'approved',
            starred: true,
            sourceMessageId: sourceMessage?.id || '',
            sourceCardId: sourceCard?.id || '',
            sessionId: session.id,
            model: sourceModel,
            role: sourceModel,
            text,
            html: html || escapeHtml(text),
            timeLabel: `${hh}:${mm}`
        });
        syncDebateCardOutputLayout(card);
        debateModelCards.appendChild(card);
        applyDebateSessionFilter();
        hideDebateSelectionToolbar();
        window.getSelection().removeAllRanges();
    }
    function collectDebateFeedHtml(activeOnly = false) {
        if (!debateModelCards) return '';
        const cards = getVisibleDebateCards();
        const html = cards.map((card) => {
            const clone = card.cloneNode(true);
            if (!(clone instanceof HTMLElement)) return '';
            clone.querySelectorAll('.debate-model-card-meta, .debate-approval-check, .debate-model-card-printing').forEach((el) => el.remove());
            return clone.outerHTML;
        }).join('');
        return activeOnly ? html : `<div class="debate-feed-export">${html}</div>`;
    }
    function collectDebateFeedText() {
        if (!debateModelCards) return '';
        const lines = [];
        getVisibleDebateCards().forEach((card) => {
            const message = ensureDebateCardMessage(card);
            const outputEl = card.querySelector('.debate-model-card-output');
            const text = String(outputEl?.innerText || outputEl?.textContent || '').trim();
            if (!text) return;
            if (message?.kind === 'fragment') {
                const sourceLine = message.sourceMessageId ? `Fragment from: ${message.model || 'Source'}` : 'Fragment';
                lines.push(`${sourceLine}\n${text}`);
            } else {
                const label = message?.model || card.dataset.llmName || 'Message';
                const time = message?.timeLabel ? ` ${message.timeLabel}` : '';
                lines.push(`${label}${time}\n${text}`);
            }
        });
        return lines.join('\n\n');
    }
    function collectDebateArtifact() {
        if (!DebateEngineRuntime || !debateTranscriptStore) return null;
        return DebateEngineRuntime.exportArtifact(debateTranscriptStore);
    }
    function collectDebateMarkdown() {
        if (!DebateEngineRuntime || !debateTranscriptStore) return collectDebateFeedText();
        const session = debateTranscriptStore.getSession(debateTabsState.activeSessionId);
        return session ? DebateEngineRuntime.exportMarkdown(session) : '';
    }
    function clearDebateFeed(activeSessionId = debateTabsState.activeSessionId) {
        if (!debateModelCards) return;
        Array.from(debateModelCards.children).forEach((card) => {
            if (card instanceof HTMLElement && card.dataset.sessionId === activeSessionId) {
                removeDebateCardMessage(card);
                card.remove();
            }
        });
        ensureDebateSession(activeSessionId).messages = [];
        if (debateTranscriptStore?.clearTurns) {
            try {
                getDebateTranscriptSession(activeSessionId);
                debateTranscriptStore.clearTurns(String(activeSessionId || '1'));
                scheduleDebateTranscriptPersist();
            } catch (err) {
                console.warn('[RESULTS] Debate transcript clear failed', err);
            }
        }
        debateFeedState.placeholders = new Set(
            Array.from(debateFeedState.placeholders).filter((key) => !String(key).startsWith(`${activeSessionId}:`))
        );
        syncPromptSandwichLayoutState(activeSessionId);
    }

    //-- 2.1. Выносим функцию сборки промпта в общую область видимости --//
    function buildLLMResponsesBlock() {
        const { combinedText } = collectLLMResponses();
        if (!combinedText) return '';
        return `<LLM Responses>\n${combinedText}\n</>`;
    }

    function wrapResponsesBlock(content = '') {
        const trimmed = (content || '').trim();
        if (!trimmed) return '';
        return `<LLM Responses>\n${trimmed}\n</>`;
    }

    function splitPromptAndEmbeddedResponses(rawText = '') {
        const text = rawText || '';
        if (!text.trim()) {
            return { promptCore: '', embeddedResponses: '' };
        }

        const tagRegex = /<LLM Responses>\s*([\s\S]*?)\s*<\/>/i;
        const tagMatch = text.match(tagRegex);
        if (tagMatch) {
            const withoutTag = (text.slice(0, tagMatch.index) + text.slice(tagMatch.index + tagMatch[0].length)).trim();
            return {
                promptCore: withoutTag,
                embeddedResponses: tagMatch[1].trim()
            };
        }

        const lines = text.split('\n');
        let splitIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('===')) {
                splitIndex = i;
                break;
            }
        }

        if (splitIndex === -1) {
            return { promptCore: text.trim(), embeddedResponses: '' };
        }

        const promptCore = lines.slice(0, splitIndex).join('\n').trim();
        const embedded = lines.slice(splitIndex).join('\n').trim();
        return { promptCore, embeddedResponses: embedded };
    }

    function applySelectedModifiersToPrompt(baseText, options = {}) {
        const includeResponses = !!options.includeResponses;
        const wrapPromptTag = options.wrapPromptTag !== false;
        const prefixParts = [];
        const suffixParts = [];
        const { promptCore, embeddedResponses } = splitPromptAndEmbeddedResponses(baseText);

        if (selectedModifierIds && selectedModifierIds.length > 0) {
            const selected = selectedModifierIds
                .map(id => modifiersById[id])
                .filter(Boolean);

            selected.forEach(mod => {
                let cleanText = getEffectiveModifierText(mod);

                if (!cleanText) return;

                const categoryLabel = (mod.groupLabel || '').trim() ||
                    (mod.type === 'suffix' ? 'Output' : 'Instruction');
                const formatted = `<${categoryLabel}: ${cleanText}>`;

                if (mod.type === 'suffix') {
                    suffixParts.push(formatted);
                } else {
                    prefixParts.push(formatted);
                }
            });
        }

        const finalParts = [];
        prefixParts.forEach(part => finalParts.push(part));

        if (promptCore) {
            if (wrapPromptTag) {
                finalParts.push(`<Prompt>\n${promptCore}\n</Prompt>`);
            } else {
                finalParts.push(promptCore);
            }
        }

        if (includeResponses) {
            let responsesBlock = buildLLMResponsesBlock();
            if (!responsesBlock && embeddedResponses) {
                responsesBlock = wrapResponsesBlock(embeddedResponses);
            }
            if (responsesBlock) {
                finalParts.push(responsesBlock);
            }
        }

        suffixParts.forEach(part => finalParts.push(part));

        return finalParts.join('\n\n');
    }

    startButton?.addEventListener('click', async () => {
        if (getItButton) {
            getItButton.disabled = true;
        }

        try {
            let finalPrompt = promptInput.value;
            if (!finalPrompt) {
                alert('Please enter a prompt.');
                return;
            }
            if (!(await ensureNoOtherViewRun())) {
                return;
            }

            const bodyClassNames = String(document.body.className || '').split(/\s+/).filter(Boolean);
            if (!bodyClassNames.includes('pipeline-page') && !bodyClassNames.includes('prompt-submitted')) {
                document.body.className = bodyClassNames.concat('prompt-submitted').join(' ');
            }

            finalPrompt = applySelectedModifiersToPrompt(finalPrompt);
            const selectedLLMs = getSelectedLLMs();
            if (selectedLLMs.length === 0) {
                showNotification('Please select at least one LLM.');
                return;
            }

            const forceNewTabs = newPagesCheckbox ? newPagesCheckbox.checked : true;
            const useApiFallback = apiModeCheckbox ? apiModeCheckbox.checked : true;
            const attachmentsPayload = await buildAttachmentPayload();
            if (attachmentsPayload.length) {
                const unsupported = selectedLLMs.filter((name) => ATTACH_CAPABILITY[name] === false);
                if (unsupported.length) {
                    showNotification(`These LLMs may not support attachments: ${unsupported.join(', ')}`, 'warn');
                }
            }

            let response = null;
            try {
                response = await sendToBackground({
                    type: 'START_FULLPAGE_PROCESS',
                    prompt: finalPrompt,
                    selectedLLMs: selectedLLMs,
                    forceNewTabs,
                    useApiFallback,
                    sourceView: getCurrentViewKey(),
                    attachments: attachmentsPayload
                });
            } catch (err) {
                console.warn('[RESULTS] Failed to start with attachments, retrying without them', err);
                response = await sendToBackground({
                    type: 'START_FULLPAGE_PROCESS',
                    prompt: finalPrompt,
                    selectedLLMs: selectedLLMs,
                    forceNewTabs,
                    useApiFallback,
                    sourceView: getCurrentViewKey()
                });
            }

            if (!response || response.status !== 'process_started') {
                showNotification(`Process start: unexpected background response (${response?.status || 'no_response'})`, 'warn');
            }

            syncProStreamVisibility();

            if (forceNewTabs && newPagesCheckbox) {
                newPagesCheckbox.checked = false;
                storeNewPagesState(false);
            }
        } catch (err) {
            console.error('[RESULTS] Failed to start process', err);
            showNotification(`Failed to send request: ${err?.message || String(err)}`, 'error');
        } finally {
            if (getItButton) {
                getItButton.disabled = false;
            }
        }
    });
    
if (getItButton) {
    getItButton.addEventListener('click', () => {
        if (getItButton.disabled) return;
        console.log('[RESULTS] Get Answers clicked: requesting latest responses from open LLM tabs');
        const selectedLLMs = getSelectedLLMs();
        selectedLLMs.forEach(llmName => {
            chrome.runtime.sendMessage({ 
                type: 'REQUEST_LLM_RESPONSE', 
                llmName: llmName,
                manualRecovery: true,
                advanceStrategy: false
            });
        });
        Object.keys(pendingResponses).forEach(llmName => {
            updateLLMPanelOutput(llmName, pendingResponses[llmName]);
        });
        pendingResponses = {};
        checkCompareButtonState();
    });
}

    function getSelectedJudgeSystemPrompt() {
        if (!judgeSystemPromptSelect || !judgeSystemPrompts.length) return null;
        const selectedId = judgeSystemPromptSelect.value;
        return judgeSystemPrompts.find((prompt) => prompt.id === selectedId) || judgeSystemPrompts[0] || null;
    }

    function buildJudgeEvaluationPrompt(systemPromptText = '', originalPrompt = '', responsesList = '') {
        const trimmedSystemPrompt = String(systemPromptText || '').trim();
        const trimmedOriginalPrompt = String(originalPrompt || '').trim();
        const trimmedResponses = String(responsesList || '').trim();

        if (!trimmedSystemPrompt) {
            return (prompts?.evaluationTemplate || '')
                .replace('{originalPrompt}', trimmedOriginalPrompt)
                .replace('{responsesList}', trimmedResponses)
                .trim();
        }

        let promptBody = trimmedSystemPrompt;
        const hasOriginalPlaceholder = promptBody.includes('{originalPrompt}');
        const hasResponsesPlaceholder = promptBody.includes('{responsesList}');

        if (hasOriginalPlaceholder) {
            promptBody = promptBody.replace('{originalPrompt}', trimmedOriginalPrompt);
        }
        if (hasResponsesPlaceholder) {
            promptBody = promptBody.replace('{responsesList}', trimmedResponses);
        }

        const parts = [promptBody];
        if (!hasOriginalPlaceholder && trimmedOriginalPrompt) {
            parts.push(`User request:\n${trimmedOriginalPrompt}`);
        }
        if (!hasResponsesPlaceholder && trimmedResponses) {
            parts.push(`Responses for analysis:\n\n${trimmedResponses}`);
        }
        return parts.join('\n\n').trim();
    }



//-- 2.1. Обработчик для кнопки "Send" (оставляем отправку оценки, но НЕ показываем Comparative Analysis) --//
//- 1.1 replace compareButton handler -//
if (compareButton) {
compareButton.addEventListener('click', () => {
    if (compareButton.disabled) return;
    if (!prompts || !prompts.evaluationTemplate) {
        console.error('[RESULTS] Evaluation template not loaded, using default');
        prompts = prompts || {};
        prompts.evaluationTemplate = "Compare the following responses to the question: \"{originalPrompt}\".\n\nResponses for analysis:\n\n{responsesList}\n\nSelect the best response, briefly explain why, and present the result as a detailed, structured bulleted list. The evaluation must be comprehensive, considering relevance, detail, usefulness, and accuracy.";
    }
    console.log('[RESULTS] Compare button clicked, preparing evaluation prompt.');

    // 1) Гарантируем, что секция Comparative Analysis скрыта при Send
    if (comparisonSection) {
        comparisonSection.classList.add('hidden');
        comparisonSection.setAttribute('aria-hidden', 'true');
    }

    // 2) Показываем только спиннер (секция Comparative Analysis остаётся скрытой до нажатия Smart)
    if (comparisonSpinner) comparisonSpinner.style.display = 'block';
    if (comparisonOutput) {
        replaceChildrenFromHtml(
            comparisonOutput,
            '<p class="comparison-placeholder">Waiting for the judge response...</p>'
        );
    }
    pendingJudgeAnswer = '';
    pendingJudgeHTML = '';

    // 3) Собираем ответы
    const activeLLMs = getSelectedLLMs();
    let responsesList = '';
    let validResponsesCount = 0;

    activeLLMs.forEach(llm => {
        const outputId = llm.toLowerCase().replace(/\s+/g, '');
        const outputElement = document.getElementById(`output-${outputId}`);
        const output = outputElement ? outputElement.textContent.trim() : '';

        if (output && !output.startsWith("Error:")) {
            responsesList += `-------------------------\n\n**${llm}:**\n${output}\n\n`;
            validResponsesCount++;
        }
    });

    // 4) Добавляем финальный разделитель для завершения списка
    if (validResponsesCount > 0) {
        responsesList += '-------------------------';
    }

    // 5) Проверка минимального количества ответов
    if (validResponsesCount < 2) {
        showNotification('Need at least two valid responses to compare.');
        if (comparisonSpinner) comparisonSpinner.style.display = 'none';
        return;
    }

    const originalPrompt = promptInput.value || 'the user\'s request';
    
    // 6) Формируем полный промпт для модели-оценщика
    const selectedSystemPrompt = getSelectedJudgeSystemPrompt();
    const evaluationPrompt = buildJudgeEvaluationPrompt(
        selectedSystemPrompt ? selectedSystemPrompt.text : '',
        originalPrompt,
        responsesList
    );

    const normalizedPrompt = normalizeLineEndings(evaluationPrompt).trim();
    const normalizedResponses = normalizeLineEndings(responsesList.trim());

    lastEvaluationPromptNormalized = normalizedPrompt;
    lastResponsesListNormalized = normalizedResponses;

    if (normalizedPrompt && normalizedResponses) {
        const responsesIndex = normalizedPrompt.indexOf(normalizedResponses);
        if (responsesIndex !== -1) {
            lastEvaluationPrefixNormalized = normalizedPrompt.slice(0, responsesIndex).trim();
            lastEvaluationSuffixNormalized = normalizedPrompt.slice(responsesIndex + normalizedResponses.length).trim();
        } else {
            lastEvaluationPrefixNormalized = '';
            lastEvaluationSuffixNormalized = '';
        }
    } else {
        lastEvaluationPrefixNormalized = '';
        lastEvaluationSuffixNormalized = '';
    }

    const selectedEvaluator = evaluatorSelect ? evaluatorSelect.value : 'Claude';
    
    console.log(`[RESULTS] Sending evaluation request to ${selectedEvaluator} (background, no focus change)`);
    console.log(`[RESULTS] Evaluation prompt length: ${evaluationPrompt.length} characters`);
    
    // 7) Отправляем сообщение в background.js с флагом openEvaluatorTab:false (чтобы вкладка судьи не открывалась)
    chrome.runtime.sendMessage({ 
        type: 'START_EVALUATION_WITH_PROMPT', 
        evaluationPrompt: evaluationPrompt,
        evaluatorLLM: selectedEvaluator,
        openEvaluatorTab: false
    });
});
}

//- end replace -//



    //-- 3.1. Обработчик кнопки "Smart": показывает Comparative Analysis ТОЛЬКО при нажатии Smart.
//-- Если результат оценки уже пришёл (comparisonOutput непустой) — показываем его.
//-- Иначе: fallback — копируем ответ из выбранной модели в секцию сравнения.
if (smartCompareButton) {
    smartCompareButton.addEventListener('click', () => {
        if (smartCompareButton.disabled) return;

        console.log('[RESULTS] Smart button clicked.');

        const evaluationReady = pendingJudgeAnswer && pendingJudgeAnswer.trim().length > 0;
        const hasComparisonContent = pendingJudgeHTML && pendingJudgeHTML.trim().length > 0;
        const spinnerActive = comparisonSpinner && comparisonSpinner.style.display === 'block';

        if (comparisonSection) {
            comparisonSection.classList.remove('hidden');
            comparisonSection.setAttribute('aria-hidden', 'false');
        }

        if (evaluationReady || hasComparisonContent) {
            if (comparisonOutput) {
                const html = hasComparisonContent
                    ? pendingJudgeHTML
                    : convertMarkdownToHTML(pendingJudgeAnswer);
                replaceChildrenFromSanitizedHtml(comparisonOutput, html);
            }
            return;
        }

        if (spinnerActive) {
            return;
        }

        // Фоллбек: показываем готовый ответ выбранной модели (как до этого было)
        const selectedEvaluator = evaluatorSelect ? evaluatorSelect.value : 'Claude';
        const outputId = selectedEvaluator.toLowerCase().replace(/\s+/g, '');
        const outputElement = document.getElementById(`output-${outputId}`);

        // Показываем секцию перед выводом, чтобы пользователь видел результат
        if (comparisonSection) {
            comparisonSection.classList.remove('hidden');
            comparisonSection.setAttribute('aria-hidden', 'false');
        }

        if (!outputElement) {
            if (comparisonOutput) {
                replaceChildrenFromHtml(
                    comparisonOutput,
                    '<p>Error: Selected model panel not found.</p>'
                );
            }
            return;
        }

        const answer = outputElement.textContent.trim();

        if (!answer || answer.startsWith("Error:")) {
            if (comparisonOutput) {
                replaceChildrenFromHtml(
                    comparisonOutput,
                    '<p>Error: No valid response from selected model.</p>'
                );
            }
            return;
        }

        // Копируем готовый ответ в секцию сравнения
        if (comparisonOutput) {
            replaceChildrenFromSanitizedHtml(comparisonOutput, convertMarkdownToHTML(answer));
        }
    });
}




    llmButtons.forEach(button => {
        const llmId = button.id.replace('llm-', '');
        const panel = document.getElementById(`panel-${llmId}`);
        if (panel) {
            panel.style.display = button.classList.contains('active') ? 'block' : 'none';
        }
        button.addEventListener('click', () => {
            button.classList.toggle('active');
            if (panel) {
                panel.style.display = button.classList.contains('active') ? 'block' : 'none';
            }
            checkCompareButtonState();
            renderDiagnosticsModal();
            notifySelectionChanged();
            syncModeratorSelectors();
            syncModeratorMiniPrompts();
            persistCrossViewUiState();
            syncProStreamVisibility();
        });
        button.addEventListener('dblclick', (event) => {
            event.preventDefault();
            toggleAllLLMs();
            syncModeratorSelectors();
            syncModeratorMiniPrompts();
            persistCrossViewUiState();
            syncProStreamVisibility();
        });
    });
    checkCompareButtonState();
    syncModeratorSelectors();
    syncModeratorMiniPrompts();
    syncProStreamVisibility();
    syncModeratorTime();
    renderDebateSessionTabs();
    applyDebateSessionFilter();
    syncDebateAutoPauseButton();

    // --- TEMPLATE FUNCTIONALITY LOGIC ---
    function updateAllLists() {
        updateSavedTemplatesList();
        updateTemplateSelect();
    }
    
    function saveTemplatesToStorage() {
        const dataToStore = { templates: savedTemplates, variables: templateVariables };
        chrome.storage.local.set({ llmComparatorTemplates: dataToStore });
    }
    
    function loadTemplatesFromStorage() {
        chrome.storage.local.get(['llmComparatorTemplates'], (result) => {
            if (result.llmComparatorTemplates) {
                const data = result.llmComparatorTemplates;
                savedTemplates = data.templates || {};
                templateVariables = data.variables || {};
                updateAllLists();
            }
        });
    }

    function showNotification(message) {
        if (notificationModal && notificationMessage) {
            notificationMessage.textContent = message;
            modalManager.show(notificationModal);
        } else {
            alert(message);
        }
    }

    if (notificationOkBtn) {
        notificationOkBtn.addEventListener('click', () => {
            modalManager.hide(notificationModal);
        });
    }

    function showConfirm(message) {
        return new Promise((resolve) => {
            if (confirmModal && confirmMessage) {
                confirmMessage.textContent = message;
                modalManager.show(confirmModal);

                const onConfirm = () => {
                    modalManager.hide(confirmModal);
                    cleanupListeners();
                    resolve(true);
                };

                const onCancel = () => {
                    modalManager.hide(confirmModal);
                    cleanupListeners();
                    resolve(false);
                };

                const cleanupListeners = () => {
                    deleteConfirmBtn.removeEventListener('click', onConfirm);
                    cancelConfirmBtn.removeEventListener('click', onCancel);
                };

                deleteConfirmBtn.addEventListener('click', onConfirm, { once: true });
                cancelConfirmBtn.addEventListener('click', onCancel, { once: true });
            } else {
                resolve(confirm(message));
            }
        });
    }
    
    function updateLivePreview() {
        let previewText = templatePrompt.value;
        variablesList.querySelectorAll('.variable-group').forEach(group => {
            const variableName = group.querySelector('.variable-name-input').value.trim();
            const labelName = group.querySelector('.variable-label-input').value.trim();
            if (variableName) {
                const placeholder = labelName ? `[${labelName}]` : `[${variableName}]`;
                previewText = previewText.replace(new RegExp(`{${variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}}`, 'g'), () => placeholder);
            }
        });
        templatePreview.textContent = previewText || 'Preview will appear here...';
    }

    const buildVariableGroup = ({ name = '', label = '' } = {}) => {
        const variableGroup = document.createElement('div');
        variableGroup.className = 'variable-group';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'variable-name-input';
        nameInput.placeholder = 'variable_name';
        nameInput.value = String(name || '');
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'variable-label-input';
        labelInput.placeholder = 'Label for User';
        labelInput.value = String(label || '');
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-variable';
        removeBtn.title = 'Remove variable';
        removeBtn.textContent = '×';
        variableGroup.appendChild(nameInput);
        variableGroup.appendChild(labelInput);
        variableGroup.appendChild(removeBtn);
        return variableGroup;
    };
    
    function clearTemplateForm() {
        templateNameInput.value = '';
        templatePrompt.value = '';
        clearNode(variablesList);
        updateLivePreview();
    }
    function openCreateTemplateModal() {
        if (!createTemplateModal) return;
        modalManager.show(createTemplateModal);
    }
    function closeCreateTemplateModal() {
        if (!createTemplateModal) return;
        modalManager.hide(createTemplateModal);
        if (templateSelect) {
            templateSelect.value = 'manual';
        }
    }
    
    function loadTemplateForEditingInModal(templateName) {
        let templatePromptText = null;
        let templateVars = null;

        // Явно ищем сначала в пользовательских шаблонах
        if (templateName in savedTemplates) {
            templatePromptText = savedTemplates[templateName];
            templateVars = templateVariables[templateName];
        // Если не нашли, ищем в системных
        } else if (templateName in systemTemplates.templates) {
            templatePromptText = systemTemplates.templates[templateName];
            templateVars = systemTemplates.variables[templateName];
        }

        if (!templatePromptText) {
            console.error(`Template "${templateName}" not found.`);
            return;
        }

        templateNameInput.value = templateName;
        templatePrompt.value = templatePromptText;
        clearNode(variablesList);
        const variables = templateVars || {};
        Object.keys(variables).forEach(varName => {
            variablesList.appendChild(buildVariableGroup({ name: varName, label: variables[varName] }));
        });
        updateLivePreview();
        openCreateTemplateModal();
    }
    
    closeModal.addEventListener('click', closeCreateTemplateModal);
    
    cancelTemplateButton.addEventListener('click', () => {
        clearTemplateForm();
        closeCreateTemplateModal();
    });
    
    if (modelSelector) {
        modelSelector.addEventListener('click', (event) => {
            if (event.target.classList.contains('model-btn')) {
                modelSelector.querySelectorAll('.model-btn').forEach(btn => btn.classList.remove('active'));
                event.target.classList.add('active');
            }
        });
    }
    
    addVariableButton.addEventListener('click', () => {
        variablesList.appendChild(buildVariableGroup());
        updateLivePreview();
    });
    
    variablesList.addEventListener('input', updateLivePreview);
    variablesList.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-variable')) {
            event.target.closest('.variable-group').remove();
            updateLivePreview();
        }
    });
    
    templatePrompt.addEventListener('input', updateLivePreview);

    saveTemplateButton.addEventListener('click', async () => {
        const templateName = templateNameInput.value.trim();
        const promptText = templatePrompt.value.trim();
        if (!templateName || !promptText) {
            showNotification('Please enter a template name and prompt.');
            return;
        }

        if (savedTemplates[templateName]) {
            const shouldOverwrite = await showConfirm(`Template "${templateName}" already exists. Overwrite it?`);
            if (!shouldOverwrite) {
                return;
            }
        }
        
        savedTemplates[templateName] = promptText;
        templateVariables[templateName] = {};
        variablesList.querySelectorAll('.variable-group').forEach(group => {
            const varName = group.querySelector('.variable-name-input').value.trim();
            const labelName = group.querySelector('.variable-label-input').value.trim();
            if (varName) {
                templateVariables[templateName][varName] = labelName;
            }
        });
        updateAllLists();
        saveTemplatesToStorage();
        showNotification(`Template "${templateName}" saved!`);
    });

    function updateSavedTemplatesList() {
        clearNode(savedTemplatesList);
        Object.keys(savedTemplates).sort().forEach(templateName => {
            const templateItem = document.createElement('li');
            templateItem.className = 'saved-template-item';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'template-name';
            nameSpan.dataset.templateName = templateName;
            nameSpan.textContent = templateName;
            const actions = document.createElement('div');
            actions.className = 'template-actions';
            const exportBtn = document.createElement('button');
            exportBtn.className = 'action-btn-icon export-template';
            exportBtn.dataset.templateName = templateName;
            exportBtn.title = 'Export this template';
            exportBtn.textContent = '⤓';
            const removeBtn = document.createElement('button');
            removeBtn.className = 'action-btn-icon remove-template';
            removeBtn.dataset.templateName = templateName;
            removeBtn.title = 'Delete this template';
            removeBtn.textContent = '×';
            actions.appendChild(exportBtn);
            actions.appendChild(removeBtn);
            templateItem.appendChild(nameSpan);
            templateItem.appendChild(actions);
            savedTemplatesList.appendChild(templateItem);
        });

        refreshCollapseContentHeight(savedTemplatesBox, savedTemplatesContent);
    }
    
    function updateSystemTemplatesList() {
        if (!systemTemplatesList) return;

        clearNode(systemTemplatesList);
        Object.keys(systemTemplates.templates).sort().forEach(templateName => {
            const templateItem = document.createElement('li');
            templateItem.className = 'saved-template-item';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'template-name';
            nameSpan.dataset.templateName = templateName;
            nameSpan.textContent = templateName;
            const actions = document.createElement('div');
            actions.className = 'template-actions';
            const exportBtn = document.createElement('button');
            exportBtn.className = 'action-btn-icon export-template';
            exportBtn.dataset.templateName = templateName;
            exportBtn.title = 'Export this template';
            exportBtn.textContent = '⤓';
            actions.appendChild(exportBtn);
            templateItem.appendChild(nameSpan);
            templateItem.appendChild(actions);
            systemTemplatesList.appendChild(templateItem);
        });

        refreshCollapseContentHeight(systemTemplatesBox, systemTemplatesContent);
    }

    savedTemplatesList.addEventListener('click', (event) => {
        const target = event.target;
        const templateName = target.closest('[data-template-name]')?.dataset.templateName;
        
        if (!templateName) return;

        if (target.closest('.remove-template')) {
            const nameForDeletion = templateName;
            showConfirm(`Are you sure you want to delete the template "${nameForDeletion}"?`).then((confirmed) => {
                if (!confirmed) return;
                delete savedTemplates[nameForDeletion];
                delete templateVariables[nameForDeletion];
                updateAllLists();
                saveTemplatesToStorage();
            });
        } else if (target.closest('.export-template')) {
            // Вызываем экспорт без второго аргумента, чтобы он использовал глобальные savedTemplates
            exportSingleTemplate(templateName);
        } else if (target.classList.contains('template-name')) {
            loadTemplateForEditingInModal(templateName);
        }
    });
    if (systemTemplatesList) {
        systemTemplatesList.addEventListener('click', (event) => {
            const target = event.target;
            const templateName = target.closest('[data-template-name]')?.dataset.templateName;

            if (!templateName) return;

            if (target.closest('.export-template')) {
                exportSingleTemplate(templateName, systemTemplates);
            } else if (target.classList.contains('template-name')) {
                loadTemplateForEditingInModal(templateName);
            }
        });
    }
    
    const judgeDefault = 'Claude';

    function sortJudgeSystemPrompts(list = []) {
        return list
            .filter((prompt) => prompt && prompt.id && prompt.text)
            .sort((a, b) => {
                const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
                const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
                if (orderA !== orderB) return orderA - orderB;
                const labelA = String(a.label || a.id || '');
                const labelB = String(b.label || b.id || '');
                return labelA.localeCompare(labelB);
            });
    }

    function updateJudgeSystemPromptOptions() {
        if (!judgeSystemPromptSelect) return;
        const orderedPrompts = sortJudgeSystemPrompts(judgeSystemPrompts);
        const currentSelection = judgeSystemPromptSelect.value;
        clearNode(judgeSystemPromptSelect);
        orderedPrompts.forEach((prompt) => {
            const option = document.createElement('option');
            option.value = prompt.id;
            option.textContent = prompt.label || prompt.id;
            option.title = prompt.label || prompt.id;
            judgeSystemPromptSelect.appendChild(option);
        });
        const fallbackSelection = orderedPrompts.find((prompt) => prompt.id === currentSelection) || orderedPrompts[0];
        if (fallbackSelection) {
            judgeSystemPromptSelect.value = fallbackSelection.id;
        }
        judgeSystemPromptSelect.disabled = orderedPrompts.length === 0;
        judgeSystemPrompts = orderedPrompts;
    }

    function updateEvaluatorOptions() {
        if (!evaluatorSelect) return;
        const currentSelection = evaluatorSelect.value || judgeDefault;
        clearNode(evaluatorSelect);
        llmNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            evaluatorSelect.appendChild(opt);
        });
        if (llmNames.includes(currentSelection)) {
            evaluatorSelect.value = currentSelection;
        } else if (llmNames.includes(judgeDefault)) {
            evaluatorSelect.value = judgeDefault;
        } else if (llmNames.length) {
            evaluatorSelect.value = llmNames[0];
        }
    }

    updateJudgeSystemPromptOptions();
    updateEvaluatorOptions();

    function updateTemplateSelect() {
        const currentSelection = templateSelect.value;
        clearNode(templateSelect);
        const manualOption = document.createElement('option');
        manualOption.value = 'manual';
        manualOption.textContent = 'Select Template...';
        const createOption = document.createElement('option');
        createOption.value = 'create';
        createOption.textContent = 'Create Template…';
        templateSelect.appendChild(manualOption);
        templateSelect.appendChild(createOption);
        Object.keys(savedTemplates).sort().forEach(template => {
            const option = document.createElement('option');
            option.value = template;
            option.textContent = template.length > 18 ? `${template.slice(0, 18)}…` : template;
            option.title = template;
            templateSelect.appendChild(option);
        });
        if (currentSelection && currentSelection !== 'create' && savedTemplates[currentSelection]) {
            templateSelect.value = currentSelection;
        } else {
            templateSelect.value = 'manual';
        }
        templateSelect.dispatchEvent(new Event('change'));
    }
    
    templateSelect.addEventListener('change', () => {
        const selectedTemplate = templateSelect.value;
        clearNode(variableInputsContainer);
        if (selectedTemplate === 'create') {
            openCreateTemplateModal();
            templateSelect.value = 'manual';
            return;
        }
        if (selectedTemplate === 'manual' || !savedTemplates[selectedTemplate]) {
            promptInput.value = '';
            promptInput.readOnly = false;
            return;
        }
        promptInput.readOnly = false;
        promptManuallyEdited = false;

        const variables = templateVariables[selectedTemplate] || {};
        
        Object.keys(variables).forEach(varName => {
            const label = document.createElement('label');
            const labelText = variables[varName] || varName;
            
            const input = document.createElement('input');
            input.type = 'text';
            input.dataset.variable = varName;
            input.placeholder = labelText;
            
            input.addEventListener('input', function() {
                this.style.width = '200px';
                
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                context.font = getComputedStyle(this).font;
                const textWidth = context.measureText(this.value || this.placeholder).width;
                
                const neededWidth = Math.min(Math.max(textWidth + 40, 200), variableInputsContainer.offsetWidth);
                this.style.width = neededWidth + 'px';
            });
            
            label.appendChild(input);
            variableInputsContainer.appendChild(label);
        });

        updatePromptFromTemplate();
    });
    
    variableInputsContainer.addEventListener('input', updatePromptFromTemplate);
    
    function updatePromptFromTemplate() {
        const selectedTemplate = templateSelect.value;
        if (selectedTemplate === 'manual' || !savedTemplates[selectedTemplate]) return;

        if (promptManuallyEdited) return;

        let promptText = savedTemplates[selectedTemplate];
        const inputs = variableInputsContainer.querySelectorAll('input[data-variable]');
        inputs.forEach(input => {
            const varName = input.dataset.variable;
            const value = input.value.trim();
            const label = templateVariables[selectedTemplate][varName] || varName;
            const placeholder = `[${label}]`;
            promptText = promptText.replace(new RegExp(`{${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}}`, 'g'), value || placeholder);
        });
        promptInput.value = promptText;
    }

function exportSingleTemplate(templateName, sourceData = null) {
        const templates = sourceData ? sourceData.templates : savedTemplates;
        const variables = sourceData ? sourceData.variables : templateVariables; // <-- ИСПРАВЛЕНА ОПЕЧАТКА
        
        if (!templates[templateName]) {
            console.error("Template not found for export:", templateName);
            return;
        }

        const singleTemplateData = {
            templates: {
                [templateName]: templates[templateName]
            },
            variables: {
                [templateName]: variables[templateName] || {}
            }
        };

        const dataStr = JSON.stringify(singleTemplateData, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Формат имени: "Prompt - Template Name" (Template Name берётся из templateName)
        const rawFileName = `Prompt - ${templateName || 'unnamed'}`;
        // Санитизация: удаляем только запрещённые символы файловой системы (/, \, :, ?, <, >, |, *, ", ')
        const safeFileName = rawFileName.replace(/[\/\\:?<>|*"']/g, '').trim();

        // Готовый файл будет иметь расширение .json
        a.download = `${safeFileName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    }

    //-- 1.1. Добавляем динамическое имя файла для экспорта всех шаблонов --//
    exportBtn.addEventListener('click', () => {
        if (Object.keys(savedTemplates).length === 0) return alert("No templates to export.");
        const dataStr = JSON.stringify({ templates: savedTemplates, variables: templateVariables }, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Формируем имя файла с датой
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
        a.download = `Prompts Templates ${dateStr}.json`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    
    importBtn.addEventListener('click', () => { importFileInput.click(); });
    
    importFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data && typeof data.templates === 'object' && typeof data.variables === 'object') {
                    const templatesToImport = data.templates;
                    const variablesToImport = data.variables || {};

                    for (const templateName in templatesToImport) {
                        if (savedTemplates[templateName]) {
                            const shouldOverwrite = await showConfirm(`Template "${templateName}" already exists. Overwrite it?`);
                            if (!shouldOverwrite) {
                                delete templatesToImport[templateName];
                                if (variablesToImport[templateName]) {
                                    delete variablesToImport[templateName];
                                }
                            }
                        }
                    }

                    Object.assign(savedTemplates, templatesToImport);
                    Object.assign(templateVariables, variablesToImport);
                    
                    updateAllLists();
                    saveTemplatesToStorage();
                    showNotification('Templates imported successfully!');
                } else {
                    showNotification('Invalid template file format.');
                }
            } catch (error) {
                console.error('Error reading or parsing file:', error);
                showNotification('Error reading or parsing file. Please ensure it is a valid JSON.');
                }
        };
        reader.readAsText(file);
        importFileInput.value = '';
    });

    // --- INITIALIZATION ---
    preserveCrossViewStateOnLoad = await consumeCrossViewNavigationIntentOnLoad();
    suppressCrossViewPersistenceOnLoad = preserveCrossViewStateOnLoad;
    if (!preserveCrossViewStateOnLoad) {
        await clearCrossViewPromptState();
    }
    await loadModifierPresets(); // <-- грузим пресеты модификаторов и рендерим список
    suppressCrossViewPersistenceOnLoad = false;
    loadTemplatesFromStorage();
    loadSystemTemplates();
    setTimeout(() => {
        restoreCrossViewUiState().catch((err) => console.warn('[RESULTS] Failed to restore cross-view UI state', err));
    }, 0);
    setTimeout(() => {
        restoreCrossViewUiState().catch((err) => console.warn('[RESULTS] Failed to restore delayed cross-view UI state', err));
    }, 250);


    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) {
                fileNameDisplay.textContent = 'No file attached';
                attachedFileContent = '';
                return;
            }

            fileNameDisplay.textContent = `File: ${file.name}`;
            const reader = new FileReader();

            // --- ОБРАБОТКА ПРОСТЫХ ТЕКСТОВЫХ ФАЙЛОВ ---
            if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.js') || file.name.endsWith('.json')) {
                reader.onload = (e) => {
                    attachedFileContent = e.target.result;
                    showNotification(`Text file "${file.name}" loaded successfully.`);
                };
                reader.onerror = () => {
                    showNotification(`Error reading file: ${file.name}`);
                    attachedFileContent = '';
                };
                reader.readAsText(file);
            } 
            // --- ЗАГЛУШКИ ДЛЯ БУДУЩЕЙ РАБОТЫ С PDF/DOCX ---
            else if (file.name.endsWith('.pdf')) {
                 showNotification('PDF parsing is not implemented yet. Please add a library like PDF.js.');
                 attachedFileContent = '';
            } else if (file.name.endsWith('.docx')) {
                 showNotification('DOCX parsing is not implemented yet. Please add a library like Mammoth.js.');
                 attachedFileContent = '';
            } 
            else {
                showNotification(`Unsupported file type: ${file.type}`);
                fileNameDisplay.textContent = 'Unsupported file';
                attachedFileContent = '';
            }
        });
    }
// --- V2.0 START: API Keys Modal Logic ---
    const apiKeysModal = document.getElementById('api-keys-modal');
    const openApiKeysBtn = document.getElementById('open-api-keys-btn');
    const closeApiKeysModal = document.getElementById('close-api-keys-modal');
    const saveApiKeysBtn = document.getElementById('save-api-keys');
    
    const apiKeyInputs = {
        openai: document.getElementById('api-key-openai'),
        anthropic: document.getElementById('api-key-anthropic'),
        google: document.getElementById('api-key-google'),
        grok: document.getElementById('api-key-grok'),
        lechat: document.getElementById('api-key-lechat'),
        qwen: document.getElementById('api-key-qwen'),
        deepseek: document.getElementById('api-key-deepseek'),
        perplexity: document.getElementById('api-key-perplexity')
    };
    const apiKeyStorageMap = {
        openai: 'apiKey_openai',
        anthropic: 'apiKey_anthropic',
        google: 'apiKey_google',
        grok: 'apiKey_grok',
        lechat: 'apiKey_lechat',
        qwen: 'apiKey_qwen',
        deepseek: 'apiKey_deepseek',
        perplexity: 'apiKey_perplexity'
    };

    const devtoolsTabs = Array.from(document.querySelectorAll('.devtools-tab'));
    const devtoolsPanels = Array.from(document.querySelectorAll('.devtools-tabpanel'));
    const DEFAULT_DEVTOOLS_TAB_ID = 'telemetry-tabpanel';
    let activeDevtoolsTabId = devtoolsTabs.find(tab => tab.classList.contains('is-active'))?.dataset.tabTarget ||
        devtoolsPanels[0]?.id || DEFAULT_DEVTOOLS_TAB_ID;

    const setActiveDevtoolsTab = (targetId) => {
        try {
            if (!targetId || !devtoolsTabs.length || !devtoolsPanels.length) return;
            activeDevtoolsTabId = targetId;
            devtoolsTabs.forEach((tab) => {
                try {
                    const isActive = tab.dataset.tabTarget === targetId;
                    tab.classList.toggle('is-active', isActive);
                    tab.setAttribute('aria-selected', String(isActive));
                    tab.tabIndex = isActive ? 0 : -1;
                } catch (err) { console.error('[results] error updating devtools tab state', err); }
            });
            devtoolsPanels.forEach((panel) => {
                try {
                    const isActive = panel.id === targetId;
                    panel.classList.toggle('is-active', isActive);
                    if (isActive) {
                        panel.removeAttribute('hidden');
                    } else {
                        panel.setAttribute('hidden', '');
                    }
                } catch (err) { console.error('[results] error updating devtools panel state', err); }
            });
            if (targetId === DEFAULT_DEVTOOLS_TAB_ID) {
                syncDevtoolsPanelHeight();
            }
            if (typeof CustomEvent !== 'undefined') {
                document.dispatchEvent(new CustomEvent('devtools-tab-change', { detail: { targetId } }));
            }
        } catch (err) {
            console.error('[results] setActiveDevtoolsTab top-level error', err);
        }
    };

    if (devtoolsTabs.length && devtoolsPanels.length) {
        devtoolsTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                setActiveDevtoolsTab(tab.dataset.tabTarget);
            });
            tab.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const currentIndex = devtoolsTabs.indexOf(tab);
                const offset = event.key === 'ArrowLeft' ? -1 : 1;
                const nextIndex = (currentIndex + offset + devtoolsTabs.length) % devtoolsTabs.length;
                devtoolsTabs[nextIndex].focus();
                setActiveDevtoolsTab(devtoolsTabs[nextIndex].dataset.tabTarget);
            });
        });
    }
    debateSessionTabs?.addEventListener('click', (event) => {
        const tab = event.target.closest('.debate-session-tab');
        if (!tab) return;
        if (event.detail > 1) return;
        if (debateSessionClickTimer) clearTimeout(debateSessionClickTimer);
        const sessionId = tab.dataset.sessionId || '1';
        debateSessionClickTimer = setTimeout(() => {
            debateSessionClickTimer = null;
            setActiveDebateSession(sessionId, { favoriteOnly: false });
        }, DEBATE_SESSION_CLICK_DELAY_MS);
    });
    debateSessionTabs?.addEventListener('dblclick', (event) => {
        const tab = event.target.closest('.debate-session-tab');
        if (!tab) return;
        event.preventDefault();
        if (debateSessionClickTimer) {
            clearTimeout(debateSessionClickTimer);
            debateSessionClickTimer = null;
        }
        const sessionId = String(tab.dataset.sessionId || '1');
        debateTabsState.activeSessionId = ensureDebateSession(sessionId).id;
        setDebateSessionFavoriteOnly(sessionId, true);
        renderDebateSessionTabs();
        applyDebateSessionFilter();
    });
    debateSessionAddBtn?.addEventListener('click', () => addDebateSession());
    debateSessionDeleteBtn?.addEventListener('click', () => removeDebateSession());
    debateAutoPauseBtn?.addEventListener('click', () => {
        setDebatePausedState(!debatePaused, 'auto_pause_button');
    });
    debateSessionCopyBtn?.addEventListener('click', async () => {
        const html = collectDebateFeedHtml();
        const text = collectDebateFeedText();
        if (!html && !text) return;
        try {
            await writeRichContentToClipboard({ text, html });
        } catch (err) {
            console.warn('[RESULTS] debate feed copy failed', err);
        }
    });
    debateSessionClearBtn?.addEventListener('click', () => {
        clearDebateFeed();
        setDebateApprovalCandidate(null);
        applyDebateSessionFilter();
    });
    debateModelCards?.addEventListener('click', async (event) => {
        const approvalCheck = event.target.closest('.debate-approval-check');
        if (approvalCheck) {
            const card = approvalCheck.closest('.debate-model-card');
            approveDebateCard(card);
            return;
        }
        const favBtn = event.target.closest('.debate-fav');
        const card = event.target.closest('.debate-model-card');
        if (!card) return;

        if (favBtn) {
            const starred = card.dataset.starred === 'true';
            patchDebateCardMessage(card, { starred: !starred });
            applyDebateSessionFilter();
            return;
        }
        if (event.target.closest('.debate-card-show-more')) {
            setDebateCardExpanded(card, true);
            return;
        }

        const outputEl = card.querySelector('.debate-model-card-output');
        const text = outputEl?.innerText?.trim() || '';
        const html = outputEl?.innerHTML?.trim() || '';

        if (event.target.closest('.debate-card-copy')) {
            if (!text && !html) return;
            try { await writeRichContentToClipboard({ text, html }); } catch (err) { console.warn(err); }
            return;
        }
        if (event.target.closest('.debate-card-export')) {
            return;
        }
        if (event.target.closest('.debate-card-delete')) {
            removeDebateCardMessage(card);
            card.remove();
            applyDebateSessionFilter();
            return;
        }
        if (event.target.closest('.debate-card-branch')) {
            const modelName = card.dataset.llmName || '';
            if (debateSenderSelect && modelName) {
                const hasModel = Array.from(debateSenderSelect.options).some((opt) => opt.value === modelName);
                if (hasModel) debateSenderSelect.value = modelName;
            }
            if (promptInput && isModeratorTextarea) {
                promptInput.value = text;
                autoGrowDebateTextarea(promptInput);
                promptInput.focus();
            }
        }
    });
    debateModelCards?.addEventListener('dblclick', (event) => {
        const nameEl = event.target.closest('.debate-model-card-name');
        if (!nameEl) return;
        const card = nameEl.closest('.debate-model-card');
        if (!card || !debateModelCards.contains(card)) return;
        event.preventDefault();
        setDebateCardExpanded(card, card.dataset.expanded !== 'true');
    });
    debateModelCards?.addEventListener('change', (event) => {
        const approvalCheck = event.target.closest?.('.debate-approval-check');
        if (!approvalCheck || !approvalCheck.checked) return;
        const card = approvalCheck.closest('.debate-model-card');
        approveDebateCard(card);
    });
    debateRoleSelect?.addEventListener('change', () => {
        syncModeratorMiniPrompts();
        const roleText = debateRoleSelect.value || '';
        if (promptInput && roleText) {
            promptInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    debateSenderSelect?.addEventListener('change', syncDirectionIcon);
    debateReceiverSelect?.addEventListener('change', syncDirectionIcon);
    debateRoleSelect?.addEventListener('change', syncDirectionIcon);
    debateDirectionIcon?.addEventListener('click', () => {
        debateDirectionState.mode = debateDirectionState.mode === 'forward'
            ? 'reverse'
            : debateDirectionState.mode === 'reverse'
                ? 'all'
                : 'forward';
        syncDirectionIcon();
    });
    syncDirectionIcon();
    debateActionSelect?.addEventListener('change', syncModeratorMiniPrompts);
    debateModeSelect?.addEventListener('change', syncModeratorMiniPrompts);
    debateLengthSelect?.addEventListener('change', syncModeratorMiniPrompts);
    debateModSendBtn?.addEventListener('click', triggerPipelineRun);
    debateModCopyBtn?.addEventListener('click', async () => {
        const text = debateModMessageBody?.innerText?.trim() || promptInput?.value?.trim() || '';
        const html = debateModMessageBody?.innerHTML?.trim() || escapeHtml(promptInput?.value?.trim() || '');
        if (!text && !html) return;
        try { await writeRichContentToClipboard({ text, html }); } catch (err) { console.warn(err); }
    });
    debateModExportBtn?.addEventListener('click', () => {
        const body = debateModMessageBody?.innerHTML?.trim() || escapeHtml(promptInput?.value?.trim() || '');
        if (!body) return;
        const blob = new Blob([`<!doctype html><html><body>${body}</body></html>`], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `moderator_${formatPipelineTimestamp()}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    });
    debateModClearBtn?.addEventListener('click', () => {
        clearModeratorComposer();
    });
    debateSelToolbar?.addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn) return;
        event.preventDefault();
        const color = btn.dataset.color || '';
        const cmd = btn.dataset.cmd || '';
        if (color) {
            applyDebateSelectionStyle('hiliteColor', color);
            return;
        }
        if (cmd) {
            applyDebateSelectionStyle(cmd);
            return;
        }
        if (btn.dataset.fav) {
            promoteDebateSelectionToFavorite();
        }
    });
    document.addEventListener('mouseup', (event) => {
        if (event.target?.closest?.(`#${responseSelectionToolbarId}`)) return;
        const target = event.target?.closest?.('.llm-panel .output');
        if (!target || target.id === favoriteOutputId) {
            hideResponseSelectionToolbar();
            return;
        }
        requestAnimationFrame(() => showResponseSelectionToolbar(target));
    });
    document.addEventListener('mousedown', (event) => {
        if (event.target?.closest?.(`#${responseSelectionToolbarId}`)) return;
        if (!event.target?.closest?.('.llm-panel .output')) {
            hideResponseSelectionToolbar();
        }
    });
    document.addEventListener('click', (event) => {
        const toolbar = event.target?.closest?.(`#${responseSelectionToolbarId}`);
        if (!toolbar) return;
        const btn = event.target.closest('button');
        if (!btn) return;
        event.preventDefault();
        const color = btn.dataset.color || '';
        const cmd = btn.dataset.cmd || '';
        if (color) {
            applyResponseSelectionStyle('hiliteColor', color);
            return;
        }
        if (cmd) {
            applyResponseSelectionStyle(cmd);
            return;
        }
        if (btn.dataset.fav) {
            const text = getResponseSelectionText();
            const html = getResponseSelectionHtml();
            const sourceCard = responseSelectionState.target?.closest?.('.llm-panel') || null;
            if (addFavoriteFragmentFromSelection({ sourceCard, text, html })) {
                hideResponseSelectionToolbar();
                window.getSelection?.()?.removeAllRanges?.();
            }
        }
    });
    document.addEventListener('mouseup', (event) => {
        if (event.target?.closest?.('#debateSelTb')) return;
        const target = event.target?.closest?.('.debate-model-card-output, #mod-message-body');
        if (!target) {
            hideDebateSelectionToolbar();
            return;
        }
        requestAnimationFrame(() => showDebateSelectionToolbar(target));
    });
    document.addEventListener('mousedown', (event) => {
        if (event.target?.closest?.('#debateSelTb')) return;
        if (!event.target?.closest?.('.debate-model-card-output, #mod-message-body')) {
            hideDebateSelectionToolbar();
        }
    });
    if (promptInput && isModeratorTextarea) {
        autoGrowDebateTextarea(promptInput);
        promptInput.addEventListener('input', () => autoGrowDebateTextarea(promptInput));
    }
    autoGrowDebateApprovalBody();
    if (devtoolsTabs.length && devtoolsPanels.length) {
        setActiveDevtoolsTab(activeDevtoolsTabId || DEFAULT_DEVTOOLS_TAB_ID);
    }
    const ensureTelemetryDevtoolsLoaded = () => {
        if (window.__DEVTOOLS_TELEMETRY_READY__) return;
        const existing = document.querySelector('script[data-telemetry-devtools]');
        if (existing) return;
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('results-devtools.js');
        script.dataset.telemetryDevtools = 'true';
        document.head.appendChild(script);
    };
    setTimeout(ensureTelemetryDevtoolsLoaded, 0);
    setTimeout(ensureTelemetryDevtoolsLoaded, 1000);
    window.addEventListener('resize', () => {
        syncDevtoolsPanelHeight();
    });

    if (apiKeysModal && closeApiKeysModal && saveApiKeysBtn) {
        const loadSessionApiKeys = async () => {
            await Promise.all(Object.entries(apiKeyInputs).map(async ([key, input]) => {
                if (!input) return;
                const storageKey = apiKeyStorageMap[key];
                if (!storageKey) return;
                let value = await ApiKeyStorage.getSessionKey(storageKey);
                if (!value) {
                    value = await ApiKeyStorage.getLegacyKey(storageKey);
                }
                input.value = value || '';
            }));
        };

        const saveSessionApiKeys = async () => {
            const tasks = [];
            Object.entries(apiKeyInputs).forEach(([key, input]) => {
                if (!input) return;
                const storageKey = apiKeyStorageMap[key];
                if (!storageKey) return;
                const trimmed = input.value.trim();
                if (trimmed) {
                    tasks.push(ApiKeyStorage.setSessionKey(storageKey, trimmed));
                    tasks.push(ApiKeyStorage.clearLegacyKey(storageKey));
                } else {
                    tasks.push(ApiKeyStorage.clearSessionKey(storageKey));
                    tasks.push(ApiKeyStorage.clearLegacyKey(storageKey));
                }
            });
            await Promise.all(tasks);
        };

        const openDevtoolsModal = async () => {
            setActiveDevtoolsTab(DEFAULT_DEVTOOLS_TAB_ID);
            diagnosticsExpanded = true;
            applyDiagnosticsExpandState();
            refreshActiveSelectorSnapshot();
            refreshSelectorAudit();
            requestSelectorHealthSummary(true);
            // Загружаем ключи при открытии
            await loadSessionApiKeys();
            modalManager.show(apiKeysModal);
            syncDevtoolsPanelHeight();
        };

        if (telemetryToggleBtn) {
            telemetryToggleBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openDevtoolsModal().catch((err) => {
                    console.error('[results] openDevtoolsModal error', err);
                });
            });
        }

        if (openApiKeysBtn) {
            openApiKeysBtn.addEventListener('click', () => openDevtoolsModal().catch((err) => {
                console.error('[results] openDevtoolsModal error', err);
            }));
        }

        try {
            document.addEventListener('dblclick', (event) => {
                const indicator = event.target?.closest?.('.api-indicator');
                if (!indicator) return;
                event.preventDefault();
                event.stopPropagation();
                openDevtoolsModal().catch((err) => console.error('[results] openDevtoolsModal error', err));
            }, true);

            document.addEventListener('dblclick', (event) => {
                const logoTrigger = event.target?.closest?.('.logo-icon, .logo-version');
                if (!logoTrigger) return;
                event.preventDefault();
                event.stopPropagation();
                openDevtoolsModal().catch((err) => console.error('[results] openDevtoolsModal error', err));
            }, true);

            document.addEventListener('keydown', (event) => {
                const indicator = event.target?.closest?.('.api-indicator');
                if (!indicator) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openDevtoolsModal().catch((err) => console.error('[results] openDevtoolsModal error', err));
            }, true);

            if (closeApiKeysModal && modalManager && typeof modalManager.hide === 'function') {
                closeApiKeysModal.addEventListener('click', () => {
                    try { modalManager.hide(apiKeysModal); } catch (err) { console.error('[results] modalManager.hide error', err); }
                });
            }

            if (saveApiKeysBtn) {
                saveApiKeysBtn.addEventListener('click', () => {
                    saveSessionApiKeys()
                        .then(() => {
                            try { showNotification('API Keys saved in session storage (cleared on restart).'); } catch (_) {}
                            try { modalManager && modalManager.hide && modalManager.hide(apiKeysModal); } catch (err) { console.error('[results] modalManager.hide after save error', err); }
                        })
                        .catch((err) => {
                            console.error('[results] saveSessionApiKeys error', err);
                        });
                });
            }

            document.addEventListener('dblclick', (event) => {
                const indicator = event.target?.closest?.('.status-indicator');
                if (!indicator) return;
                const llmName = indicator.dataset.llmName;
                if (!llmName) return;
                event.preventDefault();
                event.stopPropagation();
                clearTimeout(statusIndicatorClickTimers[llmName]);
                delete statusIndicatorClickTimers[llmName];
                triggerManualPing(llmName, indicator, { source: 'status_indicator_dblclick' });
            }, true);

            document.addEventListener('keydown', (event) => {
                const indicator = event.target?.closest?.('.status-indicator');
                if (!indicator) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const llmName = indicator.dataset.llmName;
                if (!llmName) return;
                event.preventDefault();
                event.stopPropagation();
                triggerManualPing(llmName, indicator, { source: 'status_indicator_keyboard' });
            }, true);
        } catch (err) {
            console.error('[results] modal wiring top-level error', err);
        }
    }
    // --- V2.0 END: API Keys Modal Logic ---
	});
const pipelineExportFlash = (button, state) => {
    try {
        window.ResultsShared?.flashButtonFeedback?.(button, state);
    } catch (_) {}
};

const pipelineExportStamp = () => {
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
};

const pipelineExportEscape = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const pipelineExportDownloadHtml = (filename, htmlContent) => {
    const content = String(htmlContent || '').trim();
    if (!content) return false;
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return true;
};

const pipelineExportCardParts = (card) => {
    const outputEl = card?.querySelector?.('.debate-model-card-output');
    const rawHtml = outputEl ? String(outputEl.innerHTML || '').trim() : '';
    const text = outputEl ? String(outputEl.innerText || outputEl.textContent || '').trim() : '';
    const body = rawHtml || (text ? `<pre>${pipelineExportEscape(text)}</pre>` : '');
    if (!body) return null;
    return {
        model: String(card.dataset.llmName || card.querySelector('.debate-model-card-name')?.textContent || 'Model').trim() || 'Model',
        time: String(card.querySelector('.debate-model-card-time')?.textContent || '').trim(),
        body
    };
};

const pipelineExportHeading = ({ model, time }, tag = 'h2') => (
    `<${tag}>${pipelineExportEscape(model)}${time ? ` <span class="response-time">${pipelineExportEscape(time)}</span>` : ''}</${tag}>`
);

const pipelineExportSection = (card) => {
    const parts = pipelineExportCardParts(card);
    if (!parts) return '';
    return `
        <section>
            ${pipelineExportHeading(parts, 'h2')}
            <div class="response-body">${parts.body}</div>
        </section>
    `;
};

const pipelineExportDocument = (title, bodyHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${pipelineExportEscape(title)}</title>
    <style>
        body { font-family: Arial, sans-serif; background: #ffffff; color: #111; padding: 24px; line-height: 1.5; }
        section { margin-bottom: 24px; }
        h1 { font-size: 24px; margin: 0 0 16px; }
        h2 { margin: 0 0 12px; font-size: 20px; }
        pre { background: #f6f8fa; padding: 12px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; }
        .response-body { background: #f8fafc; padding: 12px; border-radius: 8px; }
        .response-body table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .response-body th, .response-body td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
        .response-body ul, .response-body ol { padding-left: 24px; }
        .response-time { color: #555; font-size: 14px; font-weight: 400; }
    </style>
</head>
<body>
    <h1>${pipelineExportEscape(title)}</h1>
    ${bodyHtml}
</body>
</html>`;

const pipelineExportCollectFeedHtml = () => {
    const feed = document.getElementById('debate-model-cards');
    if (!feed) return '';
    const activeSessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId || '1';
    return Array.from(feed.querySelectorAll('.debate-model-card'))
        .filter((card) => card.dataset.sessionId === activeSessionId && card.style.display !== 'none')
        .map((card) => pipelineExportSection(card))
        .filter(Boolean)
        .join('\n');
};

document.addEventListener('click', (event) => {
    const btn = event.target.closest('#debate-session-export-btn');
    if (!btn) return;
    try {
        const body = pipelineExportCollectFeedHtml();
        if (!body) {
            pipelineExportFlash(btn, 'warn');
            return;
        }
        const html = pipelineExportDocument('Debate Feed', body);
        const ok = pipelineExportDownloadHtml(`debate_feed_${pipelineExportStamp()}.html`, html);
        pipelineExportFlash(btn, ok ? 'success' : 'error');
    } catch (err) {
        console.warn('[RESULTS] debate feed export failed', err);
        pipelineExportFlash(btn, 'error');
    }
});

document.addEventListener('click', (event) => {
    const btn = event.target.closest('.debate-card-export');
    if (!btn) return;
    try {
        const parts = pipelineExportCardParts(btn.closest('.debate-model-card'));
        if (!parts) {
            pipelineExportFlash(btn, 'warn');
            return;
        }
        const doc = pipelineExportDocument(
            `${parts.model} Response`,
            `<section>${pipelineExportHeading(parts, 'h2')}<div class="response-body">${parts.body}</div></section>`
        );
        const ok = pipelineExportDownloadHtml(`debate_card_${pipelineExportStamp()}.html`, doc);
        pipelineExportFlash(btn, ok ? 'success' : 'error');
    } catch (err) {
        console.warn('[RESULTS] debate card export failed', err);
        pipelineExportFlash(btn, 'error');
    }
});

//-- 3.1. Добавляем обработчик для новой кнопки закрытия панели сравнения --//
document.addEventListener('click', (event) => {
    // Ищем кнопку закрытия по её ID
    const closeBtn = event.target.closest('#close-comparison-btn');
    if (!closeBtn) return; // Если клик был не по кнопке, ничего не делаем

    // Находим родительскую секцию, которую нужно скрыть
    const sectionToClose = document.getElementById('comparison-section');
    if (sectionToClose) {
        sectionToClose.classList.add('hidden'); // Добавляем класс, который делает её невидимой
        sectionToClose.setAttribute('aria-hidden', 'true');
    }
});

} // end guard __RESULTS_PAGE_LOADED
