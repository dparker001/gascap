/**
 * Gas Price Prophet — prediction game data store and logic.
 * Predictions are stored in data/predictions.json.
 */
import fs   from 'fs';
import path from 'path';

export type PredictionChoice  = 'up' | 'down' | 'flat';
export type PredictionOutcome = 'correct' | 'incorrect' | 'pending';

export interface Prediction {
  id:            string;
  userId:        string;
  userName:      string;
  weekStart:     string;           // 'YYYY-MM-DD' — Monday of the prediction week
  prediction:    PredictionChoice;
  basePrice:     number;           // EIA national avg at time of prediction
  resolvedPrice?: number;          // EIA national avg when resolved
  outcome?:      PredictionOutcome;
  pointsAwarded?: number;
  streakAtResolve?: number;        // consecutive correct predictions at resolution time
  createdAt:     string;
  resolvedAt?:   string;
}

export interface ProphetStats {
  userId:             string;
  userName:           string;
  totalScore:         number;
  streak:             number;   // current consecutive-correct streak
  totalPredictions:   number;
  correctPredictions: number;
  rank?:              number;
}

// ── Persistence ────────────────────────────────────────────────────────────

const DATA_FILE = path.join(process.cwd(), 'data', 'predictions.json');

function readAll(): Prediction[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Prediction[];
  } catch { return []; }
}

function writeAll(rows: Prediction[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

// ── Week helpers ────────────────────────────────────────────────────────────

/** Returns the Monday of the week containing `date` as 'YYYY-MM-DD'. */
export function getWeekStart(date = new Date()): string {
  const d   = new Date(date);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Returns the Monday of last week as 'YYYY-MM-DD'. */
export function getPrevWeekStart(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/** Returns the next Monday as 'YYYY-MM-DD'. */
export function getNextWeekStart(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function scoreForStreak(streak: number): number {
  if (streak >= 4) return 25;   // hot streak bonus
  if (streak === 3) return 20;
  if (streak === 2) return 15;
  return 10;
}

// ── User-scoped streak helper ───────────────────────────────────────────────

function calcUserStreak(predictions: Prediction[], userId: string): number {
  const resolved = predictions
    .filter((p) => p.userId === userId && p.outcome && p.outcome !== 'pending')
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  let streak = 0;
  for (const p of resolved) {
    if (p.outcome === 'correct') streak++;
    else break;
  }
  return streak;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getUserPrediction(userId: string, weekStart: string): Prediction | undefined {
  return readAll().find((p) => p.userId === userId && p.weekStart === weekStart);
}

export function submitPrediction(
  userId:     string,
  userName:   string,
  weekStart:  string,
  prediction: PredictionChoice,
  basePrice:  number,
): Prediction {
  const all      = readAll();
  const existing = all.find((p) => p.userId === userId && p.weekStart === weekStart);
  if (existing) return existing;   // already submitted this week

  const record: Prediction = {
    id:         crypto.randomUUID(),
    userId,
    userName,
    weekStart,
    prediction,
    basePrice,
    outcome:    'pending',
    createdAt:  new Date().toISOString(),
  };
  all.push(record);
  writeAll(all);
  return record;
}

/**
 * Resolve all predictions from `weekStart` using `currentPrice`.
 * Called lazily when users open the game the following week.
 * Returns the number of predictions resolved.
 */
export function resolvePredictions(weekStart: string, currentPrice: number): number {
  const all       = readAll();
  const THRESHOLD = 0.03;
  let   resolved  = 0;

  for (const p of all) {
    if (p.weekStart !== weekStart) continue;
    if (p.outcome && p.outcome !== 'pending') continue;

    const diff   = currentPrice - p.basePrice;
    const actual: PredictionChoice =
      diff >  THRESHOLD ? 'up'   :
      diff < -THRESHOLD ? 'down' : 'flat';

    p.outcome       = p.prediction === actual ? 'correct' : 'incorrect';
    p.resolvedPrice = currentPrice;
    p.resolvedAt    = new Date().toISOString();

    if (p.outcome === 'correct') {
      // Calculate streak at resolve time (includes this prediction)
      const streak        = calcUserStreak(all, p.userId) + 1;
      p.streakAtResolve   = streak;
      p.pointsAwarded     = scoreForStreak(streak);
    } else {
      p.streakAtResolve = 0;
      p.pointsAwarded   = 0;
    }
    resolved++;
  }

  if (resolved > 0) writeAll(all);
  return resolved;
}

export function getUserStats(userId: string): ProphetStats | null {
  const all      = readAll();
  const resolved = all.filter((p) => p.userId === userId && p.outcome && p.outcome !== 'pending');
  if (resolved.length === 0) return null;

  const totalScore         = resolved.reduce((s, p) => s + (p.pointsAwarded ?? 0), 0);
  const correctPredictions = resolved.filter((p) => p.outcome === 'correct').length;
  const streak             = calcUserStreak(all, userId);

  return {
    userId,
    userName:           resolved[0].userName,
    totalScore,
    streak,
    totalPredictions:   resolved.length,
    correctPredictions,
  };
}

export function getLeaderboard(limit = 10): ProphetStats[] {
  const all = readAll();

  // Gather all userIds with resolved predictions
  const userIds = Array.from(new Set(
    all.filter((p) => p.outcome && p.outcome !== 'pending').map((p) => p.userId),
  ));

  const board: ProphetStats[] = userIds.map((uid) => {
    const resolved  = all.filter((p) => p.userId === uid && p.outcome && p.outcome !== 'pending');
    const totalScore = resolved.reduce((s, p) => s + (p.pointsAwarded ?? 0), 0);
    const correct    = resolved.filter((p) => p.outcome === 'correct').length;
    const streak     = calcUserStreak(all, uid);
    return {
      userId:             uid,
      userName:           resolved[resolved.length - 1]?.userName ?? uid,
      totalScore,
      streak,
      totalPredictions:   resolved.length,
      correctPredictions: correct,
    };
  });

  return board
    .sort((a, b) => b.totalScore - a.totalScore || b.streak - a.streak)
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

export function getAllPredictions(): Prediction[] {
  return readAll();
}
