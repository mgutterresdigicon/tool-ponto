import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { state } from "./state.js";

function getKey(ano, periodo) { return `${ano}_${periodo}`; }

export async function savePeriodo(ano, periodo, rows) {
  const uid = state.currentUser?.uid;
  localStorage.setItem(`ponto${ano}_${periodo}`, JSON.stringify(rows));
  if (uid) {
    await setDoc(doc(db, "pontos", uid, "periodos", getKey(ano, periodo)), { data: JSON.stringify(rows) });
  }
}

export async function loadPeriodoData(ano, periodo) {
  const uid = state.currentUser?.uid;
  if (uid) {
    const snap = await getDoc(doc(db, "pontos", uid, "periodos", getKey(ano, periodo)));
    if (snap.exists()) {
      const data = JSON.parse(snap.data().data);
      localStorage.setItem(`ponto${ano}_${periodo}`, JSON.stringify(data));
      return data;
    }
  }
  const raw = localStorage.getItem(`ponto${ano}_${periodo}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSettings(settings) {
  const uid = state.currentUser?.uid;
  if (uid) {
    await setDoc(doc(db, "config", uid, "data", "ponto_settings"), settings);
  }
  localStorage.setItem('ponto_settings', JSON.stringify(settings));
}

export async function loadSettings() {
  const uid = state.currentUser?.uid;
  if (uid) {
    const snap = await getDoc(doc(db, "config", uid, "data", "ponto_settings"));
    if (snap.exists()) {
      const data = snap.data();
      localStorage.setItem('ponto_settings', JSON.stringify(data));
      return data;
    }
  }
  const raw = localStorage.getItem('ponto_settings');
  return raw ? JSON.parse(raw) : { cargaDia: '08:48', periodos: {} };
}
