/* ============================================================
   i18n.js — Carino Retina dictionaries (fleet convention).
   ------------------------------------------------------------
   English source strings ARE the keys; a missing entry falls
   back to English. Locales: es, pt-BR, ja, ru.

   Self-contained IIFE: no imports, no network, no storage of
   its own. It exposes window.I18N (dictionaries), window.t(str)
   and window.applyStaticI18n().

   The language PREFERENCE is owned by carino-lang.js (AUTO
   button: ?lang > .carino.systems cookie > browser > en). This
   file owns the dictionaries and reacts to 'carino:langchange'.
   Two appliers run side by side, on disjoint elements:
     - applyStaticI18n() below — fleet-convention [data-i18n]
       pure-text leaves;
     - the app's inline applier in index.html (selector-based,
       also handles title attributes, <option>s, [data-i18n-html]
       blocks and JS-generated strings) — it reads window.I18N.
   ============================================================ */

(function () {
  'use strict';

const I18N = {
    es:{
      'Late shift.': 'Turno nocturno.',
      'Good morning.': 'Buenos días.',
      'Good afternoon.': 'Buenas tardes.',
      'Good evening.': 'Buenas noches.',
      // header / tabs
      'Imaging':'Imagen','Refraction':'Refracción','Dispensing':'Óptica','Exam':'Examen',
      // section headers
      'Patient / encounter':'Paciente / consulta','Disc analysis':'Análisis del disco óptico',
      'Findings':'Hallazgos','Refraction —':'Refracción —',
      'Dispensing & optics':'Óptica y montaje','Export':'Exportar',
      // subheads
      'Visual acuity':'Agudeza visual','Autorefraction / retinoscopy':'Autorrefracción / retinoscopía',
      'Subjective — final Rx':'Subjetivo — Rx final','Keratometry':'Queratometría',
      'Pressures & anterior segment':'Presiones y segmento anterior','Interpupillary distance':'Distancia interpupilar',
      'Monocular PD':'DIP monocular','PD from photo':'DIP desde foto','Prism':'Prisma','Lens':'Lente',
      'Frame':'Montura','Fitting':'Ajuste','Contact lens':'Lente de contacto',
      // labels
      'Patient ID':'ID del paciente','Exam date':'Fecha de examen','Name / initials':'Nombre / iniciales',
      'Date of birth':'Fecha de nacimiento','Provider / clinic':'Profesional / clínica','Chief complaint / reason':'Motivo de consulta',
      'Near':'Cerca','Add':'Adición',
      'Axis':'Eje','IOP (mmHg)':'PIO (mmHg)','Lens status':'Estado del cristalino',
      'Diagnosis / impression':'Diagnóstico / impresión','Notes':'Notas','PD distance':'DIP lejos','PD near':'DIP cerca',
      'Mono near':'Mono cerca','Reference width (mm)':'Ancho de referencia (mm)',
      'Base':'Base','Lens type':'Tipo de lente','Material':'Material','Tint':'Tinte','Coatings / options':'Tratamientos / opciones',
      'A (eye)':'A (aro)','B (vert)':'B (vert)','DBL':'DBL','ED':'ED',
      'Panto (°)':'Pantoscópico (°)','Vertex (mm)':'Vértice (mm)','Wrap (°)':'Envolvente (°)',
      'Power':'Potencia','Disc Ø':'Ø disco',
      // metrics
      'Vertical CDR':'E/D vertical','Horizontal CDR':'E/D horizontal','Disc diameter':'Diámetro del disco',
      'Disc area':'Área del disco','Disc → fovea':'Disco → fóvea',
      // legend / concepts
      'Fovea center':'Centro de la fóvea',
      'Measurement':'Medición',
      // buttons
      'Study PDF':'PDF del estudio','Spectacle Rx':'Receta óptica','Lens order':'Pedido de lentes',
      'Load image':'Cargar imagen','Sample':'Ejemplo','Open JSON':'Abrir JSON',
      'Print report':'Imprimir informe',"Clear this eye's marks":'Borrar marcas de este ojo','Load image…':'Cargar imagen…',
      'Load sample fundus':'Cargar fondo de ejemplo',
      // eye switch / mini / states
      'OD · Right':'OD · Derecho','OS · Left':'OS · Izquierdo',
      'Selected ruler = reference width':'Regla seleccionada = ancho de referencia','Selected ruler → PD distance':'Regla seleccionada → DIP lejos',
      'No photo scale set':'Sin escala de foto','No image loaded':'Sin imagen cargada',
      // tool titles
      'Select / move (V)':'Seleccionar / mover (V)','Pan / hand (H)':'Desplazar / mano (H)','Optic disc center (1)':'Centro del disco óptico (1)',
      'Fovea center (2)':'Centro de la fóvea (2)','Optic disc margin (3)':'Borde del disco óptico (3)','Optic cup margin (4)':'Borde de la excavación (4)',
      'Lesion / finding pin (5)':'Marca de lesión / hallazgo (5)','Measure distance (6)':'Medir distancia (6)',
      'Arrow / pointer (7)':'Flecha / puntero (7)','Text label (8)':'Etiqueta de texto (8)','Freehand outline (9)':'Contorno a mano alzada (9)',
      'Lesion type for the pin tool':'Tipo de lesión para la herramienta','Zoom in':'Acercar','Zoom out':'Alejar','Fit to view':'Ajustar a la vista',
      // select options
      'Phakic':'Fáquico','Pseudophakic':'Pseudofáquico','Aphakic':'Afáquico',
      'Single vision':'Monofocal','Bifocal':'Bifocal','Trifocal':'Trifocal','Progressive':'Progresivo','Office / occupational':'Ocupacional',
      'Polycarbonate':'Policarbonato','Hi-index 1.60':'Alto índice 1.60','Hi-index 1.67':'Alto índice 1.67','Hi-index 1.74':'Alto índice 1.74',
      'Base up':'Base superior','Base down':'Base inferior','Base in':'Base nasal','Base out':'Base temporal',
      'Microaneurysm':'Microaneurisma','Dot/blot hemorrhage':'Hemorragia puntiforme / en mancha','Flame hemorrhage':'Hemorragia en llama',
      'Hard exudate':'Exudado duro','Cotton-wool spot':'Mancha algodonosa','Drusen':'Drusas',
      'Neovascularization (NVD/NVE)':'Neovascularización (NVD/NVE)','Laser scar':'Cicatriz de láser',
      'Pigment / RPE change':'Cambio de pigmento / EPR','Aneurysm':'Aneurisma','Other finding':'Otro hallazgo',
      // dynamic
      'Optic disc center':'Centro del disco óptico','Optic disc margin':'Borde del disco óptico','Optic cup margin':'Borde de la excavación',
      'No marks yet.':'Sin marcas todavía.','Lesion':'Lesión','point':'punto','lesion pin':'marca de lesión',
      'right eye (OD)':'ojo derecho (OD)','left eye (OS)':'ojo izquierdo (OS)',
      // compact exam-grid headers & hints
      'both eyes':'ambos ojos','Dist UC':'Lejos SC','Dist CC':'Lejos CC','Dominant eye':'Ojo dominante',
      'IOP':'PIO','Pachy':'Paquim.','Impression':'Impresión','shared':'compartidas',
      'binocular, mm':'binocular, mm','binocular':'binocular','Mono dist':'Mono lejos',
      'optional · estimate only':'opcional · solo estimación','Amount Δ':'Cantidad Δ',
      'boxing system, mm':'sistema boxing, mm','Seg ht':'Altura seg','OC ht':'Altura CO',
      'Brand':'Marca',
      // tests & settings
      'Tests':'Pruebas','Eye exam tests':'Pruebas oculares','Back to tests':'Volver a las pruebas',
      'Presenting':'Presentando','Shuffle':'Mezclar','Prev':'Ant.','Next':'Sig.','Mirror':'Espejo','Close':'Cerrar','Rows':'Filas',
      'Settings':'Ajustes','Test display':'Pantalla de prueba','Same screen':'Misma pantalla','Second monitor':'Segundo monitor','Ask each time':'Preguntar','Detect monitors':'Detectar monitores',
      'Distance':'Distancia','Unit':'Unidad','85.6 mm card':'Tarjeta 85,6 mm','Display density':'Densidad de pantalla','Mirror chart':'Optotipo en espejo','Off':'No','On (mirrored room)':'Sí (sala con espejo)','Save settings':'Guardar ajustes',
      'Snellen letters':'Letras de Snellen','Distance acuity':'Agudeza de lejos','LogMAR (Sloan)':'LogMAR (Sloan)','Letter chart':'Optotipo de letras','Tumbling E':'E giratoria','Illiterate / pediatric':'Iletrados / pediátrico','Landolt C':'Anillo de Landolt','Ring gap':'Abertura del anillo','Duochrome':'Bicromático','Red-green balance':'Equilibrio rojo-verde','Astigmatic dial':'Esfera astigmática','Axis / fan':'Eje / abanico','Amsler grid':'Rejilla de Amsler','Macular / central':'Macular / central','Contrast letters':'Letras de contraste','Low contrast':'Bajo contraste','Color vision':'Visión del color','Screening demo':'Demo de cribado','Fixation target':'Punto de fijación','Central fixation':'Fijación central','Blank — white':'Blanco','White field':'Campo blanco','Blank — black':'Negro','Black field':'Campo negro',
      'Settings saved':'Ajustes guardados','Popup blocked — allow popups for this site':'Ventana bloqueada — permite ventanas emergentes','primary':'principal','secondary':'secundario','Move the chart to the second monitor?':'¿Mover el optotipo al segundo monitor?',
      'Optotype order':'Orden de optotipos','Fixed chart':'Carta fija','Randomize':'Aleatorio','Screen':'Pantalla','Could not move the window — drag it manually':'No se pudo mover la ventana — muévela manualmente',
      '1 eye':'1 ojo','2 eyes':'2 ojos',
      'Annotation':'Anotación','Text label':'Etiqueta de texto','Outline':'Contorno',
      'Lens layout / centration':'Montaje / centrado','from PD, frame & heights':'a partir de DIP, montura y alturas','Enter frame A, B and DBL to see the centration layout.':'Introduce A, B y DBL de la montura para ver el centrado.',
      'Chart screen':'Pantalla de test',
      'Control (main)':'Control (principal)','Tap to assign':'Toca para asignar','Tap: main → chart → none':'Toca: principal → test → ninguno',
      'Screen calibration':'Calibración de pantalla','Patient ↔ screen distance':'Distancia paciente ↔ pantalla',
      'Charts are sized for a real viewing distance and physical pixel size, so acuity is accurate. Set both:':'Los optotipos se dimensionan según la distancia real y el tamaño físico del píxel, para una agudeza correcta. Configura ambos:',
      "Hold a standard card (credit / ID, 85.6 mm wide) against the box and drag the slider until it matches the card's width.":'Coloca una tarjeta estándar (crédito / ID, 85,6 mm) sobre el recuadro y ajusta el control hasta que coincida con su ancho.',
      'Export ↗':'Exportar ↗','Export & data':'Exportar y datos','Building preview…':'Generando vista previa…','Preview unavailable':'Vista previa no disponible','Download PDF':'Descargar PDF','Download DICOM':'Descargar DICOM','Annotated PNG':'PNG anotado','Study JSON':'JSON del estudio','Print':'Imprimir',
      'Camera':'Cámara','Camera device':'Dispositivo de cámara','Capture':'Capturar','Refresh devices':'Actualizar dispositivos','Take photo…':'Tomar foto…','No image':'Sin imagen',
      "Pick your webcam or a connected fundus / slit-lamp camera. The captured frame becomes the current eye's image.":'Elige tu webcam o una cámara de fondo / lámpara de hendidura conectada. La imagen capturada se asigna al ojo actual.',
      'Camera not available in this browser / context':'Cámara no disponible en este navegador / contexto','Camera access denied or unavailable':'Acceso a la cámara denegado o no disponible','Camera not ready':'La cámara no está lista','Photo captured':'Foto capturada','Could not switch camera':'No se pudo cambiar de cámara','Nothing to export yet — add data or an image':'Nada que exportar aún — añade datos o una imagen',
      lensNote:'Cruz dorada = centro óptico / cruz de montaje de cada lente; línea discontinua = línea media y datum de la montura. «dec» es la descentración horizontal desde el centro de la caja, «h» la altura de montaje.',
      'Fixed shows the classic chart letters in their original order; Randomize scrambles them. The Shuffle button re-randomizes any time.':'«Fija» muestra las letras clásicas en su orden original; «Aleatorio» las mezcla. El botón Mezclar vuelve a aleatorizar cuando quieras.',
      testsNote:'Abre el optotipo elegido en otra ventana — colócala en la pantalla del paciente y contrólala desde aquí. Configura la pantalla, la distancia y la calibración de tamaño real en <b>Ajustes</b> (icono de engranaje).',
      monHint:'Colocar un optotipo en un segundo monitor usa el permiso de gestión de ventanas del navegador. Si no se concede, la ventana se abre aquí — arrástrala y pulsa <b>F</b> para pantalla completa.',
      // html blocks
      emptyP:'Arrastra aquí una foto de fondo de ojo o segmento anterior, o cárgala, para marcar el disco, la excavación y la fóvea y obtener la relación excavación/disco automática. ¿Solo quieres refractar o montar lentes? Abre el espacio <b>Examen</b> arriba — no hace falta imagen. Todo permanece en tu navegador; no se sube nada.',
      dispNote1:'Funciona por completo con la <b>Rx final</b> — sin foto. Carga una foto del rostro solo si quieres estimar la DIP a partir de ella.',
      dispNote2:'Carga una foto del rostro con una <b>tarjeta</b> (ID-1, 85,6 mm) junto a la ceja. Traza una <b>regla</b> sobre el lado largo de la tarjeta y luego de pupila a pupila.'
    },
    ja:{
      'Late shift.': '夜勤お疲れさま。',
      'Good morning.': 'おはようございます。',
      'Good afternoon.': 'こんにちは。',
      'Good evening.': 'こんばんは。',
      'Imaging':'画像','Refraction':'屈折検査','Dispensing':'調製','Exam':'検査',
      'Patient / encounter':'患者 / 診察','Disc analysis':'視神経乳頭の解析',
      'Findings':'所見','Refraction —':'屈折 —','Dispensing & optics':'調製と光学','Export':'書き出し',
      'Visual acuity':'視力','Autorefraction / retinoscopy':'オートレフ / 検影法','Subjective — final Rx':'自覚的 — 最終処方',
      'Keratometry':'角膜曲率(ケラト)','Pressures & anterior segment':'眼圧・前眼部','Interpupillary distance':'瞳孔間距離(PD)',
      'Monocular PD':'片眼PD','PD from photo':'写真からPD','Prism':'プリズム','Lens':'レンズ','Frame':'フレーム',
      'Fitting':'フィッティング','Contact lens':'コンタクトレンズ',
      'Patient ID':'患者ID','Exam date':'検査日','Name / initials':'氏名 / イニシャル','Date of birth':'生年月日',
      'Provider / clinic':'担当医 / 施設','Chief complaint / reason':'主訴 / 来院理由',
      'Near':'近見','Add':'加入度(ADD)','Axis':'軸','IOP (mmHg)':'眼圧 (mmHg)',
      'Lens status':'水晶体の状態','Diagnosis / impression':'診断 / 印象','Notes':'メモ','PD distance':'PD 遠用','PD near':'PD 近用',
      'Mono near':'片眼 近用','Reference width (mm)':'基準幅 (mm)','Base':'基底方向',
      'Lens type':'レンズ種類','Material':'素材','Tint':'カラー(染色)','Coatings / options':'コーティング / オプション',
      'A (eye)':'A (玉型)','B (vert)':'B (縦)','DBL':'DBL(鼻幅)','ED':'ED(有効径)',
      'Panto (°)':'前傾角 (°)','Vertex (mm)':'頂点間距離 (mm)','Wrap (°)':'そり角 (°)',
      'Power':'度数','Disc Ø':'乳頭径 Ø',
      'Vertical CDR':'垂直C/D比','Horizontal CDR':'水平C/D比','Disc diameter':'乳頭径','Disc area':'乳頭面積','Disc → fovea':'乳頭→中心窩',
      'Fovea center':'中心窩','Measurement':'計測',
      'Study PDF':'検査PDF','Spectacle Rx':'眼鏡処方','Lens order':'レンズ発注','Load image':'画像を読み込む',
      'Sample':'サンプル','Open JSON':'JSONを開く','Print report':'レポート印刷',
      "Clear this eye's marks":'この眼のマークを消去','Load image…':'画像を読み込む…','Load sample fundus':'サンプル眼底を読み込む',
      'OD · Right':'OD · 右眼','OS · Left':'OS · 左眼',
      'Selected ruler = reference width':'選択した定規 = 基準幅','Selected ruler → PD distance':'選択した定規 → PD遠用',
      'No photo scale set':'写真スケール未設定','No image loaded':'画像がありません',
      'Select / move (V)':'選択 / 移動 (V)','Pan / hand (H)':'移動 / ハンド (H)','Optic disc center (1)':'視神経乳頭中心 (1)',
      'Fovea center (2)':'中心窩 (2)','Optic disc margin (3)':'乳頭辺縁 (3)','Optic cup margin (4)':'陥凹辺縁 (4)',
      'Lesion / finding pin (5)':'病変 / 所見ピン (5)','Measure distance (6)':'距離を計測 (6)',
      'Arrow / pointer (7)':'矢印 / ポインター (7)','Text label (8)':'テキスト (8)','Freehand outline (9)':'フリーハンド輪郭 (9)',
      'Lesion type for the pin tool':'ピンツールの病変種別','Zoom in':'拡大','Zoom out':'縮小','Fit to view':'全体表示',
      'Phakic':'有水晶体眼','Pseudophakic':'偽水晶体眼(IOL)','Aphakic':'無水晶体眼',
      'Single vision':'単焦点','Bifocal':'二重焦点','Trifocal':'三重焦点','Progressive':'累進','Office / occupational':'中近 / オフィス',
      'Polycarbonate':'ポリカーボネート','Hi-index 1.60':'高屈折 1.60','Hi-index 1.67':'高屈折 1.67','Hi-index 1.74':'高屈折 1.74',
      'Base up':'基底上方(BU)','Base down':'基底下方(BD)','Base in':'基底内方(BI)','Base out':'基底外方(BO)',
      'Microaneurysm':'毛細血管瘤','Dot/blot hemorrhage':'点状・斑状出血','Flame hemorrhage':'火炎状出血',
      'Hard exudate':'硬性白斑','Cotton-wool spot':'軟性白斑','Drusen':'ドルーゼン',
      'Neovascularization (NVD/NVE)':'新生血管 (NVD/NVE)','Laser scar':'レーザー瘢痕',
      'Pigment / RPE change':'色素 / RPE変化','Aneurysm':'動脈瘤','Other finding':'その他の所見',
      'Optic disc center':'視神経乳頭中心','Optic disc margin':'乳頭辺縁','Optic cup margin':'陥凹辺縁',
      'No marks yet.':'まだマークがありません。','Lesion':'病変','point':'点','lesion pin':'病変ピン',
      'right eye (OD)':'右眼 (OD)','left eye (OS)':'左眼 (OS)',
      // compact exam-grid headers & hints
      'both eyes':'両眼','Dist UC':'遠見 裸眼','Dist CC':'遠見 矯正','Dominant eye':'優位眼',
      'IOP':'眼圧','Pachy':'角膜厚','Impression':'印象','shared':'共通',
      'binocular, mm':'両眼, mm','binocular':'両眼','Mono dist':'片眼 遠用',
      'optional · estimate only':'任意 · 推定のみ','Amount Δ':'量 Δ',
      'boxing system, mm':'ボクシングシステム, mm','Seg ht':'セグ高','OC ht':'光学中心高',
      'Brand':'ブランド',
      'Tests':'検査表','Eye exam tests':'眼科検査表','Back to tests':'検査に戻る',
      'Presenting':'提示中','Shuffle':'シャッフル','Prev':'前へ','Next':'次へ','Mirror':'反転','Close':'閉じる','Rows':'行',
      'Settings':'設定','Test display':'検査ディスプレイ','Same screen':'同じ画面','Second monitor':'別モニター','Ask each time':'毎回確認','Detect monitors':'モニターを検出',
      'Distance':'距離','Unit':'単位','85.6 mm card':'85.6mm カード','Display density':'画面密度','Mirror chart':'鏡像表示','Off':'オフ','On (mirrored room)':'オン(鏡室)','Save settings':'設定を保存',
      'Snellen letters':'スネレン文字','Distance acuity':'遠見視力','LogMAR (Sloan)':'logMAR(Sloan)','Letter chart':'文字視標','Tumbling E':'E字視標','Illiterate / pediatric':'非識字 / 小児','Landolt C':'ランドルト環','Ring gap':'環の切れ目','Duochrome':'レッドグリーンテスト','Red-green balance':'赤緑バランス','Astigmatic dial':'放射状視標','Axis / fan':'軸 / 扇','Amsler grid':'アムスラーチャート','Macular / central':'黄斑 / 中心','Contrast letters':'コントラスト文字','Low contrast':'低コントラスト','Color vision':'色覚','Screening demo':'スクリーニング例','Fixation target':'固視標','Central fixation':'中心固視','Blank — white':'白画面','White field':'白背景','Blank — black':'黒画面','Black field':'黒背景',
      'Settings saved':'設定を保存しました','Popup blocked — allow popups for this site':'ポップアップがブロックされました — 許可してください','primary':'メイン','secondary':'サブ','Move the chart to the second monitor?':'視標を別モニターに移動しますか？',
      'Optotype order':'視標の順序','Fixed chart':'固定','Randomize':'ランダム','Screen':'画面','Could not move the window — drag it manually':'ウィンドウを移動できませんでした — 手動で移動してください',
      '1 eye':'片眼','2 eyes':'両眼',
      'Annotation':'注釈','Text label':'テキスト','Outline':'輪郭',
      'Lens layout / centration':'レンズレイアウト / 芯出し','from PD, frame & heights':'PD・フレーム・高さから算出','Enter frame A, B and DBL to see the centration layout.':'フレームのA・B・DBLを入力すると芯出し図が表示されます。',
      'Chart screen':'視標画面',
      'Control (main)':'コントロール(メイン)','Tap to assign':'タップで割り当て','Tap: main → chart → none':'タップ: メイン → 視標 → なし',
      'Screen calibration':'画面キャリブレーション','Patient ↔ screen distance':'患者↔画面の距離',
      'Charts are sized for a real viewing distance and physical pixel size, so acuity is accurate. Set both:':'視標は実際の視距離と物理的なピクセルサイズに合わせて表示され、視力が正確になります。両方を設定してください：',
      "Hold a standard card (credit / ID, 85.6 mm wide) against the box and drag the slider until it matches the card's width.":'標準カード(クレジット/ID、85.6mm)を枠に当て、幅が一致するまでスライダーを調整します。',
      'Export ↗':'書き出し ↗','Export & data':'書き出しとデータ','Building preview…':'プレビューを生成中…','Preview unavailable':'プレビューを表示できません','Download PDF':'PDFを保存','Download DICOM':'DICOMを保存','Annotated PNG':'注釈付きPNG','Study JSON':'検査JSON','Print':'印刷',
      'Camera':'カメラ','Camera device':'カメラデバイス','Capture':'撮影','Refresh devices':'デバイス更新','Take photo…':'撮影…','No image':'画像なし',
      "Pick your webcam or a connected fundus / slit-lamp camera. The captured frame becomes the current eye's image.":'ウェブカメラまたは接続した眼底/細隙灯カメラを選択します。撮影した画像が現在の眼の画像になります。',
      'Camera not available in this browser / context':'このブラウザ/環境ではカメラを利用できません','Camera access denied or unavailable':'カメラへのアクセスが拒否されたか利用できません','Camera not ready':'カメラの準備ができていません','Photo captured':'撮影しました','Could not switch camera':'カメラを切り替えられませんでした','Nothing to export yet — add data or an image':'書き出す内容がありません — データまたは画像を追加してください',
      lensNote:'金の十字＝各レンズの光学中心／フィッティングクロス、破線＝フレーム中心線とデータム。「dec」は玉型中心からの水平偏心、「h」はフィッティング高さです。',
      'Fixed shows the classic chart letters in their original order; Randomize scrambles them. The Shuffle button re-randomizes any time.':'「固定」は従来の並び順で文字を表示し、「ランダム」は並びをシャッフルします。シャッフルボタンでいつでも再ランダム化できます。',
      testsNote:'選択した視標を別ウィンドウで開きます — 患者側の画面に置き、ここから操作します。ディスプレイ・距離・実寸キャリブレーションは<b>設定</b>(歯車アイコン)で行います。',
      monHint:'別モニターへの表示にはブラウザのウィンドウ管理許可を使います。許可がない場合はこの画面に開くので、ドラッグして移動し<b>F</b>で全画面にします。',
      emptyP:'眼底または前眼部の写真をここにドロップするか読み込むと、乳頭・陥凹・中心窩をマークして自動でC/D比を算出できます。屈折検査や眼鏡調製だけなら上の<b>検査</b>ワークスペースへ — 画像は不要です。すべてブラウザ内で処理され、何もアップロードされません。',
      dispNote1:'<b>最終処方</b>だけで完結します — 写真は不要です。PDを写真から推定したい場合のみ顔写真を読み込んでください。',
      dispNote2:'眉の位置に<b>カード</b>(ID-1、85.6mm)を当てた顔写真を読み込みます。カードの長辺に<b>定規</b>を引き、次に瞳孔間に引きます。'
    }
    ,
    'pt-BR':{
      'Late shift.': 'Turno da noite.',
      'Good morning.': 'Bom dia.',
      'Good afternoon.': 'Boa tarde.',
      'Good evening.': 'Boa noite.',
      // header / tabs
      'Imaging':'Imagem','Refraction':'Refração','Dispensing':'Óptica','Exam':'Exame',
      // section headers
      'Patient / encounter':'Paciente / atendimento','Disc analysis':'Análise do disco óptico',
      'Findings':'Achados','Refraction —':'Refração —',
      'Dispensing & optics':'Óptica e montagem','Export':'Exportar',
      // subheads
      'Visual acuity':'Acuidade visual','Autorefraction / retinoscopy':'Autorrefração / retinoscopia',
      'Subjective — final Rx':'Subjetivo — Rx final','Keratometry':'Ceratometria',
      'Pressures & anterior segment':'Pressões e segmento anterior','Interpupillary distance':'Distância interpupilar',
      'Monocular PD':'DP monocular','PD from photo':'DP pela foto','Prism':'Prisma','Lens':'Lente',
      'Frame':'Armação','Fitting':'Ajuste','Contact lens':'Lente de contato',
      // labels
      'Patient ID':'ID do paciente','Exam date':'Data do exame','Name / initials':'Nome / iniciais',
      'Date of birth':'Data de nascimento','Provider / clinic':'Profissional / clínica','Chief complaint / reason':'Queixa principal / motivo',
      'Near':'Perto','Add':'Adição',
      'Axis':'Eixo','IOP (mmHg)':'PIO (mmHg)','Lens status':'Estado do cristalino',
      'Diagnosis / impression':'Diagnóstico / impressão','Notes':'Observações','PD distance':'DP longe','PD near':'DP perto',
      'Mono near':'Mono perto','Reference width (mm)':'Largura de referência (mm)',
      'Base':'Base','Lens type':'Tipo de lente','Material':'Material','Tint':'Coloração','Coatings / options':'Tratamentos / opções',
      'A (eye)':'A (aro)','B (vert)':'B (vert)','DBL':'DBL','ED':'ED',
      'Panto (°)':'Pantoscópico (°)','Vertex (mm)':'Vértice (mm)','Wrap (°)':'Envolvimento (°)',
      'Power':'Grau','Disc Ø':'Ø do disco',
      // metrics
      'Vertical CDR':'E/D vertical','Horizontal CDR':'E/D horizontal','Disc diameter':'Diâmetro do disco',
      'Disc area':'Área do disco','Disc → fovea':'Disco → fóvea',
      // legend / concepts
      'Fovea center':'Centro da fóvea',
      'Measurement':'Medição',
      // buttons
      'Study PDF':'PDF do estudo','Spectacle Rx':'Receita de óculos','Lens order':'Pedido de lentes',
      'Load image':'Carregar imagem','Sample':'Exemplo','Open JSON':'Abrir JSON',
      'Print report':'Imprimir relatório',"Clear this eye's marks":'Apagar marcas deste olho','Load image…':'Carregar imagem…',
      'Load sample fundus':'Carregar fundo de exemplo',
      // eye switch / mini / states
      'OD · Right':'OD · Direito','OS · Left':'OS · Esquerdo',
      'Selected ruler = reference width':'Régua selecionada = largura de referência','Selected ruler → PD distance':'Régua selecionada → DP longe',
      'No photo scale set':'Sem escala de foto','No image loaded':'Nenhuma imagem carregada',
      // tool titles
      'Select / move (V)':'Selecionar / mover (V)','Pan / hand (H)':'Mover / mão (H)','Optic disc center (1)':'Centro do disco óptico (1)',
      'Fovea center (2)':'Centro da fóvea (2)','Optic disc margin (3)':'Borda do disco óptico (3)','Optic cup margin (4)':'Borda da escavação (4)',
      'Lesion / finding pin (5)':'Marcador de lesão / achado (5)','Measure distance (6)':'Medir distância (6)',
      'Arrow / pointer (7)':'Seta / apontador (7)','Text label (8)':'Rótulo de texto (8)','Freehand outline (9)':'Contorno à mão livre (9)',
      'Lesion type for the pin tool':'Tipo de lesão para o marcador','Zoom in':'Aproximar','Zoom out':'Afastar','Fit to view':'Ajustar à tela',
      // select options
      'Phakic':'Fácico','Pseudophakic':'Pseudofácico','Aphakic':'Afácico',
      'Single vision':'Monofocal','Bifocal':'Bifocal','Trifocal':'Trifocal','Progressive':'Progressiva','Office / occupational':'Ocupacional',
      'Polycarbonate':'Policarbonato','Hi-index 1.60':'Alto índice 1.60','Hi-index 1.67':'Alto índice 1.67','Hi-index 1.74':'Alto índice 1.74',
      'Base up':'Base superior','Base down':'Base inferior','Base in':'Base nasal','Base out':'Base temporal',
      'Microaneurysm':'Microaneurisma','Dot/blot hemorrhage':'Hemorragia em ponto / mancha','Flame hemorrhage':'Hemorragia em chama',
      'Hard exudate':'Exsudato duro','Cotton-wool spot':'Mancha algodonosa','Drusen':'Drusas',
      'Neovascularization (NVD/NVE)':'Neovascularização (NVD/NVE)','Laser scar':'Cicatriz de laser',
      'Pigment / RPE change':'Alteração de pigmento / EPR','Aneurysm':'Aneurisma','Other finding':'Outro achado',
      // dynamic
      'Optic disc center':'Centro do disco óptico','Optic disc margin':'Borda do disco óptico','Optic cup margin':'Borda da escavação',
      'No marks yet.':'Ainda sem marcas.','Lesion':'Lesão','point':'ponto','lesion pin':'marcador de lesão',
      'right eye (OD)':'olho direito (OD)','left eye (OS)':'olho esquerdo (OS)',
      // compact exam-grid headers & hints
      'both eyes':'ambos os olhos','Dist UC':'Longe SC','Dist CC':'Longe CC','Dominant eye':'Olho dominante',
      'IOP':'PIO','Pachy':'Paquim.','Impression':'Impressão','shared':'compartilhadas',
      'binocular, mm':'binocular, mm','binocular':'binocular','Mono dist':'Mono longe',
      'optional · estimate only':'opcional · apenas estimativa','Amount Δ':'Quantidade Δ',
      'boxing system, mm':'sistema boxing, mm','Seg ht':'Altura seg','OC ht':'Altura CO',
      'Brand':'Marca',
      // tests & settings
      'Tests':'Testes','Eye exam tests':'Testes oftalmológicos','Back to tests':'Voltar aos testes',
      'Presenting':'Apresentando','Shuffle':'Embaralhar','Prev':'Ant.','Next':'Próx.','Mirror':'Espelho','Close':'Fechar','Rows':'Linhas',
      'Settings':'Configurações','Test display':'Tela de teste','Same screen':'Mesma tela','Second monitor':'Segundo monitor','Ask each time':'Perguntar sempre','Detect monitors':'Detectar monitores',
      'Distance':'Distância','Unit':'Unidade','85.6 mm card':'Cartão de 85,6 mm','Display density':'Densidade da tela','Mirror chart':'Optotipo espelhado','Off':'Não','On (mirrored room)':'Sim (sala com espelho)','Save settings':'Salvar configurações',
      'Snellen letters':'Letras de Snellen','Distance acuity':'Acuidade para longe','LogMAR (Sloan)':'LogMAR (Sloan)','Letter chart':'Tabela de letras','Tumbling E':'E direcional','Illiterate / pediatric':'Analfabetos / pediátrico','Landolt C':'C de Landolt','Ring gap':'Abertura do anel','Duochrome':'Bicromático','Red-green balance':'Equilíbrio vermelho-verde','Astigmatic dial':'Relógio astigmático','Axis / fan':'Eixo / leque','Amsler grid':'Tela de Amsler','Macular / central':'Macular / central','Contrast letters':'Letras de contraste','Low contrast':'Baixo contraste','Color vision':'Visão de cores','Screening demo':'Demo de triagem','Fixation target':'Alvo de fixação','Central fixation':'Fixação central','Blank — white':'Branco','White field':'Campo branco','Blank — black':'Preto','Black field':'Campo preto',
      'Settings saved':'Configurações salvas','Popup blocked — allow popups for this site':'Pop-up bloqueado — permita pop-ups para este site','primary':'principal','secondary':'secundário','Move the chart to the second monitor?':'Mover o optotipo para o segundo monitor?',
      'Optotype order':'Ordem dos optotipos','Fixed chart':'Tabela fixa','Randomize':'Aleatório','Screen':'Tela','Could not move the window — drag it manually':'Não foi possível mover a janela — arraste-a manualmente',
      '1 eye':'1 olho','2 eyes':'2 olhos',
      'Annotation':'Anotação','Text label':'Rótulo de texto','Outline':'Contorno',
      'Lens layout / centration':'Layout / centragem das lentes','from PD, frame & heights':'a partir de DP, armação e alturas','Enter frame A, B and DBL to see the centration layout.':'Informe A, B e DBL da armação para ver o esquema de centragem.',
      'Chart screen':'Tela do optotipo',
      'Control (main)':'Controle (principal)','Tap to assign':'Toque para atribuir','Tap: main → chart → none':'Toque: principal → teste → nenhum',
      'Screen calibration':'Calibração da tela','Patient ↔ screen distance':'Distância paciente ↔ tela',
      'Charts are sized for a real viewing distance and physical pixel size, so acuity is accurate. Set both:':'Os optotipos são dimensionados para a distância real de visualização e o tamanho físico do pixel, garantindo uma acuidade precisa. Configure os dois:',
      "Hold a standard card (credit / ID, 85.6 mm wide) against the box and drag the slider until it matches the card's width.":'Encoste um cartão padrão (crédito / ID, 85,6 mm) no quadro e ajuste o controle até coincidir com a largura do cartão.',
      'Export ↗':'Exportar ↗','Export & data':'Exportação e dados','Building preview…':'Gerando pré-visualização…','Preview unavailable':'Pré-visualização indisponível','Download PDF':'Baixar PDF','Download DICOM':'Baixar DICOM','Annotated PNG':'PNG anotado','Study JSON':'JSON do estudo','Print':'Imprimir',
      'Camera':'Câmera','Camera device':'Dispositivo de câmera','Capture':'Capturar','Refresh devices':'Atualizar dispositivos','Take photo…':'Tirar foto…','No image':'Sem imagem',
      "Pick your webcam or a connected fundus / slit-lamp camera. The captured frame becomes the current eye's image.":'Escolha sua webcam ou uma câmera de fundo de olho / lâmpada de fenda conectada. O quadro capturado vira a imagem do olho atual.',
      'Camera not available in this browser / context':'Câmera indisponível neste navegador / contexto','Camera access denied or unavailable':'Acesso à câmera negado ou indisponível','Camera not ready':'A câmera não está pronta','Photo captured':'Foto capturada','Could not switch camera':'Não foi possível trocar de câmera','Nothing to export yet — add data or an image':'Nada para exportar ainda — adicione dados ou uma imagem',
      lensNote:'Cruz dourada = centro óptico / cruz de montagem de cada lente; linha tracejada = linha média e datum da armação. "dec" é a descentração horizontal a partir do centro da caixa, "h" a altura de montagem.',
      'Fixed shows the classic chart letters in their original order; Randomize scrambles them. The Shuffle button re-randomizes any time.':'"Fixa" mostra as letras clássicas na ordem original; "Aleatório" as embaralha. O botão Embaralhar reorganiza a qualquer momento.',
      testsNote:'Abre o optotipo escolhido em outra janela — coloque-a na tela voltada ao paciente e controle daqui. Configure a tela, a distância e a calibração de tamanho real em <b>Configurações</b> (ícone de engrenagem).',
      monHint:'Colocar um optotipo em um segundo monitor usa a permissão de gerenciamento de janelas do navegador. Se ela não for concedida, a janela abre aqui — arraste-a para lá e pressione <b>F</b> para tela cheia.',
      // html blocks
      emptyP:'Arraste aqui uma foto de fundo de olho ou de segmento anterior, ou carregue uma, para marcar o disco, a escavação e a fóvea e obter a relação escavação/disco automática. Só quer refracionar ou montar óculos? Abra o espaço <b>Exame</b> acima — não precisa de imagem. Tudo fica no seu navegador; nada é enviado.',
      dispNote1:'Funciona inteiramente a partir da <b>Rx final</b> — sem foto. Carregue uma foto do rosto apenas se quiser estimar a DP a partir dela.',
      dispNote2:'Carregue uma foto do rosto com um <b>cartão</b> (ID-1, 85,6 mm) junto à sobrancelha. Trace uma <b>régua</b> sobre o lado longo do cartão e depois de pupila a pupila.'
    },
    ru:{
      'Late shift.': 'Ночная смена.',
      'Good morning.': 'Доброе утро.',
      'Good afternoon.': 'Добрый день.',
      'Good evening.': 'Добрый вечер.',
      // header / tabs
      'Imaging':'Снимки','Refraction':'Рефракция','Dispensing':'Оптика','Exam':'Осмотр',
      // section headers
      'Patient / encounter':'Пациент / приём','Disc analysis':'Анализ ДЗН',
      'Findings':'Находки','Refraction —':'Рефракция —',
      'Dispensing & optics':'Оптика и подбор','Export':'Экспорт',
      // subheads
      'Visual acuity':'Острота зрения','Autorefraction / retinoscopy':'Авторефрактометрия / скиаскопия',
      'Subjective — final Rx':'Субъективно — итоговый рецепт','Keratometry':'Кератометрия',
      'Pressures & anterior segment':'Давление и передний отрезок','Interpupillary distance':'Межзрачковое расстояние',
      'Monocular PD':'Монокулярное РЦ','PD from photo':'РЦ по фото','Prism':'Призма','Lens':'Линза',
      'Frame':'Оправа','Fitting':'Посадка','Contact lens':'Контактные линзы',
      // labels
      'Patient ID':'ID пациента','Exam date':'Дата осмотра','Name / initials':'Имя / инициалы',
      'Date of birth':'Дата рождения','Provider / clinic':'Врач / клиника','Chief complaint / reason':'Жалобы / причина обращения',
      'Near':'Вблизи','Add':'Аддидация',
      'Axis':'Ось','IOP (mmHg)':'ВГД (мм рт. ст.)','Lens status':'Состояние хрусталика',
      'Diagnosis / impression':'Диагноз / заключение','Notes':'Заметки','PD distance':'РЦ вдаль','PD near':'РЦ вблизи',
      'Mono near':'Моно вблизи','Reference width (mm)':'Эталонная ширина (мм)',
      'Base':'Основание','Lens type':'Тип линз','Material':'Материал','Tint':'Тонировка','Coatings / options':'Покрытия / опции',
      'A (eye)':'A (проём)','B (vert)':'B (верт.)','DBL':'DBL','ED':'ED',
      'Panto (°)':'Пантоскопический угол (°)','Vertex (mm)':'Вертексное расстояние (мм)','Wrap (°)':'Изгиб оправы (°)',
      'Power':'Оптическая сила','Disc Ø':'Ø диска',
      // metrics
      'Vertical CDR':'Э/Д по вертикали','Horizontal CDR':'Э/Д по горизонтали','Disc diameter':'Диаметр диска',
      'Disc area':'Площадь диска','Disc → fovea':'Диск → фовеа',
      // legend / concepts
      'Fovea center':'Центр фовеа',
      'Measurement':'Измерение',
      // buttons
      'Study PDF':'PDF исследования','Spectacle Rx':'Рецепт на очки','Lens order':'Заказ линз',
      'Load image':'Загрузить снимок','Sample':'Пример','Open JSON':'Открыть JSON',
      'Print report':'Печать отчёта',"Clear this eye's marks":'Удалить метки этого глаза','Load image…':'Загрузить снимок…',
      'Load sample fundus':'Загрузить пример глазного дна',
      // eye switch / mini / states
      'OD · Right':'OD · правый глаз','OS · Left':'OS · левый глаз',
      'Selected ruler = reference width':'Выбранная линейка = эталонная ширина','Selected ruler → PD distance':'Выбранная линейка → РЦ вдаль',
      'No photo scale set':'Масштаб фото не задан','No image loaded':'Снимок не загружен',
      // tool titles
      'Select / move (V)':'Выбор / перемещение (V)','Pan / hand (H)':'Панорама / рука (H)','Optic disc center (1)':'Центр диска зрительного нерва (1)',
      'Fovea center (2)':'Центр фовеа (2)','Optic disc margin (3)':'Граница диска (3)','Optic cup margin (4)':'Граница экскавации (4)',
      'Lesion / finding pin (5)':'Метка очага / находки (5)','Measure distance (6)':'Измерить расстояние (6)',
      'Arrow / pointer (7)':'Стрелка / указатель (7)','Text label (8)':'Текстовая метка (8)','Freehand outline (9)':'Контур от руки (9)',
      'Lesion type for the pin tool':'Тип очага для метки','Zoom in':'Приблизить','Zoom out':'Отдалить','Fit to view':'Вписать в окно',
      // select options
      'Phakic':'Факичный','Pseudophakic':'Артифакичный (ИОЛ)','Aphakic':'Афакичный',
      'Single vision':'Однофокальные','Bifocal':'Бифокальные','Trifocal':'Трифокальные','Progressive':'Прогрессивные','Office / occupational':'Офисные',
      'Polycarbonate':'Поликарбонат','Hi-index 1.60':'Высокоиндексные 1.60','Hi-index 1.67':'Высокоиндексные 1.67','Hi-index 1.74':'Высокоиндексные 1.74',
      'Base up':'Основанием вверх','Base down':'Основанием вниз','Base in':'Основанием к носу','Base out':'Основанием к виску',
      'Microaneurysm':'Микроаневризма','Dot/blot hemorrhage':'Точечное/пятнистое кровоизлияние','Flame hemorrhage':'Пламевидное кровоизлияние',
      'Hard exudate':'Твёрдый экссудат','Cotton-wool spot':'Ватообразный очаг','Drusen':'Друзы',
      'Neovascularization (NVD/NVE)':'Неоваскуляризация (NVD/NVE)','Laser scar':'Лазерный рубец',
      'Pigment / RPE change':'Изменения пигмента / ПЭС','Aneurysm':'Аневризма','Other finding':'Другая находка',
      // dynamic
      'Optic disc center':'Центр диска зрительного нерва','Optic disc margin':'Граница диска','Optic cup margin':'Граница экскавации',
      'No marks yet.':'Меток пока нет.','Lesion':'Очаг','point':'точка','lesion pin':'метка очага',
      'right eye (OD)':'правый глаз (OD)','left eye (OS)':'левый глаз (OS)',
      // compact exam-grid headers & hints
      'both eyes':'оба глаза','Dist UC':'Вдаль б/к','Dist CC':'Вдаль с/к','Dominant eye':'Ведущий глаз',
      'IOP':'ВГД','Pachy':'Пахим.','Impression':'Заключение','shared':'общие',
      'binocular, mm':'бинокулярно, мм','binocular':'бинокулярно','Mono dist':'Моно вдаль',
      'optional · estimate only':'необязательно · только оценка','Amount Δ':'Величина Δ',
      'boxing system, mm':'боксинг-система, мм','Seg ht':'Выс. сегмента','OC ht':'Выс. ОЦ',
      'Brand':'Бренд',
      // tests & settings
      'Tests':'Тесты','Eye exam tests':'Офтальмологические тесты','Back to tests':'Назад к тестам',
      'Presenting':'Показ','Shuffle':'Перемешать','Prev':'Назад','Next':'Далее','Mirror':'Зеркально','Close':'Закрыть','Rows':'Строки',
      'Settings':'Настройки','Test display':'Экран теста','Same screen':'Тот же экран','Second monitor':'Второй монитор','Ask each time':'Спрашивать каждый раз','Detect monitors':'Найти мониторы',
      'Distance':'Дистанция','Unit':'Единицы','85.6 mm card':'Карта 85,6 мм','Display density':'Плотность экрана','Mirror chart':'Зеркальная таблица','Off':'Выкл','On (mirrored room)':'Вкл (кабинет с зеркалом)','Save settings':'Сохранить настройки',
      'Snellen letters':'Буквы Снеллена','Distance acuity':'Острота вдаль','LogMAR (Sloan)':'LogMAR (Sloan)','Letter chart':'Буквенная таблица','Tumbling E':'Повёрнутые E','Illiterate / pediatric':'Для неграмотных / детей','Landolt C':'Кольца Ландольта','Ring gap':'Разрыв кольца','Duochrome':'Дуохромный тест','Red-green balance':'Красно-зелёный баланс','Astigmatic dial':'Лучистая фигура','Axis / fan':'Ось / веер','Amsler grid':'Сетка Амслера','Macular / central':'Макула / центр','Contrast letters':'Контрастные буквы','Low contrast':'Низкий контраст','Color vision':'Цветовое зрение','Screening demo':'Демо скрининга','Fixation target':'Точка фиксации','Central fixation':'Центральная фиксация','Blank — white':'Белый экран','White field':'Белое поле','Blank — black':'Чёрный экран','Black field':'Чёрное поле',
      'Settings saved':'Настройки сохранены','Popup blocked — allow popups for this site':'Всплывающее окно заблокировано — разрешите его для этого сайта','primary':'основной','secondary':'дополнительный','Move the chart to the second monitor?':'Перенести таблицу на второй монитор?',
      'Optotype order':'Порядок оптотипов','Fixed chart':'Фиксированная','Randomize':'Случайный','Screen':'Экран','Could not move the window — drag it manually':'Не удалось переместить окно — перетащите его вручную',
      '1 eye':'1 глаз','2 eyes':'2 глаза',
      'Annotation':'Аннотация','Text label':'Текстовая метка','Outline':'Контур',
      'Lens layout / centration':'Разметка / центровка линз','from PD, frame & heights':'по МЦР, оправе и высотам','Enter frame A, B and DBL to see the centration layout.':'Введите A, B и DBL оправы, чтобы увидеть схему центровки.',
      'Chart screen':'Экран таблицы',
      'Control (main)':'Управление (основной)','Tap to assign':'Нажмите, чтобы назначить','Tap: main → chart → none':'Нажатие: основной → таблица → нет',
      'Screen calibration':'Калибровка экрана','Patient ↔ screen distance':'Расстояние пациент ↔ экран',
      'Charts are sized for a real viewing distance and physical pixel size, so acuity is accurate. Set both:':'Таблицы масштабируются под реальное расстояние и физический размер пикселя, чтобы острота измерялась точно. Задайте оба значения:',
      "Hold a standard card (credit / ID, 85.6 mm wide) against the box and drag the slider until it matches the card's width.":'Приложите стандартную карту (банковская / ID, 85,6 мм) к рамке и двигайте ползунок, пока рамка не совпадёт с шириной карты.',
      'Export ↗':'Экспорт ↗','Export & data':'Экспорт и данные','Building preview…':'Готовим предпросмотр…','Preview unavailable':'Предпросмотр недоступен','Download PDF':'Скачать PDF','Download DICOM':'Скачать DICOM','Annotated PNG':'PNG с разметкой','Study JSON':'JSON исследования','Print':'Печать',
      'Camera':'Камера','Camera device':'Устройство камеры','Capture':'Снять','Refresh devices':'Обновить устройства','Take photo…':'Сделать фото…','No image':'Нет снимка',
      "Pick your webcam or a connected fundus / slit-lamp camera. The captured frame becomes the current eye's image.":'Выберите веб-камеру или подключённую фундус-камеру / камеру щелевой лампы. Снятый кадр станет снимком текущего глаза.',
      'Camera not available in this browser / context':'Камера недоступна в этом браузере / контексте','Camera access denied or unavailable':'Доступ к камере запрещён или камера недоступна','Camera not ready':'Камера не готова','Photo captured':'Фото сделано','Could not switch camera':'Не удалось переключить камеру','Nothing to export yet — add data or an image':'Пока нечего экспортировать — добавьте данные или снимок',
      lensNote:'Золотой крест — оптический центр / установочный крест каждой линзы; пунктир — средняя линия и датум оправы. «dec» — горизонтальная децентрация от центра светового проёма, «h» — установочная высота.',
      'Fixed shows the classic chart letters in their original order; Randomize scrambles them. The Shuffle button re-randomizes any time.':'«Фиксированная» показывает классические буквы в исходном порядке; «Случайный» их перемешивает. Кнопка «Перемешать» перемешивает заново в любой момент.',
      testsNote:'Открывает выбранную таблицу в отдельном окне — поместите его на экран пациента и управляйте отсюда. Экран, расстояние и калибровку реального размера задайте в <b>Настройках</b> (значок шестерёнки).',
      monHint:'Показ таблицы на втором мониторе использует разрешение браузера на управление окнами. Если оно не выдано, окно откроется здесь — перетащите его и нажмите <b>F</b> для полного экрана.',
      // html blocks
      emptyP:'Перетащите сюда фото глазного дна или переднего отрезка либо загрузите его, чтобы отметить диск, экскавацию и фовеа и автоматически получить отношение экскавации к диску (Э/Д). Нужна только рефракция или подбор очков? Откройте раздел <b>Осмотр</b> выше — снимок не нужен. Всё остаётся в вашем браузере; ничего не отправляется.',
      dispNote1:'Работает полностью от <b>итогового рецепта</b> — фото не требуется. Загрузите фото лица, только если хотите оценить РЦ по нему.',
      dispNote2:'Загрузите фото лица с <b>картой</b> (ID-1, 85,6 мм) у брови. Проведите <b>линейку</b> вдоль длинной стороны карты, затем от зрачка до зрачка.'
    }
};
window.I18N = I18N;

// ---------- Fleet-convention helpers ([data-i18n] leaves) ----------
function currentFleetLang() { return (window.CarinoLang && window.CarinoLang.current) || 'en'; }

function t(key) {
    const lang = currentFleetLang();
    if (lang === 'en' || !key) return key;
    const d = I18N[lang];
    return (d && d[key] != null) ? d[key] : key;
}

function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (!el.dataset.i18nKey) el.dataset.i18nKey = el.textContent.trim();
        el.textContent = t(el.dataset.i18nKey);
    });
}

// carino-lang.js is deferred and executes before this script (also deferred,
// placed after it), so CarinoLang exists by DOMContentLoaded. The app's own
// applier (inside index.html) wires itself to the same events for everything
// that is not a [data-i18n] leaf.
document.addEventListener('DOMContentLoaded', applyStaticI18n);
window.addEventListener('carino:langchange', applyStaticI18n);

window.t = t;
window.applyStaticI18n = applyStaticI18n;
})();
