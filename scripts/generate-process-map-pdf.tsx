import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import React from 'react';
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToFile,
} from '@react-pdf/renderer';

const outputPath = resolve('docs/user-guide/insulation-takeoff-process-map.pdf');

Font.registerHyphenationCallback((word) => [word]);

const processSteps = [
  {
    number: '1',
    title: 'Setup',
    action: 'Confirm company profile, logo, quote terms, and tax settings.',
    ai: 'AI does not change setup settings.',
    checkpoint: 'Settings are ready before the first quote.',
  },
  {
    number: '2',
    title: 'Project',
    action: 'Create/select the client, create the project, upload the plan PDF, then open Takeoff.',
    ai: 'AI starts after the plan is uploaded.',
    checkpoint: 'Project has the correct client and plan file.',
  },
  {
    number: '3',
    title: 'Vision',
    action: 'Confirm Primary Takeoff pages and Support Pages.',
    ai: 'AI suggests page roles and extracts dimensions, specs, openings, pitch, and insulation clues.',
    checkpoint: 'All floor plans, schedules, sections, and notes are selected.',
  },
  {
    number: '4',
    title: 'Areas',
    action: 'Trace each building area, choose the zone type, and fill area details.',
    ai: 'AI suggests likely takeoff areas, best pages, and scan-backed clues.',
    checkpoint: 'Area Catalog shows the zones you will estimate.',
  },
  {
    number: '5',
    title: 'Calibrate',
    action: 'Use Scale or Cal., click both endpoints of a known dimension, and enter the real length.',
    ai: 'AI does not calibrate; the user verifies the scale.',
    checkpoint: 'Scale is on and a known length checks correctly.',
  },
  {
    number: '6',
    title: 'Measure',
    action: 'Select the area, trace walls/surfaces/roof areas, then add windows and doors.',
    ai: 'AI can scan selected window notes, door notes, and roof pitch when requested.',
    checkpoint: 'Openings are attached to the correct wall.',
  },
  {
    number: '7',
    title: 'Review',
    action: 'Check worksheet descriptions, quantities, units, specs, deductions, and manual rows.',
    ai: 'The app seeds rows from measured scope and scanned clues; user verifies.',
    checkpoint: 'Worksheet rows look complete and believable.',
  },
  {
    number: '8',
    title: 'Quote',
    action: 'Confirm included rows, unit pricing, tax, and terms, then generate and download the PDF.',
    ai: 'AI does not approve pricing, terms, tax, or final quote scope.',
    checkpoint: 'Quote PDF opens and is ready to send.',
  },
];

const toolGroups = [
  {
    title: 'Calibration',
    items: [
      'Pick a long printed dimension.',
      'Click Scale or Cal.',
      'Click endpoint A, then endpoint B.',
      'Enter the real length.',
      'Confirm Scale on.',
      'Compare one known dimension before measuring.',
    ],
  },
  {
    title: 'Measuring',
    items: [
      'Select the correct area first.',
      'Use 6 inch wall for 2x6/exterior wall scope.',
      'Use 4 inch wall for 2x4/interior/shared wall scope.',
      'Use Surface for attic, crawlspace, garage ceiling, sound, cathedral, or cantilever scope.',
      'Use Roof for pitch-adjusted or vaulted ceiling areas.',
      'Use Win scan and Door scan after selecting the related wall. AI reads the selected note; user saves or overrides.',
    ],
  },
  {
    title: 'Finish',
    items: [
      'Review worksheet rows before pricing.',
      'Check opening deductions under the right wall.',
      'Add manual rows for special scope.',
      'Confirm unit prices, tax, and terms.',
      'Generate the quote and download the PDF.',
    ],
  },
];

const stopItems = [
  'The page is not calibrated.',
  'A known length does not match after calibration.',
  'A wall or surface is assigned to the wrong area.',
  'A window or door is not tied to the correct wall.',
  'A worksheet row has the wrong unit, R-value, or quantity.',
];

const aiRule =
  'AI suggests page roles, support evidence, area hints, opening sizes, and roof pitch. The user confirms every page, calibration, traced area, opening, worksheet row, and quote.';

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 34,
    paddingBottom: 28,
    backgroundColor: '#f6f8f2',
    color: '#151c17',
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  kicker: {
    fontSize: 7,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: '#6e8b5e',
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 700,
    color: '#151c17',
  },
  subtitle: {
    marginTop: 4,
    maxWidth: 360,
    fontSize: 9.5,
    lineHeight: 1.35,
    color: '#516052',
  },
  badge: {
    borderWidth: 1,
    borderColor: '#c9d5c5',
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 10,
    width: 124,
  },
  badgeKicker: {
    fontSize: 6.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#7d897d',
    marginBottom: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#151c17',
  },
  flowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stepCard: {
    width: '24%',
    minHeight: 126,
    borderWidth: 1,
    borderColor: '#d6dfd2',
    backgroundColor: '#ffffff',
    padding: 9,
  },
  stepTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  stepNumber: {
    width: 19,
    height: 19,
    borderRadius: 9.5,
    backgroundColor: '#151c17',
    color: '#ffffff',
    fontSize: 8,
    textAlign: 'center',
    paddingTop: 5,
    marginRight: 6,
  },
  stepTitle: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: 700,
    color: '#151c17',
  },
  stepAction: {
    fontSize: 8,
    lineHeight: 1.35,
    color: '#334138',
    marginBottom: 5,
  },
  aiLine: {
    borderLeftWidth: 2,
    borderLeftColor: '#9fb493',
    paddingLeft: 5,
    marginBottom: 7,
  },
  aiKicker: {
    fontSize: 6.2,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#6e8b5e',
    marginBottom: 1.5,
  },
  aiText: {
    fontSize: 7.1,
    lineHeight: 1.25,
    color: '#4a5a4d',
  },
  checkpoint: {
    borderTopWidth: 1,
    borderTopColor: '#dfe5dc',
    paddingTop: 6,
    marginTop: 'auto',
  },
  checkpointKicker: {
    fontSize: 6.3,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#6e8b5e',
    marginBottom: 2,
  },
  checkpointText: {
    fontSize: 7.4,
    lineHeight: 1.25,
    color: '#516052',
  },
  noteBar: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#b9cbb4',
    backgroundColor: '#edf5e8',
    padding: 10,
    flexDirection: 'row',
    gap: 12,
  },
  noteTitle: {
    width: 82,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#49634a',
    fontWeight: 700,
  },
  noteText: {
    flex: 1,
    fontSize: 8.7,
    lineHeight: 1.35,
    color: '#253329',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: 700,
    marginBottom: 8,
    color: '#151c17',
  },
  columns: {
    flexDirection: 'row',
    gap: 10,
  },
  column: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d6dfd2',
    backgroundColor: '#ffffff',
    padding: 12,
    minHeight: 246,
  },
  columnTitle: {
    fontSize: 12.5,
    fontWeight: 700,
    color: '#151c17',
    marginBottom: 8,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bullet: {
    width: 12,
    fontSize: 8.5,
    color: '#6e8b5e',
  },
  listText: {
    flex: 1,
    fontSize: 8.2,
    lineHeight: 1.35,
    color: '#334138',
  },
  stopBox: {
    marginTop: 13,
    borderWidth: 1,
    borderColor: '#c8d2c5',
    backgroundColor: '#ffffff',
    padding: 12,
  },
  stopGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  stopPill: {
    width: '49%',
    borderWidth: 1,
    borderColor: '#dfe5dc',
    backgroundColor: '#fbfcf8',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  stopText: {
    fontSize: 8.2,
    lineHeight: 1.25,
    color: '#334138',
  },
  footer: {
    position: 'absolute',
    left: 34,
    right: 34,
    bottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#d8dfd3',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: '#7d897d',
  },
});

function StepCard({ step }: { step: (typeof processSteps)[number] }) {
  return (
    <View style={styles.stepCard} wrap={false}>
      <View style={styles.stepTop}>
        <Text style={styles.stepNumber}>{step.number}</Text>
        <Text style={styles.stepTitle}>{step.title}</Text>
      </View>
      <Text style={styles.stepAction}>{step.action}</Text>
      <View style={styles.aiLine}>
        <Text style={styles.aiKicker}>AI does</Text>
        <Text style={styles.aiText}>{step.ai}</Text>
      </View>
      <View style={styles.checkpoint}>
        <Text style={styles.checkpointKicker}>Checkpoint</Text>
        <Text style={styles.checkpointText}>{step.checkpoint}</Text>
      </View>
    </View>
  );
}

function ToolColumn({ group }: { group: (typeof toolGroups)[number] }) {
  return (
    <View style={styles.column} wrap={false}>
      <Text style={styles.columnTitle}>{group.title}</Text>
      {group.items.map((item) => (
        <View key={item} style={styles.listItem}>
          <Text style={styles.bullet}>-</Text>
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Footer() {
  return (
    <View fixed style={styles.footer}>
      <Text style={styles.footerText}>Insulation Takeoff Process Map</Text>
      <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function ProcessMapDocument() {
  return (
    <Document
      title="Insulation Takeoff Process Map"
      author="Agentic Labs"
      subject="Two-page process map for completing an insulation takeoff and quote"
      keywords="insulation,takeoff,process map,calibration,estimate,quote"
    >
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Process Map</Text>
            <Text style={styles.title}>Insulation Takeoff</Text>
            <Text style={styles.subtitle}>
              Use this order every time: select the right pages, define areas, calibrate each measured page,
              trace the scope, review the worksheet, then create the quote PDF.
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeKicker}>Goal</Text>
            <Text style={styles.badgeText}>Plan PDF to quote PDF</Text>
          </View>
        </View>

        <View style={styles.flowGrid}>
          {processSteps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </View>

        <View style={styles.noteBar}>
          <Text style={styles.noteTitle}>Main Rule</Text>
          <Text style={styles.noteText}>
            Do not measure before calibration. Do not quote before worksheet review. Every measured wall, surface,
            window, and door should belong to the correct area.
          </Text>
        </View>

        <View style={[styles.noteBar, { marginTop: 8 }]}>
          <Text style={styles.noteTitle}>AI Rule</Text>
          <Text style={styles.noteText}>{aiRule}</Text>
        </View>

        <Footer />
      </Page>

      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Quick Reference</Text>
            <Text style={styles.title}>Tool Sequence</Text>
            <Text style={styles.subtitle}>
              This page explains the practical order for calibration, measuring, and finishing the estimate.
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeKicker}>Use When</Text>
            <Text style={styles.badgeText}>Training a new user</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>How to work through the tools</Text>
        <View style={styles.columns}>
          {toolGroups.map((group) => (
            <ToolColumn key={group.title} group={group} />
          ))}
        </View>

        <View style={styles.stopBox}>
          <Text style={styles.sectionTitle}>Stop and fix before continuing when...</Text>
          <View style={styles.stopGrid}>
            {stopItems.map((item) => (
              <View key={item} style={styles.stopPill}>
                <Text style={styles.stopText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <Footer />
      </Page>
    </Document>
  );
}

async function main() {
  mkdirSync(dirname(outputPath), { recursive: true });
  await renderToFile(<ProcessMapDocument />, outputPath);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
