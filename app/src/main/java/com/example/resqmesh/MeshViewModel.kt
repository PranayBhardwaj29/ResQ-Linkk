package com.example.resqmesh

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import org.json.JSONObject

/**
 * Survives screen rotations and holds all UI-observable state for the mesh.
 * The [NearbyConnectionsManager] is created here so the connection persists
 * across orientation changes.
 */
class MeshViewModel(application: Application) : AndroidViewModel(application),
    NearbyConnectionsManager.Listener {

    // ── UI-observable state ───────────────────────────────────────────────────

    private val _statusText = MutableLiveData("Idle — tap Start Mesh")
    val statusText: LiveData<String> = _statusText

    private val _connectedPeers = MutableLiveData<List<String>>(emptyList())
    val connectedPeers: LiveData<List<String>> = _connectedPeers

    data class LogEntry(
        val text: String,
        val mine: Boolean = false,
        val notice: Boolean = false,
        val location: NearbyConnectionsManager.LocationData? = null
    ) {
        fun toJson(): JSONObject {
            val obj = JSONObject()
            obj.put("text", text)
            obj.put("mine", mine)
            obj.put("notice", notice)
            if (location != null) obj.put("location", location.toJson())
            return obj
        }
    }

    private val _messageLog = MutableLiveData<List<LogEntry>>(emptyList())
    val messageLog: LiveData<List<LogEntry>> = _messageLog

    private val _toastEvent = MutableLiveData<String?>()
    val toastEvent: LiveData<String?> = _toastEvent

    // ── Internal peer map (endpointId → displayName) ──────────────────────────

    @Volatile private var peersMap = LinkedHashMap<String, String>()
    private val peersLock = Any()

    // ── Nearby manager ────────────────────────────────────────────────────────

    val nearbyManager: NearbyConnectionsManager =
        NearbyConnectionsManager(application, this)

    private var meshActive = false

    // ── Public actions ────────────────────────────────────────────────────────

    fun startMesh() {
        if (meshActive) return
        meshActive = true
        _statusText.postValue("Starting mesh…")
        nearbyManager.startMesh()
    }

    fun stopMesh() {
        if (!meshActive) return
        meshActive = false
        nearbyManager.stopMesh()
        synchronized(peersLock) { peersMap.clear() }
        _connectedPeers.postValue(emptyList())
    }

    fun sendMessage(text: String, location: NearbyConnectionsManager.LocationData? = null) {
        nearbyManager.sendMessage(text, location)
        // Append our own message to the log immediately for responsiveness.
        appendLog(LogEntry("Me: $text", mine = true, location = location))
    }

    fun clearToast() {
        _toastEvent.postValue(null)
    }

    // ── NearbyConnectionsManager.Listener ─────────────────────────────────────

    override fun onStatusChanged(status: String) {
        _statusText.postValue(status)
    }

    override fun onPeerConnected(endpointId: String, endpointName: String) {
        synchronized(peersLock) {
            peersMap[endpointId] = endpointName
            _connectedPeers.postValue(peersMap.values.toList())
        }
        appendLog(LogEntry("⬤ $endpointName joined the mesh", notice = true))
    }

    override fun onPeerDisconnected(endpointId: String) {
        synchronized(peersLock) {
            val name = peersMap.remove(endpointId) ?: endpointId.take(8)
            _connectedPeers.postValue(peersMap.values.toList())
            appendLog(LogEntry("○ $name left the mesh", notice = true))
        }
    }

    override fun onMessageReceived(senderName: String, message: String, location: NearbyConnectionsManager.LocationData?) {
        appendLog(LogEntry("$senderName: $message", location = location))
    }

    override fun onError(message: String) {
        _toastEvent.postValue(message)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun appendLog(entry: LogEntry) {
        val current = _messageLog.value?.toMutableList() ?: mutableListOf()
        current.add(entry)
        _messageLog.postValue(current)
    }

    // ── ViewModel lifecycle ───────────────────────────────────────────────────

    override fun onCleared() {
        super.onCleared()
        nearbyManager.stopMesh()
    }
}
