# Discord AI Bot

This is a simple Discord bot that uses **LM Studio** as the local LLM backend. It rebuilds conversation context from each channel's recent history (default last 10 messages, further trimmed by a global character budget) and supports a few text commands to tweak its behavior.

## Features

- **Chat** – Responds when you **@mention the bot** anywhere in a message, **reply to one of its messages**, or **send it a DM** — it no longer jumps on every message in the channel.
- **Who's Talking** – Every message sent to the model is prefixed with its author's display name (server nickname if set, otherwise their Discord name), so the bot knows who said what and who it is responding to.
- **Clean Mentions** – The bot's own @mention is stripped from your text before it reaches the model, and other @mentions are converted to readable names. Replies always quote the referenced message in the prompt, so the bot knows exactly what you're referring to.
- **Follow-up Window** – After the bot replies to you, it keeps responding to your follow-up messages in that channel for a grace period (default 60 seconds, configurable with `!followup`) — no re-mentioning needed for quick back-and-forth.
- **Spam Cooldown** – After the bot replies to someone, that person can't trigger another response for a short cooldown (default 5 seconds, configurable with `!cooldown`). Rapid-fire bursts are dropped instead of all being queued and answered.
- **Typing Indicator** – While generating a reply, the bot shows a "…is typing" indicator, refreshed every 8 seconds so it stays visible even for long generations.
- **Memory** – Keeps the last *N* chat turns for each channel (user + assistant). The default is 10, configurable globally with `!memory_size`.
- **Context Budget** – History is also trimmed so its total size stays within a global character budget (default 4000 ≈ 1000 tokens), configurable with `!context`.
- **Turn Queue** – Messages that arrive while a reply is generating are queued per channel and answered in order, so simultaneous messages can't collide. Other bots' messages are ignored entirely.
- **Command Permissions** – Only Discord users listed in `AUTHORIZED_USER_IDS` (in `.env`) can use `!` commands; commands from anyone else are silently ignored.
- **System Prompt** – Set a global system prompt that the bot will use. The prompt is stored in `prompt.txt` and is applied to all channels.
- **Global Prompt** – Persisted in `prompt.txt`. 
- **Help** – View command usage with `!help`.

## Prerequisites

1. **Node.js** 18+ (Discord.js v14 requires this).
2. **LM Studio** running locally and exposing its API. The default URL is `http://localhost:1234/v1`. Make sure the LM Studio server is running (start it via the Developer tab or `lms server start`).
3. A Discord bot token. Create a bot on the [Discord Developer Portal](https://discord.com/developers/applications) and invite it to your server with the `Send Messages` and `Read Message History` permissions.

## Installation

```bash
# Clone or copy this repository into a folder of your choice
cd <your-folder>
npm install
```

Create a `.env` file in the same directory:

```
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
# Discord user IDs (comma-separated) allowed to use bot commands.
# Enable Developer Mode in Discord, then right-click a user → "Copy User ID".
AUTHORIZED_USER_IDS=YOUR_DISCORD_USER_ID_HERE
# Optional overrides – defaults are shown below
#LM_SERVER_URL=http://localhost:1234/v1
#LM_MODEL=<model id>  # omit to use the model currently loaded in LM Studio
#LM_TIMEOUT_MS=120000
```

## Running the Bot

```bash
npm start
```

The bot will log in and listen for messages. Make sure the "Message Content" intent is enabled for your bot in the Discord Developer Portal. (DMs use the non‑privileged Direct Messages intent, which needs no portal toggle.)

### Commands

| Command | Description |
|---------|-------------|
| `!prompt <text>` | Set a global system prompt that the bot will use. |
| `!memory_size [<N>]` | Show or set the number of previous messages (user+assistant) to include in context (global). Default is 10, max 100. |
| `!context [<chars>]` | Show or set the character budget for chat history (global). Default is 4000 (~1000 tokens). |
| `!followup [<seconds>]` | Show or set how long the bot keeps responding to you without a new @mention (global). Default is 60; 0 disables. |
| `!cooldown [<seconds>]` | Show or set the anti-spam cooldown between replies to the same user (global). Default is 5; 0 disables. |
| `!help` | Show this help message. |

## Notes

- Conversation context is rebuilt from Discord channel history on every message (one history fetch per message), so it survives restarts. Global settings (`!memory_size`, `!context`, `!followup`, `!cooldown`) are stored in `settings.json`, which is created automatically.
- Commands are restricted to the Discord user IDs in `AUTHORIZED_USER_IDS` (`.env`). If that variable is unset, commands are open to everyone and a warning is logged at startup.
- The bot treats only its own past replies as "assistant" turns; messages from other bots are ignored.
- Replies are posted as Discord reply‑links to the message that triggered them. A bare @mention with no text still gets a response — the model is told you pinged it without typing anything.
- The follow-up window is per user and per channel, so other people's messages still need a @mention (or a reply to the bot). Each bot reply re-arms the timer, so active back-and-forth keeps flowing.
- The anti-spam cooldown applies per user, including in DMs. Messages sent during the cooldown are dropped entirely — not queued, not answered — even if they @mention the bot.
- The character budget counts `Name: content` for each history message; the message being replied to is always included.
- Discord typing indicators expire after ~10 seconds, so the bot re-sends the typing signal every 8 seconds until the reply is posted.
- LM Studio requests are aborted after 2 minutes by default (`LM_TIMEOUT_MS`, milliseconds). On a timeout the bot stops typing and tells the user the server didn't respond.
- Set `DEBUG_CONTEXT=true` in `.env` to log the exact context sent to LM Studio for every reply — useful when debugging confusing responses.
- If `LM_MODEL` is not set in `.env`, requests omit the model field and LM Studio serves whatever model is currently loaded.
- The console logs each conversation turn: the triggering message (`User: message`), when the LM Studio request starts, and the bot's reply (`Bot: response`).
- If you need to persist chat logs, you can modify the code to write to a file or database.
- LM Studio's default server does not require authentication. If you enable authentication, add an `Authorization` header with your token.

Happy chatting!
