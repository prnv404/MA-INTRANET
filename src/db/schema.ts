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

export const opportunityStageEnum = pgEnum('opportunity_stage_enum', [
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

export const opportunityStatusEnum = pgEnum('opportunity_status_enum', [
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

export const boatCategoryEnum = pgEnum('boat_category_enum', [
  'deluxe',
  'premium',
  'luxury',
]);

// ==========================================
// TABLES
// ==========================================

// 1. CUSTOMERS (Unified Contacts Table)
export const customers = pgTable('customers', {
  customerId: uuid('customer_id').defaultRandom().primaryKey(),
  whatsappJid: text('whatsapp_jid').notNull().unique(),
  whatsappNumber: text('whatsapp_number').notNull().unique(),
  contactType: whatsappContactTypeEnum('contact_type').default('unknown'),
  crmEnabled: boolean('crm_enabled').default(false),
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

// 2.5. OPPORTUNITIES
export const opportunities = pgTable('opportunities', {
  opportunityId: uuid('opportunity_id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.customerId, { onDelete: 'cascade' }),
  salesRepId: uuid('sales_rep_id').references(() => salesReps.salesRepId, { onDelete: 'set null' }),
  
  // Pipeline details
  stage: opportunityStageEnum('stage').default('new'),
  status: opportunityStatusEnum('status').default('interested'), 
  
  // High-level requirements
  expectedDates: text('expected_dates'),
  notes: text('notes'),
  
  // BI & Analytics Fields
  sourceChannel: channelEnum('source_channel').default('whatsapp'), // Where the lead came from
  expectedValue: numeric('expected_value'), // Potential deal value for pipeline forecasting
  probability: integer('probability'), // 0-100% chance to close
  lostReason: text('lost_reason'), // Why the deal was lost (if applicable)
  closedAt: timestamp('closed_at'), // When it was won or lost
  nextActionDate: timestamp('next_action_date'), // Reminder for follow-up
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 3. BOATS
export const boats = pgTable('boats', {
  boatId: uuid('boat_id').defaultRandom().primaryKey(),
  boatName: text('boat_name').notNull(),
  boatCategory: boatCategoryEnum('boat_category').default('deluxe'),
  bedrooms: integer('bedrooms').notNull(),
  capacity: integer('capacity').notNull(),
  operatorName: text('operator_name'),
  location: text('location'),
  basePrice: numeric('base_price'),
  photos: jsonb('photos').default([]),
  status: boatStatusEnum('status').default('available'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 4. MESSAGES
export const messages = pgTable('messages', {
  messageId: uuid('message_id').defaultRandom().primaryKey(),
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
  createdAt: timestamp('created_at').defaultNow(),
});

// 5. BOOKINGS
export const bookings = pgTable('bookings', {
  bookingId: uuid('booking_id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id').references(() => opportunities.opportunityId, { onDelete: 'set null' }),
  customerId: uuid('customer_id').references(() => customers.customerId, { onDelete: 'cascade' }),
  salesRepId: uuid('sales_rep_id').references(() => salesReps.salesRepId, { onDelete: 'set null' }),
  boatId: uuid('boat_id').references(() => boats.boatId, { onDelete: 'set null' }),
  
  // Dates & Timing
  checkInDate: date('check_in_date'),
  checkOutDate: date('check_out_date'),
  checkInTime: text('check_in_time'),
  checkOutTime: text('check_out_time'),
  
  // Pax & Logistics
  guestCount: integer('guest_count'),
  adultsCount: integer('adults_count'),
  childrenCount: integer('children_count'),
  vegMeals: integer('veg_meals'),
  nonVegMeals: integer('non_veg_meals'),
  boardingPoint: text('boarding_point'),
  droppingPoint: text('dropping_point'),
  
  // Boat Requirements
  boatCategory: boatCategoryEnum('boat_category'),
  bedrooms: integer('bedrooms'),
  
  // Pricing & Payment
  boatPrice: numeric('boat_price'),
  extraCharges: numeric('extra_charges'),
  totalPrice: numeric('total_price'),
  discount: numeric('discount'),
  advancePaid: numeric('advance_paid'),
  balanceAmount: numeric('balance_amount'),
  
  // Statuses & Notes
  bookingStatus: bookingStatusEnum('booking_status').default('pending'),
  paymentStatus: paymentStatusEnum('payment_status').default('pending'),
  specialRequests: text('special_requests'),
  notes: text('notes'),
  
  bookingCreatedAt: timestamp('booking_created_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Infer TypeScript Types
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type MessageRecord = typeof messages.$inferSelect;
export type NewMessageRecord = typeof messages.$inferInsert;

export type SalesRep = typeof salesReps.$inferSelect;
export type NewSalesRep = typeof salesReps.$inferInsert;

export type Boat = typeof boats.$inferSelect;
export type NewBoat = typeof boats.$inferInsert;

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
