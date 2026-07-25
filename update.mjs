#!/usr/bin/env node

import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const kitRoot = path.dirname(fileURLToPath(import.meta.url));
const renderScript = path.join(kitRoot, "render.mjs");
const verifyScript = path.join(kitRoot, "verify.mjs");

async function exists(candidate) {
  try {
    await access(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function packageFrom(input) {
  const candidate = path.resolve(input);
  if (path.basename(candidate) === "canvas.json" && await exists(candidate)) return path.dirname(candidate);
  if (await exists(path.join(candidate, "canvas.json"))) return candidate;
  throw new Error(`Canvas package not found: ${candidate}`);
}

async function packagesUnder(root) {
  if (!await exists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    if (await exists(path.join(candidate, "canvas.json"))) packages.push(candidate);
  }
  return packages.sort();
}

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`));
    });
  });
}

async function defaultPackages() {
  const current = process.cwd();
  if (await exists(path.join(current, "canvas.json"))) return [current];
  const localPackages = await packagesUnder(path.join(current, ".data/canvas"));
  if (localPackages.length) return localPackages;
  throw new Error("No canvas.json or .data/canvas/* package in the current folder.");
}

async function resolvePackages(args) {
  if (!args.length) return defaultPackages();
  if (args[0] === "--all") {
    if (args.length > 2) throw new Error("Usage: update.mjs --all [canvas-packages-root]");
    const root = path.resolve(args[1] || path.join(process.cwd(), ".data/canvas"));
    const packages = await packagesUnder(root);
    if (!packages.length) throw new Error(`No canvas packages found under: ${root}`);
    return packages;
  }
  return Promise.all(args.map(packageFrom));
}

try {
  const packages = [...new Set(await resolvePackages(process.argv.slice(2)))];
  process.stdout.write(`Canvas kit: ${kitRoot}\nUpdating ${packages.length} package(s)\n`);
  for (const packageRoot of packages) {
    process.stdout.write(`\n[Canvas] ${packageRoot}\n`);
    await run(renderScript, ["--in", path.join(packageRoot, "canvas.json"), "--out", path.join(packageRoot, "dist/canvas.html")]);
    await run(verifyScript, [packageRoot]);
  }
  process.stdout.write(`\nUpdated and verified ${packages.length} Canvas package(s).\n`);
} catch (error) {
  process.stderr.write(`Canvas update failed: ${error.message}\n`);
  process.exitCode = 1;
}
