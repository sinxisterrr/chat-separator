# Chat Separator website

A browser-only interface for sorting threads from a ChatGPT
`conversations.json` export into 14 AI slots and downloading the result as a
zip archive.

The uploaded export never leaves the browser. The site has no API routes,
database connection, embedding service, analytics integration, or other
server-side processing.

## Environment variables

None.

The `DATABASE_URL` and `EMBEDDER_URL` variables in the parent project's
`.env.example` belong to the older command-line parser and are not read by the
website.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run build
npm run start
```

The production page is statically rendered. Fonts use local system fallbacks,
so the build does not need to download assets from Google Fonts.

## Usage

1. Upload a ChatGPT `conversations.json` export.
2. Assign each thread to one or more numbered AI slots, or skip it.
3. Use **Back** to undo the most recent assignment.
4. Select **Done** at any time or categorize every thread.
5. Download `categorized-conversations.zip`.

Only non-empty slots are included in the archive as `ai1.json` through
`ai14.json`.
