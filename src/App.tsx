/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import DestinationGallery from '@/components/DestinationGallery';
import Footer from '@/components/Footer';
import Hero from '@/components/Hero';
import TripPlanner from '@/components/TripPlanner';
import type { HeroTriggerPayload } from '@/components/TripPlanner';
import { AuthProvider } from '@/context/AuthContext';

export default function App() {
  const [heroTrigger, setHeroTrigger] = useState<HeroTriggerPayload | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  const scrollToPlanner = () => {
    const el = document.getElementById('planner');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AuthProvider>
      <div>
        {mapsQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
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
      </div>
    </AuthProvider>
  );
}

