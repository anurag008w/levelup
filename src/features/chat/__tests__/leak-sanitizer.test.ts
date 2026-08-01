import { describe, it, expect } from 'vitest';
import { createStreamSanitizer, sanitizeAssistantLeaks, sanitizeTimestampLeaks, sanitizeToolLeaks } from '../leak-sanitizer';

describe('sanitizeTimestampLeaks', () => {
  it('strips a leading leaked timestamp (mimicked reply header)', () => {
    expect(sanitizeTimestampLeaks('[05:42 PM] aaj ka plan yeh hai')).toBe(' aaj ka plan yeh hai');
  });

  it('strips a lowercase timestamp', () => {
    expect(sanitizeTimestampLeaks('[11:01 am] aapka message')).toBe(' aapka message');
  });

  it('strips a mid-sentence quoted timestamp', () => {
    expect(sanitizeTimestampLeaks('aapne [05:42 PM] bheja tha')).toBe('aapne  bheja tha');
  });

  it('strips a timestamp with seconds', () => {
    expect(sanitizeTimestampLeaks('[05:42:33 PM] kaam')).toBe(' kaam');
  });

  it('strips a plain 24h-style bracket time', () => {
    expect(sanitizeTimestampLeaks('[09:30] revise karo')).toBe(' revise karo');
  });

  it('does not strip plain clock times without brackets', () => {
    const text = 'raat 11:01 PM tak so jao';
    expect(sanitizeTimestampLeaks(text)).toBe(text);
  });

  it('does not strip bracket numbers or non-time brackets', () => {
    expect(sanitizeTimestampLeaks('formula [1] dekho')).toBe('formula [1] dekho');
    expect(sanitizeTimestampLeaks('note [system] keh raha')).toBe('note [system] keh raha');
  });

  it('does not strip hours without a colon', () => {
    expect(sanitizeTimestampLeaks('[10] tasks')).toBe('[10] tasks');
  });

  it('drops a trailing partial timestamp prefix in a final answer', () => {
    expect(sanitizeTimestampLeaks('reply [05:4')).toBe('reply ');
  });
});


describe('sanitizeToolLeaks', () => {
  it('strips raw tool headers and plan-manager function calls', () => {
    const text = `Task add kar diya.

tool: addTask
call_plan_manager_add_tasks(tasks=[{'title':'x'}])

Ab plan clean hai.`;
    expect(sanitizeToolLeaks(text)).toBe(`Task add kar diya.

Ab plan clean hai.`);
  });

  it('strips raw JSON tool actions and batches', () => {
    expect(sanitizeToolLeaks(`{"action":"getPlan","day":1}
Done`)).toBe('Done');
    expect(sanitizeToolLeaks(`{"actions":[{"action":"addTask","day":2,"intent":"x","durationMin":10}]}
Done`)).toBe('Done');
  });

  it('keeps normal student-facing text', () => {
    const text = 'Perfect, Day 1 reset kar diya. Ab fresh start karo.';
    expect(sanitizeToolLeaks(text)).toBe(text);
  });
});

describe('sanitizeAssistantLeaks', () => {
  it('strips timestamps and tool traces together', () => {
    expect(sanitizeAssistantLeaks(`[05:42 PM] Done.
tool: bulkRemoveTasks`)).toBe(' Done.');
  });
});

describe('createStreamSanitizer', () => {
  it('holds back a partial timestamp across deltas and strips it when complete', () => {
    const sani = createStreamSanitizer();
    expect(sani.push('[05:')).toBe('');
    expect(sani.push('42 PM] hi')).toBe(' hi');
  });

  it('flushes non-timestamp text once a partial cannot grow', () => {
    const sani = createStreamSanitizer();
    expect(sani.push('[note] ok')).toBe('[note] ok');
    expect(sani.push(' aur [x')).toBe(' aur [x');
    expect(sani.push('yz] end')).toBe('yz] end');
  });

  it('flush() releases any still-held text at stream end', () => {
    const sani = createStreamSanitizer();
    expect(sani.push('[05:')).toBe('');
    expect(sani.push('42 PM]')).toBe('');
    expect(sani.flush()).toBe('');
  });

  it('handles a timestamp followed by more content across deltas', () => {
    const sani = createStreamSanitizer();
    expect(sani.push('answer: [11:0')).toBe('answer: ');
    expect(sani.push('1 am] done')).toBe(' done');
  });

  it('holds and removes streamed tool traces without leaking partial prefixes', () => {
    const sani = createStreamSanitizer();
    expect(sani.push('Done.\nto')).toBe('Done.\n');
    expect(sani.push('ol: addTask\nSafe')).toBe('Safe');
    expect(sani.flush()).toBe('');
  });

  it('does not hold normal words starting with p', () => {
    const sani = createStreamSanitizer();
    expect(sani.push('Perfect')).toBe('Perfect');
  });
});
