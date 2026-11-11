import { loadConfig } from './config.js';
import { createApplication } from './server.js';
import { createLogger } from './logging.js';
import { createServer } from 'node:http';
const log = createLogger();
try {
  const config = loadConfig(process.env);
  const application = createApplication(config, log);
  const http = createServer(application.app);
  http.requestTimeout = config.REQUEST_TIMEOUT_MS + 10000;
  http.headersTimeout = 10000;
  http.on('error', () => { log({ event: 'startup_failed' }); process.exitCode = 1; application.ledger.close(); });
  http.listen(config.PORT, config.HOST, () => { log({ event: 'server_started', mode: config.DEEPSEEK_MODE }); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // In-flight calls have at most REQUEST_TIMEOUT_MS to finish. A hard stop leaves
    // their durable reservations intact, so a restart cannot refund uncertain spend.
    const deadline = setTimeout(() => { log({ event: 'server_stopped' }); process.exit(0); }, config.REQUEST_TIMEOUT_MS + 1000);
    deadline.unref();
    http.close(() => { void application.close().then(() => { clearTimeout(deadline); log({ event: 'server_stopped' }); }); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch {
  // No raw exception/stack or environment dump in logs.
  log({ event: 'startup_failed' });
  process.exitCode = 1;
}
