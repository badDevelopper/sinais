# ============================================================
#  UPDATE.PS1 — Atualização segura do site via GitHub (PowerShell)
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

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   🔄 ATUALIZADOR DO SITE (WINDOWS/POWERSHELL)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar se é um repo Git
if (-not (Test-Path ".git")) {
    Write-Host "❌ Este diretório não é um repositório Git." -ForegroundColor Red
    Write-Host "➤ Execute primeiro no terminal:" -ForegroundColor Yellow
    Write-Host "   git init"
    Write-Host "   git remote add origin <URL_DO_SEU_REPO>"
    Write-Host "   git pull origin main"
    exit
}

# 2. Definir arquivos e pastas para preservar
$UserFiles = @(
    "site-config.json",
    "credentials.json",
    "platforms.json"
)

$UserDirs = @(
    "assets/games",
    "downloaded",
    "scrapper/export",
    "scrapper/cards"
)

# 3. Criar diretório de backup temporário
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $env:TEMP "fp-site-backup-$Timestamp"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

Write-Host "📦 Fazendo backup dos dados do usuário..." -ForegroundColor Yellow

# Backup dos arquivos JSON
foreach ($file in $UserFiles) {
    if (Test-Path $file) {
        Copy-Item -Path $file -Destination $BackupDir -Force
        Write-Host "   ✅ $file"
    }
}

# Backup dos diretórios
foreach ($dir in $UserDirs) {
    if (Test-Path $dir) {
        $dest = Join-Path $BackupDir $dir
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item -Path "$dir\*" -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   ✅ $dir/"
    }
}

# Backup das imagens de upload do usuário na pasta assets
if (Test-Path "assets") {
    $assetsDest = Join-Path $BackupDir "assets"
    New-Item -ItemType Directory -Path $assetsDest -Force | Out-Null
    
    # Copiar favicons, profile photo e banners customizados
    Get-ChildItem -Path "assets" -Filter "*favicon.png" | Copy-Item -Destination $assetsDest -Force
    Get-ChildItem -Path "assets" -Filter "profile-photo.*" | Copy-Item -Destination $assetsDest -Force
    Get-ChildItem -Path "assets" -Filter "banner-*" | Copy-Item -Destination $assetsDest -Force
    Write-Host "   ✅ Imagens personalizadas (profile, banners, favicon)"
}

Write-Host "✅ Backup temporário salvo em: $BackupDir" -ForegroundColor Green
Write-Host ""

# 4. Puxar atualizações do GitHub
Write-Host "⬇️ Puxando atualizações do GitHub..." -ForegroundColor Yellow

# Obter branch atual
$Branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "   Branch atual: $Branch" -ForegroundColor Cyan

# Guardar commit antigo
$OldCommit = (git rev-parse HEAD).Trim()

# Executar fetch e reset hard para a origem
git fetch origin $Branch
git reset --hard "origin/$Branch"

$NewCommit = (git rev-parse HEAD).Trim()

if ($OldCommit -eq $NewCommit) {
    Write-Host "✅ Código já está atualizado! Nenhuma mudança." -ForegroundColor Green
} else {
    Write-Host "✅ Código atualizado com sucesso!" -ForegroundColor Green
    Write-Host "   $($OldCommit.Substring(0,8)) → $($NewCommit.Substring(0,8))"
    Write-Host "   Arquivos alterados:" -ForegroundColor Cyan
    git diff --name-only $OldCommit $NewCommit
}
Write-Host ""

# 5. Restaurar dados do usuário
Write-Host "🔄 Restaurando dados do usuário..." -ForegroundColor Yellow

# Restaurar arquivos JSON
foreach ($file in $UserFiles) {
    $backupFile = Join-Path $BackupDir $file
    if (Test-Path $backupFile) {
        Copy-Item -Path $backupFile -Destination "." -Force
        Write-Host "   ✅ $file"
    }
}

# Restaurar diretórios
foreach ($dir in $UserDirs) {
    $backupSubDir = Join-Path $BackupDir $dir
    if (Test-Path $backupSubDir) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Copy-Item -Path "$backupSubDir\*" -Destination $dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   ✅ $dir/"
    }
}

# Restaurar imagens de upload do usuário na pasta assets
$backupAssets = Join-Path $BackupDir "assets"
if (Test-Path $backupAssets) {
    Get-ChildItem -Path $backupAssets | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination "assets" -Force
        Write-Host "   ✅ assets/$($_.Name)"
    }
}

Write-Host "✅ Dados do usuário restaurados com sucesso!" -ForegroundColor Green
Write-Host ""

# 6. Reinstalar dependências se o package.json mudou
if ($OldCommit -ne $NewCommit) {
    $changedFiles = git diff --name-only $OldCommit $NewCommit
    if ($changedFiles -contains "package.json") {
        Write-Host "📦 package.json mudou, reinstalando dependências..." -ForegroundColor Yellow
        npm install --production
        Write-Host "   ✅ Dependências de produção atualizadas."
    }
    
    if ($changedFiles -contains "scrapper/package.json" -and (Test-Path "scrapper")) {
        Write-Host "📦 scrapper/package.json mudou, reinstalando dependências do scrapper..." -ForegroundColor Yellow
        Push-Location scrapper
        npm install --production
        Pop-Location
        Write-Host "   ✅ Dependências do scrapper atualizadas."
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   ✅ ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Backup temporário mantido em: $BackupDir"
Write-Host ""
