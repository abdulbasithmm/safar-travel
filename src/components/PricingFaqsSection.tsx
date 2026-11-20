import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  HelpCircle,
  Sparkles,
} from 'lucide-react';

interface PricingFaqsSectionProps {
  onPlanClick: () => void;
  onTripsClick: () => void;
}

interface PricingTier {
  id: string;
  name: string;
  price: string;
  cadence: string;
  description: string;
  featured?: boolean;
  ctaLabel: string;
  ctaAction: 'plan' | 'trips';
  highlights: string[];
}

const PRICING_TIERS: PricingTier[] = [
  {
    id: 'explorer',
    name: 'Explorer',
    price: 'Free',
    cadence: 'No card required',
    description:
      'Everything you need to plan day-by-day itineraries, realistic budgets, and interactive maps.',
    ctaLabel: 'Start Planning Free',
    ctaAction: 'plan',
    highlights: [
      'AI-crafted schedules in English & Malayalam (മലയാളം)',
      'Interactive OpenStreetMap routes & driving legs',
      'Live INR, USD & EUR budget breakdown editor',
      'Multi-page PDF download & print-ready view',
    ],
  },
  {
    id: 'voyager',
    name: 'Frequent Voyager',
    price: 'Included',
    cadence: 'With Google Sign-In',
    description:
      'Sync itineraries across devices, collaborate with travel companions, and refine plans via AI chat.',
    featured: true,
    ctaLabel: 'Open My Trips',
    ctaAction: 'trips',
    highlights: [
      'Unlimited private trips stored in Cloud Firestore',
      'One-click public read-only share links & revoke controls',
      'Contextual SAFAR AI follow-up Q&A on active trips',
      'Verified Unsplash & Wikimedia destination galleries',
    ],
  },
  {
    id: 'group',
    name: 'Family & Group Studio',
    price: 'Flexible',
    cadence: 'Up to 30 travelers per trip',
    description:
      'Built for family vacations, weekend clubs, and multi-stop group journeys with shared notes.',
    ctaLabel: 'Plan a Group Trip',
    ctaAction: 'plan',
    highlights: [
      'Group traveler scaling from 1 to 30 passengers',
      'Optional traveler notes inside shared trip pages',
      'WhatsApp, Email & native device quick-share',
      'Stay tiers & regional dining recommendations',
    ],
  },
];

const FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  {
    question: 'How does SAFAR generate personalized itineraries?',
    answer:
      'SAFAR combines your destination, dates, group size, budget currency, travel style, and interests to build a structured day-by-day schedule complete with visiting hours, transit estimates, stays, dining spots, and real landmark photography.',
  },
  {
    question: 'Does SAFAR support Malayalam (മലയാളം) alongside English?',
    answer:
      'Yes. You can write your trip prompt in English or Malayalam, choose Auto, English, or Malayalam as your itinerary language, ask follow-up questions in Malayalam, and export multi-page Unicode PDFs that render Malayalam script cleanly.',
  },
  {
    question: 'How do budget calculations and currencies work?',
    answer:
      'SAFAR estimates accommodation, food, local transportation, and activities in INR (₹), USD ($), or EUR (€). Every category field in the Budget Planner is editable so you can fine-tune numbers and immediately see your updated total.',
  },
  {
    question: 'What powers the Interactive Itinerary Map?',
    answer:
      'Maps use OpenStreetMap data via Leaflet with geocoded attraction pins, day-by-day color filtering, and driving distance and travel-time legs between consecutive stops so you can inspect pacing visually.',
  },
  {
    question: 'How do PDF export and Print Trip handle my schedule?',
    answer:
      'Download PDF formats your full itinerary—including overview, notes, budget table, schedule, stays, food, and tips—into cleanly paginated A4 pages. Print Trip uses a dedicated print stylesheet that hides navigation chrome automatically.',
  },
  {
    question: 'Are public Share Trip links safe and private?',
    answer:
      'Yes. Public share links are created only when you explicitly publish a snapshot, exclude your email, profile photo, and raw prompts, let you toggle whether personal notes appear, and can be revoked immediately anytime.',
  },
];

export default function PricingFaqsSection({
  onPlanClick,
  onTripsClick,
}: PricingFaqsSectionProps) {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  return (
    <>
      {/* PRICING SECTION */}
      <section
        id="pricing"
        data-print-hide="true"
        className="w-full bg-gradient-to-b from-white via-safar-skySoft to-safar-sky/60 text-safar-navy border-t border-safar-border"
      >
        <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <p className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
                SAFAR Access · Simple &amp; Transparent
              </p>
              <h2 className="font-sans text-[clamp(28px,3.6vw,42px)] font-semibold tracking-[-0.03em] text-safar-navy leading-tight">
                Built for solo escapes and group adventures
              </h2>
            </div>
            <p className="text-sm text-safar-slate max-w-md leading-relaxed">
              Every core planning tool—AI itinerary generation, live maps, bilingual support, and PDF export—is ready from day one.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {PRICING_TIERS.map((tier) => {
              const isFeatured = Boolean(tier.featured);
              return (
                <article
                  key={tier.id}
                  className={`rounded-[24px] p-7 flex flex-col justify-between gap-6 transition-all duration-200 ${
                    isFeatured
                      ? 'bg-safar-navy text-white border border-safar-navy shadow-[0_18px_40px_rgba(15,37,68,0.16)]'
                      : 'bg-white text-safar-navy border border-safar-border shadow-[0_6px_24px_rgba(15,37,68,0.04)] hover:shadow-[0_12px_30px_rgba(15,37,68,0.08)]'
                  }`}
                >
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className={`text-lg font-semibold ${
                          isFeatured ? 'text-white' : 'text-safar-navy'
                        }`}
                      >
                        {tier.name}
                      </h3>
                      {isFeatured && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-safar-orange px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-white">
                          <Sparkles className="w-3 h-3" aria-hidden="true" />
                          Most Used
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline gap-2.5">
                      <span
                        className={`text-3xl font-semibold tracking-[-0.02em] tabular-nums ${
                          isFeatured ? 'text-white' : 'text-safar-navy'
                        }`}
                      >
                        {tier.price}
                      </span>
                      <span
                        className={`text-xs ${
                          isFeatured ? 'text-blue-200' : 'text-safar-slate'
                        }`}
                      >
                        {tier.cadence}
                      </span>
                    </div>

                    <p
                      className={`text-sm leading-relaxed ${
                        isFeatured ? 'text-blue-100/90' : 'text-safar-slate'
                      }`}
                    >
                      {tier.description}
                    </p>

                    <ul
                      className={`space-y-3 pt-4 border-t ${
                        isFeatured ? 'border-white/15' : 'border-safar-border'
                      }`}
                    >
                      {tier.highlights.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2.5 text-sm leading-snug"
                        >
                          <Check
                            className={`w-4 h-4 mt-0.5 shrink-0 ${
                              isFeatured ? 'text-safar-orange' : 'text-safar-orange'
                            }`}
                            aria-hidden="true"
                          />
                          <span
                            className={
                              isFeatured ? 'text-white/95' : 'text-safar-navy/90'
                            }
                          >
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      tier.ctaAction === 'trips' ? onTripsClick() : onPlanClick()
                    }
                    className={`cursor-pointer w-full inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-xs font-semibold uppercase tracking-[0.04em] transition-colors whitespace-nowrap ${
                      isFeatured
                        ? 'bg-safar-orange text-white hover:bg-safar-orangeHover'
                        : 'bg-safar-navy text-white hover:bg-safar-navyHover'
                    }`}
                  >
                    {tier.ctaLabel}
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQS SECTION */}
      <section
        id="faqs"
        data-print-hide="true"
        className="w-full bg-white text-safar-navy border-t border-safar-border"
      >
        <div className="max-w-[1200px] mx-auto px-6 py-16 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
            <div className="lg:col-span-5 space-y-4">
              <p className="inline-flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-[0.08em] text-safar-orange">
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                Frequently Asked Questions
              </p>
              <h2 className="font-sans text-[clamp(28px,3.4vw,38px)] font-semibold tracking-[-0.03em] text-safar-navy leading-tight">
                Answers for smoother trip planning
              </h2>
              <p className="text-sm text-safar-slate leading-relaxed">
                Learn how SAFAR builds bilingual itineraries, calculates realistic budgets, maps routes, and keeps your shared links under your control.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onPlanClick}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-safar-border bg-safar-skySoft px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-navy transition-colors hover:bg-safar-sky whitespace-nowrap"
                >
                  Start Planning in Studio
                  <ArrowRight className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-3">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div
                    key={item.question}
                    className={`rounded-2xl border transition-colors ${
                      isOpen
                        ? 'border-safar-navy/25 bg-safar-skySoft/60'
                        : 'border-safar-border bg-white hover:bg-safar-skySoft/35'
                    }`}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      className="cursor-pointer w-full px-5 py-4 text-left flex items-center justify-between gap-4"
                    >
                      <span className="text-sm md:text-base font-medium text-safar-navy">
                        {item.question}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                          isOpen
                            ? 'rotate-180 text-safar-orange'
                            : 'text-safar-slate'
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-5 text-sm text-safar-slate leading-relaxed">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
