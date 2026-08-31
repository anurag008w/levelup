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

  it('strips raw planner-tool JSON from assistant replies', () => {
    expect(sanitizeToolLeaks(`{"action":"getTests","from":"2026-08-06","to":"2026-08-06"}
Kal koi test nahi hai.`)).toBe('Kal koi test nahi hai.');
    expect(sanitizeToolLeaks(`{"action":"getRoutine","day":"Friday"}
Friday: 04:00 Physics.`)).toBe('Friday: 04:00 Physics.');
    expect(sanitizeToolLeaks(`{"action":"getSubject","subject":"Physics","from":"2026-07-01"}
Physics ke items.`)).toBe('Physics ke items.');
    expect(sanitizeToolLeaks(`{"action":"getContext"}
Journey Day 30.`)).toBe('Journey Day 30.');
  });

  it('strips Python-style tool calls that leak into assistant replies', () => {
    expect(
      sanitizeToolLeaks(
        `print(removeTask(task_id="d1_t3", day_id="Day 1"))
print(removeTask(task_id="d1_t4", day_id="Day 1"))
✅ Har study block ke baad 2-min active recall aur Likho: Kya complete hua? — yeh dono tasks hata diye.`,
      ),
    ).toBe('✅ Har study block ke baad 2-min active recall aur Likho: Kya complete hua? — yeh dono tasks hata diye.');
    expect(sanitizeToolLeaks('print(removeTask(day=1, task_id="d1_t3"))')).toBe('');
    expect(sanitizeToolLeaks('removeTask(day=1, task_id="d1_t3")\nHo gaya.')).toBe('Ho gaya.');
    expect(
      sanitizeToolLeaks('```python\nprint(removeTask(task_id="d1_t3", day_id="Day 1"))\n```\nDone.'),
    ).toBe('Done.');
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

  it('strips raw control tokens like < | begin__of__sentence | > and <|begin_of_sentence|>', () => {
    expect(sanitizeAssistantLeaks('< | begin__of__sentence | >Haan bolo, kya help chahiye?')).toBe('Haan bolo, kya help chahiye?');
    expect(sanitizeAssistantLeaks('<|begin_of_sentence|>Theek hai kar diya.<|end_of_sentence|>')).toBe('Theek hai kar diya.');
    expect(sanitizeAssistantLeaks('<|im_start|>assistant\nKaam ho gaya.<|im_end|>')).toBe('Kaam ho gaya.');
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
