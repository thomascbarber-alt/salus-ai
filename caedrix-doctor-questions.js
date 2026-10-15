/**
 * Caedrix AI — Guarantee "Questions to ask your doctor"
 * =====================================================
 * Used by health-decisions.html, determine-diagnosis.html and
 * understand-diagnosis.html.
 *
 * Why this exists: each search runs several AI agents, and the
 * doctor-questions list is the LAST field in their JSON answers. When a
 * long answer gets cut off, the page's JSON repair keeps everything up to
 * the cut and silently drops that last field — so results showed up with
 * no doctor questions. This helper runs just before results are shown
 * and makes sure the list is never empty:
 *
 *   1. Keep the questions the result already has.
 *   2. Otherwise copy them from an earlier agent's answer (e.g. before
 *      the clarity/polish step cut them off).
 *   3. Otherwise ask a fast model to write 3 questions from the result.
 *   4. If even that fails, use sensible built-in questions.
 *
 * Usage:
 *   await CaedrixDoctorQs.ensure(result, 'questions_for_doctor', {
 *     sources: [earlierResult],          // optional
 *     topic: 'what the user asked',
 *     context: 'personal details text',  // optional
 *     kind: 'decision' | 'symptoms' | 'diagnosis'
 *   });
 */
(function () {
  function clean(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(q => (typeof q === 'string' ? q : (q && (q.question || q.text)) || ''))
      .map(q => String(q).trim())
      .filter(q => q.length > 3);
  }

  const FALLBACK = {
    decision: [
      'Given my health history, which of these options would you recommend for me, and why?',
      'What are the main risks and benefits of each option in my specific situation?',
      'What happens if I wait or choose not to do anything right now?'
    ],
    symptoms: [
      'What do you think is the most likely cause of my symptoms?',
      'Which tests would help confirm or rule out the possible causes?',
      'Which warning signs mean I should seek care right away?'
    ],
    diagnosis: [
      'What stage or severity is this diagnosis in my case, and how does that affect treatment?',
      'Which treatment options would you recommend, and what are their main risks and benefits?',
      'Is a clinical trial or a referral to a specialist center worth considering?'
    ]
  };

  const WRITER_SYSTEM =
    'You write questions a patient can bring to their doctor. Return ONLY a JSON array of 3 short, ' +
    'specific questions in plain everyday English, tailored to the topic and results provided. ' +
    'No preamble, no markdown, no numbering — just the JSON array of strings.';

  async function writeQuestions(topic, result, context, kind) {
    let summary = '';
    try { summary = JSON.stringify(result).slice(0, 6000); } catch (_) {}
    const what = kind === 'symptoms' ? 'Symptoms described'
               : kind === 'diagnosis' ? 'Diagnosis researched'
               : 'Health decision';
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: WRITER_SYSTEM,
        messages: [{
          role: 'user',
          content: `${what}: "${topic || ''}"${context || ''}\n\nResults so far:\n${summary}`
        }]
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.replace(/```json|```/g, '').match(/\[[\s\S]*\]/);
    if (!m) throw new Error('No JSON array');
    return clean(JSON.parse(m[0]));
  }

  async function ensure(result, key, opts) {
    opts = opts || {};
    if (!result || typeof result !== 'object') return result;

    let qs = clean(result[key]);
    if (!qs.length) {
      for (const src of (opts.sources || [])) {
        qs = clean(src && src[key]);
        if (qs.length) break;
      }
    }
    if (!qs.length) {
      try { qs = await writeQuestions(opts.topic, result, opts.context, opts.kind); }
      catch (err) { console.warn('Doctor questions: writer failed, using built-in questions', err); }
    }
    if (!qs.length) qs = (FALLBACK[opts.kind] || FALLBACK.decision).slice();

    result[key] = qs;
    return result;
  }

  window.CaedrixDoctorQs = { ensure };
})();
