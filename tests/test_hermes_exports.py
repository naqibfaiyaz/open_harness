"""Exercise the actual no-follow reader without requiring the dashboard web framework."""
import ast
import os
import re
import stat
import tempfile
import unittest
from pathlib import Path, PurePosixPath

source = Path(__file__).resolve().parents[1] / 'integrations/hermes-titles/dashboard/api.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
reader_node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'read_export')
namespace = {'os': os, 're': re, 'stat': stat, 'PurePosixPath': PurePosixPath}
exec(compile(ast.Module(body=[reader_node], type_ignores=[]), str(source), 'exec'), namespace)
read_export = namespace['read_export']


@unittest.skipUnless(hasattr(os, 'O_NOFOLLOW'), 'Requires POSIX directory descriptors')
class Exports(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.session = 'a' * 64
        self.folder = self.root / self.session
        self.folder.mkdir()
        (self.folder / 'plot.png').write_bytes(b'actual export')

    def test_regular_file_and_bounds(self):
        self.assertEqual(read_export(str(self.root), self.session, 'plot.png', 100), b'actual export')
        with self.assertRaises(ValueError):
            read_export(str(self.root), self.session, 'plot.png', 2)
        for name in ['../plot.png', '/etc/passwd', 'nested/plot.png', '..', 'bad\\plot.png']:
            with self.assertRaises(ValueError):
                read_export(str(self.root), self.session, name, 100)

    def test_foreign_session_and_symlinks(self):
        with self.assertRaises(OSError):
            read_export(str(self.root), 'b' * 64, 'plot.png', 100)
        (self.folder / 'link.png').symlink_to(self.folder / 'plot.png')
        with self.assertRaises(OSError):
            read_export(str(self.root), self.session, 'link.png', 100)
        (self.root / ('c' * 64)).symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(OSError):
            read_export(str(self.root), 'c' * 64, 'plot.png', 100)

    def test_hardlinks_and_special_files(self):
        os.link(self.folder / 'plot.png', self.folder / 'hard.png')
        with self.assertRaises(ValueError):
            read_export(str(self.root), self.session, 'hard.png', 100)
        os.mkfifo(self.folder / 'pipe.png')
        with self.assertRaises(ValueError):
            read_export(str(self.root), self.session, 'pipe.png', 100)


if __name__ == '__main__':
    unittest.main()
