const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const filename = path.resolve('src/lib/gigxomi/conversation-memory-core.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(compiled, filename);
const { scopeKey, normalizeMemoryMessages, assembleMemory, validateSummary, conversationRevision, memoryMode } = mod.exports;
const scope = {tenantId:'agency-a', accountId:'whatsapp-a', conversationId:'lead-a'};
const history = Array.from({length:120}, (_,i)=>({id:`m${i}`,role:i%2?'assistant':'user',content:`turn ${i}: discussed editing workflow and requirements`}));
history[0].content='I work solo and manage 3 clients on WhatsApp.';
history[80].content='Update: now I have 4 editors on my team.';

test('same customer across tenant/account/conversation never shares scope',()=>{
 const keys=[scope, {...scope,tenantId:'agency-b'}, {...scope,accountId:'whatsapp-b'}, {...scope,conversationId:'lead-b'}, {...scope,namespace:'test'}].map(scopeKey);
 assert.equal(new Set(keys).size,5); assert.throws(()=>scopeKey({...scope,accountId:''}));
});
test('120 turns retain exact old evidence plus latest context inside budget',()=>{
 const before=JSON.stringify(history);
 const p=assembleMemory(history,[],[history[80],history[0]]);
 assert(p.messages.some(m=>m.content.includes('4 editors')));
 assert(p.messages.some(m=>m.content.includes('3 clients')));
 assert.equal(p.messages.at(-1).content,history.at(-1).content);
 assert(p.estimatedTokens<=6000); assert.equal(JSON.stringify(history),before);
});
test('oversized original is not silently truncated or represented as read',()=>{
 const p=assembleMemory([{id:'big',role:'user',content:'x'.repeat(20000)}],[],[]);
 assert(p.degraded); assert(p.estimatedTokens<=6000); assert(p.messages[0].content.includes('exceeds'));
});
test('summary only accepts real source references',()=>{
 const s=validateSummary(JSON.stringify({summary:'Changed from solo to team.',facts:[{key:'team',value:'4',sourceIds:['m80','invented']},{key:'fake',value:'paid',sourceIds:['invented']}]}),history);
 assert.equal(s.facts.length,1); assert.deepEqual(s.facts[0].sourceIds,['m80']);
});
test('hierarchy retains exact original refs',()=>{
 const child={id:'n1',text:'solo',facts:[],sourceIds:['m0'],childIds:[],level:0};
 const parent=validateSummary('{"summary":"solo","facts":[]}',[],[child]);
 assert.deepEqual(parent.childIds,['n1']); assert.deepEqual(parent.sourceIds,['m0']); assert.equal(parent.level,1);
});
test('internal notes never become customer messages',()=>{
 const m=normalizeMemoryMessages([{id:'private',lane:'internal',senderRole:'admin',body:'internal secret'}, {id:'deleted',deletedAt:'now',senderRole:'customer',body:'old'}, {id:'live',lane:'customer',senderRole:'customer',body:'hello'}]);
 assert.deepEqual(m.map(x=>x.id),['live']);
});
test('stale-turn fingerprint changes on inbound, handover and status changes',()=>{
 const c={messages:[{id:'1',body:'yes'}],leadStatusId:'new'};
 const base=conversationRevision(c);
 assert.notEqual(base,conversationRevision({...c,messages:[...c.messages,{id:'2',body:'STOP'}]}));
 assert.notEqual(base,conversationRevision({...c,aiAutoReplyDisabled:true}));
 assert.notEqual(base,conversationRevision({...c,leadStatusId:'human-review'}));
});
test('live rollout requires explicit conversation allowlist',()=>{
 process.env.AI_MEMORY_MODE='live';process.env.AI_MEMORY_LIVE_CONVERSATIONS='lead-a';
 assert.equal(memoryMode('lead-a'),'live');assert.equal(memoryMode('lead-b'),'off');
 process.env.AI_MEMORY_MODE='shadow';assert.equal(memoryMode('lead-b'),'shadow');
 delete process.env.AI_MEMORY_MODE;delete process.env.AI_MEMORY_LIVE_CONVERSATIONS;
});
