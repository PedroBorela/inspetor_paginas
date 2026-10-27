// Overlay do simulador: página da extensão num iframe em tela cheia sobre o site.
import { GRUPOS, porId, personalizado, moldura } from '../lib/dispositivos.js';
import { aplicarRegras, fecharSimulador } from '../lib/simulacao.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const tabId = +params.get('tab');
const url = params.get('url');

const estado = {
  disp: porId(params.get('d')) || personalizado(+params.get('w') || 390, +params.get('h') || 844),
  w: +params.get('w') || 390,
  h: +params.get('h') || 844,
  girado: params.get('girado') === '1',
  zoom: params.get('zoom') || 'ajustar',
};

// ---------- controles ----------

function montarSelect() {
  const sel = $('#disp');
  for (const g of GRUPOS) {
    const og = document.createElement('optgroup');
    og.label = g.nome;
    for (const d of g.itens) og.append(new Option(`${d.nome} · ${d.w}×${d.h}`, d.id));
    sel.append(og);
  }
  sel.append(new Option('Personalizado', 'personalizado'));
}

function larguraAltura() {
  return estado.girado ? [estado.h, estado.w] : [estado.w, estado.h];
}

function escala(W, H) {
  if (estado.zoom !== 'ajustar') return +estado.zoom;
  const palco = $('#palco');
  const livreW = palco.clientWidth - 40, livreH = palco.clientHeight - 40;
  return Math.min(1, livreW / W, livreH / H);
}

function desenhar() {
  const [w, h] = larguraAltura();
  const { borda, raio } = moldura(estado.disp);
  const W = w + borda * 2, H = h + borda * 2;
  const s = escala(W, H);

  const tela = $('#tela');
  tela.style.width = `${w}px`;
  tela.style.height = `${h}px`;
  tela.style.borderRadius = `${Math.max(0, raio - borda)}px`;
  const aparelho = $('#aparelho');
  Object.assign(aparelho.style, { padding: `${borda}px`, borderRadius: `${raio}px`, transform: `scale(${s})` });
  Object.assign($('#envelope').style, { width: `${W * s}px`, height: `${H * s}px` });
  $('#palco').classList.toggle('ajustado', estado.zoom === 'ajustar');

  $('#disp').value = estado.disp.id;
  $('#w').value = w;
  $('#h').value = h;
  $('#zoom').value = estado.zoom;
  $('#info').textContent = `@${+estado.disp.dpr.toFixed(2)}x · ${Math.round(s * 100)}%`;
  document.title = `${estado.disp.nome} · ${w}×${h}`;
}

function avisarPainel() {
  const [w, h] = larguraAltura();
  chrome.runtime.sendMessage({ tipo: 'garimpo:sim-estado', tabId, id: estado.disp.id, w, h, girado: estado.girado }).catch(() => {});
}

// Troca de aparelho: muda o UA só quando o sistema muda, e aí recarrega o site.
async function escolher(disp, { girado = false } = {}) {
  const trocouSO = disp.so !== estado.disp.so;
  estado.disp = disp;
  estado.w = disp.w;
  estado.h = disp.h;
  estado.girado = girado;
  desenhar();
  if (trocouSO) {
    await aplicarRegras(tabId, disp);
    recarregar();
  }
  avisarPainel();
}

// Reatribuir o src (mesmo igual) navega o iframe de novo; o quadro é de outra origem, então não há reload() direto.
function recarregar() {
  $('#tela').src = url;
}

function medidaDigitada() {
  const w = Math.max(200, Math.min(3840, +$('#w').value || estado.w));
  const h = Math.max(200, Math.min(3840, +$('#h').value || estado.h));
  const disp = personalizado(w, h);
  disp.so = estado.disp.so;
  estado.disp = disp;
  estado.w = w;
  estado.h = h;
  estado.girado = false;
  desenhar();
  avisarPainel();
}

// ---------- eventos ----------

montarSelect();
$('#disp').addEventListener('change', e => {
  const d = porId(e.target.value);
  if (d) escolher(d);
  else { $('#w').focus(); medidaDigitada(); }
});
$('#w').addEventListener('change', medidaDigitada);
$('#h').addEventListener('change', medidaDigitada);
$('#girar').addEventListener('click', () => { estado.girado = !estado.girado; desenhar(); avisarPainel(); });
$('#zoom').addEventListener('change', e => { estado.zoom = e.target.value; desenhar(); });
$('#recarregar').addEventListener('click', recarregar);
$('#fechar').addEventListener('click', () => fecharSimulador(tabId));
addEventListener('resize', desenhar);
addEventListener('keydown', e => {
  if (e.target.matches('input, select')) return;
  if (e.key === 'Escape') fecharSimulador(tabId);
  if (e.key === 'r' || e.key === 'R') { estado.girado = !estado.girado; desenhar(); avisarPainel(); }
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.tipo !== 'garimpo:sim-dispositivo' || msg.tabId !== tabId) return;
  if (msg.id && msg.id !== 'personalizado') {
    const d = porId(msg.id);
    if (d) escolher(d, { girado: !!msg.girado });
  } else if (msg.w && msg.h) {
    $('#w').value = msg.w;
    $('#h').value = msg.h;
    medidaDigitada();
  }
  if (msg.girar) { estado.girado = !estado.girado; desenhar(); avisarPainel(); }
});

desenhar();
$('#tela').src = url;
avisarPainel();
