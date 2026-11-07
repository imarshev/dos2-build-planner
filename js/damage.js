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
      const b = weaponBase(it);
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
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcWeaponDamage, calcSpellDamage, weaponBase, itemById };
  }
})(typeof window !== 'undefined' ? window : globalThis);
