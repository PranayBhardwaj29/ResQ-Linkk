export interface ReliefSourceConfig {
  id: string;
  name: string;
  url: string;
  area: string;
  category: 'alerts' | 'shelters' | 'general';
  isOfficial: boolean;
  goalType?: 'alerts' | 'shelters';
}

export const VERIFIED_DOMAINS: string[] = [
  'ndma.gov.in',
  'imd.gov.in',
  'mausam.imd.gov.in',
  'ddma.delhi.gov.in',
  'usdma.uk.gov.in',
  'uk.gov.in',
  'delhi.gov.in',
  'india-water.gov.in',
  'gov.in',
  'nic.in',
];

export const RELIEF_SOURCES: ReliefSourceConfig[] = [
  {
    id: 'ndma-official',
    name: 'National Disaster Management Authority (NDMA)',
    url: 'https://ndma.gov.in',
    area: 'National',
    category: 'alerts',
    isOfficial: true,
    goalType: 'alerts',
  },
  {
    id: 'imd-weather',
    name: 'India Meteorological Department (IMD)',
    url: 'https://mausam.imd.gov.in',
    area: 'National',
    category: 'alerts',
    isOfficial: true,
    goalType: 'alerts',
  },
  {
    id: 'ddma-delhi',
    name: 'Delhi Disaster Management Authority (DDMA)',
    url: 'https://ddma.delhi.gov.in/ddma/floods',
    area: 'Delhi NCR',
    category: 'alerts',
    isOfficial: true,
    goalType: 'alerts',
  },
  {
    id: 'ddma-shelters',
    name: 'Delhi Relief & Night Shelter Board (DUSIB)',
    url: 'https://delhishelterboard.in',
    area: 'Delhi NCR',
    category: 'shelters',
    isOfficial: true,
    goalType: 'shelters',
  },
  {
    id: 'usdma-uttarakhand',
    name: 'Uttarakhand State Disaster Management Authority',
    url: 'https://usdma.uk.gov.in',
    area: 'Badrinath / Uttarakhand',
    category: 'alerts',
    isOfficial: true,
    goalType: 'alerts',
  },
  {
    id: 'redcross-india',
    name: 'Indian Red Cross Society Disaster Relief',
    url: 'https://www.indianredcross.org',
    area: 'National',
    category: 'general',
    isOfficial: false,
    goalType: 'shelters',
  },
];

export function isDomainVerified(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    return VERIFIED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}
