# Godfield AI

A browser-game AI agent for **Godfield**, built with Tampermonkey, modular JavaScript, Python FastAPI, and LLM-based decision making.

The agent reads the current game state directly from the browser UI, converts it into structured JSON, sends that state to a local FastAPI server, receives an action decision, and executes the selected cards back in the browser.

This project is mainly an experiment in building a practical LLM game agent: not just prompting a model, but connecting browser automation, state extraction, action validation, logging, and fallback logic into one working loop.

---

## Overview

Godfield AI is split into two parts:

1. **Browser client**
   - Runs as a Tampermonkey userscript.
   - Reads game state from the DOM.
   - Detects the current phase: attack, defense, buy choice, etc.
   - Sends structured state data to the local server.
   - Executes the action returned by the AI.

2. **Local AI server**
   - Runs with Python FastAPI.
   - Receives the game state as JSON.
   - Adds card database information and recent history.
   - Calls an LLM with phase-specific prompts.
   - Validates and corrects the model output before returning it to the browser.

---

## Architecture

```text
Godfield browser UI
        ↓
Tampermonkey userscript
        ↓
DOM state reader
        ↓
Structured JSON state
        ↓
FastAPI /decide endpoint
        ↓
Prompt builder + LLM decision
        ↓
Rule-based sanitizer / fallback logic
        ↓
Structured action JSON
        ↓
Browser action executor
        ↓
Card clicks / buy / sell / exchange / pass
```

---

## Features

- **DOM-based state extraction**
  - Reads player HP / MP / gold.
  - Reads hand cards, overlays, raw card text, and usability.
  - Reads incoming attacks during defense.
  - Tracks visible miracles and status effects.

- **LLM-based decision engine**
  - Uses a common system prompt plus phase-specific prompts.
  - Supports attack, defense, and buy-choice decisions.
  - Sends the model a structured JSON representation of the current game state.

- **Structured action schema**
  - The AI returns actions such as `attack`, `defend`, `buy`, `sell`, `exchange`, `attack-pass`, and `defense-pass`.
  - Actions include card indices, optional target, buy choice, exchange plan, and a short reason.

- **Safety checks after LLM output**
  - Filters unusable cards.
  - Checks MP cost and phase constraints.
  - Corrects invalid attack combinations.
  - Prevents some obviously losing moves with rule-based overrides.
  - Falls back to simple rule-based play when the LLM call fails.

- **Local debugging logs**
  - Records state summaries, raw AI output, Python corrections, final actions, and recent turn history.
  - Useful for reviewing bad decisions and improving prompts.

- **Modular frontend code**
  - Browser logic is separated into readers, executors, guards, transport, and utilities.
  - Bundled with esbuild into a single userscript file.

---

## Tech Stack

### Frontend / Browser

- JavaScript
- Tampermonkey
- DOM inspection
- `GM_xmlhttpRequest`
- Node.js
- esbuild

### Backend / AI Server

- Python
- FastAPI
- Pydantic
- OpenAI API
- JSON-based API design

### Development

- Git / GitHub
- Modular JavaScript architecture
- Prompt files for phase-specific behavior
- Local logs for debugging AI decisions

---

## Repository Structure

```text
.
├── src/
│   ├── index.js                  # Entry point for the browser bundle
│   ├── globals.js                # Shared client-side state
│   ├── readers/
│   │   └── stateReader.js        # DOM reading and state extraction
│   ├── executors/
│   │   ├── actions.js            # Browser-side action execution
│   │   └── clickHelpers.js       # Low-level click helpers
│   ├── logic/
│   │   └── phaseGuards.js        # Phase detection and duplicate-action guards
│   ├── transport/
│   │   ├── serverClient.js       # Client → FastAPI communication
│   │   └── pollingLoop.js        # Main browser polling loop
│   └── utils/
│       ├── async.js
│       └── logger.js
├── prompts/
│   ├── system_core.txt           # Common prompt shared across phases
│   ├── user_attack.txt           # Attack-phase prompt
│   ├── user_defense.txt          # Defense-phase prompt
│   └── user_buy_choice.txt       # Buy-choice prompt
├── server.py                     # FastAPI server and decision logic
├── godfield_cards.json           # Card database used by the server
├── package.json                  # Build scripts for the browser bundle
└── README.md
```

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/naoyaAAAAA/godfield-ai.git
cd godfield-ai
```

### 2. Install JavaScript dependencies

```bash
npm install
```

### 3. Build the browser bundle

```bash
npm run build
```

For development mode, use:

```bash
npm run dev
```

This watches `src/index.js` and rebuilds the bundled userscript into:

```text
dist/bundle.user.js
```

### 4. Serve the local bundle over localhost

The generated JavaScript file is local, but many browser / Tampermonkey environments block direct `file:///...` loading from `@require`.

To keep the file local while making it loadable from Tampermonkey, serve the repository directory through a local HTTP server:

```bash
python -m http.server 5173
```

Run this command from the repository root. Then the local bundle can be loaded from:

```text
http://127.0.0.1:5173/dist/bundle.user.js
```

### 5. Install Python dependencies

This repository currently does not require a complex backend setup. Install the main dependencies manually:

```bash
pip install fastapi uvicorn openai pydantic
```

### 6. Set your OpenAI API key

On macOS / Linux:

```bash
export OPENAI_API_KEY="your_api_key_here"
```

On Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
```

You can also choose the model with `GF_MODEL`:

```bash
export GF_MODEL="your_model_name"
```

### 7. Start the local FastAPI server

```bash
python -m uvicorn server:app --reload --port 8000
```

The browser client sends requests to:

```text
http://127.0.0.1:8000/decide
```

### 8. Load the userscript in Tampermonkey

Create a Tampermonkey entry script that loads the locally served bundle:

```javascript
// ==UserScript==
// @name         Godfield AI bundle entry
// @namespace    godfield-ai
// @version      1.0
// @match        https://godfield.net/*
// @match        https://*.godfield.net/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @require      http://127.0.0.1:5173/dist/bundle.user.js
// ==/UserScript==
```

Then open Godfield in the browser and keep both local servers running:

```bash
npm run dev
python -m http.server 5173
python -m uvicorn server:app --reload --port 8000
```

---

## Action Format

The server returns an action object like this:

```json
{
  "type": "attack",
  "cardIndices": [0, 2],
  "reason": "usable and MP constraints pass; this is the strongest available attack; weaker alternatives were skipped",
  "buy": null,
  "exchange": null,
  "target": "enemy"
}
```

Supported action types include:

- `attack`
- `defend`
- `buy`
- `sell`
- `exchange`
- `buy_choice`
- `attack-pass`
- `defense-pass`
- `none`

---

## Why This Project Is Interesting

The hard part is not only asking an LLM what to do. The hard part is making the full loop reliable:

- The game state has to be inferred from a changing browser UI.
- Hover panels and card descriptions can become stale, so the reader needs refresh logic.
- The LLM can output invalid card combinations, so the server needs deterministic correction rules.
- The browser can receive a response while another UI action is still running, so action locking and deferred execution are needed.
- Strategic mistakes must be debugged from logs and then improved through prompts, card data, and rule-based guards.

This makes the project a practical example of combining **LLM reasoning**, **browser automation**, **API design**, and **traditional rule-based validation**.

---

## Current Status

This is an experimental local-development project. It is actively being improved through game logs, prompt iteration, and additional rule-based safeguards.

The current focus is on:

- Improving state-reading accuracy.
- Reducing invalid or self-destructive LLM actions.
- Improving defense decisions.
- Making attack and lethal calculations more consistent.
- Comparing different LLM models and prompting strategies.

---

## Future Improvements

- Add a proper `requirements.txt` or `pyproject.toml` for Python dependencies.
- Add automated tests for card parsing and action sanitization.
- Add a replay/log viewer for analyzing AI decisions.
- Improve card database coverage.
- Separate the decision engine from the API layer.
- Add evaluation scripts to compare prompt versions and models.

---

## Disclaimer

This repository is a personal engineering project for experimenting with browser automation, structured state extraction, and LLM-based game agents.
