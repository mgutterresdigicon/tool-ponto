// ============================================================
// notifications.js — Disparo de notificações do sistema
//
// Regras implementadas:
//  1. interval_return  — retorno do intervalo (saída T1 + duração_intervalo)
//  2. daily_load       — carga diária completa  (entrada T1 + carga_diária)
//  3. shift_max        — turno máximo (entrada de cada turno + máx_turno)
//  4. workday_max      — jornada máxima (entrada T1 + máx_jornada)
//  5. min_interval     — intervalo mínimo entre jornadas (última saída + mín_intervalo)
//
// Cada regra dispara dois avisos independentes:
//  - "before": X minutos antes do momento alvo
//  - "exact":  no momento exato
//
// Controle de deduplicação: Set de chaves "data_regra_tipo" por dia.
// Limpa automaticamente ao virar o dia.
// ============================================================

import { timeToMin } from './ponto.js';

// ── Estado interno ────────────────────────────────────────────
let _firedToday = new Set();  // chaves já disparadas hoje
let _trackedDay = -1;         // dia do mês monitorado (para reset)

function resetIfNewDay() {
  const today = new Date().getDate();
  if (today !== _trackedDay) {
    _firedToday.clear();
    _trackedDay = today;
  }
}

// ── Permissão ─────────────────────────────────────────────────
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ── Enviar notificação ────────────────────────────────────────
function send(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Tenta new Notification() primeiro — funciona no Firefox, Safari e alguns
  // contextos do Chrome. Se lançar exceção (Chrome desktop), cai no SW.
  let sentDirect = false;
  try {
    new Notification(title, { body, tag, silent: false });
    sentDirect = true;
  } catch (_) {
    // Chrome desktop bloqueia new Notification() fora de SW — usa SW abaixo
  }

  // Complementa via SW: garante entrega no Chrome desktop e Android PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      // Se já enviou via new Notification(), usa tag diferente para não duplicar
      const swTag = sentDirect ? tag + '_sw' : tag;
      reg.showNotification(title, { body, tag: swTag, requireInteraction: false, silent: false });
    }).catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────

// Retorna hora atual em minutos desde meia-noite
function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

// Margem de tolerância: cobre imprecisão do tick de minuto
const WINDOW_MIN = 2;

// Tenta disparar um aviso. Usa janela de WINDOW_MIN para não perder eventos
// por atraso no tick. Registra no Set para não repetir.
function tryFire(key, targetMin, beforeMin, titleExact, bodyExact, titleBefore, bodyBefore) {
  const now = nowMin();
  const keyBefore = key + '_before';
  const keyExact  = key + '_exact';

  if (beforeMin > 0 && !_firedToday.has(keyBefore)) {
    const triggerMin = targetMin - beforeMin;
    if (now >= triggerMin && now <= triggerMin + WINDOW_MIN) {
      send(titleBefore, bodyBefore, keyBefore);
      _firedToday.add(keyBefore);
    }
  }

  if (!_firedToday.has(keyExact)) {
    if (now >= targetMin && now <= targetMin + WINDOW_MIN) {
      send(titleExact, bodyExact, keyExact);
      _firedToday.add(keyExact);
    }
  }
}

// Formata minutos como "HH:MM"
function fmt(min) {
  if (min == null) return '--:--';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// ── Leitura da linha do dia atual ─────────────────────────────
function getTodayRow() {
  const today = String(new Date().getDate());
  const tbody = document.getElementById('tbody');
  if (!tbody) return null;
  for (const tr of tbody.querySelectorAll('tr')) {
    const inputs = tr.querySelectorAll('input[type="text"]');
    if (inputs[0]?.value === today) return tr;
  }
  return null;
}

// Extrai os tempos da linha: { e1, s1, e2, s2, e3, s3 } em minutos ou null
function getRowTimes(tr) {
  if (!tr) return null;
  const inp = tr.querySelectorAll('input[type="text"]');
  // índices: 0=dia, 1=bonus, 2=carga, 3=comp, 4=e1, 5=s1, 6=e2, 7=s2
  const t3 = tr.querySelectorAll('.turno3 input');
  return {
    e1: timeToMin(inp[4]?.value),
    s1: timeToMin(inp[5]?.value),
    e2: timeToMin(inp[6]?.value),
    s2: timeToMin(inp[7]?.value),
    e3: t3[0] ? timeToMin(t3[0].value) : null,
    s3: t3[1] ? timeToMin(t3[1].value) : null,
  };
}

// ── Regras ────────────────────────────────────────────────────

// 1. Retorno do intervalo: s1 + interval_return_time
function checkIntervalReturn(times, cfg, dateKey) {
  if (!cfg.interval_return_enabled) return;
  const { s1 } = times;
  if (s1 == null) return;

  const duration = cfg.interval_return_time ?? 60;
  const target   = s1 + duration;
  const before   = cfg.interval_return_safe_before ?? 5;

  tryFire(
    `${dateKey}_interval_return`,
    target, before,
    '🔔 Fim do Intervalo',      `Retorne ao trabalho às ${fmt(target)}.`,
    '⏰ Intervalo terminando',  `Seu intervalo termina em ${before} min (às ${fmt(target)}).`
  );
}

// 2. Carga diária completa: e1 + daily_load_time
function checkDailyLoad(times, cfg, dateKey) {
  if (!cfg.daily_load_enabled) return;
  const { e1 } = times;
  if (e1 == null) return;

  const load   = cfg.daily_load_time ?? 528;
  const target = e1 + load;
  const before = cfg.daily_load_safe_before ?? 5;

  tryFire(
    `${dateKey}_daily_load`,
    target, before,
    '✅ Carga Diária Completa',       `Você completou ${fmt(load)} de trabalho hoje.`,
    '⏰ Carga diária quase completa', `Faltam ${before} min para completar sua carga (às ${fmt(target)}).`
  );
}

// 3. Turno máximo: cada entrada em aberto + shift_max_time
function checkShiftMax(times, cfg, dateKey) {
  if (!cfg.shift_max_enabled) return;
  const max    = cfg.shift_max_time ?? 360;
  const before = cfg.shift_max_safe_before ?? 10;

  const entries = [
    { key: 'T1', entry: times.e1, exit: times.s1 },
    { key: 'T2', entry: times.e2, exit: times.s2 },
    { key: 'T3', entry: times.e3, exit: times.s3 },
  ];

  for (const { key, entry, exit } of entries) {
    if (entry == null) continue;
    if (exit != null) continue; // turno já encerrado

    const target = entry + max;
    tryFire(
      `${dateKey}_shift_max_${key}`,
      target, before,
      `⚠️ Turno Máximo Atingido (${key})`,  `Você está há ${fmt(max)} no ${key}. Considere registrar a saída.`,
      `⏰ Turno máximo próximo (${key})`,    `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).`
    );
  }
}

// 4. Jornada máxima: e1 + workday_max_time
function checkWorkdayMax(times, cfg, dateKey) {
  if (!cfg.workday_max_enabled) return;
  const { e1 } = times;
  if (e1 == null) return;

  const max    = cfg.workday_max_time ?? 600;
  const target = e1 + max;
  const before = cfg.workday_max_safe_before ?? 10;

  tryFire(
    `${dateKey}_workday_max`,
    target, before,
    '🚨 Jornada Máxima Atingida',   `Você está trabalhando há ${fmt(max)} hoje.`,
    '⏰ Jornada máxima próxima',    `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).`
  );
}

// 5. Intervalo mínimo entre jornadas
//    Busca a última saída registrada antes da linha de hoje e calcula
//    o tempo decorrido desde então.
function checkMinInterval(cfg, dateKey) {
  if (!cfg.min_interval_enabled) return;

  const tbody = document.getElementById('tbody');
  if (!tbody) return;

  const todayStr = String(new Date().getDate());
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const todayIdx = rows.findIndex(tr => tr.querySelectorAll('input[type="text"]')[0]?.value === todayStr);
  if (todayIdx <= 0) return;

  // Buscar última saída registrada antes de hoje
  let lastExit = null;
  for (let i = todayIdx - 1; i >= 0; i--) {
    const t = getRowTimes(rows[i]);
    if (!t) continue;
    const exits = [t.s3, t.s2, t.s1].filter(v => v != null);
    if (exits.length) { lastExit = Math.max(...exits); break; }
  }
  if (lastExit == null) return;

  const now    = nowMin();
  const min    = cfg.min_interval_time ?? 660;
  const before = cfg.min_interval_safe_before ?? 15;

  // Tempo decorrido: se lastExit > now, a saída foi antes da meia-noite
  const elapsed   = lastExit <= now ? now - lastExit : 1440 - lastExit + now;
  const remaining = min - elapsed;

  if (remaining <= 0 || remaining > min) return;

  // Aviso antecipado — usa janela WINDOW_MIN igual ao tryFire
  const keyBefore = `${dateKey}_min_interval_before`;
  if (!_firedToday.has(keyBefore) && remaining <= before && remaining >= before - WINDOW_MIN) {
    send(
      '⏰ Intervalo mínimo quase esgotado',
      `Faltam ~${remaining} min para completar o descanso mínimo de ${fmt(min)} entre jornadas.`,
      keyBefore
    );
    _firedToday.add(keyBefore);
  }

  // Aviso exato — janela de WINDOW_MIN minutos após o alvo
  const keyExact = `${dateKey}_min_interval_exact`;
  if (!_firedToday.has(keyExact) && remaining <= 0 && remaining >= -WINDOW_MIN) {
    send(
      '✅ Descanso Mínimo Concluído',
      `Você completou ${fmt(min)} de descanso. Pode iniciar a próxima jornada.`,
      keyExact
    );
    _firedToday.add(keyExact);
  }
}

// ── Ponto de entrada público ──────────────────────────────────

/**
 * Chamado pelo tick de minuto e ao registrar ponto.
 * Lê as configurações salvas e verifica cada regra.
 */
export function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  resetIfNewDay();

  const raw = localStorage.getItem('ponto_notification_settings');
  const cfg = raw ? JSON.parse(raw) : {};

  const now     = new Date();
  const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const tr    = getTodayRow();
  const times = getRowTimes(tr);

  if (times) {
    checkIntervalReturn(times, cfg, dateKey);
    checkDailyLoad(times, cfg, dateKey);
    checkShiftMax(times, cfg, dateKey);
    checkWorkdayMax(times, cfg, dateKey);
  }

  checkMinInterval(cfg, dateKey);
}
