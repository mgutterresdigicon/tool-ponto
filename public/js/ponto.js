import { savePeriodo, loadPeriodoData, listenPeriodo, saveSettings, loadSettings } from "./storage.js";
import { modal } from "./modal.js";

const tbody = document.getElementById('tbody');

// ─── Utilidades ───
export function timeToMin(str) {
  if (!str || str.trim() === '') return null;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function minToStr(min) {
  if (min == null) return '';
  const neg = min < 0;
  min = Math.abs(min);
  return (neg ? '-' : '') + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

function formatInput(inp) {
  const v = inp.value.replace(/[^0-9]/g, '');
  if (!v) return;
  if (inp.value.includes(':')) return;
  if (v.length <= 2) inp.value = v.padStart(2, '0') + ':00';
  else { const p = v.padStart(4, '0'); inp.value = p.slice(0, 2) + ':' + p.slice(2, 4); }
}

// ─── Turno 3 ───
function updateT3Visibility() {
  const hasT3 = tbody.querySelector('.turno3') != null;
  document.querySelectorAll('.col-t3').forEach(el => el.style.display = hasT3 ? 'table-cell' : 'none');
  tbody.querySelectorAll('tr').forEach(tr => {
    const has = tr.querySelector('.turno3');
    let placeholders = tr.querySelectorAll('.t3-placeholder');
    if (hasT3 && !has && placeholders.length === 0) {
      const inp = tr.querySelectorAll('input[type="text"]');
      const s2td = inp[7].parentElement;
      const t2td = s2td.nextElementSibling;
      for (let i = 0; i < 3; i++) { const td = document.createElement('td'); td.className = 't3-placeholder'; t2td.after(td); }
    } else if (!hasT3 && placeholders.length) {
      placeholders.forEach(el => el.remove());
    }
  });
}

window.addTurno3 = function(tr) {
  if (tr.querySelector('.turno3')) {
    tr.querySelectorAll('.turno3').forEach(el => el.remove());
    calcRow(tr);
    updateT3Visibility();
    return;
  }
  tr.querySelectorAll('.t3-placeholder').forEach(el => el.remove());
  const inp = tr.querySelectorAll('input[type="text"]');
  const s2td = inp[7].parentElement;
  const t2td = s2td.nextElementSibling;
  const e3td = document.createElement('td');
  e3td.className = 'turno3';
  e3td.innerHTML = '<input type="text" placeholder="HH:MM" style="width:55px">';
  const s3td = document.createElement('td');
  s3td.className = 'turno3';
  s3td.innerHTML = '<input type="text" placeholder="HH:MM" style="width:55px">';
  const t3td = document.createElement('td');
  t3td.className = 'turno3 calc';
  t2td.after(e3td, s3td, t3td);
  [e3td, s3td].forEach((td, i) => {
    const input = td.querySelector('input');
    input.addEventListener('input', () => calcRow(tr));
    input.addEventListener('blur', function() { formatInput(this); calcRow(tr); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        formatInput(this);
        calcRow(tr);
        if (i === 0) { s3td.querySelector('input').focus(); }
        else { const next = tr.nextElementSibling?.querySelectorAll('input[type="text"]')[4]; if (next) { next.focus(); next.select(); } }
      }
    });
  });
  calcRow(tr);
  updateT3Visibility();
};

// ─── Cálculos ───
function calcRow(tr) {
  const inp = tr.querySelectorAll('input[type="text"]');
  const baseCarga = timeToMin(document.getElementById('cargaDia').value) || 528;
  const bonus = timeToMin(inp[1].value) || 0;
  const comp = timeToMin(inp[3].value) || 0;
  const carga = Math.abs(baseCarga - bonus + comp);
  inp[2].value = minToStr(carga);

  const diaNum = parseInt(inp[0].value);
  const semCell = tr.querySelector('.dia-sem');
  if (diaNum && semCell) {
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const sel = document.getElementById('selPeriodo').value;
    const m1 = parseInt(sel) - 1;
    const year = parseInt(document.getElementById('anoCtrl').value);
    const cfg = JSON.parse(localStorage.getItem('ponto_periodo_' + sel) || 'null');
    const diaIni = cfg ? cfg.ini : 16;
    const mes = diaNum >= diaIni ? m1 : (m1 + 1) % 12;
    const y = (diaNum < diaIni && m1 === 11) ? year + 1 : year;
    semCell.textContent = dias[new Date(y, mes, diaNum).getDay()];
  } else if (semCell) { semCell.textContent = ''; }

  const e1 = timeToMin(inp[4].value), s1 = timeToMin(inp[5].value);
  const e2 = timeToMin(inp[6].value), s2 = timeToMin(inp[7].value);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const s1Calc = s1 != null ? s1 : (e1 != null ? nowMin : null);
  const s2Calc = s2 != null ? s2 : (e2 != null ? nowMin : null);
  const t1 = (e1 != null && s1Calc != null) ? s1Calc - e1 : null;
  const t2 = (e2 != null && s2Calc != null) ? s2Calc - e2 : null;

  const t3inputs = tr.querySelectorAll('.turno3 input');
  const e3 = t3inputs.length ? timeToMin(t3inputs[0].value) : null;
  const s3 = t3inputs.length ? timeToMin(t3inputs[1].value) : null;
  const s3Calc = s3 != null ? s3 : (e3 != null ? nowMin : null);
  const t3 = (e3 != null && s3Calc != null) ? s3Calc - e3 : null;

  const total = (t1 != null || t2 != null || t3 != null) ? (t1 || 0) + (t2 || 0) + (t3 || 0) : null;

  let normal = null, extra = null, he = null;
  if (e1 != null) {
    const intervalo = (e2 != null && s1 != null) ? e2 - s1 : 60;
    normal = e1 + carga + intervalo;
    extra = e1 + 600 + intervalo;
  }
  if (total != null) { const diff = total - carga; he = Math.abs(diff) >= 6 ? diff : 0; }

  const c = tr.querySelectorAll('.calc:not(.turno3)');
  c[0].textContent = minToStr(t1);
  c[1].textContent = minToStr(t2);
  const t3cell = tr.querySelector('.turno3.calc');
  if (t3cell) t3cell.textContent = minToStr(t3);
  c[2].textContent = minToStr(normal);
  c[2].style.color = '#ff9800';
  c[3].textContent = minToStr(extra);
  c[3].style.color = '#e74c3c';
  c[4].textContent = total != null ? (total / 60).toFixed(2) : '';
  c[5].textContent = minToStr(total);
  c[6].textContent = minToStr(he);
  c[6].className = 'calc ' + (he != null ? (he >= 0 ? 'positive' : 'negative') : '');

  updateSummary();
}

// ─── Linhas ───
window.addRow = function(dia = '', bonus = '', carga = '', comp = '', e1 = '', s1 = '', e2 = '', s2 = '', before = null) {
  if (!carga) carga = document.getElementById('cargaDia').value;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><button class="row-btn" onclick="addRow('','','','','','','','',this.closest('tr').nextElementSibling)" title="Adicionar linha abaixo">+</button><button class="row-btn btn-del" onclick="this.closest('tr').remove();updateSummary()" title="Remover linha">✕</button><button class="row-btn" onclick="addTurno3(this.closest('tr'))" title="Adicionar/remover turno 3">³</button></td>
    <td><input type="text" value="${dia}" placeholder="DD" style="width:35px"></td>
    <td class="dia-sem"></td>
    <td class="col-bc"><input type="text" value="${bonus}" style="width:45px"></td>
    <td><input type="text" value="${carga}" style="width:55px" readonly tabindex="-1"></td>
    <td class="col-bc"><input type="text" value="${comp}" style="width:45px"></td>
    <td><input type="text" value="${e1}" placeholder="HH:MM"></td>
    <td><input type="text" value="${s1}" placeholder="HH:MM"></td>
    <td class="calc"></td>
    <td><input type="text" value="${e2}" placeholder="HH:MM"></td>
    <td><input type="text" value="${s2}" placeholder="HH:MM"></td>
    <td class="calc"></td>
    <td class="calc"></td>
    <td class="calc"></td>
    <td class="calc"></td>
    <td class="calc"></td>
    <td class="calc"></td>
  `;
  const inputs = tr.querySelectorAll('input[type="text"]');
  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', () => calcRow(tr));
    inp.addEventListener('blur', function() { if (idx >= 1 && idx !== 2) { formatInput(this); calcRow(tr); } });
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (idx >= 1 && idx !== 2) { formatInput(this); calcRow(tr); }
        let next;
        if (idx === 7) {
          const e3 = tr.querySelector('.turno3 input');
          next = e3 || tr.nextElementSibling?.querySelectorAll('input[type="text"]')[4];
        }
        else if (idx < 4) next = inputs[4];
        else next = inputs[idx + 1];
        if (next) { next.focus(); next.select(); }
      }
    });
  });
  if (before) tbody.insertBefore(tr, before);
  else tbody.appendChild(tr);
  calcRow(tr);
  return tr;
};

// ─── Summary ───
window.updateSummary = function() {
  let sumCarga = 0, sumCargaParcial = 0, sumTrab = 0, sumHE = 0, sumAzure = 0;
  const baseCarga = timeToMin(document.getElementById('cargaDia').value) || 528;
  tbody.querySelectorAll('tr').forEach(tr => {
    const inp = tr.querySelectorAll('input[type="text"]');
    const bonus = timeToMin(inp[1].value) || 0;
    const comp = timeToMin(inp[3].value) || 0;
    const carga = Math.abs(baseCarga - bonus + comp);
    const e1 = timeToMin(inp[4].value), s1 = timeToMin(inp[5].value);
    const e2 = timeToMin(inp[6].value), s2 = timeToMin(inp[7].value);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const s1Calc = s1 != null ? s1 : (e1 != null ? nowMin : null);
    const s2Calc = s2 != null ? s2 : (e2 != null ? nowMin : null);
    const t1 = (e1 != null && s1Calc != null) ? s1Calc - e1 : 0;
    const t2 = (e2 != null && s2Calc != null) ? s2Calc - e2 : 0;
    const t3inputs = tr.querySelectorAll('.turno3 input');
    const e3 = t3inputs.length ? timeToMin(t3inputs[0].value) : null;
    const s3 = t3inputs.length ? timeToMin(t3inputs[1].value) : null;
    const s3Calc = s3 != null ? s3 : (e3 != null ? nowMin : null);
    const t3 = (e3 != null && s3Calc != null) ? s3Calc - e3 : 0;
    const total = t1 + t2 + t3;
    sumCarga += carga;
    if (e1 != null) {
      sumCargaParcial += carga;
      sumTrab += total;
      const diff = total - carga;
      sumHE += Math.abs(diff) >= 6 ? diff : 0;
      sumAzure += total / 60;
    }
  });
  document.getElementById('sumCarga').textContent = minToStr(sumCarga);
  document.getElementById('sumCargaParcial').textContent = minToStr(sumCargaParcial);
  document.getElementById('sumTrab').textContent = minToStr(sumTrab);
  document.getElementById('sumHE').textContent = minToStr(sumHE);
  document.getElementById('sumHE').className = sumHE >= 0 ? 'positive' : 'negative';
  document.getElementById('sumAzure').textContent = sumAzure.toFixed(2);
};

// ─── Registrar Ponto ───
window.registrarPonto = async function() {
  const now = new Date();
  const dia = String(now.getDate());
  const hora = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  // Encontrar a linha do dia atual
  let tr = null;
  tbody.querySelectorAll('tr').forEach(row => {
    const inp = row.querySelectorAll('input[type="text"]');
    if (inp[0].value === dia) tr = row;
  });

  if (!tr) {
    modal('⚠ Aviso', 'Dia ' + dia + ' não encontrado na tabela.');
    return;
  }

  const inp = tr.querySelectorAll('input[type="text"]');
  // Campos: 0=Dia, 1=Bônus, 2=Carga, 3=Comp, 4=E1, 5=S1, 6=E2, 7=S2
  let campo = null;
  if (!inp[4].value) campo = inp[4];       // Entrada1
  else if (!inp[5].value) campo = inp[5];  // Saída1
  else if (!inp[6].value) campo = inp[6];  // Entrada2
  else if (!inp[7].value) campo = inp[7];  // Saída2
  else {
    // Verificar turno 3
    const t3inputs = tr.querySelectorAll('.turno3 input');
    if (t3inputs.length) {
      if (!t3inputs[0].value) campo = t3inputs[0];
      else if (!t3inputs[1].value) campo = t3inputs[1];
    }
  }

  if (!campo) {
    modal('⚠ Aviso', 'Todos os campos do dia ' + dia + ' já estão preenchidos.');
    return;
  }

  campo.value = hora;
  campo.dispatchEvent(new Event('input'));

  // Salvar automaticamente
  await salvar();
};

// ─── Salvar / Carregar ───
window.salvar = async function() {
  const ano = document.getElementById('anoCtrl').value;
  const periodo = document.getElementById('selPeriodo').value;
  // Salvar período atual da tela
  const data = [];
  tbody.querySelectorAll('tr').forEach(tr => {
    const vals = Array.from(tr.querySelectorAll('input[type="text"]')).map(i => i.value);
    const t3inputs = tr.querySelectorAll('.turno3 input');
    const row = vals.slice(0, 8);
    if (t3inputs.length) { row.push(t3inputs[0].value); row.push(t3inputs[1].value); }
    data.push(row);
  });
  localStorage.setItem(`ponto${ano}_${periodo}`, JSON.stringify(data));
  // Salvar todos os períodos de todos os anos no Firestore
  try {
    window._saving = true;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const match = k.match(/^ponto(\d{4})_(\d{2})$/);
      if (match) {
        const rows = JSON.parse(localStorage.getItem(k));
        await savePeriodo(match[1], match[2], rows);
      }
    }
    window._saving = false;
    modal('✔ Salvo', 'Todos os dados salvos com sucesso!');
  } catch(e) {
    window._saving = false;
    modal('⚠ Erro', 'Erro ao salvar: ' + e.message);
  }
};

export async function loadPeriodo() {
  const sel = document.getElementById('selPeriodo').value;
  const ano = document.getElementById('anoCtrl').value;
  tbody.innerHTML = '';
  const data = await loadPeriodoData(ano, sel);
  if (data) {
    renderRows(data);
  } else {
    const cfg = JSON.parse(localStorage.getItem('ponto_periodo_' + sel) || 'null');
    const diaIni = cfg ? cfg.ini : 16;
    const diaFim = cfg ? cfg.fim : 15;
    const m1 = parseInt(sel) - 1, year = parseInt(ano);
    for (let d = diaIni; d <= new Date(year, m1 + 1, 0).getDate(); d++) {
      if (new Date(year, m1, d).getDay() % 6 !== 0) addRow(String(d));
    }
    const m2 = (m1 + 1) % 12, y2 = m1 === 11 ? year + 1 : year;
    for (let d = 1; d <= diaFim; d++) {
      if (new Date(y2, m2, d).getDay() % 6 !== 0) addRow(String(d));
    }
  }
  // Escutar mudanças em tempo real
  listenPeriodo(ano, sel, (newData) => {
    if (!window._saving) {
      tbody.innerHTML = '';
      renderRows(newData);
    }
  });
}

function renderRows(data) {
  data.forEach(v => {
    const tr = addRow(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
    if (v[8] || v[9]) {
      addTurno3(tr);
      const t3inputs = tr.querySelectorAll('.turno3 input');
      if (t3inputs[0]) t3inputs[0].value = v[8] || '';
      if (t3inputs[1]) t3inputs[1].value = v[9] || '';
      calcRow(tr);
    }
  });
}

// ─── Exportar ───
window.exportCSV = function() {
  let csv = 'Dia;Bonus;Carga;Comp;Entrada1;Saida1;Total1;Entrada2;Saida2;Total2;Normal;Extra;Total;Azure;HoraExtra\n';
  tbody.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).slice(1);
    csv += cells.map(c => { const i = c.querySelector('input'); return i ? i.value : c.textContent; }).join(';') + '\n';
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `ponto_${document.getElementById('selPeriodo').value}_${document.getElementById('anoCtrl').value}.csv`;
  a.click();
};

window.exportJSON = function() {
  const ano = document.getElementById('anoCtrl').value;
  const key = `ponto${ano}_`;
  const allData = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(key)) allData[k] = JSON.parse(localStorage.getItem(k));
  }
  const periodo = document.getElementById('selPeriodo').value;
  const cur = [];
  tbody.querySelectorAll('tr').forEach(tr => {
    const vals = Array.from(tr.querySelectorAll('input[type="text"]')).map(i => i.value).slice(0, 8);
    const t3inputs = tr.querySelectorAll('.turno3 input');
    if (t3inputs.length) { vals.push(t3inputs[0].value); vals.push(t3inputs[1].value); }
    cur.push(vals);
  });
  allData[key + periodo] = cur;
  const sorted = Object.keys(allData).sort().reduce((o, k) => { o[k] = allData[k]; return o; }, {});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(sorted, null, 2)], { type: 'application/json' }));
  a.download = `ponto_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};

window.importJSON = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const data = JSON.parse(e.target.result);
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    modal('✔ Importado', Object.keys(data).length + ' período(s) restaurados.');
    loadPeriodo();
  };
  reader.readAsText(file);
  event.target.value = '';
};

// ─── Controles ───
window.toggleBonusComp = function() {
  document.querySelectorAll('.col-bc').forEach(el => {
    el.style.display = el.style.display === '' ? 'table-cell' : '';
  });
};

window.editarPeriodo = async function() {
  const sel = document.getElementById('selPeriodo');
  const opt = sel.options[sel.selectedIndex];
  const cfg = JSON.parse(localStorage.getItem('ponto_periodo_' + sel.value) || 'null');
  const diaIni = cfg ? cfg.ini : 16;
  const diaFim = cfg ? cfg.fim : 15;
  const ano = document.getElementById('anoCtrl').value;
  const mesIni = parseInt(sel.value);
  const mesFim = mesIni % 12 + 1;

  const bg = document.getElementById('modalBg');
  const modalEl = document.querySelector('.modal');
  document.getElementById('modalTitle').textContent = '✏️ Editar Período';
  document.getElementById('modalMsg').textContent = '';
  document.getElementById('modalInput').style.display = 'none';
  document.getElementById('modalCancel').style.display = '';

  // Inserir campos de data
  const iniVal = `${ano}-${String(mesIni).padStart(2,'0')}-${String(diaIni).padStart(2,'0')}`;
  const fimVal = `${mesFim < mesIni ? parseInt(ano)+1 : ano}-${String(mesFim).padStart(2,'0')}-${String(diaFim).padStart(2,'0')}`;
  let container = document.getElementById('modal-periodo-fields');
  if (!container) {
    container = document.createElement('div');
    container.id = 'modal-periodo-fields';
    container.style.cssText = 'display:flex;gap:12px;margin:12px 0;align-items:center';
    container.innerHTML = `<label style="font-size:13px">Início:</label><input type="date" id="mpInicio" style="padding:6px;background:#1a1a2e;color:#e0e0e0;border:1px solid #444;border-radius:4px">
      <label style="font-size:13px">Fim:</label><input type="date" id="mpFim" style="padding:6px;background:#1a1a2e;color:#e0e0e0;border:1px solid #444;border-radius:4px">`;
    document.getElementById('modalMsg').after(container);
  }
  container.style.display = 'flex';
  document.getElementById('mpInicio').value = iniVal;
  document.getElementById('mpFim').value = fimVal;
  bg.classList.add('active');

  const result = await new Promise(resolve => {
    document.getElementById('modalOk').onclick = () => resolve(true);
    document.getElementById('modalCancel').onclick = () => resolve(null);
  });
  bg.classList.remove('active');
  container.style.display = 'none';

  if (!result) return;
  const ini = new Date(document.getElementById('mpInicio').value);
  const fim = new Date(document.getElementById('mpFim').value);
  const newIni = ini.getDate();
  const newFim = fim.getDate();
  const label = `${String(newIni).padStart(2,'0')}/${String(ini.getMonth()+1).padStart(2,'0')} - ${String(newFim).padStart(2,'0')}/${String(fim.getMonth()+1).padStart(2,'0')}`;
  opt.textContent = label;
  localStorage.setItem('ponto_periodo_' + sel.value, JSON.stringify({ label, ini: newIni, fim: newFim }));

  // Ajustar período anterior
  const idxAtual = sel.selectedIndex;
  if (idxAtual > 0) {
    const prevOpt = sel.options[idxAtual - 1];
    const prevCfg = JSON.parse(localStorage.getItem('ponto_periodo_' + prevOpt.value) || 'null');
    const prevIni = prevCfg ? prevCfg.ini : 16;
    const prevFim = newIni - 1;
    const prevLabel = String(prevIni).padStart(2,'0') + '/' + prevOpt.value + ' - ' + String(prevFim).padStart(2,'0') + '/' + sel.value;
    prevOpt.textContent = prevLabel;
    localStorage.setItem('ponto_periodo_' + prevOpt.value, JSON.stringify({ label: prevLabel, ini: prevIni, fim: prevFim }));
  }
  // Ajustar próximo período
  if (idxAtual < sel.options.length - 1) {
    const nextOpt = sel.options[idxAtual + 1];
    const nextCfg = JSON.parse(localStorage.getItem('ponto_periodo_' + nextOpt.value) || 'null');
    const nextFim = nextCfg ? nextCfg.fim : 15;
    const nextIni = newFim + 1;
    const nextLabel = String(nextIni).padStart(2,'0') + '/' + nextOpt.value + ' - ' + String(nextFim).padStart(2,'0') + '/' + String((parseInt(nextOpt.value) % 12) + 1).padStart(2,'0');
    nextOpt.textContent = nextLabel;
    localStorage.setItem('ponto_periodo_' + nextOpt.value, JSON.stringify({ label: nextLabel, ini: nextIni, fim: nextFim }));
  }
  loadPeriodo();
};

// ─── Init ───
document.getElementById('btnExport').addEventListener('click', exportCSV);
document.getElementById('selPeriodo').addEventListener('change', loadPeriodo);
document.getElementById('cargaDia').addEventListener('input', () => tbody.querySelectorAll('tr').forEach(calcRow));
document.getElementById('anoCtrl').addEventListener('change', function() {
  const now = new Date();
  const sel = document.getElementById('selPeriodo');
  if (parseInt(this.value) === now.getFullYear()) {
    sel.value = now.getDate() >= 16 ? String(now.getMonth() + 1).padStart(2, '0') : String(now.getMonth() || 12).padStart(2, '0');
  } else { sel.value = '01'; }
  loadPeriodo();
});

// Restaurar labels customizados
const sel = document.getElementById('selPeriodo');
Array.from(sel.options).forEach(opt => {
  const cfg = JSON.parse(localStorage.getItem('ponto_periodo_' + opt.value) || 'null');
  if (cfg) opt.textContent = cfg.label;
});
const now = new Date();
sel.value = now.getDate() >= 16 ? String(now.getMonth() + 1).padStart(2, '0') : String(now.getMonth() || 12).padStart(2, '0');

// Tick a cada minuto
function tickOnMinute() {
  tbody.querySelectorAll('tr').forEach(calcRow);
  setTimeout(tickOnMinute, 60000 - (Date.now() % 60000));
}
setTimeout(tickOnMinute, 60000 - (Date.now() % 60000));

window.loadPeriodo = loadPeriodo;
