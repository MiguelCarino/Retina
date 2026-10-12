#!/usr/bin/env node
/* ============================================================
   browser-big-images.js — headless check that large pictures persist.
   ------------------------------------------------------------
   The guarantee behind moving visits from localStorage to IndexedDB:
   two photos of more than 3 MB each (well past the old ~5 MB ceiling
   together) survive a reload byte for byte, with their marks and the
   typed fields, and no study is left in localStorage.

   Not run in CI: it needs a Chromium and the playwright-core package,
   neither of which belongs in this repository (no build step, no
   node_modules). tools/unit-tests.js covers the pure logic under it.
   Run it by hand after touching storage or Load image:

     npm i --prefix /some/scratch/dir playwright-core
     NODE_PATH=/some/scratch/dir/node_modules node tools/browser-big-images.js
     # CHROMIUM=/path/to/chrome-headless-shell to use a particular browser

   It serves the repository itself on a free loopback port, opens one
   fresh browser context (an empty profile), and exits non-zero on failure.
   ============================================================ */
"use strict";

const http = require("http"), fs = require("fs"), path = require("path");
let chromium;
try { ({ chromium } = require("playwright-core")); }
catch (e) { console.error("playwright-core not found: see the header of this file"); process.exit(2); }

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

// Loopback only, repository files only.
function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(abs).toLowerCase()] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log((cond ? "ok   " : "FAIL ") + name + (cond || detail === undefined ? "" : "  " + JSON.stringify(detail).slice(0, 300)));
}

(async () => {
  const srv = await serve(), url = "http://127.0.0.1:" + srv.address().port + "/index.html";
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "retina-big-"));
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const ctx = await browser.newContext(), p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    const ready = () => p.waitForFunction(() => window.__ophtha && window.__ophtha.storageState().ready, null, { timeout: 20000 });
    const settled = () => p.waitForFunction(() => { const s = window.__ophtha.storageState(); return !s.dirty && s.saveState !== "saving"; }, null, { timeout: 20000 });
    await p.goto(url); await ready(); await settled();
    check("IndexedDB storage in use", (await p.evaluate(() => window.__ophtha.storageState().mode)) === "idb");

    // Random-noise JPEGs at high quality: they do not compress, so 2200×1700 is > 3 MB.
    const noise = async (seed) => {
      const b64 = await p.evaluate((seed) => {
        const c = document.createElement("canvas"); c.width = 2200; c.height = 1700;
        const x = c.getContext("2d"), d = x.createImageData(c.width, c.height); let s = seed;
        for (let i = 0; i < d.data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d.data[i] = (i & 3) === 3 ? 255 : (s >> 16) & 255; }
        x.putImageData(d, 0, 0); return c.toDataURL("image/jpeg", 0.95).split(",")[1];
      }, seed);
      const f = path.join(tmp, "noise" + seed + ".jpg"); fs.writeFileSync(f, Buffer.from(b64, "base64")); return f;
    };
    const fOD = await noise(1), fOS = await noise(2);
    check("test pictures are > 3 MB each", fs.statSync(fOD).size > 3e6 && fs.statSync(fOS).size > 3e6);

    // Each eye starts empty (a sample at most), so Load image makes it the eye's own picture.
    await p.setInputFiles("#fileInput", fOD);
    await p.waitForFunction(() => window.__ophtha.study.eyes.OD.imgRef, null, { timeout: 20000 });
    await p.evaluate(() => window.__ophtha.switchEye("OS"));
    await p.setInputFiles("#fileInput", fOS);
    await p.waitForFunction(() => window.__ophtha.study.eyes.OS.imgRef, null, { timeout: 20000 });
    await p.evaluate(() => window.__ophtha.study.eyes.OD.marks.push({ id: "m90", kind: "disc", cx: 500, cy: 400, rx: 80, ry: 90 }));
    await p.click('#topnav button[data-mod="exam"]');
    await p.fill('input.cl[data-eye="OD"][data-f="dx"]', "observation text");
    await settled();
    const before = await p.evaluate(() => { const e = window.__ophtha.study.eyes; return { OD: e.OD.img, OS: e.OS.img }; });

    await p.reload(); await ready();
    const after = await p.evaluate(() => { const s = window.__ophtha.study;
      return { OD: s.eyes.OD.img, OS: s.eyes.OS.img, marks: s.eyes.OD.marks.length, dx: s.eyes.OD.clinical.dx, gallery: s.eyes.OD.gallery.length + s.eyes.OS.gallery.length }; });
    check("both pictures byte-identical after reload", after.OD === before.OD && after.OS === before.OS && after.OD.length > 4e6,
      { before: [before.OD.length, before.OS.length], after: [after.OD && after.OD.length, after.OS && after.OS.length] });
    check("marks and fields persist", after.marks === 1 && after.dx === "observation text", after);
    check("loaded into empty eyes: nothing went to a gallery", after.gallery === 0, after);
    check("no study in localStorage", !(await p.evaluate(() => Object.keys(localStorage))).includes("carino_ophtha_v1"));
    check("usage beyond the old 5 MB ceiling", (await p.evaluate(async () => (await navigator.storage.estimate()).usage)) > 6e6);
    check("no page errors", errs.length === 0, errs);
    await ctx.close();
  } finally {
    await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? failed + " failed" : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
