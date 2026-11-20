import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Compass,
  Globe,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Settings,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import type {
  CurrencyCode,
  PreferredLanguage,
  TravelStyle,
  TripRecord,
} from '@/types/trip';

export interface PlannerPreferences {
  startingLocation: string;
  currency: CurrencyCode;
  language: PreferredLanguage;
  travelStyle: TravelStyle;
  travelers: number;
}

export const DEFAULT_PLANNER_PREFERENCES: PlannerPreferences = {
  startingLocation: 'Kochi',
  currency: 'INR',
  language: 'auto',
  travelStyle: 'family',
  travelers: 2,
};

interface ProfileSettingsPanelProps {
  user: User | null;
  authReady: boolean;
  authLoading: boolean;
  savedTrips: TripRecord[];
  preferences: PlannerPreferences;
  onSavePreferences: (next: PlannerPreferences) => void;
  onSignIn: () => Promise<User | null>;
  onSignOut: () => Promise<void>;
  onNavigateTab: (tab: 'plan' | 'trips') => void;
}

const CURRENCIES: Array<{ code: CurrencyCode; label: string }> = [
  { code: 'INR', label: 'INR (₹) — Indian Rupee' },
  { code: 'USD', label: 'USD ($) — US Dollar' },
  { code: 'EUR', label: 'EUR (€) — Euro' },
];

const TRAVEL_STYLES: Array<{ id: TravelStyle; label: string }> = [
  { id: 'family', label: 'Family' },
  { id: 'solo', label: 'Solo' },
  { id: 'couple', label: 'Couple' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'budget', label: 'Budget' },
  { id: 'luxury', label: 'Luxury' },
];

export default function ProfileSettingsPanel({
  user,
  authReady,
  authLoading,
  savedTrips,
  preferences,
  onSavePreferences,
  onSignIn,
  onSignOut,
  onNavigateTab,
}: ProfileSettingsPanelProps) {
  const [draft, setDraft] = useState<PlannerPreferences>(preferences);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const tripStats = useMemo(() => {
    const plannedCount = savedTrips.filter((t) => t.status === 'planned').length;
    const totalDays = savedTrips.reduce(
      (sum, t) => sum + (t.durationDays || t.dailyItinerary.length || 0),
      0,
    );
    const uniqueDestinations = new Set(
      savedTrips
        .map((t) => t.destination.trim().toLowerCase())
        .filter(Boolean),
    ).size;

    return {
      totalTrips: savedTrips.length,
      plannedCount,
      totalDays,
      uniqueDestinations,
    };
  }, [savedTrips]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned: PlannerPreferences = {
      startingLocation: draft.startingLocation.trim().slice(0, 200) || 'Kochi',
      currency: draft.currency,
      language: draft.language,
      travelStyle: draft.travelStyle,
      travelers: Math.min(Math.max(Math.round(draft.travelers || 1), 1), 30),
    };
    onSavePreferences(cleaned);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 3000);
  };

  const userInitial =
    (user?.displayName?.trim()?.[0] || user?.email?.trim()?.[0] || 'S').toUpperCase();

  return (
    <div className="mt-8 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Account Overview Card */}
        <div className="lg:col-span-5 rounded-[24px] border border-safar-border bg-gradient-to-br from-safar-skySoft via-white to-white p-6 md:p-7 flex flex-col justify-between gap-6 shadow-[0_8px_28px_rgba(15,37,68,0.04)]">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-safar-orange">
                <UserIcon className="w-3.5 h-3.5" aria-hidden="true" />
                Account Overview
              </span>
              {user && (
                <span className="inline-flex items-center gap-1 rounded-full bg-safar-sky px-3 py-1 text-[11px] font-medium text-safar-navy">
                  <ShieldCheck className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                  Google Verified
                </span>
              )}
            </div>

            {!authReady ? (
              <div className="h-20 rounded-2xl bg-safar-sky/60 animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-4">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'SAFAR traveler avatar'}
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-2xl object-cover border border-safar-border shadow-xs shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-safar-navy text-white font-semibold text-xl flex items-center justify-center shrink-0">
                    {userInitial}
                  </div>
                )}

                <div className="min-w-0 space-y-1">
                  <h3 className="text-lg font-semibold text-safar-navy truncate">
                    {user.displayName || 'SAFAR Traveler'}
                  </h3>
                  {user.email && (
                    <p className="inline-flex items-center gap-1.5 text-xs text-safar-slate truncate max-w-full">
                      <Mail className="w-3.5 h-3.5 text-safar-orange shrink-0" aria-hidden="true" />
                      <span className="truncate">{user.email}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-safar-border bg-white p-5 space-y-3">
                <h3 className="text-base font-semibold text-safar-navy">
                  Sign in to sync your SAFAR account
                </h3>
                <p className="text-xs text-safar-slate leading-relaxed">
                  Connect with Google to save itineraries across devices, manage public share links, and ask SAFAR AI follow-ups.
                </p>
                <button
                  type="button"
                  disabled={authLoading}
                  onClick={() => void onSignIn()}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-safar-navy px-5 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-white transition-colors hover:bg-safar-navyHover disabled:opacity-60 whitespace-nowrap"
                >
                  <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                  {authLoading ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </div>
            )}

            {/* Real Saved Trip Metrics */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="rounded-2xl border border-safar-border bg-white p-4 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-safar-slate">
                  Saved Trips
                </p>
                <p className="text-2xl font-semibold text-safar-navy tabular-nums">
                  {tripStats.totalTrips}
                </p>
              </div>
              <div className="rounded-2xl border border-safar-border bg-white p-4 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-safar-slate">
                  Planned Days
                </p>
                <p className="text-2xl font-semibold text-safar-navy tabular-nums">
                  {tripStats.totalDays}
                </p>
              </div>
              <div className="rounded-2xl border border-safar-border bg-white p-4 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-safar-slate">
                  Active Plans
                </p>
                <p className="text-2xl font-semibold text-safar-navy tabular-nums">
                  {tripStats.plannedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-safar-border bg-white p-4 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-safar-slate">
                  Destinations
                </p>
                <p className="text-2xl font-semibold text-safar-navy tabular-nums">
                  {tripStats.uniqueDestinations}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-safar-border">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigateTab('plan')}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-safar-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-white transition-colors hover:bg-safar-navyHover whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                Plan New Trip
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('trips')}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-safar-border bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-safar-navy transition-colors hover:bg-safar-skySoft whitespace-nowrap"
              >
                <Compass className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                My Trips
              </button>
            </div>

            {user && (
              <button
                type="button"
                disabled={authLoading}
                onClick={() => void onSignOut()}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Sign Out
              </button>
            )}
          </div>
        </div>

        {/* Travel Preferences & Planner Defaults */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 rounded-[24px] border border-safar-border bg-white p-6 md:p-7 space-y-6 shadow-[0_8px_28px_rgba(15,37,68,0.04)]"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-safar-border">
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-safar-orange">
                <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                Traveler Settings
              </span>
              <h3 className="text-xl font-semibold tracking-[-0.02em] text-safar-navy">
                Default Trip Planner Preferences
              </h3>
            </div>
            {savedNotice && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 rounded-full bg-safar-sky px-3.5 py-1.5 text-xs font-medium text-safar-navy"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                Defaults saved
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <label className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                <MapPin className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                Home / Departure City
              </span>
              <input
                type="text"
                maxLength={200}
                value={draft.startingLocation}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, startingLocation: e.target.value }))
                }
                placeholder="e.g., Kochi, Bengaluru, Mumbai"
                className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-2.5 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                Default Travelers
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={draft.travelers}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    travelers: Math.min(Math.max(Number(e.target.value) || 1, 1), 30),
                  }))
                }
                className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-2.5 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white tabular-nums"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                Preferred Currency
              </span>
              <select
                value={draft.currency}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    currency: e.target.value as CurrencyCode,
                  }))
                }
                className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-2.5 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
                <Globe className="w-3.5 h-3.5 text-safar-orange" aria-hidden="true" />
                Preferred Itinerary Language
              </span>
              <select
                value={draft.language}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    language: e.target.value as PreferredLanguage,
                  }))
                }
                className="rounded-xl border border-safar-border bg-safar-skySoft/40 px-4 py-2.5 text-sm text-safar-navy outline-none transition-colors focus:border-safar-navy focus:bg-white"
              >
                <option value="auto">Auto (English / Malayalam)</option>
                <option value="en">English</option>
                <option value="ml">Malayalam (മലയാളം)</option>
              </select>
            </label>
          </div>

          <div className="space-y-2.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-safar-slate">
              Default Travel Style
            </span>
            <div className="flex flex-wrap gap-2">
              {TRAVEL_STYLES.map((style) => {
                const selected = draft.travelStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, travelStyle: style.id }))
                    }
                    className={`cursor-pointer rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] transition-colors whitespace-nowrap shrink-0 ${
                      selected
                        ? 'bg-safar-navy text-white'
                        : 'border border-safar-border bg-white text-safar-navy hover:bg-safar-skySoft'
                    }`}
                  >
                    {style.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-safar-border">
            <p className="text-xs text-safar-slate">
              Saved locally for quick pre-filling whenever you start a new SAFAR trip.
            </p>
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-safar-orange px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-white transition-colors hover:bg-safar-orangeHover whitespace-nowrap shrink-0"
            >
              Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
