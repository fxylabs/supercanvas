#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  CANVAS_SCHEMA_VERSION,
  contextMetrics,
  frameRevision,
  localPath,
  migrateManifest,
  migrateSidecar,
  readJson,
  sourceHash,
  stableJson
} from "./protocol.mjs";
import { libraryTarget, libraryTargets, prepareLibrary } from "./library.mjs";
import { activeRules, loadRules, proposedRules } from "./rules.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--canvas" || argv[index] === "--target") result[argv[index].slice(2)] = argv[index += 1];
  }
  return result;
}

function compactFrame(frame) {
  if (!frame) return null;
  return {
    id: frame.id,
    title: frame.title,
    summary: frame.summary,
    kind: frame.kind || "screen",
    tags: frame.tags || [],
    source: frame.source,
    uses: frame.uses || [],
    libraryUses: frame.libraryUses || []
  };
}

async function targetRevision(root, targetType, target, frames, library, sources, tokensData) {
  if (targetType !== "frame") return sourceHash([target]);
  const frameContent = await readFile(localPath(root, target.source, "frame.source", "context"), "utf8");
  const fileDependencies = await Promise.all((target.uses || []).map((relative) => relative === sources.tokens
    ? stableJson(tokensData)
    : readFile(localPath(root, relative, `frame.uses ${relative}`, "context"), "utf8").catch(() => `missing:${relative}`)));
  const definitionDependencies = (target.libraryUses || []).map((id) => stableJson(libraryTarget(library, id)?.value || { missing: id }));
  const dependencies = fileDependencies.concat(definitionDependencies);
  return frameRevision(target, frameContent, dependencies);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.canvas || !args.target) throw new Error("usage: context.mjs --canvas canvas.json --target <stable-id>");

  const canvasPath = path.resolve(args.canvas);
  const root = path.dirname(canvasPath);
  const manifest = migrateManifest(JSON.parse(await readFile(canvasPath, "utf8")));
  const sources = manifest.sources || {};
  const relations = migrateSidecar(await readJson(root, sources.relations, "sources.relations", { schemaVersion: CANVAS_SCHEMA_VERSION, groups: [], connections: [] }, "context"), "relations");
  const actionsData = migrateSidecar(await readJson(root, sources.actions, "sources.actions", { schemaVersion: CANVAS_SCHEMA_VERSION, actions: [] }, "context"), "actions");
  const notesData = migrateSidecar(await readJson(root, sources.notes, "sources.notes", { schemaVersion: CANVAS_SCHEMA_VERSION, notes: [] }, "context"), "notes");
  const feedback = migrateSidecar(await readJson(root, sources.feedback, "sources.feedback", { schemaVersion: CANVAS_SCHEMA_VERSION, comments: [] }, "context"), "feedback");
  const tokensData = await readJson(root, sources.tokens, "sources.tokens", null, "context");
  const libraryData = await readJson(root, sources.library, "sources.library", null, "context");
  const library = prepareLibrary(libraryData, manifest.canvas.id, tokensData);
  const loadedRules = await loadRules(root, sources.rules, "context");
  const rules = loadedRules.value;
  const commonRules = {
    source: loadedRules.source,
    rulesRevision: rules?.rulesRevision || 0,
    scope: rules?.scope || "workspace",
    active: activeRules(rules),
    proposed: proposedRules(rules),
    instruction: "Apply every active rule to the target. Do not silently promote inferred feedback: write a proposed rule or ruleProposal and request user approval first."
  };
  const frames = manifest.frames || [];
  const actions = actionsData.actions || [];
  const notes = notesData.notes || [];
  const targetId = args.target;
  const frame = frames.find((item) => item.id === targetId);
  const group = (relations.groups || []).find((item) => item.id === targetId);
  const connection = (relations.connections || []).find((item) => item.id === targetId);
  const action = actions.find((item) => item.id === targetId);
  const note = notes.find((item) => item.id === targetId);
  const comment = (feedback.comments || []).find((item) => item.id === targetId);
  const designTarget = libraryTarget(library, targetId);
  const rule = (rules?.rules || []).find((item) => item.id === targetId);
  const target = frame || group || connection || action || note || (manifest.canvas.id === targetId ? manifest.canvas : null);

  if (comment) {
    const required = [sources.feedback];
    process.stdout.write(JSON.stringify({
      query: { type: "comment", id: comment.id },
      comment,
      commonRules,
      nextTarget: comment.target,
      read: { required, conditional: [] },
      metrics: await contextMetrics(root, required, []),
      workflow: {
        resolved: "After verified work, set status=resolved, update targetRevision, add resolution.summary/changes and an Agent thread message.",
        discussion: "If a decision is required, set status=discussion and add an Agent question to thread; do not invent the answer.",
        feedbackRevision: "Increment feedbackRevision once when writing the Agent-updated feedback file.",
        rulePromotion: "If feedback is reusable across Frames or Canvases, add ruleProposal.status=proposed and ask for approval. If ruleProposal.status=approved, promote it into the shared rules file as an active rule and retain feedback provenance."
      },
      instruction: `Run context again with --target ${comment.target.id}; do not read dist/canvas.html.`
    }, null, 2) + "\n");
    return;
  }
  if (rule) {
    const required = loadedRules.source ? [loadedRules.source] : [];
    process.stdout.write(JSON.stringify({
      query: { type: "rule", id: rule.id },
      canvas: { id: manifest.canvas.id, title: manifest.canvas.title, version: manifest.canvas.version },
      rule,
      commonRules,
      targetRevision: sourceHash([rule]),
      read: { required, conditional: [] },
      metrics: await contextMetrics(root, required, []),
      instruction: rule.status === "active"
        ? "Treat this rule as a mandatory authoring constraint according to its priority and run every verification check before resolving feedback."
        : "This rule is not active. Present it for user review; do not apply it as a permanent shared constraint until approved."
    }, null, 2) + "\n");
    return;
  }
  if (designTarget) {
    const definition = designTarget.value;
    const component = designTarget.type === "story" ? library.components.find((item) => item.id === definition.componentId) : null;
    const usedByFrames = frames.filter((item) => (item.libraryUses || []).includes(designTarget.type === "story" ? definition.componentId : definition.id)).map(compactFrame);
    const required = [sources.library];
    const conditional = [sources.tokens].concat(usedByFrames.map((item) => item.source)).filter(Boolean);
    process.stdout.write(JSON.stringify({
      query: { type: designTarget.type, id: targetId },
      canvas: { id: manifest.canvas.id, title: manifest.canvas.title, version: manifest.canvas.version },
      library: library.library,
      definition,
      component,
      usedByFrames,
      notes: notes.filter((item) => item.target?.id === targetId),
      feedback: (feedback.comments || []).filter((item) => item.target?.id === targetId),
      commonRules,
      targetRevision: sourceHash([definition]),
      read: { required, conditional },
      metrics: await contextMetrics(root, required, conditional),
      instruction: "Use this definition as the design contract. Adapt implementation syntax to the destination project; do not infer missing props or states."
    }, null, 2) + "\n");
    return;
  }
  if (!target) throw new Error(`unknown canvas target: ${targetId}`);

  const targetType = frame ? "frame" : group ? "group" : connection ? "connection" : action ? "action" : note ? "note" : "canvas";
  const relatedNotes = notes.filter((item) => item.target && item.target.id === targetId);
  const relatedFeedback = (feedback.comments || []).filter((item) => item.target && item.target.id === targetId);
  const result = {
    query: { type: targetType, id: targetId },
    canvas: { id: manifest.canvas.id, title: manifest.canvas.title, version: manifest.canvas.version },
    target,
    targetRevision: targetType === "canvas" ? null : await targetRevision(root, targetType, target, frames, library, sources, tokensData),
    notes: relatedNotes,
    feedback: relatedFeedback,
    commonRules,
    read: { required: [], conditional: [] }
  };

  if (frame) {
    result.target = compactFrame(frame);
    result.groups = (relations.groups || []).filter((item) => (item.members || []).includes(frame.id)).map((item) => ({ id: item.id, title: item.title }));
    result.inbound = (relations.connections || []).filter((item) => item.to === frame.id);
    result.outbound = (relations.connections || []).filter((item) => item.from === frame.id);
    result.actions = actions.filter((item) => item.from?.frameId === frame.id).map((item) => ({ id: item.id, label: item.label, trigger: item.trigger, outcome: item.outcome }));
    result.libraryDefinitions = (frame.libraryUses || []).map((id) => libraryTarget(library, id)).filter(Boolean).map((item) => ({ type: item.type, definition: item.value }));
    result.read.required = [frame.source];
    result.read.conditional = (frame.uses || []).concat(frame.libraryUses?.length && sources.library ? [sources.library] : []);
  } else if (connection) {
    result.endpoints = [connection.from, connection.to].map((id) => compactFrame(frames.find((item) => item.id === id)));
    result.actions = actions.filter((item) => item.connectionId === connection.id).map((item) => ({ id: item.id, label: item.label, trigger: item.trigger }));
    result.read.required = [sources.relations];
    result.read.conditional = result.endpoints.filter(Boolean).map((item) => item.source);
  } else if (action) {
    result.sourceFrame = compactFrame(frames.find((item) => item.id === action.from.frameId));
    result.outcomeFrame = action.outcome?.type === "frame" ? compactFrame(frames.find((item) => item.id === action.outcome.frameId)) : null;
    result.connection = action.connectionId ? (relations.connections || []).find((item) => item.id === action.connectionId) : null;
    result.read.required = [sources.actions];
    result.read.conditional = [result.sourceFrame?.source, result.outcomeFrame?.source].filter(Boolean);
  } else if (group) {
    result.members = (group.members || []).map((id) => compactFrame(frames.find((item) => item.id === id))).filter(Boolean);
    result.read.required = [sources.relations];
    result.read.conditional = result.members.map((item) => item.source);
  } else if (note) {
    result.read.required = [sources.notes];
    result.nextTarget = note.target;
  } else {
    result.counts = {
      frames: frames.length,
      groups: (relations.groups || []).length,
      connections: (relations.connections || []).length,
      actions: actions.length,
      notes: notes.length,
      libraryFoundations: library?.foundations.length || 0,
      libraryLayouts: library?.layouts.length || 0,
      libraryComponents: library?.components.length || 0,
      activeRules: commonRules.active.length,
      proposedRules: commonRules.proposed.length,
      unresolvedFeedback: (feedback.comments || []).filter((item) => item.status !== "resolved").length,
      discussionFeedback: (feedback.comments || []).filter((item) => item.status === "discussion").length
    };
    result.review = feedback.review || null;
    result.feedbackRevision = feedback.feedbackRevision || 1;
    result.frameIndex = frames.map(compactFrame);
    result.actionIndex = actions.map((item) => ({ id: item.id, label: item.label, trigger: item.trigger, from: item.from, outcome: item.outcome }));
    result.libraryIndex = libraryTargets(library).map((item) => ({ type: item.type, id: item.value.id, title: item.value.title || item.value.name || item.value.id }));
    result.ruleIndex = (rules?.rules || []).map((item) => ({ id: item.id, title: item.title, status: item.status, priority: item.priority, category: item.category }));
    result.read.required = [path.basename(canvasPath)];
    result.read.conditional = Object.values(sources).concat(loadedRules.source && !sources.rules ? [loadedRules.source] : []).filter(Boolean);
  }

  result.metrics = await contextMetrics(root, result.read.required, result.read.conditional);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`canvas context: ${error.message}\n`);
  process.exitCode = 1;
});
