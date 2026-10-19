import { useState, useEffect } from 'react';
import {
  Siren, Building2, Wifi, WifiOff, Power, Search,
  BadgeCheck, Menu, Sun, Moon, Brain, ShieldAlert,
  ChevronDown, Users, Radio, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { NetworkStatus } from '@/hooks/use-network';

interface MeshSnapshot {
  status: string;
  peers: string[];
}

const EMPTY_SNAPSHOT: MeshSnapshot = {
  status: 'Mesh stopped',
  peers: [],
};

interface TopNavProps {
  status: NetworkStatus;
  onToggleNetwork: () => void;
  onSos: () => void;
  onShelter: () => void;
  onFindHelp: () => void;
  onOfferHelp: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onTriage?: () => void;
  onNgoPortal?: () => void;
  onMesh?: () => void;
  onHome?: () => void;
  ngoLoggedIn?: boolean;
  volunteerLoggedIn?: boolean;
  ngoName?: string;
}

export function TopNav({
  status, onToggleNetwork, onSos, onShelter,
  onFindHelp, onOfferHelp, theme, onToggleTheme, onTriage,
  onNgoPortal, onMesh, onHome, ngoLoggedIn, volunteerLoggedIn, ngoName,
}: TopNavProps) {
  const isOnline = status === 'online';
  const isNgoActive = ngoLoggedIn || volunteerLoggedIn;

  const [mesh, setMesh] = useState<MeshSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<MeshSnapshot>).detail;
      if (!detail) return;
      setMesh({
        status: typeof detail.status === 'string' ? detail.status : EMPTY_SNAPSHOT.status,
        peers: Array.isArray(detail.peers) ? detail.peers : [],
      });
    };
    
    // Initial fetch
    try {
      // @ts-ignore
      const raw = window.ResQMeshNative?.getSnapshot();
      if (raw) {
        const parsed = JSON.parse(raw);
        setMesh({
          status: parsed.status || EMPTY_SNAPSHOT.status,
          peers: Array.isArray(parsed.peers) ? parsed.peers : [],
        });
      }
    } catch {}

    window.addEventListener('resqmesh-mesh-update', onUpdate);
    return () => window.removeEventListener('resqmesh-mesh-update', onUpdate);
  }, []);

  const isMeshConnected = mesh.peers.length > 0;
  const isMeshSearching = mesh.status.toLowerCase().includes('advertising') || mesh.status.toLowerCase().includes('starting');
  const isMeshStopped = mesh.status.toLowerCase().includes('stopped') || mesh.status.toLowerCase().includes('idle');

  return (
    <header className="sticky top-0 z-40 w-full">
      {/* Sleek emergency status ticker */}
      <div className={cn(
        'w-full px-4 py-1 text-center text-[11px] font-medium tracking-wide transition-all duration-300 border-b backdrop-blur-md',
        isOnline
          ? 'bg-emerald-500/[0.08] text-emerald-400 border-emerald-500/15'
          : 'bg-amber-500/[0.08] text-amber-400 border-amber-500/15',
      )}>
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className={cn(
              'absolute inline-flex h-full w-full animate-ping-slow rounded-full opacity-70',
              isOnline ? 'bg-emerald-400' : 'bg-amber-400'
            )} />
            <span className={cn('relative inline-flex h-2 w-2 rounded-full', isOnline ? 'bg-emerald-400' : 'bg-amber-400')} />
          </span>
          <span className="tracking-tight">
            {isOnline
              ? 'Emergency Network Active · ResQ Linkk Disaster Response System'
              : 'Offline Mode Active · Local Data Stored & Ready to Sync'}
          </span>
        </span>
      </div>

      {/* Main header bar */}
      <div className="w-full border-b border-border/60 glass-strong">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-3 sm:px-6 gap-3">

          {/* ── LEFT: Brand ── */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
            {/* Logo mark */}
            <button 
              onClick={onHome}
              className="group flex items-center gap-2.5 hover:opacity-90 transition-all duration-200 active:scale-95 focus:outline-none"
            >
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.1] shadow-sm transition-transform duration-300 group-hover:scale-105 hidden sm:flex">
                <ShieldAlert className="h-4.5 w-4.5 text-red-500" />
                <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              </div>

              {/* Brand name */}
              <div className="leading-tight text-left">
                <div className="flex items-baseline gap-1">
                  <span className="text-[15px] font-semibold tracking-tight text-foreground">
                    ResQ
                  </span>
                  <span className="text-[15px] font-semibold tracking-tight text-red-500">
                    Linkk
                  </span>
                </div>
                <span className="hidden text-[10px] font-medium tracking-normal text-muted-foreground/80 md:block">
                  Disaster Coordinator
                </span>
              </div>
            </button>

            {/* Separator */}
            <div className="hidden md:block h-7 w-px bg-border/60 mx-1" />

            {/* Mesh Indicator (Compact) */}
            {onMesh && (
              <button 
                onClick={onMesh}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all duration-200 active:scale-95',
                  isMeshConnected 
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' 
                    : isMeshSearching
                      ? 'border-amber-500/25 bg-amber-500/10 text-amber-400'
                      : 'border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary/70'
                )}
                aria-label="Open Mesh Panel"
              >
                {isMeshConnected ? (
                  <>
                    <Activity className="h-3 w-3 animate-pulse text-emerald-400" />
                    <span className="hidden sm:inline">Mesh ({mesh.peers.length})</span>
                    <span className="sm:hidden">Mesh ({mesh.peers.length})</span>
                  </>
                ) : isMeshSearching ? (
                  <>
                    <span className="relative flex h-2 w-2 mr-0.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                    </span>
                    <span className="hidden sm:inline">Searching</span>
                    <span className="sm:hidden">Sync...</span>
                  </>
                ) : (
                  <>
                    <Radio className="h-3 w-3" />
                    <span className="hidden sm:inline">Mesh Standby</span>
                    <span className="sm:hidden">Mesh Off</span>
                  </>
                )}
              </button>
            )}

            {/* Network pill (Internet) */}
            <div className={cn(
              'hidden lg:flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all duration-200',
              isOnline
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-400',
            )}>
              {isOnline ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-amber-400" />
                  <span>Offline</span>
                </>
              )}
            </div>
          </div>

          {/* ── RIGHT: Actions ── */}
          <div className="flex items-center gap-2">

            {/* Mock network toggle — desktop */}
            <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-secondary/35 px-3 py-1 lg:flex transition-colors">
              <Power className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] font-medium text-muted-foreground">Mock Net</span>
              <Switch
                checked={isOnline}
                onCheckedChange={onToggleNetwork}
                aria-label="Toggle mock network"
                className="scale-75 origin-right"
              />
            </div>

            {/* Action buttons — md+ */}
            <div className="hidden items-center gap-1.5 md:flex">
              <NavButton
                onClick={onOfferHelp}
                icon={<BadgeCheck className="h-3.5 w-3.5 text-emerald-400" />}
                label="Offer Help"
              />
              <NavButton
                onClick={onFindHelp}
                icon={<Search className="h-3.5 w-3.5 text-blue-400" />}
                label="Find Help"
              />
              {onTriage && (
                <NavButton
                  onClick={onTriage}
                  icon={<Brain className="h-3.5 w-3.5 text-amber-400" />}
                  label="Triage"
                />
              )}
              {onNgoPortal && (
                <NavButton
                  onClick={onNgoPortal}
                  icon={<Users className={cn('h-3.5 w-3.5', isNgoActive ? 'text-primary' : 'text-muted-foreground')} />}
                  label={isNgoActive ? (ngoName ? ngoName.split(' ')[0] : 'NGO') : 'NGO'}
                  className={cn(isNgoActive && 'border-primary/40 bg-primary/10 text-primary')}
                />
              )}
              <NavButton
                onClick={onShelter}
                icon={<Building2 className="h-3.5 w-3.5 text-blue-400" />}
                label="Shelters"
              />
              {onMesh && (
                <NavButton
                  onClick={onMesh}
                  icon={<Radio className="h-3.5 w-3.5 text-emerald-400" />}
                  label="Mesh"
                />
              )}
            </div>

            {/* SOS — always visible (Apple-styled emergency action button) */}
            <button
              onClick={onSos}
              className={cn(
                'relative flex h-8.5 shrink-0 items-center gap-1.5 rounded-full px-4',
                'bg-red-600 hover:bg-red-500 text-white font-medium text-xs sm:text-[13px] tracking-tight',
                'shadow-sm shadow-red-600/25 hover:shadow-md hover:shadow-red-600/35',
                'transition-all duration-200 active:scale-95',
                'ring-1 ring-white/20',
              )}
              aria-label="Request emergency aid"
            >
              <Siren className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Request Aid</span>
              <span className="sm:hidden">SOS</span>
            </button>

            {/* Theme toggle */}
            <button
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
              className={cn(
                'flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full',
                'border border-border/60 bg-secondary/40 text-muted-foreground',
                'hover:bg-secondary hover:text-foreground active:scale-95 transition-all duration-200',
              )}
            >
              {theme === 'dark'
                ? <Sun className="h-4 w-4 text-warning" />
                : <Moon className="h-4 w-4 text-info" />
              }
            </button>

            {/* Mobile menu */}
            <div className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-xl',
                      'border border-border bg-secondary/30',
                      'hover:bg-secondary transition-colors',
                    )}
                    aria-label="More navigation options"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 bg-card border-border p-1.5 shadow-2xl rounded-xl"
                >
                  <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1.5">
                    Quick Actions
                  </DropdownMenuLabel>
                  <MobileMenuItem
                    onClick={onOfferHelp}
                    icon={<BadgeCheck className="h-4 w-4 text-success" />}
                    label="Offer Help / Resources"
                  />
                  <MobileMenuItem
                    onClick={onFindHelp}
                    icon={<Search className="h-4 w-4 text-info" />}
                    label="Find Help Near You"
                  />
                  {onTriage && (
                    <MobileMenuItem
                      onClick={onTriage}
                      icon={<Brain className="h-4 w-4 text-warning" />}
                      label="AI Emergency Triage"
                    />
                  )}
                  {onNgoPortal && (
                    <MobileMenuItem
                      onClick={onNgoPortal}
                      icon={<Users className={cn('h-4 w-4', isNgoActive ? 'text-primary' : 'text-muted-foreground')} />}
                      label={isNgoActive ? `NGO Portal${ngoName ? ` — ${ngoName.split(' ')[0]}` : ''}` : 'NGO / Volunteer Portal'}
                    />
                  )}
                  <MobileMenuItem
                    onClick={onShelter}
                    icon={<Building2 className="h-4 w-4 text-info" />}
                    label="Shelter Portal"
                  />
                  {onMesh && (
                    <MobileMenuItem
                      onClick={onMesh}
                      icon={<Radio className="h-4 w-4 text-success" />}
                      label="Offline Mesh Messaging"
                    />
                  )}
                  <DropdownMenuSeparator className="my-1 bg-border" />
                  <MobileMenuItem
                    onClick={onToggleTheme}
                    icon={theme === 'dark'
                      ? <Sun className="h-4 w-4 text-warning" />
                      : <Moon className="h-4 w-4 text-info" />
                    }
                    label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  />
                  <DropdownMenuSeparator className="my-1 bg-border" />
                  {/* Network toggle inline */}
                  <div className="flex items-center justify-between rounded-md px-2 py-2 text-xs">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Power className="h-3.5 w-3.5" />
                      <span className="font-medium">Mock Network</span>
                    </span>
                    <Switch
                      checked={isOnline}
                      onCheckedChange={onToggleNetwork}
                      aria-label="Toggle network mode"
                    />
                  </div>
                  {/* Mobile network status */}
                  <div className={cn(
                    'mx-2 mt-1 mb-0.5 flex items-center gap-1.5 rounded-lg px-2.5 py-2',
                    isOnline ? 'bg-success/10 border border-success/20' : 'bg-warning/10 border border-warning/20',
                  )}>
                    {isOnline
                      ? <Wifi className="h-3 w-3 text-success" />
                      : <WifiOff className="h-3 w-3 text-warning" />
                    }
                    <span className={cn('text-[11px] font-semibold', isOnline ? 'text-success' : 'text-warning')}>
                      {isOnline ? 'Online' : 'Offline — Local Data Active'}
                    </span>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

          </div>
        </div>
      </div>
    </header>
  );
}

/* ── Helpers ── */

function NavButton({
  onClick, icon, label, className,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium',
        'border-border/50 bg-secondary/35 text-foreground hover:bg-secondary hover:border-border/80 transition-all duration-200 active:scale-95',
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileMenuItem({
  onClick, icon, label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className="flex items-center gap-2.5 py-2 px-2 text-xs font-medium cursor-pointer rounded-lg focus:bg-secondary"
    >
      {icon}
      <span>{label}</span>
    </DropdownMenuItem>
  );
}
