import { useState } from "react";
import { CanyonJsonEditor } from "./CanyonJsonEditor";

export function App(): JSX.Element {
  const [mapViewMode, setMapViewMode] = useState<"compact" | "expanded">("compact");

  return (
    <div className="editor-host">
      <CanyonJsonEditor
        mapViewMode={mapViewMode}
        onToggleMapView={() =>
          setMapViewMode((current) => (current === "compact" ? "expanded" : "compact"))
        }
      />
    </div>
  );
}
