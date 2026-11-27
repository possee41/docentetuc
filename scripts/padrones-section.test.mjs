import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JUNTA_EXTERNAL_SOURCES} from '../lib/junta-external-sources.ts';

const require=createRequire(fs.realpathSync('node_modules/wrangler/package.json'));
const file=resolve('.wrangler/padrones-2026/component.mjs');
fs.mkdirSync(resolve('.wrangler/padrones-2026'),{recursive:true});
require('esbuild').buildSync({entryPoints:['components/padrones-section.tsx'],outfile:file,
  bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
const {PadronesSection}=await import(pathToFileURL(file).href);
const html=renderToStaticMarkup(React.createElement(PadronesSection));
fs.writeFileSync('.wrangler/padrones-2026/section.html',html);

test('Padrones 2026 renders four named Juntas with exactly one main-Drive button each',()=>{
 assert.match(html,/>Padrones 2026<\/h1>/);
 assert.equal((html.match(/<article\b/g)||[]).length,4);
 assert.equal((html.match(/<a\b/g)||[]).length,4);
 for(const [,category,junta,url] of JUNTA_EXTERNAL_SOURCES){
  if(category!=='Padrones')continue;
  assert.ok(html.includes(`>${junta}</h2>`));
  assert.equal(html.split(`href="${url.replaceAll('&','&amp;')}"`).length-1,1);
  assert.ok(html.includes(`aria-label="Abrir Drive oficial de ${junta}"`));
 }
 assert.equal((html.match(/>Abrir Drive oficial /g)||[]).length,4);
});
test('the new screen contains no legacy controls, individual documents or claims of current validity',()=>{
 for(const obsolete of ['Últimos por Junta','Historial','Año no determinado','Carpetas y avisos','<select','<details','/file/d/','Ver detalle','No existen padrones','actualizados'])assert.ok(!html.includes(obsolete),obsolete);
 assert.equal((html.match(/Consultá las publicaciones en el Drive oficial/g)||[]).length,4);
 assert.ok(html.includes('ascensos, concursos e interinatos y suplencias son procedimientos distintos'));
});
