import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuração do Capacitor (F7) — empacota o build do Vite (`dist/`) num app Android.
 *
 * Offline-first (D1): o app NÃO usa `server.url`. Todo HTML/JS/CSS/dados do cenário vão dentro do APK e são
 * servidos pelo WebView em `https://localhost/` (origem fixa, ver `androidScheme`). A rede só é usada,
 * quando existir (F5), para falar com o NPDev por URL absoluta — ver docs/MOBILE.md.
 */

// Opcional, só para desenvolvimento: `CAP_HTTP_LAN=1 npm run cap:sync` libera, no WebView, chamadas http://
// a partir da página https://localhost (conteúdo misto) — necessário para testar contra um NPDev em http na
// rede local (ex.: http://192.168.0.10:8200). Fica DESLIGADO por padrão; não use em build de distribuição.
const permitirHttpLan = process.env.CAP_HTTP_LAN === '1';

const config: CapacitorConfig = {
  // Identificador do pacote Android. É permanente depois de publicado (Play Store / atualização de APK).
  // Troque ANTES do primeiro lançamento se houver um domínio próprio definitivo.
  appId: 'br.com.wmsoffice.thegame',
  appName: 'WmsOffice: The Game',
  webDir: 'dist',
  // Cor do WebView antes da página pintar (= --bg-dark de src/style.css): evita o "flash" branco após a splash.
  backgroundColor: '#0f141c',
  server: {
    // Sem `url` (nada de servidor remoto): o jogo funciona 100% offline com os assets empacotados.
    // `https` é o padrão do Capacitor 6 e é o que queremos: contexto seguro (IndexedDB/crypto para o cache
    // do cenário da F5) e chamadas https ao NPDev sem conteúdo misto. Origem do app: https://localhost
    // — é a que o CORS do NPDev (N5) precisa liberar.
    androidScheme: 'https'
  },
  android: {
    // `webContentsDebuggingEnabled` fica no padrão do Capacitor: ligado só em build debug (chrome://inspect).
    allowMixedContent: permitirHttpLan
  }
};

export default config;
