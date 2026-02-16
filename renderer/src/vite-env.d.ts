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
      createCanyonFolder: (canyonName: string) => Promise<{
        canceled: boolean;
        folderPath?: string;
        dataJsonPath?: string;
        error?: string;
      }>;
      saveJson: (request: {
        currentFilePath?: string | null;
        jsonString: string;
        canyonName?: string;
      }) => Promise<{
        canceled: boolean;
        filePath?: string;
        error?: string;
      }>;
      saveCanyonWithTracks: (request: {
        currentFilePath?: string | null;
        canyonName?: string;
        canyonData: unknown;
        trackSnapshot?: {
          tracks: Array<{
            id: string;
            kind: "section" | "access";
            sectionIndex?: number;
            sectionId?: number;
            displayName: string;
            filePath: string;
            color: "orange" | "black";
            routePoints: Array<{
              id: string;
              type: "start" | "waypoint" | "end";
              coordinates: [number, number];
              segmentMode?: "route" | "straight";
            }>;
            routeFeature: {
              type: "Feature";
              geometry: {
                type: "LineString";
                coordinates: number[][];
              };
              properties: {
                distance_m: number;
                duration_s: number;
                profile: "walking";
                start: [number, number];
                end: [number, number];
                waypoints: Array<[number, number]>;
                segments: Array<{
                  index: number;
                  from: [number, number];
                  to: [number, number];
                  mode: "route" | "straight";
                  distance_m: number;
                  duration_s: number;
                  elevation_gain_m: number;
                  failed: boolean;
                  error?: string;
                }>;
                elevation_gain_m?: number;
                elevation_start_m?: number;
                elevation_end_m?: number;
                generated_at: string;
              };
            } | null;
            missingFile: boolean;
            legacyFormat: boolean;
            needsRebuild: boolean;
            rawFeatureProperties?: Record<string, unknown>;
          }>;
          activeTrackId: string | null;
          warnings: string[];
        } | null;
      }) => Promise<{
        canceled: boolean;
        filePath?: string;
        error?: string;
        warnings?: string[];
        data?: unknown;
      }>;
      pickFile: (request: {
        baseDir?: string | null;
        defaultPath?: string | null;
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<{
        canceled: boolean;
        absolutePath?: string;
        relativePath?: string;
      }>;
      loadTrackFiles: (request: {
        canyonFilePath?: string | null;
        tracks: Array<{
          id: string;
          kind: "section" | "access";
          filePath: string;
        }>;
      }) => Promise<{
        entries: Array<{
          id: string;
          kind: "section" | "access";
          filePath: string;
          absolutePath?: string;
          missing: boolean;
          error?: string;
          data?: unknown;
        }>;
      }>;
    };
  }
}
