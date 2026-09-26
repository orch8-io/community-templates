#!/usr/bin/env node
// Builds catalog.json from templates/<name>/{template.json,sequence.json}.
//
// Output format is exactly what `orch8 templates list|show|pull --catalog-url`
// consumes (orch8-cli/src/commands/templates.rs): either a bare array or an
// envelope `{ "templates": [...] }` whose entries carry `name`, `description`,
// and either an inline `sequence` or a `download_url`. We inline `sequence`
// so the catalog works from any static host with a single request. Extra
// fields (tags, author, handlers, requires) are ignored by the CLI and are
// kept for humans and other tooling.
//
// Usage: node scripts/build-catalog.mjs          # write catalog.json
//        node scripts/build-catalog.mjs --check  # exit 1 if catalog.json is stale
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const templatesDir = resolve(root, "templates");
const catalogPath = resolve(root, "catalog.json");

const names = (await readdir(templatesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const templates = [];
for (const dir of names) {
  const meta = JSON.parse(await readFile(resolve(templatesDir, dir, "template.json"), "utf8"));
  const sequence = JSON.parse(await readFile(resolve(templatesDir, dir, "sequence.json"), "utf8"));
  templates.push({
    name: meta.name,
    description: meta.description,
    tags: meta.tags ?? [],
    author: meta.author,
    min_engine_version: meta.min_engine_version,
    handlers: meta.handlers,
    requires: meta.requires ?? [],
    sequence,
  });
}

const rendered = `${JSON.stringify({ schema_version: 1, templates }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(catalogPath, "utf8");
  } catch {
    // missing file is stale
  }
  if (current !== rendered) {
    console.error("catalog.json is out of date: run `node scripts/build-catalog.mjs`");
    process.exit(1);
  }
  console.log(`catalog.json is up to date (${templates.length} templates)`);
} else {
  await writeFile(catalogPath, rendered);
  console.log(`wrote catalog.json (${templates.length} templates)`);
}
