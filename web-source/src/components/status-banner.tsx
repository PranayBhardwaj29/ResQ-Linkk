import {
  AlertTriangle, MapPin, Radio, ChevronDown, Map,
  Activity, BedDouble, Users, Flame, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FILTER_TABS } from '@/types';
import type { FilterCategory } from '@/types';
import { REGION_ZONES } from '@/mockData';
import type { MapRegion } from '@/components/map-view';
import { useState } from 'react';

interface StatusBannerProps {
  activeFilter: FilterCategory;
  onFilterChange: (f: FilterCategory) => void;
  requestCount: number;
  region: MapRegion;
  onRegionChange: (r: MapRegion) => void;
}

const REGION_OPTIONS: { value: MapRegion; label: string; flag: string }[] = [
  { value: 'ncr',       label: 'Delhi NCR',             flag: '🏙️' },
  { value: 'badrinath', label: 'Badrinath / Joshimath', flag: '🏔️' },
];

/* Category icons for filter tabs */
const TAB_ICONS: Record<string, React.ReactNode> = {
  all:        <Activity   className="h-3.5 w-3.5" />,
  medical:    <Flame      className="h-3.5 w-3.5" />,
  food:       <Users      className="h-3.5 w-3.5" />,
  shelter:    <BedDouble  className="h-3.5 w-3.5" />,
  volunteers: <Users      className="h-3.5 w-3.5" />,
};

export function StatusBanner({
  activeFilter,
  onFilterChange,
  requestCount,
  region,
  onRegionChange,
}: StatusBannerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const info = REGION_ZONES[region];

  /* Derive a "critical" count as a fraction of total for the stat card */
  const criticalCount = Math.max(1, Math.round(requestCount * 0.3));

  return (
    <div className="w-full border-b border-border/50 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-6 sm:py-3.5 space-y-3">

        {/* ── ROW 1: Emergency status + region switcher ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Left — zone identity */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Subtle alert status dot & badge */}
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground truncate">
                  {info.zone}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                  <Radio className="h-2 w-2" />
                  Active Incident
                </span>
              </div>

              {/* Location + hazard */}
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 shrink-0 text-blue-400" />
                  {info.location}
                </span>
                <span className="text-border">·</span>
                <span className="text-amber-400/90 font-medium truncate">
                  {info.hazard}
                </span>
              </div>
            </div>
          </div>

          {/* Right — region switcher */}
          <div className="relative flex-shrink-0 self-start sm:self-center">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium',
                'bg-secondary/40 shadow-sm backdrop-blur-md transition-all duration-200 hover:bg-secondary/70 active:scale-95',
                menuOpen ? 'border-blue-500/50 text-blue-400' : 'border-border/60 text-foreground',
              )}
            >
              <Map className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              <span className="hidden sm:inline text-muted-foreground">Region:</span>
              <span className="font-semibold">
                {REGION_OPTIONS.find(r => r.value === region)?.flag}{' '}
                {REGION_OPTIONS.find(r => r.value === region)?.label}
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', menuOpen && 'rotate-180')} />
            </button>

            {/* Dropdown */}
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 w-72 sm:w-80 overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-2xl animate-float-up">
                  <div className="px-4 pt-3 pb-2 border-b border-border/50">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Select Emergency Region
                    </p>
                  </div>
                  {REGION_OPTIONS.map(opt => {
                    const ri = REGION_ZONES[opt.value];
                    const isActive = region === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => { onRegionChange(opt.value); setMenuOpen(false); }}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-secondary/60',
                          isActive && 'bg-blue-500/[0.08] border-l-2 border-blue-500',
                        )}
                      >
                        <span className="mt-0.5 text-xl shrink-0 leading-none">{opt.flag}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-semibold leading-tight', isActive ? 'text-blue-400' : 'text-foreground')}>
                              {opt.label}
                            </p>
                            {isActive && (
                              <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.2 text-[9px] font-semibold text-blue-400 uppercase tracking-wider">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed truncate">
                            {ri.location}
                          </p>
                          <p className="mt-0.5 text-[10px] text-amber-400/80 leading-tight truncate">
                            {ri.hazard}
                          </p>
                          <div className="mt-1.5 flex items-center gap-3">
                            <RegionMiniStat label="Requests"  value={ri.stats.requestCount} />
                            <RegionMiniStat label="Shelters"  value={ri.stats.shelterCount} />
                            <RegionMiniStat label="Responders" value={ri.stats.responderCount} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── ROW 2: Apple-style segmented control filter tabs ── */}
        <div className="flex overflow-x-auto scrollbar-hide touch-pan-x py-0.5">
          <div className="inline-flex p-1 rounded-full bg-secondary/45 border border-border/50 backdrop-blur-md gap-1">
            {FILTER_TABS.map((tab) => {
              const active = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onFilterChange(tab.id)}
                  className={cn(
                    'relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium',
                    'transition-all duration-200 whitespace-nowrap active:scale-95',
                    active
                      ? 'bg-card text-foreground font-semibold shadow-sm border border-border/60'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
                  )}
                >
                  {TAB_ICONS[tab.id] && (
                    <span className={cn('shrink-0 transition-colors', active ? 'text-red-500' : 'text-muted-foreground/60')}>
                      {TAB_ICONS[tab.id]}
                    </span>
                  )}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({
  value,
  label,
  valueClass,
  borderClass,
  bgClass,
  dot,
}: {
  value: number;
  label: string;
  valueClass: string;
  borderClass: string;
  bgClass: string;
  dot: string;
}) {
  return (
    <div className={cn(
      'flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors',
      borderClass, bgClass,
    )}>
      <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} />
      <div className="leading-none">
        <p className={cn('text-xl font-extrabold leading-none tabular-nums', valueClass)}>
          {value}
        </p>
        <p className="mt-1 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
          {label}
        </p>
      </div>
    </div>
  );
}

function RegionMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-[9px] text-muted-foreground">
      <span className="font-bold text-foreground">{value}</span> {label}
    </span>
  );
}
