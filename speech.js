// Continuous Hebrew speech listener on top of the browser's Web Speech API (Chrome / Edge).
// Chrome ends a recognition session after silence or ~60s; while active we restart it
// transparently so dictation never needs a click between numbers.
(function (root) {
  'use strict';

  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;

  /**
   * createListener({ onFinal, onInterim, onState, onError }) → { start, stop, active } | null
   *   onFinal(alternatives)  – [{ transcript, confidence }], best first
   *   onInterim(text)        – live partial transcript ('' when cleared)
   *   onState(state)         – 'listening' | 'speech' | 'idle'
   *   onError(code)          – 'not-allowed' | 'audio-capture' | 'network' | …
   */
  function createListener({ lang = 'he-IL', onFinal, onInterim = () => {}, onState = () => {}, onError = () => {} }) {
    if (!SR) return null;

    let rec = null;
    let active = false;

    function build() {
      const r = new SR();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 3;
      r.onaudiostart = () => onState('listening');
      r.onspeechstart = () => onState('speech');
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            onFinal(Array.from(res).map(a => ({
              transcript: a.transcript.trim(),
              confidence: Math.round(a.confidence * 100) / 100,
            })));
          } else {
            interim += res[0].transcript;
          }
        }
        onInterim(interim);
      };
      r.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          active = false;
          onState('idle');
        }
        onError(e.error);
      };
      r.onend = () => {
        if (active) setTimeout(() => active && safeStart(), 150);
        else onState('idle');
      };
      return r;
    }

    function safeStart() {
      try { rec.start(); } catch { /* already running */ }
    }

    return {
      start() {
        if (!rec) rec = build();
        active = true;
        safeStart();
      },
      stop() {
        active = false;
        onInterim('');
        if (rec) rec.stop();
      },
      get active() { return active; },
    };
  }

  root.Speech = { createListener, supported: !!SR };
})(window);
