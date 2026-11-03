interface ViolationBannerProps {
  invalidReasons: string[];
  visible: boolean;
}

export default function ViolationBanner({ invalidReasons, visible }: ViolationBannerProps) {
  return (
    <div
      className={`absolute top-[58px] left-1/2 -translate-x-1/2 z-50 w-full max-w-[380px] pointer-events-none transition-all duration-200 ease-out
        ${visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-1 scale-95'}`}
    >
      <div className="bg-surface-0/95 backdrop-blur-sm border border-red-200/60 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.10),0_1px_4px_rgba(0,0,0,0.06)] px-5 py-2.5 flex flex-col gap-1">
        <span className="text-xs font-semibold text-red-600 leading-none">Invalid placement</span>
        <div className="space-y-1">
          {invalidReasons.map((reason, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2.5 text-sm font-medium text-surface-700 leading-tight"
            >
              <span className="text-red-400 mt-[5.5px] w-1.5 h-1.5 rounded-full bg-current shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
