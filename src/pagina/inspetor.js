// Inspetor de elementos. Injetado sob demanda; envia o elemento escolhido ao painel.
(() => {
  if (window.__garimpoInspetor) return;

  const NS_SVG = 'http://www.w3.org/2000/svg';
  let host, raiz, caixa, rotulo, ativo = false, atual = null, selecionado = null;

  function montarOverlay() {
    host = document.createElement('div');
    host.setAttribute('data-garimpo', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>
        .caixa{position:fixed;border:1.5px solid #e8590c;background:rgba(232,89,12,.08);box-sizing:border-box}
        .pad{position:absolute;inset:0;box-sizing:border-box;border-style:solid;border-color:rgba(46,160,67,.22)}
        .rot{position:fixed;font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;background:#1b1b1a;color:#f4f2ec;
             padding:3px 6px;border-radius:4px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
        .rot b{color:#ffb38a;font-weight:600}
      </style>
      <div class="caixa"><div class="pad"></div></div><div class="rot"></div>`;
    caixa = raiz.querySelector('.caixa');
    rotulo = raiz.querySelector('.rot');
    document.documentElement.appendChild(host);
  }

  function nomeCurto(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (classes.length) s += '.' + classes.join('.');
    return s;
  }

  function desenhar(el) {
    if (!host) montarOverlay();
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    Object.assign(caixa.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: 'block' });
    caixa.firstElementChild.style.borderWidth = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`;
    rotulo.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = nomeCurto(el);
    rotulo.append(b, ` ${Math.round(r.width)}×${Math.round(r.height)}`);
    const topo = r.top > 24 ? r.top - 22 : Math.min(innerHeight - 22, r.bottom + 4);
    Object.assign(rotulo.style, { left: Math.max(4, Math.min(r.left, innerWidth - 220)) + 'px', top: topo + 'px', display: 'block' });
  }

  function esconder() {
    if (caixa) caixa.style.display = 'none';
    if (rotulo) rotulo.style.display = 'none';
  }

  const alvoValido = el => el && el !== host && el.nodeType === 1 && !el.closest?.('[data-garimpo]');

  function aoMover(e) {
    const el = e.composedPath ? e.composedPath()[0] : e.target;
    if (!alvoValido(el) || el === atual) return;
    atual = el;
    desenhar(el);
  }

  function aoClicar(e) {
    if (!ativo) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = atual || e.target;
    if (!alvoValido(el)) return;
    parar();
    selecionar(el);
  }

  function bloquear(e) { if (ativo) { e.preventDefault(); e.stopPropagation(); } }

  function aoTeclar(e) {
    if (e.key === 'Escape') { parar(); chrome.runtime.sendMessage({ tipo: 'garimpo:inspetor-parou' }); }
  }

  function iniciar() {
    if (ativo) return;
    ativo = true;
    addEventListener('mousemove', aoMover, true);
    addEventListener('click', aoClicar, true);
    addEventListener('mousedown', bloquear, true);
    addEventListener('mouseup', bloquear, true);
    addEventListener('pointerdown', bloquear, true);
    addEventListener('keydown', aoTeclar, true);
    document.documentElement.style.cursor = 'crosshair';
  }

  function parar() {
    ativo = false;
    removeEventListener('mousemove', aoMover, true);
    removeEventListener('click', aoClicar, true);
    removeEventListener('mousedown', bloquear, true);
    removeEventListener('mouseup', bloquear, true);
    removeEventListener('pointerdown', bloquear, true);
    removeEventListener('keydown', aoTeclar, true);
    document.documentElement.style.cursor = '';
    atual = null;
    if (!selecionado) esconder();
  }

  function selecionar(el) {
    selecionado = el;
    el.scrollIntoView({ block: 'nearest' });
    desenhar(el);
    chrome.runtime.sendMessage({ tipo: 'garimpo:elemento', dados: descrever(el) });
  }

  // ---------- descrição do elemento ----------

  const GRUPOS = {
    Layout: ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'min-width', 'max-width', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows', 'overflow', 'z-index', 'box-sizing'],
    Espaçamento: ['margin', 'padding'],
    Tipografia: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'text-decoration-line', 'color', 'white-space'],
    'Fundo e borda': ['background-color', 'background-image', 'background-size', 'background-position', 'border', 'border-radius', 'box-shadow', 'outline', 'opacity', 'backdrop-filter', 'filter', 'mix-blend-mode'],
    Movimento: ['transform', 'transition', 'animation', 'cursor'],
  };

  const VAZIOS = new Set(['none', 'normal', 'auto', '0px', 'static', 'visible', 'start', 'stretch', 'nowrap', 'row', 'content-box', 'all 0s ease 0s', '0s ease 0s 1 normal none running none', 'rgba(0, 0, 0, 0)', '1', '0px none rgb(0, 0, 0)', 'ltr']);

  function valor(cs, prop) {
    if (prop === 'margin' || prop === 'padding') {
      const v = ['top', 'right', 'bottom', 'left'].map(l => cs.getPropertyValue(`${prop}-${l}`));
      return v.every(x => x === v[0]) ? v[0] : v[1] === v[3] && v[0] === v[2] ? `${v[0]} ${v[1]}` : v.join(' ');
    }
    if (prop === 'border') {
      const w = cs.borderTopWidth;
      return w === '0px' || cs.borderTopStyle === 'none' ? 'none' : `${w} ${cs.borderTopStyle} ${cs.borderTopColor}`;
    }
    return cs.getPropertyValue(prop);
  }

  function grupos(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const [nome, props] of Object.entries(GRUPOS)) {
      const linhas = [];
      for (const p of props) {
        const v = valor(cs, p);
        if (v && !VAZIOS.has(v)) linhas.push([p, v]);
      }
      if (linhas.length) out[nome] = linhas;
    }
    return out;
  }

  // Regras :hover/:focus/:active cujo seletor (sem o pseudo) casa com o elemento.
  function estados(el) {
    const achados = [];
    const RE = /:(hover|focus-visible|focus-within|focus|active)\b/g;
    const visitar = regras => {
      for (const r of regras) {
        if (r.cssRules && !(r instanceof CSSStyleRule)) {
          if (r instanceof CSSMediaRule && !matchMedia(r.conditionText || r.media.mediaText).matches) continue;
          visitar(r.cssRules);
          continue;
        }
        if (!(r instanceof CSSStyleRule) || !RE.test(r.selectorText)) continue;
        RE.lastIndex = 0;
        for (const sel of r.selectorText.split(',')) {
          const m = sel.match(RE);
          if (!m) continue;
          const base = sel.replace(RE, '').trim() || '*';
          let casa = false;
          try { casa = el.matches(base); } catch { /* seletor inválido */ }
          if (casa) { achados.push({ estado: m[0].slice(1), seletor: sel.trim(), css: r.style.cssText, regra: r }); break; }
        }
        if (achados.length >= 12) return;
      }
    };
    for (const f of document.styleSheets) {
      try { visitar(f.cssRules); } catch { /* cross-origin */ }
    }
    return achados;
  }

  function corEfetivaDeFundo(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        if (p.length < 4 || p[3] > 0.5) return bg;
      } else if (bg && bg !== 'transparent') return bg;
    }
    return 'rgb(255, 255, 255)';
  }

  function paraRgb(cor) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = cor;
    c.fillRect(0, 0, 1, 1);
    return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }

  function contraste(a, b) {
    const lum = ([r, g, bl]) => [r, g, bl].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [x, y] = [lum(paraRgb(a)), lum(paraRgb(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  function seletorUnico(el) {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const partes = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id) { partes.unshift('#' + CSS.escape(n.id)); break; }
      const irmaos = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (irmaos.length > 1) p += `:nth-of-type(${irmaos.indexOf(n) + 1})`;
      partes.unshift(p);
      if (partes.length >= 5) break;
    }
    return partes.join(' > ');
  }

  // ---------- exportação: HTML autônomo com estilos computados inline ----------

  const PROPS_EXPORT = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self', 'align-content', 'order', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'text-decoration-color', 'white-space', 'color', 'text-shadow',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'transform', 'transition', 'filter', 'backdrop-filter', 'object-fit', 'cursor', 'list-style-type', 'fill', 'stroke',
  ];
  const HERDADAS = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'color', 'text-shadow', 'cursor', 'list-style-type', 'fill', 'stroke']);

  let quadroPadrao = null;
  const cachePadrao = new Map();
  function estiloPadrao(tag) {
    if (cachePadrao.has(tag)) return cachePadrao.get(tag);
    if (!quadroPadrao) {
      quadroPadrao = document.createElement('iframe');
      quadroPadrao.setAttribute('data-garimpo', '');
      quadroPadrao.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      document.documentElement.appendChild(quadroPadrao);
    }
    const doc = quadroPadrao.contentDocument;
    const el = tag.includes(':') || ['svg', 'path', 'g', 'circle', 'rect'].includes(tag) ? doc.createElementNS(NS_SVG, tag) : doc.createElement(tag);
    doc.body.appendChild(el);
    const cs = quadroPadrao.contentWindow.getComputedStyle(el);
    const mapa = {};
    for (const p of PROPS_EXPORT) mapa[p] = cs.getPropertyValue(p);
    el.remove();
    cachePadrao.set(tag, mapa);
    return mapa;
  }

  function estiloInline(el, csPai, raizExport) {
    const cs = getComputedStyle(el);
    const padrao = estiloPadrao(el.tagName.toLowerCase());
    const decl = [];
    for (const p of PROPS_EXPORT) {
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (HERDADAS.has(p)) {
        if (!raizExport && csPai && csPai.getPropertyValue(p) === v) continue;
        if (raizExport && v === padrao[p]) continue;
      } else if (v === padrao[p]) continue;
      // Larguras/alturas fixas só na raiz; nos filhos o fluxo resolve.
      if (!raizExport && (p === 'width' || p === 'height') && !/^(img|svg|video|canvas|iframe)$/i.test(el.tagName) && cs.display !== 'inline-block') continue;
      decl.push(`${p}:${v}`);
    }
    return decl.join(';');
  }

  function htmlAutonomo(el) {
    const LIMITE = 400;
    let contagem = 0;
    const copiar = (o, csPai, ehRaiz) => {
      if (o.nodeType === 3) return document.createTextNode(o.textContent);
      if (o.nodeType !== 1 || o.hasAttribute('data-garimpo') || /^(script|style|noscript|template)$/i.test(o.tagName)) return null;
      if (o instanceof SVGSVGElement) {
        const svg = o.cloneNode(true);
        svg.setAttribute('style', estiloInline(o, csPai, ehRaiz));
        return svg;
      }
      if (++contagem > LIMITE) return null;
      const n = document.createElement(o.tagName.toLowerCase());
      for (const a of o.attributes) {
        if (/^(class|id|style|on.*|data-.*|srcset|sizes|loading)$/i.test(a.name)) continue;
        let v = a.value;
        if (/^(src|href|poster|action)$/i.test(a.name)) { try { v = new URL(v, document.baseURI).href; } catch { /* mantém */ } }
        n.setAttribute(a.name, v);
      }
      if (o.tagName === 'IMG' && o.currentSrc) n.setAttribute('src', o.currentSrc);
      let estilo = estiloInline(o, csPai, ehRaiz);
      estilo = estilo.replace(/url\("?(.*?)"?\)/g, (m, u) => { try { return `url("${new URL(u, document.baseURI).href}")`; } catch { return m; } });
      if (estilo) n.setAttribute('style', estilo);
      const cs = getComputedStyle(o);
      for (const filho of o.childNodes) {
        const c = copiar(filho, cs, false);
        if (c) n.appendChild(c);
      }
      return n;
    };
    const pai = el.parentElement ? getComputedStyle(el.parentElement) : null;
    const no = copiar(el, pai, true);
    return { html: no ? no.outerHTML : '', truncado: contagem > LIMITE };
  }

  function cssDoElemento(el) {
    const cs = getComputedStyle(el);
    const padrao = estiloPadrao(el.tagName.toLowerCase());
    const linhas = PROPS_EXPORT.filter(p => cs.getPropertyValue(p) && cs.getPropertyValue(p) !== padrao[p]).map(p => `  ${p}: ${cs.getPropertyValue(p)};`);
    const nome = (typeof el.className === 'string' && el.className.trim().split(/\s+/)[0]) || el.tagName.toLowerCase();
    return `.${nome.replace(/[^\w-]/g, '-')} {\n${linhas.join('\n')}\n}`;
  }

  // O mouse está sobre o elemento no clique: desliga regras :hover/:active e transições
  // durante a leitura para capturar o estado base. Devolve a função que restaura tudo.
  function congelarEstadoBase(el, achados) {
    const salvas = achados.map(a => [a.regra, a.regra.style.cssText]);
    for (const [regra] of salvas) regra.style.cssText = '';
    const alvos = [el, ...el.querySelectorAll('*')].slice(0, 400);
    const transicoes = alvos.map(n => [n, n.style.getPropertyValue('transition'), n.style.getPropertyPriority('transition')]);
    for (const n of alvos) n.style.setProperty('transition', 'none', 'important');
    return () => {
      for (const [regra, css] of salvas) regra.style.cssText = css;
      for (const [n, v, p] of transicoes) {
        if (v) n.style.setProperty('transition', v, p); else n.style.removeProperty('transition');
        if (!n.getAttribute('style')) n.removeAttribute('style');
      }
    };
  }

  function descrever(el) {
    const achados = estados(el);
    const restaurar = congelarEstadoBase(el, achados);
    try { return descreverBase(el, achados.map(({ regra, ...resto }) => resto)); } finally { restaurar(); }
  }

  function descreverBase(el, est) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const texto = (el.innerText || el.textContent || '').trim();
    const fundo = corEfetivaDeFundo(el);
    const temTexto = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const autonomo = htmlAutonomo(el);
    return {
      tag: el.tagName.toLowerCase(),
      nome: nomeCurto(el),
      seletor: seletorUnico(el),
      id: el.id || '',
      classes: typeof el.className === 'string' ? el.className : '',
      texto: texto.slice(0, 300),
      largura: Math.round(r.width),
      altura: Math.round(r.height),
      grupos: grupos(el),
      estados: est,
      acessibilidade: {
        papel: el.getAttribute('role') || '',
        rotulo: el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '',
        contraste: temTexto ? +contraste(cs.color, fundo).toFixed(2) : null,
        corTexto: cs.color,
        corFundo: fundo,
        tamanhoFonte: parseFloat(cs.fontSize),
        pesoFonte: +cs.fontWeight || 400,
      },
      css: cssDoElemento(el),
      html: autonomo.html,
      truncado: autonomo.truncado,
      pagina: { url: location.href, titulo: document.title },
      temPai: !!el.parentElement && el.parentElement !== document.documentElement,
    };
  }

  window.__garimpoInspetor = {
    iniciar,
    parar: () => { parar(); selecionado = null; esconder(); },
    pai: () => { if (selecionado?.parentElement && selecionado.parentElement !== document.documentElement) selecionar(selecionado.parentElement); },
    filho: () => { const f = selecionado?.firstElementChild; if (f) selecionar(f); },
    limpar: () => { selecionado = null; esconder(); },
  };
})();
