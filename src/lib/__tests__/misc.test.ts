import { describe, it, expect } from 'vitest';
import { phaseAccent } from '../phaseColors';
import { verifyAdmin } from '../admin';
import { MOCK_TEST_PROTOCOL, EXAM_MONTH_PROTOCOL } from '../../data/protocols';

describe('phaseColors', () => {
  it('maps every phase color to a CSS variable', () => {
    expect(phaseAccent('l')).toBe('var(--color-l)');
    expect(phaseAccent('light')).toBe('var(--color-light)');
    expect(phaseAccent('peak')).toBe('var(--color-peak)');
    expect(phaseAccent('core')).toBe('var(--color-success)');
  });
});

describe('admin credentials gate', () => {
  it('accepts the correct username/password (case-insensitive username)', () => {
    expect(verifyAdmin('anurag008_w', 'admin2008')).toBe(true);
    expect(verifyAdmin('  ANURAG008_W  ', 'admin2008')).toBe(true);
  });

  it('rejects wrong credentials', () => {
    expect(verifyAdmin('anurag008_w', 'wrong')).toBe(false);
    expect(verifyAdmin('hacker', 'admin2008')).toBe(false);
    expect(verifyAdmin('', '')).toBe(false);
  });
});

describe('protocol data integrity', () => {
  it('mock test protocol items are unique and non-empty', () => {
    const ids = MOCK_TEST_PROTOCOL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MOCK_TEST_PROTOCOL.length).toBe(5);
    expect(MOCK_TEST_PROTOCOL.every((p) => p.id && p.text.length > 0)).toBe(true);
  });

  it('exam month protocol items are unique and non-empty', () => {
    const ids = EXAM_MONTH_PROTOCOL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EXAM_MONTH_PROTOCOL.length).toBe(6);
    expect(EXAM_MONTH_PROTOCOL.every((p) => p.id && p.text.length > 0)).toBe(true);
  });
});
