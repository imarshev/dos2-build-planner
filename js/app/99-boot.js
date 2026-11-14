// Part 99-boot.js of the planner app (split of the former single app.js; loaded in
// script order by index.html — see app/qa/app_split.js for the name-uniqueness guard).
'use strict';

function init() {
  restoreGen();
  pruneState();
  initLayout();
  renderOriginRace();
  initFilters();
  $('#langSel').value = state.lang;
  initCharacterControls();
  initSlots();
  initStepperEvents();
  initTalentEvents();
  initDBEvents();
  initSkillDbEvents();
  initDrawerEvents();
  initPlanEvents();
  initDragDismiss();
  initSheetLayer();
  initForge();
  initHoverPreview();
  $('#gBtn').addEventListener('click', rollItem);
  afterChange();
}

// Кузница: свёрнута по умолчанию только на телефоне (<=740px, тот же критерий, что у
// мобильного слоя вёрстки). На десктопе развёрнута всегда — скрытие только для мобильных
// (требование пользователя 2026-11-04). Нет matchMedia (QA-shim) => desktop => открыта.
function initForge() {
  const d = document.querySelector('details.rollgen');
  if (!d) return;
  if (!window.matchMedia) { d.open = true; return; }
  const mobile = window.matchMedia('(max-width: 740px)');
  const sync = () => { if (!mobile.matches) d.open = true; };
  sync();
  if (mobile.addEventListener) mobile.addEventListener('change', sync);
  else if (mobile.addListener) mobile.addListener(sync);
}

/* ---------------- i18n bootstrap (i18next + js-yaml, runtime) ----------------
   Loads app/i18n/{ru,en}.yaml at runtime, inits i18next, then runs init().
   Degraded mode: if the i18n libs / fetch are unavailable (e.g. a QA sandbox that
   only loads data.js + app.js), skip i18n and run init() synchronously. In that
   mode t() returns the key, which is fine because the main render strings are not
   yet routed through t() (that happens in a later task). */
const _i18next = (typeof window !== 'undefined' && window.i18next) || globalThis.i18next;
const _jsyaml = (typeof window !== 'undefined' && window.jsyaml) || globalThis.jsyaml;
const _fetch = (typeof window !== 'undefined' && window.fetch) || globalThis.fetch;
let I18N_READY = false;
const isI18nReady = () => I18N_READY;
const t = (key, params) => (I18N_READY && _i18next) ? _i18next.t(key, params) : key;
// Language-aware prerequisite display text (prerequisite is EN, prerequisiteRu is RU).
const prereqText = (tl) => state.lang === 'ru' ? (tl.prerequisiteRu || tl.prerequisite) : tl.prerequisite;
// Language-aware name: RU → nameRu (official pak) || name; EN → name.
const L = (o) => (o && state.lang === 'ru') ? (o.nameRu || o.name) : (o ? o.name : '');
// Language-aware text twin: RU → xxxRu || xxx; EN → xxx.
const TT = (o, k) => (o && state.lang === 'ru') ? (o[k + 'Ru'] || o[k]) : (o ? o[k] : '');
function setLang(lang) {
  state.lang = lang;
  save();
  if (document.documentElement) document.documentElement.lang = lang;
  const p = (_i18next && I18N_READY) ? _i18next.changeLanguage(lang) : Promise.resolve();
  return p.then(() => {
    // O8 (default hero name re-localize) is moot: the #charName field was removed 2026-11-07,
    // slot auto-names re-localize on every render (see 2026-11-07-remove-char-name-design §3.2).
    afterChange();
  });
}
// Fill static [data-i18n] / [data-i18n-attr] elements. No-op until i18n is ready
// (degraded QA sandboxes keep their hardcoded RU strings intact).
function applyI18n() {
  if (!I18N_READY || !document.querySelectorAll) return;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    const i = spec.indexOf(':');
    if (i > 0) el.setAttribute(spec.slice(0, i), t(spec.slice(i + 1)));
  });
}
if (_i18next && _jsyaml && (_fetch || (typeof window !== 'undefined' && window.I18N_RAW))) {
  window.__APP_READY__ = (async () => {
    try {
      // The embedded YAML (js/i18n_data.js) wins: under file:// the fetch of i18n/*.yaml is
      // CORS-blocked ("origin 'null'"), which used to leave the whole UI with raw keys.
      let ruTxt, enTxt;
      if (typeof window !== 'undefined' && window.I18N_RAW && window.I18N_RAW.ru) {
        ruTxt = window.I18N_RAW.ru; enTxt = window.I18N_RAW.en;
      } else {
        [ruTxt, enTxt] = await Promise.all([
          _fetch('i18n/ru.yaml').then(r => r.text()),
          _fetch('i18n/en.yaml').then(r => r.text())
        ]);
      }
      await _i18next.init({
        resources: { ru: { translation: _jsyaml.load(ruTxt) }, en: { translation: _jsyaml.load(enTxt) } },
        lng: state.lang, fallbackLng: 'ru',
        interpolation: { escapeValue: false, prefix: '{', suffix: '}' }, returnNull: false
      });
      I18N_READY = true;
      if (document.documentElement) document.documentElement.lang = state.lang;
    } catch (e) { console.error('i18n init failed', e); }
    try { const ld = document.querySelector('#loading'); if (ld && ld.style) ld.style.display = 'none'; } catch (e) {}
    init();
  })();
} else {
  init();
  window.__APP_READY__ = Promise.resolve();
}

