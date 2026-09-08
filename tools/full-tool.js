const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Impressão da ajuda de uso
function printHelp() {
  console.log('📌 Uso: node full-tool.js [comando] [opções]');
  console.log('\nComandos disponíveis:');
  console.log('  backup   [caminho-service-account]');
  console.log('           Gera um backup completo em JSON do Firestore atual.\n');
  console.log('  convert  <arquivo-backup.json> [arquivo-saida.json]');
  console.log('           Converte a estrutura antiga (config/times) para a nova estrutura (system_admins, users, teams).\n');
  console.log('  upload   <arquivo-convertido.json> [caminho-service-account]');
  console.log('           Envia os dados convertidos para o banco Firestore.\n');
  console.log('  restore  <arquivo-backup.json> [caminho-service-account]');
  console.log('           Restaura o backup no formato original (Cuidado: limpa o banco primeiro).\n');
  console.log('Exemplos:');
  console.log('  node tools/full-tool.js backup');
  console.log('  node tools/full-tool.js convert backup-firestore-2026-07-31T01-42-11.984Z.json');
  console.log('  node tools/full-tool.js upload converted-backup-firestore-2026-07-31T01-42-11.984Z.json');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  printHelp();
  process.exit(1);
}

const command = args[0].toLowerCase();
const defaultServiceAccount = path.resolve(__dirname, './tool-ponto-firebase-adminsdk-fbsvc-d5863fa3bf.json');

// Função auxiliar para inicializar Firebase Admin
function initFirebase(saPath) {
  const resolvedPath = path.resolve(saPath || defaultServiceAccount);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Arquivo de Service Account não encontrado: ${resolvedPath}`);
    process.exit(1);
  }
  const serviceAccount = require(resolvedPath);
  initializeApp({ credential: cert(serviceAccount) });
  return getFirestore();
}

// ----------------------------------------------------
// 1. BACKUP (Recursivo)
// ----------------------------------------------------
async function backupCollection(collectionRef, parentPath = '') {
  const data = {};

  // listDocuments() retorna TODOS os documentos, incluindo os implícitos
  // (documentos que existem apenas como pai de subcoleções, sem campos próprios).
  // get() só retorna documentos escritos explicitamente — por isso pontos/{uid} ficava vazio.
  const docRefs = await collectionRef.listDocuments();

  for (const docRef of docRefs) {
    const docFullPath = parentPath ? `${parentPath}/${docRef.id}` : docRef.id;

    // Buscar os campos do documento (pode estar vazio se for implícito)
    const docSnap = await docRef.get();
    const docData = docSnap.exists ? { ...docSnap.data() } : {};
    docData._id = docRef.id;
    docData._fullPath = docFullPath;

    try {
      // Recursively backup sub-collections at any depth, preserving path context
      const subCollections = await docRef.listCollections();
      if (subCollections.length > 0) {
        docData._subcollections = {};
        for (const subCol of subCollections) {
          console.log(`   📂 Backup subcoleção: ${subCol.id} (Doc: ${docRef.id})`);
          docData._subcollections[subCol.id] = await backupCollection(subCol, docFullPath);
        }
      }
    } catch (err) {
      console.error(`   ⚠️ Erro ao processar subcoleções do documento ${docRef.id}: ${err.message}`);
      docData._subcollections = {};
      docData._backupError = err.message;
    }

    data[docRef.id] = docData;
  }
  return data;
}

async function exportData(serviceAccountPath) {
  const db = initFirebase(serviceAccountPath);
  console.log('🔄 Iniciando backup completo do Firestore...');

  // Timeout per collection (30 min) — prevents a single stuck collection from blocking the whole process
  const COLLECTION_TIMEOUT_MS = 30 * 60 * 1000;

  try {
    const collections = await db.listCollections();
    const backup = {};
    let timedOutCount = 0;

    for (const collection of collections) {
      console.log(`📦 Backup coleção raiz: ${collection.id}`);

      // Per-collection timeout — if a single collection is stuck, log it and continue with others
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Timeout ao processar coleção: ${collection.id} (máx. 30 min)`)),
          COLLECTION_TIMEOUT_MS
        );
      });

      try {
        // BUG FIX: atribuir o resultado ao objeto backup usando o id da coleção como chave
        backup[collection.id] = await Promise.race([
          backupCollection(collection, collection.id),
          timeoutPromise
        ]);
      } catch (timeoutErr) {
        timedOutCount++;
        console.error(`   ⚠️ Coleção "${collection.id}" travou após 30 minutos — continuando com o resto do backup.`);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    if (timedOutCount > 0) {
      console.warn(`⚠️ ${timedOutCount} coleção(ões) não foram salvas por timeout.`);
    }

    const backupWithMetadata = {
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        description: 'Backup completo do Firebase Firestore',
      },
      data: backup,
    };

    const outputFilename = `backup-firestore-${new Date().toISOString().replace(/:/g, '-')}.json`;
    fs.writeFileSync(outputFilename, JSON.stringify(backupWithMetadata, null, 2));

    console.log(`✅ Backup concluído com sucesso em ${outputFilename}!`);
    console.log(`📁 Tamanho: ${fs.statSync(outputFilename).size} bytes`);
  } catch (error) {
    console.error('❌ Erro durante o backup:', error);
    process.exit(1);
  }
}

// ----------------------------------------------------
// 2. CONVERT (Antigo -> Novo Schema UID-based)
// ----------------------------------------------------
function convertToNewFormat(backupData) {
  const sourceData = backupData.data || {};
  const convertedData = {
    metadata: {
      timestamp: new Date().toISOString(),
      version: '2.0-multitenant',
      description: 'Estrutura otimizada baseada em UID (system_admins, users, teams)',
      sourceTimestamp: backupData.metadata ? backupData.metadata.timestamp : null
    },
    data: {
      system_admins: {},
      users: {},
      teams: {}
    }
  };

  const adminEmails = (sourceData.config && sourceData.config.system_admins && sourceData.config.system_admins.emails) || [];
  const userMap = {};

  // Processar user_roles do config antigo
  if (sourceData.config && sourceData.config.user_roles && sourceData.config.user_roles.roles) {
    Object.entries(sourceData.config.user_roles.roles).forEach(([email, role]) => {
      if (!userMap[email]) userMap[email] = { email, globalRole: role, teams: [] };
    });
  }

  // Processar allowed_emails do config antigo
  if (sourceData.config && sourceData.config.allowed_emails && sourceData.config.allowed_emails.emails) {
    sourceData.config.allowed_emails.emails.forEach(email => {
      if (!userMap[email]) userMap[email] = { email, globalRole: 'visualizador', teams: [] };
    });
  }

  // Processar times
  if (sourceData.times) {
    Object.entries(sourceData.times).forEach(([teamId, teamObj]) => {
      const subcols = teamObj._subcollections || {};
      const infoDados = (subcols.info && subcols.info.dados) ? { ...subcols.info.dados } : {};
      delete infoDados._id;

      // Raiz do documento do time
      const teamDoc = {
        nome: infoDados.nome || teamObj.Nome || teamId,
        apelido: infoDados.apelido || '',
        fundacao: infoDados.fundacao || null,
        cor: infoDados.cor || '#000000',
        formacaoPadrao: infoDados.formacaoPadrao || '4-3-3',
        duracaoPartida: infoDados.duracaoPartida || 90,
        horarioPadrao: infoDados.horarioPadrao || '14:00',
        localPadrao: infoDados.localPadrao || 'casa',
        localNome: infoDados.localNome || '',
        localEndereco: infoDados.localEndereco || '',
        localUrl: infoDados.localUrl || '',
        rankingLimit: infoDados.rankingLimit || 30,
        temporada: infoDados.temporada || '2026',
        descricao: infoDados.descricao || '',
        criadoEm: new Date().toISOString(),
        _subcollections: {}
      };

      // Processar subcoleções do time
      Object.entries(subcols).forEach(([subName, subDocs]) => {
        if (subName === 'info') return; // Incorporado na raiz do time

        teamDoc._subcollections[subName] = {};

        if (subName === 'membros') {
          Object.entries(subDocs).forEach(([memberKey, memberData]) => {
            const email = memberData.email || memberKey;
            if (!userMap[email]) userMap[email] = { email, globalRole: 'visualizador', teams: [] };
            if (!userMap[email].teams.includes(teamId)) userMap[email].teams.push(teamId);

            const userUid = 'UID_' + email.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const cleanMember = { ...memberData };
            delete cleanMember._id;

            teamDoc._subcollections[subName][userUid] = {
              uid: userUid,
              email: email,
              role: cleanMember.role || 'visualizador',
              criadoEm: cleanMember.criadoEm || new Date().toISOString(),
              ativo: true
            };
          });
        } else {
          // Manter coleções de jogadores, jogos, stats
          Object.entries(subDocs).forEach(([docId, docVal]) => {
            const cleanDoc = { ...docVal };
            delete cleanDoc._id;
            teamDoc._subcollections[subName][docId] = cleanDoc;
          });
        }
      });

      convertedData.data.teams[teamId] = teamDoc;
    });
  }

  // Construir coleções system_admins e users
  Object.keys(userMap).forEach(email => {
    const userUid = 'UID_' + email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const isSysAdmin = adminEmails.includes(email);

    if (isSysAdmin) {
      convertedData.data.system_admins[userUid] = {
        uid: userUid,
        email: email,
        grantedAt: new Date().toISOString(),
        grantedBy: 'system_migration'
      };
    }

    convertedData.data.users[userUid] = {
      uid: userUid,
      email: email,
      nome: email.split('@')[0],
      fotoUrl: null,
      teams: userMap[email].teams,
      defaultTeamId: userMap[email].teams[0] || null,
      isSystemAdmin: isSysAdmin,
      criadoEm: new Date().toISOString(),
      ativo: true
    };
  });

  return convertedData;
}

// ----------------------------------------------------
// 3. UPLOAD / RESTORE (Upload Recursivo para Firestore)
// ----------------------------------------------------
async function uploadRecursive(db, pathRef, dataObj) {
  for (const [docId, docValue] of Object.entries(dataObj)) {
    const docRef = pathRef.doc(docId);
    const { _subcollections, ...fields } = docValue;

    // Salvar o documento no Firestore
    await docRef.set(fields, { merge: true });
    console.log(`  ✅ ${docRef.path}`);

    // Processar subcoleções se houver
    if (_subcollections && typeof _subcollections === 'object') {
      for (const [subName, subDocs] of Object.entries(_subcollections)) {
        const subColRef = docRef.collection(subName);
        await uploadRecursive(db, subColRef, subDocs);
      }
    }
  }
}

async function uploadData(jsonFilePath, saPath) {
  const db = initFirebase(saPath);
  console.log(`🚀 Iniciando upload dos dados do arquivo ${jsonFilePath}...`);

  try {
    const rawContent = fs.readFileSync(jsonFilePath, 'utf8');
    const fileData = JSON.parse(rawContent);
    const rootData = fileData.data || fileData;

    for (const [colName, colData] of Object.entries(rootData)) {
      if (typeof colData !== 'object' || colData === null) continue;
      console.log(`\n📦 Processando Coleção Root: ${colName}`);
      const collectionRef = db.collection(colName);
      await uploadRecursive(db, collectionRef, colData);
    }

    console.log('\n🎉 Upload finalizado com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante o upload:', error);
    process.exit(1);
  }
}

// ----------------------------------------------------
// MAIN SWITCH
// ----------------------------------------------------
async function main() {
  switch (command) {
    case 'backup': {
      const saPath = args[1];
      await exportData(saPath);
      break;
    }

    case 'convert': {
      const convertFile = args[1];
      if (!convertFile) {
        console.error('❌ Especifique o arquivo de backup a ser convertido.');
        console.log('Exemplo: node tools/20260730_fullTool.js convert backup-firestore-2026-07-31T01-42-11.984Z.json');
        process.exit(1);
      }
      const outputFile = args[2] || `converted-${path.basename(convertFile)}`;
      console.log(`🔄 Convertendo ${convertFile} -> ${outputFile}...`);

      const rawBackup = JSON.parse(fs.readFileSync(convertFile, 'utf8'));
      const converted = convertToNewFormat(rawBackup);
      fs.writeFileSync(outputFile, JSON.stringify(converted, null, 2));

      console.log(`✅ Conversão concluída com sucesso! Gerado: ${outputFile}`);
      console.log(`📁 Tamanho do arquivo convertido: ${fs.statSync(outputFile).size} bytes`);
      break;
    }

    case 'upload': {
      const fileToUpload = args[1];
      const saPath = args[2];
      if (!fileToUpload) {
        console.error('❌ Especifique o arquivo JSON para realizar upload.');
        console.log('Exemplo: node tools/20260730_fullTool.js upload converted-backup-firestore-2026-07-31T01-42-11.984Z.json');
        process.exit(1);
      }
      await uploadData(fileToUpload, saPath);
      break;
    }

    case 'restore': {
      const fileToRestore = args[1];
      const saPath = args[2];
      if (!fileToRestore) {
        console.error('❌ Especifique o arquivo de backup para restauração.');
        process.exit(1);
      }
      console.log('⚠️ Restauração nativa solicitada.');
      await uploadData(fileToRestore, saPath);
      break;
    }

    default:
      console.error(`❌ Comando desconhecido: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main();