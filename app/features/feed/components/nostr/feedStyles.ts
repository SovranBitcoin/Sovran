import { StyleSheet } from 'react-native';
import { radius, spacing } from '@/shared/styles/tokens';

export const sharedStyles = StyleSheet.create({
  noteFooter: {},
  footerBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
  },
  quotedCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  mediaCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  imageBlockOuter: {
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoBlockOuter: {
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  flex1: {
    flex: 1,
  },
  mb4: {
    marginBottom: 4,
  },
  mb6: {
    marginBottom: 6,
  },
  mb10: {
    marginBottom: 10,
  },
});
