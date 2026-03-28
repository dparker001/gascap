import fs   from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'push-subscriptions.json');

export interface PushSub {
  userId:   string;
  endpoint: string;
  keys:     { p256dh: string; auth: string };
  createdAt: string;
}

function read(): PushSub[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) as PushSub[]; }
  catch { return []; }
}

function write(data: PushSub[]) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function saveSub(userId: string, sub: PushSubscriptionJSON): void {
  const all = read().filter((s) => s.userId !== userId || s.endpoint !== sub.endpoint);
  all.push({
    userId,
    endpoint:  sub.endpoint!,
    keys:      sub.keys as { p256dh: string; auth: string },
    createdAt: new Date().toISOString(),
  });
  write(all);
}

export function removeSub(userId: string): void {
  write(read().filter((s) => s.userId !== userId));
}

export function getSubs(userId: string): PushSub[] {
  return read().filter((s) => s.userId === userId);
}

export function getAllSubs(): PushSub[] {
  return read();
}
