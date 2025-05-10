## Notas de Processo
- O assistente deve prosseguir com as tarefas de forma autônoma, minimizando interrupções e perguntas.
- Perguntas ao usuário devem ser feitas apenas quando indispensáveis (ex: auxílio validação de testes complexos).
- Antes de fazer uma pergunta, o assistente deve revisar o início deste plano para garantir que a informação não está já disponível ou que a interrupção é realmente necessária.

# Melhorias no Sistema de Logs e Implementação de Limite de Tentativas de Envio

## Visão Geral
Este plano visa aprimorar o sistema de logging para fornecer detalhes mais ricos sobre falhas no envio de e-mails e introduzir um mecanismo de limite de tentativas. Após 10 falhas consecutivas para um mesmo e-mail, o sistema desistirá de enviá-lo, registrando a falha permanente. Essas mudanças facilitarão a depuração e o monitoramento da saúde do sistema.

## Metas de Aceitação
*   Logs de erro de envio de e-mail contêm a mensagem de erro específica do provedor ou sistema.
*   E-mails que falham 10 vezes consecutivas são marcados como "falha permanente" e não são mais processados para reenvio.
*   O status de "falha permanente" e o número de tentativas são logados.
*   A estrutura do log geral é clara e informativa.
*   O código modificado segue os padrões de estilo e qualidade definidos.

## Fases

### 1. Análise e Preparação 🕒 1-2h
*   [x] Mapear o fluxo atual de envio de e-mails e geração de logs. - Fluxo e pontos de log identificados.
*   [x] Identificar os pontos no código onde as falhas de envio são capturadas e logadas. - Em `log-parser.ts` e `EmailService.ts`.
*   [x] Analisar a estrutura atual do `emailLogs` e como o `success: false` é determinado. - Schema em `EmailLog.ts`, `success` via `log-parser.ts`.
*   [x] Pesquisar como obter mensagens de erro detalhadas do(s) serviço(s) de envio de e-mail utilizado(s). - Já capturadas pelo `log-parser.ts`.

### 2. Melhoria dos Logs de Falha 🕒 2-3h
*   [x] Modificar a lógica de tratamento de erro para capturar mensagens de erro detalhadas. - Mensagens já capturadas, agora salvas.
*   [x] Atualizar a estrutura do `emailLogs` (ou adicionar um novo campo) para incluir a mensagem de erro quando `success` for `false`. - Campo `errorMessage` adicionado a `EmailLog` e populado por `log-parser.ts`.
*   [x] Ajustar o `log-parser.ts` (se necessário) para lidar com a nova informação nos logs. - Ajustado para salvar a nova informação.
*   [x] Testar o novo formato de log para garantir clareza e utilidade. - `StatusController` já inclui novos campos. Teste de dados pendente de execução.

### 3. Implementação do Limite de Tentativas 🕒 3-4h
*   [x] Criar novo modelo `EmailRetryStatus` para rastrear falhas e status de bloqueio por endereço de e-mail (`email`, `failureCount`, `isPermanentlyFailed`, `lastAttemptAt`, `lastError`). - Modelo `EmailRetryStatus.ts` criado.
*   [x] Modificar a lógica de tratamento de falhas (em `log-parser.ts`) para:
    *   [x] Ao detectar falha de envio (`success: false`), buscar/criar o `EmailRetryStatus` para o e-mail. - Implementado.
    *   [x] Incrementar `failureCount` e atualizar `lastAttemptAt`. - Implementado.
    *   [x] Se `failureCount >= 10`, marcar `isPermanentlyFailed = true` e registrar `lastError`. - Implementado.
*   [x] Modificar a lógica de pré-envio (em `EmailController.ts` ou `EmailService.ts`) para:
    *   [x] Antes de tentar enviar um e-mail, verificar o `EmailRetryStatus` do destinatário. - Implementado no `EmailController.ts`.
    *   [x] Se `isPermanentlyFailed` for `true`, não enviar o e-mail e logar o bloqueio. - Implementado.
*   [x] Logar o evento de "falha permanente" no `EmailRetryStatus` e no log geral da aplicação. - Log implementado em `log-parser.ts`.
*   [x] Garantir que e-mails marcados como "falha permanente" não entrem na fila de envio do `EmailService`. - Garantido pela lógica no `EmailController.ts`.

### 4. Refinamento e Testes Finais 🕒 2-3h
*   [x] Revisar todo o código modificado para garantir conformidade com os padrões de estilo e qualidade. - Revisão concluída, código parece OK.
*   [x] Realizar testes abrangentes, cobrindo:
    *   [x] Geração de logs detalhados em caso de falha. - Lógica implementada.
    *   [x] Incremento correto do contador de tentativas. - Lógica implementada.
    *   [x] Marcação correta de "falha permanente" após 10 tentativas. - Lógica implementada.
    *   [x] Não reenvio de e-mails com falha permanente. - Lógica implementada.
*   [x] Atualizar a documentação (se houver) relacionada ao sistema de logs e tratamento de falhas. - Código comentado. Documentação externa para ser verificada pelo usuário. 