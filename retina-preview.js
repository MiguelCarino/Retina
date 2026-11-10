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
   - pdfRecorder() / pdfTwinHtml(): the HTML version of every document
     drawn with pdf-lib, written from the same draw calls as its PDF
     (the PDF | HTML switch of the preview, carino-pdf.js).

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

  // ---------- The HTML version of a drawn PDF ----------
  // The Study PDF, the prescription, the lens order, the referral and the privacy notice
  // are drawn with pdf-lib, vector text in embedded fonts. Their HTML version is not a
  // second layout that could drift: pdfRecorder(doc) watches the very draw calls that make
  // the PDF (text, rules, boxes, dots, pictures, page by page) and pdfTwinHtml() writes
  // them out again as one SVG per page, so the HTML has the PDF's pages, positions,
  // breaks, letterhead and footers. Each text run keeps the width the PDF's font gave it
  // (textLength), so the layout holds even where the reader's font differs. The text is
  // real text: it can be searched and copied.
  //
  // pdfRecorder(doc): wraps doc.addPage / embedPng / embedJpg / setTitle before any
  //   drawing. rec.bold(font) names the bold face; rec.lang is the document's language.
  // pdfTwinHtml(rec, o): o { head: extra <head> markup (the fonts), fontFamily }.
  const rgbHex = c => {
    if (!c || typeof c.red !== 'number') return '#000000';
    const h = v => ('0' + Math.max(0, Math.min(255, Math.round(v * 255))).toString(16)).slice(-2);
    return '#' + h(c.red) + h(c.green) + h(c.blue);
  };
  const num = v => String(Math.round((+v || 0) * 100) / 100);

  function pdfRecorder(doc) {
    const rec = { pages: [], title: '', lang: 'en', bolds: [], images: new Map() };
    rec.bold = f => { if (f) rec.bolds.push(f); };
    const wrapEmbed = (name, mime) => {
      const orig = doc[name] && doc[name].bind(doc);
      if (!orig) return;
      doc[name] = async (bytes, ...rest) => {
        const img = await orig(bytes, ...rest);
        if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) rec.images.set(img, { mime, bytes: new Uint8Array(bytes) });
        return img;
      };
    };
    wrapEmbed('embedPng', 'image/png');
    wrapEmbed('embedJpg', 'image/jpeg');
    const setTitle = doc.setTitle && doc.setTitle.bind(doc);
    if (setTitle) doc.setTitle = (v, ...rest) => { rec.title = String(v == null ? '' : v); return setTitle(v, ...rest); };
    const addPage = doc.addPage.bind(doc);
    doc.addPage = (...args) => {
      const page = addPage(...args);
      const size = page.getSize();
      const pg = { w: size.width, h: size.height, ops: [] };
      rec.pages.push(pg);
      const hook = (name, fn) => {
        const orig = page[name].bind(page);
        page[name] = (...a) => { try { fn(...a); } catch (e) { /* the PDF still draws */ } return orig(...a); };
      };
      hook('drawText', (text, o) => {
        o = o || {};
        const size2 = o.size || 24, str = String(text == null ? '' : text);
        let width = 0;
        try { width = o.font ? o.font.widthOfTextAtSize(str, size2) : 0; } catch (e) { width = 0; }
        pg.ops.push({ t: 'text', x: o.x || 0, y: o.y || 0, size: size2, bold: rec.bolds.indexOf(o.font) >= 0,
          color: rgbHex(o.color), text: str, width });
      });
      hook('drawLine', o => {
        pg.ops.push({ t: 'line', x1: o.start.x, y1: o.start.y, x2: o.end.x, y2: o.end.y,
          th: o.thickness == null ? 1 : o.thickness, color: rgbHex(o.color) });
      });
      hook('drawRectangle', o => {
        const fill = ('color' in o) ? (o.color ? rgbHex(o.color) : null) : (('borderColor' in o) ? null : '#000000');
        pg.ops.push({ t: 'rect', x: o.x || 0, y: o.y || 0, w: o.width || 0, h: o.height || 0, fill,
          stroke: o.borderColor ? rgbHex(o.borderColor) : null, bw: o.borderWidth || 0 });
      });
      hook('drawCircle', o => {
        const fill = ('color' in o) ? (o.color ? rgbHex(o.color) : null) : (('borderColor' in o) ? null : '#000000');
        pg.ops.push({ t: 'circle', x: o.x || 0, y: o.y || 0, r: o.size == null ? 100 : o.size, fill,
          stroke: o.borderColor ? rgbHex(o.borderColor) : null, bw: o.borderWidth || 0 });
      });
      hook('drawImage', (img, o) => {
        o = o || {};
        const src = rec.images.get(img);
        if (!src) return;
        pg.ops.push({ t: 'image', x: o.x || 0, y: o.y || 0, w: o.width != null ? o.width : img.width, h: o.height != null ? o.height : img.height, src });
      });
      return page;
    };
    return rec;
  }

  function b64(bytes) {
    if (typeof Buffer !== 'undefined' && typeof btoa === 'undefined') return Buffer.from(bytes).toString('base64');
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const escText = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

  function pdfTwinHtml(rec, o) {
    o = o || {};
    const pages = rec.pages.length ? rec.pages : [{ w: 595.28, h: 841.89, ops: [] }];
    const W = pages[0].w, H = pages[0].h;
    const font = String(o.fontFamily || "'IBM Plex Sans',sans-serif").replace(/[<>{};]/g, '');
    const dataUrls = new Map();
    const dataUrl = src => {
      if (!dataUrls.has(src)) dataUrls.set(src, 'data:' + src.mime + ';base64,' + b64(src.bytes));
      return dataUrls.get(src);
    };
    const svg = pages.map((pg, i) => {
      const y = v => num(pg.h - v);
      const body = pg.ops.map(op => {
        switch (op.t) {
          case 'text': {
            if (!op.text) return '';
            const fit = op.width > 0 && /\S/.test(op.text) ? ' textLength="' + num(op.width) + '" lengthAdjust="spacingAndGlyphs"' : '';
            return '<text x="' + num(op.x) + '" y="' + y(op.y) + '" font-size="' + num(op.size) + '"' +
              (op.bold ? ' font-weight="700"' : '') + ' fill="' + op.color + '"' + fit + '>' + escText(op.text) + '</text>';
          }
          case 'line':
            return '<line x1="' + num(op.x1) + '" y1="' + y(op.y1) + '" x2="' + num(op.x2) + '" y2="' + y(op.y2) +
              '" stroke="' + op.color + '" stroke-width="' + num(op.th) + '"/>';
          case 'rect':
            return '<rect x="' + num(op.x) + '" y="' + y(op.y + op.h) + '" width="' + num(op.w) + '" height="' + num(op.h) +
              '" fill="' + (op.fill || 'none') + '"' + (op.stroke && op.bw > 0 ? ' stroke="' + op.stroke + '" stroke-width="' + num(op.bw) + '"' : '') + '/>';
          case 'circle':
            return '<circle cx="' + num(op.x) + '" cy="' + y(op.y) + '" r="' + num(op.r) + '" fill="' + (op.fill || 'none') + '"' +
              (op.stroke && op.bw > 0 ? ' stroke="' + op.stroke + '" stroke-width="' + num(op.bw) + '"' : '') + '/>';
          case 'image':
            return '<image x="' + num(op.x) + '" y="' + y(op.y + op.h) + '" width="' + num(op.w) + '" height="' + num(op.h) +
              '" preserveAspectRatio="none" href="' + dataUrl(op.src) + '"/>';
          default: return '';
        }
      }).join('');
      return '<svg class="pg" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" viewBox="0 0 ' + num(pg.w) + ' ' + num(pg.h) +
        '" width="' + num(pg.w) + 'pt" height="' + num(pg.h) + 'pt" aria-label="' + escAttr((o.pageLabel || 'Page {n}').replace('{n}', i + 1)) + '">' +
        body + '</svg>';
    }).join('\n');
    return '<!doctype html><html lang="' + escAttr(rec.lang || 'en') + '"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escAttr(rec.title || '') + '</title>' + (o.head || '') +
      '<style>' +
      '@page{size:' + num(W) + 'pt ' + num(H) + 'pt;margin:0}' +
      'html{background:#d6d8dc;color:#000}' +
      'body{margin:0;padding:16px 8px}' +
      '.pg{display:block;width:' + num(W) + 'pt;max-width:100%;height:auto;margin:0 auto 16px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.28)}' +
      '.pg text{font-family:' + font + ';white-space:pre}' +
      '@media print{html{background:#fff}body{padding:0}.pg{width:' + num(W) + 'pt;max-width:none;margin:0;box-shadow:none;break-after:page}.pg:last-child{break-after:auto}}' +
      '</style></head><body>\n' + svg + '\n</body></html>';
  }

  return { PAGE, PX_PER_MM, SHEET_W, CONTENT_H, PAGE_PX, printDocHtml, fitScale, pageBreaks, pdfPageCount, pdfStageHtml, pdfRecorder, pdfTwinHtml };
});
