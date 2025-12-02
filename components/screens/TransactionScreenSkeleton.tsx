/**
 * @fileoverview Skeleton loading components for transaction screens
 *
 * These skeletons match the exact dimensions of their corresponding components
 * to prevent content shift during loading.
 */

import React from 'react';
import { Skeleton } from 'components/ui/Skeleton';
import { View, HStack, VStack, Spacer } from 'components/ui/View';

/**
 * Skeleton for HistoryEntryHeader
 * Matches: p-5 pb-0 pt-0, amount text (28-32px), secondary text (18px), icon (50x50)
 */
export function HistoryEntryHeaderSkeleton() {
  return (
    <HStack align="center" justify="space-between" className="p-5 pb-0 pt-0">
      <VStack>
        <HStack align="center">
          <Spacer size={8} />
          {/* Sign */}
          <Skeleton className="h-8 w-4 rounded bg-primary-800" />
          <Spacer size={8} />
          {/* Amount */}
          <Skeleton className="h-8 w-32 rounded bg-primary-800" />
        </HStack>
        {/* Secondary amount */}
        <Skeleton className="mt-1 h-5 w-24 rounded bg-primary-800" />
      </VStack>
      {/* Transaction icon */}
      <View className="scale-125 transform bg-transparent p-4">
        <Skeleton className="h-10 w-10 rounded-full bg-primary-800" />
      </View>
    </HStack>
  );
}

/**
 * Skeleton for PaymentInfo (QR code)
 * Matches: QR code container with 256x256 size + padding
 */
export function PaymentInfoSkeleton() {
  return (
    <HStack align="center" justify="center">
      <Skeleton
        className="bg-primary-800"
        style={{
          width: 256,
          height: 256,
          borderRadius: 12,
          margin: 32,
        }}
      />
    </HStack>
  );
}

/**
 * Skeleton for HistoryEntryRefresh
 * Matches: marginHorizontal: 16, padding: 16, avatar (40x40), text
 */
export function HistoryEntryRefreshSkeleton() {
  return (
    <HStack
      align="center"
      justify="space-between"
      className="rounded-lg bg-primary-900"
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
        padding: 16,
      }}>
      <HStack align="center" gap={4}>
        {/* Avatar */}
        <Skeleton className="h-10 w-10 rounded-full bg-primary-800" />
        <Spacer size={12} />
        <VStack gap={4}>
          {/* "Receiving with" / "Sending with" text */}
          <Skeleton className="h-4 w-24 rounded bg-primary-800" />
          {/* Mint name */}
          <Skeleton className="h-4 w-32 rounded bg-primary-800" />
        </VStack>
      </HStack>
    </HStack>
  );
}

/**
 * Skeleton for HistoryEntryTimeline
 * Matches: marginHorizontal: 16, padding: 16, borderRadius: 12
 */
export function HistoryEntryTimelineSkeleton() {
  return (
    <View
      blur
      className="bg-primary-800"
      style={{
        padding: 16,
        marginHorizontal: 16,
        borderRadius: 12,
      }}>
      {/* State label */}
      <Skeleton
        className="bg-primary-700"
        style={{
          height: 14,
          width: 80,
          borderRadius: 4,
          marginBottom: 8,
        }}
      />

      {/* Timeline items - typically 2-3 items */}
      {[0, 1, 2].map((index) => (
        <HStack key={index} style={{ marginVertical: 4 }} align="center">
          <View style={{ flex: 1 }}>
            <HStack align="center">
              {/* Timeline bar */}
              <Skeleton
                className="bg-primary-700"
                style={{
                  width: 4.5,
                  height: 48,
                  borderRadius: 2,
                }}
              />
              <View style={{ flex: 1, marginStart: 12 }}>
                {/* State name */}
                <Skeleton
                  className="bg-primary-700"
                  style={{
                    height: 16,
                    width: 60,
                    borderRadius: 4,
                    marginBottom: 4,
                  }}
                />
                {/* Timestamp (only first item) */}
                {index === 0 && (
                  <Skeleton
                    className="bg-primary-700"
                    style={{
                      height: 12,
                      width: 100,
                      borderRadius: 4,
                    }}
                  />
                )}
              </View>
            </HStack>
          </View>
        </HStack>
      ))}
    </View>
  );
}

/**
 * Skeleton for Section component
 * Matches: marginHorizontal: 16, padding: 8, items with p-2
 */
interface SectionSkeletonProps {
  /** Number of items to display */
  itemCount?: number;
}

export function SectionSkeleton({ itemCount = 4 }: SectionSkeletonProps) {
  return (
    <View
      className="overflow-hidden rounded-lg"
      style={{
        marginHorizontal: 16,
      }}>
      <VStack
        blur
        className="bg-primary-800"
        style={{
          borderRadius: 8,
          padding: 8,
        }}>
        {Array.from({ length: itemCount }).map((_, index) => (
          <HStack key={index} justify="space-between" className="p-2">
            {/* Title */}
            <Skeleton
              className="bg-primary-700"
              style={{
                height: 16,
                width: 60,
                borderRadius: 4,
              }}
            />
            <Spacer size={8} />
            {/* Value */}
            <Skeleton
              className="bg-primary-700"
              style={{
                height: 16,
                width: 80,
                borderRadius: 4,
              }}
            />
          </HStack>
        ))}
      </VStack>
    </View>
  );
}

/**
 * Skeleton for WalletHeaderTitle (mint selector)
 * Matches the glass button with mint balance display
 */
export function WalletHeaderTitleSkeleton() {
  return (
    <HStack align="center" justify="center" style={{ paddingHorizontal: 64 }}>
      <Skeleton
        className="bg-primary-800"
        style={{
          height: 50,
          width: '100%',
          borderRadius: 12,
        }}
      />
    </HStack>
  );
}

/**
 * Skeleton for ButtonHandler (bottom buttons)
 * Matches: flex-row pb-6, typically 2 buttons
 */
interface ButtonHandlerSkeletonProps {
  /** Number of buttons to display */
  buttonCount?: number;
}

export function ButtonHandlerSkeleton({ buttonCount = 2 }: ButtonHandlerSkeletonProps) {
  return (
    <HStack align="center" justify="space-between" spacing={0} className="flex-row pb-6">
      {Array.from({ length: buttonCount }).map((_, index) => (
        <View key={index} className="flex-1" style={{ marginHorizontal: 8 }}>
          <Skeleton
            className="bg-primary-800"
            style={{
              height: 48,
              borderRadius: 12,
            }}
          />
        </View>
      ))}
    </HStack>
  );
}

/**
 * Full screen skeleton for ReceiveTokenScreen
 */
export function ReceiveTokenScreenSkeleton() {
  return (
    <VStack gap={12}>
      <HistoryEntryHeaderSkeleton />
      <HistoryEntryRefreshSkeleton />
      <SectionSkeleton itemCount={2} />
    </VStack>
  );
}

/**
 * Full screen skeleton for SendTokenScreen (pending state with QR)
 */
export function SendTokenScreenSkeleton({ isPaid = false }: { isPaid?: boolean }) {
  return (
    <VStack gap={12}>
      <HistoryEntryHeaderSkeleton />
      {!isPaid && <PaymentInfoSkeleton />}
      <HistoryEntryRefreshSkeleton />
      <HistoryEntryTimelineSkeleton />
      <SectionSkeleton itemCount={5} />
    </VStack>
  );
}

/**
 * Full screen skeleton for MeltQuoteScreen
 */
export function MeltQuoteScreenSkeleton() {
  return (
    <VStack gap={12}>
      <HistoryEntryHeaderSkeleton />
      <WalletHeaderTitleSkeleton />
      <HistoryEntryTimelineSkeleton />
      <SectionSkeleton itemCount={7} />
    </VStack>
  );
}

/**
 * Full screen skeleton for MintQuoteScreen (pending state with QR)
 */
export function MintQuoteScreenSkeleton({ isPaid = false }: { isPaid?: boolean }) {
  return (
    <VStack gap={12}>
      <HistoryEntryHeaderSkeleton />
      {!isPaid && <PaymentInfoSkeleton />}
      <HistoryEntryRefreshSkeleton />
      <HistoryEntryTimelineSkeleton />
      <SectionSkeleton itemCount={4} />
    </VStack>
  );
}
