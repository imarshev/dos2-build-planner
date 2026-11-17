// Part 40-render-char.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';
function renderOriginRace() {
  const oSel = $('#originSel'), rSel = $('#raceSel');
  if (oSel.options.length === 0 || oSel._lang !== state.lang) {
    oSel._lang = state.lang; rSel._lang = state.lang;
    rebuildSelect(oSel, CH.origins.map(o => [o.id, L(o)]));
    rebuildSelect(rSel, CH.races.map(r => [r.id, L(r)]));
  }
  const o = CH.origins.find(x => x.id === state.origin);
  // Story origins lock the race (hardcoded in the game); only "custom" allows a free choice.
  rSel.disabled = !!(o && o.race);
  oSel.value = state.origin;
  rSel.value = state.race;
  let html = o ? esc(TT(o, 'lore')) : '';
  if (state.race === 'undead') html += ' · ' + t('origin.undead_note');
  $('#originInfo').innerHTML = html;
  $('#heroPortrait').innerHTML = _portraitMarkup(heroIconId());
}
// Заметка и title-подсказка берут имя таланта из тех же данных, что и строка чекбокса: L() даёт
// официальное имя из пака (post-пасс build_data.js), поэтому подпись заметки и список талантов
// не могут разъехаться — именно так и родился прежний баг со «старым переводом». Эффект таланта
// — по очку в пул (pools()), а не уровни умений; pak uid — в комментарии _finalCivil.
function asuTalentName() {
  return L(CH.talents.selectable.find(x => x.name === 'All Skilled Up'));
}
const asuNote = (key) => esc(t(key, { talent: asuTalentName() }));
function renderLevelPools() {
  $('#levelRange').value = state.level;
  $('#levelOut').textContent = state.level;
  const p = pools();
  // Заметки ASU живут в секциях боя и гражданских (где очки тратятся), как у «Волка-одиночки»;
  // чип получает нативный title — объяснить, откуда в x/y взялось +1, не раздувая строку.
  const chip = (label, left, total, title) =>
    `<span class="pool"${title ? ` title="${title}"` : ''}>` +
      `<span class="pool-l">${label}</span>` +
      `<b class="pool-v${left === 0 ? ' zero' : ''}">${left < 0 ? `<span class="neg">${left}</span>` : left}<span class="tot">/${total}</span></b>` +
    `</span>`;
  $('#pools').innerHTML =
    `<span class="pool-row">` +
      chip(t('pool.attrs'), p.attrTotal - p.attrSpent, p.attrTotal) +
      chip(t('pool.combat'), p.combatTotal - p.combatSpent, p.combatTotal, p.asu ? asuNote('combat.asu_note') : '') +
      chip(t('pool.civil'), p.civilTotal - p.civilSpent, p.civilTotal, p.asu ? asuNote('civil.asu_note') : '') +
      chip(t('pool.talents'), p.talentPicks - state.talents.length, p.talentPicks) +
    `</span>`;
  $('#attrPool').textContent = `${p.attrTotal - p.attrSpent}`;
  $('#combatPool').textContent = `${p.combatTotal - p.combatSpent}`;
  $('#civilPool').textContent = `${p.civilTotal - p.civilSpent}`;
  $('#talentPool').textContent = `${p.talentPicks - state.talents.length}`;
}
// Shared row fragments for the attribute / combat / civil steppers.
const _gearCell = g => g !== 0 ? (g > 0 ? '+' + g : g) : '0';
function _stepperHtml(act, id, inv, cap, poolLeft, midCls, midText) {
  return `<div class="stepper">
    <button data-act="${act}" data-id="${id}" data-d="-1" ${inv <= 0 ? 'disabled' : ''}>−</button>
    <span class="cur${midCls ? ' ' + midCls : ''}">${midText}</span>
    <button data-act="${act}" data-id="${id}" data-d="1" ${(inv >= cap || poolLeft <= 0) ? 'disabled' : ''}>+</button>
  </div>`;
}
function renderAttrs() {
  const f = computeFinal(), p = pools();
  // Cap of invested points depends on Lone Wolf: 30 without it, 15 with it — both reach the same
  // 40 (the doubling is cap-bound, see attrInvCap). The bar below each row counts effective
  // points, so it is full at the cap either way, not at 50 % as a raw inv/30 would show.
  const maxInv = attrInvCap(p.lw);
  const capPts = LS_.attribute.cap - 10;
  // Заметка «Волк-одиночка» живёт здесь, а не в блоке «Уровень»: объясняет «×2» там, где он
  // стоит — над строками атрибутов.
  $('#attrNote').innerHTML = p.lw ? esc(t('attr.lw_note')) : '';
  let html = '';
  for (const a of CH.attributes) {
    const inv = state.attr[a.id], gear = f.gear.attr[a.id] || 0, total = f.attr[a.id];
    // Invested points can no longer pass the cap (the stepper blocks them, clampInvested legalises
    // saved builds), so the over-cap marker now flags what really can go over it: gear on top of 40.
    const doubled = p.lw && inv > 0, over = total > LS_.attribute.cap;
    html += `<div class="srow" title="${esc(tooltipAttr(a, total))}">
      <div class="nm">${L(a)}${over ? ` <span class="approx" title="${esc(t('final.over_cap'))}">⚠</span>` : ''}</div>
      <div class="val muted">10</div>
      <div class="val">${inv > 0 ? '+' + inv + (doubled ? '×2' : '') : '0'}</div>
      <div class="val gear">${_gearCell(gear)}</div>
      ${_stepperHtml('attr', a.id, inv, maxInv, p.attrTotal - p.attrSpent, 'total', total)}
    </div>
    <div class="capbar"><i style="width:${Math.min(100, (attrEff(p.lw, inv, a.base) / capPts) * 100)}%"></i></div>`;
  }
  $('#attrRows').innerHTML = html;
}
function skillRow(id, name, sub) {
  const f = computeFinal(), p = pools();
  const inv = state.combat[id] || 0, gear = f.gear.skill[id] || 0, eff = f.combat[id];
  const doubled = p.lw && id !== 'polymorph' && inv > 0;
  return `<div class="srow" title="${esc(tooltipSkill(id))}">
    <div class="nm">${name}${sub}</div>
    <div class="val muted">${inv}${doubled ? '×2' : ''}</div>
    <div class="val gear">${_gearCell(gear)}</div>
    <div class="val total">${eff}</div>
    ${_stepperHtml('combat', id, inv, combatInvCap(p.lw, id), p.combatTotal - p.combatSpent, '', '·')}
  </div>`;
}
function renderCombat() {
  // Заметки над строками секции (идеома «Волка-одиночки»): каждая объясняет то, что видно в
  // этих строках. LW и ASU легально совместимы — активные заметки идут списком, при пустом
  // списке строго '' (страж interactions и :empty-правило в css).
  const p = pools();
  const notes = [];
  if (p.lw) notes.push(esc(t('combat.lw_note')));
  if (p.asu) notes.push(asuNote('combat.asu_note'));
  $('#combatNote').innerHTML = notes.length ? notes.map(n => `<div>${n}</div>`).join('') : '';
  let html = '';
  for (const s of CH.combatAbilities.schools) {
    const sub = s.attribute ? ` <small>· ${attrNameRu(s.attribute).toLowerCase()}</small>` : '';
    html += skillRow(s.id, L(s), sub);
  }
  for (const s of CH.combatAbilities.weapon) html += skillRow(s.id, L(s), '');
  for (const s of CH.combatAbilities.defence) html += skillRow(s.id, L(s), '');
  $('#combatRows').innerHTML = html;
}
function renderCivil() {
  const f = computeFinal(), p = pools();
  // Заметка ASU — та же идиома, что attrNote/combatNote: объясняет +1 очко над строками,
  // где оно тратится; пустая скрыта :empty.
  $('#civilNote').innerHTML = p.asu ? `<div>${asuNote('civil.asu_note')}</div>` : '';
  let html = '';
  for (const s of CH.civilAbilities.list) {
    const inv = state.civil[s.id] || 0, gear = f.gear.skill[s.id] || 0, eff = f.civil[s.id];
    // Механики — серый <small> справа от названия (тот же идиом, что подстрока атрибута у боевых
    // умений); в тултипе их нет. Пусто при 0 уровне или отсутствии mech.
    const mech = civilMechLine(s, state.lang === 'ru');
    html += `<div class="srow" title="${esc(tooltipSkill(s.id))}">
      <div class="nm">${L(s)}${mech ? ` <small>· ${esc(mech)}</small>` : ''}</div>
      <div class="val muted">${inv}</div>
      <div class="val gear">${_gearCell(gear)}</div>
      <div class="val total">${eff}</div>
      ${_stepperHtml('civil', s.id, inv, LS_.civil.capEach, p.civilTotal - p.civilSpent, '', '·')}
    </div>`;
  }
  $('#civilRows').innerHTML = html;
}
// Секция «Навыки»: полоса бюджета памяти, чипы выбранных (по школам) и группа автовыданных.
// Крестик на чипе — тот же toggleSkill, что и клик по строке базы: автовыдаваемые он
// отсекает, поэтому снять их кликом нельзя.
// Иконка навыка — та же идиома, что у предмета (ячейка листа как фон, честная заглушка .ic-ph
// при отсутствии), но без рамки редкости: у навыков редкости нет. Позиция/размер фона —
// ПРОЦЕНТАМИ (классический sprite-приём для равномерной сетки): тогда размер показа задаёт
// CSS (.ic / .schip .ic / .d-icon.sk-icon), и мобильный слой или чип могут менять размер,
// не трогая разметку. Предметы остаются на пиксельной математике — их правки не касаются.
const _skillIconMarkup = (sk) => {
  // грантовые записи (src==='grant') рисуют клетку со своего листа (design 2026-11-09 §3.4)
  const SPR = sk.src === 'grant' && GRANT_SPRITE ? GRANT_SPRITE : SKILL_SPRITE;
  if (SPR && sk.icon) {
    const [c, r] = sk.icon;
    const [cw, ch] = SPR.cell;
    // fx/fy — во сколько раз лист больше ячейки
    const fx = SPR.w / cw, fy = SPR.h / ch;
    return `<i class="ic" role="img" aria-label="${esc(t('items.icon_alt', { name: skillName(sk) }))}" style="background-image:url('${SPR.png}');` +
      `background-size:${(fx * 100).toFixed(1)}% ${(fy * 100).toFixed(1)}%;` +
      `background-position:${((c / (fx - 1)) * 100).toFixed(4)}% ${((r / (fy - 1)) * 100).toFixed(4)}%"></i>`;
  }
  return `<i class="ic-ph" role="img" aria-label="${esc(t('items.icon_none'))}">?</i>`;
};
const _skillIconCell = (sk) => `<span class="i-icon" role="cell" title="${esc(sk.icon ? t('items.icon_alt', { name: skillName(sk) }) : t('items.icon_none'))}">${_skillIconMarkup(sk)}</span>`;
function _skillChip(sk) {
  // мини-иконка в чипе (решение пользователя после челенджа: судья хотел чипы без иконок,
  // но различимость навыка в секции побеждает); 18px — размер задаёт CSS, математика фона
  // процентная, поэтому в высоту чипа иконка вписывается
  // data-skill — карточка навыка по наведению (тот же skillCardHtml, что в панели);
  // подсказка «снять» — на крестике, чтобы нативный title не налезал на карточку
  return `<button class="schip" type="button" data-rm="${esc(sk.stat)}" data-skill="${esc(sk.stat)}">` +
    `${_skillIconMarkup(sk)}${esc(skillName(sk))}<span class="x" aria-hidden="true" title="${esc(t('skills.remove'))}">✕</span></button>`;
}
// Гранты экипировки для секции «Навыки» (design 2026-11-09-item-grants §4.1): сплошные
// гранты всех экипированных слотов, дедуп по stat, исключение уже в state.skills —
// выученный чип с ✕ показан выше, а 13 «grantedSkill в weapon-auto запись» (щиты/посохи,
// челендж r2 P1) выбивает именно это правило: syncAutoSkills кладёт тот же stat раньше.
function _itemGrantsForSection() {
  const seen = new Set(state.skills);
  const out = [];
  for (const [key] of EQUIP_SLOTS) {
    const it = itemById(state.equipment[key]);
    if (!it) continue;
    for (const g of _grantsOf(it)) {
      if (!g.sk || _grantDashed(g) || seen.has(g.sk.stat)) continue;
      seen.add(g.sk.stat);
      out.push(g.sk);
    }
  }
  return out;
}
function renderSkills() {
  const f = computeFinal();
  const p = memPool(f);
  const bar = $('#memBar');
  if (bar) {
    const pct = p.total > 0 ? Math.min(100, Math.round(p.spent / p.total * 100)) : 0;
    bar.innerHTML = `<div class="membar${p.left <= 0 ? ' full' : ''}" role="progressbar" ` +
      `aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.spent}" ` +
      `title="${esc(t('skills.mem_tip', { spent: p.spent, total: p.total }))}">` +
      `<span class="membar-fill" style="width:${pct}%"></span>` +
      `<span class="membar-txt">${p.spent} / ${p.total}</span></div>`;
  }
  const host = $('#skillRows');
  if (host) {
    const chosen = selectedSkills();
    const picked = chosen.filter(sk => !isAutoSkill(sk));
    const auto = chosen.filter(isAutoSkill);
    const itemG = _itemGrantsForSection();
    const bySchool = new Map();
    for (const sk of picked) { if (!bySchool.has(sk.school)) bySchool.set(sk.school, []); bySchool.get(sk.school).push(sk); }
    let html = '';
    for (const [id, list] of bySchool) {
      html += `<div class="schip-group"><div class="schip-school">${esc(schoolLabel(id))}</div>` +
        `<div class="chips">${list.map(_skillChip).join('')}</div></div>`;
    }
    // skills.none — только когда пусто и в школах, и в грантах (иначе «нет навыков»
    // противоречит видимым чипам группы предметов, design 2026-11-09-item-grants §4.1)
    if (!picked.length && !itemG.length) html += `<div class="muted small">${esc(t('skills.none'))}</div>`;
    if (itemG.length) {
      html += `<h3 class="sub">${esc(t('sk.item_group'))}</h3><div class="chips">` +
        itemG.map(sk => `<span class="schip gitem" data-skill="${esc(sk.stat)}" data-skill-ctx="grant" tabindex="0" title="${esc(t('sk.item_badge'))}">` +
          `${_skillIconMarkup(sk)}${esc(skillName(sk))}</span>`).join('') +
        '</div>';
    }
    if (auto.length) {
      html += `<h3 class="sub">${esc(t('sk.auto_group'))}</h3><div class="chips">` +
        auto.map(sk => `<span class="schip auto" data-skill="${esc(sk.stat)}" title="${esc(t('sk.auto_badge'))}">${_skillIconMarkup(sk)}${esc(skillName(sk))}</span>`).join('') +
        '</div>';
    }
    host.innerHTML = html;
  }
  // снятые pruneSkills() не должны исчезать молча (тот же приём, что у пула талантов)
  const note = $('#skillsPruned');
  if (note) {
    const names = _skillsPruned.map(st => (SKILL_BY_STAT[st] ? skillName(SKILL_BY_STAT[st]) : st));
    note.innerHTML = names.length ? `<div class="affix bad">⚠ ${esc(t('skills.pruned', { list: names.join(', ') }))}</div>` : '';
  }
}
// Sub-renderers for renderTalents(): selectable, quest-unique, and racial talents.
// Приписка «выдан предметом» у грант-таланта (spec 2026-11-10-talent-grant-inline §4.2):
// pill рядом с именем; грант — производный от экипировки, очко не тратит, поэтому галку
// НЕ ставим (семантика галки — «очки героя потрачены»). Вызывается и из _talentRacial,
// где цикл `for (const t of ...)` затеняет t() — текст резолвится внутри хелпера.
function _tbadge(name) {
  return _itemTalentGrants().includes(name) ? `<span class="tbadge">${esc(t('talent.item_badge'))}</span>` : '';
}
function _talentSelectable(p) {
  let html = '';
  for (const tl of CH.talents.selectable) {
    const selected = state.talents.includes(tl.name);
    const grant = _itemTalentGrants().includes(tl.name);
    const okPrereq = talentPrereqMet(tl);
    const conflict = tl.conflicts && tl.conflicts.some(c => state.talents.includes(c));
    const overPicks = !selected && state.talents.length >= p.talentPicks;
    const blocked = !okPrereq || conflict || overPicks;
    let why = '';
    if (!okPrereq && tl.prerequisite) why = t('talent.need', { p: esc(prereqText(tl)) });
    else if (conflict) why = t('talent.conflict');
    else if (overPicks) why = t('talent.no_slots');
    // grant_hint — только на неотмеченной героем строке: на отмеченной «очко не тратится» лжёт
    // (очко как раз потрачено). На грант-строке label без class disabled даже при blocked:
    // затемнение opacity гасило бы яркий pill (spec §4.4.4); input и why — по прежнему расчёту.
    const tip = tooltipTalent(tl.name) + (grant && !selected ? ` · ${t('talent.grant_hint')}` : '');
    html += `<label class="trow ${blocked && !grant ? 'disabled' : ''}" title="${esc(tip)}">
      <input type="checkbox" data-talent="${esc(tl.name)}" ${selected ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
      <div><span class="tnm">${esc(L(tl))}</span>${_tbadge(tl.name)}${why ? `<span class="why">${why}</span>` : ''}
      <div class="teff">${esc(TT(tl, 'effect'))}</div></div></label>`;
  }
  return html;
}
function _talentQuest() {
  let qh = '';
  for (const tl of CH.talents.questUnique) {
    const sel = state.questTalents.includes(tl.name);
    const allowed = questTalentAllowed(tl);
    const why = allowed ? '' : t('talent.only_origin', { o: esc(originNameRu(tl.origin)) });
    qh += `<label class="trow ${allowed ? '' : 'disabled'}" title="${esc(tooltipTalent(tl.name))}"><input type="checkbox" data-quest="${esc(tl.name)}" ${sel ? 'checked' : ''} ${allowed ? '' : 'disabled'}>
      <div><span class="tnm">${esc(L(tl))}</span>${_tbadge(tl.name)}${why ? `<span class="why">${why}</span>` : ''}<div class="teff">${esc(TT(tl, 'effect'))} · ${esc(TT(tl, 'source'))}</div></div></label>`;
    if (tl.name === "Spider's Kiss" && tl.visions) {
      const opts = tl.visions.map(v => `<option value="${v.id}" ${state.spiderKissVision === v.id ? 'selected' : ''}>${esc(state.lang === 'ru' ? (v.labelRu || v.label) : v.label)}</option>`).join('');
      qh += `<div class="skk-vision"><span class="muted small">${t('talent.vision_label')}</span>
        <select id="spiderKissVision" ${sel ? '' : 'disabled'} title="${t('talent.vision_title')}">${opts}</select></div>`;
    }
  }
  return qh;
}
function _talentRacial() {
  const r = CH.races.find(x => x.id === state.race);
  let rh = '';
  if (r) for (const t of r.talents) rh += `<div class="trow" style="cursor:default" title="${esc(tooltipTalent(t.name))}">
    <div><span class="tnm">${esc(L(t))}</span>${_tbadge(t.name)}<div class="teff">${esc(TT(t, 'effect'))}</div></div></div>`;
  return rh || '<span class="muted small">—</span>';
}
// Грант-строки убраны (spec 2026-11-10-talent-grant-inline §4.1): группа «Таланты от
// предметов» дублировала талант — указатель «выдан предметом» живёт у имени в основном
// списке (_tbadge в _talentSelectable/_talentQuest/_talentRacial).
function renderTalents() {
  const p = pools();
  $('#talentRows').innerHTML = _talentSelectable(p);
  $('#questTalentRows').innerHTML = _talentQuest();
  $('#racialTalentRows').innerHTML = _talentRacial();
}
function renderEquip() {
  hideHoverCard(); // re-rendered rows invalidate any open hover preview
  let html = '';
  for (const [key, labelKey] of EQUIP_SLOTS) {
    const id = state.equipment[key];
    const it = id ? itemById(id) : null;
    // Уровень — общий расчёт с карточкой (_effLevel); при неизвестном уровне фрагмент
    // omission целиком, без голого «ур.» (design 2026-11-09-equipped-level, NN/g list entry).
    const lvl = it ? _effLevel(it) : null;
    const lvlFrag = lvl != null
      ? ` <small class="muted">${t('items.level', { n: lvl })}${it.levelScale ? ` <span role="img" aria-label="${esc(t('items.scale.badge'))}" title="${esc(t('items.scale.badge'))}">⚡</span>` : ''}</small>`
      : '';
    html += `<div class="erow">
      <span class="slot">${t(labelKey)}</span>
      <span class="ewear">
        ${it ? `<span class="item r-${it.rarity}" data-open="${esc(it.id)}">${esc(itemName(it))}${lvlFrag}</span><button class="xbtn" data-uneq="${key}" type="button" title="${t('equipment.unequip_title')}">✕</button>` : '<span class="muted" style="opacity:.35">—</span>'}
      </span>
      <button class="spick" data-pick="${key}" type="button" title="${t('equipment.pick_slot', { slot: t(labelKey) })}">⚔</button>
    </div>`;
  }
  $('#equipRows').innerHTML = html;
  // Сумки в секции больше нет: в базе нет предметов без слота (slot === 'none'),
  // класть нечего. state.bag живёт только ради импорта старых сохранений.
}
// Sub-renderers for renderDerived(): derived stats, each placed in the section it derives from.
const _fl = (l, v, approx) => approx
  ? `<div class="fline"><span class="fl" title="${t('final.approx_title')}">${l}</span><span class="fv"><b>${v}</b></span></div>`
  : `<div class="fline"><span class="fl">${l}</span><span class="fv"><b>${v}</b></span></div>`;
// Attribute-derived: HP/armors from Constitution, initiative from Wits, carry from Str, memory slots from Memory.
function _finalVitality(f) {
  return `<div class="fblock"><div class="bt">${t('final.vitality_block')}</div>`
    + _fl(t('final.hp'), f.hp) + _fl(t('final.p_armor'), f.pA) + _fl(t('final.m_armor'), f.mA) + '</div>';
}
function _finalMobility(f) {
  return `<div class="fblock"><div class="bt">${t('final.mobility_block')}</div>`
    + _fl(t('final.initiative'), f.init) + _fl(t('final.move'), f.move)
    + _fl(t('final.ap'), f.ap) + _fl(t('final.mem'), f.mem)
    + _fl(t('final.carry'), f.carry) + '</div>';
}
// Combat-derived: crit/dodge/accuracy from wits, combat skills and talents; damage previews from schools and weapon skills.
function _finalCombatStats(f) {
  return `<div class="fblock"><div class="bt">${t('final.combat_stats_block')}</div>`
    + _fl(t('final.crit_chance'), f.crit + '%', true) + _fl(t('final.dodge'), f.dodge + '%', true)
    + _fl(t('final.crit_mult'), f.critMult + '%')
    + _fl(t('final.accuracy'), f.accuracy + '%') + '</div>';
}
// Resistances and elemental damage bonuses are gear/race-derived, but they read as
// character stats — so they close the Attributes block (bottom of #attrDerived).
function _finalResist(f) {
  let h = `<div class="fblock"><div class="bt">${t('final.resist_block')}</div><div class="reschips">`;
  for (const k of RES_KEYS) {
    const v = f.res[k] || 0;
    h += `<span class="chip ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${t('label.element.' + k)} ${v > 0 ? '+' : ''}${v}%</span>`;
  }
  h += '</div></div>';
  const dmgChips = RES_KEYS.map(k => (f.dmg[k] || 0) ? `<span class="chip pos">+${f.dmg[k]}% ${t('label.element.' + k)}</span>` : '').join('');
  if (dmgChips) h += `<div class="fblock"><div class="bt">${t('final.dmg_bonus_block')}</div><div class="reschips">${dmgChips}</div></div>`;
  return h;
}
function _finalDamage(f) {
  const dmgPreview = typeof calcWeaponDamage === 'function' ? calcWeaponDamage(state, f) : null;
  const est = dmgPreview && Number.isFinite(dmgPreview.estimatedDmg) ? Math.round(dmgPreview.estimatedDmg) : null;
  const dmgTip = t('final.dmg_tip');
  if (est != null) {
    return `<div class="fblock"><div class="bt" title="${dmgTip}">${t('final.dmg_title')}</div>`
      + `<div style="font-size:22px;color:var(--gold);font-weight:600;margin:4px 0">${est}</div>`
      + `<div class="muted small">${t('final.dmg_base', { base: Math.round(dmgPreview.baseDmg), el: dmgPreview.elementMult, as: dmgPreview.attrSkillMult })}</div></div>`;
  }
  return `<div class="fblock"><div class="bt" title="${dmgTip}">${t('final.dmg_title')}</div><div class="muted small">${t('final.dmg_no_data')}</div></div>`;
}
function _finalSpells(f) {
  if (typeof calcSpellDamage !== 'function') return '';
  const SCHOOLS = ['pyrokinetic', 'hydrosophist', 'aerotheurge', 'geomancer', 'necromancer'];
  const rows = SCHOOLS.filter(id => (state.combat[id] || 0) > 0).map(id => {
    const sp = calcSpellDamage(state, f, id);
    return sp ? `<div class="muted small" style="margin:2px 0">${L(SKILL_BY_ID[id])}: <b style="color:var(--gold)">${sp.estimatedDmg}</b> <span class="muted">(×${sp.mult})</span></div>` : '';
  }).filter(Boolean);
  return rows.length ? `<div class="fblock"><div class="bt" title="${t('final.spell_tip')}">${t('final.spell_title')}</div>${rows.join('')}</div>` : '';
}
// Granted skills are no longer summarised here: the Skills section lists every skill the
// gear grants, so a counter in the equipment block was a duplicate.
function renderDerived() {
  const f = computeFinal();
  $('#attrDerived').innerHTML = _finalVitality(f) + _finalMobility(f) + _finalResist(f);
  $('#combatDerived').innerHTML = _finalCombatStats(f) + _finalDamage(f) + _finalSpells(f);
}
