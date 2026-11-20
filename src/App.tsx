/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import DestinationGallery from '@/components/DestinationGallery';
import Footer from '@/components/Footer';
import Hero from '@/components/Hero';
import PricingFaqsSection from '@/components/PricingFaqsSection';
import SharedTripView from '@/components/SharedTripView';
import TripPlanner from '@/components/TripPlanner';
import type { HeroTriggerPayload } from '@/components/TripPlanner';
import { AuthProvider } from '@/context/AuthContext';

function readShareIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const val = new URLSearchParams(window.location.search).get('share');
  return val && val.trim() ? val.trim() : null;
}

export default function App() {
  const [heroTrigger, setHeroTrigger] = useState<HeroTriggerPayload | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(() =>
    readShareIdFromUrl(),
  );

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    const handlePopState = () => setActiveShareId(readShareIdFromUrl());
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const handlePlanOwnTrip = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('share');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setActiveShareId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToPlanner = () => {
    const el = document.getElementById('planner');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AuthProvider>
      <div>
        {activeShareId ? (
          <SharedTripView
            shareId={activeShareId}
            onPlanOwnTrip={handlePlanOwnTrip}
          />
        ) : (
          <>
            {mapsQuotaExceeded && (
              <div
                data-print-hide="true"
                className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm"
              >
                <span>
                  Google Maps Platform quota reached. If you are the app owner, visit{' '}
                  <a
                    href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold text-amber-950 hover:text-amber-800"
                  >
                    maps developer site
                  </a>{' '}
                  for instructions to update your account.
                </span>
              </div>
            )}
            <Hero
              onPlanRequest={(prompt) => {
                setHeroTrigger({ id: Date.now(), prompt, mode: 'plan' });
                scrollToPlanner();
              }}
              onOpenTrips={() => {
                setHeroTrigger({ id: Date.now(), prompt: '', mode: 'trips' });
                scrollToPlanner();
              }}
            />
            <TripPlanner heroTrigger={heroTrigger} />
            <DestinationGallery
              onSelectDestinationForTrip={(destinationName) => {
                setHeroTrigger({
                  id: Date.now(),
                  prompt: '',
                  mode: 'plan',
                  destination: destinationName,
                });
                scrollToPlanner();
              }}
            />
            <PricingFaqsSection
              onPlanClick={() => {
                setHeroTrigger({ id: Date.now(), prompt: '', mode: 'plan' });
                scrollToPlanner();
              }}
              onTripsClick={() => {
                setHeroTrigger({ id: Date.now(), prompt: '', mode: 'trips' });
                scrollToPlanner();
              }}
            />
            <Footer
              onPlanClick={() => {
                setHeroTrigger({ id: Date.now(), prompt: '', mode: 'plan' });
                scrollToPlanner();
              }}
              onTripsClick={() => {
                setHeroTrigger({ id: Date.now(), prompt: '', mode: 'trips' });
                scrollToPlanner();
              }}
            />
          </>
        )}
      </div>
    </AuthProvider>
  );
}

