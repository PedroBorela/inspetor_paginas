// Conversões de cor (sRGB <-> OKLab/OKLCH), contraste WCAG e escalas de 11 tons.

export function hexParaRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
}

const limita = (v, a, b) => Math.min(b, Math.max(a, v));

export function rgbParaHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.round(limita(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

const linear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gama = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbParaOklch({ r, g, b }) {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let h = Math.atan2(bb, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(a, bb), h };
}

function oklchParaLinear({ l, c, h }) {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
  ];
}

const dentroDoGamut = lch => oklchParaLinear(lch).every(v => v >= -1e-4 && v <= 1 + 1e-4);

// Reduz o croma até caber no sRGB, mantendo luz e matiz.
export function oklchParaRgb(lch) {
  let { l, c, h } = lch;
  if (!dentroDoGamut({ l, c, h })) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const meio = (lo + hi) / 2;
      if (dentroDoGamut({ l, c: meio, h })) lo = meio; else hi = meio;
    }
    c = lo;
  }
  const [r, g, b] = oklchParaLinear({ l, c, h }).map(v => gama(limita(v, 0, 1)));
  return { r, g, b };
}

export function fmtOklch({ l, c, h }) {
  const hh = c < 0.002 ? 0 : h;
  return `oklch(${+l.toFixed(3)} ${+c.toFixed(3)} ${+hh.toFixed(2)})`;
}

export function hexParaOklchCss(hex) {
  return fmtOklch(rgbParaOklch(hexParaRgb(hex)));
}

export function fmtRgb(hex) {
  const { r, g, b, a } = hexParaRgb(hex);
  return a < 1 ? `rgb(${r} ${g} ${b} / ${+a.toFixed(2)})` : `rgb(${r} ${g} ${b})`;
}

function luminancia(hex) {
  const { r, g, b } = hexParaRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Branco ou quase-preto, o que tiver mais contraste sobre a cor.
export function corDeTextoSobre(hex) {
  return contraste(hex, '#ffffff') >= contraste(hex, '#0a0a0a') ? '#ffffff' : '#0a0a0a';
}

export const croma = hex => rgbParaOklch(hexParaRgb(hex)).c;
export const matiz = hex => rgbParaOklch(hexParaRgb(hex)).h;
export const luz = hex => rgbParaOklch(hexParaRgb(hex)).l;

export function distanciaMatiz(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export const PASSOS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const LUZ = [0.975, 0.94, 0.885, 0.81, 0.715, 0.625, 0.545, 0.47, 0.395, 0.33, 0.255];
const CROMA = [0.12, 0.25, 0.45, 0.7, 0.9, 1, 0.97, 0.88, 0.75, 0.62, 0.48];

// Escala de 11 tons. A cor original entra exatamente no passo de luz mais próximo.
export function escala(hex) {
  const base = rgbParaOklch(hexParaRgb(hex));
  let idx = 0;
  LUZ.forEach((l, i) => { if (Math.abs(l - base.l) < Math.abs(LUZ[idx] - base.l)) idx = i; });
  const cMax = base.c / CROMA[idx];
  return PASSOS.map((passo, i) => {
    const lch = i === idx ? base : { l: LUZ[i], c: Math.min(cMax * CROMA[i], 0.37), h: base.h };
    const hexPasso = i === idx ? rgbParaHex(hexParaRgb(hex)) : rgbParaHex(oklchParaRgb(lch));
    return { passo, hex: hexPasso, oklch: fmtOklch(rgbParaOklch(hexParaRgb(hexPasso))), base: i === idx };
  });
}

export function misturar(a, b, t) {
  const x = hexParaRgb(a), y = hexParaRgb(b);
  return rgbParaHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}
