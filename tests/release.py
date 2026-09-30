#!/usr/bin/env python3
"""Build an unsigned, deterministic BackgroundChanger runtime from a clean tag.

Build uses the standard library; sign requires cryptography and external keys.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import gzip
import io
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import xml.etree.ElementTree as ET

RUNTIME = {"appinfo": {".xml", ".php"}, "css": {".css"},
           "img": {".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"},
           "js": {".js"}, "lib": {".php"}}
DOCS = {name + suffix for name in ("README", "CHANGELOG", "LICENSE") for suffix in ("", ".md")}
EXCLUDED = {"tests", "test", "keys", "key", "build", "dist", "vendor", "node_modules", "history"}


class ReleaseError(Exception):
    pass


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if result.returncode:
        # Never echo repository content or subprocess stderr (possibly sensitive).
        raise ReleaseError("Git prerequisite failed: " + args[0])
    return result.stdout


def allowed(name):
    path = PurePosixPath(name)
    if name in DOCS:
        return True
    return (len(path.parts) > 1 and path.parts[0] in RUNTIME
            and all(not p.startswith(".") and p.lower() not in EXCLUDED for p in path.parts)
            and path.suffix.lower() in RUNTIME[path.parts[0]]
            and not any(word in path.name.lower() for word in ("signature", "private", "secret", "credential")))


def check_output(root, output):
    if output.exists() or output.is_symlink():
        raise ReleaseError("Output already exists; refusing to overwrite")
    resolved = output.resolve()
    if output == root or root in output.parents or resolved == root or root in resolved.parents:
        build_dir = root / "build"
        if (build_dir.is_symlink() or build_dir not in resolved.parents
                or subprocess.run(["git", "-C", str(root), "check-ignore", "-q", str(output)],
                                  capture_output=True).returncode):
            raise ReleaseError("Repository output must be inside ignored build/")


def pack(entries):
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", filename="", mtime=0, compresslevel=9) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(entries):
                member = tarfile.TarInfo("backgroundchanger/" + name)
                member.size = len(data)
                member.mode = 0o644
                member.uid = member.gid = member.mtime = 0
                member.uname = member.gname = ""
                archive.addfile(member, io.BytesIO(data))
    return buffer.getvalue()


def runtime_entries(repo, head):
    entries = []
    for entry in git(repo, "ls-tree", "-r", "-z", head.decode()).split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        mode, kind, oid = metadata.split()
        name = raw_name.decode("utf-8")
        if not allowed(name):
            continue
        if mode not in (b"100644", b"100755") or kind != b"blob":
            raise ReleaseError("Runtime entries must be regular files")
        data = git(repo, "cat-file", "blob", oid.decode())
        if re.search(rb"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----", data):
            raise ReleaseError("Private-key material in runtime source; refusing package")
        entries.append((name, data))
    return entries


def sign(repo, unsigned, key_path, certificate_path, tag, output):
    # Lazy imports: build never loads crypto or reads keys.
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    from cryptography.x509.oid import NameOID

    root = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if repo.resolve() != root:
        raise ReleaseError("--repo must be the repository root")
    output = output.absolute()
    check_output(root, output)
    if not re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag):
        raise ReleaseError("Tag must be vX.Y.Z")
    head = git(repo, "rev-parse", "--verify", "HEAD^{commit}").strip()
    tagged = git(repo, "rev-parse", "--verify", "refs/tags/" + tag + "^{commit}").strip()
    if head != tagged:
        raise ReleaseError("HEAD is not the requested tag")
    if git(repo, "status", "--porcelain=v1", "--untracked-files=all"):
        raise ReleaseError("Working tree is dirty or contains untracked files")
    others = git(repo, "ls-files", "--others", "-z").decode().split("\0")
    if any(p and (p.split("/", 1)[0] in RUNTIME or p in DOCS) for p in others):
        raise ReleaseError("Untracked or ignored runtime source files")
    expected = dict(runtime_entries(repo, head))
    for path in (key_path, certificate_path):
        if root == path.resolve() or root in path.resolve().parents:
            raise ReleaseError("Key and certificate must be external to the source repository")
    # Never extract untrusted archives: canonical names, regular files, no duplicates.
    files = {}
    with tarfile.open(unsigned, "r:gz") as archive:
        for member in archive:
            prefix = "backgroundchanger/"
            name = member.name.removeprefix(prefix)
            path = PurePosixPath(name)
            if (not member.name.startswith(prefix) or not member.isfile()
                    or name != path.as_posix() or path.is_absolute()
                    or ".." in path.parts or "\\" in name
                    or not allowed(name) or name in files):
                raise ReleaseError("Unsafe or foreign runtime archive member")
            data = archive.extractfile(member).read()
            if re.search(rb"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----", data):
                raise ReleaseError("Private-key material in runtime archive")
            files[name] = data
    if "appinfo/info.xml" not in files or not any(p in files for p in ("LICENSE", "LICENSE.md")):
        raise ReleaseError("Missing runtime metadata or license")
    info = ET.fromstring(files["appinfo/info.xml"])
    if (info.findtext("id"), info.findtext("name"), info.findtext("version")) != (
            "backgroundchanger", "BackgroundChanger", tag[1:]):
        raise ReleaseError("App ID, name or version differs from release identity")
    if files != expected:
        raise ReleaseError("Unsigned runtime differs from the selected Git tag")
    certificate_pem = certificate_path.read_bytes()
    certificate = x509.load_pem_x509_certificate(certificate_pem)
    if [a.value for a in certificate.subject.get_attributes_for_oid(NameOID.COMMON_NAME)] != ["backgroundchanger"]:
        raise ReleaseError("Certificate CN must be backgroundchanger")
    now = datetime.now(timezone.utc)
    if not certificate.not_valid_before_utc <= now <= certificate.not_valid_after_utc:
        raise ReleaseError("Certificate is not currently valid")
    key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    public = certificate.public_key()
    if (not isinstance(key, rsa.RSAPrivateKey) or not isinstance(public, rsa.RSAPublicKey)
            or key.public_key().public_numbers() != public.public_numbers()):
        raise ReleaseError("Certificate and RSA private key do not match")
    file_hashes = {name: hashlib.sha512(data).hexdigest() for name, data in sorted(files.items())}
    # PHP json_encode defaults escape non-ASCII and forward slashes.
    payload = json.dumps(file_hashes, ensure_ascii=True, separators=(",", ":")).replace("/", "\\/").encode("ascii")
    scheme = padding.PSS(mgf=padding.MGF1(hashes.SHA512()), salt_length=0)
    signature = key.sign(payload, scheme, hashes.SHA1())
    public.verify(signature, payload, scheme, hashes.SHA1())
    files["appinfo/signature.json"] = json.dumps({
        "hashes": file_hashes, "signature": base64.b64encode(signature).decode("ascii"),
        "certificate": certificate_pem.decode("ascii")}, indent=2).encode("utf-8")
    encoded = pack(files.items())
    with output.open("xb") as destination:
        destination.write(encoded)
    print("Signed BackgroundChanger " + tag[1:])


def build(repo, tag, output):
    repo = repo.resolve()
    output = output.absolute()
    root = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if repo != root:
        raise ReleaseError("--repo must be the repository root")
    check_output(root, output)
    if not re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag):
        raise ReleaseError("Tag must be vX.Y.Z")
    if git(repo, "status", "--porcelain=v1", "--untracked-files=all"):
        raise ReleaseError("Working tree is dirty or contains untracked files")
    # Also reject ignored source additions; ignored build/output directories are
    # irrelevant and never read. Normal untracked files anywhere fail above.
    others = git(repo, "ls-files", "--others", "-z").decode().split("\0")
    if any(p and (p.split("/", 1)[0] in RUNTIME or p in DOCS) for p in others):
        raise ReleaseError("Untracked or ignored runtime source files")
    head = git(repo, "rev-parse", "--verify", "HEAD^{commit}").strip()
    tagged = git(repo, "rev-parse", "--verify", "refs/tags/" + tag + "^{commit}").strip()
    if head != tagged:
        raise ReleaseError("HEAD is not the requested tag")
    git(repo, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}")
    git(repo, "merge-base", "--is-ancestor", "refs/remotes/origin/main", head.decode())
    git(repo, "ls-files", "--error-unmatch", "tests/check.sh")
    if subprocess.run(["bash", "tests/check.sh"], cwd=repo, capture_output=True).returncode:
        raise ReleaseError("Tracked tests/check.sh failed; no package created")
    if git(repo, "status", "--porcelain=v1", "--untracked-files=all"):
        raise ReleaseError("Release checks changed the working tree")
    entries = runtime_entries(repo, head)
    files = dict(entries)
    if "appinfo/info.xml" not in files:
        raise ReleaseError("Missing appinfo/info.xml")
    info = ET.fromstring(files["appinfo/info.xml"])
    if (info.findtext("id"), info.findtext("name"), info.findtext("version")) != (
            "backgroundchanger", "BackgroundChanger", tag[1:]):
        raise ReleaseError("App ID, name or version differs from release identity")
    if not any(name in files for name in ("LICENSE", "LICENSE.md")):
        raise ReleaseError("Missing runtime license")
    # Fixed gzip header, no filename, sorted members and normalized metadata.
    # Payload is read from immutable Git blobs, never the mutable working tree.
    encoded = pack(entries)
    # All checks and encoding finish before creating an output. Exclusive creation
    # also prevents accidentally replacing an already published artifact.
    with output.open("xb") as destination:
        destination.write(encoded)
    print("Built unsigned BackgroundChanger " + tag[1:] + " (" + str(len(entries)) + " runtime files)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("build", help="build an unsigned runtime archive")
    command.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    command.add_argument("--tag", required=True)
    command.add_argument("--output", type=Path, required=True)
    command = commands.add_parser("sign", help="sign an immutable unsigned runtime archive")
    command.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    command.add_argument("--unsigned", type=Path, required=True)
    command.add_argument("--key", type=Path, required=True)
    command.add_argument("--certificate", type=Path, required=True)
    command.add_argument("--tag", required=True)
    command.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "build":
            build(args.repo, args.tag, args.output)
        else:
            sign(args.repo, args.unsigned, args.key, args.certificate, args.tag, args.output)
    except ReleaseError as error:
        parser.exit(1, "Release rejected: " + str(error) + "\n")
    except (OSError, ValueError, ET.ParseError, UnicodeError, tarfile.TarError, ImportError):
        parser.exit(1, "Release rejected: invalid input or archive/output error\n")


if __name__ == "__main__":
    main()