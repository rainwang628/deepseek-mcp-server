import { fileURLToPath, pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { BudgetLedger } from './ledger.js';
import { createLogger } from './logging.js';
import { createMcpServer } from './server.js';
import { DeepSeekService } from './service.js';

export async function startPrivateStdio() {
  // Global clients may launch us from any directory. Share the same relative
  // ledger and operator configuration as the HTTP service in this project.
  process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
  const log = createLogger(line => { process.stderr.write(line); });
  let ledger: BudgetLedger | undefined;
  try {
    const config = loadConfig(process.env);
    ledger = new BudgetLedger(config.LEDGER_PATH);
    const server = createMcpServer(new DeepSeekService(config, ledger, log), { privateStdio: true });
    const transport = new StdioServerTransport();
    server.server.onerror = () => { log({ event: 'transport_error' }); };
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await server.close().catch(() => {});
      ledger?.close();
      ledger = undefined;
      log({ event: 'server_stopped' });
    };
    server.server.onclose = () => { void stop(); };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    process.once('exit', () => { ledger?.close(); });
    await server.connect(transport);
    log({ event: 'server_started', mode: config.DEEPSEEK_MODE });
  } catch {
    ledger?.close();
    ledger = undefined;
    log({ event: 'startup_failed' });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startPrivateStdio();
}
