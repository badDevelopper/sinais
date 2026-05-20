#!/bin/bash
# ============================================================
#  UPDATE.SH - Atualizacao segura do site via GitHub (Linux/Bash)
#  
#  Atualiza SOMENTE o codigo (HTML, CSS, JS, server, etc.)
#  PRESERVA todos os dados do usuario:
#    - site-config.json (cores, nome, redes sociais, banners)
#    - credentials.json (login admin)
#    - platforms.json (plataformas cadastradas)
#    - assets/favicon.png, profile-photo, banners uploadados
#    - assets/games/ (imagens cacheadas)
#    - scrapper/export/ (dados dos jogos com links editados)
#    - downloaded/ (arquivos baixados)
# ============================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Diretorio do projeto (onde o script esta)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}   ATUALIZADOR DO SITE (LINUX/BASH)${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# 0. Verificar se o Git esta instalado
if ! command -v git &>/dev/null; then
    echo -e "${RED}[ERRO] O comando 'git' nao foi encontrado.${NC}"
    echo -e "${YELLOW}-> Por favor, instale o Git no seu servidor Linux:${NC}"
    echo -e "   Ubuntu/Debian: sudo apt update && sudo apt install git"
    echo -e "   CentOS/RHEL:   sudo dnf install git"
    exit 1
fi

# 1. Verificar se e um repo Git
if [ ! -d ".git" ]; then
    echo -e "${RED}[ERRO] Este diretorio nao e um repositorio Git.${NC}"
    echo -e "${YELLOW}-> Execute primeiro no terminal:${NC}"
    echo -e "   git init"
    echo -e "   git remote add origin <URL_DO_SEU_REPO>"
    echo -e "   git pull origin main"
    exit 1
fi

# 1.5 Verificar se arquivos sensiveis estao sendo rastreados
echo -e "${YELLOW}[INFO] Verificando seguranca do repositorio...${NC}"
SENSITIVE_FILES=("credentials.json" "platforms.json" "site-config.json")
TRACKED_SENSITIVE=0

for file in "${SENSITIVE_FILES[@]}"; do
    if git ls-files --error-unmatch "$file" &>/dev/null; then
        echo -e "   ${YELLOW}[AVISO] $file esta sendo rastreado pelo Git!${NC}"
        echo -e "      Remova do git com: git rm --cached $file"
        TRACKED_SENSITIVE=1
    fi
done

if [ $TRACKED_SENSITIVE -eq 0 ]; then
    echo -e "   ${GREEN}[OK] Arquivos sensiveis protegidos pelo .gitignore${NC}"
fi
echo ""

# 2. Definir arquivos e pastas para preservar (baseado no .gitignore)
USER_FILES=(
    "site-config.json"
    "credentials.json"
    "platforms.json"
    "port.json"
)

USER_DIRS=(
    "assets/games"
    "assets/navbar"
    "downloaded"
    "scrapper/export"
    "scrapper/cards"
)

# Imagens uploadadas pelo usuario (padrao glob)
USER_IMAGES=(
    "assets/favicon.png"
    "assets/2favicon.png"
    "assets/profile-photo.*"
    "assets/banner-*"
)

# 3. Criar diretorio de backup temporario
BACKUP_DIR="/tmp/fp-site-backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}[BACKUP] Fazendo backup dos dados do usuario...${NC}"

# Backup dos arquivos JSON
for file in "${USER_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$BACKUP_DIR/"
        echo -e "   [OK] $file"
    fi
done

# Backup dos diretorios
for dir in "${USER_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        mkdir -p "$BACKUP_DIR/$dir"
        cp -r "$dir/." "$BACKUP_DIR/$dir/" 2>/dev/null || true
        echo -e "   [OK] $dir/"
    fi
done

# Backup das imagens de upload do usuario
mkdir -p "$BACKUP_DIR/assets"
for pattern in "${USER_IMAGES[@]}"; do
    shopt -s nullglob
    for file in $pattern; do
        if [ -f "$file" ]; then
            cp "$file" "$BACKUP_DIR/assets/"
            echo -e "   [OK] $file"
        fi
    done
    shopt -u nullglob
done

echo -e "${GREEN}[OK] Backup temporario salvo em: $BACKUP_DIR${NC}"
echo ""

# 4. Puxar atualizacoes do GitHub
echo -e "${YELLOW}[GIT] Puxando atualizacoes do GitHub...${NC}"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo -e "   Branch atual: ${CYAN}$BRANCH${NC}"

OLD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")

# Executar fetch e reset hard para a origem
git fetch origin "$BRANCH" 2>&1 | sed 's/^/   /'
git reset --hard "origin/$BRANCH" 2>&1 | sed 's/^/   /'

NEW_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    echo -e "${GREEN}[OK] Codigo ja esta atualizado! Nenhuma mudanca.${NC}"
else
    echo -e "${GREEN}[OK] Codigo atualizado com sucesso!${NC}"
    echo -e "   ${OLD_COMMIT:0:8} -> ${NEW_COMMIT:0:8}"
    echo -e "${CYAN}   Arquivos alterados:${NC}"
    git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" 2>/dev/null | sed 's/^/   📄 /' || true
fi
echo ""

# 5. Restaurar dados do usuario
echo -e "${YELLOW}[RESTAURA] Restaurando dados do usuario...${NC}"

# Restaurar arquivos JSON
for file in "${USER_FILES[@]}"; do
    if [ -f "$BACKUP_DIR/$file" ]; then
        cp "$BACKUP_DIR/$file" "$file"
        echo -e "   [OK] $file"
    fi
done

# Restaurar diretorios
for dir in "${USER_DIRS[@]}"; do
    if [ -d "$BACKUP_DIR/$dir" ]; then
        mkdir -p "$dir"
        cp -r "$BACKUP_DIR/$dir/." "$dir/" 2>/dev/null || true
        echo -e "   [OK] $dir/"
    fi
done

# Restaurar imagens de upload do usuario
if [ -d "$BACKUP_DIR/assets" ]; then
    mkdir -p "assets"
    shopt -s nullglob
    for file in "$BACKUP_DIR/assets/"*; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "assets/$filename"
            echo -e "   [OK] assets/$filename"
        fi
    done
    shopt -u nullglob
fi

echo -e "${GREEN}[OK] Dados do usuario restaurados com sucesso!${NC}"
echo ""

# 6. Reinstalar dependencias se o package.json mudou
if [ "$OLD_COMMIT" != "$NEW_COMMIT" ]; then
    PKG_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" 2>/dev/null | grep -c "package.json" || true)
    
    if [ "$PKG_CHANGED" -gt 0 ]; then
        if command -v npm &>/dev/null; then
            echo -e "${YELLOW}[INFO] package.json mudou, reinstalando dependencias...${NC}"
            npm install --production 2>&1 | tail -3 | sed 's/^/   /'
            
            if [ -f "scrapper/package.json" ]; then
                echo -e "   Instalando dependencias do scrapper..."
                cd scrapper && npm install --production 2>&1 | tail -3 | sed 's/^/   /' && cd ..
            fi
            
            echo -e "${GREEN}[OK] Dependencias atualizadas!${NC}"
        else
            echo -e "${YELLOW}[AVISO] package.json mudou, mas 'npm' nao esta instalado. Pulando instalacao de dependencias.${NC}"
        fi
    fi
fi
echo ""

# 7. Reiniciar o servidor (se PM2 estiver rodando)
if command -v pm2 &>/dev/null; then
    if pm2 describe server &>/dev/null; then
        echo -e "${YELLOW}[PM2] Reiniciando servidor...${NC}"
        pm2 restart server 2>&1 | sed 's/^/   /'
        echo -e "${GREEN}[OK] Servidor reiniciado!${NC}"
    else
        echo -e "${YELLOW}[PM2] Processo 'server' nao detectado. Iniciando...${NC}"
        pm2 start server.js --name server 2>&1 | sed 's/^/   /'
    fi
else
    echo -e "${YELLOW}[INFO] PM2 nao instalado. Para iniciar manualmente:${NC}"
    echo -e "   npm start"
fi

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}   ATUALIZACAO CONCLUIDA COM SUCESSO!${NC}"
echo -e "${CYAN}============================================${NC}"
echo -e "   Backup mantido em: $BACKUP_DIR"
echo -e "   Para remover backup: rm -rf $BACKUP_DIR"
echo ""
