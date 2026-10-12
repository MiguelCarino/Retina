/* ============================================================
   inbox-watcher.js — the desktop app's watched folder (main process).
   ------------------------------------------------------------
   A fundus camera or OCT exports into a folder; this notices new files
   there and offers them to the page's Inbox. Rules, all of them about
   never doing harm to the folder or reading outside it:

   - READ ONLY. Nothing here writes, renames, moves or deletes a file.
     The page keeps its own copy; the device's export stays as it was.
   - Only the chosen folder, at most `maxDepth` levels of subfolders.
     The root is resolved to its real path once. Symbolic links are never
     followed — not for files, not for folders (lstat, Dirent types, and
     O_NOFOLLOW on open); after opening, fstat must be the same file
     (device + inode + size) that was listed, and its real path must lie
     under the root. A link swapped in between listing and reading is
     therefore refused, not read.
   - Only what a clinic device exports: .jpg .jpeg .png .bmp .tif .tiff
     .pdf, between 1 byte and `maxBytes`; and the bytes must say the same
     thing as the name (a JPEG called .pdf is refused, not guessed at).
   - Only finished files: same size and modification time on two looks at
     least `stableMs` apart, and then the format's own end marker
     (RetinaInbox.inspect). A file still being written is looked at again.
   - Discovery is the periodic rescan. fs.watch on the root (not recursive:
     that is not portable) is only a hint that brings the next rescan
     forward.
   - The page gets METADATA (id, relative path, name, size, mtime,
     sha256); the bytes only when it asks for one id (read), and only
     after the file is checked again to be the very file that was hashed.

   Pure Node: no Electron here, so tools/unit-tests.js drives it against a
   temporary folder. The format checks come from retina-inbox.js (the same
   code the website uses), injected as `lib`.
   ============================================================ */
"use strict";

const fsMod = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULTS = { stableMs: 3000, rescanMs: 15000, maxBytes: 50 * 1024 * 1024, maxDepth: 3, maxFiles: 20000 };

// The root and every file are canonicalised by the SAME implementation: the native
// one, which is what fs.promises.realpath uses. Node's JS realpathSync keeps a mapped
// or SUBST drive (Z:\exports) as given while the native call resolves it to its UNC
// path, so mixing them would refuse every file on a network share as "outside".
function realpathNative(fs, p) {
  return (fs.realpathSync.native || fs.realpathSync)(p);   // a test double may lack .native
}

// Walks the folder, never through a link. → Promise<[{abs, rel}]> of candidate files,
// with out.partial = true when a subfolder could not be read or maxFiles cut the walk
// short: what is missing from such a list may still be there.
// Asynchronous like everything else here that touches the folder: on a slow network
// share a synchronous walk of up to maxFiles entries would stall the main process,
// and with it both windows and every IPC call, for as long as the share takes.
async function listCandidates(fs, root, lib, maxDepth, maxFiles) {
  const out = [];
  out.partial = false;
  const walk = async (dir, rel, depth) => {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (depth === 0) throw e; out.partial = true; return; }
    for (const d of ents) {
      if (out.length >= maxFiles) { out.partial = true; return; }
      if (d.name.startsWith(".")) continue;          // .DS_Store, ._ resource forks, half-written dotfiles
      const abs = path.join(dir, d.name), r = rel ? rel + "/" + d.name : d.name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) { if (depth < maxDepth) await walk(abs, r, depth + 1); continue; }
      if (d.isFile() && lib.isWatchedName(d.name)) out.push({ abs, rel: r });
    }
  };
  await walk(root, "", 0);
  return out;
}

function createWatcher(opts) {
  const o = Object.assign({}, DEFAULTS, opts);
  const fs = o.fs || fsMod, fsp = fs.promises, lib = o.lib;
  if (!lib || typeof lib.inspect !== "function") throw Object.assign(new Error("lib"), { code: "lib" });
  let root;
  try { root = realpathNative(fs, o.root); } catch (e) { throw Object.assign(new Error("root"), { code: "root-missing" }); }
  if (!fs.statSync(root).isDirectory()) throw Object.assign(new Error("root"), { code: "root-not-dir" });
  const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
  const O_NOFOLLOW = (fs.constants && fs.constants.O_NOFOLLOW) || 0;   // 0 on Windows: the fstat + realpath checks still hold
  const tracker = lib.createTracker({ stableMs: o.stableMs });
  // "Only new from now": files present when the folder was chosen, by size:mtime.
  const ignore = o.ignore instanceof Map ? o.ignore : new Map(Object.entries(o.ignore || {}));
  const byId = new Map();       // id → {abs, rel, name, dev, ino, size, mtimeMs, sha256}
  const relState = new Map();   // rel → {id} | {reason}
  let timer = null, interval = null, fsw = null, stopped = true, scanning = null, lastScan = 0, lastError = null;
  const now = () => (o.now ? o.now() : Date.now());

  // Open without following a link, then prove it is the file that was listed and
  // that it lies inside the root. Asynchronous: this runs in the main process, and a
  // folder of large exports read synchronously would freeze both windows.
  // → {buf, st} | {err}
  async function readChecked(abs, lst) {
    let fh;
    try { fh = await fsp.open(abs, fs.constants.O_RDONLY | O_NOFOLLOW); }
    catch (e) { return { err: e.code === "ELOOP" || e.code === "EMLINK" ? "link" : "gone" }; }
    try {
      const st = await fh.stat();
      if (!st.isFile() || st.dev !== lst.dev || st.ino !== lst.ino || st.size !== lst.size) return { err: "changed" };
      let real;
      try { real = await fsp.realpath(abs); } catch (e) { return { err: "gone" }; }
      if (!real.startsWith(rootSep)) return { err: "outside" };
      const buf = Buffer.alloc(st.size);
      let off = 0;
      while (off < st.size) { const { bytesRead } = await fh.read(buf, off, st.size - off, off); if (!bytesRead) break; off += bytesRead; }
      if (off !== st.size) return { err: "changed" };
      return { buf, st };
    } finally { try { await fh.close(); } catch (e) { /* already closed */ } }
  }

  async function scanOnce() {
    const t = now();
    let cands;
    try { cands = await listCandidates(fs, root, lib, o.maxDepth, o.maxFiles); lastError = null; }
    catch (e) { lastError = e.code || "scan"; emitStatus(); return; }
    const present = new Set();
    for (const c of cands) {
      let st;
      try { st = await fsp.lstat(c.abs); } catch (e) { continue; }
      if (st.isSymbolicLink() || !st.isFile()) continue;
      present.add(c.rel);
      const sig = st.size + ":" + st.mtimeMs;
      if (ignore.get(c.rel) === sig) continue;
      if (st.size > o.maxBytes) { if (tracker.sigOf(c.rel) !== sig) { tracker.observe(c.rel, st.size, st.mtimeMs, t); tracker.done(c.rel); relState.set(c.rel, { reason: "too-large" }); } continue; }
      const s = tracker.observe(c.rel, st.size, st.mtimeMs, t);
      if (s !== "ready") continue;
      if (st.size === 0) { tracker.done(c.rel); relState.set(c.rel, { reason: "empty" }); continue; }
      if (stopped && !manual) return;
      const r = await readChecked(c.abs, st);
      if (r.err === "changed" || r.err === "gone") { tracker.reset(c.rel); continue; }   // still moving: look again
      if (r.err) { tracker.done(c.rel); relState.set(c.rel, { reason: r.err }); continue; }
      const ins = lib.inspect(new Uint8Array(r.buf.buffer, r.buf.byteOffset, r.buf.length), c.rel, { strictExt: true });
      tracker.done(c.rel);   // a changed file (new size or time) is looked at again
      if (!ins.ok) { relState.set(c.rel, { reason: ins.reason }); continue; }
      const sha256 = crypto.createHash("sha256").update(r.buf).digest("hex");
      const id = crypto.randomBytes(12).toString("hex");
      const meta = { id, relPath: c.rel, name: path.basename(c.abs), size: st.size, mtime: st.mtimeMs, sha256, kind: ins.kind };
      // Replaces any earlier id for the same path: that content is gone from the folder.
      const prev = relState.get(c.rel);
      if (prev && prev.id) byId.delete(prev.id);
      byId.set(id, { abs: c.abs, rel: c.rel, name: meta.name, dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, sha256, kind: ins.kind });
      relState.set(c.rel, { id });
      try { if (o.onFile) o.onFile(Object.assign({}, meta)); } catch (e) { /* the listener's problem */ }
    }
    // Forget what is gone only after a complete walk. A share that drops for a moment
    // (an unreadable subfolder) must not cost the "Only new from now" baseline of the
    // files in it: they would all come in when it is back.
    if (!cands.partial) {
      tracker.keepOnly(present);
      for (const [rel, v] of [...relState]) if (!present.has(rel)) { if (v.id) byId.delete(v.id); relState.delete(rel); }
      for (const k of [...ignore.keys()]) if (!present.has(k)) ignore.delete(k);
    }
    lastScan = t;
    emitStatus();
    // Something seen once and not yet stable: look again as soon as it can be.
    if (!stopped && tracker.pending()) schedule(o.stableMs + 100);
  }
  let manual = false;
  function scan() {
    if (scanning) return scanning;
    scanning = scanOnce().catch(e => { lastError = e && e.code || "scan"; }).finally(() => { scanning = null; manual = false; });
    return scanning;
  }
  function schedule(ms) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; scan(); }, ms);
    if (timer.unref) timer.unref();
  }
  function status() {
    const skipped = [];
    relState.forEach((v, rel) => { if (v.reason && skipped.length < 100) skipped.push({ relPath: rel, reason: v.reason }); });
    return { root, name: path.basename(root), watching: !stopped, lastScan, error: lastError, files: byId.size, waiting: tracker.pending(), skipped };
  }
  function emitStatus() { try { if (o.onStatus) o.onStatus(status()); } catch (e) { /* listener */ } }

  return {
    root,
    start() {
      if (!stopped) return;
      stopped = false;
      try {
        fsw = fs.watch(root, { persistent: false }, () => schedule(500));
        fsw.on("error", () => { try { fsw.close(); } catch (e) { } fsw = null; });   // the rescan still covers it
      } catch (e) { fsw = null; }
      interval = setInterval(() => scan(), o.rescanMs);
      if (interval.unref) interval.unref();
      scan();
    },
    stop() {
      stopped = true;
      clearTimeout(timer); timer = null;
      clearInterval(interval); interval = null;
      if (fsw) { try { fsw.close(); } catch (e) { } fsw = null; }
      emitStatus();
    },
    scan() { manual = true; return scan(); },
    status,
    list() { return [...byId.entries()].map(([id, v]) => ({ id, relPath: v.rel, name: v.name, size: v.size, mtime: v.mtimeMs, sha256: v.sha256, kind: v.kind })); },
    // The bytes of one offered file — only if it is still exactly what was hashed.
    // → Buffer, or throws {code: 'unknown' | 'gone' | 'changed' | 'link' | 'outside'}
    async read(id) {
      const v = byId.get(String(id || ""));
      const fail = c => { throw Object.assign(new Error(c), { code: c }); };
      if (!v) fail("unknown");
      let st;
      try { st = await fsp.lstat(v.abs); } catch (e) { fail("gone"); }
      if (st.isSymbolicLink() || !st.isFile()) fail("link");
      if (st.dev !== v.dev || st.ino !== v.ino || st.size !== v.size || st.mtimeMs !== v.mtimeMs) fail("changed");
      const r = await readChecked(v.abs, st);
      if (r.err) fail(r.err);
      if (crypto.createHash("sha256").update(r.buf).digest("hex") !== v.sha256) fail("changed");
      return r.buf;
    },
  };
}

// Files present now, as Promise<{rel: "size:mtime"}> — the baseline "only new from
// now" skips. Runs when a folder is picked (to count it) and again on "only new";
// asynchronous for the same reason as listCandidates.
async function snapshot(rootIn, lib, opts) {
  const o = Object.assign({}, DEFAULTS, opts), fs = o.fs || fsMod;
  const root = await fs.promises.realpath(rootIn), out = {};
  for (const c of await listCandidates(fs, root, lib, o.maxDepth, o.maxFiles)) {
    try { const st = await fs.promises.lstat(c.abs); if (st.isFile() && !st.isSymbolicLink()) out[c.rel] = st.size + ":" + st.mtimeMs; } catch (e) { }
  }
  return out;
}

// A folder Retina's own exports land in must not be watched: every PDF it saves
// would come straight back into the Inbox. Equal, inside, or containing. A separator
// is added only when missing: "/" or "C:\" already ends in one, and doubling it would
// let a filesystem root (which contains everything) pass. Windows and macOS paths
// compare without case, as those filesystems do by default.
function overlaps(a, b, platform) {
  const pl = platform || process.platform, fold = pl === "win32" || pl === "darwin";
  const norm = (p) => { let r = path.resolve(p); if (!r.endsWith(path.sep)) r += path.sep; return fold ? r.toLowerCase() : r; };
  const A = norm(a), B = norm(b);
  return A.startsWith(B) || B.startsWith(A);
}

module.exports = { createWatcher, snapshot, overlaps, listCandidates, realpathNative, DEFAULTS };
