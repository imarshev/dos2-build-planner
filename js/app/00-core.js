// Part 00-core.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
/* ============================================================
   DOS2 Build Planner — app.js
   Self-contained SPA, RU UI, data from js/data.js (window.DATA)
   ============================================================ */
'use strict';
const D = window.DATA;
const ITEMS = D.items;
const CH = D.character;
const LS_ = CH.levelSystem;
const LS_KEY = 'dos2planner.v1';

/* ==================== 1. Constants & dictionaries ====================
   All UI copy (labels, slots, rarities, elements, immunities, zones) lives in
   app/i18n/{ru,en}.yaml and is read via t('label.…'). */
const RES_KEYS = ['fire', 'water', 'air', 'earth', 'poison', 'physical'];
const ITEM_SLOT_KEYS = ['main_hand', 'off_hand', 'helmet', 'chest', 'leggings', 'gloves', 'boots', 'belt', 'ring', 'amulet'];
const WEAPON_TYPE_KEYS = ['dagger','sword','two_handed_sword','axe','two_handed_axe','mace','two_handed_mace','spear','staff','wand','bow','crossbow'];
const TWO_HANDED_TYPES = new Set(['two_handed_sword','two_handed_axe','two_handed_mace','spear','staff','bow','crossbow']);
// Official RU names, injected from the game pak (data/ru_catalog.json -> window.DATA.ru).
// Fallback to the EN name if a string is missing from the official map.
const SKILL_RU = D.ru || {};
const FLAVOR = D.flavor || {};
// Game-icon sprite geometry (data/game_icons_sprite.json via build_data.js); null = no sprite shipped.
const ICON_SPRITE = D.iconSprite || null;
// Game portraits (the atlas Portraits_DOS2_MainPL_Icons + the hero root-template icons):
// sheet geometry lives in D.portraitSprite, cell assignment in D.portraits.
const PORTRAIT_SPRITE = D.portraitSprite || null;
const PORTRAITS = Object.fromEntries((D.portraits || []).map(p => [p.id, p]));
// Иконки навыков (цепочка — tools/game_skills_icons_extract.js, лист — assets/icons/skills.png);
// ячейка [col,row] лежит на каждом навыке (sk.icon), null = спрайт не выложен.
const SKILL_SPRITE = D.skillSprite || null;
// Грантовый лист (D.grantSkills, design 2026-11-09 §3.4): клетки иконок вне атласа 223.
const GRANT_SPRITE = D.grantSprite || null;
const itemName = (it) => state.lang === 'ru' ? ((D.ru && D.ru[it.name]) || it.name) : it.name;
// Granted-skill name in the current language (D.ru covers skill names as well as item names).
const skillLabel = (id) => state.lang === 'ru' ? (SKILL_RU[id] || id) : id;
const SKILL_BY_ID = {};
for (const grp of ['schools', 'weapon', 'defence']) for (const s of CH.combatAbilities[grp]) SKILL_BY_ID[s.id] = s;
for (const s of CH.civilAbilities.list) SKILL_BY_ID[s.id] = s;
const SKILL_ID_BY_NAME = {};
for (const s of Object.values(SKILL_BY_ID)) SKILL_ID_BY_NAME[s.name] = s.id;
const COMBAT_IDS = [...CH.combatAbilities.schools, ...CH.combatAbilities.weapon, ...CH.combatAbilities.defence].map(s => s.id);
const SCHOOL_IDS = CH.combatAbilities.schools.map(s => s.id);
const WEAPON_IDS = CH.combatAbilities.weapon.map(s => s.id);
const DEFENCE_IDS = CH.combatAbilities.defence.map(s => s.id);
const CIVIL_IDS = CH.civilAbilities.list.map(s => s.id);
// Roll pools per slot, per data/raw/divine_legendary_roll_mechanics.json:
// amulet → Skill+Defence (never Weapon); ring → Skill only (no Defence/Weapon);
// belt → Weapon+Defence (no Skill) + civil subset (no Persuasion/Loremaster).
const ROLL_COMBAT = { amulet: [...SCHOOL_IDS, ...DEFENCE_IDS], ring: [...SCHOOL_IDS], belt: [...WEAPON_IDS, ...DEFENCE_IDS] };
const ROLL_CIVIL = {
  amulet: ['bartering', 'telekinesis', 'lucky_charm', 'loremaster', 'persuasion'],
  belt: ['lucky_charm', 'bartering', 'thievery', 'telekinesis', 'sneaking']
};
const ATTR_IDS = CH.attributes.map(a => a.id);
// DE-кривая Vitality (EoCApp.exe FUN_141cf0340, Ghidra 12.1.3; константы — character.json):
// growth = 1.25^(L-1); каждый прыжок (L>=9/13/16/18) умножает её на growth/1.25 (no-op кроме 18→1.35);
// boost = floor(round(L*9.091 + 21*growth)/5)*5 — floor ПОСЛЕ roundf (гист-транскрипция round-half-up
// неверна на L2/6/7/8/12-15/21-23). Прежний HP_BASE (classic-подгон fextralife, якорь «L10 CON10≈480»)
// отвергнут декомпилом: docs/research/ws11_attributes/results/decomp_findings.md.
const VT = CH.levelSystem.vitality;
function vitalityBoost(level) {
  let growth = Math.pow(VT.exponentialGrowth, level - 1);
  for (const lp of VT.leaps) if (level >= lp.level) growth *= lp.growth / 1.25;
  return Math.floor(Math.round(level * VT.linearGrowth + VT.startingAmount * growth) / VT.roundTo) * VT.roundTo;
}
// [slotKey, i18n key of the display label] — labels come from app/i18n/*.yaml.
const EQUIP_SLOTS = [
  ['main_hand', 'label.slot.main_hand'], ['off_hand', 'label.slot.off_hand'], ['helmet', 'label.slot.helmet'],
  ['chest', 'label.slot.chest'], ['leggings', 'label.slot.leggings'], ['gloves', 'label.slot.gloves'],
  ['boots', 'label.slot.boots'], ['belt', 'label.slot.belt'], ['ring1', 'label.slot.ring1'],
  ['ring2', 'label.slot.ring2'], ['amulet', 'label.slot.amulet']
];

/* ==================== 2. State management ==================== */
function defaultState() {
  return {
    origin: 'custom', race: 'human', level: 10,
    heroSex: 'm', // custom-hero portrait sex: rolled 50/50 on every "custom" pick (rollHeroSex)
    lang: 'ru', // UI language (ru|en). Persisted in LS via save(), but NOT part of build export.
    attr: Object.fromEntries(ATTR_IDS.map(id => [id, 0])),
    combat: Object.fromEntries(COMBAT_IDS.map(id => [id, 0])),
    civil: Object.fromEntries(CIVIL_IDS.map(id => [id, 0])),
    talents: [], questTalents: [], spiderKissVision: '',
    skills: [], // chosen learnable skills (stat names from D.skills)
    equipment: Object.fromEntries(EQUIP_SLOTS.map(([k]) => [k, null])),
    bag: [],
    sort: { key: '', dir: 1 }, // item-table sort; UI-only, persisted in LS, not part of the build export
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const st = JSON.parse(raw), d = defaultState();
    delete st.name; // legacy key of the removed header name field (spec 2026-11-07-remove-char-name §3.1)
    for (const k of Object.keys(d)) if (!(k in st)) st[k] = d[k];
    // Backfill any missing keys in the per-id maps with their defaults
    // (0 for the point maps, null for equipment).
    for (const map of ['attr', 'combat', 'civil', 'equipment']) {
      const def = d[map];
      for (const k of Object.keys(def)) if (st[map][k] == null) st[map][k] = def[k];
    }
    return st;
  } catch (e) { return defaultState(); }
}
let state = loadState();
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...state, gen: [...GEN.values()] })); } catch (e) { /* file:// may block */ }
}
function restoreGen() {
  if (Array.isArray(state.gen)) for (const it of state.gen) if (it && it.id) {
    // icons were not rolled into saved items before the forge-icon map existed — backfill;
    // same for pre-tier names (lowercase first letter = legacy, e.g. RU slot-noun-only names)
    if (!it.icon) it.icon = forgeIcon(it);
    if (typeof it.name === 'string' && !/^[A-Z\u0410-\u042F\u0401]/.test(it.name)) it.name = forgeName(it);
    GEN.set(it.id, it);
  }
  delete state.gen;
}
const BY_ID = new Map(ITEMS.map(i => [i.id, i]));
const GEN = new Map(); // generated items
window.GEN = GEN; // published for damage.js (lazy read, load-order independent)
function itemById(id) { return BY_ID.get(id) || GEN.get(id) || null; }
/* ==================== 3. Pools & talents ==================== */
function pools() {
  const L = state.level, lw = state.talents.includes('Lone Wolf');
  const asu = state.talents.includes('All Skilled Up');
  const bigger = state.talents.includes('Bigger And Better');
  const attrTotal = LS_.attribute.atCreation + LS_.attribute.perLevel * (L - 1) + (state.combat.polymorph || 0) + (bigger ? 2 : 0);
  // «Мастер на все руки» (All Skilled Up) — по ОДНОМУ свободному очку в пул боевых и гражданских
  // умений: pak uid hf3893f8fg20c5g4078ga83cgef8783082103 — «immediately gives you [2] extra Combat
  // ability point(s) and [3] extra Civil ability point(s)». Очки пула, не уровни умений: в
  // _finalCivil таланта быть не должно (иначе +1 ко всем гражданским и +2 слота памяти).
  const combatTotal = LS_.combat.atCreation + LS_.combat.perLevel * (L - 1) + (asu ? 1 : 0);
  const civilTotal = LS_.civil.levels.filter(x => x <= L).length + (asu ? 1 : 0);
  const talentPicks = LS_.talent.levels.filter(x => x <= L).length;
  return {
    attrTotal, attrSpent: ATTR_IDS.reduce((s, id) => s + state.attr[id], 0),
    combatTotal, combatSpent: COMBAT_IDS.reduce((s, id) => s + state.combat[id], 0),
    civilTotal, civilSpent: CIVIL_IDS.reduce((s, id) => s + state.civil[id], 0),
    talentPicks, lw, asu
  };
}
/* Lone Wolf doubles invested points only up to the SAME cap as without it: in DE everybody caps
   at 40 attributes / 10 combat abilities (the 70/20 caps were Classic-only). One place owns the
   multiplier, the investable limit and the effective points, so the value, the stepper and the
   cap-bar can never disagree. Sources: docs/research/ws1_mechanics/results/{Attribute,Combat}_
   point_economy.json — fextralife Lone Wolf: «doubles invested points in attributes - up to a
   maximum of 40 - and combat abilities (except Polymorph ability) - up to a maximum of 10»;
   Larian DE post: «you will only be able to double your points to the cap and not beyond». */
