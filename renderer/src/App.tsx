import { useState } from "react";
import { CanyonJsonEditor } from "./CanyonJsonEditor";
import { RouteMapApp } from "./RouteMapApp";

export function App(): JSX.Element {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="editor-host">
      <CanyonJsonEditor />

      <button
        type="button"
        className={`map-overlay-toggle${mapOpen ? " open" : ""}`}
        onClick={() => setMapOpen((current) => !current)}
        aria-label={mapOpen ? "Hide map overlay" : "Show map overlay"}
        title={mapOpen ? "Hide map" : "Show map"}
      >
        {mapOpen ? ">" : "<"}
      </button>

      <div className={`route-overlay${mapOpen ? " open" : ""}`}>
        <div className="route-overlay-inner">
          <RouteMapApp />
        </div>
      </div>
    </div>
  );
}
