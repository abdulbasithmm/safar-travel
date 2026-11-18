import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  Link2Off,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  buildEmailShareUrl,
  buildPlainTextItinerarySummary,
  buildPublicShareUrl,
  buildWhatsAppShareUrl,
  setSharedTripVisibility,
  upsertSharedTrip,
} from '@/services/shareService';
import { formatFirestoreTripError } from '@/services/tripService';
import type {
  SharedTripRecord,
  StructuredTripPlan,
  TripPlanInput,
} from '@/types/trip';

interface ShareTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  input: TripPlanInput;
  plan: StructuredTripPlan;
  notes: string;
  editingTripId: string | null;
  savedShare: SharedTripRecord | null;
  onShareChange: (share: SharedTripRecord | null) => void;
  onEnsureTripSaved: () => Promise<string | null>;
}

export default function ShareTripModal({
  isOpen,
  onClose,
  title,
  input,
  plan,
  notes,
  editingTripId,
  savedShare,
  onShareChange,
  onEnsureTripSaved,
}: ShareTripModalProps) {
  const { user, signInWithGoogle, authError } = useAuth();

  const [includeNotes, setIncludeNotes] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supportsWebShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
    setStatusMessage(null);
    setErrorMessage(null);
    setIncludeNotes(Boolean(savedShare?.notes && savedShare.notes.trim().length > 0));
  }, [isOpen, savedShare?.id, savedShare?.notes]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const activeShareUrl = useMemo(() => {
    if (!savedShare || !savedShare.isPublic) return null;
    return buildPublicShareUrl(savedShare.id);
  }, [savedShare]);

  const displayTitle =
    title.trim() ||
    `${plan.dailyItinerary.length || input.durationDays}-Day ${plan.destination}`;

  const whatsappUrl = useMemo(
    () =>
      buildWhatsAppShareUrl({
        title: displayTitle,
        plan,
        travelers: input.travelers,
        shareUrl: activeShareUrl,
      }),
    [displayTitle, plan, input.travelers, activeShareUrl],
  );

  const emailUrl = useMemo(
    () =>
      buildEmailShareUrl({
        title: displayTitle,
        plan,
        travelers: input.travelers,
        shareUrl: activeShareUrl,
      }),
    [displayTitle, plan, input.travelers, activeShareUrl],
  );

  if (!isOpen) return null;

  const handlePublishOrUpdateShare = async () => {
    if (isPublishing || isRevoking) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsPublishing(true);

    try {
      const activeUser = user ?? (await signInWithGoogle());
      if (!activeUser) {
        setErrorMessage(
          authError ||
            'Google sign-in is required to create and manage a public share link.',
        );
        return;
      }

      const resolvedTripId = editingTripId || (await onEnsureTripSaved());
      if (!resolvedTripId) {
        setErrorMessage(
          'Please save your trip before creating a public share link.',
        );
        return;
      }

      const updated = await upsertSharedTrip(activeUser, {
        tripId: resolvedTripId,
        title: displayTitle,
        input,
        plan,
        notes,
        includeNotes,
        existingShareId: savedShare?.id,
      });

      onShareChange(updated);
      setStatusMessage(
        savedShare
          ? 'Public share link updated with your latest itinerary.'
          : 'Public share link created. Anyone with this URL can view this itinerary.',
      );
    } catch (err) {
      setErrorMessage(formatFirestoreTripError(err, 'save'));
    } finally {
      setIsPublishing(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!savedShare || isRevoking || isPublishing) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsRevoking(true);

    try {
      await setSharedTripVisibility(savedShare.id, false);
      onShareChange({ ...savedShare, isPublic: false });
      setCopied(false);
      setStatusMessage(
        'Public link revoked. This URL is no longer accessible to others.',
      );
    } catch (err) {
      setErrorMessage(formatFirestoreTripError(err, 'update'));
    } finally {
      setIsRevoking(false);
    }
  };

  const handleCopyLink = async () => {
    if (!activeShareUrl) return;
    setErrorMessage(null);

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(activeShareUrl);
      } else {
        const inputEl = document.createElement('input');
        inputEl.value = activeShareUrl;
        document.body.appendChild(inputEl);
        inputEl.select();
        document.execCommand('copy');
        document.body.removeChild(inputEl);
      }
      setCopied(true);
      setStatusMessage('Share link copied to clipboard.');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setErrorMessage('Could not copy automatically. Please copy the URL from the box above.');
    }
  };

  const handleNativeWebShare = async () => {
    if (!supportsWebShare) return;
    setErrorMessage(null);
    try {
      const summary = buildPlainTextItinerarySummary({
        title: displayTitle,
        plan,
        travelers: input.travelers,
        shareUrl: activeShareUrl,
      });
      await navigator.share({
        title: `${displayTitle} — SAFAR`,
        text: summary,
        ...(activeShareUrl ? { url: activeShareUrl } : {}),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setErrorMessage('Unable to open your device share sheet. Use WhatsApp, Email, or a public link below.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-trip-modal-title"
        className="w-full max-w-xl rounded-[28px] border border-black/10 bg-white shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="px-6 py-5 border-b border-black/10 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-wandor-prompt">
              SAFAR · Share Itinerary
            </p>
            <h2
              id="share-trip-modal-title"
              className="font-sans text-xl font-medium tracking-[-0.02em] text-wandor-text"
            >
              {displayTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="cursor-pointer rounded-full p-2 text-wandor-muted hover:bg-black/5 hover:text-wandor-text transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs text-red-800"
            >
              {errorMessage}
            </div>
          )}

          {statusMessage && (
            <div className="rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-xs text-wandor-text">
              {statusMessage}
            </div>
          )}

          {/* Public Link Creation & Management */}
          <div className="rounded-2xl border border-black/10 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Globe className="w-4 h-4 text-wandor-prompt mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-wandor-text">
                  Public Share Link
                </h3>
                <p className="text-xs text-wandor-muted leading-relaxed">
                  Create a dedicated read-only SAFAR link stored securely in Firestore. You can update or revoke access anytime.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl bg-black/[0.025] px-3.5 py-2.5 text-[11px] text-wandor-muted">
              <ShieldCheck className="w-4 h-4 text-wandor-prompt shrink-0 mt-0.5" />
              <span>
                Your email, profile photo, account name, and raw prompts are never included in shared links.
              </span>
            </div>

            {notes.trim().length > 0 && (
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-wandor-text select-none">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(e) => setIncludeNotes(e.target.checked)}
                  className="h-4 w-4 rounded border-black/25 accent-[#905831]"
                />
                <span>Include my personal notes in the public shared link</span>
              </label>
            )}

            {activeShareUrl ? (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    readOnly
                    value={activeShareUrl}
                    aria-label="Public share link URL"
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 rounded-full border border-black/15 bg-black/[0.02] px-4 py-2 text-xs text-wandor-text outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-full bg-wandor-dark px-4 py-2 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333] shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isPublishing || isRevoking}
                    onClick={() => void handlePublishOrUpdateShare()}
                    className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5 disabled:opacity-50"
                  >
                    {isPublishing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {isPublishing ? 'Updating...' : 'Update Shared Copy'}
                  </button>

                  <button
                    type="button"
                    disabled={isRevoking || isPublishing}
                    onClick={() => void handleRevokeShare()}
                    className="cursor-pointer inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {isRevoking ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Link2Off className="w-3.5 h-3.5" />
                    )}
                    {isRevoking ? 'Revoking...' : 'Revoke Public Link'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {savedShare && !savedShare.isPublic && (
                  <p className="text-xs text-wandor-muted">
                    Public access is currently disabled for this trip. Re-enable to restore the share URL.
                  </p>
                )}
                <button
                  type="button"
                  disabled={isPublishing}
                  onClick={() => void handlePublishOrUpdateShare()}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-wandor-dark px-5 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-[#fafafa] hover:bg-[#333] disabled:opacity-60"
                >
                  {isPublishing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Globe className="w-3.5 h-3.5" />
                  )}
                  {isPublishing
                    ? 'Creating Link...'
                    : savedShare
                      ? 'Re-enable Public Link'
                      : 'Create Public Share Link'}
                </button>
              </div>
            )}
          </div>

          {/* Direct Sharing Channels */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-wandor-muted">
                Send Summary Directly
              </h3>
              <span className="text-[11px] text-wandor-muted">
                {activeShareUrl ? 'Includes your public link' : 'Sends itinerary highlights'}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              {supportsWebShare && (
                <button
                  type="button"
                  onClick={() => void handleNativeWebShare()}
                  className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5"
                >
                  <Share2 className="w-3.5 h-3.5 text-wandor-prompt" />
                  Share via Device
                </button>
              )}

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5"
              >
                <MessageCircle className="w-3.5 h-3.5 text-wandor-prompt" />
                WhatsApp
              </a>

              <a
                href={emailUrl}
                className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-[0.04em] text-wandor-text hover:bg-black/5"
              >
                <Mail className="w-3.5 h-3.5 text-wandor-prompt" />
                Email
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
