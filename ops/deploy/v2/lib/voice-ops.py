#!/usr/bin/env python3
"""Private voice deployment configuration; never emit addresses or inspect data."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit


def read_env(path):
    if not path.exists():
        return {}
    return {key: value.strip().strip('\"\'') for line in path.read_text().splitlines()
            if line and not line.startswith('#') and '=' in line for key, value in [line.split('=', 1)]}


def prepare(settings, runtime, run=subprocess.run):
    engines = [('KOKORO', 'VC_TTS_KOKORO_URL'), ('COSYVOICE', 'VC_TTS_COSYVOICE_URL'), ('ASR', 'VC_ASR_URL')]
    enabled = [(engine, runtime.get(key)) for engine, key in engines if runtime.get(key)]
    if not enabled:
        return
    network = settings.get('VC_VOICE_NETWORK', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', network):
        raise ValueError('缺少私有语音网络配置')
    for engine, base in enabled:
        url = urlsplit(base)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment or not url.path.endswith('/v1'):
            raise ValueError('语音地址配置无效')
        name = settings.get(f'VC_VOICE_{engine}_CONTAINER', '')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', name):
            raise ValueError('缺少私有语音容器配置')
        result = run(['docker', 'inspect', '--format', '{{json .NetworkSettings}}', name], capture_output=True, text=True, check=True)
        state = json.loads(result.stdout)
        if network not in state.get('Networks', {}):
            raise ValueError('语音容器未加入指定私有网络')
        for bindings in (state.get('Ports') or {}).values():
            if any(item.get('HostIp') not in ('127.0.0.1', '::1') for item in bindings or []):
                raise ValueError('语音端口存在非回环发布')
        run(['docker', 'update', '--restart', 'unless-stopped', name], capture_output=True, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, default=Path('/etc/virtual-companion/deploy.env'))
    parser.add_argument('--runtime', type=Path, default=Path('/etc/virtual-companion/runtime.env'))
    args = parser.parse_args()
    try:
        prepare(read_env(args.settings), read_env(args.runtime))
    except ValueError as error:
        print(f'FAIL: {error}', file=__import__('sys').stderr)
        return 1
    except Exception:
        print('FAIL: 语音部署配置检查失败', file=__import__('sys').stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
