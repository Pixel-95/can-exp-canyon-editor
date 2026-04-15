import type {
  CreateCanyonFolderRequest,
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
} from "../../electron/ipcTypes";

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_MAPBOX_TOKEN?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    api: {
      getMapboxToken: () => Promise<string | null>;
      copyTextToClipboard: (text: string) => Promise<void>;
      saveGeoJSON: (filenameSuggestion: string, geojsonString: string) => Promise<SaveGeoJSONResult>;
      loadJsonFromDialog: () => Promise<LoadJsonResult>;
      loadJsonFromPath: (requestedPath: string) => Promise<LoadJsonResult>;
      createNewJsonTemplate: (canyonName: string) => Promise<Record<string, unknown>>;
      createCanyonFolder: (request: CreateCanyonFolderRequest) => Promise<CreateCanyonFolderResult>;
      saveJson: (request: SaveJsonRequest) => Promise<SaveJsonResult>;
      saveCanyonWithTracks: (request: SaveCanyonWithTracksRequest) => Promise<SaveCanyonWithTracksResult>;
      pickFile: (request: PickFileRequest) => Promise<PickFileResult>;
      loadTrackFiles: (request: LoadTrackFilesRequest) => Promise<LoadTrackFilesResult>;
    };
  }
}
