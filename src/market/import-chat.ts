// Import a WhatsApp "Export chat" file into the market pipeline, or dry-run the parser on it.
//
//   bun run market:import <_chat.txt> --group "Houseboat Owners" [--dry-run] [--out results.jsonl]
//                         [--from 2026-09-01] [--to 2026-09-30] [--limit 200] [--day-first]
//
// --dry-run only needs GEMINI_API_KEY (no database writes) and prints what each post would produce.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseChatExport } from './chat-export.js';
import { parseGroupPost, type ParsedGroupPost } from './group-parser.js';
import { istDateOf, isSkippableText, normalizeText, textHash } from './market-utils.js';

function getArg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function summarize(parsed: ParsedGroupPost): string {
  if (parsed.kind === 'noise') return 'noise';
  const listings = parsed.listings.map((l) => {
    const extras = [l.category, l.upper_deck ? 'UD' : '', l.available_from ? `@${l.available_from}` : ''].filter(Boolean);
    return `${l.date.slice(5)} ${l.bedrooms}b${(l.boat_count ?? 1) > 1 ? `×${l.boat_count}` : ''} ${l.trip_type}${extras.length ? ` (${extras.join(',')})` : ''}`;
  });
  const requests = parsed.requests.map(
    (r) => `NEED ${r.date?.slice(5) ?? r.date_text ?? '?'} ${r.pax ? `${r.pax}pax ` : ''}${r.bedrooms ? `${r.bedrooms}b ` : ''}${r.trip_type}`
  );
  return [...listings, ...requests].join(' | ') || `${parsed.kind} (nothing extracted)`;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
  const groupName = getArg(args, '--group');
  const dryRun = args.includes('--dry-run');
  const outFile = getArg(args, '--out');
  const from = getArg(args, '--from');
  const to = getArg(args, '--to');
  const limit = Number(getArg(args, '--limit') ?? Infinity);
  const dayFirst = args.includes('--day-first') ? true : undefined;

  if (!file || !groupName) {
    console.error('Usage: bun run market:import <_chat.txt> --group "<group name>" [--dry-run] [--out file.jsonl] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--day-first]');
    process.exit(1);
  }

  const messages = parseChatExport(await readFile(file, 'utf8'), { dayFirst }).filter((m) => {
    if (m.isSystem) return false;
    const day = istDateOf(m.postedAt);
    return (!from || day >= from) && (!to || day <= to);
  });
  const selected = messages.slice(0, limit);
  console.log(`📄 ${messages.length} posts in range, processing ${selected.length}${dryRun ? ' (dry run)' : ''}\n`);

  const groupJid = `import:${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const MarketService = dryRun ? null : (await import('./market.service.js')).MarketService;

  const cache = new Map<string, ParsedGroupPost>();
  const results: unknown[] = [];
  const stats = { supply: 0, demand: 0, noise: 0, skipped: 0, failed: 0, cached: 0, listings: 0, requests: 0 };

  for (const [index, msg] of selected.entries()) {
    const text = normalizeText(msg.text);
    if (isSkippableText(text)) {
      stats.skipped++;
      continue;
    }

    if (MarketService) {
      const id = createHash('sha1').update(`${groupJid}|${msg.postedAt.toISOString()}|${msg.sender}|${index}|${text}`).digest('hex');
      await MarketService.enqueue(
        {
          whatsappMessageId: `import:${id}`,
          groupJid,
          groupName,
          senderJid: `import:${msg.sender}`,
          senderName: msg.sender,
          text,
          postedAt: msg.postedAt,
        },
        { force: true }
      );
      continue;
    }

    const hash = textHash(text, msg.postedAt);
    let parsed = cache.get(hash);
    const wasCached = Boolean(parsed);
    try {
      parsed ??= await parseGroupPost(text, msg.postedAt);
    } catch (err: any) {
      stats.failed++;
      console.error(`❌ ${msg.sender}: ${err?.message || err}`);
      continue;
    }
    cache.set(hash, parsed);

    stats[parsed.kind]++;
    if (wasCached) stats.cached++;
    stats.listings += parsed.listings.length;
    stats.requests += parsed.requests.length;

    const when = msg.postedAt.toISOString().slice(0, 16).replace('T', ' ');
    console.log(`[${when}Z] ${msg.sender}: ${text.replace(/\n/g, ' ⏎ ').slice(0, 90)}`);
    console.log(`   → ${summarize(parsed)}${wasCached ? '  [cached]' : ''}`);
    results.push({ posted_at: msg.postedAt.toISOString(), sender: msg.sender, text, parsed });
  }

  if (outFile && results.length) {
    await writeFile(outFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`\n💾 Wrote ${results.length} results to ${outFile}`);
  }

  if (dryRun) {
    console.log(
      `\n✅ supply ${stats.supply} · demand ${stats.demand} · noise ${stats.noise} · skipped ${stats.skipped} · failed ${stats.failed}` +
        ` · cached ${stats.cached} → ${stats.listings} listings, ${stats.requests} requests`
    );
  } else {
    console.log(`\n✅ Imported into "${groupName}" (${groupJid}). Listings from past dates are already expired; operators are now known.`);
  }
}

main().catch((err) => {
  console.error('💥 Import failed:', err);
  process.exit(1);
});
