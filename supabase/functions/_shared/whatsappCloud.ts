type TemplateParameter = {
  type: 'text'
  text: string
}

type TemplateComponent =
  | { type: 'body'; parameters: TemplateParameter[] }
  | { type: 'button'; sub_type: 'url'; index: number; parameters: TemplateParameter[] }

type SendTemplateParams = {
  to: string
  templateName: string
  languageCode?: string
  components: TemplateComponent[]
}

const DEFAULT_LANGUAGE_CODE = 'id'

export async function sendTemplateMessage(params: SendTemplateParams) {
  const token = Deno.env.get('WA_CLOUD_API_TOKEN')
  const phoneNumberId = Deno.env.get('WA_CLOUD_PHONE_NUMBER_ID')

  if (!token || !phoneNumberId) {
    throw new Error('Missing WA_CLOUD_API_TOKEN or WA_CLOUD_PHONE_NUMBER_ID')
  }

  if (!params.templateName) {
    throw new Error('Missing template name for WhatsApp Cloud API')
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`

  // WhatsApp API expects digits only (no + or spaces)
  const toDigits = params.to.replace(/\D/g, '')
  const payload = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.languageCode || DEFAULT_LANGUAGE_CODE },
      components: params.components,
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json()

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}

export function buildBodyParams(values: Array<string | number>): TemplateComponent[] {
  return [
    {
      type: 'body',
      parameters: values.map((value) => ({
        type: 'text',
        text: String(value),
      })),
    },
  ]
}

/** For templates with 0 body params + 1 button URL (e.g. magic_link_login) */
export function buildButtonUrlComponents(url: string): TemplateComponent[] {
  return [
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: url }],
    },
  ]
}
