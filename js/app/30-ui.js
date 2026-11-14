// Part 30-ui.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
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
  special: a => (state.lang === 'ru' ? (a.nameRu || a.name) : a.name) || a.value || '',
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
  // selected — и собственный выбор, и грант от экипировки: в грант-строке эффект актив и печатается
  const selected = state.talents.includes(name) || state.questTalents.includes(name) || _itemTalentGrants().includes(name);
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
