import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";

const root = document.getElementById("react-root");
if (!root) {
  throw new Error("#react-root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
