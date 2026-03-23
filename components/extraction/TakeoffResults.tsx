'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Building2,
  DoorOpen,
  Layers,
  Warehouse,
  ArrowDown,
  Ruler,
  ChevronDown,
  ChevronRight,
  Bug,
  FileText,
} from 'lucide-react';
import type {
  TakeoffEnvelopeV1,
  ConfidenceTier,
  VisionCreditV1,
  ExcludedPageV1,
} from '@/lib/types/takeoff-envelope';

// ─── Confidence Badge ───────────────────────────────────────────

const TIER_CONFIG: Record<ConfidenceTier, { label: string; icon: typeof CheckCircle2; className: string; bg: string; description: string }> = {
  high: {
    label: 'Estimate Looks Solid',
    icon: CheckCircle2,
    className: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'Wall measurements are well-supported by the blueprint data.',
  },
  medium: {
    label: 'Some Areas Need a Second Look',
    icon: AlertTriangle,
    className: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    description: 'Most measurements look good, but a few areas may need manual verification.',
  },
  low: {
    label: 'Manual Review Recommended',
    icon: XCircle,
    className: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    description: 'The blueprint was difficult to read automatically. Please verify key measurements.',
  },
};

function ConfidenceBadge({ tier }: { tier: ConfidenceTier }) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${config.bg}`}>
      <Icon className={`h-5 w-5 ${config.className} shrink-0`} />
      <div>
        <p className={`text-sm font-semibold ${config.className}`}>{config.label}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{config.description}</p>
      </div>
    </div>
  );
}

// ─── Wall Bucket Card ───────────────────────────────────────────

function WallBucketCard({ height, grossSf, netSf, openingSf, segments }: {
  height: string;
  grossSf: number;
  netSf: number;
  openingSf: number;
  segments: number;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">{height}&apos; Walls</span>
        </div>
        <span className="text-xs text-zinc-500">{segments} segments</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">
        {Math.round(netSf).toLocaleString()} <span className="text-sm font-normal text-zinc-400">net SF</span>
      </div>
      {openingSf > 0 && (
        <p className="text-xs text-zinc-500 mt-1">
          {Math.round(grossSf).toLocaleString()} gross &minus; {Math.round(openingSf).toLocaleString()} openings
        </p>
      )}
    </div>
  );
}

// ─── Scope Item Row ─────────────────────────────────────────────

function ScopeItem({ icon, label, value, unit, note }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  note?: string;
}) {
  if (value <= 0) return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-800/50 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 rounded flex items-center justify-center bg-zinc-800 text-zinc-400">
          {icon}
        </div>
        <div>
          <p className="text-sm text-zinc-200">{label}</p>
          {note && <p className="text-xs text-zinc-500">{note}</p>}
        </div>
      </div>
      <span className="text-sm font-semibold text-white tabular-nums">
        {Math.round(value).toLocaleString()} {unit}
      </span>
    </div>
  );
}

// ─── Review Callouts (plain English) ────────────────────────────

function ReviewCallouts({ envelope }: { envelope: TakeoffEnvelopeV1 }) {
  const callouts: { text: string; severity: 'warning' | 'info' }[] = [];
  const excluded = envelope.excluded_supplemental_pages || [];
  const credits = envelope.vision_perimeter_credits || [];

  // Excluded pages
  for (const exc of excluded) {
    const reasoning = exc.candidate_reasoning || '';
    const isBasement = reasoning.toLowerCase().includes('basement');
    const isUpper = reasoning.toLowerCase().includes('second') || reasoning.toLowerCase().includes('upper');
    const pageDesc = isBasement ? 'basement floor' : isUpper ? 'upper floor' : `page ${exc.page_index + 1}`;
    callouts.push({
      text: `We couldn't read the ${pageDesc} clearly. The wall measurements from that page are estimated.`,
      severity: 'warning',
    });
  }

  // Vision credits applied
  if (credits.length > 0) {
    const totalCredit = credits.reduce((sum, c) => sum + c.credit_sf, 0);
    callouts.push({
      text: `About ${Math.round(totalCredit).toLocaleString()} SF of wall area is estimated from the blueprint outline (not measured from dimensions). This is included in the "best estimate" total.`,
      severity: 'info',
    });
  }

  // Boundary disagreement
  const hasBoundaryDisagreement = envelope.review.items.some(
    (i) => i.category === 'hybrid_boundary_disagreement'
  );
  if (hasBoundaryDisagreement) {
    callouts.push({
      text: 'The dimension measurements and the blueprint outline disagree on the building perimeter. The dimension-based measurements are used.',
      severity: 'warning',
    });
  }

  if (callouts.length === 0) return null;

  return (
    <div className="space-y-2">
      {callouts.map((callout, i) => (
        <div
          key={i}
          className={`flex items-start gap-2.5 text-sm px-3 py-2.5 rounded-lg ${
            callout.severity === 'warning'
              ? 'bg-amber-500/5 border border-amber-500/20 text-amber-300'
              : 'bg-blue-500/5 border border-blue-500/20 text-blue-300'
          }`}
        >
          {callout.severity === 'warning' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <p>{callout.text}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Dev Menu ───────────────────────────────────────────────────

function DevMenu({ envelope }: { envelope: TakeoffEnvelopeV1 }) {
  const [expanded, setExpanded] = useState(false);
  const tier = envelope.confidence_tier;
  const excluded = envelope.excluded_supplemental_pages || [];
  const credits = envelope.vision_perimeter_credits || [];

  return (
    <div className="border border-zinc-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors bg-zinc-900/50"
      >
        <Bug className="h-3.5 w-3.5" />
        <span>Developer Details</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-zinc-950 text-xs font-mono space-y-3">
          {/* Confidence Tier */}
          {tier && (
            <div>
              <p className="text-zinc-500 mb-1">Confidence Tier</p>
              <p className="text-zinc-300">
                {tier.tier.toUpperCase()} (penalty: {tier.penalty})
              </p>
              <div className="mt-1 space-y-0.5">
                {Object.entries(tier.breakdown).map(([key, val]) => (
                  val > 0 && (
                    <p key={key} className="text-zinc-500">
                      {key}: +{val}
                    </p>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Excluded Pages */}
          {excluded.length > 0 && (
            <div>
              <p className="text-zinc-500 mb-1">Excluded Supplemental Pages ({excluded.length})</p>
              {excluded.map((exc) => (
                <div key={exc.page_index} className="text-zinc-400 mb-1">
                  <p>p{exc.page_index}: {exc.reason}</p>
                  <p className="text-zinc-600">tokens={exc.ocr_token_count} lf={exc.exterior_lf} vision_lf={exc.vision_exterior_lf_estimate}</p>
                </div>
              ))}
            </div>
          )}

          {/* Vision Credits */}
          {credits.length > 0 && (
            <div>
              <p className="text-zinc-500 mb-1">Vision Perimeter Credits ({credits.length})</p>
              {credits.map((c) => (
                <div key={c.page_index} className="text-zinc-400 mb-1">
                  <p>p{c.page_index}: {c.credit_sf} SF ({c.page_type}, {Math.round(c.discount_factor * 100)}% disc)</p>
                  <p className="text-zinc-600">{c.vision_exterior_lf} LF x {c.height_prior_ft} ft x {c.discount_factor}</p>
                </div>
              ))}
            </div>
          )}

          {/* Pipeline Info */}
          <div>
            <p className="text-zinc-500 mb-1">Pipeline</p>
            <p className="text-zinc-400">mode: {envelope.mode_used}</p>
            <p className="text-zinc-400">status: {envelope.status}</p>
            <p className="text-zinc-400">confidence: {envelope.telemetry.overall_confidence}</p>
            <p className="text-zinc-400">time: {envelope.telemetry.total_time_s?.toFixed(1)}s</p>
            <p className="text-zinc-400">page: {envelope.page_selection.selected_page_index} ({envelope.page_selection.source})</p>
            {envelope.telemetry.hybrid_features && envelope.telemetry.hybrid_features.length > 0 && (
              <p className="text-zinc-400">features: {envelope.telemetry.hybrid_features.join(', ')}</p>
            )}
          </div>

          {/* Review Items */}
          <div>
            <p className="text-zinc-500 mb-1">
              Review Items ({envelope.review.total_issues}: {envelope.errors.length}E / {envelope.warnings.length}W)
            </p>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {envelope.review.items.slice(0, 20).map((item, i) => (
                <p key={i} className="text-zinc-500 truncate">
                  [{item.severity[0].toUpperCase()}] {item.category}: {item.message.slice(0, 80)}
                </p>
              ))}
              {envelope.review.items.length > 20 && (
                <p className="text-zinc-600">... and {envelope.review.items.length - 20} more</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main TakeoffResults ────────────────────────────────────────

interface TakeoffResultsProps {
  envelope: TakeoffEnvelopeV1;
  onGenerateQuote?: () => void;
}

export function TakeoffResults({ envelope, onGenerateQuote }: TakeoffResultsProps) {
  const { summary, buckets, net, openings } = envelope;
  const tier = envelope.confidence_tier?.tier || 'medium';
  const creditTotal = envelope.vision_credit_total_sf || 0;
  const totalWithCredits = envelope.total_gross_sf_with_credits || summary.gross_sf;
  const hasCredits = creditTotal > 0;

  // Sort buckets by height descending
  const sortedBuckets = [...buckets].sort((a, b) => b.height_ft - a.height_ft);

  return (
    <div className="space-y-6">
      {/* Confidence Badge */}
      <ConfidenceBadge tier={tier} />

      {/* Hero: Total Wall SF */}
      <Card className="border-zinc-700 bg-zinc-900/50">
        <CardContent className="pt-6 pb-5">
          <p className="text-sm text-zinc-400 mb-1">Total Exterior Wall Insulation</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-white tabular-nums">
              {Math.round(summary.net_sf).toLocaleString()}
            </span>
            <span className="text-lg text-zinc-400">net SF</span>
          </div>
          {hasCredits && (
            <p className="text-sm text-zinc-500 mt-2">
              {Math.round(summary.gross_sf).toLocaleString()} SF measured
              {' + '}
              {Math.round(creditTotal).toLocaleString()} SF estimated
              {' = '}
              <span className="text-zinc-300 font-medium">
                {Math.round(totalWithCredits).toLocaleString()} SF best estimate
              </span>
            </p>
          )}
          {openings.subtracted_count > 0 && (
            <p className="text-xs text-zinc-500 mt-1">
              {openings.total_count} openings detected, {openings.subtracted_count} deducted ({Math.round(openings.subtracted_area_sf)} SF)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Wall Breakdown by Height */}
      {sortedBuckets.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Walls by Height
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sortedBuckets.map((bucket) => (
              <WallBucketCard
                key={bucket.height_ft}
                height={String(bucket.height_ft)}
                grossSf={bucket.gross_sf}
                netSf={bucket.net_sf}
                openingSf={bucket.opening_sf}
                segments={bucket.segment_count}
              />
            ))}
          </div>
        </div>
      )}

      {/* Scope Items */}
      <Card className="border-zinc-700 bg-zinc-900/50">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm text-zinc-400 font-medium">Additional Scope</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <ScopeItem
            icon={<ArrowDown className="h-4 w-4 rotate-180" />}
            label="Attic Blow-in"
            value={summary.estimated_ceiling_sf}
            unit="SF"
          />
          <ScopeItem
            icon={<Warehouse className="h-4 w-4" />}
            label="Garage Ceiling"
            value={summary.estimated_garage_ceiling_sf}
            unit="SF"
          />
          <ScopeItem
            icon={<ArrowDown className="h-4 w-4" />}
            label="Crawlspace"
            value={summary.estimated_crawlspace_sf}
            unit="SF"
          />
          <ScopeItem
            icon={<Ruler className="h-4 w-4" />}
            label="Rim Joist"
            value={summary.estimated_rim_joist_lf}
            unit="LF"
          />
          <ScopeItem
            icon={<DoorOpen className="h-4 w-4" />}
            label="Openings Deducted"
            value={openings.subtracted_area_sf}
            unit="SF"
            note={`${openings.subtracted_count} of ${openings.total_count} openings`}
          />
        </CardContent>
      </Card>

      {/* Review Callouts (plain English) */}
      <ReviewCallouts envelope={envelope} />

      {/* Generate Quote Button */}
      {onGenerateQuote && (
        <Button
          onClick={onGenerateQuote}
          className="w-full h-12 text-base font-semibold"
          disabled={tier === 'low'}
        >
          {tier === 'low' ? 'Review Required Before Quote' : 'Generate Quote'}
        </Button>
      )}

      {/* Dev Menu */}
      <DevMenu envelope={envelope} />
    </div>
  );
}
