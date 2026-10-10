import { supabase } from '../supabaseClient'

export interface CustomerVoucherBalance {
  product_id: string
  balance: number
  gift_balance: number
  products: { name: string } | null
}

export async function fetchCustomerVouchers(token: string): Promise<CustomerVoucherBalance[]> {
  const { data, error } = await supabase.functions.invoke('get-customer-vouchers', {
    body: { token },
  })

  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error || 'Failed to load vouchers')

  return (data.vouchers || []) as CustomerVoucherBalance[]
}
