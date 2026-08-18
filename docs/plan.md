# Thread — product and implementation plan

> Write chronologically. Thread organizes contextually.

Thread is a daily-first, local-first outliner. The journal is the source of truth, blocks are
the atomic unit, and threads are derived views over those blocks. The application is a static
React app deployed from a public GitHub repository; a separate private GitHub repository stores
the user's data through a fine-grained personal access token held only in the browser.

This plan deliberately follows the proven deployment and sync model in `mayank-meragi/reps`,
while changing the domain model and local database strategy for a long-lived block graph.

---

## 1. Product contract

The product promise is:

1. Opening the app always lands on Today with the cursor ready.
2. Capturing a thought never requires choosing a note, folder, tag, or database.
3. User-written blocks remain intact. AI may annotate, connect, summarize, and resurface them,
   but never silently rewrites or relocates them.
4. Every generated claim in a thread view links back to its source block.
5. The app is useful before AI is configured and while offline.
6. The user owns both the application code and the data repository.

The core loop is:

`Write -> connect -> resurface -> continue`

### Source and projection layers

Thread has a hard boundary between two kinds of data:

- **Source:** journal blocks and explicit user actions. This is canonical.
- **Projection:** entity detection, inferred relationships, generated summaries, thread sections,
  and resurfacing scores. This is rebuildable and may change as the intelligence improves.

That boundary prevents the AI from gradually mutating the user's history.

---

## 2. Scope

### Version 1: the complete core loop

- Daily outliner with fast keyboard editing, nesting, tasks, block zoom, and undo/redo.
- Explicit `[[wikilinks]]`, block references, backlinks, and a global command/search palette.
- Automatic thread views with current direction, open tasks, decisions, and recent thoughts.
- Deterministic parsing of links, tasks, dates, and block references.
- Optional AI classification and synthesis using a user-supplied provider key.
- A transactional local database for all reads and writes, with GitHub replication in the
  background.
- A Markdown-canonical WYSIWYG editor: formatting is rendered while editing, while portable
  Markdown remains the stored source format.
- Installable PWA, responsive layout, light/dark themes, import, and JSON/Markdown export.
- Inspectable provenance for every AI-generated thread item.

### Not in version 1

- Real-time collaborative editing or shared workspaces.
- Native mobile/desktop apps.
- End-to-end encryption. The private GitHub repository is the access boundary.
- Canvas/whiteboard, databases, tables, or arbitrary page builders.
- A general chatbot. Background organization matters before conversational AI.
- Browser extensions, email/calendar ingestion, voice transcription, or web clipping.
- Fully autonomous AI while the app is closed. That can be added with an opt-in GitHub Action.

---

## 3. Primary experience

### Today

Today is the home screen and the writing surface. The app focuses the last empty block on load.
The date is navigable, but there is no "new note" action.

The editor is WYSIWYG for Markdown. Typing `**important**` turns it into visible bold text; links,
headings, code, quotes, task states, and lists render in place instead of appearing in a source and
preview split. A temporary "show Markdown" command is available for users who need to inspect or
repair the underlying syntax, but source mode is not the normal writing experience.

Keyboard behavior:

- `Enter`: create the next sibling.
- `Tab` / `Shift+Tab`: indent / outdent.
- `Backspace` on an empty block: remove it and focus the previous block.
- `Alt+Up/Down`: move the current subtree.
- `Cmd/Ctrl+Enter`: toggle task state.
- `Cmd/Ctrl+K`: search or link a thread/block.
- `Cmd/Ctrl+Shift+.`: zoom into the current block.
- `/task`, `/decision`, `/idea`: apply an explicit semantic hint without changing the text.

Autosave commits each editor transaction to the local database immediately. GitHub sync is a
separate background process after a short idle period and on tab hide; typing and reading never wait
on GitHub.

### Editor behavior and storage contract

- Use one Milkdown/ProseMirror editor for the visible daily outline, not one editor instance per
  block. Custom list-item nodes carry stable block IDs and map editor transactions back to changed
  block records.
- Persist canonical Markdown per block. ProseMirror JSON is an ephemeral editor representation and
  may be cached for faster restoration, but it is never the only copy of the content.
- Support a deliberate CommonMark/GFM subset in v1: paragraphs, headings, emphasis, strong,
  strikethrough, links, inline code, fenced code, blockquotes, ordered/unordered lists, and tasks.
- Add custom Markdown extensions for `[[wikilinks]]` and `((block-id))`; both render as interactive
  inline nodes while round-tripping to their original syntax.
- Pasting Markdown parses and renders it. Copying a selection produces both rich HTML and clean
  Markdown/plain-text clipboard formats.
- Every supported construct must pass Markdown -> editor -> Markdown round-trip fixtures before it
  ships. Unsupported HTML is escaped rather than silently retained or executed.

### Thread view

Opening `[[Browser]]` shows a living view assembled from source blocks:

- **Current direction** — a concise synthesis with source links.
- **Open tasks** — unresolved task blocks related to the thread.
- **Decisions** — dated decision blocks, newest first.
- **Recent thoughts** — chronological source blocks grouped by day.
- **Related threads** — high-confidence explicit or inferred relationships.

Generated sections are visually distinct from verbatim source blocks. A "Why this is here" action
reveals the evidence, classifier, confidence, and generation time. Users can correct an entity,
exclude a block, pin a summary, or mark two threads as the same; corrections become durable rules.

### Search and resurfacing

The command palette searches block text, threads, people, projects, dates, and commands. Search is
local and instant after initial sync. Today may show one quiet resurfacing card when it has strong
contextual value—for example, an unresolved task or a prior decision related to a phrase just typed.
It never interrupts typing and can be dismissed permanently.

### Settings and trust

- GitHub repo, branch, token replacement, sync state, and force resync.
- Optional AI provider/model/key and a clear usage estimate.
- AI activity log: inputs referenced, projections changed, and rebuild controls.
- Export all data, import a backup, clear the local database, and disconnect this browser.

---

## 4. Information architecture

Desktop uses a writing-first three-region layout:

```text
+------------------+--------------------------------------+----------------------+
| Today            | Tuesday, Aug 18                      | Context              |
| Journal          |                                      |                      |
| Threads          |  • Need to improve onboarding        | Browser              |
| Search           |    • simplify auth flow              | Current direction... |
|                  |    • talk to [[Rahul]]                |                      |
| Recent threads   |                                      | 3 backlinks          |
|  Browser         |  • [[Browser]]                       | 2 open tasks         |
|  Onboarding      |    • Start with omnibox commands     |                      |
+------------------+--------------------------------------+----------------------+
```

- The center column is the product. It stays calm and readable at roughly 680–760 px.
- The left rail collapses to icons and can disappear entirely in focus mode.
- The right context rail appears only when a linked entity or block is focused.
- Mobile uses a single column with bottom navigation: Today, Threads, Search. Context opens as a
  sheet, and all editor gestures have keyboard-independent equivalents.

---

## 5. Visual direction

Thread should feel like a precise working notebook, not a document editor clone or AI dashboard.

### Tokens

| Role | Value |
|---|---|
| Canvas | `#F6F7FB` — cool, quiet gray-blue |
| Paper | `#FFFFFF` |
| Ink | `#171923` |
| Muted ink | `#697084` |
| Thread | `#5965F2` — indigo used for links, focus, and provenance |
| Decision | `#B76A20` — reserved semantic accent |

- Display/date face: **Newsreader**, used sparingly for dates and thread titles.
- UI/body face: **IBM Plex Sans** for dense, highly legible writing and controls.
- Utility face: **IBM Plex Mono** for timestamps, sync details, and block IDs.
- Fonts should be self-hosted; the deployed app should load no third-party runtime scripts.

### Signature element

The left edge of nested blocks becomes a subtle **stitch line**: a continuous thread-colored line
that follows indentation, strengthens on focus, and can visually travel into the context panel to
show where a resurfaced item came from. This makes provenance tangible without decorating every
surface. Motion is limited to one short stitch-drawing transition when opening a thread and is
disabled under `prefers-reduced-motion`.

This direction intentionally avoids Reps' rounded fitness-dashboard cards. The underlying hosting
and data architecture are shared; the identity and interaction model are specific to long-form
thinking.

---

## 6. Technical architecture

### Stack

| Layer | Choice |
|---|---|
| App | React 19 + Vite + TypeScript |
| Routing | React Router with `HashRouter` for GitHub Pages |
| Styling | Tailwind 4 + small Radix/shadcn primitive set |
| Server state | TanStack Query |
| Primary local database | IndexedDB via Dexie; all product reads/writes originate here |
| Outline ordering | Fractional index strings, avoiding sibling-wide rewrites |
| Editor | Milkdown on ProseMirror + Remark; WYSIWYG with Markdown serialization |
| Validation | Zod schemas at persistence and command boundaries |
| Search | MiniSearch or FlexSearch, indexed locally |
| AI | Vercel AI SDK Core with provider adapters; key supplied by the user |
| Testing | Vitest + Testing Library + Playwright |
| Hosting | GitHub Pages from public `mayank-meragi/thread` |
| Data | Private `mayank-meragi/thread-data` via GitHub Contents API |

Use the Reps modules as the starting point for GitHub requests, sync status, date helpers,
onboarding, Pages deployment, and provider setup. Do not port its localStorage file cache. Thread's
Dexie database is the application's primary working store and persistent state manager: every read
comes from indexed tables or live queries, and every write is committed locally in a transaction
before it enters the sync outbox. GitHub is the durable remote replica and recovery history, not the
database queried during normal interaction. Keep only credentials and tiny bootstrap preferences in
localStorage.

### Application layers

```text
src/
  app/                 # router, shell, providers, error boundaries
  features/
    today/             # daily navigation and editor composition
    outline/           # block rows, selection, nesting, keyboard model
    threads/           # thread view, corrections, provenance
    search/            # local index and command palette
    settings/          # GitHub, AI, export, activity
  lib/
    commands/          # typed read/write command registry
    data/              # repositories; only commands may mutate data
    github/            # Contents API client and credential validation
    sync/              # outbox, conflict merge, retries, status
    inference/         # deterministic extraction + AI projection pipeline
    selectors/         # pure derived views used by UI and AI
    search/            # indexing adapters
  db/                  # primary Dexie database, repositories, indexes, migrations
  workers/             # search indexing and projection work off the UI thread
```

As in Reps, UI writes should pass through a typed command registry. It provides a single place for
validation, audit history, undo, sync invalidation, and future AI tools. Credential entry and purely
visual state stay outside the domain command surface.

---

## 7. Domain model

```ts
type BlockKind = 'bullet' | 'task'
type SemanticHint = 'decision' | 'idea' | 'person' | 'project'

interface Block {
  id: string
  day: string                 // YYYY-MM-DD; original journal location
  parentId: string | null
  rank: string                // fractional ordering key
  markdown: string            // canonical user-authored Markdown for this block
  kind: BlockKind
  checked?: boolean
  semanticHint?: SemanticHint
  createdAt: string
  updatedAt: string
  deletedAt?: string          // tombstone for cross-device deletes
}

interface ThreadDefinition {
  id: string
  title: string
  normalizedTitle: string
  aliases: string[]
  type: 'topic' | 'project' | 'person' | 'place' | 'other'
  origin: 'explicit' | 'inferred'
  status: 'active' | 'archived' | 'merged'
  mergedInto?: string
  pinned?: boolean
  createdAt: string
  updatedAt: string
}

interface Annotation {
  id: string
  blockId: string
  threadId: string
  relation: 'mentions' | 'about' | 'decision' | 'task' | 'supports' | 'contradicts'
  source: 'syntax' | 'user' | 'ai'
  confidence: number
  model?: string
  promptVersion?: string
  createdAt: string
  dismissedAt?: string
}

interface ThreadProjection {
  threadId: string
  currentDirection?: { text: string; sourceBlockIds: string[] }
  openTaskBlockIds: string[]
  decisionBlockIds: string[]
  recentBlockIds: string[]
  related: Array<{ threadId: string; sourceBlockIds: string[]; score: number }>
  generatedAt: string
  inputHash: string
  generatorVersion: string
}
```

Thread-specific inline syntax stays deliberately small on top of CommonMark/GFM:

- `[[Thread name]]` creates or links a thread.
- `((block-id))` embeds a transclusion that remains visibly sourced.
- URLs are linkified.
- Supported Markdown formatting renders directly in the editor; raw HTML is never accepted.

### Local database schema

The browser database is named `thread-v1` and initially contains:

```text
blocks           id, day, parentId, rank, updatedAt, deletedAt
threads          id, normalizedTitle, type, status, updatedAt
annotations      id, blockId, threadId, relation, source, confidence
projections      threadId, generatedAt, inputHash
rules            id, kind, updatedAt
dailyMeta        day, blockCount, updatedAt, remotePath, remoteSha
outbox           ++sequence, aggregateType, aggregateId, operation, createdAt, attempts
conflicts        id, blockId, localMarkdown, remoteMarkdown, detectedAt, resolvedAt
activity         id, at, source, command
syncMeta         key, value
editorSnapshots  day, documentJson, sourceHash, savedAt
```

- Domain commands update the relevant records, activity entry, and outbox item in one Dexie
  transaction. A crash cannot leave a visible edit without a pending sync operation.
- React consumes narrow `useLiveQuery` queries so editing one block does not reload an entire year
  or hold the complete database in memory.
- Database schema versions have forward migrations and are exercised against fixture databases in
  CI. A migration backup is exported locally before any destructive transform.
- The optional editor snapshot accelerates reopening a large day. Its source hash must match the
  current blocks; otherwise it is discarded and rebuilt from canonical Markdown.
- Search indexes and AI projections are derived stores. They can be cleared and rebuilt without
  affecting journal content.

---

## 8. GitHub data layout

```text
schema.json
settings.json
days/2026/2026-08-18.json          # { date, blocks[] }
threads/definitions/ba/browser.json
annotations/2026/2026-08-18.json   # disposable derived annotations
projections/ba/browser.json        # disposable materialized thread view
rules/entities.json                # user merges, aliases, exclusions, corrections
activity/2026-08.json              # command and AI audit trail
manifests/2026.json                # existing days/months for efficient discovery
```

Thread files are sharded by the first two characters of a stable ID to avoid large directories.
Daily source files are small, human-inspectable, and naturally partition conflicts. Projections can
always be deleted and rebuilt from day files plus correction rules.

### Sync behavior

1. A command commits canonical records, an audit entry, and an outbox operation atomically in the
   local Dexie database.
2. UI updates optimistically from the local database.
3. After two seconds idle, sync reads the current remote blob SHA and writes through the Contents
   API. It also flushes on tab hide and when connectivity returns.
4. On a SHA conflict, daily files merge blocks by ID. Newer `updatedAt` wins; tombstones win over
   older live records. Different blocks never overwrite each other.
5. If the same block changed differently on two devices, keep the winner in place and record the
   losing text in a recoverable conflict log surfaced to the user.
6. Derived files use input hashes and may be regenerated instead of merged.

The MVP can use one Contents API request per changed file, like Reps. A later optimization may use
the Git Data API to commit a batch atomically, but it should not delay the first usable release.

---

## 9. Intelligence pipeline

Intelligence runs after the source write is safe locally; it never blocks typing or sync.

### Stage 1: deterministic extraction

On every changed block, parse explicit wikilinks, block references, task state, dates, URLs, and
semantic commands. This stage is instant, works offline, and creates high-confidence annotations.

### Stage 2: candidate retrieval

The local search index retrieves likely existing threads and relevant blocks. Only the changed
block, its parent/children, nearby daily context, candidate thread definitions, and a capped set of
prior source blocks are sent to the model. The full repository is never sent by default.

### Stage 3: structured classification

The model returns validated JSON: candidate entities, block type, relationships, confidence, and
short rationale. Low-confidence new entities remain suggestions; explicit links and high-confidence
matches may update projections automatically. No model response can mutate source blocks.

### Stage 4: projection update

Affected thread views are recomputed. Tasks and chronological sections are deterministic selectors.
Only synthesis fields such as "Current direction" use generation, and every sentence carries source
block IDs. Recompute only when the input hash changes.

### Stage 5: correction learning

User actions—merge threads, rename, exclude a block, change a type, pin a summary—write explicit
rules. Rules override model output and are included in future inference context.

### Trigger policy

- Wait until editing has been idle for roughly 8–12 seconds.
- Batch all dirty blocks from the current session.
- Pause when offline, hidden, on low battery when detectable, or over a user-set daily budget.
- Provide "Organize now" and "Rebuild projections" controls.
- Store model, prompt version, token usage, input references, and output in the activity log.

An optional post-v1 GitHub Action can process committed blocks while the app is closed. It requires
the user to place an AI key in the private data repo's Actions secrets and should remain opt-in.

---

## 10. Security and privacy

- Onboarding asks for a fine-grained PAT restricted to `thread-data` with only
  **Contents: read and write** permission and an expiration date.
- The token and AI key remain in this browser. They are sent only to GitHub and the selected model
  provider. The app must say this plainly, as Reps does.
- A static browser app cannot make a stored PAT secret from JavaScript running on the same origin.
  Therefore: no analytics, no ad scripts, no third-party runtime JavaScript, strict CSP, dependency
  review, escaped rendering, and no raw HTML/Markdown execution.
- The code repository may be public; the data repository should be private.
- "Disconnect" removes credentials, local database records, search indexes, and the outbox from the
  current browser after confirming no unsynced changes remain.
- GitHub commit history is a recovery mechanism, not a substitute for export. Offer a full portable
  JSON export and chronological Markdown export.

---

## 11. Performance and accessibility budgets

- Today becomes editable from the local database without waiting for GitHub.
- Typing must not cause network calls, React tree-wide rerenders, or synchronous search indexing.
- Keep a day with 1,000 blocks responsive; virtualize only beyond a threshold so normal keyboard
  navigation remains simple.
- Run indexing and AI preparation in Web Workers.
- Lazy-load thread analytics and AI provider adapters.
- All editing actions have keyboard and touch paths; focus is always visible.
- Use semantic buttons, ARIA tree relationships where practical, 44 px touch targets, and 16 px
  mobile inputs. Respect reduced motion and system contrast/theme settings.

---

## 12. Delivery sequence

### Milestone 0 — foundation

- Scaffold React/Vite/TypeScript/Tailwind and the GitHub Pages workflow.
- Port and namespace the Reps GitHub client, onboarding, sync status, and credential settings.
- Add the primary Dexie schema, live-query repositories, transactional outbox, migrations, command
  registry, audit log, and seed data.
- Prove a round trip: create today's file offline, sync it, reload on another browser.

**Exit:** app deploys, connects to a private repo, and survives offline edits plus a SHA conflict.

### Milestone 1 — the daily outliner

- Integrate one Milkdown/ProseMirror daily editor with stable block-ID nodes and canonical Markdown
  serialization.
- Today/date navigation, block CRUD, focus model, nesting, moving, tasks, zoom, undo/redo, and a
  source-inspection mode.
- WYSIWYG formatting, Markdown shortcuts, mobile behaviors, rich/Markdown paste and copy, and
  Markdown day export.
- Autosave, tombstones, and multi-device conflict recovery UI.

**Exit:** Thread is already worth using daily without AI.

### Milestone 2 — explicit connections

- `[[wikilinks]]`, thread definitions, backlinks, block references, thread view, local search.
- Deterministic task/decision/recent selectors and provenance drawer.
- Rename, alias, merge, archive, pin, and exclude controls.

**Exit:** the example Browser view can be produced entirely from explicit links.

### Milestone 3 — background intelligence

- Provider setup, structured inference pipeline, context retrieval, confidence policy.
- Automatic entity candidates, relation annotations, current-direction synthesis.
- Activity/usage log, correction rules, organize/rebuild controls, failure recovery.

**Exit:** repeated unlinked mentions can form a trustworthy living thread without changing source.

### Milestone 4 — resurfacing and hardening

- Contextual resurfacing, unresolved-item prompts, related threads.
- PWA install/offline shell, full import/export, schema migration tests, performance tuning.
- Cross-browser and accessibility pass; threat-model dependencies and content rendering.

**Exit:** stable daily-driver release.

---

## 13. Verification strategy

- Unit tests: outline transforms, fractional ordering, Markdown round trips, parser, selectors,
  merge rules, and database migrations.
- Property tests: arbitrary indent/move/delete sequences never orphan live blocks or create cycles.
- Contract tests: every persisted shape validates; every write command produces an audit record and
  an undo or explicit non-undoable reason.
- Sync tests: offline queue, stale SHA, two-device edits to separate blocks, same-block conflict,
  tombstone vs edit, token expiry, and rate limiting.
- AI tests: golden fixtures for classification, source-citation validation, input-hash idempotence,
  malformed output, provider failure, and the invariant that source files are unchanged.
- Playwright journeys: first run, fast capture, nesting, task completion, explicit thread, inferred
  thread, mobile editing, refresh while dirty, reconnect, export, and disconnect.
- CI gates: typecheck, lint, unit tests, production build, and Playwright smoke test before Pages
  deployment.

---

## 14. First release acceptance scenario

Given an empty account, the user connects `thread-data`, writes the sample Aug 18 outline, closes the
tab before sync completes, reopens offline, and sees every block. When online returns, the data syncs.
Opening `[[Browser]]` shows its recent thoughts and task deterministically. After AI organization,
"Current direction" and the Aug 18 decision appear with clickable source blocks. Editing a source
block updates the view; dismissing an incorrect relationship prevents it from returning; exporting
the journal produces readable Markdown independent of Thread.

That scenario is the product in miniature. Anything that does not strengthen it should wait.

---

## 15. Decisions to lock before implementation

Recommended defaults:

1. **Repository names:** public `mayank-meragi/thread`, private `mayank-meragi/thread-data`.
2. **Editor format:** Milkdown WYSIWYG with canonical Markdown per block; editor JSON is disposable.
3. **AI availability:** optional; explicit links and tasks work without it.
4. **Inference timing:** client-side after idle, with manual retry and a visible budget.
5. **Source policy:** AI cannot edit or move source blocks—ever.
6. **Collaboration:** single-user, multi-device; no concurrent shared editing in v1.

The only decision likely to change the foundation is whether AI must operate while the app is
closed. If yes, design the private data repository's GitHub Action during Milestone 0; otherwise the
client-side pipeline is simpler, safer, and consistent with Reps.
