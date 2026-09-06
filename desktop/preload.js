/* ============================================================
   Preload — the whole surface between the page and this machine.
   ------------------------------------------------------------
   contextIsolation stays true and nodeIntegration stays false, so this
   file is the ONLY channel between the shell and index.html. What it
   publishes is deliberately seven members wide, plain data only:

       window.carinoDesktop = {
         appVersion,                // "1.0.0" — a string, fixed at launch
         getUpdate(),               // → {version} | null, SYNCHRONOUS
         onUpdate(cb),              // cb({version} | null) on every check
         openReleasePage(),         // opens the release in the system browser
         screens(),                 // → the display/chart snapshot, cloned
         onScreensChanged(cb),      // cb() whenever that snapshot changes
         onChartDisplayChanged(cb), // cb() only when the chart moved display
       }

   No ipcRenderer object, no require, no fs, no path — nothing the page
   could use to reach the machine. openReleasePage() takes no argument on
   purpose: the URL it opens is the one the MAIN process recorded and
   validated, so a compromised renderer cannot turn shell.openExternal
   into an arbitrary launcher.

   getUpdate() is SYNCHRONOUS here, unlike the DICOM editor's, which
   returns ipcRenderer.invoke(...) — a Promise its own page then
   dereferences as `u.version`, so that boot-time reveal has never fired.
   A fresh object is built on every call, so the page cannot mutate its
   way into this module's cache.

   This file runs in BOTH windows: the exam panel and the chart. In the
   chart it does nothing except report {cssWidth, cssHeight, dpr} back to
   main, which cross-checks them against the display's DIP work area and
   scale factor — the only way to detect that the chart's CSS pixel is
   not the size the shell believes it is.

   index.html feature-detects this object and does nothing at all when it
   is absent, which is what keeps the browser build byte-identical to the
   one packaged here.
   ============================================================ */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const VERSION_FLAG = "--carino-app-version=";
const CHART_FLAG = "--carino-chart-window";

// In a SANDBOXED preload process.argv is a polyfill whose fidelity has moved
// between Electron majors, and an unguarded .find() throws at preload-load time
// — which fails silently: the whole bridge just never exists.
const argv = (() => {
  try { return Array.isArray(process.argv) ? process.argv : []; } catch (e) { return []; }
})();
const isChartWindow = argv.indexOf(CHART_FLAG) >= 0;

// The version arrives as a command-line argument rather than over IPC so that
// `carinoDesktop.appVersion` can be a plain string the page reads during boot
// instead of a promise it has to await before it can render. The sendSync
// fallback covers the argv polyfill losing the flag: getting this wrong would
// not throw, appVersion would just quietly be the empty string.
const appVersion = (() => {
  try {
    const flag = argv.find((a) => typeof a === "string" && a.startsWith(VERSION_FLAG));
    if (flag) return flag.slice(VERSION_FLAG.length);
  } catch (e) { /* fall through */ }
  try { return String(ipcRenderer.sendSync("carino:app-version") || ""); } catch (e) { return ""; }
})();

/* ---------------- chart window: report metrics and stop ---------------- */
if (isChartWindow) {
  const report = () => {
    try {
      ipcRenderer.send("carino:chart-metrics", {
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
      });
    } catch (e) { /* window going away */ }
  };
  // document.open()/write()/close() from the opener replaces the Document but
  // preserves the Window, so a listener registered now survives the chart being
  // written into this window — and the poll covers the first paint, which
  // happens before any resize.
  window.addEventListener("resize", report);
  window.addEventListener("load", report);
  setTimeout(report, 300);
  setInterval(report, 2000);
}

/* ---------------- update cache (synchronous read) ---------------- */
// Subscribers are kept here rather than handed to ipcRenderer.on directly, so
// the page never holds a reference to an Electron object, and so one throwing
// callback cannot stop the others from running. There is no unsubscribe: both
// of these pages live for as long as the process does, and an unsubscribe token
// would be one more thing to hand the renderer.
let update = null;
const updateSubs = [];
ipcRenderer.on("carino:update", (_e, info) => {
  update = info || null;
  for (const cb of updateSubs) {
    try { cb(update ? { version: update.version } : null); } catch (e) { /* the page's problem */ }
  }
});
ipcRenderer.invoke("carino:update").then((u) => { if (u) update = u; }).catch(() => {});

/* ---------------- screens cache (synchronous read) ---------------- */
// The shape main sends. Seeded with a believable no-chart snapshot so the page
// can read it before the first message arrives without null-checking every field.
let screens = {
  chartOpen: false, panelKey: null, panelScale: 1,
  chartKey: null, chartScale: null, chartFullscreen: false,
  metrics: null, displays: [],
};
const screenSubs = [];
const chartDisplaySubs = [];
ipcRenderer.on("carino:screens", (_e, msg) => {
  if (!msg) return;
  const prevChartKey = screens.chartKey;
  screens = msg;
  for (const cb of screenSubs) { try { cb(); } catch (e) { /* the page's problem */ } }
  // A separate list because moving the chart to another monitor invalidates the
  // calibration the page sized its optotypes with, and that is worth a redraw
  // where a mere resize of the panel is not.
  if (msg.chartKey !== prevChartKey) {
    for (const cb of chartDisplaySubs) { try { cb(); } catch (e) { /* the page's problem */ } }
  }
});
// Seed synchronously so the page's first render has a display list without a
// round trip. `carino:screens-sync` is registered inside whenReady, because the
// payload calls `screen`, which throws before then — so a preload that runs
// first gets a throw, swallows it here, and waits for the async invoke below.
// That is the intended behaviour, not a hole.
try { const seed = ipcRenderer.sendSync("carino:screens-sync"); if (seed) screens = seed; } catch (e) {}
ipcRenderer.invoke("carino:screens").then((m) => { if (m) screens = m; }).catch(() => {});

const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));

contextBridge.exposeInMainWorld("carinoDesktop", Object.freeze({
  appVersion,

  // --- the fleet four ---
  getUpdate: () => (update ? { version: update.version } : null),
  onUpdate: (cb) => { if (typeof cb === "function") updateSubs.push(cb); },
  openReleasePage: () => { ipcRenderer.send("carino:open-release"); },

  // --- Retina only: three members, all optional to the page ---
  // Everything the page needs to size an optotype correctly on a display it is
  // not running on. Plain data, cloned on every read.
  screens: () => clone(screens),
  onScreensChanged: (cb) => { if (typeof cb === "function") screenSubs.push(cb); },
  onChartDisplayChanged: (cb) => { if (typeof cb === "function") chartDisplaySubs.push(cb); },
}));
