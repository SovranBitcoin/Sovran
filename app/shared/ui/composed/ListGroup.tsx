import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Text as RNText, View as RNView } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { cn } from '@/shared/lib/classNames';
import { Pressable } from '@/shared/ui/primitives/Pressable';

/**
 * Grouped surfaces: `Card` and `ListGroup` share one rounded, shadowed
 * surface (`variant` picks the surface step); `ListGroup.Item` is the
 * standard row (16pt padding, 12pt gap) with title, description and a
 * trailing chevron by default; `Separator` is the hairline between rows.
 */

type SurfaceVariant = 'default' | 'secondary' | 'tertiary' | 'transparent';

const SURFACE_BG: Record<SurfaceVariant, string> = {
  default: 'bg-surface shadow-surface',
  secondary: 'bg-surface-secondary shadow-surface',
  tertiary: 'bg-surface-tertiary shadow-surface',
  transparent: 'bg-transparent',
};

type ViewProps = ComponentProps<typeof RNView> & { className?: string };
type TextProps = ComponentProps<typeof RNText> & { className?: string };
type SurfaceProps = ViewProps & { variant?: SurfaceVariant };

function surfaceClassName(variant: SurfaceVariant, padding: string, className?: string) {
  return cn('overflow-hidden rounded-3xl', padding, SURFACE_BG[variant], className);
}

const ListGroupRoot = forwardRef<RNView, SurfaceProps>(function ListGroup(
  { variant = 'default', className, style, ...rest },
  ref
) {
  return (
    <RNView
      ref={ref}
      className={surfaceClassName(variant, 'p-0', className)}
      style={[{ borderCurve: 'continuous' }, style]}
      {...rest}
    />
  );
});

const Item = forwardRef<RNView, ComponentProps<typeof Pressable> & { className?: string }>(
  function ListGroupItem({ className, ...rest }, ref) {
    return (
      <Pressable
        ref={ref}
        activeOpacity={1}
        className={cn('flex-row items-center gap-3 p-4', className)}
        {...rest}
      />
    );
  }
);

function ItemPrefix(props: ViewProps) {
  return <RNView {...props} />;
}

function ItemContent({ className, ...rest }: ViewProps) {
  return <RNView className={cn('flex-1', className)} {...rest} />;
}

function ItemTitle({ className, ...rest }: TextProps) {
  return (
    <RNText
      className={cn('text-foreground text-left text-base font-medium', className)}
      {...rest}
    />
  );
}

function ItemDescription({ className, ...rest }: TextProps) {
  return <RNText className={cn('text-muted text-left text-sm font-normal', className)} {...rest} />;
}

function ChevronRight({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.205 19.545a1.125 1.125 0 0 1 0-1.59L14.16 12l-5.955-5.955a1.125 1.125 0 1 1 1.59-1.59l6.75 6.75a1.125 1.125 0 0 1 0 1.59l-6.75 6.75a1.125 1.125 0 0 1-1.59 0"
      />
    </Svg>
  );
}

/** Trailing slot; with no children it draws the muted chevron. */
function ItemSuffix({
  children,
  iconProps,
  ...rest
}: ViewProps & { iconProps?: { size?: number; color?: string } }) {
  const [muted] = useThemeColor(['muted'] as const);
  return (
    <RNView {...rest}>
      {children ?? (
        <RNView className="rtl:-scale-x-100">
          <ChevronRight size={iconProps?.size ?? 16} color={iconProps?.color ?? muted} />
        </RNView>
      )}
    </RNView>
  );
}

export const ListGroup = Object.assign(ListGroupRoot, {
  Item,
  ItemPrefix,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemSuffix,
});

/** A hairline (or 6pt `thick`) rule in the theme's separator colour. */
export function Separator({
  className,
  variant = 'thin',
  orientation = 'horizontal',
  ...rest
}: ViewProps & { variant?: 'thin' | 'thick'; orientation?: 'horizontal' | 'vertical' }) {
  const size =
    orientation === 'horizontal'
      ? variant === 'thin'
        ? 'h-hairline'
        : 'h-[6px]'
      : variant === 'thin'
        ? 'h-full w-hairline'
        : 'h-full w-[6px]';
  return <RNView className={cn('bg-separator', size, className)} {...rest} />;
}

function CardRoot({ variant = 'default', className, style, ...rest }: SurfaceProps) {
  return (
    <RNView
      className={surfaceClassName(variant, 'p-4', className)}
      style={[{ borderCurve: 'continuous' }, style]}
      {...rest}
    />
  );
}

function CardBody(props: ViewProps & { children?: ReactNode }) {
  return <RNView {...props} />;
}

function CardDescription({ className, ...rest }: TextProps) {
  return (
    <RNText className={cn('text-muted text-left text-base font-normal', className)} {...rest} />
  );
}

export const Card = Object.assign(CardRoot, { Body: CardBody, Description: CardDescription });
