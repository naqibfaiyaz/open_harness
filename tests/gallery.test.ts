import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const { galleryArtifacts, createArtifactGalleryRouter } = requireLC('./packages/api/src/artifacts/gallery.ts');
const express = requireLC('express');
test('gallery parses persisted artifact fences and keeps source chat and viewer identity', () => {
 const page={ messages:[{messageId:'message-a',conversationId:'chat-a',text:':::artifact{identifier="counter" type="text/html" title="Counter demo"}\n```html\n<button>Count</button>\n```\n:::'}]};
 const rows=galleryArtifacts(page);
 assert.equal(rows.length,1); assert.equal(rows[0].id,'counter_text/html_counter_demo_message-a');
 assert.equal(rows[0].content,'<button>Count</button>'); assert.equal(rows[0].conversationId,'chat-a');
});
test('gallery binds reads to the authenticated user and rejects invalid cursors without exposing provider errors', async()=>{
 const calls:unknown[]=[];
 const app=express();
 app.use('/api/artifact-gallery', createArtifactGalleryRouter({ authenticate:(req: any,_res:any,next:any)=>{ req.user={id:'owner-a'};next(); }, list:async(...args:unknown[])=>{calls.push(args); if(args[2]==='fail')throw new Error('private-diagnostic');return {messages:[]};} }));
 const server=app.listen(0); await new Promise<void>(r=>server.once('listening',r)); const address=server.address();assert(address && typeof address!=='string');
 try {
  const base=`http://127.0.0.1:${address.port}/api/artifact-gallery`;
  assert.equal((await fetch(base+'?user=owner-b&q=report')).status,200);
  assert.deepEqual(calls[0],['owner-a',undefined,'report']);
  assert.equal((await fetch(base+'?before=bad')).status,400);
  const failed=await fetch(base+'?q=fail'); assert.equal(failed.status,503); assert.equal((await failed.text()).includes('private-diagnostic'),false);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test('managed Hermes chats enable artifact output without a per-message attachment', () => {
 const { createHermesIntegration }=requireLC('./packages/api/src/hermes/index.ts');
 const integration=createHermesIntegration({config:{enabled:true,managedOnly:true,artifactsEnabledByDefault:true,publicOrigin:'https://app.test',dashboardURL:'http://dashboard.test',runtimeURL:'http://runtime.test',allowedUserIds:[],endpointName:'Hermes'},secrets:{dashboardUsername:'fixture',dashboardPassword:'fixture',dashboardProvider:'basic',runtimeKey:'fixture',bridgeKey:'fixture-at-least-thirty-two-characters-long'},authenticate:(_req:any,_res:any,next:any)=>next(),loadUser:async()=>undefined});
 const req:any={method:'POST',path:'/chat',originalUrl:'/api/ask',body:{endpoint:'Hermes'}};
 let next=false;integration.executionGuard(req,{},()=>{next=true;});
 assert.equal(next,true);assert.equal(req.body.ephemeralAgent.artifacts,'shadcnui');
 assert.deepEqual(req.body.ephemeralAgent.mcp,[]);
});
