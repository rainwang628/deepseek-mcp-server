/** Install a per-user LaunchAgent; no credentials are written to its plist. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const label='com.rain.deepseek-tunnel';
const staged=join(root,'.private',`${label}.plist`);
const installed=join(homedir(),'Library/LaunchAgents',`${label}.plist`);
const domain=`gui/${process.getuid()}`;
const target=`${domain}/${label}`;
const action=process.argv[2];
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const ctl=(...args)=>spawnSync('/bin/launchctl',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
process.umask(0o077);

try {
  if(process.platform!=='darwin') throw new Error('macOS required');
  if(!['render','install','uninstall','status'].includes(action)) throw new Error('use render, install, uninstall or status');
  if(action==='render'||action==='install') {
    const args=[join(root,'.runtime/bun/bun'),join(root,'macos/secure_tunnel.mjs'),'ensure'];
    for(const p of [args[0],args[1],join(root,'.private/tunnel-settings.json')]) {
      if(!existsSync(p)) throw new Error('existing tunnel setup required');
    }
    const plist=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>ProcessType</key><string>Background</string>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>StandardOutPath</key><string>${xml(join(root,'.private/autostart.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(root,'.private/autostart.stderr.log'))}</string>
<key>Umask</key><integer>63</integer>
</dict></plist>
`;
    mkdirSync(dirname(staged),{recursive:true,mode:0o700});
    writeFileSync(staged,plist,{mode:0o600});
    if(action==='install') {
      if(ctl('print',target).status===0&&ctl('bootout',target).status!==0) throw new Error('could not unload previous agent');
      mkdirSync(dirname(installed),{recursive:true,mode:0o700});
      writeFileSync(installed,readFileSync(staged),{mode:0o600});
      if(ctl('enable',target).status!==0||ctl('bootstrap',domain,installed).status!==0) throw new Error('could not load agent');
    }
  } else if(action==='uninstall') {
    if(ctl('print',target).status===0&&ctl('bootout',target).status!==0) throw new Error('could not unload agent');
    rmSync(installed,{force:true});
  }
  const report={action,label,plist:action==='render'?staged:installed,
    installed:existsSync(installed),loaded:ctl('print',target).status===0,
    interval_seconds:60,paused:existsSync(join(root,'.private/tunnel-autostart-paused'))};
  if(action==='install'&&!report.loaded) throw new Error('agent not loaded');
  console.log(JSON.stringify(report));
} catch {
  console.error('Autostart command failed. Check LaunchAgents write permission and the current macOS login session.');
  process.exitCode=1;
}
