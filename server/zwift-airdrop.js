#!/usr/bin/env node
// Réception sur le Mac des séances envoyées depuis Enduro sur le téléphone.
// Le téléphone les partage par AirDrop : elles arrivent dans Téléchargements,
// et ce script les range dans le dossier d'entraînements de Zwift.
//
//   node server/zwift-airdrop.js              un passage : range ce qui est arrivé
//   node server/zwift-airdrop.js --installer  automatisme macOS : un passage à chaque
//                                             arrivée dans Téléchargements (et à l'ouverture de session)
//   node server/zwift-airdrop.js --retirer    retire l'automatisme
//
// Pour les essais : --inbox <dossier> --zwift <dossier> --sans-notification --journal <fichier>
//                   --label <nom> --plist-dir <dossier>

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { collectInbox } from './zwift.js';

export const LABEL = 'fr.enduro.zwift-airdrop';
export const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

/** La réception AirDrop est-elle installée sur ce Mac ? */
export function airdropInstalled() {
  return existsSync(PLIST);
}

const DAY_NAMES = { lun: 'lundi', mar: 'mardi', mer: 'mercredi', jeu: 'jeudi', ven: 'vendredi', sam: 'samedi', dim: 'dimanche' };
const dayOf = (fileName) => DAY_NAMES[/-(lun|mar|mer|jeu|ven|sam|dim)/.exec(fileName)?.[1]] ?? '';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const stamp = () => new Date().toLocaleString('fr-FR');

function notify(text) {
  if (process.argv.includes('--sans-notification')) return;
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(text)} with title "Enduro → Zwift"`]);
  } catch { /* pas de notification : tant pis */ }
}

async function pass(inbox, zwift) {
  // Un fichier encore en cours de réception est repris quelques secondes plus tard.
  for (let attempt = 0; attempt < 6; attempt++) {
    let result;
    try {
      result = collectInbox(inbox, zwift);
    } catch (err) {
      console.error(`${stamp()}  ${err.message}`);
      notify(err.message);
      process.exitCode = 1;
      return;
    }
    if (result.moved.length) {
      console.log(`${stamp()}  rangé dans Zwift : ${result.moved.join(', ')}`);
      const days = result.moved.map(dayOf).filter(Boolean);
      notify(days.length > 1
        ? `${days.length} séances prêtes dans Zwift (${days.join(', ')}). Relance Zwift si besoin.`
        : `Séance du ${days[0] ?? 'jour'} prête dans Zwift : Entraînements personnalisés.`);
    }
    if (!result.waiting) return;
    await sleep(2000);
  }
}

function install(inbox, zwift) {
  const label = arg('label', LABEL);
  const dir = resolve(arg('plist-dir', join(homedir(), 'Library', 'LaunchAgents')));
  const plist = join(dir, `${label}.plist`);
  const script = fileURLToPath(import.meta.url);
  const custom = [
    ...(arg('inbox') ? ['--inbox', inbox] : []),
    ...(arg('zwift') ? ['--zwift', zwift] : []),
    ...(process.argv.includes('--sans-notification') ? ['--sans-notification'] : []),
  ];
  const logs = resolve(arg('journal', join(homedir(), 'Library', 'Logs', 'enduro-zwift-airdrop.log')));
  const strings = (list) => list.map((s) => `<string>${xmlEscape(s)}</string>`).join('');
  mkdirSync(dir, { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key><array>${strings([process.execPath, script, ...custom])}</array>
  <key>WatchPaths</key><array>${strings([inbox])}</array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(logs)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(logs)}</string>
</dict>
</plist>
`);
  const domain = `gui/${process.getuid()}`;
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch { /* pas encore installé */ }
  execFileSync('launchctl', ['bootstrap', domain, plist]);
  console.log(`Réception AirDrop installée : les séances envoyées depuis le téléphone arrivant dans\n  ${inbox}\nsont rangées dans Zwift (${zwift}).\nJournal : ${logs}\nPour la retirer : npm run zwift:airdrop:retirer`);
}

function uninstall() {
  const label = arg('label', LABEL);
  const plist = join(resolve(arg('plist-dir', join(homedir(), 'Library', 'LaunchAgents'))), `${label}.plist`);
  try { execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); } catch { /* déjà arrêtée */ }
  if (existsSync(plist)) unlinkSync(plist);
  console.log('Réception AirDrop retirée.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inbox = resolve(arg('inbox', join(homedir(), 'Downloads')));
  const zwift = resolve(arg('zwift', join(homedir(), 'Documents', 'Zwift')));
  if (process.argv.includes('--installer')) install(inbox, zwift);
  else if (process.argv.includes('--retirer')) uninstall();
  else await pass(inbox, zwift);
}
