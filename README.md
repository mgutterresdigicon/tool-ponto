# 🕐 Controle de Ponto

Ferramenta web para registro e controle de horário de trabalho, com sincronização via Firebase.

## Estrutura do Projeto

```
tool-ponto/
├── public/
│   ├── index.html              # Frontend (login + tabela de ponto)
│   ├── VERSION                 # Arquivo de versão
│   ├── css/
│   │   └── app.css             # Estilos
│   └── js/
│       ├── firebase-config.js  # Config Firebase + EMAILS_PERMITIDOS
│       ├── auth.js             # Login/logout Google + gerenciamento de usuários
│       ├── state.js            # Estado global
│       ├── modal.js            # Modal customizado (alert/confirm/prompt)
│       ├── storage.js          # Persistência (Firestore + localStorage + realtime)
│       └── ponto.js            # Lógica principal (cálculos, UI, exportação)
├── standalone/
│   └── ponto.html              # Versão offline (sem Firebase, localStorage only)
├── tools/
│   └── deploy.sh              # Script de deploy
├── firebase.json
├── .firebaserc
├── CHANGELOG.md
└── README.md
```

## Pré-requisitos

- Uma conta Google (gratuita)
- Firebase CLI (`npm install -g firebase-tools`)

## Configuração do Firebase

### 1. Criar o projeto

1. Acesse **https://console.firebase.google.com**
2. Crie um projeto (ex: `tool-ponto`)

### 2. Ativar Autenticação com Google

1. Autenticação → Método de login → Google → Ativar

### 3. Criar Firestore

1. Firestore Database → Criar banco de dados → Modo de produção
2. Localização: `southamerica-east1`
3. Publicar as regras:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /config/allowed_emails {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.token.email == 'SEU_EMAIL_ADMIN';
    }
    match /solicitacoes/{email} {
      allow create: if true;
      allow read, delete: if request.auth != null && request.auth.token.email == 'SEU_EMAIL_ADMIN';
    }
    match /pontos/{uid}/periodos/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /config/{uid}/data/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 4. Configurar credenciais

Edite `public/js/firebase-config.js`:
- Substitua o `firebaseConfig` com os valores do projeto
- Defina o `ADMIN_EMAIL`

Edite `firebase.json` e `.firebaserc`:
- Substitua `tool-ponto` pelo ID do seu projeto (se diferente)

### 5. Deploy

```bash
firebase login
./tools/deploy.sh
```

URL: `https://SEU_PROJETO.web.app`

## Funcionalidades

| Função | Descrição |
|--------|-----------|
| 🔐 Login Google | Acesso restrito com gerenciamento de usuários |
| 📩 Solicitação | Novos usuários podem solicitar acesso |
| 👥 Admin | Aprovar/rejeitar solicitações, adicionar/remover emails |
| ⏱ Registrar | Marca ponto com hora atual no próximo campo disponível |
| 📅 Períodos | Configuráveis (padrão 16/mês a 15/mês+1) |
| ⏱️ Turnos | Até 3 turnos por dia (turno 3 sob demanda) |
| 📊 Cálculos | Total, Azure (decimal), Hora-Extra com tolerância 6min |
| 🕐 Tempo real | Usa hora atual como saída provisória, atualiza a cada minuto |
| 🔄 Sync | Sincronização em tempo real entre dispositivos |
| 💾 Firebase | Dados na nuvem por usuário |
| 📁 Backup JSON | Exporta/importa todos os períodos |
| 📄 CSV | Exporta para Excel |

## Desenvolvimento

```bash
firebase serve --only hosting
```

Acesse `http://localhost:5000`. Sem etapa de build — HTML/CSS/JS puro com ES modules.

## Versionamento

Este projeto segue o [versionamento semântico](https://semver.org/lang/pt-BR/).
A versão é controlada pelo arquivo `public/VERSION`.
Veja o histórico completo em [CHANGELOG.md](CHANGELOG.md).

## Custo

Totalmente gratuito dentro do Firebase Free Tier (50k leituras/dia, 20k escritas/dia, 1GB armazenamento).
