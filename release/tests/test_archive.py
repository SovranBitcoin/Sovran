import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('release_archive', Path(__file__).parents[1] / 'archive.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class ArchiveTests(unittest.TestCase):
    def extract(self, entries):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / 'package.zip'
            with zipfile.ZipFile(package, 'w') as output:
                for name, data in entries:
                    output.writestr(name, data)
            destination = Path(directory) / 'expanded'
            inventory = archive.extract(package, destination)
            return inventory, (destination / 'manifest.json').read_bytes()

    def test_bytes_preserved(self):
        manifest = b'{ "signed": true }\n'
        inventory, actual = self.extract([('manifest.json', manifest), ('variant/asset', b'\x00\xff')])
        self.assertEqual(actual, manifest)
        self.assertEqual(len(inventory), 2)

    def test_traversal_absolute_and_url_paths_rejected(self):
        for path in ['../escape', '/absolute', 'a/../../escape', 'a\\escape', 'a%2fb', 'a?token=x', 'a#fragment']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.extract([('manifest.json', b'{}'), (path, b'bad')])

    def test_symlinks_rejected(self):
        info = zipfile.ZipInfo('link')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            self.extract([('manifest.json', b'{}'), (info, b'../../outside')])

    def test_case_collisions_rejected(self):
        with self.assertRaises(ValueError):
            self.extract([('manifest.json', b'{}'), ('MANIFEST.JSON', b'changed')])

    def test_missing_root_manifest_rejected(self):
        with self.assertRaises(ValueError):
            self.extract([('nested/manifest.json', json.dumps({}))])


if __name__ == '__main__':
    unittest.main()
