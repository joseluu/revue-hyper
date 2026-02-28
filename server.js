const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4401;
const bulletinsDir = path.join(__dirname, 'bulletins');

// Trust nginx proxy for accurate client IP detection
app.set('trust proxy', 1);

// Load rate limit configuration
const configPath = path.join(__dirname, 'download-config.json');
let rateLimitConfig = { maxFilesPerHour: 10, blockDurationMinutes: 60 };

function loadConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    rateLimitConfig = config.rateLimitConfig || rateLimitConfig;
    console.log('Rate limit config loaded:', rateLimitConfig);
  } catch (e) {
    console.log('Using default rate limit config:', rateLimitConfig);
  }
}

loadConfig();

// In-memory tracking of downloads per IP address
// Format: { '192.168.1.1': [timestamp1, timestamp2, ...], ... }
const downloadTracking = {};

// Utility function to get current time in CET
function getCETTime() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

// Log download to file
function logDownload(ip, filename, filesize, isBlocked = false) {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logFile = path.join(logsDir, 'downloads.log');
  const timestamp = getCETTime();
  const status = isBlocked ? 'BLOCKED' : 'OK';
  const logEntry = `${timestamp} | ${ip} | ${filename} | ${filesize} bytes | ${status}\n`;

  fs.appendFileSync(logFile, logEntry, 'utf8');
}

// Check if IP is blacklisted and clean up old tracking data
function checkAndUpdateIPStatus(ip) {
  const now = Date.now();
  const blockDurationMs = rateLimitConfig.blockDurationMinutes * 60 * 1000;
  const oneHourMs = 60 * 60 * 1000;

  // Initialize if not exists
  if (!downloadTracking[ip]) {
    downloadTracking[ip] = { timestamps: [], blockedUntil: null };
  }

  const ipData = downloadTracking[ip];

  // Check if block has expired
  if (ipData.blockedUntil && now >= ipData.blockedUntil) {
    ipData.blockedUntil = null;
    ipData.timestamps = [];
  }

  // Remove timestamps older than 1 hour
  ipData.timestamps = ipData.timestamps.filter(ts => now - ts < oneHourMs);

  // Check if currently blocked
  if (ipData.blockedUntil && now < ipData.blockedUntil) {
    return { isBlocked: true, reason: 'Rate limit exceeded' };
  }

  return { isBlocked: false };
}

// Record a download and check if limit exceeded
function recordDownload(ip) {
  const now = Date.now();
  const blockDurationMs = rateLimitConfig.blockDurationMinutes * 60 * 1000;
  const oneHourMs = 60 * 60 * 1000;

  if (!downloadTracking[ip]) {
    downloadTracking[ip] = { timestamps: [], blockedUntil: null };
  }

  const ipData = downloadTracking[ip];
  ipData.timestamps.push(now);

  // Remove timestamps older than 1 hour
  ipData.timestamps = ipData.timestamps.filter(ts => now - ts < oneHourMs);

  // Check if limit exceeded
  if (ipData.timestamps.length > rateLimitConfig.maxFilesPerHour) {
    ipData.blockedUntil = now + blockDurationMs;
    return { limitExceeded: true, blockUntil: new Date(ipData.blockedUntil).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) };
  }

  return { limitExceeded: false };
}

// Construit la map num -> nom de fichier réel à partir du dossier bulletins/
function buildBulletinMap() {
  const map = {};
  try {
    const files = fs.readdirSync(bulletinsDir);
    files.forEach(f => {
      if (!f.toLowerCase().endsWith('.pdf')) return;
      // Correspondance "326.pdf"
      const simple = f.match(/^(\d+)\.pdf$/i);
      if (simple) { map[simple[1]] = f; return; }
      // Correspondance "BULLETIN N° 326 ..."
      const fancy = f.match(/n[°o]?\s*(\d+)/i);
      if (fancy) { map[fancy[1]] = f; }
    });
  } catch (e) { /* dossier absent */ }
  return map;
}

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Liste des numéros de bulletins disponibles
app.get('/api/bulletins', (req, res) => {
  const map = buildBulletinMap();
  res.json(Object.keys(map).map(Number).sort((a, b) => a - b));
});

// Téléchargement d'un bulletin
app.get('/bulletins/:filename', (req, res) => {
  const filename = req.params.filename;
  const num = filename.replace(/\.pdf$/i, '');
  const map = buildBulletinMap();
  // Get real client IP (handles X-Forwarded-For from nginx proxy)
  const ip = req.ip || 'unknown';

  // Check if IP is already blocked
  const blockStatus = checkAndUpdateIPStatus(ip);
  if (blockStatus.isBlocked) {
    logDownload(ip, filename, 0, true);
    const remainingTime = Math.ceil((downloadTracking[ip].blockedUntil - Date.now()) / 1000 / 60);
    return res.status(429).json({
      error: 'Trop de téléchargements',
      message: `Votre adresse IP a dépassé la limite de ${rateLimitConfig.maxFilesPerHour} fichiers par heure. Veuillez réessayer dans ${remainingTime} minute(s).`,
      retryAfter: remainingTime
    });
  }

  if (map[num]) {
    const filepath = path.join(bulletinsDir, map[num]);

    // Get file size
    try {
      const stats = fs.statSync(filepath);
      const filesize = stats.size;

      // Record the download
      const limitStatus = recordDownload(ip);
      logDownload(ip, num + '.pdf', filesize, false);

      if (limitStatus.limitExceeded) {
        // User just hit the limit - log it and inform them
        logDownload(ip, 'LIMIT_EXCEEDED', 0, true);
      }

      return res.sendFile(filepath);
    } catch (e) {
      logDownload(ip, filename, 0, false);
      return res.status(500).send('Erreur lors du traitement du fichier');
    }
  }

  logDownload(ip, filename, 0, false);
  res.status(404).send('Bulletin non disponible');
});

app.listen(PORT, () => {
  console.log(`Revue Hyper - Serveur démarré sur http://localhost:${PORT}`);
});
