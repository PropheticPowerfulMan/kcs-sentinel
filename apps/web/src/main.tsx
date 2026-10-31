import React from "react";
import ReactDOM from "react-dom/client";

import InstitutionalGate from "./InstitutionalGate";
import "./index.css";

type SentinelInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
declare global { interface Window { __kcsSentinelInstallPrompt?: SentinelInstallPrompt } }

// Chromium can emit beforeinstallprompt before React effects mount. Capture it
// at module initialization so the visible Install button always invokes the
// native PWA flow instead of behaving like a simple browser shortcut.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.__kcsSentinelInstallPrompt = event as SentinelInstallPrompt;
  window.dispatchEvent(new Event('kcs:sentinel-install-ready'));
});
window.addEventListener('appinstalled', () => { window.__kcsSentinelInstallPrompt = undefined; });

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    let reloadingForSentinelUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForSentinelUpdate) return;
      reloadingForSentinelUpdate = true;
      window.location.reload();
    });
    void navigator.serviceWorker.getRegistrations().then(async () => {
      // Sentinel owns only /sentinel/. Keep Nexus and sibling PWA
      // registrations intact and rely on the most-specific browser scope.
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" });
      await registration.update();
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <InstitutionalGate />
  </React.StrictMode>
);
