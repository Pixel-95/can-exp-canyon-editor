import { contextBridge, ipcRenderer } from "electron";

type SaveGeoJSONResult = {
  canceled: boolean;
  filePath?: string;
};

type LoadJsonResult = {
  canceled: boolean;
  filePath?: string;
  data?: unknown;
  error?: string;
};

type SaveJsonResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

type SaveJsonRequest = {
  currentFilePath?: string | null;
  jsonString: string;
  canyonName?: string;
};

type PickFileRequest = {
  baseDir?: string | null;
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type PickFileResult = {
  canceled: boolean;
  absolutePath?: string;
  relativePath?: string;
};

contextBridge.exposeInMainWorld("api", {
  getMapboxToken: (): Promise<string | null> =>
    ipcRenderer.invoke("config:get-mapbox-token"),
  saveGeoJSON: (
    filenameSuggestion: string,
    geojsonString: string,
  ): Promise<SaveGeoJSONResult> =>
    ipcRenderer.invoke("route:save-geojson", filenameSuggestion, geojsonString),
  loadJsonFromDialog: (): Promise<LoadJsonResult> =>
    ipcRenderer.invoke("json:load-dialog"),
  loadJsonFromPath: (requestedPath: string): Promise<LoadJsonResult> =>
    ipcRenderer.invoke("json:load-path", requestedPath),
  createNewJsonTemplate: (canyonName: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke("json:new-template", canyonName),
  saveJson: (request: SaveJsonRequest): Promise<SaveJsonResult> =>
    ipcRenderer.invoke("json:save", request),
  pickFile: (request: PickFileRequest): Promise<PickFileResult> =>
    ipcRenderer.invoke("json:pick-file", request),
});
