/* Local review server for `supercanvas view`.

   A canvas opened over file:// has an opaque origin, so the browser cannot write anywhere: the
   File System Access API refuses the call and every save degrades into a download the agent then
   has to be pointed at. Serving the same dist/canvas.html over loopback gives the page one
   endpoint that writes the package's own feedback.json and re-renders it, which is what makes
   `Save feedback` a single click with no file picker in the way. */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import { feedbackFile, feedbackProtocol, readFeedback, readManifest, writeFeedback } from "./feedback.mjs";

const engineRoot = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("The feedback payload is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function render(packageRoot) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(engineRoot, "render.mjs"),
      "--in", path.join(packageRoot, "canvas.json"),
      "--out", path.join(packageRoot, "dist/canvas.html")
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ ok: false, message: error.message }));
    child.once("exit", (code) => resolve(code === 0 ? { ok: true } : { ok: false, message: stderr.trim() || `render exited with code ${code}` }));
  });
}

/* The page learns it is being served — and proves it is the page we served — from an injected
   handshake. A random token per run keeps another origin from posting feedback into the package
   even if it guesses the port. */
function injectBridge(html, token) {
  const bridge = `<script>window.__SUPERCANVAS_SERVER__ = ${JSON.stringify({ token, endpoint: "/api/feedback" })};</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${bridge}\n</head>`) : `${bridge}\n${html}`;
}

async function handleSave(packageRoot, request, response, token) {
  if (request.headers["x-supercanvas-token"] !== token) return sendJson(response, 403, { error: "This request did not come from the served canvas." });
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    return sendJson(response, 400, { error: `The feedback payload could not be read: ${error.message}` });
  }
  const { manifest, file, data } = await readFeedback(packageRoot);
  const protocol = await feedbackProtocol();
  let validated;
  try {
    validated = protocol.validateEnvelope(payload, manifest.canvas.id);
  } catch (error) {
    return sendJson(response, 422, { error: error.message });
  }
  /* The page posts the revision it was loaded from. If the agent has resolved something since, that
     draft describes a file that no longer exists and writing it would erase the resolution while the
     file's own counter stayed put. A payload carrying no revision at all cannot say which file it was
     built from, so it is refused the same way. */
  const base = Number(data.feedbackRevision) || 1;
  if (validated.feedbackRevision !== base) {
    return sendJson(response, 409, {
      error: `The agent changed this canvas since the page loaded (feedback revision ${base}). Reload before saving again.`,
      feedbackRevision: base
    });
  }
  // the file keeps its own schemaVersion and revision counter; the browser only owns the review state
  const next = {
    ...data,
    canvasVersion: validated.canvasVersion || data.canvasVersion,
    review: validated.review || data.review,
    archive: validated.archive || [],
    comments: validated.comments
  };
  await writeFeedback(file, next);
  const rendered = await render(packageRoot);
  sendJson(response, 200, {
    saved: true,
    path: file,
    comments: next.comments.length,
    feedbackRevision: next.feedbackRevision,
    rendered: rendered.ok,
    renderError: rendered.ok ? null : rendered.message
  });
}

async function handleState(packageRoot, response) {
  const { manifest, data } = await readFeedback(packageRoot);
  sendJson(response, 200, {
    canvasId: manifest.canvas.id,
    canvasVersion: data.canvasVersion,
    feedbackRevision: Number(data.feedbackRevision) || 1,
    review: data.review || null,
    comments: (data.comments || []).length
  });
}

async function handlePage(packageRoot, response, token) {
  const html = await readFile(path.join(packageRoot, "dist/canvas.html"), "utf8");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(injectBridge(html, token));
}

export async function serveCanvas(packageRoot, options = {}) {
  const manifest = await readManifest(packageRoot);
  await feedbackFile(packageRoot, manifest);
  const token = randomUUID();
  const server = createServer((request, response) => {
    const route = (request.url || "/").split("?")[0];
    const handler = request.method === "POST" && route === "/api/feedback" ? () => handleSave(packageRoot, request, response, token)
      : request.method === "GET" && route === "/api/feedback" ? () => handleState(packageRoot, response)
        : request.method === "GET" && (route === "/" || route === "/canvas.html") ? () => handlePage(packageRoot, response, token)
          : null;
    if (!handler) return sendJson(response, 404, { error: `Not served: ${request.method} ${route}` });
    handler().catch((error) => sendJson(response, 500, { error: error.message }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port || 0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/`, title: manifest.canvas?.title || "untitled" };
}
