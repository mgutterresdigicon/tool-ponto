import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { state } from "./state.js";

function getKey(ano, periodo) { return `${ano}_${periodo}`; }

let activeListener = null;

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

export function listenPeriodo(ano, periodo, onChange) {
  if (activeListener) { activeListener(); activeListener = null; }
  const uid = state.currentUser?.uid;
  if (!uid) return;
  activeListener = onSnapshot(doc(db, "pontos", uid, "periodos", getKey(ano, periodo)), (snap) => {
    if (snap.exists()) {
      const data = JSON.parse(snap.data().data);
      localStorage.setItem(`ponto${ano}_${periodo}`, JSON.stringify(data));
      if (onChange) onChange(data);
    }
  });
}

export async function saveSettings(settings) {
  const uid = state.currentUser?.uid;
  if (uid) {
    await setDoc(doc(db, "config", uid, "data", "ponto_settings"), settings);
  }
  localStorage.setItem('ponto_settings', JSON.stringify(settings));
}

export async function saveNotificationSettings(settings) {
  const uid = state.currentUser?.uid;
  if (uid) {
    await setDoc(doc(db, "config", uid, "data", "ponto_notification_settings"), settings);
  }
  localStorage.setItem('ponto_notification_settings', JSON.stringify(settings));
}

export async function loadSettings() {
  const uid = state.currentUser?.uid;
  let pontoSettings = null;
  let notificationSettings = null;

  if (uid) {
    // Sempre prioriza o Firestore quando logado (garante sync entre dispositivos)
    const [pontoSnap, notifSnap] = await Promise.all([
      getDoc(doc(db, "config", uid, "data", "ponto_settings")),
      getDoc(doc(db, "config", uid, "data", "ponto_notification_settings")),
    ]);

    if (pontoSnap.exists()) {
      pontoSettings = pontoSnap.data();
      localStorage.setItem('ponto_settings', JSON.stringify(pontoSettings));
    }

    if (notifSnap.exists()) {
      notificationSettings = notifSnap.data();
      localStorage.setItem('ponto_notification_settings', JSON.stringify(notificationSettings));
    }
  }

  // Fallback para localStorage quando offline ou não logado
  if (!pontoSettings) {
    const raw = localStorage.getItem('ponto_settings');
    if (raw) pontoSettings = JSON.parse(raw);
  }
  if (!notificationSettings) {
    const raw = localStorage.getItem('ponto_notification_settings');
    if (raw) notificationSettings = JSON.parse(raw);
  }

  return { ...pontoSettings, notificationSettings };
}

export async function savePeriodoConfig(mes, cfg) {
  localStorage.setItem('ponto_periodo_' + mes, JSON.stringify(cfg));
  const settings = await loadSettings();
  settings.periodos = settings.periodos || {};
  settings.periodos[mes] = cfg;
  await saveSettings(settings);
}

export async function loadPeriodoConfigs() {
  const settings = await loadSettings();
  const periodos = settings.periodos || {};
  Object.entries(periodos).forEach(([mes, cfg]) => {
    localStorage.setItem('ponto_periodo_' + mes, JSON.stringify(cfg));
  });
  return periodos;
}
