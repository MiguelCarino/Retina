/* ============================================================
   archive.js — the desktop app's DICOMweb sender (main process).
   ------------------------------------------------------------
   Why the main process sends, not the page: the page is served from
   app://carino, a secure origin. A clinic archive is usually plain
   http:// on the LAN, and a secure page may not fetch http:// from
   anywhere but loopback (mixed content), nor without the archive
   listing app://carino in its CORS origins. Sending from here has
   neither limit.

   Why the main process keeps the token: a Carino DICOM bearer token is
   the archive's administrator credential. It is stored encrypted with
   the OS keychain (Electron safeStorage) in userData/archive.json and
   is never handed back to the page — status() only says whether one is
   set. Without OS encryption — or with only Linux's hard-coded-key
   'basic_text' fallback — it is kept in memory for this run only.

   The page never names a URL when sending: it may only post to
   `${base}/studies`, where base is what the user saved in Settings.

   Pure Node with injected fetch / crypto, so tools/unit-tests.js can
   drive it without Electron.
   ============================================================ */
"use strict";

const fs = require("fs");

const MAX_PARTS = 64;
const MAX_BYTES = 1024 * 1024 * 1024;         // Carino DICOM's own STOW ceiling
const TEST_TIMEOUT_MS = 15000;

// http(s) only; no credentials, query or fragment; trailing slash dropped.
function normBase(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch (e) { return ""; }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || u.search || u.hash) return "";
  return (u.origin + u.pathname).replace(/\/+$/, "");
}

function createArchive(opts) {
  const file = opts.file, doFetch = opts.fetch, crypt = opts.crypt || null;
  let base = "", tokenEnc = null, memToken = null;

  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    base = normBase(j.base);
    tokenEnc = typeof j.tokenEnc === "string" && j.tokenEnc ? j.tokenEnc : null;
  } catch (e) { /* first run, or unreadable: start unconfigured */ }

  // weak(): the OS "encryption" is only obfuscation — Electron on Linux with no
  // secret service (no gnome-keyring/kwallet, typical of a kiosk AppImage) still
  // reports available() but uses a hard-coded key ('basic_text'). That is not
  // storage a bearer token for the archive belongs in, so it counts as none.
  const isWeak = () => { try { return !!(crypt && crypt.weak && crypt.weak()); } catch (e) { return false; } };
  const canEncrypt = () => { try { return !!(crypt && crypt.available()) && !isWeak(); } catch (e) { return false; } };
  function token() {
    if (memToken) return memToken;
    if (!tokenEnc || !canEncrypt()) return "";
    try { return crypt.decrypt(Buffer.from(tokenEnc, "base64")); } catch (e) { return ""; }
  }
  function persist() {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, base, tokenEnc }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const status = () => ({ base, hasToken: !!token(), persistent: !memToken });

  // A token saved by an earlier run under the weak backend decrypts with that
  // fixed key, i.e. it is readable by anyone with the file: take it off disk.
  // One saved under a real keyring does not decrypt here and is left alone, so
  // a keyring that merely failed to start this time does not cost the token.
  if (tokenEnc && isWeak()) {
    let readable = false;
    try { readable = !!crypt.decrypt(Buffer.from(tokenEnc, "base64")); } catch (e) { /* keyring-sealed */ }
    if (readable) { tokenEnc = null; try { persist(); } catch (e) { /* read-only data dir: nothing more to do */ } }
  }

  // token: null keeps the saved one, "" clears it, a string replaces it.
  // A new ORIGIN with no token given drops the old token: it was issued by the
  // previous archive and must not be presented to a different server.
  function configure(newBase, newToken) {
    const b = normBase(newBase);
    if (newBase && !b) return Object.assign(status(), { error: "bad-base" });
    const originOf = (x) => { try { return new URL(x).origin; } catch (e) { return ""; } };
    if (newToken == null && originOf(b) !== originOf(base)) { tokenEnc = null; memToken = null; }
    base = b;
    if (newToken != null) {
      const tk = String(newToken).trim();
      tokenEnc = null; memToken = null;
      if (tk) {
        if (canEncrypt()) tokenEnc = crypt.encrypt(tk).toString("base64");
        else memToken = tk;
      }
    }
    persist();
    return status();
  }

  function headers(extra) {
    const h = Object.assign({}, extra || {});
    const tk = token();
    if (tk) h.Authorization = "Bearer " + tk;
    return h;
  }
  // Every reply is reduced to plain data: status, parsed JSON (or a short text
  // detail), Retry-After. Network and timeout failures become codes, never throws.
  async function exchange(url, init, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      // redirect: "error" — a 307/308 would re-POST the whole body (patient pixels, the
      // report) and the bearer token to whatever host Location names. The page refuses
      // redirects too (webExchange); the archive is always addressed directly.
      const r = await doFetch(url, Object.assign({}, init, { signal: ac.signal, redirect: "error" }));
      const ct = String(r.headers.get("content-type") || "");
      let json = null, detail = "";
      const text = await r.text().catch(() => "");
      if (/json/i.test(ct)) { try { json = JSON.parse(text); } catch (e) { /* keep the text */ } }
      if (json && !Array.isArray(json) && typeof json.error === "string") detail = json.error.slice(0, 300);
      else if (!json) detail = text.slice(0, 300);
      const ra = r.headers.get("retry-after");
      return { http: r.status, json, detail, retryAfter: ra && /^\d+$/.test(ra) ? +ra : null, netError: null };
    } catch (e) {
      return { http: 0, json: null, detail: String(e && e.message || e).slice(0, 300), retryAfter: null,
        netError: ac.signal.aborted ? "timeout" : "network" };
    } finally { clearTimeout(timer); }
  }

  function test() {
    if (!base) return Promise.resolve({ http: 0, netError: null, detail: "", code: "no-base" });
    return exchange(base + "/studies?limit=1&includefield=0020000D", { method: "GET", headers: headers({ Accept: "application/dicom+json" }) }, TEST_TIMEOUT_MS)
      .then((r) => Object.assign(r, { json: null }));   // the study list is not the page's business
  }

  // parts: Part-10 files (ArrayBuffer | Uint8Array). One multipart/related body.
  function send(parts, timeoutMs) {
    if (!base) return Promise.resolve({ http: 0, netError: null, detail: "", code: "no-base" });
    if (!Array.isArray(parts) || !parts.length || parts.length > MAX_PARTS) return Promise.resolve({ http: 0, code: "bad-parts" });
    const bufs = [];
    let total = 0;
    for (const p of parts) {
      const b = p instanceof ArrayBuffer ? Buffer.from(p) : ArrayBuffer.isView(p) ? Buffer.from(p.buffer, p.byteOffset, p.byteLength) : null;
      if (!b) return Promise.resolve({ http: 0, code: "bad-parts" });
      total += b.length; bufs.push(b);
    }
    if (total > MAX_BYTES) return Promise.resolve({ http: 0, code: "too-large" });
    const boundary = "carino-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    const chunks = [];
    for (const b of bufs) chunks.push(Buffer.from("--" + boundary + "\r\nContent-Type: application/dicom\r\n\r\n"), b, Buffer.from("\r\n"));
    chunks.push(Buffer.from("--" + boundary + "--\r\n"));
    const t = Math.min(3600e3, Math.max(120e3, +timeoutMs || 0));
    return exchange(base + "/studies", {
      method: "POST",
      headers: headers({ "Content-Type": 'multipart/related; type="application/dicom"; boundary=' + boundary, Accept: "application/dicom+json" }),
      body: Buffer.concat(chunks),
    }, t);
  }

  return { status, configure, test, send };
}

module.exports = { createArchive, normBase };
