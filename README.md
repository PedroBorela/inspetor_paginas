# Garimpo

Extensão para Chrome (Manifest V3) que tira de qualquer página:

- **Clone**: a página como está renderizada agora, num ZIP que abre offline (HTML, CSS, fontes, imagens, vídeos).
- **Assets**: imagens, SVGs (inline e arquivos), ícones, vídeos, animações Lottie e favicons, com download avulso ou em ZIP.
- **Estilos**: paleta por uso (fundo, texto, borda, ícone, gradiente), variáveis CSS de cor, fontes com pesos, tamanhos e arquivos, raios, espaçamentos e sombras.
- **Design system**: papéis de cor (editáveis), escalas de 11 tons em OKLCH e exportação para **Tailwind v4**, **shadcn/ui**, **tokens DTCG** e **estudio.json** (controles do Estúdio de motion).
- **Inspetor**: escolha um elemento e veja layout, espaçamento, tipografia, fundo/borda, movimento, contraste WCAG e regras `:hover`/`:focus`/`:active`. Copie o CSS, o HTML com estilos computados ou um prompt para uma IA recriar o componente.
- **Telas** (simulador de dispositivos): abre a página num quadro do tamanho do aparelho, por cima do site. São 16 presets (iPhones, Pixel, Galaxy, iPads, laptops, Full HD, QHD) mais medida personalizada, com rotação e zoom. Media queries respondem à largura simulada, e o servidor recebe o User-Agent do aparelho.
- **Régua** (botão no topo do painel): réguas em px nas bordas, mira com coordenadas da página, área medida ao arrastar, distâncias entre um elemento fixado e o elemento sob o mouse, e guias puxadas da régua (arraste de volta ou dê dois cliques para remover). A última medida aparece no painel para copiar.

## Instalar

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta do repositório.
4. Fixe o ícone e clique nele em qualquer site: o painel lateral abre.

Não precisa de build: é JavaScript puro, sem dependências além do `lib/jszip.min.js` (MIT).

## Como funciona

| Parte | Arquivo | Onde roda |
|---|---|---|
| Painel lateral | `src/painel/*` | página da extensão |
| Coleta de estilos, assets e snapshot do DOM | `src/pagina/coletor.js` | injetado na aba sob demanda |
| Inspetor | `src/pagina/inspetor.js` | injetado na aba sob demanda |
| Régua | `src/pagina/regua.js` | injetado na aba sob demanda |
| Simulador (overlay) | `src/simulador/*` | página da extensão num iframe sobre o site |
| Aparelhos e abertura/fechamento do simulador | `src/lib/dispositivos.js`, `src/lib/simulacao.js` | painel, overlay e service worker |
| Montagem do clone | `src/lib/clone.js` | painel |
| Cores (OKLCH, contraste, escalas) | `src/lib/cor.js` | painel |
| Tokens e exportações | `src/lib/tokens.js` | painel |
| Service worker | `src/fundo/servico.js` | abre o painel e fecha o simulador quando a aba navega/fecha |

Nada roda nas páginas até você abrir o painel. Os scripts são injetados com `chrome.scripting` só na aba ativa.

**Clone**: o coletor copia o DOM atual (funciona com SPAs). Também grava regras de CSS-in-JS que só existem no CSSOM, converte Shadow DOM aberto em Declarative Shadow DOM, troca `<canvas>` por imagem, guarda valores de formulário, resolve imagens lazy (`data-src`) e remove scripts (opcional). O painel baixa cada folha de estilo (seguindo `@import`), cada `url()` (fontes, fundos) e cada `src`/`poster`/ícone. Depois reescreve as referências para caminhos relativos:

```
index.html
css/        folhas de estilo reescritas
assets/img/ imagens e SVGs
assets/fontes/
assets/midia/
LEIA-ME.txt origem, data e lista do que falhou
```

Links (`<a>`) e formulários continuam apontando para o site original.

**Simulador**: o overlay é uma página da extensão (não é afetada pelo CSP do site) que carrega a URL num `<iframe>` com `sandbox` sem `allow-top-navigation`, para scripts anti-iframe não sequestrarem a aba. Enquanto ele está aberto, regras de sessão do `declarativeNetRequest`, valendo **só para sub-frames daquela aba**, removem `X-Frame-Options` e `Content-Security-Policy` da resposta. Para celulares e tablets, também definem `User-Agent`, `Sec-CH-UA-Mobile` e `Sec-CH-UA-Platform`. As regras somem quando o simulador fecha, quando a aba navega ou quando ela é fechada.

## Privacidade

- Sem conta, sem servidor, sem analytics. Nada sai do seu navegador, a não ser os downloads dos próprios recursos da página que você está clonando ou inspecionando.
- `host_permissions: <all_urls>` existe para o painel conseguir baixar CSS, fontes e imagens de outros domínios (CDNs), que a página não deixa ler. Se preferir, em `chrome://extensions` mude o acesso a sites para "Ao clicar".
- `declarativeNetRequestWithHostAccess` serve só ao simulador, como descrito acima.

## Limitações conhecidas

- Páginas internas do navegador e a Chrome Web Store não podem ser lidas por extensões.
- Conteúdo dentro de iframes de outros domínios não entra no clone (o iframe continua apontando para a origem).
- Shadow DOM fechado não é acessível.
- Vídeos em streaming (`blob:`/HLS) não são baixáveis; arquivos acima de 25 MB são pulados.
- No inspetor, o `:hover` é desligado durante a leitura para mostrar o estado base. Regras de estado em folhas de outro domínio não aparecem na lista de estados.
- Pseudo-elementos (`::before`/`::after`) não entram no HTML exportado pelo inspetor.
- Simulador: o `navigator.userAgent` lido pelo JavaScript continua o do seu navegador (só o servidor recebe o UA do aparelho), não há emulação de toque nem de `devicePixelRatio`, e sites que exigem login com cookies `SameSite=Strict` podem não manter a sessão dentro do quadro.
- Régua: as medidas são em px CSS da página (sem zoom do navegador) e as guias ficam presas à página (rolam junto).

## Testar localmente

Os testes usam o Chromium do Playwright com a extensão carregada (headless novo, `channel: 'chromium'`). Eles abrem `src/painel/painel.html?tab=<id>`: o parâmetro `tab` fixa a aba-alvo, que normalmente é a aba ativa.
