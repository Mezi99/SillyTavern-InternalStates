# SillyTavern - Internal States

A SillyTavern extension that runs the **Internal States** engine (from the Freaky Frankenstein 5 preset) regardless of which preset is active.

Internal States is a modular game-master system made of independent modules:

- 🐉 DnD Simulator
- 📅 Internal Agenda
- 📒 GM's Notebook
- 🗡️ Inventory, Feats, Titles
- 🥰 Relationships RPG
- 🌎 World Sim
- 🔫 Chekhov's Gun
- 🧠 Internal Thoughts
- 👾 Internal States (master block)

## Installation

1. Clone or download this repository
2. Place the folder in your SillyTavern `public/scripts/extensions/third-party` directory
3. Restart SillyTavern
4. Enable the extension in Settings → Extensions

## Usage

- Toggle **Enable Internal States window** in the extension's drawer to show/hide the floating panel
- The panel is draggable via its header
- Module toggles are coming soon

## Roadmap

- [ ] Per-module enable toggles
- [ ] Inject enabled modules into the prompt regardless of active preset (via `setExtensionPrompt`, depth 4, matching the FF5 preset)
- [ ] CoT integration hooks
