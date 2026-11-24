# LLM Sessions for Obsidian

Chat with Claude from your notes. Each conversation lives in your note as a collapsible callout with a title and an AI summary. Claude always sees the note the chat lives in, and can read other notes when it needs them.

```markdown
> [!llm-chat|c-mfz2k1q8x3a]- Choosing a sleep tracker
> Compared Oura and Whoop for HRV and sleep staging. Chose Oura for no
> subscription lock-in and longer battery life.
>
> [Open chat](obsidian://llm-chat?id=c-mfz2k1q8x3a) · 12 messages
```

**Status:** Phase 1 (MVP), desktop only. See the [roadmap](docs/ARCHITECTURE.md#16-roadmap).

## Requirements

- Obsidian desktop 1.11.4 or later (Windows, macOS or Linux).
- [Claude Code](https://code.claude.com/docs/en/setup) **2.1.223 or later**, installed on the same computer.
- A Claude Pro or Max subscription signed in to Claude Code, **or** an Anthropic API key.

## Install (development)

```bash
cd <vault>/.obsidian/plugins
git clone <this repo> obsidian-llm-chat-plugin
cd obsidian-llm-chat-plugin
npm install
npm run build
```

Then enable **LLM Sessions** in **Settings → Community plugins**.

## First run

Setup opens the first time the plugin is enabled. To run it again, go to **Settings → LLM Sessions → Run setup again**. It walks you through:

1. **What gets sent where** (below). You must accept to continue.
2. **Finding Claude Code.** It's detected automatically, or you can paste the path.
3. **Billing.** Choose **Use my Claude Code sign-in** or an API key. If Claude Code isn't signed in, **Sign in with Claude Code** opens a terminal where you type `/login`.
4. **Defaults:** model, Obsidian Sync, and excluded folders.
5. **A test message.**

## Using it

| Command | What it does |
|---|---|
| **Start chat from this note** | Inserts a chat callout at the cursor and opens the chat panel. |
| **Open existing chat…** | Search all chats, this folder's first. Picking one opens it so you can keep going, and offers to embed it in the current note. |

- The ribbon icon opens the chat panel. In a rendered callout, select **Continue** to open its chat, or **Copy link** to copy its `obsidian://llm-chat` link.
- **Context.** The note a chat lives in is always included. If you edit the note, the new version goes with your next message. To add more notes or files (text files, PDFs and images), select **+** next to **Context** in the panel, or drop files on the panel. A file from outside the vault is copied into your attachment folder first. Claude can also read, search and follow links between notes on its own; the panel shows each lookup.
- **Model.** Sonnet (latest) by default. Change it for all chats in settings, or for one chat in the panel header.
- **Summaries.** The title is written after the first reply. The summary is updated a couple of minutes after you stop chatting, or when you close the panel, using Haiku (latest).
- **Excluding notes.** Exclude folders or tags in settings, or add `llm-context: false` to a note's properties. Claude cannot read excluded notes.

Claude can only read notes; it cannot edit them.

## Where your data goes

**Read this before you use the plugin.**

- **The plugin runs Claude Code on your computer.** It starts your own installed `claude` program; it ships no binary of its own.
- **What is sent to Anthropic:** your messages, the notes in the chat's context, and any notes Claude reads during the chat.
- **Cost:** chats and summaries count against your Claude subscription limits, or are billed to your API key.
- **Sign-in:** the plugin never asks for, sees or stores your Claude.ai login. In subscription mode it removes API key environment variables, so Claude Code uses its own sign-in. An API key, if you use one, is kept in Obsidian's secret storage.
- **Where chats are stored:**
  - Claude Code keeps each conversation in `~/.claude/projects/` and deletes it after 30 days by default.
  - The plugin keeps a record, a readable transcript, and a copy of that session file in a **hidden `.chat-data/` folder next to your note**. That copy is how old chats still open, including on your other computers.
- **Hidden doesn't mean private.** OneDrive, iCloud, Dropbox and git sync hidden folders like any other. Obsidian Sync skips them; setup offers a visible `chat-data` folder instead.
- **Your coding setup stays out.** Your Claude Code hooks, MCP servers, `CLAUDE.md` files and claude.ai connectors are not loaded into note chats.
- **No telemetry.** The plugin sends nothing anywhere except through Claude Code as described above.

## Development

See [CLAUDE.md](CLAUDE.md) for the layout and rules, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, and [docs/SPIKES.md](docs/SPIKES.md) for verified SDK behavior.

```bash
npm run dev     # watch build
npm run build   # typecheck + production build
npm run lint
npm test
```

## License

MIT
