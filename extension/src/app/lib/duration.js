// Duration formatting helpers. Pure.

export function formatEstimatedDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} sec`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 1440) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `about ${hours} hr${minutes ? ` ${minutes} min` : ""}`;
  }

  let days = Math.floor(totalMinutes / 1440);
  let hours = Math.round((totalMinutes % 1440) / 60);
  if (hours === 24) {
    days += 1;
    hours = 0;
  }
  return `about ${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} hr` : ""}`;
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDurationLong(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes} min ${seconds} sec` : `${seconds} sec`;
}
