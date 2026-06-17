import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, provider, EMAILS_PERMITIDOS } from "./firebase-config.js";
import { state } from "./state.js";
import { modal } from "./modal.js";

window.doLogin = async () => {
  try { await signInWithPopup(auth, provider); }
  catch(e) { if (e.code !== 'auth/cancelled-popup-request') modal('Erro', e.message); }
};

window.doLogout = async () => { await signOut(auth); };

onAuthStateChanged(auth, async user => {
  if (user && !EMAILS_PERMITIDOS.includes(user.email)) {
    await signOut(auth);
    document.getElementById("screen-login").style.display = "flex";
    document.getElementById("screen-app").style.display = "none";
    document.getElementById("access-denied").style.display = "block";
    return;
  }
  document.getElementById("access-denied").style.display = "none";
  state.currentUser = user;
  document.getElementById("screen-login").style.display = user ? "none" : "flex";
  document.getElementById("screen-app").style.display = user ? "block" : "none";
  if (user) {
    document.getElementById("user-name").textContent = user.displayName?.split(" ")[0] ?? "Você";
    document.getElementById("user-photo").src = user.photoURL ?? "";
    if (window.loadPeriodo) await window.loadPeriodo();
  }
});
