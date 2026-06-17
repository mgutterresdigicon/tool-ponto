import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Admin é o primeiro email da lista (pode gerenciar usuários)
export const ADMIN_EMAIL = "mgutterres.digicon@gmail.com";

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
