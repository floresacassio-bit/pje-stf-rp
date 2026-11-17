import { html, raw } from './util.js';
export const CLASSES = ['ACO','ADI','ADM','ADO','AI','AO','AP','AR','Arg.Imp','Arg.Inc','Arg.Susp','CC','CJ','Emb.Decl','Emb.Div','Emb.Infr','Ext','HC','HD','Inq','MI','MS','PA','Pet','PPE','RE','RC','Rcl','RHD','RHC','RMS','RO','RP','RvC','SL','SLC','Susp.Lim','Susp.Senta','AgRg'];
const LOGO = raw('<svg width="70" height="40" viewBox="8 8 546 314" role="img" aria-label="STF"><path fill="#fff" d="M8 8H175V49.5C175 141.5 115.1 241.7 8 253ZM8 264H20.3C83 265.5 134.8 290.3 163 321H8ZM197 8H364V49.5C364 141.5 304.1 241.7 197 253ZM197 264H209.3C272 265.5 323.8 290.3 352 321H197ZM386 8H553V49.5C553 141.5 493.1 241.7 386 253ZM386 264H398.3C461 265.5 512.8 290.3 541 321H386Z"/></svg>');
export const tag = (t, c = 'o') => html`<span class="tg ${c}">${t}</span>`;
const SIG = { publico: ['PÚBLICO', 'g'], segredo: ['SEGREDO DE JUSTIÇA', 'k'], absoluto: ['SIGILO ABSOLUTO', 'r'] };
export const sigiloTag = s => tag(...(SIG[s] || SIG.segredo));
export const MIN = n => n ? 'MIN. ' + n : '–';

const IC = d => raw(`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="${d}" stroke="#1c2a21" stroke-width="2" fill="none"/></svg>`);
const AL = { justifyLeft: ['M3 5h14M3 9h9M3 13h14M3 17h9', 'Alinhar à esquerda'], justifyCenter: ['M3 5h14M6 9h8M3 13h14M6 17h8', 'Centralizar'], justifyRight: ['M3 5h14M8 9h9M3 13h14M8 17h9', 'Alinhar à direita'], justifyFull: ['M3 5h14M3 9h14M3 13h14M3 17h14', 'Justificar'] };
import { limpa } from './util.js';
// Editor de texto formatado (negrito, itálico, sublinhado, alinhamento)
export const rte = (nome, rotulo, valor = '') => html`<div style="margin-bottom:12px"><span class="fl">${rotulo}</span><div class="rte" data-rte><div class="tl"><button type="button" class="tbn" data-cmd="bold" aria-label="Negrito"><b>B</b></button><button type="button" class="tbn" data-cmd="italic" aria-label="Itálico"><i>I</i></button><button type="button" class="tbn" data-cmd="underline" aria-label="Sublinhado"><u>U</u></button><span class="al"><button type="button" class="tbn" data-al aria-label="Alinhamento" aria-expanded="false">${IC(AL.justifyLeft[0])}<span style="font-size:10px;margin-left:4px">▼</span></button><div class="mn" hidden>${Object.entries(AL).map(([c, [d, n]]) => html`<button type="button" class="tbn" data-cmd="${c}" aria-label="${n}">${IC(d)}</button>`)}</div></span></div><div class="ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${rotulo}">${raw(limpa(valor))}</div><input type="hidden" name="${nome}"></div></div>`;

export function pagina(c, titulo, sub, corpo, status = 200) {
  const u = c.get('u');
  const dir = u ? html`<span style="font-size:13px">${u.nome}</span><a class="bs" href="/meus">Meus processos</a>${u.admin ? html`<a class="bs" href="/admin">Administração</a>` : ''}<a class="bs" href="/sair">Sair</a>` : html`<a class="bs" href="/login">Entrar com Discord</a>`;
  const ok = c.req.query('ok'), er = c.req.query('erro');
  const flash = ok ? html`<div class="msg" role="status">${ok.slice(0, 200)}</div>` : er ? html`<div class="msg er" role="alert">${er.slice(0, 200)}</div>` : '';
  const pg = html`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PJe – ${titulo}</title><link rel="stylesheet" href="/style.css"></head><body><div class="hd"><div class="hi"><a href="/" style="display:flex" aria-label="Início">${LOGO}</a><div><b>PJe – Processo Judicial Eletrônico</b><br><small>Supremo Tribunal Federal – ${sub}</small></div><span class="sp"></span>${dir}</div></div><div class="wr">${flash}${corpo}</div><script src="/app.js" defer></script></body></html>`;
  return c.html(pg.s, status);
}
