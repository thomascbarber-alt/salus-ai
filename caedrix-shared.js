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
   * Injects the top session bar (the "Beta Session" strip with the
   * Feedback link and End Session button). On first call it also
   * injects the feedback modal's CSS and HTML so the link works.
   * Safe to call on pages that don't have the bar — no-ops.
   * ────────────────────────────────────────────────────────────────── */
  function salusInitUserBar() {
    /* Inject the feedback modal once per page */
    if (!document.getElementById('caedrix-feedback-styles')) {
      _injectFeedbackUI();
    }
    const bar = document.getElementById('salusUserBar');
    if (!bar) return;
    bar.innerHTML =
      '<div class="subs-left">' +
        '<div class="subs-avatar" style="background:rgba(19,160,144,0.25);color:#13a090;font-size:11px;">β</div>' +
        '<span class="subs-email">Beta Session · Health data not stored</span>' +
      '</div>' +
      '<div class="subs-right">' +
        '<a class="subs-link" href="privacy-policy.html">Privacy</a>' +
        '<button class="subs-feedback" onclick="CaedrixFeedback.open()">💬 Feedback</button>' +
        '<button class="subs-signout" onclick="CaedrixAuth.logout()">End Session</button>' +
      '</div>';
  }

  /* ── FEEDBACK MODAL ───────────────────────────────────────────────
   * In-app form that POSTs to a Google Apps Script web app, which
   * emails the feedback to the configured address. The Apps Script
   * URL must be set in FEEDBACK_ENDPOINT below before deploy.
   * ────────────────────────────────────────────────────────────────── */
  /* PASTE THE FEEDBACK Apps Script /exec URL HERE (separate from signin) */
  const FEEDBACK_ENDPOINT = 'PASTE_FEEDBACK_APPS_SCRIPT_URL_HERE';

  function _injectFeedbackUI() {
    const style = document.createElement('style');
    style.id = 'caedrix-feedback-styles';
    style.textContent =
      '.subs-feedback{padding:4px 10px;border-radius:6px;background:none;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.55);cursor:pointer;font-family:inherit;font-size:11px;transition:all .2s;margin-right:8px;}' +
      '.subs-feedback:hover{border-color:rgba(19,160,144,0.5);color:rgba(19,160,144,0.9);}' +
      '.subs-link{padding:4px 10px;font-size:11px;color:rgba(255,255,255,0.45);text-decoration:none;transition:color .2s;margin-right:4px;}' +
      '.subs-link:hover{color:rgba(255,255,255,0.85);}' +
      '#cf-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;font-family:"DM Sans",sans-serif;}' +
      '#cf-modal.open{display:flex;}' +
      '#cf-modal .cf-backdrop{position:absolute;inset:0;background:rgba(7,16,32,0.78);backdrop-filter:blur(6px);}' +
      '#cf-modal .cf-dialog{position:relative;max-width:520px;width:calc(100% - 32px);background:#0c1e3a;border:1px solid rgba(212,170,58,0.25);border-radius:18px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:cf-pop .25s ease;}' +
      '@keyframes cf-pop{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}' +
      '#cf-modal .cf-title{font-family:"Playfair Display",serif;font-size:22px;font-weight:600;color:#fff;margin-bottom:6px;}' +
      '#cf-modal .cf-sub{font-size:13px;color:rgba(255,255,255,0.55);line-height:1.55;margin-bottom:18px;}' +
      '#cf-modal label{display:block;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:6px;}' +
      '#cf-modal textarea,#cf-modal input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 14px;font-family:"DM Sans",sans-serif;font-size:14px;color:#fff;outline:none;transition:all .2s;}' +
      '#cf-modal textarea{min-height:130px;resize:vertical;margin-bottom:14px;}' +
      '#cf-modal input{margin-bottom:16px;}' +
      '#cf-modal textarea:focus,#cf-modal input:focus{border-color:rgba(19,160,144,0.5);background:rgba(19,160,144,0.05);}' +
      '#cf-modal textarea::placeholder,#cf-modal input::placeholder{color:rgba(255,255,255,0.2);}' +
      '#cf-modal .cf-actions{display:flex;gap:10px;justify-content:flex-end;}' +
      '#cf-modal .cf-cancel{padding:11px 18px;background:none;border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:rgba(255,255,255,0.6);cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;}' +
      '#cf-modal .cf-cancel:hover{border-color:rgba(255,255,255,0.3);color:#fff;}' +
      '#cf-modal .cf-send{padding:11px 22px;background:linear-gradient(135deg,#13a090,#0a7c6e);border:none;border-radius:10px;color:#fff;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;}' +
      '#cf-modal .cf-send:hover:not(:disabled){background:linear-gradient(135deg,#1abfad,#13a090);}' +
      '#cf-modal .cf-send:disabled{opacity:.6;cursor:not-allowed;}' +
      '#cf-modal .cf-msg{display:none;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;line-height:1.5;}' +
      '#cf-modal .cf-msg.error{display:block;background:rgba(192,57,43,0.12);border:1px solid rgba(192,57,43,0.3);color:#e07070;}' +
      '#cf-modal .cf-msg.success{display:block;background:rgba(10,124,110,0.12);border:1px solid rgba(10,124,110,0.3);color:#13c0ac;}';
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'cf-modal';
    modal.innerHTML =
      '<div class="cf-backdrop" onclick="CaedrixFeedback.close()"></div>' +
      '<div class="cf-dialog">' +
        '<div class="cf-title">Send Feedback</div>' +
        '<div class="cf-sub">Tell us what\'s working, what\'s not, or anything you\'d like to see. Your feedback comes straight to the team.</div>' +
        '<div class="cf-msg" id="cf-msg"></div>' +
        '<label for="cf-text">Your feedback</label>' +
        '<textarea id="cf-text" placeholder="Type your feedback…"></textarea>' +
        '<label for="cf-email">Email (optional — only if you\'d like a reply)</label>' +
        '<input id="cf-email" type="email" placeholder="you@example.com">' +
        '<div class="cf-actions">' +
          '<button class="cf-cancel" onclick="CaedrixFeedback.close()">Cancel</button>' +
          '<button class="cf-send" id="cf-send" onclick="CaedrixFeedback.submit()">Send</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    /* Escape key closes the modal */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') CaedrixFeedback.close();
    });
  }

  const CaedrixFeedback = {
    open() {
      const m = document.getElementById('cf-modal');
      if (!m) return;
      m.classList.add('open');
      /* reset msg + autofocus textarea */
      const msg = document.getElementById('cf-msg');
      if (msg) { msg.className = 'cf-msg'; msg.textContent = ''; }
      setTimeout(() => { const t = document.getElementById('cf-text'); if (t) t.focus(); }, 50);
    },
    close() {
      const m = document.getElementById('cf-modal');
      if (m) m.classList.remove('open');
    },
    async submit() {
      const textEl = document.getElementById('cf-text');
      const emailEl = document.getElementById('cf-email');
      const msgEl = document.getElementById('cf-msg');
      const sendBtn = document.getElementById('cf-send');
      const feedback = (textEl.value || '').trim();
      const email = (emailEl.value || '').trim();
      if (!feedback) {
        msgEl.className = 'cf-msg error';
        msgEl.textContent = 'Please write some feedback before sending.';
        return;
      }
      sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      try {
        await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            feedback: feedback,
            email: email,
            page: window.location.pathname + window.location.search
          })
        });
        msgEl.className = 'cf-msg success';
        msgEl.textContent = '✓ Thanks — your feedback was sent.';
        textEl.value = ''; emailEl.value = '';
        setTimeout(() => CaedrixFeedback.close(), 1400);
      } catch (err) {
        msgEl.className = 'cf-msg error';
        msgEl.textContent = 'Could not send feedback (network error). Please try again.';
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = 'Send';
      }
    }
  };

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
  global.CaedrixFeedback      = CaedrixFeedback;
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
