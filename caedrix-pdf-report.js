/**
 * Caedrix AI — Search Result PDF Report Generator
 * ==================================================
 * Builds clean, structured (not screenshot) PDF reports from search result
 * data, for the "Save to My Records" button on:
 *   - health-decisions.html      (buildHealthDecisionPDF)
 *   - determine-diagnosis.html   (buildDeterminePDF)
 *   - understand-diagnosis.html  (buildUnderstandPDF)
 *
 * Requires jsPDF, loaded via CDN before this file:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
 *
 * Also requires caedrix-local-storage.js to be loaded, for saving the
 * generated PDF into the user's connected health folder. If no folder is
 * connected, the PDF triggers a normal browser download instead.
 *
 * Each builder function returns the jsPDF doc instance. The shared
 * saveOrDownloadPDF() helper handles "save to folder" vs "download" and
 * the on-page button state (loading/success/error).
 */

const CaedrixPDF = (function () {

  // ---------- Layout constants ----------
  const PAGE_W = 612;   // Letter, points
  const PAGE_H = 792;
  const MARGIN_X = 56;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;
  const NAVY = [12, 30, 58];
  const TEAL = [10, 124, 110];
  const GOLD = [184, 147, 42];
  const TEXT_DARK = [30, 30, 35];
  const TEXT_MUTED = [110, 110, 118];

  // ---------- Low-level drawing helpers (operate on a jsPDF doc + cursor) ----------

  function newDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: 'pt', format: 'letter' });
  }

  function ensureSpace(doc, y, needed) {
    if (y + needed > PAGE_H - 60) {
      doc.addPage();
      return 56;
    }
    return y;
  }

  function drawMasthead(doc, title, subtitle) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PAGE_W, 86, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('CAEDRIX AI', MARGIN_X, 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(212, 170, 58);
    doc.text('YOUR HEALTH COACH', MARGIN_X, 50);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(title, MARGIN_X, 72);
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(200, 210, 220);
      doc.text(subtitle, PAGE_W - MARGIN_X, 72, { align: 'right' });
    }
    return 110; // y cursor after masthead
  }

  function drawSectionHeading(doc, y, label) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...TEAL);
    doc.text(label.toUpperCase(), MARGIN_X, y);
    doc.setDrawColor(...TEAL);
    doc.setLineWidth(1);
    doc.line(MARGIN_X, y + 5, PAGE_W - MARGIN_X, y + 5);
    return y + 22;
  }

  function drawWrappedText(doc, y, text, opts = {}) {
    if (!text) return y;
    const size = opts.size || 10;
    const color = opts.color || TEXT_DARK;
    const lineHeight = opts.lineHeight || size * 1.45;
    const bold = opts.bold || false;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    lines.forEach(line => {
      y = ensureSpace(doc, y, lineHeight);
      doc.text(line, MARGIN_X, y);
      y += lineHeight;
    });
    return y;
  }

  function drawLabelValue(doc, y, label, value) {
    if (!value) return y;
    y = ensureSpace(doc, y, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(label.toUpperCase() + ':', MARGIN_X, y);
    y += 14;
    return drawWrappedText(doc, y, value, { size: 10 });
  }

  function drawBulletList(doc, y, items, opts = {}) {
    if (!items || !items.length) return y;
    const size = opts.size || 10;
    doc.setFontSize(size);
    items.forEach((item, i) => {
      y = ensureSpace(doc, y, size * 1.6);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...TEAL);
      const bullet = opts.numbered ? `${i + 1}.` : '•';
      doc.text(bullet, MARGIN_X, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...TEXT_DARK);
      const lines = doc.splitTextToSize(String(item), CONTENT_W - 18);
      lines.forEach((line, li) => {
        if (li > 0) y = ensureSpace(doc, y, size * 1.45);
        doc.text(line, MARGIN_X + 16, y);
        if (li < lines.length - 1) y += size * 1.45;
      });
      y += size * 1.6;
    });
    return y;
  }

  function drawCardTitle(doc, y, title, badge) {
    y = ensureSpace(doc, y, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text(title, MARGIN_X, y);
    if (badge) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...GOLD);
      doc.text(badge, PAGE_W - MARGIN_X, y, { align: 'right' });
    }
    return y + 16;
  }

  function drawDisclaimerFooter(doc) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(
        'Generated by Caedrix AI for educational purposes only. Not a substitute for professional medical advice. Always consult your physician.',
        MARGIN_X, PAGE_H - 36, { maxWidth: CONTENT_W }
      );
      doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN_X, PAGE_H - 36, { align: 'right' });
    }
  }

  function dateStamp() {
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ---------- Page-specific builders ----------

  /** health-decisions.html — result shape: { question_understood, key_takeaway,
   *  options:[{title,summary,description,how_it_applies,benefits[],considerations[],
   *  evidence_level,evidence_basis,best_for}], discuss_with_doctor:[] } */
  function buildHealthDecisionPDF(result, originalQuestion) {
    const doc = newDoc();
    let y = drawMasthead(doc, 'Health Decision Analysis', dateStamp());

    y = drawSectionHeading(doc, y, 'Your Question');
    y = drawWrappedText(doc, y, '"' + (result.question_understood || originalQuestion || '') + '"', { size: 11, bold: true });
    y += 8;

    if (result.key_takeaway) {
      y = drawSectionHeading(doc, y, 'Key Takeaway');
      y = drawWrappedText(doc, y, result.key_takeaway, { size: 10.5 });
      y += 8;
    }

    y = drawSectionHeading(doc, y, 'Options Considered');
    (result.options || []).forEach((opt, i) => {
      y = ensureSpace(doc, y, 40);
      y = drawCardTitle(doc, y, `Option ${i + 1}: ${opt.title || ''}`,
        opt.evidence_level ? `${opt.evidence_level.toUpperCase()} EVIDENCE` : '');
      y = drawWrappedText(doc, y, opt.summary, { size: 9.5, color: TEXT_MUTED });
      y += 4;
      y = drawWrappedText(doc, y, opt.description, { size: 10 });
      if (opt.how_it_applies) {
        y += 4;
        y = drawLabelValue(doc, y, 'How this applies to you', opt.how_it_applies);
      }
      if ((opt.benefits || []).length) {
        y += 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...TEXT_MUTED);
        y = ensureSpace(doc, y, 14); doc.text('BENEFITS', MARGIN_X, y); y += 14;
        y = drawBulletList(doc, y, opt.benefits, { size: 9.5 });
      }
      if ((opt.considerations || []).length) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...TEXT_MUTED);
        y = ensureSpace(doc, y, 14); doc.text('CONSIDERATIONS', MARGIN_X, y); y += 14;
        y = drawBulletList(doc, y, opt.considerations, { size: 9.5 });
      }
      if (opt.evidence_basis || opt.best_for) {
        const line = [opt.evidence_basis ? `Evidence: ${opt.evidence_basis}` : '', opt.best_for ? `Best for: ${opt.best_for}` : '']
          .filter(Boolean).join('   ·   ');
        y = drawWrappedText(doc, y, line, { size: 8.5, color: TEXT_MUTED });
      }
      y += 14;
      doc.setDrawColor(225, 225, 230); doc.setLineWidth(0.5);
      doc.line(MARGIN_X, y - 8, PAGE_W - MARGIN_X, y - 8);
    });

    if ((result.discuss_with_doctor || []).length) {
      y = drawSectionHeading(doc, y, 'Questions to Discuss With Your Doctor');
      y = drawBulletList(doc, y, result.discuss_with_doctor, { numbered: true });
    }

    drawDisclaimerFooter(doc);
    return doc;
  }

  /** determine-diagnosis.html — result shape: { symptom_summary, urgency, urgency_reason,
   *  differential_diagnoses:[{rank,diagnosis_name,what_it_is,probability_tier,
   *  probability_explanation,matching_symptoms[],typical_course,key_differentiating_factors[],
   *  less_typical_aspects}], red_flag_symptoms[], tests_likely_ordered[], questions_for_doctor[],
   *  clinical_summary, recent_research } */
  function buildDeterminePDF(result) {
    const doc = newDoc();
    let y = drawMasthead(doc, 'Symptom Analysis Report', dateStamp());

    y = drawSectionHeading(doc, y, 'Symptoms Reported');
    y = drawWrappedText(doc, y, '"' + (result.symptom_summary || '') + '"', { size: 11, bold: true });
    y += 8;

    if (result.urgency) {
      const uLabels = { emergency: 'SEEK EMERGENCY CARE NOW', urgent: 'SEE A DOCTOR TODAY',
        soon: 'SEE A DOCTOR WITHIN A FEW DAYS', routine: 'ROUTINE MEDICAL VISIT APPROPRIATE' };
      y = drawSectionHeading(doc, y, 'Urgency Guidance');
      y = drawWrappedText(doc, y, uLabels[result.urgency] || result.urgency, { size: 11, bold: true, color: [180, 50, 40] });
      y = drawWrappedText(doc, y, result.urgency_reason, { size: 9.5, color: TEXT_MUTED });
      y += 8;
    }

    y = drawSectionHeading(doc, y, 'Possible Diagnoses (Differential)');
    (result.differential_diagnoses || []).forEach(d => {
      y = ensureSpace(doc, y, 40);
      const tierLabel = d.probability_tier === 'high' ? 'HIGHER LIKELIHOOD'
        : d.probability_tier === 'moderate' ? 'MODERATE LIKELIHOOD' : 'LOWER LIKELIHOOD';
      y = drawCardTitle(doc, y, `${d.rank || ''}. ${d.diagnosis_name || ''}`, tierLabel);
      y = drawWrappedText(doc, y, d.what_it_is, { size: 9.5, color: TEXT_MUTED });
      y += 4;
      y = drawLabelValue(doc, y, 'Why this fits your symptoms', d.probability_explanation);
      if ((d.matching_symptoms || []).length) {
        y += 4;
        y = drawLabelValue(doc, y, 'Matching symptoms', d.matching_symptoms.join(', '));
      }
      if (d.typical_course) { y += 4; y = drawLabelValue(doc, y, 'Typical course', d.typical_course); }
      if (d.less_typical_aspects) { y += 4; y = drawLabelValue(doc, y, "What doesn't fit as well", d.less_typical_aspects); }
      y += 14;
      doc.setDrawColor(225, 225, 230); doc.setLineWidth(0.5);
      doc.line(MARGIN_X, y - 8, PAGE_W - MARGIN_X, y - 8);
    });

    if ((result.red_flag_symptoms || []).length) {
      y = drawSectionHeading(doc, y, 'Red Flag Symptoms — Seek Care If These Occur');
      y = drawBulletList(doc, y, result.red_flag_symptoms);
    }
    if ((result.tests_likely_ordered || []).length) {
      y = drawSectionHeading(doc, y, 'Tests Your Doctor May Order');
      y = drawBulletList(doc, y, result.tests_likely_ordered);
    }
    if ((result.questions_for_doctor || []).length) {
      y = drawSectionHeading(doc, y, 'Questions to Ask Your Doctor');
      y = drawBulletList(doc, y, result.questions_for_doctor, { numbered: true });
    }
    if (result.clinical_summary) {
      y = drawSectionHeading(doc, y, 'Clinical Summary');
      y = drawWrappedText(doc, y, result.clinical_summary, { size: 10 });
    }
    if (result.recent_research) {
      y = drawSectionHeading(doc, y, 'Recent Research');
      y = drawWrappedText(doc, y, result.recent_research, { size: 10 });
    }

    drawDisclaimerFooter(doc);
    return doc;
  }

  /** understand-diagnosis.html — result shape (c): { diagnosis_name, also_known_as[],
   *  key_takeaway, what_it_is, diagnosis:[{method,description,when_used}],
   *  treatments:[{name,description,evidence_level,evidence_basis,best_for}],
   *  recent_research_summary, recent_advances:[{date/year,title,description,significance}],
   *  trials_overview, active_trials:[{title,phase,focus,sponsor,eligibility}],
   *  specialists:[{name,institution,location,known_for}], centers:[{name,location,distinction,why_notable}],
   *  questions_for_doctor[] } */
  function buildUnderstandPDF(c) {
    const doc = newDoc();
    let y = drawMasthead(doc, 'Diagnosis Deep Dive', dateStamp());

    y = drawSectionHeading(doc, y, c.diagnosis_name || 'Diagnosis');
    if ((c.also_known_as || []).filter(Boolean).length) {
      y = drawWrappedText(doc, y, 'Also known as: ' + c.also_known_as.filter(Boolean).join(', '), { size: 9, color: TEXT_MUTED });
    }
    if (c.key_takeaway) y = drawWrappedText(doc, y, c.key_takeaway, { size: 10.5, bold: true });
    y += 8;

    if (c.what_it_is) {
      y = drawSectionHeading(doc, y, 'What It Is');
      y = drawWrappedText(doc, y, c.what_it_is, { size: 10 });
    }

    if ((c.diagnosis || []).length) {
      y = drawSectionHeading(doc, y, 'How It Is Diagnosed');
      c.diagnosis.forEach(m => {
        y = drawCardTitle(doc, y, m.method || '');
        y = drawWrappedText(doc, y, m.description, { size: 9.5 });
        if (m.when_used) y = drawWrappedText(doc, y, 'When used: ' + m.when_used, { size: 8.5, color: TEXT_MUTED });
        y += 8;
      });
    }

    if ((c.treatments || []).length) {
      y = drawSectionHeading(doc, y, 'Treatment Options');
      c.treatments.forEach(tx => {
        y = drawCardTitle(doc, y, tx.name || '', tx.evidence_level ? `${tx.evidence_level.toUpperCase()} EVIDENCE` : '');
        y = drawWrappedText(doc, y, tx.description, { size: 9.5 });
        if (tx.evidence_basis) y = drawWrappedText(doc, y, 'Evidence: ' + tx.evidence_basis, { size: 8.5, color: TEXT_MUTED });
        if (tx.best_for) y = drawWrappedText(doc, y, 'Best for: ' + tx.best_for, { size: 8.5, color: TEXT_MUTED });
        y += 8;
      });
    }

    if (c.recent_research_summary || (c.recent_advances || []).length) {
      y = drawSectionHeading(doc, y, 'Recent Research');
      if (c.recent_research_summary) y = drawWrappedText(doc, y, c.recent_research_summary, { size: 10 });
      (c.recent_advances || []).forEach(a => {
        y += 4;
        y = drawCardTitle(doc, y, `${a.date || a.year || ''} — ${a.title || ''}`);
        y = drawWrappedText(doc, y, a.description, { size: 9.5 });
        if (a.significance) y = drawWrappedText(doc, y, '▶ ' + a.significance, { size: 8.5, color: TEAL });
      });
    }

    if (c.trials_overview || (c.active_trials || []).length) {
      y = drawSectionHeading(doc, y, 'Clinical Trials & Centers');
      if (c.trials_overview) y = drawWrappedText(doc, y, c.trials_overview, { size: 10 });
      (c.active_trials || []).forEach(tr => {
        y += 4;
        y = drawCardTitle(doc, y, tr.title || '', tr.phase || '');
        y = drawWrappedText(doc, y, tr.focus, { size: 9.5 });
        const meta = [tr.sponsor, tr.eligibility ? `Eligibility: ${tr.eligibility}` : ''].filter(Boolean).join('  ·  ');
        if (meta) y = drawWrappedText(doc, y, meta, { size: 8.5, color: TEXT_MUTED });
      });
      (c.specialists || []).forEach(s => {
        y += 4;
        y = drawCardTitle(doc, y, s.name || '');
        y = drawWrappedText(doc, y, `${s.institution || ''} · ${s.location || ''}`, { size: 9, color: TEXT_MUTED });
        if (s.known_for) y = drawWrappedText(doc, y, s.known_for, { size: 9.5 });
      });
      (c.centers || []).forEach(ct => {
        y += 4;
        y = drawCardTitle(doc, y, ct.name || '');
        y = drawWrappedText(doc, y, `${ct.location || ''}${ct.distinction ? ' · ' + ct.distinction : ''}`, { size: 9, color: TEXT_MUTED });
        if (ct.why_notable) y = drawWrappedText(doc, y, ct.why_notable, { size: 9.5 });
      });
    }

    if ((c.questions_for_doctor || []).length) {
      y = drawSectionHeading(doc, y, 'Questions to Ask Your Doctor');
      y = drawBulletList(doc, y, c.questions_for_doctor, { numbered: true });
    }

    drawDisclaimerFooter(doc);
    return doc;
  }

  // ---------- Save / download orchestration ----------

  /**
   * Takes a built jsPDF doc, and either:
   *  - saves it into the user's connected local health folder (search-history/), or
   *  - triggers a normal browser download if no folder is connected / unsupported.
   * `buttonEl` (optional) gets its label updated to reflect progress.
   */
  async function saveOrDownloadPDF(doc, filenameBase, buttonEl) {
    const setLabel = (text) => { if (buttonEl) buttonEl.textContent = text; };
    const originalLabel = buttonEl ? buttonEl.textContent : null;

    try {
      setLabel('Saving…');
      if (typeof CaedrixStorage !== 'undefined' && CaedrixStorage.isConnected()) {
        const blob = doc.output('blob');
        await CaedrixStorage.saveSearchResultPDF(blob, filenameBase);
        setLabel('✓ Saved to Folder');
      } else {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        doc.save(`${stamp}_${filenameBase}.pdf`);
        setLabel('✓ Downloaded');
      }
    } catch (err) {
      setLabel('Save failed — try again');
      console.error('Caedrix PDF save error:', err);
    } finally {
      if (buttonEl && originalLabel) {
        setTimeout(() => { buttonEl.textContent = originalLabel; }, 2500);
      }
    }
  }

  return {
    buildHealthDecisionPDF,
    buildDeterminePDF,
    buildUnderstandPDF,
    saveOrDownloadPDF
  };

})();
