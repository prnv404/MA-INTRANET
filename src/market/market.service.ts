import { db, UNIQUE_VIOLATION } from '../db/index.js';
import type {
  GroupMessage,
  MarketGroup,
  MarketListing,
  MarketOperator,
  MarketRequest,
} from '../db/schema.js';
import type { InterceptedMessage } from '../types.js';
import { isAiConfigured } from '../ai/gemini.js';
import { parseGroupPost, type ParsedGroupPost, type ParsedListing, type ParsedRequest } from './group-parser.js';
import {
  SUPERSEDE_GRACE_MS,
  computeListingExpiry,
  computeRequestExpiry,
  extractPhones,
  isSkippableText,
  listingKey,
  normalizeText,
  phoneFromJid,
  textHash,
  unionArrays,
} from './market-utils.js';

export interface GroupMessageInput {
  whatsappMessageId: string;
  groupJid: string;
  groupName?: string;
  senderJid?: string;
  senderName?: string;
  text?: string;
  postedAt: Date;
  /** "Delete for everyone" of an earlier post */
  revokedMessageId?: string;
  /** Edit of an earlier post (text holds the new content) */
  editedMessageId?: string;
}

interface ProcessOptions {
  /** Process even if the group is not enabled (used by the chat-export importer) */
  force?: boolean;
}

const GROUP_CACHE_TTL_MS = 60_000;

/**
 * Market pipeline: WhatsApp B2B group posts → live boat availability (market_listings)
 * and demand (market_requests). Posts are processed one at a time so bursts from the
 * same operator never race each other.
 */
export class MarketService {
  private static chain: Promise<void> = Promise.resolve();
  private static groupCache = new Map<string, { group: MarketGroup; fetchedAt: number }>();
  private static warnedMissingKey = false;

  public static fromIntercepted(msg: InterceptedMessage): GroupMessageInput {
    return {
      whatsappMessageId: msg.id,
      groupJid: msg.sender.groupJid!,
      groupName: msg.sender.groupName,
      senderJid: msg.sender.jid || msg.sender.participantJid,
      senderName: msg.sender.pushName,
      text: msg.content.text || msg.content.media?.caption,
      postedAt: new Date(msg.timestamp * 1000),
      revokedMessageId: msg.content.revokedMessageId,
      editedMessageId: msg.content.editedMessageId,
    };
  }

  /** Queue a group post. Errors are logged, never thrown. */
  public static enqueue(input: GroupMessageInput, options: ProcessOptions = {}): Promise<void> {
    const run = this.chain.then(() =>
      this.process(input, options).catch((err: any) => {
        console.error(`❌ [MARKET] Failed to process ${input.whatsappMessageId}:`, err?.message || err);
      })
    );
    this.chain = run;
    return run;
  }

  private static async process(input: GroupMessageInput, options: ProcessOptions): Promise<void> {
    const group = await this.ensureGroup(input.groupJid, input.groupName);
    if (!group.enabled && !options.force) return;

    if (input.revokedMessageId) {
      const removed = await this.removeBySource(input.revokedMessageId);
      if (removed) console.log(`🗑️ [MARKET] Post ${input.revokedMessageId} deleted — ${removed} listing(s)/request(s) removed`);
      return;
    }

    let whatsappMessageId = input.whatsappMessageId;
    if (input.editedMessageId) {
      await this.removeBySource(input.editedMessageId);
      whatsappMessageId = `${input.editedMessageId}:edit:${input.postedAt.getTime()}`;
    }

    const text = normalizeText(input.text ?? '');
    const skippable = isSkippableText(text);
    const hash = skippable ? null : textHash(text, input.postedAt);

    // 1. Store the raw post (unique whatsapp_message_id makes reprocessing idempotent)
    const { data: row, error: insertError } = await db
      .from('group_messages')
      .insert({
        whatsapp_message_id: whatsappMessageId,
        group_jid: input.groupJid,
        sender_jid: input.senderJid ?? null,
        sender_name: input.senderName ?? null,
        message_text: text || null,
        text_hash: hash,
        message_timestamp: input.postedAt.toISOString(),
        parse_status: skippable ? 'skipped' : 'pending',
      })
      .select()
      .single<GroupMessage>();
    if (insertError?.code === UNIQUE_VIOLATION) return;
    if (insertError) throw insertError;
    if (skippable) return;

    // 2. Parse — reuse the result for identical text posted the same day (reposts, other groups)
    let parsed: ParsedGroupPost;
    const cached = await this.findCachedParse(hash!, row.group_message_id);
    if (cached) {
      parsed = cached;
    } else {
      if (!isAiConfigured()) {
        if (!this.warnedMissingKey) {
          console.warn('⚠️ [MARKET] GEMINI_API_KEY is not set — group posts are stored but not parsed.');
          this.warnedMissingKey = true;
        }
        return;
      }
      try {
        parsed = await parseGroupPost(text, input.postedAt);
      } catch (err) {
        await db.from('group_messages').update({ parse_status: 'failed' }).eq('group_message_id', row.group_message_id);
        throw err;
      }
    }

    if (parsed.kind === 'noise' || (parsed.listings.length === 0 && parsed.requests.length === 0)) {
      await db
        .from('group_messages')
        .update({ parse_status: 'parsed', kind: parsed.kind, parsed })
        .eq('group_message_id', row.group_message_id);
      return;
    }

    // 3. Resolve the operator (by phone in the post, else by sender)
    const phones = extractPhones(text);
    const jidPhone = phoneFromJid(input.senderJid);
    if (phones.length === 0 && jidPhone) phones.push(jidPhone);
    const operator = await this.resolveOperator({
      phones,
      senderJid: input.senderJid,
      senderName: input.senderName,
      boatNames: parsed.listings.map((l) => l.boat_name).filter((n): n is string => Boolean(n)),
    });

    // 4. Apply supply and demand — use sender's WhatsApp number when no phone in post
    const contactPhone = phones[0] ?? phoneFromJid(input.senderJid) ?? null;
    const context = { operator, row, input, contactPhone };
    const listingSummary = await this.applyListings(parsed.listings, context);
    const requestCount = await this.applyRequests(parsed.requests, context);

    await db
      .from('group_messages')
      .update({ parse_status: 'parsed', kind: parsed.kind, parsed, operator_id: operator.operator_id })
      .eq('group_message_id', row.group_message_id);

    const who = `${operator.name ?? input.senderName ?? 'unknown'}${phones[0] ? ` (${phones[0]})` : ''}`;
    const parts = [
      listingSummary.upserted ? `${listingSummary.upserted} listing(s)` : '',
      listingSummary.superseded ? `${listingSummary.superseded} superseded` : '',
      requestCount ? `${requestCount} request(s)` : '',
    ].filter(Boolean);
    console.log(`📊 [MARKET] ${group.name ?? input.groupJid} · ${who}: ${parts.join(', ') || 'nothing new'}${cached ? ' [cached parse]' : ''}`);
  }

  // ------------------------------------------------------------------
  // Groups
  // ------------------------------------------------------------------

  /** Register every group the bot sees (disabled by default) and return its row */
  private static async ensureGroup(groupJid: string, name?: string): Promise<MarketGroup> {
    const cached = this.groupCache.get(groupJid);
    if (cached && Date.now() - cached.fetchedAt < GROUP_CACHE_TTL_MS && (cached.group.name || !name)) {
      return cached.group;
    }

    const { data: existing, error } = await db
      .from('market_groups')
      .select()
      .eq('group_jid', groupJid)
      .maybeSingle<MarketGroup>();
    if (error) throw error;

    let group = existing;
    if (!group) {
      const { data: created, error: insertError } = await db
        .from('market_groups')
        .upsert({ group_jid: groupJid, name: name ?? null, enabled: false }, { onConflict: 'group_jid', ignoreDuplicates: true })
        .select()
        .maybeSingle<MarketGroup>();
      if (insertError) throw insertError;
      group = created ?? { group_jid: groupJid, name: name ?? null, enabled: false, created_at: new Date().toISOString() };
      console.log(`👥 [MARKET] New group registered (disabled): ${name ?? groupJid} — enable it in market_groups to start reading`);
    } else if (!group.name && name) {
      await db.from('market_groups').update({ name }).eq('group_jid', groupJid);
      group = { ...group, name };
    }

    this.groupCache.set(groupJid, { group, fetchedAt: Date.now() });
    return group;
  }

  // ------------------------------------------------------------------
  // Parsing cache
  // ------------------------------------------------------------------

  private static async findCachedParse(hash: string, excludeId: string): Promise<ParsedGroupPost | null> {
    const { data, error } = await db
      .from('group_messages')
      .select('parsed')
      .eq('text_hash', hash)
      .eq('parse_status', 'parsed')
      .neq('group_message_id', excludeId)
      .not('parsed', 'is', null)
      .limit(1);
    if (error) throw error;
    return (data[0]?.parsed as ParsedGroupPost | undefined) ?? null;
  }

  // ------------------------------------------------------------------
  // Operators
  // ------------------------------------------------------------------

  private static async resolveOperator(args: {
    phones: string[];
    senderJid?: string;
    senderName?: string;
    boatNames: string[];
  }): Promise<MarketOperator> {
    let operator: MarketOperator | null = null;

    if (args.phones.length > 0) {
      const { data, error } = await db
        .from('market_operators')
        .select()
        .overlaps('phones', args.phones)
        .order('created_at', { ascending: true })
        .limit(1)
        .returns<MarketOperator[]>();
      if (error) throw error;
      operator = data[0] ?? null;
    }

    if (!operator && args.senderJid) {
      const { data, error } = await db
        .from('market_operators')
        .select()
        .contains('sender_jids', [args.senderJid])
        .order('created_at', { ascending: true })
        .limit(1)
        .returns<MarketOperator[]>();
      if (error) throw error;
      operator = data[0] ?? null;
    }

    const senderJids = args.senderJid ? [args.senderJid] : [];

    if (!operator) {
      const { data, error } = await db
        .from('market_operators')
        .insert({
          name: args.senderName ?? args.boatNames[0] ?? null,
          phones: args.phones,
          boat_names: unionArrays([], args.boatNames),
          sender_jids: senderJids,
        })
        .select()
        .single<MarketOperator>();
      if (error) throw error;
      return data;
    }

    const phones = unionArrays(operator.phones, args.phones);
    const boatNames = unionArrays(operator.boat_names, args.boatNames);
    const jids = unionArrays(operator.sender_jids, senderJids);
    const changed =
      phones.length !== operator.phones.length ||
      boatNames.length !== operator.boat_names.length ||
      jids.length !== operator.sender_jids.length ||
      (!operator.name && args.senderName);

    if (!changed) return operator;

    const { data, error } = await db
      .from('market_operators')
      .update({
        phones,
        boat_names: boatNames,
        sender_jids: jids,
        name: operator.name ?? args.senderName ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('operator_id', operator.operator_id)
      .select()
      .single<MarketOperator>();
    if (error) throw error;
    return data;
  }

  // ------------------------------------------------------------------
  // Supply
  // ------------------------------------------------------------------

  /**
   * Upsert listings per date. The newest post from an operator for a date is their current
   * inventory: their other active listings for that date are superseded, unless they were
   * seen within SUPERSEDE_GRACE_MS (operators often split one update over several messages).
   * Listings marked "sold" by staff stay sold even if the ad is reposted.
   */
  private static async applyListings(
    listings: ParsedListing[],
    ctx: { operator: MarketOperator; row: GroupMessage; input: GroupMessageInput; contactPhone: string | null }
  ): Promise<{ upserted: number; superseded: number }> {
    let upserted = 0;
    let superseded = 0;
    const postedAt = ctx.input.postedAt;
    const postedIso = postedAt.toISOString();

    const byDate = new Map<string, ParsedListing[]>();
    for (const listing of listings) {
      const list = byDate.get(listing.date) ?? [];
      list.push(listing);
      byDate.set(listing.date, list);
    }

    for (const [date, items] of byDate) {
      const { data: existing, error } = await db
        .from('market_listings')
        .select()
        .eq('operator_id', ctx.operator.operator_id)
        .eq('available_date', date)
        .returns<MarketListing[]>();
      if (error) throw error;

      const existingByKey = new Map(existing.map((l) => [listingKey(l.bedrooms, l.trip_type), l]));
      const newKeys = new Set<string>();

      for (const item of items) {
        const key = listingKey(item.bedrooms, item.trip_type);
        if (newKeys.has(key)) continue; // duplicate size within one post
        newKeys.add(key);

        const fields = {
          boat_count: item.boat_count ?? 1,
          category: item.category ?? null,
          upper_deck: item.upper_deck ?? null,
          ac: item.ac ?? null,
          glass_covered: item.glass_covered ?? null,
          capacity_pax: item.capacity_pax ?? null,
          available_from: item.available_from ?? null,
          boat_name: item.boat_name ?? null,
          contact_phone: ctx.contactPhone,
          source_message_id: ctx.row.group_message_id,
          expires_at: computeListingExpiry({ date, availableFrom: item.available_from, postedAt }).toISOString(),
          updated_at: new Date().toISOString(),
        };

        const current = existingByKey.get(key);
        if (current) {
          if (current.status === 'sold') continue;
          if (new Date(current.last_seen_at) > postedAt) continue; // older post arriving late
          const { error: updateError } = await db
            .from('market_listings')
            .update({
              ...fields,
              // keep known details when the repost is less specific
              category: fields.category ?? current.category,
              upper_deck: fields.upper_deck ?? current.upper_deck,
              ac: fields.ac ?? current.ac,
              glass_covered: fields.glass_covered ?? current.glass_covered,
              capacity_pax: fields.capacity_pax ?? current.capacity_pax,
              boat_name: fields.boat_name ?? current.boat_name,
              contact_phone: fields.contact_phone ?? current.contact_phone,
              group_jids: unionArrays(current.group_jids, [ctx.input.groupJid]),
              last_seen_at: postedIso,
              repost_count: current.repost_count + 1,
              status: 'active',
            })
            .eq('listing_id', current.listing_id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await db.from('market_listings').insert({
            ...fields,
            operator_id: ctx.operator.operator_id,
            available_date: date,
            bedrooms: item.bedrooms,
            trip_type: item.trip_type,
            group_jids: [ctx.input.groupJid],
            first_seen_at: postedIso,
            last_seen_at: postedIso,
            repost_count: 1,
            status: 'active',
          });
          if (insertError) throw insertError;
        }
        upserted++;
      }

      // Supersede this operator's other active listings for the date (outside the burst window)
      const cutoff = postedAt.getTime() - SUPERSEDE_GRACE_MS;
      const stale = existing.filter(
        (l) =>
          l.status === 'active' &&
          !newKeys.has(listingKey(l.bedrooms, l.trip_type)) &&
          new Date(l.last_seen_at).getTime() < cutoff
      );
      if (stale.length > 0) {
        const { error: supersedeError } = await db
          .from('market_listings')
          .update({ status: 'superseded', updated_at: new Date().toISOString() })
          .in('listing_id', stale.map((l) => l.listing_id));
        if (supersedeError) throw supersedeError;
        superseded += stale.length;
      }
    }

    return { upserted, superseded };
  }

  // ------------------------------------------------------------------
  // Demand
  // ------------------------------------------------------------------

  /** Upsert demand posts; a repost of the same need bumps the existing request */
  private static async applyRequests(
    requests: ParsedRequest[],
    ctx: { operator: MarketOperator; row: GroupMessage; input: GroupMessageInput; contactPhone: string | null }
  ): Promise<number> {
    const postedIso = ctx.input.postedAt.toISOString();
    let count = 0;

    for (const req of requests) {
      let query = db
        .from('market_requests')
        .select()
        .eq('operator_id', ctx.operator.operator_id)
        .eq('status', 'open')
        .eq('trip_type', req.trip_type);
      query = req.date ? query.eq('needed_date', req.date) : query.is('needed_date', null);
      query = req.pax ? query.eq('pax', req.pax) : query.is('pax', null);
      query = req.bedrooms ? query.eq('bedrooms', req.bedrooms) : query.is('bedrooms', null);

      const { data: matches, error } = await query.limit(1).returns<MarketRequest[]>();
      if (error) throw error;

      const fields = {
        date_text: req.date_text ?? null,
        category: req.category ?? null,
        party_type: req.party_type ?? null,
        notes: req.notes ?? null,
        contact_phone: ctx.contactPhone,
        source_message_id: ctx.row.group_message_id,
        expires_at: computeRequestExpiry({ date: req.date, postedAt: ctx.input.postedAt }).toISOString(),
        updated_at: new Date().toISOString(),
      };

      const current = matches[0];
      if (current) {
        const { error: updateError } = await db
          .from('market_requests')
          .update({
            ...fields,
            category: fields.category ?? current.category,
            party_type: fields.party_type ?? current.party_type,
            notes: fields.notes ?? current.notes,
            contact_phone: fields.contact_phone ?? current.contact_phone,
            group_jids: unionArrays(current.group_jids, [ctx.input.groupJid]),
            last_seen_at: postedIso,
            repost_count: current.repost_count + 1,
          })
          .eq('request_id', current.request_id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await db.from('market_requests').insert({
          ...fields,
          operator_id: ctx.operator.operator_id,
          needed_date: req.date ?? null,
          pax: req.pax ?? null,
          bedrooms: req.bedrooms ?? null,
          trip_type: req.trip_type,
          group_jids: [ctx.input.groupJid],
          first_seen_at: postedIso,
          last_seen_at: postedIso,
          repost_count: 1,
          status: 'open',
        });
        if (insertError) throw insertError;
      }
      count++;
    }

    return count;
  }

  // ------------------------------------------------------------------
  // Deletes / edits
  // ------------------------------------------------------------------

  /** Remove listings/requests whose latest source is the given post */
  private static async removeBySource(whatsappMessageId: string): Promise<number> {
    const { data: source, error } = await db
      .from('group_messages')
      .select('group_message_id')
      .eq('whatsapp_message_id', whatsappMessageId)
      .maybeSingle<{ group_message_id: string }>();
    if (error) throw error;
    if (!source) return 0;

    const now = new Date().toISOString();
    const { data: listings, error: listingError } = await db
      .from('market_listings')
      .update({ status: 'removed', updated_at: now })
      .eq('source_message_id', source.group_message_id)
      .eq('status', 'active')
      .select('listing_id');
    if (listingError) throw listingError;

    const { data: requests, error: requestError } = await db
      .from('market_requests')
      .update({ status: 'closed', updated_at: now })
      .eq('source_message_id', source.group_message_id)
      .eq('status', 'open')
      .select('request_id');
    if (requestError) throw requestError;

    return listings.length + requests.length;
  }
}
