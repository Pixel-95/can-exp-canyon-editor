export {};

declare global {
  interface Window {
    api: {
      getMapboxToken: () => Promise<string | null>;
      saveGeoJSON: (
        filenameSuggestion: string,
        geojsonString: string,
      ) => Promise<{ canceled: boolean; filePath?: string }>;
      loadJsonFromDialog: () => Promise<{
        canceled: boolean;
        filePath?: string;
        data?: unknown;
        error?: string;
      }>;
      loadJsonFromPath: (requestedPath: string) => Promise<{
        canceled: boolean;
        filePath?: string;
        data?: unknown;
        error?: string;
      }>;
      createNewJsonTemplate: (canyonName: string) => Promise<Record<string, unknown>>;
      saveJson: (request: {
        currentFilePath?: string | null;
        jsonString: string;
        canyonName?: string;
      }) => Promise<{
        canceled: boolean;
        filePath?: string;
        error?: string;
      }>;
      pickFile: (request: {
        baseDir?: string | null;
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<{
        canceled: boolean;
        absolutePath?: string;
        relativePath?: string;
      }>;
    };
  }
}
