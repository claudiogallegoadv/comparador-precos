const SUPABASE_URL = 'https://nathaeuqbeqlvkftbmes.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Vfc0LObDm13-g74oZ6-xXg_gb5bbtYn'; // chave pública: quem protege os dados é o login + RLS
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const UNITS = { g: ['kg', 1 / 1000], kg: ['kg', 1], ml: ['L', 1 / 1000], L: ['L', 1], un: ['un', 1] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = v => 'R$ ' + v.toFixed(2).replace('.', ',');
const dataBr = iso => iso ? iso.split('-').reverse().join('/') : '';
$('un').innerHTML = Object.keys(UNITS).map(u => `<option${u === 'un' ? ' selected' : ''}>${u}</option>`).join('');

function porUnidade(preco, qtd, unidade, frete = 0) {
  const u = UNITS[unidade]; if (!u) return null;
  const q = qtd * u[1];
  if (!(preco > 0) || !(q > 0)) return null;
  return { base: u[0], valor: (preco + frete) / q };
}

// ---------- Login ----------
const msgLogin = (t, cls) => { $('loginMsg').innerHTML = `<small class="${cls || ''}">${esc(t)}</small>`; };
$('entrar').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('senha').value });
  if (error) msgLogin('Não consegui entrar: ' + error.message);
};
$('criar').onclick = async () => {
  const { error } = await sb.auth.signUp({ email: $('email').value.trim(), password: $('senha').value });
  msgLogin(error ? 'Erro: ' + error.message : 'Conta criada. Se pedir, confirme pelo e-mail e depois clique em Entrar.');
};
$('sair').onclick = () => sb.auth.signOut();
sb.auth.onAuthStateChange((_e, sessao) => {
  $('loginCard').hidden = !!sessao;
  $('appBox').hidden = !sessao;
});
sb.auth.getSession().then(({ data }) => {
  $('loginCard').hidden = !!data.session;
  $('appBox').hidden = !data.session;
});

// ---------- Busca no histórico ----------
let historico = [];

async function buscar() {
  const ean = $('ean').value.trim();
  if (!ean) return;
  $('hist').innerHTML = '<small>Buscando…</small>';
  const { data, error } = await sb.from('cp_precos').select('*').eq('ean', ean).order('data_ref', { ascending: false }).limit(60);
  if (error) { $('hist').innerHTML = `<small class="bad">Erro: ${esc(error.message)}</small>`; return; }
  historico = data || [];
  if (!historico.length) {
    $('hist').innerHTML = '<small>Produto novo: nenhum preço salvo ainda. Digite o nome e o preço da prateleira e salve.</small>';
    veredito(); return;
  }
  const ult = historico[0];
  if (!$('nome').value) $('nome').value = ult.produto;
  $('qtd').value = ult.qtd; $('un').value = ult.unidade; // tamanho do pacote conhecido
  renderHist(); veredito();
}

// Para preços sem código de barras (ex.: capturados de lojas online): procura pelas palavras do nome
async function buscarNome() {
  const palavras = $('nome').value.toLowerCase().replace(/[%_,()]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  if (!palavras.length) return;
  $('hist').innerHTML = '<small>Buscando…</small>';
  let q = sb.from('cp_precos').select('*').order('data_ref', { ascending: false }).limit(60);
  palavras.forEach(w => { q = q.ilike('produto', `%${w}%`); });
  const { data, error } = await q;
  if (error) { $('hist').innerHTML = `<small>Erro: ${esc(error.message)}</small>`; return; }
  historico = data || [];
  if (!historico.length) { $('hist').innerHTML = '<small>Nada encontrado com esse nome.</small>'; veredito(); return; }
  $('qtd').value = historico[0].qtd; $('un').value = historico[0].unidade;
  renderHist(); veredito();
}
$('buscarNome').onclick = buscarNome;

function renderHist() {
  // último preço de cada loja+origem
  const vistos = new Map();
  historico.forEach(h => { const k = h.loja + '|' + h.origem; if (!vistos.has(k)) vistos.set(k, h); });
  const linhas = [...vistos.values()].map(h => ({ h, p: porUnidade(+h.preco, +h.qtd, h.unidade, +h.frete) })).filter(x => x.p);
  linhas.sort((a, b) => a.p.valor - b.p.valor);
  $('hist').innerHTML = linhas.map(({ h, p }, i) =>
    `<div class="res ${i === 0 ? 'best' : ''}"><span>${esc(h.loja)} <small>(${esc(h.origem)}, ${dataBr(h.data_ref)})</small></span><span>${money(p.valor)}/${p.base}</span></div>`).join('')
    || '<small>Sem preços comparáveis.</small>';
}

// ---------- Comparação ----------
function veredito() {
  const p = porUnidade(+$('preco').value, +$('qtd').value, $('un').value);
  if (!p) { $('veredito').innerHTML = ''; return; }
  const iguais = historico
    .map(h => ({ h, x: porUnidade(+h.preco, +h.qtd, h.unidade, +h.frete) }))
    .filter(o => o.x && o.x.base === p.base);
  if (!iguais.length) { $('veredito').innerHTML = `<div class="verdict">${money(p.valor)}/${p.base} <small>(sem histórico para comparar)</small></div>`; return; }
  iguais.sort((a, b) => a.x.valor - b.x.valor);
  const melhor = iguais[0];
  const dif = (p.valor / melhor.x.valor - 1) * 100;
  if (p.valor <= melhor.x.valor * 1.005) {
    $('veredito').innerHTML = `<div class="verdict ok">✅ Compre! É o menor preço que eu conheço (${money(p.valor)}/${p.base}).</div>`;
  } else {
    $('veredito').innerHTML = `<div class="verdict bad">⚠️ ${dif.toFixed(0)}% mais caro que ${esc(melhor.h.loja)} (${money(melhor.x.valor)}/${p.base}).</div>`;
  }
}
['preco', 'qtd', 'un'].forEach(id => $(id).addEventListener('input', veredito));
$('buscar').onclick = buscar;
$('ean').addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });

// ---------- Salvar ----------
$('salvar').onclick = async () => {
  const preco = +$('preco').value, qtd = +$('qtd').value;
  const msg = (t, cls) => { $('salvoMsg').innerHTML = `<small class="${cls || ''}">${esc(t)}</small>`; };
  if (!$('nome').value.trim() || !$('loja').value.trim() || !(preco > 0) || !(qtd > 0)) return msg('Preencha produto, mercado, preço e quantidade.', 'bad');
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('cp_precos').insert({
    user_id: user.id, ean: $('ean').value.trim() || null, produto: $('nome').value.trim(), loja: $('loja').value.trim(),
    origem: 'prateleira', preco, qtd, unidade: $('un').value,
  });
  if (error) return msg('Erro ao salvar: ' + error.message, 'bad');
  msg('✅ Preço salvo.'); buscar();
};

// ---------- Leitor de código de barras ----------
let stream = null, zx = null;
function pararCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (zx) { zx.reset(); zx = null; }
  $('vid').hidden = true;
}

// Plano B para navegadores sem BarcodeDetector (iPhone/Safari, Firefox etc.): biblioteca ZXing
function escanearComZxing() {
  const F = ZXing.BarcodeFormat, hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  pararCamera();
  const reader = new ZXing.BrowserMultiFormatReader(hints);
  zx = reader;
  const v = $('vid'); v.hidden = false;
  reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, v, (res) => {
    if (!res) return;
    $('ean').value = res.getText(); pararCamera(); navigator.vibrate?.(60); buscar();
  }).catch(() => { pararCamera(); alert('Não consegui acessar a câmera. Permita o acesso ou digite o número.'); });
}

$('scan').onclick = async () => {
  if (!('BarcodeDetector' in window)) {
    if (window.ZXing) return escanearComZxing();
    alert('Este navegador não lê código de barras. Digite o número.'); return;
  }
  try {
    pararCamera();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('vid'); v.srcObject = stream; v.hidden = false; await v.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const loop = async () => {
      if (!stream) return;
      const r = await det.detect(v).catch(() => []);
      if (r.length) { $('ean').value = r[0].rawValue; pararCamera(); navigator.vibrate?.(60); buscar(); return; }
      requestAnimationFrame(loop);
    };
    loop();
  } catch { alert('Não consegui acessar a câmera. Permita o acesso ou digite o número.'); }
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
