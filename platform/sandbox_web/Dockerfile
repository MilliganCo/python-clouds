FROM python:3.14.4-slim

ARG PYCLOUD_PIP_NO_INDEX=0
COPY wheelhouse /tmp/wheelhouse/

RUN PIP_NO_INDEX=${PYCLOUD_PIP_NO_INDEX} python -m pip install --no-cache-dir --find-links=/tmp/wheelhouse pandas==3.0.6 pytest==9.0.3 openpyxl==3.1.5 beautifulsoup4==4.15.0 pydantic==2.14.1 requests==2.34.2 matplotlib==3.11.2 Flask==3.1.3 \
    && rm -rf /tmp/wheelhouse \
    && groupadd --gid 10001 student \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /workspace --shell /usr/sbin/nologin student

ENV PYTHONDONTWRITEBYTECODE=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    HOME=/workspace \
    USER=student \
    LOGNAME=student

COPY runner.py supervisor.py /opt/
COPY pycloud.py /usr/local/lib/python3.14/site-packages/pycloud.py
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["python", "-I", "-u", "/opt/supervisor.py"]

ARG SANDBOX_DIGEST
LABEL org.pythonclouds.sandbox=1 \
    org.pythonclouds.digest=${SANDBOX_DIGEST}
