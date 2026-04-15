import ReactDOM from "react-dom/client";
import "mapbox-gl/dist/mapbox-gl.css";
import "@fontsource/inter/latin.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/map.css";
import "./styles/json-editor.css";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import appIcon from "../../build/icon.png";

function ensureFavicon(href: string): void {
  let favicon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.appendChild(favicon);
  }

  favicon.type = "image/png";
  favicon.href = href;
}

ensureFavicon(appIcon);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
