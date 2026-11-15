#!/usr/bin/env node
/* Définit (ou change) le mot de passe de l'administration.
   Usage : npm run password            (saisie masquée)
           ADMIN_NEW_PASSWORD=... node tools/set-password.mjs   (non interactif) */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { saveCredentials, passwordProblem } from '../backend/lib/auth.mjs';

function ask(question) {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({ write(chunk, _enc, cb) { if (!muted) process.stdout.write(chunk); cb(); } });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

let pw = process.env.ADMIN_NEW_PASSWORD;
if (!pw) {
  pw = await ask('Nouveau mot de passe (10 caractères minimum) : ');
  const again = await ask('Confirmez : ');
  if (pw !== again) { console.error('Les deux saisies sont différentes.'); process.exit(1); }
}
const problem = passwordProblem(pw);
if (problem) { console.error(problem); process.exit(1); }
await saveCredentials(pw);
console.log('Mot de passe enregistré (data/auth.json). Toutes les sessions ouvertes sont déconnectées.');
