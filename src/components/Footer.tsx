interface FooterProps {
  onPlanClick: () => void;
  onTripsClick: () => void;
}

export default function Footer({ onPlanClick, onTripsClick }: FooterProps) {
  return (
    <footer
      data-print-hide="true"
      className="w-full bg-safar-navy text-white border-t border-safar-navy"
    >
      <div className="max-w-[1200px] mx-auto px-6 py-12 md:py-16 flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="space-y-2.5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl text-white leading-none select-none">
              SAFAR
            </span>
            <span
              lang="ar"
              dir="rtl"
              className="font-sans text-lg font-medium text-safar-orange leading-none"
            >
              سفر
            </span>
          </div>
          <p className="text-sm font-medium text-white">
            Your Journey, Your Story.
          </p>
          <p className="text-xs text-blue-100/80 max-w-md leading-relaxed">
            Thoughtful itineraries, interactive OpenStreetMap routes, curated
            destination photography, and realistic travel budgets powered by Safar.
          </p>
        </div>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-center gap-6 text-xs font-medium uppercase tracking-[0.04em] text-blue-100"
        >
          <a
            href="#planner"
            onClick={onPlanClick}
            className="hover:text-safar-orange transition-colors whitespace-nowrap"
          >
            Plan Trip
          </a>
          <a
            href="#destinations"
            className="hover:text-safar-orange transition-colors whitespace-nowrap"
          >
            Discover
          </a>
          <a
            href="#planner"
            onClick={onTripsClick}
            className="hover:text-safar-orange transition-colors whitespace-nowrap"
          >
            My Trips
          </a>
          <a
            href="#pricing"
            className="hover:text-safar-orange transition-colors whitespace-nowrap"
          >
            Pricing
          </a>
          <a
            href="#faqs"
            className="hover:text-safar-orange transition-colors whitespace-nowrap"
          >
            FAQs
          </a>
        </nav>

        <div className="text-xs text-blue-200/80 md:text-right space-y-1">
          <p>© {new Date().getFullYear()} SAFAR (سفر). All rights reserved.</p>
          <p>
            Maps via OpenStreetMap · Photography via Unsplash &amp; Wikimedia Commons.
          </p>
        </div>
      </div>
    </footer>
  );
}
