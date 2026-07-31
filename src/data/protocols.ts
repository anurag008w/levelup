// These are NOT tied to a specific level — they run on their own cadence
// throughout all 90 days, independent of which phase content is authored.

export interface ProtocolItem {
  id: string;
  text: string;
}

export const MOCK_TEST_PROTOCOL: ProtocolItem[] = [
  { id: 'mock_1', text: 'Full-syllabus mock test complete kiya (exact JEE timing follow ki)' },
  { id: 'mock_2', text: 'Mock ke turant baad OMR/answers ka rough self-check kiya (same din)' },
  { id: 'mock_3', text: 'Har galat question Mistake Log mein daala (concept gap / silly / time pressure)' },
  { id: 'mock_4', text: 'Section-wise time-spent breakdown likha (Physics/Chem/Maths kitna time liya)' },
  { id: 'mock_5', text: 'Top 3 improvement actions agle week ke liye likhe' },
];

export const EXAM_MONTH_PROTOCOL: ProtocolItem[] = [
  { id: 'exam_1', text: 'Aaj koi NAYA topic nahi — sirf revision aur practice' },
  { id: 'exam_2', text: 'Formula sheet / short notes revise kiye (20-30 min)' },
  { id: 'exam_3', text: 'Mistake Log ke top repeated errors dobara padhe' },
  { id: 'exam_4', text: 'Ek timed practice set solve kiya (exam-pressure simulate)' },
  { id: 'exam_5', text: 'Sleep 7+ hours ka target — koi late-night cramming nahi' },
  { id: 'exam_6', text: 'Admit card / stationery / ID check (agar exam week hai)' },
];
