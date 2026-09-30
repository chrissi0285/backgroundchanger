#!/usr/bin/env python3
"""Isolated release gate tests; no network, credentials or real repository writes."""
import os
import io
import json
import hashlib
import base64
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID
from cryptography.exceptions import InvalidSignature
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

RELEASE = Path(__file__).with_name("release.py").resolve()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="backgroundchanger-release-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.env = dict(os.environ)
        for key in tuple(self.env):
            if key.startswith("GIT_"):
                del self.env[key]
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_AUTHOR_DATE="2026-01-01T00:00:00Z",
                        GIT_COMMITTER_DATE="2026-01-01T00:00:00Z")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Release fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        files = {"tests/check.sh": "#!/bin/sh\nexit 0\n", "appinfo/info.xml": '<info><id>backgroundchanger</id><name>BackgroundChanger</name><version>1.0.4</version></info>',
                 "appinfo/routes.php": "<?php return [];", "js/main.js": "// fixture",
                 "css/style.css": "/* fixture */", "js/ä.js": "// unicode fixture", "img/app.svg": "<svg/>",
                 "lib/App.php": "<?php", "README.md": "Fixture", "CHANGELOG.md": "Fixture", "LICENSE.md": "Fixture",
                 "tests/omit.py": "fixture", "build/omit.js": "fixture",
                 "appinfo/signature.json": "old fixture signature", "appinfo/test.key": "not a real key",
                 "js/build/omit.js": "fixture", "js/tests/omit.js": "fixture"}
        for name, data in files.items():
            self.put(name, data)
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("tag", "v1.0.4")

    def put(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], env=self.env, stderr=subprocess.PIPE)

    def build(self, ok=True, tag="v1.0.4", output=None):
        output = output or self.root / "app.tar.gz"
        result = subprocess.run([sys.executable, str(RELEASE), "build", "--repo", str(self.repo), "--tag", tag,
                                 "--output", str(output)], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        if not ok:
            self.assertIn("Release rejected:", result.stderr)
            self.assertFalse(output.exists())
        return output

    def test_clean_deterministic_runtime(self):
        first = self.build()
        second = self.build(output=self.root / "second.tar.gz")
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with tarfile.open(first) as archive:
            names = archive.getnames()
            self.assertEqual(names, sorted(names))
            self.assertEqual(set(names), {"backgroundchanger/" + p for p in (
                "appinfo/info.xml", "appinfo/routes.php", "js/main.js", "css/style.css", "img/app.svg",
                "lib/App.php", "js/ä.js", "README.md", "CHANGELOG.md", "LICENSE.md")})
            for item in archive:
                self.assertTrue(item.isfile())
                self.assertEqual((item.uid, item.gid, item.mode, item.mtime), (0, 0, 0o644, 0))

    def test_origin_ancestor_allowed(self):
        self.git("commit", "--allow-empty", "-qm", "local descendant")
        self.git("tag", "-f", "v1.0.4")
        self.build()

    def test_annotated_tag(self):
        self.git("tag", "-d", "v1.0.4")
        self.git("tag", "-a", "v1.0.4", "-m", "fixture release")
        self.build()

    def test_invalid_tag(self):
        self.build(False, tag="v01.0.4")

    def test_private_key_marker(self):
        # Marker only: no real or generated key.
        self.put("lib/Leak.php", "-----BEGIN PRIVATE KEY-----")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture marker")
        self.git("tag", "-f", "v1.0.4")
        self.build(False)

    def test_existing_output_preserved(self):
        path = self.build()
        before = path.read_bytes()
        result = subprocess.run([sys.executable, str(RELEASE), "build", "--repo", str(self.repo),
                                 "--tag", "v1.0.4", "--output", str(path)], env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"Output already exists", result.stderr)
        self.assertEqual(before, path.read_bytes())

    def test_dirty(self):
        self.put("js/main.js", "// dirty")
        self.build(False)

    def test_untracked(self):
        self.put("lib/new.php", "<?php")
        self.build(False)

    def test_ignored_source(self):
        self.put(".git/info/exclude", "lib/ignored.php\n")
        self.put("lib/ignored.php", "<?php")
        self.build(False)

    def test_missing_tag(self):
        self.git("tag", "-d", "v1.0.4")
        self.build(False)

    def test_wrong_tag_version(self):
        self.git("tag", "v1.0.3")
        self.build(False, tag="v1.0.3")

    def test_tag_not_head(self):
        self.git("commit", "--allow-empty", "-qm", "later")
        self.build(False)

    def test_missing_origin(self):
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        self.build(False)

    def test_origin_not_ancestor(self):
        old = self.git("rev-parse", "HEAD").decode().strip()
        self.git("commit", "--allow-empty", "-qm", "remote later")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("reset", "--hard", old)
        self.build(False)

    def test_wrong_identity(self):
        for field, replacement in (("BackgroundChanger", "WrongName"), ("backgroundchanger", "wrongid")):
            with self.subTest(field=field):
                self.put("appinfo/info.xml", '<info><id>backgroundchanger</id><name>BackgroundChanger</name><version>1.0.4</version></info>'.replace(field, replacement))
                self.git("add", ".")
                self.git("commit", "-qm", "wrong identity")
                self.git("tag", "-f", "v1.0.4")
                self.build(False)

    def test_symlink_runtime(self):
        (self.repo / "js/link.js").symlink_to("main.js")
        self.git("add", ".")
        self.git("commit", "-qm", "symlink")
        self.git("tag", "-f", "v1.0.4")
        self.build(False)

    def test_output_inside_repo(self):
        for name in ("build/release.tar.gz", "js/release.tar.gz", "release.tar.gz"):
            self.build(False, output=self.repo / name)

    def test_ignored_build_output(self):
        self.put(".git/info/exclude", "/build/\n")
        self.build(output=self.repo / "build/release.tar.gz")

    def test_output_symlinks_rejected(self):
        self.put(".git/info/exclude", "/build/\n")
        output = self.repo / "build/link.tar.gz"
        target = self.root / "missing.tar.gz"
        output.symlink_to(target)
        self.build(False, output=output)
        self.assertTrue(output.is_symlink())
        self.assertFalse(target.exists())
        output.unlink()
        # An ignored build path must not redirect writes into runtime.
        link = self.repo / "build/redirect"
        link.symlink_to(self.repo / "js", target_is_directory=True)
        self.build(False, output=link / "app.tar.gz")

    def test_check_failure_rejects_package(self):
        self.put("tests/check.sh", "#!/bin/sh\nexit 23\n")
        self.git("add", ".")
        self.git("commit", "-qm", "failing gate")
        self.git("tag", "-f", "v1.0.4")
        self.build(False)

    def credentials(self, cn="backgroundchanger", start=-1, end=1, mismatch=False):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now + timedelta(days=start))
                .not_valid_after(now + timedelta(days=end)).sign(key, hashes.SHA256()))
        if mismatch:
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.key = self.root / "fixture.key"
        self.cert = self.root / "fixture.crt"
        self.key.write_bytes(key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        self.key.chmod(0o600)
        self.cert.write_bytes(cert.public_bytes(serialization.Encoding.PEM))

    def sign(self, unsigned, ok=True, output=None, tag="v1.0.4"):
        output = output or self.root / "signed.tar.gz"
        before = unsigned.read_bytes()
        result = subprocess.run([sys.executable, str(RELEASE), "sign", "--repo", str(self.repo), "--unsigned", str(unsigned),
            "--key", str(self.key), "--certificate", str(self.cert), "--tag", tag,
            "--output", str(output)], capture_output=True)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        self.assertEqual(before, unsigned.read_bytes())
        if not ok:
            self.assertIn(b"Release rejected:", result.stderr)
        return output

    def test_sign_and_verify_php_payload(self):
        self.credentials()
        unsigned = self.build()
        with tarfile.open(unsigned, "r:gz") as archive:
            entries = [(m.name, archive.extractfile(m).read()) for m in archive]
        signed = self.sign(unsigned)
        with tarfile.open(signed) as archive:
            actual = {m.name: archive.extractfile(m).read() for m in archive}
        signature = json.loads(actual.pop("backgroundchanger/appinfo/signature.json"))
        self.assertEqual(actual, dict(entries))
        expected = {n.removeprefix("backgroundchanger/"): hashlib.sha512(b).hexdigest()
                    for n, b in sorted(entries)}
        self.assertEqual(signature["hashes"], expected)
        # Independent PHP serializer, not a copy of the Python signing serializer.
        payload = subprocess.check_output(["php", "-r",
            '$h=json_decode(stream_get_contents(STDIN),true); ksort($h); echo json_encode($h);'],
            input=json.dumps(expected).encode())
        public = x509.load_pem_x509_certificate(signature["certificate"].encode()).public_key()
        scheme = padding.PSS(mgf=padding.MGF1(hashes.SHA512()), salt_length=0)
        public.verify(base64.b64decode(signature["signature"]), payload, scheme, hashes.SHA1())
        with self.assertRaises(InvalidSignature):
            public.verify(base64.b64decode(signature["signature"]), payload + b"x", scheme, hashes.SHA1())
        saved = signed.read_bytes()
        self.sign(unsigned, False, output=signed)
        self.assertEqual(saved, signed.read_bytes())
        self.sign(unsigned, False, output=unsigned)
        self.sign(signed, False, output=self.root / "resigned.tar.gz")

    def test_bad_credentials(self):
        unsigned = self.build()
        for options in ({"cn": "otherapp"}, {"mismatch": True},
                        {"start": -3, "end": -1}, {"start": 1, "end": 3}):
            with self.subTest(options=options):
                self.credentials(**options)
                output = self.sign(unsigned, False)
                self.assertFalse(output.exists())

    def archive(self, path, entries):
        with tarfile.open(path, "w:gz") as archive:
            for name, data in entries:
                member = tarfile.TarInfo(name)
                if data is None:
                    member.type = tarfile.SYMTYPE
                    member.linkname = "/etc/passwd"
                    archive.addfile(member)
                else:
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))

    def test_sign_requires_clean_tagged_source(self):
        self.credentials()
        unsigned = self.build()
        self.put("js/main.js", "// dirty")
        self.assertFalse(self.sign(unsigned, False).exists())
        self.git("checkout", "--", "js/main.js")
        self.git("commit", "--allow-empty", "-qm", "later")
        self.assertFalse(self.sign(unsigned, False).exists())

    def test_unsafe_archives(self):
        self.credentials()
        unsigned = self.build()
        with tarfile.open(unsigned) as archive:
            entries = [(m.name, archive.extractfile(m).read()) for m in archive]
        for name, data in (("foreign/js/a.js", b"x"), ("backgroundchanger/js/../../a.js", b"x"),
                ("/backgroundchanger/js/a.js", b"x"), ("backgroundchanger/js//a.js", b"x"),
                ("backgroundchanger/js/./a.js", b"x"), ("backgroundchanger/js/link.js", None),
                ("backgroundchanger/tests/a.py", b"x"), entries[0],
                ("backgroundchanger/appinfo/signature.json", b"{}"),
                ("backgroundchanger/lib/leak.php", b"-----BEGIN PRIVATE KEY-----")):
            with self.subTest(name=name):
                self.archive(unsigned, entries + [(name, data)])
                self.assertFalse(self.sign(unsigned, False).exists())
        for old, new in ((b"backgroundchanger", b"otherapp"),
                         (b"BackgroundChanger", b"WrongName"), (b"1.0.4", b"1.0.5")):
            changed = [(n, b.replace(old, new) if n.endswith("info.xml") else b) for n, b in entries]
            self.archive(unsigned, changed)
            self.assertFalse(self.sign(unsigned, False).exists())
        changed = [(n, b"// manipulated" if n.endswith("main.js") else b) for n, b in entries]
        self.archive(unsigned, changed)
        self.assertFalse(self.sign(unsigned, False).exists())
        unsigned.write_bytes(b"not a gzip tar archive")
        self.assertFalse(self.sign(unsigned, False).exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)