// functions/index.js
// Cloud Function agendada: verifica notificações pendentes e envia via FCM
//
// Regras (espelho de notifications.js no frontend):
//  1. interval_return  — s1 (ou s2 com T3) + duration
//  2. daily_load       — Saída Normal (e1+carga+intervalo) — gatilho: e2 ou e3 com T3
//  3. shift_max        — e1 ou e2 + max_turno (6h)
//  4. workday_max      — Saída Extra (e1+600+intervalo)
//  5. min_interval     — última saída do dia (s1/s2/s3) + mín_intervalo
//
// before=0: dispara apenas o aviso exato, sem antecipado.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp }  = require('firebase-admin/app');
const { getFirestore }   = require('firebase-admin/firestore');
const { getMessaging }   = require('firebase-admin/messaging');

initializeApp();

const db        = getFirestore();
const messaging = getMessaging();

// ── Helpers ──────────────────────────────────────────────────

// Retorna Date no fuso de Brasília
function nowBRT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function nowMin(brt)  { return brt.getHours() * 60 + brt.getMinutes(); }
function nowMs(brt)   { return (brt.getHours() * 3600 + brt.getMinutes() * 60 + brt.getSeconds()) * 1000; }
function targetToMs(m){ return m * 60 * 1000; }

// Janela de disparo: -30s a +60s do alvo (cobre atraso do scheduler)
function inWindow(currentMs, target) {
  const d = currentMs - targetToMs(target);
  return d >= -30000 && d <= 60000;
}

function fmt(min) {
  if (min == null) return '--:--';
  return String(Math.floor(Math.abs(min) / 60)).padStart(2,'0') + ':' + String(Math.abs(min) % 60).padStart(2,'0');
}

function timeToMin(str) {
  if (!str || !str.includes(':')) return null;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// Calcula Saída Normal: e1 + carga + intervalo(s) — espelho do calcRow do frontend
function calcNormal(t) {
  if (t.e1 == null) return null;
  const intervalo  = (t.e2 != null && t.s1 != null) ? t.e2 - t.s1 : 60;
  const intervalo2 = (t.hasT3 && t.e3 != null && t.s2 != null) ? t.e3 - t.s2 : 0;
  return t.e1 + t.carga + intervalo + intervalo2;
}

// Calcula Saída Extra: e1 + 600 + intervalo(s)
function calcExtra(t) {
  if (t.e1 == null) return null;
  const intervalo  = (t.e2 != null && t.s1 != null) ? t.e2 - t.s1 : 60;
  const intervalo2 = (t.hasT3 && t.e3 != null && t.s2 != null) ? t.e3 - t.s2 : 0;
  return t.e1 + 600 + intervalo + intervalo2;
}

// Envia push FCM
async function sendPush(token, title, body, tag) {
  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: { tag },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      throw { invalidToken: true };
    }
    console.error('❌ sendPush:', err.message);
  }
}

// ── Regras ───────────────────────────────────────────────────

// 1. Retorno do intervalo: s1 (ou s2 com T3) + duration
function checkIntervalReturn(t, cfg, ms, fired) {
  if (!cfg.interval_return_enabled) return [];
  const lastBreakExit = (t.hasT3 && t.s2 != null) ? t.s2 : t.s1;
  if (lastBreakExit == null) return [];

  const duration = cfg.interval_return_time ?? 60;
  const target   = lastBreakExit + duration;
  const before   = cfg.interval_return_safe_before ?? 5;
  const out = [];

  if (before > 0 && !fired.has('interval_return_before') && inWindow(ms, target - before))
    out.push({ key: 'interval_return_before', title: '⏰ Intervalo terminando',   body: `Seu intervalo termina em ${before} min (às ${fmt(target)}).` });
  if (!fired.has('interval_return_exact') && inWindow(ms, target))
    out.push({ key: 'interval_return_exact',  title: '🔔 Retorno do Intervalo',    body: `Retorne ao trabalho às ${fmt(target)}.` });
  return out;
}

// 2. Carga diária: Saída Normal — gatilho: e2 ou e3 com T3
function checkDailyLoad(t, cfg, ms, fired) {
  if (!cfg.daily_load_enabled) return [];
  const entradaAtiva = (t.hasT3 && t.e3 != null) || t.e2 != null;
  if (!entradaAtiva) return [];

  const target = calcNormal(t);
  if (target == null) return [];

  const before = cfg.daily_load_safe_before ?? 5;
  const out = [];

  if (before > 0 && !fired.has('daily_load_before') && inWindow(ms, target - before))
    out.push({ key: 'daily_load_before', title: '⏰ Carga diária quase completa', body: `Faltam ${before} min para completar a carga (às ${fmt(target)}).` });
  if (!fired.has('daily_load_exact') && inWindow(ms, target))
    out.push({ key: 'daily_load_exact',  title: '✅ Carga Diária Completa',       body: `Hora de encerrar o expediente (${fmt(target)}).` });
  return out;
}

// 3. Turno máximo: e1 ou e2 + max (T1 e T2 apenas, conforme spec)
function checkShiftMax(t, cfg, ms, fired) {
  if (!cfg.shift_max_enabled) return [];
  const max    = cfg.shift_max_time ?? 360;
  const before = cfg.shift_max_safe_before ?? 10;
  const out = [];

  for (const { key, entry, exit } of [
    { key: 'T1', entry: t.e1, exit: t.s1 },
    { key: 'T2', entry: t.e2, exit: t.s2 },
  ]) {
    if (entry == null || exit != null) continue;
    const target = entry + max;
    if (before > 0 && !fired.has(`shift_max_${key}_before`) && inWindow(ms, target - before))
      out.push({ key: `shift_max_${key}_before`, title: `⏰ Turno máximo próximo (${key})`,   body: `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).` });
    if (!fired.has(`shift_max_${key}_exact`) && inWindow(ms, target))
      out.push({ key: `shift_max_${key}_exact`,  title: `⚠️ Turno Máximo Atingido (${key})`, body: `Você está há ${fmt(max)} no ${key}. Registre a saída.` });
  }
  return out;
}

// 4. Jornada máxima: Saída Extra da tabela
function checkWorkdayMax(t, cfg, ms, fired) {
  if (!cfg.workday_max_enabled) return [];
  const target = calcExtra(t);
  if (target == null) return [];

  const before = cfg.workday_max_safe_before ?? 10;
  const out = [];

  if (before > 0 && !fired.has('workday_max_before') && inWindow(ms, target - before))
    out.push({ key: 'workday_max_before', title: '⏰ Jornada máxima próxima',  body: `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).` });
  if (!fired.has('workday_max_exact') && inWindow(ms, target))
    out.push({ key: 'workday_max_exact',  title: '🚨 Jornada Máxima Atingida', body: `Você atingiu o limite de jornada (${fmt(target)}).` });
  return out;
}

// 5. Intervalo mínimo: última saída do dia (s3 > s2 > s1) + mín_intervalo
function checkMinInterval(t, cfg, ms, fired) {
  if (!cfg.min_interval_enabled) return [];

  let lastExit = null;
  if (t.hasT3 && t.s3 != null) lastExit = t.s3;
  else if (t.s2 != null)       lastExit = t.s2;
  else if (t.s1 != null)       lastExit = t.s1;
  if (lastExit == null) return [];

  const min    = cfg.min_interval_time ?? 660;
  const before = cfg.min_interval_safe_before ?? 15;
  const target = lastExit + min;
  const out = [];

  if (before > 0 && !fired.has('min_interval_before') && inWindow(ms, target - before))
    out.push({ key: 'min_interval_before', title: '⏰ Intervalo mínimo quase esgotado', body: `Faltam ${before} min para completar o descanso mínimo (às ${fmt(target)}).` });
  if (!fired.has('min_interval_exact') && inWindow(ms, target))
    out.push({ key: 'min_interval_exact',  title: '✅ Descanso Mínimo Concluído',       body: `Você completou ${fmt(min)} de descanso. Pode iniciar nova jornada.` });
  return out;
}

// ── Cloud Function principal ─────────────────────────────────

exports.checkNotifications = onSchedule({
  schedule:       'every 1 minutes',
  timeZone:       'America/Sao_Paulo',
  memory:         '256MiB',
  timeoutSeconds: 60,
}, async () => {
  const brt       = nowBRT();
  const currentMs = nowMs(brt);
  const now       = nowMin(brt);
  const dateKey   = `${brt.getFullYear()}${String(brt.getMonth()+1).padStart(2,'0')}${String(brt.getDate()).padStart(2,'0')}`;

  const tokensSnap = await db.collectionGroup('fcm_tokens').get();
  if (tokensSnap.empty) return;

  // Agrupar por uid
  const tokensByUid = new Map();
  for (const doc of tokensSnap.docs) {
    const { token, uid } = doc.data();
    if (!token || !uid) continue;
    if (!tokensByUid.has(uid)) tokensByUid.set(uid, []);
    tokensByUid.get(uid).push({ token, tokenDoc: doc });
  }

  console.log(`🔔 ${fmt(now)} — ${tokensByUid.size} usuário(s)`);

  await Promise.all([...tokensByUid.entries()].map(async ([uid, tokens]) => {
    try {
      // Configurações de notificação
      const cfgSnap = await db.doc(`config/${uid}/data/ponto_notification_settings`).get();
      if (!cfgSnap.exists) return;
      const cfg = cfgSnap.data();

      // Calcular período que contém hoje
      const diaAtual = brt.getDate();
      const mesAtual = brt.getMonth() + 1;
      const settingsSnap = await db.doc(`config/${uid}/data/ponto_settings`).get();
      const periodos = settingsSnap.exists ? (settingsSnap.data().periodos || {}) : {};
      const mesStr   = String(mesAtual).padStart(2, '0');
      const diaIni   = (periodos[mesStr] || {}).ini ?? 16;
      const periodoMes = diaAtual >= diaIni
        ? mesStr
        : String(mesAtual === 1 ? 12 : mesAtual - 1).padStart(2, '0');
      const periodoAno = (periodoMes === '12' && mesAtual === 1)
        ? brt.getFullYear() - 1 : brt.getFullYear();
      const periodoKey = `${periodoAno}_${periodoMes}`;

      // Linha do dia atual
      const periodoSnap = await db.doc(`pontos/${uid}/periodos/${periodoKey}`).get();
      if (!periodoSnap.exists) return;

      const rows     = JSON.parse(periodoSnap.data().data || '[]');
      const todayDay = String(brt.getDate());
      const row      = rows.find(r => r[0] === todayDay);
      if (!row) return;

      // Extrair tempos + carga + hasT3
      const hasT3 = row.length > 8 && (row[8] || row[9]);
      const t = {
        e1: timeToMin(row[4]), s1: timeToMin(row[5]),
        e2: timeToMin(row[6]), s2: timeToMin(row[7]),
        e3: hasT3 ? timeToMin(row[8]) : null,
        s3: hasT3 ? timeToMin(row[9]) : null,
        hasT3: !!hasT3,
        carga: timeToMin(row[2]) ?? 528,
      };

      // Deduplicação — reseta se s1 mudou
      const firedSnap = await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).get();
      const firedData = firedSnap.exists ? firedSnap.data() : {};
      const fired = (firedData.lastS1 != null && firedData.lastS1 !== t.s1)
        ? new Set()
        : new Set(firedData.keys || []);

      // Verificar todas as regras
      const toFire = [
        ...checkIntervalReturn(t, cfg, currentMs, fired),
        ...checkDailyLoad(t, cfg, currentMs, fired),
        ...checkShiftMax(t, cfg, currentMs, fired),
        ...checkWorkdayMax(t, cfg, currentMs, fired),
        ...checkMinInterval(t, cfg, currentMs, fired),
      ];

      if (toFire.length === 0) return;
      console.log(`  🚀 ${uid.slice(0,8)}: ${toFire.map(f => f.key).join(', ')}`);

      // Enviar para todos os dispositivos
      const newFired = [];
      for (const { key, title, body } of toFire) {
        let sent = false;
        for (const { token, tokenDoc } of tokens) {
          try {
            await sendPush(token, title, body, key);
            sent = true;
          } catch (e) {
            if (e.invalidToken) await tokenDoc.ref.delete();
          }
        }
        if (sent) newFired.push(key);
      }

      if (newFired.length > 0) {
        await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).set({
          keys:      [...fired, ...newFired],
          lastS1:    t.s1 ?? null,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

    } catch (err) {
      console.error(`Erro uid=${uid.slice(0,8)}:`, err.message);
    }
  }));

  console.log('✅ concluído.');
});
