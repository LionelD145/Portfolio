#!/usr/bin/env node
/* Régénère index.html depuis data/content.json (sans lancer le serveur).
   Usage : npm run render            (écrit index.html)
           node tools/render.mjs --out autre.html */
import { writeFile } from 'node:fs/promises';
import { readContent, publish } from '../backend/lib/store.mjs';
import { renderSite } from '../backend/lib/render.mjs';

const i = process.argv.indexOf('--out');
const { content } = await readContent();
if (i !== -1 && process.argv[i + 1]) {
  await writeFile(process.argv[i + 1], renderSite(content), 'utf8');
  console.log(`Rendu écrit dans ${process.argv[i + 1]}`);
} else {
  await publish(content);
  console.log('index.html régénéré depuis data/content.json');
}
