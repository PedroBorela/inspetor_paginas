// Injetado sob demanda na aba (mundo isolado). Lê o DOM e o CSSOM e devolve dados serializáveis.
// O painel chama window.__garimpo.<acao>() via chrome.scripting.executeScript.
(() => {
  if (window.__garimpo) return;

  const LIMITE_ELEMENTOS = 6000;

  // ---------- utilidades ----------

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cacheCor = new Map();

  // Normaliza qualquer cor CSS (oklch, color(), hsl, nomes...) para #rrggbb + alfa.
  function normalizarCor(str) {
    if (!str) return null;
    if (cacheCor.has(str)) return cacheCor.get(str);
    let res = null;
    const s = str.trim();
    if (s && s !== 'transparent' && s !== 'none' && !/^(inherit|initial|unset|currentcolor)$/i.test(s)) {
      ctx.fillStyle = '#010203';
      ctx.fillStyle = s;
      if (ctx.fillStyle !== '#010203' || /^#010203$/i.test(s)) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        if (a > 0) {
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
          res = { hex, alfa: +(a / 255).toFixed(2) };
        }
      }
    }
    cacheCor.set(str, res);
    return res;
  }

  const RE_COR = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;
  const RE_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

  function absoluta(url, base = document.baseURI) {
    try { return new URL(url, base).href; } catch { return null; }
  }

  function urlsDeCss(valor, base) {
    const out = [];
    if (!valor || valor === 'none') return out;
    for (const m of valor.matchAll(RE_URL)) {
      const u = absoluta(m[2], base);
      if (u && /^(https?:|data:image)/.test(u)) out.push(u);
    }
    return out;
  }

  function amostraDeElementos() {
    const todos = document.body ? document.body.querySelectorAll('*') : [];
    const lista = [document.documentElement, document.body].filter(Boolean);
    const passo = Math.max(1, Math.ceil(todos.length / LIMITE_ELEMENTOS));
    for (let i = 0; i < todos.length; i += passo) lista.push(todos[i]);
    return lista.filter(el => !el.closest('[data-garimpo]'));
  }

  function visivel(el, cs) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function textoDireto(el) {
    let n = 0;
    for (const no of el.childNodes) if (no.nodeType === 3) n += no.textContent.trim().length;
    return n;
  }

  const primeiraFamilia = pilha => pilha.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  function contar(mapa, chave, peso = 1) {
    mapa.set(chave, (mapa.get(chave) || 0) + peso);
  }

  function* regrasAcessiveis() {
    for (const folha of document.styleSheets) {
      let regras;
      try { regras = folha.cssRules; } catch { continue; }
      yield* percorrerRegras(regras, folha.href || document.baseURI);
    }
    for (const folha of document.adoptedStyleSheets || []) {
      yield* percorrerRegras(folha.cssRules, document.baseURI);
    }
  }

  function* percorrerRegras(regras, base) {
    for (const r of regras) {
      if (r.cssRules && !(r instanceof CSSStyleRule)) yield* percorrerRegras(r.cssRules, base);
      else if (r instanceof CSSImportRule) {
        try { if (r.styleSheet) yield* percorrerRegras(r.styleSheet.cssRules, r.styleSheet.href || base); } catch { /* cross-origin */ }
      }
      yield { regra: r, base };
      if (r instanceof CSSStyleRule && r.cssRules && r.cssRules.length) yield* percorrerRegras(r.cssRules, base);
    }
  }

  // ---------- estilos ----------

  function estilos() {
    const cores = new Map();
    const familias = new Map();
    const tamanhos = new Map();
    const raios = new Map();
    const sombras = new Map();
    const espacos = new Map();

    const addCor = (valor, uso, peso) => {
      const c = normalizarCor(valor);
      if (!c) return;
      const chave = c.alfa < 1 ? c.hex + Math.round(c.alfa * 255).toString(16).padStart(2, '0') : c.hex;
      let item = cores.get(chave);
      if (!item) cores.set(chave, item = { hex: c.hex, alfa: c.alfa, peso: 0, usos: {} });
      item.peso += peso;
      item.usos[uso] = (item.usos[uso] || 0) + peso;
    };

    const area = innerWidth * innerHeight || 1;

    for (const el of amostraDeElementos()) {
      const cs = getComputedStyle(el);
      if (!visivel(el, cs)) continue;
      const r = el.getBoundingClientRect();
      const fracaoArea = Math.min(1, (r.width * r.height) / area);
      const nTexto = textoDireto(el);
      const tag = el.tagName.toLowerCase();

      addCor(cs.backgroundColor, 'fundo', 1 + fracaoArea * 200);
      if (nTexto) addCor(cs.color, 'texto', 1 + Math.min(nTexto, 400) / 20);
      for (const lado of ['Top', 'Right', 'Bottom', 'Left']) {
        if (px(cs[`border${lado}Width`]) > 0 && cs[`border${lado}Style`] !== 'none') addCor(cs[`border${lado}Color`], 'borda', 0.5);
      }
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
        if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')) addCor(cs.fill, 'svg', 1);
        if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url')) addCor(cs.stroke, 'svg', 0.5);
      }
      if (cs.backgroundImage.includes('gradient')) {
        for (const m of cs.backgroundImage.matchAll(RE_COR)) addCor(m[0], 'gradiente', 2 + fracaoArea * 50);
      }

      if (nTexto) {
        const fam = primeiraFamilia(cs.fontFamily);
        let f = familias.get(fam);
        if (!f) familias.set(fam, f = { familia: fam, pilha: cs.fontFamily, pesos: {}, tamanhos: {}, usos: { titulo: 0, texto: 0, codigo: 0 }, notaTitulo: 0, caracteres: 0, amostra: '' });
        const tam = Math.round(px(cs.fontSize));
        contar2(f.pesos, cs.fontWeight, nTexto);
        contar2(f.tamanhos, tam, nTexto);
        f.caracteres += nTexto;
        const uso = /^h[1-3]$/.test(tag) || tam >= 28 ? 'titulo' : /^(code|pre|kbd|samp)$/.test(tag) ? 'codigo' : 'texto';
        // Em títulos, o tamanho pesa: um h1 de 48px define a marca mais que vários h3 pequenos.
        f.usos[uso] += nTexto;
        if (uso === 'titulo') f.notaTitulo += nTexto * (tam / 16) ** 2;
        if (!f.amostra) f.amostra = el.textContent.trim().slice(0, 60);
        contar(tamanhos, tam, nTexto);
      }

      const raio = px(cs.borderTopLeftRadius);
      if (raio > 0 && raio < 9999) contar(raios, raio);
      if (cs.boxShadow && cs.boxShadow !== 'none') contar(sombras, cs.boxShadow);
      for (const p of ['paddingTop', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
        const v = Math.round(px(cs[p]));
        if (v > 0 && v <= 160) contar(espacos, v);
      }
    }

    // Variáveis CSS de cor declaradas em :root/html/body.
    const variaveis = [];
    const vistas = new Set();
    const raizCs = getComputedStyle(document.documentElement);
    for (const { regra } of regrasAcessiveis()) {
      if (!(regra instanceof CSSStyleRule) || !/(^|,)\s*(:root|html|body)\b/.test(regra.selectorText)) continue;
      for (const prop of regra.style) {
        if (!prop.startsWith('--') || vistas.has(prop)) continue;
        vistas.add(prop);
        const valor = raizCs.getPropertyValue(prop).trim() || regra.style.getPropertyValue(prop).trim();
        if (!valor || /^-?[\d.]+(px|rem|em|%|s|ms)?$/.test(valor)) continue;
        const c = normalizarCor(valor);
        if (c) variaveis.push({ nome: prop, valor, hex: c.hex, alfa: c.alfa });
        if (variaveis.length >= 200) break;
      }
    }

    // @font-face das folhas acessíveis; as cross-origin o painel busca e lê.
    const fontesFace = [];
    const folhasInacessiveis = [];
    for (const folha of document.styleSheets) {
      try { void folha.cssRules; } catch { if (folha.href) folhasInacessiveis.push(folha.href); }
    }
    for (const { regra, base } of regrasAcessiveis()) {
      if (!(regra instanceof CSSFontFaceRule)) continue;
      fontesFace.push({
        familia: regra.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').trim(),
        peso: regra.style.getPropertyValue('font-weight') || '400',
        estilo: regra.style.getPropertyValue('font-style') || 'normal',
        arquivos: urlsDeCssFonte(regra.style.getPropertyValue('src'), base),
      });
    }

    const carregadas = [];
    try {
      for (const f of document.fonts) if (f.status === 'loaded') carregadas.push({ familia: f.family.replace(/^["']|["']$/g, ''), peso: f.weight, estilo: f.style });
    } catch { /* sem FontFaceSet */ }

    const ordenar = mapa => [...mapa.entries()].sort((a, b) => b[1] - a[1]);

    return {
      pagina: infoPagina(),
      cores: [...cores.values()].sort((a, b) => b.peso - a.peso).slice(0, 80),
      variaveis,
      familias: [...familias.values()].sort((a, b) => b.caracteres - a.caracteres),
      fontesFace,
      fontesCarregadas: carregadas,
      folhasInacessiveis,
      tamanhos: ordenar(tamanhos).slice(0, 16).map(([v, n]) => ({ px: +v, peso: n })),
      raios: ordenar(raios).slice(0, 8).map(([v, n]) => ({ px: +v, contagem: n })),
      sombras: ordenar(sombras).slice(0, 8).map(([v, n]) => ({ valor: v, contagem: n })),
      espacos: ordenar(espacos).slice(0, 12).map(([v, n]) => ({ px: +v, contagem: n })),
    };
  }

  function contar2(obj, chave, peso) { obj[chave] = (obj[chave] || 0) + peso; }

  function urlsDeCssFonte(src, base) {
    const out = [];
    for (const m of (src || '').matchAll(RE_URL)) {
      const u = absoluta(m[2], base);
      if (u && /^https?:/.test(u)) out.push(u);
    }
    return out;
  }

  function infoPagina() {
    const meta = n => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.content || '';
    const icone = document.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]');
    return {
      titulo: document.title,
      url: location.href,
      host: location.host,
      descricao: meta('description') || meta('og:description'),
      corTema: meta('theme-color'),
      favicon: icone ? absoluta(icone.getAttribute('href')) : absoluta('/favicon.ico'),
      h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 140),
      h2: [...document.querySelectorAll('h2')].slice(0, 4).map(h => h.innerText.trim().slice(0, 140)).filter(Boolean),
      chamada: ([...document.querySelectorAll('a, button')].find(b => {
        const cs = getComputedStyle(b);
        return visivel(b, cs) && normalizarCor(cs.backgroundColor) && b.innerText.trim().length > 1 && b.innerText.trim().length < 40;
      })?.innerText || '').trim(),
    };
  }

  // ---------- assets ----------

  function serializarSvg(el) {
    const copia = el.cloneNode(true);
    const r = el.getBoundingClientRect();
    copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (copia.querySelector('[*|href]') || el.innerHTML.includes('xlink:')) copia.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (!copia.getAttribute('width') && r.width) copia.setAttribute('width', Math.round(r.width));
    if (!copia.getAttribute('height') && r.height) copia.setAttribute('height', Math.round(r.height));
    // currentColor precisa da cor herdada para funcionar fora da página.
    const cor = getComputedStyle(el).color;
    copia.style.color = cor;
    // <use href="#id"> aponta para sprites fora deste SVG: traz o símbolo junto.
    let defs = null;
    for (const use of copia.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      if (!href.startsWith('#')) continue;
      const id = href.slice(1);
      if (copia.querySelector('#' + CSS.escape(id))) continue;
      const alvo = document.getElementById(id);
      if (!alvo) continue;
      if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); copia.prepend(defs); }
      defs.appendChild(alvo.cloneNode(true));
    }
    return new XMLSerializer().serializeToString(copia);
  }

  function maiorDoSrcset(srcset) {
    let melhor = null, nota = -1;
    for (const parte of (srcset || '').split(/,\s+(?=\S)/)) {
      const [url, desc = '1x'] = parte.trim().split(/\s+/);
      const n = parseFloat(desc) * (desc.endsWith('w') ? 1 : 1000);
      if (url && n > nota) { nota = n; melhor = url; }
    }
    return melhor;
  }

  const ehSvgUrl = u => /^data:image\/svg/.test(u) || /\.svg(\?|#|$)/i.test(u);

  function assets() {
    const itens = new Map();
    const add = (url, tipo, extra = {}) => {
      const abs = url && absoluta(url);
      if (!abs || !/^(https?:|data:)/.test(abs)) return;
      if (abs.startsWith('data:') && (abs.length > 3e6 || !/^data:(image|video)/.test(abs))) return;
      if (tipo === 'imagem' && ehSvgUrl(abs)) tipo = 'svg';
      const atual = itens.get(abs);
      if (atual) { Object.assign(atual, { ...extra, ...atual }); return; }
      itens.set(abs, { url: abs, tipo, ...extra });
    };

    for (const img of document.images) {
      if (img.closest('[data-garimpo]')) continue;
      const lazy = img.dataset.src || img.dataset.lazySrc || img.dataset.original;
      const grande = maiorDoSrcset(img.getAttribute('srcset') || img.dataset.srcset);
      const url = grande || img.currentSrc || img.src || lazy;
      add(url, 'imagem', { largura: img.naturalWidth || undefined, altura: img.naturalHeight || undefined, alt: img.alt || '' });
      if (lazy && lazy !== url) add(lazy, 'imagem', { alt: img.alt || '' });
    }
    for (const s of document.querySelectorAll('picture source[srcset]')) add(maiorDoSrcset(s.getAttribute('srcset')), 'imagem');
    for (const el of amostraDeElementos()) {
      const cs = getComputedStyle(el);
      for (const u of urlsDeCss(cs.backgroundImage)) add(u, 'imagem', { origem: 'css' });
      for (const pseudo of ['::before', '::after']) {
        const p = getComputedStyle(el, pseudo);
        if (p.content === 'none') continue;
        for (const u of urlsDeCss(p.backgroundImage)) add(u, 'imagem', { origem: 'css' });
        for (const u of urlsDeCss(p.content)) add(u, 'imagem', { origem: 'css' });
      }
      if (cs.maskImage && cs.maskImage !== 'none') for (const u of urlsDeCss(cs.maskImage)) add(u, 'svg', { origem: 'mask' });
    }

    for (const v of document.querySelectorAll('video')) {
      const src = v.currentSrc || v.src || v.querySelector('source[src]')?.getAttribute('src');
      if (src && !src.startsWith('blob:')) add(src, 'video', { largura: v.videoWidth || undefined, altura: v.videoHeight || undefined });
      if (v.poster) add(v.poster, 'imagem', { origem: 'poster' });
    }

    for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]')) {
      add(l.getAttribute('href'), 'favicon', { tamanhos: l.getAttribute('sizes') || '' });
    }
    const og = document.querySelector('meta[property="og:image"]')?.content;
    if (og) add(og, 'imagem', { origem: 'og:image' });

    // Lottie: players conhecidos + JSONs que a página baixou (o painel confirma o formato).
    const sel = 'lottie-player, dotlottie-player, dotlottie-wc, [data-lottie], [data-animation-path], [data-src$=".json"], [data-src$=".lottie"]';
    for (const el of document.querySelectorAll(sel)) {
      const src = el.getAttribute('src') || el.dataset.animationPath || el.dataset.lottie || el.dataset.src;
      if (src) add(src, 'lottie');
    }
    try {
      for (const e of performance.getEntriesByType('resource')) {
        if (/\.lottie(\?|$)/i.test(e.name)) add(e.name, 'lottie');
        else if (/\.json(\?|$)/i.test(e.name) && ['fetch', 'xmlhttprequest', 'other'].includes(e.initiatorType)) add(e.name, 'lottie', { candidato: true });
      }
    } catch { /* sem performance API */ }

    const svgs = [];
    const vistos = new Set();
    for (const el of document.querySelectorAll('svg')) {
      if (el.parentElement?.closest('svg') || el.closest('[data-garimpo]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const codigo = serializarSvg(el);
      if (vistos.has(codigo) || codigo.length > 400000) continue;
      vistos.add(codigo);
      svgs.push({ tipo: 'svg-inline', codigo, largura: Math.round(r.width), altura: Math.round(r.height), icone: r.width <= 64 && r.height <= 64, rotulo: el.getAttribute('aria-label') || el.querySelector('title')?.textContent || '' });
    }

    return { pagina: infoPagina(), itens: [...itens.values()].slice(0, 600), svgs: svgs.slice(0, 400) };
  }

  // ---------- snapshot para o clone ----------

  function textoDasRegras(folha) {
    try { return Array.from(folha.cssRules, r => r.cssText).join('\n'); } catch { return null; }
  }

  function snapshot(opcoes = {}) {
    const raiz = document.documentElement;
    const copia = raiz.cloneNode(true);
    const orig = [raiz, ...raiz.querySelectorAll('*')];
    const novo = [copia, ...copia.querySelectorAll('*')];
    const remover = [];

    for (let i = 0; i < orig.length; i++) {
      const o = orig[i], n = novo[i];
      if (!n) break;
      const tag = o.tagName.toLowerCase();

      if (o.hasAttribute('data-garimpo')) { remover.push(n); continue; }

      // CSS-in-JS (insertRule) deixa o <style> vazio: grava as regras do CSSOM.
      if (tag === 'style' && o.sheet) {
        const regras = textoDasRegras(o.sheet);
        if (regras && regras.length > o.textContent.length * 1.5) n.textContent = regras;
      }
      if (tag === 'input') {
        if (o.type === 'checkbox' || o.type === 'radio') { if (o.checked) n.setAttribute('checked', ''); else n.removeAttribute('checked'); }
        else if (o.type !== 'password' && o.type !== 'file') n.setAttribute('value', o.value);
      }
      if (tag === 'textarea') n.textContent = o.value;
      if (tag === 'option') { if (o.selected) n.setAttribute('selected', ''); else n.removeAttribute('selected'); }
      if (tag === 'img') {
        const lazy = o.dataset.src || o.dataset.lazySrc || o.dataset.original;
        const atual = o.currentSrc || o.src || (lazy && absoluta(lazy));
        if (atual) n.setAttribute('src', atual);
        n.removeAttribute('srcset');
        n.removeAttribute('sizes');
        n.removeAttribute('loading');
      }
      if (tag === 'source' && o.parentElement?.tagName === 'PICTURE') remover.push(n);
      if (tag === 'video' && o.currentSrc && !o.currentSrc.startsWith('blob:')) {
        n.setAttribute('src', o.currentSrc);
        n.querySelectorAll('source').forEach(s => s.remove());
      }
      if (tag === 'canvas') {
        try {
          const img = document.createElement('img');
          img.src = o.toDataURL('image/png');
          for (const a of ['id', 'class', 'style', 'width', 'height']) if (o.hasAttribute(a)) img.setAttribute(a, o.getAttribute(a));
          n.replaceWith(img);
        } catch { /* canvas contaminado */ }
      }
      // Shadow DOM aberto vira Declarative Shadow DOM.
      if (o.shadowRoot) {
        const tpl = document.createElement('template');
        tpl.setAttribute('shadowrootmode', 'open');
        let css = '';
        for (const f of o.shadowRoot.adoptedStyleSheets || []) css += (textoDasRegras(f) || '') + '\n';
        tpl.innerHTML = (css ? `<style>${css}</style>` : '') + o.shadowRoot.innerHTML;
        n.prepend(tpl);
      }
      if (!opcoes.scripts) {
        if (tag === 'script' || (tag === 'link' && /modulepreload/i.test(o.rel))) { remover.push(n); continue; }
        for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      }
      if (tag === 'base' || (tag === 'meta' && /content-security-policy/i.test(o.httpEquiv))) remover.push(n);
      if (tag === 'link' && /\b(preload|prefetch|dns-prefetch|preconnect)\b/i.test(o.rel)) remover.push(n);
    }
    remover.forEach(n => n.remove());

    // Folhas adotadas no documento (Lit, Shoelace etc.).
    const adotadas = (document.adoptedStyleSheets || []).map(textoDasRegras).filter(Boolean).join('\n');
    if (adotadas) {
      const s = document.createElement('style');
      s.setAttribute('data-garimpo-adotada', '');
      s.textContent = adotadas;
      copia.querySelector('head')?.appendChild(s);
    }

    // Texto do CSSOM das folhas acessíveis, para quando o fetch falhar no painel.
    const regrasPorHref = {};
    for (const f of document.styleSheets) {
      if (f.href) { const t = textoDasRegras(f); if (t) regrasPorHref[f.href] = t; }
    }

    const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '<!DOCTYPE html>';
    return {
      html: doctype + '\n' + copia.outerHTML,
      base: document.baseURI,
      url: location.href,
      titulo: document.title,
      host: location.host,
      regrasPorHref,
    };
  }

  window.__garimpo = { estilos, assets, snapshot };
})();
