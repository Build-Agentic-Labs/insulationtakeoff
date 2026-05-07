import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import { formatCurrency } from '../calculations/pricing';
import { formatQuantity, type QuoteLineItem } from '@/lib/quotes/estimate';

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 30,
    paddingBottom: 36,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#2b2b2b',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 96,
    height: 72,
    objectFit: 'contain',
    borderRadius: 4,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  companyLegalName: {
    fontSize: 9,
    color: '#4b5563',
    marginTop: 3,
  },
  companyMeta: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  estimateMeta: {
    alignItems: 'flex-end',
  },
  estimateLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#8b7d4a',
  },
  estimateTitle: {
    marginTop: 4,
    fontSize: 17,
    fontWeight: 'bold',
  },
  projectCard: {
    marginBottom: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#ece4d2',
    paddingVertical: 10,
  },
  projectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  projectLabel: {
    color: '#6b7280',
  },
  projectValue: {
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#ece4d2',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#b9983f',
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  sectionHeaderText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionSubtotalHeader: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#faf7ef',
    borderBottomWidth: 1,
    borderBottomColor: '#e6decd',
  },
  tableHeaderCell: {
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#8b7d4a',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1ebdd',
  },
  rowAlt: {
    backgroundColor: '#fdfbf6',
  },
  colIndex: {
    width: '7%',
  },
  colDescription: {
    width: '49%',
    paddingRight: 8,
  },
  colQty: {
    width: '14%',
    textAlign: 'right',
  },
  colRate: {
    width: '14%',
    textAlign: 'right',
  },
  colAmount: {
    width: '16%',
    textAlign: 'right',
  },
  rowNumber: {
    color: '#8b7d4a',
  },
  rowDescription: {
    fontSize: 9,
  },
  rowNotes: {
    marginTop: 2,
    fontSize: 8,
    color: '#6b7280',
  },
  sectionSubtotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fbf8ef',
  },
  sectionSubtotalLabel: {
    color: '#8b7d4a',
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionSubtotalValue: {
    fontWeight: 'bold',
  },
  totalsBlock: {
    marginTop: 10,
    marginLeft: 'auto',
    width: 260,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e6decd',
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  totalsLabel: {
    color: '#6b7280',
    fontWeight: 'bold',
  },
  totalRow: {
    borderColor: '#cdb260',
    backgroundColor: '#f7f0dc',
  },
  totalLabel: {
    color: '#8b6b16',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  totalValue: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  terms: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#d7bc6a',
    paddingTop: 8,
  },
  termsHeader: {
    paddingBottom: 6,
  },
  termsHeaderText: {
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#8b7d4a',
    fontWeight: 'bold',
  },
  termsBody: {
    paddingVertical: 4,
    paddingHorizontal: 0,
    lineHeight: 1.5,
    color: '#4b5563',
  },
});

interface QuotePDFProps {
  projectName: string;
  projectDate: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  taxAmount: number;
  totalCost: number;
  quantityLabel: string;
  terms?: string;
  companyName?: string;
  companyLegalName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyLicenseNumber?: string;
  companyLogoUrl?: string | null;
}

export function QuotePDF({
  projectName,
  projectDate,
  lineItems,
  subtotal,
  taxAmount,
  totalCost,
  quantityLabel,
  terms,
  companyName = 'Company Workspace',
  companyLegalName,
  companyAddress,
  companyPhone,
  companyEmail,
  companyWebsite,
  companyLicenseNumber,
  companyLogoUrl,
}: QuotePDFProps) {
  const contactDetails = [companyPhone, companyEmail, companyWebsite].filter(Boolean).join(' · ');
  const licenseDetails = companyLicenseNumber ? `License ${companyLicenseNumber}` : null;
  const showLegalName = companyLegalName && companyLegalName !== companyName;
  const groupedSections = Array.from(
    lineItems.reduce((map, item) => {
      const section = item.section?.trim() || 'Estimate Items';
      if (!map.has(section)) {
        map.set(section, []);
      }
      map.get(section)!.push(item);
      return map;
    }, new Map<string, QuoteLineItem[]>())
  );

  let rowNumber = 1;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            {companyLogoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image style={styles.logo} src={companyLogoUrl} />
            ) : null}
            <View>
              <Text style={styles.companyName}>{companyName}</Text>
              {showLegalName ? <Text style={styles.companyLegalName}>{companyLegalName}</Text> : null}
              {companyAddress ? <Text style={styles.companyMeta}>{companyAddress}</Text> : null}
              {contactDetails ? <Text style={styles.companyMeta}>{contactDetails}</Text> : null}
              {licenseDetails ? <Text style={styles.companyMeta}>{licenseDetails}</Text> : null}
            </View>
          </View>

          <View style={styles.estimateMeta}>
            <Text style={styles.estimateLabel}>Estimate Worksheet</Text>
            <Text style={styles.estimateTitle}>Insulation Quote</Text>
          </View>
        </View>

        <View style={styles.projectCard}>
          <View style={styles.projectRow}>
            <Text style={styles.projectLabel}>Project</Text>
            <Text style={styles.projectValue}>{projectName}</Text>
          </View>
          <View style={styles.projectRow}>
            <Text style={styles.projectLabel}>Date</Text>
            <Text style={styles.projectValue}>{projectDate}</Text>
          </View>
          <View style={styles.projectRow}>
            <Text style={styles.projectLabel}>Included quantity</Text>
            <Text style={styles.projectValue}>{quantityLabel}</Text>
          </View>
        </View>

        {groupedSections.map(([sectionTitle, items], sectionIndex) => {
          const sectionSubtotal = items.reduce((sum, item) => sum + item.totalCost, 0);

          return (
            <View key={`${sectionTitle}-${sectionIndex}`} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{sectionTitle}</Text>
                <Text style={styles.sectionSubtotalHeader}>{formatCurrency(sectionSubtotal)}</Text>
              </View>

              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.colIndex]}>#</Text>
                <Text style={[styles.tableHeaderCell, styles.colDescription]}>Description</Text>
                <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
                <Text style={[styles.tableHeaderCell, styles.colRate]}>Unit Rate</Text>
                <Text style={[styles.tableHeaderCell, styles.colAmount]}>Amount</Text>
              </View>

              {items.map((item, itemIndex) => {
                const currentNumber = rowNumber++;
                return (
                  <View
                    key={`${sectionTitle}-${item.area}-${itemIndex}`}
                    style={itemIndex % 2 === 1 ? [styles.row, styles.rowAlt] : styles.row}
                    wrap={false}
                  >
                    <Text style={[styles.colIndex, styles.rowNumber]}>{currentNumber}</Text>
                    <View style={styles.colDescription}>
                      <Text style={styles.rowDescription}>{item.area}</Text>
                      {item.notes ? <Text style={styles.rowNotes}>{item.notes}</Text> : null}
                    </View>
                    <Text style={styles.colQty}>{formatQuantity(item.quantity, item.unit)}</Text>
                    <Text style={styles.colRate}>{formatCurrency(item.pricePerUnit)}/{item.unit}</Text>
                    <Text style={styles.colAmount}>{formatCurrency(item.totalCost)}</Text>
                  </View>
                );
              })}

              <View style={styles.sectionSubtotalRow} wrap={false}>
                <Text style={styles.sectionSubtotalLabel}>Section subtotal</Text>
                <Text style={styles.sectionSubtotalValue}>{formatCurrency(sectionSubtotal)}</Text>
              </View>
            </View>
          );
        })}

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Tax</Text>
            <Text>{formatCurrency(taxAmount)}</Text>
          </View>
          <View style={[styles.totalsRow, styles.totalRow]}>
            <Text style={[styles.totalsLabel, styles.totalLabel]}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(totalCost)}</Text>
          </View>
        </View>

        <View style={styles.terms}>
          <View style={styles.termsHeader}>
            <Text style={styles.termsHeaderText}>Terms & Conditions</Text>
          </View>
          <Text style={styles.termsBody}>
            {terms?.trim() ||
              'Final field measurements will be verified before installation. Pricing includes labor and standard insulation materials unless noted otherwise.'}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
