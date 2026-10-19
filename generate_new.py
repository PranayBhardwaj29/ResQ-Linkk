import sys

content = """package com.example.resqmesh

import android.content.Context
import android.os.Handler
import android.os.Looper
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

class NearbyConnectionsManager(
    context: Context,
    private val listener: Listener
) {
    interface Listener {
        fun onStatusChanged(status: String)
        fun onPeerConnected(endpointId: String, endpointName: String)
        fun onPeerDisconnected(endpointId: String)
        fun onMessageReceived(senderName: String, message: String)
        fun onError(message: String)
    }

    companion object {
        private const val TAG = "NearbyMgr"
        private const val SERVICE_ID = "com.example.resqmesh.MESH"
        private val STRATEGY = Strategy.P2P_CLUSTER
        private const val MAX_ATTEMPTS = 2
        private const val TIMEOUT_MS = 15000L
        private const val FALLBACK_DELAY_MS = 8000L
        private const val COOLDOWN_MS = 10000L
    }

    enum class PeerState {
        DISCOVERED, QUEUED, REQUESTING, INITIATED, CONNECTED, COOLDOWN
    }

    private data class Peer(
        val endpointId: String,
        val name: String,
        var state: PeerState = PeerState.DISCOVERED,
        var attempts: Int = 0,
        var activeAttemptId: Long = 0L
    )

    private val lock = ReentrantLock()
    private val peers = mutableMapOf<String, Peer>()
    private val outgoingQueue = mutableListOf<String>()
    private var activeOutgoingEndpoint: String? = null
    
    private val handler = Handler(Looper.getMainLooper())

    private var isAdvertising = false
    private var isDiscovering = false

    private val connectionsClient: ConnectionsClient = Nearby.getConnectionsClient(context.applicationContext)
    val localEndpointName: String = android.os.Build.MODEL.replace(Regex("[^A-Za-z0-9 ]"), "").take(20).ifBlank { "ResQDevice" }

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
        handler.removeCallbacksAndMessages(null)
        lock.withLock {
            isAdvertising = false
            isDiscovering = false
            peers.clear()
            outgoingQueue.clear()
            activeOutgoingEndpoint = null
        }
        listener.onStatusChanged("Mesh stopped")
    }

    fun sendMessage(text: String) {
        val connectedEndpointIds = lock.withLock {
            peers.values.filter { it.state == PeerState.CONNECTED }.map { it.endpointId }
        }
        if (connectedEndpointIds.isEmpty()) {
            listener.onError("No connected peers to send to")
            return
        }
        val payload = Payload.fromBytes(text.toByteArray(StandardCharsets.UTF_8))
        connectedEndpointIds.forEach { endpointId ->
            connectionsClient.sendPayload(endpointId, payload).addOnFailureListener { e ->
                val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                Log.e(TAG, "sendPayload FAILED: endpoint=$endpointId statusCode=$code ($name) msg=${e.message}")
                listener.onError("Send failed to $endpointId: code $code ($name), ${e.message}")
            }
        }
    }

    fun getConnectedPeerNames(): List<String> = lock.withLock {
        peers.values.filter { it.state == PeerState.CONNECTED }.map { it.name }
    }

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

    private fun pumpQueue() {
        val endpointToRequest = lock.withLock {
            if (activeOutgoingEndpoint != null) return
            
            val iterator = outgoingQueue.iterator()
            var nextToProcess: String? = null
            while (iterator.hasNext()) {
                val id = iterator.next()
                val peer = peers[id]
                iterator.remove() // Always remove from queue, we will either process or drop
                if (peer != null && peer.state == PeerState.QUEUED) {
                    if (peer.attempts < MAX_ATTEMPTS) {
                        nextToProcess = id
                        break
                    } else {
                        Log.w(TAG, "Dropping queued request to $id: MAX_ATTEMPTS reached")
                        peer.state = PeerState.COOLDOWN
                        scheduleCooldownReset(id)
                    }
                }
            }
            
            nextToProcess?.let { id ->
                val peer = peers[id]!!
                activeOutgoingEndpoint = id
                peer.state = PeerState.REQUESTING
                peer.attempts++
                peer.activeAttemptId = System.currentTimeMillis()
                
                // Schedule local timeout
                val attemptId = peer.activeAttemptId
                handler.postDelayed({ handleRequestTimeout(id, attemptId) }, TIMEOUT_MS)
                
                peer
            }
        }

        endpointToRequest?.let { peer ->
            Log.i(TAG, "requestConnection -> ${peer.endpointId} ('${peer.name}') [Attempt ${peer.attempts}]")
            connectionsClient.requestConnection(localEndpointName, peer.endpointId, connectionLifecycleCallback)
                .addOnSuccessListener {
                    Log.i(TAG, "requestConnection accepted by GMS for endpoint ${peer.endpointId}")
                }
                .addOnFailureListener { e ->
                    val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                    Log.e(TAG, "requestConnection FAILED instantly at ${System.currentTimeMillis()} ms: endpoint=${peer.endpointId} statusCode=$code ($name)", e)
                    listener.onError("Connection request failed to ${peer.endpointId}: status $code ($name)")
                    
                    // Immediately reconcile state and pump queue
                    lock.withLock {
                        if (peers[peer.endpointId]?.activeAttemptId == peer.activeAttemptId) {
                            reconcileFailure(peer.endpointId)
                        }
                    }
                }
        }
    }

    private fun handleRequestTimeout(endpointId: String, attemptId: Long) {
        lock.withLock {
            val peer = peers[endpointId] ?: return
            if (peer.activeAttemptId == attemptId && (peer.state == PeerState.REQUESTING || peer.state == PeerState.INITIATED)) {
                Log.e(TAG, "Request TIMEOUT for $endpointId in state ${peer.state}")
                // The requirement: Reconcile its state and perform appropriate Nearby cleanup before pumping the queue.
                connectionsClient.disconnectFromEndpoint(endpointId)
                reconcileFailure(endpointId)
            }
        }
    }

    private fun reconcileFailure(endpointId: String) {
        // Must be called inside lock
        val peer = peers[endpointId] ?: return
        peer.state = PeerState.COOLDOWN
        scheduleCooldownReset(endpointId)
        
        if (activeOutgoingEndpoint == endpointId) {
            activeOutgoingEndpoint = null
            // We use a handler post to avoid deep call stacks while holding lock
            handler.post { pumpQueue() }
        }
    }

    private fun scheduleCooldownReset(endpointId: String) {
        handler.postDelayed({
            lock.withLock {
                val peer = peers[endpointId]
                if (peer != null && peer.state == PeerState.COOLDOWN) {
                    peer.state = PeerState.DISCOVERED
                    Log.d(TAG, "Cooldown finished for $endpointId, resetting to DISCOVERED")
                }
            }
        }, COOLDOWN_MS)
    }

    private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            Log.i(TAG, "onEndpointFound: id=$endpointId name='${info.endpointName}' serviceId='${info.serviceId}'")
            
            var shouldQueueImmediate = false
            var shouldQueueDelayed = false

            lock.withLock {
                val peer = peers.getOrPut(endpointId) { Peer(endpointId, info.endpointName) }
                
                if (peer.state == PeerState.DISCOVERED) {
                    if (peer.attempts >= MAX_ATTEMPTS) {
                        Log.w(TAG, "Skipping $endpointId (Max attempts reached)")
                        return@withLock
                    }
                    
                    if (localEndpointName > info.endpointName) {
                        peer.state = PeerState.QUEUED
                        if (!outgoingQueue.contains(endpointId)) outgoingQueue.add(endpointId)
                        shouldQueueImmediate = true
                    } else {
                        // We are the fallback initiator. Don't change state yet.
                        shouldQueueDelayed = true
                    }
                } else {
                    Log.d(TAG, "onEndpointFound: skipping $endpointId (Current state: ${peer.state})")
                }
            }

            if (shouldQueueImmediate) {
                pumpQueue()
            } else if (shouldQueueDelayed) {
                Log.i(TAG, "Scheduling delayed fallback request for $endpointId (Delay: ${FALLBACK_DELAY_MS}ms)")
                handler.postDelayed({
                    var triggerPump = false
                    lock.withLock {
                        val peer = peers[endpointId]
                        // Only queue if it's STILL in DISCOVERED state. If an incoming connection arrived,
                        // state will be INITIATED or CONNECTED, safely preventing collision.
                        if (peer != null && peer.state == PeerState.DISCOVERED && peer.attempts < MAX_ATTEMPTS) {
                            Log.i(TAG, "Fallback delay elapsed for $endpointId, queueing now.")
                            peer.state = PeerState.QUEUED
                            if (!outgoingQueue.contains(endpointId)) outgoingQueue.add(endpointId)
                            triggerPump = true
                        } else {
                            Log.i(TAG, "Fallback delay elapsed for $endpointId, but state is ${peer?.state}. Aborting request.")
                        }
                    }
                    if (triggerPump) pumpQueue()
                }, FALLBACK_DELAY_MS)
            }
        }

        override fun onEndpointLost(endpointId: String) {
            Log.i(TAG, "onEndpointLost: id=$endpointId")
            // We do NOT remove connected/pending peers to avoid disrupting valid sessions on flaky discovery.
            // But we can reset DISCOVERED ones to clean up.
            lock.withLock {
                val peer = peers[endpointId]
                if (peer != null && peer.state == PeerState.DISCOVERED) {
                    peers.remove(endpointId)
                }
            }
        }
    }

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            Log.i(TAG, "onConnectionInitiated: id=$endpointId remoteName='${info.endpointName}' isIncoming=${info.isIncomingConnection} token=${info.authenticationDigits}")
            
            lock.withLock {
                val peer = peers.getOrPut(endpointId) { Peer(endpointId, info.endpointName) }
                // Accept all incoming or active outgoing. Late callbacks on older attempt IDs are overwritten safely.
                peer.state = PeerState.INITIATED
                peer.activeAttemptId = System.currentTimeMillis() // Start a new phase ID
                
                // If it was in queue but arrived as incoming, remove it.
                outgoingQueue.remove(endpointId)
            }

            Log.i(TAG, "acceptConnection → $endpointId")
            connectionsClient.acceptConnection(endpointId, payloadCallback)
                .addOnSuccessListener {
                    Log.i(TAG, "acceptConnection acknowledged by GMS for endpoint $endpointId")
                }.addOnFailureListener { e ->
                    val code = (e as? com.google.android.gms.common.api.ApiException)?.statusCode
                    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
                    Log.e(TAG, "acceptConnection FAILED at ${System.currentTimeMillis()} ms: endpoint=$endpointId statusCode=$code ($name)", e)
                    listener.onError("Accept failed for $endpointId: status $code ($name)")
                    
                    lock.withLock { reconcileFailure(endpointId) }
                }
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            val code = resolution.status.statusCode
            val codeName = ConnectionsStatusCodes.getStatusCodeString(code)
            val message = resolution.status.statusMessage ?: "(no message)"
            val nowMs = System.currentTimeMillis()
            
            var wasActiveOutgoing = false
            var peerName = endpointId.take(8)

            lock.withLock {
                val peer = peers[endpointId]
                if (peer != null) {
                    peerName = peer.name
                    if (activeOutgoingEndpoint == endpointId) {
                        wasActiveOutgoing = true
                        activeOutgoingEndpoint = null
                    }
                    
                    if (code == ConnectionsStatusCodes.STATUS_OK) {
                        peer.state = PeerState.CONNECTED
                        peer.attempts = 0 // Reset on full success
                    } else {
                        peer.state = PeerState.COOLDOWN
                        scheduleCooldownReset(endpointId)
                    }
                }
            }

            Log.i(TAG, "onConnectionResult at $nowMs ms: id=$endpointId code=$code ($codeName) msg='$message' resolvedName='$peerName'")

            when (code) {
                ConnectionsStatusCodes.STATUS_OK -> {
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
            
            if (wasActiveOutgoing) {
                pumpQueue()
            }
        }

        override fun onDisconnected(endpointId: String) {
            val nowMs = System.currentTimeMillis()
            var peerName = endpointId.take(8)
            var wasActiveOutgoing = false

            val remainingCount = lock.withLock {
                val peer = peers[endpointId]
                if (peer != null) {
                    peerName = peer.name
                    peer.state = PeerState.COOLDOWN
                    scheduleCooldownReset(endpointId)
                }
                if (activeOutgoingEndpoint == endpointId) {
                    wasActiveOutgoing = true
                    activeOutgoingEndpoint = null
                }
                peers.values.count { it.state == PeerState.CONNECTED }
            }

            Log.i(TAG, "onDisconnected at $nowMs ms: id=$endpointId resolvedName='$peerName' remainingConnected=$remainingCount")
            listener.onPeerDisconnected(endpointId)
            listener.onStatusChanged("Disconnected from $peerName")
            
            if (wasActiveOutgoing) {
                pumpQueue()
            }
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type == Payload.Type.BYTES) {
                val bytes = payload.asBytes() ?: return
                val text = String(bytes, StandardCharsets.UTF_8)
                val senderName = lock.withLock { peers[endpointId]?.name ?: endpointId.take(8) }
                Log.i(TAG, "Message from $senderName: $text")
                listener.onMessageReceived(senderName, text)
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }
}
"""

with open("new_NearbyConnectionsManager.kt", "w") as f:
    f.write(content)

