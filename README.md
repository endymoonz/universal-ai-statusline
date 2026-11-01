# universal-ai-statusline

> **Unified statusline for Claude Code and Google Antigravity CLI (`agy`) with multi-model formatting, live prompt cache telemetry, and quota reset countdowns.**

A lightweight, zero-dependency Node.js statusline built for pair-programming terminal AI agents. It renders a clean, informative single-line HUD at the bottom of your terminal showing model reasoning tiers, git state, context window usage, prompt caching efficiency, and rate limit countdowns.

---

## ⚡ Preview

```text
Gm3.8-fl-hg │ homelab-ansible (main) │ █▌░░░ 78k/200k │ cache 96% ↓62k 5m:5m │ 5h:16%(3h52m)
```
```text
Op4.6:hg │ homelab-ansible (main) │ ░░░░░ 61k/1M │ cache 100% ↓78k 5m:3m │ 7d:100%(6d)
```

---

## ✨ Features

* **Multi-Provider & Smart Model Formatting**:
  * **Anthropic Claude**: `Op4.6` (Opus 4.6), `So4.6` (Sonnet 4.6), `Hk...` with reasoning effort tags (`:lo`, `:md`, `:hg`, `:xhg`, `:mx`).
  * **Google Gemini**: Compact clean tags for Gemini 3.8 Flash High (`Gm3.8-fl-hg`), Gemini 2.5 Pro (`Gm2.5-pro`), Flash Lite, Thinking, and Tiered variants.
* **Universal CLI Compatibility**:
  * Works natively as a statusline hook in **Claude Code CLI** (`claude`).
  * Works natively as a custom statusline in **Google Antigravity CLI** (`agy`).
* **Resilient Prompt Cache Telemetry**:
  * Displays hit rate percentage, cached input tokens read (`↓78k`), base cache TTL (`5m` / `1h`), and live countdown to cache expiration (`5m:3m`).
  * Extended 512 KB transcript lookback window prevents metrics from vanishing during large bash/tool outputs or idle synthetic turns.
* **Dual Quota & Rate Limit Tracking**:
  * **5-Hour Window (`5h`)**: Displays rolling session quota usage and reset countdowns (used by Gemini models and Claude session cooldowns).
  * **7-Day Window (`7d`)**: Displays weekly subscription quota usage and reset countdowns (e.g. Claude Opus/Sonnet tier limits).
  * Native fallback to local proxy accounts (`~/.config/antigravity-proxy/accounts.json`) when using custom endpoints or `antigravity-claude-proxy`.
* **Zero-Network Live Git Status**:
  * Working directory with breadcrumbs (`launch ▸ current`).
  * Current git branch and detached HEAD commit hashes.
  * Staged/unstaged uncommitted file counters (`M`, `A`, `D`, `R`, `?`).
  * Upstream sync status (`↓ pull`, `↑ push`).

---

## 🚀 Quick Setup

### Prerequisites
* Node.js v18 or newer (`node -v`)
* Git

### Clone Repository
```bash
git clone https://github.com/endymoonz/universal-ai-statusline.git ~/.config/universal-ai-statusline
chmod +x ~/.config/universal-ai-statusline/statusline.js
```

---

### Setup for Claude Code CLI

Link or configure the statusline hook:

```bash
mkdir -p ~/.claude/hooks
ln -sf ~/.config/universal-ai-statusline/statusline.js ~/.claude/hooks/statusline.js
```

Or configure it in `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "command": "node /home/<USER>/.config/universal-ai-statusline/statusline.js"
  }
}
```

---

### Setup for Google Antigravity CLI (`agy`)

#### Option A: Inside the `agy` TUI (Recommended)
Simply type the slash command in your `agy` session:
```text
/statusline node /home/<USER>/.config/universal-ai-statusline/statusline.js
```

#### Option B: In `~/.gemini/antigravity-cli/settings.json`
Add the `statusLine` configuration block:
```json
{
  "statusLine": {
    "command": "node /home/<USER>/.config/universal-ai-statusline/statusline.js",
    "enabled": true,
    "stack_with_default": false
  }
}
```
> **Tip**: Set `"stack_with_default": true` if you want to stack both the default Antigravity statusline and this statusline vertically.

---

## 🔍 Statusline Fields Explained

| Segment | Example | Explanation |
|---|---|---|
| **Model & Effort** | `Gm3.8-fl-hg:hg` | `Gm3.8-fl-hg` = Gemini 3.8 Flash High; `:hg` = High reasoning effort. |
| **Directory & Git** | `homelab ▸ docs (main)` | Current directory navigation path + active git branch. |
| **Context Window** | `█▌░░░ 78k/200k` | Visual usage bar and active input token count / max window size. |
| **Prompt Cache** | `cache 96% ↓62k 5m:5m` | Hit rate, tokens read from cache, cache TTL, and remaining validity countdown. |
| **Quota & Rate Limits** | `5h:16%(3h52m)` / `7d:100%(6d)` | Used percentage and time remaining until rolling / weekly quota reset. |

---

## 🤝 Acknowledgments

Inspired by and built upon the foundational work by [Ilia Pluzhnikov](https://github.com/ilia-pluzhnikov) ([claude-code-statusline](https://github.com/ilia-pluzhnikov/claude-code-statusline)).

---

## 📄 License

MIT © [endymoonz](https://github.com/endymoonz)
