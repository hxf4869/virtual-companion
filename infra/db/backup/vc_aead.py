#!/usr/bin/env python3
"""Authenticated container helper for the local encrypted backups (DOGFOOD-03).

`openssl enc` (CBC + PBKDF2) provides confidentiality only: a tampered
ciphertext still "decrypts" (to garbage) with a zero exit code in many cases.
This helper adds an independent encrypt-then-MAC layer on top of the existing
openssl ciphertext, using ONLY the Python standard library (hmac/hashlib), so a
daily backup archive and a deletion manifest can be refused BEFORE any
decryption when the passphrase is wrong, the ciphertext was tampered with, or
the MAC trailer was tampered with.

Container layout (single file, magic-detectable):

    MAGIC || u32be(header_len) || header || ciphertext || mac[32]

    MAGIC    b"VCBAE1\\n"                                  (7 bytes)
    header   ASCII "key=value\\n" lines, currently:
                 format=vcb-authenticated-v1
                 mac=hmac-sha256
                 mac_kdf=pbkdf2-sha256
                 mac_iter=<decimal iterations>
                 mac_salt=<32 hex chars, 16 random bytes>
    ciphertext  the untouched `openssl enc -aes-256-cbc -pbkdf2 -salt`
                output (openssl keeps its own internal Salted__ header and
                derives its own key, so the two keys never collide)
    mac      HMAC-SHA256(K, MAGIC || u32be(header_len) || header || ciphertext)

    K = PBKDF2-HMAC-SHA256(password = b"vc-backup-mac-key-v1\\0" || passphrase,
                           salt = mac_salt, iterations = mac_iter, dklen = 32)

The MAC key is domain-separated from the openssl encryption key (different
KDF context AND different salt), and the header is covered by the MAC, so KDF
parameters cannot be edited either.

Verification order (unseal/verify): the MAC is computed over the WHOLE file
first; not a single ciphertext byte is written out before it matches. A wrong
passphrase derives a wrong MAC key and therefore fails the same check.

Passphrase sources (the secret is never passed via argv, so it never shows up
in `ps`):
    --pass-env VAR    read the passphrase from environment variable VAR
    --pass-file PATH  read the first line of keyfile PATH

Commands:
    seal   IN OUT   IN = openssl ciphertext file, OUT = container path
    unseal IN OUT   MAC-verify IN, then write the ciphertext part to OUT
                    (OUT '-' writes to stdout, binary safe)
    verify IN       MAC check only

Exit codes:
    0 ok | 2 usage | 3 corrupt container / MAC mismatch (incl. wrong
    passphrase) | 4 passphrase source problem | 5 unexpected IO error
"""

import hashlib
import hmac
import os
import struct
import sys

MAGIC = b"VCBAE1\n"
MAC_LEN = 32
CHUNK = 1024 * 1024
MAC_ITER = 200000
KEY_DOMAIN = b"vc-backup-mac-key-v1\0"


def die(code, msg):
    sys.stderr.write("vc_aead: %s\n" % msg)
    sys.exit(code)


def read_passphrase(opts):
    if opts.get("pass_env"):
        var = opts["pass_env"]
        val = os.environ.get(var)
        if val is None or val == "":
            die(4, "passphrase environment variable %s is empty or unset" % var)
        return val.encode("utf-8")
    if opts.get("pass_file"):
        path = opts["pass_file"]
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            die(4, "cannot read passphrase keyfile")
        line = data.split(b"\n", 1)[0]
        if line.endswith(b"\r"):
            line = line[:-1]
        if line == b"":
            die(4, "passphrase keyfile first line is empty")
        return line
    die(2, "exactly one of --pass-env VAR / --pass-file PATH is required")


def derive_mac_key(passphrase, salt, iterations):
    return hashlib.pbkdf2_hmac("sha256", KEY_DOMAIN + passphrase,
                               salt, iterations, dklen=32)


def parse_header(raw):
    """Return (salt bytes, iterations) from the ASCII header, or die(3)."""
    fields = {}
    for line in raw.decode("ascii", "strict").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            fields[k.strip()] = v.strip()
    if fields.get("format") != "vcb-authenticated-v1":
        die(3, "unsupported container format")
    if fields.get("mac") != "hmac-sha256" or fields.get("mac_kdf") != "pbkdf2-sha256":
        die(3, "unsupported MAC/KDF parameters")
    try:
        salt = bytes.fromhex(fields["mac_salt"])
        iterations = int(fields["mac_iter"])
    except (KeyError, ValueError):
        die(3, "malformed container header")
    if len(salt) != 16 or not (1000 <= iterations <= 10_000_000):
        die(3, "out-of-range MAC KDF parameters")
    return salt, iterations


def open_container(path):
    """Return (file obj, header bytes, payload_start, payload_end) or die(3/5)."""
    try:
        f = open(path, "rb")
    except OSError:
        die(5, "cannot open container")
    try:
        size = os.fstat(f.fileno()).st_size
        head = f.read(11)
        if len(head) < 11 or head[:7] != MAGIC:
            die(3, "bad magic (not a VCBAE1 authenticated container)")
        header_len = struct.unpack(">I", head[7:11])[0]
        if header_len <= 0 or header_len > 65536:
            die(3, "implausible header length")
        header = f.read(header_len)
        if len(header) != header_len:
            die(3, "truncated container header")
        payload_start = 11 + header_len
        payload_end = size - MAC_LEN
        if payload_end < payload_start:
            die(3, "container too short for a MAC trailer")
        return f, header, payload_start, payload_end
    except OSError:
        die(5, "container read failed")


def mac_over(f, header, payload_start, payload_end, key):
    """Streaming HMAC over MAGIC || u32be(len) || header || ciphertext."""
    h = hmac.new(key, digestmod=hashlib.sha256)
    h.update(MAGIC)
    h.update(struct.pack(">I", len(header)))
    h.update(header)
    f.seek(payload_start)
    remaining = payload_end - payload_start
    while remaining > 0:
        block = f.read(min(CHUNK, remaining))
        if not block:
            die(3, "container truncated while verifying MAC")
        h.update(block)
        remaining -= len(block)
    return h.digest()


def trailer_of(f):
    f.seek(-MAC_LEN, os.SEEK_END)
    t = f.read(MAC_LEN)
    if len(t) != MAC_LEN:
        die(3, "container missing MAC trailer")
    return t


def cmd_seal(opts, args):
    if len(args) != 2:
        die(2, "seal IN OUT")
    src, dst = args
    passphrase = read_passphrase(opts)
    salt = os.urandom(16)
    key = derive_mac_key(passphrase, salt, MAC_ITER)
    header = (
        "format=vcb-authenticated-v1\n"
        "mac=hmac-sha256\n"
        "mac_kdf=pbkdf2-sha256\n"
        "mac_iter=%d\n"
        "mac_salt=%s\n" % (MAC_ITER, salt.hex())
    ).encode("ascii")
    try:
        with open(src, "rb") as fin, open(dst, "wb") as fout:
            fout.write(MAGIC)
            fout.write(struct.pack(">I", len(header)))
            fout.write(header)
            h = hmac.new(key, digestmod=hashlib.sha256)
            h.update(MAGIC)
            h.update(struct.pack(">I", len(header)))
            h.update(header)
            while True:
                block = fin.read(CHUNK)
                if not block:
                    break
                fout.write(block)
                h.update(block)
            fout.write(h.digest())
    except OSError:
        try:
            os.remove(dst)
        except OSError:
            pass
        die(5, "seal failed")
    return 0


def cmd_unseal_or_verify(opts, args, want_output):
    if want_output and len(args) != 2:
        die(2, "unseal IN OUT ('-' = stdout)")
    if not want_output and len(args) != 1:
        die(2, "verify IN")
    path = args[0]
    passphrase = read_passphrase(opts)
    f, header, payload_start, payload_end = open_container(path)
    rc = 0
    try:
        salt, iterations = parse_header(header)
        key = derive_mac_key(passphrase, salt, iterations)
        computed = mac_over(f, header, payload_start, payload_end, key)
        stored = trailer_of(f)
        if not hmac.compare_digest(computed, stored):
            # Covers: tampered ciphertext, tampered MAC trailer, tampered
            # header, truncated file, and a WRONG PASSPHRASE (wrong MAC key).
            die(3, "integrity check failed (MAC mismatch / wrong passphrase)")
        if want_output:
            out = args[1]
            if out == "-":
                sink = sys.stdout.buffer
            else:
                sink = open(out, "wb")
            try:
                f.seek(payload_start)
                remaining = payload_end - payload_start
                while remaining > 0:
                    block = f.read(min(CHUNK, remaining))
                    if not block:
                        die(3, "container truncated during payload copy")
                    sink.write(block)
                    remaining -= len(block)
            finally:
                if out != "-":
                    sink.close()
    except OSError:
        rc = 5
        sys.stderr.write("vc_aead: unseal IO failure\n")
    finally:
        f.close()
    return rc


def main():
    argv = sys.argv[1:]
    if not argv:
        die(2, "usage: vc_aead.py seal|unseal|verify ... (--pass-env VAR | --pass-file PATH)")
    mode, rest = argv[0], argv[1:]
    opts = {}
    positional = []
    it = iter(rest)
    for tok in it:
        if tok == "--pass-env":
            try:
                opts["pass_env"] = next(it)
            except StopIteration:
                die(2, "--pass-env needs a variable name")
        elif tok == "--pass-file":
            try:
                opts["pass_file"] = next(it)
            except StopIteration:
                die(2, "--pass-file needs a path")
        else:
            positional.append(tok)
    if opts.get("pass_env") and opts.get("pass_file"):
        die(2, "--pass-env and --pass-file are mutually exclusive")
    if mode == "seal":
        sys.exit(cmd_seal(opts, positional))
    if mode == "unseal":
        sys.exit(cmd_unseal_or_verify(opts, positional, True))
    if mode == "verify":
        sys.exit(cmd_unseal_or_verify(opts, positional, False))
    die(2, "unknown mode %r" % mode)


if __name__ == "__main__":
    main()
