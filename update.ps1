# ============================================================
#  UPDATE.PS1 - Atualizacao segura do site via GitHub (PowerShell)
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

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   ATUALIZADOR DO SITE (WINDOWS/POWERSHELL)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar se e um repo Git
if (-not (Test-Path ".git")) {
    Write-Host "[ERRO] Este diretorio nao e um repositorio Git." -ForegroundColor Red
    Write-Host "-> Execute primeiro no terminal:" -ForegroundColor Yellow
    Write-Host "   git init"
    Write-Host "   git remote add origin <URL_DO_SEU_REPO>"
    Write-Host "   git pull origin main"
    exit
}

# 1.5 Verificar se arquivos sensiveis estao sendo rastreados
Write-Host "[INFO] Verificando seguranca do repositorio..." -ForegroundColor Yellow

$SensitiveFiles = @("credentials.json", "platforms.json", "site-config.json")
$TrackedSensitiveFiles = @()

foreach ($file in $SensitiveFiles) {
    $isTracked = & "C:\Program Files\Git\cmd\git.exe" ls-files --error-unmatch $file 2>$null
    if ($isTracked) {
        $TrackedSensitiveFiles += $file
        Write-Host "   [AVISO] $file esta sendo rastreado pelo Git!" -ForegroundColor Yellow
        Write-Host "      Remova do git com: git rm --cached $file" -ForegroundColor DarkYellow
    }
}

if ($TrackedSensitiveFiles.Count -eq 0) {
    Write-Host "   [OK] Arquivos sensiveis protegidos pelo .gitignore" -ForegroundColor Green
}
Write-Host ""

# 2. Definir arquivos e pastas para preservar (baseado no .gitignore)
$UserFiles = @(
    "site-config.json",
    "credentials.json",
    "platforms.json",
    "port.json"
)

$UserDirs = @(
    "assets/games",
    "assets/navbar",
    "downloaded",
    "scrapper/export",
    "scrapper/cards"
)

# Padroes de imagens do usuario
$UserImagePatterns = @(
    "assets/profile-photo*",
    "assets/banner-*",
    "assets/favicon.png",
    "assets/2favicon.png"
)

# 3. Criar diretorio de backup temporario
$BackupDir = Join-Path $PSScriptRoot ".update_backup_tmp"
if (Test-Path $BackupDir) { Remove-Item -Path $BackupDir -Recurse -Force | Out-Null }
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

Write-Host "[BACKUP] Fazendo backup dos dados do usuario..." -ForegroundColor Yellow

# Backup dos arquivos JSON
foreach ($file in $UserFiles) {
    if (Test-Path $file) {
        Copy-Item -Path $file -Destination $BackupDir -Force
        Write-Host "   [OK] $file"
    }
}

# Backup dos diretorios
foreach ($dir in $UserDirs) {
    if (Test-Path $dir) {
        $dest = Join-Path $BackupDir $dir
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item -Path "$dir\*" -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   [OK] $dir/"
    }
}

# Backup das imagens de upload do usuario (usando padroes glob)
if (Test-Path "assets") {
    $assetsDest = Join-Path $BackupDir "assets"
    New-Item -ItemType Directory -Path $assetsDest -Force | Out-Null
    
    foreach ($pattern in $UserImagePatterns) {
        Get-Item -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $assetsDest -Force
            Write-Host "   [OK] $($_.Name)"
        }
    }
}

Write-Host "[OK] Backup temporario salvo em: $BackupDir" -ForegroundColor Green
Write-Host ""

# 4. Puxar atualizacoes do GitHub
Write-Host "[GIT] Puxando atualizacoes do GitHub..." -ForegroundColor Yellow

# Obter branch atual
$Branch = (& "C:\Program Files\Git\cmd\git.exe" rev-parse --abbrev-ref HEAD).Trim()
Write-Host "   Branch atual: $Branch" -ForegroundColor Cyan

# Guardar commit antigo
$OldCommit = (& "C:\Program Files\Git\cmd\git.exe" rev-parse HEAD).Trim()

# Executar fetch e reset hard para a origem
& "C:\Program Files\Git\cmd\git.exe" fetch origin $Branch
& "C:\Program Files\Git\cmd\git.exe" reset --hard "origin/$Branch"

$NewCommit = (& "C:\Program Files\Git\cmd\git.exe" rev-parse HEAD).Trim()

if ($OldCommit -eq $NewCommit) {
    Write-Host "[OK] Codigo ja esta atualizado! Nenhuma mudanca." -ForegroundColor Green
} else {
    Write-Host "[OK] Codigo atualizado com sucesso!" -ForegroundColor Green
    Write-Host "   $($OldCommit.Substring(0,8)) -> $($NewCommit.Substring(0,8))"
    Write-Host "   Arquivos alterados:" -ForegroundColor Cyan
    & "C:\Program Files\Git\cmd\git.exe" diff --name-only $OldCommit $NewCommit
}
Write-Host ""

# 5. Restaurar dados do usuario
Write-Host "[RESTAURA] Restaurando dados do usuario..." -ForegroundColor Yellow

# Restaurar arquivos JSON
foreach ($file in $UserFiles) {
    $backupFile = Join-Path $BackupDir $file
    if (Test-Path $backupFile) {
        Copy-Item -Path $backupFile -Destination "." -Force
        Write-Host "   [OK] $file"
    }
}

# Restaurar diretorios
foreach ($dir in $UserDirs) {
    $backupSubDir = Join-Path $BackupDir $dir
    if (Test-Path $backupSubDir) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Copy-Item -Path "$backupSubDir\*" -Destination $dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   [OK] $dir/"
    }
}

# Restaurar imagens de upload do usuario
$backupAssets = Join-Path $BackupDir "assets"
if (Test-Path $backupAssets) {
    if (-not (Test-Path "assets")) {
        New-Item -ItemType Directory -Path "assets" -Force | Out-Null
    }
    Get-ChildItem -Path $backupAssets -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination "assets" -Force
        Write-Host "   [OK] assets/$($_.Name)"
    }
}

Write-Host "[OK] Dados do usuario restaurados com sucesso!" -ForegroundColor Green
if (Test-Path $BackupDir) { Remove-Item -Path $BackupDir -Recurse -Force | Out-Null }
Write-Host ""

# 6. Reinstalar dependencias se o package.json mudou
if ($OldCommit -ne $NewCommit) {
    $changedFiles = & "C:\Program Files\Git\cmd\git.exe" diff --name-only $OldCommit $NewCommit
    if ($changedFiles -contains "package.json") {
        Write-Host "[INFO] package.json mudou, reinstalando dependencias..." -ForegroundColor Yellow
        npm install --production
        Write-Host "   [OK] Dependencias de producao atualizadas."
    }
    
    if ($changedFiles -contains "scrapper/package.json" -and (Test-Path "scrapper")) {
        Write-Host "[INFO] scrapper/package.json mudou, reinstalando dependencias do scrapper..." -ForegroundColor Yellow
        Push-Location scrapper
        npm install --production
        Pop-Location
        Write-Host "   [OK] Dependencias do scrapper atualizadas."
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   ATUALIZACAO CONCLUIDA COM SUCESSO!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
