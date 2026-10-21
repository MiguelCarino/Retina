/* ============================================================
   retina-store.js — Carino Retina local storage (IndexedDB).
   ------------------------------------------------------------
   Why IndexedDB: the encounter used to live in one localStorage
   key, and localStorage is capped at ~5 MB per origin. Two
   full-resolution photos as base64 data URLs went over it and
   every later save failed. IndexedDB stores the images as Blobs
   (no base64 overhead) under the browser's much larger quota.

   This file owns the database: schema, the one-time migration
   from localStorage, compare-and-swap writes, the close-time
   journal and the in-memory-mode orphan copies. It renders
   nothing and translates nothing: every failure is thrown as an
   Error carrying a `code`, and index.html turns codes into
   words (the i18n gate only reads index.html).

   Nothing here touches the network.

   The schema already holds the stores the later features need
   (patients, the DICOM outbox, the inbox of imported files) so
   that adding them is new code, not another migration. Future
   versions add stores or indexes only, inside the
   switch(oldVersion) in onupgradeneeded.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // node unit tests
  else root.RetinaStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'carino_retina', DB_VERSION = 1;
  const LEGACY_STUDY = 'carino_ophtha_v1', LEGACY_LOGO = 'carino_branding_logo_v1';
  const JOURNAL_PREFIX = 'carino_retina_journal:', ORPHAN_PREFIX = 'carino_retina_orphan:';
  // The verbatim pre-migration strings are kept this long after a verified
  // migration, so a bad release can still be rolled back without loss.
  const LEGACY_KEEP_MS = 30 * 864e5;
  const OPEN_TIMEOUT_MS = 15000;
  const META_KEYS = ['patientId', 'name', 'date', 'dob', 'provider', 'complaint'];
  // A visit "has data" when a human typed or drew something. The date is
  // defaulted to today and the provider is often pre-filled, so neither counts.
  const META_NOT_DATA = { date: 1, provider: 1 };
  // ID, name and date of birth say WHO, not what was examined. A "new visit for this
  // patient" starts with them filled in, so they alone must not make it a visit worth
  // keeping or a previous visit worth showing (see hasExamData).
  const META_IDENTITY = { patientId: 1, name: 1, dob: 1 };

  function err(code, cause) { const e = new Error(code); e.code = code; if (cause) e.cause = cause; return e; }
  function mapErr(e) {
    if (e && e.code && typeof e.code === 'string') return e;
    const n = e && e.name;
    return err(n === 'QuotaExceededError' ? 'quota' : n === 'AbortError' ? 'abort'
      : n === 'InvalidStateError' ? 'invalid-state' : n === 'ConstraintError' ? 'constraint'
      : n === 'VersionError' ? 'version' : n === 'NotFoundError' ? 'not-found' : 'unknown', e);
  }
  function uuid() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  const obj = x => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
  const now = () => Date.now();

  // ---------- data URL <-> Blob ----------
  // Synchronous on purpose: the migration runs inside the upgrade transaction,
  // which commits as soon as the event loop is idle, so nothing in it may await.
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,/.exec(typeof u === 'string' ? u : '');
    if (!m) return null;
    const body = u.slice(m[0].length);
    try {
      let bytes;
      if (m[3]) { const s = atob(body); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
      else bytes = new TextEncoder().encode(decodeURIComponent(body));
      return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
    } catch (e) { return null; }
  }
  function blobToDataUrl(b) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  }
  async function sha256Hex(blob) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;   // insecure context: no dedupe, nothing else lost
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('');
  }

  // ---------- record shapes ----------
  // The assumed vertical disc diameter: 0.5–4 mm, 1.5 by default, on every read.
  const dia = v => Math.min(4, Math.max(0.5, +v || 1.5));
  function normRef(r) { return (r && r.fileId) ? { fileId: String(r.fileId), sopUID: r.sopUID || null, contentKey: r.contentKey || null } : null; }
  function normEye(x) {
    x = obj(x);
    const o = Object.assign({}, x, {
      imgRef: normRef(x.imgRef), imgPending: !!x.imgPending, imgSample: !!x.imgSample, sampleVer: x.imgSample ? (+x.sampleVer || 1) : 0,
      possibleSample: !!x.possibleSample, w: +x.w || 0, h: +x.h || 0, discDiaMm: dia(x.discDiaMm),
      marks: Array.isArray(x.marks) ? x.marks.filter(m => m && typeof m === 'object') : [],
      clinical: Object.assign({}, obj(x.clinical)), disp: Object.assign({}, obj(x.disp)),
      gallery: (Array.isArray(x.gallery) ? x.gallery : []).filter(g => g && g.fileId).map(g => ({
        fileId: String(g.fileId), sopUID: g.sopUID || null, contentKey: g.contentKey || null,
        w: +g.w || 0, h: +g.h || 0, discDiaMm: dia(g.discDiaMm), marks: Array.isArray(g.marks) ? g.marks : [],
        possibleSample: !!g.possibleSample }))
    });
    delete o.img;   // pixels never live in an encounter record
    return o;
  }
  function emptyEnc() {
    return { studyUID: null, seriesUIDs: { report: null, OD: null, OS: null, attOD: null, attOS: null, attOU: null },
      reportSeq: 0, sentIdentity: null, referral: { to: '', reason: '', includePrev: false } };
  }
  // Every read goes through here, with DEEP defaults: a record written by an
  // earlier build of the same schema must load without a migration.
  function normalizeEncounter(rec) {
    rec = obj(rec);
    const e = obj(rec.enc), d = emptyEnc();
    const meta = {}; META_KEYS.forEach(k => { meta[k] = ''; });
    return Object.assign({}, rec, {
      id: String(rec.id || ''), patientRef: rec.patientRef || null,
      created: +rec.created || now(), updated: +rec.updated || +rec.created || now(), rev: +rec.rev || 0,
      deletedAt: rec.deletedAt || null,
      meta: Object.assign(meta, obj(rec.meta)), dispense: Object.assign({}, obj(rec.dispense)),
      eyes: { OD: normEye(obj(rec.eyes).OD), OS: normEye(obj(rec.eyes).OS) },
      attachments: (Array.isArray(rec.attachments) ? rec.attachments : []).filter(a => a && a.fileId),
      enc: Object.assign(d, e, { seriesUIDs: Object.assign(d.seriesUIDs, obj(e.seriesUIDs)), referral: Object.assign(d.referral, obj(e.referral)) }),
      summary: rec.summary || null
    });
  }
  function newEncounter(partial) {
    const t = now();
    return normalizeEncounter(Object.assign({ id: 'e_' + uuid(), created: t, updated: t, rev: 0 }, partial || {}));
  }
  function newFileRecord(o) {
    return { id: 'f_' + uuid(), kind: o.kind || 'image', state: o.state || 'filed', blob: o.blob,
      mime: o.blob ? o.blob.type : (o.mime || ''), size: o.blob ? o.blob.size : 0,
      sha256: o.sha256 || null, srcSha256: o.srcSha256 || undefined,   // undefined, not null: null is an invalid key and would throw on the unique index
      w: o.w || 0, h: o.h || 0, origName: o.origName || '', origMime: o.origMime || (o.blob ? o.blob.type : ''),
      source: o.source || 'load', exifTaken: o.exifTaken || null, added: now(), guessEye: o.guessEye || null,
      fileDate: o.fileDate || null, fileDateSrc: o.fileDateSrc === 'exif' || o.fileDateSrc === 'file' ? o.fileDateSrc : null, relPath: o.relPath || '' };
  }
  const filled = v => v != null && String(v).trim() !== '';
  function hasData(rec, examOnly) {
    rec = obj(rec);
    if (Object.keys(obj(rec.meta)).some(k => !META_NOT_DATA[k] && !(examOnly && META_IDENTITY[k]) && filled(rec.meta[k]))) return true;
    if (Object.values(obj(rec.dispense)).some(filled)) return true;
    if ((rec.attachments || []).length) return true;
    return ['OD', 'OS'].some(k => {
      const e = obj(obj(rec.eyes)[k]);
      return (e.marks || []).length || (e.gallery || []).length || e.imgRef || e.imgPending ||
        (e.img && !e.imgSample) ||    // legacy (localStorage) eye shape
        Object.values(obj(e.clinical)).some(filled) || Object.values(obj(e.disp)).some(filled);
    });
  }
  // Something beyond who the patient is: a complaint, a value, a mark, an image.
  const hasExamData = rec => hasData(rec, true);
  // Turns the localStorage study shape into an encounter, writing real images
  // into `files`. Synchronous so it can run inside the upgrade transaction.
  function legacyToEncounter(d, tx, extra) {
    const eyes = {};
    ['OD', 'OS'].forEach(k => {
      const src = obj(obj(d.eyes)[k]);
      const eo = normEye(src);
      eo.imgRef = null;
      if (src.imgSample === true) { eo.imgSample = true; eo.sampleVer = 1; }   // the sample is regenerated, never stored
      else if (typeof src.img === 'string' && src.img.indexOf('data:') === 0) {
        const blob = dataUrlToBlob(src.img);
        if (blob) {
          const f = newFileRecord({ blob, w: eo.w, h: eo.h, source: 'migrated', guessEye: k });
          tx.objectStore('files').put(f);
          eo.imgRef = { fileId: f.id, sopUID: null, contentKey: null };
          eo.imgSample = false;
          // Studies saved before the imgSample flag existed: a 1000x1000 JPEG is
          // very likely the generated sample. Flag it so it is never sent silently.
          if (!('imgSample' in src) && eo.w === 1000 && eo.h === 1000 && /jpe?g/.test(blob.type)) eo.possibleSample = true;
        }
      }
      eyes[k] = eo;
    });
    return newEncounter(Object.assign({ meta: obj(d.meta), dispense: obj(d.dispense), eyes }, extra || {}));
  }

  // ---------- promise helpers ----------
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(mapErr(r.error)); });
  function txDone(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      // No onerror: preventDefault() there would CANCEL the abort and commit a
      // half-written transaction. A failed request aborts it; onabort reports.
      tx.onabort = () => rej(tx._code ? err(tx._code) : mapErr(tx.error || err('abort')));
    });
  }
  function kvGet(db, k) { return reqP(db.transaction('kv').objectStore('kv').get(k)).then(r => r ? r.v : undefined); }
  function kvPut(db, k, v) { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ k, v }); return txDone(tx); }
  function kvDel(db, k) { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); return txDone(tx); }
  // Branding reset: the logo goes from kv AND from the verbatim pre-migration copy
  // kept in legacyRaw, in one transaction, so "reset" cannot leave a copy behind.
  function forgetLogo(db) {
    const tx = db.transaction('kv', 'readwrite'), kv = tx.objectStore('kv');
    kv.delete('brandLogo');
    const g = kv.get('legacyRaw');
    g.onsuccess = () => { const r = g.result; if (r && r.v && r.v.logo != null) kv.put({ k: 'legacyRaw', v: Object.assign({}, r.v, { logo: null }) }); };
    return txDone(tx);
  }
  function getEncounter(db, id) { return reqP(db.transaction('encounters').objectStore('encounters').get(id)).then(r => r ? normalizeEncounter(r) : null); }
  function getFile(db, id) { return reqP(db.transaction('files').objectStore('files').get(id)).then(r => r || null); }
  function listEncounters(db) { return reqP(db.transaction('encounters').objectStore('encounters').getAll()).then(a => a.map(normalizeEncounter)); }

  // Compare-and-swap: the write lands only if nobody else wrote this record since
  // we read it (rev === baseRev; null = "I believe it does not exist yet").
  // Another tab's newer save is never silently overwritten.
  // opts.file: a files record written in the SAME transaction, so an image and
  // the encounter that points at it commit together or not at all. If the same
  // bytes are already stored (srcSha256), that record is reused instead.
  // opts.outbox: {put:[items], del:[ids]} — DICOM outbox changes committed in the SAME
  // transaction, so an identity minted for a send (StudyInstanceUID, SOP UIDs) is never
  // queued without being stored on the visit, nor stored without being queued.
  function putEncounter(db, rec, baseRev, opts) {
    opts = opts || {};
    const stores = ['encounters'].concat(opts.file ? ['files'] : [], rec.patientRef ? ['patients'] : [], opts.outbox ? ['outbox'] : []);
    const tx = db.transaction(stores, 'readwrite');
    const done = txDone(tx);
    let newRev = null, fileId = null;
    const es = tx.objectStore('encounters');
    const writeEnc = () => {
      const g = es.get(rec.id);
      g.onsuccess = () => {
        const cur = g.result, curRev = cur ? (+cur.rev || 0) : null;
        if (curRev !== (baseRev == null ? null : baseRev)) { tx._code = 'conflict'; tx.abort(); return; }
        newRev = (curRev || 0) + 1;
        rec.rev = newRev;
        es.put(rec);
        if (opts.outbox) {
          const os = tx.objectStore('outbox');
          // Never pulled from under a send in progress: that object may already be at the
          // archive, and its completion must still be recorded (kv sentId:<visit>).
          (opts.outbox.del || []).forEach(id => { os.get(id).onsuccess = ev => { const o = ev.target.result; if (o && o.state !== 'sending') os.delete(id); }; });
          (opts.outbox.put || []).forEach(o => os.put(o));
        }
        // The patient list is sorted by last activity: touch the patient in the same
        // transaction, so the order never disagrees with what was saved.
        if (rec.patientRef) {
          const ps = tx.objectStore('patients'), pg = ps.get(rec.patientRef);
          pg.onsuccess = () => { const p = pg.result; if (p && !p.deletedAt && !p.purged) ps.put(Object.assign({}, p, { updated: now() })); };
        }
      };
    };
    if (opts.file) placeFile(tx.objectStore('files'), opts.file, id => { fileId = id; if (opts.ref) opts.ref.fileId = id; writeEnc(); });
    else writeEnc();
    return done.then(() => ({ rev: newRev, fileId }));
  }
  // Stores a files record inside the caller's transaction, reusing the record that
  // already holds the same bytes (srcSha256). The lookup and the put share the
  // transaction, so a gcFiles in another tab either ran before (the bytes are
  // written again) or sees the reference this transaction commits.
  function placeFile(fs, f, then) {
    if (!f.srcSha256) { fs.put(f); then(f.id); return; }
    const q = fs.index('srcSha256').get(f.srcSha256);
    q.onsuccess = () => {
      const ex = q.result;
      if (ex && ex.blob) then(ex.id);
      else { if (ex) f.id = ex.id; fs.put(f); then(f.id); }   // revive a tombstone under its id
    };
  }

  // ---------- open + migration ----------
  function createSchema(db) {
    db.createObjectStore('kv', { keyPath: 'k' });
    const p = db.createObjectStore('patients', { keyPath: 'id' });
    p.createIndex('patientId', 'patientId'); p.createIndex('nameKey', 'nameKey'); p.createIndex('updated', 'updated');
    const e = db.createObjectStore('encounters', { keyPath: 'id' });
    e.createIndex('patientRef', 'patientRef'); e.createIndex('patientDate', ['patientRef', 'meta.date']); e.createIndex('updated', 'updated');
    const f = db.createObjectStore('files', { keyPath: 'id' });
    f.createIndex('srcSha256', 'srcSha256', { unique: true }); f.createIndex('state', 'state');
    const o = db.createObjectStore('outbox', { keyPath: 'id' });
    o.createIndex('state', 'state'); o.createIndex('encounterId', 'encounterId'); o.createIndex('nextAt', 'nextAt');
  }
  function lsGet(ls, k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
  function lsDel(ls, k) { try { if (ls) ls.removeItem(k); } catch (e) { } }
  function lsKeys(ls) { try { return ls ? Object.keys(ls) : []; } catch (e) { return []; } }

  // Inside the upgrade transaction: only one connection ever runs it, so two
  // tabs opening at once cannot migrate twice. The localStorage keys are NOT
  // removed here — only after the copy has been read back and compared.
  function migrateInUpgrade(tx, ls) {
    const put = (k, v) => tx.objectStore('kv').put({ k, v });
    put('schema', DB_VERSION); put('installId', uuid());
    const raw = lsGet(ls, LEGACY_STUDY), logo = lsGet(ls, LEGACY_LOGO);
    if (raw == null && logo == null) return { status: 'none' };
    const lr = { ophtha: raw, logo, encId: null, at: now() };
    if (logo && /^data:image\//.test(logo)) put('brandLogo', { dataUrl: logo });
    let st = 'migrated';
    if (raw != null) {
      let d = null; try { d = JSON.parse(raw); } catch (e) { }
      if (d && typeof d === 'object' && d.eyes) {
        const rec = legacyToEncounter(d, tx);
        tx.objectStore('encounters').put(rec);
        put('current', { id: rec.id });
        lr.encId = rec.id;
      } else st = 'corrupt';   // kept verbatim in legacyRaw; nothing is deleted
    }
    put('legacyRaw', lr);
    return { status: st };
  }

  // Resolves {db, migration}. Rejects with code 'version' (written by a newer
  // Retina: the caller must go read-only, never start an empty study),
  // 'unavailable' / 'timeout' / other (caller falls back to memory).
  // 'blocked' is NOT a rejection: onBlocked fires and the open keeps waiting.
  function open(opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      let idb = null;
      try { idb = (typeof indexedDB !== 'undefined') ? indexedDB : null; } catch (e) { }
      if (!idb) { reject(err('unavailable')); return; }
      let req, migration = { status: 'none' }, settled = false, blocked = false;
      const timer = setTimeout(() => { if (!blocked && !settled) { settled = true; reject(err('timeout')); } }, opts.timeoutMs || OPEN_TIMEOUT_MS);
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); reject(mapErr(e)); return; }
      req.onupgradeneeded = ev => {
        const db = req.result, tx = req.transaction;
        // Future versions add cases here; nothing ever falls through to a destructive step.
        switch (ev.oldVersion) {
          case 0:
            createSchema(db);
            try { migration = migrateInUpgrade(tx, opts.ls); }
            catch (e) { migration = { status: 'failed', error: String(e && e.message || e) }; }
        }
      };
      req.onblocked = () => { blocked = true; if (opts.onBlocked) opts.onBlocked(); };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        if (settled) { try { db.close(); } catch (e) { } return; }   // too late: the page already went to memory mode
        settled = true; resolve({ db, migration });
      };
      req.onerror = ev => { clearTimeout(timer); if (ev && ev.preventDefault) ev.preventDefault(); if (!settled) { settled = true; reject(mapErr(req.error)); } };
    });
  }

  // ---------- after-open recovery ----------
  // Canonical JSON (sorted keys) so a key-order difference is not a mismatch.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  // What must survive the migration exactly: every field a human entered, every
  // mark, the disc size and the image dimensions. Pixels are compared separately.
  function legacyProjection(d) {
    const out = { meta: obj(d.meta), dispense: obj(d.dispense), eyes: {} };
    ['OD', 'OS'].forEach(k => { const e = normEye(obj(obj(d.eyes)[k]));
      out.eyes[k] = { w: e.w, h: e.h, discDiaMm: e.discDiaMm, marks: e.marks, clinical: e.clinical, disp: e.disp }; });
    return out;
  }
  async function bytesEqual(blob, dataUrl) {
    const ref = dataUrlToBlob(dataUrl);
    if (!ref || !blob || ref.size !== blob.size) return false;
    const a = new Uint8Array(await blob.arrayBuffer()), b = new Uint8Array(await ref.arrayBuffer());
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  async function verifyMigration(db, ls) {
    const lr = await kvGet(db, 'legacyRaw');
    if (!lr) return { status: 'none' };
    const done = await kvGet(db, 'migratedLS');
    if (done) {
      if (now() - (+done.at || 0) > LEGACY_KEEP_MS) await kvDel(db, 'legacyRaw');
      return { status: 'done' };
    }
    let ok = true, reason = '';
    if (lr.ophtha != null) {
      let d = null; try { d = JSON.parse(lr.ophtha); } catch (e) { }
      if (!d || !d.eyes || !lr.encId) return { status: 'corrupt' };
      const rec = await getEncounter(db, lr.encId);
      if (!rec) { ok = false; reason = 'missing-encounter'; }
      else {
        const a = legacyProjection(d), b = legacyProjection(rec);
        b.meta = {}; Object.keys(a.meta).forEach(k => { b.meta[k] = rec.meta[k]; });
        if (canon(a) !== canon(b)) { ok = false; reason = 'fields'; }
        for (const k of ['OD', 'OS']) {
          const src = obj(d.eyes[k]);
          if (src.imgSample === true || typeof src.img !== 'string' || src.img.indexOf('data:') !== 0) continue;
          const ref = rec.eyes[k].imgRef, f = ref && await getFile(db, ref.fileId);
          if (!f || !await bytesEqual(f.blob, src.img)) { ok = false; reason = 'image-' + k; }
        }
      }
    }
    if (lr.logo && /^data:image\//.test(lr.logo)) {
      const L = await kvGet(db, 'brandLogo');
      if (!L || L.dataUrl !== lr.logo) { ok = false; reason = reason || 'logo'; }
    }
    if (!ok) return { status: 'unverified', reason };
    // Remove a key only if it still holds what was migrated: an old tab may have
    // written newer data since, and that is picked up by recoverLegacy instead.
    const keys = [];
    if (lr.ophtha != null && lsGet(ls, LEGACY_STUDY) === lr.ophtha) { lsDel(ls, LEGACY_STUDY); keys.push(LEGACY_STUDY); }
    if (lr.logo != null && lsGet(ls, LEGACY_LOGO) === lr.logo) { lsDel(ls, LEGACY_LOGO); keys.push(LEGACY_LOGO); }
    await kvPut(db, 'migratedLS', { at: now(), keys });
    return { status: 'verified' };
  }

  // A copy is a new encounter: new id, fresh DICOM identity, a reason flag.
  function asCopy(json, reason) {
    const r = normalizeEncounter(json);
    const t = now();
    return Object.assign(r, { id: 'e_' + uuid(), rev: 0, created: t, updated: t, recovered: reason, enc: emptyEnc(), deletedAt: null });
  }
  // files: [{file, ref}] written in the same transaction (see placeFile), so a copy
  // made from a tab's memory carries its own pixels instead of pointing at a file
  // the visit it was copied from may since have dropped. ref.fileId is updated.
  function putNew(db, rec, files) {
    files = files || [];
    const tx = db.transaction(files.length ? ['encounters', 'files'] : ['encounters'], 'readwrite');
    const done = txDone(tx);
    rec.rev = 1;
    let left = files.length;
    const put = () => tx.objectStore('encounters').put(rec);
    if (!left) put();
    else files.forEach(x => placeFile(tx.objectStore('files'), x.file, id => { x.ref.fileId = id; if (--left === 0) put(); }));
    return done.then(() => rec);
  }

  // Runs once per boot after open(). Returns the encounter to show plus what was
  // recovered, so the page can say so. Every recovered item is kept as a record
  // first and only then removed from localStorage; a failure leaves it in place.
  // Each recovery step is guarded on its own: a full disk or a racing tab during
  // recovery must not hide every stored visit behind memory mode. A failed step
  // leaves its key for the next start and is reported as 'recovery-failed'; only
  // reading 'current' or creating the first visit may make this reject.
  // opts.liveSessions: session ids of Retina tabs still open (Web Locks). Their
  // journals and orphan copies are still being written; adopting them now would
  // duplicate the visit or push the open tab into a conflict.
  async function bootLoad(db, ls, opts) {
    opts = opts || {};
    const live = opts.liveSessions || new Set();
    const out = { verify: null, recovered: [], rec: null };
    const failed = (step, e) => out.recovered.push({ kind: 'recovery-failed', step, code: String(e && e.code || e), opened: false });
    try { out.verify = await verifyMigration(db, ls); } catch (e) { out.verify = { status: 'unverified', reason: String(e && e.code || e) }; }
    const cur = await kvGet(db, 'current');
    let rec = cur && cur.id ? await getEncounter(db, cur.id) : null;
    if (rec && rec.deletedAt) rec = null;
    const adopt = async (copy, kind) => {
      // An empty current visit is replaced by the recovered one, so it is in
      // front of the user. Otherwise the copy is kept beside it.
      await putNew(db, copy);
      if (!rec || !hasData(rec)) {
        try { await kvPut(db, 'current', { id: copy.id }); rec = copy; out.recovered.push({ kind, id: copy.id, opened: true }); return; }
        catch (e) { }   // the copy is stored; it is simply not the one opened
      }
      out.recovered.push({ kind, id: copy.id, opened: false });
    };

    // 1. A localStorage study written AFTER migration: an old tab or a downgrade.
    try {
      const lr = await kvGet(db, 'legacyRaw');
      const raw = lsGet(ls, LEGACY_STUDY);
      // Identical to what was migrated = the original, waiting for verification.
      if (raw != null && !(lr && lr.ophtha === raw)) {
        let d = null; try { d = JSON.parse(raw); } catch (e) { }
        if (d && d.eyes && hasData(d)) {
          const tx = db.transaction(['encounters', 'files'], 'readwrite');
          const copy = legacyToEncounter(d, tx, { recovered: 'legacy' });
          copy.rev = 1; tx.objectStore('encounters').put(copy);
          await txDone(tx);
          lsDel(ls, LEGACY_STUDY);   // stored: from here on a failure must not import it twice
          out.recovered.push({ kind: 'legacy', id: copy.id, opened: false });
          if (!rec || !hasData(rec)) {
            try { await kvPut(db, 'current', { id: copy.id }); rec = copy; out.recovered[out.recovered.length - 1].opened = true; } catch (e) { }
          }
        } else if (d && d.eyes) lsDel(ls, LEGACY_STUDY);   // an old tab's empty sample study: nothing to keep
      }
      const logo = lsGet(ls, LEGACY_LOGO);
      if (logo != null && !(lr && lr.logo === logo)) {
        if (/^data:image\//.test(logo)) await kvPut(db, 'brandLogo', { dataUrl: logo });
        lsDel(ls, LEGACY_LOGO);
      }
    } catch (e) { failed('legacy', e); }

    // 2. Journals: what a tab still had unsaved when it was closed.
    for (const k of lsKeys(ls)) {
      if (k.indexOf(JOURNAL_PREFIX) !== 0) continue;
      let j = null; try { j = JSON.parse(lsGet(ls, k)); } catch (e) { }
      if (!j || !j.json || !j.json.id) { lsDel(ls, k); continue; }
      if (j.session != null && live.has(String(j.session))) continue;   // its tab is still open (hidden): it clears or rewrites this itself
      try {
        const stored = await getEncounter(db, j.json.id);
        let applied = false;
        if (stored && stored.rev === j.baseRev) {
          // Nobody wrote since: the journal is simply the newer state.
          const next = normalizeEncounter(Object.assign({}, j.json, { rev: stored.rev }));
          try {
            await putEncounter(db, next, stored.rev);
            applied = true;
            if (rec && rec.id === next.id) rec = next;
            out.recovered.push({ kind: 'journal-applied', id: next.id, opened: !!(rec && rec.id === next.id) });
          } catch (e) { if (!(e && e.code === 'conflict')) throw e; }   // another tab replayed or wrote it first: keep ours as a copy
        }
        if (!applied && hasData(j.json)) {
          // Someone wrote in between: never pick a winner silently, keep both.
          await adopt(asCopy(j.json, 'journal'), 'journal');
        }
        lsDel(ls, k);
      } catch (e) {
        failed('journal', e);
        // Moved off the per-visit key: this tab now has the same visit open, and its
        // own close-time journal (or the clearJournal after its next save) would
        // otherwise overwrite or delete the changes that could not be recovered.
        if (k === JOURNAL_PREFIX + j.json.id) {
          try { ls.setItem(k + '~' + now(), lsGet(ls, k)); lsDel(ls, k); } catch (x) { }
        }
      }
    }
    // 3. Orphans: sessions that ran in memory mode because storage was unavailable.
    for (const k of lsKeys(ls)) {
      if (k.indexOf(ORPHAN_PREFIX) !== 0 || k === ORPHAN_PREFIX + opts.sessionTs) continue;
      if (live.has(k.slice(ORPHAN_PREFIX.length))) continue;   // that memory-mode tab is still open and still writing it
      let j = null; try { j = JSON.parse(lsGet(ls, k)); } catch (e) { }
      try {
        if (j && j.json && hasData(j.json)) await adopt(asCopy(j.json, 'orphan'), 'orphan');
        lsDel(ls, k);
      } catch (e) { failed('orphan', e); }
    }

    if (!rec) {
      rec = newEncounter(opts.defaults);
      await putNew(db, rec);
      await kvPut(db, 'current', { id: rec.id });
    }
    out.rec = rec;
    // Housekeeping that may fail without consequence. Files named by a journal or
    // orphan copy left for a still-open tab (or a failed step) are kept for it.
    gcFiles(db, pendingFileIds(ls)).catch(() => { });
    backfillHashes(db).catch(() => { });
    return out;
  }

  // Images replaced in a visit leave their old file unreferenced. Collect them in
  // one transaction over every store that can hold a reference, so a reference
  // written concurrently by another tab is either seen or not yet committed.
  function pendingFileIds(ls) {
    const ids = new Set();
    for (const k of lsKeys(ls)) {
      if (k.indexOf(JOURNAL_PREFIX) !== 0 && k.indexOf(ORPHAN_PREFIX) !== 0) continue;
      let j = null; try { j = JSON.parse(lsGet(ls, k)); } catch (e) { }
      const e = j && j.json && j.json.eyes;
      if (e) ['OD', 'OS'].forEach(x => { const y = obj(e[x]);
        [y.imgRef].concat(Array.isArray(y.gallery) ? y.gallery : []).forEach(r => { if (r && r.fileId) ids.add(String(r.fileId)); }); });
    }
    return ids;
  }
  function gcFiles(db, keep) {
    const tx = db.transaction(['encounters', 'outbox', 'files'], 'readwrite');
    const done = txDone(tx);
    const used = new Set(keep || []);
    const add = r => { if (r && r.fileId) used.add(r.fileId); };
    tx.objectStore('encounters').getAll().onsuccess = ev => {
      ev.target.result.forEach(r => {
        const n = normalizeEncounter(r);
        ['OD', 'OS'].forEach(k => { add(n.eyes[k].imgRef); n.eyes[k].gallery.forEach(add); });
        n.attachments.forEach(add);
      });
      tx.objectStore('outbox').getAll().onsuccess = ev2 => {
        ev2.target.result.forEach(o => { if (o.state !== 'sent' && o.fileId) used.add(o.fileId); });
        const fs = tx.objectStore('files');
        fs.index('state').openCursor('filed').onsuccess = ev3 => {
          const c = ev3.target.result; if (!c) return;
          // Bytes go; the hash of the original stays as a tombstone (as discardInbox
          // writes), or the desktop watcher — which offers the whole folder again at
          // every launch — would bring a removed or purged picture back into the Inbox,
          // where it could be filed to the wrong patient. Folder discovery skips a
          // tombstone; Add files, Load image and backup import revive it (placeFile,
          // addInboxFile manual). Only the hash is kept: no bytes, name or path.
          const f = c.value;
          if (!used.has(f.id)) {
            if (f.srcSha256) c.update({ id: f.id, kind: f.kind, state: 'discarded', blob: null, size: 0, srcSha256: f.srcSha256, added: now() });
            else c.delete();
          }
          c.continue();
        };
      };
    };
    return done;
  }
  // Migrated images were written inside the synchronous upgrade, where hashing
  // (async) is impossible. Fill the hashes in now; one file per transaction so a
  // duplicate (same photo in both eyes) fails alone on the unique index.
  async function backfillHashes(db) {
    const all = await reqP(db.transaction('files').objectStore('files').getAll());
    for (const f of all) {
      if (f.srcSha256 || !f.blob) continue;
      const h = await sha256Hex(f.blob); if (!h) return;
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(Object.assign({}, f, { sha256: h, srcSha256: h }));
      await txDone(tx).catch(() => { });
    }
  }

  // ============================================================
  // Patients, visit history, soft delete (item 2)
  // ============================================================
  // Search and matching ignore case, accents and punctuation: "José  Pérez" and
  // "jose perez" are the same person as far as finding them goes. The record keeps
  // the name exactly as typed; only this derived key is normalised.
  function nameKey(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  const idKey = s => String(s == null ? '' : s).trim().toLowerCase();
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  // Upper bounds for free text in records and backups. They exist to refuse absurd
  // input, not to shorten real notes: no form field has a smaller maxlength, so a
  // backup can always hold what the device holds (validation rejects, never trims).
  const SHORT_CAP = 10000, TEXT_CAP = 100000;
  function normalizePatient(p) {
    p = obj(p);
    // Sanity bounds only, far above anything typed: the visit keeps the value in full,
    // and a shorter cap here would make every comparison with it a false difference.
    const name = str(p.name, SHORT_CAP);
    return { id: String(p.id || ''), patientId: str(p.patientId, SHORT_CAP), name, nameKey: nameKey(name), dob: str(p.dob, 10),
      created: +p.created || now(), updated: +p.updated || +p.created || now(), deletedAt: +p.deletedAt || null,
      purged: !!p.purged || undefined };
  }
  function newPatient(meta) {
    const t = now(); meta = obj(meta);
    return normalizePatient({ id: 'p_' + uuid(), patientId: String(meta.patientId || '').trim(), name: String(meta.name || '').trim(), dob: meta.dob || '', created: t, updated: t });
  }
  // Which patient a visit with these details belongs to. Pure, so the rules are unit
  // tested. Never links on a guess: an ID that matches a patient whose name and date
  // of birth both differ is a 'conflict' the user resolves (two clinics, two people,
  // one typo), and an ambiguous match leaves the visit unfiled rather than pick one.
  //   none     — no ID and no name yet: the visit stays unfiled
  //   link     — {patient}: exactly one patient agrees
  //   conflict — {patient}: the ID is taken by someone whose name and DOB both differ
  //   create   — nobody matches: a new patient from these details
  // A new patient is only made from an ID, or from a name AND a date of birth. A name
  // alone is half typed (the form asks for the date of birth next): creating from it
  // would duplicate a returning patient whose date of birth has not been typed yet.
  // opts.final (the visit is being left): a name alone then makes a patient too,
  // unless someone with that name exists — guessing which is not ours to do, so the
  // visit stays unfiled and can be filed from the Patients list.
  function decideLink(patients, meta, opts) {
    meta = obj(meta);
    const live = (patients || []).filter(p => p && !p.deletedAt && !p.purged);
    const id = idKey(meta.patientId), nk = nameKey(meta.name), dob = String(meta.dob || '').trim();
    if (!id && !nk) return { action: 'none' };
    const newest = a => a.slice().sort((x, y) => (y.updated || 0) - (x.updated || 0))[0];
    if (id) {
      const same = live.filter(p => idKey(p.patientId) === id);
      if (same.length) {
        // A blank name and date of birth do not disagree with anyone: an ID typed on its
        // own (the first field of the form) links, and the details are filled in from it.
        const agree = same.filter(p => (!nk && !dob) || (nk && p.nameKey === nk) || (dob && p.dob === dob) || !p.nameKey);
        if (agree.length === 1) return { action: 'link', patient: agree[0] };
        const exact = agree.filter(p => nk && p.nameKey === nk && (!dob || !p.dob || p.dob === dob));
        if (exact.length === 1) return { action: 'link', patient: exact[0] };
        if (agree.length > 1) return { action: 'none', ambiguous: true };
        return { action: 'conflict', patient: newest(same) };
      }
    }
    // Name + date of birth, and the IDs do not contradict (a blank ID on either side
    // does not: a returning patient is often typed without the ID).
    if (nk && dob) {
      const m = live.filter(p => p.nameKey === nk && p.dob === dob && (!p.patientId || !id || idKey(p.patientId) === id));
      if (m.length === 1) return { action: 'link', patient: m[0] };
      if (m.length > 1) return { action: 'none', ambiguous: true };
    }
    if (id || (nk && dob)) return { action: 'create' };
    if (opts && opts.final) return live.some(p => p.nameKey === nk) ? { action: 'none', ambiguous: true } : { action: 'create' };
    return { action: 'none', partial: true };
  }
  // How a linked visit's details differ from its patient record.
  //   same     — nothing to do
  //   fill     — the visit adds a value the patient lacked, or changes only case,
  //              accents, spacing or the date of birth: a correction, not a new person
  //   identity — the ID or the name is now a different one: possibly another patient
  //              typed over this visit, so the patient record is never changed silently
  function identityDiff(p, meta) {
    meta = obj(meta); p = obj(p);
    const vid = idKey(meta.patientId), pid = idKey(p.patientId), vnk = nameKey(meta.name), pnk = p.nameKey || nameKey(p.name);
    if ((vid && pid && vid !== pid) || (vnk && pnk && vnk !== pnk)) return 'identity';
    const vname = String(meta.name || '').trim(), vpid = String(meta.patientId || '').trim(), vdob = String(meta.dob || '').trim();
    if ((vpid && vpid !== p.patientId) || (vname && vname !== p.name) || (vdob && vdob !== p.dob)) return 'fill';
    return 'same';
  }
  // Visits of one patient in clinical order: exam date, then creation time.
  function visitOrder(a, b) {
    const da = String(a.meta && a.meta.date || ''), dbb = String(b.meta && b.meta.date || '');
    return da < dbb ? -1 : da > dbb ? 1 : (a.created || 0) - (b.created || 0);
  }
  // The visit before `rec` for the same patient: the newest one that is earlier by
  // date, or on the same date but created earlier. Never `rec` itself, never deleted.
  // Skipped too: a visit with nothing examined in it (it would show a card of dashes
  // and hide the real earlier exam), and, given the patient, a visit whose details now
  // name someone else (an unanswered "this visit belongs to…" question): its values
  // must never be shown as this patient's history.
  function previousVisit(list, rec, patient) {
    const prior = (list || []).filter(r => r && r.id !== rec.id && !r.deletedAt && !r.purged && visitOrder(r, rec) < 0 &&
      hasExamData(r) && !(patient && identityDiff(patient, r.meta) === 'identity'));
    return prior.sort(visitOrder).pop() || null;
  }
  function listPatients(db) { return reqP(db.transaction('patients').objectStore('patients').getAll()).then(a => a.map(normalizePatient)); }
  function getPatient(db, id) { return reqP(db.transaction('patients').objectStore('patients').get(id)).then(r => r ? normalizePatient(r) : null); }
  function putPatient(db, p) { const tx = db.transaction('patients', 'readwrite'); tx.objectStore('patients').put(normalizePatient(p)); return txDone(tx); }
  function listByPatient(db, pid) {
    return reqP(db.transaction('encounters').objectStore('encounters').index('patientRef').getAll(pid)).then(a => a.map(normalizeEncounter));
  }
  // get → change → put in one transaction, for visits that are NOT the one open in
  // this tab (the open one goes through putEncounter's compare-and-swap instead).
  // fn returns false to leave the record alone. The rev bump makes a tab that has the
  // visit open hit a conflict rather than overwrite this change.
  function updateEncounter(db, id, fn, stores) {
    const tx = db.transaction(['encounters'].concat(stores || []), 'readwrite');
    const done = txDone(tx); let out = null;
    const es = tx.objectStore('encounters'), g = es.get(id);
    g.onsuccess = () => {
      if (!g.result) { tx._code = 'not-found'; tx.abort(); return; }
      const rec = normalizeEncounter(g.result);
      if (fn(rec, tx) === false) return;
      rec.rev = (+g.result.rev || 0) + 1; rec.updated = now();
      es.put(rec); out = rec;
    };
    return done.then(() => out);
  }
  // Non-sent DICOM outbox items per visit. A visit with items still waiting is not
  // deleted by default, and never while one is being sent.
  function outboxCounts(db, encIds) {
    const want = new Set(encIds), out = { unsent: 0, sending: 0 };
    return reqP(db.transaction('outbox').objectStore('outbox').getAll()).then(a => {
      a.forEach(o => { if (!want.has(o.encounterId) || o.state === 'sent') return; out.unsent++; if (o.state === 'sending') out.sending++; });
      return out;
    });
  }
  // Visits whose objects are on hold: in Recently deleted (or purged / gone). The sender
  // skips their outbox rows, restoring the visit releases them, a purge removes them.
  function heldEncounters(db, items) {
    const ids = [...new Set((items || []).filter(o => o && o.state !== 'sent' && o.encounterId).map(o => o.encounterId))];
    const held = new Set();
    if (!ids.length) return Promise.resolve(held);
    const tx = db.transaction('encounters'), es = tx.objectStore('encounters');
    ids.forEach(id => { es.get(id).onsuccess = ev => { const r = ev.target.result; if (!r || r.purged || r.deletedAt) held.add(id); }; });
    return txDone(tx).then(() => held);
  }
  // Soft delete: hidden, kept in "Recently deleted", purged after PURGE_AFTER_MS or by
  // the user. A patient's visits are deleted with the same timestamp, so restoring the
  // patient brings back exactly those and not a visit deleted on its own earlier.
  const PURGE_AFTER_MS = 30 * 864e5;
  function setDeleted(db, kind, id, at) {
    const tx = db.transaction(['patients', 'encounters'], 'readwrite'), done = txDone(tx);
    const ps = tx.objectStore('patients'), es = tx.objectStore('encounters');
    const mark = (r, v) => { const n = Object.assign({}, r, { deletedAt: v, rev: (+r.rev || 0) + 1, updated: now() }); es.put(n); };
    if (kind === 'encounter') {
      es.get(id).onsuccess = ev => { const r = ev.target.result; if (!r || r.purged) { tx._code = 'not-found'; tx.abort(); return; }
        if (at ? !r.deletedAt : !!r.deletedAt) mark(r, at); };
    } else {
      ps.get(id).onsuccess = ev => {
        const p = ev.target.result; if (!p || p.purged) { tx._code = 'not-found'; tx.abort(); return; }
        const was = p.deletedAt;
        ps.put(Object.assign({}, p, { deletedAt: at, updated: now() }));
        es.index('patientRef').getAll(id).onsuccess = ev2 => ev2.target.result.forEach(r => {
          if (r.purged) return;
          if (at && !r.deletedAt) mark(r, at);
          else if (!at && was && r.deletedAt === was) mark(r, null);
        });
      };
    }
    return done;
  }
  const deleteEncounter = (db, id) => setDeleted(db, 'encounter', id, now());
  const restoreEncounter = (db, id) => setDeleted(db, 'encounter', id, null);
  const deletePatient = (db, id) => setDeleted(db, 'patient', id, now());
  const restorePatient = (db, id) => setDeleted(db, 'patient', id, null);
  // Purge leaves a tombstone ({id, purged, rev}) so importing an old backup does not
  // bring a deliberately purged visit back. Its images are then unreferenced and
  // gcFiles drops their bytes (keeping the hash, so the watched folder does not offer
  // them again). keepEmpty: an empty, never-used visit is simply removed.
  // The visit's DICOM outbox rows (any state: they carry the patient's name, ID, DOB and,
  // unsent, the whole report) and its kv sentId:<visit> go in the same transaction, so a
  // purged patient leaves nothing behind that could still be read or sent. A row being
  // sent at this very moment is deleted too; its sender then finds it gone and records
  // nothing.
  function purge(db, kind, id) {
    const tx = db.transaction(['patients', 'encounters', 'outbox', 'kv'], 'readwrite'), done = txDone(tx);
    const ps = tx.objectStore('patients'), es = tx.objectStore('encounters'), os = tx.objectStore('outbox'), kv = tx.objectStore('kv');
    const dropSends = encId => {
      kv.delete('sentId:' + encId);
      os.index('encounterId').openCursor(encId).onsuccess = ev => { const c = ev.target.result; if (!c) return; c.delete(); c.continue(); };
    };
    const tomb = r => { dropSends(r.id); es.put({ id: r.id, purged: true, deletedAt: r.deletedAt || now(), rev: (+r.rev || 0) + 1, updated: now(), patientRef: null }); };
    if (kind === 'encounter') es.get(id).onsuccess = ev => { const r = ev.target.result; if (r && !r.purged) tomb(r); };
    else if (kind === 'empty') { dropSends(id); es.delete(id); }
    else ps.get(id).onsuccess = ev => {
      const p = ev.target.result; if (!p) return;
      ps.put({ id: p.id, purged: true, deletedAt: p.deletedAt || now(), updated: now() });
      es.index('patientRef').getAll(id).onsuccess = ev2 => ev2.target.result.forEach(r => { if (!r.purged) tomb(r); });
    };
    return done;
  }
  // Removes a patient record outright — no tombstone, nothing in Recently deleted —
  // and only while no visit points at it. For a patient this session made from the
  // open visit moments ago that turned out to be someone already on file.
  function dropPatient(db, id) {
    const tx = db.transaction(['patients', 'encounters'], 'readwrite'), done = txDone(tx);
    let dropped = false;
    tx.objectStore('encounters').index('patientRef').count(id).onsuccess = ev => {
      if (ev.target.result === 0) { tx.objectStore('patients').delete(id); dropped = true; }
    };
    return done.then(() => dropped);
  }
  // Boot housekeeping: soft-deleted records older than PURGE_AFTER_MS are purged.
  async function purgeExpired(db, ls) {
    const lim = now() - PURGE_AFTER_MS;
    const ps = (await listPatients(db)).filter(p => p.deletedAt && !p.purged && p.deletedAt < lim);
    for (const p of ps) await purge(db, 'patient', p.id);
    const es = (await listEncounters(db)).filter(r => r.deletedAt && !r.purged && r.deletedAt < lim);
    for (const r of es) await purge(db, 'encounter', r.id);
    if (ps.length || es.length) await gcFiles(db, pendingFileIds(ls));
    return ps.length + es.length;
  }

  // ============================================================
  // Backup (.retinabak): every patient, visit and image in one file
  // ============================================================
  // Container: "CRBK1\n" + 10-digit manifest byte length + manifest JSON + the image
  // bytes back to back. The manifest names each file's offset, length and SHA-256, so
  // an import reads it with Blob.slice and never holds the whole file as one string.
  // With a passphrase the whole container is AES-GCM encrypted:
  //   "CRBK1E\n" + salt(16) + iv(12) + ciphertext   (PBKDF2-SHA256, 600 000 rounds)
  // Left out on purpose: the DICOM outbox, the inbox, soft-deleted and purged records.
  const BAK_MAGIC = 'CRBK1\n', BAK_MAGIC_ENC = 'CRBK1E\n', BAK_FORMAT = 'carino-retina-backup', BAK_VERSION = 1;
  const PBKDF2_ITER = 600000;
  const ID_RE = /^[pef]_[0-9a-f-]{36}$/, HEX64 = /^[0-9a-f]{64}$/, UID_RE = /^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/;
  const enc8 = s => new TextEncoder().encode(s);
  function liveRefs(rec) {
    const ids = [];
    ['OD', 'OS'].forEach(k => { const e = rec.eyes[k]; if (e.imgRef) ids.push(e.imgRef.fileId); e.gallery.forEach(g => ids.push(g.fileId)); });
    rec.attachments.forEach(a => ids.push(a.fileId));
    return ids;
  }
  // Read from ONE readonly transaction: a visit saved by another tab mid-export is
  // either wholly in the backup or wholly not, never with half its images.
  async function packBackup(db, info) {
    if (typeof crypto === 'undefined' || !crypto.subtle) throw err('no-crypto');
    const tx = db.transaction(['patients', 'encounters', 'files', 'outbox']);
    const [pats, encs, files, outbox] = await Promise.all(['patients', 'encounters', 'files', 'outbox'].map(s => reqP(tx.objectStore(s).getAll())));
    const patients = pats.map(normalizePatient).filter(p => !p.deletedAt && !p.purged);
    const pids = new Set(patients.map(p => p.id));
    const encounters = encs.filter(r => !r.purged).map(normalizeEncounter)
      .filter(r => !r.deletedAt && (hasData(r) || (r.patientRef && pids.has(r.patientRef))));
    const need = new Set(); encounters.forEach(r => liveRefs(r).forEach(id => need.add(id)));
    const byId = new Map(files.map(f => [f.id, f]));
    const parts = [], fman = []; let off = 0;
    for (const id of need) {
      const f = byId.get(id); if (!f || !f.blob) continue;   // a dangling reference opens as "Image missing", as it does here
      const sha = await sha256Hex(f.blob);
      const m = {}; ['id', 'kind', 'mime', 'w', 'h', 'origName', 'origMime', 'source', 'exifTaken', 'added', 'guessEye'].forEach(k => { m[k] = f[k] == null ? null : f[k]; });
      Object.assign(m, { size: f.blob.size, sha256: sha, srcSha256: f.srcSha256 || sha, offset: off, length: f.blob.size });
      fman.push(m); parts.push(f.blob); off += f.blob.size;
    }
    const encIds = new Set(encounters.map(r => r.id));
    const unsentLeftOut = outbox.filter(o => o.state !== 'sent' && encIds.has(o.encounterId)).length;
    const manifest = { format: BAK_FORMAT, version: BAK_VERSION, app: 'Carino-Retina', exported: new Date().toISOString(),
      info: obj(info), counts: { patients: patients.length, encounters: encounters.length, files: fman.length },
      patients, encounters: encounters.map(r => { const o = Object.assign({}, r); delete o.recoveredFrom; return o; }), files: fman };
    return { blob: bakContainer(manifest, parts), counts: manifest.counts, unsentLeftOut };
  }
  function bakContainer(manifest, parts) {
    const mj = enc8(JSON.stringify(manifest));
    return new Blob([BAK_MAGIC, String(mj.length).padStart(10, '0'), mj].concat(parts || []), { type: 'application/octet-stream' });
  }
  async function bakKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc8(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptBackup(blob, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await bakKey(pass, salt), await blob.arrayBuffer());
    return new Blob([BAK_MAGIC_ENC, salt, iv, new Uint8Array(ct)], { type: 'application/octet-stream' });
  }
  async function backupKind(blob) {
    const h = new TextDecoder().decode(await blob.slice(0, 7).arrayBuffer());
    return h === BAK_MAGIC_ENC ? 'encrypted' : h.slice(0, 6) === BAK_MAGIC ? 'plain' : 'unknown';
  }
  // → {manifest, body} where body is the Blob the manifest's offsets index into.
  async function readBackup(blob, pass) {
    const kind = await backupKind(blob);
    if (kind === 'unknown') throw err('not-backup');
    if (kind === 'encrypted') {
      if (!pass) throw err('need-passphrase');
      if (typeof crypto === 'undefined' || !crypto.subtle) throw err('no-crypto');
      const head = new Uint8Array(await blob.slice(7, 35).arrayBuffer());
      let pt;
      try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: head.slice(16, 28) }, await bakKey(pass, head.slice(0, 16)), await blob.slice(35).arrayBuffer()); }
      catch (e) { throw err('bad-passphrase'); }
      blob = new Blob([pt]);
      if (await backupKind(blob) !== 'plain') throw err('not-backup');
    }
    const len = parseInt(new TextDecoder().decode(await blob.slice(6, 16).arrayBuffer()), 10);
    if (!(len > 0) || 16 + len > blob.size) throw err('invalid', 'manifest-length');
    let manifest;
    try { manifest = JSON.parse(new TextDecoder().decode(await blob.slice(16, 16 + len).arrayBuffer())); } catch (e) { throw err('invalid', 'manifest-json'); }
    if (!manifest || manifest.format !== BAK_FORMAT) throw err('not-backup');
    if (manifest.version !== BAK_VERSION) throw err('backup-version');
    return { manifest, body: blob.slice(16 + len) };
  }

  // ---- whitelist validation: everything from a file is untrusted ----
  const MARK_KINDS = { 'disc-center': 'pt', 'fovea-center': 'pt', disc: 'ell', cup: 'ell', lesion: 'pt', ruler: 'seg', arrow: 'seg', text: 'pt', free: 'poly' };
  const fin = v => typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e7;
  function bad(detail) { throw err('invalid', detail); }
  const strB = (v, n, what) => { const s = String(v == null ? '' : v); if (s.length > n) bad(what || 'too-long'); return s; };
  // One mark, rebuilt from known fields only. Throws on a wrong shape.
  function cleanMark(m) {
    m = obj(m); const shape = MARK_KINDS[m.kind];
    if (!shape || typeof m.id !== 'string' || !/^m\d{1,9}$/.test(m.id)) bad('mark');
    const o = { id: m.id, kind: m.kind };
    const nums = shape === 'pt' ? ['x', 'y'] : shape === 'ell' ? ['cx', 'cy', 'rx', 'ry'] : shape === 'seg' ? ['x1', 'y1', 'x2', 'y2'] : [];
    nums.forEach(k => { if (!fin(m[k])) bad('mark-' + k); o[k] = m[k]; });
    // A disc or cup with a zero or negative semi-axis cannot be drawn (SVG: an error) and
    // would give a signed CDR and a negative mm/px; the app itself never makes one.
    if (shape === 'ell') ['rx', 'ry'].forEach(k => { if (!(m[k] > 0)) bad('mark-' + k); });
    if (shape === 'poly') {
      if (!Array.isArray(m.pts) || m.pts.length > 200000) bad('mark-pts');
      o.pts = m.pts.map(p => { if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) bad('mark-pt'); return [p[0], p[1]]; });
    }
    if (m.kind === 'lesion') o.ltype = strB(m.ltype, SHORT_CAP, 'mark-ltype');
    if (m.kind === 'text') o.text = strB(m.text, TEXT_CAP, 'mark-text');
    // A lesion pin is created with note:'' (index.html); keep that exact shape so a
    // backup of an untouched pin compares equal to the pin it came from.
    if (m.note != null && (m.note !== '' || m.kind === 'lesion')) o.note = strB(m.note, TEXT_CAP, 'mark-note');
    return o;
  }
  // An eye's marks together: every id once, and one disc / cup / disc-center /
  // fovea-center at most, which is what the UI guarantees and every consumer assumes
  // (removeMark filters by id; singleton() takes the first of a kind).
  const SINGLETON = { disc: 1, cup: 1, 'disc-center': 1, 'fovea-center': 1 };
  function cleanMarks(arr) {
    if (arr == null) return [];
    if (!Array.isArray(arr)) bad('marks');
    const ids = new Set(), kinds = new Set();
    return arr.map(m => {
      const o = cleanMark(m);
      if (ids.has(o.id)) bad('mark-id-dup'); ids.add(o.id);
      if (SINGLETON[o.kind]) { if (kinds.has(o.kind)) bad('mark-singleton'); kinds.add(o.kind); }
      return o;
    });
  }
  // Free-text field maps (clinical, disp, dispense): known-looking keys, string values.
  function cleanFields(x, cap) {
    const o = {};
    Object.keys(obj(x)).forEach(k => {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) bad('field-key');
      const v = x[k];
      if (v == null) return;
      if (typeof v !== 'string' && typeof v !== 'number') bad('field-value');
      o[k] = strB(v, cap || TEXT_CAP, 'field-length');
    });
    return o;
  }
  const META_CAPS = { patientId: SHORT_CAP, name: SHORT_CAP, date: 100, dob: 100, provider: SHORT_CAP, complaint: TEXT_CAP, accession: SHORT_CAP, referring: SHORT_CAP };
  function cleanMeta(m) {
    const o = {};
    Object.keys(obj(m)).forEach(k => { if (META_CAPS[k] && m[k] != null) { if (typeof m[k] === 'object') bad('meta'); o[k] = strB(m[k], META_CAPS[k], 'meta-length'); } });
    ['date', 'dob'].forEach(k => { if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) o[k] = ''; });
    return o;
  }
  const uidOrNull = v => (typeof v === 'string' && v.length <= 64 && UID_RE.test(v)) ? v : null;
  function cleanRef(r, fileIds) {
    r = obj(r);
    if (typeof r.fileId !== 'string' || !fileIds.has(r.fileId)) return null;
    return { fileId: r.fileId, sopUID: uidOrNull(r.sopUID), contentKey: (typeof r.contentKey === 'string' && HEX64.test(r.contentKey)) ? r.contentKey : null };
  }
  const int = (v, lo, hi) => { v = Math.round(+v || 0); return Math.min(hi, Math.max(lo, v)); };
  // An image dimension from a file: a whole number of px, 0–100000 (Infinity → 100000).
  const cleanSize = v => int(v, 0, 100000);
  function cleanEye(e, fileIds) {
    e = obj(e);
    if (e.marks != null && !Array.isArray(e.marks)) bad('marks');
    const ref = cleanRef(e.imgRef, fileIds);
    return {
      imgRef: ref, imgPending: !ref && !!e.imgPending, imgSample: !ref && !!e.imgSample, sampleVer: (!ref && e.imgSample) ? 1 : 0,
      possibleSample: !!e.possibleSample, w: int(e.w, 0, 100000), h: int(e.h, 0, 100000),
      discDiaMm: Math.min(4, Math.max(0.5, +e.discDiaMm || 1.5)),
      marks: cleanMarks(e.marks), clinical: cleanFields(e.clinical), disp: cleanFields(e.disp),
      gallery: (Array.isArray(e.gallery) ? e.gallery : []).map(g => { const r = cleanRef(g, fileIds); if (!r) return null;
        if (g.marks != null && !Array.isArray(g.marks)) bad('gallery-marks');
        return Object.assign(r, { w: int(g.w, 0, 100000), h: int(g.h, 0, 100000), discDiaMm: Math.min(4, Math.max(0.5, +g.discDiaMm || 1.5)), marks: cleanMarks(g.marks), possibleSample: !!g.possibleSample }); }).filter(Boolean)
    };
  }
  function cleanSummary(s) {
    if (!s || typeof s !== 'object') return null;
    const o = { date: str(s.date, 10), eyes: {} };
    ['OD', 'OS'].forEach(k => { const e = obj(obj(s.eyes)[k]), x = {};
      Object.keys(e).forEach(f => { if (!/^[A-Za-z]{1,16}$/.test(f)) return; const v = e[f];
        x[f] = (typeof v === 'number' && isFinite(v)) ? v : v == null ? null : strB(v, TEXT_CAP, 'summary-length'); });
      o.eyes[k] = x; });
    return o;
  }
  function cleanEnc(e) {
    e = obj(e); const d = emptyEnc(), s = obj(e.seriesUIDs), r = obj(e.referral);
    Object.keys(d.seriesUIDs).forEach(k => { d.seriesUIDs[k] = uidOrNull(s[k]); });
    d.studyUID = uidOrNull(e.studyUID); d.reportSeq = int(e.reportSeq, 0, 1e6);
    const si = e.sentIdentity;
    d.sentIdentity = si && typeof si === 'object' ? { patientId: strB(si.patientId, SHORT_CAP, 'sent-identity'), name: strB(si.name, SHORT_CAP, 'sent-identity'), dob: strB(si.dob, 100, 'sent-identity'), studyUID: uidOrNull(si.studyUID) } : null;
    d.referral = { to: strB(r.to, SHORT_CAP, 'referral'), reason: strB(r.reason, TEXT_CAP, 'referral'), includePrev: !!r.includePrev };
    return d;
  }
  const RECOVERED = { legacy: 1, journal: 1, orphan: 1, 'import-copy': 1, copy: 1 };
  // Turns a parsed backup into records that are safe to store. Any shape error
  // rejects the WHOLE file (code 'invalid'); nothing is half-imported. Image bytes
  // are re-hashed against the manifest, so a damaged or edited file is caught here.
  async function validateBackup(parsed) {
    const m = obj(parsed && parsed.manifest), body = parsed && parsed.body;
    if (!Array.isArray(m.patients) || !Array.isArray(m.encounters) || !Array.isArray(m.files)) bad('arrays');
    if (m.patients.length > 1e6 || m.encounters.length > 1e6 || m.files.length > 1e6) bad('size');
    if (typeof crypto === 'undefined' || !crypto.subtle) throw err('no-crypto');
    const t = now(), seen = new Set();
    const once = id => { if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) bad('id'); seen.add(id); return id; };
    const files = [];
    for (const f of m.files) {
      const x = obj(f), id = once(x.id);
      if (id[0] !== 'f') bad('file-id');
      const off = +x.offset, len = +x.length;
      if (!Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 1 || off + len > body.size) bad('file-range');
      if (typeof x.sha256 !== 'string' || !HEX64.test(x.sha256)) bad('file-sha');
      const mime = typeof x.mime === 'string' && /^[\w.+-]{1,40}\/[\w.+-]{1,60}$/.test(x.mime) ? x.mime : 'application/octet-stream';
      const blob = body.slice(off, off + len, mime);
      if (await sha256Hex(blob) !== x.sha256) bad('file-hash');
      const src = (typeof x.srcSha256 === 'string' && HEX64.test(x.srcSha256)) ? x.srcSha256 : x.sha256;
      files.push({ id, kind: x.kind === 'pdf' ? 'pdf' : 'image', state: 'filed', blob, mime, size: len, sha256: x.sha256, srcSha256: src,
        w: int(x.w, 0, 100000), h: int(x.h, 0, 100000), origName: str(x.origName, 255), origMime: str(x.origMime, 100) || mime,
        source: str(x.source, 32) || 'backup', exifTaken: x.exifTaken ? str(x.exifTaken, 32) : null,
        added: Math.min(t, +x.added || t), guessEye: ({ OD: 1, OS: 1, OU: 1 })[x.guessEye] ? x.guessEye : null });
    }
    const fileIds = new Set(files.map(f => f.id));
    const patients = m.patients.map(p => {
      const x = obj(p), id = once(x.id);
      if (id[0] !== 'p') bad('patient-id');
      const n = normalizePatient({ id, patientId: strB(x.patientId, SHORT_CAP, 'patient-length'), name: strB(x.name, SHORT_CAP, 'patient-length'), dob: strB(x.dob, 100, 'patient-length'), created: Math.min(t, +x.created || t), updated: Math.min(t, +x.updated || t) });
      if (n.dob && !/^\d{4}-\d{2}-\d{2}$/.test(n.dob)) n.dob = '';
      delete n.purged; n.deletedAt = null;
      return n;
    });
    const pids = new Set(patients.map(p => p.id));
    const encounters = m.encounters.map(r => {
      const x = obj(r), id = once(x.id);
      if (id[0] !== 'e') bad('encounter-id');
      if (x.attachments != null && !Array.isArray(x.attachments)) bad('attachments');
      const rec = normalizeEncounter({
        id, patientRef: (typeof x.patientRef === 'string' && pids.has(x.patientRef)) ? x.patientRef : null,
        created: Math.min(t, +x.created || t), updated: Math.min(t, +x.updated || t), rev: int(x.rev, 0, 1e9), deletedAt: null,
        meta: cleanMeta(x.meta), dispense: cleanFields(x.dispense),
        eyes: { OD: cleanEye(obj(x.eyes).OD, fileIds), OS: cleanEye(obj(x.eyes).OS, fileIds) },
        attachments: (x.attachments || []).map(a => { const r2 = cleanRef(a, fileIds); return r2 && Object.assign(r2, { eye: ({ OD: 1, OS: 1, OU: 1 })[a.eye] ? a.eye : 'OU' }); }).filter(Boolean),
        enc: cleanEnc(x.enc), summary: cleanSummary(x.summary)
      });
      if (RECOVERED[x.recovered]) rec.recovered = x.recovered; else delete rec.recovered;
      const mb = obj(x.mergeBase);
      if (typeof mb.h === 'string' && HEX64.test(mb.h)) rec.mergeBase = { h: mb.h }; else delete rec.mergeBase;
      return rec;
    });
    return { patients, encounters, files, exported: str(m.exported, 40) };
  }
  // What "the same visit content" means when comparing a backup with what is here:
  // everything a person entered, not bookkeeping (rev, updated, summary).
  // Both sides go through the same cleaners the backup validator uses, so a record
  // stored here and the same record after a backup round trip hash equal (dropped
  // empty values, number → string, clamped sizes). A stored value the cleaners would
  // refuse is compared as it is: it then simply differs.
  function contentCanon(r, mapId) {
    const f = id => (mapId && mapId(id)) || id;
    const ref = x => x ? { fileId: f(x.fileId) } : null;
    const tryC = (fn, v) => { try { return fn(v); } catch (e) { return v; } };
    const marks = a => (a || []).map(m => tryC(cleanMark, m));
    const dia = v => Math.min(4, Math.max(0.5, +v || 1.5));
    const eyes = {};
    ['OD', 'OS'].forEach(k => { const e = r.eyes[k];
      eyes[k] = { imgRef: ref(e.imgRef), imgSample: !e.imgRef && !!e.imgSample, w: int(e.w, 0, 100000), h: int(e.h, 0, 100000), discDiaMm: dia(e.discDiaMm),
        marks: marks(e.marks), clinical: tryC(cleanFields, e.clinical), disp: tryC(cleanFields, e.disp),
        gallery: e.gallery.map(g => ({ fileId: f(g.fileId), marks: marks(g.marks), discDiaMm: dia(g.discDiaMm) })) }; });
    return canon({ meta: tryC(cleanMeta, r.meta), dispense: tryC(cleanFields, r.dispense), eyes,
      attachments: r.attachments.map(a => ({ fileId: f(a.fileId), eye: ({ OD: 1, OS: 1, OU: 1 })[a.eye] ? a.eye : 'OU' })) });
  }
  async function contentHash(r, mapId) { return sha256Hex(new Blob([contentCanon(r, mapId)])); }
  // Decide, per record, what an import does. Reads the current database once; the
  // commit re-checks every visit's rev in its own transaction.
  //   patients: same id → the newer one wins. Another id with the same patient ID
  //     maps onto the existing patient only if the name or date of birth also agrees;
  //     otherwise it is an "ID conflict" and both are kept, separately.
  //   visits: same content → unchanged. Otherwise a three-way decision against the
  //     common version: every visit stored by an import remembers the content hash it
  //     arrived with (mergeBase), and a backup carries the mergeBase its own device
  //     recorded. If this device's copy is still that common version, the incoming one
  //     wins; if the incoming one is, ours stays; if both moved on, the incoming one is
  //     kept as a copy beside ours (recovered:'import-copy') — never overwritten.
  //     Without any common version (both copies come from this device: re-importing an
  //     own backup) the rev lineage decides, and contradicting signals make a copy.
  //   images: de-duplicated by the hash of the original bytes.
  async function planMerge(db, clean) {
    const tx = db.transaction(['patients', 'encounters', 'files']);
    const [pa, ea] = await Promise.all([reqP(tx.objectStore('patients').getAll()), reqP(tx.objectStore('encounters').getAll())]);
    const fileHits = await Promise.all(clean.files.map(f => reqP(tx.objectStore('files').index('srcSha256').get(f.srcSha256))));
    const pById = new Map(pa.map(p => [p.id, normalizePatient(p)])), eById = new Map(ea.map(r => [r.id, r]));
    const liveP = [...pById.values()].filter(p => !p.deletedAt && !p.purged);
    const counts = { patients: clean.patients.length, encounters: clean.encounters.length, files: clean.files.length,
      added: 0, updated: 0, unchanged: 0, copies: 0, idConflicts: 0, patientsAdded: 0 };
    const pMap = new Map(), putPatients = [];
    for (const p of clean.patients) {
      const ex = pById.get(p.id);
      if (ex) {
        pMap.set(p.id, ex.purged || ex.deletedAt ? null : ex.id);
        if (!ex.purged && !ex.deletedAt && p.updated > ex.updated) putPatients.push(p);
        continue;
      }
      const id = idKey(p.patientId);
      const same = id ? liveP.filter(x => idKey(x.patientId) === id) : [];
      const agree = same.filter(x => (p.nameKey && x.nameKey === p.nameKey) || (p.dob && x.dob === p.dob));
      if (agree.length === 1) { pMap.set(p.id, agree[0].id); continue; }
      if (same.length) counts.idConflicts++;
      else if (!id && p.nameKey && p.dob) {
        const m = liveP.filter(x => x.nameKey === p.nameKey && x.dob === p.dob && !x.patientId);
        if (m.length === 1) { pMap.set(p.id, m[0].id); continue; }
      }
      pMap.set(p.id, p.id); putPatients.push(p); counts.patientsAdded++;
    }
    const fMapPre = new Map();   // incoming file id → existing id with the same bytes
    clean.files.forEach((f, i) => { const h = fileHits[i]; if (h && h.blob) fMapPre.set(f.id, h.id); });
    const putEnc = [];   // {rec, expectRev}
    for (const r0 of clean.encounters) {
      const r = Object.assign({}, r0, { patientRef: r0.patientRef ? (pMap.has(r0.patientRef) ? pMap.get(r0.patientRef) : null) : null });
      const inH = await contentHash(r, id => fMapPre.get(id));
      const raw = eById.get(r.id);
      if (!raw) { r.mergeBase = { h: inH }; putEnc.push({ rec: r, expectRev: null }); counts.added++; continue; }
      if (raw.purged || raw.deletedAt) { counts.unchanged++; continue; }   // deleted here on purpose: an old backup does not undo that
      const ex = normalizeEncounter(raw), exH = await contentHash(ex);
      if (exH === inH) { counts.unchanged++; continue; }
      const bases = [ex.mergeBase && ex.mergeBase.h, r.mergeBase && r.mergeBase.h].filter(Boolean);
      let take;
      if (bases.length) take = bases.indexOf(exH) >= 0 ? 'theirs' : bases.indexOf(inH) >= 0 ? 'ours' : 'copy';
      else take = (r.rev > ex.rev && r.updated >= ex.updated) ? 'theirs' : (r.rev < ex.rev && r.updated <= ex.updated) ? 'ours' : 'copy';
      if (take === 'theirs') { r.mergeBase = { h: inH }; putEnc.push({ rec: r, expectRev: ex.rev }); counts.updated++; }
      else if (take === 'ours') counts.unchanged++;
      else { const c = asCopy(r, 'import-copy'); delete c.mergeBase; putEnc.push({ rec: c, expectRev: null }); counts.copies++; }
    }
    const need = new Set(); putEnc.forEach(x => liveRefs(x.rec).forEach(id => need.add(id)));
    const files = clean.files.filter(f => need.has(f.id));
    return { counts, putPatients, putEnc, files };
  }
  // One transaction: images first (de-duplicated in the transaction), then each visit
  // with its references rewritten, each checked against the rev the plan saw. A visit
  // changed meanwhile (another tab) aborts the whole import with 'conflict'.
  function commitMerge(db, plan) {
    const tx = db.transaction(['patients', 'encounters', 'files'], 'readwrite'), done = txDone(tx);
    const fMap = new Map(); let left = plan.files.length;
    plan.putPatients.forEach(p => tx.objectStore('patients').put(p));
    const writeEncs = () => {
      const es = tx.objectStore('encounters');
      const remap = r => { if (r && fMap.has(r.fileId)) r.fileId = fMap.get(r.fileId); };
      plan.putEnc.forEach(({ rec, expectRev }) => {
        ['OD', 'OS'].forEach(k => { remap(rec.eyes[k].imgRef); rec.eyes[k].gallery.forEach(remap); });
        rec.attachments.forEach(remap);
        es.get(rec.id).onsuccess = ev => {
          const cur = ev.target.result, curRev = cur ? (+cur.rev || 0) : null;
          if (curRev !== expectRev) { tx._code = 'conflict'; tx.abort(); return; }
          // Keep the incoming rev lineage (a later import back the other way compares
          // revs), but always above what is here, so an open tab sees a conflict.
          rec.rev = Math.max((curRev || 0) + 1, +rec.rev || 0, 1); es.put(rec);
        };
      });
    };
    if (!left) writeEncs();
    else plan.files.forEach(f => placeFile(tx.objectStore('files'), Object.assign({}, f), id => { fMap.set(f.id, id); if (--left === 0) writeEncs(); }));
    return done.then(() => plan.counts);
  }

  // ============================================================
  // DICOM outbox
  // ============================================================
  // One record per instance to send: {id:'o_…', encounterId, patientLabel, kind:
  // 'report'|'op', eye, fileId, sopClassUID, sopInstanceUID, studyUID, identity,
  // header (OP: every non-pixel attribute, frozen at enqueue), bytes (report: the
  // Part-10 file), size, state:'pending'|'sending'|'failed'|'sent', attempts, nextAt,
  // token, claimedAt, lastError, created, sentAt}.
  // Every state change after enqueue is get → check → put in one transaction, and a
  // send in progress is identified by its token: a record that was discarded, retried
  // or re-claimed meanwhile is left exactly as it is.
  function listOutbox(db) { return reqP(db.transaction('outbox').objectStore('outbox').getAll()); }
  function getOutbox(db, id) { return reqP(db.transaction('outbox').objectStore('outbox').get(id)).then(r => r || null); }
  function outboxTx(db, id, fn) {
    const tx = db.transaction('outbox', 'readwrite'), done = txDone(tx), os = tx.objectStore('outbox');
    let out = null;
    os.get(id).onsuccess = ev => {
      const cur = ev.target.result || null;
      const next = fn(cur);
      if (next === null) { if (cur) os.delete(id); out = null; }
      else if (next) { os.put(next); out = next; }
    };
    return done.then(() => out);
  }
  // pending (due) → sending, with a fresh token. Resolves the claimed record or null.
  function claimOutbox(db, id, token, at) {
    return outboxTx(db, id, cur => (cur && cur.state === 'pending') ? Object.assign({}, cur, { state: 'sending', token, claimedAt: at || now() }) : undefined);
  }
  // Completion: only if the record is still the one this sender claimed.
  function finishOutbox(db, id, token, patch) {
    return outboxTx(db, id, cur => (cur && cur.state === 'sending' && cur.token === token) ? Object.assign({}, cur, patch, { token: null }) : undefined)
      .then(r => !!r);
  }
  function patchOutbox(db, id, fn) { return outboxTx(db, id, cur => cur ? fn(Object.assign({}, cur)) : undefined); }
  function deleteOutbox(db, id) { return outboxTx(db, id, () => null); }
  // A sender that died mid-send leaves 'sending' behind. With Web Locks the next
  // holder of the outbox lock resets them all (olderThan = Infinity); without, only
  // those claimed longer ago than any send can take.
  function resetSending(db, olderThan) {
    const tx = db.transaction('outbox', 'readwrite'), done = txDone(tx), lim = now() - (olderThan || 0);
    let n = 0;
    tx.objectStore('outbox').index('state').openCursor('sending').onsuccess = ev => {
      const c = ev.target.result; if (!c) return;
      if (!olderThan || olderThan === Infinity || (c.value.claimedAt || 0) < lim) {
        c.update(Object.assign({}, c.value, { state: 'pending', token: null, nextAt: now() })); n++;
      }
      c.continue();
    };
    return done.then(() => n);
  }
  function clearSentOutbox(db) {
    const tx = db.transaction('outbox', 'readwrite'), done = txDone(tx);
    tx.objectStore('outbox').index('state').openCursor('sent').onsuccess = ev => { const c = ev.target.result; if (!c) return; c.delete(); c.continue(); };
    return done;
  }

  // ============================================================
  // Inbox: device exports waiting to be filed (item 6)
  // ============================================================
  // An inbox item is a files record in state 'inbox': the bytes are already on this
  // device (copied — the source file in the watched folder is never touched), but no
  // visit points at it yet. Filing flips it to 'filed' in the SAME transaction that
  // writes the visit referencing it, so gcFiles (which only collects unreferenced
  // 'filed' records) can never take a file between the two.
  //   'unsupported' — recognised but not decodable here (a reason code, no bytes kept)
  //   'discarded'   — a tombstone: srcSha256 only, so folder discovery does not bring
  //                   it back; a file added by hand revives it
  // De-duplication is by srcSha256 (the unique index), across every state.
  function fileBySrc(db, sha) {
    if (!sha) return Promise.resolve(null);
    return reqP(db.transaction('files').objectStore('files').index('srcSha256').get(sha)).then(r => r || null);
  }
  // rec: a newFileRecord in state 'inbox' or 'unsupported'. opts.manual: the user chose
  // this file (Add files / drop), so a discarded or already-filed copy comes back.
  //   → 'added' | 'duplicate' (already in the inbox, or folder discovery of a known file)
  //     | 'revived' (a discarded / unsupported copy, re-read) | 'refiled' (already filed
  //     in a visit: shown in the inbox again so it can be filed elsewhere too)
  function addInboxFile(db, rec, opts) {
    opts = opts || {};
    const tx = db.transaction('files', 'readwrite'), done = txDone(tx), fs = tx.objectStore('files');
    let out = 'added';
    const put = () => fs.put(rec);
    if (!rec.srcSha256) { put(); return done.then(() => ({ status: out, id: rec.id })); }
    const q = fs.index('srcSha256').get(rec.srcSha256);
    q.onsuccess = () => {
      const ex = q.result;
      if (!ex) { put(); return; }
      rec.id = ex.id;
      if (ex.state === 'inbox' || !opts.manual) { out = 'duplicate'; return; }
      if (ex.state === 'filed' && ex.blob) { out = 'refiled'; fs.put(Object.assign({}, ex, { state: 'inbox', guessEye: rec.guessEye, origName: rec.origName || ex.origName, added: now() })); return; }
      out = 'revived'; put();   // a tombstone or an unsupported record: replaced under its id
    };
    return done.then(() => ({ status: out, id: rec.id }));
  }
  function listInbox(db) {
    const fs = db.transaction('files').objectStore('files').index('state');
    return Promise.all([reqP(fs.getAll('inbox')), reqP(db.transaction('files').objectStore('files').index('state').getAll('unsupported'))])
      .then(([a, b]) => a.concat(b).sort((x, y) => (y.added || 0) - (x.added || 0)));
  }
  // Every file id any visit (deleted or not) points at.
  function refsIn(encs) {
    const ids = new Set();
    encs.forEach(r => { if (!r || r.purged) return; const n = normalizeEncounter(r); liveRefs(n).forEach(id => ids.add(id)); });
    return ids;
  }
  // Out of the inbox. A file some visit already uses (re-shown with Add files) just
  // goes back to 'filed'; otherwise it becomes a tombstone: no bytes, no name, only
  // the hash that keeps folder discovery from importing it again.
  function discardInbox(db, id) {
    const tx = db.transaction(['files', 'encounters'], 'readwrite'), done = txDone(tx), fs = tx.objectStore('files');
    let out = null;
    fs.get(id).onsuccess = ev => {
      const f = ev.target.result;
      if (!f || (f.state !== 'inbox' && f.state !== 'unsupported')) return;
      tx.objectStore('encounters').getAll().onsuccess = ev2 => {
        if (refsIn(ev2.target.result).has(id) && f.blob) { fs.put(Object.assign({}, f, { state: 'filed' })); out = 'filed'; }
        else { fs.put({ id: f.id, kind: f.kind, state: 'discarded', blob: null, size: 0, srcSha256: f.srcSha256, added: now() }); out = 'discarded'; }
      };
    };
    return done.then(() => out);
  }
  // Where one file goes in a visit. Pure, so the rules are unit tested.
  //   image → the eye's picture if that eye has none of its own (empty, or a sample
  //           with no marks); otherwise one more picture in the eye's gallery, with
  //           its own (empty) marks. Nothing already drawn is moved onto a new photo.
  //   pdf   → the visit's attached documents, with its eye (OD, OS or OU)
  //   missing: {OD?:true, OS?:true} — that eye's stored picture is gone (its file record
  //           has no bytes): the new image re-attaches in its place and the marks stay
  //           with it, as Load image does; once only per eye.
  // → 'active' | 'gallery' | 'attachment' | 'already'
  function placeIntoEncounter(rec, f, eye, missing) {
    const ref = { fileId: f.id, sopUID: null, contentKey: null };
    if (f.kind === 'pdf') {
      if (!(eye === 'OD' || eye === 'OS' || eye === 'OU')) throw err('eye');
      if (rec.attachments.some(a => a.fileId === f.id && a.eye === eye)) return 'already';
      rec.attachments.push(Object.assign(ref, { eye }));
      return 'attachment';
    }
    if (!(eye === 'OD' || eye === 'OS')) throw err('eye');
    const e = rec.eyes[eye];
    if ((e.imgRef && e.imgRef.fileId === f.id) || e.gallery.some(g => g.fileId === f.id)) return 'already';
    if (missing && missing[eye] && e.imgRef) {
      missing[eye] = false;
      Object.assign(e, { imgRef: ref, imgSample: false, sampleVer: 0, possibleSample: false, imgPending: false, w: f.w || 0, h: f.h || 0 });
      return 'active';
    }
    if (!e.imgRef && !e.imgPending && !(e.marks || []).length) {
      Object.assign(e, { imgRef: ref, imgSample: false, sampleVer: 0, possibleSample: false, imgPending: false, w: f.w || 0, h: f.h || 0 });
      return 'active';
    }
    e.gallery.push(Object.assign(ref, { w: f.w || 0, h: f.h || 0, discDiaMm: 1.5, marks: [], possibleSample: false }));
    return 'gallery';
  }
  // Files inbox items into ONE visit in one transaction: the visit is written and each
  // file flips to 'filed' together, or nothing changes.
  //   target.encId (+ expectRev for the visit open in this tab: compare-and-swap)
  //   target.newRec: a new visit created by this filing
  //   items: [{fileId, eye}]
  // Codes: 'conflict' (the open visit changed elsewhere), 'not-found' (visit gone or
  // deleted), 'file-gone' (discarded in another tab meanwhile), 'eye'.
  function fileInto(db, target, items) {
    const stores = ['encounters', 'files', 'patients'];
    const tx = db.transaction(stores, 'readwrite'), done = txDone(tx);
    const es = tx.objectStore('encounters'), fs = tx.objectStore('files');
    const placed = []; let out = null;
    const abort = c => { if (!tx._code) { tx._code = c; try { tx.abort(); } catch (e) { } } };
    const withRec = rec => {
      const files = new Array(items.length); let left = items.length;
      if (!left) { abort('eye'); return; }
      items.forEach((it, i) => {
        fs.get(it.fileId).onsuccess = ev => {
          const f = ev.target.result;
          if (!f || !f.blob || (f.state !== 'inbox' && f.state !== 'filed')) { abort('file-gone'); return; }
          files[i] = f;
          if (--left) return;
          // Which eyes point at a picture whose bytes are gone — read in this transaction.
          const missing = {}, chk = ['OD', 'OS'].filter(k => rec.eyes[k] && rec.eyes[k].imgRef && rec.eyes[k].imgRef.fileId);
          let n = chk.length;
          const place = () => {
            try { items.forEach((x, j) => placed.push({ fileId: x.fileId, eye: x.eye, where: placeIntoEncounter(rec, files[j], x.eye, missing) })); }
            catch (e) { abort(e.code || 'eye'); return; }
            rec.updated = now();
            es.put(rec); out = rec;
            files.forEach(f2 => { if (f2.state !== 'filed') fs.put(Object.assign({}, f2, { state: 'filed' })); });
            if (rec.patientRef) {
              const ps = tx.objectStore('patients'), pg = ps.get(rec.patientRef);
              pg.onsuccess = () => { const p = pg.result; if (p && !p.deletedAt && !p.purged) ps.put(Object.assign({}, p, { updated: now() })); };
            }
          };
          if (!n) { place(); return; }
          chk.forEach(k => {
            fs.get(rec.eyes[k].imgRef.fileId).onsuccess = ev2 => { const g = ev2.target.result; if (!g || !g.blob) missing[k] = true; if (--n === 0) place(); };
          });
        };
      });
    };
    if (target.newRec) { const rec = normalizeEncounter(target.newRec); rec.rev = 1; withRec(rec); }
    else es.get(target.encId).onsuccess = ev => {
      const cur = ev.target.result;
      if (!cur || cur.purged || cur.deletedAt) { abort('not-found'); return; }
      const curRev = +cur.rev || 0;
      if (target.expectRev != null && curRev !== target.expectRev) { abort('conflict'); return; }
      const rec = normalizeEncounter(cur); rec.rev = curRev + 1;
      withRec(rec);
    };
    return done.then(() => ({ rec: out, placed }));
  }

  // ---------- journal / orphan (localStorage, synchronous) ----------
  // Written on pagehide: IndexedDB writes started while a tab is closing may
  // never commit, a synchronous localStorage write does. No pixels, so it fits.
  function writeJournal(ls, id, baseRev, json, session) {
    try { ls.setItem(JOURNAL_PREFIX + id, JSON.stringify({ baseRev, json, session: session == null ? null : String(session), at: now() })); return true; } catch (e) { return false; }
  }
  function clearJournal(ls, id) { lsDel(ls, JOURNAL_PREFIX + id); }
  function writeOrphan(ls, sessionTs, json) {
    try { ls.setItem(ORPHAN_PREFIX + sessionTs, JSON.stringify({ at: now(), json })); return true; } catch (e) { return false; }
  }

  return {
    DB_NAME, DB_VERSION, LEGACY_STUDY, LEGACY_LOGO, JOURNAL_PREFIX, ORPHAN_PREFIX,
    open, bootLoad, putEncounter, putNew, getEncounter, forgetLogo, getFile, listEncounters, kvGet, kvPut, kvDel,
    normalizeEncounter, newEncounter, newFileRecord, asCopy, hasData, legacyToEncounter, legacyProjection, canon,
    dataUrlToBlob, blobToDataUrl, sha256Hex, writeJournal, clearJournal, writeOrphan, gcFiles, uuid, pendingFileIds,
    // patients + history (item 2)
    nameKey, idKey, normalizePatient, newPatient, decideLink, identityDiff, visitOrder, previousVisit, hasExamData, dropPatient, SHORT_CAP, TEXT_CAP,
    listPatients, getPatient, putPatient, listByPatient, updateEncounter, outboxCounts, heldEncounters,
    deleteEncounter, restoreEncounter, deletePatient, restorePatient, purge, purgeExpired, PURGE_AFTER_MS,
    // DICOM outbox (item 3)
    listOutbox, getOutbox, claimOutbox, finishOutbox, patchOutbox, deleteOutbox, resetSending, clearSentOutbox,
    // inbox (item 6)
    fileBySrc, addInboxFile, listInbox, discardInbox, placeIntoEncounter, fileInto,
    // backup
    packBackup, bakContainer, BAK_FORMAT, BAK_VERSION, encryptBackup, backupKind, readBackup, validateBackup, cleanMark, cleanMarks, cleanSize, cleanMeta, cleanFields, contentCanon, planMerge, commitMerge
  };
});
