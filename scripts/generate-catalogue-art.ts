// `npx tsx scripts/generate-catalogue-art.ts`: writes the bundled demo catalogue images to
// public/catalogue-art/ (three views per seeded product, plus the home page banners). Each image is drawn
// for its product: the right garment, shoe, device or cosmetic, in the product's first listed colour.
// The output is committed; re-run only after changing a drawing. src/modules/catalogue/catalogue-art.ts
// maps the seeded demo image URLs to these files.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputDirectory = path.join(process.cwd(), 'public', 'catalogue-art');

// ---------------------------------------------------------------- colour helpers
function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function mix(hex: string, target: string, amount: number): string {
  const parse = (colour: string) =>
    [1, 3, 5].map((index) => Number.parseInt(colour.slice(index, index + 2), 16));
  const [r1 = 0, g1 = 0, b1 = 0] = parse(hex);
  const [r2 = 0, g2 = 0, b2 = 0] = parse(target);
  const channel = (from: number, to: number) =>
    clamp(from + (to - from) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`;
}
const darker = (hex: string, amount = 0.25) => mix(hex, '#000000', amount);
const lighter = (hex: string, amount = 0.25) => mix(hex, '#ffffff', amount);

const fontFamily = 'Helvetica Neue, Helvetica, Arial, sans-serif';
function label(
  x: number,
  y: number,
  text: string,
  size: number,
  fill: string,
  weight = 600,
  spacing = 1,
): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${fontFamily}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}">${text}</text>`;
}

// ---------------------------------------------------------------- apparel
function kurta(base: string, print: string, id: string): string {
  const body =
    'M330,182 Q400,214 470,182 L522,198 L604,330 L566,354 L494,286 L470,372 Q560,520 618,702 Q400,736 182,702 Q240,520 330,372 L306,286 L234,354 L196,330 L278,198 Z';
  return `
  <defs><pattern id="${id}" width="46" height="46" patternUnits="userSpaceOnUse">
    <circle cx="11" cy="11" r="5" fill="${print}"/><circle cx="34" cy="34" r="5" fill="${print}"/>
    <path d="M34,4 l4,7 l-4,7 l-4,-7 Z M11,27 l4,7 l-4,7 l-4,-7 Z" fill="${print}" opacity=".7"/>
  </pattern></defs>
  <path d="${body}" fill="${base}"/>
  <path d="${body}" fill="url(#${id})" opacity=".55"/>
  <path d="M358,184 Q400,252 442,184" fill="${darker(base, 0.35)}"/>
  <path d="M330,372 Q400,392 470,372" fill="none" stroke="#d9a440" stroke-width="12"/>
  <path d="M188,690 Q400,724 612,690" fill="none" stroke="#d9a440" stroke-width="14"/>
  <path d="M234,354 L196,330 M566,354 L604,330" stroke="#d9a440" stroke-width="10"/>`;
}

function saree(base: string, id: string): string {
  const gold = '#d6a743';
  return `
  <defs><pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M20,8 l6,12 l-6,12 l-6,-12 Z" fill="${gold}" opacity=".85"/>
  </pattern></defs>
  <path d="M232,214 L612,168 Q640,166 642,196 L668,520 Q670,548 642,552 L300,604 Z" fill="${darker(base, 0.18)}"/>
  <path d="M232,214 L612,168 Q640,166 642,196 L668,520 Q670,548 642,552 L300,604 Z" fill="url(#${id})" opacity=".5"/>
  <path d="M560,175 L612,168 Q640,166 642,196 L668,520 Q670,548 642,552 L590,560 Z" fill="${gold}"/>
  <path d="M574,174 L600,170 L630,548 L604,552 Z" fill="${darker(base, 0.1)}"/>
  <rect x="160" y="356" width="460" height="270" rx="14" fill="${base}"/>
  <rect x="160" y="356" width="460" height="270" rx="14" fill="url(#${id})" opacity=".6"/>
  <rect x="160" y="356" width="460" height="40" fill="${gold}"/>
  <rect x="160" y="586" width="460" height="40" fill="${gold}"/>
  <path d="M160,376 H620 M160,606 H620" stroke="${darker(base, 0.2)}" stroke-width="4" stroke-dasharray="14 8"/>
  <rect x="602" y="356" width="18" height="270" fill="${darker(base, 0.3)}" opacity=".5"/>`;
}

function wrapDress(base: string, flower: string, id: string): string {
  const body =
    'M336,168 L372,168 Q400,236 428,168 L464,168 L530,214 L500,262 L466,246 L452,360 Q520,520 566,704 Q400,734 234,704 Q280,520 348,360 L334,246 L300,262 L270,214 Z';
  return `
  <defs><pattern id="${id}" width="52" height="52" patternUnits="userSpaceOnUse">
    <g fill="${flower}"><circle cx="13" cy="9" r="5"/><circle cx="20" cy="15" r="5"/><circle cx="17" cy="23" r="5"/><circle cx="9" cy="23" r="5"/><circle cx="6" cy="15" r="5"/></g>
    <circle cx="13" cy="16" r="3.4" fill="#ffffff"/>
    <g fill="${flower}" opacity=".7"><circle cx="40" cy="38" r="3.5"/><circle cx="45" cy="43" r="3.5"/><circle cx="38" cy="45" r="3.5"/></g>
  </pattern></defs>
  <path d="${body}" fill="${base}"/>
  <path d="${body}" fill="url(#${id})" opacity=".8"/>
  <path d="M372,168 Q400,236 428,168 L410,250 Z" fill="${darker(base, 0.2)}"/>
  <path d="M452,360 Q420,520 470,712" fill="none" stroke="${darker(base, 0.25)}" stroke-width="5"/>
  <path d="M346,352 Q400,372 454,352 L456,378 Q400,396 344,378 Z" fill="${darker(base, 0.3)}"/>
  <path d="M452,372 Q500,420 488,486 M458,374 Q520,404 528,462" fill="none" stroke="${darker(base, 0.3)}" stroke-width="12" stroke-linecap="round"/>`;
}

function ribbedTop(base: string, id: string): string {
  const body =
    'M318,236 L362,236 Q400,286 438,236 L482,236 L506,340 L512,488 Q400,506 288,488 L294,340 Z';
  return `
  <defs><pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse">
    <rect width="7" height="16" fill="${lighter(base, 0.12)}"/>
  </pattern></defs>
  <path d="M330,236 L326,150 Q340,140 352,150 L362,236 M470,236 L474,150 Q460,140 448,150 L438,236" fill="${base}"/>
  <path d="${body}" fill="${base}"/>
  <path d="${body}" fill="url(#${id})" opacity=".7"/>
  <path d="M362,236 Q400,286 438,236" fill="none" stroke="${darker(base, 0.3)}" stroke-width="8"/>
  <path d="M288,470 Q400,488 512,470 L512,488 Q400,506 288,488 Z" fill="${darker(base, 0.25)}"/>`;
}

function tshirt(base: string): string {
  return `
  <path d="M300,196 L352,172 Q400,214 448,172 L500,196 L602,272 L558,346 L504,312 L506,660 Q400,676 294,660 L296,312 L242,346 L198,272 Z" fill="${base}"/>
  <path d="M352,172 Q400,214 448,172 L438,168 Q400,198 362,168 Z" fill="${darker(base, 0.35)}"/>
  <path d="M352,172 Q400,214 448,172" fill="none" stroke="${darker(base, 0.3)}" stroke-width="10"/>
  <path d="M242,346 L198,272 M558,346 L602,272" stroke="${darker(base, 0.2)}" stroke-width="12"/>
  <path d="M296,312 Q300,260 312,232 M504,312 Q500,260 488,232" fill="none" stroke="${darker(base, 0.12)}" stroke-width="4"/>`;
}

function oxfordShirt(base: string, id: string): string {
  return `
  <defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">
    <path d="M0,8 L8,0" stroke="${darker(base, 0.08)}" stroke-width="2"/>
  </pattern></defs>
  <path d="M300,196 L360,168 L440,168 L500,196 L560,250 L620,640 L566,652 L512,330 L508,676 Q400,690 292,676 L288,330 L234,652 L180,640 L240,250 Z" fill="${base}"/>
  <path d="M300,196 L360,168 L440,168 L500,196 L560,250 L620,640 L566,652 L512,330 L508,676 Q400,690 292,676 L288,330 L234,652 L180,640 L240,250 Z" fill="url(#${id})"/>
  <path d="M360,168 L400,214 L440,168 L452,206 L404,238 L400,214 L396,238 L348,206 Z" fill="${lighter(base, 0.4)}" stroke="${darker(base, 0.2)}" stroke-width="3"/>
  <path d="M400,236 V684" stroke="${darker(base, 0.18)}" stroke-width="4"/>
  ${[290, 360, 430, 500, 570].map((y) => `<circle cx="408" cy="${y}" r="6" fill="${lighter(base, 0.5)}" stroke="${darker(base, 0.3)}" stroke-width="2"/>`).join('')}
  <rect x="312" y="300" width="62" height="70" rx="6" fill="none" stroke="${darker(base, 0.2)}" stroke-width="4"/>
  <path d="M566,652 L620,640 L626,672 L570,684 Z M234,652 L180,640 L174,672 L230,684 Z" fill="${darker(base, 0.12)}"/>`;
}

function jeans(base: string): string {
  const stitch = '#d9a24a';
  return `
  <defs><linearGradient id="denim" x1="0" x2="1"><stop offset="0" stop-color="${lighter(base, 0.12)}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${darker(base, 0.15)}"/></linearGradient></defs>
  <path d="M286,210 L514,210 L540,702 L418,702 L400,352 L382,702 L260,702 Z" fill="url(#denim)"/>
  <rect x="282" y="168" width="236" height="44" rx="6" fill="${darker(base, 0.12)}"/>
  <path d="M282,190 H518" stroke="${stitch}" stroke-width="2" stroke-dasharray="6 5"/>
  ${[300, 352, 448, 500].map((x) => `<rect x="${x - 6}" y="164" width="12" height="52" rx="3" fill="${darker(base, 0.25)}"/>`).join('')}
  <path d="M300,214 Q330,270 370,260 M500,214 Q470,270 430,260" fill="none" stroke="${stitch}" stroke-width="3"/>
  <path d="M400,212 V340 Q392,360 380,350" fill="none" stroke="${stitch}" stroke-width="3"/>
  <circle cx="400" cy="190" r="9" fill="#c9a24f"/>
  <path d="M268,690 L380,690 M420,690 L532,690" stroke="${stitch}" stroke-width="3" stroke-dasharray="6 5"/>
  <path d="M330,300 Q340,470 320,690 M470,300 Q460,470 480,690" fill="none" stroke="${lighter(base, 0.2)}" stroke-width="6" opacity=".5"/>`;
}

function linenSet(base: string, id: string): string {
  return `
  <defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse">
    <path d="M0,5 H10" stroke="${darker(base, 0.06)}" stroke-width="2"/><path d="M5,0 V10" stroke="${lighter(base, 0.1)}" stroke-width="1.5"/>
  </pattern></defs>
  <path d="M468,340 L612,340 L630,700 L566,700 L540,420 L520,700 L456,700 Z" fill="${darker(base, 0.08)}"/>
  <path d="M468,340 L612,340 L630,700 L566,700 L540,420 L520,700 L456,700 Z" fill="url(#${id})"/>
  <path d="M262,160 L332,160 L366,176 L438,236 L410,288 L380,262 L384,640 L208,640 L212,262 L182,288 L154,236 L228,176 Z" fill="${base}"/>
  <path d="M262,160 L332,160 L366,176 L438,236 L410,288 L380,262 L384,640 L208,640 L212,262 L182,288 L154,236 L228,176 Z" fill="url(#${id})"/>
  <rect x="270" y="146" width="56" height="20" rx="6" fill="${darker(base, 0.15)}"/>
  <path d="M298,166 V330" stroke="${darker(base, 0.25)}" stroke-width="4"/>
  ${[200, 246, 292].map((y) => `<circle cx="306" cy="${y}" r="5" fill="${darker(base, 0.35)}"/>`).join('')}
  <path d="M208,600 L384,600" stroke="${darker(base, 0.15)}" stroke-width="3" stroke-dasharray="8 6"/>`;
}

// ---------------------------------------------------------------- footwear (side view, toe on the left)
function sole(fill: string, edge: string, height = 46): string {
  return `
  <path d="M164,${594 - height} Q150,600 196,608 L604,608 Q644,604 644,${594 - height} Z" fill="${fill}"/>
  <path d="M168,${598 - height / 2} H640" stroke="${edge}" stroke-width="4"/>`;
}

function sneaker(upper: string, soleColour: string, accent: string, id: string): string {
  return `
  <defs><pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse">
    <path d="M0,6 Q3,0 6,6 T12,6" fill="none" stroke="${lighter(upper, 0.12)}" stroke-width="2"/>
  </pattern></defs>
  ${sole(soleColour, darker(soleColour, 0.15))}
  <path d="M178,552 Q180,470 246,446 L376,404 Q420,390 452,360 L500,338 Q548,330 566,370 L604,452 Q640,494 636,552 Z" fill="${upper}"/>
  <path d="M178,552 Q180,470 246,446 L376,404 Q420,390 452,360 L500,338 Q548,330 566,370 L604,452 Q640,494 636,552 Z" fill="url(#${id})"/>
  <path d="M178,552 Q178,500 210,468 Q250,500 252,552 Z" fill="${darker(upper, 0.15)}"/>
  <path d="M560,366 Q600,420 610,470 L636,552 L590,552 Q580,450 540,400 Z" fill="${accent}"/>
  <path d="M300,500 Q420,470 560,500" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>
  ${[0, 1, 2, 3, 4].map((step) => `<path d="M${352 + step * 24},${420 - step * 14} l34,24" stroke="${lighter(upper, 0.6)}" stroke-width="7" stroke-linecap="round"/>`).join('')}
  <path d="M500,338 Q530,330 548,350" fill="none" stroke="${darker(upper, 0.3)}" stroke-width="10" stroke-linecap="round"/>`;
}

function derby(leather: string): string {
  return `
  <defs><linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".6" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>
  <path d="M168,566 Q156,594 196,600 L604,600 Q636,598 636,566 Z" fill="#2b1d16"/>
  <rect x="540" y="572" width="96" height="34" rx="6" fill="#2b1d16"/>
  <path d="M176,566 Q174,500 244,474 L380,438 Q440,424 470,392 L520,380 Q570,380 590,420 L620,480 Q640,520 632,566 Z" fill="${leather}"/>
  <path d="M176,566 Q174,500 244,474 L380,438 Q440,424 470,392 L520,380 Q570,380 590,420 L620,480 Q640,520 632,566 Z" fill="url(#gloss)"/>
  <path d="M380,438 Q440,424 470,392 L520,380 Q500,450 420,470 Z" fill="${darker(leather, 0.2)}"/>
  ${[0, 1, 2].map((step) => `<path d="M${420 + step * 26},${440 - step * 14} l26,16" stroke="#1d1410" stroke-width="5" stroke-linecap="round"/>`).join('')}
  <path d="M190,556 Q400,540 626,556" fill="none" stroke="${lighter(leather, 0.3)}" stroke-width="3" stroke-dasharray="8 6"/>
  <path d="M240,520 Q300,470 380,466" fill="none" stroke="${lighter(leather, 0.25)}" stroke-width="3" stroke-dasharray="8 6"/>`;
}

function slipOn(canvas: string, id: string): string {
  const outline = darker(canvas, 0.35);
  return `
  <defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">
    <rect width="8" height="8" fill="${canvas}"/><path d="M0,4 H8 M4,0 V8" stroke="${darker(canvas, 0.1)}" stroke-width="1.5"/>
  </pattern></defs>
  ${sole('#ffffff', '#c7c2b6', 52)}
  <path d="M164,560 H644" stroke="#2f5d9e" stroke-width="6"/>
  <path d="M178,546 Q174,470 240,446 L400,406 Q450,396 492,384 Q560,372 596,410 L622,470 Q640,506 636,546 Z" fill="url(#${id})" stroke="${outline}" stroke-width="4"/>
  <path d="M400,406 Q450,396 492,384 Q560,372 596,410 Q560,430 520,428 Q470,426 430,440 Z" fill="${darker(canvas, 0.55)}"/>
  <rect x="470" y="400" width="24" height="54" rx="6" fill="${darker(canvas, 0.3)}"/>
  <path d="M190,520 Q300,500 420,470" fill="none" stroke="${outline}" stroke-width="3" stroke-dasharray="7 6"/>
  <path d="M178,546 Q178,500 206,476 Q240,506 244,546 Z" fill="${darker(canvas, 0.12)}"/>`;
}

function strappySandal(leather: string): string {
  return `
  <path d="M164,586 Q160,604 196,606 L606,606 Q640,604 640,586 Z" fill="${darker(leather, 0.35)}"/>
  <rect x="164" y="568" width="476" height="20" rx="10" fill="${lighter(leather, 0.2)}"/>
  <path d="M220,570 Q250,500 320,500 Q360,500 380,570" fill="none" stroke="${leather}" stroke-width="22"/>
  <path d="M330,570 Q380,470 470,480 M400,570 Q440,500 510,500" fill="none" stroke="${leather}" stroke-width="18"/>
  <path d="M520,570 Q520,420 560,380 Q600,380 610,570" fill="none" stroke="${leather}" stroke-width="18"/>
  <path d="M470,420 Q560,380 640,420" fill="none" stroke="${leather}" stroke-width="16"/>
  <rect x="616" y="404" width="30" height="34" rx="5" fill="none" stroke="#c9a24f" stroke-width="6"/>`;
}

function loafer(suede: string, id: string): string {
  return `
  <defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="${suede}"/><circle cx="2" cy="2" r="1" fill="${darker(suede, 0.12)}"/><circle cx="5" cy="5" r="1" fill="${lighter(suede, 0.12)}"/>
  </pattern></defs>
  <path d="M168,568 Q156,596 196,602 L604,602 Q636,600 636,568 Z" fill="#3a2a20"/>
  <rect x="548" y="572" width="88" height="34" rx="6" fill="#3a2a20"/>
  <path d="M178,568 Q176,506 246,484 L420,452 Q470,446 520,438 Q590,436 616,480 L634,568 Z" fill="url(#${id})"/>
  <path d="M300,476 Q400,446 500,452 L496,486 Q400,480 306,506 Z" fill="${darker(suede, 0.2)}"/>
  <rect x="384" y="462" width="56" height="12" rx="6" fill="${darker(suede, 0.45)}"/>
  <path d="M246,484 Q300,440 360,454" fill="none" stroke="${lighter(suede, 0.25)}" stroke-width="3" stroke-dasharray="6 5"/>`;
}

function hikingBoot(leather: string): string {
  return `
  <path d="M164,560 Q150,604 196,612 L604,612 Q646,606 646,560 Z" fill="#2a2522"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((step) => `<rect x="${186 + step * 50}" y="606" width="30" height="14" rx="3" fill="#2a2522"/>`).join('')}
  <path d="M176,560 Q172,480 236,460 L360,430 L400,240 L560,224 Q590,224 594,260 L614,470 Q644,510 640,560 Z" fill="${leather}"/>
  <path d="M176,560 Q172,480 236,460 L330,440 Q300,520 300,560 Z" fill="${darker(leather, 0.25)}"/>
  <path d="M560,224 Q594,224 594,260 L614,470 Q644,510 640,560 L580,560 Q590,400 548,232 Z" fill="${darker(leather, 0.2)}"/>
  <rect x="394" y="214" width="174" height="34" rx="12" fill="${darker(leather, 0.35)}"/>
  ${[0, 1, 2, 3, 4].map((step) => `<path d="M${408 - step * 6},${270 + step * 38} h70" stroke="#e0b44a" stroke-width="6" stroke-linecap="round"/><circle cx="${404 - step * 6}" cy="${270 + step * 38}" r="7" fill="#9c9c9c"/>`).join('')}
  <path d="M184,548 H636" stroke="#e0b44a" stroke-width="4"/>`;
}

function walkingShoe(upper: string, id: string): string {
  return `
  <defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse">
    <rect width="10" height="10" fill="${upper}"/><circle cx="5" cy="5" r="2.2" fill="${darker(upper, 0.18)}"/>
  </pattern></defs>
  ${sole('#ffffff', '#cfd4dc', 52)}
  <path d="M176,548 Q178,474 244,452 L380,414 Q430,400 460,374 L508,356 Q552,350 570,388 L604,458 Q640,500 636,548 Z" fill="url(#${id})"/>
  <path d="M176,548 Q176,500 206,474 Q246,504 248,548 Z" fill="${darker(upper, 0.2)}"/>
  <rect x="352" y="392" width="150" height="40" rx="12" transform="rotate(-22 427 412)" fill="${darker(upper, 0.35)}"/>
  <path d="M566,384 Q604,440 612,480 L636,548 L596,548 Q586,456 548,400 Z" fill="#3b82c4"/>`;
}

function kolhapuri(leather: string, id: string): string {
  const one = (x: number) => `
  <path d="M${x},230 Q${x + 70},214 ${x + 96},300 Q${x + 120},420 ${x + 104},560 Q${x + 92},660 ${x + 40},664 Q${x - 12},660 ${x - 24},560 Q${x - 44},420 ${x - 26},300 Q${x - 4},226 ${x},230 Z" fill="${leather}"/>
  <path d="M${x},242 Q${x + 60},232 ${x + 82},300 Q${x + 104},420 ${x + 90},556 Q${x + 80},646 ${x + 40},650 Q${x},646 ${x - 10},556 Q${x - 30},420 ${x - 14},300 Q${x - 2},238 ${x},242 Z" fill="${lighter(leather, 0.2)}"/>
  <path d="M${x - 30},400 Q${x + 36},360 ${x + 106},400 L${x + 106},446 Q${x + 36},410 ${x - 30},446 Z" fill="url(#${id})"/>
  <circle cx="${x + 30}" cy="300" r="16" fill="none" stroke="${darker(leather, 0.35)}" stroke-width="8"/>
  <path d="M${x + 30},316 L${x + 36},390" stroke="${darker(leather, 0.35)}" stroke-width="8"/>`;
  return `
  <defs><pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse">
    <rect width="16" height="16" fill="${darker(leather, 0.2)}"/><path d="M0,8 L8,0 L16,8 L8,16 Z" fill="none" stroke="${lighter(leather, 0.25)}" stroke-width="2"/>
  </pattern></defs>${one(300)}${one(470)}`;
}

// ---------------------------------------------------------------- electronics
function smartphone(
  body: string,
  wallpaperFrom: string,
  wallpaperTo: string,
  brand: string,
  id: string,
): string {
  return `
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wallpaperFrom}"/><stop offset="1" stop-color="${wallpaperTo}"/></linearGradient></defs>
  <g transform="rotate(10 520 400)">
    <rect x="410" y="170" width="220" height="456" rx="34" fill="${body}"/>
    <rect x="430" y="192" width="100" height="120" rx="24" fill="${darker(body, 0.3)}"/>
    <circle cx="462" cy="224" r="20" fill="#11151c" stroke="#5b6270" stroke-width="5"/>
    <circle cx="462" cy="282" r="20" fill="#11151c" stroke="#5b6270" stroke-width="5"/>
    <circle cx="506" cy="224" r="7" fill="#f6e7a8"/>
    ${label(520, 560, brand, 18, lighter(body, 0.5), 600, 3)}
  </g>
  <rect x="200" y="150" width="228" height="476" rx="36" fill="#11151c"/>
  <rect x="212" y="162" width="204" height="452" rx="28" fill="url(#${id})"/>
  <circle cx="314" cy="186" r="8" fill="#0b0d12"/>
  ${label(314, 290, '10:24', 52, '#ffffff', 300, 0)}
  ${label(314, 322, 'Monday, 15 November', 14, '#ffffff', 400, 0)}
  ${[0, 1, 2, 3].map((column) => `<rect x="${236 + column * 44}" y="540" width="30" height="30" rx="9" fill="#ffffff" opacity=".85"/>`).join('')}`;
}

function earbudsCase(shell: string): string {
  const rim = lighter(shell, 0.35);
  const bud = (x: number, tilt: number) => `
  <g transform="translate(${x} 250) rotate(${tilt})">
    <rect x="-14" y="20" width="28" height="130" rx="14" fill="${shell}" stroke="${rim}" stroke-width="3"/>
    <ellipse cx="0" cy="0" rx="42" ry="38" fill="${shell}" stroke="${rim}" stroke-width="3"/>
    <ellipse cx="-14" cy="-8" rx="16" ry="14" fill="${darker(shell, 0.4)}"/>
    <rect x="-8" y="136" width="16" height="12" rx="4" fill="#c4c9d1"/>
  </g>`;
  return `
  <path d="M250,392 Q250,330 330,330 L470,330 Q550,330 550,392 Z" fill="${lighter(shell, 0.12)}"/>
  <path d="M250,404 H550 V520 Q550,610 470,610 H330 Q250,610 250,520 Z" fill="${shell}"/>
  <rect x="250" y="390" width="300" height="16" fill="${darker(shell, 0.2)}"/>
  <path d="M270,420 H530" stroke="${rim}" stroke-width="3" opacity=".6"/>
  <circle cx="400" cy="560" r="7" fill="#4ade80"/>
  ${label(400, 500, 'VOLTIX', 16, rim, 600, 5)}
  ${bud(200, -14)}${bud(600, 14)}`;
}

function neckband(band: string, accent: string): string {
  return `
  <path d="M220,300 Q220,600 400,610 Q580,600 580,300" fill="none" stroke="${band}" stroke-width="42" stroke-linecap="round"/>
  <rect x="190" y="250" width="60" height="120" rx="26" fill="${band}"/>
  <rect x="550" y="250" width="60" height="120" rx="26" fill="${band}"/>
  <rect x="200" y="290" width="40" height="8" rx="4" fill="${accent}"/>
  <rect x="560" y="290" width="40" height="8" rx="4" fill="${accent}"/>
  <path d="M220,250 Q200,180 260,170 M580,250 Q600,180 540,170" fill="none" stroke="#2b2f36" stroke-width="6"/>
  <circle cx="276" cy="168" r="26" fill="${band}"/><circle cx="276" cy="168" r="12" fill="${accent}"/>
  <circle cx="524" cy="168" r="26" fill="${band}"/><circle cx="524" cy="168" r="12" fill="${accent}"/>`;
}

function charger(shell: string, watts: string, ports: number): string {
  const text = shell === '#f4f5f7' ? '#5b6270' : '#d1d5db';
  return `
  <rect x="356" y="170" width="20" height="90" rx="4" fill="#c4c9d1"/>
  <rect x="424" y="170" width="20" height="90" rx="4" fill="#c4c9d1"/>
  <path d="M276,262 L524,262 L560,300 L560,600 Q560,630 530,630 L306,630 Q276,630 276,600 Z" fill="${darker(shell, 0.08)}"/>
  <rect x="246" y="250" width="290" height="380" rx="40" fill="${shell}"/>
  ${label(391, 370, watts, 46, text, 700, 2)}
  ${label(391, 404, 'GaN FAST CHARGE', 15, text, 500, 3)}
  ${Array.from({ length: ports }, (_, index) => `<rect x="336" y="${470 + index * 56}" width="110" height="30" rx="15" fill="#1b1f27"/><rect x="352" y="${480 + index * 56}" width="78" height="10" rx="5" fill="#4b5563"/>`).join('')}`;
}

function laptop(shell: string, wallpaperFrom: string, wallpaperTo: string, id: string): string {
  return `
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wallpaperFrom}"/><stop offset="1" stop-color="${wallpaperTo}"/></linearGradient></defs>
  <rect x="176" y="190" width="448" height="296" rx="18" fill="${darker(shell, 0.45)}"/>
  <rect x="192" y="206" width="416" height="262" rx="6" fill="url(#${id})"/>
  <path d="M192,420 Q300,330 400,380 T608,330 V468 H192 Z" fill="#ffffff" opacity=".15"/>
  <rect x="236" y="250" width="150" height="16" rx="8" fill="#ffffff" opacity=".7"/>
  <rect x="236" y="278" width="100" height="12" rx="6" fill="#ffffff" opacity=".5"/>
  <path d="M130,486 L670,486 L706,528 Q708,544 690,544 L110,544 Q92,544 94,528 Z" fill="${shell}"/>
  <path d="M130,486 L670,486 L678,496 L122,496 Z" fill="${darker(shell, 0.15)}"/>
  <rect x="350" y="486" width="100" height="10" rx="5" fill="${darker(shell, 0.25)}"/>`;
}

function powerBank(shell: string): string {
  const text = shell === '#f4f5f7' ? '#4b5563' : '#cbd5e1';
  return `
  <rect x="280" y="188" width="248" height="420" rx="40" fill="${darker(shell, 0.12)}"/>
  <rect x="262" y="180" width="248" height="420" rx="40" fill="${shell}"/>
  ${label(386, 360, 'VOLTIX', 26, text, 700, 6)}
  ${label(386, 398, '20000 mAh', 22, text, 400, 2)}
  ${[0, 1, 2, 3].map((index) => `<circle cx="${350 + index * 24}" cy="520" r="7" fill="${index < 3 ? '#38bdf8' : '#475569'}"/>`).join('')}
  <rect x="340" y="586" width="92" height="14" rx="7" fill="#1b1f27"/>`;
}

function sportEarphones(body: string, accent: string): string {
  const bud = (x: number, flip: number) => `
  <g transform="translate(${x} 330) scale(${flip} 1)">
    <path d="M-40,-30 Q-90,-110 -20,-150 Q40,-170 60,-110" fill="none" stroke="${body}" stroke-width="16" stroke-linecap="round"/>
    <ellipse cx="0" cy="0" rx="46" ry="40" fill="${body}"/>
    <ellipse cx="-20" cy="-4" rx="18" ry="16" fill="${accent}"/>
    <rect x="-10" y="30" width="20" height="44" rx="10" fill="${body}"/>
  </g>`;
  return `
  <path d="M290,404 Q300,520 400,560 Q500,520 510,404" fill="none" stroke="#2b2f36" stroke-width="7"/>
  <path d="M400,560 Q404,640 380,690" fill="none" stroke="#2b2f36" stroke-width="7"/>
  <rect x="384" y="548" width="32" height="40" rx="8" fill="${accent}"/>
  ${bud(290, 1)}${bud(510, -1)}`;
}

// ---------------------------------------------------------------- beauty
function faceWashTube(colour: string, title: string, subtitle: string, brand: string): string {
  return `
  <rect x="338" y="560" width="124" height="76" rx="14" fill="${darker(colour, 0.25)}"/>
  <path d="M342,566 L296,232 L504,232 L458,566 Z" fill="#ffffff"/>
  <path d="M332,500 L310,342 L490,342 L468,500 Z" fill="${colour}"/>
  <rect x="290" y="204" width="220" height="32" rx="4" fill="${lighter(colour, 0.6)}"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => `<path d="M${302 + index * 20},208 v24" stroke="${lighter(colour, 0.3)}" stroke-width="3"/>`).join('')}
  ${label(400, 300, brand, 13, darker(colour, 0.4), 600, 3)}
  ${label(400, 410, title, title.length > 7 ? 22 : 26, '#ffffff', 700, 1)}
  ${label(400, 440, subtitle, 11, '#ffffff', 500, 1)}
  ${label(400, 530, '100 ml', 13, darker(colour, 0.4), 500, 1)}`;
}

function creamJar(
  body: string,
  lid: string,
  title: string,
  subtitle: string,
  brand: string,
  textColour: string,
): string {
  return `
  <ellipse cx="400" cy="606" rx="150" ry="20" fill="${darker(body, 0.15)}"/>
  <rect x="250" y="410" width="300" height="196" rx="28" fill="${body}"/>
  <rect x="236" y="330" width="328" height="94" rx="22" fill="${lid}"/>
  <rect x="236" y="400" width="328" height="10" fill="${darker(lid, 0.2)}"/>
  ${label(400, 470, brand, 13, textColour, 600, 3)}
  ${label(400, 520, title, 30, textColour, 700, 1)}
  ${label(400, 552, subtitle, 15, textColour, 400, 2)}
  <rect x="272" y="350" width="120" height="10" rx="5" fill="#ffffff" opacity=".35"/>`;
}

function lipstick(shade: string): string {
  return `
  <g transform="rotate(-8 400 460)">
    <rect x="352" y="420" width="96" height="220" rx="10" fill="#1f1a1c"/>
    <rect x="352" y="420" width="96" height="28" fill="#c9a24f"/>
    <rect x="366" y="318" width="68" height="110" rx="6" fill="#d8b866"/>
    <path d="M374,330 L374,232 Q374,200 400,184 L426,214 L426,330 Z" fill="${shade}"/>
    <path d="M382,320 L382,236 Q382,214 398,202" fill="none" stroke="#ffffff" stroke-width="6" opacity=".35"/>
  </g>
  <g transform="rotate(68 560 560)">
    <rect x="512" y="470" width="100" height="190" rx="12" fill="#1f1a1c"/>
    <rect x="512" y="470" width="100" height="24" fill="#c9a24f"/>
  </g>
  <circle cx="240" cy="590" r="34" fill="${shade}"/>
  <circle cx="226" cy="578" r="10" fill="#ffffff" opacity=".35"/>`;
}

function lipBalm(shade: string): string {
  return `
  <g transform="rotate(-14 400 420)">
    <rect x="356" y="300" width="88" height="300" rx="44" fill="${lighter(shade, 0.65)}"/>
    <rect x="356" y="300" width="88" height="110" rx="44" fill="${shade}"/>
    <rect x="356" y="380" width="88" height="30" fill="${shade}"/>
    ${label(400, 500, 'TINTED', 15, darker(shade, 0.3), 700, 2)}
    ${label(400, 524, 'LIP BALM', 15, darker(shade, 0.3), 700, 2)}
    ${label(400, 552, 'SPF 15', 12, darker(shade, 0.3), 500, 1)}
  </g>
  <path d="M520,520 Q560,470 600,520 Q560,570 520,520 Z" fill="${shade}" opacity=".8"/>`;
}

function tonerBottle(liquid: string): string {
  return `
  <defs><linearGradient id="glass" x1="0" x2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".3" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>
  <rect x="372" y="160" width="56" height="70" rx="10" fill="#d1b06a"/>
  <rect x="382" y="226" width="36" height="34" fill="#e7eef2"/>
  <path d="M330,300 Q330,260 382,256 L418,256 Q470,260 470,300 L476,626 Q476,646 456,646 L344,646 Q324,646 324,626 Z" fill="${liquid}"/>
  <path d="M330,300 Q330,260 382,256 L418,256 Q470,260 470,300 L476,626 Q476,646 456,646 L344,646 Q324,646 324,626 Z" fill="url(#glass)"/>
  <rect x="338" y="400" width="124" height="170" rx="10" fill="#ffffff"/>
  ${[0, 72, 144, 216, 288].map((angle) => `<ellipse cx="400" cy="444" rx="11" ry="20" transform="rotate(${angle} 400 458)" fill="#e0567f"/>`).join('')}
  <circle cx="400" cy="458" r="8" fill="#f7c948"/>
  ${label(400, 512, 'ROSE WATER', 14, '#9f1d4a', 700, 2)}
  ${label(400, 534, 'TONER', 14, '#9f1d4a', 700, 2)}
  ${label(400, 556, 'Glow Botanica', 11, '#6b7280', 400, 1)}`;
}

// ---------------------------------------------------------------- products
type Category = 'apparel' | 'footwear' | 'electronics' | 'beauty';

const backgrounds: Record<Category, readonly [string, string, string]> = {
  apparel: ['#fbeff2', '#f3e8ff', '#fef6e4'],
  footwear: ['#fdf3e7', '#eef4f1', '#f1f1f4'],
  electronics: ['#eaf0fb', '#eef2f6', '#e9f5f8'],
  beauty: ['#fdeef3', '#eef7ee', '#fff4ec'],
};

interface ProductArt {
  slug: string;
  category: Category;
  draw: (id: string) => string;
}

const products: readonly ProductArt[] = [
  {
    slug: 'anarkali-kurta-indigo-print',
    category: 'apparel',
    draw: (id) => kurta('#2e3f8f', '#ffffff', id),
  },
  {
    slug: 'anarkali-kurta-rust-print',
    category: 'apparel',
    draw: (id) => kurta('#b5532a', '#f6e3c5', id),
  },
  {
    slug: 'anarkali-kurta-emerald-print',
    category: 'apparel',
    draw: (id) => kurta('#1f7a5a', '#f7d9e3', id),
  },
  { slug: 'banarasi-silk-saree', category: 'apparel', draw: (id) => saree('#7a1430', id) },
  {
    slug: 'floral-wrap-dress',
    category: 'apparel',
    draw: (id) => wrapDress('#f2c230', '#ffffff', id),
  },
  { slug: 'ribbed-crop-top', category: 'apparel', draw: (id) => ribbedTop('#26272b', id) },
  { slug: 'classic-crew-tshirt', category: 'apparel', draw: () => tshirt('#25272c') },
  { slug: 'oxford-formal-shirt', category: 'apparel', draw: (id) => oxfordShirt('#f7f8fb', id) },
  { slug: 'slim-fit-stretch-jeans', category: 'apparel', draw: () => jeans('#3a5f9a') },
  { slug: 'linen-kurta-set', category: 'apparel', draw: (id) => linenSet('#e6d5b8', id) },
  {
    slug: 'runner-sneaker-black',
    category: 'footwear',
    draw: (id) => sneaker('#25272c', '#f5f5f5', '#e2554a', id),
  },
  {
    slug: 'runner-sneaker-white',
    category: 'footwear',
    draw: (id) => sneaker('#f3f4f6', '#e5e7eb', '#9ca3af', id),
  },
  {
    slug: 'runner-sneaker-grey',
    category: 'footwear',
    draw: (id) => sneaker('#8a9099', '#f5f5f5', '#3b4252', id),
  },
  { slug: 'leather-derby-shoe', category: 'footwear', draw: () => derby('#7a4a2a') },
  { slug: 'canvas-slip-on', category: 'footwear', draw: (id) => slipOn('#f2efe6', id) },
  { slug: 'strappy-flat-sandal', category: 'footwear', draw: () => strappySandal('#b9824f') },
  { slug: 'suede-loafer', category: 'footwear', draw: (id) => loafer('#b98a5a', id) },
  { slug: 'trail-hiking-boot', category: 'footwear', draw: () => hikingBoot('#7b5536') },
  { slug: 'everyday-walking-shoe', category: 'footwear', draw: (id) => walkingShoe('#9aa1ab', id) },
  { slug: 'kolhapuri-flat', category: 'footwear', draw: (id) => kolhapuri('#b9824f', id) },
  {
    slug: 'voltix-nova-5g-smartphone',
    category: 'electronics',
    draw: (id) => smartphone('#1d2433', '#2563eb', '#06b6d4', 'VOLTIX', id),
  },
  {
    slug: 'nimbus-x1-smartphone',
    category: 'electronics',
    draw: (id) => smartphone('#22252c', '#7c3aed', '#ec4899', 'NIMBUS', id),
  },
  { slug: 'voltix-airbuds-pro', category: 'electronics', draw: () => earbudsCase('#26292f') },
  {
    slug: 'nimbus-neckband-lite',
    category: 'electronics',
    draw: () => neckband('#25272c', '#3b82f6'),
  },
  {
    slug: 'voltix-65w-gan-charger',
    category: 'electronics',
    draw: () => charger('#f4f5f7', '65W', 3),
  },
  {
    slug: 'nimbus-20w-fast-charger',
    category: 'electronics',
    draw: () => charger('#25272c', '20W', 1),
  },
  {
    slug: 'nimbus-air-14-laptop',
    category: 'electronics',
    draw: (id) => laptop('#c9ced6', '#60a5fa', '#a78bfa', id),
  },
  {
    slug: 'voltix-creator-16-laptop',
    category: 'electronics',
    draw: (id) => laptop('#3a3f48', '#f97316', '#db2777', id),
  },
  { slug: 'voltix-power-bank-20000', category: 'electronics', draw: () => powerBank('#25272c') },
  {
    slug: 'nimbus-sport-earphones',
    category: 'electronics',
    draw: () => sportEarphones('#25272c', '#e2554a'),
  },
  {
    slug: 'aloe-gentle-face-wash',
    category: 'beauty',
    draw: () => faceWashTube('#4caf6e', 'ALOE', 'GENTLE FACE WASH', 'GLOW BOTANICA'),
  },
  {
    slug: 'charcoal-deep-clean-face-wash',
    category: 'beauty',
    draw: () => faceWashTube('#30333a', 'CHARCOAL', 'DEEP CLEAN WASH', 'GLOW BOTANICA'),
  },
  {
    slug: 'vitamin-c-glow-face-wash',
    category: 'beauty',
    draw: () => faceWashTube('#f08a24', 'VITAMIN C', 'GLOW FACE WASH', 'VELVET HUE'),
  },
  {
    slug: 'hyaluronic-gel-moisturiser',
    category: 'beauty',
    draw: () =>
      creamJar('#cfe8f7', '#ffffff', 'HYALURONIC', 'GEL MOISTURISER', 'GLOW BOTANICA', '#1e5a85'),
  },
  {
    slug: 'shea-butter-night-cream',
    category: 'beauty',
    draw: () =>
      creamJar('#3b2a5c', '#d1b06a', 'SHEA BUTTER', 'NIGHT CREAM', 'VELVET HUE', '#f3e8c8'),
  },
  {
    slug: 'ceramide-barrier-moisturiser',
    category: 'beauty',
    draw: () =>
      creamJar('#ffffff', '#2f6fb3', 'CERAMIDE', 'BARRIER CREAM', 'GLOW BOTANICA', '#2f6fb3'),
  },
  { slug: 'velvet-matte-lipstick', category: 'beauty', draw: () => lipstick('#9b1b30') },
  { slug: 'creme-satin-lipstick', category: 'beauty', draw: () => lipstick('#c45c74') },
  { slug: 'tinted-lip-balm', category: 'beauty', draw: () => lipBalm('#e86a8a') },
  { slug: 'rose-water-toner', category: 'beauty', draw: () => tonerBottle('#f6c6d4') },
];

// Three views per product: the product on its own; a closer crop; the product on a surface.
function productSvg(art: ProductArt, view: number): string {
  const id = `p${String(view)}`;
  const [first, second, third] = backgrounds[art.category];
  const background = [first, second, third][view] ?? first;
  const shadow = `<ellipse cx="400" cy="680" rx="240" ry="22" fill="url(#shadow)"/>`;
  const drawing = art.draw(id);
  const framed =
    view === 1
      ? `<g transform="translate(400 420) scale(1.32) translate(-400 -420)">${drawing}</g>`
      : view === 2
        ? `<circle cx="400" cy="400" r="300" fill="#ffffff" opacity=".7"/>${shadow}<g transform="translate(400 420) scale(.86) translate(-400 -420)">${drawing}</g>`
        : `${shadow}${drawing}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighter(background, 0.4)}"/><stop offset="1" stop-color="${background}"/></linearGradient>
    <radialGradient id="shadow"><stop offset="0" stop-color="#000000" stop-opacity=".18"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>
    <filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity=".14"/></filter>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <g filter="url(#lift)">${framed}</g>
</svg>
`;
}

// ---------------------------------------------------------------- banners (1600 × 500)
function find(slug: string): ProductArt {
  const art = products.find((product) => product.slug === slug);
  if (art === undefined) throw new Error(`no art for ${slug}`);
  return art;
}

function bannerSvg(from: string, to: string, slugs: readonly string[]): string {
  const placed = slugs
    .map((slug, index) => {
      const x = 700 + index * 275;
      return `<g transform="translate(${String(x)} 40) scale(.5)"><circle cx="400" cy="420" r="330" fill="#ffffff" opacity=".18"/>${find(slug).draw(`b${String(index)}`)}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 500" width="1600" height="500">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="1600" height="500" fill="url(#bg)"/>
  <circle cx="160" cy="80" r="220" fill="#ffffff" opacity=".08"/><circle cx="560" cy="520" r="200" fill="#ffffff" opacity=".06"/>
  ${placed}
</svg>
`;
}

const banners = [
  {
    key: 'festive',
    from: '#7a1430',
    to: '#d97706',
    slugs: ['banarasi-silk-saree', 'anarkali-kurta-rust-print', 'velvet-matte-lipstick'],
  },
  {
    key: 'electronics',
    from: '#1e3a8a',
    to: '#0891b2',
    slugs: ['voltix-nova-5g-smartphone', 'voltix-airbuds-pro', 'voltix-65w-gan-charger'],
  },
  {
    key: 'expired-summer',
    from: '#0f766e',
    to: '#facc15',
    slugs: ['floral-wrap-dress', 'strappy-flat-sandal', 'rose-water-toner'],
  },
] as const;

mkdirSync(path.join(outputDirectory, 'products'), { recursive: true });
mkdirSync(path.join(outputDirectory, 'banners'), { recursive: true });
for (const art of products) {
  for (const view of [0, 1, 2]) {
    writeFileSync(
      path.join(outputDirectory, 'products', `${art.slug}-${String(view)}.svg`),
      productSvg(art, view),
    );
  }
}
for (const banner of banners) {
  writeFileSync(
    path.join(outputDirectory, 'banners', `${banner.key}.svg`),
    bannerSvg(banner.from, banner.to, banner.slugs),
  );
}
console.log(
  `Wrote ${String(products.length * 3)} product images and ${String(banners.length)} banners to public/catalogue-art/.`,
);
