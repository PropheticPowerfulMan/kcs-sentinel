import React from "react";
import ReactDOM from "react-dom/client";

import InstitutionalGate from "./InstitutionalGate";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <InstitutionalGate />
  </React.StrictMode>
);
