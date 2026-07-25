import { assertId, fail, sourceHash } from "./protocol.mjs";

const FOUNDATION_KINDS = new Set(["color", "typography", "spacing", "radius", "shadow", "motion", "icon", "other"]);
const PROP_TYPES = new Set(["enum", "boolean", "string", "number"]);
const SAFE_ELEMENTS = new Set(["button", "input", "select", "textarea", "a", "div", "section", "article", "span", "label"]);

function libraryFail(message, scope = "library") {
  fail(scope, message);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) libraryFail(`${label} is required`);
}

function optionalStrings(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) libraryFail(`${label} must be an array of strings`);
  return value;
}

function valueAtPath(value, sourcePath) {
  if (!sourcePath) return null;
  return sourcePath.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function validateProps(props, label) {
  if (!props || typeof props !== "object" || Array.isArray(props)) libraryFail(`${label} must be an object`);
  Object.entries(props).forEach(([name, definition]) => {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) libraryFail(`${label}.${name} has an invalid prop name`);
    if (!definition || typeof definition !== "object" || !PROP_TYPES.has(definition.type)) libraryFail(`${label}.${name}.type is invalid`);
    requiredText(definition.description, `${label}.${name}.description`);
    if (definition.type === "enum") {
      if (!Array.isArray(definition.values) || !definition.values.length || definition.values.some((item) => typeof item !== "string")) libraryFail(`${label}.${name}.values must be a non-empty string array`);
      if (definition.default != null && !definition.values.includes(definition.default)) libraryFail(`${label}.${name}.default must be one of its values`);
    }
    if (definition.default != null && definition.type === "boolean" && typeof definition.default !== "boolean") libraryFail(`${label}.${name}.default must be boolean`);
    if (definition.default != null && definition.type === "string" && typeof definition.default !== "string") libraryFail(`${label}.${name}.default must be a string`);
    if (definition.default != null && definition.type === "number" && !Number.isFinite(definition.default)) libraryFail(`${label}.${name}.default must be a number`);
  });
}

function validatePreview(preview, element, label) {
  if (preview == null) return;
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) libraryFail(`${label} must be an object`);
  if (preview.tag != null && (preview.tag !== element || !SAFE_ELEMENTS.has(preview.tag))) libraryFail(`${label}.tag must match the component element`);
  if (preview.className != null && typeof preview.className !== "string") libraryFail(`${label}.className must be a string`);
  if (preview.attributes != null) {
    if (!preview.attributes || typeof preview.attributes !== "object" || Array.isArray(preview.attributes)) libraryFail(`${label}.attributes must be an object`);
    Object.entries(preview.attributes).forEach(([name, value]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9:-]*$/.test(name) || /^on/i.test(name)) libraryFail(`${label}.attributes.${name} is unsafe`);
      if (!["string", "number", "boolean"].includes(typeof value)) libraryFail(`${label}.attributes.${name} must be scalar`);
    });
  }
}

function validateStory(story, component, label) {
  assertId(story.id, `${label}.id`, "library");
  requiredText(story.title, `${label}.title`);
  const props = story.props || {};
  Object.entries(props).forEach(([name, value]) => {
    const definition = component.contract.props[name];
    if (!definition) libraryFail(`${label}.props.${name} is not declared by ${component.id}`);
    if (definition.type === "enum" && !definition.values.includes(value)) libraryFail(`${label}.props.${name} is not an allowed value`);
    if (definition.type === "boolean" && typeof value !== "boolean") libraryFail(`${label}.props.${name} must be boolean`);
    if (definition.type === "number" && !Number.isFinite(value)) libraryFail(`${label}.props.${name} must be a number`);
    if (definition.type === "string" && typeof value !== "string") libraryFail(`${label}.props.${name} must be a string`);
  });
  validatePreview(story.preview, component.contract.element, `${label}.preview`);
}

export function prepareLibrary(data, canvasId, tokensData) {
  if (!data) return null;
  if (data.schemaVersion !== 2) libraryFail("schemaVersion must be 2");
  if (data.canvasId !== canvasId) libraryFail("canvasId does not match canvas.id");
  if (!data.library || typeof data.library !== "object") libraryFail("library object is required");
  assertId(data.library.id, "library.id", "library");
  requiredText(data.library.title, "library.title");
  requiredText(data.library.version, "library.version");
  requiredText(data.library.description, "library.description");

  const foundations = Array.isArray(data.foundations) ? data.foundations : [];
  const layouts = Array.isArray(data.layouts) ? data.layouts : [];
  const components = Array.isArray(data.components) ? data.components : [];
  const targetIds = new Set([data.library.id]);
  function uniqueId(id, label) {
    assertId(id, label, "library");
    if (targetIds.has(id)) libraryFail(`duplicate library target id: ${id}`);
    targetIds.add(id);
  }

  const resolvedFoundations = foundations.map((foundation, index) => {
    uniqueId(foundation.id, `foundations[${index}].id`);
    requiredText(foundation.title, `foundations[${index}].title`);
    requiredText(foundation.description, `foundations[${index}].description`);
    if (!FOUNDATION_KINDS.has(foundation.kind)) libraryFail(`foundations[${index}].kind is invalid`);
    requiredText(foundation.tokenPath, `foundations[${index}].tokenPath`);
    const resolved = valueAtPath(tokensData?.tokens, foundation.tokenPath);
    if (resolved == null) libraryFail(`foundations[${index}].tokenPath does not resolve: ${foundation.tokenPath}`);
    return { ...foundation, guidance: optionalStrings(foundation.guidance, `foundations[${index}].guidance`), resolved };
  });

  layouts.forEach((layout, index) => {
    uniqueId(layout.id, `layouts[${index}].id`);
    requiredText(layout.title, `layouts[${index}].title`);
    requiredText(layout.description, `layouts[${index}].description`);
    requiredText(layout.className, `layouts[${index}].className`);
    if (!layout.properties || typeof layout.properties !== "object" || Array.isArray(layout.properties)) libraryFail(`layouts[${index}].properties must be an object`);
    optionalStrings(layout.slots, `layouts[${index}].slots`);
    optionalStrings(layout.guidance, `layouts[${index}].guidance`);
  });

  components.forEach((component, index) => {
    uniqueId(component.id, `components[${index}].id`);
    requiredText(component.name, `components[${index}].name`);
    requiredText(component.description, `components[${index}].description`);
    if (!component.contract || typeof component.contract !== "object") libraryFail(`components[${index}].contract is required`);
    if (!SAFE_ELEMENTS.has(component.contract.element)) libraryFail(`components[${index}].contract.element is unsupported`);
    requiredText(component.contract.className, `components[${index}].contract.className`);
    validateProps(component.contract.props || {}, `components[${index}].contract.props`);
    optionalStrings(component.contract.slots, `components[${index}].contract.slots`);
    optionalStrings(component.contract.events, `components[${index}].contract.events`);
    const states = optionalStrings(component.contract.states, `components[${index}].contract.states`);
    if (!states.includes("default")) libraryFail(`components[${index}].contract.states must include default`);
    const componentTokens = optionalStrings(component.contract.tokens, `components[${index}].contract.tokens`);
    componentTokens.forEach((token) => {
      if (valueAtPath(tokensData?.tokens, token) == null) libraryFail(`components[${index}] references unknown token ${token}`);
    });
    optionalStrings(component.accessibility, `components[${index}].accessibility`);
    optionalStrings(component.guidance?.use, `components[${index}].guidance.use`);
    optionalStrings(component.guidance?.avoid, `components[${index}].guidance.avoid`);
    validatePreview(component.preview, component.contract.element, `components[${index}].preview`);
    (component.stories || []).forEach((story, storyIndex) => {
      uniqueId(story.id, `components[${index}].stories[${storyIndex}].id`);
      validateStory(story, component, `components[${index}].stories[${storyIndex}]`);
    });
  });

  return {
    schemaVersion: 2,
    canvasId,
    library: data.library,
    foundations: resolvedFoundations,
    layouts,
    components
  };
}

export function libraryTargets(library) {
  if (!library) return [];
  const targets = [{ type: "library", value: library.library }];
  library.foundations.forEach((value) => targets.push({ type: "foundation", value }));
  library.layouts.forEach((value) => targets.push({ type: "layout", value }));
  library.components.forEach((component) => {
    targets.push({ type: "component", value: component });
    (component.stories || []).forEach((story) => targets.push({ type: "story", value: { ...story, componentId: component.id } }));
  });
  return targets;
}

export function libraryTarget(library, targetId) {
  return libraryTargets(library).find((target) => target.value.id === targetId) || null;
}

export function libraryHashes(library) {
  return Object.fromEntries(libraryTargets(library).map((target) => [target.value.id, sourceHash([target.value])]));
}
