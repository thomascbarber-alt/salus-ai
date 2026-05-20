/* ════════════════════════════════════════════════════════════════════
 * caedrix-shared.js  —  v1.0
 *
 * Cross-page helpers for Caedrix AI. Loaded by every logged-in page
 * BEFORE its inline <script> block. This is the single source of truth;
 * if you change behavior here it changes everywhere.
 *
 * Pages include this in their head via a script tag with src="caedrix-shared.js",
 * loaded BEFORE any inline page-specific script that uses these helpers.
 * ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── AUTH ──────────────────────────────────────────────────────────
   * Union of methods used across all pages. SalusAuth is kept as an
   * alias so legacy page code keeps working.
   * ────────────────────────────────────────────────────────────────── */
  const CaedrixAuth = {
    logout:              ()  => { sessionStorage.clear(); window.location.href = 'login.html'; },
    getApiKey:           ()  => sessionStorage.getItem('salus_api_key') || '',
    setApiKey:           (k) => { k ? sessionStorage.setItem('salus_api_key', k) : sessionStorage.removeItem('salus_api_key'); },
    isRecordsConnected:  ()  => sessionStorage.getItem('caedrix_records_connected') === 'true',
    setRecordsConnected: (v) => v ? sessionStorage.setItem('caedrix_records_connected', 'true') : sessionStorage.removeItem('caedrix_records_connected')
  };
  const SalusAuth  = CaedrixAuth;                 // backwards-compat alias
  const SalusState = {                            // thin wrapper used by some pages
    isRecordsConnected:  () => CaedrixAuth.isRecordsConnected(),
    setRecordsConnected: (v) => CaedrixAuth.setRecordsConnected(v)
  };

  /* ── SHARED STORAGE KEYS ─────────────────────────────────────────── */
  const LIFE_CONTEXT_KEY   = 'caedrix_life_context';
  const HEALTH_PROFILE_KEY = 'caedrix_health_profile';

  /* ── SESSION USER BAR ─────────────────────────────────────────────
   * Injects the top session bar. Looks for #salusUserBar and fills it.
   * Safe to call on pages that don't have the bar — no-ops.
   * ────────────────────────────────────────────────────────────────── */
  function salusInitUserBar() {
    const bar = document.getElementById('salusUserBar');
    if (!bar) return;
    bar.innerHTML =
      '<div class="subs-left">' +
        '<div class="subs-avatar" style="background:rgba(19,160,144,0.25);color:#13a090;font-size:11px;">β</div>' +
        '<span class="subs-email">Beta Session · Health data not stored</span>' +
      '</div>' +
      '<div class="subs-right">' +
        '<button class="subs-signout" onclick="CaedrixAuth.logout()">End Session</button>' +
      '</div>';
  }

  /* ── PROFILE CONTEXT (used to enrich LLM prompts) ─────────────────
   * Returns a delimited block of text suitable for appending to a
   * user prompt. Empty string if nothing relevant is stored.
   * ────────────────────────────────────────────────────────────────── */
  function getSalusLifeContext() {
    try {
      const ctx = JSON.parse(sessionStorage.getItem(LIFE_CONTEXT_KEY) || 'null');
      if (!ctx) return '';
      const parts = [];
      if (ctx.activities) parts.push('Favorite activities: ' + ctx.activities);
      if (ctx.important)  parts.push('Important personal context: ' + ctx.important);
      if (ctx.caregiver)  parts.push('Caregiver responsibilities: ' + ctx.caregiver);
      if (ctx.living)     parts.push('Living situation: ' + ctx.living);
      if (!parts.length)  return '';
      return '\n\n---\nPersonal context about this patient:\n' + parts.join('\n') + '\n---';
    } catch (_) { return ''; }
  }

  function getSalusHealthProfile() {
    try {
      const hp = JSON.parse(sessionStorage.getItem(HEALTH_PROFILE_KEY) || 'null');
      if (!hp) return '';
      const parts = [];
      if (hp.age)           parts.push('Age: ' + hp.age);
      if (hp.sex)           parts.push('Biological sex: ' + hp.sex);
      if (hp.smoking)       parts.push('Smoking status: ' + hp.smoking);
      if (hp.diabetes)      parts.push('Diabetes: ' + hp.diabetes);
      if (hp.heartDisease)  parts.push('Heart disease: ' + hp.heartDisease);
      if (hp.conditions)    parts.push('Other conditions: ' + hp.conditions);
      if (hp.medications)   parts.push('Current medications: ' + hp.medications);
      if (hp.screenings)    parts.push('Recent screenings: ' + hp.screenings);
      if (hp.familyHistory) parts.push('Family history: ' + hp.familyHistory);
      if (!parts.length)    return '';
      return '\n\n---\nPatient health profile:\n' + parts.join('\n') + '\n---';
    } catch (_) { return ''; }
  }

  // Alias used by precision-medicine3.html (kept for legacy code)
  const getCaedrixLifeContext = getSalusLifeContext;

  /* ── CLAUDE API ────────────────────────────────────────────────────
   * Posts to /api/claude. Client-side timeout (default 90s — pass timeoutMs
   * for slower calls like those using web search). Retries on 503/529.
   * Throws on non-2xx with the server's error text included.
   * ────────────────────────────────────────────────────────────────── */
  async function callClaude(
    { systemPrompt, userContent, maxTokens = 1500, useWebSearch = false, model = 'claude-sonnet-4-6', timeoutMs = 90000 },
    _retry = 0
  ) {
    const body = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    };
    if (useWebSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    /* Client-side timeout — if /api/claude hangs we fail fast, not forever. */
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error('Request timed out after ' + Math.round(timeoutMs/1000) + 's. The serverless function likely exceeded its limit. Try a more specific input or reduce max_tokens.');
      }
      throw e;
    }
    clearTimeout(timeoutId);
    if ((res.status === 529 || res.status === 503) && _retry < 2) {
      await new Promise(r => setTimeout(r, (_retry + 1) * 2000));
      return callClaude({ systemPrompt, userContent, maxTokens, useWebSearch, model, timeoutMs }, _retry + 1);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error('API ' + res.status + ': ' + err.substring(0, 200));
    }
    return await res.json();
  }

  /* Extracts plain text from Claude's structured content blocks. */
  function extractText(d) {
    return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  }

  /* ── ROBUST JSON PARSER ───────────────────────────────────────────
   * 4-step strategy:
   *   1) Direct parse (whole thing is JSON)
   *   2) Find first '{', walk to matching '}' (handles preamble AND postamble)
   *   3) Truncated-JSON repair (closes open strings, dangling brackets)
   *   4) Last-resort greedy match
   * ────────────────────────────────────────────────────────────────── */
  function safeParseJSON(text) {
    if (!text || !text.trim()) throw new Error('Empty response');
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    /* 1) Fast path — whole string is valid JSON */
    try { return JSON.parse(clean); } catch (_) {}

    /* 2) Find first '{' and walk to its matching '}' (skips preamble AND postamble) */
    const start = clean.indexOf('{');
    if (start < 0) throw new Error('No JSON object found. Preview: ' + clean.substring(0, 200));

    const balanced = extractBalancedObject(clean, start);
    if (balanced) {
      try { return JSON.parse(balanced); } catch (_) {}
    }

    /* 3) Truncated JSON — best-effort repair (closes open strings + dangling brackets) */
    const repaired = repairTruncatedJSON(clean.substring(start));
    if (repaired) {
      try {
        const recovered = JSON.parse(repaired);
        console.warn('safeParseJSON: partial JSON recovery used — response was truncated');
        return recovered;
      } catch (_) {}
    }

    /* 4) Last resort — original greedy match */
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }

    throw new Error('JSON parse failed. Preview: ' + clean.substring(0, 200));
  }

  /* Returns the substring from `start` (a '{') through its matching '}'.
     Properly tracks strings + escapes so braces inside strings don't fool it.
     Returns null if the object never closes. */
  function extractBalancedObject(s, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return s.substring(start, i + 1); }
    }
    return null;
  }

  /* Closes open strings, drops trailing commas, fills colons-with-no-value,
     and closes dangling brackets in the order they were opened. */
  function repairTruncatedJSON(text) {
    let s = text.replace(/\s+$/, '');
    let inStr = false, esc = false;
    const stack = []; /* '{' or '[' */
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}') { if (stack[stack.length - 1] === '{') stack.pop(); }
      else if (ch === ']') { if (stack[stack.length - 1] === '[') stack.pop(); }
    }
    if (inStr) s += '"';                /* close dangling string */
    s = s.replace(/,\s*$/, '');         /* drop trailing comma */
    if (/:\s*$/.test(s)) s += 'null';   /* fill missing value after colon */
    s = s.replace(/,\s*$/, '');         /* re-check after the string-close step */
    while (stack.length) {
      const o = stack.pop();
      s += (o === '{' ? '}' : ']');
    }
    return s;
  }

  /* ── HTML ESCAPER ────────────────────────────────────────────────── */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── EXPORTS ─────────────────────────────────────────────────────── */
  global.CaedrixAuth          = CaedrixAuth;
  global.SalusAuth            = SalusAuth;
  global.SalusState           = SalusState;
  global.LIFE_CONTEXT_KEY     = LIFE_CONTEXT_KEY;
  global.HEALTH_PROFILE_KEY   = HEALTH_PROFILE_KEY;
  global.salusInitUserBar     = salusInitUserBar;
  global.getSalusLifeContext  = getSalusLifeContext;
  global.getSalusHealthProfile = getSalusHealthProfile;
  global.getCaedrixLifeContext = getCaedrixLifeContext;
  global.callClaude           = callClaude;
  global.extractText          = extractText;
  global.safeParseJSON        = safeParseJSON;
  global.extractBalancedObject = extractBalancedObject;
  global.repairTruncatedJSON  = repairTruncatedJSON;
  global.esc                  = esc;
})(window);
