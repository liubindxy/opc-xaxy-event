const encoder = new TextEncoder();
const cache = new Map();
function decode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
export async function verifyAccess(token, env, fetcher = fetch) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return null;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)) return null;
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const head = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    const now = Date.now() / 1000;
    const admins = env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase());
    if (head.alg !== 'RS256' || typeof head.kid !== 'string' || claims.iss !== issuer ||
      !Array.isArray(claims.aud) || !claims.aud.includes(env.ACCESS_AUD) ||
      typeof claims.exp !== 'number' || claims.exp <= now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 30)) ||
      typeof claims.email !== 'string' || !admins.includes(claims.email.toLowerCase())) return null;
    let entry = cache.get(issuer);
    if (!entry || entry.expires < Date.now() || !entry.keys.some(k => k.kid === head.kid)) {
      const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {signal: AbortSignal.timeout(5000)});
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data.keys)) return null;
      entry = { keys: data.keys, expires: Date.now() + 300000 };
      cache.set(issuer, entry);
    }
    const jwk = entry.keys.find(k => k.kid === head.kid && k.kty === 'RSA');
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    return valid ? claims.email : null;
  } catch { return null; }
}
