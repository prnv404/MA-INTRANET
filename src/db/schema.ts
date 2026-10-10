// Row types mirroring the Supabase database (schema is managed in the Supabase dashboard).
// Columns are snake_case, exactly as returned by the Supabase Data API.
// Timestamps/dates arrive as ISO strings; numeric columns arrive as strings or numbers.

export type Channel = 'whatsapp' | 'website' | 'instagram' | 'phone' | 'other';
export type LeadStage =
  | 'new'
  | 'enquiry'
  | 'qualified'
  | 'recommendation'
  | 'quotation'
  | 'negotiation'
  | 'payment'
  | 'booked'
  | 'lost';
export type LeadStatus = 'new' | 'interested' | 'inactive' | 'junk' | 'lost' | 'booked';
export type SenderType = 'customer' | 'sales_rep' | 'bot' | 'system';
export type WhatsappContactType = 'unknown' | 'customer' | 'boat_owner' | 'friend' | 'personal' | 'ignored';
export type Direction = 'inbound' | 'outbound';
export type DbMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'reaction'
  | 'sticker'
  | 'other';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'refunded';
export type BoatStatus = 'available' | 'unavailable' | 'maintenance' | 'inactive';
export type BoatCategory = 'deluxe' | 'premium' | 'luxury';
export type CruiseType = 'day_cruise' | 'overnight' | 'multi_night';
export type AiStatus = 'active' | 'completed' | 'paused';

type Numeric = string | number;

// 1. CUSTOMERS (Unified Contacts Table)
export interface Customer {
  customer_id: string;
  whatsapp_jid: string;
  whatsapp_number: string;
  contact_type: WhatsappContactType | null;
  crm_enabled: boolean | null;
  name: string | null;
  email: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  first_contact_at: string;
  last_contact_at: string;
  created_at: string;
  updated_at: string;
}

// 2. SALES_REPS
export interface SalesRep {
  sales_rep_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  team: string | null;
  active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

// 2.5. LEADS (one row per trip enquiry)
export interface Lead {
  lead_id: string;
  customer_id: string;
  sales_rep_id: string | null;
  stage: LeadStage | null;
  status: LeadStatus | null;
  travel_date_text: string | null;
  notes: string | null;
  source_channel: Channel | null;
  expected_value: Numeric | null;
  probability: number | null;
  lost_reason: string | null;
  closed_at: string | null;
  next_action_date: string | null;
  guests: number | null;
  // Trip details extracted by the AI layer
  travel_date: string | null;
  bedrooms: number | null;
  cruise_type: CruiseType | null;
  boat_category: BoatCategory | null;
  // AI layer control: completed/paused leads are never touched by the AI
  ai_status: AiStatus;
  ai_last_run_at: string | null;
  ai_extracted: unknown;
  created_at: string | null;
  updated_at: string | null;
}

// 3. BOATS
export interface Boat {
  boat_id: string;
  boat_name: string;
  boat_category: BoatCategory | null;
  bedrooms: number;
  capacity: number;
  operator_name: string | null;
  location: string | null;
  base_price: Numeric | null;
  status: BoatStatus | null;
  created_at: string | null;
  updated_at: string | null;
}

// 4. MESSAGES
export interface MessageRecord {
  message_id: string;
  customer_id: string;
  whatsapp_message_id: string;
  sender_type: SenderType;
  direction: Direction;
  message_type: DbMessageType;
  message_text: string | null;
  media_url: string | null;
  reply_to_message_id: string | null;
  message_timestamp: string;
  raw_payload: unknown;
  created_at: string | null;
}

// 5. BOOKINGS
export interface Booking {
  booking_id: string;
  lead_id: string | null;
  customer_id: string | null;
  sales_rep_id: string | null;
  boat_id: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  guest_count: number | null;
  adults_count: number | null;
  children_count: number | null;
  veg_meals: number | null;
  non_veg_meals: number | null;
  boarding_point: string | null;
  dropping_point: string | null;
  boat_category: BoatCategory | null;
  bedrooms: number | null;
  boat_price: Numeric | null;
  extra_charges: Numeric | null;
  total_price: Numeric | null;
  discount: Numeric | null;
  advance_paid: Numeric | null;
  balance_amount: Numeric | null;
  booking_status: BookingStatus | null;
  payment_status: PaymentStatus | null;
  special_requests: string | null;
  notes: string | null;
  booking_created_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Insert types: generated/defaulted columns become optional
type Insert<T, Required extends keyof T> = Pick<T, Required> & Partial<Omit<T, Required>>;

export type NewCustomer = Insert<Customer, 'whatsapp_jid' | 'whatsapp_number' | 'first_contact_at' | 'last_contact_at'>;
export type NewSalesRep = Insert<SalesRep, 'name'>;
export type NewLead = Insert<Lead, 'customer_id'>;
export type NewBoat = Insert<Boat, 'boat_name' | 'bedrooms' | 'capacity'>;
export type NewMessageRecord = Insert<
  MessageRecord,
  'customer_id' | 'whatsapp_message_id' | 'sender_type' | 'direction' | 'message_type' | 'message_timestamp'
>;
export type NewBooking = Partial<Booking>;

// ==========================================
// MARKET (WhatsApp B2B groups → live boat availability board)
// ==========================================
export type MarketTripType = 'day_cruise' | 'overnight' | 'day_or_overnight' | 'sharing' | 'unknown';
export type MarketListingStatus = 'active' | 'superseded' | 'sold' | 'removed';
export type MarketRequestStatus = 'open' | 'closed';

export interface MarketGroup {
  group_jid: string;
  name: string | null;
  enabled: boolean;
  created_at: string;
}

export interface MarketOperator {
  operator_id: string;
  name: string | null;
  phones: string[];
  boat_names: string[];
  sender_jids: string[];
  created_at: string;
  updated_at: string;
}

export interface GroupMessage {
  group_message_id: string;
  whatsapp_message_id: string;
  group_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  message_text: string | null;
  text_hash: string | null;
  message_timestamp: string;
  kind: string | null;
  parse_status: 'pending' | 'parsed' | 'skipped' | 'failed';
  parsed: unknown;
  operator_id: string | null;
  created_at: string;
}

export interface MarketListing {
  listing_id: string;
  operator_id: string;
  available_date: string;
  bedrooms: number;
  boat_count: number;
  trip_type: MarketTripType;
  category: BoatCategory | null;
  upper_deck: boolean | null;
  ac: boolean | null;
  glass_covered: boolean | null;
  capacity_pax: number | null;
  available_from: string | null;
  boat_name: string | null;
  contact_phone: string | null;
  source_message_id: string | null;
  group_jids: string[];
  first_seen_at: string;
  last_seen_at: string;
  repost_count: number;
  expires_at: string;
  status: MarketListingStatus;
  created_at: string;
  updated_at: string;
}

export interface MarketRequest {
  request_id: string;
  operator_id: string | null;
  needed_date: string | null;
  date_text: string | null;
  pax: number | null;
  bedrooms: number | null;
  trip_type: MarketTripType;
  category: BoatCategory | null;
  party_type: string | null;
  notes: string | null;
  contact_phone: string | null;
  source_message_id: string | null;
  group_jids: string[];
  first_seen_at: string;
  last_seen_at: string;
  repost_count: number;
  expires_at: string;
  status: MarketRequestStatus;
  created_at: string;
  updated_at: string;
}
