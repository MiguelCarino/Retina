/* ============================================================
   retina-aviso.js — Carino Retina: "Aviso de privacidad integral"
   template text for clinics in Mexico.
   ------------------------------------------------------------
   The CLINIC is the data controller ("responsable"): it collects its
   patients' data, keeps the clinical record and issues this notice.
   Retina runs on the clinic's own computers and its maker receives
   nothing, so the software maker is never named as a party here.

   This file is DATA, not layout: sections(brand, opts) returns the
   notice as headings, paragraphs, list items, tick boxes and signature
   lines, and generateAvisoPdf() in index.html draws them through the
   shared PDF shell. It is Spanish-only by design (a Mexican legal
   document is not translated), so it holds Spanish literals and calls
   no translator — tools/i18n-check.js fails the build if a retina-*.js
   file ever does. Any brand value that is missing prints as
   "[COMPLETAR: …]" so a blank can never pass for a finished notice.

   It is a TEMPLATE. Every page carries "Plantilla — revise con su asesor
   legal antes de usarla"; nothing here is legal advice.

   ---- Legal source (verified 2026-10-12) -------------------------------
   Ley Federal de Protección de Datos Personales en Posesión de los
   Particulares (LFPDPPP), new law published in the DOF on 20-03-2025
   (Decree, Artículo Tercero), in force the next day (Transitorio
   Primero); it abrogates the LFPDPPP of 05-07-2010 (Transitorio
   Segundo, fr. I). Text read: Cámara de Diputados, "TEXTO VIGENTE,
   Última reforma publicada DOF 14-11-2025"
   (https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf, 24 pp.,
   sha256 04d67464e1efc0472040e2ff8012ced52c73ff4fc3573c8e2d3477fd976359c6).
   The 14-11-2025 reform only changes art. 4 (supplementary procedural
   law). Article numbers below are from THAT text; the 2010 numbering
   (e.g. old art. 16 for the notice contents) is NOT used.

     art. 2 fr. VI    sensitive data include "estado de salud presente o
                      futuro"
     art. 2 fr. VIII  "días" means business days (días hábiles)
     art. 2 fr. XII   persona encargada (processes on the controller's
                      behalf) — fr. XX: a communication to an encargada
                      is not a "transferencia"
     art. 2 fr. XV    the authority is the Secretaría Anticorrupción y
                      Buen Gobierno (INAI no longer exists)
     art. 7           consent express or tacit; revocable at any time,
                      without retroactive effect; the notice must state
                      the mechanism to revoke it
     art. 8           sensitive data need EXPRESS AND WRITTEN consent, by
                      autograph or electronic signature or another
                      authentication mechanism
     art. 15          minimum contents of the notice:
                      I   identity and address of the controller
                      II  data processed, identifying the sensitive ones
                      III purposes, distinguishing those that need consent
                      IV  options and means to limit use or disclosure
                      V   mechanisms, means and procedures for ARCO rights
                      VI  how changes to the notice are communicated
     art. 16          when data are collected in person on paper, the
                      notice is given at that moment
     art. 25 fr. II, VII  no obligation to cancel data that must be kept
                      by law or that are processed for medical care by a
                      professional bound by secrecy
     art. 28          contents of an ARCO request (fr. I–V)
     art. 29          the controller designates a person or department
                      for data-protection requests
     art. 31          answer within 20 days; if granted, effective within
                      15 days; each extendable once by an equal period
     art. 34          ARCO is free; only reproduction/copy/shipping costs
     art. 35          a transfer clause where the patient accepts or not
     art. 36 fr. I, II, V  transfers without consent: required by law;
                      necessary for diagnosis, health care, treatment;
                      public interest / administration of justice
     art. 40          the protection-of-rights procedure before the
                      Secretaría

   Clinical-record retention: NOM-004-SSA3-2012, "Del expediente
   clínico" (DOF 15-10-2012), numeral 5.4 — at least five years from the
   last medical act. Its continued validity was checked only against
   secondary sources (no replacement norm found); the banner already asks
   for a legal review.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetinaAviso = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BANNER = 'Plantilla — revise con su asesor legal antes de usarla';
  const s = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  // A missing value is printed as a visible blank to fill, never left empty: an
  // empty "domicilio" reads as a finished notice with nothing to say.
  const fill = (v, what) => s(v) || '[COMPLETAR: ' + what + ']';

  // Block shapes the renderer understands:
  //   {p:'text'}                a paragraph
  //   {li:['…','…']}            a bulleted list
  //   {check:'text'}            a tick box (drawn as a box, not a glyph)
  //   {sign:['Nombre','Firma','Fecha']}  signature lines
  function sections(brand, opts) {
    const b = brand || {}, o = opts || {};
    const legal = s(b.legalName), trade = s(b.practiceName);
    const who = legal || trade || '[COMPLETAR: nombre o razón social del responsable]';
    const addr = fill(b.address, 'domicilio completo del responsable');
    const mail = s(b.privacyEmail) || s(b.email);
    const mailTxt = mail || '[COMPLETAR: correo electrónico para datos personales]';
    const contact = fill(b.privacyContact, 'persona o departamento de datos personales');
    const phone = s(b.phone);
    const arco = s(b.arcoMeans) ||
      ('por correo electrónico a ' + mailTxt + ' o mediante escrito entregado en ' + addr +
       ' [COMPLETAR: confirme o sustituya estos medios]');
    const web = s(b.website);

    const out = [];
    out.push({ h: 'I. Identidad y domicilio del responsable', blocks: [
      { p: who + (legal && trade && trade !== legal ? ' (nombre comercial: ' + trade + ')' : '') +
           ', con domicilio en ' + addr + ', es responsable del tratamiento de sus datos personales.' },
      { p: 'Para cualquier asunto relacionado con sus datos personales puede dirigirse a ' + contact +
           ', al correo ' + mailTxt + (phone ? ' o al teléfono ' + phone : '') + '.' }
    ] });
    out.push({ h: 'II. Datos personales que tratamos', blocks: [
      { p: 'Datos de identificación y de contacto: nombre, fecha de nacimiento, domicilio, teléfono y correo electrónico. ' +
           '[COMPLETAR: ajuste esta lista a los datos que realmente recaba.]' },
      { p: 'Datos personales sensibles: datos sobre su estado de salud, en particular:' },
      { li: ['agudeza visual, refracción y graduación;', 'presión intraocular (PIO) y paquimetría;',
             'imágenes oculares (fotografías de fondo de ojo y del segmento anterior) y las marcas y mediciones hechas sobre ellas;',
             'observaciones clínicas, motivo de consulta y antecedentes que usted nos comparta.'] },
      { p: 'Datos fiscales, solo cuando usted solicite una factura (nombre o razón social, RFC, régimen fiscal y código postal).' }
    ] });
    out.push({ h: 'III. Finalidades del tratamiento', blocks: [
      { p: 'Finalidades primarias, necesarias para la atención que usted solicita:' },
      { li: ['prestarle los servicios de examen visual y optométrico que solicita [COMPLETAR: ajuste a los servicios de su consultorio];',
             'integrar y conservar su expediente clínico conforme a la NOM-004-SSA3-2012, Del expediente clínico;',
             'elaborar sus recetas de anteojos o lentes de contacto y las órdenes de trabajo para el laboratorio óptico;',
             'elaborar cartas de referencia cuando se le refiera a otro profesional de la salud;',
             'contactarle para dar seguimiento a su atención y recordarle sus citas;',
             'facturar y cobrar los servicios prestados.'] },
      { p: 'Finalidades secundarias, que no son necesarias para la atención y requieren su consentimiento: ' +
           '[COMPLETAR: por ejemplo, envío de promociones u ofertas, o encuestas de satisfacción. Si no realiza ninguna, elimine este párrafo y la casilla siguiente.]' },
      { check: 'No consiento que mis datos personales se traten para las finalidades secundarias.' },
      { p: 'Su negativa a las finalidades secundarias no será motivo para negarle los servicios que solicita. ' +
           'Puede manifestarla en cualquier momento por los medios del apartado VI.' }
    ] });
    out.push({ h: 'IV. Consentimiento expreso y por escrito para datos sensibles', blocks: [
      { p: 'Para tratar sus datos personales sensibles requerimos su consentimiento expreso y por escrito, mediante su firma autógrafa, ' +
           'firma electrónica o cualquier mecanismo de autenticación que al efecto se establezca (artículo 8 de la Ley).' },
      { p: 'Consiento que mis datos personales sensibles sean tratados conforme a los términos del presente aviso de privacidad.' },
      { sign: ['Nombre de la persona titular', 'Firma', 'Fecha'] },
      { p: 'Si la persona titular es menor de edad o no puede otorgar su consentimiento, firma su madre, padre, tutor o representante legal, indicando su nombre.' }
    ] });
    out.push({ h: 'V. Transferencias de datos', blocks: [
      { p: 'Sus datos podrán transferirse sin requerir su consentimiento a:' },
      { li: ['médicos, clínicas y hospitales a los que se le refiera, cuando sea necesario para la prevención o el diagnóstico médico, la asistencia sanitaria o el tratamiento médico (artículo 36, fracción II);',
             'autoridades competentes, cuando lo exija una ley o lo requiera la salvaguarda de un interés público o la procuración o administración de justicia (artículo 36, fracciones I y V).'] },
      { p: 'Transferencias que requieren su consentimiento: [COMPLETAR: por ejemplo, a una aseguradora. Si no realiza ninguna, indíquelo y elimine las casillas siguientes.]' },
      { check: 'Acepto la transferencia de mis datos para los fines señalados en el párrafo anterior.' },
      { check: 'No acepto la transferencia de mis datos para los fines señalados en el párrafo anterior.' },
      { p: 'El laboratorio óptico que fabrica sus lentes y los proveedores que nos prestan servicios tratan sus datos por cuenta nuestra, ' +
           'como personas encargadas; esto no constituye una transferencia (artículo 2, fracciones XII y XX).' },
      { p: 'El software opera localmente en nuestros equipos; el proveedor del software no recibe datos.' }
    ] });
    out.push({ h: 'VI. Limitación del uso o divulgación, derechos ARCO y revocación del consentimiento', blocks: [
      { p: 'Usted tiene derecho a acceder a sus datos personales, a rectificarlos si son inexactos o incompletos, a cancelarlos y a oponerse a su tratamiento ' +
           '(derechos ARCO); también puede limitar su uso o divulgación y revocar el consentimiento que nos haya otorgado. ' +
           'Atiende estas solicitudes: ' + contact + '.' },
      { p: 'Medios para presentar su solicitud: ' + arco },
      { p: 'Su solicitud debe contener (artículo 28 de la Ley):' },
      { li: ['su nombre y un domicilio u otro medio para recibir la respuesta;',
             'los documentos que acrediten su identidad o, en su caso, la identidad y personalidad de su representante;',
             'la descripción clara y precisa de los datos respecto de los que busca ejercer el derecho, salvo que se trate del derecho de acceso;',
             'el derecho que desea ejercer o lo que solicita;',
             'cualquier otro elemento que facilite la localización de sus datos.'] },
      { p: 'Le comunicaremos la determinación adoptada en un plazo máximo de veinte días hábiles contados desde que recibamos su solicitud; ' +
           'si resulta procedente, se hará efectiva dentro de los quince días hábiles siguientes. Estos plazos podrán ampliarse una sola vez ' +
           'por un periodo igual cuando las circunstancias lo justifiquen (artículo 31).' },
      { p: 'El ejercicio de los derechos ARCO es gratuito; solo podrán cobrarse los costos de reproducción, copias o envío (artículo 34).' },
      { p: 'La revocación del consentimiento no tiene efectos retroactivos (artículo 7). No procede cancelar los datos que debamos conservar ' +
           'por disposición legal: el expediente clínico se conserva por un periodo mínimo de cinco años contados a partir de la fecha del ' +
           'último acto médico (NOM-004-SSA3-2012; artículo 25 de la Ley).' },
      { p: 'Si considera que su derecho a la protección de sus datos personales ha sido vulnerado, puede presentar una solicitud de protección ' +
           'de derechos ante la Secretaría Anticorrupción y Buen Gobierno (artículos 2, fracción XV, y 40 de la Ley).' }
    ] });
    out.push({ h: 'VII. Cambios al aviso de privacidad', blocks: [
      { p: 'Cualquier modificación a este aviso de privacidad se le dará a conocer ' +
           (web ? 'en ' + web + ' y ' : '') + 'mediante un aviso visible en nuestras instalaciones. ' +
           '[COMPLETAR: confirme o ajuste los medios.]' }
    ] });
    out.push({ h: 'VIII. Uso de tecnologías de rastreo', blocks: [
      { p: 'No utilizamos cookies, web beacons ni otras tecnologías de rastreo para obtener sus datos personales. ' +
           '[COMPLETAR: si su sitio web las utiliza, descríbalas aquí.]' }
    ] });
    out.push({ h: 'IX. Fecha de última actualización', blocks: [
      { p: '[COMPLETAR: fecha de la versión revisada]' + (o.generated ? ' — plantilla generada el ' + o.generated + '.' : '') }
    ] });

    return {
      title: 'Aviso de privacidad integral',
      banner: BANNER,
      bannerBody: 'Modelo generado a partir de los datos de su consultorio; no constituye asesoría jurídica. ' +
        'Complete los campos marcados [COMPLETAR: …], ajuste las finalidades y transferencias a su práctica ' +
        'y hágalo revisar por su asesor legal antes de entregarlo a sus pacientes.',
      intro: 'En cumplimiento de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares ' +
        '(DOF 20-03-2025) y de su artículo 15, ' + who + ' pone a su disposición el presente aviso de privacidad integral.',
      responsible: who,
      sections: out
    };
  }

  return { sections, BANNER };
});
