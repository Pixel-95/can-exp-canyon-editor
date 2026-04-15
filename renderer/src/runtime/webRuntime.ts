import type { EditorRuntime } from "./runtimeTypes";
import {
  createNewWebWorkspace,
  generateWorkspaceZipBytes,
  loadTrackFilesFromWebWorkspace,
  loadWebWorkspaceFromZipData,
  saveWebWorkspace,
  type WebWorkspace,
} from "./webWorkspace";

function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const blob = new Blob([payload], {
    type: "application/zip",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickZipFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.multiple = false;
    input.style.display = "none";
    let settled = false;
    let focusFallbackTimeout: number | null = null;

    const cleanup = (): void => {
      if (focusFallbackTimeout !== null) {
        window.clearTimeout(focusFallbackTimeout);
        focusFallbackTimeout = null;
      }

      window.removeEventListener("focus", handleWindowFocus);
      input.remove();
    };

    const finish = (file: File | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(file);
    };

    const handleWindowFocus = (): void => {
      focusFallbackTimeout = window.setTimeout(() => {
        finish(input.files?.[0] ?? null);
      }, 250);
    };

    input.addEventListener(
      "change",
      () => {
        finish(input.files?.[0] ?? null);
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        finish(null);
      },
      { once: true },
    );
    window.addEventListener("focus", handleWindowFocus, { once: true });
    document.body.appendChild(input);
    window.requestAnimationFrame(() => {
      input.click();
    });
  });
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function createWebRuntime(): EditorRuntime {
  let workspace: WebWorkspace | null = null;

  return {
    kind: "web",
    async getMapboxToken() {
      return import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
    },
    copyTextToClipboard,
    async loadStaticJsonAsset(assetPath) {
      const response = await fetch(assetPath, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Could not load ${assetPath}.`);
      }

      return response.json();
    },
    async openCanyonSource() {
      const file = await pickZipFile();
      if (!file) {
        return { canceled: true };
      }

      if (!file.name.toLowerCase().endsWith(".zip")) {
        return {
          canceled: false,
          error: "Only canyon ZIP files are supported in the web editor.",
        };
      }

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const loaded = await loadWebWorkspaceFromZipData(bytes);
        workspace = loaded.workspace;
        return {
          canceled: false,
          data: loaded.data,
          filePath: loaded.filePath,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Could not load canyon ZIP.";
        return {
          canceled: false,
          error: `Could not import "${file.name}": ${errorMessage}`,
        };
      }
    },
    async createNewCanyonWorkspace(request) {
      const loaded = createNewWebWorkspace(request);
      workspace = loaded.workspace;
      return {
        canceled: false,
        data: loaded.data,
        filePath: loaded.filePath,
        folderPath: loaded.workspace.folderName,
      };
    },
    async saveCanyonWorkspace(request) {
      if (!workspace) {
        return {
          canceled: false,
          error: "Create or load a canyon first.",
        };
      }

      try {
        const saved = saveWebWorkspace({
          workspace,
          canyonData: request.canyonData,
          canyonName: request.canyonName,
          trackSnapshot: request.trackSnapshot,
          forceNullTopos: request.forceNullTopos,
        });
        workspace = saved.workspace;
        const zipBytes = await generateWorkspaceZipBytes(saved.workspace);
        downloadBytes(saved.downloadedFileName, zipBytes);
        return {
          canceled: false,
          filePath: saved.filePath,
          warnings: saved.warnings,
          data: saved.data,
          downloadedFileName: saved.downloadedFileName,
        };
      } catch (error) {
        return {
          canceled: false,
          error: error instanceof Error ? error.message : "Could not save canyon ZIP.",
        };
      }
    },
    async pickFile() {
      return {
        canceled: true,
      };
    },
    async loadTrackFiles(request) {
      return loadTrackFilesFromWebWorkspace(workspace, request);
    },
  };
}
