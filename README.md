# Godfield AI

A browser-based game AI system built with JavaScript, Tampermonkey, Python FastAPI, and LLMs.

This project reads game state from the browser UI, sends structured JSON data to a local FastAPI server, receives an AI-generated action, and executes the action in the browser.

## Tech Stack

- JavaScript / Tampermonkey
- Python / FastAPI
- LLM API
- Node.js / esbuild
- Git / GitHub

## Architecture

1. The browser userscript reads the current game state from the DOM.
2. The state is converted into structured JSON.
3. The JSON is sent to a local Python FastAPI server.
4. The server generates a decision using an LLM.
5. The browser receives the action and executes it on the UI.

## What I implemented

- DOM-based state extraction
- API communication between browser JavaScript and Python FastAPI
- Structured JSON action format
- LLM-based decision-making pipeline
- Fail-safe handling for uncertain UI states
- Modular JavaScript structure using Node.js and esbuild

## What I learned

- How to separate browser-side logic and server-side logic
- How to design JSON-based API input/output
- How to debug asynchronous UI automation
- How to use Git/GitHub to manage a multi-file project
