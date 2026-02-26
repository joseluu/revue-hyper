# Plan RAG — Revue Hyper

Objectif : ajouter au site une interface de **recherche sémantique** et de
**synthèse technique** sur les 300+ bulletins PDF, à la manière de NotebookLM.

---

## Architecture cible

```
PDFs (bulletins/)
    │
    ▼
[1] Extraction texte  ←  pdfplumber (Python)
    │
    ▼
[2] Découpage chunks  ←  ~500 tokens avec chevauchement 50 tokens
    │                    métadonnées : n° bulletin, page, date, rubrique
    ▼
[3] Embeddings        ←  API Voyage AI (voyage-3-lite, ~0,00002$/1K tokens)
    │                    ou OpenAI text-embedding-3-small
    ▼
[4] Base vectorielle  ←  ChromaDB (fichier local, ~50 MB pour 300 bulletins)
    │
    ▼
[5] Requête utilisateur
    │
    ├─► Recherche vectorielle → top-K chunks pertinents
    │
    └─► Claude API (claude-haiku-4-5) → réponse + sources citées
             │
             ▼
    Interface chat sur le site
```

---

## Étapes détaillées

### Phase 1 — Prérequis serveur

#### 1.1 Agrandir le disque GCP (OBLIGATOIRE avant tout)
Le serveur n'a que ~238 MB libres. Les PDFs font 1,5 GB.

**Dans la console GCP :**
1. Compute Engine → Disks → cliquer sur le disque de la VM
2. "Edit" → augmenter à **30 GB minimum** (recommandé : 40 GB)
3. Appliquer (la VM n'a pas besoin d'être éteinte)

**Sur le serveur (après resize GCP) :**
```bash
sudo resize2fs /dev/sda1
df -h /   # vérifier le nouvel espace
```

#### 1.2 Transférer les PDFs par rsync (pas par git — trop lourd)
```bash
# Depuis WSL, une fois le disque agrandi :
rsync -avz --progress \
  /home/jluu/hobby_l/revue-hyper/bulletins/*.pdf \
  googlevm:~/revue-hyper/bulletins/
```

#### 1.3 Vérifier sur le serveur
```bash
ssh googlevm "ls ~/revue-hyper/bulletins/*.pdf | wc -l"
# Attendu : 301
```

---

### Phase 2 — Extraction et indexation

#### 2.1 Dépendances Python (sur le serveur)
```bash
ssh googlevm "cd ~/revue-hyper && python3 -m venv .venv && \
  .venv/bin/pip install pdfplumber chromadb voyageai tqdm"
```

> **Alternative sans Voyage AI** : `sentence-transformers` (modèle local,
> plus lent mais gratuit — peu adapté aux 2 CPU / 1 GB RAM du VM).
> Préférer l'API Voyage ou OpenAI.

#### 2.2 Script `rag/extract.py` — extraction texte + métadonnées
```python
# À créer
# Pour chaque PDF dans bulletins/ :
#   - extraire le texte page par page avec pdfplumber
#   - associer les métadonnées : bulletinNum, date, rubrique(s) du bulletin
#   - sauvegarder en JSONL : rag/chunks.jsonl
```

Structure d'un chunk :
```json
{
  "id": "326-p4",
  "bulletinNum": "326",
  "date": "2026-02-01",
  "page": 4,
  "text": "... texte extrait ...",
  "tokens": 487
}
```

#### 2.3 Script `rag/index.py` — création de la base vectorielle
```python
# À créer
# - Lire rag/chunks.jsonl
# - Calculer les embeddings par batch (Voyage AI ou OpenAI)
# - Stocker dans ChromaDB (rag/chroma_db/)
# Durée estimée : ~15 min pour 300 bulletins
# Coût estimé Voyage AI : ~0,50 € pour l'indexation complète
```

---

### Phase 3 — Backend RAG

#### 3.1 Nouveau endpoint dans `server.js` (ou service Python séparé)

Option A — **Python FastAPI** (recommandé, plus simple pour le RAG) :
```
server.js          port 4401  →  site existant
rag_server.py      port 4402  →  API RAG
nginx              /rag/      →  proxy vers 4402
```

Option B — **Tout dans server.js** via appel subprocess Python
(plus simple à déployer mais moins propre)

#### 3.2 Endpoints RAG
```
POST /rag/search
  body: { "query": "construction d'un cornet 24 GHz" }
  → top 5 chunks + métadonnées bulletins

POST /rag/synthesize
  body: { "query": "techniques LNA faible bruit SHF", "mode": "synthesis" }
  → réponse Claude avec sources citées
```

#### 3.3 Script `rag/query.py`
```python
# À créer
# 1. Embedder la requête utilisateur
# 2. Recherche vectorielle dans ChromaDB (top_k=8)
# 3. Construire le prompt Claude avec les chunks pertinents
# 4. Appeler Claude API (claude-haiku pour recherche, sonnet pour synthèse)
# 5. Retourner réponse + liste des sources (bulletin, page)
```

Prompt type pour la synthèse :
```
Tu es un expert en radio-amateur hyperfréquences (SHF/EHF).
Réponds en français à la question suivante en te basant UNIQUEMENT
sur les extraits de la Revue Hyper fournis. Cite les numéros de
bulletin et pages pour chaque information.

Question : {query}

Extraits :
[Bulletin 24, p.3] ...
[Bulletin 87, p.12] ...
```

---

### Phase 4 — Interface utilisateur

#### 4.1 Nouvel onglet sur le site
Ajouter un onglet "Assistant IA" à côté de la recherche par index.

#### 4.2 Interface chat (`public/rag.html`)
```
┌─────────────────────────────────────────────┐
│  MODE :  ○ Recherche   ● Synthèse           │
├─────────────────────────────────────────────┤
│                                             │
│  [Historique des échanges]                  │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Sources : Bull. 24 p.3 · Bull. 87   │    │
│  │ p.12 · Bull. 156 p.7                │    │
│  └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│  [Votre question...]              [Envoyer] │
└─────────────────────────────────────────────┘
```

---

### Phase 5 — Supervisor & nginx

#### 5.1 Config supervisor pour le service RAG
```ini
[program:revue-hyper-rag]
command=/home/jose_luu/revue-hyper/.venv/bin/uvicorn rag.server:app --port 4402
directory=/home/jose_luu/revue-hyper
user=jose_luu
autostart=true
autorestart=true
```

#### 5.2 Config nginx — ajout du proxy RAG
```nginx
location /rag/ {
    proxy_pass http://127.0.0.1:4402/;
    proxy_read_timeout 60s;   # synthèse peut prendre ~10s
}
```

---

## Coûts estimés (API)

| Opération | Modèle | Coût estimé |
|---|---|---|
| Indexation initiale (1x) | Voyage voyage-3-lite | ~0,50 € |
| Recherche sémantique | Voyage + Claude Haiku | ~0,001 € / requête |
| Synthèse technique | Voyage + Claude Sonnet | ~0,02 € / requête |

> Pour 100 synthèses/mois : ~2 €/mois

---

## Clés API nécessaires

- **Voyage AI** : https://www.voyageai.com (gratuit jusqu'à 50M tokens/mois)
  ou **OpenAI** : https://platform.openai.com
- **Anthropic Claude** : https://console.anthropic.com

Variables d'environnement à créer sur le serveur :
```bash
# Dans /etc/supervisor/conf.d/revue-hyper-rag.conf :
environment=ANTHROPIC_API_KEY="sk-ant-...",VOYAGE_API_KEY="pa-..."
```

---

## Ordre d'exécution résumé

```
[ ] 1. Agrandir disque GCP (console web) → resize2fs
[ ] 2. rsync des PDFs WSL → serveur
[ ] 3. Créer clés API (Voyage AI + Anthropic)
[ ] 4. Créer rag/extract.py + lancer extraction
[ ] 5. Créer rag/index.py + lancer indexation (~15 min)
[ ] 6. Créer rag/query.py + FastAPI server
[ ] 7. Créer public/rag.html (interface chat)
[ ] 8. Config supervisor + nginx
[ ] 9. Tests end-to-end
```
