/**
 * Brand colors (CMYK → HEX)
 * Primary: C70M0Y20K0
 * Secondary: C100M0Y20K0
 * Tertiary: C90M50Y0K0
 */
export const theme = {
  primary: '#4DCCCC',      // C70M0Y20K0 - teal/cyan
  primaryDark: '#3DB8B8',
  secondary: '#008B8B',     // C100M0Y20K0 - dark cyan
  secondaryDark: '#006B6B',
  tertiary: '#4A90D9',      // C90M50Y0K0 - blue
  tertiaryDark: '#2A70B9',
  // Gradients
  gradientPrimary: 'linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%)',
  gradientAccent: 'linear-gradient(135deg, #4DCCCC 0%, #4A90D9 100%)',
  gradientSuccess: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
  // UI
  success: '#28a745',
  warning: '#ffc107',
  error: '#dc3545',
  info: '#2196f3',
  disabled: '#ccc',
  cardBg: '#ffffff',
  cardBgAlt: '#f5f5f5',
  text: '#333',
  textMuted: '#666',
  textLight: '#999',
} as const;
