import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceDir = dirname(dirname(appDir));
const nuxtCli = resolveBinary([
  resolve(appDir, 'node_modules/nuxt/bin/nuxt.mjs'),
  resolve(workspaceDir, 'node_modules/nuxt/bin/nuxt.mjs')
]);
const vueTscCli = resolveBinary([
  resolve(appDir, 'node_modules/vue-tsc/bin/vue-tsc.js'),
  resolve(workspaceDir, 'node_modules/vue-tsc/bin/vue-tsc.js')
]);

run(process.execPath, [nuxtCli, 'prepare']);
run(process.execPath, [
  vueTscCli,
  '--noEmit',
  '--project',
  resolveBinary([
    resolve(appDir, '.nuxt/tsconfig.json'),
    resolve(appDir, '.nuxt/tsconfig.app.json')
  ])
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveBinary(candidates) {
  const match = candidates.find((candidate) => existsSync(candidate));

  if (!match) {
    throw new Error(`Unable to resolve binary from candidates: ${candidates.join(', ')}`);
  }

  return match;
}
