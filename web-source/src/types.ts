export type RequestCategory =
  | 'medical'
  | 'food'
  | 'shelter'
  | 'volunteers'
  | 'rescue';

export type RequestPriority = 'critical' | 'urgent' | 'moderate';

export type RequestStatus = 'active' | 'in-progress' | 'fulfilled' | 'queued';

export interface AidRequest {
  id: string;
  category: RequestCategory;
  priority: RequestPriority;
  status: RequestStatus;
  title: string;
  details: string;
  items: string[];
  contactName: string;
  contactPhone: string;
  distanceMiles: number;
  createdAt: number;
  coords: { x: number; y: number };
  peopleCount: number;
  isUserCreated?: boolean;
  region?: string;
  triage?: {
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    incidentType: string;
    people: number | null;
    vulnerable?: { elderly: number; children: number; pregnant: number; disabled: number; injured: number };
    dangerIndicators?: string[];
    priorityReasons?: string[];
    requiredResources?: string[];
    rawMessage?: string;
    parsedBy?: 'gemini' | 'fallback';
  };
}

export interface Shelter {
  id: string;
  name: string;
  address: string;
  capacity: number;
  occupied: number;
  coords: { x: number; y: number };
  amenities: string[];
  status: 'open' | 'full' | 'closing';
}

export interface Volunteer {
  id: string;
  name: string;
  skills: string[];
  coords: { x: number; y: number };
  distanceMiles: number;
  available: boolean;
}

export type ResourceType = 'hospital' | 'pharmacy' | 'food' | 'shelter' | 'rescue';

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  address: string;
  distanceMiles: number;
  coords: { x: number; y: number };
  open24h: boolean;
  phone: string;
  tags: string[];
  status: 'open' | 'limited' | 'closed';
  bedsAvailable?: number;
}

export type VolunteerOfferCategory = 'medical' | 'food' | 'water' | 'shelter' | 'transport' | 'rescue' | 'other';

export type VolunteerGender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export type VolunteerStatus = 'registered' | 'available' | 'on-duty' | 'unavailable';

export interface VolunteerRegistration {
  id: string;
  fullName: string;
  gender: VolunteerGender;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  locationPermission: boolean;
  status: VolunteerStatus;
  createdAt: number;
}

export interface VolunteerRegistrationInput {
  fullName: string;
  gender: VolunteerGender;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  locationPermission: boolean;
}

export interface VolunteerOffer {
  id: string;
  category: VolunteerOfferCategory;
  title: string;
  details: string;
  quantity: string;
  contactName: string;
  contactPhone: string;
  location: string;
  photoPath: string | null;
  photoUrl: string | null;
  status: 'available' | 'limited' | 'fulfilled';
  createdAt: number;
}

export type FilterCategory = 'all' | RequestCategory;

export const CATEGORY_META: Record<
  RequestCategory,
  { label: string; icon: string; color: string; bg: string; text: string; border: string }
> = {
  medical: {
    label: 'Medical Aid',
    icon: 'HeartPulse',
    color: 'alert',
    bg: 'bg-alert/15',
    text: 'text-alert',
    border: 'border-alert/30',
  },
  food: {
    label: 'Food & Water',
    icon: 'Droplets',
    color: 'warning',
    bg: 'bg-warning/15',
    text: 'text-warning',
    border: 'border-warning/30',
  },
  shelter: {
    label: 'Shelter Beds',
    icon: 'BedDouble',
    color: 'info',
    bg: 'bg-info/15',
    text: 'text-info',
    border: 'border-info/30',
  },
  volunteers: {
    label: 'Volunteers Needed',
    icon: 'Users',
    color: 'success',
    bg: 'bg-success/15',
    text: 'text-success',
    border: 'border-success/30',
  },
  rescue: {
    label: 'Rescue',
    icon: 'LifeBuoy',
    color: 'alert',
    bg: 'bg-alert/15',
    text: 'text-alert',
    border: 'border-alert/30',
  },
};

export const PRIORITY_META: Record<
  RequestPriority,
  { label: string; color: string; bg: string; text: string }
> = {
  critical: { label: 'Critical', color: 'alert', bg: 'bg-alert', text: 'text-white' },
  urgent: { label: 'Urgent', color: 'warning', bg: 'bg-warning', text: 'text-white' },
  moderate: { label: 'Moderate', color: 'success', bg: 'bg-success', text: 'text-white' },
};

export const FILTER_TABS: { id: FilterCategory; label: string }[] = [
  { id: 'all', label: 'All Requests' },
  { id: 'medical', label: 'Medical Aid' },
  { id: 'food', label: 'Food & Water' },
  { id: 'shelter', label: 'Shelter Beds' },
  { id: 'volunteers', label: 'Volunteers Needed' },
];

// ─────────────────────────────────────────────────────────────────────────────
// NGO MANAGEMENT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/** Status of a rescue task in the lifecycle */
export type RescueTaskStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'AWAITING_CONFIRMATION'
  | 'RESCUED'
  | 'CANCELLED';

/** Availability status of a volunteer member */
export type VolunteerMemberStatus = 'AVAILABLE' | 'ON_MISSION' | 'OFFLINE';

/** Verification status of an NGO */
export type NgoVerificationStatus = 'PENDING' | 'VERIFIED' | 'SUSPENDED';

/** An NGO (Non-Governmental Organization) registered in ResQLink */
export interface NgoProfile {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  serviceArea: string;
  description: string;
  verificationStatus: NgoVerificationStatus;
  passwordHash: string; // simple bcrypt-free hash for local demo
  createdAt: number;
}

/** Input type for NGO registration */
export interface NgoRegistrationInput {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  serviceArea: string;
  description: string;
  password: string;
}

/** A volunteer who belongs to an NGO */
export interface VolunteerMember {
  id: string;
  ngoId: string;
  fullName: string;
  phone: string;
  email: string;
  skills: string[];
  status: VolunteerMemberStatus;
  currentTaskId: string | null;
  joinedAt: number;
}

/** Input type for adding a volunteer to an NGO */
export interface VolunteerMemberInput {
  ngoId: string;
  fullName: string;
  phone: string;
  email: string;
  skills: string[];
}

/** A rescue task linking an AidRequest to an NGO volunteer assignment */
export interface RescueTask {
  id: string;
  /** The original AidRequest this task was created from */
  requestId: string;
  /** Snapshot of request details for display */
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  location: string;
  coords: { x: number; y: number };
  peopleCount: number;
  contactName: string;
  contactPhone: string;
  region: string;
  /** Assignment & lifecycle */
  status: RescueTaskStatus;
  assignedNgoId: string | null;
  assignedNgoName: string | null;
  assignedVolunteerId: string | null;
  assignedVolunteerName: string | null;
  /** Timestamps */
  createdAt: number;
  assignedAt: number | null;
  startedAt: number | null;
  completionRequestedAt: number | null;
  confirmedAt: number | null;
  completedAt: number | null;
  /** Confirmation metadata */
  confirmedByNgoId: string | null;
  confirmedByName: string | null;
  /** Cancellation */
  cancelledAt: number | null;
  cancelReason: string | null;
}

/** Input for creating a rescue task from an AidRequest */
export interface RescueTaskCreateInput {
  requestId: string;
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  location: string;
  coords: { x: number; y: number };
  peopleCount: number;
  contactName: string;
  contactPhone: string;
  region: string;
}

/** Response from the atomic task assignment endpoint */
export interface TaskAssignmentResponse {
  ok: boolean;
  task?: RescueTask;
  error?: string;
  alreadyAssigned?: boolean;
}

/** The NGO data store persisted on server */
export interface NgoStore {
  ngos: NgoProfile[];
  volunteers: VolunteerMember[];
  tasks: RescueTask[];
  version: number;
}

/** Stats computed for the NGO dashboard overview */
export interface NgoDashboardStats {
  totalVolunteers: number;
  availableVolunteers: number;
  onMissionVolunteers: number;
  offlineVolunteers: number;
  activeRescues: number;
  completedRescues: number;
  awaitingConfirmation: number;
}

export const RESCUE_TASK_STATUS_META: Record<
  RescueTaskStatus,
  { label: string; color: string; bg: string; text: string; emoji: string }
> = {
  AVAILABLE:             { label: 'Available',              color: 'success',  bg: 'bg-success/15',  text: 'text-success',  emoji: '🟢' },
  ASSIGNED:              { label: 'Assigned',               color: 'info',     bg: 'bg-info/15',     text: 'text-info',     emoji: '🔵' },
  IN_PROGRESS:           { label: 'In Progress',            color: 'warning',  bg: 'bg-warning/15',  text: 'text-warning',  emoji: '🟠' },
  AWAITING_CONFIRMATION: { label: 'Awaiting Confirmation',  color: 'warning',  bg: 'bg-yellow-500/15', text: 'text-yellow-600 dark:text-yellow-400', emoji: '🟡' },
  RESCUED:               { label: 'Rescued',                color: 'success',  bg: 'bg-success/15',  text: 'text-success',  emoji: '✅' },
  CANCELLED:             { label: 'Cancelled',              color: 'alert',    bg: 'bg-alert/15',    text: 'text-alert',    emoji: '🔴' },
};

export const VOLUNTEER_MEMBER_STATUS_META: Record<
  VolunteerMemberStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  AVAILABLE:   { label: 'Available',   bg: 'bg-success/15',  text: 'text-success',  dot: 'bg-success' },
  ON_MISSION:  { label: 'On Mission',  bg: 'bg-warning/15',  text: 'text-warning',  dot: 'bg-warning' },
  OFFLINE:     { label: 'Offline',     bg: 'bg-muted/50',    text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};
