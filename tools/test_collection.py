import io
import unittest
import zipfile

from collect_naver import attachments, parse_list
from prepare_library import candidates, content_hash, launch_identity, read_zip


def archive(files, compression=zipfile.ZIP_STORED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression) as output:
        for name, data in files.items():
            output.writestr(name, data)
    return buffer.getvalue()


class CollectionTests(unittest.TestCase):
    def test_legacy_list_and_attachment_hosts(self):
        self.assertEqual(parse_list('{"title":"a\\\'b"}')['title'], "a'b")
        html = '<a href="https://download.blog.naver.com/open/test/game.apk">file</a><a href="https://other.example/evil.zip">file</a>'
        self.assertEqual(list(attachments(html)), [('game.apk', 'https://download.blog.naver.com/open/test/game.apk')])

    def test_archive_order_and_compression_do_not_change_content_identity(self):
        files = {'__adf__': b'Name: Test\nAID:1\nPID:2\n', '1.jar': b'game'}
        a = list(candidates(archive(files), 'a.zip'))[0]
        b = list(candidates(archive(dict(reversed(list(files.items()))), zipfile.ZIP_DEFLATED), 'b.zip'))[0]
        self.assertEqual(content_hash(a['files']), content_hash(b['files']))
        changed = dict(files, **{'1.jar': b'different version'})
        self.assertNotEqual(content_hash(files), content_hash(changed))

    def test_nested_game_and_android_exclusion(self):
        data = archive({'folder/__adf__': b'Name: Sample\n', 'folder/1.jar': b'game'})
        games = list(candidates(archive({'game.zip': data, 'phone.apk': b'apk'}), 'outer.zip'))
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]['title'], 'Sample')
        self.assertIn('__adf__', games[0]['files'])
        self.assertEqual(list(candidates(archive({'AndroidManifest.xml': b'android', 'classes.dex': b'dex'}), 'android.zip')), [])

    def test_traversal_is_rejected_without_extracting(self):
        with self.assertRaises(ValueError):
            read_zip(archive({'../outside': b'x'}))

    def test_ktf_download_identifier_aliases_preserve_real_variants(self):
        a = {'__adf__': b'AID:010100D3\nPID:same\nDisplaySize:176*220\n', '010100D3.jar': b'game'}
        b = {'__adf__': b'AID:010378DB\nPID:same\nDisplaySize:176*220\n', '010378DB.jar': b'game'}
        self.assertEqual(launch_identity(a), launch_identity(b))
        b['010378DB.jar'] = b'other game build'
        self.assertNotEqual(launch_identity(a), launch_identity(b))
        b['010378DB.jar'] = b'game'
        b['__adf__'] = b'AID:010378DB\nPID:same\nDisplaySize:240*320\n'
        self.assertNotEqual(launch_identity(a), launch_identity(b))


if __name__ == '__main__':
    unittest.main()
