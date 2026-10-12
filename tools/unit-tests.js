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
   temporary folder (stability, links, size, impostors, untouched sources).
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
