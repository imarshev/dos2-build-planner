// Part 60-db-skills.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
/* ==================== 8b. База навыков (drawer, pane=skills) ================== */
// Второй список выезжающей панели: подбор изучаемых навыков. Фильтры и сортировка
// повторяют базу предметов — тот же жест (три состояния у шапки колонки) и та же
// разметка строки (.item-row), поэтому мобильная сетка наследуется.
const SKILL_TIERS = ['starter', 'novice', 'adept', 'master'];
const SKILL_SRCS = ['book', 'crafted', 'source', 'racial', 'origin', 'weapon', 'scroll'];
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
// ctx==='grant' — грант предмета: пилюля памяти не печатается (слот не занимает,
// design 2026-11-09-item-grants §4.2); одноаргументные вызовы (таблица, QA) не меняются.
const _skillPips = (sk, ctx) => {
  const rep = (n, img) => Array(n).fill(img).join('');
  const grp = (cls, label, inner) =>
    `<span class="sk-pips ${cls}" role="img" title="${esc(label)}" aria-label="${esc(label)}">${inner}</span>`;
  let h = '';
  if (sk.mem > 0 && ctx !== 'grant') h += grp('pip-mem', t('sk.mem_n', { n: sk.mem }), rep(sk.mem, PIP_IMG('cost_memory.png')) + `<span class="pip-w">${esc(t('sk.mem_w'))}</span>`);
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
  // один словарь имён у разных статусов (SHIELDED_MAGIC/SHIELDED_PHYSICAL → «Щит») даёт
  // неразличимые дубли чипов — схлопываем одинаковые подписи в одну (r2 P2)
  const uniq = [...new Set(labels)];
  if (!uniq.length) return '';
  return `<div class="d-block"><div class="bt">${esc(t('sk.effects'))}</div><div class="sk-fx">` +
    uniq.map((l) => `<span class="d-chip fx">${esc(l)}</span>`).join('') + '</div></div>';
};
