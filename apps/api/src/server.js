import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { readEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { readAuthConfig } from './config/auth.js';
import { readMediaConfig } from './config/media.js';
import { createCloudinaryAdapter } from './modules/media/cloudinary.js';
import { emitEvent, jsonLogger } from './observability/log.js';

export function startServer({
  port = 4000,
  host = '127.0.0.1',
  app = createApp(),
  onClose = async () => {},
  logger = jsonLogger,
} = {}) {
  const server = app.listen(port, host);
  server.once('listening', () => emitEvent(logger, 'application_started'));
  let closing;
  function shutdown() {
    if (closing) return closing;
    closing = new Promise((resolve, reject) => {
      emitEvent(logger, 'shutdown_started');
      const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
      deadline.unref();
      server.close(async (error) => {
        clearTimeout(deadline);
        try {
          await onClose();
          if (error) {
            emitEvent(logger, 'shutdown_failed');
            reject(error);
          } else {
            emitEvent(logger, 'shutdown_completed');
            resolve();
          }
        } catch (closeError) {
          emitEvent(logger, 'shutdown_failed');
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
  try {
    const config = readEnv();
    const authConfig = readAuthConfig();
    const mediaConfig = readMediaConfig();
    const database = createDatabase(config.databaseUrl);
    const mediaAdapter = createCloudinaryAdapter({
      config: mediaConfig,
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
        shippingPolicy: config.shippingPolicy,
      }),
      onClose: database.close,
    });
    runtime.server.on('listening', () => {
      if (process.send) process.send({ type: 'ready' });
    });
    runtime.server.on('error', () => {
      emitEvent(jsonLogger, 'application_listen_failed');
      process.exitCode = 1;
      void stop();
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
  } catch {
    emitEvent(jsonLogger, 'application_configuration_failed');
    process.exitCode = 1;
  }
}
