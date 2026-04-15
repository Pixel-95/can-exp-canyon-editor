import { createNewJsonTemplate } from "../../../electron/canyonCore";
import type { EditorRuntime } from "./runtimeTypes";

function requireElectronApi(): Window["api"] {
  if (!window.api) {
    throw new Error("Electron API is not available in this runtime.");
  }

  return window.api;
}

export function createElectronRuntime(): EditorRuntime {
  return {
    kind: "electron",
    getMapboxToken: () => requireElectronApi().getMapboxToken(),
    copyTextToClipboard: (text) => requireElectronApi().copyTextToClipboard(text),
    async loadStaticJsonAsset(assetPath) {
      const result = await requireElectronApi().loadJsonFromPath(assetPath);
      if (result.canceled) {
        throw new Error(`Loading ${assetPath} was canceled.`);
      }
      if (result.error) {
        throw new Error(result.error);
      }
      return result.data;
    },
    openCanyonSource: () => requireElectronApi().loadJsonFromDialog(),
    async createNewCanyonWorkspace(request) {
      const template = createNewJsonTemplate(request.canyonName);
      const folderResult = await requireElectronApi().createCanyonFolder({
        canyonName: request.canyonName,
        initialSectionNames: request.initialSectionNames,
      });
      if (folderResult.error) {
        return {
          canceled: false,
          error: folderResult.error,
        };
      }

      return {
        canceled: false,
        folderPath: folderResult.folderPath,
        filePath: folderResult.dataJsonPath,
        data: template,
      };
    },
    saveCanyonWorkspace: (request) => requireElectronApi().saveCanyonWithTracks(request),
    pickFile: (request) => requireElectronApi().pickFile(request),
    loadTrackFiles: (request) => requireElectronApi().loadTrackFiles(request),
  };
}
