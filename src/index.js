import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { html, raw, fmt, limpa, sorteia, assina, confere } from './util.js';
import { pagina, tag, rte, sigiloTag, MIN, CLASSES } from './layout.js';

const app = new Hono();
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const txt = (s, n = 300) => String(s || '').trim().slice(0, n);
const up = (s, n = 120) => txt(s, n).toUpperCase();
const isAdmin = (env, id) => (env.ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean).includes(id);
const agora = () => new Date().toISOString();
const volta = (c, url, ok, erro) => c.redirect(url + (ok ? '?ok=' + encodeURIComponent(ok) : erro ? '?erro=' + encodeURIComponent(erro) : ''), 303);
const falha = (c, msg) => pagina(c, 'Atenção', 'Aviso', html`<div class="cd"><h2>Não foi possível concluir</h2><p>${msg}</p><button class="bs" data-back>Voltar e corrigir</button></div>`, 400);
const SITUACOES = ['Em andamento', 'Julgado', 'Arquivado', 'Suspenso'];
const STATUS = ['ativo', 'ausente', 'impedido', 'vago'];
const TITULOS_MIN = ['DESPACHO', 'DECISÃO MONOCRÁTICA', 'DECISÃO LIMINAR', 'EXTINÇÃO SEM RESOLUÇÃO DO MÉRITO', 'OUTRO'];

// Acrescenta um andamento (usar dentro de db.batch)
const mov = (db, pid, t, d, r, cont) => db.prepare('INSERT INTO andamentos(processo_id,seq,quando,titulo,descricao,responsavel,conteudo) VALUES(?,(SELECT COALESCE(MAX(seq),0)+1 FROM andamentos WHERE processo_id=?),?,?,?,?,?)').bind(pid, pid, agora(), t, d || null, r, cont || null);
const log = (c, acao, det) => c.env.DB.prepare('INSERT INTO logs(quando,admin_id,acao,detalhes) VALUES(?,?,?,?)').bind(agora(), c.get('u').id, acao, det || '').run();
const linksDe = b => { const t = arr(b.anexo_titulo), u = arr(b.anexo_url), out = []; t.forEach((x, i) => { const url = txt(u[i], 500); if (/^https?:\/\//i.test(url)) out.push([txt(x, 120) || 'Link', url]); }); return out; };
const salvaAnexos = (db, aid, links) => links.map(([t, u]) => db.prepare('INSERT INTO anexos(andamento_id,titulo,url) VALUES(?,?,?)').bind(aid, t, u));

function podeVer(u, p) {
  if (p.sigilo === 'publico') return true;
  if (!u) return false;
  if (u.admin) return true;
  if (u.ministro && u.ministro.id === p.relator_id) return true;
  if (p.sigilo === 'absoluto') return false;
  if (u.ministro && u.ministro.presidente) return true;
  return u.perfis.some(x => x.id === p.perfil_id);
}
const podeSigilo = (u, p) => u && (u.admin || (u.ministro && (u.ministro.id === p.relator_id || u.ministro.presidente)));
const etiquetas = p => html`${p.liminar ? tag('LIMINAR') : ''}${(p.etiquetas || '').split(',').map(x => x.trim()).filter(Boolean).map(x => tag(x.toUpperCase(), 'r'))}`;

// ---------- Sessão, proteção e cabeçalhos ----------
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (c.req.method === 'POST') { const o = c.req.header('origin'); if (!o || new URL(o).host !== url.host) return c.text('Requisição recusada.', 403); }
  const tok = getCookie(c, 'sid'); const s = tok && c.env.SESSION_SECRET ? await confere(tok, c.env.SESSION_SECRET) : null;
  let u = null;
  if (s) {
    u = { id: s.id, nome: s.nome, admin: isAdmin(c.env, s.id) };
    u.perfis = (await c.env.DB.prepare('SELECT * FROM perfis WHERE discord_id=?').bind(s.id).all()).results;
    u.ministro = await c.env.DB.prepare('SELECT * FROM ministros WHERE discord_id=?').bind(s.id).first();
  }
  c.set('u', u);
  await next();
  c.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin');
});
const entrar = async (c, id, nome) => setCookie(c, 'sid', await assina({ id, nome, exp: Date.now() + 7 * 864e5 }, c.env.SESSION_SECRET), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 604800, secure: new URL(c.req.url).protocol === 'https:' });

// ---------- Login com Discord ----------
app.get('/login', c => {
  if (!c.env.DISCORD_CLIENT_ID) return falha(c, 'O login com Discord ainda não foi configurado.');
  const state = crypto.randomUUID();
  setCookie(c, 'st', state, { httpOnly: true, sameSite: 'Lax', maxAge: 600, path: '/', secure: new URL(c.req.url).protocol === 'https:' });
  return c.redirect('https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: c.env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: new URL('/auth/callback', c.req.url).href, scope: 'identify guilds.members.read', state }));
});
app.get('/auth/callback', async c => {
  const code = c.req.query('code'), st = c.req.query('state');
  if (!code || !st || st !== getCookie(c, 'st')) return falha(c, 'Falha na verificação do login. Tente entrar novamente.');
  const r = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.env.DISCORD_CLIENT_ID, client_secret: c.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: new URL('/auth/callback', c.req.url).href }) });
  if (!r.ok) return falha(c, 'O Discord recusou o login. Tente novamente.');
  const auth = { Authorization: 'Bearer ' + (await r.json()).access_token };
  const me = await (await fetch('https://discord.com/api/users/@me', { headers: auth })).json();
  const db = c.env.DB; let nome = up(me.global_name || me.username);
  const tem = await db.prepare('SELECT (SELECT COUNT(*) FROM perfis WHERE discord_id=?) AS p, (SELECT COUNT(*) FROM ministros WHERE discord_id=?) AS m').bind(me.id, me.id).first();
  if (!isAdmin(c.env, me.id) && !tem.p && !tem.m) {
    // Primeiro acesso: só quem tem o cargo de OAB no servidor cria cadastro
    const m = await fetch(`https://discord.com/api/users/@me/guilds/${c.env.DISCORD_GUILD_ID}/member`, { headers: auth });
    const mem = m.ok ? await m.json() : null;
    if (!mem || !(mem.roles || []).includes(c.env.DISCORD_OAB_ROLE_ID)) return falha(c, 'O cadastro está disponível apenas para quem possui o cargo de OAB no servidor.');
    nome = up(mem.nick || me.global_name || me.username);
    await db.prepare('INSERT INTO perfis(discord_id,nome,oab,npc) VALUES(?,?,NULL,0)').bind(me.id, nome).run();
  }
  await entrar(c, me.id, nome); deleteCookie(c, 'st', { path: '/' });
  return c.redirect('/meus');
});
app.get('/sair', c => { deleteCookie(c, 'sid', { path: '/' }); return c.redirect('/'); });
// Somente para testes locais (DEV_LOGIN só existe no arquivo .dev.vars do seu computador)
app.get('/dev-login', async c => {
  if (c.env.DEV_LOGIN !== '1') return c.notFound();
  const id = c.req.query('id') || '1', nome = up(c.req.query('nome') || 'USUARIO TESTE');
  if (c.req.query('perfil') === '1' && !(await c.env.DB.prepare('SELECT 1 FROM perfis WHERE discord_id=?').bind(id).first())) await c.env.DB.prepare('INSERT INTO perfis(discord_id,nome,oab,npc) VALUES(?,?,?,0)').bind(id, nome, '0001').run();
  await entrar(c, id, nome); return c.redirect('/');
});

// ---------- Consulta pública ----------
const tabelaProc = rows => html`<div class="sc"><table><tr><th>Processo</th><th>Assunto</th><th>Relator(a)</th><th>Autuação</th><th>Situação</th></tr>${rows.map((p, i) => html`<tr class="${i % 2 ? 'z' : ''}"><td><a href="/processo/${p.numero}"><b>${p.classe} ${p.numero}</b></a></td><td>${p.sigilo === 'publico' ? p.assunto : 'Conteúdo restrito'}</td><td>${MIN(p.relator)}</td><td>${fmt(p.autuado_em)}</td><td>${sigiloTag(p.sigilo)}${etiquetas(p)}${tag(p.situacao.toUpperCase(), 'b')}</td></tr>`)}</table></div>`;
app.get('/', async c => {
  const tipo = c.req.query('tipo') || 'classe_numero', classe = c.req.query('classe') || '', q = txt(c.req.query('q'), 100);
  const w = [], b = [];
  if (tipo === 'parte' && q) { w.push('EXISTS(SELECT 1 FROM partes x WHERE x.processo_id=p.id AND x.nome LIKE ?)'); b.push('%' + q + '%'); }
  else if (tipo === 'advogado' && q) { w.push('EXISTS(SELECT 1 FROM perfis x WHERE x.id=p.perfil_id AND x.nome LIKE ?)'); b.push('%' + q + '%'); }
  else if (tipo === 'classe_numero' || tipo === 'numero_unico') {
    if (q) { const n = parseInt(q, 10); if (!Number.isFinite(n)) return falha(c, 'Digite apenas o número do processo.'); w.push('p.numero=?'); b.push(n); }
    if (tipo === 'classe_numero' && classe) { w.push('p.classe=?'); b.push(classe); }
  }
  const rows = (await c.env.DB.prepare(`SELECT p.*,m.nome AS relator FROM processos p LEFT JOIN ministros m ON m.id=p.relator_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.numero DESC LIMIT ${w.length ? 50 : 15}`).bind(...b).all()).results;
  const opt = (v, t, s) => html`<option value="${v}" ${s === v ? 'selected' : ''}>${t}</option>`;
  return pagina(c, 'Consulta pública', 'Consulta pública', html`<div class="cd"><h2>Consulta processual</h2><form method="get" action="/" style="display:flex;flex-wrap:wrap;border:1px solid #8a998d;border-radius:6px;overflow:hidden;background:#fff"><select id="tipo" name="tipo" aria-label="Tipo de pesquisa" style="margin:0;border:0;border-right:1px solid #cfd8d1;border-radius:0;width:auto;min-width:220px">${opt('classe_numero', 'Por Classe e Número', tipo)}${opt('numero_unico', 'Por Número Único', tipo)}${opt('parte', 'Por Parte', tipo)}${opt('advogado', 'Por Advogado', tipo)}</select><select id="cls" name="classe" aria-label="Classe" style="margin:0;border:0;border-right:1px solid #cfd8d1;border-radius:0;width:auto;min-width:140px"><option value="">Classe</option>${CLASSES.map(x => opt(x, x, classe))}</select><input id="q" name="q" value="${q}" aria-label="Pesquisa" style="margin:0;border:0;border-radius:0;flex:1 1 240px;min-width:0"><button class="btn" style="border-radius:0">Pesquisar</button></form></div><div class="cd"><h2>${w.length ? 'Resultado da pesquisa' : 'Processos recentes'}</h2>${rows.length ? tabelaProc(rows) : html`<p>Nenhum processo encontrado.</p>`}</div><p class="nt">Em processos sigilosos, número, classe e relator ficam visíveis; o conteúdo é restrito. Ambiente fictício de simulação (RP).</p>`);
});

// ---------- Processo ----------
app.get('/processo/:n', async c => {
  const db = c.env.DB, u = c.get('u'), n = parseInt(c.req.param('n'), 10);
  const p = await db.prepare('SELECT p.*,m.nome AS relator FROM processos p LEFT JOIN ministros m ON m.id=p.relator_id WHERE p.numero=?').bind(n).first();
  if (!p) return pagina(c, 'Processo não encontrado', 'Processo', html`<div class="cd">Processo não encontrado.</div>`, 404);
  const ver = podeVer(u, p), titulo = `${p.classe} ${p.numero}`;
  const topo = (extra = '') => html`<div class="ph"><div style="font-size:12px">${p.classe} – Autuado em ${fmt(p.autuado_em)}</div><h1 style="margin:2px 0 8px;font-size:26px">${titulo}</h1>${sigiloTag(p.sigilo)}${etiquetas(p)}${tag(p.situacao.toUpperCase(), 'b')}<div style="margin-top:8px">Relator(a): ${MIN(p.relator)}</div>${extra}</div>`;
  if (!ver) return pagina(c, titulo, 'Processo', html`${topo()}<div class="cd"><h2>Processo em ${p.sigilo === 'absoluto' ? 'sigilo absoluto' : 'segredo de justiça'}</h2><p>O conteúdo é restrito às partes, aos advogados habilitados, à relatoria, à presidência e à administração.</p></div>`);
  const partes = (await db.prepare('SELECT * FROM partes WHERE processo_id=? ORDER BY id').bind(p.id).all()).results;
  const adv = p.perfil_id ? await db.prepare('SELECT * FROM perfis WHERE id=?').bind(p.perfil_id).first() : null;
  const lista = polo => partes.filter(x => x.polo === polo).map(x => x.nome).join(' / ') || '–';
  const ands = (await db.prepare('SELECT * FROM andamentos WHERE processo_id=? ORDER BY seq DESC').bind(p.id).all()).results;
  const anx = (await db.prepare('SELECT * FROM anexos WHERE andamento_id IN (SELECT id FROM andamentos WHERE processo_id=?)').bind(p.id).all()).results;
  const partesHtml = html`<div class="gr" style="margin-top:12px;font-size:13px"><div><small>AUTOR(A/ES)</small><br><b>${lista('autor')}</b></div><div><small>REQUERIDO(S)</small><br><b>${lista('requerido')}</b></div><div><small>ADV.(A/S)</small><br><b>${adv ? adv.nome + (adv.oab ? ' (OAB-RP ' + adv.oab + ')' : '') : '–'}</b></div></div>`;
  const linhas = ands.map((a, i) => { const ax = anx.filter(x => x.andamento_id === a.id); return html`<tr class="${i % 2 ? 'z' : ''}"><td>${ax.length ? html`<details><summary>+ Arquivos</summary>${ax.map(x => html`<div><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.titulo}</a></div>`)}</details>` : ''}</td><td>${a.seq}</td><td>${fmt(a.quando)}</td><td><span class="ev">${a.titulo}</span><br>${a.descricao || ''}${a.conteudo ? html`<details><summary>Ver conteúdo</summary><div class="ct">${raw(limpa(a.conteudo))}</div></details>` : ''}</td><td>${a.responsavel}</td></tr>`; });
  // Ferramentas por perfil
  const eRel = u && u.ministro && (u.ministro.id === p.relator_id);
  const ePart = u && u.perfis.some(x => x.id === p.perfil_id);
  const links = html`<div id="links"></div><p><button type="button" class="bs" data-addlink="#links">+ Link</button></p>`;
  const sig = podeSigilo(u, p) ? html`<div class="cd"><h2>Nível de sigilo</h2><form class="il" method="post" action="/processo/${p.numero}/sigilo"><select name="nivel" aria-label="Nível de sigilo"><option value="publico" ${p.sigilo === 'publico' ? 'selected' : ''}>Público</option><option value="segredo" ${p.sigilo === 'segredo' ? 'selected' : ''}>Segredo de justiça</option><option value="absoluto" ${p.sigilo === 'absoluto' ? 'selected' : ''}>Sigilo absoluto</option></select><button class="bs">Alterar</button></form></div>` : '';
  const movForm = (u && (u.admin || eRel || ePart)) ? html`<div class="cd"><h2>${u.admin ? 'Lançar movimentação (administração)' : eRel ? 'Lançar movimentação' : 'Peticionar'}</h2><form method="post" action="/processo/${p.numero}/movimentar"><div class="bx">${u.admin ? html`<label>Atuar como (nome; vazio = SISTEMA PJe)<input name="responsavel"></label>` : ''}${eRel && !u.admin ? html`<label>Tipo<select name="titulo_sel">${TITULOS_MIN.map(x => html`<option>${x}</option>`)}</select></label>` : ''}<label>${eRel && !u.admin ? 'Título (se “Outro”)' : 'Título da movimentação'}<input name="titulo_livre"></label>${u.admin ? html`<label>Descrição curta<input name="descricao"></label>` : ''}</div>${rte('conteudo', 'Conteúdo')}${links}<button class="btn">Lançar</button></form></div>` : '';
  const adm = u && u.admin ? await painelAdminProcesso(db, p, partes) : '';
  return pagina(c, titulo, 'Processo', html`${topo(partesHtml)}<div class="cd"><h2>Andamentos</h2><div class="sc"><table><tr><th>Anexos</th><th>Seq.</th><th>Data/hora</th><th>Movimentação</th><th>Responsável</th></tr>${linhas}</table></div></div>${movForm}${sig}${adm}`);
});
async function painelAdminProcesso(db, p, partes) {
  const mins = (await db.prepare("SELECT * FROM ministros WHERE status!='vago' ORDER BY nome").all()).results;
  const ls = polo => partes.filter(x => x.polo === polo).map(x => x.nome).join('\n');
  return html`<details class="cd"><summary>Retificar dados (administração)</summary><form method="post" action="/processo/${p.numero}/retificar" style="margin-top:12px"><div class="bx"><label>Classe<input name="classe" value="${p.classe}"></label><label>Assunto<input name="assunto" value="${p.assunto}"></label><label>Autor(es) – um por linha<textarea name="autores" rows="2">${ls('autor')}</textarea></label><label>Requerido(s) – um por linha<textarea name="requeridos" rows="2">${ls('requerido')}</textarea></label><label>Etiquetas (separadas por vírgula, ex.: RÉU PRESO)<input name="etiquetas" value="${p.etiquetas}"></label><label>Situação<select name="situacao">${SITUACOES.map(x => html`<option ${x === p.situacao ? 'selected' : ''}>${x}</option>`)}</select></label><label>Pedido de liminar<select name="liminar"><option value="0">Não</option><option value="1" ${p.liminar ? 'selected' : ''}>Sim</option></select></label></div>${rte('sintese', 'Síntese dos fatos', p.sintese)}${rte('pedido', 'Pedido', p.pedido)}<button class="btn">Salvar retificação</button></form></details><details class="cd"><summary>Redistribuir (administração)</summary><form class="il" method="post" action="/processo/${p.numero}/redistribuir" style="margin-top:12px"><select name="ministro" aria-label="Novo relator">${mins.map(m => html`<option value="${m.id}">${MIN(m.nome)}</option>`)}</select><input name="justificativa" placeholder="Justificativa" aria-label="Justificativa" required style="min-width:280px"><button class="bs">Redistribuir</button></form></details>`;
}
app.post('/processo/:n/sigilo', async c => {
  const u = c.get('u'), db = c.env.DB, n = parseInt(c.req.param('n'), 10);
  const p = await db.prepare('SELECT * FROM processos WHERE numero=?').bind(n).first();
  if (!p || !podeSigilo(u, p)) return c.text('Acesso negado.', 403);
  const nivel = (await c.req.parseBody()).nivel; if (!['publico', 'segredo', 'absoluto'].includes(nivel)) return c.text('Nível inválido.', 400);
  const nome = { publico: 'PÚBLICO', segredo: 'SEGREDO DE JUSTIÇA', absoluto: 'SIGILO ABSOLUTO' }[nivel];
  await db.batch([db.prepare('UPDATE processos SET sigilo=? WHERE id=?').bind(nivel, p.id), mov(db, p.id, 'NÍVEL DE SIGILO ALTERADO', 'Novo nível: ' + nome + '.', 'SISTEMA PJe')]);
  if (u.admin) await log(c, 'sigilo', `${p.classe} ${p.numero}: ${nome}`);
  return volta(c, '/processo/' + n, 'Nível de sigilo alterado.');
});
app.post('/processo/:n/movimentar', async c => {
  const u = c.get('u'), db = c.env.DB, n = parseInt(c.req.param('n'), 10), b = await c.req.parseBody({ all: true });
  const p = await db.prepare('SELECT p.*,m.nome AS relator FROM processos p LEFT JOIN ministros m ON m.id=p.relator_id WHERE p.numero=?').bind(n).first();
  if (!p || !u) return c.text('Acesso negado.', 403);
  const eRel = u.ministro && u.ministro.id === p.relator_id, perfil = u.perfis.find(x => x.id === p.perfil_id), livre = up(b.titulo_livre);
  let titulo, resp, desc = null;
  if (u.admin) { titulo = livre; resp = up(b.responsavel) || 'SISTEMA PJe'; desc = txt(b.descricao, 300); }
  else if (eRel) { const sel = txt(b.titulo_sel, 80); titulo = sel === 'OUTRO' ? livre : sel; resp = MIN(u.ministro.nome); }
  else if (perfil) { titulo = livre || 'PETIÇÃO'; resp = perfil.nome; }
  else return c.text('Acesso negado.', 403);
  if (!titulo) return falha(c, 'Informe o título da movimentação.');
  const r = await mov(db, p.id, titulo, desc, resp, limpa(b.conteudo || '')).run().then(() => db.prepare('SELECT MAX(id) AS id FROM andamentos WHERE processo_id=?').bind(p.id).first());
  const ax = salvaAnexos(db, r.id, linksDe(b)); if (ax.length) await db.batch(ax);
  if (u.admin) await log(c, 'movimentou', `${p.classe} ${p.numero}: ${titulo} (como ${resp})`);
  return volta(c, '/processo/' + n, 'Movimentação lançada.');
});

// ---------- Painel do advogado / ministro ----------
app.get('/meus', async c => {
  const u = c.get('u'), db = c.env.DB; if (!u) return c.redirect('/login');
  const ids = u.perfis.map(x => x.id), mid = u.ministro ? u.ministro.id : -1;
  const rows = (await db.prepare(`SELECT p.*,m.nome AS relator FROM processos p LEFT JOIN ministros m ON m.id=p.relator_id WHERE p.relator_id=? ${ids.length ? 'OR p.perfil_id IN (' + ids.map(() => '?').join(',') + ')' : ''} ORDER BY p.numero DESC`).bind(mid, ...ids).all()).results;
  return pagina(c, 'Meus processos', 'Painel', html`<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap"><h1 style="margin:0;font-size:22px;color:#1f4d30">Meus processos</h1><span class="sp"></span>${ids.length ? html`<a class="btn" href="/protocolar">Nova ação</a>` : ''}</div><div class="cd"><h2>Processos em que atuo</h2>${rows.length ? tabelaProc(rows) : html`<p>Você ainda não tem processos.</p>`}</div>${!ids.length && !u.ministro && !u.admin ? html`<div class="cd"><p>Seu usuário não possui cadastro de advogado.</p></div>` : ''}`);
});

// ---------- Protocolo ----------
app.get('/protocolar', c => {
  const u = c.get('u'); if (!u) return c.redirect('/login');
  if (!u.perfis.length) return falha(c, 'Apenas advogados cadastrados podem protocolar ações.');
  return pagina(c, 'Protocolo', 'Nova ação', html`<form method="post" action="/protocolar"><div class="cd"><h2>1. Dados do processo</h2><div class="gr"><label>Classe<select id="classe" name="classe" required><option value=""></option>${CLASSES.map(x => html`<option>${x}</option>`)}<option>Outro</option></select><input id="classe_outro" name="classe_outro" aria-label="Especifique a classe" hidden></label><label>Assunto<input name="assunto" required></label><label>Pedido de liminar<select name="liminar"><option value="0">Não</option><option value="1">Sim</option></select></label></div></div><div class="cd"><h2>2. Partes</h2><div class="bx"><label>Autor / impetrante<input name="autor" required></label><label>Requerido<span class="fx"><input id="req"><button type="button" class="bs" id="addreq">Adicionar</button></span></label><div id="reqs" style="margin-bottom:12px"></div><label>Advogado(a)<select name="perfil_id">${u.perfis.map(x => html`<option value="${x.id}">${x.nome}${x.oab ? ' (OAB-RP ' + x.oab + ')' : ''}</option>`)}</select></label></div></div><div class="cd"><h2>3. Síntese dos fatos e pedido</h2>${rte('sintese', 'Síntese dos fatos')}${rte('pedido', 'Pedido')}</div><div class="cd"><h2>4. Documentos e provas</h2><div id="links"></div><p><button type="button" class="bs" data-addlink="#links">+ Link</button></p></div><div class="cd"><h2>5. Petição em texto (opcional)</h2>${rte('peticao', 'Petição')}<p class="nt">No processo, a petição aparece minimizada; o conteúdo abre ao clicar na movimentação.</p></div><p class="nt">Todo processo nasce sob segredo de justiça. O nível de sigilo é definido depois pela administração, relatoria ou presidência.</p><button class="btn">Protocolar</button></form>`);
});
app.post('/protocolar', async c => {
  const u = c.get('u'), db = c.env.DB; if (!u) return c.text('Acesso negado.', 403);
  const b = await c.req.parseBody({ all: true });
  const perfil = u.perfis.find(x => String(x.id) === String(b.perfil_id));
  const classe = b.classe === 'Outro' ? txt(b.classe_outro, 40) : (CLASSES.includes(b.classe) ? b.classe : '');
  const assunto = txt(b.assunto, 200), autor = up(b.autor, 200), reqs = arr(b.requerido).map(x => up(x, 200)).filter(Boolean);
  if (!perfil) return falha(c, 'Advogado inválido.');
  if (!classe || !assunto || !autor || !reqs.length || !txt(b.sintese, 10)) return falha(c, 'Preencha classe, assunto, autor, ao menos um requerido e a síntese dos fatos.');
  const mins = (await db.prepare("SELECT * FROM ministros WHERE status='ativo'").all()).results;
  const rel = mins.length ? sorteia(mins) : null;
  const sint = limpa(b.sintese), ped = limpa(b.pedido || ''), pet = limpa(b.peticao || '');
  const p = await db.prepare('INSERT INTO processos(numero,classe,assunto,sintese,pedido,liminar,sigilo,relator_id,perfil_id,autuado_em) VALUES((SELECT COALESCE(MAX(numero),0)+1 FROM processos),?,?,?,?,?,?,?,?,?) RETURNING id,numero').bind(classe, assunto, sint, ped, b.liminar === '1' ? 1 : 0, 'segredo', rel ? rel.id : null, perfil.id, agora()).first();
  const conteudo = `<p><b>Síntese dos fatos</b></p>${sint}${ped ? '<p><b>Pedido</b></p>' + ped : ''}${pet ? '<p><b>Petição</b></p>' + pet : ''}`;
  const a1 = await db.prepare('INSERT INTO andamentos(processo_id,seq,quando,titulo,descricao,responsavel,conteudo) VALUES(?,1,?,?,?,?,?) RETURNING id').bind(p.id, agora(), 'JUNTADA DE PETIÇÃO INICIAL', null, perfil.nome, conteudo).first();
  await db.batch([
    db.prepare('INSERT INTO partes(processo_id,polo,nome) VALUES(?,?,?)').bind(p.id, 'autor', autor),
    ...reqs.map(r => db.prepare('INSERT INTO partes(processo_id,polo,nome) VALUES(?,?,?)').bind(p.id, 'requerido', r)),
    ...salvaAnexos(db, a1.id, linksDe(b)),
    mov(db, p.id, 'TRIAGEM CONCLUÍDA', 'Dados obrigatórios validados. Processo autuado sob segredo de justiça.', 'SISTEMA PJe'),
    rel ? mov(db, p.id, 'DISTRIBUÍDO POR SORTEIO', 'Relator(a): ' + MIN(rel.nome) + '.', 'SISTEMA PJe') : mov(db, p.id, 'AGUARDANDO DISTRIBUIÇÃO', 'Não há ministros ativos para o sorteio.', 'SISTEMA PJe'),
    ...(rel ? [mov(db, p.id, 'CONCLUSOS AO(À) RELATOR(A)', null, 'SISTEMA PJe')] : []),
  ]);
  return volta(c, '/processo/' + p.numero, `Processo ${classe} ${p.numero} protocolado.`);
});

// ---------- Administração ----------
const adm = async (c, next) => c.get('u') && c.get('u').admin ? next() : c.text('Acesso restrito à administração.', 403);
app.use('/admin', adm); app.use('/admin/*', adm); app.use('/processo/:n/retificar', adm); app.use('/processo/:n/redistribuir', adm);
app.get('/admin', async c => {
  const db = c.env.DB;
  const mins = (await db.prepare('SELECT m.*,(SELECT COUNT(*) FROM processos WHERE relator_id=m.id) AS n FROM ministros m ORDER BY m.id').all()).results;
  const perfis = (await db.prepare('SELECT * FROM perfis ORDER BY id').all()).results;
  const procs = (await db.prepare('SELECT p.*,m.nome AS relator FROM processos p LEFT JOIN ministros m ON m.id=p.relator_id ORDER BY p.numero DESC LIMIT 20').all()).results;
  const logs = (await db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 30').all()).results;
  return pagina(c, 'Administração', 'Administração', html`<div class="cd"><h2>Ministros</h2><div class="sc"><table><tr><th>Nome</th><th>Tipo</th><th>Discord (ID)</th><th>Status</th><th>Ações</th></tr>${mins.map((m, i) => html`<tr class="${i % 2 ? 'z' : ''}"><td>${MIN(m.nome)} ${m.presidente ? tag('PRESIDENTE', 'b') : ''}</td><td>${m.tipo === 'jogador' ? 'Jogador' : 'NPC'}</td><td>${m.discord_id || '–'}</td><td><form class="il" method="post" action="/admin/ministros/${m.id}/status"><select name="status" aria-label="Status">${STATUS.map(s => html`<option ${s === m.status ? 'selected' : ''}>${s}</option>`)}</select><button class="bs">Salvar</button></form></td><td><form class="il" method="post" action="/admin/ministros/${m.id}/presidente"><button class="bl">Tornar presidente</button></form><form class="il" method="post" action="/admin/ministros/${m.id}/remover"><button class="bl">Remover</button></form></td></tr>`)}</table></div><form class="il" method="post" action="/admin/ministros/novo" style="margin-top:12px"><input name="nome" placeholder="Nome" aria-label="Nome" required><input name="discord_id" placeholder="ID do Discord (jogador)" aria-label="ID do Discord"><select name="tipo" aria-label="Tipo"><option value="npc">NPC</option><option value="jogador">Jogador</option></select><button class="bs">Cadastrar ministro</button></form></div>
<div class="cd"><h2>Perfis de advogado</h2><div class="sc"><table><tr><th>Nome</th><th>Discord (ID)</th><th>OAB</th><th>Ações</th></tr>${perfis.map((x, i) => html`<tr class="${i % 2 ? 'z' : ''}"><td>${x.nome} ${x.npc ? tag('TEMPORÁRIO', 'k') : ''}</td><td>${x.discord_id}</td><td colspan="2"><form class="il" method="post" action="/admin/perfis/${x.id}/editar"><input name="nome" value="${x.nome}" aria-label="Nome"><input name="oab" value="${x.oab || ''}" placeholder="OAB" aria-label="OAB" style="max-width:110px"><button class="bs">Salvar</button></form><form class="il" method="post" action="/admin/perfis/${x.id}/remover"><button class="bl">Remover</button></form></td></tr>`)}</table></div><form class="il" method="post" action="/admin/perfis/novo" style="margin-top:12px"><input name="discord_id" placeholder="ID do Discord do jogador" aria-label="ID do Discord" required><input name="nome" placeholder="Nome do advogado" aria-label="Nome" required><input name="oab" placeholder="OAB" aria-label="OAB" style="max-width:110px"><button class="bs">Criar advogado temporário</button></form></div>
<div class="cd"><h2>Processos recentes</h2>${procs.length ? tabelaProc(procs) : html`<p>Nenhum processo ainda.</p>`}</div>
<div class="cd"><h2>Backup</h2><p>Baixa todos os dados (processos, partes, andamentos, anexos, perfis, ministros e log) num arquivo. Guarde-o em local seguro, principalmente antes de mudanças grandes.</p><a class="bs" href="/admin/backup">Exportar backup</a></div>
<div class="cd"><h2>Log de auditoria (interno)</h2><div class="sc"><table><tr><th>Data/hora</th><th>Administrador (ID)</th><th>Ação</th><th>Detalhes</th></tr>${logs.map((l, i) => html`<tr class="${i % 2 ? 'z' : ''}"><td>${fmt(l.quando)}</td><td>${l.admin_id}</td><td>${l.acao}</td><td>${l.detalhes}</td></tr>`)}</table></div></div>`);
});
app.get('/admin/backup', async c => {
  const db = c.env.DB, tabelas = ['perfis', 'ministros', 'processos', 'partes', 'andamentos', 'anexos', 'logs'];
  const res = await db.batch(tabelas.map(t => db.prepare('SELECT * FROM ' + t + ' ORDER BY id')));
  const dados = { sistema: 'PJe STF-RP', gerado_em: agora(), tabelas: Object.fromEntries(tabelas.map((t, i) => [t, res[i].results])) };
  await log(c, 'backup', 'Exportação de backup');
  const nome = 'pje-stf-rp-backup-' + agora().slice(0, 19).replace(/[:T]/g, '-') + '.json';
  return new Response(JSON.stringify(dados, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + nome + '"', 'Cache-Control': 'no-store' } });
});
app.post('/admin/ministros/novo', async c => {
  const b = await c.req.parseBody(), nome = up(b.nome.replace(/^MIN\.?\s*/i, ''), 80); if (!nome) return falha(c, 'Informe o nome.');
  await c.env.DB.prepare('INSERT INTO ministros(nome,discord_id,tipo) VALUES(?,?,?)').bind(nome, txt(b.discord_id, 30) || null, b.tipo === 'jogador' ? 'jogador' : 'npc').run();
  await log(c, 'ministro novo', nome); return volta(c, '/admin', 'Ministro cadastrado.');
});
app.post('/admin/ministros/:id/status', async c => {
  const s = (await c.req.parseBody()).status; if (!STATUS.includes(s)) return c.text('Status inválido.', 400);
  await c.env.DB.prepare('UPDATE ministros SET status=? WHERE id=?').bind(s, c.req.param('id')).run();
  await log(c, 'ministro status', `#${c.req.param('id')}: ${s}`); return volta(c, '/admin', 'Status atualizado.');
});
app.post('/admin/ministros/:id/presidente', async c => {
  await c.env.DB.batch([c.env.DB.prepare('UPDATE ministros SET presidente=0'), c.env.DB.prepare('UPDATE ministros SET presidente=1 WHERE id=?').bind(c.req.param('id'))]);
  await log(c, 'presidente', '#' + c.req.param('id')); return volta(c, '/admin', 'Presidência atualizada.');
});
app.post('/admin/ministros/:id/remover', async c => {
  const id = c.req.param('id'), n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM processos WHERE relator_id=?').bind(id).first();
  if (n.n) return volta(c, '/admin', null, 'Este ministro tem processos. Redistribua antes de remover (ou marque como vago).');
  await c.env.DB.prepare('DELETE FROM ministros WHERE id=?').bind(id).run(); await log(c, 'ministro removido', '#' + id); return volta(c, '/admin', 'Ministro removido.');
});
app.post('/admin/perfis/novo', async c => {
  const b = await c.req.parseBody(), nome = up(b.nome, 80), id = txt(b.discord_id, 30); if (!nome || !id) return falha(c, 'Informe o ID do Discord e o nome.');
  await c.env.DB.prepare('INSERT INTO perfis(discord_id,nome,oab,npc) VALUES(?,?,?,1)').bind(id, nome, txt(b.oab, 20) || null).run();
  await log(c, 'perfil novo', `${nome} (${id})`); return volta(c, '/admin', 'Advogado temporário criado.');
});
app.post('/admin/perfis/:id/editar', async c => {
  const b = await c.req.parseBody(); await c.env.DB.prepare('UPDATE perfis SET nome=?,oab=? WHERE id=?').bind(up(b.nome, 80), txt(b.oab, 20) || null, c.req.param('id')).run();
  await log(c, 'perfil editado', `#${c.req.param('id')}`); return volta(c, '/admin', 'Perfil atualizado.');
});
app.post('/admin/perfis/:id/remover', async c => {
  const id = c.req.param('id'), n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM processos WHERE perfil_id=?').bind(id).first();
  if (n.n) return volta(c, '/admin', null, 'Este advogado tem processos e não pode ser removido.');
  await c.env.DB.prepare('DELETE FROM perfis WHERE id=?').bind(id).run(); await log(c, 'perfil removido', '#' + id); return volta(c, '/admin', 'Perfil removido.');
});
app.post('/processo/:n/retificar', async c => {
  const db = c.env.DB, n = parseInt(c.req.param('n'), 10), b = await c.req.parseBody();
  const p = await db.prepare('SELECT * FROM processos WHERE numero=?').bind(n).first(); if (!p) return c.notFound();
  const linhas = s => String(s || '').split('\n').map(x => up(x, 200)).filter(Boolean);
  const classe = txt(b.classe, 40) || p.classe, sit = SITUACOES.includes(b.situacao) ? b.situacao : p.situacao;
  await db.batch([
    db.prepare('UPDATE processos SET classe=?,assunto=?,sintese=?,pedido=?,liminar=?,etiquetas=?,situacao=? WHERE id=?').bind(classe, txt(b.assunto, 200) || p.assunto, limpa(b.sintese || ''), limpa(b.pedido || ''), b.liminar === '1' ? 1 : 0, txt(b.etiquetas, 200), sit, p.id),
    db.prepare('DELETE FROM partes WHERE processo_id=?').bind(p.id),
    ...linhas(b.autores).map(x => db.prepare('INSERT INTO partes(processo_id,polo,nome) VALUES(?,?,?)').bind(p.id, 'autor', x)),
    ...linhas(b.requeridos).map(x => db.prepare('INSERT INTO partes(processo_id,polo,nome) VALUES(?,?,?)').bind(p.id, 'requerido', x)),
    mov(db, p.id, 'DADOS RETIFICADOS', 'Dados retificados por determinação da administração.', 'SISTEMA PJe'),
  ]);
  await log(c, 'retificou', `${p.classe} ${p.numero}`); return volta(c, '/processo/' + n, 'Dados retificados.');
});
app.post('/processo/:n/redistribuir', async c => {
  const db = c.env.DB, n = parseInt(c.req.param('n'), 10), b = await c.req.parseBody();
  const p = await db.prepare('SELECT * FROM processos WHERE numero=?').bind(n).first(), m = await db.prepare('SELECT * FROM ministros WHERE id=?').bind(b.ministro).first();
  if (!p || !m) return falha(c, 'Processo ou ministro não encontrado.');
  const j = txt(b.justificativa, 300); if (!j) return falha(c, 'Informe a justificativa.');
  await db.batch([db.prepare('UPDATE processos SET relator_id=? WHERE id=?').bind(m.id, p.id), mov(db, p.id, 'REDISTRIBUÍDO', `Novo relator(a): ${MIN(m.nome)}. Justificativa: ${j}`, 'SISTEMA PJe')]);
  await log(c, 'redistribuiu', `${p.classe} ${p.numero} → ${m.nome}: ${j}`); return volta(c, '/processo/' + n, 'Processo redistribuído.');
});

export default app;
