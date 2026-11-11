# Backup externo criptografado — Almoxarifado (Central Serra Azul)

## Estado
Workflow implantado em `.github/workflows/backup-almoxarifado.yml`.
**Não há backup automático efetivo até que os dois secrets sejam cadastrados, o primeiro workflow termine com sucesso e um teste de restauração seja aprovado.**

## Como ativar, sem enviar senhas para o chat

1. No Supabase da **Central Serra Azul** (projeto `docydxjxaofivxdughar`, NÃO o antigo projeto separado do Almoxarifado), abrir **Connect > Connection string > Session pooler**. Copiar a URL de conexão PostgreSQL com a senha do banco. A URL deve ser guardada somente como secret do GitHub. Preferir o pooler de sessão para IPv4. Ativar SSL.
2. Abrir `https://github.com/ngcyuri/serra-azul-bf/settings/secrets/actions` e criar:
   - `ALMOX_DATABASE_URL`: URL completa PostgreSQL do **banco da Central**.
   - `ALMOX_BACKUP_PASSPHRASE`: frase aleatória forte (pelo menos 24 caracteres) criada por você, guardada também em gerenciador de senhas **fora do GitHub**. Perder essa frase impede abrir os backups.
3. Abrir `https://github.com/ngcyuri/serra-azul-bf/actions/workflows/backup-almoxarifado.yml`, clicar em **Run workflow**. Verificar conclusão verde e presença de um artefato com nome `almoxarifado-AAAAMMDDTHHMMSSZ`.
4. Baixar um artefato, conferir que contém **apenas** arquivo `.dump.gpg`, e testar descriptografia e restauração **em banco de homologação isolado**. Nunca restaurar diretamente sobre produção sem plano de contingência.

## Agendamento e alcance
- Execução diária às **03:35 UTC**, equivalente a **23:35 do dia anterior em Mato Grosso (UTC−4)**. O agendamento do GitHub pode atrasar ou ser ignorado em condições de indisponibilidade/limites; monitorar execuções.
- Backup das tabelas `public.alm_*` (inclui produtos, patrimônios, notas, movimentações, catálogo, equivalências e perfis do Almoxarifado).
- Armazena dump PostgreSQL custom em **artefatos criptografados do GitHub Actions** (fora do Supabase).
- **Retenção solicitada: 90 dias**, sujeita aos limites/configuração da conta/repositório. Backups expiram; não são arquivo permanente.
- Algoritmo GnuPG AES-256; o dump é validado com `pg_restore --list`, depois a cópia criptografada é descriptografada temporariamente no runner para comparação SHA-256 antes de enviar.
- O dump inclui esquema e dados das tabelas `alm_*`, mas **não** é backup completo do Supabase: não inclui `auth.users`, projetos de Storage, arquivos de Storage ou demais tabelas da Central. Para uma recuperação completa após desastre, será necessário fazer também backup dos usuários/infraestrutura do projeto.
- Como o repo da Serra Azul é público, o **arquivo precisa permanecer criptografado**. Nunca publicar dumps em texto, URLs de banco, chaves ou a frase de criptografia em issues, commits ou logs.
- GitHub Actions pode desativar agendamentos em repositórios públicos após longos períodos sem atividade. Monitorar regularmente a rotina.
- Manter também exports manuais e fazer cópia em outra localização protegida sob responsabilidade da empresa.

## Conferir e recuperar sem tocar na produção

No Linux (ou Windows com WSL e GnuPG instalado), após extrair o artefato, usar:
```bash
# Vai solicitar a frase secreta; não a escreva em terminal compartilhado.
gpg --output almoxarifado.dump --decrypt almoxarifado-YYYYMMDDTHHMMSSZ.dump.gpg
pg_restore --list almoxarifado.dump
```
**Teste de restauração em banco de homologação, nunca na Central principal:**
- Criar um banco PostgreSQL 17 isolado.
- Planejar a presença das identidades de `auth.users` referenciadas por `alm_notas` e `alm_acessos`. Sem elas, algumas constraints podem impedir a restauração.
- Testar `pg_restore` e comparar contagens por tabela, chaves, dados de notas e saldos ao backup. O teste pode exigir preparar previamente esquema/roles/autenticação por causa das dependências Supabase.
- Documentar data do teste, inconsistências e passos de recuperação.

## Monitoramento
Acompanhar execução em `Actions > Backup diario criptografado - Almoxarifado`. Uma execução verde significa **exportação e armazenamento criptografado concluídos**, não uma restauração testada. Em caso de falha, investigar e rodar manualmente após corrigir o problema. Nunca assumir que o agendamento executou sem inspecionar o histórico.

## Observação de segurança já existente na Central
A tabela `public.produtos_bomfuturo` tem RLS desativado (fora do escopo deste workflow). Não modificar sem avaliar as políticas usadas pelos outros módulos.
