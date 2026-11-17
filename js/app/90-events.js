// Part 90-events.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
// Stepper rules per invested group: read/write the value, the per-point cap,
// and the remaining pool. Table-driven so attr/combat/civil share one code path.
const STEPPER_RULES = {
  // Caps are the cap-bound ones, not the raw data caps: with Lone Wolf an attribute stops at 15
  // invested points and a combat ability at 5 (Polymorph is not doubled, so it stays 10).
  attr:   { get: id => state.attr[id],   set: (id, v) => { state.attr[id] = v; },   cap: () => attrInvCap(state.talents.includes('Lone Wolf')), pool: p => p.attrTotal - p.attrSpent },
  combat: { get: id => state.combat[id], set: (id, v) => { state.combat[id] = v; }, cap: id => combatInvCap(state.talents.includes('Lone Wolf'), id), pool: p => p.combatTotal - p.combatSpent, after: enforceTalents },
  civil:  { get: id => state.civil[id],  set: (id, v) => { state.civil[id] = v; },  cap: () => LS_.civil.capEach,      pool: p => p.civilTotal - p.civilSpent },
};
// Mutate an invested value by delta, respecting the per-point cap and the pool.
// Returns true if the value changed (so the caller re-renders only then).
function adjustStepper(act, id, delta) {
  const r = STEPPER_RULES[act];
  if (!r) return false;
  const cur = r.get(id);
  if (delta > 0) { if (cur >= r.cap(id) || r.pool(pools()) <= 0) return false; }
  else if (cur <= 0) return false;
  r.set(id, cur + delta);
  if (r.after) r.after();
  return true;
}
// Primary input cannot hover (phones/tablets): hover-only UI needs tap equivalents.
// No matchMedia (QA shim, old engines) => desktop branch, everything as before.
function isTouch() { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); }
// Зажатие −/+ (hold-repeat): значение меняется непрерывно до предела (кап строки или
// пул очков). Тайминги взяты из MUI Base UI NumberField (400 мс задержка → тик 60 мс),
// как у большинства веб-степперов — без ускорения. Pointer Events покрывают мышь/тач/перо
// одним путём; в движках без PointerEvent обработчики просто не срабатывают и остаётся
// прежний путь через click. Первый шаг идёт на pointerdown, а клик-«хвост» гасится флагом
// pointerStepped (иначе при отпускании выходило бы лишнее очко). Строка после каждого
// шага перерисовывается innerHTML и нажатый узел детачится — поэтому состояние повтора
// живёт в замыкании (act/id/d), а не на кнопке; упор в кап останавливает повтор сам,
// т.к. adjustStepper возвращает false. Клавиатура не затронута: удержание Enter/Space
// порождает повторные click на уровне ОС и идёт по прежнему пути.
const HOLD_START_MS = 400, HOLD_TICK_MS = 60;
function initStepperEvents() {
  let hold = null;              // active repeat: { act, id, d, start, tick }
  let pointerStepped = null;    // step already applied on pointerdown — swallow the trailing click
  const stopHold = () => {
    if (!hold) return;
    clearTimeout(hold.start); clearInterval(hold.tick);
    hold = null;
  };
  const holdStep = () => {
    if (!hold) return;
    if (!adjustStepper(hold.act, hold.id, hold.d)) { stopHold(); return; }
    afterChange();
  };
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const b = e.target.closest && e.target.closest('button[data-act]');
    if (!b) return;
    e.preventDefault(); // no text selection (mouse), no long-press menu (touch)
    stopHold();
    const act = b.dataset.act, id = b.dataset.id, d = +b.dataset.d;
    if (!adjustStepper(act, id, d)) return;
    afterChange();
    pointerStepped = { act, id, d };
    hold = { act, id, d, start: setTimeout(() => { if (hold) hold.tick = setInterval(holdStep, HOLD_TICK_MS); }, HOLD_START_MS) };
  });
  document.addEventListener('pointerup', stopHold);
  document.addEventListener('pointercancel', stopHold);
  document.addEventListener('visibilitychange', stopHold);
  if (window.addEventListener) window.addEventListener('blur', stopHold);
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const p = pointerStepped;
      pointerStepped = null;
      // pointerdown уже ввёл шаг — гасим клик-хвост только для той же кнопки
      if (p && p.act === b.dataset.act && p.id === b.dataset.id && p.d === +b.dataset.d) return;
      if (adjustStepper(b.dataset.act, b.dataset.id, +b.dataset.d)) afterChange();
      return;
    }
    const u = e.target.closest('button[data-uneq]');
    if (u) { unequipItem(u.dataset.uneq); return; }
    const pk = e.target.closest('button[data-pick]');
    if (pk) { pickForSlot(pk.dataset.pick); return; }
    const open = e.target.closest('[data-open]');
    if (open) {
      // Контеймент снимается ДО renderDB(): переназначение innerHTML #itemList
      // детачит кликнутый узел, и closest() на нём больше ничего не находит.
      const inCharPane = isTouch() && !!open.closest('#equipRows');
      const inList = isTouch() && !!open.closest('#itemList');
      _sheetOrigin = inCharPane ? 'equip' : inList ? 'list' : _sheetOrigin;
      selId = open.dataset.open; renderDB(); renderDetail();
      // Тап по экипированной вещи — детали в независимом bottom-sheet прямо над основным
      // экраном, панель базы НЕ открывается (spec 2026-11-10, D2; Apple HIG Sheets: «Display
      // only one sheet at a time»). body.item-open ставит renderDetail().
      // Тап по строке базы — детали под складкой на телефоне, доскроллить до них.
      if (inList) {
        const ds = $('#detailSec');
        if (ds && ds.scrollIntoView) ds.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });
}
function initTalentEvents() {
  $('#talentRows').addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"]')) toggleTalent(e.target.dataset.talent);
  });
  $('#questTalentRows').addEventListener('change', e => {
    if (e.target.id === 'spiderKissVision') {
      state.spiderKissVision = e.target.value;
      afterChange();
      return;
    }
    if (!e.target.matches('input[type="checkbox"]')) return;
    const n = e.target.dataset.quest;
    if (e.target.checked) state.questTalents.push(n);
    else state.questTalents = state.questTalents.filter(x => x !== n);
    afterChange();
  });
}
function initDBEvents() {
  $('#searchBox').addEventListener('input', () => { readFilters(); renderDB(); });
  for (const id of ['fRarity', 'fSlot', 'fArea', 'fLevel', 'fWeaponType']) $('#' + id).addEventListener('change', () => { readFilters(); renderDB(); });
  $('#fSlot').addEventListener('change', syncWeaponTypeFilter);
  $('#gSlot').addEventListener('change', syncForgeWeaponType);
  for (const id of ['fSkill', 'fCoords', 'fDe', 'fScale']) $('#' + id).addEventListener('change', () => { readFilters(); renderDB(); });
  $('#fReset').addEventListener('click', resetFilters);
  // Column headers: clicking sorts the table by that column.
  $('#itemHead').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (b) toggleSort(b.dataset.sort);
  });
  $('#detail').addEventListener('click', e => {
    const eq = e.target.closest('[data-eq]');
    if (eq) {
      // 'mh'/'oh' — явная рука (design 2026-11-07-dual-hand §5.1), '1' — авто, '0' — снять
      const h = eq.dataset.eq;
      if (h === '0') unequipCurrent();
      else equipItem(selId, h === '1' ? undefined : h);
      return;
    }
    const bag = e.target.closest('[data-bag]');
    if (bag) {
      if (bag.dataset.bag === '1') { if (!state.bag.includes(selId)) state.bag.push(selId); }
      else state.bag = state.bag.filter(x => x !== selId);
      afterChange();
    }
  });
}
/* ==================== 10. Items drawer + hover preview ====================
   The item DB / forge / detail column is hidden by default (drawer off-screen).
   It slides in from the right on the "pick item" button (equipment header) or
   the right-edge tab, and closes via its own button or Esc.
 * The drawer hosts two lists (items / skills): body.items-open и body.skills-open
 * открывают его, data-pane на #itemsDrawer выбирает, какой список показан. */
// какой список показан: 'items' | 'skills'
let drawerPane = 'items';
// переход закрыт→открыт для хинта пилюли (spec 2026-11-09-grab-head-overlap): модульный
// флаг, не classList.contains — под QA-шимом у body только toggle (челендж r2 P1-1).
let drawerWasOpen = false, drawerHinted = false;
// Хинт «потяни вниз» при первом открытии телефонами: пилюля дважды приседает, флаг в
// localStorage ставится сразу при навешивании (закрыл в первые ~2.15s — показанной;
// сознательный трейд-офф). Под prefers-reduced-motion не ставится вовсе. Шим-гарды
// обязательны: под QA-шимом window без matchMedia, элементы без classList (app/qa/shim.js).
function _hintGrabOnce() {
  if (drawerHinted || _reducedMotion()) return;
  if (!(window.matchMedia && window.matchMedia('(max-width: 740px)').matches)) return;
  const g = $('#drawerGrab');
  if (!g || !g.classList || !g.addEventListener) return;
  try {
    if (window.localStorage && localStorage.getItem('dos2.grabHinted')) return;
    if (window.localStorage) localStorage.setItem('dos2.grabHinted', '1');
  } catch (e) { return; }
  drawerHinted = true;
  g.classList.add('hint');
  const off = () => { g.classList.remove('hint'); g.removeEventListener('animationend', off); };
  g.addEventListener('animationend', off);
}
function setDrawerPane(pane, open) {
  const p = pane === 'skills' ? 'skills' : 'items';
  drawerPane = p;
  const b = document.body;
  if (b && b.classList) {
    b.classList.toggle('items-open', !!open && p === 'items');
    b.classList.toggle('skills-open', !!open && p === 'skills');
  }
  // одноразовый хинт пилюли при переходе закрыт→открыт (spec 2026-11-09-grab-head-overlap)
  if (open && !drawerWasOpen) _hintGrabOnce();
  // Открытие панели базы убирает лист из «Экипировки»: поверхности не накладываются
  // (spec 2026-11-10, D7-симметрия: HIG Sheets «one sheet at a time», иначе список
  // базы открылся бы наполовину под чужим листом)
  if (open && !drawerWasOpen && selId && _sheetOrigin === 'equip') {
    selId = null; _sheetOrigin = null; renderDB(); renderDetail();
  }
  drawerWasOpen = !!open;
  // План и база — два drawer-слоя одной поверхности: открытие базы снимает план с экрана
  // (review C1: правило body.items-open .drawer исторически раскрывало и #planDrawer;
  // теперь план закрывается и симметрично, и селекторами — «поверхности не накладываются», спека §6)
  if (open && typeof planUi !== 'undefined' && typeof setPlanOpen === 'function' && planUi.open) {
    setPlanOpen(false);
  }
  // disclosure-семантика APG: aria-expanded у кнопок-триггеров шапки (лейблы не меняются)
  const segI = $('#drawerTab'), segS = $('#skillsTab');
  if (segI && segI.setAttribute) segI.setAttribute('aria-expanded', String(!!open && p === 'items'));
  if (segS && segS.setAttribute) segS.setAttribute('aria-expanded', String(!!open && p === 'skills'));
  // Триггеры остаются видны, но уходят под панель: исключаем их из tree-order и AT
  // (inert; для движков без inert — aria-hidden + tabindex=-1). visibility/display
  // НЕ трогаем: именно переключение видимости коробки под transform-анимированным
  // drawer на iOS оставляло пилюлю без рамки и заливки (spec 2026-11-08-seg-touch-state)
  const seg = $('#dbSeg');
  if (seg && seg.setAttribute) {
    // inert/aria-hidden нельзя вешать на предка элемента, у которого фокус (axe
    // aria-hidden-focus): при открытии тапом триггер остаётся сфокусирован
    const act = document.activeElement;
    if (open && act && act.blur && (act === segI || act === segS)) act.blur();
    if (open) seg.setAttribute('inert', ''); else seg.removeAttribute('inert');
    if (open) seg.setAttribute('aria-hidden', 'true'); else seg.removeAttribute('aria-hidden');
    for (const b of [segI, segS]) {
      if (b && b.setAttribute) { if (open) b.setAttribute('tabindex', '-1'); else b.removeAttribute('tabindex'); }
    }
  }
  const drawer = $('#itemsDrawer');
  if (drawer && drawer.setAttribute) {
    drawer.setAttribute('data-pane', p);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  for (const [id, tab] of [['dtabItems', 'items'], ['dtabSkills', 'skills']]) {
    const el = $('#' + id);
    if (el && el.setAttribute) el.setAttribute('aria-selected', tab === p ? 'true' : 'false');
  }
  hideHoverCard();
  if (p === 'skills') renderSkillDb();
  // Тач: не угонять фокус в поиск — клавиатура закрыла бы половину экрана.
  if (open && !isTouch() && typeof setTimeout === 'function') {
    const focusId = p === 'skills' ? 'skSearch' : 'searchBox';
    setTimeout(() => { const s = $('#' + focusId); if (s && s.focus) s.focus(); }, 320);
  }
}
function setItemsOpen(open) { setDrawerPane('items', open); }
function setSkillsOpen(open) { setDrawerPane('skills', open); }
// Свернуть, не сбрасывая активный список: повторное открытие кнопкой шапочной
// группы (#drawerTab / #skillsTab) вернёт тот же список.
function closeDrawer() {
  // Если панель закрыли извне (Esc/кнопка) во время драга — снять инлайн-сдвиг,
  // иначе он переживёт закрытие и «запомнит» translateY (P0-3, челендж r1).
  const dr = $('#itemsDrawer');
  if (dr && dr.style) _clearInlineDrag(dr);
  // Лист, открытый из списка, принадлежит панели: закрытие панели уносит и его
  // (spec 2026-11-10 D7, челендж r1: иначе лист-сирота висел бы над основным экраном;
  // HIG Sheets: closing a sheet returns to the parent view). Лист из «Экипировки»
  // (origin='equip') независим — панель его не касается.
  if (_sheetOrigin === 'list' && selId) {
    selId = null; _sheetOrigin = null; renderDB(); renderDetail();
  }
  const trig = $(drawerPane === 'skills' ? '#skillsTab' : '#drawerTab');
  setDrawerPane(drawerPane, false);
  // Фокус возвращается триггеру при ЛЮБОМ способе закрытия — и по Esc, и по кнопке ✕
  // (APG aria-disclosure pattern; M3 Web: «set focus to the dialog trigger»).
  // preventScroll: закрытие панели не должно угонять длинную страницу к шапке.
  if (trig && trig.focus) { try { trig.focus({ preventScroll: true }); } catch (err) { trig.focus(); } }
}
// ---------- «Стяни вниз» (spec 2026-11-09-drawer-drag-dismiss, решение пользователя) ----------
// Мобильный критерий тот же, что у вёрстки: ≤740px. Нет matchMedia (QA-shim/старые движки)
// => false, слушателей не навешивается вовсе — desktop-путь не затронут.
function _reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
// Снять инлайн-стили драга в один кадр: transition:none живёт только в этом таске —
// иначе браузер анимирует переход от translateY в CSS-состояние и панель «проезжает»
// по диагонали через экран (P0-3, челендж r1). Инлайн-стилей нет => не трогаем ничего:
// transition:none, флашнутый синхронно фокусом триггера, срезал бы CSS slide-out
// закрытия на desktop (челендж r2 P1).
function _clearInlineDrag(panel) {
  if (!panel || !panel.style) return;
  if (!panel.style.transform && !panel.style.transition) return;
  panel.style.transition = 'none';
  panel.style.transform = '';
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { panel.style.transition = ''; });
  else panel.style.transition = '';
}
// Дождаться конца transform-перехода с страховочным таймером; возвращает cancel() —
// снять слушателя/таймер, если жест уже не актуален (челендж r2 P2).
function _whenSettled(panel, fn) {
  let fired = false, timer = null;
  const onEnd = e => { if (e.target === panel && e.propertyName === 'transform') once(); };
  function once() { if (fired) return; fired = true; clearTimeout(timer); panel.removeEventListener('transitionend', onEnd); fn(); }
  panel.addEventListener('transitionend', onEnd);
  // .28/.24s + запас на случай несработавшего transitionend
  timer = setTimeout(once, 480);
  return () => { if (fired) return; fired = true; clearTimeout(timer); panel.removeEventListener('transitionend', onEnd); };
}
// Универсальный жест «стянуть вниз»: панель едет translateY; порог = доля высоты или
// флик => закрыть, раньше порога => пружина назад. tapClose — только пилюля: тап по
// шапке панели ничего не закрывает, а click после драга гасится (P0-1, челендж r1).
// Возвращает detach().
function attachDragDismiss(panel, handles, opts) {
  if (!panel || !panel.style || !opts || !opts.canStart || !opts.dismiss) return function () {};
  let st = null, dragged = false, cancelSettle = null;
  const offs = [];
  //Pending-дожидание одно на жест: новый жест/detach отменяет старое (челендж r2 P2),
  //иначе старый once закроет панель посреди результата нового жеста.
  const settle = fn => {
    if (cancelSettle) cancelSettle();
    cancelSettle = _whenSettled(panel, () => { cancelSettle = null; fn(); });
  };
  const bounce = () => {
    // reduce => мгновенно, без пружины и 480-мс страховки (челендж r2 P2)
    if (_reducedMotion()) { _clearInlineDrag(panel); return; }
    panel.style.transition = 'transform .24s ease';
    const go = () => { panel.style.transform = ''; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go();
    settle(() => _clearInlineDrag(panel));
  };
  for (const h of handles) {
    if (!h || !h.addEventListener) continue;
    const onDown = e => {
      // мультитач: второй палец игнор
      if (st || e.button !== 0 || !opts.canStart()) return;
      // новый жест прерывает старую анимацию
      if (cancelSettle) { cancelSettle(); cancelSettle = null; }
      st = { id: e.pointerId, y0: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
      dragged = false;
      if (h.setPointerCapture) { try { h.setPointerCapture(e.pointerId); } catch (err) { /* shim */ } }
    };
    const onMove = e => {
      if (!st || e.pointerId !== st.id) return;
      // закрыли извне/смена вьюпорта — драг снимается
      if (!opts.canStart()) { _clearInlineDrag(panel); st = null; return; }
      // скорость вниз положительна
      st.v = (e.clientY - st.lastY) / Math.max(1, e.timeStamp - st.lastT);
      st.lastY = e.clientY; st.lastT = e.timeStamp;
      // вверх не тащим
      st.dy = Math.max(0, e.clientY - st.y0);
      if (st.dy > 6) {
        dragged = true;
        panel.style.transition = 'none';
        panel.style.transform = 'translateY(' + st.dy + 'px)';
      }
    };
    const onUp = e => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      // тап — дело click-слушателя
      if (!dragged) return;
      // закрыли извне между последним move и up — не гнать вторую анимацию (челендж r2 P2)
      if (!opts.canStart()) { _clearInlineDrag(panel); return; }
      const h0 = panel.getBoundingClientRect().height || 1;
      // порог по высоте или короткий флик вниз (px/ms)
      if (s.dy > h0 * opts.threshold || s.v > 0.55) {
        if (_reducedMotion()) { _clearInlineDrag(panel); opts.dismiss(); return; }
        panel.style.transition = 'transform .28s cubic-bezier(.32, .72, 0, 1)';
        const go = () => { panel.style.transform = 'translateY(' + Math.round(h0 + 8) + 'px)'; };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go();
        settle(() => { _clearInlineDrag(panel); opts.dismiss(); });
      } else bounce();
    };
    // iOS back-swipe/перехват скролла браузером: pointerup после cancel не приходит (P0-2 r1)
    const onCancel = e => { if (st && e.pointerId === st.id) { st = null; if (dragged) bounce(); } };
    h.addEventListener('pointerdown', onDown);
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onCancel);
    offs.push(() => {
      h.removeEventListener('pointerdown', onDown); h.removeEventListener('pointermove', onMove);
      h.removeEventListener('pointerup', onUp); h.removeEventListener('pointercancel', onCancel);
    });
  }
  const tap = opts.tapEl;
  if (tap && tap.addEventListener) {
    // click после драга гасится: пружина не должна «съедаться» им (челендж r1 P0-1)
    const onClick = () => { if (dragged) { dragged = false; return; } opts.dismiss(); };
    const onKey = e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); opts.dismiss(); }
    };
    tap.addEventListener('click', onClick);
    tap.addEventListener('keydown', onKey);
    offs.push(() => { tap.removeEventListener('click', onClick); tap.removeEventListener('keydown', onKey); });
  }
  return function () { if (cancelSettle) cancelSettle(); for (const f of offs) f(); _clearInlineDrag(panel); };
}
// Проводка жестов; при смене ширины вьюпорта переповешивать: на >740px возвращается
// кнопка и жест снимается (P1-2, челендж r1).
function initDragDismiss() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(max-width: 740px)');
  let detach = null;
  let detachPlan = null;
  const apply = () => {
    if (detach) { detach(); detach = null; }
    if (detachPlan) { detachPlan(); detachPlan = null; }
    if (!mq.matches) return;
    // план прокачки — тот же bottom-sheet-жест, что у базы (spec 2026-11-11-lvlup-plan §6)
    const planPanel = $('#planDrawer'), pg = $('#planGrab');
    if (planPanel) {
      detachPlan = attachDragDismiss(planPanel, [pg, planPanel.querySelector && planPanel.querySelector('.drawer-head')], {
        threshold: 0.25, tapEl: pg,
        canStart: () => { const b = document.body; return !!(b && b.classList && b.classList.contains('plan-open')); },
        dismiss: () => setPlanOpen(false),
      });
    }
    const drawer = $('#itemsDrawer'), dg = $('#drawerGrab');
    const head = document.querySelector && document.querySelector('.drawer-head');
    if (drawer) detach = attachDragDismiss(drawer, [dg, head], {
      threshold: 0.25, tapEl: dg,
      canStart: () => { const b = document.body; return !!(b && b.classList && (b.classList.contains('items-open') || b.classList.contains('skills-open'))); },
      dismiss: closeDrawer,
    });
    const sheet = $('#detailSec'), sg = $('#sheetGrab');
    if (sheet) {
      const detachSheet = attachDragDismiss(sheet, [sg], {
        threshold: 0.30, tapEl: sg,
        canStart: () => { const b = document.body; return !!(b && b.classList && b.classList.contains('item-open')); },
        // Пилюля уезжает вместе с листом — возврат фокуса открывшему (P1-4, челендж r1;
        // общий путь с Esc — closeItemSheet, spec 2026-11-10 D2).
        dismiss: closeItemSheet,
      });
      const prev = detach;
      detach = () => { if (prev) prev(); detachSheet(); };
    }
  };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else if (mq.addListener) mq.addListener(apply);
}
// Equipment slot key → forge ("Кузница редкости") slot value; slots not listed
// share their key with the forge select (helmet/chest/…/amulet).
const FORGE_SLOT = { main_hand: 'weapon', off_hand: 'shield', ring1: 'ring', ring2: 'ring' };
// Per-slot "pick" button: preset the DB slot filter, the forge slot type and the
// forge level (the character's current level, same 1..22 clamp as rollItem), then
// slide the drawer in. ring1/ring2 map to the common "ring" filter value.
function pickForSlot(key) {
  const slot = (key === 'ring1' || key === 'ring2') ? 'ring' : key;
  $('#fSlot').value = slot;
  readFilters();
  syncWeaponTypeFilter();
  renderDB();
  $('#gSlot').value = FORGE_SLOT[key] || key;
  $('#gLevel').value = Math.max(1, Math.min(22, state.level));
  syncForgeWeaponType();
  const list = $('#itemList');
  if (list && list.scrollTo) list.scrollTo(0, 0); else if (list) list.scrollTop = 0;
  setItemsOpen(true);
}
// ---------- Слой листа предмета (spec 2026-11-10-equip-sheet-independent, D1) ----------
// Мобильный слой (≤740px, тот же критерий, что у вёрстки): лист переезжает в document.body —
// закрытый drawer с transform:translateX(101%) становится containing block для fixed-потомка,
// поэтому лист внутри панели не может существовать без открытой базы (Apple HIG Sheets:
// «Display only one sheet at a time»). Мобильный CSS уже фиксирует лист к нижней кромке
// вьюпорта — пиксели не смещаются; desktop-DOM не меняется вовсе (пиксельный гейт).
// Нет matchMedia (QA-шим/старые движки) — нет-op, desktop-путь не затронут.
function initSheetLayer() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(max-width: 740px)');
  const apply = () => {
    const sec = $('#detailSec'), pane = $('#detailPane'), b = document.body;
    if (!sec || !pane || !b || !b.appendChild) return;
    if (mq.matches) { if (sec.parentElement !== b) b.appendChild(sec); }
    else if (sec.parentElement !== pane) pane.appendChild(sec);
  };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
}
function initDrawerEvents() {
  $('#drawerTab').addEventListener('click', () => setItemsOpen(true));
  $('#skillsTab').addEventListener('click', () => setSkillsOpen(true));
  // Вкладки внутри панели: тот же drawer, другой список (data-pane).
  const tabs = $('#drawerTabs');
  if (tabs && tabs.addEventListener) tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-pane]');
    if (b) setDrawerPane(b.dataset.pane, true);
  });
  $('#drawerClose').addEventListener('click', closeDrawer);
  // iOS Safari не рисует :active на кнопках, у которых нет touch-обработчика, —
  // без этого шага пресс-состояние триггеров на iPhone не появляется вовсе
  // (MDN «:active — Limitations», 2026). Пустой пассивный слушатель, cost ~0.
  if (document.addEventListener) document.addEventListener('touchstart', function () {}, { capture: true, passive: true });
  // Лист предмета (моб. bottom-sheet) сворачивается стягиванием вниз по пилюле-грабку
  // (#sheetGrab, attachDragDismiss) — кнопка «Свернуть ✕» убрана решением пользователя
  // (spec 2026-11-09-drawer-drag-dismiss; прежняя мобильная кнопка листа удалена из разметки).
  if (document.addEventListener) {
    // Esc: закрыть и вернуть фокус триггеру (APG disclosure) — но только если drawer
    // был открыт (guard r1 P1-2): иначе Esc угонял бы фокус из любой точки документа.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // первой веткой — снять hover-карточку (WCAG 1.4.13 dismissable): иначе Esc от чипа
      // гранта закрывал бы и карточку, и drawer (design 2026-11-09 §3.1)
      const hc = $('#hoverCard');
      if (hc && !hc.hidden) { hideHoverCard(); return; }
      const b = document.body;
      // Верхний слой первым — независимый лист предмета (spec 2026-11-10, D4: Esc закрывает
      // верхнюю поверхность; раньше лист прятался вместе с панелью, живя внутри неё).
      // Класс item-open ставится и на desktop, а видим лист только в мобильном слое ≤740px —
      // иначе Esc закрывал бы несуществующий лист и съедал закрытие панели (челендж r1).
      if (window.matchMedia && window.matchMedia('(max-width: 740px)').matches &&
          b && b.classList && b.classList.contains('item-open')) { closeItemSheet(); return; }
      const wasOpen = b && b.classList && (b.classList.contains('items-open') || b.classList.contains('skills-open'));
      if (!wasOpen) return;
      // фокус триггеру возвращает closeDrawer — единое место для Esc и кнопки ✕
      closeDrawer();
    });
  }
}
// Read-only item card for hovering equipped items (no actions/compare — the
// full card lives in the drawer's detail pane).
function hoverCardHtml(it) {
  const f = computeFinal();
  return _detailHead(it)
    + _detailReq(it, f) + _detailBase(it) + _detailScale(it, true) + _detailAffixes(it)
    + _detailGranted(it, false)
    + _detailLocation(it);
}
function showHoverCard(cell) {
  // На таче карточку по наведению ни показать, ни прочитать — тап-эквивалент в click-хендлере.
  if (isTouch()) return;
  const card = $('#hoverCard');
  if (!card || !cell || !cell.getBoundingClientRect || typeof window === 'undefined') return;
  const stat = cell.getAttribute('data-skill');
  if (stat) {
    const sk = SKILL_BY_STAT[stat] || GRANT_BY_STAT[stat];
    if (!sk) return;
    card.innerHTML = skillCardHtml(sk, cell.getAttribute('data-skill-ctx'));
  } else {
    // (r4-R1) плановые вещи: кузнечный payload живёт только в плане — резолвим planItemById
    const id = cell.getAttribute('data-open');
    const it = (cell.getAttribute('data-plan-item') !== null && typeof planItemById === 'function')
      ? planItemById(planState && planState.working ? planState.working : {}, id)
      : itemById(id);
    if (!it) return;
    card.innerHTML = hoverCardHtml(it);
  }
  card.hidden = false;
  const r = cell.getBoundingClientRect();
  const w = card.offsetWidth || 340, h = card.offsetHeight || 240;
  let x = r.right + 10;
  if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 10);
  let y = r.top - 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  card.style.left = x + 'px';
  card.style.top = y + 'px';
}
function hideHoverCard() { const card = $('#hoverCard'); if (card) card.hidden = true; }
function initHoverPreview() {
  // Карточку по наведению показывают и предметы (data-open), и строки навыков
  // (data-skill): селектор разный, обработчик один. Чипы секции «Навыки» на основном
  // экране (skillRows) получают ту же карточку, что список панели. Чипы грантов в detail
  // (design 2026-11-09 §3.1) — третий хост; focusin/focusout — зеркало мыши (клавиатура,
  // WCAG 1.4.13): без них после отказа от desktop-desc-строки описание жило бы только под мышью.
  const HOVER_HOSTS = [['equipRows', '[data-open]'], ['skillList', '[data-skill]'], ['skillRows', '.schip'], ['detail', '[data-skill]'],
    // (r4-R1) плановые вещи показывают ту же карточку предмета, что секция «Снаряжение»
    ['planBody', '[data-open]']];
  for (const [id, sel] of HOVER_HOSTS) {
    const host = $('#' + id);
    host.addEventListener('mouseover', e => {
      const cell = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (cell) showHoverCard(cell);
    });
    host.addEventListener('mouseout', e => {
      const cell = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (cell) hideHoverCard();
    });
    host.addEventListener('focusin', e => {
      const cell = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (cell) showHoverCard(cell);
    });
    host.addEventListener('focusout', e => {
      const cell = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (cell) hideHoverCard();
    });
  }
  if (document.addEventListener) document.addEventListener('scroll', hideHoverCard, true);
  // Подключение/отключение тач-ввода на лету: detail перерисовывается (desc-строка гранта
  // живёт только на таче, design 2026-11-09 §3.2). В движках без addEventListener — нет-op.
  if (window.matchMedia) {
    const mqHover = window.matchMedia('(hover: none)');
    if (mqHover.addEventListener) mqHover.addEventListener('change', () => renderDetail());
  }
}

/* ==================== Layout: draggable sections (SortableJS) ====================
   Each .sec in #charPane can be dragged by its <h2> and moved within its column or
   into another column. The order is a UI preference, so it lives in its OWN localStorage
   key (not dos2planner.v1): build reset / import / export never touch it. index.html
   keeps the approved default order (guarded by app/qa/layout_order.js); a valid saved
   order is re-applied at init, a corrupt/unknown one is ignored. No window.Sortable
   (QA shim, degraded mode) => HTML default, no-op. */
