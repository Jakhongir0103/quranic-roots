# Render deployment

This app is a TanStack Start web service. Deploy it on Render as a Web Service, not a Static Site, because the AI features run through server functions.

## Required environment variables

- `GEMINI_API_KEY`: Google Gemini API key used by the server functions.
- `GEMINI_MODEL`: Optional. Defaults to `gemini-3-flash-preview`.
- `GOOGLE_TTS_API_KEY`: Google Cloud Text-to-Speech API key used to synthesize Arabic audio.
- `GOOGLE_TTS_LANGUAGE_CODE`: Optional. Defaults to `ar-XA`.
- `GOOGLE_TTS_VOICE`: Optional. Defaults to `ar-XA-Wavenet-B`.
- `OPENAI_API_KEY`: OpenAI API key used by Stage 5 speech-to-text.
- `OPENAI_STT_MODEL`: Optional. Defaults to `whisper-1`.

## Render settings

- Runtime: Node
- Node version: `22.12.0` or newer
- Build command: `npm ci && npm run build`
- Start command: `npm start`

The included `render.yaml` can be used as a Render Blueprint. Learning progress and decks are stored locally in the user's browser with Dexie/IndexedDB, so no hosted database is required.

Arabic TTS is generated server-side through Google Cloud Text-to-Speech and played in the browser as MP3 audio. Make sure the Text-to-Speech API is enabled for the Google Cloud project that owns `GOOGLE_TTS_API_KEY`.

Stage 5 speech-to-text is generated server-side through OpenAI audio transcriptions. The browser records a short WebM clip, sends it to the server function, and receives Arabic text back for the reply box.
