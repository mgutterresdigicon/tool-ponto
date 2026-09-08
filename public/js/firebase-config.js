import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// Admin é o primeiro email da lista (pode gerenciar usuários)
export const ADMIN_EMAIL = "mgutterres.digicon@gmail.com";

// ⚠️ VAPID key: gere em Firebase Console → Configurações do projeto
//    → Cloud Messaging → Web Push certificates → Gerar par de chaves
export const VAPID_KEY = "BCi7zaTAw83ooPIsn32jRLJb_eXnJRV0FexnBCuTCo7jF7PmeztlwehhRygCKgKulgxykfqIXmOPqEnxg6WBzjU";

const firebaseConfig = {
  apiKey: "AIzaSyCG7q025r8RFRoZmcJynFUMvpJGuGNAC6k",
  authDomain: "tool-ponto.firebaseapp.com",
  projectId: "tool-ponto",
  storageBucket: "tool-ponto.firebasestorage.app",
  messagingSenderId: "425959566307",
  appId: "1:425959566307:web:c7d068cd24417a2e660ed6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// Firebase Cloud Messaging
export const messaging = getMessaging(app);

// Registra o FCM token do dispositivo no Firestore
// Chamado após login para garantir que a Cloud Function consiga enviar push
export async function registerFCMToken(uid) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    const swReg = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return;

    // Salva em config/{uid}/fcm_tokens/{token} para permitir múltiplos dispositivos
    await setDoc(doc(db, "config", uid, "fcm_tokens", token), {
      token,
      uid,
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent.slice(0, 100),
    });
    console.log('[FCM] Token registrado:', token.slice(0, 20) + '...');
  } catch (e) {
    console.warn('[FCM] Falha ao registrar token:', e.message);
  }
}

// Carregar emails permitidos do Firestore
export async function loadAllowedEmails() {
  const snap = await getDoc(doc(db, "config", "allowed_emails"));
  if (snap.exists()) return snap.data().emails || [];
  // Inicializar com admin se não existir
  const initial = [ADMIN_EMAIL];
  await setDoc(doc(db, "config", "allowed_emails"), { emails: initial });
  return initial;
}

export async function saveAllowedEmails(emails) {
  await setDoc(doc(db, "config", "allowed_emails"), { emails });
}
