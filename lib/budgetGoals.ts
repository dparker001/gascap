import fs   from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'budget-goals.json');

export interface BudgetGoal {
  userId:       string;
  monthlyLimit: number;   // dollars
  updatedAt:    string;   // ISO
}

function read(): BudgetGoal[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as BudgetGoal[];
  } catch {
    return [];
  }
}

function write(data: BudgetGoal[]): void {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getBudgetGoal(userId: string): BudgetGoal | null {
  return read().find((g) => g.userId === userId) ?? null;
}

export function setBudgetGoal(userId: string, monthlyLimit: number): BudgetGoal {
  const all  = read();
  const idx  = all.findIndex((g) => g.userId === userId);
  const goal: BudgetGoal = { userId, monthlyLimit, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = goal; else all.push(goal);
  write(all);
  return goal;
}

export function deleteBudgetGoal(userId: string): void {
  write(read().filter((g) => g.userId !== userId));
}
