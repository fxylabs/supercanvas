#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(process.argv[2] || "artifacts/09-visual-canvas");
const kitRoot = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "dist/canvas.html");
const html = await readFile(output, "utf8");

assert.equal(html.includes("{{"), false, "generated output contains an unresolved template placeholder");
const feedbackMenu = html.match(/<div id="file-menu-panel"[\s\S]*?<\/div>/)?.[0] || "";
assert.ok(feedbackMenu.includes('id="export-btn"'), "feedback menu must expose Save");
assert.ok(feedbackMenu.includes('id="clear-all-comments"'), "feedback menu must expose Clear all comments");
assert.equal((feedbackMenu.match(/role="menuitem"/g) || []).length, 2, "feedback menu must contain only Save and Clear all comments");
const match = html.match(/<script type="application\/json" id="canvas-data">([\s\S]*?)<\/script>/);
assert.ok(match, "canvas snapshot is missing");
const snapshot = JSON.parse(match[1]);
assert.equal(snapshot.schemaVersion, 2, "generated snapshot must use schema v2");
assert.equal(snapshot.diagnostics.length, 0, "canvas has renderer diagnostics");
assert.ok(snapshot.frames.length > 0, "canvas needs at least one Frame");

const libraryItems = snapshot.library ? [snapshot.library.library]
  .concat(snapshot.library.foundations || [], snapshot.library.layouts || [], snapshot.library.components || [], (snapshot.library.components || []).flatMap((component) => component.stories || [])) : [];
const ruleItems = snapshot.rules?.rules || [];
const targetCollections = [snapshot.frames, snapshot.groups, snapshot.connections, snapshot.actions, snapshot.notes, libraryItems, ruleItems];
const ids = [snapshot.canvas.id]
  .concat(...targetCollections, snapshot.feedback.comments)
  .map((item) => typeof item === "string" ? item : item.id);
assert.equal(new Set(ids).size, ids.length, "target IDs are not globally unique");
targetCollections.flat().concat(snapshot.canvas).forEach((target) => {
  assert.ok(snapshot.revision.targetHashes[target.id], `missing target revision for ${target.id}`);
});

const frameIds = new Set(snapshot.frames.map((frame) => frame.id));
const connectionIds = new Set(snapshot.connections.map((connection) => connection.id));
snapshot.actions.forEach((action) => {
  assert.ok(frameIds.has(action.from.frameId), `Action ${action.id} has an unknown source Frame`);
  if (action.outcome?.type === "frame") assert.ok(frameIds.has(action.outcome.frameId), `Action ${action.id} has an unknown outcome Frame`);
  if (action.connectionId) assert.ok(connectionIds.has(action.connectionId), `Action ${action.id} has an unknown Connection`);
});
const libraryIds = new Set(libraryItems.map((item) => item.id));
snapshot.frames.forEach((frame) => {
  (frame.libraryUses || []).forEach((id) => assert.ok(libraryIds.has(id), `Frame ${frame.id} has an unknown Library dependency`));
});
snapshot.feedback.comments.forEach((comment) => {
  assert.ok(["current", "outdated", "unbound"].includes(comment.reviewState), `Comment ${comment.id} has an invalid derived review state`);
  assert.ok(["open", "discussion", "resolved"].includes(comment.status), `Comment ${comment.id} has an invalid workflow status`);
});
assert.ok(snapshot.feedback.review?.id, "feedback review cycle is missing");
assert.ok(Number.isInteger(snapshot.feedback.feedbackRevision), "feedbackRevision is missing");
assert.ok(snapshot.rules && Array.isArray(snapshot.rules.rules), "common rules snapshot is missing");
assert.ok(Number.isInteger(snapshot.rules.rulesRevision), "rulesRevision is missing");
ruleItems.forEach((rule) => {
  assert.ok(["active", "proposed", "deprecated"].includes(rule.status), `Rule ${rule.id} has an invalid status`);
  assert.ok(["must", "should"].includes(rule.priority), `Rule ${rule.id} has an invalid priority`);
  assert.ok(rule.verification?.checks?.length, `Rule ${rule.id} needs verification checks`);
});
assert.ok(html.includes("rules-view"), "Common Rules view runtime is missing");
assert.ok(html.includes("ruleProposal"), "feedback rule proposal workflow is missing");
if (snapshot.notes.length) {
  assert.ok(html.includes("planning-note-card"), "Planning Note card runtime is missing");
  assert.ok(html.includes("planning-note-anchor"), "Planning Note numbered anchor runtime is missing");
}
if (snapshot.library) {
  assert.ok(html.includes("library-view"), "Design Library view runtime is missing");
  assert.ok(html.includes("library-definition"), "Design Library exact definition disclosure is missing");
}

const feedbackSource = await readFile(path.join(kitRoot, "runtime/feedback.js"), "utf8");
const boardSource = await readFile(path.join(kitRoot, "runtime/board.js"), "utf8");
assert.ok(boardSource.includes('comment.status !== "resolved"'), "resolved comments must be hidden by default");
assert.ok(boardSource.includes('comment.target.type !== "canvas"'), "unanchored legacy Canvas comments must not render pins");
assert.ok(boardSource.includes('if (!isReviewTarget(comment)) return;'), "only unresolved anchored comments may render pins");
assert.equal(/openNewPopover\(\{\s*type:\s*["']canvas["']/.test(boardSource), false, "empty Canvas clicks must not create unanchored comments");
assert.ok(boardSource.includes('id: step.dataset.frameId'), "Frame comments must use the clicked Frame, not the Frame picker selection");
assert.ok(boardSource.indexOf("canvas.setPointerCapture(event.pointerId)") > boardSource.indexOf("regionDrag.moved = true"), "point comment clicks must not be captured before a region drag starts");
const sandbox = {};
vm.runInNewContext(feedbackSource, sandbox);
const protocol = sandbox.CanvasFeedback;
const firstFrame = snapshot.frames[0];
const sourceComment = snapshot.feedback.comments.find((comment) => comment.target.anchor?.kind === "region") || snapshot.feedback.comments[0] || {
  id: "comment-verify-round-trip",
  target: { type: "frame", id: firstFrame.id, x: 50, y: 50 },
  targetRevision: snapshot.revision.targetHashes[firstFrame.id],
  text: "Synthetic verification feedback",
  status: "open",
  author: { id: null, label: "Verifier" }
};
const currentTargetRevision = snapshot.revision.targetHashes[sourceComment.target.id];
assert.ok(currentTargetRevision, `round-trip Comment target ${sourceComment.target.id} has no current revision`);
const editedComment = { ...sourceComment, targetRevision: currentTargetRevision, text: "round-trip edit", status: "resolved" };
delete editedComment.reviewState;
const portable = protocol.portable({ canvasId: snapshot.canvas.id, canvasVersion: snapshot.canvas.version, baseRevision: snapshot.revision.id }, [editedComment]);
const imported = protocol.validatePortable(JSON.parse(JSON.stringify(portable)), snapshot.canvas.id);
assert.equal(imported[0].target.id, editedComment.target.id);
assert.equal(imported[0].targetRevision, editedComment.targetRevision);
assert.equal(imported[0].status, "resolved");
assert.equal(JSON.stringify(imported[0].author || null), JSON.stringify(editedComment.author || null));
assert.equal(JSON.stringify(imported[0].target.anchor || null), JSON.stringify(editedComment.target.anchor || null));
assert.equal(JSON.stringify(imported[0].thread || []), JSON.stringify(editedComment.thread || []));
assert.equal(JSON.stringify(imported[0].resolution || null), JSON.stringify(editedComment.resolution || null));
const reconciled = protocol.reconcile([sourceComment], { baseRevision: snapshot.revision.id, comments: imported, deletedIds: [] }, snapshot.revision.targetHashes);
assert.equal(reconciled[0].text, "round-trip edit");
assert.equal(reconciled[0].reviewState, "current");
const outdated = protocol.reconcile([], { comments: [{ ...imported[0], targetRevision: "sha256:old" }] }, snapshot.revision.targetHashes);
assert.equal(outdated[0].reviewState, "outdated");
const canonicalAfterAgent = [{ ...imported[0], text: "canonical Agent result" }];
const staleSubmitted = {
  reviewId: snapshot.feedback.review.id,
  baseFeedbackRevision: Math.max(0, snapshot.feedback.feedbackRevision - 1),
  submittedAt: "2026-07-24T00:00:00.000Z",
  comments: [{ ...imported[0], text: "stale browser draft" }]
};
const canonicalWins = protocol.reconcile(canonicalAfterAgent, staleSubmitted, snapshot.revision.targetHashes, snapshot.feedback);
assert.equal(canonicalWins[0].text, "canonical Agent result", "new canonical feedback must supersede a submitted stale browser draft");
const anotherCycle = protocol.reconcile(canonicalAfterAgent, { reviewId: "review-another", comments: [{ ...imported[0], text: "wrong cycle" }] }, snapshot.revision.targetHashes, snapshot.feedback);
assert.equal(anotherCycle[0].text, "canonical Agent result", "a draft from another review cycle must not leak into the active cycle");
const discussionComment = snapshot.feedback.comments.find((comment) => comment.status === "discussion");
if (discussionComment) {
  const discussionEnvelope = protocol.portable({ canvasId: snapshot.canvas.id, canvasVersion: snapshot.canvas.version, baseRevision: snapshot.revision.id, feedbackRevision: snapshot.feedback.feedbackRevision, review: snapshot.feedback.review, archive: snapshot.feedback.archive }, [discussionComment]);
  const validatedDiscussion = protocol.validateEnvelope(JSON.parse(JSON.stringify(discussionEnvelope)), snapshot.canvas.id);
  assert.equal(validatedDiscussion.comments[0].thread[0].author.type, "agent", "discussion thread must preserve the Agent question");
}
const nextCycleEnvelope = protocol.portable({ canvasId: snapshot.canvas.id, canvasVersion: snapshot.canvas.version, baseRevision: snapshot.revision.id, feedbackRevision: snapshot.feedback.feedbackRevision + 1, review: { id: "review-verify-next", status: "active", createdAt: "2026-07-24T00:00:00.000Z" }, archive: [{ review: { ...snapshot.feedback.review, status: "completed" }, comments: snapshot.feedback.comments }] }, []);
const validatedNextCycle = protocol.validateEnvelope(nextCycleEnvelope, snapshot.canvas.id);
assert.equal(validatedNextCycle.comments.length, 0, "a new review cycle must start without active comments");
assert.equal(validatedNextCycle.archive.length, 1, "a new review cycle must preserve the previous review archive");

const contextScript = path.join(kitRoot, "context.mjs");
const canvasPath = path.join(root, "canvas.json");
async function contextFor(targetId) {
  return JSON.parse((await execFileAsync(process.execPath, [contextScript, "--canvas", canvasPath, "--target", targetId])).stdout);
}
const frameContext = await contextFor(firstFrame.id);
const actionContext = snapshot.actions.length ? await contextFor(snapshot.actions[0].id) : null;
const commentContext = snapshot.feedback.comments.length ? await contextFor(snapshot.feedback.comments[0].id) : null;
const firstComponent = snapshot.library?.components?.[0] || null;
const componentContext = firstComponent ? await contextFor(firstComponent.id) : null;
const firstRule = ruleItems[0] || null;
const ruleContext = firstRule ? await contextFor(firstRule.id) : null;
const outputBytes = (await stat(output)).size;
assert.equal(frameContext.read.required.length, 1, "Frame context must require exactly one Frame source");
assert.equal(frameContext.targetRevision, snapshot.revision.targetHashes[firstFrame.id], "Frame context revision must match the rendered target revision");
assert.ok(frameContext.metrics.required.bytes < outputBytes, "Frame context is not smaller than generated output");
if (actionContext) {
  assert.equal(actionContext.read.required.length, 1, "Action context must require only the Action sidecar");
  assert.ok(actionContext.metrics.required.bytes < outputBytes, "Action context is not smaller than generated output");
}
if (commentContext) assert.equal(commentContext.nextTarget.id, snapshot.feedback.comments[0].target.id, "Comment context did not preserve its target");
assert.equal(frameContext.commonRules.active.length, ruleItems.filter((rule) => rule.status === "active").length, "Frame context must include every active common rule");
assert.ok(frameContext.commonRules.instruction.includes("Apply every active rule"), "Frame context is missing the rule application instruction");
if (componentContext) {
  assert.equal(componentContext.query.type, "component", "Library component context has the wrong target type");
  assert.equal(componentContext.definition.id, firstComponent.id, "Library component context did not return the exact definition");
  assert.equal(componentContext.targetRevision, snapshot.revision.targetHashes[firstComponent.id], "Library component context revision must match the rendered target revision");
  assert.ok(componentContext.read.required.includes(snapshot.sources.library), "Library component context must require the Library source");
}
if (ruleContext) {
  assert.equal(ruleContext.query.type, "rule", "Rule context has the wrong target type");
  assert.equal(ruleContext.rule.id, firstRule.id, "Rule context did not return the exact definition");
  assert.equal(ruleContext.targetRevision, snapshot.revision.targetHashes[firstRule.id], "Rule context revision must match the rendered target revision");
}

process.stdout.write(JSON.stringify({
  canvas: snapshot.canvas.id,
  revision: snapshot.revision.id,
  targets: ids.length,
  frames: snapshot.frames.length,
  actions: snapshot.actions.length,
  notes: snapshot.notes.length,
  library: snapshot.library ? {
    foundations: snapshot.library.foundations.length,
    layouts: snapshot.library.layouts.length,
    components: snapshot.library.components.length
  } : null,
  rules: {
    active: ruleItems.filter((rule) => rule.status === "active").length,
    proposed: ruleItems.filter((rule) => rule.status === "proposed").length
  },
  comments: snapshot.feedback.comments.length,
  feedbackRoundTrip: "passed",
  context: {
    frameRequired: frameContext.metrics.required,
    actionRequired: actionContext?.metrics.required || null,
    generatedOutputBytes: outputBytes
  }
}, null, 2) + "\n");
