// Part 12-plan.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
// План прокачки: слепок билда, послойная рекомендация и отметки выполнения.
// Движок и хранилище — без DOM; рендер и события — 87-plan-ui.js
// (spec docs/superpowers/specs/2026-11-11-lvlup-plan-design.md).
'use strict';
const PLAN_KEY = 'dos2planner.plan.v1';
const PLAN_N = 5;
const PLAN_VER = 1;
// Веса метрики силы (spec §5.1): очко урона и очко эффективного здоровья весят сопоставимо,
// темп — тайбрейкер, а не самостоятельная выгода. QA-тест 1-7 сторожит устойчивость выбора.
const PLAN_W = { offense: 0.60, ehp: 0.35, tempo: 0.05, starve: 0.02 };
// Счётчик карантина: две записи в один миллисекундный Date.now() не должны перетираться.
let planCorruptSeq = 0;
function defaultPlans() { return { version: PLAN_VER, working: null, slots: new Array(PLAN_N).fill(null) }; }
const planInt = v => (Number.isFinite(v) && v > 0) ? Math.floor(v) : 0;
function planCopy(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
// Отметка уровня: только целые очки и списки имён/идов; всё остальное — в корзину.
function planNormalizeInv(inv) {
  const src = (inv && typeof inv === 'object') ? inv : {};
  const num = m => {
    const out = {};
    for (const [k, v] of Object.entries((m && typeof m === 'object') ? m : {})) {
      const n = planInt(v);
      if (n > 0) out[String(k)] = n;
    }
    return out;
  };
  const list = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x) : [];
  return { attr: num(src.attr), combat: num(src.combat), civil: num(src.civil),
    talents: list(src.talents), gear: list(src.gear) };
}
function planInvEqual(a, b) {
  const x = planNormalizeInv(a), y = planNormalizeInv(b);
  return JSON.stringify([x.attr, x.combat, x.civil, x.talents.slice().sort(), x.gear.slice().sort()]) ===
    JSON.stringify([y.attr, y.combat, y.civil, y.talents.slice().sort(), y.gear.slice().sort()]);
}
// Отметки строго последовательны: уровень = индекс + 1, без пропусков и «из будущего».
function planMarksOk(marks) {
  return Array.isArray(marks) && marks.every((m, i) =>
    m && typeof m === 'object' && m.level === i + 1 && !!m.inv && typeof m.inv === 'object');
}
function planNormalize(p) {
  if (!p || typeof p !== 'object' || !p.target || typeof p.target !== 'object' ||
    !Number.isFinite(p.target.level) || !Array.isArray(p.marks)) return null;
  // порядок отметок проверяется ДО отсечения (файл с дырой «из будущего» отвергается целиком),
  // а лишним хвостом за целевой уровень — просто отрезается (review M1)
  if (!planMarksOk(p.marks)) return null;
  const marks = p.marks.slice(0, Math.max(0, planInt(p.target.level))).map(m => ({
    level: m.level, inv: planNormalizeInv(m.inv),
    deviation: m.deviation === true, at: String(m.at || '') }));
  // (r3-R2) оверрайды — черновики неотмеченных уровней; выше отметок и до целевого уровня,
  // мусор по уровню выбрасывается, пустой состав не хранится
  const overrides = {};
  if (p.overrides && typeof p.overrides === 'object' && !Array.isArray(p.overrides)) {
    for (const [k, v] of Object.entries(p.overrides)) {
      const lv = parseInt(k, 10);
      if (!Number.isInteger(lv) || lv <= marks.length || lv > planInt(p.target.level)) continue;
      const inv = planNormalizeInv(v);
      if (planSum(inv.attr) + planSum(inv.combat) + planSum(inv.civil) + inv.talents.length + inv.gear.length)
        overrides[String(lv)] = inv;
    }
  }
  return { name: String(p.name || ''), savedAt: String(p.savedAt || ''),
    target: planCopy(p.target), marks, overrides };
}
// Каркас как у слотов билда (97-slots-store.js): защищённый ввод, карантин мусора, version.
const planStore = {
  load() {
    let raw = null;
    try { raw = localStorage.getItem(PLAN_KEY); } catch (e) { return defaultPlans(); } // SecurityError / blocked storage
    if (!raw) return defaultPlans();
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && v.version === PLAN_VER && Array.isArray(v.slots) && v.slots.length === PLAN_N) {
        const working = planNormalize(v.working);
        // битая запись не отравляет панель: она вычищается, остальное живёт
        const slots = v.slots.map(s => (s && s.plan && typeof s.plan === 'object')
          ? { name: String(s.name || ''), savedAt: String(s.savedAt || ''), plan: planNormalize(s.plan) } : null);
        return { version: PLAN_VER, working, slots: slots.map(s => (s && !s.plan ? null : s)) };
      }
    } catch (e) { /* falls through to quarantine */ }
    try { localStorage.setItem('dos2planner.corrupt.' + Date.now() + '.' + (++planCorruptSeq), raw); } catch (e) { /* quarantine is best-effort */ }
    return defaultPlans();
  },
  save(data) {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; } // QuotaExceededError, SecurityError, private mode
  },
};
let planState = planStore.load();
// Рабочий план = слепок билда + отметки; берётся кнопкой, синхронизация автоматом не делается.
function planNewPlan(target, name) {
  return { name: String(name == null ? '' : name), savedAt: new Date().toISOString(),
    target: planCopy(target), marks: [], overrides: {} };
}
function planMarkAllowed(plan, level) {
  return !!plan && Number.isInteger(level) && level >= 1 && level <= plan.target.level &&
    level === plan.marks.length + 1;
}
// ---- Ревизия r3 (objective 2026-11-12, ревью дизайна) ----
// (r3-R2) Оверрайд — отредактированный чернов неотмеченного уровня: живёт в плане как inv,
// применяется к состоянию следующих уровней вместо рекомендации, отметка поверх него пишется
// фактом с отклонением. Отметка остаётся ФАКТОМ прохождения (префикс — игровое правило).
function planOverridesOf(plan) {
  return (plan && plan.overrides && typeof plan.overrides === 'object') ? plan.overrides : {};
}
function planSetOverride(plan, level, inv) {
  if (!plan || !plan.overrides) return;
  const lv = planInt(Number(level));
  if (!lv || lv <= plan.marks.length || lv > plan.target.level) return;
  plan.overrides[String(lv)] = planNormalizeInv(inv);
}
function planClearOverride(plan, level) {
  if (!plan || !plan.overrides) return;
  delete plan.overrides[String(planInt(Number(level)))];
}
// Бюджет уровня L с учётом того, что ниже его легло НЕ только отметками: оверрайды
// промежуточных уровней тоже тратят пулы (иначе правка серединного этапа видела бы чужие бюджеты).
function planUserPoolsAt(plan, L, extra) {
  const prior = { target: plan.target, marks: plan.marks.filter(m => m.level < L) };
  const min = plan.marks.length + 1;
  for (const [k, inv] of Object.entries(planOverridesOf(plan))) {
    const lv = parseInt(k, 10);
    if (Number.isInteger(lv) && lv >= min && lv < L) prior.marks.push({ level: lv, inv: planNormalizeInv(inv) });
  }
  return planPoolsAt(prior, L, extra);
}
// (r3-R3) Снятие галки mid-уровня каскадом: префикс отметок — игровой порядок, хвост без него
// врать не должен. Снятое возвращается списком — тост-откат вставляет всё разом.
function planUndoFrom(plan, level) {
  if (!plan || !Array.isArray(plan.marks)) return [];
  const removed = plan.marks.filter(m => m.level >= level);
  plan.marks = plan.marks.filter(m => m.level < level);
  return removed;
}
// ---- Ревизия r4 (objective 2026-11-13, ревью дизайна R4/R5) ----
// (R4/R5) Бюджеты уровня и суммы «ниже уровня» для ОМЕННОЙ строки: одна арифметика для
// фактов и шагов, чтобы «доступно/потрачено/ранее» не разъезжались между отмеченным и
// превью. shape: { budget: {attr|combat|civil: {avail, spent}, talent: {avail, spent}},
// below: { attr, combat, civil, talent, talents[] } }.
// planComputeSteps считает то же самое из своих локальных pools/cur (шаги), эта функция —
// из planUserPoolsAt (отмеченный уровень: отметки ниже = точный префикс, оверрайдов ниже
// отметок не бывает по normalize).
function planBudgetShape(beforePools, belowSums, belowTalents, n) {
  const freshTalents = (arr, have) => (arr || []).filter(t => have.indexOf(t) < 0).length;
  return {
    budget: {
      attr: { avail: Math.max(0, beforePools.attrTotal - belowSums.attr), spent: planSum(n.attr) },
      combat: { avail: Math.max(0, beforePools.combatTotal - belowSums.combat), spent: planSum(n.combat) },
      civil: { avail: Math.max(0, beforePools.civilTotal - belowSums.civil), spent: planSum(n.civil) },
      talent: { avail: Math.max(0, beforePools.talentPicks - belowTalents.length),
        spent: freshTalents(n.talents, belowTalents) },
    },
    below: { attr: belowSums.attr, combat: belowSums.combat, civil: belowSums.civil,
      talent: belowTalents.length, talents: belowTalents.slice() },
  };
}
function planMarkBudget(plan, level, inv) {
  const before = planUserPoolsAt(plan, level);
  return planBudgetShape(before,
    { attr: before.attrSpent, combat: before.combatSpent, civil: before.civilSpent },
    before.talents || [], planNormalizeInv(inv));
}
// Правка ФАКТА отмеченного уровня: состав тот же, что требует полнота уровня, отклонение
// пересчитывается от свежей рекомендации (она считается без этого и высших фактов).
function planEditMark(plan, level, inv, opts) {
  const m = plan && plan.marks.find(x => x.level === level);
  if (!m || !(level >= 1 && level <= plan.marks.length)) throw new Error('plan.level_order');
  const rec = opts && opts.recommended;
  m.inv = planNormalizeInv(inv);
  m.deviation = !!rec && !planInvEqual(inv, rec);
  m.at = new Date().toISOString();
  return plan;
}
// Рекомендация движка для уровня L, если обрезать план до L-1 (для честного флага отклонения
// при правке факта: сравнение не с самим собой, а с тем, что предложил бы движок).
function planRecommendAt(plan, level) {
  const cut = { target: plan.target, marks: plan.marks.filter(m => m.level < level),
    overrides: planOverridesOf(plan) };
  const st = planSteps(cut).find(s => s.level === level);
  return st ? st.suggested : null;
}
// ---- Ревизия r2 (objective 2026-11-12) ----
// (R1) Свободные очки живого билда. План строится из «спроса билда», а неотданные очки —
// это ещё не спрос, а неизвестность: план создаётся только тогда, когда четыре пула
// (качества, мирные, боевые умения, таланты) распределены целиком. Скиллы и экипировка
// вне гейта — они опциональны.
function planBuildGaps() {
  const p = pools();
  const taken = state.talents.filter(n => PLAN_TALENTS().some(x => x.name === n)).length;
  return {
    attr: Math.max(0, p.attrTotal - p.attrSpent),
    combat: Math.max(0, p.combatTotal - p.combatSpent),
    civil: Math.max(0, p.civilTotal - p.civilSpent),
    talent: Math.max(0, p.talentPicks - taken),
  };
}
// (R3) Отметка уровня обязана распределить ВСЕ очки, которые уровень даёт: пропуск очков
// исключён («не вложить очки на уровне — нельзя»). Остаток допускается только там, где
// вкладывать не во что: для остатка не осталось ни одного легального варианта (кап).
// Отметка — ФАКТ: лишним тоже не считаем (перебор отвергается).
// (r3-R2) Бюджеты и состояние берутся от уровней СТРОГО НИЖЕ редактируемого: правка
// серединного факта не должна спотыкаться о высшие отметки и обязана видеть чужие оверрайды.
function planMarkComplete(plan, level, inv) {
  const before = planUserPoolsAt(plan, level);
  const n = planNormalizeInv(inv);
  const totals = { attr: before.attrTotal, combat: before.combatTotal, civil: before.civilTotal };
  const spents = { attr: before.attrSpent, combat: before.combatSpent, civil: before.civilSpent };
  const left = {};
  for (const kind of PLAN_POOL_ORDER) {
    left[kind] = totals[kind] - (spents[kind] + planSum(n[kind]));
    if (left[kind] < 0) return false;
  }
  const ctx = { plan: plan, L: level,
    attr: Object.assign({}, before.attr), combat: Object.assign({}, before.combat),
    civil: Object.assign({}, before.civil),
    talents: [].concat(before.talents, n.talents), gear: [] };
  for (const m of plan.marks) if (m.level < level) for (const g of (m.inv.gear || [])) ctx.gear.push(g);
  const min = plan.marks.length + 1;
  for (const [k, oinv] of Object.entries(planOverridesOf(plan))) {
    const lv = parseInt(k, 10);
    if (lv >= min && lv < level) for (const g of (oinv.gear || [])) if (ctx.gear.indexOf(g) < 0) ctx.gear.push(g);
  }
  for (const g of n.gear) if (ctx.gear.indexOf(g) < 0) ctx.gear.push(g);
  ctx.pools = Object.assign({}, before, { attrLeft: left.attr, combatLeft: left.combat, civilLeft: left.civil });
  for (const kind of PLAN_POOL_ORDER) {
    if (left[kind] === 0) continue;
    // остаток допустим только там, где вкладывать не во что: легальных вариантов нет
    if (planPoolIds(kind).some(id => planLegal(kind, id, ctx))) return false;
  }
  // пика уровня плюс не взятый ранее долг; больше данного уровнем взять нельзя
  const grant = before.talentPicks - before.talents.length;
  if (grant < n.talents.length) return false;
  if (n.talents.length < grant) {
    const cand = (plan.target.talents || []).filter(id =>
      before.talents.indexOf(id) < 0 && n.talents.indexOf(id) < 0 && planLegal('talent', id, ctx));
    // уровень дал пика, брать её нечем только если билд ничего легального не просит
    if (cand.length) return false;
  }
  return true;
}
// Отметка записывает ФАКТ уровня: всё, что после него, пересчитывается от факта, а не от плана.
// recommended — то, что предлагал движок в момент отметки: он и решает флаг отклонения (spec §4).
function planAddMark(plan, level, inv, opts) {
  if (!planMarkAllowed(plan, level)) throw new Error('plan.level_order');
  const rec = opts && opts.recommended;
  const mark = { level, inv: planNormalizeInv(inv), deviation: !!rec && !planInvEqual(inv, rec),
    at: new Date().toISOString() };
  plan.marks.push(mark);
  return plan;
}
function planUndoMark(plan) {
  if (plan && Array.isArray(plan.marks)) plan.marks.pop();
  return plan;
}
// Ровно одна дверь удаления — та же дисциплина, что у слотов билда (slotDeleteAllowed).
function planDeleteAllowed(confirm, i, slot) {
  return !!confirm && Number.isInteger(i) && i >= 0 && i < PLAN_N && !!slot;
}
// ---- Состояние плана как состояние модели ----
// Копия рабочего состояния с вложениями/уровнем плана: единый источник капов, пререквизитов и
// эффектов (spec §5.1). Общий код computeFinal/pools/has читает глобальный state, параметра у него
// нет — поэтому подмена на время расчёта с восстановлением в finally.
function planCloneState(base) {
  const c = JSON.parse(JSON.stringify(base));
  return c;
}
function withPlanState(copy, fn) {
  const prev = state;
  state = copy;
  try { return fn(); } finally { state = prev; }
}
// Состояние, из которого виден только план: отметки + уровень, снаряжение — из слепка.
function planCtxState(ctx) {
  const plan = ctx.plan, tgt = plan.target;
  const st = planCloneState(state);
  // план = слепок: раса/ориджин берутся из слепка, иначе числа считались бы под расу чужого
  // браузера, а кэш по сигнатуре возвращал бы протухшие шаги после правки живого билда (review I3)
  if (typeof tgt.race === 'string' && tgt.race) st.race = tgt.race;
  if (typeof tgt.origin === 'string' && tgt.origin) st.origin = tgt.origin;
  if (typeof tgt.spiderKissVision === 'string') st.spiderKissVision = tgt.spiderKissVision;
  // payload кузнечных предметов плана: метрика подмешает их в GEN на время расчёта (review I4)
  st._planGen = Array.isArray(tgt.gen) ? tgt.gen : [];
  st.level = ctx.L;
  st.attr = Object.assign(Object.fromEntries(ATTR_IDS.map(id => [id, 0])), ctx.attr || {});
  st.combat = Object.assign(Object.fromEntries(COMBAT_IDS.map(id => [id, 0])), ctx.combat || {});
  st.civil = Object.assign(Object.fromEntries(CIVIL_IDS.map(id => [id, 0])), ctx.civil || {});
  st.talents = [...(ctx.talents || [])];
  st.questTalents = [...(tgt.questTalents || [])];
  st.equipment = Object.fromEntries(EQUIP_SLOTS.map(([k]) => [k, null]));
  for (const g of (tgt.gear || [])) if (ctx.gear ? ctx.gear.includes(g.id) : false) st.equipment[g.slot] = g.id;
  return st;
}
// ---- Метрика силы персонажа (spec §5.1) ----
// Всё считается через существующую модель (computeFinal, calcWeaponDamage), арифметику показателей
// движок не изобретает: метрика отвечает только за то, что сравнить между собой разные очки.
const PLAN_SCHOOL_IDS = () => CH.combatAbilities.schools.map(s => s.id);
const PLAN_SCALE_ATTRS = ['strength', 'finesse', 'intelligence'];
// Билд без оружия сравнивается с вооружённым «на уровне пустой руки»: базой служит generic-урон
// того же уровня из той же таблицы движка (DATA.weaponGeneric), на которой считаются и
// level-scaled предметы. Абстрактная сотня сделана бы была любое снаряжение хуже пустой руки,
// и канал рекомендаций по снаряжению молчал бы.
const PLAN_UNARMED_COL = 'sword';
function planUnarmedBase(level) {
  const t = D.weaponGeneric && D.weaponGeneric.table;
  const l = Math.max(1, Math.min(21, planInt(level) || 1));
  const g = t && t[String(l)] && t[String(l)][PLAN_UNARMED_COL];
  return g ? (g.min + g.max) / 2 : 100;
}
function planUnarmedOffense(f, level) {
  const attrBonus = Math.max(0, PLAN_SCALE_ATTRS.map(a => (f.attr[a] || 10) - 10).reduce((m, v) => Math.max(m, v), 0)) * 0.05;
  const schoolBonus = Math.max(0, ...PLAN_SCHOOL_IDS().map(id => (f.combat && f.combat[id]) || 0)) * 0.10;
  return planUnarmedBase(level) * (1 + attrBonus + schoolBonus);
}
// Сила персонажа на уровне: offense/ehp/tempo свёрнуты весами PLAN_W (W — override для тестов
// устойчивости выбора). ehp: броня в DOS2 поглощает урон 1-в-1, поэтому смешанный бой усредняет
// оба пула; в UI метрика не называется игровой величиной (проверка источника — O20).
// Кузнечные предметы плана разрешимы только payload'ом (plan.target.gen): модель читает
// глобальный GEN, поэтому на время расчёта предмет подмешивается в него и снимается обратно —
// файл плана остаётся самодостаточным на чистом браузере (spec §4, review I4).
function withPlanGen(st, fn) {
  const gen = (st && Array.isArray(st._planGen)) ? st._planGen : null;
  if (!gen || !gen.length) return fn();
  const added = [];
  for (const it of gen) {
    if (it && typeof it.id === 'string' && !GEN.has(it.id)) { GEN.set(it.id, it); added.push(it.id); }
  }
  try { return fn(); } finally { for (const id of added) GEN.delete(id); }
}
function planPower(st, level, W) {
  const w = W || PLAN_W;
  const lv = planInt(level);
  const copy = (!lv || lv === st.level) ? st : Object.assign({}, st, { level: lv });
  return withPlanGen(copy, () => withPlanState(copy, () => {
    const f = computeFinal();
    const wd = (typeof calcWeaponDamage === 'function') ? calcWeaponDamage(state, f) : null;
    // estimatedDmgRaw, а не округлённый estimatedDmg: цена одного очка на низких уровнях
    // меньше единицы урона и исчезла бы в округлении (тест «очко качества ощутимо»).
    const base = wd ? (wd.estimatedDmgRaw != null ? wd.estimatedDmgRaw : wd.estimatedDmg)
      : planUnarmedOffense(f, state.level);
    // крит даёт не «ещё один удар», а надбавку к кратности: crit% × (critMult − 100) %
    const offense = base * (1 + (f.crit / 100) * Math.max(0, f.critMult - 100) / 100);
    const ehp = f.hp + (f.pA + f.mA) / 2;
    const tempo = 0.05 * f.init + 0.5 * (f.move - 3) + 2 * (f.ap - 6);
    return { power: w.offense * offense + w.ehp * ehp + w.tempo * tempo, offense, ehp, tempo, f };
  }));
}
// Один вариант, применённый к состоянию: копия, а не правка на месте (planCtxState и редактор
// плана пишут только в свои объекты). kind: attr|combat|civil|talent|gear.
function planApply(st, kind, id, plan) {
  if (kind === 'attr' || kind === 'combat' || kind === 'civil') {
    const m = Object.assign({}, st[kind] || {});
    m[id] = (m[id] || 0) + 1;
    const next = Object.assign({}, st);
    next[kind] = m;
    return next;
  }
  if (kind === 'talent') return Object.assign({}, st, { talents: [...(st.talents || []), id] });
  if (kind === 'gear') {
    const it = plan ? planItemById(plan, id) : itemById(id);
    if (!it) return null;
    const eq = Object.assign({}, st.equipment || {});
    // маршрут слота — как у equipItem: кольцо в первую свободную лунку, иначе в ring1
    let key = it.slot;
    if (it.slot === 'ring') key = !eq.ring1 ? 'ring1' : (!eq.ring2 ? 'ring2' : 'ring1');
    if (!EQUIP_SLOTS.some(([k]) => k === key)) return null;
    eq[key] = id;
    // двуручное занимает обе руки — то же правило, что enforceTwoHanded у живого состояния
    if (key === 'main_hand' && TWO_HANDED_TYPES.has(it.weaponType)) eq.off_hand = null;
    return Object.assign({}, st, { equipment: eq });
  }
  return null;
}
// Прирост силы от одного варианта (spec §5.1): шаг стоит одного очка своего пула, поэтому
// варианты внутри пула сравнимы напрямую.
function planDelta(st, level, kind, id, opts) {
  const o = opts || {};
  const next = planApply(st, kind, id, o.plan);
  if (!next) return -Infinity;
  const lv = planInt(level) || st.level;
  return planPower(next, lv, o.W).power - planPower(st, lv, o.W).power;
}

// ==================== Планировщик уровня (spec §5.3) ====================
// Первичен билд: эффективность решает ПОРЯДОК и ИЗЛИШЕК, а вот *что* окажется вложено — решает
// билд. Иначе план спорил бы с планировщиком (антицель §2).
// Подсобная ценность для тех очков, которые метрика силы не видит (мирные умения): значения —
// из mech данных character.json (цена торга, пороги воровства, дальность телекинеза, слоты
// памяти Эрудита), порядок фиксированный, остальные — по id (детерминизм вместо случайности).
const PLAN_UTILITY = { loremaster: 5, bartering: 4, thievery: 3, telekinesis: 2 };
// Очки, снимающие голод слотов памяти (spec §5.6): надбавка действует только внутри спроса.
const PLAN_STARVE_KEYS = { attr: ['memory'], civil: ['loremaster'] };
const PLAN_POOL_ORDER = ['attr', 'combat', 'civil'];
function planPoolIds(kind) {
  return kind === 'attr' ? CH.attributes.map(a => a.id) : kind === 'combat' ? COMBAT_IDS : CIVIL_IDS;
}
function planSum(m) { return Object.values(m || {}).reduce((s, v) => s + v, 0); }
function planMerge(a, b) {
  const out = Object.assign({}, a || {});
  for (const [k, v] of Object.entries(b || {})) out[k] = (out[k] || 0) + v;
  return out;
}
// Порядок при отсутствии спроса: сначала первое очко (diminishing), затем подсобная ценность.
function planUtilityScore(kind, id, invested) {
  const have = (invested && invested[id]) || 0;
  return (PLAN_UTILITY[id] || 0) - (have > 1 ? have - 1 : 0);
}
function planByUtility(list, kind, invested) {
  return list.slice().sort((a, b) => (planUtilityScore(kind, b, invested) - planUtilityScore(kind, a, invested)) ||
    (a < b ? -1 : a > b ? 1 : 0))[0];
}
function planOptionDelta(st, L, kind, id, w, basePower, plan) {
  const next = planApply(st, kind, id, plan);
  if (!next) return -Infinity;
  return planPower(next, L, w).power - basePower;
}
// Лучший вариант пула: спрос (mode 1) либо все легальные (mode 2); тай-брейк — id по алфавиту.
// built — вложения билда (target[kind]): по r2 излишек довершается вложенному пользователем,
// а не уводит очки в id, которых билд не касался (objective 2026-11-12, требование R2).
function planPickBest(st, L, kind, cand, w, basePower, plan, mode, starveOn, invested, built) {
  const scored = cand.map(id => {
    let d = planOptionDelta(st, L, kind, id, w, basePower, plan);
    const keys = PLAN_STARVE_KEYS[kind];
    if (starveOn && keys && keys.indexOf(id) >= 0) d += PLAN_W.starve * Math.max(1, basePower);
    return { id: id, delta: d };
  }).sort((x, y) => (y.delta - x.delta) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  // Внутри спроса даже нулевой Δpower честен: очко просит билд, а не метрика (мирные умения
  // вообще не влияют на силу). Отложенный режим — только про излишек, где билд молчит (spec §5.3).
  if (mode === 'demand' || scored.length < 2) {
    return { best: scored[0], deferred: false, alt: scored[1] || null };
  }
  // (R2) Излишек — на основе вложенных пользователем очков: сначала те id, в которые
  // билд уже вкладывается; метрика силы решает только порядок внутри них.
  const pref = scored.filter(s => (((built && built[s.id]) || 0) + ((invested && invested[s.id]) || 0)) > 0);
  if (pref.length) {
    const top = pref[0];
    return { best: top, deferred: top.delta <= 0, alt: scored.find(s => s.id !== top.id) || null };
  }
  if (scored[0].delta > 0) {
    return { best: scored[0], deferred: false, alt: scored[1] || null };
  }
  const util = planByUtility(cand, kind, invested);
  const alt = scored.find(s => s.id === util) || scored[0];
  return { best: { id: util, delta: alt.delta }, deferred: true, alt: scored[0].id === util ? scored[1] : scored[0] };
}
function planSignature(plan, w) {
  return [JSON.stringify(plan && plan.target || null), JSON.stringify((plan && plan.marks) || []),
    JSON.stringify(plan && plan.overrides || {}),
    JSON.stringify(w || PLAN_W)].join('\u0001');
}
// Кэш по сигнатуре: пересчёт не должен зависеть от порядка вызовов.
const planCache = new Map();
function planCached(sig, compute) {
  const hit = planCache.get(sig);
  if (hit) return hit;
  const v = compute();
  if (planCache.size > 32) planCache.clear();
  planCache.set(sig, v);
  return v;
}
function planSteps(plan, opts) {
  const w = Object.assign({}, PLAN_W, (opts && opts.W) || {});
  const sig = planSignature(plan, w);
  return planCached(sig, () => planComputeSteps(plan, w));
}
// Полный план: для каждого неотмеченного уровня — состав вложений, причина выбора, доступное
// снаряжение и голод слотов. Отметки — вход: всё, что после них, считается от ФАКТА (spec §5.4).
// (r3-R2) Неотмеченный уровень с оверрайдом показывает и ПРИМЕНЯЕТ к хвосту оверрайд, а
// рекомендация движка остаётся в step.rec: из неё «почему так» и сверка флага «изменено».
// Состояние следующих уровней строится от применённого состава — правка любого этапа
// пересобирает хвост (objective 2026-11-12, требование 2).
function planComputeSteps(plan, w) {
  const tgt = plan.target;
  const marksSums = planPoolsAt(plan, 1);
  const marksGear = [];
  for (const m of plan.marks) for (const id of (m.inv && m.inv.gear) || []) if (marksGear.indexOf(id) < 0) marksGear.push(id);
  const own = { attr: {}, combat: {}, civil: {} };
  const ownTalents = [];
  const ownGear = [];
  const steps = [];
  const ovs = planOverridesOf(plan);
  for (let L = plan.marks.length + 1; L <= tgt.level; L++) {
    // применённое состояние НИЖЕ уровня: отметки + применённые составы рекомендованных уровней
    const cur = { attr: planMerge(marksSums.attr, own.attr), combat: planMerge(marksSums.combat, own.combat),
      civil: planMerge(marksSums.civil, own.civil) };
    // граны рекомендованных уровней («Всё прокачано», «Больше — лучше», Превращение) ложатся
    // в бюджет следующих уровней, как если бы они уже были фактом (review I2)
    const pools = planPoolsAt(plan, L, { talents: ownTalents, combat: own.combat });
    const talents = [].concat(marksSums.talents || [], ownTalents);
    const gear = [].concat(marksGear, ownGear);
    const left = { attr: Math.max(0, pools.attrTotal - planSum(cur.attr)),
      combat: Math.max(0, pools.combatTotal - planSum(cur.combat)),
      civil: Math.max(0, pools.civilTotal - planSum(cur.civil)) };
    // (r4-R4/R5) «доступно» и «ранее» снимаются ДО раздачи: left мутирует цикл вложений,
    // cur — объект состояния, talents пополняется талантом уровня
    const r4BelowSums = { attr: planSum(cur.attr), combat: planSum(cur.combat), civil: planSum(cur.civil) };
    const r4BelowTalents = talents.slice();
    const ctxOf = () => ({ plan: plan, L: L, attr: cur.attr, combat: cur.combat, civil: cur.civil,
      talents: talents, gear: gear,
      pools: Object.assign({}, pools, { attrLeft: left.attr, combatLeft: left.combat, civilLeft: left.civil }) });
    const picked = { attr: [], combat: [], civil: [] };
    const why = [];
    let deferred = false;
    for (const kind of PLAN_POOL_ORDER) {
      const ids = planPoolIds(kind);
      let guard = left[kind] + 1;
      while (left[kind] > 0 && guard-- > 0) {
        const c = ctxOf();
        const legal = ids.filter(id => planLegal(kind, id, c));
        if (!legal.length) break;
        const demand = legal.filter(id => ((tgt[kind] && tgt[kind][id]) || 0) - (cur[kind][id] || 0) > 0);
        const inDemand = demand.length > 0;
        const cand = inDemand ? demand : legal;
        const st = planCtxState(c);
        const basePower = planPower(st, L, w).power;
        const starved = Math.max(0, (tgt.skillsMemCost || 0) - planPower(st, L, w).f.mem);
        const pick = planPickBest(st, L, kind, cand, w, basePower, plan,
          inDemand ? 'demand' : 'surplus', inDemand && starved > 0, cur[kind], tgt[kind]);
        if (!pick.best) break;
        const id = pick.best.id;
        deferred = deferred || pick.deferred;
        if (!why.length || !why.some(x => x.kind === kind && x.chosen === id)) {
          why.push({ kind: kind, chosen: id, gain: Math.round(pick.best.delta * 100) / 100,
            alt: pick.alt ? pick.alt.id : null, altGain: pick.alt && Number.isFinite(pick.alt.delta)
              ? Math.round(pick.alt.delta * 100) / 100 : null, demand: inDemand });
        }
        const chip = picked[kind].find(x => x.id === id);
        if (chip) { chip.points += 1; chip.gain = Math.round((chip.gain + pick.best.delta) * 100) / 100; }
        else picked[kind].push({ id: id, points: 1, gain: Math.round(pick.best.delta * 100) / 100 });
        cur[kind][id] = (cur[kind][id] || 0) + 1;
        left[kind] -= 1;
      }
    }
    // Талант уровня: только из спроса билда и только легальный (пререквизит, конфликт, пик) — §5.2.
    const stepTalents = [];
    if (talents.length < pools.talentPicks) {
      const c = ctxOf();
      const cand = (tgt.talents || []).filter(id => talents.indexOf(id) < 0 && planLegal('talent', id, c));
      if (cand.length) {
        const st = planCtxState(c);
        const basePower = planPower(st, L, w).power;
        const best = cand.map(id => ({ id: id, delta: planOptionDelta(st, L, 'talent', id, w, basePower, plan) }))
          .sort((x, y) => (y.delta - x.delta) || (x.id < y.id ? -1 : 1))[0];
        stepTalents.push(best.id);
        talents.push(best.id);
      }
    }
    // Снаряжение: всё, что билд просит и что уже можно найти/надеть (availableGear — те же id).
    const stepGear = [];
    for (const g of (tgt.gear || [])) {
      if (gear.indexOf(g.id) >= 0) continue;
      if (!planLegal('gear', g.id, ctxOf())) continue;
      stepGear.push(g.id);
      gear.push(g.id);
    }
    // suggested несёт ТОТ ЖЕ состав, что и запись отметки (talents/gear включительно): иначе
    // «отметить как рекомендовано» молча теряло талант/вещь и не считало это отклонением (review C3, I7)
    const rec = { attr: {}, combat: {}, civil: {}, talents: stepTalents.slice(), gear: stepGear.slice() };
    for (const kind of PLAN_POOL_ORDER) for (const x of picked[kind]) rec[kind][x.id] = x.points;
    // применённый состав уровня: оверрайд — поверх рекомендации; он же станет фактом,
    // когда галка отметит уровень (r3-R2/R4)
    const ov = ovs[String(L)] || null;
    const applied = ov ? planNormalizeInv(ov) : rec;
    // r4-R4/R5: счётчики строки считаются из СВОИХ локальных pools/cur движка (включая граны
    // рекомендованных нижних уровней), applied — применённый состав уровня
    const r4b = planBudgetShape(pools, r4BelowSums, r4BelowTalents, applied);
    // (r3-R2) в накопленное состояние уровня уходит ПРИМЕНЁННЫЙ состав, а не рекомендация:
    // поэтому оверрайд серединного этапа пересобирает хвост, а его отмена — пересобирает обратно
    for (const kind of PLAN_POOL_ORDER)
      for (const [id, v] of Object.entries(applied[kind] || {})) own[kind][id] = (own[kind][id] || 0) + v;
    for (const tn of applied.talents || []) if (ownTalents.indexOf(tn) < 0) ownTalents.push(tn);
    for (const gid of applied.gear || []) if (ownGear.indexOf(gid) < 0) ownGear.push(gid);
    const chips = kind => Object.entries(applied[kind] || {}).map(([id, points]) => ({ id, points }));
    const post = { plan: plan, L: L,
      attr: planMerge(marksSums.attr, own.attr), combat: planMerge(marksSums.combat, own.combat),
      civil: planMerge(marksSums.civil, own.civil),
      talents: [].concat(marksSums.talents || [], ownTalents), gear: [].concat(marksGear, ownGear),
      pools: pools };
    const memF = planPower(planCtxState(post), L, w).f;
    steps.push({ level: L,
      left: { attr: Math.max(0, pools.attrTotal - planSum(post.attr)),
        combat: Math.max(0, pools.combatTotal - planSum(post.combat)),
        civil: Math.max(0, pools.civilTotal - planSum(post.civil)) },
      budget: r4b.budget,
      below: r4b.below,
      suggested: applied, rec: rec, override: ov,
      attr: chips('attr'), combat: chips('combat'), civil: chips('civil'),
      talents: (applied.talents || []).slice(), gear: (applied.gear || []).slice(),
      availableGear: stepGear.slice(),
      deferred: ov ? false : deferred, why: ov ? [] : why,
      starved: Math.max(0, (tgt.skillsMemCost || 0) - memF.mem) });
  }
  return steps;
}
function planSummarize(plan, steps) {
  const total = plan.target.level;
  const done = plan.marks.length;
  return { done: done, total: total, deviations: plan.marks.filter(m => m.deviation).length,
    starve: (steps || []).some(s => s.starved > 0) };
}
// План = слепок: пользователь обновляет его кнопкой, поэтому просроченность видна строкой (spec §6).
function planTargetKey(t) {
  const keys = o => Object.keys(o || {}).filter(k => o[k]).sort().map(k => k + ':' + o[k]).join(',');
  return [t.level, t.origin, t.race, keys(t.attr), keys(t.combat), keys(t.civil),
    (t.talents || []).slice().sort().join(','), t.skillsMemCost,
    (t.gear || []).map(g => g.slot + ':' + g.id).sort().join(',')].join('|');
}
function planTargetStale(plan) {
  if (!plan || !plan.target) return false;
  try { return planTargetKey(plan.target) !== planTargetKey(snapshotPlanTarget()); }
  catch (e) { return false; }
}

// Бюджет очков уровня L по отметкам плана (spec §5.2): те же выражения, что у pools(),
// но считаются не по живому состоянию, а по накопленному плану. extra — накопленные
// РЕКОМЕНДОВАННЫЕ уровни (talents/combat): их граны («Всё прокачано», «Больше — лучше»,
// Превращение) входят в бюджет следующих уровней так же, как граны отметок (review I2).
function planPoolsAt(plan, L, extra) {
  const acc = { attr: {}, combat: {}, civil: {} };
  const talents = [];
  for (const m of plan.marks) {
    for (const k of ['attr', 'combat', 'civil'])
      for (const [id, v] of Object.entries(m.inv[k])) acc[k][id] = (acc[k][id] || 0) + v;
    for (const t of m.inv.talents) if (!talents.includes(t)) talents.push(t);
  }
  const ex = extra || {};
  for (const t of ex.talents || []) if (!talents.includes(t)) talents.push(t);
  const exCombat = (ex.combat && typeof ex.combat === 'object') ? ex.combat : {};
  const sum = o => Object.values(o).reduce((s, v) => s + v, 0);
  const lw = talents.includes('Lone Wolf'), asu = talents.includes('All Skilled Up');
  const bigger = talents.includes('Bigger And Better');
  const poly = (acc.combat.polymorph || 0) + (exCombat.polymorph || 0);
  const attrTotal = LS_.attribute.atCreation + LS_.attribute.perLevel * (L - 1) + poly + (bigger ? 2 : 0);
  const combatTotal = LS_.combat.atCreation + LS_.combat.perLevel * (L - 1) + (asu ? 1 : 0);
  const civilTotal = LS_.civil.levels.filter(x => x <= L).length + (asu ? 1 : 0);
  const talentPicks = LS_.talent.levels.filter(x => x <= L).length;
  const attrSpent = sum(acc.attr), combatSpent = sum(acc.combat), civilSpent = sum(acc.civil);
  return { L, attrTotal, combatTotal, civilTotal, talentPicks,
    attrSpent, combatSpent, civilSpent, lw, asu, talents,
    attr: acc.attr, combat: acc.combat, civil: acc.civil,
    attrLeft: Math.max(0, attrTotal - attrSpent),
    combatLeft: Math.max(0, combatTotal - combatSpent),
    civilLeft: Math.max(0, civilTotal - civilSpent) };
}
// С какого уровня предмет уже можно найти (spec §5.2): у level-scaled предметов поле level —
// уровень снапшота, годится только min схемы масштабирования.
function planAvailFrom(it) {
  if (!it) return 1;
  if (it.levelScale) return Number.isFinite(it.levelScale.min) ? it.levelScale.min : 1;
  return Number.isFinite(it.level) ? it.level : 1;
}
const PLAN_TALENTS = () => CH.talents.selectable;
// Легален ли вариант прямо сейчас: кап, остаток пула, пререквизит/конфликт, доступность предмета.
function planLegal(kind, id, ctx) {
  const pools = ctx.pools || planPoolsAt(ctx.plan, ctx.L);
  const lw = ctx.talents ? ctx.talents.includes('Lone Wolf') : !!pools.lw;
  if (kind === 'attr') {
    const def = CH.attributes.find(a => a.id === id);
    if (!def) return false;
    return (ctx.attr[id] || 0) < attrInvCap(lw, def.base) && pools.attrLeft > 0;
  }
  if (kind === 'combat') {
    return COMBAT_IDS.includes(id) && (ctx.combat[id] || 0) < combatInvCap(lw, id) && pools.combatLeft > 0;
  }
  if (kind === 'civil') {
    return CIVIL_IDS.includes(id) && (ctx.civil[id] || 0) < LS_.civil.capEach && pools.civilLeft > 0;
  }
  if (kind === 'talent') {
    const t = PLAN_TALENTS().find(x => x.name === id);
    if (!t || ctx.talents.includes(id)) return false;
    const taken = ctx.talents.filter(n => PLAN_TALENTS().some(x => x.name === n));
    if (taken.length >= pools.talentPicks) return false;
    if ((t.conflicts || []).some(n => ctx.talents.includes(n))) return false;
    if (t.prerequisite) return withPlanState(planCtxState(ctx), () => talentPrereqMet(t));
    return true;
  }
  if (kind === 'gear') {
    const it = planItemById(ctx.plan, id);
    if (!it) return false;
    if (planAvailFrom(it) > ctx.L) return false;
    const r = it.requirements;
    if (r && r.attribute && (ctx.attr[r.attribute] || 0) < r.value) return false;
    return !(ctx.gear || []).includes(id);
  }
  return false;
}

// Слепок билда (spec §4): то, к чему план обязан привести персонажа к целевому уровню.
// Числа берутся из модели (memPool → стоимость навыков), а не пересчитываются заново.
function snapshotPlanTarget() {
  const f = computeFinal();
  const gear = [];
  for (const [slot] of EQUIP_SLOTS) {
    const id = state.equipment[slot];
    if (!id) continue;
    const it = itemById(id);
    if (!it) continue;
    gear.push({ slot, id: it.id, name: String(it.name || ''), rarity: String(it.rarity || ''),
      level: Number.isFinite(it.level) ? it.level : null,
      req: (it.requirements && it.requirements.attribute)
        ? { attribute: it.requirements.attribute, value: planInt(it.requirements.value) } : null,
      scaleMode: (it.levelScale && it.levelScale.mode) || null });
  }
  // Кузнечные предметы разрешимы только живым GEN — поэтому их payload едет в плане (spec §4).
  const inGen = new Set([...GEN.keys()]);
  const used = new Set(Object.values(state.equipment).filter(id => id && inGen.has(id)));
  const gen = [...GEN.values()].filter(it => used.has(it.id)).map(planCopy);
  return { level: state.level, origin: state.origin, race: state.race,
    attr: planCopy(state.attr), combat: planCopy(state.combat), civil: planCopy(state.civil),
    talents: [...state.talents], questTalents: [...(state.questTalents || [])],
    skillsMemCost: memPool(f).spent, gear, gen };
}
// Предмет плана: сначала живая база, потом payload плана (чистый GEN, открытый с телефона).
function planItemById(plan, id) {
  const base = itemById(id);
  if (base) return base;
  const gen = (plan && plan.target && Array.isArray(plan.target.gen)) ? plan.target.gen : [];
  return gen.find(it => it && it.id === id) || null;
}

// Конверт файла плана. Метки времени в самом конверте нет (экспортируемый план несёт savedAt),
// чтобы круг «файл → план → файл» оставался побайтно одинаковым.
function buildPlanFile(plan, idx) {
  return { app: 'dos2planner', kind: 'plan', version: PLAN_VER,
    planName: (plan && plan.name) || '', slotName: '', slot: Number.isInteger(idx) ? idx : null,
    plan: planCopy(plan) };
}
function parsePlanFile(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return { ok: false, key: 'plan.file_parse' }; }
  if (!d || typeof d !== 'object') return { ok: false, key: 'plan.file_no_plan' };
  if (d.app && d.app !== 'dos2planner') return { ok: false, key: 'plan.file_no_plan' };
  const p = (d.kind === 'plan') ? d.plan : d;
  if (!p || typeof p !== 'object') return { ok: false, key: 'plan.file_no_plan' };
  if ((d.kind === 'plan' && d.version > PLAN_VER) || (typeof p.version === 'number' && p.version > PLAN_VER))
    return { ok: false, key: 'plan.file_newer' };
  const clean = planNormalize(p);
  if (!clean) return { ok: false, key: 'plan.file_marks' };
  return { ok: true, plan: clean };
}
