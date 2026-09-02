import { relations } from 'drizzle-orm';
import {
  customers,
  conversations,
  messages,
  conversationState,
  conversationEvents,
  salesReps,
  boats,
  bookings,
  aiAnalysis,
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
  conversations: many(conversations),
  messages: many(messages),
  bookings: many(bookings),
}));

export const salesRepsRelations = relations(salesReps, ({ many }) => ({
  conversations: many(conversations),
  bookings: many(bookings),
}));

export const boatsRelations = relations(boats, ({ many }) => ({
  bookings: many(bookings),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [conversations.customerId],
      references: [customers.customerId],
    }),
    assignedSalesRep: one(salesReps, {
      fields: [conversations.assignedSalesRepId],
      references: [salesReps.salesRepId],
    }),
    messages: many(messages),
    state: one(conversationState, {
      fields: [conversations.conversationId],
      references: [conversationState.conversationId],
    }),
    events: many(conversationEvents),
    bookings: many(bookings),
    aiAnalyses: many(aiAnalysis),
  })
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.conversationId],
  }),
  customer: one(customers, {
    fields: [messages.customerId],
    references: [customers.customerId],
  }),
  aiAnalyses: many(aiAnalysis),
}));

export const conversationStateRelations = relations(
  conversationState,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationState.conversationId],
      references: [conversations.conversationId],
    }),
    preferredBoat: one(boats, {
      fields: [conversationState.preferredBoatId],
      references: [boats.boatId],
    }),
  })
);

export const conversationEventsRelations = relations(
  conversationEvents,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationEvents.conversationId],
      references: [conversations.conversationId],
    }),
  })
);

export const bookingsRelations = relations(bookings, ({ one }) => ({
  conversation: one(conversations, {
    fields: [bookings.conversationId],
    references: [conversations.conversationId],
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

export const aiAnalysisRelations = relations(aiAnalysis, ({ one }) => ({
  conversation: one(conversations, {
    fields: [aiAnalysis.conversationId],
    references: [conversations.conversationId],
  }),
  triggerMessage: one(messages, {
    fields: [aiAnalysis.triggerMessageId],
    references: [messages.messageId],
  }),
}));
