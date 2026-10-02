// Compatibilidade universal Chromium + Firefox
const browserAPI = globalThis.browser || globalThis.chrome;

// Guarda histórico das janelas para restaurar com segurança
const windowStateMap = new Map();
let isSwitching = false;

// Garante que o script e CSS estejam na aba antes de enviar o comando
// (Resolve o problema de não funcionar em abas que já estavam abertas antes de carregar a extensão)
async function ensureInjected(tabId) {
  try {
    const res = await browserAPI.tabs.sendMessage(tabId, { action: "ping" });
    if (res && res.status === "ok") return true;
  } catch (e) {
    // Content script ainda não está presente nesta aba
  }

  try {
    await browserAPI.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
  } catch (e) {}

  try {
    await browserAPI.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (err) {
    console.warn("[JanelaTelaCheia] Não foi possível injetar script na aba:", err);
    return false;
  }
}

// Dispara alternância de tela cheia
async function triggerToggle(tab) {
  if (!tab || !tab.id) return;

  // Garante injeção (funciona mesmo sem precisar dar F5 na página)
  await ensureInjected(tab.id);

  try {
    await browserAPI.tabs.sendMessage(tab.id, { action: "toggle" });
  } catch (err) {
    console.error("[JanelaTelaCheia] Erro ao enviar mensagem toggle:", err);
  }
}

// Ao clicar no ícone da extensão
browserAPI.action.onClicked.addListener(triggerToggle);

// Ao disparar o atalho Alt+W registrado no navegador
browserAPI.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-windowed-fullscreen") {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tab) triggerToggle(tab);
  }
});

// Gerenciamento de janelas (remover abas / restaurar)
browserAPI.runtime.onMessage.addListener(async (message, sender) => {
  if (!sender.tab || !sender.tab.id) return;
  if (isSwitching) return;

  const tabId = sender.tab.id;

  try {
    const currentWindow = await browserAPI.windows.get(sender.tab.windowId);

    if (message.action === "clean_window") {
      if (currentWindow.type === "popup") return;

      isSwitching = true;

      const bounds = {
        left: currentWindow.left,
        top: currentWindow.top,
        width: currentWindow.width,
        height: currentWindow.height
      };
      windowStateMap.set(tabId, { originalWindowId: currentWindow.id, bounds });

      const createData = {
        tabId: tabId,
        type: "popup"
      };
      if (typeof bounds.left === "number") createData.left = bounds.left;
      if (typeof bounds.top === "number") createData.top = bounds.top;
      if (typeof bounds.width === "number") createData.width = bounds.width;
      if (typeof bounds.height === "number") createData.height = bounds.height;

      try {
        await browserAPI.windows.create(createData);
      } catch (wErr) {
        console.warn("[JanelaTelaCheia] Aviso ao criar popup window:", wErr);
      }
    } else if (message.action === "restore_window") {
      if (currentWindow.type !== "popup") return;

      isSwitching = true;

      const state = windowStateMap.get(tabId);
      let reattached = false;

      // Tenta re-acoplar na janela original se ela ainda existir
      if (state && typeof state.originalWindowId !== "undefined") {
        try {
          const originalWindow = await browserAPI.windows.get(state.originalWindowId);
          if (originalWindow) {
            await browserAPI.tabs.move(tabId, { windowId: state.originalWindowId, index: -1 });
            await browserAPI.tabs.update(tabId, { active: true });
            reattached = true;
          }
        } catch (e) {
          // Janela original foi fechada ou não existe mais
          reattached = false;
        }
      }

      // Se a janela original não existir mais ou falhar o re-acoplamento, cria nova janela normal
      if (!reattached) {
        const bounds = state ? state.bounds : {
          left: currentWindow.left,
          top: currentWindow.top,
          width: currentWindow.width,
          height: currentWindow.height
        };

        const createData = {
          tabId: tabId,
          type: "normal"
        };
        if (typeof bounds.left === "number") createData.left = bounds.left;
        if (typeof bounds.top === "number") createData.top = bounds.top;
        if (typeof bounds.width === "number") createData.width = bounds.width;
        if (typeof bounds.height === "number") createData.height = bounds.height;

        try {
          await browserAPI.windows.create(createData);
        } catch (wErr) {
          console.warn("[JanelaTelaCheia] Aviso ao restaurar normal window:", wErr);
        }
      }

      windowStateMap.delete(tabId);
    }
  } catch (err) {
    console.error("[JanelaTelaCheia] Erro no gerenciador de janelas:", err);
  } finally {
    setTimeout(() => {
      isSwitching = false;
    }, 400);
  }
});