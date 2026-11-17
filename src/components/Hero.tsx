import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Upload } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const HERO_VIDEO_SRC =
  'https://pollen-batch-41236914.figma.site/_components/v2/f0ee2dae7671c170c34f12e31c4cb41418976c98/769c564298c132f7919405cd9f17c1b1231f341d.769c5642.mp4';

const PROMPT_TEXT =
  "I'm planning a 7-day trip to Japan in October. I love food, hidden cafes, scenic hikes, and want to avoid crowds....";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    user,
    authReady,
    authLoading,
    authError,
    signInWithGoogle,
    logout,
    clearAuthError,
  } = useAuth();

  const [userPrompt, setUserPrompt] = useState('');
  const [uploadName, setUploadName] = useState<string | null>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadName(file.name);
  };

  const handleAuthAction = async () => {
    clearAuthError();
    if (user) {
      await logout();
    } else {
      await signInWithGoogle();
    }
  };

  const handlePlanTrip = () => {
    const promptToSend = userPrompt.trim() || PROMPT_TEXT;
    onPlanRequest(promptToSend);
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handlePlanTrip();
    }
  };

  return (
    <section className="relative min-h-svh w-full overflow-hidden">
      <video
        className="absolute inset-0 w-full h-full object-cover z-0"
        src={HERO_VIDEO_SRC}
        autoPlay
        muted
        loop
        playsInline
      />

      <div
        className="absolute inset-x-0 top-0 h-[687px] pointer-events-none z-[1]"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)',
        }}
      />

      <div className="relative z-[2] max-w-[1360px] mx-auto">
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

        <div className="flex flex-col items-center px-6 pt-16 pb-24 text-center">
          <h1 className="font-sans text-[clamp(40px,6vw,68px)] font-medium text-wandor-text leading-[1.05] tracking-[-0.04em] max-w-[820px] mb-5">
            Where will you go next?
          </h1>
          <p className="font-sans text-xl font-medium text-wandor-muted leading-relaxed max-w-[520px] mb-10">
            Your Journey, Your Story. Tell Safar where you&apos;re going and what
            you love — we&apos;ll create a personalized itinerary for you.
          </p>

          <div className="relative w-[701px] max-md:w-[calc(100vw-48px)] min-h-[208px] bg-white/[0.06] border-[3px] border-white rounded-[44px] shadow-[0_0_4px_0_rgba(0,0,0,0.15)] overflow-hidden backdrop-blur-[20px]">
            {!userPrompt && (
              <p
                aria-hidden="true"
                className="pointer-events-none absolute left-[29px] top-[57px] -translate-y-1/2 w-[609px] max-md:w-[calc(100%-58px)] font-sans text-xl max-md:text-[17px] font-medium text-wandor-prompt leading-relaxed break-words text-left"
              >
                {PROMPT_TEXT}
              </p>
            )}

            <textarea
              value={userPrompt}
              onChange={(event) => setUserPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              aria-label="Travel prompt in English or Malayalam"
              rows={3}
              maxLength={2000}
              className="absolute left-[29px] top-[25px] w-[609px] max-md:w-[calc(100%-58px)] h-[96px] bg-transparent border-none outline-none resize-none font-sans text-xl max-md:text-[17px] font-medium text-wandor-prompt leading-relaxed text-left"
            />

            <button
              type="button"
              onClick={handlePlanTrip}
              className="absolute bottom-[21px] right-[21px] w-[156px] h-14 bg-black border-none rounded-[44px] shadow-[0_0_2px_0_rgba(0,0,0,0.05)] cursor-pointer flex items-center justify-center font-sans text-base font-medium text-[#fafafa] uppercase tracking-[0.02em] transition-all hover:bg-[#333] active:scale-95"
            >
              Plan My Trip
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              type="button"
              aria-label="Upload inspiration"
              onClick={handleUploadClick}
              className="absolute left-[21px] top-[137px] w-11 h-11 bg-transparent border border-white/70 rounded-full cursor-pointer flex items-center justify-center backdrop-blur-[14px] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
            >
              <Upload className="w-[18px] h-[18px] text-wandor-text flex-shrink-0" />
            </button>
          </div>

          {(authError || uploadName) && (
            <p
              role={authError ? 'alert' : 'status'}
              className={`mt-4 max-w-[660px] rounded-full px-4 py-2 text-sm font-medium backdrop-blur-md ${
                authError
                  ? 'bg-white/90 text-red-700 shadow-sm'
                  : 'bg-white/85 text-wandor-text shadow-sm'
              }`}
            >
              {authError || `Inspiration attached: ${uploadName}`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
