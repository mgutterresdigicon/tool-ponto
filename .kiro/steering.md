# Controle de Ponto — Contexto do Projeto

## Visão Geral
Aplicação web de controle de ponto (horário de trabalho), hospedada via Firebase Hosting. Projeto multi-arquivo com ES modules. Sem framework JS — HTML/CSS/JS puro com Firebase SDK via CDN.

## Estrutura de Arquivos
```
tool-ponto/
├── public/
│   ├── index.html              # HTML estrutural (frontend)
│   ├── css/
│   │   └── app.css             # Estilos
│   └── js/
│       ├── firebase-config.js  # Config Firebase + EMAILS_PERMITIDOS
│       ├── auth.js             # Login/logout Google + onAuthStateChanged
│       ├── state.js            # Estado global (currentUser)
│       ├── modal.js            # Modal customizado (alert/confirm/prompt)
│       ├── storage.js          # Camada de persistência (Firestore + localStorage)
│       └── ponto.js            # Lógica principal (cálculos, UI, linhas, exportação)
├── ponto.html                  # Versão standalone (sem Firebase, localStorage only)
├── deploy.sh                   # Deploy Linux
├── firebase.json
├── .firebaserc
└── README.md
```

## Stack
- **Frontend**: HTML + CSS + JavaScript puro (ES modules)
- **Auth**: Firebase Authentication (Google Sign-In)
- **Banco**: Firestore (coleções `pontos/{uid}/periodos/` e `config/{uid}/data/`)
- **Hosting**: Firebase Hosting
- **Deploy**: `firebase deploy` ou `./deploy.sh`

## Modelo de Dados

### Firestore — `pontos/{uid}/periodos/{ano_mes}`
```js
{
  rows: [
    [dia, bonus, carga, comp, e1, s1, e2, s2, e3?, s3?],
    // ... uma entrada por dia
  ]
}
```

### Firestore — `config/{uid}/data/ponto_settings`
```js
{
  cargaDia: "08:48",
  periodos: {
    "05": { label: "16/05 - 15/06", ini: 16, fim: 15 },
    // ... períodos customizados
  }
}
```

## Regras de Desenvolvimento
- Editar arquivos em `public/` diretamente
- Sem etapa de build — ES modules nativos do browser
- Deploy: `firebase deploy` ou `./deploy.sh`
- Teste local: `firebase serve --only hosting`
- **Nunca fazer commit ou push sem solicitação explícita do usuário**

## Regras de Negócio
- Carga padrão: 08:48/dia
- Carga = |CargaPadrão - Bônus + Comp|
- Período padrão: dia 16 ao dia 15 do mês seguinte
- Tolerância hora-extra: diferença < 6min = 0
- Máximo trabalho/dia: 10h (para cálculo Saída Extra)
- Intervalo almoço: Entrada2 - Saída1 (padrão 1h se não preenchido)
- Saída Normal = Entrada1 + Carga + Intervalo
- Saída Extra = Entrada1 + 10h + Intervalo
- Hora atual usada como saída provisória se campo vazio

## Versionamento
- Formato: vMAJOR.MINOR.PATCH
- PATCH: correções
- MINOR: novas funcionalidades
- MAJOR: mudanças incompatíveis (ex: migração para Firebase)
- Atualizar versão no rodapé do HTML e README

## Convenções de Código
- ES modules com import/export entre arquivos
- Funções expostas ao HTML via `window.nomeDaFuncao = ...`
- Estado centralizado em `state.js`
- Persistência via `storage.js` (abstrai Firestore + localStorage)
