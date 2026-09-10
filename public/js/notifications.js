// ============================================================
// notifications.js — Disparo de notificações do sistema
//
// Regras:
//  1. interval_return  — s1 (ou s2 com T3 ativo) + duração
//  2. daily_load       — Saída Normal da tabela (e1+carga+intervalo)
//                        gatilho: e2 preenchida (ou e3 com T3)
//  3. shift_max        — e1 ou e2 + max_turno (6h padrão)
//  4. workday_max      — Saída Extra da tabela (e1+600+intervalo)
//  5. min_interval     — última saída do dia (s1/s2/s3) + mín_intervalo
//
// before=0 → dispara apenas o aviso exato, sem antecipado.
// Deduplicação por Set de chaves por dia, limpa ao virar o dia.
// ============================================================

import { timeToMin } from './ponto.js';

// ── Estado interno ────────────────────────────────────────────
// fired: Map { key → target } — deduplicação por target, não por chave pura
// Se o target de uma regra muda (horário registrado mudou), dispara de novo.
let _firedToday = new Map();
let _trackedDay = -1;

function resetIfNewDay() {
  const today = new Date().getDate();
  if (today !== _trackedDay) {
    _firedToday = new Map();
    _trackedDay = today;
  }
}

function alreadyFired(key, target) {
  return _firedToday.get(key) === target;
}

function markFired(key, target) {
  _firedToday.set(key, target);
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

  // Usa SW quando disponível — evita duplicação pois new Notification()
  // e reg.showNotification() disparam notificações independentes.
  // new Notification() é fallback apenas quando não há SW (Firefox sem SW, Safari).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, { body, tag, requireInteraction: false, silent: false });
    }).catch(() => {
      // SW falhou — tenta direto
      try { new Notification(title, { body, tag, silent: false }); } catch (_) {}
    });
  } else {
    try { new Notification(title, { body, tag, silent: false }); } catch (_) {}
  }
}

// Agenda notificação exata no SW para quando o app estiver suspenso
function scheduleInSW(delayMs, title, body, tag) {
  if (!('serviceWorker' in navigator) || delayMs <= 0) return;
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) {
      reg.active.postMessage({ type: 'SCHEDULE_NOTIFICATION', delayMs, title, body, tag });
    }
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────
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

// Janela de tolerância: 0 — disparo exato no minuto alvo.
// O tick é sincronizado em :00s do relógio, sem necessidade de margem.
const WINDOW_MIN = 0;

// Tenta disparar aviso antecipado e/ou exato.
// before=0: não dispara antecipado — apenas o exato.
// Deduplicação por target: se os horários mudaram, dispara de novo.
function tryFire(key, targetMin, beforeMin, titleExact, bodyExact, titleBefore, bodyBefore) {
  const now       = nowMin();
  const keyBefore = key + '_before';
  const keyExact  = key + '_exact';
  const triggerBefore = targetMin - beforeMin;

  if (beforeMin > 0 && !alreadyFired(keyBefore, triggerBefore)) {
    if (now === triggerBefore) {
      send(titleBefore, bodyBefore, keyBefore);
      markFired(keyBefore, triggerBefore);
      // Agenda o exato no SW para quando o app estiver suspenso
      const delayMs = beforeMin * 60 * 1000;
      scheduleInSW(delayMs, titleExact, bodyExact, keyExact);
    }
  }

  if (!alreadyFired(keyExact, targetMin)) {
    if (now === targetMin) {
      send(titleExact, bodyExact, keyExact);
      markFired(keyExact, targetMin);
    }
  }
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

// Extrai os tempos e indica se turno 3 está ativo
function getRowTimes(tr) {
  if (!tr) return null;
  const inp = tr.querySelectorAll('input[type="text"]');
  const t3  = tr.querySelectorAll('.turno3 input');
  const hasT3 = t3.length > 0;
  return {
    e1: timeToMin(inp[4]?.value),
    s1: timeToMin(inp[5]?.value),
    e2: timeToMin(inp[6]?.value),
    s2: timeToMin(inp[7]?.value),
    e3: hasT3 ? timeToMin(t3[0]?.value) : null,
    s3: hasT3 ? timeToMin(t3[1]?.value) : null,
    hasT3,
    // Carga configurada na linha
    carga: timeToMin(inp[2]?.value) ?? 528,
  };
}

// Calcula Saída Normal: e1 + carga + intervalo(s)
// Mesmo cálculo do calcRow no ponto.js
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

// ── Regras ────────────────────────────────────────────────────

// 1. Retorno do intervalo
//    Gatilho: s1 preenchida, ou s2 preenchida com T3 ativo
//    Alvo: última saída de intervalo + duration
function checkIntervalReturn(times, cfg, dateKey) {
  if (!cfg.interval_return_enabled) return;

  // Determinar a saída de intervalo relevante
  let lastBreakExit = null;
  if (times.hasT3 && times.s2 != null) {
    lastBreakExit = times.s2; // intervalo entre T2 e T3
  } else if (times.s1 != null) {
    lastBreakExit = times.s1; // intervalo entre T1 e T2
  }
  if (lastBreakExit == null) return;

  const duration = cfg.interval_return_time ?? 60;
  const target   = lastBreakExit + duration;
  const before   = cfg.interval_return_safe_before ?? 5;

  tryFire(
    `${dateKey}_interval_return`,
    target, before,
    '🔔 Retorno do Intervalo',     `Retorne ao trabalho às ${fmt(target)}.`,
    '⏰ Intervalo terminando',     `Seu intervalo termina em ${before} min (às ${fmt(target)}).`
  );
}

// 2. Carga diária completa
//    Gatilho: e2 preenchida (ou e3 com T3) E o turno correspondente ainda aberto (sem saída)
//    Alvo: Saída Normal da tabela
function checkDailyLoad(times, cfg, dateKey) {
  if (!cfg.daily_load_enabled) return;

  // Verifica se o usuário está no 2º ou 3º turno E o turno está aberto (sem saída)
  const noT3 = !times.hasT3;
  const emT2Aberto = noT3  && times.e2 != null && times.s2 == null;
  const emT3Aberto = times.hasT3 && times.e3 != null && times.s3 == null;
  if (!emT2Aberto && !emT3Aberto) return;

  const target = calcNormal(times);
  if (target == null) return;

  const before = cfg.daily_load_safe_before ?? 5;

  tryFire(
    `${dateKey}_daily_load`,
    target, before,
    '✅ Carga Diária Completa',       `Hora de encerrar o expediente (${fmt(target)}).`,
    '⏰ Carga diária quase completa', `Faltam ${before} min para completar a carga (às ${fmt(target)}).`
  );
}

// 3. Turno máximo
//    Gatilho: e1 ou e2 preenchida e turno ainda aberto
//    Alvo: entrada do turno + max_turno (6h padrão)
function checkShiftMax(times, cfg, dateKey) {
  if (!cfg.shift_max_enabled) return;
  const max    = cfg.shift_max_time ?? 360;
  const before = cfg.shift_max_safe_before ?? 10;

  // Apenas T1 e T2 conforme spec
  const turnos = [
    { key: 'T1', entry: times.e1, exit: times.s1 },
    { key: 'T2', entry: times.e2, exit: times.s2 },
  ];

  for (const { key, entry, exit } of turnos) {
    if (entry == null) continue;
    if (exit != null) continue; // turno já encerrado

    const target = entry + max;
    tryFire(
      `${dateKey}_shift_max_${key}`,
      target, before,
      `⚠️ Turno Máximo Atingido (${key})`, `Você está há ${fmt(max)} no ${key}. Registre a saída.`,
      `⏰ Turno máximo próximo (${key})`,   `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).`
    );
  }
}

// 4. Jornada máxima
//    Alvo: Saída Extra da tabela (e1 + 600 + intervalos)
//    Gatilho: existe uma entrada aberta (sem saída correspondente)
function checkWorkdayMax(times, cfg, dateKey) {
  if (!cfg.workday_max_enabled) return;
  if (times.e1 == null) return;

  // Verifica se há algum turno ainda aberto
  const algumTurnoAberto =
    (times.hasT3 && times.e3 != null && times.s3 == null) ||
    (!times.hasT3 && times.e2 != null && times.s2 == null) ||
    (times.e2 == null && times.s1 == null); // apenas T1 e ainda aberto
  if (!algumTurnoAberto) return;

  const target = calcExtra(times);
  if (target == null) return;

  const before = cfg.workday_max_safe_before ?? 10;

  tryFire(
    `${dateKey}_workday_max`,
    target, before,
    '🚨 Jornada Máxima Atingida', `Você atingiu o limite de jornada (${fmt(target)}).`,
    '⏰ Jornada máxima próxima',  `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).`
  );
}

// 5. Intervalo mínimo entre jornadas
//    Alvo: última saída do dia (s1, s2 ou s3 com T3) + min_intervalo
//    Diferente da regra anterior: usa saída do DIA ATUAL, não do dia anterior
function checkMinInterval(times, cfg, dateKey) {
  if (!cfg.min_interval_enabled) return;

  // Última saída registrada no dia (s3 > s2 > s1)
  let lastExit = null;
  if (times.hasT3 && times.s3 != null) lastExit = times.s3;
  else if (times.s2 != null)           lastExit = times.s2;
  else if (times.s1 != null)           lastExit = times.s1;
  if (lastExit == null) return;

  const min    = cfg.min_interval_time ?? 660;
  const before = cfg.min_interval_safe_before ?? 15;
  const target = lastExit + min;

  tryFire(
    `${dateKey}_min_interval`,
    target, before,
    '✅ Descanso Mínimo Concluído',        `Você completou ${fmt(min)} de descanso. Pode iniciar nova jornada.`,
    '⏰ Intervalo mínimo quase esgotado',  `Faltam ${before} min para completar o descanso mínimo (às ${fmt(target)}).`
  );
}

// ── Ponto de entrada público ──────────────────────────────────
export function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  resetIfNewDay();

  const raw = localStorage.getItem('ponto_notification_settings');
  const cfg = raw ? JSON.parse(raw) : {};

  const now     = new Date();
  const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const tr    = getTodayRow();
  const times = getRowTimes(tr);
  if (!times) return;

  checkIntervalReturn(times, cfg, dateKey);
  checkDailyLoad(times, cfg, dateKey);
  checkShiftMax(times, cfg, dateKey);
  checkWorkdayMax(times, cfg, dateKey);
  checkMinInterval(times, cfg, dateKey);
}
