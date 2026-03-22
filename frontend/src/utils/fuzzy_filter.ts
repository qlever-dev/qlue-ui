/** Split a query string into validated RegExp patterns, discarding empty/invalid tokens. */
export function parseKeywords(query: string): RegExp[] {
  return query
    .trim()
    .split(' ')
    .filter((keyword) => {
      if (keyword === '') return false;
      try {
        new RegExp(keyword);
      } catch (error) {
        if (error instanceof SyntaxError) return false;
        throw error;
      }
      return true;
    })
    .map((word) => new RegExp(word, 'gi'));
}

/** Returns true when every keyword matches somewhere in `text`. */
export function matchesAllKeywords(text: string, keywords: RegExp[]): boolean {
  return keywords.every((keyword) => text.match(keyword) != null);
}

/**
 * Wraps matching substrings with `<span class="...">` tags, merging overlapping ranges.
 *
 * Algorithm:
 * 1. Collect all match ranges from every regex.
 * 2. Sort and merge overlapping ranges.
 * 3. Replace from right-to-left so indices stay valid.
 */
export function highlightMatches(text: string, keywords: RegExp[], classes: string[]): string {
  let result = text;
  let sections: number[][] = [];

  for (const regexp of keywords) {
    for (const match of text.matchAll(regexp)) {
      sections.push([match.index, match.index + match[0].length]);
    }
  }

  if (sections.length === 0) return result;

  // Sort by start position, then merge overlapping
  sections.sort((a, b) => a[0] - b[0]);
  sections = sections.reduce(
    (accu, elem) => {
      const [last, ...rest] = accu;
      if (elem[0] <= last[1]) {
        return [[last[0], Math.max(elem[1], last[1])], ...rest];
      }
      return [elem].concat(accu);
    },
    [sections[0]]
  );

  const cls = classes.join(' ');
  sections.forEach(([from, to]) => {
    result = `${result.substring(0, from)}<span class="${cls}">${result.substring(from, to)}</span>${result.substring(to)}`;
  });

  return result;
}
