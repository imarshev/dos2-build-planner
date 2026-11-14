// Part 87-plan-ui.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
// Панель «План прокачки»: рендер и события. Движок и хранилище — 12-plan.js
// (spec docs/superpowers/specs/2026-11-11-lvlup-plan-design.md §6; r2 §9, r3 §10).
// r3: «отметить» — галка с инвариантом префикса; каждый этап редактируем (оверрайд с флагом
// «изменено» и возвратом рекомендации); снятие mid-шага каскадно обратимо тостом; слоты —
// строки по образцу слотов сохранений (patterns.md §13–§15).
// r4: строка этапа — секции с бюджетами «доступно/потрачено», талант/вещь как в основном
// разделе (подробности по наведению), muted-сводка «ниже уровня»; слоты под кнопкой «Слоты»
// (spec §11, patterns.md §16–§19).
// r8 (spec 2026-11-14-plan-slots-popup-info-gate): слоты — поповер `#planSlotsPop` (дитро body,
// референс #slotsPanel; лента под таблицей шагов убрана); отказ «взять из билда» — aria-disabled
// кнопка + ⓘ-иконка с тултипом вместо жёлтой строки (причина доступна hover/focus/скринридеру).
'use strict';
// armAct — взведённое inline-подтверждение разрушительного действия (patterns.md §11/§12):
// 'take' | 'import' | null; первое нажатие взводит, второе — дверь (review M3/I5).
// confirm/rename — состояние слотов (зеркало slotsUI.confirm/rename, 85-misc-ui.js).
// r8: slots — ОТКРЫТОСТЬ ПОПОВЕРА слотов (было: раскрытость ленты, §16-прецедент состояния):
// живёт в панели, переживает renderPlan; закрытие drawer гасит поповер (инвариант setPlanOpen).
const planUi = { open: false, editing: null, draft: null, armAct: null, confirm: null, rename: null, slots: false };
// (r8, зеркало _confirmFocus из 85) взведение вопроса переносит фокус на «Отмена» один раз
let planArmFocus = false;
// Кнопка-действие панели (идеома атрибутов: data-act + делегат одного документа).
// r8: отказ — НЕ нативный disabled (MDN: «not focusable… won't receive browsing events» —
// носители подсказки не было бы ни у мыши, ни у клавиатуры), а aria-disabled + is-disabled:
// кнопка остаётся в tab-порядке, активацию гасит guard в planTakeFromBuild (отказ-тост).
// title убран: дубль тултипа ⓘ; причина ещё и в aria-describedby (planGateTip).
function planBtnHtml(act, label, opts) {
  const o = opts || {};
  return '<button class="btn ' + (o.ghost ? 'ghost ' : '') + (o.small ? 'small-btn ' : '') +
    (o.primary ? 'primary ' : '') + (o.cls || '') + (o.disabled ? 'is-disabled ' : '') +
    '" type="button" data-act="' + act + '"' +
    (o.idAttr ? ' data-id="' + o.idAttr + '"' : '') +
    (o.disabled ? ' aria-disabled="true"' : '') +
    (o.disabled && o.describedBy ? ' aria-describedby="' + o.describedBy + '"' : '') + '>' + label + '</button>';
}
// (r2-R1 / r3-R6) Гейт «взять из билда»: пока в билде есть свободные очки четырёх пулов, плана
// нет — предложение строится из распределённого спроса, а не из неизвестности. Скиллы и
// экипировка вне гейта (objective 2026-11-12). (r8, spec 2026-11-14) Причина живёт в тултипе ⓘ
// при кнопке и в отказ-тосте по клику; жёлтая строка убрана по запросу пользователя
// (см. аддендум §15 в patterns.md); planGapsNoteHtml изъят.
function planGapParts() {
  const g = planBuildGaps();
  const parts = [];
  if (g.attr) parts.push(t('plan.gap_attr', { n: g.attr }));
  if (g.combat) parts.push(t('plan.gap_combat', { n: g.combat }));
  if (g.civil) parts.push(t('plan.gap_civil', { n: g.civil }));
  if (g.talent) parts.push(t('plan.gap_talent', { n: g.talent }));
  return parts;
}
function planGapsReason() {
  const parts = planGapParts();
  return parts.length ? t('plan.need_full') + ': ' + parts.join(' · ') : '';
}
// (r8, spec 2026-11-14) ⓘ у отказанной кнопки — канон MDN tooltip_role: button с доступным
// именем, aria-describedby → role="tooltip"; тултип отрисуется всегда, когда виден ⓘ (не
// display:none), а гарантированный путь для скринридера — отказ-тост по клику (role=status).
// Показывается только когда гейт активен: ⓘ — маркер «действие недоступно ПОКА».
function planGateInfoHtml() {
  const parts = planGapParts();
  if (!parts.length) return '';
  const tip = esc(t('plan.need_full') + ': ' + parts.join(' · '));
  return '<span class="plan-info-wrap">' +
    '<button class="plan-info" type="button" data-act="planGateInfo"' +
    ' aria-label="' + esc(t('plan.info_label')) + '" aria-describedby="planGateTip">' +
    '<span aria-hidden="true">ⓘ</span></button>' +
    '<span class="plan-tip" role="tooltip" id="planGateTip">' + tip + '</span></span>';
}
function planHeadHtml(plan, steps) {
  const sum = planSummarize(plan, steps);
  const name = (plan && plan.name) || t('plan.unnamed');
  const stale = planTargetStale(plan)
    ? '<div class="plan-note warn" role="status">' + esc(t('plan.stale')) + '</div>'
    : '';
  // «взять» и «импорт» — опасные действия с morph-подтверждением (patterns.md §11, review M3/I5)
  const takeBtn = (plan && plan.marks.length && planUi.armAct === 'take')
    ? planBtnHtml('planTake', t('plan.overwrite_q'), { cls: 'danger' })
    : planBtnHtml('planTake', t(plan && plan.marks.length ? 'plan.take_again' : 'plan.take'),
      { primary: true, disabled: planGapsReason(), describedBy: 'planGateTip' });
  const importBtn = (plan && planUi.armAct === 'import')
    ? planBtnHtml('planImport', t('plan.import_q'), { cls: 'danger', small: true })
    : planBtnHtml('planImport', t('plan.import'), { ghost: true, small: true });
  return '<div class="plan-head">' +
    '<div class="plan-title-row"><span class="plan-name">' + esc(name) + '</span>' +
    '<span class="plan-count muted small">' + esc(t('plan.count')) + ' ' + sum.done + '/' + sum.total +
    (sum.deviations ? ' · ' + esc(t('plan.deviations')) + ' ' + sum.deviations : '') + '</span></div>' +
    '<div class="plan-bar">' + takeBtn + planGateInfoHtml() +
    planBtnHtml('planExport', t('plan.export'), { ghost: true, small: true }) +
    importBtn + planSlotsToggleHtml() +
    '</div>' + stale +
    (sum.starve ? '<div class="plan-note muted small">' + esc(t('plan.starved')) + '</div>' : '') +
    '</div>';
}
// Галка этапа: состояние «отмечен» + действие. Выше префикса — выключена (префикс — игровое
// правило: нельзя получить 4-й уровень без 3-го); причина — текст в строке, title — дополнение.
function planMarkBoxHtml(plan, level, checked) {
  const beyond = !checked && level !== plan.marks.length + 1;
  return '<label class="plan-mark"><input type="checkbox" data-act="planChk" data-id="' + level + '"' +
    (checked ? ' checked' : '') +
    (beyond ? ' disabled title="' + esc(t('plan.locked')) + '"' : '') +
    ' aria-label="' + esc(t('plan.mark_title', { n: level })) + '"></label>';
}
// ---- Ревизия r4 (objective 2026-11-13): содержимое строки этапа ----
// (R1) Таланты и снаряжение рисуются как в основном разделе билдера: талант — имя + эффект
// (строка .teff) с игровым описанием по наведению (title=tooltipTalent, §18 паттернов);
// вещь — span .item r-{rarity} с уровнем и hover-карточкой (хост planBody в 90-events,
// payload-предметы резолвятся planItemById). Эffect — essential, поэтому НЕ в title.
const PLAN_TALENT_ALL = () => [].concat(CH.talents.selectable || [], CH.talents.racial || [],
  CH.talents.questUnique || []);
function planTalentHtml(name) {
  const tl = PLAN_TALENT_ALL().find(x => x.name === name);
  const eff = tl ? TT(tl, 'effect') : '';
  return '<span class="plan-talent" title="' + esc(tooltipTalent(name)) + '">' +
    '<span class="plan-talent-n">' + esc(talentLabel(name)) + '</span>' +
    (eff ? '<span class="teff">' + esc(eff) + '</span>' : '') + '</span>';
}
function planGearItemHtml(id) {
  const it = planItemById(planState.working, id);
  if (!it) return '<span class="plan-chip plan-chip-gear">' + esc(id) + '</span>';
  const lvl = (typeof _effLevel === 'function') ? _effLevel(it)
    : (Number.isFinite(it.level) ? it.level : null);
  const badge = it.levelScale
    ? ' <span role="img" aria-label="' + esc(t('items.scale.badge')) + '" title="' + esc(t('items.scale.badge')) + '">⚡</span>'
    : '';
  const lvlFrag = lvl != null
    ? ' <small class="muted">' + esc(t('items.level', { n: lvl })) + badge + '</small>' : '';
  return '<span class="item r-' + esc(String(it.rarity || 'common')) + '" data-open="' + esc(it.id) +
    '" data-plan-item="1">' + esc(itemName(it)) + lvlFrag + '</span>';
}
function planGearHtml(gearIds) {
  if (!gearIds || !gearIds.length) return '';
  return '<div class="plan-gear">' + esc(t('plan.gear')) + ': ' +
    gearIds.map(planGearItemHtml).join(' ') + '</div>';
}
// (R4→r5-R1) Секция пула: заголовок = тот же термин, что в основном листе; СЧЁТЧИК
// «доступно · потрачено» из ленты убран (patterns.md §21b, spec §12: в read-only «доступно»
// не на что влиять, «потрачено» уже напечатано чипами). Чипы вложенного ТЕКУЩЕГО уровня —
// синие (r4-R5, паттерны §19: цвет не единственный носитель — «Ур. N» текстовый).
function planSecsHtml(inv, budget) {
  const one = (kind, m) => Object.entries(m || {}).map(([id, v]) =>
    '<span class="plan-chip plan-chip-' + kind + ' plan-chip-cur">' +
    esc(kind === 'attr' ? attrLabel(id) : planSkillLabel(id)) + ' +' + v + '</span>').join('');
  const sec = (label, items) =>
    '<div class="plan-sec"><div class="plan-sh">' + esc(label) + '</div>' +
    '<div class="plan-chips">' + (items || '<span class="muted small">' + esc(t('plan.spent_none')) + '</span>') +
    '</div></div>';
  const secs = [];
  if (budget.attr.avail || budget.attr.spent) secs.push(sec(t('section.attrs'), one('attr', inv.attr)));
  if (budget.combat.avail || budget.combat.spent) secs.push(sec(t('section.combat'), one('combat', inv.combat)));
  if (budget.civil.avail || budget.civil.spent) secs.push(sec(t('section.civil'), one('civil', inv.civil)));
  if (budget.talent.avail || budget.talent.spent) {
    secs.push(sec(t('section.talents'), (inv.talents || []).map(planTalentHtml).join(' ')));
  }
  return secs.join('') || '<div class="plan-sec"><div class="plan-chips muted small">' + esc(t('plan.none')) + '</div></div>';
}
// (r7, objective 2026-11-13) Строку «Ниже уровня вложено: …» убрано из карточки шага: её числа —
// это чужие уровни, а карточка обязана говорить об этом уровне (data-ink §21b, r6-прецедент со
// «почему так»); после каскадного снятия шага она врёт про «вложено ниже», потому что ниже уже
// ничего не осталось. Хелпер planBelowHtml (r4-R5) и ключ plan.below изъяты; бюджет шага
// редактор считает из тех же полей движка (step.below, planMarkBudget — они остались фактом).
// Строка уровня. Отмеченный — ФАКТ (состав из отметки); неотмеченный — применённый состав шага
// (оверрайд или рекомендация): предложение видно на всех уровнях всегда (r2-R4, r3-R2).
// r4: секции с бюджетами, талант/экипировка — как в основном разделе.
function planRowHtml(step, plan, cursor) {
  const mk = plan.marks.find(m => m.level === step.level);
  const lvl = '<span class="plan-lvl">' + esc(t('plan.level')) + ' ' + step.level + '</span>';
  const edit = planBtnHtml('planEdit', t('plan.edit'), { ghost: true, small: true, idAttr: step.level });
  if (mk) {
    const mb = planMarkBudget(plan, step.level, mk.inv);
    return '<div class="plan-row plan-done" data-level="' + step.level + '">' +
      planMarkBoxHtml(plan, step.level, true) + lvl +
      '<span class="plan-secs">' + planSecsHtml(mk.inv, mb.budget) + '</span>' +
      (mk.deviation ? '<span class="plan-flag">' + esc(t('plan.deviation')) + '</span>' : '') +
      planGearHtml(mk.inv.gear) +
      (planUi.editing === step.level ? planEditorHtml(step, plan) : '') +
      '<span class="plan-actions">' + edit + '</span></div>';
  }
  const open = step.level === cursor;
  const flag = step.override ? '<span class="plan-flag">' + esc(t('plan.edited')) + '</span>' : '';
  const revert = step.override && planUi.editing !== step.level
    ? planBtnHtml('planRevert', t('plan.revert'), { ghost: true, small: true, idAttr: step.level }) : '';
  const actions = planUi.editing === step.level
    ? planBtnHtml('planEditApply', t('plan.mark'), { primary: true }) +
      planBtnHtml('planEditCancel', t('plan.cancel_edit'), { ghost: true, small: true }) + revert
    : edit + revert;
  const bd = step.budget || planMarkBudget(plan, step.level, step.suggested);
  return '<div class="plan-row' + (open ? ' plan-cur' : '') + '" data-level="' + step.level + '">' +
    planMarkBoxHtml(plan, step.level, false) + lvl +
    '<span class="plan-secs' + (open ? '' : ' plan-next') + '">' +
    planSecsHtml(step.suggested, bd) + '</span>' + flag +
    planGearHtml(step.gear) +
    (open && step.deferred ? '<span class="plan-note muted small">' + esc(t('plan.deferred')) + '</span>' : '') +
    (planUi.editing === step.level ? planEditorHtml(step, plan) : '') +
    (!open ? '<span class="plan-note muted small">' + esc(t('plan.locked')) + '</span>' : '') +
    '<span class="plan-actions">' + actions + '</span></div>';
}
// (r6, objective 2026-11-13) Строку «почему так: X > Y» убрано из шагов: в ленте будущего
// этапа она спорит с полным редактором (там видно все варианты) и шумит в read-only (§21b,
// data-ink); поле движка step.why остаётся фактом. Хелпер planWhyText и ключ plan.why изъяты.
const attrLabel = (id) => {
  const a = CH.attributes.find(x => x.id === id);
  if (!a) return id;
  return state.lang === 'ru' ? (a.nameRu || a.name) : a.name;
};
// Боевые и мирные умения панели — имена из character.json: SKILL_RU (skillLabel) — словарь
// названий предметов, идентификаторы умений его не содержит (в кадре приёмки это и поймано).
const PLAN_ABILITIES = [].concat(CH.combatAbilities.schools, CH.combatAbilities.weapon,
  CH.combatAbilities.defence, CH.civilAbilities.list);
const planSkillLabel = (id) => {
  const s = PLAN_ABILITIES.find(x => x.id === id);
  return s ? (state.lang === 'ru' ? (s.nameRu || s.name) : s.name) : skillLabel(id);
};
const talentLabel = (name) => {
  const t0 = PLAN_TALENT_ALL().find(x => x.name === name);
  if (!t0) return name;
  return state.lang === 'ru' ? (t0.nameRu || t0.name) : t0.name;
};
// Контекст легальности для черновика: вложения факта + оверрайды ниже уровня + очки/выбор
// пользователя (review I1; r3-R2 — planUserPoolsAt, а не только отметки)
function planDraftCtx(plan, level, draft) {
  const pools = planUserPoolsAt(plan, level);
  const d = draft || {};
  const ctx = { plan: plan, L: level,
    attr: Object.assign({}, pools.attr), combat: Object.assign({}, pools.combat),
    civil: Object.assign({}, pools.civil),
    talents: [].concat(pools.talents || []), gear: [] };
  for (const m of plan.marks) if (m.level < level) for (const g of (m.inv.gear || [])) ctx.gear.push(g);
  const min = plan.marks.length + 1;
  for (const [k, oinv] of Object.entries(planOverridesOf(plan))) {
    const lv = parseInt(k, 10);
    if (lv >= min && lv < level) for (const g of (oinv.gear || [])) if (ctx.gear.indexOf(g) < 0) ctx.gear.push(g);
  }
  for (const k of ['attr', 'combat', 'civil']) {
    if (d[k]) for (const [x, v] of Object.entries(d[k])) ctx[k][x] = (ctx[k][x] || 0) + v;
  }
  for (const tn of d.talents || []) if (ctx.talents.indexOf(tn) < 0) ctx.talents.push(tn);
  for (const g of d.gear || []) if (ctx.gear.indexOf(g) < 0) ctx.gear.push(g);
  ctx.pools = pools;
  return ctx;
}
// Редактор уровня (r3-R1 → r5-R2, spec §12): ВСЕ варианты каждого пула; число в степпере —
// ИТОГ (база + вложения ниже + состав шага, живьём; patterns.md §20 — APG spinbutton держит
// значение, конвенция .srow билдера), свободный бюджет шага — в шапке секции («свободно/бюджет»,
// идиома пула основного билдера), изменённое относительно применённого состава — синим и
// точкой-формой (patterns.md §21: WCAG 1.4.1 — цвет не единственный носитель). Нелегальное
// показано выключенным (review I1); бюджет — планUserPoolsAt с учётом черновика (review r1).
const PLAN_ATTR_BASE = (id) => {
  const a = CH.attributes.find(x => x.id === id);
  return (a && Number.isFinite(a.base)) ? a.base : 10;
};
function planEditorHtml(step, plan) {
  const d = planUi.draft || {};
  const pools = planUserPoolsAt(plan, step.level);
  const mk = plan.marks.find(m => m.level === step.level);
  const applied = mk ? mk.inv : (step.suggested || { attr: {}, combat: {}, civil: {}, talents: [], gear: [] });
  const dsum = (kind) => Object.values(d[kind] || {}).reduce((a, v) => a + (v | 0), 0);
  const budgetOf = { attr: pools.attrTotal - pools.attrSpent,
    combat: pools.combatTotal - pools.combatSpent, civil: pools.civilTotal - pools.civilSpent };
  const freeOf = { attr: budgetOf.attr - dsum('attr'), combat: budgetOf.combat - dsum('combat'),
    civil: budgetOf.civil - dsum('civil') };
  const stepBtn = (kind, id, delta, disabled) =>
    '<button class="btn ghost small-btn" type="button" data-act="planDraft" data-id="' + kind + ':' + esc(id) +
    '" data-d="' + delta + '"' + (disabled ? ' disabled' : '') + '>' + (delta < 0 ? '−' : '+') + '</button>';
  const row = (kind, id) => {
    const v = (d[kind] && d[kind][id]) || 0;
    const av = (applied[kind] && applied[kind][id]) || 0;
    const below = (pools[kind] && pools[kind][id]) || 0;
    const base = kind === 'attr' ? PLAN_ATTR_BASE(id) : 0;
    const total = base + below + v;
    const changed = v !== av;
    const label = kind === 'attr' ? attrLabel(id) : planSkillLabel(id);
    // дельта-чип печатаем, только когда ИТОГ ≠ дельте (иначе «War 2 +2» = лишний ink, §21b)
    const chip = (v > 0 && base + below > 0) ? ' <span class="plan-ed-delta">+' + v + '</span>' : '';
    return '<span class="plan-step' + (changed ? ' plan-ed-diff' : '') + '"' +
      (changed ? ' title="' + esc(t('plan.ed_was', { n: base + below + av })) + '"' : '') + '>' +
      esc(label) + stepBtn(kind, id, -1, v <= 0) +
      '<span class="plan-step-v">' + total + '</span>' + stepBtn(kind, id, 1, freeOf[kind] <= 0) + chip + '</span>';
  };
  const rows = (kind, ids) => ids.map(id => row(kind, id)).join('');
  const sec = (title, body, counter) => '<div class="plan-esec"><span class="plan-esec-title">' + esc(title) +
    (counter ? ' <span class="plan-bn">' + esc(counter) + '</span>' : '') + '</span>' + body + '</div>';
  // Чекбоксы доступных талантов и снаряжения (спека §6): пользователь отмечает фактом, что
  // взял именно это; нелегальное показано, но выключено (review I1). Изменённое относительно
  // применённого состава — синим и точкой (r5-R2); подробности — title (§18).
  const ctx = planDraftCtx(plan, step.level, d);
  const factTalents = ctx.pools.talents || [];
  const talentBudget = Math.max(0, pools.talentPicks - factTalents.length);
  const inApp = (arr, x) => ((arr || []).indexOf(x) >= 0);
  const talentBoxes = (PLAN_TALENTS() || []).map(tt => {
    const name = tt.name;
    // талант, лежащий ниже уровня фактом, показан галкой и не переключается: он не этого этапа
    const inFact = factTalents.indexOf(name) >= 0;
    const on = inFact || ((d.talents || []).indexOf(name) >= 0);
    const can = on || planLegal('talent', name, planDraftCtx(plan, step.level, d));
    const changed = !inFact && on !== inApp(applied.talents, name);
    return '<label class="plan-check' + (changed ? ' plan-ed-diff' : '') + '"' +
      ' title="' + esc(tooltipTalent(name)) + '"><input type="checkbox" data-act="planTog" data-id="' +
      esc('talent:' + name) + '"' + (on ? ' checked' : '') + (can ? '' : ' disabled') + '>' +
      '<span>' + esc(talentLabel(name)) + '</span></label>';
  }).join('');
  const box = (kind, id, label, on) =>
    '<label class="plan-check' + (on !== inApp(applied.gear, id) ? ' plan-ed-diff' : '') + '"><input type="checkbox"' +
    ' data-act="planTog" data-id="' + esc(kind + ':' + id) + '"' +
    (on ? ' checked' : '') + ((on || planLegal(kind, id, ctx)) ? '' : ' disabled') + '><span>' + esc(label) + '</span></label>';
  const factGear = [];
  for (const m of plan.marks) if (m.level < step.level) for (const g of (m.inv.gear || [])) factGear.push(g);
  const gearBoxes = (plan.target.gear || []).filter(g => factGear.indexOf(g.id) < 0)
    .map(g => { const it = planItemById(plan, g.id);
      return box('gear', g.id, it ? itemName(it) : g.id, (d.gear || []).indexOf(g.id) >= 0); }).join('');
  const talentFree = Math.max(0, talentBudget - Math.max(0, (d.talents || []).length -
    (d.talents || []).filter(n => factTalents.indexOf(n) >= 0).length));
  return '<div class="plan-editor">' +
    sec(t('section.attrs'), rows('attr', ATTR_IDS), budgetOf.attr ? freeOf.attr + '/' + budgetOf.attr : '') +
    sec(t('section.combat'), rows('combat', COMBAT_IDS), budgetOf.combat ? freeOf.combat + '/' + budgetOf.combat : '') +
    sec(t('section.civil'), rows('civil', CIVIL_IDS), budgetOf.civil ? freeOf.civil + '/' + budgetOf.civil : '') +
    sec(t('section.talents'), talentBoxes, talentBudget ? talentFree + '/' + talentBudget : '') +
    (gearBoxes ? sec(t('plan.gear'), gearBoxes, '') : '') +
    '</div>';
}
// Переключение чекбокса редактора: снятие разрешено всегда, добавление — только легальное
function planTogToggle(kindId) {
  const plan = planState.working;
  if (!plan || planUi.editing == null) return;
  const s = String(kindId), i = s.indexOf(':');
  const kind = s.slice(0, i), id = s.slice(i + 1);
  const d0 = planUi.draft || { attr: {}, combat: {}, civil: {}, talents: [], gear: [] };
  const next = Object.assign({}, d0);
  if (kind === 'talent') {
    // талант, лежащий ниже уровня фактом, из черновика не вынимается — он не этого уровня
    const fact = (planUserPoolsAt(plan, planUi.editing).talents || []);
    if (id && fact.indexOf(id) >= 0) return;
    const cur = [].concat(d0.talents || []);
    if (cur.indexOf(id) >= 0) next.talents = cur.filter(x => x !== id);
    else { if (!planLegal('talent', id, planDraftCtx(plan, planUi.editing, d0))) return; next.talents = cur.concat([id]); }
  } else {
    const cur = [].concat(d0.gear || []);
    if (cur.indexOf(id) >= 0) next.gear = cur.filter(x => x !== id);
    else { if (!planLegal('gear', id, planDraftCtx(plan, planUi.editing, d0))) return; next.gear = cur.concat([id]); }
  }
  planUi.draft = next;
  renderPlan();
}
// Черновик → состав уровня: предзаполнен применённым составом этапа, потому «изменить» —
// это правка того, что видно, а не сочинение с нуля (r3-R2)
function planDraftInv() {
  const d = planUi.editing == null ? {} : (planUi.draft || {});
  return { attr: Object.assign({}, d.attr || {}), combat: Object.assign({}, d.combat || {}),
    civil: Object.assign({}, d.civil || {}), talents: [].concat(d.talents || []),
    gear: [].concat(d.gear || []) };
}
function planOpenEditor(level) {
  const plan = planState.working;
  if (!plan || !Number.isInteger(level) || level < 1 || level > plan.target.level) return;
  const mk = plan.marks.find(m => m.level === level);
  const step = planSteps(plan).find(s => s.level === level);
  const src = mk ? mk.inv : (step ? step.suggested : { attr: {}, combat: {}, civil: {}, talents: [], gear: [] });
  planUi.editing = level;
  planUi.draft = { attr: Object.assign({}, src.attr), combat: Object.assign({}, src.combat),
    civil: Object.assign({}, src.civil), talents: [].concat(src.talents || []),
    gear: [].concat(src.gear || []) };
  renderPlan();
}
// Применить правку: отмеченный этап — перепись ФАКТА (r3-R2: любой этап изменяем),
// неотмеченный — оверрайд (или возврат к рекомендации, если совпал с ней).
function planEditorApply() {
  const plan = planState.working;
  const level = planUi.editing;
  if (!plan || level == null) return;
  const inv = planDraftInv();
  if (!planMarkComplete(plan, level, inv)) { toast(t('plan.incomplete')); return; }
  if (level <= plan.marks.length) {
    planEditMark(plan, level, inv, { recommended: planRecommendAt(plan, level) });
  } else {
    const step = planSteps(plan).find(s => s.level === level);
    if (step && planInvEqual(inv, step.rec)) planClearOverride(plan, level);
    else planSetOverride(plan, level, inv);
  }
  planUi.editing = null; planUi.draft = null;
  planStore.save(planState);
  renderPlan();
}
// (r4-R2/APG disclosure, r8) Кнопка-триггер поповера: подпись НЕ меняется при переключении
// (APG Button Pattern, паттерны §16), состояние — aria-expanded, счётчик занятых слотов даёт
// info scent на закрытом блоке («может быть проигнорировано», NN/g 2014). aria-controls —
// на поповер (р8: ретаргет с мёртвой ленты planSlotsWrap).
function planSlotsToggleHtml() {
  const used = planState.slots.filter(Boolean).length;
  return '<button class="btn ghost small-btn" type="button" data-act="planSlots"' +
    ' aria-expanded="' + (planUi.slots ? 'true' : 'false') + '" aria-controls="planSlotsPop"' +
    ' title="' + esc(t('plan.slots_btn_title')) + '">' + esc(t('plan.slots_btn')) +
    ' <span class="plan-bn">' + used + '/' + PLAN_N + '</span></button>';
}
function planBodyHtml(plan, steps) {
  // (r8) ленту слотов под таблицей убрали: слоты — поповер `#planSlotsPop`; кнопка «Слоты»
  // обязана быть и в ПУСТОМ состоянии — загрузить план из слота иначе нечем
  if (!plan) {
    return '<div class="plan-empty muted">' + esc(t('plan.empty')) + '</div>' +
      '<div class="plan-bar">' +
      planBtnHtml('planTake', t('plan.take'),
        { primary: true, disabled: planGapsReason(), describedBy: 'planGateTip' }) +
      planGateInfoHtml() +
      planSlotsToggleHtml() + '</div>';
  }
  const cursor = plan.marks.length + 1;
  // лента полная: отмеченные уровни остаются в списке фактом (движок их не возвращает),
  // иначе пользователь теряет из вида, чем именно он закрыл курс
  const rows = plan.marks.map(m => planRowHtml({ level: m.level }, plan, cursor)).join('') +
    steps.map(s => planRowHtml(s, plan, cursor)).join('');
  return planHeadHtml(plan, steps) +
    '<div class="plan-list">' + rows + '</div>';
}
// ---------- Слоты плана: строки по образцу слотов сохранений (r3-R7, patterns §5) ----------
// Номер + имя (rename) + мета + «Загрузить»/«Сохранить»/⤓/⤒/✕; arming ничего не пишет;
// на занятый — вопрос с именем и датой; мёртвая зона после удаления; тосты с undo.
// (r8) живут в поповере `#planSlotsPop` (дитро body), не в ленте под шагами.
const PLAN_CLEAR_MS = 700;
let planSlotLastDel = null;
let planClearTimer = null; // dead-zone timer for a repainted popover row (mirrors 85 _clearTimer)
const planJustCleared = i => !!planSlotLastDel && planSlotLastDel.i === i && Date.now() - planSlotLastDel.at < PLAN_CLEAR_MS;
const planForgetClear = i => { if (planSlotLastDel && planSlotLastDel.i === i) planSlotLastDel = null; };
const planSlotDisplayName = (s, i) => (s && s.name) ? s.name : t('plan.slot') + ' ' + (i + 1);
function planSlotMeta(s) {
  const marks = s.plan && s.plan.marks ? s.plan.marks.length : 0;
  const total = s.plan && s.plan.target ? s.plan.target.level : 0;
  const date = slotDateShort(s.savedAt);
  return t('plan.count') + ' ' + marks + '/' + total + (date ? ' · ' + date : '');
}
// (r8) лента-обёртка planSlotsHtml изжита вовсе: строки красятся в список поповера (#planSlotsList),
// оболочка (шапка/✕) — статическая, в index.html.
function renderPlanSlots() {
  const pop = document.querySelector && document.querySelector('#planSlotsPop');
  const list = document.querySelector && document.querySelector('#planSlotsList');
  if (!pop || !list) return;
  if (!planUi.slots) { pop.hidden = true; return; }
  let h = '';
  for (let i = 0; i < PLAN_N; i++) h += planSlotRowHtml(i);
  list.innerHTML = h;
  // мёртвая зона — состояние, а не узел (образец renderSlots из 85): перекраска строки после
  // чужого удаления сохраняет .cleared, таймер пересаживается на ТЕКУЩИЙ узел
  const dead = list.querySelector && list.querySelector('.slot-row.cleared');
  if (dead) {
    const left = Math.max(0, (planSlotLastDel ? planSlotLastDel.at : 0) + PLAN_CLEAR_MS - Date.now());
    if (planClearTimer) clearTimeout(planClearTimer);
    planClearTimer = setTimeout(() => { if (dead.classList) dead.classList.remove('cleared'); }, left);
  }
  // взведение вопроса переносит фокус на безопасное «Отмена» (APG note 1, зеркало 85)
  if (planArmFocus) {
    planArmFocus = false;
    const c = list.querySelector && list.querySelector('.slot-row.confirm [data-act="planSlotCancel"]');
    if (c) focusQuiet(c);
  }
  planWireRename(list);
}
function planPopEl() { return document.querySelector ? document.querySelector('#planSlotsPop') : null; }
function planSlotsTriggerEl() {
  return document.querySelector ? document.querySelector('#planBody [data-act="planSlots"]') : null;
}
// позиционирование: desktop — фиксированный слой под триггером, right- край у края вьюпорта
// (drawer прижат вправо); мобильный bottom-sheet — CSS-слой .slots-panel, inline top не нужен
function planPlacePop(pop) {
  const wide = !(window.matchMedia && window.matchMedia('(max-width: 740px)').matches);
  const b = planSlotsTriggerEl();
  if (!wide || !b || !b.getBoundingClientRect || !pop.getBoundingClientRect) { pop.style.top = ''; pop.style.left = ''; return; }
  const r = b.getBoundingClientRect();
  const w = pop.getBoundingClientRect().width || pop.offsetWidth || 540;
  const h = pop.getBoundingClientRect().height || pop.offsetHeight || 320;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  pop.style.top = Math.max(12, Math.min(r.bottom + 6, vh - h - 12)) + 'px';
  pop.style.left = Math.max(12, Math.min(r.right - w, vw - w - 12)) + 'px';
}
function openPlanSlots() {
  const pop = planPopEl();
  if (!pop) return;
  planUi.slots = true;
  // перекраска ленты поднимет aria-expanded триггера (APG disclosure: состояние на кнопке
  // живёт до ближайшей перерисовки — обещания «не расходиться» она давать не может)
  renderPlan();
  pop.hidden = false;
  planPlacePop(pop);
  if (pop.focus) focusQuiet(pop);
}
// (r8) возврат фокуса — только when the user закрывает поповер сам (Esc/✕/клик-вовне/повторный
// клик); закрытие drawer (setPlanOpen) не тащит фокус на невидимый триггер (образец closeSlots 85)
function closePlanSlots(returnFocus) {
  if (!planUi.slots) return;
  planUi.slots = false;
  // незакоммиченное имя не должно бесследно исчезать (blur коммитит, как в closeSlots)
  if (planUi.rename != null) {
    const inp = document.querySelector && document.querySelector('#planSlotsList .slot-rename');
    if (inp && inp.blur) inp.blur();
  }
  planUi.confirm = null;
  planUi.rename = null;
  const pop = planPopEl();
  if (pop) pop.hidden = true;
  // триггер живёт в planBody: перекрашиваем aria-expanded ДО возврата фокуса
  // (перекраска выбрасывает старый узел триггера из DOM)
  renderPlan();
  if (returnFocus) {
    const b = planSlotsTriggerEl();
    if (b) focusQuiet(b);
  }
}
function planSlotRowHtml(i) {
  const s = planState.slots[i];
  const conf = planUi.confirm && planUi.confirm.i === i ? planUi.confirm : null;
  if (s && conf) {
    const del = conf.kind === 'delete';
    const q = del
      ? t('slots.delete_q', { name: planSlotDisplayName(s, i), n: i + 1, date: slotDateShort(s.savedAt) || '—' })
      : t('slots.overwrite_q', { name: planSlotDisplayName(s, i), date: slotDateShort(s.savedAt) || '—' });
    return '<div class="slot-row plan-slot-row confirm' + (del ? ' confirm--del' : '') + '" data-i="' + i + '">' +
      '<span class="slot-n">' + (i + 1) + '</span>' +
      '<span class="slot-main"><span class="slot-q" id="plan-slot-q-' + i + '">' + esc(q) + '</span>' +
      '<span class="slot-meta muted small">' + esc(planSlotMeta(s)) + '</span></span>' +
      '<span class="slot-acts">' +
      '<button class="btn' + (del ? ' danger' : ' gold') + ' small-btn" type="button" data-act="planSlotConfirm" data-id="' + i +
      '" aria-describedby="plan-slot-q-' + i + '">' + esc(t(del ? 'slots.delete_do' : 'slots.overwrite_do')) + '</button>' +
      '<button class="btn ghost small-btn" type="button" data-act="planSlotCancel" data-id="' + i +
      '" aria-describedby="plan-slot-q-' + i + '">' + esc(t('slots.cancel')) + '</button></span></div>';
  }
  if (!s) {
    return '<div class="slot-row plan-slot-row empty' + (planJustCleared(i) ? ' cleared' : '') + '" data-i="' + i + '">' +
      '<span class="slot-n">' + (i + 1) + '</span>' +
      '<span class="slot-meta muted small">' + esc(t('slots.empty')) + '</span>' +
      '<span class="slot-acts">' +
      '<button class="btn ghost small-btn" type="button" data-act="planSlotSave" data-id="' + i + '">' + esc(t('slots.save')) + '</button>' +
      '<button class="spick" type="button" data-act="planSlotImport" data-id="' + i + '" title="' + esc(t('slots.import')) +
      '" aria-label="' + esc(t('slots.import')) + '">⤒</button></span></div>';
  }
  const nameHtml = planUi.rename === i
    ? '<input class="slot-rename" maxlength="40" value="' + esc(s.name) + '" aria-label="' + esc(t('slots.rename_title')) + '">'
    : '<button class="slot-name" type="button" data-act="planSlotRename" data-id="' + i + '" title="' + esc(t('slots.rename_title')) + '">' +
      esc(planSlotDisplayName(s, i)) + '</button>';
  return '<div class="slot-row plan-slot-row" data-i="' + i + '">' +
    '<span class="slot-n">' + (i + 1) + '</span><span class="slot-main">' + nameHtml +
    '<span class="slot-meta muted small">' + esc(planSlotMeta(s)) + '</span></span>' +
    '<span class="slot-acts">' +
    '<button class="btn ghost small-btn" type="button" data-act="planSlotLoad" data-id="' + i + '">' + esc(t('slots.load')) + '</button>' +
    '<button class="btn ghost small-btn" type="button" data-act="planSlotSave" data-id="' + i + '">' + esc(t('slots.save')) + '</button>' +
    '<button class="spick" type="button" data-act="planSlotExport" data-id="' + i + '" title="' + esc(t('slots.export')) +
    '" aria-label="' + esc(t('slots.export')) + '">⤓</button>' +
    '<button class="spick" type="button" data-act="planSlotImport" data-id="' + i + '" title="' + esc(t('slots.import')) +
    '" aria-label="' + esc(t('slots.import')) + '">⤒</button>' +
    '<button class="spick" type="button" data-act="planSlotDel" data-id="' + i + '" title="' + esc(t('slots.del')) +
    '" aria-label="' + esc(t('slots.del')) + '">✕</button></span></div>';
}
function planSlotSetName(i, name) {
  const s = planState.slots[i];
  if (!s) return;
  s.name = String(name || '');
  planUi.rename = null;
  planStore.save(planState);
  renderPlan();
}
function planSaveSlot(i) {
  planUi.confirm = null;
  // второй клик под пальцем после «✕» ничего не пишет (образец 85-misc-ui)
  if (planJustCleared(i)) return;
  const plan = planState.working;
  if (!plan) { toast(t('plan.nothing_to_save')); return; }
  const s = planState.slots[i];
  // занятый слот — только через вопрос
  if (s) { planUi.confirm = { i: i, kind: 'save' }; planArmFocus = true; renderPlan(); return; }
  planForgetClear(i);
  planState.slots[i] = { name: plan.name || '', savedAt: new Date().toISOString(), plan: planCopy(plan) };
  planStore.save(planState);
  renderPlan();
  toast(t('slots.saved', { n: i + 1 }));
}
function planLoadSlot(i) {
  planUi.confirm = null;
  const s = planState.slots[i];
  if (!s || !s.plan) { toast(t('plan.slot_empty')); return; }
  const prev = planState.working;
  planState.working = planCopy(s.plan);
  planUi.editing = null; planUi.draft = null; planUi.rename = null;
  planStore.save(planState);
  renderPlan();
  toast(t('plan.slot_loaded', { n: i + 1 }), { ms: 9000, action: { label: t('slots.undo'), fn: () => {
    planState.working = prev; planStore.save(planState); renderPlan();
  } } });
}
// Единственная дверь удаления — planDeleteAllowed (та же дисциплина, что у слотов билда)
function planArmSlotDelete(i) {
  if (!planState.slots[i]) return;
  planUi.confirm = { i: i, kind: 'delete' };
  planArmFocus = true;
  renderPlan();
}
// снятие взведённого вопроса по Esc (r8, зеркало cancelConfirm из 85): вопрос гаснет,
// поповер остаётся открытым, фокус — на ✕ строки (APG: триггер умер → фокус к продолжению)
function planCancelConfirm() {
  const i = planUi.confirm && planUi.confirm.i;
  planUi.confirm = null;
  renderPlan();
  if (i == null) return;
  const d = document.querySelector &&
    document.querySelector('#planSlotsList .slot-row[data-i="' + i + '"] [data-act="planSlotDel"]');
  if (d) focusQuiet(d);
}
function planArmSlotImport(i, parsed) {
  if (!parsed) return;
  planUi.confirm = { i: i, kind: 'import', parsed: parsed };
  planArmFocus = true;
  renderPlan();
}
function planConfirmSlot(i) {
  const conf = planUi.confirm;
  planUi.confirm = null;
  if (!conf || conf.i !== i) return;
  if (conf.kind === 'delete') {
    const prev = planState.slots[i];
    if (!planDeleteAllowed(true, i, prev)) { renderPlan(); return; }
    planState.slots[i] = null;
    // строка гаснет по клику: метку ставим ДО перерисовки
    planSlotLastDel = { i: i, at: Date.now() };
    planStore.save(planState);
    renderPlan();
    toast(t('slots.deleted', { name: planSlotDisplayName(prev, i) }), { ms: 9000, action: { label: t('slots.undo'), fn: () => {
      planForgetClear(i); planState.slots[i] = prev; planStore.save(planState); renderPlan();
    } } });
    // (r8) ✕ строки умер — логическое продолжение клавиатуры это «Отменить» тоста (85: focusToastUndo)
    const ub = document.querySelector && document.querySelector('#toast [data-undo]');
    if (ub) focusQuiet(ub);
    return;
  }
  if (conf.kind === 'save') {
    const plan = planState.working;
    const prev = planState.slots[i];
    if (!plan || !prev) { renderPlan(); return; }
    planForgetClear(i);
    planState.slots[i] = { name: prev.name, savedAt: new Date().toISOString(), plan: planCopy(plan) };
    planStore.save(planState);
    renderPlan();
    toast(t('slots.overwritten', { n: i + 1 }), { ms: 9000, action: { label: t('slots.undo'), fn: () => {
      planState.slots[i] = prev; planStore.save(planState); renderPlan();
    } } });
    return;
  }
  if (conf.kind === 'import') {
    const slot = planState.slots[i];
    if (!slot) { toast(t('slots.import_stale', { n: i + 1 })); renderPlan(); return; }
    planForgetClear(i);
    planState.slots[i] = { name: slot.name || (conf.parsed.plan.name || ''),
      savedAt: new Date().toISOString(), plan: planCopy(conf.parsed.plan) };
    planStore.save(planState);
    renderPlan();
    toast(t('slots.imported', { n: i + 1 }));
  }
}
function planExportPlan(plan, idx, nameHint) {
  if (!plan) { toast(t('plan.nothing_to_save')); return; }
  const base = nameHint || plan.name || t('plan.file_base');
  const name = sanitizeSlotFileName(base) + '.plan.json';
  const blob = new Blob([JSON.stringify(buildPlanFile(plan, idx), null, 1)], { type: 'application/json' });
  // QA-шим умеет createElement, но не live-DOM: экспорт проверяется доменными тестами в браузере
  if (!document.body.appendChild || !URL.createObjectURL) { toast(t('plan.export_unavailable')); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  if (a.remove) a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function planExport() { planExportPlan(planState.working, null, null); }
function planExportSlot(i) {
  const s = planState.slots[i];
  if (!s) return;
  planExportPlan(s.plan, i, planSlotDisplayName(s, i) + '-' + (i + 1));
}
// Чтение файла плана: в рабочий план — с inline-подтверждением (review I5); в слот — прямо
// в него, а на занятый слот — через общий confirm (kind import), как у слотов билда.
function planReadPlanFile(onParsed) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  if (!input.addEventListener) { toast(t('plan.import_unavailable')); return; }
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const r = parsePlanFile(String(rd.result));
      if (!r.ok) { toast(t('plan.' + r.key)); return; }
      onParsed(r);
    };
    rd.readAsText(f);
  });
  input.click();
}
function planImport(armed) {
  if (planState.working && !armed) { planUi.armAct = 'import'; renderPlan(); return; }
  planUi.armAct = null;
  planReadPlanFile(r => {
    planState.working = r.plan;
    planUi.editing = null; planUi.draft = null;
    planStore.save(planState);
    renderPlan();
    toast(t('plan.import_ok'));
  });
}
function planImportSlot(i) {
  planReadPlanFile(r => {
    if (planState.slots[i]) planArmSlotImport(i, r);
    else {
      planForgetClear(i);
      planState.slots[i] = { name: r.plan.name || '', savedAt: new Date().toISOString(), plan: r.plan };
      planStore.save(planState);
      renderPlan();
      toast(t('slots.imported', { n: i + 1 }));
    }
  });
}
// Галка этапа: включение — отметка курсора (префикс — игровое правило r3-R4), выключение —
// снятие шага с каскадом хвоста и полным возвратом через undo тоста (r3-R3).
function planCheck(level, want) {
  const plan = planState.working;
  if (!plan) return;
  const marked = plan.marks.some(m => m.level === level);
  // состояние чекбокса в DOM — источник истины (браузер переключает его до клика-делегата);
  // шим без checked получает намерение «наоборот»
  if (want == null) want = !marked;
  if (want === marked) return;
  if (want) {
    if (level !== plan.marks.length + 1 || level > plan.target.level) { toast(t('plan.level_order')); return; }
    const step = planSteps(plan).find(s => s.level === level);
    planMarkLevel(level, step.suggested, step);
    return;
  }
  const removed = planUndoFrom(plan, level);
  planUi.editing = null; planUi.draft = null; planUi.armAct = null;
  planStore.save(planState);
  renderPlan();
  // (r7, objective 2026-11-13) 5 секунд и исчезает сам: тост вспыхивает под курсором снятой галки,
  // наведение держало его вечно (85-misc-ui), а 9 с человек не читает — undo всё равно кликабелен.
  toast(t('plan.undo_cascade', { n: removed.length }), { ms: 5000, hold: false, action: { label: t('slots.undo'), fn: () => {
    if (plan.marks.length === level - 1) { plan.marks.push.apply(plan.marks, removed); planStore.save(planState); renderPlan(); }
  } } });
}
function renderPlan() {
  const el = document.querySelector('#planBody');
  if (!el) return;
  // подтверждение живёт на занятом слоте: опустел, пока вопрос открыт — вопрос протух
  if (planUi.confirm && !planState.slots[planUi.confirm.i]) {
    if (planUi.confirm.kind === 'import') toast(t('slots.import_stale', { n: planUi.confirm.i + 1 }));
    planUi.confirm = null;
  }
  if (planUi.rename != null && !planState.slots[planUi.rename]) planUi.rename = null;
  const plan = planState.working;
  const steps = plan ? planSteps(plan) : null;
  el.innerHTML = planBodyHtml(plan, steps);
  // (r8) строки слотов живут в поповере — он перекрашивается тем же состоянием (и rename-обвязка там)
  renderPlanSlots();
}
// Inline-rename имени слота: Enter/blur = коммит, Esc = отказ (тот же рисунок, что у слотов билда)
// (r8) контейнер — список поповера
function planWireRename(el) {
  if (planUi.rename == null || !el.querySelector) return;
  const inp = el.querySelector('.slot-rename');
  if (!inp) return;
  const commit = () => {
    const cur = planUi.rename; if (cur == null) return;
    planSlotSetName(cur, (inp.value || '').trim());
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.stopPropagation(); commit(); }
    else if (e.key === 'Escape') { e.stopPropagation(); planUi.rename = null; renderPlan(); }
  });
  inp.addEventListener('blur', commit);
  if (inp.focus) inp.focus();
}
function setPlanOpen(open) {
  planUi.open = !!open;
  const b = document.body;
  if (b && b.classList) b.classList.toggle('plan-open', planUi.open);
  const d = document.querySelector('#planDrawer');
  if (d && d.setAttribute) d.setAttribute('aria-hidden', planUi.open ? 'false' : 'true');
  const btn = document.querySelector('#planBtn');
  if (btn && btn.setAttribute) btn.setAttribute('aria-expanded', planUi.open ? 'true' : 'false');
  // surfaces не накладываются: план закрывает базу, база — закрывает план (spec §6)
  if (planUi.open && b && b.classList && b.classList.contains('items-open')) setDrawerPane(drawerPane, false);
  // (r8) инвариант поповера: закрытая поверхность не оставляет открытого слоя слотов
  // (зеркало closeSlots, 85:356: confirm/rename гасятся без следа)
  if (!planUi.open) { closePlanSlots(false); planUi.confirm = null; planUi.rename = null; }
  else { planUi.slots = false; const pop = planPopEl(); if (pop) pop.hidden = true; }
  if (planUi.open) renderPlan();
}
function planTakeFromBuild(armed) {
  const cur = planState.working;
  // (r2-R1) защитная дверь: кнопка уже задизейбнена с причиной, но событие может прийти
  // и в обход неё (старый рендер) — отказываем с той же подписью
  const gate = planGapsReason();
  if (gate) { planUi.armAct = null; toast(gate); renderPlan(); return; }
  // план с отметками — боевые данные: первое нажатие только взводит danger-подтверждение
  // (patterns.md §11: вместо window.confirm — inline-дверь, review M3)
  if (cur && cur.marks.length && !armed) { planUi.armAct = 'take'; renderPlan(); return; }
  planUi.armAct = null;
  planState.working = planNewPlan(snapshotPlanTarget(), (cur && cur.name) || '');
  planUi.editing = null; planUi.draft = null;
  planStore.save(planState);
  renderPlan();
}
// Отметка уровня галкой: пишется факт применённого состава (оверрайд или рекомендация).
// (r2-R3) Неполная отметка не записывается вовсе: уровень обязан распределить все свои очки.
function planMarkLevel(level, inv, step) {
  const plan = planState.working;
  if (!plan || !planMarkAllowed(plan, level)) { toast(t('plan.level_order')); return; }
  if (!planMarkComplete(plan, level, inv)) { toast(t('plan.incomplete')); return; }
  planAddMark(plan, level, inv, { recommended: step ? step.rec : null });
  planUi.editing = null; planUi.draft = null;
  planStore.save(planState);
  renderPlan();
}
function planDraftDelta(kindId, d) {
  const parts = String(kindId).split(':');
  const kind = parts[0], id = parts[1];
  const plan = planState.working;
  if (!plan || planUi.editing == null) return;
  const level = planUi.editing;
  const pools = planUserPoolsAt(plan, level);
  const d0 = planUi.draft || { attr: {}, combat: {}, civil: {} };
  const ctx = { plan: plan, L: level,
    attr: Object.assign({}, pools.attr), combat: Object.assign({}, pools.combat),
    civil: Object.assign({}, pools.civil),
    talents: [].concat(pools.talents || []), gear: [], pools: pools };
  for (const k of ['attr', 'combat', 'civil']) if (d0[k]) for (const [x, v] of Object.entries(d0[k])) ctx[k][x] = (ctx[k][x] || 0) + v;
  const dsum = k => Object.values(d0[k] || {}).reduce((a, v) => a + (v | 0), 0);
  const leftByKind = { attr: pools.attrTotal - pools.attrSpent - dsum('attr'),
    combat: pools.combatTotal - pools.combatSpent - dsum('combat'),
    civil: pools.civilTotal - pools.civilSpent - dsum('civil') };
  const next = Object.assign({}, d0);
  next[kind] = Object.assign({}, d0[kind] || {});
  const cur = (d0[kind] && d0[kind][id]) || 0;
  const nv = cur + d;
  if (nv < 0) return;
  if (d > 0) {
    if (leftByKind[kind] <= 0) return;
    const test = Object.assign({}, ctx);
    test[kind] = Object.assign({}, ctx[kind]);
    test[kind][id] = (test[kind][id] || 0) + 1;
    test.pools = Object.assign({}, pools, { attrLeft: leftByKind.attr, combatLeft: leftByKind.combat, civilLeft: leftByKind.civil });
    if (!planLegal(kind, id, test)) return;
  }
  if (nv === 0) delete next[kind][id]; else next[kind][id] = nv;
  planUi.draft = next;
  renderPlan();
}
// (r8)Esc-эскалатор плановых поверхностей ОДИН слушатель на документ (прежний закрывал drawer
// вместе с поповером и вопросом; APG + patterns §12: слои гасятся по одному):
// тултип ⓘ → взведённый вопрос → поповер (фокус триггеру) → drawer
function planEscalateEscape(ev) {
  if (ev.key !== 'Escape') return;
  if (dismissPlanGateTip()) return;
  if (planUi.confirm) { planCancelConfirm(); return; }
  if (planUi.slots) { closePlanSlots(true); return; }
  if (planUi.open) setPlanOpen(false);
}
// Dismissible (WCAG 1.4.13): Esc прячет подсказку, не требуя ухода курсора; data-tip-off
// держит её скрытой до выхода курсора/фокуса из хоста (слушатели ниже)
function dismissPlanGateTip() {
  const wraps = (document.querySelectorAll && document.querySelectorAll('.plan-info-wrap')) || [];
  let hit = false;
  for (let i = 0; i < wraps.length; i++) {
    const w = wraps[i];
    const shown = (w.hasAttribute && w.hasAttribute('data-tip-on')) ||
      (w.matches && w.matches(':hover')) ||
      (w.contains && document.activeElement && w.contains(document.activeElement));
    if (!shown) continue;
    w.removeAttribute('data-tip-on');
    w.setAttribute('data-tip-off', '1');
    hit = true;
  }
  return hit;
}
function initPlanEvents() {
  const btn = document.querySelector('#planBtn');
  if (btn && btn.addEventListener) btn.addEventListener('click', () => setPlanOpen(!planUi.open));
  const close = document.querySelector('#planClose');
  if (close && close.addEventListener) close.addEventListener('click', () => setPlanOpen(false));
  document.addEventListener('keydown', planEscalateEscape);
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('button[data-act], input[data-act]') : null;
    if (!b) return;
    const a = b.dataset.act;
    if (typeof a !== 'string' || a.indexOf('plan') !== 0) return;
    // только плановые act (review M5); вторая кнопка в danger-морфе = дверь подтверждённого действия
    const armKey = (a === 'planTake' || a === 'planImport') ? a.slice(4).toLowerCase() : null;
    const armed = armKey !== null && planUi.armAct === armKey;
    if (armKey !== null) planUi.armAct = null;
    const idAttr = b.dataset.id;
    switch (a) {
      case 'planTake': planTakeFromBuild(armed); break;
      case 'planClose': setPlanOpen(false); break;
      case 'planChk': {
        const lv = parseInt(idAttr, 10);
        if (Number.isInteger(lv)) planCheck(lv, typeof b.checked === 'boolean' ? b.checked : null);
        break;
      }
      case 'planEdit': planOpenEditor(parseInt(idAttr, 10)); break;
      case 'planEditApply': planEditorApply(); break;
      case 'planEditCancel': planUi.editing = null; planUi.draft = null; renderPlan(); break;
      case 'planRevert': planClearOverride(planState.working, parseInt(idAttr, 10)); planStore.save(planState); renderPlan(); break;
      case 'planDraft': planDraftDelta(idAttr, parseInt(b.dataset.d, 10) || 0); break;
      case 'planTog': planTogToggle(idAttr); break;
      case 'planSlotSave': planSaveSlot(parseInt(idAttr, 10)); break;
      case 'planSlotLoad': planLoadSlot(parseInt(idAttr, 10)); break;
      case 'planSlotDel': planArmSlotDelete(parseInt(idAttr, 10)); break;
      case 'planSlotConfirm': planConfirmSlot(parseInt(idAttr, 10)); break;
      case 'planSlotCancel': planUi.confirm = null; renderPlan(); break;
      case 'planSlotRename': {
        const i = parseInt(idAttr, 10);
        if (planState.slots[i]) { planUi.rename = i; renderPlan(); }
        break;
      }
      // (r8) триггер — вкл/выкл поповера (повторный клик закрывает, фокус возвращается)
      case 'planSlots': planUi.slots ? closePlanSlots(true) : openPlanSlots(); break;
      case 'planSlotsPopClose': closePlanSlots(true); break;
      // тап по ⓘ — тултип для тача (hover-слоя нет): первый тап показал, повторный — спрятал
      case 'planGateInfo': {
        const wrap = b.closest ? b.closest('.plan-info-wrap') : null;
        if (wrap) {
          if (wrap.hasAttribute && wrap.hasAttribute('data-tip-on')) wrap.removeAttribute('data-tip-on');
          else if (wrap.setAttribute) wrap.setAttribute('data-tip-on', '1');
          if (wrap.removeAttribute) wrap.removeAttribute('data-tip-off');
        }
        break;
      }
      case 'planSlotExport': planExportSlot(parseInt(idAttr, 10)); break;
      case 'planSlotImport': planImportSlot(parseInt(idAttr, 10)); break;
      case 'planExport': planExport(); break;
      case 'planImport': planImport(armed); break;
      default: return;
    }
  });
  if (document.addEventListener) {
    // (r8) light-dismiss поповера (образец 85:416–426): клик вне поповера/триггера закрывает;
    // переобработанные строки с внутренним target, отцепленным от DOM, — не «вне» (probe bug 2026-11-07);
    // undo-тост — часть слот-операции, а не «снаружи». Без DOM-мощностей (QA-шим) решение не принимается.
    document.addEventListener('click', (ev) => {
      if (!planUi.slots) return;
      const pop = planPopEl();
      if (!(pop && pop.contains)) return;
      if (document.contains && ev.target && ev.target !== document && !document.contains(ev.target)) return;
      const b = planSlotsTriggerEl(), tst = document.querySelector('#toast');
      const inside = (el) => el && el.contains && ev.target && el.contains(ev.target);
      if (inside(pop) || inside(b) || inside(tst)) return;
      closePlanSlots(false);
    });
    // отпустил курсор/форус из хоста ⓘ — снята и Esc-заглушка подсказки
    const clearTipOff = (ev) => {
      const w = ev.target && ev.target.closest ? ev.target.closest('.plan-info-wrap') : null;
      if (!w || !w.removeAttribute) return;
      const to = ev.relatedTarget;
      // переехали внутрь хоста (на сам тултип) — заглушку не снимаем
      if (to && w.contains && w.contains(to)) return;
      w.removeAttribute('data-tip-off');
    };
    document.addEventListener('mouseout', clearTipOff);
    document.addEventListener('focusout', clearTipOff);
  }
  // скролл ленты плана уносит якорь поповера — слой закрывается, как слоты билда при скролле
  // страницы (85:370). Именно #planBody, а не window: скролл ВНУТРИ поповера стрелял бы по нему сам
  const pb = document.querySelector('#planBody');
  if (pb && pb.addEventListener) {
    pb.addEventListener('scroll', () => { if (planUi.slots) closePlanSlots(false); });
  }
  if (window.addEventListener) {
    window.addEventListener('resize', () => {
      if (!planUi.slots) return;
      const pop = planPopEl();
      if (pop && !pop.hidden) planPlacePop(pop);
    });
  }
}
