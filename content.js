(function () {
  if (window.__wfs_injected) return;
  window.__wfs_injected = true;

  // Polyfill / shim universal para navegadores (Firefox / Chrome / Edge)
  const browserAPI = globalThis.browser || globalThis.chrome;

  let lastToggleTime = 0;
  let toastTimer = null;
  let toastRemoveTimer = null;

  /**
   * Exibe um HUD Toast visual não-intrusivo informando o estado da janela
   */
  function showToast(message, subtext = "") {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastRemoveTimer) {
      clearTimeout(toastRemoveTimer);
      toastRemoveTimer = null;
    }

    let toast = document.getElementById("wfs-hud-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "wfs-hud-toast";
      (document.body || document.documentElement).appendChild(toast);
    }

    toast.innerHTML = `
      <div class="wfs-toast-title">${message}</div>
      ${subtext ? `<div class="wfs-toast-sub">${subtext}</div>` : ""}
    `;

    toast.classList.remove("wfs-toast-hide");
    toast.classList.remove("wfs-toast-show");

    // Força reflow para reiniciar animação CSS suave
    void toast.offsetWidth;

    toast.classList.add("wfs-toast-show");

    // Desaparece automaticamente após ~2.2 segundos
    toastTimer = setTimeout(() => {
      toast.classList.remove("wfs-toast-show");
      toast.classList.add("wfs-toast-hide");

      toastRemoveTimer = setTimeout(() => {
        if (toast && toast.parentNode) {
          toast.remove();
        }
      }, 350);
    }, 2200);
  }

  /**
   * Localiza o elemento alvo do player de vídeo com suporte expandido aos principais streamings
   */
  function findVideoTarget() {
    // 1. YouTube
    const ytPlayer = document.querySelector("#movie_player");
    if (ytPlayer) return ytPlayer;

    // 2. Netflix
    const netflixPlayer =
      document.querySelector(".watch-video--player-view") ||
      document.querySelector(".watch-video") ||
      document.querySelector("[data-uia='watch-video']");
    if (netflixPlayer) return netflixPlayer;

    // 3. Twitch
    const twitchPlayer =
      document.querySelector(".video-player__container") ||
      document.querySelector(".persistent-player");
    if (twitchPlayer) return twitchPlayer;

    // 4. Amazon Prime Video
    const primePlayer =
      document.querySelector(".webPlayerSDKContainer") ||
      document.querySelector(".rendererContainer") ||
      document.querySelector(".dv-player-fullscreen");
    if (primePlayer) return primePlayer;

    // 5. Disney+
    const disneyPlayer =
      document.querySelector("#hls-player") ||
      document.querySelector(".btm-media-client-element") ||
      (document.querySelector(".video-container")?.querySelector("video")
        ? document.querySelector(".video-container")
        : null);
    if (disneyPlayer) return disneyPlayer;

    // 6. Max / HBO
    const maxPlayer =
      document.querySelector("[data-testid='player-video-container']") ||
      document.querySelector(".default-player-container");
    if (maxPlayer) return maxPlayer;

    // 7. Crunchyroll
    const crunchyrollPlayer =
      document.querySelector("#player0") ||
      document.querySelector(".vilos-player") ||
      (document.querySelector(".video-player")?.querySelector("video")
        ? document.querySelector(".video-player")
        : null);
    if (crunchyrollPlayer) return crunchyrollPlayer;

    // 8. HTML5 Genérico / Outros players
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;

    // Filtra vídeos visíveis com dimensões reais
    const visibleVideos = videos.filter((v) => {
      const rect = v.getBoundingClientRect();
      return rect.width > 20 && rect.height > 20;
    });
    const candidateList = visibleVideos.length > 0 ? visibleVideos : videos;

    // Prioriza o vídeo em execução
    const activeVideo =
      candidateList.find((v) => !v.paused && v.currentTime > 0) ||
      candidateList.find((v) => !v.paused) ||
      candidateList.find((v) => v.readyState > 0 && v.videoWidth > 0) ||
      candidateList[0];

    let current = activeVideo;
    while (
      current.parentElement &&
      current.parentElement.tagName !== "BODY" &&
      current.parentElement.tagName !== "HTML"
    ) {
      const parent = current.parentElement;
      const pRect = parent.getBoundingClientRect();
      const vRect = activeVideo.getBoundingClientRect();
      if (
        Math.abs(pRect.width - vRect.width) < 60 &&
        Math.abs(pRect.height - vRect.height) < 60
      ) {
        current = parent;
      } else {
        break;
      }
    }

    return current || activeVideo;
  }

  /**
   * Alterna entre modo normal e Janela em Tela Cheia
   */
  function toggleWindowedFullscreen() {
    const now = Date.now();
    if (now - lastToggleTime < 350) return;
    lastToggleTime = now;

    const isAlreadyActive =
      (document.body && document.body.classList.contains("wfs-active")) ||
      document.documentElement.classList.contains("wfs-active");

    if (isAlreadyActive) {
      // --- DESATIVAR ---
      document.documentElement.classList.remove("wfs-active");
      if (document.body) {
        document.body.classList.remove("wfs-active");
      }

      const targets = document.querySelectorAll(".wfs-fullscreen-target");
      targets.forEach((target) => {
        target.classList.remove("wfs-fullscreen-target");
        target.classList.remove("ytp-fullscreen");
      });

      const ytPlayer = document.querySelector("#movie_player");
      if (ytPlayer) {
        ytPlayer.classList.remove("ytp-fullscreen");
      }

      showToast("Janela normal restaurada");

      if (browserAPI && browserAPI.runtime && browserAPI.runtime.sendMessage) {
        browserAPI.runtime.sendMessage({ action: "restore_window" });
      }
    } else {
      // --- ATIVAR ---
      const target = findVideoTarget();
      if (!target) {
        console.warn("[JanelaTelaCheia] Nenhum elemento de vídeo encontrado na página.");
        return;
      }

      document.documentElement.classList.add("wfs-active");
      if (document.body) {
        document.body.classList.add("wfs-active");
      }
      target.classList.add("wfs-fullscreen-target");

      // No YouTube, adiciona a classe nativa do próprio player para acionar o auto-dimensionamento
      if (target.id === "movie_player" || target.classList.contains("html5-video-player")) {
        target.classList.add("ytp-fullscreen");
      }

      showToast("Janela em Tela Cheia ativada", "Alt+W ou Esc para sair");

      // Avisa o background para remover as abas e barra de endereço
      if (browserAPI && browserAPI.runtime && browserAPI.runtime.sendMessage) {
        browserAPI.runtime.sendMessage({ action: "clean_window" });
      }
    }

    // Dispara evento para o player reajustar layout
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 100);
  }

  // Atalhos: Alt + W para alternar e Esc para sair
  window.addEventListener(
    "keydown",
    (e) => {
      const isW = e.key === "w" || e.key === "W" || e.code === "KeyW";
      const isActive =
        (document.body && document.body.classList.contains("wfs-active")) ||
        document.documentElement.classList.contains("wfs-active");

      if (e.altKey && isW) {
        e.preventDefault();
        e.stopPropagation();
        toggleWindowedFullscreen();
      } else if (e.key === "Escape" && isActive) {
        e.preventDefault();
        e.stopPropagation();
        toggleWindowedFullscreen();
      }
    },
    true
  );

  if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "ping") {
        sendResponse({ status: "ok" });
        return true;
      }
      if (message.action === "toggle") {
        toggleWindowedFullscreen();
      }
    });
  }
})();