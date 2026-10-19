import { useEffect, useState, useRef } from 'react';
import { X, MapPin, Send, Signal, Link as LinkIcon, AlertCircle, Navigation2, Activity, Radio, Network } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MeshSnapshot {
  status: string;
  peers: string[];
  messages: any[];
  locationPreview?: any;
  locationError?: string;
  isAcquiringLocation?: boolean;
}

interface ResQMeshNativeBridge {
  startMesh: () => void;
  stopMesh: () => void;
  sendMessage: (text: string) => void;
  sendMessageWithLocation?: (text: string, locationJson: string) => void;
  requestLocation?: () => void;
  getSnapshot: () => string;
}

declare global {
  interface Window {
    ResQMeshNative?: ResQMeshNativeBridge;
  }
}

const EMPTY_SNAPSHOT: MeshSnapshot = {
  status: 'Idle · Tap Connect',
  peers: [],
  messages: [],
};

function readSnapshot(): MeshSnapshot {
  try {
    const raw = window.ResQMeshNative?.getSnapshot();
    if (!raw) return EMPTY_SNAPSHOT;
    const parsed = JSON.parse(raw) as Partial<MeshSnapshot>;
    return {
      status: typeof parsed.status === 'string' ? parsed.status : EMPTY_SNAPSHOT.status,
      peers: Array.isArray(parsed.peers) ? parsed.peers.filter((v): v is string => typeof v === 'string') : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      locationPreview: parsed.locationPreview,
      locationError: parsed.locationError,
      isAcquiringLocation: parsed.isAcquiringLocation
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

interface ParsedMessage {
  id: string;
  sender: string;
  text: string;
  mine: boolean;
  notice: boolean;
  location: any;
  timestamp: string;
}

function parseRawMessage(msg: any, index: number): ParsedMessage {
  const isObj = typeof msg === 'object' && msg !== null;
  const rawText = isObj ? msg.text : msg;
  const mine = isObj ? msg.mine : rawText.startsWith('Me:');
  const notice = isObj ? msg.notice : (rawText.includes('joined the mesh') || rawText.includes('left the mesh'));
  const location = isObj ? msg.location : null;
  
  let sender = mine ? 'Me' : 'Unknown';
  let text = rawText;
  
  if (!notice && !mine && rawText.includes(': ')) {
     const splitIndex = rawText.indexOf(': ');
     sender = rawText.substring(0, splitIndex);
     text = rawText.substring(splitIndex + 2);
  } else if (mine && rawText.startsWith('Me: ')) {
     text = rawText.substring(4);
  }

  return {
    id: `${index}-${rawText.slice(0, 10)}`,
    sender,
    text,
    mine,
    notice,
    location,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

export function MeshPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [snapshot, setSnapshot] = useState<MeshSnapshot>(readSnapshot);
  const [draft, setDraft] = useState('');
  const [includeLocation, setIncludeLocation] = useState(false);
  const [bridgeAvailable] = useState(() => Boolean(window.ResQMeshNative));
  
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  type Tab = 'broadcast' | 'peers' | 'topology';
  const [activeTab, setActiveTab] = useState<Tab>('broadcast');

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<MeshSnapshot>).detail;
      if (!detail) return;
      setSnapshot({
        status: typeof detail.status === 'string' ? detail.status : EMPTY_SNAPSHOT.status,
        peers: Array.isArray(detail.peers) ? detail.peers : [],
        messages: Array.isArray(detail.messages) ? detail.messages : [],
        locationPreview: detail.locationPreview,
        locationError: detail.locationError,
        isAcquiringLocation: detail.isAcquiringLocation
      });
    };
    const refresh = () => setSnapshot(readSnapshot());
    window.addEventListener('resqmesh-mesh-update', onUpdate);
    window.addEventListener('focus', refresh);
    refresh();
    return () => {
      window.removeEventListener('resqmesh-mesh-update', onUpdate);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Sync messages
  useEffect(() => {
    setMessages(prev => {
      const updated = [...prev];
      for (let i = prev.length; i < snapshot.messages.length; i++) {
        updated.push(parseRawMessage(snapshot.messages[i], i));
      }
      return updated;
    });
  }, [snapshot.messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && activeTab === 'broadcast') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, activeTab]);

  const send = () => {
    const text = draft.trim();
    if (!text || !window.ResQMeshNative) return;
    
    if (includeLocation && snapshot.locationPreview && window.ResQMeshNative.sendMessageWithLocation) {
      window.ResQMeshNative.sendMessageWithLocation(text, JSON.stringify(snapshot.locationPreview));
    } else {
      window.ResQMeshNative.sendMessage(text);
    }
    setDraft('');
    setIncludeLocation(false);
  };

  const isConnected = snapshot.peers.length > 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] flex justify-end transition-all duration-300 font-sans",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      )}
      role="presentation"
    >
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={() => onOpenChange(false)} 
      />
      
      <section
        role="dialog"
        aria-label="Tactical Mesh Interface"
        className={cn(
          "relative flex h-full w-full max-w-md flex-col border-l border-[#2D3748] bg-[#111418] text-[#F8FAFC] shadow-2xl transition-transform duration-300 pb-16",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Top Status/Telemetry Banner (Mission-Critical Ribbon) */}
        <header className="sticky top-0 z-40 bg-[#1A1E24] border-b border-[#2D3748]">
          {/* Device Mesh Status Quick Bar */}
          <div className="h-7 px-3 bg-[#0B0E12] flex items-center justify-between border-b border-[#2D3748]">
            <div className="flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-[#0D9488] animate-pulse" : "bg-amber-500")} />
              <span className="font-mono text-[10px] tracking-wider font-semibold text-[#F8FAFC]">
                {bridgeAvailable ? "NEARBY CONNECTIONS // BLE/WIFI" : "MESH PREVIEW // NO NATIVE BRIDGE"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[#94A3B8]">
              <span className="font-mono text-[10px] font-semibold flex items-center gap-1">
                <span className="text-[#0D9488]">AES-256</span>
              </span>
            </div>
          </div>
          
          {/* TopAppBar Component */}
          <div className="flex justify-between items-center w-full px-3 h-14 bg-[#111418] border-b border-[#2D3748]">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-[#242932] flex items-center justify-center border border-[#3E4A5B] text-amber-500">
                <Signal className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[13px] tracking-wider text-amber-500 font-bold uppercase">ResQLink</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[11px] text-[#0D9488] font-medium">
                    {snapshot.peers.length} Direct Peers
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {!bridgeAvailable ? (
                <div className="px-2 py-1 bg-red-500/10 text-red-500 border border-red-500/30 rounded text-[10px] font-mono font-bold">
                  NATIVE REQ
                </div>
              ) : (
                <>
                  <button 
                    onClick={() => window.ResQMeshNative?.startMesh()}
                    disabled={isConnected}
                    className="h-8 px-2.5 rounded-md bg-[#242932] text-[#F8FAFC] border border-[#3E4A5B] text-[11px] font-bold uppercase active:scale-95 transition-all disabled:opacity-50"
                  >
                    Start
                  </button>
                  <button 
                    onClick={() => window.ResQMeshNative?.stopMesh()}
                    disabled={!isConnected}
                    className="h-8 px-2.5 rounded-md bg-[#242932] text-amber-500 border border-[#3E4A5B] text-[11px] font-bold uppercase active:scale-95 transition-all disabled:opacity-50"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>
          
          {/* Channel Header (Based on active tab) */}
          <div className="px-3 py-2 bg-[#1A1E24] border-b border-[#2D3748] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-500 font-mono text-[12px] font-bold">
                {activeTab === 'broadcast' ? '#' : activeTab === 'peers' ? '@' : '*'}
              </div>
              <div>
                <h1 className="font-semibold text-[14px] text-[#F8FAFC] leading-tight">
                  {activeTab === 'broadcast' ? 'emergency-broadcast' : activeTab === 'peers' ? 'nearby-devices' : 'mesh-topology'}
                </h1>
                <p className="text-[12px] text-[#94A3B8] leading-none mt-0.5">
                  {snapshot.status}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto px-3 py-4 bg-[#111418] space-y-4" ref={scrollRef}>
          {activeTab === 'broadcast' && (
            <>
              {/* Notice Banner */}
              <div className="p-2 bg-[#242932]/60 border border-[#2D3748] rounded-md flex items-center gap-2 mb-4">
                <AlertCircle className="text-amber-500 h-4 w-4 shrink-0" />
                <p className="font-mono text-[10px] text-[#94A3B8] flex-1 leading-tight uppercase">
                  Flood-routing mesh active. Messages propagate to all connected peers automatically.
                </p>
              </div>

              {messages.length > 0 ? messages.map((m) => {
                if (m.notice) {
                  return (
                    <div key={m.id} className="flex justify-center my-2">
                      <span className="px-2 py-0.5 bg-[#1A1E24] text-[10px] font-mono text-[#94A3B8] rounded border border-[#2D3748]">
                        {m.text}
                      </span>
                    </div>
                  );
                }
                
                return (
                  <article key={m.id} className={cn("flex flex-col gap-1 items-start max-w-[92%]", m.mine && "items-end self-end ml-auto")}>
                    {/* Sender Header */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {!m.mine && <span className="w-2 h-2 rounded-full bg-[#0D9488]"></span>}
                      <span className={cn("font-mono text-[11px] font-bold", m.mine ? "text-amber-500" : "text-[#0D9488]")}>
                        {m.sender}
                      </span>
                      {m.mine && <span className="w-2 h-2 rounded-full bg-amber-500"></span>}
                    </div>
                    
                    {/* Bubble Container */}
                    <div className={cn(
                      "w-full bg-[#1A1E24] border border-[#2D3748] rounded-md p-3 text-[#F8FAFC] relative shadow-sm",
                      m.mine ? "border-amber-500/30" : ""
                    )}>
                      <div className={cn(
                        "absolute top-3.5 w-1 h-5 rounded",
                        m.mine ? "-right-1 bg-amber-500" : "-left-1 bg-[#0D9488]"
                      )}></div>
                      <p className="text-[14px] leading-relaxed">
                        {m.text}
                      </p>
                      
                      {m.location && (
                        <div className="mt-3 p-2 rounded bg-[#0B0E12] border border-[#2D3748] flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[#0D9488]">
                              <MapPin className="h-4 w-4" />
                              <span className="font-mono text-[10px] font-bold">GPS PAYLOAD</span>
                            </div>
                            <span className="font-mono text-[9px] text-[#94A3B8]">WGS84</span>
                          </div>
                          <div className="font-mono text-[11px] bg-[#1A1E24] px-2 py-1.5 rounded border border-[#2D3748] flex justify-between">
                            <span>{m.location.latitude.toFixed(4)}, {m.location.longitude.toFixed(4)}</span>
                            <span className="text-[#0D9488] text-[9px]">±{Math.round(m.location.accuracyMeters)}m</span>
                          </div>
                        </div>
                      )}

                      <div className="mt-2 pt-1.5 border-t border-[#3E4A5B] flex items-center justify-between text-[#94A3B8]">
                        <span className="font-mono text-[9px] flex items-center gap-1">
                          <Activity className="h-3 w-3" /> 
                          {m.mine ? "Delivered to Mesh" : "Received via Mesh"}
                        </span>
                        <span className="font-mono text-[9px]">{m.timestamp}</span>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="h-full flex flex-col items-center justify-center text-[#94A3B8] select-none py-10">
                  <Signal className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm font-semibold">No messages</p>
                  <p className="text-xs mt-1">Broadcast to nearby peers</p>
                </div>
              )}
            </>
          )}

          {activeTab === 'peers' && (
            <div className="space-y-3">
              {snapshot.peers.length > 0 ? snapshot.peers.map((peer, i) => (
                <div key={i} className="bg-[#1A1E24] border border-[#2D3748] rounded-md p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#0D9488]/20 border border-[#0D9488]/40 flex items-center justify-center text-[#0D9488]">
                    <LinkIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-mono text-[13px] font-bold text-[#F8FAFC]">{peer}</h3>
                    <p className="text-[11px] text-[#94A3B8]">Direct Connection</p>
                  </div>
                  <div className="px-2 py-1 bg-[#0D9488]/10 text-[#0D9488] text-[10px] font-mono font-bold border border-[#0D9488]/30 rounded">
                    ACTIVE
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 text-[#94A3B8]">
                  <p className="text-sm">No peers connected.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'topology' && (
            <div className="space-y-3">
              <div className="p-3 bg-[#1A1E24] border border-[#2D3748] rounded-md text-[#F8FAFC]">
                <h3 className="font-mono text-[12px] text-amber-500 font-bold mb-2 uppercase">Local Node</h3>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 bg-amber-500 rounded-full" />
                  <span className="font-bold">This Device</span>
                </div>
                
                <h3 className="font-mono text-[12px] text-[#0D9488] font-bold mb-2 uppercase">Direct Links ({snapshot.peers.length})</h3>
                <div className="pl-2 border-l-2 border-[#3E4A5B] space-y-2">
                  {snapshot.peers.map((peer, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-[#0D9488] rounded-full" />
                      <span className="font-mono text-[12px]">{peer}</span>
                    </div>
                  ))}
                  {snapshot.peers.length === 0 && (
                    <p className="text-[11px] text-[#94A3B8]">No links active</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Input Form (Only on Broadcast) */}
        {activeTab === 'broadcast' && (
          <form
            className="flex-none p-3 border-t border-[#2D3748] bg-[#1A1E24] z-50"
            onSubmit={(e) => { e.preventDefault(); send(); }}
          >
            {/* Location Attachment Status */}
            {includeLocation && (
              <div className="mb-2 px-2 py-1.5 rounded bg-[#0B0E12] border border-[#2D3748] flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <MapPin className={cn("h-3 w-3", snapshot.isAcquiringLocation ? "animate-pulse text-[#94A3B8]" : snapshot.locationPreview ? "text-[#0D9488]" : "text-[#94A3B8]")} />
                  {snapshot.isAcquiringLocation ? (
                    <span className="text-[#94A3B8]">ACQUIRING FIX...</span>
                  ) : snapshot.locationError ? (
                    <span className="text-red-500 font-bold">{snapshot.locationError}</span>
                  ) : snapshot.locationPreview ? (
                    <span className="text-[#F8FAFC]">
                      <span className={cn("font-bold", snapshot.locationPreview.isCached ? "text-amber-500" : "text-[#0D9488]")}>
                        {snapshot.locationPreview.isCached ? "GPS CACHED" : "GPS READY"}
                      </span> 
                      <span className="text-[#94A3B8] ml-1">(±{snapshot.locationPreview.accuracyMeters.toFixed(0)}m)</span>
                    </span>
                  ) : (
                    <span className="text-[#94A3B8]">WAITING...</span>
                  )}
                </div>
                {snapshot.locationError && (
                  <button type="button" onClick={() => window.ResQMeshNative?.requestLocation?.()} className="text-[10px] text-amber-500 font-bold hover:underline">
                    RETRY
                  </button>
                )}
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                   setIncludeLocation(!includeLocation);
                   if (!includeLocation) window.ResQMeshNative?.requestLocation?.();
                }}
                className={cn(
                  "w-10 h-10 rounded-md flex items-center justify-center transition-colors border", 
                  includeLocation ? "text-[#0D9488] bg-[#0D9488]/10 border-[#0D9488]/30" : "text-[#94A3B8] bg-[#242932] border-[#3E4A5B] hover:bg-[#323946]"
                )}
                disabled={!bridgeAvailable}
              >
                <MapPin className="h-5 w-5" />
              </button>
              
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={bridgeAvailable ? "Broadcast message..." : "Messaging disabled in preview"}
                disabled={!bridgeAvailable}
                className="flex-1 h-10 bg-[#0B0E12] border border-[#2D3748] rounded-md px-3 text-[14px] text-[#F8FAFC] placeholder:text-[#64748B] focus:outline-none focus:border-[#0D9488] transition-all"
              />
              
              <button
                type="submit"
                disabled={!bridgeAvailable || !draft.trim()}
                className="h-10 px-4 rounded-md text-[#111418] font-bold uppercase text-[12px] bg-amber-500 disabled:opacity-50 disabled:bg-[#3E4A5B] hover:bg-amber-400 active:scale-95 transition-all flex items-center gap-1.5"
              >
                Send <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Bottom Navigation */}
        <nav className="absolute bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-2 h-16 bg-[#0B0E12] border-t border-[#2D3748]">
          <button onClick={() => setActiveTab('broadcast')} className={cn("flex flex-col items-center justify-center py-1 px-3 border-t-2 transition-all", activeTab === 'broadcast' ? "text-amber-500 border-amber-500" : "text-[#64748B] border-transparent hover:text-[#94A3B8]")}>
            <Radio className="h-6 w-6" />
            <span className="text-[10px] font-mono font-bold uppercase mt-1">Broadcast</span>
          </button>
          
          <button onClick={() => setActiveTab('peers')} className={cn("flex flex-col items-center justify-center py-1 px-3 border-t-2 transition-all", activeTab === 'peers' ? "text-amber-500 border-amber-500" : "text-[#64748B] border-transparent hover:text-[#94A3B8]")}>
            <LinkIcon className="h-6 w-6" />
            <span className="text-[10px] font-mono font-bold uppercase mt-1">Peers</span>
          </button>
          
          <button onClick={() => setActiveTab('topology')} className={cn("flex flex-col items-center justify-center py-1 px-3 border-t-2 transition-all", activeTab === 'topology' ? "text-amber-500 border-amber-500" : "text-[#64748B] border-transparent hover:text-[#94A3B8]")}>
            <Network className="h-6 w-6" />
            <span className="text-[10px] font-mono font-bold uppercase mt-1">Topology</span>
          </button>
        </nav>
      </section>
    </div>
  );
}
