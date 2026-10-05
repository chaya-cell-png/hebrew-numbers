// Fixed-length number assembler.
// The recogniser often splits one long number across several final results (a pause after
// "אלף"), and people read 6-digit numbers in different ways:
//   full form      "מאתיים חמישים וארבעה אלף שבע מאות תשעים ושמונה"  → [254798]
//   pause at אלף   "מאתיים חמישים וארבעה אלף" | "שבע מאות תשעים ושמונה" → [254000] [798]
//   two triplets   "מאתיים חמישים וארבע" | "שבע מאות תשעים ושמונה"      → [254] [798]
//   pairs / digits "עשרים וחמש, ארבעים ושבע, תשעים ושמונה" / "שתיים חמש ארבע…"
// Fragments are buffered until they form exactly `length` digits. Anything that doesn't
// add up (too short after a pause, too long, unclear words) is emitted as uncertain.
(function (root) {
  'use strict';

  const isThousands = v => v >= 1000 && v % 1000 === 0;

  // "254 אלף" + "798" adds up; every other sequence concatenates digits ("254" + "798", "2" + "5"…).
  function combine(frags) {
    let acc = '';
    let prev = null;
    for (const f of frags) {
      if (prev !== null && isThousands(prev) && f < 1000) acc = String(Number(acc) + f);
      else acc += String(f);
      prev = f;
    }
    return acc;
  }

  function defaultSchedule(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  }

  /**
   * createAssembler({ length, onCommit, onPending, waitMs, schedule })
   *   length   – expected digit count, or 0/null for "any length" (pass-through)
   *   onCommit – ({ digits, value, certain, reason, parts, sources }) => void
   *   onPending – (partialDigits) => void, '' when nothing is buffered
   */
  function createAssembler({ length, onCommit, onPending = () => {}, waitMs = 1800, schedule = defaultSchedule }) {
    let frags = [];
    let sources = [];
    let uncertain = false;
    let cancel = null;

    function clearTimer() {
      if (cancel) cancel();
      cancel = null;
    }

    function flush() {
      clearTimer();
      if (!frags.length) return;
      const digits = combine(frags);
      let reason = 'complete';
      if (digits.length !== length) reason = 'length';
      else if (uncertain) reason = 'unclear';
      onCommit({ digits, value: Number(digits), certain: reason === 'complete', reason, parts: frags, sources });
      frags = [];
      sources = [];
      uncertain = false;
      onPending('');
    }

    function push(values, { uncertain: unclear = false, source = '' } = {}) {
      if (!length) {
        for (const v of values) {
          onCommit({ digits: String(v), value: v, certain: !unclear, reason: unclear ? 'unclear' : 'complete', parts: [v], sources: [source] });
        }
        return;
      }
      clearTimer();
      for (const v of values) {
        if (frags.length && combine([...frags, v]).length > length) flush();
        frags.push(v);
        if (!sources.includes(source)) sources.push(source);
        uncertain = uncertain || unclear;
        // A number ending in "…אלף" may still get its last three digits; wait for the pause.
        if (combine(frags).length === length && !isThousands(v) && !uncertain) flush();
      }
      if (frags.length) {
        onPending(combine(frags));
        cancel = schedule(flush, waitMs);
      }
    }

    // Speech is still in progress (interim results): postpone the timeout.
    function touch() {
      if (cancel) {
        cancel();
        cancel = schedule(flush, waitMs);
      }
    }

    function reset() {
      clearTimer();
      frags = [];
      sources = [];
      uncertain = false;
      onPending('');
    }

    return { push, flush, touch, reset };
  }

  const api = { createAssembler, combine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NumberAssembler = api;
})(typeof window !== 'undefined' ? window : globalThis);
