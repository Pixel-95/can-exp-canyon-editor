import ReactDOM from "react-dom/client";
import "mapbox-gl/dist/mapbox-gl.css";
import "./styles.css";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
