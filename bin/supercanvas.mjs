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

  new <dir> [--title t] [--template minimal]   package 스캐폴드 + 레지스트리 등록
  add [target] [--slug s]                      기존 package를 레지스트리에 등록
  list                                         등록된 canvas 목록
  remove <slug>                                레지스트리에서 제거 (package 파일은 유지)
  view [target]                                dist/canvas.html을 브라우저로 연다
  update [target ...] [--all [root]]           render + verify (기본: cwd에서 가장 가까운 package)
  render [target]                              render만 실행
  verify [target]                              검증만 실행
  context --target <id> [target]               stable target ID를 최소 source 집합으로 해석
  migrate [target]                             schemaVersion을 엔진 최신으로 영구 업그레이드
  help                                         이 도움말 출력

[target]은 canvas package 경로 또는 레지스트리 slug다. 생략하면 cwd에서 위로 올라가며
canvas.json을 찾는다.
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
        if (parent === current) throw new Error(`cwd에서 상위로 canvas.json을 찾지 못했습니다: ${startDir}`);
        current = parent;
    }
}

async function packageFrom(input)
{
    const candidate = path.resolve(input);
    if (path.basename(candidate) === "canvas.json" && await exists(candidate)) return path.dirname(candidate);
    if (await exists(path.join(candidate, "canvas.json"))) return candidate;
    throw new Error(`Canvas package를 찾을 수 없습니다: ${candidate}`);
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
    throw new Error(`경로도 레지스트리 slug도 아닙니다: ${input} (등록: supercanvas add)`);
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
        throw new Error(`slug가 이미 다른 경로에 등록돼 있습니다: ${slug} → ${existing.path} (--slug로 다른 이름 지정)`);
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
        throw new Error(`package schemaVersion ${version}은 이 엔진(v${CANVAS_SCHEMA_VERSION})보다 새 버전입니다. 엔진을 업데이트한다: ${packageRoot}`);
    }
    if (!SUPPORTED_SCHEMA_VERSIONS.has(version))
    {
        throw new Error(`지원하지 않는 schemaVersion ${version}입니다: ${packageRoot} (실행: supercanvas migrate)`);
    }
    if (version < CANVAS_SCHEMA_VERSION)
    {
        process.stderr.write(`schemaVersion ${version} package다. supercanvas migrate로 v${CANVAS_SCHEMA_VERSION} 영구 반영을 권장한다.\n`);
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
    if (await exists(path.join(dir, "canvas.json"))) throw new Error(`이미 canvas package가 있습니다: ${dir}`);
    const templateRoot = path.join(engineRoot, "templates", template);
    if (!await exists(path.join(templateRoot, "canvas.json"))) throw new Error(`template을 찾을 수 없습니다: ${template}`);
    const slug = slugify(path.basename(dir));
    await cp(templateRoot, dir, { recursive: true });
    const templateId = (await readManifest(dir)).canvas.id;
    await rewriteCanvasId(dir, templateId, `canvas-${slug}`);
    const manifest = await readManifest(dir);
    manifest.canvas.title = title || slug;
    await writeFile(path.join(dir, "canvas.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await register(slug, dir);
    process.stdout.write(`created ${dir} (slug: ${slug})\n다음: frame source를 교체하고 supercanvas update ${slug}\n`);
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
        process.stdout.write("등록된 canvas가 없습니다. supercanvas new 또는 add로 등록한다.\n");
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
    if (!registry[slug]) throw new Error(`등록되지 않은 slug입니다: ${slug}`);
    delete registry[slug];
    await saveRegistry(registry);
    process.stdout.write(`removed ${slug} (package 파일은 그대로 둔다)\n`);
}

async function cmdMigrate(args)
{
    const packageRoot = await resolveTarget(args[0]);
    const manifest = await readManifest(packageRoot);
    const version = manifest.schemaVersion;
    if (version > CANVAS_SCHEMA_VERSION)
    {
        throw new Error(`package schemaVersion ${version}은 이 엔진(v${CANVAS_SCHEMA_VERSION})보다 새 버전입니다. 엔진을 업데이트한다.`);
    }
    if (version === CANVAS_SCHEMA_VERSION)
    {
        process.stdout.write(`이미 최신 schemaVersion v${CANVAS_SCHEMA_VERSION}이다: ${packageRoot}\n`);
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
    if (!await exists(output)) throw new Error(`dist/canvas.html이 없습니다. 먼저 실행: supercanvas update ${args[0] || packageRoot}`);
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [output], { stdio: "ignore", detached: true }).unref();
    process.stdout.write(`opened ${output}\n`);
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
};

const [command, ...args] = process.argv.slice(2);

if (!command || command === "help" || command === "--help")
{
    process.stdout.write(usage);
}
else if (!commands[command])
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
