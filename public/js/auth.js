import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, provider, ADMIN_EMAIL, loadAllowedEmails, saveAllowedEmails } from "./firebase-config.js";
import { state } from "./state.js";
import { modal } from "./modal.js";

window.doLogin = async () => {
  try { await signInWithPopup(auth, provider); }
  catch(e) { if (e.code !== 'auth/cancelled-popup-request') modal('Erro', e.message); }
};

window.solicitarAcesso = async function() {
  const saved = document.getElementById('btn-solicitar')?.dataset.email
    || sessionStorage.getItem('_deniedEmail')
    || localStorage.getItem('_deniedEmail')
    || '';
  const emailInp = await modal('📩 Solicitar Acesso', 'Informe seu e-mail Google:', {input: true, defaultVal: saved});
  if (!emailInp) return;
  let email = emailInp.trim().toLowerCase();
  if (!email.includes('@')) email += '@gmail.com';
  if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) { modal('⚠', 'Email inválido.'); return; }
  const msg = await modal('📩 Mensagem', 'Adicione uma mensagem (opcional):', {input: true, defaultVal: ''});
  if (msg === null) return;
  const texto = msg.trim() || 'Gostaria de solicitar acesso ao Controle de Ponto.';
  try {
    await setDoc(doc(db, "solicitacoes", email), { email, msg: texto, data: new Date().toISOString() });
    modal('✔ Enviado', 'Solicitação registrada! O administrador será notificado.');
  } catch(e) {
    modal('⚠ Erro', 'Não foi possível enviar: ' + e.message);
  }
};

window.doLogout = async () => { await signOut(auth); };

window.gerenciarUsuarios = async function() {
  if (state.currentUser?.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return;
  const emails = await loadAllowedEmails();

  // Carregar solicitações pendentes
  const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const solSnap = await getDocs(collection(db, "solicitacoes"));
  const solicitacoes = solSnap.docs.map(d => d.data());

  const bg = document.getElementById('modalBg');
  document.getElementById('modalTitle').textContent = '👥 Gerenciar Usuários';
  document.getElementById('modalMsg').textContent = '';
  document.getElementById('modalInput').style.display = 'none';
  document.getElementById('modalCancel').style.display = '';
  const ta = document.getElementById('modalTextarea');
  if (ta) ta.style.display = 'none';

  let container = document.getElementById('modal-users');
  if (!container) {
    container = document.createElement('div');
    container.id = 'modal-users';
    container.style.cssText = 'margin:12px 0;max-height:250px;overflow-y:auto';
    document.getElementById('modalMsg').after(container);
  }
  container.style.display = '';

  function render() {
    let html = '<div style="font-size:12px;opacity:.6;margin-bottom:6px">Autorizados:</div>';
    html += emails.map((e, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #333">
        <span style="flex:1;font-size:13px">${e}${e.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? ' 👑' : ''}</span>
        ${e.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ? `<button onclick="document.dispatchEvent(new CustomEvent('rm-user',{detail:${i}}))" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:14px">✕</button>` : ''}
      </div>
    `).join('');
    if (solicitacoes.length) {
      html += '<div style="font-size:12px;opacity:.6;margin:10px 0 6px">Solicitações pendentes:</div>';
      html += solicitacoes.map((s, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #444;background:#1a2a1a;border-radius:4px;padding:6px;margin:2px 0">
          <div style="flex:1;font-size:12px"><b>${s.email}</b><br><span style="opacity:.6">${s.msg}</span></div>
          <button onclick="document.dispatchEvent(new CustomEvent('approve-user',{detail:${i}}))" style="background:#27ae60;border:none;color:#fff;cursor:pointer;padding:4px 8px;border-radius:3px;font-size:12px">✔</button>
          <button onclick="document.dispatchEvent(new CustomEvent('reject-user',{detail:${i}}))" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:14px">✕</button>
        </div>
      `).join('');
    }
    container.innerHTML = html;
  }
  render();

  let addDiv = document.getElementById('modal-users-add');
  if (!addDiv) {
    addDiv = document.createElement('div');
    addDiv.id = 'modal-users-add';
    addDiv.style.cssText = 'display:flex;gap:8px;margin-top:10px';
    addDiv.innerHTML = `<input type="email" id="newEmailInp" placeholder="novo@gmail.com" style="flex:1;padding:6px;background:#1a1a2e;color:#e0e0e0;border:1px solid #444;border-radius:4px;font-size:13px" onkeydown="if(event.key==='Enter'){event.preventDefault();document.dispatchEvent(new Event('add-user'))}">
      <button onclick="document.dispatchEvent(new Event('add-user'))" style="padding:6px 12px;background:#27ae60;color:#fff;border:none;border-radius:4px;cursor:pointer">+</button>`;
    container.after(addDiv);
  }
  addDiv.style.display = 'flex';

  const rmHandler = (ev) => { emails.splice(ev.detail, 1); render(); };
  const addHandler = () => {
    const inp = document.getElementById('newEmailInp');
    let v = inp.value.trim().toLowerCase();
    if (!v) return;
    if (!v.includes('@')) v += '@gmail.com';
    if (!v.match(/^[^@]+@[^@]+\.[^@]+$/)) return;
    if (!emails.includes(v)) { emails.push(v); inp.value = ''; render(); }
  };
  function updateBadge() {
    const adminBtn = document.getElementById("btn-admin");
    if (adminBtn) adminBtn.innerHTML = solicitacoes.length > 0 ? `👥 <span style="color:#e74c3c;font-weight:bold">(${solicitacoes.length})</span>` : '👥';
  }
  const approveHandler = async (ev) => {
    const s = solicitacoes[ev.detail];
    if (!emails.includes(s.email)) emails.push(s.email);
    await deleteDoc(doc(db, "solicitacoes", s.email));
    solicitacoes.splice(ev.detail, 1);
    render();
    updateBadge();
  };
  const rejectHandler = async (ev) => {
    const s = solicitacoes[ev.detail];
    await deleteDoc(doc(db, "solicitacoes", s.email));
    solicitacoes.splice(ev.detail, 1);
    render();
    updateBadge();
  };
  document.addEventListener('rm-user', rmHandler);
  document.addEventListener('add-user', addHandler);
  document.addEventListener('approve-user', approveHandler);
  document.addEventListener('reject-user', rejectHandler);

  bg.classList.add('active');
  const result = await new Promise(resolve => {
    document.getElementById('modalOk').onclick = () => resolve(true);
    document.getElementById('modalCancel').onclick = () => resolve(null);
  });
  bg.classList.remove('active');
  container.style.display = 'none';
  addDiv.style.display = 'none';
  document.removeEventListener('rm-user', rmHandler);
  document.removeEventListener('add-user', addHandler);
  document.removeEventListener('approve-user', approveHandler);
  document.removeEventListener('reject-user', rejectHandler);

  if (result) {
    await saveAllowedEmails(emails);
    modal('✔ Salvo', emails.length + ' usuário(s) autorizados.');
  }
};

onAuthStateChanged(auth, async user => {
  if (user) {
    let allowed = false;
    try {
      const emails = await loadAllowedEmails();
      console.log('Emails permitidos:', emails, 'User:', user.email);
      allowed = emails.map(e => e.toLowerCase()).includes(user.email.toLowerCase());
    } catch(e) {
      console.log('Erro ao carregar emails:', e);
      allowed = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    }
    if (!allowed) {
      console.log('Acesso negado para:', user.email);
      try { localStorage.setItem('_deniedEmail', user.email); } catch(e) {}
      try { sessionStorage.setItem('_deniedEmail', user.email); } catch(e) {}
      const btnSol = document.getElementById("btn-solicitar");
      if (btnSol) btnSol.dataset.email = user.email;
      await signOut(auth);
      document.getElementById("screen-login").style.display = "flex";
      document.getElementById("screen-app").style.display = "none";
      document.getElementById("access-denied").style.display = "block";
      document.getElementById("btn-solicitar").style.display = "";
      return;
    }
  }
  document.getElementById("access-denied").style.display = "none";
  state.currentUser = user;
  document.getElementById("screen-login").style.display = user ? "none" : "flex";
  document.getElementById("screen-app").style.display = user ? "block" : "none";
  if (user) {
    document.getElementById("user-name").textContent = user.displayName?.split(" ")[0] ?? "Você";
    document.getElementById("user-photo").src = user.photoURL ?? "";
    // Mostrar botão admin
    const adminBtn = document.getElementById("btn-admin");
    if (adminBtn) {
      if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        adminBtn.style.display = '';
        // Verificar solicitações pendentes
        try {
          const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
          const solSnap = await getDocs(collection(db, "solicitacoes"));
          adminBtn.innerHTML = solSnap.size > 0 ? `👥 <span style="color:#e74c3c;font-weight:bold">(${solSnap.size})</span>` : '👥';
        } catch(e) { adminBtn.textContent = '👥'; }
      } else {
        adminBtn.style.display = 'none';
      }
    }
    if (window.loadPeriodo) await window.loadPeriodo();
    // Polling de solicitações a cada 60s
    if (!window._solPoll) {
      window._solPoll = setInterval(async () => {
        try {
          const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
          const snap = await getDocs(collection(db, "solicitacoes"));
          const btn = document.getElementById("btn-admin");
          if (btn) btn.innerHTML = snap.size > 0 ? `👥 <span style="color:#e74c3c;font-weight:bold">(${snap.size})</span>` : '👥';
        } catch(e) {}
      }, 60000);
    }
  }
});
