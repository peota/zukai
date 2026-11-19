import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import { systemScheme } from "./ui/useColorScheme";

// The OS mode until the Session's Theme setting is read: no light flash
// on a dark system.
document.documentElement.dataset.theme = systemScheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
