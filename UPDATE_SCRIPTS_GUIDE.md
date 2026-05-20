# 📦 Guia dos Scripts de Atualização - Update.ps1 e Update.sh

## 🎯 O que Faz

Os scripts de atualização (`update.ps1` para Windows e `update.sh` para Linux/Mac) fazem **pull automático do código do GitHub** enquanto **preservam completamente seus dados locais** (credenciais, configurações, fotos uploadadas, etc).

---

## ✅ O que É PRESERVADO (Não é alterado)

### 📄 Configurações e Credenciais
- **site-config.json** - Cores, nome do site, redes sociais, banners
- **credentials.json** - Login admin (⚠️ CRÍTICO - nunca commitar no Git!)
- **platforms.json** - Plataformas de jogos cadastradas

### 🖼️ Imagens e Uploads
- **assets/favicon.png** - Favicon customizado
- **assets/2favicon.png** - Favicon alternativo
- **assets/profile-photo.*** - Foto de perfil
- **assets/banner-**** - Banners customizados
- **assets/games/** - Imagens de jogos cacheadas
- **assets/navbar/** - Ícones e assets da navbar

### 💾 Dados do Sistema
- **downloaded/** - Arquivos baixados
- **scrapper/export/** - Dados de jogos com links editados
- **scrapper/cards/** - Dados de cards

---

## 🔄 O que É ATUALIZADO

- ✏️ HTML files (*.html)
- 🎨 CSS files (styles/)
- 🔧 JavaScript files
- 🖥️ server.js
- 📦 package.json (dependências)
- 📋 Configurações e templates

---

## 🚀 Como Usar

### Windows (PowerShell)
```powershell
# Dê permissão ao script (primeira vez)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Execute o script
.\update.ps1
```

### Linux/Mac (Bash)
```bash
# Dê permissão de execução
chmod +x update.sh

# Execute
./update.sh
```

---

## 🔒 Verificações de Segurança

Ambos os scripts fazem uma **verificação automática** para avisar se arquivos sensíveis estão sendo rastreados pelo Git:

```
🔒 Verificando segurança do repositório...
   ⚠️  AVISO: credentials.json está sendo rastreado pelo Git!
   Remova com: git rm --cached credentials.json
```

**Se isto aparecer, execute:**
```bash
git rm --cached credentials.json
git rm --cached platforms.json
git commit -m "Remove sensitive files from git tracking"
```

---

## 🛡️ Processo de Atualização

1. **🔍 Verificação** - Valida se é um repositório Git e se credenciais estão seguras
2. **💾 Backup** - Cria backup de TODOS os dados do usuário em `/tmp/` (temp)
3. **⬇️ Pull** - Faz `git reset --hard origin/main` para puxar código atualizado
4. **🔄 Restauração** - Restaura todos os dados do usuário
5. **📦 Dependências** - Reinstala npm packages se `package.json` mudou
6. **🔄 Reinício** - Reinicia o servidor (PM2) se estiver rodando

---

## 📊 Estrutura de Backup

Cada atualização cria um backup temporário:

**Windows:** `C:\Users\{USERNAME}\AppData\Local\Temp\fp-site-backup-YYYYMMDD_HHMMSS\`

**Linux/Mac:** `/tmp/fp-site-backup-YYYYMMDD_HHMMSS/`

Você pode manter ou deletar após confirmar que tudo funcionou corretamente.

---

## ❓ Troubleshooting

### "Este diretório não é um repositório Git"
```bash
git init
git remote add origin https://github.com/badDevelopper/sinais.git
git pull origin main
```

### Script não executa no Windows
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Permissão negada no Linux/Mac
```bash
chmod +x update.sh
```

### Mudanças perdidas!
Não se preocupe! Há backup em:
- **Windows:** Verifique a pasta temp do Windows (início do script mostra o caminho)
- **Linux/Mac:** `/tmp/fp-site-backup-*/`

---

## 📋 Checklist Antes de Usar em Produção

- [ ] Teste primeiro em um servidor de teste/staging
- [ ] Certifique-se que `credentials.json` está no `.gitignore`
- [ ] Certifique-se que `platforms.json` está no `.gitignore`
- [ ] Verifique que o servidor está em git: `git status`
- [ ] Faça um backup manual do seu servidor antes da primeira execução
- [ ] Se usar PM2, certifique que `server` está nomeado corretamente: `pm2 list`

---

## 🎯 Resumo

| Operação | Resultado |
|----------|-----------|
| `./update.sh` | ✅ Código atualizado, dados preservados |
| Credenciais | ✅ Sempre preservadas |
| Fotos | ✅ Sempre preservadas |
| Configurações | ✅ Sempre preservadas |
| HTML/CSS/JS | ✅ Sempre atualizados |
| node_modules | ✅ Reinstalados se package.json mudou |

**TL;DR:** Execute o script e tudo será atualizado automaticamente, com seus dados protegidos! 🚀
