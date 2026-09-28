"""Collect public game attachments with resumable provenance records.

Usage: python tools/collect_naver.py --output C:/path/to/collection
Dependencies: requests, beautifulsoup4. Originals are never removed.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import time
from urllib.parse import unquote, unquote_plus, urlparse

import requests
from bs4 import BeautifulSoup

EXTENSIONS = {'.zip', '.jar', '.jad', '.alz', '.egg', '.7z', '.rar', '.apk', '.sis', '.sisx', '.cab'}


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name).strip(' .')[:160] or 'attachment'


def parse_list(text):
    # This legacy endpoint emits JavaScript's \' escape, which is invalid JSON.
    return json.loads(text.replace("\\'", "'"))


def attachments(text):
    soup = BeautifulSoup(text, 'html.parser')
    found = {}
    for a in soup.select('a[href]'):
        url = a['href']
        name = unquote(urlparse(url).path.rsplit('/', 1)[-1])
        if Path(name).suffix.lower() in EXTENSIONS and allowed_host(url):
            found.setdefault(name, url)
    for match in re.finditer(r'"encodedAttachFileName"\s*:\s*"((?:\\.|[^"\\])*)".*?"encodedAttachFileUrl"\s*:\s*"((?:\\.|[^"\\])*)"', text):
        name, url = (html.unescape(v.replace('\\/', '/').replace("\\'", "'")) for v in match.groups())
        if Path(name).suffix.lower() in EXTENSIONS and allowed_host(url):
            found.setdefault(name, url)
    return found.items()


def allowed_host(url):
    parsed = urlparse(url)
    return parsed.scheme == 'https' and parsed.hostname in {
        'download.blog.naver.com', 'blogfiles.pstatic.net', 'blogfiles.naver.net',
        'postfiles.pstatic.net', 'attachment.blog.naver.com',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--blog', default='palletshipping')
    args = parser.parse_args()
    root = args.output / 'naver_games' / args.blog
    root.mkdir(parents=True, exist_ok=True)
    manifest = root / 'collection.json'
    state = json.loads(manifest.read_text('utf-8')) if manifest.exists() else {'blog': args.blog, 'posts': {}, 'files': [], 'errors': []}
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'})

    def get(url, **kwargs):
        for attempt in range(3):
            try:
                response = session.get(url, timeout=(15, 60), **kwargs)
                response.raise_for_status()
                response.encoding = 'utf-8'
                return response
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(2 ** (attempt + 1))

    def save():
        temp = manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), 'utf-8')
        temp.replace(manifest)

    posts = {}
    page = 1
    while True:
        url = f'https://blog.naver.com/PostTitleListAsync.naver?blogId={args.blog}&currentPage={page}&categoryNo=0&parentCategoryNo=0&countPerPage=30'
        data = parse_list(get(url).text)
        items = data.get('postList', [])
        before = len(posts)
        for post in items:
            posts[post['logNo']] = unquote_plus(post['title'])
        print(f'LIST {page}: {len(posts)}/{data.get("totalCount")}', flush=True)
        if len(posts) >= int(data.get('totalCount', 0)) or len(posts) == before:
            break
        page += 1
        time.sleep(0.6)
    state['discovered_posts'] = len(posts)
    downloaded = {(f['post_id'], f['filename']): f for f in state['files']}
    state['errors'] = []
    for index, (post_id, title) in enumerate(posts.items(), 1):
        if state['posts'].get(post_id, {}).get('complete'):
            continue
        url = f'https://blog.naver.com/PostView.naver?blogId={args.blog}&logNo={post_id}'
        complete = True
        try:
            files = list(attachments(get(url).text))
            for filename, file_url in files:
                existing = downloaded.get((post_id, filename))
                if existing and (root / existing['path']).exists():
                    continue
                folder = root / f'{post_id} {safe_name(title)[:80]}'
                folder.mkdir(exist_ok=True)
                path = folder / safe_name(filename)
                try:
                    response = get(file_url, headers={'Referer': url}, stream=True)
                    if 'text/html' in response.headers.get('content-type', ''):
                        raise ValueError('Download returned an HTML page')
                    digest = hashlib.sha256()
                    size = 0
                    temp = path.with_suffix(path.suffix + '.part')
                    with temp.open('wb') as output:
                        for chunk in response.iter_content(128 * 1024):
                            output.write(chunk)
                            digest.update(chunk)
                            size += len(chunk)
                    expected = response.headers.get('content-length')
                    if size == 0 or (expected and size != int(expected)):
                        raise ValueError('Incomplete download')
                    temp.replace(path)
                    record = dict(post_id=post_id, title=title, post_url=url, download_url=file_url, filename=filename,
                                  path=path.relative_to(root).as_posix(), bytes=size, sha256=digest.hexdigest())
                    state['files'].append(record)
                    downloaded[(post_id, filename)] = record
                except Exception as error:
                    state['errors'].append(dict(post=url, filename=filename, error=str(error)))
                    complete = False
                time.sleep(0.3)
            state['posts'][post_id] = dict(title=title, url=url, attachments=len(files), complete=complete)
            print(f'POST {index}/{len(posts)} | {title} | {len(files)} files | total {len(state["files"])} | errors {len(state["errors"])}', flush=True)
        except Exception as error:
            state['errors'].append(dict(post=url, error=str(error)))
            print(f'ERROR {url}: {error}', flush=True)
        save()
        time.sleep(0.7)
    print(f'DONE files={len(state["files"])} errors={len(state["errors"])} manifest={manifest}', flush=True)


if __name__ == '__main__':
    main()
