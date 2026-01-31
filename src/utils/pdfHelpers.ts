// PDF styling utilities

export interface PaymentStatusStyle {
  text: string;
  fillColor: [number, number, number];
  textColor: [number, number, number];
}

// Color constants for payment status indicators in PDFs
const PAID_BG_COLOR: [number, number, number] = [200, 255, 200]; // Light green
const UNPAID_BG_COLOR: [number, number, number] = [255, 240, 200]; // Light orange
const PAID_TEXT_COLOR: [number, number, number] = [0, 100, 0]; // Dark green
const UNPAID_TEXT_COLOR: [number, number, number] = [150, 75, 0]; // Brown

/**
 * Get styling information for a payment status in PDF generation
 * @param paymentStatus - The payment status ("paid" or "unpaid")
 * @returns Object containing text label and color styling
 */
export function getPaymentStatusStyle(
  paymentStatus: "paid" | "unpaid"
): PaymentStatusStyle {
  if (paymentStatus === "paid") {
    return {
      text: "PAID",
      fillColor: PAID_BG_COLOR,
      textColor: PAID_TEXT_COLOR,
    };
  } else {
    return {
      text: "UNPAID",
      fillColor: UNPAID_BG_COLOR,
      textColor: UNPAID_TEXT_COLOR,
    };
  }
}