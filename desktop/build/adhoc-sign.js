/* electron-builder afterPack hook.
 *
 * Ad-hoc signs the macOS app when there is no real signing identity.
 *
 * Without a "Developer ID Application" certificate electron-builder skips
 * signing altogether, but by then it has already renamed the Electron binary
 * and rewritten Info.plist — so the signature Electron shipped with no longer
 * matches the bundle. On Apple Silicon that app does not run, and clearing the
 * quarantine attribute does not change it: macOS either calls it "damaged" or
 * kills it at launch. An ad-hoc signature ("-") makes the bundle internally
 * consistent again. It identifies nobody, so the first launch still needs Open
 * Anyway or the xattr command in README.md, but after that the app runs.
 *
 * With CSC_LINK / CSC_NAME set this does nothing: electron-builder signs with
 * the real identity right after this hook, over the top of anything done here.
 */
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
  console.log(`[adhoc-sign] ${path.basename(app)} ad-hoc signed and verified`);
};
