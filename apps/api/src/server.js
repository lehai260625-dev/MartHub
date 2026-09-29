import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { readEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { readAuthConfig } from './config/auth.js';
import { readMediaConfig } from './config/media.js';
import { createCloudinaryAdapter } from './modules/media/cloudinary.js';

export function startServer({
  port = 4000,
  host = '127.0.0.1',
  app = createApp(),
  onClose = async () => {},
} = {}) {
  const server = app.listen(port, host);
  let closing;
  function shutdown() {
    if (closing) return closing;
    closing = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
      deadline.unref();
      server.close(async (error) => {
        clearTimeout(deadline);
        try {
          await onClose();
          if (error) reject(error);
          else resolve();
        } catch (closeError) {
          reject(closeError);
        }
      });
    });
    return closing;
  }
  return { server, shutdown };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = readEnv();
  const authConfig = readAuthConfig();
  const database = createDatabase(config.databaseUrl);
  const mediaAdapter = createCloudinaryAdapter({
    config: readMediaConfig(),
  });
  const runtime = startServer({
    port: config.port,
    host: config.host,
    app: createApp({
      readiness: database.ready,
      origin: config.origin,
      prisma: database.prisma,
      authConfig,
      mediaAdapter,
    }),
    onClose: database.close,
  });
  runtime.server.on('listening', () => {
    process.stdout.write('MartHub API listening\n');
    if (process.send) process.send({ type: 'ready' });
  });
  runtime.server.on('error', () => {
    process.stderr.write('API failed to listen\n');
    process.exitCode = 1;
  });
  const stop = () =>
    runtime
      .shutdown()
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => {
        if (process.connected) process.disconnect();
      });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // An IPC shutdown uses the same drain path in portable child-process tests.
  process.on('message', (message) => {
    if (message?.type === 'shutdown') void stop();
  });
}
