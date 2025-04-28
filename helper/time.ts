/**
 * Time utility functions for formatting and calculating time-related data
 */

/**
 * Represents time data with activation and expiration information
 */
interface TimeData {
  activateTime: string;
  expiredTime: string;
}

/**
 * Represents processed time information with formatted times and remaining duration
 */
interface ProcessedTimeInfo {
  activateTime: string;
  expiredTime: string;
  daysLeft: number;
  hoursLeft: number;
  percentageTimeUsed: string;
  isExpired: boolean;
}

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

/**
 * Formats a date to YYYY-MM-DD HH:MM format
 */
export function formatToDateTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Processes time data to calculate remaining time and usage percentage
 */
export function convertTimeData(data: TimeData): ProcessedTimeInfo {
  if (!data?.activateTime || !data?.expiredTime) {
    throw new Error('Invalid time data: activation and expiration times are required');
  }

  const activateTime = new Date(data.activateTime);
  const expiredTime = new Date(data.expiredTime);
  const now = new Date();

  const timeLeft = Math.max(0, expiredTime.getTime() - now.getTime());
  const totalTime = expiredTime.getTime() - activateTime.getTime();

  const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const percentageTimeUsed = totalTime > 0 ? ((totalTime - timeLeft) / totalTime) * 100 : 100;

  return {
    activateTime: formatToDateTime(activateTime),
    expiredTime: formatToDateTime(expiredTime),
    daysLeft,
    hoursLeft,
    percentageTimeUsed: `${percentageTimeUsed.toFixed(2)}%`,
    isExpired: now > expiredTime,
  };
}
