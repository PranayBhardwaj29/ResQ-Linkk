import { Map, ListChecks, Building2, Radio, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileTab = 'home' | 'map' | 'feed' | 'mesh' | 'shelters';

interface MobileNavProps {
  active: MobileTab;
  onChange: (t: MobileTab) => void;
}

const TABS: { id: MobileTab; label: string; icon: typeof Map }[] = [
  { id: 'home',     label: 'Home',     icon: Home },
  { id: 'map',      label: 'Map',      icon: Map },
  { id: 'feed',     label: 'Needs',    icon: ListChecks },
  { id: 'mesh',     label: 'Mesh',     icon: Radio },
  { id: 'shelters', label: 'Shelters', icon: Building2 },
];

export function MobileNav({ active, onChange }: MobileNavProps) {
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 lg:hidden',
        'border-t border-border/50 bg-background/80 backdrop-blur-2xl',
      )}
    >
      <div className="mx-auto flex max-w-md items-end justify-around px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        {TABS.map((tab) => {
          const Icon     = tab.icon;
          const isActive = active === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-1 min-h-[44px] justify-center',
                'transition-all duration-200 active:scale-95 focus:outline-none',
                isActive ? 'text-blue-400' : 'text-muted-foreground hover:text-foreground/80',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-12 items-center justify-center rounded-full transition-all duration-200',
                  isActive
                    ? 'bg-blue-500/15 border border-blue-500/25 shadow-sm'
                    : 'bg-transparent',
                )}
              >
                <Icon
                  className={cn(
                    'h-4.5 w-4.5 transition-colors duration-200',
                    isActive ? 'text-blue-400' : 'text-muted-foreground',
                  )}
                />
              </span>
              <span
                className={cn(
                  'text-[10px] tracking-tight transition-all duration-200',
                  isActive ? 'font-semibold text-foreground' : 'font-medium',
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
