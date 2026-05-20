#!/bin/bash
# ============================================================
#  UPDATE.SH — Atualização segura do site via GitHub
#  
#  Atualiza SOMENTE o código (HTML, CSS, JS, server, etc.)
#  PRESERVA todos os dados do usuário:
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

# Diretório do projeto (onde o script está)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}   🔄 ATUALIZADOR DO SITE - FP SINAIS${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# -------------------------------------------------------
# 1. VERIFICAR SE É UM REPO GIT
# -------------------------------------------------------
if [ ! -d ".git" ]; then
    echo -e "${RED}❌ Este diretório não é um repositório Git.${NC}"
    echo -e "${YELLOW}➤  Execute primeiro:${NC}"
    echo -e "   git init"
    echo -e "   git remote add origin <URL_DO_SEU_REPO>"
    echo -e "   git pull origin main"
    exit 1
fi

# -------------------------------------------------------
# 2. DEFINIR ARQUIVOS/PASTAS DO USUÁRIO (para preservar)
# -------------------------------------------------------
USER_FILES=(
    "site-config.json"
    "credentials.json"
    "platforms.json"
)

USER_DIRS=(
    "assets/games"
    "downloaded"
    "scrapper/export"
    "scrapper/cards"
)

# Imagens uploadadas pelo usuário (padrão glob)
USER_IMAGES=(
    "assets/favicon.png"
    "assets/2favicon.png"
    "assets/profile-photo.*"
    "assets/banner-*"
)

# -------------------------------------------------------
# 3. CRIAR BACKUP DOS DADOS DO USUÁRIO
# -------------------------------------------------------
BACKUP_DIR="/tmp/fp-site-backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}📦 Fazendo backup dos dados do usuário...${NC}"

# Backup dos arquivos JSON do usuário
for file in "${USER_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$BACKUP_DIR/"
        echo -e "   ✅ $file"
    fi
done

# Backup das pastas do usuário
for dir in "${USER_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        mkdir -p "$BACKUP_DIR/$dir"
        cp -r "$dir/." "$BACKUP_DIR/$dir/" 2>/dev/null || true
        echo -e "   ✅ $dir/"
    fi
done

# Backup das imagens uploadadas
mkdir -p "$BACKUP_DIR/assets"
for pattern in "${USER_IMAGES[@]}"; do
    for file in $pattern; do
        if [ -f "$file" ]; then
            cp "$file" "$BACKUP_DIR/assets/"
            echo -e "   ✅ $file"
        fi
    done
done

echo -e "${GREEN}✅ Backup salvo em: $BACKUP_DIR${NC}"
echo ""

# -------------------------------------------------------
# 4. PUXAR ATUALIZAÇÕES DO GITHUB
# -------------------------------------------------------
echo -e "${YELLOW}⬇️  Puxando atualizações do GitHub...${NC}"

# Detectar branch principal
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo -e "   Branch: ${CYAN}$BRANCH${NC}"

# Guardar commit atual para comparação
OLD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")

# Fazer o pull (force reset para garantir código limpo)
git fetch origin "$BRANCH" 2>&1 | sed 's/^/   /'
git reset --hard "origin/$BRANCH" 2>&1 | sed 's/^/   /'

NEW_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    echo -e "${GREEN}✅ Código já está atualizado! Nenhuma mudança.${NC}"
else
    echo -e "${GREEN}✅ Código atualizado!${NC}"
    echo -e "   ${OLD_COMMIT:0:8} → ${NEW_COMMIT:0:8}"
    
    # Mostrar arquivos alterados
    echo -e "${CYAN}   Arquivos alterados:${NC}"
    git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" 2>/dev/null | sed 's/^/   📄 /' || true
fi
echo ""

# -------------------------------------------------------
# 5. RESTAURAR DADOS DO USUÁRIO
# -------------------------------------------------------
echo -e "${YELLOW}🔄 Restaurando dados do usuário...${NC}"

# Restaurar arquivos JSON
for file in "${USER_FILES[@]}"; do
    if [ -f "$BACKUP_DIR/$file" ]; then
        cp "$BACKUP_DIR/$file" "$file"
        echo -e "   ✅ $file"
    fi
done

# Restaurar pastas
for dir in "${USER_DIRS[@]}"; do
    if [ -d "$BACKUP_DIR/$dir" ]; then
        mkdir -p "$dir"
        cp -r "$BACKUP_DIR/$dir/." "$dir/" 2>/dev/null || true
        echo -e "   ✅ $dir/"
    fi
done

# Restaurar imagens uploadadas
for file in "$BACKUP_DIR/assets/"*; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        cp "$file" "assets/$filename"
        echo -e "   ✅ assets/$filename"
    fi
done

echo -e "${GREEN}✅ Dados do usuário restaurados!${NC}"
echo ""

# -------------------------------------------------------
# 6. REINSTALAR DEPENDÊNCIAS (se package.json mudou)
# -------------------------------------------------------
if [ "$OLD_COMMIT" != "$NEW_COMMIT" ]; then
    PKG_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" 2>/dev/null | grep -c "package.json" || true)
    
    if [ "$PKG_CHANGED" -gt 0 ]; then
        echo -e "${YELLOW}📦 package.json mudou, reinstalando dependências...${NC}"
        npm install --production 2>&1 | tail -3 | sed 's/^/   /'
        
        # Scrapper dependencies
        if [ -f "scrapper/package.json" ]; then
            echo -e "   Instalando deps do scrapper..."
            cd scrapper && npm install --production 2>&1 | tail -3 | sed 's/^/   /' && cd ..
        fi
        
        echo -e "${GREEN}✅ Dependências instaladas!${NC}"
    fi
fi
echo ""

# -------------------------------------------------------
# 7. REINICIAR O SERVIDOR (se estiver rodando com PM2)
# -------------------------------------------------------
if command -v pm2 &> /dev/null; then
    PM2_PROCESS=$(pm2 list 2>/dev/null | grep -c "server" || true)
    if [ "$PM2_PROCESS" -gt 0 ]; then
        echo -e "${YELLOW}🔄 Reiniciando servidor (PM2)...${NC}"
        pm2 restart server 2>&1 | sed 's/^/   /'
        echo -e "${GREEN}✅ Servidor reiniciado!${NC}"
    else
        echo -e "${YELLOW}💡 PM2 detectado mas nenhum processo 'server' rodando.${NC}"
        echo -e "   Para iniciar: pm2 start server.js --name server"
    fi
else
    echo -e "${YELLOW}💡 Para reiniciar o servidor manualmente:${NC}"
    echo -e "   npm start"
fi

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}   ✅ ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!${NC}"
echo -e "${CYAN}============================================${NC}"
echo -e "   Backup mantido em: $BACKUP_DIR"
echo -e "   Para remover backup: rm -rf $BACKUP_DIR"
echo ""
