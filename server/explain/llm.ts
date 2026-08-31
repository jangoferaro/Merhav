/**
 * Anthropic adapter for the explanation step.
 *
 * The model's entire job is to make an already-final decision read like a
 * person said it. It gets the payload and nothing else - no tools, no
 * retrieval, no route geometry, no reports.
 */

import type { ExplanationPayload } from './payload.ts'
import { REASON_SPECS } from '../../shared/reasonCodes.ts'

const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const TIMEOUT_MS = 4000

/**
 * The vocabulary is inlined so the model sees the exact set of things it may
 * say. Anything outside it is, by definition, invented.
 */
function vocabularyFor(codes: string[]): string {
  return codes
    .map((c) => {
      const spec = REASON_SPECS[c as keyof typeof REASON_SPECS]
      return spec ? `- ${c}: ${spec.clause}` : null
    })
    .filter(Boolean)
    .join('\n')
}

function buildSystemPrompt(payload: ExplanationPayload): string {
  return [
    'אתה מנסח הסבר קצר בעברית לממליץ מסלול הליכה. אתה לא בוחר מסלול ולא מחשב ציון —',
    'ההחלטה כבר התקבלה על ידי מנוע נתונים, ואתה רק מנסח אותה בשפה אנושית.',
    '',
    'כללים מחייבים:',
    '1. שתיים עד ארבע שורות. קצר.',
    '2. ניסוח יחסי בלבד: "עדיף", "מומלץ", "לפי המידע הזמין".',
    `3. אסור לחלוטין: ${payload.prohibited_claims.join(', ')}. אל תכתוב "בטוח", "מסוכן", "מובטח", "אין סיכון".`,
    '4. אסור לתאר אנשים לפי מראה, שיוך או קבוצה. אסור לדרג שכונות.',
    '5. אסור להוסיף עובדה, אירוע, מספר או סיבה שלא מופיעים ב-payload.',
    `6. המספרים היחידים שמותר לכתוב: ${payload.permitted_numbers.join(', ')}.`,
    '7. אם ה-confidence נמוך — לומר זאת במפורש ובקצרה.',
    '',
    'הסיבות המאושרות שאתה רשאי לנסח (ואין מלבדן):',
    vocabularyFor([...payload.positives, ...payload.alternative_negatives]),
    '',
    'החזר טקסט בלבד, בלי כותרת ובלי סימון.',
  ].join('\n')
}

export interface LlmResult {
  text: string | null
  error?: string
}

export async function draftExplanation(payload: ExplanationPayload): Promise<LlmResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { text: null, error: 'no_api_key' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: process.env.EXPLANATION_MODEL ?? 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.3,
        system: buildSystemPrompt(payload),
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    })

    if (!response.ok) {
      return { text: null, error: `http_${response.status}` }
    }

    const body = (await response.json()) as {
      content?: { type: string; text?: string }[]
    }
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim()

    return text.length > 0 ? { text } : { text: null, error: 'empty_response' }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return { text: null, error: aborted ? 'timeout' : 'request_failed' }
  } finally {
    clearTimeout(timer)
  }
}
