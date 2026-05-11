type SchoolLogoProps = {
  compact?: boolean;
};

export function SchoolLogo({ compact = false }: SchoolLogoProps) {
  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-3" : "gap-4"}`}>
      <img
        src="/icons/kcs-logo.jpg"
        alt="KCS School logo"
        className={compact ? "h-12 w-12 shrink-0 rounded-full bg-white object-cover" : "h-16 w-16 shrink-0 rounded-full bg-white object-cover shadow-glow"}
      />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan sm:text-xs sm:tracking-[0.34em]">KCS School</div>
        <div className={compact ? "text-lg font-semibold text-white break-words" : "text-xl font-semibold text-white break-words sm:text-2xl"}>SENTINEL Gate</div>
      </div>
    </div>
  );
}