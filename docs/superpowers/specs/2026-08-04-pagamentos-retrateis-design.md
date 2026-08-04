# Grupos retráteis na Central de pagamentos

## Objetivo

Organizar os pagamentos por proximidade do vencimento sem exibir todos os itens ao abrir a Central.

## Comportamento

- Os grupos serão: `Vencidos`, `Vence hoje`, `Vence nos próximos 7 dias`, `Vence este mês` e `Vence nos próximos meses`.
- Somente grupos com pagamentos serão exibidos.
- Cada cabeçalho mostrará nome, quantidade de pagamentos e total planejado.
- Todos os grupos iniciarão fechados sempre que a Central de pagamentos for aberta.
- Cada grupo poderá ser aberto e fechado independentemente.
- Dentro do grupo, os pagamentos continuarão ordenados pela próxima data de vencimento e manterão todas as ações atuais.

## Validação

Testar a ordem e os totais dos grupos, executar todos os testes existentes e gerar a compilação de produção.
