/* Node-side access to the canvas feedback file. The browser runtime, the review server and the
   CLI all speak the same portable envelope, so the validation rules live once in
   runtime/feedback.js and every Node caller loads them from there. */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

import { localPath, migrateSidecar } from "./protocol.mjs";

const engineRoot = path.dirname(fileURLToPath(import.meta.url));

let cachedProtocol = null;

export async function feedbackProtocol() {
  if (cachedProtocol) return cachedProtocol;
  const sandbox = {};
  vm.runInNewContext(await readFile(path.join(engineRoot, "runtime/feedback.js"), "utf8"), sandbox);
  cachedProtocol = sandbox.CanvasFeedback;
  return cachedProtocol;
}

export async function readManifest(packageRoot) {
  return JSON.parse(await readFile(path.join(packageRoot, "canvas.json"), "utf8"));
}

/* Resolves the feedback sidecar the manifest points at, so a package that renamed the file keeps
   working. A canvas without a feedback source cannot take review comments at all. */
export async function feedbackFile(packageRoot, manifest) {
  const resolved = manifest || await readManifest(packageRoot);
  const relative = resolved.sources?.feedback;
  if (!relative) throw new Error(`This canvas has no sources.feedback: ${packageRoot}`);
  return localPath(packageRoot, relative, "sources.feedback", "feedback");
}

export async function readFeedback(packageRoot) {
  const manifest = await readManifest(packageRoot);
  const file = await feedbackFile(packageRoot, manifest);
  const data = migrateSidecar(JSON.parse(await readFile(file, "utf8")), "feedback");
  return { manifest, file, data };
}

export async function writeFeedback(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function activeComments(data) {
  return Array.isArray(data.comments) ? data.comments : [];
}

export function commentsByStatus(data, status) {
  return activeComments(data).filter((comment) => comment.status === status);
}

function reviewStamps(data) {
  return new Map(activeComments(data)
    .filter((comment) => comment.status !== "resolved")
    .map((comment) => [comment.id, comment.updatedAt || comment.createdAt || ""]));
}

/* Nothing tells a session that the reviewer pressed Save — the browser talks to the review server,
   not to the agent. Blocking on the file until work shows up turns that into something an agent can
   wait on: run it in the background and the process exits the moment there is something to read.
   Comments already open are work too, so they come back without waiting at all. */
export async function waitForReview(packageRoot, options = {}) {
  const intervalMs = options.intervalMs || 1000;
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : null;
  const first = await readFeedback(packageRoot);
  const waiting = commentsByStatus(first.data, "open");
  if (waiting.length) return { data: first.data, comments: waiting, manifest: first.manifest };
  const baseline = reviewStamps(first.data);
  while (!deadline || Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    // a save in flight can be read half-written; the next poll sees the finished file
    const current = await readFeedback(packageRoot).catch(() => null);
    if (!current) continue;
    const changed = activeComments(current.data).filter((comment) => {
      if (comment.status === "resolved") return false;
      return !baseline.has(comment.id) || baseline.get(comment.id) !== (comment.updatedAt || comment.createdAt || "");
    });
    if (changed.length) return { data: current.data, comments: changed, manifest: current.manifest };
  }
  return null;
}

/* The agent's half of the round trip: close a comment with the change it produced. The review
   cycle's feedbackRevision moves once per agent pass, no matter how many comments closed with it,
   because it marks "the canonical file is newer than any browser draft", not a comment count. */
export function resolveComments(data, commentIds, resolution) {
  const wanted = new Set(commentIds);
  const found = new Set();
  const comments = activeComments(data).map((comment) => {
    if (!wanted.has(comment.id)) return comment;
    found.add(comment.id);
    return {
      ...comment,
      status: "resolved",
      updatedAt: resolution.resolvedAt,
      resolution: {
        summary: resolution.summary,
        changes: resolution.changes || [],
        resolvedAt: resolution.resolvedAt,
        resolvedBy: { type: "agent", label: resolution.label || "Agent" }
      }
    };
  });
  const missing = commentIds.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`No such open comment: ${missing.join(", ")}`);
  return { ...data, feedbackRevision: (Number(data.feedbackRevision) || 1) + 1, comments };
}

/* Reply without closing: an agent that needs a decision from the user moves the comment to
   discussion, which the protocol only accepts once an agent message exists in the thread. */
export function discussComment(data, commentId, message) {
  let found = false;
  const comments = activeComments(data).map((comment) => {
    if (comment.id !== commentId) return comment;
    found = true;
    return {
      ...comment,
      status: "discussion",
      updatedAt: message.createdAt,
      thread: (comment.thread || []).concat({
        id: message.id,
        author: { type: "agent", label: message.label || "Agent" },
        text: message.text,
        createdAt: message.createdAt
      })
    };
  });
  if (!found) throw new Error(`No such comment: ${commentId}`);
  return { ...data, feedbackRevision: (Number(data.feedbackRevision) || 1) + 1, comments };
}

function targetLabel(comment) {
  const target = comment.target || {};
  const anchor = target.anchor;
  if (anchor?.kind === "region") return `${target.type} ${target.id} @ region ${anchor.x}%,${anchor.y}% ${anchor.width}%×${anchor.height}%`;
  if (anchor?.kind === "point") return `${target.type} ${target.id} @ point ${anchor.x}%,${anchor.y}%`;
  return `${target.type} ${target.id}`;
}

export function summarizeFeedback(data, canvasTitle) {
  const comments = activeComments(data);
  const lines = [
    `# Canvas feedback — ${canvasTitle} (${data.canvasVersion})`,
    `review ${data.review?.id || "unknown"} · feedback revision ${data.feedbackRevision || 1} · ${comments.length} comment(s)`
  ];
  if (!comments.length) lines.push("", "No comments to work on.");
  comments.forEach((comment) => {
    lines.push("", `## ${comment.id} (${comment.status}${comment.reviewState === "outdated" ? ", target changed" : ""})`);
    lines.push(`target: ${targetLabel(comment)}`);
    lines.push(`context: supercanvas context --target ${comment.target?.id}`);
    lines.push(comment.text);
    (comment.thread || []).forEach((message) => lines.push(`- ${message.author.label}: ${message.text}`));
    if (comment.resolution) lines.push(`- resolved: ${comment.resolution.summary}`);
    if (comment.ruleProposal) lines.push(`- common rule candidate (${comment.ruleProposal.status}): ${comment.ruleProposal.statement}`);
  });
  return `${lines.join("\n")}\n`;
}
