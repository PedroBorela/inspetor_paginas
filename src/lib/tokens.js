// Deriva um design system dos estilos coletados e exporta para Tailwind v4, shadcn/ui, DTCG e estudio.json.
import {
  escala, hexParaOklchCss, hexParaRgb, corDeTextoSobre, contraste, croma, luz, matiz,
  distanciaMatiz, misturar, PASSOS,
} from './cor.js';

const VERMELHO = '#e7000b';

function pesoUso(c, uso) { return c.usos[uso] || 0; }

function normalizarHex(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((v || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return '#' + h.toLowerCase();
}

// Escolhe os papéis principais a partir das cores pesadas por uso.
export function derivarPapeis(estilos) {
  const opacas = estilos.cores.filter(c => c.alfa >= 0.9);
  const porUso = uso => [...opacas].sort((a, b) => pesoUso(b, uso) - pesoUso(a, uso)).filter(c => pesoUso(c, uso) > 0);

  const fundo = porUso('fundo')[0]?.hex || '#ffffff';
  const texto = porUso('texto').find(c => contraste(c.hex, fundo) >= 3)?.hex || corDeTextoSobre(fundo);

  // Cromáticas: pesa fundos de botões, links, SVGs e gradientes (exceto o fundo dominante).
  // Tons muito claros/escuros (fundos pastel, marrons de texto) valem menos que cores saturadas de marca.
  const corTema = estilos.pagina?.corTema ? estilos.cores.find(c => c.hex === normalizarHex(estilos.pagina.corTema))?.hex || normalizarHex(estilos.pagina.corTema) : null;
  const varsMarca = new Set((estilos.variaveis || []).filter(v => /(primary|primaria|brand|marca|accent|destaque)/i.test(v.nome)).map(v => v.hex));
  const cromaticas = opacas
    .filter(c => croma(c.hex) > 0.06 && c.hex !== fundo && c.hex !== texto)
    .map(c => {
      const uso = pesoUso(c, 'fundo') * 1.2 + pesoUso(c, 'texto') + pesoUso(c, 'svg') + pesoUso(c, 'gradiente') + pesoUso(c, 'borda') * 0.5;
      const l = luz(c.hex);
      const vivacidade = Math.min(1.5, croma(c.hex) / 0.12) * (l > 0.9 || l < 0.25 ? 0.25 : 1);
      const bonus = (c.hex === corTema ? 4 : 1) * (varsMarca.has(c.hex) ? 4 : 1);
      return { hex: c.hex, nota: uso * vivacidade * bonus };
    })
    .sort((a, b) => b.nota - a.nota);

  const primaria = cromaticas[0]?.hex || texto;
  const secundaria = cromaticas.find(c => distanciaMatiz(matiz(c.hex), matiz(primaria)) > 30)?.hex
    || misturar(primaria, fundo, 0.85);

  const bordaColetada = porUso('borda').find(c => c.hex !== texto && croma(c.hex) < 0.05)?.hex;
  const borda = bordaColetada || misturar(fundo, texto, 0.14);
  const suave = porUso('fundo').find(c => c.hex !== fundo && croma(c.hex) < 0.04 && Math.abs(luz(c.hex) - luz(fundo)) < 0.12)?.hex
    || misturar(fundo, texto, 0.05);
  const destrutiva = cromaticas.find(c => { const h = matiz(c.hex); return (h < 35 || h > 345) && croma(c.hex) > 0.12; })?.hex || VERMELHO;

  const fams = estilos.familias || [];
  const porFonte = uso => [...fams].sort((a, b) => b.usos[uso] - a.usos[uso])[0];
  const fonteTexto = porFonte('texto')?.familia || 'system-ui';
  const titulo = [...fams].sort((a, b) => (b.notaTitulo || 0) - (a.notaTitulo || 0))[0];
  const fonteTitulo = (titulo?.notaTitulo ? titulo.familia : null) || fonteTexto;
  const fonteMono = fams.find(f => f.usos.codigo > 0)?.familia || '';

  const raio = estilos.raios?.[0]?.px ?? 8;

  return { fundo, texto, primaria, secundaria, borda, suave, destrutiva, fonteTitulo, fonteTexto, fonteMono, raio };
}

const pilhaFonte = (fam, generica) => {
  if (!fam) return generica;
  const nome = /^[\w-]+$/.test(fam) && !/\s/.test(fam) ? fam : `"${fam}"`;
  return /^(system-ui|sans-serif|serif|monospace)$/.test(fam) ? fam : `${nome}, ${generica}`;
};

const ehEscuro = hex => luz(hex) < 0.5;

export function escalas(p) {
  // Neutro com o matiz do texto/fundo (quase cinza), para combinar com a marca.
  const baseNeutra = croma(p.texto) > 0.01 ? p.texto : p.fundo;
  const neutro = escala(misturar(baseNeutra, '#808080', 0.5));
  return { primary: escala(p.primaria), secondary: escala(p.secundaria), neutral: neutro };
}

function sombrasTokens(estilos) {
  return (estilos.sombras || []).slice(0, 4).map((s, i) => ({ nome: ['sm', 'md', 'lg', 'xl'][i], valor: s.valor }));
}

function escalaTipografica(estilos) {
  const vistos = [...new Set((estilos.tamanhos || []).map(t => t.px))].filter(v => v >= 10 && v <= 128).sort((a, b) => a - b);
  const nomes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl'];
  // "base" é o tamanho com mais texto.
  const base = [...(estilos.tamanhos || [])].sort((a, b) => b.peso - a.peso)[0]?.px || 16;
  const iBase = Math.max(0, vistos.indexOf(base));
  return vistos.map((px, i) => ({ nome: nomes[Math.max(0, Math.min(nomes.length - 1, 2 + i - iBase))] + (i - iBase < -2 ? `-${iBase - i}` : ''), px }))
    .filter((t, i, arr) => arr.findIndex(x => x.nome === t.nome) === i);
}

const rem = px => `${+(px / 16).toFixed(4)}rem`;

// ---------- Tailwind v4 ----------

export function tailwindV4(estilos, p) {
  const esc = escalas(p);
  const l = ['@import "tailwindcss";', '', '@theme {'];
  for (const [nome, passos] of Object.entries(esc)) {
    for (const s of passos) l.push(`  --color-${nome}-${s.passo}: ${s.oklch};`);
    l.push('');
  }
  l.push(`  --color-background: ${hexParaOklchCss(p.fundo)};`);
  l.push(`  --color-foreground: ${hexParaOklchCss(p.texto)};`);
  l.push(`  --color-border: ${hexParaOklchCss(p.borda)};`);
  l.push(`  --color-muted: ${hexParaOklchCss(p.suave)};`);
  l.push(`  --color-destructive: ${hexParaOklchCss(p.destrutiva)};`, '');
  l.push(`  --font-display: ${pilhaFonte(p.fonteTitulo, 'sans-serif')};`);
  l.push(`  --font-sans: ${pilhaFonte(p.fonteTexto, 'sans-serif')};`);
  if (p.fonteMono) l.push(`  --font-mono: ${pilhaFonte(p.fonteMono, 'monospace')};`);
  l.push('');
  for (const t of escalaTipografica(estilos)) l.push(`  --text-${t.nome}: ${rem(t.px)};`);
  l.push('');
  const raios = [...new Set((estilos.raios || []).map(r => r.px))].sort((a, b) => a - b).slice(0, 5);
  ['xs', 'sm', 'md', 'lg', 'xl'].slice(0, raios.length).forEach((n, i) => l.push(`  --radius-${n}: ${rem(raios[i])};`));
  for (const s of sombrasTokens(estilos)) l.push(`  --shadow-${s.nome}: ${s.valor};`);
  l.push('  --spacing: 0.25rem;');
  l.push('}');
  return l.join('\n').replace(/\n\n}/, '\n}') + '\n';
}

// ---------- shadcn/ui (globals.css, Tailwind v4) ----------

export function shadcn(estilos, p) {
  const esc = escalas(p);
  const n = Object.fromEntries(esc.neutral.map(s => [s.passo, s.hex]));
  const pri = Object.fromEntries(esc.primary.map(s => [s.passo, s.hex]));
  const o = hexParaOklchCss;
  const escuroBase = ehEscuro(p.fundo);

  const claro = escuroBase ? {
    background: n[50], foreground: n[950], primary: p.primaria, secondary: n[100], muted: n[100], mutedFg: n[500], accent: n[100], border: n[200],
  } : {
    background: p.fundo, foreground: p.texto, primary: p.primaria, secondary: misturar(p.secundaria, p.fundo, 0.82), muted: p.suave, mutedFg: misturar(p.texto, p.fundo, 0.45), accent: misturar(p.primaria, p.fundo, 0.9), border: p.borda,
  };
  const escuro = escuroBase ? {
    background: p.fundo, foreground: p.texto, primary: p.primaria, secondary: misturar(p.secundaria, p.fundo, 0.75), muted: p.suave, mutedFg: misturar(p.texto, p.fundo, 0.4), accent: misturar(p.primaria, p.fundo, 0.82), border: p.borda,
  } : {
    background: n[950], foreground: n[50], primary: pri[400], secondary: n[800], muted: n[800], mutedFg: n[400], accent: n[800], border: n[800],
  };

  const bloco = (sel, c) => {
    const card = c.background;
    const linhas = [
      ['radius', rem(p.raio || 10)],
      ['background', o(c.background)], ['foreground', o(c.foreground)],
      ['card', o(card)], ['card-foreground', o(c.foreground)],
      ['popover', o(card)], ['popover-foreground', o(c.foreground)],
      ['primary', o(c.primary)], ['primary-foreground', o(corDeTextoSobre(c.primary))],
      ['secondary', o(c.secondary)], ['secondary-foreground', o(corDeTextoSobre(c.secondary))],
      ['muted', o(c.muted)], ['muted-foreground', o(c.mutedFg)],
      ['accent', o(c.accent)], ['accent-foreground', o(corDeTextoSobre(c.accent))],
      ['destructive', o(p.destrutiva)],
      ['border', o(c.border)], ['input', o(c.border)], ['ring', o(c.primary)],
      ...esc.primary.filter((_, i) => [3, 5, 7].includes(i)).map((s, i) => [`chart-${i + 1}`, s.oklch]),
      ...esc.secondary.filter((_, i) => [4, 6].includes(i)).map((s, i) => [`chart-${i + 4}`, s.oklch]),
      ['sidebar', o(c.muted)], ['sidebar-foreground', o(c.foreground)],
      ['sidebar-primary', o(c.primary)], ['sidebar-primary-foreground', o(corDeTextoSobre(c.primary))],
      ['sidebar-accent', o(c.accent)], ['sidebar-accent-foreground', o(corDeTextoSobre(c.accent))],
      ['sidebar-border', o(c.border)], ['sidebar-ring', o(c.primary)],
    ];
    return `${sel} {\n${linhas.filter(([k]) => sel === ':root' || k !== 'radius').map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}`;
  };

  const tema = `@theme inline {
  --font-sans: ${pilhaFonte(p.fonteTexto, 'sans-serif')};
  --font-display: ${pilhaFonte(p.fonteTitulo, 'sans-serif')};${p.fonteMono ? `\n  --font-mono: ${pilhaFonte(p.fonteMono, 'monospace')};` : ''}
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
${['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
    'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
    'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring']
    .map(k => `  --color-${k}: var(--${k});`).join('\n')}
}`;

  return `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

${bloco(':root', claro)}

${bloco('.dark', escuro)}

${tema}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;
}

// ---------- DTCG (Design Tokens Community Group, formato 2025.10) ----------

function corDtcg(hex) {
  const { r, g, b, a } = hexParaRgb(hex);
  const t = { colorSpace: 'srgb', components: [r, g, b].map(v => +(v / 255).toFixed(4)), hex: hex.slice(0, 7) };
  if (a < 1) t.alpha = +a.toFixed(3);
  return { $type: 'color', $value: t };
}

export function dtcg(estilos, p) {
  const esc = escalas(p);
  const cor = {};
  for (const [nome, passos] of Object.entries(esc)) {
    cor[nome] = Object.fromEntries(passos.map(s => [String(s.passo), corDtcg(s.hex)]));
  }
  cor.background = corDtcg(p.fundo);
  cor.foreground = corDtcg(p.texto);
  cor.border = corDtcg(p.borda);
  cor.muted = corDtcg(p.suave);
  cor.destructive = corDtcg(p.destrutiva);

  const dim = px => ({ $type: 'dimension', $value: { value: px, unit: 'px' } });
  const fonte = (fam, gen) => ({ $type: 'fontFamily', $value: fam ? [fam, gen] : [gen] });

  const tokens = {
    $schema: 'https://designtokens.org/schemas/2025.10/tokens.json',
    color: cor,
    font: {
      family: {
        display: fonte(p.fonteTitulo, 'sans-serif'),
        sans: fonte(p.fonteTexto, 'sans-serif'),
        ...(p.fonteMono ? { mono: fonte(p.fonteMono, 'monospace') } : {}),
      },
      size: Object.fromEntries(escalaTipografica(estilos).map(t => [t.nome, dim(t.px)])),
    },
    radius: Object.fromEntries([...new Set((estilos.raios || []).map(r => r.px))].sort((a, b) => a - b).slice(0, 5).map((px, i) => [['xs', 'sm', 'md', 'lg', 'xl'][i], dim(px)])),
    spacing: Object.fromEntries([...(estilos.espacos || [])].map(e => e.px).sort((a, b) => a - b).map(px => [String(px), dim(px)])),
  };
  const sombras = sombrasTokens(estilos);
  if (sombras.length) tokens.shadow = Object.fromEntries(sombras.map(s => [s.nome, { $type: 'shadow', $value: s.valor, $description: 'box-shadow CSS coletado da página' }]));
  return JSON.stringify(tokens, null, 2) + '\n';
}

// ---------- estudio.json (controles do Estúdio de motion) ----------

export function estudio(estilos, p) {
  const pg = estilos.pagina || {};
  const trecho = 'filme todo';
  const controles = {
    corFundo: { tipo: 'cor', rotulo: 'Cor · fundo', valor: p.fundo.toUpperCase(), trecho },
    corTinta: { tipo: 'cor', rotulo: 'Cor · tinta (textos e linhas)', valor: p.texto.toUpperCase(), trecho },
    corDestaque: { tipo: 'cor', rotulo: 'Cor · destaque (marca)', valor: p.primaria.toUpperCase(), trecho },
    corSecundaria: { tipo: 'cor', rotulo: 'Cor · secundária', valor: p.secundaria.toUpperCase(), trecho },
    fonteDisplay: { tipo: 'texto', rotulo: 'Fonte · display (títulos)', valor: p.fonteTitulo, trecho },
    fonteUI: { tipo: 'texto', rotulo: 'Fonte · UI (textos de apoio)', valor: p.fonteTexto, trecho },
    raio: { tipo: 'numero', rotulo: 'Raio dos cantos (px)', valor: p.raio, passo: 1, trecho },
  };
  if (pg.h1) controles.titulo = { tipo: 'texto', rotulo: 'Texto · título', valor: pg.h1, trecho };
  if (pg.h2?.[0]) controles.subtitulo = { tipo: 'texto', rotulo: 'Texto · subtítulo', valor: pg.h2[0], trecho };
  if (pg.chamada) controles.chamada = { tipo: 'texto', rotulo: 'Texto · chamada (botão)', valor: pg.chamada, trecho };
  if (pg.host) controles.marca = { tipo: 'texto', rotulo: 'Texto · site / marca', valor: pg.host.replace(/^www\./, ''), trecho };
  return JSON.stringify({ controles }, null, 2) + '\n';
}

export const FORMATOS = {
  tailwind: { rotulo: 'Tailwind v4', arquivo: 'theme.css', gerar: tailwindV4 },
  shadcn: { rotulo: 'shadcn/ui', arquivo: 'globals.css', gerar: shadcn },
  dtcg: { rotulo: 'Tokens DTCG', arquivo: 'tokens.json', gerar: dtcg },
  estudio: { rotulo: 'estudio.json', arquivo: 'estudio.json', gerar: estudio },
};

export { PASSOS };
