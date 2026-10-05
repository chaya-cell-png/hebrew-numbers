// Hebrew spoken-number parser.
// Turns a speech-recognition transcript ("ארבע מאות עשרים ושלוש", "423", or a mix)
// into a list of integers, splitting consecutive numbers where the grammar forces a break.
(function (root) {
  'use strict';

  // ---------- Vocabulary ----------

  const VOCAB = {};
  function add(cls, value, ...words) {
    for (const w of words) VOCAB[w] = { cls, value };
  }

  add('zero', 0, 'אפס');
  add('unit', 1, 'אחת', 'אחד');
  add('unit', 2, 'שתיים', 'שתים', 'שניים', 'שנים', 'שתי', 'שני');
  add('unit', 3, 'שלוש', 'שלש', 'שלושה', 'שלשה', 'שלושת', 'שלשת');
  add('unit', 4, 'ארבע', 'ארבעה', 'ארבעת');
  add('unit', 5, 'חמש', 'חמישה', 'חמשה', 'חמשת');
  add('unit', 6, 'שש', 'שישה', 'ששה', 'ששת');
  add('unit', 7, 'שבע', 'שבעה', 'שבעת');
  add('unit', 8, 'שמונה', 'שמונת');
  add('unit', 9, 'תשע', 'תשעה', 'תשעת');
  add('ten', 10, 'עשר', 'עשרה');
  add('tenConstruct', 10, 'עשרת');
  add('tens', 20, 'עשרים');
  add('tens', 30, 'שלושים', 'שלשים');
  add('tens', 40, 'ארבעים');
  add('tens', 50, 'חמישים', 'חמשים');
  add('tens', 60, 'שישים', 'ששים');
  add('tens', 70, 'שבעים');
  add('tens', 80, 'שמונים');
  add('tens', 90, 'תשעים');
  add('hundred', 100, 'מאה');
  add('hundred', 200, 'מאתיים', 'מאתים');
  add('hundredsMul', 100, 'מאות');
  add('scale', 1000, 'אלף');
  add('thousandsMul', 1000, 'אלפים');
  add('thousands', 2000, 'אלפיים');
  add('scale', 1000000, 'מיליון', 'מליון', 'מיליונים', 'מליונים');

  // ---------- Normalisation & tokenising ----------

  function normalize(text) {
    let s = String(text || '');
    s = s.replace(/[֑-ׇ]/g, '');            // niqqud / cantillation
    while (/\d,\d{3}/.test(s)) s = s.replace(/(\d),(\d{3})/, '$1$2'); // 1,250 → 1250
    s = s.replace(/(^|\s)ו\s*[-־]\s*/g, '$1ו');        // "ו-7" / "ו־שבע" → "ו7" / "ושבע"
    s = s.replace(/[-־–—]/g, ' ');
    s = s.replace(/[.,!?;:"'״׳()[\]]/g, ' ');
    return s.trim();
  }

  function lookupWord(word) {
    if (VOCAB[word]) return { ...VOCAB[word], vav: false };
    if (word.length > 1 && word[0] === 'ו' && VOCAB[word.slice(1)]) {
      return { ...VOCAB[word.slice(1)], vav: true };
    }
    return null;
  }

  function tokenize(text) {
    const raw = normalize(text).split(/\s+/).filter(Boolean);
    const tokens = [];
    let pendingVav = false;
    for (const w of raw) {
      if (w === 'ו') { pendingVav = true; continue; }
      let tok;
      const digits = /^(ו?)(\d+)$/.exec(w);
      if (digits) {
        tok = { cls: 'digits', value: Number(digits[2]), vav: digits[1] === 'ו' };
      } else {
        tok = lookupWord(w) || { cls: 'unknown', value: null, vav: false };
      }
      if (pendingVav) { tok.vav = true; pendingVav = false; }
      tok.text = w;
      tokens.push(tok);
    }
    return tokens;
  }

  // ---------- Components (merge multi-word units like "שלוש מאות", "חמש עשרה") ----------

  function classifyDigits(v) {
    if (v < 10) return 'unit';
    if (v === 10) return 'ten';
    if (v < 20) return 'teen';
    if (v < 100 && v % 10 === 0) return 'tens';
    if (v < 1000 && v % 100 === 0) return 'hundred';
    return null;
  }

  function toComponents(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];
      const comp = (type, value, n) => {
        out.push({ type, value, vav: t.vav, text: tokens.slice(i, i + n).map(x => x.text).join(' ') });
        i += n - 1;
      };

      let cls = t.cls;
      if (cls === 'digits') {
        const scaleNext = next && ['hundredsMul', 'thousandsMul', 'scale'].includes(next.cls);
        if (t.value < 10 && scaleNext) cls = 'unit';
        else if (t.value < 1000 && scaleNext) { comp('group', t.value, 1); continue; }   // "254 אלף"
        else if (t.vav && classifyDigits(t.value)) { comp(classifyDigits(t.value), t.value, 1); continue; }
        else { comp('number', t.value, 1); continue; }
      }

      switch (cls) {
        case 'unit':
          if (next && next.cls === 'ten') comp('teen', t.value + 10, 2);
          else if (next && next.cls === 'hundredsMul') comp('hundred', t.value * 100, 2);
          else if (next && next.cls === 'thousandsMul') comp('thousands', t.value * 1000, 2);
          else comp('unit', t.value, 1);
          break;
        case 'ten':
        case 'tenConstruct':
          if (next && next.cls === 'thousandsMul') comp('thousands', 10000, 2);
          else comp('ten', 10, 1);
          break;
        case 'tens': comp('tens', t.value, 1); break;
        case 'hundred': comp('hundred', t.value, 1); break;
        case 'thousands': comp('thousands', t.value, 1); break;
        case 'scale': comp('scale', t.value, 1); break;
        case 'zero': comp('number', 0, 1); break;
        default: comp('unknown', null, 1);   // stray "מאות"/"אלפים" or a non-number word
      }
    }
    return out;
  }

  // ---------- Grammar: build numbers, split where a component can't extend the current one ----------

  function newState() {
    return { total: 0, group: 0, h: false, t: false, u: false, lastScale: Infinity, parts: [] };
  }
  const groupEmpty = s => !s.h && !s.t && !s.u;

  function canAccept(s, c) {
    switch (c.type) {
      case 'unit': return !s.u;
      case 'ten':
      case 'teen':
      case 'tens': return !s.t && !s.u;
      case 'hundred':
      case 'group': return groupEmpty(s);
      case 'thousands': return groupEmpty(s) && s.lastScale > 1000;
      case 'scale': return c.value < s.lastScale;
      default: return false;
    }
  }

  function apply(s, c) {
    switch (c.type) {
      case 'unit': s.group += c.value; s.u = true; break;
      case 'ten':
      case 'teen': s.group += c.value; s.t = s.u = true; break;
      case 'tens': s.group += c.value; s.t = true; break;
      case 'hundred': s.group += c.value; s.h = true; break;
      case 'group': s.group += c.value; s.h = s.t = s.u = true; break;
      case 'thousands':
        s.total += c.value; s.lastScale = 1000;
        s.group = 0; s.h = s.t = s.u = false; break;
      case 'scale':
        s.total += (groupEmpty(s) ? 1 : s.group) * c.value; s.lastScale = c.value;
        s.group = 0; s.h = s.t = s.u = false; break;
    }
    s.parts.push(c.text);
  }

  /**
   * parse(text) → { numbers: [{value, text}], unknown: [word], tokens }
   * Multiple numbers in one transcript are split only where Hebrew number grammar
   * makes continuation impossible (e.g. "עשרים ושלוש ארבע מאות" → 23, 400).
   */
  function parse(text) {
    const tokens = tokenize(text);
    const comps = toComponents(tokens);
    const numbers = [];
    const unknown = [];
    let s = null;

    const close = () => {
      if (s && s.parts.length) numbers.push({ value: s.total + s.group, text: s.parts.join(' ') });
      s = null;
    };

    for (const c of comps) {
      // Fillers ("אה") and misheard words don't end a number; the caller treats them as uncertainty.
      if (c.type === 'unknown') { unknown.push(c.text); continue; }
      if (c.type === 'number') {
        // Digits right after a scale word fill its remainder: "אלף 798", "254 אלף 798".
        if (s && c.value < 1000 && groupEmpty(s) && s.lastScale !== Infinity) { apply(s, { ...c, type: 'group' }); continue; }
        close(); numbers.push({ value: c.value, text: c.text }); continue;
      }
      if (!s) s = newState();
      if (!canAccept(s, c)) { close(); s = newState(); }
      apply(s, c);
    }
    close();
    return { numbers, unknown, tokens: tokens.map(t => t.text) };
  }

  // ---------- Number → Hebrew words (used to show test targets and for round-trip tests) ----------

  const F_UNITS = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
  const M_UNITS = ['', 'אחד', 'שני', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'];
  const F_TEENS =['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה',
    'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
  const TENS_W = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
  const HUNDREDS_W = ['', 'מאה', 'מאתיים', 'שלוש מאות', 'ארבע מאות', 'חמש מאות',
    'שש מאות', 'שבע מאות', 'שמונה מאות', 'תשע מאות'];
  const THOUSANDS_W = ['', 'אלף', 'אלפיים', 'שלושת אלפים', 'ארבעת אלפים', 'חמשת אלפים',
    'ששת אלפים', 'שבעת אלפים', 'שמונת אלפים', 'תשעת אלפים', 'עשרת אלפים'];

  function groupParts(n) {
    const parts = [];
    const h = Math.floor(n / 100), r = n % 100;
    if (h) parts.push(HUNDREDS_W[h]);
    if (r >= 10 && r < 20) parts.push(F_TEENS[r - 10]);
    else {
      if (r >= 20) parts.push(TENS_W[Math.floor(r / 10)]);
      if (r % 10) parts.push(F_UNITS[r % 10]);
    }
    return parts;
  }

  function joinWithVav(parts) {
    if (parts.length > 1) parts[parts.length - 1] = 'ו' + parts[parts.length - 1];
    return parts.join(' ');
  }

  function toWords(n) {
    if (n === 0) return 'אפס';
    const parts = [];
    const m = Math.floor(n / 1e6), k = Math.floor(n / 1000) % 1000, r = n % 1000;
    if (m === 1) parts.push('מיליון');
    else if (m < 10 && m) parts.push(M_UNITS[m] + ' מיליון');
    else if (m) parts.push(joinWithVav(groupParts(m)) + ' מיליון');
    if (k && k <= 10) parts.push(THOUSANDS_W[k]);
    else if (k) parts.push(joinWithVav(groupParts(k)) + ' אלף');
    parts.push(...groupParts(r));
    return joinWithVav(parts);
  }

  const api = { parse, toWords, normalize, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HebrewNumbers = api;
})(typeof window !== 'undefined' ? window : globalThis);
