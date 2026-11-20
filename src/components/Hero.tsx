import SafarHeroBackground from '@/components/SafarHeroBackground';
import { useAuth } from '@/context/AuthContext';

interface NavButtonProps {
  label: string;
  onClick?: () => void;
}

function NavButton({ label, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-transparent border-none cursor-pointer font-sans text-[15px] font-medium uppercase text-wandor-text tracking-[0.04em] transition-opacity hover:opacity-55 whitespace-nowrap"
    >
      {label}
    </button>
  );
}

interface HeroProps {
  onPlanRequest: (prompt: string) => void;
  onOpenTrips: () => void;
}

export default function Hero({ onPlanRequest, onOpenTrips }: HeroProps) {
  const {
    user,
    authReady,
    authLoading,
    authError,
    signInWithGoogle,
    logout,
    clearAuthError,
  } = useAuth();

  const handleAuthAction = async () => {
    clearAuthError();
    if (user) {
      await logout();
    } else {
      await signInWithGoogle();
    }
  };

  const handlePlanTrip = () => {
    onPlanRequest('');
  };

  return (
    <section
      data-print-hide="true"
      className="relative min-h-svh w-full overflow-hidden flex flex-col"
    >
      <SafarHeroBackground />

      <div className="relative z-[2] w-full max-w-[1360px] mx-auto flex-1 flex flex-col">
        <nav className="relative flex items-center justify-between px-20 pt-6 pb-4 max-md:px-6 max-md:pt-5">
          <div className="flex items-baseline gap-2.5 select-none">
            <span className="font-display text-[38px] max-md:text-[30px] text-black leading-none">
              SAFAR
            </span>
            <span
              lang="ar"
              dir="rtl"
              className="font-sans text-lg max-md:text-base font-medium text-wandor-muted leading-none"
            >
              سفر
            </span>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 flex gap-8 max-md:hidden">
            <NavButton label="Discover" onClick={onOpenTrips} />
            <NavButton label="Pricing" onClick={() => onPlanRequest('')} />
            <NavButton label="FAQs" onClick={() => onPlanRequest('')} />
          </div>

          <div className="flex items-center gap-8">
            <button
              type="button"
              disabled={!authReady || authLoading}
              onClick={handleAuthAction}
              className="max-md:hidden bg-transparent border-none cursor-pointer font-sans text-[15px] font-semibold uppercase text-[#292929] tracking-[0.04em] transition-opacity hover:opacity-55 disabled:opacity-45 whitespace-nowrap"
            >
              {authLoading ? 'Signing in...' : user ? 'Logout' : 'Login'}
            </button>
            <button
              type="button"
              onClick={handlePlanTrip}
              className="bg-wandor-dark text-[#fafafa] border-none cursor-pointer font-sans text-[15px] font-medium uppercase tracking-[0.04em] px-5 py-3.5 rounded-full transition-all hover:bg-[#333] active:scale-95 whitespace-nowrap"
            >
              Plan My Trip
            </button>
          </div>
        </nav>

        <div className="flex-1 flex flex-col items-center justify-center px-6 pt-0 pb-[90px] max-md:pb-[76px] text-center">
          <h1 className="font-sans text-[clamp(40px,6vw,68px)] font-semibold text-wandor-text leading-[1.06] tracking-[-0.04em] max-w-[820px] mb-5">
            Where will you go next?
          </h1>
          <p className="font-sans text-xl max-md:text-[17px] font-medium text-[#4a4a4a] leading-relaxed max-w-[540px]">
            Your Journey, Your Story. Tell Safar where you&apos;re going and what
            you love — we&apos;ll create a personalized itinerary for you.
          </p>

          {authError && (
            <p
              role="alert"
              className="mt-6 max-w-[660px] rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-red-700 shadow-sm backdrop-blur-md"
            >
              {authError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
