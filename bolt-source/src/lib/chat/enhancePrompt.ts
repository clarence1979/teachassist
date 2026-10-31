/**
 * Prompt-enhancement helper.
 *
 * Takes a user's raw chat prompt and expands it into a rich, precise, research-backed
 * request that will produce better downstream artifacts (worksheets, quizzes, slides,
 * infographics, etc). Uses the chat model already selected by the user — if an OpenAI
 * key is available we prefer GPT-5 with web-search tools enabled; otherwise fall back
 * to a plain LLM call using whatever provider is configured.
 */

import { complete } from '../llm';
import type { Provider } from '../../types/credentials';

const ENHANCER_SYSTEM = `You are a prompt engineer for a teacher-facing AI assistant.
Your job: rewrite the user's input into a single, richer prompt that will produce a
more accurate, more detailed artifact.

Rules:
- Preserve the user's original intent and constraints exactly. Do not invent hard requirements they did not express.
- If the request concerns a specific curriculum topic, year level, standard, or subject, use accurate, up-to-date
  factual framing. Add concrete pedagogical scaffolding (learning objectives, prerequisite knowledge, suggested
  structure, worked examples, assessment criteria) only where that clearly improves the output.
- If the request is for a visual artifact (infographic, slides, worksheet, quiz), add explicit instructions
  about structure, number of sections, difficulty progression, reading level, and tone appropriate to the target year.
- Keep the enhanced prompt in first-person, as if the teacher were writing it themselves.
- CRITICAL: All subject-specific terminology, proper nouns, and technical terms must be spelled correctly.
  Double-check any scientific, mathematical, or discipline-specific vocabulary before including it.
- Think one level deeper: what will the teacher need beyond what they literally asked? Include instructions
  for accuracy checks, correct terminology, and appropriate scaffolding that would prevent the output from
  needing corrections before classroom use.
- Output the enhanced prompt ONLY — no preamble, no quotes, no commentary.
- Aim for 3-10x the original length but stay tightly focused; do not pad.`;

export interface EnhancePromptRequest {
  prompt: string;
  provider: Provider;
  model: string;
  anthropicKey?: string;
  openaiKey?: string;
}

export async function enhancePrompt(req: EnhancePromptRequest): Promise<string> {
  const raw = req.prompt.trim();
  if (!raw) return raw;

  // Prefer OpenAI with web search if available — gives the best chance of grounding
  // curriculum and subject-matter details in current, authoritative information.
  if (req.openaiKey) {
    try {
      const enhanced = await enhanceWithOpenAIResearch(raw, req.openaiKey);
      if (enhanced) return enhanced;
    } catch (err) {
      console.warn('[enhancePrompt] openai research path failed, falling back:', err);
    }
  }

  // Fallback: use whichever provider/model the user currently has selected.
  const apiKey = req.provider === 'openai' ? req.openaiKey : req.anthropicKey;
  if (!apiKey) throw new Error(`No API key for ${req.provider}`);

  const { text } = await complete({
    provider: req.provider,
    model: req.model,
    apiKey,
    system: ENHANCER_SYSTEM,
    messages: [{ role: 'user', content: `Enhance this prompt:\n\n${raw}` }],
    maxTokens: 1500,
    temperature: 0.4,
  });
  return cleanEnhanced(text, raw);
}

/** Call OpenAI's Responses API with web-search enabled so the enhanced prompt
 *  is grounded in current information. Returns empty string on any failure so the
 *  caller can fall back cleanly. */
async function enhanceWithOpenAIResearch(raw: string, apiKey: string): Promise<string> {
  const body = {
    model: 'gpt-4o',
    tools: [{ type: 'web_search' }],
    instructions: ENHANCER_SYSTEM,
    input: `Research (briefly) anything that would help you enhance this teacher's prompt, then output the enhanced prompt.\n\nOriginal prompt:\n${raw}`,
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return '';
  const data = await res.json();

  // The Responses API has an output_text convenience field; fall back to output[].content[].text.
  const directText = (data?.output_text as string | undefined)?.trim();
  if (directText) return cleanEnhanced(directText, raw);

  const out = (data?.output as Array<{ content?: Array<{ type?: string; text?: string }> }> | undefined) ?? [];
  for (const item of out) {
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && c.text) return cleanEnhanced(c.text, raw);
    }
  }
  return '';
}

function cleanEnhanced(text: string, original: string): string {
  const trimmed = text.trim()
    .replace(/^```(?:\w+)?\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
  // Guard against the model returning just "no changes needed" or something shorter than input.
  if (!trimmed || trimmed.length < Math.max(20, original.length / 2)) return original;
  return trimmed;
}
