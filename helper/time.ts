export function convertTime(date: Date) {
  const dateFormat = {
    year: 'numeric' as const,
    month: '2-digit' as const,
    day: '2-digit' as const,
  };
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...dateFormat,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false // Use 24-hour time format
  });
  const formattedDate = formatter.format(date);
  return formattedDate;
}

export function convertTimeData(data: { activateTime: string; expiredTime: string }) {
  const activateTime = new Date(data.activateTime);
  const expiredTime = new Date(data.expiredTime);
  const now = new Date();
  const timeLeft = expiredTime.getTime() - now.getTime();
  const totalTime = expiredTime.getTime() - activateTime.getTime();
  const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor(
    (timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const percentageTimeUsed = ((totalTime - timeLeft) / totalTime) * 100;
  const activateTimeFormatted = activateTime
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const expiredTimeFormatted = expiredTime
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  return {
    activateTime: activateTimeFormatted,
    expiredTime: expiredTimeFormatted,
    daysLeft: daysLeft,
    hoursLeft: hoursLeft,
    percentageTimeUsed: percentageTimeUsed.toFixed(2) + "%",
  };
}