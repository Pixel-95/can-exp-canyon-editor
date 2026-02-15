import { useState } from "react";
import { CanyonJsonEditor } from "./CanyonJsonEditor";
import { RouteMapApp } from "./RouteMapApp";

export function App(): JSX.Element {
  const [mapViewMode, setMapViewMode] = useState<"compact" | "expanded">("compact");
  const isExpanded = mapViewMode === "expanded";

  return (
    <div className="editor-host">
      <CanyonJsonEditor />

      <div className={`route-overlay ${mapViewMode}`}>
        <button
          type="button"
          className={`map-overlay-toggle ${mapViewMode}`}
          onClick={() => setMapViewMode(isExpanded ? "compact" : "expanded")}
          aria-label={isExpanded ? "Collapse map" : "Enlarge map"}
          title={isExpanded ? "Collapse map" : "Enlarge map"}
        >
          {isExpanded ? ">" : "Enlarge map"}
        </button>
        <div className="route-overlay-inner">
          <RouteMapApp viewMode={mapViewMode} />
        </div>
      </div>
    </div>
  );
}
