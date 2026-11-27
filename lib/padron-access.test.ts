import test from 'node:test';
import assert from 'node:assert/strict';
import {padronAccess,padronFooterSources} from './padron-documents.ts';
import {newOfficial,withOfficial} from './official-publication.ts';
import {driveEntryUrl} from './public-documents.ts';
import {JUNTA_EXTERNAL_SOURCES} from './junta-external-sources.ts';
import type {Publication} from './types.ts';

const original='https://drive.google.com/file/d/old-public-document/view';
const folder='https://drive.google.com/drive/folders/official-ascenso';
function item(access?:string,alternative=folder){
 const official=newOfficial('padron','Secundaria',[],'Padrones');
 if(access)official.facts.documentAccess={value:access,precision:'text',status:'reported',evidence:[]};
 official.facts.documentFolder={value:alternative,precision:'text',status:'reported',evidence:[]};
 return {id:'drive:pad-secundaria:old-public-document',kind:'junta',category:'Padrones',official_url:original,metadata:withOfficial('{}',official)} as Publication;
}
test('an unavailable document offers the verified folder without replacing the stored file URL',()=>{
 const row=item('unavailable');
 assert.deepEqual(padronAccess(row),{unavailable:true,directUrl:null,folderUrl:folder});
 assert.equal(row.official_url,original);
});
test('a public folder alone does not prove that its documents are available or unavailable',()=>{
 assert.deepEqual(padronAccess(item()),{unavailable:false,directUrl:original,folderUrl:null});
 assert.equal(padronAccess(item('available')).directUrl,original);
});
test('untrusted alternatives and non-document records cannot turn into PDF replacements',()=>{
 for(const url of ['javascript:alert(1)','https://example.com/drive/folders/id','https://drive.google.com/file/d/not-a-folder/view','https://user@drive.google.com/drive/folders/id'])
  assert.equal(padronAccess(item('unavailable',url)).folderUrl,null);
 const row=item('unavailable');row.kind='capacitacion';assert.equal(padronAccess(row).unavailable,false);
});
test('a folder move retains file identity; a replacement uses a different URL',()=>{
 const before={id:'same-file',mimeType:'application/pdf',parent:'old-folder'};
 const after={...before,parent:'new-folder'};
 assert.equal(driveEntryUrl(before),driveEntryUrl(after));
 assert.notEqual(driveEntryUrl({...after,id:'replacement-file'}),driveEntryUrl(before));
});
test('the inaccessible historical Secundaria record uses exactly the footer root, without changing stored evidence or other links',()=>{
 const row=item('unavailable');
 row.id='drive:pad-secundaria:1NdgFtOpLdWN33RETK0wY5Z5AkayO615H';
 const before=JSON.stringify(row);
 const officialRoot=JUNTA_EXTERNAL_SOURCES.find(source=>source[0]==='pad-secundaria')![3];
 assert.deepEqual(padronAccess(row),{unavailable:true,directUrl:null,folderUrl:officialRoot});
 assert.equal(JSON.stringify(row),before);
 assert.equal(padronAccess(item('unavailable')).folderUrl,folder);
 assert.equal(padronAccess({...row,metadata:item('available').metadata}).directUrl,original);
});
test('a visible alternative removes only the equivalent footer link, retaining other Juntas',()=>{
 const row=item('unavailable');row.id='drive:pad-secundaria:1NdgFtOpLdWN33RETK0wY5Z5AkayO615H';
 assert.deepEqual(padronFooterSources([row]).map(source=>source[0]),['pad-primaria','pad-tecnica','pad-superior']);
 assert.equal(padronFooterSources([row],'secundaria').length,0);
 assert.equal(padronAccess(row).unavailable,true);
});
test('an absent or search-filtered card restores the official folder access',()=>{
 assert.equal(padronFooterSources([]).length,4);
 assert.equal(padronFooterSources([],'secundaria')[0][0],'pad-secundaria');
 const row=item('available');row.id='drive:pad-secundaria:1NdgFtOpLdWN33RETK0wY5Z5AkayO615H';
 assert.equal(padronFooterSources([row],'secundaria').length,1);
});
test('a subfolder alternative does not hide the distinct main official folder',()=>{
 assert.equal(padronFooterSources([item('unavailable')],'secundaria').length,1);
});
