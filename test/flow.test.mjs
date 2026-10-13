import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker,{toCSV,hash} from '../src/worker.mjs';
import {verifyAccess} from '../src/auth.mjs';
import {database} from '../scripts/d1-adapter.mjs';
function setup(){const DB=database();DB.sql.exec("UPDATE events SET registration_open=1,capacity=1");return{DB,LOCAL_PREVIEW:true,ASSETS:{fetch:async()=>new Response('asset')}};}
function req(path,method='GET',data,extra={}){return new Request('http://127.0.0.1'+path,{method,headers:{Origin:'http://127.0.0.1','Content-Type':'application/json',...extra},...(data!==undefined?{body:JSON.stringify(data)}:{})});}
test('explicit HTML asset rewrites do not redirect back to the public route',async()=>{
  const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.assets.html_handling,'none');
  assert.equal(config.assets.run_worker_first,true);
  const env=setup();
  env.ASSETS.fetch=async request=>{
    const path=new URL(request.url).pathname;
    if(config.assets.html_handling!=='none' && path.endsWith('.html'))return Response.redirect(new URL(path.slice(0,-5),request.url),307);
    return new Response(path,{headers:{'Content-Type':'text/html'}});
  };
  for(const [path,asset] of [['/admin','/admin.html'],['/status','/status.html'],['/','/index.html']]){
    const response=await worker.fetch(req(path),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Location'),null);
    assert.equal(await response.text(),asset);
  }
  delete env.LOCAL_PREVIEW;
  assert.equal((await worker.fetch(req('/admin'),env)).status,401);
  assert.equal((await worker.fetch(req('/'),env)).status,200);
});
const input={name:'测试开发者',contact:'test@example.com',city:'雄安',role:'独立开发者',project:'AI应用',project_url:'https://example.com',focus:'产品商业变现',needs:'首批用户',offers:'开发经验',laptop:true,full_attendance:true,share_project:false,consent:true,source:'poster'};
async function apply(env,contact=input.contact){const response=await worker.fetch(req('/api/applications','POST',{...input,contact}),env);assert.equal(response.status,201);return response.json();}
test('application > approval > confirmation > check-in, private tokens and capacity',async()=>{
  const env=setup(),a=await apply(env),b=await apply(env,'second@example.com');
  const stored=env.DB.sql.prepare('SELECT * FROM applications WHERE id=?').get(a.id);assert.equal(stored.token_hash,await hash(a.token));assert.notEqual(stored.token_hash,a.token);
  assert.equal((await worker.fetch(req('/api/status'),env)).status,404);
  assert.equal((await worker.fetch(req('/api/confirm','POST',{}, {'X-Application-Token':a.token}),env)).status,409);
  assert.equal((await worker.fetch(req(`/api/admin/applications/${a.id}`,'PATCH',{status:'approved'}),env)).status,200);
  assert.equal((await worker.fetch(req(`/api/admin/applications/${b.id}`,'PATCH',{status:'approved'}),env)).status,409);
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) as n FROM audit_log').get().n,1);
  assert.equal((await worker.fetch(req('/api/confirm','POST',{}, {'X-Application-Token':a.token}),env)).status,200);
  assert.equal((await worker.fetch(req(`/api/admin/applications/${a.id}`,'PATCH',{checked_in:true,notified:true}),env)).status,200);
  const status=await(await worker.fetch(req('/api/status','GET',undefined,{'X-Application-Token':a.token}),env)).json();assert.equal(status.confirmed,1);assert.equal(status.checked_in,1);assert.equal(status.contact,undefined);
  assert.equal((await worker.fetch(req(`/api/admin/applications/${b.id}`,'PATCH',{status:'waitlisted',checked_in:true}),env)).status,409);
  await worker.fetch(req(`/api/admin/applications/${a.id}`,'PATCH',{status:'waitlisted'}),env);
  assert.equal((await worker.fetch(req(`/api/admin/applications/${b.id}`,'PATCH',{status:'approved'}),env)).status,200);
  const reset=env.DB.sql.prepare('SELECT * FROM applications WHERE id=?').get(a.id);assert.equal(reset.confirmed,0);assert.equal(reset.checked_in,0);
  const list=await(await worker.fetch(req('/api/admin/applications'),env)).json();assert.equal(list.rows.length,2);assert.equal(list.rows[0].token_hash,undefined);
});
test('duplicate, invalid project link, consent and closed registration',async()=>{
  const env=setup();await apply(env);
  assert.equal((await worker.fetch(req('/api/applications','POST',input),env)).status,409);
  assert.equal((await worker.fetch(req('/api/applications','POST',{...input,contact:'x',project_url:'javascript:alert(1)'}),env)).status,400);
  assert.equal((await worker.fetch(req('/api/applications','POST',{...input,contact:'x',consent:false}),env)).status,400);
  env.DB.sql.exec('UPDATE events SET registration_open=0');assert.equal((await worker.fetch(req('/api/applications','POST',input),env)).status,409);
});
test('production fails closed for admin, HTML bypass and unconfigured Turnstile',async()=>{
  const env=setup();delete env.LOCAL_PREVIEW;
  for(const path of ['/admin','/admin/','/admin.html','/api/admin/applications','/api/admin/export'])assert.equal((await worker.fetch(req(path),env)).status,401);
  assert.equal((await worker.fetch(req('/api/applications','POST',input),env)).status,503);
  assert.equal((await worker.fetch(new Request('http://127.0.0.1/api/confirm',{method:'POST',headers:{Origin:'https://evil.example'}}),env)).status,403);
  env.LOCAL_PREVIEW='true';assert.equal((await worker.fetch(req('/admin'),env)).status,401);
  assert.equal((await worker.fetch(req('/admin.js'),env)).status,200);
});
test('event settings and CSV spreadsheet injection',async()=>{
  const env=setup(),a=await apply(env);await worker.fetch(req(`/api/admin/applications/${a.id}`,'PATCH',{status:'approved'}),env);
  assert.equal((await worker.fetch(req('/api/admin/event','PATCH',{title:'首场',date_label:'周六',venue:'雄安',capacity:1,registration_open:false}),env)).status,200);
  const event=await(await worker.fetch(req('/api/event'),env)).json();assert.equal(event.registration_open,0);
  const csv=toCSV([{name:'=WEBSERVICE("secret")',project:'a,b\n"c"'}]);assert.ok(csv.includes("'=WEBSERVICE"));assert.ok(csv.includes('"a,b\n""c"""'));
  const response=await worker.fetch(req('/api/admin/export'),env);assert.equal(response.status,200);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
});
test('rate limiting rejects ninth submission attempt',async()=>{const env=setup();for(let n=0;n<8;n++)await apply(env,`user${n}@example.com`);assert.equal((await worker.fetch(req('/api/applications','POST',{...input,contact:'ninth@example.com'}),env)).status,429);});
test('production Turnstile enforces success, hostname and action',async()=>{
  const env=setup();delete env.LOCAL_PREVIEW;env.TURNSTILE_SECRET_KEY='test-secret';env.TURNSTILE_SITE_KEY='test-site';
  const original=globalThis.fetch;let result={success:false};
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(JSON.parse(options.body).secret,'test-secret');return Response.json(result);};
  try{
    const data={...input,turnstile_token:'test-token'};
    assert.equal((await worker.fetch(req('/api/applications','POST',data),env)).status,400);
    result={success:true,hostname:'wrong.example.com',action:'apply'};assert.equal((await worker.fetch(req('/api/applications','POST',data),env)).status,400);
    result={success:true,hostname:'127.0.0.1',action:'wrong'};assert.equal((await worker.fetch(req('/api/applications','POST',data),env)).status,400);
    result={success:true,hostname:'127.0.0.1',action:'apply'};assert.equal((await worker.fetch(req('/api/applications','POST',data),env)).status,201);
  }finally{globalThis.fetch=original;}
});
test('Access verifies actual RSA signatures, audience, expiration and admin allowlist',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='test-key';
  const env={ACCESS_TEAM_DOMAIN:'test-opc.cloudflareaccess.com',ACCESS_AUD:'aud',ADMIN_EMAILS:'admin@example.com'};
  const fetcher=async()=>Response.json({keys:[jwk]});
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  async function jwt(overrides={}){const data=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://'+env.ACCESS_TEAM_DOMAIN,aud:['aud'],exp:Date.now()/1000+300,email:'admin@example.com',...overrides});return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))).toString('base64url');}
  assert.equal(await verifyAccess(await jwt(),env,fetcher),'admin@example.com');
  assert.equal(await verifyAccess(await jwt({aud:['other']}),env,fetcher),null);
  assert.equal(await verifyAccess(await jwt({exp:0}),env,fetcher),null);
  assert.equal(await verifyAccess(await jwt({email:'other@example.com'}),env,fetcher),null);
  const bad=await jwt();assert.equal(await verifyAccess(bad.slice(0,-10)+'AAAAAAAAAA',env,fetcher),null);
  const prod=setup();delete prod.LOCAL_PREVIEW;Object.assign(prod,env);
  assert.equal((await worker.fetch(req('/api/admin/applications','GET',undefined,{'Cf-Access-Jwt-Assertion':await jwt()}),prod)).status,200);
  assert.equal((await worker.fetch(req('/api/admin/applications','GET',undefined,{'Cf-Access-Jwt-Assertion':await jwt({email:'intruder@example.com'})}),prod)).status,401);
});
