/**
 * Maintenance Reminders — server-only JSON file store.
 * Types/presets are in lib/maintenance-shared.ts (client-safe).
 */
import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type {
  ServiceType,
  MaintenanceReminder,
  ReminderStatus,
  ReminderWithStatus,
} from './maintenance-shared';
export { SERVICE_PRESETS } from './maintenance-shared';

import type { MaintenanceReminder, ReminderWithStatus } from './maintenance-shared';

const FILE = path.join(process.cwd(), 'data', 'maintenance-reminders.json');

function read(): MaintenanceReminder[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as MaintenanceReminder[];
  } catch {
    return [];
  }
}

function write(data: MaintenanceReminder[]): void {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getReminders(userId: string): MaintenanceReminder[] {
  return read().filter((r) => r.userId === userId);
}

export function addReminder(
  userId: string,
  data: Omit<MaintenanceReminder, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
): MaintenanceReminder {
  const all = read();
  const now = new Date().toISOString();
  const entry: MaintenanceReminder = {
    ...data,
    id:        randomUUID(),
    userId,
    createdAt: now,
    updatedAt: now,
  };
  all.push(entry);
  write(all);
  return entry;
}

export function updateReminder(
  userId: string,
  reminderId: string,
  updates: Partial<Omit<MaintenanceReminder, 'id' | 'userId' | 'createdAt'>>,
): MaintenanceReminder | null {
  const all = read();
  const idx = all.findIndex((r) => r.id === reminderId && r.userId === userId);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
  write(all);
  return all[idx];
}

export function deleteReminder(userId: string, reminderId: string): boolean {
  const all  = read();
  const next = all.filter((r) => !(r.id === reminderId && r.userId === userId));
  if (next.length === all.length) return false;
  write(next);
  return true;
}

/**
 * Compute status for a reminder given current odometer and today's date.
 * Due-soon threshold: within 500 miles OR within 30 days.
 */
export function computeStatus(
  reminder: MaintenanceReminder,
  currentMiles?: number,
): ReminderWithStatus {
  const today = new Date();
  let status: import('./maintenance-shared').ReminderStatus = 'unknown';
  let milesUntilDue: number | undefined;
  let daysUntilDue:  number | undefined;
  let dueMiles:      number | undefined;
  let dueDate:       string | undefined;

  if (reminder.intervalMiles && reminder.lastServiceMiles != null && currentMiles != null) {
    dueMiles      = reminder.lastServiceMiles + reminder.intervalMiles;
    milesUntilDue = dueMiles - currentMiles;
    if (milesUntilDue <= 0)         status = 'overdue';
    else if (milesUntilDue <= 500)  status = 'due_soon';
    else                             status = 'ok';
  }

  if (reminder.intervalMonths && reminder.lastServiceDate) {
    const lastDate = new Date(reminder.lastServiceDate + 'T12:00:00');
    const due      = new Date(lastDate);
    due.setMonth(due.getMonth() + reminder.intervalMonths);
    dueDate        = due.toISOString().split('T')[0];
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    daysUntilDue   = diffDays;

    const dateStatus: import('./maintenance-shared').ReminderStatus =
      diffDays <= 0 ? 'overdue' : diffDays <= 30 ? 'due_soon' : 'ok';

    if (status === 'unknown' || dateStatus === 'overdue' ||
        (dateStatus === 'due_soon' && status === 'ok')) {
      status = dateStatus;
    }
  }

  return { ...reminder, status, milesUntilDue, daysUntilDue, dueMiles, dueDate };
}
