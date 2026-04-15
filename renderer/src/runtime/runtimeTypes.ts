import type {
  PickFileRequest,
  PickFileResult,
  LoadTrackFilesRequest,
  LoadTrackFilesResult,
  TrackSnapshotPayload,
} from "../../../electron/ipcTypes";

export type OpenCanyonSourceResult = {
  canceled: boolean;
  filePath?: string;
  data?: unknown;
  error?: string;
};

export type CreateCanyonWorkspaceRequest = {
  canyonName: string;
  initialSectionNames: string[];
  canyonData: unknown;
};

export type CreateCanyonWorkspaceResult = {
  canceled: boolean;
  filePath?: string;
  folderPath?: string;
  data?: unknown;
  error?: string;
};

export type SaveCanyonWorkspaceRequest = {
  currentFilePath?: string | null;
  canyonName?: string;
  canyonData: unknown;
  trackSnapshot?: TrackSnapshotPayload | null;
  forceNullTopos?: boolean;
};

export type SaveCanyonWorkspaceResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
  warnings?: string[];
  data?: unknown;
  downloadedFileName?: string;
};

export interface EditorRuntime {
  kind: "electron" | "web";
  getMapboxToken(): Promise<string | null>;
  copyTextToClipboard(text: string): Promise<void>;
  loadStaticJsonAsset(assetPath: string): Promise<unknown>;
  openCanyonSource(): Promise<OpenCanyonSourceResult>;
  createNewCanyonWorkspace(request: CreateCanyonWorkspaceRequest): Promise<CreateCanyonWorkspaceResult>;
  saveCanyonWorkspace(request: SaveCanyonWorkspaceRequest): Promise<SaveCanyonWorkspaceResult>;
  pickFile(request: PickFileRequest): Promise<PickFileResult>;
  loadTrackFiles(request: LoadTrackFilesRequest): Promise<LoadTrackFilesResult>;
}
