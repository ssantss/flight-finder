import type { ChannelMessage } from './channels/types';
import { formatCurrency } from '@/lib/currency';

interface WhatsAppAlertConfig {
  apiUrl: string;
  apiKey: string;
  account: string;
  groupId: string;
}

function readConfig(): WhatsAppAlertConfig | null {
  const apiUrl = process.env.WHATSAPP_API_URL;
  const apiKey = process.env.WHATSAPP_API_KEY;
  const account = process.env.WHATSAPP_ACCOUNT;
  const groupId = process.env.WHATSAPP_ALERT_GROUP_ID;
  if (!apiUrl || !apiKey || !account || !groupId) return null;
  return { apiUrl, apiKey, account, groupId };
}

type DataValue = string | number | boolean | null | undefined;

function asNumber(value: DataValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: DataValue): string {
  return value == null ? '' : String(value);
}

function buildText(message: ChannelMessage): string {
  const d = message.data;
  const currency = typeof d.currency === 'string' ? d.currency : null;
  const price = (value: DataValue): string => {
    const n = asNumber(value);
    return n == null ? '—' : formatCurrency(n, currency);
  };

  const origin = asString(d.origin);
  const destination = asString(d.destination);
  const airline = asString(d.airline);
  const travelDate = asString(d.travelDate);
  const chartUrl = asString(d.chartUrl);
  const bookingUrl = asString(d.bookingUrl);

  const lines = [
    '✈️ *Flight Finder*',
    '',
    `📉 *Nuevo mínimo: ${origin} → ${destination}*`,
    `Bajó a *${price(d.currentMin)}*${airline ? ` en ${airline}` : ''}`,
    `(antes ${price(d.baseline)}, ahorro de ${price(d.drop)})`,
  ];
  if (travelDate) lines.push(`🗓️ Fecha de viaje: ${travelDate}`);
  if (chartUrl || bookingUrl) lines.push('');
  if (chartUrl) lines.push(`🔗 Ver gráfico: ${chartUrl}`);
  if (bookingUrl) lines.push(`🎟️ Reservar: ${bookingUrl}`);

  return lines.join('\n');
}

export async function sendWhatsAppAlert(message: ChannelMessage): Promise<boolean | null> {
  const config = readConfig();
  if (!config) return null;

  try {
    const res = await fetch(`${config.apiUrl.replace(/\/+$/, '')}/api/groups/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
      body: JSON.stringify({
        account: config.account,
        groupId: config.groupId,
        message: buildText(message),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[whatsapp] ${res.status}: ${detail.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] send failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
