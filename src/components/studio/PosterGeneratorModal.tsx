import { useState, useRef, useEffect } from 'react';
import {
  X, Sparkles, AlertCircle, CheckCircle2, Download,
  Upload, Image as ImageIcon, Wand2, RotateCcw, Layers,
  User, Trash2, Loader2, ChevronRight, ArrowLeft, Eye,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCredentials } from '../../contexts/CredentialsContext';
import { useAppStore } from '../../store/appStore';
import { useDb } from '../../db/DbContext';
import { artifactsRepo } from '../../db/repos';
import { complete } from '../../lib/llm';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const POSTER_FN_URL = `${SUPABASE_URL}/functions/v1/generate-poster`;

type Stage = 'gallery' | 'configure' | 'enhancing' | 'generating' | 'preview' | 'error';

interface Props {
  onClose: () => void;
}

interface CustomField {
  key: string;         // e.g. "brand_name"
  label: string;       // e.g. "Brand Name"
  placeholder: string; // e.g. "e.g. The North Face"
  value: string;
}

interface PosterStyle {
  key: string;
  label: string;
  description: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  examplePrompt: string;
  customFields: Omit<CustomField, 'value'>[];
  defaultSize: '1024x1024' | '1536x1024' | '1024x1536';
  promptPrefix: string;
}

const POSTER_STYLES: PosterStyle[] = [
  {
    key: 'advertising',
    label: 'Brand / Ad Campaign',
    description: 'High-impact commercial poster with bold typography and cinematic photography',
    accentColor: '#ef4444',
    gradientFrom: '#1a0505',
    gradientTo: '#3b0a0a',
    defaultSize: '1024x1536',
    examplePrompt: `A hyper-detailed surreal advertising poster for The North Face. BACKGROUND: A large dark matte rounded rectangle in The North Face's signature black, white, and deep red palette fills the frame. Massive cropped THE NORTH FACE typography bleeds off-frame behind the subject, constructed from technical outdoor fabric textures, carbon fiber, snow textures, and expedition materials. Subtle cinematic grain overlays the entire composition.`,
    customFields: [
      { key: 'brand', label: 'Brand / Product Name', placeholder: 'e.g. The North Face, Nike, Sony' },
      { key: 'tagline', label: 'Tagline or Message', placeholder: 'e.g. Built For Extreme, Just Do It' },
      { key: 'product', label: 'Product Being Featured', placeholder: 'e.g. winter jacket, running shoe, headphones' },
      { key: 'palette', label: 'Colour Palette', placeholder: 'e.g. black, white and deep red' },
    ],
    promptPrefix: 'A hyper-detailed, ultra-premium advertising campaign poster.',
  },
  {
    key: 'streetwear',
    label: 'Streetwear / Sneaker',
    description: 'Dynamic sneaker ad with airborne character, brushstroke typography and bold colour',
    accentColor: '#22c55e',
    gradientFrom: '#021a08',
    gradientTo: '#052e0f',
    defaultSize: '1024x1536',
    examplePrompt: `Generate a perfectly graphic designed poster of Shoe advertisement. The character should be in the Air with a pose that shows the Big joggers with green strips same as the shirt color. The outfit should be modern baggie cool outfit and a Big text in beautiful font perfectly merged in the background and the some other texts about the shoes and the company.`,
    customFields: [
      { key: 'brand', label: 'Brand / Shoe Name', placeholder: 'e.g. Striders, Nike, Adidas' },
      { key: 'color', label: 'Primary Colour of Outfit & Shoes', placeholder: 'e.g. green, neon yellow, red' },
      { key: 'headline', label: 'Big Headline Text', placeholder: 'e.g. RULE AHEAD, JUST DO IT' },
      { key: 'subtext', label: 'Subtext / Slogan', placeholder: 'e.g. Move Different. Be Unstoppable.' },
    ],
    promptPrefix: 'A perfectly graphic-designed streetwear / sneaker advertisement poster. Character shown airborne or in dynamic mid-motion pose.',
  },
  {
    key: 'fashion',
    label: 'Fashion Editorial',
    description: 'Luxury fashion campaign with graffiti, urban aesthetics and editorial styling',
    accentColor: '#3b82f6',
    gradientFrom: '#020b1a',
    gradientTo: '#051a3b',
    defaultSize: '1024x1536',
    examplePrompt: `URBAN GRAFFITI FASHION CAMPAIGN — ELSA & OLAF EDITION IMAGE TYPE Premium streetwear fashion poster, luxury editorial campaign, modern urban fashion advertisement featuring two hero subjects: Elsa and Olaf reimagined as high-fashion streetwear icons. CORE CONCEPT A bold fashion campaign built around TWO hero subjects: Elsa (ice queen-inspired fashion model) and Olaf (stylized streetwear companion character) blending luxury editorial photography, icy graffiti aesthetics, and winter-themed urban fashion culture.`,
    customFields: [
      { key: 'brand', label: 'Brand or Collection Name', placeholder: 'e.g. Frost Street Luxe, Ice Reborn' },
      { key: 'subject', label: 'Hero Subject(s)', placeholder: 'e.g. Elsa & Olaf, two models in streetwear' },
      { key: 'aesthetic', label: 'Aesthetic / Theme', placeholder: 'e.g. icy graffiti, neon urban, dark luxury' },
      { key: 'season', label: 'Season / Drop Name', placeholder: 'e.g. Winter Collection 2024, Drop 01' },
    ],
    promptPrefix: 'Premium luxury fashion editorial campaign poster. Urban streetwear aesthetics, bold graffiti-style typography.',
  },
  {
    key: 'fashion_blueprint',
    label: 'Fashion Blueprint',
    description: 'Technical fashion lookbook with callout annotations, outfit breakdown and colour palette',
    accentColor: '#0ea5e9',
    gradientFrom: '#021018',
    gradientTo: '#042033',
    defaultSize: '1024x1536',
    examplePrompt: `Fashion blueprint sheet of an elegant young woman posing beside a vintage bicycle, full-body low-angle view with detailed outfit annotations and fashion callout labels. Hair styled in a soft braided bun, geometric white statement earrings, fitted deep-red cropped top with long sleeves, flowing cream striped asymmetrical midi skirt, white minimalist slip-on shoes, relaxed artistic pose holding bicycle handlebars, modern European summer fashion aesthetic.`,
    customFields: [
      { key: 'subject', label: 'Subject Description', placeholder: 'e.g. elegant young woman beside a bicycle' },
      { key: 'outfit', label: 'Outfit Description', placeholder: 'e.g. deep-red crop top, cream midi skirt, slip-on shoes' },
      { key: 'aesthetic', label: 'Fashion Aesthetic', placeholder: 'e.g. European summer, dark academia, streetwear' },
      { key: 'collection', label: 'Collection / Brand Name', placeholder: 'e.g. European Summer Heritage & Modernity' },
    ],
    promptPrefix: 'A fashion blueprint / lookbook sheet. Full-body editorial photo with detailed outfit annotation callout lines.',
  },
  {
    key: 'anime',
    label: 'Anime / Techwear',
    description: 'High-quality anime art in modern techwear style with dynamic characters',
    accentColor: '#f59e0b',
    gradientFrom: '#1a0f00',
    gradientTo: '#2e1a00',
    defaultSize: '1024x1536',
    examplePrompt: `A high-quality anime poster design in a modern Techwear style featuring Homelander from The Boys together with the uploaded person photo with hero name Adam integrated naturally into the artwork. The composition shows two characters side-by-side in a dynamic duo pose with strong chemistry and cinematic balance.`,
    customFields: [
      { key: 'character1', label: 'Anime / Fictional Character', placeholder: 'e.g. Homelander, Goku, Naruto' },
      { key: 'character2', label: 'Real Person / Hero Name', placeholder: 'e.g. Adam — upload photo below' },
      { key: 'show', label: 'Show / Universe', placeholder: 'e.g. The Boys, Dragon Ball Z' },
      { key: 'role', label: 'Role / Specialty', placeholder: 'e.g. Tech Architect, Systems Engineer' },
    ],
    promptPrefix: 'A high-quality anime poster design in modern Techwear style. Dynamic composition, cinematic balance.',
  },
  {
    key: 'anime_portrait',
    label: 'Anime Character Portrait',
    description: 'Ultra-detailed anime manga close-up with dramatic cinematic presence and Japanese typography',
    accentColor: '#818cf8',
    gradientFrom: '#050510',
    gradientTo: '#0a0a2e',
    defaultSize: '1024x1536',
    examplePrompt: `Ultra detailed anime manga character poster of Satoru Gojo, dramatic front-facing upper body close-up, centered symmetrical composition, direct eye contact with the viewer, overwhelming cinematic presence. White spiky hair, blue infinity eyes, wearing round glasses, with a smirking confident expression.`,
    customFields: [
      { key: 'character', label: 'Character Name', placeholder: 'e.g. Satoru Gojo, Naruto, Luffy' },
      { key: 'hair', label: 'Hair Description', placeholder: 'e.g. white spiky hair, long dark hair' },
      { key: 'eyes', label: 'Eye Colour / Style', placeholder: 'e.g. blue infinity eyes, Sharingan' },
      { key: 'accessory', label: 'Accessory / Item', placeholder: 'e.g. round glasses, headband, mask' },
      { key: 'expression', label: 'Expression / Emotion', placeholder: 'e.g. smirking confidence, fierce determination' },
    ],
    promptPrefix: 'Ultra-detailed anime manga character poster. Dramatic front-facing upper body close-up.',
  },
  {
    key: 'anime_illustration',
    label: 'Anime Illustration',
    description: 'Highly saturated anime illustration from a reference photo — celluloid colouring, pop background',
    accentColor: '#ec4899',
    gradientFrom: '#1a0510',
    gradientTo: '#2e0a1e',
    defaultSize: '1024x1024',
    examplePrompt: `Please create a highly saturated and trendy anime illustration based on upload image. Retain the basic recognition of the characters, including face shape, facial relationship, hairstyle foundation and overall temperament, but the overall character must be obviously anime and non-realistic. The style of painting refers to the funny popular anime illustrations: the lines are confident and powerful, with slight thickness changes; the coloring uses simple celluloid style, with large color areas and minimal gradients. Bright saturated pop background with stickers, speech bubbles, stars and playful typography.`,
    customFields: [
      { key: 'mood', label: 'Mood / Vibe', placeholder: 'e.g. sweet summer vibes, cool street energy' },
      { key: 'item', label: 'Item Subject Holds', placeholder: 'e.g. popsicle, coffee, flowers' },
      { key: 'background', label: 'Background Theme', placeholder: 'e.g. pastel arcade room, cherry blossom park' },
      { key: 'speech_bubble', label: 'Speech Bubble Text', placeholder: 'e.g. Sweet Vibes!, YAY!' },
    ],
    promptPrefix: "A highly saturated, trendy anime illustration. Retain the subject's face but render in clearly anime style.",
  },
  {
    key: 'mecha',
    label: 'Mecha / Sci-Fi Scene',
    description: 'Person composited beside a giant mech with Japanese brand graphics and sketch overlays',
    accentColor: '#f97316',
    gradientFrom: '#100800',
    gradientTo: '#1a0e00',
    defaultSize: '1536x1024',
    examplePrompt: `Full-body fashion editorial shot taken from a slightly low angle, emphasizing dominance and presence. A confident young model sits casually on a sunlit concrete ledge, legs slightly apart, one arm resting on the knee, the other relaxed. The model looks to the sky on the left with a calm, commanding expression. Wearing a red parka jacket over a plain white t-shirt, cargo pants with many pocket and yellow strap waving, and modern sneakers. Behind and above towers the massive ZOIDS Liger Zero mech with Japanese brand annotations.`,
    customFields: [
      { key: 'mech', label: 'Mech / Robot Name', placeholder: 'e.g. ZOIDS Liger Zero, Gundam, Transformer' },
      { key: 'brand', label: 'Brand / Model Number', placeholder: 'e.g. Kotobukiya RZ-041, Bandai' },
      { key: 'outfit', label: 'Person\'s Outfit', placeholder: 'e.g. red parka jacket, cargo pants, white shirt' },
      { key: 'pose', label: 'Person\'s Pose / Location', placeholder: 'e.g. sits on concrete ledge looking up' },
    ],
    promptPrefix: 'A cinematic mecha / sci-fi scene poster. Real person in foreground, massive mechanical robot behind them.',
  },
  {
    key: 'manga_comic',
    label: 'Manga Comic Page',
    description: 'Full-page coloured manga layout with 5–7 dynamic panels, speech bubbles and ink effects',
    accentColor: '#64748b',
    gradientFrom: '#080c10',
    gradientTo: '#0f1520',
    defaultSize: '1024x1536',
    examplePrompt: `Create a full-page colored manga illustration based on the person in the reference photo. Use authentic manga page composition with 5–7 dynamic connected panels on a single page. Include cinematic storytelling, dramatic perspective, expressive emotions, dynamic poses, speed lines, impact frames, close-up shots, and intense visual flow. Add English comic-style sound effects, handwritten dialogue bubbles, ink splatter strokes, haftone textures, rough comic sketch lines, and graffiti-style elements.`,
    customFields: [
      { key: 'theme', label: 'Story Theme / Setting', placeholder: 'e.g. tech entrepreneur, warrior, student' },
      { key: 'quote1', label: 'Main Dialogue Quote', placeholder: 'e.g. I don\'t chase opportunities. I build them.' },
      { key: 'quote2', label: 'Secondary Quote', placeholder: 'e.g. Strategy isn\'t luck. It\'s design.' },
      { key: 'color_scheme', label: 'Colour Scheme', placeholder: 'e.g. blue/black/white, red/black, monochrome' },
    ],
    promptPrefix: 'A full-page coloured manga illustration. Authentic manga page composition with 5–7 dynamic connected panels.',
  },
  {
    key: 'gta',
    label: 'GTA / Game Art',
    description: 'GTA VI-style portrait with neon tropical city, dramatic lighting and street-luxury energy',
    accentColor: '#a855f7',
    gradientFrom: '#0d0014',
    gradientTo: '#1a0028',
    defaultSize: '1024x1536',
    examplePrompt: `Create a highly detailed 8K portrait poster inspired by the iconic visual style of the modern Grand Theft Auto VI promotional artwork aesthetic, featuring a cinematic urban atmosphere with bold composition, vibrant lighting, layered graphic elements, and stylish contemporary street-luxury fashion energy. The overall design must strongly capture the signature mood of GTA VI posters, including dynamic neon color grading, tropical-modern city vibes, dramatic shadows, glossy finish.`,
    customFields: [
      { key: 'outfit', label: 'Subject\'s Outfit', placeholder: 'e.g. luxury patterned jacket, gold chain, white tee' },
      { key: 'city', label: 'City / Location Vibe', placeholder: 'e.g. Miami neon district, Tokyo, Vice City' },
      { key: 'title_text', label: 'Game / Title Text', placeholder: 'e.g. Grand Theft Auto VI, leave blank to omit' },
      { key: 'year', label: 'Year Tag', placeholder: 'e.g. 2026, 2025' },
    ],
    promptPrefix: 'A highly detailed 8K portrait poster inspired by GTA VI promotional artwork. Cinematic urban atmosphere.',
  },
  {
    key: 'architectural',
    label: 'Architectural Infographic',
    description: 'Premium reference-style architectural handbook page with floor plans, specs and diagrams',
    accentColor: '#0369a1',
    gradientFrom: '#000d1a',
    gradientTo: '#001933',
    defaultSize: '1024x1024',
    examplePrompt: `Create a premium square "reference-style architectural infographic" centered around a luxurious modern house, designed as a beautifully curated architecture handbook page rather than a real-estate advertisement. The composition should feel like a modern visual encyclopedia mixed with an elite architectural field guide and high-end editorial infographic system.`,
    customFields: [
      { key: 'house_style', label: 'House Style', placeholder: 'e.g. Modern, Colonial, Mediterranean, Minimalist' },
      { key: 'floors', label: 'Number of Floors', placeholder: 'e.g. 2 storey, single level, duplex' },
      { key: 'features', label: 'Key Features', placeholder: 'e.g. rooftop pool, smart home, glass walls' },
      { key: 'location', label: 'Ideal Location', placeholder: 'e.g. urban, coastal, hillside, suburban' },
    ],
    promptPrefix: 'A premium square reference-style architectural infographic. Architecture handbook page aesthetic.',
  },
  {
    key: 'product',
    label: 'Product Launch',
    description: 'Social-media-ready product campaign with lifestyle photography and bold claims',
    accentColor: '#10b981',
    gradientFrom: '#001a0d',
    gradientTo: '#002e18',
    defaultSize: '1024x1536',
    examplePrompt: `Ultra-realistic premium mixed berry beverage advertisement poster design, luxury summer smoothie campaign style, clean white background with soft pink-purple gradient glow effects, subtle glossy reflections, floating berry particles and cinematic studio lighting, modern commercial Instagram ad aesthetic with trendy energetic composition. Showcase a crystal-clear tall glass filled with thick mixed berry smoothie in rich raspberry-purple tones.`,
    customFields: [
      { key: 'product', label: 'Product Name', placeholder: 'e.g. Berry Blast Smoothie, Protein Bar, Energy Drink' },
      { key: 'headline', label: 'Headline Text', placeholder: 'e.g. BERRY BLAST, Fresh Berry Energy' },
      { key: 'benefits', label: 'Key Benefits (3)', placeholder: 'e.g. Rich in Antioxidants, Supports Skin Glow, Boosts Immunity' },
      { key: 'palette', label: 'Colour Theme', placeholder: 'e.g. pink/red berry tones, green matcha, orange citrus' },
    ],
    promptPrefix: 'Ultra-realistic premium product advertisement poster. Luxury lifestyle photography, clean modern layout.',
  },
  {
    key: 'music',
    label: 'Music / Concert',
    description: 'Gen-Z tech-fashion editorial with neon, collage and urban culture energy',
    accentColor: '#8b5cf6',
    gradientFrom: '#08001a',
    gradientTo: '#100028',
    defaultSize: '1024x1536',
    examplePrompt: `Create a high-impact Instagram-ready Sony Headphones campaign poster in a premium Gen Z tech-fashion editorial style, designed as an ultra-detailed 8K vertical 4:5 composition for a futuristic lifestyle and music-culture social media campaign. The artwork should blend cinematic fashion photography, handcrafted mixed-media collage aesthetics, futuristic tech branding, and modern urban editorial graphics into a visually explosive premium commercial design.`,
    customFields: [
      { key: 'brand', label: 'Brand / Artist Name', placeholder: 'e.g. Sony, Bose, DJ Khaled' },
      { key: 'product', label: 'Product / Event', placeholder: 'e.g. WH-1000XM5 headphones, World Tour 2025' },
      { key: 'headline', label: 'Big Headline', placeholder: 'e.g. FEEL EVERY FREQUENCY, LIVE LOUDER' },
      { key: 'hashtag', label: 'Hashtag / Slogan', placeholder: 'e.g. #SonySound, #LivingInSound' },
    ],
    promptPrefix: 'High-impact music/concert campaign poster. Gen-Z tech-fashion editorial style, neon energy effects.',
  },
  {
    key: 'custom',
    label: 'Custom Style',
    description: 'Write your own prompt — AI will enhance it into a detailed poster brief',
    accentColor: '#64748b',
    gradientFrom: '#0a0a0a',
    gradientTo: '#141414',
    defaultSize: '1024x1536',
    examplePrompt: '',
    customFields: [],
    promptPrefix: '',
  },
];

const SIZES = [
  { label: 'Portrait (9:16)', value: '1024x1536' as const, hint: 'Instagram / print poster' },
  { label: 'Square (1:1)', value: '1024x1024' as const, hint: 'Social media post' },
  { label: 'Landscape (16:9)', value: '1536x1024' as const, hint: 'Banner / display' },
];

async function callPosterFunction(prompt: string, size: string, heroImageB64?: string, heroMediaType?: string): Promise<{ b64: string; mediaType: string }> {
  const res = await fetch(POSTER_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ prompt, size, heroImageB64, heroMediaType }),
  });
  if (!res.ok) {
    let msg = `Poster generation failed (HTTP ${res.status})`;
    try { const e = await res.json(); msg = (e as { error?: string })?.error ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  const data = await res.json() as { b64?: string; mediaType?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.b64) throw new Error('No image returned.');
  return { b64: data.b64, mediaType: data.mediaType ?? 'image/png' };
}

function fileToBase64(file: File): Promise<{ b64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const b64 = result.slice(result.indexOf(',') + 1);
      resolve({ b64, mediaType: file.type });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Substitutes [FIELD_VALUE] placeholders with user values in the example prompt */
function buildPromptFromFields(basePrompt: string, fields: CustomField[], stylePromptPrefix: string): string {
  if (!basePrompt && stylePromptPrefix) return stylePromptPrefix;
  let result = basePrompt || stylePromptPrefix;
  fields.forEach(f => {
    if (f.value.trim()) {
      // Replace any bracketed placeholder that semantically matches the field key
      const patterns = [
        new RegExp(`\\[${f.key.toUpperCase().replace(/_/g, '[_ ]?')}\\]`, 'gi'),
        new RegExp(`\\{${f.key.toUpperCase().replace(/_/g, '[_ ]?')}\\}`, 'gi'),
      ];
      patterns.forEach(p => { result = result.replace(p, f.value.trim()); });
    }
  });
  return result;
}

export function PosterGeneratorModal({ onClose }: Props) {
  const { getKey } = useCredentials();
  const { activeProvider, activeModel, notifyArtifactGenerated } = useAppStore();
  const db = useDb();

  // Gallery / style selection
  const [stage, setStage] = useState<Stage>('gallery');
  const [selectedStyle, setSelectedStyle] = useState<PosterStyle | null>(null);

  // Configure form
  const [fields, setFields] = useState<CustomField[]>([]);
  const [userIntent, setUserIntent] = useState('');
  const [enhancedPrompt, setEnhancedPrompt] = useState('');
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [size, setSize] = useState<'1024x1024' | '1536x1024' | '1024x1536'>('1024x1536');
  const [heroFile, setHeroFile] = useState<{ b64: string; mediaType: string; name: string } | null>(null);
  const [analysing, setAnalysing] = useState(false);

  // Output
  const [error, setError] = useState('');
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageMediaType, setImageMediaType] = useState('image/png');
  const [saved, setSaved] = useState(false);

  // Example preview overlay
  const [showExamplePrompt, setShowExamplePrompt] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectStyle = (s: PosterStyle) => {
    setSelectedStyle(s);
    setFields(s.customFields.map(f => ({ ...f, value: '' })));
    setSize(s.defaultSize);
    setUserIntent('');
    setEnhancedPrompt('');
    setEditingPrompt(false);
    setHeroFile(null);
    setShowExamplePrompt(false);
    setStage('configure');
  };

  const handleHeroUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToBase64(file);
      setHeroFile({ ...result, name: file.name });
    } catch { setError('Failed to load image.'); }
    e.target.value = '';
  };

  const updateField = (key: string, value: string) => {
    setFields(prev => prev.map(f => f.key === key ? { ...f, value } : f));
  };

  /** Use OpenAI to extract additional dynamic fields from the example prompt */
  const handleAnalyseFields = async () => {
    if (!selectedStyle || !selectedStyle.examplePrompt) return;
    const openaiKey = getKey('openai');
    const llmKey = getKey(activeProvider);
    const key = openaiKey || llmKey;
    if (!key) return;
    const provider = openaiKey ? 'openai' : activeProvider;
    const model = openaiKey ? 'gpt-4o-mini' : activeModel;

    setAnalysing(true);
    try {
      const { text } = await complete({
        provider,
        model,
        apiKey: key,
        system: `You are a prompt engineer. Given an image generation prompt, extract the key customisable variables a user would want to change to generate a similar but personalised poster.
Return a JSON array of objects: [{key, label, placeholder}]
- key: snake_case identifier
- label: short human-readable label (max 4 words)
- placeholder: a concrete example value starting with "e.g."
Return at most 6 items. Return ONLY valid JSON, no markdown.`,
        messages: [{ role: 'user', content: `Prompt: "${selectedStyle.examplePrompt}"` }],
        maxTokens: 600,
        temperature: 0.3,
      });

      const parsed = JSON.parse(text.trim()) as Omit<CustomField, 'value'>[];
      if (Array.isArray(parsed)) {
        const merged = parsed.map(p => {
          const existing = fields.find(f => f.key === p.key);
          return { ...p, value: existing?.value ?? '' };
        });
        setFields(merged);
      }
    } catch { /* silently ignore — fields stay as defaults */ }
    setAnalysing(false);
  };

  // Auto-analyse when entering configure for a style that has a prompt but no AI-analysed fields yet
  useEffect(() => {
    if (stage === 'configure' && selectedStyle && selectedStyle.key !== 'custom' && selectedStyle.examplePrompt) {
      handleAnalyseFields();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, selectedStyle?.key]);

  const buildSystemPrompt = () =>
    `You are a world-class creative director specializing in hyper-detailed AI image generation prompts for gpt-image-2.
Expand the user's brief into a single rich prompt (200-400 words) that will produce a stunning, publication-ready poster.
Include: composition details, lighting, typography style, color palette, mood, texture, camera angle, and relevant brand/cultural references.
Output ONLY the prompt text — no headings, no explanation, no markdown.`;

  const handleEnhance = async () => {
    const llmKey = getKey(activeProvider);
    if (!llmKey) { setError(`No ${activeProvider} API key.`); setStage('error'); return; }
    const intentText = userIntent.trim();
    if (!intentText && fields.every(f => !f.value.trim())) {
      setError('Please fill in at least one field or describe your poster.'); setStage('error'); return;
    }

    setStage('enhancing');
    try {
      const style = selectedStyle!;
      const filledFields = fields.filter(f => f.value.trim()).map(f => `${f.label}: ${f.value}`).join('\n');
      const fieldContext = filledFields ? `\nUser's customisation:\n${filledFields}` : '';
      const styleCtx = style.key !== 'custom' ? `Style: ${style.label} — ${style.description}\nBase style prompt: ${style.promptPrefix}\n\n` : '';
      const heroCtx = heroFile ? 'The user uploaded a hero photo of a real person — describe how to integrate their face naturally as the central subject.\n\n' : '';
      const userCtx = intentText ? `Additional brief: "${intentText}"` : '';

      const { text } = await complete({
        provider: activeProvider,
        model: activeModel,
        apiKey: llmKey,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: `${styleCtx}${heroCtx}${fieldContext}${userCtx}\n\nExpand this into a detailed image generation prompt.` }],
        maxTokens: 1000,
        temperature: 0.8,
      });

      setEnhancedPrompt(text.trim());
      setStage('configure');
    } catch (e) {
      setError((e as Error).message);
      setStage('error');
    }
  };

  const handleGenerate = async () => {
    const openaiKey = getKey('openai');
    if (!openaiKey) { setError('Poster generation requires an OpenAI API key. Add one in Settings.'); setStage('error'); return; }

    const style = selectedStyle!;
    let finalPrompt = enhancedPrompt.trim();
    if (!finalPrompt) {
      finalPrompt = buildPromptFromFields(style.examplePrompt, fields, style.promptPrefix);
      // Append any free-form user intent
      if (userIntent.trim()) finalPrompt += `\n\n${userIntent.trim()}`;
    }
    if (!finalPrompt) { setError('Please fill in at least one field or describe your poster.'); setStage('error'); return; }

    setStage('generating');
    try {
      const { b64, mediaType } = await callPosterFunction(finalPrompt, size, heroFile?.b64, heroFile?.mediaType);
      setImageB64(b64);
      setImageMediaType(mediaType);

      const title = fields.find(f => f.key === 'brand' || f.key === 'product' || f.key === 'character')?.value
        || userIntent.slice(0, 60) || style.label;

      const savedArtifact = await artifactsRepo.create(db, {
        type: 'image',
        title,
        data: b64,
        mediaType,
        meta: { prompt: finalPrompt, style: style.key, size, hasHero: !!heroFile, generatedAt: Date.now(), provider: 'openai', model: 'gpt-image-2', category: 'poster' },
      });
      notifyArtifactGenerated(savedArtifact.id);
      setSaved(true);
      setStage('preview');
    } catch (e) {
      setError((e as Error).message);
      setStage('error');
    }
  };

  const handleReset = () => {
    setImageB64(null); setSaved(false); setEnhancedPrompt('');
    setError(''); setStage('configure');
  };

  const handleDownload = () => {
    if (!imageB64) return;
    const ext = imageMediaType.includes('png') ? 'png' : 'jpg';
    const a = document.createElement('a');
    a.href = `data:${imageMediaType};base64,${imageB64}`;
    a.download = `poster_${Date.now()}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const promptReady = enhancedPrompt.trim() || userIntent.trim() || fields.some(f => f.value.trim());

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[92vh] bg-bg-panel border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            {stage !== 'gallery' && stage !== 'error' && (
              <button
                onClick={() => { setStage('gallery'); setSelectedStyle(null); }}
                className="p-1.5 rounded-btn text-text-dim hover:text-accent-amber transition-colors"
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <div className="p-1.5 rounded-btn bg-bg-panel border border-border">
              <Layers size={16} className="text-accent-amber" />
            </div>
            <div>
              <h2 className="font-orbitron font-bold text-text-primary text-sm tracking-wide uppercase">
                {stage === 'gallery' ? 'Poster Generator' : selectedStyle?.label ?? 'Poster Generator'}
              </h2>
              <p className="font-mono text-[10px] text-text-dim tracking-wider">
                {stage === 'gallery' ? 'SELECT A STYLE · GPT-IMAGE-2' : 'CONFIGURE · GPT-IMAGE-2 · HIGH QUALITY'}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-btn text-text-dim hover:text-accent-cyan transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ── GALLERY STAGE ── */}
          {stage === 'gallery' && (
            <div className="p-5">
              <p className="text-xs text-text-dim mb-4 font-inter">
                Choose a poster style. Click any card to see the example prompt and customise it.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {POSTER_STYLES.map(s => (
                  <button
                    key={s.key}
                    onClick={() => selectStyle(s)}
                    className="group relative rounded-lg overflow-hidden border border-border hover:border-accent-amber transition-all hover:-translate-y-0.5 hover:shadow-lg text-left"
                  >
                    {/* Visual swatch */}
                    <div
                      className="h-28 w-full relative flex items-center justify-center overflow-hidden"
                      style={{ background: `linear-gradient(135deg, ${s.gradientFrom}, ${s.gradientTo})` }}
                    >
                      {/* Decorative pattern */}
                      <div className="absolute inset-0 opacity-20" style={{
                        backgroundImage: `repeating-linear-gradient(45deg, ${s.accentColor}22 0px, ${s.accentColor}22 1px, transparent 1px, transparent 12px)`,
                      }} />
                      {/* Accent blob */}
                      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full opacity-30 blur-2xl" style={{ backgroundColor: s.accentColor }} />
                      <div className="absolute top-2 left-2 right-2">
                        <div className="font-orbitron font-bold text-[10px] tracking-widest uppercase opacity-60 text-white line-clamp-1">
                          {s.label}
                        </div>
                      </div>
                      {/* Center icon */}
                      <div
                        className="w-10 h-10 rounded-lg border-2 flex items-center justify-center opacity-60 group-hover:opacity-90 transition-opacity"
                        style={{ borderColor: s.accentColor, backgroundColor: `${s.accentColor}22` }}
                      >
                        <Layers size={18} style={{ color: s.accentColor }} />
                      </div>
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-white text-[10px] font-rajdhani font-bold uppercase tracking-wider">
                          <Eye size={12} /> Select
                        </div>
                      </div>
                    </div>
                    {/* Label */}
                    <div className="p-2.5 bg-bg-elevated">
                      <div className="font-rajdhani font-bold text-xs text-text-primary leading-tight">{s.label}</div>
                      <div className="text-[9px] text-text-dim mt-0.5 leading-tight line-clamp-2">{s.description}</div>
                    </div>
                    {/* Accent top rail */}
                    <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: s.accentColor }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── CONFIGURE STAGE ── */}
          {stage === 'configure' && selectedStyle && (
            <div className="p-5 space-y-5 max-w-4xl mx-auto">

              {/* Example prompt card */}
              {selectedStyle.examplePrompt && (
                <div className="rounded-lg border border-border overflow-hidden">
                  {/* Gradient header with "Example" label */}
                  <div
                    className="px-4 py-3 flex items-center justify-between"
                    style={{ background: `linear-gradient(135deg, ${selectedStyle.gradientFrom}, ${selectedStyle.gradientTo})` }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: selectedStyle.accentColor }}
                      />
                      <span className="font-rajdhani font-bold text-xs text-white uppercase tracking-wider">Example Output</span>
                    </div>
                    <button
                      onClick={() => setShowExamplePrompt(p => !p)}
                      className="flex items-center gap-1 text-[10px] font-mono text-white/60 hover:text-white transition-colors"
                    >
                      <Eye size={10} /> {showExamplePrompt ? 'Hide' : 'View'} prompt
                    </button>
                  </div>
                  {showExamplePrompt && (
                    <div className="px-4 py-3 bg-bg-elevated border-t border-border">
                      <p className="text-[11px] font-mono text-text-secondary leading-relaxed whitespace-pre-wrap">{selectedStyle.examplePrompt}</p>
                      <button
                        onClick={() => { setUserIntent(selectedStyle.examplePrompt); setShowExamplePrompt(false); }}
                        className="mt-2 text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-accent-amber hover:underline"
                      >
                        Use this as my starting prompt
                      </button>
                    </div>
                  )}
                  {/* Style description */}
                  <div className="px-4 py-2.5 bg-bg-elevated border-t border-border flex items-center gap-2">
                    <div className="text-[10px] text-text-dim leading-relaxed flex-1">{selectedStyle.description}</div>
                    {analysing && (
                      <div className="flex items-center gap-1 text-[10px] text-text-dim">
                        <Loader2 size={10} className="animate-spin" /> Detecting fields...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Dynamic custom fields */}
              {fields.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <label className="text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim">
                      Customise Your Poster
                    </label>
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[9px] font-mono text-text-dim">AI-DETECTED FIELDS</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fields.map(f => (
                      <div key={f.key}>
                        <label className="block text-[10px] font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1">
                          {f.label}
                        </label>
                        <input
                          type="text"
                          value={f.value}
                          onChange={e => updateField(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="input text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Free-form brief */}
              <div>
                <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                  Additional Description <span className="text-text-dim font-normal normal-case text-[10px]">(optional)</span>
                </label>
                <textarea
                  value={userIntent}
                  onChange={e => setUserIntent(e.target.value)}
                  rows={2}
                  placeholder="Any extra details, specific instructions, or freestyle description..."
                  className="input"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleEnhance}
                    disabled={!promptReady}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-btn border border-accent-amber text-accent-amber text-[11px] font-rajdhani font-semibold uppercase tracking-wider hover:bg-accent-amber/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <Wand2 size={12} /> Enhance with AI
                  </button>
                  <span className="text-[10px] text-text-dim">Weave your fields into a detailed prompt</span>
                </div>
              </div>

              {/* Enhanced prompt editor */}
              {enhancedPrompt && (
                <div className="border border-border rounded-btn bg-bg-elevated overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Sparkles size={11} className="text-accent-amber" />
                      <span className="text-[10px] font-mono text-text-dim tracking-widest">AI-ENHANCED PROMPT</span>
                    </div>
                    <button
                      onClick={() => setEditingPrompt(p => !p)}
                      className={clsx('text-[10px] font-mono px-2 py-0.5 rounded transition-colors', editingPrompt ? 'text-accent-amber bg-accent-amber/10' : 'text-text-dim hover:text-accent-amber')}
                    >
                      {editingPrompt ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  {editingPrompt ? (
                    <textarea value={enhancedPrompt} onChange={e => setEnhancedPrompt(e.target.value)} rows={5} className="w-full p-3 bg-transparent text-xs font-mono text-text-primary resize-none focus:outline-none" />
                  ) : (
                    <p className="p-3 text-xs font-mono text-text-secondary leading-relaxed line-clamp-4">{enhancedPrompt}</p>
                  )}
                </div>
              )}

              {/* Hero picture + size */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                    Hero Picture <span className="text-text-dim font-normal normal-case text-[10px]">(optional)</span>
                  </label>
                  <p className="text-[10px] text-text-dim mb-2">Upload a photo of a real person to be composited into the poster.</p>
                  {heroFile ? (
                    <div className="flex items-center gap-3 p-3 border border-border rounded-btn bg-bg-elevated">
                      <div className="p-2 rounded-btn border border-border bg-bg-panel">
                        <User size={16} className="text-accent-cyan" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-text-primary truncate">{heroFile.name}</div>
                        <div className="text-[10px] text-text-dim">Hero photo loaded</div>
                      </div>
                      <button onClick={() => setHeroFile(null)} className="p-1.5 rounded-btn text-text-dim hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-2 p-4 rounded-btn border border-dashed border-border hover:border-accent-cyan hover:bg-accent-cyan/5 transition-all text-text-dim"
                    >
                      <Upload size={20} />
                      <span className="text-[11px] font-rajdhani font-semibold uppercase tracking-wider">Upload photo</span>
                      <span className="text-[10px]">JPG or PNG</span>
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleHeroUpload} />
                </div>

                <div>
                  <label className="block text-xs font-rajdhani font-semibold uppercase tracking-wider text-text-dim mb-1.5">Size</label>
                  <div className="space-y-2">
                    {SIZES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => setSize(s.value)}
                        className={clsx('w-full flex items-center justify-between px-3 py-2.5 rounded-btn border text-left transition-colors', s.value === size ? 'border-accent-amber bg-accent-amber/10' : 'border-border hover:border-text-dim')}
                      >
                        <span className={clsx('font-rajdhani font-bold text-sm', s.value === size ? 'text-accent-amber' : 'text-text-primary')}>{s.label}</span>
                        <span className="text-[10px] text-text-dim">{s.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ENHANCING ── */}
          {stage === 'enhancing' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
              <Loader2 size={40} className="text-accent-amber animate-spin" />
              <div className="font-rajdhani font-bold text-lg text-text-primary">Crafting your poster brief...</div>
              <p className="text-xs text-text-dim font-mono">AI is weaving your choices into a detailed prompt</p>
            </div>
          )}

          {/* ── GENERATING ── */}
          {stage === 'generating' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-accent-amber/20 rounded-full" />
                <div className="absolute inset-0 w-16 h-16 border-4 border-accent-amber border-t-transparent rounded-full animate-spin" />
                <Sparkles size={20} className="absolute inset-0 m-auto text-accent-amber" />
              </div>
              <div className="font-rajdhani font-bold text-lg text-text-primary">Generating your poster...</div>
              <p className="text-xs text-text-dim font-mono max-w-sm">
                {heroFile ? 'Compositing hero photo into the design...' : 'GPT Image 2 is rendering your design...'}
              </p>
              <p className="text-[10px] text-text-dim font-mono">This may take 20–40 seconds</p>
            </div>
          )}

          {/* ── ERROR ── */}
          {stage === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
              <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30">
                <AlertCircle size={32} className="text-red-400" />
              </div>
              <h3 className="font-rajdhani font-bold text-lg text-text-primary">Generation failed</h3>
              <p className="text-xs text-text-secondary max-w-md font-mono whitespace-pre-wrap">{error}</p>
              <button onClick={() => setStage(selectedStyle ? 'configure' : 'gallery')} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">Back</button>
            </div>
          )}

          {/* ── PREVIEW ── */}
          {stage === 'preview' && imageB64 && (
            <div className="flex-1 flex flex-col p-5 gap-4 min-h-0">
              <div className="flex-1 min-h-0 flex items-center justify-center border border-border rounded-btn overflow-hidden bg-neutral-900">
                <img src={`data:${imageMediaType};base64,${imageB64}`} alt="Generated poster" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="shrink-0 border border-border rounded-btn bg-bg-elevated overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <Wand2 size={11} className="text-accent-amber" />
                  <span className="text-[10px] font-mono text-text-dim tracking-widest">PROMPT USED</span>
                </div>
                <p className="p-3 text-xs font-mono text-text-secondary line-clamp-3">{enhancedPrompt || userIntent}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border bg-bg-elevated gap-3">
          <div className="font-mono text-[10px] text-text-dim tracking-wider">
            {stage === 'preview' && saved && <span className="flex items-center gap-1.5 text-accent-green"><CheckCircle2 size={11} /> SAVED TO LIBRARY</span>}
            {stage === 'gallery' && <span className="flex items-center gap-1"><ImageIcon size={11} className="text-accent-amber" /><span className="ml-1">{POSTER_STYLES.length - 1} STYLES · GPT IMAGE 2</span></span>}
            {stage === 'configure' && <span className="flex items-center gap-1"><ImageIcon size={11} className="text-accent-amber" /><span className="ml-1">CONFIGURE · GPT IMAGE 2</span></span>}
            {stage === 'generating' && 'GENERATING...'}
            {stage === 'enhancing' && 'ENHANCING PROMPT...'}
          </div>
          <div className="flex items-center gap-2">
            {stage === 'gallery' && (
              <button onClick={onClose} className="px-4 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors">
                Cancel
              </button>
            )}
            {stage === 'configure' && (
              <>
                <button onClick={() => setStage('gallery')} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1">
                  <ArrowLeft size={13} /> Styles
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!promptReady}
                  className="px-4 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  <Sparkles size={13} /> Generate Poster
                </button>
              </>
            )}
            {stage === 'preview' && (
              <>
                <button onClick={handleReset} className="px-3 py-2 rounded-btn border border-border text-text-secondary hover:text-text-primary text-xs font-rajdhani font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5">
                  <RotateCcw size={13} /> New
                </button>
                <button onClick={handleDownload} className="px-3 py-2 rounded-btn bg-accent-amber text-bg-base font-rajdhani font-bold text-xs uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-1.5">
                  <Download size={13} /> Download
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
