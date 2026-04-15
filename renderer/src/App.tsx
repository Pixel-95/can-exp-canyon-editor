import { useState } from "react";
import { CanyonJsonEditor } from "./CanyonJsonEditor";
import { createEditorRuntime } from "./runtime/editorRuntime";

const WEB_PASSWORD = "morecanyons";
const WEB_PASSWORD_SESSION_KEY = "canyon-editor.web-access";

function WebPasswordGate({ onUnlock }: { onUnlock: () => void }): JSX.Element {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="json-modal-backdrop" role="presentation">
      <div className="json-modal" role="dialog" aria-modal="true" aria-label="Unlock canyon editor">
        <div className="json-modal-header">
          <h3>Unlock canyon editor</h3>
        </div>
        <p className="json-modal-help">Enter the website password to access the editor.</p>
        <div className="json-input-field">
          <label htmlFor="web-password-input">Password</label>
          <input
            id="web-password-input"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) {
                setError("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }

              event.preventDefault();
              if (password === WEB_PASSWORD) {
                window.sessionStorage.setItem(WEB_PASSWORD_SESSION_KEY, "granted");
                onUnlock();
                return;
              }

              setError("Wrong password.");
            }}
          />
        </div>
        {error ? <p className="json-inline-error">{error}</p> : null}
        <div className="json-modal-actions">
          <button
            type="button"
            className="json-modal-apply"
            onClick={() => {
              if (password === WEB_PASSWORD) {
                window.sessionStorage.setItem(WEB_PASSWORD_SESSION_KEY, "granted");
                onUnlock();
                return;
              }

              setError("Wrong password.");
            }}
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const [runtime] = useState(() => createEditorRuntime());
  const [mapViewMode, setMapViewMode] = useState<"compact" | "expanded">("compact");
  const [isWebUnlocked, setIsWebUnlocked] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    if (typeof window.api !== "undefined") {
      return true;
    }

    return window.sessionStorage.getItem(WEB_PASSWORD_SESSION_KEY) === "granted";
  });

  return (
    <div className="editor-host">
      {runtime.kind === "web" && !isWebUnlocked ? (
        <WebPasswordGate onUnlock={() => setIsWebUnlocked(true)} />
      ) : (
        <CanyonJsonEditor
          runtime={runtime}
          mapViewMode={mapViewMode}
          onToggleMapView={() =>
            setMapViewMode((current) => (current === "compact" ? "expanded" : "compact"))
          }
        />
      )}
    </div>
  );
}
