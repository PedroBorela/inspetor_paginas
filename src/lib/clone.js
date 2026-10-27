// Monta um ZIP navegável offline a partir do snapshot da página.
// Roda no painel (página da extensão), que pode buscar recursos de outras origens graças a host_permissions.

const LIMITE_ARQUIVO = 25 * 1024 * 1024;
const CONCORRENCIA = 6;

const RE_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
const RE_IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/g;

const EXT_POR_TIPO = {
  'text/css': 'css', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'font/woff2': 'woff2', 'font/woff': 'woff',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff': 'woff', 'application/font-woff2': 'woff2', 'video/mp4': 'mp4',
  'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'application/javascript': 'js', 'text/javascript': 'js', 'application/json': 'json',
};

function pastaPorExt(ext) {
  if (/^(woff2?|ttf|otf|eot)$/.test(ext)) return 'assets/fontes';
  if (/^(mp4|webm|mov|m4v|ogv|mp3|ogg|wav|m4a|vtt)$/.test(ext)) return 'assets/midia';
  if (ext === 'css') return 'css';
  if (/^m?js$/.test(ext)) return 'js';
  return 'assets/img';
}

function relativo(de, para) {
  // de/para são caminhos dentro do ZIP ("css/a.css", "assets/img/x.png").
  const a = de.split('/').slice(0, -1), b = para.split('/');
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  return '../'.repeat(a.length) + b.join('/');
}

function nomeBase(url) {
  try {
    const u = new URL(url);
    const nome = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'arquivo');
    return nome.replace(/[^\w.-]+/g, '-').slice(-60) || 'arquivo';
  } catch { return 'arquivo'; }
}

function separarHash(url) {
  const i = url.indexOf('#');
  return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i)];
}

export class Clonador {
  constructor({ scripts = false, midia = true, aoProgresso = () => {} } = {}) {
    this.opcoes = { scripts, midia };
    this.aoProgresso = aoProgresso;
    this.zip = new JSZip();
    this.caminhos = new Map(); // url -> Promise<caminho|null>
    this.usados = new Set(['index.html']);
    this.falhas = [];
    this.total = 0;
    this.feitos = 0;
    this.bytes = 0;
    this.fila = [];
    this.rodando = 0;
  }

  progresso(msg) {
    this.aoProgresso({ feitos: this.feitos, total: this.total, bytes: this.bytes, msg });
  }

  // Limita downloads simultâneos.
  agendar(tarefa) {
    return new Promise((ok, erro) => {
      this.fila.push({ tarefa, ok, erro });
      this.bombear();
    });
  }

  bombear() {
    while (this.rodando < CONCORRENCIA && this.fila.length) {
      const { tarefa, ok, erro } = this.fila.shift();
      this.rodando++;
      tarefa().then(ok, erro).finally(() => { this.rodando--; this.bombear(); });
    }
  }

  caminhoLivre(pasta, nome, ext) {
    let base = nome.replace(/\.[\w]{1,5}$/, '') || 'arquivo';
    let caminho = `${pasta}/${base}.${ext}`;
    for (let i = 2; this.usados.has(caminho); i++) caminho = `${pasta}/${base}-${i}.${ext}`;
    this.usados.add(caminho);
    return caminho;
  }

  async buscar(url) {
    const resp = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const tamanho = +resp.headers.get('content-length');
    if (tamanho > LIMITE_ARQUIVO) throw new Error(`maior que ${LIMITE_ARQUIVO / 1048576} MB`);
    const tipo = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return { resp, tipo };
  }

  // Baixa um recurso binário e devolve o caminho dentro do ZIP (ou null se falhar).
  recurso(url) {
    const [limpa] = separarHash(url);
    if (!/^https?:/.test(limpa)) return Promise.resolve(null);
    if (this.caminhos.has(limpa)) return this.caminhos.get(limpa);
    this.total++;
    const p = this.agendar(async () => {
      try {
        const { resp, tipo } = await this.buscar(limpa);
        if (tipo === 'text/css') return { css: await resp.text() };
        const blob = await resp.blob();
        if (blob.size > LIMITE_ARQUIVO) throw new Error('arquivo grande demais');
        const nome = nomeBase(limpa);
        const extUrl = (nome.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase();
        const ext = extUrl || EXT_POR_TIPO[tipo] || 'bin';
        if (!this.opcoes.midia && /^(mp4|webm|mov|m4v|ogv|mp3|ogg|wav|m4a)$/.test(ext)) throw new Error('mídia desativada nas opções');
        const caminho = this.caminhoLivre(pastaPorExt(ext), nome, ext);
        this.zip.file(caminho, blob);
        this.bytes += blob.size;
        return caminho;
      } catch (e) {
        this.falhas.push({ url: limpa, motivo: e.message || String(e) });
        return null;
      } finally {
        this.feitos++;
        this.progresso(nomeBase(limpa));
      }
    }).then(r => (r && typeof r === 'object' ? this.salvarCss(limpa, r.css) : r));
    this.caminhos.set(limpa, p);
    return p;
  }

  // Folha de estilo: segue @import e url(), grava em css/ e devolve o caminho.
  folha(url, textoReserva) {
    const [limpa] = separarHash(url);
    if (this.caminhos.has(limpa)) return this.caminhos.get(limpa);
    this.total++;
    const p = this.agendar(async () => {
      let texto = null;
      try {
        const { resp } = await this.buscar(limpa);
        texto = await resp.text();
      } catch (e) {
        if (textoReserva) texto = textoReserva;
        else this.falhas.push({ url: limpa, motivo: e.message || String(e) });
      } finally {
        this.feitos++;
        this.progresso(nomeBase(limpa));
      }
      return texto == null ? null : { texto };
    }).then(r => (r ? this.salvarCss(limpa, r.texto) : null));
    this.caminhos.set(limpa, p);
    return p;
  }

  async salvarCss(url, texto) {
    const caminho = this.caminhoLivre('css', nomeBase(url).replace(/\.css$/i, ''), 'css');
    const final = await this.reescreverCss(texto, url, caminho);
    this.zip.file(caminho, final);
    this.bytes += final.length;
    return caminho;
  }

  // Reescreve @import e url() de um texto CSS. `de` é o caminho do arquivo que contém o CSS.
  async reescreverCss(texto, base, de) {
    const trocas = []; // { ini, fim, promessa -> texto novo }
    const resolver = u => { try { return new URL(u, base).href; } catch { return null; } };
    for (const m of texto.matchAll(RE_IMPORT)) {
      const abs = resolver(m[2]);
      if (!abs) continue;
      trocas.push({ ini: m.index, fim: m.index + m[0].length, novo: this.folha(abs).then(c => `@import url("${c ? relativo(de, c) : abs}")${m[3]};`) });
    }
    for (const m of texto.matchAll(RE_URL)) {
      if (trocas.some(t => m.index >= t.ini && m.index < t.fim)) continue; // já coberto por um @import
      const bruto = m[2].trim();
      if (!bruto || /^(data:|#|about:|blob:)/i.test(bruto)) continue;
      const abs = resolver(bruto);
      if (!abs) continue;
      const [, hash] = separarHash(abs);
      trocas.push({ ini: m.index, fim: m.index + m[0].length, novo: this.recurso(abs).then(c => `url("${c ? relativo(de, c) + hash : abs}")`) });
    }
    trocas.sort((a, b) => a.ini - b.ini);
    const novos = await Promise.all(trocas.map(t => t.novo));
    let saida = '', pos = 0;
    trocas.forEach((t, i) => { saida += texto.slice(pos, t.ini) + novos[i]; pos = t.fim; });
    return saida + texto.slice(pos);
  }

  async clonar(snap) {
    const doc = new DOMParser().parseFromString(snap.html, 'text/html');
    const base = snap.base;
    const abs = u => { try { return new URL(u, base).href; } catch { return null; } };
    const tarefas = [];
    const html = 'index.html';

    // Folhas externas.
    for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      const url = abs(link.getAttribute('href'));
      if (!url) continue;
      link.removeAttribute('integrity');
      link.removeAttribute('crossorigin');
      tarefas.push(this.folha(url, snap.regrasPorHref?.[url]).then(c => { link.setAttribute('href', c || url); }));
    }
    // <style> inline.
    for (const st of doc.querySelectorAll('style')) {
      tarefas.push(this.reescreverCss(st.textContent, base, html).then(t => { st.textContent = t; }));
    }
    // style="" com url().
    for (const el of doc.querySelectorAll('[style*="url("]')) {
      tarefas.push(this.reescreverCss(el.getAttribute('style'), base, html).then(t => el.setAttribute('style', t)));
    }
    // Atributos que apontam para arquivos.
    const atributos = [
      ['img[src]', 'src'], ['input[type="image"][src]', 'src'], ['video[poster]', 'poster'], ['video[src]', 'src'], ['audio[src]', 'src'],
      ['video source[src]', 'src'], ['audio source[src]', 'src'], ['track[src]', 'src'],
      ['link[rel~="icon"][href]', 'href'], ['link[rel="apple-touch-icon"][href]', 'href'], ['link[rel="mask-icon"][href]', 'href'], ['link[rel="manifest"][href]', 'href'],
      ['image[href]', 'href'], ['use[href]', 'href'],
    ];
    if (this.opcoes.scripts) atributos.push(['script[src]', 'src']);
    for (const [sel, attr] of atributos) {
      for (const el of doc.querySelectorAll(sel)) {
        const valor = el.getAttribute(attr);
        if (!valor || valor.startsWith('#') || /^(data:|blob:|javascript:)/i.test(valor)) continue;
        const url = abs(valor);
        if (!url) continue;
        if (el.tagName === 'SCRIPT') { el.removeAttribute('integrity'); el.removeAttribute('crossorigin'); }
        const [, hash] = separarHash(url);
        tarefas.push(this.recurso(url).then(c => el.setAttribute(attr, c ? c + hash : url)));
      }
    }
    for (const el of doc.querySelectorAll('[*|href]:not([href])')) {
      const valor = el.getAttribute('xlink:href');
      if (!valor || valor.startsWith('#')) continue;
      const url = abs(valor);
      if (url) tarefas.push(this.recurso(url).then(c => el.setAttribute('xlink:href', c || url)));
    }
    // Links e formulários continuam apontando para o site original.
    for (const a of doc.querySelectorAll('a[href]')) {
      const v = a.getAttribute('href');
      if (v && !v.startsWith('#') && !/^(mailto:|tel:|javascript:)/i.test(v)) a.setAttribute('href', abs(v) || v);
    }
    for (const f of doc.querySelectorAll('form[action]')) f.setAttribute('action', abs(f.getAttribute('action')) || '');
    for (const f of doc.querySelectorAll('iframe[src]')) f.setAttribute('src', abs(f.getAttribute('src')) || '');

    await Promise.all(tarefas);
    // Espera downloads disparados por CSS aninhado (@import dentro de @import).
    let pendentes;
    do {
      pendentes = [...this.caminhos.values()];
      await Promise.all(pendentes);
    } while (pendentes.length !== this.caminhos.size);

    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'garimpo-origem');
    meta.setAttribute('content', snap.url);
    doc.head?.prepend(meta);
    if (!doc.querySelector('meta[charset]')) {
      const cs = doc.createElement('meta');
      cs.setAttribute('charset', 'utf-8');
      doc.head?.prepend(cs);
    }

    const doctype = snap.html.match(/^<!DOCTYPE[^>]*>/i)?.[0] || '<!DOCTYPE html>';
    this.zip.file(html, doctype + '\n' + doc.documentElement.outerHTML);
    this.zip.file('LEIA-ME.txt', this.relatorio(snap));
    return this.zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => this.aoProgresso({ feitos: this.feitos, total: this.total, bytes: this.bytes, msg: `compactando ${Math.round(m.percent)}%` }));
  }

  relatorio(snap) {
    const linhas = [
      `Clone de: ${snap.url}`,
      `Título: ${snap.titulo}`,
      `Data: ${new Date().toISOString()}`,
      `Arquivos baixados: ${this.feitos - this.falhas.length} de ${this.total}`,
      `Scripts: ${this.opcoes.scripts ? 'mantidos' : 'removidos (página estática)'}`,
      '',
      'Abra index.html no navegador. Links continuam apontando para o site original.',
      'Recursos que falharam ficaram com a URL original (precisam de internet).',
    ];
    if (this.falhas.length) {
      linhas.push('', 'Falhas:');
      for (const f of this.falhas) linhas.push(`- ${f.url} (${f.motivo})`);
    }
    return linhas.join('\n') + '\n';
  }
}
