import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { boardPage } from './juntas-public-api.ts';
import { recentComunicadoDays, isRecentComunicado, tucumanCalendarDay } from './recent-comunicados.ts';
import { publicationSearchQuery } from './publication-search.ts';

test('hoy y ayer cambian en medianoche de Tucumán, sin usar fecha de importación', () => {
  assert.deepEqual(recentComunicadoDays(new Date('2026-11-27T02:59:59Z')), { today: '2026-11-26', yesterday: '2026-11-25' });
  assert.deepEqual(recentComunicadoDays(new Date('2026-11-27T03:00:00Z')), { today: '2026-11-27', yesterday: '2026-11-26' });
  const base = { id: 'notice:com-primaria:synthetic', source: 'Padrones y Comunicados', category: 'Comunicados' };
  const classifiedAct = { ...base, category: 'Actos de designación', source_published_at: '2026-11-25' };
  assert.equal(isRecentComunicado(classifiedAct, new Date('2026-11-27T12:00:00Z')), false);
  assert.equal(isRecentComunicado({ ...base, source_published_at: null }, new Date('2026-11-27T12:00:00Z')), false);
  assert.equal(isRecentComunicado({ ...base, source_published_at: '2026-11-26' }, new Date('2026-11-27T12:00:00Z')), true);
  assert.equal(isRecentComunicado({ ...base, source_published_at: '2026-11-25' }, new Date('2026-11-27T12:00:00Z')), false);
  assert.equal(isRecentComunicado({ ...base, id: 'drive:other', source_published_at: null }, new Date('2026-11-27T12:00:00Z')), true);
  assert.equal(tucumanCalendarDay(new Date('2026-11-27T03:00:00Z')), '2026-11-27');
});

test('API paginada muestra solo avisos individuales recientes y conserva filas antiguas', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE publications (id TEXT, source TEXT, kind TEXT, category TEXT, metadata TEXT, removed_at TEXT, source_published_at TEXT, junta TEXT, level TEXT, title TEXT, summary TEXT, updated_at TEXT)');
    const days = recentComunicadoDays();
    const old = new Date(Date.parse(`${days.yesterday}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const meta = JSON.stringify({ official: { sourceCategory: 'Comunicados' } });
    const insert = db.prepare("INSERT INTO publications VALUES (?,'Padrones y Comunicados','junta','Comunicados',?,NULL,?,'Secundaria','','Aviso','', '2026-11-27')");
    for (const [id, date] of [['notice:today', days.today], ['notice:yesterday', days.yesterday], ['notice:old', old], ['notice:undated', null], ['padrones:folder', days.today], ['notice:old-actos', old]] as const) insert.run(id, meta, date);
    db.prepare("UPDATE publications SET category='Actos de designación' WHERE id='notice:old-actos'").run();
    const adapter = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ all: async () => ({ results: db.prepare(sql).all(...params as []) }) }) }) };
    const response = await boardPage(new Request('https://local.invalid/api/boards?view=comunicados'), () => adapter as never);
    assert.equal(response.status, 200);
    const result = await response.json() as { items: { id: string }[]; nextCursor: string | null };
    assert.deepEqual(result.items.map(row => row.id), ['notice:today', 'notice:yesterday']);
    assert.equal(result.nextCursor, null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM publications').get()?.n, 6);
    const search = publicationSearchQuery('', undefined, 20, 'junta');
    assert.deepEqual(new Set(db.prepare(search.sql).all(...search.params as [] ).map(row => row.id)), new Set(['notice:today', 'padrones:folder', 'notice:yesterday']));
  } finally { db.close(); }
});
