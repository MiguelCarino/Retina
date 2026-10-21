/* ============================================================
   retina-dicom.js — Carino Retina DICOM writer and DICOMweb helpers.
   ------------------------------------------------------------
   Builds the Part-10 files Retina hands to a download or to an archive:
     - Encapsulated PDF Storage (the exam report),
     - Ophthalmic Photography 8 Bit Image Storage (one per eye image).
   Both share one patient/study block (patientStudy), so every object of a
   visit carries the same StudyInstanceUID and the same patient identity.

   Encoding: Explicit VR Little Endian, uncompressed. It is the one transfer
   syntax every archive must accept (PS3.5 §10.1 default for networks is
   Implicit LE, but every STOW-RS receiver and every Part-10 reader takes
   Explicit LE; JPEG-in-DICOM is optional for an SCP). The pixels are
   therefore raw 8-bit RGB: larger on the wire, but nothing can refuse it,
   and it is a lossless copy of what the browser decoded.

   This file renders nothing, translates nothing and touches no network: it
   returns bytes, parses archive replies and classifies outcomes. index.html
   turns the codes into words (the i18n gate only reads index.html).
   UMD-style so tools/unit-tests.js can require() it.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // node unit tests
  else root.RetinaDicom = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Carino's registered root (the same one the earlier inline writer used).
  const UID_ROOT = '1.2.826.0.1.3680043.10.1401';
  const TS_EXPLICIT_LE = '1.2.840.10008.1.2.1';
  const SOP_PDF = '1.2.840.10008.5.1.4.1.1.104.1';      // Encapsulated PDF Storage
  const SOP_OP8 = '1.2.840.10008.5.1.4.1.1.77.1.5.1';   // Ophthalmic Photography 8 Bit Image Storage
  const UID_RE = /^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/;
  // Long-form VRs: 2 reserved bytes + a 32-bit length. Everything else has a 16-bit length.
  const LONG = { OB: 1, OD: 1, OF: 1, OL: 1, OV: 1, OW: 1, SQ: 1, UC: 1, UN: 1, UR: 1, UT: 1 };
  const STR = { AE: 1, AS: 1, CS: 1, DA: 1, DS: 1, DT: 1, IS: 1, LO: 1, LT: 1, PN: 1, SH: 1, ST: 1, TM: 1, UC: 1, UI: 1, UR: 1, UT: 1 };
  const enc8 = s => new TextEncoder().encode(s);

  // ---------- value helpers ----------
  // DICOM lengths are BYTE counts and the character set is ISO_IR 192 (UTF-8), so a
  // cut must land on a code point or the value becomes invalid UTF-8.
  function cap(str, n) {
    let out = '', len = 0;
    for (const ch of String(str == null ? '' : str)) {
      const l = enc8(ch).length; if (len + l > n) break; out += ch; len += l;
    }
    return out;
  }
  // Backslash separates values in DICOM strings; a typed one would split the field.
  const clean = s => String(s == null ? '' : s).replace(/[\\\u0000-\u001f]/g, ' ').trim();
  // PN: free text in one component. "Dr. Ana López" is not split into family/given —
  // that would invent a structure nobody typed; only the delimiters that would
  // corrupt the VR are removed.
  const pn = s => clean(s).replace(/[\^=]/g, ' ').replace(/\s+/g, ' ');
  const da = iso => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? String(iso).replace(/-/g, '') : '';
  const p2 = n => String(n).padStart(2, '0');
  const daOf = d => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  const tmOf = d => p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const isUID = s => typeof s === 'string' && s.length > 0 && s.length <= 64 && UID_RE.test(s);

  // <root>.<ms since epoch>.<random digits>, filled to 64 characters. Never sliced:
  // slicing can leave a trailing '.' or a component with a leading zero, both
  // invalid. The random part is drawn from crypto when it exists.
  function mintUID(rootUid, rnd) {
    rootUid = rootUid || UID_ROOT;
    const head = rootUid + '.' + Date.now() + '.';
    const room = 64 - head.length;
    if (room < 8) throw new Error('uid-root-too-long');
    const n = Math.min(room, 30), d = new Uint8Array(n);
    if (rnd) rnd(d);
    else if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(d);
    else for (let i = 0; i < n; i++) d[i] = Math.random() * 256 | 0;
    let s = String(1 + d[0] % 9);
    for (let i = 1; i < n; i++) s += String(d[i] % 10);
    const uid = head + s;
    if (!isUID(uid)) throw new Error('uid-invalid');
    return uid;
  }

  // ---------- dataset ----------
  // put() in any order; encode() sorts by tag, so an attribute added later in the
  // code cannot land out of order (the old writer relied on a hand-ordered list).
  function DS() { this.els = new Map(); }
  DS.prototype.put = function (tag, vr, value) { this.els.set(tag >>> 0, { vr, value: value == null ? '' : value }); return this; };
  DS.prototype.seq = function (tag, items) { this.els.set(tag >>> 0, { vr: 'SQ', value: items || [] }); return this; };
  DS.prototype.has = function (tag) { return this.els.has(tag >>> 0); };
  DS.prototype.get = function (tag) { const e = this.els.get(tag >>> 0); return e ? e.value : undefined; };
  DS.prototype.del = function (tag) { this.els.delete(tag >>> 0); return this; };
  // Plain JSON (no bytes): what the outbox freezes at enqueue time.
  DS.prototype.toJSON = function () {
    return [...this.els.entries()].map(([t, e]) => [t, e.vr, e.vr === 'SQ' ? e.value.map(x => x.toJSON()) : e.value]);
  };
  DS.fromJSON = function (arr) {
    const ds = new DS();
    (arr || []).forEach(([t, vr, v]) => {
      if (vr === 'SQ') ds.seq(t, (v || []).map(DS.fromJSON));
      else if (vr === 'OB' || vr === 'OW') throw new Error('bytes-in-header');
      else ds.put(t, vr, v);
    });
    return ds;
  };

  function concat(arrs) {
    let n = 0; arrs.forEach(a => { n += a.length; });
    const out = new Uint8Array(n); let o = 0;
    arrs.forEach(a => { out.set(a, o); o += a.length; });
    return out;
  }
  function valueBytes(vr, v) {
    if (vr === 'OB' || vr === 'UN') {
      const b = v instanceof Uint8Array ? v : new Uint8Array(v || 0);
      if (b.length % 2 === 0) return b;
      const p = new Uint8Array(b.length + 1); p.set(b); return p;   // pad 0x00
    }
    if (vr === 'AT') {   // a tag value: group then element, each 16-bit LE
      const vals = Array.isArray(v) ? v : [v];
      const b = new Uint8Array(vals.length * 4), dv = new DataView(b.buffer);
      vals.forEach((x, i) => { dv.setUint16(i * 4, x >>> 16, true); dv.setUint16(i * 4 + 2, x & 0xffff, true); });
      return b;
    }
    if (vr === 'US' || vr === 'UL' || vr === 'FL' || vr === 'FD') {
      const vals = Array.isArray(v) ? v : (v === '' || v == null ? [] : [v]);
      const sz = vr === 'US' ? 2 : vr === 'FD' ? 8 : 4;
      const b = new Uint8Array(vals.length * sz), dv = new DataView(b.buffer);
      vals.forEach((x, i) => {
        if (vr === 'US') dv.setUint16(i * 2, x, true); else if (vr === 'UL') dv.setUint32(i * 4, x >>> 0, true);
        else if (vr === 'FL') dv.setFloat32(i * 4, x, true); else dv.setFloat64(i * 8, x, true);
      });
      return b;
    }
    if (!STR[vr]) throw new Error('vr-unsupported:' + vr);
    const s = Array.isArray(v) ? v.join('\\') : String(v);
    const b = enc8(s);
    if (b.length % 2 === 0) return b;
    const p = new Uint8Array(b.length + 1); p.set(b); p[b.length] = vr === 'UI' ? 0x00 : 0x20; return p;
  }
  const u16 = v => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
  const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
  function element(tag, vr, val) {
    const head = [u16(tag >>> 16), u16(tag & 0xffff), enc8(vr)];
    if (LONG[vr]) { head.push(u16(0), u32(val.length)); }
    else { if (val.length > 0xffff) throw new Error('value-too-long:' + tag.toString(16)); head.push(u16(val.length)); }
    head.push(val);
    return concat(head);
  }
  // Sequences and items use DEFINED lengths: simpler for every reader, and the item
  // bodies are small (code items, never pixel data).
  DS.prototype.encode = function () {
    const tags = [...this.els.keys()].sort((a, b) => a - b);
    return concat(tags.map(t => {
      const e = this.els.get(t);
      if (e.vr === 'SQ') {
        const items = e.value.map(it => { const body = it.encode(); return concat([u16(0xfffe), u16(0xe000), u32(body.length), body]); });
        return element(t, 'SQ', concat(items));
      }
      return element(t, e.vr, valueBytes(e.vr, e.value));
    }));
  };

  // Preamble + DICM + group 0002 (always Explicit VR LE) + the dataset.
  function part10(ds, versionName) {
    const sopClass = ds.get(0x00080016), sopInst = ds.get(0x00080018);
    if (!isUID(sopClass) || !isUID(sopInst)) throw new Error('sop-uid');
    const meta = new DS()
      .put(0x00020001, 'OB', new Uint8Array([0, 1]))
      .put(0x00020002, 'UI', sopClass).put(0x00020003, 'UI', sopInst)
      .put(0x00020010, 'UI', TS_EXPLICIT_LE)
      .put(0x00020012, 'UI', UID_ROOT + '.1')
      .put(0x00020013, 'SH', cap(versionName || 'CARINO_RETINA', 16));
    const m = meta.encode();
    return concat([new Uint8Array(128), enc8('DICM'), element(0x00020000, 'UL', u32(m.length)), m, ds.encode()]);
  }

  // ---------- shared blocks ----------
  // Patient + General Study + charset: identical on every object of a visit.
  //   s = {patientName, patientId, dob, studyUID, studyDate, studyTime, studyId,
  //        accession, referring, institution, institutionAddress}
  function patientStudy(ds, s) {
    if (!isUID(s.studyUID)) throw new Error('study-uid');
    return ds
      .put(0x00080005, 'CS', 'ISO_IR 192')
      .put(0x00080020, 'DA', da(s.studyDate))
      .put(0x00080030, 'TM', s.studyTime || '')
      .put(0x00080050, 'SH', cap(clean(s.accession), 16))
      .put(0x00080080, 'LO', cap(clean(s.institution), 64))
      .put(0x00080081, 'ST', cap(String(s.institutionAddress || '').replace(/\\/g, ' '), 1024))
      .put(0x00080090, 'PN', cap(pn(s.referring), 64))
      .put(0x00100010, 'PN', cap(pn(s.patientName), 64))
      .put(0x00100020, 'LO', cap(clean(s.patientId), 64))
      .put(0x00100030, 'DA', da(s.dob))
      .put(0x00100040, 'CS', '')
      .put(0x0020000D, 'UI', s.studyUID)
      .put(0x00200010, 'SH', cap(clean(s.studyId), 16));
  }
  // General Equipment: the equipment that made THIS object, which is Retina.
  function equipment(ds, q) {
    ds.put(0x00080070, 'LO', 'Carino Systems').put(0x00081090, 'LO', 'Carino Retina');
    if (q.deviceSerial) ds.put(0x00181000, 'LO', cap(clean(q.deviceSerial), 64));
    if (q.softwareVersion) ds.put(0x00181020, 'LO', cap(clean(q.softwareVersion), 64));
    return ds;
  }
  const code = (value, scheme, meaning) => new DS().put(0x00080100, 'SH', value).put(0x00080102, 'SH', scheme).put(0x00080104, 'LO', meaning);

  // ---------- Encapsulated PDF ----------
  // o = {study:{…patientStudy}, equip:{…}, pdfBytes, sopUID, seriesUID, seriesNumber,
  //      instanceNumber, title, seriesDescription, laterality?('R'|'L'|'B'), now:Date}
  function encapsulatedPdf(o) {
    const now = o.now || new Date(), pdf = o.pdfBytes instanceof Uint8Array ? o.pdfBytes : new Uint8Array(o.pdfBytes);
    if (!isUID(o.sopUID) || !isUID(o.seriesUID)) throw new Error('uid');
    const ds = new DS();
    patientStudy(ds, o.study); equipment(ds, o.equip || {});
    ds.put(0x00080012, 'DA', daOf(now)).put(0x00080013, 'TM', tmOf(now))
      .put(0x00080016, 'UI', SOP_PDF).put(0x00080018, 'UI', o.sopUID)
      .put(0x00080023, 'DA', daOf(now)).put(0x00080033, 'TM', tmOf(now))
      .put(0x0008002A, 'DT', '')                                  // Acquisition DateTime, Type 2
      .put(0x00080060, 'CS', 'DOC').put(0x00080064, 'CS', 'WSD')
      .put(0x0008103E, 'LO', cap(o.seriesDescription || 'Eye examination report', 64))
      .put(0x0020000E, 'UI', o.seriesUID)
      .put(0x00200011, 'IS', String(o.seriesNumber || 1))
      .put(0x00200013, 'IS', String(o.instanceNumber || 1))
      // The report prints the patient's name and ID on every page.
      .put(0x00280301, 'CS', 'YES')
      .seq(0x0040A043, [])                                        // Concept Name Code Sequence, Type 2
      .put(0x00420010, 'ST', cap(o.title || 'Eye Examination Report', 1024))
      .put(0x00420011, 'OB', pdf)
      .put(0x00420012, 'LO', 'application/pdf')
      .put(0x00420015, 'UL', pdf.length);                         // length before the even-length pad
    // A device report filed to an eye: Image Laterality (0020,0062), the one laterality
    // attribute the Encapsulated Document module has (Type 3: R, L, B; the series-level
    // Laterality (0020,0060) is not part of this IOD and dicom-validator rejects it).
    if (o.laterality === 'R' || o.laterality === 'L' || o.laterality === 'B') ds.put(0x00200062, 'CS', o.laterality);
    return part10(ds);
  }

  // ---------- Ophthalmic Photography 8 Bit ----------
  // Codes, looked up in PS3.16 2026d (not guessed):
  //   CID 4202 Ophthalmic Photography Acquisition Device:
  //     (SCT 409898007 "Fundus Camera"), (SCT 397247004 "Slit Lamp Biomicroscope"),
  //     (SCT 409903006 "External Camera")
  //   CID 4209 Ophthalmic Anatomic Structure Imaged:
  //     (SCT 5665001 "Retina"), (SCT 81745001 "Eye")
  // Retina does not acquire images, so the clinic says which kind of device its
  // pictures come from (Settings ▸ Archive); the default is a fundus camera.
  const DEVICES = {
    fundus: { dev: ['409898007', 'Fundus Camera'], region: ['5665001', 'Retina'], desc: 'Fundus photograph' },
    slitlamp: { dev: ['397247004', 'Slit Lamp Biomicroscope'], region: ['81745001', 'Eye'], desc: 'Slit lamp photograph' },
    external: { dev: ['409903006', 'External Camera'], region: ['81745001', 'Eye'], desc: 'External eye photograph' }
  };
  // Everything but the pixels. Frozen as JSON in the outbox; the pixel module is
  // added at send time from the stored (immutable) source image.
  //   o = {study, equip, sopUID, seriesUID, syncUID, seriesNumber, instanceNumber, eye:'OD'|'OS',
  //        device:'fundus'|'slitlamp'|'external', burnedIn:boolean, sourceMime,
  //        sourceBytes, contentAt:ms, acquiredAt?:'YYYYMMDDHHMMSS', now:Date}
  function opHeader(o) {
    const now = o.now || new Date(), lat = o.eye === 'OS' ? 'L' : o.eye === 'OD' ? 'R' : null;
    if (!lat) throw new Error('laterality');
    if (!isUID(o.sopUID) || !isUID(o.seriesUID) || !isUID(o.syncUID)) throw new Error('uid');
    const dv = DEVICES[o.device] || DEVICES.fundus, content = new Date(o.contentAt || now);
    const ds = new DS();
    patientStudy(ds, o.study); equipment(ds, o.equip || {});
    // The examining clinician (General Series, Type 3). Not on the PDF: the
    // Encapsulated Document Series has no such attribute, and the report prints it.
    if (o.equip && o.equip.performing) ds.put(0x00081050, 'PN', cap(pn(o.equip.performing), 64));
    ds.put(0x00080008, 'CS', ['DERIVED', 'PRIMARY'])
      .put(0x00080012, 'DA', daOf(now)).put(0x00080013, 'TM', tmOf(now))
      .put(0x00080016, 'UI', SOP_OP8).put(0x00080018, 'UI', o.sopUID)
      .put(0x00080023, 'DA', daOf(content)).put(0x00080033, 'TM', tmOf(content))
      .put(0x00080060, 'CS', 'OP')
      .put(0x0008103E, 'LO', dv.desc + ' ' + o.eye)
      // DERIVED: Retina re-encodes a picture it was given. The source is not a DICOM
      // instance, so the sequence is present and empty (Type 2C).
      .seq(0x00082112, [])
      .seq(0x00082218, [code(dv.region[0], 'SCT', dv.region[1])])
      .put(0x00187004, 'CS', '')                                   // Detector Type, Type 2: unknown
      // Synchronization (Mandatory in this IOD): nothing here is synchronized to an
      // external clock or trigger, which is exactly what these values say.
      .put(0x0018106A, 'CS', 'NO TRIGGER').put(0x00181800, 'CS', 'N')
      .put(0x00200200, 'UI', o.syncUID)
      // Multi-frame (also Mandatory): one frame. The Frame Increment Pointer must point
      // at an attribute that is present with a value; PS3.3 C.7.6.6.1.2 names Frame
      // Time = 0 for exactly this single-frame case.
      .put(0x00181063, 'DS', '0')
      .put(0x00280008, 'IS', '1').put(0x00280009, 'AT', 0x00181063)
      .put(0x0020000E, 'UI', o.seriesUID)
      .put(0x00200011, 'IS', String(o.seriesNumber))
      .put(0x00200013, 'IS', String(o.instanceNumber || 1))
      .put(0x00200020, 'CS', '')
      .put(0x00200060, 'CS', lat)
      .put(0x00200062, 'CS', lat)
      // Ophthalmic Photography Acquisition Parameters: every Type 2 attribute present
      // and empty. Retina's own exam values (IOP, refraction) are NOT copied here —
      // they were not measured with this photograph.
      .put(0x00220005, 'CS', '')
      .put(0x0022000A, 'FL', '').put(0x0022000B, 'FL', '').put(0x0022000C, 'FL', '')
      .put(0x0022000D, 'CS', '')
      .seq(0x0022001B, [])
      // Ophthalmic Photographic Parameters
      .seq(0x00220015, [code(dv.dev[0], 'SCT', dv.dev[1])])
      .seq(0x00220016, []).seq(0x00220017, []).seq(0x00220018, []).seq(0x00220019, [])
      // Camera pictures can carry burned-in names or dates; YES unless the clinic said No.
      .put(0x00280301, 'CS', o.burnedIn === false ? 'NO' : 'YES')
      .seq(0x00400555, []);                                        // Acquisition Context, Type 2
    // Pixel Spacing (0028,0030): the camera's nominal retinal scale, Type 1C — required
    // when the device is a fundus camera. Row and column spacing are the same value.
    // Retina's disc-derived mm/px is an assumption, not a calibration, and is never written.
    const pm = pixelMmOf(o.pixelMm);
    if (pm && dv === DEVICES.fundus) ds.put(0x00280030, 'DS', [pm, pm]);
    // Only a real capture time (EXIF DateTimeOriginal); a file's mtime is not one. A
    // camera with an unset clock writes '2016:00:00 00:00:00': a 14-digit string is not
    // yet a date, so the fields are checked before it becomes a DT.
    if (validDT(o.acquiredAt)) ds.put(0x0008002A, 'DT', o.acquiredAt);
    // "00" only for formats that cannot be lossy; anything else may have been (WebP,
    // AVIF, HEIC… are all admitted by the image picker), and claiming "never lossy" for
    // those would be false. Once "01" it may never be reset, so erring that way is safe.
    const lossy = lossyMethod(o.sourceMime);
    ds.put(0x00282110, 'CS', lossy ? '01' : '00');
    if (lossy) ds.put(0x00282112, 'DS', ratio(o.sourceBytes, o.w, o.h)).put(0x00282114, 'CS', lossy);
    return ds;
  }
  // YYYYMMDDHHMMSS with every field in range (PS3.5 §6.2 DT): month 1–12, day 1–31,
  // hour 0–23, minute and second 0–59, and a date that exists.
  function validDT(s) {
    if (typeof s !== 'string' || !/^\d{14}$/.test(s)) return false;
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8), h = +s.slice(8, 10), mi = +s.slice(10, 12), se = +s.slice(12, 14);
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }
  // A nominal pixel spacing in mm: a finite number in the range a fundus camera can have
  // (0.0005–0.1 mm/px), as a DS string of at most 16 characters; null otherwise.
  function pixelMmOf(v) {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : +v;
    if (!isFinite(n) || n < 0.0005 || n > 0.1) return null;
    return String(+n.toPrecision(6));
  }
  // Lossy Image Compression Method (0028,2114), Type 1C when (0028,2110) is "01".
  // PS3.3 C.7.6.1.1.5.1 Defined Terms where one exists (JPEG = ISO_10918_1, HEVC/HEIF =
  // ISO_23008_2, JPEG 2000 = ISO_15444_1, JPEG XL = ISO_18181_1); Defined Terms may be
  // extended, so a format without one is named by its MIME subtype (e.g. WEBP, AVIF).
  // Returns '' for a format that is always lossless.
  const LOSSLESS_MIME = /^image\/(png|apng|bmp|x-ms-bmp|x-bmp|gif|tiff?|x-portable-\w+)$/i;
  function lossyMethod(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    if (LOSSLESS_MIME.test(m)) return '';
    if (/^image\/p?jpe?g$/.test(m)) return 'ISO_10918_1';
    if (/^image\/hei[cf](-sequence)?$/.test(m)) return 'ISO_23008_2';
    if (/^image\/jp2|^image\/jpx/.test(m)) return 'ISO_15444_1';
    if (m === 'image/jxl') return 'ISO_18181_1';
    const sub = (m.split('/')[1] || '').replace(/^x-/, '').toUpperCase().replace(/[^A-Z0-9_ ]/g, '_').slice(0, 16);
    return sub || 'UNKNOWN';
  }
  // DS max 16 characters. Uncompressed RGB size over the JPEG's size.
  function ratio(bytes, w, h) {
    const r = (bytes > 0 && w > 0 && h > 0) ? (w * h * 3) / bytes : 1;
    return String(Math.max(1, Math.round(r * 100) / 100)).slice(0, 16);
  }
  // Adds the Image Pixel module and returns Part-10 bytes. rgb: Uint8Array w*h*3.
  function opFinish(header, w, h, rgb) {
    if (!(w > 0 && h > 0 && w <= 65535 && h <= 65535)) throw new Error('image-size');
    if (!rgb || rgb.length !== w * h * 3) throw new Error('pixel-length');
    const ds = header instanceof DS ? header : DS.fromJSON(header);
    ds.put(0x00280002, 'US', 3).put(0x00280004, 'CS', 'RGB').put(0x00280006, 'US', 0)
      .put(0x00280010, 'US', h).put(0x00280011, 'US', w)
      .put(0x00280100, 'US', 8).put(0x00280101, 'US', 8).put(0x00280102, 'US', 7).put(0x00280103, 'US', 0)
      .put(0x7FE00010, 'OB', rgb);
    return part10(ds);
  }
  // RGBA (canvas ImageData) → packed RGB, alpha dropped.
  function rgbaToRgb(rgba) {
    const n = rgba.length / 4, out = new Uint8Array(n * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2]; }
    return out;
  }

  // ---------- STOW-RS ----------
  // multipart/related; type="application/dicom" with CRLF line breaks (PS3.18 §8.6.1.2;
  // Carino DICOM refuses bare LF). Returns the parts as an array for new Blob(...).
  function multipart(parts, boundary) {
    boundary = boundary || ('carino-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
    const out = [];
    parts.forEach(p => { out.push(enc8('--' + boundary + '\r\nContent-Type: application/dicom\r\n\r\n'), p, enc8('\r\n')); });
    out.push(enc8('--' + boundary + '--\r\n'));
    return { chunks: out, contentType: 'multipart/related; type="application/dicom"; boundary=' + boundary, boundary };
  }
  const val = (item, tag) => { const e = item && item[tag]; return e && Array.isArray(e.Value) ? e.Value[0] : undefined; };
  // DICOM JSON STOW response → per-SOP result.
  //   ReferencedSOPSequence (0008,1199): stored (a WarningReason 0008,1196 still means stored)
  //   FailedSOPSequence (0008,1198): FailureReason (0008,1197)
  function parseStow(json) {
    const out = { stored: {}, failed: {}, other: [] };
    if (!json || typeof json !== 'object') return out;
    const body = Array.isArray(json) ? json[0] : json;
    const sq = t => (body && body[t] && Array.isArray(body[t].Value)) ? body[t].Value : [];
    sq('00081199').forEach(it => { const u = val(it, '00081155'); if (u) out.stored[u] = { warning: val(it, '00081196') || null }; });
    sq('00081198').forEach(it => { const u = val(it, '00081155'); if (u) out.failed[u] = { reason: val(it, '00081197') == null ? null : +val(it, '00081197') }; });
    sq('0008119A').forEach(it => out.other.push(val(it, '00081197') == null ? null : +val(it, '00081197')));
    return out;
  }
  // One HTTP exchange for one instance → what the outbox does next.
  //   r = {http, json, retryAfter (seconds|null), netError ('network'|'timeout'|null), detail}
  //   → {kind:'sent'|'retry'|'failed'|'pause', code, http, status, waitMs, detail}
  // Rules: an instance is SENT only if its SOP UID is listed as stored. Anything the
  // archive will keep refusing (bad object, unsupported class) waits for a person;
  // anything that can pass (network, server busy, disk full) is retried by itself;
  // a refused credential pauses the whole outbox on the first one.
  function stowOutcome(r, sopUID) {
    const http = r.http || 0, base = { http, detail: r.detail || '' };
    if (r.netError) return Object.assign(base, { kind: 'retry', code: r.netError });
    // Refusals from the desktop transport before any request was made (desktop/archive.js).
    // No address (cleared in the main process while this page still had one): wait for
    // one, the object is fine. A body over the transport's limit or unusable parts would
    // fail the same way every time.
    if (!http && r.code === 'no-base') return Object.assign(base, { kind: 'retry', code: 'no-base' });
    if (!http && r.code === 'too-large') return Object.assign(base, { kind: 'failed', code: 'too-large' });
    if (!http && r.code === 'bad-parts') return Object.assign(base, { kind: 'failed', code: 'build' });
    if (http === 401 || http === 403) return Object.assign(base, { kind: 'pause', code: 'auth' });
    if (http === 429) return Object.assign(base, { kind: 'retry', code: 'rate', waitMs: Math.min(3600e3, Math.max(1, +r.retryAfter || 60) * 1000) });
    if (http === 503) return Object.assign(base, { kind: 'retry', code: 'disabled' });
    const p = parseStow(r.json);
    if (p.stored[sopUID]) return Object.assign(base, { kind: 'sent', code: p.stored[sopUID].warning != null ? 'warning' : 'ok', status: p.stored[sopUID].warning });
    if (p.failed[sopUID]) {
      const s = p.failed[sopUID].reason;
      // 0xA7xx: out of resources (Carino DICOM: below its free-space floor) — it can pass.
      if (s != null && (s & 0xff00) === 0xa700) return Object.assign(base, { kind: 'retry', code: 'resources', status: s, waitMs: 5 * 60e3 });
      return Object.assign(base, { kind: 'failed', code: 'refused', status: s });
    }
    if (http >= 500) return Object.assign(base, { kind: 'retry', code: 'server' });
    if (http >= 200 && http < 300) return Object.assign(base, { kind: 'failed', code: 'unknown' });   // answered, but not about this instance
    if (p.other.length) return Object.assign(base, { kind: 'failed', code: 'refused', status: p.other[0] });
    return Object.assign(base, { kind: 'failed', code: 'http' });
  }
  // min(30 min, 15 s · 2^attempts) with ±20% jitter, never below `floor`.
  function backoff(attempts, rnd, floor) {
    const r = typeof rnd === 'number' ? rnd : Math.random();
    const ms = Math.min(30 * 60e3, 15e3 * Math.pow(2, Math.max(0, attempts | 0))) * (0.8 + 0.4 * r);
    return Math.max(floor || 0, Math.round(ms));
  }
  // The archive address: http(s) only, no credentials, query or fragment; the
  // trailing slash dropped. Returns '' for anything else.
  function normBase(s) {
    s = String(s || '').trim();
    if (!s) return '';
    let u; try { u = new URL(s); } catch (e) { return ''; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash) return '';
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }
  // Mixed content: a secure page may fetch http:// only from loopback.
  function isLoopbackHost(h) {
    h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '::1';
  }

  return {
    UID_ROOT, TS_EXPLICIT_LE, SOP_PDF, SOP_OP8, UID_RE, DEVICES,
    DS, cap, pn, da, isUID, mintUID, part10, patientStudy, encapsulatedPdf, opHeader, opFinish, rgbaToRgb,
    multipart, parseStow, stowOutcome, lossyMethod, validDT, pixelMmOf, backoff, normBase, isLoopbackHost
  };
});
