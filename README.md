# Discord AI Self-Bot

A variant of the main bot that runs on a **real user account** (yours) instead of a bot account, using [discord.js-selfbot-v13](https://www.npmjs.com/package/discord.js-selfbot-v13) as the backend. It behaves like the regular bot: it answers when someone **@mentions you**, **replies to one of your messages**, or **DMs you**, using LM Studio as the LLM backend.

> ⚠️ **Read this first**
> - Automating a user account ("self-botting") is against [Discord's Terms of Service](https://discord.com/terms). Accounts detected doing this can be **permanently banned** — including your main account, since this *is* your account.
> - There is no official API for user accounts; the library works by reverse-engineering Discord's private API and can break when Discord changes things.
> - Replies are sent from your account, so other people may believe they are talking to you. Consider using the `!prompt` command to make clear that it's an AI assistant.

## How it differs from the regular bot

- **Token** – Uses `DISCORD_USER_TOKEN` (a *user* token, obtained from your logged-in browser session — see below). A bot token will not work.
- **No Developer Portal setup** – User accounts receive all messages with full content automatically; there are no intents to enable and no bot to invite to servers. It works in every server your account is in, plus DMs.
- **Self-message guard** – User accounts receive their own messages (unlike bot accounts). The code explicitly ignores your own messages so the account can never reply to itself in a loop.
- **"Assistant" turns** – Your account's own past messages are the assistant turns in the conversation history (identified by user ID, since user accounts aren't flagged as bots).
- Everything else — mentions/replies/DM triggers, follow-up window, anti-spam cooldown, per-channel message queue, `!` commands, `prompt.txt`, `settings.json` — works exactly like the regular bot.

## Installation

```bash
# From the project root
npm install
```

## Getting your user token

A user token is the credential for your personal Discord account. To read it you must be logged into Discord in a desktop or web app and inspect the network traffic (e.g. in the browser dev tools **Network** tab, look at a request to Discord and copy the `Authorization` header value). Treat it like your password — anyone with it fully controls your account. It goes in your `.env`:

```
DISCORD_USER_TOKEN=YOUR_USER_TOKEN_HERE
AUTHORIZED_USER_IDS=YOUR_DISCORD_USER_ID_HERE
# Optional overrides – defaults are shown below
#LM_SERVER_URL=http://localhost:1234/v1
#LM_MODEL=<model id>  # omit to use the model currently loaded in LM Studio
#LM_TIMEOUT_MS=120000
```

## Commands

Identical to the regular bot: `!prompt`, `!memory_size`, `!context`, `!followup`, `!cooldown`, `!help`. By default only users listed in `AUTHORIZED_USER_IDS` can use them.

## Notes

- A user token can be invalidated (e.g. by changing your password) or flagged by Discord at any time; if login suddenly fails, that's usually why.
- All the caveats from the main README about LM Studio timeouts, context budgeting, and `DEBUG_CONTEXT=true` apply here too.
