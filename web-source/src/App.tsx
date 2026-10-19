import { useState, useMemo, useEffect } from 'react';
import { TopNav } from '@/components/top-nav';
import { StatusBanner } from '@/components/status-banner';
import { MapView } from '@/components/map-view';
import type { MapRegion } from '@/components/map-view';
import { LiveFeed } from '@/components/live-feed';
import { SosDrawer } from '@/components/sos-drawer';
import { ShelterWidget } from '@/components/shelter-widget';
import { FindHelpPanel } from '@/components/find-help-panel';
import { OfferHelpPanel } from '@/components/offer-help-panel';
import { VolunteerRegistrationModal } from '@/components/volunteer-registration-modal';
import { hasVolunteerProfile } from '@/lib/volunteer-profile';
import { MobileNav } from '@/components/mobile-nav';
import type { MobileTab } from '@/components/mobile-nav';
import { HomeView } from '@/components/home-view';
import { useNetwork, useOfflineQueue } from '@/hooks/use-network';
import { useVolunteerOffers } from '@/hooks/use-volunteer-offers';
import { useTheme } from '@/hooks/use-theme';
import { REGION_DATA } from '@/mockData';
import type { RegionKey } from '@/mockData';
import { Navigation, Globe, RefreshCw } from 'lucide-react';
import type { FilterCategory, AidRequest, RequestCategory, RequestStatus } from '@/types';
import { cn } from '@/lib/utils';
import { fetchLiveReliefFeed, refreshLiveRelief, LiveReliefItem } from '@/lib/tinyfish';
import { LiveFeedBadge } from '@/components/LiveFeedBadge';
import { HelpBot } from '@/components/help-bot';
import { TriagePanel } from '@/components/triage-panel';
import { Toaster } from '@/components/ui/sonner';
import { MeshPanel } from '@/components/mesh-panel';
import { toast } from 'sonner';
import type { NavDestination } from '@/hooks/use-navigation';

import { useCrossDeviceSync } from '@/hooks/use-cross-device-sync';

// ── NGO / Rescue Management imports ──────────────────────────────────────────
import { NgoLoginModal }             from '@/components/ngo-login-modal';
import { NgoDashboard }              from '@/components/ngo-dashboard';
import { VolunteerRescueDashboard }  from '@/components/volunteer-rescue-dashboard';
import {
  getNgoSession,
  getVolunteerSession,
  clearNgoSession,
  clearVolunteerSession,
} from '@/lib/ngo-auth';
import type { NgoProfile, VolunteerMember } from '@/types';

function App() {
  const { status, toggle, isOnline } = useNetwork();
  const { queue, enqueue, clearQueue, removeFromQueue, queueCount } = useOfflineQueue(isOnline);
  const { offers, loading: offersLoading, error: offersError, createOffer } = useVolunteerOffers();
  const { theme, toggle: toggleTheme } = useTheme();

  const [filter, setFilter]         = useState<FilterCategory>('all');
  const [region, setRegion]         = useState<MapRegion>('ncr');
  const [sosOpen, setSosOpen]       = useState(false);
  const [shelterOpen, setShelterOpen]     = useState(false);
  const [findHelpOpen, setFindHelpOpen]   = useState(false);
  const [offerHelpOpen, setOfferHelpOpen] = useState(false);
  const [volunteerRegOpen, setVolunteerRegOpen] = useState(false);
  const [triageOpen, setTriageOpen]       = useState(false);
  const [meshOpen, setMeshOpen]           = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileTab, setMobileTab]   = useState<MobileTab>('home');
  const [navDest, setNavDest]       = useState<NavDestination | null>(null);

  const [meshState, setMeshState] = useState<{ connected: boolean; peersCount: number }>({
    connected: false,
    peersCount: 0,
  });

  // TinyFish mobile shelters state
  const [mobileLiveShelters, setMobileLiveShelters] = useState<LiveReliefItem[]>([]);
  const [mobileSheltersLoading, setMobileSheltersLoading] = useState(false);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail) return;
      const peers = Array.isArray(detail.peers) ? detail.peers : [];
      setMeshState({ connected: peers.length > 0, peersCount: peers.length });
    };
    try {
      // @ts-ignore
      const raw = window.ResQMeshNative?.getSnapshot();
      if (raw) {
        const parsed = JSON.parse(raw);
        const peers = Array.isArray(parsed.peers) ? parsed.peers : [];
        setMeshState({ connected: peers.length > 0, peersCount: peers.length });
      }
    } catch {}
    window.addEventListener('resqmesh-mesh-update', onUpdate);
    return () => window.removeEventListener('resqmesh-mesh-update', onUpdate);
  }, []);

  // ── NGO / Rescue Management state ─────────────────────────────────────────
  const [ngoLoginOpen,        setNgoLoginOpen]        = useState(false);
  const [ngoDashOpen,         setNgoDashOpen]         = useState(false);
  const [volunteerDashOpen,   setVolunteerDashOpen]   = useState(false);
  const [ngoSession,          setNgoSessionState]     = useState<Omit<NgoProfile, 'passwordHash'> | null>(
    () => getNgoSession()?.ngo ?? null
  );
  const [volunteerSession,    setVolunteerSessionState] = useState<{
    volunteer: VolunteerMember; ngoId: string; ngoName: string;
  } | null>(() => {
    const s = getVolunteerSession();
    return s ? { volunteer: s.volunteer, ngoId: s.ngoId, ngoName: s.ngoName } : null;
  });

  // Sync session state when localStorage changes (e.g. after login in modal)
  function refreshSessionState() {
    const ngo = getNgoSession();
    const vol = getVolunteerSession();
    setNgoSessionState(ngo?.ngo ?? null);
    setVolunteerSessionState(vol ? { volunteer: vol.volunteer, ngoId: vol.ngoId, ngoName: vol.ngoName } : null);
  }

  function handleNgoLoggedIn() {
    refreshSessionState();
    setNgoDashOpen(true);
    toast.success('NGO logged in', { description: 'Welcome to your NGO dashboard.' });
  }

  function handleVolunteerLoggedIn() {
    refreshSessionState();
    setVolunteerDashOpen(true);
    toast.success('Volunteer logged in', { description: 'View available rescue requests.' });
  }

  function handleNgoLogout() {
    clearNgoSession();
    refreshSessionState();
    toast('NGO session ended.');
  }

  function handleVolunteerLogout() {
    clearVolunteerSession();
    refreshSessionState();
    toast('Volunteer session ended.');
  }

  /** Open the right dashboard, or the login modal if not logged in */
  function openNgoOrLogin(defaultTab?: 'login' | 'register' | 'volunteer') {
    if (ngoSession) {
      setNgoDashOpen(true);
    } else if (volunteerSession) {
      setVolunteerDashOpen(true);
    } else {
      setNgoLoginOpen(true);
    }
  }

  // ── Shared Real-Time Cross-Device Sync State (Laptop + Mobile + Cloud) ────
  const {
    customRequests,
    resolvedRequestIds,
    helpingRequestIds,
    addCustomRequest,
    resolveRequest: handleResolveRequest,
    helpRequest: handleHelpRequest,
    cancelHelpRequest: handleCancelHelp,
    restoreRequests: handleRestoreRequests,
  } = useCrossDeviceSync();

  // ── All data is derived from the selected region ──────────────────────────
  const regionKey   = region === 'ncr' ? 'ncr' : 'badrinath';
  const regionData  = useMemo(() => REGION_DATA[regionKey], [regionKey]);

  // Combined requests: User SOS requests for this region appear first!
  const requests = useMemo(() => {
    const regionCustom = customRequests.filter((r) =>
      r.region ? r.region === regionKey : true
    );
    const combined = [...regionCustom, ...regionData.requests];
    return combined
      .filter((r) => !resolvedRequestIds.includes(r.id))
      .map((r) => ({
        ...r,
        status: (helpingRequestIds.includes(r.id) ? 'in-progress' : (r.status || 'active')) as RequestStatus,
      }));
  }, [customRequests, regionKey, regionData.requests, resolvedRequestIds, helpingRequestIds]);

  const shelters    = regionData.shelters;
  const volunteers  = regionData.volunteers;
  const resources   = regionData.resources;
  const locationLabel = regionData.locationLabel;

  useEffect(() => {
    let isMounted = true;
    fetchLiveReliefFeed(locationLabel, 'shelter').then((items) => {
      if (isMounted) setMobileLiveShelters(items.filter((i) => i.kind === 'shelter'));
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [locationLabel, region]);

  const handleRefreshMobileShelters = async () => {
    setMobileSheltersLoading(true);
    toast.info('Scanning live web relief camps via TinyFish…');
    try {
      const items = await refreshLiveRelief(locationLabel);
      setMobileLiveShelters(items.filter((i) => i.kind === 'shelter'));
      toast.success('TinyFish live shelter feed updated.');
    } catch {
      toast.error('TinyFish shelter scan failed; showing cached shelters.');
    } finally {
      setMobileSheltersLoading(false);
    }
  };

  const handleEnqueue = (req: Parameters<typeof enqueue>[0]) => {
    // 1. Add to offline outbox/sync queue
    enqueue(req);

    // 2. Parse coordinates:
    let coords = { x: 50, y: 50 };
    if (req.coords) {
      const parts = req.coords.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        // [lat, lng] -> store lat in y, lng in x
        coords = { y: parts[0], x: parts[1] };
      }
    } else {
      // Fallback default coordinates for the region
      coords = region === 'badrinath' ? { y: 30.5560, x: 79.5640 } : { y: 28.6139, x: 77.2090 };
    }

    // 3. Parse contact info:
    let contactName = '';
    let contactPhone = '';
    if (req.contact && req.contact.trim()) {
      const phoneMatch = req.contact.match(/(\+?\d[\d\s\-]{8,})/);
      if (phoneMatch) {
        contactPhone = phoneMatch[0].trim();
        const namePart = req.contact.replace(phoneMatch[0], '').trim();
        contactName = namePart || 'Emergency Requester';
      } else {
        contactName = req.contact.trim();
      }
    }
    if (!contactName) {
      contactName = req.triage ? 'AI Triage Request' : 'Emergency Requester';
    }

    // 4. Create active AidRequest
    const category: RequestCategory = (['medical', 'food', 'shelter', 'volunteers', 'rescue'].includes(req.category)
      ? req.category
      : 'rescue') as RequestCategory;

    const title = req.triage?.incidentType
      ? `SOS: ${req.triage.incidentType} Emergency`
      : req.details
      ? req.details.length > 48
        ? req.details.slice(0, 46) + '…'
        : req.details
      : 'Emergency SOS Aid Request';

    const newAidRequest: AidRequest = {
      id: req.id,
      category,
      priority: req.triage?.priority === 'LOW'
        ? 'moderate'
        : req.triage?.priority === 'MEDIUM'
        ? 'urgent'
        : 'critical',
      status: 'active',
      title,
      details: req.details || req.triage?.rawMessage || 'Urgent emergency assistance requested.',
      items: req.items
        ? req.items.split(',').map((s) => s.trim()).filter(Boolean)
        : req.triage?.requiredResources || ['Emergency Assistance', 'Rescue / Aid'],
      contactName,
      contactPhone,
      distanceMiles: 0.1,
      createdAt: req.createdAt || Date.now(),
      coords,
      peopleCount: req.triage?.people || 1,
      isUserCreated: true,
      region: (req.region as RegionKey) || regionKey,
      triage: req.triage,
    };

    addCustomRequest(newAidRequest);

    setSelectedId(newAidRequest.id);

    if (!isOnline) {
      toast.success('SOS Request Saved & Queued Offline', {
        description: 'Your request is visible in the feed and will sync when you reconnect.',
      });
    } else {
      toast.success('🚨 SOS Request Broadcast Live!', {
        description: `${newAidRequest.title} broadcast to all responders and synced across all devices.`,
      });
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id || null);
    if (id) setMobileTab('map');
  };

  const handleRegionChange = (r: MapRegion) => {
    setRegion(r);
    setSelectedId(null);
    setFilter('all');
    setNavDest(null);
  };

  const handleNavigate = (dest: NavDestination) => {
    setNavDest(dest);
    setMobileTab('map'); // switch to map tab on mobile
    setShelterOpen(false);
    setFindHelpOpen(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav
        status={status}
        onToggleNetwork={toggle}
        onSos={() => setSosOpen(true)}
        onShelter={() => setShelterOpen(true)}
        onFindHelp={() => setFindHelpOpen(true)}
        onOfferHelp={() => {
          // Returning volunteers skip registration and go straight to posting resources.
          if (hasVolunteerProfile()) setOfferHelpOpen(true);
          else setVolunteerRegOpen(true);
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
        onTriage={() => setTriageOpen(true)}
        onNgoPortal={() => openNgoOrLogin()}
        onMesh={() => setMeshOpen(true)}
        ngoLoggedIn={!!ngoSession}
        volunteerLoggedIn={!!volunteerSession}
        ngoName={ngoSession?.name ?? volunteerSession?.ngoName}
        onHome={() => setMobileTab('home')}
      />

      {mobileTab !== 'home' && (
        <StatusBanner
          activeFilter={filter}
          onFilterChange={setFilter}
          requestCount={requests.length}
          region={region}
          onRegionChange={handleRegionChange}
        />
      )}

      {/* Main content */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-3 sm:px-4 sm:py-4 lg:px-6">

        {mobileTab === 'home' && (
          <div className="h-[calc(100dvh-140px)] min-h-[520px] overflow-hidden rounded-2xl border border-border shadow-lg max-w-3xl mx-auto">
            <HomeView 
              requests={requests}
              region={region}
              meshConnected={meshState.connected}
              meshPeersCount={meshState.peersCount}
              isOnline={isOnline}
              onSos={() => setSosOpen(true)}
              onMesh={() => setMeshOpen(true)}
              onNavigateTab={setMobileTab}
            />
          </div>
        )}

        {/* Desktop: 2-column grid — map takes dominant space */}
        <div className={cn("hidden gap-4 lg:grid lg:grid-cols-[1.45fr_1fr]", mobileTab === 'home' ? 'lg:hidden' : '')}>
          {/* Map panel */}
          <div className="h-[calc(100vh-230px)] min-h-[520px] overflow-hidden rounded-2xl border border-border shadow-lg">
            <MapView
              requests={requests}
              shelters={shelters}
              volunteers={volunteers}
              isOnline={isOnline}
              selectedId={selectedId}
              onSelect={handleSelect}
              region={region}
              theme={theme}
              navDestination={navDest}
            />
          </div>

          {/* Response panel */}
          <div className="h-[calc(100vh-230px)] min-h-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
            <LiveFeed
              requests={requests}
              filter={filter}
              isOnline={isOnline}
              queue={queue}
              queueCount={queueCount}
              onClearQueue={clearQueue}
              onRemoveFromQueue={removeFromQueue}
              selectedId={selectedId}
              onSelect={handleSelect}
              locationLabel={locationLabel}
              onNavigate={handleNavigate}
              region={region}
              onResolveRequest={handleResolveRequest}
              onHelpRequest={handleHelpRequest}
              onCancelHelp={handleCancelHelp}
              onRestoreRequests={handleRestoreRequests}
            />
          </div>
        </div>

        {/* Mobile & Tablet: tabbed view */}
        <div className="lg:hidden">
          {mobileTab === 'map' && (
            <div className="h-[calc(100dvh-260px)] min-h-[360px] overflow-hidden rounded-2xl border border-border shadow-md">
              <MapView
                requests={requests}
                shelters={shelters}
                volunteers={volunteers}
                isOnline={isOnline}
                selectedId={selectedId}
                onSelect={handleSelect}
                region={region}
                theme={theme}
                navDestination={navDest}
              />
            </div>
          )}
          {mobileTab === 'feed' && (
            <div className="h-[calc(100dvh-260px)] min-h-[360px] overflow-hidden rounded-2xl border border-border bg-card shadow-md">
              <LiveFeed
                requests={requests}
                filter={filter}
                isOnline={isOnline}
                queue={queue}
                queueCount={queueCount}
                onClearQueue={clearQueue}
                onRemoveFromQueue={removeFromQueue}
                selectedId={selectedId}
                onSelect={handleSelect}
                locationLabel={locationLabel}
                onNavigate={handleNavigate}
                region={region}
                onResolveRequest={handleResolveRequest}
                onHelpRequest={handleHelpRequest}
                onCancelHelp={handleCancelHelp}
                onRestoreRequests={handleRestoreRequests}
              />
            </div>
          )}
          {mobileTab === 'shelters' && (
            <div className="space-y-3 pb-4 animate-slide-in-up">
              {/* Capacity summary card */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Regional Shelter Capacity</p>
                    <p className="mt-0.5 text-sm font-bold text-foreground">
                      {shelters.reduce((s, sh) => s + sh.occupied, 0)} occupied
                      <span className="text-muted-foreground font-normal"> / {shelters.reduce((s, sh) => s + sh.capacity, 0)} total</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-success">
                      {shelters.reduce((s, sh) => s + sh.capacity - sh.occupied, 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">beds free</p>
                  </div>
                </div>
                {/* Overall bar */}
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{
                      width: `${Math.round(
                        (shelters.reduce((s, sh) => s + sh.occupied, 0) /
                          Math.max(1, shelters.reduce((s, sh) => s + sh.capacity, 0))) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* TinyFish Live Web Shelters Section */}
              <div className="rounded-2xl border border-info/30 bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold text-info">
                      <Globe className="h-3.5 w-3.5" />
                      <span>Live Relief Camps & Shelters</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Scraped live from open web & official boards via TinyFish
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshMobileShelters}
                    disabled={mobileSheltersLoading}
                    className={cn(
                      'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-all',
                      mobileSheltersLoading
                        ? 'border-info/30 bg-info/10 text-info cursor-not-allowed'
                        : 'border-border bg-secondary/50 text-foreground hover:bg-secondary active:scale-95'
                    )}
                  >
                    <RefreshCw className={cn('h-3 w-3', mobileSheltersLoading ? 'animate-spin text-info' : 'text-muted-foreground')} />
                    <span>{mobileSheltersLoading ? 'Scanning...' : 'Refresh live data'}</span>
                  </button>
                </div>

                {mobileLiveShelters.length > 0 ? (
                  <div className="space-y-2">
                    {mobileLiveShelters.map((ls) => (
                      <div key={ls.id} className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-foreground leading-snug">{ls.title}</h4>
                          <span className="shrink-0 rounded-full bg-success/15 border border-success/30 px-2 py-0.5 text-[9px] font-bold text-success uppercase">
                            Active
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{ls.summary}</p>
                        <div className="pt-2 border-t border-border/50">
                          <LiveFeedBadge
                            sourceName={ls.source_name}
                            sourceUrl={ls.source_url}
                            isVerified={ls.is_verified}
                            fetchedAt={ls.fetched_at}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center py-2">
                    {mobileSheltersLoading ? 'Scanning live relief camps via TinyFish...' : 'Click "Refresh live data" to discover active web shelters.'}
                  </p>
                )}
              </div>

              {/* Shelter cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {shelters.map((s) => {
                  const pct    = Math.round((s.occupied / s.capacity) * 100);
                  const isFull = s.status === 'full';
                  const isWarn = !isFull && pct > 75;
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'rounded-2xl border bg-card p-4 transition-colors',
                        isFull ? 'border-alert/30' : isWarn ? 'border-warning/25' : 'border-border',
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold leading-tight break-words">{s.name}</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground break-words leading-relaxed">{s.address}</p>
                        </div>
                        <span className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                          isFull
                            ? 'bg-alert/[12%] text-alert border border-alert/25'
                            : 'bg-success/[12%] text-success border border-success/25',
                        )}>
                          {isFull ? 'Full' : 'Open'}
                        </span>
                      </div>

                      {/* Capacity */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-semibold text-foreground">{s.occupied}/{s.capacity} beds</span>
                          <span className={cn('font-bold', isFull ? 'text-alert' : isWarn ? 'text-warning' : 'text-success')}>
                            {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn('h-full rounded-full transition-all', isFull ? 'bg-alert' : isWarn ? 'bg-warning' : 'bg-success')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Directions button */}
                      <button
                        onClick={() => handleNavigate({
                          id: s.id,
                          name: s.name,
                          address: s.address,
                          coords: [s.coords.y, s.coords.x] as [number, number],
                          type: 'shelter',
                        })}
                        className={cn(
                          'mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5',
                          'border border-border bg-secondary/40 text-xs font-bold',
                          'hover:bg-secondary transition-colors active:scale-[0.98]',
                        )}
                      >
                        <Navigation className="h-3.5 w-3.5 text-info" />
                        Get Directions
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Drawers / Modals */}
      <SosDrawer
        open={sosOpen}
        onOpenChange={setSosOpen}
        isOnline={isOnline}
        onEnqueue={handleEnqueue}
        region={region}
        locationLabel={locationLabel}
      />
      <TriagePanel
        open={triageOpen}
        onOpenChange={setTriageOpen}
        region={regionKey}
        locationLabel={locationLabel}
        resources={resources}
        isOnline={isOnline}
        onEnqueue={handleEnqueue}
        onNavigate={handleNavigate}
      />
      <ShelterWidget
        shelters={shelters}
        open={shelterOpen}
        onOpenChange={setShelterOpen}
        locationLabel={locationLabel}
        onNavigate={handleNavigate}
      />
      <FindHelpPanel
        open={findHelpOpen}
        onOpenChange={setFindHelpOpen}
        resources={resources}
        locationLabel={locationLabel}
        onNavigate={handleNavigate}
      />
      <VolunteerRegistrationModal
        open={volunteerRegOpen}
        onOpenChange={setVolunteerRegOpen}
        onComplete={() => {
          // Registration finished — preserve the existing resource-posting flow.
          toast.success('Volunteer registered', {
            description: 'You can now post the resources you can share nearby.',
          });
          setOfferHelpOpen(true);
        }}
      />
      <OfferHelpPanel
        open={offerHelpOpen}
        onOpenChange={setOfferHelpOpen}
        offers={offers}
        loading={offersLoading}
        error={offersError}
        onCreate={async (input) => {
          await createOffer(input);
          toast.success('Help offer posted', {
            description: 'People nearby can now see what you have available.',
          });
        }}
      />

      <MobileNav
        active={mobileTab}
        onChange={(tab) => {
          if (tab === 'mesh') {
            setMeshOpen(true);
          } else {
            setMobileTab(tab);
          }
        }}
      />

      {/* Help Bot — floats over everything, region-aware */}
      <HelpBot
        region={region}
        locationLabel={locationLabel}
        shelters={shelters}
        resources={resources}
        requests={requests}
        isOnline={isOnline}
      />

      <div className="h-20 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden" />
      {/* ── NGO / Rescue Management ───────────────────────────────────────── */}
      <NgoLoginModal
        open={ngoLoginOpen}
        onOpenChange={setNgoLoginOpen}
        onNgoLoggedIn={handleNgoLoggedIn}
        onVolunteerLoggedIn={handleVolunteerLoggedIn}
      />

      {ngoSession && (
        <NgoDashboard
          open={ngoDashOpen}
          onOpenChange={setNgoDashOpen}
          ngo={ngoSession}
          onLogout={handleNgoLogout}
        />
      )}

      {volunteerSession && (
        <VolunteerRescueDashboard
          open={volunteerDashOpen}
          onOpenChange={setVolunteerDashOpen}
          volunteer={volunteerSession.volunteer}
          ngoId={volunteerSession.ngoId}
          ngoName={volunteerSession.ngoName}
          onLogout={handleVolunteerLogout}
        />
      )}

      <MeshPanel open={meshOpen} onOpenChange={setMeshOpen} />
      <Toaster />
    </div>
  );
}

export default App;
