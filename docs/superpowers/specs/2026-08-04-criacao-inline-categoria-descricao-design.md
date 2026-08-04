# Criação inline de categoria e descrição

## Objetivo

Permitir criar categorias e descrições em qualquer formulário que exija sua seleção, sem abandonar o cadastro atual.

## Comportamento

- Todo seletor de categoria terá a opção `Criar categoria agora`.
- Ao selecionar essa opção, o formulário exibirá o campo `Nome da nova categoria` logo abaixo.
- Todo seletor de descrição terá a opção `Criar descrição agora` quando houver uma categoria selecionada ou sendo criada.
- Ao selecionar essa opção, o formulário exibirá o campo `Nome da nova descrição` logo abaixo.
- A descrição criada será vinculada à categoria selecionada ou à categoria criada no mesmo envio.
- Categoria e descrição serão persistidas junto com o cadastro principal. Fechar ou cancelar o formulário não criará registros incompletos.
- Se já existir uma categoria ou descrição com o mesmo nome normalizado, o aplicativo reutilizará o registro existente.
- O tipo da categoria será inferido pelo contexto: saída e pagamento criam categoria de despesa; entrada cria categoria de receita; planejamento usa a natureza escolhida.

## Escopo

O comportamento será aplicado a:

- lançamento manual de entrada ou saída;
- pagamento novo e edição de pagamento;
- orçamento, provisão e meta;
- revisão de lançamento por IA;
- revisão e classificação de transações;
- demais formulários que apresentem seleção de categoria ou descrição.

## Arquitetura

Será criado um utilitário único para resolver categoria e descrição no momento da gravação. Ele receberá a base familiar, os valores selecionados, os nomes novos e a natureza esperada. O retorno será a categoria e a descrição definitivas que o cadastro principal deve usar.

Os componentes de formulário usarão o mesmo valor reservado (`__new__`) para abrir os campos inline. A implementação preservará os identificadores e a propriedade interna `subcategory` por compatibilidade com a base existente; somente a interface continuará usando o termo `Descrição`.

## Validação e erros

- `Criar categoria agora` exige nome da categoria.
- `Criar descrição agora` exige nome da descrição e uma categoria válida.
- Categoria de receita não poderá ser reutilizada silenciosamente em cadastro de despesa, nem o inverso.
- O cadastro principal não será salvo parcialmente se a resolução falhar.

## Testes

- cria categoria e a utiliza no mesmo lançamento;
- cria categoria e descrição juntas;
- cria descrição em categoria existente;
- reutiliza nomes já existentes após normalização;
- infere corretamente despesa ou receita;
- não cria dados quando o formulário é cancelado;
- mantém compatibilidade com categorias e descrições existentes.
