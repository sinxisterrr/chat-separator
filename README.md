# Chat Separator

Chat Separator is a browser-only tool for sorting threads from a
`conversations.json` export into 14 downloadable AI files. It supports
exports from ChatGPT, Claude.ai, and Grok.

The website lives in [`web`](./web). Root-level deployment commands target the
website so generic Node hosting platforms build and serve the correct entry
point:

```bash
npm run build
npm start
```

No environment variables are required for the website.

## Local website development

```bash
cd web
npm install
npm run dev
```

## Legacy command-line categorizer

The original database-backed categorizer remains available, but it is no
longer the repository's default deployment process:

```bash
npm run build:cli
npm run start:cli
```

The command-line tool expects its own input directory and may use the
`DATABASE_URL` and `EMBEDDER_URL` values documented in `.env.example`. Those
requirements do not apply to the website.
