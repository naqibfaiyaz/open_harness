import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const requireLC=createRequire(new URL('../src/LibreChat/package.json',import.meta.url));
const {createHermesDeliveryHandler,deliveryDirectory,hermesPresentationInstructions}=requireLC('./packages/api/src/hermes/deliveries.ts');
const {createHermesDeliveryStorage}=requireLC('./packages/api/src/hermes/deliveryStorage.ts');
const bridgeKey='fixture-private-bridge-key-over-thirty-two-characters';
test('delivers only this conversation directory, de-duplicates markers and persists native private attachments',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'hermes-deliveries-'));try{
 const records:any[]=[];const reads:any[]=[];const directory=deliveryDirectory(bridgeKey,'owner','chat');
 assert.notEqual(directory,deliveryDirectory(bridgeKey,'other-user','chat'));
 assert.notEqual(directory,deliveryDirectory(bridgeKey,'owner','other-chat'));
 const storage=createHermesDeliveryStorage({paths:{uploads:root,publicPath:path.join(root,'public')},createFile:async(data:any)=>{records.push(data);return data;}});
 const handler=createHermesDeliveryHandler({bridgeKey,config:{deliverFiles:true,deliveryMaxBytes:1024,deliveryMaxFiles:8},storage,
 dashboard:{fetch:async(_path:string,init:any)=>{reads.push(JSON.parse(init.body));return new Response('private-data',{headers:{'Content-Type':'text/csv'}});}}});
 const own=directory+'/sales.csv';const foreign=deliveryDirectory(bridgeKey,'other-user','chat')+'/secret.csv';
 const message:any={messageId:'message',conversationId:'chat',text:`MEDIA:${own}`,content:[{type:'text',text:`MEDIA:"${own}"\nMEDIA:${foreign}\nMEDIA:${directory}/../secret.csv`}]};
 await handler('owner',message);
 assert.equal(reads.length,1);assert.equal(records.length,1);assert.equal(records[0].user,'owner');assert.equal(records[0].conversationId,'chat');assert.equal(records[0].messageId,'message');
 assert.match(message.attachments[0].filepath,/^\/api\/files\/download\/owner\//);assert.equal(message.attachments[0].hermesGenerated,true);
 assert.equal(records[0].filepath.startsWith('/uploads/owner/'),true);
 assert.equal(await readFile(path.join(root,'owner',`${records[0].file_id}-sales.csv`),'utf8'),'private-data');
 assert.equal(message.text.includes('MEDIA:'),false);assert.equal(message.content[0].text.includes('secret.csv'),false);
 assert.equal(JSON.stringify(records).includes('public/images'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('oversize or failed files are not saved and upstream diagnostics never enter the message',async()=>{
 const directory=deliveryDirectory(bridgeKey,'owner','chat');let saves=0;
 const handler=createHermesDeliveryHandler({bridgeKey,config:{deliverFiles:true,deliveryMaxBytes:3,deliveryMaxFiles:1},storage:{save:async()=>{saves++;}},dashboard:{fetch:async()=>new Response('too-large-sensitive-data')}});
 const message:any={messageId:'message',conversationId:'chat',content:[{type:'text',text:{value:`MEDIA:${directory}/plot.png`}}]};
 await handler('owner',message);assert.equal(saves,0);assert.match(message.content[0].text.value,/attachment failed/);assert.equal(JSON.stringify(message).includes('sensitive-data'),false);
});
test('visualization guidance prioritizes complete interactive artifacts and private exports',()=>{
 const instructions=hermesPresentationInstructions('/private-output',true);
 assert.match(instructions,/prioritize a working interactive LibreChat artifact/);assert.match(instructions,/:::artifact/);assert.match(instructions,/inline SVG and JavaScript/);assert.match(instructions,/never invent data/);assert.match(instructions,/MEDIA:\/private-output/);
});
test('artifact source and fenced media examples are preserved without file reads',async()=>{
 let reads=0;const handler=createHermesDeliveryHandler({bridgeKey,config:{deliverFiles:true},storage:{save:async()=>{}},dashboard:{fetch:async()=>{reads++;throw new Error('must not fetch');}}});
 const text=':::artifact{identifier="plot" type="text/html" title="Plot"}\n```html\n<p>MEDIA:/example.png</p>\n```\n:::\n```text\nMEDIA:/example.csv\n```';
 const message:any={messageId:'message',conversationId:'chat',text};await handler('owner',message);assert.equal(reads,0);assert.equal(message.text,text);
});
test('LibreChat completion hook binds files to the authenticated user after route authentication',async()=>{
 const {createHermesIntegration}=requireLC('./packages/api/src/hermes/index.ts');const express=requireLC('express');const saved:any[]=[];
 const integration=createHermesIntegration({config:{enabled:true,managedOnly:true,deliverFiles:true,interactiveGraphs:true,publicOrigin:'https://chat.test',dashboardURL:'http://dashboard.test',runtimeURL:'http://runtime.test',endpointName:'Hermes',allowedUserIds:[]},
 secrets:{bridgeKey,runtimeKey:'fixture-runtime',dashboardUsername:'operator',dashboardPassword:'fixture',dashboardProvider:'basic'},authenticate:(_r:any,_s:any,n:any)=>n(),loadUser:async()=>({id:'owner'}),deliveryStorage:{save:async(data:any)=>{saved.push(data);return {...data,filepath:'/private/download'};}},
 fetch:async(url:any)=>String(url).includes('/auth/password-login')?new Response('{}',{headers:{'Set-Cookie':'hermes_session=fixture; Path=/'}}):new Response('csv bytes',{headers:{'Content-Type':'text/csv'}})});
 const app=express();app.use(express.json());app.post('/api/ask',integration.executionGuard,async(req:any,res:any)=>{req.user={id:'owner'};const message={messageId:'reply',conversationId:'chat',text:`MEDIA:${deliveryDirectory(bridgeKey,'owner','chat')}/sales.csv`};await req.hermesDeliverOutput(message);res.json(message);});
 const server=app.listen(0);await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert(address&&typeof address!=='string');try{
 const response=await fetch(`http://127.0.0.1:${address.port}/api/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:'Hermes',user:'attacker'})});assert.equal(response.status,200);
 const message=await response.json() as any;assert.equal(saved[0].user,'owner');assert.equal(message.attachments[0].hermesGenerated,true);assert.equal(message.text.includes('MEDIA:'),false);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
