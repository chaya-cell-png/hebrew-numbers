// Small stopwatch (minutes:seconds) pinned to the side of the page.
// State lives in localStorage, so it survives reloads and closing the tab.
// While running we store the start timestamp, so time keeps counting even
// when the page is closed.
(function () {
  const KEY = 'hebrewNumbers.timer';
  const display = document.getElementById('timerDisplay');
  const toggleBtn = document.getElementById('timerToggle');
  const resetBtn = document.getElementById('timerReset');
  const box = document.getElementById('timer');
  if (!display || !toggleBtn || !resetBtn) return;

  // { elapsed: ms accumulated before the current run, startedAt: ms epoch or null }
  let state = load();
  let tick = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s.elapsed === 'number') {
        return { elapsed: s.elapsed, startedAt: typeof s.startedAt === 'number' ? s.startedAt : null };
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return { elapsed: 0, startedAt: null };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function totalMs() {
    return state.elapsed + (state.startedAt ? Math.max(0, Date.now() - state.startedAt) : 0);
  }

  function format(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function render() {
    display.textContent = format(totalMs());
    const running = state.startedAt !== null;
    box.classList.toggle('running', running);
    toggleBtn.textContent = running ? 'עצור' : (state.elapsed > 0 ? 'המשך' : 'התחל');
    toggleBtn.classList.toggle('primary', !running);
    resetBtn.disabled = !running && state.elapsed === 0;
  }

  function startTicking() {
    stopTicking();
    tick = setInterval(render, 250);
  }
  function stopTicking() {
    if (tick) { clearInterval(tick); tick = null; }
  }

  toggleBtn.addEventListener('click', () => {
    if (state.startedAt !== null) {
      state = { elapsed: totalMs(), startedAt: null };
      stopTicking();
    } else {
      state = { elapsed: state.elapsed, startedAt: Date.now() };
      startTicking();
    }
    save();
    render();
  });

  resetBtn.addEventListener('click', () => {
    const running = state.startedAt !== null;
    state = { elapsed: 0, startedAt: running ? Date.now() : null };
    save();
    render();
  });

  // Keep several open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = load();
    if (state.startedAt !== null) startTicking(); else stopTicking();
    render();
  });

  if (state.startedAt !== null) startTicking();
  render();
})();
