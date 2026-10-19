package com.example.resqmesh

import android.content.Context
import android.util.Log
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import java.nio.charset.StandardCharsets
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Manages the Google Nearby Connections lifecycle for ResQMesh.
 *
 * Uses [Strategy.P2P_CLUSTER] so that all devices in proximity can discover
 * and connect to each other (many-to-many mesh foundation).
 *
 * Thread-safety: all state mutation happens inside [lock].
 */
class NearbyConnectionsManager(
    context: Context,
    private val listener: Listener
) {

    // ── Public interface ──────────────────────────────────────────────────────

    interface Listener {
        /** Called on the calling thread (main or bg — caller decides). */
        fun onStatusChanged(status: String)
        fun onPeerConnected(endpointId: String, endpointName: String)
        fun onPeerDisconnected(endpointId: String)
        fun onMessageReceived(senderName: String, message: String)
        fun onError(message: String)
    }

    // ── Constants ─────────────────────────────────────────────────────────────

    companion object {
        private const val TAG = "NearbyMgr"

        /** Service ID uniquely identifies this app's mesh network. */
        private const val SERVICE_ID = "com.example.resqmesh.MESH"

        private val STRATEGY = Strategy.P2P_CLUSTER
    }

    // ── State (guarded by lock) ───────────────────────────────────────────────

    private val lock = ReentrantLock()

    /** Endpoints we have successfully completed connection to (endpointId → name). */
    private val connectedPeers = mutableMapOf<String, String>()

    private val pendingConnections = mutableSetOf<String>()

    /** Cache of endpoint names from onConnectionInitiated, needed for onConnectionResult */
    private val pendingNames = mutableMapOf<String, String>()

    private var isAdvertising = false
    private var isDiscovering = false

    // ── Nearby Connections client ─────────────────────────────────────────────

    private val connectionsClient: ConnectionsClient =
        Nearby.getConnectionsClient(context.applicationContext)

    /** Human-readable name broadcast to nearby peers. */
    val localEndpointName: String = android.os.Build.MODEL
        .replace(Regex("[^A-Za-z0-9 ]"), "")
        .take(20)
        .ifBlank { "ResQDevice" }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Start advertising + discovering simultaneously so both sides can
     * initiate connections (P2P_CLUSTER pattern).
     */
    fun startMesh() {
        Log.i(TAG, "startMesh() called at ${System.currentTimeMillis()} ms — localName='$localEndpointName'")
        startAdvertising()
        startDiscovering()
    }

    /** Stop all Nearby activity and disconnect all peers. */
    fun stopMesh() {
        Log.i(TAG, "stopMesh() called at ${System.currentTimeMillis()} ms")
        connectionsClient.stopAdvertising()
        connectionsClient.stopDiscovery()
        connectionsClient.stopAllEndpoints()
        lock.withLock {
            isAdvertising = false
            isDiscovering = false
            connectedPeers.clear()
            pendingConnections.clear()
            pendingNames.clear()
        }
        listener.onStatusChanged("Mesh stopped")
    }

    /** Send a UTF-8 text message to every connected peer. */
    fun sendMessage(text: String) {
        val peers = lock.withLock { connectedPeers.keys.toList() }
        if (peers.isEmpty()) {
            listener.onError("No connected peers to send to")
            return
        }
        val payload = Payload.fromBytes(text.toByteArray(StandardCharsets.UTF_8))
        peers.forEach { endpointId ->
            connectionsClient.sendPayload(endpointId, payload)
                .addOnFailureListener { e ->
                    val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                    Log.e(TAG, "sendPayload FAILED: endpoint=$endpointId statusCode=$code ($name) msg=${e.message}")
                    listener.onError("Send failed to $endpointId: code $code ($name), ${e.message}")
                }
        }
    }

    /** Returns a snapshot of currently connected peer names. */
    fun getConnectedPeerNames(): List<String> =
        lock.withLock { connectedPeers.values.toList() }

    // ── Advertising ───────────────────────────────────────────────────────────

    private fun startAdvertising() {
        val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).setLowPower(true).build()
        connectionsClient.startAdvertising(
            localEndpointName,
            SERVICE_ID,
            connectionLifecycleCallback,
            options
        ).addOnSuccessListener {
            lock.withLock { isAdvertising = true }
            Log.i(TAG, "Advertising (low-power) started as '$localEndpointName'")
            listener.onStatusChanged("Advertising as $localEndpointName…")
        }.addOnFailureListener { e ->
            val statusCode = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
            val statusName = statusCode?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
            Log.e(TAG, "startAdvertising FAILED at ${System.currentTimeMillis()} ms: " +
                "statusCode=$statusCode ($statusName) msg=${e.message}", e)
            listener.onError("Advertising failed: status $statusCode ($statusName), ${e.message}")
        }
    }

    // ── Discovery ─────────────────────────────────────────────────────────────

    private fun startDiscovering() {
        val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).setLowPower(true).build()
        connectionsClient.startDiscovery(
            SERVICE_ID,
            endpointDiscoveryCallback,
            options
        ).addOnSuccessListener {
            lock.withLock { isDiscovering = true }
            Log.i(TAG, "Discovery (low-power) started")
            listener.onStatusChanged("Advertising + discovering…")
        }.addOnFailureListener { e ->
            val statusCode = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
            val statusName = statusCode?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
            Log.e(TAG, "startDiscovery FAILED at ${System.currentTimeMillis()} ms: " +
                "statusCode=$statusCode ($statusName) msg=${e.message}", e)
            listener.onError("Discovery failed: status $statusCode ($statusName), ${e.message}")
        }
    }

    // ── Endpoint discovery callback ───────────────────────────────────────────

    private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            Log.i(TAG, "onEndpointFound: id=$endpointId name='${info.endpointName}' serviceId='${info.serviceId}'")

            val (shouldConnect, alreadyConnected, alreadyPending) = lock.withLock {
                val ac = connectedPeers.containsKey(endpointId)
                val ap = pendingConnections.contains(endpointId)
                val go = !ac && !ap
                if (go) pendingConnections.add(endpointId)
                Triple(go, ac, ap)
            }

            if (!shouldConnect) {
                Log.d(TAG, "onEndpointFound: skipping requestConnection to $endpointId " +
                    "(alreadyConnected=$alreadyConnected alreadyPending=$alreadyPending)")
                return
            }

            Log.i(TAG, "requestConnection → $endpointId ('${info.endpointName}') as localName='$localEndpointName'")
            connectionsClient.requestConnection(
                localEndpointName,
                endpointId,
                connectionLifecycleCallback
            ).addOnSuccessListener {
                Log.i(TAG, "requestConnection accepted by GMS for endpoint $endpointId")
            }.addOnFailureListener { e ->
                val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                lock.withLock { pendingConnections.remove(endpointId) }
                Log.e(TAG, "requestConnection FAILED at ${System.currentTimeMillis()} ms: " +
                    "endpoint=$endpointId statusCode=$code ($name) msg=${e.message}", e)
                listener.onError("Connection request failed to $endpointId: status $code ($name), ${e.message}")
            }
        }

        override fun onEndpointLost(endpointId: String) {
            val wasPending: Boolean
            val wasConnected: Boolean
            lock.withLock {
                wasPending  = pendingConnections.remove(endpointId)
                wasConnected = connectedPeers.containsKey(endpointId)
                pendingNames.remove(endpointId)
            }
            Log.i(TAG, "onEndpointLost: id=$endpointId wasPending=$wasPending wasConnected=$wasConnected")
        }
    }

    // ── Connection lifecycle callback ─────────────────────────────────────────

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            // isIncomingConnection=true  → remote side called requestConnection first (we are the advertiser).
            // isIncomingConnection=false → we called requestConnection first (we are the discoverer).
            Log.i(TAG, "onConnectionInitiated: id=$endpointId remoteName='${info.endpointName}' " +
                "isIncoming=${info.isIncomingConnection} token=${info.authenticationDigits}")
            lock.withLock { pendingNames[endpointId] = info.endpointName }
            // Auto-accept all incoming connections for the mesh prototype.
            Log.i(TAG, "acceptConnection → $endpointId")
            connectionsClient.acceptConnection(endpointId, payloadCallback)
                .addOnSuccessListener {
                    Log.i(TAG, "acceptConnection acknowledged by GMS for endpoint $endpointId")
                }.addOnFailureListener { e ->
                    val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                    Log.e(TAG, "acceptConnection FAILED at ${System.currentTimeMillis()} ms: " +
                        "endpoint=$endpointId statusCode=$code ($name) msg=${e.message}", e)
                    listener.onError("Accept failed for $endpointId: status $code ($name), ${e.message}")
                }
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            val nameFromInitiation = lock.withLock {
                pendingConnections.remove(endpointId)
                pendingNames.remove(endpointId)
            }

            val code      = resolution.status.statusCode
            val message   = resolution.status.statusMessage ?: "(no message)"
            val codeName  = ConnectionsStatusCodes.getStatusCodeString(code)
            val nowMs     = System.currentTimeMillis()
            Log.i(TAG, "onConnectionResult at ${nowMs} ms: " +
                "id=$endpointId code=$code ($codeName) msg='$message' resolvedName='$nameFromInitiation'")

            when (code) {
                ConnectionsStatusCodes.STATUS_OK -> {
                    val peerName = nameFromInitiation ?: endpointId.take(8)
                    lock.withLock { connectedPeers[endpointId] = peerName }
                    Log.i(TAG, "STATUS_OK($code): connected to $endpointId as '$peerName'")
                    listener.onPeerConnected(endpointId, peerName)
                    listener.onStatusChanged("Connected to $peerName")
                }
                ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED -> {
                    // Either side rejected. Both sides see this code.
                    Log.w(TAG, "STATUS_CONNECTION_REJECTED($code/$codeName): $endpointId rejected the connection — $message")
                    listener.onError("Connection rejected by $endpointId (code $code/$codeName)")
                }
                ConnectionsStatusCodes.STATUS_ERROR -> {
                    // Generic Nearby error — often wraps ENDPOINT_IO_ERROR at a higher layer.
                    Log.e(TAG, "STATUS_ERROR($code/$codeName): connection setup failed for $endpointId — $message")
                    listener.onError("Connection error for $endpointId (code $code/$codeName): $message")
                }
                8018 -> {
                    // STATUS_ENDPOINT_IO_ERROR — transport I/O failure (BLE L2CAP, Wi-Fi Direct, etc.).
                    Log.e(TAG, "STATUS_ENDPOINT_IO_ERROR($code/$codeName): I/O failure for $endpointId — $message")
                    listener.onError("Endpoint I/O error for $endpointId (code $code/$codeName): $message")
                }
                else -> {
                    // Log the raw numeric code and its SDK name for any other Nearby status.
                    Log.w(TAG, "UNHANDLED status($code/$codeName) for $endpointId — $message")
                    listener.onError("Unexpected connection status $code ($codeName) for $endpointId: $message")
                }
            }
        }

        override fun onDisconnected(endpointId: String) {
            val nowMs = System.currentTimeMillis()
            val (name, hadPending, hadName) = lock.withLock {
                val n  = connectedPeers.remove(endpointId)
                val hp = pendingConnections.remove(endpointId)
                val hn = pendingNames.remove(endpointId)
                Triple(n ?: endpointId.take(8), hp, hn)
            }
            // hadPending/hadName should normally be false here; if true it indicates
            // the connection was lost before onConnectionResult fired.
            Log.i(TAG, "onDisconnected at ${nowMs} ms: id=$endpointId resolvedName='$name' " +
                "hadPendingEntry=$hadPending hadPendingName=$hadName " +
                "remainingConnected=${lock.withLock { connectedPeers.size }}")
            listener.onPeerDisconnected(endpointId)
            listener.onStatusChanged("Disconnected from $name")
        }
    }

    // ── Payload callback ──────────────────────────────────────────────────────

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type == Payload.Type.BYTES) {
                val bytes = payload.asBytes() ?: return
                val text = String(bytes, StandardCharsets.UTF_8)
                val senderName = lock.withLock { connectedPeers[endpointId] ?: endpointId.take(8) }
                Log.i(TAG, "Message from $senderName: $text")
                listener.onMessageReceived(senderName, text)
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
            // Only bytes payloads are used; no need to track transfer progress.
        }
    }

}
