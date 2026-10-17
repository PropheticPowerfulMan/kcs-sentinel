import React from "react";
import ReactDOM from "react-dom/client";

import InstitutionalGate from "./InstitutionalGate";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    let reloadingForSentinelUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForSentinelUpdate) return;
      reloadingForSentinelUpdate = true;
      window.location.reload();
    });
    const sentinelScope = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      // Retire an obsolete root-scoped Nexus worker before installing Sentinel's
      // narrower scope. This migration prevents the browser from reopening Nexus.
      await Promise.all(registrations.filter((registration) => registration.scope !== sentinelScope && sentinelScope.startsWith(registration.scope)).map((registration) => registration.unregister()));
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
