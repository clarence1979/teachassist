# Teach Assist — standalone edition

One HTML file. Bring your own Claude and/or OpenAI key — or use a free **on-device model** that runs inside the browser with no key and keeps working offline. Same machinery the web interfaces use, so the answers — and the Word/PowerPoint/Excel/PDF files — come out the same.

## Files

| File | What it is |
|---|---|
| `teach-assist.html` (in `dist/`) | The whole app — chat, Studio, Tasks, Timetable, Library — in one file. Open it in Chrome/Edge/Firefox, or host it anywhere static (GitHub Pages, Netlify). |
| `sw.js` | Service worker (served next to the page). Lets the app open without a connection so on-device AI works offline. Optional — everything else works without it. |
| `anthropic-files-relay.js` | 60-line Cloudflare Worker. Needed for Claude to *return* generated documents and to *receive* your Word/Excel attachments (see "Why a relay?"). OpenAI needs nothing extra. |

## Setup (5 minutes)

1. Open `teach-assist.html` → **Settings** → paste your Anthropic and/or OpenAI key → **Test**. Keys live only in that browser's localStorage and go straight to the provider.
2. **Claude users — deploy the relay once:** Cloudflare dashboard → Workers & Pages → Create → "Hello World" → replace the code with `anthropic-files-relay.js` → Deploy → copy the `https://….workers.dev` URL into Settings → "Claude files relay URL" → **Test**. (Optional: set the `ALLOWED_ORIGIN` variable to the origin you open the app from, e.g. `https://you.github.io`, or `null` for `file://`.)
3. Pick a model (the live list from your key; defaults to `claude-fable-5-1` / `gpt-6-astra`), an effort level, and go.

Everything is stored in the browser (IndexedDB): conversations, attachments, generated files, tasks, timetable blocks and the library. There is no account and no server. See "History file, sessions and clearing memory" for how that storage is mirrored into a JSON file and how to clear it.

## What was wrong with the Bolt project

The output was inferior to claude.ai / ChatGPT for structural reasons, not prompt-wording ones:

1. **Document generation threw away the conversation.** When you asked for a document, the chat model only emitted `{topic, yearLevel, type, length}`. A *second*, hard-coded model (`gpt-4o` if you had an OpenAI key, else `claude-sonnet-5` — never the model you picked) then wrote the content from a bare template prompt. It never saw your uploaded files, your instructions, or anything said earlier in the chat.
2. **The prompt ordered thin output.** The JSON schema prompt said "keep paragraph strings tight (2–4 sentences)", "no markdown", "under 200 words" for some types; `max_tokens` was 4,000 for a whole document, `temperature 0.4`, then a hand-rolled pdf-lib/docx renderer with fixed sections. A 30-second tool timeout killed anything longer.
3. **Reasoning was crippled.** For OpenAI it sent `reasoning_effort: 'none'` whenever tools were present, and if the chosen model rejected tools it silently substituted *another model from the catalog*. For Claude, tool results were faked as plain text in a user message ("Continue — use these tool results…") instead of real `tool_result` blocks, so thinking continuity across tool rounds was lost; `MAX_TOOL_ROUNDS = 4`.
4. **Wrong API surface.** It used Chat Completions. The web interfaces produce documents by writing them *in a code sandbox* (claude.ai: code execution + the docx/pptx/xlsx/pdf Skills; ChatGPT: code interpreter), with web search, native file inputs and persisted reasoning — none of which Chat Completions offers.
5. **Uploads were flattened.** PDFs → pdf.js text only (tables, diagrams, scanned pages lost); DOCX → raw text (headings/tables lost); XLSX/CSV/PPTX unsupported; everything capped at 120k characters. Both web UIs send PDFs natively (text + page images) and let the model open spreadsheets with code.
6. **A regex "pre-flight clarifier"** intercepted any message containing *notes*, *test*, *lesson*, *quiz*, *handout*… and made a separate temperature-0 call that asked you a question instead of answering.
7. **System prompt noise.** Fifty lines of MANDATORY/NEVER/CRITICAL and date tables push the model toward tool calls and defensive behaviour rather than good work.

## What this edition does instead

| | Claude (Anthropic) | OpenAI |
|---|---|---|
| API | Messages API, streaming | **Responses API**, streaming, `previous_response_id` chaining (reasoning + sandbox state persist like ChatGPT) |
| Reasoning | Adaptive thinking (`display: summarized`), `output_config.effort` low→max. Thinking/signature blocks replayed verbatim. The request prefix is kept byte-identical (current Claude models bind thinking to it): `system` and `tools` are frozen per conversation, user turns are frozen as sent, and later changes (date rollover, profile edits, relay set-up) go in as mid-conversation `role: "system"` notes. Partial/errored turns are pruned before replay | `reasoning.effort` low→max with summaries; never `none` |
| Web | `web_search` + `web_fetch` server tools (current versions, AU location from your timezone), citations → Sources list | `web_search` tool with `user_location`, `url_citation` → Sources |
| Documents | **Code execution sandbox + Anthropic's docx/pptx/xlsx/pdf Skills** (the same Skills claude.ai uses). Files copied to `$OUTPUT_DIR` come back as `file_id`s → download cards via the relay | **code_interpreter** container; files cited (`container_file_citation`) *and* discovered by listing the container → download cards; `sandbox:/mnt/data/…` links become download links |
| Uploads | PDF → native `document` block (vision + text); images native; CSV/TXT/MD → `text/plain` document; DOCX/XLSX/PPTX → uploaded to the sandbox (`container_upload`) via the relay *plus* a client-side text extract (mammoth / SheetJS) so the model can read them without code | PDF/DOCX/XLSX/CSV/TXT → Files API → `input_file` (native parsing) *and* into the code-interpreter container |
| Images | `generate_image` tool backed by your OpenAI key (gpt-image-2 / 2.5) | built-in `image_generation` tool |
| Long turns | `pause_turn` continuation, container reuse across turns (30-day sandbox) | container auto-reuse within the response chain |
| Robustness | Self-heals 400s: lowers `max_tokens` to the model max, drops unsupported `display`/`effort`, falls back to legacy tool versions, strips invalidated thinking blocks | Steps effort down (max→xhigh→high…), drops `summary`/`include`, falls back from an expired `previous_response_id` to full history |
| Prompt | Short, calm system prompt: answer-first, complete classroom-ready resources, accuracy over speed, build real files, read SKILL.md first, summarise after | same, adapted to the python tool and `/mnt/data` |

Thinking cards, tool cards (query / code / output), file cards, usage line (in/out/reasoning tokens, searches), edit-and-resend, regenerate, stop, per-conversation Web/Code toggles (changing them mid-chat resets Claude's saved reasoning for that chat — by design of the API), light/dark, mobile layout.

Independently reviewed against the fetched API docs after building; the review's blockers (a private field leaking into requests, un-finalised blocks replayed after a Stop/error, mis-ordered self-heal branches) and should-fixes (prefix stability, container reuse, input_file limits, image re-encoding, truncated inline transfers, oversize PDFs) are fixed and covered by the test suite (68 checks).

## Why a relay for Claude?

`api.anthropic.com` allows browser calls to `/v1/messages` (with `anthropic-dangerous-direct-browser-access: true`) but answers every browser-origin request to `/v1/files/*` with `400 Disallowed CORS origin` — verified live on 31 Oct 2026. The Files API is the only way to download what the Skills produce and to put non-PDF files into the sandbox. The Worker forwards *only* `/v1/files/*` with the `x-api-key` the browser already sends; it holds no key and stores nothing.

Without the relay the app still works: Claude is told to print each finished file as base64 in the command output, the browser decodes it into a download, and the base64 is scrubbed from the stored history. That path is capped at ~160 KB per file (the base64 sits in the model's context once, ~60k tokens at the cap), so decks with images need the relay. OpenAI's endpoints are CORS-open, so OpenAI needs no relay.

## Cost notes

Tokens are billed by the provider as usual; the usage line under each reply shows input/output/reasoning tokens and searches. Web search is about US$10 per 1,000 searches on both providers. Claude's sandbox is free when a web tool is in the request (it is, when Web search is on) and otherwise has 1,550 free hours/month; OpenAI's container is ~US$0.03 per session. A document-building turn at high effort typically runs 50–150k tokens.

## The planner: Studio, Tasks, Timetable, Library

The Bolt project's other pages are back, rebuilt on local storage instead of Supabase (left rail, or Alt+1…5):

- **Studio** — twelve resource generators (lesson plan, unit plan, worksheet, quiz/test, slide deck, rubric, exit tickets, differentiate a resource, feedback on student work, letter home, report comments, anything else). A card opens a short form; *Generate now* starts a new chat with the composed request and **Code & files** on, so the model builds the real .docx/.pptx/.xlsx/.pdf with the document toolchain — no second-stage template model. *Open in chat* prefills the request so you can attach files first.
- **Tasks** — inbox / scheduled / done with priority, due date, estimate and tags. *Prioritise with AI* makes one short call to your current model and re-ranks the open tasks with a one-line rationale each. *Schedule* puts work time for a task on the timetable (the task becomes "scheduled").
- **Timetable** — day / week / month / agenda views, click a slot to add, click a block to edit. Blocks have a type (class, prep, meeting, duty, PD, personal, custom), location, notes, attached library files and a linked task. Recurrence is an RRULE subset (daily, weekdays, weekly on chosen days, fortnightly, monthly, with an optional end date); one occurrence of a series can be moved or skipped without touching the rest. Overlaps are outlined. *More ▾* has .ics import/export (Outlook/Google/Compass exports), *Import from a photo/PDF* (the model reads your printed timetable and schedules every class as a weekly block) and *Plan my week with AI*.
- **Library** — every file the assistant produces in any chat is registered here automatically (title, type, size, which chat). Search, download, open the chat, attach to a timetable block, remove.

**The model can use the planner too.** Both providers get the same tool set — `add_task`, `list_tasks`, `update_task`, `delete_task`, `schedule_block`, `list_timetable_blocks`, `update_timetable_block`, `delete_timetable_block`, `clear_timetable_range`, `search_library`, `attach_resource_to_block` — as Claude client tools / OpenAI function tools, with a short system-prompt section (local times, a two-week calendar so it never guesses a weekday, "list before you edit", "clear a range before re-planning"). So "move my Wednesday 9B class to period 3 this week only" or "remind me to book the bus by Friday" just works, and the tool cards in the reply show exactly what changed. Everything the model does lands in the same local stores as what you do by hand.

## History file, sessions and clearing memory

A **session** is one time the app is open in a tab (a reload keeps the same session; a new tab starts a new one). Every chat message, task, timetable block and library file carries the session that created it.

*Settings → History, memory & sessions → Save history* (on by default):

- **On:** everything persists in the browser between visits, and the current session is mirrored into **`teach-assist-history.json`** in the browser's Cache Storage (IndexedDB when the HTML is opened from disk, where Cache Storage isn't available). The file is `{version: 2, sessions: [...]}`; each session holds its exchanges (prompt, reply, attachment and file names, sources, model, token usage, timestamps), tasks, timetable blocks and library entries. The entry is refreshed a couple of seconds after each change and finalised (`endedAt`) when the tab is hidden or closed; if a tab dies before that write lands, the next session that opens notices and closes the entry.
- **Off:** new chats last only for the current session and nothing new is written to the file.
- **Memory on for new chats** (and the *Memory* toggle under the message box) gives the model short summaries of your earlier chats so "the quiz we made last week" means something. It is off by default and per chat.
- **Export history (JSON)** downloads the file; **Import history (JSON)** merges a file back in (rebuilds chats, tasks and blocks that aren't already present — text only; attachments and binary files aren't in the history file).
- **Clear memory** lists the sessions with what each one created. *Clear this session*, tick-and-*Clear selected*, or *Clear all sessions* remove those sessions' chats, tasks, timetable blocks and files from the browser and from the JSON file. Settings and API keys are never touched.

## Look and feel

A light lavender "classroom" design (glass panels over an illustrated background, a robot mascot in a mortarboard, pastel cards) with a matching **dark mode**. Same design everywhere: chat, Studio, Tasks, Timetable, Library, Settings and every form.

- **Header:** logo, a **sun/moon switch** for light/dark, **A− A A+** text size (85–145 %), and an **accessibility** button.
- **Accessibility & display panel:** Light / Dark / Match device, text size, **high contrast**, **easy-read font** (Atkinson Hyperlegible), comfortable line spacing, underlined links, reduced motion. All settings are remembered in the browser.
- **Chat home:** "How can I help today?", three suggestion cards, and quick tools (Create Quiz, Lesson Plan, Worksheets, Slides, More Tools → Studio).
- **Chat sidebar:** New Chat, Chats, **Prompts** (save and reuse your own prompts, plus starters), **Files** (everything you've attached), **Templates** (Studio), **Tools** (tasks, timetable, photo import, plan my week, calendar import/export, history export), **Library**, and Recent Chats.
- **Messages:** your bubble with avatar and time; replies in cards with a toolbar (**Copy, Cut, Paste, Edit, Regenerate, …**), headings shown as banded sections, tick-list bullets, file cards with download buttons, and 👍/👎 feedback (saved with the history).
- **Composer:** Add Files, Paste Image, Code, Web Search, Memory and a **microphone** for dictation (where the browser supports speech recognition).

## On-device AI (free, private, offline)

Pick **On-device** in the provider pill (or *Settings → On-device AI*). The app checks the device — phone, tablet or computer; memory (Chrome/Edge/Android report it; on iPhone/iPad/Safari it is estimated, and iOS caps each tab's memory); WebGPU and 16-bit shader support; free storage — and **suggests the largest model that fits comfortably**. Models that would be slow are marked, ones that won't fit are tucked away.

| Model | Size | Suits |
|---|---|---|
| SmolLM2 360M | ≈ 270 MB | older or low-memory phones |
| Qwen3.5 0.8B | ≈ 560 MB | phones, multilingual |
| Llama 3.2 1B | ≈ 710–810 MB | most phones (the usual phone suggestion) |
| Qwen3.5 2B | ≈ 1.3 GB | recent phones/tablets, laptops |
| Llama 3.2 3B | ≈ 1.8 GB | iPads, 8 GB+ devices |
| Phi-4 mini | ≈ 2.2 GB | laptops — maths and step-by-step reasoning |
| Qwen3.5 4B | ≈ 2.5 GB | laptops with 8 GB+ (the usual laptop suggestion) |
| Qwen3.5 9B | ≈ 5.3 GB | 16 GB+ with a strong GPU |

- **Download once, load from the device after that.** With WebGPU (Chrome/Edge on computers, Chrome on Android, Safari 26) models run on the graphics chip via WebLLM and are kept in Cache Storage; without WebGPU they run on the processor via wllama (llama.cpp in WebAssembly, smaller models only) and are kept in the browser's private file system. The engine libraries are cached too, and the app asks for persistent storage so the browser doesn't clear them. Later sessions and prompts load straight from the device — no re-download — and the chosen model warms up in the background when the app opens.
- **Offline:** with `sw.js` alongside the page (GitHub Pages does this), the app itself opens offline. If you're using Claude or OpenAI and the connection drops, replies come from your downloaded model instead (switch off in the On-device AI sheet).
- **What they can't do:** web search, code/files, image reading. PDFs, Word, Excel and text files are read on the device and passed to the model as text (trimmed to its 4k-token window). Any reply can be saved as a Word document from its ⋯ menu.
- Manage models (download, use, delete, storage used) in the **On-device AI** sheet.

## On a phone

The same file adapts itself when the screen is narrow (≤ 640px): the layout follows the phone mockup — header with the light/dark switch and A− A A+, the provider/model/effort pills, the floating bottom tab bar (safe-area aware, hidden while the keyboard is up), the chat sidebar as a slide-in drawer (≡), forms open as bottom sheets with a sticky Save bar and 16px inputs (no zoom-in on tap), the Timetable's week view becomes a **3-day** view you swipe left/right (month and agenda swipe too), and Studio/Library cards stack. Add it to the home screen (Safari → Share → Add to Home Screen; Chrome → Install) and it runs full-screen like an app. Everything — chats, timetable, tasks, files — stays on that device; use *Export history* to move it.

## Development

```
node build.mjs            # inlines art.js, app.js, local-ai.js, timetable-core.js, tools.js, views.js, main.js into teach-assist.html → dist/teach-assist.html
node test/e2e.mjs         # headless Chromium, mocked Anthropic/OpenAI/relay endpoints: chat, documents, uploads, self-healing (68 checks)
node test/keys-history.mjs# main-program keys, history file v2, planner views, model tool loops on both providers, sessions & clearing (86 checks)
node test/mobile.mjs      # iPhone emulation: bottom tab bar, 3-day timetable with swipe, bottom-sheet forms, no horizontal overflow (30 checks)
node test/ui.mjs          # light/dark, text size, accessibility modes, pills, home, sidebar, Prompts/Files, reply toolbar, feedback (37 checks)
node test/local.mjs       # on-device AI with a stubbed engine: device suggestions for 11 device profiles, sheet, download → reload from storage, offline fallback, PDF text, Word download (45 checks)
node test/local-real.mjs  # no stubs: downloads SmolLM2-360M via wllama, chats on the CPU, then reloads OFFLINE and answers from the cached model (needs internet; ~300 MB)
```

Source layout: `art.js` (logo, mascot, illustrations, icons), `app.js` (chat, providers, storage, history), `local-ai.js` (on-device models: device check, catalogue, WebLLM/wllama engines, caching, the On-device AI sheet), `timetable-core.js` (dates, RRULE, ICS), `tools.js` (the planner tools the model calls), `views.js` (Studio/Tasks/Timetable/Library/sessions UI), `main.js` (boot and session lifecycle).

## Running from the main program

When Teach Assist is opened from the main program, it fills the API key fields itself:

1. **Same origin** (the HTML is served from the main program's site): it reads `localStorage.api_cache` (`CLAUDE_API_KEY`, `OPENAI_API_KEY`, `username`), then the individual keys `CLAUDE_API_KEY` / `OPENAI_API_KEY` / `openai_api_key`, then a same-origin parent's `apiCache.get(...)`.
2. **Inside the main program's frame** (any origin): it posts `{type: 'REQUEST_API_VALUES'}` to the parent and accepts `{type: 'API_VALUES_RESPONSE', data: {...}}` (also the older `PEDAGOGY_CREDENTIALS` message). Replies are accepted **only from the parent frame**; set *Settings → Trusted main-program origin* to also pin the parent's origin.

A key you type in Settings is never overwritten; keys that came from the main program refresh when the main program supplies new ones. *Settings → Reload keys from main program* hands control back to the main program.

**Tighten the main program side too:** it currently replies with `postMessage(..., '*')`, so any page loaded in a program's frame can request and receive the keys. In the main program, check `event.origin` against an allow-list before answering `REQUEST_API_VALUES`, and reply with that origin as the target instead of `'*'`.

