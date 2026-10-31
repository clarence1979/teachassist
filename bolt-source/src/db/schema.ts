import Dexie, { type Table } from 'dexie';

// ─── Entity types ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  provider?: 'anthropic' | 'openai';
  model?: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mediaType: string;
  data: string;
  size: number;
}

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: MessageRole;
  content: string;
  attachments?: MessageAttachment[];
  toolCalls?: ToolInvocation[];
  createdAt: number;
  editedFromId?: string;
  isActive: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  provider?: 'anthropic' | 'openai';
  model?: string;
  /** Artifact IDs generated/attached in this message */
  artifactIds?: string[];
}

export interface ScheduledBlock {
  startISO: string;
  endISO: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  deadline?: number; // epoch ms
  estimatedDurationMin: number;
  priority: 1 | 2 | 3 | 4 | 5; // 1=highest
  tags: string[];
  status: 'inbox' | 'scheduled' | 'in-progress' | 'done';
  scheduledBlocks: ScheduledBlock[];
  source: 'manual' | 'ai-suggested' | 'imported';
  recurrence?: string; // RRULE string
  aiRationale?: string; // tooltip from re-prioritise
  createdAt: number;
  updatedAt: number;
}

export type BlockType = 'class' | 'prep' | 'meeting' | 'duty' | 'pd' | 'personal' | 'custom';

export interface TimetableBlock {
  id: string;
  title: string;
  type: BlockType;
  /** For personal/custom — free-form sub-label (e.g. "meal", "sleep", "exercise") */
  subtype?: string;
  /** Custom color for 'custom' type blocks */
  color?: string;
  notes?: string;
  location?: string;
  startISO: string;
  endISO: string;
  /** RRULE string (without DTSTART prefix) */
  recurrence?: string;
  /** Root series id — set on all instances of a recurring block */
  seriesId?: string;
  /** ISO date strings to skip (for edit-single overrides) */
  exdates?: string[];
  /** Override single occurrence — pointer to the original series and the original instance date */
  overrideOfSeries?: string;
  overrideInstanceDate?: string;
  artifactIds?: string[];
  /** Linked Task.id if this block came from scheduling a task */
  taskId?: string;
  status?: 'scheduled' | 'done' | 'cancelled';
  /** Was this block a ghost AI proposal the user accepted? */
  source?: 'manual' | 'ai' | 'imported';
  /** Minutes before start to fire a reminder notification (undefined = no reminder) */
  reminderOffsetMin?: number;
  /** Public share id (slug into shared_blocks supabase table) if the block has been shared */
  shareId?: string;
  createdAt: number;
}

export interface Artifact {
  id: string;
  conversationId?: string;
  type: 'slides' | 'pdf' | 'worksheet' | 'notes' | 'quiz' | 'rubric' | 'image' | 'lesson_plan' | 'infographic';
  title: string;
  data: string;
  mediaType: string;
  meta: Record<string, unknown>;
  createdAt: number;
  /** Version group — all versions of the same artifact share this id */
  groupId?: string;
  /** Version number starting at 1 */
  version?: number;
  /** Tags for search */
  tags?: string[];
}

export interface Preference {
  key: string;
  value: unknown;
}

export interface SchoolCalendarEntry {
  id: string;
  label: string;
  startISO: string;
  endISO: string;
  type: 'term' | 'holiday' | 'pupil_free' | 'event';
}

// ─── Database class ───────────────────────────────────────────────────────────

export class PedagogyDB extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  tasks!: Table<Task, string>;
  timetableBlocks!: Table<TimetableBlock, string>;
  artifacts!: Table<Artifact, string>;
  preferences!: Table<Preference, string>;
  schoolCalendar!: Table<SchoolCalendarEntry, string>;

  constructor(namespace: string) {
    super(`pedagogy_${namespace}`);
    this.version(1).stores({
      conversations: 'id, updatedAt, pinned',
      messages: 'id, conversationId, parentId, createdAt, isActive',
      tasks: 'id, status, deadline, priority, createdAt',
      timetableBlocks: 'id, startISO, endISO, type',
      artifacts: 'id, type, conversationId, createdAt',
      preferences: 'key',
      schoolCalendar: 'id, startISO, type',
    });
    // v2 adds groupId, version, tags indexes
    this.version(2).stores({
      artifacts: 'id, type, conversationId, createdAt, groupId',
    });
    // v3 updates tasks to richer model
    this.version(3).stores({
      tasks: 'id, status, deadline, priority, createdAt, source',
    });
    // v4 adds seriesId index on timetableBlocks
    this.version(4).stores({
      timetableBlocks: 'id, startISO, endISO, type, seriesId, taskId',
    });
  }
}

// ─── Namespace-scoped singleton ──────────────────────────────────────────────

let currentDb: PedagogyDB | null = null;
let currentNamespace = '';

export function getDb(namespace: string): PedagogyDB {
  if (currentDb && currentNamespace === namespace) return currentDb;
  if (currentDb) currentDb.close();
  currentDb = new PedagogyDB(namespace);
  currentNamespace = namespace;
  return currentDb;
}
