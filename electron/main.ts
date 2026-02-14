import "dotenv/config";

import { Menu, app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

type SaveGeoJSONResult = {
  canceled: boolean;
  filePath?: string;
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
