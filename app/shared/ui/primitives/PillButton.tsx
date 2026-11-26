import { type ComponentProps, type ReactNode } from 'react';
import { Text as RNText } from 'react-native';

import { cn } from '@/shared/lib/classNames';
import { injectParts } from '@/shared/lib/injectParts';
import { PressableFeedback } from './PressableFeedback';

type PillVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost';
type PillSize = 'sm' | 'md';

const ROOT: Record<PillVariant, string> = {
  primary: 'bg-accent',
  secondary: 'bg-default',
  tertiary: 'bg-default',
  ghost: 'bg-transparent',
};
const LABEL: Record<PillVariant, string> = {
  primary: 'text-accent-foreground',
  secondary: 'text-accent-soft-foreground',
  tertiary: 'text-default-foreground',
  ghost: 'text-default-foreground',
};
const SIZE: Record<PillSize, { root: string; label: string }> = {
  sm: { root: 'h-10 gap-1.5 px-3.5', label: 'text-sm' },
  md: { root: 'h-12 gap-2 px-4', label: 'text-base' },
};

type PillButtonProps = Omit<ComponentProps<typeof PressableFeedback>, 'animation'> & {
  variant?: PillVariant;
  size?: PillSize;
  /** `scale` drops the press highlight and keeps only the shrink. */
  feedbackVariant?: 'scale';
  /** A square button around a single icon. */
  isIconOnly?: boolean;
  children?: ReactNode;
};

/**
 * The compact rounded button used inside cards, sheets and toasts (the
 * full-width call to action is `Button`). Accent, default or no fill; 40pt
 * (`sm`) or 48pt (`md`) tall; shrinks and highlights on press.
 */
function PillButtonRoot({
  variant = 'primary',
  size = 'md',
  feedbackVariant,
  isIconOnly = false,
  className,
  isDisabled,
  children,
  ...rest
}: PillButtonProps) {
  return (
    <PressableFeedback
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      isDisabled={isDisabled}
      className={cn(
        'flex-row items-center justify-center rounded-3xl',
        ROOT[variant],
        SIZE[size].root,
        isIconOnly && 'aspect-square p-0',
        isDisabled && 'opacity-disabled',
        className
      )}
      {...rest}>
      {feedbackVariant === 'scale' ? null : <PressableFeedback.Highlight />}
      {injectParts(children, [PillButtonLabel], { variant, size })}
    </PressableFeedback>
  );
}

function PillButtonLabel({
  className,
  variant = 'primary',
  size = 'md',
  ...rest
}: ComponentProps<typeof RNText> & { className?: string; variant?: PillVariant; size?: PillSize }) {
  return (
    <RNText className={cn('font-medium', LABEL[variant], SIZE[size].label, className)} {...rest} />
  );
}

export const PillButton = Object.assign(PillButtonRoot, { Label: PillButtonLabel });
