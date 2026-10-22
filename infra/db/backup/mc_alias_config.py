#!/usr/bin/env python3
"""Write a private mc (MinIO client) config v10 for exactly one alias.

Shared by run-daily-backup.sh and run-restore-drill.sh (VC-R55). The three
credential values are read from the environment BY NAME, so they never appear
in any argv, ps output, or log line; the JSON encoding keeps quote, backslash,
newline and carriage-return secrets verbatim (an environment value cannot
carry NUL, which stays the only excluded byte). The target directory is
created 0700 with a 0600 config.json, lives outside the backup working tree,
and is removed by the callers on exit. mc consumes it via
`mc --config-dir DIR`, so no `mc alias set` invocation and no userinfo
MC_HOST_<alias> URL is ever constructed; callers additionally drop an
inherited MC_HOST_<alias> so it cannot override this explicit alias.

Usage:
  mc_alias_config.py ALIAS CONFIG_DIR \
      --endpoint-env NAME --access-key-env NAME --secret-key-env NAME

Exit: 0 ok | 2 bad invocation / empty credential environment variable.
"""
import argparse
import json
import os
import re
import sys


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.stderr.write(
            "mc_alias_config: credential environment variable %s is empty\n" % name)
        sys.exit(2)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(
        description="generate a private one-alias mc config v10 from named "
                    "environment variables (values never enter argv)")
    parser.add_argument("alias", help="mc alias name (e.g. local)")
    parser.add_argument("config_dir", help="target config directory (created 0700)")
    parser.add_argument("--endpoint-env", required=True,
                        help="environment variable holding the S3 endpoint URL")
    parser.add_argument("--access-key-env", required=True,
                        help="environment variable holding the access key")
    parser.add_argument("--secret-key-env", required=True,
                        help="environment variable holding the secret key")
    args = parser.parse_args()

    # The alias also becomes part of the config filename in callers' temp
    # trees; keep it to mc's own alias charset.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.alias):
        sys.stderr.write("mc_alias_config: invalid alias name %r\n" % args.alias)
        sys.exit(2)

    config = {
        "version": "10",
        "aliases": {
            args.alias: {
                "url": _required_env(args.endpoint_env),
                "accessKey": _required_env(args.access_key_env),
                "secretKey": _required_env(args.secret_key_env),
                "api": "S3v4",
                "path": "auto",
            }
        },
    }
    os.makedirs(args.config_dir, mode=0o700, exist_ok=True)
    os.chmod(args.config_dir, 0o700)
    path = os.path.join(args.config_dir, "config.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(config, fh, indent=2)
        fh.write("\n")
    os.chmod(path, 0o600)


if __name__ == "__main__":
    main()
