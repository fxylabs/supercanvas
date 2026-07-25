#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import {
  CANVAS_SCHEMA_VERSION,
  assertId,
  assertSchemaVersion,
  fail,
  frameRevision,
  localPath,
  migrateManifest,
  migrateSidecar,
  readJson,
  revisionId,
  sourceHash,
  stableJson
} from "./protocol.mjs";
import { libraryHashes, libraryTargets, prepareLibrary } from "./library.mjs";
import { loadRules, ruleHashes } from "./rules.mjs";

function argsOf(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--in" || key === "--out") args[key.slice(2)] = argv[index += 1];
  }
  return args;
}

function renderFail(message) {
  fail("render", message);
}

function numberIn(value, fallback, min, max, label) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isFinite(result) || result < min || result > max) renderFail(`${label} is out of range`);
  return result;
}

function flattenTokens(value, prefix, result) {
  Object.entries(value || {}).forEach(([key, child]) => {
    const next = prefix ? `${prefix}-${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenTokens(child, next, result);
      return;
    }
    if (typeof child !== "string" && typeof child !== "number") renderFail(`token ${next} must be a string or number`);
    result[next] = String(child);
  });
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function invalidFrameContent(frame, message) {
  return `<div class="canvas-invalid-target" role="alert"><strong>${escapeHtml(frame.title || frame.id)}</strong><span>${escapeHtml(message)}</span></div>`;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!args.in || !args.out) renderFail("usage: render.mjs --in canvas.json --out canvas.html");

  const input = path.resolve(args.in);
  const output = path.resolve(args.out);
  const root = path.dirname(input);
  const kitRoot = path.dirname(fileURLToPath(import.meta.url));
  const rawManifest = JSON.parse(await readFile(input, "utf8"));
  const data = migrateManifest(rawManifest);
  const diagnostics = [];

  if (!data.canvas || typeof data.canvas !== "object") renderFail("canvas object is required");
  assertId(data.canvas.id, "canvas.id", "render");
  if (typeof data.canvas.title !== "string" || !data.canvas.title.trim()) renderFail("canvas.title is required");
  if (typeof data.canvas.version !== "string" || !data.canvas.version.trim()) renderFail("canvas.version is required");
  if (!Array.isArray(data.frames) || data.frames.length === 0) renderFail("at least one frame is required");

  const sourceRefs = data.sources || {};
  const relationsData = migrateSidecar(await readJson(root, sourceRefs.relations, "sources.relations", {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    canvasId: data.canvas.id,
    groups: data.groups || [],
    connections: data.connections || []
  }, "render"), "relations");
  const actionsData = migrateSidecar(await readJson(root, sourceRefs.actions, "sources.actions", {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    canvasId: data.canvas.id,
    actions: data.actions || []
  }, "render"), "actions");
  const notesData = migrateSidecar(await readJson(root, sourceRefs.notes, "sources.notes", {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    canvasId: data.canvas.id,
    notes: data.notes || []
  }, "render"), "notes");
  const feedbackData = migrateSidecar(await readJson(root, sourceRefs.feedback, "sources.feedback", {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    canvasId: data.canvas.id,
    canvasVersion: data.canvas.version,
    comments: []
  }, "render"), "feedback");
  const tokensData = await readJson(root, sourceRefs.tokens, "sources.tokens", null, "render");
  const libraryData = await readJson(root, sourceRefs.library, "sources.library", null, "render");
  const library = prepareLibrary(libraryData, data.canvas.id, tokensData);
  const loadedRules = await loadRules(root, sourceRefs.rules, "render");
  const rules = loadedRules.value;

  [relationsData, actionsData, notesData, feedbackData].forEach((sidecar, index) => {
    if (sidecar.canvasId !== data.canvas.id) renderFail(`sidecar[${index}].canvasId does not match canvas.id`);
  });
  if (feedbackData.canvasVersion !== data.canvas.version) renderFail("feedback.canvasVersion does not match canvas.version");
  const feedbackRevision = feedbackData.feedbackRevision == null ? 1 : feedbackData.feedbackRevision;
  if (!Number.isInteger(feedbackRevision) || feedbackRevision < 1) renderFail("feedback.feedbackRevision must be an integer greater than 0");
  const review = feedbackData.review || { id: "review-legacy", status: "active", createdAt: null };
  assertId(review.id, "feedback.review.id", "render");
  if (!["active", "completed"].includes(review.status)) renderFail("feedback.review.status must be active or completed");
  if (feedbackData.archive != null && !Array.isArray(feedbackData.archive)) renderFail("feedback.archive must be an array");

  const targetTypes = new Map();
  function registerTarget(id, type, label) {
    assertId(id, label, "render");
    if (targetTypes.has(id)) renderFail(`duplicate target id: ${id} (${targetTypes.get(id)} and ${type})`);
    targetTypes.set(id, type);
  }
  registerTarget(data.canvas.id, "canvas", "canvas.id");
  libraryTargets(library).forEach((target) => registerTarget(target.value.id, target.type, `${target.type}.id`));
  (rules?.rules || []).forEach((rule, index) => registerTarget(rule.id, "rule", `rules[${index}].id`));
  const libraryTargetTypes = new Set(["library", "foundation", "layout", "component", "story"]);
  const libraryDefinitions = new Map(libraryTargets(library).map((target) => [target.value.id, target.value]));
  const libraryComponentIds = new Set((library?.components || []).map((component) => component.id));

  const frames = [];
  for (let index = 0; index < data.frames.length; index += 1) {
    const frame = data.frames[index];
    registerTarget(frame.id, "frame", `frames[${index}].id`);
    if (typeof frame.title !== "string" || !frame.title.trim()) renderFail(`frames[${index}].title is required`);
    if (typeof frame.summary !== "string" || !frame.summary.trim()) renderFail(`frames[${index}].summary is required for selective routing`);
    let content;
    let invalid = false;
    try {
      const sourcePath = localPath(root, frame.source, `frames[${index}].source`, "render");
      content = await readFile(sourcePath, "utf8");
      if (/<(?:script|style)\b/i.test(content)) throw new Error("frame fragments must be markup-only");
    } catch (error) {
      invalid = true;
      diagnostics.push({ level: "error", code: "invalid-frame-source", target: { type: "frame", id: frame.id }, source: frame.source, message: error.message });
      content = invalidFrameContent(frame, error.message);
    }
    frames.push({
      id: frame.id,
      title: frame.title,
      summary: frame.summary,
      kind: frame.kind || "screen",
      tags: Array.isArray(frame.tags) ? frame.tags : [],
      uses: Array.isArray(frame.uses) ? frame.uses : [],
      libraryUses: Array.isArray(frame.libraryUses) ? frame.libraryUses : [],
      source: frame.source,
      width: numberIn(frame.width, 390, 240, 2400, `frames[${index}].width`),
      height: numberIn(frame.height, 720, 320, 2400, `frames[${index}].height`),
      x: frame.x == null ? null : numberIn(frame.x, 0, 0, 100000, `frames[${index}].x`),
      y: frame.y == null ? null : numberIn(frame.y, 0, 0, 100000, `frames[${index}].y`),
      invalid,
      content
    });
  }

  frames.forEach((frame, index) => {
    frame.libraryUses.forEach((targetId) => {
      if (!libraryDefinitions.has(targetId)) renderFail(`frames[${index}].libraryUses references unknown library target ${targetId}`);
    });
    const declared = new Set(frame.libraryUses);
    const componentRefs = [...frame.content.matchAll(/\bdata-ui=(?:"([^"]+)"|'([^']+)')/g)].map((match) => match[1] || match[2]);
    componentRefs.forEach((componentId) => {
      if (!libraryComponentIds.has(componentId)) renderFail(`Frame ${frame.id} uses unknown data-ui component ${componentId}`);
      if (!declared.has(componentId)) renderFail(`Frame ${frame.id} must declare ${componentId} in libraryUses`);
    });
  });

  const frameIds = new Set(frames.map((frame) => frame.id));
  const groups = Array.isArray(relationsData.groups) ? relationsData.groups : [];
  groups.forEach((group, index) => {
    registerTarget(group.id, "group", `groups[${index}].id`);
    if (!Array.isArray(group.members)) renderFail(`groups[${index}].members must be an array`);
    group.members.forEach((member) => {
      if (!frameIds.has(member)) renderFail(`groups[${index}] references unknown frame ${member}`);
    });
  });

  const connections = Array.isArray(relationsData.connections) ? relationsData.connections : [];
  const connectionIds = new Set();
  connections.forEach((connection, index) => {
    registerTarget(connection.id, "connection", `connections[${index}].id`);
    connectionIds.add(connection.id);
    if (!frameIds.has(connection.from) || !frameIds.has(connection.to)) renderFail(`connections[${index}] references an unknown frame`);
  });

  const actions = Array.isArray(actionsData.actions) ? actionsData.actions : [];
  const actionIds = new Set();
  actions.forEach((action, index) => {
    registerTarget(action.id, "action", `actions[${index}].id`);
    actionIds.add(action.id);
    if (!action.from || !frameIds.has(action.from.frameId)) renderFail(`actions[${index}].from.frameId is unknown`);
    if (action.from.anchor !== action.id) renderFail(`actions[${index}].from.anchor must equal its stable action id`);
    if (!["click", "hover", "scroll", "input"].includes(action.trigger)) renderFail(`actions[${index}].trigger is unsupported`);
    if (action.outcome?.type === "frame" && !frameIds.has(action.outcome.frameId)) renderFail(`actions[${index}].outcome.frameId is unknown`);
    if (action.connectionId && !connectionIds.has(action.connectionId)) renderFail(`actions[${index}].connectionId is unknown`);
    const sourceFrame = frames.find((frame) => frame.id === action.from.frameId);
    if (sourceFrame && !sourceFrame.invalid && !sourceFrame.content.includes(`data-action="${action.id}"`) && !sourceFrame.content.includes(`data-action='${action.id}'`)) {
      diagnostics.push({ level: "error", code: "missing-action-anchor", target: { type: "action", id: action.id }, source: sourceFrame.source, message: `No data-action anchor for ${action.id}` });
    }
  });

  const ports = new Set(["top", "right", "bottom", "left"]);
  connections.forEach((connection, index) => {
    if (!connection.route) return;
    if (connection.route.type !== "orthogonal") renderFail(`connections[${index}].route.type must be orthogonal`);
    const fromAnchor = connection.route.from;
    const toAnchor = connection.route.to;
    if (!fromAnchor || fromAnchor.type !== "action" || !actionIds.has(fromAnchor.id)) renderFail(`connections[${index}].route.from must reference an Action`);
    if (!toAnchor || toAnchor.type !== "frame" || !frameIds.has(toAnchor.id)) renderFail(`connections[${index}].route.to must reference a Frame`);
    if (!ports.has(fromAnchor.port) || !ports.has(toAnchor.port)) renderFail(`connections[${index}] route ports must be top, right, bottom or left`);
    const routeAction = actions.find((action) => action.id === fromAnchor.id);
    if (routeAction.from.frameId !== connection.from) renderFail(`connections[${index}].route.from Action belongs to another Frame`);
    if (routeAction.connectionId !== connection.id) renderFail(`connections[${index}] and Action connectionId do not match`);
    if (toAnchor.id !== connection.to) renderFail(`connections[${index}].route.to must match connection.to`);
    if (connection.route.lane != null && (!Number.isInteger(connection.route.lane) || Math.abs(connection.route.lane) > 20)) renderFail(`connections[${index}].route.lane is invalid`);
  });

  const notes = Array.isArray(notesData.notes) ? notesData.notes : [];
  notes.forEach((note, index) => registerTarget(note.id, "note", `notes[${index}].id`));
  notes.forEach((note, index) => {
    if (!note.target || !targetTypes.has(note.target.id)) renderFail(`notes[${index}] has an unknown target`);
    if (note.target.type !== targetTypes.get(note.target.id)) renderFail(`notes[${index}] target type does not match target id`);
    if (libraryTargetTypes.has(note.target.type)) renderFail(`notes[${index}] Library targets are not yet supported by Planning Note view`);
    if (note.target.type === "rule") renderFail(`notes[${index}] Rule targets are not supported by Planning Note view`);
    if (typeof note.text !== "string" || !note.text.trim()) renderFail(`notes[${index}].text is required`);
  });

  let canvasStyles = "";
  const designSources = new Map();
  if (tokensData) {
    assertSchemaVersion(tokensData.schemaVersion, "tokens", "render");
    const prefix = tokensData.prefix || "ss";
    if (!/^[a-z][a-z0-9-]*$/.test(prefix)) renderFail("tokens.prefix is invalid");
    const tokens = {};
    flattenTokens(tokensData.tokens, "", tokens);
    const tokenText = stableJson(tokensData);
    designSources.set(sourceRefs.tokens, tokenText);
    canvasStyles += `\n:root {\n${Object.entries(tokens).map(([key, value]) => `  --${prefix}-${key}: ${value};`).join("\n")}\n}\n`;
  }
  const styleParts = [];
  for (const [index, relative] of (Array.isArray(data.styles) ? data.styles : []).entries()) {
    const stylePath = localPath(root, relative, `styles[${index}]`, "render");
    const style = await readFile(stylePath, "utf8");
    if (/<\/style/i.test(style)) renderFail(`styles[${index}] contains a closing style tag`);
    designSources.set(relative, style);
    styleParts.push(style);
    canvasStyles += `\n/* canvas style: ${relative} */\n${style}\n`;
  }

  const targetHashes = {};
  frames.forEach((frame) => {
    targetHashes[frame.id] = frameRevision(frame, frame.content, [
      ...frame.uses.map((use) => designSources.get(use) || `missing:${use}`),
      ...frame.libraryUses.map((use) => stableJson(libraryDefinitions.get(use)))
    ]);
  });
  groups.forEach((group) => { targetHashes[group.id] = sourceHash([group]); });
  connections.forEach((connection) => { targetHashes[connection.id] = sourceHash([connection]); });
  actions.forEach((action) => { targetHashes[action.id] = sourceHash([action]); });
  notes.forEach((note) => { targetHashes[note.id] = sourceHash([note]); });
  Object.assign(targetHashes, libraryHashes(library));
  Object.assign(targetHashes, ruleHashes(rules));

  const packageHash = sourceHash([
    { ...data, sources: { ...sourceRefs, feedback: undefined }, frames: data.frames },
    relationsData,
    actionsData,
    notesData,
    tokensData || {},
    libraryData || {},
    rules || {},
    ...styleParts,
    ...frames.map((frame) => frame.content)
  ]);
  targetHashes[data.canvas.id] = packageHash;

  const comments = Array.isArray(feedbackData.comments) ? feedbackData.comments : [];
  comments.forEach((comment, index) => {
    if (!comment.target || !targetTypes.has(comment.target.id)) renderFail(`comments[${index}] has an unknown target`);
    if (targetTypes.get(comment.target.id) === "comment") renderFail(`comments[${index}] cannot target another comment`);
    if (libraryTargetTypes.has(comment.target.type)) renderFail(`comments[${index}] Library targets are not yet supported by Comment view`);
    if (comment.target.type === "rule") renderFail(`comments[${index}] Rule targets are not supported by Comment view`);
    registerTarget(comment.id, "comment", `comments[${index}].id`);
    if (comment.target.type !== targetTypes.get(comment.target.id)) renderFail(`comments[${index}] target type does not match target id`);
    if (!["open", "discussion", "resolved"].includes(comment.status)) renderFail(`comments[${index}].status must be open, discussion or resolved`);
    if (typeof comment.text !== "string" || !comment.text.trim()) renderFail(`comments[${index}].text is required`);
    const messageIds = new Set();
    (comment.thread || []).forEach((message, messageIndex) => {
      assertId(message.id, `comments[${index}].thread[${messageIndex}].id`, "render");
      if (messageIds.has(message.id)) renderFail(`comments[${index}] has a duplicate thread message id`);
      messageIds.add(message.id);
      if (!message.author || !["user", "agent"].includes(message.author.type) || typeof message.author.label !== "string") renderFail(`comments[${index}].thread[${messageIndex}].author is invalid`);
      if (typeof message.text !== "string" || !message.text.trim()) renderFail(`comments[${index}].thread[${messageIndex}].text is required`);
      if (typeof message.createdAt !== "string" || !message.createdAt) renderFail(`comments[${index}].thread[${messageIndex}].createdAt is required`);
    });
    if (comment.status === "discussion" && !(comment.thread || []).some((message) => message.author.type === "agent")) renderFail(`comments[${index}] discussion requires an Agent question`);
    if (comment.resolution) {
      if (typeof comment.resolution.summary !== "string" || !comment.resolution.summary.trim()) renderFail(`comments[${index}].resolution.summary is required`);
      if (comment.resolution.changes != null && !Array.isArray(comment.resolution.changes)) renderFail(`comments[${index}].resolution.changes must be an array`);
    }
    if (comment.ruleProposal) {
      const proposal = comment.ruleProposal;
      if (!["proposed", "approved", "rejected"].includes(proposal.status)) renderFail(`comments[${index}].ruleProposal.status is invalid`);
      if (typeof proposal.statement !== "string" || !proposal.statement.trim()) renderFail(`comments[${index}].ruleProposal.statement is required`);
      if (typeof proposal.category !== "string" || !/^[a-z][a-z0-9-]*$/.test(proposal.category)) renderFail(`comments[${index}].ruleProposal.category is invalid`);
      if (proposal.rationale != null && typeof proposal.rationale !== "string") renderFail(`comments[${index}].ruleProposal.rationale must be a string`);
    }
    const anchor = comment.target.anchor;
    if (anchor) {
      if (comment.target.type !== "frame") renderFail(`comments[${index}] anchors are supported only on Frame targets`);
      if (!["point", "region"].includes(anchor.kind)) renderFail(`comments[${index}].target.anchor.kind must be point or region`);
      ["x", "y"].forEach((key) => {
        if (!Number.isFinite(anchor[key]) || anchor[key] < 0 || anchor[key] > 100) renderFail(`comments[${index}].target.anchor.${key} must be between 0 and 100`);
      });
      if (anchor.kind === "region") {
        ["width", "height"].forEach((key) => {
          if (!Number.isFinite(anchor[key]) || anchor[key] <= 0 || anchor[key] > 100) renderFail(`comments[${index}].target.anchor.${key} must be greater than 0 and at most 100`);
        });
        if (anchor.x + anchor.width > 100.1 || anchor.y + anchor.height > 100.1) renderFail(`comments[${index}].target.anchor region escapes the Frame`);
      }
    }
  });
  const renderedComments = comments.map((comment) => ({
    ...comment,
    reviewState: !comment.targetRevision ? "unbound" : comment.targetRevision === targetHashes[comment.target.id] ? "current" : "outdated"
  }));

  const revision = { id: revisionId(packageHash), sourceHash: packageHash, targetHashes };
  const snapshot = {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    canvas: data.canvas,
    revision,
    sources: sourceRefs,
    layout: data.layout || {},
    frames: frames.map((frame) => ({ ...frame, targetRevision: targetHashes[frame.id] })),
    groups: groups.map((group) => ({ ...group, targetRevision: targetHashes[group.id] })),
    connections: connections.map((connection) => ({ ...connection, targetRevision: targetHashes[connection.id] })),
    actions: actions.map((action) => ({ ...action, targetRevision: targetHashes[action.id] })),
    notes: notes.map((note) => ({ ...note, targetRevision: targetHashes[note.id] })),
    library,
    rules: rules ? { ...rules, source: loadedRules.source } : { schemaVersion: CANVAS_SCHEMA_VERSION, rulesRevision: 0, scope: "workspace", title: "Canvas Common Rules", description: "", source: null, rules: [] },
    diagnostics,
    feedback: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      canvasId: data.canvas.id,
      canvasVersion: data.canvas.version,
      feedbackRevision,
      review,
      archive: feedbackData.archive || [],
      comments: renderedComments
    }
  };

  const [template, runtimeCss, pzJs, feedbackJs, boardJs, libraryJs, rulesJs] = await Promise.all([
    readFile(path.join(kitRoot, "runtime", "template.html"), "utf8"),
    readFile(path.join(kitRoot, "runtime", "canvas.css"), "utf8"),
    readFile(path.join(kitRoot, "runtime", "pz-canvas.js"), "utf8"),
    readFile(path.join(kitRoot, "runtime", "feedback.js"), "utf8"),
    readFile(path.join(kitRoot, "runtime", "board.js"), "utf8"),
    readFile(path.join(kitRoot, "runtime", "library.js"), "utf8"),
    readFile(path.join(kitRoot, "runtime", "rules.js"), "utf8")
  ]);

  const safeJson = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
  const html = template
    .replace("{{TITLE}}", escapeHtml(data.canvas.title))
    .replace("{{LANG}}", escapeHtml(data.canvas.language || "en"))
    .replace("{{RUNTIME_CSS}}", runtimeCss)
    .replace("{{CANVAS_CSS}}", canvasStyles)
    .replace("{{CANVAS_DATA}}", safeJson)
    .replace("{{PZ_CANVAS_JS}}", pzJs)
    .replace("{{FEEDBACK_JS}}", feedbackJs)
    .replace("{{BOARD_JS}}", boardJs)
    .replace("{{LIBRARY_JS}}", libraryJs)
    .replace("{{RULES_JS}}", rulesJs);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  process.stdout.write(`rendered ${output} from ${input} (${frames.length} frames, ${actions.length} actions, ${connections.length} connections, ${library?.components.length || 0} library components, ${rules?.rules.filter((rule) => rule.status === "active").length || 0} active rules, ${comments.length} comments, ${diagnostics.length} diagnostics, ${revision.id})\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
