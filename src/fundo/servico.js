// Clique no ícone abre o painel lateral. Nada roda nas páginas até o painel pedir.
// Também cuida do fim do simulador quando o painel está fechado (Esc na página, aba navegou/fechou).
import { fecharSimulador, removerRegras } from '../lib/simulacao.js';

function painelNoClique() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}
chrome.runtime.onInstalled.addListener(painelNoClique);
chrome.runtime.onStartup.addListener(painelNoClique);

chrome.runtime.onMessage.addListener((msg, remetente) => {
  if (msg.tipo === 'garimpo:sim-fechar' && remetente.tab?.id != null) fecharSimulador(remetente.tab.id);
});

// As regras do simulador valem por aba; somem quando a aba troca de página ou fecha.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) removerRegras(tabId).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => { removerRegras(tabId).catch(() => {}); });
