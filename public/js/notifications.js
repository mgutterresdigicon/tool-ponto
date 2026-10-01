// ============================================================
// notifications.js — Notificações do sistema (frontend)
//
// Arquitetura:
//   - Fonte principal: Cloud Function (FCM backend) → envia push a cada minuto.
//   - Foreground: onMessage do FCM → frontend exibe a notificação recebida do backend.
//   - Fallback: checkNotifications() → só ativa quando SW indisponível ou offline.
//
// Deduplicação no fallback por target: _firedToday.get(key) === target
// Se target muda (horários alterados) → dispara de novo.
// ============================================================

import { onMessage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

// Cópia local para evitar dependência circular com ponto.js
function timeToMin(str) {
  if (!str || str.trim() === '') return null;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// ── Estado interno ────────────────────────────────────────────
let _firedToday = new Map(); // { key → target }
let _trackedDay = -1;

function resetIfNewDay() {
  const today = new Date().getDate();
  if (today !== _trackedDay) {
    _firedToday = new Map();
    _trackedDay = today;
  }
}

function alreadyFired(key, target) { return _firedToday.get(key) === target; }
function markFired(key, target)     { _firedToday.set(key, target); }

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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, { body, tag, icon: '/icon-notification-96.png', badge: '/icon-notification-72.png', requireInteraction: false, silent: false });
    }).catch(() => {
      try { new Notification(title, { body, tag, silent: false }); } catch (_) {}
    });
  } else {
    try { new Notification(title, { body, tag, silent: false }); } catch (_) {}
  }
}

// ── FCM Foreground ────────────────────────────────────────────
//
// Quando o app está em foreground, o FCM não exibe notificação automaticamente.
// Esta função escuta onMessage e exibe via SW (ou Notification API como fallback).
// Deve ser chamada uma única vez após o login, passando o objeto `messaging`.
//
// Resultado: app aberto ou fechado → uma única notificação (sem duplicação).
let _fcmForegroundInit = false;
export function initFCMForeground(messaging) {
  if (_fcmForegroundInit) return;
  _fcmForegroundInit = true;

  onMessage(messaging, payload => {
    // title/body vêm em payload.data (sem campo notification no envio)
    const title = payload.data?.title || payload.notification?.title;
    const body  = payload.data?.body  || payload.notification?.body;
    const tag   = payload.data?.tag   || 'ponto-notif';
    if (!title) return;

    // Exibe via SW para consistência visual (ícone, badge, som)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          tag,
          icon:               '/icon-notification-96.png',
          badge:              '/icon-notification-72.png',
          requireInteraction: false,
        });
      }).catch(() => {
        try { new Notification(title, { body, tag, silent: false }); } catch (_) {}
      });
    } else {
      try { new Notification(title, { body, tag, silent: false }); } catch (_) {}
    }
  });
}

function scheduleInSW(delayMs, title, body, tag) {
  // Não agendar via SW quando FCM backend está ativo — ele já envia o exato.
  // Só agenda no fallback (offline), mas o fallback não usa tryFire com before>0
  // de forma que chegue aqui apenas em casos sem backend.
  const swAtivo = 'serviceWorker' in navigator && navigator.serviceWorker.controller != null;
  const online  = navigator.onLine !== false;
  if (swAtivo && online) return; // FCM cuida — não duplicar

  if (!('serviceWorker' in navigator) || delayMs <= 0) return;
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) reg.active.postMessage({ type: 'SCHEDULE_NOTIFICATION', delayMs, title, body, tag });
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

// tryFire: disparo exato no minuto alvo, deduplicação por target
function tryFire(key, targetMin, beforeMin, titleExact, bodyExact, titleBefore, bodyBefore) {
  const now           = nowMin();
  const keyBefore     = key + '_before';
  const keyExact      = key + '_exact';
  const triggerBefore = targetMin - beforeMin;

  if (beforeMin > 0 && !alreadyFired(keyBefore, triggerBefore) && now === triggerBefore) {
    send(titleBefore, bodyBefore, keyBefore);
    markFired(keyBefore, triggerBefore);
    scheduleInSW(beforeMin * 60 * 1000, titleExact, bodyExact, keyExact);
  }

  if (!alreadyFired(keyExact, targetMin) && now === targetMin) {
    send(titleExact, bodyExact, keyExact);
    markFired(keyExact, targetMin);
  }
}

// ── Leitura da linha do dia atual ─────────────────────────────
function getTodayRow() {
  const today = String(new Date().getDate());
  const tbody = document.getElementById('tbody');
  if (!tbody) return null;
  for (const tr of tbody.querySelectorAll('tr')) {
    if (tr.querySelectorAll('input[type="text"]')[0]?.value === today) return tr;
  }
  return null;
}

function getRowTimes(tr) {
  if (!tr) return null;
  const inp = tr.querySelectorAll('input[type="text"]');
  const t3  = tr.querySelectorAll('.turno3 input');
  const hasT3 = t3.length > 0;
  return {
    e1: timeToMin(inp[4]?.value), s1: timeToMin(inp[5]?.value),
    e2: timeToMin(inp[6]?.value), s2: timeToMin(inp[7]?.value),
    e3: hasT3 ? timeToMin(t3[0]?.value) : null,
    s3: hasT3 ? timeToMin(t3[1]?.value) : null,
    hasT3,
    carga: timeToMin(inp[2]?.value) ?? 528,
  };
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

// ── Regras ────────────────────────────────────────────────────

function checkIntervalReturn(times, cfg, dateKey) {
  if (!cfg.interval_return_enabled) return;
  const lastBreakExit = (times.hasT3 && times.s2 != null) ? times.s2 : times.s1;
  if (lastBreakExit == null) return;
  const duration = cfg.interval_return_time ?? 60;
  const target   = lastBreakExit + duration;
  const before   = cfg.interval_return_safe_before ?? 5;
  tryFire(`${dateKey}_interval_return`, target, before,
    '🔔 Retorno do Intervalo',    `Retorne ao trabalho às ${fmt(target)}.`,
    '⏰ Intervalo terminando',    `Seu intervalo termina em ${before} min (às ${fmt(target)}).`);
}

function checkDailyLoad(times, cfg, dateKey) {
  if (!cfg.daily_load_enabled) return;
  const emT2Aberto = !times.hasT3 && times.e2 != null && times.s2 == null;
  const emT3Aberto =  times.hasT3 && times.e3 != null && times.s3 == null;
  if (!emT2Aberto && !emT3Aberto) return;
  const target = calcNormal(times);
  if (target == null) return;
  const before = cfg.daily_load_safe_before ?? 5;
  tryFire(`${dateKey}_daily_load`, target, before,
    '✅ Carga Diária Completa',       `Hora de encerrar o expediente (${fmt(target)}).`,
    '⏰ Carga diária quase completa', `Faltam ${before} min para completar a carga (às ${fmt(target)}).`);
}

function checkShiftMax(times, cfg, dateKey) {
  if (!cfg.shift_max_enabled) return;
  const max    = cfg.shift_max_time ?? 360;
  const before = cfg.shift_max_safe_before ?? 10;
  for (const { key, entry, exit } of [
    { key: 'T1', entry: times.e1, exit: times.s1 },
    { key: 'T2', entry: times.e2, exit: times.s2 },
  ]) {
    if (entry == null || exit != null) continue;
    const target = entry + max;
    tryFire(`${dateKey}_shift_max_${key}`, target, before,
      `⚠️ Turno Máximo Atingido (${key})`, `Você está há ${fmt(max)} no ${key}. Registre a saída.`,
      `⏰ Turno máximo próximo (${key})`,   `Faltam ${before} min para o limite do turno ${key} (às ${fmt(target)}).`);
  }
}

function checkWorkdayMax(times, cfg, dateKey) {
  if (!cfg.workday_max_enabled) return;
  if (times.e1 == null) return;
  const algumTurnoAberto =
    (times.hasT3 && times.e3 != null && times.s3 == null) ||
    (!times.hasT3 && times.e2 != null && times.s2 == null) ||
    (times.e2 == null && times.s1 == null);
  if (!algumTurnoAberto) return;
  const target = calcExtra(times);
  if (target == null) return;
  const before = cfg.workday_max_safe_before ?? 10;
  tryFire(`${dateKey}_workday_max`, target, before,
    '🚨 Jornada Máxima Atingida', `Você atingiu o limite de jornada (${fmt(target)}).`,
    '⏰ Jornada máxima próxima',  `Faltam ${before} min para a jornada máxima (às ${fmt(target)}).`);
}

// Intervalo mínimo — trata virada de meia-noite
// Se saída às 20:00 + 11h = 31:00 (1860 min) → nowMin() + 1440 para comparar
function checkMinInterval(times, cfg, dateKey) {
  if (!cfg.min_interval_enabled) return;
  let lastExit = null;
  if (times.hasT3 && times.s3 != null) lastExit = times.s3;
  else if (times.s2 != null)           lastExit = times.s2;
  else if (times.s1 != null)           lastExit = times.s1;
  if (lastExit == null) return;

  const min    = cfg.min_interval_time ?? 660;
  const before = cfg.min_interval_safe_before ?? 15;
  const target = lastExit + min;

  // Ajusta nowMin para cruzar meia-noite
  const now           = target >= 1440 ? nowMin() + 1440 : nowMin();
  const keyBefore     = `${dateKey}_min_interval_before`;
  const keyExact      = `${dateKey}_min_interval_exact`;
  const triggerBefore = target - before;

  if (before > 0 && !alreadyFired(keyBefore, triggerBefore) && now === triggerBefore) {
    send('⏰ Intervalo mínimo quase esgotado', `Faltam ${before} min para o descanso mínimo (às ${fmt(target % 1440)}).`, keyBefore);
    markFired(keyBefore, triggerBefore);
    scheduleInSW(before * 60 * 1000, '✅ Descanso Mínimo Concluído', `Você completou ${fmt(min)} de descanso. Pode iniciar nova jornada.`, keyExact);
  }

  if (!alreadyFired(keyExact, target) && now === target) {
    send('✅ Descanso Mínimo Concluído', `Você completou ${fmt(min)} de descanso. Pode iniciar nova jornada.`, keyExact);
    markFired(keyExact, target);
  }
}

// HE diária zerando — dispara quando o HE do dia cruza zero (positivo→zero ou negativo→zero).
// Deduplicação: armazena o sinal anterior. Só dispara uma vez por transição de sinal por dia.
// heNow: valor em minutos calculado da linha de hoje (pode ser null se turno não concluído).
function checkHeZero(heNow, cfg, dateKey) {
  if (!cfg.he_zero_enabled) return;
  if (heNow == null) return;

  // heNow dentro da tolerância de ±5 min é considerado "zero"
  const TOL = 5;
  const isZero = Math.abs(heNow) <= TOL;
  if (!isZero) {
    // Atualizar sinal anterior quando não é zero (para detectar a próxima transição)
    const sigKey = `${dateKey}_he_zero_prev_sign`;
    const prevSign = _firedToday.get(sigKey);
    const curSign  = heNow > 0 ? 1 : -1;
    if (prevSign !== curSign) markFired(sigKey, curSign);
    return;
  }

  const sigKey     = `${dateKey}_he_zero_prev_sign`;
  const firedKey   = `${dateKey}_he_zero_fired`;
  const prevSign   = _firedToday.get(sigKey);
  const alreadyDone = _firedToday.get(firedKey);

  // Só dispara se havia sinal definido antes (evita disparar no início do dia com he=0)
  // e se ainda não disparou para esta transição
  if (prevSign == null || alreadyDone) return;

  const dir = prevSign > 0 ? 'positivas' : 'negativas';
  send('⚖️ HE Diária Zerada', `As horas extras do dia zeraram (vinham ${dir}).`, `${dateKey}_he_zero`);
  markFired(firedKey, 1);
}

// HE acumulada zerando — mesma lógica, mas para o saldo acumulado do período.
// heAcumNow: último valor de sumHE do período (lido do DOM da última linha preenchida).
function checkHeAcumZero(heAcumNow, cfg, dateKey) {
  if (!cfg.he_acum_zero_enabled) return;
  if (heAcumNow == null) return;

  const TOL    = 5;
  const isZero = Math.abs(heAcumNow) <= TOL;
  if (!isZero) {
    const sigKey  = `${dateKey}_he_acum_zero_prev_sign`;
    const prevSign = _firedToday.get(sigKey);
    const curSign  = heAcumNow > 0 ? 1 : -1;
    if (prevSign !== curSign) markFired(sigKey, curSign);
    return;
  }

  const sigKey     = `${dateKey}_he_acum_zero_prev_sign`;
  const firedKey   = `${dateKey}_he_acum_zero_fired`;
  const prevSign   = _firedToday.get(sigKey);
  const alreadyDone = _firedToday.get(firedKey);

  if (prevSign == null || alreadyDone) return;

  const dir = prevSign > 0 ? 'positivas' : 'negativas';
  send('⚖️ HE Acumulada Zerada', `O saldo acumulado de horas extras zerou (vinha ${dir}).`, `${dateKey}_he_acum_zero`);
  markFired(firedKey, 1);
}

// ── Ponto de entrada público ──────────────────────────────────
//
// O disparo principal é feito pela Cloud Function (FCM) — sempre ativa,
// mesmo com o app fechado, sem duplicação entre dispositivos.
//
// Foreground: initFCMForeground() escuta onMessage e exibe a notificação
// recebida do backend quando o app está aberto.
//
// Fallback: este checkNotifications() só executa quando:
//   - Não há Service Worker registrado (offline / SW falhou)
//   - O navigator.onLine é false (sem conexão)
//
// Quando o app está online com SW ativo, o FCM já cuida das notificações.
// Manter o frontend calculando também causaria duplicação.
export function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Se há SW e app está online → FCM backend cuida. Frontend não dispara.
  const swAtivo  = 'serviceWorker' in navigator && navigator.serviceWorker.controller != null;
  const online   = navigator.onLine !== false;
  if (swAtivo && online) return;

  // Fallback: SW não disponível ou offline
  const hoje = new Date();
  if (hoje.getDay() === 0 || hoje.getDay() === 6) return;

  resetIfNewDay();

  const raw = localStorage.getItem('ponto_notification_settings');
  const cfg = raw ? JSON.parse(raw) : {};
  const dateKey = `${hoje.getFullYear()}${String(hoje.getMonth()+1).padStart(2,'0')}${String(hoje.getDate()).padStart(2,'0')}`;

  const times = getRowTimes(getTodayRow());
  if (!times) return;

  checkIntervalReturn(times, cfg, dateKey);
  checkDailyLoad(times, cfg, dateKey);
  checkShiftMax(times, cfg, dateKey);
  checkWorkdayMax(times, cfg, dateKey);
  checkMinInterval(times, cfg, dateKey);

  // HE diária: lê do DOM (coluna .calc:nth-of-type correta = índice 6 das .calc)
  const todayRow = getTodayRow();
  if (todayRow) {
    const calcs = todayRow.querySelectorAll('.calc:not(.turno3):not(.he-acum)');
    // calcs[6] é a coluna HE (baseado na estrutura de addRow: t1,t2,normal,extra,azure,total,he)
    const heText = calcs[6]?.textContent?.trim();
    const heNow  = heText ? timeToMin(heText.replace('-', '')) * (heText.startsWith('-') ? -1 : 1) : null;
    checkHeZero(heNow, cfg, dateKey);

    // HE acumulada: lê da célula .he-acum da última linha preenchida
    const allRows   = Array.from(tbody.querySelectorAll('tr'));
    const lastFilled = [...allRows].reverse().find(tr => tr.querySelector('.he-acum')?.textContent?.trim());
    const acumText  = lastFilled?.querySelector('.he-acum')?.textContent?.trim();
    const heAcumNow = acumText ? timeToMin(acumText.replace('-', '')) * (acumText.startsWith('-') ? -1 : 1) : null;
    checkHeAcumZero(heAcumNow, cfg, dateKey);
  }
}
