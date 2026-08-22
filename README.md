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
- GitHub credentials remain in the current browser and are sent only to `api.github.com`.

## Verification

```bash
npm test
npm run lint
npm run build
```

Product workflows, measurable UX budgets, and release criteria are documented in
[`docs/ux-foundation.md`](docs/ux-foundation.md) and
[`docs/ux-regression-checklist.md`](docs/ux-regression-checklist.md).

Pushing `main` deploys the production build through the GitHub Pages workflow.
