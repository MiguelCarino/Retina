# Carino Retina

A client-side **eye examination, refraction & dispensing suite**. Annotate a fundus
image for an automatic **cup-to-disc ratio**, run a full **refraction**, and work up a
**spectacle / contact-lens dispense** — then export the whole encounter. Everything runs
in the browser; **no image or data is ever uploaded**.

Part of [Carino Systems](https://carino.systems). Live at **ophtha.carino.systems**.

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

Power, axis, keratometry, prism, PD, frame and contact-lens fields are **steppers** —
adjust the value by scrolling over it, dragging up/down, or using the ↑/↓ arrow keys
(hold **Shift** for a coarse ×4 step). Powers snap to 0.25 D with a signed format, axes
step 1° and wrap 1–180.

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
  via the Window Management API; on **Firefox and Safari/WebKit** it opens here and the
  **Screen ◂ ▸** buttons (or a manual drag + `F`) move it to the patient monitor.
- **True-size** — charts are drawn to physical size from the **test distance** and a
  one-time **card calibration** (match an 85.6 mm card on screen), so 20/20 really is
  20/20 at your lane length.

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
