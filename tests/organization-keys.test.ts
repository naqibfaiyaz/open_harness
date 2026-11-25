import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const { createOrganizationKeyIntegration, organizationKeyDigest } = requireLC('./packages/api/src/organization/keys.ts');
const express = requireLC('express');
const origin='https://org-a.test';
const organization={enabled:true,name:'Org A',realm:'org-a',issuer:origin+'/realms/org-a',adminURL:'http://identity.test',clientId:'management',bootstrapUserIds:['owner'],timeoutMs:1000,maxMembers:100};
const config={enabled:true,maxKeys:10,defaultExpiryDays:90,maxExpiryDays:365,requestsPerMinute:60,authRequestsPerMinute:300,maxConcurrent:1,recheckMs:30,allowedOrigins:[]};
async function setup(overrides={}) {
 const records=new Map<string, any>(); let role:string|undefined='owner'; const calls:any[]=[];
 const visible=(record:any)=>{ const {keyHash,...value}=record;return value; };
 const store={create:async(record:any)=>{records.set(record.id,record);},countActive:async(issuer:string)=>[...records.values()].filter(r=>r.issuer===issuer&&!r.revokedAt&&Date.parse(r.expiresAt)>Date.now()).length,
 list:async(issuer:string)=>[...records.values()].filter(r=>r.issuer===issuer).map(visible),find:async(hash:string,issuer:string)=>{const r=[...records.values()].find(r=>r.keyHash===hash&&r.issuer===issuer&&!r.revokedAt&&Date.parse(r.expiresAt)>Date.now());return r?visible(r):null;},
 revoke:async(id:string,issuer:string,actor:string)=>{const r=records.get(id);if(!r||r.issuer!==issuer||r.revokedAt)return false;r.revokedAt=new Date().toISOString();r.revokedBy=actor;return true;},touch:async()=>{}};
 const app=express();app.use(express.json());
 const integration=createOrganizationKeyIntegration({config:{...config,...overrides},organization,secret:'fixture',bridgeKey:'private-fixture-at-least-thirty-two-characters',origin,store,
 authenticate:(req:any,_res:any,next:any)=>{req.user={id:'owner'};next();},loadUser:async()=>role?{id:'owner',organizationRole:role}:undefined,
 catalog:async()=>({object:'list',data:[{id:'Agent: default',object:'model',owned_by:'hermes',created:0},{id:'Agent: research',object:'model',owned_by:'hermes',created:0}]}),
 executor:(req:any,res:any)=>{calls.push({headers:{...req.headers},body:req.body});if(req.body.stream){res.type('text/event-stream');res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');}else res.json({choices:[{message:{role:'assistant',content:'hello'}}]});}});
 app.use('/manage',integration.management);app.use('/api/agents/v1',integration.api);
 const server=app.listen(0);await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const create=async(extra={})=>{const r=await fetch(base+'/manage',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'External frontend',expiryDays:30,allowedModels:['Agent: default'],...extra})});return {status:r.status,body:await r.json() as any};};
 const request=(path:string,secret:string,body?:object,headers={})=>fetch(base+'/api/agents/v1'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 return {base,records,calls,create,request,setRole:(value:string|undefined)=>{role=value;},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
test('keys are shown once, hashed, scoped to the issuer and cannot spoof user or conversation namespaces',async()=>{
 const app=await setup();try{
 const first=await app.create({createdBy:'attacker',issuer:'other-org'});assert.equal(first.status,201);
 assert.match(first.body.secret,/^oh_org_[a-f0-9]{64}$/);const record=app.records.get(first.body.key.id);assert.equal(record.createdBy,'owner');assert.equal(record.issuer,organization.issuer);assert.equal(record.keyHash,organizationKeyDigest(first.body.secret));assert.equal(JSON.stringify(record).includes(first.body.secret),false);
 const listing=await(await fetch(app.base+'/manage')).text();assert.equal(listing.includes(first.body.secret),false);assert.equal(listing.includes('keyHash'),false);
 const models=await(await app.request('/models',first.body.secret)).json() as any;assert.deepEqual(models.data.map((m:any)=>m.id),['Agent: default']);
 assert.equal((await app.request('/chat/completions',first.body.secret,{model:'Agent: research',messages:[]})).status,403);
 assert.equal((await app.request('/models',first.body.secret,undefined,{Origin:'https://unapproved.test'})).status,403);
 await app.request('/chat/completions',first.body.secret,{model:'Agent: default',messages:[],user:'attacker',profile:'other'},{'X-Conversation-Id':'chat-1','X-LibreChat-User-Id':'attacker','X-LibreChat-Conversation-Id':'foreign'});
 assert.equal(app.calls[0].headers['x-librechat-user-id'],'owner');assert.match(app.calls[0].headers['x-librechat-conversation-id'],/^external-[a-f0-9]{64}$/);
 const second=await app.create();await app.request('/chat/completions',second.body.secret,{model:'Agent: default',messages:[]},{'X-Conversation-Id':'chat-1'});
 assert.notEqual(app.calls[0].headers['x-librechat-conversation-id'],app.calls[1].headers['x-librechat-conversation-id']);
 record.issuer='foreign-issuer';assert.equal((await app.request('/models',first.body.secret)).status,401);
 }finally{await app.close();}
});
test('revocation, expiry and lost organization privileges fail closed and active streams are cancelled',async()=>{
 const app=await setup();try{
 const key=(await app.create()).body;
 const streaming=await app.request('/chat/completions',key.secret,{model:'Agent: default',messages:[],stream:true});const reader=streaming.body!.getReader();assert.equal((await reader.read()).done,false);
 assert.equal((await app.request('/chat/completions',key.secret,{model:'Agent: default',messages:[]})).status,429);
 const revoked=await fetch(app.base+'/manage/'+key.key.id,{method:'DELETE',headers:{Origin:origin}});assert.equal(revoked.status,204);
 await assert.rejects(reader.read());assert.equal((await app.request('/models',key.secret)).status,401);
 const second=(await app.create()).body;app.records.get(second.key.id).expiresAt=new Date(0).toISOString();assert.equal((await app.request('/models',second.secret)).status,401);
 const third=(await app.create()).body;app.setRole('user');assert.equal((await app.request('/models',third.secret)).status,401);
 app.setRole(undefined);assert.equal((await app.request('/models',third.secret)).status,401);
 }finally{await app.close();}
});
test('key rate limits and same-origin management are enforced',async()=>{
 const app=await setup({requestsPerMinute:1});try{
 const forbidden=await fetch(app.base+'/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);
 const key=(await app.create()).body;assert.equal((await app.request('/models',key.secret)).status,200);assert.equal((await app.request('/models',key.secret)).status,429);
 }finally{await app.close();}
});

test('organization concurrency spans keys and live privilege loss interrupts streaming',async()=>{
 const app=await setup({maxConcurrent:2,maxOrgConcurrent:1});try{
 const first=(await app.create()).body;const second=(await app.create()).body;
 const response=await app.request('/chat/completions',first.secret,{model:'Agent: default',messages:[],stream:true});
 const reader=response.body!.getReader();assert.equal((await reader.read()).done,false);
 assert.equal((await app.request('/chat/completions',second.secret,{model:'Agent: default',messages:[]})).status,429);
 app.setRole('user');await assert.rejects(reader.read());
 assert.equal((await app.request('/models',second.secret)).status,401);
 }finally{await app.close();}
});
