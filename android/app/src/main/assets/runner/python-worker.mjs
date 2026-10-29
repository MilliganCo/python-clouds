import { loadPyodide, version as runtimeVersion } from '../pyodide/pyodide.mjs';

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const TRUNCATION_MARKER = '\n[Вывод ограничен 256 КБ]';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let output = '';
let outputByteLength = 0;
let outputTruncated = false;

function appendCodePoint(codePoint) {
    const text = String.fromCodePoint(codePoint);
    const byteLength = textEncoder.encode(text).length;
    if (outputByteLength + byteLength > MAX_OUTPUT_BYTES) {
        outputTruncated = true;
        return;
    }
    output += text;
    outputByteLength += byteLength;
}

function boundedText(text, maxBytes = MAX_OUTPUT_BYTES) {
    if (text === null) {
        return null;
    }
    const value = String(text);
    const bytes = textEncoder.encode(value);
    if (bytes.length <= maxBytes) {
        return value;
    }
    const markerBytes = textEncoder.encode(TRUNCATION_MARKER);
    let end = maxBytes - markerBytes.length;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end -= 1;
    }
    return textDecoder.decode(bytes.slice(0, end)) + TRUNCATION_MARKER;
}

const indexURL = new URL('../pyodide/', self.location.href).href;
const pyodide = await loadPyodide({ indexURL });
pyodide.setStdout({ raw: appendCodePoint });
pyodide.setStderr({ raw: appendCodePoint });

self.postMessage({
    type: 'ready',
    pythonVersion: pyodide.runPython('import sys; f"{sys.version_info.major}.{sys.version_info.minor}"'),
    runtimeVersion,
});

self.onmessage = async (event) => {
    const request = event.data;
    if (request.type !== 'run') {
        return;
    }

    output = '';
    outputByteLength = 0;
    outputTruncated = false;
    pyodide.setStdout({ raw: appendCodePoint });
    pyodide.setStderr({ raw: appendCodePoint });
    let error = null;
    let result = null;
    const globals = pyodide.runPython('{}');
    try {
        result = await pyodide.runPythonAsync(request.code, { globals });
    } catch (caught) {
        error = boundedText(caught?.stack || String(caught), MAX_ERROR_BYTES);
    } finally {
        if (result !== null && typeof result?.destroy === 'function') {
            result.destroy();
        }
        globals.destroy();
    }

    if (outputTruncated) {
        output = boundedText(output + TRUNCATION_MARKER);
    }
    const errorBytes = error === null ? 0 : textEncoder.encode(error).length;
    output = boundedText(output, MAX_OUTPUT_BYTES - errorBytes);
    self.postMessage({
        type: 'result',
        id: request.id,
        output,
        error,
        timedOut: false,
        cancelled: false,
    });
};
