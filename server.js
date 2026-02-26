const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4401;
const bulletinsDir = path.join(__dirname, 'bulletins');

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

  if (map[num]) {
    return res.sendFile(path.join(bulletinsDir, map[num]));
  }

  res.status(404).send('Bulletin non disponible');
});

app.listen(PORT, () => {
  console.log(`Revue Hyper - Serveur démarré sur http://localhost:${PORT}`);
});
