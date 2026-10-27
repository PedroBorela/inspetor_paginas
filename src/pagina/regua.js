// Régua de página: réguas nas bordas, mira, áreas medidas, distâncias entre elementos e guias.
// Tudo desenhado num canvas fixo; coordenadas da página (scroll incluído) nos rótulos e nas guias.
(() => {
  if (window.__garimpoRegua) return;

  const COR = '#e8590c';
  const COR_GUIA = '#1c7ed6';
  const REGUA = 20;
  const ARRASTO_MIN = 4;

  let host, canvas, ctx, dpr = 1, ativo = false;
  let mouse = null;            // {x, y} na viewport
  let hover = null;            // elemento sob o mouse
  let ancora = null;           // elemento fixado por clique
  let area = null;             // {x1, y1, x2, y2} em coordenadas da página
  let arrasto = null;          // {x, y, tipo: 'area' | 'guia', guia?}
  let guias = [];              // {eixo: 'x' | 'y', pos (página)}
  let quadro = 0;

  const sx = () => scrollX, sy = () => scrollY;

  function montar() {
    host = document.createElement('div');
    host.setAttribute('data-garimpo', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    const raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>
        canvas{position:fixed;inset:0;width:100vw;height:100vh;display:block}
        .dica{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#1b1b1a;color:#f4f2ec;
              font:500 11.5px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:7px 11px;border-radius:8px;white-space:nowrap}
        .dica b{color:#ffb38a;font-weight:600}
      </style>
      <canvas></canvas>
      <div class="dica"><b>Arraste</b>: medir área · <b>Clique</b>: fixar elemento e medir distâncias · <b>Régua</b>: puxar guia · <b>Esc</b>: sair</div>`;
    canvas = raiz.querySelector('canvas');
    ctx = canvas.getContext('2d');
    document.documentElement.appendChild(host);
    redimensionar();
  }

  function redimensionar() {
    dpr = devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    pedirDesenho();
  }

  function pedirDesenho() {
    if (!quadro) quadro = requestAnimationFrame(() => { quadro = 0; desenhar(); });
  }

  // ---------- desenho ----------

  function pilula(texto, x, y, { cor = COR, alinhar = 'centro' } = {}) {
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w = ctx.measureText(texto).width + 10, h = 18;
    let px = alinhar === 'centro' ? x - w / 2 : x;
    let py = y - h / 2;
    px = Math.max(REGUA + 2, Math.min(innerWidth - w - 2, px));
    py = Math.max(REGUA + 2, Math.min(innerHeight - h - 2, py));
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.roundRect(px, py, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, px + 5, py + h / 2 + 0.5);
  }

  function caixa(r, { cor = COR, preencher = false, tracejado = false } = {}) {
    ctx.save();
    ctx.strokeStyle = cor;
    ctx.lineWidth = 1;
    if (tracejado) ctx.setLineDash([4, 3]);
    if (preencher) { ctx.fillStyle = cor + '1f'; ctx.fillRect(r.left, r.top, r.width, r.height); }
    ctx.strokeRect(Math.round(r.left) + 0.5, Math.round(r.top) + 0.5, Math.round(r.width) - 1, Math.round(r.height) - 1);
    ctx.restore();
  }

  function linha(x1, y1, x2, y2, { cor = COR, tracejado = false } = {}) {
    ctx.save();
    ctx.strokeStyle = cor;
    ctx.lineWidth = 1;
    if (tracejado) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  const fmt = n => String(Math.round(n));

  function desenharReguas() {
    ctx.fillStyle = 'rgba(250, 249, 247, 0.94)';
    ctx.fillRect(0, 0, innerWidth, REGUA);
    ctx.fillRect(0, 0, REGUA, innerHeight);
    ctx.strokeStyle = '#8a877f';
    ctx.fillStyle = '#4a4843';
    ctx.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    const x0 = sx(), y0 = sy();
    for (let p = Math.ceil(x0 / 10) * 10; p - x0 < innerWidth; p += 10) {
      const x = Math.round(p - x0) + 0.5;
      if (x < REGUA) continue;
      const t = p % 100 === 0 ? 10 : p % 50 === 0 ? 6 : 3;
      ctx.moveTo(x, REGUA); ctx.lineTo(x, REGUA - t);
      if (p % 100 === 0) ctx.fillText(String(p), x + 2, 2);
    }
    for (let p = Math.ceil(y0 / 10) * 10; p - y0 < innerHeight; p += 10) {
      const y = Math.round(p - y0) + 0.5;
      if (y < REGUA) continue;
      const t = p % 100 === 0 ? 10 : p % 50 === 0 ? 6 : 3;
      ctx.moveTo(REGUA, y); ctx.lineTo(REGUA - t, y);
      if (p % 100 === 0) {
        ctx.save();
        ctx.translate(2, y + 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(String(p), 0, -10);
        ctx.restore();
      }
    }
    ctx.stroke();
    ctx.strokeStyle = '#c9c5bc';
    linha(0, REGUA, innerWidth, REGUA, { cor: '#c9c5bc' });
    linha(REGUA, 0, REGUA, innerHeight, { cor: '#c9c5bc' });
    ctx.fillStyle = 'rgba(250, 249, 247, 1)';
    ctx.fillRect(0, 0, REGUA, REGUA);
    // Posição do mouse marcada nas réguas.
    if (mouse) {
      ctx.fillStyle = COR;
      ctx.fillRect(mouse.x - 0.5, 0, 1, REGUA);
      ctx.fillRect(0, mouse.y - 0.5, REGUA, 1);
    }
  }

  function desenharGuias() {
    for (const g of guias) {
      const v = g.eixo === 'x' ? g.pos - sx() : g.pos - sy();
      if (g.eixo === 'x') linha(v, REGUA, v, innerHeight, { cor: COR_GUIA });
      else linha(REGUA, v, innerWidth, v, { cor: COR_GUIA });
    }
  }

  // Distâncias entre a âncora (a) e o elemento sob o mouse (b), em viewport.
  function desenharDistancias(a, b) {
    const dentro = (p, q) => p.left >= q.left && p.right <= q.right && p.top >= q.top && p.bottom <= q.bottom;
    if (dentro(b, a) || dentro(a, b)) {
      const [i, o] = dentro(b, a) ? [b, a] : [a, b];
      const cx = i.left + i.width / 2, cy = i.top + i.height / 2;
      const gaps = [
        [cx, o.top, cx, i.top, i.top - o.top],
        [cx, i.bottom, cx, o.bottom, o.bottom - i.bottom],
        [o.left, cy, i.left, cy, i.left - o.left],
        [i.right, cy, o.right, cy, o.right - i.right],
      ];
      for (const [x1, y1, x2, y2, d] of gaps) {
        if (d < 0.5) continue;
        linha(x1, y1, x2, y2);
        pilula(fmt(d), (x1 + x2) / 2, (y1 + y2) / 2);
      }
      return;
    }
    // Horizontal
    const yMeio = Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)
      ? (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2
      : b.top + b.height / 2;
    if (b.left >= a.right) { linha(a.right, yMeio, b.left, yMeio); pilula(fmt(b.left - a.right), (a.right + b.left) / 2, yMeio); }
    else if (b.right <= a.left) { linha(b.right, yMeio, a.left, yMeio); pilula(fmt(a.left - b.right), (b.right + a.left) / 2, yMeio); }
    // Vertical
    const xMeio = Math.max(a.left, b.left) < Math.min(a.right, b.right)
      ? (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2
      : b.left + b.width / 2;
    if (b.top >= a.bottom) { linha(xMeio, a.bottom, xMeio, b.top); pilula(fmt(b.top - a.bottom), xMeio, (a.bottom + b.top) / 2); }
    else if (b.bottom <= a.top) { linha(xMeio, b.bottom, xMeio, a.top); pilula(fmt(a.top - b.bottom), xMeio, (b.bottom + a.top) / 2); }
    // Linhas de extensão tracejadas quando não há sobreposição em nenhum eixo.
    const semX = b.left >= a.right || b.right <= a.left;
    const semY = b.top >= a.bottom || b.bottom <= a.top;
    if (semX && semY) {
      linha(xMeio, Math.min(a.top, b.top), xMeio, Math.max(a.bottom, b.bottom), { tracejado: true });
      linha(Math.min(a.left, b.left), yMeio, Math.max(a.right, b.right), yMeio, { tracejado: true });
    }
  }

  function desenhar() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!ativo) return;

    desenharGuias();

    const rAncora = ancora?.isConnected ? ancora.getBoundingClientRect() : null;
    const rHover = hover && hover !== ancora && hover.isConnected ? hover.getBoundingClientRect() : null;

    if (rHover && !arrasto) {
      caixa(rHover, { cor: COR, tracejado: !!rAncora });
      if (!rAncora) pilula(`${fmt(rHover.width)} × ${fmt(rHover.height)}`, rHover.left + rHover.width / 2, rHover.bottom + 12);
    }
    if (rAncora) {
      caixa(rAncora, { preencher: true });
      pilula(`${fmt(rAncora.width)} × ${fmt(rAncora.height)}`, rAncora.left + rAncora.width / 2, rAncora.top - 12);
      if (rHover) desenharDistancias(rAncora, rHover);
    }

    if (area) {
      const x = Math.min(area.x1, area.x2) - sx(), y = Math.min(area.y1, area.y2) - sy();
      const w = Math.abs(area.x2 - area.x1), h = Math.abs(area.y2 - area.y1);
      caixa({ left: x, top: y, width: w, height: h }, { preencher: true });
      pilula(`${fmt(w)} × ${fmt(h)}`, x + w / 2, y + h + 12);
    }

    if (mouse && !arrasto) {
      linha(mouse.x, REGUA, mouse.x, innerHeight, { cor: COR + '66', tracejado: true });
      linha(REGUA, mouse.y, innerWidth, mouse.y, { cor: COR + '66', tracejado: true });
      pilula(`${fmt(mouse.x + sx())}, ${fmt(mouse.y + sy())}`, mouse.x + 10, mouse.y + 16, { cor: '#1b1b1a', alinhar: 'esquerda' });
    }
    if (arrasto?.tipo === 'guia' && arrasto.guia) {
      const g = arrasto.guia;
      const v = g.eixo === 'x' ? g.pos - sx() : g.pos - sy();
      pilula(fmt(g.pos), g.eixo === 'x' ? v : REGUA + 30, g.eixo === 'x' ? REGUA + 14 : v, { cor: COR_GUIA });
    }

    desenharReguas();
  }

  // ---------- interação ----------

  const ehNosso = el => !el || el === host || el.closest?.('[data-garimpo]');

  function elementoEm(x, y) {
    const el = document.elementFromPoint(x, y);
    return ehNosso(el) || el === document.documentElement || el === document.body ? null : el;
  }

  function guiaPerto(x, y) {
    return guias.find(g => (g.eixo === 'x' ? Math.abs(g.pos - sx() - x) : Math.abs(g.pos - sy() - y)) <= 3);
  }

  function enviar(medida) {
    try { chrome.runtime.sendMessage({ tipo: 'garimpo:regua', medida }); } catch { /* painel fechado */ }
  }

  function aoMover(e) {
    mouse = { x: e.clientX, y: e.clientY };
    if (arrasto?.tipo === 'guia') {
      const g = arrasto.guia;
      g.pos = g.eixo === 'x' ? e.clientX + sx() : e.clientY + sy();
    } else if (arrasto?.tipo === 'area') {
      if (!area && Math.hypot(e.clientX - arrasto.x, e.clientY - arrasto.y) >= ARRASTO_MIN) {
        area = { x1: arrasto.x + sx(), y1: arrasto.y + sy() };
        ancora = null;
      }
      if (area) { area.x2 = e.clientX + sx(); area.y2 = e.clientY + sy(); }
    } else {
      hover = e.clientX > REGUA && e.clientY > REGUA ? elementoEm(e.clientX, e.clientY) : null;
      const cursor = guiaPerto(e.clientX, e.clientY) ? (guiaPerto(e.clientX, e.clientY).eixo === 'x' ? 'ew-resize' : 'ns-resize') : 'crosshair';
      document.documentElement.style.cursor = cursor;
    }
    pedirDesenho();
  }

  function aoBaixar(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { clientX: x, clientY: y } = e;
    const existente = guiaPerto(x, y);
    if (existente) arrasto = { tipo: 'guia', guia: existente };
    else if (y <= REGUA && x > REGUA) { const g = { eixo: 'x', pos: x + sx() }; guias.push(g); arrasto = { tipo: 'guia', guia: g }; }
    else if (x <= REGUA && y > REGUA) { const g = { eixo: 'y', pos: y + sy() }; guias.push(g); arrasto = { tipo: 'guia', guia: g }; }
    else { arrasto = { tipo: 'area', x, y }; area = null; }
    pedirDesenho();
  }

  function aoSoltar(e) {
    if (!arrasto) return;
    e.preventDefault();
    e.stopPropagation();
    const a = arrasto;
    arrasto = null;
    if (a.tipo === 'guia') {
      // Soltou em cima da régua: remove a guia.
      const naRegua = a.guia.eixo === 'x' ? e.clientY <= REGUA : e.clientX <= REGUA;
      if (naRegua) guias = guias.filter(g => g !== a.guia);
      else enviar({ tipo: 'guia', texto: `guia ${a.guia.eixo === 'x' ? 'vertical' : 'horizontal'} em ${fmt(a.guia.pos)}px` });
    } else if (area) {
      const w = Math.abs(area.x2 - area.x1), h = Math.abs(area.y2 - area.y1);
      enviar({ tipo: 'area', texto: `${fmt(w)} × ${fmt(h)}`, detalhe: `x ${fmt(Math.min(area.x1, area.x2))}, y ${fmt(Math.min(area.y1, area.y2))}` });
    } else {
      // Clique simples: fixa/solta elemento.
      area = null;
      const el = elementoEm(e.clientX, e.clientY);
      ancora = el && el !== ancora ? el : null;
      if (ancora) {
        const r = ancora.getBoundingClientRect();
        enviar({ tipo: 'elemento', texto: `${fmt(r.width)} × ${fmt(r.height)}`, detalhe: nome(ancora) });
      }
    }
    pedirDesenho();
  }

  function nome(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (c.length) s += '.' + c.join('.');
    return s;
  }

  function aoClicar(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }

  function aoDuploClique(e) {
    const g = guiaPerto(e.clientX, e.clientY);
    if (g) { guias = guias.filter(x => x !== g); pedirDesenho(); }
    aoClicar(e);
  }

  function aoTeclar(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (area || ancora) { area = null; ancora = null; pedirDesenho(); return; }
    desligar();
    try { chrome.runtime.sendMessage({ tipo: 'garimpo:regua-desligada' }); } catch { /* painel fechado */ }
  }

  // Ao passar o mouse com a âncora fixada, avisa o painel das distâncias.
  let ultimoEnvio = '';
  function avisarDistancias() {
    if (!ancora || !hover || hover === ancora) return;
    const a = ancora.getBoundingClientRect(), b = hover.getBoundingClientRect();
    const partes = [];
    if (b.left >= a.right) partes.push(`→ ${fmt(b.left - a.right)}`);
    if (b.right <= a.left) partes.push(`← ${fmt(a.left - b.right)}`);
    if (b.top >= a.bottom) partes.push(`↓ ${fmt(b.top - a.bottom)}`);
    if (b.bottom <= a.top) partes.push(`↑ ${fmt(a.top - b.bottom)}`);
    const texto = partes.join('  ');
    if (texto && texto !== ultimoEnvio) { ultimoEnvio = texto; enviar({ tipo: 'distancia', texto, detalhe: `${nome(ancora)} ↔ ${nome(hover)}` }); }
  }

  const eventos = [
    ['mousemove', e => { aoMover(e); avisarDistancias(); }],
    ['mousedown', aoBaixar],
    ['mouseup', aoSoltar],
    ['click', aoClicar],
    ['dblclick', aoDuploClique],
    ['pointerdown', e => { if (e.button === 0) e.stopPropagation(); }],
    ['keydown', aoTeclar],
  ];
  const aoRolar = () => pedirDesenho();

  function ligar() {
    if (ativo) return;
    if (!host) montar();
    host.style.display = '';
    ativo = true;
    for (const [t, f] of eventos) addEventListener(t, f, true);
    addEventListener('scroll', aoRolar, true);
    addEventListener('resize', redimensionar);
    document.documentElement.style.cursor = 'crosshair';
    pedirDesenho();
  }

  function desligar() {
    ativo = false;
    for (const [t, f] of eventos) removeEventListener(t, f, true);
    removeEventListener('scroll', aoRolar, true);
    removeEventListener('resize', redimensionar);
    document.documentElement.style.cursor = '';
    mouse = hover = ancora = area = arrasto = null;
    if (host) host.style.display = 'none';
    pedirDesenho();
  }

  window.__garimpoRegua = {
    ligar,
    desligar,
    alternar: () => { if (ativo) desligar(); else ligar(); return ativo; },
    ativa: () => ativo,
    limparGuias: () => { guias = []; pedirDesenho(); },
  };
})();
