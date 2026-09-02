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

export const senderTypeEnum = pgEnum('sender_type_enum', [
  'customer',
  'sales_rep',
  'bot',
  'system',
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

// 1. CUSTOMERS
export const customers = pgTable('customers', {
  customerId: uuid('customer_id').defaultRandom().primaryKey(),
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
    .references(() => customers.customerId),
  assignedSalesRepId: uuid('assigned_sales_rep_id').references(
    () => salesReps.salesRepId
  ),
  channel: channelEnum('channel').default('whatsapp'),
  status: conversationStatusEnum('status').default('active'),
  leadStage: leadStageEnum('lead_stage').default('new'),
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
    .references(() => conversations.conversationId),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.customerId),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(),
  senderType: senderTypeEnum('sender_type').notNull(),
  direction: directionEnum('direction').notNull(),
  messageType: messageTypeEnum('message_type').notNull(),
  messageText: text('message_text'),
  mediaUrl: text('media_url'),
  replyToMessageId: uuid('reply_to_message_id'),
  messageTimestamp: timestamp('message_timestamp').notNull(),
  rawPayload: jsonb('raw_payload'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 6. CONVERSATION_STATE
export const conversationState = pgTable('conversation_state', {
  conversationId: uuid('conversation_id')
    .primaryKey()
    .references(() => conversations.conversationId),
  travelDate: date('travel_date'),
  guestCount: integer('guest_count'),
  bedroomsRequired: integer('bedrooms_required'),
  boatType: text('boat_type'),
  budget: numeric('budget'),
  location: text('location'),
  foodPreference: text('food_preference'),
  preferredBoatId: uuid('preferred_boat_id').references(() => boats.boatId),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 7. CONVERSATION_EVENTS
export const conversationEvents = pgTable('conversation_events', {
  eventId: uuid('event_id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.conversationId),
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
    () => conversations.conversationId
  ),
  customerId: uuid('customer_id').references(() => customers.customerId),
  salesRepId: uuid('sales_rep_id').references(() => salesReps.salesRepId),
  boatId: uuid('boat_id').references(() => boats.boatId),
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

// Infer TypeScript Types
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
