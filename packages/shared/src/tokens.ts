/**
 * Deterministic text normalisation used for classification, grouping and phrase weights.
 *
 * The helpers are deliberately dependency free and pure so the API, the web app and the
 * tests all derive exactly the same keys from the same text.
 */

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'anyone',
  'anybody', 'are', 'aren', 'as', 'at', 'away', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does',
  'doesn', 'doing', 'don', 'down', 'during', 'each', 'ever', 'every', 'few', 'for', 'from',
  'further', 'get', 'gets', 'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'it', 'its', 'itself', 'just',
  'know', 'knows', 'like', 'literally', 'll', 'me', 'more', 'most', 'much', 'my', 'myself',
  'need', 'needs', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'one', 'only', 'or',
  'other', 'ought', 'our', 'ours', 'out', 'over', 'own', 'really', 're', 's', 'same', 'she',
  'should', 'so', 'some', 'someone', 'something', 'still', 'such', 'sure', 't', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'us', 've', 'very', 'want', 'wants', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'wish', 'wishes', 'with', 'would', 'you', 'your', 'yours', 'yourself',
]);

/** Sentences that carry intent but carry no topical meaning. */
const INTENT_PREFIXES = [
  /^\s*i\s+wish\s+there\s+(?:was|were)\s+/i,
  /^\s*i\s+wish\s+/i,
  /^\s*(?:is|are)\s+there\s+(?:a|an|any|some)\s+/i,
  /^\s*does\s+any(?:one|body)\s+(?:have|know\s+of)\s+(?:a|an|any)\s+/i,
  /^\s*anyone\s+(?:have|know\s+of)\s+(?:a|an|any)\s+/i,
  /^\s*does\s+anyone\s+(?:have|know)\s+/i,
  /^\s*any\s+(?:good\s+)?(?:recommendations\s+for\s+)?/i,
  /^\s*how\s+do\s+(?:you|i|we)\s+/i,
  /^\s*looking\s+for\s+(?:a|an|any)\s+/i,
  /^\s*i\s+(?:need|want)\s+(?:a|an|any)\s+/i,
  /^\s*i'?d\s+pay\s+for\s+(?:a|an|any)\s+/i,
];

/**
 * Very small synonym map. It merges words that describe the same *kind* of demanded thing
 * so that "an app that ..." and "software that ..." can land in the same need.
 */
const SYNONYMS: Record<string, string> = {
  app: 'software',
  apps: 'software',
  tool: 'software',
  tools: 'software',
  saas: 'software',
  platform: 'software',
  solution: 'software',
  service: 'software',
  programme: 'program',
};

export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, ' ').replace(/\bwww\.\S+/g, ' ');
}

/** Removes the leading "I wish there was ..." style clause, keeping the demanded object. */
export function stripIntentPrefix(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 3; i += 1) {
    const before = out;
    for (const pattern of INTENT_PREFIXES) {
      const next = out.replace(pattern, '');
      if (next !== out) {
        out = next.charAt(0).toUpperCase() + next.slice(1);
        break;
      }
    }
    if (out === before) break;
  }
  return out.trim();
}

function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ation')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ers')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    return w.slice(0, -1);
  }
  return w;
}

export function tokenize(text: string): string[] {
  const cleaned = stripUrls(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ');
  return cleaned
    .split(/\s+/)
    .filter((token) => token.length > 2 && token.length < 24)
    .filter((token) => !STOPWORDS.has(token))
    .map(stem)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map((token) => SYNONYMS[token] ?? token);
}

/** Tokens that describe *what* the person wants (intent prefixes removed). */
export function topicTokens(text: string): string[] {
  return tokenize(stripIntentPrefix(text));
}

export function uniqueTokens(text: string): string[] {
  return Array.from(new Set(topicTokens(text)));
}

/** Frequency-ranked tokens, used as the "phrases" that feedback can up or down weight. */
export function keyPhrases(text: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const token of topicTokens(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

/** Builds a human readable title for a need from its representative source text. */
export function titleFromText(text: string, maxChars = 110): string {
  const stripped = stripIntentPrefix(stripUrls(text)).replace(/\s+/g, ' ').trim();
  const sentence = stripped.split(/(?<=[.!?])\s+/)[0] ?? stripped;
  let title = sentence.replace(/[.!?]+$/, '').trim();
  if (!title) title = text.replace(/\s+/g, ' ').trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length <= maxChars) return title;
  const clipped = title.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/** Builds a stable slug used as the natural key of a need. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
