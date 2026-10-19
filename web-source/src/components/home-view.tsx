import { Radio, Siren, Map, ListChecks, Building2, ChevronRight, Activity, AlertTriangle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AidRequest } from '@/types';
import type { MapRegion } from '@/components/map-view';
import { REGION_ZONES } from '@/mockData';

interface HomeViewProps {
  requests: AidRequest[];
  region: MapRegion;
  meshConnected: boolean;
  meshPeersCount: number;
  isOnline: boolean;
  onSos: () => void;
  onMesh: () => void;
  onNavigateTab: (tab: 'map' | 'feed' | 'shelters') => void;
}

export function HomeView({
  requests,
  region,
  meshConnected,
  meshPeersCount,
  isOnline: _isOnline,
  onSos,
  onMesh,
  onNavigateTab
}: HomeViewProps) {
  const info = REGION_ZONES[region];
  const recentRequests = requests.slice(0, 3); // Get latest 3

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 sm:p-5 pb-24 scrollbar-thin">
      {/* Apple-style Hero Overview Card */}
      <div className="rounded-3xl border border-border/60 bg-gradient-to-b from-card/90 to-card/50 p-5 sm:p-6 backdrop-blur-xl relative overflow-hidden shadow-sm transition-all duration-300">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
            </span>
            Active Emergency Zone
          </span>
          <span className="text-xs text-muted-foreground/70">·</span>
          <span className="text-xs font-medium text-muted-foreground">{info.location.split(',')[0]}</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          {info.zone}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-amber-400/90 font-medium flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {info.hazard}
        </p>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-xl">
          {info.location} — Offline-ready predictive triage, TinyFish live relief feed, and volunteer dispatch active.
        </p>
      </div>

      {/* Mesh Status Card (Apple Watch / iOS widget style) */}
      <button 
        onClick={onMesh}
        className={cn(
          "group flex items-center justify-between rounded-2xl border p-4 text-left transition-all duration-300 ease-apple hover:-translate-y-0.5 active:scale-[0.98]",
          meshConnected 
            ? "border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.1]" 
            : "border-border/60 bg-card/75 hover:bg-secondary/60 hover:border-border"
        )}
      >
        <div className="flex items-center gap-3.5">
          <div className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-105",
            meshConnected ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground"
          )}>
            <Radio className={cn("h-5 w-5", meshConnected && "animate-pulse")} />
          </div>
          <div>
            <h2 className={cn("text-sm font-semibold tracking-tight", meshConnected ? "text-emerald-400" : "text-foreground")}>
              Offline Mesh Network
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {meshConnected ? `Connected to ${meshPeersCount} direct peers · P2P Synced` : "Offline mesh standby. Tap to open radar."}
            </p>
          </div>
        </div>
        <ChevronRight className={cn("h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5", meshConnected ? "text-emerald-400" : "text-muted-foreground")} />
      </button>

      {/* Primary Actions Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Apple Action Button: Request Aid */}
        <button 
          onClick={onSos}
          className="col-span-2 flex items-center justify-center gap-2.5 rounded-2xl bg-red-600 hover:bg-red-500 py-3.5 text-white font-medium text-sm tracking-tight shadow-sm shadow-red-600/25 hover:shadow-md hover:shadow-red-600/35 transition-all duration-200 active:scale-[0.98]"
        >
          <Siren className="h-4.5 w-4.5 shrink-0" />
          <span>Send SOS / Request Aid</span>
        </button>

        <ActionCard 
          icon={<Map className="h-4.5 w-4.5 text-blue-400" />} 
          title="Interactive Map" 
          subtitle="Real-time incident pins"
          onClick={() => onNavigateTab('map')} 
        />
        <ActionCard 
          icon={<ListChecks className="h-4.5 w-4.5 text-emerald-400" />} 
          title="Needs Feed" 
          subtitle="Triaged community help"
          onClick={() => onNavigateTab('feed')} 
        />
        <ActionCard 
          icon={<Building2 className="h-4.5 w-4.5 text-amber-400" />} 
          title="Shelters & Camps" 
          subtitle="Verified locations & capacity"
          onClick={() => onNavigateTab('shelters')} 
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Recent Activity */}
      <div className="rounded-3xl border border-border/60 bg-card/75 p-5 backdrop-blur-xl shadow-sm mt-1">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-blue-400" />
            Recent Activity
          </h2>
          <button 
            onClick={() => onNavigateTab('feed')} 
            className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            View All
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          {recentRequests.length > 0 ? (
            recentRequests.map(req => (
              <div 
                key={req.id} 
                className="flex flex-col gap-1 rounded-2xl border border-border/50 bg-secondary/30 p-3.5 transition-all duration-200 hover:bg-secondary/50 hover:border-border/80"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground tracking-tight">{req.title}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{req.category}</span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-1">{req.details}</p>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No recent requests recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionCard({ 
  icon, 
  title, 
  subtitle, 
  onClick, 
  className 
}: { 
  icon: React.ReactNode; 
  title: string; 
  subtitle: string; 
  onClick: () => void; 
  className?: string; 
}) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-2.5 rounded-2xl border border-border/60 bg-card/75 p-4 text-left transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md active:scale-[0.98]",
        className
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/70 border border-border/40 transition-transform duration-300 group-hover:scale-105">
        {icon}
      </div>
      <div>
        <div className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{subtitle}</div>
      </div>
    </button>
  );
}
