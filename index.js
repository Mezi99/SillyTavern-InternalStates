import { INTERNAL_STATES } from './states.js';

(function () {
    'use strict';

    const MODULE_NAME = 'internal_states';

    let extension_settings;
    let saveSettingsDebounced;
    let windowCreated = false;
    let statesPopupCreated = false;
    let settingsWindowCreated = false;

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
        if (Object.prototype.hasOwnProperty.call(overrides, id)) {
            return overrides[id] || '';
        }
        const custom = getCustomStates().find(state => state.id === id);
        if (custom) {
            return custom.prompt || '';
        }
        const builtIn = INTERNAL_STATES.find(state => state.id === id);
        return builtIn ? builtIn.prompt || '' : '';
    }

    function initStateSettings() {
        extension_settings.internal_states = extension_settings.internal_states || {};
        extension_settings.internal_states.enabled = !!extension_settings.internal_states.enabled;
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

        body.innerHTML = `
            <div class="internal-states-module-list">
                ${enabled.map(state => `
                    <div class="internal-states-module-row">
                        <span class="internal-states-module-icon">${escapeHtml(state.icon)}</span>
                        <span class="internal-states-module-name">${escapeHtml(state.name)}</span>
                    </div>
                `).join('')}
            </div>
        `;
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
        `;
        document.body.appendChild(win);

        document.getElementById('internal-states-close').addEventListener('click', function () {
            if (extension_settings?.internal_states) {
                extension_settings.internal_states.enabled = false;
                syncToggle();
                saveSettingsDebounced();
            }
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

        settingsWindowCreated = true;
    }

    function renderSettingsWindow() {
        const list = document.getElementById('internal-states-settings-list');
        if (!list) return;

        list.innerHTML = getAllStateDefs().map(state => {
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
        renderSettingsWindow();
        renderStatesPopup();
        renderWindowBody();
    }

    function resetStatePrompt(id) {
        delete extension_settings.internal_states.prompts[id];
        saveSettingsDebounced();
        renderSettingsWindow();
    }

    function resetAllDefaults() {
        if (!confirm('Reset built-in states to defaults? Custom states and their prompts will be kept.')) return;
        extension_settings.internal_states.states = getDefaultStateMap();
        extension_settings.internal_states.prompts = {};
        saveSettingsDebounced();
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
        const context = SillyTavern.getContext();
        extension_settings = context.extension_settings || context.extensionSettings;
        saveSettingsDebounced = context.saveSettingsDebounced;

        console.debug('Internal States: initializing');

        initStateSettings();

        await loadSettings();

        jQuery('#internal_states_enabled').on('change', function () {
            const enabled = jQuery(this).is(':checked');
            extension_settings.internal_states.enabled = enabled;
            saveSettingsDebounced();
            if (enabled) {
                showWindow();
            } else {
                hideWindow();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeStatesPopup();
                closeSettingsWindow();
            }
        });

        syncToggle();
        if (extension_settings.internal_states.enabled) {
            showWindow();
        }

        console.log('Internal States extension loaded');
    }

    if (window.SillyTavern) {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }
})();
