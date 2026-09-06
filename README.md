# Carino Retina

A client-side **eye examination, refraction & dispensing suite**. Annotate a fundus
image for an automatic **cup-to-disc ratio**, run a full **refraction**, and work up a
**spectacle / contact-lens dispense** — then export the whole encounter. Everything runs
in the browser; **no image or data is ever uploaded**.

Part of [Carino Systems](https://carino.systems). Live at **retina.carino.systems**.

The suite is organised as an **encounter** with two workspaces in the top navbar —
**Imaging** and **Exam** (refraction + dispensing) — plus a **Tests** button that opens the
chart picker in a dialog. The fundus canvas only appears in Imaging; the Exam workspace
uses the full width in responsive columns, so the whole exam shows at a glance with little
scrolling.

Switch eyes fast with **Shift+1** (left / OS) and **Shift+2** (right / OD). The OD/OS eye switch is
always available at the top of the panel. Imaging is entirely optional — you can refract
and dispense without ever loading a photo.

## Imaging
- **Camera capture** — take a photo for the current eye from a webcam or a connected
  fundus / slit-lamp camera (pick the device in the camera dialog).
- **Floating tool overlay** — the annotation tools float over the fundus (out of the way),
  with a **1-eye / 2-eye** toggle. In 2-eye the active eye stays fully editable beside the
  other eye as reference; click the other pane to switch which eye you're editing. The
  measurement/annotation tools work in both modes.
- **Inline text** — the text tool lets you type a label directly on the image (double-click
  a label to edit it).
- **Structure marking** — optic disc center, fovea center, optic disc margin and optic
  cup margin (draggable, resizable ellipses).
- **Annotation tools** — arrow/pointer (with note), text label, and freehand outline for
  irregular lesions, alongside lesion pins and the ruler.
- **Auto metrics** — vertical & horizontal cup-to-disc ratio (colour-coded by glaucoma
  risk), disc diameter/area, disc–fovea distance and angle.
- **Calibration** — set the assumed vertical disc diameter (default 1.5 mm); every
  measurement is then reported in millimetres.
- **Lesion pins** — microaneurysm, hemorrhage, exudate, cotton-wool spot, drusen,
  neovascularization, laser scar, etc., each with a free-text note.
- **Measurement tool** — ruler in px or mm.
- Zoom / pan, keyboard tool shortcuts, drag-and-drop image loading, and a built-in
  synthetic sample fundus.

## Refraction (per eye)
- Visual acuity — distance uncorrected / corrected, and near.
- Autorefraction / retinoscopy and the **subjective final Rx** (sphere / cyl / axis / add).
- Keratometry (K1 / K2 / axis), IOP, pachymetry, lens status, diagnosis and notes.

Every numeric field is a **stepper**: **hover it and scroll** — no click, no selecting the
text first — or drag up/down, or use the ↑/↓ arrow keys (hold **Shift** for a coarse ×4
step). Powers snap to 0.25 D with a signed format, axes step 1° and wrap 1–180.
**Visual acuity** steps its own ladder instead (20/20 → 20/25 → … → CF / HM / LP / NLP, or
the 6/6 metric ladder if that is how the value is written; near steps J1 → J16), and every
field still accepts free text.

**Dropdowns** (lens status, base direction, lens type, material) and the calibration slider
follow the same rule.

A wheel gesture that starts on the page keeps scrolling the page even when a field passes
under the cursor, so a long form never rewrites a value by accident — only a scroll that
*begins* over a field edits it.

## Dispensing
- **Interpupillary distance** — binocular distance & near, plus monocular OD/OS.
- **PD from photo** *(optional, estimate only)* — load a face photo with an ID-1 card
  (85.6 mm) at the brow, measure the card then pupil-to-pupil, and it derives PD from the
  card's known width. A convenience aid, **not** a dispensing-grade measurement.
- **Prism** — amount (Δ) and base direction, per eye.
- **Lens** — type (SV / bifocal / progressive / …), material (CR-39 → hi-index 1.74),
  coatings and tint.
- **Frame** — boxing system A / B / DBL / ED, plus panto, vertex and wrap.
- **Fitting** — segment / OC heights per eye.
- **Lens layout / centration** — a live schematic of both lenses in the frame showing the
  optical-center / fitting cross per eye (from PD, frame A/B/DBL and heights), the frame
  midline and datum, and the horizontal decentration + fitting height — the centration
  chart opticians use before edging.
- **Contact lens** — brand, base curve, diameter, power per eye.

## Eye exam tests (Tests button)
The **Tests** button opens a dialog with all the charts; pick one and the dialog **becomes
the remote** for the presenting window (Back returns to the chart list):
- **Charts** — a classic **Snellen** pyramid (one big letter, then two, three…),
  single-line **LogMAR (Sloan)**, Tumbling E, Landolt C, Duochrome (red-green), astigmatic
  dial, Amsler grid, low-contrast letters, a colour-vision **screening demo** (clearly
  non-diagnostic), a fixation target and blank white/black fields.
- **Snellen full / per-row** — show the whole chart or one row at a time, stepping through
  rows (the **Rows** remote button or `C`; `↑/↓` change the row).
- **Optotype order** — choose **Fixed chart** (canonical letters in their original order)
  or **Randomize** in Settings; the Shuffle button re-randomizes at any time to prevent
  memorization.
- **Remote control** — from the panel (or in the chart window with the keyboard): change
  letter size, shuffle optotypes, toggle order, step through tests, mirror, **move the
  window between monitors**, and read the live acuity (Snellen + logMAR).
- **Multi-monitor** — on Chromium the chart is placed on the chosen screen automatically
  via the Window Management API; the assigned monitor's geometry is **remembered**, so
  placement keeps working after a reload. On **Firefox and Safari/WebKit** it opens here
  and the **Screen ◂ ▸** buttons step it through the detected monitors (or drag it and
  press `F`).
- **True-size** — charts are drawn to physical size from the **test distance** and a
  one-time **card calibration** (match an 85.6 mm card on screen), so 20/20 really is
  20/20 at your lane length. Changing the distance, calibration, mirror or optotype order
  **rescales the presenting chart live** — halve the distance and the letters halve.

Open **Settings** (gear icon) to choose the display (same screen / second monitor / ask),
run monitor detection **and click a detected monitor to assign it as the chart screen**,
set the distance and units, calibrate true size, and enable mirror mode for mirrored exam
rooms. Second-monitor placement uses the browser's window-management
permission; without it the window opens on the current screen (drag it over and press **F**
for fullscreen).

## Export
One **Export** button opens a dialog with a **live PDF preview** of the study report and a
row of downloads:
- **Study PDF** — the full encounter: both eyes with embedded annotated images, disc
  metrics, refraction, and a binocular dispensing summary.
- **Study DICOM** — the same report wrapped as an Encapsulated PDF object (SOP class
  `1.2.840.10008.5.1.4.1.1.104.1`, Modality `DOC`) — one PACS-storable file for the whole
  study.
- **Spectacle Rx** — a signable prescription (OD/OS sph/cyl/axis/add/prism + PD).
- **Lens order** — a lab order (Rx + lens spec + PD + frame/fitting).
- Annotated PNG, re-openable study JSON, and a printable report.

## Languages
The interface (page names and clinical concepts) is available in **English**, **Spanish**
and **Japanese** — pick a language from the header (EN / ES / 日本語); the choice is
remembered. The underlying data model and exported documents stay in canonical English so
records are portable across languages.

## Keyboard
`V` select · `H` pan · `1` disc center · `2` fovea · `3` disc · `4` cup ·
`5` lesion · `6` measure · `Space` pan (hold) · `F` fit · `Del` delete selected.

## Notes
This is a documentation / annotation aid, **not a diagnostic device**. Exported
prescriptions and orders must be verified and (where required) signed before use.

## Desktop application

The same page, in a window. [`desktop/`](desktop/) wraps this repository's
`index.html` in Electron and serves it from an internal `app://` origin, so the
whole suite — the fundus canvas, the charts, pdf-lib, the fonts — sits inside the
bundle and the app never asks the network for any part of itself. Images and
examination data still never leave the machine, and now neither does the page.

Builds come from the **Releases** page of
[MiguelCarino/Retina](https://github.com/MiguelCarino/Retina/releases), produced by
[`.github/workflows/desktop-build.yml`](.github/workflows/desktop-build.yml) — one
runner per operating system, because electron-builder cannot cross-compile.

| Platform | Files | Notes |
| --- | --- | --- |
| macOS | `.dmg`, `.zip` | x64 and arm64 separately; unsigned (below) |
| Windows | `.exe` installer | one installer, both architectures |
| Linux | `.AppImage`, `.deb`, `.rpm` | x86_64 and arm64 |

Running it from source:

```bash
cd desktop
npm install
npm start
```

Building an installer for the machine you are on:

```bash
cd desktop
npm install
npm run dist        # writes desktop/dist/
```

> **Fedora / RHEL.** `sudo dnf install rpm-build dpkg fakeroot fuse-libs` — without
> `rpm-build` the `.rpm` target fails and the other two still succeed, which reads
> like a partial success and is not.
> **Debian / Ubuntu.** `sudo apt install rpm fakeroot libfuse2`.

### The chart window
`Tests` opens a second window and writes the eye chart into it. In the desktop
build that is a second application window rather than a browser popup, which
changes three things for the better and one for the worse.

Better: it can never be blocked; the shell places it on the display you assigned in
**Settings ▸ Screens** using that display's own coordinates rather than the page's,
so it lands on the whole screen and not straddling two; and its zoom is pinned, so
Ctrl+= cannot silently rescale an optotype.

Worse: **on Wayland**, window placement is not something a client is allowed to do.
The app forces itself onto XWayland so the assignment works; the cost is slightly
softer text on fractionally scaled displays. If you would rather have the sharper
text than the placement, launch with `ELECTRON_OZONE_PLATFORM_HINT=wayland`.

### True size on a second monitor
A CSS pixel is not a fixed physical size, and it is not the same size on two
displays that run at different operating-system scale factors. The browser build
has one calibration and applies it everywhere, which is wrong by the ratio between
the two displays whenever they differ.

The desktop build knows each display's scale factor, so:

- Calibrate against the 85.6 mm card in **Settings** as before. The value is now
  stored **against the display you measured it on**.
- When the chart lands on a display that has never been calibrated, the value is
  carried across and corrected for the difference in scale. That assumes the two
  panels have the same physical pixel pitch — the only thing that *can* be assumed,
  since no operating system reports a panel's size in millimetres — so the chart
  prints **`calibration estimated for this screen`** in its own corner until
  somebody measures.
- **Settings ▸ Calibrate on chart screen** draws the card on the chart display
  itself and stores the result for that display. That is the only physically exact
  answer, and it is only possible here.

A display is remembered by its name plus its resolution and scale. Two identical
monitors are indistinguishable, so swapping their cables swaps their calibrations;
the Settings list names what it stored and lets you clear it.

### Camera capture
The camera modal works the same as in a browser. On macOS the packaged app asks for
camera access the first time it runs; if you refuse, the modal opens and reports
that no camera is available, and you can grant it later in
**System Settings ▸ Privacy & Security ▸ Camera**.

### The builds are unsigned
Nobody has paid a certificate authority to be identified as the publisher. That is
what the warnings mean — not that the binary was inspected and found suspect.

- **macOS** says *"Carino-Retina" is damaged and can't be opened*. It is not.
  `xattr -dr com.apple.quarantine /Applications/Carino-Retina.app`
- **Windows** shows a SmartScreen page. **More info → Run anyway**.
- **Linux** needs the AppImage made executable: `chmod +x Carino-Retina-*.AppImage`.

If certificates are ever configured, the workflow picks them up with **no code
change** — see the secrets table in the workflow file.

### The update notice is opt-in
- It is **off** unless you say yes to the question asked once on first launch.
  Dismissing that dialog counts as no.
- When on, it reads the version number of the latest GitHub release at most once a
  day. Nothing is sent, nothing is downloaded, nothing is installed.
- A check that fails is forgotten silently. Only **Help ▸ Check for updates now**
  reports a failure, because a clinic on an air-gapped network should not
  accumulate an hourly "couldn't reach GitHub" in a log someone is trying to read.
- Turn it off again in **Help ▸ Check for updates automatically**.

### Where your data lives
Examinations, settings, screen assignments and calibrations live in the browser
storage of the `app://carino` origin, inside the application's own data folder:

| | |
| --- | --- |
| Linux | `~/.config/Carino Retina/` |
| macOS | `~/Library/Application Support/Carino-Retina/` |
| Windows | `%APPDATA%\Carino Retina\` |

The macOS folder is hyphenated and the other two are not: on macOS the name comes
from the application bundle, which is `Carino-Retina.app`.

They are per-machine and per-package-format: moving between the AppImage, the
`.deb` and the `.rpm` gives you a different folder and therefore an empty
encounter. Export a study before you switch.

### The icon
The desktop icon is the Carino fleet ring with a pupil in the middle, drawn by
[`desktop/assets/make_icon.py`](desktop/assets/make_icon.py). The site's favicon,
`logo.webp`, is an older hand-drawn eye and shares nothing with it. They are two
different files on purpose: what `retina.carino.systems` serves is a separate
decision from what an application ships as its icon, and replacing the favicon has
not been decided.

### Known limits
- Notes attached to arrows and freehand outlines are not captured in the desktop
  build. The browser build asks for them with `window.prompt`, which Electron does
  not implement; the mark is still created, it just carries no note. Use a text
  label instead until this is replaced with an inline editor.
- A study is held in browser storage, which is capped at about 5 MB. Two
  full-resolution camera captures can exceed it, after which the encounter stops
  persisting. Export before you close.
- Nothing in [DICOM-INTEGRATION.md](DICOM-INTEGRATION.md) is implemented in any
  build; it is a design document.

## Licensing

**Mine — Mozilla Public License 2.0.** Everything in this repository *except*
the paths listed below. Copyright © 2026 Miguel Carino. Full terms in
[LICENSE](LICENSE).

**Not mine.** The files below are third-party works redistributed here. This
project's licence does not cover them and could not: they are not mine to
relicense. Each keeps its own terms, and each carries its own notice.

| Path | What it is | Licence | Notice |
| --- | --- | --- | --- |
| [`fonts/`](fonts/) | IBM Plex Mono, IBM Plex Sans, Red Hat Display, Red Hat Text | SIL OFL 1.1 | [`fonts/OFL.txt`](fonts/OFL.txt) |
| [`vendor/`](vendor/) | third-party JavaScript | per package — see the notice | [`vendor/README.md`](vendor/README.md) |

Those files travel with any fork, mirror or repackaging of this repository, and
their notices must travel with them.

**The desktop build.** An installer from the Releases page is distribution in
Executable Form under MPL-2.0 §3.2: the Source Code Form is this repository, and
**Help ▸ Carino Retina on GitHub** and **Help ▸ Licence (MPL-2.0)** point there
from inside the app. The build additionally bundles Electron — MIT, but carrying
Chromium (BSD-3-Clause plus several hundred third-party notices), Node (MIT) and,
in the default prebuilt binary, an LGPL-2.1 ffmpeg. electron-builder copies
Electron's own `LICENSE` and `LICENSES.chromium.html` into the packaged app, so
those notices ship with it. The `fonts/` and `vendor/` notices above travel too:
both directories are copied into the bundle whole.

**Why MPL and not AGPL.** MPL is *file-level* copyleft: modifications to existing
source files must be shared under the MPL, but the tool may be combined with, or
integrated into, proprietary software. MPL-2.0 also carries an explicit patent
grant. Each source file should carry the standard header:

```
This Source Code Form is subject to the terms of the Mozilla Public License, v.
2.0. If a copy of the MPL was not distributed with this file, You can obtain one
at http://mozilla.org/MPL/2.0/.
```
