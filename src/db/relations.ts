import { relations } from 'drizzle-orm';
import {
  customers,
  messages,
  salesReps,
  boats,
  bookings,
} from './schema.js';



export const customersRelations = relations(customers, ({ many }) => ({
  messages: many(messages),
  bookings: many(bookings),
}));

export const salesRepsRelations = relations(salesReps, ({ many }) => ({
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

export const bookingsRelations = relations(bookings, ({ one }) => ({
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
