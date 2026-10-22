import { describe, expect, it } from 'vitest';
import { addPending, deriveState, newRecord, questionAnswerInput, questionsOf, toTile } from '../src/core/session';
import { permissionOutput } from '../src/core/protocol';

const input = {
  questions: [
    {
      question: 'Which color do you prefer?',
      header: 'Color',
      options: [
        { label: 'Red', description: 'Choose red' },
        { label: 'Blue', description: 'Choose blue' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which sections?',
      header: 'Sections',
      options: [
        { label: 'Intro', description: '' },
        { label: 'Outro', description: '' },
      ],
      multiSelect: true,
    },
  ],
};

describe('AskUserQuestion', () => {
  it('parses the questions of the tool input', () => {
    expect(questionsOf(input).map((q) => [q.question, q.multiSelect, q.options.map((o) => o.label)])).toEqual([
      ['Which color do you prefer?', false, ['Red', 'Blue']],
      ['Which sections?', true, ['Intro', 'Outro']],
    ]);
    expect(questionsOf({ questions: 'nope' })).toEqual([]);
    expect(questionsOf(null)).toEqual([]);
  });

  it('builds the answered input only when every question has an answer', () => {
    const answers = { 'Which color do you prefer?': 'Blue', 'Which sections?': 'Intro, Outro' };
    expect(questionAnswerInput('AskUserQuestion', input, answers)).toEqual({ ...input, answers });
    expect(questionAnswerInput('AskUserQuestion', input, { 'Which color do you prefer?': 'Blue' })).toBeNull();
    expect(questionAnswerInput('AskUserQuestion', input, { ...answers, 'Which sections?': '  ' })).toBeNull();
    expect(questionAnswerInput('AskUserQuestion', input, { ...answers, Extra: 'x' })).toBeNull();
    expect(questionAnswerInput('Bash', input, answers)).toBeNull();
  });

  it('shows a held question as needsInput with the question text and the parsed questions', () => {
    const rec = newRecord('s', '/x', 1);
    addPending(rec, 'q1', { session_id: 's', tool_name: 'AskUserQuestion', tool_input: input }, 5);
    expect(deriveState(rec)).toMatchObject({ state: 'needsInput', label: 'question', activity: { kind: 'text', text: 'Which color do you prefer?' } });
    const tile = toTile(rec, { rename: null, pinned: false, branch: null });
    expect(tile.pending?.questions?.length).toBe(2);
  });

  it('returns the answers to Claude Code as updatedInput', () => {
    const updated = { ...input, answers: { 'Which color do you prefer?': 'Blue' } };
    expect(JSON.parse(permissionOutput('allow', { updatedInput: updated }))).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: updated } },
    });
  });
});
