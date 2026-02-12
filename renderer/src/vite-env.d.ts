export {};

declare global {
  interface Window {
    api: {
      getMapboxToken: () => Promise<string | null>;
      saveGeoJSON: (
        filenameSuggestion: string,
        geojsonString: string,
      ) => Promise<{ canceled: boolean; filePath?: string }>;
    };
  }
}
