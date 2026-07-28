/**
 * Caedrix AI — Token Purchase & Gating (frontend)
 * ===================================================
 * Handles, on any search page:
 *   - Displaying the user's current token balance
 *   - "Buy tokens" UI ($2.99 single / $12.50 five-pack) -> Stripe Checkout
 *   - Redeeming a gift code
 *   - Gating the actual search behind a server-verified token spend
 *
 * Requires the user to already be logged in (caedrix_user in localStorage
 * with an .email — already enforced site-wide per the auth gate on each
 * page). This module reads that email to identify the token account.
 *
 * USAGE on a search page:
 *   <script src="caedrix-token-gate.js"></script>
 *   ...
 *   async function runAnalysis(){
 *     const allowed = await CaedrixTokenGate.spendTokenOrPrompt();
 *     if (!allowed) return; // user was shown the paywall, don't proceed
 *     // ... existing search logic ...
 *   }
 *
 * Also call CaedrixTokenGate.renderBalanceBadge('elementId') somewhere on
 * page load to show "You have N searches remaining."
 */

const CaedrixTokenGate = (function () {

  const PRICE_SINGLE = '$2.99';
  const PRICE_FIVE = '$12.50';

  function getUserEmail() {
    try {
      const u = JSON.parse(localStorage.getItem('caedrix_user') || 'null');
      return u && u.email ? u.email : null;
    } catch (_) {
      return null;
    }
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
      el.textContent = '';
      el.dataset.tokens = 0;
      return;
    }
    const tokens = await fetchBalance();
    el.textContent = tokens === 1 ? '1 search remaining' : `${tokens} searches remaining`;
    el.dataset.tokens = tokens;
  }

  /**
   * Attempts to spend one token server-side. If the user has none, shows
   * the paywall modal (buy / redeem code) instead and returns false so the
   * calling page does NOT proceed with the search.
   * Returns true only if a token was actually, successfully spent.
   */
  async function spendTokenOrPrompt(draftText) {
    if (typeof draftText === 'string' && draftText.trim()) {
      try { sessionStorage.setItem('caedrix_draft:' + window.location.pathname, draftText); } catch (_) {}
    }
    const email = getUserEmail();
    if (!email) {
      // No account yet — that's fine, they haven't bought anything.
      // Show the paywall so they can buy or redeem a code; email is
      // collected there, only at the moment of purchase.
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
      if (data.ok) {
        return true;
      }
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
          <div class="cpw-icon">🔓</div>
          <h2 class="cpw-title">You're out of searches</h2>
          <p class="cpw-sub">Each Caedrix AI search is reviewed by a 5-agent pipeline for accuracy. Buy more searches below, or redeem a gift code.</p>

          <div class="cpw-email-row" id="cpwEmailRow">
            <input type="email" id="cpwEmailInput" placeholder="Email address" class="cpw-input cpw-email-input" autocomplete="email">
            <div class="cpw-email-note">Used to save your searches — no password needed.</div>
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
        #caedrixPaywallModal .cpw-overlay{position:fixed;inset:0;background:rgba(8,16,30,0.75);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;}
        #caedrixPaywallModal .cpw-card{background:#0c1e3a;border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:36px;max-width:420px;width:100%;position:relative;box-shadow:0 24px 80px rgba(0,0,0,0.5);}
        #caedrixPaywallModal .cpw-close{position:absolute;top:18px;right:20px;color:rgba(255,255,255,0.4);cursor:pointer;font-size:16px;}
        #caedrixPaywallModal .cpw-close:hover{color:white;}
        #caedrixPaywallModal .cpw-icon{font-size:32px;text-align:center;margin-bottom:12px;}
        #caedrixPaywallModal .cpw-title{font-family:'Playfair Display',serif;font-size:22px;color:white;text-align:center;margin-bottom:10px;}
        #caedrixPaywallModal .cpw-sub{font-family:'DM Sans',sans-serif;font-size:13px;color:rgba(255,255,255,0.55);text-align:center;line-height:1.6;margin-bottom:26px;}
        #caedrixPaywallModal .cpw-email-row{margin-bottom:18px;}
        #caedrixPaywallModal .cpw-email-input{width:100%;text-transform:none;}
        #caedrixPaywallModal .cpw-email-note{font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;text-align:center;}
        #caedrixPaywallModal .cpw-packs{display:flex;gap:12px;margin-bottom:22px;}
        #caedrixPaywallModal .cpw-pack{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:18px 12px;cursor:pointer;text-align:center;transition:all .2s;position:relative;}
        #caedrixPaywallModal .cpw-pack:hover{background:rgba(19,160,144,0.1);border-color:rgba(19,160,144,0.4);}
        #caedrixPaywallModal .cpw-pack-best{border-color:rgba(212,170,58,0.4);background:rgba(212,170,58,0.06);}
        #caedrixPaywallModal .cpw-pack-badge{position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#d4aa3a;color:#0c1e3a;font-size:9px;font-weight:700;padding:3px 10px;border-radius:100px;letter-spacing:0.5px;white-space:nowrap;}
        #caedrixPaywallModal .cpw-pack-price{font-family:'DM Sans',sans-serif;font-size:22px;font-weight:700;color:white;margin-bottom:4px;}
        #caedrixPaywallModal .cpw-pack-label{font-size:12px;color:rgba(255,255,255,0.5);}
        #caedrixPaywallModal .cpw-divider{display:flex;align-items:center;gap:12px;margin:18px 0;}
        #caedrixPaywallModal .cpw-divider::before,#caedrixPaywallModal .cpw-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.1);}
        #caedrixPaywallModal .cpw-divider span{font-size:11px;color:rgba(255,255,255,0.3);}
        #caedrixPaywallModal .cpw-redeem{display:flex;gap:8px;}
        #caedrixPaywallModal .cpw-input{flex:1;padding:11px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:white;font-size:13px;outline:none;text-transform:uppercase;}
        #caedrixPaywallModal .cpw-input:focus{border-color:rgba(19,160,144,0.6);}
        #caedrixPaywallModal .cpw-redeem-btn{padding:11px 18px;border-radius:10px;background:rgba(19,160,144,0.15);border:1px solid rgba(19,160,144,0.3);color:#13c0ac;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;}
        #caedrixPaywallModal .cpw-redeem-btn:hover{background:rgba(19,160,144,0.25);}
        #caedrixPaywallModal .cpw-msg{margin-top:12px;font-size:12px;text-align:center;min-height:16px;}
        #caedrixPaywallModal .cpw-msg.error{color:#e07070;}
        #caedrixPaywallModal .cpw-msg.success{color:#3a9e6a;}
      </style>
    `;
    document.body.appendChild(modal);
  }

  function showPaywall() {
    ensureModal();
    const email = getUserEmail();
    const emailRow = document.getElementById('cpwEmailRow');
    const emailInput = document.getElementById('cpwEmailInput');
    if (emailRow) emailRow.style.display = email ? 'none' : 'block';
    if (emailInput && !email) emailInput.value = '';
    document.getElementById('caedrixPaywallModal').style.display = 'block';
  }

  /**
   * Returns the email to use for this purchase/redemption. If the user
   * already has an account (caedrix_user in localStorage), uses that.
   * Otherwise reads + validates the email field in the modal — this is
   * the ONLY point where email is required, right at the moment of
   * buying tokens or redeeming a code, never before.
   */
  function getOrCollectEmail() {
    const existing = getUserEmail();
    if (existing) return existing;

    const input = document.getElementById('cpwEmailInput');
    const val = input ? input.value.trim() : '';
    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      showMsg('Please enter a valid email address to continue.', 'error');
      if (input) input.focus();
      return null;
    }
    try {
      localStorage.setItem('caedrix_user', JSON.stringify({ email: val }));
    } catch (_) {}
    return val;
  }

  function hidePaywall(evt) {
    const modal = document.getElementById('caedrixPaywallModal');
    if (modal) modal.style.display = 'none';
  }

  function getAndClearResumeDraft() {
    try {
      const key = 'caedrix_draft:' + window.location.pathname;
      const val = sessionStorage.getItem(key);
      if (val) sessionStorage.removeItem(key);
      return val || '';
    } catch (_) {
      return '';
    }
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
        window.location.href = data.url; // redirect to Stripe-hosted checkout
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
    el.className = 'cpw-msg ' + type;
  }

  return {
    fetchBalance,
    renderBalanceBadge,
    spendTokenOrPrompt,
    showPaywall,
    hidePaywall,
    buy,
    redeem,
    getOrCollectEmail,
    getAndClearResumeDraft
  };

})();
