import assert from 'node:assert/strict';
import test from 'node:test';
import { padronDocuments, padronFacts, padronSelection, padronTitleFacts } from './padron-documents.ts';
import type { Publication } from './types.ts';

const row = (title: string, junta = 'Técnica, Agrotécnica y No Formal') => ({
  id: 'drive:pad-tecnica:local-fixture', title, junta, kind: 'junta', category: 'Padrones',
  source: 'Padrones y Comunicados', metadata: '{}', official_url: 'https://drive.google.com/file/d/local-fixture/view',
} as Publication);

test('official PD/PP procedures expose their explicit year and preserve provisional/definitive distinctions', () => {
  for (const [title, type] of [
    ['PD INT Y SUP 2026 - FORMACION PROFESIONAL - CIRCUITO III.pdf', 'Definitivo'],
    ['PP INT Y SUP 2026 - MEP JEFE SECCION - ESC TEC MONTEROS.pdf', 'Provisorio'],
    ['PP CONCENTRACION 2026 - ESC. TECNICA EL MOLLAR.pdf', 'Provisorio'],
    ['PD ASC JER 2026 - FORMACION PROFESIONAL - CIRCUITO V.pdf', 'Definitivo'],
  ]) {
    const facts = padronFacts(row(title));
    assert.equal(facts.year, 2026);
    assert.equal(facts.type, type);
    assert.equal(padronSelection(padronDocuments([row(title)]), new Date('2026-11-26T12:00:00-03:00')).current.length, 1);
  }
});
test('ascenso, concurso and general interinatos are distinguishable without implying current validity', () => {
  assert.equal(padronFacts(row('PADRÓN PROVISORIO - ASCENSO 2026 - DIRECTOR NIVEL INICIAL.pdf')).scope, 'Ascenso');
  assert.equal(padronFacts(row('PD ASC JER 2026 - CIRCUITO V.pdf')).scope, 'Ascenso');
  assert.equal(padronFacts(row('PADRON DEFINITIVO DE ANTECEDENTES Y OPOSICION 2025.pdf')).scope, 'Concurso');
  assert.equal(padronFacts(row('PD INT Y SUP 2026 - CIRCUITO III.pdf')).scope, null);
});
test('explicit prefix year and long document labels are not silently lost', () => {
  assert.equal(padronTitleFacts('2026 - PADRON PROVISORIO - TRASLADOS - EDUCACION FISICA.pdf').year, 2026);
  assert.equal(padronTitleFacts('PADRON DEFINITIVO DE ANTECEDENTES ASCENSO DE JERARQUIA EN TITULARIDAD 2026.pdf').year, 2026);
});
test('explicit year of a typed concurso document does not turn it into a general padrón', () => {
  for (const title of [
    '_PADRÓN DEFINITIVO PARA CONCURSO ANTECEDENTES Y OPOSICIÓN - DIRECTOR DE NIVEL PRIMARIA 2026.pdf',
    'PADRON DEF DE ANTECEDENTES CONCURSO ASCENSO DE JERARQUIA 2026 - ISET.pdf',
  ]) {
    assert.equal(padronFacts(row(title)).year, 2026);
    assert.ok(padronFacts(row(title)).scope);
    assert.equal(padronFacts(row(title)).type, 'Definitivo');
  }
  assert.equal(padronTitleFacts('Padrón de concurso 2026').year, null);
});
test('timestamps, document codes, publication dates and ambiguous years are not padrón years', () => {
  for (const title of ['33 - PDVC-20260628-133824.pdf', 'SECUNDARIA COLONIA 14.pdf', 'CIRCUITO I.pdf',
    'PD 2026 - archivo.pdf', 'Padrón actualizado en Drive 2026', 'Padrón de convocatoria 2026',
    'Padrón Especial · Resolución 2026', 'Padrón Provisorio 2025 y 2026']) {
    assert.equal(padronTitleFacts(title).year, null, title);
  }
});
test('download timestamps do not promote undated or historical documents to current-year documents', () => {
  const old = { ...row('PD INT Y SUP 2025 - ESCUELA.pdf'), updated_at: '2026-11-26' };
  const unknown = { ...row('ESCUELA.pdf'), id: 'unknown', updated_at: '2026-11-26' };
  const selected = padronSelection([old, unknown], new Date('2026-11-26T12:00:00-03:00'));
  assert.equal(selected.year, 2025);
  assert.deepEqual(selected.current, [old]);
  assert.deepEqual(selected.undetermined, [unknown]);
});
