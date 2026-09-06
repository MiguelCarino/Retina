/* ============================================================
   Carino Retina desktop — Electron shell.
   ------------------------------------------------------------
   A window around Retina's own web UI, plus the four things a browser
   tab cannot give an eye chart: a display list, a chart window that
   lands where it was asked to, a zoom that cannot move, and camera
   permission that is granted rather than prompted for on every launch.

   It does NOT load the page over file://. Retina makes zero network
   calls, so file:// would in fact boot — but every piece of state this
   app keeps lives in localStorage (carino_ophtha_v1 at index.html:967,
   carino_retina_seen at 968, carino_retina_settings at 2030, carino_lang
   from carino-lang.js:97), and localStorage on file:// has no stable
   origin to hang off. The camera (getUserMedia, index.html:2619) and
   getScreenDetails() (2081) both require a secure context with an
   attributable origin, and the chart window is an about:blank that
   INHERITS this origin. So the bundle is served over a custom app://
   scheme registered as standard + secure, exactly as the DICOM editor
   does, and the app behaves like retina.carino.systems does.

   Unlike the editor's shell, this one opens exactly one child window.
   index.html:2266 calls window.open('', 'carinoRetinaTest', feats) and
   writes the eye chart into it with document.write. A verbatim copy of
   the editor's deny-everything setWindowOpenHandler kills the whole
   Tests feature, and toast('Popup blocked — allow popups for this site')
   at 2269 then sends the clinician hunting for a browser setting that
   does not exist in a packaged app. The frame name plus an empty URL is
   the discriminator: that one name opening about:blank is allowed, and
   every other window.open and target=_blank — including one that reuses
   the name — still goes to the user's real browser.

   The features string is parsed only to CHOOSE a display; the window is
   then given that display's own DIP workArea. ScreenDetail.availLeft and
   availTop are CSS pixels in the requesting window's scale, while
   BrowserWindow bounds are DIP, and on Windows with mixed per-monitor DPI
   those two disagree — a chart placed from the parsed numbers lands part
   way off the second screen. Since the page always asks for the whole
   available area of the display it picked (screenBox(), index.html:2103),
   filling that display's work area is precisely what it wanted anyway.

   Zoom is pinned to 1 on both windows and the View menu ships no zoom
   roles at all. This app sizes letters in millimetres from a viewing
   distance; a chart at 110 % is not a bigger chart, it is a silently
   wrong acuity written into a clinical note.

   KNOWN LIMITS, to be lived with rather than papered over:
     - Wayland gives a client no absolute window positioning, so we force
       XWayland (below) and pay for it with blur on fractionally scaled
       displays. Documented in the README.
     - When the chart display has never been calibrated, the physical
       pitch is inferred and the optotype size carries that error. The
       page's HUD says so rather than hiding it, and the metrics this
       file cross-checks are what let it know.
     - window.prompt() is not implemented by Electron, so the arrow and
       freehand-outline note fields (index.html:1326, 1329) silently take
       no text here. That is a page defect this shell cannot reach; it is
       tracked separately.

   Dev run:   cd desktop && npm install && npm start
   ============================================================ */
"use strict";

const {
  app, BrowserWindow, Menu, dialog, ipcMain, protocol,
  screen, session, shell, systemPreferences,
} = require("electron");
const https = require("https");
const path = require("path");
const fs = require("fs");
// Shell-side dictionary (application menu, update dialogs). The page translates
// itself in the renderer; nothing here can. Loaded defensively: a missing
// translation file must never be the reason the app won't start. If the module
// is left out of build.files the shell just stays English (and this is why it
// is listed there).
let initI18n = () => {};
let t = (s, vals) => (vals ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vals[k] != null ? vals[k] : m)) : s);
try {
  const i18n = require("./i18n");
  initI18n = i18n.init;
  t = i18n.t;
} catch (e) { /* no dictionary shipped → English */ }

// Wayland gives a client no absolute window positioning, so both the chart's
// initial bounds and the Screen ◂ ▸ buttons are silently ignored on a default
// GNOME session — the exact feature this build exists to make reliable. Run
// through XWayland, where positioning works. Cost: XWayland blur on fractionally
// scaled displays. Documented in the README rather than left to be discovered.
if (process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland") {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}
// Never append --force-device-scale-factor or --high-dpi-support: both redefine
// the CSS pixel that the per-display calibration was measured in, which turns
// every stored calibration into a wrong one without changing a single number.

const ASSETS = path.join(__dirname, "assets");

// The web payload rides in extraResources rather than inside app.asar, so the
// files served over app:// are real files on disk that fs can stat and read. In
// development the payload is simply the repo root, one level up from here,
// which does mean `npm start` can serve desktop/ and .git/ over app:// as well;
// a packaged build cannot, because Resources/web holds nothing but the payload.
const WEB_ROOT = (() => {
  const raw = app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "..");
  // Resolve symlinks once, up front: the containment check below compares
  // resolved paths, and a WEB_ROOT that is itself a symlink would make every
  // legitimate request look like it had escaped.
  try { return fs.realpathSync(raw); } catch (e) { return path.resolve(raw); }
})();

// index.html:2266 — window.open('', 'carinoRetinaTest', feats). The frame name,
// together with the empty URL that call always passes, is the discriminator that
// separates the one child window this app opens from every target=_blank link,
// which still goes to the user's real browser.
const CHART_FRAME = "carinoRetinaTest";

let win = null;           // the exam panel
let chartWin = null;      // the presenting chart, when open
let chartMetrics = null;  // {cssWidth, cssHeight, dpr} as the chart last reported
let lastDownloadDir = null;

// ---- the app:// scheme -------------------------------------------------
// registerSchemesAsPrivileged has to run before app.whenReady(), which is why
// it sits at module scope instead of in the lifecycle section at the bottom.
//   standard        → a real origin, so localStorage and CSP behave normally
//   secure          → a secure context, which getScreenDetails() and getUserMedia
//                     both require and which crypto.subtle needs to exist
//   supportFetchAPI → fetch('logo.webp') works
//   stream          → range/streamed responses are permitted
//   corsEnabled     → same-origin requests are not treated as opaque
const SCHEME = "app";
const HOST = "carino";
const START_URL = SCHEME + "://" + HOST + "/index.html";

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Serves one file out of WEB_ROOT and refuses everything else.
//
// The containment argument, because it is the only thing standing between a
// crafted URL and the user's home directory: a standard scheme already
// collapses literal "../" segments during URL parsing, but a percent-encoded
// "%2e%2e%2f" survives that and only becomes "../" after decodeURIComponent —
// so the check must never look at the string. It looks at the RESOLVED path
// instead. Every request is joined onto WEB_ROOT and run through
// path.resolve(), which normalises "..", "." and (on Windows) backslashes into
// one absolute path; that path is then required to be WEB_ROOT itself or to
// start with WEB_ROOT + the platform separator. "app://carino/../../etc/passwd"
// and "app://carino/%2e%2e%2f%2e%2e%2fetc%2fpasswd" both resolve to /etc/passwd,
// which satisfies neither, so both get a 404. The separator is part of the
// prefix on purpose: without it a sibling directory named like the root with a
// suffix would pass. Directories are refused outright — there are no listings.
async function serveFromBundle(request) {
  let url;
  try { url = new URL(request.url); } catch (e) { return notFound(); }
  if (url.host !== HOST) return notFound();

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return notFound(); }
  if (rel.indexOf("\0") !== -1) return notFound();
  if (rel === "" || rel === "/") rel = "/index.html";

  const target = path.resolve(WEB_ROOT, "." + rel);
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) return notFound();

  // Resolved a second time, through the filesystem this time. path.resolve()
  // normalises a string; it does not follow links, and stat() and readFile()
  // both do. Without this a symlink anywhere inside the bundle is served with
  // the full contents of whatever it points at, and the containment test above
  // still passes because the STRING is inside WEB_ROOT. It is not theoretical
  // in development, where WEB_ROOT is the repo itself.
  let real;
  try { real = await fs.promises.realpath(target); } catch (e) { return notFound(); }
  if (real !== WEB_ROOT && !real.startsWith(WEB_ROOT + path.sep)) return notFound();

  let stat;
  try { stat = await fs.promises.stat(real); } catch (e) { return notFound(); }
  if (!stat.isFile()) return notFound();

  let body;
  try { body = await fs.promises.readFile(real); } catch (e) { return notFound(); }
  const type = CONTENT_TYPES[path.extname(real).toLowerCase()] || "application/octet-stream";
  return new Response(body, { headers: { "content-type": type } });
}

// ---- update check ------------------------------------------------------
// Check-only, on purpose: no electron-updater, no download, no install, no
// latest*.yml, and therefore no code signing needed to make any of it work.
//
// owner/repo lives in ONE constant and everything else is derived from it. The
// Carino DICOM shell had the two halves separate and built its API path from
// the repo half alone, which is a 404; every non-200 is treated as "no answer"
// and is silent by design, so the notifier could never fire and never said why
// — a failure indistinguishable from "you are up to date", which is the one
// failure this feature must not have. api.github.com does not follow GitHub's
// rename redirect either, so the moment this string drifts from the real repo
// the same silence returns.
const UPDATE_SLUG = "MiguelCarino/Retina";
const RELEASES_API = "https://api.github.com/repos/" + UPDATE_SLUG + "/releases/latest";
const RELEASE_PREFIX = "https://github.com/" + UPDATE_SLUG + "/";
const REPO_URL = "https://github.com/" + UPDATE_SLUG;
const LICENCE_URL = "https://github.com/" + UPDATE_SLUG + "/blob/main/LICENSE";

const CHECK_TIMEOUT_MS = 10000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Far enough after launch that the first encounter is already on screen; a
// network round trip must never compete with startup.
const FIRST_CHECK_DELAY_MS = 25000;
// The gate is the 24-hour stamp, not this interval — the timer only decides how
// often we bother to look at the clock, which matters for a clinic machine that
// stays open for days.
const CHECK_TICK_MS = 6 * 60 * 60 * 1000;
const OPT_IN_DELAY_MS = 2500;
// A release payload is a few kB. Anything past this is not the reply we asked
// for, and buffering it would be the only unbounded thing in this file.
const MAX_BODY_BYTES = 262144;

// enabled: null means the question has never been answered. Default is OFF.
let updates = { enabled: null, lastCheckMs: 0, lastSeenVersion: null };
let pendingUpdate = null;   // { version, url } once a strictly newer release is known

function updatesFile() { return path.join(app.getPath("userData"), "updates.json"); }

function loadUpdateState() {
  try {
    const j = JSON.parse(fs.readFileSync(updatesFile(), "utf8"));
    if (j && typeof j === "object") {
      updates.enabled = typeof j.enabled === "boolean" ? j.enabled : null;
      updates.lastCheckMs = Number(j.lastCheckMs) || 0;
      updates.lastSeenVersion = typeof j.lastSeenVersion === "string" ? j.lastSeenVersion : null;
    }
  } catch (e) { /* absent or corrupt → first run */ }
  // Seed from disk so the header can say what it said yesterday without waiting
  // for a round trip, and so a user who is already at or past that version sees
  // nothing at all.
  if (isNewer(updates.lastSeenVersion, app.getVersion())) {
    pendingUpdate = { version: normalise(updates.lastSeenVersion), url: releaseUrlFor(updates.lastSeenVersion) };
  }
}

function saveUpdateState() {
  try {
    fs.mkdirSync(path.dirname(updatesFile()), { recursive: true });
    fs.writeFileSync(updatesFile(), JSON.stringify(updates));
  } catch (e) { /* non-fatal: the worst case is asking again next launch */ }
}

// Strict on purpose. A tag has to be exactly X.Y.Z with an optional leading v;
// anything decorated — "v1.1.0-rc2", "2024.06", "nightly" — is unparseable and
// unparseable means "no update". /releases/latest already excludes prereleases,
// so this is a second lock on the same door.
function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s == null ? "" : s).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function normalise(tag) { const v = parseVersion(tag); return v ? v.join(".") : null; }

// Strictly newer, field by field — never a string comparison, which would put
// "1.10.0" before "1.9.0" and "1.1.0" after "1.0.0" only by luck.
function isNewer(remoteTag, localTag) {
  const a = parseVersion(remoteTag), b = parseVersion(localTag);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

// The only URL this app will ever hand to shell.openExternal from update data.
// GitHub's own html_url is preferred when it points where it should, and a URL
// derived from the tag is the fallback — so a surprising API response cannot
// turn the "release page" link into an arbitrary launcher.
function releaseUrlFor(tag, apiUrl) {
  // Parsed and compared, not string-prefixed. A prefix test accepts
  // "https://github.com/MiguelCarino/Retina/../../anything", which new URL()
  // then normalises to https://github.com/anything — bounded to github.com, so
  // not a launcher, but still somewhere we never meant to send anybody. Compare
  // the origin and require the path to be inside this repo's.
  if (typeof apiUrl === "string") {
    try {
      const u = new URL(apiUrl);
      const base = new URL(RELEASE_PREFIX);
      if (u.origin === base.origin && u.pathname.startsWith(base.pathname)) return u.href;
    } catch (e) { /* unparseable — fall through to the derived URL */ }
  }
  return RELEASE_PREFIX + "releases/tag/" + encodeURIComponent(String(tag));
}

// Resolves to { tag, url } or null. Never rejects: every failure is the same
// failure as far as the rest of this file is concerned.
function fetchLatestRelease() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = https.get(RELEASES_API, {
        headers: {
          // GitHub answers 403 to a request with no User-Agent.
          "User-Agent": "Carino-Retina/" + app.getVersion(),
          "Accept": "application/vnd.github+json",
        },
      }, (res) => {
        // Redirects are deliberately not followed. The only redirect this
        // endpoint would ever issue is the repository-rename one, and following
        // it would hide precisely the drift the pinned slug above exists to
        // make loud.
        //
        // 404 here is not a failure and must not be reported as one: it is what
        // this endpoint returns for a repository that has published no stable
        // release yet, which is Retina's situation until its first tag lands. A
        // null tag falls through isNewer() as "not newer", so the rest of this
        // file already treats it as "nothing to install" — which is true —
        // instead of telling the user their network is broken.
        if (res.statusCode === 404) { res.resume(); return finish({ tag: null, url: null }); }
        if (res.statusCode !== 200) { res.resume(); return finish(null); }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) { req.destroy(); finish(null); }
        });
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            finish(j && j.tag_name ? { tag: String(j.tag_name), url: j.html_url } : null);
          } catch (e) { finish(null); }
        });
      });
    } catch (e) { return finish(null); }
    req.setTimeout(CHECK_TIMEOUT_MS, () => { req.destroy(); finish(null); });
    req.on("error", () => finish(null));
  });
}

function announceUpdate() {
  if (!pendingUpdate) return;
  for (const w of BrowserWindow.getAllWindows()) {
    // The chart is an eye chart, not a UI that shows an update pill; a message
    // it can never render has no business landing in front of a patient.
    if (w.isDestroyed() || w === chartWin) continue;
    w.webContents.send("carino:update", pendingUpdate);
  }
}

// manual === true means the user picked "Check for updates now" and is owed an
// answer, including when the answer is "that didn't work". An automatic check
// is silent in every outcome except finding something: no retry, no dialog, no
// log line. A clinic on an air-gapped network must not accumulate an hourly
// "couldn't reach GitHub" in a log an operator is trying to read.
async function runCheck(manual) {
  updates.lastCheckMs = Date.now();
  saveUpdateState();

  const rel = await fetchLatestRelease();
  if (!rel) {
    if (manual) {
      dialog.showMessageBox(win || undefined, {
        type: "info", noLink: true,
        title: "Carino Retina",
        message: t("Could not check for updates"),
        detail: t("GitHub could not be reached. Nothing was changed; try again later."),
        buttons: [t("Close")],
      });
    }
    return;
  }

  const current = app.getVersion();
  if (!isNewer(rel.tag, current)) {
    // Also clears a stale note: a user who has just installed the newer build
    // should stop being told about it.
    pendingUpdate = null;
    updates.lastSeenVersion = null;
    saveUpdateState();
    if (manual) {
      dialog.showMessageBox(win || undefined, {
        type: "info", noLink: true,
        title: "Carino Retina",
        message: t("No update available"),
        detail: t("You are running the newest version, {version}.", { version: current }),
        buttons: [t("Close")],
      });
    }
    return;
  }

  pendingUpdate = { version: normalise(rel.tag), url: releaseUrlFor(rel.tag, rel.url) };
  updates.lastSeenVersion = pendingUpdate.version;
  saveUpdateState();
  announceUpdate();

  if (manual) {
    const r = await dialog.showMessageBox(win || undefined, {
      type: "info", noLink: true,
      title: "Carino Retina",
      message: t("An update is available"),
      detail: t("Version {version} has been released. You are running {current}.", { version: pendingUpdate.version, current }),
      buttons: [t("Open release page"), t("Close")],
      defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) openExternally(pendingUpdate.url);
  }
}

function maybeCheck() {
  if (updates.enabled !== true) return;
  if (Date.now() - updates.lastCheckMs < DAY_MS) return;
  runCheck(false);
}

function setUpdatesEnabled(on) {
  updates.enabled = !!on;
  saveUpdateState();
  if (updates.enabled) setTimeout(maybeCheck, 1500);
}

// Asked once, in one sentence, with two buttons. Dismissing the dialog lands on
// cancelId, which is "Don't check" — so the default for anyone who never
// answers stays OFF.
async function ensureUpdateOptIn() {
  if (updates.enabled !== null) return;
  const r = await dialog.showMessageBox(win || undefined, {
    type: "question", noLink: true,
    title: "Carino Retina",
    message: t("Should Carino Retina check GitHub for new versions once a day?"),
    detail: t("Nothing is sent, downloaded or installed — it only reads the number of the latest release."),
    buttons: [t("Check for updates"), t("Don't check")],
    defaultId: 0, cancelId: 1,
  });
  setUpdatesEnabled(r.response === 0);
}

// ---- navigation safety -------------------------------------------------
// Every link that leaves the app goes to the user's real browser, and nothing
// navigates either window away from what it is showing.
function openExternally(target) {
  let u;
  try { u = new URL(target); } catch (e) { return; }
  // http(s) only. shell.openExternal will happily hand file:, smb: or a Windows
  // protocol handler to the OS, and none of those belong at the end of a link
  // that came out of a rendered page.
  if (u.protocol !== "https:" && u.protocol !== "http:") return;
  shell.openExternal(u.toString());
}

function isInApp(target) {
  // The chart window's own URL is about:blank — it is opened empty and filled
  // with document.write — so treating that as foreign would make every guard
  // below fight the feature they exist to protect.
  if (target === "about:blank" || target === "") return true;
  try {
    const u = new URL(target);
    return u.protocol === SCHEME + ":" && u.host === HOST;
  } catch (e) { return false; }
}

// index.html:1620 preventDefaults drag/drop on #viewport ONLY. A JPEG dropped on
// the Exam panel, the header, a modal or the chart navigates that window to the
// file. In a browser tab that is a Back press away from being undone; in a
// packaged app it reads as a crash, and the unsaved encounter is gone with it.
function guardNavigation(wc) {
  wc.on("will-navigate", (e, url) => {
    if (isInApp(url)) return;
    e.preventDefault();
    openExternally(url);
  });
  // A server 3xx never fires will-navigate — only this. Without it a redirect
  // chain is the one navigation nothing inspects, so a URL that passed the
  // check above could still land the window somewhere off the bundle.
  wc.on("will-redirect", (e) => {
    if (isInApp(e.url)) return;
    e.preventDefault();
    openExternally(e.url);
  });
  wc.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !isInApp(e.url)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: "deny" }; });
}

// Two separate leaks and both have to be plugged:
//   - ctrl+wheel emits zoom-changed
//   - the accelerators call setZoomLevel directly and emit nothing at all, so
//     they are caught at the keystroke instead
// setVisualZoomLevelLimits governs pinch/visual zoom, which is a third thing.
// One Ctrl+= on the chart multiplies every optotype with no warning, and this
// app sizes letters in millimetres.
function pinZoom(wc) {
  wc.setZoomFactor(1);
  wc.setVisualZoomLevelLimits(1, 1);
  wc.on("zoom-changed", () => wc.setZoomFactor(1));
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    const k = String(input.key || "");
    if (k === "+" || k === "=" || k === "-" || k === "_" || k === "0") {
      e.preventDefault();
      wc.setZoomFactor(1);
    }
  });
  // A navigation — including the chart's document.write — resets both of these
  // on some platforms, so they are re-pinned every time a document lands.
  wc.on("did-finish-load", () => { wc.setZoomFactor(1); wc.setVisualZoomLevelLimits(1, 1); });
}

// ---- permissions -------------------------------------------------------
// Retina asks for exactly what the web platform gates. Electron's DEFAULT check
// handler denies anything it does not recognise, so without this block
// getScreenDetails() at index.html:2081 rejects into the catch at 2085 — one
// toast, and the whole "click a monitor to assign it" panel prints "—" forever.
const ALLOWED_PERMS = new Set([
  "media",                     // getUserMedia 2619 + enumerateDevices labels 2624
  "window-management",         // getScreenDetails 2081, Electron >= 26 spelling
  "window-placement",          // the pre-rename spelling, harmless to keep
  "fullscreen",                // presentEngine's F key, index.html:2437
  "clipboard-sanitized-write", // carinoDebug()'s clipboard.writeText, index.html:46
]);

// "media" is one permission name covering BOTH camera and microphone. The page
// asks for {video:…, audio:false} at index.html:2618 and filters the device list
// to 'videoinput' at 2624; build/entitlements.mac.plist grants the camera and
// nothing else. So a granted microphone is a capability this app never uses and
// the macOS build could not exercise anyway — but on Windows and Linux, where no
// OS layer asks a second time, it would be a live microphone in a consulting
// room. Denied here, in both handlers.
//
// Tested for the PRESENCE of audio rather than for the absence of video on
// purpose: some enumerateDevices-driven checks arrive with no media type at all,
// and requiring video would deny those and take the camera down with them.
function wantsAudio(details) {
  if (!details) return false;
  if (details.mediaType === "audio") return true;
  const types = details.mediaTypes;
  return Array.isArray(types) && types.indexOf("audio") >= 0;
}

// Identity, asked of a WebContents. The chart is the one window this shell opens
// that is not served from app://carino, so every widening below hangs off this
// answer rather than off a string an injected frame could also produce.
function isChartContents(wc) {
  return !!wc && !!chartWin && !chartWin.isDestroyed() && wc === chartWin.webContents;
}

// The check handler's third argument is NOT reliably a bare origin. Measured on
// Electron 31.7.7 (Linux/X11), one session hands all three of these to the same
// two windows: "app://carino/index.html" (the frame's full URL, on the
// enumerateDevices label checks), "app://carino/" (the origin, with a trailing
// slash, on window-management and the getUserMedia checks) and "about:blank"
// (the chart's committed URL). An exact string match against "app://carino"
// matches none of them, so it must be parsed down to scheme + host — which is
// also what keeps app://carinoevil out, since a prefix test with no separator
// would let that through. Returns "" for anything unparseable, which then falls
// through to the chart clause rather than matching the app.
function originHost(s) {
  if (typeof s !== "string" || s === "") return "";
  try { const u = new URL(s); return u.protocol + "//" + u.host; } catch (e) { return ""; }
}

function permissionOriginOk(wc, origin, details) {
  if (originHost(origin) === SCHEME + "://" + HOST) return true;
  // The chart is an about:blank inheriting app://carino; Chromium reports it as
  // "about:blank" here, and as "" or "null" on other code paths and platforms.
  // Tied to the one WebContents this shell opened, NOT to the string: an
  // about:blank iframe injected into the panel reports the very same origin.
  //
  // isMainFrame matters as much as the identity does. A WebContents is shared by
  // every frame in its window, so isChartContents() is true for an iframe inside
  // the chart as well as for the chart itself — and a sandboxed iframe reports
  // "about:blank", "null" or "about:srcdoc" too. Without this the widening hands
  // the camera to exactly the frame a sandbox attribute exists to deny.
  if (!details || details.isMainFrame !== true) return false;
  return (origin === "about:blank" || origin === "" || origin === "null") && isChartContents(wc);
}

function installPermissionHandlers(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!ALLOWED_PERMS.has(permission)) return callback(false);
    // Fail CLOSED on media. wantsAudio() answers "is audio named here", which is
    // the right question for the check handler but the wrong default for a grant:
    // if mediaTypes were ever absent it would answer false and hand over a
    // microphone. Measured as always populated on Electron 31.7.7 (["audio"],
    // ["audio","video"], ["video"]), so the log line below should never fire —
    // and if a future Electron drops the field, a dead camera with a reason in
    // the console beats a live microphone in a consulting room.
    if (permission === "media") {
      const types = details && details.mediaTypes;
      if (!Array.isArray(types)) {
        console.warn("[carino] media permission denied: no mediaTypes on the request");
        return callback(false);
      }
      if (types.indexOf("audio") >= 0) return callback(false);
    }
    const url = (details && details.requestingUrl) ||
                (wc && !wc.isDestroyed() && wc.getURL()) || "";
    // Same scheme+host comparison as the check handler, for the same reason: the
    // value arriving here is a full URL ("app://carino/index.html"), and it must
    // not be compared against a prefix that app://carinoevil would also satisfy.
    callback(originHost(url) === SCHEME + "://" + HOST ||
             (details && details.isMainFrame === true && isChartContents(wc)));
  });
  // This second handler is the one people forget. getUserMedia succeeds without
  // it, but enumerateDevices() at index.html:2624 then returns blank labels and
  // line 2626 substitutes "Camera 1"/"Camera 2" — the clinician can no longer
  // tell the webcam from the fundus camera, and nothing reports why.
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (!ALLOWED_PERMS.has(permission)) return false;
    if (permission === "media" && wantsAudio(details)) return false;
    return permissionOriginOk(wc, requestingOrigin, details);
  });
}

// The same identity question asked of an IPC sender: is this one of the two
// WebContents this shell created — the panel, served from app://carino, or the
// chart, whose URL is about:blank and which is therefore recognised by identity.
// Used by the one channel that can reach outside the app.
function fromApp(e) {
  const wc = e && e.sender;
  if (!wc || wc.isDestroyed()) return false;
  if (isChartContents(wc)) return true;
  let u = "";
  try { u = wc.getURL() || ""; } catch (err) { return false; }
  return originHost(u) === SCHEME + "://" + HOST;
}

// ---- the chart window's bounds -----------------------------------------
// index.html:2264/2265 builds:
//   "popup,left=<availLeft>,top=<availTop>,width=<availWidth>,height=<availHeight>,
//    menubar=no,toolbar=no,location=no,status=no"
// Parsed here rather than trusting Electron's WebWindowFeatures mapping, because
// the coordinates are wanted only to CHOOSE a display.
function parseFeatures(features) {
  const out = {};
  String(features || "").split(",").forEach((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) return;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const num = Number(pair.slice(eq + 1).trim());
    if (!Number.isFinite(num)) return;
    if (key === "left" || key === "screenx") out.x = Math.round(num);
    else if (key === "top" || key === "screeny") out.y = Math.round(num);
    else if (key === "width" || key === "innerwidth") out.width = Math.round(num);
    else if (key === "height" || key === "innerheight") out.height = Math.round(num);
  });
  return out;
}

// The parsed numbers pick a display and are then thrown away; the bounds handed
// back are that display's own DIP work area. ScreenDetail.availLeft is CSS px in
// the requesting window's scale and BrowserWindow bounds are DIP, so on Windows
// with mixed per-monitor DPI the two disagree and a chart placed from the parsed
// values lands part way off screen. The page always asks for the whole
// availWidth x availHeight of the screen it picked (screenBox(), index.html:2103),
// so filling that display's work area is exactly what it wanted — and it is
// immune to the coordinate-system mismatch.
function boundsForChart(features) {
  const f = parseFeatures(features);
  const probe = {
    x: f.x != null ? f.x : 0, y: f.y != null ? f.y : 0,
    width: f.width || 1280, height: f.height || 920,
  };
  const d = (f.x != null && f.y != null)
    ? screen.getDisplayMatching(probe)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height };
}

// ---- displays ----------------------------------------------------------
// display.id is not stable across a reboot or a cable swap on every platform, so
// the key that per-display CALIBRATION hangs off is a fingerprint, not the id.
// `label` is the monitor's own name where the OS knows it (macOS, Windows); on
// X11 it is frequently empty, and there the geometry plus ordinal is the best
// available — which means a clinician with two identical panels who swaps the
// cables inherits the other one's calibration. The Settings list must say which
// display a stored value came from and offer a reset. Do not pretend otherwise.
function displayKey(d, i) {
  const geo = d.size.width + "x" + d.size.height + "@" + d.scaleFactor;
  const label = String(d.label || "").trim();
  return label ? "l:" + label + "|" + geo : "g:" + geo + "|" + i;
}

function displayFor(bw) {
  try { return screen.getDisplayMatching(bw.getBounds()); }
  catch (e) { return screen.getPrimaryDisplay(); }
}

function screensPayload() {
  const all = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const panel = (win && !win.isDestroyed()) ? displayFor(win) : screen.getPrimaryDisplay();
  const chartOpen = !!(chartWin && !chartWin.isDestroyed());
  const chart = chartOpen ? displayFor(chartWin) : panel;
  const idx = (d) => all.findIndex((x) => x.id === d.id);

  // The self-check no page can run for itself. cssWidth should equal the
  // display's DIP workArea width at zoom 1; dpr should equal scaleFactor. A
  // mismatch on the first means zoom is not 1 (the pin failed, or a platform
  // reset it); on the second it means fractional scaling is in play, where
  // Chromium's devicePixelRatio and the OS scale disagree — and the
  // scale-ratio calibration transfer is then wrong by exactly that discrepancy.
  let zoomOk = null, dprOk = null;
  if (chartOpen && chartMetrics) {
    zoomOk = Math.abs(chartMetrics.cssWidth - chart.workArea.width) <= 2;
    dprOk = Math.abs(chartMetrics.dpr - chart.scaleFactor) < 0.01;
  }

  return {
    chartOpen,
    panelKey: displayKey(panel, idx(panel)), panelScale: panel.scaleFactor,
    chartKey: chartOpen ? displayKey(chart, idx(chart)) : null,
    chartScale: chartOpen ? chart.scaleFactor : null,
    chartFullscreen: chartOpen ? chartWin.isFullScreen() : false,
    metrics: chartMetrics ? Object.assign({ zoomOk, dprOk }, chartMetrics) : null,
    displays: all.map((d, i) => ({
      id: d.id, key: displayKey(d, i), index: i, label: d.label || "",
      scaleFactor: d.scaleFactor, isPrimary: d.id === primaryId,
      bounds: Object.assign({}, d.bounds), workArea: Object.assign({}, d.workArea),
    })),
  };
}

function broadcastScreens() {
  const msg = screensPayload();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try { w.webContents.send("carino:screens", msg); } catch (e) { /* going away */ }
  }
}

// ---- window ------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 880, minWidth: 900, minHeight: 600, show: false,
    title: "Carino Retina", icon: path.join(ASSETS, "icon.png"),
    backgroundColor: "#050505",   // index.html's own body background — no white flash
    webPreferences: {
      // Stated rather than left to the defaults, because preload.js is the
      // entire attack surface between the page and this machine and the three
      // switches that decide how wide it is should be readable in one place.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,                // index.html:2598-2599 previews the Study PDF in a
                                    // blob: iframe with #toolbar=1. plugins defaults to
                                    // false, which disables Chromium's PDF viewer: the
                                    // Export dialog then shows an empty grey box and the
                                    // catch at 2600 never fires, because nothing throws.
      backgroundThrottling: false,  // the 1200 ms remote poll at index.html:2517 must keep
                                    // running while the chart is fullscreen in front of it
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: ["--carino-app-version=" + app.getVersion()],
    },
  });

  win.once("ready-to-show", () => win.show());

  pinZoom(win.webContents);
  // guardNavigation FIRST, then the chart-aware open handler: setWindowOpenHandler
  // replaces rather than chains, and guardNavigation installs a deny-everything
  // one. Reverse these two lines and the Tests feature stops opening a chart.
  guardNavigation(win.webContents);

  win.webContents.setWindowOpenHandler((d) => {
    // BOTH halves of the discriminator, because an allowed window is then
    // NAVIGATED by Electron to d.url. The frame name alone lets
    // window.open('https://…', 'carinoRetinaTest') load remote content in this
    // session with this app's preload attached and --carino-chart-window set;
    // did-create-window would adopt it as chartWin, and it could then forge
    // carino:chart-metrics past the sender check below — defeating the
    // zoomOk/dprOk cross-check that exists precisely so a wrongly sized chart
    // cannot read as verified. index.html:2266 opens with window.open('', …),
    // so the URL is always empty; Electron normalises that to about:blank on
    // some paths and leaves it empty on others, hence both. Anything else
    // carrying this frame name falls through to the browser, where it belongs.
    if (d.frameName === CHART_FRAME && (d.url === "about:blank" || d.url === "")) {
      const b = boundsForChart(d.features);
      return {
        action: "allow",
        outlivesOpener: false,   // reloading or closing the panel takes the chart with it
        overrideBrowserWindowOptions: {
          x: b.x, y: b.y, width: b.width, height: b.height,
          title: "Carino Retina",
          backgroundColor: "#ffffff",   // presentEngine sets body background #fff at 2322
          autoHideMenuBar: true,        // the features string says menubar=no; Electron ignores that
          fullscreenable: true, resizable: true, movable: true,
          show: true,   // NEVER show:false — nothing fires ready-to-show on a
                        // window populated by document.write, so the chart would
                        // stay invisible with the exam already under way
          webPreferences: {
            contextIsolation: true, nodeIntegration: false, sandbox: true,
            plugins: false,               // no PDF here; only the panel needs the viewer
            backgroundThrottling: false,  // this is by definition the unfocused window
            spellcheck: false,
            // overrideBrowserWindowOptions.webPreferences is MERGED OVER the
            // inherited parent preferences, so preload:undefined does not remove
            // the preload — there is no supported way to ask for none. It runs
            // here too, which is what lets it report the chart's own metrics.
            preload: path.join(__dirname, "preload.js"),
            additionalArguments: [
              "--carino-app-version=" + app.getVersion(),
              "--carino-chart-window",
            ],
          },
        },
      };
    }
    openExternally(d.url);   // every other target=_blank is somewhere on the web
    return { action: "deny" };
  });

  win.webContents.on("did-create-window", (child, details) => {
    if (details.frameName !== CHART_FRAME) return;
    chartWin = child;
    chartMetrics = null;
    child.setMenuBarVisibility(false);
    pinZoom(child.webContents);
    guardNavigation(child.webContents);
    // Which display the chart is on is the input to the page's calibration, so
    // every way the window can change display has to push a fresh payload.
    const push = () => broadcastScreens();
    child.on("moved", push);
    child.on("resize", push);
    child.on("enter-full-screen", push);
    child.on("leave-full-screen", push);
    // Guarded on identity. 'closed' is asynchronous relative to the renderer's
    // presentWin.close(), so a close-then-reopen can deliver the OLD window's
    // event after did-create-window has already pointed chartWin at the NEW
    // one. Nulling unconditionally there would blank the live chart's display
    // key and its zoom/dpr verification for the rest of the session, with a
    // chart visibly on screen — the panel would stop being able to say whether
    // the optotypes are the size it thinks they are.
    child.on("closed", () => {
      if (chartWin !== child) return;
      chartWin = null;
      chartMetrics = null;
      broadcastScreens();
    });
    push();
  });

  win.on("closed", () => {
    win = null;
    // outlivesOpener:false already does this, but be explicit: without it the app
    // can survive its own panel with only a chart on a second monitor,
    // window-all-closed never fires, and 'activate' makes a SECOND panel.
    if (chartWin && !chartWin.isDestroyed()) chartWin.close();
  });

  win.loadURL(START_URL);
}

// ---- menu --------------------------------------------------------------
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      // Not { role: "fileMenu" }: there is no Open here — the page's own picker
      // and drag-drop are the way in — but every export lands in the downloads
      // folder with no dialog (see will-download), so the one thing this menu
      // owes the user is a way to get there.
      label: t("File"),
      submenu: [
        {
          label: t("Show downloads folder"),
          click: () => shell.openPath(lastDownloadDir || app.getPath("downloads")),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      // A hand-built View menu, NOT { role: "viewMenu" }: that role ships Zoom In,
      // Zoom Out and Actual Size, and a zoomed chart is a silently wrong acuity.
      // toggleDevTools stays — index.html:50 tells the user to open the console
      // and run carinoDebug(), and F12 does nothing in a packaged app without it.
      label: t("View"),
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: t("Check for updates now"), click: () => runCheck(true) },
        {
          label: t("Check for updates automatically"), type: "checkbox",
          checked: updates.enabled === true,
          click: (item) => setUpdatesEnabled(item.checked),
        },
        { type: "separator" },
        { label: t("Carino Retina on GitHub"), click: () => openExternally(REPO_URL) },
        { label: t("Licence (MPL-2.0)"), click: () => openExternally(LICENCE_URL) },
        {
          label: t("Third-party notices"),
          click: () => openExternally(REPO_URL + "/blob/main/vendor/README.md"),
        },
      ],
    },
  ]);
}

// ---- lifecycle ---------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    // app.getLocale() is only reliable once ready, and everything that draws
    // shell text (the menu, the opt-in question) runs after this point.
    initI18n(app);
    loadUpdateState();

    protocol.handle(SCHEME, serveFromBundle);

    installPermissionHandlers(session.defaultSession);

    if (process.platform === "darwin") {
      // Under a hardened runtime the first getUserMedia returns no device rather
      // than prompting, unless the app has asked TCC itself. Fire and forget: a
      // refusal here is the same as a refusal at the prompt, and the page
      // already handles a camera it cannot open.
      systemPreferences.askForMediaAccess("camera").catch(() => {});
    }

    // Every export in index.html funnels through download(name, blob) at line
    // 1701, which revokes the object URL 1000 ms after the click. A Study PDF
    // carries two full-resolution fundus PNGs (renderEyePngBytes 1765 ->
    // P.image 1850) and is routinely multi-MB; if a save dialog sits open
    // longer than that second, the blob is gone and nothing is written — while
    // toast('Study PDF exported') at 1995 has already told the clinician it
    // was. Taking the save path here, in the handler, synchronously, removes
    // the race: there is no dialog between the click and the read.
    session.defaultSession.on("will-download", (event, item) => {
      const dir = app.getPath("downloads");
      // basename because this save is silent and unattended by design: the name
      // comes from the renderer's a.download and goes straight into path.join.
      // Chromium's own GenerateFileName strips separators before we ever see it,
      // but nothing in this repo pins that, and one call removes the dependency.
      let base = path.basename(String(item.getFilename() || ""));
      if (base === "" || base === "." || base === "..") base = "carino-retina-export";
      const ext = path.extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      let target = path.join(dir, base);
      for (let n = 2; fs.existsSync(target) && n < 1000; n++) {
        target = path.join(dir, stem + " (" + n + ")" + ext);
      }
      item.setSavePath(target);
      item.once("done", (e, state) => { if (state === "completed") lastDownloadDir = dir; });
    });

    // The page asks for the update at boot and is told again if one turns up
    // later; openReleasePage takes no argument, so the URL opened is always the
    // one validated above and never one the renderer chose.
    ipcMain.handle("carino:update", () => pendingUpdate);
    // The one channel here that reaches outside the app — shell.openExternal —
    // so it is the one that says who may ring it. The read-only channels below
    // are deliberately left open: they answer with the app's own version number
    // and the display list, both of which every window in this session is
    // entitled to, and a sender check there would buy nothing while making the
    // preload's synchronous seed fail in ways that are hard to see.
    ipcMain.on("carino:open-release", (e) => {
      if (!fromApp(e)) return;
      if (pendingUpdate) openExternally(pendingUpdate.url);
    });
    // Only reached if additionalArguments did not survive into the sandboxed
    // preload's process.argv; see the note there. Synchronous because the page
    // reads carinoDesktop.appVersion as a plain string during boot.
    ipcMain.on("carino:app-version", (e) => { e.returnValue = app.getVersion(); });

    ipcMain.handle("carino:screens", () => screensPayload());
    // The synchronous seed the preload asks for, so the panel's first render has
    // a display list without waiting for a round trip. It is registered here,
    // with the rest, because screensPayload() touches `screen`, which throws
    // before whenReady — a preload that runs earlier gets that throw caught on
    // its side and falls back to the async invoke, which is the intended
    // behaviour rather than a race to lose.
    ipcMain.on("carino:screens-sync", (e) => { e.returnValue = screensPayload(); });
    ipcMain.on("carino:chart-metrics", (e, m) => {
      // Only the chart window may report the chart's metrics. Without this the
      // panel — or any frame in it — could claim a css width that makes a wrong
      // chart look verified, which is the opposite of what the check is for.
      if (!chartWin || chartWin.isDestroyed()) return;
      if (e.sender !== chartWin.webContents) return;
      if (!m || typeof m.cssWidth !== "number") return;
      chartMetrics = { cssWidth: m.cssWidth, cssHeight: m.cssHeight, dpr: m.dpr };
      broadcastScreens();
    });

    Menu.setApplicationMenu(buildAppMenu());
    createWindow();

    screen.on("display-added", broadcastScreens);
    screen.on("display-removed", broadcastScreens);
    // Fires on an OS scale change, which the page's own 'screenschange' does not
    // — and a scale change is precisely what invalidates a stored calibration.
    screen.on("display-metrics-changed", broadcastScreens);
    win.on("moved", broadcastScreens);

    setTimeout(() => {
      ensureUpdateOptIn().then(() => {
        Menu.setApplicationMenu(buildAppMenu());   // the checkbox now has an answer to show
        setTimeout(maybeCheck, FIRST_CHECK_DELAY_MS);
        setInterval(maybeCheck, CHECK_TICK_MS);
      });
    }, OPT_IN_DELAY_MS);
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => { if (!win) createWindow(); else win.show(); });
}
