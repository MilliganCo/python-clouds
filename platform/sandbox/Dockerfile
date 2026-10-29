FROM python:3.14.4-slim

ARG SANDBOX_DIGEST
LABEL org.pythonclouds.sandbox=1 \
    org.pythonclouds.digest=${SANDBOX_DIGEST}

RUN python -m pip install --no-cache-dir pandas==3.0.6 pytest==9.0.3 \
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
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["python", "-I", "-u", "/opt/supervisor.py"]
