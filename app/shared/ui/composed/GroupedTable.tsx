import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Icon from 'assets/icons';

import { useStylePaint } from '@/shared/styles/appStyle';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';

/**
 * @fileoverview A grouped table in the iOS manner: a small heading, then one
 * rounded group of rows, each a label and its value, split by hairlines that
 * start at the label. For settings-like and details-like content, where the
 * rows are facts rather than things in a feed.
 *
 *   <GroupedTable>
 *     <GroupedTable.Section title="Payment">
 *       <GroupedTable.Row label="Amount" value="21,000 sats" />
 *       <GroupedTable.Row label="Invoice" value={invoice} copyable stacked />
 *     </GroupedTable.Section>
 *   </GroupedTable>
 *
 * The group's frame is the active style's surface. A `flat` style has no
 * surface, and a table without a frame is a list, so there it takes the
 * style's control fill instead.
 */
export function GroupedTable({ children }: { children: ReactNode }) {
  const paint = useStylePaint();
  return <View style={{ gap: paint.style.space.group }}>{children}</View>;
}

interface SectionProps {
  title?: string;
  /** A sentence under the group, explaining it. */
  footer?: string;
  children: ReactNode;
}

function Section({ title, footer, children }: SectionProps) {
  const paint = useStylePaint();
  const { pad, related } = paint.style.space;
  const rows = Children.toArray(children).filter(isValidElement);
  if (rows.length === 0) return null;
  const frame = paint.cardIsBare
    ? {
        backgroundColor: paint.chipFill,
        borderCurve: 'continuous' as const,
        borderRadius: 12,
        overflow: 'hidden' as const,
      }
    : paint.card;
  return (
    <View style={{ gap: related * 2 }}>
      {title ? (
        <Text size={13} semibold color={paint.text.secondary} style={{ paddingHorizontal: pad }}>
          {paint.style.type.uppercaseLabels ? title.toUpperCase() : title}
        </Text>
      ) : null}
      <View style={frame}>
        {rows.map((row, index) => (
          <View key={row.key ?? index}>
            {index > 0 ? (
              <View
                style={{ height: 1, marginLeft: pad, backgroundColor: paint.divider }}
                importantForAccessibility="no"
              />
            ) : null}
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <Text size={13} color={paint.text.secondary} style={{ paddingHorizontal: pad }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

interface RowProps {
  label: string;
  /** Text is laid out by the row. Anything else is rendered as given. */
  value: ReactNode;
  /** Put the value under the label: for long values such as ids and invoices. */
  stacked?: boolean;
  /** Tapping the row copies the value. */
  copyable?: boolean;
  /** Set the value in the monospace face: for keys, ids and hashes, which are
   *  compared character by character. */
  mono?: boolean;
  /** What is copied when the value is drawn rather than written. Defaults to
   *  the value's own text. */
  copyText?: string;
  testID?: string;
}

const COPIED_MS = 1500;

function Row({
  label,
  value,
  stacked = false,
  copyable = false,
  copyText,
  mono = false,
  testID,
}: RowProps) {
  const paint = useStylePaint();
  const { pad, related, item } = paint.style.space;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  const toCopy = copyText ?? text;
  const canCopy = copyable && toCopy !== null && toCopy.length > 0;

  const valueNode =
    text === null ? (
      value
    ) : (
      <Text
        size={mono ? 13 : stacked ? 15 : 16}
        {...(mono ? { family: 'mono' as const } : {})}
        color={stacked ? paint.text.primary : paint.text.secondary}
        selectable={!canCopy}
        numberOfLines={stacked ? 6 : 1}
        ellipsizeMode="middle"
        style={stacked ? undefined : { flexShrink: 1, textAlign: 'right' }}>
        {text}
      </Text>
    );

  const copyMark = canCopy ? (
    <Icon
      name={copied ? 'mdi:check' : 'lets-icons:copy'}
      size={18}
      color={copied ? paint.text.primary : paint.text.tertiary}
    />
  ) : null;

  const body = stacked ? (
    <View
      style={{
        gap: related,
        minHeight: paint.style.size.control,
        paddingHorizontal: pad,
        paddingVertical: item,
      }}>
      <Text size={13} color={paint.text.secondary}>
        {label}
      </Text>
      <View className="flex-row items-start" style={{ gap: item }}>
        <View className="flex-1">{valueNode}</View>
        {copyMark}
      </View>
    </View>
  ) : (
    <View
      className="flex-row items-center justify-between"
      style={{
        gap: item,
        minHeight: paint.style.size.control,
        paddingHorizontal: pad,
        paddingVertical: related * 2,
      }}>
      <Text size={16} color={paint.text.primary}>
        {label}
      </Text>
      <View className="flex-1 flex-row items-center justify-end" style={{ gap: related * 2 }}>
        {valueNode}
        {copyMark}
      </View>
    </View>
  );

  if (!canCopy) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text ?? toCopy}`}
      accessibilityHint={copied ? 'Copied' : 'Copies the value'}
      onPress={async () => {
        await Clipboard.setStringAsync(toCopy);
        void EnhancedHaptics.copyHaptic();
        setCopied(true);
      }}>
      {body}
    </Pressable>
  );
}

interface ActionProps {
  label: string;
  icon?: string;
  onPress: () => void | Promise<void>;
  testID?: string;
}

/** A row that does something: one label, the whole row is the target. */
function Action({ label, icon, onPress, testID }: ActionProps) {
  const paint = useStylePaint();
  const { pad, item } = paint.style.space;
  return (
    <Pressable
      testID={testID}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center"
      style={{ gap: item, minHeight: paint.style.size.control, paddingHorizontal: pad }}
      onPress={onPress}>
      {icon ? <Icon name={icon} size={20} color={paint.text.primary} /> : null}
      <Text size={16} semibold color={paint.text.primary}>
        {label}
      </Text>
    </Pressable>
  );
}

GroupedTable.Section = Section;
GroupedTable.Action = Action;
GroupedTable.Row = Row;
