'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let allArticles = [];
let availableBulletins = new Set(); // numéros disponibles en téléchargement
let currentSort = { key: null, dir: 1 }; // tri courant

// ── DOM refs ───────────────────────────────────────────────────────────────
const qInput        = document.getElementById('q');
const auteurInput   = document.getElementById('auteur');
const rubriqueSelect= document.getElementById('rubrique');
const anneeSelect   = document.getElementById('annee');
const bulletinInput = document.getElementById('bulletin');
const btnSearch     = document.getElementById('btn-search');
const btnReset      = document.getElementById('btn-reset');
const statusEl      = document.getElementById('status');
const tbody         = document.getElementById('results-body');
const noResults     = document.getElementById('no-results');
const table         = document.getElementById('results-table');

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function init() {
  statusEl.textContent = 'Chargement de l\'index…';
  try {
    const [articlesResp, bulletinsResp] = await Promise.all([
      fetch('articles.json'),
      fetch('/api/bulletins'),
    ]);
    if (!articlesResp.ok) throw new Error(articlesResp.statusText);
    allArticles = await articlesResp.json();
    if (bulletinsResp.ok) {
      const nums = await bulletinsResp.json();
      availableBulletins = new Set(nums.map(String));
    }
  } catch (e) {
    statusEl.textContent = 'Erreur de chargement de l\'index : ' + e.message;
    return;
  }

  populateFilters();
  renderAll();

  // events
  btnSearch.addEventListener('click', search);
  btnReset.addEventListener('click', reset);
  [qInput, auteurInput, bulletinInput].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') search(); })
  );
  rubriqueSelect.addEventListener('change', search);
  anneeSelect.addEventListener('change', search);

  // Tri par clic sur en-tête de colonne
  const sortKeys = {
    'col-rubrique': 'rubrique',
    'col-titre':    'titre',
    'col-auteur':   'auteur',
    'col-date':     'date',
    'col-bulletin': 'bulletinNum',
  };
  document.querySelectorAll('thead th').forEach(th => {
    const key = sortKeys[th.className.trim().split(' ')[0]];
    if (!key) return;
    th.addEventListener('click', () => {
      if (currentSort.key === key) {
        currentSort.dir *= -1;
      } else {
        currentSort.key = key;
        currentSort.dir = 1;
      }
      document.querySelectorAll('thead th').forEach(h => h.classList.remove('sorted-asc','sorted-desc'));
      th.classList.add(currentSort.dir === 1 ? 'sorted-asc' : 'sorted-desc');
      search();
    });
  });

  // Badges fréquences cliquables
  document.querySelectorAll('.freq-badge[data-freq]').forEach(badge => {
    badge.addEventListener('click', () => {
      const freq = badge.dataset.freq;
      const isActive = badge.classList.contains('active');
      // Désactiver tous les badges
      document.querySelectorAll('.freq-badge').forEach(b => b.classList.remove('active'));
      if (isActive) {
        // Deuxième clic : effacer le filtre
        qInput.value = '';
        search();
      } else {
        badge.classList.add('active');
        qInput.value = freq;
        search();
      }
    });
  });

  // Retirer le badge actif si on modifie le champ titre manuellement
  qInput.addEventListener('input', () => {
    document.querySelectorAll('.freq-badge').forEach(b => b.classList.remove('active'));
  });
}

// ── Populate filter dropdowns ──────────────────────────────────────────────
function populateFilters() {
  // Rubriques
  const rubriques = [...new Set(allArticles.map(a => a.rubrique))].sort();
  rubriques.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    rubriqueSelect.appendChild(opt);
  });

  // Années
  const years = [...new Set(allArticles.map(a => a.year).filter(Boolean))].sort((a, b) => b - a);
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    anneeSelect.appendChild(opt);
  });
}

// ── Render helpers ─────────────────────────────────────────────────────────
function normalize(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function highlight(text, term) {
  if (!term) return escHtml(text);
  const normText = normalize(text);
  const normTerm = normalize(term);
  if (!normTerm || !normText.includes(normTerm)) return escHtml(text);
  let result = '';
  let i = 0;
  while (i < text.length) {
    const idx = normText.indexOf(normTerm, i);
    if (idx === -1) { result += escHtml(text.slice(i)); break; }
    result += escHtml(text.slice(i, idx));
    result += '<mark>' + escHtml(text.slice(idx, idx + normTerm.length)) + '</mark>';
    i = idx + normTerm.length;
  }
  return result;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const months = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

// ── Render results ─────────────────────────────────────────────────────────
function renderAll() {
  renderResults(allArticles, {});
}

function renderResults(articles, terms) {
  tbody.innerHTML = '';

  if (articles.length === 0) {
    table.classList.add('hidden');
    noResults.classList.remove('hidden');
    statusEl.textContent = 'Aucun résultat.';
    return;
  }

  table.classList.remove('hidden');
  noResults.classList.add('hidden');

  // Appliquer le tri si actif
  if (currentSort.key) {
    const k = currentSort.key;
    const d = currentSort.dir;
    articles = [...articles].sort((a, b) => {
      const va = k === 'bulletinNum' ? Number(a[k]) || 0 : (a[k] || '').toLowerCase();
      const vb = k === 'bulletinNum' ? Number(b[k]) || 0 : (b[k] || '').toLowerCase();
      return va < vb ? -d : va > vb ? d : 0;
    });
  }

  const frag = document.createDocumentFragment();
  articles.forEach(a => {
    const tr = document.createElement('tr');
    const dlHref = a.bulletinPath || '#';
    tr.innerHTML = `
      <td><span class="tag-rubrique">${highlight(a.rubrique, terms.rubrique)}</span></td>
      <td>${highlight(a.titre, terms.q)}</td>
      <td>${highlight(a.auteur, terms.auteur)}</td>
      <td>${formatDate(a.date)}</td>
      <td class="col-bulletin"><span class="badge">N°&thinsp;${escHtml(a.bulletinNum)}</span></td>
      <td class="col-dl">${
        availableBulletins.has(a.bulletinNum)
        ? `<a class="dl-btn" href="${escHtml(dlHref)}" download title="Télécharger le bulletin N°${escHtml(a.bulletinNum)}">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
               <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/>
             </svg>
             PDF
           </a>`
        : `<span class="dl-unavailable" title="Bulletin non encore disponible">—</span>`
      }</td>`;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  const total = allArticles.length;
  statusEl.textContent = articles.length === total
    ? `${total} articles`
    : `${articles.length} article${articles.length > 1 ? 's' : ''} trouvé${articles.length > 1 ? 's' : ''} sur ${total}`;
}

// ── Search ─────────────────────────────────────────────────────────────────
function search() {
  const q        = qInput.value.trim();
  const auteur   = auteurInput.value.trim();
  const rubrique = rubriqueSelect.value;
  const annee    = anneeSelect.value;
  const bulletin = bulletinInput.value.trim();

  const normQ       = normalize(q);
  const normAuteur  = normalize(auteur);
  const normBulletin= normalize(bulletin);

  // Split titre query into words for AND matching
  const words = normQ ? normQ.split(/\s+/) : [];

  const filtered = allArticles.filter(a => {
    if (words.length && !words.every(w => normalize(a.titre).includes(w))) return false;
    if (normAuteur  && !normalize(a.auteur).includes(normAuteur))  return false;
    if (rubrique    && a.rubrique !== rubrique)                     return false;
    if (annee       && String(a.year) !== annee)                   return false;
    if (normBulletin && normalize(a.bulletinNum) !== normBulletin) return false;
    return true;
  });

  renderResults(filtered, { q, auteur, rubrique });
}

function reset() {
  qInput.value        = '';
  auteurInput.value   = '';
  rubriqueSelect.value= '';
  anneeSelect.value   = '';
  bulletinInput.value = '';
  renderAll();
}

// ── Go ─────────────────────────────────────────────────────────────────────
init();
