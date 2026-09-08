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

// Retorna Date no fuso de Brasília (UTC-3)
// A Cloud Function roda em UTC — sem isso os cálculos de horário ficam errados.
function nowBRT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

// Minutos desde meia-noite em BRT
function nowMin(brt) {
  return brt.getHours() * 60 + brt.getMinutes();
}

// Milissegundos desde meia-noite em BRT (inclui segundos para precisão)
function nowMs(brt) {
  return (brt.getHours() * 3600 + brt.getMinutes() * 60 + brt.getSeconds()) * 1000;
}

// targetMin (inteiro de minutos) → ms desde meia-noite
function targetToMs(targetMin) {
  return targetMin * 60 * 1000;
}

// Janela de disparo: de -30s antes até +90s depois do alvo
// Cobre atraso típico do Cloud Scheduler (0-60s)
function inWindow(currentMs, target) {
  const diffMs = currentMs - targetToMs(target);
  return diffMs >= -30000 && diffMs <= 90000;
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
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      console.warn(`⚠️ Token inválido: ${token.slice(0, 20)}...`);
      throw { invalidToken: true };
    }
    console.error(`❌ Erro ao enviar push:`, err.message);
  }
}

// ── Regras ───────────────────────────────────────────────────
// currentMs: ms desde meia-noite BRT, capturado uma vez no início da execução

function checkIntervalReturn(times, cfg, currentMs, fired) {
  if (!cfg.interval_return_enabled) return [];
  if (times.s1 == null) return [];
  const target = times.s1 + (cfg.interval_return_time ?? 60);
  const before = cfg.interval_return_safe_before ?? 5;
  const results = [];
  if (!fired.has('interval_return_before') && inWindow(currentMs, target - before))
    results.push({ key: 'interval_return_before', title: '⏰ Intervalo terminando', body: `Seu intervalo termina em ${before} min (às ${fmt(target)}).` });
  if (!fired.has('interval_return_exact') && inWindow(currentMs, target))
    results.push({ key: 'interval_return_exact', title: '🔔 Fim do Intervalo', body: `Retorne ao trabalho às ${fmt(target)}.` });
  return results;
}

function checkDailyLoad(times, cfg, currentMs, fired) {
  if (!cfg.daily_load_enabled) return [];
  if (times.e1 == null) return [];
  const target = times.e1 + (cfg.daily_load_time ?? 528);
  const before = cfg.daily_load_safe_before ?? 5;
  const results = [];
  if (!fired.has('daily_load_before') && inWindow(currentMs, target - before))
    results.push({ key: 'daily_load_before', title: '⏰ Carga diária quase completa', body: `Faltam ${before} min para completar sua carga (às ${fmt(target)}).` });
  if (!fired.has('daily_load_exact') && inWindow(currentMs, target))
    results.push({ key: 'daily_load_exact', title: '✅ Carga Diária Completa', body: `Você completou ${fmt(cfg.daily_load_time ?? 528)} de trabalho hoje.` });
  return results;
}

function checkShiftMax(times, cfg, currentMs, fired) {
  if (!cfg.shift_max_enabled) return [];
  const max    = cfg.shift_max_time ?? 360;
  const before = cfg.shift_max_safe_before ?? 10;
  const results = [];
  for (const { key, entry, exit } of [
    { key: 'T1', entry: times.e1, exit: times.s1 },
    { key: 'T2', entry: times.e2, exit: times.s2 },
    { key: 'T3', entry: times.e3, exit: times.s3 },
  ]) {
    if (entry == null || exit != null) continue;
    const target = entry + max;
    if (!fired.has(`shift_max_${key}_before`) && inWindow(currentMs, target - before))
      results.push({ key: `shift_max_${key}_before`, title: `⏰ Turno máximo próximo (${key})`, body: `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).` });
    if (!fired.has(`shift_max_${key}_exact`) && inWindow(currentMs, target))
      results.push({ key: `shift_max_${key}_exact`, title: `⚠️ Turno Máximo Atingido (${key})`, body: `Você está há ${fmt(max)} no ${key}. Considere registrar a saída.` });
  }
  return results;
}

function checkWorkdayMax(times, cfg, currentMs, fired) {
  if (!cfg.workday_max_enabled) return [];
  if (times.e1 == null) return [];
  const max    = cfg.workday_max_time ?? 600;
  const target = times.e1 + max;
  const before = cfg.workday_max_safe_before ?? 10;
  const results = [];
  if (!fired.has('workday_max_before') && inWindow(currentMs, target - before))
    results.push({ key: 'workday_max_before', title: '⏰ Jornada máxima próxima', body: `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).` });
  if (!fired.has('workday_max_exact') && inWindow(currentMs, target))
    results.push({ key: 'workday_max_exact', title: '🚨 Jornada Máxima Atingida', body: `Você está trabalhando há ${fmt(max)} hoje.` });
  return results;
}

// ── Cloud Function principal ─────────────────────────────────

exports.checkNotifications = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'America/Sao_Paulo',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async () => {
  // Captura o momento BRT uma única vez para toda a execução
  const brt       = nowBRT();
  const currentMs = nowMs(brt);
  const now       = nowMin(brt);
  const dateKey   = `${brt.getFullYear()}${String(brt.getMonth() + 1).padStart(2, '0')}${String(brt.getDate()).padStart(2, '0')}`;

  console.log(`🔔 checkNotifications — ${fmt(now)} (${dateKey}) currentMs=${currentMs}`);

  const tokensSnap = await db.collectionGroup('fcm_tokens').get();
  if (tokensSnap.empty) {
    console.log('⚠️ Nenhum token FCM registrado.');
    return;
  }
  console.log(`📱 Tokens encontrados: ${tokensSnap.size}`);

  // Agrupar tokens por uid para processar um uid de cada vez
  // Evita disparar múltiplas notificações para o mesmo usuário
  const tokensByUid = new Map();
  for (const tokenDoc of tokensSnap.docs) {
    const { token, uid } = tokenDoc.data();
    if (!token || !uid) continue;
    if (!tokensByUid.has(uid)) tokensByUid.set(uid, []);
    tokensByUid.get(uid).push({ token, tokenDoc });
  }

  console.log(`👥 Usuários únicos: ${tokensByUid.size}`);

  const promises = [...tokensByUid.entries()].map(async ([uid, tokens]) => {

    try {
      const cfgSnap = await db.doc(`config/${uid}/data/ponto_notification_settings`).get();
      if (!cfgSnap.exists) return;
      const cfg = cfgSnap.data();

      // Calcular qual período contém hoje
      const diaAtual   = brt.getDate();
      const mesAtual   = brt.getMonth() + 1;
      const settingsSnap = await db.doc(`config/${uid}/data/ponto_settings`).get();
      const periodos   = settingsSnap.exists ? (settingsSnap.data().periodos || {}) : {};
      const mesStr     = String(mesAtual).padStart(2, '0');
      const diaIni     = (periodos[mesStr] || {}).ini ?? 16;
      const periodoMes = diaAtual >= diaIni
        ? mesStr
        : String(mesAtual === 1 ? 12 : mesAtual - 1).padStart(2, '0');
      const periodoAno = (periodoMes === '12' && mesAtual === 1)
        ? brt.getFullYear() - 1
        : brt.getFullYear();
      const periodoKey = `${periodoAno}_${periodoMes}`;

      const periodoSnap = await db.doc(`pontos/${uid}/periodos/${periodoKey}`).get();
      if (!periodoSnap.exists) {
        console.log(`  ⚠️ Sem período ${periodoKey} para uid=${uid.slice(0,8)}`);
        return;
      }

      const rows     = JSON.parse(periodoSnap.data().data || '[]');
      const todayDay = String(brt.getDate());
      const row      = rows.find(r => r[0] === todayDay);
      if (!row) return;

      const times = {
        e1: timeToMin(row[4]), s1: timeToMin(row[5]),
        e2: timeToMin(row[6]), s2: timeToMin(row[7]),
        e3: timeToMin(row[8]), s3: timeToMin(row[9]),
      };

      const firedSnap = await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).get();
      const firedData = firedSnap.exists ? firedSnap.data() : {};
      const firedKeys = firedData.keys || [];

      // Se a saída registrada mudou desde o último disparo, limpa o fired
      // para não bloquear notificações com horários novos
      const lastS1 = firedData.lastS1 ?? null;
      const currentS1 = times.s1;
      const fired = (lastS1 !== null && lastS1 !== currentS1)
        ? new Set()   // saída mudou → reinicia deduplicação
        : new Set(firedKeys);

      // Log de diagnóstico
      if (times.s1 != null && cfg.interval_return_enabled) {
        const t = times.s1 + (cfg.interval_return_time ?? 60);
        const b = cfg.interval_return_safe_before ?? 5;
        const diffBefore = currentMs - targetToMs(t - b);
        const diffExact  = currentMs - targetToMs(t);
        console.log(`  🎯 uid=${uid.slice(0,8)} s1=${times.s1} target=${t} triggerBefore=${t-b} now=${now} currentMs=${currentMs}`);
        console.log(`     diffBefore=${diffBefore} inWindowBefore=${inWindow(currentMs, t-b)}`);
        console.log(`     diffExact=${diffExact}  inWindowExact=${inWindow(currentMs, t)}`);
        console.log(`     fired=${JSON.stringify([...fired])}`);
      }

      const toFire = [
        ...checkIntervalReturn(times, cfg, currentMs, fired),
        ...checkDailyLoad(times, cfg, currentMs, fired),
        ...checkShiftMax(times, cfg, currentMs, fired),
        ...checkWorkdayMax(times, cfg, currentMs, fired),
      ];

      if (toFire.length === 0) return;
      console.log(`  🚀 Disparando ${toFire.length} notificação(ões) para uid=${uid.slice(0,8)}:`, toFire.map(f => f.key));

      const newFired = [];
      for (const { key, title, body } of toFire) {
        // Envia para todos os tokens do usuário, remove os inválidos
        let sent = false;
        for (const { token, tokenDoc } of tokens) {
          try {
            await sendPush(token, title, body, key);
            sent = true;
            break; // Enviou com sucesso — não precisa tentar os demais
          } catch (e) {
            if (e.invalidToken) {
              await tokenDoc.ref.delete();
              console.log(`  🗑️ Token inválido removido: ${token.slice(0,15)}...`);
            }
          }
        }
        if (sent) newFired.push(key);
      }

      if (newFired.length > 0) {
        await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).set({
          keys:      [...fired, ...newFired],
          lastS1:    times.s1 ?? null,
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
