// Damage calculation module for DOS2 Build Planner.
// Source: Fextralife Damage page + Larian forums (Additive and Amplifying Damage Percents)
// + game tooltips (English.pak: attributes "increase your damage with X-based weapons",
// weapon skills "increase damage when using ...").
// Weapon damage formula (per equipped weapon):
//   avg(min,max) × (1 + Element%) × (1 + Attribute% + WeaponSkill%)
//   Element%   — physical: Warfare×10%/pt; elemental: matching school×10%/pt; + gear +dmg% (f.dmg).
//   Attribute% — weapon's scaling attribute (requirements.attribute, fallback by weaponType):
//                STR swords/axes/2H, FIN daggers/spears/bows/crossbows, INT staves/wands; +5%/pt above 10.
//   WeaponSkill% — Two-Handed / Single-Handed / Ranged for the weapon's own skill: +5%/pt.
// Spell damage formula:
//   BaseSpell × (1 + (INT−10)×5% + School×10%)
// Multipliers use computeFinal() results — f.attr/f.combat include gear bonuses and Lone Wolf,
// so talents are accounted for. HighGround and in-combat buffs are dynamic — not calculable here.
//
// IMPORTANT: this file is wrapped in an IIFE on purpose. Top-level `const` in a classic
// browser script lands in the GLOBAL LEXICAL scope and would collide with app.js's own
// top-level `const D / CH / ITEMS` (SyntaxError: Identifier 'D' has already been declared),
// killing the whole app. Also window.DATA is accessed lazily so the script works even when
// loaded before data.js.
(function (root) {
  'use strict';

  let _ctx = null;
  function ctx() {
    if (!_ctx) {
      const D = root.DATA;
      if (!D || !D.items) throw new Error('damage.js: window.DATA is not loaded');
      _ctx = { BY_ID: new Map(D.items.map(i => [i.id, i])) };
    }
    return _ctx;
  }

  // window.GEN is published by app.js (generated items); read lazily so load order doesn't matter.
  function itemById(id) {
    return ctx().BY_ID.get(id) || (root.GEN && root.GEN.get(id)) || null;
  }

  /**
   * WS8: базовый урон оружия ПО ФОРМУЛЕ движка (не статичным числом из вики):
   *   tooltip = generic(lvl, family) × (100 + DamageFromBase) / (100 + DFB_семейства) × (1 + DamageBoost/100)
   * generic — window.DATA.weaponGeneric.table (гайд GameFAQs, fextralife-scale; числовая таблица
   * движка в EoCApp.exe — RE-негатив, см. docs/research/ws7_weapon_damage/report.md); параметры
   * предмета (tpl/col/lvl/dfb/famDfb/boost) — items[].damage.formula (tools/weapon_formula_params.js из пачек).
   * Если параметров нет (генераторы RG_*, скейл-предметы без уровня) — фоллбек на статичный damage
   * из вики/гайда. Множители персонажа применяются поверх — calcWeaponDamage.
   * @param {Object} it - item (базовый или генерированный)
   * @returns {{min:number,max:number,via:string}|null}
   */
  function weaponBase(it) {
    if (!it || !it.damage) return null;
    const p = it.damage.formula;
    if (p) {
      const t = root.DATA && root.DATA.weaponGeneric && root.DATA.weaponGeneric.table;
      const g = t && t[String(p.lvl)] && t[String(p.lvl)][p.col];
      if (g) {
        const mult = ((p.dfb != null && p.famDfb != null) ? (100 + p.dfb) / (100 + p.famDfb) : 1) * (1 + (p.boost || 0) / 100);
        return { min: Math.round(g.min * mult), max: Math.round(g.max * mult), via: 'formula' };
      }
    }
    if (it.damage.min != null) return { min: it.damage.min, max: it.damage.max != null ? it.damage.max : it.damage.min, via: 'static' };
    return null;
  }

  /**
   * Level-scaled weapons (design 2026-11-08-level-scaled-items §5.2): базовый урон того же
   * предмета, но на произвольном уровне фиксации — generic(lvl, family) с подменой p.lvl.
   * Таблица generic покрывает уровни 1..21 (кап DE — 22, строки 22 нет) → clamp(1, 21).
   * Статичная сторона (без it.levelScale или без формулы) остаётся на своём p.lvl — правило
   * каждой стороны расчёта: it.levelScale && it.damage.formula ? weaponBaseAt : weaponBase.
   * @param {Object} it - item с damage.formula
   * @param {number} lvl - уровень фиксации (обычно уровень билда)
   * @returns {{min:number,max:number,via:string}|null}
   */
  function weaponBaseAt(it, lvl) {
    if (!it || !it.damage || !it.damage.formula) return weaponBase(it);
    const p = it.damage.formula;
    const l = Math.max(1, Math.min(21, Math.round(lvl)));
    const t = root.DATA && root.DATA.weaponGeneric && root.DATA.weaponGeneric.table;
    const g = t && t[String(l)] && t[String(l)][p.col];
    if (!g) return weaponBase(it);
    const mult = ((p.dfb != null && p.famDfb != null) ? (100 + p.dfb) / (100 + p.famDfb) : 1) * (1 + (p.boost || 0) / 100);
    return { min: Math.round(g.min * mult), max: Math.round(g.max * mult), via: 'formula' };
  }

  /**
   * Level-scaled armour (design 2026-11-09-eternals-armor-scale §4 + 2026-11-10-scale-unify §4):
   * броня того же предмета на произвольном уровне —
   * trunc(generic(lvl, slot) × (ov / famStd) × (100 + boost)/100) — модель B (VERIFIED,
   * docs/research/lvlunify-2026-11-10/results/formula.json: 29/38 точных, 8 — ±1 шума гайд-таблицы):
   * отношение оверрайда до буста, одно округление вниз в конце. ovPa/ovMa = [override, famStd]
   * из шаблона cmp_levelupequipment (Armor Defense Value/Magic Armor Value, заменяющие значение
   * семейства); без оверрайда отношение = 1 — Eternals не плывёт.
   * Уровень капит по диапазону фиксации [levelScale.min, levelScale.max] (челендж r1, P1-2:
   * без капа на билде 21–22 карточка показала бы lvl21/22 вместо max предмета).
   * Таблица generic покрывает 1..21 (data/raw/armor_generic_values.json); для 22-го уровня
   * числа в таблице нет — носитель, якорь anchors[lvl===22] (wiki), иначе потолок 21.
   * Округление вниз подтверждено wiki-якорями Eternals (14: 149×1.2→178, 25×1.1→27).
   * @param {Object} it - item с levelScale.armorFormula
   * @param {number} lvl - уровень фиксации (обычно уровень билда)
   * @returns {{pa:number,ma:number,via:'table'|'anchor'}|null} null — статичная сторона
   */
  function armorBaseAt(it, lvl) {
    const af = it && it.levelScale && it.levelScale.armorFormula;
    if (!af) return null;
    const ls = it.levelScale;
    let l = Math.max(ls.min || 1, Math.min(ls.max || 22, Math.round(lvl)));
    if (l >= 22) {
      const a = (ls.anchors || []).find((x) => x.lvl === 22);
      if (a) return { pa: a.pa, ma: a.ma, via: 'anchor' };
      l = 21;
    }
    const t = root.DATA && root.DATA.armorGeneric && root.DATA.armorGeneric.table;
    const g = t && t[String(l)] && t[String(l)][af.slot];
    if (!g) return null;
    const ov = (o) => (Array.isArray(o) && o.length === 2 && o[1] ? o[0] / o[1] : 1);
    return {
      pa: Math.floor(g.pa * ov(af.ovPa) * (100 + (af.paBoost || 0)) / 100),
      ma: Math.floor(g.ma * ov(af.ovMa) * (100 + (af.maBoost || 0)) / 100),
      via: 'table',
    };
  }

  // weaponType → [scaling attribute, weapon skill]. Family↔attribute is evidenced by the items'
  // own requirements (docs/research/item_icons/requirements_icons.md, 133/133) and matches
  // requirements.attribute in items.json; the game tooltip counts a staff as a two-handed melee
  // weapon ("sword, axe, mace, spear or staff"), a wand as one-handed.
  const WT_SCALE = {
    dagger: ['finesse', 'single_handed'], sword: ['strength', 'single_handed'],
    axe: ['strength', 'single_handed'], mace: ['strength', 'single_handed'],
    spear: ['finesse', 'single_handed'], wand: ['intelligence', 'single_handed'],
    two_handed_sword: ['strength', 'two_handed'], two_handed_axe: ['strength', 'two_handed'],
    two_handed_mace: ['strength', 'two_handed'], staff: ['intelligence', 'two_handed'],
    bow: ['finesse', 'ranged'], crossbow: ['finesse', 'ranged'],
  };
  const SCALE_ATTRS = ['strength', 'finesse', 'intelligence'];
  const SCHOOL_BY_ELEMENT = { fire: 'pyrokinetic', water: 'hydrosophist', air: 'aerotheurge', earth: 'geomancer', poison: 'necromancer' };

  /**
   * Estimated weapon damage for the current build, per equipped weapon:
   *   avg(min,max) × (1 + Element%) × (1 + Attribute% + WeaponSkill%)
   * Element% — Warfare×10%/pt for physical weapons, the matching school×10%/pt for elemental
   * ones (Warfare does not amplify them), plus gear +dmg% affixes (f.dmg). Attribute% — the
   * weapon's scaling attribute, +5%/pt above the base 10. WeaponSkill% — the weapon's own
   * skill, +5%/pt. Inputs are final values from computeFinal() (f.attr, f.combat, f.dmg), so
   * gear bonuses and Lone Wolf are included. No style selection is required — a weapon alone
   * is enough (the old "no combat style" branch returned no estimatedDmg → NaN in the UI).
   * @param {Object} state - Current planner state
   * @param {Object} f - Result of computeFinal()
   * @returns {{baseDmg:number,elementMult:string,attrSkillMult:string,estimatedDmg:number,note:null}|null}
   */
  function calcWeaponDamage(state, f) {
    const eq = state.equipment || {};
    const fAttr = (f && f.attr) || {};
    const fCombat = (f && f.combat) || state.combat || {};
    const fDmg = (f && f.dmg) || {};
    let baseDmg = 0, total = 0, hasData = false, repSet = false, repEl = 1, repAs = 1;
    for (const slot of ['main_hand', 'off_hand']) {
      const it = itemById(eq[slot]);
      if (!it) continue;
      // Level-scaled оружие (design 2026-11-08 §5.2): базовый урон считается на уровень билда;
      // статичное оружие остаётся на своём снапшотном p.lvl — правило каждой стороны.
      const b = (it.levelScale && it.damage.formula) ? weaponBaseAt(it, state.level) : weaponBase(it);
      if (!b) continue;
      const avg = (b.min + b.max) / 2;
      const scale = WT_SCALE[it.weaponType] || ['strength', null];
      const attrId = it.requirements && SCALE_ATTRS.indexOf(it.requirements.attribute) >= 0
        ? it.requirements.attribute : scale[0];
      const element = it.damage.element || 'physical';
      const school = SCHOOL_BY_ELEMENT[element];
      const elemBonus = (school ? (fCombat[school] || 0)
        : element === 'physical' ? (fCombat.warfare || 0) : 0) * 0.10 + (fDmg[element] || 0) / 100;
      const attrBonus = Math.max(0, (fAttr[attrId] || 10) - 10) * 0.05;
      const skillBonus = (scale[1] ? (fCombat[scale[1]] || 0) : 0) * 0.05;
      baseDmg += avg;
      total += avg * (1 + elemBonus) * (1 + attrBonus + skillBonus);
      if (!repSet || slot === 'main_hand') {
        repEl = 1 + elemBonus; repAs = 1 + attrBonus + skillBonus; repSet = true;
      }
      hasData = true;
    }
    if (!hasData) return null;
    return {
      baseDmg,
      elementMult: Math.round(repEl * 100) + '%',
      attrSkillMult: Math.round(repAs * 100) + '%',
      estimatedDmg: Math.round(total),
      // Неокруглённая сумма — для потребителей, которым нужна цена одного очка (план прокачки,
      // app/js/app/12-plan.js): на низких уровнях шаг качества даёт меньше единицы урона, и
      // округлённый estimatedDmg его не различает. В UI не используется (число для показа — округлённое).
      estimatedDmgRaw: total,
      note: null
    };
  }

  // School → element mapping (constant, created once).
  const SCHOOL_MAP = {
    pyrokinetic: { element: 'fire' },
    hydrosophist: { element: 'water' },
    aerotheurge: { element: 'air' },
    geomancer: { element: 'earth' },
    necromancer: { element: 'poison' }
  };

  /**
   * Calculate estimated spell damage for the current build.
   * @param {Object} state - Current planner state
   * @param {Object} f - Result of computeFinal()
   * @param {string} schoolId - School ID (pyrokinetic, hydrosophist, aerotheurge, geomancer, necromancer)
   * @returns {Object|null}
   */
  function calcSpellDamage(state, f, schoolId) {
    const school = SCHOOL_MAP[schoolId];
    if (!school) return null;

    // School level is the FINAL one (f.combat): gear +school affixes and Lone Wolf doubling count.
    const schoolLevel = (f && f.combat && f.combat[schoolId]) || state.combat[schoolId] || 0;
    if (schoolLevel === 0) return null;

    // Intelligence bonus: +5% per point above base 10
    const intBonus = Math.max(0, (f.attr.intelligence || 10) - 10) * 0.05;

    // School bonus: +10% per point
    const schoolBonus = schoolLevel * 0.10;

    const mult = 1 + intBonus + schoolBonus;
    const estimatedDmg = Math.round(100 * mult);

    return {
      baseSpell: 100,
      mult: Math.round(mult * 100) + '%',
      estimatedDmg,
      note: null
    };
  }

  // Export for browser (window) and Node (module.exports)
  root.calcWeaponDamage = calcWeaponDamage;
  root.calcSpellDamage = calcSpellDamage;
  root.weaponBase = weaponBase;
  root.weaponBaseAt = weaponBaseAt;
  root.armorBaseAt = armorBaseAt;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcWeaponDamage, calcSpellDamage, weaponBase, weaponBaseAt, armorBaseAt, itemById };
  }
})(typeof window !== 'undefined' ? window : globalThis);
