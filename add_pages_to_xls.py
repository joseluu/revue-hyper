#!/usr/bin/env python3
"""
Ajoute une colonne 'page' au fichier XLS en utilisant le parsing SOMMAIRE des markdown.
Matching amélioré: substring exact + scoring par mots communs.
Génère un nouveau fichier XLS avec la colonne page pré-remplie (663/900).
"""
import re, os, glob, unicodedata
import xlrd, xlwt

XLS_INPUT = "index_articles/Rubriques Revue Hyper jusqu`à décembre 2024.xls"
XLS_OUTPUT = "index_articles/Rubriques_avec_pages.xls"
MD_DIR = "markdown"


def normalize(s):
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()


def parse_sommaire(md_path):
    if not os.path.exists(md_path):
        return []
    content = open(md_path).read()
    som = re.search(r'SOMMAIRE', content, re.IGNORECASE)
    if not som:
        return []
    pos = som.start()
    zone = content[max(0, pos - 3000):min(len(content), pos + 3000)]
    entries = []
    seen = set()

    def add(page, title=''):
        if 2 <= page <= 50 and page not in seen:
            seen.add(page)
            entries.append({'page': page, 'title': title})

    # Strategy A
    for m in re.finditer(r'^-\s*\d+\)\s*(.+?)\s*\.{2,}\s*(\d+)\s*$', zone, re.MULTILINE):
        add(int(m.group(2)), m.group(1).strip())
    # Strategy B
    if not entries:
        bm = []
        for m in re.finditer(r'([A-ZÀ-Ÿ][^\n|]*?)\.{3,}\s*(\d+)', zone):
            bm.append({'page': int(m.group(2)), 'title': m.group(1).strip()})
        if len(bm) >= 2:
            for e in bm:
                add(e['page'], e['title'])
    # Strategy C
    if not entries:
        for m in re.finditer(r'[Pp]\s*-\s*(\d+)\s*(.*?)(?:<br|[|\n]|$)', zone):
            add(int(m.group(1)), m.group(2).strip())
        for m in re.finditer(r'pages?\s+(\d+)\s*(.*?)(?:<br|[|\n]|$)', zone, re.IGNORECASE):
            add(int(m.group(1)), m.group(2).strip())
        for m in re.finditer(r'(?:^|[|\n]|<br\s*/?>)\s*[Pp]\s*(\d+)\s*(.*?)(?:<br|[|\n]|$)', zone, re.MULTILINE):
            add(int(m.group(1)), m.group(2).strip())
    entries.sort(key=lambda e: e['page'])
    return entries


def word_set(s):
    return set(w for w in normalize(s).split() if len(w) >= 3)


def find_best_match(entries, article_title):
    if not article_title or not entries:
        return 0
    nt = normalize(article_title)
    # 1. Exact substring
    for e in entries:
        if not e['title']:
            continue
        ne = normalize(e['title'])
        if nt in ne or ne in nt:
            return e['page']
    # 2. Word scoring
    scores = []
    for e in entries:
        if not e['title']:
            scores.append((0, e['page']))
            continue
        common = len(word_set(article_title) & word_set(e['title']))
        scores.append((common, e['page']))
    scores.sort(reverse=True)
    best_s, best_p = scores[0]
    second_s = scores[1][0] if len(scores) > 1 else 0
    if best_s >= 2 and best_s > second_s:
        return best_p
    if best_s >= 3 and best_s >= second_s:
        return best_p
    return 0


def main():
    print(f"Lecture de : {XLS_INPUT}")
    wb_in = xlrd.open_workbook(XLS_INPUT)
    sh = wb_in.sheets()[0]
    cache = {}

    wb_out = xlwt.Workbook(encoding='utf-8')
    ws = wb_out.add_sheet('Articles')

    # Date format for xlwt
    date_fmt = xlwt.XFStyle()
    date_fmt.num_format_str = 'DD/MM/YYYY'

    # Header
    headers = [sh.cell_value(0, c) for c in range(sh.ncols)] + ['page']
    for c, h in enumerate(headers):
        ws.write(0, c, h)

    matched = 0
    total = 0

    for i in range(1, sh.nrows):
        # Copy existing columns
        for c in range(sh.ncols):
            val = sh.cell_value(i, c)
            cell_type = sh.cell_type(i, c)
            if cell_type == xlrd.XL_CELL_DATE:
                ws.write(i, c, val, date_fmt)
            elif cell_type == xlrd.XL_CELL_NUMBER:
                ws.write(i, c, val)
            else:
                ws.write(i, c, val)

        titre = str(sh.cell_value(i, 1)).strip()
        numero = str(sh.cell_value(i, 5)).strip().replace('/bulletins/', '').replace('.pdf', '')

        if numero not in cache:
            cache[numero] = parse_sommaire(os.path.join(MD_DIR, f"{numero}.md"))

        page = find_best_match(cache[numero], titre)
        total += 1

        if page > 0:
            ws.write(i, sh.ncols, page)
            matched += 1
        else:
            ws.write(i, sh.ncols, '')

    wb_out.save(XLS_OUTPUT)
    print(f"\nÉcrit : {XLS_OUTPUT}")
    print(f"Articles avec page trouvée : {matched}/{total} ({100*matched/total:.1f}%)")
    print(f"Articles sans page (à compléter manuellement) : {total - matched}")


if __name__ == '__main__':
    main()
