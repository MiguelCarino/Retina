#!/usr/bin/env node
/* tools/unit-tests.js — Node unit tests for the pure parts of Retina's root modules.
   Run: node tools/unit-tests.js   (CI runs it; exit 1 on any failure)

   Covers what can be checked without a browser: the record shapes, the legacy
   (localStorage) → IndexedDB conversion and the data-URL codec in retina-store.js;
   the DICOM writer in retina-dicom.js (read back byte by byte: Part-10 framing, tag
   order, identity, pixel module), UID rules, the STOW reply → outbox outcome rules;
   and desktop/archive.js (token at rest, request shape) with a stubbed fetch;
   retina-inbox.js (file recognition, laterality tokens, EXIF date, the TIFF decoder
   against a libtiff-written LZW fixture) and desktop/inbox-watcher.js against a
   temporary folder (stability, links, size, impostors, untouched sources); and
   retina-clinical.js against the known answers of the 2026-10 clinical audit
   (calibration, CDR, disc–fovea, field grammar, acuity ladders, PD from photo,
   centration, screen calibration, the chart maths).
   The IndexedDB paths themselves (open, migration in the upgrade, CAS, journal
   replay) need a real browser and are exercised headlessly, not here. */
'use strict';
const path = require('path');
const assert = require('assert');
const RS = require(path.resolve(__dirname, '..', 'retina-store.js'));
const RD = require(path.resolve(__dirname, '..', 'retina-dicom.js'));
const { createArchive } = require(path.resolve(__dirname, '..', 'desktop', 'archive.js'));
const fs = require('fs'), os = require('os');

// Minimal Explicit VR LE reader for the writer's own output: checks the Part-10 framing,
// the group length, ascending tag order at every level, and returns {tag: value-bytes}.
const LONGVR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);
function readDs(b, start, end) {
  const out = new Map(); let o = start, prev = -1;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (o < end) {
    const tag = ((dv.getUint16(o, true) << 16) | dv.getUint16(o + 2, true)) >>> 0;
    const vr = String.fromCharCode(b[o + 4], b[o + 5]);
    let len, h;
    if (LONGVR.has(vr)) { len = dv.getUint32(o + 8, true); h = 12; } else { len = dv.getUint16(o + 6, true); h = 8; }
    assert.ok(tag > prev, 'tags ascend: ' + tag.toString(16) + ' after ' + prev.toString(16));
    assert.strictEqual(len % 2, 0, 'even length ' + tag.toString(16));
    prev = tag;
    const v = b.subarray(o + h, o + h + len);
    if (vr === 'SQ') {
      const items = []; let p = 0;
      while (p < v.length) {
        const iv = new DataView(v.buffer, v.byteOffset + p);
        assert.strictEqual(iv.getUint16(0, true), 0xfffe); assert.strictEqual(iv.getUint16(2, true), 0xe000);
        const il = iv.getUint32(4, true);
        items.push(readDs(v, p + 8, p + 8 + il)); p += 8 + il;
      }
      out.set(tag, { vr, items });
    } else out.set(tag, { vr, v, s: Buffer.from(v).toString('utf8').replace(/[\0 ]+$/, '') });
    o += h + len;
  }
  assert.strictEqual(o, end, 'no trailing bytes');
  return out;
}
function readPart10(bytes) {
  assert.strictEqual(Buffer.from(bytes.subarray(128, 132)).toString(), 'DICM');
  const g = readDs(bytes, 132, 132 + 12);
  const glen = new DataView(g.get(0x00020000).v.buffer, g.get(0x00020000).v.byteOffset).getUint32(0, true);
  const meta = readDs(bytes, 144, 144 + glen);
  return { meta, ds: readDs(bytes, 144 + glen, bytes.length) };
}
const S = (ds, tag) => ds.get(tag) && ds.get(tag).s;
const fixedRnd = d => { for (let i = 0; i < d.length; i++) d[i] = (i * 7 + 3) & 255; };
const studyFix = () => ({ patientName: 'Pérez^Ána', patientId: 'P-001', dob: '1980-02-03', studyUID: RD.mintUID(), studyDate: '2026-10-12',
  studyTime: '101500', studyId: 'e_1234', accession: 'ACC1', referring: 'Dr. Ref', institution: 'Clínica Ñ', institutionAddress: 'Calle 1' });

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
const fakeTx = () => { const puts = []; return { puts, objectStore: () => ({ put: r => puts.push(r) }) }; };
const b64 = bytes => 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');

(async () => {
  await test('dataUrlToBlob round-trips bytes and type', async () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 255);
    const blob = RS.dataUrlToBlob(b64(bytes));
    assert.strictEqual(blob.type, 'image/jpeg');
    assert.deepStrictEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    assert.strictEqual(RS.dataUrlToBlob('not a data url'), null);
    assert.strictEqual(RS.dataUrlToBlob(null), null);
  });

  await test('normalizeEncounter fills deep defaults and keeps unknown keys', () => {
    const r = RS.normalizeEncounter({ id: 'e_x', eyes: { OD: { marks: [{ id: 'm1', kind: 'ruler' }], img: 'data:,x' } }, extra: 1 });
    assert.strictEqual(r.extra, 1);
    assert.strictEqual(r.eyes.OD.marks.length, 1);
    assert.ok(!('img' in r.eyes.OD), 'pixels never live in a record');
    assert.deepStrictEqual(r.eyes.OS.marks, []);
    assert.strictEqual(r.eyes.OS.discDiaMm, 1.5);
    assert.strictEqual(r.enc.seriesUIDs.attOU, null);
    assert.strictEqual(r.enc.referral.includePrev, false);
    assert.deepStrictEqual(r.attachments, []);
    assert.strictEqual(r.meta.patientId, '');
    assert.strictEqual(r.patientRef, null);
  });

  await test('hasData ignores date/provider and bare samples', () => {
    assert.strictEqual(RS.hasData(RS.newEncounter({ meta: { date: '2026-10-12', provider: 'Dr' } })), false);
    assert.strictEqual(RS.hasData({ eyes: { OD: { img: 'data:,', imgSample: true } } }), false);
    assert.strictEqual(RS.hasData({ eyes: { OD: { img: 'data:,', imgSample: false } } }), true);
    assert.strictEqual(RS.hasData({ eyes: { OS: { marks: [{}] } } }), true);
    assert.strictEqual(RS.hasData({ eyes: { OS: { clinical: { dx: ' ' } } } }), false);
    assert.strictEqual(RS.hasData({ eyes: { OS: { clinical: { iop: '15' } } } }), true);
    assert.strictEqual(RS.hasData({ meta: { name: 'Ana' } }), true);
  });

  await test('legacy study converts losslessly; real images go to files, samples do not', () => {
    const img = b64([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const legacy = {
      meta: { patientId: 'P1', name: 'Ána Pérez', date: '2026-07-01', dob: '1980-01-02', provider: 'X', complaint: 'c' },
      dispense: { pdDist: '62', dom: 'OD' },
      eyes: {
        OD: { img, w: 4000, h: 3000, imgSample: false, discDiaMm: 1.7, marks: [{ id: 'm3', kind: 'disc', cx: 1, cy: 2, rx: 3, ry: 4 }], clinical: { dx: 'clear media', iop: '14' }, disp: { segHt: '20' } },
        OS: { img: 'data:image/jpeg;base64,AAAA', w: 1000, h: 1000, imgSample: true, discDiaMm: 1.5, marks: [], clinical: {}, disp: {} }
      }
    };
    const tx = fakeTx();
    const rec = RS.legacyToEncounter(legacy, tx);
    assert.ok(/^e_[0-9a-f-]{36}$/.test(rec.id));
    assert.strictEqual(tx.puts.length, 1, 'only the real image is stored');
    const f = tx.puts[0];
    assert.ok(/^f_[0-9a-f-]{36}$/.test(f.id));
    assert.strictEqual(f.state, 'filed'); assert.strictEqual(f.source, 'migrated'); assert.strictEqual(f.size, 7);
    assert.ok(f.srcSha256 === undefined, 'no null key on the unique index');
    assert.deepStrictEqual(rec.eyes.OD.imgRef, { fileId: f.id, sopUID: null, contentKey: null });
    assert.strictEqual(rec.eyes.OS.imgRef, null); assert.strictEqual(rec.eyes.OS.imgSample, true);
    assert.strictEqual(rec.eyes.OS.possibleSample, false);
    assert.strictEqual(RS.canon(RS.legacyProjection(legacy)), RS.canon(Object.assign(RS.legacyProjection(rec), { meta: legacy.meta })));
    assert.strictEqual(rec.meta.name, 'Ána Pérez'); assert.strictEqual(rec.dispense.dom, 'OD');
  });

  await test('pre-flag 1000x1000 JPEG is marked possibleSample, a flagged real one is not', () => {
    const img = b64([0xff, 0xd8, 0xff, 0xd9]);
    const a = RS.legacyToEncounter({ eyes: { OD: { img, w: 1000, h: 1000, marks: [] } } }, fakeTx());
    assert.strictEqual(a.eyes.OD.possibleSample, true);
    const b = RS.legacyToEncounter({ eyes: { OD: { img, w: 1000, h: 1000, imgSample: false, marks: [] } } }, fakeTx());
    assert.strictEqual(b.eyes.OD.possibleSample, false);
  });

  await test('asCopy gets a new id, rev 0 and a fresh DICOM identity', () => {
    const r = RS.newEncounter({ meta: { name: 'A' } }); r.rev = 7; r.enc.studyUID = '1.2.3';
    const c = RS.asCopy(r, 'journal');
    assert.notStrictEqual(c.id, r.id); assert.strictEqual(c.rev, 0); assert.strictEqual(c.enc.studyUID, null);
    assert.strictEqual(c.recovered, 'journal'); assert.strictEqual(c.meta.name, 'A');
  });

  await test('canon is key-order independent', () => {
    assert.strictEqual(RS.canon({ a: 1, b: [{ y: 1, x: 2 }] }), RS.canon({ b: [{ x: 2, y: 1 }], a: 1 }));
  });

  await test('journal and orphan writers survive a throwing storage', () => {
    const bad = { setItem() { throw new Error('QuotaExceededError'); } };
    assert.strictEqual(RS.writeJournal(bad, 'e_1', 1, {}), false);
    assert.strictEqual(RS.writeOrphan(bad, 1, {}), false);
    const mem = {}; const ok = { setItem(k, v) { mem[k] = v; } };
    assert.strictEqual(RS.writeJournal(ok, 'e_1', 3, { id: 'e_1' }), true);
    assert.strictEqual(JSON.parse(mem[RS.JOURNAL_PREFIX + 'e_1']).baseRev, 3);
  });

  await test('sha256Hex matches a known digest', async () => {
    const h = await RS.sha256Hex(new Blob([Buffer.from('abc')]));
    assert.strictEqual(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  // ---------- patients (item 2) ----------
  const P = (o) => RS.normalizePatient(Object.assign({ id: 'p_' + RS.uuid(), updated: 1 }, o));
  await test('nameKey ignores case, accents, punctuation and spacing', () => {
    assert.strictEqual(RS.nameKey('  José  PÉREZ-López '), 'jose perez lopez');
    assert.strictEqual(RS.nameKey('Müller, Anna'), RS.nameKey('muller anna'));
    assert.strictEqual(RS.nameKey('山田 太郎'), '山田 太郎');
  });

  await test('decideLink: exact links, ID conflicts ask, nothing is guessed', () => {
    const ana = P({ patientId: 'A-1', name: 'Ana Pérez', dob: '1980-01-02' });
    const bob = P({ patientId: '', name: 'Bob Ray', dob: '1990-05-05' });
    const ps = [ana, bob];
    assert.strictEqual(RS.decideLink(ps, { patientId: '', name: '' }).action, 'none');
    let d = RS.decideLink(ps, { patientId: ' a-1 ', name: 'ana perez' });
    assert.strictEqual(d.action, 'link'); assert.strictEqual(d.patient.id, ana.id);
    d = RS.decideLink(ps, { patientId: 'A-1', name: '', dob: '1980-01-02' });
    assert.strictEqual(d.action, 'link');
    d = RS.decideLink(ps, { patientId: 'A-1', name: 'Carl Other', dob: '2001-01-01' });
    assert.strictEqual(d.action, 'conflict'); assert.strictEqual(d.patient.id, ana.id);
    d = RS.decideLink(ps, { name: 'ana  PEREZ', dob: '1980-01-02' });
    assert.strictEqual(d.action, 'link', 'name + DOB without the ID still finds a patient who has one'); assert.strictEqual(d.patient.id, ana.id);
    assert.strictEqual(RS.decideLink(ps, { patientId: 'X-5', name: 'Ana Pérez', dob: '1980-01-02' }).action, 'create', 'a different ID is a different patient');
    d = RS.decideLink(ps, { name: 'BOB  ray', dob: '1990-05-05' });
    assert.strictEqual(d.action, 'link'); assert.strictEqual(d.patient.id, bob.id);
    assert.strictEqual(RS.decideLink(ps, { name: 'Bob Ray' }).action, 'none', 'a name alone is not an identity: the DOB may follow');
    assert.strictEqual(RS.decideLink(ps, { name: 'New Person' }).action, 'none', 'no patient is made from a half-typed identity');
    assert.strictEqual(RS.decideLink(ps, { name: 'New Person' }, { final: true }).action, 'create', 'leaving the visit: a name alone makes a patient');
    assert.strictEqual(RS.decideLink(ps, { name: 'bob ray' }, { final: true }).action, 'none', 'leaving: a name someone already has is not guessed');
    // an ID typed on its own (the first field) links to its patient, blank is not different
    d = RS.decideLink(ps, { patientId: 'a-1', name: '', dob: '' });
    assert.strictEqual(d.action, 'link'); assert.strictEqual(d.patient.id, ana.id);
    assert.strictEqual(RS.decideLink([ana, P({ patientId: 'A-1', name: 'Other', dob: '1999-09-09' })], { patientId: 'A-1' }).action, 'none', 'ID-only, two holders: ambiguous');
    assert.strictEqual(RS.decideLink(ps, { patientId: 'Z-9', name: 'Zed' }).action, 'create');
    // a deleted patient is never linked to
    assert.strictEqual(RS.decideLink([Object.assign({}, ana, { deletedAt: 5 })], { patientId: 'A-1', name: 'Ana Pérez' }).action, 'create');
    // two patients agree: ambiguous, stays unfiled
    const twin = P({ patientId: '', name: 'Bob Ray', dob: '1990-05-05' });
    assert.strictEqual(RS.decideLink([bob, twin], { name: 'Bob Ray', dob: '1990-05-05' }).action, 'none');
  });

  await test('identityDiff tells corrections from another person', () => {
    const p = P({ patientId: 'A-1', name: 'Ana Pérez', dob: '1980-01-02' });
    assert.strictEqual(RS.identityDiff(p, { patientId: 'A-1', name: 'Ana Pérez', dob: '1980-01-02' }), 'same');
    assert.strictEqual(RS.identityDiff(p, { patientId: 'A-1', name: 'ana perez', dob: '1980-01-02' }), 'fill');
    assert.strictEqual(RS.identityDiff(p, { patientId: 'A-1', name: 'Ana Pérez', dob: '1980-02-01' }), 'fill');
    assert.strictEqual(RS.identityDiff(p, { patientId: 'A-1', name: '', dob: '' }), 'same', 'clearing a field is not a new person');
    assert.strictEqual(RS.identityDiff(p, { patientId: 'B-2', name: 'Ana Pérez' }), 'identity');
    assert.strictEqual(RS.identityDiff(p, { patientId: 'A-1', name: 'Bea Ruiz' }), 'identity');
    assert.strictEqual(RS.identityDiff(P({ name: 'Ana' }), { patientId: 'A-1', name: 'Ana' }), 'fill', 'filling a blank ID');
  });

  await test('previousVisit is the newest earlier visit, never itself or a deleted one', () => {
    const v = (date, created, extra) => Object.assign({ id: 'e_' + RS.uuid(), meta: { date, complaint: 'c' }, created }, extra);
    const a = v('2026-01-01', 1), b = v('2026-03-01', 2), c = v('2026-03-01', 3), d = v('2026-05-01', 4, { deletedAt: 9 }), cur = v('2026-06-01', 5);
    assert.strictEqual(RS.previousVisit([a, b, c, d, cur], cur).id, c.id);
    assert.strictEqual(RS.previousVisit([a, b, c, cur], c).id, b.id, 'same date: earlier created');
    assert.strictEqual(RS.previousVisit([a, cur], a), null);
    assert.deepStrictEqual([c, a, b].sort(RS.visitOrder).map(x => x.id), [a.id, b.id, c.id]);
  });

  await test('previousVisit skips visits with no exam and visits now naming someone else', () => {
    const pat = P({ patientId: 'A-1', name: 'Ana Perez', dob: '1980-01-02' });
    const id = { patientId: 'A-1', name: 'Ana Perez', dob: '1980-01-02' };
    const exam = RS.newEncounter({ created: 1, meta: Object.assign({ date: '2026-01-01' }, id), eyes: { OD: { clinical: { iop: '16' } }, OS: {} } });
    const blank = RS.newEncounter({ created: 2, meta: Object.assign({ date: '2026-02-01' }, id) });   // "new visit for this patient", left untouched
    const other = RS.newEncounter({ created: 3, meta: { date: '2026-03-01', patientId: 'B-2', name: 'Bruno Silva', dob: '1955-05-05' }, eyes: { OD: { clinical: { iop: '28' } }, OS: {} } });
    const cur = RS.newEncounter({ created: 4, meta: Object.assign({ date: '2026-04-01' }, id) });
    assert.strictEqual(RS.hasData(blank), true, 'identity counts as data (kept when unfiled)');
    assert.strictEqual(RS.hasExamData(blank), false, 'but it is not an exam');
    assert.strictEqual(RS.previousVisit([exam, blank, other, cur], cur, pat).id, exam.id);
    assert.strictEqual(RS.previousVisit([exam, blank, other, cur], cur).id, other.id, 'without the patient only emptiness is judged');
  });

  await test('contentCanon: a stored visit and its backup round trip compare equal', () => {
    const marks = [{ id: 'm1', kind: 'lesion', x: 1, y: 2, ltype: 'Other finding', note: '' }, { id: 'm2', kind: 'text', x: 3, y: 4, text: 'hi' },
      { id: 'm3', kind: 'arrow', x1: 1, y1: 1, x2: 2, y2: 2 }, { id: 'm4', kind: 'free', pts: [[1, 1], [2, 2]], note: '' }];
    const rec = RS.newEncounter({ meta: { date: '2026-01-01', name: 'Ana' }, eyes: { OD: { marks, clinical: { iop: '16', dx: 'x'.repeat(5000) } }, OS: {} } });
    const trip = RS.normalizeEncounter(JSON.parse(JSON.stringify(rec)));
    trip.eyes.OD.marks = trip.eyes.OD.marks.map(RS.cleanMark);
    trip.eyes.OD.clinical = RS.cleanFields(trip.eyes.OD.clinical); trip.meta = Object.assign({}, trip.meta, RS.cleanMeta(trip.meta));
    assert.strictEqual(RS.contentCanon(trip), RS.contentCanon(rec));
    assert.strictEqual(trip.eyes.OD.clinical.dx.length, 5000, 'long Observations survive in full');
    assert.strictEqual(RS.cleanMark(marks[0]).note, '', 'a lesion pin keeps its empty note');
  });

  await test('backup validation rejects absurd text, never truncates', () => {
    assert.strictEqual(RS.cleanFields({ notes: 'n'.repeat(RS.TEXT_CAP) }).notes.length, RS.TEXT_CAP);
    assert.throws(() => RS.cleanFields({ notes: 'n'.repeat(RS.TEXT_CAP + 1) }), e => e.code === 'invalid');
    assert.strictEqual(RS.cleanMeta({ complaint: 'c'.repeat(5000), name: 'n'.repeat(500) }).complaint.length, 5000);
    assert.throws(() => RS.cleanMeta({ name: 'n'.repeat(RS.SHORT_CAP + 1) }), e => e.code === 'invalid');
    assert.strictEqual(RS.cleanMark({ id: 'm9', kind: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, note: 'z'.repeat(3000) }).note.length, 3000);
  });

  await test('cleanMark keeps known shapes and rejects anything else', () => {
    assert.deepStrictEqual(RS.cleanMark({ id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: 3, ry: 4, evil: '<x>' }), { id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: 3, ry: 4 });
    assert.deepStrictEqual(RS.cleanMark({ id: 'm2', kind: 'free', pts: [[1, 2], [3, 4]], note: 'n' }), { id: 'm2', kind: 'free', pts: [[1, 2], [3, 4]], note: 'n' });
    assert.throws(() => RS.cleanMark({ id: 'm3', kind: 'script', x: 1, y: 1 }), e => e.code === 'invalid');
    assert.throws(() => RS.cleanMark({ id: 'm3', kind: 'ruler', x1: 'a', y1: 1, x2: 1, y2: 1 }), e => e.code === 'invalid');
    assert.throws(() => RS.cleanMark({ id: '"><img>', kind: 'lesion', x: 1, y: 1 }), e => e.code === 'invalid');
    assert.throws(() => RS.cleanFields({ 'bad key': '1' }), e => e.code === 'invalid');
    assert.throws(() => RS.cleanFields({ iop: { nested: 1 } }), e => e.code === 'invalid');
  });

  // ---------- backup container ----------
  const sha = async (u8) => RS.sha256Hex(new Blob([u8]));
  async function sampleBackup() {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => i);
    const fid = 'f_' + RS.uuid(), pid = 'p_' + RS.uuid();
    const h = await sha(bytes);
    const enc = RS.newEncounter({ patientRef: pid, meta: { patientId: 'A-1', name: 'Ana', date: '2026-10-01' },
      eyes: { OD: { imgRef: { fileId: fid }, w: 8, h: 8, marks: [{ id: 'm1', kind: 'ruler', x1: 0, y1: 0, x2: 4, y2: 4 }], clinical: { iop: '15', dx: 'clear media' } } } });
    enc.rev = 3;
    const manifest = { format: RS.BAK_FORMAT, version: RS.BAK_VERSION, patients: [P({ id: pid, patientId: 'A-1', name: 'Ana' })], encounters: [enc],
      files: [{ id: fid, kind: 'image', mime: 'image/png', w: 8, h: 8, sha256: h, srcSha256: h, offset: 0, length: bytes.length }] };
    return { manifest, bytes, fid, pid, enc };
  }
  await test('backup: a plain container reads back and validates', async () => {
    const s = await sampleBackup();
    const blob = RS.bakContainer(s.manifest, [s.bytes]);
    assert.strictEqual(await RS.backupKind(blob), 'plain');
    const clean = await RS.validateBackup(await RS.readBackup(blob));
    assert.strictEqual(clean.patients.length, 1); assert.strictEqual(clean.encounters.length, 1);
    assert.strictEqual(clean.encounters[0].eyes.OD.imgRef.fileId, s.fid);
    assert.strictEqual(clean.encounters[0].patientRef, s.pid);
    assert.strictEqual(clean.encounters[0].eyes.OD.clinical.dx, 'clear media');
    assert.deepStrictEqual(new Uint8Array(await clean.files[0].blob.arrayBuffer()), s.bytes);
    assert.strictEqual(RS.contentCanon(clean.encounters[0]), RS.contentCanon(RS.normalizeEncounter(s.enc)));
  });
  await test('backup: a changed byte, a bad id or a foreign file is rejected whole', async () => {
    const s = await sampleBackup();
    const bad = s.bytes.slice(); bad[10] ^= 1;
    await assert.rejects(async () => RS.validateBackup(await RS.readBackup(RS.bakContainer(s.manifest, [bad]))), e => e.code === 'invalid' && e.cause === 'file-hash');
    const m2 = JSON.parse(JSON.stringify(s.manifest)); m2.encounters[0].id = '../etc';
    await assert.rejects(async () => RS.validateBackup(await RS.readBackup(RS.bakContainer(m2, [s.bytes]))), e => e.code === 'invalid');
    const m3 = JSON.parse(JSON.stringify(s.manifest)); m3.encounters[0].eyes.OD.marks = [{ id: 'm1', kind: 'nope' }];
    await assert.rejects(async () => RS.validateBackup(await RS.readBackup(RS.bakContainer(m3, [s.bytes]))), e => e.code === 'invalid');
    await assert.rejects(() => RS.readBackup(new Blob(['PK\u0003\u0004 not a backup'])), e => e.code === 'not-backup');
    const m4 = Object.assign({}, s.manifest, { version: 99 });
    await assert.rejects(() => RS.readBackup(RS.bakContainer(m4, [s.bytes])), e => e.code === 'backup-version');
  });
  await test('backup: passphrase encryption round-trips; wrong or missing passphrase fails', async () => {
    const s = await sampleBackup();
    const plain = RS.bakContainer(s.manifest, [s.bytes]);
    const enc = await RS.encryptBackup(plain, 'correct horse');
    assert.strictEqual(await RS.backupKind(enc), 'encrypted');
    assert.ok(!Buffer.from(await enc.arrayBuffer()).includes(Buffer.from('Ana')), 'no plaintext patient data in the file');
    await assert.rejects(() => RS.readBackup(enc), e => e.code === 'need-passphrase');
    await assert.rejects(() => RS.readBackup(enc, 'wrong'), e => e.code === 'bad-passphrase');
    const clean = await RS.validateBackup(await RS.readBackup(enc, 'correct horse'));
    assert.strictEqual(clean.encounters[0].meta.name, 'Ana');
  });

  // ---------------- retina-dicom.js ----------------
  await test('mintUID: valid, at most 64 chars, never a leading zero, distinct', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const u = RD.mintUID();
      assert.ok(u.length <= 64 && RD.UID_RE.test(u), u);
      assert.ok(u.startsWith(RD.UID_ROOT + '.'));
      assert.ok(!seen.has(u)); seen.add(u);
    }
    const z = RD.mintUID(undefined, d => d.fill(0));   // all-zero randomness still gives a valid last component
    assert.ok(RD.UID_RE.test(z), z);
    assert.ok(!RD.isUID('1.2.03') && !RD.isUID('1.2.') && !RD.isUID('1.' + '2'.repeat(70)));
  });

  await test('cap() cuts UTF-8 on a code point; pn() strips PN delimiters', () => {
    assert.strictEqual(RD.cap('ÁÁÁ', 5), 'ÁÁ');
    assert.strictEqual(Buffer.byteLength(RD.cap('日本語テキスト', 64)), 21);
    assert.strictEqual(RD.cap('日本', 4), '日');
    assert.strictEqual(RD.pn('Dr. A^B=C\\D'), 'Dr. A B C D');
    assert.strictEqual(RD.da('2026-10-12'), '20261012'); assert.strictEqual(RD.da('12/10/2026'), '');
  });

  await test('Encapsulated PDF: Part-10 framing, sorted tags, identity and PDF intact', () => {
    const s = studyFix(), pdf = Buffer.from('%PDF-1.4\n%%EOF\n!');   // odd length: padded on the wire
    const sop = RD.mintUID(), ser = RD.mintUID();
    const b = RD.encapsulatedPdf({ study: s, equip: { deviceSerial: 'x' }, pdfBytes: pdf, sopUID: sop, seriesUID: ser, seriesNumber: 1, instanceNumber: 3 });
    const { meta, ds } = readPart10(b);
    assert.strictEqual(S(meta, 0x00020010), RD.TS_EXPLICIT_LE);
    assert.strictEqual(S(meta, 0x00020003), sop);
    assert.strictEqual(S(ds, 0x00080016), RD.SOP_PDF);
    assert.strictEqual(S(ds, 0x0020000D), s.studyUID);
    assert.strictEqual(S(ds, 0x00100010), 'Pérez Ána');   // typed text, one PN component: a typed ^ is not a delimiter
    assert.strictEqual(S(ds, 0x00100030), '19800203');
    assert.strictEqual(S(ds, 0x00080050), 'ACC1');
    assert.strictEqual(S(ds, 0x00080090), 'Dr. Ref');
    assert.strictEqual(S(ds, 0x00200013), '3');
    assert.strictEqual(S(ds, 0x00080080), 'Clínica Ñ');
    const doc = ds.get(0x00420011).v, len = new DataView(ds.get(0x00420015).v.buffer, ds.get(0x00420015).v.byteOffset).getUint32(0, true);
    assert.strictEqual(len, pdf.length);
    assert.deepStrictEqual(Buffer.from(doc.subarray(0, len)), pdf);
    assert.ok(!ds.has(0x00081050), 'no Performing Physician on the PDF (not in its IOD)');
    assert.ok(!ds.has(0x00200060), 'the report has no laterality');
  });

  await test('OP 8 bit: laterality, pixel module, same study, header survives JSON', () => {
    const s = studyFix(), w = 5, h = 3, rgb = new Uint8Array(w * h * 3).map((_, i) => i);   // odd pixel length: padded
    const hdr = RD.opHeader({ study: s, equip: { performing: 'Dr. López' }, sopUID: RD.mintUID(), seriesUID: RD.mintUID(), syncUID: RD.mintUID(),
      seriesNumber: 3, instanceNumber: 1, eye: 'OS', device: 'fundus', burnedIn: true, sourceMime: 'image/jpeg', sourceBytes: 20, w, h, contentAt: Date.UTC(2026, 9, 12, 9) });
    const b = RD.opFinish(JSON.parse(JSON.stringify(hdr.toJSON())), w, h, rgb);
    const { ds } = readPart10(b);
    assert.strictEqual(S(ds, 0x00080016), RD.SOP_OP8);
    assert.strictEqual(S(ds, 0x00080060), 'OP');
    assert.strictEqual(S(ds, 0x00200062), 'L'); assert.strictEqual(S(ds, 0x00200060), 'L');
    assert.strictEqual(S(ds, 0x0020000D), s.studyUID);
    assert.strictEqual(S(ds, 0x00280004), 'RGB');
    const region = ds.get(0x00082218).items[0], dev = ds.get(0x00220015).items[0];
    assert.strictEqual(S(region, 0x00080100), '5665001'); assert.strictEqual(S(dev, 0x00080100), '409898007');
    assert.strictEqual(S(ds, 0x00282110), '01'); assert.strictEqual(S(ds, 0x00282114), 'ISO_10918_1');
    assert.strictEqual(S(ds, 0x00280301), 'YES');
    assert.strictEqual(S(ds, 0x00081050), 'Dr. López');
    assert.strictEqual(S(ds, 0x0022000B), '', 'IOP is never copied into the acquisition attributes');
    const fip = ds.get(0x00280009).v; assert.deepStrictEqual([...fip], [0x18, 0x00, 0x63, 0x10]);   // (0018,1063)
    const px = ds.get(0x7FE00010).v; assert.strictEqual(px.length, 46); assert.deepStrictEqual(px.subarray(0, 45), rgb);
    const dv = new DataView(ds.get(0x00280010).v.buffer, ds.get(0x00280010).v.byteOffset);
    assert.strictEqual(dv.getUint16(0, true), h);
    assert.throws(() => RD.opHeader({ study: s, sopUID: RD.mintUID(), seriesUID: RD.mintUID(), syncUID: RD.mintUID(), eye: 'OU' }), /laterality/);
    assert.throws(() => RD.opFinish(hdr, w, h, new Uint8Array(3)), /pixel-length/);
  });

  await test('OP lossy flag: "00" only for formats that cannot be lossy; method always set with "01"', () => {
    const s = studyFix(), w = 2, h = 2, rgb = new Uint8Array(w * h * 3);
    const flag = mime => { const { ds } = readPart10(RD.opFinish(RD.opHeader({ study: s, sopUID: RD.mintUID(), seriesUID: RD.mintUID(), syncUID: RD.mintUID(),
      seriesNumber: 2, instanceNumber: 1, eye: 'OD', sourceMime: mime, sourceBytes: 4, w, h }), w, h, rgb));
      return [S(ds, 0x00282110), ds.has(0x00282114) ? S(ds, 0x00282114) : null, ds.has(0x00282112)]; };
    assert.deepStrictEqual(flag('image/png'), ['00', null, false]);
    assert.deepStrictEqual(flag('image/tiff'), ['00', null, false]);
    assert.deepStrictEqual(flag('image/bmp'), ['00', null, false]);
    assert.deepStrictEqual(flag('image/jpeg'), ['01', 'ISO_10918_1', true]);
    assert.deepStrictEqual(flag('image/webp'), ['01', 'WEBP', true]);
    assert.deepStrictEqual(flag('image/avif'), ['01', 'AVIF', true]);
    assert.deepStrictEqual(flag('image/heic'), ['01', 'ISO_23008_2', true]);
    assert.deepStrictEqual(flag(''), ['01', 'UNKNOWN', true]);   // unknown: never claimed lossless
  });

  await test('multipart body: CRLF framing around each part', () => {
    const mp = RD.multipart([new Uint8Array([1, 2]), new Uint8Array([3])], 'BND');
    const body = Buffer.concat(mp.chunks.map(c => Buffer.from(c)));
    assert.strictEqual(mp.contentType, 'multipart/related; type="application/dicom"; boundary=BND');
    assert.strictEqual(body.toString('latin1'), '--BND\r\nContent-Type: application/dicom\r\n\r\n\x01\x02\r\n--BND\r\nContent-Type: application/dicom\r\n\r\n\x03\r\n--BND--\r\n');
  });

  await test('stowOutcome: sent only when listed; each failure goes where it belongs', () => {
    const ok = { '00081199': { vr: 'SQ', Value: [{ '00081155': { vr: 'UI', Value: ['1.2.3'] } }] } };
    const warn = { '00081199': { vr: 'SQ', Value: [{ '00081155': { vr: 'UI', Value: ['1.2.3'] }, '00081196': { vr: 'US', Value: [0xB000] } }] } };
    const fail = c => ({ '00081198': { vr: 'SQ', Value: [{ '00081155': { vr: 'UI', Value: ['1.2.3'] }, '00081197': { vr: 'US', Value: [c] } }] } });
    const o = (r, u) => RD.stowOutcome(r, u || '1.2.3');
    assert.strictEqual(o({ http: 200, json: ok }).kind, 'sent');
    assert.strictEqual(o({ http: 202, json: warn }).code, 'warning');
    assert.strictEqual(o({ http: 200, json: ok }, '9.9').code, 'unknown');           // 200 without our UID
    assert.strictEqual(o({ http: 200, json: null }).code, 'unknown');
    assert.deepStrictEqual([o({ http: 409, json: fail(0xA700) }).kind, o({ http: 409, json: fail(0xA700) }).code], ['retry', 'resources']);
    assert.ok(o({ http: 409, json: fail(0xA700) }).waitMs >= 300000);
    assert.deepStrictEqual([o({ http: 409, json: fail(0xC000) }).kind, o({ http: 409, json: fail(0xC000) }).status], ['failed', 0xC000]);
    assert.strictEqual(o({ http: 401 }).kind, 'pause'); assert.strictEqual(o({ http: 403 }).kind, 'pause');
    assert.deepStrictEqual([o({ http: 429, retryAfter: 7 }).kind, o({ http: 429, retryAfter: 7 }).waitMs], ['retry', 7000]);
    assert.strictEqual(o({ http: 503 }).code, 'disabled');
    assert.strictEqual(o({ http: 502 }).code, 'server');
    assert.strictEqual(o({ http: 0, netError: 'network' }).kind, 'retry');
    assert.strictEqual(o({ http: 415, json: null }).kind, 'failed');
    // Desktop transport refusals made before any request (desktop/archive.js send()).
    assert.deepStrictEqual([o({ http: 0, code: 'no-base' }).kind, o({ http: 0, code: 'no-base' }).code], ['retry', 'no-base']);
    assert.deepStrictEqual([o({ http: 0, code: 'too-large' }).kind, o({ http: 0, code: 'too-large' }).code], ['failed', 'too-large']);
    assert.deepStrictEqual([o({ http: 0, code: 'bad-parts' }).kind, o({ http: 0, code: 'bad-parts' }).code], ['failed', 'build']);
    assert.strictEqual(o({ http: 409, json: { '0008119A': { vr: 'SQ', Value: [{ '00081197': { vr: 'US', Value: [0x0122] } }] } } }).status, 0x0122);
  });

  await test('backoff grows, caps at 30 min, honours a floor; normBase is strict', () => {
    assert.strictEqual(RD.backoff(0, 0.5), 15000);
    assert.strictEqual(RD.backoff(3, 0.5), 120000);
    assert.strictEqual(RD.backoff(20, 0.5), 1800000);
    assert.ok(RD.backoff(0, 0) >= 12000 && RD.backoff(0, 1) <= 18000);
    assert.strictEqual(RD.backoff(0, 0.5, 300000), 300000);
    assert.strictEqual(RD.normBase('http://h:8042/dicom-web/'), 'http://h:8042/dicom-web');
    assert.strictEqual(RD.normBase('ftp://h/x'), ''); assert.strictEqual(RD.normBase('http://u:p@h/x'), '');
    assert.strictEqual(RD.normBase('http://h/x?y=1'), ''); assert.strictEqual(RD.normBase('nonsense'), '');
    assert.ok(RD.isLoopbackHost('127.0.0.1') && RD.isLoopbackHost('[::1]') && RD.isLoopbackHost('localhost') && !RD.isLoopbackHost('192.168.1.2'));
  });

  // ---------------- desktop/archive.js (main-process sender) ----------------
  await test('desktop archive: token encrypted at rest, never returned, dropped on a new origin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retina-arch-')), file = path.join(dir, 'archive.json');
    const crypt = { available: () => true, encrypt: s => Buffer.from('ENC:' + Buffer.from(s).toString('hex')), decrypt: b => Buffer.from(String(b).slice(4), 'hex').toString() };
    const calls = [];
    const fetch = async (u, o) => { calls.push({ u, o });
      return { status: 200, headers: new Map([['content-type', 'application/dicom+json']]), text: async () => JSON.stringify({ '00081199': { vr: 'SQ', Value: [] } }) }; };
    let a = createArchive({ file, fetch, crypt });
    assert.deepStrictEqual(a.status(), { base: '', hasToken: false, persistent: true });
    assert.strictEqual(a.configure('javascript:alert(1)', null).error, 'bad-base');
    a.configure('http://pacs.local:8042/dicom-web/', 'secret-token');
    const disk = fs.readFileSync(file, 'utf8');
    assert.ok(!disk.includes('secret-token'), 'token not stored in clear');
    assert.ok(!JSON.stringify(a.status()).includes('secret'), 'status never carries the token');
    a = createArchive({ file, fetch, crypt });   // a restart reads it back
    assert.deepStrictEqual(a.status(), { base: 'http://pacs.local:8042/dicom-web', hasToken: true, persistent: true });
    const r = await a.send([new Uint8Array([1, 2, 3]).buffer], 1000);
    assert.strictEqual(r.http, 200); assert.ok(r.json);
    assert.strictEqual(calls[0].u, 'http://pacs.local:8042/dicom-web/studies');
    assert.strictEqual(calls[0].o.headers.Authorization, 'Bearer secret-token');
    assert.strictEqual(calls[0].o.redirect, 'error', 'a redirect must never re-post the body and token elsewhere');
    assert.ok(/^multipart\/related; type="application\/dicom"; boundary=/.test(calls[0].o.headers['Content-Type']));
    assert.ok(calls[0].o.body.includes(Buffer.from('\r\nContent-Type: application/dicom\r\n\r\n\x01\x02\x03\r\n')));
    await a.test();
    assert.strictEqual(calls[1].u, 'http://pacs.local:8042/dicom-web/studies?limit=1&includefield=0020000D');
    assert.strictEqual(calls[1].o.redirect, 'error');
    a.configure('http://other-host:8042/dicom-web', null);   // a different archive: the old token is not presented to it
    assert.strictEqual(a.status().hasToken, false);
    const noCrypt = createArchive({ file: path.join(dir, 'b.json'), fetch, crypt: { available: () => false } });
    noCrypt.configure('http://127.0.0.1:8042/dicom-web', 'tk');
    assert.deepStrictEqual(noCrypt.status(), { base: 'http://127.0.0.1:8042/dicom-web', hasToken: true, persistent: false });
    assert.ok(!fs.readFileSync(path.join(dir, 'b.json'), 'utf8').includes('tk"'), 'without OS encryption the token stays in memory');
    // Linux with no secret service: safeStorage "works" with a hard-coded key. That
    // counts as no encryption, and a token an earlier run saved that way is removed.
    const weakFile = path.join(dir, 'w.json');
    fs.writeFileSync(weakFile, JSON.stringify({ v: 1, base: 'http://127.0.0.1:8042/dicom-web', tokenEnc: crypt.encrypt('old-tk').toString('base64') }));
    const weak = createArchive({ file: weakFile, fetch, crypt: Object.assign({ weak: () => true }, crypt) });
    assert.strictEqual(weak.status().hasToken, false, 'a weakly-stored token is not used');
    assert.ok(!fs.readFileSync(weakFile, 'utf8').includes('tokenEnc":"'), 'a weakly-stored token is taken off disk');
    weak.configure('http://127.0.0.1:8042/dicom-web', 'new-tk');
    assert.deepStrictEqual(weak.status(), { base: 'http://127.0.0.1:8042/dicom-web', hasToken: true, persistent: false });
    assert.ok(!fs.readFileSync(weakFile, 'utf8').includes('tokenEnc":"'), 'and a new one stays in memory');
    // A keyring-sealed token that does not decrypt under the fallback is kept for when the keyring returns.
    const sealedFile = path.join(dir, 's.json');
    fs.writeFileSync(sealedFile, JSON.stringify({ v: 1, base: 'http://127.0.0.1:8042/dicom-web', tokenEnc: 'c2VhbGVk' }));
    createArchive({ file: sealedFile, fetch, crypt: Object.assign({}, crypt, { weak: () => true, decrypt: () => { throw new Error('v11'); } }) });
    assert.ok(fs.readFileSync(sealedFile, 'utf8').includes('c2VhbGVk'));
    const bad = await a.send(['nope'], 1);
    assert.strictEqual(bad.code, 'bad-parts');
    const down = createArchive({ file: path.join(dir, 'c.json'), fetch: async () => { throw new TypeError('fetch failed'); }, crypt });
    down.configure('http://127.0.0.1:1/dicom-web', '');
    assert.strictEqual((await down.send([new Uint8Array(2)], 1)).netError, 'network');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ============================================================
  // Inbox (item 6): retina-inbox.js and desktop/inbox-watcher.js
  // ============================================================
  const RI = require(path.resolve(__dirname, '..', 'retina-inbox.js'));
  const W = require(path.resolve(__dirname, '..', 'desktop', 'inbox-watcher.js'));
  const zlib = require('zlib'), crypto = require('crypto');
  // Minimal well-formed files of each kind.
  const JPEG = () => Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xD9]);
  const PNG = () => Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
  const PDF = () => new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'));
  // Little-endian baseline TIFF. strips: Uint8Array[] already compressed.
  function tiff(o) {
    const ents = [], extra = [];
    const add = (tag, type, vals) => ents.push({ tag, type, vals: [].concat(vals) });
    add(256, 4, o.w); add(257, 4, o.h); add(258, 3, Array(o.spp).fill(o.bps)); add(259, 3, o.comp || 1); add(262, 3, o.photo);
    add(273, 4, o.strips.map(() => 0)); add(277, 3, o.spp); add(278, 4, o.rps || o.h); add(279, 4, o.strips.map(s => s.length));
    if (o.orient) add(274, 3, o.orient);
    if (o.pred) add(317, 3, o.pred);
    if (o.cmap) add(320, 3, o.cmap);
    ents.sort((a, b) => a.tag - b.tag);
    const sz = { 3: 2, 4: 4 }, ifdOff = 8, ifdLen = 2 + ents.length * 12 + 4;
    let off = ifdOff + ifdLen;
    ents.forEach(e => { const n = e.vals.length * sz[e.type]; if (n > 4) { e.off = off; off += n + (n & 1); } });
    const dataStart = off; let p = dataStart;
    const stripOffs = o.strips.map(s => { const q = p; p += s.length; return q; });
    ents.find(e => e.tag === 273).vals = stripOffs;
    const b = Buffer.alloc(p);
    b.write('II', 0); b.writeUInt16LE(42, 2); b.writeUInt32LE(ifdOff, 4); b.writeUInt16LE(ents.length, ifdOff);
    ents.forEach((e, i) => {
      const at = ifdOff + 2 + i * 12; b.writeUInt16LE(e.tag, at); b.writeUInt16LE(e.type, at + 2); b.writeUInt32LE(e.vals.length, at + 4);
      const w = (v, q) => e.type === 3 ? b.writeUInt16LE(v, q) : b.writeUInt32LE(v, q);
      if (e.off) { b.writeUInt32LE(e.off, at + 8); e.vals.forEach((v, j) => w(v, e.off + j * sz[e.type])); }
      else e.vals.forEach((v, j) => w(v, at + 8 + j * sz[e.type]));
    });
    o.strips.forEach((s, i) => Buffer.from(s).copy(b, stripOffs[i]));
    return new Uint8Array(b);
  }
  const PX = (x, y) => [(x * 7 + y * 3) % 256, (x * x + y) % 256, ((x ^ y) * 5) % 256];
  function rgbRows(w, h) { const a = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(PX(x, y), (y * w + x) * 3); return a; }
  function checkPx(r, w, h) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, e = PX(x, y); if (r.data[i] !== e[0] || r.data[i + 1] !== e[1] || r.data[i + 2] !== e[2] || r.data[i + 3] !== 255) return 'pixel ' + x + ',' + y; } return null; }
  const packbitsLiteral = u => { const out = []; for (let i = 0; i < u.length; i += 128) { const c = u.subarray(i, i + 128); out.push(c.length - 1, ...c); } return Uint8Array.from(out); };

  await test('inbox: sniff and inspect judge files by their bytes, and folder files by name too', () => {
    assert.strictEqual(RI.sniff(JPEG()), 'jpeg'); assert.strictEqual(RI.sniff(PNG()), 'png'); assert.strictEqual(RI.sniff(PDF()), 'pdf');
    assert.strictEqual(RI.sniff(new Uint8Array(Buffer.from('hello, this is text'))), null);
    assert.deepStrictEqual(RI.inspect(JPEG(), 'IMG_1.JPG', { strictExt: true }), { ok: true, kind: 'jpeg', mime: 'image/jpeg' });
    assert.strictEqual(RI.inspect(JPEG(), 'report.pdf', { strictExt: true }).reason, 'type-mismatch', 'a JPEG named .pdf is refused, not guessed at');
    assert.strictEqual(RI.inspect(JPEG(), 'report.pdf').ok, true, 'a hand-picked file is judged by its bytes');
    assert.strictEqual(RI.inspect(new Uint8Array(Buffer.from('notes notes notes')), 'notes.txt').reason, 'type');
    assert.strictEqual(RI.inspect(JPEG().slice(0, 18), 'a.jpg', { strictExt: true }).reason, 'incomplete', 'a JPEG without its end marker is still being written');
    assert.strictEqual(RI.inspect(PDF().slice(0, 20), 'a.pdf').reason, 'incomplete');
    assert.strictEqual(RI.inspect(PNG().slice(0, 12), 'a.png').reason, 'incomplete');
    assert.strictEqual(RI.inspect(new Uint8Array(0), 'a.png').reason, 'empty');
    assert.strictEqual(RI.isWatchedName('scan.TIFF'), true); assert.strictEqual(RI.isWatchedName('.hidden.jpg'), false); assert.strictEqual(RI.isWatchedName('~$tmp.pdf'), false);
    assert.strictEqual(RI.isWatchedName('db.dat'), false);
  });

  await test('inbox: laterality is a suggestion from whole tokens, null when unsure', () => {
    const cases = { 'IMG_0012_OD.jpg': 'OD', 'informe_izquierdo.pdf': 'OS', 'scan_0001.jpg': null, 'fundusRight2.png': 'OD', 'OD1.tif': 'OD',
      'DSC_L001.JPG': 'OS', 'OD_OS_compare.pdf': null, 'ambos ojos.pdf': 'OU', 'retina_le.jpg': null, 'dir_scan.jpg': null, 'ao_report.pdf': null,
      '右眼底.jpg': 'OD', '眼底_左.jpg': 'OS', 'левый.png': 'OS', 'olho_direito.jpg': 'OD', 'Left eye.bmp': 'OS', 'oct-R.pdf': 'OD', 'Ojo Derecho.jpg': 'OD',
      'report.pdf': null, 'Lisa_Ramos.jpg': null };
    for (const [n, want] of Object.entries(cases)) assert.strictEqual(RI.guessEye(n), want, n);
  });

  await test('inbox: EXIF DateTimeOriginal is read from a JPEG, and only that tag', () => {
    // APP1 Exif → TIFF header → IFD0 {ExifIFD ptr} → Exif IFD {0x9003 ASCII[20]}
    const t = Buffer.alloc(8 + 18 + 18 + 20);
    t.write('II', 0); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
    t.writeUInt16LE(1, 8); t.writeUInt16LE(0x8769, 10); t.writeUInt16LE(4, 12); t.writeUInt32LE(1, 14); t.writeUInt32LE(26, 18); t.writeUInt32LE(0, 22);
    t.writeUInt16LE(1, 26); t.writeUInt16LE(0x9003, 28); t.writeUInt16LE(2, 30); t.writeUInt32LE(20, 32); t.writeUInt32LE(44, 36); t.writeUInt32LE(0, 40);
    t.write('2026:10:12 09:41:07\0', 44, 'latin1');
    const app1 = Buffer.concat([Buffer.from([0xFF, 0xE1]), Buffer.from([0, 0]), Buffer.from('Exif\0\0', 'latin1'), t]);
    app1.writeUInt16BE(app1.length - 2, 2);
    const jpg = new Uint8Array(Buffer.concat([Buffer.from([0xFF, 0xD8]), app1, Buffer.from([0xFF, 0xDA, 0, 2, 0xFF, 0xD9])]));
    assert.strictEqual(RI.exifDate(jpg), '2026:10:12 09:41:07');
    assert.strictEqual(RI.exifDate(JPEG()), null);
    assert.strictEqual(RI.exifDate(jpg.slice(0, 40)), null, 'a damaged block reads as no date, not an error');
  });

  await test('inbox: TIFF decodes uncompressed, PackBits, Deflate+predictor and libtiff LZW exactly', async () => {
    const w = 37, h = 11, raw = rgbRows(w, h);
    let r = await RI.decodeTiff(tiff({ w, h, spp: 3, bps: 8, photo: 2, strips: [raw.slice(0, w * 3 * 6), raw.slice(w * 3 * 6)], rps: 6 }));
    assert.strictEqual(checkPx(r, w, h), null, 'uncompressed, two strips');
    r = await RI.decodeTiff(tiff({ w, h, spp: 3, bps: 8, photo: 2, comp: 32773, strips: [packbitsLiteral(raw)] }));
    assert.strictEqual(checkPx(r, w, h), null, 'PackBits');
    const diff = raw.slice(); for (let y = 0; y < h; y++) for (let x = w - 1; x > 0; x--) for (let c = 0; c < 3; c++) { const i = (y * w + x) * 3 + c; diff[i] = (raw[i] - raw[i - 3]) & 255; }
    r = await RI.decodeTiff(tiff({ w, h, spp: 3, bps: 8, photo: 2, comp: 8, pred: 2, strips: [new Uint8Array(zlib.deflateSync(diff))] }));
    assert.strictEqual(checkPx(r, w, h), null, 'Deflate with horizontal predictor');
    // Written by libtiff (Pillow), with enough codes to pass 9→12 bits and a Clear.
    const lz = new Uint8Array(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'lzw-rgb-64x48.tif')));
    r = await RI.decodeTiff(lz);
    assert.strictEqual(r.w, 64); assert.strictEqual(checkPx(r, 64, 48), null, 'LZW');
    // 4-bit palette: indices index the colour map (16-bit entries)
    const cm = []; for (let c = 0; c < 3; c++) for (let i = 0; i < 16; i++) cm.push(((i * (c + 1) * 16) & 255) * 257);
    r = await RI.decodeTiff(tiff({ w: 2, h: 1, spp: 1, bps: 4, photo: 3, cmap: cm, strips: [Uint8Array.from([0x3A])] }));
    assert.deepStrictEqual([...r.data.slice(0, 8)], [48, 96, 144, 255, 160, 64, 224, 255]);
  });

  await test('inbox: a Deflate TIFF strip is read only up to its expected size (no decompression bomb)', async () => {
    // 10x10 grey: 100 bytes expected; the strip inflates to 64 MB of zeros.
    const bomb = new Uint8Array(zlib.deflateSync(Buffer.alloc(64 * 1048576), { level: 9 }));
    const m0 = process.memoryUsage().arrayBuffers;
    const r = await RI.decodeTiff(tiff({ w: 10, h: 10, spp: 1, bps: 8, photo: 1, comp: 8, strips: [bomb] }));
    assert.strictEqual(r.w, 10); assert.strictEqual(r.data[0], 0);
    assert.ok(process.memoryUsage().arrayBuffers - m0 < 16 * 1048576, 'the 64 MB were never held');
  });

  await test('inbox: unsupported TIFFs say why; a truncated TIFF is incomplete', async () => {
    const w = 4, h = 4, raw = rgbRows(w, h);
    await assert.rejects(RI.decodeTiff(tiff({ w, h, spp: 3, bps: 8, photo: 2, comp: 7, strips: [raw] })), e => e.code === 'unsupported' && e.detail === 'jpeg-in-tiff');
    await assert.rejects(RI.decodeTiff(tiff({ w, h, spp: 3, bps: 8, photo: 6, strips: [raw] })), e => e.code === 'unsupported' && /^photometric/.test(e.detail));
    await assert.rejects(RI.decodeTiff(tiff({ w, h, spp: 3, bps: 32, photo: 2, strips: [raw] })), e => e.code === 'unsupported');
    const ok = tiff({ w, h, spp: 3, bps: 8, photo: 2, strips: [raw] });
    assert.strictEqual(RI.complete('tiff', ok), true);
    assert.strictEqual(RI.inspect(ok.slice(0, ok.length - 5), 'x.tif').reason, 'incomplete');
    const big = Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(RI.inspect(big, 'x.tif').reason, 'bigtiff');
  });

  await test('inbox: a filed device report is an Encapsulated PDF with Image Laterality, never series Laterality', () => {
    const s = studyFix(), pdf = PDF();
    for (const [lat, want] of [['L', 'L'], ['R', 'R'], ['B', 'B'], [null, undefined]]) {
      const b = RD.encapsulatedPdf({ study: s, pdfBytes: pdf, sopUID: RD.mintUID(), seriesUID: RD.mintUID(), seriesNumber: 5, instanceNumber: 1,
        title: 'informe_izquierdo.pdf', seriesDescription: 'Device report OS', laterality: lat });
      const { ds } = readPart10(b);
      assert.strictEqual(S(ds, 0x00200062), want, 'Image Laterality ' + lat);
      assert.ok(!ds.has(0x00200060), 'Laterality (0020,0060) is not in the Encapsulated PDF IOD');
      assert.strictEqual(S(ds, 0x00420010), 'informe_izquierdo.pdf');
      assert.strictEqual(S(ds, 0x00200011), '5');
    }
  });

  await test('inbox: the tracker takes a file only after two equal looks stableMs apart', () => {
    const tr = RI.createTracker({ stableMs: 3000 });
    assert.strictEqual(tr.observe('a.jpg', 10, 1, 0), 'wait');
    assert.strictEqual(tr.observe('a.jpg', 20, 2, 1000), 'wait', 'grew: starts over');
    assert.strictEqual(tr.observe('a.jpg', 20, 2, 3500), 'wait', 'not yet 3 s since the change');
    assert.strictEqual(tr.observe('a.jpg', 20, 2, 4000), 'ready');
    tr.done('a.jpg');
    assert.strictEqual(tr.observe('a.jpg', 20, 2, 9000), 'done', 'delivered once');
    assert.strictEqual(tr.observe('a.jpg', 21, 3, 9000), 'wait', 'changed content is looked at again');
    tr.keepOnly(new Set()); assert.strictEqual(tr.pending(), 0);
  });

  await test('inbox: filing places a picture as the eye\'s own only when it has none, else in its gallery', () => {
    const rec = RS.newEncounter({ eyes: { OD: { imgSample: true }, OS: { imgSample: true, marks: [{ id: 'm1', kind: 'text', x: 1, y: 1, text: 'practice' }] } } });
    const f = (id, kind) => ({ id, kind: kind || 'image', w: 640, h: 480 });
    assert.strictEqual(RS.placeIntoEncounter(rec, f('f_1'), 'OD'), 'active');
    assert.deepStrictEqual([rec.eyes.OD.imgRef.fileId, rec.eyes.OD.imgSample, rec.eyes.OD.w], ['f_1', false, 640]);
    assert.strictEqual(RS.placeIntoEncounter(rec, f('f_1'), 'OD'), 'already');
    assert.strictEqual(RS.placeIntoEncounter(rec, f('f_2'), 'OD'), 'gallery');
    assert.strictEqual(RS.placeIntoEncounter(rec, f('f_3'), 'OS'), 'gallery', 'marks drawn on a sample are never moved onto a photo');
    assert.strictEqual(rec.eyes.OS.imgRef, null);
    assert.deepStrictEqual(rec.eyes.OD.gallery[0].marks, []);
    assert.strictEqual(RS.placeIntoEncounter(rec, f('f_4', 'pdf'), 'OU'), 'attachment');
    assert.deepStrictEqual(rec.attachments[0], { fileId: 'f_4', sopUID: null, contentKey: null, eye: 'OU' });
    assert.throws(() => RS.placeIntoEncounter(rec, f('f_5'), 'OU'), e => e.code === 'eye', 'a picture is of one eye');
    assert.throws(() => RS.placeIntoEncounter(rec, f('f_6', 'pdf'), ''), e => e.code === 'eye');
    // gallery entries survive normalisation, possibleSample included
    rec.eyes.OD.gallery[0].possibleSample = true;
    assert.strictEqual(RS.normalizeEncounter(JSON.parse(JSON.stringify(rec))).eyes.OD.gallery[0].possibleSample, true);
    // The eye's stored picture is gone: the new one re-attaches in its place, marks kept, once.
    const r2 = RS.newEncounter({ eyes: { OD: { imgRef: { fileId: 'f_gone', sopUID: null, contentKey: null }, w: 100, h: 100, marks: [{ id: 'm1', kind: 'text', x: 1, y: 1, text: 'kept' }] } } });
    const miss = { OD: true };
    assert.strictEqual(RS.placeIntoEncounter(r2, f('f_7'), 'OD', miss), 'active');
    assert.deepStrictEqual([r2.eyes.OD.imgRef.fileId, r2.eyes.OD.marks.length, r2.eyes.OD.w, r2.eyes.OD.gallery.length], ['f_7', 1, 640, 0]);
    assert.strictEqual(RS.placeIntoEncounter(r2, f('f_8'), 'OD', miss), 'gallery', 'a second picture is an additional one');
  });

  await test('inbox watcher: stable, complete files are offered once; links, oversize and impostors are not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retina-inbox-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'retina-out-'));
    let clock = 1e6;
    const offered = [], put = (rel, bytes) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), Buffer.from(bytes)); };
    // No 0xFF in the filler: the completeness check looks for FF D9 in the last 1 KB, and
    // random filler holds that pair often enough (~1.5 % of runs) to "finish" half.jpg.
    const jpg = Buffer.concat([Buffer.from(JPEG().slice(0, 20)), crypto.randomBytes(5000).map(b => b & 0x7F), Buffer.from([0xFF, 0xD9])]);
    put('IMG_0001_OD.jpg', jpg);
    put('sub/deeper/report_OS.pdf', PDF());
    put('a/b/c/d/too-deep.jpg', jpg);                              // depth 4 > maxDepth 3
    put('notes.txt', Buffer.from('hello'));
    put('fake.pdf', JPEG());                                       // a JPEG called .pdf
    put('half.jpg', jpg.subarray(0, 3000));                        // still being written
    put('big.png', Buffer.alloc(2048, 1));
    fs.writeFileSync(path.join(out, 'secret.jpg'), jpg);
    fs.symlinkSync(path.join(out, 'secret.jpg'), path.join(dir, 'link.jpg'));   // a link to a file outside
    fs.symlinkSync(out, path.join(dir, 'linkdir'));                              // a link to a folder outside
    const before = {};
    const walk = (d, r) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name), rr = r + '/' + e.name;
      if (e.isSymbolicLink()) return; if (e.isDirectory()) walk(p, rr); else { const st = fs.statSync(p); before[rr] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + ':' + st.mtimeMs + ':' + st.size; } });
    walk(dir, ''); walk(out, '');
    const wt = W.createWatcher({ root: dir, lib: RI, stableMs: 3000, maxBytes: 1024, now: () => clock, onFile: m => offered.push(m) });
    await wt.scan();
    assert.strictEqual(offered.length, 0, 'nothing on the first look: not yet known to be stable');
    clock += 1000; await wt.scan(); assert.strictEqual(offered.length, 0);
    // the camera keeps writing half.jpg
    fs.appendFileSync(path.join(dir, 'half.jpg'), jpg.subarray(3000, 4000));
    clock += 2500; await wt.scan();
    assert.deepStrictEqual(offered.map(o => o.relPath).sort(), ['sub/deeper/report_OS.pdf'], 'maxBytes is 1 KB here: only the small PDF fits');
    const st0 = wt.status();
    assert.ok(st0.skipped.some(s => s.relPath === 'IMG_0001_OD.jpg' && s.reason === 'too-large'));
    wt.stop();
    // Again with a realistic limit (a new watcher: the folder as a later launch sees it).
    offered.length = 0;
    const w2 = W.createWatcher({ root: dir, lib: RI, stableMs: 3000, now: () => clock, onFile: m => offered.push(m) });
    await w2.scan(); clock += 3000; await w2.scan();
    const rels = offered.map(o => o.relPath).sort();
    assert.deepStrictEqual(rels, ['IMG_0001_OD.jpg', 'sub/deeper/report_OS.pdf'], 'links, .txt, depth 4, impostor, unfinished: none offered');
    const st = w2.status(), why = Object.fromEntries(st.skipped.map(s => [s.relPath, s.reason]));
    assert.strictEqual(why['fake.pdf'], 'type-mismatch'); assert.strictEqual(why['half.jpg'], 'incomplete'); assert.strictEqual(why['big.png'], 'type');
    assert.ok(!('link.jpg' in why) && !rels.some(r => /secret|linkdir/.test(r)), 'a symlink is never followed, not even to report it');
    const od = offered.find(o => o.relPath === 'IMG_0001_OD.jpg');
    assert.strictEqual(od.sha256, crypto.createHash('sha256').update(jpg).digest('hex'));
    assert.strictEqual(od.kind, 'jpeg'); assert.ok(!('bytes' in od), 'metadata only: bytes are asked for by id');
    clock += 30000; await w2.scan(); assert.strictEqual(offered.length, 2, 'offered once');
    // the unfinished file completes: offered after it is stable again
    fs.appendFileSync(path.join(dir, 'half.jpg'), jpg.subarray(4000));
    await w2.scan(); clock += 3100; await w2.scan();
    assert.ok(offered.some(o => o.relPath === 'half.jpg'), 'a completed file is offered');
    assert.deepStrictEqual(Buffer.from(await w2.read(od.id)), jpg, 'read(id) returns exactly the hashed bytes');
    await assert.rejects(w2.read('nope'), e => e.code === 'unknown');
    // a file swapped for a link after it was offered is refused
    fs.renameSync(path.join(dir, 'IMG_0001_OD.jpg'), path.join(out, 'moved.jpg'));
    fs.symlinkSync(path.join(out, 'secret.jpg'), path.join(dir, 'IMG_0001_OD.jpg'));
    await assert.rejects(w2.read(od.id), e => e.code === 'link' || e.code === 'changed');
    fs.unlinkSync(path.join(dir, 'IMG_0001_OD.jpg')); fs.renameSync(path.join(out, 'moved.jpg'), path.join(dir, 'IMG_0001_OD.jpg'));
    // "only new from now": a snapshot of what is there is skipped
    const snapP = W.snapshot(dir, RI);
    assert.ok(snapP instanceof Promise, 'the baseline walk is asynchronous: it runs on the main process');
    const snap = await snapP;
    assert.ok(snap['IMG_0001_OD.jpg'] && !snap['link.jpg'] && !snap['notes.txt']);
    const seen3 = [], w3 = W.createWatcher({ root: dir, lib: RI, stableMs: 0, ignore: snap, now: () => clock, onFile: m => seen3.push(m.relPath) });
    put('new_OS.jpg', jpg); await w3.scan(); clock += 10; await w3.scan();
    assert.deepStrictEqual(seen3, ['new_OS.jpg']);
    w2.stop(); w3.stop();
    // nothing in the folder (or outside it) was changed by any of this
    const after = {}; const walk2 = (d, r) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name), rr = r + '/' + e.name;
      if (e.isSymbolicLink()) return; if (e.isDirectory()) walk2(p, rr); else { const st2 = fs.statSync(p); after[rr] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + ':' + st2.mtimeMs + ':' + st2.size; } });
    walk2(dir, ''); walk2(out, '');
    delete after['/half.jpg']; delete before['/half.jpg']; delete after['/new_OS.jpg'];   // the test itself wrote these
    assert.deepStrictEqual(after, before, 'source files untouched');
    assert.strictEqual(W.overlaps('/home/u/Downloads', '/home/u/Downloads/cam'), true);
    assert.strictEqual(W.overlaps('/home/u', '/home/u/Downloads'), true);
    assert.strictEqual(W.overlaps('/home/u/Down', '/home/u/Downloads'), false);
    assert.strictEqual(W.overlaps('/', '/home/u/Downloads'), true, 'a filesystem root contains everything');
    assert.strictEqual(W.overlaps('/Users/U/downloads', '/Users/u/Downloads', 'darwin'), true, 'case-insensitive where the filesystem is');
    assert.strictEqual(W.overlaps('/home/U/downloads', '/home/u/Downloads', 'linux'), false);
    // the root is resolved by the same (native) realpath as each file
    assert.strictEqual(wt.root, fs.realpathSync.native(dir));
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
  });

  await test('inbox watcher: an unreadable subfolder does not cost the "only new" baseline', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retina-inbox-'));
    const jpg = Buffer.concat([Buffer.from(JPEG().slice(0, 20)), crypto.randomBytes(500), Buffer.from([0xFF, 0xD9])]);
    fs.mkdirSync(path.join(dir, 'share')); fs.writeFileSync(path.join(dir, 'share', 'old_OD.jpg'), jpg);
    const snap = await W.snapshot(dir, RI);
    assert.ok(snap['share/old_OD.jpg']);
    let clock = 1e6, gone = false;
    const real = fs.readdirSync;
    // A share that drops for a moment: readdir of the subfolder fails.
    const realP = fs.promises.readdir;
    const fake = Object.assign({}, fs, { readdirSync: (d, o) => { if (gone && /share$/.test(d)) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return real(d, o); },
      promises: Object.assign({}, fs.promises, { readdir: async (d, o) => { if (gone && /share$/.test(d)) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return realP(d, o); } }) });
    fake.realpathSync = fs.realpathSync;
    const seen = [], w = W.createWatcher({ root: dir, lib: RI, fs: fake, stableMs: 0, ignore: snap, now: () => clock, onFile: m => seen.push(m.relPath) });
    gone = true; await w.scan(); clock += 10; await w.scan();
    gone = false; await w.scan(); clock += 10; await w.scan();
    assert.deepStrictEqual(seen, [], 'the old file is still left alone when the share is back');
    w.stop(); fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---- item 7: privacy-notice template and the PDF fonts ----
  const AV = require(path.resolve(__dirname, '..', 'retina-aviso.js'));
  await test('aviso: every LFPDPPP art. 15 element, sensitive data, express written consent', () => {
    const a = AV.sections({ legalName: 'Ejemplo S.C.', practiceName: 'Óptica Ejemplo', address: 'Calle 1, Puebla', privacyEmail: 'p@e.example', privacyContact: 'Dra. X' }, { generated: '12/10/2026' });
    const txt = JSON.stringify(a);
    for (const s of ['Identidad y domicilio del responsable', 'Datos personales sensibles', 'Finalidades primarias', 'Finalidades secundarias',
      'consentimiento expreso y por escrito', 'artículo 8', 'derechos ARCO', 'artículo 28', 'veinte días hábiles', 'Limitación del uso o divulgación',
      'Cambios al aviso de privacidad', 'artículo 36, fracción II', 'Secretaría Anticorrupción y Buen Gobierno', 'el proveedor del software no recibe datos',
      'Ejemplo S.C.', 'nombre comercial: Óptica Ejemplo', 'Calle 1, Puebla', 'p@e.example', 'Dra. X', 'plantilla generada el 12/10/2026'])
      assert.ok(txt.includes(s), 'missing: ' + s);
    assert.strictEqual(a.banner, 'Plantilla — revise con su asesor legal antes de usarla');
    assert.ok(!/carino/i.test(txt), 'the software maker is never named');
    assert.ok(a.sections.some(x => x.blocks.some(b => b.sign)), 'a signature block for the written consent');
  });
  await test('aviso: missing brand values print as marked blanks, never as empty text', () => {
    const a = AV.sections({}, {}), txt = JSON.stringify(a);
    for (const s of ['[COMPLETAR: nombre o razón social del responsable]', '[COMPLETAR: domicilio completo del responsable]',
      '[COMPLETAR: correo electrónico para datos personales]', '[COMPLETAR: persona o departamento de datos personales]'])
      assert.ok(txt.includes(s), 'missing: ' + s);
    assert.ok(!/con domicilio en ,|al correo ,|undefined|null/.test(txt));
  });
  // pdf-lib's fontkit subsetter writes a small subset with the SHORT loca format (offset/2)
  // after copying glyphs byte for byte: an odd glyph offset in the source font becomes a
  // blank glyph in every Japanese PDF. tools/build-pdf-fonts.py pads them; keep it so.
  await test('PDF fonts: every glyph starts at an even offset', () => {
    for (const f of fs.readdirSync(path.resolve(__dirname, '..', 'fonts', 'pdf')).filter(n => /\.ttf$/.test(n))) {
      const b = fs.readFileSync(path.resolve(__dirname, '..', 'fonts', 'pdf', f)), n = b.readUInt16BE(4), tab = {};
      for (let i = 0; i < n; i++) { const o = 12 + i * 16; tab[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }; }
      const long = b.readInt16BE(tab.head.off + 50) === 1, L = tab.loca;
      let odd = 0;
      if (long) for (let o = L.off; o < L.off + L.len; o += 4) odd += b.readUInt32BE(o) & 1;
      assert.strictEqual(odd, 0, f + ': ' + odd + ' glyphs at odd offsets');
    }
  });

  // ============================================================
  // retina-clinical.js — known answers from the 2026-10 clinical audit. Every value
  // here is the CORRECTED one; where the audit found a defect the old output is named
  // in a comment so nobody "fixes" the test back.
  // ============================================================
  const RC = require(path.resolve(__dirname, '..', 'retina-clinical.js'));
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol == null ? 1e-9 : tol), (msg || '') + ' expected ' + b + ' got ' + a);
  const eyeOf = (marks, dia, extra) => Object.assign({ discDiaMm: dia == null ? 1.5 : dia, marks }, extra || {});
  const DISC = (rx, ry, cx, cy) => ({ kind: 'disc', cx: cx == null ? 500 : cx, cy: cy == null ? 500 : cy, rx, ry });
  const CUP = (rx, ry, cx, cy) => ({ kind: 'cup', cx: cx == null ? 500 : cx, cy: cy == null ? 500 : cy, rx, ry });
  const DC = (x, y) => ({ kind: 'disc-center', x, y }), FOV = (x, y) => ({ kind: 'fovea-center', x, y });
  // The app's own sample fundus (makeSampleFundus S=1000, R=492), OD and its OS mirror.
  const SAMPLE_OD = [DISC(50.92, 56.58, 706.64, 485.24), CUP(20.91, 23.76, 706.64, 485.24), DC(706.64, 485.24), FOV(431.12, 509.84)];
  const SAMPLE_OS = [DISC(50.92, 56.58, 293.36, 485.24), CUP(20.91, 23.76, 293.36, 485.24), DC(293.36, 485.24), FOV(568.88, 509.84)];

  await test('clinical: disc-diameter calibration (mm/px), lengths and the chip clamp', () => {
    assert.strictEqual(RC.scaleOf(DISC(50, 50), 1.5), 0.015);
    assert.strictEqual(RC.fmtLen(200, 0.015), '3.00 mm');
    assert.strictEqual(RC.fmtLen(4 * 50, RC.scaleOf(DISC(50, 50), 1.5)), '3.00 mm', '2 DD = 3.00 mm (ETDRS 1 DD = 1500 µm)');
    assert.strictEqual(RC.fmtLen(2 * 50, RC.scaleOf(DISC(50, 50), 1.5)), '1.50 mm');
    near(RC.scaleOf(DISC(50, 60), 1.8), 0.015);
    assert.strictEqual(RC.scaleOf(DISC(40, 80), 1.6), 0.01, 'only ry calibrates');
    // Uncalibrated: no disc, a zero or NEGATIVE semi-axis (was: a signed scale → '-0.30 mm')
    assert.strictEqual(RC.scaleOf(null, 1.5), null);
    assert.strictEqual(RC.scaleOf(DISC(40, 0), 1.5), null);
    assert.strictEqual(RC.scaleOf(DISC(200, -250), 1.5), null);
    assert.strictEqual(RC.scaleOf(DISC(50, 50), 0), null);
    assert.strictEqual(RC.scaleOf(DISC(50, 50), NaN), null);
    assert.strictEqual(RC.fmtLen(500, null), '500 px'); assert.strictEqual(RC.fmtLen(10.4, null), '10 px'); assert.strictEqual(RC.fmtLen(10.5, null), '11 px');
    assert.strictEqual(RC.fmtLen(NaN, null), '');
    // every mm figure scales linearly with the chip
    near(RC.scaleOf(DISC(50, 50), 3.0), 2 * RC.scaleOf(DISC(50, 50), 1.5));
    // store semantics: falsy → default, otherwise clamped 0.5–4
    assert.deepStrictEqual([0, 0.2, 10, 'abc', -2, 0.96, 2.91, 1.92, null].map(RC.clampDiscDia), [1.5, 0.5, 4, 1.5, 0.5, 0.96, 2.91, 1.92, 1.5]);
    // typed chip: a parseable value is clamped (was: '-2' → -0.0040 mm/px, '' → 1.5 silently)
    assert.strictEqual(RC.discDiaInput('-2', 1.5), 0.5);
    assert.strictEqual(RC.discDiaInput('0', 1.5), 0.5);
    assert.strictEqual(RC.discDiaInput('25', 1.5), 4);
    assert.strictEqual(RC.discDiaInput('1,8', 1.5), 1.8);
    assert.strictEqual(RC.discDiaInput('', 1.7), 1.7, 'empty keeps the previous value');
    assert.strictEqual(RC.discDiaInput('abc', 2), 2);
    assert.strictEqual(RC.discDiaInput(undefined, undefined), 1.5);
    assert.strictEqual(RC.minRadius(0.3), 10, '3 screen px at fit zoom');
    assert.strictEqual(RC.minRadius(1), 3); assert.strictEqual(RC.minRadius(0), 3);
  });

  await test('clinical: cup-to-disc ratios, with the impossible ones flagged and withheld', () => {
    let r = RC.cdr(DISC(100, 110), CUP(60, 33));
    near(r.v, 0.3); near(r.h, 0.6); assert.strictEqual(r.flag, null);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(300, 300), CUP(200, 200)])).verticalCDR, 0.67, '2 dp, not 0.667');
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(150, 150), CUP(50, 50)])).verticalCDR, 0.33, 'was 0.333 in documents');
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), CUP(61.7, 61.7)])).verticalCDR, 0.62, 'one value for screen and documents (was 0.617)');
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), CUP(100, 100)])).verticalCDR, 1, 'the upper bound of a valid CDR');
    r = RC.cdr(DISC(100, 100), CUP(70, 70)); near(r.v, 0.7); assert.strictEqual(r.flag, null, 'no suspect threshold is applied');
    // cup larger than the disc (was: '1.20' printed as a measurement)
    r = RC.cdr(DISC(100, 100), CUP(100, 120)); near(r.v, 1.2); assert.strictEqual(r.flag, 'over');
    let m = RC.metricsOfEye(eyeOf([DISC(100, 100), CUP(100, 120)]));
    assert.strictEqual(m.verticalCDR, null); assert.strictEqual(m.horizontalCDR, null); assert.strictEqual(m.cdrFlag, 'over');
    assert.strictEqual(RC.cdr(DISC(80, 80), CUP(80, 100)).flag, 'over', '100/80 is never printed as 1.25');
    // cup centre outside the disc (was: centre-independent, 0.50 from non-overlapping ellipses)
    r = RC.cdr(DISC(100, 100), CUP(50, 50, 1000, 500)); near(r.v, 0.5); assert.strictEqual(r.flag, 'outside');
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), CUP(50, 50, 1000, 500)])).verticalCDR, null);
    assert.strictEqual(RC.cdr(DISC(100, 100), CUP(50, 50, 560, 520)).flag, null, 'a decentred cup inside the disc is fine');
    // per-axis, never swapped; calibration-independent
    r = RC.cdr(DISC(100, 80), CUP(50, 20)); near(r.v, 0.25); near(r.h, 0.5);
    const a = RC.metricsOfEye(eyeOf([DISC(80, 100), CUP(40, 60)], 1.5)), b = RC.metricsOfEye(eyeOf([DISC(80, 100), CUP(40, 60)], 1.92));
    assert.strictEqual(a.verticalCDR, 0.6); assert.strictEqual(a.horizontalCDR, 0.5); assert.strictEqual(b.verticalCDR, 0.6); assert.strictEqual(b.horizontalCDR, 0.5);
    // missing marks and degenerate radii
    assert.deepStrictEqual(RC.cdr(DISC(100, 100), null), { v: null, h: null, flag: null });
    assert.deepStrictEqual(RC.cdr(null, CUP(10, 10)), { v: null, h: null, flag: null });
    r = RC.cdr(DISC(100, 0), CUP(60, 33)); assert.strictEqual(r.v, null); near(r.h, 0.6);
    r = RC.cdr(DISC(100, 100), CUP(60, 0)); near(r.v, 0); assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), CUP(60, 0)])).verticalCDR, 0);
    assert.strictEqual(RC.cdr(DISC(100, -100), CUP(40, 40)).v, null, 'a negative semi-axis gives no ratio (was -0.4)');
    // identity: 2·cup.ry·mmPerPx == VCDR·discDiaMm
    const s = RC.scaleOf(DISC(100, 100), 1.5); near(2 * 30 * s, RC.cdr(DISC(100, 100), CUP(30, 30)).v * 1.5);
    // IEEE half cases are documented, not "fixed": toFixed on the double
    assert.strictEqual((61.5 / 100).toFixed(2), '0.61'); assert.strictEqual((64.5 / 100).toFixed(2), '0.65');
    // sample picture: nothing is a measurement of the patient
    m = RC.metricsOfEye(eyeOf([DISC(120, 120), CUP(48, 48)], 1.5, { imgSample: true }));
    assert.strictEqual(m.verticalCDR, null); assert.strictEqual(m.mmPerPx, null); assert.strictEqual(m.sample, true);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(120, 120), CUP(48, 48)], 1.5, { possibleSample: true })).verticalCDR, null);
    assert.strictEqual(RC.metricsOfEye(null).verticalCDR, null);
  });

  await test('clinical: disc size, disc–fovea distance and the laterality-free angle', () => {
    let d = RC.discSize(DISC(100, 100), RC.scaleOf(DISC(100, 100), 1.5));
    near(d.vMm, 1.5); near(d.areaMm2, 1.7671, 1e-4);
    d = RC.discSize(DISC(60, 50), 0.015); near(d.vMm, 1.5); near(d.hMm, 1.8); near(d.areaMm2, 2.1206, 1e-4);
    d = RC.discSize(DISC(88, 96), 0.01); near(d.hMm, 1.76); near(d.areaMm2, 2.654, 1e-3, 'Jonas mean disc, ellipse model');
    d = RC.discSize(DISC(200, 250), 0.003); near(d.areaMm2, 1.4137, 1e-4);
    assert.strictEqual(RC.discSize(DISC(40, 0), null).areaPx, 0);
    assert.strictEqual(RC.discSize(null, 0.01), null);
    assert.strictEqual((2 * 7 * (1.7 / 14)).toFixed(2), '1.70', 'rounding tautology: V diameter prints the chip value');
    let m = RC.metricsOfEye(eyeOf([DISC(60, 50)], 1.5));
    assert.strictEqual(m.discDiamVMm, 1.5); assert.strictEqual(m.discDiamHMm, 1.8, 'the horizontal diameter is exported (was computed and discarded)'); assert.strictEqual(m.discAreaMm2, 2.12); assert.strictEqual(m.discDiaAssumedMm, 1.5);
    // distance
    const df = RC.discFovea(DC(0, 0), FOV(600, 80), 0.0075); near(df.px, 605.31, 0.01); near(df.mm, 4.5398, 1e-3);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), DC(0, 0), FOV(600, 80)], 1.5)).discFoveaDistMm, 4.54);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(64, 64), DC(0, 0), FOV(300, 40)], 1.92)).discFoveaDistMm, 4.54);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(50, 50), DC(0, 0), FOV(300, 0)], 1.5)).discFoveaDistMm, 4.5);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(50, 50), DC(0, 0), FOV(300, 0)], 1.8)).discFoveaDistMm, 5.4);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(50, 50), DC(0, 0), FOV(320, 0)], 1.5)).discFoveaDistMm, 4.8, 'DM:DD 3.2 (ONH screen reference)');
    near(RC.discFovea(DC(0, 0), FOV(-530, 0), RC.scaleOf(DISC(100, 100), 1.5)).mm, 3.975, 1e-9, '2.65 DD');
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(80, 90), DC(0, 0), FOV(540, 0)], 1.5)).discFoveaDistMm, 4.5);
    assert.strictEqual(RC.discFovea(DC(0, 0), FOV(300, 0), null).mm, null, 'uncalibrated: px only');
    assert.strictEqual(RC.discFovea(null, FOV(1, 1), 0.01), null);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), DC(0, 0)], 1.5)).discFoveaDistMm, null, 'no fovea');
    // angle: tilt from the horizontal, fovea below = positive, same for OD and OS
    // (was: raw atan2 → OD 175°, OS 5°, and '-0°' on a fovea fractionally above)
    const od = RC.metricsOfEye(eyeOf(SAMPLE_OD, 1.5)), os = RC.metricsOfEye(eyeOf(SAMPLE_OS, 1.5));
    assert.strictEqual(od.discFoveaAngleDeg, 5.1); assert.strictEqual(os.discFoveaAngleDeg, 5.1);
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(706.64, 485.24), FOV(431.12, 509.84), null).angle), '+5°');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(293.36, 485.24), FOV(568.88, 509.84), null).angle), '+5°');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(0, 0), FOV(100, 0), null).angle), '0°');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(0, 0), FOV(-100, 0), null).angle), '0°', 'was 180°');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(0, 0), FOV(-1000, 5.2), null).angle), '0°', 'was 180° (branch cut)');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(0, 0), FOV(-1000, -5.2), null).angle), '0°', 'was -180°');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(0, 0), FOV(100, -0.5), null).angle), '0°', 'never -0°');
    assert.strictEqual(RC.fmtAngle(RC.discFovea(DC(0, 0), FOV(100, -20), null).angle), '-11°', 'fovea above: negative');
    near(RC.discFovea(DC(0, 0), FOV(300, 40), null).angle, 7.59, 0.01);
    assert.strictEqual(RC.fmtAngle(NaN), '0°');
    const co = RC.discFovea(DC(10, 10), FOV(10, 10), 0.01); assert.strictEqual(co.px, 0); assert.strictEqual(co.mm, 0);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100), DC(10, 10), FOV(10, 10)], 1.5)).discFoveaDistMm, 0, 'coincident marks: 0, not NaN');
    assert.strictEqual(RC.metricsOfEye(eyeOf([DC(10, 10), FOV(10, 10)], 1.5)).discFoveaAngleDeg, 0, 'the angle needs no calibration');
    // the sample fundus, end to end
    assert.deepStrictEqual([od.verticalCDR, od.horizontalCDR, od.discFoveaDistMm, od.mmPerPx, od.discDiamHMm], [0.42, 0.41, 3.67, 0.01326, 1.35]);
    assert.strictEqual(RC.metricsOfEye(eyeOf(SAMPLE_OD, 1.92)).discFoveaDistMm, 4.69, 'Jonas mean disc: within the Beijing range');
    // mmPerPx: significant figures, not fixed decimals (was 0.00011 for a 7000 px disc, +2.7 %)
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(7000, 7000)], 1.5)).mmPerPx, 0.0001071);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(100, 100)], 1.5)).mmPerPx, 0.0075);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(120, 120)], 1.92)).mmPerPx, 0.008);
    assert.strictEqual(RC.metricsOfEye(eyeOf([DISC(80, 90)], 1.5)).mmPerPx, 0.008333);
    // the shape every document reads
    m = RC.metricsOfEye(eyeOf([DISC(90, 100), CUP(36, 40)], 1.5));
    assert.deepStrictEqual(m, { verticalCDR: 0.4, horizontalCDR: 0.4, cdrFlag: null, discFoveaDistMm: null, discFoveaAngleDeg: null, mmPerPx: 0.0075, discDiamVMm: 1.5, discDiamHMm: 1.35, discAreaMm2: 1.59, discDiaAssumedMm: 1.5, sample: false });
    m = RC.metricsOfEye(eyeOf([DISC(90, 100)], 1.5)); assert.strictEqual(m.verticalCDR, null); assert.strictEqual(m.mmPerPx, 0.0075);
    m = RC.metricsOfEye(eyeOf([], 1.5)); assert.strictEqual(m.mmPerPx, null); assert.strictEqual(m.discFoveaDistMm, null);
  });

  await test('clinical: field grammar — signs, decimals, axis wrap, no snapping of measurements', () => {
    const P = RC.parseStep, F = RC.fmtStep;
    assert.deepStrictEqual([1.25, -0.5, 0, -0, 1e-10, 2].map(v => F(v, 'dpt')), ['+1.25', '-0.50', '0.00', '0.00', '0.00', '+2.00']);
    assert.strictEqual(F(43.25, 'k'), '43.25'); assert.strictEqual(F(89.6, 'axis'), '90'); assert.strictEqual(F(NaN, 'num'), ''); assert.strictEqual(F(null, 'dpt'), '');
    assert.strictEqual(F(7.85, 'num'), '7.85'); assert.strictEqual(F(14, 'num'), '14');
    assert.strictEqual(P('-1,25', 'dpt'), -1.25); assert.strictEqual(P('-.5', 'dpt'), -0.5); assert.strictEqual(P('pl', 'dpt'), null); assert.strictEqual(P('', 'dpt'), null); assert.strictEqual(P(null, 'dpt'), null);
    assert.strictEqual(P('abc', 'num'), null); assert.strictEqual(P('20/40', 'num'), 20); assert.strictEqual(P('x90', 'axis'), 90);
    // typed signs that are not ASCII (was: the sign was dropped, −1.25 became +1.25)
    assert.strictEqual(P('−1.25', 'dpt'), -1.25, 'U+2212 minus');
    assert.strictEqual(P('–1.25', 'dpt'), -1.25, 'en dash');
    assert.strictEqual(P('—1.25', 'dpt'), -1.25, 'em dash');
    assert.strictEqual(P('－1.25', 'dpt'), -1.25, 'full-width minus');
    assert.strictEqual(P('- 1.25', 'dpt'), -1.25, 'spaced minus');
    assert.strictEqual(P('−1,25', 'dpt'), -1.25);
    assert.strictEqual(P('１.２５', 'dpt'), 1.25, 'full-width digits (Japanese IME)');
    assert.strictEqual(P('＋２．００', 'dpt'), 2);
    // axis wrap 1–180 (ISO 8429 TABO: 0 is written 180)
    const AX = { fmt: 'axis', step: 1, min: 1, max: 180, wrap: true };
    assert.deepStrictEqual([0, 181, 185, 360, -10, 180, 1, 270, 90].map(v => RC.clampValue(v, AX)), [180, 1, 5, 180, 170, 180, 1, 90, 90]);
    assert.strictEqual(RC.bumpValue('180', 1, false, AX), '1'); assert.strictEqual(RC.bumpValue('1', -1, false, AX), '180'); assert.strictEqual(RC.bumpValue('178', 1, true, AX), '2');
    assert.deepStrictEqual(['0', '181', '270', '360', '-10', '90.5', '180', 'x90'].map(v => RC.normaliseInput(v, AX).value), ['180', '1', '90', '180', '170', '91', '180', '90']);
    // dioptres: signed two decimals on blur, plano unsigned, and NOT snapped to the 0.25
    // wheel grid (was: '-0.12' → '0.00', '-1.12' → '-1.00'; 0.12 D steps are legitimate)
    const DPT = { fmt: 'dpt', step: 0.25 }, ADD = { fmt: 'dpt', step: 0.25, min: 0 };
    assert.deepStrictEqual(['-1.3', '0.5', '0', '-.5', '1,25', '+0.00', '−1.25', '–1.25', '- 1.25', '-0.12', '-1.12', '+0.37'].map(v => RC.normaliseInput(v, DPT).value), ['-1.30', '+0.50', '0.00', '-0.50', '+1.25', '0.00', '-1.25', '-1.25', '-1.25', '-0.12', '-1.12', '+0.37']);
    assert.strictEqual(RC.bumpValue('', 1, false, DPT), '+0.25'); assert.strictEqual(RC.bumpValue('', -1, false, DPT), '-0.25');
    assert.strictEqual(RC.bumpValue('-0.25', 1, false, DPT), '0.00'); assert.strictEqual(RC.bumpValue('-1.25', 1, true, DPT), '-0.25', '1.00 D coarse step');
    assert.strictEqual(RC.bumpValue('', -1, false, ADD), '0.00', 'add: min 0 on the stepper');
    assert.deepStrictEqual(RC.normaliseInput('-2.00', ADD), { value: '-2.00', out: true }, 'typed: kept, flagged (was rewritten to 0.00)');
    // measurements: kept as the instrument read them, never snapped to the wheel grid or clamped
    const K = { fmt: 'k', step: 0.25, min: 30, max: 75 };
    assert.deepStrictEqual(['43.37', '62.50', '44.00', '43.12', '43.62'].map(v => RC.normaliseInput(v, K).value), ['43.37', '62.50', '44.00', '43.12', '43.62'], 'was 43.25 / 60.00 / … ');
    assert.deepStrictEqual(RC.normaliseInput('29', K), { value: '29.00', out: true }); assert.strictEqual(RC.normaliseInput('62.00', K).out, false, 'keratoconus is inside the usual range now');
    const PACHY = { fmt: 'num', step: 1, min: 200, max: 1100 };
    assert.deepStrictEqual(['547', '553', '543', '542', '547.5', '850', '290'].map(v => RC.normaliseInput(v, PACHY).value), ['547', '553', '543', '542', '547.5', '850', '290'], 'was 545 / 555 / 545 / 540 / 550 / 800 / 300');
    assert.strictEqual(RC.normaliseInput('850', PACHY).out, false); assert.strictEqual(RC.normaliseInput('150', PACHY).out, true);
    const IOP = { fmt: 'num', step: 1, min: 0, max: 80 };
    assert.deepStrictEqual(['16.3', '16.5', '17.5', '15.5'].map(v => RC.normaliseInput(v, IOP).value), ['16.3', '16.5', '17.5', '15.5'], 'tenths from a rebound tonometer survive');
    assert.deepStrictEqual(RC.normaliseInput('85', IOP), { value: '85', out: true }); assert.deepStrictEqual(RC.normaliseInput('-3', IOP), { value: '-3', out: true });
    assert.strictEqual(RC.bumpValue('80', 1, false, IOP), '80', 'the stepper still clamps'); assert.strictEqual(RC.bumpValue('0', -1, false, IOP), '0');
    const PD = { fmt: 'num', step: 0.5, min: 35, max: 80 };
    assert.deepStrictEqual(['63.25', '63.2', '63', '31.5', '38'].map(v => RC.normaliseInput(v, PD).value), ['63.25', '63.2', '63', '31.5', '38'], 'PD from photo writes 63.2; blur must keep it');
    assert.strictEqual(RC.normaliseInput('31.5', PD).out, true); assert.strictEqual(RC.normaliseInput('38', PD).out, false, 'infant PD');
    const A = { fmt: 'num', step: 0.5, min: 30, max: 70 }; assert.deepStrictEqual(RC.normaliseInput('38', A), { value: '38', out: false }, 'paediatric frame');
    const BC = { fmt: 'num', step: 0.05, min: 5.5, max: 11 }, DIA = { fmt: 'num', step: 0.1, min: 7, max: 25 };
    assert.deepStrictEqual(['7.80', '7.85', '8.65'].map(v => RC.normaliseInput(v, BC).value), ['7.8', '7.85', '8.65'], 'RGP base curves (was 8 / 8 / 8.7)');
    assert.deepStrictEqual(['9.6', '16.5', '14.0'].map(v => RC.normaliseInput(v, DIA).value), ['9.6', '16.5', '14'], 'RGP and scleral diameters (was 13 / 15 / 14)');
    assert.strictEqual(RC.normaliseInput('7.85', BC).out, false); assert.strictEqual(RC.normaliseInput('16.5', DIA).out, false);
    assert.deepStrictEqual(RC.normaliseInput('pl', DPT), { value: null, out: false });
    // the disc-Ø chip stepper
    const CHIP = { fmt: 'num', step: 0.1, min: 0.5, max: 4 };
    assert.strictEqual(RC.bumpValue('4.0', 1, false, CHIP), '4'); assert.strictEqual(RC.bumpValue('0.5', -1, false, CHIP), '0.5'); assert.strictEqual(RC.bumpValue('1.5', 1, true, CHIP), '1.9');
    assert.strictEqual(RC.inRange(5, { wrap: true, min: 1, max: 180 }), true); assert.strictEqual(RC.inRange(5, {}), true); assert.strictEqual(RC.inRange(5, { min: '' , max: '' }), true);
    // imported values take the inputs' grammar; powers are not snapped (0.12 D is legal)
    assert.strictEqual(RC.importField('185', AX), '5'); assert.strictEqual(RC.importField('0', AX), '180');
    assert.strictEqual(RC.importField('1.5', DPT), '+1.50'); assert.strictEqual(RC.importField('-1.12', DPT), '-1.12'); assert.strictEqual(RC.importField('+0.50', DPT), '+0.50');
    assert.strictEqual(RC.importField('85', IOP), '80'); assert.strictEqual(RC.importField('NaN', PACHY), 'NaN', 'text stays text'); assert.strictEqual(RC.importField(null, IOP), null);
    assert.strictEqual(RC.importField('62.5', K), '62.50'); assert.strictEqual(RC.importField(16, IOP), '16');
  });

  await test('clinical: one prescription line and positional slots for every document', () => {
    assert.strictEqual(RC.rxLine({ sph: '', cyl: '-0.50', axis: '90' }), 'Pl  -0.50 × 90', "was '-0.50  90' (read as a -0.50 sphere)");
    assert.strictEqual(RC.rxLine({ sph: '-1.25', cyl: '', axis: '90' }), '-1.25  — × 90', 'an axis with no cylinder is visible');
    assert.strictEqual(RC.rxLine({ sph: '-1.25', cyl: '-0.50', axis: '' }), '-1.25  -0.50 × —', 'a cylinder with no axis is visible');
    assert.strictEqual(RC.rxLine({ sph: '-1.25', cyl: '-0.50', axis: '90', add: '+2.00' }), '-1.25  -0.50 × 90   Add +2.00');
    assert.strictEqual(RC.rxLine({ sph: '-1.25', cyl: '-0.50', axis: '90', add: '+2.00' }, 'Adición'), '-1.25  -0.50 × 90   Adición +2.00');
    assert.strictEqual(RC.rxLine({ sph: '', cyl: '-0.75', axis: '90' }), 'Pl  -0.75 × 90');
    assert.strictEqual(RC.rxLine({ sph: '-1.00', cyl: '', axis: '180' }), '-1.00  — × 180');
    assert.strictEqual(RC.rxLine({ sph: '', cyl: '', axis: '', add: '' }), ''); assert.strictEqual(RC.rxLine({}), ''); assert.strictEqual(RC.rxLine(null), '');
    assert.strictEqual(RC.rxLine({ sph: '-2.00' }), '-2.00'); assert.strictEqual(RC.rxLine({ add: '+1.50' }), 'Pl   Add +1.50');
    assert.strictEqual(RC.rxLine({ sph: ' -1.25 ', cyl: ' ' }), '-1.25');
    assert.strictEqual(RC.slots(['', '12', '5']), '— / 12 / 5', "was '12 / 5' (panto read as 12°)");
    assert.strictEqual(RC.slots(['', '18']), '— / 18'); assert.strictEqual(RC.slots(['', '30']), '— / 30');
    assert.strictEqual(RC.slots(['2.00', '']), '2.00 / —'); assert.strictEqual(RC.slots(['', 'Base up'], ' '), '— Base up');
    assert.strictEqual(RC.slots(['', '']), ''); assert.strictEqual(RC.slots([]), ''); assert.strictEqual(RC.slots([null, undefined]), '');
    assert.strictEqual(RC.slots(['44.00', '45.25']), '44.00 / 45.25'); assert.strictEqual(RC.slots([52, 34]), '52 / 34');
  });

  await test('clinical: acuity ladders step the chart the value is written in and never overwrite a record', () => {
    const va = (v, dir, ph, scale) => RC.acuityStep(v, dir, { kind: 'va', placeholder: ph || '20/40', scale: scale || null });
    const nr = (v, dir) => RC.acuityStep(v, dir, { kind: 'near', placeholder: 'J1' });
    assert.strictEqual(va('', 1).value, '20/40', 'empty seeds at the placeholder'); assert.strictEqual(va('', -1, '20/20').value, '20/20');
    assert.strictEqual(va('20/20', 1).value, '20/16', 'ETDRS rows are on the ladder now'); assert.strictEqual(va('20/20', -1).value, '20/25');
    assert.strictEqual(va('20/15', 1).value, '20/12.5'); assert.strictEqual(va('20/10', 1).value, '20/10', 'clamped at best');
    assert.strictEqual(va('20/400', -1).value, 'CF'); assert.strictEqual(va('CF', -1).value, 'HM'); assert.strictEqual(va('HM', -1).value, 'LP'); assert.strictEqual(va('LP', -1).value, 'NLP'); assert.strictEqual(va('NLP', -1).value, 'NLP');
    assert.strictEqual(va('cf', -1).value, 'HM', 'case-insensitive');
    assert.strictEqual(va('6/6', 1).value, '6/5', 'BS 4274-1 rows'); assert.strictEqual(va('6/6', -1).value, '6/7.5'); assert.strictEqual(va('6/6', 1).scale, '6');
    assert.strictEqual(va('6/60', -1).value, 'CF'); assert.strictEqual(va('6/12', 1).value, '6/9');
    assert.strictEqual(va('6/36', -1).value, '6/60', "was '6/3' (best possible acuity)"); assert.strictEqual(va('6/24', -1).value, '6/30'); assert.strictEqual(va('6/30', -1).value, '6/36');
    assert.strictEqual(va('6/5', 1).value, '6/4.5', "was '6/3'"); assert.strictEqual(va('6/4.5', 1).value, '6/4'); assert.strictEqual(va('6/4', 1).value, '6/3'); assert.strictEqual(va('6/3', 1).value, '6/3');
    assert.strictEqual(va('6 / 6', -1).value, '6/7.5', 'spaces are normalised');
    assert.strictEqual(va('CF', 1, '20/40', '6').value, '6/60', "the metric user stays metric (was '20/400')"); assert.strictEqual(va('CF', 1).value, '20/400');
    assert.strictEqual(va('', 1, '20/40', '6').value, '6/12', 'empty on a metric field seeds at the metric placeholder'); assert.strictEqual(va('', 1, '20/20', '6').value, '6/6');
    assert.strictEqual(va('20/200-2', 1).value, '20/160', "a +/- suffix steps from its base row (was '20/40')"); assert.strictEqual(va('20/20+2', -1).value, '20/25');
    assert.strictEqual(va('20/32', -1).value, '20/40'); assert.strictEqual(va('20/32', -1, '20/20').value, '20/40', 'not a placeholder coincidence');
    assert.deepStrictEqual(va('20/22', 1), { value: '20/22', scale: '20', unchanged: true }, 'an unknown row is left alone');
    assert.deepStrictEqual(va('N5', 1), { value: 'N5', scale: null, unchanged: true });
    assert.strictEqual(nr('', 1).value, 'J1'); assert.strictEqual(nr('J1', 1).value, 'J1+'); assert.strictEqual(nr('J1+', 1).value, 'J1+');
    assert.strictEqual(nr('J1', -1).value, 'J2'); assert.strictEqual(nr('J8', -1).value, 'J10'); assert.strictEqual(nr('J16', -1).value, 'J16'); assert.strictEqual(nr('j2', 1).value, 'J1');
    assert.deepStrictEqual(nr('J9', 1), { value: 'J9', scale: null, unchanged: true }, "was 'J1'"); assert.strictEqual(nr('0.4M', 1).unchanged, true);
    assert.deepStrictEqual(RC.SEQ.va6.slice(-5), ['6/60', 'CF', 'HM', 'LP', 'NLP'], 'the metric ladder ends in the shared tail');
    for (const k of ['va20', 'va6']) { assert.ok(RC.SEQ[k].indexOf('CF') > 0 && RC.SEQ[k].slice(-1)[0] === 'NLP'); assert.strictEqual(new Set(RC.SEQ[k]).size, RC.SEQ[k].length); }
    assert.ok(['6/36', '6/5', '6/4'].every(v => RC.SEQ.va6.includes(v)) && ['20/12.5', '20/16', '20/32', '20/63'].every(v => RC.SEQ.va20.includes(v)));
  });

  await test('clinical: PD from a photo (ID-1 card) and the lens centration layout', () => {
    assert.strictEqual(RC.ID1_LONG_MM, 85.6); assert.strictEqual(RC.ID1_SHORT_MM, 53.98);
    near(RC.photoScale(85.6, 800), 0.107); near(RC.photoScale(85.6, 856), 0.1);
    assert.strictEqual(RC.photoPd(640, 0.1), 64); assert.strictEqual(RC.photoPd(588.8, 0.107), 63);
    assert.strictEqual(RC.photoPd(735, RC.photoScale(85.6, 1000)), 62.9); assert.strictEqual(RC.photoPd(1470, RC.photoScale(85.6, 2000)), 62.9, 'resolution-independent');
    assert.strictEqual(RC.photoPd(735, RC.photoScale(85.6, 1000) * 85.6 / 53.98), 99.8, 'short edge traced against the long reference: out of range, refused by the UI');
    assert.strictEqual(RC.photoScale(85.6, 0), null); assert.strictEqual(RC.photoScale(0, 800), null); assert.strictEqual(RC.photoScale(-5, 800), null); assert.strictEqual(RC.photoPd(0, 0.1), null); assert.strictEqual(RC.photoPd(100, null), null);
    const C = o => RC.centration(Object.assign({ A: 52, B: 34, DBL: 18 }, o));
    let c = C({ pdDist: 63, eye: 'OD' });
    assert.deepStrictEqual([c.frameHalf, c.mono, c.decTxt, c.dir, c.fh, c.seg, c.assumed], [35, 31.5, '3.5', 'in', 17, null, true]);
    c = C({ A: 54, DBL: 16, monoOD: 33, monoOS: 30, eye: 'OD' }); assert.deepStrictEqual([c.decTxt, c.dir], ['2.0', 'in']);
    c = C({ A: 54, DBL: 16, monoOD: 33, monoOS: 30, eye: 'OS' }); assert.deepStrictEqual([c.decTxt, c.dir], ['5.0', 'in']);
    c = C({ A: 48, B: 30, pdDist: 70, eye: 'OS' }); assert.deepStrictEqual([c.decTxt, c.dir, c.fh], ['2.0', 'out', 15]);
    c = C({ A: 50, B: 30, DBL: 20, pdDist: 70, eye: 'OD' }); assert.deepStrictEqual([c.decTxt, c.dir], ['0.0', 'in']);
    c = C({ pdDist: 70.08, eye: 'OD' }); assert.deepStrictEqual([c.decTxt, c.dir], ['0.0', 'in'], "a value that prints 0.0 never says 'out'");
    c = C({ A: 52.5, pdDist: 63, eye: 'OD' }); assert.strictEqual(c.decTxt, '3.75', 'quarter millimetres are shown, not rounded to 3.8');
    c = C({ pdDist: 63, fitHt: 22, eye: 'OD' }); assert.strictEqual(c.fh, 22);
    c = C({ pdDist: 63, segHt: 18, fitHt: 22, eye: 'OD' }); assert.deepStrictEqual([c.fh, c.seg], [22, 18], 'the cross is the OC height; the seg top is its own line (was 18)');
    c = C({ pdDist: 63, segHt: 18, eye: 'OD' }); assert.deepStrictEqual([c.fh, c.seg], [18, 18], 'seg only: it is the fallback');
    c = C({ pdDist: 63, monoOD: 34, eye: 'OS' }); assert.deepStrictEqual([c.mono, c.decTxt, c.dir, c.assumed], [29, '6.0', 'in', false], 'pdDist − the other mono (was 31.5, dec 3.5)');
    c = C({ pdDist: 63, monoOD: 34, eye: 'OD' }); assert.deepStrictEqual([c.mono, c.decTxt], [34, '1.0']);
    c = C({ monoOD: '31,5', pdDist: '63', eye: 'OD' }); assert.strictEqual(c.decTxt, '3.5', 'decimal comma while typing (was 4.0)');
    assert.strictEqual(C({ A: '' }), null); assert.strictEqual(C({ A: '0' }), null); assert.strictEqual(C({ B: '-1' }), null); assert.strictEqual(C({ DBL: '-2' }), null);
    c = C({ DBL: '0', eye: 'OD' }); assert.strictEqual(c.frameHalf, 26); assert.strictEqual(c.mono, null); assert.strictEqual(c.decTxt, null); assert.strictEqual(c.fh, 17);
    c = C({ segHt: '-5', pdDist: 63, eye: 'OD' }); assert.strictEqual(c.fh, 17, 'a negative seg height is not a height');
    c = C({ fitHt: '40', pdDist: 63, eye: 'OD' }); assert.strictEqual(c.fhOut, true, 'above the box: flagged');
    c = C({ pdDist: 10, eye: 'OD' }); assert.strictEqual(c.decOut, true);
  });

  await test('clinical: screen calibration carry-over, distance units and sane stored settings', () => {
    assert.strictEqual(RC.carryPxPerMm(4, 1, 2), 2, 'was 8 (ratio inverted)'); assert.strictEqual(RC.carryPxPerMm(3, 1.5, 1), 4.5); near(RC.carryPxPerMm(3.61, 1, 1.25), 2.888);
    assert.strictEqual(RC.carryPxPerMm(4, 0, 2), null); assert.strictEqual(RC.carryPxPerMm(NaN, 1, 1), null);
    assert.strictEqual(RC.distanceMm(6, 'm'), 6000); assert.strictEqual(RC.distanceMm(20, 'ft'), 6096); assert.strictEqual(RC.distanceMm(10, 'ft'), 3048); assert.strictEqual(RC.distanceMm(4, 'm'), 4000);
    assert.ok(isNaN(RC.distanceMm(-6, 'm')) && isNaN(RC.distanceMm('x', 'm')));
    // round trips are exact because the millimetres are canonical (was 4 m → 13.1 ft → 3.99 m)
    assert.strictEqual(RC.distanceIn(6000, 'ft'), 19.69); assert.strictEqual(RC.distanceIn(RC.distanceMm(RC.distanceIn(6000, 'ft'), 'ft'), 'm'), 6.0);
    assert.strictEqual(RC.distanceIn(6096, 'm'), 6.1); assert.strictEqual(RC.distanceIn(6096, 'ft'), 20);
    assert.strictEqual(RC.distanceIn(4000, 'ft'), 13.12); assert.strictEqual(RC.distanceIn(3000, 'ft'), 9.84); assert.strictEqual(RC.distanceIn(2500, 'ft'), 8.2);
    assert.strictEqual(RC.sanePxPerMm('x', 3.7795), 3.7795); assert.strictEqual(RC.sanePxPerMm(0, 3.7795), 3.7795); assert.strictEqual(RC.sanePxPerMm(1.577, 1), 1.577, '55" 1080p TV is representable'); assert.strictEqual(RC.sanePxPerMm(25, 1), 1);
    assert.strictEqual(RC.saneDistance(-6, 'm', 6), 6, "'-6' never reaches the chart"); assert.strictEqual(RC.saneDistance(0, 'm', 6), 6); assert.strictEqual(RC.saneDistance('6', 'm', 1), 6); assert.strictEqual(RC.saneDistance(0.5, 'm', 6), 0.5); assert.strictEqual(RC.saneDistance(20, 'ft', 6), 20);
    assert.strictEqual(RC.PX_PER_MM_MIN, 1.2);
  });

  await test('clinical: chart maths — sizing, tables, contrast ladder, luminance, orientations, plates, Amsler', () => {
    const CM = RC.chart;
    assert.strictEqual(typeof RC.chartMath, 'function'); assert.ok(!/\bRC\b|RetinaClinical|parseStep/.test(RC.chartMath.toString()), 'self-contained: it is injected by toString()');
    near(CM.TAN5, Math.tan(5 / 60 * Math.PI / 180), 1e-7);
    near(CM.heightPx(6000, 1, 3.7795), 32.98, 0.005); near(CM.heightPx(6000, 1, 3.7795) / 0.72, 45.81, 0.005);
    near(CM.heightPx(6096, 10, 1), 88.66, 0.005, 'Wikimedia chart: top E 88.7 mm at 20 ft'); near(CM.heightPx(6000, 10, 1), 87.26, 0.01); near(CM.heightPx(6000, 1, 1), 8.726, 0.001);
    near(CM.heightPx(3000, 2, 3.7795), 32.98, 0.005, 'contrast letters: 20/40 at 3 m'); near(CM.heightPx(4000, 1.25, 3.78), 27.49, 0.01);
    assert.ok(isNaN(CM.heightPx(-6000, 1, 3.7795)) && isNaN(CM.heightPx(6000, 1, 0)) && isNaN(CM.heightPx(NaN, 1, 1)), 'a bad calibration is NaN, never a negative font size');
    near(CM.logMAR(3.5), 0.5441, 1e-4); near(CM.logMAR(0.75), -0.1249, 1e-4); assert.strictEqual(CM.logMAR(10), 1); assert.strictEqual(CM.logMAR(1), 0);
    assert.deepStrictEqual(CM.CHART.map(L => L.mar), [10, 5, 3.5, 2.5, 2, 1.5, 1.25, 1, 0.75]);
    assert.deepStrictEqual(CM.CHART.map(L => L.sn), ['20/200', '20/100', '20/70', '20/50', '20/40', '20/30', '20/25', '20/20', '20/15']);
    assert.deepStrictEqual(CM.CHART.map(L => L.m6), ['6/60', '6/30', '6/21', '6/15', '6/12', '6/9', '6/7.5', '6/6', '6/4.5']);
    assert.deepStrictEqual(CM.CHART.map(L => L.ch), ['E', 'FP', 'TOZ', 'LPED', 'PECFD', 'EDFCZP', 'FELOPZD', 'DEFPOTEC', 'LEFODPCT'], "classic 20/15 row (was the 20/13 row 'FDPLTCEO')");
    assert.strictEqual(CM.acuityLabel(2, 'ft'), '20/70  ·  +0.54 logMAR'); assert.strictEqual(CM.acuityLabel(7, 'ft'), '20/20  ·  0.00 logMAR'); assert.strictEqual(CM.acuityLabel(8, 'ft'), '20/15  ·  -0.12 logMAR');
    assert.strictEqual(CM.acuityLabel(2, 'm'), '6/21  ·  +0.54 logMAR', 'metric practices read 6/x'); assert.strictEqual(CM.acuityLabel(0, 'm'), '6/60  ·  +1.00 logMAR'); assert.strictEqual(CM.acuityLabel(99), '');
    assert.deepStrictEqual([0, 3, 4, 5, 6, 8].map(CM.duochromeLine), [3, 3, 4, 5, 6, 6]);
    // sRGB transfer and the contrast ladder
    assert.strictEqual(CM.eotf(0), 0); assert.strictEqual(CM.eotf(255), 1); near(CM.eotf(10), 0.0030353, 1e-7); near(CM.eotf(11), 0.0033465, 1e-7); near(CM.eotf(128), 0.21586, 1e-5); near(CM.eotf(191), 0.52100, 1e-5); near(CM.eotf(224), 0.74540, 1e-5); near(CM.eotf(240), 0.87137, 1e-5); near(CM.eotf(247), 0.93011, 1e-5);
    for (const g of [0, 7, 11, 100, 188, 255]) near(255 * CM.oetf(CM.eotf(g)), g, 1e-9, 'oetf inverts eotf');
    assert.deepStrictEqual([0, 128, 191, 224, 240, 247].map(g => Math.round(CM.weber(g) * 100)), [100, 78, 48, 25, 13, 7], 'the old code-value ladder: 25 %, not the 26 % the comment claimed');
    const lad = CM.contrastLadder();
    assert.deepStrictEqual(lad.map(x => x.g), [0, 188, 225, 241, 248, 252], 'specified in luminance');
    assert.deepStrictEqual(lad.map(x => x.pct), [100, 50, 25, 12, 6, 3]);
    near(-Math.log10(CM.weber(252)), 1.57, 0.01, 'floor reaches the Pelli-Robson 1.5 referral level');
    assert.strictEqual(CM.CONTRAST_ROWS.length, lad.length);
    for (const r of CM.CONTRAST_ROWS.concat(CM.SLOAN_LINES)) { assert.strictEqual(r.length, 5); assert.strictEqual(new Set(r).size, 5); assert.ok([...r].every(c => CM.SLOAN.includes(c)), r); }
    // duochrome balance
    const Yr = CM.relLum('#c0161d'), Yg = CM.relLum('#0a702a'); near(Yr, 0.1187, 5e-4); near(Yg, 0.1182, 5e-4); assert.ok(Math.abs(Yr - Yg) / Yr < 0.005);
    near(CM.relLum('#0a8a2a') / Yr, 1.551, 0.005, 'the rejected green'); near(CM.relLum('#fff'), 1, 1e-6); assert.strictEqual(CM.relLum('#000000'), 0);
    // orientations and their answer keys
    assert.strictEqual([0, 90, 180, 270].map(a => CM.orientationArrow('tumblingE', a)).join(' '), '→ ↓ ← ↑', "the E's own key (was '↑ → ↓ ←', rotated 90° from the glass)");
    assert.strictEqual([0, 90, 180, 270, 45].map(a => CM.orientationArrow('landoltC', a)).join(' '), '↑ → ↓ ← ↗');
    assert.strictEqual([90, 0, 270, 180, 90].map(a => CM.orientationArrow('tumblingE', a)).join(' '), '↓ → ↑ ← ↓', 'fixed line 4 as the patient sees it');
    assert.strictEqual(CM.orientationArrow('tumblingE', 45), '45');
    assert.deepStrictEqual(CM.fixedOrientations('landoltC', 4), [45, 180, 315, 90, 225]); assert.deepStrictEqual(CM.fixedOrientations('landoltC', 1), [135, 270, 45, 180, 315]);
    assert.deepStrictEqual(CM.fixedOrientations('tumblingE', 4), [90, 0, 270, 180, 90]);
    const rows = CM.CHART.map((_, i) => CM.fixedOrientations('tumblingE', i));
    assert.strictEqual(new Set(rows.map(r => r.join())).size, 9, 'nine distinct fixed E rows (was two)');
    rows.forEach((r, i) => { assert.deepStrictEqual(r.slice(0, 4).slice().sort((a, b) => a - b), [0, 90, 180, 270], 'row ' + i); assert.ok(CM.R4.includes(r[4])); });
    assert.ok(rows.some(r => r[0] !== r[4]), 'positions 1 and 5 do not always match');
    assert.strictEqual(CM.E_LINES.length, 9);
    // mulberry32 and the plate sampler
    let r = CM.rngStep(987654321); const first = [r[0]]; r = CM.rngStep(r[1]); first.push(r[0]); r = CM.rngStep(r[1]); first.push(r[0]);
    assert.deepStrictEqual(first, [0.9514403040520847, 0.13489632960408926, 0.01530607370659709]); assert.strictEqual(CM.rngStep(0)[0], 0.26642920868471265);
    let seed = 987654321; const rnd = () => { const x = CM.rngStep(seed); seed = x[1]; return x[0]; };
    const dots = CM.sampleDots('74', rnd);
    assert.ok(dots.length > 3000 && dots.length <= 3600, 'N is an upper bound (' + dots.length + ')');
    assert.ok(dots.every(d => Math.hypot(d.cx - 0.5, d.cy - 0.5) + d.r <= 0.5 + 1e-12), 'no dot straddles the rim (was ~120 clipped at the canvas edge)');
    assert.ok(dots.every(d => d.lvl >= 0 && d.lvl < 4 && d.r > 0));
    let overlaps = 0; for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) { const a = dots[i], b = dots[j]; if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r - 1e-12) overlaps++; }
    assert.strictEqual(overlaps, 0);
    const cover = dots.reduce((s, d) => s + Math.PI * d.r * d.r, 0) / (Math.PI * 0.25); assert.ok(cover > 0.4 && cover < 0.5, 'jamming density ~45 % (' + cover.toFixed(3) + ')');
    seed = 987654321; const one = CM.sampleDots('7', rnd); assert.ok(one.length > 1500 && one.length <= 1800);
    // Amsler in physical units
    let am = CM.amsler(3.7795, 1080 * 0.82);
    near(am.cellPx, 18.8975, 1e-4); near(am.sidePx, 377.95, 1e-4); assert.strictEqual(am.n, 20); assert.strictEqual(am.viewMm, 300); assert.strictEqual(am.fit, true); near(am.degPerCell, 0.955, 1e-3); near(am.dotPx, 2.27, 0.01, '1.2 mm dot');
    am = CM.amsler(3.7795, 300); assert.strictEqual(am.fit, false); near(am.cellMm, 3.969, 1e-3); assert.strictEqual(am.viewMm, 227, 'the distance at which a cell is 1°');
    near(5 / Math.tan(Math.PI / 180), 286.5, 0.1); near(11.7 / Math.tan(Math.PI / 180), 670.3, 0.1, 'the old 11.7 mm cell needed 67 cm');
    assert.strictEqual(CM.AMSLER_CELL_MM, 5); assert.strictEqual(CM.AMSLER_VIEW_MM, 300);
    // clock dial, Landolt ring, spacing
    assert.deepStrictEqual([3, 1, 2, 4, 5, 6, 9, 12, 7].map(CM.clockAxis), [90, 30, 60, 120, 150, 180, 90, 180, 30]);
    assert.deepStrictEqual(CM.landolt(5), { sw: 1, r: 2, gap: 1 }, 'ISO 8596: stroke = gap = d/5, parallel-sided');
    near(CM.letterSpacing(100, 0.716, 0.106), 61); near(CM.letterSpacing(100, 0.688), 58.2);
  });

  // ---- store, DICOM and inbox changes from the same audit ----
  await test('audit: cleanMark/cleanMarks reject non-positive radii, duplicate ids and second singletons', () => {
    assert.deepStrictEqual(RS.cleanMark({ id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: 3, ry: 4 }), { id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: 3, ry: 4 });
    assert.deepStrictEqual(RS.cleanMark({ id: 'm1', kind: 'disc', cx: 500, cy: 500, rx: 80, ry: 90 }).rx, 80);
    for (const bad of [{ rx: 0, ry: 4 }, { rx: -40, ry: 4 }, { rx: 3, ry: -0 }, { rx: 3, ry: -5 }, { rx: -80, ry: -90 }, { rx: 0, ry: 0 }, { rx: 200, ry: -250 }])
      assert.throws(() => RS.cleanMark(Object.assign({ id: 'm1', kind: 'cup', cx: 1, cy: 2 }, bad)), e => e.code === 'invalid' && /^mark-r[xy]$/.test(e.cause), JSON.stringify(bad));
    assert.throws(() => RS.cleanMark({ id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: NaN, ry: 4 }), e => e.code === 'invalid');
    assert.throws(() => RS.cleanMark({ id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: '40', ry: 4 }), e => e.code === 'invalid');
    assert.throws(() => RS.cleanMark({ id: 'm1', kind: 'disc', cx: 1, cy: 2, rx: 1e7, ry: 4 }), e => e.code === 'invalid');
    const d = (id, rx) => ({ id, kind: 'disc', cx: 1, cy: 1, rx, ry: rx }), l = (id) => ({ id, kind: 'lesion', x: 1, y: 1 });
    assert.strictEqual(RS.cleanMarks([l('m1'), l('m2'), d('m3', 5)]).length, 3);
    assert.throws(() => RS.cleanMarks([d('m1', 1), d('m1', 2)]), e => e.cause === 'mark-id-dup');
    assert.throws(() => RS.cleanMarks([l('m1'), l('m1')]), e => e.cause === 'mark-id-dup');
    assert.throws(() => RS.cleanMarks([d('m1', 1), d('m2', 2)]), e => e.cause === 'mark-singleton');
    assert.throws(() => RS.cleanMarks([{ id: 'm1', kind: 'fovea-center', x: 1, y: 1 }, { id: 'm2', kind: 'fovea-center', x: 2, y: 2 }]), e => e.cause === 'mark-singleton');
    assert.deepStrictEqual(RS.cleanMarks(null), []); assert.throws(() => RS.cleanMarks('x'), e => e.code === 'invalid');
    assert.deepStrictEqual(['1e400', 1e9, -5, 'abc', 123.6, 4288].map(RS.cleanSize), [100000, 100000, 0, 0, 124, 4288]);
    assert.throws(() => RS.cleanFields({ iop: true }), e => e.cause === 'field-value', 'a boolean is never a clinical value');
    assert.deepStrictEqual(RS.cleanFields({ sph: 1.5, axis: 0 }), { sph: '1.5', axis: '0' });
    // normEye clamps the disc diameter on every read (was: -2 survived a reload)
    assert.deepStrictEqual([-2, 10, 0, 0.2, 1.92, '1.8'].map(v => RS.normalizeEncounter({ eyes: { OD: { discDiaMm: v } } }).eyes.OD.discDiaMm), [0.5, 4, 1.5, 0.5, 1.92, 1.8]);
  });
  await test('audit: a backup with a duplicate mark id or a second disc is rejected whole', async () => {
    const s = await sampleBackup();
    const m = JSON.parse(JSON.stringify(s.manifest)); m.encounters[0].eyes.OD.marks = [{ id: 'm1', kind: 'disc', cx: 1, cy: 1, rx: 1, ry: 1 }, { id: 'm1', kind: 'disc', cx: 1, cy: 1, rx: 2, ry: 2 }];
    await assert.rejects(async () => RS.validateBackup(await RS.readBackup(RS.bakContainer(m, [s.bytes]))), e => e.code === 'invalid');
    const m2 = JSON.parse(JSON.stringify(s.manifest)); m2.encounters[0].eyes.OD.marks = [{ id: 'm1', kind: 'disc', cx: 1, cy: 1, rx: 1, ry: -1 }];
    await assert.rejects(async () => RS.validateBackup(await RS.readBackup(RS.bakContainer(m2, [s.bytes]))), e => e.code === 'invalid');
    const m3 = JSON.parse(JSON.stringify(s.manifest)); m3.encounters[0].eyes.OD.marks = [{ id: 'm1', kind: 'lesion', x: 1, y: 1 }, { id: 'm2', kind: 'lesion', x: 2, y: 2 }];
    assert.strictEqual((await RS.validateBackup(await RS.readBackup(RS.bakContainer(m3, [s.bytes])))).encounters[0].eyes.OD.marks.length, 2);
  });
  await test('audit: OP header — Pixel Spacing for a fundus camera, Acquisition DateTime only when it is a date', () => {
    const s = studyFix(), w = 2, h = 2, rgb = new Uint8Array(w * h * 3);
    const hdr = o => readPart10(RD.opFinish(RD.opHeader(Object.assign({ study: s, sopUID: RD.mintUID(), seriesUID: RD.mintUID(), syncUID: RD.mintUID(), seriesNumber: 2, instanceNumber: 1, eye: 'OD', sourceMime: 'image/png', sourceBytes: 4, w, h }, o)), w, h, rgb)).ds;
    assert.strictEqual(S(hdr({ device: 'fundus', pixelMm: '0.0110' }), 0x00280030), '0.011\\0.011', 'row\\column, same nominal value');
    assert.strictEqual(S(hdr({ device: 'fundus', pixelMm: 0.0093 }), 0x00280030), '0.0093\\0.0093');
    assert.ok(!hdr({ device: 'fundus' }).has(0x00280030), 'unset: absent (and the settings panel says the object is not conformant)');
    assert.ok(!hdr({ device: 'slitlamp', pixelMm: 0.011 }).has(0x00280030), 'a slit-lamp photo has no retinal scale');
    assert.ok(!hdr({ device: 'fundus', pixelMm: 'abc' }).has(0x00280030)); assert.ok(!hdr({ device: 'fundus', pixelMm: 5 }).has(0x00280030));
    assert.deepStrictEqual(['0.0110', '0,011', 0.0093, 'abc', 5, 0, -1, '0.00001', '1e-2'].map(RD.pixelMmOf), ['0.011', '0.011', '0.0093', null, null, null, null, null, '0.01']);
    assert.strictEqual(S(hdr({ acquiredAt: '20261012090533' }), 0x0008002A), '20261012090533');
    assert.ok(!hdr({ acquiredAt: '20160000000000' }).has(0x0008002A), "a camera's unset clock (was written as an invalid DT)");
    assert.ok(!hdr({ acquiredAt: '20261012240000' }).has(0x0008002A)); assert.ok(!hdr({ acquiredAt: '20261312090533' }).has(0x0008002A)); assert.ok(!hdr({ acquiredAt: '20260230090533' }).has(0x0008002A), 'February 30th');
    assert.ok(!hdr({ acquiredAt: null }).has(0x0008002A)); assert.ok(!hdr({ acquiredAt: '2026101209053' }).has(0x0008002A));
    assert.deepStrictEqual(['20261012094107', '20240229000000', '20230229000000', '20261012096000', '00000101000000', 20261012094107].map(RD.validDT), [true, true, false, false, false, false]);
  });
  await test('audit: TIFF — a 16-bit palette is refused, the Orientation tag is honoured', async () => {
    const cm16 = []; for (let c = 0; c < 3; c++) for (let i = 0; i < 65536; i++) cm16.push(0);
    await assert.rejects(RI.decodeTiff(tiff({ w: 2, h: 1, spp: 1, bps: 16, photo: 3, cmap: cm16, strips: [Uint8Array.from([0, 1, 1, 0])] })), e => e.code === 'unsupported' && e.detail === 'bits-16-palette');
    let r = await RI.decodeTiff(tiff({ w: 2, h: 1, spp: 1, bps: 8, photo: 1, orient: 6, strips: [Uint8Array.from([10, 200])] }));
    assert.deepStrictEqual([r.w, r.h, r.data[0], r.data[4]], [1, 2, 10, 200], 'rotate 90° CW: 10 on top, 200 below (was 2×1 unrotated)');
    r = await RI.decodeTiff(tiff({ w: 2, h: 1, spp: 1, bps: 8, photo: 1, orient: 3, strips: [Uint8Array.from([10, 200])] }));
    assert.deepStrictEqual([r.w, r.h, r.data[0], r.data[4]], [2, 1, 200, 10], 'rotate 180°');
    r = await RI.decodeTiff(tiff({ w: 2, h: 1, spp: 1, bps: 8, photo: 1, strips: [Uint8Array.from([10, 200])] }));
    assert.deepStrictEqual([r.w, r.h, r.data[0], r.data[4]], [2, 1, 10, 200], 'default orientation 1 untouched');
    // all eight on a 3×2 grey ramp: every transform is a permutation and the pairs invert each other
    const w = 3, h = 2, src = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { src[i * 4] = i * 10; src[i * 4 + 3] = 255; }
    const px = (o) => { const out = []; for (let i = 0; i < o.w * o.h; i++) out.push(o.data[i * 4]); return out; };
    assert.deepStrictEqual(px(RI.orientRgba(src, w, h, 2)), [20, 10, 0, 50, 40, 30]);
    assert.deepStrictEqual(px(RI.orientRgba(src, w, h, 4)), [30, 40, 50, 0, 10, 20]);
    assert.deepStrictEqual(px(RI.orientRgba(src, w, h, 5)), [0, 30, 10, 40, 20, 50]);
    const o6 = RI.orientRgba(src, w, h, 6); assert.deepStrictEqual([o6.w, o6.h, ...px(o6)], [2, 3, 30, 0, 40, 10, 50, 20]);
    const o8 = RI.orientRgba(src, w, h, 8); assert.deepStrictEqual([o8.w, o8.h, ...px(o8)], [2, 3, 20, 50, 10, 40, 0, 30]);
    assert.deepStrictEqual(px(RI.orientRgba(src, w, h, 7)), [50, 20, 40, 10, 30, 0]);
    for (const o of [2, 3, 4, 5, 6, 7, 8]) assert.strictEqual(new Set(px(RI.orientRgba(src, w, h, o))).size, 6, 'orientation ' + o + ' is a permutation');
    assert.strictEqual(RI.orientRgba(src, w, h, 9).data, src);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
