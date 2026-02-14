import "dotenv/config";

import { Menu, app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

type SaveJsonRequest = {
  currentFilePath?: string | null;
  jsonString: string;
  canyonName?: string;
};

type SaveJsonResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

type PickFileFilter = {
  name: string;
  extensions: string[];
};

type PickFileRequest = {
  baseDir?: string | null;
  title?: string;
  filters?: PickFileFilter[];
};

type PickFileResult = {
  canceled: boolean;
  absolutePath?: string;
  relativePath?: string;
};

let mainWindow: BrowserWindow | null = null;

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), "build", "icon.png"),
    path.join(process.resourcesPath, "build", "icon.png"),
    path.join(process.resourcesPath, "icon.png"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function createWindow(): void {
  const iconPath = resolveWindowIconPath();

  mainWindow = new BrowserWindow({
    title: "Canyon Editor",
    width: 1664,
    height: 1066,
    minWidth: 1248,
    minHeight: 832,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("Renderer process became unresponsive.");
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, url) => {
    console.error("Renderer failed to load:", { errorCode, errorDescription, url });
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    void mainWindow.loadFile(indexPath);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function toAbsolutePath(requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) {
    return path.normalize(requestedPath);
  }

  return path.resolve(process.cwd(), requestedPath);
}

function toRelativePath(baseDir: string, absolutePath: string): string {
  const relativePath = path.relative(baseDir, absolutePath);
  if (!relativePath) {
    return `.${path.sep}${path.basename(absolutePath)}`.split(path.sep).join("/");
  }

  const prefixed = relativePath.startsWith(".") ? relativePath : `.${path.sep}${relativePath}`;
  return prefixed.split(path.sep).join("/");
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "canyon";
}

function createNewJsonTemplate(canyonName: string): Record<string, unknown> {
  const name = canyonName.trim() || "New Canyon";

  return {
    id: null,
    coordinates: [0, 0],
    name,
    description: {
      en: "",
    },
    location: {
      country_code: "",
      region_code: "",
    },
    parking_lots: [],
    points_of_interest: [],
    tracks_access: [],
    cover_image: null,
    sections: [],
  };
}

async function loadJsonFromFile(filePath: string): Promise<LoadJsonResult> {
  try {
    const jsonString = await readFile(filePath, "utf8");
    const parsed = JSON.parse(jsonString) as unknown;
    return {
      canceled: false,
      filePath,
      data: parsed,
    };
  } catch (error) {
    return {
      canceled: false,
      filePath,
      error: toErrorMessage(error),
    };
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in main process:", reason);
});

ipcMain.handle("config:get-mapbox-token", () => {
  return process.env.MAPBOX_TOKEN ?? null;
});

ipcMain.handle(
  "route:save-geojson",
  async (
    _event,
    filenameSuggestion: string,
    geojsonString: string,
  ): Promise<SaveGeoJSONResult> => {
    if (!mainWindow) {
      throw new Error("Application window is not ready.");
    }

    if (!geojsonString) {
      throw new Error("No GeoJSON payload was provided.");
    }

    const normalizedFilename = filenameSuggestion.endsWith(".geojson")
      ? filenameSuggestion
      : `${filenameSuggestion}.geojson`;

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: "Save Route GeoJSON",
      defaultPath: normalizedFilename,
      filters: [{ name: "GeoJSON", extensions: ["geojson"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    await writeFile(saveResult.filePath, geojsonString, "utf8");

    return {
      canceled: false,
      filePath: saveResult.filePath,
    };
  },
);

ipcMain.handle("json:load-dialog", async (): Promise<LoadJsonResult> => {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  const openResult = await dialog.showOpenDialog(mainWindow, {
    title: "Load Canyon JSON",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  return loadJsonFromFile(openResult.filePaths[0]);
});

ipcMain.handle("json:load-path", async (_event, requestedPath: string): Promise<LoadJsonResult> => {
  if (!requestedPath || !requestedPath.trim()) {
    return {
      canceled: false,
      error: "No JSON path was provided.",
    };
  }

  const absolutePath = toAbsolutePath(requestedPath.trim());
  return loadJsonFromFile(absolutePath);
});

ipcMain.handle("json:new-template", (_event, canyonName: string): Record<string, unknown> => {
  return createNewJsonTemplate(canyonName ?? "");
});

ipcMain.handle("json:save", async (_event, request: SaveJsonRequest): Promise<SaveJsonResult> => {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  if (!request || !request.jsonString) {
    throw new Error("No JSON payload was provided.");
  }

  let targetPath = request.currentFilePath?.trim() || "";

  if (targetPath && existsSync(targetPath)) {
    const decision = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Overwrite", "Save As...", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Save Canyon JSON",
      message: `Save changes to ${path.basename(targetPath)}?`,
      detail: "Choose Overwrite to keep the same file path, or Save As to choose a new path.",
    });

    if (decision.response === 2) {
      return { canceled: true };
    }

    if (decision.response === 1) {
      targetPath = "";
    }
  }

  if (!targetPath) {
    const fallbackDir = request.currentFilePath ? path.dirname(request.currentFilePath) : process.cwd();
    const filename = `${sanitizeFileName(request.canyonName ?? "canyon")}.json`;
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: "Save Canyon JSON",
      defaultPath: path.join(fallbackDir, filename),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    targetPath = saveResult.filePath;
  }

  try {
    await writeFile(targetPath, request.jsonString, "utf8");
    return {
      canceled: false,
      filePath: targetPath,
    };
  } catch (error) {
    return {
      canceled: false,
      filePath: targetPath,
      error: toErrorMessage(error),
    };
  }
});

ipcMain.handle("json:pick-file", async (_event, request: PickFileRequest): Promise<PickFileResult> => {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  const openResult = await dialog.showOpenDialog(mainWindow, {
    title: request?.title ?? "Select file",
    properties: ["openFile"],
    filters: request?.filters?.length
      ? request.filters
      : [{ name: "All Files", extensions: ["*"] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const absolutePath = openResult.filePaths[0];
  const baseDir = request?.baseDir && request.baseDir.trim()
    ? toAbsolutePath(request.baseDir)
    : process.cwd();
  const relativePath = toRelativePath(baseDir, absolutePath);

  return {
    canceled: false,
    absolutePath,
    relativePath,
  };
});

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
