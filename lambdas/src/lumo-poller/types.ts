/** Scope object defining geographic and flight-level applicability */
export interface LumoWaiverScope {
  global?: boolean;
  countries?: string[];
  airports?: string[];
  flights?: string[];
  routes?: string[];
  domestic?: boolean;
  international?: boolean;
  aircraft_type?: string;
  arrivals?: boolean;
  departures?: boolean;
  connections_only?: boolean;
}

/** Original ticket date constraints */
export interface LumoOriginalTicket {
  travel_from: string;  // ISO date YYYY-MM-DD
  travel_to: string;    // ISO date YYYY-MM-DD
  ticket_booked_on_before?: string; // ISO date YYYY-MM-DD
}

/** New ticket rebooking constraints */
export interface LumoNewTicket {
  reticketed_by?: string;           // ISO date YYYY-MM-DD
  new_travel_on_or_before?: string; // ISO date YYYY-MM-DD
  new_travel_within?: number;       // days
  comments?: string;
}

/** Waiver code entry */
export interface LumoWaiverCode {
  code: string;
  remarks?: string;
  input_field?: string;
}

/** Raw Lumo API waiver structure (from waivers/search response) */
export interface LumoWaiver {
  id: string;
  version?: number;
  title: string;
  source: string;          // Airline name, e.g. "American Airlines"
  description: string;
  last_updated: string;    // ISO timestamp
  ticket_stock?: string[]; // e.g. ["AA/001"]
  carriers?: string[];     // e.g. ["AA*BA", "??*AA"]
  scope: LumoWaiverScope;
  original_ticket: LumoOriginalTicket;
  new_ticket?: LumoNewTicket;
  waiver_codes?: LumoWaiverCode[];
  url?: string;
  snapshot_uuid?: string;
  instructions?: string;
  disclaimer?: string;
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
