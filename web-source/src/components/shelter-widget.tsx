import { useState, useEffect } from 'react';
import { Home, Users, MapPin, Navigation, ExternalLink, ArrowLeft, BedDouble, RefreshCw, Globe, Phone } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { cn, buildGoogleMapsUrl } from '@/lib/utils';
import type { Shelter } from '@/types';
import type { NavDestination } from '@/hooks/use-navigation';
import { useModalBack } from '@/hooks/use-modal-back';
import { fetchLiveReliefFeed, refreshLiveRelief, LiveReliefItem } from '@/lib/tinyfish';
import { LiveFeedBadge } from '@/components/LiveFeedBadge';
import { toast } from 'sonner';

interface ShelterWidgetProps {
  shelters: Shelter[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationLabel?: string;
  onNavigate?: (dest: NavDestination) => void;
}

export function ShelterWidget({
  shelters,
  open,
  onOpenChange,
  locationLabel = 'Delhi NCR',
  onNavigate,
}: ShelterWidgetProps) {
  useModalBack(open, () => onOpenChange(false));

  const [liveShelters, setLiveShelters] = useState<LiveReliefItem[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    setLoading(true);
    setError(null);
    fetchLiveReliefFeed(locationLabel, 'shelter')
      .then((items) => {
        if (isMounted) {
          const sheltersOnly = items.filter((i) => i.kind === 'shelter');
          setLiveShelters(sheltersOnly);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setError('Failed to load live web shelters.');
          setLoading(false);
        }
      });
    return () => { isMounted = false; };
  }, [open, locationLabel]);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    toast.info('Scanning live web relief camps via TinyFish…');
    try {
      const items = await refreshLiveRelief(locationLabel);
      const sheltersOnly = items.filter((i) => i.kind === 'shelter');
      setLiveShelters(sheltersOnly);
      toast.success(`TinyFish live shelters updated: ${sheltersOnly.length} found.`);
    } catch {
      setError('Live refresh failed. Showing cached data.');
      toast.error('TinyFish shelter scan failed; showing cached shelters.');
    } finally {
      setLoading(false);
    }
  };

  const totalCapacity = shelters.reduce((s, sh) => s + sh.capacity, 0);
  const totalOccupied = shelters.reduce((s, sh) => s + sh.occupied, 0);
  const totalFree     = totalCapacity - totalOccupied;
  const overallPct    = Math.round((totalOccupied / Math.max(1, totalCapacity)) * 100);
  const openCount     = shelters.filter((s) => s.status === 'open').length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">

        {/* ── Sticky header ── */}
        <div className="sticky top-0 z-10 border-b border-border glass-strong px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50
                px-2.5 py-1.5 text-xs font-bold hover:bg-secondary active:scale-95 transition-all"
              aria-label="Go back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-info/15 ring-1 ring-info/25">
              <Home className="h-4 w-4 text-info" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-sm font-bold">Shelter Portal</SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground truncate mt-0.5">
                {openCount} open · {totalFree} beds available · {locationLabel}
              </SheetDescription>
            </div>
          </div>
        </div>

        {/* ── Regional capacity summary ── */}
        <div className="border-b border-border px-4 sm:px-6 py-4">
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Regional Capacity
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {totalOccupied}
                <span className="text-muted-foreground font-normal"> / {totalCapacity} beds occupied</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold text-success leading-none">{totalFree}</p>
              <p className="text-[10px] text-muted-foreground">free beds</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                overallPct > 85 ? 'bg-alert' : overallPct > 65 ? 'bg-warning' : 'bg-success',
              )}
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>{overallPct}% occupied</span>
            <span>{openCount} of {shelters.length} shelters open</span>
          </div>
        </div>

        {/* ── Live Web Relief Camps (via TinyFish) ── */}
        <div className="border-b border-border bg-info/[0.02] px-4 sm:px-6 py-3.5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-bold text-info">
                <Globe className="h-3.5 w-3.5" />
                <span>Live Relief Camps & Shelters</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Scraped live from open web & official boards via TinyFish
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className={cn(
                'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-all',
                loading
                  ? 'border-info/30 bg-info/10 text-info cursor-not-allowed'
                  : 'border-border bg-card hover:bg-secondary active:scale-95 text-foreground shadow-sm'
              )}
            >
              <RefreshCw className={cn('h-3 w-3', loading ? 'animate-spin text-info' : 'text-muted-foreground')} />
              <span>{loading ? 'Scanning...' : 'Refresh live data'}</span>
            </button>
          </div>

          {error && (
            <p className="text-[11px] text-warning bg-warning/10 p-2 rounded-lg border border-warning/20 mb-2">
              {error}
            </p>
          )}

          {loading && liveShelters.length === 0 && (
            <div className="py-6 text-center">
              <RefreshCw className="h-5 w-5 animate-spin mx-auto text-info mb-1" />
              <p className="text-[11px] text-muted-foreground">Scanning relief camps via TinyFish...</p>
            </div>
          )}

          {!loading && liveShelters.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-2 text-center">
              No live web shelters active in this area. Click Refresh live data to scan.
            </p>
          )}

          {liveShelters.length > 0 && (
            <div className="space-y-2.5">
              {liveShelters.map((ls) => (
                <div
                  key={ls.id}
                  className="rounded-xl border border-info/25 bg-card p-3 shadow-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-foreground leading-snug">
                      {ls.title}
                    </h4>
                    <span className="shrink-0 rounded-full bg-success/15 border border-success/30 px-2 py-0.5 text-[9px] font-bold text-success uppercase">
                      Active
                    </span>
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {ls.summary}
                  </p>

                  <div className="pt-2 border-t border-border/60">
                    <LiveFeedBadge
                      sourceName={ls.source_name}
                      sourceUrl={ls.source_url}
                      isVerified={ls.is_verified}
                      fetchedAt={ls.fetched_at}
                    />
                  </div>

                  {ls.source_url && (
                    <div className="pt-1 flex gap-2">
                      <a
                        href={buildGoogleMapsUrl({ query: `${ls.title}, ${ls.area}` }) || ls.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-border bg-secondary/50 py-1.5 text-[10px] font-bold text-foreground hover:bg-secondary transition-colors"
                      >
                        <Navigation className="h-3 w-3 text-info" /> Directions
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Shelter list ── */}
        <div className="space-y-3 px-4 sm:px-6 py-4">
          <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
            <Home className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Regional Designated Centers ({shelters.length})</span>
          </div>
          {shelters.map((s) => {
            const pct    = Math.round((s.occupied / Math.max(1, s.capacity)) * 100);
            const isFull = s.status === 'full';
            const isWarn = !isFull && pct > 75;

            return (
              <div
                key={s.id}
                className={cn(
                  'rounded-2xl border bg-card p-4 transition-colors',
                  isFull
                    ? 'border-alert/25 bg-alert/[0.02]'
                    : isWarn
                    ? 'border-warning/25'
                    : 'border-border hover:border-border/80',
                )}
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold leading-tight break-words text-foreground">
                      {s.name}
                    </h3>
                    <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground leading-relaxed break-words">
                      <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/60" />
                      <span>{s.address}</span>
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase',
                      isFull
                        ? 'bg-alert/[12%] text-alert border border-alert/25'
                        : 'bg-success/[12%] text-success border border-success/25',
                    )}
                  >
                    {isFull ? 'Full' : 'Open'}
                  </span>
                </div>

                {/* Capacity bar */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <BedDouble className="h-3 w-3 text-muted-foreground" />
                      {s.occupied} / {s.capacity} beds
                    </span>
                    <span className={cn(
                      'font-bold',
                      isFull ? 'text-alert' : isWarn ? 'text-warning' : 'text-success',
                    )}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        isFull ? 'bg-alert' : isWarn ? 'bg-warning' : 'bg-success',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Amenity chips */}
                {s.amenities.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.amenities.map((a, i) => (
                      <span
                        key={i}
                        className="rounded-md border border-border bg-secondary/40
                          px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3.5 flex gap-2">
                  <button
                    onClick={() =>
                      onNavigate?.({
                        id: s.id,
                        name: s.name,
                        address: s.address,
                        coords: [s.coords.y, s.coords.x] as [number, number],
                        type: 'shelter',
                      })
                    }
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border',
                      'bg-secondary/40 py-2.5 text-xs font-bold',
                      'hover:bg-secondary transition-colors active:scale-[0.98]',
                    )}
                  >
                    <Navigation className="h-3.5 w-3.5 text-info" />
                    Get Directions
                  </button>

                  {(() => {
                    const url = buildGoogleMapsUrl({
                      coords: [s.coords.y, s.coords.x] as [number, number],
                      query:  `${s.name}, ${s.address}`,
                    });
                    return url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'flex items-center justify-center gap-1 rounded-xl border border-border',
                          'bg-secondary/40 px-3 py-2.5 text-xs font-bold',
                          'hover:bg-secondary transition-colors active:scale-[0.98]',
                        )}
                        title="Open in Google Maps"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        Maps ↗
                      </a>
                    ) : null;
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
