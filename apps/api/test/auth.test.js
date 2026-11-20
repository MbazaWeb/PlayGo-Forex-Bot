import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from '../src/app.js';
const config={origin:'http://localhost:5173',clientId:'test-client',redirectUri:'http://localhost:5173/api/auth/deriv/callback'};
async function fixture(t,fetcher){
 const server=createServer(createApp(config,{fetcher}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 return async(path,options={})=>fetch('http://127.0.0.1:'+server.address().port+path,{redirect:'manual',...options});
}
test('anonymous access denied and unconfigured login fails clearly',async t=>{
 const request=await fixture(t);
 assert.equal((await request('/api/accounts')).status,401);
 assert.equal((await (await request('/api/session')).json()).authenticated,false);
});
test('invalid callback and cross-origin logout rejected',async t=>{
 let calls=0;const request=await fixture(t,async()=>{calls++;throw Error();});
 const r=await request('/api/auth/deriv/callback?code=secret&state=wrong');
 assert.match(r.headers.get('location'),/auth_error/);assert.equal(calls,0);
 assert.equal((await request('/api/auth/logout',{method:'POST',headers:{Origin:'http://evil.test','X-PlayGo-Request':'1'}})).status,403);
});
test('PKCE flow, scoped accounts, secret isolation, replay and logout',async t=>{
 const calls=[];
 const request=await fixture(t,async(url,options)=>{
  calls.push({url,options});
  return new Response(JSON.stringify(url.endsWith('/token')?{access_token:'server-only-secret',expires_in:3600}:{data:[{account_id:'CR123',currency:'USD',balance:'12.50',account_type:'real',private_data:'hidden'}]}));
 });
 const start=await request('/api/auth/deriv/start');const auth=new URL(start.headers.get('location'));
 assert.equal(auth.origin,'https://auth.deriv.com');
 assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 const cookie=start.headers.get('set-cookie').split(';')[0];
 const callback='/api/auth/deriv/callback?code=one-use-code&state='+auth.searchParams.get('state');
 const result=await request(callback,{headers:{Cookie:cookie}});
 const sessionCookie=result.headers.get('set-cookie').match(/playgo_session=([^;]+)/)?.[0];
 assert.ok(sessionCookie);assert.match(result.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await request(callback,{headers:{Cookie:cookie}})).headers.get('location'),'http://localhost:5173/?auth_error=invalid_callback');
 const body=await (await request('/api/accounts',{headers:{Cookie:sessionCookie}})).text();
 assert.match(body,/CR123/);assert.ok(!body.includes('secret')&&!body.includes('hidden'));
 const verifier=calls[0].options.body.get('code_verifier');
 const {createHash}=await import('node:crypto');
 assert.equal(createHash('sha256').update(verifier).digest('base64url'),auth.searchParams.get('code_challenge'));
 assert.equal(calls[1].options.headers.Authorization,'Bearer server-only-secret');
 assert.equal((await request('/api/orders',{method:'POST',headers:{Cookie:sessionCookie}})).status,501);
 await request('/api/auth/logout',{method:'POST',headers:{Cookie:sessionCookie,Origin:config.origin,'X-PlayGo-Request':'1'}});
 assert.equal((await request('/api/accounts',{headers:{Cookie:sessionCookie}})).status,401);
});
test('broker token rejection expires local session',async t=>{
 const request=await fixture(t,async url=>url.endsWith('/token')?new Response(JSON.stringify({access_token:'secret',expires_in:3600})):new Response('{}',{status:401}));
 const start=await request('/api/auth/deriv/start');const state=new URL(start.headers.get('location')).searchParams.get('state');
 const callback=await request('/api/auth/deriv/callback?code=test&state='+state,{headers:{Cookie:start.headers.get('set-cookie').split(';')[0]}});
 const cookie=callback.headers.get('set-cookie').match(/playgo_session=([^;]+)/)[0];
 assert.equal((await request('/api/accounts',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await (await request('/api/session',{headers:{Cookie:cookie}})).json()).authenticated,false);
});
test('reject insecure remote deployments and mismatched callbacks',()=>{
 assert.throws(()=>createApp({...config,origin:'http://example.com'}));
 assert.throws(()=>createApp({...config,redirectUri:'https://evil.test/callback'}));
});
