#!/usr/bin/env node
// Validates every template under templates/.
//
// 1. Static checks: JSON parses, directory name == metadata name == sequence
//    name, kebab-case, non-empty description/blocks, handlers declared, no
//    obvious secrets, validation block present.
// 2. Engine check: runs the sequence once through the real engine with
//      orch8 dev <sequence.json> --dry-run --skip-timers --once
//        --input <validation.context> --mock <handler>=<json> ...
//    Side-effecting handlers and external-worker handlers are mocked from
//    template.json `validation.mocks`, so this proves the definition parses,
//    passes engine validation, resolves its templates, and reaches a
//    Completed state. It does not prove your real endpoints/workers behave.
//
// Engine binary: ORCH8_BIN (default "orch8"). ORCH8_BIN may be a multi-word
// command, e.g. the container image:
//   ORCH8_BIN="docker run --rm -v $PWD:/w -w /w --entrypoint orch8 ghcr.io/orch8-io/engine:latest"
// Set SKIP_ENGINE=1 to run only the static checks.
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const templatesDir = resolve(root, "templates");
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/, // OpenAI-style keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /AKIA[0-9A-Z]{16}/, // AWS access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"(api_key|password|secret|token)"\s*:\s*"(?!\{\{)[^"]{8,}"/i, // literal secret values
];

const engineCmd = (process.env.ORCH8_BIN ?? "orch8").split(/\s+/).filter(Boolean);
const skipEngine = process.env.SKIP_ENGINE === "1";

function run(args) {
  return spawnSync(engineCmd[0], [...engineCmd.slice(1), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

// `--no-server` exists on newer CLIs (where `orch8 dev` starts a server by
// default); older CLIs have no server unless `--server` is passed.
let serverFlag = [];
if (!skipEngine) {
  const help = run(["dev", "--help"]);
  if (help.status !== 0) {
    console.error(`cannot run '${engineCmd.join(" ")} dev --help':\n${help.stderr || help.error}`);
    process.exit(2);
  }
  if (help.stdout.includes("--no-server")) serverFlag = ["--no-server"];
  const version = run(["--version"]);
  console.log(`engine: ${version.stdout.trim()} (${engineCmd.join(" ")})`);
}

const dirs = (await readdir(templatesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let failures = 0;
const seen = new Set();
for (const dir of dirs) {
  const errors = [];
  const metaPath = resolve(templatesDir, dir, "template.json");
  const seqPath = resolve(templatesDir, dir, "sequence.json");
  let meta;
  let seq;
  let seqRaw = "";
  let metaRaw = "";
  try {
    metaRaw = await readFile(metaPath, "utf8");
    meta = JSON.parse(metaRaw);
  } catch (error) {
    errors.push(`template.json: ${error.message}`);
  }
  try {
    seqRaw = await readFile(seqPath, "utf8");
    seq = JSON.parse(seqRaw);
  } catch (error) {
    errors.push(`sequence.json: ${error.message}`);
  }

  if (meta && seq) {
    if (!KEBAB.test(dir)) errors.push(`directory '${dir}' is not kebab-case`);
    if (meta.name !== dir) errors.push(`template.json name '${meta.name}' != directory '${dir}'`);
    if (seq.name !== dir) errors.push(`sequence.json name '${seq.name}' != directory '${dir}'`);
    if (seen.has(meta.name)) errors.push(`duplicate template name '${meta.name}'`);
    seen.add(meta.name);
    if (typeof meta.description !== "string" || meta.description.length < 20) {
      errors.push("description must be a sentence (>= 20 chars)");
    }
    if (!Array.isArray(meta.tags) || meta.tags.length === 0) errors.push("tags must be a non-empty array");
    if (!meta.author) errors.push("author is required");
    if (!meta.handlers || !Array.isArray(meta.handlers.builtin) || !Array.isArray(meta.handlers.workers)) {
      errors.push("handlers.builtin and handlers.workers arrays are required");
    }
    if (!Array.isArray(seq.blocks) || seq.blocks.length === 0) errors.push("sequence.json needs non-empty blocks");
    for (const forbidden of ["id", "created_at", "tenant_id", "version"]) {
      if (forbidden in seq) errors.push(`sequence.json must not set server-assigned '${forbidden}'`);
    }
    if (!meta.validation || typeof meta.validation.context !== "object") {
      errors.push("validation.context object is required");
    }
    // Every step handler used must be declared in metadata.
    const used = new Set();
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      if (value.type === "step" && typeof value.handler === "string") used.add(value.handler);
      Object.values(value).forEach(walk);
    };
    walk(seq.blocks);
    const declared = new Set([
      ...(meta.handlers?.builtin ?? []),
      ...(meta.handlers?.workers ?? []).map((w) => w.handler),
    ]);
    for (const handler of used) {
      if (!declared.has(handler)) errors.push(`handler '${handler}' is used but not declared in template.json`);
    }
    for (const worker of meta.handlers?.workers ?? []) {
      if (!meta.validation?.mocks?.[worker.handler]) {
        errors.push(`worker handler '${worker.handler}' needs a validation.mocks entry`);
      }
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(seqRaw) || pattern.test(metaRaw)) errors.push(`possible secret matched ${pattern}`);
    }
  }

  if (errors.length === 0 && !skipEngine) {
    const args = [
      "dev",
      `templates/${dir}/sequence.json`,
      ...serverFlag,
      "--dry-run",
      "--skip-timers",
      "--once",
      "--input",
      JSON.stringify(meta.validation.context),
    ];
    for (const [handler, output] of Object.entries(meta.validation.mocks ?? {})) {
      args.push("--mock", `${handler}=${JSON.stringify(output)}`);
    }
    const result = run(args);
    if (result.status !== 0) {
      errors.push(`engine run failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
  }

  if (errors.length) {
    failures++;
    console.log(`FAIL ${dir}`);
    for (const error of errors) console.log(`  - ${error}`);
  } else {
    console.log(`PASS ${dir}${skipEngine ? " (static only)" : ""}`);
  }
}

console.log(`${dirs.length - failures}/${dirs.length} templates passed`);
process.exit(failures ? 1 : 0);
