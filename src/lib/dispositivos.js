// Aparelhos do simulador. Medidas em px CSS (viewport em retrato), dpr = densidade de pixels.

const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipados: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

export const GRUPOS = [
  {
    nome: 'Celulares',
    itens: [
      { id: 'iphone-se', nome: 'iPhone SE', w: 375, h: 667, dpr: 2, so: 'ios' },
      { id: 'iphone-15', nome: 'iPhone 15', w: 393, h: 852, dpr: 3, so: 'ios' },
      { id: 'iphone-16-pro', nome: 'iPhone 16 Pro', w: 402, h: 874, dpr: 3, so: 'ios' },
      { id: 'iphone-16-pro-max', nome: 'iPhone 16 Pro Max', w: 440, h: 956, dpr: 3, so: 'ios' },
      { id: 'pixel-8', nome: 'Pixel 8', w: 412, h: 915, dpr: 2.625, so: 'android' },
      { id: 'galaxy-s24', nome: 'Galaxy S24', w: 360, h: 780, dpr: 3, so: 'android' },
      { id: 'galaxy-a54', nome: 'Galaxy A54', w: 393, h: 851, dpr: 2.75, so: 'android' },
    ],
  },
  {
    nome: 'Tablets',
    itens: [
      { id: 'ipad-mini', nome: 'iPad Mini', w: 744, h: 1133, dpr: 2, so: 'ipados' },
      { id: 'ipad-air', nome: 'iPad Air', w: 820, h: 1180, dpr: 2, so: 'ipados' },
      { id: 'ipad-pro-13', nome: 'iPad Pro 13"', w: 1032, h: 1376, dpr: 2, so: 'ipados' },
      { id: 'galaxy-tab-s9', nome: 'Galaxy Tab S9', w: 800, h: 1280, dpr: 2, so: 'androidTablet' },
    ],
  },
  {
    nome: 'Computadores',
    itens: [
      { id: 'laptop-1280', nome: 'Laptop', w: 1280, h: 800, dpr: 2, so: 'desktop' },
      { id: 'laptop-1366', nome: 'Laptop HD', w: 1366, h: 768, dpr: 1, so: 'desktop' },
      { id: 'macbook-air', nome: 'MacBook Air', w: 1470, h: 956, dpr: 2, so: 'desktop' },
      { id: 'desktop-1080', nome: 'Full HD', w: 1920, h: 1080, dpr: 1, so: 'desktop' },
      { id: 'desktop-1440', nome: 'QHD', w: 2560, h: 1440, dpr: 1, so: 'desktop' },
    ],
  },
];

export const TODOS = GRUPOS.flatMap(g => g.itens.map(d => ({ ...d, grupo: g.nome })));

export function porId(id) {
  return TODOS.find(d => d.id === id) || null;
}

export function personalizado(w, h) {
  return { id: 'personalizado', nome: 'Personalizado', w, h, dpr: 1, so: w < 768 ? 'android' : 'desktop', grupo: 'Personalizado' };
}

export function userAgent(d) {
  return UA[d.so] || null;
}

export function ehMovel(d) {
  return d.so === 'ios' || d.so === 'android';
}

export function plataforma(d) {
  return { ios: '"iOS"', ipados: '"iOS"', android: '"Android"', androidTablet: '"Android"' }[d.so] || null;
}

// Moldura: celulares têm cantos bem arredondados; telas grandes, quase retos.
export function moldura(d) {
  if (d.grupo === 'Celulares') return { borda: 12, raio: 44 };
  if (d.grupo === 'Tablets') return { borda: 16, raio: 28 };
  if (d.grupo === 'Computadores') return { borda: 8, raio: 10 };
  return { borda: 6, raio: 8 };
}
