package com.example.resqmesh

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.content.Context
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android host for the bundled ResQLink web UI.
 * Nearby Connections stays in NearbyConnectionsManager/MeshViewModel; this
 * Activity only exposes the existing mesh controls/state to the local UI.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "ResQLinkHost"
        private const val APP_ASSET_HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://appassets.androidplatform.net/assets/web/index.html"
        
        // HACKATHON MOCK LOCATION OVERRIDE
        // Set to true to override real GPS with the configured coordinates below.
        private const val USE_MOCK_LOCATION_OVERRIDE = true
        private const val MOCK_LATITUDE = 28.6692 // Ghaziabad
        private const val MOCK_LONGITUDE = 77.4538
    }

    private val viewModel: MeshViewModel by viewModels()
    private var webView: WebView? = null
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    
    private var previewLocation: NearbyConnectionsManager.LocationData? = null
    private var locationError: String? = null
    private var isAcquiringLocation = false

    private val assetLoader: WebViewAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val denied = results.filterValues { !it }.keys
            if (denied.isEmpty()) {
                viewModel.startMesh()
            } else {
                val missing = denied.joinToString(", ") { it.substringAfterLast('.') }
                Toast.makeText(
                    this,
                    "Missing permissions: $missing. Cannot start mesh.",
                    Toast.LENGTH_LONG
                ).show()
            }
            publishMeshState()
        }

    /** Location permission path for the website's navigator.geolocation calls. */
    private val geoPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
            val origin = pendingGeoOrigin
            val callback = pendingGeoCallback
            pendingGeoOrigin = null
            pendingGeoCallback = null
            if (origin != null && callback != null) {
                callback.invoke(origin, hasLocationPermission(), false)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val view = WebView(this)
        webView = view
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        view.addJavascriptInterface(MeshBridge(), "ResQMeshNative")
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return null
                return if (uri.scheme == "https" && uri.host == APP_ASSET_HOST) {
                    assetLoader.shouldInterceptRequest(uri)
                } else null
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                if (uri.scheme == "https" && uri.host == APP_ASSET_HOST) return false

                // Keep external websites outside the WebView. This prevents third-party pages
                // from receiving the native JavaScript bridge.
                if (uri.scheme == "http" || uri.scheme == "https" || uri.scheme == "geo" || uri.scheme == "tel") {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (e: Exception) {
                        Log.w(TAG, "No handler for external URL: $uri", e)
                        Toast.makeText(this@MainActivity, "No app can open this link", Toast.LENGTH_SHORT).show()
                        true
                    }
                }
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                publishMeshState()
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                if (origin == null || callback == null || Uri.parse(origin).host != APP_ASSET_HOST) {
                    callback?.invoke(origin ?: "", false, false)
                    return
                }
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingGeoOrigin = origin
                    pendingGeoCallback = callback
                    geoPermissionLauncher.launch(
                        arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
                    )
                }
            }
        }

        ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            target.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }
        setContentView(view)
        setupObservers()
        view.loadUrl(START_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val current = webView
                if (current != null && current.canGoBack()) {
                    current.goBack()
                } else {
                    // Preserve the normal Android back behavior at the app root.
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun setupObservers() {
        viewModel.statusText.observe(this) { publishMeshState() }
        viewModel.connectedPeers.observe(this) { publishMeshState() }
        viewModel.messageLog.observe(this) { publishMeshState() }
        viewModel.toastEvent.observe(this) { msg ->
            if (!msg.isNullOrBlank()) {
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                viewModel.clearToast()
            }
        }
    }

    private fun requestPermissionsAndStart() {
        val needed = requiredPermissions().filter { perm ->
            ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) {
            viewModel.startMesh()
        } else {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    /** Mirrors the permissions currently declared in AndroidManifest.xml. */
    private fun requiredPermissions(): List<String> {
        val perms = mutableListOf<String>()
        val sdk = Build.VERSION.SDK_INT
        // Nearby Connections on this project's tested setup requires both location grants.
        perms += Manifest.permission.ACCESS_COARSE_LOCATION
        perms += Manifest.permission.ACCESS_FINE_LOCATION
        if (sdk >= 31) {
            perms += Manifest.permission.BLUETOOTH_SCAN
            perms += Manifest.permission.BLUETOOTH_ADVERTISE
            perms += Manifest.permission.BLUETOOTH_CONNECT
        }
        if (sdk >= 33) perms += Manifest.permission.NEARBY_WIFI_DEVICES
        return perms
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun snapshotJson(): String = JSONObject()
        .put("status", viewModel.statusText.value ?: "Idle · tap Start mesh")
        .put("peers", JSONArray(viewModel.connectedPeers.value ?: emptyList<String>()))
        .put("messages", JSONArray(viewModel.messageLog.value?.map { it.toJson() } ?: emptyList<JSONObject>()))
        .put("locationPreview", previewLocation?.toJson())
        .put("locationError", locationError)
        .put("isAcquiringLocation", isAcquiringLocation)
        .toString()

    private fun publishMeshState() {
        val json = snapshotJson()
        runOnUiThread {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('resqmesh-mesh-update', { detail: $json }));",
                null
            )
        }
    }

    private inner class MeshBridge {
        @JavascriptInterface
        fun startMesh() {
            runOnUiThread { requestPermissionsAndStart() }
        }

        @JavascriptInterface
        fun stopMesh() {
            runOnUiThread {
                viewModel.stopMesh()
                publishMeshState()
            }
        }

        @JavascriptInterface
        fun sendMessage(text: String?) {
            val message = text?.trim().orEmpty()
            if (message.isBlank()) return
            if (message.length > 2000) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Message is too long", Toast.LENGTH_SHORT).show()
                }
                return
            }
            runOnUiThread { viewModel.sendMessage(message) }
        }

        @JavascriptInterface
        fun sendMessageWithLocation(text: String?, locationJson: String?) {
            val message = text?.trim().orEmpty()
            if (message.isBlank()) return
            if (message.length > 2000) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Message is too long", Toast.LENGTH_SHORT).show()
                }
                return
            }
            val loc = NearbyConnectionsManager.LocationData.fromJson(locationJson?.let { JSONObject(it) })
            runOnUiThread {
                previewLocation = null
                locationError = null
                isAcquiringLocation = false
                viewModel.sendMessage(message, loc)
                publishMeshState()
            }
        }

        @JavascriptInterface
        fun requestLocation() {
            runOnUiThread {
                acquireLocationForPreview()
            }
        }

        @JavascriptInterface
        fun getSnapshot(): String = snapshotJson()
    }

    private fun acquireLocationForPreview() {
        if (USE_MOCK_LOCATION_OVERRIDE) {
            isAcquiringLocation = false
            locationError = null
            previewLocation = NearbyConnectionsManager.LocationData(
                latitude = MOCK_LATITUDE,
                longitude = MOCK_LONGITUDE,
                accuracyMeters = 5.0f,
                capturedAt = System.currentTimeMillis(),
                isCached = false
            )
            publishMeshState()
            return
        }

        val reqId = java.util.UUID.randomUUID().toString().substring(0, 8)
        Log.i(TAG, "[$reqId] acquireLocationForPreview() started")
        
        isAcquiringLocation = true
        locationError = null
        previewLocation = null
        publishMeshState()

        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        Log.i(TAG, "[$reqId] Permissions - Fine: $hasFine, Coarse: $hasCoarse")

        if (!hasFine && !hasCoarse) {
            Log.e(TAG, "[$reqId] Location permission denied")
            isAcquiringLocation = false
            locationError = "Location permission denied."
            publishMeshState()
            return
        }

        val gpsEnabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val networkEnabled = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        Log.i(TAG, "[$reqId] Providers - GPS: $gpsEnabled, Network: $networkEnabled")

        if (!gpsEnabled && !networkEnabled) {
            Log.e(TAG, "[$reqId] Location services disabled")
            isAcquiringLocation = false
            locationError = "Location services disabled."
            publishMeshState()
            return
        }

        val provider = if (gpsEnabled) LocationManager.GPS_PROVIDER else LocationManager.NETWORK_PROVIDER
        Log.i(TAG, "[$reqId] Selected provider: $provider")
        
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        var resolved = false
        var cancellationSignal: android.os.CancellationSignal? = null
        var locationListener: LocationListener? = null
        
        val finishWithFallback = { reason: String ->
            Log.i(TAG, "[$reqId] finishWithFallback() triggered. Reason: $reason")
            val lastKnown = try {
                lm.getLastKnownLocation(provider)
            } catch (e: SecurityException) { 
                Log.e(TAG, "[$reqId] SecurityException getting last known location", e)
                null 
            }
            
            if (lastKnown != null) {
                val ageMs = System.currentTimeMillis() - lastKnown.time
                Log.i(TAG, "[$reqId] Last known location found. Age: ${ageMs}ms, Accuracy: ${lastKnown.accuracy}m")
                if (ageMs < 10 * 60 * 1000) {
                    Log.i(TAG, "[$reqId] Using cached location (recent enough)")
                    previewLocation = NearbyConnectionsManager.LocationData(
                        latitude = lastKnown.latitude,
                        longitude = lastKnown.longitude,
                        accuracyMeters = lastKnown.accuracy,
                        capturedAt = lastKnown.time,
                        isCached = true
                    )
                } else {
                    Log.w(TAG, "[$reqId] Cached location too old, discarding")
                    locationError = "Location acquisition timed out."
                }
            } else {
                Log.w(TAG, "[$reqId] No last known location available")
                locationError = "Location acquisition timed out."
            }
            Log.i(TAG, "[$reqId] Publishing mesh state from fallback")
            publishMeshState()
        }

        val timeoutRunnable = Runnable {
            if (!resolved) {
                Log.w(TAG, "[$reqId] 10s timeout hit! Cancelling native request.")
                resolved = true
                isAcquiringLocation = false
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    cancellationSignal?.cancel()
                } else {
                    locationListener?.let { lm.removeUpdates(it) }
                }
                
                finishWithFallback("Timeout")
            }
        }
        handler.postDelayed(timeoutRunnable, 10000)

        val callback = { location: Location? ->
            if (!resolved) {
                Log.i(TAG, "[$reqId] Native callback received. Location is null? ${location == null}")
                resolved = true
                handler.removeCallbacks(timeoutRunnable)
                isAcquiringLocation = false
                if (location != null) {
                    Log.i(TAG, "[$reqId] Fresh location acquired! Accuracy: ${location.accuracy}m")
                    previewLocation = NearbyConnectionsManager.LocationData(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracyMeters = location.accuracy,
                        capturedAt = location.time,
                        isCached = false
                    )
                    publishMeshState()
                } else {
                    finishWithFallback("Callback returned null location")
                }
            } else {
                Log.w(TAG, "[$reqId] Native callback received AFTER resolved/timeout. Ignored.")
            }
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Log.i(TAG, "[$reqId] Invoking getCurrentLocation() on API >= 30")
                cancellationSignal = android.os.CancellationSignal()
                lm.getCurrentLocation(
                    provider,
                    cancellationSignal,
                    ContextCompat.getMainExecutor(this)
                ) { location -> callback(location) }
            } else {
                Log.i(TAG, "[$reqId] Invoking requestSingleUpdate() on API < 30")
                locationListener = object : LocationListener {
                    override fun onLocationChanged(location: Location) { 
                        Log.i(TAG, "[$reqId] LocationListener.onLocationChanged fired")
                        lm.removeUpdates(this)
                        callback(location) 
                    }
                    override fun onProviderDisabled(provider: String) {}
                    override fun onProviderEnabled(provider: String) {}
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                }
                lm.requestSingleUpdate(provider, locationListener!!, android.os.Looper.getMainLooper())
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "[$reqId] SecurityException during request initiation", e)
            if (!resolved) {
                resolved = true
                handler.removeCallbacks(timeoutRunnable)
                isAcquiringLocation = false
                locationError = "Location permission error."
                publishMeshState()
            }
        }
    }

    override fun onDestroy() {
        webView?.apply {
            removeJavascriptInterface("ResQMeshNative")
            stopLoading()
            webChromeClient = null
            webViewClient = WebViewClient()
            destroy()
        }
        webView = null
        super.onDestroy()
    }
}
