"""Extract an untrusted ADP without changing its bytes. Called only by release CI."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile


def extract(archive, destination):
    root = Path(destination)
    root.mkdir(exist_ok=False)
    inventory = []
    with zipfile.ZipFile(archive) as package:
        members = package.infolist()
        if len(members) > 10000 or sum(m.file_size for m in members) > 2_000_000_000:
            raise ValueError("ADP exceeds extraction limits")
        names = set()
        for member in members:
            raw = member.filename
            name = PurePosixPath(raw)
            mode = member.external_attr >> 16
            if (name.is_absolute() or '..' in name.parts or '\\' in raw or
                    any(ord(c) < 32 for c in raw) or ':' in raw or '%' in raw or
                    '#' in raw or '?' in raw or not name.parts or
                    stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
                raise ValueError("Unsafe ADP archive entry")
            normalized = str(name)
            if normalized.casefold() in names:
                raise ValueError("Duplicate ADP archive entry")
            names.add(normalized.casefold())
            target = root.joinpath(*name.parts)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if member.file_size > 99_000_000:
                raise ValueError("ADP file exceeds GitHub hosting limit; use object storage before publishing")
            target.parent.mkdir(parents=True, exist_ok=True)
            # ZIP reader verifies CRC; permissions from the archive are not used.
            with package.open(member) as source, target.open('xb') as output:
                digest = hashlib.sha256()
                size = 0
                while data := source.read(1024 * 1024):
                    size += len(data)
                    if size > member.file_size:
                        raise ValueError("ADP size mismatch")
                    digest.update(data)
                    output.write(data)
            if size != member.file_size:
                raise ValueError("Truncated ADP")
            inventory.append({'path': normalized, 'size': size, 'sha256': digest.hexdigest()})
    if not (root / 'manifest.json').is_file():
        raise ValueError("ADP must have a root manifest.json")
    return inventory


if __name__ == '__main__':
    try:
        print(json.dumps(extract(sys.argv[1], sys.argv[2])))
    except Exception:
        # Do not echo archive names or provider URLs to the runner logs.
        print('ADP extraction failed validation', file=sys.stderr)
        sys.exit(1)
