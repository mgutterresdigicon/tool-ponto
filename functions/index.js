// functions/index.js
// Cloud Function agendada: verifica notificações pendentes e envia via FCM
//
// Executa a cada minuto via Cloud Scheduler.
// Para cada usuário com FCM token ativo, lê as configurações de notificação
// e os horários registrados no dia, calcula se alguma regra deve disparar
// e envia o push via FCM Admin SDK.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp }  = require('firebase-admin/app');
const { getFirestore }   = require('firebase-admin/firestore');
const { getMessaging }   = require('firebase-admin/messaging');

initializeApp();

const db        = getFirestore();
const messaging = getMessaging();

// ── Helpers ──────────────────────────────────────────────────

function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function fmt(min) {
  if (min == null) return '--:--';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function timeToMin(str) {
  if (!str || !str.includes(':')) return null;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// Verifica se now está dentro da janela de disparo [target, target+2]
// Retorna hora atual em minutos desde meia-noite
function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

// nowMs: timestamp real da execução em ms desde meia-noite
// Usado para comparar com precisão de segundos
function nowMs() {
  const n = new Date();
  return (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) * 1000;
}

// targetMin em minutos → ms desde meia-noite (assumindo segundo :00)
function targetToMs(targetMin) {
  return targetMin * 60 * 1000;
}

// Janela de ±90s centrada no alvo:
//  - Cobre atraso do scheduler (até ~60s)
//  - Evita disparar cedo demais (não antes de target - 30s)
//  - Evita reprocessar na próxima execução (fired set garante deduplicação)
function inWindow(nowM, target) {
  const diffMs = nowMs() - targetToMs(target);
  return diffMs >= -30000 && diffMs <= 90000;
}

// Envia push FCM para um token
async function sendPush(token, title, body, tag) {
  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: { tag },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    console.log(`✅ Push enviado: "${title}" → ${token.slice(0, 20)}...`);
  } catch (err) {
    // Token inválido/expirado — remover do Firestore
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      console.warn(`⚠️ Token inválido, removendo: ${token.slice(0, 20)}...`);
      throw { invalidToken: true };
    }
    console.error(`❌ Erro ao enviar push:`, err.message);
  }
}

// ── Regras (mesmo cálculo do notifications.js do frontend) ───

function checkIntervalReturn(times, cfg, now, fired) {
  if (!cfg.interval_return_enabled) return [];
  const { s1 } = times;
  if (s1 == null) return [];

  const target = s1 + (cfg.interval_return_time ?? 60);
  const before = cfg.interval_return_safe_before ?? 5;
  const results = [];

  if (!fired.has('interval_return_before') && inWindow(now, target - before)) {
    results.push({ key: 'interval_return_before', title: '⏰ Intervalo terminando', body: `Seu intervalo termina em ${before} min (às ${fmt(target)}).` });
  }
  if (!fired.has('interval_return_exact') && inWindow(now, target)) {
    results.push({ key: 'interval_return_exact', title: '🔔 Fim do Intervalo', body: `Retorne ao trabalho às ${fmt(target)}.` });
  }
  return results;
}

function checkDailyLoad(times, cfg, now, fired) {
  if (!cfg.daily_load_enabled) return [];
  const { e1 } = times;
  if (e1 == null) return [];

  const target = e1 + (cfg.daily_load_time ?? 528);
  const before = cfg.daily_load_safe_before ?? 5;
  const results = [];

  if (!fired.has('daily_load_before') && inWindow(now, target - before)) {
    results.push({ key: 'daily_load_before', title: '⏰ Carga diária quase completa', body: `Faltam ${before} min para completar sua carga (às ${fmt(target)}).` });
  }
  if (!fired.has('daily_load_exact') && inWindow(now, target)) {
    results.push({ key: 'daily_load_exact', title: '✅ Carga Diária Completa', body: `Você completou ${fmt(cfg.daily_load_time ?? 528)} de trabalho hoje.` });
  }
  return results;
}

function checkShiftMax(times, cfg, now, fired) {
  if (!cfg.shift_max_enabled) return [];
  const max    = cfg.shift_max_time ?? 360;
  const before = cfg.shift_max_safe_before ?? 10;
  const results = [];

  const entries = [
    { key: 'T1', entry: times.e1, exit: times.s1 },
    { key: 'T2', entry: times.e2, exit: times.s2 },
    { key: 'T3', entry: times.e3, exit: times.s3 },
  ];

  for (const { key, entry, exit } of entries) {
    if (entry == null || exit != null) continue;
    const target = entry + max;
    if (!fired.has(`shift_max_${key}_before`) && inWindow(now, target - before)) {
      results.push({ key: `shift_max_${key}_before`, title: `⏰ Turno máximo próximo (${key})`, body: `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).` });
    }
    if (!fired.has(`shift_max_${key}_exact`) && inWindow(now, target)) {
      results.push({ key: `shift_max_${key}_exact`, title: `⚠️ Turno Máximo Atingido (${key})`, body: `Você está há ${fmt(max)} no ${key}. Considere registrar a saída.` });
    }
  }
  return results;
}

function checkWorkdayMax(times, cfg, now, fired) {
  if (!cfg.workday_max_enabled) return [];
  const { e1 } = times;
  if (e1 == null) return [];

  const max    = cfg.workday_max_time ?? 600;
  const target = e1 + max;
  const before = cfg.workday_max_safe_before ?? 10;
  const results = [];

  if (!fired.has('workday_max_before') && inWindow(now, target - before)) {
    results.push({ key: 'workday_max_before', title: '⏰ Jornada máxima próxima', body: `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).` });
  }
  if (!fired.has('workday_max_exact') && inWindow(now, target)) {
    results.push({ key: 'workday_max_exact', title: '🚨 Jornada Máxima Atingida', body: `Você está trabalhando há ${fmt(max)} hoje.` });
  }
  return results;
}

// ── Cloud Function principal ─────────────────────────────────

exports.checkNotifications = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'America/Sao_Paulo',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async () => {
  const now     = nowMin();
  const today   = new Date();
  const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  console.log(`🔔 checkNotifications — ${fmt(now)} (${dateKey})`);

  // Buscar todos os usuários com FCM token ativo
  const tokensSnap = await db.collectionGroup('fcm_tokens').get();
  if (tokensSnap.empty) {
    console.log('⚠️ Nenhum token FCM registrado no Firestore (config/{uid}/fcm_tokens/).');
    return;
  }

  console.log(`📱 Tokens encontrados: ${tokensSnap.size}`);

  const promises = tokensSnap.docs.map(async tokenDoc => {
    const { token, uid } = tokenDoc.data();
    if (!token || !uid) return;
    console.log(`👤 Processando uid=${uid.slice(0,8)}... token=${token.slice(0,15)}...`);

    try {
      // Carregar configurações de notificação do usuário
      const cfgSnap = await db.doc(`config/${uid}/data/ponto_notification_settings`).get();
      if (!cfgSnap.exists) {
        console.log(`  ⚠️ Sem configurações de notificação para uid=${uid.slice(0,8)}`);
        return;
      }
      const cfg = cfgSnap.data();

      // Carregar horários registrados hoje
      const periodoKey = `${today.getFullYear()}_${String(today.getMonth() + 1).padStart(2, '0')}`;
      const periodoSnap = await db.doc(`pontos/${uid}/periodos/${periodoKey}`).get();
      if (!periodoSnap.exists) {
        console.log(`  ⚠️ Sem período ${periodoKey} para uid=${uid.slice(0,8)}`);
        return;
      }

      // Parsear a linha do dia atual do JSON salvo
      const rows = JSON.parse(periodoSnap.data().data || '[]');
      const todayDay = String(today.getDate());
      const row = rows.find(r => r[0] === todayDay);
      if (!row) {
        console.log(`  ⚠️ Sem linha do dia ${todayDay} para uid=${uid.slice(0,8)}`);
        return;
      }

      const times = {
        e1: timeToMin(row[4]), s1: timeToMin(row[5]),
        e2: timeToMin(row[6]), s2: timeToMin(row[7]),
        e3: timeToMin(row[8]), s3: timeToMin(row[9]),
      };
      console.log(`  ⏱ times: e1=${times.e1} s1=${times.s1} e2=${times.e2} s2=${times.s2}`);

      // Carregar notificações já disparadas hoje (deduplicação)
      const firedSnap = await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).get();
      const fired = new Set(firedSnap.exists ? (firedSnap.data().keys || []) : []);

      // Verificar cada regra
      const toFire = [
        ...checkIntervalReturn(times, cfg, now, fired),
        ...checkDailyLoad(times, cfg, now, fired),
        ...checkShiftMax(times, cfg, now, fired),
        ...checkWorkdayMax(times, cfg, now, fired),
      ];

      if (toFire.length === 0) {
        console.log(`  ✓ Nada a disparar para uid=${uid.slice(0,8)} agora (${fmt(now)})`);
        return;
      }
      console.log(`  🚀 Disparando ${toFire.length} notificação(ões) para uid=${uid.slice(0,8)}:`, toFire.map(f => f.key));

      // Enviar pushes e registrar como disparados
      const newFired = [];
      for (const { key, title, body } of toFire) {
        try {
          await sendPush(token, title, body, key);
          newFired.push(key);
        } catch (e) {
          if (e.invalidToken) {
            // Remover token inválido do Firestore
            await tokenDoc.ref.delete();
            return;
          }
        }
      }

      // Persistir deduplicação no Firestore (TTL implícito: novo doc a cada dia)
      if (newFired.length > 0) {
        await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).set({
          keys: [...fired, ...newFired],
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

    } catch (err) {
      console.error(`Erro ao processar uid ${uid}:`, err.message);
    }
  });

  await Promise.all(promises);
  console.log('✅ checkNotifications concluído.');
});
