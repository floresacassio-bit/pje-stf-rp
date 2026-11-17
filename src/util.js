// Escape automático: tudo que entra em html`...` é escapado, exceto raw()
export class Raw { constructor(s) { this.s = s; } }
export const raw = s => new Raw(s);
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(esc).join('') : v == null ? '' : String(v).replace(/[&<>"']/g, c => MAP[c]);
export const html = (s, ...v) => new Raw(s.reduce((a, x, i) => a + x + (i < v.length ? esc(v[i]) : ''), ''));
export const fmt = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '';

// Limpeza do texto formatado: só tags simples são mantidas
const OK = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'div', 'br', 'ul', 'ol', 'li', 'span']);
export function limpa(s = '') {
  return String(s).slice(0, 50000).replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([<>])/g, (m, sl, tag, attrs, lone) => {
    if (lone) return lone === '<' ? '&lt;' : '&gt;';
    tag = tag.toLowerCase();
    if (!OK.has(tag)) return '';
    if (sl) return `</${tag}>`;
    if (tag === 'br') return '<br>';
    const a = /text-align:\s*(left|center|right|justify)/i.exec(attrs);
    return a && (tag === 'p' || tag === 'div') ? `<${tag} style="text-align:${a[1].toLowerCase()}">` : `<${tag}>`;
  });
}
export const sorteia = a => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];

// Sessão assinada (HMAC), sem banco
const enc = new TextEncoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const key = s => crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function assina(obj, secret) {
  const p = b64u(enc.encode(JSON.stringify(obj)));
  return p + '.' + b64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(p)));
}
export async function confere(tok, secret) {
  try {
    const [p, s] = tok.split('.');
    if (!(await crypto.subtle.verify('HMAC', await key(secret), unb64u(s), enc.encode(p)))) return null;
    const o = JSON.parse(new TextDecoder().decode(unb64u(p)));
    return o.exp > Date.now() ? o : null;
  } catch { return null; }
}
