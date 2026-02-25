#!/usr/bin/env python3
"""
Convertit le fichier XLS d'index des articles en articles.json pour le site web.
À relancer à chaque mise à jour du fichier XLS.
"""
import xlrd, glob, json
from pathlib import Path

XLS_GLOB = "index_articles/*.xls"
OUTPUT   = "public/articles.json"

def main():
    files = glob.glob(XLS_GLOB)
    if not files:
        print(f"Aucun fichier .xls trouvé dans {XLS_GLOB}")
        return

    xls_path = files[0]
    print(f"Lecture de : {xls_path}")

    wb = xlrd.open_workbook(xls_path)
    sh = wb.sheets()[0]
    print(f"  {sh.nrows - 1} articles, {sh.ncols} colonnes")

    months_fr = ['janvier','février','mars','avril','mai','juin',
                 'juillet','août','septembre','octobre','novembre','décembre']

    articles = []
    for i in range(1, sh.nrows):
        rubrique = str(sh.cell_value(i, 0)).strip()
        titre    = str(sh.cell_value(i, 1)).strip()
        auteur   = str(sh.cell_value(i, 2)).strip()
        raw_date = sh.cell_value(i, 3)
        refnum   = sh.cell_value(i, 4)
        numero   = str(sh.cell_value(i, 5)).strip()

        if raw_date:
            from xlrd import xldate_as_datetime
            dt = xldate_as_datetime(raw_date, wb.datemode)
            date_str     = dt.strftime('%Y-%m-%d')
            date_display = f"{months_fr[dt.month - 1]} {dt.year}"
            year         = dt.year
        else:
            date_str = date_display = ''
            year = None

        bulletin_num = numero.replace('/bulletins/', '').replace('.pdf', '') if numero else ''

        articles.append({
            'rubrique':    rubrique,
            'titre':       titre,
            'auteur':      auteur,
            'date':        date_str,
            'dateDisplay': date_display,
            'year':        year,
            'bulletinNum': bulletin_num,
            'bulletinPath': numero,
            'refnum':      int(refnum) if refnum else 0,
        })

    Path(OUTPUT).parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

    print(f"Écrit : {OUTPUT} ({len(articles)} articles)")

if __name__ == '__main__':
    main()
