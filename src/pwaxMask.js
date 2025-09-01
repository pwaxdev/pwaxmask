/*
 * pwaxMask — Internationalized numeric input mask & formatter
 * Version: 1.2.1 (First public release: September 01, 2025)
 * Author: PWAxdev - info@pwax.dev
 * License: MIT
 *
 * Copyright (c) 2025 PWAxdev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
*/
(() => {
  const VERSION = '1.2.1';
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    const noop = {
      init:()=>noop, getValue:()=>null, setValue:()=>{}, use:()=>{}, utils:{},
      ver: () => VERSION,               
      version: VERSION                   
    };
    if (typeof module!=='undefined' && module.exports) { module.exports = noop; }
    return;
  }

  // INTERNALS
  const EL_OPTS     = new WeakMap();  //Effective options per element (DEFAULTS + preset + data-attributes + runtime overrides)
  const LAST_OK     = new WeakMap();  //Last valid rendered string (the one visible in the DOM) for non-destructive live revert
  const LAST_ACCEPT = new WeakMap();  //Last accepted numeric value (post-beforeChange)
  const LAST_RAW    = new WeakMap();  //Last raw value (pre-round/step/clamp)
  const RAW_CTX     = new WeakMap();  //{digits:number} active only while the field is focused in RAW
  const COMPOSE     = new WeakMap();  //IME/composition flag in progress (true during compositionstart -> compositionend)
  const HANDLERS    = new WeakMap();  //Collection of event listener references per element (focus, input, blur, keydown, …)
  const SELECTED1   = new WeakMap();  //"first selection" flag for selectOnFocusOnce (true after the first focus with selection)
  const HISTORY     = new WeakMap();  //History {stack:[{out,n,caret,ts}], idx, limit}
  const LOCKED      = new WeakSet();  //Currently locked elements
  const PENDING_NEG = new WeakSet();  //User pressed '-' on zero with showZeroSign=false
  let   OBSERVER    = null;           //Auto-attach new nodes and react to relevant attribute changes
  let   OBSERVER_CB_SCHEDULED = false;//Microtask debounce for MutationObserver
  const OBSERVER_QUEUE = new Set();   //Batch of observed nodes to process
  const ATTACHED = new Set();         //Explicit tracking of attached elements

  // GLOBAL DEFAULTS
  const DEFAULTS = {
    showZeroSign: false,              //If true, allow displaying the sign on 0 (e.g., "-0"); default: no sign on zero
    decimal: ',',                     //Decimal separator (e.g., ',' in it-IT, '.' in en-US)
    group: '.',                       //Grouping/thousands separator (e.g., '.' in it-IT, ',' in en-US)
    digits: 0,                        //Number of decimal digits displayed and rounded
    allowExponent: false,             //If true, parsing accepts "1e-6", "3.2E+4", etc. (parse/paste/blur only)
    emptyValue: 'zero',               //Value returned by getValue() when the field is empty: 'zero' -> 0 | 'null' -> null | 'empty' -> '' (empty string)
    roundMode: 'half-up',             //Rounding mode:
                                      //- 'half-up'     -> classic commercial rounding: 0.5 rounds up (Math.round)
                                      //- 'half-down'   -> 0.5 goes toward zero; other values to the nearest
                                      //- 'half-even'   -> tie-to-even (bankers’ rounding): 0.5 to the nearest even number
                                      //- 'half-away'   -> 0.5 always away from zero (e.g., 1.5->2, -1.5->-2)
                                      //- 'ceil'        -> always rounds toward +∞
                                      //- 'floor'       -> always rounds toward -∞
                                      //- 'trunc'       -> truncates the fractional part (equivalent to toward-zero)
                                      //- 'toward-zero' -> alias of 'trunc'
                                      //- 'bankers'     -> alias of 'half-even'
    prefix: '',                       //Text before the number (e.g., '€ ')
    suffix: '',                       //Text after the number (e.g., ' %')
    signPosition: 'afterPrefix',      //Sign position: 'beforePrefix' | 'afterPrefix' (default compat: after the prefix)
    allowNegative: false,             //Enable negatives; otherwise '-' is ignored
    negativeStyle: 'sign',            //Negative style: 'sign' (default) | 'parens' -> negatives like (1,234.56)
    minusBehavior: 'forceNegative',   //Minus key behavior: 'forceNegative' (always negative) | 'toggle' (invert the sign)
    acceptBothDecimal: false,         //If true, allow '.' or ',' as the decimal separator when unambiguous (conservative)
    parsePercent: 'symbolOnly',       //'off' | 'auto' -> handling of '%' in paste/parse | 'symbolOnly' -> scale only with an explicit symbol; ignore unitFactor
    beforeChange: null,               //(nextNumber, {el, prev}) => true | {ok:false}
    // Grouping
    groupStyle: 'standard',           //'standard' = 1.234.567 ; 'indian' = 12,34,567
    groupWhileTyping: true,           //If false, insert separators only on blur (more stable while typing)
    groupPattern: null,               //Custom pattern (array) e.g., [3,2,2]; if present, it takes priority over groupStyle
    // UX
    clampMode: 'always',              //Where to clamp: 'always' | 'blur' (if 'blur', no clamping during live key/wheel/input)
    clampOnPaste: true,               //If true, apply clamping on paste as well (by default keep the current behavior)
    selectOnFocus: false,             //Select all on every focus
    selectOnFocusOnce: false,         //Select all only on first focus
    selectDecimalsOnly: false,        //On focus select only the decimal part (if present)
    enforceMaxWhileTyping: true,      //While typing, block attempts above `max`
    liveMinStrategy: 'none',          //'none' | 'lenient' (event only) | 'strict' (block)
    keepEmpty: false,                 //Allow empty string without forcing 0
    blankIfZero: false,               //Visually empty if the value is 0
    snapToStepOnBlur: false,          //On blur snap to `step` (base = min)
    formatEmptyOnInit: true,          //If empty on attach, format 0/min on screen (except when blank/keepEmpty)
    observe: false,                   //Enable MutationObserver for auto-attach
    // Keyboard / Mouse
    preserveCaret: 'auto',            //Preserve the logical caret ('auto' disables on coarse pointers)
    allowWheel: false,                //Mouse wheel increments (focus required)
    holdAccel: false,                 //Acceleration with arrow keys held down (×2/×5/×10)
    copyRaw: false,                   //Ctrl/Cmd+C copies the raw value (without formatting)
    rawOnFocus: false,                //If true, on focus show the raw number without prefix/suffix/grouping
    rawDigits: null,                  //null -> auto (max(digits, stepDecimals, 4)) | fixed number
    enforceBeforeChangeWhileTyping: false,
                                      //Apply `beforeChange` while typing as well
    ariaInvalidPersist: false,        //If true, do not remove aria-invalid automatically
    ariaInvalidMs: 120,               //Visual feedback duration when persist=false
    ariaTextFormatted: true,          //If false, do not set aria-valuetext (only aria-valuenow)
    negativeInputmode: 'auto',        //Mobile keyboards with negatives+decimals: 'auto' | 'text' | 'decimal'
    forceTextForNegative: false,      //If true, force inputmode='text' when allowNegative && digits>0
    detectLocale: false,              //Auto-detect locale separators via Intl.NumberFormat
    mathEngine: 'number',             //'number' (JS) | 'big' (Big.js if present on window.Big)
    schema: null,                     //Declarative constraints {multipleOf, allowedRange, disallow, customMessage}
    unit: null,                       //'percent'|'permille'|'bp'|null (semantic only)
    unitDisplay: 'suffix',            //'suffix'|'prefix' (UI only; not required if you already use a prefix/suffix string)
    unitFactor: 1,                    //1 (default), 0.01 (percent), 0.001 (permille), 0.0001 (basis points)
    validationMode: 'block',          //'block' | 'soft' (soft: does not restore the value; visual signal only)
    invalidClass: 'is-invalid',       //CSS class used for invalidity (also soft)
    liveDebounceMs: 0,                //Debounce for 'pwaxmask:live' event (ms)
    unformatOnFocus: false,           //On focus show number without group/prefix/suffix; reformat on blur
    history: true,                    //Enable undo/redo
    historyLimit: 50,                 //History limit
    lockIcon: false,                  //Show an inline padlock when lock()
    lockDim: true,                    //If true, apply opacity during lock()
    lockDimOpacity: 0.5,              //Opacity value when lockDim=true
    negativeParens: '(,)',            //Parentheses pair for 'parens' style e.g., '〈,〉', '«,»'
    negativeSignSymbol: '-',          //Visual symbol for the negative sign in 'sign' style (e.g., '⊖')
    showPositiveSign: false,          //If true, show the positive sign for n>0
    positiveSignSymbol: '+',          //Visual symbol for the positive sign
    note: null,                       //Field help/description text (shown via event)
    errorMessage: null,               //Preferred error message when the value is blocked
  };

  //Quick presets
  const PRESETS = {
    eur: { prefix: '€ ', digits: 2, decimal: ',', group: '.', groupStyle: 'standard' },
    per: { suffix: '%', digits: 0, min: 0, max: 100 },
    dec: { digits: 2 },
    num: { digits: 0 },
    usd: { prefix: '$ ', digits: 2, decimal: '.', group: ',', groupStyle: 'standard' },
    inr: { prefix: '₹ ', digits: 2, decimal: '.', group: ',', groupStyle: 'indian' },
    jpy: { prefix: '¥ ', digits: 0, decimal: '.', group: ',', groupStyle: 'standard' },
    gbp: { prefix: '£ ', digits: 2, decimal: '.', group: ',', groupStyle: 'standard' },
    chf: { prefix: 'CHF ', digits: 2, decimal: '.', group: "'", groupStyle: 'standard' },
  };
  const CLASS_PRESETS = {
    '.eur': 'eur', '.per': 'per', '.dec': 'dec', '.num': 'num',
    '.usd': 'usd', '.inr': 'inr', '.jpy': 'jpy', '.gbp': 'gbp', '.chf': 'chf',
  };
  
  //UTILS
  //isFiniteNum: returns true if n is a finite Number (not NaN/±Infinity).
  const isFiniteNum  = n => typeof n === 'number' && Number.isFinite(n);
  
  //escapeRegExp: safely escapes regex metacharacters in a string.
  const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  function inferLocaleFromIntl(el) {
    //Autodetect local
    try {
      const lang = el?.lang || document.documentElement.lang || navigator.language || 'en-US';
      const nf = new Intl.NumberFormat(lang);
      const parts = nf.formatToParts(1234567.89);
      const group = parts.find(p=>p.type==='group')?.value || ',';
      const decimal = parts.find(p=>p.type==='decimal')?.value || '.';
      return { lang, group, decimal };
    } catch { return { lang: 'en-US', group: ',', decimal: '.' }; }
  }

  function roundAdvWithEngine(n, digits, mode, o) {
    //Math engine adapter
    const BigImpl = o?.Big || (typeof window!=='undefined' && window.Big);
    if (!(o?.mathEngine === 'big' && BigImpl) || !isFiniteNum(n)) {
      return roundAdvanced(n, digits, mode);
    }
    const Big = BigImpl;
    const d = Math.max(0, digits|0);
    const m = (mode||'half-up').toLowerCase();
    //Native modes of Big: 0 = toward zero, 1 = half-up, 2 = half-even, 3 = away from zero
    const withRM = (rm) => Number(new Big(n).round(d, rm).toString());
    try {
      if (m === 'half-even' || m === 'bankers')   return withRM(2);
      if (m === 'half-up')                        return withRM(1);
      if (m === 'half-away') {
        const f = new Big(10).pow(d);
        const y = new Big(n).times(f);               
        const i0 = y.round(0, 0);                    
        const frac = y.minus(i0).abs();              
        if (frac.eq(0.5)) {                       
          const away = y.gte(0) ? i0.plus(1) : i0.minus(1);
          return Number(away.div(f).toString());
        }
        //non-tie -> nearest half-up is fine
        return Number(y.round(0, 1).div(f).toString());
      }
      if (m === 'trunc' || m === 'toward-zero')   return withRM(0);
      if (m === 'ceil') {
        //+∞ : for n>=0 -> away (3); for n<0 -> toward zero (0)
        return withRM(n >= 0 ? 3 : 0);
      }
      if (m === 'floor') {
        //-∞ : for n>=0 -> toward zero (0); for n<0 -> away (3)
        return withRM(n >= 0 ? 0 : 3);
      }
      //'half-down' is not supported by Big -> fallback to precise numeric
      if (m === 'half-down') return roundAdvanced(n, d, m);
      //Default
      return withRM(1);
    } catch {
      return roundAdvanced(n, d, m);
    }
  }

  function clampWithEngine(n, min, max, o) {
    //Clamp Big.js
    const BigImpl = o?.Big || (typeof window !== 'undefined' && window.Big);
    if (!(o?.mathEngine === 'big' && BigImpl)) return clamp(n, min, max);
    const Big = BigImpl;
    try {
      let b = new Big(n);
      if (isFiniteNum(min) && b.lt(min)) b = new Big(min);
      if (isFiniteNum(max) && b.gt(max)) b = new Big(max);
      return Number(b.toString());
    } catch { return clamp(n, min, max); }
  }

  function roundToStepWithEngine(n, step, min, roundMode, o) {
    //Round Big.js
    const BigImpl = o?.Big || (typeof window !== 'undefined' && window.Big);
    if (!(o?.mathEngine === 'big' && BigImpl)) return roundToStep(n, step, min, roundMode);
    const Big = BigImpl;
    try {
      const base = isFiniteNum(min) ? new Big(min) : new Big(0);
      const k = new Big(n).minus(base).div(step);
      const m = (roundMode || 'half-up').toLowerCase();
      if (m === 'half-down') return roundToStep(n, step, min, roundMode);
      if (m === 'half-away') {
        const i0 = k.round(0, 0);
        const frac = k.minus(i0).abs();
        const r = frac.eq(0.5) ? (k.gte(0) ? i0.plus(1) : i0.minus(1)) : k.round(0, 1);
        return Number(r.times(step).plus(base).toString());
      }
      let rm = 1;
      if (m === 'half-even' || m === 'bankers') rm = 2;
      else if (m === 'trunc' || m === 'toward-zero') rm = 0;
      else if (m === 'ceil')  rm = k.gte(0) ? 3 : 0;
      else if (m === 'floor') rm = k.gte(0) ? 0 : 3;
      const r = k.round(0, rm);
      return Number(r.times(step).plus(base).toString());
    } catch { return roundToStep(n, step, min, roundMode); }
  }

  function ensureSpinRole(el, o) {
    //ARIA helper (do not force the role on native number inputs)
    try {
      const isNativeNumber = !isCE(el) && el.tagName === 'INPUT' && el.type === 'number';
      if (!isNativeNumber) {
        el.setAttribute('role', 'spinbutton');
      } else {
        el.removeAttribute('role');
      }
      if (isFiniteNum(o.min)) el.setAttribute('aria-valuemin', String(o.min));
      else el.removeAttribute('aria-valuemin');
      if (isFiniteNum(o.max)) el.setAttribute('aria-valuemax', String(o.max));
      else el.removeAttribute('aria-valuemax');
    } catch {}
  }

  function updateAria(el, o, n, out) {
    //ARIA helper
    try {
      if (o?.ariaTextFormatted !== false) el?.setAttribute('aria-valuetext', String(out ?? ''));
      else el?.removeAttribute('aria-valuetext');
      if (n == null || n === '' || !Number.isFinite(n)) el?.removeAttribute('aria-valuenow');
      else el?.setAttribute('aria-valuenow', String(n));
    } catch {}
  }

  function emitEvent(o, type, detail) {
    //Telemetry
    try { if (typeof o?.onEvent === 'function') o.onEvent({ type, detail }); } catch {}
  }

  function validateSchema(n, o) {
    //Schema validation (with Big.js support for multipleOf)
    const s = o?.schema; if (!s || !isFiniteNum(n)) return { ok:true };
    const msg = s.customMessage || 'Invalid by schema';
    if (Array.isArray(s.allowedRange)) {
      const [a,b] = s.allowedRange;
      if (isFiniteNum(a) && n < a) return { ok:false, reason: msg };
      if (isFiniteNum(b) && n > b) return { ok:false, reason: msg };
    }
    if (isFiniteNum(s.multipleOf) && s.multipleOf > 0) {
      const BigImpl = (o?.mathEngine === 'big') && (o?.Big || (typeof window!=='undefined' && window.Big));
      if (BigImpl) {
        try {
          const Big = BigImpl;
          const r = new Big(n).mod(s.multipleOf);
          if (!r.eq(0) && r.abs().gt('1e-12')) return { ok:false, reason: msg };
        } catch {
          //Numeric fallback
          const m = s.multipleOf, k = Math.round(n / m), near = k * m;
          if (Math.abs(n - near) > 1e-12) return { ok:false, reason: msg };
        }
      } else {
        const m = s.multipleOf, k = Math.round(n / m), near = k * m;
        if (Math.abs(n - near) > 1e-12) return { ok:false, reason: msg };
      }
    }
    if (typeof s.disallow === 'function' && s.disallow(n)) return { ok:false, reason: msg };
    return { ok:true };
  }

  const LIVE_T = new WeakMap();
  function emitLiveDebounced(el, o, value, formatted) {
    //Debouncing
    const ms = Number(o?.liveDebounceMs) || 0;
    if (ms <= 0) return emitLive(el, value, formatted);
    clearTimeout(LIVE_T.get(el));
    const t = setTimeout(() => emitLive(el, value, formatted), ms);
    LIVE_T.set(el, t);
  }

  const stepDecimals = step => {
    //Calculate how many decimal digits are needed to represent `step` (also in e- notation).
    if (!isFiniteNum(step)) return 0;
    const s = String(step);
    if (/e-/i.test(s)) return parseInt(s.toLowerCase().split('e-')[1], 10) || 0;
    const i = s.indexOf('.'); return i >= 0 ? s.length - i - 1 : 0;
  };
  
  //Interpret strings '1'/'0'/'true'/'false' as booleans (or undefined if not recognized).
  const asBool = v => (v === '1' || v === 'true' || v === true) ? true
               : (v === '0' || v === 'false') ? false : undefined;

  function normalizeDigits(str) {
    //Convert non-Latin digits (Arabic, Persian, Devanagari, etc.) into ASCII '0'..'9'.
    const map = {
      //Arabic
      '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
      //Persian
      '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
      //Devanagari
      '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
      //Bengali
      '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9',
      //Tamil
      '௦':'0','௧':'1','௨':'2','௩':'3','௪':'4','௫':'5','௬':'6','௭':'7','௮':'8','௯':'9',
      //Khmer
      '០':'0','១':'1','២':'2','៣':'3','៤':'4','៥':'5','៦':'6','៧':'7','៨':'8','៩':'9',
      //Thai
      '๐':'0','๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9',
      //Lao
      '໐':'0','໑':'1','໒':'2','໓':'3','໔':'4','໕':'5','໖':'6','໗':'7','໘':'8','໙':'9'
    };
    return String(str)
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u17E0-\u17E9\u0E50-\u0E59\u0ED0-\u0ED9]/g,
        ch => map[ch] || ch);
  }

  function roundToStep(n, step, min, roundMode = 'half-up') {
    //Round `n` to the `step`, optionally relative to a base (min if defined).
    if (!isFiniteNum(step) || step <= 0) return n;
    const base = isFiniteNum(min) ? min : 0;
    const k = (n - base) / step;
    const rk = roundAdvanced(k, 0, roundMode);
    return rk * step + base;
  }

  function almostEqual(a, b, eps = 1e-12) {
    //Rounding helper
    return Math.abs(a - b) <= eps;
  }

  function roundAdvanced(n, digits, mode = 'half-up') {
    //Rounding
    if (!isFiniteNum(n)) return n;
    const d = Math.max(0, digits | 0);
    const m = (mode || 'half-up').toLowerCase();
    if (d === 0) {
      const x = n;
      const s = Math.sign(x) || 1;
      const ax = Math.abs(x);
      const i  = Math.floor(ax);
      const frac = ax - i;
      const mm = (m === 'bankers') ? 'half-even'
                : (m === 'toward-zero') ? 'trunc'
                : m;
      switch (mm) {
        case 'ceil':       return Math.ceil(x);
        case 'floor':      return Math.floor(x);
        case 'trunc':      return x < 0 ? -Math.floor(ax) : Math.floor(ax);
        case 'half-down':
          if (almostEqual(frac, 0.5)) return s * i;      
          return s * Math.floor(ax + 0.5);
        case 'half-even': {
          if (almostEqual(frac, 0.5)) {
            //tie: to the nearest even
            const lower = i;
            const upper = i + 1;
            return s * ((lower % 2 === 0) ? lower : upper);
          }
          return s * Math.floor(ax + 0.5);
        }
        case 'half-away': {
          if (almostEqual(frac, 0.5)) return s * (i + 1); 
          return s * Math.floor(ax + 0.5);
        }
        case 'half-up':
        default:
          return Math.round(x);
      }
    }
    //d > 0: scale, round, return
    const f = Math.pow(10, d);
    //Epsilon to mitigate binary artifacts (e.g., 1.005)
    const y0 = n * f;
    const y  = y0 + (Math.sign(y0) || 1) * Number.EPSILON * 8;
    const mm = (m === 'bankers') ? 'half-even'
          : (m === 'toward-zero') ? 'trunc'
          : m;
    switch (mm) {
      case 'ceil':       return Math.ceil(y) / f;
      case 'floor':      return Math.floor(y) / f;
      case 'trunc':      return (y < 0 ? -Math.floor(Math.abs(y)) : Math.floor(y)) / f;
      case 'half-down': {
        const s = Math.sign(y) || 1;
        const ay = Math.abs(y);
        const i  = Math.floor(ay);
        const frac = ay - i;
        if (almostEqual(frac, 0.5)) return (s * i) / f;          
        return Math.round(y) / f;                                
      }
      case 'half-even': {
        const s = Math.sign(y) || 1;
        const ay = Math.abs(y);
        const i  = Math.floor(ay);
        const frac = ay - i;
        if (almostEqual(frac, 0.5)) {
          const lower = i;
          const upper = i + 1;
          return (s * ((lower % 2 === 0) ? lower : upper)) / f;   
        }
        return Math.round(y) / f;                                 
      }
      case 'half-away': {
        const s = Math.sign(y) || 1;
        const ay = Math.abs(y);
        const i  = Math.floor(ay);
        const frac = ay - i;
        if (almostEqual(frac, 0.5)) return (s * (i + 1)) / f;     
        return Math.round(y) / f;                                 
      }
      case 'half-up':
      default:
        return Math.round(y) / f;                                 
    }
  }

  function clamp(n, min, max) {
    //Clamp `n` between min and max (if numeric); return `n` if outside non-numeric domain.
    if (!isFiniteNum(n)) return n;
    if (isFiniteNum(min) && n < min) n = min;
    if (isFiniteNum(max) && n > max) n = max;
    return n;
  }

  function pickPreset(el, defaults) {
    //Determine the preset from the element’s dataset/class and merge it with the defaults.
    const ds = el.dataset;
    let preset = {};
    if (ds.preset && PRESETS[ds.preset]) {
      preset = { ...PRESETS[ds.preset] };
    } else {
      for (const sel in CLASS_PRESETS) {
        if (el.matches(sel)) {
          const key = CLASS_PRESETS[sel];
          if (PRESETS[key]) preset = { ...PRESETS[key] };
          break;
        }
      }
    }
    return { ...defaults, ...preset };
  }

  function parseGroupPattern(v) {
    //Transform a string/array pattern into a clean numeric array (e.g., "3,2,2" -> [3,2,2]).
    if (!v) return null;
    if (Array.isArray(v)) return v.map(x=>+x||0).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map(x=>+x||0).filter(Boolean);
    return null;
  }

  function readDataOpts(el, base) {
    //Read the element’s data-attributes and build the effective options object (resolving preset/step/digits).
    const o = { ...base };
    const ds = el.dataset;
    //Locale/format
    if (ds.decimal)  o.decimal = ds.decimal;
    if (ds.group)    o.group   = ds.group;
    if (ds.thousand) o.group   = ds.thousand;
    if (ds.roundMode) o.roundMode = ds.roundMode;
    if (ds.groupStyle) o.groupStyle = ds.groupStyle;
    if (ds.groupPattern) o.groupPattern = parseGroupPattern(ds.groupPattern);
    if (ds.prefix != null) o.prefix = ds.prefix;
    if (ds.suffix != null) o.suffix = ds.suffix;
    if (ds.signPosition) o.signPosition = ds.signPosition;
    if (ds.negativeStyle) o.negativeStyle = ds.negativeStyle;
    if (ds.negativeInputmode) o.negativeInputmode = ds.negativeInputmode;
    const ftn = asBool(ds.forceTextForNegative);
    if (ftn !== undefined) o.forceTextForNegative = ftn;
    if (ds.minusBehavior) o.minusBehavior = (ds.minusBehavior === 'toggle' ? 'toggle' : 'forceNegative');
    if (ds.digits != null && ds.digits !== '') o.digits = +ds.digits || 0;
    //Currency preset via data-currency (use existing presets if they match)
    if (ds.currency) {
      const key = String(ds.currency).toLowerCase();
      if (PRESETS[key]) {
        const p = PRESETS[key];
        //Only fill fields that haven’t been explicitly set
        o.prefix ??= p.prefix;
        o.suffix ??= p.suffix;
        o.digits = ('digits' in ds) ? o.digits : (p.digits ?? o.digits);
        o.decimal ??= p.decimal;
        o.group   ??= p.group;
        o.groupStyle ??= p.groupStyle;
      }
    }
    if (ds.unit) {
      const u = String(ds.unit).toLowerCase();
      o.unit = u;
      if (ds.unitFactor == null) {
        if (u === 'percent')  o.unitFactor = 0.01;
        else if (u === 'permille') o.unitFactor = 0.001;
        else if (u === 'bp')  o.unitFactor = 0.0001;
      }
      if (ds.prefix == null && ds.suffix == null) {
        if (u === 'percent') o.suffix = '%';
        else if (u === 'permille') o.suffix = '‰';
        else if (u === 'bp') o.suffix = ' bp';
      }
    }
    if (ds.unitFactor != null && ds.unitFactor !== '') {
      const f = Number(String(ds.unitFactor).replace(',', '.'));
      if (Number.isFinite(f) && f > 0) o.unitFactor = f;
    }
    if (ds.unitDisplay === 'prefix' || ds.unitDisplay === 'suffix') {
      o.unitDisplay = ds.unitDisplay;
    }
    //Limits
    const toNum = v => v == null || v === '' ? null : Number(String(v).replace(',', '.'));
    o.min  = toNum(ds.min ?? el.getAttribute('min'));
    o.max  = toNum(ds.max ?? el.getAttribute('max'));
    o.step = toNum(ds.step ?? el.getAttribute('step'));
    const gw  = asBool(ds.groupWhileTyping ?? ds.groupLive);
    if (gw !== undefined) o.groupWhileTyping = gw;
    const cr  = asBool(ds.copyRaw);
    if (cr !== undefined) o.copyRaw = cr;
    //Auto-allowNegative
    const an = asBool(ds.allowNegative);
    if (an !== undefined) {
      o.allowNegative = an;
    } else {
      if ((isFiniteNum(o.min) && o.min < 0) || (isFiniteNum(o.max) && o.max < 0)) {
        o.allowNegative = true;
      }
    }
    //Digits consistent with step
    if (isFiniteNum(o.step)) {
      const dStep = stepDecimals(o.step);
      if (dStep === 0) o.digits = 0; else o.digits = Math.max(o.digits, dStep);
    }
    //Percentage
    const isPercent = (o.suffix || '').trim().endsWith('%') || ds.preset === 'per' || el.matches('.per');
    if (isPercent) {
      if (!isFiniteNum(o.min)) o.min = 0;
      if (!isFiniteNum(o.max)) o.max = 100;
    }
    //Flags
    const so  = asBool(ds.selectOnFocus); if (so  !== undefined) o.selectOnFocus = so;
    const soo = asBool(ds.selectOnce);    if (soo !== undefined) o.selectOnFocusOnce = soo;
    const sdec = asBool(ds.selectDecimals); if (sdec !== undefined) o.selectDecimalsOnly = sdec;
    const lm  = asBool(ds.liveMax);       if (lm  !== undefined) o.enforceMaxWhileTyping = lm;
    //'none'|'lenient'|'strict'
    if (ds.liveMin) o.liveMinStrategy = ds.liveMin; 
    //emptyValue: 'zero' | 'null' | 'empty'
    const evRaw = ds.emptyValue || ds.empty; 
    if (evRaw) {
      const ev = String(evRaw).toLowerCase();
      if (ev === 'zero' || ev === 'null' || ev === 'empty') o.emptyValue = ev;
    }
    const ke = asBool(ds.keepEmpty);
    if (ke !== undefined) {
      o.keepEmpty = ke;
      if (!evRaw) o.emptyValue = ke ? 'null' : 'zero';
    }
    //UI-only: blankIfZero = show '' when n===0 (does not affect getValue if the field was cleared by the user)
    const bz = (asBool(ds.blankZero) ?? asBool(ds.emptyZero));
    if (bz !== undefined) o.blankIfZero = bz;
    const st  = asBool(ds.snapToStep);    if (st  !== undefined) o.snapToStepOnBlur = st;
    if (ds.caret === 'auto' || ds.caret === 'true' || ds.caret === 'false') {
      o.preserveCaret = (ds.caret === 'true') ? true : (ds.caret === 'false' ? false : 'auto');
    }
    const aw = asBool(ds.allowWheel); if (aw !== undefined) o.allowWheel = aw;
    const ha = asBool(ds.holdAccel);  if (ha !== undefined) o.holdAccel = ha;
    if (ds.parsePercent) o.parsePercent = ds.parsePercent;
    //Optional ARIA flag
    const atf = asBool(ds.ariaTextFormatted);
    if (atf !== undefined) o.ariaTextFormatted = atf;
    //Always normalize on clampMode
    if (ds.clampMode === 'always' || ds.clampMode === 'blur') {
      o.clampMode = ds.clampMode;
    }
    const cob = asBool(ds.clampOnBlur);
    if (cob !== undefined) {
      //clampOnBlur=true  -> clampMode:'blur' - clampOnBlur=false -> clampMode:'always'
      o.clampMode = cob ? 'blur' : 'always';
    }
    //Clamp on paste (override)
    const copPaste = asBool(ds.clampOnPaste);
    if (copPaste !== undefined) o.clampOnPaste = copPaste;
    const eb = (ds.enforceBefore ?? ds.beforeLive);
    const ebv = eb === '1' || eb === 'true' ? true : eb === '0' || eb === 'false' ? false : undefined;
    if (ebv !== undefined) o.enforceBeforeChangeWhileTyping = ebv;
    const abd = ds.acceptBothDecimal;
    const abv = abd === '1' || abd === 'true' ? true : abd === '0' || abd === 'false' ? false : undefined;
    if (abv !== undefined) o.acceptBothDecimal = abv;
    //Exponent (scientific notation)
    const ax = asBool(ds.allowExponent);
    if (ax !== undefined) o.allowExponent = ax;
    //RAW
    const rof = asBool(ds.rawOnFocus); if (rof !== undefined) o.rawOnFocus = rof;
    if (ds.rawDigits != null && ds.rawDigits !== '') {
      const rd = String(ds.rawDigits).toLowerCase().trim();
      o.rawDigits = rd === 'auto' ? null : (+rd || 0);
    }
    //Lock icon
    const li = asBool(ds.lockIcon); if (li !== undefined) o.lockIcon = li;
    //Lock dim (opacity)
    const ld = asBool(ds.lockDim); if (ld !== undefined) o.lockDim = ld;
    if (ds.lockOpacity != null && ds.lockOpacity !== '') {
      const op = Number(String(ds.lockOpacity).replace(',', '.'));
      if (Number.isFinite(op)) o.lockDimOpacity = Math.min(1, Math.max(0, op));
    }
    //Custom negative parentheses
    if (ds.negativeParens) {
      const parts = String(ds.negativeParens).split(',').map(s=>s.trim());
      if (parts.length === 2 && parts[0] && parts[1]) o.negativeParens = parts[0]+','+parts[1];
    }
    //Custom negative sign symbol (a single codepoint recommended)
    if (ds.negativeSignSymbol != null) o.negativeSignSymbol = ds.negativeSignSymbol;
    //Positive sign
    const sps = asBool(ds.showPositiveSign);
    if (sps !== undefined) o.showPositiveSign = sps;
    if (ds.positiveSignSymbol != null) o.positiveSignSymbol = ds.positiveSignSymbol;
    //Note / Error message
    if (ds.note != null)  o.note = ds.note;
    if (ds.error != null) o.errorMessage = ds.error;
    //Sign on zero
    const szs = asBool(ds.showZeroSign);
    if (szs !== undefined) o.showZeroSign = szs;
    //Precompile frequently used regexes
    o._rePrefixSigned = o.prefix ? new RegExp('^([+-])\\s*' + escapeRegExp(o.prefix)) : null;
    o._reGroupG      = o.group ? new RegExp(escapeRegExp(o.group), 'g') : null;
    o._reDecimalG    = (o.decimal && o.decimal !== '.') ? new RegExp(escapeRegExp(o.decimal), 'g') : null;
    //Precompile custom negative symbol
    o._negSym = o.negativeSignSymbol || '-';
    o._negSymRE = (o._negSym && o._negSym !== '-') ? new RegExp(escapeRegExp(o._negSym), 'g') : null;
    //Precompile custom positive symbol
    o._posSym = o.positiveSignSymbol || '+';
    o._posSymRE = (o._posSym && o._posSym !== '+') ? new RegExp(escapeRegExp(o._posSym), 'g') : null;
    //Precompile negative parentheses
    (() => {
      const pr = String(o.negativeParens || '(,)').split(',');
      o._negPO = (pr[0] || '('); o._negPC = (pr[1] || ')');
    })();
    //Precompile regex for signs before/after the prefix
    (function prepSignRE() {
      const signs = ['\\+','\\-'];
      if (o._negSym && o._negSym !== '-') signs.push(escapeRegExp(o._negSym));
      if (o._posSym && o._posSym !== '+') signs.push(escapeRegExp(o._posSym));
      const any = '(' + signs.join('|') + ')';
      const pfx = escapeRegExp(o.prefix || '');
      o._reSignBeforePrefix = new RegExp('^' + any + '\\s*' + pfx);
      o._reSignAfterPrefix  = new RegExp('^\\s*' + any);
    })();
    return o;
  }

  function getLiveDigits(el, o) {
    //Helper digits
    const ctx = RAW_CTX.get(el);
    return (ctx && Number.isFinite(ctx.digits)) ? (ctx.digits|0) : (o.digits|0);
  }

  //HISTORY HELPERS
  function ensureHistory(el, o) {
    if (!HISTORY.get(el)) HISTORY.set(el, { stack: [], idx: -1, limit: o.historyLimit || 50 });
  }

  function pushHistory(el, label) {
    const o = EL_OPTS.get(el) || {};
    if (o.history === false) return;
    ensureHistory(el, o);
    const h = HISTORY.get(el);
    const out = String(getVal(el) || '');
    const n = LAST_ACCEPT.get(el) ?? parseLocale(out, o);
    const caret = getSelStart(el);
    if (h.idx < h.stack.length - 1) h.stack.splice(h.idx + 1); //taglia "futuro"
    h.stack.push({ out, n, caret, ts: Date.now(), label });
    if (h.stack.length > h.limit) h.stack.shift();
    h.idx = h.stack.length - 1;
  }

  function applyHistState(el, st) {
    if (!st) return;
    setVal(el, st.out);
    LAST_OK.set(el, st.out);
    LAST_ACCEPT.set(el, st.n);
    updateAria(el, EL_OPTS.get(el)||{}, Number.isFinite(st.n)?st.n:0, st.out);
    try { setSelStart(el, Math.min(st.caret, String(getVal(el)).length)); } catch {}
  }

  function undo(elOrSel) {
    eachEl(elOrSel).forEach(el => {
      const h = HISTORY.get(el); if (!h || h.idx <= 0) return;
      h.idx -= 1; applyHistState(el, h.stack[h.idx]);
    });
  }

  function redo(elOrSel) {
    eachEl(elOrSel).forEach(el => {
      const h = HISTORY.get(el); if (!h || h.idx >= h.stack.length - 1) return;
      h.idx += 1; applyHistState(el, h.stack[h.idx]);
    });
  }

  //Lock icon
  const LOCK_SVG_DATAURI = 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.732V19h-2v-1.268A2 2 0 0 1 12 14Z"/></svg>');

  function applyLockIcon(el, o) {
    //Apply lock
    if (!o.lockIcon) return;
    if (el.dataset.pwaxPrevPaddingLeft == null) el.dataset.pwaxPrevPaddingLeft = el.style.paddingLeft || '';
    if (el.dataset.pwaxPrevBgImg == null)       el.dataset.pwaxPrevBgImg = el.style.backgroundImage || '';
    if (el.dataset.pwaxPrevBgPos == null)       el.dataset.pwaxPrevBgPos = el.style.backgroundPosition || '';
    if (el.dataset.pwaxPrevBgSize == null)      el.dataset.pwaxPrevBgSize = el.style.backgroundSize || '';
    if (el.dataset.pwaxPrevBgRepeat == null)    el.dataset.pwaxPrevBgRepeat = el.style.backgroundRepeat || '';
    el.style.backgroundImage = `url("${LOCK_SVG_DATAURI}")`;
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = '0.5rem center';
    el.style.backgroundSize = '1em';
    const pad = parseFloat(getComputedStyle(el).paddingLeft || '0');
    el.style.paddingLeft = Math.max(pad, 28) + 'px';
    el.setAttribute('data-pwax-locked', '1');
  }

  function removeLockIcon(el) {
    //Remove lock
    if (el.getAttribute('data-pwax-locked') !== '1') return;
    el.style.backgroundImage   = el.dataset.pwaxPrevBgImg   || '';
    el.style.backgroundPosition= el.dataset.pwaxPrevBgPos   || '';
    el.style.backgroundSize    = el.dataset.pwaxPrevBgSize  || '';
    el.style.backgroundRepeat  = el.dataset.pwaxPrevBgRepeat || '';
    el.style.paddingLeft       = el.dataset.pwaxPrevPaddingLeft || '';
    delete el.dataset.pwaxPrevBgImg;
    delete el.dataset.pwaxPrevBgPos;
    delete el.dataset.pwaxPrevBgSize;
    delete el.dataset.pwaxPrevBgRepeat;
    delete el.dataset.pwaxPrevPaddingLeft;
    el.removeAttribute('data-pwax-locked');
  }

  const CE_PREV = new WeakMap();
  function lock(elOrSel, opts={}) {
    //Lock field
    eachEl(elOrSel).forEach(el => {
      const o = EL_OPTS.get(el) || DEFAULTS;
      LOCKED.add(el);
      el.setAttribute('aria-readonly', 'true');
      el.setAttribute('aria-disabled', 'true');
      ensureSpinRole(el, o);
      if (!isCE(el)) el.readOnly = true;
      else { CE_PREV.set(el, el.getAttribute('contenteditable')); el.setAttribute('contenteditable','false'); }
      //Segna locked always (indipendente dall'icona)
      el.setAttribute('data-pwax-locked', '1');
      //Salva the cursor inline precedente and imposta "not-allowed"
      if (el.dataset.pwaxPrevCursor == null) el.dataset.pwaxPrevCursor = el.style.cursor || '';
      el.style.cursor = 'not-allowed';
      //Dimming opzionale
      const wantDim = (opts.dim ?? o.lockDim);
      if (wantDim) {
        if (el.dataset.pwaxPrevOpacity == null) el.dataset.pwaxPrevOpacity = el.style.opacity || '';
        const oVal = Number.isFinite(opts.opacity) ? Number(opts.opacity) : o.lockDimOpacity;
        const op = Math.min(1, Math.max(0, Number(oVal ?? 0.5)));
        el.style.opacity = String(op);
      }
      if ((opts.icon ?? o.lockIcon)) applyLockIcon(el, o);
    });
  }

  function unlock(elOrSel) {
    //Unlock field
    eachEl(elOrSel).forEach(el => {
      LOCKED.delete(el);
      el.removeAttribute('aria-readonly');
      el.removeAttribute('aria-disabled');
      if (!isCE(el)) el.readOnly = false;
      else {
        const prev = CE_PREV.get(el);
        if (prev == null) el.removeAttribute('contenteditable');
        else el.setAttribute('contenteditable', prev);
        CE_PREV.delete(el);
      }
      removeLockIcon(el);
      //lear flag and restore the previous inline cursor
      el.removeAttribute('data-pwax-locked');
      if ('pwaxPrevCursor' in el.dataset) {
        el.style.cursor = el.dataset.pwaxPrevCursor;
        delete el.dataset.pwaxPrevCursor;
      } else {
        el.style.cursor = '';
      }
      //Restore opacity
      if ('pwaxPrevOpacity' in el.dataset) {
        el.style.opacity = el.dataset.pwaxPrevOpacity;
        delete el.dataset.pwaxPrevOpacity;
      } else {
        el.style.opacity = '';
      }
    });
  }

  function getState(el) {
    //Element state
    const opts = EL_OPTS.get(el) || null;
    return {
      options: opts ? Object.freeze({ ...opts }) : null, 
      lastOk: LAST_OK.get(el) ?? null,
      lastAccepted: LAST_ACCEPT.get(el) ?? null,
      lastRaw: LAST_RAW.get(el) ?? null,
      locked: LOCKED.has(el)
    };
  }

  //VALUE HELPERS
  //isCE: true if the element is contenteditable
  const isCE  = el => !!el?.isContentEditable;
  //getVal: get the text from the element (value or textContent)
  const getVal = el => isCE(el) ? (el.textContent ?? '') : (el.value ?? '');
  //setVal: set the text on the element (value or textContent)
  const setVal = (el, v) => { if (isCE(el)) el.textContent = v; else el.value = v; };

  function getSelStart(el) {
    //Calculate the caret position (logical offset), also on contenteditable
    if (!isCE(el)) return el.selectionStart ?? String(getVal(el)).length;
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return (getVal(el) || '').length;
    const range = sel.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  function setSelStart(el, pos) {
    //Set the caret to the requested position (handling both CE and input)
    if (!isCE(el)) { try { el.setSelectionRange(pos, pos); } catch{} return; }
    if (!el.firstChild) el.appendChild(document.createTextNode(''));
    const setInNode = (node, offset) => {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    };
    let left = Math.max(0, pos);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      const len = node.nodeValue.length;
      if (left <= len) { setInNode(node, left); return; }
      left -= len;
      node = walker.nextNode();
    }
    const last = el.lastChild;
    if (last) setInNode(last, last.nodeType === 3 ? last.nodeValue.length : (last.childNodes?.length || 0));
  }

  function selectRangeCE(el, start, end) {
    //Select a text range in a contenteditable
    const r = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let pos = 0, a=null, ao=0, b=null, bo=0, node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (a==null && pos + len >= start) { a = node; ao = start - pos; }
      if (pos + len >= end) { b = node; bo = end - pos; break; }
      pos += len;
    }
    if (!a) return;
    if (!b) { b = a; bo = a.nodeValue.length; }
    r.setStart(a, Math.max(0, ao)); r.setEnd(b, Math.max(0, bo));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  function selectAll(el) {
    //Select all
    if (!isCE(el)) {
      el.select();
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    }
  }

  function selectDecimals(el, o) {
    //Decimals select
    const v = String(getVal(el));
    const idx = v.lastIndexOf(o.decimal || ',');
    if (idx >= 0) {
      const sfx = o.suffix || '';
      const end = (sfx && v.endsWith(sfx)) ? v.length - sfx.length : v.length;
      const start = idx + 1;
      if (!isCE(el)) el.setSelectionRange(start, end);
      else { selectRangeCE(el, start, end); }
    } else {
      selectAll(el);
    }
  }

  //GROUPING HELPERS
  function groupByPattern(core, sep, pattern) {
    //Group a numeric string according to a pattern of lengths and a separator
    let out = '';
    let i = core.length, idx = 0;
    while (i > 0) {
      const size = pattern[Math.min(idx, pattern.length-1)];
      const start = Math.max(0, i - size);
      const chunk = core.slice(start, i);
      out = (out ? chunk + sep + out : chunk);
      i = start; idx++;
    }
    return out;
  }

  function groupInteger(intPart, o) {
    //Apply grouping separators to the integer part, respecting sign, style, and pattern
    if (!o.group) return intPart;
    let sign = '';
    let core = intPart || '';
    if (core.startsWith('-') || core.startsWith('+')) {
      sign = core[0]; core = core.slice(1);
    }
    //Avoid odd concatenations
    if (core.length === 0) return sign; 
    if (Array.isArray(o.groupPattern) && o.groupPattern.length) {
      return sign + groupByPattern(core, o.group, o.groupPattern);
    }
    if (o.groupStyle === 'indian') {
      if (core.length <= 3) return sign + core;
      const last3 = core.slice(-3);
      const rest  = groupByPattern(core.slice(0, -3), o.group, [2,2]);
      return sign + rest + o.group + last3;
    }
    return sign + core.replace(/\B(?=(\d{3})+(?!\d))/g, o.group);
  }

  //PARSE FORMAT
  function parseLocale(str, o) {
    //Robust parse of a localized string -> Number (handles prefix/suffix, grouping, decimal, signs, ALT->DEC heuristic)
    if (str == null) return null;
    let s = normalizeDigits(String(str).trim());
    //Accounting-style: custom parentheses -> negative
    let hadParens = false;
    if (s.startsWith(o._negPO) && s.endsWith(o._negPC)) {
      s = s.slice(o._negPO.length, s.length - o._negPC.length).trim();
      hadParens = true;
    }
    //Unicode/RTL normalizations: NBSP, minus sign U+2212, Arabic separators
    s = s.replace(/\u202F/g, ' ').replace(/\u00A0/g, ' ');
    s = s.replace(/\u2212/g, '-');
    //Custom sign symbol -> '-'
    if (o._negSymRE) s = s.replace(o._negSymRE, '-');
    //Custom positive symbol -> '+'
    if (o._posSymRE) s = s.replace(o._posSymRE, '+'); 
    const ARABIC_DEC = '\u066B';
    const ARABIC_GRP = '\u066C';
    if (s.indexOf(ARABIC_DEC) !== -1) {
      //Convert to a dot, then remap to '.' later
      s = s.replace(new RegExp(ARABIC_DEC, 'g'), o.decimal || ',');
    }
    if (o.group && s.indexOf(ARABIC_GRP) !== -1) {
      s = s.replace(new RegExp(ARABIC_GRP, 'g'), o.group);
    }
    if (o.prefix) {
      if (s.startsWith(o.prefix)) {
        s = s.slice(o.prefix.length);
      } else {
        //Support "-€ 123" / "+€ 123"
        const m = o._rePrefixSigned ? s.match(o._rePrefixSigned) : null;
        if (m) s = m[1] + s.slice(m[0].length);
      }
    }
    if (o.suffix && s.endsWith(o.suffix)) s = s.slice(0, -o.suffix.length);
    s = s.replace(/[\s\u00A0]+/g, '');
    const DEC = o.decimal || ',';
    const ALT = DEC === ',' ? '.' : ',';
    //ALT -> DEC tolerant: also works with digits===0 and when ALT coincides with the grouping separator
    const unitHint = hasUnitToken(str); 
    const altCount = (s.match(new RegExp(escapeRegExp(ALT), 'g')) || []).length;
    const wantsAltAsDec =
      (o.acceptBothDecimal || unitHint) && !s.includes(DEC) && altCount === 1;
    if (wantsAltAsDec) {
      const idx = s.lastIndexOf(ALT);
      const beforeDigits = s.slice(0, idx).replace(/\D/g, '').length;
      const afterDigits  = s.slice(idx + 1).replace(/\D/g, '').length;
      const conflictsWithGrouping = (ALT === o.group);
      //Allow override of conflicts with groups if there is a unit token (e.g., "12.4%")
      if (beforeDigits >= 1 && afterDigits >= 1 && (!conflictsWithGrouping || unitHint)) {
        s = s.slice(0, idx) + DEC + s.slice(idx + 1);
      }
    }
    if (o._reGroupG) s = s.replace(o._reGroupG, '');
    if (o._reDecimalG) s = s.replace(o._reDecimalG, '.');
    if (o.allowExponent) {
      //Allow e/E for exponent, then normalize mantissa/exp separately
      s = s.replace(/[^\d.+-eE]/g, '');
      const eIdx = Math.max(s.lastIndexOf('e'), s.lastIndexOf('E'));
      let mant = eIdx > 0 ? s.slice(0, eIdx) : s;
      let exp  = eIdx > 0 ? s.slice(eIdx + 1) : '';
      //Remove any remaining 'e/E' in the mantissa (e.g., "1e-3e2")
      mant = mant.replace(/[eE]/g, '');
      //Mantissa: 1 dot only, 1 leading sign only
      const dot = mant.indexOf('.');
      if (dot !== -1) mant = mant.slice(0, dot + 1) + mant.slice(dot + 1).replace(/\./g, '');
      mant = mant.replace(/(?!^)[+-]/g, '');
      if (!o.allowNegative) mant = mant.replace(/-/g, '');
      //Exponent: optional, only [+|-] at the beginning and digits
      exp = exp.replace(/[^\d+-]/g, '').replace(/(?!^)[+-]/g, '');
      if (exp === '+' || exp === '-' || exp === '') exp = '';
      s = mant + (exp ? 'e' + exp : '');
    } else {
      //No exponent
      s = s.replace(/[^\d.+-]/g, '');
      const firstDot = s.indexOf('.');
      if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
      s = s.replace(/(?!^)[+-]/g, '');
      if (!o.allowNegative) s = s.replace(/-/g, '');
    }
    const n = Number(s);
    const out = Number.isFinite(n) ? n : null;
    let val = (out != null && hadParens && o.allowNegative) ? -Math.abs(out) : out; 
    //Unified unit scaling
    //Note: 'symbolOnly' scales only in the presence of explicit tokens (%, ‰, ‱, bp...)
    //'auto' on NON-unit fields interprets bare numbers as percentages (×0.01)
    if (val != null) {
      const tokenScale = (o.parsePercent === 'off') ? 1 : detectUnitScale(str);
      const isPctField = o.unit === 'percent' || ((o.suffix||'').trim().endsWith('%')) || o.unitFactor === 0.01;
      const isPermilleField = o.unit === 'permille' || o.unitFactor === 0.001;
      const isBpField = o.unit === 'bp' || o.unitFactor === 0.0001;
      let factor = 1;
      if (tokenScale !== 1) {
        //If the user has typed an explicit symbol, that takes precedence
        factor = tokenScale;
      } else if (o.parsePercent === 'auto' && !(isPctField || isPermilleField || isBpField)) {
        //Normal field: interpret bare numbers as percentages
        factor = 0.01;
      } else if (isFiniteNum(o.unitFactor) && o.unitFactor > 0 && o.unitFactor !== 1) {
        //Semantic field: apply its unit
        factor = o.unitFactor;
      }
      val = val * factor;
    }
    return val;
  }
   
  function formatLocale(n, o) {
    //Format a Number into a localized string, with group/decimal/prefix/suffix and sign position.
    if (!isFiniteNum(n)) n = 0;
    if (!o.allowNegative && n < 0) n = Math.abs(n);
    if (isFiniteNum(o.unitFactor) && o.unitFactor > 0 && o.unitFactor !== 1) n = n / o.unitFactor;
    const d = Math.max(0, o.digits|0);
    let n2 = (d > 0) ? roundAdvWithEngine(n, d, o.roundMode, o) : n;
    const s = String(Math.abs(n2).toFixed(d));
    let [intPart, decPart=''] = s.split('.');
    const negSym = o.negativeSignSymbol || '-';
    const posSym = o.positiveSignSymbol || '+';
    let signChar = n2 < 0 ? negSym : ((o.showPositiveSign && n2 > 0) ? posSym : '');
    const useParens = (o.negativeStyle === 'parens') && (n2 < 0);
    if (useParens) signChar = '';
    const groupedInt = groupInteger(intPart, o);
    let numberStr = groupedInt;
    if (d > 0) numberStr += (o.decimal || ',') + decPart;
    const pfx = o.prefix || '', sfx = o.suffix || '';
    let out;
    if (signChar) {
      out = (o.signPosition === 'beforePrefix') ? (signChar + pfx + numberStr + sfx)
                                                : (pfx + signChar + numberStr + sfx);
    } else out = pfx + numberStr + sfx;
    return useParens ? (o._negPO + out + o._negPC) : out;
  }

  //CARET HELPERS
  //isCoarsePointer: detect “coarse” pointers (touch) via media query
  const isCoarsePointer = () => (typeof window !== 'undefined' && window.matchMedia)
      ? window.matchMedia('(pointer: coarse)').matches : false;
  
  //wantsPreserveCaret: determine whether to keep the logical caret based on the `preserveCaret` option and the pointer type
  const wantsPreserveCaret = (o) => o.preserveCaret === true || (o.preserveCaret === 'auto' && !isCoarsePointer());

  function logicalCountBeforeCaret(el, o, DEC) {
    //Map the "logical" characters (digits, sign, decimal) before the caret to preserve its position
    const sel = getSelStart(el);
    const before = String(getVal(el) || '').slice(0, sel);
    const tmp = '\u0000';
    if (!before) return 0;
    let bc = normalizeDigits(before);
    if (o.prefix && bc.startsWith(o.prefix)) bc = bc.slice(o.prefix.length);
    if (o.group) bc = bc.split(o.group).join('');
    bc = bc.split(DEC).join(tmp);
    bc = bc.replace(/[^\d\u0000+-]/g, '');
    bc = bc.replace(/(?!^)[+-]/g, '');
    if (o.negativeSignSymbol && o.negativeSignSymbol !== '-') {
      //Also consider the custom symbol as a sign
      bc = bc.split(o.negativeSignSymbol).join('-');
    }
    if (o.positiveSignSymbol && o.positiveSignSymbol !== '+') {
      bc = bc.split(o.positiveSignSymbol).join('+');
    }
    if (!o.allowNegative) bc = bc.replace(/-/g, '');
    const hasDec = bc.includes(tmp) && o.digits > 0;
    bc = bc.replace(new RegExp(tmp + '+', 'g'), hasDec ? DEC : '');
    if (hasDec) {
      const parts = bc.split(DEC);
      parts[1] = parts[1].slice(0, o.digits);
      bc = parts.join(DEC);
    }
    bc = bc.replace(/^([+-]?)0+(?=\d)/, '$1');
    return bc.length;
  }

  function caretPosFromLogicalCount(out, o) {
    //Translate the logical count into UTF-16 position in the formatted string
    let count = 0;
    const DEC   = o.decimal || ',';
    const neg   = o.negativeSignSymbol || '-';
    const pos   = o.positiveSignSymbol || '+';
    return (target) => {
      count = 0;
      for (let i = 0; i < out.length; i++) {
        const hereNeg = !!neg && out.startsWith(neg, i); 
        const herePos = !!pos && out.startsWith(pos, i); 
        const ch = out[i];
        //Is it a valid sign (custom or ASCII)?
        const isSignHere =
          hereNeg || herePos || ch === '-' || ch === '+';
        //A character is "logical" if it is a digit, decimal, or a sign (only at the beginning of the number)
        const isLogical =
          (ch >= '0' && ch <= '9') ||
          ch === DEC ||
          (isSignHere && (o.signPosition === 'beforePrefix' ? i === 0 : count === 0));
        if (isLogical) {
          count++;
          //If we are on top of a multi-codepoint custom sign, skip its entire length
          if (count === target) {
            if (hereNeg) return i + neg.length;
            if (herePos) return i + pos.length;
            return i + 1;
          }
        }
        //Advance the index, skipping the remaining code units of the custom sign
        if (hereNeg) { i += neg.length - 1; continue; }
        if (herePos) { i += pos.length - 1; continue; }
      }
      return out.length;
    };
  }

  //BEFORECHANGE HOOK
  function applyBeforeChange(el, o, nextN) {
    //Apply the `beforeChange` hook and return {ok:true,value} or {ok:false,value:prev}
    const hook = o.beforeChange;
    if (typeof hook !== 'function') return { ok: true, value: nextN };
    const prev = LAST_ACCEPT.has(el) ? LAST_ACCEPT.get(el) : null;
    const res = hook(nextN, { el, prev });
    if (res === true) return { ok: true, value: nextN };
    if (res && typeof res === 'object') {
      if (res.ok === false) return { ok: false, value: prev };
      return { ok: true, value: ('value' in res ? res.value : nextN) };
    }
    return { ok: true, value: nextN };
  }

  //INCREMENT HELPERS
  const HOLD_TS = new WeakMap();

  function accelFactor(el, o) {
    //Compute the acceleration multiplier (×1/×2/×5/×10) based on press/hold time.
    if (!o.holdAccel) return 1;
    const t0 = HOLD_TS.get(el) || 0;
    const dt = Date.now() - t0;
    if (dt > 1500) return 10;
    if (dt > 800)  return 5;
    if (dt > 300)  return 2;
    return 1;
  }

  function emitLive(el, value, formatted) {
    //Helper live
    try {
      el.dispatchEvent(new CustomEvent('pwaxmask:live', {
        detail: { value, formatted }
      }));
    } catch {}
  }

  function isInputEvent(e) {
    //Input event helper
    return !!(e && typeof e === 'object' && typeof e.inputType === 'string');
  }

  function markBlocked(el, reason, attempted) {
    //Helper to mark blocks + announcement
    try {
      const o = EL_OPTS.get(el) || {};
      const cls = o.invalidClass || 'is-blocked';
      const msg = o.errorMessage || `Invalid value (${reason})`;  
      el.dataset.pwaxInvalidClass = cls;
      el.classList.add(cls);
      el.setAttribute('aria-invalid', 'true');
      if (o.validationMode !== 'soft' && !isCE(el) && typeof el.setCustomValidity === 'function') {
        el.setCustomValidity(msg);
        try { el.reportValidity?.(); } catch {}
      }
      el.dispatchEvent(new CustomEvent('pwaxmask:blocked', { detail: { reason, attempted, message: msg, note: o.note || null } }));
      emitEvent(o, 'blocked', { el, reason, attempted, message: msg, note: o.note || null });
      el.dispatchEvent(new CustomEvent('pwaxmask:announce', { detail: { message: msg } }));
    } finally {
      const o2 = EL_OPTS.get(el) || {};
      if (!o2.ariaInvalidPersist) {
        const ms  = Number.isFinite(o2.ariaInvalidMs) ? o2.ariaInvalidMs : DEFAULTS.ariaInvalidMs;
        const cls = el.dataset.pwaxInvalidClass || (o2.invalidClass || 'is-blocked');
        setTimeout(() => {
          try {
            el.classList.remove(cls);
            el.removeAttribute('aria-invalid');
            if (!isCE(el) && typeof el.setCustomValidity === 'function') el.setCustomValidity('');
            delete el.dataset.pwaxInvalidClass;
          } catch {}
        }, ms);
      }
    }
  }

  //HANDLERS
  function onFocus(e) {
    //RAW/UNFORMAT first, then optional selection (all/decimals) without overwriting the caret
    const el = e.currentTarget;
    if (LOCKED.has(el)) return;
    const o  = EL_OPTS.get(el);
    //Hint/note available to the app’s handlers
    if (o.note) {
      try {
        el.dispatchEvent(new CustomEvent('pwaxmask:note', { detail: { note: o.note }}));
        emitEvent(o, 'note', { el, note: o.note });
      } catch {}
    }
    const wantsSelect = o.selectOnFocus || (o.selectOnFocusOnce && !SELECTED1.get(el));
    const runSelect = () => { try { o.selectDecimalsOnly ? selectDecimals(el, o) : selectAll(el); } catch {} };
    if (o.rawOnFocus) {
      let n = LAST_RAW.get(el);
      if (n == null) n = parseLocale(getVal(el), o);
      if (n == null) n = 0;
      const decChar = o.decimal || ',';
      const autoRaw = Math.max(stepDecimals(o.step||0), o.digits|0, 4);
      const d = Number.isFinite(o.rawDigits) ? Math.max(0, o.rawDigits|0) : autoRaw;
      RAW_CTX.set(el, { digits: d });
      const sign = n < 0 ? '-' : '';
      const abs  = Math.abs(n);
      const s = (d > 0 ? abs.toFixed(d).replace('.', decChar) : String(Math.floor(abs)));
      setVal(el, sign + s);
      LAST_OK.set(el, sign + s);
      updateAria(el, o, n, sign + s);
      requestAnimationFrame(() => {
        try { wantsSelect ? runSelect() : setSelStart(el, (sign?1:0) + s.length); } catch {}
      });
      if (o.selectOnFocusOnce) SELECTED1.set(el, true);
      return;
    }
    if (o.unformatOnFocus) {
      //Show the number without prefixes/suffixes/grouping
      let n = parseLocale(getVal(el), o);
      if (n == null && !(o.blankIfZero && (LAST_ACCEPT.get(el) ?? 0) === 0)) n = 0;
      if (o.blankIfZero && (n ?? 0) === 0) { LAST_OK.set(el, ''); return; }
      const d = Math.max(0, o.digits|0);
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      let s = abs.toFixed(d).replace('.', (o.decimal || ','));
      //No groups/prefix/suffix
      setVal(el, sign + s);
      LAST_OK.set(el, sign + s);
      const nNow = Number((sign ? '-' : '') + s.replace((o.decimal || ','), '.'));
      const nSafe = Number.isFinite(nNow) ? nNow : 0;
      updateAria(el, o, nSafe, sign + s);
      requestAnimationFrame(() => {
        try { wantsSelect ? runSelect() : setSelStart(el, (sign ? 1 : 0) + s.length); } catch {}
      });
      if (o.selectOnFocusOnce) SELECTED1.set(el, true);
      return;
    }
    if (wantsSelect) {
      requestAnimationFrame(() => { try { runSelect(); } catch {} });
      if (o.selectOnFocusOnce) SELECTED1.set(el, true);
    }
  }

  function revertWithCaret(el, o, old, logicalBefore) {
    //Helper: non-destructive revert with caret preserved
    setVal(el, old);
    LAST_OK.set(el, old);
    const nLive = parseLocale(old, o);
    const nSafe = Number.isFinite(nLive) ? nLive : 0;
    updateAria(el, o, nSafe, old);
    try {
      if (wantsPreserveCaret(o)) {
        const mapper = caretPosFromLogicalCount(old, o);
        const pos = mapper(Math.max(0, logicalBefore|0));
        setSelStart(el, pos);
      } else {
        setSelStart(el, String(old).length);
      }
    } catch {}
  }

  function onInput(e) {
    //Pipeline of live typing (parse, min/max enforcement, beforeChange live, grouping, caret preservation)
    const el = e.currentTarget;
    if (LOCKED.has(el)) { e && e.preventDefault?.(); markBlocked(el, 'locked', null); return; }
    if (COMPOSE.get(el)) return;
    const o   = EL_OPTS.get(el);
    const rawCtx = RAW_CTX.get(el);       
    const dLive  = getLiveDigits(el, o);
    const old = LAST_OK.get(el) ?? '';
    const DEC = o.decimal || ',';
    const ALT = DEC === ',' ? '.' : ',';
    const preserve = wantsPreserveCaret(o);
    //Use a "caret or" with live digits
    const oCaret = rawCtx ? { ...o, digits: dLive } : o;
    const logicalBefore = preserve ? logicalCountBeforeCaret(el, oCaret, DEC) : 0;
    let raw = normalizeDigits(getVal(el));
    //Normalization NBSP -> normal space (keeps match with prefix "€ ")
    raw = raw.replace(/\u00A0/g, ' ');   
    //Normalization U+2212 MINUS SIGN -> '-'
    raw = raw.replace(/\u2212/g, '-');
    //Map Arabic separators to the current separators (DEC/GRP)
    const ARABIC_DEC = '\u066B';   //Arabic Decimal Separator
    const ARABIC_GRP = '\u066C';   //Arabic Thousands Separator
    //Map custom signs to ASCII to preserve the sign during typing
    if (o._negSymRE) raw = raw.replace(o._negSymRE, '-');
    if (o._posSymRE) raw = raw.replace(o._posSymRE, '+');
    if (raw.indexOf(ARABIC_DEC) !== -1) {
      raw = raw.replace(new RegExp(ARABIC_DEC, 'g'), DEC);
    }
    if (o.group && raw.indexOf(ARABIC_GRP) !== -1) {
      raw = raw.replace(new RegExp(ARABIC_GRP, 'g'), o.group);
    }
    const ie = isInputEvent(e) ? e : null;
    const isDeletion = !!(ie && ie.inputType && ie.inputType.startsWith('delete'));
    //If the user has deleted everything
    if (raw.trim() === '') {
      //If emptyValue ≠ 'zero' (or keepEmpty=true) we want to SEE the field empty; if emptyValue === 'zero', show 0 (or '' if blankIfZero)
      const wantsEmptyUI = o.keepEmpty || (o.emptyValue && o.emptyValue !== 'zero');
      const out = wantsEmptyUI ? '' : (o.blankIfZero ? '' : formatLocale(0, o));
      if (out === old) {
        if (preserve) {
          const mapper = caretPosFromLogicalCount(out, o);
          const pos = mapper(Math.max(0, logicalBefore));
          requestAnimationFrame(() => { try { setSelStart(el, pos); } catch {} });
        }
        return;
      }
      setVal(el, out);
      LAST_OK.set(el, out);
      const nLive = parseLocale(out, o);
      const nSafe = Number.isFinite(nLive) ? nLive : 0;
      updateAria(el, o, nSafe, out);
      try { setSelStart(el, String(out).length); } catch {}
      return;
    }
    //Logic Caret
    if (o.prefix) {
      if (raw.startsWith(o.prefix)) {
        raw = raw.slice(o.prefix.length);
      } else {
        const m = o._rePrefixSigned ? raw.match(o._rePrefixSigned) : null;
        if (m) raw = m[1] + raw.slice(m[0].length);
      }
    }
    if (o.suffix && raw.endsWith(o.suffix)) raw = raw.slice(0, -o.suffix.length);
    //ALT -> DEC (heuristic aligned with onPaste, with unitHint)
    const unitHintInput = hasUnitToken(getVal(el));
    if (o.acceptBothDecimal && dLive > 0 && !raw.includes(DEC) && !isDeletion) {
      const altCount = (raw.match(new RegExp(escapeRegExp(ALT), 'g')) || []).length;
      if (altCount === 1) {
        const idx = raw.lastIndexOf(ALT);
        const beforeDigits = raw.slice(0, idx).replace(/\D/g, '').length;
        const afterDigits  = raw.slice(idx + 1).replace(/\D/g, '').length;
        const conflictsWithGrouping = (ALT === o.group);
        if (beforeDigits >= 1 && afterDigits > 0 && afterDigits <= dLive && (!conflictsWithGrouping || unitHintInput)) {
          raw = raw.slice(0, idx) + DEC + raw.slice(idx + 1);
        }
      }
    }
    //Remove the thousands separators
    if (o._reGroupG) raw = raw.replace(o._reGroupG, '');
    const tmp = '\u0000';
    raw = raw.split(DEC).join(tmp);
    raw = raw.replace(/[^\d\u0000+-]/g, '');
    raw = raw.replace(/(?!^)[+-]/g, '');
    if (!o.allowNegative) raw = raw.replace(/-/g, '');
    const hasDec = raw.includes(tmp) && dLive > 0;
    raw = raw.replace(new RegExp(tmp + '+', 'g'), hasDec ? DEC : '');
    let intPart = raw, decPart = '';
    if (hasDec) { [intPart, decPart] = raw.split(DEC); decPart = decPart.slice(0, dLive); }
    intPart = intPart.replace(/^([+-]?)0+(?=\d)/, '$1');
    let candidateStr = intPart;
    if (hasDec) candidateStr += '.' + decPart.replace(/\D/g, '');
    let candidate = (candidateStr===''||candidateStr==='-'||candidateStr==='+') ? null : Number(candidateStr);
    //"lenient" warning
    if (candidate != null && isFiniteNum(o.min) && o.liveMinStrategy === 'lenient' && candidate < o.min) {
      el.dispatchEvent(new CustomEvent('pwaxmask:belowmin', { detail:{ attempted:candidate, min:o.min }}));
    }
    if (candidate != null) {
      const lv = runPlugins('liveValidate', { value: candidate, el, o, event: e });
      //Schema live check
      const sv = validateSchema(candidate, o);
      if (!sv.ok) {
        markBlocked(el, 'schema', candidate);
        if (o.validationMode !== 'soft') {
          revertWithCaret(el, o, old, logicalBefore);
        }
        return;
      }
      if (lv && lv.block) {
        markBlocked(el, lv.reason || 'plugin', candidate);
        if (o.validationMode !== 'soft') {
          revertWithCaret(el, o, old, logicalBefore);
        }
        return;
      }
      if (lv && lv.value != null) candidate = lv.value;
    }
    //MAX live
    if (candidate != null && o.enforceMaxWhileTyping && isFiniteNum(o.max) && candidate > o.max) {
      markBlocked(el, 'max', candidate);
      if (o.validationMode !== 'soft') {
        revertWithCaret(el, o, old, logicalBefore);
      }
      return;
    }
    //MIN live — strict but typable for min > 0
    if (candidate != null && isFiniteNum(o.min) && o.liveMinStrategy === 'strict') {
      let shouldBlock = candidate < o.min;
      if (shouldBlock && o.min > 0) {
        //How many integer digits are required to reach min (e.g., 10 -> 2)
        const minIntLen = String(Math.floor(Math.abs(o.min))).length;
        //How many integer digits the user has typed so far
        const typedIntLen = (intPart || '').replace(/^[-+]?/, '').length;
        //Allow typing ONLY at the end until enough digits have been entered
        const sfxLen = (o.suffix || '').length;
        const caretAtEnd = getSelStart(el) >= (String(getVal(el)).length - sfxLen);
        const isTailTyping = caretAtEnd && typedIntLen < minIntLen;
        if (isTailTyping) shouldBlock = false;
      }
      if (shouldBlock) {
        markBlocked(el, 'min', candidate);
        if (o.validationMode !== 'soft') {
          revertWithCaret(el, o, old, logicalBefore);
        }
        return;
      }
    }
    //BeforeChange while typing (optional, NON-destructive)
    if (candidate != null && o.enforceBeforeChangeWhileTyping) {
      const chk = applyBeforeChange(el, o, candidate);
      if (!chk.ok) {
        markBlocked(el, 'beforeChange', candidate);
        if (o.validationMode !== 'soft') {
          revertWithCaret(el, o, old, logicalBefore);
        }
        return;
      }
      candidate = chk.value;
    }
    //Reformat + thousands (without a sign inside the numeric part)
    const sign = (intPart.startsWith('-') || intPart.startsWith('+')) ? intPart[0] : '';
    const core = sign ? intPart.slice(1) : intPart;
    //Translate ASCII sign into the custom symbol for live output
    const signOut =
      sign === '-' ? (o.negativeSignSymbol || '-') :
      sign === '+' ? (o.positiveSignSymbol || (o.showPositiveSign ? '+' : '')) :
      '';
    //Do not force '0' if we only have the minus sign
    const onlySign = !!sign && core.length === 0 && !hasDec;
    //Plugin: refine the numeric string (without prefix/suffix)
    const groupWhile = rawCtx ? false : o.groupWhileTyping;
    const groupedCore = groupWhile ? groupInteger(core, o) : core;
    let outCore = onlySign ? '' : (groupedCore || '0');
    const fs = runPlugins('formatString', { string: outCore, el, o, phase: 'live' });
    if (fs && fs.string != null) outCore = fs.string;
    //Decimals
    if (hasDec) outCore += DEC + decPart;
    //Final composition with sign placement
    const pfx = rawCtx ? '' : (o.prefix || '');
    const sfx = rawCtx ? '' : (o.suffix || '');
    let out;
    if (signOut) {
      out = (o.signPosition === 'beforePrefix')
        ? (signOut + pfx + outCore + sfx)
        : (pfx + signOut + outCore + sfx);
    } else {
      out = pfx + outCore + sfx;
    }
    setVal(el, out);
    LAST_OK.set(el, out);
    const nLive = parseLocale(out, o);
    updateAria(el, o, nLive, out);
    emitLiveDebounced(el, o, nLive, out);
    //Final Caret
    try {
      if (preserve) {
        const mapper = caretPosFromLogicalCount(out, o);
        const pos = mapper(Math.max(0, logicalBefore));
        setSelStart(el, pos);
      } else {
        const v = String(getVal(el) || '');
        const end = (o.suffix && v.endsWith(o.suffix)) ? (v.length - o.suffix.length) : v.length;
        setSelStart(el, end);
      }
    } catch {}
    emitEvent(o, 'live', { value: nLive, formatted: out });
  }

  function onBlur(e) {
    //Output pipeline (snap-to-step, clamp, rounding, blurValidate plugin, final beforeChange, format, change event)
    const el = e.currentTarget;
    RAW_CTX.delete(e.currentTarget);
    PENDING_NEG.delete(el);
    const silent = !!(e && e.silent);
    //Reset acceleration when focus is lost
    HOLD_TS.delete(el);
    const o  = EL_OPTS.get(el);
    const clampAlways = o.clampMode === 'always';
    const clampOnBlur = o.clampMode === 'blur';
    const trimmed = String(getVal(el) || '').trim();
    //Visually empty field: if emptyValue ≠ 'zero' (or keepEmpty=true), do not force 0
    if (trimmed === '' && (o.keepEmpty || (o.emptyValue && o.emptyValue !== 'zero'))) {
      LAST_OK.set(el, '');
      return;
    }
    let n = parseLocale(getVal(el), o);
    //Save the "raw" value before snap/clamp/round
    LAST_RAW.set(el, n);
    if (n == null) n = o.keepEmpty ? null : 0;
    if (n != null) {
      if (o.snapToStepOnBlur && isFiniteNum(o.step) && o.step > 0) n = roundToStepWithEngine(n, o.step, o.min, o.roundMode, o);
      if (clampAlways || clampOnBlur) n = clampWithEngine(n, o.min, o.max, o);
      if (o.digits > 0) n = roundAdvWithEngine(n, o.digits, o.roundMode, o);
    }
    //Schema check on blur
    const svb = validateSchema(n, o);
    if (!svb.ok) {
      markBlocked(el, 'schema', n);
      const acc = LAST_ACCEPT.get(el);
      const back = (o.blankIfZero && (acc ?? 0) === 0) ? '' : (acc==null ? '' : formatLocale(acc, o));
      if (o.validationMode !== 'soft') {
        setVal(el, back);
        LAST_OK.set(el, back);
      }
      return;
    }
    //Plugin: blur validation
    const bv = runPlugins('blurValidate', { value: n, el, o, event: e, phase: 'blur' });
    if (bv && bv.block) {
      markBlocked(el, bv.reason || 'plugin', n);
      const acc = LAST_ACCEPT.get(el);
      const back = (o.blankIfZero && (acc ?? 0) === 0) ? '' : (acc==null ? '' : formatLocale(acc, o));
      setVal(el, back);
      LAST_OK.set(el, back);
      return;
    }
    if (bv && bv.value != null) n = bv.value;
    //BeforeChange on blur
    const prevAccepted = LAST_ACCEPT.get(el);
    const chk = applyBeforeChange(el, o, n);
    if (!chk.ok) {
      markBlocked(el, 'beforeChange', n);
      //Non-destructive restore: prefer LAST_ACCEPT, then LAST_OK, finally ''/0
      const acc = LAST_ACCEPT.get(el);
      let back;
      if (acc != null) {
        back = (o.blankIfZero && acc === 0) ? '' : formatLocale(acc, o);
      } else {
        const prev = LAST_OK.get(el);
        if (prev != null && String(prev).length) {
          back = prev;
        } else {
          back = o.keepEmpty ? '' : (o.blankIfZero ? '' : formatLocale(0, o));
        }
      }
      setVal(el, back);
      LAST_OK.set(el, back);
      return;
    }
    //Accepted: store and notify
    n = chk.value;
    LAST_ACCEPT.set(el, n);
    //Compose final string
    let out = (o.blankIfZero && n === 0) ? '' : (n==null ? '' : formatLocale(n, o));
    //Post-format plugin
    const fs = runPlugins('formatString', { string: out, el, o, phase: 'blur' });
    if (fs && fs.string != null) out = fs.string;
    setVal(el, out);
    updateAria(el, o, (n == null ? '' : (Number.isFinite(n) ? n : 0)), out);
    LAST_OK.set(el, out);
    if (!silent) {
      emitEvent(o, 'change', { value:n, formatted: out });
      el.dispatchEvent(new CustomEvent('pwaxmask:change', {
        detail: { value: n, formatted: out, previous: prevAccepted }
      }));
      try { el.dispatchEvent(new Event('change', { bubbles:true })); } catch {}
    }
    //History: new acceptance
    try { pushHistory(el, 'blur-accept'); } catch {}
  }

  function numericStart(o, hasSign, signSym) {
    //Start position of the numeric part (after prefix and optional sign)
    const pfx = o.prefix || '';
    const sym = signSym || o.negativeSignSymbol || '-';
    const sl  = (sym ? sym.length : 1);
    return hasSign
      ? (o.signPosition === 'beforePrefix'
          ? (sl + pfx.length)
          : (pfx ? (pfx.length + sl) : sl))
      : pfx.length;
  }

  function onKeyDown(e) {
    //Handle locale separator, toggling +/- and increments via arrows/PageUp with acceleration/dynamic step
    const el = e.currentTarget;
    if (LOCKED.has(el)) { e && e.preventDefault?.(); markBlocked(el, 'locked', null); return; }
    const o  = EL_OPTS.get(el);
    //Undo/Redo
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(el); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(el); return; }
    }
    //Shared utility to detect a sign in the current view (dedup)
    const signInView = (vFull) => {
      const res = { has:false, type:null, symbol:'', beforePrefix:false };
      const pfx = o.prefix || '';
      const ns = o.negativeSignSymbol || '-';
      //Sign before the prefix
      const mBefore = o._reSignBeforePrefix?.exec(vFull);
      if (mBefore) {
        const sym = mBefore[1]; res.has = true; res.symbol = sym;
        res.type = (sym === ns || sym === '-') ? 'neg' : 'pos';
        res.beforePrefix = true; return res;
      }
      //Sign immediately after the prefix
      if (pfx && vFull.startsWith(pfx)) {
        const tail = vFull.slice(pfx.length);
        const mAfter = o._reSignAfterPrefix?.exec(tail);
        if (mAfter) {
          const sym = mAfter[1]; res.has = true; res.symbol = sym;
          res.type = (sym === ns || sym === '-') ? 'neg' : 'pos';
          res.beforePrefix = false; return res;
        }
      }
      //No prefix: check at the beginning
      const t = vFull.trim();
      //Prefer complete custom symbols (even multi-codepoint)
      if (t.startsWith(ns)) { res.has = true; res.type = 'neg'; res.symbol = ns; return res; }
      if (t.startsWith('-')) { res.has = true; res.type = 'neg'; res.symbol = '-'; return res; }
      const ps = o.positiveSignSymbol || '+';
      if (t.startsWith(ps)) { res.has = true; res.type = 'pos'; res.symbol = ps; return res; }
      if (t.startsWith('+')) { res.has = true; res.type = 'pos'; res.symbol = '+'; return res; }
      return res;
    };
    if (e.key === 'Home') {
      e.preventDefault();
      const svHome = signInView(getVal(el));
      setSelStart(el, numericStart(o, svHome.has, svHome.symbol));
      return;
    }
    if (e.key === 'End')  {
      e.preventDefault();
      const v = String(getVal(el)||''), end = (o.suffix && v.endsWith(o.suffix)) ? v.length - o.suffix.length : v.length;
      setSelStart(el, end); return;
    }
    //Decimal separator handling (locale-strict + respecting the suffix)
    if (o.digits > 0) {
      const dec = o.decimal || ',';
      const isNumpadDec = (e.code === 'NumpadDecimal' || e.key === 'Decimal' || e.key === 'Separator');
      const isExactDec  = (e.key === dec);
      const isAltDec    = (e.key === '.' || e.key === ',') && e.key !== dec;
      if (isExactDec || isNumpadDec || (o.acceptBothDecimal && isAltDec)) {
        e.preventDefault();
        const pfx = o.prefix || '';
        const sfx = o.suffix || '';
        let v = String(getVal(el) || '');
        //Clamp position between end of prefix and start of suffix
        let pos = getSelStart(el);
        const minPos = pfx.length;
        const maxPos = (sfx && v.endsWith(sfx)) ? v.length - sfx.length : v.length;
        if (pos < minPos) pos = minPos;
        if (pos > maxPos) pos = maxPos;
        if (!v.includes(dec)) {
          v = v.slice(0, pos) + dec + v.slice(pos);
          setVal(el, v);
          LAST_OK.set(el, v);
          setSelStart(el, pos + 1);
        } else {
          setSelStart(el, v.indexOf(dec) + 1);
        }
        //Immediate reformat to avoid artifacts (es. "33%,")
        try { onInput({ currentTarget: el }); } catch {}
        return;
      }
    }
    //First digit after the sign -> replace the leading zero
    const isDigit = e.key && e.key.length === 1 && e.key >= '0' && e.key <= '9';
    if (isDigit) {
      const pfx = o.prefix || '';
      const sfx = o.suffix || '';
      const dec = o.decimal || ',';
      const vFull = String(getVal(el) || '');
      const caret = getSelStart(el);
      //Does the view already contain a sign?
      const sv = signInView(vFull);
      //Base formatted zero (without sign)
      const zeroBase = formatLocale(0, o);
      //Current "zero with sign" view based on signPosition
      const signedZeroView = sv.has
        ? (o.signPosition === 'beforePrefix'
          ? (sv.symbol + zeroBase)
          : (pfx ? (pfx + sv.symbol + zeroBase.slice(pfx.length))
            : (sv.symbol + zeroBase)))
        :zeroBase;
      //Start of the numeric part
      const numericStartPos = numericStart(o, sv.has, sv.symbol);
      //If we are on "signed zero" and the caret is at the beginning of the numeric part -> replace zero with the digit
      const isZeroView = (vFull === signedZeroView) || (o.blankIfZero && vFull === '');
      const caretAtNumericStart = (caret === numericStartPos) || (o.blankIfZero && vFull === '' && caret === 0);
      if (isZeroView && caretAtNumericStart) {
        e.preventDefault();
        let outCore = e.key;
        const dLive = getLiveDigits(el, o);
        if (dLive > 0) outCore += dec + '0'.repeat(dLive);
        //Apply the pending minus (showZeroSign:false -> PENDING_NEG)
        const forceNeg = PENDING_NEG.has(el) && (o.showZeroSign === false);
        const useSign  = forceNeg || sv.has;
        const signSym  = forceNeg ? (o.negativeSignSymbol || '-') : (sv.has ? sv.symbol : '');
        const out = useSign
          ? (o.signPosition === 'beforePrefix'
            ? (signSym + (o.prefix || '') + outCore + sfx)
            : ((o.prefix || '') + signSym + outCore + sfx))
          : ((o.prefix || '') + outCore + sfx);
        setVal(el, out);
        LAST_OK.set(el, out); 
        const nNow = parseLocale(out, o);
        const nSafe = Number.isFinite(nNow) ? nNow : 0;
        updateAria(el, o, nSafe, out);
        if (forceNeg) { try { PENDING_NEG.delete(el); } catch {} }
        //Place the caret IMMEDIATELY AFTER the first digit (not at the end of the field!)
        try {
          const mapper = caretPosFromLogicalCount(out, o);
          const targetLogical = useSign ? 2 : 1; //1 = before cifra (se non c'è sign), 2 = sign + before cifra
          const pos = mapper(targetLogical);
          setSelStart(el, pos);
        } catch {}
        //IMPORTANT: DO NOT call onInput here, to avoid losing caret position
        //(onInput could reformat and move the caret if preserveCaret=false)
        try { emitLiveDebounced(el, o, nNow, out); } catch {}
        return;
      }
    }
    //Toggle '-' with support for zero: handle the sign at string level
    if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
      if (!o.allowNegative) { e.preventDefault(); return; }
      const pfx = o.prefix || '';
      const sfx = o.suffix || '';
      const vFull = String(getVal(el) || '');
      //Already has a visual sign?
      const sv = signInView(vFull);
      let n = parseLocale(vFull, o);
      if (n == null) n = 0;
      //Insert/remove the sign and place the caret at the correct point
      if (Math.abs(n) === 0) {
        e.preventDefault();
        const base = formatLocale(0, o);
        //If you don’t want to show -0, arm the “minus” for the next digit
        if (o.showZeroSign === false) {
          PENDING_NEG.add(el);
          //Remain 0 (or '' if blankIfZero)
          const out = base; 
          setVal(el, out);
          LAST_OK.set(el, out);
          updateAria(el, o, 0, out);
          try {
            //Caret at the beginning of the numeric part
            const pos = numericStart(o, false);
            setSelStart(el, pos);
          } catch {}
          return;
        }
        //Otherwise (showZeroSign=true) classic behavior: show -0
        const sym = o.negativeSignSymbol || '-';
        const out = (o.signPosition === 'beforePrefix')
          ? (sym + base)
          : (pfx ? (pfx + sym + base.slice(pfx.length)) : (sym + base));
        setVal(el, out);
        LAST_OK.set(el, out);
        updateAria(el, o, 0, out);
        try {
          const pos = numericStart(o, true, sym);
          setSelStart(el, pos);
        } catch {}
        return;
      }
      //Value ≠ 0: configurable behavior (minusBehavior)
      e.preventDefault();
      const mb = o.minusBehavior || 'forceNegative';
      n = (mb === 'toggle') ? -n : -Math.abs(n);
      let out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
      setVal(el, out);
      LAST_OK.set(el, out);
      LAST_ACCEPT.set(el, n);
      const nSafe = Number.isFinite(n) ? n : 0;
      updateAria(el, o, nSafe, out);
      emitLiveDebounced(el, o, n, out);
      try {
        const caretPos = out.length - (sfx ? sfx.length : 0);
        setSelStart(el, caretPos);
      } catch {}
      try { pushHistory(el, 'toggle-sign'); } catch {}
      return;
    }
    //Toggle '+' (make positive). On zero: remove the sign if present and place caret on the numeric core
    if (e.key === '+' || e.code === 'NumpadAdd') {
      e.preventDefault();
      const pfx = o.prefix || '';
      const sfx = o.suffix || '';
      const vFull = String(getVal(el) || '');
      let n = parseLocale(vFull, o);
      if (n == null) n = 0;
      if (Math.abs(n) === 0) {
        PENDING_NEG.delete(el);
        const base = formatLocale(0, o);
        setVal(el, base);
        LAST_OK.set(el, base);
        updateAria(el, o, n, base);
        LAST_ACCEPT.set(el, n);
        emitLiveDebounced(el, o, n, base);
        //Normalize the caret: no sign -> hasSignNow=false
        try {
          const pos = numericStart(o, false);
          setSelStart(el, pos);
        } catch {}
        try { pushHistory(el, 'toggle-sign'); } catch {}
        return;
      }
      //Different from zero: normalize to positive
      n = Math.abs(n);
      const out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
      setVal(el, out);
      LAST_OK.set(el, out);
      LAST_ACCEPT.set(el, n);
      updateAria(el, o, n, out);
      emitLiveDebounced(el, o, n, out);
      try {
        const caretPos = out.length - (sfx ? sfx.length : 0);
        setSelStart(el, caretPos);
      } catch {}
      return;
    }
    const key = e.key;
    //PageUp / PageDown = large step (×10), without hold
    if (key === 'PageUp' || key === 'PageDown') {
      let stepBase = isFiniteNum(o.step) ? o.step : (o.digits > 0 ? 0.01 : 1);
      //Plugin: override step
      const soPg = runPlugins('step', { baseStep: stepBase, el, o, event: e, key });
      if (soPg && isFiniteNum(soPg.step)) stepBase = soPg.step;
      let mult = 10;
      //Optional: Shift = ×10
      if (e.shiftKey) mult *= 10; 
      const step = stepBase * mult;
      e.preventDefault();
      let n = parseLocale(getVal(el), o);
      if (n == null) n = 0;
      n += (key === 'PageUp' ? step : -step);
      if (o.clampMode === 'always') n = clampWithEngine(n, o.min, o.max, o);
      if (!o.allowNegative && !isFiniteNum(o.min) && n < 0) n = 0;
      if (o.digits > 0) n = roundAdvWithEngine(n, o.digits, o.roundMode, o);
      const chk = applyBeforeChange(el, o, n);
      if (!chk.ok) {
        markBlocked(el, 'beforeChange', n);
        return;
      }
      n = chk.value;
      //Compose string
      let out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
      //Plugin: refine string
      const fsPg = runPlugins('formatString', { string: out, el, o, phase: 'key' });
      if (fsPg && fsPg.string != null) out = fsPg.string;
      setVal(el, out);
      const nSafe = Number.isFinite(n) ? n : 0;
      updateAria(el, o, nSafe, out);
      LAST_OK.set(el, out);
      LAST_ACCEPT.set(el, n);
      try { pushHistory(el, 'key-pg'); } catch {}
      emitLiveDebounced(el, o, n, out);
      return;
    }
    //ArrowUp / ArrowDown with acceleration
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
    if (o.holdAccel) {
      //Only at first keydown
      if (!HOLD_TS.has(el)) HOLD_TS.set(el, Date.now()); 
    } else {
      HOLD_TS.delete(el);
    }
    let stepBase = isFiniteNum(o.step) ? o.step : (o.digits > 0 ? 0.01 : 1);
    //Plugin: override step
    const soAr = runPlugins('step', { baseStep: stepBase, el, o, event: e, key });
    if (soAr && isFiniteNum(soAr.step)) stepBase = soAr.step;
    let mult = o.holdAccel ? accelFactor(el, o) : 1;
    //Optional: Shift = ×10
    if (e.shiftKey) mult *= 10; 
    const step = stepBase * mult;
    e.preventDefault();
    let n = parseLocale(getVal(el), o);
    if (n == null) n = 0;
    n += (key === 'ArrowUp' ? step : -step);
    if (o.holdAccel && o.snapWhileHolding && isFiniteNum(o.step) && o.step > 0) {
      n = roundToStepWithEngine(n, o.step, o.min, o.roundMode, o);
    }
    if (o.clampMode === 'always') n = clampWithEngine(n, o.min, o.max, o);
    if (!o.allowNegative && !isFiniteNum(o.min) && n < 0) n = 0;
    if (o.digits > 0) n = roundAdvWithEngine(n, o.digits, o.roundMode, o);
    const chk = applyBeforeChange(el, o, n);
    if (!chk.ok) {
      markBlocked(el, 'beforeChange', n);
      return;
    }
    n = chk.value;
    //Compose string
    let out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
    //Plugin: refine string
    const fsAr = runPlugins('formatString', { string: out, el, o, phase: 'key' });
    if (fsAr && fsAr.string != null) out = fsAr.string;
    setVal(el, out);
    const nSafe = Number.isFinite(n) ? n : 0;
    updateAria(el, o, nSafe, out);
    LAST_OK.set(el, out);
    LAST_ACCEPT.set(el, n);
    try { pushHistory(el, 'key-arrow'); } catch {}
    emitLiveDebounced(el, o, n, out);
  }

  function onKeyUp(e) { 
    //Clear hold state (end acceleration when arrow key is released)
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') HOLD_TS.delete(e.currentTarget); 
  }

  function onWheel(e) {
    //Increment/decrement via mouse wheel (requires focus and allowWheel)
    const el = e.currentTarget;
    if (LOCKED.has(el)) { e && e.preventDefault?.(); return; }
    const o  = EL_OPTS.get(el);
    if (!o.allowWheel) return;
    //Richiede focus (anche for CE)
    if (document.activeElement !== el) return; 
    e.preventDefault();
    const dir = (e.deltaY || 0) < 0 ? +1 : -1;
    const step = (isFiniteNum(o.step) ? o.step : (o.digits>0 ? 0.01 : 1)) * (e.shiftKey ? 10 : 1);
    let n = parseLocale(getVal(el), o);
    if (n == null) n = 0;
    n += dir * step;
    if (o.clampMode === 'always') n = clampWithEngine(n, o.min, o.max, o);
    if (!o.allowNegative && !isFiniteNum(o.min) && n < 0) n = 0;
    if (o.digits > 0) n = roundAdvWithEngine(n, o.digits, o.roundMode, o);
    const chk = applyBeforeChange(el, o, n);
    if (!chk.ok) {
      markBlocked(el, 'beforeChange', n);
      return;
    }
    n = chk.value;
    const out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
    setVal(el, out);
    const nSafe = Number.isFinite(n) ? n : 0;
    updateAria(el, o, nSafe, out);
    LAST_OK.set(el, out);
    LAST_ACCEPT.set(el, n);
    try { pushHistory(el, 'wheel'); } catch {}
    emitLiveDebounced(el, o, n, out);
  }

  function onPaste(e) {
    //Paste flow (transformPasteText plugin, parse locale/percent, clamp/round, blurValidate, beforeChange, format)
    const el = e.currentTarget;
    if (LOCKED.has(el)) { e && e.preventDefault?.(); markBlocked(el, 'locked', null); return; }
    const o  = EL_OPTS.get(el);
    const clampAlways = o.clampMode === 'always';
    const clampOnBlur = o.clampMode === 'blur';
    let t = (e.clipboardData?.getData('text') || '').trim();
    if (!t) return;
    //Plugin can transform the pasted text
    const tp = runPlugins('transformPasteText', { text: t, el, o, event: e });
    if (tp && tp.text != null) t = tp.text;
    const original = t;
    let s = normalizeDigits(t);
    //Remove NBSP / thin space (Excel FR/DE uses U+202F)
    s = s.replace(/\u202F/g, ' ').replace(/\u00A0/g, ' ');
    const DEC = o.decimal || ',';
    const ALT = DEC === ',' ? '.' : ',';
    //Detect the presence of a unit token (%, ‰, ‱, bp...) to relax ALT->DEC
    const unitHint = hasUnitToken(original);
    //ALT -> DEC tollerant
    const altCount = (s.match(new RegExp(escapeRegExp(ALT), 'g')) || []).length;
    const wantsAltAsDec =
      (o.acceptBothDecimal || unitHint) && !s.includes(DEC) && altCount === 1;
    if (wantsAltAsDec) {
      const idx = s.lastIndexOf(ALT);
      const beforeDigits = s.slice(0, idx).replace(/\D/g, '').length;
      const afterDigits  = s.slice(idx + 1).replace(/\D/g, '').length;
      const conflictsWithGrouping = (ALT === o.group) && afterDigits === 3;
      if (beforeDigits >= 1 && afterDigits >= 1 && (!conflictsWithGrouping || unitHint)) {
        s = s.slice(0, idx) + DEC + s.slice(idx + 1);
      }
    }
    //Parse
    const n0 = parseLocale(s, o);
    if (n0 == null) return;
    e.preventDefault();
    let nn = n0;
    //Save raw value before any scaling/clamp/round
    LAST_RAW.set(el, nn); 
    //Clamp/round (respecting clampOnPaste)
    if (o.clampOnPaste && (clampAlways || clampOnBlur)) nn = clampWithEngine(nn, o.min, o.max, o);
    if (o.digits > 0) nn = roundAdvWithEngine(nn, o.digits, o.roundMode, o);
    //Validation in blur-phase via plugin (e.g., parity/custom conditions)
    const pv = runPlugins('blurValidate', { value: nn, el, o, event: e, phase: 'paste' });
    if (pv && pv.block) {
      markBlocked(el, pv.reason || 'plugin', nn);
      return;
    }
    if (pv && pv.value != null) nn = pv.value;
    //BeforeChange
    const chk = applyBeforeChange(el, o, nn);
    if (!chk.ok) {
      markBlocked(el, 'beforeChange', nn);
      return;
    }
    nn = chk.value;
    let out = (o.blankIfZero && nn === 0) ? '' : formatLocale(nn, o);
    //Schema on paste
    const svp = validateSchema(nn, o);
    if (!svp.ok) {
      markBlocked(el, 'schema', nn);
      return;
    }
    //Plugin can refine the formatted string
    const fs = runPlugins('formatString', { string: out, el, o, phase: 'paste' });
    if (fs && fs.string != null) out = fs.string;
    //Render + state
    setVal(el, out);
    const nSafe = Number.isFinite(nn) ? nn : 0;
    updateAria(el, o, nSafe, out);
    LAST_OK.set(el, out);
    LAST_ACCEPT.set(el, nn);
    try { pushHistory(el, 'paste'); } catch {}
    emitLiveDebounced(el, o, nn, out);
  }

  function onCopy(e) {
    //If `copyRaw` is enabled, copy the raw numeric value to the clipboard
    const el = e.currentTarget;
    const o  = EL_OPTS.get(el);
    if (!o || !o.copyRaw) return;
    const n = (window.pwaxMask && typeof window.pwaxMask.getValue === 'function')
      ? window.pwaxMask.getValue(el)
      : getValue(el);
    if (n == null) return;
    try {
      e.clipboardData?.setData('text/plain', String(n));
      e.preventDefault();
    } catch {
      try { navigator.clipboard?.writeText(String(n)); e.preventDefault(); } catch {}
    }
  }

  //ATTACH/DETACH
  function setMobileKeyboard(el, o) {
    //Set inputmode/pattern for mobile keyboards (numeric/decimal)
    if (isCE(el)) return;
    if (o.digits === 0) {
      if (o.allowNegative) {
        //Leave a “free” keyboard to allow entering the minus sign
        el.setAttribute('inputmode', 'numeric');
        el.setAttribute('pattern', '-?[0-9]*');
      } else {
        el.setAttribute('inputmode', 'numeric');
        el.setAttribute('pattern', '[0-9]*');
      }
    } else {
      const mode = (o.negativeInputmode === 'decimal')
        ? 'decimal'
        : (o.negativeInputmode === 'text')
          ? 'text'
          : (o.allowNegative && (o.forceTextForNegative === true)) ? 'text' : (o.allowNegative ? 'text' : 'decimal');
      el.setAttribute('inputmode', mode);
      el.removeAttribute('pattern');
    }
    el.setAttribute('enterkeyhint', 'done');
  }

  function attach(el, base) {
    //Attach handlers and state to the element, initialize consistent rendering, and notify plugins onAttach.
    if (EL_OPTS.has(el)) return;
    const preset = pickPreset(el, base);
    const o = readDataOpts(el, preset);
    //Auto-locale via Intl
    if (base.detectLocale) {
      const inf = inferLocaleFromIntl(el);
      const ds = el.dataset || {};
      if (!ds.group && !ds.thousand) o.group = inf.group;
      if (!ds.decimal) o.decimal = inf.decimal;
    }
    EL_OPTS.set(el, o);
    ensureSpinRole(el, o);
    setMobileKeyboard(el, o);
    const h = {
      focus: onFocus.bind(null),
      input: onInput.bind(null),
      blur:  onBlur.bind(null),
      keydown: onKeyDown.bind(null),
      keyup: onKeyUp.bind(null),
      paste: onPaste.bind(null),
      copy: onCopy.bind(null),
      wheel: onWheel.bind(null),
      cstart: () => COMPOSE.set(el, true),
      cend:   (ev) => { COMPOSE.set(el, false); onInput(ev); }
    };
    HANDLERS.set(el, h);
    try { PLUGINS.forEach(p => p.onAttach?.({ el, options: o })); } catch {}
    el.addEventListener('focus', h.focus);
    el.addEventListener('input', h.input);
    el.addEventListener('blur',  h.blur);
    el.addEventListener('keydown', h.keydown);
    el.addEventListener('keyup', h.keyup);
    el.addEventListener('paste', h.paste);
    el.addEventListener('copy', h.copy);
    el.addEventListener('wheel', h.wheel, { passive: false });
    el.addEventListener('compositionstart', h.cstart);
    el.addEventListener('compositionend',   h.cend);
    //Visual init: respect keepEmpty
    const empty = String(getVal(el) || '').trim() === '';
    if (!empty) { try { pushHistory(el, 'attach-pre'); } catch {} }
    if (empty && base.formatEmptyOnInit && (o.emptyValue === 'zero' && !o.keepEmpty)) {
      //Prefer 0 if within range; otherwise clamp to min/max
      let n = clamp(0, o.min, o.max);
      if (o.snapToStepOnBlur && isFiniteNum(o.step) && o.step > 0) {
        n = roundToStepWithEngine(n, o.step, o.min, o.roundMode, o);
      }
      if (o.digits > 0) n = roundAdvWithEngine(n, o.digits, o.roundMode, o);
      const out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
      setVal(el, out);
      LAST_OK.set(el, out);
      LAST_ACCEPT.set(el, n);
    } else {
      onBlur({ currentTarget: el, silent: true });
      if (!LAST_ACCEPT.has(el)) {
        const n0 = parseLocale(getVal(el), o);
        if (Number.isFinite(n0)) LAST_ACCEPT.set(el, n0);
      }
    }
    ATTACHED.add(el);
    //History: initial state
    try { pushHistory(el, 'attach-init'); } catch {}
  }

  function detach(el) {
    //Remove handlers/state and notify plugins onDetach.
    if (LOCKED.has(el)) { try { unlock(el); } catch {} }
    const h = HANDLERS.get(el);
    const t = LIVE_T.get(el); if (t) clearTimeout(t);
    LIVE_T.delete(el);
    if (h) {
      el.removeEventListener('focus', h.focus);
      el.removeEventListener('input', h.input);
      el.removeEventListener('blur',  h.blur);
      el.removeEventListener('keydown', h.keydown);
      el.removeEventListener('keyup', h.keyup);
      el.removeEventListener('paste', h.paste);
      el.removeEventListener('copy', h.copy);
      el.removeEventListener('wheel', h.wheel);
      el.removeEventListener('compositionstart', h.cstart);
      el.removeEventListener('compositionend',   h.cend);
    }
    //Plugins
    try { PLUGINS.forEach(p => p.onDetach?.({ el })); } catch {}
    HANDLERS.delete(el);
    EL_OPTS.delete(el);
    LAST_OK.delete(el);
    LAST_ACCEPT.delete(el);
    COMPOSE.delete(el);
    SELECTED1.delete(el);
    HOLD_TS.delete(el);
    ATTACHED.delete(el);
  }

  //UTILS PUBLIC VIEW (read only)
  const utils = {
    normalizeDigits, escapeRegExp, stepDecimals,
    roundToStep, roundAdvanced, clamp, groupInteger,
    parseLocale, formatLocale, isFiniteNum, hasUnitToken
  };

  //PLUGIN API
  //Plugin registry
  const PLUGINS = [];

  function use(plugin) {
    //Register/replace a plugin {name,...}; calls p.onRegister({utils,DEFAULTS})
    if (!plugin || typeof plugin !== 'object' || !plugin.name) return;
    const idx = PLUGINS.findIndex(p => p.name === plugin.name);
    if (idx >= 0) PLUGINS.splice(idx, 1, plugin); else PLUGINS.push(plugin);
    try { plugin.onRegister?.({ utils, DEFAULTS }); } catch {}
  }

  function runPlugins(hook, ctx) {
    //Invoke a hook on all plugins in registration order, allowing {block},{value},{string},{step},{stop}
    let acc = { ...ctx };
    let changed = false;
    for (const p of PLUGINS) {
      const fn = p[hook];
      if (typeof fn !== 'function') continue;
      const res = fn(acc);
      if (!res) continue;
      if (res.stop === true || res.block === true) return res;
      if (typeof res === 'object') {
        acc = { ...acc, ...res };
        changed = true;
      }
    }
    return { ...acc, __changed: changed };
  }

  function listPlugins(detail = false) {
    //Return an array with plugin names or details if detail=true
    return detail
      ? PLUGINS.map(p => ({
          name: p.name,
          version: p.version ?? null,
          hooks: Object.keys(p).filter(k => typeof p[k] === 'function')
        }))
      : PLUGINS.map(p => p.name);
  }

  function hasPlugin(name) {
    //Return true if a plugin with that name exists
    return PLUGINS.some(p => p && p.name === name);
  }

  function getPlugin(name) {
    //Return the registered plugin object (or null)
    return PLUGINS.find(p => p && p.name === name) || null;
  }

  //PRESET EXTENSIBILITY
  function addPreset(key, opts) {
    //Register/overwrite a user preset
    if (!key) return;
    PRESETS[key] = { ...opts };
  }

  function removePreset(key) {
    //Delete a preset from the registry
    if (!key) return;
    delete PRESETS[key];
  }

  function getPreset(key) {
    //Return a COPY of the preset or null
    const p = PRESETS[key];
    return p ? { ...p } : null;
  }

  function listPresets() {
    //List the keys of all presets
    return Object.keys(PRESETS);
  }

  function mapClassPreset(selector, presetOrOpts) {
    //Associate a preset/opts with a CSS selector
    if (!selector) return;
    if (typeof presetOrOpts === 'string') {
      CLASS_PRESETS[selector] = PRESETS[presetOrOpts] ? { ...PRESETS[presetOrOpts] } : {};
    } else {
      CLASS_PRESETS[selector] = { ...presetOrOpts };
    }
  }

  function unmapClassPreset(selector) {
    //Remove the association for a selector
    delete CLASS_PRESETS[selector];
  }

  function detectUnitScale(raw) {
    //Helper parsepercent
    const s = String(raw).toLowerCase();
    const hasPct = /%|％|\b(pct|percent|per\s*cento)\b/.test(s);
    const hasPermille = /‰|\b(permille|per\s*mille)\b/.test(s);
    const hasBp = /‱|\bbp(s)?\b|\bbasis\s*points?\b/.test(s);
    if (hasPermille) return 0.001;
    if (hasBp) return 0.0001;
    if (hasPct) return 0.01;
    return 1;
  }

  function hasUnitToken(raw) {
    //% helper
    const s = String(raw).toLowerCase();
    return /%|％|‰|‱|\bbp(s)?\b|\bbasis\s*points?\b|\bpct\b|\bpercent\b|\bper\s*cento\b|\bpermille\b|\bper\s*mille\b/.test(s);
  }

  //API
  function init(opts = {}) {
    //Initialize pwaxMask on selectors; merge defaults; start observer if requested; expose operational APIs
    const {
      selectors = ['.num', '.eur', '.dec', '.per'],
      defaults  = {},
      root = document,
      selectOnFocus = false,
      selectOnFocusOnce = false,
      selectDecimalsOnly = false,
      signPosition = 'afterPrefix',
      enforceMaxWhileTyping = true,
      liveMinStrategy = 'none',
      keepEmpty = false,
      blankIfZero = false,
      snapToStepOnBlur = false,
      formatEmptyOnInit = true,
      observe = false,
      preserveCaret = 'auto',
      allowNegative = DEFAULTS.allowNegative,
      clampOnPaste = DEFAULTS.clampOnPaste,
      allowWheel = false,
      holdAccel = false,
      parsePercent = 'off',
      presets = null,         
      classPresets = null,    
      //Plugins Array
      plugins = null, 
      beforeChange = DEFAULTS.beforeChange,
      detectLocale = DEFAULTS.detectLocale,
      mathEngine = DEFAULTS.mathEngine,
      schema = DEFAULTS.schema,
      unit = DEFAULTS.unit,
      unitDisplay = DEFAULTS.unitDisplay,
      unitFactor = DEFAULTS.unitFactor,
      validationMode = DEFAULTS.validationMode,
      invalidClass = DEFAULTS.invalidClass,
      liveDebounceMs = DEFAULTS.liveDebounceMs,
      unformatOnFocus = DEFAULTS.unformatOnFocus,
      snapWhileHolding = false,
      forceTextForNegative = DEFAULTS.forceTextForNegative
    } = opts;
    const base = {
      ...DEFAULTS,
      ...defaults,
      selectOnFocus, selectOnFocusOnce, selectDecimalsOnly,
      enforceMaxWhileTyping, liveMinStrategy,
      keepEmpty, blankIfZero, snapToStepOnBlur,
      formatEmptyOnInit, observe, allowNegative,
      preserveCaret, allowWheel, holdAccel, parsePercent, 
      beforeChange, signPosition, detectLocale, mathEngine, schema,
      unit, unitDisplay, unitFactor,
      validationMode, invalidClass, liveDebounceMs, forceTextForNegative,
      unformatOnFocus, snapWhileHolding, clampOnPaste
    };
    //Plugin registration at init
    if (Array.isArray(plugins)) {
      plugins.forEach(pl => use(pl));
    }
    //Notify plugins that the instance has started
    PLUGINS.forEach(p => { try { p.onInit?.({ selectors, defaults: base }); } catch {} });
    if (presets && typeof presets === 'object') {
      for (const k in presets) { addPreset(k, presets[k]); }
    }
    if (classPresets && typeof classPresets === 'object') {
      for (const sel in classPresets) { mapClassPreset(sel, classPresets[sel]); }
    }
    const attachAll = (sel) => (root || document).querySelectorAll(sel).forEach(el => attach(el, base));
    if (typeof selectors === 'string') attachAll(selectors);
    else selectors.forEach(attachAll);
    //Dynamic observe (+ attribute changes)
    if (base.observe) {
      //Reuse the observer if it already exists; do not disconnect previous instances
      if (!OBSERVER) {
        const processQueue = () => {
          OBSERVER_CB_SCHEDULED = false;
          const nodes = Array.from(OBSERVER_QUEUE);
          OBSERVER_QUEUE.clear();
          nodes.forEach(node => {
            if (!(node instanceof Element)) return;
            const handle = (el) => {
              if (ATTACHED.has(el)) {
                //Re-read options from data-* and re-render
                const preset = pickPreset(el, base);
                const o = readDataOpts(el, preset);
                if (base.detectLocale) {
                  const inf = inferLocaleFromIntl(el);
                  const ds  = el.dataset || {};
                  if (!ds.group && !ds.thousand) o.group = inf.group;
                  if (!ds.decimal)               o.decimal = inf.decimal;
                }
                EL_OPTS.set(el, o);
                ensureSpinRole(el, o);
                setMobileKeyboard(el, o);
                onBlur({ currentTarget: el, silent: true }); //reformat consistently
              } else {
                attach(el, base);
              }
            };
            const add = (sel) => {
              const rightmost = sel.trim().split(/\s+/).pop();
              const candidates = rightmost && rightmost !== sel ? [sel, rightmost] : [sel];
              candidates.forEach(s => {
                if (node.matches?.(s)) handle(node);
                node.querySelectorAll?.(s).forEach(handle);
              });
            };
            if (typeof selectors === 'string') add(selectors); else selectors.forEach(add);
          });
        };
        OBSERVER = OBSERVER || new MutationObserver(muts => {
          muts.forEach(m => {
            if (m.type === 'attributes' && m.target instanceof Element) {
              OBSERVER_QUEUE.add(m.target);
            }
            m.addedNodes.forEach(node => OBSERVER_QUEUE.add(node));
            m.removedNodes.forEach(node => {
              if (!(node instanceof Element)) return;
              //Detach the removed node and all its already attached descendants
              const maybeDetach = (el) => { if (ATTACHED.has(el)) detach(el); };
              maybeDetach(node);
              node.querySelectorAll?.('*').forEach(maybeDetach);
            });
          });
          if (!OBSERVER_CB_SCHEDULED) {
            OBSERVER_CB_SCHEDULED = true;
            Promise.resolve().then(processQueue); 
          }
        });
        const obsTarget = (root && root.body) ? root.body : (root || document).body || (root || document);
        OBSERVER.observe(obsTarget, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'class','data-preset','data-decimal','data-group','data-thousand',
            'data-enforce-before','data-before-live','data-before-change',
            'data-digits','data-empty-value','data-min','data-max','data-step',
            'data-prefix','data-suffix','data-group-style','data-group-pattern',
            'data-select-on-focus','data-select-on-focus-once','data-select-decimals',
            'data-live-min','data-live-max','data-keep-empty','data-blank-zero',
            'data-snap-to-step','data-caret','data-allow-wheel','data-hold-accel',
            'data-accept-both-decimal','data-parse-percent', 'data-round-mode',
            'data-allow-negative','data-group-while-typing','data-group-live',
            'data-copy-raw','data-sign-position','data-negative-style',
            'data-negative-inputmode','data-currency','data-unit','data-unit-factor',
            'data-unit-display','lang','data-allow-exponent','data-raw-on-focus',
            'data-raw-digits','data-negative-parens','data-negative-sign-symbol',
            'data-lock-icon','data-lock-dim','data-lock-opacity','data-show-positive-sign',
            'data-positive-sign-symbol','data-show-zero-sign','data-note','data-error',
            'data-aria-text-formatted'
          ]
        });
      }
    } else {
      if (OBSERVER) { OBSERVER.disconnect(); OBSERVER = null; }
    }
    return {
      getValue, setValue, value: getValue,
      parse: parseLocale, format: formatLocale,
      update, destroy, use, utils,
      stopObserving, refreshOptions
    };
  }

  function eachEl(target) {
    //Normalize a target (element/selector/list) into an array of elements
    if (target instanceof Element) return [target];
    if (typeof target === 'string') return Array.from(document.querySelectorAll(target));
    if (Array.isArray(target)) return target.filter(n => n instanceof Element);
    if (target && (target instanceof NodeList || target instanceof HTMLCollection)) {
      return Array.from(target);
    }
    return [];
  }

  function getValue(elOrSel) {
    //Extract the numeric value from the element/selector (respecting blankIfZero/keepEmpty)
    const els = eachEl(elOrSel);
    if (els.length === 0) return null;
    const el = els[0];
    const base = pickPreset(el, DEFAULTS);
    //If the element is not yet attached, apply locale inference if requested
    if (!EL_OPTS.has(el) && (DEFAULTS.detectLocale || base.detectLocale)) {
      const inf = inferLocaleFromIntl(el);
      base.group   ??= inf.group;
      base.decimal ??= inf.decimal;
    }
    const o = EL_OPTS.get(el) || readDataOpts(el, base);
    const v = String(getVal(el) || '').trim();
    if (v === '') {
      //If the UI is empty because blankIfZero hid a 0 -> return 0
      if (o.blankIfZero) {
        const acc = LAST_ACCEPT.get(el);
        if (acc === 0) return 0;
        //If it is not an accepted 0, fall back to emptyValue
      }
      //Respect the emptyValue policy for explicitly empty fields
      const ev = o.emptyValue || 'zero';
      if (ev === 'null')  return null;
      if (ev === 'empty') return '';
      return 0; 
    }
    return parseLocale(v, o);
  }

  function valueAsNumber(elOrSel) { 
    //Alias of getValue (compat).
    return getValue(elOrSel); 
  }

  function setValue(elOrSel, value) {
    //Set a numeric value on the elements, applying clamp/round/format and updating state
    eachEl(elOrSel).forEach(el => {
      const base = pickPreset(el, DEFAULTS);
      const o = EL_OPTS.get(el) || readDataOpts(el, base);
      let n = Number(value);
      if (!Number.isFinite(n)) n = 0;
      LAST_RAW.set(el, n);
      if (o.digits > 0) n = roundAdvWithEngine(n, o.digits, o.roundMode, o);
      const clampAlways = o.clampMode === 'always';
      const clampOnBlur  = o.clampMode === 'blur';
      if (clampAlways || clampOnBlur) n = clampWithEngine(n, o.min, o.max, o);
      const chk = applyBeforeChange(el, o, n);
      if (!chk.ok) return;
      n = chk.value;
      if (o.snapToStepOnBlur && isFiniteNum(o.step) && o.step > 0) {
        n = roundToStepWithEngine(n, o.step, o.min, o.roundMode, o);
      }
      const out = (o.blankIfZero && n === 0) ? '' : formatLocale(n, o);
      setVal(el, out);
      LAST_OK.set(el, out);
      LAST_ACCEPT.set(el, n);
      try { pushHistory(el, 'setValue'); } catch {}
      const nSafe = Number.isFinite(n) ? n : 0;
      updateAria(el, o, nSafe, out);
    });
  }

  function update(elOrSel, newOpts = {}) {
    //Update runtime options on elements and enforce blur for consistent re-render
    eachEl(elOrSel).forEach(el => {
      const base = pickPreset(el, DEFAULTS);
      const current = EL_OPTS.get(el) || readDataOpts(el, base);
      const coerce = v => (v===''||v==null) ? null : Number(v);
      let o = { ...current, ...newOpts };
      if ('min'  in newOpts) o.min  = coerce(newOpts.min);
      if ('max'  in newOpts) o.max  = coerce(newOpts.max);
      if ('step' in newOpts) o.step = coerce(newOpts.step);
      o._rePrefixSigned = o.prefix ? new RegExp('^([+-])\\s*' + escapeRegExp(o.prefix)) : null;
      o._reGroupG       = o.group ? new RegExp(escapeRegExp(o.group), 'g') : null;
      o._reDecimalG     = (o.decimal && o.decimal !== '.') ? new RegExp(escapeRegExp(o.decimal), 'g') : null;
      if ('groupPattern' in newOpts && typeof newOpts.groupPattern === 'string') {
        o.groupPattern = parseGroupPattern(newOpts.groupPattern);
      }
      if ('negativeSignSymbol' in newOpts) {
        o._negSym   = o.negativeSignSymbol || '-';
        o._negSymRE = (o._negSym && o._negSym !== '-') ? new RegExp(escapeRegExp(o._negSym), 'g') : null;
      }
      if ('positiveSignSymbol' in newOpts) {
        o._posSym   = o.positiveSignSymbol || '+';
        o._posSymRE = (o._posSym && o._posSym !== '+') ? new RegExp(escapeRegExp(o._posSym), 'g') : null;
      }
      if ('negativeParens' in newOpts) {
        const pr = String(o.negativeParens || '(,)').split(',');
        o._negPO = (pr[0] || '('); o._negPC = (pr[1] || ')');
      }
      if (isFiniteNum(o.step)) {
        const dStep = stepDecimals(o.step);
        o.digits = dStep === 0 ? 0 : Math.max(o.digits|0, dStep);
      }
      EL_OPTS.set(el, o);
      ensureSpinRole(el, o);
      setMobileKeyboard(el, o);
      onBlur({ currentTarget: el, silent: true });
    });
  }

  function destroy(elOrSel) {
    //Completely remove the mask from elements (detach)
    eachEl(elOrSel).forEach(el => detach(el));
  }

  function stopObserving() { 
    //Disable the global MutationObserver (if active)
    if (OBSERVER) { OBSERVER.disconnect(); OBSERVER = null; } 
  }

  function setLocale({ decimal, group } = {}) {
    //Update the global defaults `decimal`/`group` (for new attachments)
    if (decimal) DEFAULTS.decimal = decimal;
    if (group)   DEFAULTS.group   = group;
  }

  function configure(defaults = {}) { 
    //Direct merge into the global DEFAULTS (advanced)
    Object.assign(DEFAULTS, defaults); 
  }

  function refreshOptions() {
    //Regenerate regex and options
    ATTACHED.forEach(el => {
      const base = pickPreset(el, DEFAULTS);
      const o = readDataOpts(el, base);      
      EL_OPTS.set(el, o);
      setMobileKeyboard(el, o);
      onBlur({ currentTarget: el, silent: true });
    });
  }

  function reformatAll() {
    //Force reformat on all already attached elements (useful after global changes)
    ATTACHED.forEach(el => onBlur({ currentTarget: el, silent: true }));
  }

  addEventListener('formdata', (ev) => {
    //Form submit “raw”
    const fd = ev.formData;
    ev.target.querySelectorAll('input[name], textarea[name], [contenteditable][name]').forEach(el => {
      if (!window.pwaxMask?.getValue) return;
      const n = window.pwaxMask.getValue(el);
      if (n != null) fd.set(el.name, String(n));
    });
  });

  //EXPORT
  window.pwaxMask = {
    init, getValue, setValue, value: valueAsNumber,
    parse: parseLocale, format: formatLocale,
    update, destroy, stopObserving,
    setLocale, configure, reformatAll, refreshOptions,
    addPreset, removePreset, getPreset, listPresets,
    mapClassPreset, unmapClassPreset, use, utils,
    listPlugins, hasPlugin, getPlugin,
    undo, redo, lock, unlock,
    caret: { getStart: getSelStart, setStart: setSelStart, selectDecimals: (el)=>selectDecimals(el, EL_OPTS.get(el)||DEFAULTS) },
    ver: () => VERSION,
    get version() { 
      //Return version
      return VERSION; 
    },
    //PRESETS API
    get presets() { 
      //Get presets
      return Object.freeze({ ...PRESETS }); 
    },
    get classPresets() { 
      //Get preset classes
      return Object.freeze({ ...CLASS_PRESETS }); 
    },
    registerPreset(name, options) {
      //Register new preset
      if (!name || typeof name !== 'string') return false;
      PRESETS[name] = { ...(PRESETS[name] || {}), ...(options || {}) };
      return true;
    },
    extendPreset(name, baseName, overrides={}) {
      //Extend preset
      if (!PRESETS[baseName]) return false;
      PRESETS[name] = { ...PRESETS[baseName], ...overrides };
      return true;
    },
    unregisterPreset(name) {
      //Unregister preset
      if (!name || !(name in PRESETS)) return false;
      //Avoid touching the defaults
      if (['eur','per','dec','num','usd','inr','jpy','gbp','chf'].includes(name)) return false;
      delete PRESETS[name];
      return true;
    },
    getPreset(name) { 
      //Get a single preset (by name)
      return PRESETS[name] ? { ...PRESETS[name] } : null; 
    },
    listPresets() { 
      //List all presets
      return Object.keys(PRESETS).slice(); 
    },
    setDefaults(partial) {
      //Safely modify DEFAULTS
      if (!partial || typeof partial !== 'object') return;
      Object.assign(DEFAULTS, partial);
    }
  };

  window.pwaxMask.getState = getState;
  
  //Alias
  try { window.PWAxmask = window.pwaxMask; } catch {}
  
  //UMD exports (AMD / CommonJS)
  if (typeof define === 'function' && define.amd) {
    define([], () => window.pwaxMask);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.pwaxMask;
  } else {
    //ESM-friendly fallback (no-op, already exposed on window)
    try { window.pwaxMask = window.pwaxMask; } catch {}
  }
})();