#!/usr/bin/env node
/**
 * Exit codes:
 *   0 — @hono/node-server override can be removed (upstream SDK is safe)
 *   1 — override still needed
 *   2 — override not present (nothing to do)
 *   3 — unexpected error
 *
 * Usage:
 *   node .github/scripts/check-hono-override.mjs
 *   node .github/scripts/check-hono-override.mjs --remove
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const semver = require('semver');

const REMOVE = process.argv.includes('--remove');
const PKG_PATH = 'package.json';
const LOCK_PATH = 'package-lock.json';
const OVERRIDE_KEY = '@hono/node-server';
const SAFE_FLOOR = '2.0.5';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function lockedSdkVersion() {
  const lock = readJson(LOCK_PATH);
  const entry = lock.packages?.['node_modules/@modelcontextprotocol/sdk'];
  if (!entry?.version) {
    throw new Error('Could not find @modelcontextprotocol/sdk in package-lock.json');
  }
  return entry.version;
}

function npmViewHonoRange(sdkVersion) {
  const out = execFileSync(
    'npm',
    ['view', `@modelcontextprotocol/sdk@${sdkVersion}`, 'dependencies.@hono/node-server'],
    { encoding: 'utf8' },
  ).trim();
  return out || '';
}

function rangePullsVulnerable(range) {
  if (!range) {
    // SDK no longer depends on the helper at all.
    return false;
  }
  // True if any version satisfying the range is still below the fix.
  return semver.intersects(range, `<${SAFE_FLOOR}`, { includePrerelease: true });
}

function removeOverride() {
  const pkg = readJson(PKG_PATH);
  if (!pkg.overrides || !(OVERRIDE_KEY in pkg.overrides)) {
    console.log(`No ${OVERRIDE_KEY} override to remove.`);
    return false;
  }
  delete pkg.overrides[OVERRIDE_KEY];
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Removed overrides["${OVERRIDE_KEY}"] from ${PKG_PATH}.`);
  return true;
}

function main() {
  const pkg = readJson(PKG_PATH);
  const hasOverride = Boolean(pkg.overrides?.[OVERRIDE_KEY]);

  if (!hasOverride) {
    console.log(`No ${OVERRIDE_KEY} override in package.json — nothing to do.`);
    process.exit(2);
  }

  const sdkVersion = lockedSdkVersion();
  const honoRange = npmViewHonoRange(sdkVersion);
  const stillVulnerable = rangePullsVulnerable(honoRange);

  console.log(`Locked MCP SDK: ${sdkVersion}`);
  console.log(`SDK @hono/node-server range: ${honoRange || '(none)'}`);
  console.log(`Still allows <${SAFE_FLOOR}: ${stillVulnerable}`);

  if (stillVulnerable) {
    console.log('Override still needed.');
    process.exit(1);
  }

  console.log('Upstream SDK no longer pulls a vulnerable @hono/node-server.');
  if (REMOVE) {
    removeOverride();
  }
  process.exit(0);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(3);
}
