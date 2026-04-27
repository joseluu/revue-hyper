#!/usr/bin/env python3
"""
Convertit le fichier CSV d'index des articles en articles.json pour le site web.
À relancer à chaque mise à jour du fichier CSV.

Usage:
    .venv/bin/python3 convert.py [path/to/index.csv]
"""
import sys, csv, json
from datetime import datetime
from pathlib import Path

DEFAULT_CSV = "index_articles/Rubriques Revue Hyper jusqu`à décembre 2025_2026-03-22.csv"
OUTPUT      = "public/articles.json"

MONTHS_FR = ['janvier','février','mars','avril','mai','juin',
             'juillet','août','septembre','octobre','novembre','décembre']


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    print(f"Lecture de : {csv_path}")

    with open(csv_path, encoding='cp1252', newline='') as f:
        rows = list(csv.reader(f, delimiter='\t'))

    header, body = rows[0], rows[1:]
    print(f"  {len(body)} articles, {len(header)} colonnes")
    has_page = 'page' in header

    idx = {name: header.index(name) for name in header}

    articles = []
    for r in body:
        rubrique = r[idx['rubrique']].strip()
        titre    = r[idx['titre']].strip()
        auteur   = r[idx['auteur']].strip()
        raw_date = r[idx['date']].strip()
        refnum   = r[idx['refnum']].strip()
        numero   = r[idx['numero']].strip()

        if raw_date:
            dt = datetime.strptime(raw_date, '%m/%d/%Y')
            date_str     = dt.strftime('%Y-%m-%d')
            date_display = f"{MONTHS_FR[dt.month - 1]} {dt.year}"
            year         = dt.year
        else:
            date_str = date_display = ''
            year = None

        bulletin_num = numero.replace('/bulletins/', '').replace('.pdf', '') if numero else ''

        page = 0
        if has_page:
            raw_page = r[idx['page']].strip()
            if raw_page:
                try:
                    page = int(float(raw_page))
                except ValueError:
                    page = 0

        article = {
            'rubrique':    rubrique,
            'titre':       titre,
            'auteur':      auteur,
            'date':        date_str,
            'dateDisplay': date_display,
            'year':        year,
            'bulletinNum': bulletin_num,
            'bulletinPath': numero,
            'refnum':      int(refnum) if refnum else 0,
        }
        if page > 0:
            article['page'] = page
        articles.append(article)

    Path(OUTPUT).parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

    print(f"Écrit : {OUTPUT} ({len(articles)} articles)")


if __name__ == '__main__':
    main()
