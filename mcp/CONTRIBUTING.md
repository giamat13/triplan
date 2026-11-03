# Contributing

Thanks for helping. Keep changes small and tested.

## Setup

- Node 22 or later. Run `npm install`, then `npm run typecheck`.
- `TRIPLAN_MOCK=1 PORT=<free port> npm run dev` starts the server with in-memory data. Use a fresh port each time, because an old dev server keeps answering with old code.
- `npm test -- http://localhost:<port>/mcp` calls every tool through a real MCP client. It fails on errors, empty output, or a tool the script does not call.

## Rules test (real firestore.rules)

Start the Firebase emulators (auth and firestore) from the triplan repo with Java 21 on `PATH`, then run the server with `FIREBASE_EMULATOR=1`, `TRIPLAN_EMAIL`, `TRIPLAN_PASSWORD` and `MCP_SECRET`. The emulator test refuses to run without `FIREBASE_EMULATOR=1`, because it writes data.

## Adding a tool

1. Register it in `src/server.ts` with a zod schema (limits and an example per field), a one-sentence description, and the right annotations.
2. Wrap the handler in `safe(...)`, name the data source in the result, and return text plus `structuredContent` for the card.
3. Add it to `scripts/test-client.ts`.
4. Document it in the README tool table.

## Pull requests

Use Conventional Commits (`feat:`, `fix:`, `docs:`). No secrets in the repo; keys come from `process.env`.
