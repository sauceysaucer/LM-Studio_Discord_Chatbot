// Self-bot variant: runs on a real user account using discord.js-selfbot-v13.
// NOTE: Automating a user account violates Discord's Terms of Service and can
// get the account permanently banned. Use at your own risk.

import { Client } from 'discord.js-selfbot-v13';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// Load environment variables
dotenv.config();

const DISCORD_USER_TOKEN = process.env.DISCORD_USER_TOKEN;
if (!DISCORD_USER_TOKEN) {
  console.error('Error: DISCORD_USER_TOKEN is not set in environment variables.');
  process.exit(1);
}

// LM Studio configuration
const LM_SERVER_URL = process.env.LM_SERVER_URL || 'http://localhost:1234/v1';
// If LM_MODEL is not set, requests omit the model field and LM Studio
// uses whatever model is currently loaded on the server.
const LM_MODEL = process.env.LM_MODEL || null;
const LM_TIMEOUT_MS = Math.max(1000, Number(process.env.LM_TIMEOUT_MS) || 120000);

// Command permissions: only these Discord user IDs may use commands.
// Comma-separated in .env, e.g. AUTHORIZED_USER_IDS=123456789012345678,987654321098765432
// If unset, commands are open to everyone (a warning is logged at startup).
const AUTHORIZED_USER_IDS = (process.env.AUTHORIZED_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function isAuthorized(msg) {
  if (AUTHORIZED_USER_IDS.length === 0) return true;
  return AUTHORIZED_USER_IDS.includes(msg.author.id);
}

// Global prompt handling
let globalPrompt = '';
const PROMPT_FILE = 'prompt.txt';

function loadGlobalPrompt() {
  if (existsSync(PROMPT_FILE)) {
    try {
      return readFileSync(PROMPT_FILE, 'utf8').trim();
    } catch (_) {}
  }
  return '';
}

function saveGlobalPrompt(text) {
  try {
    writeFileSync(PROMPT_FILE, text.trim(), 'utf8');
  } catch (e) {
    console.error('Failed to write prompt file:', e);
  }
}

// Initialize global prompt
globalPrompt = loadGlobalPrompt();

// Global settings, persisted to settings.json so they survive restarts.
const SETTINGS_FILE = 'settings.json';
const DEFAULT_MEMORY_SIZE = 10;      // max messages fetched for context
const DEFAULT_CONTEXT_CHARS = 4000;  // character budget for history (~1000 tokens)
const DEFAULT_FOLLOWUP_SECONDS = 60; // how long the account keeps responding without a new @mention
const DEFAULT_COOLDOWN_SECONDS = 5;  // min gap between replies to the same user (anti-spam)
const MAX_FETCH_LIMIT = 100;         // Discord API caps message fetches at 100

let settings = {};

function loadSettings() {
  if (existsSync(SETTINGS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        settings = parsed;
      }
    } catch (e) {
      console.error('Failed to read settings file:', e);
    }
  }
}

function saveSettings() {
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write settings file:', e);
  }
}

function getMemorySize() {
  return settings.memorySize ?? DEFAULT_MEMORY_SIZE;
}

function setMemorySize(size) {
  settings.memorySize = Math.min(MAX_FETCH_LIMIT, Math.max(1, Math.floor(size)));
  saveSettings();
}

function getContextChars() {
  return settings.contextChars ?? DEFAULT_CONTEXT_CHARS;
}

function setContextChars(chars) {
  settings.contextChars = Math.max(1, Math.floor(chars));
  saveSettings();
}

function getFollowupSeconds() {
  return settings.followupSeconds ?? DEFAULT_FOLLOWUP_SECONDS;
}

function setFollowupSeconds(seconds) {
  settings.followupSeconds = Math.max(0, Math.floor(seconds));
  saveSettings();
}

function getCooldownSeconds() {
  return settings.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
}

function setCooldownSeconds(seconds) {
  settings.cooldownSeconds = Math.max(0, Math.floor(seconds));
  saveSettings();
}

// Load persisted settings at startup
loadSettings();

// Best available display name for a user:
// server nickname (if any) > global display name > username
function getUserDisplayName(guild, user) {
  return guild?.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username;
}

// Best available display name for a message author
function getDisplayName(message) {
  return getUserDisplayName(message.guild, message.author);
}

// Show a typing indicator while a reply is being generated.
// Discord typing indicators expire after ~10 seconds, so refresh periodically.
function startTypingIndicator(channel) {
  const sendTyping = () =>
    channel.sendTyping().catch((e) => console.error('Failed to send typing indicator:', e));
  sendTyping();
  const timer = setInterval(sendTyping, 8000);
  return () => clearInterval(timer);
}

// Helper to call LM Studio. Returns { content, timedOut }; content is null
// when the request failed or timed out.
async function callLM(messages) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LM_TIMEOUT_MS);
  try {
    // Omit the model field when LM_MODEL isn't configured, so LM Studio
    // serves its currently loaded default model.
    const payload = { messages };
    if (LM_MODEL) payload.model = LM_MODEL;

    const response = await fetch(`${LM_SERVER_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('LM Studio API error:', response.status, errText);
      return { content: null, timedOut: false };
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return { content: data.choices[0].message.content.trim(), timedOut: false };
    }
    console.error('LM Studio API returned unexpected structure:', data);
    return { content: null, timedOut: false };
  } catch (err) {
    if (controller.signal.aborted) {
      console.error(`LM Studio request timed out after ${Math.round(LM_TIMEOUT_MS / 1000)}s.`);
    } else {
      console.error('Error calling LM Studio:', err);
    }
    return { content: null, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timeoutId);
  }
}

// NOTE: unlike the regular bot, a user account receives every message in
// every server it is in and has full message content automatically.
// discord.js-selfbot-v13 ignores (and warns about) the `intents` option,
// so none is passed here.
const client = new Client({});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag} (self-bot mode)`);
  if (AUTHORIZED_USER_IDS.length === 0) {
    console.warn('AUTHORIZED_USER_IDS is not set - commands are open to everyone. Add it to your .env to restrict commands.');
  }
});

// Fetch the message a user replied to, if available.
async function fetchReferencedMessage(msg) {
  if (!msg.reference?.messageId) return null;
  // Replies to messages in other channels are not used for context
  if (msg.reference.channelId && msg.reference.channelId !== msg.channel.id) return null;
  try {
    return await msg.channel.messages.fetch(msg.reference.messageId);
  } catch (_) {
    return null; // referenced message was deleted or is unavailable
  }
}

// Timestamps of the account's last reply, keyed "channelId:userId". Used for
// the follow-up window (responding without a new @mention for a while) and
// the anti-spam cooldown (minimum gap between replies to the same user).
const lastReplyTimes = new Map();

// Record that the account just replied to this user in this channel.
function recordReply(msg) {
  const now = Date.now();
  // Prune stale entries to keep the map small
  const maxAgeMs = Math.max(getFollowupSeconds(), getCooldownSeconds()) * 1000;
  for (const [key, ts] of lastReplyTimes) {
    if (now - ts > maxAgeMs) lastReplyTimes.delete(key);
  }
  lastReplyTimes.set(`${msg.channel.id}:${msg.author.id}`, now);
}

// True while the user is still inside the no-mention follow-up window.
function isInFollowupWindow(msg) {
  const seconds = getFollowupSeconds();
  if (seconds <= 0 || !msg.guild) return false;
  const last = lastReplyTimes.get(`${msg.channel.id}:${msg.author.id}`);
  return last !== undefined && Date.now() - last <= seconds * 1000;
}

// True while the user is blocked by the anti-spam cooldown.
function isCoolingDown(msg) {
  const seconds = getCooldownSeconds();
  if (seconds <= 0) return false;
  const last = lastReplyTimes.get(`${msg.channel.id}:${msg.author.id}`);
  return last !== undefined && Date.now() - last < seconds * 1000;
}

// Decide whether the account should respond to a message, and collect any
// replied-to message that can add context.
// Triggers: @mention of this account anywhere in the message, a reply to one
// of its messages, a direct message, or an active follow-up window.
// The anti-spam cooldown overrides all of these.
async function getResponseTrigger(msg) {
  const referenced = await fetchReferencedMessage(msg);

  const mentioned = msg.mentions.has(client.user);
  const replyToSelf = referenced !== null && referenced.author.id === client.user.id;
  // DMs: always respond; in guilds the follow-up window also counts
  const shouldRespond = !msg.guild || mentioned || replyToSelf || isInFollowupWindow(msg);

  if (shouldRespond && isCoolingDown(msg)) {
    console.log(`${getDisplayName(msg)}: ${cleanMessageContent(msg) || '(no text)'} (ignored – cooldown active)`);
    return { respond: false, referenced: null };
  }

  return { respond: shouldRespond, referenced: shouldRespond ? referenced : null };
}

// One generation at a time per channel: while a reply is being generated,
// new messages are queued and answered in order afterwards.
const busyChannels = new Map(); // channelId -> queued messages

async function handleChatMessage(msg, referenced = null) {
  const channelId = msg.channel.id;

  if (busyChannels.has(channelId)) {
    busyChannels.get(channelId).push({ msg, referenced });
    return;
  }

  const queue = [];
  busyChannels.set(channelId, queue);

  try {
    await generateAndSendReply(msg, referenced);
    while (queue.length > 0) {
      const next = queue.shift();
      // Messages queued during a burst can fall inside the cooldown opened
      // by replies posted since they arrived – drop those instead of
      // answering every spam message.
      if (isCoolingDown(next.msg)) {
        console.log(`${getDisplayName(next.msg)}: ${cleanMessageContent(next.msg) || '(no text)'} (dropped – cooldown active)`);
        continue;
      }
      try {
        await generateAndSendReply(next.msg, next.referenced);
      } catch (e) {
        console.error('Failed to process queued message:', e);
      }
    }
  } catch (e) {
    console.error('Failed to process message:', e);
  } finally {
    busyChannels.delete(channelId);
  }
}

// Clean up message content for the model: strip this account's own mention and
// render user/role mentions as readable names.
function cleanMessageContent(message) {
  let text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '');
  text = text.replace(/<@!?(\d+)>/g, (m, id) => {
    const user = message.mentions.users.get(id);
    return user ? `@${getUserDisplayName(message.guild, user)}` : '@someone';
  });
  text = text.replace(/<@&(\d+)>/g, (m, id) => {
    const role = message.mentions.roles.get(id);
    return role ? `@${role.name}` : '@role';
  });
  return text.trim();
}

// Generate a reply for a single message and post it in the channel.
async function generateAndSendReply(msg, referenced = null) {
  // Let users know a reply is being written
  const stopTyping = startTypingIndicator(msg.channel);

  try {
    // The user's cleaned message text
    let userText = cleanMessageContent(msg);

    if (!userText && msg.attachments.size > 0) {
      return msg.reply("I can't read attachments yet — describe it in text and I'll join in!");
    }
    if (!userText) {
      if (!msg.guild) return; // nothing to respond to in a DM
      userText = '(mentioned you without typing a message)';
    }

    const currentSpeaker = getDisplayName(msg);
    console.log(`${currentSpeaker}: ${userText}`);

    const maxMessages = getMemorySize();

    // Fetch recent messages from the channel, excluding the current one.
    // Discord allows fetching at most 100 messages per request.
    let fetched;
    try {
      fetched = await msg.channel.messages.fetch({ limit: Math.min(MAX_FETCH_LIMIT, maxMessages + 1) });
    } catch (e) {
      console.error('Failed to fetch channel history:', e);
      return msg.reply('Could not retrieve chat history.');
    }

    const msgsArray = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // History candidates: drop the triggering message and other bots'
    // messages – only this account's own replies count as 'assistant' turns.
    const history = msgsArray.filter(
      (m) => m.id !== msg.id && !(m.author.bot && m.author.id !== client.user.id)
    );

    // Apply the per-channel message-count cap, then trim from the oldest
    // end so the kept messages fit inside the character budget. The budget
    // counts "Name: content" for each history message (the current message
    // is always included).
    const countCapped = history.slice(-maxMessages);
    let remaining = getContextChars();
    const selected = []; // { message, text } – newest first while selecting
    for (let i = countCapped.length - 1; i >= 0; i--) {
      const m = countCapped[i];
      const text = cleanMessageContent(m);
      if (!text) continue; // nothing usable in this message
      const length = getDisplayName(m).length + 2 + text.length;
      if (length > remaining) break;
      selected.push({ message: m, text });
      remaining -= length;
    }
    selected.reverse(); // back to oldest → newest order

    // Build conversation array
    const conv = [];
    if (globalPrompt) {
      conv.push({ role: 'system', content: globalPrompt });
    }
    // Names give the model context about who said what and who it is responding to
    conv.push({
      role: 'system',
      content: `This conversation happens on Discord. Each message is prefixed with its author's display name (e.g. "Alice: hi there"). You are currently responding to ${currentSpeaker}.`
    });
    for (const { message: m, text } of selected) {
      conv.push({
        role: m.author.id === client.user.id ? 'assistant' : 'user',
        content: `${getDisplayName(m)}: ${text}`
      });
    }

    // Explicitly quote the message the user replied to so the model always
    // knows exactly what they are referring to – even when that message is
    // also part of the recent-history window above.
    if (referenced) {
      const refText = cleanMessageContent(referenced) || '(attachment only)';
      userText = `Replying to ${getDisplayName(referenced)}'s message: "${refText}"\n\n${userText}`;
    } else if (msg.reference?.messageId) {
      userText = `(replying to a message that is no longer available)\n\n${userText}`;
    }

    // Add the current user message as last item
    conv.push({ role: 'user', content: `${currentSpeaker}: ${userText}` });

    if (process.env.DEBUG_CONTEXT) {
      console.log('--- Context sent to LM Studio ---');
      for (const m of conv) console.log(`[${m.role}] ${m.content}`);
      console.log('---------------------------------');
    }

    console.log('Requesting response from LM Studio...');
    const result = await callLM(conv);
    if (result.content === null) {
      const apology = result.timedOut
        ? `Sorry, LM Studio didn't respond within ${Math.round(LM_TIMEOUT_MS / 1000)} seconds — it may be busy or offline.`
        : "Sorry, I couldn't get a response from the model.";
      console.log(`Reply: ${apology}`);
      return msg.reply(apology);
    }

    // If the model echoed its own name prefix ("Name: ..."), strip it
    let replyText = result.content;
    for (const name of [msg.guild?.members?.me?.displayName, client.user.globalName, client.user.username]) {
      const prefix = `${name}: `;
      if (name && replyText.startsWith(prefix)) {
        replyText = replyText.slice(prefix.length).trimStart();
        break;
      }
    }

    if (!replyText) return; // model returned nothing usable

    console.log(`Reply: ${replyText}`);

    try {
      await msg.reply(replyText); // reply-links the answer to the trigger message
      recordReply(msg); // opens/extends the follow-up window and starts the cooldown
    } catch (e) {
      console.error('Failed to send message:', e);
    }
  } finally {
    stopTyping();
  }
}

client.on('messageCreate', async (msg) => {
  // CRITICAL for self-bot mode: the account receives its own messages, and a
  // user account is not flagged as a bot. Without this check the account
  // would reply to itself in a loop whenever it mentions itself.
  if (msg.author.id === client.user.id) return;
  if (msg.author.bot) return; // ignore other bots' messages

  // Handle command prefix '!'
  if (msg.content.startsWith('!')) {
    if (!isAuthorized(msg)) return; // silently ignore commands from unauthorized users

    const args = msg.content.slice(1).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    switch (cmd) {
      case 'prompt': {
        const promptText = args.join(' ');
        if (!promptText) {
          return msg.reply('Usage: `!prompt <system prompt>`');
        }
        globalPrompt = promptText.trim();
        saveGlobalPrompt(globalPrompt);
        return msg.reply('System prompt set.');
      }

      case 'memory_size': {
        const sizeArg = args[0];
        if (sizeArg) {
          const num = parseInt(sizeArg, 10);
          if (isNaN(num) || num <= 0) {
            return msg.reply('Usage: `!memory_size <positive integer>`');
          }
          setMemorySize(num);
          return msg.reply(`Memory size updated to ${getMemorySize()} messages (global).`);
        } else {
          return msg.reply(`Current memory size is ${getMemorySize()} messages (global).`);
        }
      }

      case 'context': {
        const sizeArg = args[0];
        if (sizeArg) {
          const num = parseInt(sizeArg, 10);
          if (isNaN(num) || num <= 0) {
            return msg.reply('Usage: `!context <positive integer>` (character budget for chat history)');
          }
          setContextChars(num);
          return msg.reply(`Context budget updated to ${getContextChars()} characters (global).`);
        } else {
          const cur = getContextChars();
          return msg.reply(`Current context budget is ${cur} characters (~${Math.round(cur / 4)} tokens) (global).`);
        }
      }

      case 'followup': {
        const sizeArg = args[0];
        if (sizeArg) {
          const num = parseInt(sizeArg, 10);
          if (isNaN(num) || num < 0) {
            return msg.reply('Usage: `!followup <seconds>` (0 disables the follow-up window)');
          }
          setFollowupSeconds(num);
          const cur = getFollowupSeconds();
          return msg.reply(cur === 0
            ? 'Follow-up window disabled – responding again only to @mentions and replies.'
            : `Follow-up window updated to ${cur} seconds (global).`);
        } else {
          const cur = getFollowupSeconds();
          return msg.reply(cur === 0
            ? 'Follow-up window is disabled.'
            : `Current follow-up window is ${cur} seconds (global).`);
        }
      }

      case 'cooldown': {
        const sizeArg = args[0];
        if (sizeArg) {
          const num = parseInt(sizeArg, 10);
          if (isNaN(num) || num < 0) {
            return msg.reply('Usage: `!cooldown <seconds>` (0 disables the cooldown)');
          }
          setCooldownSeconds(num);
          const cur = getCooldownSeconds();
          return msg.reply(cur === 0
            ? 'Cooldown disabled.'
            : `Cooldown updated to ${cur} seconds (global).`);
        } else {
          const cur = getCooldownSeconds();
          return msg.reply(cur === 0
            ? 'Cooldown is disabled.'
            : `Current cooldown is ${cur} seconds (global).`);
        }
      }

      case 'help': {
        const helpText = `**Discord AI Self-Bot Commands**\n• !prompt <system prompt> – Set a system prompt used globally.\n• !memory_size [<N>] – Show or set the number of previous messages (user+assistant) to include in context (global). Default is 10.\n• !context [<chars>] – Show or set the character budget for chat history (global). Default is 4000 (~1000 tokens).\n• !followup [<seconds>] – Show or set how long the account keeps responding to you without a new @mention (global). Default is 60; 0 disables.\n• !cooldown [<seconds>] – Show or set the anti-spam cooldown between replies to the same user (global). Default is 5; 0 disables.\n• !help – Show this help message.`;
        return msg.reply(helpText);
      }

      default:
        // Unknown command – ignore
        break;
    }
  } else {
    // Normal user message – first decide whether the account should respond at all
    const { respond, referenced } = await getResponseTrigger(msg);
    if (!respond) return;

    await handleChatMessage(msg, referenced);
  }
});

client.login(DISCORD_USER_TOKEN).catch((err) => {
  console.error('Failed to login:', err);
  console.error('Make sure DISCORD_USER_TOKEN contains a valid *user* token (not a bot token).');
});
