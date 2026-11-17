// Part 85-misc-ui.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
// Test hook: open an item's detail (used by QA to assert per-language render).
function openItem(id) { selId = id; renderDB(); renderDetail(); }
function pruneState() {
  // drop ids that no longer resolve (generated items are restored from storage first)
  for (const k of Object.keys(state.equipment))
    if (state.equipment[k] && !itemById(state.equipment[k])) state.equipment[k] = null;
  state.bag = state.bag.filter(id => itemById(id));
}
/* ==================== 9. Init (event binding) ==================== */
function initCharacterControls() {
  $('#langSel').addEventListener('change', e => setLang(e.target.value));
  $('#originSel').addEventListener('change', e => {
    state.origin = e.target.value;
    // a custom hero gets a fresh face every time: the portrait sex is a 50/50 roll
    if (state.origin === 'custom') state.heroSex = rollHeroSex();
    afterChange();
  });
  $('#raceSel').addEventListener('change', e => {
    state.race = e.target.value;
    // Picking another race is picking another custom hero, so the portrait sex is rolled
    // again. Without this the first roll sticks (it is persisted) and every non-story
    // character keeps showing the one sex that happened to come out once.
    if (state.origin === 'custom') state.heroSex = rollHeroSex();
    afterChange();
  });
  $('#levelRange').addEventListener('input', e => { state.level = +e.target.value; afterChange(); });
  $('#resetBtn').addEventListener('click', () => {
    if (confirm(t('error.reset_confirm'))) {
      state = defaultState(); selId = null;
      // the working build no longer equals any slot (spec §4.3 lifecycle table)
      slotsState.activeSlot = null; persistSlots();
      if (slotsUI.open) renderSlots();
      afterChange();
    }
  });
}
// Build the JSON export payload for the current build.
function buildExportData(f) {
  return {
    version: 1,
    exported: new Date().toISOString(),
    origin: state.origin, race: state.race, level: state.level,
    heroSex: state.heroSex, // additive (version stays 1): older exports import unchanged
    attr: { ...state.attr }, combat: { ...state.combat }, civil: { ...state.civil },
    talents: { ...state.talents }, questTalents: [...state.questTalents],
    skills: [...state.skills],
    spiderKissVision: state.spiderKissVision, equipment: { ...state.equipment },
    final: {
      hp: f.hp, ap: f.ap, init: f.init, move: f.move, mem: f.mem, carry: f.carry,
      accuracy: f.accuracy, critMult: f.critMult,
      res: { ...f.res }, dmg: { ...f.dmg }
    }
  };
}
// Apply an imported build payload to the current state. Throws on a bad version.
function applyImportData(d) {
  if (d.version !== 1) throw new Error(t('error.bad_version'));
  state.origin = d.origin || state.origin;
  state.race = d.race || state.race;
  if (d.heroSex === 'm' || d.heroSex === 'f') state.heroSex = d.heroSex;
  state.level = d.level || state.level;
  if (d.attr) Object.assign(state.attr, d.attr);
  if (d.combat) Object.assign(state.combat, d.combat);
  if (d.civil) Object.assign(state.civil, d.civil);
  if (d.talents) Object.assign(state.talents, d.talents);
  if (Array.isArray(d.questTalents)) state.questTalents = d.questTalents;
  if (Array.isArray(d.skills)) state.skills = d.skills.slice();
  if (typeof d.spiderKissVision === 'string') state.spiderKissVision = d.spiderKissVision;
  if (d.equipment) Object.assign(state.equipment, d.equipment);
}
/* ---- slots UI: toast + panel (spec §4) --------------------------------------
   toast(): one bottom status toast, undo action inline; the timer pauses on hover
   AND on focus (WCAG 2.2.1). A newer toast replaces the previous pending undo.
   Panel: dropdown under the header (bottom sheet on mobile CSS layer); rows are
   re-rendered from slotsState; destructive ops follow spec §4.3 exactly. */
let _toastTimer = null, _toastLeft = 0, _toastStart = 0, _toastUndo = null, _toastPaused = false;
// (r7, objective 2026-11-13) Тост «Снято отметок: N — …» не исчезал: он всплывает ровно под
// курсором галки, мышь остаётся на нём, pause() снимает таймер, resume() не приходит — тост живёт
// вечно. Лечится предельным моментом: toast() задаёт горизонт, после которого тост ОБЯЗАН
// исчезнуть; наведение больше не удерживает тост, если передан hold:false (у отмены каскада он
// выключен), а пауза не имеет права выходить за горизонт.
let _toastDeadline = 0, _toastHold = true;
function _toastArm(ms) { _toastStart = Date.now(); _toastLeft = ms; clearTimeout(_toastTimer); _toastTimer = setTimeout(hideToast, ms); }
function hideToast() { clearTimeout(_toastTimer); const el = $('#toast'); if (el) el.hidden = true; _toastUndo = null; _toastPaused = false; }
function toast(msg, opts) {
  const el = $('#toast'); if (!el) return;
  const ms = (opts && opts.ms) || 5000;
  // (r7) горизонт: после него тост обязан исчезнуть; hold:false — наведение паузу не включает
  _toastHold = !(opts && opts.hold === false);
  _toastDeadline = Date.now() + ms;
  // mobile: the screen bottom is the slots sheet — anchor the toast under the header instead
  const narrow = window.matchMedia && window.matchMedia('(max-width: 740px)').matches;
  const h = document.querySelector && document.querySelector('.top');
  if (narrow && h && h.getBoundingClientRect) el.style.top = (h.getBoundingClientRect().bottom + 6) + 'px';
  else el.style.top = '';
  _toastUndo = (opts && opts.action && opts.action.fn) || null;
  el.innerHTML = esc(msg) + (_toastUndo ? ` <button class="toast-undo" data-undo="1">${esc(opts.action.label)}</button>` : '');
  el.hidden = false;
  _toastArm(ms);
}
function initToast() {
  const el = $('#toast'); if (!el || !el.addEventListener) return;
  el.addEventListener('click', e => {
    const b = e.target && e.target.getAttribute && e.target.getAttribute('data-undo');
    if (b) { const fn = _toastUndo; hideToast(); if (fn) fn(); }
  });
  // pause — по наведению и по клавиатурному фокусу (WCAG 2.2.1). r7: наведение не держит тост,
  // если передан hold:false (отмена каскада), и никогда не имеет права выходить за горизонт.
  const pause = (viaHover) => {
    if (viaHover === true && !_toastHold) return;
    if (_toastPaused || !_toastTimer) return;
    // горизонт истёк — закрываем сразу
    if (Date.now() >= _toastDeadline) { hideToast(); return; }
    _toastPaused = true; clearTimeout(_toastTimer);
    _toastLeft = Math.min(_toastLeft, _toastDeadline - Date.now());
  };
  const resume = () => {
    if (!_toastPaused) return;
    _toastPaused = false;
    // r7: за горизонт не выходим — тост обязан исчезнуть сам
    const left = _toastDeadline - Date.now();
    if (left <= 0) { hideToast(); return; }
    _toastArm(Math.min(Math.max(_toastLeft, 1500), left));
  };
  el.addEventListener('mouseenter', () => pause(true)); el.addEventListener('focusin', () => pause(false));
  el.addEventListener('mouseleave', resume); el.addEventListener('focusout', resume);
}
const slotsUI = { open: false, confirm: null, rename: null, importTarget: null, storageWarned: false };
// Pure gate (spec 2026-11-08-delete-slot-confirm §3.2): a slot is destroyed only by the
// confirm branch, only for an armed confirmation of kind 'delete' pointing at this very
// index, and only while that slot is still occupied (cross-tab race → the row repaints).
function slotDeleteAllowed(confirm, i, slot) {
  return !!confirm && confirm.kind === 'delete' && confirm.i === i && !!slot;
}
let _confirmFocus = false; // one-shot: the safe button is focused when an armed row renders
// A confirmed delete repaints the row as empty, and the empty row's «Сохранить» lands
// exactly under the pointer that confirmed it: the second click of a double-click would write
// the current build into the slot that was just destroyed AND replace the undo toast with a
// toast that has no undo. Spec 2026-11-08-delete-slot-confirm §2 anti-goal: a second click at
// the same spot must never delete or write, so writes into a slot cleared < 700 ms ago are
// ignored. The row also stops taking pointer events for a blink (see doDelete + style.css).
const CLEAR_WINDOW = 700; // ms a just-emptied row stays deaf: one number for both layers
let _lastDelete = null; // { i, at }
let _clearTimer = null;
const justCleared = (i) => !!_lastDelete && _lastDelete.i === i && Date.now() - _lastDelete.at < CLEAR_WINDOW;
// A slot that is filled again (undo, «Сохранить», импорт) is no longer a fresh corpse:
// otherwise the window would swallow the user’s next legitimate action.
const forgetClear = (i) => { if (_lastDelete && _lastDelete.i === i) _lastDelete = null; };
// Programmatic focus must never scroll: a scrolled window closes the panel (the scroll
// listener in initSlots) and patterns.md §10 requires preventScroll on focus().
const focusQuiet = (el) => {
  if (!el || !el.focus) return;
  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
};
// Single road to an armed confirmation: the row handler and the file reader both use it,
// so «arming never writes» is guaranteed in one place (spec §3.1).
function armConfirm(i, kind, extra) {
  slotsUI.confirm = Object.assign({ i, kind }, extra || null);
  _confirmFocus = true; renderSlots();
}
// Esc / «Отмена»: dismiss the confirmation, then hand focus back to the row's ✕ (APG:
// the invoking element is gone → focus goes to the logical continuation of the workflow).
function cancelConfirm() {
  const i = slotsUI.confirm && slotsUI.confirm.i;
  slotsUI.confirm = null;
  renderSlots();
  if (i == null) return;
  const d = document.querySelector && document.querySelector(`.slot-row[data-i="${i}"] [data-slot-act="del"]`);
  focusQuiet(d);
}
// After a confirmed deletion the row's button no longer exists: focus the toast's «Отменить»
// — the keyboard path to undo, whose focusin also pauses the 9 s timer (WCAG 2.1.1 / 2.2.1).
function focusToastUndo() {
  const b = document.querySelector && document.querySelector('#toast [data-undo]');
  if (b) { focusQuiet(b); return; }
  // §3.4: no undo in the toast → the first available control of a remaining occupied row,
  // then the panel container. Focus never falls through to <body>.
  const btn = document.querySelector && document.querySelector('.slot-row:not(.empty) [data-slot-act]');
  if (btn) { focusQuiet(btn); return; }
  const panel = document.querySelector && document.querySelector('#slotsPanel');
  if (panel) {
    if (panel.setAttribute && (!panel.hasAttribute || !panel.hasAttribute('tabindex'))) panel.setAttribute('tabindex', '-1');
    focusQuiet(panel);
  }
}

function persistSlots() {
  if (!slotsStore.save(slotsState) && !slotsUI.storageWarned) { slotsUI.storageWarned = true; toast(t('slots.storage_error')); }
}
// The row label for a slot: its own name, or the localized default «Slot {n}» — never
// baked into the data, so it re-localizes on language switch (spec §3.2; closes O8's class).
const slotDisplayName = (s, i) => (s && s.name) ? s.name : t('slots.slot_n', { n: i + 1 });
function slotDateShort(iso) {
  try {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const loc = state.lang === 'ru' ? 'ru-RU' : 'en-GB';
    return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}
// Строка-подпись занятого слота: уровень · раса · дата. В строке подтверждения дату не
// повторяем — она уже в вопросе, а высота строки обязана остаться прежней (см. §3.3 п.5).
function slotMetaLine(s, withDate) {
  const b = s.build || {}, r = CH.races.find(x => x.id === b.race);
  const date = slotDateShort(s.savedAt);
  return `lvl ${esc(b.level)} · ${esc(r ? L(r) : (b.race || ''))}${(withDate === false || !date) ? '' : ' · ' + esc(date)}`;
}
function renderSlots() {
  const list = $('#slotsList'); if (!list) return;
  // A confirmation is about an OCCUPIED slot. Another tab may have emptied it while the
  // question was armed - then the question is stale and must not resurrect on a later repaint
  // of that row (otherwise the next «Сохранить» shows a delete question nobody armed).
  if (slotsUI.confirm && !slotsState.slots[slotsUI.confirm.i]) {
    // an armed import carries the parsed file: dropping it silently would swallow the
    // user’s action, so the dismissal is announced (patterns.md §12)
    if (slotsUI.confirm.kind === 'import') toast(t('slots.import_stale', { n: slotsUI.confirm.i + 1 }));
    slotsUI.confirm = null; _confirmFocus = false;
  }
  const freshArm = _confirmFocus; // announce the question only when it was just armed
  let html = '';
  for (let i = 0; i < SLOTS_N; i++) {
    const s = slotsState.slots[i], active = slotsState.activeSlot === i;
    if (s && slotsUI.confirm && slotsUI.confirm.i === i) {
      // one armed row per panel; the delete flavour differs in copy, colour and spacing
      // (spec 2026-11-08-delete-slot-confirm §3.3): «Отмена» stays rightmost, exactly where
      // the ✕ was, so a second click at the same spot can only cancel. The row keeps the
      // two-line shape of an occupied row so arming never moves its neighbours.
      const del = slotsUI.confirm.kind === 'delete';
      const q = del
        ? t('slots.delete_q', { name: slotDisplayName(s, i), n: i + 1, date: slotDateShort(s.savedAt) || '—' })
        : t('slots.overwrite_q', { name: slotDisplayName(s, i), date: slotDateShort(s.savedAt) || '—' });
      html += `<div class="slot-row confirm${del ? ' confirm--del' : ''}${active ? ' active' : ''}" data-i="${i}"${active ? ' aria-current="true"' : ''}><span class="slot-n">${i + 1}</span>` +
        `<span class="slot-main"><span class="slot-q" id="slot-q-${i}"${del && freshArm ? ' role="alert"' : ''}>${esc(q)}</span>` +
        `<span class="slot-meta muted small">${slotMetaLine(s, !del)}</span></span>` +
        `<span class="slot-acts"><button class="btn${del ? ' danger' : ' gold'} small-btn" data-slot-act="confirm" aria-describedby="slot-q-${i}">${esc(t(del ? 'slots.delete_do' : 'slots.overwrite_do'))}</button>` +
        `<button class="btn ghost small-btn" data-slot-act="cancel" aria-describedby="slot-q-${i}">${esc(t('slots.cancel'))}</button></span></div>`;
      continue;
    }
    if (!s) {
      html += `<div class="slot-row empty${justCleared(i) ? ' cleared' : ''}" data-i="${i}"><span class="slot-n">${i + 1}</span>` +
        `<span class="slot-meta muted small">${esc(t('slots.empty'))}</span>` +
        `<span class="slot-acts"><button class="btn ghost small-btn" data-slot-act="save">${esc(t('slots.save'))}</button>` +
        `<button class="spick" data-slot-act="import" title="${esc(t('slots.import'))}" aria-label="${esc(t('slots.import'))}">⤒</button></span></div>`;
      continue;
    }
    const nTitle = active ? ` title="${esc(t('slots.active_title'))}"` : '';
    const nameHtml = slotsUI.rename === i
      ? `<input class="slot-rename" maxlength="40" value="${esc(s.name)}" aria-label="${esc(t('slots.rename_title'))}">`
      : `<button class="slot-name" data-slot-act="rename" title="${esc(t('slots.rename_title'))}">${esc(slotDisplayName(s, i))}</button>`;
    html += `<div class="slot-row${active ? ' active' : ''}" data-i="${i}"${active ? ' aria-current="true"' : ''}>` +
      `<span class="slot-n"${nTitle}>${i + 1}</span><span class="slot-main">${nameHtml}` +
      `<span class="slot-meta muted small">${slotMetaLine(s)}</span></span>` +
      `<span class="slot-acts">` +
      `<button class="btn ghost small-btn" data-slot-act="load">${esc(t('slots.load'))}</button>` +
      `<button class="btn ghost small-btn" data-slot-act="save">${esc(t('slots.save'))}</button>` +
      `<button class="spick" data-slot-act="export" title="${esc(t('slots.export'))}" aria-label="${esc(t('slots.export'))}">⤓</button>` +
      `<button class="spick" data-slot-act="import" title="${esc(t('slots.import'))}" aria-label="${esc(t('slots.import'))}">⤒</button>` +
      `<button class="spick" data-slot-act="del" title="${esc(t('slots.del'))}" aria-label="${esc(t('slots.del'))}">✕</button></span></div>`;
  }
  list.innerHTML = html;
  // The dead zone is state, not a node: an unrelated repaint (storage event, another
  // delete) rebuilds the row from the template, which still carries .cleared while the
  // window is open. The timer is re-armed on the CURRENT node, so it can never be left
  // removing a class from an orphan while the live row stays deaf forever.
  const dead = list.querySelector && list.querySelector('.slot-row.cleared');
  if (dead) {
    const left = Math.max(0, _lastDelete.at + CLEAR_WINDOW - Date.now());
    if (_clearTimer) clearTimeout(_clearTimer);
    _clearTimer = setTimeout(() => { if (dead.classList) dead.classList.remove('cleared'); }, left);
  }
  if (_confirmFocus) { // arming a confirmation moves focus to the safe action (APG note 1)
    _confirmFocus = false;
    const c = list.querySelector && list.querySelector('.slot-row.confirm [data-slot-act="cancel"]');
    focusQuiet(c);
  }

  if (slotsUI.rename != null) {
    const inp = list.querySelector && list.querySelector('.slot-rename');
    if (inp) {
      const commit = () => {
        const cur = slotsUI.rename; if (cur == null) return;
        const v = inp.value.trim(); slotsUI.rename = null;
        if (slotsState.slots[cur]) { slotsState.slots[cur].name = v; persistSlots(); }
        renderSlots();
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.stopPropagation(); commit(); }
        else if (e.key === 'Escape') { e.stopPropagation(); slotsUI.rename = null; renderSlots(); } // Esc cancels rename, panel stays open
      });
      inp.addEventListener('blur', commit); // click-outside commits (same path as Enter)
      if (inp.focus) inp.focus();
    }
  }
}
function writeSave(i, overwrite) {
  forgetClear(i); // a deliberate save is not the second click of a double-click
  const prev = slotsState.slots[i];
  // an occupied slot keeps its name (rename owns it now); an empty one gets '' and
  // displays the localized default «Slot {n}» — never baked (spec §3.2)
  slotsState.slots[i] = { name: prev ? prev.name : '', savedAt: new Date().toISOString(), build: snapshotBuild() };
  slotsState.activeSlot = i;
  persistSlots(); renderSlots();
  if (overwrite && prev) toast(t('slots.overwritten', { n: i + 1 }), { ms: 9000, action: { label: t('slots.undo'), fn: () => { slotsState.slots[i] = prev; slotsState.activeSlot = null; persistSlots(); renderSlots(); } } });
  else toast(t('slots.saved', { n: i + 1 }));
}
function writeImport(i, parsed) {
  forgetClear(i);
  const prev = slotsState.slots[i];
  // occupied slot keeps its own name; an empty one adopts the file's (spec §3.3)
  slotsState.slots[i] = { name: prev ? prev.name : (parsed.slotName || parsed.build.name || ''), savedAt: new Date().toISOString(), build: parsed.build };
  persistSlots(); renderSlots();
  toast(t('slots.imported', { n: i + 1 }));
}
function doLoad(i) {
  const prev = snapshotBuild(), prevActive = slotsState.activeSlot; // undo = in-memory snapshot, persists on undo (autosave stays in sync)
  applySlotBuild(slotsState.slots[i].build);
  slotsState.activeSlot = i;
  persistSlots(); renderSlots();
  toast(t('slots.loaded', { n: i + 1 }), { ms: 9000, action: { label: t('slots.undo'), fn: () => { applySlotBuild(prev); slotsState.activeSlot = prevActive; persistSlots(); renderSlots(); } } });
}
function doDelete(i) {
  const prev = slotsState.slots[i], prevActive = slotsState.activeSlot;
  slotsState.slots[i] = null;
  if (slotsState.activeSlot === i) slotsState.activeSlot = null;
  // the window is stamped BEFORE the paint: the emptied row is drawn from state, so a
  // later stamp would leave the row without .cleared until some unrelated repaint
  _lastDelete = { i, at: Date.now() };
  persistSlots(); renderSlots();
  toast(t('slots.deleted', { name: slotDisplayName(prev, i) }), { ms: 9000, action: { label: t('slots.undo'), fn: () => { forgetClear(i); slotsState.slots[i] = prev; slotsState.activeSlot = prevActive; persistSlots(); renderSlots(); } } });
  focusToastUndo(); // the row’s ✕ is gone: undo is the logical continuation (spec §3.4)
  // The emptied row takes no clicks while the window is open: its «Сохранить» sits exactly
  // under the pointer that confirmed the delete (spec §2 anti-goal). The class comes from
  // state in renderSlots, so a repaint in the middle of the window cannot drop it.
}
function doExport(s, i) {
  const blob = new Blob([JSON.stringify(buildSlotFile(s, i), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slotFileName(s.name || t('slots.slot_n', { n: i + 1 }), i) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function openSlots() {
  slotsUI.open = true; slotsUI.confirm = null; slotsUI.rename = null; renderSlots();
  const p = $('#slotsPanel'); if (!p) return;
  // the panel is a sibling of the header: JS anchors it right under the header's
  // bottom edge (fixed); the mobile sheet layer pins itself to the screen bottom instead
  const wide = !(window.matchMedia && window.matchMedia('(max-width: 740px)').matches);
  const h = document.querySelector && document.querySelector('.top');
  if (wide && h && h.getBoundingClientRect) p.style.top = (h.getBoundingClientRect().bottom + 6) + 'px';
  else p.style.top = '';
  p.hidden = false; if (p.focus) p.focus();
}
function closeSlots() {
  slotsUI.open = false; slotsUI.confirm = null; slotsUI.importTarget = null;
  if (slotsUI.rename != null) { const inp = document.querySelector && document.querySelector('.slot-rename'); if (inp && inp.blur) inp.blur(); } // blur commits
  slotsUI.rename = null;
  const p = $('#slotsPanel'); if (p) p.hidden = true;
  const b = $('#slotsBtn'); if (b && b.focus) b.focus(); // focus returns to the trigger
}
function initSlots() {
  initToast();
  const btn = $('#slotsBtn');
  if (btn) btn.addEventListener('click', () => { slotsUI.open ? closeSlots() : openSlots(); });
  const cl = document.querySelector && document.querySelector('.slots-close');
  if (cl) cl.addEventListener('click', closeSlots);
  // a fixed dropdown detached from a scrolled-away header is dead UI → close (M3 menus)
  if (window.addEventListener) window.addEventListener('scroll', () => { if (slotsUI.open) closeSlots(); });
  const list = $('#slotsList');
  if (list) list.addEventListener('click', e => {
    const cell = e.target.closest ? e.target.closest('[data-slot-act]') : null;
    const row = e.target.closest ? e.target.closest('.slot-row') : null;
    if (!cell || !row) return;
    const i = +row.getAttribute('data-i'), act = cell.getAttribute('data-slot-act');
    // arming never writes: the row repaints as a question and focus goes to «Отмена»
    if (act === 'save') {
      if (slotsState.slots[i]) armConfirm(i, 'save');
      else if (justCleared(i)) return; // the second click of a double-click on the delete button
      else writeSave(i);
    }
    else if (act === 'load') { if (slotsState.slots[i]) doLoad(i); }
    else if (act === 'export') { if (slotsState.slots[i]) doExport(slotsState.slots[i], i); }
    else if (act === 'import') { if (justCleared(i)) return; slotsUI.importTarget = i; const f = $('#slotFile'); if (f) f.click(); }
    else if (act === 'del') { if (slotsState.slots[i]) armConfirm(i, 'delete'); } // never deletes outright (spec §3.1)
    else if (act === 'rename') { slotsUI.rename = i; renderSlots(); }
    else if (act === 'confirm') {
      const c = slotsUI.confirm; slotsUI.confirm = null;
      if (c) c.kind === 'import' ? writeImport(i, c.parsed) : c.kind === 'delete' ? (slotDeleteAllowed(c, i, slotsState.slots[i]) && doDelete(i)) : writeSave(i, true);
    }
    else if (act === 'cancel') { cancelConfirm(); }
  });
  const f = $('#slotFile');
  if (f) {
    // programmatic f.click() opens the native dialog; its bubbled "click" must not
    // be seen as click-outside (it would close the panel under the open dialog)
    f.addEventListener('click', e => e.stopPropagation());
    f.addEventListener('change', e => {
    const file = e.target.files[0], i = slotsUI.importTarget;
    if (!file || i == null) { e.target.value = ''; return; }
    const reader = new FileReader();
    // read failure must not leave the file in the input (same-file re-pick would not fire change)
    reader.onerror = () => { toast(t('slots.file_parse')); e.target.value = ''; };
    reader.onload = ev => {
      try {
        const parsed = parseSlotFile(ev.target.result); // parse+validate BEFORE any destructive prompt (spec §4.3)
        if (slotsState.slots[i]) armConfirm(i, 'import', { parsed });
        else writeImport(i, parsed);
      } catch (err) { toast(err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
    });
  }
  if (document.addEventListener) {
    document.addEventListener('click', e => {
      if (!slotsUI.open) return;
      // row buttons re-render (innerHTML) during bubbling — a detached target is an
      // INSIDE click whose event leaked upward, not a click-outside (probe bug 2026-11-07)
      if (e.target && e.target !== document && !document.contains(e.target)) return;
      const p = $('#slotsPanel'), b = $('#slotsBtn'), tst = $('#toast');
      const inside = (el) => el && el.contains && e.target && el.contains(e.target);
      if (inside(p) || inside(b) || inside(tst)) return; // the undo toast is part of the slot op, not "outside"
      closeSlots();
    });
    // two-stage Esc: an armed confirmation is dismissed first, the panel second —
    // Esc never confirms (APG dialog-modal: «Escape: Closes the dialog»)
    document.addEventListener('keydown', e => {
      if (!slotsUI.open || e.key !== 'Escape') return;
      if (slotsUI.confirm) { cancelConfirm(); return; }
      closeSlots();
    });
  }
  // cross-tab: another tab wrote the key → reload and repaint (last-write-wins per write)
  if (window.addEventListener) window.addEventListener('storage', e => {
    if (e.key !== SLOTS_KEY) return;
    if (e.newValue === JSON.stringify(slotsState)) return;
    slotsState = slotsStore.load();
    if (slotsUI.open) renderSlots();
  });
  // probe surface (Playwright), harmless elsewhere
  window.__SLOTS_TEST__ = { get slotsState() { return slotsState; }, get slotsUI() { return slotsUI; }, slotDeleteAllowed, renderSlots, openSlots, closeSlots, armConfirm };
}
