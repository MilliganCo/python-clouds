package ru.pythonclouds.app.runner

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.util.UUID
import org.json.JSONObject
import ru.pythonclouds.app.BuildConfig

data class RunnerResult(
    val output: String,
    val error: String?,
    val timedOut: Boolean,
    val cancelled: Boolean = false,
)

/**
 * Hosts CPython in a module Web Worker inside Android's sandboxed WebView renderer.
 * There is deliberately no JavaScript interface and no network-capable URL exposed
 * to the runner. A transferred WebMessagePort is the only native communication path.
 */
class PythonWebRunner(private val activity: Activity) : AutoCloseable {
    @Volatile
    var runtimeVersion: String? = null
        private set

    private val callbacks = mutableMapOf<String, (RunnerResult) -> Unit>()
    private var webView: WebView? = null
    private var nativePort: WebMessagePort? = null
    private var started = false
    private var ready = false
    private var closed = false
    private var onReady: (() -> Unit)? = null
    private var onStartupError: ((String) -> Unit)? = null

    fun start(onReady: () -> Unit, onError: (String) -> Unit) {
        activity.runOnUiThread {
            if (closed) {
                onError("Python runner is closed")
                return@runOnUiThread
            }
            if (started) {
                if (ready) onReady() else onError("Python runner is already starting")
                return@runOnUiThread
            }

            val webViewPackage = WebViewCompat.getCurrentWebViewPackage(activity)
            val webViewMajor = webViewPackage?.versionName
                ?.substringBefore('.')
                ?.toIntOrNull()
            if (webViewMajor == null || webViewMajor < MINIMUM_WEBVIEW_MAJOR) {
                onError(
                    "Для локального Python нужен Android System WebView $MINIMUM_WEBVIEW_MAJOR+ " +
                        "(установлен ${webViewPackage?.versionName ?: "неизвестный"})",
                )
                return@runOnUiThread
            }

            started = true
            runtimeVersion = null
            this.onReady = onReady
            onStartupError = onError
            disposeCurrentWebView()
            createWebView()
        }
    }

    fun run(code: String, timeoutMillis: Long, callback: (RunnerResult) -> Unit) {
        activity.runOnUiThread {
            if (!ready || closed) {
                callback(RunnerResult("", "Python runner is not ready", timedOut = false))
                return@runOnUiThread
            }
            if (callbacks.isNotEmpty()) {
                callback(RunnerResult("", "Python runner is busy", timedOut = false))
                return@runOnUiThread
            }

            val id = UUID.randomUUID().toString()
            callbacks[id] = callback
            val request = JSONObject()
                .put("type", "run")
                .put("id", id)
                .put("code", code)
                .put("timeoutMillis", timeoutMillis.coerceIn(1, MAX_TIMEOUT_MILLIS))
            nativePort?.postMessage(WebMessage(request.toString()))
                ?: finishWithError(id, "Python runner channel is unavailable")
        }
    }

    fun stop() {
        activity.runOnUiThread {
            if (ready && callbacks.isNotEmpty()) {
                nativePort?.postMessage(WebMessage("{\"type\":\"stop\"}"))
            }
        }
    }

    internal fun terminateRendererForTest(callback: (Boolean) -> Unit) {
        activity.runOnUiThread {
            val canTerminate = WebViewFeature.isFeatureSupported(
                WebViewFeature.GET_WEB_VIEW_RENDERER,
            ) && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE)
            val terminated = if (canTerminate) {
                webView?.let(WebViewCompat::getWebViewRenderProcess)?.terminate() == true
            } else {
                false
            }
            callback(terminated)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(APP_ASSET_HOST)
            .addPathHandler("/assets/", LocalAssetsPathHandler(activity))
            .build()
        val runnerWebView = WebView(activity)
        webView = runnerWebView

        with(runnerWebView.settings) {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
        }
        runnerWebView.setBackgroundColor(Color.TRANSPARENT)
        runnerWebView.alpha = 0.01f
        if (!BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(false)
        }
        runnerWebView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                return if (isTrustedAsset(request.url)) {
                    assetLoader.shouldInterceptRequest(request.url)
                } else {
                    blockedResponse()
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = request.isForMainFrame && request.url.toString() != RUNNER_URL

            override fun onPageFinished(view: WebView, url: String) {
                if (nativePort != null || url != RUNNER_URL) return
                val ports = view.createWebMessageChannel()
                nativePort = ports[0].also { port ->
                    port.setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                        override fun onMessage(port: WebMessagePort, message: WebMessage) {
                            handleMessage(message.data)
                        }
                    })
                }
                view.postWebMessage(WebMessage("connect", arrayOf(ports[1])), APP_ORIGIN)
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail,
            ): Boolean {
                val reason = if (detail.didCrash()) "crashed" else "was terminated"
                val error = "Python renderer $reason"
                val wasReady = ready
                ready = false
                runtimeVersion = null
                nativePort?.close()
                nativePort = null
                callbacks.keys.toList().forEach { finishWithError(it, error) }
                if (!wasReady) onStartupError?.invoke(error)
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                if (webView === view) webView = null
                started = wasReady && !closed
                if (started) {
                    activity.window.decorView.post {
                        if (!closed && started && webView == null) createWebView()
                    }
                }
                return true
            }
        }

        activity.addContentView(
            runnerWebView,
            ViewGroup.LayoutParams(1, 1),
        )
        runnerWebView.loadUrl(RUNNER_URL)
    }

    private fun handleMessage(rawMessage: String?) {
        try {
            val message = JSONObject(requireNotNull(rawMessage))
            when (message.getString("type")) {
                "ready" -> {
                    if (!ready) {
                        runtimeVersion = message.optString("runtimeVersion").ifBlank { null }
                        ready = true
                        onReady?.invoke()
                        onReady = null
                    }
                }

                "startup-error" -> {
                    if (!ready) {
                        onStartupError?.invoke(message.optString("error", "Python startup failed"))
                        onReady = null
                        started = false
                    }
                }

                "runtime-error" -> {
                    val error = message.optString("error", "Python runtime failed")
                    callbacks.keys.toList().forEach { finishWithError(it, error) }
                    ready = false
                    runtimeVersion = null
                    started = false
                    onStartupError?.invoke(error)
                }

                "result" -> {
                    val id = message.getString("id")
                    callbacks.remove(id)?.invoke(
                        RunnerResult(
                            output = message.optString("output", ""),
                            error = if (message.isNull("error")) null else message.getString("error"),
                            timedOut = message.optBoolean("timedOut", false),
                            cancelled = message.optBoolean("cancelled", false),
                        ),
                    )
                }
            }
        } catch (error: Exception) {
            val message = "Invalid Python runner response: ${error.message}"
            if (!ready) {
                onStartupError?.invoke(message)
            } else {
                callbacks.keys.toList().forEach { finishWithError(it, message) }
            }
        }
    }

    private fun finishWithError(id: String, error: String) {
        callbacks.remove(id)?.invoke(RunnerResult("", error, timedOut = false))
    }

    override fun close() {
        activity.runOnUiThread {
            if (closed) return@runOnUiThread
            closed = true
            ready = false
            runtimeVersion = null
            callbacks.keys.toList().forEach { finishWithError(it, "Python runner was closed") }
            disposeCurrentWebView()
            onReady = null
            onStartupError = null
        }
    }

    private fun disposeCurrentWebView() {
        nativePort?.close()
        nativePort = null
        webView?.let { view ->
            view.stopLoading()
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        webView = null
    }

    private fun isTrustedAsset(uri: Uri): Boolean =
        uri.scheme == "https" &&
            uri.host == APP_ASSET_HOST &&
            uri.path.orEmpty().startsWith("/assets/")

    private class LocalAssetsPathHandler(private val activity: Activity) :
        WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            val mimeType = when {
                path.endsWith(".html") -> "text/html"
                path.endsWith(".mjs") -> "text/javascript"
                path.endsWith(".wasm") -> "application/wasm"
                path.endsWith(".json") -> "application/json"
                path.endsWith(".zip") -> "application/zip"
                else -> "application/octet-stream"
            }
            return try {
                WebResourceResponse(
                    mimeType,
                    if (mimeType.startsWith("text/") || mimeType == "application/json") "UTF-8" else null,
                    200,
                    "OK",
                    SECURITY_HEADERS,
                    activity.assets.open(path),
                )
            } catch (_: Exception) {
                WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    404,
                    "Not Found",
                    SECURITY_HEADERS,
                    ByteArrayInputStream(ByteArray(0)),
                )
            }
        }
    }

    companion object {
        private const val APP_ASSET_HOST = "appassets.androidplatform.net"
        private const val RUNNER_URL = "https://$APP_ASSET_HOST/assets/runner/index.html"
        private const val MINIMUM_WEBVIEW_MAJOR = 112
        private const val MAX_TIMEOUT_MILLIS = 60_000L
        private val APP_ORIGIN = Uri.parse("https://$APP_ASSET_HOST")
        private val SECURITY_HEADERS = mapOf(
            "Content-Security-Policy" to
                "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
                "worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
            "Cross-Origin-Resource-Policy" to "same-origin",
            "X-Content-Type-Options" to "nosniff",
        )

        private fun blockedResponse() = WebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            "Blocked",
            SECURITY_HEADERS,
            ByteArrayInputStream(ByteArray(0)),
        )
    }
}
