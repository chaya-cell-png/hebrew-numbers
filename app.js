(() => {
  'use strict';

  const { parse } = window.HebrewNumbers;
  const { createAssembler } = window.NumberAssembler;
  const { buildXlsx } = window.Xlsx;
  const $ = id => document.getElementById(id);

  // Top-alternative confidence below this → ask before adding. 0 means "unknown" in Chrome.
  const CONF_THRESHOLD = 0.5;
  // How long to wait after a fragment for the rest of a number split by a pause.
  const WAIT_MS = 1800;

  // ---------- Storage ----------

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  const state = {
    rows: load('hn-rows', []),                 // { id, digits, text, status: 'ok' | 'pending', reason }
    lists: load('hn-lists', []),               // saved lists: { id, name, savedAt, rows }
    current: load('hn-current', { listId: null, name: null, dirty: false }),
    settings: { digitLength: 6, showText: true, ...load('hn-settings', {}) },
    editingId: null,
  };
  function persist() {
    save('hn-rows', state.rows);
    save('hn-lists', state.lists);
    save('hn-current', state.current);
    save('hn-settings', state.settings);
  }
  function changed() {
    state.current.dirty = true;
    persist();
    render();
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
    span.className = 'ltr-digits';
    span.textContent = digits + '_'.repeat(Math.max(0, state.settings.digitLength - digits.length));
    el.appendChild(span);
  }

  // ---------- Recognition → numbers ----------

  let assembler = null;

  function buildAssembler() {
    if (assembler) assembler.flush();
    assembler = createAssembler({
      length: state.settings.digitLength,
      waitMs: WAIT_MS,
      onPending: showPending,
      onCommit,
    });
  }

  function onCommit(c) {
    const row = {
      id: uid(),
      digits: c.digits,
      text: c.sources.join(' | '),
      status: c.certain ? 'ok' : 'pending',
      reason: c.reason,
    };
    state.rows.push(row);
    changed();
    if (c.certain) setStatus('נוסף: ' + c.digits, 'ok');
    else setStatus('האם התכוונת ל־' + c.digits + '?', 'warn');
    scrollToRow(row.id);
  }

  function onFinal(alts) {
    const best = alts[0];
    const parsed = parse(best.transcript);
    const values = parsed.numbers.map(n => n.value);
    const uncertain = parsed.unknown.length > 0 || (best.confidence > 0 && best.confidence < CONF_THRESHOLD);
    if (!values.length) {
      setStatus('לא הצלחתי לזהות מספר', 'warn');
      return;
    }
    assembler.push(values, { uncertain, source: best.transcript });
  }

  const listener = window.Speech.createListener({
    onFinal,
    onInterim: text => {
      $('interim').textContent = text;
      if (text) assembler.touch();
    },
    onState: s => {
      if (s === 'listening') setStatus('● מקשיב', 'listening');
      else if (s === 'speech') setStatus('מזהה מספר...', 'listening');
      else if (s === 'idle') updateMicButton();
    },
    onError: code => {
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        $('micNotice').hidden = false;
        setStatus('אין הרשאת מיקרופון', 'warn');
      } else if (code === 'audio-capture') {
        $('micNotice').hidden = false;
        setStatus('לא נמצא מיקרופון', 'warn');
      } else if (code === 'network') {
        setStatus('אין חיבור לשירות הזיהוי. בדקי את החיבור לאינטרנט.', 'warn');
      } else {
        setStatus('שגיאת זיהוי: ' + code, 'warn');
      }
      updateMicButton();
    },
  });

  function updateMicButton() {
    const on = listener && listener.active;
    $('micBtn').textContent = on ? '■ עצור הקראה' : '● התחל הקראה';
    $('micBtn').classList.toggle('recording', !!on);
  }

  function startListening() {
    $('micNotice').hidden = true;
    listener.start();
    updateMicButton();
    setStatus('● מקשיב', 'listening');
  }

  function stopListening() {
    listener.stop();
    assembler.flush();
    updateMicButton();
    if (!state.rows.some(r => r.status === 'pending')) setStatus('מוכן להקראה');
  }

  // ---------- Table ----------

  function button(label, onClick, cls = 'btn small') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function reasonText(row) {
    if (row.reason === 'length') return `זוהו ${row.digits.length} ספרות במקום ${state.settings.digitLength}`;
    return 'הזיהוי לא היה ברור';
  }

  function render() {
    renderTable();

    $('count').textContent = state.rows.filter(r => r.status === 'ok').length;
    $('empty').hidden = state.rows.length > 0;
    $('listName').textContent = state.current.name
      ? 'רשימה: ' + state.current.name + (state.current.dirty ? ' (יש שינויים שלא נשמרו)' : '')
      : (state.rows.length ? 'רשימה חדשה (לא נשמרה)' : '');
  }

  const startEdit = id => { state.editingId = id; render(); };
  const confirmRow = row => { row.status = 'ok'; changed(); setStatus('נוסף: ' + row.digits, 'ok'); };

  function editInput(row) {
    const input = document.createElement('input');
    input.className = 'edit-input';
    input.inputMode = 'numeric';
    input.dir = 'ltr';
    input.value = row.digits;
    input.setAttribute('aria-label', 'עריכת המספר');
    input.onclick = e => e.stopPropagation();
    input.onkeydown = e => {
      if (e.key === 'Enter') saveEdit(row.id, input.value);
      if (e.key === 'Escape') { state.editingId = null; render(); }
    };
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return input;
  }

  function iconButton(symbol, label, onClick, cls = '') {
    const b = button(symbol, e => { e.stopPropagation(); onClick(); }, 'icon-btn ' + cls);
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }

  function renderTable() {
    const body = $('rows');
    body.innerHTML = '';
    $('table').classList.toggle('hide-text', !state.settings.showText);
    state.rows.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      if (row.status === 'pending') tr.className = 'pending';

      const idx = document.createElement('td');
      idx.className = 'idx';
      idx.textContent = i + 1;

      const num = document.createElement('td');
      num.className = 'num-cell';
      const actions = document.createElement('td');
      actions.className = 'actions-col';

      if (state.editingId === row.id) {
        const input = editInput(row);
        num.appendChild(input);
        actions.append(
          iconButton('✓', 'שמור', () => saveEdit(row.id, input.value), 'ok'),
          iconButton('↺', 'ביטול', () => { state.editingId = null; render(); }),
        );
      } else {
        const strong = document.createElement('span');
        strong.className = 'ltr-digits';
        strong.textContent = row.digits;
        num.appendChild(strong);
        if (row.status === 'pending') {
          actions.append(
            iconButton('✓', 'כן, זה המספר', () => confirmRow(row), 'ok'),
            iconButton('✎', 'עריכה', () => startEdit(row.id)),
            iconButton('✕', 'התעלם', () => removeRow(row.id), 'bad'),
          );
        } else {
          actions.append(
            iconButton('✎', 'עריכה', () => startEdit(row.id)),
            iconButton('🗑', 'מחיקה', () => removeRow(row.id), 'bad'),
          );
        }
      }

      const text = document.createElement('td');
      text.className = 'text-col';
      text.title = row.text || '';
      if (row.status === 'pending' && state.editingId !== row.id) {
        const q = document.createElement('span');
        q.className = 'pending-note';
        q.textContent = 'האם התכוונת לזה? ' + reasonText(row);
        text.append(q, ' ', row.text || '');
      } else {
        text.textContent = row.text;
      }

      tr.append(idx, num, text, actions);
      body.appendChild(tr);
    });
  }

  function scrollToRow(id) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.classList.add('flash');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function saveEdit(id, value) {
    const digits = String(value).replace(/\D/g, '');
    const row = state.rows.find(r => r.id === id);
    state.editingId = null;
    if (row && digits) {
      row.digits = digits;
      row.status = 'ok';
      setStatus('עודכן: ' + digits, 'ok');
    }
    changed();
  }

  function removeRow(id) {
    state.rows = state.rows.filter(r => r.id !== id);
    if (state.editingId === id) state.editingId = null;
    changed();
  }

  // ---------- Dialog ----------

  // ask({ title, text, input, body, buttons: [{ label, value, kind }] }) → Promise<{ value, input }>
  function ask({ title = '', text = '', input = null, body = null, buttons }) {
    const dlg = $('dialog');
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    $('dialogText').hidden = !text;
    $('dialogBody').innerHTML = '';
    if (body) $('dialogBody').appendChild(body);
    const inp = $('dialogInput');
    inp.hidden = input == null;
    inp.value = input ?? '';
    // Enter in the input means the primary action, not the first button (which is "ביטול").
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); holder.querySelector('.primary')?.click(); }
    };
    const holder = $('dialogButtons');
    holder.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.value = b.value;
      el.className = 'btn ' + (b.kind || '');
      el.textContent = b.label;
      holder.appendChild(el);
    }
    // Resolve straight from the click / key rather than the dialog's async 'close' event.
    return new Promise(resolve => {
      const finish = value => {
        dlg.onclick = dlg.onkeydown = null;
        const result = { value, input: inp.value.trim() };
        dlg.close();
        resolve(result);
      };
      dlg.onclick = e => {
        const btn = e.target.closest('button[value]');
        if (btn) { e.preventDefault(); finish(btn.value); }
      };
      dlg.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); }
      };
      dlg.showModal();
      if (input != null) { inp.focus(); inp.select(); }
    });
  }

  // ---------- Actions ----------

  function undoLast() {
    assembler.reset();
    const last = state.rows.pop();
    if (!last) return;
    state.editingId = null;
    changed();
    setStatus('בוטל: ' + last.digits);
  }

  async function clearAll() {
    if (!state.rows.length) return;
    const r = await ask({
      title: 'נקה הכל',
      text: 'בטוחה שברצונך למחוק את כל הנתונים?',
      buttons: [{ label: 'ביטול', value: 'cancel' }, { label: 'מחק הכל', value: 'clear', kind: 'danger' }],
    });
    if (r.value !== 'clear') return;
    assembler.reset();
    state.rows = [];
    state.editingId = null;
    changed();
    setStatus('הטבלה נוקתה');
  }

  function localDate() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // Plain numbers become numeric cells; a leading zero (e.g. 054798) stays text so it isn't lost.
  const toCell = digits => (/^(0|[1-9]\d{0,14})$/.test(digits) ? Number(digits) : digits);

  async function exportExcel() {
    assembler.flush();
    const ok = state.rows.filter(r => r.status === 'ok');
    const pending = state.rows.length - ok.length;
    if (!ok.length) { setStatus('אין מספרים לייצוא', 'warn'); return; }
    if (pending) {
      const r = await ask({
        title: 'יש מספרים שממתינים לאישור',
        text: pending === 1
          ? 'מספר אחד עדיין ממתין לאישור ולא ייכלל בקובץ.'
          : `${pending} מספרים עדיין ממתינים לאישור ולא ייכללו בקובץ.`,
        buttons: [{ label: 'חזרה לטבלה', value: 'cancel' }, { label: 'ייצא בכל זאת', value: 'export', kind: 'primary' }],
      });
      if (r.value !== 'export') return;
    }
    const bytes = buildXlsx({
      sheetName: 'מספרים',
      colWidths: [14],
      rows: [['מספר'], ...ok.map(r => [toCell(r.digits)])],
    });
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `numbers_${localDate()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(`יוצאו ${ok.length} מספרים`, 'ok');
  }

  // ---------- Saved lists ----------

  function defaultListName() {
    const d = new Date();
    return 'רשימה ' + d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  async function saveList() {
    if (!state.rows.length) { setStatus('אין מה לשמור', 'warn'); return false; }
    const r = await ask({
      title: 'שמור רשימה',
      text: 'שם הרשימה:',
      input: state.current.name || defaultListName(),
      buttons: [{ label: 'ביטול', value: 'cancel' }, { label: 'שמור', value: 'save', kind: 'primary' }],
    });
    if (r.value !== 'save') return false;
    const name = r.input || defaultListName();
    const snapshot = { name, savedAt: new Date().toISOString(), rows: state.rows.map(x => ({ ...x })) };
    const existing = state.lists.find(l => l.id === state.current.listId);
    if (existing) Object.assign(existing, snapshot);
    else {
      const id = uid();
      state.lists.unshift({ id, ...snapshot });
      state.current.listId = id;
    }
    state.current.name = name;
    state.current.dirty = false;
    persist();
    render();
    setStatus('הרשימה נשמרה', 'ok');
    return true;
  }

  // Before replacing the current rows: offer to save unsaved work. Resolves false to abort.
  async function confirmLeaveCurrent() {
    if (!state.rows.length || !state.current.dirty) return true;
    const r = await ask({
      title: 'הרשימה הנוכחית לא נשמרה',
      text: 'מה לעשות עם המספרים שבטבלה?',
      buttons: [
        { label: 'ביטול', value: 'cancel' },
        { label: 'המשך בלי לשמור', value: 'discard', kind: 'danger' },
        { label: 'שמור והמשך', value: 'save', kind: 'primary' },
      ],
    });
    if (r.value === 'save') return saveList();
    return r.value === 'discard';
  }

  async function newList() {
    if (!(await confirmLeaveCurrent())) return;
    assembler.reset();
    state.rows = [];
    state.editingId = null;
    state.current = { listId: null, name: null, dirty: false };
    persist();
    render();
    setStatus('רשימה חדשה. מוכן להקראה');
  }

  async function openLists() {
    const body = document.createElement('div');
    body.className = 'lists';
    if (!state.lists.length) {
      body.textContent = 'אין רשימות שמורות עדיין.';
    }
    for (const list of state.lists) {
      const item = document.createElement('div');
      item.className = 'list-item';
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = list.name;
      const meta = document.createElement('div');
      meta.className = 'hint';
      meta.textContent = `${list.rows.length} מספרים · ${new Date(list.savedAt).toLocaleString('he-IL')}`;
      info.append(name, meta);
      const open = document.createElement('button');
      open.value = 'open:' + list.id;
      open.className = 'btn small primary';
      open.textContent = 'פתח';
      const del = document.createElement('button');
      del.value = 'delete:' + list.id;
      del.className = 'btn small danger-text';
      del.textContent = 'מחק';
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.append(open, del);
      item.append(info, btns);
      body.appendChild(item);
    }
    const r = await ask({ title: 'רשימות שמורות', body, buttons: [{ label: 'סגור', value: 'cancel' }] });
    const [action, id] = r.value.split(':');
    const list = state.lists.find(l => l.id === id);
    if (!list) return;

    if (action === 'delete') {
      const c = await ask({
        title: 'מחיקת רשימה',
        text: `למחוק את "${list.name}"?`,
        buttons: [{ label: 'ביטול', value: 'cancel' }, { label: 'מחק', value: 'delete', kind: 'danger' }],
      });
      if (c.value === 'delete') {
        state.lists = state.lists.filter(l => l.id !== id);
        if (state.current.listId === id) state.current = { ...state.current, listId: null, dirty: true };
        persist();
        render();
      }
      return openLists();
    }

    if (action === 'open') {
      if (state.current.listId !== id && !(await confirmLeaveCurrent())) return;
      assembler.reset();
      state.rows = list.rows.map(x => ({ ...x }));
      state.editingId = null;
      state.current = { listId: list.id, name: list.name, dirty: false };
      persist();
      render();
      setStatus('נפתחה: ' + list.name);
    }
  }

  // ---------- Settings ----------

  function applySettings() {
    $('digitLength').value = String(state.settings.digitLength);
    $('showText').checked = state.settings.showText;
    buildAssembler();
    render();
  }

  // ---------- Init ----------

  function init() {
    if (!listener) {
      $('unsupported').hidden = false;
      $('micBtn').disabled = true;
    }
    $('micBtn').onclick = () => (listener.active ? stopListening() : startListening());
    $('micRetry').onclick = startListening;
    $('undoBtn').onclick = undoLast;
    $('clearBtn').onclick = clearAll;
    $('exportBtn').onclick = exportExcel;
    $('saveListBtn').onclick = saveList;
    $('newListBtn').onclick = newList;
    $('listsBtn').onclick = openLists;
    $('digitLength').onchange = e => { state.settings.digitLength = Number(e.target.value); persist(); applySettings(); };
    $('showText').onchange = e => { state.settings.showText = e.target.checked; persist(); render(); };

    // First visit: explain the microphone up front if permission was already denied.
    if (navigator.permissions && listener) {
      navigator.permissions.query({ name: 'microphone' }).then(p => {
        const show = () => { $('micNotice').hidden = p.state !== 'denied'; };
        show();
        p.onchange = show;
      }).catch(() => {});
    }

    applySettings();
  }

  init();
})();
