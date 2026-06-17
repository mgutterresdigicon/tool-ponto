# 🕐 Controle de Ponto — Guia de Instalação

## O que você vai precisar
- Uma conta Google (gratuita)
- Firebase CLI instalado (`npm install -g firebase-tools`)
- ~15 minutos para configurar

---

## Estrutura do Projeto

```
tool-ponto/
├── public/
│   ├── index.html              # HTML estrutural (frontend)
│   ├── css/
│   │   └── app.css             # Estilos
│   └── js/
│       ├── firebase-config.js  # Config Firebase + EMAILS_PERMITIDOS
│       ├── auth.js             # Login/logout Google
│       ├── state.js            # Estado global
│       ├── modal.js            # Modal customizado (alert/confirm/prompt)
│       ├── storage.js          # Camada de persistência (Firestore + localStorage)
│       └── ponto.js            # Lógica principal (cálculos, UI, exportação)
├── ponto.html                  # Versão standalone (sem Firebase, localStorage only)
├── deploy.sh                   # Deploy Linux
├── firebase.json
├── .firebaserc
└── README.md
```

---

## Passo 1 — Criar o projeto Firebase

1. Acesse **https://console.firebase.google.com**
2. Clique em **"Adicionar projeto"**
3. Dê um nome (ex: `controle-ponto`) → Avançar → Criar projeto

---

## Passo 2 — Ativar Autenticação com Google

1. No menu lateral: **Autenticação** → **Primeiros passos**
2. Na aba **Método de login**, clique em **Google** → ative → Salvar

---

## Passo 3 — Criar o banco de dados (Firestore)

1. No menu lateral: **Firestore Database** → **Criar banco de dados**
2. Escolha **Modo de produção** → Avançar → Localização: `southamerica-east1` → Ativar
3. Vá em **Regras** e substitua por:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /pontos/{uid}/periodos/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /config/{uid}/data/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

4. Clique em **Publicar**

---

## Passo 4 — Pegar as credenciais do app

1. Na página inicial do projeto, clique no ícone **`</>`** (Web)
2. Dê um apelido (ex: `ponto-web`) → Registrar app
3. Copie o objeto `firebaseConfig`

---

## Passo 5 — Configurar o app

Edite `public/js/firebase-config.js`:

1. Substitua o `firebaseConfig` pelos valores do Passo 4
2. Edite a lista `EMAILS_PERMITIDOS` com os e-mails Google autorizados

Edite `firebase.json` e `.firebaserc`:
- Substitua `SEU_PROJETO_ID` pelo ID do projeto criado no Passo 1

---

## Passo 6 — Ativar Firebase Hosting

```bash
firebase login
firebase deploy
```

Ou use o script:
```bash
./deploy.sh
```

A URL será algo como: `https://SEU_PROJETO.web.app`

---

## Estrutura de dados no Firestore

```
firestore/
├── pontos/
│   └── {uid}/                    # isolado por usuário
│       └── periodos/
│           └── {ano_mes}         # ex: "2026_05"
│               └── rows: [       # array de registros diários
│                   [dia, bonus, carga, comp, e1, s1, e2, s2, e3?, s3?],
│                   ...
│               ]
│
└── config/
    └── {uid}/
        └── data/
            └── ponto_settings
                ├── cargaDia: "08:48"
                └── periodos: { "05": {label, ini, fim}, ... }
```

---

## Desenvolvimento

- Edite os arquivos em `public/` diretamente
- Teste local: `firebase serve --only hosting` → `http://localhost:5000`
- Sem etapa de build — HTML/CSS/JS puro com ES modules
- A versão standalone `ponto.html` (raiz) funciona sem Firebase (localStorage only)

---

## Funcionalidades

| Função | Descrição |
|--------|-----------|
| 🔐 Login Google | Acesso restrito por lista de e-mails |
| 📅 Períodos | Configuráveis (padrão 16/mês a 15/mês+1) |
| ⏱️ Turnos | Até 3 turnos por dia (turno 3 sob demanda) |
| 📊 Cálculos | Total, Azure (decimal), Hora-Extra com tolerância 6min |
| 🕐 Tempo real | Usa hora atual como saída provisória |
| 💾 Firebase | Dados sincronizados na nuvem |
| 📁 Backup JSON | Exporta/importa todos os períodos |
| 📄 CSV | Exporta para Excel |

---

## Versão

Atual: **v2.0.0**

---

## Custo

**Totalmente gratuito** dentro do Firebase Free Tier:
- 50.000 leituras/dia
- 20.000 escritas/dia
- 1 GB armazenamento
