# ToolBox Web

Ferramenta web de imagens (Vite + TypeScript, roda 100% no navegador). Funções, comandos e estrutura estão no [README.md](README.md).

## GitHub: sempre sincronizado

- Repositório: https://github.com/fabianokunst/image_size, sempre na conta **fabianokunst**. Este computador tem outra conta GitHub no Credential Manager, por isso o `origin` é `https://fabianokunst@github.com/fabianokunst/image_size.git`. Não troque.
- Site: https://fabianokunst.github.io/image_size/, publicado pelo `.github/workflows/deploy.yml` a cada push na `main` (site + `toolbox-web.html` para download).
- **Commit e push estão autorizados pelo dono para este projeto: não pergunte.** Todo arquivo do projeto vai para o GitHub. Ao terminar uma alteração: `npm run check`; se terminar com "Pode enviar.", commit de tudo (mensagem em português) e `git push`. Com "Não envie", corrija os itens `[ERRO]` ou explique ao usuário. Itens `[aviso]` (GitHub/site) não impedem o envio, mas devem ser informados.
- Trabalhe direto na `main`. Nunca `push --force` nem reescreva commits já enviados.
- Se o GitHub tiver commits que não estão aqui, traga antes de editar (`git pull --rebase --autostash`).
- Depois do push, quando o workflow terminar, rode `npm run check` de novo: ele confere o deploy e compara o site no ar com o build local.

## Verificações automáticas (`.claude/settings.json`)

- Início da sessão: `scripts/check.mjs --session-start` busca o GitHub, traz commits novos quando não há trabalho local e resume git, último deploy e site no ar. Resolva os itens `[ERRO]` e informe ao usuário os itens `[aviso]`.
- Fim de cada resposta: `scripts/check.mjs --stop` impede encerrar com arquivo sem commit ou commit sem push.

## Fora do git (gerados)

`node_modules/`, `src/vendor/` (criado pelo `npm install`), `dist/` e `dist-single/` (criados pelo build e publicados no site pelo workflow), `.claude/settings.local.json` (pessoal).
