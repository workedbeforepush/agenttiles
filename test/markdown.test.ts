import { describe, expect, it } from 'vitest';
import { promptText } from '../src/core/transcript';
import { markdownHtml } from '../src/renderer/src/markdown';

describe('prompt text', () => {
  it('shows slash and bash commands as typed', () => {
    expect(promptText('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>')).toBe('/compact');
    expect(promptText('<command-name>/model</command-name><command-args>opus</command-args>')).toBe('/model opus');
    expect(promptText('<bash-input>git status</bash-input>')).toBe('! git status');
  });

  it('drops CLI output, reminders and notifications', () => {
    expect(promptText('<local-command-caveat>Caveat: …</local-command-caveat>')).toBeNull();
    expect(promptText('<local-command-stdout>Compacted</local-command-stdout>')).toBeNull();
    expect(promptText('<task-notification>\n<status>completed</status>\n</task-notification>')).toBeNull();
    expect(promptText('<system-reminder>x</system-reminder>fix the bug')).toBe('fix the bug');
  });
});

describe('markdown html', () => {
  it('renders the subset and escapes everything else', () => {
    expect(markdownHtml('**Done** with `a<b>`')).toBe('<strong>Done</strong> with <code>a&lt;b&gt;</code>');
    expect(markdownHtml('## Plan\n- one\n- *two*')).toBe('<strong>Plan</strong>\n• one\n• <em>two</em>');
    expect(markdownHtml('see [docs](https://x.y)')).toBe('see docs');
    expect(markdownHtml('```ts\nlet a = 1;\n```')).toBe('<pre>let a = 1;</pre>');
    expect(markdownHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('drops markers left open by clipping', () => {
    expect(markdownHtml('cut **in the mid…')).toBe('cut in the mid…');
    expect(markdownHtml('see **** here')).toBe('see **** here');
  });
});
