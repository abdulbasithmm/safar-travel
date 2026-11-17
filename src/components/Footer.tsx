interface FooterProps {
  onPlanClick: () => void;
  onTripsClick: () => void;
}

export default function Footer({ onPlanClick, onTripsClick }: FooterProps) {
  return (
    <footer className="w-full bg-white text-wandor-text border-t border-black/10">
      <div className="max-w-[1200px] mx-auto px-6 py-12 md:py-14 flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="space-y-2">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl text-black leading-none select-none">
              SAFAR
            </span>
            <span
              lang="ar"
              dir="rtl"
              className="font-sans text-lg font-medium text-wandor-prompt leading-none"
            >
              سفر
            </span>
          </div>
          <p className="text-sm font-medium text-wandor-text">
            Your Journey, Your Story.
          </p>
          <p className="text-xs text-wandor-muted max-w-md">
            Thoughtful itineraries, curated destination photography, and realistic
            travel budgets powered by Safar.
          </p>
        </div>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-center gap-6 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text"
        >
          <a href="#planner" onClick={onPlanClick} className="hover:opacity-60 transition-opacity">
            Plan Trip
          </a>
          <a href="#destinations" className="hover:opacity-60 transition-opacity">
            Destinations
          </a>
          <a href="#planner" onClick={onTripsClick} className="hover:opacity-60 transition-opacity">
            My Trips
          </a>
        </nav>

        <div className="text-xs text-wandor-muted md:text-right">
          <p>© {new Date().getFullYear()} SAFAR (سفر). All rights reserved.</p>
          <p className="mt-1">Photography via Unsplash &amp; Wikimedia Commons.</p>
        </div>
      </div>
    </footer>
  );
}
