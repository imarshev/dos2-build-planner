// Part 70-detail.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
// Модель грантов предмета (spec 2026-11-08-item-grant-skill-card §3.1): чистая функция, НЕ зависит
// от экипировки — карточка описывает предмет, как игровой тултип. Lowercase-резолв обязателен:
// данные пишут «Staff of Magus», запись — «Staff Of Magus» (коллизий lowercase-имён в 222 — 0).
const SKILL_BY_ENNAME = {};
for (const sk of D.skills) SKILL_BY_ENNAME[String(sk.name).toLowerCase()] = sk;
// Грантовые структуры (design 2026-11-09 §3.1, цитаты источников — app/build_data.js):
// GRANT_SKILLS — 7 записей вне 223 (в таблицу не попадают); GRANT_BY_ENNAME — first-wins
// (имя Purge у двух записей, оба предмета с ним накрывает GRANT_BY_ITEM); GRANT_ALIAS —
// wiki-имя(lowercase) → stat существующей записи. Цепочка резолва grantedSkill:
// GRANT_BY_ITEM → SKILL_BY_ENNAME → GRANT_BY_ENNAME → GRANT_ALIAS.
const GRANT_SKILLS = D.grantSkills || [];
const GRANT_BY_STAT = {};
for (const g of GRANT_SKILLS) GRANT_BY_STAT[g.stat] = g;
const GRANT_BY_ENNAME = {};
for (const g of GRANT_SKILLS) { const k = String(g.name).toLowerCase(); if (!(k in GRANT_BY_ENNAME)) GRANT_BY_ENNAME[k] = g; }
const GRANT_ALIAS = D.grantAlias || {};
const GRANT_BY_ITEM = D.grantByItem || {};
// OSL-канон (design 2026-11-09 §2, цитаты — app/build_data.js): полный список навыков предмета из
// пакового data "Skills". Сырые тип-уровневые статы OSL мапятся в записи планировщика (их нет в
// 223 как учимых), чип отрисовывается пунктиром — как тип-уровневая выдача.
const GRANT_OSL = D.grantOsl || {};
const OSL_MAP = {
  Target_HeavyAttack: 'Wiki_Special_All_In',
  Projectile_StaffOfMagus: 'Wiki_Special_Staff_Of_Magus',
};
// auto оружейных записей (src==='weapon') → запись навыка
const WEAPON_AUTO_SKILL = {};
for (const sk of D.skills) if (sk.src === 'weapon' && sk.auto) WEAPON_AUTO_SKILL[sk.auto] = sk;
// тип-уровневые гранты — зеркало WEAPON_RULES без состояния слотов; [auto, ключ условия sk.grant.*]
const _typeGrants = (it) => {
  if (TWO_HANDED_MELEE.has(it.weaponType)) return [['Two-Handed Weapon', null]];
  if (it.weaponType === 'staff') return [['Staff', null]];
  if (isShieldItem(it)) return [['Shield', null]];
  if (ONE_HANDED_MELEE.has(it.weaponType)) return [['Unarmed', 'unarmed'], ['Dual Wield', 'dual']];
  // жезл/лук/арбалет — ничего (O10 r1-M2)
  return [];
};
// grantedSkill → запись: per-item override (развилка Purge) → имя записи → имя grant-записи →
// алиас wiki-имени (все 22 имени закрыты паком, design 2026-11-09 §2; fail-safe null — plain-строка)
const _resolveGrant = (it) => {
  const byItem = GRANT_BY_ITEM[it.id];
  if (byItem) return SKILL_BY_STAT[byItem] || GRANT_BY_STAT[byItem] || null;
  const n = String(it.grantedSkill).toLowerCase();
  const byAlias = GRANT_ALIAS[n];
  return SKILL_BY_ENNAME[n] || GRANT_BY_ENNAME[n] ||
    (byAlias ? (SKILL_BY_STAT[byAlias] || GRANT_BY_STAT[byAlias] || null) : null);
};
const _grantsOf = (it) => {
  const out = [];
  const osl = GRANT_OSL[it.id];
  if (osl) {
    // паковый Skills — полный список выдаваемых предметом навыков: wiki-грант и тип-уровневые
    // правила для такого предмета пропускаем целиком (three-sisters, например, Посох мага НЕ даёт)
    for (const st of osl) {
      const mapped = OSL_MAP[st];
      const sk = SKILL_BY_STAT[mapped || st] || GRANT_BY_STAT[mapped || st];
      if (sk) out.push({ sk, raw: null, cond: null, auto: !!mapped });
    }
    return out;
  }
  const uniq = it.grantedSkill ? _resolveGrant(it) : null;
  if (it.grantedSkill) out.push({ sk: uniq, raw: it.grantedSkill, cond: null });
  for (const [auto, cond] of _typeGrants(it)) {
    const sk = WEAPON_AUTO_SKILL[auto];
    // дедуп по идентичности записи; нерезолвнувшийся уникальный не дедупится никогда (записи нет)
    if (uniq && sk && uniq.stat === sk.stat) continue;
    if (sk) out.push({ sk, raw: null, cond });
  }
  return out;
};
// Формула пунктира чипа (design 2026-11-09-item-grants §4.1): тип-уровневые (raw null
// без флага) и мапнутые OSL-статы (auto true) — пунктир; уникальный предмета и прямой
// OSL-стат — сплошной. Общая у карточки «Даёт навык» и группы «Навыки от предметов».
const _grantDashed = (g) => (g.raw ? false : g.auto === undefined ? true : g.auto);
// Блок «Даёт навык» карточки предмета (spec 2026-11-08 §3.2): hover — короткий (иконка+имя+условие,
// pointer-events:none и 74vh — описание там недостижимо), detail/sheet — полный (+паковое desc).
// Пунктирный чип (schip auto) — только тип-уровневые: в этом состоянии навык окажется в группе
// «Выдано автоматически»; сплошной — уникальный из данных (свойство предмета, в билд не выдаётся).
function _detailGranted(it, full) {
  const grants = _grantsOf(it);
  if (!grants.length) return '';
  const row = (g) => {
    if (!g.sk) return `<div class="grant-row"><div class="affix special">✦ ${esc(skillLabel(g.raw))}</div></div>`;
    // data-skill + tabindex — hover-карточка навыка на чипе (как в таблице «Навыки») и доступ
    // с клавиатуры (WCAG 1.4.13); data-skill-ctx — карточка в грант-контексте (без «Требований»
    // и пилюли памяти, design 2026-11-09-item-grants §4.2); desc-строка — только на таче,
    // где карточка недоступна (desktop-дубль убран, design 2026-11-09 §3.2; разворот решения прошлой спеки в журнале).
    // Пунктир: тип-уровневые (raw null без флага) и мапнутые OSL-статы (auto true); сплошной —
    // уникальный предмета и прямой OSL-стат (auto false)
    const dashed = _grantDashed(g);
    let h = `<div class="grant-row"><div class="affix special"><span class="schip${dashed ? ' auto' : ''}" data-skill="${esc(g.sk.stat)}" data-skill-ctx="grant" tabindex="0">` +
      `${_skillIconMarkup(g.sk)}${esc(skillName(g.sk))}</span></div>`;
    if (g.cond) h += `<div class="muted small">✦ ${esc(t('sk.grant.' + g.cond))}</div>`;
    if (full && isTouch()) { const desc = _skillDescText(g.sk); if (desc) h += `<div class="muted small">${esc(desc)}</div>`; }
    return h + '</div>';
  };
  return `<div class="d-block"><div class="bt">${esc(t('items.granted_skill'))}</div>` + grants.map(row).join('') + '</div>';
}
// Блок «Дает талант» detail-карточки (spec 2026-11-09-item-talent-grants §4.4): только detail
// (hover-карточка компактна — аффиксы там и так списком). title — tooltipTalent, как у строк секции.
function _detailGrantedTalent(it) {
  if (!it.grantedTalent) return '';
  const tl = CH.talents.selectable.find(x => x.name === it.grantedTalent) || CH.talents.questUnique.find(x => x.name === it.grantedTalent) || CH.talents.racial.find(x => x.name === it.grantedTalent);
  const name = tl ? esc(L(tl)) : esc(it.grantedTalent);
  const tip = tl ? ` title="${esc(tooltipTalent(it.grantedTalent))}"` : '';
  return `<div class="d-block"><div class="bt">${esc(t('items.granted_talent'))}</div><div class="affix special"${tip}>✦ ${name}</div></div>`;
}
// ctx === 'grant' — карточка навыка, выдаваемого предметом (design 2026-11-09-item-grants §4.2):
// «Требования» и «Недоступно» недействующая информация (fandom «Original Sin 2 Skills»: skills
// granted by items do not require Memory or Ability criteria; Larian #620180), память не тратится.
function skillCardHtml(sk, ctx) {
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
  // оружейные навыки — условие выдачи по экипировке (design 2026-11-07-weapon-skill-auto-grant §5.1)
  if (sk.src === 'weapon' && WEAPON_GRANT_KEYS[sk.auto])
    rows.push(`<div class="d-block"><div class="affix">✦ ${esc(t('sk.grant.' + WEAPON_GRANT_KEYS[sk.auto]))}</div></div>`);
  // грант-подпись: не для weapon — у них строка условия выше и есть «кем выдан» (§4.2)
  if (ctx === 'grant' && sk.src !== 'weapon')
    rows.push(`<div class="d-block"><div class="affix">✦ ${esc(t('sk.grant.item'))}</div></div>`);
  if (reqs && ctx !== 'grant') rows.push(`<div class="d-block"><div class="bt">${esc(t('sk.reqs'))}</div><div>${reqs}</div></div>`);
  if (!a.ok && !isAutoSkill(sk) && ctx !== 'grant') rows.push(`<div class="d-block"><div class="affix bad">⚠ ${esc(t('sk.locked', { what: skillMissingText(a.missing) }))}</div></div>`);
  // подпись под именем: тир + источник (alias второго языка убран — vision-челендж 2026-11-06:
  // EN-имя под RU-заголовком тот же избыточный дубль, что и название книги вторым языком)
  const sub = [sk.tier ? tierLabel(sk.tier) : '', skillSrcText(sk)].filter(Boolean).join(' · ');
  // заголовок и пилюля школы — одной строкой справа от иконки (vision-приёмка: без обёртки
  // flex-wrap ронял пилюлю на отдельную строку под заголовком)
  return `<div class="d-head sk-head"><span class="d-icon sk-icon">${_skillIconMarkup(sk)}</span>` +
    `<div class="d-titles"><h3>${esc(skillName(sk))}</h3><span class="d-chip">${esc(schoolLabel(sk.school))}</span></div></div>` +
    (sub ? `<div class="d-sub">${esc(sub)}</div>` : '') +
    _skillPips(sk, ctx) +
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
    // Eternals (design 2026-11-09): требование Str варится уровнем (wiki: 13 на 14..16, 14 на 17..22).
    const anc = (it.levelScale && it.levelScale.armorFormula) ? _scaleAnchor(it, state.level) : null;
    const need = (anc && anc.str != null) ? anc.str : it.requirements.value, have = f.attr[it.requirements.attribute] || 0, ok = have >= need;
    h += `<div class="d-req">${t('items.requires', {
      attr: `<b>${esc(attrNameRu(it.requirements.attribute))} ${need}</b>`,
      have: `<span class="${ok ? 'ok' : 'no'}">${have} ${ok ? '✓' : '✗'}</span>`
    })}</div>`;
  }
  // Level-scaled (design 2026-11-08 §5.3.4, r2-P1#1): снапшотный уровень — не требование,
  // строка «Уровень предмета» для scale-предметов не печатается вовсе; заголовок режима —
  // единственный раз — в блоке scale (_detailScale) и в hover-половинке.
  if (!it.levelScale && it.level != null) {
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
  if (it.physicalArmor || it.magicArmor) {
    // Броня с формулой (design 2026-11-09-eternals-armor-scale §5.1): числа на уровень билда,
    // статичная сторона остаётся на снапшоте — правило каждой стороны, как с оружием ниже.
    const ab = (it.levelScale && it.levelScale.armorFormula && typeof armorBaseAt === 'function')
      ? armorBaseAt(it, state.level) : null;
    main += t('items.armor', { p: (ab ? ab.pa : it.physicalArmor) || 0, m: (ab ? ab.ma : it.magicArmor) || 0 });
  }
  if (it.damage) {
    const d = it.damage;
    // WS8: если у оружия есть параметры формулы (damage.formula) — базовый урон считается
    // формулой движка generic(lvl,семейство)×DFB×Boost (app/js/damage.js weaponBase), а не берётся статичным числом.
    // Level-scaled (design 2026-11-08 §5.2): такое оружие считается на уровень билда (weaponBaseAt).
    const scaled = !!(it.levelScale && d.formula && typeof weaponBaseAt === 'function');
    const b = scaled ? weaponBaseAt(it, state.level)
      : (typeof weaponBase === 'function' ? weaponBase(it) : null);
    main += (main ? ' · ' : '') + t('items.damage', {
      dmg: b ? `${b.min}–${b.max}` : (d.min != null ? `${d.min}–${d.max}` : '—'),
      el: t('label.element.' + d.element) || d.element
    });
    if (scaled && state.level > 21) main += ` <span class="muted small">(${esc(t('items.scale.table_cap', { n: 21 }))})</span>`;
  }
  return main ? `<div class="d-block"><div class="bt">${t('items.base')}</div><div class="d-loc">${main}</div></div>` : '';
}
// Level-scaled items (design 2026-11-08 §5.3.3): блок между «Базой» и сравнением.
// lite=true — половинка для hover-карточки: заголовок режима + одна строка (progressive
// disclosure: якоря и ступени остаются в полной карточке, hover ≤ 74vh без прокрутки).
function _detailScale(it, lite) {
  const ls = it.levelScale;
  if (!ls) return '';
  const title = `<div class="d-req"><b>${esc(t('items.scale.title_' + ls.mode))}</b></div>`;
  // Броня с формулой (design 2026-11-09-eternals-armor-scale §5.2): динамическая шкала вместо
  // якорей — как weapon-ветка ниже; подсказок hint_below/hint_above нет намеренно (формула
  // честна вне диапазона, a 22-й уровень имеет число-носитель).
  if (ls.armorFormula && typeof armorBaseAt === 'function') {
    // Дедуп (design 2026-11-09-scale-dedup-meta-lines §2.1): строка «На уровень билда» убрана —
    // динамическое число печатает только «Основа» (_detailBase, armorBaseAt там же);
    // здесь остаётся заголовок режима + Диапазон (+ steps в полной карточке).
    const lo = armorBaseAt(it, ls.min), hi = armorBaseAt(it, ls.max);
    const rangeLine = (lo && hi) ? `<div class="d-loc muted">${esc(t('items.scale.range', {
      lo: `${lo.pa}/${lo.ma}`, l1: ls.min, hi: `${hi.pa}/${hi.ma}`, l2: ls.max }))}</div>` : '';
    if (!rangeLine) return '';
    if (lite) return title + rangeLine;
    return `<div class="d-block"><div class="bt">${esc(t('items.scale.title_' + ls.mode))}</div>${rangeLine}${_scaleSteps(ls)}</div>`;
  }
  const formula = !!(it.damage && it.damage.formula);
  if (formula && typeof weaponBaseAt === 'function') {
    // Дедуп (design 2026-11-09-scale-dedup-meta-lines §2.1): «На уровень билда» убрана,
    // единственное вхождение числа уровня билда — «Основа» (weaponBaseAt + cap-подпись там же).
    const lo = weaponBaseAt(it, ls.min), hi = weaponBaseAt(it, ls.max);
    const rangeLine = (lo && hi) ? `<div class="d-loc muted">${esc(t('items.scale.range', {
      lo: `${lo.min}–${lo.max}`, l1: ls.min, hi: `${hi.min}–${hi.max}`, l2: ls.max }))}</div>` : '';
    if (!rangeLine) return '';
    if (lite) return title + rangeLine;
    return `<div class="d-block"><div class="bt">${esc(t('items.scale.title_' + ls.mode))}</div>${rangeLine}${_scaleSteps(ls)}</div>`;
  }
  // Якорная ветка (design 2026-11-10-scale-unify §4): предметы без формулы (кольца/belt-колонка/
  // смешанный снапшот) — «Диапазон» из clamp'а по концам задокументированных якорей, тот же
  // формат, что у armorFormula/weapon: заголовок ровно один + Диапазон (+ steps). Якорей-списка,
  // «Показано для уровня» и hint нет (Эталон §1.3). Концы совпадают — одно значение без повтора.
  const pts = (ls.anchors || []).filter(a => a.pa != null || a.ma != null); // sorted by lvl
  const v = (a) => (a.pa != null ? `${a.pa}/${a.ma}` : `${a.ma}`);
  const lo = pts[0], hi = pts[pts.length - 1];
  const rangeLine = !lo ? '' : (lo === hi
    ? `<div class="d-loc muted">${esc(t('items.scale.range_one', { v: v(lo), l: lo.lvl }))}</div>`
    : `<div class="d-loc muted">${esc(t('items.scale.range', { lo: v(lo), l1: lo.lvl, hi: v(hi), l2: hi.lvl }))}</div>`);
  if (lite) return rangeLine ? title + rangeLine : '';
  const steps = _scaleSteps(ls);
  if (!rangeLine && !steps) return '';
  return `<div class="d-block"><div class="bt">${esc(t('items.scale.title_' + ls.mode))}</div>${rangeLine}${steps}</div>`;
}
function _scaleSteps(ls) {
  return (ls.steps || []).map(s =>
    `<div class="affix">${esc(t('items.scale.step_at', { n: s.at, txt: state.lang === 'ru' ? s.txt.ru : s.txt.en }))}</div>`).join('');
}
// Eternals (design 2026-11-09-eternals-armor-scale): якорь wiki на уровень билда — ОЗ-аффикс
// и требование Str варьируются уровнем по diff-таблице источника.
// Clamp — по СОБСТВЕННОМУ диапазону якорей (14..22), а не по ls.min: с 2026-11-09
// (2026-11-09-eternals-range-slot-line) ls.min=1 — граница шкалы брони по таблице движка,
// а wiki-чисел ОЗ/Сила ниже 14 нет; ниже диапазона якорей остаётся ближайший задокументированный.
function _scaleAnchor(it, lvl) {
  const ls = it.levelScale;
  const anchors = (ls && ls.anchors) || [];
  if (!anchors.length) return null;
  const lo = Math.min(...anchors.map(a => a.lvl)), hi = Math.max(...anchors.map(a => a.lvl));
  const l = Math.max(lo, Math.min(hi, Math.round(lvl)));
  return anchors.find(x => x.lvl === l) || null;
}
function _detailAffixes(it) {
  const anc = (it.levelScale && it.levelScale.armorFormula) ? _scaleAnchor(it, state.level) : null;
  const affHtml = it.affixes.map(a => {
    // anc.hp != null (design 2026-11-10-scale-unify, P2 инвариант QA): у новых armorFormula-якорей
    // hp нет — подмена ОЗ-аффикса возможна только когда якорь его документировал (Eternals).
    const aa = (anc && anc.hp != null && a.kind === 'vitality') ? { ...a, value: anc.hp } : a;
    return `<div class="affix ${a.kind === 'special' ? 'special' : a.kind === 'immunity' ? 'immunity' : ''}">${esc(affixText(aa))}</div>`;
  }).join('');
  // Level-scaled (design 2026-11-08 §5.2): аффиксы остаются снапшотными — блок подписывается,
  // для какого уровня даны числа, чтобы витрина ступеней не создавала ложного «+3» в расчёте.
  // Кроме armorFormula-предмета (ui-critic r-ETernals, B-находка): броня и ОЗ едут за уровнем
  // билда, а прочие аффиксы крафта на уровне одинаковы на всех уровнях — снапшот-подпись
  // «значения для ур. 16» противоречила бы динамической шкале.
  const cap = (it.levelScale && !(it.levelScale.armorFormula && anc))
    ? `<div class="muted small">${esc(t('items.scale.affix_at', { n: it.level != null ? it.level : '?' }))}</div>` : '';
  return affHtml ? `<div class="d-block"><div class="bt">${t('items.stats')}</div>${cap}${affHtml}</div>` : '';
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
  const dual = !!it.weaponType && DUAL_HAND.has(it.weaponType);
  let btn;
  if (it.slot === 'none') {
    btn = inBag ? `<button class="btn" data-bag="0">${t('items.remove_from_bag')}</button>` : `<button class="btn gold" data-bag="1">${t('items.to_bag')}</button>`;
  } else if (equipped) {
    btn = `<button class="btn" data-eq="0">${t('items.unequip')}</button>`;
  } else if (dual) {
    // оружие «в обе руки» — явный выбор руки сегментом из двух кнопок (design 2026-11-07-dual-hand §5.1)
    btn = `<button class="btn gold seg" data-eq="mh">${t('items.equip_mh')}</button>` +
          `<button class="btn gold seg" data-eq="oh">${t('items.equip_oh')}</button>`;
  } else {
    btn = `<button class="btn gold" data-eq="1">${t('items.equip')}</button>`;
  }
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
  // Броня с формулой (design 2026-11-09-eternals-armor-scale §5.3): сторона с armorFormula —
  // на уровень билда, статичная на снапшоте; геттер зеркалит damage-строку ниже.
  ['physicalArmor', 'items.cmp_pa', it => { const s = it.levelScale && it.levelScale.armorFormula && typeof armorBaseAt === 'function'; const a = s ? armorBaseAt(it, state.level) : null; return a ? a.pa : it.physicalArmor; }],
  ['magicArmor', 'items.cmp_ma', it => { const s = it.levelScale && it.levelScale.armorFormula && typeof armorBaseAt === 'function'; const a = s ? armorBaseAt(it, state.level) : null; return a ? a.ma : it.magicArmor; }],
  ['damage', 'items.cmp_damage', it => { const s = it.levelScale && it.damage && it.damage.formula && typeof weaponBaseAt === 'function'; const b = s ? weaponBaseAt(it, state.level) : (typeof weaponBase === 'function' ? weaponBase(it) : (it.damage && it.damage.min != null ? { min: it.damage.min, max: it.damage.max } : null)); return b ? (b.min + b.max) / 2 : null; }],
  ['level', 'items.cmp_level', it => it.level],
  ['runeSlots', 'items.cmp_runes', it => it.runeSlots],
];
const cmpDelta = (a, b) => Math.round((a - b) * 10) / 10;
// Data view of the comparison (the renderer only formats it): one group per worn item,
// each with the metrics where both sides have a number and the numbers differ.
function compareWithWorn(it) {
  let keys = SLOT_EQUIP_KEYS[it.slot];
  // оружие «в обе руки» маршрутируется и в off_hand — сравниваем с обеими руками
  // (design 2026-11-07-dual-hand §5.4: жезл тоже DUAL_HAND)
  if (it.slot === 'main_hand' && it.weaponType && DUAL_HAND.has(it.weaponType)) keys = ['main_hand', 'off_hand'];
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
// Level chip: у level-scale предметов — со зна ком ⚡; у оружия с формулой уровень эффективный
// (считается на уровень билда), у остальных — снапшот (design 2026-11-08 §5.3.4).
// Без ведущего « · »: с 2026-11-09 это отдельная смысловая строка d-meta-line (дедуп-спека).
// Эффективный уровень предмета: у scale-оружия и scale-брони — на уровне билда (кап 21/22),
// иначе — снапшот из данных; null, если уровня в данных нет (design 2026-11-09-equipped-level).
// Единый источник числа для карточки (_lvlChip) и ряда экипировки (renderEquip): ряд раньше
// дублил формулу урезанным копипастом и терял число у предметов без levelScale.
function _effLevel(it) {
  if (it.level == null) return null;
  if (!it.levelScale) return it.level;
  // Кап таблицы оружия — 21; у брони с формулой — clamp по диапазону фиксации [min, max]
  // (design 2026-11-10-scale-unify §5.1, челлендж r1 P1-2: у Devourer max=20, Contamination max=19 —
  // на билде 21–22 чип и числа обязаны показывать уровень max, а не уровень билда).
  return (it.damage && it.damage.formula) ? Math.min(21, state.level)
    : (it.levelScale.armorFormula) ? Math.min(it.levelScale.max || 22, Math.max(it.levelScale.min || 1, state.level)) : it.level;
}
function _lvlChip(it) {
  if (it.level == null) return '';
  if (it.levelScale) {
    return `${t('items.level_word', { n: _effLevel(it) })} <span role="img" aria-label="${esc(t('items.scale.badge'))}" title="${esc(t('items.scale.badge'))}">⚡</span>`;
  }
  return t('items.level_word', { n: it.level });
}
function _detailHead(it) {
  const badge = it.confidence && it.confidence !== 'wiki'
    ? `<span class="d-badge">${it.confidence === 'generated' ? t('items.generated') : t('items.imprecise')}</span>` : '';
  // Мета-строка: одна строка — один факт (design 2026-11-09-scale-dedup-meta-lines §2.2,
  // 2026-11-09-eternals-range-slot-line §3.2, затем 2026-11-09-slot-only-meta-line): для
  // экипировки «тип» и «слот» — дубль одного факта, оставлен слот без префикса («Основная
  // рука», «Ступни»); тип — в колонке «Тип» списка БД. Строки: слот · свойства (уровень ⚡+руны)
  // · цена; пустые не печатаются.
  const props = [_lvlChip(it), it.runeSlots ? t('items.runes', { n: it.runeSlots }) : '']
    .filter(Boolean).join(' · ');
  const lines = [
    t('label.slot.' + it.slot) || it.slot,
    props,
    it.value != null ? t('items.price_word', { n: it.value }) : '',
  ].filter(Boolean).map(s => `<div class="d-meta-line">${s}</div>`).join('');
  return `
    <div class="d-head"><span class="d-icon" title="${esc(it.icon ? t('items.icon_alt', { name: itemName(it) }) : t('items.icon_none'))}">${_iconMarkup(it, ICON_SPRITE ? ICON_SPRITE.cell[0] : 21)}</span><h3 class="r-${it.rarity}">${esc(itemName(it))}</h3>
      <span class="d-chip">${t('label.rarity.' + it.rarity) || it.rarity}</span>
      ${it.deOnly ? '<span class="d-badge">DE</span>' : ''}${badge}</div>
    <div class="d-sub">${lines}</div>`;
}
// Лист открывается с начала контента (spec 2026-11-10, D3): при смене предмета scrollTop
// сбрасывается — иначе sticky-пилюля накрывает шапку прошлого просмотра (APG Dialogs:
// initial focus в начале контента; HIG Scroll views: не доматывать без нужды). Перерисовка
// того же предмета позицию скролла сохраняет.
let _sheetSel = null;
function _sheetTop() { const sec = $('#detailSec'); if (sec && sec.scrollTop) sec.scrollTop = 0; }
function renderDetail() {
  const el = $('#detail');
  // чип перерисован — карточка не должна залипать (design 2026-11-09 §3.1)
  hideHoverCard();
  // Мобильный bottom-sheet: лист поднят, только когда предмет выбран (треб. 2/4, spec
  // 2026-11-04-drawer-bottomsheet). На desktop класс ни на что не влияет — правил нет.
  const b = document.body;
  if (b && b.classList) b.classList.toggle('item-open', !!selId);
  const swapped = _sheetSel !== selId;
  if (!selId) { _sheetSel = null; el.innerHTML = `<div class="empty">${t('items.empty_detail')}</div>`; _sheetTop(); return; }
  const it = itemById(selId);
  if (!it) { selId = null; _sheetSel = null; el.innerHTML = ''; _sheetTop(); return; }
  _sheetSel = it.id;
  const f = computeFinal();
  el.innerHTML = `
    ${_detailHead(it)}
    ${_detailReq(it, f)}
    ${_detailBase(it)}
    ${_detailScale(it, false)}
    ${_detailCompare(it)}
    ${_detailAffixes(it)}
    ${_detailGranted(it, true)}
    ${_detailGrantedTalent(it)}
    ${_detailLocation(it)}
    ${it.notes ? `<div class="d-note flavor">${esc(state.lang === 'ru' ? (it.flavorRu || it.notes) : it.notes)}</div>` : ''}
    ${_detailActions(it)}`;
  if (swapped) _sheetTop();
}
// Закрытие листа предмета (пилюля/стягивание/Esc — spec 2026-11-10, D2/D4). Возврат фокуса
// открывшему (APG Dialogs & Modals: «focus returns to the element that invoked the dialog»):
// строка экипировки → ряд #equipRows (узел пересоздан renderEquip — берём селектором),
// строка списка → ряд списка/поиск при открытой панели; панель закрыта — триггеру базы.
function closeItemSheet() {
  const was = selId, origin = _sheetOrigin;
  _sheetOrigin = null;
  selId = null; renderDB(); renderDetail();
  if (!was || !document.querySelector) return;
  const id = window.CSS && CSS.escape ? CSS.escape(was) : was;
  const bd = document.body;
  const drawerOpen = !!(bd && bd.classList && (bd.classList.contains('items-open') || bd.classList.contains('skills-open')));
  const row = (origin === 'equip' && document.querySelector('#equipRows [data-open="' + id + '"]'))
    || (drawerOpen && document.querySelector('#itemList .item-row[data-open="' + id + '"]'));
  const tgt = row || (drawerOpen ? $('#searchBox') : $('#drawerTab'));
  if (tgt && tgt.setAttribute) tgt.setAttribute('tabindex', '-1');
  if (tgt && tgt.focus) { try { tgt.focus({ preventScroll: true }); } catch (err) { tgt.focus(); } }
}
