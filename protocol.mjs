import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const CANVAS_SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS = new Set([1, CANVAS_SCHEMA_VERSION]);

export function fail(scope, message) {
  throw new Error(`canvas ${scope}: ${message}`);
}

export function assertSchemaVersion(value, label, scope = "protocol") {
  if (!SUPPORTED_SCHEMA_VERSIONS.has(value)) {
    fail(scope, `${label}.schemaVersion must be 1 or ${CANVAS_SCHEMA_VERSION}`);
  }
}

export function assertId(id, label, scope = "protocol") {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(id)) {
    fail(scope, `${label} must match ^[a-z][a-z0-9-]{2,63}$`);
  }
}

export function localPath(root, relative, label, scope = "protocol") {
  if (typeof relative !== "string" || !relative.trim()) fail(scope, `${label} is required`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (!resolved.startsWith(prefix)) fail(scope, `${label} escapes the canvas directory`);
  return resolved;
}

export function canvasDataPath(root, relative, label, scope = "protocol") {
  if (typeof relative !== "string" || !relative.trim()) fail(scope, `${label} is required`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  const localPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved.startsWith(localPrefix)) return resolved;
  const sharedRoot = path.resolve(resolvedRoot, "..", "_shared");
  const sharedPrefix = sharedRoot.endsWith(path.sep) ? sharedRoot : `${sharedRoot}${path.sep}`;
  if (resolved.startsWith(sharedPrefix)) return resolved;
  fail(scope, `${label} escapes the canvas directory or its _shared sibling`);
}

export async function readJson(root, relative, label, fallback, scope = "protocol") {
  if (!relative) return fallback;
  const source = localPath(root, relative, label, scope);
  try {
    return JSON.parse(await readFile(source, "utf8"));
  } catch (error) {
    fail(scope, `${label} could not be read: ${error.message}`);
  }
}

export async function readCanvasJson(root, relative, label, fallback, scope = "protocol", options = {}) {
  if (!relative) return fallback;
  const source = canvasDataPath(root, relative, label, scope);
  try {
    return JSON.parse(await readFile(source, "utf8"));
  } catch (error) {
    if (options.optional && error.code === "ENOENT") return fallback;
    fail(scope, `${label} could not be read: ${error.message}`);
  }
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(normalize(value));
}

export function sourceHash(parts) {
  const hash = createHash("sha256");
  parts.forEach((part) => {
    hash.update(typeof part === "string" ? part : stableJson(part));
    hash.update("\u0000");
  });
  return `sha256:${hash.digest("hex")}`;
}

export function revisionId(hash) {
  return `revision-${hash.replace(/^sha256:/, "").slice(0, 16)}`;
}

export function frameRevision(frame, content, dependencies = []) {
  return sourceHash([{
    id: frame.id,
    title: frame.title,
    summary: frame.summary,
    kind: frame.kind || "screen",
    tags: frame.tags || [],
    uses: frame.uses || [],
    libraryUses: frame.libraryUses || [],
    source: frame.source,
    width: frame.width,
    height: frame.height
  }, content, ...dependencies]);
}

export async function contextMetrics(root, required, conditional) {
  async function summarize(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    const files = await Promise.all(unique.map(async (relative) => {
      try {
        const info = await stat(canvasDataPath(root, relative, `context path ${relative}`, "context"));
        return { path: relative, bytes: info.size };
      } catch (error) {
        return { path: relative, bytes: null, error: error.message };
      }
    }));
    return {
      fileCount: files.length,
      bytes: files.reduce((sum, file) => sum + (file.bytes || 0), 0),
      files
    };
  }

  return {
    required: await summarize(required),
    conditional: await summarize(conditional)
  };
}

export function migrateManifest(manifest) {
  assertSchemaVersion(manifest.schemaVersion, "canvas", "protocol");
  if (manifest.schemaVersion === CANVAS_SCHEMA_VERSION) return manifest;
  return {
    ...manifest,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    sources: { ...manifest.sources, actions: manifest.sources?.actions || null }
  };
}

export function migrateSidecar(sidecar, kind) {
  assertSchemaVersion(sidecar.schemaVersion, kind, "protocol");
  if (sidecar.schemaVersion === CANVAS_SCHEMA_VERSION) return sidecar;
  return { ...sidecar, schemaVersion: CANVAS_SCHEMA_VERSION };
}
