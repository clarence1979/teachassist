import { useEffect, useState } from 'react';
import { TeachAssistIcon } from './TeachAssistLogo';

export function IframeWaitScreen() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '.')), 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-bg-base grid-bg">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-bg-elevated border border-border">
            <TeachAssistIcon size={32} className="text-accent-cyan" />
          </div>
        </div>
        <h1 className="font-orbitron text-2xl font-bold text-accent-cyan tracking-widest">
          TEACH ASSIST
        </h1>
        <p className="text-xs font-mono text-text-dim">
          Waiting for credentials{dots}
        </p>
      </div>
    </div>
  );
}
