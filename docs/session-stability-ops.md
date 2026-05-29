# Операционный план по стабилизации сессий/таймеров/фокуса (LLM_Codex)

Версия: 2.71.79  
Дата: 2026-01-30 22:05

## Цель
Собрать выдержанный чеклист для слабой модели или следующего исполнителя, чтобы ключевые изменения (фокус + таймеры) могли быть реализованы и проверены без потери контекста.

## 1. Фокус (пункт 3.4/3.5 из основного плана)
1.1. Открой `content-scripts/content-utils.js`:
   - Убедись, что `requestFocusFromBackground` спускается только когда `storedSessionId` и `hasActiveRequest()` возвращают `true`.
   - Компоненты `startActiveRequest`/`stopActiveRequest` должны вызываться перед отправкой `GET_ANSWER` и в `.finally`, чтобы счётчик возвращался к нулю сразу после ответа.
1.2. Перечисли все адаптеры `content-scripts/content-*.js` и проверь, что `window.ContentUtils?.startActiveRequest` вызывается сразу перед `injectAndGetResponse` (или аналогом), а `stopActiveRequest` — в `.finally`/`release`.
1.3. Поиск `requestFocusFromBackground` по проекту должен возвращать только `content-scripts/content-utils.js`. Если появится новая связь, вставь вызов `window.ContentUtils?.startActiveRequest` в начало активного запроса и `stopActiveRequest` при завершении.
1.4. Никакие `visibilitychange` обработчики в адаптерах не должны вызывать `ContentUtils.requestFocusFromBackground` напрямую — вместо этого полагайся на унифицированную обработку внутри `content-utils`.
1.5. HumanSessionController больше не делает hard stop только из‑за `document.hidden` (чтобы completion watcher работал без ручных визитов). Если нужно вернуть старое поведение — передай `expireOnHidden: true` в `streaming.humanSession` конфиг.

## 2. Таймеры (пункт 1.9 из основного плана)
2.1. `background/job-orchestrator.js`:
   - `registerSessionTimer` добавляет запись в `sessionTimerMetadata` с `stack` и временем, чтобы потом можно было понять, что не успел выйти.
   - `clearSessionTimers` перед очисткой логирует предупреждение с количеством таймеров и примерами стеков (первые 8), затем очищает оба реестра.
2.2. Любой новый `setTimeout`/`setInterval` в `background/dispatch-coordinator.js`, `background/message-router.js`, `background/health-monitor.js` и других модулях обязан использовать `registerSessionTimer`/`deregisterSessionTimer`, чтобы `clearSessionTimers` видел его.
2.3. Если `registerSessionTimer` вызывается из `sessionTimerManager`, но без явного `deregister`, допиши `self.deregisterSessionTimer` вызов в коллбеке/`finally`.

## 3. Проверка (раздел 6 плана)
3.1. Запусти stop→start сценарий: быстро повтори `stopAllProcesses()` → `startJob()` (или перезапусти расширение), параллельно слушая логи `[HEALTH-CHECK]`/`[DISPATCH]`.
   - Ожидается, что `clearSessionTimers` выдаст warning только если что-то осталось; в норме предупреждение не появляется, а `sessionTimerMetadata` остаётся пустым.
   - Логи `[DISPATCH]` и `[HEALTH-CHECK]` не должны фиксировать повторное выполнение старых таймеров.
3.2. Проанализируй `chrome.runtime` сообщения `NEED_FOCUS`: каждое должно приходить только при `hasActiveRequest` (проверить метаданные, если нужно).
3.3. После проверки обнови документ `docs/session-stability-plan.md` и `docs/session-stability-ops.md`, записав дату, версию и короткое описание проверки.

## 4. Что делать дальше (по минимуму)
4.1. `SESSION_EXPIRED` уже перехватывается в `content-scripts/content-utils.js`: ContentUtils выставляет `__SESSION_EXPIRED__`, вызывает `humanSessionController.forceHardStop`, сбрасывает `activeRequestCount` и глушит `requestFocusFromBackground`, когда background отказывает в `NEED_FOCUS`. При добавлении новых адаптеров достаточно полагаться на этот хендлер и не дублировать логику.
4.2. `TabManager.getBoundTabId` теперь использует ограниченный recovery-fallback: `markFallbackBinding` копирует `entry.tabId` в `TabMapManager`, очищает поле в jobState и запрещает повторное fallback через `fallbackRecoveryUsed`. Запомни это при работе с `tabId`, чтобы fallback не превратился в регулярный источник.
4.3. `PROMPT_SUBMITTED` теперь должен нести `sessionId` (через `ContentUtils.ensureDispatchMeta`), а `dispatchSource/submitSource` отделяют UI‑confirm от API/inferred — не используй `messageSent` как UI‑истину.
4.4. SPA‑навигация и invalidation расширения теперь вызывают cleanup через `ContentUtils` — при добавлении новых адаптеров регистрируй `__cleanup_<llm>` и полагайся на общий guard.
4.5. Документируй шаги в customer-facing notes (см. `docs/change-log-codex.md` для версий 2.71.35–2.71.38), чтобы команда знала про новые focus Guards, `SESSION_EXPIRED`, ограниченный fallback, dispatch/meta guard и SPA/Context cleanup.

## 5. Контроль версий
5.1. После любых изменений обнови `manifest.json` (сейчас 2.71.38) и добавь запись с датой/временем в `docs/session-stability-plan.md`, чтобы было видно, кто и когда делал шаг.
