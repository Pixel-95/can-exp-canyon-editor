import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateCanyonFolderResult,
  LoadJsonResult,
  LoadTrackFilesRequest,
  LoadTrackFilesResult,
  PickFileRequest,
  PickFileResult,
  SaveCanyonWithTracksRequest,
  SaveCanyonWithTracksResult,
  SaveGeoJSONResult,
  SaveJsonRequest,
  SaveJsonResult,
} from "./ipcTypes";

contextBridge.exposeInMainWorld("api", {
  getMapboxToken: (): Promise<string | null> =>
    ipcRenderer.invoke("config:get-mapbox-token"),
  copyTextToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke("clipboard:write-text", text),
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
  createCanyonFolder: (canyonName: string): Promise<CreateCanyonFolderResult> =>
    ipcRenderer.invoke("json:create-canyon-folder", canyonName),
  saveJson: (request: SaveJsonRequest): Promise<SaveJsonResult> =>
    ipcRenderer.invoke("json:save", request),
  saveCanyonWithTracks: (request: SaveCanyonWithTracksRequest): Promise<SaveCanyonWithTracksResult> =>
    ipcRenderer.invoke("json:save-with-tracks", request),
  pickFile: (request: PickFileRequest): Promise<PickFileResult> =>
    ipcRenderer.invoke("json:pick-file", request),
  loadTrackFiles: (request: LoadTrackFilesRequest): Promise<LoadTrackFilesResult> =>
    ipcRenderer.invoke("tracks:load-batch", request),
});
