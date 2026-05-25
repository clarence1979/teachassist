import type { ToolDefinition } from './types';

// ─── Shared parameter fragments ───────────────────────────────────────────────

const yearLevel = {
  type: 'string',
  description: 'Australian curriculum year level, e.g. "Year 8" or "Year 10"',
};

const topic = {
  type: 'string',
  description: 'Subject/topic for the resource',
};

const questionTypes = {
  type: 'array',
  items: {
    type: 'string',
    enum: ['multiple_choice', 'short_answer', 'extended_response', 'true_false', 'matching'],
  },
  description: 'Question format types to include',
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const PEDAGOGY_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_slides',
    description:
      'Generate a PowerPoint presentation (.pptx) on the given topic for the specified year level.',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        slideCount: {
          type: 'number',
          description: 'Number of slides to generate (default 12)',
        },
        objectives: {
          type: 'array',
          items: { type: 'string' },
          description: 'Learning objectives to cover',
        },
      },
      required: ['topic', 'yearLevel'],
    },
  },

  {
    name: 'generate_pdf_document',
    description: 'Generate a structured PDF document (lesson plan, notes, etc.).',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        type: {
          type: 'string',
          enum: ['lesson_plan', 'notes', 'fact_sheet', 'reading', 'report'],
          description: 'Type of document',
        },
        length: {
          type: 'string',
          enum: ['short', 'medium', 'long'],
          description: 'Approximate document length',
        },
      },
      required: ['topic', 'yearLevel', 'type'],
    },
  },

  {
    name: 'generate_worksheet',
    description:
      'Generate a printable worksheet as PDF + DOCX + interactive HTML with optional answer key.',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        questionTypes,
        difficultyLevels: {
          type: 'array',
          items: { type: 'string', enum: ['foundation', 'standard', 'extension'] },
        },
        count: { type: 'number', description: 'Total number of questions' },
        includeAnswerKey: { type: 'boolean' },
      },
      required: ['topic', 'yearLevel'],
    },
  },

  {
    name: 'generate_student_notes',
    description:
      'Generate student-facing notes in Markdown, PDF, and DOCX formats.',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        depth: {
          type: 'string',
          enum: ['summary', 'standard', 'detailed'],
          description: 'Level of depth/detail',
        },
      },
      required: ['topic', 'yearLevel'],
    },
  },

  {
    name: 'generate_quiz',
    description: 'Generate a quiz as PDF and interactive HTML.',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        questionTypes,
        count: { type: 'number', description: 'Number of questions' },
      },
      required: ['topic', 'yearLevel'],
    },
  },

  {
    name: 'generate_rubric',
    description:
      'Generate an assessment rubric as PDF and DOCX.',
    parameters: {
      type: 'object',
      properties: {
        assessmentTitle: { type: 'string', description: 'Title of the assessment task' },
        criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Assessment criteria (e.g. "Communication", "Analysis")',
        },
        levels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Achievement levels (e.g. ["A", "B", "C", "D", "E"])',
        },
      },
      required: ['assessmentTitle', 'criteria'],
    },
  },

  {
    name: 'generate_image',
    description:
      'Generate an EDUCATIONAL illustration via the OpenAI image API. By default outputs a labelled, step-by-step diagram/infographic designed to teach a concept — not a decorative stock photo. Prefer this for process explanations, worked examples, comparisons, and anatomy/structure diagrams.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Concrete description of what the image should SHOW, including any labels, numbered steps, or comparisons to include. Be specific: "Numbered 4-step diagram of the box method converting binary 1011 to decimal, showing place values 8,4,2,1 above each bit, with running decimal sum on the right." — not vague phrases like "a picture of binary".',
        },
        topic: { type: 'string', description: 'Lesson topic, used to contextualise labels.' },
        yearLevel: { type: 'string', description: 'Year level, used to pitch vocabulary on labels.' },
        style: {
          type: 'string',
          enum: ['educational', 'decorative'],
          description: 'Use "educational" (default) for labelled teaching diagrams; "decorative" only when the user explicitly asks for a stylised artwork.',
        },
        aspectRatio: {
          type: 'string',
          enum: ['1:1', '16:9', '4:3', '3:4'],
          description: 'Desired aspect ratio',
        },
      },
      required: ['prompt'],
    },
  },

  {
    name: 'generate_infographic',
    description:
      'Generate a single-page classroom infographic (NotebookLM-style) as a PNG. 3 orientations and 3 detail levels. Use for posters, visual summaries, and social-share graphics.',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        orientation: {
          type: 'string',
          enum: ['portrait', 'landscape', 'square'],
          description: 'Layout orientation (default portrait)',
        },
        detail: {
          type: 'string',
          enum: ['brief', 'standard', 'detailed'],
          description: 'How dense the infographic should be',
        },
        focus: {
          type: 'string',
          description: 'Optional angle or emphasis',
        },
      },
      required: ['topic', 'yearLevel'],
    },
  },

  {
    name: 'generate_lesson_plan',
    description:
      'Generate a detailed lesson plan as PDF and DOCX, with timing breakdown and differentiation strategies.',
    parameters: {
      type: 'object',
      properties: {
        topic,
        yearLevel,
        durationMin: {
          type: 'number',
          description: 'Lesson duration in minutes (e.g. 60)',
        },
        model: {
          type: 'string',
          description: 'Optional: model override for this generation',
        },
      },
      required: ['topic', 'yearLevel', 'durationMin'],
    },
  },

  {
    name: 'add_task',
    description: 'Add a task to the teacher\'s To-Do list.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        deadline: {
          type: 'string',
          description: 'ISO 8601 deadline date-time (e.g. "2026-08-15T09:00:00")',
        },
        estimatedDurationMin: {
          type: 'number',
          description: 'Estimated time to complete in minutes',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
        },
      },
      required: ['title'],
    },
  },

  {
    name: 'prioritise_tasks',
    description:
      'Re-prioritise the task list using AI (routes to OpenAI). Returns updated order.',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Optional additional context to inform prioritisation',
        },
      },
    },
  },

  {
    name: 'schedule_block',
    description: 'Add a block to the timetable.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: {
          type: 'string',
          enum: ['class', 'prep', 'meeting', 'duty', 'personal', 'other'],
        },
        startISO: { type: 'string', description: 'ISO 8601 start date-time' },
        endISO: { type: 'string', description: 'ISO 8601 end date-time' },
        recurrence: {
          type: 'string',
          description: 'RRULE string for recurring events (optional)',
        },
      },
      required: ['title', 'startISO', 'endISO'],
    },
  },

  {
    name: 'populate_week_with_ai',
    description:
      'Automatically plan the week by scheduling prep and task blocks using AI.',
    parameters: {
      type: 'object',
      properties: {
        weekStartISO: {
          type: 'string',
          description: 'ISO 8601 date for the Monday of the target week',
        },
      },
      required: ['weekStartISO'],
    },
  },

  {
    name: 'list_timetable_blocks',
    description:
      'List existing timetable blocks for the current user, optionally filtered by date range or block type. Use this before editing or deleting so you know the block IDs and exact times.',
    parameters: {
      type: 'object',
      properties: {
        fromISO: {
          type: 'string',
          description: 'Optional ISO date/datetime — only include blocks starting on or after this',
        },
        toISO: {
          type: 'string',
          description: 'Optional ISO date/datetime — only include blocks starting on or before this',
        },
        type: {
          type: 'string',
          enum: ['class', 'prep', 'meeting', 'duty', 'pd', 'personal', 'custom'],
          description: 'Optional block type filter',
        },
        titleContains: {
          type: 'string',
          description: 'Optional case-insensitive substring match on title',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum number of blocks to return (default 50)',
        },
      },
    },
  },

  {
    name: 'update_timetable_block',
    description:
      'Edit an existing timetable block by ID. Pass only the fields you want to change; omitted fields stay the same. For recurring blocks, updating applies to the whole series unless scope="single" is passed (creates an override).',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'ID of the block to edit' },
        title: { type: 'string' },
        type: {
          type: 'string',
          enum: ['class', 'prep', 'meeting', 'duty', 'pd', 'personal', 'custom'],
        },
        startISO: { type: 'string', description: 'New ISO 8601 start' },
        endISO: { type: 'string', description: 'New ISO 8601 end' },
        location: { type: 'string' },
        notes: { type: 'string' },
        recurrence: { type: 'string', description: 'New RRULE string (or empty to clear)' },
        status: { type: 'string', enum: ['scheduled', 'done', 'cancelled'] },
        scope: {
          type: 'string',
          enum: ['series', 'single'],
          description: 'For recurring blocks: series updates all, single creates an override for this occurrence only. Defaults to series.',
        },
      },
      required: ['blockId'],
    },
  },

  {
    name: 'delete_timetable_block',
    description:
      'Delete a timetable block by ID. For recurring blocks, deletes the whole series unless scope="single" is passed (which adds an exception for a single occurrence).',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'ID of the block to delete' },
        scope: {
          type: 'string',
          enum: ['series', 'single'],
          description: 'For recurring blocks: series deletes all, single only skips one occurrence (requires occurrenceDateISO).',
        },
        occurrenceDateISO: {
          type: 'string',
          description: 'When scope="single" on a recurring block: the YYYY-MM-DD date of the occurrence to skip',
        },
        expectedDayOfWeek: {
          type: 'string',
          enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          description: 'REQUIRED when scope="single" and the user named a weekday. The day of week you believe occurrenceDateISO falls on. The tool will refuse if this does not match the actual day.',
        },
      },
      required: ['blockId'],
    },
  },

  {
    name: 'clear_timetable_range',
    description:
      'Atomically remove every timetable block (one-off or recurring occurrence) that overlaps the given time window. Use this when the user asks to "clear", "wipe", or "replace everything" on a day or in a window before scheduling something new. This is preferred over calling delete_timetable_block many times because it guarantees nothing is missed. For recurring blocks, only the occurrences inside the window are skipped (via exdate) — the series stays intact outside the window. STRONGLY PREFERRED: if the user said a relative weekday ("next Tuesday", "this Friday"), pass weekdayPhrase and OMIT fromISO/toISO — the server will resolve the correct date from the real current date, avoiding any calendar-arithmetic mistakes.',
    parameters: {
      type: 'object',
      properties: {
        weekdayPhrase: {
          type: 'string',
          description: 'Natural-language weekday reference like "next tuesday", "this friday", "tuesday". When provided, the server resolves it to a concrete local date using the REAL current date and ignores fromISO/toISO. Use this whenever the user mentioned a weekday.',
        },
        fromISO: {
          type: 'string',
          description: 'Start of the window (ISO 8601). Can be a date (YYYY-MM-DD) or full datetime. Ignored if weekdayPhrase is provided.',
        },
        toISO: {
          type: 'string',
          description: 'End of the window (ISO 8601). Can be a date (YYYY-MM-DD) or full datetime. Ignored if weekdayPhrase is provided.',
        },
        excludeBlockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of block IDs to leave untouched (e.g. a newly scheduled block you want to keep).',
        },
        expectedDayOfWeek: {
          type: 'string',
          enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          description: 'Optional sanity check. If provided alongside fromISO, tool refuses when the computed day does not match.',
        },
      },
    },
  },

  {
    name: 'parse_timetable_image',
    description:
      'Extract structured timetable data from a screenshot or photo using a vision model.',
    parameters: {
      type: 'object',
      properties: {
        imageBase64: {
          type: 'string',
          description: 'Base64-encoded image of the timetable',
        },
        mediaType: {
          type: 'string',
          enum: ['image/jpeg', 'image/png', 'image/webp'],
          description: 'MIME type of the image',
        },
      },
      required: ['imageBase64'],
    },
  },

  {
    name: 'search_library',
    description: 'Search the artifact library for previously generated resources.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query' },
        filters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['slides', 'pdf', 'worksheet', 'notes', 'quiz', 'rubric', 'image', 'lesson_plan'],
            },
            yearLevel,
            topic,
            dateFrom: { type: 'string', description: 'ISO 8601 date' },
            dateTo: { type: 'string', description: 'ISO 8601 date' },
          },
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'attach_resource_to_block',
    description: 'Attach a library artifact to a timetable block.',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'ID of the timetable block' },
        artifactId: { type: 'string', description: 'ID of the library artifact' },
      },
      required: ['blockId', 'artifactId'],
    },
  },

  {
    name: 'fetch_webpage',
    description:
      'Fetch and extract the readable text content from a public webpage URL. Use this when the user shares a URL and wants you to read it, summarise it, or use its content to generate teaching resources. Returns plain text extracted from the page.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to fetch (must be http or https)',
        },
      },
      required: ['url'],
    },
  },
];

/** Look up a tool definition by name */
export function getTool(name: string): ToolDefinition | undefined {
  return PEDAGOGY_TOOLS.find((t) => t.name === name);
}
