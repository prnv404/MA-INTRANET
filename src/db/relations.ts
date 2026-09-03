import { relations } from 'drizzle-orm';
import {
  customers,
  messages,
  salesReps,
  boats,
  bookings,
  whatsappContacts,
} from './schema.js';

export const whatsappContactsRelations = relations(whatsappContacts, ({ one }) => ({
  customer: one(customers, {
    fields: [whatsappContacts.id],
    references: [customers.whatsappContactId],
  }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  whatsappContact: one(whatsappContacts, {
    fields: [customers.whatsappContactId],
    references: [whatsappContacts.id],
  }),
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
