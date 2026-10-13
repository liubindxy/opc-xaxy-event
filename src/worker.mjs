import { verifyAccess } from './auth.mjs';

const statuses = ['pending','approved','waitlisted','rejected'];
const encoder = new TextEncoder();
const labels = {pending:'待审核',approved:'已通过',waitlisted:'候补',rejected:'未通过'};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fail(status, message) { throw new HttpError(status, message); }
function json(data, status = 200) { return Response.json(data, {status}); }
function protect(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  return new Response(response.body, {status:response.status,headers});
}
async function body(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) fail(415,'请使用 JSON 提交');
  const raw = await request.text();
  if (encoder.encode(raw).length > 16000) fail(413,'提交内容过长');
  try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw 0; return data; }
  catch { fail(400,'提交内容格式错误'); }
}
function text(data, key, max, required = true) {
  const value = typeof data[key] === 'string' ? data[key].trim() : '';
  if ((required && !value) || value.length > max) fail(400,`请检查 ${key} 字段`);
  return value;
}
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(v => v.toString(16).padStart(2,'0')).join('');
}
function token() { return [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2,'0')).join(''); }
async function rateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Math.floor(Date.now()/1000), key = await hash(`${ip}:${Math.floor(now/600)}`);
  const row = await env.DB.prepare('INSERT INTO rate_limits(key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits').bind(key,now+1200).first();
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
  if (row.hits > 8) fail(429,'提交过于频繁，请稍后再试');
}
async function checkTurnstile(request, env, data) {
  if (env.LOCAL_PREVIEW === true && new URL(request.url).hostname === '127.0.0.1') return;
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) fail(503,'报名验证尚未配置，请联系主办方');
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(8000),
    body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:text(data,'turnstile_token',2048),remoteip:request.headers.get('CF-Connecting-IP') || undefined})
  });
  const result = await response.json();
  if (!result.success || result.hostname !== new URL(request.url).hostname || result.action !== 'apply') fail(400,'验证失效，请重新验证后提交');
}
function csvValue(value) {
  let v = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(v) || /^[\t\r\n]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g,'""') + '"';
}
export function toCSV(rows) {
  const fields = {id:'申请编号',name:'姓名',contact:'联系方式',city:'城市',role:'身份',project:'项目',project_url:'项目链接',focus:'关注方向',needs:'需要资源',offers:'可提供资源',status:'审核状态',confirmed:'确认出席',checked_in:'签到',notified:'已通知',source:'来源',note:'内部备注',created_at:'申请时间'};
  return '\ufeff' + [Object.values(fields).map(csvValue).join(','),...rows.map(r => Object.keys(fields).map(k => csvValue(k==='status'?labels[r[k]]:r[k])).join(','))].join('\r\n');
}
async function applicant(request, env) {
  const secret = request.headers.get('X-Application-Token') || '';
  if (!/^[a-f0-9]{64}$/.test(secret)) fail(404,'申请链接无效');
  const row = await env.DB.prepare('SELECT id,name,status,confirmed,checked_in FROM applications WHERE token_hash=?').bind(await hash(secret)).first();
  if (!row) fail(404,'申请链接无效');
  return row;
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/,'') || '/';
  if (!['GET','HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) fail(403,'请求来源无效');
  if ((path.startsWith('/api/') || path.startsWith('/admin')) && !env.DB) fail(503,'数据库尚未配置');
  if (path === '/api/event' && request.method === 'GET') {
    const event = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind('first').first();
    if (!event) fail(503,'请先初始化活动数据库');
    return json({...event,turnstile_site_key:env.TURNSTILE_SITE_KEY || '',preview:env.LOCAL_PREVIEW === true});
  }
  if (path === '/api/applications' && request.method === 'POST') {
    const data = await body(request);
    const event = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind('first').first();
    if (!event?.registration_open) fail(409,'报名尚未开放或已经结束');
    await rateLimit(request,env);
    if (data.website) fail(400,'提交无效');
    if (data.consent !== true) fail(400,'请同意报名信息处理说明');
    const name=text(data,'name',40), contact=text(data,'contact',100).toLowerCase(), city=text(data,'city',60), role=text(data,'role',60);
    const project=text(data,'project',1200), projectURL=text(data,'project_url',500,false), focus=text(data,'focus',100), needs=text(data,'needs',800), offers=text(data,'offers',800,false);
    if (projectURL) { try { if (!['https:','http:'].includes(new URL(projectURL).protocol)) throw 0; } catch { fail(400,'项目链接需以 https:// 或 http:// 开头'); } }
    for (const field of ['laptop','full_attendance','share_project']) if (typeof data[field] !== 'boolean') fail(400,'请完善参与选项');
    const source=text(data,'source',80,false) || 'direct';
    await checkTurnstile(request,env,data);
    const secret=token(), id='OPC-'+crypto.randomUUID().slice(0,8).toUpperCase(), now=new Date().toISOString();
    try {
      await env.DB.prepare(`INSERT INTO applications (id,event_id,token_hash,name,contact,city,role,project,project_url,focus,needs,offers,laptop,full_attendance,share_project,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,'first',await hash(secret),name,contact,city,role,project,projectURL,focus,needs,offers,+data.laptop,+data.full_attendance,+data.share_project,source,now,now).run();
    } catch (error) { if (String(error).includes('UNIQUE')) fail(409,'此联系方式已申请，请使用之前保存的查询链接，或联系主办方'); throw error; }
    return json({id,token:secret},201);
  }
  if (path === '/api/status' && request.method === 'GET') return json(await applicant(request,env));
  if (path === '/api/confirm' && request.method === 'POST') {
    const row=await applicant(request,env);
    const result=await env.DB.prepare("UPDATE applications SET confirmed=1,updated_at=? WHERE id=? AND status='approved'").bind(new Date().toISOString(),row.id).run();
    if (!result.meta.changes) fail(409,'申请通过后才能确认出席');
    return json({ok:true});
  }
  if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/admin')) {
    let email;
    if (env.LOCAL_PREVIEW === true && url.hostname==='127.0.0.1') email='preview@local';
    else {
      const jwt=request.headers.get('Cf-Access-Jwt-Assertion') || (request.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('CF_Authorization='))?.slice(17);
      email=await verifyAccess(jwt,env);
    }
    if (!email) fail(401,'后台需要 Cloudflare Access 管理员登录；请先配置 Access 与管理员邮箱');
    if (path === '/api/admin/applications' && request.method==='GET') {
      const result=await env.DB.prepare('SELECT id,name,contact,city,role,project,project_url,focus,needs,offers,laptop,full_attendance,share_project,source,status,confirmed,checked_in,notified,note,created_at,updated_at FROM applications WHERE event_id=? ORDER BY created_at DESC').bind('first').all();
      return json({rows:result.results,email});
    }
    if (path === '/api/admin/export' && request.method==='GET') {
      const {results}=await env.DB.prepare('SELECT * FROM applications WHERE event_id=? ORDER BY created_at DESC').bind('first').all();
      return new Response(toCSV(results),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="opc-applications.csv"'}});
    }
    const match=path.match(/^\/api\/admin\/applications\/(OPC-[A-F0-9]{8})$/);
    if (match && request.method==='PATCH') {
      const data=await body(request), row=await env.DB.prepare('SELECT * FROM applications WHERE id=?').bind(match[1]).first();
      if (!row) fail(404,'申请不存在');
      const status=data.status ?? row.status;
      if (!statuses.includes(status)) fail(400,'审核状态无效');
      for (const field of ['notified','checked_in']) if (data[field] !== undefined && typeof data[field] !== 'boolean') fail(400,'状态格式错误');
      if (data.checked_in === true && status!=='approved') fail(409,'只能为已通过的申请签到');
      const note=data.note===undefined?row.note:text(data,'note',1000,false), now=new Date().toISOString();
      // The capacity condition is part of the same SQL statement as approval.
      const change=env.DB.prepare(`UPDATE applications SET status=?,note=?,notified=?,checked_in=?,confirmed=CASE WHEN ?='approved' THEN confirmed ELSE 0 END,updated_at=? WHERE id=? AND (?!='approved' OR status='approved' OR (SELECT COUNT(*) FROM applications WHERE event_id='first' AND status='approved') < (SELECT capacity FROM events WHERE id='first'))`)
        .bind(status,note,data.notified===undefined?row.notified:+data.notified,status==='approved'?(data.checked_in===undefined?row.checked_in:+data.checked_in):0,status,now,row.id,status);
      const results=await env.DB.batch([change,env.DB.prepare('INSERT INTO audit_log(application_id,actor,action,created_at) SELECT ?,?,?,? WHERE changes() > 0').bind(row.id,email,JSON.stringify({status,noteChanged:data.note!==undefined,notified:data.notified,checked_in:data.checked_in}),now)]);
      if (!results[0].meta.changes) fail(409,'录取名额已满，请设为候补');
      return json({ok:true});
    }
    if (path==='/api/admin/event' && request.method==='PATCH') {
      const data=await body(request);
      const title=text(data,'title',140), date=text(data,'date_label',140), venue=text(data,'venue',200);
      if (!Number.isInteger(data.capacity) || data.capacity<1 || data.capacity>100 || typeof data.registration_open!=='boolean') fail(400,'请检查名额和报名开关');
      const now=new Date().toISOString();
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE events SET title=?,date_label=?,venue=?,capacity=?,registration_open=? WHERE id='first' AND ? >= (SELECT COUNT(*) FROM applications WHERE event_id='first' AND status='approved')").bind(title,date,venue,data.capacity,+data.registration_open,data.capacity),
        env.DB.prepare('INSERT INTO audit_log(actor,action,created_at) SELECT ?,?,? WHERE changes() > 0').bind(email,'event-settings',now)
      ]);
      if (!results[0].meta.changes) fail(409,'名额不能低于已通过人数');
      return json({ok:true});
    }
    if (path==='/admin' && ['GET','HEAD'].includes(request.method)) return env.ASSETS.fetch(new Request(new URL('/admin.html',url),request));
    fail(404,'页面或接口不存在');
  }
  if (path.startsWith('/api/')) fail(404,'接口不存在');
  if (path==='/admin.html') fail(404,'请从 /admin 访问后台');
  if (path==='/status') return env.ASSETS.fetch(new Request(new URL('/status.html',url),request));
  if (path==='/') return env.ASSETS.fetch(new Request(new URL('/index.html',url),request));
  return env.ASSETS.fetch(request);
}
export default {async fetch(request,env) {
  try { return protect(await route(request,env)); }
  catch(error) { return protect(json({error:error instanceof HttpError?error.message:'服务暂时不可用，请稍后重试'},error.status || 503)); }
}};
