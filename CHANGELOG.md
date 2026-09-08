# Changelog

Histórico das principais alterações do projeto.

Este arquivo segue o formato [Keep a Changelog](https://keepachangelog.com/pt-BR),
e este projeto segue o [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não publicado]

## [2.4.0] - 2026-09-07

### Adicionado

- Notificações do sistema via FCM (Firebase Cloud Messaging) — funcionam mesmo com o app completamente fechado no celular.
- Cloud Function `checkNotifications` agendada a cada minuto que verifica os horários registrados e envia push para todos os dispositivos do usuário.
- 5 regras de notificação configuráveis: retorno do intervalo, carga diária completa, turno máximo, jornada máxima e intervalo mínimo entre jornadas.
- Cada regra dispara dois avisos: antecipado (X min antes) e no momento exato.
- Modal de configurações de notificações com botão X, textos de ajuda por seção e campos `type="time"` para duração.
- Botão ⚙️ movido para a barra de ações principais (ao lado do 📁).
- Toasts substituem modais informativos (✔ Salvo, ⚠ Aviso, ⚠ Erro).
- PWA: `manifest.json` e ícone SVG — remove botão "Cancelar inscrição" nas notificações do Android.
- Service Worker (`sw.js`) para exibir notificações no Chrome desktop via `showNotification()`.
- Configurações de notificação salvas por usuário no Firestore (`config/{uid}/data/ponto_notification_settings`).
- FCM tokens salvos por dispositivo no Firestore (`config/{uid}/fcm_tokens/{token}`).
- `firestore.rules` versionado no repositório.
- `tools/full-tool.js`: backup corrigido para capturar documentos implícitos via `listDocuments()`.
- `tools/seed-data.js`: popula o emulador com dados de produção, detecta backup mais recente automaticamente.

### Corrigido

- Tick de minuto sincronizado no segundo `:00` do relógio (era baseado em epoch Unix, podia disparar em qualquer segundo).
- Bug de falso positivo na detecção de nova versão: `normalizeVersion()` remove todo whitespace, fetch inicial usa `?t=Date.now()` para evitar cache.
- Configurações de notificação agora sempre priorizadas do Firestore ao abrir o modal (sync entre dispositivos).
- `toggleSetting` atualiza o botão diretamente sem recarregar do Firestore (evitava race condition).
- Mapa `TOGGLE_BTN_IDS` para associar corretamente `settingId` ao ID do botão HTML (camelCase vs snake_case).

## [2.3.1] - 2026-07-07

### Corrigido

- Ao editar período, o dia exibido ficava 1 a menos do selecionado devido a interpretação de data em UTC (fuso horário -03:00).
- Ao reduzir o fim de um período, dias que ficaram fora do intervalo eram mantidos na visualização em vez de serem movidos para o próximo período.
- `ensureToday` não verificava se o dia atual pertencia ao período selecionado, podendo adicionar o dia corrente em um período incorreto.

## [2.3.0] - 2026-07-02

### Corrigido

- Períodos editados não estavam sendo salvos no firebase, apenas no localStorage.

### Adicionado

 - Campo de HE Acumulada para o usuário saber a quantidade de horas extras acumuladas até os dias aneriores.

## [2.2.5] - 2026-07-01

### Corrigido

- Ajuste de visualização das linhas quando turno3 estiver habilitado em alguma linha.

## [2.2.4] - 2026-07-01

### Corrigido

- Horários de saída agora somam intervalo2, quando entrada do turno 3 for adicionado.

## [2.2.3] - 2026-06-23

### Corrigido

- Footer cortado no navegador mobile: usa `100dvh` para descontar barra de navegação

## [2.2.2] - 2026-06-23

### Corrigido

- Dia atual agora é garantido na tabela após carga de dados e após sync realtime
- Dia atual não desaparece mais quando o listener do Firestore atualiza a tabela

## [2.2.1] - 2026-06-22

### Adicionado

- Verificação automática de nova versão a cada 60s (compara arquivo VERSION)
- Botão 🔄 com pulso verde quando há atualização disponível
- Texto "Mostrar linhas" no botão de toggle de dias

### Modificado

- Bloco de botões (Registrar, Salvar, etc.) movido para após Carga/Bônus em nova linha

## [2.2.0] - 2026-06-22

### Adicionado

- Botão 📋 para mostrar/ocultar dias anteriores (padrão: só dia atual visível)
- Confirmação ao remover linha com dados preenchidos ("Deseja remover o dia X?")
- Novo dia adicionado automaticamente à meia-noite
- Tooltips descritivos em todos os botões

### Modificado

- Dias futuros vazios não são mais exibidos (nem gerados, nem carregados do banco)
- Campo Carga estilizado igual aos campos calculados (Total1, Total2)
- Removidos placeholders "HH:MM" dos campos de horário

## [2.1.1] - 2026-06-22

### Modificado

- Períodos sem dados salvos geram linhas apenas até o dia atual (dias futuros vazios não aparecem)
- Ao carregar dados salvos, linhas de dias futuros sem dados preenchidos são filtradas
- Novo dia é adicionado automaticamente à meia-noite (se for dia útil)
- Linhas adicionadas manualmente pelo usuário são sempre preservadas

### Adicionado

- Botão "⏱ Registrar" para marcar ponto com hora atual automaticamente
- Sincronização em tempo real entre dispositivos via Firestore onSnapshot
- Gerenciamento de usuários com aprovação/rejeição de solicitações
- Botão de solicitação de acesso para novos usuários
- Polling de solicitações pendentes (badge no botão admin)
- Arquivo VERSION para controle de versão dinâmico
- Layout responsivo com header fixo e footer fixo
- Botão 🔄 para refresh no celular
- Botão 📁 para colapsar/expandir opções de exportação

### Modificado

- Layout reformulado: header fixo (usuário + título + botões), tabela com scroll central, footer com totais
- Cabeçalho da tabela agora é uma única linha com "Saída" integrado
- Summary no footer com wrap adequado no mobile

## [2.0.0] - 2026-06-17

### Adicionado

- Migração para Firebase (Auth Google + Firestore + Hosting)
- Separação em múltiplos arquivos JS (ES modules)
- Login com autenticação Google e controle de acesso por email
- Persistência no Firestore com fallback para localStorage
- Exportação/importação JSON e CSV
- Admin pode gerenciar usuários autorizados via interface

### Modificado

- Estrutura reorganizada: `public/` com HTML + CSS + JS separados
- Dados salvos como string JSON no Firestore (evita nested arrays)

## [1.0.1] - 2026-05-28

### Adicionado

- Tolerância de 6 minutos para hora-extra
- Turno 3 sob demanda (botão ³ por linha)
- Auto-formatação de horário (0600 → 06:00)
- Navegação por Enter entre campos
- Períodos configuráveis com ajuste automático de adjacentes
- Carga calculada automaticamente (|8:48 - Bônus + Comp|)
- Saída Normal e Extra calculadas com intervalo real
- Atualização em tempo real usando hora atual como saída provisória
- Exportar/importar JSON como backup
- Modal customizado para alertas e confirmações
- Seletor de ano com navegação por setas

## [1.0.0] - 2026-05-28

### Adicionado

- Versão inicial standalone (ponto.html)
- Tabela com colunas: Dia, Bônus, Carga, Comp, E1/S1, E2/S2, Total, Azure, Hora-Extra
- Cálculos automáticos baseados na planilha Ponto_2026.xlsm
- Geração automática de dias úteis por período
- Armazenamento em localStorage
- Exportação CSV

[Não publicado]: https://github.com/mgutterresdigicon/tool-ponto/compare/v2.2.3...HEAD
[2.2.3]: https://github.com/mgutterresdigicon/tool-ponto/compare/v2.2.2...v2.2.3
[2.2.2]: https://github.com/mgutterresdigicon/tool-ponto/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/mgutterresdigicon/tool-ponto/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/mgutterresdigicon/tool-ponto/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/mgutterresdigicon/tool-ponto/compare/v2.1.0...v2.1.1
[2.0.0]: https://github.com/mgutterresdigicon/tool-ponto/releases/tag/v2.0.0
[1.0.1]: https://github.com/mgutterresdigicon/tool-ponto/releases/tag/v1.0.1
[1.0.0]: https://github.com/mgutterresdigicon/tool-ponto/releases/tag/v1.0.0
