#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `usage: supercanvas <command>

  update [target ...] [--all [root]]   render + verify (기본: cwd에서 가장 가까운 package)
  render [target]                      render만 실행
  verify [target]                      검증만 실행
  context --target <id> [target]      stable target ID를 최소 source 집합으로 해석
  help                                 이 도움말 출력

[target]은 canvas package 경로다. 생략하면 cwd에서 위로 올라가며 canvas.json을 찾는다.
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

function resolveTarget(input)
{
    return input ? packageFrom(input) : nearestPackage(process.cwd());
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
    if (args.length) return run("update.mjs", args);
    const packageRoot = await nearestPackage(process.cwd()).catch(() => null);
    return run("update.mjs", packageRoot ? [packageRoot] : []);
}

async function cmdRender(args)
{
    const packageRoot = await resolveTarget(args[0]);
    return run("render.mjs", [
        "--in", path.join(packageRoot, "canvas.json"),
        "--out", path.join(packageRoot, "dist/canvas.html"),
    ]);
}

async function cmdVerify(args)
{
    const packageRoot = await resolveTarget(args[0]);
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
    const packageRoot = await resolveTarget(rest[0]);
    return run("context.mjs", ["--canvas", path.join(packageRoot, "canvas.json"), "--target", targetId]);
}

const commands = {
    update: cmdUpdate,
    render: cmdRender,
    verify: cmdVerify,
    context: cmdContext,
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
