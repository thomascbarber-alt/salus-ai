/**
 * Caedrix AI — Token Purchase & Gating (frontend)
 * ===================================================
 * Handles, on any search page:
 *   - Displaying the user's current token balance
 *   - FREE TRIAL: confirm email with a 6-digit code -> 2 free searches (once)
 *   - "Buy tokens" UI ($2.99 single / $12.50 five-pack) -> Stripe Checkout
 *   - Redeeming a gift code
 *   - Gating the actual search behind a server-verified token spend
 *
 * USAGE on a search page (unchanged):
 *   <script src="caedrix-token-gate.js"></script>
 *   async function runAnalysis(){
 *     const allowed = await CaedrixTokenGate.spendTokenOrPrompt();
 *     if (!allowed) return;
 *     // ... existing search logic ...
 *   }
 *
 * After a free trial is claimed, this module fires a window event
 * 'caedrix:credits-updated' (detail: { tokens }) so pages can refresh
 * their balance badge / button label if they listen for it.
 */

const CaedrixTokenGate = (function () {

  const PRICE_SINGLE = '$2.99';
  const PRICE_FIVE = '$12.50';
  const TRIAL_FLAG = 'caedrix_trial_claimed';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let pendingTrialEmail = null;

  function getUserEmail() {
    try {
      const u = JSON.parse(localStorage.getItem('caedrix_user') || 'null');
      return u && u.email ? u.email : null;
    } catch (_) {
      return null;
    }
  }

  // Browser-side hint only. The server is the real judge of eligibility.
  function trialAvailable() {
    try { return !localStorage.getItem(TRIAL_FLAG); } catch (_) { return true; }
  }

  function markTrialClaimed() {
    try { localStorage.setItem(TRIAL_FLAG, '1'); } catch (_) {}
  }

  async function fetchBalance() {
    const email = getUserEmail();
    if (!email) return 0;
    try {
      const res = await fetch(`/api/token-balance?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      return data.tokens || 0;
    } catch (_) {
      return 0;
    }
  }

  async function renderBalanceBadge(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!getUserEmail()) {
      el.textContent = trialAvailable() ? '2 free searches available' : '';
      el.dataset.tokens = 0;
      return;
    }
    const tokens = await fetchBalance();
    if (tokens === 0 && trialAvailable()) {
      el.textContent = '2 free searches available';
    } else {
      el.textContent = tokens === 1 ? '1 search remaining' : `${tokens} searches remaining`;
    }
    el.dataset.tokens = tokens;
  }

  /**
   * Keeps a search button's label in sync with the user's live balance.
   *   credits > 0           -> freeLabel
   *   0 credits, trial open -> "freeLabel — Try free"
   *   otherwise             -> pricedLabel
   */
  async function syncButtonLabel(buttonElementId, freeLabel, pricedLabel) {
    const btn = document.getElementById(buttonElementId);
    if (!btn) return;
    const tokens = await fetchBalance();
    if (tokens > 0) btn.textContent = freeLabel;
    else if (trialAvailable()) btn.textContent = `${freeLabel} — Try free`;
    else btn.textContent = pricedLabel;
  }

  /**
   * Attempts to spend one token server-side. If the user has none, shows
   * the paywall (free trial / buy / redeem) and returns false so the
   * calling page does NOT proceed with the search.
   */
  async function spendTokenOrPrompt(draftText) {
    if (typeof draftText === 'string' && draftText.trim()) {
      const key = 'caedrix_draft:' + window.location.pathname;
      try { sessionStorage.setItem(key, draftText); } catch (_) {}
      try {
        localStorage.setItem(key, JSON.stringify({ text: draftText, expires: Date.now() + 30 * 60 * 1000 }));
      } catch (_) {}
    }
    const email = getUserEmail();
    if (!email) {
      showPaywall();
      return false;
    }

    try {
      const res = await fetch('/api/spend-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason: window.location.pathname })
      });
      const data = await res.json();
      if (data.ok) return true;
      showPaywall();
      return false;
    } catch (err) {
      console.error('Token spend check failed:', err);
      showPaywall();
      return false;
    }
  }

  // ---------- Paywall modal ----------

  function ensureModal() {
    if (document.getElementById('caedrixPaywallModal')) return;

    const modal = document.createElement('div');
    modal.id = 'caedrixPaywallModal';
    modal.innerHTML = `
      <div class="cpw-overlay" onclick="CaedrixTokenGate.hidePaywall(event)">
        <div class="cpw-card" onclick="event.stopPropagation()">
          <div class="cpw-close" onclick="CaedrixTokenGate.hidePaywall()">✕</div>
          <div class="cpw-icon" id="cpwIcon">🔓</div>
          <h2 class="cpw-title" id="cpwTitle">You're out of searches</h2>
          <p class="cpw-sub" id="cpwSub"></p>

          <div class="cpw-email-row" id="cpwEmailRow">
            <input type="email" id="cpwEmailInput" placeholder="Email address" class="cpw-input cpw-email-input" autocomplete="email">
            <div class="cpw-email-note">Used to save your searches — no password needed.</div>
          </div>

          <div class="cpw-trial" id="cpwTrial">
            <div id="cpwTrialStep1">
              <div class="cpw-trial-to" id="cpwTrialTo"></div>
              <button class="cpw-trial-btn" id="cpwTrialSendBtn" onclick="CaedrixTokenGate.startTrial()">Email me a code for 2 free searches</button>
            </div>
            <div id="cpwTrialStep2" style="display:none;">
              <div class="cpw-trial-to" id="cpwTrialSent"></div>
              <div class="cpw-redeem">
                <input type="text" id="cpwTrialCode" placeholder="6-digit code" class="cpw-input cpw-code-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
                <button class="cpw-redeem-btn" id="cpwTrialVerifyBtn" onclick="CaedrixTokenGate.verifyTrial()">Verify</button>
              </div>
              <div class="cpw-trial-links">
                <a href="#" onclick="event.preventDefault();CaedrixTokenGate.startTrial()">Resend code</a>
                <span class="cpw-trial-sep">|</span>
                <a href="#" onclick="event.preventDefault();CaedrixTokenGate.changeTrialEmail()">Use a different email</a>
              </div>
            </div>
            <div class="cpw-divider"><span>or buy searches</span></div>
          </div>

          <div class="cpw-packs">
            <button class="cpw-pack" onclick="CaedrixTokenGate.buy('single')">
              <div class="cpw-pack-price">${PRICE_SINGLE}</div>
              <div class="cpw-pack-label">1 Search</div>
            </button>
            <button class="cpw-pack cpw-pack-best" onclick="CaedrixTokenGate.buy('five')">
              <div class="cpw-pack-badge">Best Value</div>
              <div class="cpw-pack-price">${PRICE_FIVE}</div>
              <div class="cpw-pack-label">5 Searches</div>
            </button>
          </div>

          <div class="cpw-divider"><span>or</span></div>

          <div class="cpw-redeem">
            <input type="text" id="cpwCodeInput" placeholder="Enter gift code" class="cpw-input">
            <button class="cpw-redeem-btn" onclick="CaedrixTokenGate.redeem()">Redeem</button>
          </div>
          <div class="cpw-msg" id="cpwMsg"></div>
        </div>
      </div>
      <style>
        #caedrixPaywallModal .cpw-overlay{position:fixed;inset:0;background:rgba(8,16,30,0.75);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;}
        #caedrixPaywallModal .cpw-card{background:#0c1e3a;border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:36px;max-width:420px;width:100%;position:relative;box-shadow:0 24px 80px rgba(0,0,0,0.5);margin:auto;}
        #caedrixPaywallModal .cpw-close{position:absolute;top:18px;right:20px;color:rgba(255,255,255,0.4);cursor:pointer;font-size:16px;}
        #caedrixPaywallModal .cpw-close:hover{color:white;}
        #caedrixPaywallModal .cpw-icon{font-size:32px;text-align:center;margin-bottom:12px;}
        #caedrixPaywallModal .cpw-title{font-family:'Playfair Display',serif;font-size:22px;color:white;text-align:center;margin-bottom:10px;}
        #caedrixPaywallModal .cpw-sub{font-family:'DM Sans',sans-serif;font-size:13px;color:rgba(255,255,255,0.55);text-align:center;line-height:1.6;margin-bottom:26px;}
        #caedrixPaywallModal .cpw-email-row{margin-bottom:14px;}
        #caedrixPaywallModal .cpw-email-input{width:100%;text-transform:none;box-sizing:border-box;}
        #caedrixPaywallModal .cpw-email-note{font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;text-align:center;}
        #caedrixPaywallModal .cpw-trial-to{font-size:12px;color:rgba(255,255,255,0.6);text-align:center;margin-bottom:10px;line-height:1.5;}
        #caedrixPaywallModal .cpw-trial-btn{width:100%;padding:13px 16px;border-radius:10px;background:#0a7c6e;border:1px solid #13a090;color:white;font-weight:700;font-size:14px;cursor:pointer;transition:background .2s;}
        #caedrixPaywallModal .cpw-trial-btn:hover{background:#0c8f7f;}
        #caedrixPaywallModal .cpw-trial-btn:disabled,#caedrixPaywallModal .cpw-redeem-btn:disabled{opacity:0.6;cursor:default;}
        #caedrixPaywallModal .cpw-code-input{letter-spacing:4px;text-align:center;font-size:16px;}
        #caedrixPaywallModal .cpw-trial-links{text-align:center;margin-top:10px;font-size:11px;}
        #caedrixPaywallModal .cpw-trial-links a{color:#13c0ac;text-decoration:none;}
        #caedrixPaywallModal .cpw-trial-links a:hover{text-decoration:underline;}
        #caedrixPaywallModal .cpw-trial-sep{color:rgba(255,255,255,0.25);margin:0 8px;}
        #caedrixPaywallModal .cpw-packs{display:flex;gap:12px;margin-bottom:22px;}
        #caedrixPaywallModal .cpw-pack{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:18px 12px;cursor:pointer;text-align:center;transition:background .2s,border-color .2s;position:relative;}
        #caedrixPaywallModal .cpw-pack:hover{background:rgba(19,160,144,0.1);border-color:rgba(19,160,144,0.4);}
        #caedrixPaywallModal .cpw-pack-best{border-color:rgba(212,170,58,0.4);background:rgba(212,170,58,0.06);}
        #caedrixPaywallModal .cpw-pack-badge{position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#d4aa3a;color:#0c1e3a;font-size:9px;font-weight:700;padding:3px 10px;border-radius:100px;letter-spacing:0.5px;white-space:nowrap;}
        #caedrixPaywallModal .cpw-pack-price{font-family:'DM Sans',sans-serif;font-size:22px;font-weight:700;color:white;margin-bottom:4px;}
        #caedrixPaywallModal .cpw-pack-label{font-size:12px;color:rgba(255,255,255,0.5);}
        #caedrixPaywallModal .cpw-divider{display:flex;align-items:center;gap:12px;margin:18px 0;}
        #caedrixPaywallModal .cpw-divider::before,#caedrixPaywallModal .cpw-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.1);}
        #caedrixPaywallModal .cpw-divider span{font-size:11px;color:rgba(255,255,255,0.3);}
        #caedrixPaywallModal .cpw-redeem{display:flex;gap:8px;}
        #caedrixPaywallModal .cpw-input{flex:1;min-width:0;padding:11px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:white;font-size:13px;outline:none;text-transform:uppercase;}
        #caedrixPaywallModal .cpw-input:focus{border-color:rgba(19,160,144,0.6);}
        #caedrixPaywallModal .cpw-redeem-btn{padding:11px 18px;border-radius:10px;background:rgba(19,160,144,0.15);border:1px solid rgba(19,160,144,0.3);color:#13c0ac;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;}
        #caedrixPaywallModal .cpw-redeem-btn:hover{background:rgba(19,160,144,0.25);}
        #caedrixPaywallModal .cpw-msg{margin-top:12px;font-size:12px;text-align:center;min-height:16px;line-height:1.5;}
        #caedrixPaywallModal .cpw-msg.error{color:#e07070;}
        #caedrixPaywallModal .cpw-msg.success{color:#3a9e6a;}
      </style>
    `;
    document.body.appendChild(modal);

    // Pressing Enter in the code box submits it.
    const codeInput = document.getElementById('cpwTrialCode');
    if (codeInput) {
      codeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') verifyTrial();
      });
    }
  }

  function showPaywall() {
    ensureModal();
    const email = getUserEmail();
    const offerTrial = trialAvailable();

    const emailRow = document.getElementById('cpwEmailRow');
    const emailInput = document.getElementById('cpwEmailInput');
    if (emailRow) emailRow.style.display = email ? 'none' : 'block';
    if (emailInput && !email) emailInput.value = '';

    document.getElementById('cpwIcon').textContent = offerTrial ? '🎁' : '🔓';
    document.getElementById('cpwTitle').textContent = offerTrial ? 'Try 2 searches free' : "You're out of searches";
    document.getElementById('cpwSub').textContent = offerTrial
      ? 'Confirm your email and we\u2019ll add 2 free searches. No card needed. Each search is reviewed by a 5-agent pipeline for accuracy.'
      : 'Each Caedrix AI search is reviewed by a 5-agent pipeline for accuracy. Buy more searches below, or redeem a gift code.';

    const trial = document.getElementById('cpwTrial');
    trial.style.display = offerTrial ? 'block' : 'none';
    resetTrialSteps();
    const to = document.getElementById('cpwTrialTo');
    to.textContent = email ? `We'll send a code to ${email}` : '';
    to.style.display = email ? 'block' : 'none';

    showMsg('', '');
    document.getElementById('caedrixPaywallModal').style.display = 'block';
  }

  function resetTrialSteps() {
    document.getElementById('cpwTrialStep1').style.display = 'block';
    document.getElementById('cpwTrialStep2').style.display = 'none';
    const codeInput = document.getElementById('cpwTrialCode');
    if (codeInput) codeInput.value = '';
    const sendBtn = document.getElementById('cpwTrialSendBtn');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Email me a code for 2 free searches'; }
  }

  /**
   * Returns the email to use for a purchase/redemption, saving it as the
   * account email. Used for buying and gift codes (unchanged behavior).
   */
  function getOrCollectEmail() {
    const existing = getUserEmail();
    if (existing) return existing;

    const input = document.getElementById('cpwEmailInput');
    const val = input ? input.value.trim() : '';
    if (!val || !EMAIL_RE.test(val)) {
      showMsg('Please enter a valid email address to continue.', 'error');
      if (input) input.focus();
      return null;
    }
    try {
      localStorage.setItem('caedrix_user', JSON.stringify({ email: val }));
    } catch (_) {}
    return val;
  }

  // For the trial: reads the email but does NOT save it until it's verified.
  function readTrialEmail() {
    const existing = getUserEmail();
    if (existing) return existing;
    const input = document.getElementById('cpwEmailInput');
    const val = input ? input.value.trim() : '';
    if (!val || !EMAIL_RE.test(val)) {
      showMsg('Enter your email address above, then tap the button.', 'error');
      if (input) input.focus();
      return null;
    }
    return val;
  }

  // ---------- Free trial ----------

  const TRIAL_ERRORS = {
    INVALID_EMAIL: 'Please enter a valid email address.',
    DISPOSABLE_EMAIL: 'Please use a permanent email address, not a temporary one.',
    ALREADY_CLAIMED: 'This email has already used its free searches. You can buy searches below.',
    DAILY_LIMIT: 'Today\u2019s free trials are all claimed. Please check back tomorrow, or buy searches below.',
    TOO_MANY_REQUESTS: 'Too many requests from this connection. Please try again in an hour.',
    RESEND_TOO_SOON: 'A code was just sent. Wait a minute before asking for another.',
    SEND_FAILED: 'The code email could not be sent. Check the address and try again.',
    INVALID_CODE: 'Enter the 6-digit code from the email.',
    CODE_EXPIRED: 'That code has expired. Tap \u201cResend code\u201d to get a new one.',
    TOO_MANY_ATTEMPTS: 'Too many wrong tries. Tap \u201cResend code\u201d to get a new one.',
    SERVER_ERROR: 'Something went wrong on our end. Please try again.'
  };

  async function startTrial() {
    const email = pendingTrialEmail && document.getElementById('cpwTrialStep2').style.display === 'block'
      ? pendingTrialEmail
      : readTrialEmail();
    if (!email) return;

    const sendBtn = document.getElementById('cpwTrialSendBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending\u2026'; }
    showMsg('', '');

    try {
      const res = await fetch('/api/trial-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.ok) {
        pendingTrialEmail = email;
        document.getElementById('cpwEmailRow').style.display = 'none';
        document.getElementById('cpwTrialStep1').style.display = 'none';
        document.getElementById('cpwTrialStep2').style.display = 'block';
        document.getElementById('cpwTrialSent').textContent =
          `We sent a 6-digit code to ${email}. It expires in 10 minutes. Check your spam folder if you don't see it.`;
        const codeInput = document.getElementById('cpwTrialCode');
        if (codeInput) codeInput.focus();
        return;
      }
      if (data.error === 'ALREADY_CLAIMED') {
        markTrialClaimed();
        document.getElementById('cpwTrial').style.display = 'none';
      }
      showMsg(TRIAL_ERRORS[data.error] || 'Could not send the code. Please try again.', 'error');
    } catch (_) {
      showMsg('Network error sending the code. Please try again.', 'error');
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Email me a code for 2 free searches'; }
    }
  }

  async function verifyTrial() {
    const email = pendingTrialEmail;
    const codeInput = document.getElementById('cpwTrialCode');
    const code = codeInput ? codeInput.value.replace(/\D/g, '') : '';
    if (!email) { changeTrialEmail(); return; }
    if (code.length !== 6) { showMsg(TRIAL_ERRORS.INVALID_CODE, 'error'); return; }

    const btn = document.getElementById('cpwTrialVerifyBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }

    try {
      const res = await fetch('/api/trial-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const data = await res.json();
      if (data.ok) {
        // Verified: this email is now the account.
        if (!getUserEmail()) {
          try { localStorage.setItem('caedrix_user', JSON.stringify({ email })); } catch (_) {}
        }
        markTrialClaimed();
        pendingTrialEmail = null;
        document.getElementById('cpwTrial').style.display = 'none';
        showMsg(`Email confirmed. ${data.tokensGranted} free searches added. Tap the search button again to run your search.`, 'success');
        try {
          window.dispatchEvent(new CustomEvent('caedrix:credits-updated', { detail: { tokens: data.remaining } }));
        } catch (_) {}
        setTimeout(hidePaywall, 3500);
        return;
      }
      if (data.error === 'WRONG_CODE') {
        showMsg(`That code isn't right. ${data.attemptsLeft} ${data.attemptsLeft === 1 ? 'try' : 'tries'} left.`, 'error');
      } else {
        if (data.error === 'ALREADY_CLAIMED') {
          markTrialClaimed();
          document.getElementById('cpwTrial').style.display = 'none';
        }
        showMsg(TRIAL_ERRORS[data.error] || 'Could not verify the code. Please try again.', 'error');
      }
    } catch (_) {
      showMsg('Network error checking the code. Please try again.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
    }
  }

  function changeTrialEmail() {
    pendingTrialEmail = null;
    resetTrialSteps();
    showMsg('', '');
    if (!getUserEmail()) {
      document.getElementById('cpwEmailRow').style.display = 'block';
      const input = document.getElementById('cpwEmailInput');
      if (input) input.focus();
    }
  }

  // ---------- Existing purchase / redeem ----------

  function hidePaywall(evt) {
    const modal = document.getElementById('caedrixPaywallModal');
    if (modal) modal.style.display = 'none';
  }

  function getAndClearResumeDraft() {
    const key = 'caedrix_draft:' + window.location.pathname;
    try {
      const val = sessionStorage.getItem(key);
      if (val) {
        sessionStorage.removeItem(key);
        try { localStorage.removeItem(key); } catch (_) {}
        return val;
      }
    } catch (_) { /* fall through to localStorage backup */ }

    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        localStorage.removeItem(key);
        const parsed = JSON.parse(raw);
        if (parsed && parsed.expires > Date.now()) {
          return parsed.text || '';
        }
      }
    } catch (_) {}

    return '';
  }

  async function buy(pack) {
    const email = getOrCollectEmail();
    if (!email) return;
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pack, returnUrl: window.location.pathname })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showMsg(data.message || 'Could not start checkout. Please try again.', 'error');
      }
    } catch (err) {
      showMsg('Network error starting checkout.', 'error');
    }
  }

  async function redeem() {
    const email = getOrCollectEmail();
    if (!email) return;
    const input = document.getElementById('cpwCodeInput');
    const code = input.value.trim();
    if (!code) return;
    try {
      const res = await fetch('/api/redeem-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, email })
      });
      const data = await res.json();
      if (data.ok) {
        showMsg(`Success! ${data.tokensGranted} search(es) added. You now have ${data.remaining}.`, 'success');
        input.value = '';
      } else {
        const messages = {
          NOT_FOUND: 'That code was not found.',
          INACTIVE: 'That code is no longer active.',
          EXHAUSTED: 'That code has already been fully redeemed.',
          ALREADY_REDEEMED: "You've already redeemed this code.",
          INVALID_EMAIL: 'Please log in again before redeeming a code.'
        };
        showMsg(messages[data.error] || 'Could not redeem that code.', 'error');
      }
    } catch (err) {
      showMsg('Network error redeeming code.', 'error');
    }
  }

  function showMsg(text, type) {
    const el = document.getElementById('cpwMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'cpw-msg ' + (type || '');
  }

  return {
    fetchBalance,
    renderBalanceBadge,
    syncButtonLabel,
    spendTokenOrPrompt,
    showPaywall,
    hidePaywall,
    buy,
    redeem,
    startTrial,
    verifyTrial,
    changeTrialEmail,
    getOrCollectEmail,
    getAndClearResumeDraft
  };

})();
