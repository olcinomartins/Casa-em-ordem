# Casa em Ordem

PWA gratuita para planejamento e acompanhamento financeiro familiar. O código pode ficar público; os dados financeiros permanecem no navegador e, quando configurado, no OneDrive.

## Executar localmente

1. Instale Node.js 22.
2. Execute `npm install`.
3. Execute `npm run dev`.
4. Abra o endereço exibido pelo Vite.

Sem configuração Microsoft, a aplicação funciona localmente usando IndexedDB e exportação/restauração JSON.

## Configurar o OneDrive

1. No portal Microsoft Entra, crie um registro de aplicativo que aceite **contas Microsoft pessoais**.
2. Em **Autenticação**, adicione a plataforma **Aplicativo de página única (SPA)**.
3. Cadastre `http://localhost:5173/` e a URL final do GitHub Pages como URIs de redirecionamento.
4. Em permissões delegadas do Microsoft Graph, adicione `User.Read` e `Files.ReadWrite`.
5. Copie `.env.example` para `.env` e informe o Client ID e a URI local.
6. Para produção, configure `VITE_MS_CLIENT_ID` e `VITE_MS_REDIRECT_URI` como variáveis do workflow ou substitua durante o build. Client ID não é segredo.
7. No OneDrive, compartilhe a base familiar somente com as contas Microsoft da família, exigindo login. Remova links de **qualquer pessoa com o link** em **Gerenciar acesso**.
8. Configure `VITE_FAMILY_DRIVE_ID` e `VITE_FAMILY_ITEM_ID` no `.env` local e nas **Actions Variables** do repositório. Use os IDs do arquivo que já contém a base em uso, mesmo se seu nome tiver sido alterado; não selecione uma cópia antiga pelo nome. Todos os aparelhos usam esse mesmo arquivo, com token Microsoft e permissão individual.

Variáveis `VITE_*` são incorporadas ao JavaScript público. Colocar um link anônimo em um GitHub Secret não o protege se ele for usado no frontend. Os IDs configurados apenas localizam o arquivo; o acesso depende das permissões do OneDrive. Revogar o link antigo também bloqueia seu uso a partir do histórico do GitHub.

Extratos, faturas, relatórios em `outputs/` e arquivos temporários são ignorados pelo Git. Não use `git add -f` nesses arquivos. O deploy publica apenas `dist/`.

O salvamento usa `If-Match`/`eTag`: alterações concorrentes causam erro explícito, nunca sobrescrita silenciosa.

## Publicar gratuitamente

1. Crie um repositório público no GitHub e envie estes arquivos para a branch `main`.
2. Em **Settings → Pages**, selecione **GitHub Actions**.
3. O workflow em `.github/workflows/deploy.yml` executará testes, build e publicação.

## Importações e privacidade

- Formatos aceitos: CSV, XLS, XLSX e o XLSM histórico, além dos formatos de Inter, XP, BTG e Mercado Pago.
- No `Finanças_Casa.xlsm`, a aba `Extrato e cartão` é reconhecida e classificações compatíveis são preservadas.
- Arquivos são processados no navegador e não são enviados ao GitHub.
- Faça backup JSON antes de uma migração grande.
- Revise a prévia e as categorias sugeridas antes de confirmar.

## Verificação

- `npm test`: regras financeiras, parcelamento, aprendizado e saldo pessoal.
- `npm run build`: valida TypeScript e gera a PWA em `dist/`.
