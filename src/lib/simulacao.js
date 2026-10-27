// Abre/fecha o simulador de dispositivos numa aba. Usado pelo painel, pelo overlay e pelo service worker.
import { userAgent, plataforma, ehMovel } from './dispositivos.js';

const ID_OVERLAY = '__garimpo_simulador';

// Dois IDs de regra por aba: 1) libera o iframe; 2) cabeçalhos de celular.
// IDs de regra são int32; o módulo mantém tabId*2 abaixo de 2^31.
const idsDaAba = tabId => { const b = (tabId % 1_000_000_000) * 2; return [b + 1, b + 2]; };

// Valem só para sub_frames desta aba e só enquanto o simulador está aberto.
export async function aplicarRegras(tabId, dispositivo) {
  const [liberar, movel] = idsDaAba(tabId);
  const condicao = { tabIds: [tabId], resourceTypes: ['sub_frame'] };
  const addRules = [{
    id: liberar,
    priority: 1,
    condition: condicao,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
      ],
    },
  }];
  const ua = dispositivo && userAgent(dispositivo);
  if (ua) {
    const cabecalhos = [
      { header: 'user-agent', operation: 'set', value: ua },
      { header: 'sec-ch-ua-mobile', operation: 'set', value: ehMovel(dispositivo) ? '?1' : '?0' },
    ];
    const plat = plataforma(dispositivo);
    if (plat) cabecalhos.push({ header: 'sec-ch-ua-platform', operation: 'set', value: plat });
    addRules.push({ id: movel, priority: 1, condition: condicao, action: { type: 'modifyHeaders', requestHeaders: cabecalhos } });
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [liberar, movel], addRules });
}

export async function removerRegras(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: idsDaAba(tabId) });
}

export function urlDoOverlay(tabId, url, dispositivo, extra = {}) {
  const p = new URLSearchParams({ tab: String(tabId), url, d: dispositivo.id, w: String(dispositivo.w), h: String(dispositivo.h), ...extra });
  return chrome.runtime.getURL(`src/simulador/simulador.html?${p}`);
}

// Injeta (ou reaproveita) o iframe do overlay na página.
export async function abrirSimulador(tabId, urlPagina, dispositivo, extra) {
  await aplicarRegras(tabId, dispositivo);
  const src = urlDoOverlay(tabId, urlPagina, dispositivo, extra);
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [src, ID_OVERLAY],
    func: (src, id) => {
      let f = document.getElementById(id);
      if (f) return;
      f = document.createElement('iframe');
      f.id = id;
      f.setAttribute('data-garimpo', '');
      f.setAttribute('allow', 'clipboard-write; fullscreen');
      f.style.cssText = 'all:initial;position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;display:block;background:transparent;color-scheme:normal;';
      f.src = src;
      const raiz = document.documentElement;
      window.__garimpoSimOverflow = raiz.style.overflow;
      raiz.style.overflow = 'hidden';
      window.__garimpoSimEsc = e => {
        if (e.key === 'Escape') chrome.runtime.sendMessage({ tipo: 'garimpo:sim-fechar' });
      };
      addEventListener('keydown', window.__garimpoSimEsc, true);
      raiz.appendChild(f);
    },
  });
}

export async function fecharSimulador(tabId) {
  await removerRegras(tabId);
  // Avisa antes de remover: quem chama pode ser o próprio overlay, que morre junto com o iframe.
  chrome.runtime.sendMessage({ tipo: 'garimpo:sim-fechado', tabId }).catch(() => {});
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [ID_OVERLAY],
      func: id => {
        document.getElementById(id)?.remove();
        document.documentElement.style.overflow = window.__garimpoSimOverflow || '';
        if (window.__garimpoSimEsc) removeEventListener('keydown', window.__garimpoSimEsc, true);
        window.__garimpoSimEsc = null;
      },
    });
  } catch { /* aba fechada ou navegou */ }
}

export async function simuladorAberto(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, args: [ID_OVERLAY], func: id => !!document.getElementById(id) });
    return !!r?.result;
  } catch { return false; }
}
