/* ============================================================
   retina-inbox.js — Carino Retina inbox: recognising device exports.
   ------------------------------------------------------------
   Fundus cameras and OCTs in small clinics export JPEG / PNG / BMP /
   TIFF pictures and PDF reports into a folder. This file holds the
   parts of importing them that do not touch the page or the disk:

     sniff / complete / inspect   what a file really is (magic bytes, not
                                  its name) and whether it is finished
                                  being written (a camera mid-export
                                  leaves a JPEG without its end marker)
     guessEye                     OD / OS / OU from file-name tokens — a
                                  SUGGESTION the user confirms, never a
                                  decision (a wrong eye is a wrong record)
     exifDate                     EXIF DateTimeOriginal, the only source of
                                  an acquisition date (file times are copy
                                  times, not exam times)
     decodeTiff                   baseline TIFF to RGBA: uncompressed, LZW,
                                  PackBits and Deflate, 1–16 bit, gray /
                                  RGB / palette / CMYK, strips or tiles.
                                  Browsers cannot show TIFF; this is ~300
                                  lines instead of a vendored decoder.
                                  JPEG-in-TIFF and the like are reported
                                  as unsupported, with a reason code.
     createTracker                "stable for N ms" bookkeeping, shared by
                                  the desktop watcher and the web poller

   UMD: the page loads it as window.RetinaInbox, the desktop main process
   requires it for the folder watcher (desktop/inbox-watcher.js), and
   tools/unit-tests.js tests it in Node. It renders and translates
   nothing (the i18n gate only reads index.html): failures are codes.
   Nothing here touches the network or writes anything.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetinaInbox = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function err(code, detail) { const e = new Error(code + (detail ? ': ' + detail : '')); e.code = code; if (detail) e.detail = detail; return e; }

  // ---------- what a file is ----------
  // Extension → kind. Only these are picked up from a watched folder; anything else
  // in it (the camera's database, thumbnails as .dat, a .txt log) is not looked at.
  const EXT = { jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', png: 'png', bmp: 'bmp', tif: 'tiff', tiff: 'tiff', pdf: 'pdf' };
  const MIME = { jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp', tiff: 'image/tiff', pdf: 'application/pdf' };
  function extKind(name) { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')); return m ? (EXT[m[1].toLowerCase()] || null) : null; }
  const isWatchedName = name => !!extKind(name) && !/^[.~]/.test(String(name || '').split(/[\\/]/).pop());

  // Magic bytes. A PDF may legally start with junk before %PDF- (the spec allows
  // 1 KB of it), so that one is searched for.
  function sniff(u8) {
    if (!u8 || u8.length < 8) return null;
    if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'jpeg';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47 && u8[4] === 0x0D && u8[5] === 0x0A && u8[6] === 0x1A && u8[7] === 0x0A) return 'png';
    if (u8[0] === 0x42 && u8[1] === 0x4D) return 'bmp';
    if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 42 && u8[3] === 0) || (u8[0] === 0x4D && u8[1] === 0x4D && u8[2] === 0 && u8[3] === 42)) return 'tiff';
    if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 43 && u8[3] === 0) || (u8[0] === 0x4D && u8[1] === 0x4D && u8[2] === 0 && u8[3] === 43)) return 'bigtiff';
    if (indexOf(u8, [0x25, 0x50, 0x44, 0x46, 0x2D], 0, Math.min(u8.length, 1024)) >= 0) return 'pdf';
    return null;
  }
  function indexOf(u8, pat, from, to) {
    outer: for (let i = Math.max(0, from); i <= to - pat.length; i++) { for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; }
    return -1;
  }
  function lastIndexOf(u8, pat, from) {
    outer: for (let i = u8.length - pat.length; i >= Math.max(0, from); i--) { for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; }
    return -1;
  }
  // Is the file finished? Each format has an end marker or a declared length; a
  // device still writing the file has not got there yet. A little trailing padding
  // is tolerated (some cameras append zeros or a vendor trailer).
  function complete(kind, u8) {
    const n = u8.length;
    switch (kind) {
      case 'jpeg': return lastIndexOf(u8, [0xFF, 0xD9], n - 1024) >= 2;
      case 'png': return lastIndexOf(u8, [0x49, 0x45, 0x4E, 0x44], n - 64) >= 8;   // IEND
      case 'pdf': return lastIndexOf(u8, [0x25, 0x25, 0x45, 0x4F, 0x46], n - 1024) >= 0;   // %%EOF
      case 'bmp': {
        if (n < 54) return false;
        const dv = new DataView(u8.buffer, u8.byteOffset, n), off = dv.getUint32(10, true), hdr = dv.getUint32(14, true);
        if (off >= n || hdr < 12) return false;
        if (hdr >= 40) {
          const w = dv.getInt32(18, true), h = Math.abs(dv.getInt32(22, true)), bpp = dv.getUint16(28, true), comp = dv.getUint32(30, true);
          if (comp === 0 || comp === 3) { const row = Math.floor((w * bpp + 31) / 32) * 4; return off + row * h <= n; }
          const sz = dv.getUint32(34, true); return !sz || off + sz <= n;
        }
        return true;
      }
      case 'tiff': {
        try { const ifd = readIfd(u8); return blocksOf(ifd).every(b => b.off + b.len <= n); } catch (e) { return false; }
      }
      default: return false;
    }
  }
  // → {ok:true, kind, mime} | {ok:false, reason, kind?}
  //   reason: 'type' (not an image or PDF), 'type-mismatch' (a JPEG named .pdf: the
  //   name says one thing, the bytes another — not guessed at), 'bigtiff',
  //   'incomplete', 'empty'.
  // opts.strictExt: the name must say what the bytes are (folder import). A file the
  // user picked by hand is judged by its bytes alone.
  function inspect(u8, name, opts) {
    opts = opts || {};
    if (!u8 || !u8.length) return { ok: false, reason: 'empty' };
    const k = sniff(u8);
    if (!k) return { ok: false, reason: 'type' };
    if (k === 'bigtiff') return { ok: false, reason: 'bigtiff', kind: 'tiff' };
    if (opts.strictExt) { const ek = extKind(name); if (ek !== k) return { ok: false, reason: ek ? 'type-mismatch' : 'type', kind: k }; }
    if (!complete(k, u8)) return { ok: false, reason: 'incomplete', kind: k };
    return { ok: true, kind: k, mime: MIME[k] };
  }

  // ---------- laterality from the file name ----------
  // Tokens: split on anything that is not a letter or digit, and on camelCase and
  // letter/digit boundaries ("IMG_0012_OD", "fundusRight2", "OD1"). Single letters
  // count only as whole tokens. Deliberately NOT tokens: re, le, pr, dir, ao — they
  // are ordinary words or prefixes in the clinic languages. Conflicting tokens
  // (an OD and an OS token) give no suggestion at all.
  const OD_T = new Set(['od', 'r', 'right', 'rt', 'der', 'derecho', 'derecha', 'direito', 'direita', '右', '右眼', 'правый', 'правого', 'правое', 'прав']);
  const OS_T = new Set(['os', 'l', 'left', 'lt', 'izq', 'izquierdo', 'izquierda', 'esq', 'esquerdo', 'esquerda', '左', '左眼', 'левый', 'левого', 'левое', 'лев']);
  const OU_T = new Set(['ou', 'both', 'ambos', 'ambas', '両眼', 'оба']);
  const HAN = /[㐀-鿿]/;
  function tokens(name) {
    let s = String(name || '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '');
    s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
    return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(x => x.toLowerCase());
  }
  // → 'OD' | 'OS' | 'OU' | null
  function guessEye(name) {
    let od = false, os = false, ou = false;
    for (const tk of tokens(name)) {
      if (OD_T.has(tk)) od = true; else if (OS_T.has(tk)) os = true; else if (OU_T.has(tk)) ou = true;
      else if (HAN.test(tk)) {   // Japanese names run words together: 右眼底, 眼底左
        if (tk.indexOf('両眼') >= 0) ou = true;
        else { if (tk.indexOf('右') >= 0) od = true; if (tk.indexOf('左') >= 0) os = true; }
      }
    }
    const n = (od ? 1 : 0) + (os ? 1 : 0) + (ou ? 1 : 0);
    return n !== 1 ? null : od ? 'OD' : os ? 'OS' : 'OU';
  }

  // ---------- TIFF structure (shared by EXIF and the decoder) ----------
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
  function tiffReader(u8, base) {
    base = base || 0;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
    const le = u8[base] === 0x49;
    const u16 = o => dv.getUint16(base + o, le), u32 = o => dv.getUint32(base + o, le);
    // One IFD → Map(tag → array of numbers | string). Values that point outside the
    // file are an error, not a read past the end.
    function ifdAt(off) {
      if (base + off + 2 > u8.length) throw err('tiff', 'ifd');
      const n = u16(off), map = new Map();
      if (n > 4096 || base + off + 2 + n * 12 > u8.length) throw err('tiff', 'ifd');
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), sz = TYPE_SIZE[type];
        if (!sz || count > 1e7) continue;
        const bytes = sz * count, vo = bytes <= 4 ? e + 8 : u32(e + 8);
        if (base + vo + bytes > u8.length) { if (tag === 273 || tag === 279 || tag === 324 || tag === 325) throw err('tiff', 'range'); continue; }
        if (type === 2) { let s = ''; for (let j = 0; j < count; j++) { const c = u8[base + vo + j]; if (!c) break; s += String.fromCharCode(c); } map.set(tag, s); continue; }
        const vals = new Array(count);
        for (let j = 0; j < count; j++) {
          const p = vo + j * sz;
          vals[j] = type === 3 ? u16(p) : type === 4 || type === 13 ? u32(p) : type === 8 ? dv.getInt16(base + p, le) : type === 9 ? dv.getInt32(base + p, le)
            : type === 5 ? u32(p) / (u32(p + 4) || 1) : type === 10 ? dv.getInt32(base + p, le) / (dv.getInt32(base + p + 4, le) || 1)
            : type === 11 ? dv.getFloat32(base + p, le) : type === 12 ? dv.getFloat64(base + p, le) : u8[base + p];
        }
        map.set(tag, vals);
      }
      return map;
    }
    return { le, u16, u32, ifdAt, first: () => ifdAt(u32(4)) };
  }
  function readIfd(u8) { return tiffReader(u8).first(); }
  // The byte ranges an image's pixels live in (strips or tiles).
  function blocksOf(ifd) {
    const offs = ifd.get(324) || ifd.get(273), lens = ifd.get(325) || ifd.get(279);
    if (!offs || !lens || offs.length !== lens.length) throw err('tiff', 'blocks');
    return offs.map((o, i) => ({ off: o, len: lens[i] }));
  }

  // ---------- EXIF DateTimeOriginal ----------
  // → 'YYYY:MM:DD HH:MM:SS' | null. JPEG (APP1 "Exif") and TIFF files.
  function exifDate(u8) {
    try {
      const k = sniff(u8);
      let base = -1;
      if (k === 'tiff') base = 0;
      else if (k === 'jpeg') {
        let p = 2;
        while (p + 4 <= u8.length && u8[p] === 0xFF) {
          const mk = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3];
          if (mk === 0xDA || mk === 0xD9) break;
          if (mk === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66 && u8[p + 8] === 0 && u8[p + 9] === 0) { base = p + 10; break; }
          p += 2 + len;
        }
      }
      if (base < 0) return null;
      const r = tiffReader(u8, base), ifd0 = r.first(), ptr = ifd0.get(0x8769);
      if (!ptr) return null;
      const s = r.ifdAt(ptr[0]).get(0x9003);
      return typeof s === 'string' && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(s) && !/^0000/.test(s) ? s.slice(0, 19) : null;
    } catch (e) { return null; }
  }

  // ---------- TIFF decoder ----------
  function packbits(src, expected) {
    const out = new Uint8Array(expected); let ip = 0, op = 0;
    while (ip < src.length && op < expected) {
      const n = (src[ip++] << 24) >> 24;
      if (n >= 0) { const c = Math.min(n + 1, expected - op, src.length - ip); out.set(src.subarray(ip, ip + c), op); ip += n + 1; op += c; }
      else if (n !== -128) { const c = Math.min(1 - n, expected - op), v = src[ip++]; out.fill(v, op, op + c); op += c; }
    }
    return out;
  }
  // TIFF LZW: MSB-first codes of 9–12 bits, Clear 256, EOI 257, and libtiff's
  // "early change" (the width grows one code early). The pre-1992 LSB-first variant
  // starts with 0x00 0x01 and is refused rather than decoded wrongly.
  function lzw(src, expected) {
    if (src.length >= 2 && src[0] === 0 && (src[1] & 1)) throw err('unsupported', 'old-lzw');
    const out = new Uint8Array(expected);
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), len = new Int32Array(4096), first = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; len[i] = 1; first[i] = i; }
    let bit = 0, width = 9, next = 258, old = -1, op = 0;
    const total = src.length * 8;
    const read = () => {
      if (bit + width > total) return 257;
      const p = bit >> 3, w = ((src[p] << 16) | ((src[p + 1] || 0) << 8) | (src[p + 2] || 0)) >>> 0;
      const c = (w >>> (24 - (bit & 7) - width)) & ((1 << width) - 1);
      bit += width; return c;
    };
    const emit = code => {
      const l = len[code]; let c = code;
      for (let i = l - 1; i >= 0; i--) { if (op + i < expected) out[op + i] = suffix[c]; c = prefix[c]; }
      op += l;
    };
    const add = (p, ch) => { if (next >= 4096) return; prefix[next] = p; suffix[next] = ch; len[next] = len[p] + 1; first[next] = first[p]; next++; };
    while (op < expected) {
      let code = read();
      if (code === 257) break;
      if (code === 256) {
        width = 9; next = 258;
        code = read();
        if (code === 257) break;
        if (code > 255) throw err('tiff', 'lzw');
        emit(code); old = code; continue;
      }
      if (old < 0) throw err('tiff', 'lzw');
      if (code < next) { emit(code); add(old, first[code]); }
      else if (code === next) { add(old, first[old]); emit(code); }
      else throw err('tiff', 'lzw');
      old = code;
      if (next + 1 >= (1 << width) && width < 12) width++;
    }
    return out;
  }
  // Bounded like packbits and lzw: at most `expected` bytes are kept and the stream is
  // cancelled once they have arrived. A few hundred KB of Deflate can expand to
  // gigabytes; folder imports decode without anyone clicking, so an unbounded read
  // would crash the page on every launch while the file sits in the folder.
  async function inflate(src, expected) {
    if (typeof DecompressionStream === 'undefined') throw err('unsupported', 'deflate');
    const s = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate'));
    const out = new Uint8Array(expected), rd = s.getReader();
    let op = 0;
    try {
      while (op < expected) {
        const { done, value } = await rd.read();
        if (done) break;
        const c = Math.min(value.length, expected - op);
        out.set(c === value.length ? value : value.subarray(0, c), op); op += c;
      }
    } finally { rd.cancel().catch(() => { }); }
    return op === expected ? out : out.subarray(0, op);
  }
  // Pixel budget: what a canvas can hold everywhere, and what a clinic photo needs.
  const MAX_PIXELS = 100e6;
  // → {w, h, data: Uint8ClampedArray RGBA}. Throws {code:'unsupported', detail} for
  // what this decoder does not handle, {code:'tiff'} for a damaged file.
  async function decodeTiff(u8) {
    const k = sniff(u8);
    if (k === 'bigtiff') throw err('unsupported', 'bigtiff');
    if (k !== 'tiff') throw err('tiff', 'magic');
    const r = tiffReader(u8), ifd = r.first();
    const g = (t, d) => { const v = ifd.get(t); return v && v.length ? v[0] : d; };
    const w = g(256, 0), h = g(257, 0);
    if (!(w > 0 && h > 0)) throw err('tiff', 'size');
    if (w * h > MAX_PIXELS) throw err('unsupported', 'too-large');
    const comp = g(259, 1), photo = g(262, 1), spp = g(277, 1), planar = g(284, 1), pred = g(317, 1), fmt = g(339, 1);
    const bpsA = ifd.get(258) || [1], bps = bpsA[0];
    if (bpsA.some(b => b !== bps)) throw err('unsupported', 'mixed-bits');
    if ([1, 2, 4, 8, 16].indexOf(bps) < 0) throw err('unsupported', 'bits-' + bps);
    if (fmt !== 1) throw err('unsupported', 'sample-format');
    if (comp === 6 || comp === 7) throw err('unsupported', 'jpeg-in-tiff');
    if ([1, 5, 8, 32946, 32773].indexOf(comp) < 0) throw err('unsupported', 'compression-' + comp);
    if (pred !== 1 && !(pred === 2 && bps >= 8)) throw err('unsupported', 'predictor-' + pred);
    const need = { 0: 1, 1: 1, 2: 3, 3: 1, 5: 4 }[photo];
    if (!need) throw err('unsupported', 'photometric-' + photo);
    if (spp < need || spp > 8) throw err('unsupported', 'samples');
    const tiled = ifd.has(322);
    const tw = tiled ? g(322, 0) : w, th = tiled ? g(323, 0) : Math.min(g(278, h), h);
    if (!(tw > 0 && th > 0)) throw err('tiff', 'block-size');
    const blocks = blocksOf(ifd);
    const across = Math.ceil(w / tw), down = Math.ceil(h / th), perPlane = across * down, planes = planar === 2 ? spp : 1;
    if (blocks.length < perPlane * planes) throw err('tiff', 'blocks');
    // A palette image has 4- or 8-bit indices (TIFF 6.0); a 16-bit index kept only its
    // high byte here and looked up the wrong colour, so it is refused, not decoded wrongly.
    if (photo === 3 && bps > 8) throw err('unsupported', 'bits-' + bps + '-palette');
    const cmap = photo === 3 ? ifd.get(320) : null;
    if (photo === 3 && (!cmap || cmap.length < 3 * (1 << bps))) throw err('tiff', 'colormap');
    const orient = g(274, 1);
    // Samples, 8-bit (16-bit keeps its high byte; 1/2/4-bit gray is scaled; palette
    // indices stay raw so they still index the colour map).
    const S = new Uint8Array(w * h * spp), bpb = bps / 8;
    const big = !r.le;
    for (let pl = 0; pl < planes; pl++) {
      for (let bi = 0; bi < perPlane; bi++) {
        const b = blocks[pl * perPlane + bi];
        const bx = (bi % across) * tw, by = Math.floor(bi / across) * th;
        const rows = tiled ? th : Math.min(th, h - by), cols = tiled ? tw : w;
        const sppB = planar === 2 ? 1 : spp, rowBytes = Math.ceil(cols * sppB * bps / 8), expected = rowBytes * rows;
        let src = u8.subarray(b.off, b.off + b.len), raw;
        if (comp === 1) raw = src;
        else if (comp === 32773) raw = packbits(src, expected);
        else if (comp === 5) raw = lzw(src, expected);
        else raw = await inflate(src, expected);
        if (raw.length < expected) { const t = new Uint8Array(expected); t.set(raw); raw = t; }   // short last strip: zeros, not a throw
        if (pred === 2) {
          raw = raw.slice(0, expected);
          for (let y = 0; y < rows; y++) {
            if (bps === 8) { const o = y * rowBytes; for (let i = sppB; i < cols * sppB; i++) raw[o + i] = (raw[o + i] + raw[o + i - sppB]) & 255; }
            else {   // 16-bit, in file byte order
              const dv = new DataView(raw.buffer, raw.byteOffset, raw.length), o = y * rowBytes;
              for (let i = sppB; i < cols * sppB; i++) dv.setUint16(o + i * 2, (dv.getUint16(o + i * 2, !big) + dv.getUint16(o + (i - sppB) * 2, !big)) & 0xFFFF, !big);
            }
          }
        }
        for (let y = 0; y < rows; y++) {
          const iy = by + y; if (iy >= h) break;
          const o = y * rowBytes;
          for (let x = 0; x < cols; x++) {
            const ix = bx + x; if (ix >= w) break;
            for (let s = 0; s < sppB; s++) {
              const si = x * sppB + s; let v;
              if (bps === 8) v = raw[o + si];
              else if (bps === 16) v = big ? raw[o + si * 2] : raw[o + si * 2 + 1];
              else {
                const bit = si * bps, byte = raw[o + (bit >> 3)], sh = 8 - bps - (bit & 7);
                v = (byte >> sh) & ((1 << bps) - 1);
                if (photo !== 3) v = Math.round(v * 255 / ((1 << bps) - 1));
              }
              S[(iy * w + ix) * spp + (planar === 2 ? pl : s)] = v;
            }
          }
        }
      }
    }
    const out = new Uint8ClampedArray(w * h * 4), n = 1 << bps;
    for (let i = 0, p = 0; i < w * h; i++, p += spp) {
      let R, G, B;
      if (photo === 2) { R = S[p]; G = S[p + 1]; B = S[p + 2]; }
      else if (photo === 3) { const ix = S[p]; R = cmap[ix] >> 8; G = cmap[n + ix] >> 8; B = cmap[2 * n + ix] >> 8; }
      else if (photo === 5) { const c = S[p], m = S[p + 1], yy = S[p + 2], kk = S[p + 3]; R = 255 - Math.min(255, c + kk); G = 255 - Math.min(255, m + kk); B = 255 - Math.min(255, yy + kk); }
      else { R = G = B = photo === 0 ? 255 - S[p] : S[p]; }
      out[i * 4] = R; out[i * 4 + 1] = G; out[i * 4 + 2] = B; out[i * 4 + 3] = 255;   // extra (alpha) samples dropped: a photograph is opaque
    }
    return orientRgba(out, w, h, orient);
  }
  // TIFF Orientation (tag 274): the stored rows are turned into the visual picture, as a
  // browser does for a JPEG's EXIF orientation. 1 is the default; 5–8 swap width and height.
  //   2 mirror horizontal · 3 rotate 180 · 4 mirror vertical · 5 transpose · 6 rotate 90 CW ·
  //   7 transverse · 8 rotate 90 CCW
  function orientRgba(src, w, h, orient) {
    orient = +orient || 1;
    if (orient < 2 || orient > 8) return { w, h, data: src };
    const swap = orient >= 5, W = swap ? h : w, H = swap ? w : h, out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let X, Y;
      switch (orient) {
        case 2: X = w - 1 - x; Y = y; break;
        case 3: X = w - 1 - x; Y = h - 1 - y; break;
        case 4: X = x; Y = h - 1 - y; break;
        case 5: X = y; Y = x; break;
        case 6: X = h - 1 - y; Y = x; break;
        case 7: X = h - 1 - y; Y = w - 1 - x; break;
        default: X = y; Y = w - 1 - x; break;   // 8
      }
      const si = (y * w + x) * 4, di = (Y * W + X) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
    return { w: W, h: H, data: out };
  }

  // ---------- "finished being written" bookkeeping ----------
  // A file is taken only after its size and modification time were the same on two
  // looks at least stableMs apart. A changed file starts over (it is new content).
  //   observe(rel, size, mtime, now) → 'wait' | 'ready' | 'done'
  function createTracker(o) {
    const stableMs = (o && o.stableMs != null) ? +o.stableMs : 3000, m = new Map();
    return {
      observe(rel, size, mtime, now) {
        const sig = size + ':' + mtime, p = m.get(rel);
        if (!p || p.sig !== sig) { m.set(rel, { sig, at: now, done: false }); return 'wait'; }
        if (p.done) return 'done';
        return now - p.at >= stableMs ? 'ready' : 'wait';
      },
      done(rel) { const p = m.get(rel); if (p) p.done = true; },
      reset(rel) { m.delete(rel); },
      // Files no longer present are forgotten (a re-created file is looked at again).
      keepOnly(present) { for (const k of [...m.keys()]) if (!present.has(k)) m.delete(k); },
      pending() { let n = 0; m.forEach(p => { if (!p.done) n++; }); return n; },
      sigOf: rel => { const p = m.get(rel); return p ? p.sig : null; }
    };
  }

  return { EXT, MIME, extKind, isWatchedName, sniff, complete, inspect, tokens, guessEye, exifDate, decodeTiff, orientRgba, readIfd, packbits, lzw, createTracker, MAX_PIXELS };
});
