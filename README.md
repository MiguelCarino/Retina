# Carino Ophthalmology

A client-side **fundus & eye annotation suite**. Load a fundus / anterior-segment
image, mark the optic disc, cup and fovea, and get an automatic **cup-to-disc
ratio** plus calibrated measurements — then record per-eye clinical data and export.
Everything runs in the browser; **no image or data is ever uploaded**.

Part of [Carino Systems](https://carino.systems). Live at **ophtha.carino.systems**.

## Features
- **Structure marking** — optic disc center, fovea center, optic disc margin and
  optic cup margin (draggable, resizable ellipses).
- **Auto metrics** — vertical & horizontal cup-to-disc ratio (colour-coded by
  glaucoma risk), disc diameter/area, disc–fovea distance and angle.
- **Calibration** — set the assumed vertical disc diameter (default 1.5 mm) and
  every measurement is reported in millimetres.
- **Lesion pins** — microaneurysm, hemorrhage, exudate, cotton-wool spot, drusen,
  neovascularization, laser scar, etc., each with a free-text note.
- **Measurement tool** — ruler in px or mm.
- **Per-eye (OD / OS) clinical sheet** — VA, IOP, refraction (sph/cyl/axis/add),
  pachymetry, lens status, diagnosis, notes.
- **Export** — annotated PNG, full study **PDF report** (both eyes, embedded
  annotated images + metrics + clinical data), a **DICOM** file (Encapsulated
  PDF, SOP class `1.2.840.10008.5.1.4.1.1.104.1` — a single PACS-storable object
  containing the whole study), re-openable study JSON, and a printable report.
- Zoom / pan, keyboard tool shortcuts (V H 1–6), autosave to localStorage,
  drag-and-drop image loading, and a built-in synthetic sample fundus.

## Keyboard
`V` select · `H` pan · `1` disc center · `2` fovea · `3` disc · `4` cup ·
`5` lesion · `6` measure · `Space` pan (hold) · `F` fit · `Del` delete selected.

## Notes
This is a documentation / annotation aid, **not a diagnostic device**.
