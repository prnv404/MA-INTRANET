import { relations } from 'drizzle-orm';
import {
  customers,
  messages,
  salesReps,
  opportunities,
  boats,
  bookings,
} from './schema.js';



export const customersRelations = relations(customers, ({ many }) => ({
  messages: many(messages),
  opportunities: many(opportunities),
  bookings: many(bookings),
}));

export const salesRepsRelations = relations(salesReps, ({ many }) => ({
  opportunities: many(opportunities),
  bookings: many(bookings),
}));

export const boatsRelations = relations(boats, ({ many }) => ({
  bookings: many(bookings),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  customer: one(customers, {
    fields: [messages.customerId],
    references: [customers.customerId],
  }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one, many }) => ({
  customer: one(customers, {
    fields: [opportunities.customerId],
    references: [customers.customerId],
  }),
  salesRep: one(salesReps, {
    fields: [opportunities.salesRepId],
    references: [salesReps.salesRepId],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  opportunity: one(opportunities, {
    fields: [bookings.opportunityId],
    references: [opportunities.opportunityId],
  }),
  customer: one(customers, {
    fields: [bookings.customerId],
    references: [customers.customerId],
  }),
  salesRep: one(salesReps, {
    fields: [bookings.salesRepId],
    references: [salesReps.salesRepId],
  }),
  boat: one(boats, {
    fields: [bookings.boatId],
    references: [boats.boatId],
  }),
}));
