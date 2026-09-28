"""Index local collections, report exact/content duplicates, prepare launch copies.

Never deletes or changes source games. APKs are catalogued but never launchable.
"""
import argparse
import base64
import collections
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

MAX_EXPANDED = 256 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_member(name):
    path = PurePosixPath(name.replace('\\', '/'))
    return not path.is_absolute() and '..' not in path.parts and ':' not in name


def read_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
        if sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError('압축 해제 크기 제한 초과')
        if any(not safe_member(i.filename) for i in infos):
            raise ValueError('안전하지 않은 압축 경로')
        return {i.filename.replace('\\', '/'): archive.read(i) for i in infos}


def content_hash(files):
    digest = hashlib.sha256()
    for name, data in sorted(files.items()):
        encoded = name.encode('utf-8')
        digest.update(len(encoded).to_bytes(4, 'big'))
        digest.update(encoded)
        digest.update(len(data).to_bytes(8, 'big'))
        digest.update(data)
    return digest.hexdigest()


def launch_identity(files):
    # KTF downloads can assign a different AID and JAR filename to identical
    # game bytes. Normalize only that identifier for comparison, never on disk.
    adf = files.get('__adf__', b'')
    match = re.search(rb'^AID:\s*([0-9A-Fa-f]{8})\s*$', adf, re.M)
    if not match:
        return content_hash(files)
    aid = match.group(1)
    canonical = {name.replace(aid.decode('ascii'), 'APPID'):
                 (data.replace(aid, b'APPID') if name in ('__adf__', '__class__', '__env__') else data)
                 for name, data in files.items()}
    return content_hash(canonical)


def convert_archive(path, archiver, cache):
    """Use an installed archiver only after validating its complete member list."""
    listing = subprocess.run([str(archiver), 'l', str(path)], capture_output=True, check=True)
    text = listing.stdout.decode('utf-8', 'replace')
    members = re.findall(r'^\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d\s+\S+\s+(\d+)\s+\d+\s+(.+)$', text, re.M)
    if not members or any(not safe_member(name.strip()) for _, name in members):
        raise ValueError('압축 파일 경로 목록을 검증할 수 없음')
    if sum(int(size) for size, _ in members) > MAX_EXPANDED:
        raise ValueError('압축 해제 크기 제한 초과')
    destination = cache / sha(path.read_bytes())
    destination.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(archiver), 'x', '-y', '-aos', '-o:' + str(destination.resolve()), str(path)], capture_output=True, check=True)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for member in destination.rglob('*'):
            if member.is_file():
                if not member.resolve().is_relative_to(destination.resolve()) or member.is_symlink():
                    raise ValueError('압축 폴더 밖의 파일')
                archive.writestr(member.relative_to(destination).as_posix(), member.read_bytes())
    return buffer.getvalue()


def title_from_name(name):
    title = Path(name.split('!')[-1]).stem
    try:
        repaired = title.encode('cp437').decode('cp949')
        if re.search('[가-힣]', repaired):
            title = repaired
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return re.sub(r'^\s*[\[(](?:KTF|SKT|LGT|J2ME)[\])]\s*', '', title, flags=re.I).replace('_', ' ').strip()


def classify(files, fallback):
    if '__adf__' in files:
        text = files['__adf__'].decode('cp949', 'replace')
        title = re.search(r'^Name:\s*(.*)', text, re.M)
        return 'KTF', title.group(1).strip() if title else fallback
    if 'app_info' in files:
        return 'LGT', fallback
    if any(n.lower().endswith('.msd') for n in files):
        return 'SKT', fallback
    return 'J2ME', fallback


def icon_data(files):
    for name in ('big.icon', 'middle.icon', 'small.icon'):
        data = files.get(name, b'')
        if data.startswith(b'\x89PNG') or data.startswith(b'BM'):
            mime = 'image/png' if data.startswith(b'\x89PNG') else 'image/bmp'
            return f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')
    return None


def candidates(data, label, depth=0):
    if depth > 4:
        raise ValueError('중첩 압축 깊이 제한 초과')
    files = read_zip(data)
    # Actual Android packages and their wrappers are retained only as collection items.
    if 'AndroidManifest.xml' in files:
        return
    descriptors = [n for n in files if PurePosixPath(n).name in ('__adf__', 'app_info') or n.lower().endswith('.msd')]
    roots = set(str(PurePosixPath(n).parent) for n in descriptors)
    consumed = set()
    for root in sorted(roots):
        prefix = '' if root == '.' else root + '/'
        group = {n[len(prefix):]: b for n, b in files.items() if n.startswith(prefix)}
        if not any(n.lower().endswith('.jar') for n in group):
            continue
        consumed.update(n for n in files if n.startswith(prefix))
        carrier, title = classify(group, title_from_name(label if root == '.' else root))
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, body in sorted(group.items()):
                archive.writestr(name, body)
        yield dict(data=output.getvalue(), files=group, carrier=carrier, title=title, extension='.zip', source=label)
    for name, body in files.items():
        if name in consumed:
            continue
        if name.lower().endswith('.zip'):
            yield from candidates(body, label + '!' + name, depth + 1)
        elif name.lower().endswith('.jar'):
            try:
                jar_files = read_zip(body)
            except zipfile.BadZipFile:
                continue  # A native SKT JAR without its MSD is incomplete.
            manifest = jar_files.get('META-INF/MANIFEST.MF', b'').decode('utf-8', 'replace')
            if not re.search(r'^(MIDlet-1|Main-Class):', manifest, re.M):
                continue
            title = re.search(r'^MIDlet-Name:\s*(.*)', manifest, re.M)
            yield dict(data=body, files=jar_files, carrier='J2ME', title=title.group(1).strip() if title else title_from_name(label), extension='.jar', source=label + '!' + name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--archiver', type=Path, help='Optional path to installed Bandizip bz.exe for ALZ/EGG/RAR/7Z')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'files').mkdir(exist_ok=True)
    args.report.mkdir(parents=True, exist_ok=True)
    originals = collections.defaultdict(list)
    semantic = collections.defaultdict(list)
    aliases = collections.defaultdict(list)
    games = {}
    excluded = []
    scanned = []
    for root in args.source:
        for path in sorted(root.rglob('*')):
            if not path.is_file() or path.suffix.lower() not in {'.zip', '.jar', '.apk', '.alz', '.egg', '.7z', '.rar', '.sis', '.cab'}:
                continue
            raw = path.read_bytes()
            digest = sha(raw)
            originals[digest].append(str(path))
            scanned.append(dict(path=str(path), sha256=digest, bytes=len(raw)))
            try:
                if path.suffix.lower() == '.apk' or '[APK]' in str(path) or '(안드로이드)' in str(path):
                    excluded.append(dict(path=str(path), reason='Android APK (수집 전용)'))
                    continue
                if path.suffix.lower() not in {'.zip', '.jar'}:
                    if args.archiver and path.suffix.lower() in {'.alz', '.egg', '.rar', '.7z'}:
                        raw = convert_archive(path, args.archiver, args.report / 'unpacked')
                    else:
                        excluded.append(dict(path=str(path), reason='별도 압축 해제 필요'))
                        continue
                if args.archiver and raw.startswith((b'Rar!', b'ALZ\x01', b'7z\xbc\xaf\x27\x1c')):
                    raw = convert_archive(path, args.archiver, args.report / 'unpacked')
                found = list(candidates(raw, str(path)))
                if path.suffix.lower() == '.jar' and not found:
                    jar = read_zip(raw)
                    if b'MIDlet-' in jar.get('META-INF/MANIFEST.MF', b''):
                        found = [dict(data=raw, files=jar, carrier='J2ME', title=title_from_name(path.name), extension='.jar', source=str(path))]
                if not found:
                    files = read_zip(raw)
                    reason = 'Android APK (수집 전용)' if any(n.lower().endswith('.apk') for n in files) or 'AndroidManifest.xml' in files else '실행에 필요한 피처폰 메타데이터 없음'
                    excluded.append(dict(path=str(path), reason=reason))
                for game in found:
                    exact_content = content_hash(game['files'])
                    semantic[exact_content].append(game['source'])
                    ident = launch_identity(game['files'])
                    aliases[ident].append(dict(content_hash=exact_content, source=game['source']))
                    if ident in games:
                        continue
                    filename = ident + game['extension']
                    destination = args.output / 'files' / filename
                    if not destination.exists():
                        destination.write_bytes(game['data'])
                    games[ident] = dict(id=ident, title=game['title'], carrier=game['carrier'], filename=filename,
                                       icon=icon_data(game['files']), bytes=len(game['data']), source=game['source'])
            except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, subprocess.CalledProcessError) as error:
                excluded.append(dict(path=str(path), reason=str(error)))
    entries = sorted(games.values(), key=lambda g: (g['title'], g['carrier']))
    report = dict(scanned_files=len(scanned), launch_entries=len(entries), carriers=dict(collections.Counter(g['carrier'] for g in entries)),
                  exact_duplicates=[dict(sha256=k, paths=v) for k, v in originals.items() if len(v) > 1],
                  content_duplicates=[dict(sha256=k, paths=v) for k, v in semantic.items() if len(v) > 1], excluded=excluded)
    report['ktf_identifier_aliases'] = [dict(id=k, copies=v) for k, v in aliases.items() if len({x['content_hash'] for x in v}) > 1]
    (args.output / 'catalog.json').write_text(json.dumps(entries, ensure_ascii=False), 'utf-8')
    (args.report / 'duplicates.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    (args.report / 'source-hashes.json').write_text(json.dumps(scanned, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('exact_duplicates','content_duplicates','excluded','ktf_identifier_aliases')}, ensure_ascii=False))
    print(f'Exact groups: {len(report["exact_duplicates"])}; content groups: {len(report["content_duplicates"])}; excluded: {len(excluded)}')


if __name__ == '__main__':
    main()
