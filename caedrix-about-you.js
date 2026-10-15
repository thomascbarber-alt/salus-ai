/**
 * Caedrix AI — "About you" panel
 * =================================================
 * Replaces the old Precision Medicine profile. Used on:
 *   - health-decisions.html
 *   - determine-diagnosis.html
 * (Understand Diagnosis does not use it.)
 *
 * Nothing here is remembered between visits. The boxes start empty on
 * every page load. The only exception is the Stripe purchase round trip:
 * if a user with no searches left fills the boxes, hits Analyze, and is
 * sent to Stripe to buy, their entries are held for up to 30 minutes so
 * they don't have to retype them when they come back. That copy is
 * erased as soon as it's restored or a search actually runs.
 *
 * Page usage:
 *   <div id="aboutYouPanel" data-accent="#b8932a"></div>
 *   <script src="caedrix-about-you.js"></script>
 *   CaedrixAboutYou.init('aboutYouPanel');
 *   CaedrixAboutYou.holdForCheckout();      // just before spendTokenOrPrompt
 *   CaedrixAboutYou.clearHeld();            // once a token is spent
 *   CaedrixAboutYou.buildContextBlock(opts) // text added to the AI request
 */
(function () {
  const FIELDS = [
    { key: 'activities', label: 'Favorite activities',
      hint: 'e.g. golf twice a week, hiking, gardening, playing with grandkids' },
    { key: 'living', label: 'Living situation',
      hint: 'e.g. married, live on a farm in a rural area, an hour from the nearest hospital' },
    { key: 'ageSex', label: 'Age and sex', special: 'ageSex' },
    { key: 'social', label: 'Social history',
      hint: 'e.g. retired teacher; caring for my mother; two teenagers at home' },
    { key: 'medical', label: 'Medical history',
      hint: 'e.g. type 2 diabetes, high blood pressure; medications: metformin, lisinopril; allergic to penicillin' },
    { key: 'surgery', label: 'Previous surgery',
      hint: 'e.g. right knee arthroscopy 2015, appendix removed as a teenager' },
    { key: 'substance', label: 'Substance use',
      hint: 'e.g. never smoked; 2 glasses of wine a week; no recreational drugs' }
  ];

  const PROMPT_LABELS = {
    activities: 'Favorite activities',
    living: 'Living situation',
    social: 'Social history (work, family)',
    medical: 'Medical history',
    surgery: 'Previous surgery',
    substance: 'Substance use (smoking, alcohol, drugs)'
  };

  const HOLD_KEY = () => 'caedrix_aboutyou_hold:' + window.location.pathname;
  const HOLD_MS = 30 * 60 * 1000;
  let rootId = null;

  function injectStyles(accent) {
    if (document.getElementById('caedrixAboutYouStyles')) return;
    const css = `
      .cay-panel{--cay-accent:${accent};border-radius:20px;margin-bottom:28px;padding:26px 30px 24px;
        background:rgba(255,255,255,0.025);border:1px solid color-mix(in srgb,var(--cay-accent) 28%,transparent);}
      .cay-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:6px;}
      .cay-title{font-family:'Playfair Display',Georgia,serif;font-size:22px;color:#fff;margin:0;}
      .cay-optional{font-size:12px;color:rgba(255,255,255,0.45);}
      .cay-sub{font-size:14px;line-height:1.55;color:rgba(255,255,255,0.6);margin:0 0 20px;max-width:62ch;}
      .cay-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px;}
      .cay-field{display:flex;flex-direction:column;gap:7px;min-width:0;}
      .cay-field label,.cay-field .cay-label{font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);}
      .cay-field textarea,.cay-field input,.cay-field select{width:100%;box-sizing:border-box;
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:10px;
        color:#fff;font-family:'DM Sans',system-ui,sans-serif;font-size:14px;line-height:1.5;padding:10px 12px;outline:none;
        transition:border-color .2s,background-color .2s;}
      .cay-field textarea{resize:vertical;min-height:64px;}
      .cay-field textarea::placeholder,.cay-field input::placeholder{color:rgba(255,255,255,0.3);}
      .cay-field textarea:focus,.cay-field input:focus,.cay-field select:focus{
        border-color:var(--cay-accent);background:rgba(255,255,255,0.06);}
      .cay-field select{appearance:none;cursor:pointer;
        background-image:linear-gradient(45deg,transparent 50%,rgba(255,255,255,0.5) 50%),linear-gradient(135deg,rgba(255,255,255,0.5) 50%,transparent 50%);
        background-position:calc(100% - 17px) 50%,calc(100% - 12px) 50%;background-size:5px 5px;background-repeat:no-repeat;padding-right:30px;}
      .cay-field select option{color:#0c1e3a;}
      .cay-agesex{display:grid;grid-template-columns:110px 1fr;gap:10px;}
      .cay-wide{grid-column:1 / -1;}
      .cay-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;
        font-size:12px;color:rgba(255,255,255,0.4);}
      .cay-clear{background:none;border:none;color:rgba(255,255,255,0.55);font-size:12px;cursor:pointer;padding:4px 0;
        text-decoration:underline;text-underline-offset:3px;}
      .cay-clear:hover{color:#fff;}
      .cay-field :focus-visible,.cay-clear:focus-visible{outline:2px solid var(--cay-accent);outline-offset:2px;}
      @media (max-width:768px){
        .cay-panel{padding:22px 18px 20px;}
        .cay-grid{grid-template-columns:1fr;}
      }`;
    const style = document.createElement('style');
    style.id = 'caedrixAboutYouStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function fieldHtml(f) {
    const id = 'cay_' + f.key;
    if (f.special === 'ageSex') {
      return `
        <div class="cay-field">
          <span class="cay-label" id="cay_ageSex_label">${f.label}</span>
          <div class="cay-agesex" role="group" aria-labelledby="cay_ageSex_label">
            <input id="cay_age" type="number" inputmode="numeric" min="0" max="120" placeholder="Age" aria-label="Age" autocomplete="off">
            <select id="cay_sex" aria-label="Sex">
              <option value="">Sex</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Intersex / other">Intersex / other</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </div>
        </div>`;
    }
    return `
      <div class="cay-field">
        <label for="${id}">${f.label}</label>
        <textarea id="${id}" rows="2" placeholder="${f.hint}" autocomplete="off"></textarea>
      </div>`;
  }

  function init(containerId) {
    rootId = containerId;
    const root = document.getElementById(containerId);
    if (!root) return;
    const accent = root.getAttribute('data-accent') || '#b8932a';
    injectStyles(accent);

    // Medical history spans the full width — it tends to be the longest answer.
    const html = FIELDS.map(f => {
      const h = fieldHtml(f);
      return f.key === 'medical' ? h.replace('class="cay-field"', 'class="cay-field cay-wide"') : h;
    }).join('');

    root.className = 'cay-panel';
    root.innerHTML = `
      <div class="cay-head">
        <h2 class="cay-title">About you</h2>
        <span class="cay-optional">Optional</span>
      </div>
      <p class="cay-sub">The more you tell us, the more your answer is tailored to you. Fill in whatever applies and leave the rest blank.</p>
      <div class="cay-grid">${html}</div>
      <div class="cay-foot">
        <span>Nothing here is saved. You'll enter it fresh each visit.</span>
        <button type="button" class="cay-clear" onclick="CaedrixAboutYou.clear()">Clear all</button>
      </div>`;

    restoreHeld();
  }

  function el(id) { return document.getElementById(id); }

  function getValues() {
    const v = {};
    Object.keys(PROMPT_LABELS).forEach(k => { v[k] = (el('cay_' + k)?.value || '').trim(); });
    v.age = (el('cay_age')?.value || '').trim();
    v.sex = (el('cay_sex')?.value || '').trim();
    return v;
  }

  function setValues(v) {
    if (!v) return;
    Object.keys(PROMPT_LABELS).forEach(k => { if (el('cay_' + k) && v[k]) el('cay_' + k).value = v[k]; });
    if (el('cay_age') && v.age) el('cay_age').value = v.age;
    if (el('cay_sex') && v.sex) el('cay_sex').value = v.sex;
  }

  function clear() {
    const root = rootId && el(rootId);
    if (!root) return;
    root.querySelectorAll('textarea,input').forEach(i => { i.value = ''; });
    root.querySelectorAll('select').forEach(s => { s.value = ''; });
    clearHeld();
  }

  function hasAny() {
    const v = getValues();
    return Object.values(v).some(Boolean);
  }

  function getAge() { return getValues().age; }
  function getSex() { return getValues().sex; }

  /**
   * Text appended to the AI request. Returns '' when every box is empty.
   * opts.includeAgeSex (default true) — Determine Diagnosis already sends
   * age and sex on their own line, so it passes false to avoid repeating them.
   */
  function buildContextBlock(opts) {
    const includeAgeSex = !opts || opts.includeAgeSex !== false;
    const v = getValues();
    const lines = [];
    if (includeAgeSex) {
      if (v.age) lines.push('Age: ' + v.age);
      if (v.sex) lines.push('Sex: ' + v.sex);
    }
    Object.entries(PROMPT_LABELS).forEach(([k, label]) => {
      if (v[k]) lines.push(label + ': ' + v[k]);
    });
    if (!lines.length) return '';
    return '\n\n---\nInformation the patient entered about themselves for this question:\n' + lines.join('\n') + '\n---';
  }

  // ---------- Stripe round-trip hold (see header comment) ----------
  function holdForCheckout() {
    if (!hasAny()) return;
    const payload = JSON.stringify({ values: getValues(), expires: Date.now() + HOLD_MS });
    try { sessionStorage.setItem(HOLD_KEY(), payload); } catch (_) {}
    try { localStorage.setItem(HOLD_KEY(), payload); } catch (_) {}
  }

  function clearHeld() {
    try { sessionStorage.removeItem(HOLD_KEY()); } catch (_) {}
    try { localStorage.removeItem(HOLD_KEY()); } catch (_) {}
  }

  function restoreHeld() {
    let raw = null;
    try { raw = sessionStorage.getItem(HOLD_KEY()); } catch (_) {}
    if (!raw) { try { raw = localStorage.getItem(HOLD_KEY()); } catch (_) {} }
    clearHeld();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.expires > Date.now()) setValues(parsed.values);
    } catch (_) {}
  }

  // One-time cleanup of the old Precision Medicine profile so it no
  // longer sits in returning visitors' browsers.
  try {
    ['caedrix_life_context', 'caedrix_health_profile', 'caedrix_records_connected']
      .forEach(k => localStorage.removeItem(k));
  } catch (_) {}

  window.CaedrixAboutYou = {
    init, clear, hasAny, getAge, getSex, buildContextBlock,
    holdForCheckout, clearHeld
  };
})();
