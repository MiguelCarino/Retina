/* ============================================================
   retina-clinical.js — Carino Retina clinical maths.
   ------------------------------------------------------------
   The pure formulas index.html used to carry inline: fundus calibration
   from the disc diameter, cup-to-disc ratios, disc size, disc–fovea
   distance and angle, the numeric-field grammar (dioptres, axis wrap,
   measurements), the acuity ladders, PD from a photo, lens centration,
   screen calibration carry-over, and the chart engine's sizing, contrast,
   luminance and optotype tables.

   Nothing here touches the DOM, a canvas, storage or the network, and
   nothing here is translated: every user-visible word stays in
   index.html (tools/i18n-check.js reads only that file). Functions
   return numbers, plain objects and canonical strings; the caller labels
   them.

   `chartMath` is a self-contained factory (no closure over this file) so
   index.html can inject it into the presenting chart window the same way
   it injects presentEngine: chartMath.toString(). Keep it that way — a
   reference from inside chartMath to anything outside it breaks the chart.

   UMD-style so tools/unit-tests.js can require() it.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // node unit tests
  else root.RetinaClinical = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- fundus calibration (assumed vertical disc diameter → mm/px) ----------
  // The scale is an ASSUMPTION, not a measurement: 1.5 mm is the textbook disc
  // diameter and planimetric series put the vertical mean nearer 1.9 mm, so every mm
  // figure below is relative to the chip value, and the reports say so.
  const DISC_DIA_MIN = 0.5, DISC_DIA_MAX = 4, DISC_DIA_DEFAULT = 1.5;
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : NaN;
  // Store semantics: falsy / unparseable → the default, otherwise clamped.
  function clampDiscDia(v) { v = +v || DISC_DIA_DEFAULT; return Math.min(DISC_DIA_MAX, Math.max(DISC_DIA_MIN, v)); }
  // Typed-chip semantics: a parseable number is clamped (0 → 0.5), anything else keeps
  // the previous value rather than silently falling back to 1.5.
  function discDiaInput(str, prev) {
    const v = parseStep(str, 'num');
    if (v == null) return prev == null ? DISC_DIA_DEFAULT : prev;
    return Math.min(DISC_DIA_MAX, Math.max(DISC_DIA_MIN, v));
  }
  // mm per image px, or null when there is no usable disc (ry must be > 0: an imported
  // ellipse with a zero or negative semi-axis is uncalibrated, never a signed scale).
  function scaleOf(disc, discDiaMm) {
    const d = num(discDiaMm), ry = disc ? num(disc.ry) : NaN;
    if (!(d > 0) || !(ry > 0)) return null;
    return d / (2 * ry);
  }
  function fmtLen(px, s) { px = num(px); if (!isFinite(px)) return ''; if (s > 0) return (px * s).toFixed(2) + ' mm'; return Math.round(px) + ' px'; }

  // ---------- cup-to-disc ratios ----------
  // Ratio of semi-axes (= ratio of diameters), per axis. A cup is inside the disc by
  // definition, so a ratio above 1 or a cup centre outside the disc ellipse is an
  // annotation error: `flag` says which, and metricsOfEye withholds the numbers.
  function cdr(disc, cup) {
    const o = { v: null, h: null, flag: null };
    if (!disc || !cup) return o;
    const dry = num(disc.ry), drx = num(disc.rx), cry = num(cup.ry), crx = num(cup.rx);
    if (dry > 0 && cry >= 0) o.v = cry / dry;
    if (drx > 0 && crx >= 0) o.h = crx / drx;
    if ((o.v != null && o.v > 1) || (o.h != null && o.h > 1)) o.flag = 'over';
    else if (drx > 0 && dry > 0) {
      const ex = (num(cup.cx) - num(disc.cx)) / drx, ey = (num(cup.cy) - num(disc.cy)) / dry;
      if (isFinite(ex) && isFinite(ey) && ex * ex + ey * ey > 1) o.flag = 'outside';
    }
    return o;
  }

  // ---------- disc size ----------
  // The vertical diameter equals the chip value by construction; the horizontal one
  // is the only measured diameter, and the ellipse area follows from both.
  function discSize(disc, s) {
    if (!disc) return null;
    const rx = num(disc.rx), ry = num(disc.ry);
    const areaPx = (rx > 0 && ry > 0) ? Math.PI * rx * ry : 0;
    const o = { vPx: 2 * ry, hPx: 2 * rx, areaPx, vMm: null, hMm: null, areaMm2: null };
    if (s > 0) { o.vMm = 2 * ry * s; o.hMm = 2 * rx * s; o.areaMm2 = areaPx * s * s; }
    return o;
  }

  // ---------- disc centre → fovea ----------
  // Angle = inclination of the disc–fovea line to the horizontal, folded so it does not
  // depend on which side the fovea lies (OD and OS read the same): positive = fovea
  // below the disc centre (Jonas 2015 convention, mean +7.8°). Image y grows downward.
  function discFovea(dc, fov, s) {
    if (!dc || !fov) return null;
    const dx = num(fov.x) - num(dc.x), dy = num(fov.y) - num(dc.y);
    if (!isFinite(dx) || !isFinite(dy)) return null;
    const px = Math.hypot(dx, dy);
    return { px, mm: s > 0 ? px * s : null, angle: Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI };
  }
  // Whole degrees with an explicit sign; a value that rounds to zero is '0°', never '-0°'.
  function fmtAngle(a) { const r = Math.round(num(a)) || 0; return (r > 0 ? '+' : '') + r + '°'; }

  // ---------- creation / resize floor ----------
  // Screen-space: 3 screen px whatever the zoom, so a click wobble at fit zoom on a
  // large photo cannot replace a drawn disc with a 6-px one.
  function minRadius(zoom) { zoom = num(zoom); return zoom > 0 ? 3 / zoom : 3; }

  // ---------- the exported metrics object ----------
  // One rounding, here, for the screen summary, the Study JSON, every PDF and the print
  // report: ratios and mm to 2 dp (a hand-drawn ellipse carries no third decimal),
  // mm/px to 4 significant figures, the angle to 1 dp. Marks on a sample picture are
  // not a measurement of the patient: everything is null and `sample` says why.
  function metricsOfEye(e) {
    const o = { verticalCDR: null, horizontalCDR: null, cdrFlag: null, discFoveaDistMm: null, discFoveaAngleDeg: null, mmPerPx: null,
      discDiamVMm: null, discDiamHMm: null, discAreaMm2: null, discDiaAssumedMm: null, sample: false };
    if (!e) return o;
    if (e.imgSample || e.possibleSample) { o.sample = true; return o; }
    const marks = Array.isArray(e.marks) ? e.marks : [];
    const find = k => marks.find(m => m && m.kind === k);
    const disc = find('disc'), cup = find('cup'), dc = find('disc-center'), fov = find('fovea-center');
    const s = scaleOf(disc, e.discDiaMm);
    const r = cdr(disc, cup);
    o.cdrFlag = r.flag;
    if (!r.flag) { if (r.v != null) o.verticalCDR = +r.v.toFixed(2); if (r.h != null) o.horizontalCDR = +r.h.toFixed(2); }
    if (s) {
      o.mmPerPx = +s.toPrecision(4); o.discDiaAssumedMm = num(e.discDiaMm);
      const d = discSize(disc, s);
      o.discDiamVMm = +d.vMm.toFixed(2); o.discDiamHMm = +d.hMm.toFixed(2); o.discAreaMm2 = +d.areaMm2.toFixed(2);
    }
    const df = discFovea(dc, fov, s);
    if (df) { o.discFoveaAngleDeg = +df.angle.toFixed(1) || 0; if (df.mm != null) o.discFoveaDistMm = +df.mm.toFixed(2); }
    return o;
  }

  // ---------- numeric-field grammar ----------
  // dpt: signed two-decimal dioptres (plano unsigned). k: two decimals. axis: whole
  // degrees, 1–180 (TABO, 0 written 180). num: as typed, trailing zeros dropped.
  function fmtStep(v, fmt) {
    if (v == null || isNaN(v)) return '';
    if (Math.abs(v) < 1e-9) v = 0;
    if (fmt === 'axis') return String(Math.round(v));
    if (fmt === 'k') return v.toFixed(2);
    if (fmt === 'dpt') return (v > 0 ? '+' : '') + v.toFixed(2);
    return Number.isInteger(v) ? String(v) : (+v.toFixed(2)).toString();
  }
  // Typed signs are not only ASCII: the placeholders themselves show U+2212, Word and
  // iOS write U+2212 / en dash, and a Japanese IME writes full-width digits. All of them
  // are the same number; a sign the regex did not consume would otherwise be dropped,
  // turning −1.25 into +1.25.
  const FW = s => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48)).replace(/．/g, '.').replace(/，/g, ',');
  function parseStep(str, fmt) {
    if (str == null) return null;
    const s = FW(String(str)).replace(/[−–—－]/g, '-').replace(/＋/g, '+').replace(/([+-])\s+(?=[\d.])/g, '$1').replace(',', '.');
    const m = s.match(/-?\d*\.?\d+/);
    if (!m) return null;
    let v = parseFloat(m[0]); if (isNaN(v)) return null;
    if (fmt === 'axis') v = Math.round(v);
    return v;
  }
  const specNum = v => (v === undefined || v === null || v === '') ? null : (isNaN(parseFloat(v)) ? null : parseFloat(v));
  // spec: {min, max, wrap} — wrap folds into [min, max] (axis), otherwise clamps.
  function clampValue(v, spec) {
    spec = spec || {}; const mn = specNum(spec.min), mx = specNum(spec.max);
    if (spec.wrap && mn != null && mx != null) { const range = mx - mn + 1; while (v > mx) v -= range; while (v < mn) v += range; return v; }
    if (mn != null && v < mn) v = mn; if (mx != null && v > mx) v = mx; return v;
  }
  function inRange(v, spec) { spec = spec || {}; if (spec.wrap) return true; const mn = specNum(spec.min), mx = specNum(spec.max); return !((mn != null && v < mn) || (mx != null && v > mx)); }
  function snapStep(v, step) { step = +step || 1; return Math.round(v / step) * step; }
  // Wheel / arrow / drag: move by one step (×4 coarse), snap to the grid, clamp or wrap.
  function bumpValue(str, dir, coarse, spec) {
    spec = spec || {}; const fmt = spec.fmt || 'num', step = +spec.step || 1;
    let v = parseStep(str, fmt); if (v == null) v = 0;
    v = v + dir * step * (coarse ? 4 : 1);
    v = snapStep(v, step);
    v = clampValue(v, spec);
    return fmtStep(v, fmt);
  }
  // Blur / store normalisation of a TYPED value. Only the format is normalised: the
  // sign and decimals of a power, the TABO wrap of an axis. Nothing typed is snapped to
  // the wheel grid (a −0.12 D cylinder is a real lens, and 0.25-snapping made it 0.00)
  // and a measurement (IOP, pachy, K, PD, frame) is never clamped; `out` flags a value
  // outside the field's usual range instead.
  //   → {value: canonical string or null when nothing parses, out: boolean}
  function normaliseInput(str, spec) {
    spec = spec || {}; const fmt = spec.fmt || 'num';
    let v = parseStep(str, fmt);
    if (v == null) return { value: null, out: false };
    if (fmt === 'axis' && spec.wrap) v = clampValue(v, spec);
    return { value: fmtStep(v, fmt), out: !inRange(v, spec) };
  }
  // A value that arrived from a file (Study JSON, inbox prefill): same grammar as the
  // inputs, and for a plain measurement the field's range is applied. Powers are
  // reformatted without snapping (0.12 D steps are legitimate); what does not parse is
  // left as the text it was.
  function importField(str, spec) {
    spec = spec || {}; const fmt = spec.fmt || 'num';
    if (str == null) return str;
    const v = parseStep(str, fmt);
    if (v == null) return String(str);
    if (fmt === 'axis') return fmtStep(spec.wrap ? clampValue(v, spec) : v, fmt);
    if (fmt === 'dpt') return fmtStep(v, fmt);
    return fmtStep(clampValue(v, spec), fmt);
  }

  // ---------- prescription line (one formatter for screen, PDFs and print) ----------
  // Three slots, always positional: a blank sphere with a cylinder is 'Pl', the axis
  // is introduced by '×' and printed only with its cylinder ('× —' when the cylinder has
  // no axis, so the omission is visible). addLabel is the caller's word for "Add".
  const S = v => (v == null) ? '' : String(v).trim();
  function rxLine(o, addLabel) {
    o = o || {}; const sph = S(o.sph), cyl = S(o.cyl), axis = S(o.axis), add = S(o.add);
    if (!sph && !cyl && !axis && !add) return '';
    const sphT = sph || ((cyl || axis || add) ? 'Pl' : '—');
    let cylT = ''; if (cyl) cylT = cyl + ' × ' + (axis || '—'); else if (axis) cylT = '— × ' + axis;
    let out = sphT + (cylT ? '  ' + cylT : '');
    if (add) out += '   ' + (addLabel || 'Add') + ' ' + add;
    return out;
  }
  // Slot lists for a labelled PDF cell ('A / B', 'Panto/Vertex/Wrap'): a blank slot is
  // printed as '—' so the others cannot shift under the wrong name; all blank → ''.
  function slots(list, sep) { const a = (list || []).map(S); return a.some(Boolean) ? a.map(v => v || '—').join(sep == null ? ' / ' : sep) : ''; }

  // ---------- visual-acuity ladders ----------
  // Imperial: the Snellen rows plus the ETDRS rows (20/12.5 … 20/63); metric: the
  // BS 4274-1 chart rows (6/36, 6/5, 6/4) plus the ETDRS-equivalent rows the chart
  // engine labels (6/21, 6/15, 6/7.5, 6/4.5). Tail strings are shared.
  const SEQ = {
    va20: ['20/10', '20/12.5', '20/15', '20/16', '20/20', '20/25', '20/30', '20/32', '20/40', '20/50', '20/60', '20/63', '20/70', '20/80', '20/100', '20/125', '20/160', '20/200', '20/400', 'CF', 'HM', 'LP', 'NLP'],
    va6: ['6/3', '6/4', '6/4.5', '6/5', '6/6', '6/7.5', '6/9', '6/12', '6/15', '6/18', '6/21', '6/24', '6/30', '6/36', '6/60', 'CF', 'HM', 'LP', 'NLP'],
    near: ['J1+', 'J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J10', 'J12', 'J14', 'J16']
  };
  const TO_METRIC = { '20/200': '6/60', '20/100': '6/30', '20/70': '6/21', '20/50': '6/15', '20/40': '6/12', '20/30': '6/9', '20/25': '6/7.5', '20/20': '6/6', '20/15': '6/4.5', '20/10': '6/3' };
  // Step a ladder. o: {kind:'va'|'near', placeholder, scale:'20'|'6'|null (the notation
  // last used on this field)}. An empty field seeds at the placeholder (in the
  // remembered notation); a value with a +/- letter suffix steps from its base row; a
  // non-empty value that is on no ladder is returned unchanged (never overwritten).
  //   → {value, scale, unchanged?}
  function acuityStep(value, dir, o) {
    o = o || {}; const raw = S(value), norm = raw.replace(/\s+/g, '').toUpperCase();
    let scale = o.scale || null, list;
    if (o.kind === 'near') list = SEQ.near;
    else { if (/^6\//.test(norm)) scale = '6'; else if (/^20\//.test(norm)) scale = '20'; list = scale === '6' ? SEQ.va6 : SEQ.va20; }
    const up = list.map(v => v.toUpperCase());
    if (!norm) {
      let ph = S(o.placeholder).replace(/\s+/g, '').toUpperCase();
      if (scale === '6' && TO_METRIC[ph]) ph = TO_METRIC[ph].toUpperCase();
      let i = up.indexOf(ph); if (i < 0) i = 0;
      return { value: list[i], scale };
    }
    let i = up.indexOf(norm);
    if (i < 0) { const m = /^(.*?)[+-]\d$/.exec(norm); if (m) i = up.indexOf(m[1]); }
    if (i < 0) return { value: raw, scale, unchanged: true };
    i = Math.min(list.length - 1, Math.max(0, i - dir));   // up = better acuity = earlier
    return { value: list[i], scale };
  }

  // ---------- PD from a photo (ID-1 card, 85.60 × 53.98 mm) ----------
  const ID1_LONG_MM = 85.6, ID1_SHORT_MM = 53.98;
  function photoScale(refMm, lenPx) { refMm = num(refMm); lenPx = num(lenPx); if (!(refMm > 0) || !(lenPx > 0)) return null; return refMm / lenPx; }
  function photoPd(lenPx, scale) { lenPx = num(lenPx); if (!(lenPx > 0) || !(scale > 0)) return null; return +(lenPx * scale).toFixed(1); }

  // ---------- lens centration ----------
  // o: {A, B, DBL, pdDist, monoOD, monoOS, eye:'OD'|'OS', fitHt, segHt} (strings or numbers)
  // Decentration = frame half-PD (A+DBL)/2 − the eye's monocular PD; 'in' (nasal) when
  // positive. One typed monocular PD plus a binocular PD gives the other eye pdDist −
  // mono (monocular PDs sum to the binocular PD); pdDist/2 only when neither is typed.
  // The cross sits at the OC/fitting height; the segment top is a separate line.
  //   → null (no frame) or {frameHalf, mono, assumed, dec, decTxt, dir, fh, seg, fhOut, decOut}
  function centration(o) {
    o = o || {}; const P = v => { const n = parseStep(v, 'num'); return n == null ? NaN : n; };
    const A = P(o.A), B = P(o.B), DBL = P(o.DBL);
    if (!(A > 0 && B > 0 && DBL >= 0)) return null;
    const pd = P(o.pdDist), mOD = P(o.monoOD), mOS = P(o.monoOS), frameHalf = (A + DBL) / 2;
    const mine = o.eye === 'OS' ? mOS : mOD, other = o.eye === 'OS' ? mOD : mOS;
    let mono = null, assumed = false;
    if (mine > 0) mono = mine;
    else if (other > 0 && pd > 0) mono = pd - other;
    else if (pd > 0) { mono = pd / 2; assumed = true; }
    const fit = P(o.fitHt), segv = P(o.segHt);
    const fh = fit > 0 ? fit : (segv > 0 ? segv : B / 2), seg = segv > 0 ? segv : null;
    const dec = mono != null ? frameHalf - mono : null;
    let decTxt = null, dir = null;
    if (dec != null) { const q = Math.round(Math.abs(dec) * 4) / 4; decTxt = ((q * 4) % 2 === 0) ? q.toFixed(1) : q.toFixed(2); dir = Math.abs(dec) < 0.125 ? 'in' : (dec > 0 ? 'in' : 'out'); }
    return { frameHalf, mono, assumed, dec, decTxt, dir, fh, seg, fhOut: !(fh > 0 && fh <= B), decOut: dec != null && Math.abs(dec) > A / 2 };
  }

  // ---------- screen calibration ----------
  // One CSS px covers scaleFactor × pitch mm, so px/mm = 1/(scale × pitch): a value
  // measured on the anchor display carried to a target of equal pitch scales by
  // anchorScale / targetScale (4 px/mm at @1 → 2 px/mm at @2).
  function carryPxPerMm(base, anchorScale, targetScale) { base = num(base); anchorScale = num(anchorScale); targetScale = num(targetScale); if (!(base > 0) || !(anchorScale > 0) || !(targetScale > 0)) return null; return base * anchorScale / targetScale; }
  const PX_PER_MM_MIN = 1.2, PX_PER_MM_MAX = 20, DISTANCE_M_MIN = 0.3, DISTANCE_M_MAX = 99;
  function distanceMm(d, unit) { d = num(d); if (!(d > 0)) return NaN; return unit === 'ft' ? d * 304.8 : d * 1000; }
  // The displayed figure for a canonical distance, 2 dp (so m ↔ ft round-trips exactly).
  function distanceIn(mm, unit) { mm = num(mm); if (!(mm > 0)) return NaN; return Math.round((unit === 'ft' ? mm / 304.8 : mm / 1000) * 100) / 100; }
  function sanePxPerMm(v, def) { v = +v; return (isFinite(v) && v >= PX_PER_MM_MIN && v <= PX_PER_MM_MAX) ? v : def; }
  function saneDistance(v, unit, def) { v = +v; const mn = unit === 'ft' ? DISTANCE_M_MIN * 3.28084 : DISTANCE_M_MIN, mx = unit === 'ft' ? DISTANCE_M_MAX * 3.28084 : DISTANCE_M_MAX; return (isFinite(v) && v >= mn && v <= mx) ? v : def; }

  // ---------- chart engine maths ----------
  // SELF-CONTAINED: this factory is serialised with toString() into the chart window.
  // It must not reference anything declared outside its own body.
  function chartMath() {
    var TAN5 = 0.0014544;   // tan(5 arcmin)
    // Classic Snellen rows (20/15 is the chart's own L E F O D P C T; F D P L T C E O
    // is its 20/13 row) with the metric label of each.
    var CHART = [
      { sn: '20/200', m6: '6/60', mar: 10, log: 1.0, ch: 'E' },
      { sn: '20/100', m6: '6/30', mar: 5, log: 0.7, ch: 'FP' },
      { sn: '20/70', m6: '6/21', mar: 3.5, log: 0.54, ch: 'TOZ' },
      { sn: '20/50', m6: '6/15', mar: 2.5, log: 0.4, ch: 'LPED' },
      { sn: '20/40', m6: '6/12', mar: 2, log: 0.3, ch: 'PECFD' },
      { sn: '20/30', m6: '6/9', mar: 1.5, log: 0.18, ch: 'EDFCZP' },
      { sn: '20/25', m6: '6/7.5', mar: 1.25, log: 0.1, ch: 'FELOPZD' },
      { sn: '20/20', m6: '6/6', mar: 1.0, log: 0.0, ch: 'DEFPOTEC' },
      { sn: '20/15', m6: '6/4.5', mar: 0.75, log: -0.12, ch: 'LEFODPCT' }
    ];
    var SLOAN = 'CDHKNORSVZ';
    var SLOAN_LINES = ['NCKHV', 'DSRKN', 'ZVCDH', 'ONHRC', 'KDNRO', 'CSRHN', 'ZKDVO', 'HNVCK', 'ROVKD'];
    var CONTRAST_ROWS = ['NCKHV', 'DSRKN', 'ZVCDH', 'ONHRC', 'KDNRO', 'CSRHZ'];
    // Nine distinct fixed Tumbling-E rows: the four orientations plus one repeat, the
    // repeat sitting in a different place from row to row (an arithmetic pattern gave
    // two rows for nine sizes with the first and last E always equal).
    var E_LINES = [[0, 90, 270, 180, 90], [180, 0, 90, 270, 0], [90, 270, 0, 180, 270], [270, 180, 90, 0, 180], [90, 0, 270, 180, 90],
      [0, 270, 180, 90, 270], [180, 90, 0, 270, 90], [270, 0, 180, 90, 0], [90, 180, 270, 0, 180]];
    var R4 = [0, 90, 180, 270], R8 = [0, 45, 90, 135, 180, 225, 270, 315];
    // The E is a limbs-RIGHT glyph rotated clockwise by its code; the Landolt C's code
    // is the gap's clock position from the top. Two conventions, two answer keys.
    var ARROW_C = { 0: '↑', 45: '↗', 90: '→', 135: '↘', 180: '↓', 225: '↙', 270: '←', 315: '↖' };
    var ARROW_E = { 0: '→', 90: '↓', 180: '←', 270: '↑' };
    function orientationArrow(test, code) { var m = test === 'tumblingE' ? ARROW_E : ARROW_C; return m[code] != null ? m[code] : String(code); }
    function fixedOrientations(test, line) {
      if (test === 'tumblingE') return E_LINES[((line % E_LINES.length) + E_LINES.length) % E_LINES.length].slice();
      var arr = []; for (var i = 0; i < 5; i++) arr.push(R8[(i * 3 + 1 + line * 2) % R8.length]); return arr;
    }
    // 5-arcmin optotype: height = D·tan(5′)·MAR in mm, times the display density.
    function heightPx(distanceMm, mar, pxPerMm) { if (!(distanceMm > 0) || !(mar > 0) || !(pxPerMm > 0)) return NaN; return distanceMm * TAN5 * mar * pxPerMm; }
    function logMAR(mar) { return Math.log10(mar); }
    function acuityLabel(line, unit) { var L = CHART[line]; if (!L) return ''; return (unit === 'm' ? L.m6 : L.sn) + '  ·  ' + (L.log > 0 ? '+' : '') + L.log.toFixed(2) + ' logMAR'; }
    function duochromeLine(line) { return Math.min(6, Math.max(3, line)); }
    // sRGB transfer (IEC 61966-2-1) and Weber contrast of a grey against white.
    function eotf(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    function oetf(lin) { return lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055; }
    function weber(g) { return 1 - eotf(g); }
    // The ladder is specified in LUMINANCE: the code value for each nominal Weber
    // contrast is the sRGB encoding of (1 − C), so the rows really are ~100/50/25/12/6/3 %.
    // 8-bit output has only three steps below 3 % (g 252/253/254), hence the floor.
    var CONTRAST_C = [1, 0.5, 0.25, 0.12, 0.06, 0.03];
    function contrastLadder() { return CONTRAST_C.map(function (c) { var g = Math.round(255 * oetf(1 - c)); return { c: c, g: g, pct: Math.round(weber(g) * 100) }; }); }
    // Relative luminance of a #rrggbb through the sRGB EOTF (Rec. 709 coefficients).
    function relLum(hex) { var h = String(hex).replace('#', ''); if (h.length === 3) h = h.replace(/./g, function (c) { return c + c; }); var n = parseInt(h, 16); return 0.2126729 * eotf((n >> 16) & 255) + 0.7151522 * eotf((n >> 8) & 255) + 0.0721750 * eotf(n & 255); }
    // mulberry32: one step from a 32-bit state → [uniform in [0,1), next state].
    function rngStep(seed) { seed = (seed + 0x6D2B79F5) | 0; var z = seed; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return [((z ^ (z >>> 14)) >>> 0) / 4294967296, seed]; }
    // Colour plate mosaic: dots sampled inside the unit disc with no overlap; N is an
    // upper bound, never reached — random sequential adsorption of discs jams at
    // ~45 % coverage, which is what sets the density. A dot that would straddle the rim
    // is rejected so the rim is round where the disc meets the canvas edge.
    function sampleDots(fig, rnd) {
      var fsN = (fig.length > 1 ? 0.468 : 0.68), rMax = (0.11 * fsN) / 6, rMin = rMax * 0.40;
      var out = [], cell = rMax * 2, grid = {}, N = fig.length > 1 ? 3600 : 1800, darts = N * 10;
      for (var d = 0; d < darts && out.length < N; d++) {
        var cx = rnd(), cy = rnd(), r = rMin + rnd() * (rMax - rMin), ddx = cx - 0.5, ddy = cy - 0.5;
        if (Math.sqrt(ddx * ddx + ddy * ddy) + r > 0.5) continue;
        var gx = (cx / cell) | 0, gy = (cy / cell) | 0, hit = false;
        for (var a = -1; a <= 1 && !hit; a++) for (var b = -1; b <= 1 && !hit; b++) {
          var bk = grid[(gx + a) + ',' + (gy + b)];
          if (bk) for (var i = 0; i < bk.length; i++) { var o = bk[i], ex = cx - o.cx, ey = cy - o.cy; if (ex * ex + ey * ey < (r + o.r) * (r + o.r)) hit = true; }
        }
        if (hit) continue;
        var dot = { cx: cx, cy: cy, r: r, lvl: Math.floor(rnd() * 4) };
        out.push(dot); var k = gx + ',' + gy; (grid[k] || (grid[k] = [])).push(dot);
      }
      return out;
    }
    // Amsler grid in physical units: 20 cells of 5 mm viewed at 30 cm subtend ~1° each
    // (±10°). When the viewport cannot hold 10 cm the grid is shrunk and the distance
    // at which a cell is still 1° is reported instead.
    var AMSLER_CELL_MM = 5, AMSLER_N = 20, AMSLER_VIEW_MM = 300, DEG = Math.PI / 180;
    function amsler(pxPerMm, maxSidePx) {
      var cellPx = AMSLER_CELL_MM * pxPerMm, sidePx = cellPx * AMSLER_N, fit = true;
      if (maxSidePx > 0 && sidePx > maxSidePx) { sidePx = maxSidePx; cellPx = sidePx / AMSLER_N; fit = false; }
      var cellMm = cellPx / pxPerMm, viewMm = fit ? AMSLER_VIEW_MM : Math.round(cellMm / Math.tan(DEG));
      return { cellPx: cellPx, sidePx: sidePx, n: AMSLER_N, cellMm: cellMm, viewMm: viewMm, fit: fit,
        degPerCell: Math.atan(cellMm / viewMm) / DEG, dotPx: Math.max(1, 0.6 * pxPerMm) };
    }
    // Astigmatic clock: lower hour × 30 = minus-cylinder axis.
    function clockAxis(hour) { hour = ((hour - 1) % 12 + 12) % 12 + 1; return (hour > 6 ? hour - 6 : hour) * 30; }
    // Landolt ring: stroke and gap both 1/5 of the outer diameter, parallel-sided gap.
    function landolt(d) { var sw = d / 5; return { sw: sw, r: (d - sw) / 2, gap: sw }; }
    // Optotype spacing per ETDRS: one letter width between letters, i.e. one cap height
    // of ink gap. ink = capRatio·f, so letter-spacing = capRatio·f − side bearings.
    function letterSpacing(f, capRatio, bearingsEm) { return f * (capRatio - (bearingsEm == null ? 0.106 : bearingsEm)); }
    return { TAN5: TAN5, CHART: CHART, SLOAN: SLOAN, SLOAN_LINES: SLOAN_LINES, CONTRAST_ROWS: CONTRAST_ROWS, E_LINES: E_LINES, R4: R4, R8: R8,
      orientationArrow: orientationArrow, fixedOrientations: fixedOrientations, heightPx: heightPx, logMAR: logMAR, acuityLabel: acuityLabel, duochromeLine: duochromeLine,
      eotf: eotf, oetf: oetf, weber: weber, CONTRAST_C: CONTRAST_C, contrastLadder: contrastLadder, relLum: relLum, rngStep: rngStep, sampleDots: sampleDots,
      amsler: amsler, AMSLER_CELL_MM: AMSLER_CELL_MM, AMSLER_VIEW_MM: AMSLER_VIEW_MM, clockAxis: clockAxis, landolt: landolt, letterSpacing: letterSpacing };
  }

  return {
    DISC_DIA_MIN, DISC_DIA_MAX, DISC_DIA_DEFAULT, clampDiscDia, discDiaInput, scaleOf, fmtLen, cdr, discSize, discFovea, fmtAngle, minRadius, metricsOfEye,
    fmtStep, parseStep, clampValue, inRange, snapStep, bumpValue, normaliseInput, importField, rxLine, slots,
    SEQ, acuityStep, ID1_LONG_MM, ID1_SHORT_MM, photoScale, photoPd, centration,
    carryPxPerMm, PX_PER_MM_MIN, PX_PER_MM_MAX, DISTANCE_M_MIN, DISTANCE_M_MAX, distanceMm, distanceIn, sanePxPerMm, saneDistance,
    chartMath, chart: chartMath()
  };
});
