#!/usr/bin/env node
// Claude Code Statusline
// Shows: model | directory | git sync | context usage

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // Returns { base: 'Op4.8', ctx: ' (1m)' } so the effort code can slot in
    // between them: the colon binds to the version, the context size trails.
    const shortModel = (name) => {
      // 1. Anthropic models: Claude Opus 5.5, claude-opus-4-6-thinking, Sonnet 5, etc.
      const m = name.match(/^(?:claude[\s-]*)?(Opus|Sonnet|Haiku|Mythos|Fable)[\s-]+(\d+(?:[.-]\d+)?)(?:\s*\(([^)]+)\))?/i);
      if (m) {
        // Fable deviates from the first-two-letters rule: 'Fb' reads as Fable, 'Fa' doesn't.
        const family = /^fable$/i.test(m[1]) ? 'Fb'
          : m[1].charAt(0).toUpperCase() + m[1].charAt(1).toLowerCase();
        const version = m[2].replace('-', '.');
        const ctx = m[3];
        let suffix = '';
        if (ctx && !/thinking/i.test(ctx)) {
          const ctxMatch = ctx.match(/(\d+)\s*([KMG])/i);
          if (ctxMatch) suffix = ` (${ctxMatch[1]}${ctxMatch[2].toLowerCase()})`;
        }
        return { base: `${family}${version}`, ctx: suffix };
      }

      // 2. Google Gemini models: gemini-3.8-flash-high, Gemini 2.5 Pro, gemini-3-flash, etc.
      const gm = name.match(/^(?:google[\s-]*)?gemini[\s-]+(\d+(?:[.-]\d+)?)(?:[\s-]+(flash|pro|ultra))?(?:[\s-]+(high|medium|low|lite|thinking|image|tiered))?(?:\s*\(([^)]+)\))?/i);
      if (gm) {
        const version = gm[1].replace('-', '.');
        const type = (gm[2] || '').toLowerCase();
        const tier = (gm[3] || '').toLowerCase();
        const paren = (gm[4] || '').toLowerCase();

        let variant = '';
        if (type === 'flash') variant = 'fl';
        else if (type === 'pro') variant = 'pro';
        else if (type === 'ultra') variant = 'ult';

        let sub = '';
        if (tier === 'high' || paren.includes('high')) sub = 'hg';
        else if (tier === 'medium' || paren.includes('medium')) sub = 'md';
        else if (tier === 'low' || paren.includes('low')) sub = 'lo';
        else if (tier === 'lite' || paren.includes('lite')) sub = 'lt';
        else if (tier === 'thinking' || paren.includes('thinking')) sub = 'th';

        const tag = [variant, sub].filter(Boolean).join('-');
        const label = tag ? `Gm${version}-${tag}` : `Gm${version}`;
        return { base: label, ctx: '' };
      }

      return { base: name, ctx: '' };
    };
    const model = shortModel(data.model?.display_name || data.model?.id || 'Claude');
    // Reasoning-effort tier, present on stdin only for models that support it
    // (so it's stable, not flickering). Render as a short lowercase code glued
    // to the model with a colon (Op4.8:hg). Unknown future levels fall back to
    // their first two chars rather than vanishing.
    const effortLevel = (data.effort?.level || '').toLowerCase();
    const EFFORT_CODES = { low: 'lo', medium: 'md', high: 'hg', xhigh: 'xhg', max: 'mx' };
    // Own-key lookup only: prototype keys ('constructor', '__proto__') must fall
    // through to the generic fallback, not resolve to inherited members.
    const effortCode = (Object.hasOwn(EFFORT_CODES, effortLevel) ? EFFORT_CODES[effortLevel] : '')
      || (effortLevel && effortLevel.slice(0, 2));
    const dir = data.workspace?.current_dir || process.cwd();
    // Where the session was launched. Equals current_dir until a cd/dir switch
    // moves the working dir elsewhere; the session + its transcript stay rooted
    // here, so surfacing it avoids the "wrong dir" surprise.
    const launchDir = data.workspace?.project_dir || '';
    // session_id is used to build paths under os.tmpdir() and ~/.claude/projects.
    // Claude Code emits a UUID, but treat any unexpected shape as absent so a
    // malformed value can't traverse out of those locations (e.g. "../foo").
    const rawSession = data.session_id || '';
    const session = /^[A-Za-z0-9_-]{1,128}$/.test(rawSession) ? rawSession : '';
    const rawRemaining = data.context_window?.remaining_percentage;
    const remaining = (rawRemaining == null || rawRemaining === '') ? NaN : Number(rawRemaining);
    const homeDir = os.homedir();
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');

    const fmt = (n) => {
      if (n < 1000) return String(n);
      if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      if (n < 1000000) return Math.round(n / 1000) + 'k';
      return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    };

    // --- Context window ---
    let ctx = '';
    if (Number.isFinite(remaining)) {
      // Absolute token counts (e.g. "480k/1M"). Numerator is total_input_tokens
      // (input + cache_creation + cache_read); denominator is context_window_size.
      // When both are present we drive the bar from them directly \u2014 more honest
      // than remapping `remaining_percentage` through a hardcoded compact buffer
      // that doesn't scale across context window sizes.
      const totalInput = Number(data.context_window?.total_input_tokens) || 0;
      let ctxSize = Number(data.context_window?.context_window_size) || 0;
      // Google Gemini models natively feature a 1M token context window.
      // Claude Code defaults third-party/unknown models to 200k unless overridden.
      if (model.base.startsWith('Gm') && ctxSize <= 200000) {
        ctxSize = 1000000;
      }
      const haveAbs = totalInput > 0 && ctxSize > 0;
      const used = haveAbs
        ? Math.max(0, Math.min(100, Math.round((totalInput / ctxSize) * 100)))
        : Math.max(0, Math.min(100, Math.round(100 - remaining)));

      // Bridge file for context-monitor PostToolUse hook
      if (session) {
        try {
          const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
          fs.writeFileSync(bridgePath, JSON.stringify({
            session_id: session,
            remaining_percentage: remaining,
            used_pct: used,
            timestamp: Math.floor(Date.now() / 1000)
          }));
        } catch (e) {}
      }

      const steps = Math.max(0, Math.min(10, Math.floor(used / 10)));
      let bar = '';
      for (let i = 0; i < 5; i++) {
        const cell = Math.max(0, Math.min(2, steps - i * 2));
        bar += cell === 2 ? '\u2588' : cell === 1 ? '\u258c' : '\u2591';
      }

      const abs = haveAbs ? ` ${fmt(totalInput)}/${fmt(ctxSize)}` : '';

      let color, prefix = '';
      if (used < 50) color = '\x1b[38;2;255;125;218m';
      else if (used < 65) color = '\x1b[33m';
      else if (used < 80) color = '\x1b[38;2;255;140;0m';
      else { color = '\x1b[31m'; prefix = '\uD83D\uDC80 '; }

      // Absolute token cap: 250k is the pricing/quality cliff regardless of how
      // wide the context window is. Bump pink \u2192 yellow once we cross it, so a
      // 1M session at 250k/1M (25% used) doesn't render as "still cozy pink".
      if (haveAbs && totalInput >= 250000 && color === '\x1b[38;2;255;125;218m') {
        color = '\x1b[33m';
      }

      ctx = ` ${color}${prefix}${bar}${abs}\x1b[0m`;
    }

    // --- Git status (live, local, no network) ---
    let gitInfo = '';
    let branch = '';
    let detachedSha = '';
    try {
      const gitExec = (args) => {
        try {
          return execFileSync('git', args, { encoding: 'utf8', cwd: dir, windowsHide: true, timeout: 1000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        } catch (e) { return null; }
      };
      const parts = [];

      // Uncommitted changes — bucketed by VS Code-style status codes
      const status = gitExec(['status', '--porcelain']);
      if (status) {
        const buckets = { M: 0, A: 0, D: 0, R: 0, '?': 0, '!': 0 };
        for (const line of status.split('\n')) {
          if (!line) continue;
          const X = line.charAt(0);
          const Y = line.charAt(1);
          if (X === '?' && Y === '?') buckets['?']++;
          else if (X === 'U' || Y === 'U' || (X === 'D' && Y === 'D') || (X === 'A' && Y === 'A')) buckets['!']++;
          else if (Y === 'D' || X === 'D') buckets.D++;
          else if (X === 'R') buckets.R++;
          else if (X === 'A' || X === 'C') buckets.A++;
          else buckets.M++;
        }
        const dimBuckets = [];
        for (const k of ['M', 'A', 'D', 'R', '?']) {
          if (buckets[k] > 0) dimBuckets.push(`${buckets[k]}${k}`);
        }
        if (dimBuckets.length > 0) parts.push(`\x1b[2m${dimBuckets.join(' ')}\x1b[0m`);
        if (buckets['!'] > 0) parts.push(`\x1b[31m${buckets['!']}!\x1b[0m`);
      }

      // Behind/ahead origin
      branch = gitExec(['branch', '--show-current']) || '';
      if (!branch) {
        detachedSha = gitExec(['rev-parse', '--short', 'HEAD']) || '';
      }
      if (branch) {
        const remoteRef = `refs/remotes/origin/${branch}`;
        const behind = parseInt(gitExec(['rev-list', '--count', `HEAD..${remoteRef}`]) || '0', 10);
        const ahead = parseInt(gitExec(['rev-list', '--count', `${remoteRef}..HEAD`]) || '0', 10);
        if (behind > 0) parts.push(`\x1b[31m\u2193${behind} pull\x1b[0m`);
        if (ahead > 0) parts.push(`\x1b[33m\u2191${ahead} push\x1b[0m`);
      }

      // MD sync check: drift between CLAUDE.md ↔ AGENTS.md ↔ GEMINI.md
      try {
        const claudeMd = path.join(dir, 'CLAUDE.md');
        const agentsMd = path.join(dir, 'AGENTS.md');
        const geminiMd = path.join(dir, 'GEMINI.md');
        if (fs.existsSync(claudeMd) && fs.existsSync(agentsMd) && fs.existsSync(geminiMd)) {
          const SYNC_LINE_RE = /^> \*\*(?:Синхронизация|Sync):\*\*.*$/m;
          const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
          const cs = norm(claudeMd).replace(SYNC_LINE_RE, '');
          const as = norm(agentsMd).replace(SYNC_LINE_RE, '');
          const gs = norm(geminiMd).replace(SYNC_LINE_RE, '');
          if (cs !== as || cs !== gs) {
            parts.push('\x1b[31m\u26A0 md drift\x1b[0m');
          }
        }
      } catch (e) {}

      if (parts.length > 0) {
        gitInfo = ' ' + parts.join(' ');
      }
    } catch (e) {}

    // --- Prompt cache state ---
    // Counters come from stdin (current_usage of the latest API call) or
    // from prompt_cache (Claude Code >=2.1.251).
    // If stdin usage has zeros (synthetic turns / idle refresh / custom proxy),
    // we recover the latest assistant usage & timestamp from the session transcript.
    let cacheSegment = '';
    try {
      const pc = data.prompt_cache;
      const pcKnown = pc && typeof pc === 'object';
      let lastWriteTtl = null;
      let expiresAtMs = null;
      if (pcKnown) {
        const pcTtl = pc.ttl === '5m' || pc.ttl === '1h' ? pc.ttl : null;
        const pcExpires = Number(pc.expires_at);
        if (pcTtl && pc.expires_at !== null && Number.isFinite(pcExpires) && pcExpires > 0) {
          lastWriteTtl = pcTtl;
          expiresAtMs = pcExpires * 1000;
        }
      }

      const usage = data.context_window?.current_usage;
      const usageNull = usage === null || usage === undefined;
      let read = (usage && Number(usage.cache_read_input_tokens)) || 0;
      let write = (usage && Number(usage.cache_creation_input_tokens)) || 0;
      let freshInput = (usage && Number(usage.input_tokens)) || 0;

      let lastTouchTs = null;
      let hadCacheBefore = false;

      // Parse transcript when we need TTL/timestamp OR want to recover cached usage
      // (e.g. read/write are 0 due to idle refreshes or custom proxy, but session had cache)
      if (session) {
        try {
          let transcriptPath = data.transcript_path;
          if (!transcriptPath) {
            const slugDir = data.workspace?.project_dir || dir;
            const slug = slugDir.replace(/[:\\\/.]/g, '-');
            const claudePath = path.join(claudeDir, 'projects', slug, `${session}.jsonl`);
            if (fs.existsSync(claudePath)) {
              transcriptPath = claudePath;
            } else {
              const agyPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'brain', session, '.system_generated', 'logs', 'transcript.jsonl');
              transcriptPath = fs.existsSync(agyPath) ? agyPath : claudePath;
            }
          }
          if (fs.existsSync(transcriptPath)) {
            const stat = fs.statSync(transcriptPath);
            const desired = Math.min(stat.size, 524288); // 512 KB
            const startOffset = Math.max(0, stat.size - desired - 1);
            const readBytes = stat.size - startOffset;
            const buf = Buffer.alloc(readBytes);
            const fd = fs.openSync(transcriptPath, 'r');
            try {
              fs.readSync(fd, buf, 0, readBytes, startOffset);
            } finally {
              fs.closeSync(fd);
            }
            let content = buf.toString('utf8');
            if (startOffset > 0) {
              const nl = content.indexOf('\n');
              if (nl >= 0) content = content.slice(nl + 1);
            }
            const lines = content.split('\n').filter(Boolean);

            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const rec = JSON.parse(lines[i]);
                let r = 0, w = 0, inp = 0, tsStr = null, uCache = null;
                if (rec && rec.type === 'assistant' && rec.message && rec.message.usage) {
                  const u = rec.message.usage;
                  r = u.cache_read_input_tokens || 0;
                  w = u.cache_creation_input_tokens || 0;
                  inp = u.input_tokens || 0;
                  tsStr = rec.timestamp;
                  uCache = u.cache_creation;
                } else if (rec && (rec.source === 'MODEL' || rec.type === 'PLANNER_RESPONSE') && (rec.cache_read_tokens != null || rec.input_tokens != null)) {
                  r = rec.cache_read_tokens || 0;
                  inp = rec.input_tokens || 0;
                  tsStr = rec.created_at;
                } else {
                  continue;
                }

                // Skip synthetic or empty turns
                if (r === 0 && w === 0 && inp === 0) continue;

                hadCacheBefore = true;
                if (!lastTouchTs && tsStr) {
                  const ts = new Date(tsStr).getTime();
                  lastTouchTs = Number.isFinite(ts) ? ts : 0;
                }

                if (read === 0 && write === 0) {
                  read = r;
                  write = w;
                  if (freshInput === 0) freshInput = inp;
                }

                if (!lastWriteTtl && uCache) {
                  if (uCache.ephemeral_1h_input_tokens > 0) lastWriteTtl = '1h';
                  else if (uCache.ephemeral_5m_input_tokens > 0) lastWriteTtl = '5m';
                }
                if (lastTouchTs && (read > 0 || write > 0)) break;
              } catch (e) {}
            }

            if (!lastWriteTtl && (read > 0 || write > 0)) lastWriteTtl = '5m';
            if (!expiresAtMs && lastTouchTs && lastWriteTtl) {
              expiresAtMs = lastTouchTs + (lastWriteTtl === '5m' ? 300000 : 3600000);
            }
          }
        } catch (e) {}
      }

      if (read > 0 || write > 0) {
        const parts = ['\x1b[2mcache\x1b[0m'];

        const denom = read + write + freshInput;
        if (denom > 0) {
          const ratio = read > 0 ? Math.round(read / denom * 100) : 0;
          let ratioColor;
          if (ratio === 0) ratioColor = '\x1b[1;31m';
          else if (ratio >= 90) ratioColor = '\x1b[1;32m';
          else if (ratio >= 75) ratioColor = '\x1b[32m';
          else if (ratio >= 50) ratioColor = '\x1b[33m';
          else ratioColor = '\x1b[38;2;255;140;0m';
          parts.push(`${ratioColor}${ratio}%\x1b[0m`);
        }

        if (read > 0) {
          parts.push(`\x1b[1;32m↓${fmt(read)}\x1b[0m`);
        }
        if (write > 0) {
          const sym = read > 0 ? '+' : '↑';
          parts.push(`\x1b[33m${sym}${fmt(write)}\x1b[0m`);
        }
        if (lastWriteTtl && expiresAtMs) {
          const ttlMs = lastWriteTtl === '5m' ? 300000 : 3600000;
          const remainingSec = (expiresAtMs - Date.now()) / 1000;
          const bucketColor = lastWriteTtl === '5m' ? '\x1b[33m' : '\x1b[2;36m';
          let suffix = `${bucketColor}${lastWriteTtl}\x1b[0m`;
          let timeStr;
          if (remainingSec <= 0) timeStr = '0m';
          else if (remainingSec < 60) timeStr = Math.ceil(remainingSec) + 's';
          else if (remainingSec < 3600) timeStr = Math.ceil(remainingSec / 60) + 'm';
          else {
            const h = Math.floor(remainingSec / 3600);
            const m = Math.floor((remainingSec % 3600) / 60);
            timeStr = h + 'h' + (m > 0 ? m + 'm' : '');
          }
          const pct = remainingSec > 0 ? (remainingSec * 1000) / ttlMs : 0;
          let countColor;
          if (pct <= 0) countColor = '\x1b[31m';
          else if (pct < 0.1) countColor = '\x1b[38;2;255;140;0m';
          else if (pct < 0.25) countColor = '\x1b[33m';
          else countColor = '\x1b[2m';
          suffix += `${countColor}:${timeStr}\x1b[0m`;
          parts.push(suffix);
        }
        cacheSegment = parts.join(' ');
      } else if (usageNull && hadCacheBefore) {
        // current_usage is null after /compact until the next API call repopulates it.
        cacheSegment = '\x1b[2mcache:\x1b[0m\x1b[33mreset\x1b[0m';
      }
    } catch (e) {}

    // --- Rate limits (subscription) ---
    const limitParts = [];
    const colorPct = (pct) => {
      if (pct < 50) return `\x1b[38;2;255;125;218m${pct}%\x1b[0m`;
      if (pct < 65) return `\x1b[33m${pct}%\x1b[0m`;
      if (pct < 80) return `\x1b[38;2;255;140;0m${pct}%\x1b[0m`;
      return `\x1b[31m${pct}%\x1b[0m`;
    };
    const formatReset = (resetTs, opts) => {
      if (!Number.isFinite(resetTs)) return null;
      const coarse = !!(opts && opts.coarse);
      const resetMin = Math.max(0, Math.ceil((resetTs * 1000 - Date.now()) / 60000));
      if (resetMin >= 1440) {
        const d = Math.floor(resetMin / 1440);
        const h = Math.floor((resetMin % 1440) / 60);
        if (coarse && d >= 2) return `${d}d`;
        if (d === 1 && h === 0) return '24h';
        return `${d}d${h}h`;
      }
      if (resetMin >= 60) {
        const h = Math.floor(resetMin / 60);
        const m = resetMin % 60;
        return m > 0 ? `${h}h${m}m` : `${h}h`;
      }
      return `${resetMin}m`;
    };
    const withReset = (label, bucket, opts) => {
      const rawUsedPct = bucket.used_percentage;
      const usedPct = (rawUsedPct == null || rawUsedPct === '') ? NaN : Number(rawUsedPct);
      if (!Number.isFinite(usedPct)) return null;
      const pct = Math.round(usedPct);
      const reset = formatReset(bucket.resets_at, opts);
      const main = `${label}:${colorPct(pct)}`;
      return reset ? `${main}\x1b[2m(${reset})\x1b[0m` : main;
    };

    const rl = data.rate_limits;
    if (rl && (rl.five_hour || rl.seven_day)) {
      if (rl.five_hour) {
        const p = withReset('5h', rl.five_hour);
        if (p) limitParts.push(p);
      }
      if (rl.seven_day) {
        const p = withReset('7d', rl.seven_day, { coarse: true });
        if (p) limitParts.push(p);
      }
    } else {
      // Fallback: Read local Antigravity proxy accounts & quota tracking
      try {
        const accountsPath = path.join(homeDir, '.config', 'antigravity-proxy', 'accounts.json');
        if (fs.existsSync(accountsPath)) {
          const accData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
          const accounts = accData.accounts || [];
          const activeIndex = accData.activeIndex || 0;
          const account = accounts[activeIndex] || accounts[0];
          if (account) {
            const rawModel = (data.model?.id || data.model?.display_name || '').toLowerCase();
            let targetModel = null;
            if (rawModel.includes('opus')) targetModel = 'claude-opus-4-6-thinking';
            else if (rawModel.includes('sonnet')) targetModel = 'claude-sonnet-4-6';
            else if (rawModel.includes('gemini')) {
              const qModels = Object.keys(account.quota?.models || {});
              targetModel = qModels.find(m => rawModel.includes(m) || m.includes(rawModel)) || 'gemini-3.8-flash-high';
            } else {
              targetModel = rawModel;
            }

            const quota = account.quota?.models?.[targetModel];
            const rlModel = account.modelRateLimits?.[targetModel];

            // 1. Short-term rate limit (5h)
            let shortResetTs = null;
            let shortPct = null;

            if (rlModel?.isRateLimited) {
              const resetMs = rlModel.actualResetMs || (rlModel.resetTime ? rlModel.resetTime - Date.now() : 0);
              if (resetMs > 0 && resetMs < 86400000) {
                shortResetTs = Math.floor((Date.now() + resetMs) / 1000);
                shortPct = 100;
              }
            }

            if (!shortResetTs && quota && quota.resetTime) {
              const resetTs = Math.floor(new Date(quota.resetTime).getTime() / 1000);
              const resetMin = Math.max(0, Math.ceil((resetTs * 1000 - Date.now()) / 60000));
              if (resetMin < 1440) {
                shortResetTs = resetTs;
                shortPct = quota.remainingFraction != null
                  ? Math.max(0, Math.min(100, Math.round((1 - quota.remainingFraction) * 100)))
                  : 0;
              }
            }

            if (shortResetTs && shortPct != null) {
              const resetStr = formatReset(shortResetTs);
              limitParts.push(`5h:${colorPct(shortPct)}${resetStr ? `\x1b[2m(${resetStr})\x1b[0m` : ''}`);
            }

            // 2. Weekly cap (7d)
            if (quota && quota.resetTime) {
              const resetTs = Math.floor(new Date(quota.resetTime).getTime() / 1000);
              const resetMin = Math.max(0, Math.ceil((resetTs * 1000 - Date.now()) / 60000));
              if (resetMin >= 1440) {
                const usedPct = quota.remainingFraction != null
                  ? Math.max(0, Math.min(100, Math.round((1 - quota.remainingFraction) * 100)))
                  : 0;
                const resetStr = formatReset(resetTs, { coarse: true });
                limitParts.push(`7d:${colorPct(usedPct)}${resetStr ? `\x1b[2m(${resetStr})\x1b[0m` : ''}`);
              }
            }
          }
        }
      } catch (e) {}
    }

    // --- Output ---
    const shorten = (n) => n.length > 15 ? n.slice(0, 7) + '…' + n.slice(-7) : n;
    const dirRaw = path.basename(dir);
    const dirShort = shorten(dirRaw);
    const normDir = (p) => process.platform === 'win32'
      ? path.resolve(p).toLowerCase() : path.resolve(p);
    const moved = launchDir && normDir(launchDir) !== normDir(dir);
    const launchRaw = moved ? path.basename(launchDir) : '';
    const buildDirSegment = (name, launch) => {
      let s = `\x1b[2m${launch ? `${launch} ▸ ` : ''}${name}\x1b[0m`;
      if (branch) s += ` \x1b[36m(${branch})\x1b[0m`;
      else if (detachedSha) s += ` \x1b[31m(HEAD@${detachedSha})\x1b[0m`;
      return s;
    };
    const dim = (s) => `\x1b[2m${s}\x1b[0m`;
    const modelSeg = effortCode === 'max'
      ? `${dim(model.base)}\x1b[31m:max\x1b[0m${model.ctx ? dim(model.ctx) : ''}`
      : dim(`${model.base}${effortCode ? `:${effortCode}` : ''}${model.ctx}`);

    // --- Output style ---
    let styleSeg = '';
    try {
      const key = String(data.output_style?.name || '').trim().toLowerCase();
      if (key && key !== 'default') {
        const STYLE_CODES = { explanatory: 'expl', learning: 'learn', concise: 'conc', proactive: 'proact' };
        const code = Object.hasOwn(STYLE_CODES, key) ? STYLE_CODES[key] : key.slice(0, 7);
        styleSeg = `\x1b[2mstl:\x1b[0m\x1b[38;2;255;125;218m${code}\x1b[0m`;
      }
    } catch (e) {}

    const segments = [modelSeg];
    if (styleSeg) segments.push(styleSeg);
    const dirIndex = segments.length;
    segments.push(buildDirSegment(dirRaw, launchRaw));
    if (gitInfo) segments.push(gitInfo.trim());
    if (ctx) segments.push(ctx.trim());
    if (cacheSegment) segments.push(cacheSegment);
    for (const lp of limitParts) segments.push(lp);

    // Width budget: Claude Code ≥2.1.153 exports the terminal size as
    // COLUMNS/LINES before invoking the script (stdout is captured, so the
    // script can't query the terminal itself). Absent or invalid → the
    // historical fixed 100, so older builds and manual runs are unchanged.
    const cols = Number.parseInt(process.env.COLUMNS, 10);
    const widthBudget = cols > 0 ? cols : 100;
    const launchShort = shorten(launchRaw);
    const fallbacks = [];
    if (dirRaw !== dirShort) fallbacks.push([dirShort, launchRaw]);
    if (launchRaw !== launchShort) fallbacks.push([dirShort, launchShort]);
    if (launchRaw) fallbacks.push([dirShort, '']);
    if (fallbacks.length > 0) {
      const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
      const width = () => {
        let visible = -3;
        for (const seg of segments) visible += 3 + stripAnsi(seg).length;
        return visible;
      };
      for (const [name, launch] of fallbacks) {
        if (width() <= widthBudget) break;
        segments[dirIndex] = buildDirSegment(name, launch);
      }
    }

    process.stdout.write(segments.join(' \u2502 '));
  } catch (e) {}
});
