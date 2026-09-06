/* ============================================================
   i18n for the Electron shell (main process).
   ------------------------------------------------------------
   Retina translates itself in the renderer through carino-lang.js
   + i18n.js. That machinery cannot reach the shell: the application
   menu and the update dialogs are drawn by the OS, outside any served
   page, so they have no cookie, no localStorage and no DOM to hook.

   This module is the shell's own tiny dictionary. It resolves once from
   `app.getLocale()` — Electron fixes the locale at launch, so there is
   nothing to re-render — using the same four languages and the same
   prefix matching as carino-lang.js. English source strings are the
   keys, so a missing entry falls back to English exactly as elsewhere.

   Menu items built from Electron roles (Edit, Window, Help, and the
   macOS application menu) are deliberately absent: Electron already
   ships those labels localised, and a second translation of "Paste"
   would only ever disagree with the platform's own. File and View are
   here because this shell hand-builds them — File to add the downloads
   folder, View because { role: "viewMenu" } ships Zoom In and a zoomed
   chart is a silently wrong acuity.
   ============================================================ */
"use strict";

const STRINGS = {
    es: {
        // Hand-built menu labels
        'File': 'Archivo',
        'Show downloads folder': 'Mostrar la carpeta de descargas',
        'View': 'Ver',
        // Help menu
        'Check for updates now': 'Buscar actualizaciones ahora',
        'Check for updates automatically': 'Buscar actualizaciones automáticamente',
        'Carino Retina on GitHub': 'Carino Retina en GitHub',
        'Licence (MPL-2.0)': 'Licencia (MPL-2.0)',
        'Third-party notices': 'Avisos de terceros',
        // First-run update opt-in
        'Should Carino Retina check GitHub for new versions once a day?': '¿Debe Carino Retina consultar GitHub una vez al día para ver si hay versiones nuevas?',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': 'No se envía, descarga ni instala nada: solo se lee el número de la última versión publicada.',
        'Check for updates': 'Buscar actualizaciones',
        "Don't check": 'No buscar',
        // Result of a check the user asked for by hand
        'Carino Retina {version} is available.': 'Carino Retina {version} ya está disponible.',
        'You are running the latest version ({version}).': 'Estás usando la versión más reciente ({version}).',
        'Could not reach GitHub.': 'No se pudo conectar con GitHub.',
        'Open the release page': 'Abrir la página de la versión',
        'Later': 'Más tarde',
        // Dialog titles and the longer phrasings inherited from the editor's
        // update state machine, which main.js copies verbatim. Keeping both
        // wordings costs four lines and guarantees no dialog falls back to
        // English because the two files disagreed about a sentence.
        'No update available': 'No hay actualizaciones',
        'An update is available': 'Hay una actualización disponible',
        'Could not check for updates': 'No se pudieron buscar actualizaciones',
        'You are running the newest version, {version}.': 'Estás usando la versión más reciente, {version}.',
        'Version {version} has been released. You are running {current}.': 'Se publicó la versión {version}. Estás usando la {current}.',
        'GitHub could not be reached. Nothing was changed; try again later.': 'No se pudo conectar con GitHub. No se cambió nada; inténtalo más tarde.',
        'Open release page': 'Abrir la página de la versión',
        'Close': 'Cerrar',
    },
    'pt-BR': {
        'File': 'Arquivo',
        'Show downloads folder': 'Mostrar a pasta de downloads',
        'View': 'Exibir',
        'Check for updates now': 'Procurar atualizações agora',
        'Check for updates automatically': 'Procurar atualizações automaticamente',
        'Carino Retina on GitHub': 'Carino Retina no GitHub',
        'Licence (MPL-2.0)': 'Licença (MPL-2.0)',
        'Third-party notices': 'Avisos de terceiros',
        'Should Carino Retina check GitHub for new versions once a day?': 'O Carino Retina deve consultar o GitHub uma vez por dia em busca de novas versões?',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': 'Nada é enviado, baixado ou instalado — apenas o número da última versão publicada é lido.',
        'Check for updates': 'Procurar atualizações',
        "Don't check": 'Não procurar',
        'Carino Retina {version} is available.': 'O Carino Retina {version} já está disponível.',
        'You are running the latest version ({version}).': 'Você está usando a versão mais recente ({version}).',
        'Could not reach GitHub.': 'Não foi possível acessar o GitHub.',
        'Open the release page': 'Abrir a página da versão',
        'Later': 'Mais tarde',
        'No update available': 'Nenhuma atualização disponível',
        'An update is available': 'Há uma atualização disponível',
        'Could not check for updates': 'Não foi possível procurar atualizações',
        'You are running the newest version, {version}.': 'Você está usando a versão mais recente, {version}.',
        'Version {version} has been released. You are running {current}.': 'A versão {version} foi publicada. Você está usando a {current}.',
        'GitHub could not be reached. Nothing was changed; try again later.': 'Não foi possível acessar o GitHub. Nada foi alterado; tente novamente mais tarde.',
        'Open release page': 'Abrir a página da versão',
        'Close': 'Fechar',
    },
    ja: {
        'File': 'ファイル',
        'Show downloads folder': 'ダウンロードフォルダーを表示',
        'View': '表示',
        'Check for updates now': '今すぐ更新を確認',
        'Check for updates automatically': '自動的に更新を確認',
        'Carino Retina on GitHub': 'Carino Retina を GitHub で見る',
        'Licence (MPL-2.0)': 'ライセンス (MPL-2.0)',
        'Third-party notices': 'サードパーティの権利表示',
        'Should Carino Retina check GitHub for new versions once a day?': 'Carino Retina が新しいバージョンを GitHub に 1 日 1 回確認してもよいですか？',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': '送信・ダウンロード・インストールは一切行わず、最新リリースの番号を読むだけです。',
        'Check for updates': '更新を確認する',
        "Don't check": '確認しない',
        'Carino Retina {version} is available.': 'Carino Retina {version} が公開されました。',
        'You are running the latest version ({version}).': '最新バージョン ({version}) を使用しています。',
        'Could not reach GitHub.': 'GitHub に接続できませんでした。',
        'Open the release page': 'リリースページを開く',
        'Later': 'あとで',
        'No update available': '更新はありません',
        'An update is available': '更新があります',
        'Could not check for updates': '更新を確認できませんでした',
        'You are running the newest version, {version}.': '最新バージョン {version} を使用しています。',
        'Version {version} has been released. You are running {current}.': 'バージョン {version} が公開されました。現在お使いのバージョンは {current} です。',
        'GitHub could not be reached. Nothing was changed; try again later.': 'GitHub に接続できませんでした。何も変更されていません。しばらくしてからもう一度お試しください。',
        'Open release page': 'リリースページを開く',
        'Close': '閉じる',
    },
    ru: {
        'File': 'Файл',
        'Show downloads folder': 'Показать папку загрузок',
        'View': 'Вид',
        'Check for updates now': 'Проверить обновления сейчас',
        'Check for updates automatically': 'Проверять обновления автоматически',
        'Carino Retina on GitHub': 'Carino Retina на GitHub',
        'Licence (MPL-2.0)': 'Лицензия (MPL-2.0)',
        'Third-party notices': 'Уведомления сторонних компонентов',
        'Should Carino Retina check GitHub for new versions once a day?': 'Разрешить Carino Retina раз в сутки проверять на GitHub наличие новых версий?',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': 'Ничего не отправляется, не скачивается и не устанавливается — читается только номер последнего выпуска.',
        'Check for updates': 'Проверять обновления',
        "Don't check": 'Не проверять',
        'Carino Retina {version} is available.': 'Доступна версия Carino Retina {version}.',
        'You are running the latest version ({version}).': 'Установлена самая новая версия ({version}).',
        'Could not reach GitHub.': 'Не удалось соединиться с GitHub.',
        'Open the release page': 'Открыть страницу выпуска',
        'Later': 'Позже',
        'No update available': 'Обновлений нет',
        'An update is available': 'Доступно обновление',
        'Could not check for updates': 'Не удалось проверить обновления',
        'You are running the newest version, {version}.': 'Установлена самая новая версия, {version}.',
        'Version {version} has been released. You are running {current}.': 'Выпущена версия {version}. У вас установлена {current}.',
        'GitHub could not be reached. Nothing was changed; try again later.': 'Не удалось соединиться с GitHub. Ничего не изменено; попробуйте позже.',
        'Open release page': 'Открыть страницу выпуска',
        'Close': 'Закрыть',
    },
};

// Same prefix matching as carino-lang.js, so the shell and the page agree on
// what "pt-PT" or "es-MX" resolve to.
function resolve(tag) {
    const l = String(tag || '').toLowerCase();
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('pt')) return 'pt-BR';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ru')) return 'ru';
    return 'en';
}

let dict = null;

// `app` is passed in rather than required, so this module stays testable and
// does not pull Electron in when it is only being linted. Call it after
// app.whenReady(): getLocale() before then is empty on some platforms, which
// would silently pin the shell to English.
function init(app) {
    let tag = '';
    try { tag = app.getLocale(); } catch (e) { /* pre-ready: stay English */ }
    dict = STRINGS[resolve(tag)] || null;
}

function t(key, vals) {
    const s = (dict && dict[key]) || key;
    return vals ? s.replace(/\{(\w+)\}/g, (m, k) => (vals[k] != null ? vals[k] : m)) : s;
}

module.exports = { init, t, resolve };
