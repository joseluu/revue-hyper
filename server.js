const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4401;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Serve bulletin PDFs
// Tries exact filename first (e.g. 326.pdf), then falls back to pattern matching
app.get('/bulletins/:filename', (req, res) => {
  const filename = req.params.filename;
  const bulletinsDir = path.join(__dirname, 'bulletins');
  const exactPath = path.join(bulletinsDir, filename);

  if (fs.existsSync(exactPath)) {
    return res.sendFile(exactPath);
  }

  // Fallback: find any file whose name contains the bulletin number
  const num = filename.replace('.pdf', '');
  try {
    const files = fs.readdirSync(bulletinsDir);
    const match = files.find(f =>
      f.toLowerCase().includes(`n° ${num}`) ||
      f.toLowerCase().includes(`n°${num}`) ||
      f.toLowerCase().includes(`n ${num}`) ||
      f === `${num}.pdf`
    );
    if (match) {
      return res.sendFile(path.join(bulletinsDir, match));
    }
  } catch (e) {
    // bulletins dir not accessible
  }

  res.status(404).json({ error: `Bulletin ${filename} non trouvé` });
});

app.listen(PORT, () => {
  console.log(`Revue Hyper - Serveur démarré sur http://localhost:${PORT}`);
});
