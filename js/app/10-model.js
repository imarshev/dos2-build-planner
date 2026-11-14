// Part 10-model.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
const attrMult = (lw) => (lw ? 2 : 1);
const combatMult = (lw, id) => (lw && id !== 'polymorph' ? 2 : 1);
// Points that can actually be invested: 30 attributes (15 with LW), 10 combat (5 with LW;
// Polymorph is not doubled, so it keeps 10).
const attrInvCap = (lw, base = 10) => Math.floor((LS_.attribute.cap - base) / attrMult(lw));
const combatInvCap = (lw, id) => Math.floor(LS_.combat.cap / combatMult(lw, id));
// What the invested points are worth after the doubling, bounded by the cap.
const attrEff = (lw, inv, base = 10) => Math.min(inv * attrMult(lw), LS_.attribute.cap - base);
const combatEff = (lw, id, inv) => Math.min(inv * combatMult(lw, id), LS_.combat.cap);
// Гранты талантов от экипировки (spec 2026-11-09-item-talent-grants §4.2): производные от
// экипировки имена — в state.talents не пишутся, очко таланта не тратят и талант героя не
// перекрывают. Порядок — по EQUIP_SLOTS, дедуп по имени (первый слот выигрывает).
function _itemTalentGrants() {
  const seen = new Set();
  const out = [];
  for (const [key] of EQUIP_SLOTS) {
    const it = itemById(state.equipment[key]);
    if (it && it.grantedTalent && !seen.has(it.grantedTalent)) { seen.add(it.grantedTalent); out.push(it.grantedTalent); }
  }
  return out;
}
// has() видит и гранты: эффекты Mnemonic (+3 памяти) и Picture Of Health (+3% HP/Warfare)
// считаются, пока донор надет. Рекурсии нет: _itemTalentGrants читает только equipment+поле.
const has = t => state.talents.includes(t) || _itemTalentGrants().includes(t);
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
// Оружейные навыки выдаются ЭКИПИРОВАННЫМ оружием, а не очками способностей
// (design 2026-11-07-weapon-skill-auto-grant §2.3). Первичный источник — Skills-поле базовых
// шаблонов пака (_TwoHandedSwords/_TwoHandedAxes/_TwoHandedMaces/_Spears → Target_HeavyAttack,
// _Staffs → Projectile_StaffOfMagus) + Requirement (ShieldWeapon/StaffWeapon); Flurry/Shields
// Up/Sucker Punch движковые — условия по fandom/GameFAQs. TWO_HANDED_MELEE — TWO_HANDED_TYPES
// без посоха (у посоха свой навык) и без лука/арбалета (дальний бой).
const ONE_HANDED_MELEE = new Set(['sword', 'axe', 'mace', 'dagger']);
// Оружие «в обе руки» — паковый признак Slot=Weapon & IsTwoHanded=No & WeaponType≠None
// (design 2026-11-07-dual-hand §2.1; mace — паковый Club). ONE_HANDED_MELEE не трогать:
// он про выдачу навыков (Flurry/Sucker Punch), жезл в нём сознательно не состоит (§5.4).
const DUAL_HAND = new Set(['sword', 'axe', 'mace', 'dagger', 'wand']);
const TWO_HANDED_MELEE = new Set(['two_handed_sword', 'two_handed_axe', 'two_handed_mace', 'spear']);
const isShieldItem = it => !!it && it.type === 'shield';
const WEAPON_RULES = {
  'Two-Handed Weapon': mh => !!mh && TWO_HANDED_MELEE.has(mh.weaponType),
  'Staff': mh => !!mh && mh.weaponType === 'staff',
  'Shield': (mh, oh) => isShieldItem(oh),
  'Dual Wield': (mh, oh) => !!mh && ONE_HANDED_MELEE.has(mh.weaponType) && !!oh && ONE_HANDED_MELEE.has(oh.weaponType),
  'Unarmed': (mh, oh) => !!mh && ONE_HANDED_MELEE.has(mh.weaponType) && !oh,
};
// auto → ключ подписи условия в карточке (sk.grant.*, design §5.1)
const WEAPON_GRANT_KEYS = { 'Two-Handed Weapon': 'two_handed', 'Staff': 'staff', 'Shield': 'shield', 'Dual Wield': 'dual', 'Unarmed': 'unarmed' };
function skillAutoGranted(sk, f) {
  if (sk.src === 'racial') return sk.auto === 'Beast' ? state.origin === 'beast' : AUTO_RACE[sk.auto] === state.race;
  if (sk.src === 'origin') return AUTO_ORIGIN[sk.auto] === state.origin;
  if (sk.src === 'weapon') {
    const rule = WEAPON_RULES[sk.auto];
    if (!rule) return false;
    return rule(itemById(state.equipment.main_hand), itemById(state.equipment.off_hand));
  }
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
function equipItem(id, hand) {
  const it = itemById(id);
  if (!it) return;
  if (it.slot === 'none') {
    if (!state.bag.includes(id)) state.bag.push(id);
    afterChange();
    return;
  }
  const wt = it.weaponType;
  const dual = !!wt && DUAL_HAND.has(wt);
  // Явный выбор руки (design 2026-11-08-offhand-empty §3.1, отмена И1): только для DUAL_HAND;
  // снять изо всех слотов и положить в кликнутую руку. Кламп единственный: двуручное в mh
  // занимает обе руки (И2), 'oh' при такой mh → mh. Оружие одним в oh легально.
  if (hand && dual) {
    for (const k of Object.keys(state.equipment)) if (state.equipment[k] === id) state.equipment[k] = null;
    if (hand === 'oh' && isTwoHanded(state.equipment.main_hand)) hand = 'mh';
    state.equipment[hand === 'oh' ? 'off_hand' : 'main_hand'] = id;
    afterChange();
    return;
  }
  let key = it.slot;
  if (it.slot === 'ring') key = !state.equipment.ring1 ? 'ring1' : (!state.equipment.ring2 ? 'ring2' : 'ring1');
  // одноручное оружие и жезл маршрутируются и во вторую руку (design 2026-11-07-dual-hand §5.3,
  // отмена прошлой §4.3): тот же предмет — no-op; при одноручном/жезле в main_hand новый
  // DUAL_HAND идёт в off_hand; пустой main_hand даёт mhOne=false → остаётся main_hand; прочие
  // случаи (двуручное/лук/арбалет в main_hand) — заменяем main_hand, off_hand не трогаем (её
  // чистит только ЭКИПИРОВКА двуручного, см. ниже)
  if (dual) {
    if (state.equipment.main_hand === id || state.equipment.off_hand === id) return;
    const mh = itemById(state.equipment.main_hand);
    const mhOne = !!mh && !!mh.weaponType && DUAL_HAND.has(mh.weaponType);
    if (mhOne) key = 'off_hand';
  }
  if (it.slot === 'main_hand' && TWO_HANDED_TYPES.has(it.weaponType)) state.equipment.off_hand = null;
  else if (it.slot === 'off_hand' && isTwoHanded(state.equipment.main_hand)) state.equipment.main_hand = null;
  state.equipment[key] = id;
  afterChange();
}
function unequipItem(key) {
  // снятие ряда = только снятие (design 2026-11-08-offhand-empty §3.2, отмена И1): оружие в
  // oh остаётся на месте — пользователь положил его туда явно, щит и так не переносился
  state.equipment[key] = null; afterChange();
}
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
    // Броня с формулой (design 2026-11-09-eternals-armor-scale §5.5): надетое считается на
    // уровень билда — правило каждой стороны, прецедент calcWeaponDamage (damage.js).
    const ab = (it.levelScale && it.levelScale.armorFormula && typeof armorBaseAt === 'function')
      ? armorBaseAt(it, state.level) : null;
    const anc = (it.levelScale && it.levelScale.armorFormula) ? _scaleAnchor(it, state.level) : null;
    if (ab) { g.pArmor += ab.pa; g.mArmor += ab.ma; }
    else {
      if (it.physicalArmor) g.pArmor += it.physicalArmor;
      if (it.magicArmor) g.mArmor += it.magicArmor;
    }
    for (const a of it.affixes) {
      const fn = AFFIX_TARGET[a.kind];
      // Eternals (design 2026-11-09): ОЗ-аффикс варится уровнем по wiki-diff таблице — берём якорь.
      if (fn) fn(g, (anc && a.kind === 'vitality') ? { ...a, value: anc.hp } : a);
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
  // Движковый пайплайн HP (decomp_hp_recalc_1418bc4a0.c:412-575): base = round(round(boost×conMult)×Vit/100),
  // плоский +Vitality предметов идёт В БАЗУ до процентов, итог — целочисленное деление (trunc).
  // Стат Vitality = 100 (%-аффиксов Vitality в базе предметов нет). CON-множитель =
  // 1 + 0.07×(CON−10) (FUN_141cf07e0, AttributeBaseValue=10): атрибут хранится как base 10 + очки.
  const conMult = 1 + VT.boostFromAttribute * (con - VT.attributeBase);
  const base = Math.round(vitalityBoost(state.level) * conMult) + g.vit;
  // % -модификаторы (pct = 100 + ...): Sturdy +10 (в движке — флаг 0x5b, цифра по игровому тултипу),
  // Lone Wolf +30 (LoneWolfVitalityBoostPercentage), Picture Of Health +3×Warfare (FUN_141c9ceb0(unit,0)×3).
  const vitPct = 100 + (has('Sturdy') ? 10 : 0) + (lw ? 30 : 0) + (has('Picture Of Health') ? 3 * combat.warfare : 0);
  const hp = Math.trunc(vitPct * base / 100);
  let pA = g.pArmor, mA = g.mArmor;
  // Lone Wolf DE: +60% к обеим броням (LoneWolfArmorBoostPercentage/MagicArmorBoostPercentage=60,
  // classic был 30) — FUN_141c8d320, data.txt Patch1.
  if (lw) { pA = Math.round(pA * 1.6); mA = Math.round(mA * 1.6); }
  // Base crit 0%: crit = Wits*1% + Ranged (+1%/очко, FUN_141c94860: ability id 6 == Ranged,
  // CombatAbilityCritBonus=1; показ без гейта по оружию — конвенция блока, см. dodge ниже)
  // + talents + gear (stats_batch1: crit_base=0, crit_per_wits=1).
  const crit = attr.wits + combat.ranged + (has('Ingenious') ? 5 : 0) + (has('Hothead') ? 10 : 0) + g.crit;
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
  // Single-Handed: +5 точности за очко (FUN_141c94ca0: ability id 3 == SingleHanded,
  // CombatAbilityAccuracyBonus=5; бонус плоский, roundf(level×5); конвенция блока — без гейта по оружию).
  const accuracy = 95 + combat.single_handed * 5 + (has('Hothead') ? 10 : 0);
  // Critical damage multiplier: base 150%, +5% per Two-Handed point (FUN_141c95f20: ability id 4 ==
  // TwoHanded, CombatAbilityCritMultiplierBonus=5; вторая ветка id 2 RogueLore — DOS1-наследие),
  // +5% per Scoundrel point (через флаги TALENT_*, не enum), Ingenious (Human) +10%.
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
