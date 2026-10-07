import {copyFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const target=join(root,'supabase','functions','_shared');
mkdirSync(target,{recursive:true});
for(const [source,name] of [
  ['scripts/application-source.mjs','application-source.mjs'],
  ['scripts/google-sheets-source.mjs','google-sheets-source.mjs'],
  ['scripts/public-holidays.mjs','public-holidays.mjs'],
  ['web/data.js','data.js'],
  ['web/rule-engine.js','rule-engine.js'],
  ['web/sheet-application-merge.js','sheet-application-merge.js'],
]) copyFileSync(join(root,source),join(target,name));
