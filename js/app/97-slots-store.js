// Part 97-slots-store.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
const SLOTS_KEY = 'dos2planner.slots.v1';
const SLOTS_N = 5;
const SLOTS_VER = 1;
const toArray = v => Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? Object.values(v) : []);
let corruptSeq = 0; // two quarantines inside one Date.now() ms must not overwrite each other (TDZ: declared before slotsStore)
function defaultSlots() { return { version: SLOTS_VER, activeSlot: null, slots: new Array(SLOTS_N).fill(null) }; }
const slotsStore = {
  load() {
    let raw = null;
    try { raw = localStorage.getItem(SLOTS_KEY); } catch (e) { return defaultSlots(); } // SecurityError / blocked storage
    if (!raw) return defaultSlots();
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && v.version === SLOTS_VER && Array.isArray(v.slots) && v.slots.length === SLOTS_N) {
        const active = (Number.isInteger(v.activeSlot) && v.activeSlot >= 0 && v.activeSlot < SLOTS_N) ? v.activeSlot : null;
        // keep only well-formed entries; a jammed entry must not poison the whole panel
        const slots = v.slots.map(s => (s && s.build && typeof s.build === 'object')
          ? { name: String(s.name || ''), savedAt: String(s.savedAt || ''), build: s.build } : null);
        return { version: SLOTS_VER, activeSlot: active, slots };
      }
    } catch (e) { /* falls through to quarantine */ }
    try { localStorage.setItem('dos2planner.corrupt.' + Date.now() + '.' + (++corruptSeq), raw); } catch (e) { /* quarantine is best-effort */ }
    return defaultSlots();
  },
  save(data) {
    try { localStorage.setItem(SLOTS_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; } // QuotaExceededError (name or legacy code 22), SecurityError, private mode
  }
};
let slotsState = slotsStore.load();
// Full-fidelity snapshot of the working build: export v1 + bag + forge items.
function snapshotBuild() {
  return { ...buildExportData(computeFinal()), bag: [...state.bag], gen: [...GEN.values()] };
}
// Replace the working build with a slot snapshot (whitelist, arrays replaced,
// GEN rebuilt from the snapshot). lang/sort are UI prefs — they survive.
function applySlotBuild(snap) {
  const keepLang = state.lang, keepSort = state.sort;
  state = defaultState();
  state.lang = keepLang; state.sort = keepSort;
  if (typeof snap.origin === 'string') state.origin = snap.origin;
  if (typeof snap.race === 'string') state.race = snap.race;
  if (snap.heroSex === 'm' || snap.heroSex === 'f') state.heroSex = snap.heroSex;
  if (typeof snap.level === 'number') state.level = snap.level;
  if (snap.attr && typeof snap.attr === 'object') Object.assign(state.attr, snap.attr);
  if (snap.combat && typeof snap.combat === 'object') Object.assign(state.combat, snap.combat);
  if (snap.civil && typeof snap.civil === 'object') Object.assign(state.civil, snap.civil);
  if (Array.isArray(snap.talents) || (snap.talents && typeof snap.talents === 'object'))
    state.talents = toArray(snap.talents).filter(x => typeof x === 'string');
  if (snap.questTalents) state.questTalents = toArray(snap.questTalents).filter(x => typeof x === 'string');
  if (snap.skills) state.skills = toArray(snap.skills).filter(x => typeof x === 'string');
  if (typeof snap.spiderKissVision === 'string') state.spiderKissVision = snap.spiderKissVision;
  if (snap.equipment && typeof snap.equipment === 'object')
    for (const [k] of EQUIP_SLOTS) if (k in snap.equipment) state.equipment[k] = snap.equipment[k];
  if (snap.bag) state.bag = toArray(snap.bag).filter(id => typeof id === 'string');
  GEN.clear();
  state.gen = toArray(snap.gen); // restoreGen() fills GEN, backfills legacy icons, deletes state.gen
  restoreGen();
  afterChange();
}
// The export file for one slot (spec §3.3). Legacy bare-build v1 files stay readable.
function buildSlotFile(slot, idx) {
  return { app: 'dos2planner', kind: 'slot', version: 1, exportedAt: new Date().toISOString(), slotName: (slot && slot.name) || '', build: slot.build };
}
function parseSlotFile(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error(t('slots.file_parse')); }
  if (!d || typeof d !== 'object') throw new Error(t('slots.file_no_build'));
  const b = (d.kind === 'slot') ? d.build : d;
  if (!b || typeof b !== 'object') throw new Error(t('slots.file_no_build'));
  if (b.version > 1 || d.version > 1) throw new Error(t('slots.file_newer'));
  if (b.version !== 1) throw new Error(t('slots.file_no_build'));
  return { slotName: (d.kind === 'slot' && typeof d.slotName === 'string') ? d.slotName : '', build: b };
}
// Download name: forbidden chars only, Cyrillic kept, ≤60, name-slot-date-time.
function sanitizeSlotFileName(name) {
  return String(name == null ? '' : name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}
function slotFileName(name, idx) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return sanitizeSlotFileName(name) + '-' + (idx + 1) + '-' +
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + '-' + p(d.getMinutes());
}
