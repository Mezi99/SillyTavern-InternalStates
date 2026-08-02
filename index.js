import { INTERNAL_STATES } from './states.js';

(function () {
    'use strict';

    const MODULE_NAME = 'internal_states';

    let extension_settings;
    let saveSettingsDebounced;
    let windowCreated = false;
    let settingsPopupCreated = false;

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

    function getDefaultStateMap() {
        const map = {};
        for (const state of INTERNAL_STATES) {
            map[state.id] = !!state.defaultEnabled;
        }
        return map;
    }

    function initStateSettings() {
        extension_settings.internal_states = extension_settings.internal_states || {};
        extension_settings.internal_states.enabled = !!extension_settings.internal_states.enabled;
        extension_settings.internal_states.states = extension_settings.internal_states.states || {};
        const defaults = getDefaultStateMap();
        for (const [id, enabled] of Object.entries(defaults)) {
            if (typeof extension_settings.internal_states.states[id] !== 'boolean') {
                extension_settings.internal_states.states[id] = enabled;
            }
        }
    }

    function getEnabledStates() {
        return INTERNAL_STATES.filter(state => extension_settings.internal_states.states[state.id]);
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
                    <div class="internal-states-placeholder-text">Open settings (⚙) to enable Internal States modules.</div>
                </div>
            `;
            return;
        }

        body.innerHTML = `
            <div class="internal-states-module-list">
                ${enabled.map(state => `
                    <div class="internal-states-module-row">
                        <span class="internal-states-module-icon">${state.icon}</span>
                        <span class="internal-states-module-name">${state.name}</span>
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

        document.getElementById('internal-states-settings-btn').addEventListener('click', openSettingsPopup);

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

    function createSettingsPopup() {
        if (settingsPopupCreated) return;

        const overlay = document.createElement('div');
        overlay.id = 'internal-states-settings-overlay';
        overlay.className = 'internal-states-settings-overlay';
        overlay.innerHTML = `
            <div class="internal-states-settings-panel">
                <div class="internal-states-settings-header">
                    <span class="internal-states-settings-title"><i class="fa-solid fa-gear"></i> Internal States Settings</span>
                    <button class="internal-states-icon-btn" id="internal-states-settings-close" title="Close">×</button>
                </div>
                <div class="internal-states-settings-subtitle">Choose which Internal States modules are active. Enabled modules run behind the scenes regardless of the active preset.</div>
                <div class="internal-states-settings-list" id="internal-states-settings-list"></div>
                <div class="internal-states-settings-footer">
                    <button class="internal-states-reset-btn" id="internal-states-reset-btn" title="Reset to defaults">Reset to defaults</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closeSettingsPopup();
            }
        });

        document.getElementById('internal-states-settings-close').addEventListener('click', closeSettingsPopup);
        document.getElementById('internal-states-reset-btn').addEventListener('click', resetStateDefaults);

        settingsPopupCreated = true;
    }

    function renderSettingsPopup() {
        const list = document.getElementById('internal-states-settings-list');
        if (!list) return;

        list.innerHTML = INTERNAL_STATES.map(state => {
            const enabled = !!extension_settings.internal_states.states[state.id];
            return `
                <div class="internal-states-settings-row">
                    <label class="internal-states-settings-toggle" for="internal-state-${state.id}">
                        <input type="checkbox" id="internal-state-${state.id}" data-state-id="${state.id}" class="checkbox" ${enabled ? 'checked' : ''}>
                        <span class="internal-states-settings-icon">${state.icon}</span>
                    </label>
                    <div class="internal-states-settings-text">
                        <div class="internal-states-settings-name">${state.name}</div>
                        <div class="internal-states-settings-desc">${state.description}</div>
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

    function openSettingsPopup() {
        createSettingsPopup();
        renderSettingsPopup();
        const overlay = document.getElementById('internal-states-settings-overlay');
        if (overlay) {
            overlay.classList.add('is-open');
        }
    }

    function closeSettingsPopup() {
        const overlay = document.getElementById('internal-states-settings-overlay');
        if (overlay) {
            overlay.classList.remove('is-open');
        }
    }

    function resetStateDefaults() {
        extension_settings.internal_states.states = getDefaultStateMap();
        saveSettingsDebounced();
        renderSettingsPopup();
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
                closeSettingsPopup();
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
