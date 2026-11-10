# WmsOffice: The Game — App Android (Capacitor)

Fase **F7** do [`PLANO.md`](PLANO.md). O jogo (Vite/TS/canvas) é empacotado como app Android com **Capacitor 6**: o
`dist/` do Vite vai **dentro do APK** e roda num WebView, **100% offline** (D1: o motor da simulação é local). A rede só
entra na F5, para falar com o NPDev.

> Estado: APK **debug** gerado e inspecionado na máquina de desenvolvimento (Linux). **Não foi instalado nem
> executado em aparelho ou emulador** — ver [O que falta testar](#o-que-falta-testar-em-aparelho-real).

## O que está no repo

| Arquivo | Para quê |
| --- | --- |
| `capacitor.config.ts` | `appId`, `appName`, `webDir: dist`, esquema `https`, sem `server.url` |
| `android/` | Projeto Gradle gerado por `cap add android` + ajustes de jogo (fonte; sem build, sem `local.properties`) |
| `android/app/src/main/java/.../MainActivity.java` | Tela cheia imersiva, tela sempre ligada, conteúdo sob o recorte (notch) |
| `android/app/src/debug/AndroidManifest.xml` | `usesCleartextTraffic` **só no build debug** (ver [Rede](#rede-como-o-app-fala-com-o-npdev-f5)) |
| `android/app/src/main/res/` | Ícone (adaptativo em vetor + PNGs legados), splash |
| `resources/gerar-icones.py` | Regera os PNGs legados do ícone (mesmo desenho do favicon do `index.html`) |
| `package.json` | Dependências `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` (6.2.3, versão fixa) e os scripts abaixo |

### Decisões

- **Capacitor 6.2.3 (a última 6.x)**, não a 8.x (`latest`): o PLANO pede Capacitor 6 e esta máquina tem Node 18 e JDK 17,
  que é exatamente o requisito do 6 (Gradle 8.2.1, AGP 8.2.1, `compileSdk`/`targetSdk` 34, `minSdk` 22 = Android 5.1).
  Capacitor 7+ exige Node 20+/JDK 21. Subir de versão é uma decisão à parte (`npx cap migrate`). Nota: o 6.x não é
  mais a linha corrente (a `latest` do npm é a 8.x); para publicar na Play Store, o `targetSdk` mínimo exigido sobe todo
  ano — conferir antes e migrar se o 34 não bastar.
- **`appId = br.com.wmsoffice.thegame`**: domínio reverso do nome do produto ("WmsOffice") + `thegame`, sem inventar marca
  nova. É o identificador permanente do app (atualização por cima de APK instalado, Play Store): **se houver um domínio
  definitivo, troque antes do primeiro lançamento**: `appId` em `capacitor.config.ts`, `namespace`/`applicationId` em
  `android/app/build.gradle`, o `package` e a pasta de `MainActivity.java` e os valores `package_name`/`custom_url_scheme`
  de `android/app/src/main/res/values/strings.xml`.
- **`androidScheme: 'https'`**: o app é servido em `https://localhost/`. Dá contexto seguro (IndexedDB/crypto para o cache
  do cenário da F5), evita conteúdo misto ao falar com um NPDev em https e fixa a origem (`https://localhost`) que o CORS
  do NPDev (N5) precisa liberar.
- **Orientação livre (`screenOrientation="user"`)**: o mapa é largo e **paisagem** é melhor para jogar, mas não há motivo
  técnico para travar — o cenário `WH-A` cabe bem em retrato com zoom, a `Activity` não é recriada ao girar
  (`configChanges`) e a partida em JS sobrevive à rotação. `user` respeita a trava de rotação do aparelho. Se o HUD
  novo só funcionar bem em paisagem, travar é uma linha (`userLandscape`).
- **Tela cheia imersiva**: barras do sistema escondidas (reaparecem com deslize na borda), `layoutInDisplayCutoutMode =
  shortEdges` (o canvas ocupa a tela toda, inclusive sob o notch) e `FLAG_KEEP_SCREEN_ON` (o turno dura ~20 min reais e há
  poucos toques durante a simulação). Como o conteúdo vai sob o notch, o HUD precisa respeitar `env(safe-area-inset-*)`.
- **Ícone e splash**: o mesmo desenho do favicon do `index.html` (duas "prateleiras" azul e âmbar sobre fundo escuro) — nada
  de marca nova. Ícone adaptativo em vetor (Android 8+) + PNGs `mipmap-*` (Android 5.1–7.1). Splash = fundo `#0f141c`
  (o `--bg-dark` da página) + a marca centralizada; o `backgroundColor` do WebView é a mesma cor (sem "piscada" branca).
  Os PNGs da splash do template (logo do Capacitor) foram removidos.

## Pré-requisitos

| Ferramenta | Versão | Nesta máquina |
| --- | --- | --- |
| Node / npm | 18+ | 18.19.1 / 9.2.0 |
| JDK | **17** (o Gradle 8.2.1 + AGP 8.2.1 do Capacitor 6 aceitam 17; 21 só a partir do Capacitor 7) | Temurin 17.0.21 em `~/.local/bin/java` |
| Android SDK | `platform-tools`, `platforms;android-34`, `build-tools;34.0.0` | instalado em `~/Android/Sdk` (abaixo) |
| Gradle | 8.2.1 — **pelo wrapper** do projeto (`android/gradlew`), baixado na primeira execução (~150 MB em `~/.gradle`) | — |
| Rede | só na primeira vez (SDK, Gradle e dependências Maven do Google) | — |

### Instalar o Android SDK sem Android Studio nem sudo (Linux)

Foi exatamente o que se fez aqui (cmdline-tools `15859902`; a página <https://developer.android.com/studio#command-tools>
publica o SHA-256):

```sh
mkdir -p ~/Android/Sdk/cmdline-tools && cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
sha256sum commandlinetools-linux-15859902_latest.zip      # 4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
unzip -q commandlinetools-linux-15859902_latest.zip -d /tmp/clt
mv /tmp/clt/cmdline-tools ~/Android/Sdk/cmdline-tools/latest

export ANDROID_HOME=$HOME/Android/Sdk
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

O Gradle precisa achar o SDK: ou `export ANDROID_HOME=$HOME/Android/Sdk` na sessão, ou um `android/local.properties` com
`sdk.dir=/home/<voce>/Android/Sdk` (arquivo **local, fora do git**).

## Build

```sh
npm ci
export ANDROID_HOME=$HOME/Android/Sdk      # ou android/local.properties
npm run apk:debug                          # tsc + vite build → cap sync android → gradlew assembleDebug
```

Saída: `android/app/build/outputs/apk/debug/app-debug.apk` (assinado com a chave **debug** automática do Android
— serve para instalar via `adb`, não para publicar). **O APK nunca é versionado** (`*.apk` está no `.gitignore`).

| Script | O que faz |
| --- | --- |
| `npm run cap:sync` | `npm run build` + `cap sync android` (copia `dist/` para `android/app/src/main/assets/public/` e atualiza o `capacitor.config.json` gerado) |
| `npm run apk:debug` | `cap:sync` + `./gradlew assembleDebug` |
| `npm run apk:instalar` | `adb install -r` do APK debug (aparelho com depuração USB) |
| `npm run cap:abrir` | abre o projeto no Android Studio (opcional) |

> O `apk:debug` usa `./gradlew` (Linux/macOS/Git Bash). No `cmd` do Windows rode `cd android && gradlew assembleDebug`.
> Depois de qualquer mudança em `src/`, rode `cap:sync` de novo: o APK leva a **cópia** do `dist/`.

Medido em 2026-11-10 (Linux, JDK 17, SDK 34): `BUILD SUCCESSFUL`; `app-debug.apk` com **3.594.800 bytes (~3,4 MiB)**.
A primeira execução baixa o Gradle e as dependências (levou ~6 min só para chegar ao primeiro erro de recurso, ~9 min no
build completo com a máquina ocupada); as seguintes usam o cache do `~/.gradle` e ficam em poucos minutos.

### Conferir o APK sem aparelho

```sh
BT=$ANDROID_HOME/build-tools/34.0.0
APK=android/app/build/outputs/apk/debug/app-debug.apk
$BT/aapt dump badging $APK | head -12      # package, versionName, sdkVersion:'22', targetSdkVersion:'34', launchable-activity
$BT/aapt dump permissions $APK             # só INTERNET
$BT/apksigner verify --print-certs $APK    # assinatura debug
unzip -l $APK | grep -E "assets/(public|capacitor)"   # index.html, assets/*.js|css, capacitor.config.json
```

O que essa conferência mostrou no APK gerado: pacote `br.com.wmsoffice.thegame` (versionCode 1 / versionName 1.0),
`sdkVersion 22`, `targetSdkVersion 34`, rótulo "WmsOffice: The Game", atividade `MainActivity`, ícone adaptativo
(`mipmap-anydpi-v26`) mais PNGs `mipmap-*`, permissão apenas `INTERNET`, assinatura `CN=Android Debug`, `screenOrientation=user`,
`usesCleartextTraffic=true` (debug) e `assets/public/` com `index.html`, o CSS e os três JS (`index`, `WH-A-PEQUENO`, `WH-B-MEGA`),
idênticos ao `dist/`. O manifesto mesclado do **release** (`:app:processReleaseManifest`) **não** tem `usesCleartextTraffic`.

## Instalar e depurar no aparelho

1. No Android: Configurações → Sobre o telefone → toque 7× em "Número da versão" → Opções do desenvolvedor → **Depuração
   USB** (ou "Depuração sem fio").
2. `adb devices` (deve listar o aparelho autorizado) e `npm run apk:instalar`
   (ou `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`).
3. Abra "WmsOffice: The Game". Depuração do WebView: `chrome://inspect` no Chrome do desktop (ligada só no build debug).
4. Logs nativos: `adb logcat | grep -iE "Capacitor|chromium|wmsoffice"`.
5. Sem aparelho: o APK também pode ser arrastado para um emulador do Android Studio (AVD, API 22+).

## Rede: como o app fala com o NPDev (F5)

O app **não precisa de rede para jogar**: nenhum `server.url`, nenhuma chamada hoje (`src/` não usa `fetch`). Quando a F5
existir, o `NPDevClient` roda dentro do WebView em `https://localhost`, onde um `/api` relativo apontaria para o
**próprio app**, não para o servidor. Por isso, no APK a base do `NPDevClient` tem de ser uma **URL absoluta**.

Proposta (apenas documentada — `src/**` não foi tocado nesta fase):

- Variável de build do Vite **`VITE_NPDEV_URL`**, lida em um único lugar (`import.meta.env.VITE_NPDEV_URL`):
  - vazia/ausente (dev com proxy `/api → :8200`, e o jogo servido em `:8200/jogo/` — D5): base `''`, chamadas em `/api/...`;
  - no APK: `VITE_NPDEV_URL=https://npdev.exemplo.com.br npm run apk:debug` (o Vite embute o valor no bundle em tempo de
    build; vale para o `tsc`/`vite build` que o `cap:sync` dispara).
- Como a URL fica fixa no APK, vale também **permitir trocá-la em tempo de execução** (tela de configuração do servidor, valor
  em `localStorage`/`@capacitor/preferences`), com a variável de build como valor padrão. Evita gerar um APK por servidor/IP.
- Declarar o tipo em `src/vite-env.d.ts` (`interface ImportMetaEnv { readonly VITE_NPDEV_URL?: string }`).
- Modo convidado = offline continua sendo o padrão (F5): sem URL configurada, o app nem tenta a rede.

### O que o NPDev precisa para aceitar o app (N5)

- **CORS** liberando a origem **`https://localhost`** (a do app), métodos `GET/POST/PUT/DELETE/OPTIONS` e os cabeçalhos
  `Authorization` e `Content-Type` (a chamada do APK é cross-origin e leva `Authorization: Bearer`, logo há preflight).
  Em dev no navegador não há CORS (proxy do Vite); no APK há.
- **https em produção.** O Android 9+ bloqueia tráfego http (cleartext) por padrão, e o WebView bloqueia http a partir de
  página https (conteúdo misto). O build **release** mantém os dois bloqueios.

### Testar contra um NPDev em http na rede local (só desenvolvimento)

O NPDev dev roda em `http://<ip>:8200`. Para um APK **debug** falar com ele:

```sh
CAP_HTTP_LAN=1 VITE_NPDEV_URL=http://192.168.0.10:8200 npm run apk:debug
```

- `android/app/src/debug/AndroidManifest.xml` já liga `usesCleartextTraffic="true"` — **só no build debug** (o `src/debug` não
  entra no release).
- `CAP_HTTP_LAN=1` (lido em `capacitor.config.ts`) liga `android.allowMixedContent`, para o WebView aceitar http a partir
  da página https. Fica **desligado** por padrão.
- O CORS do NPDev ainda precisa liberar `https://localhost`.
- Alternativa sem CORS/conteúdo misto: o plugin nativo `CapacitorHttp` (`plugins: { CapacitorHttp: { enabled: true } }`) faz
  `fetch`/XHR pelo cliente HTTP do Android; ainda depende do cleartext liberado. Não ligado — decidir na F5.

**Risco:** com cleartext liberado, login/JWT e dados da partida trafegam **em texto puro**; qualquer um na mesma rede pode
ler ou alterar. Aceitável apenas em rede de desenvolvimento confiável; nunca em build de distribuição. Cleartext só para
hosts específicos (em vez de todos) exigiria um `network_security_config` por domínio — não dá para escrever "rede
local" como faixa de IP nesse arquivo; só nomes de host/IPs exatos.

## Teste offline do pacote web (feito)

Sem aparelho, o que vai dentro do APK foi validado emulando o que o Capacitor faz: o conteúdo de
`android/app/src/main/assets/public/` é servido em `https://localhost/` num Chrome headless (Chrome 156, via Puppeteer) com
**toda requisição para fora bloqueada**. Resultado:

- `window.isSecureContext = true`; `index.html`, JS, CSS e o chunk `WH-B-MEGA` (carregado sob demanda) são servidos do
  pacote; **nenhuma chamada `/api`**; nenhum erro de JavaScript (`pageerror`) em retrato (390×844) e paisagem (800×360).
- A simulação anda sozinha: relógio 08:00 → 08:16 em ~10 s (4 s em 1x + 5 s em 5x), ordens liberadas/concluídas e distância
  sobem, score calculado; troca para `WH-B-MEGA` offline funciona.
- **Fontes: resolvido.** Na época a única requisição bloqueada eram as fontes do Google (`<link>` no `index.html`: 1 erro no
  console e queda para `system-ui`). Agora *Plus Jakarta Sans* e *JetBrains Mono* (SIL OFL 1.1) são arquivos do próprio
  pacote — ver [Fontes locais](#fontes-locais) — e o jogo não pede nada externo (conferido com interceptação de requests).
- O mesmo teste achou o problema de layout em paisagem de celular (ver [Layout de toque](#layout-de-toque)).

Não coberto por esse teste: o WebView real do Android (Chromium do sistema, pode ser mais antigo), desempenho, toque,
ciclo de vida do app.

## Layout de toque

Feito na F7 (HTML/CSS em `index.html`, `src/style.css`, `src/ui/mobile.css`; comportamento em `src/ui/drawer.ts` e
`src/ui/hud.ts`). O achado antigo — paisagem 800×360 com o mapa espremido e o HUD comendo ~40% da tela em retrato — está
resolvido: o mapa ocupa 70–75% da altura em paisagem e ~80% em retrato, com a gaveta aberta ou fechada.

Duas consultas de mídia, de propósito: **layout compacto** = `(max-width: 900px), (max-height: 500px)` (muda a
disposição) e **tamanho de toque** = compacto **ou** `(pointer: coarse)` (só sobe os alvos para 44 px: um tablet em
paisagem mantém o layout de desktop, mas com botões que o dedo acerta).

- **Meta viewport e safe-area**: `viewport-fit=cover`; `#app` tem `padding` com `env(safe-area-inset-top/right/left)`, a
  gaveta e os modais respeitam também o inset de baixo. `100dvh` já estava no `#app` (com `100vh` de reserva).
- **HUD compacto**: uma linha de controles (pausa/1x/2x/5x, "?" do tutorial, "mais indicadores") e uma de indicadores
  essenciais (relógio, ordens, atrasadas, score). Distância, conflitos e ocupação ficam num painel que o botão (chevron) abre
  *por cima* do mapa — o mapa não muda de altura; tocar fora ou Esc fecha. Em paisagem baixa tudo cabe numa linha só e o
  título do jogo some. A faixa de estado (cenário, política ativa, situação do turno) segue visível; em retrato a política
  ocupa a linha inteira.
- **Gaveta como bottom sheet**: `position: absolute` sobre o mapa, **fechada por padrão** no layout compacto, onde vira uma
  pílula centralizada embaixo ("Configurações"); aberta, ocupa até ~62% da altura (em paisagem baixa, até logo abaixo do HUD) e
  rola por dentro. A alça aceita **toque** (alterna) e **arrasto** (para cima abre, para baixo recolhe; a folha acompanha o
  dedo) — regra pura em `src/app/gaveta.ts`, com teste. Esc recolhe e devolve o foco à alça. Em paisagem larga as três
  colunas do desktop voltam; em retrato ficam empilhadas.
- **Inspector**: de cartão de 260 px no canto vira uma faixa no topo do mapa (propriedades em linha; em ≥ 600 px o título e
  as propriedades dividem a mesma linha), deixando livre a coluna de zoom/heatmap.
- **Alvos ≥ 44 px**: controles de velocidade, "?", botões flutuantes, fechar do inspector, alça da gaveta, chip da política,
  seletor e botões dos modais. Conferido por script: nenhum botão/seletor/rótulo de rádio visível com menos de 44 px nos
  quatro viewports.
- **Toque**: `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none` e `touch-action: manipulation` nos
  controles (some o atraso do toque duplo). O `touch-action` do canvas e os gestos de pan/pinça são do módulo de entrada do
  mapa (`src/render/input.ts`), não deste layout.
- **Modais** (pré-partida e resultado): cabeçalho enxuto em paisagem baixa, duas colunas a partir de 640 px, rodapé de
  botões de 44 px, `padding` respeitando a safe-area.

### Fontes locais

`public/fonts/` guarda um arquivo **variável** por família (todos os pesos num woff2), só o subset *latin* (cobre o
português; o que ficar de fora cai na pilha do sistema): `PlusJakartaSans-latin-var.woff2` (27 KB) e
`JetBrainsMono-latin-var.woff2` (31 KB), mais os textos da licença (**SIL OFL 1.1**, que permite redistribuir junto do app
desde que a licença e o copyright acompanhem). Os `@font-face` (`font-display: swap`) estão em `src/ui/fontes.css`; o
Vite acrescenta o `base` do build (`/jogo/` no NPDev), então o mesmo CSS serve ao dev server, ao NPDev e ao APK. Foi
escolhido baixar as fontes (e não trocar por fontes do sistema) para manter o visual atual idêntico entre dev, web e APK.

### Verificação

Chrome headless (Puppeteer fora do repo) em 1280×800, 390×844, 844×390 e 800×360, com interceptação de requests: pré-partida,
WH-A e WH-B em jogo, inspector, gaveta aberta e fechada, painel de indicadores, resultado e tutorial — sem transbordo
horizontal, sem erro de console e sem requisição externa; toque e arrasto da gaveta com eventos de toque emulados.

### O que ainda falta neste tema

- **Pinça e 2º dedo** no mapa (`src/render/input.ts` só trata um ponteiro): é do trabalho de gestos/zoom da F6.
- **Girar a tela**: o canvas é redimensionado (`ResizeObserver`) e o centro do mapa se mantém, mas não há re-enquadramento
  automático — "Centralizar" (🎯) resolve; decidir se vale enquadrar sozinho.
- O canvas não usa `devicePixelRatio` (mapa borrado em telas de alta densidade) — também da F6/render.
- Conferir em aparelho real: altura útil com a barra do Chrome/WebView, notch, teclado do `<select>` nativo e o toque na
  alça (a lista "O que falta testar em aparelho real" abaixo continua valendo).

## Limitações conhecidas

- **Segundo plano**: o loop é `requestAnimationFrame`; o WebView pausa em segundo plano (o jogo congela e retoma — não
  corre "no escuro"). `Relogio` limita a 600 ticks por frame depois de uma pausa longa. Definir se o app deve pausar
  explicitamente a partida ao perder o foco (evento `visibilitychange`/`appStateChange`).
- **Persistência (F5)**: IndexedDB do WebView some se o usuário limpar os dados do app (e `allowBackup="true"` do template
  pode restaurá-los num aparelho novo). Cenário em cache + fila de envio de partidas offline ainda não existem.
- **Botão voltar** do Android: comportamento padrão do Capacitor (fecha o app na raiz). Definir se deve fechar o drawer/inspector
  primeiro.
- **Release**: não há build release/AAB, assinatura própria (keystore), nem minificação. Só debug foi gerado.
- **Sem iOS** (fora do escopo).

## O que falta testar em aparelho real

Nada disso foi executado — só o empacotamento e o pacote web foram verificados:

- [ ] Instalação (`adb install`) e abertura sem crash; splash e ícone (adaptativo e redondo) corretos.
- [ ] Jogo roda **em modo avião** (primeiro uso já sem rede), nos dois cenários; o chunk `WH-B-MEGA` abre.
- [ ] Imersivo: barras escondidas, deslize na borda mostra e esconde de novo; notch/recorte; tela não apaga durante a partida.
- [ ] Rotação retrato ↔ paisagem sem perder a partida; trava de rotação do sistema.
- [ ] Toque: arrastar, tocar num vão (inspector), botões, selects (o `<select>` nativo do Android), drawer.
- [ ] FPS em `WH-B-MEGA` em aparelho médio (F6).
- [ ] Voltar do segundo plano / tela bloqueada.
- [ ] Contra um NPDev real (F5): CORS de `https://localhost`, https, e o fluxo http de LAN descrito acima.
