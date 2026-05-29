# Claude + Grok: full response capture fix (2026-02-16)

## Problem
- Claude sometimes returned only the last phrase of the answer.
- Grok sometimes returned unrelated snippets (for example, short UI fragments) instead of the full assistant answer.

## Root cause
- Too-fragile selectors (deep structural chains, unstable utility classes, `nth-*` dependencies).
- Overly generic fallbacks (`.prose` etc.) were reached too early and could match non-target blocks.
- Missing explicit "latest assistant answer" targeting.
- Response selectors and `observationDefaults.targetSelectors` were not fully aligned.

## Solution summary
1. Replace brittle selectors with stable assistant-message anchored selectors.
2. For Claude: force targeting of the **last assistant response** (`data-is-response="true":last-of-type` + conversation-turn assistant anchors).
3. For Claude: explicitly exclude reasoning/thinking blocks with `:not([data-testid*="thinking" i]...)` filters.
4. For Grok: prioritize message-bubble / explicit response containers (`response-content-markdown`, `data-testid*="response"`) before generic selectors.
5. Keep backward compatibility via fallback selectors.
6. Sync response selectors into `observationDefaults.targetSelectors`.

## Affected files
- `selectors/claude.config.js`
- `selectors/grok.config.js`
- then rebuild bundles: `npm run build:bundles`

## Validation checklist
- Claude response returns complete answer text, not tail fragment.
- Grok response returns full assistant answer, not UI snippet.
- No regression for composer/sendButton matching.

## Notes
- This patch intentionally keeps old fallback paths to reduce breakage risk.
- If your branch diverged, apply with `git apply --reject` and resolve rejected hunks manually using the final selector blocks from this patch.

## 2026-02-28 09:33 (v2.72.85) - Runtime extraction hardening
- Why: selectors in `selectors/*.config.js` were correct, but runtime extraction could still pick short/non-target nodes because of broad fallback paths in content scripts.
- Change 1: tightened Claude/Grok `lastMessage` and `streamStart` selectors in `content-scripts/answer-pipeline-selectors.js` to prioritize explicit assistant response containers and reduce generic selector influence.
- Change 2: added quality-based candidate scoring in Grok DOM extraction (`content-scripts/content-grok.js`, `grabLatestAssistantText`) to prefer high-confidence assistant/response nodes over merely latest DOM nodes.
- Change 3: narrowed Claude primary DOM fallback selectors in `content-scripts/content-claude.js` to `:last-of-type` assistant targets; removed generic `.prose`/`main article` from primary path.
- Change 4: adjusted selector merge priority in `selectors-config.js` so `response` keeps versioned selectors ahead of manual/remote overrides (manual list remains applied as fallback).
