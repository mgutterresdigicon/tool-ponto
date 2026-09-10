// functions/index.js
// Cloud Function agendada: verifica notificações pendentes e envia via FCM
//
// Deduplicação por target:
//   fired[key] = target — se target calculado agora === fired[key] → já disparou.
//   Se target mudou (horários alterados) → dispara de novo automaticamente.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp }  = require('firebase-admin/app');
const { getFirestore }   = require('firebase-admin/firestore');
const { getMessaging }   = require('firebase-admin/messaging');

initializeApp();
const db        = getFirestore();
const messaging = getMessaging();

// ── Helpers ──────────────────────────────────────────────────

function nowBRT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}
function nowMin(brt)   { return brt.getHours() * 60 + brt.getMinutes(); }
function nowMs(brt)    { return (brt.getHours() * 3600 + brt.getMinutes() * 60 + brt.getSeconds()) * 1000; }
function targetToMs(m) { return m * 60 * 1000; }

function inWindow(currentMs, target) {
  const d = currentMs - targetToMs(target);
  return d >= -30000 && d <= 30000;
}

function fmt(min) {
  if (min == null) return '--:--';
  return String(Math.floor(Math.abs(min) / 60)).padStart(2, '0') + ':' + String(Math.abs(min) % 60).padStart(2, '0');
}

function timeToMin(str) {
  if (!str || !str.includes(':')) return null;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function calcNormal(t) {
  if (t.e1 == null) return null;
  const i1 = (t.e2 != null && t.s1 != null) ? t.e2 - t.s1 : 60;
  const i2 = (t.hasT3 && t.e3 != null && t.s2 != null) ? t.e3 - t.s2 : 0;
  return t.e1 + t.carga + i1 + i2;
}

function calcExtra(t) {
  if (t.e1 == null) return null;
  const i1 = (t.e2 != null && t.s1 != null) ? t.e2 - t.s1 : 60;
  const i2 = (t.hasT3 && t.e3 != null && t.s2 != null) ? t.e3 - t.s2 : 0;
  return t.e1 + 600 + i1 + i2;
}

function rowToTimes(row) {
  if (!row) return null;
  const hasT3 = row.length > 8 && (row[8] || row[9]);
  return {
    e1: timeToMin(row[4]), s1: timeToMin(row[5]),
    e2: timeToMin(row[6]), s2: timeToMin(row[7]),
    e3: hasT3 ? timeToMin(row[8]) : null,
    s3: hasT3 ? timeToMin(row[9]) : null,
    hasT3: !!hasT3,
    carga: timeToMin(row[2]) ?? 528,
  };
}

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

// ── Deduplicação por target ───────────────────────────────────
function alreadyFired(fired, key, target) { return fired[key] === target; }
function markFired(out, key, target)       { out[key] = target; }

// ── Regras ───────────────────────────────────────────────────

function checkIntervalReturn(t, cfg, ms, fired) {
  if (!cfg.interval_return_enabled) return [];
  const lastBreakExit = (t.hasT3 && t.s2 != null) ? t.s2 : t.s1;
  if (lastBreakExit == null) return [];
  const duration = cfg.interval_return_time ?? 60;
  const target   = lastBreakExit + duration;
  const before   = cfg.interval_return_safe_before ?? 5;
  const out = [];
  if (before > 0 && !alreadyFired(fired, 'interval_return_before', target - before) && inWindow(ms, target - before))
    out.push({ key: 'interval_return_before', target: target - before, title: '⏰ Intervalo terminando',  body: `Seu intervalo termina em ${before} min (às ${fmt(target)}).` });
  if (!alreadyFired(fired, 'interval_return_exact', target) && inWindow(ms, target))
    out.push({ key: 'interval_return_exact',  target,                  title: '🔔 Retorno do Intervalo',   body: `Retorne ao trabalho às ${fmt(target)}.` });
  return out;
}

function checkDailyLoad(t, cfg, ms, fired) {
  if (!cfg.daily_load_enabled) return [];
  const emT2Aberto = !t.hasT3 && t.e2 != null && t.s2 == null;
  const emT3Aberto =  t.hasT3 && t.e3 != null && t.s3 == null;
  if (!emT2Aberto && !emT3Aberto) return [];
  const target = calcNormal(t);
  if (target == null) return [];
  const before = cfg.daily_load_safe_before ?? 5;
  const out = [];
  if (before > 0 && !alreadyFired(fired, 'daily_load_before', target - before) && inWindow(ms, target - before))
    out.push({ key: 'daily_load_before', target: target - before, title: '⏰ Carga diária quase completa', body: `Faltam ${before} min para completar a carga (às ${fmt(target)}).` });
  if (!alreadyFired(fired, 'daily_load_exact', target) && inWindow(ms, target))
    out.push({ key: 'daily_load_exact',  target,                  title: '✅ Carga Diária Completa',       body: `Hora de encerrar o expediente (${fmt(target)}).` });
  return out;
}

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
    if (before > 0 && !alreadyFired(fired, `shift_max_${key}_before`, target - before) && inWindow(ms, target - before))
      out.push({ key: `shift_max_${key}_before`, target: target - before, title: `⏰ Turno máximo próximo (${key})`,   body: `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).` });
    if (!alreadyFired(fired, `shift_max_${key}_exact`, target) && inWindow(ms, target))
      out.push({ key: `shift_max_${key}_exact`,  target,                   title: `⚠️ Turno Máximo Atingido (${key})`, body: `Você está há ${fmt(max)} no ${key}. Registre a saída.` });
  }
  return out;
}

function checkWorkdayMax(t, cfg, ms, fired) {
  if (!cfg.workday_max_enabled) return [];
  if (t.e1 == null) return [];
  const algumTurnoAberto =
    (t.hasT3 && t.e3 != null && t.s3 == null) ||
    (!t.hasT3 && t.e2 != null && t.s2 == null) ||
    (t.e2 == null && t.s1 == null);
  if (!algumTurnoAberto) return [];
  const target = calcExtra(t);
  if (target == null) return [];
  const before = cfg.workday_max_safe_before ?? 10;
  const out = [];
  if (before > 0 && !alreadyFired(fired, 'workday_max_before', target - before) && inWindow(ms, target - before))
    out.push({ key: 'workday_max_before', target: target - before, title: '⏰ Jornada máxima próxima',  body: `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).` });
  if (!alreadyFired(fired, 'workday_max_exact', target) && inWindow(ms, target))
    out.push({ key: 'workday_max_exact',  target,                  title: '🚨 Jornada Máxima Atingida', body: `Você atingiu o limite de jornada (${fmt(target)}).` });
  return out;
}

// Intervalo mínimo — trata virada de meia-noite (target pode ultrapassar 1440)
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

  // target >= 1440 significa que cai no dia seguinte.
  // currentMs é ms desde meia-noite de hoje. Para comparar com o dia seguinte,
  // somamos 1440*60*1000 ao currentMs.
  const adjustedMs    = target >= 1440 ? ms + 1440 * 60 * 1000 : ms;
  const targetMs      = target * 60 * 1000;
  const triggerBefore = target - before;
  const triggerMs     = triggerBefore * 60 * 1000;

  const out = [];
  if (before > 0 && !alreadyFired(fired, 'min_interval_before', triggerBefore)) {
    const d = adjustedMs - triggerMs;
    if (d >= -30000 && d <= 30000)
      out.push({ key: 'min_interval_before', target: triggerBefore, title: '⏰ Intervalo mínimo quase esgotado', body: `Faltam ${before} min para o descanso mínimo (às ${fmt(target % 1440)}).` });
  }
  if (!alreadyFired(fired, 'min_interval_exact', target)) {
    const d = adjustedMs - targetMs;
    if (d >= -30000 && d <= 30000)
      out.push({ key: 'min_interval_exact', target, title: '✅ Descanso Mínimo Concluído', body: `Você completou ${fmt(min)} de descanso. Pode iniciar nova jornada.` });
  }
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
      const cfgSnap = await db.doc(`config/${uid}/data/ponto_notification_settings`).get();
      if (!cfgSnap.exists) return;
      const cfg = cfgSnap.data();

      // Período que contém hoje
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
        ? brt.getFullYear() - 1 : brt.getFullYear();

      const periodoSnap = await db.doc(`pontos/${uid}/periodos/${periodoAno}_${periodoMes}`).get();
      if (!periodoSnap.exists) return;

      const rows = JSON.parse(periodoSnap.data().data || '[]');

      // Linha de hoje e linha de ontem (para checkMinInterval cruzando meia-noite)
      const row         = rows.find(r => r[0] === String(diaAtual));
      const rowAnterior = rows.find(r => r[0] === String(diaAtual - 1));
      const t           = rowToTimes(row);
      const tAnterior   = rowToTimes(rowAnterior);

      // fired: { [key]: target } — deduplicação por target
      const firedSnap = await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).get();
      const fired = firedSnap.exists ? { ...firedSnap.data() } : {};
      // Limpar campos de controle de versões antigas
      delete fired.keys; delete fired.rowSig; delete fired.lastS1; delete fired.updatedAt;

      const toFire = [];

      // Regras que precisam da linha de hoje
      if (t) {
        toFire.push(
          ...checkIntervalReturn(t, cfg, currentMs, fired),
          ...checkDailyLoad(t, cfg, currentMs, fired),
          ...checkShiftMax(t, cfg, currentMs, fired),
          ...checkWorkdayMax(t, cfg, currentMs, fired),
        );
      }

      // Intervalo mínimo: prefere linha de hoje (se tem saída), senão ontem (cruzou meia-noite)
      const tMin = (t && (t.s1 != null || t.s2 != null || t.s3 != null)) ? t : tAnterior;
      if (tMin) {
        toFire.push(...checkMinInterval(tMin, cfg, currentMs, fired));
      }

      if (toFire.length === 0) return;
      console.log(`  🚀 ${uid.slice(0,8)}: ${toFire.map(f => f.key).join(', ')}`);

      // Enviar para todos os dispositivos
      const newFired = {};
      for (const { key, target, title, body } of toFire) {
        let sent = false;
        for (const { token, tokenDoc } of tokens) {
          try {
            await sendPush(token, title, body, key);
            sent = true;
          } catch (e) {
            if (e.invalidToken) await tokenDoc.ref.delete();
          }
        }
        if (sent) markFired(newFired, key, target);
      }

      if (Object.keys(newFired).length > 0) {
        await db.doc(`config/${uid}/data/notif_fired_${dateKey}`).set({
          ...newFired,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

    } catch (err) {
      console.error(`Erro uid=${uid.slice(0,8)}:`, err.message);
    }
  }));

  console.log('✅ concluído.');
});
