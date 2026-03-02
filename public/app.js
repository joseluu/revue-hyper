'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let allArticles = [];
let availableBulletins = new Set(); // numéros disponibles en téléchargement
let currentSort = { key: null, dir: 1 }; // tri courant

// ── PDF Viewer State ────────────────────────────────────────────────────────
const pdfViewer = {
  instance: null,       // PDFDocumentProxy
  totalPages: 0,
  scale: 1.0,           // Will be set to fit width
  rotation: 0,          // 0, 90, 180, 270
  bulletinNum: null,
  bulletinPath: null,
  rendering: false,
  canvases: [],         // Array of rendered canvases
  drag: { active: false, startX: 0, startY: 0, origScrollLeft: 0, origScrollTop: 0 }
};

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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

// PDF Viewer DOM refs
const pdfModal       = document.getElementById('pdf-modal');
const pdfModalInner  = document.getElementById('pdf-modal-inner');
const pdfCanvasWrap  = document.getElementById('pdf-canvas-wrap');
const pdfTitle       = document.getElementById('pdf-title');
const pdfZoomInBtn   = document.getElementById('pdf-zoom-in');
const pdfZoomOutBtn  = document.getElementById('pdf-zoom-out');
const pdfRotateLeftBtn  = document.getElementById('pdf-rotate-left');
const pdfRotateRightBtn = document.getElementById('pdf-rotate-right');
const pdfSaveBtn     = document.getElementById('pdf-save');
const pdfCloseBtn    = document.getElementById('pdf-close');

// ── SOMMAIRE Parsing ───────────────────────────────────────────────────────
function parseSommaire(markdownContent) {
  // Find SOMMAIRE position and extract a wide zone around it
  // (the page list can be BEFORE or AFTER the word SOMMAIRE)
  const somMatch = markdownContent.match(/SOMMAIRE/i);
  if (!somMatch) return [];

  const pos = somMatch.index;
  const zone = markdownContent.substring(
    Math.max(0, pos - 3000),
    Math.min(markdownContent.length, pos + 3000)
  );

  const entries = [];
  const seenPages = new Set();

  function addPage(page) {
    if (page >= 2 && page <= 50 && !seenPages.has(page)) {
      seenPages.add(page);
      entries.push({ page });
    }
  }

  // --- Strategy A: "- N) Titre ....... PAGE" ---
  const aRegex = /^-\s*\d+\)\s*.+?\.{2,}\s*(\d+)\s*$/gm;
  let m;
  while ((m = aRegex.exec(zone)) !== null) addPage(parseInt(m[1], 10));

  // --- Strategy B: "TITRE....PAGE" (3+ dots leader, at least 2 matches) ---
  if (entries.length === 0) {
    const bMatches = [];
    const bRegex = /[A-ZÀ-Ÿ][^\n|]*?\.{3,}\s*(\d+)/g;
    while ((m = bRegex.exec(zone)) !== null) bMatches.push(parseInt(m[1], 10));
    if (bMatches.length >= 2) bMatches.forEach(p => addPage(p));
  }

  // --- Strategy C: Flexible P/p and "page" patterns ---
  if (entries.length === 0) {
    // C1: P/p with dash: P-3, P- 3, p-15
    const c1Regex = /[Pp]\s*-\s*(\d+)/g;
    while ((m = c1Regex.exec(zone)) !== null) addPage(parseInt(m[1], 10));

    // C2: "page N" / "pages N" (most reliable)
    const c2Regex = /pages?\s+(\d+)/gi;
    while ((m = c2Regex.exec(zone)) !== null) addPage(parseInt(m[1], 10));

    // C3: P/p at start of line or after | or <br> (without dash)
    const c3Regex = /(?:^|[|\n]|<br\s*\/?>)\s*[Pp]\s*(\d+)/gm;
    while ((m = c3Regex.exec(zone)) !== null) addPage(parseInt(m[1], 10));
  }

  // Sort by page number
  entries.sort((a, b) => a.page - b.page);
  return entries;
}

async function displaySommairePages(bulletinNum) {
  try {
    const resp = await fetch(`/api/markdown/${bulletinNum}`);
    if (!resp.ok) return; // Markdown not found, that's OK

    const data = await resp.json();
    const entries = parseSommaire(data.content);

    if (entries.length === 0) return;

    // Find or create the page badges container
    const pdfTbCenter = document.querySelector('.pdf-tb-center');
    let pageContainer = document.getElementById('pdf-page-badges');

    if (!pageContainer) {
      pageContainer = document.createElement('div');
      pageContainer.id = 'pdf-page-badges';
      pageContainer.className = 'pdf-page-badges';
      pdfTbCenter.parentNode.insertBefore(pageContainer, pdfTbCenter.nextSibling);
    }

    // Clear previous badges
    pageContainer.innerHTML = '';

    // Create badge for each SOMMAIRE entry
    entries.forEach(entry => {
      const badge = document.createElement('button');
      badge.className = 'pdf-page-badge';
      badge.textContent = `P. ${entry.page}`;
      badge.title = `Page ${entry.page}`;
      badge.dataset.page = entry.page;

      badge.addEventListener('click', () => {
        // Jump to the specified page
        if (pdfViewer.canvases.length > 0 && entry.page <= pdfViewer.totalPages) {
          const targetPageIndex = Math.max(0, entry.page - 1);
          const targetWrapper = pdfViewer.canvases[targetPageIndex]?.wrapper;
          if (targetWrapper) {
            const scrollTop = targetWrapper.offsetTop - pdfCanvasWrap.clientHeight / 2;
            pdfCanvasWrap.scrollTop = Math.max(0, scrollTop);
          }
        }
      });

      pageContainer.appendChild(badge);
    });
  } catch (e) {
    // Silently fail if markdown fetch fails
    console.debug('SOMMAIRE parsing failed:', e);
  }
}

// ── PDF Viewer Functions ───────────────────────────────────────────────────
async function openViewer(num, path) {
  pdfViewer.bulletinNum = num;
  pdfViewer.bulletinPath = path || `/bulletins/${num}.pdf`;
  pdfViewer.rotation = 0;  // Reset rotation for new PDF
  pdfTitle.textContent = `Bulletin N°${escHtml(num)}`;

  try {
    const resp = await fetch(pdfViewer.bulletinPath);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    pdfViewer.instance = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    pdfViewer.totalPages = pdfViewer.instance.numPages;

    pdfModal.classList.remove('hidden');

    // Wait two frames for the browser to fully layout the modal
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Calculate scale to fit width: available width = clientWidth minus padding (2×1rem) minus scrollbar (~14px)
    const firstPage = await pdfViewer.instance.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1.0 });
    const availableWidth = pdfCanvasWrap.clientWidth - 32 - 14;
    pdfViewer.scale = Math.max(0.5, availableWidth / viewport.width);

    pdfCanvasWrap.scrollTop = 0;
    pdfCanvasWrap.scrollLeft = 0;
    await renderAllPages();

    // Display SOMMAIRE page badges
    await displaySommairePages(num);

    // Scroll to bottom of first page minus 100px (SOMMAIRE is there)
    if (pdfViewer.canvases.length > 0) {
      const firstWrapper = pdfViewer.canvases[0].wrapper;
      const wrapperBottom = firstWrapper.offsetTop + firstWrapper.offsetHeight - pdfCanvasWrap.clientHeight - 100;
      pdfCanvasWrap.scrollTop = Math.max(0, wrapperBottom);
    }
  } catch (e) {
    alert('Erreur lors du chargement du PDF : ' + e.message);
    closeViewer();
  }
}

async function renderAllPages() {
  if (!pdfViewer.instance || pdfViewer.rendering) return;

  pdfViewer.rendering = true;
  pdfCanvasWrap.innerHTML = '';
  pdfViewer.canvases = [];

  try {
    for (let pageNum = 1; pageNum <= pdfViewer.totalPages; pageNum++) {
      const page = await pdfViewer.instance.getPage(pageNum);
      const viewport = page.getViewport({ scale: pdfViewer.scale });

      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper';
      wrapper.style.marginBottom = '1rem';

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = 'block';
      canvas.style.borderRadius = '4px';
      canvas.style.boxShadow = '0 4px 20px rgba(0,0,0,.5)';
      canvas.style.transformOrigin = 'top left';

      applyRotation(wrapper, canvas, viewport.width, viewport.height);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      wrapper.appendChild(canvas);
      pdfCanvasWrap.appendChild(wrapper);
      pdfViewer.canvases.push({ wrapper, canvas, w: viewport.width, h: viewport.height });
    }
  } catch (e) {
    console.error('Error rendering pages:', e);
  } finally {
    pdfViewer.rendering = false;
  }
}

function applyRotation(wrapper, canvas, w, h) {
  const r = pdfViewer.rotation;
  if (r === 0) {
    wrapper.style.width = w + 'px';
    wrapper.style.height = h + 'px';
    wrapper.style.margin = '0 auto 1rem';
    canvas.style.transform = 'none';
  } else if (r === 90) {
    wrapper.style.width = h + 'px';
    wrapper.style.height = w + 'px';
    wrapper.style.margin = '0 auto 1rem';
    canvas.style.transform = 'rotate(90deg) translateY(-100%)';
  } else if (r === 180) {
    wrapper.style.width = w + 'px';
    wrapper.style.height = h + 'px';
    wrapper.style.margin = '0 auto 1rem';
    canvas.style.transform = 'rotate(180deg) translate(-100%, -100%)';
  } else if (r === 270) {
    wrapper.style.width = h + 'px';
    wrapper.style.height = w + 'px';
    wrapper.style.margin = '0 auto 1rem';
    canvas.style.transform = 'rotate(270deg) translateX(-100%)';
  }
}

function closeViewer() {
  pdfModal.classList.add('hidden');
  if (pdfViewer.instance) {
    pdfViewer.instance.destroy();
    pdfViewer.instance = null;
  }
  pdfViewer.totalPages = 0;
  pdfViewer.canvases = [];
  pdfCanvasWrap.innerHTML = '';
}

async function downloadCurrent() {
  try {
    const resp = await fetch(pdfViewer.bulletinPath);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulletin-${pdfViewer.bulletinNum}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Erreur lors du téléchargement : ' + e.message);
  }
}

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

  // PDF Viewer events — Delegation on tbody for .view-btn
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
    if (btn) {
      const num = btn.dataset.num;
      const path = btn.dataset.path || `/bulletins/${num}.pdf`;
      openViewer(num, path);
    }
  });

  // PDF Viewer — Zoom buttons
  pdfZoomInBtn.addEventListener('click', () => {
    if (!pdfViewer.instance) return;
    pdfViewer.scale = Math.min(3, pdfViewer.scale + 0.2);
    renderAllPages();
  });

  pdfZoomOutBtn.addEventListener('click', () => {
    if (!pdfViewer.instance) return;
    pdfViewer.scale = Math.max(0.5, pdfViewer.scale - 0.2);
    renderAllPages();
  });

  // PDF Viewer — Rotation buttons
  pdfRotateLeftBtn.addEventListener('click', () => {
    if (!pdfViewer.instance) return;
    pdfViewer.rotation = (pdfViewer.rotation - 90 + 360) % 360;
    pdfViewer.canvases.forEach(c => applyRotation(c.wrapper, c.canvas, c.w, c.h));
  });

  pdfRotateRightBtn.addEventListener('click', () => {
    if (!pdfViewer.instance) return;
    pdfViewer.rotation = (pdfViewer.rotation + 90) % 360;
    pdfViewer.canvases.forEach(c => applyRotation(c.wrapper, c.canvas, c.w, c.h));
  });

  // PDF Viewer — Drag to pan
  document.addEventListener('mousedown', e => {
    if (!pdfViewer.instance || pdfModal.classList.contains('hidden')) return;
    // Check if click is inside canvas-wrap
    if (!pdfCanvasWrap.contains(e.target)) return;

    pdfViewer.drag.active = true;
    pdfViewer.drag.startX = e.clientX;
    pdfViewer.drag.startY = e.clientY;
    pdfViewer.drag.origScrollLeft = pdfCanvasWrap.scrollLeft;
    pdfViewer.drag.origScrollTop = pdfCanvasWrap.scrollTop;
    pdfCanvasWrap.classList.add('dragging');
    e.preventDefault();
  }, true);

  document.addEventListener('mousemove', e => {
    if (!pdfViewer.drag.active) return;
    const dx = e.clientX - pdfViewer.drag.startX;
    const dy = e.clientY - pdfViewer.drag.startY;
    pdfCanvasWrap.scrollLeft = pdfViewer.drag.origScrollLeft - dx;
    pdfCanvasWrap.scrollTop = pdfViewer.drag.origScrollTop - dy;
  });

  document.addEventListener('mouseup', () => {
    if (pdfViewer.drag.active) {
      pdfViewer.drag.active = false;
      pdfCanvasWrap.classList.remove('dragging');
    }
  });

  // PDF Viewer — Click on overlay does nothing (close only via X button or Escape)

  // PDF Viewer — Close button
  pdfCloseBtn.addEventListener('click', () => {
    closeViewer();
  });

  // PDF Viewer — Escape key to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !pdfModal.classList.contains('hidden')) {
      closeViewer();
    }
  });

  // PDF Viewer — Download button
  pdfSaveBtn.addEventListener('click', downloadCurrent);
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
      <td class="col-view">${
        availableBulletins.has(a.bulletinNum)
        ? `<button class="view-btn" data-num="${escHtml(a.bulletinNum)}" data-path="${escHtml(a.bulletinPath || '')}" title="Visualiser le bulletin N°${escHtml(a.bulletinNum)}">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
               <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
             </svg>
             PDF
           </button>`
        : `<span class="dl-unavailable">—</span>`
      }</td>
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

// ── Frequency band cross-matching ──────────────────────────────────────────
function getFrequencyAlternatives(freq) {
  const normalized = normalize(freq);
  // Map frequency bands to their alternatives
  const frequencyMap = {
    '24 ghz': ['24 ghz', '23 ghz'],    // 2.4 GHz matches 2.3 GHz
    '241 ghz': ['241 ghz', '248 ghz']  // 241 GHz matches 248 GHz
  };

  return frequencyMap[normalized] || [normalized];
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

  // Get frequency alternatives for cross-matching
  const frequencyAlternatives = getFrequencyAlternatives(normQ);

  const filtered = allArticles.filter(a => {
    if (words.length) {
      // Check if article matches any frequency alternative or all words
      const titreNorm = normalize(a.titre);
      let matchesQuery = false;

      // If we have frequency alternatives (cross-matching), check against them
      if (frequencyAlternatives.length > 1) {
        matchesQuery = frequencyAlternatives.some(freqAlt => {
          const freqWords = freqAlt.split(/\s+/);
          return freqWords.every(w => titreNorm.includes(w));
        });
      } else {
        // Otherwise, all words must match (standard AND matching)
        matchesQuery = words.every(w => titreNorm.includes(w));
      }

      if (!matchesQuery) return false;
    }

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
