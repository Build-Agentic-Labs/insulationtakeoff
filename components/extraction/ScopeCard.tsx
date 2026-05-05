'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Layers,
  Building,
  Warehouse,
  ArrowDown,
  Ruler,
  Download,
  AlertTriangle,
  Info,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import type {
  TakeoffEnvelopeV1,
  FieldStatus,
  IssueV1,
} from '@/lib/types/takeoff-envelope';
import { FOUNDATION_ISSUE_CATEGORIES } from '@/lib/types/takeoff-envelope';

// ─── Field Status Badge ──────────────────────────────────────

function StatusBadge({ status }: { status: FieldStatus }) {
  const config = {
    final: {
      label: 'Final',
      className: 'ev-status-completed',
    },
    estimated: {
      label: 'Estimated',
      className: 'ev-status-extracted',
    },
    missing: {
      label: 'Missing',
      className: 'ev-status-default',
    },
  };

  const c = config[status];
  return (
    <span className={`ev-status text-[10px] uppercase ${c.className}`}>
      {c.label}
    </span>
  );
}

// ─── Severity Icon ───────────────────────────────────────────

function SeverityIcon({ severity }: { severity: 'error' | 'warning' | 'info' }) {
  switch (severity) {
    case 'error':
      return <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case 'info':
      return <Info className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  }
}

// ─── Scope Row ───────────────────────────────────────────────

interface ScopeRowProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  status: FieldStatus;
  secondary?: string;
}

function ScopeRow({ icon, label, value, unit, status, secondary }: ScopeRowProps) {
  if (status === 'missing' && value === 0) return null;

  return (
    <div className="flex items-center justify-between border-b border-[var(--takeoff-line)] py-2 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className="ev-icon-box flex h-7 w-7 items-center justify-center rounded-[10px]">
          {icon}
        </div>
        <div>
          <p className="text-sm text-[var(--takeoff-ink)]">{label}</p>
          {secondary && (
            <p className="text-xs text-[var(--takeoff-text-muted)]">{secondary}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold tabular-nums text-[var(--takeoff-ink)]">
          {value > 0 ? `${Math.round(value).toLocaleString()} ${unit}` : '—'}
        </span>
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

// ─── Main ScopeCard ──────────────────────────────────────────

interface ScopeCardProps {
  envelope: TakeoffEnvelopeV1;
  onDownload?: () => void;
}

export function ScopeCard({ envelope, onDownload }: ScopeCardProps) {
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const { summary, completeness, review } = envelope;

  // Filter foundation-related review issues
  const foundationIssues = review.items.filter((item) =>
    (FOUNDATION_ISSUE_CATEGORIES as readonly string[]).includes(item.category)
  );

  const hasWarnings = foundationIssues.some((i) => i.severity === 'warning');

  return (
    <Card className="ev-card">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="ev-icon-box flex h-9 w-9 items-center justify-center rounded-[14px]">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base text-[var(--takeoff-ink)]">
                Scope (pdfengine)
              </CardTitle>
              <p className="mt-0.5 text-xs text-[var(--takeoff-text-muted)]">
                OCR pipeline • confidence{' '}
                {Math.round(envelope.telemetry.overall_confidence * 100)}%
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {envelope.status === 'review' && (
              <span className="ev-status ev-status-extracted text-[10px] uppercase">
                Needs review
              </span>
            )}
            {onDownload && (
              <Button variant="ghost" size="sm" onClick={onDownload}>
                <Download className="h-3.5 w-3.5 mr-1" />
                JSON
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 px-4 pb-4">
        {/* Scope rows */}
        <div className="space-y-0">
          <ScopeRow
            icon={<Building className="h-4 w-4" />}
            label="Building Footprint"
            value={summary.estimated_footprint_sf}
            unit="SF"
            status={summary.estimated_footprint_sf > 0 ? 'estimated' : 'missing'}
            secondary={
              summary.footprint_width_ft > 0 && summary.footprint_depth_ft > 0
                ? `${summary.footprint_width_ft.toFixed(1)}' × ${summary.footprint_depth_ft.toFixed(1)}'`
                : undefined
            }
          />
          <ScopeRow
            icon={<ArrowDown className="h-4 w-4 rotate-180" />}
            label="Conditioned Ceiling (Attic)"
            value={summary.estimated_ceiling_sf}
            unit="SF"
            status={completeness.ceiling_area}
          />
          <ScopeRow
            icon={<Warehouse className="h-4 w-4" />}
            label="Garage Ceiling"
            value={summary.estimated_garage_ceiling_sf}
            unit="SF"
            status={completeness.garage_ceiling_area}
          />
          <ScopeRow
            icon={<ArrowDown className="h-4 w-4" />}
            label="Crawlspace Floor"
            value={summary.estimated_crawlspace_sf}
            unit="SF"
            status={completeness.crawlspace_area}
          />
          <ScopeRow
            icon={<Ruler className="h-4 w-4" />}
            label="Rim Joist"
            value={summary.estimated_rim_joist_lf}
            unit="LF"
            status={completeness.rim_joist}
          />
        </div>

        {/* Foundation issues */}
        {foundationIssues.length > 0 && (
          <div className="mt-3 border-t border-[var(--takeoff-line)] pt-3">
            <button
              onClick={() => setIssuesExpanded(!issuesExpanded)}
              className="flex w-full items-center gap-1.5 text-xs text-[var(--takeoff-text-muted)] transition-colors hover:text-[var(--takeoff-ink)]"
            >
              {issuesExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {hasWarnings && <AlertTriangle className="h-3 w-3 text-amber-500" />}
              {foundationIssues.length} foundation note{foundationIssues.length !== 1 ? 's' : ''}
            </button>

            {issuesExpanded && (
              <div className="mt-2 space-y-1.5">
                {foundationIssues.map((issue) => (
                  <div
                    key={issue.item_id}
                    className="flex items-start gap-2 rounded-[14px] bg-[var(--takeoff-paper)] px-2.5 py-2 text-xs text-[var(--takeoff-text-muted)]"
                  >
                    <SeverityIcon severity={issue.severity} />
                    <div>
                      <p>{issue.message}</p>
                      {issue.recommended_action && (
                        <p className="mt-0.5 text-[var(--takeoff-text-subtle)]">{issue.recommended_action}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
