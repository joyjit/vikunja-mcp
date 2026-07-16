#!/usr/bin/env npx tsx
/**
 * Ephemeral Dockerized Vikunja for MCP integration tests:
 * bring it up, register a user, mint a JWT, tear it down.
 *
 *   npx tsx scripts/vikunja-docker.ts up     # start + write .env.e2e
 *   npx tsx scripts/vikunja-docker.ts down   # stop + remove volumes
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker/vikunja.e2e.yml');
const PROJECT_NAME = 'vikunja-mcp-e2e';
const VIKUNJA_PORT = process.env.VIKUNJA_PORT?.trim() || '3456';
const VIKUNJA_BASE = `http://localhost:${VIKUNJA_PORT}`;
const API_BASE = `${VIKUNJA_BASE}/api/v1`;
const ENV_FILE = path.join(REPO_ROOT, '.env.e2e');

const E2E_USER = {
  username: 'mcpe2e',
  email: 'mcpe2e@example.com',
  password: 'mcp-e2e-password-1',
};

function compose(args: string[]): void {
  execFileSync(
    'docker',
    ['compose', '-p', PROJECT_NAME, '-f', COMPOSE_FILE, ...args],
    { stdio: 'inherit', cwd: REPO_ROOT }
  );
}

async function waitForHealthy(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/info`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Vikunja did not become healthy at ${API_BASE} within ${timeoutMs}ms`);
}

async function registerUser(): Promise<void> {
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(E2E_USER),
  });
  // 200 = created; 400 = already exists (re-running up without down)
  if (res.ok || res.status === 400) return;
  throw new Error(`Vikunja register failed: ${res.status} ${await res.text()}`);
}

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: E2E_USER.username,
      password: E2E_USER.password,
    }),
  });
  if (!res.ok) throw new Error(`Vikunja login failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('Vikunja login returned no token');
  return data.token;
}

export type VikunjaHandle = { url: string; token: string };

/**
 * Start Vikunja (if not already up), wait for health, register a user, and
 * mint a JWT via login. JWT works as Bearer auth (same as an API token) and
 * avoids version-specific API-token permission lists.
 */
export async function vikunjaUp(): Promise<VikunjaHandle> {
  compose(['up', '-d']);
  await waitForHealthy();
  await registerUser();
  const token = await login();
  return { url: API_BASE, token };
}

/** Stop Vikunja and remove its (tmpfs) volumes. */
export function vikunjaDown(): void {
  compose(['down', '-v']);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'up') {
    const { url, token } = await vikunjaUp();
    writeFileSync(
      ENV_FILE,
      `VIKUNJA_URL=${url}\nVIKUNJA_API_TOKEN=${token}\n`
    );
    console.log(`[vikunja] up at ${url} — creds written to .env.e2e`);
  } else if (cmd === 'down') {
    vikunjaDown();
    console.log('[vikunja] down');
  } else {
    console.error('usage: tsx scripts/vikunja-docker.ts <up|down>');
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === thisFile;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
