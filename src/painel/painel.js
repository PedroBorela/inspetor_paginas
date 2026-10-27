import { fmtRgb, hexParaOklchCss, escala } from '../lib/cor.js';
import { derivarPapeis, escalas, FORMATOS } from '../lib/tokens.js';
import { Clonador } from '../lib/clone.js';
import { GRUPOS, porId, personalizado } from '../lib/dispositivos.js';
import { abrirSimulador, fecharSimulador, simuladorAberto } from '../lib/simulacao.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const el = (tag, props = {}, ...filhos) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) n.append(f instanceof Node ? f : String(f));
  return n;
};

const estado = {
  aba: 'estilos',
  tabId: null,
  url: '',
  estilos: null,
  assets: null,
  papeis: null,
  formatoCor: 'hex',
  formatoExport: 'tailwind',
  filtro: 'todos',
  selecionados: new Set(),
  elemento: null,
  carregado: { estilos: false, assets: false },
  sim: null,      // { id, w, h, girado } enquanto o simulador está aberto
  regua: false,
  medida: null,
};

// ---------- utilidades ----------

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('visivel');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visivel'), 1600);
}

async function copiar(texto, msg = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } }, texto);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: nome, saveAs: false }, () => {
    if (chrome.runtime.lastError) {
      const a = el('a', { href: url, download: nome.split('/').pop() });
      document.body.append(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}

const pastaHost = () => `garimpo/${(estado.estilos?.pagina?.host || estado.assets?.pagina?.host || 'pagina').replace(/[^\w.-]/g, '_')}`;

function formatarBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function nomeDeArquivo(url, padrao = 'arquivo') {
  try {
    const nome = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return nome.replace(/[^\w.-]+/g, '-').slice(-80) || padrao;
  } catch { return padrao; }
}

// ---------- aba alvo e injeção ----------

const RESTRITAS = /^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|moz-extension|view-source|devtools):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

async function abaAlvo() {
  const param = new URLSearchParams(location.search).get('tab');
  if (param) return chrome.tabs.get(+param);
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

async function chamar(acao, args = []) {
  await chrome.scripting.executeScript({ target: { tabId: estado.tabId }, files: ['src/pagina/coletor.js'] });
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: estado.tabId },
    func: (a, x) => window.__garimpo[a](...x),
    args: [acao, args],
  });
  if (r?.error) throw new Error(r.error.message || String(r.error));
  return r?.result;
}

async function inspetor(acao) {
  await chrome.scripting.executeScript({ target: { tabId: estado.tabId }, files: ['src/pagina/inspetor.js'] });
  await chrome.scripting.executeScript({ target: { tabId: estado.tabId }, func: a => window.__garimpoInspetor[a](), args: [acao] });
}

function avisar(msg) {
  const a = $('#aviso');
  a.textContent = msg || '';
  a.hidden = !msg;
}

async function sincronizarAba(forcar = false) {
  const aba = await abaAlvo();
  if (!aba) return;
  const mudou = aba.id !== estado.tabId || aba.url !== estado.url;
  if (!mudou && !forcar) return;
  estado.tabId = aba.id;
  estado.url = aba.url || '';
  estado.estilos = estado.assets = estado.elemento = null;
  estado.carregado = { estilos: false, assets: false };
  estado.selecionados.clear();
  $('#elemento').hidden = true;
  estado.sim = null;
  definirRegua(false);

  let host = '—';
  try { host = new URL(aba.url).host || aba.url; } catch { /* url vazia */ }
  $('#pg-host').textContent = host;
  $('#pg-titulo').textContent = aba.title || '';
  $('#pg-icone').src = aba.favIconUrl || '';
  $('#pg-icone').style.visibility = aba.favIconUrl ? 'visible' : 'hidden';

  if (!aba.url || RESTRITAS.test(aba.url)) {
    avisar('O navegador não deixa extensões lerem esta página. Abra um site comum para usar o Garimpo.');
    return;
  }
  if (aba.url.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    avisar('Para arquivos locais, ative "Permitir acesso aos URLs de arquivo" nos detalhes da extensão.');
    return;
  }
  avisar('');
  // Painel reaberto com simulador/régua já ativos na aba.
  if (await simuladorAberto(aba.id)) estado.sim = { id: null };
  renderTelas();
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, func: () => !!window.__garimpoRegua?.ativa() });
    definirRegua(!!r?.result);
  } catch { /* sem acesso */ }
  carregarAba(estado.aba);
}

// ---------- abas ----------

function mostrarAba(nome) {
  estado.aba = nome;
  for (const b of $$('.abas button')) b.setAttribute('aria-selected', String(b.dataset.aba === nome));
  for (const p of $$('.painel')) p.hidden = p.dataset.painel !== nome;
  carregarAba(nome);
}

async function carregarAba(nome) {
  if (!estado.tabId || !$('#aviso').hidden) return;
  if (nome === 'estilos' && !estado.carregado.estilos) {
    estado.carregado.estilos = true;
    await carregarSecao('estilos', async () => {
      estado.estilos = await chamar('estilos');
      await completarFontesExternas(estado.estilos);
      estado.papeis = derivarPapeis(estado.estilos);
      renderEstilos();
    });
  }
  if (nome === 'assets' && !estado.carregado.assets) {
    estado.carregado.assets = true;
    await carregarSecao('assets', async () => {
      estado.assets = await chamar('assets');
      await verificarLotties(estado.assets);
      renderAssets();
    });
  }
}

async function carregarSecao(nome, fn) {
  const painel = $(`[data-painel="${nome}"]`);
  const carregando = painel.querySelector('[data-carregando]');
  const conteudo = painel.querySelector('[data-conteudo]');
  carregando.hidden = false;
  carregando.textContent = carregando.dataset.texto ||= carregando.textContent;
  conteudo.hidden = true;
  try {
    await fn();
    carregando.hidden = true;
    conteudo.hidden = false;
  } catch (e) {
    console.error(e);
    estado.carregado[nome] = false;
    carregando.textContent = `Não consegui ler a página: ${e.message}. Recarregue a aba e tente de novo.`;
  }
}

// ---------- estilos ----------

function formatarCor(hex, fmt = estado.formatoCor) {
  if (fmt === 'rgb') return fmtRgb(hex);
  if (fmt === 'oklch') return hexParaOklchCss(hex);
  return hex.toUpperCase();
}

const NOMES_USO = { fundo: 'fundo', texto: 'texto', borda: 'borda', svg: 'ícone', gradiente: 'gradiente' };

function usoPrincipal(c) {
  return Object.entries(c.usos).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function renderEstilos() {
  const e = estado.estilos;

  const paleta = $('#paleta');
  paleta.replaceChildren(...e.cores.slice(0, 32).map(c => {
    const hex = c.alfa < 1 ? c.hex + Math.round(c.alfa * 255).toString(16).padStart(2, '0') : c.hex;
    return el('button', { class: 'amostra', title: `Copiar ${hex}`, onclick: () => copiar(formatarCor(hex), `${formatarCor(hex)} copiado`) },
      el('i', { style: { background: hex } }),
      el('b', {}, hex.toUpperCase()),
      el('small', {}, `${NOMES_USO[usoPrincipal(c)] || ''}${c.alfa < 1 ? ` · ${Math.round(c.alfa * 100)}%` : ''}`));
  }));

  $('#variaveis-box').hidden = !e.variaveis.length;
  $('#variaveis-n').textContent = `(${e.variaveis.length})`;
  $('#variaveis').replaceChildren(...e.variaveis.map(v => el('div', { class: 'var-linha', title: 'Copiar var()', onclick: () => copiar(`var(${v.nome})`) },
    el('i', { style: { background: v.hex } }), el('code', {}, v.nome), el('span', {}, v.hex.toUpperCase()))));

  renderFontes();

  const chips = (alvo, itens, rotulo) => $(alvo).replaceChildren(...itens.map(i => el('button', { class: 'chip', onclick: () => copiar(rotulo(i)) }, rotulo(i))));
  chips('#tamanhos', [...e.tamanhos].sort((a, b) => a.px - b.px), t => `${t.px}px`);
  chips('#raios', e.raios, r => `${r.px}px`);
  chips('#espacos', [...e.espacos].sort((a, b) => a.px - b.px), s => `${s.px}px`);
  $('#sombras').replaceChildren(...e.sombras.map(s => el('button', { class: 'sombra', title: s.valor, style: { boxShadow: s.valor }, onclick: () => copiar(`box-shadow: ${s.valor};`) })));
  if (!e.sombras.length) $('#sombras').append(el('span', { class: 'nota' }, 'Nenhuma'));

  renderPapeis();
}

// Busca @font-face em folhas cross-origin (o CSSOM bloqueia a leitura delas na página).
async function completarFontesExternas(e) {
  const RE_FACE = /@font-face\s*{([^}]*)}/g;
  await Promise.all(e.folhasInacessiveis.slice(0, 12).map(async href => {
    try {
      const css = await (await fetch(href)).text();
      for (const m of css.matchAll(RE_FACE)) {
        const bloco = m[1];
        const prop = n => (bloco.match(new RegExp(`${n}\\s*:\\s*([^;]+)`, 'i')) || [])[1]?.trim() || '';
        const arquivos = [...(prop('src').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g))].map(u => new URL(u[1], href).href);
        e.fontesFace.push({ familia: prop('font-family').replace(/^["']|["']$/g, ''), peso: prop('font-weight') || '400', estilo: prop('font-style') || 'normal', arquivos });
      }
    } catch { /* sem acesso */ }
  }));
}

const carregadasNoPainel = new Set();
function carregarFonteNoPainel(face) {
  const arq = face.arquivos.find(u => /\.woff2(\?|$)/i.test(u)) || face.arquivos[0];
  const chave = `${face.familia}|${face.peso}|${face.estilo}`;
  if (!arq || carregadasNoPainel.has(chave)) return;
  carregadasNoPainel.add(chave);
  const f = new FontFace(`garimpo-${face.familia}`, `url("${arq}")`, { weight: face.peso, style: face.estilo });
  f.load().then(ff => document.fonts.add(ff)).catch(() => {});
}

function renderFontes() {
  const e = estado.estilos;
  const caixa = $('#fontes');
  if (!e.familias.length) { caixa.replaceChildren(el('p', { class: 'nota' }, 'Nenhum texto visível.')); return; }
  caixa.replaceChildren(...e.familias.slice(0, 8).map(f => {
    const faces = e.fontesFace.filter(x => x.familia.toLowerCase() === f.familia.toLowerCase());
    faces.forEach(carregarFonteNoPainel);
    const pesos = Object.keys(f.pesos).sort((a, b) => a - b);
    const tamanhos = Object.entries(f.tamanhos).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => +t).sort((a, b) => a - b);
    const total = e.familias.reduce((s, x) => s + x.caracteres, 0) || 1;
    const papel = f.usos.titulo > f.usos.texto ? 'títulos' : f.usos.codigo > f.usos.texto ? 'código' : 'texto';
    const arquivos = [...new Set(faces.flatMap(x => x.arquivos.filter(u => !/\.(eot|svg)(\?|#|$)/i.test(u)).slice(0, 1)))];
    return el('div', { class: 'fonte' },
      el('div', { class: 'fonte-cab' }, el('strong', {}, f.familia), el('span', {}, `${papel} · ${Math.round(f.caracteres / total * 100)}%`)),
      el('div', { class: 'fonte-amostra', style: { fontFamily: `"garimpo-${f.familia}", ${f.pilha}` } }, f.amostra || 'Aa Bb Cc 123'),
      el('div', { class: 'chips' }, ...pesos.map(p => el('span', { class: 'chip' }, p)), ...tamanhos.map(t => el('span', { class: 'chip' }, `${t}px`))),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn secundario', onclick: () => copiar(`font-family: ${f.pilha};`) }, 'Copiar font-family'),
        arquivos.length ? el('button', { class: 'btn secundario', onclick: () => baixarFontes(f.familia, arquivos) }, `Baixar ${arquivos.length} arquivo${arquivos.length > 1 ? 's' : ''}`) : null,
        el('a', { class: 'btn secundario', href: `https://fonts.google.com/?query=${encodeURIComponent(f.familia)}`, target: '_blank', style: { textDecoration: 'none' } }, 'Google Fonts')));
  }));
}

function baixarFontes(familia, urls) {
  const pasta = familia.replace(/[^\w.-]+/g, '-');
  for (const u of urls) chrome.downloads.download({ url: u, filename: `${pastaHost()}/fontes/${pasta}/${nomeDeArquivo(u, 'fonte.woff2')}` });
  toast(`Baixando ${urls.length} arquivo${urls.length > 1 ? 's' : ''}`);
}

const PAPEIS = [
  ['fundo', 'Fundo'], ['texto', 'Texto'], ['primaria', 'Primária'], ['secundaria', 'Secundária'], ['borda', 'Borda'], ['suave', 'Fundo suave'],
];

function renderPapeis() {
  const p = estado.papeis;
  const familias = [...new Set([...estado.estilos.familias.map(f => f.familia), p.fonteTitulo, p.fonteTexto])].filter(Boolean);
  const seletorFonte = (chave, rotulo) => el('div', { class: 'papel' },
    el('label', { style: { width: '100%' } }, rotulo,
      el('select', { onchange: ev => { p[chave] = ev.target.value; renderExport(); } },
        ...familias.map(f => el('option', { value: f, selected: f === p[chave] }, f)))));

  $('#papeis').replaceChildren(
    ...PAPEIS.map(([chave, rotulo]) => {
      const valor = el('span', {}, p[chave].toUpperCase());
      return el('div', { class: 'papel' },
        el('input', { type: 'color', value: p[chave].slice(0, 7), 'aria-label': rotulo, oninput: ev => { p[chave] = ev.target.value; valor.textContent = ev.target.value.toUpperCase(); renderEscalas(); renderExport(); } }),
        el('label', {}, rotulo, valor));
    }),
    seletorFonte('fonteTitulo', 'Fonte de títulos'),
    seletorFonte('fonteTexto', 'Fonte de texto'),
  );

  $('#formato-export').replaceChildren(...Object.entries(FORMATOS).map(([k, f]) =>
    el('button', { 'data-fmt': k, 'aria-pressed': String(k === estado.formatoExport), onclick: () => { estado.formatoExport = k; renderPapeisFormato(); renderExport(); } }, f.rotulo)));
  renderEscalas();
  renderExport();
}

function renderPapeisFormato() {
  for (const b of $$('#formato-export button')) b.setAttribute('aria-pressed', String(b.dataset.fmt === estado.formatoExport));
}

function renderEscalas() {
  const esc = escalas(estado.papeis);
  $('#escalas').replaceChildren(...Object.entries({ primary: 'primária', secondary: 'secundária', neutral: 'neutra' }).map(([k, rot]) =>
    el('div', { class: 'escala' }, el('span', {}, rot),
      ...esc[k].map(s => el('i', { class: s.base && k !== 'neutral' ? 'base' : '', title: `${k}-${s.passo} ${s.hex}`, style: { background: s.hex }, onclick: () => copiar(s.hex) })))));
}

function textoExport() {
  return FORMATOS[estado.formatoExport].gerar(estado.estilos, estado.papeis);
}

function renderExport() {
  $('#codigo-export').textContent = textoExport();
}

// ---------- assets ----------

const FILTROS = [
  ['todos', 'Todos'], ['imagem', 'Imagens'], ['svg', 'SVG'], ['icone', 'Ícones'], ['video', 'Vídeos'], ['lottie', 'Lottie'], ['favicon', 'Favicons'],
];

function listaAssets() {
  const a = estado.assets;
  const inline = a.svgs.map((s, i) => ({ ...s, id: `svg:${i}`, tipo: 'svg', inline: true }));
  const itens = a.itens.filter(i => !i.candidato).map(i => ({ ...i, id: i.url }));
  return [...itens, ...inline];
}

function passaFiltro(item, f) {
  if (f === 'todos') return true;
  if (f === 'icone') return item.tipo === 'svg' && (item.icone || (item.largura && item.largura <= 64));
  return item.tipo === f;
}

function renderAssets() {
  const todos = listaAssets();
  $('#filtros').replaceChildren(...FILTROS.map(([k, rot]) => {
    const n = todos.filter(i => passaFiltro(i, k)).length;
    if (!n && k !== 'todos') return null;
    return el('button', { 'aria-pressed': String(k === estado.filtro), onclick: () => { estado.filtro = k; renderAssets(); } }, rot, el('b', {}, n));
  }));

  const visiveis = todos.filter(i => passaFiltro(i, estado.filtro));
  const grade = $('#grade');
  if (!visiveis.length) { grade.replaceChildren(el('div', { class: 'vazio' }, 'Nada encontrado nesta página.')); atualizarSelecao(visiveis); return; }
  grade.replaceChildren(...visiveis.map(cartaoAsset));
  atualizarSelecao(visiveis);
  $('#sel-todos').onchange = ev => {
    for (const i of visiveis) ev.target.checked ? estado.selecionados.add(i.id) : estado.selecionados.delete(i.id);
    renderAssets();
  };
}

function srcMiniatura(item) {
  if (item.inline) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(item.codigo);
  return item.url;
}

function rotuloAsset(item) {
  const dim = item.largura && item.altura ? `${item.largura}×${item.altura}` : '';
  if (item.inline) return `svg ${dim}`.trim();
  const ext = (item.url.startsWith('data:') ? item.url.slice(5, item.url.indexOf(';')).split('/')[1] : (nomeDeArquivo(item.url).match(/\.(\w{2,5})$/) || [])[1]) || item.tipo;
  return `${ext.replace('svg+xml', 'svg')} ${dim}`.trim();
}

const ICONE_BAIXAR = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONE_COPIAR = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

function cartaoAsset(item) {
  const sel = estado.selecionados.has(item.id);
  const rotulo = el('span', { title: item.inline ? item.rotulo || 'SVG inline' : item.url }, rotuloAsset(item));
  let midia;
  if (item.tipo === 'video') midia = el('video', { src: item.url, muted: true, preload: 'metadata', playsinline: true });
  else if (item.tipo === 'lottie') midia = el('span', { class: 'rotulo-tipo' }, item.lottieInfo || 'LOTTIE');
  else {
    midia = el('img', { src: srcMiniatura(item), alt: item.alt || '', loading: 'lazy' });
    midia.addEventListener('load', () => {
      if (!item.largura && midia.naturalWidth) { item.largura = midia.naturalWidth; item.altura = midia.naturalHeight; rotulo.textContent = rotuloAsset(item); }
    });
    midia.addEventListener('error', () => midia.replaceWith(el('span', { class: 'rotulo-tipo' }, 'sem prévia')));
  }
  const baixar = el('button', { class: 'mini-btn', title: 'Baixar', 'aria-label': 'Baixar', onclick: () => baixarAsset(item) });
  baixar.innerHTML = ICONE_BAIXAR;
  const copiarBtn = el('button', {
    class: 'mini-btn', title: item.inline ? 'Copiar código SVG' : 'Copiar URL', 'aria-label': 'Copiar',
    onclick: async () => {
      if (item.inline) return copiar(item.codigo, 'SVG copiado');
      if (item.tipo === 'svg') {
        try { return copiar(await (await fetch(item.url)).text(), 'SVG copiado'); } catch { /* cai para a URL */ }
      }
      copiar(item.url, 'URL copiada');
    },
  });
  copiarBtn.innerHTML = ICONE_COPIAR;
  return el('div', { class: `cartao${sel ? ' sel' : ''}` },
    el('div', { class: 'miniatura', onclick: () => alternarSelecao(item) }, midia),
    el('input', { type: 'checkbox', checked: sel, 'aria-label': 'Selecionar', onchange: () => alternarSelecao(item) }),
    el('div', { class: 'info' }, rotulo, copiarBtn, baixar));
}

function alternarSelecao(item) {
  estado.selecionados.has(item.id) ? estado.selecionados.delete(item.id) : estado.selecionados.add(item.id);
  renderAssets();
}

function atualizarSelecao(visiveis) {
  const n = estado.selecionados.size;
  $('#sel-n').textContent = `${n} selecionado${n === 1 ? '' : 's'}`;
  $('#baixar-sel').disabled = !n;
  $('#sel-todos').checked = visiveis.length > 0 && visiveis.every(i => estado.selecionados.has(i.id));
}

function nomeAsset(item, i = 0) {
  if (item.inline) return `${(item.rotulo || 'svg').replace(/[^\w-]+/g, '-').slice(0, 40) || 'svg'}-${i + 1}.svg`;
  if (item.url.startsWith('data:')) {
    const ext = item.url.slice(5, item.url.indexOf(';')).split('/')[1]?.replace('svg+xml', 'svg') || 'bin';
    return `${item.tipo}-${i + 1}.${ext}`;
  }
  const nome = nomeDeArquivo(item.url, `${item.tipo}-${i + 1}`);
  return /\.\w{2,5}$/.test(nome) ? nome : `${nome}.${item.tipo === 'lottie' ? 'json' : 'bin'}`;
}

const PASTA_TIPO = { imagem: 'imagens', svg: 'svg', video: 'videos', lottie: 'lottie', favicon: 'favicons' };

function baixarAsset(item) {
  const destino = `${pastaHost()}/${PASTA_TIPO[item.tipo] || 'outros'}/${nomeAsset(item)}`;
  if (item.inline) return baixarBlob(new Blob([item.codigo], { type: 'image/svg+xml' }), destino);
  chrome.downloads.download({ url: item.url, filename: destino }, () => {
    if (chrome.runtime.lastError) toast('Falha ao baixar');
  });
}

async function baixarSelecionados() {
  const itens = listaAssets().filter(i => estado.selecionados.has(i.id));
  if (!itens.length) return;
  const btn = $('#baixar-sel');
  btn.disabled = true;
  const zip = new JSZip();
  const usados = new Set();
  let feitos = 0, falhas = 0;
  const caminhoUnico = c => { let x = c, n = 2; while (usados.has(x)) x = c.replace(/(\.\w+)?$/, `-${n++}$1`); usados.add(x); return x; };
  await Promise.all(itens.map(async (item, i) => {
    const caminho = caminhoUnico(`${PASTA_TIPO[item.tipo] || 'outros'}/${nomeAsset(item, i)}`);
    try {
      if (item.inline) zip.file(caminho, item.codigo);
      else {
        const r = await fetch(item.url);
        if (!r.ok) throw new Error(r.status);
        zip.file(caminho, await r.blob());
      }
    } catch { falhas++; }
    btn.textContent = `${++feitos}/${itens.length}…`;
  }));
  const blob = await zip.generateAsync({ type: 'blob' });
  baixarBlob(blob, `${pastaHost()}/assets.zip`);
  btn.textContent = 'Baixar ZIP';
  btn.disabled = false;
  toast(falhas ? `ZIP pronto · ${falhas} falharam` : 'ZIP pronto');
}

// Confirma quais JSONs baixados pela página são animações Lottie.
async function verificarLotties(a) {
  const candidatos = a.itens.filter(i => i.tipo === 'lottie').slice(0, 25);
  await Promise.all(candidatos.map(async item => {
    if (/\.lottie(\?|$)/i.test(item.url)) { item.lottieInfo = '.lottie'; item.candidato = false; return; }
    try {
      const j = await (await fetch(item.url)).json();
      if (j && Array.isArray(j.layers) && j.fr && j.w) {
        item.candidato = false;
        item.largura = j.w; item.altura = j.h;
        item.lottieInfo = `LOTTIE · ${((j.op - j.ip) / j.fr).toFixed(1)}s`;
      } else item.candidato = true;
    } catch { item.candidato = true; }
  }));
}

// ---------- clonar ----------

async function clonar() {
  const btn = $('#clonar');
  btn.disabled = true;
  $('#clone-progresso').hidden = false;
  $('#clone-resultado').hidden = true;
  const barra = $('#clone-barra');
  const texto = $('#clone-texto');
  barra.style.width = '2%';
  texto.textContent = 'Lendo o DOM…';
  try {
    const opcoes = { scripts: $('#op-scripts').checked, midia: $('#op-midia').checked };
    const snap = await chamar('snapshot', [opcoes]);
    const clonador = new Clonador({
      ...opcoes,
      aoProgresso: ({ feitos, total, bytes, msg }) => {
        barra.style.width = `${Math.max(2, total ? feitos / total * 100 : 0)}%`;
        texto.textContent = `${feitos}/${total} · ${formatarBytes(bytes)} · ${msg}`;
      },
    });
    const blob = await clonador.clonar(snap);
    barra.style.width = '100%';
    const nome = `${snap.host.replace(/[^\w.-]/g, '_')}-clone.zip`;
    baixarBlob(blob, `garimpo/${nome}`);
    const ok = clonador.total - clonador.falhas.length;
    const res = $('#clone-resultado');
    res.replaceChildren(
      el('strong', {}, `${nome} · ${formatarBytes(blob.size)}`),
      el('div', {}, `${ok} de ${clonador.total} arquivos salvos.`),
      clonador.falhas.length ? el('details', {}, el('summary', {}, `${clonador.falhas.length} falharam (ficaram com a URL original)`),
        el('ul', {}, ...clonador.falhas.slice(0, 80).map(f => el('li', {}, `${f.url} — ${f.motivo}`)))) : null,
      el('button', { class: 'btn secundario', style: { marginTop: '8px' }, onclick: () => baixarBlob(blob, `garimpo/${nome}`) }, 'Baixar de novo'));
    res.hidden = false;
    texto.textContent = 'Pronto';
  } catch (e) {
    console.error(e);
    texto.textContent = `Erro: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- inspetor ----------

function ehCor(v) { return /^(rgb|rgba|oklch|oklab|lab|lch|hsl|hsla|color)\(|^#[0-9a-f]{3,8}$/i.test(v.trim()); }

function renderElemento(d) {
  estado.elemento = d;
  $('#elemento').hidden = false;
  $('#el-nome').textContent = d.nome;
  $('#el-tamanho').textContent = `${d.largura}×${d.altura}`;
  $('#el-pai').disabled = !d.temPai;

  const blocos = [];
  if (d.texto) blocos.push(el('div', { class: 'grupo' }, el('h3', {}, 'Texto'), el('div', { class: 'nota', style: { margin: 0 } }, d.texto.slice(0, 200))));

  for (const [grupo, linhas] of Object.entries(d.grupos)) {
    blocos.push(el('div', { class: 'grupo' }, el('h3', {}, grupo),
      el('table', { class: 'props' }, el('tbody', {}, ...linhas.map(([p, v]) => el('tr', {},
        el('td', {}, p),
        el('td', { title: 'Copiar', onclick: () => copiar(`${p}: ${v};`) }, ehCor(v) ? el('i', { style: { background: v } }) : null, v)))))));
  }

  const a = d.acessibilidade;
  const linhasA11y = [];
  if (a.contraste != null) {
    const grande = a.tamanhoFonte >= 24 || (a.tamanhoFonte >= 18.66 && a.pesoFonte >= 700);
    const minimo = grande ? 3 : 4.5;
    linhasA11y.push(el('tr', {}, el('td', {}, 'contraste'), el('td', {}, `${a.contraste}:1`,
      el('span', { class: `selo ${a.contraste >= minimo ? 'ok' : 'ruim'}` }, a.contraste >= minimo ? 'AA ok' : 'falha AA'),
      a.contraste >= (grande ? 4.5 : 7) ? el('span', { class: 'selo ok' }, 'AAA') : null)));
  }
  if (a.papel) linhasA11y.push(el('tr', {}, el('td', {}, 'role'), el('td', {}, a.papel)));
  if (a.rotulo) linhasA11y.push(el('tr', {}, el('td', {}, 'rótulo'), el('td', {}, a.rotulo)));
  if (linhasA11y.length) blocos.push(el('div', { class: 'grupo' }, el('h3', {}, 'Acessibilidade'), el('table', { class: 'props' }, el('tbody', {}, ...linhasA11y))));

  if (d.estados.length) {
    blocos.push(el('div', { class: 'grupo' }, el('h3', {}, 'Estados interativos'),
      ...d.estados.map(s => el('div', { class: 'estado', title: 'Copiar regra', onclick: () => copiar(`${s.seletor} { ${s.css} }`) }, el('b', {}, `:${s.estado}`), ' ', s.css))));
  }

  $('#el-detalhes').replaceChildren(...blocos);
}

function htmlAutonomo(d) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.nome.replace(/</g, '&lt;')} · ${d.pagina.titulo.replace(/</g, '&lt;')}</title>
<!-- Extraído de ${d.pagina.url} pelo Garimpo -->
<style>body{margin:0;padding:32px;display:flex;justify-content:center;align-items:flex-start;min-height:100vh;box-sizing:border-box}</style>
</head>
<body>
${d.html}
</body>
</html>
`;
}

function promptIA(d) {
  const estilos = Object.entries(d.grupos).map(([g, linhas]) => `${g}:\n${linhas.map(([p, v]) => `  ${p}: ${v};`).join('\n')}`).join('\n');
  const estados = d.estados.length ? `\nEstados interativos:\n${d.estados.map(s => `  ${s.seletor} { ${s.css} }`).join('\n')}\n` : '';
  const html = d.html.length > 14000 ? d.html.slice(0, 14000) + '\n<!-- … truncado … -->' : d.html;
  return `Recrie este componente de interface exatamente como ele aparece em "${d.pagina.titulo}" (${d.pagina.url}).

Elemento: <${d.tag}> ${d.nome} — ${d.largura}×${d.altura}px
${d.texto ? `Texto: "${d.texto.slice(0, 200)}"\n` : ''}
Estilos computados:
${estilos}
${estados}
HTML de referência (estilos computados inline):
\`\`\`html
${html}
\`\`\`

Requisitos:
- Mantenha cores, fontes, tamanhos, espaçamentos, raios e sombras idênticos aos valores acima.
- Reproduza os estados hover/focus/active listados.
- Use HTML semântico e torne o componente responsivo.
- Escreva no stack do meu projeto (por exemplo React + Tailwind) com nomes de classe legíveis, sem estilos inline.
`;
}

let inspecionando = false;
async function alternarInspetor() {
  if (!estado.tabId || !$('#aviso').hidden) return;
  inspecionando = !inspecionando;
  $('#inspecionar').textContent = inspecionando ? 'Cancelar' : 'Escolher elemento na página';
  $('#inspecionar').classList.toggle('secundario', inspecionando);
  try {
    await inspetor(inspecionando ? 'iniciar' : 'parar');
  } catch (e) {
    inspecionando = false;
    toast(`Não consegui inspecionar: ${e.message}`);
  }
}

function inspetorParou() {
  inspecionando = false;
  $('#inspecionar').textContent = 'Escolher elemento na página';
  $('#inspecionar').classList.remove('secundario');
}

// ---------- telas (simulador) ----------

const ICONES_DISP = {
  Celulares: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="4" y="1.5" width="8" height="13" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 12.5h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  Tablets: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="1.5" width="11" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 12.5h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  Computadores: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 14h6M8 11v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

function renderTelas() {
  const aberto = !!estado.sim;
  const status = $('#sim-status');
  status.textContent = aberto ? (estado.sim.w ? `aberto · ${estado.sim.w}×${estado.sim.h}` : 'aberto') : 'fechado';
  status.classList.toggle('aberto', aberto);
  $('#sim-girar').disabled = !aberto;
  $('#sim-fechar').disabled = !aberto;
  $('#dispositivos').replaceChildren(...GRUPOS.map(g => el('div', { class: 'grupo-disp' },
    el('h3', {}, g.nome),
    el('div', { class: 'disps' }, ...g.itens.map(d => {
      const b = el('button', { class: 'disp', 'aria-pressed': String(estado.sim?.id === d.id), title: `${d.nome} · ${d.w}×${d.h} @${d.dpr}x`, onclick: () => simular(d) });
      b.innerHTML = ICONES_DISP[g.nome];
      b.append(el('span', {}, el('b', {}, d.nome), el('small', {}, `${d.w}×${d.h}`)));
      return b;
    })))));
}

async function simular(disp) {
  if (!estado.tabId || !$('#aviso').hidden) return;
  try {
    if (estado.sim) {
      await chrome.runtime.sendMessage({ tipo: 'garimpo:sim-dispositivo', tabId: estado.tabId, id: disp.id, w: disp.w, h: disp.h }).catch(() => {});
    } else {
      if (estado.regua) await alternarRegua();
      await abrirSimulador(estado.tabId, estado.url, disp);
      estado.sim = { id: disp.id, w: disp.w, h: disp.h };
    }
    renderTelas();
  } catch (e) {
    console.error(e);
    toast(`Não consegui abrir o simulador: ${e.message}`);
  }
}

// ---------- régua ----------

function definirRegua(ligada) {
  estado.regua = ligada;
  $('#regua').setAttribute('aria-pressed', String(ligada));
  $('#faixa-regua').hidden = !ligada;
  if (!ligada) {
    estado.medida = null;
    $('#regua-medida').textContent = 'Régua ligada';
    $('#regua-detalhe').textContent = 'Arraste para medir uma área ou clique num elemento';
    $('#regua-copiar').disabled = true;
  }
}

async function alternarRegua() {
  if (!estado.tabId || !$('#aviso').hidden) return;
  try {
    if (!estado.regua && inspecionando) await alternarInspetor();
    await chrome.scripting.executeScript({ target: { tabId: estado.tabId }, files: ['src/pagina/regua.js'] });
    const [r] = await chrome.scripting.executeScript({ target: { tabId: estado.tabId }, func: () => window.__garimpoRegua.alternar() });
    definirRegua(!!r?.result);
  } catch (e) {
    toast(`Não consegui ligar a régua: ${e.message}`);
  }
}

function mostrarMedida(m) {
  estado.medida = m;
  $('#regua-medida').textContent = m.texto;
  $('#regua-detalhe').textContent = { area: 'área', elemento: 'elemento', distancia: 'distância', guia: 'guia' }[m.tipo] + (m.detalhe ? ` · ${m.detalhe}` : '');
  $('#regua-copiar').disabled = false;
}

// ---------- eventos ----------

chrome.runtime.onMessage.addListener((msg, remetente) => {
  // O overlay do simulador e o service worker identificam a aba no corpo da mensagem.
  if (msg.tipo === 'garimpo:sim-estado' && msg.tabId === estado.tabId) { estado.sim = { id: msg.id, w: msg.w, h: msg.h, girado: msg.girado }; renderTelas(); return; }
  if (msg.tipo === 'garimpo:sim-fechado' && msg.tabId === estado.tabId) { estado.sim = null; renderTelas(); return; }
  if (remetente.tab?.id !== estado.tabId) return;
  if (msg.tipo === 'garimpo:elemento') { inspetorParou(); renderElemento(msg.dados); }
  if (msg.tipo === 'garimpo:inspetor-parou') inspetorParou();
  if (msg.tipo === 'garimpo:regua') mostrarMedida(msg.medida);
  if (msg.tipo === 'garimpo:regua-desligada') definirRegua(false);
});

$('#regua').addEventListener('click', alternarRegua);
$('#regua-desligar').addEventListener('click', alternarRegua);
$('#regua-copiar').addEventListener('click', () => estado.medida && copiar(estado.medida.texto.replace(' × ', 'x'), 'Medida copiada'));
$('#regua-guias').addEventListener('click', () => {
  chrome.scripting.executeScript({ target: { tabId: estado.tabId }, func: () => window.__garimpoRegua?.limparGuias() }).catch(() => {});
});
$('#sim-aplicar').addEventListener('click', () => {
  const w = Math.max(200, Math.min(3840, +$('#sim-w').value || 390));
  const h = Math.max(200, Math.min(3840, +$('#sim-h').value || 844));
  simular(personalizado(w, h));
});
$('#sim-girar').addEventListener('click', () => chrome.runtime.sendMessage({ tipo: 'garimpo:sim-dispositivo', tabId: estado.tabId, girar: true }).catch(() => {}));
$('#sim-fechar').addEventListener('click', async () => {
  await fecharSimulador(estado.tabId);
  estado.sim = null;
  renderTelas();
});

chrome.tabs.onActivated.addListener(() => { inspetorParou(); sincronizarAba(); });
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id === estado.tabId && info.status === 'complete') { inspetorParou(); sincronizarAba(true); }
});

for (const b of $$('.abas button')) b.addEventListener('click', () => mostrarAba(b.dataset.aba));
$('#recarregar').addEventListener('click', () => sincronizarAba(true));
for (const b of $$('#formato-cor button')) {
  b.addEventListener('click', () => {
    estado.formatoCor = b.dataset.fmt;
    for (const x of $$('#formato-cor button')) x.setAttribute('aria-pressed', String(x === b));
  });
}
$('#copiar-export').addEventListener('click', () => copiar(textoExport(), `${FORMATOS[estado.formatoExport].rotulo} copiado`));
$('#baixar-export').addEventListener('click', () => {
  const f = FORMATOS[estado.formatoExport];
  baixarBlob(new Blob([textoExport()], { type: 'text/plain' }), `${pastaHost()}/${f.arquivo}`);
});
$('#baixar-sel').addEventListener('click', baixarSelecionados);
$('#clonar').addEventListener('click', clonar);
$('#inspecionar').addEventListener('click', alternarInspetor);
$('#el-pai').addEventListener('click', () => inspetor('pai'));
$('#el-filho').addEventListener('click', () => inspetor('filho'));
$('#el-css').addEventListener('click', () => estado.elemento && copiar(estado.elemento.css, 'CSS copiado'));
$('#el-html').addEventListener('click', () => estado.elemento && copiar(estado.elemento.html, estado.elemento.truncado ? 'HTML copiado (truncado em 400 nós)' : 'HTML copiado'));
$('#el-prompt').addEventListener('click', () => estado.elemento && copiar(promptIA(estado.elemento), 'Prompt copiado'));
$('#el-baixar').addEventListener('click', () => {
  const d = estado.elemento;
  if (d) baixarBlob(new Blob([htmlAutonomo(d)], { type: 'text/html' }), `${pastaHost()}/elementos/${d.tag}-${Date.now()}.html`);
});
addEventListener('pagehide', () => { if (inspecionando && estado.tabId) inspetor('parar').catch(() => {}); });

// Exposto para testes automatizados.
window.__garimpoPainel = { estado, escala };

renderTelas();
sincronizarAba(true);
