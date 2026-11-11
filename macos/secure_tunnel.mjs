/** Fixed private tunnel command. Runtime credentials stay in macOS Keychain. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { secrets } from 'bun';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const alias='deepseek-personal';
const profileDir=join(root,'.private/tunnel-profiles');
const binary=join(root,'.runtime/tunnel/tunnel-client');
const action=process.argv[2];
const quote=value=>`'${value.replaceAll("'", "'\\''")}'`;
try {
  const settings=JSON.parse(readFileSync(join(root,'.private/tunnel-settings.json'),'utf8'));
  if(!/^tunnel_[a-zA-Z0-9]+$/.test(settings.tunnel_id)) throw new Error('invalid tunnel identity');
  let args;
  let key;
  if(action==='connect'||action==='doctor') {
    key=await secrets.get({service:settings.keychain_service,name:settings.keychain_name});
    if(!key||!key.startsWith('sk-')||/\s/.test(key)) throw new Error('runtime key unavailable');
  }
  if(action==='connect') {
    const command=[settings.node_executable,`--env-file=${join(root,'.env')}`,join(root,'dist/src/stdio.js')].map(quote).join(' ');
    args=[binary,'runtimes','connect','--alias',alias,'--tunnel-id',settings.tunnel_id,
      '--profile',alias,'--profile-dir',profileDir,'--runtime-api-key','env:CONTROL_PLANE_API_KEY',
      '--mcp-command',command,'--json'];
  } else if(action==='doctor') {
    args=[binary,'doctor','--profile',alias,'--profile-dir',profileDir,'--explain'];
  } else if(action==='status'||action==='stop') {
    args=[binary,'runtimes',action,alias,'--json'];
  } else throw new Error('unsupported action');
  const runtimeEnv=Object.fromEntries(['HOME','PATH','TMPDIR','USER','LOGNAME','LANG','LC_ALL','TZ',
    'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','ENTERPRISE_CA_BUNDLE']
    .filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]));
  if(key) runtimeEnv.CONTROL_PLANE_API_KEY=key;
  // Bun loads .env automatically. Do not forward the DeepSeek or local MCP key
  // to the tunnel daemon; the isolated Node command reads its own .env file.
  const child=Bun.spawn(args,{cwd:root,env:runtimeEnv,
    stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  process.on('SIGINT',()=>child.kill('SIGINT'));
  process.on('SIGTERM',()=>child.kill('SIGTERM'));
  const [stdout,stderr,code]=await Promise.all([
    new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited,
  ]);
  if(action==='doctor') {
    console.log(JSON.stringify({action,passed:code===0,exit_code:code}));
  } else {
    let report={};
    try { report=JSON.parse(stdout); } catch {}
    const summary={action,alias,tunnel_id:settings.tunnel_id,exit_code:code,
      process_running:report.process_running??report.local?.process_running,
      healthy:report.healthy,ready:report.ready,
      runtime_state:report.runtime_state??report.local?.runtime_state,
      ui_url:report.ui_url};
    // Avoid echoing vendor log tails, tool payloads or environment snapshots.
    console.log(JSON.stringify(summary));
  }
  if(code!==0) console.error('Tunnel command failed; inspect the private local runtime logs. No raw vendor output was printed.');
  process.exitCode=code;
} catch {
  console.error('Private tunnel command failed. Check local settings, Keychain permission and runtime status; no credential was printed.');
  process.exitCode=1;
}
