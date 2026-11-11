// Onde está o NPDev. Lido em UM lugar só (o resto do app recebe a base por parâmetro).
//
// Web (D5): o jogo é servido pelo próprio NPDev (`:8200/jogo/`) e, em dev, o Vite repassa `/api` — mesma origem, base
// `/api`, sem CORS. App Capacitor: o WebView roda em `https://localhost`, onde `/api` apontaria para o próprio app;
// aí o build define `VITE_NPDEV_URL` (ex.: `VITE_NPDEV_URL=http://192.168.0.10:8200 npm run apk:debug`) e a base vira
// uma URL absoluta (a chamada passa a ser cross-origin: o CORS do NPDev precisa liberar `https://localhost` — N5).

/**
 * `VITE_NPDEV_URL` → base das rotas. Vazia/ausente = `/api`. Tolera barra no fim e o `/api` que alguém já tenha
 * colocado na variável (senão a rota viraria `/api/api/...`, um 404 difícil de enxergar).
 */
export function baseDaApi(urlServidor?: string | null): string {
  const url = (urlServidor ?? '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  return url === '' ? '/api' : `${url}/api`;
}

/** A base configurada neste build. */
export const BASE_API: string = baseDaApi(import.meta.env.VITE_NPDEV_URL);

/**
 * `VITE_PONTE_ALVO_URL` → endereço do WmsOffice do botão "Enviar ao WmsOffice". Ausente = `http://localhost:8100` (o
 * corporativo de desenvolvimento); vazia = o build não tem o botão (`null`). A ponte (backend/ponte) só executa alvos da
 * sua lista permitida (`PONTE_ALVOS_PERMITIDOS`), então este valor sozinho não escolhe para onde ela escreve.
 */
export function alvoDaPonte(url?: string | null): string | null {
  if (url === undefined || url === null) return 'http://localhost:8100';
  const limpo = url.trim().replace(/\/+$/, '');
  return limpo === '' ? null : limpo;
}

export const ALVO_PONTE: string | null = alvoDaPonte(import.meta.env.VITE_PONTE_ALVO_URL);
