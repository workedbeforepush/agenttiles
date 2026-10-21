// Facts about a past session from the start and the end of its transcript, for "resume" and "new session".

export interface SessionHead {
  cwd: string;
  /** "cli" for interactive sessions; print mode and SDK runs use other values. */
  entrypoint: string | null;
}

export interface SessionTail {
  title: string | null;
  lastPrompt: string | null;
}

function lines(text: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === 'object') result.push(value as Record<string, unknown>);
    } catch {
      // cut at the read boundary
    }
  }
  return result;
}

/** The first entry that names the working directory. */
export function parseSessionHead(text: string): SessionHead | null {
  for (const entry of lines(text)) {
    if (typeof entry['cwd'] === 'string' && entry['cwd'].length > 0) {
      return { cwd: entry['cwd'], entrypoint: typeof entry['entrypoint'] === 'string' ? entry['entrypoint'] : null };
    }
  }
  return null;
}

/** The latest title and prompt in the end of a transcript. */
export function parseSessionTail(text: string): SessionTail {
  const tail: SessionTail = { title: null, lastPrompt: null };
  for (const entry of lines(text)) {
    if (entry['type'] === 'ai-title' && typeof entry['aiTitle'] === 'string') tail.title = entry['aiTitle'];
    if (entry['type'] === 'last-prompt' && typeof entry['lastPrompt'] === 'string') tail.lastPrompt = entry['lastPrompt'];
  }
  return tail;
}
