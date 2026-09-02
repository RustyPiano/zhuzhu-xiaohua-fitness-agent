import { spawn, type ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [];
const run = (label: string, args: string[]) => {
  const child = spawn('pnpm', args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal || (code !== null && code !== 0)) {
      console.error(`${label} 已停止${signal ? `（${signal}）` : `（退出码 ${code}）`}`);
      shutdown(code ?? 1);
    }
  });
};
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250).unref();
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

run('API', ['exec', 'tsx', 'watch', 'server/index.ts']);
run('Web', ['exec', 'vite', '--host', '127.0.0.1']);
