#!/usr/bin/env python3
"""
Fills the 'page' column of an index CSV in place from SOMMAIRE markdown extraction.

Only fills rows where 'page' is currently empty — existing values are preserved.
For each remaining article, parses markdown/<numero>.md to extract a SOMMAIRE
table of contents (3 fallback strategies) and matches the article title against
the entries (exact substring + word-overlap scoring).

Usage:
    .venv/bin/python3 add_pages_to_xls.py [path/to/index.csv]

Defaults to the current working CSV if no path is given.
"""
import sys, csv, os, re, unicodedata

DEFAULT_CSV = "index_articles/Rubriques Revue Hyper jusqu`à décembre 2025_2026-03-22.csv"
MD_DIR = "markdown"


def normalize(s):
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()


def parse_sommaire(md_path):
    if not os.path.exists(md_path):
        return []
    content = open(md_path, encoding='utf-8').read()
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
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    print(f"File to alter: {csv_path}")

    with open(csv_path, encoding='cp1252', newline='') as f:
        rows = list(csv.reader(f, delimiter='\t'))

    header, body = rows[0], rows[1:]
    if 'page' not in header:
        header = header + ['page']
        body = [r + [''] for r in body]

    page_idx   = header.index('page')
    titre_idx  = header.index('titre')
    numero_idx = header.index('numero')

    filled_before = sum(1 for r in body if r[page_idx].strip())
    cache = {}
    newly_filled = 0
    no_md = no_match = 0

    for r in body:
        if r[page_idx].strip():
            continue
        numero = r[numero_idx].replace('/bulletins/', '').replace('.pdf', '').strip()
        if numero not in cache:
            cache[numero] = parse_sommaire(os.path.join(MD_DIR, f"{numero}.md"))
        if not cache[numero]:
            no_md += 1
            continue
        page = find_best_match(cache[numero], r[titre_idx].strip())
        if page > 0:
            r[page_idx] = str(page)
            newly_filled += 1
        else:
            no_match += 1

    with open(csv_path, 'w', encoding='cp1252', newline='') as f:
        w = csv.writer(f, delimiter='\t', lineterminator='\r\n')
        w.writerow(header)
        w.writerows(body)

    total = len(body)
    filled_after = sum(1 for r in body if r[page_idx].strip())
    print(f"Total articles      : {total}")
    print(f"Already had page    : {filled_before}")
    print(f"Newly filled        : {newly_filled}")
    print(f"No SOMMAIRE found   : {no_md}")
    print(f"SOMMAIRE, no match  : {no_match}")
    print(f"Total with page now : {filled_after} ({100*filled_after/total:.1f}%)")


if __name__ == '__main__':
    main()
