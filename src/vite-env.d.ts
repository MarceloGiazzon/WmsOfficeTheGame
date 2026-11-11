/// <reference types="vite/client" />

// Variáveis de ambiente do build (prefixo VITE_). Só a URL do NPDev é configurável; ver src/app/configRede.ts.
interface ImportMetaEnv {
  /** URL absoluta do NPDev (ex.: `http://192.168.0.10:8200`), para o app Capacitor. Vazia = mesma origem (`/api`). */
  readonly VITE_NPDEV_URL?: string;
  /** WmsOffice de destino do botão "Enviar ao WmsOffice" (ponte Jogo ↔ WmsOffice). Padrão `http://localhost:8100`; vazia = sem botão. */
  readonly VITE_PONTE_ALVO_URL?: string;
}
