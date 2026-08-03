import { INTERNAL_STATES, MASTER_STATE } from './states.js';
import {
    setExtensionPrompt,
    getExtensionPrompt,
    extension_prompts,
    extension_prompt_types,
    extension_prompt_roles,
    eventSource,
    event_types,
    chat_metadata,
    saveChatDebounced,
} from '../../../../script.js';

(function () {
    'use strict';

    const MODULE_NAME = 'internal_states';
    const INJECTION_DEPTH = 4;
    const INJECTION_POSITION = extension_prompt_types.IN_CHAT;
    const INJECTION_ROLE = extension_prompt_roles.SYSTEM;
    const HIDDEN_STATES_REGEX = /<!-- GFX_START -->\s*<internal_states>[\s\S]*?<!-- GFX_END -->|<internal_states>[\s\S]*?<\/internal_states>/gi;

    let extension_settings;
    let saveSettingsDebounced;
    let windowCreated = false;
    let statesPopupCreated = false;
    let settingsWindowCreated = false;
    let promptPreviewCreated = false;
    let lastParseInfo = { time: null, status: 'none' };

    function getBaseUrl() {
        const scripts = document.querySelectorAll('script[src*="index.js"]');
        for (const script of scripts) {
            if (script.src.includes('InternalStates')) {
                return script.src.split('/').slice(0, -1).join('/');
            }
        }
        return '/scripts/extensions/third-party/SillyTavern-InternalStates';
    }

    const BASE_URL = getBaseUrl();

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getDefaultStateMap() {
        const map = {};
        for (const state of INTERNAL_STATES) {
            map[state.id] = !!state.defaultEnabled;
        }
        return map;
    }

    function getCustomStates() {
        return extension_settings.internal_states.custom_states || [];
    }

    function getAllStateDefs() {
        const builtIns = INTERNAL_STATES.map(state => ({ ...state, isCustom: false }));
        const customs = getCustomStates().map(state => ({ ...state, isCustom: true }));
        return [...builtIns, ...customs];
    }

    function getStatePrompt(id) {
        const overrides = extension_settings.internal_states.prompts;
        if (overrides[id]) {
            return overrides[id];
        }
        if (id === MASTER_STATE.id) {
            return MASTER_STATE.prompt || '';
        }
        const custom = getCustomStates().find(state => state.id === id);
        if (custom) {
            return custom.prompt || '';
        }
        const builtIn = INTERNAL_STATES.find(state => state.id === id);
        return builtIn ? builtIn.prompt || '' : '';
    }

    function getCleanupPrompt(state) {
        const vars = state.cleanupVars;
        if (!vars || vars.length === 0) {
            return '';
        }
        return vars.map(name => '{{deletevar::' + name + '}}').join('');
    }

    function updateStatus() {
        if (!extension_settings?.internal_states) {
            return;
        }
        const enabled = !!extension_settings.internal_states.enabled;
        const registered = Object.keys(extension_prompts).filter(key => key.startsWith('internal_state'));
        const enabledCount = getEnabledStates().length;
        const totalCount = getAllStateDefs().length;
        const master = extension_prompts['internal_states_master'];
        const masterInfo = master ? (master.value?.length ?? 0) + 'c' : 'missing';
        const text = 'Enabled: ' + (enabled ? 'ON' : 'OFF') + ' · states ' + enabledCount + '/' + totalCount + ' · registered ' + registered.length + ' · master ' + masterInfo;

        const panelStatus = document.getElementById('internal_states_status');
        if (panelStatus) {
            panelStatus.textContent = text;
        }
        const footer = document.getElementById('internal-states-footer');
        if (footer) {
            footer.textContent = text;
        }
    }

    function getState() {
        if (!chat_metadata.internalStates || typeof chat_metadata.internalStates !== 'object' || Array.isArray(chat_metadata.internalStates)) {
            chat_metadata.internalStates = { version: 1, modules: {}, world: {} };
        }
        return chat_metadata.internalStates;
    }

    function getMasterPrompt() {
        const base = getStatePrompt(MASTER_STATE.id);
        let stateText = '{}';
        try {
            stateText = JSON.stringify(getState());
        } catch { /* fall back to empty object */ }
        return base + '\n\nCURRENT INTERNAL STATE JSON (persisted state from last turn):\n' + stateText;
    }

    function applyExtensionPrompts() {
        if (!extension_settings?.internal_states) {
            console.debug('Internal States: applyExtensionPrompts skipped (settings not ready)', new Error('trace').stack);
            return;
        }
        const enabled = !!extension_settings.internal_states.enabled;
        console.debug('Internal States: applyExtensionPrompts(enabled=' + enabled + ')', new Error('trace').stack);
        const before = Object.keys(extension_prompts).filter(key => key.startsWith('internal_state')).sort().join(',');
        const masterKey = 'internal_states_master';
        if (!enabled) {
            delete extension_prompts[masterKey];
            for (const state of getAllStateDefs()) {
                delete extension_prompts['internal_state_' + state.id];
            }
            console.warn('Internal States: prompts removed (enabled=false)', new Error('trace').stack);
            updateStatus();
            return;
        }
        setExtensionPrompt(masterKey, getMasterPrompt(), INJECTION_POSITION, INJECTION_DEPTH, false, INJECTION_ROLE);
        for (const state of getAllStateDefs()) {
            const key = 'internal_state_' + state.id;
            if (extension_settings.internal_states.states[state.id]) {
                setExtensionPrompt(key, getStatePrompt(state.id), INJECTION_POSITION, INJECTION_DEPTH, false, INJECTION_ROLE);
            } else {
                const cleanup = getCleanupPrompt(state);
                if (cleanup) {
                    setExtensionPrompt(key, cleanup, INJECTION_POSITION, INJECTION_DEPTH, false, INJECTION_ROLE);
                } else {
                    delete extension_prompts[key];
                }
            }
        }
        const registered = Object.keys(extension_prompts).filter(key => key.startsWith('internal_state'));
        const details = registered.map(key => key + '=' + (extension_prompts[key]?.value?.length ?? 'missing'));
        const after = [...registered].sort().join(',');
        if (before !== after) {
            console.debug('Internal States: key set changed by applyExtensionPrompts: [' + before + '] -> [' + after + ']');
        }
        console.log('Internal States: registered extension prompts [' + details.join(', ') + ']');
        updateStatus();
    }

    function getExpectedStateKeys() {
        const keys = ['internal_states_master'];
        for (const state of getAllStateDefs()) {
            keys.push('internal_state_' + state.id);
        }
        return keys;
    }

    function ensurePromptsApplied() {
        if (!extension_settings?.internal_states) {
            return;
        }
        const enabled = !!extension_settings.internal_states.enabled;
        const actualKeys = Object.keys(extension_prompts).filter(key => key.startsWith('internal_state'));
        if (enabled) {
            const missing = getExpectedStateKeys().filter(key => !actualKeys.includes(key));
            if (missing.length === 0) {
                return;
            }
            console.warn('Internal States: self-heal registering missing prompts [' + missing.join(', ') + ']');
        } else {
            if (actualKeys.length === 0) {
                return;
            }
            console.warn('Internal States: self-heal clearing stale prompts (enabled=false)');
        }
        applyExtensionPrompts();
    }

    function setupDebugInstrumentation() {
        window.internalStatesDebug = {
            snapshot: function () {
                const keys = Object.keys(extension_prompts)
                    .filter(key => key.startsWith('internal_state'))
                    .sort();
                const data = {
                    enabled: !!extension_settings?.internal_states?.enabled,
                    now: Date.now(),
                    keyCount: keys.length,
                    keys: keys.map(key => {
                        const p = extension_prompts[key];
                        return {
                            key: key,
                            valueLen: p?.value?.length ?? 'missing',
                            position: p?.position,
                            depth: p?.depth,
                            role: p?.role,
                            filterType: typeof p?.filter,
                        };
                    }),
                    master: (function () {
                        const m = extension_prompts['internal_states_master'];
                        return m ? { valueLen: m.value?.length, position: m.position, depth: m.depth, role: m.role } : null;
                    })(),
                };
                console.log('Internal States: snapshot ' + JSON.stringify(data));
                return data;
            },
        };

        let lastSignature = null;
        let lastEnabled = null;
        setInterval(function () {
            if (!extension_settings?.internal_states) return;
            const sig = Object.keys(extension_prompts)
                .filter(key => key.startsWith('internal_state'))
                .sort()
                .join(',');
            const enabled = !!extension_settings.internal_states.enabled;
            if (sig !== lastSignature || enabled !== lastEnabled) {
                if (lastSignature !== null) {
                    console.warn('Internal States: CHANGE detected (enabled=' + lastEnabled + '->' + enabled + ', keys=[' + lastSignature + '] -> [' + sig + '])');
                } else {
                    console.debug('Internal States: watcher initial state (enabled=' + enabled + ', keys=[' + sig + '])');
                }
                lastSignature = sig;
                lastEnabled = enabled;
            }
            try {
                ensurePromptsApplied();
            } catch (err) {
                console.error('Internal States: self-heal failed', err);
            }
        }, 1000);
    }

    function unescapeHtml(str) {
        return String(str)
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&');
    }

    function cleanHiddenStateBlock(element) {
        if (!element) return;
        const html = element.innerHTML;
        if (!html.includes('GFX_START') && !html.includes('<internal_states>') && !html.includes('```')) {
            return;
        }
        let cleaned = html.replace(HIDDEN_STATES_REGEX, '');
        cleaned = cleaned.replace(/```(?:json)?\s*\n?([\s\S]*?)```/gi, function (match, content) {
            try {
                const parsed = JSON.parse(unescapeHtml(content.trim()));
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return '';
                }
            } catch { /* not JSON - keep the code fence visible */ }
            return match;
        });
        if (cleaned !== html) {
            element.innerHTML = cleaned;
        }
    }

    function setupDisplayCleanup() {
        const chatElement = document.getElementById('chat');
        if (!chatElement) return;

        const observer = new MutationObserver(function (mutations) {
            if (!extension_settings?.internal_states?.hide_state_blocks) {
                return;
            }
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const element = node.classList?.contains('mes_text')
                        ? node
                        : (node.closest?.('.mes_text') || null);
                    if (element) {
                        cleanHiddenStateBlock(element);
                    }
                }
            }
        });

        observer.observe(chatElement, { childList: true, subtree: true });
        if (extension_settings?.internal_states?.hide_state_blocks) {
            chatElement.querySelectorAll('.mes_text').forEach(cleanHiddenStateBlock);
        }
    }

    function initStateSettings() {
        extension_settings.internal_states = extension_settings.internal_states || {};
        extension_settings.internal_states.enabled = extension_settings.internal_states.enabled ?? true;
        extension_settings.internal_states.hide_state_blocks = extension_settings.internal_states.hide_state_blocks ?? true;
        extension_settings.internal_states.states = extension_settings.internal_states.states || {};
        extension_settings.internal_states.prompts = extension_settings.internal_states.prompts || {};
        extension_settings.internal_states.custom_states = extension_settings.internal_states.custom_states || [];
        const defaults = getDefaultStateMap();
        for (const [id, enabled] of Object.entries(defaults)) {
            if (typeof extension_settings.internal_states.states[id] !== 'boolean') {
                extension_settings.internal_states.states[id] = enabled;
            }
        }
        delete extension_settings.internal_states.states.master;
    }

    function getEnabledStates() {
        return getAllStateDefs().filter(state => extension_settings.internal_states.states[state.id]);
    }

    function setStateEnabled(id, enabled) {
        extension_settings.internal_states.states[id] = enabled;
        saveSettingsDebounced();
        applyExtensionPrompts();
        renderWindowBody();
    }

    function setWindowVisible(visible) {
        const win = document.getElementById('internal-states-window');
        if (win) {
            win.classList.toggle('is-hidden', !visible);
        }
    }

    function syncToggle() {
        const toggle = document.getElementById('internal_states_enabled');
        if (toggle && extension_settings?.internal_states) {
            toggle.checked = extension_settings.internal_states.enabled;
        }
    }

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function stripThinkingTags(text) {
        return String(text)
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    }

    function extractFencedJson(text) {
        if (!text) return null;
        let result = null;
        const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
        let match;
        while ((match = fenceRegex.exec(text)) !== null) {
            const content = match[1].trim();
            if (!content) continue;
            try {
                const parsed = JSON.parse(content);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    result = parsed;
                }
            } catch { /* keep scanning for a later candidate */ }
        }
        return result;
    }

    function extractJsonFromText(text) {
        if (!text) return null;
        let result = null;
        let inString = false;
        let escape = false;
        let depth = 0;
        let start = -1;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (escape) {
                    escape = false;
                } else if (ch === '\\') {
                    escape = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }
            if (ch === '"') {
                inString = true;
            } else if (ch === '{') {
                if (depth === 0) {
                    start = i;
                }
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0 && start !== -1) {
                    const candidate = text.slice(start, i + 1);
                    try {
                        const parsed = JSON.parse(candidate);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            result = parsed;
                        }
                    } catch { /* keep scanning for another candidate */ }
                    start = -1;
                }
            }
        }
        return result;
    }

    function extractStateJson(text) {
        if (!text) return null;
        const cleaned = stripThinkingTags(text);
        if (!cleaned) return null;
        const fenced = extractFencedJson(cleaned);
        if (fenced) {
            return fenced;
        }
        const legacy = cleaned.match(HIDDEN_STATES_REGEX);
        if (legacy && legacy[0]) {
            const parsed = extractJsonFromText(legacy[0]);
            if (parsed) {
                return parsed;
            }
        }
        return extractJsonFromText(cleaned);
    }

    function mergeState(update) {
        const state = getState();
        let changed = false;
        for (const [key, value] of Object.entries(update)) {
            if (key === 'version') continue;
            if (!isPlainObject(value)) {
                if (JSON.stringify(state.modules[key]) !== JSON.stringify(value)) {
                    state.modules[key] = value;
                    changed = true;
                }
                continue;
            }
            const target = key === 'world'
                ? (state.world = state.world || {})
                : (state.modules[key] = state.modules[key] || {});
            if (isPlainObject(target)) {
                for (const [k2, v2] of Object.entries(value)) {
                    if (JSON.stringify(target[k2]) !== JSON.stringify(v2)) {
                        target[k2] = v2;
                        changed = true;
                    }
                }
            } else {
                state.modules[key] = value;
                changed = true;
            }
        }
        return changed;
    }

    function onMessageReceived() {
        try {
            const context = SillyTavern.getContext();
            const chat = context?.chat || [];
            if (chat.length === 0) return;
            const last = chat[chat.length - 1];
            if (!last || last.is_user) return;
            const update = extractStateJson(String(last.mes || ''));
            if (update === null) {
                lastParseInfo = { time: Date.now(), status: 'none' };
                renderWindowBody();
                return;
            }
            const changed = mergeState(update);
            if (changed) {
                lastParseInfo = { time: Date.now(), status: 'parsed' };
                saveChatDebounced();
                applyExtensionPrompts();
            } else {
                lastParseInfo = { time: Date.now(), status: 'nochange' };
            }
            renderWindowBody();
        } catch (err) {
            console.error('Internal States: failed to parse state update', err);
        }
    }

    function renderValue(value) {
        if (value === null || value === undefined || value === '') {
            return '<span class="internal-states-muted">none</span>';
        }
        if (typeof value === 'boolean' || typeof value === 'number') {
            return String(value);
        }
        if (typeof value === 'string') {
            return escapeHtml(value);
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '<span class="internal-states-muted">none</span>';
            }
            return '<ul>' + value.map(item => '<li>' + renderValue(item) + '</li>').join('') + '</ul>';
        }
        if (isPlainObject(value)) {
            const entries = Object.entries(value);
            if (entries.length === 0) {
                return '<span class="internal-states-muted">none</span>';
            }
            return '<div class="internal-states-object">' + entries.map(([key, val]) => {
                return '<div class="internal-states-field"><span class="internal-states-key">' + escapeHtml(key) + '</span><span class="internal-states-field-value">' + renderValue(val) + '</span></div>';
            }).join('') + '</div>';
        }
        return escapeHtml(String(value));
    }

    function getModuleSummary(state, id) {
        const data = state.modules[id];
        if (!data || !isPlainObject(data)) return '';
        switch (id) {
            case 'dnd_simulator':
                return 'DC ' + (data.lockedDc ?? '?') + ' · Roll ' + (data.rollUser ?? '?') + (data.outcome ? ' · ' + data.outcome : '');
            case 'relationships': {
                const n = Object.keys(data.pairs || {}).length;
                return n + ' pair' + (n === 1 ? '' : 's');
            }
            case 'gm_notebook': {
                const n = (data.entries || []).length;
                return n + ' entr' + (n === 1 ? 'y' : 'ies');
            }
            case 'chekhovs_gun': {
                const a = (data.active || []).length;
                const l = (data.locked || []).length;
                const f = (data.fired || []).length;
                return 'Active ' + a + ' · Locked ' + l + ' · Fired ' + f;
            }
            case 'internal_agenda': {
                const n = Object.keys(data.agendas || {}).length;
                return n + ' agenda' + (n === 1 ? '' : 's');
            }
            case 'inventory': {
                const n = (data.inv || []).length;
                return n + ' item' + (n === 1 ? '' : 's');
            }
            case 'world_sim':
                return data.event ? String(data.event).slice(0, 40) : 'roll ' + (data.roll ?? '?');
            case 'internal_thoughts': {
                const n = (data.thoughts || []).length;
                return n + ' thought' + (n === 1 ? '' : 's');
            }
            default:
                return '';
        }
    }

    function renderWindowBody() {
        const body = document.getElementById('internal-states-body');
        if (!body) return;

        const enabled = getEnabledStates();

        if (enabled.length === 0) {
            body.innerHTML = `
                <div class="internal-states-placeholder">
                    <div class="internal-states-placeholder-title">No states enabled</div>
                    <div class="internal-states-placeholder-text">Open States to enable Internal States modules.</div>
                </div>
            `;
            return;
        }

        const state = getState();
        const hasState = Object.keys(state.modules).length > 0 || Object.keys(state.world || {}).length > 0;

        if (!hasState) {
            body.innerHTML = `
                <div class="internal-states-placeholder">
                    <div class="internal-states-placeholder-title">No internal state yet</div>
                    <div class="internal-states-placeholder-text">The AI writes the state JSON in a fenced JSON block at the end of its reply. Send a message to generate one.</div>
                </div>
            `;
            return;
        }

        const world = state.world || {};
        const worldHtml = Object.keys(world).length > 0
            ? `
                <details class="internal-states-module" open>
                    <summary><span>🌍</span><span>World</span><span class="internal-states-summary-line">turn ${world.turn ?? '?'}</span></summary>
                    <div class="internal-states-module-body">${renderValue(world)}</div>
                </details>
            `
            : '';

        const modulesHtml = enabled.map(stateDef => {
            const data = state.modules[stateDef.id];
            if (data === undefined) return '';
            const summary = getModuleSummary(state, stateDef.id);
            return `
                <details class="internal-states-module" open>
                    <summary><span>${escapeHtml(stateDef.icon)}</span><span>${escapeHtml(stateDef.name)}</span>${summary ? `<span class="internal-states-summary-line">${escapeHtml(summary)}</span>` : ''}</summary>
                    <div class="internal-states-module-body">${renderValue(data)}</div>
                </details>
            `;
        }).join('');

        const statusText = lastParseInfo.status === 'parsed' ? 'parsed' : (lastParseInfo.status === 'nochange' ? 'no change' : (lastParseInfo.status === 'failed' ? 'parse failed' : 'no update'));
        const timeText = lastParseInfo.time ? ' · ' + new Date(lastParseInfo.time).toLocaleTimeString() : '';

        body.innerHTML = `
            <div class="internal-states-toolbar">
                <span class="internal-states-update-info">Last update: ${statusText}${timeText}</span>
                <button class="internal-states-icon-btn" id="internal-states-raw-toggle" title="Toggle raw JSON"><i class="fa-solid fa-braces"></i></button>
                <button class="internal-states-icon-btn" id="internal-states-clear" title="Clear state"><i class="fa-solid fa-trash"></i></button>
            </div>
            <pre class="internal-states-raw" id="internal-states-raw"></pre>
            <div class="internal-states-modules">
                ${worldHtml}
                ${modulesHtml}
            </div>
        `;

        const rawPre = document.getElementById('internal-states-raw');
        if (rawPre) {
            rawPre.textContent = JSON.stringify(state, null, 2);
        }
        document.getElementById('internal-states-raw-toggle')?.addEventListener('click', toggleRawJson);
        document.getElementById('internal-states-clear')?.addEventListener('click', clearState);
    }

    function toggleRawJson() {
        const raw = document.getElementById('internal-states-raw');
        if (raw) {
            raw.classList.toggle('is-visible');
        }
    }

    function clearState() {
        if (!confirm('Clear the current chat\'s internal state? The AI will rebuild it on the next turn.')) return;
        chat_metadata.internalStates = { version: 1, modules: {}, world: {} };
        saveChatDebounced();
        applyExtensionPrompts();
        renderWindowBody();
    }

    function refreshWindowBody() {
        if (!windowCreated) return;
        renderWindowBody();
    }

    function createWindow() {
        if (windowCreated) return;

        const win = document.createElement('div');
        win.id = 'internal-states-window';
        win.className = 'internal-states-window is-hidden';
        win.innerHTML = `
            <div class="internal-states-header" id="internal-states-header">
                <span class="internal-states-title">🧠 Internal States</span>
                <div class="internal-states-header-actions">
                    <button class="internal-states-icon-btn" id="internal-states-states-btn" title="Toggle states"><i class="fa-solid fa-sliders"></i></button>
                    <button class="internal-states-icon-btn" id="internal-states-settings-btn" title="Settings"><i class="fa-solid fa-gear"></i></button>
                    <button class="internal-states-icon-btn" id="internal-states-close" title="Hide window">×</button>
                </div>
            </div>
            <div class="internal-states-body" id="internal-states-body"></div>
            <div class="internal-states-footer" id="internal-states-footer"></div>
        `;
        document.body.appendChild(win);

        document.getElementById('internal-states-close').addEventListener('click', function () {
            setWindowVisible(false);
        });

        document.getElementById('internal-states-states-btn').addEventListener('click', openStatesPopup);
        document.getElementById('internal-states-settings-btn').addEventListener('click', openSettingsWindow);

        const header = win.querySelector('.internal-states-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', function (e) {
            if (e.target.closest('.internal-states-icon-btn')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = win.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            win.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            win.style.left = (initialX + dx) + 'px';
            win.style.top = (initialY + dy) + 'px';
            win.style.right = 'auto';
            win.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false;
                win.style.cursor = '';
            }
        });

        header.style.cursor = 'grab';
        renderWindowBody();
        windowCreated = true;
    }

    function showWindow() {
        createWindow();
        setWindowVisible(true);
        renderWindowBody();
        updateStatus();
    }

    function hideWindow() {
        setWindowVisible(false);
    }

    function createStatesPopup() {
        if (statesPopupCreated) return;

        const overlay = document.createElement('div');
        overlay.id = 'internal-states-states-overlay';
        overlay.className = 'internal-states-settings-overlay';
        overlay.innerHTML = `
            <div class="internal-states-settings-panel">
                <div class="internal-states-settings-header">
                    <span class="internal-states-settings-title">Active States</span>
                    <button class="internal-states-icon-btn" id="internal-states-states-close" title="Close">×</button>
                </div>
                <div class="internal-states-settings-subtitle">Toggle Internal States modules on/off for this chat.</div>
                <div class="internal-states-settings-list" id="internal-states-states-list"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closeStatesPopup();
            }
        });

        document.getElementById('internal-states-states-close').addEventListener('click', closeStatesPopup);

        statesPopupCreated = true;
    }

    function renderStatesPopup() {
        const list = document.getElementById('internal-states-states-list');
        if (!list) return;

        list.innerHTML = getAllStateDefs().map(state => {
            const enabled = !!extension_settings.internal_states.states[state.id];
            return `
                <div class="internal-states-settings-row">
                    <label class="internal-states-settings-toggle">
                        <input type="checkbox" data-state-id="${escapeHtml(state.id)}" class="checkbox" ${enabled ? 'checked' : ''}>
                        <span class="internal-states-settings-icon">${escapeHtml(state.icon)}</span>
                    </label>
                    <div class="internal-states-settings-text">
                        <div class="internal-states-settings-name">${escapeHtml(state.name)}</div>
                        <div class="internal-states-settings-desc">${escapeHtml(state.description)}</div>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('input[data-state-id]').forEach(input => {
            input.addEventListener('change', function () {
                setStateEnabled(this.dataset.stateId, this.checked);
            });
        });
    }

    function openStatesPopup() {
        createStatesPopup();
        renderStatesPopup();
        const overlay = document.getElementById('internal-states-states-overlay');
        if (overlay) {
            overlay.classList.add('is-open');
        }
    }

    function closeStatesPopup() {
        const overlay = document.getElementById('internal-states-states-overlay');
        if (overlay) {
            overlay.classList.remove('is-open');
        }
    }

    function createSettingsWindow() {
        if (settingsWindowCreated) return;

        const overlay = document.createElement('div');
        overlay.id = 'internal-states-settings-overlay';
        overlay.className = 'internal-states-settings-overlay';
        overlay.innerHTML = `
            <div class="internal-states-settings-panel internal-states-settings-wide">
                <div class="internal-states-settings-header">
                    <span class="internal-states-settings-title"><i class="fa-solid fa-gear"></i> Settings</span>
                    <button class="internal-states-icon-btn" id="internal-states-settings-close" title="Close">×</button>
                </div>
                <div class="internal-states-settings-groups" id="internal-states-settings-groups">
                    <div class="internal-states-settings-group">
                        <div class="internal-states-settings-group-header">States</div>
                        <div class="internal-states-settings-subtitle">Edit each state's prompt. Changes apply immediately and persist across sessions.</div>
                        <div class="internal-states-settings-list" id="internal-states-settings-list"></div>
                        <div class="internal-states-settings-group-footer">
                            <button class="internal-states-add-btn" id="internal-states-add-state-btn">＋ Add new state</button>
                        </div>
                    </div>
                </div>
                <div class="internal-states-settings-footer">
                    <button class="internal-states-reset-btn" id="internal-states-preview-btn" title="View the assembled state block that gets injected into the prompt">View injected prompt</button>
                    <button class="internal-states-reset-btn" id="internal-states-reset-all-btn" title="Reset built-in toggles and prompts to defaults">Reset all to defaults</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closeSettingsWindow();
            }
        });

        document.getElementById('internal-states-settings-close').addEventListener('click', closeSettingsWindow);
        document.getElementById('internal-states-add-state-btn').addEventListener('click', addCustomState);
        document.getElementById('internal-states-reset-all-btn').addEventListener('click', resetAllDefaults);
        document.getElementById('internal-states-preview-btn').addEventListener('click', openPromptPreview);

        settingsWindowCreated = true;
    }

    function renderMasterEntry() {
        const prompt = getStatePrompt(MASTER_STATE.id);
        return `
            <details class="internal-states-state-details internal-states-master-details" data-state-id="${escapeHtml(MASTER_STATE.id)}">
                <summary>
                    <span class="internal-states-state-summary-icon">${escapeHtml(MASTER_STATE.icon)}</span>
                    <span class="internal-states-state-summary-name">${escapeHtml(MASTER_STATE.name)}</span>
                    <span class="internal-states-state-always-on">Always on</span>
                </summary>
                <div class="internal-states-state-body">
                    <div class="internal-states-state-desc">${escapeHtml(MASTER_STATE.description)}</div>
                    <div class="internal-states-state-field">
                        <label>Prompt</label>
                        <textarea class="text_prompt internal-states-state-prompt" data-field="prompt" data-state-id="${escapeHtml(MASTER_STATE.id)}" rows="5" spellcheck="false">${escapeHtml(prompt)}</textarea>
                    </div>
                    <div class="internal-states-state-actions">
                        <button class="internal-states-action-btn internal-states-reset-btn-small" data-action="reset" data-state-id="${escapeHtml(MASTER_STATE.id)}">Reset</button>
                    </div>
                </div>
            </details>
        `;
    }

    function renderSettingsWindow() {
        const list = document.getElementById('internal-states-settings-list');
        if (!list) return;

        list.innerHTML = renderMasterEntry() + getAllStateDefs().map(state => {
            const enabled = !!extension_settings.internal_states.states[state.id];
            const prompt = getStatePrompt(state.id);
            return `
                <details class="internal-states-state-details" data-state-id="${escapeHtml(state.id)}">
                    <summary>
                        <span class="internal-states-state-summary-icon">${escapeHtml(state.icon)}</span>
                        <span class="internal-states-state-summary-name">${escapeHtml(state.name)}</span>
                        <span class="internal-states-state-toggle">
                            <input type="checkbox" data-state-id="${escapeHtml(state.id)}" class="checkbox" ${enabled ? 'checked' : ''}>
                        </span>
                    </summary>
                    <div class="internal-states-state-body">
                        ${state.isCustom ? `
                            <div class="internal-states-state-field">
                                <label>Name</label>
                                <input type="text" class="text_pole" data-field="name" data-state-id="${escapeHtml(state.id)}" value="${escapeHtml(state.name)}">
                            </div>
                            <div class="internal-states-state-field">
                                <label>Icon</label>
                                <input type="text" class="text_pole internal-states-state-icon-input" data-field="icon" data-state-id="${escapeHtml(state.id)}" value="${escapeHtml(state.icon)}" maxlength="2">
                            </div>
                            <div class="internal-states-state-field">
                                <label>Description</label>
                                <input type="text" class="text_pole" data-field="description" data-state-id="${escapeHtml(state.id)}" value="${escapeHtml(state.description)}">
                            </div>
                        ` : `
                            <div class="internal-states-state-desc">${escapeHtml(state.description)}</div>
                        `}
                        <div class="internal-states-state-field">
                            <label>Prompt</label>
                            <textarea class="text_prompt internal-states-state-prompt" data-field="prompt" data-state-id="${escapeHtml(state.id)}" rows="5" spellcheck="false">${escapeHtml(prompt)}</textarea>
                        </div>
                        <div class="internal-states-state-actions">
                            ${state.isCustom ? `
                                <button class="internal-states-action-btn internal-states-delete-btn" data-action="delete" data-state-id="${escapeHtml(state.id)}">Delete</button>
                            ` : `
                                <button class="internal-states-action-btn internal-states-reset-btn-small" data-action="reset" data-state-id="${escapeHtml(state.id)}">Reset</button>
                            `}
                        </div>
                    </div>
                </details>
            `;
        }).join('');

        list.querySelectorAll('input[data-state-id][type="checkbox"]').forEach(input => {
            input.addEventListener('change', function () {
                setStateEnabled(this.dataset.stateId, this.checked);
            });
        });

        list.querySelectorAll('input[data-field][data-state-id]').forEach(input => {
            input.addEventListener('input', function () {
                updateCustomField(this.dataset.stateId, this.dataset.field, this.value);
                if (this.dataset.field === 'name' || this.dataset.field === 'icon') {
                    const summary = list.querySelector(`details[data-state-id="${CSS.escape(this.dataset.stateId)}"] .internal-states-state-summary-${this.dataset.field === 'name' ? 'name' : 'icon'}`);
                    if (summary) {
                        summary.textContent = this.value;
                    }
                }
            });
        });

        list.querySelectorAll('textarea[data-field][data-state-id]').forEach(textarea => {
            textarea.addEventListener('input', function () {
                const id = this.dataset.stateId;
                const isCustom = getCustomStates().some(state => state.id === id);
                if (isCustom) {
                    updateCustomField(id, 'prompt', this.value);
                } else {
                    extension_settings.internal_states.prompts[id] = this.value;
                    saveSettingsDebounced();
                    applyExtensionPrompts();
                }
            });
        });

        list.querySelectorAll('button[data-action][data-state-id]').forEach(button => {
            button.addEventListener('click', function () {
                const id = this.dataset.stateId;
                if (this.dataset.action === 'delete') {
                    deleteCustomState(id);
                } else if (this.dataset.action === 'reset') {
                    resetStatePrompt(id);
                }
            });
        });
    }

    function openSettingsWindow() {
        createSettingsWindow();
        renderSettingsWindow();
        const overlay = document.getElementById('internal-states-settings-overlay');
        if (overlay) {
            overlay.classList.add('is-open');
        }
    }

    function closeSettingsWindow() {
        const overlay = document.getElementById('internal-states-settings-overlay');
        if (overlay) {
            overlay.classList.remove('is-open');
        }
    }

    function createPromptPreview() {
        if (promptPreviewCreated) return;

        const overlay = document.createElement('div');
        overlay.id = 'internal-states-preview-overlay';
        overlay.className = 'internal-states-settings-overlay';
        overlay.innerHTML = `
            <div class="internal-states-settings-panel internal-states-preview-panel">
                <div class="internal-states-settings-header">
                    <span class="internal-states-settings-title"><i class="fa-solid fa-scroll"></i> Injected prompt</span>
                    <button class="internal-states-icon-btn" id="internal-states-preview-close" title="Close">×</button>
                </div>
                <div class="internal-states-settings-subtitle">The assembled state block injected at depth 4, exactly as sent to the model (macros expanded).</div>
                <textarea class="text_prompt internal-states-preview-text" id="internal-states-preview-text" readonly spellcheck="false" rows="20"></textarea>
                <div class="internal-states-settings-footer">
                    <button class="internal-states-reset-btn" id="internal-states-preview-copy" title="Copy to clipboard">Copy to clipboard</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closePromptPreview();
            }
        });

        document.getElementById('internal-states-preview-close').addEventListener('click', closePromptPreview);
        document.getElementById('internal-states-preview-copy').addEventListener('click', function () {
            const text = document.getElementById('internal-states-preview-text');
            navigator.clipboard.writeText(text.value).then(function () {
                console.log('Internal States: prompt copied to clipboard');
            }).catch(function () {
                console.error('Internal States: failed to copy prompt');
            });
        });

        promptPreviewCreated = true;
    }

    function closePromptPreview() {
        const overlay = document.getElementById('internal-states-preview-overlay');
        if (overlay) {
            overlay.classList.remove('is-open');
        }
    }

    async function assemblePromptBlock() {
        ensurePromptsApplied();
        const timeout = new Promise(function (_, reject) {
            setTimeout(function () {
                reject(new Error('timed out after 3s'));
            }, 3000);
        });
        return await Promise.race([
            getExtensionPrompt(INJECTION_POSITION, INJECTION_DEPTH, '\n', INJECTION_ROLE, false),
            timeout,
        ]);
    }

    async function openPromptPreview() {
        try {
            createPromptPreview();
        } catch (err) {
            console.error('Internal States: failed to create preview overlay', err);
            return;
        }
        const overlay = document.getElementById('internal-states-preview-overlay');
        const textarea = document.getElementById('internal-states-preview-text');
        if (!overlay || !textarea) {
            console.error('Internal States: preview elements missing', { overlay: !!overlay, textarea: !!textarea });
            return;
        }
        overlay.classList.add('is-open');
        textarea.value = 'Loading...';
        try {
            const block = await assemblePromptBlock();
            console.log('Internal States: preview block length =', block.length, '| hasProtocol =', block.includes('INTERNAL STATE JSON PROTOCOL'));
            let display = block || '';
            if (!display.includes('INTERNAL STATE JSON PROTOCOL')) {
                const raw = Object.keys(extension_prompts)
                    .filter(key => key.startsWith('internal_state'))
                    .sort()
                    .map(key => key + ' [' + (extension_prompts[key]?.value?.length ?? 'missing') + ' chars]:\n' + (extension_prompts[key]?.value || '(empty)'))
                    .join('\n\n');
                const other = Object.keys(extension_prompts)
                    .filter(key => !key.startsWith('internal_state'))
                    .sort()
                    .map(key => key + ' [pos=' + extension_prompts[key]?.position + ', depth=' + extension_prompts[key]?.depth + ', role=' + extension_prompts[key]?.role + ', ' + (extension_prompts[key]?.value?.length ?? 'missing') + ' chars]')
                    .join('\n');
                display += '\n\n--- RAW INTERNAL STATES (block missing) ---\n\n' + (raw || '(no internal_state keys registered)');
                display += '\n\n--- ALL OTHER REGISTERED PROMPTS ---\n\n' + (other || '(none)');
                console.warn('Internal States: assembled block missing protocol; diagnostics appended to preview');
            }
            textarea.value = display || '(No Internal States prompts registered. Enable the extension and at least one state.)';
        } catch (err) {
            console.error('Internal States: failed to build prompt preview', err);
            let raw = '(none)';
            try {
                raw = Object.keys(extension_prompts)
                    .filter(key => key.startsWith('internal_state'))
                    .sort()
                    .map(key => extension_prompts[key]?.value)
                    .join('\n') || '(none)';
            } catch { /* ignore */ }
            textarea.value = 'Preview error: ' + (err?.message || err) + '\n\n--- raw registered values ---\n\n' + raw;
        }
    }

    async function logAssembledBlock() {
        try {
            const block = await assemblePromptBlock();
            console.log('Internal States: assembled block (' + block.length + ' chars, hasProtocol=' + block.includes('INTERNAL STATE JSON PROTOCOL') + '):\n' + (block.slice(0, 2000) || '(empty)'));
        } catch (err) {
            console.error('Internal States: failed to assemble block at startup', err);
        }
    }

    function syncHideBlocksToggle() {
        const toggle = document.getElementById('internal_states_hide_blocks');
        if (toggle && extension_settings?.internal_states) {
            toggle.checked = !!extension_settings.internal_states.hide_state_blocks;
        }
    }

    function addCustomState() {
        const id = 'custom_' + Date.now();
        const state = {
            id,
            name: 'New State',
            icon: '✨',
            description: '',
            prompt: '',
        };
        extension_settings.internal_states.custom_states.push(state);
        extension_settings.internal_states.states[id] = true;
        saveSettingsDebounced();
        applyExtensionPrompts();
        renderSettingsWindow();
        renderStatesPopup();
        renderWindowBody();
        const details = document.getElementById('internal-states-settings-list').querySelector(`details[data-state-id="${id}"]`);
        if (details) {
            details.open = true;
        }
    }

    function updateCustomField(id, field, value) {
        const state = getCustomStates().find(s => s.id === id);
        if (!state) return;
        state[field] = value;
        saveSettingsDebounced();
        applyExtensionPrompts();
    }

    function deleteCustomState(id) {
        const states = getCustomStates();
        const index = states.findIndex(state => state.id === id);
        if (index === -1) return;
        if (!confirm('Delete state "' + states[index].name + '"?')) return;
        states.splice(index, 1);
        delete extension_settings.internal_states.states[id];
        delete extension_settings.internal_states.prompts[id];
        saveSettingsDebounced();
        applyExtensionPrompts();
        renderSettingsWindow();
        renderStatesPopup();
        renderWindowBody();
    }

    function resetStatePrompt(id) {
        delete extension_settings.internal_states.prompts[id];
        saveSettingsDebounced();
        applyExtensionPrompts();
        renderSettingsWindow();
    }

    function resetAllDefaults() {
        if (!confirm('Reset built-in states to defaults? Custom states and their prompts will be kept.')) return;
        extension_settings.internal_states.states = getDefaultStateMap();
        extension_settings.internal_states.prompts = {};
        saveSettingsDebounced();
        applyExtensionPrompts();
        renderSettingsWindow();
        renderStatesPopup();
        renderWindowBody();
    }

    async function loadSettings() {
        try {
            const resp = await fetch(`${BASE_URL}/settings.html`);
            if (resp.ok) {
                const html = await resp.text();
                jQuery('#extensions_settings').append(html);
            }
        } catch (err) {
            console.error('Internal States: Failed to load settings:', err);
        }
    }

    async function init() {
        try {
            const context = SillyTavern.getContext();
            extension_settings = context.extension_settings || context.extensionSettings;
            saveSettingsDebounced = context.saveSettingsDebounced;

            console.debug('Internal States: initializing');

            initStateSettings();
            setupDebugInstrumentation();
            applyExtensionPrompts();
            setupDisplayCleanup();
            logAssembledBlock();

            eventSource.on(event_types.CHAT_CHANGED, applyExtensionPrompts);
            eventSource.on(event_types.GROUP_UPDATED, applyExtensionPrompts);
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, refreshWindowBody);
            eventSource.on(event_types.CHAT_CHANGED, refreshWindowBody);
            eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

            await loadSettings();

            jQuery('#internal_states_enabled').on('change', function () {
                const enabled = jQuery(this).is(':checked');
                extension_settings.internal_states.enabled = enabled;
                saveSettingsDebounced();
                applyExtensionPrompts();
                if (enabled) {
                    showWindow();
                } else {
                    hideWindow();
                }
            });

            jQuery('#internal_states_hide_blocks').on('change', function () {
                extension_settings.internal_states.hide_state_blocks = jQuery(this).is(':checked');
                saveSettingsDebounced();
                setupDisplayCleanup();
            });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    closeStatesPopup();
                    closeSettingsWindow();
                    closePromptPreview();
                }
            });

            syncToggle();
            syncHideBlocksToggle();
            updateStatus();
            if (extension_settings.internal_states.enabled) {
                showWindow();
            }

            console.log('Internal States: loaded (enabled=' + extension_settings.internal_states.enabled + ', states=' + getEnabledStates().map(state => state.id).join(',') + ')');
        } catch (err) {
            console.error('Internal States: init failed', err);
        }
    }

    if (window.SillyTavern) {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }
})();
