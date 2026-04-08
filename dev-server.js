import { createServer } from 'vite';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

// Start Express API server as a SEPARATE child process so heavy sync
// work cannot block Vite's event loop
const api = spawn('/opt/homebrew/bin/node', ['server/index.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: '3001' },
  stdio: 'inherit',
});

api.on('error', (err) => console.error('API server error:', err));
api.on('exit', (code) => {
  if (code !== 0) console.error('API server exited with code', code);
});

process.on('exit', () => api.kill());
process.on('SIGINT', () => { api.kill(); process.exit(0); });
process.on('SIGTERM', () => { api.kill(); process.exit(0); });

// Start Vite in this process
const server = await createServer({
  root: __dirname,
  server: { port: 5173 },
});
await server.listen();
server.printUrls();
