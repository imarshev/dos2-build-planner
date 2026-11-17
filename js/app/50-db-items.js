// Part 50-db-items.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
/* ==================== 7. Filter & item DB ==================== */
let selId = null;
// Происхождение выбора для листа предмета: 'equip' (строка блока «Экипировка») / 'list'
// (строка базы) — куда возвращать фокус при закрытии листа (spec 2026-11-10, D2/APG).
let _sheetOrigin = null;
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
let filter = { q: '', rarity: '', slot: '', area: '', level: '', skill: false, coords: false, de: false, scale: false };
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
  // off_hand тоже показывает подтип: там щиты + DUAL_HAND, без сужения не отобрать жезлы
  // (design 2026-11-07-dual-hand §5.2)
  const v = $('#fSlot').value;
  const on = v === 'main_hand' || v === 'off_hand';
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
    skill: $('#fSkill').checked, coords: $('#fCoords').checked, de: $('#fDe').checked, scale: $('#fScale').checked
  };
}
// Filter predicates: key -> (item, value) => matches. Applied only when the key is set.
const FILTER_PREDICATES = {
  rarity: (it, v) => it.rarity === v,
  // off_hand принимает щиты и оружие «в обе руки» (design 2026-11-07-dual-hand §5.2)
  slot: (it, v) => v === 'off_hand'
    ? (it.slot === 'off_hand' || (!!it.weaponType && DUAL_HAND.has(it.weaponType)))
    : it.slot === v,
  weaponType: (it, v) => it.weaponType === v,
  // area is a proper noun kept verbatim in the data; level means "usable at level <= v",
  // so items whose level is unknown are excluded on purpose (an unknown level is not "low").
  area: (it, v) => it.location.area === v,
  level: (it, v) => it.level != null && it.level <= Number(v),
  skill: (it, v) => !!it.grantedSkill,
  coords: (it, v) => !!it.location.coordinates,
  de: (it, v) => !!it.deOnly,
  // уровень фиксируется в момент получения (design 2026-11-08-level-scaled-items)
  scale: (it, v) => !!it.levelScale,
};
function applyFilters() {
  return ITEMS.filter(it => {
    for (const [k, pred] of Object.entries(FILTER_PREDICATES)) {
      if (filter[k] && !pred(it, filter[k])) return false;
    }
    if (filter.q) {
      // Search by EN name AND official RU name (UI shows RU names, so RU search must work too).
      const ruName = (D.ru && D.ru[it.name]) || '';
      const hay = (it.name + ' ' + ruName + ' ' + (it.location.area || '') + ' ' + (it.grantedSkill || '') + ' ' + (it.grantedTalent || '') + ' ' + it.type + ' ' + (it.location.detail || '')).toLowerCase();
      if (!hay.includes(filter.q)) return false;
    }
    return true;
  });
}
// Clear every filter control and re-render the list.
function resetFilters() {
  $('#searchBox').value = ''; $('#fRarity').value = ''; $('#fSlot').value = ''; $('#fWeaponType').value = '';
  $('#fArea').value = ''; $('#fLevel').value = '';
  $('#fSkill').checked = $('#fCoords').checked = $('#fDe').checked = $('#fScale').checked = false;
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
      <span class="i-name r-${it.rarity}" role="cell" title="${esc(itemName(it))}">${esc(itemName(it))}${it.deOnly ? ' <span class="i-de">DE</span>' : ''}${it.levelScale ? ` <span class="i-scale" role="img" aria-label="${esc(t('items.scale.badge'))}" title="${esc(t('items.scale.badge'))}">⚡</span>` : ''}</span>
      <span class="i-type" role="cell">${t('label.type.' + it.type) || it.type}</span>
      <span class="i-lvl" role="cell">${it.level != null ? t('items.level', { n: it.level }) : '—'}</span>
      <span class="i-price" role="cell">${it.value != null ? it.value : '—'}</span>
      <span class="i-skill" role="cell">${it.grantedSkill ? '✦ ' + skillLabel(it.grantedSkill) : ''}</span>
    </div>`;
  }
  $('#itemList').innerHTML = html || `<div style="padding:16px;grid-column:1/-1" class="muted">${t('db.empty')}</div>`;
  $('#dbCount').textContent = `${list.length} / ${ITEMS.length}`;
}
