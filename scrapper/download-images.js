/**
 * download-images.js
 * Baixa todas as imagens (banners + ícones) dos exports para pasta local.
 * 
 * Uso: node download-images.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const EXPORT_DIR = path.join(__dirname, 'export');
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'games');

// Mapeamento: pasta do export -> pastas de imagem locais
const PROVIDER_MAP = {
    pg: { banner: 'games-pg', icon: 'games-pg-icon' },
    pragmatic: { banner: 'capa-games-pp', icon: 'icons-pp' },
    'wg-games': { banner: 'games-wg', icon: 'games-wg' },  // banner e icon na mesma pasta
    'tada-games': { banner: 'games-tada', icon: 'games-tada' },  // banner e icon na mesma pasta
};

const CONCURRENCY = 5; // downloads simultâneos
const TIMEOUT = 15000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Baixa URL para arquivo local. Retorna true se ok.
 */
function downloadFile(url, destPath) {
    return new Promise((resolve) => {
        if (!url || url === 'null') return resolve(false);

        // Se o arquivo já existe e é > 500 bytes, pula
        if (fs.existsSync(destPath)) {
            const stat = fs.statSync(destPath);
            if (stat.size > 500) return resolve(true);
        }

        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, {
            timeout: TIMEOUT,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/*,*/*',
            }
        }, (res) => {
            // Segue redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadFile(res.headers.location, destPath).then(resolve);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(false);
            }

            const dir = path.dirname(destPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                const stat = fs.statSync(destPath);
                if (stat.size < 500) {
                    fs.unlinkSync(destPath);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

/**
 * Extrai extensão da URL ou usa fallback
 */
function getExt(url) {
    if (!url) return '.webp';
    const u = new URL(url);
    const pathname = u.pathname;
    const ext = path.extname(pathname);
    if (ext && ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(ext.toLowerCase())) {
        return ext.toLowerCase();
    }
    return '.webp';
}

/**
 * Gera nome do arquivo local baseado no cardNo + extensão original
 */
function localFileName(cardNo, url) {
    return `${cardNo}${getExt(url)}`;
}

async function processQueue(queue) {
    let ok = 0, fail = 0;
    const total = queue.length;

    // Process in batches
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
        const batch = queue.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(({ url, dest }) => downloadFile(url, dest)));
        results.forEach(r => r ? ok++ : fail++);
        process.stdout.write(`\r   ${ok + fail}/${total} (✅ ${ok} | ❌ ${fail})`);
    }
    console.log('');
    return { ok, fail };
}

async function main() {
    console.log('🖼️  Download de imagens dos exports\n');

    let totalOk = 0, totalFail = 0;

    for (const [folder, mapping] of Object.entries(PROVIDER_MAP)) {
        const allFile = path.join(EXPORT_DIR, folder, 'all.json');
        if (!fs.existsSync(allFile)) {
            console.log(`⚠️  ${folder}/all.json não encontrado, pulando...`);
            continue;
        }

        const games = JSON.parse(fs.readFileSync(allFile, 'utf8'));
        console.log(`\n📦 ${folder}: ${games.length} jogos`);

        const bannerDir = path.join(ASSETS_DIR, mapping.banner);
        const iconDir = path.join(ASSETS_DIR, mapping.icon);

        if (!fs.existsSync(bannerDir)) fs.mkdirSync(bannerDir, { recursive: true });
        if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });

        const queue = [];

        for (const g of games) {
            // Banner
            if (g.image) {
                const bannerName = localFileName(g.cardNo, g.image);
                queue.push({ url: g.image, dest: path.join(bannerDir, bannerName) });
            }

            // Ícone (só se for diferente do banner ou pasta diferente)
            if (g.icon && (g.icon !== g.image || mapping.icon !== mapping.banner)) {
                const iconName = localFileName(g.cardNo, g.icon);
                queue.push({ url: g.icon, dest: path.join(iconDir, iconName) });
            }
        }

        console.log(`   📥 ${queue.length} imagens para baixar...`);
        const { ok, fail } = await processQueue(queue);
        totalOk += ok;
        totalFail += fail;
    }

    console.log(`\n🎉 Finalizado! ✅ ${totalOk} baixadas | ❌ ${totalFail} falharam`);
    console.log(`   Pasta: ${ASSETS_DIR}`);
}

main().catch(console.error);
