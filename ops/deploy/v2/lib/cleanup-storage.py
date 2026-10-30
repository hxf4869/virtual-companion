#!/usr/bin/env python3
"""部署自检通过后，只清理本项目的历史镜像和部署产物。"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


COMMIT_TAG = re.compile(r"[0-9a-f]{8,40}")
BACKUP = re.compile(r"vc-(?:predeploy-)?\d{8}T\d{6}Z\.vcbae1")
EXTENSIONS = re.compile(r"extensions-before-[0-9a-f]{8,40}\.tgz")
TRANSFER = re.compile(r"vc-(?:images-[0-9a-f]{8,40}\.tar\.gz|src-[0-9a-f]{8,40}\.bundle)")
IMAGE_REPOS = {"virtual-companion-st", "virtual-companion-runtime"}


def docker(*args):
    return subprocess.run(
        [os.environ.get("VC_DEPLOY_DOCKER", "docker"), *args],
        check=True, text=True, capture_output=True,
    ).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image_tag")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--keep-backup", type=Path)
    parser.add_argument("--image-cache-dir", type=Path)
    args = parser.parse_args()
    if not COMMIT_TAG.fullmatch(args.image_tag):
        parser.error("需要部署提交的镜像标签")
    if bool(args.backup_dir) != bool(args.keep_backup):
        parser.error("backup-dir 与 keep-backup 必须一起指定")

    # 调用方传入本次 backup.sh 已完成自校验并正式发布的备份。
    # 缺少该文件时，在任何删除之前停止，不能用残缺备份替换历史。
    files = []
    if args.backup_dir:
        root = args.backup_dir.resolve()
        keep = args.keep_backup
        if (keep.is_symlink() or keep.resolve().parent != root
                or not BACKUP.fullmatch(keep.name)
                or not keep.is_file() or keep.stat().st_size == 0):
            raise ValueError("缺少本次已校验备份，停止清理")
        keep = keep.resolve()
        extension = f"extensions-before-{args.image_tag}.tgz"
        for entry in root.iterdir():
            if entry.is_symlink() or not entry.is_file():
                continue
            if (BACKUP.fullmatch(entry.name) and entry != keep
                    or EXTENSIONS.fullmatch(entry.name) and entry.name != extension):
                files.append(entry)
    if args.image_cache_dir:
        files.extend(entry for entry in args.image_cache_dir.iterdir()
                     if not entry.is_symlink() and entry.is_file()
                     and TRANSFER.fullmatch(entry.name))

    # 包括其他项目和已停止容器；不删除仍被任何容器引用的镜像。
    containers = docker("ps", "-aq").split()
    protected = set(docker("inspect", "--format", "{{.Image}}", *containers).split()) if containers else set()
    images = [json.loads(line) for line in docker("image", "ls", "--no-trunc", "--format", "{{json .}}").splitlines()]
    old = [f"{row['Repository']}:{row['Tag']}" for row in images
           if row["Repository"] in IMAGE_REPOS
           and COMMIT_TAG.fullmatch(row["Tag"])
           and row["Tag"] != args.image_tag and row["ID"] not in protected]
    if old:
        docker("image", "rm", *old)
    for entry in files:
        entry.unlink()
    print(f"存储清理: 历史镜像标签 {len(old)}，历史备份及传输包 {len(files)}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"FAIL: 存储清理失败（{type(error).__name__}），请检查文件权限和 Docker 状态", file=sys.stderr)
        sys.exit(1)
