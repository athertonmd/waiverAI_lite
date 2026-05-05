/** Raw Lumo API waiver structure (from waivers/search response) */
export interface LumoWaiver {
  id: string;
  location: {
    airports: string[];
    countries: string[];
  };
  period: {
    start: string; // ISO date
    end: string;   // ISO date
  };
  alert: {
    summary: string;
    description: string;
  };
  date_restrictions?: string;
  waiver_codes?: string[];
  dom_intl?: string;
  remarks?: string;
}

/** Registry entry tracking a known Lumo waiver */
export interface WaiverRegistryEntry {
  contentHash: string;
  lastSeen: string; // ISO timestamp
  waiverHubRecordId?: string; // most recent WaiverHub record ID
}

/** The full registry stored in Settings table under key 'lumo_waiver_registry' */
export interface WaiverRegistry {
  [lumoWaiverId: string]: WaiverRegistryEntry;
}
