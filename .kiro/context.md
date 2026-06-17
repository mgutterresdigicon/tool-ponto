# Controle de Ponto

Aplicação web para registro e controle de horário de trabalho, com sincronização via Firebase.

## Versão Atual: v2.0.0

## Arquivos Principais
- `public/index.html` — Frontend (login + tabela de ponto)
- `public/js/ponto.js` — Lógica de cálculos, linhas, exportação
- `public/js/storage.js` — Persistência (Firestore + localStorage fallback)
- `public/js/auth.js` — Autenticação Google
- `public/js/firebase-config.js` — Credenciais Firebase + emails autorizados
- `ponto.html` — Versão standalone (sem Firebase, localStorage only)
