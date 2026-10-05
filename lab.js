(() => {
  'use strict';

  const { parse, toWords } = window.HebrewNumbers;
  const { createAssembler, combine } = window.NumberAssembler;
  const $ = id => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Results whose top-alternative confidence is below this ask for confirmation.
  // Chrome sometimes reports 0 (= unknown); those are not treated as low.
  const CONF_THRESHOLD = 0.5;
  // How long to wait after the last fragment for the rest of a split number.
  const WAIT_MS = 1800;

  const CATEGORIES = {
    mixed: { label: 'מעורב' },
    tens: { label: 'עשרות', min: 10, max: 99 },
    hundreds: { label: 'מאות', min: 100, max: 999 },
    thousands: { label: 'אלפים', min: 1000, max: 9999 },
    tenThousands: { label: 'עשרות אלפים', min: 10000, max: 99999 },
    hundredThousands: { label: '6 ספרות', min: 100000, max: 999999 },
    millions: { label: 'מיליונים', min: 1000000, max: 9999999 },
  };
  const STYLES = { full: 'מלא', triplets: 'שלשות', pairs: 'זוגות', digits: 'ספרה-ספרה' };

  // ---------- Storage ----------

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  const state = {
    log: load('hn-log', []),            // final results from the recogniser + assembled commits
    results: load('hn-results', []),    // test-mode evaluations
    numbers: load('hn-numbers', []),    // free-mode list
    digitLength: load('hn-digit-length', 6),
    mode: 'free',
    listening: false,
    lastFinalAt: null,
    restarts: 0,
    test: null,
    pending: null,
  };
  const persist = () => {
    save('hn-log', state.log);
    save('hn-results', state.results);
    save('hn-numbers', state.numbers);
    save('hn-digit-length', state.digitLength);
  };

  // ---------- Status ----------

  function setStatus(text, kind = '') {
    const el = $('status');
    el.textContent = text;
    el.className = 'status ' + kind;
  }

  function showPending(digits) {
    if (!digits) return;
    const el = $('status');
    el.className = 'status listening';
    el.textContent = 'ממשיך לשמוע: ';
    const span = document.createElement('span');
    span.className = 'pending-digits';
    const missing = Math.max(0, state.digitLength - digits.length);
    span.textContent = digits + '_'.repeat(missing);
    el.appendChild(span);
  }

  // ---------- Assembling fragments into numbers ----------

  let assembler = null;

  function buildAssembler() {
    if (assembler) assembler.flush();
    assembler = createAssembler({
      length: state.digitLength,
      waitMs: WAIT_MS,
      onPending: showPending,
      onCommit,
    });
  }

  function onCommit(c) {
    state.log.push({
      kind: 'commit',
      time: new Date().toISOString(),
      digits: c.digits,
      certain: c.certain,
      reason: c.reason,
      parts: c.parts,
      sources: c.sources,
    });
    if (state.mode === 'test') collectForTest(c);
    else if (c.certain) addNumber(c.digits, c.sources.join(' | '));
    else askConfirm(c);
    persist();
    renderLog();
  }

  // ---------- Recognition ----------

  let rec = null;

  function createRecognizer() {
    const r = new SR();
    r.lang = 'he-IL';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.onaudiostart = () => setStatus('● מקשיב', 'listening');
    r.onspeechstart = () => setStatus('מזהה מספר...', 'listening');
    r.onresult = onResult;
    r.onerror = onError;
    r.onend = () => {
      // Chrome ends the session after silence / ~60s; restart transparently while listening.
      if (state.listening) {
        state.restarts++;
        setTimeout(() => state.listening && safeStart(), 150);
      }
    };
    return r;
  }

  function safeStart() {
    try { rec.start(); } catch { /* already started */ }
  }

  function startListening() {
    if (!rec) rec = createRecognizer();
    state.listening = true;
    $('micNotice').hidden = true;
    $('micBtn').textContent = '■ עצור הקראה';
    $('micBtn').classList.add('recording');
    setStatus('● מקשיב', 'listening');
    if (state.mode === 'test' && !state.test) nextTarget();
    safeStart();
  }

  function stopListening() {
    state.listening = false;
    $('micBtn').textContent = '● התחל הקראה';
    $('micBtn').classList.remove('recording');
    $('interim').textContent = '';
    if (rec) rec.stop();
    assembler.flush();
    if (!state.pending) setStatus('מוכן להקראה');
  }

  function onError(e) {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
      stopListening();
      $('micNotice').hidden = false;
      setStatus(e.error === 'audio-capture' ? 'לא נמצא מיקרופון' : 'אין הרשאת מיקרופון', 'warn');
      return;
    }
    setStatus('שגיאת זיהוי: ' + e.error, 'warn');
  }

  function onResult(e) {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) handleFinal(res);
      else interim += res[0].transcript;
    }
    $('interim').textContent = interim;
    if (interim) assembler.touch();
  }

  function handleFinal(res) {
    const alts = Array.from(res).map(a => ({
      transcript: a.transcript.trim(),
      confidence: Math.round(a.confidence * 100) / 100,
    }));
    const now = Date.now();
    const gapMs = state.lastFinalAt ? now - state.lastFinalAt : null;
    state.lastFinalAt = now;

    const parsed = parse(alts[0].transcript);
    const values = parsed.numbers.map(n => n.value);
    const conf = alts[0].confidence;
    const uncertain = parsed.unknown.length > 0 || (conf > 0 && conf < CONF_THRESHOLD);

    const entry = {
      time: new Date(now).toISOString(),
      mode: state.mode,
      transcript: alts[0].transcript,
      confidence: conf,
      values,
      unknown: parsed.unknown,
      gapMs,
      restartsSoFar: state.restarts,
      alternatives: alts.slice(1).map(a => ({ ...a, values: parse(a.transcript).numbers.map(n => n.value) })),
    };
    state.log.push(entry);
    if (state.test && !state.test.done) state.test.entries.push(entry);

    if (!values.length) setStatus('לא הצלחתי לזהות מספר', 'warn');
    else assembler.push(values, { uncertain, source: alts[0].transcript });

    persist();
    renderLog();
  }

  // ---------- Free mode ----------

  function addNumber(digits, text) {
    state.numbers.push({ digits, text });
    setStatus('נוסף: ' + digits, 'ok');
    persist();
    renderNumbers();
  }

  function confirmReason(c) {
    if (c.reason === 'length') return `זוהו ${c.digits.length} ספרות במקום ${state.digitLength}`;
    return 'חלק מהמילים לא היו ברורות';
  }

  function askConfirm(c) {
    state.pending = c;
    $('confirmValue').value = c.digits;
    $('confirmText').textContent = `${confirmReason(c)}. שמעתי: "${c.sources.join(' | ')}"`;
    $('confirm').hidden = false;
    setStatus('הזיהוי לא ודאי', 'warn');
  }

  function resolveConfirm(accept) {
    if (accept && state.pending) {
      const digits = $('confirmValue').value.replace(/\D/g, '');
      if (digits) addNumber(digits, state.pending.sources.join(' | '));
    }
    state.pending = null;
    $('confirm').hidden = true;
  }

  function renderNumbers() {
    $('count').textContent = state.numbers.length;
    const list = $('numberList');
    list.innerHTML = '';
    for (const n of state.numbers) {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.className = 'pending-digits';
      strong.textContent = n.digits ?? String(n.value);
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = n.text;
      li.append(strong, src);
      list.appendChild(li);
    }
  }

  // ---------- Test mode ----------

  function randomInCategory(key) {
    const c = CATEGORIES[key];
    let n = c.min + Math.floor(Math.random() * (c.max - c.min + 1));
    // Round parts ("…אלף" with nothing after, "אלף מאתיים") are common in practice; include some.
    const r = Math.random();
    if (r < 0.1 && n >= 1000) n = Math.round(n / 1000) * 1000;
    else if (r < 0.2 && n >= 100) n = Math.round(n / 100) * 100;
    return Math.min(Math.max(n, c.min), c.max);
  }

  // Words to read for a group of digits, keeping leading zeros: "098" → "אפס תשעים ושמונה".
  function groupWords(str) {
    const zeros = str.match(/^0*/)[0].length;
    const rest = str.slice(zeros);
    const words = Array(zeros).fill('אפס');
    if (rest) words.push(toWords(Number(rest)));
    return words.join(' ');
  }

  function readAloud(n, style) {
    const s = String(n);
    if (style === 'triplets' && s.length === 6) return [s.slice(0, 3), s.slice(3)].map(groupWords).join(', ');
    if (style === 'pairs' && s.length === 6) return s.match(/../g).map(groupWords).join(', ');
    if (style === 'digits') return s.split('').map(groupWords).join(', ');
    return toWords(n);
  }

  function nextTarget() {
    const cat = $('category').value;
    const len = Number($('length').value);
    const style = $('style').value;
    const keys = Object.keys(CATEGORIES).filter(k => k !== 'mixed');
    const target = [];
    const cats = [];
    for (let i = 0; i < len; i++) {
      const k = cat === 'mixed' ? keys[Math.floor(Math.random() * keys.length)] : cat;
      cats.push(k);
      target.push(randomInCategory(k));
    }
    state.test = { target, cats, style, collected: [], commits: [], entries: [], done: false };
    assembler.reset();
    $('targetDigits').textContent = target.join('   ·   ');
    $('targetWords').textContent = target.map(n => readAloud(n, style)).join('  ·  ');
    $('collected').textContent = '';
    $('verdict').textContent = '';
    $('verdict').className = 'verdict';
  }

  function collectForTest(c) {
    const t = state.test;
    if (!t || t.done) return;
    t.collected.push(c.digits);
    t.commits.push({ digits: c.digits, certain: c.certain, reason: c.reason });
    $('collected').textContent = 'זוהה: ' + t.collected.join(', ');
    if (t.collected.length >= t.target.length) evaluate();
    else setStatus('ממתין למספר הבא...', 'listening');
  }

  function evaluate() {
    const t = state.test;
    t.done = true;
    const want = t.target.map(String);
    const pass = t.collected.length === want.length && t.collected.every((d, i) => d === want[i]);
    const asked = t.commits.some(c => !c.certain);
    // For single numbers: would the recogniser's alternatives have produced it?
    const altPass = !pass && want.length === 1 &&
      t.entries.some(e => e.alternatives.some(a => a.values.length && combine(a.values) === want[0]));

    state.results.push({
      time: new Date().toISOString(),
      category: $('category').value,
      cats: t.cats,
      style: t.style,
      digitLength: state.digitLength,
      pace: $('pace').value,
      target: t.target,
      got: t.collected,
      pass,
      asked,
      altPass,
      resultCount: t.entries.length,   // how many final results the recogniser split this into
      transcripts: t.entries.map(e => e.transcript),
    });
    persist();
    renderStats();

    $('verdict').textContent = pass ? '✓ נכון' + (asked ? ' (אחרי שאלה)' : '') : '✗ זוהה ' + t.collected.join(', ');
    $('verdict').className = 'verdict ' + (pass ? 'ok' : 'bad');
    setStatus(pass ? 'נכון' : 'שגוי', pass ? 'ok' : 'warn');
    setTimeout(() => { if (state.test === t) nextTarget(); }, pass ? 900 : 2500);
  }

  function renderStats() {
    const rows = {};
    for (const r of state.results) {
      // Single-number tests are attributed to the number's own category, sequences to "רצף".
      let key = r.target.length > 1 ? 'רצף (' + (r.pace === 'fast' ? 'מהיר' : 'רגיל') + ')' : CATEGORIES[r.cats[0]].label;
      if (r.style && r.style !== 'full') key += ' · ' + STYLES[r.style];
      rows[key] ??= { total: 0, pass: 0, asked: 0, alt: 0 };
      rows[key].total++;
      if (r.pass) rows[key].pass++;
      if (r.asked) rows[key].asked++;
      if (r.altPass) rows[key].alt++;
    }
    const body = $('statsBody');
    body.innerHTML = '';
    const all = { total: 0, pass: 0, asked: 0, alt: 0 };
    const addRow = (label, s, bold) => {
      const tr = document.createElement('tr');
      const pct = s.total ? Math.round(100 * s.pass / s.total) + '%' : '—';
      for (const v of [label, s.total, s.pass, pct, s.asked, s.alt]) {
        const td = document.createElement('td');
        td.textContent = v;
        if (bold) td.style.fontWeight = '700';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    };
    for (const [label, s] of Object.entries(rows)) {
      addRow(label, s);
      for (const k in all) all[k] += s[k];
    }
    if (all.total) addRow('סה"כ', all, true);
  }

  // ---------- Log ----------

  function renderLog() {
    const body = $('logBody');
    body.innerHTML = '';
    for (const e of state.log.slice(-80).reverse()) {
      const tr = document.createElement('tr');
      let cells;
      if (e.kind === 'commit') {
        tr.className = 'commit';
        cells = [
          new Date(e.time).toLocaleTimeString('he-IL'),
          e.parts.length > 1 ? 'הורכב מ: ' + e.parts.join(' + ') : '',
          e.digits,
          e.certain ? 'ודאי' : 'לא ודאי',
          '',
          e.certain ? '' : (e.reason === 'length' ? 'אורך שגוי' : 'מילים לא ברורות'),
        ];
      } else {
        cells = [
          new Date(e.time).toLocaleTimeString('he-IL'),
          e.transcript,
          e.values.length ? e.values.join(' + ') : 'לא זוהה',
          e.confidence || '—',
          e.gapMs == null ? '—' : (e.gapMs / 1000).toFixed(1) + 'ש',
          e.alternatives.map(a => a.transcript).join(' | '),
        ];
      }
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i === 2) td.className = e.kind === 'commit' || e.values.length ? 'num' : 'none';
        if (i === 5) td.className = 'alts';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
  }

  function exportLog() {
    const data = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      digitLength: state.digitLength,
      restarts: state.restarts,
      results: state.results,
      log: state.log,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'speech-test-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Wiring ----------

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    $('freePanel').hidden = mode !== 'free';
    $('testPanel').hidden = mode !== 'test';
    $('confirm').hidden = true;
    state.pending = null;
    if (mode === 'test') nextTarget();
    else { state.test = null; assembler.reset(); }
  }

  function setDigitLength(len) {
    state.digitLength = len;
    $('digitLength').value = String(len);
    $('styleLabel').hidden = len !== 6;
    if (len === 6) { $('category').value = 'hundredThousands'; }
    else $('style').value = 'full';
    persist();
    buildAssembler();
    if (state.mode === 'test') nextTarget();
  }

  function init() {
    for (const [key, c] of Object.entries(CATEGORIES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = c.label;
      $('category').appendChild(opt);
    }

    if (!SR) {
      $('unsupported').hidden = false;
      $('micBtn').disabled = true;
    }

    $('micBtn').onclick = () => (state.listening ? stopListening() : startListening());
    $('micRetry').onclick = startListening;
    document.querySelectorAll('.tab').forEach(t => (t.onclick = () => setMode(t.dataset.mode)));
    $('confirmYes').onclick = () => resolveConfirm(true);
    $('confirmNo').onclick = () => resolveConfirm(false);
    $('confirmValue').onkeydown = e => { if (e.key === 'Enter') resolveConfirm(true); };
    $('undoBtn').onclick = () => { state.numbers.pop(); persist(); renderNumbers(); };
    $('clearNumbersBtn').onclick = () => {
      if (confirm('בטוחה שברצונך למחוק את כל המספרים?')) { state.numbers = []; persist(); renderNumbers(); }
    };
    $('clearLogBtn').onclick = () => {
      if (confirm('למחוק את היומן ואת תוצאות המבחן?')) {
        state.log = []; state.results = []; persist(); renderLog(); renderStats();
      }
    };
    $('exportBtn').onclick = exportLog;
    $('skipBtn').onclick = nextTarget;
    $('digitLength').onchange = e => setDigitLength(Number(e.target.value));
    ['category', 'length', 'style'].forEach(id => ($(id).onchange = nextTarget));

    setDigitLength(state.digitLength);
    renderNumbers();
    renderLog();
    renderStats();
  }

  init();
})();
