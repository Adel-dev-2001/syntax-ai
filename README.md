# Syntax AI

Syntax AI is a browser-based AI chat application for coding help, built with React 19, TypeScript and Vite and powered by Google Gemini. It has no backend of its own: the browser talks to the Gemini API directly, and conversations are kept in the browser's `localStorage`.

---

## Features

| Feature | How it works in this project |
|---|---|
| **Streaming chat** | Responses stream chunk by chunk from the Gemini API (`gemini-3.8-flash`, set in `src/constants/chat.ts`). A stop button stops consuming and displaying further output; it does not guarantee cancellation of the provider's in-flight request or billing. |
| **Branching conversations** | Edit a sent message to start a new branch, then use the arrows to move between versions. |
| **Conversation history** | Chats are listed in a sidebar, can be deleted, and are saved in `localStorage`. |
| **Core memory** | The model can save facts about you (name, preferences) using a hidden `<memory>` tag. They are stored in `localStorage`, added to future prompts, and can be edited or cleared in Settings. |
| **File attachments** | Attach up to 5 supported images, PDFs or text/source files (5 MB per file and 10 MB combined per message). Attachments are sent to Gemini as inline data. |
| **Code blocks** | Code blocks have a copy button. HTML, SVG, CSS, JavaScript and JSX/TSX/React blocks also have a **Run** button that previews them in an iframe, with a fullscreen option. For React code, name the main component `App` or `Example`. |
| **Image generation** | Experimental: the model can write a [Pollinations.ai](https://pollinations.ai) image URL that is rendered inline. This is a third-party service, not native image generation by the chat model; endpoint availability and authentication requirements may change. Reusing a seed does not guarantee image editing or consistent subjects. |
| **Voice input** | Speech-to-text through the browser's Web Speech API, with a language picker (14 languages plus the browser's default language, not automatic spoken-language detection). Needs a browser that supports it, such as Chrome or Edge. |
| **Text-to-speech** | Read any response aloud with Gemini TTS (`gemini-3.8-flash-lite-tts`) using one of five voices: Puck, Charon, Kore, Fenrir or Zephyr. A voice preview is available in Settings. |
| **Export** | Download the active conversation as a `.md` file. |
| **Dark / light mode** | Starts from your OS preference and can be toggled. The choice is not saved between visits. |

---

## Tech Stack

- **React 19** and **TypeScript**
- **Vite 6**
- **Tailwind CSS v4** (with `@tailwindcss/typography`)
- **@google/genai**: official Gemini SDK
- **react-markdown** and **remark-gfm**: Markdown rendering
- **motion** and **lucide-react**: animation and icons

---

## Getting Started

### Prerequisites

- **Node.js 20.19 or newer** (22.12+ also works)
- A **Google Gemini API key**: [get one here](https://aistudio.google.com/app/apikey)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/Adel-dev-2001/syntax-ai.git
cd syntax-ai

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
```

Open `.env` and add your key:

```env
GEMINI_API_KEY="your_key_here"
```

```bash
# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Vite dev server on port 3000 on the local machine |
| `npm run build` | Build the production bundle into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Type-check with `tsc --noEmit` |

---

## Project Structure

```
syntax-ai/
├── public/
│   └── favicon.svg
├── src/
│   ├── types/
│   │   └── chat.ts                  # ChatMessage, ChatSession, Attachment, ...
│   ├── constants/
│   │   └── chat.ts                  # Model name, system prompts, suggestions, voice list
│   ├── services/
│   │   └── GeminiService.ts         # @google/genai chat stream + Gemini Interactions API TTS
│   ├── hooks/
│   │   ├── useChat.ts               # Sessions, streaming, branching, memory, attachments, export
│   │   ├── useSpeechRecognition.ts  # Microphone input (Web Speech API)
│   │   └── useTheme.ts              # Dark / light mode
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   └── Textarea.tsx
│   │   ├── MarkdownRenderer.tsx     # Markdown, code blocks with preview, generated images
│   │   └── MessageItem.tsx          # One message: edit, copy, speak, branch navigation
│   ├── lib/
│   │   ├── tree.ts                  # Conversation-tree helpers for branching
│   │   └── utils.ts                 # `cn` class-name helper
│   ├── App.tsx                      # Main UI: layout, sidebar, settings (chat logic is in hooks)
│   ├── main.tsx                     # React entry point
│   └── index.css                    # Tailwind v4 styles and theme variables
├── index.html
├── vite.config.ts                   # Vite + Tailwind config, injects GEMINI_API_KEY
├── tsconfig.json
└── .env.example                     # Environment variable template
```

### Data flow

```
App.tsx
  ├── useTheme
  ├── useSpeechRecognition   -> Web Speech API
  └── useChat
        ├── localStorage     <-> sessions and core memory
        └── GeminiService    -> @google/genai
                                 ├── generateContentStream  (chat)
                                 └── Interactions API REST  (text-to-speech)
```

`GeminiService` is the only file that imports `@google/genai`.

---

## Privacy and Security Notes

- **What leaves your browser:** your messages and attachments are sent to the Google Gemini API; text you have spoken aloud is sent to Gemini TTS; generated images are loaded from Pollinations.ai; the JSX preview loads React, Babel and Tailwind from public CDNs (so it needs an internet connection).
- **What stays in your browser:** chat text, core memory and the voice-language choice are stored in `localStorage`. Attachment contents are kept only in the current page session and are deliberately not written to `localStorage`, avoiding the browser's small storage quota; after a reload, reattach files before asking about them again.
- **API-key warning:** `vite.config.ts` injects `GEMINI_API_KEY` into the client-side code. A key included in a browser bundle can be read by anyone who opens the site, even if it was kept in a local `.env` file. Use this setup for local or personal use only. For a public deployment, route Gemini requests through a backend or serverless function that keeps the key on the server.
- **Model names:** chat uses the stable `gemini-3.8-flash` model. Text-to-speech uses `gemini-3.8-flash-lite-tts` through Google's Interactions API; the API returns WAV audio, so the app does not add another WAV header. Google may change model availability or APIs, so re-check the official documentation before major releases.

---

## License

Several source files carry an Apache-2.0 license header.
