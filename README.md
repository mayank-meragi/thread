# Thread

Write chronologically. Thread organizes contextually.

Thread is a local-first daily outliner with a Markdown WYSIWYG editor, living thread views, and
optional GitHub-backed sync.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173/thread/](http://127.0.0.1:5173/thread/).

## Data model

- IndexedDB/Dexie is the primary working database.
- Milkdown stores canonical Markdown while rendering formatting in place.
- `[[wikilinks]]` and their nested blocks build living thread views.
- GitHub sync writes journal days to `days/YYYY/YYYY-MM-DD.md` in a private data repository.
- Undated thread-only notes sync separately to `threads/<thread-id>.md`.
- Durable workspace metadata (manual thread names/templates, schemas, tags, and personas) syncs in `workspace.json`.
- Visible clients check the GitHub branch every five seconds with conditional requests and reconcile only files changed since their last observed commit; opening or refocusing the PWA checks immediately.
- GitHub credentials remain in the current browser and are sent only to `api.github.com`.

## RSS feeds

The desktop **Feeds** workspace is a device-local RSS/Atom reader. Paste a feed URL to subscribe,
refresh on demand (or when the inbox is stale), browse unread entries, and open an entry's original
article. Feed content is sanitized before it is rendered and cached entries are pruned after 90 days
or 500 read entries per feed. By default, feeds are fetched directly from the browser, so a publisher
must allow cross-origin requests. If a publisher blocks that, deploy the included stateless Cloudflare
Worker and configure its URL and access key under **Settings → RSS feeds**. Each user owns their Worker
and secrets; the Thread app never needs a Cloudflare API token. The Worker accepts public HTTP or HTTPS
feeds, rejects credentials/private targets, limits responses to 1.5 MB, and caches successful responses
for five minutes. HTTP upstream feeds are supported, but their contents travel over plaintext and should
be avoided when HTTPS is available.

When a feed only includes a short summary, use **Get full article** in the reader or press `F` to
fetch the original page, extract its readable content locally, sanitize it, and cache it on the entry.
With a configured Worker, the article fetch uses the Worker's `/v1/article` endpoint for publishers
that block browser cross-origin requests.

Automatic refresh runs every 15 minutes while the Feeds workspace is open by default. Change the
interval (5 minutes, 15 minutes, 30 minutes, hourly, or **Off**) under **Settings → RSS feeds**.
The **Refresh all feeds now** button remains available for an explicit check.

### RSS proxy setup

From the repository root:

```bash
npm install
npm run rss-worker:login
npm run rss-worker:secret       # paste the key generated in Settings → RSS feeds
npm run rss-worker:origins      # exact app origin, e.g. https://your-name.github.io
npm run rss-worker:deploy
```

Copy the deployed `workers.dev` URL into RSS settings, paste the same key, and choose **Test and
connect**. For local development, copy `workers/rss-proxy/.dev.vars.example` to
`workers/rss-proxy/.dev.vars` (ignored by Git) and run `npm run rss-worker:dev`. Rotate the key by
running `npm run rss-worker:secret` again and updating the browser setting. The Worker contract is
`GET /v1/status` and `GET /v1/feed?url=…`, authenticated with `Authorization: Bearer <key>`.

## Workout tracking

A workout is an ordinary task subtree in a daily note — a `#[workout]` root, `#[exercise]` children,
and `#[set]` grandchildren:

```markdown
- [ ] #[workout] [[Push Day]]
  - [ ] #[exercise] [[Bench Press]]
    - [x] #[set] Set 1
    - [x] #[set] Set 2
```

- The three structural tags are built-in with stable IDs; the `#[set]` schema carries the optional
  measurement properties (load, unit, reps, RPE, duration, distance, distance unit) and `#[workout]`
  carries start/finish times. Task status is the lifecycle.
- `/workout`, `/exercise`, and `/set` slash commands apply the structural tags in the editor, which
  stays the canonical authoring surface.
- The workout lens at `/workout/:day/:blockId` is a specialized read/write view over that subtree —
  start, log sets, complete, finish, reopen — sharing the same source blocks as the outline. The
  ContextualInspector shows the same role-specific controls per task.
- Today surfaces the day's workouts with Open/Resume and a New workout action. General Tasks shows
  workout roots but hides exercise/set internals unless **Include workout internals** is on. An
  exercise's thread lists its **Workout occurrences** by day.
- No new tables or migration: everything is stored as existing tasks, tags, block properties, and
  daily Markdown, so workout views can always be rebuilt from source.
- A built-in **Workout Coach** persona co-designs a holistic "Training Plan" thread with you
  through conversation (goals, principles, weekly themes — not a fixed exercise list), then programs
  each day's workout from that plan and your recent sessions, proposing it as a confirmed
  `workout.*` ThreadScript action you can open in the workout lens.

Design rationale and phasing are in
[`docs/workout-tracking-implementation-plan.md`](docs/workout-tracking-implementation-plan.md).

## Verification

```bash
npm test
npm run test:worker
npm run rss-worker:typecheck
npm run lint
npm run build
```

Product workflows, measurable UX budgets, and release criteria are documented in
[`docs/ux-foundation.md`](docs/ux-foundation.md) and
[`docs/ux-regression-checklist.md`](docs/ux-regression-checklist.md). The token layer and shared
CSS/React primitives behind the UI are documented in
[`docs/design-system.md`](docs/design-system.md).

The proposed AI action layer is documented in the
[`ThreadScript v1 specification`](docs/threadscript-spec.md), with current and planned app parity
tracked in the [`ThreadScript capability inventory`](docs/threadscript-capability-inventory.md).

Pushing `main` deploys the production build through the GitHub Pages workflow.
