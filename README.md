# 🕐 Controle de Ponto

Ferramenta web para registro e controle de horário de trabalho, com sincronização via Firebase.

## Estrutura do Projeto

```
tool-ponto/
├── public/
│   ├── index.html              # Frontend (login + tabela de ponto)
│   ├── sw.js                   # Service Worker (notificações do sistema)
│   ├── VERSION                 # Arquivo de versão
│   ├── css/
│   │   └── app.css             # Estilos
│   └── js/
│       ├── firebase-config.js  # Config Firebase + ADMIN_EMAIL
│       ├── auth.js             # Login/logout Google + gerenciamento de usuários
│       ├── state.js            # Estado global
│       ├── modal.js            # Modal (confirm/input) + sistema de toasts
│       ├── notifications.js    # Notificações do sistema (5 regras configuráveis)
│       ├── storage.js          # Persistência (Firestore + localStorage + realtime)
│       └── ponto.js            # Lógica principal (cálculos, UI, exportação)
├── standalone/
│   └── ponto.html              # Versão offline (sem Firebase, localStorage only)
├── tools/
│   ├── full-tool.js            # Backup / restore / upload para Firestore
│   ├── seed-data.js            # Popula o emulador local com backup de produção
│   ├── deploy.sh               # Script de deploy
│   └── package.json            # Dependências das ferramentas (firebase-admin)
├── firebase.json
├── .firebaserc
├── CHANGELOG.md
└── README.md
```

## Pré-requisitos

- Uma conta Google (gratuita)
- Firebase CLI (`npm install -g firebase-tools`)
- Node.js 18+ (para as ferramentas em `tools/`)

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
npm install -g firebase-tools
firebase login
chmod +x tools/deploy.sh
./tools/deploy.sh
```
URL: `https://SEU_PROJETO.web.app`

### Desenvolvimento local

```bash
firebase emulators:start
```

Em outro terminal, para popular o emulador com dados de produção:

```bash
# 1. Gerar backup de produção (requer service account em tools/)
node tools/full-tool.js backup

# 2. Carregar no emulador
FIREBASE_PROJECT_ID=tool-ponto node ./tools/seed-data.js
```

Acesse `http://localhost:5000`. Sem etapa de build — HTML/CSS/JS puro com ES modules.

## Ferramentas (`tools/`)

Instale as dependências antes de usar:

```bash
cd tools && npm install
```

### full-tool.js

Utilitário completo para gerenciar dados do Firestore em produção.

```bash
# Backup completo do banco (requer service account)
node tools/full-tool.js backup [caminho-service-account.json]

# Restaurar backup no banco (cuidado: sobrescreve dados)
node tools/full-tool.js restore <arquivo-backup.json> [caminho-service-account.json]

# Upload de arquivo JSON para o banco
node tools/full-tool.js upload <arquivo.json> [caminho-service-account.json]
```

O arquivo de service account deve ser colocado em `tools/` e pode ser gerado em:
Firebase Console → Configurações do projeto → Contas de serviço → Gerar nova chave privada

### seed-data.js

Popula o emulador local com dados de um backup. Detecta automaticamente o backup mais recente em `tools/`.

```bash
# Usando o backup mais recente automaticamente
FIREBASE_PROJECT_ID=tool-ponto node ./tools/seed-data.js

# Ou especificando um arquivo
FIREBASE_PROJECT_ID=tool-ponto node ./tools/seed-data.js tools/backup-firestore-2026-09-07T15-52-12.256Z.json
```

## Funcionalidades

| Função | Descrição |
|--------|-----------|
| 🔐 Login Google | Acesso restrito com gerenciamento de usuários |
| 📩 Solicitação | Novos usuários podem solicitar acesso ao admin |
| 👥 Admin | Aprovar/rejeitar solicitações, adicionar/remover emails |
| ⏱ Registrar | Marca ponto com hora atual no próximo campo disponível |
| 📅 Períodos | Configuráveis (padrão 16/mês a 15/mês+1) |
| ⏱️ Turnos | Até 3 turnos por dia (turno 3 sob demanda) |
| 📊 Cálculos | Total, Azure (decimal), Hora-Extra com tolerância 6min |
| 🕐 Tempo real | Usa hora atual como saída provisória, atualiza a cada minuto |
| 🔄 Sync | Sincronização em tempo real entre dispositivos via Firestore |
| 💾 Configurações | Carga horária, períodos e preferências salvas por usuário no Firestore |
| 🔔 Notificações | 5 regras configuráveis via Service Worker (Chrome/Edge/Firefox) |
| 📁 Backup JSON | Exporta/importa todos os períodos |
| 📄 CSV | Exporta período atual para Excel |

### Notificações do sistema

Requer permissão de notificação no navegador. Configurável pelo botão ⚙️:

| Regra | Descrição |
|-------|-----------|
| 📩 Retorno do intervalo | Avisa quando o tempo de intervalo está prestes a acabar |
| 📊 Carga diária completa | Avisa quando a carga horária do dia está quase completa |
| ⏱️ Turno máximo | Avisa quando um turno contínuo se aproxima do limite configurado |
| 📅 Jornada máxima | Avisa quando o total trabalhado no dia está no limite |
| 🌙 Intervalo mínimo entre jornadas | Avisa quando o descanso entre expedientes está no limite |

Cada regra dispara dois avisos: um antecipado (X minutos antes) e um no momento exato.

## Desenvolvimento

```bash
firebase emulators:start
```

Acesse `http://localhost:5000`. Sem etapa de build — HTML/CSS/JS puro com ES modules.

## Versionamento

Este projeto segue o [versionamento semântico](https://semver.org/lang/pt-BR/).
A versão é controlada pelo arquivo `public/VERSION`.
Veja o histórico completo em [CHANGELOG.md](CHANGELOG.md).

## Custo

Totalmente gratuito dentro do Firebase Free Tier (50k leituras/dia, 20k escritas/dia, 1GB armazenamento).
