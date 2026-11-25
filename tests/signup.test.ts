import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const { createSignupRouter } = requireLC('./packages/api/src/platform/signup.ts');
const express = requireLC('express');
const cookieParser = createRequire(new URL('../src/LibreChat/api/package.json', import.meta.url))('cookie-parser');
const config = { enabled: true, socketPath: '/unused', bootstrapUserIds: [], timeoutMs: 1000, requireMfa: true };

test('public signup requires origin and binds organization creation to its HttpOnly session, never browser email or role', async () => {
  const calls: {path: string; body: Record<string, string>}[]=[];
  const app=express(); app.use(express.json(), cookieParser());
  app.use('/api/signup',createSignupRouter({config, origin:'https://app.test',controlSecret:'synthetic',control:{call:async(path:string,_method:string,body:Record<string,string>)=>{
    calls.push({path,body});
    return path==='/signup/verify'?{session:'a'.repeat(64),status:'verified',email:'owner@example.test'}:{status:'provisioning'};
  }}}));
  const server=app.listen(0); await new Promise<void>(r=>server.once('listening',r));
  const address=server.address(); assert(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}/api/signup`;
  try {
    let r=await fetch(base+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'b'.repeat(64)})});
    assert.equal(r.status,403); assert.equal(calls.length,0);
    r=await fetch(base+'/verify',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.test'},body:JSON.stringify({token:'b'.repeat(64)})});
    const cookie=r.headers.get('set-cookie')!;
    assert.match(cookie,/HttpOnly/); assert.match(cookie,/Secure/); assert.match(cookie,/SameSite=Strict/);
    assert.equal((await r.text()).includes('a'.repeat(64)),false);
    r=await fetch(base+'/create',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.test',Cookie:cookie.split(';')[0]},body:JSON.stringify({name:'Example',slug:'example',password:'synthetic-password',email:'attacker@test.invalid',ownerEmail:'attacker@test.invalid',role:'platform-admin',session:'forged'})});
    assert.equal(r.status,200);
    assert.deepEqual(calls.at(-1)?.body,{session:'a'.repeat(64),name:'Example',slug:'example',password:'synthetic-password'});
    assert.equal(r.headers.get('cache-control'),'no-store');
  } finally { await new Promise<void>(r=>server.close(()=>r())); }
});

test('signup is unavailable on customer stacks without platform configuration',async()=>{
  const app=express(); app.use(express.json());
  app.use('/api/signup',createSignupRouter({origin:'https://tenant.test',controlSecret:''}));
  const server=app.listen(0); await new Promise<void>(r=>server.once('listening',r));
  const address=server.address(); assert(address && typeof address!=='string');
  try {
    const base=`http://127.0.0.1:${address.port}/api/signup`;
    assert.deepEqual(await (await fetch(base+'/config')).json(),{enabled:false});
    assert.equal((await fetch(base+'/create',{method:'POST',headers:{Origin:'https://tenant.test'}})).status,503);
  } finally { await new Promise<void>(r=>server.close(()=>r())); }
});

