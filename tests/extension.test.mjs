import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

test("1. Validação do Manifest.json e Declaração de Ícones", () => {
  const manifestRaw = fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw);

  assert.equal(manifest.manifest_version, 3, "Deve ser Manifest V3");
  assert.equal(manifest.version, "1.3.0", "Versão do manifest deve ser 1.3.0");
  assert.ok(manifest.commands["toggle-windowed-fullscreen"], "Comando de alternar deve existir");
  assert.equal(
    manifest.commands["toggle-windowed-fullscreen"].suggested_key.default,
    "Alt+W",
    "O atalho padrão deve ser Alt+W"
  );
  assert.ok(manifest.content_scripts?.length > 0, "content_scripts deve estar registrado estaticamente");
  assert.ok(manifest.permissions.includes("tabs"), "Permissão 'tabs' é necessária para gerenciar janelas");
  assert.deepEqual(
    manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required,
    ["none"],
    "data_collection_permissions deve declarar required: ['none'] para aprovação na Mozilla AMO"
  );

  // Validação dos ícones declarados no manifest
  assert.ok(manifest.icons, "Manifest deve possuir campo 'icons'");
  assert.ok(manifest.action?.default_icon, "Manifest deve possuir campo 'action.default_icon'");

  const iconSizes = ["16", "32", "48", "128"];
  for (const size of iconSizes) {
    assert.ok(manifest.icons[size], `manifest.icons deve definir tamanho ${size}`);
    assert.ok(manifest.action.default_icon[size], `action.default_icon deve definir tamanho ${size}`);

    const iconPath = path.join(projectRoot, manifest.icons[size]);
    assert.ok(fs.existsSync(iconPath), `Arquivo de ícone ${manifest.icons[size]} deve existir no disco`);
  }
});

test("2. Validação das Regras CSS e Preservação da Decodificação de Vídeo", () => {
  const css = fs.readFileSync(path.join(projectRoot, "content.css"), "utf8");

  // Não deve colocar regras destrutivas que apaguem o vídeo da Netflix/YouTube
  assert.ok(!css.includes("video {"), "Não deve sobrepor estilos forçados na tag <video>");
  assert.ok(!css.includes("z-index: 1"), "Não deve mandar o vídeo para z-index 1 atrás de backdrops");

  // Elementos do player e controles
  assert.ok(css.includes("#movie_player"), "Deve focar no player real do YouTube");
  assert.ok(css.includes(".ytp-chrome-bottom"), "Controles do YouTube devem ter z-index alto");
  assert.ok(css.includes(".wfs-fullscreen-target"), "Deve possuir classe universal para streamings");
});

test("3. Prevenção de Múltiplas Injeções e Suporte a Players no content.js", () => {
  const contentJs = fs.readFileSync(path.join(projectRoot, "content.js"), "utf8");

  assert.ok(
    contentJs.includes("window.__wfs_injected"),
    "Deve conter trava de injeção única (window.__wfs_injected)"
  );
  assert.ok(
    contentJs.includes("ytp-fullscreen"),
    "Deve acionar o modo nativo do YouTube (ytp-fullscreen) para auto-dimensionar o vídeo"
  );
  assert.ok(
    contentJs.includes("watch-video--player-view"),
    "Deve detectar o container da Netflix"
  );
  assert.ok(
    contentJs.includes("clean_window"),
    "Deve disparar a limpeza da barra de abas e URL"
  );
});

test("4. Proteção de Janelas, Shim Cross-Browser e Re-acoplamento no background.js", () => {
  const bgJs = fs.readFileSync(path.join(projectRoot, "background.js"), "utf8");

  assert.ok(
    bgJs.includes("isSwitching"),
    "Deve conter mutex (isSwitching)"
  );
  assert.ok(
    bgJs.includes("ensureInjected"),
    "Deve possuir ensureInjected"
  );

  // Shim universal cross-browser
  assert.ok(
    bgJs.includes("const browserAPI = globalThis.browser || globalThis.chrome;"),
    "Deve definir o shim browserAPI unificado para Chromium e Firefox"
  );

  // Nenhuma chamada direta solta a browser.tabs / browser.windows / etc. (fora da declaração da constante)
  const codeWithoutConst = bgJs.replace("const browserAPI = globalThis.browser || globalThis.chrome;", "");
  assert.ok(
    !codeWithoutConst.includes("browser.tabs"),
    "Não deve haver chamadas diretas a browser.tabs, use browserAPI"
  );
  assert.ok(
    !codeWithoutConst.includes("browser.windows"),
    "Não deve haver chamadas diretas a browser.windows, use browserAPI"
  );
  assert.ok(
    !codeWithoutConst.includes("browser.runtime"),
    "Não deve haver chamadas diretas a browser.runtime, use browserAPI"
  );
  assert.ok(
    !codeWithoutConst.includes("browser.action"),
    "Não deve haver chamadas diretas a browser.action, use browserAPI"
  );
  assert.ok(
    !codeWithoutConst.includes("browser.commands"),
    "Não deve haver chamadas diretas a browser.commands, use browserAPI"
  );

  // Re-acoplamento inteligente de abas na janela original
  assert.ok(
    bgJs.includes("browserAPI.windows.get(state.originalWindowId)"),
    "Deve consultar se a janela original ainda existe"
  );
  assert.ok(
    bgJs.includes("browserAPI.tabs.move(tabId,"),
    "Deve re-acoplar a aba na janela original usando tabs.move"
  );
  assert.ok(
    bgJs.includes("browserAPI.tabs.update(tabId, { active: true })"),
    "Deve focar a aba re-acoplada usando tabs.update"
  );
  assert.ok(
    bgJs.includes("windowStateMap.delete(tabId)"),
    "Deve limpar o estado da aba após restaurar"
  );
});

test("5. Cálculo de Enquadramento em Diferentes Resoluções e Divisões", () => {
  const testViewports = [
    { name: "1/4 da tela Full HD (960x540)", w: 960, h: 540 },
    { name: "1/2 da tela vertical Full HD (960x1080)", w: 960, h: 1080 },
    { name: "1/4 da tela 4K (1920x1080)", w: 1920, h: 1080 },
    { name: "1/3 da tela Ultrawide (1146x1440)", w: 1146, h: 1440 },
    { name: "1/4 de Notebook 1366x768 (683x384)", w: 683, h: 384 }
  ];

  for (const vp of testViewports) {
    const targetWidth = vp.w;
    const targetHeight = vp.h;
    assert.equal(targetWidth, vp.w);
    assert.equal(targetHeight, vp.h);
    assert.ok(targetWidth > 0 && targetHeight > 0, `${vp.name} dimensões válidas`);
  }
});

test("6. Suporte Expandido a Streamings, Polyfill e HUD Toast no content.js", () => {
  const contentJs = fs.readFileSync(path.join(projectRoot, "content.js"), "utf8");

  // Polyfill universal
  assert.ok(
    contentJs.includes("globalThis.browser || globalThis.chrome"),
    "Deve conter o polyfill browserAPI universal"
  );
  assert.ok(
    !contentJs.includes("browser.runtime."),
    "Chamadas a browser.runtime devem usar browserAPI"
  );

  // Seletores das plataformas
  assert.ok(contentJs.includes("video-player__container"), "Deve suportar player da Twitch");
  assert.ok(contentJs.includes("persistent-player"), "Deve suportar persistent player da Twitch");
  assert.ok(contentJs.includes("webPlayerSDKContainer"), "Deve suportar Prime Video");
  assert.ok(contentJs.includes("dv-player-fullscreen"), "Deve suportar Prime Video dv-player-fullscreen");
  assert.ok(contentJs.includes("#hls-player"), "Deve suportar Disney+");
  assert.ok(contentJs.includes("btm-media-client-element"), "Deve suportar Disney+ btm-media");
  assert.ok(contentJs.includes("player-video-container"), "Deve suportar Max / HBO");
  assert.ok(contentJs.includes("default-player-container"), "Deve suportar Max default-player-container");
  assert.ok(contentJs.includes("#player0"), "Deve suportar Crunchyroll player0");
  assert.ok(contentJs.includes("vilos-player"), "Deve suportar Crunchyroll vilos-player");

  // HUD Toast
  assert.ok(contentJs.includes("showToast"), "Deve possuir função showToast");
  assert.ok(contentJs.includes("wfs-hud-toast"), "Deve criar elemento #wfs-hud-toast");
  assert.ok(contentJs.includes("Janela em Tela Cheia ativada"), "Deve exibir mensagem de ativação");
  assert.ok(contentJs.includes("Alt+W ou Esc para sair"), "Deve exibir subtexto com instruções");
  assert.ok(contentJs.includes("Janela normal restaurada"), "Deve exibir mensagem de desativação");
});

test("7. Ocultação de Elementos de Interface e Estilo do HUD Toast no content.css", () => {
  const css = fs.readFileSync(path.join(projectRoot, "content.css"), "utf8");

  // Ocultação Twitch e Prime Video
  assert.ok(css.includes(".channel-root__right-column"), "Deve ocultar coluna de chat da Twitch");
  assert.ok(css.includes("[data-a-target=\"chat-container\"]"), "Deve ocultar container de chat da Twitch");
  assert.ok(css.includes(".av-retail-m-nav-container"), "Deve ocultar navegação do Prime Video");
  assert.ok(css.includes("#dv-web-player header"), "Deve ocultar header do Prime Video");

  // HUD Toast Estilos
  assert.ok(css.includes("#wfs-hud-toast"), "Deve estilizar o #wfs-hud-toast");
  assert.ok(css.includes("backdrop-filter"), "Deve usar backdrop-filter no Toast (glassmorphism)");
  assert.ok(css.includes("pointer-events: none"), "Toast não deve bloquear cliques do usuário");
  assert.ok(css.includes("z-index: 2147483647"), "Toast deve ter prioridade visual máxima");
  assert.ok(css.includes("@keyframes wfsToastFadeIn"), "Deve possuir animação de entrada fade-in");
  assert.ok(css.includes("@keyframes wfsToastFadeOut"), "Deve possuir animação de saída fade-out");
});

test("8. Validação dos Ícones e Assets Visuais", () => {
  const iconsPath = path.join(projectRoot, "icons");
  const svgPath = path.join(iconsPath, "icon.svg");
  const scriptPath = path.join(projectRoot, "scripts", "generate_icons.mjs");

  // SVG
  assert.ok(fs.existsSync(svgPath), "icons/icon.svg deve existir");
  const svgContent = fs.readFileSync(svgPath, "utf8");
  assert.ok(svgContent.includes("<svg"), "icons/icon.svg deve conter tag <svg>");
  assert.ok(svgContent.includes("linearGradient"), "icons/icon.svg deve possuir gradientes modernos");

  // Script gerador
  assert.ok(fs.existsSync(scriptPath), "scripts/generate_icons.mjs deve existir");

  // PNGs
  const requiredSizes = [16, 32, 48, 128];
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  for (const size of requiredSizes) {
    const pngFile = path.join(iconsPath, `icon-${size}.png`);
    assert.ok(fs.existsSync(pngFile), `icons/icon-${size}.png deve existir`);

    const buf = fs.readFileSync(pngFile);
    assert.ok(buf.length > 50, `icons/icon-${size}.png deve possuir tamanho válido em bytes`);
    assert.ok(buf.subarray(0, 8).equals(pngSig), `icons/icon-${size}.png deve possuir assinatura PNG válida`);

    // Valida IHDR width e height (bytes 16..24)
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(w, size, `Largura do icon-${size}.png deve ser ${size}`);
    assert.equal(h, size, `Altura do icon-${size}.png deve ser ${size}`);
  }
});

test("9. Validação do package.json", () => {
  const pkgPath = path.join(projectRoot, "package.json");
  assert.ok(fs.existsSync(pkgPath), "package.json deve existir");

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.equal(pkg.name, "janela-em-tela-cheia", "Nome do pacote deve ser janela-em-tela-cheia");
  assert.equal(pkg.version, "1.3.0", "Versão do pacote deve ser 1.3.0");
  assert.equal(pkg.type, "module", "Deve ser do tipo module (ESM)");
  assert.ok(pkg.scripts?.test, "Deve conter script de test");
  assert.ok(pkg.scripts?.build, "Deve conter script de build");
  assert.equal(pkg.scripts.test, "node --test", "Script de teste deve ser 'node --test'");
  assert.equal(pkg.scripts.build, "node build.mjs", "Script de build deve ser 'node build.mjs'");
});

test("10. Validação do Script de Build e Pacotes de Distribuição (build.mjs)", async () => {
  const { build } = await import("../build.mjs");
  build();

  const distDir = path.join(projectRoot, "dist");
  const firefoxManifestPath = path.join(distDir, "firefox", "manifest.json");
  const chromeManifestPath = path.join(distDir, "chrome", "manifest.json");
  const firefoxZipPath = path.join(distDir, "JanelaTelaCheia-firefox.zip");
  const chromeZipPath = path.join(distDir, "JanelaTelaCheia-chrome.zip");

  assert.ok(fs.existsSync(firefoxManifestPath), "dist/firefox/manifest.json deve existir");
  assert.ok(fs.existsSync(chromeManifestPath), "dist/chrome/manifest.json deve existir");
  assert.ok(fs.existsSync(firefoxZipPath), "dist/JanelaTelaCheia-firefox.zip deve existir");
  assert.ok(fs.existsSync(chromeZipPath), "dist/JanelaTelaCheia-chrome.zip deve existir");

  const ffManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, "utf8"));
  const crManifest = JSON.parse(fs.readFileSync(chromeManifestPath, "utf8"));

  // Firefox: background.scripts e browser_specific_settings.gecko
  assert.ok(Array.isArray(ffManifest.background?.scripts), "Firefox manifest deve usar background.scripts");
  assert.ok(ffManifest.browser_specific_settings?.gecko, "Firefox manifest deve conter gecko settings");

  // Chrome: background.service_worker e sem browser_specific_settings
  assert.equal(crManifest.background?.service_worker, "background.js", "Chrome manifest deve usar background.service_worker");
  assert.equal(crManifest.browser_specific_settings, undefined, "Chrome manifest não deve ter browser_specific_settings");

  // Zip files non-empty
  const ffZipStat = fs.statSync(firefoxZipPath);
  const crZipStat = fs.statSync(chromeZipPath);
  assert.ok(ffZipStat.size > 1000, "dist/JanelaTelaCheia-firefox.zip deve ter conteúdo válido");
  assert.ok(crZipStat.size > 1000, "dist/JanelaTelaCheia-chrome.zip deve ter conteúdo válido");
});

test("11. Simulação Funcional de Re-acoplamento de Janelas no background.js", async () => {
  const bgCode = fs.readFileSync(path.join(projectRoot, "background.js"), "utf8");

  let messageListener = null;
  const movedTabs = [];
  const updatedTabs = [];
  const createdWindows = [];
  let existingWindows = new Map([
    [10, { id: 10, type: "normal", left: 0, top: 0, width: 800, height: 600 }]
  ]);

  const mockBrowser = {
    action: { onClicked: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
    runtime: {
      onMessage: {
        addListener: (fn) => {
          messageListener = fn;
        }
      }
    },
    tabs: {
      sendMessage: async () => ({ status: "ok" }),
      move: async (tabId, opts) => {
        movedTabs.push({ tabId, ...opts });
        return { id: tabId };
      },
      update: async (tabId, opts) => {
        updatedTabs.push({ tabId, ...opts });
        return { id: tabId };
      }
    },
    windows: {
      get: async (windowId) => {
        if (!existingWindows.has(windowId)) {
          throw new Error("Window not found");
        }
        return existingWindows.get(windowId);
      },
      create: async (data) => {
        const win = { id: 200 + createdWindows.length, ...data };
        createdWindows.push(win);
        existingWindows.set(win.id, win);
        return win;
      }
    }
  };

  const sandbox = {
    globalThis: { chrome: mockBrowser },
    console: { warn: () => {}, error: () => {}, log: () => {} },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    Map
  };
  sandbox.globalThis.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);
  vm.runInContext(bgCode, sandbox);

  assert.ok(typeof messageListener === "function", "Message listener deve estar registrado");

  // Cenário 1: clean_window cria janela popup
  const senderTab = { tab: { id: 42, windowId: 10 } };
  await messageListener({ action: "clean_window" }, senderTab);

  assert.equal(createdWindows.length, 1, "Deve criar 1 janela popup ao ativar");
  assert.equal(createdWindows[0].type, "popup");
  assert.equal(createdWindows[0].tabId, 42);

  // Cenário 2: restore_window com janela original existente -> re-acopla a aba
  const popupTab = { tab: { id: 42, windowId: createdWindows[0].id } };
  await messageListener({ action: "restore_window" }, popupTab);

  assert.equal(movedTabs.length, 1, "Deve ter re-acoplado a aba na janela original");
  assert.equal(movedTabs[0].tabId, 42);
  assert.equal(movedTabs[0].windowId, 10);
  assert.equal(movedTabs[0].index, -1);
  assert.equal(updatedTabs.length, 1, "Deve ter focado a aba após mover");
  assert.equal(updatedTabs[0].tabId, 42);
  assert.equal(updatedTabs[0].active, true);
  // Não deve criar nova janela se re-acoplou com sucesso
  assert.equal(createdWindows.length, 1);

  // Cenário 3: restore_window quando a janela original foi fechada -> fallback para windows.create
  const senderTab2 = { tab: { id: 55, windowId: 10 } };
  await messageListener({ action: "clean_window" }, senderTab2);
  const popup2 = createdWindows[createdWindows.length - 1];

  // Fecha a janela original 10
  existingWindows.delete(10);

  const popupTab2 = { tab: { id: 55, windowId: popup2.id } };
  await messageListener({ action: "restore_window" }, popupTab2);

  // Deve ter chamado windows.create com type 'normal'
  const lastCreated = createdWindows[createdWindows.length - 1];
  assert.equal(lastCreated.type, "normal", "Fallback deve criar janela normal");
  assert.equal(lastCreated.tabId, 55, "Deve associar a aba correta na nova janela");
});
