import type { EditorRuntime } from "./runtimeTypes";
import { createElectronRuntime } from "./electronRuntime";
import { createWebRuntime } from "./webRuntime";

export function createEditorRuntime(): EditorRuntime {
  return typeof window !== "undefined" && window.api ? createElectronRuntime() : createWebRuntime();
}
