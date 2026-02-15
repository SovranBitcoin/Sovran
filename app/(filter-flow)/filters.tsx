/**
 * @fileoverview Filters Screen - Transaction filter selection UI
 *
 * Allows users to filter transactions by:
 * - Currency (SAT, USD, EUR, GBP)
 * - Payment type (All, Lightning, Ecash)
 * - Direction (All, Incoming, Outgoing)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useTheme } from '@/providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { ModalScreenLayout } from 'components/layouts/ModalScreenLayout';
import { ButtonHandler } from 'components/ui/ButtonHandler';

type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';
type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';

const SUPPORTED_CURRENCIES = ['SAT', 'USD', 'EUR', 'GBP'];

interface ChipProps {
  label: string;
  icon?: string;
  isSelected: boolean;
  onPress: () => void;
}

const Chip: React.FC<ChipProps> = ({ label, icon, isSelected, onPress }) => {
  const { getPrimaryColor } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: isSelected
            ? opacity(getPrimaryColor('0'), 0.15)
            : opacity(getPrimaryColor('0'), 0.05),
          borderColor: isSelected
            ? opacity(getPrimaryColor('0'), 0.25)
            : opacity(getPrimaryColor('0'), 0.08),
        },
      ]}>
      {icon ? (
        <Icon
          name={icon}
          size={16}
          color={isSelected ? getPrimaryColor('0') : opacity(getPrimaryColor('0'), 0.4)}
        />
      ) : null}
      <Text
        size={14}
        style={{
          color: isSelected ? getPrimaryColor('0') : opacity(getPrimaryColor('0'), 0.4),
          fontFamily: 'OverpassSemibold',
        }}>
        {label}
      </Text>
    </Pressable>
  );
};

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={styles.section}>
      <Text
        size={13}
        style={{
          color: opacity(getPrimaryColor('0'), 0.33),
          fontFamily: 'OverpassSemibold',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 12,
        }}>
        {title}
      </Text>
      <View style={styles.chipsRow}>{children}</View>
    </View>
  );
};

export default function FiltersScreen() {
  const { getPrimaryColor } = useTheme();

  // Get initial values from params
  const params = useLocalSearchParams<{
    currency?: string;
    paymentType?: string;
    direction?: string;
    status?: string;
  }>();

  // State for filters
  const [currency, setCurrency] = useState<string>(params.currency || 'sat');
  const [paymentType, setPaymentType] = useState<PaymentType>(
    (params.paymentType as PaymentType) || 'all'
  );
  const [direction, setDirection] = useState<Direction>((params.direction as Direction) || 'all');
  const [status, setStatus] = useState<Status>((params.status as Status) || 'All');

  const handleApply = useCallback(() => {
    router.dismissTo({
      pathname: '/transactions',
      params: {
        filterCurrency: currency.toLowerCase(),
        filterPaymentType: paymentType,
        filterDirection: direction,
        filterStatus: status,
      },
    });
  }, [currency, paymentType, direction, status]);

  const handleReset = useCallback(() => {
    setCurrency('sat');
    setPaymentType('all');
    setDirection('all');
    setStatus('All');
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      currency.toLowerCase() !== 'sat' ||
      paymentType !== 'all' ||
      direction !== 'all' ||
      status !== 'All'
    );
  }, [currency, paymentType, direction, status]);

  return (
    <ModalScreenLayout
      bottomButtons={
        <View style={styles.bottomArea}>
          <ButtonHandler
            style={{ paddingBottom: 0 }}
            buttons={[
              {
                text: 'Apply Filters',
                variant: 'primary',
                onPress: async () => handleApply(),
              },
            ]}
          />
          <Pressable
            onPress={handleReset}
            disabled={!hasActiveFilters}
            style={[styles.resetButton, { opacity: hasActiveFilters ? 1 : 0 }]}>
            <Text
              size={14}
              style={{ color: opacity(getPrimaryColor('0'), 0.4), fontFamily: 'OverpassMedium' }}>
              Reset
            </Text>
          </Pressable>
        </View>
      }>
      <View style={styles.filterContent}>
        {/* Currency */}
        <Section title="Currency">
          {SUPPORTED_CURRENCIES.map((curr) => (
            <Chip
              key={curr}
              label={curr}
              isSelected={currency.toUpperCase() === curr}
              onPress={() => setCurrency(curr)}
            />
          ))}
        </Section>

        {/* Payment Type */}
        <Section title="Type">
          <Chip
            label="All"
            icon="fluent:apps-16-filled"
            isSelected={paymentType === 'all'}
            onPress={() => setPaymentType('all')}
          />
          <Chip
            label="Lightning"
            icon="mingcute:lightning-fill"
            isSelected={paymentType === 'lightning'}
            onPress={() => setPaymentType('lightning')}
          />
          <Chip
            label="Ecash"
            icon="majesticons:coins"
            isSelected={paymentType === 'ecash'}
            onPress={() => setPaymentType('ecash')}
          />
        </Section>

        {/* Direction */}
        <Section title="Direction">
          <Chip
            label="All"
            icon="fluent:arrow-swap-16-filled"
            isSelected={direction === 'all'}
            onPress={() => setDirection('all')}
          />
          <Chip
            label="In"
            icon="fluent:arrow-download-16-filled"
            isSelected={direction === 'incoming'}
            onPress={() => setDirection('incoming')}
          />
          <Chip
            label="Out"
            icon="fluent:arrow-upload-16-filled"
            isSelected={direction === 'outgoing'}
            onPress={() => setDirection('outgoing')}
          />
        </Section>

        {/* Status */}
        <Section title="Status">
          <Chip
            label="All"
            icon="fluent:list-16-filled"
            isSelected={status === 'All'}
            onPress={() => setStatus('All')}
          />
          <Chip
            label="Confirmed"
            icon="fluent:checkmark-circle-16-filled"
            isSelected={status === 'Confirmed'}
            onPress={() => setStatus('Confirmed')}
          />
          <Chip
            label="Pending"
            icon="fluent:clock-16-filled"
            isSelected={status === 'Pending'}
            onPress={() => setStatus('Pending')}
          />
          <Chip
            label="Expired"
            icon="fluent:dismiss-circle-16-filled"
            isSelected={status === 'Expired'}
            onPress={() => setStatus('Expired')}
          />
        </Section>
      </View>
    </ModalScreenLayout>
  );
}

const styles = StyleSheet.create({
  filterContent: {
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  bottomArea: {
    paddingBottom: 8,
  },
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
});
