"""Download every Bokmålsordboka article from the official open API (ord.uib.no, CC-BY 4.0).
Resumable: appends to raw/ordbok/articles.jsonl, skips ids already present."""
import json, os, sys, time, threading, http.client, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw', 'ordbok')
LIST = os.path.join(RAW, 'article_list.json')
OUT = os.path.join(RAW, 'articles.jsonl')
UA = {'User-Agent': 'oppslag-dictionary-builder/1.0 (personal offline study app)'}

def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 ** i)

_tl = threading.local()
def get_keepalive(path, tries=6):
    for i in range(tries):
        try:
            c = getattr(_tl, 'c', None)
            if c is None:
                c = _tl.c = http.client.HTTPSConnection('ord.uib.no', timeout=30)
            c.request('GET', path, headers=UA)
            r = c.getresponse(); body = r.read()
            if r.status == 200: return body
            if r.status == 404: return None
            raise Exception(f'HTTP {r.status}')
        except Exception:
            try: _tl.c.close()
            except Exception: pass
            _tl.c = None
            if i == tries - 1: raise
            time.sleep(2 ** i)

if not os.path.exists(LIST):
    open(LIST, 'wb').write(get('https://ord.uib.no/bm/fil/article.json'))
ids = [a[0] for a in json.load(open(LIST))]
done = set()
if os.path.exists(OUT):
    for line in open(OUT):
        try: done.add(json.loads(line)['article_id'])
        except Exception: pass
todo = [i for i in ids if i not in done]
print(f'{len(ids)} articles, {len(done)} done, {len(todo)} to fetch', flush=True)
fails = 0
with open(OUT, 'a') as out, ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(get_keepalive, f'/bm/article/{i}.json'): i for i in todo}
    for n, f in enumerate(as_completed(futs), 1):
        try:
            b = f.result()
            if b is None: continue
            d = json.loads(b); out.write(json.dumps(d, ensure_ascii=False) + '\n')
        except Exception as e:
            fails += 1; print('fail', futs[f], e, flush=True)
        if n % 2000 == 0: out.flush(); print(n, 'fetched', flush=True)
print('done; failures:', fails)
