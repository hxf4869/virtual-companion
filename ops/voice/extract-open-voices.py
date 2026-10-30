#!/usr/bin/env python3
"""Server-side extraction of the two explicitly licensed public references."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import wave


def download(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read((32 << 20) + 1)
    if len(data) > 32 << 20:
        raise ValueError('public reference exceeds limit')
    return data


def combine_recordings(parts):
    frames=[]
    shape=None
    for data in parts:
        with wave.open(io.BytesIO(data),'rb') as wav:
            current=(wav.getnchannels(),wav.getsampwidth(),wav.getframerate())
            if wav.getcomptype()!='NONE' or (shape and current!=shape):
                raise ValueError('reference formats differ')
            shape=current
            frames.append(wav.readframes(wav.getnframes()))
    channels,width,rate=shape
    joined=b''.join(frames)
    seconds=len(joined)/(channels*width*rate)
    if not 3 <= seconds <= 30:
        raise ValueError('reference must be 3–30 seconds')
    out=io.BytesIO()
    with wave.open(out,'wb') as wav:
        wav.setnchannels(channels);wav.setsampwidth(width);wav.setframerate(rate);wav.writeframes(joined)
    return out.getvalue()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--extractor',required=True,help='Private path to the installed cosyvoice-cli or its container wrapper')
    parser.add_argument('--speech-tokenizer',required=True)
    parser.add_argument('--campplus',required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    manifest=json.loads(Path(__file__).with_name('open-voices.json').read_text())
    args.output_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    for voice in manifest['voices']:
        target=args.output_dir/(voice['id']+'.gguf')
        # Existing valid prompts are intentionally not regenerated.
        if target.exists() and target.read_bytes()[:4]==b'GGUF':
            continue
        license_text=download(voice['licenseUrl'])
        if b'CC0' not in license_text:
            raise ValueError('reference license changed')
        with tempfile.TemporaryDirectory(prefix='vc-voice-extract-') as tmp:
            sample=Path(tmp)/'reference.wav'
            sample.write_bytes(combine_recordings([download(url) for url in voice['audioUrls']]))
            generated=Path(tmp)/'prompt.gguf'
            # No synthesis, model, quantization, sampling, thread or diffusion
            # parameters are changed. Instruct-mode consumers do not need a
            # reference transcript; this extracts prompt features only.
            result=subprocess.run([args.extractor,'--frontend-only','--speech-tokenizer',args.speech_tokenizer,
                '--campplus',args.campplus,'--prompt-audio',str(sample),'--prompt-speech-output',str(generated),'--quiet'],capture_output=True,timeout=300)
            if result.returncode or not generated.exists() or generated.read_bytes()[:4]!=b'GGUF':
                raise ValueError('voice extraction failed')
            target.write_bytes(generated.read_bytes());target.chmod(0o600)
        (args.output_dir/(voice['id']+'.LICENSE')).write_bytes(license_text)
    print('public voice prompts: ready (2)')


if __name__=='__main__':
    try:main()
    except Exception:
        raise SystemExit('voice extraction failed; reference text/audio and private paths omitted')
