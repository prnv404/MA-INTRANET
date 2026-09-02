Here is the same architecture in a clean copy-paste format for your notes:

```text
============================================================
INTELLIGENT WHATSAPP CRM — DATA MODEL REFERENCE
============================================================

CORE FLOW

WhatsApp
   ↓
Message Capture
   ↓
Raw Messages
   ↓
Conversation / Lead
   ↓
AI Analysis
   ↓
Structured CRM Data
   ↓
Events + Current State
   ↓
Bookings / Sales Data
   ↓
BI Dashboard
   ↓
Natural Language BI Agent


============================================================
1. CUSTOMERS
============================================================

Purpose:
Permanent customer profile.

CUSTOMERS

customer_id              UUID
whatsapp_number          STRING
name                     STRING | NULL
email                    STRING | NULL
country                  STRING | NULL
state                    STRING | NULL
city                     STRING | NULL

first_contact_at         DATETIME
last_contact_at          DATETIME

total_conversations      INTEGER
total_bookings           INTEGER
total_spend              DECIMAL

created_at               DATETIME
updated_at               DATETIME


Relationship:

CUSTOMER
   ↓
many CONVERSATIONS


============================================================
2. CONVERSATIONS / LEADS
============================================================

Purpose:
Represents one sales opportunity / enquiry.

CONVERSATIONS

conversation_id          UUID
customer_id              UUID
assigned_sales_rep_id    UUID | NULL

channel                  ENUM
                          whatsapp
                          website
                          instagram
                          phone
                          other

status                   ENUM
                          active
                          inactive
                          booked
                          lost
                          archived

lead_stage               ENUM
                          new
                          enquiry
                          qualified
                          recommendation
                          quotation
                          negotiation
                          payment
                          booked
                          lost

source                   STRING | NULL

first_message_at         DATETIME
last_message_at          DATETIME

travel_date              DATE | NULL
guest_count              INTEGER | NULL
bedrooms_required        INTEGER | NULL
boat_type                STRING | NULL
budget                   DECIMAL | NULL
quoted_price             DECIMAL | NULL
final_price              DECIMAL | NULL

intent                   STRING | NULL
lead_score               INTEGER | NULL
sentiment                STRING | NULL
main_objection           STRING | NULL

booking_id               UUID | NULL

ai_summary               TEXT | NULL

lost_reason              STRING | NULL
lost_at                  DATETIME | NULL

created_at               DATETIME
updated_at               DATETIME


IMPORTANT:

Customer = person

Conversation = sales opportunity


============================================================
3. MESSAGES
============================================================

Purpose:
Store every WhatsApp message exactly as received/sent.

MESSAGES

message_id               UUID
conversation_id          UUID
customer_id              UUID

whatsapp_message_id      STRING

sender_type              ENUM
                          customer
                          sales_rep
                          bot
                          system

direction                ENUM
                          inbound
                          outbound

message_type             ENUM
                          text
                          image
                          video
                          audio
                          document
                          location
                          sticker
                          other

message_text             TEXT | NULL

media_url                STRING | NULL
reply_to_message_id      UUID | NULL

message_timestamp        DATETIME

raw_payload              JSON

created_at               DATETIME


IMPORTANT:

Keep the original message.

Do NOT overwrite raw messages with AI interpretation.

Raw message = source of truth.


============================================================
4. CONVERSATION STATE
============================================================

Purpose:
Store the latest known understanding of a lead.

CONVERSATION_STATE

conversation_id          UUID

intent                   STRING | NULL

travel_date              DATE | NULL
guest_count              INTEGER | NULL
bedrooms_required        INTEGER | NULL
boat_type                STRING | NULL

budget                   DECIMAL | NULL
quoted_price             DECIMAL | NULL
negotiated_price         DECIMAL | NULL

location                 STRING | NULL
food_preference          STRING | NULL

lead_stage               STRING
lead_score               INTEGER

customer_sentiment       STRING | NULL
purchase_intent          STRING | NULL
main_objection           STRING | NULL

preferred_boat_id        UUID | NULL

booking_status           STRING

last_ai_summary          TEXT | NULL

updated_at               DATETIME


Purpose:

"What do we currently know about this customer?"


============================================================
5. CONVERSATION EVENTS
============================================================

Purpose:
Track important actions and changes in the sales journey.

CONVERSATION_EVENTS

event_id                 UUID
conversation_id          UUID

event_type               ENUM

                          lead_created
                          requirement_collected
                          boat_recommended
                          quote_sent
                          customer_objected
                          negotiation_started
                          follow_up_sent
                          customer_replied
                          payment_requested
                          payment_received
                          booking_confirmed
                          booking_cancelled
                          lead_lost
                          lead_reactivated

event_data               JSON

performed_by_type        ENUM
                          customer
                          sales_rep
                          ai
                          system

performed_by_id          UUID | NULL

event_timestamp          DATETIME

created_at               DATETIME


Example:

event_type:
customer_objected

event_data:

{
  reason: "price",
  quoted_price: 18000,
  requested_budget: 15000
}


IMPORTANT:

This table is extremely useful for BI.


============================================================
6. AI ANALYSIS
============================================================

Purpose:
Store what AI understood from messages/conversations.

AI_ANALYSIS

analysis_id              UUID

conversation_id          UUID
message_id               UUID | NULL

intent                   STRING | NULL
sentiment                STRING | NULL
lead_score               INTEGER | NULL

lead_stage               STRING | NULL

objection                STRING | NULL
purchase_intent          STRING | NULL

extracted_data           JSON

recommended_action       TEXT | NULL

ai_summary               TEXT | NULL

confidence_score         DECIMAL | NULL

model                    STRING

analyzed_at              DATETIME


Example:

extracted_data:

{
  "travel_date": "2026-10-15",
  "guests": 7,
  "bedrooms": 3,
  "budget": 15000,
  "boat_type": "premium"
}


IMPORTANT:

AI_ANALYSIS
= what AI interpreted

CONVERSATION_STATE
= current structured CRM state

MESSAGES
= original evidence


============================================================
7. SALES REPS
============================================================

SALES_REPS

sales_rep_id             UUID

name                     STRING
email                    STRING | NULL
phone                    STRING | NULL

team                     STRING | NULL

active                   BOOLEAN

joined_at                DATETIME
created_at               DATETIME
updated_at               DATETIME


============================================================
8. BOOKINGS
============================================================

Purpose:
Actual confirmed business transaction.

BOOKINGS

booking_id               UUID

conversation_id          UUID
customer_id              UUID
sales_rep_id             UUID

boat_id                  UUID

travel_date              DATE

guest_count              INTEGER
bedrooms                 INTEGER

quoted_price             DECIMAL
final_price              DECIMAL
discount                 DECIMAL

booking_status           ENUM
                          pending
                          confirmed
                          cancelled
                          completed

payment_status           ENUM
                          pending
                          partial
                          paid
                          refunded

booking_created_at       DATETIME
confirmed_at             DATETIME | NULL
cancelled_at             DATETIME | NULL

created_at               DATETIME
updated_at               DATETIME


============================================================
9. BOATS
============================================================

BOATS

boat_id                  UUID

boat_name                STRING

boat_type                STRING
                          deluxe
                          premium
                          luxury
                          shikara
                          other

bedrooms                 INTEGER
capacity                 INTEGER

operator_name            STRING | NULL
location                 STRING | NULL

base_price               DECIMAL

status                   ENUM
                         available
                         unavailable
                         maintenance
                         inactive

created_at               DATETIME
updated_at               DATETIME


============================================================
10. FOLLOW UPS
============================================================

Purpose:
Track pending sales follow-ups.

FOLLOW_UPS

follow_up_id             UUID

conversation_id          UUID
assigned_to              UUID

reason                   STRING

due_at                   DATETIME

status                   ENUM
                         pending
                         completed
                         cancelled

completed_at             DATETIME | NULL

created_at               DATETIME
updated_at               DATETIME


Example:

Customer has not replied for 3 days.

reason:
customer_follow_up

due_at:
2026-09-04


============================================================
11. STANDARDIZED LEAD VALUES
============================================================

LEAD STATUS

new
active
inactive
booked
lost
archived


LEAD STAGE

new
enquiry
qualified
recommendation
quotation
negotiation
payment
booked
lost


LOST REASON

price
no_availability
boat_not_suitable
slow_response
customer_changed_plan
competitor
no_response
payment_issue
bad_experience
unknown
other


IMPORTANT:

Do not allow different text for the same reason.

Example:

"too costly"
"expensive"
"price issue"
"budget problem"

All should become:

price


============================================================
12. OPTIONAL: MESSAGE EMBEDDINGS
============================================================

You do NOT need this initially.

Later:

MESSAGE_EMBEDDINGS

message_id               UUID
conversation_id          UUID

embedding                VECTOR

created_at               DATETIME


Use:

PostgreSQL + pgvector

Purpose:

Semantic search
(അർത്ഥം അടിസ്ഥാനമാക്കിയുള്ള തിരച്ചിൽ)

Example:

"Find conversations where customers complained about pricing."

It can find:

"Too expensive"
"Can you reduce the rate?"
"Outside my budget"


============================================================
RELATIONSHIPS
============================================================

CUSTOMER
   │
   └────< CONVERSATIONS
             │
             ├────< MESSAGES
             │
             ├──── CONVERSATION_STATE
             │
             ├────< CONVERSATION_EVENTS
             │
             ├────< AI_ANALYSIS
             │
             ├────< FOLLOW_UPS
             │
             └──── BOOKING


SALES_REP
   │
   ├────< CONVERSATIONS
   ├────< FOLLOW_UPS
   └────< BOOKINGS


BOAT
   │
   └────< BOOKINGS


============================================================
MESSAGE → AI → CRM FLOW
============================================================

1. WhatsApp message arrives

        ↓

2. Save raw message

        ↓

3. Find customer

        ↓

4. Find active conversation

        ↓

5. Give AI:

   - Current conversation state
   - Conversation summary
   - Recent messages
   - New message

        ↓

6. AI returns structured information

        ↓

7. Update CONVERSATION_STATE

        ↓

8. Create CONVERSATION_EVENT
   when something important happens

        ↓

9. Update lead / CRM

        ↓

10. BI uses structured data


============================================================
LONG CONVERSATION HANDLING
============================================================

Do NOT send the entire conversation to AI every time.

Use:

CURRENT STATE
+
SUMMARY
+
RECENT MESSAGES
+
NEW MESSAGE


Example:

CURRENT STATE

3 bedrooms
7 guests
Oct 15
budget ₹15,000
stage = negotiation
objection = price


SUMMARY

Customer wants a premium 3-bedroom houseboat
for Oct 15.

Initial quote was ₹18,000.
Customer objected to price.
Sales offered ₹16,000.
Waiting for confirmation.


RECENT MESSAGES

Customer: Can you send photos?


NEW MESSAGE

Customer: Also what food options are there?


AI
↓
updates food_preference
↓
updates state


============================================================
BI DATA FLOW
============================================================

RAW WHATSAPP
      ↓
MESSAGES
      ↓
AI ANALYSIS
      ↓
CONVERSATION STATE
      +
CONVERSATION EVENTS
      +
BOOKINGS
      ↓
BI


BI can answer:

How many leads?

How many qualified leads?

How many bookings?

Conversion rate?

How many customers were lost?

Why were they lost?

Which sales rep converts best?

What is the biggest objection?

Average customer budget?

Average quoted price?

Average discount?

How long does it take to convert?

How many leads stopped responding?

How many customers received a follow-up?

Which boat gets the most enquiries?


============================================================
NATURAL LANGUAGE BI AGENT
============================================================

USER:

"How many customers did we lose last month and why?"


        ↓

BI AI AGENT

Understands question

        ↓

Generates database query

        ↓

DATABASE

Calculates exact numbers

        ↓

AI

Explains result

        ↓

USER:

"312 leads were lost.

Price: 124 (40%)
No availability: 67 (21%)
No response: 55 (18%)
Competitor: 31 (10%)
Other: 35 (11%)"


IMPORTANT:

AI should NOT invent the numbers.

DATABASE calculates.

AI interprets and explains.


============================================================
ROLE OF EACH TECHNOLOGY
============================================================

WhatsApp API / Baileys / WPPConnect
→ captures messages

PostgreSQL
→ stores CRM + business data

AI / LLM
→ understands conversations
→ extracts structured information
→ classifies objections
→ summarizes conversations

Redis / Queue
→ processes AI jobs asynchronously
   (പിന്നിൽ വേറെയായി പ്രവർത്തിപ്പിക്കൽ)

BI Tool / Dashboard
→ charts, metrics, reports

BI AI Agent
→ lets users ask questions in normal language

pgvector
→ optional semantic search


============================================================
RECOMMENDED INITIAL STACK
============================================================

WhatsApp
        ↓
WhatsApp Cloud API
        ↓
Node.js / TypeScript
        ↓
PostgreSQL
        ↓
AI
        ↓
PostgreSQL
        ↓
Metabase / Power BI / Custom Dashboard


LATER:

PostgreSQL
   +
pgvector


============================================================
MOST IMPORTANT DESIGN RULE
============================================================

MESSAGES
= What actually happened


CONVERSATION_STATE
= What we currently know


AI_ANALYSIS
= What AI interpreted


CONVERSATION_EVENTS
= What happened during the sales journey


BOOKINGS
= What business actually happened


============================================================
FINAL CONCEPT
============================================================

WhatsApp Conversations
        ↓
AI understands them
        ↓
Structured CRM data
        ↓
Continuous lead state
        ↓
Sales events
        ↓
Bookings
        ↓
BI
        ↓
AI-powered business questions


This is essentially:

INTELLIGENT CRM
+
CONVERSATION INTELLIGENCE
+
BI
```
