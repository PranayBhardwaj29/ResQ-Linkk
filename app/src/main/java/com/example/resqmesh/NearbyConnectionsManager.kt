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
import org.json.JSONObject
import java.io.Serializable
import java.util.UUID

class NearbyConnectionsManager(
    context: Context,
    private val listener: Listener
) {
    interface Listener {
        fun onStatusChanged(status: String)
        fun onPeerConnected(endpointId: String, endpointName: String)
        fun onPeerDisconnected(endpointId: String)
        fun onMessageReceived(senderName: String, message: String, location: LocationData?)
        fun onError(message: String)
    }

    companion object {
        private const val TAG = "NearbyMgr"
        private const val SERVICE_ID = "com.example.resqmesh.MESH"
        private val STRATEGY = Strategy.P2P_CLUSTER
        private const val MAX_HOPS = 6
        private const val MESSAGE_EXPIRATION_MS = 120000L
    }

    // --- State guarded by lock ---
    private val lock = ReentrantLock()
    private val connectedPeers = mutableMapOf<String, String>()
    private val pendingConnections = mutableSetOf<String>()
    private val pendingNames = mutableMapOf<String, String>()
    
    private val seenMessageIds = object : LinkedHashMap<String, Long>(100, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>): Boolean {
            return size > 500
        }
    }

    private var isAdvertising = false
    private var isDiscovering = false

    private val connectionsClient: ConnectionsClient = Nearby.getConnectionsClient(context.applicationContext)
    val localEndpointName: String = android.os.Build.MODEL.replace(Regex("[^A-Za-z0-9 ]"), "").take(20).ifBlank { "ResQDevice" }
    val localNodeId: String = UUID.randomUUID().toString()

    data class LocationData(
        val latitude: Double,
        val longitude: Double,
        val accuracyMeters: Float,
        val capturedAt: Long,
        val isCached: Boolean = false
    ) : Serializable {
        fun toJson(): JSONObject {
            return JSONObject().apply {
                put("latitude", latitude)
                put("longitude", longitude)
                put("accuracyMeters", accuracyMeters)
                put("capturedAt", capturedAt)
                put("isCached", isCached)
            }
        }
        companion object {
            fun fromJson(json: JSONObject?): LocationData? {
                if (json == null) return null
                return try {
                    LocationData(
                        latitude = json.getDouble("latitude"),
                        longitude = json.getDouble("longitude"),
                        accuracyMeters = json.getDouble("accuracyMeters").toFloat(),
                        capturedAt = json.getLong("capturedAt"),
                        isCached = json.optBoolean("isCached", false)
                    )
                } catch (e: Exception) { null }
            }
        }
    }

    data class MessageEnvelope(
        val protocolVersion: Int = 1,
        val messageId: String = UUID.randomUUID().toString(),
        val senderId: String,
        val senderName: String,
        val text: String,
        val timestampMs: Long = System.currentTimeMillis(),
        val hopCount: Int = 0,
        val maxHops: Int = MAX_HOPS,
        val location: LocationData? = null
    ) : Serializable {
        fun toJson(): String {
            return JSONObject().apply {
                put("protocolVersion", protocolVersion)
                put("messageId", messageId)
                put("senderId", senderId)
                put("senderName", senderName)
                put("text", text)
                put("timestampMs", timestampMs)
                put("hopCount", hopCount)
                put("maxHops", maxHops)
                location?.let { put("location", it.toJson()) }
            }.toString()
        }

        companion object {
            fun fromJson(jsonStr: String): MessageEnvelope? {
                return try {
                    val json = JSONObject(jsonStr)
                    if (!json.has("messageId") || !json.has("text")) return null
                    MessageEnvelope(
                        protocolVersion = json.optInt("protocolVersion", 1),
                        messageId = json.getString("messageId"),
                        senderId = json.optString("senderId", "Unknown"),
                        senderName = json.optString("senderName", "Unknown"),
                        text = json.getString("text"),
                        timestampMs = json.optLong("timestampMs", System.currentTimeMillis()),
                        hopCount = json.optInt("hopCount", 0),
                        maxHops = json.optInt("maxHops", MAX_HOPS),
                        location = LocationData.fromJson(json.optJSONObject("location"))
                    )
                } catch (e: Exception) {
                    null
                }
            }
        }
    }

    fun startMesh() {
        Log.i(TAG, "startMesh() called at ${System.currentTimeMillis()} ms — localName='$localEndpointName'")
        startAdvertising()
        startDiscovering()
    }

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
            seenMessageIds.clear()
        }
        listener.onStatusChanged("Mesh stopped")
    }

    fun sendMessage(text: String, location: LocationData? = null) {
        val envelope = MessageEnvelope(
            senderId = localNodeId,
            senderName = localEndpointName,
            text = text,
            location = location
        )
        val connectedEndpointIds = lock.withLock {
            seenMessageIds[envelope.messageId] = envelope.timestampMs
            connectedPeers.keys.toList()
        }
        if (connectedEndpointIds.isEmpty()) {
            listener.onError("No connected peers to send to")
            return
        }
        val payload = Payload.fromBytes(envelope.toJson().toByteArray(StandardCharsets.UTF_8))
        connectedEndpointIds.forEach { endpointId ->
            connectionsClient.sendPayload(endpointId, payload).addOnFailureListener { e ->
                val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                Log.e(TAG, "sendPayload FAILED: endpoint=$endpointId statusCode=$code ($name) msg=${e.message}")
                listener.onError("Send failed to $endpointId: code $code ($name), ${e.message}")
            }
        }
    }

    fun getConnectedPeerNames(): List<String> = lock.withLock { connectedPeers.values.toList() }

    private fun startAdvertising() {
        val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).setLowPower(true).build()
        connectionsClient.startAdvertising(localEndpointName, SERVICE_ID, connectionLifecycleCallback, options)
            .addOnSuccessListener {
                lock.withLock { isAdvertising = true }
                Log.i(TAG, "Advertising (low-power) started as '$localEndpointName'")
                listener.onStatusChanged("Advertising as $localEndpointName…")
            }.addOnFailureListener { e ->
                val statusCode = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                val statusName = statusCode?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                Log.e(TAG, "startAdvertising FAILED at ${System.currentTimeMillis()} ms: statusCode=$statusCode ($statusName) msg=${e.message}", e)
                listener.onError("Advertising failed: status $statusCode ($statusName), ${e.message}")
            }
    }

    private fun startDiscovering() {
        val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).setLowPower(true).build()
        connectionsClient.startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
            .addOnSuccessListener {
                lock.withLock { isDiscovering = true }
                Log.i(TAG, "Discovery (low-power) started")
                listener.onStatusChanged("Advertising + discovering…")
            }.addOnFailureListener { e ->
                val statusCode = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                val statusName = statusCode?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                Log.e(TAG, "startDiscovery FAILED at ${System.currentTimeMillis()} ms: statusCode=$statusCode ($statusName) msg=${e.message}", e)
                listener.onError("Discovery failed: status $statusCode ($statusName), ${e.message}")
            }
    }

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
                Log.d(TAG, "onEndpointFound: skipping requestConnection to $endpointId (alreadyConnected=$alreadyConnected alreadyPending=$alreadyPending)")
                return
            }

            Log.i(TAG, "requestConnection → $endpointId ('${info.endpointName}') as localName='$localEndpointName'")
            connectionsClient.requestConnection(localEndpointName, endpointId, connectionLifecycleCallback)
                .addOnSuccessListener {
                    Log.i(TAG, "requestConnection accepted by GMS for endpoint $endpointId")
                }.addOnFailureListener { e ->
                    val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                    lock.withLock { pendingConnections.remove(endpointId) }
                    Log.e(TAG, "requestConnection FAILED at ${System.currentTimeMillis()} ms: endpoint=$endpointId statusCode=$code ($name) msg=${e.message}", e)
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

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            Log.i(TAG, "onConnectionInitiated: id=$endpointId remoteName='${info.endpointName}' isIncoming=${info.isIncomingConnection} token=${info.authenticationDigits}")
            lock.withLock { pendingNames[endpointId] = info.endpointName }
            Log.i(TAG, "acceptConnection → $endpointId")
            connectionsClient.acceptConnection(endpointId, payloadCallback)
                .addOnSuccessListener {
                    Log.i(TAG, "acceptConnection acknowledged by GMS for endpoint $endpointId")
                }.addOnFailureListener { e ->
                    val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                    Log.e(TAG, "acceptConnection FAILED at ${System.currentTimeMillis()} ms: endpoint=$endpointId statusCode=$code ($name) msg=${e.message}", e)
                    listener.onError("Accept failed for $endpointId: status $code ($name), ${e.message}")
                }
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            val nameFromInitiation = lock.withLock {
                pendingConnections.remove(endpointId)
                pendingNames.remove(endpointId)
            }

            val code = resolution.status.statusCode
            val message = resolution.status.statusMessage ?: "(no message)"
            val codeName = ConnectionsStatusCodes.getStatusCodeString(code)
            val nowMs = System.currentTimeMillis()
            Log.i(TAG, "onConnectionResult at $nowMs ms: id=$endpointId code=$code ($codeName) msg='$message' resolvedName='$nameFromInitiation'")

            when (code) {
                ConnectionsStatusCodes.STATUS_OK -> {
                    val peerName = nameFromInitiation ?: endpointId.take(8)
                    lock.withLock { connectedPeers[endpointId] = peerName }
                    Log.i(TAG, "STATUS_OK($code): connected to $endpointId as '$peerName'")
                    listener.onPeerConnected(endpointId, peerName)
                    listener.onStatusChanged("Connected to $peerName")
                }
                ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED -> {
                    Log.w(TAG, "STATUS_CONNECTION_REJECTED($code/$codeName): $endpointId rejected the connection — $message")
                    listener.onError("Connection rejected by $endpointId (code $code/$codeName)")
                }
                ConnectionsStatusCodes.STATUS_ERROR -> {
                    Log.e(TAG, "STATUS_ERROR($code/$codeName): connection setup failed for $endpointId — $message")
                    listener.onError("Connection error for $endpointId (code $code/$codeName): $message")
                }
                8018 -> {
                    Log.e(TAG, "STATUS_ENDPOINT_IO_ERROR($code/$codeName): I/O failure for $endpointId — $message")
                    listener.onError("Endpoint I/O error for $endpointId (code $code/$codeName): $message")
                }
                else -> {
                    Log.w(TAG, "UNHANDLED status($code/$codeName) for $endpointId — $message")
                    listener.onError("Unexpected connection status $code ($codeName) for $endpointId: $message")
                }
            }
        }

        override fun onDisconnected(endpointId: String) {
            val nowMs = System.currentTimeMillis()
            val (name, hadPending, hadName) = lock.withLock {
                val n = connectedPeers.remove(endpointId)
                val hp = pendingConnections.remove(endpointId)
                val hn = pendingNames.remove(endpointId)
                Triple(n ?: endpointId.take(8), hp, hn)
            }
            Log.i(TAG, "onDisconnected at $nowMs ms: id=$endpointId resolvedName='$name' hadPendingEntry=$hadPending hadPendingName=$hadName remainingConnected=${lock.withLock { connectedPeers.size }}")
            listener.onPeerDisconnected(endpointId)
            listener.onStatusChanged("Disconnected from $name")
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type == Payload.Type.BYTES) {
                val bytes = payload.asBytes() ?: return
                val text = String(bytes, StandardCharsets.UTF_8)
                
                val envelope = MessageEnvelope.fromJson(text)
                if (envelope == null) {
                    Log.w(TAG, "Rejecting malformed message")
                    return
                }

                val now = System.currentTimeMillis()
                if (now - envelope.timestampMs > MESSAGE_EXPIRATION_MS || envelope.timestampMs > now + 60000L) {
                    Log.w(TAG, "Rejecting expired message: ${envelope.messageId}")
                    return
                }
                
                if (envelope.hopCount >= envelope.maxHops) {
                    Log.w(TAG, "Rejecting message exceeding max hops: ${envelope.messageId}")
                    return
                }

                val isDuplicate = lock.withLock {
                    if (seenMessageIds.containsKey(envelope.messageId)) {
                        true
                    } else {
                        seenMessageIds[envelope.messageId] = now
                        false
                    }
                }
                
                if (isDuplicate) {
                    Log.d(TAG, "Suppressing duplicate message: ${envelope.messageId}")
                    return
                }
                
                Log.i(TAG, "Message from ${envelope.senderName}: ${envelope.text}")
                listener.onMessageReceived(envelope.senderName, envelope.text, envelope.location)
                
                val forwardEnvelope = envelope.copy(hopCount = envelope.hopCount + 1)
                val forwardBytes = forwardEnvelope.toJson().toByteArray(StandardCharsets.UTF_8)
                val forwardPayload = Payload.fromBytes(forwardBytes)
                
                val connectedEndpointIds = lock.withLock { connectedPeers.keys.toList() }
                val forwardTargets = connectedEndpointIds.filter { it != endpointId }
                if (forwardTargets.isNotEmpty()) {
                    Log.i(TAG, "Forwarding message ${envelope.messageId} to ${forwardTargets.size} peers")
                    forwardTargets.forEach { targetId ->
                        connectionsClient.sendPayload(targetId, forwardPayload).addOnFailureListener { e ->
                            Log.e(TAG, "Forward failed to $targetId", e)
                        }
                    }
                }
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }
}
