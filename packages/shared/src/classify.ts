import { keyPhrases, slugify, stripIntentPrefix, titleFromText } from './tokens.ts';
import type { Platform, SignalKind } from './types.ts';

export interface ClassificationRule {
  kind: SignalKind;
  phrase: string;
  pattern: RegExp;
  /** 0..1 confidence that this phrase really expresses the signal. */
  strength: number;
}

/**
 * Rule based classifier.
 *
 * Every rule is a plain regular expression over the public text of a post, so the
 * classification is deterministic, explainable and testable without a model call.
 * `matchedPhrase` always contains the literal text that fired the rule so the UI can
 * show *why* a record was classified the way it was.
 */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    kind: 'buying_intent',
    phrase: 'willing to pay',
    pattern: /\b(?:willing to pay|would (?:gladly |happily )?pay|i'?d pay|happy to pay|gladly pay|take my money|shut up and take my money|looking to buy|want(?:ing)? to buy|budget(?:ed)? for|purchase a)\b/i,
    strength: 1,
  },
  {
    kind: 'buying_intent',
    phrase: 'want that work automated',
    pattern: /\b(?:want|need|wish)\s+(?:that|this|it|the)\s+(?:work|task|process|job|thing)?\s*(?:automated|handled|done for me)\b/i,
    strength: 0.85,
  },
  {
    kind: 'buying_intent',
    phrase: 'need a tool / app / software',
    pattern: /\b(?:need|want|looking for|searching for|hunting for)\s+(?:a|an|the|some)?\s*(?:good\s+|simple\s+|better\s+)?(?:tool|app|software|platform|solution|service|system|saas)\b/i,
    strength: 0.8,
  },
  {
    kind: 'buying_intent',
    phrase: 'how much would it cost',
    pattern: /\b(?:how much (?:would|does|will) it cost|what (?:would|does) it cost|any (?:paid|premium) (?:option|alternativ))\w*/i,
    strength: 0.6,
  },
  {
    kind: 'buying_intent',
    phrase: 'hire someone to build',
    pattern: /\b(?:hire (?:someone|somebody|a dev)|pay (?:someone|somebody) to build|would (?:pay|subscribe) for)\b/i,
    strength: 0.9,
  },
  {
    kind: 'tool_request',
    phrase: 'i wish there was',
    pattern: /\bi wish (?:there (?:was|were)|someone would (?:build|make))\b/i,
    strength: 1,
  },
  {
    kind: 'tool_request',
    phrase: 'is there a tool',
    pattern: /\b(?:is|are) there (?:a|an|any)\b[^.?!]{0,40}?\b(?:tool|app|software|platform|solution|service|system|directory|newsletter|way to)\b/i,
    strength: 0.95,
  },
  {
    kind: 'tool_request',
    phrase: 'does anyone have a tool',
    pattern: /\bdoes any(?:one|body)\s+(?:have|know of|recommend|use)\b[^.?!]{0,40}?\b(?:tool|app|software|platform|solution|service|system)\b/i,
    strength: 0.9,
  },
  {
    kind: 'tool_request',
    phrase: 'anyone have a tool',
    pattern: /\bany(?:one|body)\s+(?:have|know of|recommend|using)\b[^.?!]{0,40}?\b(?:tool|app|software|platform|solution|service|system)\b/i,
    strength: 0.85,
  },
  {
    kind: 'tool_request',
    phrase: 'looking for a tool',
    pattern: /\b(?:looking|searching|hunting|shopping) for (?:a|an|any)\b[^.?!]{0,40}?\b(?:tool|app|software|platform|solution|service|system|newsletter|directory)\b/i,
    strength: 0.9,
  },
  {
    kind: 'tool_request',
    phrase: 'i wish there was a way to',
    pattern: /\bi wish there was a way to\b/i,
    strength: 0.8,
  },
  {
    kind: 'tool_request',
    phrase: 'recommendations for',
    pattern: /\b(?:any )?recommendations? (?:for|on)\b/i,
    strength: 0.6,
  },
  {
    kind: 'workaround',
    phrase: 'workaround',
    pattern: /\bwork ?arounds?\b/i,
    strength: 0.8,
  },
  {
    kind: 'workaround',
    phrase: 'spreadsheet / google sheet',
    pattern: /\b(?:google ?sheets?|excel|spreadsheet|airtable base|notion board|csv export)\b/i,
    strength: 0.75,
  },
  {
    kind: 'workaround',
    phrase: 'manual process',
    pattern: /\b(?:manual(?:ly)?|by hand|hand[- ]rolled|copy[- ]?pasting?|duct tape|hack(?:ed|y)? it together|zapier chain|hack together)\b/i,
    strength: 0.7,
  },
  {
    kind: 'workaround',
    phrase: 'build my own script',
    pattern: /\b(?:built|wrote|rolled) (?:my|our) own (?:script|tool|bot|sheet|system|solution)\b/i,
    strength: 0.85,
  },
  {
    kind: 'price_complaint',
    phrase: 'too expensive',
    pattern: /\b(?:too expensive|way too (?:much|expensive)|overpriced|pricey|price gouging|insanely expensive|costs? (?:way )?too much|can'?t afford|unaffordable)\b/i,
    strength: 0.95,
  },
  {
    kind: 'price_complaint',
    phrase: 'pricing',
    pattern: /\bpricing (?:is|are|seems|feels)?\s*(?:insane|crazy|absurd|brutal|ridiculous|steep|awful|terrible|terrible)\b/i,
    strength: 0.85,
  },
  {
    kind: 'price_complaint',
    phrase: 'enterprise priced',
    pattern: /\b(?:enterprise[- ]?(?:priced|pricing|only)|per[- ]?seat (?:pricing|cost|fee)| paywall(?:ed|s)?|nickel and dim\w+| got (?:way )?more expensive|raised (?:their )?prices?)\b/i,
    strength: 0.8,
  },
  {
    kind: 'price_complaint',
    phrase: 'cheaper alternative',
    pattern: /\b(?:cheaper|affordable|budget[- ]friendly) (?:alternative|option|tool|plan)\b/i,
    strength: 0.7,
  },
  {
    kind: 'recurring_pain',
    phrase: 'takes forever',
    pattern: /\btakes? (?:forever|hours|days|ages|way too long)\b/i,
    strength: 0.85,
  },
  {
    kind: 'recurring_pain',
    phrase: 'every time / every week',
    pattern: /\bevery (?:single )?(?:time|week|month|day|quarter|sprint|quarter)\b/i,
    strength: 0.75,
  },
  {
    kind: 'recurring_pain',
    phrase: 'over and over',
    pattern: /\b(?:over and over|again and again|keep(?:s)? happening|kept happening|same (?:problem|issue) (?:every|again)|repeatedly|constantly hitting)\b/i,
    strength: 0.8,
  },
  {
    kind: 'recurring_pain',
    phrase: 'tedious / time consuming',
    pattern: /\b(?:tedious|time[- ]?consuming|painful|pain in the (?:ass|neck)|frustrating|drains? (?:my|our) time|waste(?:s|d)? (?:so much )?time|slow(?:est)? part of my (?:day|week|job))\b/i,
    strength: 0.7,
  },
  {
    kind: 'recurring_pain',
    phrase: 'search results are dead',
    pattern: /\b(?:search results? (?:are|were)?\s*(?:often |mostly )?(?:dead|useless|garbage|stale|outdated|seo ?spam)|dead links?)\b/i,
    strength: 0.75,
  },
];

export interface ClassifiedSignal {
  kind: SignalKind;
  strength: number;
  matchedPhrase: string;
}

/**
 * Classifies a single source record. One rule can only fire once per record,
 * so a repeated phrase does not inflate the strength of a signal.
 */
export function classifyText(text: string, platform?: Platform): ClassifiedSignal[] {
  const signals: ClassifiedSignal[] = [];
  const seen = new Set<string>();
  for (const rule of CLASSIFICATION_RULES) {
    const key = `${rule.kind}:${rule.phrase}`;
    if (seen.has(key)) continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    seen.add(key);
    signals.push({
      kind: rule.kind,
      strength: rule.strength,
      matchedPhrase: (match[0] ?? rule.phrase).trim().slice(0, 120),
    });
  }
  if (platform === 'reddit') {
    // Reddit posts are usually longer form and end with an explicit ask; the ask itself is
    // already covered by the rules above, so nothing extra is inferred here.
  }
  return signals;
}

/** Highest intent strength expressed by a set of signals (0..1). */
export function intentStrength(signals: ClassifiedSignal[]): number {
  let best = 0;
  for (const signal of signals) {
    if (signal.kind === 'buying_intent' || signal.kind === 'tool_request') {
      best = Math.max(best, signal.strength);
    }
  }
  return best;
}

export { keyPhrases, slugify, stripIntentPrefix, titleFromText };
