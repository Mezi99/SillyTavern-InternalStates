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

## How it works

The extension owns a **per-chat game state** stored as JSON in the chat's metadata. Each turn it:

1. Injects the current state JSON into the prompt (inside the master block at depth 4), together with the enabled module rules.
2. Asks the model to reason about the state and append a fenced ```` ```json ```` update block at the end of every reply — only the module fields that changed (`{}` if nothing changed).
3. Parses that update on `message_received`, deep-merges it into the stored state, and persists it.
4. Renders the state in the extension window as structured, per-module sections (raw JSON view and a "clear state" button are available from the window footer).

Because the state is real JSON owned by the extension, there are no `setvar`/`getvar` macros to rely on: updates survive reloads, only changed fields are transmitted (saving tokens), and the window always reflects the true current state.

## Installation

1. Clone or download this repository
2. Place the folder in your SillyTavern `public/scripts/extensions/third-party` directory
3. Restart SillyTavern
4. Enable the extension in Settings → Extensions

## Usage

- Toggle **Enable Internal States** in the extension's drawer to show/hide the floating window.
- Use the 🎛️ button in the window header (or the States drawer) to toggle individual modules on/off per chat.
- Use the ⚙️ button to edit each module's prompt or the master protocol.
- **Hide state blocks from chat** is ON by default: the fenced ```json update block is stripped from the chat view but still sent to the model. Turn it OFF to see the raw block, as in the original preset.
- The **View injected prompt** button in Settings shows the exact assembled block (rules + current state JSON) sent to the model.

## Roadmap

- [x] Per-module enable toggles
- [x] Inject enabled modules into the prompt regardless of active preset (`setExtensionPrompt`, depth 4, matching the FF5 preset)
- [x] CoT enforcement directives embedded in each module's rules
- [x] JSON game-state engine (v1.0.0)
- [x] Strict fenced-JSON transport: no wrapper tags, ```` ```json ```` block on every reply, legacy `<internal_states>` parsing kept for old chats (v1.1.0)
