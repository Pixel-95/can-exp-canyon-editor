import { contextBridge, ipcRenderer } from "electron";

type SaveGeoJSONResult = {
  canceled: boolean;
  filePath?: string;
};

contextBridge.exposeInMainWorld("api", {
  getMapboxToken: (): Promise<string | null> =>
    ipcRenderer.invoke("config:get-mapbox-token"),
  saveGeoJSON: (
    filenameSuggestion: string,
    geojsonString: string,
  ): Promise<SaveGeoJSONResult> =>
    ipcRenderer.invoke("route:save-geojson", filenameSuggestion, geojsonString),
});
