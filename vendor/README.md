# Third-party code bundled here

Everything this project needs is vendored: it loads no script, style, font, map
or module from anywhere but its own origin — no CDN, no network, no account.
That is the point of the tool, and it makes the licences below *this project's*
responsibility rather than a package manager's.

**Every library here has its licence text in this directory.** Naming a licence
is not the same as shipping it: MIT and BSD both require the permission text
itself to travel with a copy, and most minified bundles drop it. Where a bundle
does carry the full text inline, the row says so and no separate file is needed.

Two libraries, both for the same job: the encounter/report export writes a PDF in
the browser, so nothing about an eye examination ever leaves the machine. `fontkit`
is what lets that PDF carry an embedded Unicode font, and therefore be written in
Japanese or Russian rather than only in WinAnsi. It is injected on the first export
rather than loaded with the page — together with the faces in `fonts/pdf/` it
outweighs the rest of the app, and most sessions never export.

## What is here, and under what licence

| File | Package | Licence | Licence text |
| --- | --- | --- | --- |
| `pdf-lib.min.js` | [pdf-lib](https://pdf-lib.js.org/) | MIT | **Inline** — full MIT text in the bundle; also embeds the Apache-2.0 tslib runtime, credited inline |
| `fontkit.umd.min.js` | [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | MIT | `fontkit.LICENSE.txt` — **reconstructed**: the npm package declares MIT but ships no LICENSE file and the bundle carries no inline notice. Also statically includes pako (MIT), covered by the same file |

## The rule

Adding a file to this directory means adding a row here **in the same commit**.
A record kept from the first vendored file is trivial; one reconstructed two
years later is not.
