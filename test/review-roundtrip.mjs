#!/usr/bin/env node

/* End-to-end check of the review round trip on a throwaway copy of the example package:
   the served canvas saves a comment into feedback.json, the agent CLI resolves it, the served
   page can see that the revision moved, and clearing a resolved comment archives it. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { feedbackProtocol } from "../feedback.mjs";
import { serveCanvas } from "../serve.mjs";

const execFileAsync = promisify(execFile);
const kitRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(kitRoot, "bin/supercanvas.mjs");

const workspace = await mkdtemp(path.join(os.tmpdir(), "supercanvas-roundtrip-"));
const packageRoot = path.join(workspace, "reading-list");
let server = null;

async function supercanvas(...args) {
  return execFileAsync(process.execPath, [cli, ...args], { cwd: workspace });
}

async function feedbackData() {
  return JSON.parse(await readFile(path.join(packageRoot, "feedback.json"), "utf8"));
}

function envelope(data, comments, archive) {
  return {
    schemaVersion: 2,
    canvasId: data.canvasId,
    canvasVersion: data.canvasVersion,
    feedbackRevision: data.feedbackRevision,
    review: data.review,
    archive: archive || data.archive || [],
    comments
  };
}

async function post(url, token, payload) {
  const response = await fetch(new URL("/api/feedback", url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-supercanvas-token": token },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

try {
  await cp(path.join(kitRoot, "examples/reading-list"), packageRoot, { recursive: true });
  await supercanvas("render", packageRoot);

  const served = await serveCanvas(packageRoot);
  server = served.server;
  const page = await (await fetch(served.url)).text();
  const token = page.match(/window\.__SUPERCANVAS_SERVER__ = (\{.*?\});/)?.[1];
  assert.ok(token, "the served page must carry the review server handshake");
  const bridge = JSON.parse(token);
  assert.equal(bridge.endpoint, "/api/feedback", "the handshake must name the save endpoint");

  const start = await feedbackData();
  const frameId = JSON.parse(await readFile(path.join(packageRoot, "canvas.json"), "utf8")).frames[0].id;
  const comment = {
    id: "comment-roundtrip-001",
    target: { type: "frame", id: frameId, anchor: { kind: "point", x: 40, y: 30 } },
    text: "The heading is too quiet here.",
    status: "open",
    author: { id: null, label: "Local reviewer" },
    createdAt: new Date().toISOString()
  };

  const rejected = await post(served.url, "not-the-token", envelope(start, [comment]));
  assert.equal(rejected.status, 403, "a save without the served token must be refused");

  // started before the save: the agent must learn about review work without being told
  const waiting = supercanvas("feedback", "--wait", "--timeout", "30", "--target", packageRoot);
  const saved = await post(served.url, bridge.token, envelope(start, [comment]));
  assert.equal(saved.status, 200, `saving must succeed: ${saved.body.error || ""}`);
  assert.equal(saved.body.rendered, true, `saving must re-render: ${saved.body.renderError || ""}`);
  const afterSave = await feedbackData();
  assert.equal(afterSave.comments.length, 1, "the comment must land in the package's feedback.json");
  assert.equal(afterSave.comments[0].id, comment.id, "the saved comment must keep its ID");
  assert.ok((await readFile(path.join(packageRoot, "dist/canvas.html"), "utf8")).includes(comment.text),
    "the re-rendered canvas must carry the saved comment");

  const woken = await waiting;
  assert.ok(woken.stdout.includes(comment.id), "--wait must return as soon as the reviewer saves a comment");
  const nothingNew = await supercanvas("feedback", "--wait", "--timeout", "2", "--target", packageRoot);
  assert.ok(nothingNew.stdout.includes(comment.id), "--wait must return open work immediately instead of waiting for the next save");

  const listed = await supercanvas("feedback", "--target", packageRoot);
  assert.ok(listed.stdout.includes(comment.id), "supercanvas feedback must show the comment to the agent");
  assert.ok(listed.stdout.includes(comment.text), "supercanvas feedback must show the comment text");
  const asJson = JSON.parse((await supercanvas("feedback", "--json", "--target", packageRoot)).stdout);
  assert.equal(asJson.comments.length, 1, "--json must return the same comment set");

  await supercanvas("resolve", comment.id, "--summary", "Raised the heading to 24px.", "--target", packageRoot);
  const afterResolve = await feedbackData();
  assert.equal(afterResolve.comments[0].status, "resolved", "resolve must close the comment in the file");
  assert.equal(afterResolve.comments[0].resolution.resolvedBy.type, "agent", "resolve must record the agent as the author");
  assert.equal(afterResolve.feedbackRevision, start.feedbackRevision + 1, "resolve must move the feedback revision");

  const state = await (await fetch(new URL("/api/feedback", served.url))).json();
  assert.equal(state.feedbackRevision, afterResolve.feedbackRevision, "the open page must be able to see the agent's revision");

  // a page still holding the pre-resolve revision must not write the agent's answer away
  const stale = await post(served.url, bridge.token, envelope(start, [comment]));
  assert.equal(stale.status, 409, "a save built on an older feedback revision must be refused");
  const afterStale = await feedbackData();
  assert.equal(afterStale.comments[0].status, "resolved", "a refused stale save must leave the comment resolved");
  assert.equal(afterStale.comments[0].resolution.summary, afterResolve.comments[0].resolution.summary,
    "a refused stale save must leave the agent's resolution intact");
  assert.equal(afterStale.feedbackRevision, afterResolve.feedbackRevision, "a refused stale save must not touch the revision");

  const protocol = await feedbackProtocol();
  const rotation = protocol.rotate(afterResolve.archive, afterResolve.review, afterResolve.comments);
  const cleared = await post(served.url, bridge.token, envelope(afterResolve, rotation.active, rotation.archive));
  assert.equal(cleared.status, 200, `clearing must succeed: ${cleared.body.error || ""}`);
  const afterClear = await feedbackData();
  assert.equal(afterClear.comments.length, 0, "clearing a resolved comment must empty the review list");
  assert.equal(protocol.archivedCommentIds(afterClear.archive)[0], comment.id, "a cleared comment must stay in the archive");
  assert.equal(afterClear.feedbackRevision, afterResolve.feedbackRevision, "a reviewer save must not move the agent's revision counter");

  const invalid = await post(served.url, bridge.token, envelope(afterClear, [{ ...comment, status: "nonsense" }]));
  assert.equal(invalid.status, 422, "an invalid envelope must be refused instead of overwriting the file");
  assert.equal((await feedbackData()).comments.length, 0, "a refused save must leave the file untouched");

  process.stdout.write("review round trip: passed\n");
} finally {
  // undici keeps its sockets alive, so close() alone would not call back until they time out
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(workspace, { recursive: true, force: true });
}
