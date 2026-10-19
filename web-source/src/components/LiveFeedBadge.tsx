import React from 'react';
import { ExternalLink, ShieldCheck, ShieldAlert, Clock, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/hooks/use-network';

interface LiveFeedBadgeProps {
  sourceName: string;
  sourceUrl: string;
  isVerified: boolean;
  fetchedAt: string;
  className?: string;
  compact?: boolean;
}

export function LiveFeedBadge({
  sourceName,
  sourceUrl,
  isVerified,
  fetchedAt,
  className,
  compact = false,
}: LiveFeedBadgeProps) {
  const timeString = (() => {
    try {
      const ms = new Date(fetchedAt).getTime();
      if (!isNaN(ms)) return timeAgo(ms);
    } catch {}
    return 'recently';
  })();

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 text-[10px]', className)}>
      {/* TinyFish Brand Pill */}
      <span
        className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-400 border border-blue-500/20"
        title="Discovered and scraped in real time using TinyFish AI agent & search"
      >
        <span>Live Web · TinyFish</span>
      </span>

      {/* Verification Badge */}
      {isVerified ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-400 border border-emerald-500/20"
          title="Verified source: Official government / disaster management domain"
        >
          <ShieldCheck className="h-3 w-3" />
          <span>Official Source</span>
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400 border border-amber-500/20"
          title="Unverified source: Open public web / NGO alert"
        >
          <ShieldAlert className="h-3 w-3" />
          <span>Public Web</span>
        </span>
      )}

      {/* Source Link */}
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline font-medium"
          title={`Open source: ${sourceUrl}`}
        >
          <Globe className="h-2.5 w-2.5" />
          <span className="truncate max-w-[130px]">{sourceName || 'Source'}</span>
          <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-70" />
        </a>
      )}

      {/* Time Ago */}
      <span className="inline-flex items-center gap-0.5 text-muted-foreground ml-auto">
        <Clock className="h-2.5 w-2.5 opacity-70" />
        <span>fetched {timeString}</span>
      </span>
    </div>
  );
}
