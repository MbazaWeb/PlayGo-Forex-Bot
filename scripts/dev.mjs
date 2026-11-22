import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'apps', 'web');
const requireWeb = createRequire(join(web, 'package.json'));
const vite = join(dirname(requireWeb.resolve('vite/package.json')), 'bin', 'vite.js');
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
function start(args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
start(['--env-file-if-exists=.env', 'apps/api/src/index.js'], root, { ...process.env, PORT: '3001' });
start([vite, '--host', '127.0.0.1', '--strictPort', ...process.argv.slice(2)], web);
