/**
 * Integración con la WhatsApp Business Cloud API de Meta.
 *
 * Docs oficiales: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Variables de entorno necesarias (ver .env.example):
 *   WHATSAPP_TOKEN            → token permanente del System User / app
 *   WHATSAPP_PHONE_NUMBER_ID  → phone_number_id por defecto para enviar
 *   WHATSAPP_VERIFY_TOKEN     → cadena secreta para verificar el webhook
 *   WHATSAPP_API_VERSION      → versión del Graph API (default v21.0)
 *
 * El módulo está diseñado para ser "no-op" si no hay token configurado, de modo
 * que el CRM se pueda usar en local (asignación, notas, estados) sin WhatsApp.
 */

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN);
}

/**
 * Verifica el handshake del webhook (GET) que hace Meta al registrar la URL.
 * Devuelve el `challenge` si el verify token coincide, o null si no.
 */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token && token === expected) {
    return challenge;
  }
  return null;
}

export interface IncomingMessage {
  waMessageId: string; // id único del mensaje en WhatsApp
  from: string; // teléfono del cliente (sin +)
  toPhoneNumberId: string; // a qué número de la empresa llegó
  text: string; // contenido (texto, o un placeholder para multimedia)
  timestamp: Date;
  profileName?: string; // nombre del perfil de WhatsApp del cliente
}

/**
 * Aplana el payload del webhook de Meta a una lista simple de mensajes
 * entrantes. El payload real tiene forma:
 *   entry[].changes[].value.messages[]
 * y los nombres de contacto en value.contacts[].
 */
export function parseIncomingMessages(payload: unknown): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  const body = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            id: string;
            from: string;
            timestamp: string;
            type: string;
            text?: { body?: string };
            button?: { text?: string };
            interactive?: {
              button_reply?: { title?: string };
              list_reply?: { title?: string };
            };
          }[];
        };
      }[];
    }[];
  };

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      const contacts = value.contacts ?? [];

      for (const msg of value.messages) {
        const profile = contacts.find((c) => c.wa_id === msg.from)?.profile?.name;

        // Extrae el texto según el tipo de mensaje
        let text = "";
        if (msg.type === "text") text = msg.text?.body ?? "";
        else if (msg.type === "button") text = msg.button?.text ?? "";
        else if (msg.type === "interactive")
          text =
            msg.interactive?.button_reply?.title ??
            msg.interactive?.list_reply?.title ??
            "";
        else text = `[${msg.type}]`; // imagen, audio, ubicación, etc.

        out.push({
          waMessageId: msg.id,
          from: msg.from,
          toPhoneNumberId: phoneNumberId,
          text,
          timestamp: new Date(Number(msg.timestamp) * 1000),
          profileName: profile,
        });
      }
    }
  }
  return out;
}

/**
 * Envía un mensaje de texto al cliente vía WhatsApp Cloud API.
 * Devuelve el id del mensaje de WhatsApp, o null si WhatsApp no está
 * configurado (modo local). Lanza error si la API responde con fallo.
 */
export async function sendWhatsAppMessage(opts: {
  to: string; // teléfono del cliente (E.164, con o sin +)
  body: string;
  phoneNumberId?: string; // si no se pasa, usa el de la env
}): Promise<string | null> {
  if (!isWhatsAppConfigured()) {
    // Modo local: no enviamos nada real, pero el CRM guarda el mensaje igual.
    return null;
  }

  const phoneNumberId = opts.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error("Falta WHATSAPP_PHONE_NUMBER_ID para enviar el mensaje");
  }

  const url = `${GRAPH_BASE}/${API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: opts.to.replace(/^\+/, ""),
      type: "text",
      text: { preview_url: false, body: opts.body },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`WhatsApp API error (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? null;
}
