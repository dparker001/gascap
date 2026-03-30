import fs   from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'feedback.json');

export interface FeedbackItem {
  id:        string;
  name:      string;
  email:     string;
  message:   string;
  page:      string;
  createdAt: string;
  read:      boolean;
}

function read(): FeedbackItem[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) as FeedbackItem[]; }
  catch { return []; }
}

function write(data: FeedbackItem[]) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function saveFeedback(item: Omit<FeedbackItem, 'id' | 'createdAt' | 'read'>): FeedbackItem {
  const all = read();
  const entry: FeedbackItem = {
    ...item,
    id:        `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    read:      false,
  };
  all.unshift(entry); // newest first
  write(all);
  return entry;
}

export function getAllFeedback(): FeedbackItem[] {
  return read();
}

export function markRead(id: string): void {
  const all = read();
  const item = all.find((f) => f.id === id);
  if (item) { item.read = true; write(all); }
}

export function deleteFeedback(id: string): void {
  write(read().filter((f) => f.id !== id));
}
