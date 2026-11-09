import assert from'node:assert/strict';import test from'node:test';import{readFileSync}from'node:fs';
import{createInfdRegistrationVerifier}from'./infd-registration.mjs';
const now=new Date('2026-11-09T12:00:00-03:00'),url='https://aulastic.infd.edu.ar/catalogo.cgi?wAccion=oferta_view&oferta_id=736';
const html=readFileSync(new URL('../lib/fixtures/infd-offer-unavailable.html',import.meta.url),'utf8');
const item=(registrationUrl=url)=>({id:'infd:test',title:'Curso local',status:'consultar',metadata:{entity:'course',trainingId:'infd:test',registrationUrl}});
test('decodifica ISO-8859-1 y conserva el registro con estado no disponible',async()=>{
  let requests=0;const verify=createInfdRegistrationVerifier(async(value,options)=>{requests++;assert.equal(value,url);assert.equal(options.redirect,'error');return new Response(Buffer.from(html,'latin1'),{headers:{'Content-Type':'text/html; charset=iso-8859-1'}});},now);
  const a=await verify(item()),b=await verify(item());assert.equal(requests,1);assert.equal(a.status,'oferta no disponible');assert.equal(a.id,'infd:test');assert.equal(b.metadata.registrationVerification.status,'UNAVAILABLE');
});
test('presupuesto global de tres GET, caché por enlace y errores aislados sin cierres masivos',async()=>{
  let requests=0;const verify=createInfdRegistrationVerifier(async()=>{requests++;throw Error('network timeout');},now);
  for(const id of ['736','737','738','739']){const row=await verify(item(url.replace('736',id)));assert.equal(row.status,'consultar');assert.equal(row.metadata.registrationVerification.status,'UNVERIFIED');}
  assert.equal(requests,3);const other=await verify(item('https://postitulos.conectarigualdad.edu.ar/inscripcion'));assert.equal(other.metadata.registrationVerification,undefined);assert.equal(requests,3);
  assert.throws(()=>createInfdRegistrationVerifier(fetch,now,4),/BUDGET/);
});
test('respuesta enorme o charset inválido falla como no verificada',async()=>{
  for(const response of [new Response('x',{headers:{'content-length':'262145'}}),new Response(html,{headers:{'Content-Type':'text/html; charset=unsupported'}})]){
    const row=await createInfdRegistrationVerifier(async()=>response,now)(item());assert.equal(row.metadata.registrationVerification.status,'UNVERIFIED');assert.equal(row.status,'consultar');
  }
});
