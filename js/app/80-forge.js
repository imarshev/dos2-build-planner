// Part 80-forge.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
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
    requirements: null, affixes: aff, grantedSkill: null, grantedSource: null, grantedTalent: null, grantedTalentSource: null, runeSlots: 0,
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
