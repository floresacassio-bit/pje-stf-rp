(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Editor de texto formatado
$$('[data-rte]').forEach(b => {
  const ed = $('.ed', b), hid = $('input[type=hidden]', b), mn = $('.mn', b), ab = $('[data-al]', b);
  $$('[data-cmd]', b).forEach(x => {
    x.addEventListener('mousedown', e => e.preventDefault());
    x.addEventListener('click', () => { ed.focus(); document.execCommand(x.dataset.cmd, false, null); if (mn) { mn.hidden = true; ab.setAttribute('aria-expanded', 'false'); } });
  });
  if (ab) {
    ab.addEventListener('mousedown', e => e.preventDefault());
    ab.addEventListener('click', () => { mn.hidden = !mn.hidden; ab.setAttribute('aria-expanded', String(!mn.hidden)); });
  }
  const f = b.closest('form'); if (f) f.addEventListener('submit', () => { hid.value = ed.innerHTML; });
});
// Requeridos (lista com adicionar/excluir)
const req = $('#req');
if (req) {
  const lista = $('#reqs');
  const add = () => {
    const v = req.value.trim(); if (!v) return;
    const d = document.createElement('div'); d.className = 'lr';
    const s = document.createElement('span'); s.textContent = v;
    const i = document.createElement('input'); i.type = 'hidden'; i.name = 'requerido'; i.value = v;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'bl'; x.textContent = 'Excluir'; x.onclick = () => d.remove();
    d.append(s, i, x); lista.append(d); req.value = '';
  };
  $('#addreq').onclick = add;
  req.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  req.closest('form').addEventListener('submit', add);
}
// Anexos por link
$$('[data-addlink]').forEach(btn => {
  btn.onclick = () => {
    const d = document.createElement('div'); d.className = 'lk';
    d.innerHTML = '<input name="anexo_titulo" placeholder="Título" aria-label="Título do anexo"><input name="anexo_url" placeholder="Link (https://…)" aria-label="Link do anexo"><button type="button" class="bl">Remover</button>';
    $('button', d).onclick = () => d.remove();
    $(btn.dataset.addlink).append(d);
  };
});
// Classe: "Outro" libera a escrita no próprio campo
const cs = $('#classe'), co = $('#classe_outro');
if (cs && co) {
  cs.addEventListener('change', () => { if (cs.value === 'Outro') { cs.hidden = true; co.hidden = false; co.focus(); } });
  co.addEventListener('blur', () => { if (!co.value.trim()) { co.hidden = true; cs.hidden = false; cs.value = ''; } });
}
// Barra de pesquisa
const tp = $('#tipo');
if (tp) {
  const fx = () => { $('#cls').hidden = tp.value !== 'classe_numero'; $('#q').placeholder = { classe_numero: 'Digite o número do processo (ex: 100)', numero_unico: 'Digite o número do processo', parte: 'Digite o nome da parte', advogado: 'Digite o nome do advogado' }[tp.value]; };
  tp.onchange = fx; fx();
}
$$('[data-back]').forEach(b => b.onclick = () => history.back());
})();
