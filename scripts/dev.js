import { spawn } from 'node:child_process';

const commands = [
  [process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.js']],
  [process.execPath, ['node_modules/vite/bin/vite.js']],
];
const children = commands.map(([cmd, args]) => spawn(cmd, args, { stdio: 'inherit' }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill('SIGTERM'));
  process.exitCode = code;
}
children.forEach(child => {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code ?? 0));
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
