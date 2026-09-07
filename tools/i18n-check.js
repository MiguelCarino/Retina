#!/usr/bin/env node
/* ============================================================
   tools/i18n-check.js — the gate that catches a string the UI
   asks for and no dictionary answers.

   ci.yml already proves the four locales carry the SAME keys.
   That is parity, not coverage: all four can be missing the
   same string and the page renders English inside a Japanese
   sentence with nothing to complain. This script closes the
   other half — it reconstructs, statically, every English
   string index.html will hand to t(), and fails when a locale
   has no entry for one.

   No dependencies and no DOM library on purpose: ci.yml runs
   `node` with nothing installed, and a parser small enough to
   read is worth more here than a correct one, because the only
   selectors it must understand are the twenty in I18N_SEL.
   I18N_SEL and I18N_TITLE_SEL are read out of index.html at
   run time rather than copied here, so the app can change its
   selectors without this file silently going stale.

   WHAT A GREEN CHECK DOES NOT MEAN. It does not mean the UI is
   translated. It means every string index.html asks for has an
   entry somewhere. Four things stay out of reach:

   - desktop/i18n.js. Its STRINGS table is module-private, so
     nothing can read it and nothing here covers it.
   - Length. Nothing measures whether a translation fits its
     slot; `Estado del cristalino` overruns a 97.6 px `.duo .h`
     and passes this gate. That is manual QA: resize the desktop
     window through ~696 px and ~1010 px in each locale, where
     the exam grid falls to a 290 px column.
   - Quality. No gate knows that `Аннотация` means a text
     abstract, or that `apontador` is a pencil sharpener in
     Brazil. A wrong translation is a passing translation.
   - The dead-key warning has false negatives. A key that
     appears verbatim as a string literal anywhere in index.html
     counts as live, so 'secondary' (a comparison), 'IOP (mmHg)'
     (a PDF label) and 'right eye (OD)' (a dead function) are
     never reported. Prune by hand when touching the area.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---------- dictionaries ----------
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
require(path.join(ROOT, 'i18n.js'));
const I18N = globalThis.window.I18N;
if (!I18N) { console.error('::error file=i18n.js::i18n.js did not set window.I18N'); process.exit(1); }
const LOCALES = Object.keys(I18N);

// ---------- a very small HTML tree ----------
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const RAW  = new Set(['script','style']);

function parse(html) {
  const root = { tag:'#root', id:'', cls:new Set(), attrs:{}, children:[], parent:null, text:[] };
  let cur = root, i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(cur, html.slice(i)); break; }
    if (lt > i) pushText(cur, html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt); i = e < 0 ? html.length : e + 3; continue; }
    if (html.startsWith('<!', lt)) { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }
    const gt = findTagEnd(html, lt);
    if (gt < 0) { pushText(cur, html.slice(lt)); break; }
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase();
      let n = cur;
      while (n && n.tag !== name) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const selfClose = raw.endsWith('/');
    const m = /^([A-Za-z][-A-Za-z0-9]*)/.exec(raw);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const el = { tag, id:'', cls:new Set(), attrs:attrsOf(raw.slice(m[0].length)), children:[], parent:cur, text:[] };
    el.id = el.attrs.id || '';
    (el.attrs.class || '').split(/\s+/).filter(Boolean).forEach((c) => el.cls.add(c));
    cur.children.push(el);
    if (RAW.has(tag)) { // skip the body of <script>/<style> wholesale
      const close = html.toLowerCase().indexOf('</' + tag, i);
      i = close < 0 ? html.length : html.indexOf('>', close) + 1;
      continue;
    }
    if (!selfClose && !VOID.has(tag)) cur = el;
  }
  return root;
}
function findTagEnd(s, from) { // a '>' inside a quoted attribute is not the end
  let q = '';
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') return i;
  }
  return -1;
}
function attrsOf(s) {
  const out = {}; const re = /([:@A-Za-z_][-.:A-Za-z0-9_]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m; while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}
function pushText(el, t) { if (t.trim()) el.text.push(decode(t)); }
function decode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
          .replace(/&hellip;/g,'…').replace(/&mdash;/g,'—').replace(/&middot;/g,'·')
          .replace(/&times;/g,'×').replace(/&rarr;/g,'→');
}
function all(root, out = []) { for (const c of root.children) { out.push(c); all(c, out); } return out; }

// ---------- selector matching (descendant + compound only) ----------
function matchesCompound(el, part) {
  const re = /([.#]?)([A-Za-z0-9_-]+)/g; let m;
  while ((m = re.exec(part))) {
    if (m[1] === '.') { if (!el.cls.has(m[2])) return false; }
    else if (m[1] === '#') { if (el.id !== m[2]) return false; }
    else if (el.tag !== m[2].toLowerCase()) return false;
  }
  return true;
}
function matches(el, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let n = el.parent, k = parts.length - 2;
  while (k >= 0) {
    while (n && !matchesCompound(n, parts[k])) n = n.parent;
    if (!n) return false;
    n = n.parent; k--;
  }
  return true;
}
function qsa(root, sel) { return all(root).filter((el) => matches(el, sel)); }

// ---------- read the app's own selector lists, so this cannot drift ----------
function selList(name) {
  const m = new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(HTML);
  if (!m) { console.error(`::error file=index.html::${name} not found`); process.exit(1); }
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
const I18N_SEL = selList('I18N_SEL');
const I18N_TITLE_SEL = selList('I18N_TITLE_SEL');

// ---------- strings that are the same in every language, on purpose ----------
// One list, two jobs: it keeps this gate quiet about glyphs, unit symbols and
// product names, and it IS the do-not-translate register — anything in here is
// a decision someone made, not an oversight nobody noticed.
const INV = new Set(
  fs.readFileSync(path.join(ROOT, 'i18n-invariants.txt'), 'utf8')
    .split('\n').map((l) => l.replace(/\s+#.*$/, '').trim()).filter((l) => l && !l.startsWith('#'))
);

const doc = parse(HTML);
const want = new Map();          // key -> reason
const add = (k, why) => { if (k && k.trim() && !want.has(k)) want.set(k, why); };

// 1. every t('literal'), tf('literal', …) and T('literal') in the inline script.
//    tf() is t() with {placeholder} interpolation, so its first argument is a dictionary
//    key exactly like t()'s. Matching only t( made every tf() key look unused, which is
//    worse than a miss: the gate would report a live key as dead and invite its deletion.
//    T() is the PDF exporter's translator (P.T): same keys, and it carries the ~60 strings
//    the three exported documents draw, which no selector pass can see.
{
  const re = /(?:\bt(?:f)?|\bT|\.T)\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*[,)]/g; let m;
  while ((m = re.exec(HTML))) {
    const lit = m[1];
    const v = lit[0] === "'" ? lit.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
                             : lit.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    add(v, `t() at index.html:${HTML.slice(0, m.index).split('\n').length}`);
  }
}
// 2. the selector-driven first-text-node registry (applyLang)
for (const sel of I18N_SEL) for (const el of qsa(doc, sel)) if (el.text[0]) add(el.text[0].trim(), `I18N_SEL "${sel}"`);
// 3. title attributes the app translates
for (const sel of I18N_TITLE_SEL) for (const el of qsa(doc, sel)) if (el.attrs.title) add(el.attrs.title, `I18N_TITLE_SEL "${sel}"`);
// 4. fleet [data-i18n] leaves — key is data-i18n's value when authored, else the text
for (const el of all(doc)) {
  if ('data-i18n' in el.attrs) add((el.attrs['data-i18n'] || el.text.join(' ')).trim(), 'data-i18n leaf');
  if ('data-i18n-html' in el.attrs) add(el.attrs['data-i18n-html'], 'data-i18n-html block');
  if ('data-i18n-attr' in el.attrs) {
    for (const a of el.attrs['data-i18n-attr'].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (el.attrs[a]) add(el.attrs[a], `data-i18n-attr ${a}`);
    }
  }
}
// 5. translated <option> labels (text is rebuilt from the value attribute)
for (const opt of qsa(doc, 'select.i18n-opts option')) if (opt.attrs.value) add(opt.attrs.value, 'i18n-opts option');

// ---------- report ----------
let bad = 0;
const missing = [];
for (const [k, why] of want) {
  if (INV.has(k)) continue;
  const gone = LOCALES.filter((l) => !(k in I18N[l]));
  if (gone.length) missing.push({ k, why, gone });
}
if (missing.length) {
  bad = 1;
  console.error(`::error file=i18n.js::${missing.length} string(s) the UI asks for have no dictionary entry`);
  for (const { k, why, gone } of missing) {
    console.error(`  ${JSON.stringify(k)}\n      wanted by: ${why}\n      missing in: ${gone.join(', ')}`);
  }
}

// ---------- the double-managed guard ----------
// An element handled by BOTH appliers is translated twice, and i18n.js caches
// the ALREADY-TRANSLATED text as its English key on a non-English first load,
// freezing it in that language forever. Catch it in review, not in Japanese.
const doubles = [];
for (const el of all(doc)) {
  if (!('data-i18n' in el.attrs)) continue;
  const hit = I18N_SEL.find((s) => matches(el, s));
  if (hit) doubles.push({ el, hit });
}
if (doubles.length) {
  bad = 1;
  console.error(`::error file=index.html::${doubles.length} element(s) carry data-i18n AND match I18N_SEL — they get translated twice`);
  for (const { el, hit } of doubles) console.error(`  <${el.tag} class="${[...el.cls].join(' ')}" id="${el.id}"> also matches ${JSON.stringify(hit)}`);
}

// ---------- unused keys (warning only) ----------
// A key reached through a map — t(NAMES[m.kind]), cfg.names[st.test] — is used
// even though no t('literal') names it. Any dictionary key that appears
// verbatim as a string literal anywhere in index.html counts as live.
const literal = new Set();
{
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g; let m;
  while ((m = re.exec(HTML))) literal.add((m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
}
const dead = Object.keys(I18N[LOCALES[0]]).filter((k) => !want.has(k) && !literal.has(k));
if (dead.length) {
  console.log(`::warning file=i18n.js::${dead.length} key(s) no longer requested by index.html: ` +
    dead.slice(0, 12).map((k) => JSON.stringify(k)).join(', ') + (dead.length > 12 ? ' …' : ''));
}

console.log(`checked ${want.size} requested string(s) against ${LOCALES.length} locale(s)`);
process.exit(bad);
