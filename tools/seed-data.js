// ============================================================
// seed-data.js — Carrega um backup do Firestore no emulador local
//
// Estrutura do tool-ponto no Firestore:
//
//   config/allowed_emails           — lista de e-mails permitidos
//     { emails: [...] }
//
//   pontos/{uid}/periodos/{docId}   — registros de ponto por usuário
//     { periodo, dias: {...}, ... }
//
//   config/{uid}/data/{docId}       — configuração por usuário (opcional)
//
//   solicitacoes/{email}            — solicitações de acesso (opcional)
//
// Uso:
//   FIREBASE_PROJECT_ID=tool-ponto node ./tools/seed-data.js [arquivo-backup.json]
//
// O arquivo de backup deve ser gerado pelo comando:
//   node tools/full-tool.js backup
// ============================================================

process.env.GCLOUD_PROJECT          = process.env.FIREBASE_PROJECT_ID || 'tool-ponto';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore }  = require('firebase-admin/firestore');
const fs   = require('fs');
const path = require('path');

const projectId = process.env.GCLOUD_PROJECT;
initializeApp({ projectId });
const db = getFirestore();

// ── Arquivo de entrada ───────────────────────────────────────
// Tenta encontrar o backup mais recente na pasta tools/ se não for informado
function findLatestBackup() {
  const toolsDir = __dirname;
  const files = fs.readdirSync(toolsDir)
    .filter(f => f.startsWith('backup-firestore-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return path.join(toolsDir, files[0]);
}

const inputFile = process.argv[2] || findLatestBackup();

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('❌ Arquivo de backup não encontrado.');
  console.error('   Gere um backup primeiro:');
  console.error('     node tools/full-tool.js backup');
  console.error('   Ou passe o arquivo como argumento:');
  console.error('     FIREBASE_PROJECT_ID=tool-ponto node ./tools/seed-data.js backup-firestore-YYYY-MM-DDTHH-MM-SS.json');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────

async function writeDocument(docRef, data) {
  if (!data || typeof data !== 'object') return;

  // Remove campos de metadados internos do backup, mantém apenas os campos reais
  const { _subcollections, _id, _fullPath, _backupError, ...fields } = data;

  if (Object.keys(fields).length > 0) {
    await docRef.set(fields, { merge: true });
    console.log(`  ✅ ${docRef.path}`);
  }

  // Processa subcoleções recursivamente
  if (_subcollections && typeof _subcollections === 'object') {
    for (const [subColName, subColDocs] of Object.entries(_subcollections)) {
      if (typeof subColDocs !== 'object' || subColDocs === null) continue;
      for (const [docId, docData] of Object.entries(subColDocs)) {
        const subRef = docRef.collection(subColName).doc(docId);
        await writeDocument(subRef, docData);
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`📖 Lendo: ${inputFile}`);
  const raw  = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  // Suporta tanto { data: {...} } (formato full-tool.js) quanto coleções direto na raiz
  const root = raw.data ?? raw;

  const collections = Object.keys(root).filter(k => k !== 'metadata');

  if (collections.length === 0) {
    console.error('❌ Backup vazio ou formato inválido. Verifique se o arquivo foi gerado corretamente.');
    console.error('   Execute: node tools/full-tool.js backup');
    process.exit(1);
  }

  console.log(`\n🚀 Iniciando seed no emulador (projeto: ${projectId})...`);
  console.log(`   Coleções encontradas: ${collections.join(', ')}\n`);

  for (const collectionName of collections) {
    const collectionData = root[collectionName];
    if (typeof collectionData !== 'object' || collectionData === null) continue;

    console.log(`\n📂 Coleção: ${collectionName}`);

    for (const [docId, docData] of Object.entries(collectionData)) {
      const docRef = db.collection(collectionName).doc(docId);
      await writeDocument(docRef, docData);
    }
  }

  console.log('\n🎉 Seed concluído com sucesso!');
  console.log('💡 Acesse http://localhost:4000/firestore para verificar os dados.');
  console.log('\n📌 Para iniciar o emulador:');
  console.log('   firebase emulators:start');
  console.log('\n📌 Para acessar o app local:');
  console.log('   http://localhost:5000');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
