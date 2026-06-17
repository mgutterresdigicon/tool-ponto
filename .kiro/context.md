# Controle de Ponto 2026

Ferramenta HTML para inserção e controle de horário de trabalho, baseada na planilha `Ponto_2026.xlsm`.

## Funcionalidades

- Registro de entrada/saída em até 3 turnos por dia
- Cálculos automáticos: Total por turno, Total do dia, Azure (decimal), Hora-Extra
- Saída Normal (carga + intervalo) e Saída Extra (máx 10h + intervalo)
- Tolerância de 6 minutos para hora-extra
- Carga horária ajustável com Bônus e Compensação (`Carga = |8:48 - Bônus + Comp|`)
- Períodos configuráveis (padrão: 16/mês a 15/mês seguinte)
- Seletor de ano para uso contínuo
- Auto-formatação de horário (ex: `0600` → `06:00`)
- Navegação por Enter entre campos
- Atualização em tempo real usando hora atual como saída provisória
- Geração automática de dias úteis por período

## Armazenamento

- **localStorage** — cache rápido no navegador (salvar/carregar automático por período)
- **Backup JSON** — exporta/importa todos os períodos em arquivo `.json` portátil
- **Exportar CSV** — para uso em Excel ou outras ferramentas

## Como usar

Abrir `ponto.html` no navegador:

```bash
xdg-open ponto.html
```

## Atalhos

- **Enter** em campo de horário: formata e pula para próximo campo
- **Fluxo**: Entrada1 → Saída1 → Entrada2 → Saída2 → (Entrada3 → Saída3) → Entrada1 da próxima linha

## Versão

Atual: **v1.0.1**

