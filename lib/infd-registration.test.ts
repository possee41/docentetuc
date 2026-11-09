import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {infdOfferUrl,parseInfdOffer} from './infd-registration.ts';
import {enrollmentState,canScheduleTrainingReminder,type TrainingMetadata} from './training.ts';
import {publicationLifecycleForDisplay,eligiblePersonalPublication} from './personalized-catalog.ts';
import type {Publication,Profile} from './types.ts';
const url='https://aulastic.infd.edu.ar/catalogo.cgi?wAccion=oferta_view&oferta_id=736',title='Curso local',now=new Date('2026-11-09T12:00:00-03:00');
const unavailable=readFileSync(new URL('./fixtures/infd-offer-unavailable.html',import.meta.url),'utf8');
const detail=(text:string,id='736',heading=title)=>`<main><h1>${heading}</h1><form><input type="hidden" name="oferta_id" value="${id}">${text}</form></main>`;
test('fragmento real: 200 con aviso oficial no usa la oferta abierta 756 del catálogo alternativo',()=>{
  const result=parseInfdOffer(unavailable,url,title,200,now);
  assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,'OFFICIAL_UNAVAILABLE_NOTICE');
  const fallback=unavailable.replace('La oferta no está disponible','');
  assert.equal(parseInfdOffer(fallback,url,title,200,now).status,'UNVERIFIED');
});
test('estado abierto/cerrado exige identidad propia y evidencia explícita; fecha futura no basta',()=>{
  assert.equal(parseInfdOffer(detail('Inscripción abierta <button>Inscribirme</button>'),url,title,200,now).status,'OPEN');
  assert.equal(parseInfdOffer(detail('Inscripción cerrada'),url,title,200,now).status,'CLOSED');
  assert.equal(parseInfdOffer(detail('Inicio 20/12/2026'),url,title,200,now).status,'UNVERIFIED');
  assert.equal(parseInfdOffer(detail('Inscripción abierta <button>Inscribirme</button>','756'),url,title,200,now).status,'UNVERIFIED');
  assert.equal(parseInfdOffer(detail('Inscripción abierta <button>Inscribirme</button>','736','Otro curso'),url,title,200,now).status,'UNVERIFIED');
  assert.equal(parseInfdOffer(detail('<div class="otras-ofertas">Inscripción abierta <button>Inscribirme</button></div>'),url,title,200,now).status,'UNVERIFIED');
});
test('HTTP fallido o formato incompleto no se confunde con oferta retirada',()=>{
  assert.equal(parseInfdOffer(unavailable,url,title,503,now).status,'UNVERIFIED');
  assert.equal(parseInfdOffer('',url,title,404,now).status,'UNAVAILABLE');
  assert.equal(parseInfdOffer('<main>La oferta no est&aacute; disponible</main>',url,title,200,now).status,'UNAVAILABLE');
  for(const value of ['http://aulastic.infd.edu.ar/catalogo.cgi?wAccion=oferta_view&oferta_id=736',url+'&oferta_id=756',url+'&redirect=https://evil.example',url.replace('aulastic.infd.edu.ar','localhost')])assert.equal(infdOfferUrl(value),null);
});
test('presentación distingue cuatro estados y no convierte calendarios o verificaciones caducadas en inscripción válida',()=>{
  const metadata:TrainingMetadata={entity:'course',trainingId:'infd:local',registrationUrl:url,dateStatus:'confirmed',registrationHasTime:true,registrationOpensAt:'2026-11-01T10:00:00-03:00',registrationClosesAt:'2026-12-01T10:00:00-03:00'};
  assert.equal(enrollmentState(metadata,'inscripción abierta','ACTIVE',now),'SIN_FECHA_CONFIRMADA');
  for(const [status,state]of [['OPEN','ABIERTA'],['CLOSED','CERRADA'],['UNAVAILABLE','NO_DISPONIBLE'],['UNVERIFIED','SIN_FECHA_CONFIRMADA']]as const){
    const m={...metadata,registrationVerification:{status,url,checkedAt:now.toISOString(),reason:'LOCAL_TEST'}};
    assert.equal(enrollmentState(m,'inscripción abierta','ACTIVE',now),state);
    if(status==='UNAVAILABLE'){
      assert.equal(canScheduleTrainingReminder({...m,registrationOpensAt:'2026-12-01T10:00:00-03:00'},'próximamente','UPCOMING',now),false);
      const publication={kind:'capacitacion',metadata:JSON.stringify(m),source:'INFoD / AulaS-TIC',status:'inscripción abierta',normalized_status:'ACTIVE'}as Publication;
      assert.equal(publicationLifecycleForDisplay(publication,now),'CLOSED');assert.equal(eligiblePersonalPublication(publication,{}as Profile,'capacitacion',now),false);
    }
  }
  const open={status:'OPEN' as const,url,checkedAt:'2026-11-01T12:00:00-03:00',reason:'LOCAL_TEST'};
  assert.equal(enrollmentState({...metadata,registrationVerification:open},'inscripción abierta','ACTIVE',now),'SIN_FECHA_CONFIRMADA');
  assert.equal(enrollmentState({...metadata,registrationVerification:{...open,checkedAt:now.toISOString(),url:url.replace('736','737')}},'inscripción abierta','ACTIVE',now),'SIN_FECHA_CONFIRMADA');
  assert.equal(enrollmentState({...metadata,trainingId:'cenet:local'},'inscripción abierta','ACTIVE',now),'ABIERTA','CeNET conserva su regla anterior');
});
