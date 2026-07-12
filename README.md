# Carino Retina

A client-side **eye examination, refraction & dispensing suite**. Annotate a fundus
image for an automatic **cup-to-disc ratio**, run a full **refraction**, and work up a
**spectacle / contact-lens dispense** — then export the whole encounter. Everything runs
in the browser; **no image or data is ever uploaded**.

Part of [Carino Systems](https://carino.systems). Live at **ophtha.carino.systems**.

The suite is organised as an **encounter** with three modules you switch between in the
side panel. Imaging is entirely optional — you can refract and dispense without ever
loading a photo.

## Imaging
- **Structure marking** — optic disc center, fovea center, optic disc margin and optic
  cup margin (draggable, resizable ellipses).
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
- **Contact lens** — brand, base curve, diameter, power per eye.

## Export
- **Study PDF** — the full encounter: both eyes with embedded annotated images, disc
  metrics, refraction, and a binocular dispensing summary.
- **Study DICOM** — the same report wrapped as an Encapsulated PDF object (SOP class
  `1.2.840.10008.5.1.4.1.1.104.1`, Modality `DOC`) — one PACS-storable file for the whole
  study.
- **Spectacle Rx** — a signable prescription (OD/OS sph/cyl/axis/add/prism + PD).
- **Lens order** — a lab order (Rx + lens spec + PD + frame/fitting).
- Annotated PNG, re-openable study JSON, and a printable report.

## Keyboard
`V` select · `H` pan · `1` disc center · `2` fovea · `3` disc · `4` cup ·
`5` lesion · `6` measure · `Space` pan (hold) · `F` fit · `Del` delete selected.

## Notes
This is a documentation / annotation aid, **not a diagnostic device**. Exported
prescriptions and orders must be verified and (where required) signed before use.
