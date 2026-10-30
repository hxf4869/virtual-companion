FROM python:3.12.16-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN python - <<'PY'
import pathlib, tarfile, tempfile, urllib.request
url='https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2'
out=pathlib.Path('/models');out.mkdir()
with tempfile.TemporaryDirectory(prefix='asr-model-') as tmp:
    archive=pathlib.Path(tmp)/'model.tar.bz2'
    urllib.request.urlretrieve(url,archive)
    with tarfile.open(archive) as tar:
        for name in ('model.int8.onnx','tokens.txt','LICENSE'):
            member=next(item for item in tar.getmembers() if item.isfile() and pathlib.PurePosixPath(item.name).name==name)
            with tar.extractfile(member) as source, (out/name).open('wb') as target:
                import shutil
                shutil.copyfileobj(source,target)
PY
COPY server.py ./
RUN useradd --system --uid 1000 --no-create-home asr
USER 1000:1000
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=30 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2)"
CMD ["python", "server.py"]
