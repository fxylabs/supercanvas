#!/usr/bin/env node

import { access, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { CANVAS_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, migrateManifest, migrateSidecar } from "../protocol.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const registryFile = path.join(os.homedir(), ".supercanvas", "registry.json");

const usage = `usage: supercanvas <command>

  new <dir> [--title t] [--template minimal]   scaffold a package and register it
  add [target] [--slug s]                      register an existing package
  list                                         list registered canvases
  remove <slug>                                unregister a canvas (package files are kept)
  view [target]                                open dist/canvas.html in the browser
  update [target ...] [--all [root]]           render + verify (default: nearest package from cwd)
  render [target]                              render only
  verify [target]                              verify only
  context --target <id> [target]               resolve a stable target ID to a minimal source set
  migrate [target]                             permanently upgrade schemaVersion to the engine latest
  help                                         print this help
  --version, -v                                print the engine version

[target] is a canvas package path or a registry slug. When omitted, walks up from cwd
to find canvas.json.
`;

async function exists(candidate)
{
    try
    {
        await access(candidate, constants.R_OK);
        return true;
    }
    catch
    {
        return false;
    }
}

async function nearestPackage(startDir)
{
    let current = path.resolve(startDir);
    while (true)
    {
        if (await exists(path.join(current, "canvas.json"))) return current;
        const parent = path.dirname(current);
        if (parent === current) throw new Error(`No canvas.json found walking up from cwd: ${startDir}`);
        current = parent;
    }
}

async function packageFrom(input)
{
    const candidate = path.resolve(input);
    if (path.basename(candidate) === "canvas.json" && await exists(candidate)) return path.dirname(candidate);
    if (await exists(path.join(candidate, "canvas.json"))) return candidate;
    throw new Error(`Canvas package not found: ${candidate}`);
}

async function loadRegistry()
{
    const raw = await readFile(registryFile, "utf8").catch(() => null);
    return raw ? JSON.parse(raw) : {};
}

async function saveRegistry(registry)
{
    await mkdir(path.dirname(registryFile), { recursive: true });
    await writeFile(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
}

function slugify(name)
{
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function resolveTarget(input)
{
    if (!input) return nearestPackage(process.cwd());
    const fromPath = await packageFrom(input).catch(() => null);
    if (fromPath) return fromPath;
    const registry = await loadRegistry();
    if (registry[input]) return packageFrom(registry[input].path);
    throw new Error(`Not a path or a registry slug: ${input} (register it with: supercanvas add)`);
}

function run(script, args)
{
    return new Promise((resolve, reject) =>
    {
        const child = spawn(process.execPath, [path.join(engineRoot, script), ...args], { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) =>
        {
            if (code === 0) resolve();
            else reject(new Error(`${script} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`));
        });
    });
}

async function cmdUpdate(args)
{
    if (args[0] === "--all") return run("update.mjs", args);
    if (!args.length)
    {
        const packageRoot = await nearestPackage(process.cwd()).catch(() => null);
        if (packageRoot) await ensureSchemaSupported(packageRoot);
        return run("update.mjs", packageRoot ? [packageRoot] : []);
    }
    const packages = await Promise.all(args.map(resolveTarget));
    await Promise.all(packages.map(ensureSchemaSupported));
    return run("update.mjs", packages);
}

async function cmdRender(args)
{
    const packageRoot = await ensureSchemaSupported(await resolveTarget(args[0]));
    return run("render.mjs", [
        "--in", path.join(packageRoot, "canvas.json"),
        "--out", path.join(packageRoot, "dist/canvas.html"),
    ]);
}

async function cmdVerify(args)
{
    const packageRoot = await ensureSchemaSupported(await resolveTarget(args[0]));
    return run("verify.mjs", [packageRoot]);
}

async function cmdContext(args)
{
    let targetId = null;
    const rest = [];
    for (let index = 0; index < args.length; index += 1)
    {
        if (args[index] === "--target") targetId = args[index += 1];
        else rest.push(args[index]);
    }
    if (!targetId) throw new Error("usage: supercanvas context --target <stable-id> [target]");
    const packageRoot = await ensureSchemaSupported(await resolveTarget(rest[0]));
    return run("context.mjs", ["--canvas", path.join(packageRoot, "canvas.json"), "--target", targetId]);
}

async function register(slug, packageRoot)
{
    const registry = await loadRegistry();
    const existing = registry[slug];
    if (existing && path.resolve(existing.path) !== packageRoot)
    {
        throw new Error(`slug is already registered to another path: ${slug} → ${existing.path} (pick another name with --slug)`);
    }
    registry[slug] = { path: packageRoot, addedAt: existing?.addedAt || new Date().toISOString() };
    await saveRegistry(registry);
}

async function readManifest(packageRoot)
{
    return JSON.parse(await readFile(path.join(packageRoot, "canvas.json"), "utf8"));
}

async function ensureSchemaSupported(packageRoot)
{
    const version = (await readManifest(packageRoot)).schemaVersion;
    if (version > CANVAS_SCHEMA_VERSION)
    {
        throw new Error(`package schemaVersion ${version} is newer than this engine (v${CANVAS_SCHEMA_VERSION}). Update the engine: ${packageRoot}`);
    }
    if (!SUPPORTED_SCHEMA_VERSIONS.has(version))
    {
        throw new Error(`Unsupported schemaVersion ${version}: ${packageRoot} (run: supercanvas migrate)`);
    }
    if (version < CANVAS_SCHEMA_VERSION)
    {
        process.stderr.write(`This package is schemaVersion ${version}. Run supercanvas migrate to upgrade it to v${CANVAS_SCHEMA_VERSION} permanently.\n`);
    }
    return packageRoot;
}

async function rewriteCanvasId(dir, oldId, newId)
{
    const entries = await readdir(dir);
    for (const entry of entries.filter((name) => name.endsWith(".json")))
    {
        const filePath = path.join(dir, entry);
        const raw = await readFile(filePath, "utf8");
        if (raw.includes(oldId)) await writeFile(filePath, raw.replaceAll(oldId, newId));
    }
}

async function cmdNew(args)
{
    let title = null;
    let template = "minimal";
    const rest = [];
    for (let index = 0; index < args.length; index += 1)
    {
        if (args[index] === "--title") title = args[index += 1];
        else if (args[index] === "--template") template = args[index += 1];
        else rest.push(args[index]);
    }
    if (rest.length !== 1) throw new Error("usage: supercanvas new <dir> [--title t] [--template minimal]");
    const dir = path.resolve(rest[0]);
    if (await exists(path.join(dir, "canvas.json"))) throw new Error(`A canvas package already exists: ${dir}`);
    const templateRoot = path.join(engineRoot, "templates", template);
    if (!await exists(path.join(templateRoot, "canvas.json"))) throw new Error(`Template not found: ${template}`);
    const slug = slugify(path.basename(dir));
    await cp(templateRoot, dir, { recursive: true });
    const templateId = (await readManifest(dir)).canvas.id;
    await rewriteCanvasId(dir, templateId, `canvas-${slug}`);
    const manifest = await readManifest(dir);
    manifest.canvas.title = title || slug;
    await writeFile(path.join(dir, "canvas.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await register(slug, dir);
    process.stdout.write(`created ${dir} (slug: ${slug})\nNext: replace the frame sources, then run supercanvas update ${slug}\n`);
}

async function cmdAdd(args)
{
    let slug = null;
    const rest = [];
    for (let index = 0; index < args.length; index += 1)
    {
        if (args[index] === "--slug") slug = args[index += 1];
        else rest.push(args[index]);
    }
    const packageRoot = rest[0] ? await packageFrom(rest[0]) : await nearestPackage(process.cwd());
    await ensureSchemaSupported(packageRoot);
    const manifest = await readManifest(packageRoot);
    const finalSlug = slug ? slugify(slug) : slugify(path.basename(packageRoot));
    await register(finalSlug, packageRoot);
    process.stdout.write(`registered ${finalSlug} → ${packageRoot} (${manifest.canvas?.title || "untitled"})\n`);
}

async function describePackage(slug, packageRoot)
{
    const raw = await readFile(path.join(packageRoot, "canvas.json"), "utf8").catch(() => null);
    if (raw === null) return `${slug}  (missing: ${packageRoot})`;
    let manifest;
    try
    {
        manifest = JSON.parse(raw);
    }
    catch
    {
        return `${slug}  (invalid canvas.json: ${packageRoot})`;
    }
    const rendered = await exists(path.join(packageRoot, "dist/canvas.html"));
    return `${slug}  schema v${manifest.schemaVersion}  ${rendered ? "rendered" : "not rendered"}  ${manifest.canvas?.title || ""}  ${packageRoot}`;
}

async function cmdList()
{
    const registry = await loadRegistry();
    const slugs = Object.keys(registry).sort();
    if (!slugs.length)
    {
        process.stdout.write("No canvases registered. Register one with supercanvas new or add.\n");
        return;
    }
    for (const slug of slugs)
    {
        process.stdout.write(`${await describePackage(slug, registry[slug].path)}\n`);
    }
}

async function cmdRemove(args)
{
    const slug = args[0];
    if (!slug) throw new Error("usage: supercanvas remove <slug>");
    const registry = await loadRegistry();
    if (!registry[slug]) throw new Error(`Unregistered slug: ${slug}`);
    delete registry[slug];
    await saveRegistry(registry);
    process.stdout.write(`removed ${slug} (package files are left in place)\n`);
}

async function cmdMigrate(args)
{
    const packageRoot = await resolveTarget(args[0]);
    const manifest = await readManifest(packageRoot);
    const version = manifest.schemaVersion;
    if (version > CANVAS_SCHEMA_VERSION)
    {
        throw new Error(`package schemaVersion ${version} is newer than this engine (v${CANVAS_SCHEMA_VERSION}). Update the engine.`);
    }
    if (version === CANVAS_SCHEMA_VERSION)
    {
        process.stdout.write(`Already at the latest schemaVersion v${CANVAS_SCHEMA_VERSION}: ${packageRoot}\n`);
        return;
    }
    const upgraded = migrateManifest(manifest);
    await writeFile(path.join(packageRoot, "canvas.json"), `${JSON.stringify(upgraded, null, 2)}\n`);
    for (const [kind, relative] of Object.entries(upgraded.sources || {}))
    {
        await migrateSidecarFile(packageRoot, kind, relative);
    }
    process.stdout.write(`migrated v${version} → v${CANVAS_SCHEMA_VERSION}: ${packageRoot}\n`);
    await cmdUpdate([packageRoot]);
}

async function migrateSidecarFile(packageRoot, kind, relative)
{
    if (!relative) return;
    const filePath = path.join(packageRoot, relative);
    const raw = await readFile(filePath, "utf8").catch(() => null);
    if (raw === null) return;
    const upgraded = migrateSidecar(JSON.parse(raw), kind);
    await writeFile(filePath, `${JSON.stringify(upgraded, null, 2)}\n`);
}

async function cmdView(args)
{
    const packageRoot = await ensureSchemaSupported(await resolveTarget(args[0]));
    const output = path.join(packageRoot, "dist/canvas.html");
    if (!await exists(output)) throw new Error(`dist/canvas.html is missing. Run this first: supercanvas update ${args[0] || packageRoot}`);
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [output], { stdio: "ignore", detached: true }).unref();
    process.stdout.write(`opened ${output}\n`);
}

async function cmdVersion()
{
    const enginePackage = JSON.parse(await readFile(path.join(engineRoot, "package.json"), "utf8"));
    process.stdout.write(`${enginePackage.version}\n`);
}

const commands = {
    new: cmdNew,
    add: cmdAdd,
    list: cmdList,
    remove: cmdRemove,
    view: cmdView,
    update: cmdUpdate,
    render: cmdRender,
    verify: cmdVerify,
    context: cmdContext,
    migrate: cmdMigrate,
    "--version": cmdVersion,
    "-v": cmdVersion,
};

const [command, ...args] = process.argv.slice(2);

if (!command || command === "help" || command === "--help")
{
    process.stdout.write(usage);
}
// hasOwn, not a plain lookup — `commands` inherits toString/constructor, and those would
// otherwise dispatch as valid commands and exit 0 on what is really a typo
else if (!Object.hasOwn(commands, command))
{
    process.stderr.write(`unknown command: ${command}\n\n${usage}`);
    process.exitCode = 1;
}
else
{
    try
    {
        await commands[command](args);
    }
    catch (error)
    {
        process.stderr.write(`supercanvas ${command} failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}
