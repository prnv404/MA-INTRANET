// Parser for WhatsApp "Export chat" text files (e.g. _chat.txt), used to backfill and test the market pipeline.

export interface ExportedMessage {
  postedAt: Date;
  sender: string;
  text: string;
  /** System lines ("X added Y"), pure attachments, deleted messages */
  isSystem: boolean;
  isEdited: boolean;
}

const LRM = '\\u200e';

// [7/19/26, 6:15:30 PM] Sender: text   (optional leading U+200E, narrow no-break space before AM/PM)
const HEADER = new RegExp(
  `^${LRM}?\\[(\\d{1,2})/(\\d{1,2})/(\\d{2,4}),\\s(\\d{1,2}):(\\d{2})(?::(\\d{2}))?[\\s\\u202f]?([AP]M)?\\]\\s(.*)$`
);
const ATTACHMENT_SUFFIX = new RegExp(
  `\\s*${LRM}?(?:image|video|audio|sticker|document|GIF|Contact card) omitted\\s*$`,
  'i'
);
const EDITED_SUFFIX = new RegExp(`\\s*${LRM}?<This message was edited>\\s*$`);
const DELETED = /^(?:This message was deleted|You deleted this message)\.?$/i;
const SYSTEM_BODY =
  /\b(?:added|removed|left|joined using|changed the group|changed this group|created this group)\b|Messages and calls are end-to-end encrypted/i;
const INVISIBLE = /[‎‪‬]/g;

function cleanSender(raw: string): string {
  return raw.replace(INVISIBLE, '').replace(/^~\s*/, '').trim();
}

/**
 * Parse an exported chat. Dates are read as M/D/Y unless any line has a first
 * component > 12 (then D/M/Y). Times are interpreted as IST (the exporting phone's zone).
 */
export function parseChatExport(content: string, options: { dayFirst?: boolean } = {}): ExportedMessage[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  const dayFirst =
    options.dayFirst ??
    lines.some((line) => {
      const m = line.match(HEADER);
      return m ? Number(m[1]) > 12 : false;
    });

  const messages: ExportedMessage[] = [];
  let current: ExportedMessage | null = null;

  for (const line of lines) {
    const m = line.match(HEADER);
    if (!m) {
      if (current) current.text += `\n${line}`;
      continue;
    }

    const [, a, b, yearRaw, hourRaw, minute, second = '00', meridiem, rest = ''] = m;
    const month = Number(dayFirst ? b : a);
    const day = Number(dayFirst ? a : b);
    const year = Number(yearRaw!.length === 2 ? `20${yearRaw}` : yearRaw);
    let hour = Number(hourRaw);
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    const pad = (n: number | string) => String(n).padStart(2, '0');
    const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}:${second}+05:30`;

    const sep = rest.indexOf(': ');
    const hasSender = sep > 0;
    const sender = hasSender ? cleanSender(rest.slice(0, sep)) : '';
    const body = hasSender ? rest.slice(sep + 2) : rest;
    // System lines ("~ X added ~ Y") have a leading U+200E in the body
    const isSystemLine = !hasSender || (body.startsWith('‎') && SYSTEM_BODY.test(body));

    current = { postedAt: new Date(iso), sender, text: body, isSystem: isSystemLine, isEdited: false };
    messages.push(current);
  }

  for (const msg of messages) {
    if (EDITED_SUFFIX.test(msg.text)) {
      msg.isEdited = true;
      msg.text = msg.text.replace(EDITED_SUFFIX, '');
    }
    // "1 bed room available <image omitted>" keeps its caption; pure attachments become empty
    msg.text = msg.text.replace(ATTACHMENT_SUFFIX, '').replace(INVISIBLE, '').trim();
    if (!msg.text || DELETED.test(msg.text)) msg.isSystem = true;
  }

  return messages;
}
