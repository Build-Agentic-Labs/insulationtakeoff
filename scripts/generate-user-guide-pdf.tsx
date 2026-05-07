import { mkdirSync, readFileSync } from 'node:fs';
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

type Block =
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

interface Section {
  title: string;
  blocks: Block[];
}

const sourcePath = resolve('docs/user-guide/insulation-takeoff-user-guide.md');
const outputPath = resolve('docs/user-guide/insulation-takeoff-user-guide.pdf');

Font.registerHyphenationCallback((word) => [word]);

function stripMarkdown(value: string) {
  return value.replace(/\*\*/g, '').trim();
}

function parseGuide(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  let title = 'Insulation Takeoff User Guide';
  const introBlocks: Block[] = [];
  const sections: Section[] = [];
  let currentBlocks = introBlocks;
  let pendingList: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (pendingList) {
      currentBlocks.push(pendingList);
      pendingList = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed.startsWith('# ')) {
      title = stripMarkdown(trimmed.replace(/^#\s+/, ''));
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      const section: Section = {
        title: stripMarkdown(trimmed.replace(/^##\s+/, '')),
        blocks: [],
      };
      sections.push(section);
      currentBlocks = section.blocks;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushList();
      currentBlocks.push({
        type: 'h3',
        text: stripMarkdown(trimmed.replace(/^###\s+/, '')),
      });
      continue;
    }

    const unorderedMatch = trimmed.match(/^-\s+(.*)$/);
    if (unorderedMatch) {
      if (!pendingList || pendingList.type !== 'ul') {
        flushList();
        pendingList = { type: 'ul', items: [] };
      }
      pendingList.items.push(stripMarkdown(unorderedMatch[1]));
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (!pendingList || pendingList.type !== 'ol') {
        flushList();
        pendingList = { type: 'ol', items: [] };
      }
      pendingList.items.push(stripMarkdown(orderedMatch[1]));
      continue;
    }

    flushList();
    currentBlocks.push({
      type: 'p',
      text: stripMarkdown(trimmed),
    });
  }

  flushList();

  return { title, introBlocks, sections };
}

const styles = StyleSheet.create({
  coverPage: {
    paddingTop: 58,
    paddingHorizontal: 54,
    paddingBottom: 48,
    backgroundColor: '#f6f8f2',
    color: '#171f19',
    fontFamily: 'Helvetica',
  },
  coverKicker: {
    fontSize: 9,
    letterSpacing: 2.8,
    textTransform: 'uppercase',
    color: '#6e8b5e',
    marginBottom: 18,
  },
  coverTitle: {
    fontSize: 39,
    lineHeight: 1.08,
    fontWeight: 700,
    maxWidth: 410,
    marginBottom: 18,
  },
  coverSubtitle: {
    fontSize: 12.5,
    lineHeight: 1.6,
    color: '#4d5a4f',
    maxWidth: 420,
  },
  coverCard: {
    marginTop: 36,
    borderWidth: 1,
    borderColor: '#d8dfd3',
    backgroundColor: '#ffffff',
    padding: 22,
  },
  coverCardTitle: {
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: '#7d897d',
    marginBottom: 14,
  },
  flowRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 9,
  },
  flowNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#171f19',
    color: '#ffffff',
    fontSize: 8,
    lineHeight: 1,
    textAlign: 'center',
    paddingTop: 5,
    marginRight: 9,
  },
  flowText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 1.4,
    color: '#29312a',
  },
  coverFooter: {
    position: 'absolute',
    left: 54,
    right: 54,
    bottom: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#d8dfd3',
    paddingTop: 13,
  },
  coverFooterText: {
    fontSize: 8,
    color: '#7d897d',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  page: {
    paddingTop: 44,
    paddingHorizontal: 46,
    paddingBottom: 46,
    backgroundColor: '#ffffff',
    color: '#171f19',
    fontFamily: 'Helvetica',
  },
  fixedHeader: {
    position: 'absolute',
    top: 22,
    left: 46,
    right: 46,
    borderBottomWidth: 1,
    borderBottomColor: '#dfe5dc',
    paddingBottom: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fixedHeaderText: {
    fontSize: 7.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#7d897d',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 46,
    right: 46,
    borderTopWidth: 1,
    borderTopColor: '#dfe5dc',
    paddingTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7.5,
    color: '#7d897d',
  },
  toc: {
    marginBottom: 18,
    padding: 14,
    backgroundColor: '#f6f8f2',
    borderWidth: 1,
    borderColor: '#dfe5dc',
  },
  tocTitle: {
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#6e8b5e',
    marginBottom: 9,
  },
  tocColumns: {
    flexDirection: 'row',
    gap: 12,
  },
  tocColumn: {
    flex: 1,
  },
  tocItem: {
    fontSize: 8.5,
    lineHeight: 1.45,
    color: '#3d473f',
    marginBottom: 3,
  },
  intro: {
    marginBottom: 12,
  },
  section: {
    marginBottom: 14,
  },
  h2: {
    marginTop: 7,
    marginBottom: 6,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: '#dfe5dc',
    fontSize: 17,
    lineHeight: 1.2,
    fontWeight: 700,
    color: '#171f19',
  },
  h3: {
    marginTop: 7,
    marginBottom: 4,
    fontSize: 12,
    lineHeight: 1.25,
    fontWeight: 700,
    color: '#29312a',
  },
  paragraph: {
    fontSize: 9.4,
    lineHeight: 1.45,
    color: '#334138',
    marginBottom: 5,
  },
  list: {
    marginTop: 1,
    marginBottom: 6,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 3.5,
  },
  bullet: {
    width: 21,
    fontSize: 9.4,
    lineHeight: 1.4,
    color: '#6e8b5e',
  },
  listText: {
    flex: 1,
    fontSize: 9.4,
    lineHeight: 1.4,
    color: '#334138',
  },
  appPreview: {
    marginTop: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#d3dbcf',
    backgroundColor: '#f7f9f4',
  },
  appPreviewHeader: {
    height: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#d3dbcf',
    backgroundColor: '#eef4ea',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 9,
  },
  appPreviewTitle: {
    fontSize: 7.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#526356',
  },
  appPreviewDots: {
    flexDirection: 'row',
    gap: 3,
  },
  appPreviewDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#9aad97',
  },
  appPreviewBody: {
    flexDirection: 'row',
    minHeight: 132,
  },
  appSidebar: {
    width: 82,
    backgroundColor: '#0e1711',
    padding: 9,
  },
  appSidebarLogo: {
    height: 27,
    borderWidth: 1,
    borderColor: '#2e3b32',
    backgroundColor: '#ffffff',
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appSidebarLogoText: {
    fontSize: 5.8,
    fontWeight: 700,
    color: '#bd2931',
  },
  appSidebarItem: {
    fontSize: 7.5,
    color: '#b8c5b8',
    marginBottom: 8,
  },
  appSidebarActive: {
    color: '#ffffff',
    backgroundColor: '#273229',
    paddingVertical: 4,
    paddingHorizontal: 5,
    marginHorizontal: -5,
  },
  appCanvas: {
    flex: 1,
    padding: 11,
  },
  appCanvasStatic: {
    padding: 11,
  },
  appKicker: {
    fontSize: 6.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#7a887d',
    marginBottom: 4,
  },
  appHeading: {
    fontSize: 14,
    fontWeight: 700,
    color: '#151c17',
    marginBottom: 3,
  },
  appMuted: {
    fontSize: 7.5,
    color: '#68766b',
  },
  appCardRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  appDarkCard: {
    flex: 1,
    minHeight: 48,
    backgroundColor: '#151c17',
    padding: 10,
  },
  appLightCard: {
    flex: 1,
    minHeight: 48,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8dfd3',
    padding: 10,
  },
  appCardTitleDark: {
    fontSize: 12,
    fontWeight: 700,
    color: '#ffffff',
    marginBottom: 4,
  },
  appCardTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#151c17',
    marginBottom: 4,
  },
  appCardTextDark: {
    fontSize: 7,
    color: '#c8d3c8',
  },
  appCardText: {
    fontSize: 7,
    color: '#68766b',
  },
  appStepRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  appStepPill: {
    borderWidth: 1,
    borderColor: '#d6dfd2',
    backgroundColor: '#ffffff',
    paddingVertical: 4,
    paddingHorizontal: 7,
  },
  appStepPillActive: {
    backgroundColor: '#151c17',
    borderColor: '#151c17',
  },
  appStepText: {
    fontSize: 7,
    color: '#667267',
  },
  appStepTextActive: {
    color: '#ffffff',
  },
  appPageCardGrid: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 9,
  },
  appPageCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7dfd4',
    padding: 7,
  },
  appThumb: {
    height: 42,
    backgroundColor: '#edf1ea',
    borderWidth: 1,
    borderColor: '#d9e0d5',
    marginBottom: 6,
    padding: 5,
  },
  appLine: {
    height: 1,
    backgroundColor: '#9aa99b',
    marginBottom: 5,
  },
  appPageLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: '#202820',
    marginBottom: 4,
  },
  appTag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#9aae97',
    backgroundColor: '#edf5e8',
    paddingVertical: 2,
    paddingHorizontal: 5,
    fontSize: 6.4,
    color: '#49634a',
  },
  appPlanArea: {
    flex: 1,
    backgroundColor: '#f8faf5',
    borderWidth: 1,
    borderColor: '#d7dfd4',
    padding: 8,
  },
  appPlanBox: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#6e8b5e',
    backgroundColor: '#eef6eb',
    padding: 8,
  },
  appTraceLine: {
    height: 2,
    backgroundColor: '#151c17',
    marginBottom: 9,
  },
  appToolPanel: {
    width: 128,
    marginLeft: 9,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7dfd4',
    padding: 8,
  },
  appToolButton: {
    borderWidth: 1,
    borderColor: '#d7dfd4',
    backgroundColor: '#f6f8f2',
    paddingVertical: 4,
    paddingHorizontal: 5,
    marginBottom: 5,
    fontSize: 7.3,
    color: '#303a31',
  },
  appToolButtonActive: {
    backgroundColor: '#151c17',
    color: '#ffffff',
    borderColor: '#151c17',
    paddingVertical: 4,
    paddingHorizontal: 5,
    marginBottom: 5,
    fontSize: 7.3,
  },
  appTable: {
    marginTop: 9,
    borderWidth: 1,
    borderColor: '#d7dfd4',
    backgroundColor: '#ffffff',
  },
  appTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#151c17',
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  appTableHeaderText: {
    fontSize: 7,
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  appTableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e0e6dd',
    paddingVertical: 6,
    paddingHorizontal: 7,
  },
  appTableText: {
    fontSize: 7.5,
    color: '#303a31',
  },
  appTotal: {
    marginTop: 8,
    alignSelf: 'flex-end',
    backgroundColor: '#edf5e8',
    borderWidth: 1,
    borderColor: '#b8c9b2',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  appTotalText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#151c17',
  },
});

function BlockView({ block }: { block: Block }) {
  if (block.type === 'h3') {
    return <Text style={styles.h3}>{block.text}</Text>;
  }

  if (block.type === 'p') {
    return <Text style={styles.paragraph}>{block.text}</Text>;
  }

  return (
    <View style={styles.list}>
      {block.items.map((item, index) => (
        <View key={`${block.type}-${index}-${item}`} style={styles.listItem} wrap={false}>
          <Text style={styles.bullet}>{block.type === 'ol' ? `${index + 1}.` : '-'}</Text>
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function AppPreviewFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.appPreview} wrap={false}>
      <View style={styles.appPreviewHeader}>
        <Text style={styles.appPreviewTitle}>{title}</Text>
        <View style={styles.appPreviewDots}>
          <View style={styles.appPreviewDot} />
          <View style={styles.appPreviewDot} />
          <View style={styles.appPreviewDot} />
        </View>
      </View>
      {children}
    </View>
  );
}

function AppSidebar({ active }: { active: string }) {
  const items = ['Dashboard', 'Clients', 'Settings', 'Support'];
  return (
    <View style={styles.appSidebar}>
      <View style={styles.appSidebarLogo}>
        <Text style={styles.appSidebarLogoText}>TORRES FLOORING</Text>
      </View>
      {items.map((item) => (
        <Text
          key={item}
          style={item === active ? [styles.appSidebarItem, styles.appSidebarActive] : styles.appSidebarItem}
        >
          {item}
        </Text>
      ))}
    </View>
  );
}

function ProjectWorkspacePreview() {
  return (
    <AppPreviewFrame title="Project workspace">
      <View style={styles.appPreviewBody}>
        <AppSidebar active="Dashboard" />
        <View style={styles.appCanvas}>
          <Text style={styles.appKicker}>Project</Text>
          <Text style={styles.appHeading}>Lot 4 - Golden Ridge</Text>
          <Text style={styles.appMuted}>Source ready · plan PDF attached</Text>
          <View style={styles.appCardRow}>
            <View style={styles.appDarkCard}>
              <Text style={styles.appCardTitleDark}>Open Takeoff</Text>
              <Text style={styles.appCardTextDark}>Measure and review the job scope.</Text>
            </View>
            <View style={styles.appLightCard}>
              <Text style={styles.appCardTitle}>Generate Quote</Text>
              <Text style={styles.appCardText}>Build the client quote package.</Text>
            </View>
          </View>
        </View>
      </View>
    </AppPreviewFrame>
  );
}

function VisionPreview() {
  return (
    <AppPreviewFrame title="Vision page selection">
      <View style={styles.appCanvasStatic}>
        <Text style={styles.appKicker}>Scanning plan set</Text>
        <Text style={styles.appHeading}>Confirm useful pages</Text>
        <Text style={styles.appMuted}>Select measurement pages and support/evidence pages before tracing.</Text>
        <View style={styles.appPageCardGrid}>
          {[
            ['Floor Plan', 'Primary Takeoff'],
            ['Wall Section', 'Support Page'],
            ['Window Schedule', 'Support Page'],
          ].map(([label, tag]) => (
            <View key={label} style={styles.appPageCard}>
              <View style={styles.appThumb}>
                <View style={styles.appLine} />
                <View style={[styles.appLine, { width: '74%' }]} />
                <View style={[styles.appLine, { width: '58%' }]} />
              </View>
              <Text style={styles.appPageLabel}>{label}</Text>
              <Text style={styles.appTag}>{tag}</Text>
            </View>
          ))}
        </View>
      </View>
    </AppPreviewFrame>
  );
}

function AreasPreview() {
  return (
    <AppPreviewFrame title="Areas and calibration">
      <View style={[styles.appPreviewBody, { padding: 10 }]}>
        <View style={styles.appPlanArea}>
          <View style={styles.appPlanBox}>
            <Text style={styles.appKicker}>Living / Heated Area</Text>
            <View style={[styles.appTraceLine, { width: '86%' }]} />
            <View style={[styles.appTraceLine, { width: '64%' }]} />
            <View style={[styles.appTraceLine, { width: '72%' }]} />
            <Text style={styles.appMuted}>Scale on · traced area</Text>
          </View>
        </View>
        <View style={styles.appToolPanel}>
          <Text style={styles.appKicker}>Suggested Takeoff Areas</Text>
          <Text style={[styles.appToolButton, styles.appToolButtonActive]}>Living / Heated Area</Text>
          <Text style={styles.appToolButton}>Garage / Shared Wall</Text>
          <Text style={styles.appToolButton}>Attic / Ceiling</Text>
          <Text style={styles.appToolButton}>Area Catalog</Text>
        </View>
      </View>
    </AppPreviewFrame>
  );
}

function TakeoffPreview() {
  return (
    <AppPreviewFrame title="Takeoff tools">
      <View style={[styles.appPreviewBody, { padding: 10 }]}>
        <View style={styles.appPlanArea}>
          <View style={styles.appPlanBox}>
            <Text style={styles.appKicker}>Wall run</Text>
            <View style={[styles.appTraceLine, { width: '92%' }]} />
            <View style={[styles.appTraceLine, { width: '48%', backgroundColor: '#6e8b5e' }]} />
            <Text style={styles.appMuted}>124 LF · windows and doors deducted</Text>
          </View>
        </View>
        <View style={styles.appToolPanel}>
          <Text style={styles.appKicker}>Tools</Text>
          {['Scale', 'Wall', 'Surface', 'Window', 'Door', 'Roof'].map((tool) => (
            <Text key={tool} style={tool === 'Wall' ? [styles.appToolButton, styles.appToolButtonActive] : styles.appToolButton}>
              {tool}
            </Text>
          ))}
        </View>
      </View>
    </AppPreviewFrame>
  );
}

function QuotePreview() {
  return (
    <AppPreviewFrame title="Estimate worksheet and quote">
      <View style={styles.appCanvasStatic}>
        <Text style={styles.appKicker}>Estimate template</Text>
        <Text style={styles.appHeading}>Review rows before PDF</Text>
        <View style={styles.appTable}>
          <View style={styles.appTableHeader}>
            <Text style={[styles.appTableHeaderText, { flex: 2 }]}>Description</Text>
            <Text style={[styles.appTableHeaderText, { flex: 1, textAlign: 'right' }]}>Qty</Text>
            <Text style={[styles.appTableHeaderText, { flex: 1, textAlign: 'right' }]}>Amount</Text>
          </View>
          {[
            ['Exterior wall assemblies', '1,642 SF', '$2,463'],
            ['Attic ceiling insulation', '1,180 SF', '$1,475'],
            ['Manual additions', '1 EA', '$250'],
          ].map(([description, quantity, amount]) => (
            <View key={description} style={styles.appTableRow}>
              <Text style={[styles.appTableText, { flex: 2 }]}>{description}</Text>
              <Text style={[styles.appTableText, { flex: 1, textAlign: 'right' }]}>{quantity}</Text>
              <Text style={[styles.appTableText, { flex: 1, textAlign: 'right' }]}>{amount}</Text>
            </View>
          ))}
        </View>
        <View style={styles.appTotal}>
          <Text style={styles.appTotalText}>Generate Quote PDF</Text>
        </View>
      </View>
    </AppPreviewFrame>
  );
}

function ReviewPreview() {
  return (
    <AppPreviewFrame title="Review takeoff worksheet">
      <View style={styles.appCanvasStatic}>
        <Text style={styles.appKicker}>Estimate verification</Text>
        <Text style={styles.appHeading}>Review estimate worksheet</Text>
        <Text style={styles.appMuted}>Confirm each measured row before sending it to the quote page.</Text>
        <View style={styles.appTable}>
          <View style={styles.appTableHeader}>
            <Text style={[styles.appTableHeaderText, { flex: 2 }]}>Description</Text>
            <Text style={[styles.appTableHeaderText, { flex: 1, textAlign: 'right' }]}>Qty</Text>
            <Text style={[styles.appTableHeaderText, { flex: 1, textAlign: 'right' }]}>Unit</Text>
            <Text style={[styles.appTableHeaderText, { flex: 1, textAlign: 'right' }]}>Spec</Text>
          </View>
          {[
            ['Exterior walls', '1,642', 'SF', 'R-21'],
            ['Less windows and doors', '-214', 'SF', 'Deduct'],
            ['Attic ceiling', '1,180', 'SF', 'R-49'],
          ].map(([description, quantity, unit, spec]) => (
            <View key={description} style={styles.appTableRow}>
              <Text style={[styles.appTableText, { flex: 2 }]}>{description}</Text>
              <Text style={[styles.appTableText, { flex: 1, textAlign: 'right' }]}>{quantity}</Text>
              <Text style={[styles.appTableText, { flex: 1, textAlign: 'right' }]}>{unit}</Text>
              <Text style={[styles.appTableText, { flex: 1, textAlign: 'right' }]}>{spec}</Text>
            </View>
          ))}
        </View>
        <View style={styles.appTotal}>
          <Text style={styles.appTotalText}>Worksheet saved</Text>
        </View>
      </View>
    </AppPreviewFrame>
  );
}

function SectionPreview({ title }: { title: string }) {
  if (title === '1. Start the Job') return <ProjectWorkspacePreview />;
  if (title === '2. Confirm the Pages') return <VisionPreview />;
  if (title === '3. Draw the Areas') return <AreasPreview />;
  if (title === '4. Measure the Takeoff') return <TakeoffPreview />;
  if (title === '5. Review the Worksheet') return <ReviewPreview />;
  if (title === '6. Generate the Quote') return <QuotePreview />;
  return null;
}

function sectionStartsNewPage(title: string) {
  return [
    '3. What AI Does',
    '4. Tool List',
    '5. How To Calibrate',
    '7. Areas Step Details',
    '8. Takeoff Step Details',
    '9. Review The Worksheet',
    '11. Final QA Checklist',
  ].includes(title);
}

function GuideDocument({
  title,
  introBlocks,
  sections,
}: {
  title: string;
  introBlocks: Block[];
  sections: Section[];
}) {
  const flowSteps = [
    'Confirm company profile, quote terms, and tax settings.',
    'Create the client and project, then upload the plan PDF.',
    'Use Vision AI to suggest page roles and support evidence, then confirm selections.',
    'Define areas, calibrate each measured page, and trace scope.',
    'Review the worksheet, generate the quote, and download the PDF.',
  ];

  const leftToc = sections.slice(0, Math.ceil(sections.length / 2));
  const rightToc = sections.slice(Math.ceil(sections.length / 2));

  return (
    <Document
      title={title}
      author="Agentic Labs"
      subject="User guide for completing insulation takeoffs and quote PDFs"
      keywords="insulation,takeoff,estimate,quote,user guide"
    >
      <Page size="LETTER" style={styles.coverPage}>
        <Text style={styles.coverKicker}>User Guide</Text>
        <Text style={styles.coverTitle}>{title}</Text>
        <Text style={styles.coverSubtitle}>
          A step-by-step field workflow for uploading plans, completing a measured insulation takeoff,
          reviewing the estimate worksheet, and preparing the final quote PDF.
        </Text>

        <View style={styles.coverCard}>
          <Text style={styles.coverCardTitle}>Core Flow</Text>
          {flowSteps.map((step, index) => (
            <View key={step} style={styles.flowRow}>
              <Text style={styles.flowNumber}>{index + 1}</Text>
              <Text style={styles.flowText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.coverFooter}>
          <Text style={styles.coverFooterText}>Insulation Takeoff</Text>
          <Text style={styles.coverFooterText}>Prepared May 2026</Text>
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View fixed style={styles.fixedHeader}>
          <Text style={styles.fixedHeaderText}>Insulation Takeoff User Guide</Text>
          <Text style={styles.fixedHeaderText}>Takeoff to Estimate</Text>
        </View>
        <View fixed style={styles.footer}>
          <Text style={styles.footerText}>Insulation Takeoff</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={styles.toc}>
          <Text style={styles.tocTitle}>Contents</Text>
          <View style={styles.tocColumns}>
            <View style={styles.tocColumn}>
              {leftToc.map((section) => (
                <Text key={section.title} style={styles.tocItem}>
                  {section.title}
                </Text>
              ))}
            </View>
            <View style={styles.tocColumn}>
              {rightToc.map((section) => (
                <Text key={section.title} style={styles.tocItem}>
                  {section.title}
                </Text>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.intro}>
          {introBlocks.map((block, index) => (
            <BlockView key={`intro-${index}`} block={block} />
          ))}
        </View>

        {sections.map((section) => (
          <View key={section.title} style={styles.section} break={sectionStartsNewPage(section.title)}>
            <Text style={styles.h2}>{section.title}</Text>
            {section.blocks.map((block, index) => (
              <BlockView key={`${section.title}-${index}`} block={block} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

async function main() {
  const markdown = readFileSync(sourcePath, 'utf8');
  const guide = parseGuide(markdown);

  mkdirSync(dirname(outputPath), { recursive: true });
  await renderToFile(<GuideDocument {...guide} />, outputPath);

  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
