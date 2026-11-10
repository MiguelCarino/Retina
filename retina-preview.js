/* ============================================================
   retina-preview.js — Carino Retina: the pure parts of the report
   preview (every PDF and the printed report are shown before they
   are written, as Topo's report dialog does).
   ------------------------------------------------------------
   The dialog itself lives in index.html (#rpModal, openReportPreview).
   This file only holds what can be checked without a browser:

   - printDocHtml(): the whole document the Print button prints. The
     preview frame's srcdoc IS this string and the commit button prints
     that frame, so what is seen is what is printed. Screen-only rules
     lay it out as an A4 sheet on grey; print rules drop them.
   - fitScale() / pageBreaks(): the sheet is scaled down, never
     reflowed, when the stage is narrower than a page (a phone), and a
     dashed line marks where each A4 page is expected to end.
   - pdfPageCount(): the page count of the produced PDF bytes, read
     with the vendored pdf-lib (passed in, so Node can stub it).

   No translator is called here (tools/i18n-check.js forbids it in a
   retina-*.js file): every visible string arrives as an argument.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetinaPreview = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PX_PER_MM = 96 / 25.4;
  // A4 with a 10 mm @page margin. The preview sheet uses the same figures, so its
  // width is the printed width and its page lines fall where the print's pages end.
  const PAGE = { wMm: 210, hMm: 297, marginMm: 10 };
  const mm = v => Math.round(v * PX_PER_MM * 100) / 100;
  const SHEET_W = mm(PAGE.wMm);                         // 793.7 px
  const CONTENT_H = mm(PAGE.hMm - 2 * PAGE.marginMm);   // one page of content, px
  const STAGE_GUTTER = 32;                              // grey either side of the sheet

  const escAttr = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

  // The report rules are the ones the page used to keep under @media print for
  // #printReport; color-adjust:exact so the letterhead band and the header cells
  // print as the preview shows them instead of depending on a print setting.
  const REPORT_CSS =
    '#printReport{display:block;padding:24px;font-family:var(--rp-font);color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '#printReport h1{font-size:20px;margin:0 0 4px}' +
    '#printReport h3{margin:16px 0 8px}' +
    '#printReport .muted{color:#555;font-size:12px;margin-bottom:16px}' +
    '#printReport table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}' +
    '#printReport th,#printReport td{border:1px solid #ccc;padding:5px 8px;text-align:left}' +
    '#printReport th{background:#f3f3f3}' +
    '#printReport img{max-width:48%;border:1px solid #ccc;margin:4px}' +
    '#printReport .pr-band{height:6px;margin:-24px -24px 12px}' +
    '#printReport .pr-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}' +
    '#printReport img.pr-logo{max-width:150px;max-height:44px;width:auto;border:0;margin:0;object-fit:contain}' +
    '#printReport .pr-id{flex:1;min-width:0}' +
    '#printReport .pr-name{font-weight:700;font-size:15px}' +
    '#printReport .pr-detail{font-size:11px;color:#555;margin-top:2px}' +
    '#printReport .pr-contact{font-size:11px;color:#555;text-align:right;flex-shrink:0}' +
    '#printReport .pr-foot{font-size:10px;color:#666;border-top:1px solid #ccc;padding-top:6px;margin-top:14px}';

  // o: { fontsHref, fontFamily, lang, title }. reportHtml is buildReport()'s output,
  // already escaped by it.
  function printDocHtml(reportHtml, o) {
    o = o || {};
    const font = o.fontFamily || "'IBM Plex Sans','Red Hat Text','Liberation Sans',system-ui,sans-serif";
    return '<!doctype html><html lang="' + escAttr(o.lang || 'en') + '"><head><meta charset="utf-8">' +
      '<title>' + escAttr(o.title || '') + '</title>' +
      (o.fontsHref ? '<link rel="stylesheet" href="' + escAttr(o.fontsHref) + '">' : '') +
      '<style>' +
      ':root{--rp-font:' + font.replace(/[<>{};]/g, '') + '}' +
      '@page{size:A4;margin:' + PAGE.marginMm + 'mm}' +
      'html,body{margin:0;background:#fff;color:#000}' +
      REPORT_CSS +
      '@media screen{' +
        'html{background:#d6d8dc}' +
        'body{box-sizing:border-box;width:' + SHEET_W + 'px;min-height:' + mm(PAGE.hMm) + 'px;padding:' + mm(PAGE.marginMm) + 'px;margin:16px auto 24px;position:relative;box-shadow:0 1px 6px rgba(0,0,0,.28)}' +
        '.rp-break{position:absolute;left:0;right:0;height:0;border-top:1.5px dashed #9aa0a8;pointer-events:none}' +
        ".rp-break span{position:absolute;left:8px;top:3px;font:10px 'IBM Plex Mono',monospace;color:#6b7280}" +
      '}' +
      '@media print{.rp-break{display:none}}' +
      '</style></head><body><div id="printReport">' + (reportHtml || '') + '</div></body></html>';
  }

  // The sheet plus its grey gutter, in px: below this stage width the frame is scaled.
  const PAGE_PX = SHEET_W + STAGE_GUTTER;
  function fitScale(stageWidth, pagePx) {
    const p = pagePx || PAGE_PX;
    if (!(stageWidth > 0) || stageWidth >= p) return 1;
    return stageWidth / p;
  }

  // Offsets (px, from the top of the content box) where pages 2..n begin, and the page
  // count, for content of the given height laid out at the sheet's width.
  function pageBreaks(contentHeight, pageHeight) {
    const ph = pageHeight || CONTENT_H;
    const h = Math.max(0, +contentHeight || 0);
    const pages = Math.max(1, Math.ceil((h - 0.5) / ph));
    const breaks = [];
    for (let i = 1; i < pages; i++) breaks.push(Math.round(i * ph));
    return { pages, breaks };
  }

  async function pdfPageCount(bytes, PDFLib) {
    if (!PDFLib || !PDFLib.PDFDocument || !bytes) return 0;
    try {
      const d = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      return d.getPageCount();
    } catch (e) { return 0; }
  }

  // Stage contents for a PDF: the produced bytes in the browser's own viewer, or, where
  // the browser has none (navigator.pdfViewerEnabled === false), a plain note saying so.
  function pdfStageHtml(url, o) {
    o = o || {};
    if (o.viewer === false) return '<div class="ep-loading">' + escAttr(o.noViewerText || '') + '</div>';
    return '<iframe title="' + escAttr(o.title || '') + '" src="' + escAttr(url) + '#toolbar=0&navpanes=0&view=Fit"></iframe>';
  }

  return { PAGE, PX_PER_MM, SHEET_W, CONTENT_H, PAGE_PX, printDocHtml, fitScale, pageBreaks, pdfPageCount, pdfStageHtml };
});
