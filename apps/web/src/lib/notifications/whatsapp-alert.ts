import type { ChannelMessage } from './channels/types';
import { formatCurrency } from '@/lib/currency';
import { prisma } from '@/lib/prisma';

interface WhatsAppTransport {
  apiUrl: string;
  apiKey: string;
  account: string;
}

function readTransport(): WhatsAppTransport | null {
  const apiUrl = process.env.WHATSAPP_API_URL;
  const apiKey = process.env.WHATSAPP_API_KEY;
  const account = process.env.WHATSAPP_ACCOUNT;
  if (!apiUrl || !apiKey || !account) return null;
  return { apiUrl, apiKey, account };
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

function buildText(message: ChannelMessage, includeChartUrl: boolean): string {
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
  const chartUrl = includeChartUrl ? asString(d.chartUrl) : '';
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

async function postMessage(
  transport: WhatsAppTransport,
  path: string,
  extraBody: Record<string, string>,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${transport.apiUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': transport.apiKey },
      body: JSON.stringify({ account: transport.account, ...extraBody, message: text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[whatsapp] ${path} ${res.status}: ${detail.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] ${path} failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Fire the new-low alert over WhatsApp. Returns null when no transport is
 * configured (env vars unset) or there is nowhere to send, false when every
 * attempt failed, true when at least one delivery succeeded.
 *
 * Two destinations, additive (option B): the global group (env-configured, gets
 * the full message including the private chart link) plus every per-tracker
 * phone in WhatsAppAlert (each gets the public message — no Tailscale link,
 * since those recipients may be third parties off the tailnet).
 */
export async function sendWhatsAppAlert(
  queryId: string,
  message: ChannelMessage,
): Promise<boolean | null> {
  const transport = readTransport();
  if (!transport) return null;

  let attempted = false;
  let delivered = false;

  const groupId = process.env.WHATSAPP_ALERT_GROUP_ID;
  if (groupId) {
    attempted = true;
    const ok = await postMessage(transport, '/api/groups/send-message', { groupId }, buildText(message, true));
    delivered = delivered || ok;
  }

  try {
    const phones = await prisma.whatsAppAlert.findMany({
      where: { queryId, enabled: true },
      select: { phone: true },
    });
    for (const { phone } of phones) {
      attempted = true;
      const ok = await postMessage(transport, '/api/messages/send', { phone }, buildText(message, false));
      delivered = delivered || ok;
    }
  } catch (err) {
    console.error(`[whatsapp] destination lookup failed for query=${queryId}: ${err instanceof Error ? err.message : err}`);
  }

  if (!attempted) return null;
  return delivered;
}
