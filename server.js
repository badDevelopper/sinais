const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
// Load port from process.env.PORT, port.json, site-config.json, or default to 3303
let PORT = process.env.PORT;
if (!PORT) {
  try {
    const portPath = path.join(__dirname, 'port.json');
    if (fs.existsSync(portPath)) {
      const portCfg = JSON.parse(fs.readFileSync(portPath, 'utf8'));
      if (portCfg.port) {
        PORT = portCfg.port;
      }
    }
  } catch (e) {
    console.error('Error reading port.json:', e);
  }
}
if (!PORT) {
  try {
    const cfgPath = path.join(__dirname, 'site-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.port) {
        PORT = cfg.port;
      }
    }
  } catch (e) {
    console.error('Error reading site-config.json:', e);
  }
}
if (!PORT) {
  PORT = 3303;
}

app.use(cors());
app.use(express.json());

const publicDir = __dirname;

// Dynamic index.html – replaces OG/meta tags with site-config values
app.get(['/', '/index.html'], (req, res) => {
  try {
    let html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const cfgPath = path.join(__dirname, 'site-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const name = cfg.siteName || 'Slot';
      const desc = `${name} - Site de Sinais Slots`;
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`);
      html = html.replace(/(<meta\s+name="description"\s+content=")[^"]*"/, `$1${desc}"`);
      html = html.replace(/(<meta\s+property="og:title"\s+content=")[^"]*"/, `$1${name}"`);
      html = html.replace(/(<meta\s+property="og:description"\s+content=")[^"]*"/, `$1${desc}"`);
    }
    res.type('html').send(html);
  } catch (e) {
    res.sendFile(path.join(publicDir, 'index.html'));
  }
});

app.use(express.static(publicDir));

/* ===================================================
   GAME DATA - All providers loaded from scrapper/export
   =================================================== */

const exportDir = path.join(__dirname, 'scrapper', 'export');

// Provider config: maps export folder -> frontend provider key
const PROVIDERS = [
  { folder: 'pg', key: 'pg' },
  { folder: 'pragmatic', key: 'pp' },
  { folder: 'wg-games', key: 'wg' },
  { folder: 'tada-games', key: 'tada' },
];

// Load all export JSONs for each provider
const providerData = {};
for (const p of PROVIDERS) {
  const dir = path.join(exportDir, p.folder);
  const allFile = path.join(dir, 'all.json');
  const hotFile = path.join(dir, 'hot.json');
  const newFile = path.join(dir, 'new.json');

  const allGames = fs.existsSync(allFile) ? JSON.parse(fs.readFileSync(allFile, 'utf8')) : [];
  const hotGames = fs.existsSync(hotFile) ? JSON.parse(fs.readFileSync(hotFile, 'utf8')) : [];
  const newGames = fs.existsSync(newFile) ? JSON.parse(fs.readFileSync(newFile, 'utf8')) : [];

  providerData[p.key] = {
    all: allGames,
    hotSet: new Set(hotGames.map(g => g.cardNo)),
    newSet: new Set(newGames.map(g => g.cardNo)),
  };

  console.log(`📦 ${p.key}: ${allGames.length} jogos (${hotGames.length} hot, ${newGames.length} new)`);
}

/* ===================================================
   SIGNAL GENERATOR - dynamic, changes every 5 minutes
   =================================================== */
function generateSignal(gameName, field) {
  const now = new Date();
  const period = Math.floor(now.getTime() / 300000);
  let hash = 0;
  const str = gameName + field + period;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 101);
}

/* ===================================================
   IMAGE URL BUILDERS - serve locally
   =================================================== */
const IMG_FOLDERS = {
  pg: { banner: 'games-pg', icon: 'games-pg-icon' },
  pp: { banner: 'capa-games-pp', icon: 'icons-pp' },
  wg: { banner: 'games-wg', icon: 'games-wg' },
  tada: { banner: 'games-tada', icon: 'games-tada' },
};

/** Extrai extensão de uma URL (fallback .webp) */
function getExtFromUrl(url) {
  if (!url) return '.webp';
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext && ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(ext.toLowerCase())) {
      return ext.toLowerCase();
    }
  } catch (e) { }
  return '.webp';
}

/** Constrói URL local: /image/<folder>/<cardNo><ext> */
function buildLocalImgUrl(providerKey, cardNo, originalUrl, type) {
  const folders = IMG_FOLDERS[providerKey] || IMG_FOLDERS.pg;
  const folder = type === 'icon' ? folders.icon : folders.banner;
  const ext = getExtFromUrl(originalUrl);
  return `/image/${folder}/${cardNo}${ext}`;
}

/* ===================================================
   IMAGE PROXY ROUTE - local cache + remote fallback
   =================================================== */
const REMOTE_BASE = 'https://www.grupofpsinais.com/image';

function generatePlaceholderSVG(text) {
  const label = text || 'Game';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient></defs>
    <rect width="400" height="400" fill="url(#g)"/>
    <text x="200" y="190" text-anchor="middle" fill="#e0e0e0" font-family="Arial,sans-serif" font-size="18" font-weight="bold">${label}</text>
    <text x="200" y="220" text-anchor="middle" fill="#888" font-family="Arial,sans-serif" font-size="13">Imagem indisponível</text>
  </svg>`;
}

app.get('/image/:folder/:file', async (req, res) => {
  const { folder, file } = req.params;
  // Sanitize inputs
  if (folder.includes('..') || file.includes('..')) return res.status(400).send('Bad request');

  const localDir = path.join(__dirname, 'assets', 'games', folder);
  const localPath = path.join(localDir, file);

  // 1. Try exact file
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }

  // 1b. Try alternative extensions
  const baseName = file.replace(/\.[^.]+$/, '');
  const tryExts = ['.webp', '.png', '.jpg', '.jpeg', '.avif', '.gif'];
  for (const ext of tryExts) {
    const altPath = path.join(localDir, baseName + ext);
    if (fs.existsSync(altPath)) {
      return res.sendFile(altPath);
    }
  }

  // 2. Fetch from remote, cache locally
  try {
    const remoteUrl = `${REMOTE_BASE}/${folder}/${file}`;
    const response = await fetch(remoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/*,*/*',
        'Referer': 'https://www.grupofpsinais.com/',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 500) {
        fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(localPath, buffer);
        res.set('Content-Type', response.headers.get('content-type') || 'image/webp');
        return res.send(buffer);
      }
    }

    // 2b. Try PNG from remote
    const remotePng = `${REMOTE_BASE}/${folder}/${pngFile}`;
    const pngResponse = await fetch(remotePng, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*',
        'Referer': 'https://www.grupofpsinais.com/',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (pngResponse.ok) {
      const buffer = Buffer.from(await pngResponse.arrayBuffer());
      if (buffer.length > 500) {
        fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(localPng, buffer);
        res.set('Content-Type', 'image/png');
        return res.send(buffer);
      }
    }
  } catch (e) {
    // Remote fetch failed, continue to placeholder
  }

  // 3. Return placeholder SVG
  const gameName = file.replace(/\.(webp|png)$/, '');
  res.set('Content-Type', 'image/svg+xml');
  res.send(generatePlaceholderSVG(`Jogo #${gameName}`));
});

/* ===================================================
   API ENDPOINT - single /api/games returns ALL games
   =================================================== */
app.get('/api/games', (req, res) => {
  let globalId = 1;
  const allGames = [];

  // Loop all providers from export data
  for (const [providerKey, data] of Object.entries(providerData)) {
    data.all.forEach((g) => {
      const min = generateSignal(g.title, 'min');
      const pad = generateSignal(g.title, 'pad');
      const max = generateSignal(g.title, 'max');
      const rtp = Math.max(min, pad, max, generateSignal(g.title, 'dist'));

      allGames.push({
        id: globalId++,
        nome: g.title,
        cor: g.bgColor || 'rgb(30, 30, 40)',
        link: g.href,
        icon: buildLocalImgUrl(providerKey, g.cardNo, g.icon, 'icon'),
        banner: buildLocalImgUrl(providerKey, g.cardNo, g.image, 'banner'),
        rtp: rtp,
        min: min,
        padrao: pad,
        max: max,
        badge: g.badge,
        provider: providerKey,
        hot: data.hotSet.has(g.cardNo),
        isNew: data.newSet.has(g.cardNo),
      });
    });
  }

  res.json(allGames);
});

/* ===================================================
   GERAR SINAIS API
   =================================================== */
const gerarSinaisFile = path.join(exportDir, 'gerar-sinais', 'list.json');
const gerarSinaisData = fs.existsSync(gerarSinaisFile)
  ? JSON.parse(fs.readFileSync(gerarSinaisFile, 'utf8'))
  : [];

app.get('/api/gerar-sinais', (req, res) => {
  res.json(gerarSinaisData);
});

/* ===================================================
   PLATFORMS API
   =================================================== */
const platformsFile = path.join(__dirname, 'platforms.json');

// Helper to read platforms
function readPlatforms() {
  if (fs.existsSync(platformsFile)) {
    return JSON.parse(fs.readFileSync(platformsFile, 'utf8'));
  }
  return [];
}

// Helper to write platforms
function writePlatforms(data) {
  fs.writeFileSync(platformsFile, JSON.stringify(data, null, 2), 'utf8');
}

// GET platforms (public)
app.get('/api/platforms', (req, res) => {
  res.json(readPlatforms());
});

// GET platforms (admin)
app.get('/api/admin/platforms', requireAuth, (req, res) => {
  res.json(readPlatforms());
});

// POST new platform
app.post('/api/admin/platforms', requireAuth, (req, res) => {
  try {
    const { nome, link } = req.body;
    if (!nome || !link) return res.status(400).json({ error: 'Nome e link são obrigatórios' });

    const platforms = readPlatforms();
    platforms.push({
      id: Date.now().toString(),
      nome,
      link
    });
    writePlatforms(platforms);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update platform
app.put('/api/admin/platforms/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { nome, link } = req.body;
    if (!nome || !link) return res.status(400).json({ error: 'Nome e link são obrigatórios' });

    const platforms = readPlatforms();
    const index = platforms.findIndex(p => p.id === id);
    if (index === -1) return res.status(404).json({ error: 'Plataforma não encontrada' });

    platforms[index].nome = nome;
    platforms[index].link = link;
    writePlatforms(platforms);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE platform
app.delete('/api/admin/platforms/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    let platforms = readPlatforms();
    platforms = platforms.filter(p => p.id !== id);
    writePlatforms(platforms);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================================================
   ADMIN PANEL - manage game links
   =================================================== */

// Helper: folder key -> provider key mapping
const PROVIDER_FOLDER_MAP = {};
for (const p of PROVIDERS) {
  PROVIDER_FOLDER_MAP[p.key] = p.folder;
}

// Helper: reload a provider's data from disk
function reloadProviderData(providerKey) {
  const folder = PROVIDER_FOLDER_MAP[providerKey];
  if (!folder) return;
  const dir = path.join(exportDir, folder);
  const allFile = path.join(dir, 'all.json');
  const hotFile = path.join(dir, 'hot.json');
  const newFile = path.join(dir, 'new.json');

  const allGames = fs.existsSync(allFile) ? JSON.parse(fs.readFileSync(allFile, 'utf8')) : [];
  const hotGames = fs.existsSync(hotFile) ? JSON.parse(fs.readFileSync(hotFile, 'utf8')) : [];
  const newGames = fs.existsSync(newFile) ? JSON.parse(fs.readFileSync(newFile, 'utf8')) : [];

  providerData[providerKey] = {
    all: allGames,
    hotSet: new Set(hotGames.map(g => g.cardNo)),
    newSet: new Set(newGames.map(g => g.cardNo)),
  };
}

/* --- AUTH SYSTEM --- */
const crypto = require('crypto');
const credentialsFile = path.join(__dirname, 'credentials.json');

function loadCredentials() {
  if (fs.existsSync(credentialsFile)) {
    return JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
  }
  return { username: 'admin', password: 'admin123' };
}

// Active tokens (in-memory, cleared on restart)
const activeTokens = new Set();

// Login endpoint (no auth required)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const creds = loadCredentials();

  if (username === creds.username && password === creds.password) {
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.add(token);
    return res.json({ success: true, token });
  }

  res.status(401).json({ error: 'Usuário ou senha incorretos' });
});

// Logout endpoint
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) activeTokens.delete(token);
  res.json({ success: true });
});

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });
  }
  next();
}

// Change credentials endpoint (requires auth)
app.post('/api/admin/change-credentials', requireAuth, (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    if (!currentPassword || !newUsername || !newPassword) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 4 caracteres' });
    }

    const creds = loadCredentials();
    if (currentPassword !== creds.password) {
      return res.status(403).json({ error: 'Senha atual incorreta' });
    }

    const newCreds = { username: newUsername, password: newPassword };
    fs.writeFileSync(credentialsFile, JSON.stringify(newCreds, null, 2), 'utf8');

    // Invalidate all existing tokens (force re-login)
    activeTokens.clear();

    res.json({ success: true });
  } catch (e) {
    console.error('Change credentials error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Serve admin page (no auth - the page handles login UI)
const adminHtml = path.join(__dirname, 'admin.html');
app.get('/admin', (req, res) => res.sendFile(adminHtml));

// GET unified games for a provider
app.get('/api/admin/games', requireAuth, (req, res) => {
  const providerKey = req.query.provider || 'pg';
  const folder = PROVIDER_FOLDER_MAP[providerKey];
  if (!folder) return res.status(400).json({ error: 'Provider inválido' });

  const dir = path.join(exportDir, folder);
  const allFile = path.join(dir, 'all.json');
  const hotFile = path.join(dir, 'hot.json');
  const newFile = path.join(dir, 'new.json');

  const allGames = fs.existsSync(allFile) ? JSON.parse(fs.readFileSync(allFile, 'utf8')) : [];
  const hotGames = fs.existsSync(hotFile) ? JSON.parse(fs.readFileSync(hotFile, 'utf8')) : [];
  const newGames = fs.existsSync(newFile) ? JSON.parse(fs.readFileSync(newFile, 'utf8')) : [];

  const hotSet = new Set(hotGames.map(g => g.cardNo));
  const newSet = new Set(newGames.map(g => g.cardNo));

  // Build unified list from all.json as the source of truth
  const unified = allGames.map(g => ({
    cardNo: g.cardNo,
    title: g.title,
    href: g.href,
    icon: buildLocalImgUrl(providerKey, g.cardNo, g.icon, 'icon'),
    inHot: hotSet.has(g.cardNo),
    inNew: newSet.has(g.cardNo),
  }));

  res.json(unified);
});

// POST update a single game's href across all JSONs
app.post('/api/admin/games/update', requireAuth, (req, res) => {
  try {
    const { provider, cardNo, href } = req.body;
    if (!provider || cardNo == null || !href) {
      return res.status(400).json({ error: 'Campos provider, cardNo e href são obrigatórios' });
    }

    const folder = PROVIDER_FOLDER_MAP[provider];
    if (!folder) return res.status(400).json({ error: 'Provider inválido' });

    const dir = path.join(exportDir, folder);
    const files = ['all.json', 'hot.json', 'new.json'];
    let updatedCount = 0;

    for (const fname of files) {
      const filePath = path.join(dir, fname);
      if (!fs.existsSync(filePath)) continue;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let changed = false;

      for (const game of data) {
        if (game.cardNo === cardNo) {
          game.href = href;
          changed = true;
          updatedCount++;
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      }
    }

    // Also update top-level export files (if they exist - they mirror the pg folder)
    if (provider === 'pg') {
      for (const fname of files) {
        const topFile = path.join(exportDir, fname);
        if (!fs.existsSync(topFile)) continue;
        const data = JSON.parse(fs.readFileSync(topFile, 'utf8'));
        let changed = false;
        for (const game of data) {
          if (game.cardNo === cardNo) {
            game.href = href;
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(topFile, JSON.stringify(data, null, 2), 'utf8');
        }
      }
    }

    // Reload in-memory data
    reloadProviderData(provider);

    res.json({ success: true, updated: updatedCount });
  } catch (e) {
    console.error('Admin update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST bulk update all games of a provider to the same href
app.post('/api/admin/games/bulk-update', requireAuth, (req, res) => {
  try {
    const { provider, href } = req.body;
    if (!provider || !href) {
      return res.status(400).json({ error: 'Campos provider e href são obrigatórios' });
    }

    const folder = PROVIDER_FOLDER_MAP[provider];
    if (!folder) return res.status(400).json({ error: 'Provider inválido' });

    const dir = path.join(exportDir, folder);
    const files = ['all.json', 'hot.json', 'new.json'];
    let totalUpdated = 0;

    for (const fname of files) {
      const filePath = path.join(dir, fname);
      if (!fs.existsSync(filePath)) continue;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const game of data) {
        game.href = href;
        totalUpdated++;
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    // Also update top-level export files for pg
    if (provider === 'pg') {
      for (const fname of files) {
        const topFile = path.join(exportDir, fname);
        if (!fs.existsSync(topFile)) continue;
        const data = JSON.parse(fs.readFileSync(topFile, 'utf8'));
        for (const game of data) {
          game.href = href;
        }
        fs.writeFileSync(topFile, JSON.stringify(data, null, 2), 'utf8');
      }
    }

    // Reload in-memory data
    reloadProviderData(provider);

    res.json({ success: true, updated: totalUpdated });
  } catch (e) {
    console.error('Admin bulk-update error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* ===================================================
   SITE CONFIG API - social card + site customization
   =================================================== */
const siteConfigFile = path.join(__dirname, 'site-config.json');

function readSiteConfig() {
  let config = {
    siteName: 'Slot',
    favicon: '/assets/favicon.png',
    themeColor: '#d4007a',
    cardColor: '#b5006e',
    platformsColor: '#b5006e',
    updateColor: '#b5006e',
    bgColor: '#1a0011',
    buttonColor: '#d4007a',
    banners: ['/assets/jcsinais01.png', '/assets/jcsinais02.png', '/assets/jcsinais03.png', '/assets/jcsinais04.png'],
    profilePhoto: '/assets/favicon.png',
    displayName: 'GRUPO Slot',
    username: '@noellyalcantara12',
    whatsapp: { enabled: true, label: 'WhatsApp', link: '', color: '#25d366' },
    instagram: { enabled: true, label: 'Instagram', link: '', color: '#e1306c' },
    facebook: { enabled: false, label: 'Facebook', link: '', color: '#1877f2' },
    telegram: { enabled: false, label: 'Telegram', link: '', color: '#2ca5e0' }
  };

  if (fs.existsSync(siteConfigFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(siteConfigFile, 'utf8'));
      config = { ...config, ...parsed };
    } catch(e) {}
  }

  // Merge port from port.json if exists
  try {
    const portPath = path.join(__dirname, 'port.json');
    if (fs.existsSync(portPath)) {
      const portCfg = JSON.parse(fs.readFileSync(portPath, 'utf8'));
      if (portCfg.port) {
        config.port = portCfg.port;
      }
    }
  } catch(e) {}

  return config;
}

function writeSiteConfig(data) {
  fs.writeFileSync(siteConfigFile, JSON.stringify(data, null, 2), 'utf8');
}

// Public route - used by index.html
app.get('/api/site-config', (req, res) => {
  res.json(readSiteConfig());
});

// Admin route - same data but requires auth
app.get('/api/admin/site-config', requireAuth, (req, res) => {
  res.json(readSiteConfig());
});

// Update site config
app.put('/api/admin/site-config', requireAuth, (req, res) => {
  try {
    const { siteName, themeColor, cardColor, platformsColor, updateColor, bgColor, buttonColor, navbarBgColor, footerBgColor, footerTextColor, displayName, username, whatsapp, instagram, facebook, telegram, port } = req.body;
    const current = readSiteConfig();

    if (siteName !== undefined) current.siteName = siteName;
    if (themeColor !== undefined) current.themeColor = themeColor;
    if (cardColor !== undefined) current.cardColor = cardColor;
    if (platformsColor !== undefined) current.platformsColor = platformsColor;
    if (updateColor !== undefined) current.updateColor = updateColor;
    if (bgColor !== undefined) current.bgColor = bgColor;
    if (buttonColor !== undefined) current.buttonColor = buttonColor;
    if (navbarBgColor !== undefined) current.navbarBgColor = navbarBgColor;
    if (footerBgColor !== undefined) current.footerBgColor = footerBgColor;
    if (footerTextColor !== undefined) current.footerTextColor = footerTextColor;
    if (displayName !== undefined) current.displayName = displayName;
    if (username !== undefined) current.username = username;
    if (whatsapp) {
      if (!current.whatsapp) current.whatsapp = { enabled: true, label: 'WhatsApp', link: '', color: '#25d366' };
      if (whatsapp.enabled !== undefined) current.whatsapp.enabled = whatsapp.enabled;
      if (whatsapp.label !== undefined) current.whatsapp.label = whatsapp.label;
      if (whatsapp.link !== undefined) current.whatsapp.link = whatsapp.link;
      if (whatsapp.color !== undefined) current.whatsapp.color = whatsapp.color;
    }
    if (instagram) {
      if (!current.instagram) current.instagram = { enabled: true, label: 'Instagram', link: '', color: '#e1306c' };
      if (instagram.enabled !== undefined) current.instagram.enabled = instagram.enabled;
      if (instagram.label !== undefined) current.instagram.label = instagram.label;
      if (instagram.link !== undefined) current.instagram.link = instagram.link;
      if (instagram.color !== undefined) current.instagram.color = instagram.color;
    }
    if (facebook !== undefined) {
      if (!current.facebook) current.facebook = { enabled: false, label: 'Facebook', link: '', color: '#1877f2' };
      if (facebook.enabled !== undefined) current.facebook.enabled = facebook.enabled;
      if (facebook.label !== undefined) current.facebook.label = facebook.label;
      if (facebook.link !== undefined) current.facebook.link = facebook.link;
      if (facebook.color !== undefined) current.facebook.color = facebook.color;
    }
    if (telegram !== undefined) {
      if (!current.telegram) current.telegram = { enabled: false, label: 'Telegram', link: '', color: '#2ca5e0' };
      if (telegram.enabled !== undefined) current.telegram.enabled = telegram.enabled;
      if (telegram.label !== undefined) current.telegram.label = telegram.label;
      if (telegram.link !== undefined) current.telegram.link = telegram.link;
      if (telegram.color !== undefined) current.telegram.color = telegram.color;
    }

    let portChanged = false;
    if (port !== undefined) {
      const newPortVal = port ? parseInt(port, 10) : null;
      if (current.port !== newPortVal) {
        current.port = newPortVal;
        portChanged = true;

        // Write port directly to port.json for external editing/access
        try {
          fs.writeFileSync(path.join(__dirname, 'port.json'), JSON.stringify({ port: newPortVal }, null, 2), 'utf8');
        } catch (e) {
          console.error('Error writing port.json:', e);
        }
      }
    }

    writeSiteConfig(current);
    res.json({ success: true, portChanged });

    if (portChanged) {
      console.log(`[PORT CHANGE] Port changed to ${current.port}. Restarting process...`);
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    }
  } catch (e) {
    console.error('Site config update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Multer setup for image uploads
const multer = require('multer');

function createUploader(filenamePrefix) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(__dirname, 'assets')),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        cb(null, filenamePrefix + ext);
      }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.ico'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  });
}

const uploadProfile = createUploader('profile-photo');
const uploadFavicon = createUploader('favicon');

// Banner uploads use unique timestamped names
const uploadBanner = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'assets')),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, 'banner-' + Date.now() + ext);
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Upload profile photo
app.post('/api/admin/site-config/upload-photo', requireAuth, uploadProfile.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    const photoPath = '/assets/' + req.file.filename;
    const config = readSiteConfig();
    config.profilePhoto = photoPath + '?v=' + Date.now();
    writeSiteConfig(config);
    res.json({ success: true, photoPath: config.profilePhoto });
  } catch (e) {
    console.error('Photo upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Upload favicon
app.post('/api/admin/site-config/upload-favicon', requireAuth, uploadFavicon.single('favicon'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    const faviconPath = '/assets/' + req.file.filename;
    const config = readSiteConfig();
    config.favicon = faviconPath + '?v=' + Date.now();
    writeSiteConfig(config);
    res.json({ success: true, faviconPath: config.favicon });
  } catch (e) {
    console.error('Favicon upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Upload banner image (adds to the array)
app.post('/api/admin/site-config/upload-banner', requireAuth, uploadBanner.single('banner'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    const bannerPath = '/assets/' + req.file.filename;
    const config = readSiteConfig();
    if (!config.banners) config.banners = [];
    config.banners.push(bannerPath);
    writeSiteConfig(config);
    res.json({ success: true, bannerPath, banners: config.banners });
  } catch (e) {
    console.error('Banner upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Delete a banner (by index)
app.delete('/api/admin/site-config/banner/:index', requireAuth, (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const config = readSiteConfig();
    if (!config.banners || index < 0 || index >= config.banners.length) {
      return res.status(400).json({ error: 'Índice inválido' });
    }
    config.banners.splice(index, 1);
    writeSiteConfig(config);
    res.json({ success: true, banners: config.banners });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reorder banners
app.put('/api/admin/site-config/banners-order', requireAuth, (req, res) => {
  try {
    const { banners } = req.body;
    if (!Array.isArray(banners)) return res.status(400).json({ error: 'Array de banners obrigatório' });
    const config = readSiteConfig();
    config.banners = banners;
    writeSiteConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run system updates via GitHub script
app.post('/api/admin/update-system', requireAuth, (req, res) => {
  console.log('[UPDATE] Admin triggered system update...');
  const { exec } = require('child_process');
  
  const isWin = process.platform === 'win32';
  const cmd = isWin 
    ? 'powershell.exe -ExecutionPolicy Bypass -File ./update.ps1' 
    : 'bash update.sh';
    
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('[UPDATE] Error executing update script:', err);
      return res.status(500).json({ 
        error: err.message, 
        stdout: stdout, 
        stderr: stderr 
      });
    }
    
    console.log('[UPDATE] System update completed successfully. Restarting process...');
    res.json({ success: true, log: stdout });
    
    // Exit process with 0 so docker/pterodactyl/pm2 can restart it
    setTimeout(() => {
      process.exit(0);
    }, 1500);
  });
});

/* ===================================================
   PAGE ROUTES - serve correct HTML for each path
   =================================================== */
const indexFile = path.join(__dirname, 'index.html');
const gerarSinaisHtml = path.join(__dirname, 'gerar-sinais.html');
const gerarSinaisGameHtml = path.join(__dirname, 'gerar-sinais-game.html');

app.get('/pp-games', (req, res) => res.sendFile(indexFile));
app.get('/wg-games', (req, res) => res.sendFile(indexFile));
app.get('/tada-games', (req, res) => res.sendFile(indexFile));
app.get('/gerar-sinais', (req, res) => res.sendFile(gerarSinaisHtml));
app.get('/gerar-sinais/:g', (req, res) => res.sendFile(gerarSinaisGameHtml));
app.get('/download-app', (req, res) => res.sendFile(indexFile));

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
