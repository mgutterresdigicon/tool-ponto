# Steering - Controle de Ponto

## Regras de Desenvolvimento

- Arquivo único: `ponto.html` (HTML + CSS + JS inline)
- Sem dependências externas (funciona offline)
- Tema escuro com cores: fundo #1a1a2e, destaque #00d4ff
- Usar modal customizado em vez de alert/prompt/confirm nativos
- Tolerância de hora-extra: 6 minutos (diferença < 6min = 0)
- Carga padrão: 08:48/dia
- Período padrão: dia 16 ao dia 15 do mês seguinte
- Máximo de horas extras por dia: 10h (para cálculo de Saída Extra)
- Intervalo de almoço: calculado como Entrada2 - Saída1 (padrão 1h se não preenchido)

## Versionamento

- Formato: vMAJOR.MINOR.PATCH
- Incrementar PATCH para correções
- Incrementar MINOR para novas funcionalidades
- Incrementar MAJOR para mudanças incompatíveis
- Atualizar versão no rodapé do HTML e no README a cada alteração

## Estrutura de Dados (localStorage)

- Chave: `ponto{ANO}_{MES}` (ex: `ponto2026_05`)
- Valor: array de arrays `[dia, bonus, carga, comp, e1, s1, e2, s2, e3?, s3?]`
- Config de período: `ponto_periodo_{MES}` → `{label, ini, fim}`
