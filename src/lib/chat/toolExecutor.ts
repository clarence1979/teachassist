/**
 * Tool executor for chat-invoked pedagogy tools.
 * Runs each tool's real implementation, writes artifacts / tasks / blocks to the DB,
 * and returns a compact result object to be displayed in the ToolCallCard.
 */

import type { PedagogyDB, ToolInvocation, Task, Artifact } from '../../db/schema';
import { artifactsRepo, tasksRepo, uid } from '../../db/repos';
import { expandOccurrences } from '../timetable/recurrence';
import { parseLocal, isoDate } from '../timetable/dates';
import { complete } from '../llm';
import type { Provider } from '../../types/credentials';

import { buildSlideGenPrompt, parseDeckJson } from '../studio/slideSchema';
import { classifyAndEnrichSlide } from '../studio/slideClassifier';
import { rasterizeStructured } from '../studio/structuredRasterizer';
import { buildPptx } from '../studio/pptxBuilder';
import { buildSlidesPdf } from '../studio/slidesPdfBuilder';
import { populatePexelsImages } from '../studio/pexelsImages';
import { getTheme } from '../studio/slideThemes';
import { buildNotesPrompt, parseNotesJson } from '../studio/notesSchema';
import { buildNotesPdf, buildNotesDocx, buildNotesMd } from '../studio/notesBuilders';
import { buildQuizPrompt, parseQuizJson } from '../studio/quizSchema';
import { buildQuizPdf, buildQuizDocx } from '../studio/quizBuilders';
import { buildRubricPrompt, parseRubricJson } from '../studio/rubricSchema';
import { buildRubricPdf, buildRubricDocx } from '../studio/rubricBuilders';
import { buildWorksheetPrompt, parseWorksheetJson } from '../studio/worksheetSchema';
import type { QuestionType, DifficultyTier } from '../studio/worksheetSchema';
import { buildWorksheetPdf, buildDocumentPdf } from '../studio/pdfRenderer';
import { buildWorksheetDocx, buildDocumentDocx } from '../studio/docxBuilder';
import { buildDocumentPrompt, parseDocumentJson } from '../studio/documentSchema';
import type { DocumentType } from '../studio/documentSchema';
import { generateImage } from '../studio/imageGen';
import { buildInfographicPrompt, parseInfographicJson, type InfographicOrientation, type InfographicDetail } from '../studio/infographicSchema';
import { renderInfographicSvg, svgToPngBase64, svgToBase64, getInfographicDims } from '../studio/infographicRenderer';

export interface ToolExecContext {
  db: PedagogyDB;
  conversationId: string;
  anthropicKey?: string;
  openaiKey?: string;
  provider: Provider;
  model: string;
}

export interface ToolExecResult {
  ok: boolean;
  summary: string;
  artifactIds?: string[];
  details?: Record<string, unknown>;
  error?: string;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

async function callLlmForJson(ctx: ToolExecContext, prompt: string, maxTokens = 4000, system?: string): Promise<string> {
  const key = ctx.openaiKey ?? ctx.anthropicKey;
  if (!key) throw new Error('No API key configured for content generation.');
  const provider: Provider = ctx.openaiKey ? 'openai' : 'anthropic';
  const model = provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-5';
  const res = await complete({
    provider,
    model,
    apiKey: key,
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
    temperature: 0.4,
  });
  return res.text;
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const n = (v: unknown, d: number) => (typeof v === 'number' ? v : Number(v) || d);
const arr = <T = string>(v: unknown, d: T[] = []): T[] => (Array.isArray(v) ? (v as T[]) : d);
const b = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);

async function execGenerateSlides(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic);
  const yearLevel = s(args.yearLevel);
  const slideCount = n(args.slideCount, 12);
  const objectives = arr<string>(args.objectives);
  if (!topic || !yearLevel) throw new Error('topic and yearLevel are required');

  const useAiImages = !!ctx.openaiKey;
  const raw = await callLlmForJson(ctx, buildSlideGenPrompt({
    topic, yearLevel, slideCount, objectives, includeImages: useAiImages,
  }));
  const deck = parseDeckJson(raw);
  const theme = getTheme('corporate');

  // Classify + enrich every slide. Structured educational content is rendered
  // natively as pptx shapes in the builder; only slides classified as
  // "decorative" are eligible for an AI / stock image.
  deck.slides = deck.slides.map(classifyAndEnrichSlide);

  // Rasterise every structured slide to a PNG so the PDF builder can embed
  // the same table / flowchart / box-method graphic shown in PowerPoint.
  await Promise.all(
    deck.slides.map(async (slide, i) => {
      if (!slide.structured) return;
      try {
        const b64 = await rasterizeStructured(slide.structured, theme);
        if (b64) deck.slides[i] = { ...slide, structuredImageBase64: b64 };
      } catch {
        // ignore — PDF will fall back to bullets-only for this slide
      }
    }),
  );

  // Non-structured content slides (intent === 'decorative' or 'plain') get a
  // photo: Pexels first (free, fast, classroom-safe), then OpenAI as a fallback
  // when a Pexels match isn't found and the user has a key.
  const photoCandidates = deck.slides.filter(
    (s) => !s.structured && s.layout !== 'title' && !s.imageBase64,
  );
  if (photoCandidates.length > 0) {
    await populatePexelsImages(photoCandidates, { deckTopic: deck.topic || topic });
  }

  if (useAiImages) {
    const aiCandidates = deck.slides
      .map((slide, i) => ({ slide, i }))
      .filter(({ slide }) =>
        !slide.structured && slide.layout !== 'title' && !slide.imageBase64,
      );
    for (const { slide, i } of aiCandidates) {
      const prompt = slide.imagePrompt
        || `${deck.topic || topic}: editorial classroom-safe illustration for "${slide.title}". Abstract thematic composition, no text, no numbers, no letters.`;
      try {
        const { b64 } = await generateImage({ prompt, aspect_ratio: '16:9' });
        deck.slides[i] = { ...slide, imageBase64: b64 };
      } catch {
        // ignore
      }
    }
  }

  const [pptxB64, pdfB64] = await Promise.all([buildPptx(deck, theme), buildSlidesPdf(deck, theme)]);
  const groupId = uid('grp');
  const base = deck.title || `Slides — ${topic}`;
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, {
      type: 'slides',
      title: `${base} (PPTX)`,
      data: pptxB64,
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      conversationId: ctx.conversationId,
      meta: { topic, yearLevel, slideCount: deck.slides.length, format: 'pptx' },
      tags: [topic, yearLevel],
      groupId,
    }),
    artifactsRepo.create(ctx.db, {
      type: 'slides',
      title: `${base} (PDF)`,
      data: pdfB64,
      mediaType: 'application/pdf',
      conversationId: ctx.conversationId,
      meta: { topic, yearLevel, slideCount: deck.slides.length, format: 'pdf' },
      tags: [topic, yearLevel],
      groupId,
    }),
  ]);
  return { ok: true, summary: `${deck.slides.length} slides on ${topic} for ${yearLevel}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateNotes(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic); const yearLevel = s(args.yearLevel);
  const depth = (s(args.depth, 'standard') as 'summary' | 'standard' | 'detailed');
  const depthMap: Record<string, 'overview' | 'standard' | 'detailed'> = {
    summary: 'overview', standard: 'standard', detailed: 'detailed',
  };
  const raw = await callLlmForJson(ctx, buildNotesPrompt({
    topic, yearLevel, depth: depthMap[depth] ?? 'standard',
    includeDiagrams: true, includeGlossary: true, includeSelfCheck: true,
  }));
  const notes = parseNotesJson(raw);
  const [pdf, docx] = await Promise.all([buildNotesPdf(notes), buildNotesDocx(notes)]);
  const md = buildNotesMd(notes);
  const groupId = uid('grp');
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, { type: 'notes', title: `${notes.title} (PDF)`, data: pdf, mediaType: 'application/pdf', conversationId: ctx.conversationId, meta: { topic, yearLevel, depth, format: 'pdf' }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'notes', title: `${notes.title} (DOCX)`, data: docx, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', conversationId: ctx.conversationId, meta: { topic, yearLevel, depth, format: 'docx' }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'notes', title: `${notes.title} (Markdown)`, data: btoa(unescape(encodeURIComponent(md))), mediaType: 'text/markdown', conversationId: ctx.conversationId, meta: { topic, yearLevel, depth, format: 'md' }, groupId }),
  ]);
  return { ok: true, summary: `${depth} notes on ${topic} for ${yearLevel}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateQuiz(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic); const yearLevel = s(args.yearLevel);
  const count = n(args.count, 10);
  const questionTypes = arr<QuestionType>(args.questionTypes, ['multiple_choice', 'short_answer']);
  const raw = await callLlmForJson(ctx, buildQuizPrompt({
    topic, yearLevel, questionCount: count, questionTypes,
    difficulty: 'mixed', includeAnswerKey: true, randomiseOrder: false,
  }));
  const quiz = parseQuizJson(raw);
  const [pdf, docx] = await Promise.all([buildQuizPdf(quiz), buildQuizDocx(quiz)]);
  const groupId = uid('grp');
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, { type: 'quiz', title: `${quiz.title} (PDF)`, data: pdf, mediaType: 'application/pdf', conversationId: ctx.conversationId, meta: { topic, yearLevel, count: quiz.questions.length }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'quiz', title: `${quiz.title} (DOCX)`, data: docx, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', conversationId: ctx.conversationId, meta: { topic, yearLevel }, groupId }),
  ]);
  return { ok: true, summary: `${quiz.questions.length}-question quiz on ${topic} for ${yearLevel}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateRubric(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const task = s(args.assessmentTitle);
  const criteria = arr<string>(args.criteria);
  const levels = arr<string>(args.levels, ['A', 'B', 'C', 'D', 'E']);
  const raw = await callLlmForJson(ctx, buildRubricPrompt({
    task, style: 'analytic', criteriaCount: Math.max(criteria.length, 4),
    levelCount: levels.length, objectives: criteria,
  }));
  const rubric = parseRubricJson(raw);
  const [pdf, docx] = await Promise.all([buildRubricPdf(rubric), buildRubricDocx(rubric)]);
  const groupId = uid('grp');
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, { type: 'rubric', title: `${rubric.title} (PDF)`, data: pdf, mediaType: 'application/pdf', conversationId: ctx.conversationId, meta: { task, style: 'analytic' }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'rubric', title: `${rubric.title} (DOCX)`, data: docx, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', conversationId: ctx.conversationId, meta: { task }, groupId }),
  ]);
  return { ok: true, summary: `Rubric for ${task}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateWorksheet(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic); const yearLevel = s(args.yearLevel);
  const questionTypes = arr<QuestionType>(args.questionTypes, ['multiple_choice', 'short_answer']);
  const difficultyLevels = arr<DifficultyTier>(args.difficultyLevels, ['on']);
  const count = n(args.count, 8);
  const includeAnswerKey = b(args.includeAnswerKey, true);
  const raw = await callLlmForJson(ctx, buildWorksheetPrompt({
    topic, yearLevel, questionTypes, tiers: difficultyLevels,
    questionsPerTier: Math.max(1, Math.round(count / Math.max(1, difficultyLevels.length))),
    includeAnswerKey,
  }), 6000);
  const ws = parseWorksheetJson(raw);
  const [pdf, docx] = await Promise.all([buildWorksheetPdf(ws, { includeAnswerKey }), buildWorksheetDocx(ws, { includeAnswerKey })]);
  const groupId = uid('grp');
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, { type: 'worksheet', title: `${ws.title} (PDF)`, data: pdf, mediaType: 'application/pdf', conversationId: ctx.conversationId, meta: { topic, yearLevel }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'worksheet', title: `${ws.title} (DOCX)`, data: docx, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', conversationId: ctx.conversationId, meta: { topic, yearLevel }, groupId }),
  ]);
  return { ok: true, summary: `Worksheet on ${topic} for ${yearLevel}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateDocument(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic); const yearLevel = s(args.yearLevel);
  const typeArg = s(args.type, 'lesson_plan');
  const docType: DocumentType = typeArg === 'lesson_plan' ? 'lesson_plan_5e'
    : typeArg === 'notes' ? 'handout'
    : typeArg === 'fact_sheet' ? 'cheat_sheet'
    : typeArg === 'reading' ? 'handout'
    : typeArg === 'report' ? 'report_comment'
    : 'handout';
  const length = (s(args.length, 'medium') as 'short' | 'medium' | 'long');
  const raw = await callLlmForJson(ctx, buildDocumentPrompt({ documentType: docType, topic, yearLevel, length }));
  const doc = parseDocumentJson(raw, docType);
  const [pdf, docx] = await Promise.all([buildDocumentPdf(doc), buildDocumentDocx(doc)]);
  const groupId = uid('grp');
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, { type: 'pdf', title: `${doc.title} (PDF)`, data: pdf, mediaType: 'application/pdf', conversationId: ctx.conversationId, meta: { topic, yearLevel, documentType: docType }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'pdf', title: `${doc.title} (DOCX)`, data: docx, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', conversationId: ctx.conversationId, meta: { topic, yearLevel, documentType: docType }, groupId }),
  ]);
  return { ok: true, summary: `${typeArg.replace(/_/g, ' ')} on ${topic}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateLessonPlan(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic); const yearLevel = s(args.yearLevel);
  const durationMin = n(args.durationMin, 60);
  const raw = await callLlmForJson(ctx, buildDocumentPrompt({
    documentType: 'lesson_plan_5e', topic, yearLevel, durationMin, length: 'medium',
  }));
  const doc = parseDocumentJson(raw, 'lesson_plan_5e');
  const [pdf, docx] = await Promise.all([buildDocumentPdf(doc), buildDocumentDocx(doc)]);
  const groupId = uid('grp');
  const arts = await Promise.all([
    artifactsRepo.create(ctx.db, { type: 'lesson_plan', title: `${doc.title} (PDF)`, data: pdf, mediaType: 'application/pdf', conversationId: ctx.conversationId, meta: { topic, yearLevel, durationMin }, groupId }),
    artifactsRepo.create(ctx.db, { type: 'lesson_plan', title: `${doc.title} (DOCX)`, data: docx, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', conversationId: ctx.conversationId, meta: { topic, yearLevel, durationMin }, groupId }),
  ]);
  return { ok: true, summary: `${durationMin}-min lesson plan on ${topic} for ${yearLevel}`, artifactIds: arts.map((a) => a.id) };
}

async function execGenerateInfographic(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const topic = s(args.topic);
  const yearLevel = s(args.yearLevel);
  const orientation = (s(args.orientation, 'portrait') as InfographicOrientation);
  const detail = (s(args.detail, 'standard') as InfographicDetail);
  const focus = args.focus ? s(args.focus) : undefined;
  if (!topic || !yearLevel) throw new Error('topic and yearLevel are required');

  const raw = await callLlmForJson(ctx, buildInfographicPrompt({ topic, yearLevel, orientation, detail, focus }), 6000,
    'You are an expert visual teacher. Output ONLY valid JSON — no prose, no fences.');
  const info = parseInfographicJson(raw);
  const svg = renderInfographicSvg(info);
  const { w, h } = getInfographicDims(info.orientation);
  const png = await svgToPngBase64(svg, w, h);

  const art = await artifactsRepo.create(ctx.db, {
    type: 'infographic',
    title: info.title || `Infographic — ${topic}`,
    data: png,
    mediaType: 'image/png',
    conversationId: ctx.conversationId,
    meta: {
      topic, yearLevel, orientation, detail,
      infographic: info,
      svgBase64: svgToBase64(svg),
    },
    tags: [topic, yearLevel, 'infographic'],
  });
  return { ok: true, summary: `${detail} ${orientation} infographic on ${topic}`, artifactIds: [art.id] };
}

async function execGenerateImage(_ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const prompt = s(args.prompt);
  if (!prompt) throw new Error('prompt is required');
  const rawAr = s(args.aspectRatio, '1:1');
  const aspect_ratio: '1:1' | '16:9' | '9:16' =
    rawAr === '16:9' ? '16:9'
    : rawAr === '9:16' || rawAr === '3:4' ? '9:16'
    : '1:1';
  const { b64, mediaType } = await generateImage({ prompt, aspect_ratio });
  const art = await artifactsRepo.create(_ctx.db, {
    type: 'image',
    title: prompt.slice(0, 60),
    data: b64,
    mediaType,
    conversationId: _ctx.conversationId,
    meta: { prompt, aspectRatio: aspect_ratio },
  });
  return { ok: true, summary: prompt.slice(0, 60), artifactIds: [art.id] };
}

async function execAddTask(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const title = s(args.title);
  if (!title) throw new Error('title is required');
  const deadline = args.deadline ? new Date(String(args.deadline)).getTime() : undefined;
  const estimatedDurationMin = n(args.estimatedDurationMin, 30);
  const priMap: Record<string, 1 | 2 | 3 | 4 | 5> = { urgent: 1, high: 2, medium: 3, low: 4 };
  const priority: 1 | 2 | 3 | 4 | 5 = priMap[s(args.priority, 'medium')] ?? 3;
  const task = await tasksRepo.create(ctx.db, {
    title, description: '', deadline, estimatedDurationMin, priority,
    tags: [], status: 'inbox', scheduledBlocks: [], source: 'ai-suggested',
  } as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>);
  return { ok: true, summary: title, details: { taskId: task.id } };
}

async function execPrioritiseTasks(ctx: ToolExecContext): Promise<ToolExecResult> {
  if (!ctx.openaiKey) throw new Error('OpenAI API key required.');
  const tasks = await tasksRepo.list(ctx.db);
  const active = tasks.filter((t) => t.status !== 'done');
  if (active.length === 0) return { ok: true, summary: 'No active tasks to prioritise.' };
  const today = new Date().toISOString();
  const { text: raw } = await complete({
    provider: 'openai', model: 'gpt-4o-mini', apiKey: ctx.openaiKey,
    system: `You are a teacher workload prioritiser. Today is ${today}. Output ONLY a JSON array: [{id, priority (1-5), rationale}].`,
    messages: [{ role: 'user', content: `Re-prioritise ${active.length} tasks:\n${JSON.stringify(active.map((t) => ({ id: t.id, title: t.title, priority: t.priority, deadline: t.deadline, estimatedDurationMin: t.estimatedDurationMin, tags: t.tags })), null, 2)}` }],
    maxTokens: 2000, temperature: 0.3,
  });
  const si = raw.indexOf('['), ei = raw.lastIndexOf(']');
  if (si === -1 || ei === -1) throw new Error('No JSON array in AI response');
  const results = JSON.parse(raw.slice(si, ei + 1)) as Array<{ id: string; priority: number; rationale: string }>;
  for (const r of results) {
    const p = Math.max(1, Math.min(5, Math.round(r.priority))) as 1 | 2 | 3 | 4 | 5;
    await tasksRepo.update(ctx.db, r.id, { priority: p, aiRationale: r.rationale });
  }
  return { ok: true, summary: `Re-prioritised ${results.length} tasks`, details: { count: results.length } };
}

async function execScheduleBlock(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const title = s(args.title);
  const startISO = s(args.startISO);
  const endISO = s(args.endISO);
  const typeRaw = s(args.type, 'personal');
  const allowed = ['class', 'prep', 'meeting', 'duty', 'pd', 'personal', 'custom'] as const;
  const type = (allowed as readonly string[]).includes(typeRaw) ? typeRaw as typeof allowed[number] : 'personal';
  const recurrence = args.recurrence ? s(args.recurrence) : undefined;
  if (!title || !startISO || !endISO) throw new Error('title, startISO, endISO are required');
  const id = uid('blk');
  await ctx.db.timetableBlocks.add({
    id, title, type, startISO, endISO, recurrence,
    seriesId: recurrence ? uid('ser') : undefined,
    exdates: [], artifactIds: [], status: 'scheduled', source: 'ai', createdAt: Date.now(),
  });
  return { ok: true, summary: `${title} @ ${startISO.slice(0, 16).replace('T', ' ')}`, details: { blockId: id } };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayOfWeek(isoStr: string): string {
  return DAY_NAMES[parseLocal(isoStr).getDay()] ?? '';
}

/**
 * Resolve a natural-language weekday reference (e.g. "next tuesday", "this friday",
 * "tuesday") to a concrete YYYY-MM-DD local date, using the real current date.
 * Returns null if the phrase can't be understood.
 */
function resolveWeekday(phrase: string, baseDate: Date = new Date()): string | null {
  const p = phrase.trim().toLowerCase();
  if (!p) return null;
  const dayMap: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  const modifierMatch = p.match(/^(this|next|upcoming|following|coming)?\s*(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)$/);
  if (!modifierMatch) return null;
  const modifier = modifierMatch[1] || '';
  const targetKey = modifierMatch[2];
  const target = dayMap[targetKey];
  if (target === undefined) return null;

  const base = new Date(baseDate);
  base.setHours(0, 0, 0, 0);
  const todayDow = base.getDay();
  let diff = (target - todayDow + 7) % 7;
  if (diff === 0 && (modifier === 'next' || modifier === 'following')) diff = 7;
  // "this"/"upcoming"/"coming"/no modifier: if today matches, diff=0 (today);
  // but "this tuesday" said on a Tuesday usually means today — keep as-is.
  const result = new Date(base);
  result.setDate(base.getDate() + diff);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}`;
}

async function execListTimetableBlocks(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const fromISO = args.fromISO ? s(args.fromISO) : '';
  const toISO = args.toISO ? s(args.toISO) : '';
  const typeFilter = args.type ? s(args.type) : '';
  const titleContains = args.titleContains ? s(args.titleContains).toLowerCase() : '';
  const limit = n(args.limit, 50);

  const all = await ctx.db.timetableBlocks.toArray();

  // When a date range is specified, expand recurring blocks so the AI sees actual occurrences
  if (fromISO || toISO) {
    // Use a generous window: if only one bound is given, expand ±7 days
    const windowStart = fromISO
      ? parseLocal(fromISO.length === 10 ? `${fromISO}T00:00:00` : fromISO)
      : new Date(parseLocal(toISO.length === 10 ? `${toISO}T23:59:59` : toISO).getTime() - 7 * 86400_000);
    const windowEnd = toISO
      ? parseLocal(toISO.length === 10 ? `${toISO}T23:59:59` : toISO)
      : new Date(parseLocal(fromISO.length === 10 ? `${fromISO}T00:00:00` : fromISO).getTime() + 7 * 86400_000);

    let occurrences;
    try {
      occurrences = expandOccurrences(all, windowStart, windowEnd);
    } catch (rruleErr) {
      console.warn('[list_timetable_blocks] expandOccurrences failed:', rruleErr);
      occurrences = [];
    }

    const filtered = occurrences.filter((o) => {
      if (typeFilter && o.block.type !== typeFilter) return false;
      if (titleContains && !o.block.title.toLowerCase().includes(titleContains)) return false;
      return true;
    });

    const trimmed = filtered.slice(0, Math.max(1, limit));

    const hint = filtered.length === 0 && all.length > 0
      ? `Window returned 0 matches, but the user has ${all.length} stored block(s). If this was a date query, double-check the year/month or retry without date filters.`
      : undefined;

    return {
      ok: true,
      summary: `${filtered.length} block${filtered.length === 1 ? '' : 's'} found${filtered.length > trimmed.length ? ` (showing ${trimmed.length})` : ''}${hint ? ' — ' + hint : ''}`,
      details: {
        totalInDatabase: all.length,
        windowFromISO: fromISO || null,
        windowToISO: toISO || null,
        hint,
        blocks: trimmed.map((o) => ({
          id: o.block.id,
          title: o.block.title,
          type: o.block.type,
          dayOfWeek: dayOfWeek(o.startISO),
          date: isoDate(parseLocal(o.startISO)),
          startISO: o.startISO,
          endISO: o.endISO,
          location: o.block.location,
          recurrence: o.block.recurrence,
          seriesId: o.block.seriesId,
          occurrenceDate: o.occurrenceDate,
          isRecurrence: o.isRecurrence,
          status: o.block.status,
        })),
      },
    };
  }

  // No date range — return raw blocks (filtered by type/title only)
  const filtered = all.filter((b) => {
    if (typeFilter && b.type !== typeFilter) return false;
    if (titleContains && !b.title.toLowerCase().includes(titleContains)) return false;
    return true;
  });
  filtered.sort((a, b) => a.startISO.localeCompare(b.startISO));
  const trimmed = filtered.slice(0, Math.max(1, limit));

  return {
    ok: true,
    summary: `${filtered.length} block${filtered.length === 1 ? '' : 's'} found${filtered.length > trimmed.length ? ` (showing ${trimmed.length})` : ''}`,
    details: {
      totalInDatabase: all.length,
      blocks: trimmed.map((b) => ({
        id: b.id,
        title: b.title,
        type: b.type,
        dayOfWeek: dayOfWeek(b.startISO),
        date: isoDate(parseLocal(b.startISO)),
        startISO: b.startISO,
        endISO: b.endISO,
        location: b.location,
        recurrence: b.recurrence,
        seriesId: b.seriesId,
        status: b.status,
      })),
    },
  };
}

async function execUpdateTimetableBlock(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const blockId = s(args.blockId);
  if (!blockId) throw new Error('blockId required');
  const block = await ctx.db.timetableBlocks.get(blockId);
  if (!block) throw new Error('Block not found');

  const patch: Record<string, unknown> = {};
  if (typeof args.title === 'string') patch.title = args.title;
  if (typeof args.type === 'string') patch.type = args.type;
  if (typeof args.startISO === 'string') patch.startISO = args.startISO;
  if (typeof args.endISO === 'string') patch.endISO = args.endISO;
  if (typeof args.location === 'string') patch.location = args.location;
  if (typeof args.notes === 'string') patch.notes = args.notes;
  if (typeof args.recurrence === 'string') patch.recurrence = args.recurrence || undefined;
  if (typeof args.status === 'string') patch.status = args.status;

  if (Object.keys(patch).length === 0) {
    return { ok: true, summary: 'No changes to apply.' };
  }

  const scope = s(args.scope, 'series');
  const isRecurring = !!block.recurrence;

  if (isRecurring && scope === 'single' && typeof args.startISO === 'string') {
    // Create an override record + add exdate on original
    const newId = uid('blk');
    const occurrenceDate = block.startISO.slice(0, 10);
    const existingExdates = block.exdates ?? [];
    await ctx.db.timetableBlocks.update(blockId, { exdates: [...existingExdates, occurrenceDate] });
    await ctx.db.timetableBlocks.add({
      ...block,
      ...patch,
      id: newId,
      recurrence: undefined,
      seriesId: undefined,
      exdates: [],
      overrideOfSeries: block.seriesId ?? blockId,
      overrideInstanceDate: occurrenceDate,
      createdAt: Date.now(),
    });
    return { ok: true, summary: `Updated single occurrence of "${block.title}"`, details: { newBlockId: newId } };
  }

  if (isRecurring && block.seriesId) {
    await ctx.db.timetableBlocks
      .where('seriesId')
      .equals(block.seriesId)
      .modify(patch);
    return { ok: true, summary: `Updated series "${block.title}"` };
  }

  await ctx.db.timetableBlocks.update(blockId, patch);
  return { ok: true, summary: `Updated "${block.title}"` };
}

async function execDeleteTimetableBlock(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const blockId = s(args.blockId);
  if (!blockId) throw new Error('blockId required');
  const block = await ctx.db.timetableBlocks.get(blockId);
  if (!block) throw new Error('Block not found');

  const scope = s(args.scope, 'series');
  const isRecurring = !!block.recurrence;

  if (isRecurring && scope === 'single') {
    const raw = args.occurrenceDateISO ? s(args.occurrenceDateISO) : '';
    const weekdayPhrase = args.weekdayPhrase ? s(args.weekdayPhrase) : '';
    let occurrenceDate = '';
    if (raw) {
      occurrenceDate = raw.slice(0, 10);
    } else if (weekdayPhrase) {
      const resolved = resolveWeekday(weekdayPhrase);
      if (!resolved) throw new Error(`Could not resolve weekdayPhrase "${weekdayPhrase}".`);
      occurrenceDate = resolved;
    } else {
      throw new Error(
        'delete_timetable_block with scope="single" on a recurring block requires occurrenceDateISO (YYYY-MM-DD) ' +
        'or weekdayPhrase (e.g. "next tuesday"). Prefer calling clear_timetable_range with weekdayPhrase to clear a whole day.',
      );
    }
    const expectedDow = args.expectedDayOfWeek ? s(args.expectedDayOfWeek) : '';
    const actualDow = dayOfWeek(`${occurrenceDate}T00:00:00`);
    if (expectedDow && actualDow.toLowerCase() !== expectedDow.toLowerCase()) {
      throw new Error(
        `Refusing to delete: you said the target is ${expectedDow} but ${occurrenceDate} is actually a ${actualDow}. ` +
        `Re-check the CURRENT DATE/TIME lookup table in your system prompt.`,
      );
    }
    const existingExdates = block.exdates ?? [];
    await ctx.db.timetableBlocks.update(blockId, {
      exdates: [...existingExdates, occurrenceDate],
    });
    return { ok: true, summary: `Skipped occurrence of "${block.title}" on ${occurrenceDate} (${actualDow})` };
  }

  if (isRecurring && block.seriesId) {
    await ctx.db.timetableBlocks.where('seriesId').equals(block.seriesId).delete();
    return { ok: true, summary: `Deleted series "${block.title}"` };
  }

  await ctx.db.timetableBlocks.delete(blockId);
  return { ok: true, summary: `Deleted "${block.title}"` };
}

async function execClearTimetableRange(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  let fromISO = s(args.fromISO);
  let toISO = s(args.toISO);
  const exclude = new Set(arr<string>(args.excludeBlockIds));

  const weekdayPhrase = args.weekdayPhrase ? s(args.weekdayPhrase) : '';
  if (weekdayPhrase) {
    const resolvedDate = resolveWeekday(weekdayPhrase);
    if (!resolvedDate) {
      throw new Error(`Could not resolve weekdayPhrase "${weekdayPhrase}". Use phrases like "next tuesday" or "this friday".`);
    }
    fromISO = `${resolvedDate}T00:00:00`;
    toISO = `${resolvedDate}T23:59:59`;
  }

  if (!fromISO || !toISO) throw new Error('Either weekdayPhrase, or both fromISO and toISO, are required');

  const expectedDow = args.expectedDayOfWeek ? s(args.expectedDayOfWeek) : '';
  if (expectedDow) {
    const actualDow = dayOfWeek(fromISO.length === 10 ? `${fromISO}T00:00:00` : fromISO);
    if (actualDow && actualDow.toLowerCase() !== expectedDow.toLowerCase()) {
      throw new Error(
        `Refusing to clear: you said the target is ${expectedDow} but ${fromISO} is actually a ${actualDow}. ` +
        `Re-check the CURRENT DATE/TIME lookup table in your system prompt and try again with the correct ISO date.`,
      );
    }
  }

  const windowStart = parseLocal(fromISO.length === 10 ? `${fromISO}T00:00:00` : fromISO);
  const windowEnd = parseLocal(toISO.length === 10 ? `${toISO}T23:59:59` : toISO);

  const all = await ctx.db.timetableBlocks.toArray();
  const occurrences = expandOccurrences(all, windowStart, windowEnd);

  const oneOffIds = new Set<string>();
  const exdatesByBlock = new Map<string, Set<string>>();
  const affectedTitles: string[] = [];

  for (const o of occurrences) {
    if (exclude.has(o.block.id)) continue;
    if (o.isRecurrence) {
      const set = exdatesByBlock.get(o.block.id) ?? new Set<string>();
      set.add(o.occurrenceDate);
      exdatesByBlock.set(o.block.id, set);
      affectedTitles.push(`${o.block.title} (${o.occurrenceDate})`);
    } else {
      oneOffIds.add(o.block.id);
      affectedTitles.push(o.block.title);
    }
  }

  let deleted = 0;
  for (const id of oneOffIds) {
    await ctx.db.timetableBlocks.delete(id);
    deleted++;
  }

  let skipped = 0;
  for (const [blockId, dates] of exdatesByBlock) {
    const block = await ctx.db.timetableBlocks.get(blockId);
    if (!block) continue;
    const existing = new Set(block.exdates ?? []);
    for (const d of dates) existing.add(d);
    await ctx.db.timetableBlocks.update(blockId, { exdates: [...existing] });
    skipped += dates.size;
  }

  const total = deleted + skipped;
  const fromDow = dayOfWeek(fromISO.length === 10 ? `${fromISO}T00:00:00` : fromISO);
  const toDow = dayOfWeek(toISO.length === 10 ? `${toISO}T00:00:00` : toISO);

  // Verify: re-expand occurrences in the same window and report anything that remains.
  const postAll = await ctx.db.timetableBlocks.toArray();
  const postOccurrences = expandOccurrences(postAll, windowStart, windowEnd)
    .filter((o) => !exclude.has(o.block.id));
  const remaining = postOccurrences.map((o) => ({
    id: o.block.id,
    title: o.block.title,
    type: o.block.type,
    startISO: o.startISO,
    endISO: o.endISO,
    isRecurrence: o.isRecurrence,
    occurrenceDate: o.occurrenceDate,
  }));

  const summary = remaining.length > 0
    ? `PARTIAL: cleared ${total} block(s) between ${fromISO} (${fromDow}) and ${toISO} (${toDow}), but ${remaining.length} block(s) REMAIN in the window. You MUST NOT tell the user the day is clear. Re-call clear_timetable_range (or delete_timetable_block on each remaining id) until remaining is empty.`
    : total === 0
      ? `No blocks found between ${fromISO} (${fromDow}) and ${toISO} (${toDow}) — window is already empty.`
      : `Cleared ${total} block(s) between ${fromISO} (${fromDow}) and ${toISO} (${toDow}) — ${deleted} deleted, ${skipped} recurring occurrence(s) skipped. Window is now empty.`;

  return {
    ok: true,
    summary,
    details: {
      deleted,
      skipped,
      cleared: affectedTitles,
      fromDayOfWeek: fromDow,
      toDayOfWeek: toDow,
      remainingInWindow: remaining,
      remainingCount: remaining.length,
    },
  };
}

async function execPopulateWeek(_ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const weekStartISO = s(args.weekStartISO);
  return {
    ok: true,
    summary: `Opened AI Week planner for ${weekStartISO.slice(0, 10)}`,
    details: { hint: 'Open the Timetable → AI Week panel to review and accept the AI proposals.' },
  };
}

async function execParseTimetableImage(_ctx: ToolExecContext): Promise<ToolExecResult> {
  return {
    ok: true,
    summary: 'Use the Timetable → Import image button',
    details: { hint: 'The timetable importer is available from the Timetable view.' },
  };
}

async function execSearchLibrary(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const query = s(args.query).toLowerCase();
  const filters = (args.filters ?? {}) as Record<string, unknown>;
  const typeFilter = s(filters.type);
  const all = await artifactsRepo.list(ctx.db);
  const matched = all.filter((a: Artifact) => {
    if (typeFilter && a.type !== typeFilter) return false;
    const hay = [a.title, JSON.stringify(a.meta ?? {}), (a.tags ?? []).join(' ')].join(' ').toLowerCase();
    return !query || hay.includes(query);
  }).slice(0, 20);
  return {
    ok: true,
    summary: `${matched.length} result${matched.length === 1 ? '' : 's'} for "${query}"`,
    details: { hits: matched.map((a) => ({ id: a.id, title: a.title, type: a.type, createdAt: a.createdAt })) },
  };
}

async function execAttachResource(ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const blockId = s(args.blockId);
  const artifactId = s(args.artifactId);
  if (!blockId || !artifactId) throw new Error('blockId and artifactId required');
  const block = await ctx.db.timetableBlocks.get(blockId);
  if (!block) throw new Error('Block not found');
  const ids = new Set(block.artifactIds ?? []);
  ids.add(artifactId);
  await ctx.db.timetableBlocks.update(blockId, { artifactIds: [...ids] });
  return { ok: true, summary: `Attached artifact to ${block.title}` };
}

async function execFetchWebpage(_ctx: ToolExecContext, args: Args): Promise<ToolExecResult> {
  const url = s(args.url);
  if (!url) throw new Error('url is required');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const endpoint = `${supabaseUrl}/functions/v1/fetch-webpage`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'Apikey': anonKey,
    },
    body: JSON.stringify({ url }),
  });

  const data = await res.json() as { text?: string; error?: string; truncated?: boolean; charCount?: number; url?: string };

  if (!res.ok || data.error) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }

  const truncatedNote = data.truncated ? '\n\n[Content was truncated at 50,000 characters — the page may have more]' : '';
  const displaySummary = `Fetched ${data.url ?? url} (${data.charCount ?? 0} chars${data.truncated ? ', truncated' : ''})`;

  return {
    ok: true,
    summary: displaySummary,
    details: {
      url: data.url,
      charCount: data.charCount,
      truncated: data.truncated,
      // Full page content for LLM consumption — kept in details so engine can surface it
      pageContent: `URL: ${data.url ?? url}\n\n${data.text ?? ''}${truncatedNote}`,
    },
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Args,
  ctx: ToolExecContext,
): Promise<ToolExecResult> {
  switch (name) {
    case 'generate_slides': return execGenerateSlides(ctx, args);
    case 'generate_pdf_document': return execGenerateDocument(ctx, args);
    case 'generate_worksheet': return execGenerateWorksheet(ctx, args);
    case 'generate_student_notes': return execGenerateNotes(ctx, args);
    case 'generate_quiz': return execGenerateQuiz(ctx, args);
    case 'generate_rubric': return execGenerateRubric(ctx, args);
    case 'generate_image': return execGenerateImage(ctx, args);
    case 'generate_infographic': return execGenerateInfographic(ctx, args);
    case 'generate_lesson_plan': return execGenerateLessonPlan(ctx, args);
    case 'add_task': return execAddTask(ctx, args);
    case 'prioritise_tasks': return execPrioritiseTasks(ctx);
    case 'schedule_block': return execScheduleBlock(ctx, args);
    case 'list_timetable_blocks': return execListTimetableBlocks(ctx, args);
    case 'update_timetable_block': return execUpdateTimetableBlock(ctx, args);
    case 'delete_timetable_block': return execDeleteTimetableBlock(ctx, args);
    case 'clear_timetable_range': return execClearTimetableRange(ctx, args);
    case 'populate_week_with_ai': return execPopulateWeek(ctx, args);
    case 'parse_timetable_image': return execParseTimetableImage(ctx);
    case 'search_library': return execSearchLibrary(ctx, args);
    case 'attach_resource_to_block': return execAttachResource(ctx, args);
    case 'fetch_webpage': return execFetchWebpage(ctx, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const TOOL_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Tool timed out after ${ms / 1000}s: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export async function executeToolInvocations(
  invocations: ToolInvocation[],
  ctx: ToolExecContext,
  onUpdate?: (updated: ToolInvocation[]) => void,
): Promise<ToolInvocation[]> {
  const next = [...invocations];
  for (let i = 0; i < next.length; i++) {
    const inv = next[i];
    if (inv.status !== 'pending' && inv.result !== undefined) continue;
    next[i] = { ...inv, status: 'pending' };
    onUpdate?.(next);
    try {
      const result = await withTimeout(executeTool(inv.name, inv.arguments, ctx), TOOL_TIMEOUT_MS, inv.name);
      next[i] = { ...inv, status: result.ok ? 'success' : 'error', result, error: result.error };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next[i] = { ...inv, status: 'error', error: message, result: { ok: false, summary: 'Failed', error: message } };
    }
    onUpdate?.(next);
  }
  return next;
}
