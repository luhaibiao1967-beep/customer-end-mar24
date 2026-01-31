// Timezone helper functions for Jakarta (GMT+7) timezone conversion

/**
 * Jakarta timezone offset in milliseconds (7 hours = 7 * 60 * 60 * 1000)
 */
export const JAKARTA_TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Converts a UTC date/timestamp to Jakarta local time (GMT+7)
 * This correctly handles timezone conversion by treating input as UTC
 * @param utcDate - UTC date string, Date object, or timestamp
 * @returns Date object adjusted to Jakarta timezone
 */
export const convertToJakartaTime = (utcDate: string | Date | number): Date => {
  if (!utcDate) return new Date();
  
  const date = new Date(utcDate);
  // Get UTC time in milliseconds and add Jakarta offset (GMT+7)
  const utcTime = date.getTime();
  const jakartaTime = new Date(utcTime + JAKARTA_TIMEZONE_OFFSET_MS);
  
  return jakartaTime;
};

/**
 * Formats a date to YYYY-MM-DD format in Jakarta timezone
 * Uses Intl API for proper timezone handling
 * @param date - Date to format (can be UTC)
 * @returns Formatted date string in YYYY-MM-DD format
 */
export const formatDateJakarta = (date: string | Date | number): string => {
  if (!date) return '';
  
  const d = new Date(date);
  
  // Use Intl.DateTimeFormat to format in Jakarta timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  return formatter.format(d);
};

/**
 * Formats a date to localized date string in Jakarta timezone
 * @param date - Date to format (can be UTC)
 * @returns Formatted date string (e.g., "31/12/2023")
 */
export const formatDateLocalizedJakarta = (date: string | Date | number): string => {
  if (!date) return '';
  
  const d = new Date(date);
  
  // Use Indonesian locale with Jakarta timezone
  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  return formatter.format(d);
};

/**
 * Formats a date to localized datetime string in Jakarta timezone
 * @param date - Date to format (can be UTC)
 * @returns Formatted datetime string (e.g., "31/12/2023, 15:45:00")
 */
export const formatDateTimeLocalizedJakarta = (date: string | Date | number): string => {
  if (!date) return '';
  
  const d = new Date(date);
  
  // Use Indonesian locale with Jakarta timezone
  const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  return formatter.format(d);
};

/**
 * Gets the current date in Jakarta timezone
 * @returns Date object representing current time in Jakarta
 */
export const getCurrentJakartaDate = (): Date => {
  const now = new Date();
  return convertToJakartaTime(now);
};

/**
 * Gets the current date in YYYY-MM-DD format in Jakarta timezone
 * @returns Current date string in YYYY-MM-DD format
 */
export const getCurrentJakartaDateString = (): string => {
  return formatDateJakarta(new Date());
};