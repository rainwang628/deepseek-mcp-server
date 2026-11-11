import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
// Never print the generated credential or read any other application's secrets.
const value = `HOST=127.0.0.1\nPORT=3000\nPUBLIC_URL=http://127.0.0.1:3000/mcp\nAUTH_MODE=bearer\nMCP_BEARER_TOKEN=${randomBytes(32).toString('base64url')}\nDEEPSEEK_MODE=mock\nDEEPSEEK_MODEL=deepseek-v4-pro\nROUTING_ENABLED=false\nALLOW_PAID_REQUESTS=false\nMOCK_DEEPSEEK_URL=http://127.0.0.1:4010\nLEDGER_PATH=data/budget.sqlite\n`;
try { writeFileSync('.env', value, { flag: 'wx', mode: 0o600 }); console.log('Created local .env with routing and paid requests disabled. Credential was not printed.'); }
catch { console.error('Could not create .env. An existing file is never overwritten.'); process.exitCode = 1; }
