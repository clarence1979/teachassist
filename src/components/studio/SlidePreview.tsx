import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Presentation, StickyNote, Maximize2, Minimize2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { SlideDeck } from '../../lib/studio/slideSchema';
import type { SlideTheme } from '../../lib/studio/slideThemes';

interface Props {
  deck: SlideDeck;
  theme: SlideTheme;
}

export function SlidePreview({ deck, theme }: Props) {
  const [idx, setIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const slide = deck.slides[idx];
  const isTitle = slide?.layout === 'title' || idx === 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, deck.slides.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Home') {
        setIdx(0);
      } else if (e.key === 'End') {
        setIdx(deck.slides.length - 1);
      } else if (e.key === 'n' || e.key === 'N') {
        setShowNotes((s) => !s);
      } else if (e.key === 'Escape') {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deck.slides.length]);

  if (!slide) return null;

  // ─── Slide renderer (scales with aspect ratio 16:9) ───────────────────────

  const bg = isTitle ? theme.titleBackground : theme.background;
  const isLight = parseInt(theme.background, 16) > 0x808080;

  return (
    <div
      className={clsx(
        'flex flex-col min-h-0',
        fullscreen
          ? 'fixed inset-0 z-50 bg-bg-base p-6'
          : 'h-full',
      )}
    >
      {/* Slide viewport */}
      <div className="flex-1 min-h-0 flex items-center justify-center relative">
        <div
          className="relative w-full max-w-5xl aspect-video border border-border shadow-xl"
          style={{ backgroundColor: `#${bg}` }}
        >
          {isTitle ? (
            <TitleLayout deck={deck} slide={slide} theme={theme} index={idx} />
          ) : (
            <ContentLayout slide={slide} theme={theme} />
          )}

          {/* Slide number */}
          {!isTitle && (
            <div
              className="absolute bottom-[3%] right-[3%] font-mono text-[0.9vw]"
              style={{ color: `#${theme.textSecondary}` }}
            >
              {idx + 1} / {deck.slides.length}
            </div>
          )}
        </div>

        {/* Arrows */}
        <button
          onClick={() => setIdx((i) => Math.max(i - 1, 0))}
          disabled={idx === 0}
          aria-label="Previous slide"
          className="absolute left-2 p-2 rounded-full border border-border bg-bg-panel text-text-dim hover:text-accent-cyan hover:border-accent-cyan disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => setIdx((i) => Math.min(i + 1, deck.slides.length - 1))}
          disabled={idx >= deck.slides.length - 1}
          aria-label="Next slide"
          className="absolute right-2 p-2 rounded-full border border-border bg-bg-panel text-text-dim hover:text-accent-cyan hover:border-accent-cyan disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={18} />
        </button>

        {/* Top controls */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            onClick={() => setShowNotes((s) => !s)}
            aria-label="Toggle speaker notes"
            className={clsx(
              'p-1.5 rounded-btn border transition-colors',
              showNotes
                ? 'border-accent-cyan text-accent-cyan bg-bg-elevated'
                : 'border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan',
            )}
          >
            <StickyNote size={13} />
          </button>
          <button
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="p-1.5 rounded-btn border border-border text-text-dim hover:text-accent-cyan hover:border-accent-cyan transition-colors"
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Thumbnails strip */}
      <div className="shrink-0 mt-3 flex gap-1.5 overflow-x-auto pb-2">
        {deck.slides.map((sl, i) => {
          const active = i === idx;
          const thumbBg = (sl.layout === 'title' || i === 0) ? theme.titleBackground : theme.background;
          return (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={clsx(
                'shrink-0 w-24 aspect-video border transition-all relative text-left overflow-hidden',
                active ? 'border-accent-cyan' : 'border-border hover:border-text-dim',
              )}
              style={{ backgroundColor: `#${thumbBg}` }}
            >
              <div
                className="absolute top-1 left-1 right-1 font-rajdhani font-semibold text-[8px] leading-tight line-clamp-2"
                style={{ color: `#${theme.textPrimary}` }}
              >
                {sl.title}
              </div>
              <div
                className="absolute bottom-0.5 right-1 font-mono text-[7px]"
                style={{ color: `#${theme.textSecondary}` }}
              >
                {i + 1}
              </div>
            </button>
          );
        })}
      </div>

      {/* Speaker notes */}
      {showNotes && slide.speakerNotes && (
        <div className="shrink-0 mt-2 p-3 bg-bg-elevated border border-border rounded-btn max-h-32 overflow-y-auto">
          <div className="flex items-center gap-2 mb-1">
            <Presentation size={11} className="text-accent-cyan" />
            <span className="text-xs font-rajdhani font-semibold text-text-secondary uppercase tracking-wider">
              Speaker notes
            </span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
            {slide.speakerNotes}
          </p>
        </div>
      )}

      {/* Keyboard hint */}
      <div className="shrink-0 mt-1 text-center text-xs font-mono text-text-dim">
        <kbd className="px-1 py-0.5 bg-bg-elevated border border-border rounded text-[10px]">←</kbd>
        <kbd className="ml-1 px-1 py-0.5 bg-bg-elevated border border-border rounded text-[10px]">→</kbd>
        <span className="ml-2">navigate</span>
        <kbd className="ml-3 px-1 py-0.5 bg-bg-elevated border border-border rounded text-[10px]">N</kbd>
        <span className="ml-1">notes</span>
        {!isLight && null}
      </div>
    </div>
  );
}

// ─── Layouts ──────────────────────────────────────────────────────────────────

function TitleLayout({
  deck,
  slide,
  theme,
  index,
}: {
  deck: SlideDeck;
  slide: SlideDeck['slides'][0];
  theme: SlideTheme;
  index: number;
}) {
  const subtitle = slide.bullets[0] ?? deck.subtitle;
  return (
    <div className="absolute inset-0 p-[4%] flex flex-col justify-center">
      {index === 0 && deck.yearLevel && (
        <div
          className="font-mono text-[1vw] tracking-[0.3em] font-bold mb-[3%]"
          style={{ color: `#${theme.accent}` }}
        >
          {deck.yearLevel.toUpperCase()}
        </div>
      )}
      <div
        className="h-[0.3vw] w-[10%] mb-[2%]"
        style={{ backgroundColor: `#${theme.accent}` }}
      />
      <h1
        className="font-bold leading-tight"
        style={{
          color: `#${theme.textPrimary}`,
          fontFamily: `'${theme.fontHeading}', sans-serif`,
          fontSize: '3.4vw',
        }}
      >
        {slide.title}
      </h1>
      {subtitle && (
        <p
          className="mt-[2%] leading-snug"
          style={{
            color: `#${theme.textSecondary}`,
            fontFamily: `'${theme.fontBody}', sans-serif`,
            fontSize: '1.5vw',
          }}
        >
          {subtitle}
        </p>
      )}
      <div
        className="absolute bottom-[4%] left-[4%] font-mono text-[0.7vw] tracking-[0.3em]"
        style={{ color: `#${theme.accentSecondary}` }}
      >
        TEACH ASSIST
      </div>
    </div>
  );
}

function ContentLayout({ slide, theme }: { slide: SlideDeck['slides'][0]; theme: SlideTheme }) {
  const hasImage = !!slide.imageBase64;
  return (
    <div className="absolute inset-0 p-[4%] flex flex-col">
      <h2
        className="font-bold leading-tight"
        style={{
          color: `#${theme.textPrimary}`,
          fontFamily: `'${theme.fontHeading}', sans-serif`,
          fontSize: '2.1vw',
        }}
      >
        {slide.title}
      </h2>
      <div
        className="mt-[0.8%] h-[0.3vw] w-[5%]"
        style={{ backgroundColor: `#${theme.rule}` }}
      />
      <div className={clsx('flex-1 mt-[2%] flex gap-[3%]', hasImage ? 'flex-row' : 'flex-col')}>
        <ul
          className={clsx('space-y-[1.2vw]', hasImage ? 'flex-1' : 'flex-1')}
          style={{
            color: `#${theme.textPrimary}`,
            fontFamily: `'${theme.fontBody}', sans-serif`,
            fontSize: '1.3vw',
            lineHeight: 1.4,
          }}
        >
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex gap-[0.8vw] items-start">
              <span
                className="shrink-0 mt-[0.5vw]"
                style={{
                  backgroundColor: `#${theme.accent}`,
                  width: '0.6vw',
                  height: '0.6vw',
                }}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        {hasImage && (
          <div
            className="flex-1 flex items-center justify-center border"
            style={{ borderColor: `#${theme.rule}20` }}
          >
            <img
              src={`data:image/png;base64,${slide.imageBase64}`}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}
      </div>
    </div>
  );
}
