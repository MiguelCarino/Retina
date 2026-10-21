# Carino Retina

A client-side **eye examination, refraction & dispensing suite**. Annotate a fundus
image for an automatic **cup-to-disc ratio**, run a full **refraction**, and work up a
**spectacle / contact-lens dispense** — then export the whole encounter. Everything runs
in the browser; **no image or data is uploaded** to Carino or anyone else — the only
network path is the clinic's own PACS, if you set one up and press **Send to archive**.

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
- **Auto metrics** — vertical & horizontal cup-to-disc ratio, disc diameter (vertical ×
  horizontal) and area, disc–fovea distance and angle. The angle is the tilt of the
  disc–fovea line from the horizontal, the same for both eyes, positive when the fovea
  lies below the disc centre (Jonas 2015 convention; normal mean about +8°). Ratios and
  millimetres are rounded to two decimals everywhere (screen, JSON, PDFs). A cup drawn
  larger than, or outside, the disc is shown in amber and withheld from every document.
  Measurements only: no value is graded or flagged.
- **Calibration** — set the assumed vertical disc diameter (default 1.5 mm; population
  means are nearer 1.9 mm); every measurement is then reported in millimetres, and every
  report states the assumed diameter the millimetres rest on. The formulas live in
  `retina-clinical.js` and are covered by `tools/unit-tests.js`.
- **Lesion pins** — microaneurysm, hemorrhage, exudate, cotton-wool spot, drusen,
  neovascularization, laser scar, etc., each with a free-text note.
- **Measurement tool** — ruler in px or mm.
- Zoom / pan, keyboard tool shortcuts, drag-and-drop image loading (JPEG, PNG, BMP and
  TIFF), and a built-in synthetic sample fundus.
- **More than one picture per eye** — each eye has one active picture (the marks, disc
  size, measurements and the report are about it). A picture loaded, captured or filed
  for an eye that already has its own goes into **Other images for OD/OS** below *Image
  & data*, with its own marks; **Use this image** swaps it with the active one, nothing
  is lost either way. A bare sample is simply replaced.

## Inbox (device exports)
Most fundus cameras and OCTs export JPEG / PNG / BMP / TIFF pictures and PDF reports to a
folder. The **Inbox** (header tray icon, or *Image & data ▸ Inbox*) collects them until you
say whose they are:

- **Desktop app** — *Settings ▸ Inbox folder ▸ Choose folder…* picks the folder in the
  system dialog. Retina checks it every 15 seconds and whenever a file appears, up to three
  subfolders deep, and keeps watching it at every start.
- **Website** — in browsers with folder access (Chrome, Edge) the same button grants a
  folder, checked every 10 seconds while the page is open; after a reload the browser asks
  for one click (*Reconnect folder*). Elsewhere use **Add files…** or drop files onto the
  Inbox.
- The first time a folder is chosen you decide whether the files already in it are
  imported or only the ones that arrive from then on.
- **Read only.** Retina copies each file into its own storage; the files in the folder
  are never changed, moved or deleted. Symbolic links are not followed, files over 50 MB
  are skipped, and a file is taken only once it has stopped changing for a few seconds
  and is complete (a camera still writing it is waited for). A file whose name and
  contents disagree (a JPEG called `.pdf`) is refused rather than guessed at. Skipped
  files are listed in the Inbox with the reason.
- Each file is stored once (by the SHA-256 of its bytes): the same export arriving twice,
  or added again, does not make a second copy. **Discard** removes Retina's copy and keeps
  only that fingerprint, so the folder does not bring it back; adding it by hand does.
  The same holds for a filed file that is later removed from its visit, or whose visit or
  patient is permanently deleted: its bytes go, the fingerprint stays.
- **Filing.** Every card shows a thumbnail, name, date and size. The date says where it
  comes from: *Taken* is the camera's own date (EXIF), *File saved* is only when the file
  was written, which may be an export or copy time rather than the exam date. Choose the eye and where
  it goes — this visit, a new visit for this patient, or any other patient or visit — and
  press **File**. If the file name says a side (`IMG_0012_OD.jpg`, `informe_izquierdo.pdf`,
  `Right`, `der`, `右眼`, `левый`…) that eye is pre-selected and marked *suggested from the
  file name — check it*; with no suggestion the eye starts empty and File stays off.
  Nothing is ever filed automatically. Filing several selected files to different eyes
  asks first.
- A picture becomes the eye's picture, or one more of its pictures (see above). A PDF is
  attached to the visit with its eye (OD, OS or both) under *Attached documents* and is
  sent with the visit (see below). Filed to an eye whose stored picture is missing (*Image
  missing — re-attach*), a picture takes that picture's place and keeps its marks, as
  *Load image* does.
- **TIFF** is decoded by Retina itself (uncompressed, LZW, PackBits and Deflate; 1–16 bit
  grey, RGB, palette or CMYK) and stored as PNG. TIFFs holding JPEG-compressed pixels and
  BigTIFF are shown as unsupported, with the reason — export those as JPEG instead.

## Refraction (per eye)
- Visual acuity — distance uncorrected / corrected, and near.
- Autorefraction / retinoscopy and the **subjective final Rx** (sphere / cyl / axis / add).
- Keratometry (K1 / K2 / axis), IOP, pachymetry, lens status, observations and notes.

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
  dial, Amsler grid, low-contrast letters, a colour-vision **screening plate** (clearly
  non-diagnostic — see below), a fixation target and blank white/black fields.
- **Snellen full / per-row** — show the whole chart or one row at a time, stepping through
  rows (the **Rows** remote button or `C`; `↑/↓` change the row).
- **Optotype order** — choose **Fixed chart** (canonical letters in their original order)
  or **Randomize** in Settings; the Shuffle button re-randomizes at any time to prevent
  memorization. Randomized rows never repeat a letter and never run the same E or C
  orientation three times — both give an answer away without the patient resolving
  anything. Shuffle is inert on the charts that have nothing to randomize (Amsler, the
  astigmatic dial, fixation, blank fields) and says so rather than silently switching the
  whole session to random.
- **Colour vision** — a two-axis screening plate: a red-green plate, a blue-yellow plate
  and a **control plate everyone can read**. Each shuffle re-samples the dot mosaic, the
  figure (one or two digits, never the same figure twice running) and the axis. The
  figure and ground colours are isoluminant by construction — they differ in hue only, so
  the number cannot be read by brightness — which is also why the plate is worthless on a
  wrong display. **Results are invalid on an uncalibrated or wide-gamut screen, and with
  Night Shift / f.lux / an OS colour filter on: those filters simulate colour blindness.**
  The remote panel says so whenever the plate is up. A missed plate is a reason to refer
  for standardized plates. It is never a finding, and the app will not name a deficiency
  type.
- **Answer key** — the remote shows what the chart is currently displaying (the letters,
  the C and E orientations, or the plate's figure), because once a chart is shuffled the
  clinician standing at the panel has no other way to know.
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
- **Download DICOM** — the visit as DICOM files, all in ONE study (same
  `StudyInstanceUID`, same patient block):
  - the report as an Encapsulated PDF (SOP class `1.2.840.10008.5.1.4.1.1.104.1`,
    Modality `DOC`, series 1);
  - each eye photograph as an **Ophthalmic Photography 8 Bit Image** (SOP class
    `1.2.840.10008.5.1.4.1.1.77.1.5.1`, Modality `OP`, `ImageLaterality` R or L,
    series 2 for OD and 3 for OS). Sample pictures are never included.

  The browser may ask once to allow several downloads. Details are in
  [Sending to an archive](#sending-to-an-archive-dicomweb).
- **Send to archive** — the same objects sent to your PACS over DICOMweb (below).
- **Spectacle Rx** — a signable prescription (OD/OS sph/cyl/axis/add/prism + PD).
- **Lens order** — a lab order (Rx + lens spec + PD + frame/fitting).
- **Referral letter** (*carta de referencia*) — a letter to an ophthalmologist, in the
  interface language: patient, exam date, the reason for referral (free text, required),
  the visit's measurements and Observations exactly as recorded, what was marked on the
  images, optionally the previous visit's values, and the examiner's name, title,
  licence (*cédula*) and a signature line. It refers and reports; it never states or
  suggests a diagnosis, grades a value or names a condition, and says so. Cup-to-disc
  ratios and marks are left out for a sample picture (they are not this patient's). The
  title and licence come from Settings ▸ Report branding ▸ prescriber and print whether
  or not the letterhead is switched on, but only when the visit's Examiner is blank or
  matches that prescriber. "To", "Reason" and "Include the previous visit" are saved
  with the visit. File: `retina_<ID>_referral.pdf`.
- **Privacy notice template (ES)** — an *Aviso de privacidad integral* for clinics in
  Mexico, always in Spanish, filled from Settings ▸ Report branding ▸ *Letters and
  privacy notice* (legal name, address, privacy contact and email, how patients exercise
  their ARCO rights). The clinic is the data controller and issues it; Carino is not a
  party and is not named. It covers the contents required by art. 15 of the Ley Federal
  de Protección de Datos Personales en Posesión de los Particulares (DOF 20-03-2025),
  health data as sensitive data, express written consent with a signature block (art.
  8), transfers (arts. 35–36), ARCO rights and deadlines (arts. 28, 31, 34) and the
  authority (Secretaría Anticorrupción y Buen Gobierno). **It is a template:** every
  page says *"Plantilla — revise con su asesor legal antes de usarla"*, missing details
  print as `[COMPLETAR: …]`, and it must be reviewed by a lawyer before use. The legal
  sources are cited in `retina-aviso.js`. Also available from Settings, since it needs
  no patient. File: `aviso_de_privacidad_plantilla.pdf`.
- Annotated PNG, re-openable study JSON, and a printable report. Opening a study
  JSON creates a **new visit** (the file carries no picture: an eye with marks opens
  on an "Image missing — re-attach" placeholder of the recorded size).

Dates in the documents are written the way the reader writes them: DD/MM/YYYY in Spanish
and Portuguese, YYYY/MM/DD in Japanese, DD.MM.YYYY in Russian, ISO in English. Option
values (lens status, lens type, material, prism base) and the labels burned into the
annotated pictures are printed in the document's language too.

Every exported page carries a footer: `Page N of M`, the patient ID, and `Carino Retina`.
The privacy notice is the one exception: it is the clinic's own legal text about no
patient, so it has neither the patient ID nor the `Carino Retina` line.
The provenance line has no setting that removes it — these are unsigned computer output
whose disclaimers say exactly that, and stripping the tool's name would leave those
disclaimers with nobody making them. It is not a claim of authenticity: there is no
signature and no tamper evidence, and none is implied.

## Sending to an archive (DICOMweb)
**Settings ▸ Archive (DICOMweb)** holds one archive address and an access token.
**Save and test** stores them and checks the connection with a QIDO query
(`GET {address}/studies?limit=1`); only the answer's status is used. **Export ▸ Send to
archive** then lists what will go — the report and each eye photograph, with their
sizes — and puts them in the **outbox**:

- The outbox lives in this device's database. Objects that could not be sent stay there
  across reloads and restarts and are retried automatically with a growing wait
  (15 s, 30 s, 1 min … at most 30 min); an archive that reports it is out of disk space
  is retried after at least 5 minutes. The header's tray icon shows how many are not
  sent yet; open it to see each object's state and error, **Retry** or **Discard** it,
  **Retry all** or **Clear sent**. Objects are sent only while Retina is open.
- An object counts as sent only when the archive lists its SOP Instance UID as stored.
  A refused object (for example status `0xC000`) waits for a person; it is not retried
  by itself. A refused token (HTTP 401/403) pauses the whole outbox at the first one.
- **Identity.** A visit has one `StudyInstanceUID`, minted once and stored with it. A
  photograph keeps its SOP Instance UID while the picture and the patient details stay
  the same, so sending it again replaces the archived copy rather than adding one; the
  send list says when it was already sent and leaves it unticked. The report is a new
  instance each time (its instance number counts up in the same series). If the patient
  ID, name or date of birth changed after a send, Retina warns that the archive still
  holds the old copy and sends the current details as a **separate study**, so one
  study never carries two patients — correct or remove the old copy in the archive. The
  same happens when the details changed while objects were still **waiting** in the
  outbox: those are removed (their details are out of date) before the new study is
  queued.
- **Deleting a visit** that still has objects waiting holds them: they are not sent while
  the visit is in Recently deleted, go out if it is restored, and are removed — with the
  record of what was sent — when it is deleted permanently.
- **Download DICOM** works even when this tab cannot save the visit (open in another
  tab, newer data); the files then carry identifiers that are not kept. It never changes
  the identifiers a later Send relies on.
- Archive settings changed in one tab apply in every open tab. A tab that cannot reach a
  new address (the website fixes the allowed address when the page loads) stops sending
  and asks to be reloaded; another tab takes over.
- **Patient ID.** The archive files everything under a patient ID; Send asks for one if
  the visit has none. **Accession number** and **Referring physician** (Patient section)
  are optional and travel in `AccessionNumber` and `ReferringPhysicianName`; the
  Provider field becomes `PerformingPhysicianName` on the images.
- **Settings ▸ Archive** also asks which kind of device the pictures come from (fundus
  camera — the default —, slit lamp or external camera; this sets the coded device type
  and anatomic region) and whether they may show printed text such as names or dates
  (`BurnedInAnnotation`, YES unless you say No). No exam value is ever copied into the
  photograph's acquisition attributes.

**Encoding.** Every object is Explicit VR Little Endian and the photographs are
uncompressed 8-bit RGB, decoded from the stored picture exactly as Retina shows it. Every
archive must accept that transfer syntax, while JPEG-in-DICOM is optional for a receiver;
the cost is size (a 12-megapixel photo is about 36 MB on the wire). A source that may have
been lossy-compressed says so (`LossyImageCompression` 01, with the ratio and the method:
`ISO_10918_1` for JPEG, `ISO_23008_2` for HEIC, otherwise the format's name such as `WEBP`);
only PNG, BMP, GIF and TIFF sources are written as `00`.

**Where the request is made.**
- Website: the page itself calls the archive. The browser enforces two rules: the
  archive must allow the page's origin (CORS), and a page served over HTTPS
  (`https://retina.carino.systems`) may call plain `http://` only on the same computer
  (`127.0.0.1` / `localhost`). For an archive elsewhere on the network use the desktop
  app, or serve the archive over HTTPS. The page's Content-Security-Policy allows the
  one archive address you saved and nothing else, so saving a new address reloads the
  page once (then tests it). The token is kept in memory unless you tick **Remember the
  token on this device**, which stores it unencrypted in this browser.
- Desktop app: the request is made by the application itself, not the page, so neither
  rule applies and any `http://host:port` on the network works. The token is stored
  encrypted by the operating system (or kept for the session only where the system
  offers no encryption) and the page never reads it back.

### Carino DICOM settings for Retina
In Carino DICOM's `config.json` (see its CONFIGURATION.md, sections `dicomweb` and
`web`):

```json
"dicomweb": {
  "enabled": true,
  "allow_stow": true,
  "cors_origins": ["https://retina.carino.systems", "app://carino"]
},
"web": { "host": "0.0.0.0", "port": 8042, "auth_token": "<a long random token>" }
```

- `cors_origins` is matched **exactly** (scheme + host + port, no trailing slash). List
  `https://retina.carino.systems` for the website; if you run Retina from your own
  address (for example `http://127.0.0.1:8000` during setup), list that exact origin
  too. Settings ▸ Archive shows the origin to add. `app://carino` is harmless to list
  for the desktop app, which does not need CORS because it sends from its own process.
- `dicomweb.enabled` is off by default; `allow_stow` must stay on.
- The address to enter in Retina is `http://<host>:8042/dicom-web` (the dashboard's port
  plus `/dicom-web`).
- `web.auth_token` is the token to enter in Retina. It is Carino DICOM's
  **administrator** token: whoever holds it can read and change the whole archive. Treat
  it like the archive's password. A loopback-only Carino DICOM may run without a token.
- Re-sending an object Carino DICOM already holds (same patient ID) overwrites it in
  place; it is never duplicated.

## Report branding
**Settings → Report branding** puts a clinic's own identity on the exported documents:
practice name, department, address, phone, email, website, tax ID, prescriber name and
title, a registration/licence number, a footer line, a logo and an accent colour. It is
off by default, and off is a real code path — an unbranded export is the standard Carino
letterhead, not a letterhead full of blanks.

- **The three documents differ on purpose.** The study report gets a quiet caption,
  because the clinician and the patient both already know where they are. The spectacle Rx
  gets the full block with the registration numbers, because it may be dispensed by a
  stranger in another shop. The lens order sets the **phone number in dark 9 pt under a
  `Call back to` label**, because the lab will ring about an ambiguous prism and that is
  the most consequential string on the sheet.
- **The licence line is guarded.** The study's own Examiner field wins wherever it is
  filled in; the profile's prescriber is used only when it is blank. The profile's title
  and registration number print **only when the two names match** — a prescription naming
  one prescriber and carrying another's credentials is a forged qualification, not a
  formatting slip.
- **The logo** may be PNG, JPEG, WebP, GIF or SVG. Everything is re-encoded through one
  canvas step to fit 600 × 200 px and stay under 256 KB, so pdf-lib only ever receives
  bytes a browser has already decoded. It is stored under its own key, and a logo that
  will not fit is **rolled back** — including if the re-save of the study is what no
  longer fits. A branding decision must never cost a patient's data. A logo that fails to
  decode at export time costs the letterhead its picture and nothing else; the report
  still comes out.
- **The accent colour** is used only by the exported documents — the application keeps
  Carino gold, so you can always tell the app apart from the document it produces. A pale
  brand colour keeps its band and is darkened only for the title, until it clears the
  3:1 large-text contrast floor on white paper.
- **Export / Import profile** writes `carino-branding.json` with the logo inside it, so a
  second machine is set up by importing one file. An imported logo is re-run through the
  whole validation pipeline: a hand-edited file is untrusted input.
- **DICOM** now carries `InstitutionName` and `InstitutionAddress` from the profile, and
  `ReferringPhysicianName` and `AccessionNumber` from the visit's optional *Referring
  physician* and *Accession number* fields in the Patient section (never from the
  profile or the Provider). Those are the encounter's own identifiers,
  the same class of data as `PatientName`; Carino's own vocabulary (`Manufacturer`,
  `SeriesDescription`, `DocumentTitle`) stays canonical English.
- **Printing is branded too**, in the same change — a branded PDF shipping beside an
  unbranded Print is a gap nobody notices until a clinic prints instead of exporting.

Nothing leaves the computer: the branding text lives in this browser's `localStorage`, and
the logo in the on-device IndexedDB database (see [Where your data lives](#where-your-data-lives)).

## Languages
The interface (page names and clinical concepts) is available in **English**, **Spanish**,
**Portuguese (Brazil)**, **Japanese** and **Russian** — pick a language from the header;
the choice is remembered.

**The exported documents follow it.** The report, the spectacle Rx and the lens order are
all drawn in the interface language, which needs an embedded Unicode font: pdf-lib's
built-in Helvetica is WinAnsi and would drop every Japanese and Russian label to nothing.
`fonts/pdf/` holds the subsetted faces (see the README there) and they are fetched on the
first export, not at page load. If a font cannot be loaded the exporter falls back to
Helvetica **and** to English, because a half-drawn Russian report is worse than a complete
English one.

The stored data model stays canonical English — a lens material is `Trivex` in the study
JSON whatever the interface says — so records stay portable and re-openable across
languages. DICOM identifiers stay English for the same reason; only the encapsulated PDF
inside the object, and the institution/physician fields the clinic itself typed, follow
the interface.

Opening `index.html` straight off the filesystem is the case where this matters most: the
fonts are `fetch`ed, and `fetch` is blocked on `file://`, so that path always takes the
Helvetica fallback. Labels survive it because they revert to English — **data does not**,
so a Cyrillic or Japanese practice name would be silently dropped. The exporter detects
that and says so once per session. Open Retina from the desktop app or a web server for
full text.

## Patients and visits
Every visit is saved on this device as it is typed. **Patients** (top bar) lists them:

- **Search** by name or patient ID; case, accents and punctuation are ignored
  ("jose perez" finds "José Pérez").
- **Open a patient** to see their visits by date and **Open** any of them to carry
  on where it was left.
- **New visit for this patient** (also in the Patient section) starts a visit with
  the patient ID, name and date of birth carried over and every exam field empty.
  The previous visit's recorded values — VA, final Rx, IOP, pachymetry, cup-to-disc
  ratios and observations — are shown read-only above the exam, as recorded; nothing
  is compared or judged.
- **New patient** starts a blank visit.

A visit becomes a patient's when its ID, name or date of birth is entered (on leaving
the field). Retina links it to an existing patient only when the details agree; an ID
that already belongs to someone with a different name and date of birth is never
linked silently — a bar asks. Changing the name or ID on a visit that already belongs
to a patient also asks: start a new visit for the new details, or correct the
patient's record. Until it has details a visit is **unfiled**: it is kept whenever
you move on (an empty one is dropped) and can be filed later from Patients.

The first time Retina opens on a new day it starts a fresh visit rather than
continuing yesterday's; a bar offers the previous one.

**Delete** (a visit or a whole patient) asks first, then keeps the items under
*Recently deleted* for 30 days before removing them for good. Check your
record-retention obligations before deleting clinical records.

**Backup** (Patients, or Settings ▸ Storage) exports every patient, visit and image
as one `.retinabak` file. A passphrase is offered each time; with one the file is
encrypted (AES-256-GCM, key from PBKDF2-SHA-256 with 600 000 rounds), without one it
is plain and contains patient data. Importing checks every record and every image
hash and rejects the whole file if anything is wrong; it then merges: visits already
here are left as they are, a newer version of the same visit replaces the older one,
and when both copies were changed since they last met, the incoming one is kept as a
separate copy beside yours. Nothing is ever overwritten silently. A backup leaves out
deleted items.

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
examination data never leave the machine, except the visits you explicitly send to
the archive configured in Settings ▸ Archive.

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
the Settings list names what it stored (anchor, this screen, chart screen) and lets
you clear each entry or reset everything to 96 dpi. A changed OS scale changes the
key, so the chart then reports its calibration as estimated until it is measured again.

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
Nothing is uploaded unless you set up an archive and press **Send to archive**
(see [Sending to an archive](#sending-to-an-archive-dicomweb)); then only the visit you
send goes, and only to that address. Everything else stays in the storage of the page's own origin
(`https://retina.carino.systems` on the website, `app://carino` in the desktop
app, which keeps it inside the application's own data folder):

- **Visits and their images** — and the clinic logo — are in an IndexedDB
  database named `carino_retina`. Images are stored as the original file bytes,
  not re-encoded. There is no fixed 5 MB ceiling any more: the limit is the
  browser's storage quota, normally a share of the free disk space. Settings ▸
  Storage shows how much is in use and when the last backup was made; every
  saved visit is reached from **Patients**.
- **Settings**, screen assignments, calibrations and the branding text stay in
  `localStorage`; they are small. The archive address (and the token, only if you ask
  for it to be remembered) is `carino_retina_dicomweb`; the desktop app keeps both in
  `archive.json` in its data folder, the token encrypted by the operating system's
  keychain. On Linux with no keychain service running (no GNOME Keyring or KWallet, common
  on a kiosk AppImage), the system offers only a fixed-key fallback that is not real
  encryption; there the app does not save the token at all. It is kept in memory for the
  session only, and Settings says so.
- **The archive outbox** (objects waiting to be sent) is in the same database.
- **The Inbox** — copies of imported device exports waiting to be filed — is in the same
  database too. The watched folder is remembered in `inbox.json` in the desktop app's data
  folder, and as a browser folder permission (in the database) on the website; the folder's
  files themselves are only read.
- **Saving** is automatic, a moment after each change. The database icon in the
  header says whether the last change is saved. A change that could not be
  written turns it red and opens a bar with **Retry now**; it is never dropped
  silently. Typed fields and marks still waiting to be written when the tab or
  app closes are kept in a small journal and restored on the next start. The
  journal holds no pictures: a photo loaded just before closing whose save had
  not finished reopens as an "Image missing — re-attach" placeholder (with its
  marks), never as the previous picture. This covers closing a tab or quitting
  the app, not a crash or a power cut.
- **Two tabs on the same visit** cannot overwrite each other. A second tab shows
  it read-only, with **Take over** (the first tab then stops saving it). In a
  browser without Web Locks the second one to save is stopped instead and
  offered **Reload** or **Keep mine as a copy**; the copy stores the pictures
  that tab is showing, not just references to them.
- **If the browser offers no storage at all** (some private windows, blocked
  site data), Retina keeps working in memory and shows a permanent bar saying
  nothing is being saved; export your documents before closing. A text-only copy
  of that session is recovered the next time storage is available.
- On the website Retina asks the browser to keep this data
  (`navigator.storage.persist()`) after the first real entry. Until the browser
  agrees, it may delete it to free space, and clearing site data deletes it.
- **Upgrading from an older version** copies the old browser-storage study and
  logo into the database once, checks the copy byte for byte, and only then
  removes the old keys. The original text is kept inside the database for 30
  days as a fallback.

The desktop app's data folder:

| | |
| --- | --- |
| Linux | `~/.config/Carino Retina/` |
| macOS | `~/Library/Application Support/Carino-Retina/` |
| Windows | `%APPDATA%\Carino Retina\` |

The macOS folder is hyphenated and the other two are not: on macOS the name comes
from the application bundle, which is `Carino-Retina.app`.

They are per-machine and per-package-format: moving between the AppImage, the
`.deb` and the `.rpm` gives you a different folder and therefore an empty
encounter. Export a backup (Patients ▸ Export backup) before you switch and import
it in the new one.

### The icon
The desktop icon is the Carino fleet ring with a pupil in the middle, drawn by
[`desktop/assets/make_icon.py`](desktop/assets/make_icon.py). The site's favicon,
`logo.webp`, is an older hand-drawn eye and shares nothing with it. They are two
different files on purpose: what `retina.carino.systems` serves is a separate
decision from what an application ships as its icon, and replacing the favicon has
not been decided.

### Known limits
- The database is not encrypted. Anyone who can sign in to this computer's
  account can read it. No compliance with any health-data regulation is claimed.
- A backup made without a passphrase is a plain file with patient data in it. A
  forgotten passphrase cannot be recovered.
- On the desktop app a backup is saved straight into Downloads (no save dialog),
  like every other export.
- Data is per origin: the website, `localhost` and the desktop app each have
  their own, and moving between them starts empty; carry the data across with a
  backup.
- Going back to a release from before the database move starts empty: those
  releases only read the old browser-storage key. The data stays in the database
  and reappears when you update again; anything entered in the old release
  meanwhile is picked up as a recovered visit.
- A future release that changes the database layout makes this one show a
  read-only "newer version" bar instead of the data. Nothing is lost; update.
- The archive outbox sends only while Retina is open. It is not part of a backup:
  unsent objects stay on the device they were queued on.
- On the website a remembered archive token is stored unencrypted in the browser, and a
  token that is not remembered must be typed again after a reload.
- From the HTTPS website only an archive on the same computer or behind HTTPS can be
  reached (see [Sending to an archive](#sending-to-an-archive-dicomweb)).
- Photographs are sent uncompressed; large pictures make large objects.
- The Inbox reads a folder only while Retina is open. On the website it needs a browser
  with folder access (Chrome, Edge) and one click after each reload; elsewhere files are
  added by hand. Files over 50 MB, TIFFs with JPEG-compressed pixels and BigTIFF are not
  imported. The Inbox is not part of a backup (filed pictures and documents are).
- The privacy notice template is not legal advice and is Spanish only; it must be
  completed and reviewed by the clinic's lawyer. It is a PDF, so a reviewed final text
  has to be produced in the clinic's own word processor.
- Only one prescriber per device has a stored title and licence (*cédula*). A visit
  whose Examiner is someone else prints that name on the referral and the prescription
  with no licence line; the examiner adds it by hand.
- The printed report (Print button) is still English only; the PDF exports follow the
  interface language.
- DICOM status of [DICOM-INTEGRATION.md](DICOM-INTEGRATION.md): the Encapsulated PDF
  report, the OP photographs and STOW-RS sending are built; the rest of that document
  (structured reports, presentation states, worklist) is still design.

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
