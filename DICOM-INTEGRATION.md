# Retina in the DICOM ecosystem

How Retina becomes an eye-care **modality** rather than an annotation tool, works
against any PACS without knowing which one it is, and answers the structured-data
question without Carino ever running a database.

Status: design document, partly built. Built (see "What is built" below): the
Encapsulated PDF report, Ophthalmic Photography 8 Bit images with laterality, one
persisted Study UID per visit, STOW-RS send with a settings profile, and the retry
outbox, the Inbox of device exports, and a local patient / visit registry. Where the
design text below disagrees with what was built, a *Superseded* or *Built* note says so
and "What is built" is authoritative. Everything else here is still design.

---

## The problem, stated honestly

Ophthalmology and optometry are the worst-served corner of DICOM in practice, for
three separate reasons that people tend to collapse into one:

1. **The devices don't speak it.** Fundus cameras sometimes do; autorefractors,
   lensmeters, phoropters and older slit lamps mostly speak RS-232, a proprietary
   blob, or a printer.
2. **The archives don't render it.** The ophthalmic IODs exist and have existed for
   years, but a generic hospital PACS bought for CT and CR will often store an
   `OP` object and then show it badly, and will ignore a refraction SR entirely.
3. **Most of the value isn't pixels.** Refraction, VA, IOP, cup-to-disc ratio, PD,
   frame and fitting numbers are *structured measurements*. A PACS is an object
   store. Storing objects is not the same as having a queryable eye-care record —
   and that gap is what every practice fills with a practice-management system,
   a spreadsheet, or paper.

So "integrate into the DICOM ecosystem regardless of PACS" is really three
questions: what objects do we emit, how do the bytes get there, and where does the
structured data actually live.

---

## The one-line answer to the database question

**Retina holds nothing. The PACS holds the pixels and the measurements. The EHR
holds the chart. Retina is a lens over both.**

Three homes were possible. Naming why two are rejected matters more than the one
that is chosen:

**(a) A Retina server with its own database.** Rejected. It breaks the client-side
promise the whole fleet is built on, and the moment Carino stores a patient record
Carino becomes a PHI custodian — NOM-024 and HIPAA obligations, backups, breach
duty, a security review attached to every single sale. It also creates a second
source of truth that will drift out of sync with the archive the hospital already
trusts. The cost is enormous and the benefit is convenience.

**(b) The PACS is the database.** Chosen, for imaging *and* measurements. This is
the part people miss: DICOM SR is queryable. `QIDO-RS` by PatientID, Modality,
StudyDate and StudyInstanceUID gets you back the refraction and the disc metrics
just as readily as the photo. And it is already backed up, already in the retention
policy, already audited, already inside the hospital's security boundary. Every
property a clinical database needs, someone else is already paying for.

**(c) The EHR / practice-management system is the database** for what DICOM should
not hold — appointments, billing, the longitudinal chart, the notes a clinician
writes in prose. Bridge to it by *emitting* HL7 `ORU^R01` or FHIR
(`Observation` + `DiagnosticReport` + `ImagingStudy`), never by storing on its
behalf. Carino DICOM already ingests HL7; the outbound direction is the natural
extension and belongs there, not in the browser.

The discipline that follows: **if it is not in the archive, it did not happen.**
Everything Retina keeps locally is a draft, and is labelled as one.

> **Superseded in part by what was built.** The shipped product keeps a lasting local
> registry: patients and their visits (with images) in the on-device IndexedDB
> database, keyed by visit id rather than StudyInstanceUID, with search, encounter
> history, Recently deleted and `.retinabak` backups (README, "Patients and visits").
> Nothing is cleared when the archive acknowledges a STOW. The reason is the clinics
> Retina actually serves: many have no archive at all, or one that cannot show an
> earlier visit back to the clinician, and a visit that disappeared on acknowledgement
> would leave them with no record of their own. The parts of this section that still
> hold: Carino runs no server and holds no PHI (option (a) stays rejected); the archive,
> when there is one, is where the objects are filed; and the unfiled-visit counter
> exists (Patients ▸ Unfiled visits). The local registry is the clinic's own data on
> its own machine, so backing it up is the clinic's job, which is why Settings ▸
> Storage shows when the last backup was made.

### Where local state is unavoidable, and what it is allowed to be

Three cases, and all three are spools rather than records:

- **The encounter in progress.** The patient is in the chair, the exam is half
  done, the browser can crash. Keep it in IndexedDB keyed by StudyInstanceUID,
  show it as *unfiled*, and clear it the moment the archive acknowledges the store.
  *(Superseded: built as the lasting visit registry described above, keyed by visit
  id; the Study UID is stored on the visit; nothing is cleared on acknowledgement.)*
- **No archive reachable.** The same spool becomes a retry queue. This is the
  `outgoing/` directory of Carino DICOM, in a browser.
- **Device configuration.** Screen calibration, monitor assignment, lane distance,
  endpoint URL and AE titles. Config, `localStorage`, no PHI. Mostly already there.

A visible counter of unfiled encounters is a required feature, not a nicety — it
is the thing that stops a spool from silently becoming a shadow record.

---

## What we emit: one graded stack, always

The trick that makes "regardless of which PACS" true is to stop asking which PACS
it is. Every encounter Retina exports produces the *same* stack of objects, and
each archive consumes as much of it as it understands. A dumb archive ignores what
it cannot render; a capable one lights up. Nothing needs configuring per site.

| Tier | Object | SOP Class UID | Consumed by |
| --- | --- | --- | --- |
| 0 | **Encapsulated PDF** — the human-readable report | `…5.1.4.1.1.104.1` | Literally everything. Built. |
| 1 | **Ophthalmic Photography 8 Bit** — the fundus image itself | `…5.1.4.1.1.77.1.5.1` | Any archive. Built (uncompressed RGB). |
| 2 | **GSPS** — annotations as vector overlay | `…5.1.4.1.1.11.1` | Archives that render presentation states. |
| 3 | **Measurement SRs** — refraction, VA, keratometry, Rx | `…5.1.4.1.1.78.*` | Archives and analytics that parse SR. |
| 3 | **Comprehensive SR** — CDR, disc metrics, lesion pins with SCOORD | `…5.1.4.1.1.88.33` | Same. |

(Every UID above should be checked against PS3.6 before it is written into code
rather than trusted from this table.)

Two design notes that carry most of the weight:

**GSPS is why annotations should never be burned in.** A Grayscale Softcopy
Presentation State stores the arrows, text labels, freehand outlines and the
disc/cup ellipses as graphic annotation sequences referencing the image's SOP
Instance UID. The photo in the archive stays pristine and diagnostic; the markup is
a separate, retractable, re-editable layer that Retina can load back and keep
working on. Burning pixels destroys the source and makes the annotation permanent
and unattributable. Do it once, as an *optional* extra series clearly flagged
`Burned In Annotation = YES`, for the sites whose viewer shows no presentation
states and whose clinicians will otherwise never see the markup.

**Laterality is not optional.** Every object carries the eye, with the whole OD/OS
model of the app mapping onto it. An eye study without laterality is clinically
useless and will be rejected by anything strict. *Built, with one correction to the
original wording:* `Laterality (0020,0060)` = `R`/`L` is written on the OP images (series
level), together with Image Laterality (0020,0062). On an Encapsulated PDF, (0020,0060)
is not part of the IOD and a validator rejects it there, so device reports carry **Image
Laterality (0020,0062)** `R`/`L`/`B` instead (see "What is built").

### Structured objects worth emitting, in priority order

- Subjective Refraction Measurements `…78.4` — the final Rx, the thing everything
  else in the encounter exists to produce.
- Visual Acuity Measurements `…78.5`.
- Spectacle Prescription Report `…78.6` — makes the signable Rx a first-class
  archive object rather than a PDF.
- Autorefraction `…78.2` and Keratometry `…78.3`.
- Lensometry `…78.1`, when a lensmeter feed exists.
- Cup-to-disc ratio, disc diameter/area and disc–fovea geometry as a TID 300
  measurement group inside a Comprehensive SR, each measurement anchored to the
  image by SCOORD so a viewer can show *where* the number came from.

That last one is the clinical payoff. Once CDR is a coded, queryable measurement
rather than a line in a PDF, **CDR trend over time** becomes possible — and
a clinician comparing visits sees how the measurement changed, with each value
traceable to the marks it came from.

---

## How the bytes move: one protocol, three deliveries

A browser cannot open a DIMSE association, and that is fine, because it should not
have to know that DIMSE exists. **Retina speaks exactly one protocol — DICOMweb —
and everything else is somebody's adapter.**

1. **File export.** What exists today. Zero install, works at every site on earth,
   and is the honest answer for a first pilot. Keep it forever.
2. **STOW-RS straight from the browser.** One endpoint URL plus auth in settings.
   Works against Orthanc, dcm4chee, Google Cloud Healthcare, AWS HealthImaging and
   most archives sold in the last decade. Needs CORS on the archive, which is the
   catch.
3. **Carino DICOM as the sidecar.** For the majority of hospital PACS that expose
   only DIMSE and will never set a CORS header for a web app. Retina STOWs to the
   local appliance; the appliance C-STOREs onward to whatever the site actually
   runs. Carino DICOM already accepts STOW-RS with an exact-match CORS allow-list
   and already forwards by C-STORE — this path needs no new capability there, only
   a documented profile.

This is what makes the PACS-agnostic claim structurally true rather than
aspirational: there is one code path in Retina, and the dialect translation lives
in a separate product that Carino already owns and already ships.

### And when there is no PACS at all

A solo optometrist in Guadalajara has no archive, and telling them to buy one is
not an answer. Carino DICOM *is* the archive in that configuration — it stores,
indexes, serves Query/Retrieve and DICOMweb. **Retina + Carino DICOM is an
eye-care imaging department in a box**, and the day the clinic joins a hospital
network, one field in settings changes and nothing else does.

That bundle, not Retina alone, is the product.

---

## The feature that turns a tool into a modality: the worklist

Everything above is plumbing. This is the part clinicians feel.

Nobody should type a patient's name into Retina. Retina queries a **Modality
Worklist** — via Carino DICOM's MWL SCP, or via UPS-RS/QIDO where the site offers
it — the user picks the patient waiting in the lane, and the encounter inherits
Patient Name, ID, DOB, Sex, **Accession Number**, **Study Instance UID** and the
Requested Procedure. Every object Retina then writes lands in the right study,
already reconciled, with no manual matching and no orphaned data.

Then close the loop: MPPS (or UPS-RS state transitions) to mark the procedure
in progress and completed, so the RIS closes its own order without anyone telling
it to.

Concretely, the difference is between a technologist who types demographics four
times per patient and one who taps a name. That is the entire gap between a tool
people admire and a tool people install.

### Reading, not just writing

The same worklist selection makes reading possible: `WADO-RS` the OP/OPT instances
already in the selected study and annotate a photo the *fundus camera* took, rather
than only a webcam capture. And `QIDO-RS` for the patient's prior eye studies makes
the prior-versus-current comparison — and the CDR trend — real.

---

## Housekeeping a product needs and a demo does not

**A DICOM Conformance Statement.** Listing SOP classes, roles, transfer syntaxes
and character sets. It is the first document a hospital IT department asks for, it
is cheap to write once the object set is fixed, and it doubles as a sales asset.

**UID discipline.** The root `1.2.826.0.1.3680043.10.1401` is already registered.
Rules: a worklist-derived Study Instance UID is reused verbatim and never
regenerated; Retina mints Series and SOP Instance UIDs only; and the branch must
include a per-install identifier so two Retina installations can never collide.
The current `Date.now() + random` construction is probably safe and is not
principled — make it principled.

~~**Replace the hand-rolled writer with `dcmjs`.**~~ *Decided against; see "What is
built" ▸ Writer. The writer was rewritten in place instead (sorted tags, tested byte by
byte). Of the Encapsulated PDF gaps named below: laterality is resolved, as Image
Laterality (0020,0062) on device reports filed to an eye (the visit's own report covers
both eyes, and the attribute is Type 3); Patient Sex is written present and empty
(Type 2), because Retina does not collect it; Referenced Request Sequence still waits for
the worklist (phase 2).* The original note: it is already vendored in
DICOM-editor and the fleet knows its quirks (uppercase no-`x` hex dictionary keys —
use the `setTag`/`getTag` helpers or writes fail silently). Emitting OP, GSPS and
SR by hand is not a reasonable amount of byte-wrangling; emitting Encapsulated PDF
by hand already omits Referenced Request Sequence, laterality and a proper
Patient Sex.

**Bridge, not upload.** File handoff to and from DICOM-editor and Media should use
the existing `carino-bridge.js` convention, so de-identification before export is a
click rather than a round trip through the filesystem.

---

## What is built

Code: `retina-dicom.js` (writer, STOW reply parsing, outcome rules; unit-tested in
`tools/unit-tests.js`), the archive / outbox section of `index.html`, and
`desktop/archive.js` (the desktop app sends from its main process).

**Writer.** A small dataset class that sorts tags at encode time (the old inline writer
relied on a hand-ordered list), defined-length sequences, Explicit VR Little Endian,
UTF-8 (`ISO_IR 192`) with byte caps that never split a code point. `dcmjs` was not
adopted: the writer is ~300 lines, tested byte by byte, and avoids vendoring a large
dependency.

**UIDs.** Root `1.2.826.0.1.3680043.10.1401`, then `.<ms since epoch>.<random digits>`
filled to 64 characters — never sliced, so no trailing dot or leading zero; every UID
is checked against `^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$` and length ≤ 64.

| Identity | Rule |
| --- | --- |
| StudyInstanceUID | Minted once per visit, stored in `enc.studyUID`, shared by every object. |
| SeriesInstanceUID | One per kind, stored: report (series 1), OD images (2), OS images (3), device reports OD / OS / both (4 / 5 / 6). |
| Report SOP | New on every export/send; InstanceNumber = `++enc.reportSeq`. |
| Image SOP | Stored on the image reference with `contentKey = sha256(srcSha256 \| eye \| PatientID \| PatientName \| DOB \| StudyUID \| accession \| institution)`. Same key → same SOP (a resend overwrites); changed key → new SOP. |
| Identity change after a send | `kv sentId:<visit>` records the identity the archive confirmed. If ID, name or DOB differ at the next send, the user is warned and the visit gets a **new** Study UID (and so new series and image SOPs): one study never carries two patients. Carino DICOM files by `PatientID/Study/Series/SOP.dcm`, so the old copy is left for the archive's operator to correct or remove. |
| Identity change while queued | Every outbox item carries the identity it was queued under. Unsent items (pending or failed) of the current Study UID under other details trigger the same warning; they are deleted in the transaction that queues the new study. While one of them is `sending`, Send is refused until it finishes. |
| Download | The image key is always computed from the **send** identity. A download whose ANON / ANONYMOUS placeholders differ from it gets a throwaway SOP UID and changes nothing; if the visit cannot be written, the download uses transient UIDs. |

Minting is written to the visit **before** any bytes leave: for a send, in the same
IndexedDB transaction as the outbox items.

**OP 8 Bit attributes** (validated with dicom-validator against PS3.3 2026d: no errors,
no warnings):

| Module | What is written |
| --- | --- |
| Patient / General Study | PatientName, PatientID, PatientBirthDate (from the visit), PatientSex empty; StudyInstanceUID, StudyDate (exam date), StudyTime (visit created), StudyID (visit id, 16 chars), AccessionNumber, ReferringPhysicianName |
| General Series / OP Series | Modality `OP`, SeriesInstanceUID, SeriesNumber 2/3, Laterality R/L, SeriesDescription "Fundus photograph OD" (or slit lamp / external), PerformingPhysicianName (Provider) |
| Synchronization (M) | Synchronization Frame of Reference UID (minted), Synchronization Trigger `NO TRIGGER`, Acquisition Time Synchronized `N` |
| General Equipment | Manufacturer "Carino Systems", ManufacturerModelName "Carino Retina", DeviceSerialNumber (install id), SoftwareVersions |
| General Image / OP Image | ImageType `DERIVED\PRIMARY` (Retina re-encodes a picture it was given), InstanceNumber, PatientOrientation empty, Content Date/Time = when the picture was stored, Source Image Sequence present and empty (Type 2C: the source is not a DICOM instance), AcquisitionDateTime only from a real capture time (never a file date, and only when every field is a valid date: a camera's `2016:00:00 00:00:00` is dropped), BurnedInAnnotation YES unless the clinic says No, LossyImageCompression `00` only for a PNG / BMP / GIF / TIFF source; anything else `01` + ratio + method (`ISO_10918_1` JPEG, `ISO_23008_2` HEIC/HEIF, `ISO_15444_1` JPEG 2000, `ISO_18181_1` JPEG XL, otherwise the MIME subtype, e.g. `WEBP` — the method's terms are Defined Terms, so extensible) |
| Multi-frame (M) | NumberOfFrames 1, FrameIncrementPointer → Frame Time (0018,1063) = 0 (PS3.3 C.7.6.6.1.2, single-frame case) |
| Image Pixel | RGB, SamplesPerPixel 3, PlanarConfiguration 0, 8/8/7, unsigned, uncompressed |
| Ocular Region Imaged | ImageLaterality R/L; AnatomicRegionSequence (SCT 5665001 "Retina" for a fundus camera, SCT 81745001 "Eye" otherwise — CID 4209) |
| OP Acquisition Parameters | Every Type 2 attribute present and empty. Exam values (IOP, refraction) are never copied here. |
| OP Photographic Parameters | AcquisitionDeviceTypeCodeSequence (CID 4202: SCT 409898007 Fundus Camera / 397247004 Slit Lamp Biomicroscope / 409903006 External Camera, chosen in Settings); the Type 2 code sequences empty; DetectorType empty |
| Pixel Spacing (0028,0030) | Type 1C — required when the device is a Fundus Camera. Written as `row\column` (same value twice) from the nominal retinal scale entered in Settings ▸ Archive (mm per pixel; manufacturer figure or FOV° × 0.29 mm/° ÷ image width). Never derived from the disc-diameter calibration, which is an assumption. Left unset, fundus objects are sent without it and are **not conformant**; the Settings panel says so. Not written for slit-lamp or external photographs. |
| Acquisition Context | Present and empty |

**Device reports filed from the Inbox** (a camera's or OCT's own PDF) are sent as their
own Encapsulated PDF instances in the same study: one series per eye bucket (OD 4, OS 5,
both 6, SeriesDescription "Device report OD/OS/OU"), DocumentTitle = the file name, and
**Image Laterality (0020,0062)** R / L / B — the laterality attribute of the Encapsulated
Document module. The series-level Laterality (0020,0060) is not part of the Encapsulated
PDF IOD, and dicom-validator (2026d) rejects it there; with Image Laterality the object
validates with no errors. A document keeps its SOP UID under the same `contentKey` rule as
a picture (same bytes and identity → a resend overwrites), and the outbox freezes only its
attributes: the Part-10 file is built at send time from the stored, immutable PDF.

The Encapsulated PDF gained PatientBirthDate, AccessionNumber, BurnedInAnnotation YES,
Concept Name Code Sequence (empty, Type 2), AcquisitionDateTime (empty, Type 2) and
EncapsulatedDocumentLength; it no longer writes the Provider as the referring physician.

**Transfer syntax.** Explicit VR Little Endian, uncompressed: every archive must accept
it; JPEG-in-DICOM is optional for a receiver. Encapsulating the camera's JPEG as-is is a
later optimisation.

**STOW-RS and the outbox.** One POST per object to `{base}/studies`,
`multipart/related; type="application/dicom"`, CRLF framing, `Accept:
application/dicom+json`, bearer token. An object is sent only when its SOP UID is in
ReferencedSOPSequence (0008,1199) — a warning still counts. FailedSOPSequence
(0008,1198) with 0xA7xx is retried (out of resources, ≥ 5 min); any other failure reason,
or a 2xx that does not mention the object, waits for a person. 401/403 pause the whole
outbox at the first object; 429 honours Retry-After; 503 and other 5xx and network errors
retry with backoff min(30 min, 15 s·2ⁿ) ±20 %. One tab sends at a time (Web Lock
`carino-retina-outbox`); a send's completion is a compare-and-set on a per-attempt token,
so an object discarded while it was being sent stays discarded. Items of a visit in
Recently deleted are held (skipped by the sender, released on restore); a purge deletes
the visit's outbox rows and `kv sentId:<visit>` in the same transaction. Desktop sends
refuse redirects (`redirect: "error"`), as the website does; a desktop refusal before any
request (`no-base`, `too-large`, `bad-parts`) maps to wait / failed with its own message.

## Order of work

Each phase is independently shippable and independently useful.

1. **Become a real modality.** ~~OP image alongside the existing PDF; laterality and
   accession~~ (built, hand-written writer instead of `dcmjs`). Still to do: GSPS,
   referenced request, the conformance statement.
2. **Stop the typing.** MWL/UPS-RS query, patient banner, inherited Study UID,
   MPPS completion.
3. **Stop the file dance.** ~~STOW-RS send with a settings profile; the retry
   queue~~ (built); the unfiled-encounter indicator (built as Patients ▸ Unfiled visits).
4. **Make the measurements structured.** Subjective Refraction, VA, Keratometry and
   Spectacle Prescription SRs; the CDR measurement group with SCOORD anchors.
5. **Read back.** QIDO/WADO to reopen a prior encounter; prior-vs-current view;
   CDR trend.
6. **Reach the chart.** HL7 `ORU^R01` / FHIR emission, implemented in Carino DICOM
   rather than in the browser.

The product exists at the end of phase 3. Phases 4 and 5 are what make it worth
keeping, and phase 6 is what makes it worth paying for.

---

## Carino as the order layer: making any device RIS-compatible

The idea: the device does not need to speak MWL, or HL7, or anything. Carino holds
the order, the operator relates the device's output to it, and the order closes.
Retina just creates files.

**This already exists.** `PacsServer.create_study_from_order` in `pacs/server.py`,
exposed as `POST /api/ris/orders/capture`, takes an order id plus a file, wraps it
as DICOM stamped with *the order's identity including its pre-minted Study Instance
UID*, drops it in `outgoing/` for the normal auto-send / hold-and-forward pipeline,
and closes the order as `CLOSE_CAPTURED`. The design record calls it use-case B.
What is missing is not the mechanism — it is the reach.

### Where each device already lands

| The device… | Path today | State |
| --- | --- | --- |
| speaks DICOM **and** MWL | pulls the order, burns its Study UID, C-STOREs back, `_reconcile_study` matches on UID, `CLOSE_MATCHED` | works end to end |
| speaks DICOM, **no** MWL | C-STOREs with its own UIDs; matches only if the tech typed the accession, or on patient ID when `ris.match_on = accession_or_patient` | works by luck; no manual reconcile in the UI |
| can only **print** | print capture → review → attach | works, but `_reconcile_study` is wired to the C-STORE receiver only, so a caught print never auto-closes an order |
| **saves a file** (Retina, legacy viewers, screenshots) | capture-to-order | works — **PDF / JPEG / PNG only** |
| speaks **nothing** (RS-232 autorefractor, lensmeter, phoropter) | — | nothing. This is where optometry actually lives. |

### The one change that generalises it

`ingest._classify` recognises `%PDF`, JPEG and PNG magic bytes and nothing else, so
capture-to-order **rejects a DICOM file today**. That single limit is what forces a
choice between two versions of this plan:

**Path A — Retina emits a PDF and nothing else.** Works this week, no change to
either codebase: the tech attaches the study PDF to the order, Carino wraps and
stamps and closes. It is exactly "Retina just creates the files." It is also
tier-0 only — no OP image, no GSPS, no measurement SR, so everything in the graded
stack above is given up in exchange for the shortcut.

**Path B — capture accepts DICOM and re-stamps it.** Teach `_classify` to see
`DICM` at offset 128, and branch in `create_study_from_order`: when the upload is
already DICOM, skip `build_from_bytes` and instead overwrite PatientName, PatientID,
birth date, sex, AccessionNumber, StudyDescription and **StudyInstanceUID** from
the order, leaving everything else — pixels, presentation state, SR content —
untouched.

Path B is worth far more than Retina, and that is the real point of your idea: it
makes *every* DICOM-producing device that cannot do a worklist into an
order-compatible one. The ultrasound that stores with its own UIDs, the camera
whose MWL licence was never bought, the export from a vendor viewer — all of them
become "attach it to the order on screen" instead of "hope the accession was typed
right."

Two things Path B has to get right:

- **Stamp a set, not a file.** An eye study is an OP image *plus* a GSPS *plus* one
  or more SRs. They share one Study UID and the GSPS and SR reference the image by
  its **SOP Instance UID**. So capture must accept several files as a single
  transaction, rewrite the Study UID once across all of them, and never touch
  Series or SOP Instance UIDs — rewriting those silently breaks every internal
  reference and produces annotations that point at nothing.
- **Say no when it is not safe.** Re-stamping identity onto an object that already
  belongs to a different patient is a wrong-patient event with a clean audit trail
  pointing at us. Warn on a mismatch between the file's existing PatientID and the
  order's, and require an explicit confirmation rather than doing it silently.

### One wrinkle in "the order completes when the PACS receives it"

That is not quite what the code does, and the difference matters operationally.
`create_study_from_order` closes the order at **wrap** time — before the study is
forwarded. Delivery happens afterwards through the watcher, and during an outage
hold-and-forward may sit on it for hours.

Closing at capture is the right call for a continuity appliance: the technologist's
work really is finished, and hold-and-forward is the guarantee that the rest
happens. But the order record keeps no link to the delivery state, so a closed
order and an undelivered study are indistinguishable in the dashboard. Worth
fixing: carry the outgoing filename on the closed order and show **captured —
not yet delivered** as a distinct state. Otherwise the appliance's one job during
an outage is invisible precisely when someone is anxious about it.

### The loop this makes possible

Once Retina can read an order, the product is a single motion:

> Order appears on Carino (HL7, or hand-keyed) → tech clicks it → **Retina opens
> with the patient already loaded** → exam → one button → objects post back to
> `/api/ris/orders/capture` → order closes → auto-send forwards to whatever the
> site's real PACS is.

No demographics typed anywhere, no file dance, no Retina database. The identity
handoff can be the fleet's existing `carino-bridge.js` convention or an order id in
the URL fragment plus a fetch against the local API — both keep Retina a page that
stores nothing.

That loop is worth more than any single feature in this document, and it is
reachable from what both repos already contain.

### The frontier

The bottom row of the table is the one with no answer: autorefractors, lensmeters
and phoropters that emit RS-232 or a proprietary dump and will never emit anything
else. A serial-to-order adapter — read the port, parse a handful of known vendor
formats, fill the refraction fields on an open order — is the same shape as the
print capture that already exists, and it is the piece that would make Carino the
only thing in the room that can talk to all of it.
