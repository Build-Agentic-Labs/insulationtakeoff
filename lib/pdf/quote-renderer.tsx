import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import { LineItem } from '../calculations/insulation';
import { formatCurrency, formatSqft } from '../calculations/pricing';

// Define styles for the PDF
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 30,
  },
  companyName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  companyInfo: {
    fontSize: 10,
    color: '#666',
    marginBottom: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
  },
  projectInfo: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  projectInfoRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  label: {
    fontWeight: 'bold',
    width: 100,
  },
  value: {
    flex: 1,
  },
  table: {
    marginTop: 20,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#2563eb',
    color: 'white',
    padding: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    padding: 8,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    padding: 8,
    backgroundColor: '#f9fafb',
  },
  colArea: {
    width: '35%',
  },
  colSqft: {
    width: '15%',
    textAlign: 'right',
  },
  colRValue: {
    width: '15%',
    textAlign: 'center',
  },
  colPrice: {
    width: '17.5%',
    textAlign: 'right',
  },
  colTotal: {
    width: '17.5%',
    textAlign: 'right',
  },
  totalSection: {
    marginTop: 10,
    borderTopWidth: 2,
    borderTopColor: '#2563eb',
    paddingTop: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 5,
  },
  totalLabel: {
    width: 150,
    textAlign: 'right',
    fontWeight: 'bold',
    marginRight: 10,
  },
  totalValue: {
    width: 100,
    textAlign: 'right',
  },
  grandTotal: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2563eb',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#666',
    fontSize: 9,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
  },
  notes: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#fef3c7',
    borderRadius: 4,
  },
  notesTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
  notesList: {
    marginLeft: 10,
  },
  notesItem: {
    marginBottom: 3,
  },
});

interface QuotePDFProps {
  projectName: string;
  projectDate: string;
  lineItems: LineItem[];
  totalCost: number;
  totalSqft: number;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
}

export function QuotePDF({
  projectName,
  projectDate,
  lineItems,
  totalCost,
  totalSqft,
  companyName = 'Insulation Experts Inc.',
  companyAddress = '123 Main St, Your City, ST 12345',
  companyPhone = '(555) 123-4567',
  companyEmail = 'info@insulationexperts.com',
}: QuotePDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.companyName}>{companyName}</Text>
          <Text style={styles.companyInfo}>{companyAddress}</Text>
          <Text style={styles.companyInfo}>
            Phone: {companyPhone} | Email: {companyEmail}
          </Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>INSULATION QUOTE</Text>

        {/* Project Information */}
        <View style={styles.projectInfo}>
          <View style={styles.projectInfoRow}>
            <Text style={styles.label}>Project:</Text>
            <Text style={styles.value}>{projectName}</Text>
          </View>
          <View style={styles.projectInfoRow}>
            <Text style={styles.label}>Date:</Text>
            <Text style={styles.value}>{projectDate}</Text>
          </View>
          <View style={styles.projectInfoRow}>
            <Text style={styles.label}>Total Area:</Text>
            <Text style={styles.value}>{formatSqft(totalSqft)} sq ft</Text>
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colArea}>Area</Text>
            <Text style={styles.colSqft}>Sq Ft</Text>
            <Text style={styles.colRValue}>R-Value</Text>
            <Text style={styles.colPrice}>Price/Sq Ft</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>

          {lineItems.map((item, index) => (
            <View
              key={index}
              style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
            >
              <Text style={styles.colArea}>{item.area}</Text>
              <Text style={styles.colSqft}>{formatSqft(item.sqft)}</Text>
              <Text style={styles.colRValue}>
                {item.rValue ? `R-${item.rValue}` : 'N/A'}
              </Text>
              <Text style={styles.colPrice}>
                {formatCurrency(item.pricePerSqft)}
              </Text>
              <Text style={styles.colTotal}>
                {formatCurrency(item.totalCost)}
              </Text>
            </View>
          ))}
        </View>

        {/* Total Section */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>{formatCurrency(totalCost)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, styles.grandTotal]}>
              Total:
            </Text>
            <Text style={[styles.totalValue, styles.grandTotal]}>
              {formatCurrency(totalCost)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        <View style={styles.notes}>
          <Text style={styles.notesTitle}>Important Notes:</Text>
          <View style={styles.notesList}>
            <Text style={styles.notesItem}>
              • All measurements extracted from architectural plans using AI technology
            </Text>
            <Text style={styles.notesItem}>
              • Final measurements will be verified on-site before installation
            </Text>
            <Text style={styles.notesItem}>
              • Quote valid for 30 days from date of issue
            </Text>
            <Text style={styles.notesItem}>
              • Materials and labor included in pricing
            </Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          This quote was generated using AI-powered measurement extraction from architectural plans.
          {'\n'}
          All measurements should be verified on-site before final installation.
        </Text>
      </Page>
    </Document>
  );
}
