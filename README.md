# ToolBox Web

Caixa de ferramentas web para imagens: redimensionar e ampliar com IA, enquadrar, ajustar e exportar em lote. Roda 100% no navegador: nenhuma imagem é enviada para servidor.

## Abas

As configurações ficam em abas; todas se combinam num único processamento. Abas que estão alterando as imagens mostram um ponto indicador.

| Aba | O que tem |
|---|---|
| **Redimensionar** (base) | Ampliar com IA, Restaurar ou Só converter; tamanho final; tamanhos extras; manter tons originais |
| **Enquadrar** | Proporção, centralizar produto com margem, cor de fundo, fundo branco puro |
| **Ajustes** | Brilho, contraste, saturação, nitidez |
| **Marca d'água** | Logo, posição, opacidade, tamanho |
| **Exportar** | Formato, qualidade, tamanho máximo em KB, PNG com perda, padrão de nome |

## Funções em detalhe

- **Ampliar com IA**: Real-ESRGAN (realesr-general-x4v3) em TensorFlow.js, com WebGPU → WebGL → processador, autoteste do motor, checagem de cada bloco e recuperação automática se a placa de vídeo travar.
- **Restaurar**: limpa artefatos de compressão com IA e mantém o tamanho original.
- **Só converter**: redimensiona, enquadra, ajusta e compacta sem IA.
- **Tamanhos**: lado maior configurável e tamanhos extras gerados juntos (2048 a 400 px).
- **Enquadramento**: proporções Original, 1:1, 4:5, 3:4 e 16:9; centralizar produto com margem uniforme; cor de fundo.
- **Ajustes**: manter tons originais, fundo branco puro, brilho, contraste, saturação e nitidez.
- **Marca d'água**: logo com posição (9 pontos), opacidade e tamanho; fica salvo no navegador.
- **Exportação**: JPG (MozJPEG), PNG (OxiPNG, com opção de paleta de 256 cores), WebP e AVIF; qualidade; tamanho máximo em KB (busca automática de qualidade); padrão de nome `{nome}_{largura}`.
- **Lote**: relatório de tamanho antes/depois, download individual, `.zip` e “Salvar numa pasta” (Chrome/Edge).
- **Presets** prontos e personalizados; últimas configurações lembradas.
- Interface em português, espanhol e inglês; modo claro e escuro; PWA instalável e offline.
- Entrada: JPG, PNG, WebP, AVIF, GIF, BMP e TIFF.

## Comandos

```bash
npm install          # instala dependências e prepara os codecs (scripts/prepare-codecs.mjs)
npm run dev          # servidor local com recarga automática
npm run build        # dist/        → site estático (PWA) para hospedar
npm run build:single # dist-single/toolbox-web.html → um único arquivo com tudo embutido (~11 MB)
npm run build:all    # os dois acima
npm run preview      # serve o dist/ localmente para testar o build
npm run typecheck    # checagem de tipos
```

## Publicar

O site é publicado automaticamente no **GitHub Pages** (https://fabianokunst.github.io/image_size/) a cada push na branch `main`, pelo workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): instala as dependências, checa os tipos, gera `dist/` e publica.

Configuração única no GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Também dá para enviar o conteúdo de `dist/` para qualquer outra hospedagem estática (Hostinger, Netlify...). Use **HTTPS**: PWA, WebGPU e “Salvar numa pasta” exigem contexto seguro. Os codecs `.wasm` são baixados só quando o formato é usado e ficam em cache.

Para uso sem internet nem servidor, distribua `dist-single/toolbox-web.html`: abre com dois cliques.

## Estrutura

```
.github/workflows/      publicação automática no GitHub Pages
index.html              marcação da interface
public/                 manifesto do PWA e ícones (copiados como estão para dist/)
src/main.ts             controlador: estado, presets, fila, comparador, downloads
src/pipeline.ts         fluxo por imagem: recorte → IA → tons → ajustes → fundo → composição → marca → codificação
src/engine.ts           motor de IA (TensorFlow.js), escolha de backend, vigia e checagens
src/imageops.ts         operações de imagem em Canvas 2D (redimensionar, máscara de fundo, ajustes...)
src/codecs.ts           codificação; envia os .wasm compilados ao worker; reserva com codificadores nativos
src/codec.worker.ts     Web Worker com MozJPEG, libwebp, libavif, OxiPNG e UPNG
src/decode.ts           leitura de arquivos (TIFF via UTIF.js)
src/settings.ts         configurações, presets e persistência
src/i18n.ts             textos PT/ES/EN
src/model/              pesos da rede (float16, 2,4 MB)
src/sw-template.js      service worker (gerado com a lista de arquivos no build)
scripts/prepare-codecs.mjs  copia os carregadores dos codecs para src/vendor sem a busca automática do .wasm

gerados (fora do git):
src/vendor/             carregadores dos codecs, criados pelo npm install
dist/                   site estático pronto para hospedar
dist-single/            toolbox-web.html, versão de arquivo único
```

O worker é gerado no formato clássico (`iife`) porque o Chrome não executa workers do tipo módulo criados a partir de blob quando a página é aberta como arquivo (`file://`).

## Licenças dos componentes

Real-ESRGAN (BSD-3-Clause), TensorFlow.js (Apache-2.0), jSquash (Apache-2.0) com MozJPEG (BSD/IJG), libwebp (BSD), libavif/libaom (BSD) e OxiPNG (MIT), UPNG.js (MIT), UTIF.js (MIT), pako (MIT/Zlib), fflate (MIT).

## Próximos passos possíveis

- Remoção de fundo com IA (BiRefNet ou U²-Net, licenças permissivas) via ONNX Runtime Web, com o modelo baixado sob demanda.
- Abrir HEIC (libheif, LGPL).
- Modelo “Ilustração” (realesr-animevideov3), mais rápido para arte plana.
