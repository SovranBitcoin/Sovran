/**
 * Converts a Date object to a formatted date-time string
 */
export function convertTime(date: Date): string {
  const dateFormat = {
    year: 'numeric' as const,
    month: '2-digit' as const,
    day: '2-digit' as const,
    hour: '2-digit' as const,
    minute: '2-digit' as const,
    second: '2-digit' as const,
    hour12: false, // Use 24-hour time format
  };

  const formatter = new Intl.DateTimeFormat('en-US', dateFormat);
  return formatter.format(date);
}
