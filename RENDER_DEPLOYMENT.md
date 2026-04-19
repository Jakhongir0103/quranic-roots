# Render deployment

This app is a TanStack Start web service. Deploy it on Render as a Web Service, not a Static Site, because the AI features run through server functions.

## Required environment variables

- `GEMINI_API_KEY`: Google Gemini API key used by the server functions.
- `GEMINI_MODEL`: Optional. Defaults to `gemini-3-flash-preview`.

## Render settings

- Runtime: Node
- Node version: `22.12.0` or newer
- Build command: `npm ci && npm run build`
- Start command: `npm start`

The included `render.yaml` can be used as a Render Blueprint. Learning progress and decks are stored locally in the user's browser with Dexie/IndexedDB, so no hosted database is required.
