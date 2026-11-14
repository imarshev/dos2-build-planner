// Part 95-layout.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
const LAYOUT_KEY = 'dos2planner.layout.v1';
const SECTION_IDS = ['origin_race', 'level', 'attrs', 'civil', 'equipment', 'combat', 'skills', 'talents'];
const LAYOUT_DEFAULT = [['origin_race', 'level', 'attrs', 'equipment'], ['skills', 'civil', 'combat'], ['talents']];
// Parse + validate a stored layout: exactly 3 columns, every known id exactly once
// (empty columns allowed — the user may stack everything into one column). Pure, QA-tested.
function parseLayout(raw) {
  if (!raw) return null;
  let o; try { o = JSON.parse(raw); } catch (e) { return null; }
  if (!Array.isArray(o) || o.length !== LAYOUT_DEFAULT.length) return null;
  const seen = new Set();
  for (const col of o) {
    if (!Array.isArray(col)) return null;
    for (const id of col) {
      if (typeof id !== 'string' || SECTION_IDS.indexOf(id) < 0 || seen.has(id)) return null;
      seen.add(id);
    }
  }
  return seen.size === SECTION_IDS.length ? o : null;
}
function layoutCols() {
  const q = document.querySelectorAll && document.querySelectorAll('.ccol');
  return (q && q.length === 3) ? q : null;
}
// Current DOM order -> [[id,…],[…],[…]] — what Sortable's onSort persists.
function serializeLayout() {
  const cols = layoutCols(); if (!cols) return null;
  return [].map.call(cols, col =>
    [].filter.call(col.children, s => s.hasAttribute && s.hasAttribute('data-id'))
      .map(s => s.getAttribute('data-id')));
}
function saveLayout() {
  const o = serializeLayout();
  try { if (o) localStorage.setItem(LAYOUT_KEY, JSON.stringify(o)); } catch (e) { /* file:// may block */ }
}
function applyLayout(order) {
  const cols = layoutCols(); if (!cols) return;
  // appendChild MOVES the node; within a column the array order wins.
  order.forEach((ids, i) => ids.forEach(id => {
    const sec = document.querySelector('section[data-id="' + id + '"]');
    if (sec) cols[i].appendChild(sec);
  }));
}
function resetLayout() {
  try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* file:// may block */ }
  applyLayout(LAYOUT_DEFAULT);
}
function initLayout() {
  if (!window.Sortable) return; // QA shim / degraded mode
  const cols = layoutCols(); if (!cols) return;
  let raw = null; try { raw = localStorage.getItem(LAYOUT_KEY); } catch (e) { /* file:// may block */ }
  const saved = parseLayout(raw);
  if (saved) applyLayout(saved); // null => the HTML default already is the layout
  const opts = {
    group: 'charsections', draggable: 'section.sec', handle: 'h2', animation: 150,
    ghostClass: 'sec-ghost',
    delay: 150, delayOnTouchOnly: true, touchStartThreshold: 8, // touch: hold the header to drag, swipes still scroll
    onSort: saveLayout
  };
  for (let i = 0; i < cols.length; i++) new window.Sortable(cols[i], opts);
  const btn = $('#layoutResetBtn'); if (btn) btn.addEventListener('click', resetLayout);
}

/* ==================== 12. Build save slots ====================
   Up to 5 named snapshots of the working build, stored in their OWN localStorage
   key (like the layout key): the working autosave `dos2planner.v1` stays untouched.
   A slot = { name, savedAt, build } where build is the v1 export payload plus
   additive `bag`/`gen` (a slot must round-trip forge equipment). Loading a slot
   REPLACES the working build (arrays are replaced, not merged — Object.assign on
   the old talents-object would leave the previous build's tails); UI preferences
   (lang, sort) survive. Storage may be unavailable (Safari private, file://):
   every read/write is guarded, corrupt values are quarantined, never thrown. */
