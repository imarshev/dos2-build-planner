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
// Base max HP per level at CON 0. Source: fextralife Vitality table, cross-checked with 2017 game
// Data.txt constants (VitalityStartingAmount/ExponentialGrowth/LinearGrowth + leaps) and in-game
// reports (L10 CON10 ≈ 480). See docs/research/ws1_derived_stats/results/stats_batch1.json.
const HP_BASE = [30,45,65,85,110,135,165,200,235,285,345,415,560,685,840,1015,1255,1790,2240,2815,3545,4480,5670,7190,9130];
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
    name: '', // empty = "default hero name", resolved for display via t('hero_name') (i18n may not be ready yet)
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
const attrMult = (lw) => (lw ? 2 : 1);
const combatMult = (lw, id) => (lw && id !== 'polymorph' ? 2 : 1);
// Points that can actually be invested: 30 attributes (15 with LW), 10 combat (5 with LW;
// Polymorph is not doubled, so it keeps 10).
const attrInvCap = (lw, base = 10) => Math.floor((LS_.attribute.cap - base) / attrMult(lw));
const combatInvCap = (lw, id) => Math.floor(LS_.combat.cap / combatMult(lw, id));
// What the invested points are worth after the doubling, bounded by the cap.
const attrEff = (lw, inv, base = 10) => Math.min(inv * attrMult(lw), LS_.attribute.cap - base);
const combatEff = (lw, id, inv) => Math.min(inv * combatMult(lw, id), LS_.combat.cap);
const has = t => state.talents.includes(t);
const hasQuest = t => state.questTalents.includes(t);
// Like hasQuest, but also respects origin restrictions (e.g. Rooted only for Sebille).
const hasQuestAllowed = t => {
  if (!state.questTalents.includes(t)) return false;
  const q = CH.talents.questUnique.find(x => x.name === t);
  return q ? questTalentAllowed(q) : true;
};
function talentPrereqMet(t) {
  if (!t.prerequisite) return true;
  // t.prerequisite is always the EN machine form (e.g. "Pyrokinetic 1");
  // it maps onto SKILL_ID_BY_NAME. t.prerequisiteRu is display-only.
  const m = String(t.prerequisite).match(/^(.+?) (\d+)$/);
  if (!m) return true;
  const id = SKILL_ID_BY_NAME[m[1]];
  return id ? (state.combat[id] || 0) >= +m[2] : true;
}
function enforceTalents() {
  state.talents = state.talents.filter(n => {
    const t = CH.talents.selectable.find(x => x.name === n);
    if (!t) return true;
    if (!talentPrereqMet(t)) return false;
    if (t.conflicts) {
      const idx = state.talents.indexOf(n);
      if (t.conflicts.some(c => state.talents.includes(c) && state.talents.indexOf(c) < idx)) return false;
    }
    return true;
  });
}
function toggleTalent(name) {
  const t = CH.talents.selectable.find(x => x.name === name);
  if (!t) return;
  const p = pools();
  if (!state.talents.includes(name)) {
    if (state.talents.length >= p.talentPicks) return;
    if (!talentPrereqMet(t)) return;
    if (t.conflicts && t.conflicts.some(c => state.talents.includes(c))) return;
    state.talents.push(name);
  } else {
    state.talents = state.talents.filter(x => x !== name);
  }
  enforceTalents();
  afterChange();
}
// Some quest-unique talents are restricted to a specific origin (e.g. Rooted → Sebille).
const originNameRu = id => { const o = CH.origins.find(x => x.id === id); return o ? L(o) : id; };
function questTalentAllowed(t) {
  return !t.origin || state.origin === t.origin;
}
function pruneQuestTalents() {
  state.questTalents = state.questTalents.filter(n => {
    const t = CH.talents.questUnique.find(x => x.name === n);
    return t ? questTalentAllowed(t) : true; // keep unknown names defensively
  });
}
/* ==================== 3b. Skills (изучаемые навыки) ==================== */
// Правила: docs/research/skills-learning/report.md — гейт по школам (§1), бюджет (§2),
// особые пути и автовыдаваемые расой/ориджином/оружием (§4). D.skills — data/skills.json.
const SKILLS = D.skills || [];
const SKILL_BY_STAT = {};
for (const sk of SKILLS) SKILL_BY_STAT[sk.stat] = sk;
const AUTO_SRCS = ['racial', 'origin', 'weapon'];
let _skillsPruned = []; // stats removed by pruneSkills() in this afterChange — shown as a notice
const isAutoSkill = sk => AUTO_SRCS.indexOf(sk.src) >= 0;
// wiki-значение auto (колонка Req страницы Special_Skills) → состояние планнера
const AUTO_RACE = { Lizard: 'lizard', Elf: 'elf', Dwarf: 'dwarf', Undead: 'undead', Human: 'human' };
const AUTO_ORIGIN = { 'Sebille': 'sebille', 'The Red Prince': 'red_prince', 'Lohse': 'lohse', 'Ifan ben-Mezd': 'ifan', Fane: 'fane', 'Custom Origin': 'custom' };
const AUTO_WEAPON = { 'Two-Handed Weapon': 'two_handed', 'Dual Wield': 'dual_wielding' };
function skillAutoGranted(sk, f) {
  if (sk.src === 'racial') return sk.auto === 'Beast' ? state.origin === 'beast' : AUTO_RACE[sk.auto] === state.race;
  if (sk.src === 'origin') return AUTO_ORIGIN[sk.auto] === state.origin;
  if (sk.src === 'weapon') { const id = AUTO_WEAPON[sk.auto]; return !!id && (f.combat[id] || 0) > 0; }
  return false;
}
// selectedSkills — выбранные записи D.skills (без потерянных stat из старых сборок)
function selectedSkills() {
  return state.skills.map(st => SKILL_BY_STAT[st]).filter(Boolean);
}
// memPool: total — f.mem (формула computeFinal), spent — сумма Memory Cost выбранных
function memPool(f) {
  const total = f.mem;
  const spent = selectedSkills().reduce((s, sk) => s + sk.mem, 0);
  return { total, spent, left: total - spent };
}
// skillAllowed: выполнены все reqs по финальным школам (LW ×2 уже в f.combat) и,
// для Source-тренера, достигнут уровень персонажа sk.lvl. missing — «school N»/«lvl N» (UI локализирует).
function skillAllowed(sk, f) {
  const missing = [];
  for (const r of sk.reqs || []) if ((f.combat[r.id] || 0) < r.lvl) missing.push(r.id + ' ' + r.lvl);
  if ((sk.lvl || 1) > 1 && state.level < sk.lvl) missing.push('lvl ' + sk.lvl);
  return { ok: !missing.length, missing };
}
// syncAutoSkills: выдача/снятие расовых/ориджин/оружейных навыков при смене состояния
function syncAutoSkills(f) {
  for (const sk of SKILLS) {
    if (!isAutoSkill(sk)) continue;
    const on = state.skills.indexOf(sk.stat) >= 0;
    const want = skillAutoGranted(sk, f);
    if (want && !on) state.skills.push(sk.stat);
    else if (!want && on) state.skills = state.skills.filter(x => x !== sk.stat);
  }
}
// toggleSkill: выбор/снятие изучаемого навыка; автовыдаваемые не кликаются;
// добавление только при выполненном гейте и свободном бюджете памяти.
function toggleSkill(stat) {
  const sk = SKILL_BY_STAT[stat];
  if (!sk || isAutoSkill(sk)) return;
  const i = state.skills.indexOf(stat);
  if (i >= 0) { state.skills.splice(i, 1); afterChange(); return; }
  const f = computeFinal();
  if (!skillAllowed(sk, f).ok) return;
  if (sk.mem > memPool(f).left) return;
  state.skills.push(stat);
  afterChange();
}
// pruneSkills: снимает ставшие недоступными и не влезающие в бюджет (в порядке выбора);
// возвращает снятые stat — секция покажет уведомление (как enforceTalents для талантов).
function pruneSkills(f) {
  const removed = [];
  let spent = 0;
  const kept = [];
  for (const st of state.skills) {
    const sk = SKILL_BY_STAT[st];
    if (!sk) { removed.push(st); continue; }
    if (isAutoSkill(sk)) { if (skillAutoGranted(sk, f)) { kept.push(st); spent += sk.mem; } else removed.push(st); continue; }
    if (!skillAllowed(sk, f).ok) { removed.push(st); continue; }
    if (spent + sk.mem > f.mem) { removed.push(st); continue; }
    spent += sk.mem; kept.push(st);
  }
  state.skills = kept;
  return removed;
}
/* ==================== 4. Equipment ==================== */
// A two-handed weapon occupies both hands, so main_hand + off_hand never coexist with it.
// The most recent equip wins: a two-handed weapon frees the off hand (equipItem), and an
// off-hand item (shield) unequips the two-handed weapon (equipItem). Passive states that
// never pass through equipItem (legacy localStorage saves, build imports) are normalized
// deterministically: the two-handed weapon stays worn, the off-hand item is dropped.
const isTwoHanded = (id) => { const it = itemById(id); return !!it && TWO_HANDED_TYPES.has(it.weaponType); };
function enforceTwoHanded() {
  if (isTwoHanded(state.equipment.main_hand)) state.equipment.off_hand = null;
}
function equipItem(id) {
  const it = itemById(id);
  if (!it) return;
  if (it.slot === 'none') {
    if (!state.bag.includes(id)) state.bag.push(id);
    afterChange();
    return;
  }
  let key = it.slot;
  if (it.slot === 'ring') key = !state.equipment.ring1 ? 'ring1' : (!state.equipment.ring2 ? 'ring2' : 'ring1');
  if (it.slot === 'main_hand' && TWO_HANDED_TYPES.has(it.weaponType)) state.equipment.off_hand = null;
  else if (it.slot === 'off_hand' && isTwoHanded(state.equipment.main_hand)) state.equipment.main_hand = null;
  state.equipment[key] = id;
  afterChange();
}
function unequipItem(key) { state.equipment[key] = null; afterChange(); }
function unequipCurrent() {
  for (const k of Object.keys(state.equipment)) if (state.equipment[k] === selId) state.equipment[k] = null;
  afterChange();
}
/* ==================== 5. Computation (gearStats, computeFinal) ==================== */
function zeroAttr() { return Object.fromEntries(ATTR_IDS.map(id => [id, 0])); }
function zeroSkill() { const o = {}; for (const id of COMBAT_IDS.concat(CIVIL_IDS)) o[id] = 0; return o; }
// Affix kind → (target object key, stat accessor) for gearStats accumulation.
const AFFIX_TARGET = {
  attribute: (g, a) => { if (g.attr[a.stat] != null) g.attr[a.stat] += a.value || 0; },
  skill: (g, a) => { if (g.skill[a.stat] != null) g.skill[a.stat] += a.value || 0; },
  resistance: (g, a) => { if (g.res[a.stat] != null) g.res[a.stat] += a.value || 0; },
  damage: (g, a) => { if (g.dmg[a.stat] != null) g.dmg[a.stat] += a.value || 0; },
  vitality: (g, a) => { g.vit += a.value || 0; },
  dodge: (g, a) => { g.dodge += a.value || 0; },
  crit: (g, a) => { g.crit += a.value || 0; },
  initiative: (g, a) => { g.init += a.value || 0; },
  movement: (g, a) => { g.move += a.value || 0; },
};
function gearStats() {
  const g = {
    attr: zeroAttr(), skill: zeroSkill(),
    res: { fire: 0, water: 0, air: 0, earth: 0, poison: 0, physical: 0 },
    dmg: { fire: 0, water: 0, air: 0, earth: 0, poison: 0, physical: 0 },
    vit: 0, dodge: 0, crit: 0, init: 0, move: 0, pArmor: 0, mArmor: 0, skills: 0
  };
  for (const id of Object.values(state.equipment)) {
    if (!id) continue;
    const it = itemById(id);
    if (!it) continue;
    if (it.physicalArmor) g.pArmor += it.physicalArmor;
    if (it.magicArmor) g.mArmor += it.magicArmor;
    for (const a of it.affixes) {
      const fn = AFFIX_TARGET[a.kind];
      if (fn) fn(g, a);
    }
    if (it.grantedSkill) g.skills++;
  }
  return g;
}
// Spider's Kiss: the -2 Constitution is always applied; the +2 bonus (or gold/idol)
// depends on the vision chosen in the "A Web of Desire" quest (state.spiderKissVision).
// Only attribute visions map to a stat; gold/idol grant no attribute bonus.
const SKK_VISION_ATTR = { oak: 'strength', quill: 'intelligence', dragon: 'wits' };
// The vision <select> always shows its first option when state is '' (browser default),
// so a checked Spider's Kiss must carry that same first vision in state — otherwise the
// UI reads "Сила +2" while compute applies nothing until the user re-picks (first-check bug).
// Also normalizes legacy saves/imports that have the talent checked with vision ''.
const SKK_VISIONS = (CH.talents.questUnique.find(tl => tl.name === "Spider's Kiss") || {}).visions || [];
const SKK_VISION_DEFAULT = SKK_VISIONS.length ? SKK_VISIONS[0].id : '';
function normalizeSkkVision() {
  if (hasQuest("Spider's Kiss") && !state.spiderKissVision) state.spiderKissVision = SKK_VISION_DEFAULT;
}
// Per-race civil skill bonus (hardcoded in the game).
const RACIAL_BONUS = { human: { bartering: 1 }, elf: { loremaster: 1 }, dwarf: { sneaking: 1 }, lizard: { persuasion: 1 }, undead: {} };
// Sub-calculators for computeFinal(): each returns one slice of the final stats.
function _finalAttr(g, lw) {
  const attr = {};
  for (const a of CH.attributes) {
    // Lone Wolf's ×2 is bounded by the same 40 cap (see attrEff): 15 invested points reach 40,
    // a 16th point buys nothing — and the stepper blocks it. Bigger And Better grants +2 points
    // to the pool (see pools()), not to an attribute; gear stacks on top of the cap.
    let v = a.base + attrEff(lw, state.attr[a.id] || 0, a.base) + (g.attr[a.id] || 0);
    if (a.id === 'memory' && (has('Mnemonic') || hasQuestAllowed('Rooted'))) v += 3;
    if (hasQuest("Spider's Kiss")) {
      if (a.id === 'constitution') v -= 2;
      else if (SKK_VISION_ATTR[state.spiderKissVision] === a.id) v += 2;
    }
    attr[a.id] = v;
  }
  return attr;
}
function _finalCombat(g, lw) {
  const combat = {};
  for (const id of COMBAT_IDS) {
    const base = state.combat[id] || 0;
    // Same rule as attributes (see combatEff): rank 10 is the ceiling with and without Lone
    // Wolf (5 invested points ×2); Polymorph is not doubled; gear stacks on top of the cap.
    combat[id] = combatEff(lw, id, base) + (g.skill[id] || 0);
  }
  return combat;
}
function _finalCivil(g) {
  const racialBonus = RACIAL_BONUS[state.race] || {};
  const civil = {};
  // «Мастер на все руки» (All Skilled Up) даёт по ОЧКУ в пул боевых и гражданских умений — см.
  // pools(), где он и учтён. Сюда, в уровни умений, талант писать НЕ должен: игровой текст
  // (pak uid hf3893f8fg20c5g4078ga83cgef8783082103) — «immediately gives you [2] extra Combat
  // ability point(s) and [3] extra Civil ability point(s)», то есть очки, а не уровни. Прежний
  // двойной учёт завышал все семь гражданских на 1 и через civil.loremaster — слоты памяти на 2.
  for (const id of CIVIL_IDS) civil[id] = (state.civil[id] || 0) + (racialBonus[id] || 0) + (g.skill[id] || 0);
  return civil;
}
function _finalDerived(attr, combat, g, lw) {
  const con = attr.constitution;
  const hpMult = 1 + (has('Sturdy') ? 0.10 : 0) + (lw ? 0.30 : 0) + (has('Picture Of Health') ? 0.03 * combat.warfare : 0);
  const hpBase = HP_BASE[Math.min(state.level, HP_BASE.length) - 1];
  const hp = Math.round(hpBase * (1 + 0.07 * con) * hpMult) + g.vit;
  let pA = g.pArmor, mA = g.mArmor;
  if (lw) { pA = Math.round(pA * 1.3); mA = Math.round(mA * 1.3); }
  // Base crit 0%: crit = Wits*1% + talents + gear (stats_batch1: crit_base=0, crit_per_wits=1).
  const crit = attr.wits + (has('Ingenious') ? 5 : 0) + (has('Hothead') ? 10 : 0) + g.crit;
  // Base dodge 0%: talents + Dual Wielding (+1%/pt) + gear (stats_batch2: dodge_base=0).
  const dodge = (has('Sturdy') ? 5 : 0) + (has('Parry Master') && state.combat.dual_wielding > 0 ? 10 : 0) + combat.dual_wielding + g.dodge;
  const res = { ...g.res };
  if (state.race === 'lizard') { res.fire += 10; res.poison += 10; }
  if (state.race === 'undead') res.poison = Math.max(res.poison, 100);
  if (has('Demon')) { res.fire += 15; res.water -= 15; }
  if (has('Ice King')) { res.water += 15; res.fire -= 15; }
  const init = attr.wits + g.init;
  const move = 3 + g.move;
  // Max AP: base 6, Lone Wolf +2 (<=2 party), What A Rush +1 (<50% HP) (stats_batch3).
  const ap = 6 + (lw ? 2 : 0) + (has('What A Rush') ? 1 : 0);
  // Carry weight = 10 kg per STR point (stats_batch4: CarryWeightBase=0, CarryWeightPerStr=10).
  const carry = attr.strength * 10;
  // Accuracy («Точность» / «Accuracy») is the character-level to-hit stat: base 95% (FextraLife
  // "Accuracy"; RU Steam guide «Стандартное значение 95%»), changed by talents, gear, skills and
  // stances — in the shipped data it is a stats-table column (`Accuracy`, see
  // data/raw/pak_extracted/…Stats_Character_Character.txt:11693). It is defined without a target,
  // which is exactly what a build planner needs.
  // The second row «Шанс попадания» (hitChance = accuracy × (1 − own dodge/100)) was removed on
  // 2026-11-07 as a duplicate of this one: it equalled accuracy whenever dodge was 0, and where it
  // differed it was wrong — the real quantity is target-derived and multiplicative in the TARGET's
  // dodge, (1 − targetDodge) × accuracy (FextraLife "Accuracy"/"Dodging"), so it has no value
  // without a target, and the attacker's own dodge never lowers their own hit chance. Do not
  // re-add it: docs/superpowers/specs/2026-11-07-accuracy-hit-chance-dedup-design.md.
  // Hothead («Горячая голова») adds +10 accuracy on top of its +10 crit above: pak uid
  // he94327f7g293dg488eg9d25gcb4f7ae7be24 — «+[2]% к шансу крит. удара и +[3] к точности»;
  // dos2.wiki + fextralife confirm 10/10 (docs/superpowers/specs/2026-11-06-hothead-accuracy-design.md).
  // The "at max vitality" condition is not gated — planner shows max values for conditional
  // talents, same convention as What A Rush below; do not "fix" this back to a plain 95.
  // Not capped at 100 on purpose: accuracy above 100% is the margin against a target's dodge.
  const accuracy = 95 + (has('Hothead') ? 10 : 0);
  // Critical damage multiplier: base 150%, +5% per Two-Handed point, +5% per Scoundrel point, Ingenious (Human) +10%.
  // Source: Larian forums — "Basic crit damage is 150% of base damage."
  // Fextralife Abilities: Two-Handed +5% Crit Mult, Scoundrel +5% Crit Mult (per point).
  const critMult = 150 + (state.combat.two_handed || 0) * 5 + (state.combat.scoundrel || 0) * 5 + (state.race === 'human' ? 10 : 0);
  return { hp, pA, mA, crit, dodge, res, init, move, ap, carry, accuracy, critMult };
}
function computeFinal() {
  const g = gearStats();
  const lw = state.talents.includes('Lone Wolf');
  const attr = _finalAttr(g, lw);
  const combat = _finalCombat(g, lw);
  const civil = _finalCivil(g);
  const d = _finalDerived(attr, combat, g, lw);
  // Бюджет памяти (слоты заучивания): slots = 3 + floor(level/2) + (Memory − 10) + (Loremaster>0 ? 2 : 0).
  // Движок DE (data.txt): CharacterBaseMemoryCapacity=3, Growth=0.5, AttributePointsPerMemoryCapacity=1,
  // LoremasterBonusToMemory=2; игровой тултип «Base slots: [1]. Extra slots from Memory: +[2].» (hea9cf9e9):
  // база считается от уровня, атрибут — только сверх 10 (сверка: lvl 10, Memory 12 → база 8 + 2 = 10).
  // Источники и отвергнутое: docs/research/ws10_memory_slots/report.md (прежняя формула считала
  // атрибут целиком и завышала бюджет на 7). Mnemonic/Rooted (+3 к стату) учитаны в attr.memory.
  d.mem = 3 + Math.floor(state.level / 2) + (attr.memory - 10) + (civil.loremaster > 0 ? 2 : 0);
  return { attr, cap: LS_.attribute.cap, combat, civil, ...d, dmg: g.dmg, skills: g.skills, lw, gear: g };
}
/* ==================== 6. Rendering ==================== */
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function attrNameRu(id) { const a = CH.attributes.find(x => x.id === id); return a ? L(a) : id; }
const AFFIX_TEXT = {
  attribute: a => `+${a.value} ${attrNameRu(a.stat)}`,
  skill: a => `+${a.value} · ${SKILL_BY_ID[a.stat] ? L(SKILL_BY_ID[a.stat]) : a.stat}`,
  resistance: a => t('affix.resistance', { v: a.value, el: t('label.element.' + a.stat) || a.stat }),
  damage: a => t('affix.damage', { v: a.value, el: t('label.element.' + a.stat) || a.stat }),
  vitality: a => t('affix.vitality', { v: a.value }),
  dodge: a => t('affix.dodge', { v: a.value }),
  crit: a => t('affix.crit', { v: a.value }),
  initiative: a => t('affix.initiative', { v: a.value }),
  movement: a => t('affix.movement', { v: a.value }),
  immunity: a => t('affix.immunity', { stat: t('label.immunity.' + a.stat) || a.stat }),
  special: a => a.name || a.value || '',
};
function affixText(a) {
  const fn = AFFIX_TEXT[a.kind];
  return fn ? fn(a) : (a.name || '');
}
// Tooltip helpers: in-game description + live computed line.
// `total` is the final attribute from computeFinal(): the live line counts every point above the
// 10 base — invested ×2 (Lone Wolf) and gear alike. The old `invested - 10` read the invested
// counter as if it already contained the base, so it was off by ten points (and ignored ×2).
function tooltipAttr(a, total) {
  const ru = state.lang === 'ru';
  const desc = ru ? a.tooltipDescRu : a.tooltipDescEn;
  const invested = Math.max(0, (total || a.base) - a.base);
  let live = '';
  if (invested > 0 && a.liveLineEn) {
    const tpl = ru ? a.liveLineRu : a.liveLineEn;
    live = tpl
      .replace('{dmg}', (a.liveDmg || 0) * invested)
      .replace('{carry}', (a.liveCarry || 0) * invested)
      .replace('{hp}', (a.liveHp || 0) * invested)
      .replace('{slots}', (a.liveSlots || 0) * invested)
      .replace('{crit}', (a.liveCrit || 0) * invested)
      .replace('{init}', (a.liveInit || 0) * invested);
  }
  return desc ? (live ? desc + '\n' + live : desc) : (live || '');
}
function tooltipSkill(id) {
  const s = SKILL_BY_ID[id];
  if (!s) return '';
  const ru = state.lang === 'ru';
  let desc = ru ? s.tooltipDescRu : s.tooltipDescEn;
  // Игровой плейсхолдер [1] — имя умения (так подставляет GUI); локаль RU оборачивает имя в кавычки сама.
  if (desc && desc.indexOf('[1]') >= 0) desc = desc.split('[1]').join(L(s));
  const effect = ru ? s.effectRu : s.effectEn;
  return [desc, effect].filter(Boolean).join('\n');
}
// Компактная строка механик гражданского умения — серый текст справа от названия (не в тултипе):
// воровство — лимиты кражи, торговля — цены, телекинез — дальность. Уровень эффективный
// (экипировка/раса). Чисел в данных игры нет — таблицы в mech, с полем source (fandom wiki).
function civilMechLine(s, ru) {
  const m = s.mech;
  if (!m) return '';
  const f = computeFinal();
  const lvl = Math.max(0, (f.civil && f.civil[s.id]) || 0);
  if (!lvl) return '';
  const line = (ru ? m.shortRu : m.shortEn) || '';
  // replace() меняет только первое вхождение — плейсхолдеры повторяются (цены: два {pct})
  const set = (txt, key, v) => txt.split(key).join(String(v));
  if (m.gold) {
    const i = Math.min(lvl, m.gold.length) - 1;
    return set(set(line, '{gold}', m.gold[i]), '{kg}', m.kg[i]);
  }
  if (m.pricePerPoint) return set(line, '{pct}', m.pricePerPoint * lvl);
  if (m.rangePerPoint) return set(line, '{m}', m.rangePerPoint * lvl);
  return '';
}
function tooltipTalent(name) {
  const tl = CH.talents.selectable.find(x => x.name === name) || CH.talents.racial.find(x => x.name === name) || CH.talents.questUnique.find(x => x.name === name);
  if (!tl) return '';
  const ru = state.lang === 'ru';
  const desc = ru ? tl.tooltipDescRu : tl.tooltipDescEn;
  const selected = state.talents.includes(name) || state.questTalents.includes(name);
  const effect = selected ? (ru ? tl.effectRu : tl.effect) : '';
  if (effect && desc && effect.replace(/[.。]$/, '') === desc.replace(/[.。]$/, '')) return desc;
  return desc ? (effect ? desc + '\n' + effect : desc) : (effect || '');
}
// Story origins (non-custom) have a hardcoded race in the game; keep state.race in sync.
function syncRaceToOrigin() {
  const o = CH.origins.find(x => x.id === state.origin);
  if (o && o.race) state.race = o.race;
}
// Rebuild a <select>'s options (works in the real DOM and the QA shim).
function rebuildSelect(sel, entries) {
  if (sel.options.length && sel.options.pop) { while (sel.options.length) sel.options.pop(); }
  else { sel.length = 0; }
  for (const [val, label] of entries) sel.insertAdjacentHTML('beforeend', `<option value="${val}">${esc(label)}</option>`);
}
// Sex of the custom-hero portrait: a 50/50 roll on every "custom" pick. A pure function,
// so QA injects its own rand and asserts both outcomes, not "about half of the calls".
function rollHeroSex(rand) { return ((rand || Math.random)() < 0.5) ? 'm' : 'f'; }
// Which portrait cell the current pick maps to: a story origin has its own icon, a custom
// hero gets the race icon in the sex that was rolled.
function heroIconId() {
  if (state.origin !== 'custom' && PORTRAITS[state.origin]) return state.origin;
  return state.race + '_' + (state.heroSex === 'f' ? 'f' : 'm');
}
// alt/title text: the character name, or "race · sex" (same localisation as the selects).
function heroPortraitName(id) {
  const p = PORTRAITS[id];
  if (!p) return id;
  if (p.kind === 'story') { const o = CH.origins.find(x => x.id === id); return o ? L(o) : id; }
  const r = CH.races.find(x => x.id === p.race);
  return (r ? L(r) : p.race) + ' · ' + t(p.sex === 'f' ? 'hero.female' : 'hero.male');
}
// The portrait reuses the item-icon trick (_iconMarkup): one sheet cell as the background,
// placed in pixels. 64 px is .hero-por's width in css — change the two together.
const HERO_POR_PX = 64;
const _portraitMarkup = (id) => {
  const cell = PORTRAIT_SPRITE && PORTRAIT_SPRITE.icons[id];
  if (!cell) return `<i class="hero-por hero-por-ph" role="img" aria-label="${esc(t('hero.portrait_none'))}">?</i>`;
  const [c, r] = cell;
  const [cw, ch] = PORTRAIT_SPRITE.cell;
  const k = HERO_POR_PX / cw;
  const name = heroPortraitName(id);
  return `<i class="hero-por" role="img" aria-label="${esc(t('hero.portrait_alt', { name }))}" title="${esc(name)}" ` +
    `style="background-image:url('${PORTRAIT_SPRITE.png}');` +
    `background-position:${-(c * cw * k)}px ${-(r * ch * k)}px;background-size:${PORTRAIT_SPRITE.w * k}px ${PORTRAIT_SPRITE.h * k}px"></i>`;
};
function renderOriginRace() {
  const oSel = $('#originSel'), rSel = $('#raceSel');
  if (oSel.options.length === 0 || oSel._lang !== state.lang) {
    oSel._lang = state.lang; rSel._lang = state.lang;
    rebuildSelect(oSel, CH.origins.map(o => [o.id, L(o)]));
    rebuildSelect(rSel, CH.races.map(r => [r.id, L(r)]));
  }
  const o = CH.origins.find(x => x.id === state.origin);
  // Story origins lock the race (hardcoded in the game); only "custom" allows a free choice.
  rSel.disabled = !!(o && o.race);
  oSel.value = state.origin;
  rSel.value = state.race;
  let html = o ? esc(TT(o, 'lore')) : '';
  if (state.race === 'undead') html += ' · ' + t('origin.undead_note');
  $('#originInfo').innerHTML = html;
  $('#heroPortrait').innerHTML = _portraitMarkup(heroIconId());
}
// Заметка и title-подсказка берут имя таланта из тех же данных, что и строка чекбокса: L() даёт
// официальное имя из пака (post-пасс build_data.js), поэтому подпись заметки и список талантов
// не могут разъехаться — именно так и родился прежний баг со «старым переводом». Эффект таланта
// — по очку в пул (pools()), а не уровни умений; pak uid — в комментарии _finalCivil.
function asuTalentName() {
  return L(CH.talents.selectable.find(x => x.name === 'All Skilled Up'));
}
const asuNote = (key) => esc(t(key, { talent: asuTalentName() }));
function renderLevelPools() {
  $('#levelRange').value = state.level;
  $('#levelOut').textContent = state.level;
  const p = pools();
  // Заметки ASU живут в секциях боя и гражданских (где очки тратятся), как у «Волка-одиночки»;
  // чип получает нативный title — объяснить, откуда в x/y взялось +1, не раздувая строку.
  const chip = (label, left, total, title) =>
    `<span class="pool"${title ? ` title="${title}"` : ''}>` +
      `<span class="pool-l">${label}</span>` +
      `<b class="pool-v${left === 0 ? ' zero' : ''}">${left < 0 ? `<span class="neg">${left}</span>` : left}<span class="tot">/${total}</span></b>` +
    `</span>`;
  $('#pools').innerHTML =
    `<span class="pool-row">` +
      chip(t('pool.attrs'), p.attrTotal - p.attrSpent, p.attrTotal) +
      chip(t('pool.combat'), p.combatTotal - p.combatSpent, p.combatTotal, p.asu ? asuNote('combat.asu_note') : '') +
      chip(t('pool.civil'), p.civilTotal - p.civilSpent, p.civilTotal, p.asu ? asuNote('civil.asu_note') : '') +
      chip(t('pool.talents'), p.talentPicks - state.talents.length, p.talentPicks) +
    `</span>`;
  $('#attrPool').textContent = `${p.attrTotal - p.attrSpent}`;
  $('#combatPool').textContent = `${p.combatTotal - p.combatSpent}`;
  $('#civilPool').textContent = `${p.civilTotal - p.civilSpent}`;
  $('#talentPool').textContent = `${p.talentPicks - state.talents.length}`;
}
// Shared row fragments for the attribute / combat / civil steppers.
const _gearCell = g => g !== 0 ? (g > 0 ? '+' + g : g) : '0';
function _stepperHtml(act, id, inv, cap, poolLeft, midCls, midText) {
  return `<div class="stepper">
    <button data-act="${act}" data-id="${id}" data-d="-1" ${inv <= 0 ? 'disabled' : ''}>−</button>
    <span class="cur${midCls ? ' ' + midCls : ''}">${midText}</span>
    <button data-act="${act}" data-id="${id}" data-d="1" ${(inv >= cap || poolLeft <= 0) ? 'disabled' : ''}>+</button>
  </div>`;
}
function renderAttrs() {
  const f = computeFinal(), p = pools();
  // Cap of invested points depends on Lone Wolf: 30 without it, 15 with it — both reach the same
  // 40 (the doubling is cap-bound, see attrInvCap). The bar below each row counts effective
  // points, so it is full at the cap either way, not at 50 % as a raw inv/30 would show.
  const maxInv = attrInvCap(p.lw);
  const capPts = LS_.attribute.cap - 10;
  // Заметка «Волк-одиночка» живёт здесь, а не в блоке «Уровень»: объясняет «×2» там, где он
  // стоит — над строками атрибутов.
  $('#attrNote').innerHTML = p.lw ? esc(t('attr.lw_note')) : '';
  let html = '';
  for (const a of CH.attributes) {
    const inv = state.attr[a.id], gear = f.gear.attr[a.id] || 0, total = f.attr[a.id];
    // Invested points can no longer pass the cap (the stepper blocks them, clampInvested legalises
    // saved builds), so the over-cap marker now flags what really can go over it: gear on top of 40.
    const doubled = p.lw && inv > 0, over = total > LS_.attribute.cap;
    html += `<div class="srow" title="${esc(tooltipAttr(a, total))}">
      <div class="nm">${L(a)}${over ? ` <span class="approx" title="${esc(t('final.over_cap'))}">⚠</span>` : ''}</div>
      <div class="val muted">10</div>
      <div class="val">${inv > 0 ? '+' + inv + (doubled ? '×2' : '') : '0'}</div>
      <div class="val gear">${_gearCell(gear)}</div>
      ${_stepperHtml('attr', a.id, inv, maxInv, p.attrTotal - p.attrSpent, 'total', total)}
    </div>
    <div class="capbar"><i style="width:${Math.min(100, (attrEff(p.lw, inv, a.base) / capPts) * 100)}%"></i></div>`;
  }
  $('#attrRows').innerHTML = html;
}
function skillRow(id, name, sub) {
  const f = computeFinal(), p = pools();
  const inv = state.combat[id] || 0, gear = f.gear.skill[id] || 0, eff = f.combat[id];
  const doubled = p.lw && id !== 'polymorph' && inv > 0;
  return `<div class="srow" title="${esc(tooltipSkill(id))}">
    <div class="nm">${name}${sub}</div>
    <div class="val muted">${inv}${doubled ? '×2' : ''}</div>
    <div class="val gear">${_gearCell(gear)}</div>
    <div class="val total">${eff}</div>
    ${_stepperHtml('combat', id, inv, combatInvCap(p.lw, id), p.combatTotal - p.combatSpent, '', '·')}
  </div>`;
}
function renderCombat() {
  // Заметки над строками секции (идеома «Волка-одиночки»): каждая объясняет то, что видно в
  // этих строках. LW и ASU легально совместимы — активные заметки идут списком, при пустом
  // списке строго '' (страж interactions и :empty-правило в css).
  const p = pools();
  const notes = [];
  if (p.lw) notes.push(esc(t('combat.lw_note')));
  if (p.asu) notes.push(asuNote('combat.asu_note'));
  $('#combatNote').innerHTML = notes.length ? notes.map(n => `<div>${n}</div>`).join('') : '';
  let html = '';
  for (const s of CH.combatAbilities.schools) {
    const sub = s.attribute ? ` <small>· ${attrNameRu(s.attribute).toLowerCase()}</small>` : '';
    html += skillRow(s.id, L(s), sub);
  }
  for (const s of CH.combatAbilities.weapon) html += skillRow(s.id, L(s), '');
  for (const s of CH.combatAbilities.defence) html += skillRow(s.id, L(s), '');
  $('#combatRows').innerHTML = html;
}
function renderCivil() {
  const f = computeFinal(), p = pools();
  // Заметка ASU — та же идиома, что attrNote/combatNote: объясняет +1 очко над строками,
  // где оно тратится; пустая скрыта :empty.
  $('#civilNote').innerHTML = p.asu ? `<div>${asuNote('civil.asu_note')}</div>` : '';
  let html = '';
  for (const s of CH.civilAbilities.list) {
    const inv = state.civil[s.id] || 0, gear = f.gear.skill[s.id] || 0, eff = f.civil[s.id];
    // Механики — серый <small> справа от названия (тот же идиом, что подстрока атрибута у боевых
    // умений); в тултипе их нет. Пусто при 0 уровне или отсутствии mech.
    const mech = civilMechLine(s, state.lang === 'ru');
    html += `<div class="srow" title="${esc(tooltipSkill(s.id))}">
      <div class="nm">${L(s)}${mech ? ` <small>· ${esc(mech)}</small>` : ''}</div>
      <div class="val muted">${inv}</div>
      <div class="val gear">${_gearCell(gear)}</div>
      <div class="val total">${eff}</div>
      ${_stepperHtml('civil', s.id, inv, LS_.civil.capEach, p.civilTotal - p.civilSpent, '', '·')}
    </div>`;
  }
  $('#civilRows').innerHTML = html;
}
// Секция «Навыки»: полоса бюджета памяти, чипы выбранных (по школам) и группа автовыданных.
// Крестик на чипе — тот же toggleSkill, что и клик по строке базы: автовыдаваемые он
// отсекает, поэтому снять их кликом нельзя.
// Иконка навыка — та же идиома, что у предмета (ячейка листа как фон, честная заглушка .ic-ph
// при отсутствии), но без рамки редкости: у навыков редкости нет. Позиция/размер фона —
// ПРОЦЕНТАМИ (классический sprite-приём для равномерной сетки): тогда размер показа задаёт
// CSS (.ic / .schip .ic / .d-icon.sk-icon), и мобильный слой или чип могут менять размер,
// не трогая разметку. Предметы остаются на пиксельной математике — их правки не касаются.
const _skillIconMarkup = (sk) => {
  if (SKILL_SPRITE && sk.icon) {
    const [c, r] = sk.icon;
    const [cw, ch] = SKILL_SPRITE.cell;
    // fx/fy — во сколько раз лист больше ячейки
    const fx = SKILL_SPRITE.w / cw, fy = SKILL_SPRITE.h / ch;
    return `<i class="ic" role="img" aria-label="${esc(t('items.icon_alt', { name: skillName(sk) }))}" style="background-image:url('${SKILL_SPRITE.png}');` +
      `background-size:${(fx * 100).toFixed(1)}% ${(fy * 100).toFixed(1)}%;` +
      `background-position:${((c / (fx - 1)) * 100).toFixed(4)}% ${((r / (fy - 1)) * 100).toFixed(4)}%"></i>`;
  }
  return `<i class="ic-ph" role="img" aria-label="${esc(t('items.icon_none'))}">?</i>`;
};
const _skillIconCell = (sk) => `<span class="i-icon" role="cell" title="${esc(sk.icon ? t('items.icon_alt', { name: skillName(sk) }) : t('items.icon_none'))}">${_skillIconMarkup(sk)}</span>`;
function _skillChip(sk) {
  // мини-иконка в чипе (решение пользователя после челенджа: судья хотел чипы без иконок,
  // но различимость навыка в секции побеждает); 18px — размер задаёт CSS, математика фона
  // процентная, поэтому в высоту чипа иконка вписывается
  // data-skill — карточка навыка по наведению (тот же skillCardHtml, что в панели);
  // подсказка «снять» — на крестике, чтобы нативный title не налезал на карточку
  return `<button class="schip" type="button" data-rm="${esc(sk.stat)}" data-skill="${esc(sk.stat)}">` +
    `${_skillIconMarkup(sk)}${esc(skillName(sk))}<span class="x" aria-hidden="true" title="${esc(t('skills.remove'))}">✕</span></button>`;
}
function renderSkills() {
  const f = computeFinal();
  const p = memPool(f);
  const bar = $('#memBar');
  if (bar) {
    const pct = p.total > 0 ? Math.min(100, Math.round(p.spent / p.total * 100)) : 0;
    bar.innerHTML = `<div class="membar${p.left <= 0 ? ' full' : ''}" role="progressbar" ` +
      `aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.spent}" ` +
      `title="${esc(t('skills.mem_tip', { spent: p.spent, total: p.total }))}">` +
      `<span class="membar-fill" style="width:${pct}%"></span>` +
      `<span class="membar-txt">${p.spent} / ${p.total}</span></div>`;
  }
  const host = $('#skillRows');
  if (host) {
    const chosen = selectedSkills();
    const picked = chosen.filter(sk => !isAutoSkill(sk));
    const auto = chosen.filter(isAutoSkill);
    const bySchool = new Map();
    for (const sk of picked) { if (!bySchool.has(sk.school)) bySchool.set(sk.school, []); bySchool.get(sk.school).push(sk); }
    let html = '';
    for (const [id, list] of bySchool) {
      html += `<div class="schip-group"><div class="schip-school">${esc(schoolLabel(id))}</div>` +
        `<div class="chips">${list.map(_skillChip).join('')}</div></div>`;
    }
    if (!picked.length) html += `<div class="muted small">${esc(t('skills.none'))}</div>`;
    if (auto.length) {
      html += `<h3 class="sub">${esc(t('sk.auto_group'))}</h3><div class="chips">` +
        auto.map(sk => `<span class="schip auto" data-skill="${esc(sk.stat)}" title="${esc(t('sk.auto_badge'))}">${_skillIconMarkup(sk)}${esc(skillName(sk))}</span>`).join('') +
        '</div>';
    }
    host.innerHTML = html;
  }
  // снятые pruneSkills() не должны исчезать молча (тот же приём, что у пула талантов)
  const note = $('#skillsPruned');
  if (note) {
    const names = _skillsPruned.map(st => (SKILL_BY_STAT[st] ? skillName(SKILL_BY_STAT[st]) : st));
    note.innerHTML = names.length ? `<div class="affix bad">⚠ ${esc(t('skills.pruned', { list: names.join(', ') }))}</div>` : '';
  }
}
// Sub-renderers for renderTalents(): selectable, quest-unique, and racial talents.
function _talentSelectable(p) {
  let html = '';
  for (const tl of CH.talents.selectable) {
    const selected = state.talents.includes(tl.name);
    const okPrereq = talentPrereqMet(tl);
    const conflict = tl.conflicts && tl.conflicts.some(c => state.talents.includes(c));
    const overPicks = !selected && state.talents.length >= p.talentPicks;
    const blocked = !okPrereq || conflict || overPicks;
    let why = '';
    if (!okPrereq && tl.prerequisite) why = t('talent.need', { p: esc(prereqText(tl)) });
    else if (conflict) why = t('talent.conflict');
    else if (overPicks) why = t('talent.no_slots');
    html += `<label class="trow ${blocked ? 'disabled' : ''}" title="${esc(tooltipTalent(tl.name))}">
      <input type="checkbox" data-talent="${esc(tl.name)}" ${selected ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
      <div><span class="tnm">${esc(L(tl))}</span>${why ? `<span class="why">${why}</span>` : ''}
      <div class="teff">${esc(TT(tl, 'effect'))}</div></div></label>`;
  }
  return html;
}
function _talentQuest() {
  let qh = '';
  for (const tl of CH.talents.questUnique) {
    const sel = state.questTalents.includes(tl.name);
    const allowed = questTalentAllowed(tl);
    const why = allowed ? '' : t('talent.only_origin', { o: esc(originNameRu(tl.origin)) });
    qh += `<label class="trow ${allowed ? '' : 'disabled'}" title="${esc(tooltipTalent(tl.name))}"><input type="checkbox" data-quest="${esc(tl.name)}" ${sel ? 'checked' : ''} ${allowed ? '' : 'disabled'}>
      <div><span class="tnm">${esc(L(tl))}</span>${why ? `<span class="why">${why}</span>` : ''}<div class="teff">${esc(TT(tl, 'effect'))} · ${esc(TT(tl, 'source'))}</div></div></label>`;
    if (tl.name === "Spider's Kiss" && tl.visions) {
      const opts = tl.visions.map(v => `<option value="${v.id}" ${state.spiderKissVision === v.id ? 'selected' : ''}>${esc(state.lang === 'ru' ? (v.labelRu || v.label) : v.label)}</option>`).join('');
      qh += `<div class="skk-vision"><span class="muted small">${t('talent.vision_label')}</span>
        <select id="spiderKissVision" ${sel ? '' : 'disabled'} title="${t('talent.vision_title')}">${opts}</select></div>`;
    }
  }
  return qh;
}
function _talentRacial() {
  const r = CH.races.find(x => x.id === state.race);
  let rh = '';
  if (r) for (const t of r.talents) rh += `<div class="trow" style="cursor:default" title="${esc(tooltipTalent(t.name))}">
    <div><span class="tnm">${esc(L(t))}</span><div class="teff">${esc(TT(t, 'effect'))}</div></div></div>`;
  return rh || '<span class="muted small">—</span>';
}
function renderTalents() {
  const p = pools();
  $('#talentRows').innerHTML = _talentSelectable(p);
  $('#questTalentRows').innerHTML = _talentQuest();
  $('#racialTalentRows').innerHTML = _talentRacial();
}
function renderEquip() {
  hideHoverCard(); // re-rendered rows invalidate any open hover preview
  let html = '';
  for (const [key, labelKey] of EQUIP_SLOTS) {
    const id = state.equipment[key];
    const it = id ? itemById(id) : null;
    html += `<div class="erow">
      <span class="slot">${t(labelKey)}</span>
      <span class="ewear">
        ${it ? `<span class="item r-${it.rarity}" data-open="${esc(it.id)}">${esc(itemName(it))} <small class="muted">${t('items.level', { n: it.level != null ? it.level : '?' })}</small></span><button class="xbtn" data-uneq="${key}" type="button" title="${t('equipment.unequip_title')}">✕</button>` : '<span class="muted" style="opacity:.35">—</span>'}
      </span>
      <button class="spick" data-pick="${key}" type="button" title="${t('equipment.pick_slot', { slot: t(labelKey) })}">⚔</button>
    </div>`;
  }
  $('#equipRows').innerHTML = html;
  // Сумки в секции больше нет: в базе нет предметов без слота (slot === 'none'),
  // класть нечего. state.bag живёт только ради импорта старых сохранений.
}
// Sub-renderers for renderDerived(): derived stats, each placed in the section it derives from.
const _fl = (l, v, approx) => approx
  ? `<div class="fline"><span class="fl" title="${t('final.approx_title')}">${l}</span><span class="fv"><b>${v}</b></span></div>`
  : `<div class="fline"><span class="fl">${l}</span><span class="fv"><b>${v}</b></span></div>`;
// Attribute-derived: HP/armors from Constitution, initiative from Wits, carry from Str, memory slots from Memory.
function _finalVitality(f) {
  return `<div class="fblock"><div class="bt">${t('final.vitality_block')}</div>`
    + _fl(t('final.hp'), f.hp, true) + _fl(t('final.p_armor'), f.pA) + _fl(t('final.m_armor'), f.mA) + '</div>';
}
function _finalMobility(f) {
  return `<div class="fblock"><div class="bt">${t('final.mobility_block')}</div>`
    + _fl(t('final.initiative'), f.init) + _fl(t('final.move'), f.move)
    + _fl(t('final.ap'), f.ap) + _fl(t('final.mem'), f.mem)
    + _fl(t('final.carry'), f.carry) + '</div>';
}
// Combat-derived: crit/dodge/accuracy from wits, combat skills and talents; damage previews from schools and weapon skills.
function _finalCombatStats(f) {
  return `<div class="fblock"><div class="bt">${t('final.combat_stats_block')}</div>`
    + _fl(t('final.crit_chance'), f.crit + '%', true) + _fl(t('final.dodge'), f.dodge + '%', true)
    + _fl(t('final.crit_mult'), f.critMult + '%')
    + _fl(t('final.accuracy'), f.accuracy + '%') + '</div>';
}
// Resistances and elemental damage bonuses are gear/race-derived, but they read as
// character stats — so they close the Attributes block (bottom of #attrDerived).
function _finalResist(f) {
  let h = `<div class="fblock"><div class="bt">${t('final.resist_block')}</div><div class="reschips">`;
  for (const k of RES_KEYS) {
    const v = f.res[k] || 0;
    h += `<span class="chip ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${t('label.element.' + k)} ${v > 0 ? '+' : ''}${v}%</span>`;
  }
  h += '</div></div>';
  const dmgChips = RES_KEYS.map(k => (f.dmg[k] || 0) ? `<span class="chip pos">+${f.dmg[k]}% ${t('label.element.' + k)}</span>` : '').join('');
  if (dmgChips) h += `<div class="fblock"><div class="bt">${t('final.dmg_bonus_block')}</div><div class="reschips">${dmgChips}</div></div>`;
  return h;
}
function _finalDamage(f) {
  const dmgPreview = typeof calcWeaponDamage === 'function' ? calcWeaponDamage(state, f) : null;
  const est = dmgPreview && Number.isFinite(dmgPreview.estimatedDmg) ? Math.round(dmgPreview.estimatedDmg) : null;
  const dmgTip = t('final.dmg_tip');
  if (est != null) {
    return `<div class="fblock"><div class="bt" title="${dmgTip}">${t('final.dmg_title')}</div>`
      + `<div style="font-size:22px;color:var(--gold);font-weight:600;margin:4px 0">${est}</div>`
      + `<div class="muted small">${t('final.dmg_base', { base: Math.round(dmgPreview.baseDmg), el: dmgPreview.elementMult, as: dmgPreview.attrSkillMult })}</div></div>`;
  }
  return `<div class="fblock"><div class="bt" title="${dmgTip}">${t('final.dmg_title')}</div><div class="muted small">${t('final.dmg_no_data')}</div></div>`;
}
function _finalSpells(f) {
  if (typeof calcSpellDamage !== 'function') return '';
  const SCHOOLS = ['pyrokinetic', 'hydrosophist', 'aerotheurge', 'geomancer', 'necromancer'];
  const rows = SCHOOLS.filter(id => (state.combat[id] || 0) > 0).map(id => {
    const sp = calcSpellDamage(state, f, id);
    return sp ? `<div class="muted small" style="margin:2px 0">${L(SKILL_BY_ID[id])}: <b style="color:var(--gold)">${sp.estimatedDmg}</b> <span class="muted">(×${sp.mult})</span></div>` : '';
  }).filter(Boolean);
  return rows.length ? `<div class="fblock"><div class="bt" title="${t('final.spell_tip')}">${t('final.spell_title')}</div>${rows.join('')}</div>` : '';
}
// Granted skills are no longer summarised here: the Skills section lists every skill the
// gear grants, so a counter in the equipment block was a duplicate.
function renderDerived() {
  const f = computeFinal();
  $('#attrDerived').innerHTML = _finalVitality(f) + _finalMobility(f) + _finalResist(f);
  $('#combatDerived').innerHTML = _finalCombatStats(f) + _finalDamage(f) + _finalSpells(f);
}
/* ==================== 7. Filter & item DB ==================== */
let selId = null;
let _filterLang = null;
// Toggling Lone Wolf can leave invested points that are no longer legal: 30 in Strength was fine
// without the talent, but with it the 15th point already reaches the 40 cap and the rest buy
// nothing. Clamp them back to the cap — the freed points need no bookkeeping, the pool is derived
// from what is invested, so they reappear in «Уровень» by themselves. This legalises builds saved
// before the cap was fixed, and every later toggle in both directions.
function clampInvested() {
  const lw = state.talents.includes('Lone Wolf');
  for (const a of CH.attributes) {
    const cap = attrInvCap(lw, a.base);
    if ((state.attr[a.id] || 0) > cap) state.attr[a.id] = cap;
  }
  for (const id of COMBAT_IDS) {
    const cap = combatInvCap(lw, id);
    if ((state.combat[id] || 0) > cap) state.combat[id] = cap;
  }
}
function afterChange() {
  clampInvested();
  pruneQuestTalents();
  normalizeSkkVision();
  syncRaceToOrigin();
  enforceTwoHanded();
  const _f = computeFinal();
  syncAutoSkills(_f);
  _skillsPruned = pruneSkills(_f);
  save();
  if (_filterLang !== state.lang) { _filterLang = state.lang; rebuildFilterSelects(); rebuildSkillSelects(); }
  renderOriginRace();
  renderLevelPools();
  renderAttrs();
  renderCombat();
  renderCivil();
  renderSkills();
  renderTalents();
  renderEquip();
  renderDerived();
  renderDB();
  renderSkillDb();
  renderDetail();
  applyI18n();
}
let filter = { q: '', rarity: '', slot: '', area: '', level: '', skill: false, coords: false, de: false };
// Areas of the data set are the four top-level areas plus a "game-wide …" marker for
// random loot. Derived from the data (not hardcoded) so a new area shows up as a filter
// option by itself; ordered by act, then by name.
const AREA_ORDER = ['Fort Joy', "Reaper's Coast", 'Arx', 'Nameless Isle'];
const areaKeys = () => {
  const seen = new Map();
  for (const it of ITEMS) {
    const a = it.location.area;
    if (!a) continue;
    if (!seen.has(a)) seen.set(a, it.location.act ?? 9);
  }
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1] || (AREA_ORDER.indexOf(a[0]) < 0 ? 99 : AREA_ORDER.indexOf(a[0])) - (AREA_ORDER.indexOf(b[0]) < 0 ? 99 : AREA_ORDER.indexOf(b[0])) || a[0].localeCompare(b[0]))
    .map(e => e[0]);
};
// Area → label. Unknown or already-localized strings (the forge writes t('generator.forge_area'),
// whose slug is empty for Cyrillic) pass through — i18next returns the key itself on misses.
const areaLabel = (a) => {
  if (/^game-wide/i.test(a)) return t('label.area.game_wide');
  const k = a.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  if (!k) return a;
  const key = 'label.area.' + k, v = t(key);
  return v === key ? a : v;
};
const levelKeys = () => [...new Set(ITEMS.map(it => it.level).filter(v => v != null))].sort((a, b) => a - b);
function rebuildFilterSelects() {
  const fR = $('#fRarity'), fS = $('#fSlot'), fW = $('#fWeaponType'), fAr = $('#fArea'), fL = $('#fLevel'), gS = $('#gSlot'), gW = $('#gWeaponType'), gT = $('#gTier');
  const saved = { fR: fR.value, fS: fS.value, fW: fW.value, fAr: fAr.value, fL: fL.value, gS: gS.value, gW: gW.value, gT: gT.value };
  rebuildSelect(fR, [['', t('db.rarity_all')]].concat(['common','uncommon','rare','epic','legendary','divine','unique'].map(r => [r, t('label.rarity.' + r) || r])));
  rebuildSelect(fS, [['', t('db.slot_all')]].concat(ITEM_SLOT_KEYS.map(k => [k, t('label.slot.' + k) || k])));
  rebuildSelect(fW, [['', t('db.weapon_type_all')]].concat(WEAPON_TYPE_KEYS.map(k => [k, t('label.weapon_type.' + k) || k])));
  rebuildSelect(fAr, [['', t('db.area_all')]].concat(areaKeys().map(a => [a, areaLabel(a)])));
  rebuildSelect(fL, [['', t('db.level_all')]].concat(levelKeys().map(l => [String(l), t('db.level_max', { n: l })])));
  rebuildSelect(gS, ['weapon','shield','helmet','chest','leggings','gloves','boots','belt','ring','amulet'].map(k => [k, (k === 'weapon' || k === 'shield') ? (t('label.type.' + k) || k) : (t('label.slot.' + k) || k)]));
  rebuildSelect(gW, WEAPON_TYPE_KEYS.map(k => [k, t('label.weapon_type.' + k) || k]));
  rebuildSelect(gT, Object.entries(D.rolls.tierRollCounts).map(([tr, n]) => [tr, t('label.rarity.' + tr) || tr + ' (' + t('generator.tier_rolls', { n }) + ')']));
  fR.value = saved.fR; fS.value = saved.fS; fW.value = saved.fW; fAr.value = saved.fAr; fL.value = saved.fL; gS.value = saved.gS || 'weapon'; gW.value = saved.gW || 'sword'; gT.value = saved.gT || 'divine';
  syncWeaponTypeFilter();
  syncForgeWeaponType();
}
function syncWeaponTypeFilter() {
  const on = $('#fSlot').value === 'main_hand';
  const el = $('#fWeaponType');
  el.style.display = on ? '' : 'none';
  if (!on && el.value) { el.value = ''; readFilters(); renderDB(); }
}
function syncForgeWeaponType() {
  const on = $('#gSlot').value === 'weapon';
  const el = $('#gWeaponType');
  el.style.display = on ? '' : 'none';
  if (!on) el.value = 'sword';
}
function initFilters() {
  rebuildFilterSelects();
}
function readFilters() {
  filter = {
    q: $('#searchBox').value.trim().toLowerCase(),
    rarity: $('#fRarity').value, slot: $('#fSlot').value, weaponType: $('#fWeaponType').value,
    area: $('#fArea').value, level: $('#fLevel').value,
    skill: $('#fSkill').checked, coords: $('#fCoords').checked, de: $('#fDe').checked
  };
}
// Filter predicates: key -> (item, value) => matches. Applied only when the key is set.
const FILTER_PREDICATES = {
  rarity: (it, v) => it.rarity === v,
  slot: (it, v) => it.slot === v,
  weaponType: (it, v) => it.weaponType === v,
  // area is a proper noun kept verbatim in the data; level means "usable at level <= v",
  // so items whose level is unknown are excluded on purpose (an unknown level is not "low").
  area: (it, v) => it.location.area === v,
  level: (it, v) => it.level != null && it.level <= Number(v),
  skill: (it, v) => !!it.grantedSkill,
  coords: (it, v) => !!it.location.coordinates,
  de: (it, v) => !!it.deOnly,
};
function applyFilters() {
  return ITEMS.filter(it => {
    for (const [k, pred] of Object.entries(FILTER_PREDICATES)) {
      if (filter[k] && !pred(it, filter[k])) return false;
    }
    if (filter.q) {
      // Search by EN name AND official RU name (UI shows RU names, so RU search must work too).
      const ruName = (D.ru && D.ru[it.name]) || '';
      const hay = (it.name + ' ' + ruName + ' ' + (it.location.area || '') + ' ' + (it.grantedSkill || '') + ' ' + it.type + ' ' + (it.location.detail || '')).toLowerCase();
      if (!hay.includes(filter.q)) return false;
    }
    return true;
  });
}
// Clear every filter control and re-render the list.
function resetFilters() {
  $('#searchBox').value = ''; $('#fRarity').value = ''; $('#fSlot').value = ''; $('#fWeaponType').value = '';
  $('#fArea').value = ''; $('#fLevel').value = '';
  $('#fSkill').checked = $('#fCoords').checked = $('#fDe').checked = false;
  state.sort = { key: '', dir: 1 };
  save();
  syncWeaponTypeFilter();
  readFilters(); renderDB();
}
// Column sort: clicking a header cycles ascending → descending → natural order.
// A comparator returns the sortable value; null/undefined always sinks to the bottom.
const SORT_VALUE = {
  name: it => itemName(it),
  type: it => t('label.type.' + it.type) || it.type,
  level: it => it.level,
  price: it => (it.value == null ? null : it.value),
  skill: it => it.grantedSkill ? skillLabel(it.grantedSkill) : null,
};
const SORT_KEYS = ['name', 'type', 'level', 'price', 'skill'];
function sortItems(list) {
  const s = state.sort || {};
  const get = SORT_VALUE[s.key];
  if (!get) return list;
  const loc = state.lang === 'ru' ? 'ru' : 'en';
  const cmpStr = (a, b) => String(a).localeCompare(String(b), loc);
  return [...list].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (va == null && vb == null) return cmpStr(itemName(a), itemName(b));
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : cmpStr(va, vb);
    return (c * (s.dir === -1 ? -1 : 1)) || cmpStr(itemName(a), itemName(b));
  });
}
// Click handler for the column headers (three-state: asc → desc → unsorted).
function toggleSort(key) {
  if (!SORT_VALUE[key]) return;
  const s = state.sort || { key: '', dir: 1 };
  state.sort = s.key !== key ? { key, dir: 1 }
    : s.dir === 1 ? { key, dir: -1 }
    : { key: '', dir: 1 };
  save(); renderDB();
}
// Icon markup for one item. With a game icon: a <i> whose background is the sprite cell
// (background-position/-size are pixel-exact: cells are cell[0]×cell[1], px scales the sheet).
// Without one: a deterministic placeholder — a dashed slot painted in the rarity colour with
// a '?'. It is honest about the absence (no invented pixels) and stable across reloads.
const _iconMarkup = (it, px) => {
  if (ICON_SPRITE && it.icon) {
    const [c, r] = it.icon.cell;
    const [cw, ch] = ICON_SPRITE.cell;
    const k = px / cw;
    return `<i class="ic r-${it.rarity}" role="img" aria-label="${esc(t('items.icon_alt', { name: itemName(it) }))}" style="background-image:url('${ICON_SPRITE.png}');` +
      `background-position:${-(c * cw * k)}px ${-(r * ch * k)}px;background-size:${ICON_SPRITE.w * k}px ${ICON_SPRITE.h * k}px"></i>`;
  }
  return `<i class="ic ic-ph r-${it.rarity}" role="img" aria-label="${esc(t('items.icon_none'))}">?</i>`;
};
const _iconCell = (it) => `<span class="i-icon" role="cell" title="${esc(it.icon ? t('items.icon_alt', { name: itemName(it) }) : t('items.icon_none'))}">${_iconMarkup(it, 21)}</span>`;
// Header row: one button per column, arrow + aria-sort on the active one.
// The first cell is the icon column — a plain label: icons are never sortable.
function _itemHead() {
  const s = state.sort || { key: '' };
  // первая ячейка — колонка иконок: пустой заглушка-заголовок (в 26px «Иконка» обрезалась в «И…»)
  const iconHead = '<span class="ih ih-icon" role="columnheader"></span>';
  return iconHead + SORT_KEYS.map(k => {
    const on = s.key === k, dir1 = s.dir !== -1;
    return `<button class="ih${on ? ' active' : ''}" type="button" data-sort="${k}" role="columnheader" ` +
      `aria-sort="${on ? (dir1 ? 'ascending' : 'descending') : 'none'}" ` +
      `title="${esc(t('db.sort_hint'))}">${esc(t('db.col.' + k))}<span class="ar" aria-hidden="true">${on ? (dir1 ? '▲' : '▼') : ''}</span></button>`;
  }).join('');
}
function renderDB() {
  const list = sortItems(applyFilters());
  const head = $('#itemHead');
  if (head) head.innerHTML = _itemHead();
  let html = '';
  for (const it of list) {
    // В тултипе — локализованное имя, а не EN-оригинал: вторая языковая копия имени уже
    // убрана из интерфейса (решение f25172c), а подсказка остаётся только затем, чтобы
    // читалось имя, обрезанное многоточием в узкой колонке.
    html += `<div class="item-row ${it.id === selId ? 'selected' : ''}" data-open="${esc(it.id)}" role="row">
      ${_iconCell(it)}
      <span class="i-name r-${it.rarity}" role="cell" title="${esc(itemName(it))}">${esc(itemName(it))}${it.deOnly ? ' <span class="i-de">DE</span>' : ''}</span>
      <span class="i-type" role="cell">${t('label.type.' + it.type) || it.type}</span>
      <span class="i-lvl" role="cell">${it.level != null ? t('items.level', { n: it.level }) : '—'}</span>
      <span class="i-price" role="cell">${it.value != null ? it.value : '—'}</span>
      <span class="i-skill" role="cell">${it.grantedSkill ? '✦ ' + skillLabel(it.grantedSkill) : ''}</span>
    </div>`;
  }
  $('#itemList').innerHTML = html || `<div style="padding:16px;grid-column:1/-1" class="muted">${t('db.empty')}</div>`;
  $('#dbCount').textContent = `${list.length} / ${ITEMS.length}`;
}
/* ==================== 8b. База навыков (drawer, pane=skills) ================== */
// Второй список выезжающей панели: подбор изучаемых навыков. Фильтры и сортировка
// повторяют базу предметов — тот же жест (три состояния у шапки колонки) и та же
// разметка строки (.item-row), поэтому мобильная сетка наследуется.
const SKILL_TIERS = ['starter', 'novice', 'adept', 'master'];
const SKILL_SRCS = ['book', 'crafted', 'source', 'racial', 'origin', 'weapon'];
const SKILL_SORT_KEYS = ['name', 'school', 'tier', 'mem', 'ap', 'srccost', 'src'];
// id школ/оружия/гражданских — подписи из character.json (L()); 'source' и 'special'
// в ней нет, они подписаны i18n-ключами sk.school.*.
const SKILL_LABELS_BY_ID = {};
for (const s of [].concat(CH.combatAbilities.schools, CH.combatAbilities.weapon, CH.combatAbilities.defence, CH.civilAbilities.list)) SKILL_LABELS_BY_ID[s.id] = s;
let skFilter = { q: '', school: '', tier: '', mem: '', src: '', avail: false };
let skSort = { key: '', dir: 1 };
const skillName = sk => (state.lang === 'ru' && sk.nameRu) ? sk.nameRu : sk.name;
const schoolLabel = id => SKILL_LABELS_BY_ID[id] ? L(SKILL_LABELS_BY_ID[id]) : t('sk.school.' + id);
const srcLabel = src => t('sk.src.' + src);
const tierLabel = tier => tier ? t('sk.tier.' + tier) : '—';
// missing из skillAllowed («warfare 2» / «lvl 13») → человекочитаемая причина
function skillMissingText(missing) {
  return (missing || []).map(m => {
    const mm = /^(\S+)\s+(\d+)$/.exec(m) || [];
    return mm[1] === 'lvl' ? t('sk.need_level', { n: mm[2] }) : t('sk.need_school', { s: schoolLabel(mm[1]), n: mm[2] });
  }).join(', ');
}
const memDots = n => (n > 0 ? '●'.repeat(n) : '—');
function readSkillFilters() {
  skFilter = {
    q: $('#skSearch').value.trim().toLowerCase(),
    school: $('#skSchool').value, tier: $('#skTier').value,
    mem: $('#skMem').value, src: $('#skSrc').value,
    avail: $('#skAvail').checked
  };
}
function resetSkillFilters() {
  $('#skSearch').value = ''; $('#skSchool').value = ''; $('#skTier').value = '';
  $('#skMem').value = ''; $('#skSrc').value = ''; $('#skAvail').checked = false;
  readSkillFilters();
  renderSkillDb();
}
// Опции фильтров пересобираются при смене языка (как rebuildFilterSelects), выбор сохраняется.
function rebuildSkillSelects() {
  const sS = $('#skSchool'), sT = $('#skTier'), sM = $('#skMem'), sR = $('#skSrc');
  const saved = { sS: sS.value, sT: sT.value, sM: sM.value, sR: sR.value };
  const schoolIds = [...new Set(SKILLS.map(sk => sk.school))];
  rebuildSelect(sS, [['', t('sk.school_all')]].concat(schoolIds.map(id => [id, schoolLabel(id)])));
  rebuildSelect(sT, [['', t('sk.tier_all')]].concat(SKILL_TIERS.map(v => [v, tierLabel(v)])));
  rebuildSelect(sM, [['', t('sk.mem_all')]].concat([0, 1, 2, 3].map(v => [String(v), memDots(v)])));
  rebuildSelect(sR, [['', t('sk.src_all')]].concat(SKILL_SRCS.map(v => [v, srcLabel(v)])));
  sS.value = saved.sS; sT.value = saved.sT; sM.value = saved.sM; sR.value = saved.sR;
}
const SKILL_FILTER_PREDICATES = {
  school: (sk, v) => sk.school === v,
  tier: (sk, v) => sk.tier === v,
  mem: (sk, v) => sk.mem === Number(v),
  src: (sk, v) => sk.src === v,
};
function applySkillFilters(f, mp) {
  const q = skFilter.q;
  return SKILLS.filter(sk => {
    // «Доступные сейчас» (design 2026-11-07 §3.1) — отдельная ветка, не предикат-мапа:
    // boolean ломает контракт `!== ''`. Условия = ровно гейт toggleSkill, «показано ⇒ кликабельно»:
    // изучаемый вручную (не автовыдаваемый), не выбран, гейт школ/уровня выполнен, память влезает.
    if (skFilter.avail) {
      if (isAutoSkill(sk)) return false;
      if (state.skills.indexOf(sk.stat) >= 0) return false;
      if (!skillAllowed(sk, f).ok) return false;
      if (sk.mem > mp.left) return false;
    }
    for (const [k, pred] of Object.entries(SKILL_FILTER_PREDICATES)) {
      if (skFilter[k] !== '' && !pred(sk, skFilter[k])) return false;
    }
    if (q) {
      const hay = [sk.name, sk.nameRu || '', schoolLabel(sk.school), srcLabel(sk.src)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
const SKILL_SORT_VALUE = {
  name: sk => skillName(sk),
  school: sk => schoolLabel(sk.school),
  // тир — порядок игры (starter → master), а не алфавит; автовыдаемые без тира — в конец
  tier: sk => (sk.tier ? SKILL_TIERS.indexOf(sk.tier) : -1),
  mem: sk => sk.mem,
  // стоимость — числа (design 2026-11-06: в data-таблице числа, иконочный язык остаётся в карточке)
  ap: sk => sk.apCost || 0,
  srccost: sk => sk.srcCost || 0,
  src: sk => srcLabel(sk.src),
};
function sortSkills(list) {
  const get = SKILL_SORT_VALUE[skSort.key];
  if (!get) return list;
  const loc = state.lang === 'ru' ? 'ru' : 'en';
  const cmpStr = (a, b) => String(a).localeCompare(String(b), loc);
  return [...list].sort((a, b) => {
    const va = get(a), vb = get(b);
    const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : cmpStr(va, vb);
    return (c * (skSort.dir === -1 ? -1 : 1)) || cmpStr(skillName(a), skillName(b));
  });
}
// Три состояния, как у базы предметов: возр. → убыв. → без сортировки.
function toggleSkillSort(key) {
  if (!SKILL_SORT_VALUE[key]) return;
  skSort = skSort.key !== key ? { key, dir: 1 }
    : skSort.dir === 1 ? { key, dir: -1 }
    : { key: '', dir: 1 };
  renderSkillDb();
}
function _skillHead() {
  // первая ячейка — колонка иконок: пустой заголовок-заглушка (в 26px колонке «Иконка»
  // обрезалась бы в «И…»; та же заглушка в _itemHead — таблицы остаются одной системой)
  return `<span class="ih ih-icon" role="columnheader"></span>` +
    SKILL_SORT_KEYS.map(k => {
    const on = skSort.key === k, dir1 = skSort.dir !== -1;
    return `<button class="ih${on ? ' active' : ''}" type="button" data-sort="${k}" role="columnheader" ` +
      `aria-sort="${on ? (dir1 ? 'ascending' : 'descending') : 'none'}" ` +
      `title="${esc(t('db.sort_hint'))}">${esc(t('sk.col.' + k))}<span class="ar" aria-hidden="true">${on ? (dir1 ? '▲' : '▼') : ''}</span></button>`;
  }).join('');
}
// Подпись источника: у Source-тренера виден уровень персонажа (13/16/20), у книги —
// просто «книга»: сам SKILLBOOK_* — служебное имя стата, оно в карточке навыка.
const skillSrcText = sk => srcLabel(sk.src) + (sk.src === 'source' && (sk.lvl || 1) > 1 ? ' ' + sk.lvl : '');
function renderSkillDb() {
  const host = $('#skillList');
  if (!host) return;
  // f и mp — до фильтрации: ветке «доступные сейчас» нужны финальные школы и бюджет памяти (r1-B1)
  const f = computeFinal();
  const mp = memPool(f);
  const list = sortSkills(applySkillFilters(f, mp));
  const head = $('#skillHead');
  if (head) head.innerHTML = _skillHead();
  let html = '';
  for (const sk of list) {
    const on = state.skills.indexOf(sk.stat) >= 0;
    const auto = isAutoSkill(sk);
    const a = skillAllowed(sk, f);
    const locked = !auto && !a.ok;
    const cls = 'item-row' + (on ? ' selected' : '') + (auto ? ' auto' : '') + (locked ? ' disabled' : '');
    html += `<div class="${cls}" data-skill="${esc(sk.stat)}" role="row"${locked ? ` aria-disabled="true" title="${esc(t('sk.locked', { what: skillMissingText(a.missing) }))}"` : ''}>
      ${_skillIconCell(sk)}
      <span class="i-name" role="cell" title="${esc(skillName(sk))}">${esc(skillName(sk))}${auto ? ` <span class="s-auto" title="${esc(t('sk.auto_badge'))}">✦</span>` : ''}</span>
      <span class="s-school" role="cell">${esc(schoolLabel(sk.school))}</span>
      <span class="s-tier" role="cell">${esc(tierLabel(sk.tier))}</span>
      <span class="s-mem" role="cell" title="${esc(t('sk.mem_n', { n: sk.mem }))}">${sk.mem > 0 ? memDots(sk.mem) : '<span class="z">—</span>'}</span>
      <span class="s-ap" role="cell" title="${esc(t('sk.ap_n', { n: sk.apCost || 0 }))}">${sk.apCost || '<span class="z">—</span>'}</span>
      <span class="s-sp" role="cell" title="${esc(t('sk.src_cost', { n: sk.srcCost || 0 }))}">${sk.srcCost || '<span class="z">—</span>'}</span>
      <span class="s-src" role="cell" title="${esc(skillSrcText(sk))}">${esc(skillSrcText(sk))}</span>
    </div>`;
  }
  host.innerHTML = html || `<div style="padding:16px;grid-column:1/-1" class="muted">${t(skFilter.avail ? 'sk.avail_empty' : 'sk.empty')}</div>`;
  const cnt = $('#skCount');
  if (cnt) cnt.textContent = `${list.length} / ${SKILLS.length}`;
}
// Карточка навыка по наведению: стоимость — пипсами под заголовком (оригинальные иконки
// игры: медальон=память, зелёное ядро=очки действия, фасетчатый ромб=исток; чисел в визуале
// нет, количество ≤4 читается субитайзингом, каждая группа подписана словом текущего языка —
// дизайн-док docs/superpowers/specs/2026-11-06-skill-card-cost-icons-design.md), описание и
// чипы эффектов — из паков; иконка ничем не перекрыта. Ассеты — механический трим/даунсемпл
// вики-оригиналов (tools/build_cost_icons.js, провенанс — data/cost_icons_src/provenance.json).
const PIP_IMG = (f, alt) => `<img class="pip-i" src="assets/icons/${f}" width="12" height="12" alt="" draggable="false">`;
const _skillPips = (sk) => {
  const rep = (n, img) => Array(n).fill(img).join('');
  const grp = (cls, label, inner) =>
    `<span class="sk-pips ${cls}" role="img" title="${esc(label)}" aria-label="${esc(label)}">${inner}</span>`;
  let h = '';
  if (sk.mem > 0) h += grp('pip-mem', t('sk.mem_n', { n: sk.mem }), rep(sk.mem, PIP_IMG('cost_memory.png')) + `<span class="pip-w">${esc(t('sk.mem_w'))}</span>`);
  if (sk.apCost > 0) h += grp('pip-ap', t('sk.ap_n', { n: sk.apCost }), rep(sk.apCost, PIP_IMG('cost_ap.png')) + `<span class="pip-w">${esc(t('sk.ap_w'))}</span>`);
  if (sk.srcCost > 0) h += grp('pip-src', t('sk.src_cost', { n: sk.srcCost }), rep(sk.srcCost, PIP_IMG('cost_source.png')) + `<span class="pip-w">${esc(t('sk.src_w'))}</span>`);
  return h ? `<div class="sk-costs">${h}</div>` : '';
};
// [n]-плейсхолдеры описания: Damage -> локализованное слово (урон/damage), прочие значения
// зависят от уровня заклинания персонажа — честно заменяем многоточием, числа не выдумываем
const _skillDescText = (sk) => {
  if (!sk.desc) return '';
  let s = state.lang === 'ru' ? (sk.desc.ru || sk.desc.en) : (sk.desc.en || sk.desc.ru);
  const params = sk.descParams || [];
  s = s.replace(/\[(\d+)\]/g, (m, i) => (params[+i - 1] === 'Damage' ? t('fx.dmg_word') : '…'));
  return s.replace(new RegExp(`(${t('fx.dmg_word')})\\s+\\1`, 'gi'), '$1').replace(/\s+/g, ' ').trim();
};
// чипы эффектов: группы классифицированы в данных (build_skills_data.js), здесь только отрисовка
const _skillFxChips = (sk) => {
  if (!sk.effects || !sk.effects.length) return '';
  const st = D.skillStatuses || {};
  const elName = (k) => t('label.element.' + String(k).toLowerCase()) || String(k);
  // русские числительные счётных оборотов (1 ход / 2 хода / 5 ходов); EN — turn/turns
  const fxTurns = (n) => {
    const m10 = n % 10, m100 = n % 100;
    const k = (m10 === 1 && m100 !== 11) ? 'fx.turns_1' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? 'fx.turns_2' : 'fx.turns_5';
    return `${n} ${t(k)}`;
  };
  const labels = sk.effects.map((e) => {
    if (e.g === 'dmg') return `${t('fx.dmg')} · ${elName(e.k)}`;
    if (e.g === 'surface') return t('fx.surface');
    if (e.g === 'summon') return t('fx.summon');
    if (e.g === 'move') return t('fx.move_' + { Rush: 'rush', Jump: 'jump', Teleportation: 'tp' }[e.k]);
    if (e.g === 'cond') return t('fx.cond');
    const nm = st[e.k] ? (state.lang === 'ru' ? st[e.k].ru : st[e.k].en) : null;
    if (!nm) return null;
    return e.turns ? `${nm} · ${fxTurns(e.turns)}` : nm;
  }).filter(Boolean);
  if (!labels.length) return '';
  return `<div class="d-block"><div class="bt">${esc(t('sk.effects'))}</div><div class="sk-fx">` +
    labels.map((l) => `<span class="d-chip fx">${esc(l)}</span>`).join('') + '</div></div>';
};
function skillCardHtml(sk) {
  const f = computeFinal();
  const a = skillAllowed(sk, f);
  const reqs = (sk.reqs || []).map(r => {
    const have = f.combat[r.id] || 0, ok = have >= r.lvl;
    return `<div class="affix${ok ? '' : ' bad'}">${esc(schoolLabel(r.id))} ${r.lvl} <span class="muted">· ${t('sk.have', { n: have })}</span></div>`;
  }).join('');
  const rows = [];
  const desc = _skillDescText(sk);
  if (desc) rows.push(`<div class="d-block"><div class="bt">${esc(t('sk.desc'))}</div><div class="sk-desc">${esc(desc)}</div></div>`);
  const fx = _skillFxChips(sk);
  if (fx) rows.push(fx);
  // название книги — фактический заголовок из stats.lsb паков (ru_official-пара даёт RU);
  // строка текущего языка, второй язык не дублируем (локализация уже есть)
  if (sk.bookName) {
    const primary = state.lang === 'ru' ? (sk.bookName.ru || sk.bookName.en) : (sk.bookName.en || sk.bookName.ru);
    rows.push(`<div class="d-block"><div class="bt">${esc(t('sk.book_name'))}</div><div>${esc(primary)}</div></div>`);
  }
  if (sk.origin) rows.push(`<div class="d-block"><div class="bt">${esc(t('sk.char'))}</div><div>${esc(originNameRu(sk.origin))}</div></div>`);
  if (reqs) rows.push(`<div class="d-block"><div class="bt">${esc(t('sk.reqs'))}</div><div>${reqs}</div></div>`);
  if (!a.ok && !isAutoSkill(sk)) rows.push(`<div class="d-block"><div class="affix bad">⚠ ${esc(t('sk.locked', { what: skillMissingText(a.missing) }))}</div></div>`);
  // подпись под именем: тир + источник (alias второго языка убран — vision-челендж 2026-11-06:
  // EN-имя под RU-заголовком тот же избыточный дубль, что и название книги вторым языком)
  const sub = [sk.tier ? tierLabel(sk.tier) : '', skillSrcText(sk)].filter(Boolean).join(' · ');
  // заголовок и пилюля школы — одной строкой справа от иконки (vision-приёмка: без обёртки
  // flex-wrap ронял пилюлю на отдельную строку под заголовком)
  return `<div class="d-head sk-head"><span class="d-icon sk-icon">${_skillIconMarkup(sk)}</span>` +
    `<div class="d-titles"><h3>${esc(skillName(sk))}</h3><span class="d-chip">${esc(schoolLabel(sk.school))}</span></div></div>` +
    (sub ? `<div class="d-sub">${esc(sub)}</div>` : '') +
    _skillPips(sk) +
    rows.join('');
}
function initSkillDbEvents() {
  rebuildSkillSelects();
  $('#skSearch').addEventListener('input', () => { readSkillFilters(); renderSkillDb(); });
  for (const id of ['skSchool', 'skTier', 'skMem', 'skSrc', 'skAvail']) $('#' + id).addEventListener('change', () => { readSkillFilters(); renderSkillDb(); });
  $('#skReset').addEventListener('click', resetSkillFilters);
  $('#skillHead').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (b) toggleSkillSort(b.dataset.sort);
  });
  $('#skillList').addEventListener('click', e => {
    const c = e.target.closest('[data-skill]');
    if (!c) return;
    // выбор/снятие; автовыдаваемые и заблокированные отсекает сам toggleSkill
    toggleSkill(c.dataset.skill);
  });
  // секция персонажа: крестик на чипе снимает навык; чип при этом перерисовывается,
  // и карточка по наведению повисла бы на снятом навыке — прячем её сразу
  $('#skillRows').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (b) { toggleSkill(b.dataset.rm); hideHoverCard(); }
  });
}
// Sub-renderers for renderDetail() sections.
function _detailReq(it, f) {
  let h = '';
  if (it.requirements && it.requirements.attribute) {
    const need = it.requirements.value, have = f.attr[it.requirements.attribute] || 0, ok = have >= need;
    h += `<div class="d-req">${t('items.requires', {
      attr: `<b>${esc(attrNameRu(it.requirements.attribute))} ${need}</b>`,
      have: `<span class="${ok ? 'ok' : 'no'}">${have} ${ok ? '✓' : '✗'}</span>`
    })}</div>`;
  }
  if (it.level != null) {
    const lvlOk = state.level >= it.level;
    h += `<div class="d-req">${t('items.level_req', {
      lvl: `<b>${it.level}</b>`,
      mark: lvlOk ? '✓' : t('items.level_bad', { n: state.level })
    })}</div>`;
  }
  return h;
}
function _detailBase(it) {
  let main = '';
  if (it.physicalArmor || it.magicArmor) main += t('items.armor', { p: it.physicalArmor || 0, m: it.magicArmor || 0 });
  if (it.damage) {
    const d = it.damage;
    // WS8: если у оружия есть параметры формулы (damage.formula) — базовый урон считается
    // формулой движка generic(lvl,семейство)×DFB×Boost (app/js/damage.js weaponBase), а не берётся статичным числом.
    const b = typeof weaponBase === 'function' ? weaponBase(it) : null;
    main += (main ? ' · ' : '') + t('items.damage', {
      dmg: b ? `${b.min}–${b.max}` : (d.min != null ? `${d.min}–${d.max}` : '—'),
      el: t('label.element.' + d.element) || d.element
    });
  }
  return main ? `<div class="d-block"><div class="bt">${t('items.base')}</div><div class="d-loc">${main}</div></div>` : '';
}
function _detailAffixes(it) {
  const affHtml = it.affixes.map(a =>
    `<div class="affix ${a.kind === 'special' ? 'special' : a.kind === 'immunity' ? 'immunity' : ''}">${esc(affixText(a))}</div>`).join('');
  return affHtml ? `<div class="d-block"><div class="bt">${t('items.stats')}</div>${affHtml}</div>` : '';
}
function _detailLocation(it) {
  const loc = it.location || {};
  if (!(loc.area || loc.detail)) return '';
  return `<div class="d-block"><div class="bt">${t('items.where_to_find')}</div><div class="d-loc">
    ${loc.area ? `<b>${esc(areaLabel(loc.area))}</b>` : `<b>${t('items.random_loot')}</b>`}<br>
    ${loc.detail ? `<span class="muted">${esc(state.lang === 'ru' ? (loc.detailRu || loc.detail) : loc.detail)}</span>` : ''}
    ${loc.coordinates ? `<div class="coords">${t('items.coords', { x: loc.coordinates.x, y: loc.coordinates.y })}</div>` : ''}
  </div></div>`;
}
function _detailActions(it) {
  const equipped = Object.values(state.equipment).includes(it.id);
  const inBag = state.bag.includes(it.id);
  const btn = it.slot === 'none'
    ? (inBag ? `<button class="btn" data-bag="0">${t('items.remove_from_bag')}</button>` : `<button class="btn gold" data-bag="1">${t('items.to_bag')}</button>`)
    : (equipped ? `<button class="btn" data-eq="0">${t('items.unequip')}</button>` : `<button class="btn gold" data-eq="1">${t('items.equip')}</button>`);
  return `<div class="d-actions">${btn}</div>`;
}
// "Better than what I wear?" block: compares the selected item with the item(s) equipped
// in the same slot (both rings for a ring). Only rows where both sides have a number and
// the numbers differ are shown — the data is sparse, silence beats a wall of dashes.
const SLOT_EQUIP_KEYS = {
  main_hand: ['main_hand'], off_hand: ['off_hand'], helmet: ['helmet'], chest: ['chest'],
  leggings: ['leggings'], gloves: ['gloves'], boots: ['boots'], belt: ['belt'],
  ring: ['ring1', 'ring2'], amulet: ['amulet'],
};
const CMP_METRICS = [
  ['physicalArmor', 'items.cmp_pa', it => it.physicalArmor],
  ['magicArmor', 'items.cmp_ma', it => it.magicArmor],
  ['damage', 'items.cmp_damage', it => { const b = typeof weaponBase === 'function' ? weaponBase(it) : (it.damage && it.damage.min != null ? { min: it.damage.min, max: it.damage.max } : null); return b ? (b.min + b.max) / 2 : null; }],
  ['level', 'items.cmp_level', it => it.level],
  ['runeSlots', 'items.cmp_runes', it => it.runeSlots],
];
const cmpDelta = (a, b) => Math.round((a - b) * 10) / 10;
// Data view of the comparison (the renderer only formats it): one group per worn item,
// each with the metrics where both sides have a number and the numbers differ.
function compareWithWorn(it) {
  const keys = SLOT_EQUIP_KEYS[it.slot];
  if (!keys) return [];
  const worn = keys.map(k => state.equipment[k]).filter(Boolean).map(itemById).filter(o => o && o.id !== it.id);
  return worn.map(o => {
    const rows = [];
    for (const [key, label, get] of CMP_METRICS) {
      const a = get(it), b = get(o);
      if (a == null || b == null || a === b) continue;
      rows.push({ key, label: t(label), value: a, wornValue: b, delta: cmpDelta(a, b) });
    }
    return { wornId: o.id, name: itemName(o), rows };
  }).filter(g => g.rows.length);
}
function _detailCompare(it) {
  const groups = compareWithWorn(it);
  if (!groups.length) return '';
  const rows = groups.map(g => `<div class="d-loc muted">${esc(g.name)}</div>` + g.rows.map(r =>
    `<div class="affix">${esc(r.label)}: ${r.value} <span class="${r.delta > 0 ? 'cmp-good' : 'cmp-bad'}">(${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta)})</span></div>`).join('')).join('');
  return `<div class="d-block"><div class="bt">${t('items.compare')}</div>${rows}</div>`;
}
// Head + subtitle line of the item card, shared by the detail pane and the hover preview.
function _detailHead(it) {
  const badge = it.confidence && it.confidence !== 'wiki'
    ? `<span class="d-badge">${it.confidence === 'generated' ? t('items.generated') : t('items.imprecise')}</span>` : '';
  return `
    <div class="d-head"><span class="d-icon" title="${esc(it.icon ? t('items.icon_alt', { name: itemName(it) }) : t('items.icon_none'))}">${_iconMarkup(it, ICON_SPRITE ? ICON_SPRITE.cell[0] : 21)}</span><h3 class="r-${it.rarity}">${esc(itemName(it))}</h3>
      <span class="d-chip">${t('label.rarity.' + it.rarity) || it.rarity}</span>
      ${it.deOnly ? '<span class="d-badge">DE</span>' : ''}${badge}</div>
    <div class="d-sub">${t('label.type.' + it.type) || it.type} · ${t('items.slot_label', { s: t('label.slot.' + it.slot) || it.slot })}${it.runeSlots ? ' · ' + t('items.runes', { n: it.runeSlots }) : ''}${it.level != null ? ' · ' + t('items.level_word', { n: it.level }) : ''}${it.value != null ? ' · ' + t('items.price_word', { n: it.value }) : ''}</div>`;
}
function renderDetail() {
  const el = $('#detail');
  // Мобильный bottom-sheet: лист поднят, только когда предмет выбран (треб. 2/4, spec
  // 2026-11-04-drawer-bottomsheet). На desktop класс ни на что не влияет — правил нет.
  const b = document.body;
  if (b && b.classList) b.classList.toggle('item-open', !!selId);
  if (!selId) { el.innerHTML = `<div class="empty">${t('items.empty_detail')}</div>`; return; }
  const it = itemById(selId);
  if (!it) { selId = null; el.innerHTML = ''; return; }
  const f = computeFinal();
  el.innerHTML = `
    ${_detailHead(it)}
    ${_detailReq(it, f)}
    ${_detailBase(it)}
    ${_detailCompare(it)}
    ${_detailAffixes(it)}
    ${it.grantedSkill ? `<div class="d-block"><div class="bt">${t('items.granted_skill')}</div><div class="affix special">✦ ${esc(skillLabel(it.grantedSkill))}</div></div>` : ''}
    ${_detailLocation(it)}
    ${it.notes ? `<div class="d-note flavor">${esc(state.lang === 'ru' ? (it.flavorRu || it.notes) : it.notes)}</div>` : ''}
    ${_detailActions(it)}`;
}
/* ==================== 8. Forge (roll generator) ==================== */
const GEN_TYPES = { amulet: 'amulet', ring: 'ring', belt: 'belt', helmet: 'head armor', chest: 'chest armor', leggings: 'leg armor', gloves: 'gloves', boots: 'boots', weapon: 'weapon', shield: 'shield' };
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[ri(0, arr.length - 1)];
// Per-slot roll functions for the forge generator.
const ARMOR_BASE = { chest: [120, 20, 60, 10], helmet: [60, 10, 20, 5], leggings: [30, 6, 15, 3], gloves: [30, 6, 15, 3], boots: [30, 6, 15, 3], shield: [80, 12, 40, 6] };
// "Кузница редкости" icon map: a rolled item gets the game icon of its family's base
// template. The donor is the DB item whose icon is the generic base of that family
// (Common_*, Human_Normal_*, plain loot/armor art). Two facts from
// docs/research/item_icons/requirements_icons.md drive the table: (1) an icon texture
// depends on the item type / weapon type, never on the rarity (the same icon is used
// for unique/epic/divine versions), so rolled rarity is shown by the icon frame colour;
// (2) the wear requirement is a function of the base family (_Swords→Strength,
// _Daggers→Finesse, _Staffs→Intelligence, _Shields→Constitution, …), so a type-matched
// icon is also the main-attribute-matched one. QA: app/qa/forge_icons.js.
const FORGE_ICON_DONORS = {
  'weapon:dagger': "Dagger",
  'weapon:sword': "Magister's Sword",
  'weapon:two_handed_sword': "Magister Trippel's Twohander",
  'weapon:axe': "Slug's Axe",
  'weapon:two_handed_axe': "Reaver's Axe",
  'weapon:mace': "Burro's Club",
  'weapon:two_handed_mace': "Magister Orivand's Mace",
  'weapon:spear': "Archaic Spear",
  'weapon:staff': "Waltz's Staff",
  'weapon:wand': "Accursed Wand",
  'weapon:bow': "Darling Bow",
  'weapon:crossbow': "Deadeye's Signature Crossbow",
  shield: "Paladin Shield",
  helmet: "House of War Apprentice Mask",
  chest: "Magister's Breastplate",
  leggings: "Luronta Temva",
  gloves: "Slippery Fingers",
  boots: "Lord Ruaney's Boots",
  belt: "Withermoore's Girdle",
  ring: "Copper Ring",
  amulet: "Zanisima's Charm",
};
const _donorByName = new Map();
for (const it of ITEMS) if (!_donorByName.has(it.name)) _donorByName.set(it.name, it);
// Icon for a rolled/restored item: the donor's cell + a source trail pointing at the donor.
// null when the donor has no icon (should not happen — QA forge_icons fails loudly;
// the UI then keeps showing the deterministic '?' placeholder).
function forgeIcon(it) {
  const slot = it.slot === 'main_hand' ? 'weapon' : it.slot === 'off_hand' ? 'shield' : it.slot;
  const key = slot === 'weapon' ? 'weapon:' + (it.weaponType || 'sword') : slot;
  const donor = _donorByName.get(FORGE_ICON_DONORS[key] || '');
  if (!donor || !donor.icon) return null;
  return {
    cell: donor.icon.cell.slice(), name: donor.icon.name, atlas: donor.icon.atlas,
    source: 'forge-icon-map:' + key + ' -> donor "' + donor.name + '" -> ' + donor.icon.source,
  };
}
function _rollAmulet(push, lvl, n, attrMax, mainAttr) {
  push('attribute', pick(['wits', 'constitution']), ri(1, attrMax));
  if (n >= 2) push('attribute', mainAttr(), ri(1, Math.max(1, attrMax - 1)));
  for (let i = 0; i < Math.min(n, 2); i++) push('skill', pick(ROLL_COMBAT.amulet), ri(1, n >= 4 ? 2 : 1));
  if (Math.random() < .6) push('skill', pick(ROLL_CIVIL.amulet), 1);
}
function _rollRing(push, lvl, n, attrMax) {
  push('attribute', pick(['constitution', 'wits']), ri(1, attrMax));
  if (n >= 2) { push('vitality', 'vitality', lvl * 2 * ri(1, 2)); push('skill', pick(ROLL_COMBAT.ring), ri(1, n >= 4 ? 2 : 1)); }
  if (n >= 3) push('resistance', pick(['fire', 'water', 'air', 'earth', 'poison']), Math.min(15, ri(5, 10) + n * 3));
}
function _rollBelt(push, lvl, n) {
  push('crit', 'crit_chance', ri(2, 4 + (n >= 4 ? 2 : 0)));
  push('dodge', 'dodge', ri(3, 7));
  push('vitality', 'vitality', lvl * 10);
  if (n >= 2) push('skill', pick(ROLL_COMBAT.belt), ri(1, 2));
  if (n >= 3) push('skill', pick(ROLL_CIVIL.belt), 1);
  if (n >= 4) push('initiative', 'initiative', ri(2, 4));
}
function _rollArmor(item, slot, push, lvl, n, attrMax, mainAttr) {
  const [p, pm, m, mm] = ARMOR_BASE[slot];
  item.physicalArmor = p + lvl * pm + ri(0, 20) + n * pm;
  item.magicArmor = m + lvl * mm + ri(0, 10) + n * mm;
  push('attribute', pick(['constitution', 'wits', mainAttr()]), ri(1, Math.max(1, Math.floor(attrMax / 2) + 1)));
  if (n >= 2) { push('skill', pick(COMBAT_IDS), 1); push('vitality', 'vitality', lvl * 2); }
  if (n >= 3) push('resistance', pick(['fire', 'water', 'air', 'earth']), Math.min(25, ri(5, 10) + n * 2));
}
function _rollWeapon(item, push, lvl, n, attrMax, mainAttr) {
  const wtype = $('#gWeaponType').value || 'sword';
  item.weaponType = wtype;
  const el = pick(['physical', 'fire', 'water', 'air', 'earth', 'poison']);
  const dmin = 6 + lvl * 2 + n, dmax = dmin + ri(3, 7);
  item.damage = { min: dmin, max: dmax, element: el };
  const attr = mainAttr();
  push('attribute', attr, ri(2, attrMax));
  item.requirements = { attribute: attr, value: 10 + Math.ceil(lvl / 5) };
  for (let i = 0; i < Math.min(2, n); i++) push('skill', pick(COMBAT_IDS), ri(1, 2));
  // no equipment side effect here: a roll is not an equip — the two-handed
  // exclusivity applies when the rolled weapon is equipped (equipItem).
}
// Grammar gender of the forge nouns (RU adjective agreement; EN forms do not decline).
// Weapons agree with the head noun of their weapon-type label (mace is feminine in RU,
// spear is neuter, the rest of the list is what the RU labels take).
const GEN_GENDER = {
  amulet: 'm', ring: 'n', belt: 'm', helmet: 'm', chest: 'm', leggings: 'p', gloves: 'p', boots: 'p', shield: 'm', weapon: 'n',
  dagger: 'm', sword: 'm', two_handed_sword: 'm', axe: 'm', two_handed_axe: 'm', mace: 'f', two_handed_mace: 'f',
  spear: 'n', staff: 'm', wand: 'm', bow: 'm', crossbow: 'm',
};
// Name of a rolled item: "<tier adjective> <noun>" (user rule 2026-11-01), e.g. RU
// "Redkiy poyas" / EN "Epic Crossbow". The adjective carries the capital letter (named
// items start with one too); the noun is the weapon-type noun for weapons, the slot noun
// otherwise. RU lowercases the noun's first letter mid-phrase (YAML labels are capitalized
// for the selects); EN keeps the YAML title case. t() misses (i18n not ready — QA shim)
// degrade to raw tier/slot tokens, never to "label.*" keys (guard in roll_pools_check).
function forgeName(it) {
  const slot = it.slot === 'main_hand' ? 'weapon' : it.slot === 'off_hand' ? 'shield' : it.slot;
  const isW = slot === 'weapon';
  const wtype = it.weaponType || 'sword';
  const tier = it.rarity || 'rare';
  const adjKey = 'label.rarity_adj.' + tier + '.' + (GEN_GENDER[isW ? wtype : slot] || 'm');
  let adj = t(adjKey); if (adj === adjKey) adj = tier.charAt(0).toUpperCase() + tier.slice(1);
  const nounKey = isW ? 'label.weapon_type.' + wtype : 'generator.base.' + slot;
  let noun = t(nounKey); if (noun === nounKey) noun = isW ? wtype : slot;
  if (state.lang === 'ru' && noun) noun = noun.charAt(0).toLowerCase() + noun.slice(1);
  return adj + ' ' + noun;
}
function rollItem() {
  const slot = $('#gSlot').value, tier = $('#gTier').value;
  if (!slot) return;
  const lvl = Math.max(1, Math.min(22, +$('#gLevel').value || 18));
  const n = D.rolls.tierRollCounts[tier] || 1;
  const attrMax = Math.min(5, 1 + Math.floor((lvl / 22) * 2 + n * 0.7));
  const aff = [];
  const push = (kind, stat, value) => aff.push({ kind, stat, value, name: '' });
  const mainAttr = () => pick(['strength', 'finesse', 'intelligence']);
  const item = {
    id: 'gen-' + Date.now() + '-' + ri(100, 999), name: '', type: GEN_TYPES[slot] || slot,
    slot: slot === 'weapon' ? 'main_hand' : slot === 'shield' ? 'off_hand' : slot,
    rarity: tier, level: lvl, physicalArmor: null, magicArmor: null, damage: null,
    requirements: null, affixes: aff, grantedSkill: null, grantedSource: null, runeSlots: 0,
    location: { act: null, area: t('generator.forge_area'), spot: 'roll', detail: t('generator.forge_detail'), coordinates: null },
    deOnly: false, dlc: null, notes: null, confidence: 'generated'
  };
  if (slot === 'amulet') _rollAmulet(push, lvl, n, attrMax, mainAttr);
  else if (slot === 'ring') _rollRing(push, lvl, n, attrMax);
  else if (slot === 'belt') _rollBelt(push, lvl, n);
  else if (ARMOR_BASE[slot]) _rollArmor(item, slot, push, lvl, n, attrMax, mainAttr);
  else if (slot === 'weapon') _rollWeapon(item, push, lvl, n, attrMax, mainAttr);
  item.icon = forgeIcon(item);
  item.name = forgeName(item);
  GEN.set(item.id, item);
  selId = item.id;
  afterChange();
}
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
  $('#charName').addEventListener('input', e => { state.name = e.target.value; save(); });
  $('#resetBtn').addEventListener('click', () => {
    if (confirm(t('error.reset_confirm'))) {
      state = defaultState(); selId = null;
      $('#charName').value = state.name || t('hero_name');
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
    name: state.name || t('hero_name'),
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
  state.name = d.name || state.name;
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
function _toastArm(ms) { _toastStart = Date.now(); _toastLeft = ms; clearTimeout(_toastTimer); _toastTimer = setTimeout(hideToast, ms); }
function hideToast() { clearTimeout(_toastTimer); const el = $('#toast'); if (el) el.hidden = true; _toastUndo = null; _toastPaused = false; }
function toast(msg, opts) {
  const el = $('#toast'); if (!el) return;
  const ms = (opts && opts.ms) || 5000;
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
  const pause = () => { if (_toastTimer && !_toastPaused) { _toastPaused = true; clearTimeout(_toastTimer); _toastLeft -= Date.now() - _toastStart; } };
  const resume = () => { if (_toastPaused) { _toastPaused = false; _toastArm(Math.max(_toastLeft, 1500)); } };
  el.addEventListener('mouseenter', pause); el.addEventListener('focusin', pause);
  el.addEventListener('mouseleave', resume); el.addEventListener('focusout', resume);
}
const slotsUI = { open: false, confirm: null, rename: null, importTarget: null, storageWarned: false };
function persistSlots() {
  if (!slotsStore.save(slotsState) && !slotsUI.storageWarned) { slotsUI.storageWarned = true; toast(t('slots.storage_error')); }
}
function syncHeaderInputs() {
  $('#charName').value = state.name || t('hero_name');
  $('#levelRange').value = state.level;
}
const slotDisplayName = s => (s && s.name) ? s.name : t('hero_name');
function slotDateShort(iso) {
  try {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const loc = state.lang === 'ru' ? 'ru-RU' : 'en-GB';
    return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}
function renderSlots() {
  const list = $('#slotsList'); if (!list) return;
  let html = '';
  for (let i = 0; i < SLOTS_N; i++) {
    const s = slotsState.slots[i], active = slotsState.activeSlot === i;
    if (s && slotsUI.confirm && slotsUI.confirm.i === i) {
      html += `<div class="slot-row confirm" data-i="${i}"><span class="slot-n">${i + 1}</span>` +
        `<span class="slot-q">${esc(t('slots.overwrite_q', { name: slotDisplayName(s), date: slotDateShort(s.savedAt) }))}</span>` +
        `<span class="slot-acts"><button class="btn gold small-btn" data-slot-act="confirm">${esc(t('slots.overwrite_do'))}</button>` +
        `<button class="btn ghost small-btn" data-slot-act="cancel">${esc(t('slots.cancel'))}</button></span></div>`;
      continue;
    }
    if (!s) {
      html += `<div class="slot-row empty" data-i="${i}"><span class="slot-n">${i + 1}</span>` +
        `<span class="slot-meta muted small">${esc(t('slots.empty'))}</span>` +
        `<span class="slot-acts"><button class="btn ghost small-btn" data-slot-act="save">${esc(t('slots.save'))}</button>` +
        `<button class="spick" data-slot-act="import" title="${esc(t('slots.import'))}" aria-label="${esc(t('slots.import'))}">⤒</button></span></div>`;
      continue;
    }
    const b = s.build || {}, r = CH.races.find(x => x.id === b.race);
    const nTitle = active ? ` title="${esc(t('slots.active_title'))}"` : '';
    const nameHtml = slotsUI.rename === i
      ? `<input class="slot-rename" maxlength="40" value="${esc(s.name)}" aria-label="${esc(t('slots.rename_title'))}">`
      : `<button class="slot-name" data-slot-act="rename" title="${esc(t('slots.rename_title'))}">${esc(slotDisplayName(s))}</button>`;
    html += `<div class="slot-row${active ? ' active' : ''}" data-i="${i}"${active ? ' aria-current="true"' : ''}>` +
      `<span class="slot-n"${nTitle}>${i + 1}</span><span class="slot-main">${nameHtml}` +
      `<span class="slot-meta muted small">lvl ${esc(b.level)} · ${esc(r ? L(r) : (b.race || ''))} · ${esc(slotDateShort(s.savedAt))}</span></span>` +
      `<span class="slot-acts">` +
      `<button class="btn ghost small-btn" data-slot-act="load">${esc(t('slots.load'))}</button>` +
      `<button class="btn ghost small-btn" data-slot-act="save">${esc(t('slots.save'))}</button>` +
      `<button class="spick" data-slot-act="export" title="${esc(t('slots.export'))}" aria-label="${esc(t('slots.export'))}">⤓</button>` +
      `<button class="spick" data-slot-act="import" title="${esc(t('slots.import'))}" aria-label="${esc(t('slots.import'))}">⤒</button>` +
      `<button class="spick" data-slot-act="del" title="${esc(t('slots.del'))}" aria-label="${esc(t('slots.del'))}">✕</button></span></div>`;
  }
  list.innerHTML = html;
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
  const prev = slotsState.slots[i];
  slotsState.slots[i] = { name: state.name || t('hero_name'), savedAt: new Date().toISOString(), build: snapshotBuild() };
  slotsState.activeSlot = i;
  persistSlots(); renderSlots();
  if (overwrite && prev) toast(t('slots.overwritten', { n: i + 1 }), { ms: 9000, action: { label: t('slots.undo'), fn: () => { slotsState.slots[i] = prev; slotsState.activeSlot = null; persistSlots(); renderSlots(); } } });
  else toast(t('slots.saved', { n: i + 1 }));
}
function writeImport(i, parsed) {
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
  persistSlots(); syncHeaderInputs(); renderSlots();
  toast(t('slots.loaded', { n: i + 1 }), { ms: 9000, action: { label: t('slots.undo'), fn: () => { applySlotBuild(prev); slotsState.activeSlot = prevActive; persistSlots(); syncHeaderInputs(); renderSlots(); } } });
}
function doDelete(i) {
  const prev = slotsState.slots[i], prevActive = slotsState.activeSlot;
  slotsState.slots[i] = null;
  if (slotsState.activeSlot === i) slotsState.activeSlot = null;
  persistSlots(); renderSlots();
  toast(t('slots.deleted', { name: slotDisplayName(prev) }), { ms: 9000, action: { label: t('slots.undo'), fn: () => { slotsState.slots[i] = prev; slotsState.activeSlot = prevActive; persistSlots(); renderSlots(); } } });
}
function doExport(s, i) {
  const blob = new Blob([JSON.stringify(buildSlotFile(s, i), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slotFileName(s.name || t('hero_name'), i) + '.json';
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
    if (act === 'save') { slotsState.slots[i] ? (slotsUI.confirm = { i, kind: 'save' }, renderSlots()) : writeSave(i); }
    else if (act === 'load') { if (slotsState.slots[i]) doLoad(i); }
    else if (act === 'export') { if (slotsState.slots[i]) doExport(slotsState.slots[i], i); }
    else if (act === 'import') { slotsUI.importTarget = i; const f = $('#slotFile'); if (f) f.click(); }
    else if (act === 'del') { if (slotsState.slots[i]) doDelete(i); }
    else if (act === 'rename') { slotsUI.rename = i; renderSlots(); }
    else if (act === 'confirm') { const c = slotsUI.confirm; slotsUI.confirm = null; if (c) c.kind === 'import' ? writeImport(i, c.parsed) : writeSave(i, true); }
    else if (act === 'cancel') { slotsUI.confirm = null; renderSlots(); }
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
        if (slotsState.slots[i]) { slotsUI.confirm = { i, kind: 'import', parsed }; renderSlots(); }
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
    document.addEventListener('keydown', e => { if (slotsUI.open && e.key === 'Escape') closeSlots(); });
  }
  // cross-tab: another tab wrote the key → reload and repaint (last-write-wins per write)
  if (window.addEventListener) window.addEventListener('storage', e => {
    if (e.key !== SLOTS_KEY) return;
    if (e.newValue === JSON.stringify(slotsState)) return;
    slotsState = slotsStore.load();
    if (slotsUI.open) renderSlots();
  });
  // probe surface (Playwright), harmless elsewhere
  window.__SLOTS_TEST__ = { get slotsState() { return slotsState; }, renderSlots, openSlots, closeSlots };
}
// Stepper rules per invested group: read/write the value, the per-point cap,
// and the remaining pool. Table-driven so attr/combat/civil share one code path.
const STEPPER_RULES = {
  // Caps are the cap-bound ones, not the raw data caps: with Lone Wolf an attribute stops at 15
  // invested points and a combat ability at 5 (Polymorph is not doubled, so it stays 10).
  attr:   { get: id => state.attr[id],   set: (id, v) => { state.attr[id] = v; },   cap: () => attrInvCap(state.talents.includes('Lone Wolf')), pool: p => p.attrTotal - p.attrSpent },
  combat: { get: id => state.combat[id], set: (id, v) => { state.combat[id] = v; }, cap: id => combatInvCap(state.talents.includes('Lone Wolf'), id), pool: p => p.combatTotal - p.combatSpent, after: enforceTalents },
  civil:  { get: id => state.civil[id],  set: (id, v) => { state.civil[id] = v; },  cap: () => LS_.civil.capEach,      pool: p => p.civilTotal - p.civilSpent },
};
// Mutate an invested value by delta, respecting the per-point cap and the pool.
// Returns true if the value changed (so the caller re-renders only then).
function adjustStepper(act, id, delta) {
  const r = STEPPER_RULES[act];
  if (!r) return false;
  const cur = r.get(id);
  if (delta > 0) { if (cur >= r.cap(id) || r.pool(pools()) <= 0) return false; }
  else if (cur <= 0) return false;
  r.set(id, cur + delta);
  if (r.after) r.after();
  return true;
}
// Primary input cannot hover (phones/tablets): hover-only UI needs tap equivalents.
// No matchMedia (QA shim, old engines) => desktop branch, everything as before.
function isTouch() { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); }
// Зажатие −/+ (hold-repeat): значение меняется непрерывно до предела (кап строки или
// пул очков). Тайминги взяты из MUI Base UI NumberField (400 мс задержка → тик 60 мс),
// как у большинства веб-степперов — без ускорения. Pointer Events покрывают мышь/тач/перо
// одним путём; в движках без PointerEvent обработчики просто не срабатывают и остаётся
// прежний путь через click. Первый шаг идёт на pointerdown, а клик-«хвост» гасится флагом
// pointerStepped (иначе при отпускании выходило бы лишнее очко). Строка после каждого
// шага перерисовывается innerHTML и нажатый узел детачится — поэтому состояние повтора
// живёт в замыкании (act/id/d), а не на кнопке; упор в кап останавливает повтор сам,
// т.к. adjustStepper возвращает false. Клавиатура не затронута: удержание Enter/Space
// порождает повторные click на уровне ОС и идёт по прежнему пути.
const HOLD_START_MS = 400, HOLD_TICK_MS = 60;
function initStepperEvents() {
  let hold = null;              // active repeat: { act, id, d, start, tick }
  let pointerStepped = null;    // step already applied on pointerdown — swallow the trailing click
  const stopHold = () => {
    if (!hold) return;
    clearTimeout(hold.start); clearInterval(hold.tick);
    hold = null;
  };
  const holdStep = () => {
    if (!hold) return;
    if (!adjustStepper(hold.act, hold.id, hold.d)) { stopHold(); return; }
    afterChange();
  };
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const b = e.target.closest && e.target.closest('button[data-act]');
    if (!b) return;
    e.preventDefault(); // no text selection (mouse), no long-press menu (touch)
    stopHold();
    const act = b.dataset.act, id = b.dataset.id, d = +b.dataset.d;
    if (!adjustStepper(act, id, d)) return;
    afterChange();
    pointerStepped = { act, id, d };
    hold = { act, id, d, start: setTimeout(() => { if (hold) hold.tick = setInterval(holdStep, HOLD_TICK_MS); }, HOLD_START_MS) };
  });
  document.addEventListener('pointerup', stopHold);
  document.addEventListener('pointercancel', stopHold);
  document.addEventListener('visibilitychange', stopHold);
  if (window.addEventListener) window.addEventListener('blur', stopHold);
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const p = pointerStepped;
      pointerStepped = null;
      // pointerdown уже ввёл шаг — гасим клик-хвост только для той же кнопки
      if (p && p.act === b.dataset.act && p.id === b.dataset.id && p.d === +b.dataset.d) return;
      if (adjustStepper(b.dataset.act, b.dataset.id, +b.dataset.d)) afterChange();
      return;
    }
    const u = e.target.closest('button[data-uneq]');
    if (u) { unequipItem(u.dataset.uneq); return; }
    const pk = e.target.closest('button[data-pick]');
    if (pk) { pickForSlot(pk.dataset.pick); return; }
    const open = e.target.closest('[data-open]');
    if (open) {
      // Контеймент снимается ДО renderDB(): переназначение innerHTML #itemList
      // детачит кликнутый узел, и closest() на нём больше ничего не находит.
      const inCharPane = isTouch() && !!open.closest('#equipRows');
      const inList = isTouch() && !!open.closest('#itemList');
      selId = open.dataset.open; renderDB(); renderDetail();
      // Тап по экипированной вещи — tap-эквивалент hover-карточки: детали в drawer.
      // Тап по строке базы — детали под складкой на телефоне, доскроллить до них.
      if (inCharPane) setItemsOpen(true);
      else if (inList) {
        const ds = $('#detailSec');
        if (ds && ds.scrollIntoView) ds.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });
}
function initTalentEvents() {
  $('#talentRows').addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"]')) toggleTalent(e.target.dataset.talent);
  });
  $('#questTalentRows').addEventListener('change', e => {
    if (e.target.id === 'spiderKissVision') {
      state.spiderKissVision = e.target.value;
      afterChange();
      return;
    }
    if (!e.target.matches('input[type="checkbox"]')) return;
    const n = e.target.dataset.quest;
    if (e.target.checked) state.questTalents.push(n);
    else state.questTalents = state.questTalents.filter(x => x !== n);
    afterChange();
  });
}
function initDBEvents() {
  $('#searchBox').addEventListener('input', () => { readFilters(); renderDB(); });
  for (const id of ['fRarity', 'fSlot', 'fArea', 'fLevel', 'fWeaponType']) $('#' + id).addEventListener('change', () => { readFilters(); renderDB(); });
  $('#fSlot').addEventListener('change', syncWeaponTypeFilter);
  $('#gSlot').addEventListener('change', syncForgeWeaponType);
  for (const id of ['fSkill', 'fCoords', 'fDe']) $('#' + id).addEventListener('change', () => { readFilters(); renderDB(); });
  $('#fReset').addEventListener('click', resetFilters);
  // Column headers: clicking sorts the table by that column.
  $('#itemHead').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (b) toggleSort(b.dataset.sort);
  });
  $('#detail').addEventListener('click', e => {
    const eq = e.target.closest('[data-eq]');
    if (eq) { if (eq.dataset.eq === '1') equipItem(selId); else unequipCurrent(); return; }
    const bag = e.target.closest('[data-bag]');
    if (bag) {
      if (bag.dataset.bag === '1') { if (!state.bag.includes(selId)) state.bag.push(selId); }
      else state.bag = state.bag.filter(x => x !== selId);
      afterChange();
    }
  });
}
/* ==================== 10. Items drawer + hover preview ====================
   The item DB / forge / detail column is hidden by default (drawer off-screen).
   It slides in from the right on the "pick item" button (equipment header) or
   the right-edge tab, and closes via its own button or Esc.
 * The drawer hosts two lists (items / skills): body.items-open и body.skills-open
 * открывают его, data-pane на #itemsDrawer выбирает, какой список показан. */
// какой список показан: 'items' | 'skills'
let drawerPane = 'items';
function setDrawerPane(pane, open) {
  const p = pane === 'skills' ? 'skills' : 'items';
  drawerPane = p;
  const b = document.body;
  if (b && b.classList) {
    b.classList.toggle('items-open', !!open && p === 'items');
    b.classList.toggle('skills-open', !!open && p === 'skills');
  }
  const drawer = $('#itemsDrawer');
  if (drawer && drawer.setAttribute) {
    drawer.setAttribute('data-pane', p);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  for (const [id, tab] of [['dtabItems', 'items'], ['dtabSkills', 'skills']]) {
    const el = $('#' + id);
    if (el && el.setAttribute) el.setAttribute('aria-selected', tab === p ? 'true' : 'false');
  }
  hideHoverCard();
  if (p === 'skills') renderSkillDb();
  // Тач: не угонять фокус в поиск — клавиатура закрыла бы половину экрана.
  if (open && !isTouch() && typeof setTimeout === 'function') {
    const focusId = p === 'skills' ? 'skSearch' : 'searchBox';
    setTimeout(() => { const s = $('#' + focusId); if (s && s.focus) s.focus(); }, 320);
  }
}
function setItemsOpen(open) { setDrawerPane('items', open); }
function setSkillsOpen(open) { setDrawerPane('skills', open); }
// Свернуть, не сбрасывая активный список: повторное открытие кнопкой-язычком
// (#drawerTab / #skillsTab) вернёт тот же список.
function closeDrawer() { setDrawerPane(drawerPane, false); }
// Equipment slot key → forge ("Кузница редкости") slot value; slots not listed
// share their key with the forge select (helmet/chest/…/amulet).
const FORGE_SLOT = { main_hand: 'weapon', off_hand: 'shield', ring1: 'ring', ring2: 'ring' };
// Per-slot "pick" button: preset the DB slot filter, the forge slot type and the
// forge level (the character's current level, same 1..22 clamp as rollItem), then
// slide the drawer in. ring1/ring2 map to the common "ring" filter value.
function pickForSlot(key) {
  const slot = (key === 'ring1' || key === 'ring2') ? 'ring' : key;
  $('#fSlot').value = slot;
  readFilters();
  syncWeaponTypeFilter();
  renderDB();
  $('#gSlot').value = FORGE_SLOT[key] || key;
  $('#gLevel').value = Math.max(1, Math.min(22, state.level));
  syncForgeWeaponType();
  const list = $('#itemList');
  if (list && list.scrollTo) list.scrollTo(0, 0); else if (list) list.scrollTop = 0;
  setItemsOpen(true);
}
function initDrawerEvents() {
  $('#drawerTab').addEventListener('click', () => setItemsOpen(true));
  $('#skillsTab').addEventListener('click', () => setSkillsOpen(true));
  // Вкладки внутри панели: тот же drawer, другой список (data-pane).
  const tabs = $('#drawerTabs');
  if (tabs && tabs.addEventListener) tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-pane]');
    if (b) setDrawerPane(b.dataset.pane, true);
  });
  $('#drawerClose').addEventListener('click', closeDrawer);
  // Лист предмета (моб. bottom-sheet): «Свернуть ✕» снимает выбор → translateY(105%) (spec
  // 2026-11-04-drawer-bottomsheet, требование 4). На desktop кнопка display:none.
  const dc = $('#detailClose');
  if (dc && dc.addEventListener) dc.addEventListener('click', () => { selId = null; renderDB(); renderDetail(); });
  if (document.addEventListener) {
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  }
}
// Read-only item card for hovering equipped items (no actions/compare — the
// full card lives in the drawer's detail pane).
function hoverCardHtml(it) {
  const f = computeFinal();
  return _detailHead(it)
    + _detailReq(it, f) + _detailBase(it) + _detailAffixes(it)
    + (it.grantedSkill ? `<div class="d-block"><div class="bt">${t('items.granted_skill')}</div><div class="affix special">✦ ${esc(skillLabel(it.grantedSkill))}</div></div>` : '')
    + _detailLocation(it);
}
function showHoverCard(cell) {
  // На таче карточку по наведению ни показать, ни прочитать — тап-эквивалент в click-хендлере.
  if (isTouch()) return;
  const card = $('#hoverCard');
  if (!card || !cell || !cell.getBoundingClientRect || typeof window === 'undefined') return;
  const stat = cell.getAttribute('data-skill');
  if (stat) {
    const sk = SKILL_BY_STAT[stat];
    if (!sk) return;
    card.innerHTML = skillCardHtml(sk);
  } else {
    const it = itemById(cell.getAttribute('data-open'));
    if (!it) return;
    card.innerHTML = hoverCardHtml(it);
  }
  card.hidden = false;
  const r = cell.getBoundingClientRect();
  const w = card.offsetWidth || 340, h = card.offsetHeight || 240;
  let x = r.right + 10;
  if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 10);
  let y = r.top - 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  card.style.left = x + 'px';
  card.style.top = y + 'px';
}
function hideHoverCard() { const card = $('#hoverCard'); if (card) card.hidden = true; }
function initHoverPreview() {
  // Карточку по наведению показывают и предметы (data-open), и строки навыков
  // (data-skill): селектор разный, обработчик один. Чипы секции «Навыки» на основном
  // экране (skillRows) получают ту же карточку, что список панели.
  const HOVER_HOSTS = [['equipRows', '[data-open]'], ['skillList', '[data-skill]'], ['skillRows', '.schip']];
  for (const [id, sel] of HOVER_HOSTS) {
    const host = $('#' + id);
    host.addEventListener('mouseover', e => {
      const cell = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (cell) showHoverCard(cell);
    });
    host.addEventListener('mouseout', e => {
      const cell = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (cell) hideHoverCard();
    });
  }
  if (document.addEventListener) document.addEventListener('scroll', hideHoverCard, true);
}

/* ==================== Layout: draggable sections (SortableJS) ====================
   Each .sec in #charPane can be dragged by its <h2> and moved within its column or
   into another column. The order is a UI preference, so it lives in its OWN localStorage
   key (not dos2planner.v1): build reset / import / export never touch it. index.html
   keeps the approved default order (guarded by app/qa/layout_order.js); a valid saved
   order is re-applied at init, a corrupt/unknown one is ignored. No window.Sortable
   (QA shim, degraded mode) => HTML default, no-op. */
const LAYOUT_KEY = 'dos2planner.layout.v1';
const SECTION_IDS = ['origin_race', 'level', 'attrs', 'civil', 'equipment', 'combat', 'skills', 'talents'];
const LAYOUT_DEFAULT = [['origin_race', 'level', 'civil', 'skills', 'equipment'], ['attrs', 'combat'], ['talents']];
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
  if (typeof snap.name === 'string') state.name = snap.name;
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

function init() {
  restoreGen();
  pruneState();
  initLayout();
  renderOriginRace();
  initFilters();
  $('#charName').value = state.name || t('hero_name');
  $('#langSel').value = state.lang;
  initCharacterControls();
  initSlots();
  initStepperEvents();
  initTalentEvents();
  initDBEvents();
  initSkillDbEvents();
  initDrawerEvents();
  initForge();
  initHoverPreview();
  $('#gBtn').addEventListener('click', rollItem);
  afterChange();
}

// Кузница: свёрнута по умолчанию только на телефоне (<=740px, тот же критерий, что у
// мобильного слоя вёрстки). На десктопе развёрнута всегда — скрытие только для мобильных
// (требование пользователя 2026-11-04). Нет matchMedia (QA-shim) => desktop => открыта.
function initForge() {
  const d = document.querySelector('details.rollgen');
  if (!d) return;
  if (!window.matchMedia) { d.open = true; return; }
  const mobile = window.matchMedia('(max-width: 740px)');
  const sync = () => { if (!mobile.matches) d.open = true; };
  sync();
  if (mobile.addEventListener) mobile.addEventListener('change', sync);
  else if (mobile.addListener) mobile.addListener(sync);
}

/* ---------------- i18n bootstrap (i18next + js-yaml, runtime) ----------------
   Loads app/i18n/{ru,en}.yaml at runtime, inits i18next, then runs init().
   Degraded mode: if the i18n libs / fetch are unavailable (e.g. a QA sandbox that
   only loads data.js + app.js), skip i18n and run init() synchronously. In that
   mode t() returns the key, which is fine because the main render strings are not
   yet routed through t() (that happens in a later task). */
const _i18next = (typeof window !== 'undefined' && window.i18next) || globalThis.i18next;
const _jsyaml = (typeof window !== 'undefined' && window.jsyaml) || globalThis.jsyaml;
const _fetch = (typeof window !== 'undefined' && window.fetch) || globalThis.fetch;
let I18N_READY = false;
const isI18nReady = () => I18N_READY;
const t = (key, params) => (I18N_READY && _i18next) ? _i18next.t(key, params) : key;
// Language-aware prerequisite display text (prerequisite is EN, prerequisiteRu is RU).
const prereqText = (tl) => state.lang === 'ru' ? (tl.prerequisiteRu || tl.prerequisite) : tl.prerequisite;
// Language-aware name: RU → nameRu (official pak) || name; EN → name.
const L = (o) => (o && state.lang === 'ru') ? (o.nameRu || o.name) : (o ? o.name : '');
// Language-aware text twin: RU → xxxRu || xxx; EN → xxx.
const TT = (o, k) => (o && state.lang === 'ru') ? (o[k + 'Ru'] || o[k]) : (o ? o[k] : '');
function whenI18nReady(cb) {
  if (I18N_READY) { cb(); return Promise.resolve(); }
  return window.__APP_READY__.then(() => { if (I18N_READY) cb(); });
}
function setLang(lang) {
  state.lang = lang;
  save();
  if (document.documentElement) document.documentElement.lang = lang;
  const p = (_i18next && I18N_READY) ? _i18next.changeLanguage(lang) : Promise.resolve();
  return p.then(() => { afterChange(); });
}
// Fill static [data-i18n] / [data-i18n-attr] elements. No-op until i18n is ready
// (degraded QA sandboxes keep their hardcoded RU strings intact).
function applyI18n() {
  if (!I18N_READY || !document.querySelectorAll) return;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    const i = spec.indexOf(':');
    if (i > 0) el.setAttribute(spec.slice(0, i), t(spec.slice(i + 1)));
  });
}
if (_i18next && _jsyaml && (_fetch || (typeof window !== 'undefined' && window.I18N_RAW))) {
  window.__APP_READY__ = (async () => {
    try {
      // The embedded YAML (js/i18n_data.js) wins: under file:// the fetch of i18n/*.yaml is
      // CORS-blocked ("origin 'null'"), which used to leave the whole UI with raw keys.
      let ruTxt, enTxt;
      if (typeof window !== 'undefined' && window.I18N_RAW && window.I18N_RAW.ru) {
        ruTxt = window.I18N_RAW.ru; enTxt = window.I18N_RAW.en;
      } else {
        [ruTxt, enTxt] = await Promise.all([
          _fetch('i18n/ru.yaml').then(r => r.text()),
          _fetch('i18n/en.yaml').then(r => r.text())
        ]);
      }
      await _i18next.init({
        resources: { ru: { translation: _jsyaml.load(ruTxt) }, en: { translation: _jsyaml.load(enTxt) } },
        lng: state.lang, fallbackLng: 'ru',
        interpolation: { escapeValue: false, prefix: '{', suffix: '}' }, returnNull: false
      });
      I18N_READY = true;
      if (document.documentElement) document.documentElement.lang = state.lang;
    } catch (e) { console.error('i18n init failed', e); }
    try { const ld = document.querySelector('#loading'); if (ld && ld.style) ld.style.display = 'none'; } catch (e) {}
    init();
  })();
} else {
  init();
  window.__APP_READY__ = Promise.resolve();
}
