import { useCallback, useEffect, useMemo, useState } from "react";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type PathSegment = string | number;

const DEFAULT_JSON_PATH = "data/Kobelache/data.json";
const LANGUAGE_KEY_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2})?$/i;

const ROOT_EDITABLE_KEYS = new Set(["name", "description", "location", "sections"]);
const LOCATION_EDITABLE_KEYS = new Set(["country_code", "region_code"]);
const SECTION_EDITABLE_KEYS = new Set([
  "id",
  "name",
  "authors",
  "descriptions",
  "special_notes",
  "difficulties",
  "durations_in_minutes",
  "tour_dimensions_in_meter",
  "max_rappel_in_meter",
  "recommended_ropes",
  "subjective_rating",
  "quality_anchoring",
  "subjective_rating_count",
  "quality_anchoring_count",
  "topo",
]);
const SECTION_DESCRIPTION_KEYS = new Set(["approach", "canyon", "exit"]);
const IGNORED_KEYS = new Set([
  "coordinates",
  "parking_lots",
  "points_of_interest",
  "tracks_access",
  "track_canyon",
  "official_partner",
  "images",
]);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSectionPath(path: PathSegment[]): boolean {
  return path.length === 2 && path[0] === "sections" && typeof path[1] === "number";
}

function isSectionObjectPath(path: PathSegment[]): boolean {
  return path.length >= 2 && path[0] === "sections" && typeof path[1] === "number";
}

function isSectionDescriptionsPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "descriptions"
  );
}

function isLocationPath(path: PathSegment[]): boolean {
  return path.length === 1 && path[0] === "location";
}

function toPathKey(path: PathSegment[]): string {
  if (path.length === 0) {
    return "$";
  }

  let key = typeof path[0] === "number" ? `[${path[0]}]` : String(path[0]);
  for (let index = 1; index < path.length; index += 1) {
    const segment = path[index];
    key += typeof segment === "number" ? `[${segment}]` : `.${segment}`;
  }

  return key;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fileName(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || pathValue;
}

function getDirectoryPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 1) {
    return null;
  }

  return normalized.slice(0, slashIndex);
}

function cloneJsonValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isLanguageObject(value: JsonValue): value is JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }

  for (const key of keys) {
    if (!LANGUAGE_KEY_PATTERN.test(key)) {
      return false;
    }

    if (typeof value[key] !== "string") {
      return false;
    }
  }

  return true;
}

function shouldRenderChild(parentPath: PathSegment[], key: string, value: JsonValue): boolean {
  if (value === null) {
    return false;
  }

  if (IGNORED_KEYS.has(key)) {
    return false;
  }

  if (parentPath.length === 0) {
    return ROOT_EDITABLE_KEYS.has(key);
  }

  if (isLocationPath(parentPath)) {
    return LOCATION_EDITABLE_KEYS.has(key);
  }

  if (isSectionPath(parentPath)) {
    return SECTION_EDITABLE_KEYS.has(key);
  }

  if (isSectionDescriptionsPath(parentPath)) {
    return SECTION_DESCRIPTION_KEYS.has(key);
  }

  return true;
}

function valueAtPath(root: JsonValue, path: PathSegment[]): JsonValue {
  let current: JsonValue = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return null;
      }

      current = current[segment] ?? null;
      continue;
    }

    if (!isJsonObject(current) || !(segment in current)) {
      return null;
    }

    current = current[segment] ?? null;
  }

  return current;
}

function setAtPath(root: JsonValue, path: PathSegment[], nextValue: JsonValue): JsonValue {
  if (path.length === 0) {
    return nextValue;
  }

  const [head, ...rest] = path;
  if (typeof head === "number") {
    const currentArray = Array.isArray(root) ? root : [];
    const clone = currentArray.slice();
    clone[head] = setAtPath(clone[head] ?? null, rest, nextValue);
    return clone;
  }

  const currentObject = isJsonObject(root) ? root : {};
  const clone: JsonObject = { ...currentObject };
  clone[head] = setAtPath(clone[head] ?? null, rest, nextValue);
  return clone;
}

function removeArrayIndex(root: JsonValue, arrayPath: PathSegment[], index: number): JsonValue {
  const currentArray = valueAtPath(root, arrayPath);
  if (!Array.isArray(currentArray) || index < 0 || index >= currentArray.length) {
    return root;
  }

  const clone = currentArray.slice();
  clone.splice(index, 1);
  return setAtPath(root, arrayPath, clone);
}

function defaultFromSample(sample: JsonValue): JsonValue {
  if (sample === null) {
    return "";
  }

  if (typeof sample === "string") {
    return "";
  }

  if (typeof sample === "number") {
    return 0;
  }

  if (typeof sample === "boolean") {
    return false;
  }

  if (Array.isArray(sample)) {
    return [];
  }

  const output: JsonObject = {};
  for (const [key, value] of Object.entries(sample)) {
    output[key] = defaultFromSample(value);
  }
  return output;
}

function createDefaultSection(existingSections: JsonValue[]): JsonObject {
  let maxId = -1;
  for (const section of existingSections) {
    if (isJsonObject(section) && typeof section.id === "number" && Number.isFinite(section.id)) {
      maxId = Math.max(maxId, section.id);
    }
  }

  return {
    id: maxId + 1,
    name: "New Section",
    authors: [],
    descriptions: {
      approach: { en: "" },
      canyon: { en: "" },
      exit: { en: "" },
    },
    special_notes: [],
    difficulties: {
      vertical: 0,
      aquatic: 0,
      general: 0,
    },
    durations_in_minutes: {
      approach_no_shuttle: 0,
      approach_with_shuttle: 0,
      canyon: 0,
      exit_no_shuttle: 0,
      exit_with_shuttle: 0,
    },
    tour_dimensions_in_meter: {
      elevation_start: 0,
      elevation_exit: 0,
      horizontal_length: 0,
    },
    max_rappel_in_meter: 0,
    recommended_ropes: "",
    subjective_rating: 0,
    quality_anchoring: 0,
    subjective_rating_count: 0,
    quality_anchoring_count: 0,
    topo: "",
  };
}

function newArrayItem(path: PathSegment[], arrayValue: JsonValue[]): JsonValue {
  if (path.length === 1 && path[0] === "sections") {
    return createDefaultSection(arrayValue);
  }

  if (arrayValue.length > 0) {
    return defaultFromSample(arrayValue[0]);
  }

  const lastSegment = path[path.length - 1];
  if (lastSegment === "authors" || lastSegment === "special_notes") {
    return "";
  }

  return "";
}

function isTopoPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "topo"
  );
}

function sectionCardTitle(value: JsonValue, index: number): string {
  if (isJsonObject(value) && typeof value.name === "string" && value.name.trim()) {
    return value.name.trim();
  }

  return `Section ${index + 1}`;
}

export function CanyonJsonEditor(): JSX.Element {
  const [canyonData, setCanyonData] = useState<JsonObject | null>(null);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading data/Kobelache/data.json...");
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [languageTabs, setLanguageTabs] = useState<Record<string, string>>({});

  const baseDirectory = useMemo(() => getDirectoryPath(currentFilePath), [currentFilePath]);

  const clearValidationError = useCallback((pathKey: string): void => {
    setValidationErrors((current) => {
      if (!(pathKey in current)) {
        return current;
      }

      const next = { ...current };
      delete next[pathKey];
      return next;
    });
  }, []);

  const setValidationError = useCallback((pathKey: string, message: string): void => {
    setValidationErrors((current) => ({
      ...current,
      [pathKey]: message,
    }));
  }, []);

  const setPathValue = useCallback(
    (path: PathSegment[], nextValue: JsonValue): void => {
      setCanyonData((current) => {
        if (!current) {
          return current;
        }

        const next = setAtPath(current, path, nextValue);
        return isJsonObject(next) ? next : current;
      });

      clearValidationError(toPathKey(path));
    },
    [clearValidationError],
  );

  useEffect(() => {
    let canceled = false;

    async function loadInitialJson(): Promise<void> {
      const result = await window.api.loadJsonFromPath(DEFAULT_JSON_PATH);
      if (canceled) {
        return;
      }

      if (!result.canceled && result.data && isJsonObject(result.data)) {
        setCanyonData(cloneJsonValue(result.data));
        setCurrentFilePath(result.filePath ?? null);
        setStatusMessage(`Loaded ${result.filePath ?? DEFAULT_JSON_PATH}`);
        return;
      }

      const template = await window.api.createNewJsonTemplate("New Canyon");
      if (canceled) {
        return;
      }

      setCanyonData(isJsonObject(template) ? cloneJsonValue(template) : null);
      setCurrentFilePath(null);
      setStatusMessage(
        result.error ? `Could not load default JSON: ${result.error}` : "Started with a new JSON template.",
      );
    }

    void loadInitialJson().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected initialization error.";
      setStatusMessage(message);
    });

    return () => {
      canceled = true;
    };
  }, []);

  const onLoadJson = useCallback(async (): Promise<void> => {
    const result = await window.api.loadJsonFromDialog();
    if (result.canceled) {
      setStatusMessage("Load canceled.");
      return;
    }

    if (result.error) {
      setStatusMessage(`Load failed: ${result.error}`);
      return;
    }

    if (!result.data || !isJsonObject(result.data)) {
      setStatusMessage("Loaded file is not a valid JSON object.");
      return;
    }

    setCanyonData(cloneJsonValue(result.data));
    setCurrentFilePath(result.filePath ?? null);
    setValidationErrors({});
    setInputDrafts({});
    setCollapsedGroups({});
    setLanguageTabs({});
    setStatusMessage(`Loaded ${result.filePath ?? "JSON file"}`);
  }, []);

  const onNewJson = useCallback(async (): Promise<void> => {
    const canyonName = window.prompt("Canyon name", "New Canyon");
    if (canyonName === null) {
      setStatusMessage("New JSON canceled.");
      return;
    }

    const template = await window.api.createNewJsonTemplate(canyonName);
    if (!isJsonObject(template)) {
      setStatusMessage("Could not create JSON template.");
      return;
    }

    setCanyonData(cloneJsonValue(template));
    setCurrentFilePath(null);
    setValidationErrors({});
    setInputDrafts({});
    setCollapsedGroups({});
    setLanguageTabs({});
    setStatusMessage(`Created new JSON: ${canyonName.trim() || "New Canyon"}`);
  }, []);

  const onSaveJson = useCallback(async (): Promise<void> => {
    if (!canyonData) {
      setStatusMessage("Nothing to save.");
      return;
    }

    if (Object.keys(validationErrors).length > 0) {
      setStatusMessage("Resolve validation errors before saving.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await window.api.saveJson({
        currentFilePath,
        jsonString: JSON.stringify(canyonData, null, 2),
        canyonName: typeof canyonData.name === "string" ? canyonData.name : "canyon",
      });

      if (result.canceled) {
        setStatusMessage("Save canceled.");
        return;
      }

      if (result.error) {
        setStatusMessage(`Save failed: ${result.error}`);
        return;
      }

      if (result.filePath) {
        setCurrentFilePath(result.filePath);
      }

      setStatusMessage(`Saved ${result.filePath ?? "JSON file"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected save error.";
      setStatusMessage(message);
    } finally {
      setIsSaving(false);
    }
  }, [canyonData, currentFilePath, validationErrors]);

  const onNumberDraftChange = useCallback(
    (path: PathSegment[], nextText: string): void => {
      const key = toPathKey(path);
      setInputDrafts((current) => ({
        ...current,
        [key]: nextText,
      }));

      if (!nextText.trim()) {
        setValidationError(key, "Number is required.");
        return;
      }

      const parsed = Number(nextText);
      if (!Number.isFinite(parsed)) {
        setValidationError(key, "Must be a valid number.");
        return;
      }

      setPathValue(path, parsed);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue, setValidationError],
  );

  const onTopoFilePick = useCallback(
    async (path: PathSegment[]): Promise<void> => {
      const result = await window.api.pickFile({
        baseDir: baseDirectory,
        title: "Select topo file",
        filters: [{ name: "Topo Images", extensions: ["webp", "png", "jpg", "jpeg"] }],
      });

      if (result.canceled) {
        return;
      }

      setPathValue(path, result.relativePath ?? result.absolutePath ?? "");
    },
    [baseDirectory, setPathValue],
  );

  const renderNode = useCallback(
    (value: JsonValue, path: PathSegment[], label: string): JSX.Element | null => {
      if (value === null) {
        return null;
      }

      const pathKey = toPathKey(path);
      const isCollapsed = collapsedGroups[pathKey] ?? false;
      const validationError = validationErrors[pathKey];

      if (isLanguageObject(value)) {
        const languages = Object.keys(value);
        const activeLanguage =
          languageTabs[pathKey] && languages.includes(languageTabs[pathKey])
            ? languageTabs[pathKey]
            : languages[0] ?? "";

        return (
          <section className="json-card">
            <div className="json-card-header">
              <h3>{titleCase(label)}</h3>
              <div className="json-inline-actions">
                <button
                  type="button"
                  onClick={() => {
                    const rawLanguage = window.prompt("Language key (e.g. en, de, fr)", "");
                    if (!rawLanguage) {
                      return;
                    }

                    const languageKey = rawLanguage.trim().toLowerCase();
                    if (!languageKey) {
                      return;
                    }

                    if (!LANGUAGE_KEY_PATTERN.test(languageKey)) {
                      setStatusMessage("Invalid language key format.");
                      return;
                    }

                    if (languageKey in value) {
                      setStatusMessage(`Language ${languageKey} already exists.`);
                      return;
                    }

                    setPathValue(path, {
                      ...value,
                      [languageKey]: "",
                    });
                    setLanguageTabs((current) => ({
                      ...current,
                      [pathKey]: languageKey,
                    }));
                  }}
                >
                  Add language
                </button>
                <button
                  type="button"
                  className="json-danger-button"
                  disabled={!activeLanguage}
                  onClick={() => {
                    if (!activeLanguage) {
                      return;
                    }

                    const nextObject = { ...value };
                    delete nextObject[activeLanguage];

                    setPathValue(path, nextObject);
                    const remaining = Object.keys(nextObject);
                    setLanguageTabs((current) => ({
                      ...current,
                      [pathKey]: remaining[0] ?? "",
                    }));
                  }}
                >
                  Remove language
                </button>
              </div>
            </div>

            <div className="json-language-tabs">
              {languages.map((language) => (
                <button
                  type="button"
                  key={language}
                  className={`json-language-tab${activeLanguage === language ? " active" : ""}`}
                  onClick={() =>
                    setLanguageTabs((current) => ({
                      ...current,
                      [pathKey]: language,
                    }))
                  }
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>

            {activeLanguage ? (
              <div className="json-language-content">
                <textarea
                  value={String(value[activeLanguage] ?? "")}
                  rows={4}
                  onChange={(event) => setPathValue([...path, activeLanguage], event.target.value)}
                />
              </div>
            ) : (
              <p className="json-empty-text">No language entries.</p>
            )}
          </section>
        );
      }

      if (Array.isArray(value)) {
        return (
          <section className="json-card">
            <div className="json-card-header">
              <button
                type="button"
                className="json-collapse-button"
                onClick={() =>
                  setCollapsedGroups((current) => ({
                    ...current,
                    [pathKey]: !isCollapsed,
                  }))
                }
              >
                {isCollapsed ? "+" : "-"} {titleCase(label)} ({value.length})
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextItem = newArrayItem(path, value);
                  setPathValue(path, [...value, nextItem]);
                }}
              >
                + Add new element
              </button>
            </div>

            {!isCollapsed ? (
              <div className="json-array-body">
                {value.length === 0 ? <p className="json-empty-text">No elements.</p> : null}
                {value.map((item, index) => {
                  if (item === null) {
                    return null;
                  }

                  const itemPath = [...path, index];
                  const itemPathKey = toPathKey(itemPath);
                  const itemCollapsed = collapsedGroups[itemPathKey] ?? false;
                  const itemTitle = isSectionPath(itemPath)
                    ? sectionCardTitle(item, index)
                    : `Element ${index + 1}`;

                  return (
                    <article key={itemPathKey} className="json-array-item">
                      <div className="json-array-item-header">
                        <button
                          type="button"
                          className="json-collapse-button"
                          onClick={() =>
                            setCollapsedGroups((current) => ({
                              ...current,
                              [itemPathKey]: !itemCollapsed,
                            }))
                          }
                        >
                          {itemCollapsed ? "+" : "-"} {itemTitle}
                        </button>
                        <button
                          type="button"
                          className="json-danger-button"
                          onClick={() =>
                            setCanyonData((current) => {
                              if (!current) {
                                return current;
                              }
                              const next = removeArrayIndex(current, path, index);
                              return isJsonObject(next) ? next : current;
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>

                      {!itemCollapsed ? (
                        <div className="json-array-item-content">{renderNode(item, itemPath, itemTitle)}</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      }

      if (isJsonObject(value)) {
        const entries = Object.entries(value).filter(([key, child]) =>
          shouldRenderChild(path, key, child),
        );

        if (entries.length === 0 && path.length > 0) {
          return null;
        }

        return (
          <section className="json-card">
            {path.length > 0 ? (
              <div className="json-card-header">
                <button
                  type="button"
                  className="json-collapse-button"
                  onClick={() =>
                    setCollapsedGroups((current) => ({
                      ...current,
                      [pathKey]: !isCollapsed,
                    }))
                  }
                >
                  {isCollapsed ? "+" : "-"} {titleCase(label)}
                </button>
              </div>
            ) : null}

            {!isCollapsed ? (
              <div className="json-object-body">
                {entries.map(([key, child]) => (
                  <div className="json-field-row" key={`${pathKey}.${key}`}>
                    {renderNode(child, [...path, key], key)}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      }

      if (typeof value === "number") {
        const draftValue = inputDrafts[pathKey] ?? String(value);
        return (
          <div className="json-input-field">
            <label htmlFor={`field-${pathKey}`}>{titleCase(label)}</label>
            <input
              id={`field-${pathKey}`}
              type="number"
              value={draftValue}
              onChange={(event) => onNumberDraftChange(path, event.target.value)}
              onBlur={() =>
                setInputDrafts((current) => {
                  if (!(pathKey in current)) {
                    return current;
                  }

                  const next = { ...current };
                  delete next[pathKey];
                  return next;
                })
              }
            />
            {validationError ? <p className="json-inline-error">{validationError}</p> : null}
          </div>
        );
      }

      if (typeof value === "boolean") {
        return (
          <div className="json-input-field">
            <label className="json-checkbox-label" htmlFor={`field-${pathKey}`}>
              <input
                id={`field-${pathKey}`}
                type="checkbox"
                checked={value}
                onChange={(event) => setPathValue(path, event.target.checked)}
              />
              <span>{titleCase(label)}</span>
            </label>
          </div>
        );
      }

      if (isTopoPath(path)) {
        return (
          <div className="json-input-field">
            <label>{titleCase(label)}</label>
            <div className="json-topo-picker">
              <button type="button" onClick={() => void onTopoFilePick(path)}>
                Select topo file
              </button>
              <span title={value}>{fileName(value)}</span>
            </div>
          </div>
        );
      }

      return (
        <div className="json-input-field">
          <label htmlFor={`field-${pathKey}`}>{titleCase(label)}</label>
          {value.length > 120 || /description/i.test(label) ? (
            <textarea
              id={`field-${pathKey}`}
              rows={4}
              value={value}
              onChange={(event) => setPathValue(path, event.target.value)}
            />
          ) : (
            <input
              id={`field-${pathKey}`}
              type="text"
              value={value}
              onChange={(event) => setPathValue(path, event.target.value)}
            />
          )}
        </div>
      );
    },
    [
      collapsedGroups,
      languageTabs,
      onNumberDraftChange,
      onTopoFilePick,
      setPathValue,
      validationErrors,
      inputDrafts,
      setStatusMessage,
    ],
  );

  return (
    <div className="json-editor-shell">
      <header className="json-toolbar">
        <div className="json-toolbar-buttons">
          <button type="button" onClick={() => void onLoadJson()}>
            Load JSON
          </button>
          <button type="button" onClick={() => void onNewJson()}>
            New JSON
          </button>
          <button type="button" disabled={!canyonData || isSaving} onClick={() => void onSaveJson()}>
            {isSaving ? "Saving..." : "Save JSON"}
          </button>
        </div>
        <p className="json-status">{statusMessage}</p>
      </header>

      <section className="json-editor-body">
        {canyonData ? (
          <>
            <div className="json-file-path">{currentFilePath ?? "Unsaved JSON"}</div>
            {renderNode(canyonData, [], "Canyon")}
          </>
        ) : (
          <div className="json-empty-text">No JSON loaded.</div>
        )}
      </section>
    </div>
  );
}
