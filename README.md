# Adaptive Office / WISHOUSE

An interactive architectural research prototype for an office building that responds to collective user feedback. Explore a 12 × 24 m core, 4 × 4 × 4 m modules, roof gardens, and an underground rotating warehouse with animated module handling.

## Run locally

Install Node.js 22 or later, download or clone this repository, and run:

```sh
npm start
```

Open **http://127.0.0.1:4180/**. There are no npm runtime dependencies or build steps: `dist/` contains the editable browser source. The server binds only to your own computer. Set `OFFICE_PORT` to choose another port; browser storage is specific to each origin/port.

The 3D model and manual scheduling work without an API key. Live AI requests require your own OpenAI API access. Set environment variables **before starting** the server:

PowerShell:

```powershell
$env:OPENAI_API_KEY = 'YOUR_API_KEY'
$env:OPENAI_MODEL = 'gpt-5-mini'
npm start
```

macOS / Linux:

```sh
export OPENAI_API_KEY='YOUR_API_KEY'
export OPENAI_MODEL='gpt-5-mini'
npm start
```

These are placeholders; never commit real credentials. API calls may incur charges. The server also supports the legacy local configuration file under `LOCALAPPDATA/Wishouse/openai.json` on Windows. Environment variables take precedence. `.env` files are not automatically loaded.

## Using the tool

1. Choose Chinese or English and inspect the spatial view.
2. Select the scope of a request: a user, a floor, or the whole building.
3. Describe workplace needs and choose a demand multiplier (1–100).
4. Review the proposed relative weights and spatial preview. Confirm to apply and animate handling.
5. Use the dispatch view for manual retrieval, storage, or batch relocation. The planner checks inventory and access constraints before playback.
6. Save snapshots in the browser, export them as JSON, and compare a source and target snapshot for scheduling.

The five demand dimensions are focused work, meetings, labs/making, social space, and garden terraces. Weights are relative, not percentages. Unchanged weights can still lead to different module counts. Automatic roof gardens also affect the displayed total.

The warehouse supports 64 positions per use, with 16 visible tiers; excess stored modules are hidden visually but remain available to the planner.

## Presentation mode

Presentation mode hides editing controls and keeps the chat, multiplier, spatial view, and dispatch animation prominent. Personal snapshots and chat histories are **not distributed** with this repository.

To set up the recorded classroom scenario in a fresh browser:

1. Save your baseline as `均衡基础版 · 自动屋面花园`.
2. From that baseline, submit an English whole-building request at ×20, preview it, confirm, and let dispatch finish.
3. Save the result as `Classroom AI · Meetings ×20`. The application attaches the completed AI request and initial inventory to the snapshot.
4. Enter Presentation and use **Reset to demo baseline**, then **Play recorded result**.

Example request:

> Across the whole building, we need more meeting rooms for team workshops. We use the gardens less often, so please increase meeting space and reduce garden terraces. Keep focused work, labs and social-space demand unchanged.

Saved-result playback does not call GPT again. Sending a new request does, and its interpretation may differ. The original classroom pairing uses these exact archive names; rename them only if you also update `dist/office-archives-ui.js`.

## Development and tests

```sh
npm run check
npm test
```

Tests use Node's built-in test runner. HTTP tests need local loopback networking; they do not require a real OpenAI key.

- `dist/office-model.js`: geometry, demand, module allocation, roof gardens.
- `dist/office-logistics.js`: warehouse capacity and handling planner.
- `dist/office-view.js`: rendering, interaction, and animation.
- `dist/office-ai-chat.js`: preview and confirmation workflow.
- `office-ai.cjs`: server-side AI request handling.
- `skills/adaptive-office-design/`: office design instructions and response contract.
- `tests/`: model, archive, AI, and scheduling checks.

Some residential compatibility code remains in the source; the office interface is the primary entry point. Legacy compatibility checks use committed checksums and do not require the author's original residential project.

## Data and scope

Snapshots and chat history are stored in the browser. Export important snapshots before clearing browser data. Live AI requests send the submitted text, limited conversation history, and selected building summaries to OpenAI; credentials stay on the server. This is a local educational simulation, not a structural engineering or construction control system. GitHub Pages alone cannot run the Node AI backend.

## License

Application code: MIT. Bundled fonts retain their own SIL Open Font License and attribution under `dist/fonts/`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
