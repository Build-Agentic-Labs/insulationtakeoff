import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

function readEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
      }),
  );
}

function extractPrompt(routePath) {
  const source = fs.readFileSync(routePath, 'utf8');
  const marker = 'const CLASSIFY_PROMPT = `';
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error('CLASSIFY_PROMPT marker not found');
  }

  const promptStart = start + marker.length;
  const promptEnd = source.indexOf('`;', promptStart);
  if (promptEnd === -1) {
    throw new Error('CLASSIFY_PROMPT closing delimiter not found');
  }

  return source.slice(promptStart, promptEnd);
}

function renderPdfPages(pdfPath, pageLimit) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-eval-'));
  const prefix = path.join(tmpDir, 'page');
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-jpeg',
    '-r',
    '72',
    '-f',
    '1',
    '-l',
    String(pageLimit),
    pdfPath,
    prefix,
  ], { stdio: 'ignore' });

  return fs
    .readdirSync(tmpDir)
    .filter((name) => name.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => ({
      image_base64: fs.readFileSync(path.join(tmpDir, name)).toString('base64'),
    }));
}

function buildSummary(parsed) {
  if (!Array.isArray(parsed)) {
    return null;
  }

  return parsed.map((page) => ({
    page_number: page.page_number,
    page_type: page.page_type,
    secondary_page_types: page.secondary_page_types ?? [],
    page_name: page.page_name,
    takeoff_relevance: page.takeoff_relevance,
    has_dimensions: page.has_dimensions,
    is_floor_plan: page.is_floor_plan,
    confidence: page.confidence,
    true_scan_flags: Object.entries(page.scan_flags ?? {})
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key),
    true_stop_flags: Object.entries(page.stop_flags ?? {})
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key),
    scan_extracts: {
      window_sizes: page.scan_extracts?.window_sizes ?? [],
      opening_quantity_notes: page.scan_extracts?.opening_quantity_notes ?? [],
      insulation_types: page.scan_extracts?.insulation_types ?? [],
      r_values: page.scan_extracts?.r_values ?? [],
    },
    scan_notes: page.scan_notes ?? [],
  }));
}

function unique(values) {
  return Array.from(new Set(values));
}

function arrayF1(expected = [], actual = []) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const intersection = actual.filter((value) => expectedSet.has(value)).length;
  if (expectedSet.size === 0 && actualSet.size === 0) return 1;
  if (intersection === 0) return 0;
  const precision = intersection / actualSet.size;
  const recall = intersection / expectedSet.size;
  return (2 * precision * recall) / (precision + recall);
}

function exactScore(expected, actual) {
  return expected === actual ? 1 : 0;
}

function deriveFlowSignals(parsed) {
  const pages = Array.isArray(parsed) ? parsed : [];
  const hasExplicitInsulationEvidence = pages.some((page) =>
    page.true_scan_flags.some((flag) =>
      ['general_insulation_notes', 'wall_type_legend', 'material_specs'].includes(flag),
    ),
  );

  return {
    measurement_page: pages.some(
      (page) =>
        page.takeoff_relevance === 'primary_measurement' &&
        (page.has_dimensions || page.is_floor_plan),
    ),
    wall_height_reference: pages.some(
      (page) =>
        page.true_scan_flags.includes('height_references') ||
        page.page_type === 'elevation' ||
        page.page_type === 'section' ||
        page.secondary_page_types.includes('section'),
    ),
    insulation_details: hasExplicitInsulationEvidence,
    opening_identification: pages.some((page) => page.true_scan_flags.includes('opening_info')),
    attic_scope: pages.some((page) => page.true_scan_flags.includes('roof_ceiling_details')),
    crawlspace_scope: pages.some((page) => page.true_scan_flags.includes('floor_foundation_details')),
    low_value_pages: unique(
      pages
        .filter((page) => page.takeoff_relevance === 'low_value')
        .map((page) => page.page_number),
    ),
  };
}

function scoreWithRubric(parsed, rubric) {
  const summary = buildSummary(parsed);
  if (!summary) return null;

  const pageWeights = {
    page_type: 0.22,
    secondary_page_types: 0.08,
    takeoff_relevance: 0.24,
    has_dimensions: 0.08,
    is_floor_plan: 0.08,
    scan_flags: 0.30,
  };

  const expectedPages = rubric.pages ?? [];
  const actualByPage = new Map(summary.map((page) => [page.page_number, page]));
  const pageScores = expectedPages.map((expectedPage) => {
    const actualPage = actualByPage.get(expectedPage.page_number);
    if (!actualPage) {
      return {
        page_number: expectedPage.page_number,
        page_name: expectedPage.page_name,
        score: 0,
        components: {},
      };
    }

    const components = {
      page_type: exactScore(expectedPage.page_type, actualPage.page_type),
      secondary_page_types: arrayF1(
        expectedPage.secondary_page_types ?? [],
        actualPage.secondary_page_types ?? [],
      ),
      takeoff_relevance: exactScore(
        expectedPage.takeoff_relevance,
        actualPage.takeoff_relevance,
      ),
      has_dimensions:
        typeof expectedPage.has_dimensions === 'boolean'
          ? exactScore(expectedPage.has_dimensions, actualPage.has_dimensions)
          : 1,
      is_floor_plan:
        typeof expectedPage.is_floor_plan === 'boolean'
          ? exactScore(expectedPage.is_floor_plan, actualPage.is_floor_plan)
          : 1,
      scan_flags: arrayF1(
        expectedPage.scan_flags ?? [],
        actualPage.true_scan_flags ?? [],
      ),
    };

    const score = Object.entries(pageWeights).reduce(
      (total, [key, weight]) => total + (components[key] ?? 0) * weight,
      0,
    );

    return {
      page_number: expectedPage.page_number,
      page_name: expectedPage.page_name,
      score,
      components,
      actual: actualPage,
    };
  });

  const pageScore =
    pageScores.reduce((total, item) => total + item.score, 0) /
    Math.max(pageScores.length, 1);

  const derivedSignals = deriveFlowSignals(summary);
  const expectedSignals = rubric.flow_signals ?? {};
  const expectedReadiness = rubric.expected_readiness ?? {};

  const flowSignalScores = Object.fromEntries(
    Object.entries(expectedSignals).map(([key, expectedValue]) => [
      key,
      exactScore(expectedValue, derivedSignals[key]),
    ]),
  );

  const readinessBlockers = [];
  if (!derivedSignals.measurement_page) readinessBlockers.push('measurement_page');
  if (!derivedSignals.wall_height_reference) readinessBlockers.push('wall_height_reference');
  if (!derivedSignals.insulation_details) readinessBlockers.push('insulation_details');
  if (!derivedSignals.opening_identification) readinessBlockers.push('opening_identification');

  const readinessScore = arrayF1(
    expectedReadiness.missing_requirements ?? [],
    readinessBlockers,
  );

  const lowValueScore = arrayF1(
    expectedReadiness.low_value_pages ?? [],
    derivedSignals.low_value_pages,
  );

  const flowCoverageScore =
    Object.values(flowSignalScores).reduce((total, value) => total + value, 0) /
    Math.max(Object.values(flowSignalScores).length, 1);

  const overallFlowScore =
    pageScore * 0.5 +
    flowCoverageScore * 0.25 +
    readinessScore * 0.15 +
    lowValueScore * 0.10;

  return {
    rubric_name: rubric.name,
    page_score: Number(pageScore.toFixed(3)),
    flow_coverage_score: Number(flowCoverageScore.toFixed(3)),
    readiness_score: Number(readinessScore.toFixed(3)),
    low_value_score: Number(lowValueScore.toFixed(3)),
    overall_flow_score: Number(overallFlowScore.toFixed(3)),
    page_scores: pageScores.map((page) => ({
      page_number: page.page_number,
      page_name: page.page_name,
      score: Number(page.score.toFixed(3)),
      components: page.components,
      predicted: page.actual
        ? {
            page_type: page.actual.page_type,
            secondary_page_types: page.actual.secondary_page_types,
            takeoff_relevance: page.actual.takeoff_relevance,
            true_scan_flags: page.actual.true_scan_flags,
          }
        : null,
    })),
    derived_flow_signals: derivedSignals,
    expected_flow_signals: expectedSignals,
    readiness_blockers: readinessBlockers,
    expected_readiness: expectedReadiness,
  };
}

async function main() {
  const pdfPath = process.argv[2];
  const pageLimit = Number(process.argv[3] ?? '6');
  const rubricPath = process.argv[4];

  if (!pdfPath) {
    throw new Error('Usage: node scripts/eval-classify-pdf.mjs <pdf-path> [page-limit]');
  }

  const env = readEnvFile('/Users/rosendolopez/evinsulation/Insulation/.env.local');
  const apiKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY missing from .env.local');
  }

  const prompt = extractPrompt('/Users/rosendolopez/evinsulation/Insulation/app/api/takeoff/classify-pages/route.ts');
  const pages = renderPdfPages(pdfPath, pageLimit);

  const content = [];
  for (let index = 0; index < pages.length; index += 1) {
    content.push({ type: 'text', text: `--- Page ${index + 1} ---` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: pages[index].image_base64,
      },
    });
  }
  content.push({ type: 'text', text: prompt });

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  const responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  let parsed = null;
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error) {
      const debugPath = path.join(
        os.tmpdir(),
        `takeoff-eval-parse-error-${Date.now()}.txt`,
      );
      fs.writeFileSync(debugPath, responseText, 'utf8');
      throw new Error(
        `Failed to parse classifier JSON. Raw response saved to ${debugPath}. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const rubric = rubricPath ? JSON.parse(fs.readFileSync(rubricPath, 'utf8')) : null;
  const summary = buildSummary(parsed);
  const scored = rubric ? scoreWithRubric(parsed, rubric) : null;

  console.log(JSON.stringify({
    pdf: path.basename(pdfPath),
    pages: pages.length,
    parsed: summary,
    scored,
    raw_preview: responseText.slice(0, 1600),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
