interface EdgeSelectOverlayProps {
  visible: boolean;
  onSkip: () => void;
}

export default function EdgeSelectOverlay({ visible, onSkip }: EdgeSelectOverlayProps) {
  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes card-pulse {
          0%, 100% { 
            box-shadow: 0 4px 16px rgba(0,0,0,0.12); 
            transform: scale(1);
          }
          50% { 
            box-shadow: 0 0 0 5px rgba(16,185,129,0.5), 0 0 0 16px rgba(16,185,129,0.25), 0 8px 32px rgba(0,0,0,0.2);
            transform: scale(1.012);
          }
        }
      `}</style>
      <div className="absolute top-[4rem] left-1/2 -translate-x-1/2 z-30 animate-in fade-in slide-in-from-top-2 duration-300">
        <div
          className="bg-white/95 backdrop-blur-sm rounded-xl border-t-[3px] border-emerald-500 px-6 py-4 max-w-md text-center"
          style={{ animation: 'card-pulse 1.2s ease-in-out infinite' }}
        >
          <p className="text-xs text-slate-500 leading-relaxed">
            <span className="block text-sm font-bold text-slate-700">
              Click the middle of your front yard
            </span>
            <span className="block">
              This helps us determine accurate yard zones for your property
            </span>
          </p>
          <button
            onClick={onSkip}
            className="mt-3 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip this step
          </button>
        </div>
      </div>
    </>
  );
}
