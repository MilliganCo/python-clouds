let nativePort = null;
let worker = null;
let workerReady = false;
let hasEverBeenReady = false;
let activeRequest = null;
let queuedRequest = null;

function send(message) {
    if (nativePort !== null) {
        nativePort.postMessage(JSON.stringify(message));
    }
}

function startWorker() {
    workerReady = false;
    worker = new Worker('./python-worker.mjs', { type: 'module' });

    worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'ready') {
            workerReady = true;
            hasEverBeenReady = true;
            send({
                type: 'ready',
                pythonVersion: message.pythonVersion,
                runtimeVersion: message.runtimeVersion,
            });
            if (queuedRequest !== null) {
                const request = queuedRequest;
                queuedRequest = null;
                clearTimeout(request.queueTimer);
                request.timeoutMillis = Math.max(1, request.deadline - Date.now());
                dispatch(request);
            }
            return;
        }

        if (message.type === 'result' && activeRequest?.id === message.id) {
            clearTimeout(activeRequest.timer);
            activeRequest = null;
            send(message);
            worker.terminate();
            startWorker();
        }
    };

    worker.onerror = (event) => {
        const error = event.message || 'Python worker failed';
        const mayRestart = workerReady || activeRequest !== null || queuedRequest !== null;
        if (activeRequest !== null) {
            clearTimeout(activeRequest.timer);
            const id = activeRequest.id;
            activeRequest = null;
            send({ type: 'result', id, output: '', error, timedOut: false });
        } else if (queuedRequest !== null) {
            clearTimeout(queuedRequest.queueTimer);
            const id = queuedRequest.id;
            queuedRequest = null;
            send({ type: 'result', id, output: '', error, timedOut: false });
        } else {
            send({ type: hasEverBeenReady ? 'runtime-error' : 'startup-error', error });
        }
        worker.terminate();
        if (mayRestart) {
            startWorker();
        }
    };
}

function dispatch(request) {
    if (!workerReady) {
        const timeout = Math.max(1, Number(request.timeoutMillis));
        const queueTimer = setTimeout(() => {
            const id = queuedRequest?.id;
            queuedRequest = null;
            worker.terminate();
            send({ type: 'result', id, output: '', error: null, timedOut: true });
            startWorker();
        }, timeout);
        queuedRequest = {
            ...request,
            deadline: Date.now() + timeout,
            queueTimer,
        };
        return;
    }
    if (activeRequest !== null) {
        send({
            type: 'result',
            id: request.id,
            output: '',
            error: 'Python runner is busy',
            timedOut: false,
        });
        return;
    }

    const timeout = Math.max(1, Number(request.timeoutMillis));
    const timer = setTimeout(() => {
        const id = activeRequest?.id;
        activeRequest = null;
        worker.terminate();
        send({ type: 'result', id, output: '', error: null, timedOut: true });
        startWorker();
    }, timeout);

    activeRequest = { id: request.id, timer };
    worker.postMessage({ type: 'run', id: request.id, code: request.code });
}

window.addEventListener('message', (event) => {
    if (nativePort !== null || event.ports.length !== 1) {
        return;
    }
    nativePort = event.ports[0];
    nativePort.onmessage = (portEvent) => {
        const request = JSON.parse(portEvent.data);
        if (request.type === 'run') {
            dispatch(request);
        } else if (request.type === 'stop' && (activeRequest !== null || queuedRequest !== null)) {
            const id = activeRequest?.id || queuedRequest.id;
            if (activeRequest !== null) {
                clearTimeout(activeRequest.timer);
                activeRequest = null;
                worker.terminate();
                startWorker();
            } else {
                clearTimeout(queuedRequest.queueTimer);
                queuedRequest = null;
            }
            send({
                type: 'result',
                id,
                output: '',
                error: null,
                timedOut: false,
                cancelled: true,
            });
        }
    };
    nativePort.start();
    startWorker();
}, { once: true });
