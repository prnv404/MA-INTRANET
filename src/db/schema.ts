import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
} from 'drizzle-orm/pg-core';

// ==========================================
// ENUMS
// ==========================================

export const channelEnum = pgEnum('channel_enum', [
  'whatsapp',
  'website',
  'instagram',
  'phone',
  'other',
]);

export const conversationStatusEnum = pgEnum('conversation_status_enum', [
  'active',
  'inactive',
  'booked',
  'lost',
  'archived',
]);

export const leadStageEnum = pgEnum('lead_stage_enum', [
  'new',
  'enquiry',
  'qualified',
  'recommendation',
  'quotation',
  'negotiation',
  'payment',
  'booked',
  'lost',
]);

export const leadStatusEnum = pgEnum('lead_status_enum', [
  'new',
  'interested',
  'inactive',
  'junk',
  'lost',
  'booked',
]);

export const senderTypeEnum = pgEnum('sender_type_enum', [
  'customer',
  'sales_rep',
  'bot',
  'system',
]);

export const whatsappContactTypeEnum = pgEnum('whatsapp_contact_type_enum', [
  'unknown',
  'customer',
  'boat_owner',
  'friend',
  'personal',
  'ignored',
]);

export const directionEnum = pgEnum('direction_enum', [
  'inbound',
  'outbound',
]);

export const messageTypeEnum = pgEnum('message_type_enum', [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'location',
  'reaction',
  'sticker',
  'other',
]);

export const eventTypeEnum = pgEnum('event_type_enum', [
  'lead_created',
  'message_received',
  'message_sent',
  'requirement_collected',
  'boat_recommended',
  'quote_sent',
  'customer_replied',
  'follow_up_sent',
  'payment_requested',
  'payment_received',
  'booking_confirmed',
  'booking_cancelled',
  'lead_lost',
  'lead_reactivated',
  'customer_objected',
  'negotiation_started',
]);

export const performedByTypeEnum = pgEnum('performed_by_type_enum', [
  'customer',
  'sales_rep',
  'system',
]);

export const bookingStatusEnum = pgEnum('booking_status_enum', [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
]);

export const paymentStatusEnum = pgEnum('payment_status_enum', [
  'pending',
  'partial',
  'paid',
  'refunded',
]);

export const boatStatusEnum = pgEnum('boat_status_enum', [
  'available',
  'unavailable',
  'maintenance',
  'inactive',
]);

// ==========================================
// TABLES
// ==========================================

// 1. WHATSAPP_CONTACTS
export const whatsappContacts = pgTable('whatsapp_contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  whatsappJid: text('whatsapp_jid').notNull().unique(),
  phoneNumber: text('phone_number'),
  displayName: text('display_name'),
  contactType: whatsappContactTypeEnum('contact_type').default('unknown'),
  crmEnabled: boolean('crm_enabled').default(false),
  aiEnabled: boolean('ai_enabled').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 2. CUSTOMERS
export const customers = pgTable('customers', {
  customerId: uuid('customer_id').defaultRandom().primaryKey(),
  whatsappContactId: uuid('whatsapp_contact_id').unique().references(() => whatsappContacts.id, { onDelete: 'set null' }),
  whatsappNumber: text('whatsapp_number').notNull().unique(),
  name: text('name'),
  email: text('email'),
  country: text('country'),
  state: text('state'),
  city: text('city'),
  firstContactAt: timestamp('first_contact_at').notNull(),
  lastContactAt: timestamp('last_contact_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 2. SALES_REPS
export const salesReps = pgTable('sales_reps', {
  salesRepId: uuid('sales_rep_id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  team: text('team'),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 3. BOATS
export const boats = pgTable('boats', {
  boatId: uuid('boat_id').defaultRandom().primaryKey(),
  boatName: text('boat_name').notNull(),
  boatType: text('boat_type').notNull(),
  bedrooms: integer('bedrooms').notNull(),
  capacity: integer('capacity').notNull(),
  operatorName: text('operator_name'),
  location: text('location'),
  basePrice: numeric('base_price'),
  status: boatStatusEnum('status').default('available'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 4. CONVERSATIONS
export const conversations = pgTable('conversations', {
  conversationId: uuid('conversation_id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.customerId, { onDelete: 'cascade' }),
  assignedSalesRepId: uuid('assigned_sales_rep_id').references(
    () => salesReps.salesRepId, { onDelete: 'set null' }
  ),
  channel: channelEnum('channel').default('whatsapp'),
  status: conversationStatusEnum('status').default('active'),
  leadStatus: leadStatusEnum('lead_status').default('new'),
  leadStage: leadStageEnum('lead_stage').default('new'),
  leadScore: integer('lead_score'),
  summary: text('summary'),
  source: text('source'),
  firstMessageAt: timestamp('first_message_at').notNull(),
  lastMessageAt: timestamp('last_message_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 5. MESSAGES
export const messages = pgTable('messages', {
  messageId: uuid('message_id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.conversationId, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.customerId, { onDelete: 'cascade' }),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(),
  senderType: senderTypeEnum('sender_type').notNull(),
  direction: directionEnum('direction').notNull(),
  messageType: messageTypeEnum('message_type').notNull(),
  messageText: text('message_text'),
  mediaUrl: text('media_url'),
  replyToMessageId: uuid('reply_to_message_id'),
  messageTimestamp: timestamp('message_timestamp').notNull(),
  rawPayload: jsonb('raw_payload'),
  aiProcessedAt: timestamp('ai_processed_at'),
  aiAnalysisId: uuid('ai_analysis_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 6. CONVERSATION_STATE
export const conversationState = pgTable('conversation_state', {
  conversationId: uuid('conversation_id')
    .primaryKey()
    .references(() => conversations.conversationId, { onDelete: 'cascade' }),
  travelDate: date('travel_date'),
  guestCount: integer('guest_count'),
  bedroomsRequired: integer('bedrooms_required'),
  boatType: text('boat_type'),
  budget: numeric('budget'),
  location: text('location'),
  foodPreference: text('food_preference'),
  preferredBoatId: uuid('preferred_boat_id').references(() => boats.boatId, { onDelete: 'set null' }),
  mainObjection: text('main_objection'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 7. CONVERSATION_EVENTS
export const conversationEvents = pgTable('conversation_events', {
  eventId: uuid('event_id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.conversationId, { onDelete: 'cascade' }),
  eventType: eventTypeEnum('event_type').notNull(),
  eventData: jsonb('event_data'),
  performedByType: performedByTypeEnum('performed_by_type').notNull(),
  performedById: uuid('performed_by_id'),
  eventTimestamp: timestamp('event_timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 8. BOOKINGS
export const bookings = pgTable('bookings', {
  bookingId: uuid('booking_id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(
    () => conversations.conversationId, { onDelete: 'cascade' }
  ),
  customerId: uuid('customer_id').references(() => customers.customerId, { onDelete: 'cascade' }),
  salesRepId: uuid('sales_rep_id').references(() => salesReps.salesRepId, { onDelete: 'set null' }),
  boatId: uuid('boat_id').references(() => boats.boatId, { onDelete: 'set null' }),
  travelDate: date('travel_date'),
  guestCount: integer('guest_count'),
  bedrooms: integer('bedrooms'),
  quotedPrice: numeric('quoted_price'),
  finalPrice: numeric('final_price'),
  discount: numeric('discount'),
  bookingStatus: bookingStatusEnum('booking_status').default('pending'),
  paymentStatus: paymentStatusEnum('payment_status').default('pending'),
  bookingCreatedAt: timestamp('booking_created_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 9. AI_ANALYSIS
export const aiAnalysis = pgTable('ai_analysis', {
  analysisId: uuid('analysis_id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.conversationId, { onDelete: 'cascade' }),
  triggerMessageId: uuid('trigger_message_id')
    .notNull()
    .references(() => messages.messageId, { onDelete: 'cascade' }),
  inputMessageIds: jsonb('input_message_ids').notNull(), // string[]
  intent: text('intent'),
  leadStatus: leadStatusEnum('lead_status'),
  leadStage: leadStageEnum('lead_stage'),
  leadScore: integer('lead_score'),
  stateUpdates: jsonb('state_updates'),
  events: jsonb('events'),
  summary: text('summary'),
  confidence: numeric('confidence'),
  model: text('model'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Infer TypeScript Types
// Infer TypeScript Types
export type WhatsAppContact = typeof whatsappContacts.$inferSelect;
export type NewWhatsAppContact = typeof whatsappContacts.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type MessageRecord = typeof messages.$inferSelect;
export type NewMessageRecord = typeof messages.$inferInsert;

export type ConversationStateRecord = typeof conversationState.$inferSelect;
export type NewConversationStateRecord = typeof conversationState.$inferInsert;

export type ConversationEventRecord = typeof conversationEvents.$inferSelect;
export type NewConversationEventRecord = typeof conversationEvents.$inferInsert;

export type SalesRep = typeof salesReps.$inferSelect;
export type NewSalesRep = typeof salesReps.$inferInsert;

export type Boat = typeof boats.$inferSelect;
export type NewBoat = typeof boats.$inferInsert;

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type AiAnalysisRecord = typeof aiAnalysis.$inferSelect;
export type NewAiAnalysisRecord = typeof aiAnalysis.$inferInsert;
