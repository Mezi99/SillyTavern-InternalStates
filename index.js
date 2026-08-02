(function () {
    'use strict';

    const MODULE_NAME = 'internal_states';

    let extension_settings;
    let saveSettingsDebounced;
    let windowCreated = false;

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

    function createWindow() {
        if (windowCreated) return;

        const win = document.createElement('div');
        win.id = 'internal-states-window';
        win.className = 'internal-states-window is-hidden';
        win.innerHTML = `
            <div class="internal-states-header" id="internal-states-header">
                <span class="internal-states-title">🧠 Internal States</span>
                <button class="internal-states-close" id="internal-states-close" title="Hide window">×</button>
            </div>
            <div class="internal-states-body" id="internal-states-body">
                <div class="internal-states-placeholder">
                    <div class="internal-states-placeholder-title">Modules coming soon</div>
                    <div class="internal-states-placeholder-text">DnD Simulator, Agendas, GM's Notebook, Inventory, Relationships, World Sim, Chekhov's Gun and Internal Thoughts will be toggleable here.</div>
                </div>
            </div>
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

        const header = win.querySelector('.internal-states-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', function (e) {
            if (e.target.closest('.internal-states-close')) return;
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
        windowCreated = true;
    }

    function showWindow() {
        createWindow();
        setWindowVisible(true);
    }

    function hideWindow() {
        setWindowVisible(false);
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

        extension_settings.internal_states = extension_settings.internal_states || {
            enabled: false,
        };

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
