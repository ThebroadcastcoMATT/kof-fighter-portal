"""Photo worker for the fighter portal.

Finds fighters whose photo was uploaded in the portal but not yet cut out (photo_status = 'raw'), runs
each through cutout.py (background removal + face-anchored 4:5 framing + grade, same as the rest of the
card), uploads the result to fight-photos/cut/ and marks the fighter done.

    python worker.py            process new uploads
    python worker.py --seed DIR import the app's built-in cut-outs (DIR/card.json + DIR/photos/) for
                                fighters that have no photo online yet

Uses the public (publishable) key: the fighter tables and photo bucket are open by design.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.parse

URL = os.environ.get('FN_URL', 'https://zyqahczlvcbfaplckeyi.supabase.co')
KEY = os.environ.get('FN_KEY', 'sb_publishable_NxUXvmtqPOncQRrBkGLMMA_xn9bw4lY')
BUCKET = 'fight-photos'
HERE = os.path.dirname(os.path.abspath(__file__))


def api(method, path, body=None, headers=None, raw=False):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    h.update(headers or {})
    data = body
    if body is not None and not isinstance(body, (bytes, bytearray)):
        data = json.dumps(body).encode()
        h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=120) as r:
        out = r.read()
    return out if raw else (json.loads(out) if out else None)


def update(fid, fields):
    api('PATCH', f'/rest/v1/fn_fighters?id=eq.{urllib.parse.quote(fid)}', fields, {'Prefer': 'return=minimal'})


def upload(path, data, ctype):
    api('POST', f'/storage/v1/object/{BUCKET}/{path}', data, {'Content-Type': ctype, 'x-upsert': 'true'})


def public_url(path):
    return f'{URL}/storage/v1/object/public/{BUCKET}/' + '/'.join(urllib.parse.quote(p) for p in path.split('/'))


def process_new():
    todo = api('GET', '/rest/v1/fn_fighters?photo_status=eq.raw&select=id,first,last,photo_raw_path')
    print(f'{len(todo)} photo(s) to cut out')
    for f in todo:
        name = f"{f['first']} {f['last']}".strip()
        raw = f['photo_raw_path']
        try:
            update(f['id'], {'photo_status': 'processing'})
            with tempfile.TemporaryDirectory() as tmp:
                src = os.path.join(tmp, 'in' + os.path.splitext(raw)[1])
                dst = os.path.join(tmp, 'out.webp')
                with urllib.request.urlopen(public_url(raw), timeout=120) as r, open(src, 'wb') as fh:
                    fh.write(r.read())
                # One process per photo: the model holds a lot of memory.
                subprocess.run([sys.executable, os.path.join(HERE, 'cutout.py'), src, dst], check=True)
                path = f"cut/{f['id']}-{int(time.time()):x}.webp"
                with open(dst, 'rb') as fh:
                    upload(path, fh.read(), 'image/webp')
            update(f['id'], {'photo_path': path, 'photo_status': 'done'})
            print(f'  done: {name}')
        except Exception as err:  # keep going with the others
            print(f'  FAILED: {name}: {err}')
            try:
                update(f['id'], {'photo_status': 'failed'})
            except Exception:
                pass


def import_seed(seed_dir):
    card = json.load(open(os.path.join(seed_dir, 'card.json')))
    online = {f['id']: f for f in api('GET', '/rest/v1/fn_fighters?select=id,photo_path,photo_raw_path')}
    n = 0
    for f in card['fighters']:
        o = online.get(f['id'])
        if not f.get('photo') or not o or o['photo_path'] or o['photo_raw_path']:
            continue
        with open(os.path.join(seed_dir, 'photos', f['photo']), 'rb') as fh:
            path = f"cut/{f['photo']}"
            upload(path, fh.read(), 'image/webp')
        update(f['id'], {'photo_path': path, 'photo_status': 'done', 'updated_by': 'Graphics team'})
        n += 1
        print(f"  imported: {f['first']} {f['last']}")
    print(f'{n} photo(s) imported')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--seed':
        import_seed(sys.argv[2])
    else:
        process_new()
